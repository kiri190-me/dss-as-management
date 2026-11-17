import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  APPROVAL_HISTORY_RELATION_LABELS,
  buildApprovalHistoryEntry,
  compareApprovalHistoryNewestFirst,
  resolveApprovalHistoryRelation,
  type ApprovalHistoryEntry,
  type ApprovalHistoryRelation,
} from "./approval-history";
import {
  buildApprovalGrantedNotification,
  buildApprovalRejectedNotification,
  type ApprovalOutcomeTarget,
} from "./notifications";

/**
 * ============================================================================
 * 결재 내역 한 줄의 모양 — DB 없이
 * ============================================================================
 * 재는 것 셋:
 *  1. 🔴 **셋이 갈린다** — 직접 / 내가 대신 / 내 자리를 남이. 같은 결재 한 줄이
 *     보는 사람에 따라 뒤의 둘로 갈리는 것까지 본다.
 *  2. 🔴 제목·결재 이름·주소가 **결과 알림(종)과 같은 글자**다. 두 벌이 되면 종에서
 *     보던 말과 내역의 말이 갈리고, 기타건은 주소가 갈리는 순간 404 가 된다 — 그
 *     404 는 포털 화면에서만 보인다.
 *  3. 차례는 결정이 늦은 것부터, 같으면 행 id 로 동점을 깬다.
 *
 * 🔵 주소를 「글자로 적어 둔 기댓값」과 **둘 다** 맞댄다(알림 빌더와 한 번, 접두사와
 * 한 번). 알림 쪽을 베끼기만 하면 **둘이 함께 틀렸을 때** 영영 통과한다.
 * ============================================================================
 */

const VIEWER = "11111111-1111-1111-1111-111111111111";
const MATE = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";

/** 🔵 갈래를 좁혀 둔다 — 시험이 `.repairCaseId` 같은 칸을 그대로 읽어 쓴다. */
const REPAIR_CASE_TARGET: Extract<ApprovalOutcomeTarget, { source: "REPAIR_CASE" }> = {
  source: "REPAIR_CASE",
  approvalId: "aaaaaaaa-0000-0000-0000-000000000001",
  repairCaseId: "cccccccc-0000-0000-0000-000000000001",
  intakeNumber: "D9504-001",
  approvalType: "FINAL_SHIPMENT",
};

const QUOTE_TARGET: Extract<ApprovalOutcomeTarget, { source: "QUOTE" }> = {
  source: "QUOTE",
  approvalId: "aaaaaaaa-0000-0000-0000-000000000002",
  quoteId: "qqqqqqqq-0000-0000-0000-000000000002",
  quoteNumber: "APHIST-TEST-0001",
};

const DOMESTIC_TARGET: Extract<ApprovalOutcomeTarget, { source: "DOMESTIC_ORDER" }> = {
  source: "DOMESTIC_ORDER",
  approvalId: "aaaaaaaa-0000-0000-0000-000000000003",
  domesticOrderId: "dddddddd-0000-0000-0000-000000000003",
  modelName: "내역시험 품명",
};

function entryOf(
  target: ApprovalOutcomeTarget,
  overrides: Partial<Parameters<typeof buildApprovalHistoryEntry>[0]> = {}
): ApprovalHistoryEntry {
  return buildApprovalHistoryEntry({
    target,
    viewerUserId: VIEWER,
    status: "APPROVED",
    decidedAt: new Date("2026-11-10T02:30:00.000Z"),
    decidedByUserId: VIEWER,
    decidedByName: "내역시험 본인",
    delegatedFromUserId: null,
    delegatedFromName: null,
    requestedByName: "내역시험 요청자",
    requestReason: null,
    decisionReason: null,
    ...overrides,
  });
}

describe("결재 내역 — 셋을 가른다", () => {
  test("🔴 내가 직접 누른 줄 · 내가 대신 누른 줄 · 내 자리를 남이 누른 줄", () => {
    assert.equal(
      resolveApprovalHistoryRelation({
        viewerUserId: VIEWER,
        decidedByUserId: VIEWER,
        delegatedFromUserId: null,
      }),
      "SELF"
    );
    assert.equal(
      resolveApprovalHistoryRelation({
        viewerUserId: VIEWER,
        decidedByUserId: VIEWER,
        delegatedFromUserId: MATE,
      }),
      "ON_BEHALF"
    );
    assert.equal(
      resolveApprovalHistoryRelation({
        viewerUserId: VIEWER,
        decidedByUserId: MATE,
        delegatedFromUserId: VIEWER,
      }),
      "BY_DELEGATE"
    );
  });

  test("🔴 **같은 줄 하나**가 보는 사람에 따라 대리인에게는 ON_BEHALF, 맡긴 사람에게는 BY_DELEGATE", () => {
    const row = { decidedByUserId: MATE, delegatedFromUserId: VIEWER };
    assert.equal(resolveApprovalHistoryRelation({ viewerUserId: MATE, ...row }), "ON_BEHALF");
    assert.equal(resolveApprovalHistoryRelation({ viewerUserId: VIEWER, ...row }), "BY_DELEGATE");
  });

  test("🔵 둘 다 나인 줄(정상 경로로는 안 생긴다)은 직접으로 본다", () => {
    assert.equal(
      resolveApprovalHistoryRelation({
        viewerUserId: VIEWER,
        decidedByUserId: VIEWER,
        delegatedFromUserId: VIEWER,
      }),
      "SELF"
    );
  });

  test("🔴 남의 자리를 남이 누른 줄이 들어오면 **직접으로 보이지 않는다** — 거르는 일은 조회의 몫이다", () => {
    // 이 함수는 「내 줄인가」를 묻지 않는다(그 판정이 두 벌이 되면 안 된다). 그래도
    // 조회가 느슨해지는 날 그 줄이 「내가 직접 눌렀다」로 서면 안 된다.
    assert.equal(
      resolveApprovalHistoryRelation({
        viewerUserId: VIEWER,
        decidedByUserId: MATE,
        delegatedFromUserId: STRANGER,
      }),
      "BY_DELEGATE"
    );
  });

  test("이름표 셋이 서로 다르고 빈 글자가 없다", () => {
    const labels = (["SELF", "ON_BEHALF", "BY_DELEGATE"] as const).map(
      (relation: ApprovalHistoryRelation) => APPROVAL_HISTORY_RELATION_LABELS[relation]
    );
    assert.equal(new Set(labels).size, 3, `이름표가 겹친다: ${labels.join(" / ")}`);
    for (const label of labels) assert.ok(label.trim().length > 0);
  });
});

describe("결재 내역 한 줄 — 제목 · 이름 · 주소", () => {
  test("🔴 접수 건: 제목·주소가 결과 알림과 같은 글자다", () => {
    const entry = entryOf(REPAIR_CASE_TARGET);
    const bell = buildApprovalGrantedNotification({ ...REPAIR_CASE_TARGET, decidedByName: "아무개" });
    assert.equal(entry.subject, "D9504-001");
    assert.equal(entry.subject, bell.subject);
    assert.equal(entry.href, bell.href);
    // 🔵 알림 쪽과만 맞대면 둘이 함께 틀렸을 때 통과한다.
    assert.ok(
      entry.href.startsWith(`/repair-cases/${REPAIR_CASE_TARGET.repairCaseId}`),
      `접수 건 주소가 아니다: ${entry.href}`
    );
    assert.equal(entry.approvalName, "최종 출하 승인");
    assert.equal(entry.source, "REPAIR_CASE");
    assert.equal(entry.targetId, REPAIR_CASE_TARGET.repairCaseId);
    assert.equal(entry.approvalId, REPAIR_CASE_TARGET.approvalId);
  });

  test("🔴 견적서: 제목은 발행번호, 주소는 결과 알림과 같은 글자다", () => {
    const entry = entryOf(QUOTE_TARGET);
    const bell = buildApprovalGrantedNotification({ ...QUOTE_TARGET, decidedByName: "아무개" });
    assert.equal(entry.subject, "APHIST-TEST-0001");
    assert.equal(entry.href, bell.href);
    assert.ok(
      entry.href.includes(QUOTE_TARGET.quoteId),
      `견적서 주소에 그 장의 id 가 없다: ${entry.href}`
    );
    assert.equal(entry.targetId, QUOTE_TARGET.quoteId);
    assert.equal(entry.approvalName, "견적서 승인");
  });

  test("🔴 기타건: 주소가 `/domestic-orders/` 로 간다 — 접수 건 헬퍼를 쓰면 404 다", () => {
    const entry = entryOf(DOMESTIC_TARGET);
    const bell = buildApprovalRejectedNotification({ ...DOMESTIC_TARGET, decisionReason: "사유" });
    assert.equal(entry.href, bell.href);
    assert.ok(
      entry.href.startsWith(`/domestic-orders/${DOMESTIC_TARGET.domesticOrderId}`),
      `기타건 주소가 아니다: ${entry.href}`
    );
    assert.ok(
      !entry.href.startsWith("/repair-cases/"),
      "같은 표의 행이라고 접수 건 주소로 나갔다"
    );
    assert.equal(entry.subject, "내역시험 품명");
  });

  test("🔵 기타건 품명이 비어도 제목이 비지 않는다 — 빈 제목은 승인함이 줄을 통째로 버린다", () => {
    const entry = entryOf({ ...DOMESTIC_TARGET, modelName: null });
    assert.ok(entry.subject.trim().length > 0, "제목이 비었다");
  });

  test("나머지 칸이 그대로 실린다 — 시각은 ISO(UTC), 사유 둘, 사람 셋", () => {
    const entry = entryOf(REPAIR_CASE_TARGET, {
      status: "REJECTED",
      decidedByUserId: MATE,
      decidedByName: "내역시험 동료",
      delegatedFromUserId: VIEWER,
      delegatedFromName: "내역시험 본인",
      requestReason: "올리며 적은 말",
      decisionReason: "반려 사유",
    });
    assert.equal(entry.status, "REJECTED");
    assert.equal(entry.decidedAt, "2026-11-10T02:30:00.000Z");
    assert.equal(entry.decidedByName, "내역시험 동료");
    assert.equal(entry.delegatedFromName, "내역시험 본인");
    assert.equal(entry.requestedByName, "내역시험 요청자");
    assert.equal(entry.requestReason, "올리며 적은 말");
    assert.equal(entry.decisionReason, "반려 사유");
    // 🔴 보는 사람이 맡긴 쪽이므로 「내 자리를 남이」다.
    assert.equal(entry.relation, "BY_DELEGATE");
    assert.equal(entry.relationLabel, APPROVAL_HISTORY_RELATION_LABELS.BY_DELEGATE);
  });
});

describe("결재 내역 — 차례", () => {
  test("결정이 늦은 것부터, 같은 시각이면 행 id 로 동점을 깬다", () => {
    const older = entryOf(REPAIR_CASE_TARGET, { decidedAt: new Date("2026-11-01T00:00:00.000Z") });
    const newer = entryOf(QUOTE_TARGET, { decidedAt: new Date("2026-11-09T00:00:00.000Z") });
    // 🔵 newer 와 **같은 시각**이고 행 id 가 더 큰 줄 — 동점을 깨는 규칙의 표본이다.
    const sameTimeBiggerId = entryOf(
      { ...DOMESTIC_TARGET, approvalId: "aaaaaaaa-0000-0000-0000-00000000000a" },
      { decidedAt: new Date("2026-11-09T00:00:00.000Z") }
    );

    const sorted = [older, sameTimeBiggerId, newer].sort(compareApprovalHistoryNewestFirst);
    assert.deepEqual(
      sorted.map((entry) => entry.approvalId),
      [sameTimeBiggerId.approvalId, newer.approvalId, older.approvalId]
    );
    // 🔵 무엇을 재는지 — 앞의 둘은 시각이 같고 id 가 큰 쪽이 앞이다.
    assert.equal(sorted[0].decidedAt, sorted[1].decidedAt);
    assert.ok(sorted[0].approvalId > sorted[1].approvalId);
  });
});
