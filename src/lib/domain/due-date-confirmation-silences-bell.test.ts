import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isDomesticOrderDueDateRowConfirmed,
  isRepairCaseDueDateSilencedByConfirmation,
} from "./notifications";

/**
 * ============================================================================
 * 🔴 [납기일 확정]이 끄는 것은 **「납기 임박」의 종뿐**이다 (2026-11-25)
 * ============================================================================
 * 사용자 요구 원문: 「납기 요청일 옆에 [납기일 확정] 버튼을 만들어줘 … 이 버튼을 누르면
 * 포털의 알림 중에 **[납기 임박] 알림이 뜨지 않도록** 해줘.」 그리고 그 자리에서 정해진
 * 결정 넷 가운데 둘이 **끄지 않을 것**을 말한다:
 *
 *   · 🔴 **배지와 붉은 날짜는 그대로 뜬다** — 날짜가 다가온다는 사실 자체는 확정으로
 *     변하지 않는다. (기타건 쪽 짝은 domain/misc-case-due-date-near.test.ts 가 잰다.)
 *   · 🔴 **「납기 지연」은 그대로 뜬다** — 끄는 것은 「납기 임박」뿐이다.
 *
 * 🔴 **「끈다」만 재면 전부 꺼 버린 구현이 통과한다.** 그래서 이 파일은 켜져 있어야 하는
 * 자리를 먼저 세고(③④), 그다음 꺼지는 자리를 센다.
 *
 * 못 박는 것 넷
 *  ① 🔴 **수리 건 쪽 접는 규칙** — 붙어 있는 내자 회차가 **전부** 확정이어야 끈다.
 *     🔴 **회차가 하나도 없으면 안 끈다**(`[].every(...)` 는 참이다 — 그대로 두면
 *     내자가 안 붙은 건, 곧 A/S 의 대부분이 통째로 조용해진다).
 *  ② 🔴 **조회가 그 판정을 부른다** — 수리 건 종 알림 조회가 확정 묶음을 읽어 와
 *     도메인에 묻는다. 접는 규칙을 조회가 손으로 적으면 ① 이 아무 데도 안 걸린다.
 *  ③ 🔴 **「납기 지연」은 확정을 한 글자도 모른다** — 판정도 조회도.
 *  ④ 🔴 **수리 건 배지도 확정을 모른다**(isRepairCaseDueDateNear).
 *
 * 🔴 조회(db/queries/…)는 server-only 와 DB 를 끌고 들어와 단위 시험에서 부를 수 없다.
 * 그래서 이웃들이 쓰는 방법 그대로 **원본 글자**로 계약을 붙잡는다. 진짜 DB 위에서
 * 무엇이 꺼지고 무엇이 남는지는 db 목록의 통합 시험이 따로 본다
 * (queries/due-date-near-confirmation.integration.test.ts).
 * ============================================================================
 */

const ROOT = new URL("../../../", import.meta.url);
/**
 * 🔴 **주석을 걷어내고 읽는다.** 이 변경의 주석들이 함수 이름과 `.every(` 를 글자
 * 그대로 담고 있어서(「여기서 .every(…) 를 손으로 적으면 안 된다」 같은 줄), 안 걷으면
 * 「없어야 한다」 쪽이 거짓으로 걸리고 「있어야 한다」 쪽은 주석만으로 공짜로 통과한다.
 */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, ROOT), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 확정된 회차 하나 / 아직 아닌 회차 하나. */
const confirmed = { confirmedAt: new Date("2094-10-20T00:00:00.000Z") };
const open = { confirmedAt: null };

describe("① 🔴 수리 건 — **전부** 확정일 때만 끈다", () => {
  test("🔵 못 — 두 표본이 실제로 갈려 있다(한 회차짜리 판정이 먼저 맞아야 한다)", () => {
    assert.equal(isDomesticOrderDueDateRowConfirmed(confirmed), true);
    assert.equal(isDomesticOrderDueDateRowConfirmed(open), false);
  });

  test("회차 하나가 확정이면 끈다 — 가장 흔한 모양(내자 줄 하나 · 회차 하나)", () => {
    assert.equal(isRepairCaseDueDateSilencedByConfirmation([confirmed]), true);
  });

  test("🔴 **하나라도 안 확정이면 안 끈다** — 그 날짜는 아직 움직일 수 있다", () => {
    assert.equal(isRepairCaseDueDateSilencedByConfirmation([confirmed, open]), false);
    assert.equal(isRepairCaseDueDateSilencedByConfirmation([open, confirmed]), false);
    assert.equal(isRepairCaseDueDateSilencedByConfirmation([open]), false);
  });

  test("회차 셋이 **전부** 확정이면 끈다 — 분할 발주(내자 줄이 여럿)도 한 묶음이다", () => {
    assert.equal(isRepairCaseDueDateSilencedByConfirmation([confirmed, confirmed, confirmed]), true);
  });

  test("🔴 **회차가 하나도 없으면 거짓** — 내자가 안 붙은 건의 종이 통째로 꺼지는 자리다", () => {
    // `[].every(...)` 는 참이다. 그대로 쓰면 「납기 임박」이 거의 전부 사라지는데,
    // 「확정하면 꺼지는가」만 재는 시험은 그래도 전부 초록으로 남는다.
    assert.equal(isRepairCaseDueDateSilencedByConfirmation([]), false);
  });

  test("🔵 확정 시각은 `Date` 로도 ISO 글자로도 들어온다 — 조회와 화면이 모양이 다르다", () => {
    assert.equal(
      isRepairCaseDueDateSilencedByConfirmation([{ confirmedAt: "2094-10-20T00:00:00.000Z" }]),
      true
    );
  });
});

describe("② 🔴 수리 건 종 알림 조회가 그 판정을 부른다", () => {
  const QUERY = read("src/lib/db/queries/repair-case-due-date-notifications.ts");
  const SHARED = read("src/lib/db/queries/repair-case-domestic-order-due-dates.ts");

  test("🔵 못 — 두 원본이 실제로 읽혔다(주석을 걷어낸 뒤에도 남아 있다)", () => {
    assert.ok(QUERY.includes("export async function listRepairCasesWithDueDateNear"), "조회 원본이 아니다");
    assert.ok(
      SHARED.includes("export async function loadDomesticOrderDueDatesByCaseId"),
      "공용 조각 원본이 아니다"
    );
  });

  test("🔴 확정 묶음을 **공용 조각**에서 읽어 와 도메인에 묻는다", () => {
    assert.ok(
      QUERY.includes("loadDomesticOrderDueDateConfirmationsByCaseId("),
      "확정을 읽어 오지 않는다 — 확정해도 종이 그대로 운다"
    );
    assert.match(
      QUERY,
      /import \{[^}]*\bloadDomesticOrderDueDateConfirmationsByCaseId\b[^}]*\} from "\.\/repair-case-domestic-order-due-dates"/,
      "확정을 읽는 SQL 을 제 파일에 따로 들고 있다 — 날짜와 확정이 다른 조건으로 읽힌다"
    );
    assert.ok(
      QUERY.includes("isRepairCaseDueDateSilencedByConfirmation("),
      "접는 규칙을 도메인에 묻지 않는다"
    );
  });

  test("🔴 조회가 접는 규칙을 **손으로 적지 않는다** — 빈 목록이 참이 되는 자리다", () => {
    // `rows.every(...)` 를 조회가 직접 적으면 회차가 없는 건에서 참이 되어, 내자가 안
    // 붙은 건의 종이 통째로 꺼진다(①의 마지막 시험이 막는 바로 그 실패).
    assert.equal(QUERY.includes(".every("), false, "조회가 「전부 확정인가」를 손으로 센다");
    assert.equal(QUERY.includes("confirmedAt !== null"), false, "조회가 확정 판정을 다시 적는다");
  });

  test("🔴 공용 조각의 두 질의가 **같은 조건**으로 같은 표를 읽는다", () => {
    // 날짜는 빌려 오는데 확정은 안 보이는(또는 그 반대인) 건이 생기면, 종은 울려야 할
    // 때 조용하거나 조용해야 할 때 운다. 둘이 한 파일에 있는 까닭이다.
    const start = SHARED.indexOf("export async function loadDomesticOrderDueDateConfirmationsByCaseId");
    assert.ok(start > 0, "확정 로더를 못 찾았다 — 이름이 바뀌었다");
    const body = SHARED.slice(start);
    assert.ok(body.length > 300, `확정 로더 본문이 너무 짧다(${body.length})`);
    assert.ok(body.includes("eq(domesticOrders.isDeleted, false)"), "휴지통에 든 내자 줄까지 센다");
    assert.ok(body.includes("caseIds.length === 0"), "빈 배열에도 질의를 돌린다");
    assert.ok(body.includes("row.repairCaseId === null"), "null 인 repair_case_id 를 안 거른다");
    // 🔴 읽는 표가 날짜 쪽과 같은 표인가 — 다른 표를 읽으면 위 조건들이 뜻을 잃는다.
    assert.ok(body.includes(".from(domesticOrderDueDates)"), "회차 표를 안 읽는다");
  });
});

describe("③ 🔴 「납기 지연」은 확정을 한 글자도 모른다 — 사용자 결정 2", () => {
  const OVERDUE_DOMAIN = read("src/lib/domain/repair-case-overdue.ts");
  const OVERDUE_QUERY = read("src/lib/db/queries/repair-case-overdue-notifications.ts");

  test("🔵 못 — 두 원본이 실제로 그 둘이다(주석을 걷어낸 뒤에도 남아 있다)", () => {
    assert.ok(OVERDUE_DOMAIN.includes("export function isRepairCaseOverdue"), "판정 원본이 아니다");
    assert.ok(
      OVERDUE_QUERY.includes("export async function listRepairCasesOverdue"),
      "조회 원본이 아니다"
    );
  });

  test("🔴 판정에도 조회에도 `confirmed` 가 없다 — 확정해도 지연은 그대로 뜬다", () => {
    // 지난 날짜가 지났다는 사실은 확정으로 변하지 않는다. 여기에 확정이 들어오면
    // **사과할 일을 숨기는 길**이 생긴다(그 알림에 확인 단추를 안 단 까닭과 같다).
    assert.equal(/confirmed/i.test(OVERDUE_DOMAIN), false, "지연 판정이 확정을 본다");
    assert.equal(/confirmed/i.test(OVERDUE_QUERY), false, "지연 조회가 확정을 본다");
  });
});

describe("④ 🔴 수리 건 **배지**도 확정을 모른다 — 끄는 것은 종뿐이다", () => {
  const DOMAIN = read("src/lib/domain/notifications.ts");

  test("isRepairCaseDueDateNear 의 본문에 `confirmed` 가 없다", () => {
    const start = DOMAIN.indexOf("export function isRepairCaseDueDateNear");
    assert.ok(start > 0, "배지 판정을 못 찾았다 — 이름이 바뀌었다");
    const end = DOMAIN.indexOf("\n}\n", start);
    assert.ok(end > start, "배지 판정의 본문 끝을 못 찾았다");
    const body = DOMAIN.slice(start, end);
    assert.ok(body.includes("return"), "엉뚱한 자리를 잘랐다");
    assert.equal(
      /confirmed/i.test(body),
      false,
      "배지 판정이 확정을 본다 — 확정하면 표의 배지와 붉은 날짜까지 사라진다"
    );
  });
});
