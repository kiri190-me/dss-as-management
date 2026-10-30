import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS,
  APPROVAL_REJECTION_REASON_PREVIEW_LENGTH,
  NOTIFICATION_KINDS,
  QUOTE_APPROVAL_LABEL,
  REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS,
  approvalOutcomeNotificationWindowStart,
  buildApprovalGrantedNotification,
  buildApprovalNotification,
  buildApprovalRejectedNotification,
  buildQuoteApprovalNotification,
  buildRepairCaseDueDateNearNotification,
  countNotificationTargets,
  countNotificationTargetsByKind,
  isRepairCaseDueDateNear,
  isRepairCaseDueDateWithinNotificationWindow,
  isRepairCaseShipmentFinished,
  previewApprovalRejectionReason,
  repairCaseDueDateNotificationWindowEnd,
  type ApprovalOutcomeTarget,
  type NotificationItem,
} from "./notifications";
import { addCalendarDays, toKstDateOnly } from "./date-only";
import {
  DUE_DATE_FROM_DOMESTIC_ORDER_LABEL,
  resolveRepairCaseRequestedDueDate,
} from "./requested-due-date-link";
import { LABELS as APPROVAL_TYPE_LABELS } from "./local/workflow/shipment-approval-checklist";
import { quoteEditHref } from "./quote-new-link";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";
import { SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS } from "./shipment-approval-route";
import { checkNotificationAcknowledgementKey } from "./notification-acknowledgement";

test("결재 알림은 인수번호와 승인 종류 라벨을 내고, 검수/승인 화면으로 바로 링크한다", () => {
  const item = buildApprovalNotification({
    repairCaseId: "case-1",
    intakeNumber: "D9705-012",
    approvalType: "REPAIR_INSPECTION",
  });

  assert.equal(item.kind, "REPAIR_CASE_APPROVAL");
  assert.equal(item.subject, "D9705-012");
  assert.equal(item.detail, "수리 검수 승인");
  // 상세 첫 화면(`/repair-cases/case-1`)이 아니다 — 거기 내려놓으면 결재하려는
  // 사람이 "검수/승인" 탭을 한 번 더 눌러야 한다.
  assert.equal(item.href, "/repair-cases/case-1/approval");
  assert.equal(item.href, repairCaseDetailHrefs("case-1").approval, "주소는 탭 헬퍼와 같은 것을 써야 한다");
});

test("라벨은 새로 쓰지 않고 승인 체크리스트가 쓰는 것과 같은 문자열이어야 한다", () => {
  // 이 단정이 존재하는 이유: 문자열을 복사해 두면 상세 화면의 승인 카드와 종
  // 알림이 같은 결재를 서로 다른 이름으로 부르게 된다. 한쪽만 고쳐지는 순간
  // 여기서 깨져야 한다.
  for (const approvalType of ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const) {
    const item = buildApprovalNotification({
      repairCaseId: "case-1",
      intakeNumber: "D9705-012",
      approvalType,
    });
    assert.equal(item.detail, APPROVAL_TYPE_LABELS[approvalType]);
  }
});

test("같은 접수 건에 두 종류가 걸리면 알림은 두 줄이지만 id는 서로 다르다", () => {
  const inspection = buildApprovalNotification({
    repairCaseId: "case-1",
    intakeNumber: "D9705-012",
    approvalType: "REPAIR_INSPECTION",
  });
  const shipment = buildApprovalNotification({
    repairCaseId: "case-1",
    intakeNumber: "D9705-012",
    approvalType: "FINAL_SHIPMENT",
  });

  assert.notEqual(inspection.id, shipment.id, "React key가 겹치면 한 줄이 사라진다");
  assert.equal(inspection.targetKey, shipment.targetKey, "세는 단위는 접수 건 하나여야 한다");
});

test("개수는 대상 단위로 센다 — 한 건에 두 종류가 걸려도 1이다", () => {
  // 사이드바 배지(countRepairCasesPendingMyApproval)와 종 배지가 이 함수를
  // 함께 쓴다. 규칙이 바뀌면 두 숫자가 함께 바뀌어야 한다.
  assert.equal(countNotificationTargets([]), 0);
  assert.equal(countNotificationTargets(["case-1"]), 1);
  assert.equal(countNotificationTargets(["case-1", "case-1"]), 1);
  assert.equal(countNotificationTargets(["case-1", "case-2", "case-1"]), 2);
});

function approvalItem(repairCaseId: string, approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT"): NotificationItem {
  return buildApprovalNotification({ repairCaseId, intakeNumber: `IN-${repairCaseId}`, approvalType });
}

test("종류별 개수도 대상 단위로 세고, 알림이 없는 종류는 0으로 나온다", () => {
  const counts = countNotificationTargetsByKind([
    approvalItem("case-1", "REPAIR_INSPECTION"),
    approvalItem("case-1", "FINAL_SHIPMENT"),
    approvalItem("case-2", "REPAIR_INSPECTION"),
  ]);
  assert.equal(counts.REPAIR_CASE_APPROVAL, 2);

  const empty = countNotificationTargetsByKind([]);
  assert.equal(empty.REPAIR_CASE_APPROVAL, 0);
});

test("등록된 모든 종류가 개수 표에 키로 들어 있다", () => {
  // 종류를 추가하면서 이 표에 넣는 것을 잊으면, 그 종류만 가리키는 배지가
  // undefined를 읽게 된다.
  const counts = countNotificationTargetsByKind([]);
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(typeof counts[kind], "number", `${kind}가 개수 표에 없다`);
  }
});

test("등록된 알림 종류는 결재 요청·견적서 결재 대기·납기 임박·승인 완료·반려됨 다섯이다", () => {
  // 종류를 늘리는 것은 "누구에게 보여도 되는가"를 다시 판정해야 하는 일이라
  // 별도 작업으로 다룬다. 늘어난 것을 여기서 알아차리게 둔다 — 그래서 목록
  // 전체를 그대로 못 박는다(있는지만 보는 검사로 무르게 만들지 않는다).
  //
  // 🔴 CUSTOMER_REPAIR_REQUEST_NEW(「새 수리 의뢰」)는 2026-10-04 에 **뺐다** —
  // 고객이 의뢰를 넣던 길(고객사 전용 주소)이 없어져 그 알림이 뜰 수 없다.
  // 종류를 빼는 것도 늘리는 것과 같은 무게라 여기서 알아차리게 둔다. DB 는
  // 건드리지 않았다: 알림 설정은 kind_key 글자로 저장돼 있고, 코드에서 빠진
  // 종류의 행은 읽히지 않을 뿐이다(isNotificationKind 가 거른다).
  //
  // 🔴 재고 알림 셋(PART_REQUEST_PENDING · PART_STOCK_BELOW_MINIMUM ·
  // PART_ISSUE_APPROVAL_PENDING)은 2026-10-27(조각 13-C4)에 **뺐다.** 까닭이
  // 위와 다르다 — 뜰 수 없게 된 것이 아니라 **두 번 오기** 때문이다: 재고 기능이
  // 별도 시스템(dss-inventory)으로 옮겨 갔고 그쪽이 제 알림을 포털로 직접 보낸다.
  // 이쪽도 같은 방식으로 DB 를 건드리지 않았고, 남은 행을 치우는 SQL 은
  // NOTIFICATION_AND_IDENTITY_DESIGN.md 에 적어 두었다(포털 표 하나 포함).
  //
  // QUOTE_APPROVAL_PENDING 은 새 판정을 세우지 않고 **이미 있는 판정**을 그대로
  // 쓴다: 결재를 실제로 막는 decideQuoteApproval 과 같은 지정 관문
  // mayDecideAssignedApproval(그 단계에 지정된 사람과 최고관리자) —
  // queries/quote-approvals-pending.ts. 결재 요청과 같은 (가)형이라 역할로 거르지
  // 않는다(아래 레지스트리 시험이 그것을 못 박는다).
  //
  // APPROVAL_GRANTED·APPROVAL_REJECTED는 판정을 새로 세웠다: **요청자 본인**
  // (queries/approval-outcome-notifications.ts 의 `requested_by_user_id = 나`). 남의
  // 결재 결과를 요구할 입구가 없고, 역할로 거르지 않는 (가)형이다. 할 일이 아니라
  // 정보성이라 눌러서 확인하면 사라진다(domain/notification-acknowledgement.ts).
  //
  // REPAIR_CASE_DUE_DATE_NEAR 은 판정이 **아예 없다** — 2026-10-19 사용자 결정으로
  // 모든 역할이 받는다. 대상이 사람도 역할도 아니라 「지금 납기가 다가온 건」이라는
  // 상태뿐이고, 그것을 챙기는 일은 엔지니어·관리자·영업에게 각자 다른 모양으로
  // 걸려 가를 축이 없다. 좁히는 일은 알림 설정 화면의 역할 스위치가 한다.
  assert.deepEqual(
    [...NOTIFICATION_KINDS],
    [
      "REPAIR_CASE_APPROVAL",
      "QUOTE_APPROVAL_PENDING",
      "REPAIR_CASE_DUE_DATE_NEAR",
      "APPROVAL_GRANTED",
      "APPROVAL_REJECTED",
    ]
  );
});

// ──────────────────────────────────────────── 견적서 결재 대기 알림

const QUOTE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function quoteApprovalItem(overrides: Partial<Parameters<typeof buildQuoteApprovalNotification>[0]> = {}) {
  return buildQuoteApprovalNotification({
    quoteId: QUOTE_ID,
    quoteNumber: "Q-2609-001",
    routeStepOrder: 2,
    requestedByName: "박영업",
    ...overrides,
  });
}

test("견적서 결재 알림은 발행번호를 굵게, 결재선 단계와 요청자를 detail 에 내고, 그 견적서 화면으로 링크한다", () => {
  const item = quoteApprovalItem();
  assert.equal(item.kind, "QUOTE_APPROVAL_PENDING");
  assert.equal(item.id, `QUOTE_APPROVAL_PENDING:${QUOTE_ID}`);
  assert.equal(item.targetKey, QUOTE_ID, "한 장에 열린 요청은 하나라 견적서 단위로 센다");
  assert.equal(item.subject, "Q-2609-001");
  assert.equal(item.detail, "결재선 2단계 · 요청자 박영업");
  // 🔴 주소를 손으로 적지 않는다 — 목록이 한 줄을 열 때 쓰는 헬퍼와 같은 값이어야 한다.
  assert.equal(item.href, quoteEditHref({ quoteId: QUOTE_ID, repairCaseId: null }));
  assert.equal(item.href, `/quotes/${QUOTE_ID}`);
});

test("견적서 결재 알림의 detail 에는 종류 이름(「견적서 결재 대기」)을 다시 적지 않는다", () => {
  // 종류 이름은 종 패널이 이 줄 위에 따로 적는다 — 여기 또 적으면 잘리는 자리의
  // 폭만 먹는다(불출 승인 대기와 같은 갈림).
  assert.ok(!quoteApprovalItem().detail.includes("견적서"));
});

test("결재선을 타지 않는 행이면 단계 없이 요청자만 적는다", () => {
  assert.equal(quoteApprovalItem({ routeStepOrder: null }).detail, "요청자 박영업");
});

test("견적서가 여러 장이면 id 가 서로 달라 한 줄도 사라지지 않고, 배지는 견적서 단위로 센다", () => {
  const first = quoteApprovalItem({ quoteId: "quote-1" });
  const second = quoteApprovalItem({ quoteId: "quote-2" });
  assert.notEqual(first.id, second.id);
  assert.equal(countNotificationTargetsByKind([first, second]).QUOTE_APPROVAL_PENDING, 2);
});

test("🔴 같은 견적서의 같은 요청은 한 줄이다 — 알림이 불어나지 않는다", () => {
  // 사슬이 나아가도 열린 행은 한 장에 하나뿐이고(표의 부분 유니크), targetKey 가
  // 견적서 id 라 단계가 바뀌어도 배지는 1이다.
  const step1 = quoteApprovalItem({ routeStepOrder: 1 });
  const step2 = quoteApprovalItem({ routeStepOrder: 2 });
  assert.equal(step1.id, step2.id);
  assert.equal(countNotificationTargetsByKind([step1, step2]).QUOTE_APPROVAL_PENDING, 1);
});

test("🔴 결재 배지는 견적서 결재를 세지 않는다 — 종류별로 갈라 센다", () => {
  // 🔵 2026-10-27(13-C4)까지는 불출 승인 대기 한 줄이 더 끼어 있었다. 재는 것은
  //    「한 종류의 수가 남의 종류로 새지 않는가」이고, 종류 둘이면 그것이 선다.
  const counts = countNotificationTargetsByKind([
    approvalItem("case-1", "REPAIR_INSPECTION"),
    quoteApprovalItem(),
  ]);
  assert.equal(counts.REPAIR_CASE_APPROVAL, 1);
  assert.equal(counts.QUOTE_APPROVAL_PENDING, 1);
});

// ───────────────────── 레지스트리 — 결재 대기 종류는 역할로 거르지 않는다

/**
 * 레지스트리(db/queries/notifications.ts)는 server-only 와 DB 를 끌고 들어와 단위
 * 시험에서 부를 수 없다. 그래서 **소스를 읽어** 계약을 붙잡는다. 실제로 누구에게
 * 가는지는 queries/quote-approvals-notifications.integration.test.ts 가
 * listMyNotifications 를 그대로 태워 본다.
 */
const registrySource = readFileSync(new URL("../db/queries/notifications.ts", import.meta.url), "utf8");

/** 레지스트리 배열에서 그 종류의 `{ kind, load }` 한 덩어리. 다음 종류나 배열 끝에서 자른다. */
function registryBlockFor(kind: string): string {
  const start = registrySource.indexOf(`kind: "${kind}",`);
  assert.ok(start >= 0, `레지스트리에 ${kind} 가 없다`);
  const arrayEnd = registrySource.indexOf("\n];", start);
  assert.ok(arrayEnd > start, "레지스트리 배열의 끝을 찾지 못했다");
  const nextKind = registrySource.indexOf('kind: "', start + 1);
  const end = nextKind >= 0 && nextKind < arrayEnd ? nextKind : arrayEnd;
  return registrySource.slice(start, end);
}

/**
 * 🔴 **자르기가 정말 그 덩어리 하나를 집었는가** — 「없다」를 재는 단언 앞에 반드시
 * 둔다. 자르는 경계가 틀려 빈 문자열이 나와도 `!block.includes(...)` 는 초록색으로
 * 남기 때문이다.
 *
 * 2026-10-27(13-C4)까지 이 자리를 지키던 것은 **(나)형 대조**였다 — 같은 방법으로
 * 자른 부품 요청 대기 덩어리에는 `actorRole` 이 실제로 들어 있어야 한다는 단언.
 * 역할로 거르는 종류가 하나도 안 남아 그 대조를 쓸 수 없게 됐고, 대신 **덩어리가
 * 제 조회를 담고 남의 조회는 안 담는다**를 본다(경계가 앞뒤로 새면 둘 중 하나가 깨진다).
 */
function assertRegistryBlockIsolated(kind: string, ownCall: string, otherCall: string): string {
  const block = registryBlockFor(kind);
  assert.ok(block.includes(ownCall), `${kind} 덩어리에 제 조회(${ownCall})가 없다 — 자르기가 틀렸다`);
  assert.ok(!block.includes(otherCall), `${kind} 덩어리가 남의 조회(${otherCall})까지 삼켰다 — 자르기가 틀렸다`);
  return block;
}

test("🔴 견적서 결재 대기는 역할로 거르지 않는다 — 결재 요청과 같은 (가)형이다", () => {
  const block = assertRegistryBlockIsolated(
    "QUOTE_APPROVAL_PENDING",
    "listQuoteApprovalsPendingMyApproval(actorUserId)",
    "listRepairCasesPendingMyApproval("
  );

  // load 가 역할을 **받지도** 않는다. 결재선에는 역할 제한 없이 누구든 올라가므로
  // 역할을 보는 순간 자기 차례인 결재자가 알림을 못 받는다.
  assert.match(block, /load:\s*async\s*\(\s*actorUserId\s*\)\s*=>/, "load 가 사용자 id 하나만 받아야 한다");
  assert.ok(!block.includes("actorRole"), "견적서 결재 대기 load 가 역할을 본다");
  assert.ok(!/canReceive\w*\(/.test(block), "견적서 결재 대기 load 가 역할 판정 함수를 부른다");
});

test("🔴 결재 요청도 역할로 거르지 않는다 — 누가 결재자인지는 조회가 정한다", () => {
  const block = assertRegistryBlockIsolated(
    "REPAIR_CASE_APPROVAL",
    "listRepairCasesPendingMyApproval(actorUserId)",
    "listQuoteApprovalsPendingMyApproval("
  );
  assert.match(block, /load:\s*async\s*\(\s*actorUserId\s*\)\s*=>/, "load 가 사용자 id 하나만 받아야 한다");
  assert.ok(!block.includes("actorRole"), "결재 요청 load 가 역할을 본다");
  assert.ok(!/canReceive\w*\(/.test(block), "결재 요청 load 가 역할 판정 함수를 부른다");
});

test("🔴 재고 알림 셋은 레지스트리에서 사라졌다 — 들어오면 포털에 두 번 뜬다", () => {
  // dss-inventory 가 제 알림을 포털로 직접 보낸다. A/S 가 같은 일을 또 올리면 종에
  // 두 줄이 선다. 빼는 것이 결정이었으므로(13-C4) 되살아나면 여기서 걸린다.
  for (const kind of ["PART_REQUEST_PENDING", "PART_STOCK_BELOW_MINIMUM", "PART_ISSUE_APPROVAL_PENDING"]) {
    assert.ok(!registrySource.includes(`kind: "${kind}",`), `${kind} 가 레지스트리에 다시 들어왔다`);
  }
  // 재고 조회를 다시 부르는 길도 함께 막는다 — 종류만 빼고 import 가 남으면 13-C5 가
  // 그 파일을 지울 때 레지스트리가 깨진다.
  assert.ok(!registrySource.includes("inventory-part-requests"), "재고 부품 요청 조회를 다시 부른다");
  assert.ok(!registrySource.includes("inventory-part-issue-requests"), "재고 불출 조회를 다시 부른다");
  assert.ok(!registrySource.includes("part-minimum-quantities"), "한계수량 조회를 다시 부른다");
});

test("🔴 견적서 결재 대기는 판정을 새로 적지 않고 지정 관문을 쓰는 조회를 부른다", () => {
  // 알림에는 뜨는데 눌러도 거절되는(또는 그 반대의) 어긋남을 막는다 — 결재를 실제로
  // 막는 decideQuoteApproval 과 같은 mayDecideAssignedApproval 을 그 조회가 부른다.
  const block = registryBlockFor("QUOTE_APPROVAL_PENDING");
  assert.ok(block.includes("listQuoteApprovalsPendingMyApproval(actorUserId)"), "같은 조회를 부르지 않는다");
  assert.ok(block.includes("buildQuoteApprovalNotification("), "모양 변환은 도메인의 build 함수가 한다");
  assert.match(
    registrySource,
    /import \{[^}]*\blistQuoteApprovalsPendingMyApproval\b[^}]*\} from "\.\/quote-approvals-pending"/,
    "견적서 결재 대기 조회를 그 파일에서 가져오지 않는다"
  );
  const pendingSource = readFileSync(
    new URL("../db/queries/quote-approvals-pending.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    pendingSource.includes("mayDecideAssignedApproval("),
    "지정 관문을 부르지 않는다 — 판정이 두 벌이 된다"
  );
  // 🔴 처리된 건은 뜨지 않는다 — 후보가 아직 결정되지 않은 행뿐이다.
  assert.ok(pendingSource.includes('eq(quoteApprovals.status, "REQUESTED")'), "열린 요청으로 좁히지 않는다");
});

// ═══════════════════════════════ 납기 임박 — 고객 요청 납기일이 다가온 수리 건

/**
 * 시험이 쓰는 「지금」. **시각을 박아 넣는다** — 안 그러면 오늘이 며칠이냐에
 * 따라 통과·실패가 갈린다(결재 결과 조회가 `now` 를 옵션으로 받는 것과 같은
 * 이유: queries/approval-outcome-notifications.ts).
 *
 * UTC 03:00 = 한국 12:00 이라 한국 날짜가 2026-10-19 로 또렷하다. 날짜를
 * 손으로 적지 않고 toKstDateOnly/addCalendarDays 로 만드는 것은, 이 시험이
 * 「오늘을 어떻게 구하는가」까지 함께 보기 위해서다.
 */
const DUE_NOW = new Date("2026-10-19T03:00:00Z");
const TODAY_KST = toKstDateOnly(DUE_NOW);
const daysFromToday = (days: number) => addCalendarDays(TODAY_KST, days);

test("창은 7일이고, 상수 하나가 그 숫자를 쥔다 — 마지막 날은 오늘 + 7일이다", () => {
  assert.equal(REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS, 7);
  assert.equal(TODAY_KST, "2026-10-19", "기준 시각의 한국 날짜가 바뀌면 아래 단언의 뜻이 달라진다");
  assert.equal(repairCaseDueDateNotificationWindowEnd(DUE_NOW), "2026-10-26");
  assert.equal(
    repairCaseDueDateNotificationWindowEnd(DUE_NOW),
    daysFromToday(REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS),
    "창의 마지막 날이 상수에서 오지 않는다"
  );
});

test("🔴 납기일이 오늘 + 3일이면 뜬다", () => {
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(daysFromToday(3), DUE_NOW), true);
});

test("🔴 납기일이 오늘 + 8일이면 안 뜬다 — 창 밖이다", () => {
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(daysFromToday(8), DUE_NOW), false);
  // 경계 바로 앞은 뜬다. 이 짝이 없으면 창이 통째로 닫혀 있어도 위 단언은 통과한다.
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(daysFromToday(7), DUE_NOW), true);
});

test("오늘이 납기면 뜬다 — 창은 오늘을 포함한다", () => {
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(TODAY_KST, DUE_NOW), true);
});

test("🔴 이미 지난 납기는 안 뜬다 — 이번 알림의 범위 밖이다(지연은 isRepairCaseOverdue 가 따로 본다)", () => {
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(daysFromToday(-1), DUE_NOW), false);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow("2020-01-01", DUE_NOW), false);
});

test("🔴 납기일이 미기재면 안 뜬다", () => {
  // 2026-10-19 사용자 결정 — 「납기일 미기재 시 알림 없음」.
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(null, DUE_NOW), false);

  // 실제로 쓰이는 모양 그대로: 양쪽 어디에도 날짜가 없으면 그 함수가 null 을
  // 주고, 그 null 이 그대로 창 판정에 들어간다.
  const resolved = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: [],
  });
  assert.equal(resolved.dueDate, null);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(resolved.dueDate, DUE_NOW), false);
});

test("🔴 수리 건 칸은 비었지만 내자에서 빌려 온 날짜가 창 안이면 뜬다", () => {
  // 사용자 결정의 핵심이다 — 화면(상세정보)이 이미 그 날짜를 그리고 있으므로,
  // 화면에는 날짜가 보이는데 알림만 안 뜨는 일이 없어야 한다.
  const resolved = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: [daysFromToday(3), daysFromToday(20)],
  });
  assert.equal(resolved.dueDate, daysFromToday(3), "내자 날짜 중 가장 이른 하루를 빌려 온다");
  assert.equal(resolved.borrowed, true);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(resolved.dueDate, DUE_NOW), true);
});

test("수리 건 칸이 공백뿐이어도 내자에서 빌려 온다 — 화면과 같은 접기(foldBlankToNull)", () => {
  const resolved = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: "   ",
    domesticOrderDueDates: [daysFromToday(2)],
  });
  assert.equal(resolved.borrowed, true);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(resolved.dueDate, DUE_NOW), true);
});

test("빌려 온 날짜가 창 밖이면 안 뜬다 — 빌려 왔다는 사실이 창을 넓히지 않는다", () => {
  const resolved = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: [daysFromToday(30)],
  });
  assert.equal(resolved.borrowed, true);
  assert.equal(isRepairCaseDueDateWithinNotificationWindow(resolved.dueDate, DUE_NOW), false);
});

test("🔴 오늘은 한국 날짜다 — UTC 로 재면 하루가 밀린다", () => {
  // 한국 10/20 00:30(=UTC 10/19 15:30). UTC 날짜는 아직 10/19 라, UTC 로 재는
  // 구현에서는 10/27 이 아직 창 안으로 보인다.
  const justAfterKstMidnight = new Date("2026-10-19T15:30:00Z");
  assert.equal(toKstDateOnly(justAfterKstMidnight), "2026-10-20");
  assert.equal(repairCaseDueDateNotificationWindowEnd(justAfterKstMidnight), "2026-10-27");
  assert.equal(isRepairCaseDueDateWithinNotificationWindow("2026-10-27", justAfterKstMidnight), true);
  assert.equal(
    isRepairCaseDueDateWithinNotificationWindow("2026-10-19", justAfterKstMidnight),
    false,
    "한국에서는 어제인 날짜가 아직 창 안이다 — UTC 로 재고 있다"
  );
});

test("🔴 이미 나간 건은 뺀다 — 출하 완료 상태이거나 출하일이 찍혀 있다", () => {
  // 「납기 지연」을 가리는 isRepairCaseOverdue 가 보는 바로 그 두 사실이다.
  // 상태 하나에만 기대면, 출하일은 찍혀 있는데 단계가 따라가지 못한 건에
  // 「납기 임박」이 붙는 모순된 종이 된다.
  assert.equal(
    isRepairCaseShipmentFinished({ status: "SHIPMENT_COMPLETED", actualShipmentDate: null }),
    true
  );
  assert.equal(
    isRepairCaseShipmentFinished({ status: "WAITING_SHIPMENT", actualShipmentDate: "2026-10-18" }),
    true,
    "출하일이 찍힌 건은 단계가 뒤처져 있어도 이미 나간 것이다"
  );
  assert.equal(isRepairCaseShipmentFinished({ status: "IN_REPAIR", actualShipmentDate: null }), false);
  // 평탄화 상태가 비어 있는 단계가 아직 있다(workflow_steps.repair_status 는
  // nullable). 그런 건은 「아직 안 나갔다」로 둔다 — 조용히 빠지는 쪽이 나쁘다.
  assert.equal(isRepairCaseShipmentFinished({ status: null, actualShipmentDate: null }), false);
});

// ──────────── 배지·글자색이 쓰는 한 함수 — 종과 **같은 세 함수**를 묶기만 한다

/**
 * 2026-10-19 사용자 요구로 같은 사실을 종 말고도 세 자리에서 그린다(전체 A/S
 * 현황 표·카드 배지 · 상세 머리 줄 배지 · 네 목록과 상세의 날짜 글자색). 아래
 * 시험들이 지키는 것은 **그 자리들이 종과 같은 말을 하는가** 하나다.
 */
function nearingRow(overrides: Partial<Parameters<typeof isRepairCaseDueDateNear>[0]> = {}) {
  return {
    customerRequestedDueDate: daysFromToday(3),
    domesticOrderDueDates: [] as readonly string[],
    status: "IN_REPAIR" as const,
    actualShipmentDate: null as string | null,
    ...overrides,
  };
}

test("🔴 배지 판정은 종 알림과 **같은 함수**로 선다 — 조건을 새로 적지 않았다", () => {
  // ① 글자로 — 세 함수를 그대로 부르는가. 하나라도 빠지면 그 자리에서 규칙이
  //    한 벌 더 생긴 것이다(조회 쪽을 같은 방법으로 지키는 시험이 아래에 있다).
  const source = readFileSync(new URL("./notifications.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function isRepairCaseDueDateNear"));
  assert.ok(
    body.includes("resolveRepairCaseRequestedDueDate("),
    "화면이 쓰는 날짜 함수를 부르지 않는다 — 빌려 온 날짜를 못 본다"
  );
  assert.ok(
    body.includes("isRepairCaseDueDateWithinNotificationWindow("),
    "창 판정을 종과 같은 함수로 하지 않는다 — 표와 종이 다른 날 울린다"
  );
  assert.ok(
    body.includes("isRepairCaseShipmentFinished("),
    "이미 나간 건을 빼는 판정을 종과 같은 함수로 하지 않는다"
  );

  // ② 값으로 — 창의 경계에서 종의 판정과 **한 날도 어긋나지 않는다**. 글자 검사만
  //    두면 세 함수를 부르면서 결과를 뒤집어 쓰는 구현도 통과한다.
  for (const days of [-1, 0, 3, 7, 8, 30]) {
    const dueDate = daysFromToday(days);
    assert.equal(
      isRepairCaseDueDateNear(nearingRow({ customerRequestedDueDate: dueDate }), DUE_NOW),
      isRepairCaseDueDateWithinNotificationWindow(dueDate, DUE_NOW),
      `오늘 + ${days}일에서 배지와 종이 다른 말을 한다`
    );
  }
});

test("🔴 출하가 끝난 건에는 배지가 붙지 않는다 — 날짜가 창 안이어도", () => {
  // 종 알림 조회가 isRepairCaseShipmentFinished 로 빼고 있다. 배지가 안 빼면
  // 이미 나간 건에 「납기 임박」이 서서, 종에는 없는 경보가 표에만 뜬다.
  assert.equal(
    isRepairCaseDueDateNear(nearingRow(), DUE_NOW),
    true,
    "이 표본은 출하만 빼면 임박이어야 한다 — 아니면 아래 둘이 거짓인 까닭을 못 가린다"
  );
  assert.equal(
    isRepairCaseDueDateNear(nearingRow({ status: "SHIPMENT_COMPLETED" }), DUE_NOW),
    false,
    "출하 완료 상태인데 배지가 붙는다"
  );
  assert.equal(
    isRepairCaseDueDateNear(
      nearingRow({ status: "WAITING_SHIPMENT", actualShipmentDate: daysFromToday(-2) }),
      DUE_NOW
    ),
    false,
    "출하일이 찍힌 건은 단계가 뒤처져 있어도 이미 나간 것이다"
  );
});

test("🔴 수리 건 칸이 비면 내자에서 빌려 온 날짜로 배지를 단다 — 상세정보에 보이는 그 날짜다", () => {
  assert.equal(
    isRepairCaseDueDateNear(
      nearingRow({
        customerRequestedDueDate: null,
        domesticOrderDueDates: [daysFromToday(3), daysFromToday(20)],
      }),
      DUE_NOW
    ),
    true,
    "빌려 온 날짜를 안 본다 — 화면에는 날짜가 보이는데 배지만 없는 건이 생긴다"
  );
  // 빌려 왔다는 사실이 창을 넓히지는 않는다.
  assert.equal(
    isRepairCaseDueDateNear(
      nearingRow({ customerRequestedDueDate: null, domesticOrderDueDates: [daysFromToday(30)] }),
      DUE_NOW
    ),
    false
  );
  // 양쪽 어디에도 날짜가 없으면 붙지 않는다(미기재는 거짓이다).
  assert.equal(
    isRepairCaseDueDateNear(
      nearingRow({ customerRequestedDueDate: null, domesticOrderDueDates: [] }),
      DUE_NOW
    ),
    false
  );
});

test("납기 임박 알림은 인수번호를 굵게, 날짜를 detail 에 내고, 상세 첫 화면으로 링크한다", () => {
  const item = buildRepairCaseDueDateNearNotification({
    repairCaseId: "case-due-1",
    intakeNumber: "D261012",
    dueDate: "2026-10-22",
    borrowed: false,
  });

  assert.equal(item.kind, "REPAIR_CASE_DUE_DATE_NEAR");
  assert.equal(item.id, "REPAIR_CASE_DUE_DATE_NEAR:case-due-1");
  assert.equal(item.targetKey, "case-due-1");
  assert.equal(item.subject, "D261012");
  // 종류 이름(「납기 임박」)은 종 패널이 이 줄 위에 따로 적는다 — 여기 또 적으면
  // 잘리는 자리의 폭만 먹는다(다른 종류들과 같은 갈림).
  assert.equal(item.detail, "2026-10-22");
  assert.equal(item.href, "/repair-cases/case-due-1");
  assert.equal(
    item.href,
    repairCaseDetailHrefs("case-due-1").root,
    "주소는 탭 헬퍼와 같은 것을 써야 한다"
  );
});

test("🔴 빌려 온 날짜에는 표시가 붙는다 — 상세정보 화면이 쓰는 그 글자 그대로", () => {
  const borrowed = buildRepairCaseDueDateNearNotification({
    repairCaseId: "case-due-2",
    intakeNumber: "D261013",
    dueDate: "2026-10-22",
    borrowed: true,
  });
  assert.equal(borrowed.detail, `2026-10-22 · ${DUE_DATE_FROM_DOMESTIC_ORDER_LABEL}`);
  // 글자를 새로 쓰면 같은 것을 두 말로 부르게 된다. 한쪽만 고쳐지면 여기서 깨져야 한다.
  // 🔵 2026-10-30 에 「내자 납기요청일」에서 바꿨다 — 상수 한 곳을 고쳤고 이 줄이
  //    그것을 따라왔다(그래서 이 장치가 제 일을 한 것이다. 깨지는 것이 맞았다).
  assert.ok(borrowed.detail.includes("내자 정리에서 작성됨"), borrowed.detail);
});

test("납기 임박은 접수 건 단위로 센다 — 결재 배지를 건드리지 않는다", () => {
  const items: NotificationItem[] = [
    buildRepairCaseDueDateNearNotification({
      repairCaseId: "case-a",
      intakeNumber: "D261001",
      dueDate: "2026-10-22",
      borrowed: false,
    }),
    buildRepairCaseDueDateNearNotification({
      repairCaseId: "case-b",
      intakeNumber: "D261002",
      dueDate: "2026-10-23",
      borrowed: true,
    }),
    buildApprovalNotification({
      repairCaseId: "case-a",
      intakeNumber: "D261001",
      approvalType: "REPAIR_INSPECTION",
    }),
  ];

  const counts = countNotificationTargetsByKind(items);
  assert.equal(counts.REPAIR_CASE_DUE_DATE_NEAR, 2);
  assert.equal(counts.REPAIR_CASE_APPROVAL, 1, "같은 접수 건이어도 결재 배지는 결재만 센다");
});

test("🔴 납기 임박은 눌러서 확인하는 종류가 아니다 — 처리하지 않은 일을 숨기는 길을 만들지 않는다", () => {
  const item = buildRepairCaseDueDateNearNotification({
    repairCaseId: "case-due-3",
    intakeNumber: "D261014",
    dueDate: "2026-10-22",
    borrowed: false,
  });
  const check = checkNotificationAcknowledgementKey(item.id);
  assert.equal(check.ok, false, "확인 기록에 적을 수 있는 키가 되어 버렸다");
});

// ─────────────────────── 레지스트리 — 납기 임박은 아무도 거르지 않는다 (다)형

test("🔴 납기 임박 load 는 사용자도 역할도 받지 않는다 — 모두에게 간다", () => {
  // 자르기가 제 덩어리 하나를 집었는지 먼저 본다(assertRegistryBlockIsolated 주석).
  const block = assertRegistryBlockIsolated(
    "REPAIR_CASE_DUE_DATE_NEAR",
    "listRepairCasesWithDueDateNear()",
    "listQuoteApprovalsPendingMyApproval("
  );
  assert.match(block, /load:\s*async\s*\(\s*\)\s*=>/, "load 가 인자를 받는다");
  assert.ok(!block.includes("actorRole"), "납기 임박 load 가 역할을 본다");
  assert.ok(!/canReceive\w*\(/.test(block), "납기 임박 load 가 역할 판정 함수를 부른다");
});

test("🔴 납기 임박은 판정을 새로 적지 않고 전용 조회 하나를 부른다", () => {
  const block = registryBlockFor("REPAIR_CASE_DUE_DATE_NEAR");
  assert.ok(block.includes("listRepairCasesWithDueDateNear()"), "전용 조회를 부르지 않는다");
  assert.ok(block.includes("buildRepairCaseDueDateNearNotification("), "모양 변환은 도메인의 build 함수가 한다");
  assert.match(
    registrySource,
    /import \{[^}]*\blistRepairCasesWithDueDateNear\b[^}]*\} from "\.\/repair-case-due-date-notifications"/,
    "납기 임박 조회를 그 파일에서 가져오지 않는다"
  );

  // 🔴 조회가 날짜 규칙을 베껴 적지 않고 화면이 쓰는 그 함수를 부른다. 베껴
  // 적으면 상세정보 화면과 조용히 어긋나고, 그때 「화면엔 보이는데 알림은 안
  // 뜨는」 건이 생긴다 — 이번 작업이 막으려던 바로 그 실패다.
  const dueDateSource = readFileSync(
    new URL("../db/queries/repair-case-due-date-notifications.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    dueDateSource.includes("resolveRepairCaseRequestedDueDate("),
    "화면이 쓰는 날짜 함수를 부르지 않는다 — 규칙이 두 벌이 된다"
  );
  // 🔴 그 함수에 **내자 날짜를 실제로 넘긴다.** 빈 배열을 넘기면 함수는 그대로
  // 불리는데 빌려 오기만 조용히 꺼진다 — 사용자 결정의 핵심이 사라지는 자리이고,
  // 위 단언만으로는 초록색으로 남는다. DB 없이 붙잡을 수 있는 것은 여기까지다.
  assert.ok(
    dueDateSource.includes("domesticOrderDueDates: dueDatesByCaseId.get(row.id)"),
    "수리 건 칸이 비었을 때 내자에서 빌려 올 날짜를 넘기지 않는다"
  );
  assert.ok(
    dueDateSource.includes("isRepairCaseDueDateWithinNotificationWindow("),
    "창 판정을 도메인에서 가져오지 않는다 — 규칙이 두 벌이 된다"
  );
  assert.ok(
    dueDateSource.includes("isRepairCaseShipmentFinished("),
    "이미 나간 건을 빼는 판정을 도메인에서 가져오지 않는다"
  );
  assert.ok(
    dueDateSource.includes("eq(repairCases.isDeleted, false)"),
    "휴지통에 든 건을 빼지 않는다"
  );
  // 🔵 날짜를 모아 오는 조각은 2026-10-19 에 공용으로 옮겼다 — 목록 둘(전체 A/S
  // 현황 · 내 작업)이 같은 것을 쓰게 됐기 때문이다. 여기서는 **그 조각을 쓰는가**
  // 만 본다. 베껴 적은 SQL 을 따로 들고 있으면 한쪽만 고쳐지는 날 같은 건이
  // 화면마다 다른 날짜로 보인다(그 어긋남이 이번 결함이었다).
  assert.match(
    dueDateSource,
    /from "\.\/repair-case-domestic-order-due-dates"/,
    "내자 날짜를 모으는 공용 조각을 쓰지 않는다 — 규칙이 두 벌이 된다"
  );
  // 지운 발주 줄에 붙어 있던 날짜가 알림을 만들어 내면 안 된다(주간보고와 같은 규칙).
  // 그 조건은 이제 그 공용 조각이 갖는다.
  const sharedDueDateSource = readFileSync(
    new URL("../db/queries/repair-case-domestic-order-due-dates.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    sharedDueDateSource.includes("eq(domesticOrders.isDeleted, false)"),
    "지워진 내자 줄의 날짜까지 빌려 온다"
  );
});

// ═════════════════════════════════════ 결재 결과 — 승인 완료 · 반려됨

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const CASE_APPROVAL_ID = "22222222-2222-4222-8222-222222222222";

function caseTarget(approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT" = "FINAL_SHIPMENT"): ApprovalOutcomeTarget {
  return {
    source: "REPAIR_CASE",
    approvalId: CASE_APPROVAL_ID,
    repairCaseId: CASE_ID,
    intakeNumber: "D2609012",
    approvalType,
  };
}

const QUOTE_APPROVAL_ID = "66666666-6666-4666-8666-666666666666";

function quoteTarget(overrides: Partial<Extract<ApprovalOutcomeTarget, { source: "QUOTE" }>> = {}): ApprovalOutcomeTarget {
  return {
    source: "QUOTE",
    approvalId: QUOTE_APPROVAL_ID,
    quoteId: QUOTE_ID,
    quoteNumber: "Q-2609-001",
    ...overrides,
  };
}

test("견적서 결재의 이름은 용도 이름표 그대로다 — 「승인」을 덧붙이지 않는다", () => {
  assert.equal(QUOTE_APPROVAL_LABEL, "견적서 승인");
  assert.equal(QUOTE_APPROVAL_LABEL, SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.QUOTE);
  assert.ok(!QUOTE_APPROVAL_LABEL.includes("승인 승인"));
});

test("승인 완료(견적서) — 발행번호를 굵게, 결재 이름·결정자를 detail 에, 그 견적서 화면으로 링크한다", () => {
  const item = buildApprovalGrantedNotification({ ...quoteTarget(), decidedByName: "김결재" });
  assert.equal(item.kind, "APPROVAL_GRANTED");
  assert.equal(item.id, `APPROVAL_GRANTED:qa:${QUOTE_APPROVAL_ID}`);
  assert.equal(item.targetKey, item.id, "사건 하나가 한 건이다");
  assert.equal(item.subject, "Q-2609-001");
  assert.equal(item.detail, "견적서 승인 · 김결재");
  assert.equal(item.href, quoteEditHref({ quoteId: QUOTE_ID, repairCaseId: null }));
});

test("반려됨(견적서) — 사유를 detail 에 적고, 고쳐서 다시 올리는 그 견적서 화면으로 링크한다", () => {
  const item = buildApprovalRejectedNotification({ ...quoteTarget(), decisionReason: "단가 근거 누락" });
  assert.equal(item.kind, "APPROVAL_REJECTED");
  assert.equal(item.id, `APPROVAL_REJECTED:qa:${QUOTE_APPROVAL_ID}`);
  assert.equal(item.subject, "Q-2609-001");
  assert.equal(item.detail, "견적서 승인 · 사유: 단가 근거 누락");
  assert.equal(item.href, quoteEditHref({ quoteId: QUOTE_ID, repairCaseId: null }));
});

test("두 표의 결재 행 id 가 우연히 같아도 결과 알림의 키는 겹치지 않는다", () => {
  const sameId = "77777777-7777-4777-8777-777777777777";
  const keys = [
    buildApprovalGrantedNotification({ ...caseTarget(), approvalId: sameId, decidedByName: "a" }).id,
    buildApprovalGrantedNotification({ ...quoteTarget(), approvalId: sameId, decidedByName: "a" }).id,
  ];
  assert.equal(new Set(keys).size, keys.length, keys.join(" / "));
});

test("🔴 빠진 표 딱지 `pia` 를 다시 쓰지 않는다 — 운영에 그 글자로 적힌 확인 기록이 남아 있다", () => {
  // 부품 불출 갈래는 2026-10-27(13-C4)에 사라졌지만, notification_acknowledgements 에는
  // `APPROVAL_GRANTED:pia:<uuid>` 로 눌러 둔 과거 행이 남아 있을 수 있다. 새 표에 그
  // 글자를 물려주면 남이 눌러 둔 기록이 엉뚱한 알림을 미리 지운다(오류는 한 번도 안 난다).
  const sameId = "77777777-7777-4777-8777-777777777777";
  for (const item of [
    buildApprovalGrantedNotification({ ...caseTarget(), approvalId: sameId, decidedByName: "a" }),
    buildApprovalGrantedNotification({ ...quoteTarget(), approvalId: sameId, decidedByName: "a" }),
    buildApprovalRejectedNotification({ ...caseTarget(), approvalId: sameId, decisionReason: "x" }),
    buildApprovalRejectedNotification({ ...quoteTarget(), approvalId: sameId, decisionReason: "x" }),
  ]) {
    assert.ok(!item.id.includes(":pia:"), `빠진 딱지를 다시 쓴다: ${item.id}`);
  }
});

test("창은 7일이고 결정 시각으로 잰다 — 시작 시각은 지금에서 정확히 7일 전이다", () => {
  assert.equal(APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS, 7);
  const now = new Date("2026-09-11T12:00:00.000Z");
  assert.equal(approvalOutcomeNotificationWindowStart(now).toISOString(), "2026-09-04T12:00:00.000Z");
});

test("승인 완료(검수·출하) — 인수번호를 굵게, 결재 이름·결정자를 detail 에, 검수/승인 화면으로 링크한다", () => {
  for (const approvalType of ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const) {
    const item = buildApprovalGrantedNotification({ ...caseTarget(approvalType), decidedByName: "김결재" });
    assert.equal(item.kind, "APPROVAL_GRANTED");
    assert.equal(item.id, `APPROVAL_GRANTED:rca:${CASE_APPROVAL_ID}`);
    assert.equal(item.targetKey, item.id, "사건 하나가 한 건이다 — 접수 건으로 묶지 않는다");
    assert.equal(item.subject, "D2609012");
    assert.equal(item.detail, `${APPROVAL_TYPE_LABELS[approvalType]} · 김결재`);
    assert.ok(!item.detail.includes("승인 완료"), "종류 이름은 패널이 윗줄에 따로 적는다");
    assert.equal(item.href, repairCaseDetailHrefs(CASE_ID).approval);
  }
});

test("반려됨(검수·출하) — 결재 이름·사유를 detail 에, 다시 올리는 검수/승인 화면으로 링크한다", () => {
  const item = buildApprovalRejectedNotification({ ...caseTarget("REPAIR_INSPECTION"), decisionReason: "사진 누락" });
  assert.equal(item.kind, "APPROVAL_REJECTED");
  assert.equal(item.id, `APPROVAL_REJECTED:rca:${CASE_APPROVAL_ID}`);
  assert.equal(item.targetKey, item.id);
  assert.equal(item.subject, "D2609012");
  assert.equal(item.detail, "수리 검수 승인 · 사유: 사진 누락");
  assert.ok(!item.detail.includes("반려됨"), "종류 이름은 패널이 윗줄에 따로 적는다");
  assert.equal(item.href, repairCaseDetailHrefs(CASE_ID).approval);
});

test("🔴 네 갈래가 모두 살아 있는 화면으로 간다 — 404 가 된 재고 주소를 쓰지 않는다", () => {
  // 🔴 2026-10-27(13-C4)에 실제로 틀려 있던 자리다: 불출 갈래의 href 셋
  // (`/inventory` · `/inventory/approvals` · `/inventory/requests`)이 13-A 에서 404 가
  // 됐는데 알림은 그대로 그리로 보내고 있었다. 갈래째 들어냈고, 남은 둘이 다시 그리로
  // 새지 않도록 여기서 못 박는다.
  const live = [
    buildApprovalGrantedNotification({ ...caseTarget(), decidedByName: "a" }),
    buildApprovalGrantedNotification({ ...quoteTarget(), decidedByName: "a" }),
    buildApprovalRejectedNotification({ ...caseTarget(), decisionReason: "x" }),
    buildApprovalRejectedNotification({ ...quoteTarget(), decisionReason: "x" }),
  ];
  assert.equal(live.length, 4, "두 표 × 승인·반려 네 갈래를 모두 봐야 한다");
  for (const item of live) {
    assert.ok(!item.href.startsWith("/inventory"), `죽은 재고 주소로 보낸다: ${item.href}`);
    assert.ok(item.href.startsWith("/repair-cases/") || item.href.startsWith("/quotes/"), item.href);
  }
});

test("반려 사유는 한 줄로 펴고, 길면 잘라 말줄임표를 붙인다 — 글자 단위로 자른다", () => {
  assert.equal(previewApprovalRejectionReason("  사진이\n빠졌습니다 \t 다시 올려 주세요 "), "사진이 빠졌습니다 다시 올려 주세요");

  const exact = "가".repeat(APPROVAL_REJECTION_REASON_PREVIEW_LENGTH);
  assert.equal(previewApprovalRejectionReason(exact), exact, "상한까지는 자르지 않는다");

  const long = "나".repeat(APPROVAL_REJECTION_REASON_PREVIEW_LENGTH + 5);
  const preview = previewApprovalRejectionReason(long);
  assert.ok(preview.endsWith("…"), "잘랐으면 말줄임표를 붙인다");
  assert.equal(Array.from(preview).length, APPROVAL_REJECTION_REASON_PREVIEW_LENGTH + 1);

  // 두 코드 단위짜리 글자를 반으로 가르지 않는다.
  const emoji = "😀".repeat(APPROVAL_REJECTION_REASON_PREVIEW_LENGTH + 1);
  const emojiPreview = previewApprovalRejectionReason(emoji);
  assert.equal(Array.from(emojiPreview).length, APPROVAL_REJECTION_REASON_PREVIEW_LENGTH + 1);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emojiPreview), "짝 잃은 서로게이트가 남았다");

  const item = buildApprovalRejectedNotification({ ...caseTarget(), decisionReason: long });
  assert.equal(item.detail, `최종 출하 승인 · 사유: ${preview}`);
});

test("반려 사유가 비어 있으면 「사유:」를 빈 채로 적지 않고 결재 이름만 적는다", () => {
  for (const decisionReason of [null, "", "   \n "]) {
    const item = buildApprovalRejectedNotification({ ...caseTarget(), decisionReason });
    assert.equal(item.detail, "최종 출하 승인", JSON.stringify(decisionReason));
  }
});

test("🔴 결재 결과 알림의 id 는 네 갈래 모두 확인 키 검증을 통과한다 — 눌러도 조용히 거절되지 않는다", () => {
  const items = [
    buildApprovalGrantedNotification({ ...caseTarget(), decidedByName: "김결재" }),
    buildApprovalGrantedNotification({ ...quoteTarget(), decidedByName: "김결재" }),
    buildApprovalRejectedNotification({ ...caseTarget(), decisionReason: "사유" }),
    buildApprovalRejectedNotification({ ...quoteTarget(), decisionReason: "사유" }),
  ];
  for (const item of items) {
    const checked = checkNotificationAcknowledgementKey(item.id);
    assert.equal(checked.ok, true, `거절됐다: ${item.id}`);
    if (checked.ok) {
      assert.equal(checked.key, item.id);
      assert.equal(checked.kind, item.kind);
    }
  }
  assert.equal(new Set(items.map((item) => item.id)).size, items.length, "네 갈래의 id 가 서로 겹친다");
});

test("같은 행 id 여도 두 표(접수 건 결재·견적서 결재)의 키는 겹치지 않는다", () => {
  const sameId = "55555555-5555-4555-8555-555555555555";
  const fromCase = buildApprovalGrantedNotification({ ...caseTarget(), approvalId: sameId, decidedByName: "a" });
  const fromQuote = buildApprovalGrantedNotification({ ...quoteTarget(), approvalId: sameId, decidedByName: "a" });
  assert.notEqual(fromCase.id, fromQuote.id);
});

test("결재 결과는 사건 단위로 센다 — 같은 접수 건의 검수·출하 승인 완료는 배지에 2다", () => {
  const counts = countNotificationTargetsByKind([
    buildApprovalGrantedNotification({ ...caseTarget("REPAIR_INSPECTION"), approvalId: "a-1", decidedByName: "a" }),
    buildApprovalGrantedNotification({ ...caseTarget("FINAL_SHIPMENT"), approvalId: "a-2", decidedByName: "a" }),
  ]);
  assert.equal(counts.APPROVAL_GRANTED, 2, "하나를 확인해도 다른 하나는 남아야 하는 두 사건이다");
  assert.equal(counts.REPAIR_CASE_APPROVAL, 0, "사이드바 결재 배지는 결재 결과를 세지 않는다");
});

// ─────────────────────── 레지스트리 — 결재 결과는 요청자 본인 · 확인한 것은 뺀다

for (const kind of ["APPROVAL_GRANTED", "APPROVAL_REJECTED"] as const) {
  test(`🔴 ${kind} 는 역할로 거르지 않고, 새 조회를 부른 뒤 확인한 키를 뺀다`, () => {
    const block = registryBlockFor(kind);
    assert.match(block, /load:\s*async\s*\(\s*actorUserId\s*\)\s*=>/, "load 가 사용자 id 하나만 받아야 한다");
    assert.ok(!block.includes("actorRole"), `${kind} load 가 역할을 본다`);
    assert.ok(!/canReceive\w*\(/.test(block), `${kind} load 가 역할 판정 함수를 부른다`);
    assert.match(block, /withoutAcknowledged\(\s*actorUserId,/, "확인한 키를 빼지 않는다");
    const query = kind === "APPROVAL_GRANTED" ? "listMyGrantedApprovalOutcomes" : "listMyRejectedApprovalOutcomes";
    const build = kind === "APPROVAL_GRANTED" ? "buildApprovalGrantedNotification(" : "buildApprovalRejectedNotification(";
    assert.ok(block.includes(`${query}(actorUserId)`), "결과 사건 조회를 요청자 id 로 부르지 않는다");
    assert.ok(block.includes(build), "모양 변환은 도메인의 build 함수가 한다");
  });
}

test("🔴 확인 기록은 결재 결과 두 종류의 load 에서만 대 본다 — 할 일 알림에는 대 보지 않는다", () => {
  for (const kind of NOTIFICATION_KINDS) {
    const block = registryBlockFor(kind);
    const usesAcknowledgements = block.includes("withoutAcknowledged(");
    assert.equal(
      usesAcknowledgements,
      kind === "APPROVAL_GRANTED" || kind === "APPROVAL_REJECTED",
      `${kind}: 확인 기록을 대 보는지가 기대와 다르다`
    );
  }
  // 확인 기록은 언제나 이 사람 것만 묻는다 — 사람 id 없이 키로만 묻는 호출이 없다.
  assert.match(
    registrySource,
    /listAcknowledgedNotificationKeys\(\s*actorUserId,/,
    "확인 기록 조회에 사람 id 를 넘기지 않는다"
  );
});
