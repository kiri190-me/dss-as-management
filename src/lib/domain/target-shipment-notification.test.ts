import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INTERNAL_TARGET_SHIPMENT_REQUEST_MESSAGE,
  NOTIFICATION_KINDS,
  buildRepairCaseTargetShipmentMissingNotification,
  countNotificationTargetsByKind,
  earliestDomesticOrderIssuedDate,
  hasDomesticOrderIssued,
  isInternalTargetShipmentDateMissing,
  needsInternalTargetShipmentDate,
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
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";
import { ROLE_CODES } from "./types";

/**
 * ============================================================================
 * 「사내 목표 출하일을 등록해 주세요」 — 뜨는 조건 · 받는 사람 · 안 사라짐
 * ============================================================================
 * 2026-10-29 사용자 요구: 「PO발행일이 등록되면 엔지니어들에게 [사내 목표 출하일을
 * 등록해 주세요]라고 알림이 뜨도록 … 이 알림은 승인용이야, 해당 수리건에 [사내목표
 * 출하일]이 등록되기 전까지는 **눌러서 확인해도 사라지지 않아**」.
 *
 * 이 파일이 지키는 선이 넷이다:
 *  1. 뜨는 조건 셋(PO발행일 있음 · 목표 출하일 없음 · 출하 완료 아님)과 그 경계.
 *  2. 🔴 **눌러서 확인하는 종류가 아니다** — 확인 키가 거절된다. 이것이 깨지면
 *     「등록 전에는 안 사라진다」가 정반대가 된다.
 *  3. 🔴 **A/S 엔지니어에게 가고 관리자·영업·재고 담당자에게는 기본으로 안 간다.**
 *     (최고관리자는 종류를 가리지 않는 잠금으로 받는다 — 그 사실도 함께 못 박는다.)
 *  4. 조회가 **DB 에 아무것도 안 쓴다** — 글자로 잰다.
 *
 * 🔴 조회(db/queries/…)는 server-only 와 DB 를 끌고 들어와 단위 시험에서 부를 수
 * 없다. 그래서 「납기 임박」이 쓰는 방법 그대로, **소스를 읽어** 계약을 붙잡는다
 * (domain/notifications.test.ts 의 레지스트리 절과 같은 자리).
 * ============================================================================
 */

const KIND = "REPAIR_CASE_TARGET_SHIPMENT_MISSING";
const CASE_ID = "33333333-3333-4333-8333-333333333333";

/** 지금 알림이 뜨는 표본 — 하나씩 뒤집어 가며 각 조건을 잰다. */
function missingRow(overrides: Partial<Parameters<typeof needsInternalTargetShipmentDate>[0]> = {}) {
  return {
    orderIssuedDates: ["2026-10-21"] as readonly string[],
    internalTargetShipmentDate: null as string | null,
    status: "IN_REPAIR" as const,
    actualShipmentDate: null as string | null,
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────── 뜨는 조건 셋

test("🔴 PO발행일이 있고 사내 목표 출하일이 없고 출하가 안 끝났으면 뜬다", () => {
  assert.equal(needsInternalTargetShipmentDate(missingRow()), true);
});

test("🔴 사내 목표 출하일이 있으면 안 뜬다 — 등록하는 순간 다음 조회에서 빠진다", () => {
  assert.equal(
    needsInternalTargetShipmentDate(missingRow({ internalTargetShipmentDate: "2026-11-05" })),
    false
  );
  // 공백만 적힌 값은 「없음」이다 — 화면에는 빈칸인데 알림만 사라지는 건이 생기지
  // 않게 한다(「납기 역전」이 같은 칸을 같은 함수로 접는다).
  for (const blank of ["", "   ", "\t\n"]) {
    assert.equal(
      needsInternalTargetShipmentDate(missingRow({ internalTargetShipmentDate: blank })),
      true,
      `${JSON.stringify(blank)} 를 값으로 쳤다`
    );
  }
});

test("🔴 PO발행일이 없으면 안 뜬다 — 내자 줄이 아예 없는 건도 마찬가지다", () => {
  assert.equal(needsInternalTargetShipmentDate(missingRow({ orderIssuedDates: [] })), false);
  assert.equal(needsInternalTargetShipmentDate(missingRow({ orderIssuedDates: ["", "  "] })), false);
});

test("🔴 출하가 끝났으면 안 뜬다 — 상태로든 실제 출하일로든", () => {
  // 「납기 임박」·「납기 지연」·「납기 역전」이 쓰는 그 함수로 가른다. 상태 하나에만
  // 기대면 출하일은 찍혔는데 단계가 따라가지 못한 건에 할 일이 남는다.
  assert.equal(
    needsInternalTargetShipmentDate(missingRow({ status: "SHIPMENT_COMPLETED" })),
    false,
    "출하 완료 상태인데 뜬다"
  );
  assert.equal(
    needsInternalTargetShipmentDate(
      missingRow({ status: "WAITING_SHIPMENT", actualShipmentDate: "2026-10-28" })
    ),
    false,
    "출하일이 찍힌 건은 단계가 뒤처져 있어도 이미 나간 것이다"
  );
  // 평탄화 상태가 비어 있는 단계가 아직 있다(workflow_steps.repair_status 는 nullable).
  // 그런 건은 「아직 안 나갔다」로 둔다 — 조용히 빠지는 쪽이 나쁘다.
  assert.equal(needsInternalTargetShipmentDate(missingRow({ status: null })), true);
});

test("🔴 세 조건은 **곱**이다 — 하나만 참인 표본은 뜨지 않는다", () => {
  // 위 네 시험은 「하나를 뒤집으면 꺼진다」를 본다. 이 시험은 반대로 「하나만 켜져
  // 있을 때 켜지지 않는가」를 본다 — 조건을 ∧ 가 아니라 ∨ 로 적은 구현은 위 넷 중
  // 일부를 통과한다.
  assert.equal(
    needsInternalTargetShipmentDate({
      orderIssuedDates: ["2026-10-21"],
      internalTargetShipmentDate: "2026-11-05",
      status: "SHIPMENT_COMPLETED",
      actualShipmentDate: "2026-10-28",
    }),
    false
  );
  assert.equal(
    needsInternalTargetShipmentDate({
      orderIssuedDates: [],
      internalTargetShipmentDate: null,
      status: "SHIPMENT_COMPLETED",
      actualShipmentDate: null,
    }),
    false
  );
});

test("PO발행일이 여럿이면 하나라도 적혀 있으면 「있다」이고, 날짜는 가장 이른 하루다", () => {
  // 한 건에 내자 줄이 여럿이다(분할 발주). 줄 하나라도 발행됐으면 그 건의 일정은
  // 이미 움직이고 있다.
  assert.equal(hasDomesticOrderIssued(["", "2026-10-21"]), true);
  assert.equal(hasDomesticOrderIssued([]), false);
  assert.equal(earliestDomesticOrderIssuedDate(["2026-10-21", "2026-09-30", "2026-12-01"]), "2026-09-30");
  assert.equal(earliestDomesticOrderIssuedDate(["  ", "2026-10-21"]), "2026-10-21");
  assert.equal(earliestDomesticOrderIssuedDate([]), null);
  // 문자열로 견준다 — Date 로 파싱하면 한국에서 하루가 밀린다(date-only.ts 머리말).
  assert.equal(earliestDomesticOrderIssuedDate(["2027-01-01", "2026-12-31"]), "2026-12-31");
});

test("사내 목표 출하일 미기재 판정은 공백을 없음으로 접는다", () => {
  assert.equal(isInternalTargetShipmentDateMissing(null), true);
  assert.equal(isInternalTargetShipmentDateMissing("   "), true);
  assert.equal(isInternalTargetShipmentDateMissing("2026-11-05"), false);
});

// ───────────────────────────────────────────────────── 알림 한 줄의 모양

test("🔴 알림 글자에 「사내 목표 출하일을 등록해 주세요」가 그대로 들어 있다", () => {
  const item = buildRepairCaseTargetShipmentMissingNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    orderIssuedDate: "2026-10-21",
  });

  assert.equal(item.kind, KIND);
  assert.equal(item.id, `REPAIR_CASE_TARGET_SHIPMENT_MISSING:${CASE_ID}`);
  assert.equal(item.targetKey, CASE_ID, "한 건에 목표 출하일은 하나뿐이라 건 단위로 센다");
  assert.equal(item.subject, "D261015", "어느 건인지는 인수번호가 말한다");
  assert.equal(item.detail, "사내 목표 출하일을 등록해 주세요 · PO발행일 2026-10-21");
  // 🔴 글자를 두 곳에 적지 않는다 — 상수 한 곳이 이 말을 쥔다.
  assert.equal(INTERNAL_TARGET_SHIPMENT_REQUEST_MESSAGE, "사내 목표 출하일을 등록해 주세요");
  assert.ok(item.detail.startsWith(INTERNAL_TARGET_SHIPMENT_REQUEST_MESSAGE), item.detail);
  // 🔴 부탁이 **앞**이다. 종 패널의 상세 칸은 한 줄에서 잘리므로(CSS truncate) 뒤에
  //    두면 사용자가 요구한 그 문장이 잘려 나갈 수 있다.
  assert.ok(item.detail.indexOf("PO발행일") > 0, item.detail);
});

test("누르면 날짜를 적는 화면으로 간다 — 상세 첫 화면의 [인수 정보]다", () => {
  const item = buildRepairCaseTargetShipmentMissingNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    orderIssuedDate: "2026-10-21",
  });
  assert.equal(item.href, `/repair-cases/${CASE_ID}`);
  assert.equal(item.href, repairCaseDetailHrefs(CASE_ID).root, "주소는 탭 헬퍼와 같은 것을 써야 한다");
});

test("건마다 한 줄이고 배지는 건 단위로 센다 — 남의 종류를 세지 않는다", () => {
  const first = buildRepairCaseTargetShipmentMissingNotification({
    repairCaseId: "case-a",
    intakeNumber: "D261001",
    orderIssuedDate: "2026-10-21",
  });
  const second = buildRepairCaseTargetShipmentMissingNotification({
    repairCaseId: "case-b",
    intakeNumber: "D261002",
    orderIssuedDate: "2026-10-22",
  });
  assert.notEqual(first.id, second.id, "React key 가 겹치면 한 줄이 사라진다");

  const counts = countNotificationTargetsByKind([first, second]);
  assert.equal(counts.REPAIR_CASE_TARGET_SHIPMENT_MISSING, 2);
  assert.equal(counts.REPAIR_CASE_APPROVAL, 0, "결재 배지가 이 알림을 세면 안 된다");
});

// ────────────────── 🔴 눌러서 확인해도 사라지지 않는다 (사용자 요구의 핵심)

test("🔴 이 종류는 ACKNOWLEDGEABLE_NOTIFICATION_KINDS 에 **없다**", () => {
  // 들어가는 순간 종에 확인 단추가 생기고, 누르면 날짜를 안 적어도 사라진다 —
  // 「등록되기 전까지는 눌러서 확인해도 사라지지 않아」가 정반대가 된다.
  assert.equal(
    (ACKNOWLEDGEABLE_NOTIFICATION_KINDS as readonly string[]).includes(KIND),
    false,
    "확인으로 숨길 수 있는 종류가 되어 버렸다"
  );
  assert.equal(isAcknowledgeableNotificationKind(KIND), false);
  // 🔵 목록이 실제로 무엇을 담고 있는지도 함께 본다 — 빈 목록이면 위 두 단언은
  //    아무것도 재지 않고 통과한다.
  assert.deepEqual([...ACKNOWLEDGEABLE_NOTIFICATION_KINDS], ["APPROVAL_GRANTED", "APPROVAL_REJECTED"]);
});

test("🔴 이 알림의 키는 확인 기록에 적히지 않는다 — 적는 쪽 문이 거절한다", () => {
  const item = buildRepairCaseTargetShipmentMissingNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    orderIssuedDate: "2026-10-21",
  });
  const checked = checkNotificationAcknowledgementKey(item.id);
  assert.equal(checked.ok, false, "확인 기록에 적을 수 있는 키가 되어 버렸다");
  // 🔵 거절의 까닭이 「종류」여야 한다 — 형식이 틀려서 거절됐다면 종류 목록을 열어도
  //    그대로 막혀, 이 시험이 무엇을 재는지 알 수 없게 된다.
  assert.equal(
    checkNotificationAcknowledgementKey(`APPROVAL_GRANTED:${CASE_ID}`).ok,
    true,
    "같은 모양의 키가 종류만 바꾸면 통과해야 한다 — 형식 때문에 거절된 것이 아니다"
  );
});

test("🔴 레지스트리가 이 종류에는 확인 기록을 대 보지 않는다", () => {
  // 대 보는 순간 「확인했다」가 적힌 줄이 빠지게 된다(적는 쪽 문이 막고 있어도
  // 두 겹 중 하나가 열린 셈이다).
  const registrySource = readFileSync(new URL("../db/queries/notifications.ts", import.meta.url), "utf8");
  const start = registrySource.indexOf(`kind: "${KIND}",`);
  assert.ok(start >= 0, "레지스트리에 이 종류가 없다");
  const arrayEnd = registrySource.indexOf("\n];", start);
  const nextKind = registrySource.indexOf('kind: "', start + 1);
  const block = registrySource.slice(start, nextKind >= 0 && nextKind < arrayEnd ? nextKind : arrayEnd);

  // 자르기가 제 덩어리 하나를 집었는가 — 「없다」를 재기 전에 먼저 본다.
  assert.ok(
    block.includes("listRepairCasesMissingTargetShipmentDate()"),
    "덩어리에 제 조회가 없다 — 자르기가 틀렸다"
  );
  assert.ok(
    !block.includes("listRepairCasesWithDueDateNear("),
    "덩어리가 남의 조회까지 삼켰다 — 자르기가 틀렸다"
  );

  assert.ok(!block.includes("withoutAcknowledged("), "확인 기록을 대 본다");
  assert.ok(block.includes("buildRepairCaseTargetShipmentMissingNotification("), "모양 변환을 도메인에 맡기지 않는다");
  // load 가 사용자도 역할도 받지 않는다 — 역할을 가르는 자리는 알림 설정이다.
  assert.match(block, /load:\s*async\s*\(\s*\)\s*=>/, "load 가 인자를 받는다");
  assert.ok(!block.includes("actorRole"), "load 가 역할을 본다 — 설정 화면의 스위치가 죽은 단추가 된다");
  assert.match(
    registrySource,
    /import \{[^}]*\blistRepairCasesMissingTargetShipmentDate\b[^}]*\} from "\.\/repair-case-target-shipment-notifications"/,
    "전용 조회를 그 파일에서 가져오지 않는다"
  );
});

// ───────────────────────────────────── 🔴 받는 사람 — A/S 엔지니어

test("🔴 기본값은 A/S 엔지니어만 받는다 — 관리자·영업·재고 담당자는 안 받는다", () => {
  assert.equal(defaultNotificationKindEnabled(KIND), true, "켜진 채로 태어난다");
  assert.equal(defaultRoleReceivesNotification(KIND, "AS_ENGINEER"), true);
  for (const role of ["ADMIN", "SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(defaultRoleReceivesNotification(KIND, role), false, `${role} 에게도 간다`);
    assert.equal(deliversNotification(KIND, role, NO_NOTIFICATION_SETTINGS), false, `${role} 에게도 간다`);
  }
  assert.equal(deliversNotification(KIND, "AS_ENGINEER", NO_NOTIFICATION_SETTINGS), true);
});

test("🔴 최고관리자는 받는다 — 종류를 가리지 않는 잠금이다(끌 수 없다)", () => {
  // 사용자 결정은 「엔지니어」였지만, 이 저장소에는 「최고관리자가 받는 것은 이
  // 화면에서 끌 수 없다」는 잠금이 종류와 무관하게 걸려 있다
  // (isRoleEditableInNotificationSettings). 그래서 실제로 받는 사람은 엔지니어 +
  // 최고관리자다. 숨기지 않고 여기 적어 둔다 — 알림 설정 화면도 그렇게 그린다.
  assert.equal(defaultRoleReceivesNotification(KIND, "SUPER_ADMIN"), true, "기본값에도 같은 답을 적어야 한다");
  assert.equal(deliversNotification(KIND, "SUPER_ADMIN", NO_NOTIFICATION_SETTINGS), true);
  assert.equal(
    deliversNotification(KIND, "SUPER_ADMIN", {
      kindEnabled: {},
      roleReceives: { [KIND]: { SUPER_ADMIN: false } },
    }),
    true,
    "저장된 false 가 잠금을 이겼다"
  );
});

test("🔴 역할 스위치로 **열 수 있다** — 기본값이 거짓인 칸이 설정으로 켜진다", () => {
  // 2026-10-27 ~ 10-29 사이에는 기본값이 거짓인 칸이 하나도 없어 이 보증을 잴
  // 표본이 없었다(notification-settings.test.ts 의 그 자리 주석). 이 종류가 그
  // 표본이다 — 설정이 윗단 필터라는 말이 참이려면 닫힌 칸이 열려야 한다.
  assert.equal(
    deliversNotification(KIND, "SALES", { kindEnabled: {}, roleReceives: { [KIND]: { SALES: true } } }),
    true,
    "관리자가 켜도 안 열린다 — 죽은 스위치다"
  );
  // 반대로 종류를 끄면 켜 둔 역할에게도 안 간다(두 스위치는 다른 축이다).
  assert.equal(
    deliversNotification(KIND, "AS_ENGINEER", { kindEnabled: { [KIND]: false }, roleReceives: {} }),
    false
  );
});

test("🔴 역할을 가르는 자리는 **설정 한 곳**이다 — 다른 종류는 그대로다", () => {
  // 역할로 갈리는 첫 종류라, 그 결정이 남의 종류까지 조용히 좁히지 않았는지 본다.
  //
  // 🔵 2026-10-30 에 **둘째**가 생겼다 — REPAIR_CASE_DUE_DATE_INVERTED(납기 역전,
  //    엔지니어·영업·관리자). 그 종류는 제 명단으로 갈리는 것이 맞으므로 이 고리에서
  //    뺀다. 🔴 빼는 것이 곧 「그 둘이 같은 명단을 나눠 쓰지 않는가」를 안 보는 것은
  //    아니다 — 그 물음은 notification-settings.test.ts 의 「두 명단이 서로 다르다」와
  //    이 파일 아래 「이 종류만 좁다」가 양쪽에서 쥔다.
  const 제명단으로갈리는종류 = new Set<string>([KIND, "REPAIR_CASE_DUE_DATE_INVERTED"]);
  let checked = 0;
  for (const kind of NOTIFICATION_KINDS) {
    if (제명단으로갈리는종류.has(kind)) continue;
    for (const role of ROLE_CODES) {
      assert.equal(
        defaultRoleReceivesNotification(kind, role),
        true,
        `${kind} × ${role} 이 함께 좁혀졌다`
      );
      checked += 1;
    }
  }
  // 🔵 빈 고리는 아무것도 재지 않고 통과한다 — 몇 칸을 봤는지 먼저 못 박는다.
  assert.equal(checked, (NOTIFICATION_KINDS.length - 제명단으로갈리는종류.size) * ROLE_CODES.length);
  assert.ok(checked > 0, "좁혀지지 않은 종류가 하나도 없다 — 이 시험이 아무것도 안 본다");
});

test("🔴 이 종류만 **엔지니어 하나**다 — 2026-10-30 의 납기 역전이 함께 넓히지 않았다", () => {
  // 같은 날 들어온 납기 역전은 영업·관리자까지 받는다. 그 결정이 이쪽으로 번지면
  // 「날짜를 적을 사람」과 「고객과 협의할 사람」이 한 질문이 되어 버린다 —
  // domain/notification-settings.ts 머리말이 재고 알림 둘에서 이미 갈라 둔 구별이다.
  for (const role of ["ADMIN", "SALES"] as const) {
    assert.equal(defaultRoleReceivesNotification(KIND, role), false, `${role} 에게도 간다`);
    assert.equal(
      defaultRoleReceivesNotification("REPAIR_CASE_DUE_DATE_INVERTED", role),
      true,
      `${role}: 견줄 짝이 함께 좁혀졌다 — 이 시험이 무엇을 재는지 사라졌다`
    );
  }
});

test("이름·설명·색 — 관리자가 설명만 읽고 무엇을 끄는지 알 수 있다", () => {
  const meta = NOTIFICATION_KIND_META[KIND];
  assert.equal(meta.label, "사내 목표 출하일 미등록");
  // 무엇으로 뜨는가 · 어떻게 사라지는가 · 누가 받는가 셋이 다 적혀 있어야 한다.
  assert.ok(meta.description.includes("PO발행일"), meta.description);
  assert.ok(meta.description.includes("눌러서 확인하는 알림이 아니"), meta.description);
  assert.ok(meta.description.includes("A/S 엔지니어"), meta.description);
  assert.ok(meta.description.includes("최고관리자"), meta.description);
  // 🔴 **붉은 계열이다 — 2026-10-30 사용자 요청**(「알림 제목 색을 붉은 계열로」).
  //    그런데 **남의 색을 쓰면 안 된다** — 빨강은 납기 임박이, 장미는 반려됨이 이미
  //    쓰고 있어 한 패널에 섞이면 갈라 보이지 않는다. 그래서 둘에서 가장 먼 주황이다.
  const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
  const others = NOTIFICATION_KINDS.filter((kind) => kind !== KIND).map((kind) =>
    hueOf(NOTIFICATION_KIND_META[kind].toneClassName)
  );
  const hue = hueOf(meta.toneClassName);
  assert.ok(hue, meta.toneClassName);
  assert.ok(!others.includes(hue), `남의 색(${hue})을 쓴다`);
  assert.ok(
    ["red", "orange", "rose", "pink"].includes(hue),
    `붉은 계열이 아니다(${hue}) — 2026-10-30 사용자 요청이다`
  );
  // 🔵 어두운 화면 짝까지 한 벌이어야 한다(모양 검사는 notification-settings.test.ts
  //    가 전 종류에 대해 하지만, 이 종류의 색은 사용자가 직접 정한 것이라 여기서도
  //    글자 그대로 못 박는다 — 조립하면 Tailwind 가 그 클래스를 만들지 않는다).
  assert.equal(meta.toneClassName, "text-orange-700 dark:text-orange-400");
});

// ─────────────────────────────── 🔴 조회는 DB 에 아무것도 쓰지 않는다

test("🔴 조회 파일에 쓰는 문장이 한 줄도 없다 — 글자로 잰다", () => {
  const source = readFileSync(
    new URL("../db/queries/repair-case-target-shipment-notifications.ts", import.meta.url),
    "utf8"
  );
  // 🔵 먼저 **무엇을 재는지** 못 박는다. 경로가 틀려 빈 문자열을 읽어도
  //    `!includes(...)` 는 초록색으로 남는다.
  assert.equal((source.match(/\.select\(/g) ?? []).length, 2, "질의가 둘(내자 · 접수 건)이 아니다");
  assert.ok(source.includes(".from(domesticOrders)"), "내자 줄을 읽지 않는다");
  assert.ok(source.includes(".from(repairCases)"), "접수 건을 읽지 않는다");

  for (const forbidden of [".insert(", ".update(", ".delete(", "db.execute("]) {
    assert.ok(!source.includes(forbidden), `조회 파일이 ${forbidden} 를 쓴다`);
  }
  // 트랜잭션도 열지 않는다 — 읽기만 하는 파일에 그 말이 생기면 쓰기가 들어온 것이다.
  assert.ok(!source.includes("db.transaction("), "조회 파일이 트랜잭션을 연다");
});

test("🔴 조회가 판정을 베껴 적지 않고 도메인 함수를 부른다", () => {
  const source = readFileSync(
    new URL("../db/queries/repair-case-target-shipment-notifications.ts", import.meta.url),
    "utf8"
  );
  assert.ok(source.includes("needsInternalTargetShipmentDate("), "세 조건 판정을 도메인에서 가져오지 않는다");
  assert.ok(source.includes("isRepairCaseShipmentFinished("), "출하 완료 판정을 도메인에서 가져오지 않는다");
  assert.ok(source.includes("earliestDomesticOrderIssuedDate("), "가장 이른 PO발행일을 도메인에서 고르지 않는다");
  // 휴지통에 든 건과 지워진 내자 줄은 빼야 한다.
  assert.ok(source.includes("eq(repairCases.isDeleted, false)"), "휴지통에 든 건을 빼지 않는다");
  assert.ok(source.includes("eq(domesticOrders.isDeleted, false)"), "지워진 내자 줄의 발주일까지 센다");
});

test("🔴 세는 도구는 종에 뜨는 그 조회를 부른다 — 수를 따로 세지 않는다", () => {
  // 세는 SQL 을 도구에 한 벌 더 적으면 재어 놓은 수와 실제로 뜨는 수가 조용히
  // 달라지고, 그때는 틀린 수를 보고 켤지 말지를 정하게 된다.
  const tool = readFileSync(new URL("../../../scripts/check-target-shipment-missing.ts", import.meta.url), "utf8");
  assert.ok(tool.includes("countTargetShipmentMissingStages("), "단계별 세기를 조회 파일에서 가져오지 않는다");
  assert.ok(tool.includes("listRepairCasesMissingTargetShipmentDate("), "실제 줄과 맞대어 보지 않는다");
  assert.ok(!tool.includes(".select("), "도구가 제 SQL 을 들고 있다");
  for (const forbidden of [".insert(", ".update(", ".delete("]) {
    assert.ok(!tool.includes(forbidden), `읽기 도구가 ${forbidden} 를 쓴다`);
  }
  // 도구가 package.json 에 실제로 걸려 있어야 운영에서 부를 수 있다.
  const pkg = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
  assert.ok(pkg.includes("scripts/check-target-shipment-missing.ts"), "npm 스크립트로 걸려 있지 않다");
});
