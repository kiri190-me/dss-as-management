import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUiText, DEFAULT_UI_TEXT, type UiText } from "./ui-text";
import {
  exceptionStatusLabels,
  EXCEPTION_STATUS_CODES,
  accountApprovalStatusLabels,
  priorityLabels,
  repairStatusLabels,
  roleLabels,
  workHistoryTypeLabels,
  workRecordKindLabels,
  workflowTypeLabels,
} from "./types";

/**
 * ============================================================================
 * 🔴 「화면 변화 0」의 기계적 증거
 * ============================================================================
 * 읽는 쪽 스물여섯 곳을 코드 표에서 이 표로 갈아 끼운 판의 완료 조건은
 * **화면이 하나도 안 바뀌는 것**이다. 저장된 문구가 아직 하나도 없기 때문이다
 * (ui_text_overrides 0행). 눈으로는 그것을 증명할 수 없다 — 스물여섯 화면을
 * 전부 열어 글자를 하나씩 대조하는 사람은 없고, 있어도 다음 판에서 다시 못 한다.
 *
 * 그래서 값으로 단언한다. 아래 첫 시험은 7묶음 42문구를 **문자열 리터럴로**
 * 적어 두었다. types.ts 를 참조해서 비교하면 두 자리가 함께 틀렸을 때 아무것도
 * 못 잡으므로, 여기서만은 일부러 값을 다시 적는다 — 이 파일의 중복은 실수가
 * 아니라 **덫**이다. 문구를 정말로 바꾸는 날에는 이 시험이 먼저 걸리고, 그때
 * "화면이 바뀐다"는 사실을 사람이 한 번 읽고 넘어가게 된다.
 *
 * 두 번째 축은 types.ts 와의 대조다. 리터럴 단언만 있으면 types.ts 쪽에 코드가
 * 하나 늘었을 때 이 표에 빠진 것을 못 잡는다 — 그 자리는 화면에서 빈칸이 된다.
 * ============================================================================
 */

// ─────────────────────────── 1. 저장된 것이 없을 때의 값 (42문구 + 예외 9)

test("기본값은 types.ts 의 표와 글자 하나까지 같다 — 역할 5", () => {
  assert.deepEqual(DEFAULT_UI_TEXT.role, {
    SUPER_ADMIN: "최고관리자",
    ADMIN: "관리자",
    AS_ENGINEER: "A/S 엔지니어",
    SALES: "영업 담당자",
    INVENTORY_MANAGER: "재고 담당자",
  });
});

test("기본값은 types.ts 의 표와 글자 하나까지 같다 — 계정 승인 상태 2", () => {
  assert.deepEqual(DEFAULT_UI_TEXT.accountApprovalStatus, {
    PENDING: "승인 대기",
    APPROVED: "승인됨",
  });
});

test("기본값은 types.ts 의 표와 글자 하나까지 같다 — 워크플로 종류 9", () => {
  assert.deepEqual(DEFAULT_UI_TEXT.workflowType, {
    PAID_MATCHER: "유상 Matcher",
    WARRANTY_MATCHER: "무상(보증) Matcher",
    PAID_GENERATOR: "유상 Generator",
    WARRANTY_GENERATOR: "무상(보증) Generator",
    PAID_TOTAL_CONTROLLER: "유상 Total Controller",
    WARRANTY_TOTAL_CONTROLLER: "무상(보증) Total Controller",
    PENDING_MATCHER: "추후결정 Matcher",
    PENDING_GENERATOR: "추후결정 Generator",
    PENDING_TOTAL_CONTROLLER: "추후결정 Total Controller",
  });
});

test("기본값은 types.ts 의 표와 글자 하나까지 같다 — 수리 진행 상태 11", () => {
  assert.deepEqual(DEFAULT_UI_TEXT.repairStatus, {
    WAITING_INTAKE_INSPECTION: "인수점검 대기",
    INTAKE_INSPECTION_IN_PROGRESS: "인수점검 중",
    INTAKE_INSPECTION_COMPLETED: "인수점검 완료",
    WAITING_KYOSAN_REPLY: "교산 회신 대기",
    WAITING_PO: "PO 대기",
    WAITING_PARTS_SUPPLY: "부품 수급 대기",
    WAITING_REPAIR: "수리 대기",
    IN_REPAIR: "수리 중",
    WAITING_SHIPMENT_APPROVAL: "출하 승인 대기",
    WAITING_SHIPMENT: "출하 대기",
    SHIPMENT_COMPLETED: "출하 완료",
  });
});

test("기본값은 types.ts 의 표와 글자 하나까지 같다 — 우선순위 4", () => {
  assert.deepEqual(DEFAULT_UI_TEXT.priority, {
    LOW: "낮음",
    NORMAL: "보통",
    HIGH: "높음",
    URGENT: "긴급",
  });
});

test("기본값은 types.ts 의 표와 글자 하나까지 같다 — 작업 이력 구분 7", () => {
  assert.deepEqual(DEFAULT_UI_TEXT.workHistoryType, {
    INSPECTION: "점검",
    DIAGNOSIS: "진단",
    REPAIR: "수리/부품교체",
    TEST: "테스트",
    COMMUNICATION: "연락/보고",
    STATUS_CHANGE: "상태 변경",
    OTHER: "기타",
  });
});

test("기본값은 types.ts 의 표와 글자 하나까지 같다 — 작업 기록 종류 4", () => {
  assert.deepEqual(DEFAULT_UI_TEXT.workRecordKind, {
    GENERAL: "일반",
    INTAKE_INSPECTION_RESULT: "인수점검 결과",
    DIAGNOSIS_REPAIR_SUMMARY: "진단/조치",
    NEXT_PLANNED_ACTION: "다음 예정 작업",
  });
});

/**
 * 예외 상태는 출처가 DB(exception_statuses.label)라 위 일곱과 성질이 다르지만,
 * **DB 를 못 읽었을 때 나오는 값**은 여기 코드 표다. 그 값이 오늘 개발 DB 에 든
 * 9행과 글자 하나까지 같다는 것을 2026-09-08 에 실제 조회로 확인했다 — 그래서
 * 이 판이 화면 문구를 하나도 바꾸지 않는다.
 */
test("기본값은 types.ts 의 표와 글자 하나까지 같다 — 예외 상태 9", () => {
  assert.deepEqual(DEFAULT_UI_TEXT.exceptionStatus, {
    ON_HOLD: "보류",
    WAITING_CUSTOMER_RESPONSE: "고객 응답 대기",
    WAITING_KYOSAN_RESPONSE: "교산 응답 대기",
    PARTS_WAITING: "부품 대기",
    REPAIR_NOT_POSSIBLE: "수리 불가",
    REPAIR_FAILED: "수리 실패",
    CUSTOMER_CANCELLED_REPAIR: "고객 수리 취소",
    FREE_RETURN: "무상 반송",
    DISPOSED: "폐기",
  });
});

// ─────────────────────────── 2. types.ts 와의 대조 (코드가 늘면 잡는다)

test("묶음마다 types.ts 의 표와 키·값이 정확히 같다", () => {
  const pairs: [keyof UiText, Record<string, string>][] = [
    ["role", roleLabels],
    ["accountApprovalStatus", accountApprovalStatusLabels],
    ["workflowType", workflowTypeLabels],
    ["repairStatus", repairStatusLabels],
    ["priority", priorityLabels],
    ["workHistoryType", workHistoryTypeLabels],
    ["workRecordKind", workRecordKindLabels],
    ["exceptionStatus", exceptionStatusLabels],
  ];

  for (const [groupKey, table] of pairs) {
    assert.deepEqual(
      DEFAULT_UI_TEXT[groupKey],
      table,
      `${groupKey} 가 types.ts 의 표와 다르다 — 코드가 늘었거나 문구가 바뀌었다`
    );
  }
});

test("저장된 것이 하나도 없으면 병합 결과가 기본값과 완전히 같다", () => {
  assert.deepEqual(buildUiText([], []), DEFAULT_UI_TEXT);
});

/**
 * 🔴 유·무상 구분(billingType)과 제품 구분(productCategory)은 **여기 없어야 한다.**
 * 앞의 것은 접수 알림 메일 본문에도 나가서(2026-09-08 사용자 결정), 뒤의 것은
 * 문구 값이 곧 비교값이라서다. 값으로 단언해 둔다 — 나중에 누가 "빠졌네" 하며
 * 넣으면 이 시험이 먼저 걸린다.
 */
test("일부러 뺀 두 표는 화면 문구 표에 들어 있지 않다", () => {
  const groupKeys = Object.keys(DEFAULT_UI_TEXT);
  assert.ok(!groupKeys.includes("billingType"), "billingType 을 넣었다 — 화면과 메일이 갈린다");
  assert.ok(!groupKeys.includes("productCategory"), "productCategory 를 넣었다 — 필터가 깨진다");
  assert.equal(groupKeys.length, 8);
});

test("기본값은 types.ts 의 표를 그대로 넘긴 것이 아니라 복사본이다", () => {
  assert.notEqual(DEFAULT_UI_TEXT.role, roleLabels);
  assert.notEqual(DEFAULT_UI_TEXT.repairStatus, repairStatusLabels);
  assert.notEqual(DEFAULT_UI_TEXT.exceptionStatus, exceptionStatusLabels);
});

// ─────────────────────────── 3. 저장된 문구가 있을 때

test("저장된 문구가 그 자리에만 얹히고 나머지는 기본값 그대로다", () => {
  const uiText = buildUiText(
    [
      { groupKey: "role", itemKey: "ADMIN", value: "운영자" },
      { groupKey: "repairStatus", itemKey: "IN_REPAIR", value: "작업 중" },
    ],
    []
  );

  assert.equal(uiText.role.ADMIN, "운영자");
  assert.equal(uiText.repairStatus.IN_REPAIR, "작업 중");
  assert.equal(uiText.role.SUPER_ADMIN, roleLabels.SUPER_ADMIN);
  assert.deepEqual(uiText.priority, DEFAULT_UI_TEXT.priority);
});

test("등록부에 없는 키와 검증을 통과하지 못하는 값은 조용히 흘려보낸다", () => {
  const uiText = buildUiText(
    [
      { groupKey: "role", itemKey: "NOT_A_ROLE", value: "없는 역할" },
      { groupKey: "notAGroup", itemKey: "ADMIN", value: "없는 묶음" },
      { groupKey: "role", itemKey: "SALES", value: "줄바꿈\n섞인 값" },
      { groupKey: "role", itemKey: "AS_ENGINEER", value: "   " },
    ],
    []
  );

  assert.deepEqual(uiText.role, DEFAULT_UI_TEXT.role);
});

test("유·무상 구분 행이 저장돼 있어도 화면 문구 표에는 나타나지 않는다", () => {
  const uiText = buildUiText([{ groupKey: "billingType", itemKey: "PAID", value: "돈 받음" }], []);

  assert.deepEqual(Object.keys(uiText).sort(), Object.keys(DEFAULT_UI_TEXT).sort());
  assert.ok(!Object.keys(uiText).includes("billingType"));
});

// ─────────────────────────── 4. 예외 상태 — DB 의 label 을 읽는다

test("DB 의 예외 상태 label 이 코드 표를 덮는다", () => {
  const uiText = buildUiText([], [{ code: "ON_HOLD", label: "잠시 멈춤" }]);

  assert.equal(uiText.exceptionStatus.ON_HOLD, "잠시 멈춤");
  // 행이 없는 코드는 코드 표의 기본값 그대로 — 되돌림용으로 남겨 둔 자리다.
  assert.equal(uiText.exceptionStatus.DISPOSED, exceptionStatusLabels.DISPOSED);
});

test("오늘 DB 에 든 9행은 코드 표와 같은 값이라 화면이 바뀌지 않는다", () => {
  const rowsAsStoredToday = EXCEPTION_STATUS_CODES.map((code) => ({
    code,
    label: exceptionStatusLabels[code],
  }));

  assert.deepEqual(buildUiText([], rowsAsStoredToday), DEFAULT_UI_TEXT);
});

test("모르는 예외 상태 코드와 못 쓸 label 은 흘려보낸다", () => {
  const uiText = buildUiText(
    [],
    [
      { code: "NOT_A_STATUS", label: "없는 상태" },
      { code: "PARTS_WAITING", label: "두 줄\n짜리" },
      { code: "FREE_RETURN", label: "   " },
    ]
  );

  assert.deepEqual(uiText.exceptionStatus, DEFAULT_UI_TEXT.exceptionStatus);
});

test("예외 상태 label 도 앞뒤 공백을 다듬고 연속 공백을 하나로 줄인다", () => {
  const uiText = buildUiText([], [{ code: "ON_HOLD", label: "  보류   중  " }]);

  assert.equal(uiText.exceptionStatus.ON_HOLD, "보류 중");
});
