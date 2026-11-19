import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { users, repairCases, repairCaseFlowcharts } from "../schema";
import { listUsedRepairCaseFaultTags } from "./repair-case-flowcharts";

/**
 * 진단 Flowchart 의 **고장 개소 태그 목록 조회**(2026-11-19) —
 * listUsedRepairCaseFaultTags. 편집기 태그 칸의 드롭다운이 이것으로 선다.
 *
 * 🔴 **태그 전용 표를 만들지 않기로 했다**(같은 날 결정). 그래서 목록은 지금까지
 * 어느 Flowchart 에든 달린 값을 jsonb 배열째로 펼쳐 센 것이다 — 여기서 겨냥하는
 * 결함 셋은 전부 「오류 없이 조용한」 것들이다:
 *  ① **휴지통(is_deleted)의 태그가 섞인다** — 지운 Flowchart 의 개소를 계속
 *    권하면 지운 것이 목록에서 되살아난 것처럼 보인다.
 *  ② **차례가 뜻을 잃는다** — 많이 쓰인 것이 위에 서지 않으면 드롭다운은 그냥
 *    긴 글자 더미가 된다.
 *  ③ **같은 태그가 여러 줄로 선다** — 둘이 같은 글자인데 고른 쪽이 다른 것처럼
 *    읽힌다.
 *
 * 🔵 이 조회는 **접수 건을 가리지 않는다**(모든 Flowchart 를 본다). 그래서 다른
 * 시험이 남긴 태그가 같은 시험 DB 에 섞여 있다 — 표본은 이 파일만 쓰는 접두사로
 * 만들고, 차례를 재는 단언도 **내 접두사로 걸러낸 뒤**에 한다. 거르지 않고 재면
 * 남이 태그를 하나 넣는 날 까닭 없이 깨진다.
 *
 * 접수 건은 새로 만들지 않는다 — 이미 있는 건 하나에 Flowchart 만 직접 꽂았다
 * 가 지운다(인수번호는 달마다 99개뿐이라, 조회 하나를 재자고 번호를 쓰지 않는다).
 */

/** 이 파일만 쓰는 접두사 — 남의 태그와 섞이지 않게. */
const TAG_PREFIX = `FAULTTAG-TEST-${randomUUID().slice(0, 8)}-`;
const TAG_GA = `${TAG_PREFIX}가`;
const TAG_NA = `${TAG_PREFIX}나`;
const TAG_DA = `${TAG_PREFIX}다`;
const TAG_TRASH = `${TAG_PREFIX}휴지통`;

let actorId: string;
let repairCaseId: string;
const createdFlowchartIds: string[] = [];

async function insertFlowchart(params: { title: string; faultTags: string[] | null; isDeleted?: boolean }) {
  const [row] = await db
    .insert(repairCaseFlowcharts)
    .values({
      repairCaseId,
      title: params.title,
      description: null,
      faultTags: params.faultTags,
      createdBy: actorId,
      updatedBy: actorId,
      isDeleted: params.isDeleted ?? false,
      deletedAt: params.isDeleted ? new Date() : null,
    })
    .returning({ id: repairCaseFlowcharts.id });
  createdFlowchartIds.push(row.id);
  return row.id;
}

before(async () => {
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(actor, "expected an approved SUPER_ADMIN in the test DB");
  actorId = actor.id;

  const [repairCase] = await db.select({ id: repairCases.id }).from(repairCases).where(eq(repairCases.isDeleted, false)).limit(1);
  assert.ok(repairCase, "expected at least one non-deleted repair case in the test DB");
  repairCaseId = repairCase.id;

  // 🔵 세는 모양: 다 ×3 · 가 ×2 · 나 ×2. 가나다순으로는 가 < 나 < 다 이므로,
  // **다가 맨 앞에 서는 것은 오직 많이 쓰였기 때문**이다 — 차례 규칙 둘(횟수
  // 먼저, 같으면 이름)을 한 목록으로 가를 수 있다.
  await insertFlowchart({ title: "태그 조회 표본 1", faultTags: [TAG_DA, TAG_GA] });
  await insertFlowchart({ title: "태그 조회 표본 2", faultTags: [TAG_DA, TAG_NA] });
  await insertFlowchart({ title: "태그 조회 표본 3", faultTags: [TAG_DA, TAG_GA, TAG_NA] });
  // 🔴 휴지통 — 이 태그는 목록에 **절대** 나오면 안 된다.
  await insertFlowchart({ title: "태그 조회 표본 4(휴지통)", faultTags: [TAG_TRASH], isDeleted: true });
  // 칸이 생기기 전의 줄 — NULL 이다. 조회가 여기서 터지면 드롭다운이 통째로 죽는다.
  await insertFlowchart({ title: "태그 조회 표본 5(태그 없음)", faultTags: null });
});

after(async () => {
  if (createdFlowchartIds.length > 0) {
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
  }
  await pgClient.end({ timeout: 5 });
});

describe("listUsedRepairCaseFaultTags", () => {
  test("🔵 먼저 표본 확인 — 넣어 둔 태그 셋이 실제로 목록에 있다", async () => {
    const rows = await listUsedRepairCaseFaultTags();
    assert.ok(rows.length > 0, "목록이 통째로 비면 아래 검사가 전부 공짜로 통과한다");
    const mine = rows.filter((row) => row.tag.startsWith(TAG_PREFIX));
    assert.deepEqual(
      [...mine.map((row) => row.tag)].sort(),
      [TAG_GA, TAG_NA, TAG_DA].sort(),
      "넣은 태그가 목록에 안 나온다"
    );
  });

  test("🔴 휴지통의 태그는 안 섞인다 — 지운 Flowchart 의 개소를 계속 권하지 않는다", async () => {
    const rows = await listUsedRepairCaseFaultTags();
    assert.equal(
      rows.some((row) => row.tag === TAG_TRASH),
      false,
      "휴지통에 넣은 Flowchart 의 태그가 목록에 남아 있다"
    );
  });

  test("🔴 많이 쓰인 순이고, 같으면 가나다순이다", async () => {
    const rows = await listUsedRepairCaseFaultTags();
    const mine = rows.filter((row) => row.tag.startsWith(TAG_PREFIX));
    assert.deepEqual(mine, [
      { tag: TAG_DA, useCount: 3 },
      { tag: TAG_GA, useCount: 2 },
      { tag: TAG_NA, useCount: 2 },
    ]);
  });

  test("🔴 같은 태그는 **한 줄**로 합쳐진다 — 쓴 횟수는 그 줄의 수로 센다", async () => {
    const rows = await listUsedRepairCaseFaultTags();
    const da = rows.filter((row) => row.tag === TAG_DA);
    assert.equal(da.length, 1, "같은 태그가 여러 줄로 섰다");
    assert.equal(da[0].useCount, 3);
    // 횟수는 **글자가 아니라 수**다 — count(*) 는 bigint 라 ::int 를 빼면 문자열로 온다.
    assert.equal(typeof da[0].useCount, "number");
  });

  test("태그가 NULL 인 Flowchart 가 있어도 조회가 서지 않는다 — 칸이 생기기 전의 줄이다", async () => {
    // before() 에서 NULL 짜리를 하나 꽂아 두었다. 위 시험들이 도는 것 자체가
    // 그 증거지만, 「그 줄이 정말 NULL 인가」를 여기서 값으로 확인한다 —
    // 빈 배열로 들어갔다면 이 묶음은 NULL 을 한 번도 안 재고 있는 것이다.
    const rows = await db
      .select({ id: repairCaseFlowcharts.id, faultTags: repairCaseFlowcharts.faultTags })
      .from(repairCaseFlowcharts)
      .where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
    assert.ok(
      rows.some((row) => row.faultTags === null),
      "NULL 인 줄이 없다 — 이 시험이 아무것도 안 재고 있다"
    );
    const tags = await listUsedRepairCaseFaultTags();
    assert.ok(tags.length > 0);
  });
});
