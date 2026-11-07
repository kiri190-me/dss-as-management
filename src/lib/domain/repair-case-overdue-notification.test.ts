import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NOTIFICATION_KINDS,
  buildRepairCaseDueDateNearNotification,
  buildRepairCaseDueDateOverdueNotification,
  countNotificationTargetsByKind,
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
import { isRepairCaseOverdue } from "./repair-case-overdue";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";
import { DUE_DATE_FROM_DOMESTIC_ORDER_LABEL } from "./requested-due-date-link";
import { ROLE_CODES } from "./types";

/**
 * ============================================================================
 * 「납기 지연」 — 종 알림의 계약 (2026-11-07)
 * ============================================================================
 * 사용자 요구: 「[납기 지연]도 종으로 알림이 뜨도록」. 같은 날 같은 요구의 앞 절반이
 * 「내자정리에서 읽어온 납기일에도 [납기지연]을 같은 취급으로」였고, 이 알림은 그
 * 고쳐진 판정을 **그대로** 쓴다.
 *
 * 이 파일이 지키는 선이 여섯이다:
 *  1. 🔴 **뜨는 조건을 알림이 새로 짓지 않는다** — 표·카드·상세의 배지를 세우는 그
 *     함수(isRepairCaseOverdue)가 그대로 판정한다. 조건을 베껴 적는 순간
 *     「배지는 떴는데 종은 조용하다」가 가능해진다.
 *  2. 알림 한 줄의 글자 — 날짜가 들어가고, 빌려 온 날짜에는 표시가 붙는다. 모양이
 *     「납기 임박」과 같다(두 알림은 같은 칸을 창만 달리해 본다).
 *  3. 🔴 **주소(href)가 수리 건 상세로 간다.** 어제(2026-11-06) 이웃 조각이 주소를
 *     잘못 꽂아 404 를 낸 자리라, 탭 헬퍼가 내놓는 값과 **맞대어** 본다.
 *  4. 🔴 **눌러서 확인하는 종류가 아니다** — 확인 키가 거절된다. 깨지면 물건이 아직
 *     안 나갔는데 눌러서 지울 수 있게 된다.
 *  5. 🔴 **다섯 역할 전부에게 가고, 그 명단이 「납기 임박」과 같다.**
 *  6. 조회가 **DB 에 아무것도 안 쓴다** · 판정을 SQL 로 옮기지 않았다 — 글자로 잰다.
 *
 * 🔴 조회(db/queries/…)는 server-only 와 DB 를 끌고 들어와 단위 시험에서 부를 수
 * 없다. 그래서 이웃 셋이 쓰는 방법 그대로 **소스를 읽어** 계약을 붙잡는다
 * (due-date-inverted-notification.test.ts 와 같은 자리·같은 까닭). 조회가 진짜 DB
 * 위에서 무엇을 내놓는지는 db 목록의 통합 시험이 따로 본다.
 *
 * 🔵 판정 자체(빌려 오기 · 당일은 아직 아님 · 출하 거르기)는
 * repair-case-overdue.test.ts 가 통째로 쥐고 있다. 여기서는 **알림이 그 함수를
 * 쓰는가**만 보고, 조건을 다시 적지 않는다.
 * ============================================================================
 */

const KIND = "REPAIR_CASE_DUE_DATE_OVERDUE";
const CASE_ID = "55555555-5555-4555-8555-555555555555";
/** 🔴 가짜 인수번호다 — 실제 접수번호·고객사 이름은 한 글자도 쓰지 않는다. */
const INTAKE_NUMBER = "D9705-012";

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
  for (const role of ROLE_CODES) {
    assert.equal(
      defaultRoleReceivesNotification(KIND, role),
      true,
      `${role}: 역할 기본값이 default 절(false)로 떨어졌다`
    );
  }
});

test("🔴 받는 명단이 「납기 임박」과 **같다** — 하루가 지나는 순간 종에서 사라지면 안 된다", () => {
  // 답을 손으로 적지 않고 임박과 맞대어 본다. 둘 다 적어 두면 한쪽만 좁힌 날에도
  // 둘 다 통과한다 — 이 종류의 요점이 바로 「갈리면 안 된다」이다.
  assert.ok(ROLE_CODES.length > 0, "역할 목록이 비었다 — 아래 반복이 아무것도 안 잰다");
  for (const role of ROLE_CODES) {
    assert.equal(
      deliversNotification(KIND, role, NO_NOTIFICATION_SETTINGS),
      deliversNotification("REPAIR_CASE_DUE_DATE_NEAR", role, NO_NOTIFICATION_SETTINGS),
      `${role}: 납기 지연과 납기 임박의 전달 여부가 갈렸다`
    );
    assert.equal(deliversNotification(KIND, role, NO_NOTIFICATION_SETTINGS), true, role);
  }
});

// ───────────────────────────────────────────── 알림 한 줄의 글자

test("알림 한 줄 — subject 는 인수번호, detail 은 그 날짜, href 는 상세 첫 화면", () => {
  const item = buildRepairCaseDueDateOverdueNotification({
    repairCaseId: CASE_ID,
    intakeNumber: INTAKE_NUMBER,
    dueDate: "2094-10-30",
    borrowed: false,
  });

  assert.equal(item.kind, KIND);
  assert.equal(item.id, `${KIND}:${CASE_ID}`);
  assert.equal(item.targetKey, CASE_ID);
  assert.equal(item.subject, INTAKE_NUMBER);
  assert.equal(item.detail, "2094-10-30");
  // 🔴 주소를 글자로 적어 두지 않고 **탭 헬퍼가 내놓는 값과 맞대어** 본다.
  //    어제 이웃 조각이 여기서 404 를 냈다(포털 화면에서만 보이는 결함이었다).
  assert.equal(item.href, repairCaseDetailHrefs(CASE_ID).root);
  assert.ok(item.href.includes(CASE_ID), "주소에 그 건의 id 가 없다");
  assert.ok(item.href.startsWith("/repair-cases/"), `수리 건 상세로 가지 않는다: ${item.href}`);
});

test("🔴 빌려 온 날짜에는 표시가 붙는다 — 상세 화면의 그 칸이 비어 보이기 때문이다", () => {
  const item = buildRepairCaseDueDateOverdueNotification({
    repairCaseId: CASE_ID,
    intakeNumber: INTAKE_NUMBER,
    dueDate: "2094-10-30",
    borrowed: true,
  });
  assert.ok(item.detail.includes("2094-10-30"), item.detail);
  // 표시 글자를 새로 짓지 않는다 — 상세 화면이 이미 쓰는 그 상수여야 한다.
  assert.ok(item.detail.includes(DUE_DATE_FROM_DOMESTIC_ORDER_LABEL), item.detail);
});

test("🔴 detail 모양이 「납기 임박」과 같다 — 같은 칸을 창만 달리해 보는 짝이다", () => {
  const input = { repairCaseId: CASE_ID, intakeNumber: INTAKE_NUMBER, dueDate: "2094-10-30" };
  for (const borrowed of [false, true]) {
    assert.equal(
      buildRepairCaseDueDateOverdueNotification({ ...input, borrowed }).detail,
      buildRepairCaseDueDateNearNotification({ ...input, borrowed }).detail,
      `borrowed=${borrowed}: 두 알림의 상세 글자가 갈렸다`
    );
  }
});

test("🔴 종류 이름을 detail 에 다시 적지 않는다 — 종 패널이 이 줄 위에 적는다", () => {
  const item = buildRepairCaseDueDateOverdueNotification({
    repairCaseId: CASE_ID,
    intakeNumber: INTAKE_NUMBER,
    dueDate: "2094-10-30",
    borrowed: false,
  });
  assert.equal(
    item.detail.includes(NOTIFICATION_KIND_META[KIND].label),
    false,
    "잘리는 자리의 폭을 종류 이름이 먹고 있다"
  );
});

test("한 건에 한 줄이다 — 같은 건을 두 번 세지 않는다", () => {
  const item = buildRepairCaseDueDateOverdueNotification({
    repairCaseId: CASE_ID,
    intakeNumber: INTAKE_NUMBER,
    dueDate: "2094-10-30",
    borrowed: false,
  });
  const counts = countNotificationTargetsByKind([item, { ...item }]);
  assert.equal(counts[KIND], 1, "같은 건이 두 줄로 센다");
});

// ───────────────────────────────────────────── 눌러서 확인하는 종류가 아니다

test("🔴 확인 단추가 없다 — 물건이 안 나갔는데 눌러서 지울 수 없어야 한다", () => {
  assert.equal(
    (ACKNOWLEDGEABLE_NOTIFICATION_KINDS as readonly string[]).includes(KIND),
    false,
    "확인으로 숨길 수 있는 종류가 됐다"
  );
  assert.equal(isAcknowledgeableNotificationKind(KIND), false);
  // 적는 쪽 문도 이 키를 거절해야 한다 — 화면만 막으면 서버 액션으로 들어온다.
  const check = checkNotificationAcknowledgementKey(`${KIND}:${CASE_ID}`);
  assert.equal(check.ok, false, "확인 기록에 적히는 키가 된다");
});

// ───────────────────────────────────────────── 조회(글자로 잰다)

const QUERY_SOURCE = readFileSync(
  new URL("../db/queries/repair-case-overdue-notifications.ts", import.meta.url),
  "utf8"
);

test("🔴 조회 파일에 쓰는 문장이 한 줄도 없다 — 글자로 잰다", () => {
  // 🔵 먼저 **무엇을 재는지** 못 박는다. 경로가 틀려 빈 문자열을 읽어도
  //    `!includes(...)` 는 초록색으로 남는다.
  assert.equal((QUERY_SOURCE.match(/\.select\(/g) ?? []).length, 1, "질의가 하나(접수 건)가 아니다");
  assert.ok(QUERY_SOURCE.includes(".from(repairCases)"), "접수 건을 읽지 않는다");

  for (const forbidden of [".insert(", ".update(", ".delete(", "db.execute("]) {
    assert.ok(!QUERY_SOURCE.includes(forbidden), `조회 파일이 ${forbidden} 를 쓴다`);
  }
  assert.ok(!QUERY_SOURCE.includes("db.transaction("), "조회 파일이 트랜잭션을 연다");
});

test("🔴 조회가 지연 판정을 **베껴 적지 않고** 배지를 세우는 그 함수를 부른다", () => {
  assert.ok(
    QUERY_SOURCE.includes("isRepairCaseOverdue("),
    "지연 판정을 domain/repair-case-overdue.ts 에서 가져오지 않는다"
  );
  assert.match(
    QUERY_SOURCE,
    /import \{[^}]*\bisRepairCaseOverdue\b[^}]*\} from "@\/lib\/domain\/repair-case-overdue"/,
    "그 판정을 제 파일에 또 만들어 두었다"
  );
  // 🔴 판정을 SQL 로 옮기지 않았는가 — 날짜 비교가 질의 안에 있으면 배지와 종이
  //    다른 말을 하기 시작한다.
  for (const forbidden of ["lt(repairCases.customerRequestedDueDate", "sql`"]) {
    assert.ok(!QUERY_SOURCE.includes(forbidden), `판정을 SQL 로 옮겼다: ${forbidden}`);
  }
  // 🔴 **사내 목표 완료일을 아예 읽지 않는다**(2026-11-03 사용자 결정).
  assert.equal(
    QUERY_SOURCE.includes("internalTargetShipmentDate"),
    false,
    "조회가 사내 목표 완료일을 읽는다 — 2026-11-03 결정과 어긋난다"
  );
  // 빌려 오는 일도 베껴 적지 않는다 — 공용 조각과 도메인 함수를 그대로 쓴다.
  assert.ok(
    QUERY_SOURCE.includes("loadDomesticOrderDueDatesByCaseId("),
    "내자 납기요청일을 공용 조각으로 읽지 않는다"
  );
  assert.ok(QUERY_SOURCE.includes("dueDateBorrowerIds("), "빌릴 건만 묻는 좁히기를 쓰지 않는다");
  assert.ok(
    QUERY_SOURCE.includes("resolveRepairCaseRequestedDueDate("),
    "detail 에 적을 날짜를 화면이 쓰는 함수로 고르지 않는다"
  );
  // 휴지통에 든 건은 빼야 한다.
  assert.ok(QUERY_SOURCE.includes("eq(repairCases.isDeleted, false)"), "휴지통에 든 건을 빼지 않는다");
});

test("🔴 레지스트리가 그 조회를 부르고, 역할로 거르지 않는다", () => {
  const registry = readFileSync(new URL("../db/queries/notifications.ts", import.meta.url), "utf8");
  assert.ok(registry.includes(`kind: "${KIND}"`), "레지스트리에 이 종류가 없다 — 한 줄도 안 뜬다");
  assert.ok(registry.includes("listRepairCasesOverdue("), "그 조회를 부르지 않는다");
  assert.ok(
    registry.includes("buildRepairCaseDueDateOverdueNotification("),
    "알림 한 줄을 만드는 함수를 부르지 않는다"
  );
});

test("🔴 세는 도구는 종에 뜨는 그 조회를 부른다 — 수를 따로 세지 않는다", () => {
  // 세는 SQL 을 도구에 한 벌 더 적으면 재어 놓은 수와 실제로 뜨는 수가 조용히
  // 달라지고, 그때는 틀린 수를 보고 올릴지 말지를 정하게 된다.
  const tool = readFileSync(new URL("../../../scripts/check-due-date-overdue.ts", import.meta.url), "utf8");
  assert.ok(tool.includes("countRepairCaseOverdueStages("), "단계별 세기를 조회 파일에서 가져오지 않는다");
  assert.ok(tool.includes("listRepairCasesOverdue("), "실제 줄과 맞대어 보지 않는다");
  assert.ok(!tool.includes(".select("), "도구가 제 SQL 을 들고 있다");
  for (const forbidden of [".insert(", ".update(", ".delete(", "--apply"]) {
    assert.ok(!tool.includes(forbidden), `읽기 도구가 ${forbidden} 를 쓴다`);
  }
  // 도구가 package.json 에 실제로 걸려 있어야 운영에서 부를 수 있다.
  const pkg = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
  assert.ok(pkg.includes("scripts/check-due-date-overdue.ts"), "npm 스크립트로 걸려 있지 않다");
});

// ─────────────────────── 판정이 알림과 배지에서 **같은 함수**라는 사실

test("🔴 알림이 쓰는 판정과 배지가 쓰는 판정이 같은 함수다 — 값으로 한 번 더 확인한다", () => {
  // 글자 검사(위)는 「그 함수를 들여왔다」까지만 본다. 여기서는 그 함수가 실제로
  // 사용자가 본 그 모양에 참을 주는지를 값으로 잰다 — 표본이 비면 위 글자 검사만으로는
  // 알림이 영영 한 줄도 안 떠도 초록이다.
  const midday = new Date("2094-10-31T05:00:00.000Z");
  assert.equal(
    isRepairCaseOverdue(
      {
        status: "IN_REPAIR",
        customerRequestedDueDate: null,
        domesticOrderDueDates: ["2094-10-30"],
        actualShipmentDate: null,
      },
      midday
    ),
    true,
    "빌려 온 지난 날짜에 지연이 아니라고 답한다 — 알림도 한 줄도 안 뜬다"
  );
});
