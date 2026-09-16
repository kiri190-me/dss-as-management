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
 *  · 「조사작업 제외」(2026-09-15) — 체크 상자가 통전작업 제외 곁에 있고, 상태로 저장 ·
 *    미리보기 · 작업비 계산에 같은 값을 넘긴다. 조사 칸 마지막 줄을 지우면 켜지고, 빈 채로
 *    풀면 양식 기본 목록으로 다시 채운다.
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
  test("🔴 칸마다 도메인 판정을 「통전작업 제외」·「수리 작업 빠짐」 상태로 부른다", () => {
    assert.ok(
      form.includes(
        'import { isInvestigationScopeEmptied, isRepairSectionDropped, isWorkScopeSectionSuppressed, } from "@/lib/domain/quote-work-scope-suppression";'
      ),
      "도메인 판정을 가져오지 않는다"
    );
    assert.ok(
      sectionMap.includes(
        "const suppressed = isWorkScopeSectionSuppressed(section, { powerTestExcluded, repairSectionDropped, investigationExcluded, });"
      ),
      "칸마다 판정을 부르지 않는다"
    );
    // 화면이 규칙을 따로 적으면 문서 쪽과 어긋날 자리가 생긴다 — 판정은 이 한 곳.
    assert.equal(form.split("isWorkScopeSectionSuppressed(").length - 1, 1, "판정을 부르는 곳이 하나가 아니다");
    assert.ok(!/section === "POWER_TEST" && powerTestExcluded/.test(form), "화면이 판정을 따로 적었다");
  });

  test("🔴 「수리 작업 빠짐」은 저장될 그 목록(selectedTasks)의 수로 도메인이 정한다", () => {
    assert.ok(
      form.includes(
        "const repairSectionDropped = isRepairSectionDropped({ equipmentKind: laborKind, chosenRepairTaskCount: selectedTasks.length, });"
      ),
      "수리 작업 빠짐을 도메인으로 정하지 않는다"
    );
    assert.equal(form.split("isRepairSectionDropped(").length - 1, 1, "판정을 부르는 곳이 하나가 아니다");
    // 미리보기도 같은 값을 받는다 — 둘이 다르면 미리보기와 받아 본 문서가 다른 종이다.
    assert.ok(
      form.includes("// 수리 작업을 하나도 안 골랐으면 「② 수리 작업」도 사라진다 — 같은 이유. repairSectionDropped,"),
      "미리보기에 수리 작업 빠짐을 넘기지 않는다"
    );
  });
});

describe("「조사작업 제외」 체크 상자 — 켜면 「1) 조사작업」을 감추고 기본 작업비를 뺀다", () => {
  /** 「통전작업 제외」와 같은 모양의 체크 상자 한 벌. */
  const checkbox = (checked: string, onChange: string, text: string) =>
    `<label className="flex items-center gap-2 text-sm"> <input type="checkbox" checked={${checked}} onChange={(e) => ${onChange}(e.target.checked)} disabled={disabled} className="h-4 w-4" /> <span className="text-zinc-800 dark:text-zinc-200">${text}</span> </label>`;
  const powerTestBox = checkbox("powerTestExcluded", "setPowerTestExcluded", "통전작업 제외");
  const investigationBox = checkbox("investigationExcluded", "toggleInvestigationExcluded", "조사작업 제외");
  const toggle = sliceBetween(form, "function toggleInvestigationExcluded(", "function removeScopeRow(");

  test("🔴 상태다 — 저장된 결정으로 시작하고, 렌더마다 셈하지 않는다", () => {
    assert.ok(
      form.includes(
        "const [investigationExcluded, setInvestigationExcluded] = useState<boolean>( quote?.investigationExcluded ?? false );"
      ),
      "조사작업 제외가 상태가 아니다"
    );
    // 예전의 계산값(손대서 비웠는가)이 남아 있으면 체크 상자와 두 목소리가 된다.
    assert.ok(!form.includes("const investigationExcluded ="), "조사작업 제외를 아직도 렌더마다 셈한다");
    assert.ok(!form.includes("scopeTouched.INVESTIGATION,"), "손댔는가로 조사작업 제외를 정한다");
  });

  test("🔴 체크 상자가 「통전작업 제외」 곁에 같은 모양으로 있다", () => {
    assert.equal(form.split(powerTestBox).length - 1, 1, "통전작업 제외 체크 상자의 모양이 달라졌다");
    assert.equal(form.split(investigationBox).length - 1, 1, "조사작업 제외 체크 상자가 없거나 모양이 다르다");
    const at = form.indexOf(powerTestBox);
    const next = form.indexOf(investigationBox);
    assert.ok(at < next, "조사작업 제외가 통전작업 제외 뒤에 있지 않다");
    // 같은 줄(같은 flex 칸)이다 — 사이에 칸을 열거나 닫는 태그가 없다.
    const between = form.slice(at + powerTestBox.length, next);
    assert.ok(!between.includes("<div") && !between.includes("</div>"), `두 체크 상자가 다른 칸에 있다: ${between}`);
  });

  test("🔴 켜면 값만 바꾼다 — 줄은 감출 뿐 지우지 않는다", () => {
    assert.ok(toggle.includes("setInvestigationExcluded(excluded); if (excluded) return;"), "켤 때 먼저 돌아서지 않는다");
    const turningOn = toggle.slice(0, toggle.indexOf("if (excluded) return;"));
    for (const setter of ["setScopeLines(", "setScopeTouched(", "resetScopeToTemplate(", "editScope("]) {
      assert.ok(!turningOn.includes(setter), `켜는 갈래가 줄을 바꾼다: ${setter}`);
    }
    // 감추는 판정은 칸마다 부르는 isWorkScopeSectionSuppressed 한 곳이다(위 「판정을 부르는 자리」).
    assert.ok(sectionMap.includes("investigationExcluded, });"), "감춤 판정이 조사작업 제외 상태를 받지 않는다");
  });

  test("🔴 비어 있는 채 풀면 양식 기본 목록으로 다시 채운다 — 문서가 「비었다」를 읽는 그 뜻으로", () => {
    assert.ok(
      toggle.includes(
        'if (excluded) return; if (writtenScopeTexts(scopeLines.INVESTIGATION).length > 0) return; resetScopeToTemplate("INVESTIGATION"); }'
      ),
      "빈 채로 풀어도 다시 채우지 않는다"
    );
    // 다시 채우는 도구는 [양식 기본값으로] 단추와 같은 것이다 — 지금 양식의 목록, 손대지 않은 것으로.
    const reset = sliceBetween(form, "function resetScopeToTemplate(", "function toggleInvestigationExcluded(");
    assert.ok(reset.includes("const items = workScopeDefaults[quoteTemplateKey(laborKind, kind)]?.[section]?.items ?? [];"));
    assert.ok(reset.includes("setScopeLines((prev) => ({ ...prev, [section]: toScopeRows(items) }));"));
    assert.ok(reset.includes("setScopeTouched((prev) => ({ ...prev, [section]: false }));"));
    assert.ok(headerRow.includes("onClick={() => resetScopeToTemplate(section)}"), "[양식 기본값으로] 가 다른 도구를 쓴다");
    // 「비었다」는 미리보기(= 문서)가 양식 기본 목록으로 물러서는 그 판단과 같은 함수다.
    assert.ok(
      form.includes(
        'function writtenScopeTexts(rows: readonly ScopeRow[]): string[] { return rows.map((row) => row.text.trim()).filter((text) => text !== ""); }'
      )
    );
    const preview = sliceBetween(form, "function previewWorkSections(", "function formatAmount(");
    assert.ok(preview.includes("const written = writtenScopeTexts(scopeLines[section]);"), "미리보기가 다른 「비었다」를 쓴다");
    assert.ok(preview.includes("items: written.length > 0 ? written : (fromTemplate?.items ?? []),"));
  });

  test("🔴 조사 칸의 마지막 줄을 지우면 저절로 켜진다 — 켜기만 한다", () => {
    const fn = sliceBetween(form, "function removeScopeRow(", "function applyOverhaulRule(");
    assert.ok(
      fn.includes(
        'if (section === "INVESTIGATION" && isInvestigationScopeEmptied({ touched: true, texts: remaining.map((r) => r.text) })) { setInvestigationExcluded(true); }'
      ),
      "마지막 줄을 지워도 조사작업 제외가 켜지지 않는다"
    );
    assert.ok(!fn.includes("setInvestigationExcluded(false)"), "줄을 지우다 제외가 풀린다");
    assert.equal(form.split("isInvestigationScopeEmptied(").length - 1, 1, "판정을 부르는 곳이 하나가 아니다");
    // 상태를 바꾸는 곳은 둘이다 — 체크 상자(toggleInvestigationExcluded), 그리고 마지막 줄 지우기.
    assert.equal(form.split("setInvestigationExcluded(").length - 1, 2, "조사작업 제외를 바꾸는 곳이 둘이 아니다");
    // 글자를 고쳐 쓰느라 칸을 잠깐 비웠다고 켜지면 안 된다 — 줄 입력은 editScope 만 부르고,
    // editScope 는 조사작업 제외를 건드리지 않는다.
    assert.ok(
      visibleBranch.includes(
        "onChange={(e) => editScope( section, rows.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r)) ) }"
      )
    );
    const edit = sliceBetween(form, "function editScope(", "function resetScopeToTemplate(");
    assert.ok(!edit.includes("setInvestigationExcluded"), "줄 입력이 조사작업 제외를 바꾼다");
  });

  test("🔴 저장과 미리보기가 같은 상태를 받는다 — 기본 작업비 스냅숏은 셈한 그 값", () => {
    const collect = sliceBetween(form, "function collectFields() {", "async function handleSubmit(");
    assert.ok(collect.includes("investigationExcluded,"), "저장에 조사작업 제외가 실리지 않는다");
    // 뺀 사실은 investigationExcluded 가 말하고, 기본 작업비는 근거로 **더한 그 금액**을 보낸다.
    // 🔴 repair_labor_settings.base_cost 는 2026-09-16 부터 계산의 근거가 아니다 — 그 칸을
    // 베끼면 앞으로 공수시간을 고치는 날 저장된 근거와 청구 금액이 갈라진다.
    // 🔴 케이블 견적서는 작업비 구역이 없어 이 근거도 비워 보낸다(2026-09-16 케이블 ③ —
    // quote-edit-cable.test.ts 가 비우는 값 전부를 본다). 내자 · OH 는 그대로다.
    assert.ok(
      collect.includes(
        "laborBaseCost: isCable || laborSuggestion.baseCost === null ? null : toAmountText(laborSuggestion.baseCost),"
      ),
      "기본 작업비 스냅숏이 달라졌다"
    );
    assert.ok(!collect.includes("activeLabor?.baseCost"), "옛 base_cost 칸을 아직도 베낀다");
    assert.ok(
      form.includes(
        "// 「조사작업 제외」를 켜면 「① 인수 조사」도 사라진다 — 저장할 때와 같은 그 상태다. investigationExcluded,"
      ),
      "미리보기에 조사작업 제외를 넘기지 않는다"
    );
  });

  test("🔴 작업비 계산에 세 공수시간과 세 제외를 넘긴다 — 기본 작업비는 그 합이다", () => {
    // 🔴 2026-09-16 — 기본 작업비 = (조사h + 통전h + 서류h) × 시간당 단가이고, 세 몫은
    // 서로를 보지 않는다. 그래서 「통전 공수시간을 조사 몫 때문에 넘긴다」는 얽힘이 없다.
    assert.ok(
      form.includes(
        "activeLabor ? { hourlyRate: activeLabor.hourlyRate, investigationHours: activeLabor.investigationHours, powerTestHours: activeLabor.powerTestHours, documentHours: activeLabor.documentHours, } : null,"
      ),
      "세 공수시간 · 단가를 넘기는 모양이 달라졌다"
    );
    assert.ok(
      form.includes(
        "activeLabor ? { investigation: investigationExcluded, powerTest: powerTestExcluded, document: documentExcluded, } : undefined ), [selectedTasks, activeLabor, powerTestExcluded, investigationExcluded, documentExcluded] );"
      ),
      "작업비 계산이 세 제외를 받지 않는다"
    );
    assert.ok(form.includes("const investigationDeduction = laborSuggestion.investigationDeduction ?? null;"));
  });

  test("🔴 「서류작업 제외」도 상태다 — 저장된 결정으로 시작하고, 저장에 실린다(왕복)", () => {
    assert.ok(
      form.includes(
        "const [documentExcluded, setDocumentExcluded] = useState<boolean>( quote?.documentExcluded ?? false );"
      ),
      "서류작업 제외가 상태가 아니다"
    );
    // 읽기 전용이던 옛 줄이 남아 있으면 체크 상자와 두 목소리가 된다.
    assert.ok(!form.includes("const documentExcluded = quote?.documentExcluded ?? false;"), "아직도 읽기만 한다");
    const collect = sliceBetween(form, "function collectFields() {", "async function handleSubmit(");
    assert.ok(collect.includes("documentExcluded,"), "저장에 서류작업 제외가 실리지 않는다");
    // 🔴 조사·통전과 달리 **뺀 금액을 보내지 않는다** — 담을 칸이 없다(조사도 같다).
    assert.ok(!collect.includes("laborDocumentDeduction"), "서류용 차감 금액 칸이 생겼다 — 이번 결정이 아니다");
    // 상태를 바꾸는 곳은 체크 상자 하나다 — 서류에는 줄을 지워 저절로 켜질 작업 내역 칸이 없다.
    assert.equal(form.split("setDocumentExcluded(").length - 1, 1, "서류작업 제외를 바꾸는 곳이 하나가 아니다");
    // 🔴 「손댄 것으로 본다」 판정에도 들어가지 않는다 — 조사가 그 판정에 든 까닭은 감춰 둔 조사
    // 칸에 양식 기본값이 들어오는 일 때문인데, 서류에는 감출 칸도 저장될 줄도 없다.
    const touched = sliceBetween(form, "const [scopeTouched, setScopeTouched] = useState<", "const [isConflict,");
    assert.ok(!touched.includes("documentExcluded"), "손댄 것으로 보는 판정이 서류작업 제외를 본다");
  });

  test("🔴 체크 상자가 셋째로 같은 줄에 있다 — 곁말이 「금액만 빠진다」를 말한다", () => {
    const documentBox = checkbox("documentExcluded", "setDocumentExcluded", "서류작업 제외").replace(
      "</label>",
      '<span className="text-xs text-zinc-500 dark:text-zinc-400"> (견적서에는 서류작업 항목이 없어 금액만 빠집니다) </span> </label>'
    );
    assert.equal(form.split(documentBox).length - 1, 1, "서류작업 제외 체크 상자가 없거나 모양이 다르다");
    const at = form.indexOf(investigationBox);
    const next = form.indexOf(documentBox);
    assert.ok(at < next, "서류작업 제외가 조사작업 제외 뒤에 있지 않다");
    // 통전 · 조사와 같은 줄(같은 flex 칸)이다.
    const between = form.slice(at + investigationBox.length, next);
    assert.ok(!between.includes("<div") && !between.includes("</div>"), `체크 상자가 다른 칸에 있다: ${between}`);
  });

  test("🔴 문서는 서류작업 제외에 반응하지 않는다 — 미리보기에 넘기지 않는다", () => {
    // 견적서의 구역은 조사 · 수리 · 통전 셋뿐이라 서류작업은 적히는 자리가 없다
    // (사용자 결정 2026-09-16). 넘기면 미리보기와 받아 본 문서가 갈라진다.
    const preview = sliceBetween(form, "quote={{", "}} />");
    assert.ok(!preview.includes("documentExcluded"), "미리보기에 서류작업 제외를 넘긴다");
    // 감춤 판정도 세 묶음짜리 그대로다 — 서류는 감출 칸이 없다.
    assert.ok(!sectionMap.includes("documentExcluded"), "작업 내역 칸이 서류작업 제외를 본다");
  });

  test("🔴 내역이 뺀 서류작업 몫과 못 뺀 까닭을 말한다 — 지금 세 장비 모두 서류 시간이 비어 있다", () => {
    assert.ok(form.includes("const documentDeduction = laborSuggestion.documentDeduction ?? null;"));
    const breakdown = sliceBetween(form, '<p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300"> 기본 작업비{" "}', "</p>");
    assert.ok(breakdown.includes("{documentDeduction !== null && ("), "뺀 서류 몫을 그리지 않는다");
    assert.ok(breakdown.includes("− 서류작업 몫"), breakdown);
    assert.ok(breakdown.includes("{formatAmount(documentDeduction)}"), breakdown);
    assert.ok(breakdown.includes("(서류작업 제외)"), breakdown);
    // 🔴 못 뺀 까닭 둘 — 통전 · 조사와 같은 모양이다.
    const reasons: readonly (readonly [string, string])[] = [
      ["NO_HOURS", "서류 공수시간을 먼저 정해 주세요 — 정하기 전까지는 서류작업 몫을 빼지 않습니다"],
      ["UNKNOWN_HOURLY_RATE", "시간당 작업비를 읽지 못해 서류작업 몫을 빼지 않았습니다"],
    ];
    for (const [notice, phrase] of reasons) {
      const branch = sliceBetween(form, `{laborSuggestion.documentNotice === "${notice}" && (`, "</p>");
      assert.ok(branch.includes(phrase), branch);
    }
  });

  test("🔴 내역이 뺀 조사작업 몫과 까닭을 말한다 — 통전 차감 줄은 예전 그대로", () => {
    const breakdown = sliceBetween(form, '<p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300"> 기본 작업비{" "}', "</p>");
    assert.ok(breakdown.includes("{investigationDeduction !== null && ("), "뺀 조사 몫을 그리지 않는다");
    assert.ok(breakdown.includes("− 조사작업 몫"), breakdown);
    assert.ok(breakdown.includes("{formatAmount(investigationDeduction)}"), breakdown);
    assert.ok(breakdown.includes("(조사작업 제외)"), breakdown);
    // 기본 작업비는 통째로 빠지지 않는다 — 지운 줄로 그리지 않고 예전 모양 그대로다.
    assert.ok(!breakdown.includes("line-through"), "기본 작업비를 통째로 뺀 것처럼 그린다");
    assert.ok(breakdown.includes('<b className="tabular-nums">{formatAmount(laborSuggestion.baseCost)}</b>'));
    // 통전 차감 줄 — 예전 그대로.
    assert.ok(
      breakdown.includes(
        '{powerTestDeduction !== null && ( <> <span className="text-zinc-500 dark:text-zinc-400">· 통전작업 제외</span>{" "} <b className="tabular-nums text-amber-700 dark:text-amber-400"> −{formatAmount(powerTestDeduction)} </b>{" "} </> )}'
      ),
      "통전 차감 줄이 달라졌다"
    );
    // 🔴 못 뺀 까닭 **둘**. 조사 몫이 제 공수시간으로 정해지므로 통전 쪽을 볼 일이 없다.
    const reasons: readonly (readonly [string, string])[] = [
      ["NO_HOURS", "조사 공수시간을 먼저 정해 주세요 — 정하기 전까지는 조사작업 몫을 빼지 않습니다"],
      ["UNKNOWN_HOURLY_RATE", "시간당 작업비를 읽지 못해 조사작업 몫을 빼지 않았습니다"],
    ];
    for (const [notice, phrase] of reasons) {
      const branch = sliceBetween(form, `{laborSuggestion.investigationNotice === "${notice}" && (`, "</p>");
      assert.ok(branch.includes(phrase), branch);
    }
    assert.ok(form.includes("{laborSuggestion.baseCost === null && ( <p"), "기본 작업비를 정하지 않은 안내가 달라졌다");
    // 옛 갈래(조사 제외면 기본 작업비를 통째로 빼고 통전 차감을 안 한다)는 없다.
    for (const gone of ["BASE_COST_DROPPED", "baseCostDroppedByInvestigation", "조사작업 제외로 뺌"]) {
      assert.ok(!form.includes(gone), `옛 갈래가 남았다: ${gone}`);
    }
    // 🔴 조사 몫이 「나머지」이던 시절의 알림 종류는 없다 — 남으면 화면이 통전 몫을 아직
    // 보고 있다고 말하는 셈이다(domain/quote-labor-cost.ts 의 「사라진 예외들」).
    for (const gone of ["CLAMPED_TO_ZERO", "NO_POWER_TEST_HOURS", "NO_BASE_COST"]) {
      assert.ok(!form.includes(gone), `사라진 규칙이 화면에 남았다: ${gone}`);
    }
    // 옛 셈(기본 작업비 − 통전작업 몫)은 **사람이 읽는 글자**에 남아 있지 않다. 원본 주석에
    // 한 줄 남는 것은 왜 사라졌는지를 적어 둔 자리라 여기서 가려 본다.
    for (const [name, text] of [
      ["조사작업 제외 안내", sliceBetween(form, "const INVESTIGATION_EXCLUDED_NOTICE =", ";")],
      ["못 뺀 까닭", sliceBetween(form, '{laborSuggestion.investigationNotice === "NO_HOURS" && (', "</p>")],
    ] as const) {
      assert.ok(!text.includes("기본 작업비 −"), `${name} 가 아직 옛 셈으로 말한다: ${text}`);
    }
  });

  test("🔴 작업비 칸은 [계산한 작업비 적용] 을 누를 때만 바뀐다 — 체크가 금액을 조용히 덮지 않는다", () => {
    assert.equal(form.split("setWorkCost(").length - 1, 1, "작업비 칸을 바꾸는 곳이 늘었다");
    assert.ok(form.includes("onClick={() => setWorkCost(String(laborSuggestion.total))}"));
    assert.ok(!toggle.includes("setWorkCost"), "체크 상자가 작업비 칸을 바꾼다");
  });

  test("옛 안내(「줄을 모두 지워 빠진다」)는 없다 — 감춘 칸의 안내가 대신한다", () => {
    assert.ok(!form.includes("INVESTIGATION_EMPTIED_NOTICE"));
    assert.ok(!visibleBranch.includes('section === "INVESTIGATION"'), "보이는 칸에 조사 전용 갈래가 남았다");
  });
});

describe("「2) 수리 작업」 줄을 지우면 그 작업의 체크도 풀린다", () => {
  test("🔴 × 는 removeScopeRow 로 지운다 — 수리 칸일 때만 도메인 규칙으로 체크를 푼다", () => {
    assert.ok(visibleBranch.includes("onClick={() => removeScopeRow(section, rows, row)}"), "× 가 줄만 지운다");
    const fn = sliceBetween(form, "function removeScopeRow(", "function applyOverhaulRule(");
    assert.ok(fn.includes("editScope(section, remaining);"), "줄을 지우지 않는다");
    assert.ok(fn.includes('if (section !== "REPAIR" || !activeLabor) return;'), "수리 칸이 아닌데도 체크를 본다");
    assert.ok(
      fn.includes(
        "uncheckRepairTaskForRemovedLine(activeLabor.tasks, taskQuantities, removed.text, remaining.map((r) => r.text))"
      ),
      "체크를 푸는 판단을 도메인에 맡기지 않는다"
    );
    // 줄은 이미 지웠다 — 다시 채우면 방금 지운 줄이 되살아나거나 손본 줄이 덮인다.
    assert.ok(!fn.includes("fillRepairScopeFrom"), "지운 뒤에 줄을 다시 채운다");
  });
});

describe("감춘 칸", () => {
  test("🔴 줄 입력·[+ 줄 추가]·[×] 가 없고 안내가 있다", () => {
    assert.ok(suppressedBranch.includes("{SUPPRESSED_SCOPE_NOTICES[section]}"), "안내를 그리지 않는다");
    // 칸마다 제 안내 — 묶음이 늘면 Record 가 컴파일에서 막는다.
    assert.ok(
      form.includes(
        "const SUPPRESSED_SCOPE_NOTICES: Record<QuoteWorkScopeSection, string> = { INVESTIGATION: INVESTIGATION_EXCLUDED_NOTICE, REPAIR: REPAIR_SCOPE_DROPPED_NOTICE, POWER_TEST: WORK_SCOPE_SUPPRESSED_NOTICE, };"
      ),
      "칸마다의 안내가 달라졌다"
    );
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
    // 수리 작업 쪽은 **왜** 빠졌는지와 되돌리는 길(작업을 고른다)을 말한다.
    const repairNotice = sliceBetween(form, "const REPAIR_SCOPE_DROPPED_NOTICE =", ";");
    assert.ok(repairNotice.includes("수리 작업을 하나도 고르지 않아"), repairNotice);
    assert.ok(repairNotice.includes("견적서에 나가지 않습니다"), repairNotice);
    assert.ok(repairNotice.includes("작업을 고르면 다시 보입니다"), repairNotice);
    // 🔴 조사작업 쪽은 **기본 작업비 중 조사작업 몫이 빠진다**는 것까지 말한다 — 구역만 빠지는
    // 줄 알고 켜면 작업비가 줄어든 것을 모른 채 적용한다. 되돌리는 길(체크를 푼다)도 함께.
    const investigationNotice = sliceBetween(form, "const INVESTIGATION_EXCLUDED_NOTICE =", ";");
    assert.ok(investigationNotice.includes("조사작업 제외"), investigationNotice);
    assert.ok(investigationNotice.includes("견적서에 나가지 않"), investigationNotice);
    assert.ok(
      investigationNotice.includes("기본 작업비 중 조사작업 몫(조사 공수시간 × 시간당 작업비)이 빠집니다"),
      investigationNotice
    );
    assert.ok(!investigationNotice.includes("기본 작업비도"), "기본 작업비가 통째로 빠지는 것처럼 말한다");
    assert.ok(investigationNotice.includes("체크를 풀면 적어 둔 줄이 다시 보이고"), investigationNotice);
    assert.ok(investigationNotice.includes("양식 기본 목록으로 채워집니다"), investigationNotice);
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
    // 제외 상태를 바꾸는 곳은 둘이다 — 체크 상자, 그리고 통전 칸의 마지막 줄 지우기(아래).
    assert.equal(form.split("setPowerTestExcluded(").length - 1, 2, "제외 상태를 바꾸는 곳이 둘이 아니다");
  });

  test("🔴 「3) 통전작업」의 마지막 줄을 지우면 「통전작업 제외」가 켜진다 — 켜기만 한다", () => {
    const fn = sliceBetween(form, "function removeScopeRow(", "function applyOverhaulRule(");
    assert.ok(
      fn.includes('if (section === "POWER_TEST" && remaining.length === 0) setPowerTestExcluded(true);'),
      "마지막 줄을 지워도 제외가 켜지지 않는다"
    );
    // 끄는 길은 체크 상자 하나다 — 줄을 더한다고 저절로 풀리지 않는다.
    assert.ok(!fn.includes("setPowerTestExcluded(false)"));
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
        assert.ok(!call.includes("repairSectionDropped"), `${setter} 가 수리 빠짐을 본다: ${call}`);
        assert.ok(!call.includes("investigationExcluded"), `${setter} 가 조사작업 제외를 본다: ${call}`);
        calls += 1;
        at = form.indexOf(setter, at + setter.length);
      }
    }
    assert.ok(calls > 0, "상태를 바꾸는 부르기를 하나도 찾지 못했다 — 시험이 헛돈다");
    assert.ok(!suppressedBranch.includes("setScope"), "감춘 칸이 상태를 바꾼다");
  });

  test("저장하는 작업 내역은 감춤과 무관하게 세 칸 모두 그대로 보낸다", () => {
    const collect = sliceBetween(form, "function collectFields() {", "async function handleSubmit(");
    /**
     * 🔴 **감춤(suppressed)은 여전히 보지 않는다** — 통전 · 조사 · 수리 구역을 감춰도 적어 둔
     * 줄은 그대로 저장된다(체크를 풀면 돌아와야 한다).
     *
     * 갈래가 하나 늘었다: **케이블 견적서는 작업 내역 자체가 없는 양식**이라 빈 배열을 보낸다
     * (2026-09-16 케이블 ③ — quote-edit-cable.test.ts). 감춤과는 다른 일이다.
     */
    assert.ok(
      collect.includes(
        "workScopeLines: isCable ? [] : QUOTE_WORK_SCOPE_SECTIONS.flatMap((section) => scopeLines[section].map((row) => ({ section, text: row.text })) ),"
      ),
      "저장하는 작업 내역의 모양이 달라졌다"
    );
    assert.ok(!collect.includes("suppress"), "저장이 감춤을 본다");
  });
});
