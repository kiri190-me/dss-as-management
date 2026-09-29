import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 주간보고 — 인수번호를 눌러 수리 건 상세로 간다
 * ============================================================================
 * 이 화면에는 인수번호가 **셋** 있고 한 장에 함께 보인다:
 *
 *   1. 고객사 블록의 상세표          — WeeklyReportScreen (이번에 링크가 됐다)
 *   2. `RFG · MB 금주 목표` 상자     — WeeklyReportGoalsPanel 의 GoalPrefix
 *   3. `RFG · MB 납입 예정 건` 표    — WeeklyReportDeliveriesPanel 의 IntakeNumberLink
 *
 * 2·3은 이미 링크였고 1만 글자였다. 이 시험이 못 박는 것은 둘이다.
 *
 *  1. 🔴 **상세표의 인수번호가 `/repair-cases/{수리 건 id}` 로 가는 링크다.**
 *     그 id 는 `row.id` 다 — 조회가 repair_cases.id 를 그대로 실어 오고
 *     (queries/weekly-report.ts), 같은 줄의 `비고` 칸도 그 값을 repairCaseId 로
 *     넘긴다. 여기서 다른 값을 쓰면 엉뚱한 건으로 간다.
 *  2. 🔴 **인수번호가 빈 줄은 링크가 아니다.** 누를 글자가 없으면 밑줄만 남아
 *     어디로 가는지 알 수 없고, 낭독기에는 이름 없는 링크가 된다.
 *
 * 덧붙여 **셋이 같은 모양**인지도 본다. 한 화면에서 같은 것이 자리마다 다르게
 * 보이면 사람은 그 차이를 뜻으로 읽는다 — 색 하나만 어긋나도 눈에 띄는 자리다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * WeeklyReportScreen 은 서버 컴포넌트이고, 그 안의 두 상자는 **서버 액션을 직접
 * import 하는 클라이언트 컴포넌트**다. react-server 조건에서는 react-dom/server 가
 * 스스로 막히고, 그 조건을 끄면 사슬 끝의 `server-only` 가 던진다 — 어느 쪽으로도
 * 이 화면은 통째로 렌더할 수 없다. 이웃 시험이 같은 사정을 같은 방법으로 푼다
 * (weekly-report-kind-filter-screen.test.ts 머리말).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const screen = read("src/components/dashboard/WeeklyReportScreen.tsx");
const goalsPanel = read("src/components/dashboard/WeeklyReportGoalsPanel.tsx");
const deliveriesPanel = read("src/components/dashboard/WeeklyReportDeliveriesPanel.tsx");

/**
 * 이름이 붙은 함수 한 덩어리만 잘라낸다 — 파일 전체에 걸면 딴 자리에 걸린다.
 * 끝은 **맨 왼쪽 칸의 닫는 중괄호 + 줄바꿈**이다. 이유(중괄호 세기가 왜 안 되는지,
 * `\n}` 만으로 왜 모자라는지)는 이웃 시험의 같은 이름 함수에 적혀 있다
 * (weekly-report-kind-filter-screen.test.ts).
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 를 찾지 못했다`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${declaration} 의 끝을 찾지 못했다`);
  return source.slice(start, end + 2);
}

// ───────────────────────────────── 🔴 상세표의 인수번호가 링크가 됐는가

describe("🔴 상세표의 인수 번호", () => {
  test("그 수리 건 상세로 가는 링크다 — 주소는 /repair-cases/{row.id}", () => {
    const link = flat(functionBody(screen, "function IntakeNumberLink("));
    assert.match(link, /<Link href=\{`\/repair-cases\/\$\{row\.id\}`\}/);
  });

  test("🔴 id 는 옆 칸의 `비고` 가 쓰는 것과 **같은 값**이다 — 조회를 고칠 것이 없었다", () => {
    // 같은 줄의 비고 칸이 이미 row.id 를 repairCaseId 로 넘기고 있다. 둘이
    // 어긋나면 한 줄에서 링크와 저장이 서로 다른 건을 가리킨다.
    assert.match(flat(screen), /<WeeklyReportNotesCell repairCaseId=\{row\.id\}/);
  });

  test("표 칸이 그 링크를 그린다 — 글자만 찍던 자리가 남아 있지 않다", () => {
    const flatScreen = flat(screen);
    assert.match(
      flatScreen,
      /<td className="px-wr-cell-x py-wr-cell-y font-medium text-zinc-900 dark:text-zinc-50"> <IntakeNumberLink row=\{row\} \/> <\/td>/
    );
  });

  test("표 칸의 꾸밈은 그대로다 — 줄 높이도 칸도 밀리지 않는다", () => {
    // 색·밑줄은 안쪽 <Link> 에만 붙는다. <td> 에 flex·block·py 가 새로 붙으면
    // 8칼럼 표의 줄 높이가 이 칸만 달라진다.
    const cell = functionBody(screen, "function ReportBlock(");
    assert.ok(!/<td[^>]*className="[^"]*\b(flex|block|inline-block)\b/.test(cell), cell);
  });
});

// ───────────────────────────── 🔴 인수번호가 없는 줄은 링크로 만들지 않는다

describe("🔴 인수번호가 없는 줄", () => {
  test("링크가 아니라 글자다 — 누를 글자가 없는 링크를 만들지 않는다", () => {
    const link = functionBody(screen, "function IntakeNumberLink(");
    const guardAt = link.indexOf('if (row.intakeNumber.trim() === "") return');
    assert.notEqual(guardAt, -1, link);
    // **<Link> 보다 먼저** 빠져나가야 한다 — 뒤에 있으면 빈 링크가 이미 그려진다.
    assert.ok(guardAt < link.indexOf("<Link"), link);
  });

  test("보이는 글자는 지금까지와 같다 — 그 자리에 dash 를 새로 씌우지 않았다", () => {
    // 이 칸은 원래도 dash() 를 쓰지 않았다(옆의 형식·S/N 과 다르다). 링크를
    // 붙이면서 같이 바꾸면 링크와 상관없는 자리가 조용히 달라진다.
    const link = flat(functionBody(screen, "function IntakeNumberLink("));
    assert.ok(!link.includes("dash(row.intakeNumber)"), link);
    assert.match(link, /return <>\{row\.intakeNumber\}<\/>;/);
  });

  test("금주 목표 상자도 같은 판단을 한다 — 두 자리가 다르게 굴면 안 된다", () => {
    // GoalPrefix 는 인수번호가 빈 줄에서 앞부분을 통째로 글자로 그린다.
    assert.match(goalsPanel, /const intakeNumber = row\.intakeNumber\.trim\(\);/);
    assert.match(goalsPanel, /if \(at < 0\) \{/);
  });
});

// ──────────────────────────── 한 화면에 나란히 선 인수번호 셋이 같은 모양인가

describe("셋이 같은 모양", () => {
  /** 먼저 있던 두 링크가 쓰던 값 그대로다. 여기가 이 화면의 인수번호 링크 꾸밈이다. */
  const LINK_CLASS =
    'className="relative text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"';

  for (const [name, source] of [
    ["상세표", screen],
    ["금주 목표", goalsPanel],
    ["납입 예정 건", deliveriesPanel],
  ] as const) {
    test(`${name} — 같은 꾸밈을 쓴다`, () => {
      assert.ok(flat(source).includes(LINK_CLASS), name);
    });

    test(`${name} — 같은 자리로 간다`, () => {
      assert.match(flat(source), /<Link href=\{`\/repair-cases\/\$\{row\.[A-Za-z]+\}`\}/, name);
    });

    test(`${name} — 낭독기에 용도를 덧붙인다`, () => {
      assert.ok(flat(source).includes('<span className="sr-only"> 수리 건 상세로 이동</span>'), name);
    });
  }

  test("🔴 relative 가 그 <Link> 에 붙어 있다 — 떼면 세로 스크롤바가 둘이 된다", () => {
    // 안의 sr-only 는 position:absolute 다. 기준이 되는 조상이 없으면 그 span 이
    // AppShell <main> 의 자르기를 빠져나가 문서 바닥에 자리를 주장한다(실측은
    // WeeklyReportScreen 의 고객사 줄 주석). 위 LINK_CLASS 가 relative 로
    // 시작하는 것이 그래서 장식이 아니다 — 세 파일 모두에서 확인했다.
    assert.match(LINK_CLASS, /^className="relative /);
  });

  test("화면은 서버 컴포넌트로 남는다 — 링크 하나 때문에 상세표를 브라우저로 보내지 않는다", () => {
    // <Link> 는 서버 컴포넌트에서 그대로 쓸 수 있다. 맨 앞의 지시문만 본다:
    // 이 파일의 머리말은 `"use client" 를 붙이면 …` 이라고 **글로** 적고 있어,
    // 파일 전체에 걸면 그 문장에 걸린다(이웃 시험과 같은 주의).
    assert.ok(!/^\s*["']use client["']/.test(screen), "WeeklyReportScreen 이 클라이언트가 됐다");
  });
});
