import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  DOMESTIC_ORDER_DATES_NONE_NOTE,
  DOMESTIC_ORDER_DATES_SECTION_NOTE,
  DOMESTIC_ORDER_LIST_HREF,
  DOMESTIC_ORDER_LIST_LINK_TEXT,
  DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL,
  DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL,
  formatMultipleDomesticOrderRowsNotice,
  resolveRepairCaseDomesticOrderDates,
  type RepairCaseDomesticOrderRow,
} from "./repair-case-domestic-order-dates";
import { pickWeeklyReportOrderDates } from "./weekly-report";

/**
 * ============================================================================
 * 수리 건 상세 「내자 정리 발행일」 — 읽어서 그리기만 하는가
 * ============================================================================
 * 지키는 것은 넷이다.
 *
 *  1. **줄 0개·1개·N개를 가르는 판정이 맞는가** — 화면은 kind 하나만 보고
 *     갈라지고, 세 경우에 각각 다른 것이 붙는다.
 *  2. 🔴 **접는 일을 pickWeeklyReportOrderDates 가 한다** — 규칙을 베껴 적은
 *     구현으로 바뀌면 이 대조가 그 자리에서 깨져야 한다. 주간보고 상세표와 같은
 *     자료를 다른 날짜로 보여 주면 어느 쪽도 믿을 수 없게 된다.
 *  3. 🔴 **접는 함수가 저장하는 쪽으로 새어 들어가지 않는다** — 2026-09-29 부터
 *     이 구역에서 두 날짜를 고칠 수 있지만, 저장 payload 에 실리는 값은 화면이
 *     **그 줄 하나**에서 읽은 값이어야 한다. 접은 값이 다른 줄에 저장되면 그 줄에
 *     박제된다(domestic-order-cell-edit.ts 의 함정 ②). 그래서 (a) mutation ·
 *     검증 · 서버 액션이 이 모듈을 불러 쓰지 않고, (b) 편집은 줄이 **하나거나
 *     없을 때만** 열린다 — 그 판정은 domain/domestic-order-issue-date-edit.ts 의
 *     몫이고 화면과 서버가 함께 부른다.
 *  4. 화면에 적히는 글자가 서로 어긋나지 않는가(안내 문장 ↔ 링크 글자).
 *
 * 여기서 확인하지 않는 것: **권한이 없으면 구역이 안 그려지는가**와 이름표가
 * 주간보고와 같은 글자인가는 화면 쪽 시험이 본다
 * (components/repair-cases/detail/domestic-order-dates-section.test.ts).
 * ============================================================================
 */

/** 내자 줄 하나. 이 파일이 보는 두 칸만 만든다. */
function row(
  quoteIssuedDate: string | null,
  orderIssuedDate: string | null
): RepairCaseDomesticOrderRow {
  return { quoteIssuedDate, orderIssuedDate };
}

// ── ① 줄 0개·1개·N개 ────────────────────────────────────────────────────

describe("줄 수를 가르는 판정", () => {
  test("0개 — 두 날짜가 비고, 안내를 붙일 경우로 갈린다", () => {
    const display = resolveRepairCaseDomesticOrderDates([]);
    assert.equal(display.kind, "NONE");
    assert.equal(display.rowCount, 0);
    assert.equal(display.quoteIssuedDate, null);
    assert.equal(display.orderIssuedDate, null);
  });

  test("1개 — 그 줄의 두 값이 그대로 보인다", () => {
    const display = resolveRepairCaseDomesticOrderDates([row("2026-01-20", "2026-02-15")]);
    assert.equal(display.kind, "SINGLE");
    assert.equal(display.rowCount, 1);
    assert.equal(display.quoteIssuedDate, "2026-01-20");
    assert.equal(display.orderIssuedDate, "2026-02-15");
  });

  test("1개인데 날짜가 비어 있어도 SINGLE 이다 — 줄이 없는 것과 다른 일이다", () => {
    // 줄은 있는데 아직 견적도 발주도 안 나간 건이다. 「내자 정리에 줄이 아직
    // 없습니다」를 띄우면 거짓말이 된다.
    const display = resolveRepairCaseDomesticOrderDates([row(null, null)]);
    assert.equal(display.kind, "SINGLE");
    assert.equal(display.rowCount, 1);
    assert.equal(display.quoteIssuedDate, null);
    assert.equal(display.orderIssuedDate, null);
  });

  test("2개 이상 — MULTIPLE 이고 몇 줄인지 함께 나온다", () => {
    // 분할 발주가 이 모양이다(repair_case_id 에 유일 제약이 없다).
    const display = resolveRepairCaseDomesticOrderDates([
      row("2026-01-20", "2026-02-15"),
      row("2026-03-02", "2026-03-20"),
      row("2026-05-01", null),
    ]);
    assert.equal(display.kind, "MULTIPLE");
    assert.equal(display.rowCount, 3);
  });

  test("세 갈래뿐이다 — 화면이 rowCount 로 다시 세지 않아도 된다", () => {
    const kinds = [0, 1, 2, 7].map(
      (n) => resolveRepairCaseDomesticOrderDates(Array.from({ length: n }, () => row(null, null))).kind
    );
    assert.deepEqual(kinds, ["NONE", "SINGLE", "MULTIPLE", "MULTIPLE"]);
  });
});

// ── ② 🔴 접는 일은 주간보고와 같은 함수가 한다 ──────────────────────────

describe("🔴 여럿을 하나로 접는 일", () => {
  test("주간보고 상세표와 **같은 답**이다 — 같은 함수를 부른다", () => {
    // 규칙을 베껴 적은 구현으로 바뀌면 여기서 깨져야 한다.
    const rows = [
      row("2026-01-20", "2026-02-15"),
      row("2025-12-01", "2026-01-05"),
      row("2026-03-02", "2026-03-20"),
    ];
    const display = resolveRepairCaseDomesticOrderDates(rows);
    const picked = pickWeeklyReportOrderDates(rows);
    assert.equal(display.quoteIssuedDate, picked.quoteIssuedDate);
    assert.equal(display.orderIssuedDate, picked.orderIssuedDate);
  });

  test("발주발행일이 가장 이른 줄이다 — 늦은 줄(추가·분할 발주)이 아니다", () => {
    const display = resolveRepairCaseDomesticOrderDates([
      row("2026-03-02", "2026-03-20"),
      row("2025-12-01", "2026-01-05"),
    ]);
    assert.equal(display.orderIssuedDate, "2026-01-05");
    // 🔴 두 날짜를 각각 다른 줄에서 뽑지 않는다 — 고른 줄의 두 값을 그대로 쓴다.
    assert.equal(display.quoteIssuedDate, "2025-12-01");
  });

  test("어느 줄에도 발주일이 없으면 견적발행일이 가장 이른 줄이다", () => {
    const display = resolveRepairCaseDomesticOrderDates([
      row("2026-03-02", null),
      row("2026-01-20", null),
    ]);
    assert.equal(display.quoteIssuedDate, "2026-01-20");
    assert.equal(display.orderIssuedDate, null);
  });

  test("🔴 고객 포털의 규칙(견적발행일이 가장 늦은 줄)을 베끼지 않았다", () => {
    // queries/domestic-orders.ts 의 listQuoteInfoForRepairCases 는 일부러 다른
    // 규칙을 쓴다. 맞출 상대는 주간보고다.
    const display = resolveRepairCaseDomesticOrderDates([
      row("2026-01-20", null),
      row("2026-09-30", null),
    ]);
    assert.equal(display.quoteIssuedDate, "2026-01-20", "가장 늦은 줄을 골랐다 — 포털 규칙이다");
  });

  test("이 파일이 제 손으로 고르지 않는다 — 원본에 sort/filter/reduce 가 없다", () => {
    const code = readFileSync(new URL("./repair-case-domestic-order-dates.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(code, /pickWeeklyReportOrderDates\(rows\)/);
    assert.ok(!/\.sort\(|\.reduce\(|\.filter\(/.test(code), "고르는 규칙을 여기서 새로 적었다");
  });
});

// ── ③ 🔴 그릴 값이지 저장할 값이 아니다 ─────────────────────────────────

/** 그 폴더 아래 모든 .ts(x) 파일 경로. 저장 쪽이 이 모듈을 불러 쓰는지 훑는다. */
function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectSourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

test("🔴 저장하는 쪽은 이 모듈을 쓰지 않는다 — 계산된 값이 payload 에 실릴 자리가 없다", () => {
  // 두 날짜의 집은 domestic_orders 이고, 고치는 자리는 내자 정리 화면이다.
  // 이 모듈이 mutation · 입력 검증 · 서버 액션 어디에도 들어가 있지 않으면
  // 여기서 나온 값이 저장 payload 로 흘러갈 길 자체가 없다.
  const repoUrl = new URL("../../../", import.meta.url);
  const writeSides = ["src/lib/db/mutations/", "src/lib/validation/", "src/lib/server/actions/"].map(
    (dir) => fileURLToPath(new URL(dir, repoUrl))
  );

  const offenders = writeSides
    .flatMap((dir) => collectSourceFiles(dir))
    .filter((path) => readFileSync(path, "utf8").includes("repair-case-domestic-order-dates"));

  assert.deepEqual(offenders, [], "저장하는 쪽이 그릴 값을 불러 쓰고 있다");
});

test("🔴 접은 값이 실려 가는 곳은 **바로 그 줄**뿐이다 — 줄이 여럿이면 폼이 안 열린다", () => {
  // 2026-09-29 부터 이 구역에서 두 날짜를 고친다. 편집칸을 채우는 것은 위
  // resolve… 가 **여럿 중 하나를 골라 접은** 값이라, 줄이 여럿일 때 저장을
  // 받으면 다른 줄의 날짜가 이 줄에 복사되어 굳는다(함정 ②). 그래서 편집은
  // 「줄이 하나」이거나 「줄이 없다」일 때만 열리고, 그 판정은 이 파일이 아니라
  // domestic-order-issue-date-edit.ts 가 갖는다 — 서버도 같은 함수를 부른다.
  const repoUrl = new URL("../../../", import.meta.url);
  const source = readFileSync(
    new URL("src/components/repair-cases/detail/DomesticOrderDatesSection.tsx", repoUrl),
    "utf8"
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

  assert.match(code, /const plan = resolveDomesticOrderIssueDateEditPlan\(rows\);/);
  assert.match(code, /const editable = canEdit && plan\.kind !== "BLOCKED_MULTIPLE";/);
  // 접은 값으로 편집칸을 채우는 자리는 그 판정 뒤에만 있다.
  assert.match(code, /setQuoteValue\(dates\.quoteIssuedDate \?\? ""\);/);
  assert.match(code, /setOrderValue\(dates\.orderIssuedDate \?\? ""\);/);
  // 🔴 화면이 제 손으로 줄을 고르지 않는다 — 그러면 규칙이 두 벌이 된다.
  assert.ok(
    !/\.sort\(|\.filter\(|\.slice\(|\.reduce\(|\.map\(/.test(code),
    "화면이 줄을 골라 내고 있다"
  );
});

// ── ④ 화면에 적히는 글자 ────────────────────────────────────────────────

describe("안내 글자", () => {
  test("N개 안내는 링크와 이어져 한 문장이 된다", () => {
    assert.equal(
      formatMultipleDomesticOrderRowsNotice(3) + DOMESTIC_ORDER_LIST_LINK_TEXT,
      "내자 줄이 3개입니다 — 내자 정리에서 보세요"
    );
  });

  test("몇 줄인지 숫자가 실제로 들어간다", () => {
    assert.ok(formatMultipleDomesticOrderRowsNotice(7).includes("7개"));
  });

  test("0개 안내와 N개 안내는 서로 다른 말이다", () => {
    assert.notEqual(DOMESTIC_ORDER_DATES_NONE_NOTE, formatMultipleDomesticOrderRowsNotice(2));
    assert.ok(DOMESTIC_ORDER_DATES_NONE_NOTE.includes("아직 없습니다"));
  });

  test("두 이름표는 서로 다른 글자다", () => {
    assert.notEqual(DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL, DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL);
  });

  test("설명은 실제로 쓰는 고르는 규칙을 말한다 — 주석이 실측과 어긋나면 안 된다", () => {
    assert.ok(DOMESTIC_ORDER_DATES_SECTION_NOTE.includes("발주발행일이 가장 이른 줄"));
    assert.ok(DOMESTIC_ORDER_DATES_SECTION_NOTE.includes("견적발행일이 가장 이른 줄"));
  });

  test("나가는 길은 내자 정리 목록 하나다", () => {
    assert.equal(DOMESTIC_ORDER_LIST_HREF, "/domestic-orders");
  });
});
