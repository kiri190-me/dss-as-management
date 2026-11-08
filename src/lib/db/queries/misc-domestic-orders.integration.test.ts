import "../../../../scripts/load-env";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { domesticOrders, repairCaseApprovals, repairCases, users } from "../schema";
import {
  getDomesticOrderApprovalProgress,
  loadDomesticOrderApprovalStates,
} from "./domestic-order-approvals";
import { listDomesticOrders, listMiscDomesticOrders } from "./domestic-orders";

/**
 * ============================================================================
 * listMiscDomesticOrders — **무엇이 기타건 목록에 들어오는가** (2026-11-06)
 * ============================================================================
 * 기타건 = 내자 정리의 줄 중 **수리 건이 붙지 않은 줄**이다. 그 정의는 조회의
 * `where` 한 줄이고(queries/domestic-orders.ts), 그 한 줄이 틀려도 화면은 **아무
 * 말 없이** 남의 줄을 보여 준다 — 틀리는 쪽이 「수리 건이 붙은 줄이 섞인다」이면
 * 그 줄에는 인수번호가 있어 눈에 띄지만, 「휴지통에 든 줄이 섞인다」이면 지운 사람만
 * 안다. 그래서 둘 다 여기서 잰다.
 *
 * 확인하는 것 넷:
 *  1. 🔴 수리 건이 붙은 줄은 **안 섞인다** — 그런 줄이 실제로 있다는 것을 먼저
 *     단언한 뒤에 「목록에 없다」를 잰다(표본이 비면 공짜로 통과한다).
 *  2. 🔴 휴지통에 든 줄도 **안 섞인다** — 기타건이면서 지워진 줄을 일부러 만든다.
 *  3. 🔴 기타건은 **들어온다** — 1·2 만 재면 「늘 빈 목록」도 통과한다.
 *  4. 🔴 차례가 **발행일자 내림차순, 빈 날짜는 뒤**다. 화면이 다시 세우는 차례와
 *     같은 값이라야 서버가 그린 첫 HTML 과 어긋나지 않는다(domain/misc-case-list.ts).
 *
 * ── 🔵 내자 정리는 달라지지 않았다 ──────────────────────────────────────
 * 같은 조인(selectDomesticOrderJoinRows)을 나눠 쓰므로, 이 조각이 그 조인을 건드렸다면
 * 내자 정리 목록이 함께 흔들린다. 그래서 같은 자리에서 listDomesticOrders 도 불러
 * **세 줄이 다 보이는지** 확인한다.
 *
 * ── 격리 규약 ───────────────────────────────────────────────────────────
 * 이 스위트는 **접수 건을 만들지 않는다.** 수리 건이 붙은 줄 하나를 위해 시험 DB 에
 * 이미 있는 건을 빌린다 — 접수 번호는 한 달에 99개뿐이라(intake_sequences), 줄 하나
 * 때문에 그 몫을 쓰면 한참 뒤 남의 시험이 까닭 없이 깨진다. 빌린 건은 고치지 않고
 * 읽기만 하며, 뒷정리는 **이 스위트가 만든 내자 줄만** 지운다.
 *
 * 이 조회는 조건에 맞는 줄 **전부**를 돌려주므로 시드 자료의 줄도 함께 나온다.
 * 단언은 언제나 **이 스위트가 만든 id 를 찾아서** 한다(목록 전체와의 같음이 아니다).
 * ============================================================================
 */

/** 이 스위트가 만든 줄을 가르는 표시. 발주서번호에 실행마다 다른 토큰을 심는다. */
const TEST_PO_PREFIX = `MISC-CASE-QUERY-TEST-${randomUUID()}-`;

const createdOrderIds: string[] = [];
let borrowedRepairCaseId: string;
/** 결재 행의 `requested_by_user_id` 에 쓸 사람. 빌려서 **읽기만** 한다. */
let borrowedUserId: string;

/** 내자 줄 하나. 주지 않은 칸은 전부 NULL 이다. */
async function insertOrder(fields: {
  repairCaseId?: string | null;
  isDeleted?: boolean;
  quoteIssuedDate?: string | null;
  label: string;
}): Promise<string> {
  const [inserted] = await db
    .insert(domesticOrders)
    .values({
      repairCaseId: fields.repairCaseId ?? null,
      isDeleted: fields.isDeleted ?? false,
      quoteIssuedDate: fields.quoteIssuedDate ?? null,
      purchaseOrderNumber: `${TEST_PO_PREFIX}${fields.label}`,
    })
    .returning({ id: domesticOrders.id });
  createdOrderIds.push(inserted.id);
  return inserted.id;
}

let miscAliveId: string;
let miscAliveNoDateId: string;
let miscAliveNewerId: string;
let linkedAliveId: string;
let miscDeletedId: string;

before(async () => {
  // 🔴 접수 건을 **만들지 않고 빌린다**(파일 머리말). 없으면 이 시험은 「수리 건이
  //    붙은 줄이 안 섞인다」를 잴 수 없으므로 그 자리에서 멈춘다.
  const [borrowed] = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(eq(repairCases.isDeleted, false))
    .limit(1);
  assert.ok(borrowed, "시험 DB 에 수리 건이 하나도 없다 — 섞임을 잴 표본이 없다");
  borrowedRepairCaseId = borrowed.id;

  const [borrowedUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isDeleted, false))
    .limit(1);
  assert.ok(borrowedUser, "시험 DB 에 계정이 하나도 없다 — 결재 행을 만들 수 없다");
  borrowedUserId = borrowedUser.id;

  miscAliveId = await insertOrder({ label: "misc-alive", quoteIssuedDate: "2026-09-30" });
  miscAliveNewerId = await insertOrder({ label: "misc-newer", quoteIssuedDate: "2026-11-02" });
  miscAliveNoDateId = await insertOrder({ label: "misc-no-date", quoteIssuedDate: null });
  linkedAliveId = await insertOrder({
    label: "linked-alive",
    repairCaseId: borrowedRepairCaseId,
    quoteIssuedDate: "2026-10-15",
  });
  miscDeletedId = await insertOrder({
    label: "misc-deleted",
    isDeleted: true,
    quoteIssuedDate: "2026-10-20",
  });
});

after(async () => {
  if (createdOrderIds.length > 0) {
    // 🔴 결재 행이 내자 줄을 가리키므로 **먼저** 지운다(FK). 이 스위트가 만든 줄에
    //    붙은 것만 지우므로 남의 기록은 건드리지 않는다.
    await db
      .delete(repairCaseApprovals)
      .where(inArray(repairCaseApprovals.domesticOrderId, createdOrderIds));
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdOrderIds));
  }
  await pgClient.end({ timeout: 5 });
});

test("🔵 못 — 표본 다섯이 실제로 그 모양으로 저장됐다", async () => {
  const rows = await db
    .select({
      id: domesticOrders.id,
      repairCaseId: domesticOrders.repairCaseId,
      isDeleted: domesticOrders.isDeleted,
    })
    .from(domesticOrders)
    .where(inArray(domesticOrders.id, createdOrderIds));

  assert.equal(rows.length, 5, "표본이 다섯이 아니다");
  const byId = new Map(rows.map((row) => [row.id, row]));
  // 🔴 「수리 건이 붙은 줄이 안 섞인다」를 재려면 **그런 줄이 실제로 있어야** 한다.
  assert.equal(byId.get(linkedAliveId)?.repairCaseId, borrowedRepairCaseId);
  // 🔴 「지운 줄이 안 섞인다」도 마찬가지다 — 개발 DB 에는 지워진 기타건이 0건이라
  //    (실측 2026-11-06) 일부러 만들어야만 잴 수 있다.
  assert.equal(byId.get(miscDeletedId)?.isDeleted, true);
  assert.equal(byId.get(miscDeletedId)?.repairCaseId, null);
  for (const id of [miscAliveId, miscAliveNewerId, miscAliveNoDateId]) {
    assert.equal(byId.get(id)?.repairCaseId, null);
    assert.equal(byId.get(id)?.isDeleted, false);
  }
});

test("🔴 기타건은 들어오고, 수리 건이 붙은 줄과 지운 줄은 안 섞인다", async () => {
  const ids = new Set((await listMiscDomesticOrders()).map((item) => item.id));

  // ③ 들어온다 — 이것이 없으면 아래 둘은 「늘 빈 목록」에서도 통과한다.
  assert.ok(ids.has(miscAliveId), "기타건이 목록에 없다");
  assert.ok(ids.has(miscAliveNewerId), "기타건이 목록에 없다");
  assert.ok(ids.has(miscAliveNoDateId), "발행일자가 없는 기타건이 목록에서 사라졌다");

  // ① 수리 건이 붙은 줄
  assert.equal(ids.has(linkedAliveId), false, "수리 건이 붙은 줄이 기타건 목록에 섞였다");
  // ② 휴지통에 든 줄
  assert.equal(ids.has(miscDeletedId), false, "지운 줄이 기타건 목록에 섞였다");
});

test("🔴 차례는 발행일자 내림차순이고, 날짜 없는 줄이 뒤다", async () => {
  const rows = await listMiscDomesticOrders();
  const positionOf = (id: string) => {
    const at = rows.findIndex((item) => item.id === id);
    assert.ok(at >= 0, "목록에서 이 스위트의 줄을 찾지 못했다");
    return at;
  };

  assert.ok(
    positionOf(miscAliveNewerId) < positionOf(miscAliveId),
    "늦게 발행한 줄이 아래에 있다 — 내림차순이 아니다"
  );
  assert.ok(
    positionOf(miscAliveId) < positionOf(miscAliveNoDateId),
    "발행일자가 없는 줄이 날짜 있는 줄보다 위에 있다"
  );
});

test("🔵 내자 정리 목록은 달라지지 않았다 — 같은 조인을 나눠 쓴다", async () => {
  const ids = new Set((await listDomesticOrders()).map((item) => item.id));

  assert.ok(ids.has(miscAliveId), "내자 정리에서 기타건 줄이 사라졌다");
  assert.ok(ids.has(linkedAliveId), "내자 정리에서 수리 건이 붙은 줄이 사라졌다");
  assert.equal(ids.has(miscDeletedId), false, "내자 정리에 지운 줄이 나온다");
});

test("🔴 기타건 줄은 전부 repairCaseId 가 비어 있다 — 화면의 [품명] 링크가 그것으로 선다", async () => {
  const rows = await listMiscDomesticOrders();
  assert.ok(rows.length > 0, "목록이 비어 있다 — 아래 단언이 공짜로 통과한다");
  const linked = rows.filter((row) => row.repairCaseId !== null);
  assert.deepEqual(
    linked.map((row) => row.id),
    [],
    "수리 건이 붙은 줄이 있다 — 그 줄에서는 [품명]이 링크가 아니라 글자가 된다"
  );
});

/**
 * ============================================================================
 * 🔴 상태 배지의 근거 — 목록과 상세가 **같은 답**을 내는가 (2026-11-06)
 * ============================================================================
 * 「출하 승인 대기」/「출하 대기」는 **최신 결재 행 + 그 줄의 판 번호**로 나오는
 * 파생값이다. 목록은 줄 여럿을 질의 하나로 걷어 오고(loadDomesticOrderApprovalStates)
 * 상세는 줄 하나를 따로 읽는다(getDomesticOrderApprovalProgress) — **두 길이 같은
 * 답을 내야** 같은 줄이 두 화면에서 같은 배지로 보인다. 갈리면 오류 없이 조용히
 * 어긋나므로 여기서 맞대어 본다.
 *
 * 🔵 접수 건은 여기서도 만들지 않는다. 결재 행은 `domestic_order_id` 쪽에 붙으므로
 * (표의 CHECK — 접수 건 칸은 NULL) 내자 줄과 사람 하나만 있으면 된다.
 */
async function insertApproval(fields: {
  domesticOrderId: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  versionAtRequest: number;
  requestedAt: Date;
}): Promise<void> {
  // 🔴 결정된 행에는 **누가 언제** 가 함께 있어야 한다(표의 CHECK
  //    `repair_case_approvals_decision_metadata`). 빠뜨리면 DB 가 거절한다 —
  //    이 시험을 쓰면서 실제로 걸렸고, 그것이 그 제약이 살아 있다는 증거다.
  const decided = fields.status !== "REQUESTED";
  await db.insert(repairCaseApprovals).values({
    domesticOrderId: fields.domesticOrderId,
    approvalType: "DOMESTIC_ORDER_FINAL_SHIPMENT",
    // 🔴 2026-11-08 — 기타건 결재 행에는 회차가 반드시 있다(표의 CHECK). 이 표본은
    //    회차 하나짜리 기타건이라 1차다.
    dueDateRowOrder: 1,
    status: fields.status,
    requestedByUserId: borrowedUserId,
    requestedAt: fields.requestedAt,
    repairCaseVersionAtRequest: fields.versionAtRequest,
    decidedByUserId: decided ? borrowedUserId : null,
    decidedAt: decided ? fields.requestedAt : null,
    decisionReason: fields.status === "REJECTED" ? "시험용 반려 사유" : null,
  });
}

test("🔴 올린 줄은 PENDING, 승인된 줄은 APPROVED — 그리고 상세와 같은 답이다", async () => {
  const pendingId = await insertOrder({ label: "approval-pending" });
  const approvedId = await insertOrder({ label: "approval-approved" });
  const untouchedId = await insertOrder({ label: "approval-none" });

  const [pendingRow] = await db
    .select({ version: domesticOrders.version })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, pendingId));
  const [approvedRow] = await db
    .select({ version: domesticOrders.version })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, approvedId));
  assert.ok(pendingRow && approvedRow, "방금 만든 줄을 못 읽었다");

  await insertApproval({
    domesticOrderId: pendingId,
    status: "REQUESTED",
    versionAtRequest: pendingRow.version,
    requestedAt: new Date("2026-11-05T01:00:00.000Z"),
  });
  await insertApproval({
    domesticOrderId: approvedId,
    status: "APPROVED",
    versionAtRequest: approvedRow.version,
    requestedAt: new Date("2026-11-05T02:00:00.000Z"),
  });

  const states = await loadDomesticOrderApprovalStates([
    { id: pendingId, version: pendingRow.version, dueDates: [] },
    { id: approvedId, version: approvedRow.version, dueDates: [] },
    { id: untouchedId, version: 1, dueDates: [] },
  ]);

  assert.equal(states.get(pendingId), "PENDING");
  assert.equal(states.get(approvedId), "APPROVED");
  // 결재 기록이 없는 줄은 **지도에 없다** — 받는 쪽이 null 로 메우면 「진행 중」이다.
  assert.equal(states.has(untouchedId), false);

  // 🔴 상세가 쓰는 길과 맞댄다. 갈리면 같은 줄이 두 화면에서 다른 배지로 보인다.
  for (const id of [pendingId, approvedId]) {
    const progress = await getDomesticOrderApprovalProgress(id);
    assert.equal(progress?.state, states.get(id), `${id} 에서 목록과 상세가 갈렸다`);
  }
});

test("🔴 승인 뒤에 줄이 바뀌면 STALE 이다 — 낡은 승인을 「출하 대기」로 읽지 않는다", async () => {
  const staleId = await insertOrder({ label: "approval-stale" });
  const [row] = await db
    .select({ version: domesticOrders.version })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, staleId));
  assert.ok(row, "방금 만든 줄을 못 읽었다");

  // **요청 시점보다 줄이 앞서 있다** — 승인 뒤에 누가 그 줄을 고친 모양이다.
  await insertApproval({
    domesticOrderId: staleId,
    status: "APPROVED",
    versionAtRequest: row.version - 1,
    requestedAt: new Date("2026-11-05T03:00:00.000Z"),
  });

  const states = await loadDomesticOrderApprovalStates([{ id: staleId, version: row.version, dueDates: [] }]);
  assert.equal(states.get(staleId), "STALE");
  // 🔵 못 — 같은 행을 「그때의 판」으로 보면 APPROVED 다. 즉 이 시험이 재는 것은
  //    판 번호를 실제로 대조한다는 사실이지, 늘 STALE 을 내는 것이 아니다.
  const asOfThen = await loadDomesticOrderApprovalStates([
    { id: staleId, version: row.version - 1, dueDates: [] },
  ]);
  assert.equal(asOfThen.get(staleId), "APPROVED");
});

test("🔴 「최신」의 정의가 상세와 같다 — 단계가 이어진 줄은 마지막 행이 말한다", async () => {
  const chainedId = await insertOrder({ label: "approval-chained" });
  const [row] = await db
    .select({ version: domesticOrders.version })
    .from(domesticOrders)
    .where(eq(domesticOrders.id, chainedId));
  assert.ok(row, "방금 만든 줄을 못 읽었다");

  // 1단계는 승인됐고, 그 뒤 2단계 요청이 섰다 — 지금 상태는 「대기」다.
  await insertApproval({
    domesticOrderId: chainedId,
    status: "APPROVED",
    versionAtRequest: row.version,
    requestedAt: new Date("2026-11-05T04:00:00.000Z"),
  });
  await insertApproval({
    domesticOrderId: chainedId,
    status: "REQUESTED",
    versionAtRequest: row.version,
    requestedAt: new Date("2026-11-05T05:00:00.000Z"),
  });

  const states = await loadDomesticOrderApprovalStates([{ id: chainedId, version: row.version, dueDates: [] }]);
  assert.equal(states.get(chainedId), "PENDING", "먼저 온 행(1단계)을 지금 상태로 읽었다");
  const progress = await getDomesticOrderApprovalProgress(chainedId);
  assert.equal(progress?.state, "PENDING");
});

test("🔵 지운 줄은 조건 둘을 **함께** 본다 — 수리 건이 붙은 채로 지워진 줄도 안 나온다", async () => {
  const linkedDeletedId = await insertOrder({
    label: "linked-deleted",
    repairCaseId: borrowedRepairCaseId,
    isDeleted: true,
  });
  const ids = new Set((await listMiscDomesticOrders()).map((item) => item.id));
  assert.equal(ids.has(linkedDeletedId), false);

  // 🔵 못 — 방금 넣은 줄이 두 조건 중 **어느 쪽으로** 걸러졌는지 알 수 없으면
  //    이 시험은 아무것도 더 말해 주지 않는다. 같은 모양에서 지움만 푼 줄도
  //    여전히 안 나온다는 것을 바로 위 시험이 이미 말했으므로, 여기서는 저장된
  //    상태가 「둘 다」임을 못 박는다.
  const [saved] = await db
    .select({ repairCaseId: domesticOrders.repairCaseId, isDeleted: domesticOrders.isDeleted })
    .from(domesticOrders)
    .where(and(eq(domesticOrders.id, linkedDeletedId), eq(domesticOrders.isDeleted, true)));
  assert.equal(saved?.repairCaseId, borrowedRepairCaseId);
  assert.equal(saved?.isDeleted, true);
});
