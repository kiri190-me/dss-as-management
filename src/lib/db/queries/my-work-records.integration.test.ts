import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { repairCases, repairCaseWorkRecords, users } from "../schema";
import { listMyWorkRecords } from "./my-work-records";

/**
 * 「내 작업기록」(listMyWorkRecords) 통합 시험 — 격리된 시험 DB 기준.
 *
 * ── 스스로 치우는 방식 ──────────────────────────────────────────────────
 * 이 묶음은 **접수 건을 만들지 않는다.** repair_case_work_records.repair_case_id
 * 는 nullable 이라(ON DELETE SET NULL) 작업기록만 따로 넣을 수 있고, 여기서
 * 검사하는 것 넷(남의 것 제외 · 무효 제외 · 12개월 창 · 지워진 건) 가운데 셋은
 * 접수 건이 아예 필요 없다. 건이 필요한 한 가지(조인으로 인수번호·고객사·모델명이
 * 딸려 오는가)는 **이미 있는 건을 읽기만** 해서 쓴다 — 새 접수를 만들면 인수번호
 * 일련번호와 공유폴더까지 건드리게 되는데, 이 시험에 그럴 까닭이 없다.
 *
 * 모든 작업기록의 memo 가 MEMO_PREFIX 로 시작하고, after() 가 그 글자로만 지운다.
 * 미리 들어 있던 기록·접수 건·사용자는 한 줄도 건드리지 않는다.
 *
 * 🔴 이 시험은 `npm run test:db` 로만 돈다(시험 DB 를 처음부터 까는 절차다).
 */

const MEMO_PREFIX = "MYWORKRECORDS-TEST-";

/** 시험의 「지금」. 고정해 두어야 12개월 창의 경계를 재현할 수 있다 — 한국시간 2026-10-06 09:00. */
const NOW = new Date("2026-10-06T00:00:00.000Z");

/** 한국시간 2026-10-01 00:30 = UTC 2026-09-30 15:30. 달 경계 시험용. */
const KST_OCTOBER_FIRST_EARLY = new Date("2026-09-30T15:30:00.000Z");

/** 창 안(한국시간 2025-11-01 01:00 — 12개월 창의 첫날 아침). */
const INSIDE_WINDOW_EDGE = new Date("2025-10-31T16:00:00.000Z");

/** 창 밖(한국시간 2025-10-31 23:59 — 창이 시작되기 1분 전). */
const OUTSIDE_WINDOW_EDGE = new Date("2025-10-31T14:59:00.000Z");

/** 13개월 전. */
const THIRTEEN_MONTHS_AGO = new Date("2025-09-20T01:00:00.000Z");

let engineerAId: string;
let engineerBId: string;
let existingCaseId: string;
let existingCaseIntakeNumber: string;

async function insertRecord(opts: {
  authorId: string;
  repairCaseId?: string | null;
  createdAt: Date;
  label: string;
  invalidated?: boolean;
}): Promise<string> {
  const [inserted] = await db
    .insert(repairCaseWorkRecords)
    .values({
      repairCaseId: opts.repairCaseId ?? null,
      authorUserId: opts.authorId,
      memo: `${MEMO_PREFIX}${opts.label}`,
      createdAt: opts.createdAt,
      ...(opts.invalidated
        ? {
            // 무효 처리 세 칸은 all-or-nothing CHECK 이 걸려 있다 — 셋을 함께 채운다.
            invalidatedAt: sql`now()`,
            invalidatedBy: opts.authorId,
            invalidationReason: "시험용 무효 처리",
          }
        : {}),
    })
    .returning({ id: repairCaseWorkRecords.id });
  return inserted.id;
}

before(async () => {
  const engineers = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(2);
  assert.ok(engineers.length >= 2, "expected at least two approved AS_ENGINEER users in the test DB");
  engineerAId = engineers[0].id;
  engineerBId = engineers[1].id;

  // 읽기만 한다 — 이 건은 이 시험이 만들지도, 고치지도, 지우지도 않는다.
  const [existing] = await db
    .select({ id: repairCases.id, intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.isDeleted, false))
    .limit(1);
  assert.ok(existing, "expected at least one non-deleted repair case in the test DB");
  existingCaseId = existing.id;
  existingCaseIntakeNumber = existing.intakeNumber;
});

after(async () => {
  // 이 묶음이 넣은 줄만 지운다 — memo 머리글자가 유일한 표식이다.
  await db.delete(repairCaseWorkRecords).where(like(repairCaseWorkRecords.memo, `${MEMO_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("listMyWorkRecords: 누구의 기록인가", () => {
  test("② 내가 적은 기록은 나온다", async () => {
    const id = await insertRecord({ authorId: engineerAId, createdAt: NOW, label: "mine" });
    const rows = await listMyWorkRecords(engineerAId, NOW);
    assert.ok(rows.some((r) => r.id === id));
  });

  test("② 남이 적은 기록은 안 나온다 — 남의 것을 볼 수 있는 인자 자체가 없다", async () => {
    const id = await insertRecord({ authorId: engineerBId, createdAt: NOW, label: "someone-else" });
    const rowsForA = await listMyWorkRecords(engineerAId, NOW);
    assert.equal(
      rowsForA.some((r) => r.id === id),
      false,
      "다른 사람이 적은 기록이 섞여 들어왔다"
    );
    const rowsForB = await listMyWorkRecords(engineerBId, NOW);
    assert.ok(rowsForB.some((r) => r.id === id), "정작 적은 사람에게는 보여야 한다");
  });

  test("② 담당이 아닌 사람이 적은 기록도 그 사람 것이다 — 담당 여부로 거르지 않는다", async () => {
    // 지금 이 건의 담당이 누구든(A 일 수도, 아닐 수도, 아무도 아닐 수도 있다)
    // B 가 적은 기록은 B 의 목록에 있어야 한다.
    const id = await insertRecord({
      authorId: engineerBId,
      repairCaseId: existingCaseId,
      createdAt: NOW,
      label: "not-assigned-but-authored",
    });
    const rows = await listMyWorkRecords(engineerBId, NOW);
    assert.ok(rows.some((r) => r.id === id));
  });
});

describe("listMyWorkRecords: 무효 처리", () => {
  test("③ 무효 처리된 기록은 안 나온다", async () => {
    const valid = await insertRecord({ authorId: engineerAId, createdAt: NOW, label: "valid" });
    const invalidated = await insertRecord({
      authorId: engineerAId,
      createdAt: NOW,
      label: "invalidated",
      invalidated: true,
    });
    const rows = await listMyWorkRecords(engineerAId, NOW);
    assert.ok(rows.some((r) => r.id === valid));
    assert.equal(
      rows.some((r) => r.id === invalidated),
      false,
      "invalidated_at 이 찍힌 기록이 목록에 남았다"
    );
  });
});

describe("listMyWorkRecords: 12개월 창", () => {
  test("④ 13개월 전 기록은 안 나온다", async () => {
    const id = await insertRecord({ authorId: engineerAId, createdAt: THIRTEEN_MONTHS_AGO, label: "13-months-ago" });
    const rows = await listMyWorkRecords(engineerAId, NOW);
    assert.equal(rows.some((r) => r.id === id), false);
  });

  test("④ 창의 경계는 한국시간이다 — 첫날 아침은 들어오고 그 1분 전은 안 들어온다", async () => {
    const inside = await insertRecord({ authorId: engineerAId, createdAt: INSIDE_WINDOW_EDGE, label: "window-inside" });
    const outside = await insertRecord({
      authorId: engineerAId,
      createdAt: OUTSIDE_WINDOW_EDGE,
      label: "window-outside",
    });
    const rows = await listMyWorkRecords(engineerAId, NOW);
    // 🔴 UTC 자정으로 잘랐다면 inside 가 떨어진다(그 시각의 UTC 날짜는 전달 말일이다).
    assert.ok(rows.some((r) => r.id === inside), "창 첫날 아침(한국시간)에 적은 기록이 떨어졌다");
    assert.equal(rows.some((r) => r.id === outside), false, "창이 시작되기 전 기록이 들어왔다");
  });
});

describe("listMyWorkRecords: 건 정보", () => {
  test("건이 붙어 있으면 인수번호·고객사·모델명·상태가 함께 온다", async () => {
    const id = await insertRecord({
      authorId: engineerAId,
      repairCaseId: existingCaseId,
      createdAt: NOW,
      label: "joined",
    });
    const rows = await listMyWorkRecords(engineerAId, NOW);
    const found = rows.find((r) => r.id === id);
    assert.ok(found, "방금 넣은 기록이 목록에 없다");
    assert.equal(found.repairCaseId, existingCaseId);
    assert.equal(found.intakeNumber, existingCaseIntakeNumber);
    assert.equal(found.isCaseDeleted, false);
    assert.ok(found.customerName, "고객사 이름이 조인되어야 한다");
    assert.ok(found.modelName, "모델명은 products.model_name 에서 온다");
    assert.ok(found.status, "건의 현재 상태가 풀려야 한다");
  });

  test("⑥ 건이 영구 삭제된 기록(repair_case_id IS NULL)도 나오고, 건 정보 자리는 비어 있다", async () => {
    const id = await insertRecord({
      authorId: engineerAId,
      repairCaseId: null,
      createdAt: NOW,
      label: "orphaned",
    });
    const rows = await listMyWorkRecords(engineerAId, NOW);
    const found = rows.find((r) => r.id === id);
    // 🔴 INNER JOIN 으로 적었다면 이 줄이 아무 소리 없이 사라진다.
    assert.ok(found, "건이 지워진 기록이 목록에서 사라졌다");
    assert.equal(found.repairCaseId, null);
    assert.equal(found.intakeNumber, null, "가리킬 건이 없으므로 인수번호도 없다 — 화면은 이때 링크를 걸지 않는다");
    assert.equal(found.customerName, null);
    assert.equal(found.modelName, null);
    assert.equal(found.status, null);
    assert.equal(found.memo, `${MEMO_PREFIX}orphaned`, "메모는 그대로 살아 있다");
  });
});

describe("listMyWorkRecords: 차례와 달 경계", () => {
  test("새것부터 온다", async () => {
    const older = await insertRecord({
      authorId: engineerAId,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      label: "order-older",
    });
    const newer = await insertRecord({
      authorId: engineerAId,
      createdAt: new Date("2026-10-05T00:00:00.000Z"),
      label: "order-newer",
    });
    const rows = await listMyWorkRecords(engineerAId, NOW);
    const olderIndex = rows.findIndex((r) => r.id === older);
    const newerIndex = rows.findIndex((r) => r.id === newer);
    assert.ok(newerIndex >= 0 && olderIndex >= 0);
    assert.ok(newerIndex < olderIndex, "새 기록이 위에 와야 한다");
  });

  test("① 한국시간 10월 1일 00:30 에 적은 기록은 그 시각 그대로 돌아온다(달 묶기는 화면이 한국시간으로 한다)", async () => {
    const id = await insertRecord({
      authorId: engineerAId,
      createdAt: KST_OCTOBER_FIRST_EARLY,
      label: "kst-month-edge",
    });
    const rows = await listMyWorkRecords(engineerAId, NOW);
    const found = rows.find((r) => r.id === id);
    assert.ok(found, "달 경계의 기록이 조회에서 빠졌다");
    assert.equal(found.createdAt, KST_OCTOBER_FIRST_EARLY.toISOString());
  });
});
