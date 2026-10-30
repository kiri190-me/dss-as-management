import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 🔵 **이 import 가 맨 앞에 있던 까닭은 2026-10-30 에 없어졌다.** 그날까지
//    due-date-inversion.ts 와 notifications.ts 는 서로를 부르는 고리(circular
//    import)였고, 저쪽을 먼저 들여와 **위험한 차례**로 돌리는 것이 이 줄의 일이었다 —
//    notifications.ts 가 저 상수를 모듈 최상위에서 읽는 날 여기서 ReferenceError 로
//    죽게 해서 함정을 드러내려던 것이다. 출하 판정이 domain/shipment-finished.ts 로
//    나가면서 사슬이 한 방향이 됐고, 이제 어느 차례로 들여와도 깨지지 않는다.
// 🔴 **그래도 차례를 바꾸지 않는다.** 고리가 돌아오면 이 차례가 다시 그것을 드러내는
//    자리가 되기 때문이다. 고리 자체를 글자로 막는 일은 domain/shipment-finished.test.ts
//    가 한다 — 이 줄은 그 시험이 놓칠 때를 위한 둘째 그물이다.
import {
  DUE_DATE_INVERSION_NOTE,
  DUE_DATE_INVERSION_REASON_NOTE,
  isRepairCaseDueDateInverted,
} from "./due-date-inversion";
import {
  NOTIFICATION_KINDS,
  buildRepairCaseDueDateInvertedNotification,
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
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";
import { DUE_DATE_FROM_DOMESTIC_ORDER_LABEL } from "./requested-due-date-link";
import { ROLE_CODES } from "./types";

/**
 * ============================================================================
 * 「납기 요청일 협의가 필요합니다.」 — 종 알림의 계약
 * ============================================================================
 * 2026-10-30 사용자 요구: 「[납기 요청일 협의가 필요합니다]도 주황색 계열로 알림을
 * 띄우도록 하자. 대상은 (엔지니어, 영업, 관리자)이고 마찬가지로 승인용으로 설정해 줘.
 * 해당 알림을 클릭하면 수리건 상세로 넘어가지도록 해 줘.」
 *
 * 이 파일이 지키는 선이 다섯이다:
 *  1. 🔴 **뜨는 조건을 알림이 새로 짓지 않는다** — 화면 셋이 쓰는 그 함수
 *     (isRepairCaseDueDateInverted)가 그대로 판정한다. 조건을 베껴 적는 순간
 *     due-date-inversion.ts 가 존재하는 이유가 사라진다.
 *  2. 알림 한 줄의 글자 — 메모 문장이 **상수 그대로**이고, 두 날짜가 각각 이름을
 *     달고 들어가고, 빌려 온 날짜에는 표시가 붙는다.
 *  3. 🔴 **눌러서 확인하는 종류가 아니다**(사용자가 말한 「승인용」) — 확인 키가
 *     거절된다. 이것이 깨지면 「고치기 전에는 안 사라진다」가 정반대가 된다.
 *  4. 🔴 **엔지니어·영업·관리자에게 가고 재고 담당자에게는 기본으로 안 간다.**
 *     (최고관리자는 종류를 가리지 않는 잠금으로 받는다 — 그 사실도 함께 못 박는다.)
 *  5. 조회가 **DB 에 아무것도 안 쓴다** — 글자로 잰다.
 *
 * 🔴 조회(db/queries/…)는 server-only 와 DB 를 끌고 들어와 단위 시험에서 부를 수
 * 없다. 그래서 「납기 임박」·「사내 목표 출하일 미등록」이 쓰는 방법 그대로, **소스를
 * 읽어** 계약을 붙잡는다(domain/target-shipment-notification.test.ts 와 같은 자리).
 *
 * 🔵 판정 자체(같은 날은 역전이 아니다 · 빌려 오기 · 출하 거르기)는
 * due-date-inversion.test.ts 가 통째로 쥐고 있다. 여기서는 **알림이 그 함수를
 * 쓰는가**만 보고, 조건을 다시 적지 않는다.
 * ============================================================================
 */

const KIND = "REPAIR_CASE_DUE_DATE_INVERTED";
const CASE_ID = "44444444-4444-4444-8444-444444444444";

/** 지금 역전인 수리 건 한 줄 — 목표일(11-05)이 요청일(10-30)보다 뒤다. */
function invertedRow(overrides: Partial<Parameters<typeof isRepairCaseDueDateInverted>[0]> = {}) {
  return {
    internalTargetShipmentDate: "2094-11-05" as string | null,
    customerRequestedDueDate: "2094-10-30" as string | null,
    domesticOrderDueDates: [] as readonly string[],
    status: "IN_REPAIR" as const,
    actualShipmentDate: null as string | null,
    ...overrides,
  };
}

// ────────────────── 🔴 뜨는 조건은 **화면 셋이 쓰는 그 함수**가 정한다

test("🔴 표본 확인 — 알림이 쓰는 그 함수가 이 표본을 역전으로 본다", () => {
  // 이 줄이 없으면 아래 「뒤집으면 꺼진다」들이 **애초에 역전이 아니어서** 통과할 수
  // 있다. 조건을 여기 적는 것이 아니라, 재는 대상이 비어 있지 않음을 먼저 못 박는다.
  assert.equal(isRepairCaseDueDateInverted(invertedRow()), true);
});

test("🔴 출하 완료 거르기가 **공짜로 따라온다** — 알림 쪽에 다시 적지 않았다", () => {
  // 사용자 결정은 「이미 나간 건에는 안 뜬다」(2026-10-30)이고, 그 거르기는 화면 셋이
  // 쓰는 함수 **안에** 있다. 알림이 그 함수를 부르는 한 이 보증은 저절로 따라온다 —
  // 조회가 조건을 베껴 적었다면 여기서는 여전히 통과하고 아래 소스 검사에서 걸린다.
  assert.equal(isRepairCaseDueDateInverted(invertedRow({ status: "SHIPMENT_COMPLETED" })), false);
  assert.equal(
    isRepairCaseDueDateInverted(invertedRow({ actualShipmentDate: "2094-11-01" })),
    false,
    "출하일이 찍힌 건은 단계가 뒤처져 있어도 이미 나간 것이다"
  );
});

test("🔴 빌려 온 날짜로도 역전이 된다 — 그래서 알림에 표시가 필요하다", () => {
  // 고객 요청 납기일 칸이 비면 연결된 내자의 납기요청일 중 가장 이른 하루로 잰다
  // (2026-10-29 사용자 결정). 이 길이 살아 있다는 것이 아래 detail 의 표시가 **실제로
  // 쓰이는 자리**가 있다는 뜻이다 — 없으면 그 가지는 영영 안 돈다.
  assert.equal(
    isRepairCaseDueDateInverted(
      invertedRow({ customerRequestedDueDate: null, domesticOrderDueDates: ["2094-10-30"] })
    ),
    true
  );
});

// ───────────────────────────────────────────────────── 알림 한 줄의 모양

test("🔴 알림 글자에 「납기 요청일 협의가 필요합니다.」가 그대로 들어 있다", () => {
  const item = buildRepairCaseDueDateInvertedNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    internalTargetShipmentDate: "2094-11-05",
    requestedDueDate: "2094-10-30",
    borrowed: false,
  });

  assert.equal(item.kind, KIND);
  assert.equal(item.id, `REPAIR_CASE_DUE_DATE_INVERTED:${CASE_ID}`);
  assert.equal(item.targetKey, CASE_ID, "한 건에 역전은 하나뿐이라 건 단위로 센다");
  assert.equal(item.subject, "D261015", "어느 건인지는 인수번호가 말한다");
  assert.equal(
    item.detail,
    "납기 요청일 협의가 필요합니다. · 사내 목표 출하일 2094-11-05 · 고객 요청 납기일 2094-10-30"
  );
  // 🔴 글자를 두 곳에 적지 않는다 — 화면 넷이 쓰는 상수 한 곳이 이 말을 쥔다.
  //    (상수 쪽이 바뀌면 이 단언이 깨지고, 그때 종의 글자도 함께 바뀐 것이다.)
  assert.equal(DUE_DATE_INVERSION_NOTE, "납기 요청일 협의가 필요합니다.");
  assert.ok(item.detail.startsWith(DUE_DATE_INVERSION_NOTE), item.detail);
  // 🔴 메모가 **앞**이다. 종 패널의 상세 칸은 한 줄에서 잘리므로(CSS truncate) 뒤에
  //    두면 사용자가 요구한 그 문장이 잘려 나갈 수 있다.
  assert.ok(item.detail.indexOf("사내 목표 출하일") > 0, item.detail);
});

test("🔴 두 날짜가 **각각 이름을 달고** 들어간다 — 어느 쪽이 우리 날인지 알아야 고친다", () => {
  const item = buildRepairCaseDueDateInvertedNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    internalTargetShipmentDate: "2094-11-05",
    requestedDueDate: "2094-10-30",
    borrowed: false,
  });
  // 이름 없이 날짜만 둘 적으면 어느 쪽이 사내 목표 출하일인지 알 수 없다.
  assert.ok(item.detail.includes("사내 목표 출하일 2094-11-05"), item.detail);
  assert.ok(item.detail.includes("고객 요청 납기일 2094-10-30"), item.detail);
  // 우리 날짜가 먼저다 — 사람이 고칠 수 있는 칸이 그쪽이다.
  assert.ok(
    item.detail.indexOf("사내 목표 출하일") < item.detail.indexOf("고객 요청 납기일"),
    item.detail
  );
});

test("🔴 빌려 온 납기일에는 표시가 붙는다 — 「내가 적은 값」으로 읽히면 안 된다", () => {
  const borrowed = buildRepairCaseDueDateInvertedNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    internalTargetShipmentDate: "2094-11-05",
    requestedDueDate: "2094-10-30",
    borrowed: true,
  });
  // 표시 글자는 새로 쓰지 않고 상세정보 화면이 이미 쓰는 상수를 그대로 가져온다 —
  // 같은 것을 두 말로 부르면 사람이 둘을 다른 사실로 읽는다.
  assert.equal(DUE_DATE_FROM_DOMESTIC_ORDER_LABEL, "내자 정리에서 작성됨");
  assert.equal(
    borrowed.detail,
    "납기 요청일 협의가 필요합니다. · 사내 목표 출하일 2094-11-05 · " +
      "고객 요청 납기일 2094-10-30 (내자 정리에서 작성됨)"
  );

  const own = buildRepairCaseDueDateInvertedNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    internalTargetShipmentDate: "2094-11-05",
    requestedDueDate: "2094-10-30",
    borrowed: false,
  });
  // 🔴 반대쪽도 본다 — 표시가 **언제나** 붙으면 이 건에 적어 둔 값까지 남의 값으로
  //    읽히고, 위 단언만으로는 그것을 못 잡는다.
  assert.ok(
    !own.detail.includes(DUE_DATE_FROM_DOMESTIC_ORDER_LABEL),
    `자기 칸의 날짜에도 표시가 붙었다: ${own.detail}`
  );
});

test("누르면 두 날짜를 고치는 화면으로 간다 — 사용자가 못 박은 「수리건 상세」다", () => {
  const item = buildRepairCaseDueDateInvertedNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    internalTargetShipmentDate: "2094-11-05",
    requestedDueDate: "2094-10-30",
    borrowed: false,
  });
  assert.equal(item.href, `/repair-cases/${CASE_ID}`);
  assert.equal(item.href, repairCaseDetailHrefs(CASE_ID).root, "주소는 탭 헬퍼와 같은 것을 써야 한다");
});

test("건마다 한 줄이고 배지는 건 단위로 센다 — 남의 종류를 세지 않는다", () => {
  const first = buildRepairCaseDueDateInvertedNotification({
    repairCaseId: "case-a",
    intakeNumber: "D261001",
    internalTargetShipmentDate: "2094-11-05",
    requestedDueDate: "2094-10-30",
    borrowed: false,
  });
  const second = buildRepairCaseDueDateInvertedNotification({
    repairCaseId: "case-b",
    intakeNumber: "D261002",
    internalTargetShipmentDate: "2094-12-01",
    requestedDueDate: "2094-11-20",
    borrowed: true,
  });
  assert.notEqual(first.id, second.id, "React key 가 겹치면 한 줄이 사라진다");

  const counts = countNotificationTargetsByKind([first, second]);
  assert.equal(counts.REPAIR_CASE_DUE_DATE_INVERTED, 2);
  assert.equal(counts.REPAIR_CASE_TARGET_SHIPMENT_MISSING, 0, "이웃한 할 일 알림이 이것을 세면 안 된다");
});

// ────────────────── 🔴 눌러서 확인해도 사라지지 않는다 (「승인용」의 뜻)

test("🔴 이 종류는 ACKNOWLEDGEABLE_NOTIFICATION_KINDS 에 **없다**", () => {
  // 들어가는 순간 종에 확인 단추가 생기고, 누르면 날짜를 그대로 둔 채 사라진다 —
  // 사용자가 「마찬가지로 승인용으로」라고 한 말이 정반대가 된다.
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
  const item = buildRepairCaseDueDateInvertedNotification({
    repairCaseId: CASE_ID,
    intakeNumber: "D261015",
    internalTargetShipmentDate: "2094-11-05",
    requestedDueDate: "2094-10-30",
    borrowed: false,
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
    block.includes("listRepairCasesWithDueDateInverted()"),
    "덩어리에 제 조회가 없다 — 자르기가 틀렸다"
  );
  assert.ok(
    !block.includes("listRepairCasesMissingTargetShipmentDate("),
    "덩어리가 남의 조회까지 삼켰다 — 자르기가 틀렸다"
  );

  assert.ok(!block.includes("withoutAcknowledged("), "확인 기록을 대 본다");
  assert.ok(
    block.includes("buildRepairCaseDueDateInvertedNotification("),
    "모양 변환을 도메인에 맡기지 않는다"
  );
  // load 가 사용자도 역할도 받지 않는다 — 역할을 가르는 자리는 알림 설정이다.
  assert.match(block, /load:\s*async\s*\(\s*\)\s*=>/, "load 가 인자를 받는다");
  assert.ok(!block.includes("actorRole"), "load 가 역할을 본다 — 설정 화면의 스위치가 죽은 단추가 된다");
  assert.match(
    registrySource,
    /import \{[^}]*\blistRepairCasesWithDueDateInverted\b[^}]*\} from "\.\/repair-case-due-date-inverted-notifications"/,
    "전용 조회를 그 파일에서 가져오지 않는다"
  );
});

// ──────────────── 🔴 받는 사람 — A/S 엔지니어 · 영업 · 관리자

test("🔴 기본값은 엔지니어·영업·관리자가 받는다 — 재고 담당자는 안 받는다", () => {
  assert.equal(defaultNotificationKindEnabled(KIND), true, "켜진 채로 태어난다");
  for (const role of ["AS_ENGINEER", "SALES", "ADMIN"] as const) {
    assert.equal(defaultRoleReceivesNotification(KIND, role), true, `${role} 에게 안 간다`);
    assert.equal(deliversNotification(KIND, role, NO_NOTIFICATION_SETTINGS), true, `${role} 에게 안 간다`);
  }
  assert.equal(defaultRoleReceivesNotification(KIND, "INVENTORY_MANAGER"), false);
  assert.equal(deliversNotification(KIND, "INVENTORY_MANAGER", NO_NOTIFICATION_SETTINGS), false);
});

test("🔴 이웃한 할 일 알림과 **명단이 다르다** — 둘을 한 질문으로 묶지 않았다", () => {
  // 사내 목표 출하일 미등록은 빈칸을 **적으면** 끝나는 일이라 적는 사람(엔지니어)
  // 하나이고, 역전은 **고객과 협의해야** 끝나는 일이라 영업·관리자가 함께 받는다
  // (2026-10-29 · 10-30 사용자 결정). 두 명단이 같아지면 그 구별이 사라진 것이다.
  for (const role of ["SALES", "ADMIN"] as const) {
    assert.equal(
      defaultRoleReceivesNotification("REPAIR_CASE_TARGET_SHIPMENT_MISSING", role),
      false,
      `${role} 이 사내 목표 출하일 미등록까지 함께 열렸다`
    );
    assert.equal(defaultRoleReceivesNotification(KIND, role), true);
  }
});

test("🔴 최고관리자는 받는다 — 종류를 가리지 않는 잠금이다(끌 수 없다)", () => {
  // 사용자 결정은 「엔지니어·영업·관리자」였지만, 이 저장소에는 「최고관리자가 받는
  // 것은 이 화면에서 끌 수 없다」는 잠금이 종류와 무관하게 걸려 있다
  // (isRoleEditableInNotificationSettings). 숨기지 않고 여기 적어 둔다 — 알림 설정
  // 화면도 그렇게 그린다.
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

test("🔴 역할 스위치로 **열고 닫을 수 있다** — 죽은 단추가 아니다", () => {
  // 기본이 거짓인 칸이 켜진다. 조회에 역할을 박았다면 켜도 아무 일이 없다.
  assert.equal(
    deliversNotification(KIND, "INVENTORY_MANAGER", {
      kindEnabled: {},
      roleReceives: { [KIND]: { INVENTORY_MANAGER: true } },
    }),
    true,
    "관리자가 켜도 안 열린다 — 죽은 스위치다"
  );
  // 기본이 참인 칸도 닫힌다.
  assert.equal(
    deliversNotification(KIND, "SALES", { kindEnabled: {}, roleReceives: { [KIND]: { SALES: false } } }),
    false
  );
  // 종류를 끄면 켜 둔 역할에게도 안 간다(두 스위치는 다른 축이다).
  assert.equal(
    deliversNotification(KIND, "AS_ENGINEER", { kindEnabled: { [KIND]: false }, roleReceives: {} }),
    false
  );
});

test("🔴 이 결정이 남의 종류를 함께 좁히지 않았다", () => {
  // 역할로 갈리는 종류가 둘이 되면서, 새 명단이 옆 종류로 새지 않았는지 본다.
  const narrowed = new Set<string>([KIND, "REPAIR_CASE_TARGET_SHIPMENT_MISSING"]);
  let checked = 0;
  for (const kind of NOTIFICATION_KINDS) {
    if (narrowed.has(kind)) continue;
    for (const role of ROLE_CODES) {
      assert.equal(defaultRoleReceivesNotification(kind, role), true, `${kind} × ${role} 이 함께 좁혀졌다`);
      checked += 1;
    }
  }
  // 🔵 빈 고리를 돌면 아무것도 재지 않고 통과한다 — 몇 칸을 봤는지 먼저 못 박는다.
  assert.equal(checked, (NOTIFICATION_KINDS.length - narrowed.size) * ROLE_CODES.length);
  assert.ok(checked > 0, "좁혀지지 않은 종류가 하나도 없다 — 이 시험이 아무것도 안 본다");
});

test("이름·설명·색 — 관리자가 설명만 읽고 무엇을 끄는지 알 수 있다", () => {
  const meta = NOTIFICATION_KIND_META[KIND];
  assert.equal(meta.label, "납기 역전");
  // 무엇으로 뜨는가 · 어떻게 사라지는가 · 누가 받는가 셋이 다 적혀 있어야 한다.
  // 🔴 까닭 문장은 화면이 title 로 쓰는 상수를 그대로 가져온다 — 설명과 화면이 다른
  //    말을 하면 같은 사실이 자리에 따라 다르게 읽힌다.
  assert.ok(meta.description.includes(DUE_DATE_INVERSION_REASON_NOTE), meta.description);
  assert.ok(meta.description.includes(DUE_DATE_INVERSION_NOTE), meta.description);
  assert.ok(meta.description.includes(DUE_DATE_FROM_DOMESTIC_ORDER_LABEL), meta.description);
  assert.ok(meta.description.includes("눌러서 확인하는 알림이 아니"), meta.description);
  assert.ok(meta.description.includes("A/S 엔지니어·영업·관리자"), meta.description);
  assert.ok(meta.description.includes("최고관리자"), meta.description);

  // 🔴 **주황 계열이다 — 2026-10-30 사용자 요청**(「주황색 계열로 알림을 띄우도록」).
  //    그런데 **남의 색을 쓰면 안 된다** — 빨강은 납기 임박, 장미는 반려됨, 주황은
  //    바로 옆의 사내 목표 출하일 미등록이 이미 쓰고 있다. 그래서 호박이다.
  const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
  const others = NOTIFICATION_KINDS.filter((kind) => kind !== KIND).map((kind) =>
    hueOf(NOTIFICATION_KIND_META[kind].toneClassName)
  );
  const hue = hueOf(meta.toneClassName);
  assert.ok(hue, meta.toneClassName);
  assert.ok(others.length > 0, "견줄 다른 종류가 없다 — 이 시험이 아무것도 안 본다");
  assert.ok(!others.includes(hue), `남의 색(${hue})을 쓴다`);
  assert.ok(
    ["amber", "orange", "red", "rose", "pink"].includes(hue),
    `주황 계열이 아니다(${hue}) — 2026-10-30 사용자 요청이다`
  );
  // 🔵 어두운 화면 짝까지 한 벌이어야 한다(모양 검사와 칸 번호 맞대기는
  //    notification-settings.test.ts 가 전 종류에 대해 한다 — 이 종류의 색은 사용자가
  //    직접 정한 것이라 여기서도 글자 그대로 못 박는다).
  assert.equal(meta.toneClassName, "text-amber-700 dark:text-amber-400");
  assert.equal(meta.toneIndex, 14, "호박 칸이 아니면 묶음 종이 다른 색으로 그린다");
});

// ─────────────────────────────── 🔴 조회는 DB 에 아무것도 쓰지 않는다

const QUERY_SOURCE = readFileSync(
  new URL("../db/queries/repair-case-due-date-inverted-notifications.ts", import.meta.url),
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
  // 트랜잭션도 열지 않는다 — 읽기만 하는 파일에 그 말이 생기면 쓰기가 들어온 것이다.
  assert.ok(!QUERY_SOURCE.includes("db.transaction("), "조회 파일이 트랜잭션을 연다");
});

test("🔴 조회가 역전 판정을 **베껴 적지 않고** 화면 셋이 쓰는 함수를 부른다", () => {
  assert.ok(
    QUERY_SOURCE.includes("isRepairCaseDueDateInverted("),
    "역전 판정을 domain/due-date-inversion.ts 에서 가져오지 않는다"
  );
  assert.match(
    QUERY_SOURCE,
    /import \{[^}]*\bisRepairCaseDueDateInverted\b[^}]*\} from "@\/lib\/domain\/due-date-inversion"/,
    "그 판정을 제 파일에 또 만들어 두었다"
  );
  // 🔴 판정을 SQL 로 옮기지 않았는가 — 두 날짜를 견주는 비교가 질의 안에 있으면
  //    화면과 종이 다른 말을 하기 시작한다.
  for (const forbidden of ["gt(repairCases.internalTargetShipmentDate", "sql`"]) {
    assert.ok(!QUERY_SOURCE.includes(forbidden), `판정을 SQL 로 옮겼다: ${forbidden}`);
  }
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

test("🔴 세는 도구는 종에 뜨는 그 조회를 부른다 — 수를 따로 세지 않는다", () => {
  // 세는 SQL 을 도구에 한 벌 더 적으면 재어 놓은 수와 실제로 뜨는 수가 조용히
  // 달라지고, 그때는 틀린 수를 보고 켤지 말지를 정하게 된다.
  const tool = readFileSync(new URL("../../../scripts/check-due-date-inverted.ts", import.meta.url), "utf8");
  assert.ok(tool.includes("countDueDateInversionStages("), "단계별 세기를 조회 파일에서 가져오지 않는다");
  assert.ok(tool.includes("listRepairCasesWithDueDateInverted("), "실제 줄과 맞대어 보지 않는다");
  assert.ok(!tool.includes(".select("), "도구가 제 SQL 을 들고 있다");
  for (const forbidden of [".insert(", ".update(", ".delete("]) {
    assert.ok(!tool.includes(forbidden), `읽기 도구가 ${forbidden} 를 쓴다`);
  }
  // 도구가 package.json 에 실제로 걸려 있어야 운영에서 부를 수 있다.
  const pkg = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
  assert.ok(pkg.includes("scripts/check-due-date-inverted.ts"), "npm 스크립트로 걸려 있지 않다");
});
