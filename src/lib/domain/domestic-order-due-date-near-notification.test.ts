import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NOTIFICATION_KINDS,
  buildDomesticOrderApprovalNotification,
  buildDomesticOrderDueDateNearNotification,
  buildRepairCaseDueDateNearNotification,
  countNotificationTargetsByKind,
  isRepairCaseDueDateWithinNotificationWindow,
} from "./notifications";
import {
  ACKNOWLEDGEABLE_NOTIFICATION_KINDS,
  checkNotificationAcknowledgementKey,
  isAcknowledgeableNotificationKind,
} from "./notification-acknowledgement";
import {
  NOTIFICATION_KIND_META,
  NO_NOTIFICATION_SETTINGS,
  defaultNotificationKindEnabled,
  defaultRoleReceivesNotification,
  deliversNotification,
} from "./notification-settings";
import { DOMESTIC_ORDER_NO_MODEL_LINK_LABEL } from "./domestic-order-detail-link";
import { domesticOrderDetailHrefs } from "./domestic-order-detail-tabs";
import { domesticOrderDueDateRowLabel } from "./domestic-order-due-date-label";
import { ROLE_CODES } from "./types";

/**
 * ============================================================================
 * 「기타건 납기 임박」 — 종 알림의 계약 (2026-11-25)
 * ============================================================================
 * 사용자 결정: 「**기타건에도 납기 임박 알림이 적용되도록**」. [내자 정리]에 [납기일
 * 확정] 단추를 요청하는 과정에서 함께 정해졌다. 🔴 **이 조각은 「만들기」까지다** —
 * [납기일 확정]으로 이 알림을 **끄는 일**은 뒤 조각이고, 일부러 떼어 놓았다(합치면 새
 * 알림이 한 번도 안 뜬 채 바로 꺼져 「제대로 만들어졌는가」를 볼 길이 사라진다).
 *
 * 이 파일이 지키는 선이 일곱이다:
 *  1. 🔴 **창을 새로 짓지 않는다** — 「납기 임박」이 쓰는 그 도메인 함수
 *     (isRepairCaseDueDateWithinNotificationWindow)를 조회가 그대로 부른다. 베껴 적는
 *     순간 「임박」의 뜻이 둘로 갈린다.
 *  2. 🔴 **기본값 두 칸이 다 채워졌다.** 하나만 빠져도 default 절(false)로 떨어져
 *     「등록해 두고 한 줄도 안 뜨는」 종류가 된다 — 조용히 실패하는 자리다.
 *  3. 🔴 **이름이 그냥 「납기 임박」이 아니다.** 같으면 종 패널에 같은 이름 두 줄이
 *     서서 어느 것이 수리 건인지 알 수 없다.
 *  4. 🔴 **id 에 회차가 붙는다.** 안 붙이면 같은 줄의 두 회차가 글자가 같은 id 를
 *     갖고 종에서 하나로 뭉개진다. 🔴 **targetKey 에는 안 붙는다** — 세는 단위는 줄이다.
 *  5. 🔴 **주소가 기타건 상세 첫 탭으로 간다**(`/domestic-orders/{id}`). 접수 건
 *     헬퍼를 베끼면 404 이고, 그 실패는 **포털 화면에서만** 보인다.
 *  6. 🔴 **눌러서 확인하는 종류가 아니다** — 확인 키가 거절된다.
 *  7. 조회가 **DB 에 아무것도 안 쓰고**, `repair_case_id IS NULL` 로 좁히며, 끝난
 *     회차를 빼고, 창을 SQL 로 재지 않는다 — 글자로 잰다.
 *
 * 🔴 조회(db/queries/…)는 server-only 와 DB 를 끌고 들어와 단위 시험에서 부를 수
 * 없다. 그래서 이웃 넷이 쓰는 방법 그대로 **소스를 읽어** 계약을 붙잡는다. 조회가 진짜
 * DB 위에서 무엇을 내놓는지는 db 목록의 통합 시험이 따로 본다
 * (queries/domestic-order-due-date-near-notifications.integration.test.ts).
 * ============================================================================
 */

const KIND = "DOMESTIC_ORDER_DUE_DATE_NEAR";
const ORDER_ID = "77777777-7777-4777-8777-777777777777";
/** 🔴 가짜 품명이다 — 실제 고객사·모델명은 한 글자도 쓰지 않는다. */
const MODEL_NAME = "시험용 품명";

function nearItem(
  overrides: Partial<Parameters<typeof buildDomesticOrderDueDateNearNotification>[0]> = {}
) {
  return buildDomesticOrderDueDateNearNotification({
    domesticOrderId: ORDER_ID,
    modelName: MODEL_NAME,
    dueDate: "2094-10-22",
    dueDateRowOrder: 1,
    dueDateRowLabel: null,
    ...overrides,
  });
}

// ───────────────────────────────────────────── 등록

test("🔴 종류 목록에 등록돼 있다 — 없으면 이 파일의 나머지가 전부 뜻을 잃는다", () => {
  assert.ok(
    (NOTIFICATION_KINDS as readonly string[]).includes(KIND),
    "NOTIFICATION_KINDS 에 없다 — 레지스트리도 설정 화면도 이 종류를 모른다"
  );
});

test("🔴 **기본값 두 칸이 다 채워져 있다** — 하나만 빠져도 「등록해 두고 한 줄도 안 뜨는」 종류가 된다", () => {
  // 두 함수 모두 default 절이 false 다. 목록에만 넣고 case 를 빠뜨리면 아무 오류 없이
  // 조용히 꺼진 종류가 태어난다(db/queries/notifications.ts 머리말의 4·5).
  assert.equal(defaultNotificationKindEnabled(KIND), true, "종류가 꺼진 채로 태어난다");
  assert.ok(ROLE_CODES.length > 0, "역할 목록이 비었다 — 아래 반복이 아무것도 안 잰다");
  for (const role of ROLE_CODES) {
    assert.equal(
      defaultRoleReceivesNotification(KIND, role),
      true,
      `${role}: 역할 기본값이 default 절(false)로 떨어졌다`
    );
    assert.equal(deliversNotification(KIND, role, NO_NOTIFICATION_SETTINGS), true, role);
  }
});

test("🔴 받는 명단이 「납기 임박」과 **같다** — 같은 창을 다른 표에서 재는 짝이다", () => {
  // 답을 손으로 적지 않고 임박과 맞대어 본다(위 시험이 「전원」을 이미 값으로 못 박았다).
  // 둘 다 손으로 적어 두면 한쪽만 좁힌 날에도 둘 다 통과한다.
  for (const role of ROLE_CODES) {
    assert.equal(
      deliversNotification(KIND, role, NO_NOTIFICATION_SETTINGS),
      deliversNotification("REPAIR_CASE_DUE_DATE_NEAR", role, NO_NOTIFICATION_SETTINGS),
      `${role}: 기타건 납기 임박과 납기 임박의 전달 여부가 갈렸다`
    );
  }
});

// ───────────────────────────────────────────── 이름표

test("🔴 이름이 그냥 「납기 임박」이 아니다 — 같으면 종 패널에 같은 이름 두 줄이 선다", () => {
  const label = NOTIFICATION_KIND_META[KIND].label;
  assert.equal(label, "기타건 납기 임박");
  assert.notEqual(
    label,
    NOTIFICATION_KIND_META.REPAIR_CASE_DUE_DATE_NEAR.label,
    "수리 건 쪽과 이름이 같다 — 어느 줄이 수리 건인지 알 수 없다"
  );
  // 🔵 「기타건」이라는 말을 쓰는 것은 기타건 결재 대기가 이미 내린 판단이다.
  assert.ok(label.startsWith("기타건"), label);
  assert.ok(
    NOTIFICATION_KIND_META.DOMESTIC_ORDER_APPROVAL_PENDING.label.startsWith("기타건"),
    "기타건 결재 대기 쪽 이름이 바뀌었다 — 두 줄이 같은 말로 시작하지 않는다"
  );
});

test("설명이 창의 날짜 수·회차·사라지는 조건을 함께 적는다 — 관리자는 이 글만 읽는다", () => {
  const description = NOTIFICATION_KIND_META[KIND].description;
  assert.ok(description.includes("7일"), description);
  assert.ok(description.includes("회차"), description);
  assert.ok(description.includes("기타건"), description);
  assert.ok(description.includes("뜨지 않습니다"), description);
});

// ───────────────────────────────────────────── 알림 한 줄의 글자

test("알림 한 줄 — subject 는 품명, detail 은 그 날짜, href 는 기타건 상세 첫 탭", () => {
  const item = nearItem();

  assert.equal(item.kind, KIND);
  assert.equal(item.subject, MODEL_NAME);
  assert.equal(item.detail, "2094-10-22");
  // 🔴 주소를 글자로 적어 두지 않고 **탭 헬퍼가 내놓는 값과 맞대어** 본다. 접수 건
  //    헬퍼를 베끼면 `/repair-cases/{uuid}` 로 나가 404 이고, 그 실패는 포털
  //    화면에서만 보인다.
  assert.equal(item.href, domesticOrderDetailHrefs(ORDER_ID).root);
  assert.ok(item.href.startsWith("/domestic-orders/"), `기타건 상세로 가지 않는다: ${item.href}`);
  assert.ok(item.href.includes(ORDER_ID), "주소에 그 줄의 id 가 없다");
  // 🔴 결재 대기가 쓰는 [승인] 탭과 **다른 곳**이다 — 누른 사람이 할 일이 날짜 확인이다.
  assert.notEqual(
    item.href,
    domesticOrderDetailHrefs(ORDER_ID).approval,
    "승인 탭으로 보낸다 — 이 알림을 누르는 사람이 하려는 일이 아니다"
  );
});

test("🔴 품명이 비면 화면이 쓰는 그 글자로 메운다 — 빈 글자는 통합 승인함에서 줄을 통째로 뺀다", () => {
  for (const blank of [null, "", "   "]) {
    assert.equal(
      nearItem({ modelName: blank }).subject,
      DOMESTIC_ORDER_NO_MODEL_LINK_LABEL,
      `${JSON.stringify(blank)} 를 메우지 않는다`
    );
  }
  // 메우는 글자를 새로 짓지 않았는가 — 기타건 결재 대기와 **같은 글자**여야 한다.
  assert.equal(
    nearItem({ modelName: null }).subject,
    buildDomesticOrderApprovalNotification({
      domesticOrderId: ORDER_ID,
      modelName: null,
      routeStepOrder: 1,
      requestedByName: "박영업",
      dueDateRowOrder: 1,
      dueDateRowLabel: null,
    }).subject,
    "같은 줄을 두 알림이 다른 말로 부른다"
  );
});

test("🔴 회차가 여럿이면 detail 이 **회차 이름표 그대로**다 — 날짜를 두 번 적지 않는다", () => {
  // 이름표 자체가 「2차 · 납기 2026-02-15 (2차분)」 꼴로 번호와 날짜를 함께 담는다.
  // 여기서 날짜를 또 이으면 같은 날짜가 한 줄에 두 번 적힌다.
  const label = domesticOrderDueDateRowLabel(2, { dueDate: "2094-11-05", note: "2차분" });
  assert.ok(label.includes("2094-11-05"), `이름표가 날짜를 안 담는다: ${label}`);

  const item = nearItem({ dueDate: "2094-11-05", dueDateRowOrder: 2, dueDateRowLabel: label });
  assert.equal(item.detail, label);
  assert.equal(
    item.detail.split("2094-11-05").length - 1,
    1,
    `같은 날짜가 한 줄에 두 번 적혔다: ${item.detail}`
  );
  assert.ok(item.detail.includes("2차"), item.detail);
  assert.ok(item.detail.includes("2차분"), "회차를 가르는 유일한 단서(메모)가 빠졌다");
});

test("🔵 회차가 하나뿐이면 detail 이 「납기 임박」과 **글자 그대로 같다**", () => {
  // 붙일 회차가 없는데 「1차」라고 적으면 있지도 않은 회차를 가리키는 말이 된다
  // (domain/domestic-order-due-date-label.ts 의 DUE_DATE_ROW_WHOLE_LINE_LABEL 주석).
  // 기타건 결재 대기도 같은 자리에서 같게 한다.
  assert.equal(
    nearItem({ dueDate: "2094-10-22", dueDateRowLabel: null }).detail,
    buildRepairCaseDueDateNearNotification({
      repairCaseId: ORDER_ID,
      intakeNumber: "D9705-400",
      dueDate: "2094-10-22",
      borrowed: false,
    }).detail,
    "회차 하나뿐인 기타건의 상세 글자가 수리 건 납기 임박과 갈렸다"
  );
});

test("🔴 종류 이름을 detail 에 다시 적지 않는다 — 종 패널이 이 줄 위에 적는다", () => {
  for (const label of [null, "2차 · 납기 2094-11-05"]) {
    assert.equal(
      nearItem({ dueDateRowLabel: label }).detail.includes(NOTIFICATION_KIND_META[KIND].label),
      false,
      "잘리는 자리의 폭을 종류 이름이 먹고 있다"
    );
  }
});

// ───────────────────────────────────────────── id 와 세는 단위

test("🔴 id 에 **회차**가 붙는다 — 안 붙이면 같은 줄의 두 회차가 종에서 뭉개진다", () => {
  const first = nearItem({ dueDateRowOrder: 1, dueDate: "2094-10-22" });
  const second = nearItem({ dueDateRowOrder: 2, dueDate: "2094-10-25" });

  assert.equal(first.id, `${KIND}:${ORDER_ID}:1`);
  assert.equal(second.id, `${KIND}:${ORDER_ID}:2`);
  assert.notEqual(first.id, second.id, "같은 줄의 두 회차가 글자가 같은 id 를 갖는다");
});

test("🔴 targetKey 는 **줄 id** 다 — 한 줄의 두 회차가 동시에 임박해도 배지는 1 이다", () => {
  const first = nearItem({ dueDateRowOrder: 1, dueDate: "2094-10-22" });
  const second = nearItem({ dueDateRowOrder: 2, dueDate: "2094-10-25" });

  assert.equal(first.targetKey, ORDER_ID);
  assert.equal(second.targetKey, ORDER_ID);
  const counts = countNotificationTargetsByKind([first, second]);
  assert.equal(counts[KIND], 1, "같은 줄이 두 건으로 센다");
});

// ───────────────────────────────────────────── 눌러서 확인하는 종류가 아니다

test("🔴 확인 단추가 없다 — 납품도 완료도 안 했는데 눌러서 지울 수 없어야 한다", () => {
  assert.equal(
    (ACKNOWLEDGEABLE_NOTIFICATION_KINDS as readonly string[]).includes(KIND),
    false,
    "확인으로 숨길 수 있는 종류가 됐다"
  );
  assert.equal(isAcknowledgeableNotificationKind(KIND), false);
  // 적는 쪽 문도 이 키를 거절해야 한다 — 화면만 막으면 서버 액션으로 들어온다.
  const check = checkNotificationAcknowledgementKey(`${KIND}:${ORDER_ID}:1`);
  assert.equal(check.ok, false, "확인 기록에 적히는 키가 된다");
});

// ───────────────────────────────────────────── 조회(글자로 잰다)

const QUERY_SOURCE = readFileSync(
  new URL("../db/queries/domestic-order-due-date-near-notifications.ts", import.meta.url),
  "utf8"
);

test("🔴 조회 파일에 쓰는 문장이 한 줄도 없다 — 글자로 잰다", () => {
  // 🔵 먼저 **무엇을 재는지** 못 박는다. 경로가 틀려 빈 문자열을 읽어도
  //    `!includes(...)` 는 초록색으로 남는다.
  assert.equal(
    (QUERY_SOURCE.match(/\.select\(/g) ?? []).length,
    1,
    "질의가 하나(납기요청일 행)가 아니다"
  );
  assert.ok(QUERY_SOURCE.includes(".from(domesticOrderDueDates)"), "납기요청일 행을 읽지 않는다");

  for (const forbidden of [".insert(", ".update(", ".delete(", "db.execute("]) {
    assert.ok(!QUERY_SOURCE.includes(forbidden), `조회 파일이 ${forbidden} 를 쓴다`);
  }
  assert.ok(!QUERY_SOURCE.includes("db.transaction("), "조회 파일이 트랜잭션을 연다");
});

test("🔴 창을 **베껴 적지 않고** 「납기 임박」이 쓰는 그 함수를 부른다 — SQL 로도 안 잰다", () => {
  assert.ok(
    QUERY_SOURCE.includes("isRepairCaseDueDateWithinNotificationWindow("),
    "창 판정을 domain/notifications.ts 에서 가져오지 않는다"
  );
  assert.match(
    QUERY_SOURCE,
    /import \{[^}]*\bisRepairCaseDueDateWithinNotificationWindow\b[^}]*\} from "@\/lib\/domain\/notifications"/,
    "그 판정을 제 파일에 또 만들어 두었다"
  );
  // 🔴 날짜 비교가 질의 안에 있으면 두 알림의 「임박」이 조용히 갈라진다.
  for (const forbidden of ["sql`", "gte(domesticOrderDueDates.dueDate", "lte(domesticOrderDueDates.dueDate"]) {
    assert.ok(!QUERY_SOURCE.includes(forbidden), `창을 SQL 로 옮겼다: ${forbidden}`);
  }
  // 회차 이름표도 지어내지 않는다 — 화면 넷이 쓰는 그 함수를 그대로 부른다.
  assert.ok(
    QUERY_SOURCE.includes("domesticOrderDueDateRowLabel("),
    "회차 이름표를 도메인 함수로 만들지 않는다"
  );
  assert.ok(!QUERY_SOURCE.includes("차 · 납기"), "이름표 글자를 조회가 손으로 적고 있다");
});

test("🔴 조회가 **기타건만** 본다 — `repair_case_id IS NULL` 과 휴지통 거르기", () => {
  assert.ok(
    QUERY_SOURCE.includes("isNull(domesticOrders.repairCaseId)"),
    "수리 건이 붙은 줄을 빼지 않는다 — 「납기 임박」과 함께 두 번 뜬다"
  );
  assert.ok(
    QUERY_SOURCE.includes("eq(domesticOrders.isDeleted, false)"),
    "휴지통에 든 줄을 빼지 않는다"
  );
});

test("🔴 끝난 회차를 뺀다 — 납품일과 완료 표시를 **둘 다** 본다", () => {
  assert.ok(QUERY_SOURCE.includes("row.completedAt !== null"), "완료 처리된 회차를 빼지 않는다");
  assert.ok(QUERY_SOURCE.includes("row.deliveredDate !== null"), "납품된 회차를 빼지 않는다");
});

test("🔴 레지스트리가 그 조회를 부르고, 역할로 거르지 않는다", () => {
  const registry = readFileSync(new URL("../db/queries/notifications.ts", import.meta.url), "utf8");
  assert.ok(registry.includes(`kind: "${KIND}"`), "레지스트리에 이 종류가 없다 — 한 줄도 안 뜬다");
  assert.ok(registry.includes("listDomesticOrdersWithDueDateNear("), "그 조회를 부르지 않는다");
  assert.ok(
    registry.includes("buildDomesticOrderDueDateNearNotification("),
    "알림 한 줄을 만드는 함수를 부르지 않는다"
  );
});

// ───────────────── 창이 「납기 임박」과 같은 함수라는 사실 — 값으로 한 번 더

test("🔴 창이 수리 건 쪽과 **같은 경계**다 — 오늘도 +7일도 안이고, 어제와 +8일은 밖이다", () => {
  // 글자 검사(위)는 「그 함수를 들여왔다」까지만 본다. 여기서는 그 함수가 실제로 어떤
  // 날짜에 참을 주는지를 값으로 잰다 — 표본이 비면 위 글자 검사만으로는 알림이 영영
  // 한 줄도 안 떠도 초록이다.
  // 한국 시각 2094-10-22 14:00(= UTC 05:00)을 「지금」으로 잡는다.
  const midday = new Date("2094-10-22T05:00:00.000Z");
  assert.equal(isRepairCaseDueDateWithinNotificationWindow("2094-10-22", midday), true, "오늘");
  assert.equal(isRepairCaseDueDateWithinNotificationWindow("2094-10-29", midday), true, "+7일");
  assert.equal(isRepairCaseDueDateWithinNotificationWindow("2094-10-21", midday), false, "어제");
  assert.equal(isRepairCaseDueDateWithinNotificationWindow("2094-10-30", midday), false, "+8일");
});
