import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 신고 증상 조각 → 인수점검 결과 줄 → 그 증상으로 걸러진 수리 건 목록
 * ============================================================================
 * 이 시험은 **화면 두 장을 잇는 길 하나**를 본다(2026-09-30 요청):
 *
 *   1. 대시보드 「신고 증상별 현황」의 조각을 펼치면 인수점검 결과가 **비율과
 *      함께** 나온다.
 *   2. 그 줄을 누르면 `/repair-cases?reportedSymptom=...` 으로 간다.
 *   3. 목록이 그 값을 읽어 거르고, **걸렸다는 것이 보이고 풀 수 있다.**
 *
 * 값으로 도는 부분은 이미 시험이 따로 있다 — 비율은 fault-symptom-breakdown.
 * test.ts, 주소 판정과 인코딩은 reported-symptom-param.test.ts, 거르기는
 * repair-case-filters.test.ts 다. 여기서 보는 것은 **화면이 그 값들을 실제로
 * 그렇게 쓰는가**뿐이다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * FaultSymptomBreakdownPanel 과 RepairCaseListPage 는 next/navigation 의 훅
 * (useSearchParams · useRouter)과 next/link 에 묶인 클라이언트 컴포넌트라,
 * 라우터가 없는 자리에서 통째로 그릴 수 없다. 이웃 시험이 같은 사정을 같은
 * 방법으로 푼다(weekly-report-intake-link.test.ts 머리말).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const panel = read("src/components/dashboard/FaultSymptomBreakdownPanel.tsx");
const listPage = read("src/components/repair-cases/RepairCaseListPage.tsx");
const listFilters = read("src/components/repair-cases/RepairCaseFilters.tsx");
const filterRules = read("src/lib/domain/repair-case-filters.ts");

/** 이름이 붙은 함수 한 덩어리만 잘라낸다 — 파일 전체에 걸면 딴 자리에 걸린다. */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 를 찾지 못했다`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${declaration} 의 끝을 찾지 못했다`);
  return source.slice(start, end + 2);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// ───────────────────────────────────────────── ① 비율은 도메인이 만든다

describe("비율", () => {
  test("화면은 도메인이 낸 값을 그리기만 한다 — 결과 줄과 인수점검 전 줄 둘 다", () => {
    const rows = functionBody(panel, "function toDetailRows(");
    assert.match(rows, /percentage: group\.percentage/);
    assert.match(rows, /percentage: slice\.intakeInspectionPendingPercentage/);
  });

  test("🔴 화면 안에서 나누거나 반올림하지 않는다 — 세는 규칙이 화면에 스며들면 안 된다", () => {
    // 도메인 파일 머리말이 금지한다. 한 번 여기에 계산이 들어오면 시험할 방법이
    // 브라우저를 띄우는 것밖에 남지 않는다.
    assert.ok(!panel.includes("Math.round"), panel.slice(0, 0) + "화면에 Math.round 가 생겼다");
    assert.ok(!/\/\s*slice\.count/.test(panel), "화면이 slice.count 로 나누고 있다");
    assert.ok(!panel.includes("* 100"), "화면이 100 을 곱하고 있다");
  });

  test("줄마다 비율이 찍힌다", () => {
    assert.match(flat(panel), /\{row\.percentage\}%/);
  });

  test("🔴 분모가 무엇인지 화면이 한 줄로 밝힌다", () => {
    // '인수점검 전 N건'이 따로 나오고 있어서, 밝히지 않으면 숫자가 안 맞는
    // 것처럼 보인다. 분모는 **인수점검 전까지 포함한 그 증상의 총 건수**다.
    const flatPanel = flat(panel);
    assert.match(flatPanel, /비율은 인수점검 전을 포함한 이 증상 \{slice\.count\}건을 100%로 본 값입니다/);
  });

  test("반올림 때문에 합이 100 이 아닐 수 있다는 것도 적는다", () => {
    assert.match(flat(panel), /반올림하므로 다 더해 100%가 되지 않을 수 있습니다/);
  });

  test("'인수점검 전' 줄이 사라지지 않았다 — 비율만 덧붙었다", () => {
    assert.ok(panel.includes('"인수점검 전"'), panel.includes("인수점검 전") ? "글자가 바뀌었다" : "줄이 사라졌다");
    assert.match(functionBody(panel, "function toDetailRows("), /slice\.intakeInspectionPendingCount > 0/);
  });
});

// ─────────────────────────── ② 🔴 어느 줄을 눌러도 같은 목록으로 간다

describe("🔴 어느 줄을 눌러도 같은 목록", () => {
  const detail = functionBody(panel, "function SelectedSliceDetail(");

  test("주소는 조각 하나에 하나뿐이다 — 줄마다 만들지 않는다", () => {
    // 사용자 결정(2026-09-30): 인수점검 결과로는 **더 좁히지 않는다**.
    // 주소를 짓는 자리가 하나뿐이면 그 결정이 코드 모양으로 남는다.
    assert.equal(countOf(panel, "repairCasesReportedSymptomHref("), 1);
    assert.match(detail, /const href = isSymptomSlice \? repairCasesReportedSymptomHref\(slice\.label\) : null;/);
  });

  test("🔴 인수점검 결과 글자가 주소에 들어가지 않는다", () => {
    // group.result · row.result 로 주소를 짓는 자리가 생기면 줄마다 다른 목록으로
    // 가게 되고, 그것이 곧 사용자 결정을 뒤집는 변경이다.
    assert.ok(!/href[^\n]*row\.result/.test(detail), detail);
    assert.ok(!/href[^\n]*group\.result/.test(panel), panel);
  });

  test("모든 줄이 같은 href 하나를 쓴다", () => {
    assert.equal(countOf(detail, "<Link"), 1);
    assert.match(flat(detail), /<Link href=\{href\}/);
  });

  test("'인수점검 전' 줄도 같은 목록으로 간다 — 그 줄만 죽어 있지 않다", () => {
    // 같은 증상의 건이므로 목록은 같다. 이 줄만 누를 수 없게 두면 사람은 그
    // 차이를 뜻으로 읽는다. 링크를 그리는 곳이 rows.map 하나이고, 그 rows 에
    // 인수점검 전 줄이 들어 있으므로 구조적으로 같은 자리를 지난다.
    assert.match(flat(detail), /\{rows\.map\(\(row\) => \(/);
    assert.match(flat(functionBody(panel, "function toDetailRows(")), /rows\.push\(\{ key: "PENDING",/);
  });

  test("🔴 누르기 전에 그 사실을 글로 알린다", () => {
    assert.match(
      flat(detail),
      /아래 어느 줄을 눌러도 신고 증상이 '\$\{slice\.label\}'인 수리 건 전체를 봅니다 — 인수점검 결과로는 더 좁히지 않습니다\./
    );
  });
});

// ───────────────────────────────────────────── 접근성

describe("🔴 누르는 자리", () => {
  const detail = functionBody(panel, "function SelectedSliceDetail(");

  test("링크다 — 줄에 onClick 을 달지 않았다", () => {
    // 글자 'onClick' 이 아니라 **실제로 붙은 속성**을 본다 — 이 파일의 주석이
    // 그 낱말을 쓰고 있어(왜 안 쓰는지를 적어 두었다) 통째로 찾으면 걸린다.
    assert.ok(!/onClick=/.test(detail), detail);
    assert.match(panel, /^import Link from "next\/link";$/m);
  });

  test("낭독기에 용도를 덧붙인다 — 이웃 화면과 같은 방식", () => {
    assert.match(flat(detail), /<span className="sr-only">이 신고 증상의 수리 건 목록으로 이동<\/span>/);
  });

  test("🔴 그 <Link> 에 relative 가 붙어 있다 — 떼면 세로 스크롤바가 둘이 된다", () => {
    // 안의 sr-only 는 절대 배치다. 기준이 되는 조상이 없으면 그 span 이 화면
    // 바닥에 자리를 주장한다(주간보고의 인수번호 링크에서 실제로 겪은 일).
    assert.match(flat(detail), /className=\{`\$\{DETAIL_ROW_CLASS\} relative /);
  });
});

// ───────────────────────── 누를 수 없는 조각은 까닭을 말한다

describe("누를 수 없는 조각", () => {
  const detail = functionBody(panel, "function SelectedSliceDetail(");

  test("미입력·기타는 증상 하나로 좁힐 수 없어 링크가 되지 않는다", () => {
    assert.match(detail, /const isSymptomSlice = slice\.sliceKind === "SYMPTOM";/);
    assert.match(flat(detail), /이 조각은 신고 증상 하나로 좁힐 수 없어, 아래 줄은 눌러도 목록으로 가지 않습니다\./);
  });

  test("주소에 실을 수 없는 증상도 링크가 되지 않고 까닭이 나온다", () => {
    // repairCasesReportedSymptomHref 가 null 을 돌려주는 경우다(아주 긴 값,
    // 줄바꿈이 섞인 값). 눌러도 아무 일이 없는 링크를 두는 것보다 낫다.
    assert.match(flat(detail), /이 증상은 글자가 너무 길거나 줄바꿈이 섞여 있어 목록 주소에 실을 수 없습니다\./);
  });

  test("링크가 아닐 때도 칸 나눔이 같다 — 숫자 열이 흔들리지 않는다", () => {
    assert.match(flat(detail), /<div className=\{DETAIL_ROW_CLASS\}>/);
  });
});

// ────────────────────────── ③ 목록이 그 주소를 읽고, 걸린 것을 보여 준다

describe("목록 화면", () => {
  test("🔴 판정을 목록이 옮겨 적지 않는다 — 순수 모듈 하나가 한다", () => {
    assert.match(filterRules, /import \{ reportedSymptomFromSearchParams \} from "\.\/reported-symptom-param";/);
    assert.match(filterRules, /reportedSymptom: reportedSymptomFromSearchParams\(searchParams\),/);
    // 이름도 길이도 여기 베껴 적혀 있으면 안 된다 — 한쪽만 고쳐지는 날이 온다.
    assert.ok(!filterRules.includes('get("reportedSymptom")'), filterRules);
  });

  test("🔴 걸려 있다는 것이 보인다", () => {
    assert.match(flat(listFilters), /신고 증상 필터 적용됨: \{filters\.reportedSymptom\}/);
  });

  test("🔴 접혀 있어도 보인다 — 안내가 상세 조건 바깥에 있다", () => {
    // 좁은 화면에서 상세 조건은 접힌다(FilterDisclosure). 안내가 그 안에 있으면
    // 걸린 줄 모른 채 "건이 왜 이것밖에 없지" 한다.
    const noticeAt = listFilters.indexOf("filters.reportedSymptom !== null");
    const disclosureEndAt = listFilters.indexOf("</FilterDisclosure>");
    assert.notEqual(noticeAt, -1, listFilters);
    assert.notEqual(disclosureEndAt, -1, listFilters);
    assert.ok(noticeAt > disclosureEndAt, "안내가 접히는 자리 안에 들어가 있다");
  });

  test("🔴 풀 수 있다 — 그것만 푸는 단추가 따로 있다", () => {
    const flatFilters = flat(listFilters);
    assert.match(flatFilters, /onClick=\{onClearReportedSymptom\}/);
    assert.match(flatFilters, /> 신고 증상 필터 해제 <\/button>/);
    assert.match(flat(listPage), /onClearReportedSymptom=\{\(\) => updateFilters\(\{ reportedSymptom: null \}\)\}/);
  });

  test("푸는 단추가 다른 조건까지 지우지 않는다", () => {
    // handleReset(= 필터 초기화)을 그대로 넘기면 고객사·기간까지 날아간다.
    assert.ok(!/onClearReportedSymptom=\{handleReset\}/.test(listPage), listPage);
  });

  test("접힘 배지 셈에는 넣지 않는다 — 자기 안내 줄이 따로 있다", () => {
    const counter = functionBody(listFilters, "export function countHiddenActiveFilters(");
    assert.ok(!counter.includes("reportedSymptom"), counter);
  });
});
