import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WEEKLY_REPORT_PO_ISSUED_LABEL,
  WEEKLY_REPORT_STATUSES,
  WEEKLY_REPORT_TOTAL_LABEL,
} from "@/lib/domain/weekly-report";

/**
 * ============================================================================
 * 주간보고 집계의 **자리** — 무엇이 어디에 적히는가 (2026-10-07 사용자 지시)
 * ============================================================================
 * 이 날 셋이 바뀌었다. 전부 **자리를 옮긴 것**이고 세는 법은 한 글자도 손대지
 * 않았다(그 확인은 domain/weekly-report.test.ts 가 값으로 한다).
 *
 *  ① 블록 머리줄 오른쪽이 `총 대수` 에서 **`PO 발행 완료`** 로 바뀌었다.
 *  ② 집계 격자에서 `PO 발행 완료` 칸이 빠지고, 비는 **넷째 열을 `총 대수` 가
 *     두 줄 통째로** 차지하며 그 숫자만 크게 적는다.
 *  ③ `종류별 총합` · `PO 발행 현황` 두 구역이 **머리말 바로 아래, 고객사 블록
 *     앞**으로 올라왔다.
 *
 * ── 왜 이 시험이 필요한가 ───────────────────────────────────────────────
 * 이 화면은 매주 같은 자리를 눈으로 찾는 **문서**다. 칸이 한 자리만 옮겨 가도
 * 「지난주 종이와 나란히 놓고 본다」가 성립하지 않는데, 자리는 타입으로도 값으로도
 * 드러나지 않아 바뀌어도 아무 시험이 빨개지지 않는다 — 실제로 이번 변경에서도
 * 기존 시험 111개가 전부 그대로 통과했다. 그래서 **새 자리를 여기에 못 박는다.**
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * WeeklyReportScreen 은 서버 컴포넌트이고 그 안의 상자들은 서버 액션을 직접
 * import 하는 클라이언트 컴포넌트라, 어느 조건으로도 통째로 렌더할 수 없다. 까닭은
 * 이웃 시험(weekly-report-kind-filter-screen.test.ts) 머리말에 적혀 있다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const screen = read("src/components/dashboard/WeeklyReportScreen.tsx");

/**
 * 이름이 붙은 함수 한 덩어리만 잘라낸다. 끝은 **맨 왼쪽 칸의 닫는 중괄호 +
 * 줄바꿈**이고, 중괄호 세기가 왜 안 되는지는 이웃 시험의 같은 이름 함수에 적혀
 * 있다(weekly-report-kind-filter-screen.test.ts).
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 를 찾지 못했다`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${declaration} 의 끝을 찾지 못했다`);
  return source.slice(start, end + 2);
}

/** 주석을 걷어 낸 원본. 설명 글에 옛 모양이 경위로 남아 있어 그대로 세면 섞인다. */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const countsSummary = functionBody(screen, "function CountsSummary(");
const countCell = functionBody(screen, "function CountCell(");
const blockHeading = functionBody(screen, "function BlockHeading(");

// ─────────────────────────── ① 머리줄 오른쪽은 `PO 발행 완료` 다

describe("① 블록 머리줄의 오른쪽 숫자", () => {
  test("🔴 이름과 값을 한 덩어리로 받는다 — 따로 받으면 한쪽만 바뀌는 날이 온다", () => {
    assert.match(blockHeading, /count\?: \{ label: string; value: number \};/);
    // 옛 프롭이 한 자리도 남지 않았다 — 남으면 어느 쪽이 그려지는지 알 수 없다.
    assert.ok(!/\btotal\?: number;/.test(blockHeading), blockHeading);
    assert.ok(!/<BlockHeading[\s\S]{0,200}?total=\{/.test(screen), screen);
  });

  test("🔴 이름을 머리줄 안에 박지 않는다 — 부르는 쪽이 정한다", () => {
    const flatHeading = flat(blockHeading);
    assert.match(flatHeading, /\{count\.label\}/);
    assert.match(flatHeading, /\{count\.value\}/);
    assert.ok(!flatHeading.includes("WEEKLY_REPORT_TOTAL_LABEL"), blockHeading);
    assert.ok(!flatHeading.includes("WEEKLY_REPORT_PO_ISSUED_LABEL"), blockHeading);
    // 없으면 아예 안 그린다 — 선택적 슬롯 그대로다.
    assert.match(flatHeading, /\{count !== undefined && \(/);
  });

  test("🔴 고객사 블록은 PO 발행 완료를 적는다 — 총 대수가 아니다", () => {
    assert.match(
      flat(functionBody(screen, "function ReportBlock(")),
      /count=\{\{ label: WEEKLY_REPORT_PO_ISSUED_LABEL, value: block\.counts\.poIssued \}\}/
    );
  });

  test("🔴 종류별 총합도 같은 값을 같은 자리에 적는다 — 두 곳을 눈으로 견준다", () => {
    assert.match(
      flat(screen),
      /name="총합" kind=\{kind\} count=\{\{ label: WEEKLY_REPORT_PO_ISSUED_LABEL, value: counts\.poIssued \}\}/
    );
  });

  test("🔴 PO 발행 현황만 `총 대수` 그대로다 — 이번 지시의 대상이 아니었다", () => {
    assert.match(
      flat(functionBody(screen, "function PoIssuanceBlock(")),
      /count=\{\{ label: WEEKLY_REPORT_TOTAL_LABEL, value: issuance\.total \}\}/
    );
  });

  test("머리줄은 여전히 세 자리에서 쓰인다 — 자리가 늘지도 줄지도 않았다", () => {
    assert.equal(screen.match(/<BlockHeading/g)?.length, 3, screen);
  });
});

// ──────────────────── ② 집계 격자 — 넷째 열을 총 대수가 두 줄 통째로

describe("② 집계 격자의 칸과 차례", () => {
  test("🔴 상태 6칸의 차례가 그대로다 — 매주 같은 자리를 눈으로 찾는 문서다", () => {
    // 윗줄 점검 대기 · 수리 대기 · PO 대기 중, 아랫줄 점검 중 · 수리 중 · 출하 대기.
    assert.match(
      flat(screen),
      /const SUMMARY_CELL_POSITION: Record<WeeklyReportStatus, number> = \{ INSPECTION_WAITING: 1, REPAIR_WAITING: 2, PO_WAITING: 3, INSPECTION_IN_PROGRESS: 5, IN_REPAIR: 6, SHIPMENT_WAITING: 7, \};/
    );
    // 자리 번호를 1~6 으로 당기지 않았다 — 4번은 총 대수가 쓰는 자리다.
    assert.equal(WEEKLY_REPORT_STATUSES.length, 6, "집계 칸은 여섯 그대로다");
    assert.match(screen, /SUMMARY_CELL_POSITION\[status\] < 4/);
    assert.match(screen, /SUMMARY_CELL_POSITION\[status\] > 4/);
  });

  test("🔴 DOM 차례가 윗줄 셋 → 총 대수 → 아랫줄 셋 → 분류 안 됨이다", () => {
    // 격자 자동 배치가 이 차례대로 빈자리를 채운다. 총 대수를 아랫줄 뒤로 보내면
    // 2행 4열에서 시작해 줄이 하나 더 생긴다.
    const body = flat(withoutComments(countsSummary));
    const order = [
      "{TOP_ROW_STATUSES.map(",
      "label={WEEKLY_REPORT_TOTAL_LABEL}",
      "{BOTTOM_ROW_STATUSES.map(",
      "label={UNCLASSIFIED_LABEL}",
    ];
    let previous = -1;
    for (const marker of order) {
      const at = body.indexOf(marker);
      assert.notEqual(at, -1, `${marker} 가 집계 격자에 없다`);
      assert.ok(at > previous, `${marker} 의 차례가 어긋났다: ${body}`);
      previous = at;
    }
  });

  test("🔴 총 대수 칸만 두 줄을 통째로 쓴다", () => {
    assert.match(
      flat(withoutComments(countsSummary)),
      /label=\{WEEKLY_REPORT_TOTAL_LABEL\} value=\{counts\.total\} spanTwoRows/
    );
    assert.match(countCell, /spanTwoRows \? "row-span-2 items-center" : "items-baseline"/);
    // 격자 안에서 이 깃발을 받는 칸은 **하나뿐**이다. 둘이 되면 넷째 열이 네 줄을
    // 먹어 아랫줄 셋이 갈 자리가 사라진다.
    assert.equal(withoutComments(countsSummary).match(/\bspanTwoRows\b/g)?.length, 1, countsSummary);
  });

  test("🔴 PO 발행 완료 칸이 격자에서 빠졌다 — 머리줄로 올라갔다(①)", () => {
    assert.ok(
      !withoutComments(countsSummary).includes("WEEKLY_REPORT_PO_ISSUED_LABEL"),
      countsSummary
    );
  });

  test("🔴 분류 안 됨 아홉째 칸은 그대로 남아 있다 — 조용히 빼지 않는다", () => {
    assert.match(
      flat(countsSummary),
      /\{counts\.unclassified > 0 && \( <CountCell label=\{UNCLASSIFIED_LABEL\} value=\{counts\.unclassified\} alert \/> \)\}/
    );
  });

  test("열은 여전히 4개이고 칸은 글자보다 작아지지 않는다", () => {
    assert.ok(
      countsSummary.includes("[grid-template-columns:repeat(4,minmax(min-content,1fr))]"),
      countsSummary
    );
  });

  test("🔴 총 대수 숫자만 크다 — 크기는 주간보고 전용 변수를 곱해 쓴다", () => {
    // 고정 px 로 박으면 개발자 모드 [주간보고] 편집에서 집계 숫자를 키워도 이 한
    // 칸만 안 따라온다(파일 헤더의 '크기는 주간보고 전용 변수에서 온다').
    assert.match(
      screen,
      /const SPANNED_COUNT_FONT_SIZE = "calc\(var\(--text-wr-count\) \* 2\)";/
    );
    assert.match(
      flat(countCell),
      /style=\{spanTwoRows \? \{ fontSize: SPANNED_COUNT_FONT_SIZE \} : undefined\}/
    );
    // 숫자 칸은 여전히 text-wr-count 를 입는다 — 줄 높이가 그 비율에서 온다.
    assert.match(flat(countCell), /className=\{`text-wr-count font-semibold tabular-nums/);
  });

  test("🔴 이름과 숫자의 좌우 차례는 다른 칸과 똑같다 — 이 칸만 쌓지 않는다", () => {
    const flatCell = flat(countCell);
    assert.ok(flatCell.indexOf("{label}") < flatCell.indexOf("{value}"), countCell);
    assert.ok(!flatCell.includes("flex-col"), countCell);
    assert.match(flatCell, /className=\{`flex \$\{layoutClass\} justify-between/);
  });
});

// ───────────────────────────────── 🔴 셈은 바뀌지 않았다 — 자리만 옮겼다

describe("🔴 숫자가 달라지지 않는다", () => {
  test("총 대수는 counts.total, PO 발행 완료는 counts.poIssued 그대로다", () => {
    const flatScreen = flat(screen);
    assert.match(flatScreen, /value=\{counts\.total\}/);
    assert.match(flatScreen, /value: block\.counts\.poIssued/);
    assert.match(flatScreen, /value: counts\.poIssued/);
  });

  test("🔴 화면이 더하거나 빼지 않는다 — 두 값을 섞는 산술이 한 자리도 없다", () => {
    // 총 대수에 PO 발행 완료를 더하면 숫자가 달라진다. 겹쳐 세는 값이라
    // 더해지지 않는 것이 이 화면의 불변식이다(도메인 파일 헤더).
    const body = withoutComments(screen);
    assert.ok(!/poIssued\s*[+-]/.test(body), body);
    assert.ok(!/[+-]\s*counts\.poIssued/.test(body), body);
    assert.ok(!/counts\.total\s*[+-]/.test(body), body);
  });

  test("두 이름표는 도메인 상수 그대로다 — 화면에 글자로 박지 않았다", () => {
    assert.equal(WEEKLY_REPORT_PO_ISSUED_LABEL, "PO 발행 완료");
    assert.equal(WEEKLY_REPORT_TOTAL_LABEL, "총 대수");
    const body = withoutComments(screen);
    assert.ok(!body.includes('"PO 발행 완료"'), body);
    assert.ok(!body.includes('"총 대수"'), body);
  });
});

// ──────────────────── ③ 두 구역이 머리말 바로 아래, 고객사 블록 앞이다

describe("③ 구역의 차례", () => {
  const at = (needle: string) => {
    const index = screen.indexOf(needle);
    assert.notEqual(index, -1, `${needle} 를 찾지 못했다`);
    return index;
  };

  test("🔴 종류별 총합 · PO 발행 현황이 고객사 블록보다 **먼저** 온다", () => {
    const totals = at(">종류별 총합</h2>");
    const poIssuance = at(">{PO_ISSUANCE_SECTION_LABEL}</h2>");
    const blocks = at("customerRows.map(");
    assert.ok(totals < poIssuance, "종류별 총합이 PO 발행 현황보다 뒤에 있다");
    assert.ok(poIssuance < blocks, "두 구역이 고객사 블록보다 뒤에 있다");
  });

  test("🔴 머리말 카드보다는 뒤다 — 제목과 고르개가 여전히 맨 위다", () => {
    assert.ok(at("주간보고</h1>") < at(">종류별 총합</h2>"), screen);
    assert.ok(at("<KindFilterTabs") < at(">종류별 총합</h2>"), screen);
  });

  test("분류 안 됨 경고는 그대로 맨 위에 남는다 — 두 구역보다 앞이다", () => {
    assert.ok(at('role="status"') < at(">종류별 총합</h2>"), screen);
  });

  test("금주 목표 · 납입 예정 건은 여전히 화면의 맨 아래다", () => {
    assert.ok(at(">{PO_ISSUANCE_SECTION_LABEL}</h2>") < at("<WeeklyReportGoalsPanel"), screen);
    assert.ok(at("customerRows.map(") < at("<WeeklyReportGoalsPanel"), screen);
    assert.ok(at("<WeeklyReportGoalsPanel") < at("<WeeklyReportDeliveriesPanel"), screen);
  });

  test("옮기면서 구역을 늘리거나 잃지 않았다 — 각각 한 벌씩이다", () => {
    assert.equal(screen.match(/>종류별 총합<\/h2>/g)?.length, 1, screen);
    assert.equal(screen.match(/>\{PO_ISSUANCE_SECTION_LABEL\}<\/h2>/g)?.length, 1, screen);
    assert.equal(screen.match(/<PoIssuanceBlock /g)?.length, 1, screen);
    assert.equal(screen.match(/<CountsSummary /g)?.length, 2, screen);
  });
});

// ──────────────────────────────────────────────────── 🔴 종이에 그대로 찍힌다

describe("🔴 종이", () => {
  test("집계 · 머리줄 · 두 구역에 print:hidden 이 없다", () => {
    // 이 화면은 원본 엑셀을 대신하는 문서라 종이로 자주 나간다. 숫자가 종이에서
    // 사라지면 인쇄한 사람은 그 사실조차 모른다(print:hidden 은 고르개와 수정
    // 버튼에만 붙는다 — 이웃 시험 둘이 그쪽을 본다).
    for (const [name, source] of [
      ["집계", countsSummary],
      ["집계 한 칸", countCell],
      ["블록 머리줄", blockHeading],
    ] as const) {
      assert.ok(!source.includes("print:hidden"), `${name} 에 print:hidden 이 붙었다`);
    }
    const totalsAt = screen.indexOf(">종류별 총합</h2>");
    const goalsAt = screen.indexOf("<WeeklyReportGoalsPanel");
    assert.ok(
      !screen.slice(totalsAt, goalsAt).includes("print:hidden"),
      "종류별 총합 · PO 발행 현황 구역에 print:hidden 이 붙었다"
    );
  });

  test("두 줄짜리 총 대수 칸에 확정 높이를 주지 않았다 — 종이에서 칸이 잘린다", () => {
    assert.ok(!/\bh-\d/.test(countCell), countCell);
    assert.ok(!/\bmax-h-/.test(countCell), countCell);
  });
});

// ───────────────────────── 🔴 거짓이 된 주석이 한 줄도 남지 않았다

describe("🔴 옛 모양을 말하던 문장", () => {
  test("`집계 8칸` · `아랫줄 … 총 대수` · `오른쪽에 총 대수` 가 사라졌다", () => {
    for (const stale of [
      "집계 8칸",
      "아랫줄 점검 중 · 수리 중 · 출하 대기 · 총 대수",
      "윗줄 점검 대기 · 수리 대기 · PO 대기 중 · PO 발행 완료",
      "오른쪽에 총 대수다",
      "오른쪽 `총 대수` 와 겹치지 않는",
      "네 번째 칸(PO 발행 완료)",
      "원본 아래쪽의 구역",
    ]) {
      assert.ok(!screen.includes(stale), `거짓이 된 문장이 남아 있다: ${stale}`);
    }
  });

  test("왜 바뀌었는지가 적혀 있다 — 다음 사람이 되돌려 놓지 않게", () => {
    assert.ok(screen.includes("2026-10-07 사용자 지시"), screen);
    // 바뀐 것은 자리뿐이라는 말도 남아 있어야 한다. 이 한 줄이 없으면 다음
    // 사람이 「PO 발행 완료가 총 대수에 들어가는구나」로 읽는다.
    assert.ok(screen.includes("셈은 한 번도 바뀌지 않았다"), screen);
  });
});
