import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「통전작업 제외」를 켜면 수정 화면의 「3) 통전작업」 칸이 줄을 감추는가
 * ============================================================================
 * 문서 쪽(xlsx 생성기 셋·미리보기)은 이미 그 구역을 뺀다. 입력 칸만 그대로 떠
 * 있으면 사람은 그 줄들이 견적서에 나가는 줄로 읽는다(2026-09-11 사용자 —
 * 「오해가 없도록」). 어느 칸을 감출지는 도메인 함수가 정하고 그 판정이 문서 쪽과
 * 같은지는 도메인 시험이 값으로 본다(lib/domain/quote-labor-cost.test.ts 의 「작업 내역
 * 감춤」 묶음).
 * 여기서 지키는 것은 **화면이 그 판정을 제자리에서 쓰는가**다:
 *  · 감춘 칸에는 줄 입력·[+ 줄 추가]·다시 맞추기 단추가 없고 안내가 있다.
 *    칸 제목은 남는다.
 *  · 감추지 않은 칸은 지금까지 그대로 그린다.
 *  · 🔴 **감추기만 한다** — 감출 때 scopeLines·scopeTouched 를 비우는 코드가 없고,
 *    저장하는 작업 내역도 감춤과 무관하게 지금과 같다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * QuoteEditForm 은 **서버 액션을 직접 import 하는 클라이언트 컴포넌트**라, 그 사슬
 * 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * import 자체가 던진다(react-server 조건으로 돌리면 이번에는 useState 가 없다).
 * 이웃 시험(QuoteListScreen.test.ts)과 같은 방법으로 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/** 원본에서 **한 갈래만** 잘라낸다 — 파일 전체에 걸면 이웃 갈래에 걸린다. */
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

/** `open` 자리의 여는 괄호부터 짝이 맞는 닫는 괄호까지. */
const balancedCall = (source: string, open: number) => {
  assert.equal(source[open], "(", "여는 괄호 자리가 아니다");
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  assert.fail("닫는 괄호를 찾지 못했다");
};

const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));

/** 「작업 내역」 세 칸을 그리는 map 하나. */
const sectionMap = sliceBetween(
  form,
  "{QUOTE_WORK_SCOPE_SECTIONS.map((section) => {",
  "</div> ); })}"
);

/** 칸 제목 줄(제목 + 다시 맞추기 단추). */
const headerRow = sliceBetween(sectionMap, '<div className="flex items-baseline justify-between gap-2">', "{suppressed ? (");

/** 감춘 칸에 그리는 것. */
const suppressedBranch = sliceBetween(sectionMap, "{suppressed ? (", ") : ( <>");

/** 감추지 않은 칸에 그리는 것. */
const visibleBranch = sliceBetween(sectionMap, ") : ( <>", "</> )}");

describe("판정을 부르는 자리", () => {
  test("🔴 칸마다 도메인 판정을 「통전작업 제외」 상태로 부른다", () => {
    assert.ok(
      form.includes('import { isWorkScopeSectionSuppressed } from "@/lib/domain/quote-work-scope-suppression";'),
      "도메인 판정을 가져오지 않는다"
    );
    assert.ok(
      sectionMap.includes("const suppressed = isWorkScopeSectionSuppressed(section, { powerTestExcluded });"),
      "칸마다 판정을 부르지 않는다"
    );
    // 화면이 규칙을 따로 적으면 문서 쪽과 어긋날 자리가 생긴다 — 판정은 이 한 곳.
    assert.equal(form.split("isWorkScopeSectionSuppressed(").length - 1, 1, "판정을 부르는 곳이 하나가 아니다");
    assert.ok(!/section === "POWER_TEST" && powerTestExcluded/.test(form), "화면이 판정을 따로 적었다");
  });
});

describe("감춘 칸", () => {
  test("🔴 줄 입력·[+ 줄 추가]·[×] 가 없고 안내가 있다", () => {
    assert.ok(suppressedBranch.includes("{WORK_SCOPE_SUPPRESSED_NOTICE}"), "안내를 그리지 않는다");
    for (const absent of ["rows.map", "<input", "+ 줄 추가", "×", "아직 없습니다"]) {
      assert.ok(!suppressedBranch.includes(absent), `감춘 칸에 '${absent}' 가 있다`);
      // 갈래 **밖**으로 옮겨져도 감춘 칸에 뜬다 — 칸 안의 모든 자리가 보이는 갈래에 있어야 한다.
      const count = (source: string) => source.split(absent).length - 1;
      assert.ok(count(sectionMap) > 0, `칸에서 '${absent}' 를 찾지 못했다`);
      assert.equal(count(visibleBranch), count(sectionMap), `'${absent}' 가 감춤 갈래 밖에 있다`);
    }
  });

  test("🔴 [양식 기본값으로]·[고른 작업으로] 도 그리지 않는다 — 칸 제목은 남는다", () => {
    const guard = "{suppressed ? null : section === \"REPAIR\" ? (";
    assert.ok(headerRow.includes(guard), "다시 맞추기 단추가 감춤에 묶이지 않았다");
    // 두 단추는 모두 그 갈래 안에 있고, 칸의 다른 자리에는 없다.
    const afterGuard = headerRow.slice(headerRow.indexOf(guard));
    for (const label of ["고른 작업으로", "양식 기본값으로"]) {
      assert.equal(afterGuard.split(label).length - 1, 1, `'${label}' 가 감춤 갈래 안에 없다`);
      assert.equal(sectionMap.split(label).length - 1, 1, `'${label}' 가 칸의 다른 자리에도 있다`);
    }
    // 제목은 갈래 **앞에** 있다 — 감춰도 남는다.
    const title = "{QUOTE_WORK_SCOPE_SECTIONS.indexOf(section) + 1}){\" \"} {quoteWorkScopeSectionLabels[section]}";
    assert.ok(headerRow.indexOf(title) >= 0, "칸 제목을 찾지 못했다");
    assert.ok(headerRow.indexOf(title) < headerRow.indexOf(guard), "칸 제목이 감춤 갈래 안에 들어갔다");
  });

  test("안내 문구는 상수 하나에 있다 — 문서에 나가지 않는다는 뜻을 담는다", () => {
    const notice = sliceBetween(form, "const WORK_SCOPE_SUPPRESSED_NOTICE =", ";");
    assert.ok(notice.includes("통전작업 제외"), notice);
    assert.ok(notice.includes("견적서에 나가지 않습니다"), notice);
  });
});

describe("감추지 않은 칸 — 지금까지 그대로", () => {
  test("줄 입력·[×]·빈 목록 안내·[+ 줄 추가] 를 그린다", () => {
    for (const present of [
      "rows.map((row, index) => (",
      "<input value={row.text}",
      "aria-label={`${quoteWorkScopeSectionLabels[section]} ${index + 1}번째 줄`}",
      "aria-label={`${quoteWorkScopeSectionLabels[section]} ${index + 1}번째 줄 지우기`}",
      "아직 없습니다. 아래에서 줄을 더하세요.",
      "editScope(section, [...rows, { key: generateClientUuid(), text: \"\" }])",
      "+ 줄 추가",
    ]) {
      assert.ok(visibleBranch.includes(present), `보이는 칸에 '${present}' 가 없다`);
    }
  });
});

describe("🔴 감출 뿐 지우지 않는다", () => {
  test("「통전작업 제외」 체크는 그 값만 바꾼다 — 줄을 건드리지 않는다", () => {
    assert.ok(form.includes("onChange={(e) => setPowerTestExcluded(e.target.checked)}"), "체크의 onChange 가 달라졌다");
    assert.equal(form.split("setPowerTestExcluded(").length - 1, 1, "제외 상태를 바꾸는 곳이 하나가 아니다");
  });

  test("감춤·제외 상태로 scopeLines·scopeTouched 를 바꾸는 코드가 없다", () => {
    let calls = 0;
    for (const setter of ["setScopeLines(", "setScopeTouched("]) {
      let at = form.indexOf(setter);
      while (at >= 0) {
        // 부르기 하나를 통째로 본다 — 여는 괄호에 짝이 맞는 닫는 괄호까지.
        const call = balancedCall(form, at + setter.length - 1);
        assert.ok(!call.includes("suppressed"), `${setter} 가 감춤을 본다: ${call}`);
        assert.ok(!call.includes("powerTestExcluded"), `${setter} 가 제외 상태를 본다: ${call}`);
        calls += 1;
        at = form.indexOf(setter, at + setter.length);
      }
    }
    assert.ok(calls > 0, "상태를 바꾸는 부르기를 하나도 찾지 못했다 — 시험이 헛돈다");
    assert.ok(!suppressedBranch.includes("setScope"), "감춘 칸이 상태를 바꾼다");
  });

  test("저장하는 작업 내역은 감춤과 무관하게 세 칸 모두 그대로 보낸다", () => {
    const collect = sliceBetween(form, "function collectFields() {", "async function handleSubmit(");
    assert.ok(
      collect.includes(
        "workScopeLines: QUOTE_WORK_SCOPE_SECTIONS.flatMap((section) => scopeLines[section].map((row) => ({ section, text: row.text })) ),"
      ),
      "저장하는 작업 내역의 모양이 달라졌다"
    );
    assert.ok(!collect.includes("suppress"), "저장이 감춤을 본다");
  });
});
