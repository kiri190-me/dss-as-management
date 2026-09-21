import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 주간보고 `전체 / RFG 만 / MB 만` — 화면이 그 값을 어디까지 쓰는가
 * ============================================================================
 * 고른 값이 무엇을 뜻하는지는 도메인 시험이 값으로 못 박는다
 * (domain/weekly-report-kind-filter.test.ts). **여기서 보는 것은 배선**이다 —
 * 화면이 그 값을 다섯 구역에 다 쓰고 있는가, 그리고 종이에 무엇이 남는가.
 *
 * 못 박는 것은 넷이다.
 *
 *  1. 🔴 **고르개는 종이에 찍히지 않는다**(`print:hidden`). 이 화면은 원본 엑셀을
 *     대신하는 문서라 인쇄가 잦다 — 눌리지 않는 단추 셋이 맨 위에 찍히면 안 된다.
 *  2. 🔴 **감췄다는 말은 종이에 남는다.** 고르개가 사라진 종이 위에서 「이 숫자가
 *     무엇의 합인가」를 말하는 것은 KindFilterBanner 한 줄뿐이라, 그 줄에
 *     print:hidden 이 붙으면 안 된다.
 *  3. 🔴 **다섯 구역에 다 미친다** — 고객사 블록 · 종류별 총합 · PO 발행 현황 ·
 *     금주 목표 · 납입 예정 건. 하나라도 빠지면 종이에 RFG 집계와 MB 목표가 같이
 *     찍혀 무엇을 뽑은 종이인지 알 수 없다.
 *  4. 🔴 **머리말 · 경고 · 6칸 합 확인이 전부 고른 것의 숫자를 읽는다.** 한 자리만
 *     report.total 로 남으면 그 숫자만 두 종류의 합이라, 사람이 섞어 읽는다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * WeeklyReportScreen 은 서버 컴포넌트이고, 그 안의 두 상자는 **서버 액션을 직접
 * import 하는 클라이언트 컴포넌트**다. react-server 조건에서는 react-dom/server 가
 * 스스로 막히고, 그 조건을 끄면 사슬 끝의 `server-only` 가 던진다 — 어느 쪽으로도
 * 이 화면은 통째로 렌더할 수 없다. 이웃 시험(repair-labor-screen-source.test.ts ·
 * quote-edit-work-scope-suppression.test.ts)과 같은 방법으로 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const screen = read("src/components/dashboard/WeeklyReportScreen.tsx");
const page = read("src/app/(app)/dashboard/weekly-report/page.tsx");
const goalsPanel = read("src/components/dashboard/WeeklyReportGoalsPanel.tsx");
const deliveriesPanel = read("src/components/dashboard/WeeklyReportDeliveriesPanel.tsx");

/**
 * 이름이 붙은 함수 한 덩어리만 잘라낸다 — 파일 전체에 걸면 딴 자리에 걸린다.
 *
 * 끝은 **맨 왼쪽 칸의 닫는 중괄호**다. 두 가지를 겪고 고른 방법이다:
 *   - 「다음 `function` 까지」는 안 된다. 이 파일의 함수 뒤에는 `export type` ·
 *     `export default function` 도 와서, 그때 잘린 덩어리가 파일 끝까지 가
 *     남의 빨간 클래스를 이 함수의 것으로 읽었다.
 *   - 중괄호 세기도 안 된다. 인자 자리가 구조분해(`({ current, weekStart })`)라
 *     본문이 시작되기 전에 이미 짝이 맞아 버린다.
 * 최상위 함수는 닫는 중괄호가 늘 0칸에 있고, 본문 안의 `}` 는 전부 들여쓰여 있다.
 *
 * ⚠️ **`\n}` 만으로는 모자란다.** 인자 자리를 여러 줄로 적으면 그 닫는 중괄호도
 * 0칸에 온다(`}: {` · `}) {`). 뒤에 줄바꿈이 곧바로 오는 것만이 함수의 끝이다.
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 를 찾지 못했다`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${declaration} 의 끝을 찾지 못했다`);
  return source.slice(start, end + 2);
}

// ───────────────────────────────────────────────── 고르개가 화면 위에 있는가

describe("고르개", () => {
  test("전체 · RFG 만 · MB 만 세 가지를 도메인에서 그대로 가져온다", () => {
    // 이름을 화면에 박지 않는다 — 박으면 도메인과 화면이 다른 말을 하는 날이 온다.
    assert.match(screen, /WEEKLY_REPORT_KIND_FILTERS\.map\(/);
    assert.match(screen, /weeklyReportKindFilterLabels\[filter\]/);
  });

  test("머리말 카드 안, 제목 바로 아래다 — 다 내려가 본 뒤 찾는 자리가 아니다", () => {
    const titleAt = screen.indexOf("주간보고</h1>");
    assert.notEqual(titleAt, -1);
    // 그 <h1> 이 든 카드 한 덩어리만 본다. `</section>` 은 이 파일에 여럿이라
    // (ReportBlock 도 <section> 이다) 반드시 제목 **뒤쪽**에서 찾아야 한다.
    const header = flat(screen.slice(titleAt, screen.indexOf("</section>", titleAt)));
    assert.match(header, /<KindFilterTabs current=\{view\.filter\} weekStart=\{goals\.weekStart\}/);
    // 머리말의 안내 문단보다도 앞이다 — 고르개가 문단 뒤로 밀리면 눈에 안 띈다.
    assert.ok(
      header.indexOf("<KindFilterTabs") < header.indexOf("출하 완료된 건은 빠지고"),
      header
    );
  });

  test("🔴 고르개는 종이에 찍히지 않는다 — print:hidden", () => {
    const tabs = flat(functionBody(screen, "function KindFilterTabs("));
    assert.match(tabs, /className="[^"]*print:hidden[^"]*"/);
  });

  test("링크다 — 버튼과 useState 가 아니다(새로고침 · 링크 · 인쇄가 유지된다)", () => {
    const tabs = functionBody(screen, "function KindFilterTabs(");
    assert.match(tabs, /<Link/);
    assert.ok(!tabs.includes("useState"), tabs);
    assert.ok(!tabs.includes("onClick"), tabs);
    // 이 파일은 서버 컴포넌트로 남는다 — 상세표 250여 줄을 브라우저로 보내지
    // 않는다. 맨 앞의 지시문만 본다: 이 파일의 머리말은 `"use client" 를 붙이면
    // …` 이라고 **글로** 적고 있어, 파일 전체에 걸면 그 문장에 걸린다.
    assert.ok(!/^\s*["']use client["']/.test(screen), "WeeklyReportScreen 이 클라이언트가 됐다");
  });

  test("주소는 도메인의 한 함수가 만든다 — 보던 주를 그대로 들고 간다", () => {
    const tabs = flat(functionBody(screen, "function KindFilterTabs("));
    assert.match(tabs, /href=\{weeklyReportHref\(\{ weekStart, kind: filter \}\)\}/);
  });

  test("지금 보고 있는 것을 색만으로 말하지 않는다 — aria-current", () => {
    const tabs = flat(functionBody(screen, "function KindFilterTabs("));
    assert.match(tabs, /aria-current=\{isCurrent \? "page" : undefined\}/);
  });
});

// ─────────────────────────────── 🔴 감춘 것을 말하지 않고 감추지 않는다 (종이)

describe("🔴 감춘 대수를 말한다", () => {
  test("걸러져 있을 때만 한 줄이 붙는다", () => {
    assert.match(flat(screen), /\{view\.isFiltered && <KindFilterBanner view=\{view\} \/>\}/);
  });

  test("🔴 그 줄에는 print:hidden 이 없다 — 종이 위에서 이 줄이 유일한 표지다", () => {
    const banner = functionBody(screen, "function KindFilterBanner(");
    assert.ok(!banner.includes("print:hidden"), banner);
  });

  test("무엇만 센 숫자인지 · 전체가 몇 대인지 · 몇 대가 빠졌는지 셋을 다 적는다", () => {
    const banner = flat(functionBody(screen, "function KindFilterBanner("));
    assert.match(banner, /weeklyReportKindFilterLabels\[view\.filter\]/);
    assert.match(banner, /\{view\.overallTotal\}/);
    assert.match(banner, /\{view\.counts\.total\}/);
    assert.match(banner, /\{view\.hiddenTotal\}/);
    assert.match(banner, /view\.hiddenKinds\.join/);
  });

  test("빨강이 아니다 — 이 화면의 빨강은 `손이 필요하다` 하나의 뜻이다", () => {
    const banner = functionBody(screen, "function KindFilterBanner(");
    assert.ok(!/\bborder-red-|\bbg-red-|\btext-red-/.test(banner), banner);
  });
});

// ────────────────────────────────── 🔴 고른 값이 다섯 구역에 모두 미치는가

describe("🔴 고른 값이 미치는 범위", () => {
  test("고객사 블록 — 고른 종류만 그린다", () => {
    const body = flat(screen.slice(screen.indexOf("customerRows.map(")));
    assert.match(body, /view\.kinds\.map\(\(kind\) => \( <ReportBlock/);
    assert.match(body, /block=\{weeklyReportPairBlock\(row, kind\)\}/);
    // 두 칸을 박아 그리던 예전 모양이 남아 있으면 고르개가 이 구역에 안 미친다.
    assert.ok(!body.includes("<ReportBlock block={row.rfg}"), body);
    assert.ok(!body.includes("<ReportBlock block={row.mb}"), body);
  });

  test("종류별 총합 — 고른 종류의 블록만 그린다", () => {
    assert.match(flat(screen), /view\.totalsByKind\.map\(\(\{ kind, counts \}\)/);
    assert.ok(!screen.includes("report.totalsByKind.map("), screen);
  });

  test("PO 발행 현황 — 고른 종류의 칸만 그린다", () => {
    assert.match(flat(screen), /view\.poIssuance\.map\(\(issuance\)/);
    // 화면이 직접 다시 세지 않는다 — 도메인이 센 것을 뷰가 골라 준다.
    // 부르는 자리만 본다: 그 이름은 PoIssuanceBlock 머리말에도 글로 적혀 있다.
    assert.ok(!/summarizeWeeklyReportPoIssuance\(/.test(screen), screen);
  });

  test("🔴 금주 목표 · 납입 예정 건 — 두 상자에도 고른 값이 간다", () => {
    const flatScreen = flat(screen);
    assert.match(flatScreen, /<WeeklyReportGoalsPanel[^>]*kindFilter=\{view\.filter\}/);
    assert.match(flatScreen, /<WeeklyReportDeliveriesPanel[^>]*kindFilter=\{view\.filter\}/);
  });

  test("두 상자가 그 값으로 그릴 칸을 고른다 — 박아 둔 두 칸이 아니다", () => {
    for (const [name, source] of [
      ["금주 목표", goalsPanel],
      ["납입 예정 건", deliveriesPanel],
    ] as const) {
      assert.match(source, /const visibleKinds = visibleWeeklyReportKinds\(kindFilter\);/, name);
      assert.match(source, /\{visibleKinds\.map\(\(kind\) => \(/, name);
      // 가르는 일(버킷)은 두 종류 다 해 둔다 — 고르개를 되돌리면 그대로 돌아온다.
      assert.match(source, /WEEKLY_REPORT_KINDS\.map\(\(kind\) => \[kind, \[\]/, name);
    }
  });

  test("🔴 주 이동 링크 셋이 고른 종류를 들고 간다 — 주를 넘겨도 전체로 안 돌아간다", () => {
    const flatGoals = flat(goalsPanel);
    for (const week of ["previousWeekStart", "nextWeekStart", "currentWeekStart"]) {
      assert.match(
        flatGoals,
        new RegExp(`href=\\{weeklyReportHref\\(\\{ weekStart: ${week}, kind: kindFilter \\}\\)\\}`),
        week
      );
    }
    // `?week=` 만 적던 예전 주소 만들기가 남아 있으면 안 된다.
    assert.ok(!goalsPanel.includes("function weekHref("), goalsPanel);
  });

  test("한 종류만 볼 때는 다섯 구역이 함께 한 칸이 된다", () => {
    assert.match(screen, /const gridClass = visibleGridClass\(view\.kinds\.length\);/);
    assert.match(
      screen,
      /function visibleGridClass\(visibleKindCount: number\): string \{\s*return visibleKindCount === 1 \? SINGLE_COLUMN_GRID : SIDE_BY_SIDE_GRID;/
    );
    // 격자 값을 쓰는 자리가 전부 이 한 값이다 — 한 자리만 상수로 남으면
    // 그 구역만 빈 오른쪽을 달고 남는다.
    assert.equal(screen.match(/className=\{`\$\{gridClass\} relative`\}/g)?.length, 1);
    assert.equal(screen.match(/<div className=\{gridClass\}>/g)?.length, 2);
    assert.equal(screen.match(/gridClass=\{gridClass\}/g)?.length, 2);
  });
});

// ───────────────────── 🔴 화면의 숫자가 전부 고른 것의 숫자를 읽는가

describe("🔴 화면에 남은 숫자가 무엇의 합인가", () => {
  test("머리말의 대수 · 분류 안 됨 경고 · 6칸 합 확인이 모두 view.counts 를 읽는다", () => {
    const flatScreen = flat(screen);
    assert.match(flatScreen, /진행 중인 \{view\.counts\.total\}대만/);
    assert.match(flatScreen, /\{view\.counts\.unclassified > 0 && \(/);
    assert.match(flatScreen, /접수 건이 \{view\.counts\.unclassified\}건 있습니다/);
    assert.match(
      flatScreen,
      /sumWeeklyReportStatusCounts\(view\.counts\) !== view\.counts\.total/
    );
  });

  test("🔴 report.total 을 직접 읽는 자리가 한 곳도 남지 않았다", () => {
    // 한 자리만 남아도 그 숫자만 두 종류의 합이라, 걸러 놓고 보는 사람이
    // 섞어 읽는다. 전체일 때의 값은 뷰가 report.total 그대로 내준다.
    assert.ok(!screen.includes("report.total"), screen);
  });

  test("🔴 화면이 세지 않는다 — 뷰 만들기 한 줄이 전부다", () => {
    assert.match(screen, /const view = buildWeeklyReportKindView\(report, kindFilter\);/);
    // 짝짓기는 걸러도 그대로다 — 두 칸이 다 있어야 고객사 차례가 흔들리지 않는다.
    assert.match(screen, /pairWeeklyReportBlocksByCustomer\(report\.blocks\)/);
  });
});

// ────────────────────────────────────────── 주소를 접는 자리는 한 곳뿐인가

describe("주소", () => {
  test("`?kind=` 을 page.tsx 가 한 번 접어 화면에 넘긴다", () => {
    assert.match(page, /searchParams: Promise<\{ week\?: string \| string\[\]; kind\?: string \| string\[\] \}>/);
    assert.match(
      page,
      /const kindFilter = normalizeWeeklyReportKindFilter\(params\[WEEKLY_REPORT_KIND_PARAM\]\);/
    );
    assert.match(page, /kindFilter=\{kindFilter\}/);
  });

  test("🔴 화면은 접힌 값만 받는다 — 거기서 주소를 다시 읽지 않는다", () => {
    assert.ok(!screen.includes("searchParams"), screen);
    assert.ok(!screen.includes("useSearchParams"), screen);
  });

  test("개발자 모드 미리보기는 늘 전체다 — 좌우 두 칸이 갈리는 폭을 봐야 한다", () => {
    const preview = read("src/app/(app)/settings/developer/weekly-report/page.tsx");
    assert.match(preview, /kindFilter="ALL"/);
  });
});
