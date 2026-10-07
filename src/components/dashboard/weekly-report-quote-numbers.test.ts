import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 주간보고 상세표의 **견적서 번호 펼치기** (2026-10-07 사용자 지시)
 * ============================================================================
 * 「주간보고에서 견적서 발행일 날짜 옆에 작은 역삼각 버튼을 만들어 주고 그걸 누르면
 * 고객 안내 현황에 뜨는 것과 같은 견적서 번호들이 뜨도록 해줘. (전체, RFG, MB 버튼 옆에
 * [견적서 번호 보기] 버튼을 만들어서 모두 펼쳐질 수 있도록 해줘. 한번 더 누르면 모두
 * 접히도록 해주고,)」
 *
 * 이 화면은 통째로 렌더할 수 없다(서버 컴포넌트다). 이웃
 * weekly-report-kind-filter-screen.test.ts 와 같은 방법으로 **원본을 글자로** 읽는다.
 *
 * 못 박는 것 다섯:
 *   1. 🔴 **번호는 고객 안내 현황과 같은 함수에서 온다.** 조회가 규칙을 베껴 적지 않는다 —
 *      두 화면이 다른 번호를 보이면 사람은 어느 쪽도 믿지 않는다.
 *   2. 🔴 **날짜 규칙은 건드리지 않았다.** 주간보고의 두 날짜는 지금까지와 똑같이
 *      pickWeeklyReportOrderDates 가 고른 줄에서 오고, 고객 안내 현황과 **일부러 다르다**.
 *   3. 🔴 **번호가 없는 줄에는 역삼각이 없다**(사용자 결정 — 흐릿하게도 두지 않는다).
 *   4. 🔴 **WeeklyReportScreen 은 서버 컴포넌트로 남는다.** 단추와 칸만 클라이언트 조각이고,
 *      둘을 잇는 것은 DOM 을 만들지 않는 Provider 다.
 *   5. 🔴 **단추와 역삼각은 종이에 찍히지 않는다.** 펼쳐 둔 번호는 찍힌다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 주석을 지운다 — 이 파일들은 주석에 서로의 이름을 까닭과 함께 길게 적어 둔다. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
/** 줄바꿈·들여쓰기 차이로 깨지지 않게 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const query = read("src/lib/db/queries/weekly-report.ts");
const screen = read("src/components/dashboard/WeeklyReportScreen.tsx");
const cell = read("src/components/dashboard/WeeklyReportQuoteNumbersCell.tsx");
const expand = read("src/components/dashboard/WeeklyReportQuoteNumbersExpand.tsx");
const domain = read("src/lib/domain/weekly-report.ts");

// ── ① 번호는 고객 안내 현황과 **같은 함수**에서 온다 ────────────────────

describe("① 두 화면이 같은 번호를 본다", () => {
  const body = flat(code(query));

  test("🔴 조회가 공용 함수를 부른다 — 규칙을 베껴 적지 않는다", () => {
    assert.ok(
      code(query).includes('from "./repair-case-quote-numbers"'),
      "공용 모듈을 가져오지 않는다 — 규칙이 두 벌이 됐을 수 있다"
    );
    assert.ok(body.includes("await listArchiveQuoteNumbers(rows, quoteInfo)"));
    assert.ok(
      body.includes(
        "quoteNumbers: repairCaseQuoteNumbers( quoteInfo.get(row.id)?.quoteNumber, archiveNumbers, row.lotNumber, row.serialNumber )"
      ),
      "줄마다 번호를 붙이는 자리가 공용 함수가 아니다"
    );
    // 「내자에 있으면 그것만」을 이 파일이 다시 적지 않는다.
    assert.ok(!body.includes("orderedQuoteNumber"), "조회가 규칙을 베껴 적었다");
    assert.ok(!body.includes("quoteArchiveProductKey"), "조회가 열쇠를 스스로 만든다");
    assert.ok(!body.includes("cache("), "조회가 두 번째 훑기 캐시를 들였다");
  });

  test("🔴 내자 정리 번호는 **한 곳**에서 읽는다 — 완료된 줄 제외 규칙까지 그쪽 것이다", () => {
    assert.ok(body.includes("await listQuoteInfoForRepairCases(caseIds)"));
    assert.ok(
      code(query).includes('from "./domestic-orders"'),
      "내자 번호를 다른 길로 읽는다"
    );
  });

  test("🔴 날짜 규칙은 한 글자도 바뀌지 않았다 — 번호만 맞췄다", () => {
    // 두 날짜는 여전히 도메인이 고른 줄에서 온다.
    assert.ok(body.includes("pickWeeklyReportOrderDates(orderRows)"));
    assert.ok(
      body.includes(
        "...(orderDatesByCaseId.get(row.id) ?? { quoteIssuedDate: null, orderIssuedDate: null }),"
      ),
      "날짜를 붙이는 자리가 바뀌었다"
    );
    // 🔴 내자 견적 정보의 **날짜**를 줄에 싣지 않는다 — 그쪽은 고르는 줄이 다르다.
    assert.ok(!body.includes("quoteInfo.get(row.id)?.quoteIssuedDate"), "번호 쪽 날짜가 섞였다");
    assert.ok(!body.includes("quoteInfo.get(row.id)?.orderIssuedDate"), "번호 쪽 날짜가 섞였다");
  });

  test("줄 타입에 칸이 있다 — 없으면 화면이 컴파일되지 않는다", () => {
    assert.ok(flat(code(domain)).includes("quoteNumbers: string[];"));
  });
});

// ── ② 칸 — 날짜 옆 역삼각, 번호가 있을 때만 ─────────────────────────────

describe("② 역삼각은 번호가 있는 줄에만 선다", () => {
  const screenFlat = flat(code(screen));

  test("🔴 번호가 하나도 없으면 지금까지와 **똑같이** 날짜 글자만이다", () => {
    assert.ok(
      screenFlat.includes(
        "{row.quoteNumbers.length === 0 ? ( dash(row.quoteIssuedDate) ) : ( <WeeklyReportQuoteNumbersCell date={dash(row.quoteIssuedDate)} numbers={row.quoteNumbers} /> )}"
      ),
      "번호가 없는 줄에도 조각이 붙는다 — 사용자 결정은 「그리지 않는다」이다"
    );
  });

  test("🔴 장기 PO 미발행의 빨간 볼드와 title 이 그 칸에 그대로 있다", () => {
    assert.ok(
      screenFlat.includes(
        '`px-wr-cell-x py-wr-cell-y tabular-nums ${row.isLongPendingPo ? LONG_PENDING_PO_TONE : ""}`'
      ),
      "빨간 볼드 옷이 칸에서 사라졌다"
    );
    assert.ok(screenFlat.includes("title={row.isLongPendingPo ? LONG_PENDING_PO_LABEL : undefined}"));
    // 칸 안에서 색을 다시 칠하지 않는다 — 한 부분만 회색이면 그 뜻이 칸 가운데서 끊긴다.
    assert.ok(!code(cell).includes("text-red-"), "칸 조각이 빨강을 제 손으로 칠한다");
    assert.ok(!code(cell).includes("text-zinc-600"), "펼친 번호가 상속된 색을 덮는다");
  });

  test("🔴 번호는 위아래 줄로 그린다 — 번호 하나가 중간에서 꺾이지 않는다", () => {
    const body = flat(code(cell));
    assert.ok(body.includes('<span key={number} className="block">'), "번호가 옆으로 나열된다");
    // 열이 넓어지지 않게 보조 글자 크기다(표 본문보다 작다).
    assert.ok(body.includes("text-wr-meta"));
    assert.ok(!body.includes("whitespace-normal"), "줄 안에서 번호가 꺾인다");
  });

  test("🔴 역삼각은 종이에 찍히지 않고, 펼친 번호는 찍힌다", () => {
    const body = flat(code(cell));
    assert.match(body, /const TRIANGLE_BUTTON_CLASS = "[^"]*print:hidden[^"]*"/);
    // 번호를 그리는 자리에는 print 변형이 없다 — 펼친 것은 그대로 종이에 간다.
    const numbersAt = body.indexOf('<span className="mt-0.5 block pl-2 text-wr-meta">');
    assert.notEqual(numbersAt, -1, "번호를 그리는 자리를 찾지 못했다");
    assert.ok(!body.slice(numbersAt).includes("print:"), "펼친 번호가 종이에서 사라진다");
  });

  test("낭독기가 읽을 이름과 펼침 상태가 있다", () => {
    const body = flat(code(cell));
    assert.ok(body.includes("aria-expanded={isOpen}"));
    assert.ok(body.includes("aria-label={`견적서 번호 ${numbers.length}개 ${isOpen ? \"접기\" : \"펼치기\"}`}"));
  });
});

// ── ③ [견적서 번호 보기] — 모두 펼치기 / 모두 접기 ──────────────────────

describe("③ 고르개 옆 단추", () => {
  const screenFlat = flat(code(screen));
  const expandFlat = flat(code(expand));

  test("🔴 고르개 **옆**이다 — 머리말 카드 안, 제목 바로 아래", () => {
    assert.ok(
      screenFlat.includes(
        "<KindFilterTabs current={view.filter} weekStart={goals.weekStart} /> <WeeklyReportQuoteNumbersToggle />"
      ),
      "단추가 고르개 옆에 없다"
    );
  });

  test("🔴 고르개와 **한 조각이 아니다** — 고르개는 링크이고 서버가 그린다", () => {
    const tabsAt = screen.indexOf("function KindFilterTabs(");
    const tabsEnd = screen.indexOf("\n}\n", tabsAt);
    const tabs = screen.slice(tabsAt, tabsEnd);
    assert.ok(!tabs.includes("useState"), tabs);
    assert.ok(!tabs.includes("onClick"), tabs);
    assert.ok(!tabs.includes("QuoteNumbers"), "고르개 안으로 단추가 들어갔다");
  });

  test("🔴 WeeklyReportScreen 은 서버 컴포넌트로 남는다", () => {
    assert.ok(!/^\s*["']use client["']/.test(screen), "WeeklyReportScreen 이 클라이언트가 됐다");
    // 단추와 칸만 클라이언트다.
    assert.ok(cell.startsWith('"use client";'));
    assert.ok(expand.startsWith('"use client";'));
  });

  test("🔴 Provider 가 화면 안쪽을 children 으로 감싼다 — DOM 을 만들지 않는다", () => {
    assert.ok(screenFlat.includes("<WeeklyReportQuoteNumbersProvider>"));
    assert.ok(screenFlat.includes("</WeeklyReportQuoteNumbersProvider>"));
    // 머리말의 단추도 상세표의 칸도 그 안에 있어야 한다.
    const providerAt = screenFlat.indexOf("<WeeklyReportQuoteNumbersProvider>");
    const providerEnd = screenFlat.indexOf("</WeeklyReportQuoteNumbersProvider>");
    const inside = screenFlat.slice(providerAt, providerEnd);
    assert.ok(inside.includes("<WeeklyReportQuoteNumbersToggle />"), "단추가 Provider 밖이다");
    assert.ok(inside.includes("customerRows.map("), "고객사 블록이 Provider 밖이다");
    // Provider 자신은 DOM 을 만들지 않는다.
    assert.ok(
      expandFlat.includes("<WeeklyReportQuoteNumbersContext.Provider value={{ expandAll, nonce, toggleAll }}> {children}"),
      "Provider 가 DOM 을 두른다"
    );
  });

  test("🔴 한 번 누르면 모두 펼침, 다시 누르면 모두 접힘", () => {
    assert.ok(expandFlat.includes("setExpandAll((previous) => !previous);"));
  });

  test("🔴 누르는 순간 줄마다 바꿔 둔 것은 전부 버려진다 — nonce 하나로", () => {
    assert.ok(expandFlat.includes("setNonce((previous) => previous + 1);"));
    assert.ok(
      expandFlat.includes(
        "const isOpen = localState !== null && localState.nonce === nonce ? localState.isOpen : expandAll;"
      ),
      "줄마다의 값과 전체 값이 어울리는 규칙이 사라졌다"
    );
    // 🔴 줄 id 를 브라우저로 내려보내지 않는다 — 상세표가 250여 줄이다.
    assert.ok(!expandFlat.includes("repairCaseId"), "줄 id 를 열쇠로 하는 표가 생겼다");
    assert.ok(!flat(code(cell)).includes("rowId"), "칸이 줄 id 를 받는다");
  });

  test("🔴 단추는 종이에 찍히지 않는다", () => {
    assert.match(expandFlat, /const TOGGLE_BASE = "[^"]*print:hidden[^"]*"/);
  });

  test("단추 글자는 사용자가 적어 준 그대로다", () => {
    assert.ok(expand.includes('const WEEKLY_REPORT_QUOTE_NUMBERS_TOGGLE_LABEL = "견적서 번호 보기";'));
    // 펼쳐져 있는지는 글자가 아니라 aria-pressed 와 눌린 색으로 말한다.
    assert.ok(expandFlat.includes("aria-pressed={expandAll}"));
  });
});
