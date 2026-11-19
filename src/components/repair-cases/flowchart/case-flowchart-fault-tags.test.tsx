import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import FaultTagSuggestionList from "./FaultTagSuggestionList";
import { BADGE_KEYS } from "@/lib/domain/badge-visibility";

/**
 * 진단 Flowchart 편집기의 **고장 개소 태그 칸**(2026-11-19) — 화면 쪽 글루.
 *
 * ── 🔴 적는 방식이 두 번 바뀌었다 ───────────────────────────────────────
 * 처음에는 한 칸(textarea)에 길게 적고 쉼표·줄바꿈·대괄호로 쪼갰다. 같은 날 사용자가
 * **하나씩 고르거나 적어서 더하는** 방식으로 뒤집었고, 이어서 고르는 모양을 못
 * 박았다 — 「태그 목록은 **부품요청에서 부품을 검색할 때 처럼** 만들어줘.」
 * 그래서 후보는 칸 밑에 **직접 그리는 목록**이다(브라우저가 그려 주는 목록이 아니다):
 * 칸에 들어오면 펴지고, 적는 대로 좁혀지고, Escape 로 접힌다.
 *
 * ── 왜 어떤 것은 그려 보고 어떤 것은 원본을 읽는가 ──────────────────────
 * 후보 목록(FaultTagSuggestionList)은 서버 것을 하나도 안 물어서 **실제로 그려
 * 본다**(이웃 inventory/part-picker.test.tsx 가 서브모듈 고르개에 쓰는 방식 그대로).
 * 반대로 CaseFlowchartEditorScreen 은 @xyflow/react 의 .css 와 서버 액션(→ server-only)
 * 을 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다 — 그쪽은 이웃
 * (procedures/procedure-template-editor-undo.test.ts)과 같이 **원본 글자**로 본다.
 *
 * ── 무엇을 여기서 재고 무엇을 저쪽에서 재는가 ───────────────────────────
 * **다듬는·더하는·고를 목록을 추리는 규칙 자체**는 unit 목록의
 * lib/validation/repair-case-flowchart-fault-tags.test.ts 가 값으로 본다. 여기서
 * 못 박는 것은 **화면이 그 규칙을 제대로 물고 있는가**와, 눌러 보기 전에는 안
 * 보이는 것들이다: 🔴 이미 단 태그가 후보에 남아 있는가 · 🔴 적는 대로 좁혀지는가 ·
 * 🔴 Escape 로 접히는가 · 🔴 Enter 로 더해지는가 · 🔴 ✕ 로 빼지는가 · 🔴 저장
 * 단추가 태그만 바꿔도 켜지는가(켜는 조건에서 태그가 빠지면 단추가 영영 비활성이고,
 * 화면은 오류 한 줄 없이 그냥 안 눌린다).
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 「왜」를 길게 적는다. 이 조각에서도 「왜 공용 고르개를 그대로 쓰지
 * 못하는지」·「왜 배지 설정에 등록하지 않는지」를 그 자리 주석에 적어 두었으므로,
 * 주석을 안 걷으면 그 낱말들이 코드에 있는 것처럼 세어진다.
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const screen = stripComments(read("src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx"));
const screenFlat = flat(screen);
const page = stripComments(read("src/app/(app)/repair-cases/[id]/diagnosis/[flowchartId]/page.tsx"));
const pageFlat = flat(page);

/** `start` 로 시작해 괄호 깊이가 0으로 돌아올 때까지 — 함수 하나의 몸통만 떼어 낸다. */
function functionBody(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  assert.fail(`${start} 의 몸통이 안 닫혔다`);
}

/** `hasMetadataChanges = ...` 의 오른쪽 — 세미콜론까지. */
const metadataChangesExpression = (() => {
  const from = screenFlat.indexOf("const hasMetadataChanges =");
  assert.notEqual(from, -1, "hasMetadataChanges 를 못 찾았다");
  const to = screenFlat.indexOf(";", from);
  assert.notEqual(to, -1, "hasMetadataChanges 식이 안 끝난다");
  return screenFlat.slice(from, to);
})();

/** 제목/설명/태그를 저장하는 단추의 `disabled={...}` 안쪽 — 그래프 쪽 [저장]과 헷갈리지 않는 유일한 표식이다. */
const metadataButtonDisabled = (() => {
  const from = screenFlat.indexOf("disabled={!hasMetadataChanges");
  assert.notEqual(from, -1, "제목/설명/태그 저장 단추를 못 찾았다");
  const to = screenFlat.indexOf("}", from);
  assert.notEqual(to, -1, "disabled 식이 안 끝난다");
  return screenFlat.slice(from, to + 1);
})();

/** 그 단추의 글자 — disabled 뒤부터 단추가 닫힐 때까지. */
const metadataButtonLabel = (() => {
  const from = screenFlat.indexOf("disabled={!hasMetadataChanges");
  const to = screenFlat.indexOf("</button>", from);
  assert.notEqual(to, -1, "저장 단추가 안 닫혔다");
  return screenFlat.slice(from, to);
})();

/** 태그 칸 한 덩어리 — 이름표부터 알약 묶음 직전까지. */
const faultTagField = (() => {
  const from = screenFlat.indexOf("고장 개소 (선택)");
  assert.notEqual(from, -1, "「고장 개소 (선택)」 이름표가 없다");
  const to = screenFlat.indexOf("faultTagsDraft.map(");
  assert.notEqual(to, -1, "알약을 그리는 자리를 못 찾았다");
  assert.ok(from < to, "알약이 칸보다 위에 있다");
  return screenFlat.slice(from, to);
})();

/** 알약 하나를 그리는 자리 — faultTagsDraft.map( 부터 그 묶음이 닫힐 때까지. */
const faultTagPill = (() => {
  const from = screenFlat.indexOf("faultTagsDraft.map(");
  const to = screenFlat.indexOf("</span> ))}", from);
  assert.notEqual(to, -1, "알약 묶음이 안 닫혔다 — 모양이 바뀌었으면 시험도 함께 고쳐야 한다");
  return screenFlat.slice(from, to);
})();

/** 알약 하나의 className. */
const pillClass = (() => {
  const matched = /className="([^"]+)"/.exec(faultTagPill);
  assert.ok(matched, "알약의 className 을 못 찾았다");
  return matched[1];
})();

describe("진단 Flowchart 편집기 — 고장 개소 태그 칸", () => {
  test("🔵 먼저 표본 확인 — 메타데이터 상자 셋이 실제로 이 파일에 있다", () => {
    assert.ok(screen.includes("Flowchart 제목"));
    assert.ok(screen.includes("설명 (선택)"));
    assert.ok(screen.includes("고장 개소 (선택)"));
    assert.ok(screen.includes("const hasMetadataChanges ="));
  });

  test("🔴 칸이 「설명 (선택)」과 저장 단추 **사이**에 선다", () => {
    const description = screen.indexOf("설명 (선택)");
    const faultTags = screen.indexOf("고장 개소 (선택)");
    const saveButton = screen.indexOf("disabled={!hasMetadataChanges");
    assert.ok(description < faultTags, "설명 칸보다 위에 있다");
    assert.ok(faultTags < saveButton, "저장 단추보다 아래에 있다");
  });

  test("🔴 **부품 검색과 같은 방식**이다 — 칸 밑에 직접 그리는 후보 목록", () => {
    assert.ok(faultTagField.includes('<input id="faultTagInput"'), faultTagField);
    assert.ok(faultTagField.includes('autoComplete="off"'), "브라우저 자체 기억을 안 껐다 — 그 목록이 후보 위에 겹쳐 뜬다");
    assert.ok(faultTagField.includes("onFocus={() => setIsFaultTagPickerOpen(true)}"), "칸에 들어와도 후보가 안 펴진다");
    assert.ok(faultTagField.includes("onBlur={() => setIsFaultTagPickerOpen(false)}"), "칸에서 나가도 후보가 안 접힌다");
    assert.ok(faultTagField.includes("<FaultTagSuggestionList options={faultTagOptions}"), "후보 목록을 안 그린다");
    // 🔴 목록이 칸 **바로 밑에** 뜨려면 부모가 relative 여야 한다 — 없으면 상자가
    // 엉뚱한 자리에 뜬다. 본보기(UsedPartsEditForm)도 같은 까닭으로 둘러 둔다.
    const picker = screenFlat.slice(screenFlat.indexOf('<div className="relative'), screenFlat.indexOf("<FaultTagSuggestionList"));
    assert.ok(picker.includes('id="faultTagInput"'), "입력 칸이 relative 상자 안에 없다");
    // 🔴 브라우저에 목록을 통째로 맡기던 앞 방식의 흔적이 없어야 한다.
    assert.equal(screen.includes("datalist"), false, "앞 방식의 목록이 남아 있다");
    assert.equal(faultTagField.includes(" list="), false, "입력 칸이 아직 브라우저 목록을 가리킨다");
    // 🔴 여러 줄 상자였던 그 앞 방식의 흔적도 남아 있으면 안 된다 — 쪼개는 규칙이
    // 사라진 지금 그 칸은 「줄바꿈이 뜻을 갖는」 것처럼 보이게 한다.
    assert.equal(faultTagField.includes("<textarea"), false, "태그 칸이 아직 textarea 다");
    assert.equal(screen.includes("faultTagsPreview"), false, "쪼갠 미리보기가 남아 있다");
  });

  test("🔴 Escape 로 후보가 접힌다 — 끄는 길이 없으면 목록에 갇힌다", () => {
    assert.ok(
      faultTagField.includes('if (e.key === "Escape") { setIsFaultTagPickerOpen(false); return; }'),
      `Escape 로 접는 길이 없다: ${faultTagField}`
    );
  });

  test("🔴 후보를 고르면 알약이 된다 — 더하는 규칙은 Enter·[추가]와 **같은 하나**다", () => {
    assert.ok(screenFlat.includes("onPick={handlePickFaultTag}"), "고른 것을 받는 자리가 없다");
    const body = flat(functionBody(screen, "function handlePickFaultTag(tag: string)"));
    assert.ok(body.includes("addFlowchartFaultTag(faultTagsDraft, tag)"), `고르는 길만 다른 규칙을 쓴다: ${body}`);
    assert.ok(body.includes("setFaultTagsDraft(result.tags)"), "고른 것이 알약으로 안 쌓인다");
    assert.ok(body.includes('setFaultTagInput("")'), "고른 뒤 칸을 안 비운다");
  });

  test("🔴 **이미 단 태그는 후보에 없고, 적는 글로 좁혀진다** — 두 겹을 다 지난다", () => {
    assert.ok(
      screenFlat.includes(
        "const faultTagOptions = filterFaultTagOptions(availableFaultTagSuggestions(faultTagSuggestions, faultTagsDraft), faultTagInput)"
      ),
      "후보를 두 겹으로 안 추린다 — 이미 단 태그가 남거나, 쳐도 안 좁혀진다"
    );
    const rendered = screenFlat.slice(screenFlat.indexOf("<FaultTagSuggestionList"));
    assert.ok(rendered.includes("options={faultTagOptions}"), `추린 것을 목록에 안 넘긴다: ${rendered.slice(0, 200)}`);
    assert.equal(rendered.slice(0, 200).includes("options={faultTagSuggestions}"), false, "받은 목록을 거르지 않고 그대로 그린다");
  });

  test("🔴 더하는 길이 둘이고 **같은 함수**를 부른다 — Enter 와 [추가]", () => {
    assert.ok(faultTagField.includes('if (e.key !== "Enter") return;'), `Enter 를 안 본다: ${faultTagField}`);
    assert.ok(faultTagField.includes("e.preventDefault(); handleAddFaultTag();"), "Enter 가 더하기를 안 부른다");
    assert.ok(faultTagField.includes('<button type="button" onClick={handleAddFaultTag}'), "[추가] 단추가 없거나 type 이 button 이 아니다");
    assert.ok(faultTagField.includes("추가 </button>"), "[추가] 단추의 글자가 없다");
  });

  test("🔴 Enter 가 저장을 일으키지 않는다 — 이 화면에는 제출되는 길이 없다", () => {
    assert.equal(/<form[\s>]/.test(screen), false, "폼이 생겼다 — 그 안의 Enter 는 제출이 된다");
    assert.equal(screen.includes("onSubmit"), false);
    // 🔵 폼이 없어도 preventDefault 를 둔다 — 폼이 생기는 날 Enter 가 조용히
    // 제출로 바뀌는 것을 막는 울타리다(위 검사와 한 짝).
    assert.ok(faultTagField.includes("e.preventDefault()"));
  });

  test("🔴 더한 뒤 칸을 비운다 — 다음 것을 바로 적을 수 있다", () => {
    const body = flat(functionBody(screen, "function handleAddFaultTag()"));
    assert.ok(body.includes("setFaultTagsDraft(result.tags)"), "더한 결과를 안 쥔다");
    assert.ok(body.includes('setFaultTagInput("")'), "칸을 안 비운다 — 적은 글자가 그대로 남는다");
    assert.ok(body.includes("setFaultTagError(result.error)"), "못 더한 까닭을 화면에 안 올린다");
  });

  test("🔴 알약마다 ✕ 로 뺄 수 있다 — 빼는 단추도 type=button 이다", () => {
    assert.ok(faultTagPill.includes("✕"), `알약에 ✕ 가 없다: ${faultTagPill}`);
    assert.ok(faultTagPill.includes('<button type="button" onClick={() => handleRemoveFaultTag(tag)}'), faultTagPill);
    assert.ok(faultTagPill.includes("aria-label="), "✕ 하나뿐이라 읽는 장치에는 아무 말도 안 들린다");
    const body = flat(functionBody(screen, "function handleRemoveFaultTag(tag: string)"));
    assert.ok(body.includes("prev.filter((t) => t !== tag)"), `빼는 규칙이 다르다: ${body}`);
  });

  test("중복·상한에 걸리면 까닭이 화면에 뜬다 — 아무 일도 안 일어나는 것으로 보이지 않는다", () => {
    assert.ok(screenFlat.includes("{faultTagError && <p"), "못 더한 까닭을 그리는 자리가 없다");
  });

  test("🔴 다듬는 규칙은 서버와 같은 순수 함수에서 온다 — 화면이 제 손으로 다듬지 않는다", () => {
    assert.ok(screenFlat.includes('from "@/lib/validation/repair-case-flowchart-input"'));
    assert.ok(screen.includes("addFlowchartFaultTag(faultTagsDraft, faultTagInput)"));
    assert.ok(screen.includes("normalizeFlowchartFaultTag(faultTagInput)"));
    // 제 손으로 쪼갠 흔적(쉼표/공백 split)이 없어야 한다 — 쪼개는 규칙은 사라졌다.
    assert.equal(/faultTag\w*\.split\(/i.test(screen), false, "화면이 태그를 직접 쪼개고 있다");
  });

  test("🔴 저장할 때 태그가 실린다 — 쌓아 둔 배열 그대로 서버로 간다", () => {
    const body = functionBody(screen, "async function handleSaveMetadata()");
    assert.ok(flat(body).includes("faultTags: faultTagsDraft"), "저장 호출에 태그가 안 실렸다");
  });

  test("🔴 저장 단추가 **태그만 바꿔도** 켜진다 — 켜는 조건이 태그를 본다", () => {
    assert.ok(
      metadataChangesExpression.includes("faultTagsEqual(faultTagsDraft, flowchart.faultTags)"),
      "hasMetadataChanges 가 태그를 안 본다 — 태그만 바꾸면 단추가 영영 비활성이다"
    );
    // 🔵 제목·설명 쪽 조건도 그대로 남아 있어야 한다(태그를 더하면서 지우면 안 된다).
    assert.ok(metadataChangesExpression.includes("titleDraft !== flowchart.title"));
    assert.ok(metadataChangesExpression.includes("descriptionDraft !== (flowchart.description ?? \"\")"));
  });

  test("🔴 단추의 잠금이 그 판정 하나를 본다 — 켜는 조건과 누를 수 있는 조건이 갈리지 않는다", () => {
    assert.ok(metadataButtonDisabled.includes("!hasMetadataChanges"), "저장 단추가 hasMetadataChanges 를 안 본다");
    assert.ok(metadataButtonDisabled.includes("titleDraft.trim().length === 0"), "제목 빈 칸 잠금이 사라졌다");
    // 🔴 **못 더한 까닭은 저장을 막지 않는다** — 더하려다 만 글자일 뿐이고,
    // 쌓아 둔 태그는 늘 규칙을 지난 값이다. 막으면 「✕ 로 빼고 저장」조차 못 한다.
    assert.equal(metadataButtonDisabled.includes("faultTagError"), false, metadataButtonDisabled);
  });

  test("🔴 단추 글자가 **「저장」**이다 — 태그까지 함께 저장하므로 「제목/설명 저장」은 실제와 어긋난다", () => {
    assert.ok(metadataButtonLabel.includes('{isSavingMetadata ? "저장 중..." : "저장"}'), metadataButtonLabel);
    assert.equal(screen.includes("제목/설명 저장"), false, "옛 글자가 남아 있다");
  });
});

describe("고장 개소 후보 목록 — 실제로 그려 본다", () => {
  const listSource = read("src/components/repair-cases/flowchart/FaultTagSuggestionList.tsx");
  const render = (options: string[]) =>
    renderToStaticMarkup(<FaultTagSuggestionList options={options} onPick={() => {}} listLabel="고장 개소 후보" />);

  test("🔵 먼저 표본 확인 — 받은 후보가 줄마다 글자 그대로 그려진다", () => {
    const markup = render(["우내", "제어반 상부"]);
    assert.ok(markup.includes('aria-label="고장 개소 후보"'), markup);
    assert.ok(markup.includes("우내"), markup);
    assert.ok(markup.includes("제어반 상부"), markup);
    assert.equal((markup.match(/<li/g) ?? []).length, 2, "줄 수가 후보 수와 다르다");
  });

  test("🔴 후보가 없으면 **아무것도 안 그린다** — 빈 상자가 칸 밑에 뜨지 않는다", () => {
    assert.equal(render([]), "");
  });

  test("🔴 줄마다 `type=\"button\"` 이다 — 폼이 생기는 날 후보를 누르면 제출이 된다", () => {
    const markup = render(["우내"]);
    assert.equal((markup.match(/<button type="button"/g) ?? []).length, 1, markup);
  });

  test("🔴 **눌리지 않는 목록**이 되는 함정을 막는다 — onMouseDown 에서 기본 동작을 막는다", () => {
    // blur 가 먼저 돌면 목록이 닫혀 onClick 이 닿을 곳이 없어진다. 본보기
    // (vendor/dss-core 의 PartSuggestionList)가 🔴 를 달아 둔 그 자리다.
    // 🔵 핸들러는 그린 글자에 안 나오므로 원본에서 본다.
    assert.ok(listSource.includes("onMouseDown={(event) => event.preventDefault()}"), listSource);
  });

  test("칸 **바로 밑**에 뜬다 — 흐름 안에 두면 밑의 것들이 밀려 내려간다", () => {
    const markup = render(["우내"]);
    assert.ok(/<ul[^>]*class="[^"]*absolute/.test(markup), markup);
  });
});

describe("고장 개소 — 고를 목록이 실제로 화면까지 온다", () => {
  test("🔵 먼저 표본 확인 — 편집기 페이지가 이 화면을 그린다", () => {
    assert.ok(pageFlat.includes("<CaseFlowchartEditorScreen"), "페이지가 편집기 화면을 안 그린다");
  });

  test("🔴 페이지가 쓰인 태그를 읽어 **prop 으로 넘긴다** — 안 넘기면 후보가 영영 안 뜬다", () => {
    assert.ok(pageFlat.includes("listUsedRepairCaseFaultTags"), "페이지가 목록 조회를 안 부른다");
    assert.ok(pageFlat.includes("await listUsedRepairCaseFaultTags()"), "조회를 부르고 기다리지 않는다");
    assert.ok(
      pageFlat.includes("faultTagSuggestions={faultTagUsage.map((row) => row.tag)}"),
      "읽어 놓고 화면에 안 넘긴다 — 조회는 도는데 후보만 영영 안 뜨는 모양이다"
    );
  });

  test("화면이 그 prop 을 받는다 — 이름이 갈리면 조용히 빈 목록이 된다", () => {
    assert.ok(screenFlat.includes("faultTagSuggestions = [],"), "기본값 있는 prop 으로 안 받는다");
    assert.ok(screenFlat.includes("faultTagSuggestions?: string[];"));
  });
});

describe("고장 개소 알약 — 모양과 색", () => {
  test("알약 글자는 이 저장소가 쓰는 그것 그대로다", () => {
    assert.ok(
      pillClass.includes("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"),
      `알약 글자가 다르다: ${pillClass}`
    );
  });

  test("🔴 색이 상태 배지와 다르다 — 고장 개소는 **값**이지 상태가 아니다", () => {
    assert.ok(pillClass.includes("zinc"), `중립 회색이 아니다: ${pillClass}`);
    for (const tone of ["green", "emerald", "amber", "red", "rose", "sky", "blue", "indigo", "violet", "orange", "yellow", "teal"]) {
      assert.equal(pillClass.includes(tone), false, `상태 배지 쪽 색이 섞였다(${tone}): ${pillClass}`);
    }
  });

  test("🔴 공용 부품을 새로 만들지 않았다 — 상태 배지 묶음을 끌어오지 않는다", () => {
    assert.equal(screenFlat.includes('from "@/components/repair-cases/badges"'), false);
    assert.equal(screen.includes("StatusBadge"), false);
  });
});

describe("🔴 배지 표시 설정에는 등록하지 않는다", () => {
  test("🔵 먼저 표본 확인 — 등록부가 비어 있지 않다", () => {
    assert.ok(BADGE_KEYS.length > 0, "등록부가 비면 아래 검사가 공짜로 통과한다");
  });

  test("등록부에 고장 개소가 없다 — 관리자가 끄면 **값이 사라지는** 스위치가 된다", () => {
    for (const key of BADGE_KEYS) {
      assert.equal(/fault/i.test(key), false, `고장 개소가 배지로 등록됐다: ${key}`);
    }
  });

  test("화면도 끄고 켜는 장치를 안 물린다 — 알약은 설정과 상관없이 늘 그려진다", () => {
    assert.equal(screen.includes("useIsBadgeVisible"), false);
    assert.equal(screenFlat.includes("badge-visibility"), false);
  });
});
