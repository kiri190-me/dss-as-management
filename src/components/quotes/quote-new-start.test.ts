import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NewQuoteStart } from "@/lib/domain/quote-new-link";
import {
  applyOverhaulQuantities,
  repairTaskQuantityOf,
  restoreRepairTaskQuantities,
  type RepairTaskCatalogEntry,
} from "@/lib/domain/quote-repair-task-selection";
import { QUOTE_WORK_SCOPE_SECTIONS } from "@/lib/validation/quote-input";
import { countQuoteLinesForExcelOnly, planExcelOnlyToggle } from "./quote-attachment-files";
import {
  BLANK_NEW_QUOTE_KIND,
  scopeLinesFilledFromTemplate,
  startNewQuoteLines,
  type QuoteFormLines,
  type QuoteTemplateScopeDefaults,
} from "./quote-new-start";

/**
 * ============================================================================
 * [새 견적서] 팝업의 처음 값으로 연 폼 = 빈 폼에서 사람이 그 값을 손으로 고른 폼 (견적서 ⑤)
 * ============================================================================
 * 처음 상태를 셈하는 규칙은 순수 함수(quote-new-start.ts 의 startNewQuoteLines)라 값으로 본다.
 * 「손으로 고른 폼」은 **폼의 onChange 가 부르는 바로 그 도우미**로 따라가 본다:
 *  · 종류 select → scopeLinesFilledFromTemplate(폼의 fillScopeFromTemplate 가 부른다)
 *  · 장비 종류 select → applyOverhaulQuantities(폼의 applyOverhaulRule 이 부른다) + 위 채우기
 *  · 엑셀 전용 스위치 → planExcelOnlyToggle(폼의 toggleExcelOnly 가 부른다)
 *
 * 폼이 그 함수들을 제자리에서 부르고 처음 상태를 상태 칸마다 넘기는지는 아래 「폼 · 새 견적서
 * 화면이 규칙을 제자리에서 부르는가」가 원본을 읽어 본다 — QuoteEditForm 은 서버 액션을 부르는
 * 클라이언트 컴포넌트라 이 시험 환경에서 그려 볼 수 없다(`server-only`, 이웃 시험
 * quote-edit-work-scope-suppression.test.ts 와 같은 까닭).
 * ============================================================================
 */

type Item = { key: string; partNameText: string; unitPrice: string };
type Row = { key: string; text: string };
type Lines = QuoteFormLines<Item, Row>;

let rowSeq = 0;
const toRows = (texts: readonly string[]): Row[] => texts.map((text) => ({ key: `row-${(rowSeq += 1)}`, text }));

/** 폼의 blankNewQuoteLines 와 같은 모양 — 부품 빈 줄 하나 · 작업 내역 없음 · 손대지 않음 · 고른 작업 없음. */
function blankLines(): Lines {
  return {
    items: [{ key: "item-0", partNameText: "", unitPrice: "" }],
    scopeLines: { INVESTIGATION: [], REPAIR: [], POWER_TEST: [] },
    scopeTouched: { INVESTIGATION: false, REPAIR: false, POWER_TEST: false },
    taskQuantities: restoreRepairTaskQuantities([]),
  };
}

/** 폼의 clearedExcelOnlyLines 와 같은 모양 — 비운 칸은 「손댄 것」이다. */
function clearedLines(): Lines {
  return {
    items: [{ key: "item-cleared", partNameText: "", unitPrice: "" }],
    scopeLines: { INVESTIGATION: [], REPAIR: [], POWER_TEST: [] },
    scopeTouched: { INVESTIGATION: true, REPAIR: true, POWER_TEST: true },
    taskQuantities: restoreRepairTaskQuantities([]),
  };
}

/** 양식 넷의 작업 내역 기본값 — 어느 양식에서 왔는지 글자로 드러나게. */
const TEMPLATES: Record<string, QuoteTemplateScopeDefaults> = {
  "GENERATOR:DOMESTIC": {
    INVESTIGATION: { items: ["[G 내자] 인수 조사"] },
    REPAIR: { items: ["[G 내자] 양식 수리"] },
    POWER_TEST: { items: ["[G 내자] 통전 1", "[G 내자] 통전 2"] },
  },
  "GENERATOR:OVERHAUL": {
    INVESTIGATION: { items: ["[G OH] 인수 조사 1", "[G OH] 인수 조사 2"] },
    REPAIR: { items: ["[G OH] 양식 수리"] },
    POWER_TEST: { items: ["[G OH] 통전"] },
  },
  "MATCHER:DOMESTIC": {
    INVESTIGATION: { items: ["[M 내자] 조사"] },
    REPAIR: { items: [] },
    POWER_TEST: { items: ["[M 내자] 통전"] },
  },
  "MATCHER:OVERHAUL": {
    INVESTIGATION: { items: ["[M OH] 조사"] },
    REPAIR: { items: [] },
    POWER_TEST: { items: ["[M OH] 통전 1", "[M OH] 통전 2"] },
  },
};

/** 장비 하나의 수리 작업 목록 — 오버홀 작업이 표시돼 있다. */
const MATCHER_TASKS: RepairTaskCatalogEntry[] = [
  { id: "t-rf", taskName: "RF 보드 수리", hours: 2, isOverhaul: false },
  { id: "t-oh", taskName: "오버홀", hours: 10, isOverhaul: true },
];

const texts = (rows: readonly Row[]) => rows.map((row) => row.text);
const scopeTexts = (lines: Lines) => ({
  INVESTIGATION: texts(lines.scopeLines.INVESTIGATION),
  REPAIR: texts(lines.scopeLines.REPAIR),
  POWER_TEST: texts(lines.scopeLines.POWER_TEST),
});
const itemsOf = (key: string) => TEMPLATES[key];

function open(start: NewQuoteStart, workScopeDefaults: Record<string, QuoteTemplateScopeDefaults> = TEMPLATES) {
  const blank = blankLines();
  const cleared = clearedLines();
  return { blank, cleared, state: startNewQuoteLines({ start, blank, cleared, workScopeDefaults, toRows }) };
}

/** 폼의 장비 종류 select 가 하는 그대로 — applyOverhaulRule(kind, 장비) · fillScopeFromTemplate(kind, 장비). */
function pickMatcherByHand(kind: "DOMESTIC" | "OVERHAUL", lines: Lines): Lines {
  const quantities = applyOverhaulQuantities(MATCHER_TASKS, lines.taskQuantities, kind === "OVERHAUL") ?? lines.taskQuantities;
  return {
    ...lines,
    taskQuantities: quantities,
    scopeLines: scopeLinesFilledFromTemplate(lines.scopeLines, lines.scopeTouched, itemsOf(`MATCHER:${kind}`), toRows),
  };
}

/** 폼의 엑셀 전용 스위치가 하는 그대로 — 줄이 있으면 먼저 묻는다(confirmedClear 거짓). */
function toggleExcelOnlyByHand(params: { turnOn: boolean; confirmedClear: boolean; lines: Lines; stash: Lines | null; cleared: Lines }) {
  return planExcelOnlyToggle({
    turnOn: params.turnOn,
    confirmedClear: params.confirmedClear,
    counts: countQuoteLinesForExcelOnly({
      items: params.lines.items,
      workScopeTexts: QUOTE_WORK_SCOPE_SECTIONS.flatMap((section) => texts(params.lines.scopeLines[section])),
      repairTaskCount: 0,
    }),
    current: params.lines,
    cleared: params.cleared,
    stash: params.stash,
  });
}

describe("🔴 (c) 두 값이 없으면 지금까지의 빈 폼 그대로다", () => {
  test("종류 없음 · 내자, 엑셀 전용 아님 — 빈 줄 묶음을 그대로(같은 것) 돌려준다", () => {
    for (const start of [
      { kind: null, excelOnly: false },
      { kind: "DOMESTIC", excelOnly: false },
    ] as const) {
      const { blank, state } = open(start);
      assert.equal(state.kind, "DOMESTIC");
      assert.equal(state.kind, BLANK_NEW_QUOTE_KIND);
      assert.equal(state.isExcelOnly, false);
      assert.equal(state.excelOnlyStash, null);
      assert.equal(state.lines, blank, "빈 폼의 줄을 바꿨다");
    }
  });
});

describe("🔴 (b) 처음 값 OH = 빈 폼에서 종류 select 를 OH 로 고른 폼", () => {
  test("종류는 OH, 조사 · 통전 칸은 **OH 양식**의 기본 목록이다 — 내자 목록이 아니다", () => {
    const { blank, state } = open({ kind: "OVERHAUL", excelOnly: false });
    assert.equal(state.kind, "OVERHAUL");
    assert.deepEqual(scopeTexts(state.lines), {
      INVESTIGATION: ["[G OH] 인수 조사 1", "[G OH] 인수 조사 2"],
      // 「2) 수리 작업」은 양식이 아니라 고른 작업이 채운다 — 비어 있다.
      REPAIR: [],
      POWER_TEST: ["[G OH] 통전"],
    });
    for (const line of [...state.lines.scopeLines.INVESTIGATION, ...state.lines.scopeLines.POWER_TEST]) {
      assert.ok(!line.text.includes("내자"), `OH 인데 내자 목록이 들어왔다: ${line.text}`);
    }
    // 채운 칸은 손대지 않은 것이다 — 장비 종류를 고르면 그 장비의 OH 양식으로 다시 따라간다.
    assert.deepEqual(state.lines.scopeTouched, blank.scopeTouched);
    // 나머지는 빈 폼 그대로다.
    assert.equal(state.lines.items, blank.items);
    assert.equal(state.lines.taskQuantities, blank.taskQuantities);
    assert.equal(state.isExcelOnly, false);
    assert.equal(state.excelOnlyStash, null);
  });

  test("🔴 손으로 고른 폼과 같다 — 종류 select 가 부르는 그 채우기로 채운 목록이다", () => {
    const { blank, state } = open({ kind: "OVERHAUL", excelOnly: false });
    // 폼의 종류 select: 장비 종류가 아직 없으니 양식 키는 quoteTemplateKey(null, "OVERHAUL") = GENERATOR:OVERHAUL.
    const byHand = scopeLinesFilledFromTemplate(blank.scopeLines, blank.scopeTouched, itemsOf("GENERATOR:OVERHAUL"), toRows);
    assert.deepEqual(scopeTexts(state.lines), scopeTexts({ ...blank, scopeLines: byHand }));
  });

  test("🔴 오버홀 규칙 — 장비 종류를 고르면 오버홀 작업이 체크되고, 그 장비의 OH 양식 목록으로 간다", () => {
    const { state } = open({ kind: "OVERHAUL", excelOnly: false });
    // 새 견적서는 장비 종류가 없어 여기까지는 고른 작업이 없다(오버홀 규칙이 돌 작업 목록이 없다).
    assert.equal(state.lines.taskQuantities.size, 0);
    const afterPick = pickMatcherByHand(state.kind as "OVERHAUL", state.lines);
    assert.equal(repairTaskQuantityOf(afterPick.taskQuantities, "t-oh"), 1, "OH 인데 오버홀 작업이 체크되지 않는다");
    assert.equal(repairTaskQuantityOf(afterPick.taskQuantities, "t-rf"), 0);
    assert.deepEqual(scopeTexts(afterPick), {
      INVESTIGATION: ["[M OH] 조사"],
      REPAIR: [],
      POWER_TEST: ["[M OH] 통전 1", "[M OH] 통전 2"],
    });
  });

  test("내자로 열면 장비 종류를 골라도 오버홀 작업은 체크되지 않고 내자 양식 목록으로 간다", () => {
    const { state } = open({ kind: null, excelOnly: false });
    const afterPick = pickMatcherByHand(state.kind as "DOMESTIC", state.lines);
    assert.equal(repairTaskQuantityOf(afterPick.taskQuantities, "t-oh"), 0);
    assert.deepEqual(scopeTexts(afterPick), { INVESTIGATION: ["[M 내자] 조사"], REPAIR: [], POWER_TEST: ["[M 내자] 통전"] });
  });

  test("양식을 못 읽었으면 종류만 OH 이고 줄은 빈 폼 그대로다 — 폼의 채우기도 그때 그대로 둔다", () => {
    const { blank, state } = open({ kind: "OVERHAUL", excelOnly: false }, {});
    assert.equal(state.kind, "OVERHAUL");
    assert.equal(state.lines, blank);
  });
});

describe("🔴 (b) 처음 값 엑셀 전용 = 빈 폼에서 엑셀 전용 스위치를 켠 폼", () => {
  test("내자 · 엑셀 전용 — 스위치가 켜지고 줄은 비운 묶음, 넣어 둔 것은 빈 폼이다", () => {
    const { blank, cleared, state } = open({ kind: null, excelOnly: true });
    assert.equal(state.kind, "DOMESTIC");
    assert.equal(state.isExcelOnly, true, "스위치가 켜지지 않았다");
    // 품목 구역은 폼이 엑셀 전용일 때 통째로 접는다(아래 원본 시험) — 줄 자체도 비운 묶음이다.
    assert.equal(state.lines, cleared);
    assert.equal(state.excelOnlyStash, blank, "끄면 돌아올 줄이 빈 폼이 아니다");

    // 손으로: 빈 폼에는 줄이 없어 묻지 않고 곧바로 켜진다 — 결과가 같다.
    const byHand = toggleExcelOnlyByHand({ turnOn: true, confirmedClear: false, lines: blank, stash: null, cleared });
    assert.deepEqual(byHand, { kind: "APPLY", isExcelOnly: true, lines: cleared, stash: blank });
  });

  test("🔴 OH · 엑셀 전용 — 종류를 고른 뒤 스위치를 켜고 「비우고 켜기」를 고른 폼이다", () => {
    const { blank, cleared, state } = open({ kind: "OVERHAUL", excelOnly: true });
    assert.equal(state.kind, "OVERHAUL");
    assert.equal(state.isExcelOnly, true);
    assert.equal(state.lines, cleared);

    // 손으로: 종류를 OH 로 고르면 조사 · 통전 칸이 차서, 스위치를 켜면 폼이 먼저 묻는다.
    const afterKind = { ...blank, scopeLines: scopeLinesFilledFromTemplate(blank.scopeLines, blank.scopeTouched, itemsOf("GENERATOR:OVERHAUL"), toRows) };
    const ask = toggleExcelOnlyByHand({ turnOn: true, confirmedClear: false, lines: afterKind, stash: null, cleared });
    assert.deepEqual(ask, { kind: "ASK_TO_CLEAR", counts: { items: 0, workScopeLines: 3, repairTasks: 0 } });
    // 「비우고 켜기」 — 넣어 둔 것이 OH 양식 목록을 든 그 폼이다.
    const confirmed = toggleExcelOnlyByHand({ turnOn: true, confirmedClear: true, lines: afterKind, stash: null, cleared });
    assert.equal(confirmed.kind, "APPLY");
    assert.equal(state.excelOnlyStash === null, false);
    assert.deepEqual(scopeTexts(state.excelOnlyStash as Lines), scopeTexts(afterKind));
    assert.deepEqual((state.excelOnlyStash as Lines).scopeTouched, afterKind.scopeTouched);
  });

  test("🔴 저장 전에 엑셀 전용을 끄면 그 종류의 폼이 돌아온다 — OH 로 연 폼과 같다", () => {
    const { cleared, state } = open({ kind: "OVERHAUL", excelOnly: true });
    const turnedOff = toggleExcelOnlyByHand({ turnOn: false, confirmedClear: false, lines: state.lines, stash: state.excelOnlyStash, cleared });
    assert.equal(turnedOff.kind, "APPLY");
    if (turnedOff.kind !== "APPLY") return;
    assert.equal(turnedOff.isExcelOnly, false);
    const ohOnly = open({ kind: "OVERHAUL", excelOnly: false }).state;
    assert.deepEqual(scopeTexts(turnedOff.lines as Lines), scopeTexts(ohOnly.lines));
    assert.deepEqual((turnedOff.lines as Lines).scopeTouched, ohOnly.lines.scopeTouched);
  });
});

describe("조사 · 통전 채우기(scopeLinesFilledFromTemplate) — 폼과 처음 상태가 함께 쓰는 한 벌", () => {
  test("🔴 손댄 묶음은 덮지 않고, 「2) 수리 작업」은 양식으로 채우지 않는다", () => {
    const written = toRows(["사람이 적은 조사"]);
    const repair = toRows(["고른 작업"]);
    const next = scopeLinesFilledFromTemplate(
      { INVESTIGATION: written, REPAIR: repair, POWER_TEST: [] },
      { INVESTIGATION: true, REPAIR: false, POWER_TEST: false },
      itemsOf("GENERATOR:OVERHAUL"),
      toRows
    );
    assert.equal(next.INVESTIGATION, written, "손댄 조사 칸을 덮었다");
    assert.equal(next.REPAIR, repair, "수리 작업 칸을 양식으로 바꿨다");
    assert.deepEqual(texts(next.POWER_TEST), ["[G OH] 통전"]);
  });
});

// ───────────────────────────── 원본 — 폼 · 새 견적서 화면이 규칙을 제자리에서 부르는가

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};

const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));
const newPage = flat(read("src/app/(app)/quotes/new/page.tsx"));

describe("폼 · 새 견적서 화면이 규칙을 제자리에서 부르는가", () => {
  test("🔴 새 견적서 화면은 주소의 두 값을 되읽어 폼에 넘긴다 — 인수번호 · 건 id 와 같은 주소에서", () => {
    assert.ok(
      newPage.includes(
        "const query = searchParams ? await searchParams : undefined; const link = parseNewQuoteLink(query); const start = parseNewQuoteStart(query);"
      ),
      "두 값을 되읽지 않는다"
    );
    assert.ok(newPage.includes("initialKind={start.kind} initialExcelOnly={start.excelOnly}"), "폼에 두 값을 넘기지 않는다");
    assert.ok(newPage.includes("initialIntakeNumber={link.intakeNumber}"), "인수번호가 떨어졌다");
    assert.ok(newPage.includes("returnHref={returnHrefForNewQuote(link)}"), "돌아갈 곳이 떨어졌다");
    // 쓰기 권한이 없으면 되읽기 전에 돌려보낸다 — 순서는 그대로다.
    assert.ok(indexOrFail(newPage, 'if (!canEdit) redirect("/quotes");') < indexOrFail(newPage, "parseNewQuoteStart(query)"));
  });

  test("🔴 처음 상태는 새 견적서에서만, 빈 폼 위에서 한 번 셈한다", () => {
    assert.ok(
      form.includes(
        "const [newQuoteStart] = useState(() => quote === null ? startNewQuoteLines({ start: { kind: initialKind, excelOnly: initialExcelOnly }, blank: blankNewQuoteLines(), cleared: clearedExcelOnlyLines(), workScopeDefaults, toRows: toScopeRows, }) : null );"
      ),
      "처음 상태를 셈하는 모양이 다르다"
    );
    assert.ok(form.includes("initialKind = null, initialExcelOnly = false,"), "두 값의 기본이 「없음」이 아니다");
    // 빈 줄 묶음 = 지금까지 새 견적서가 들고 시작한 그대로.
    assert.ok(
      form.includes(
        "function blankNewQuoteLines(): ExcelOnlyLines { return { items: [emptyItem()], scopeLines: { INVESTIGATION: [], REPAIR: [], POWER_TEST: [] }, scopeTouched: { INVESTIGATION: false, REPAIR: false, POWER_TEST: false }, taskQuantities: restoreRepairTaskQuantities([]), }; }"
      ),
      "빈 줄 묶음의 모양이 다르다"
    );
    // 종류 상태보다 먼저 셈한다 — 상태 칸들의 처음 값이 이것을 읽는다.
    assert.ok(indexOrFail(form, "const [newQuoteStart] = useState(") < indexOrFail(form, "const [kind, setKind] = useState<QuoteKind>("));
  });

  test("🔴 상태 칸마다 처음 상태를 쓴다 — 종류 · 엑셀 전용 · 넣어 둔 줄 · 부품 · 작업 내역 · 손댐 · 고른 작업", () => {
    for (const marker of [
      'const [kind, setKind] = useState<QuoteKind>(quote?.kind ?? newQuoteStart?.kind ?? "DOMESTIC");',
      "const [isExcelOnly, setIsExcelOnly] = useState<boolean>(quote?.isExcelOnly ?? newQuoteStart?.isExcelOnly ?? false);",
      "const [excelOnlyStash, setExcelOnlyStash] = useState<ExcelOnlyLines | null>(newQuoteStart?.excelOnlyStash ?? null);",
      ": (newQuoteStart?.lines.items ?? [emptyItem()]) );",
      "if (newQuoteStart) return newQuoteStart.lines.scopeLines;",
      "newQuoteStart?.lines.scopeTouched ?? {",
      "() => newQuoteStart?.lines.taskQuantities ?? restoreRepairTaskQuantities(quote?.repairTasks ?? [])",
    ]) {
      assert.ok(form.includes(marker), `처음 상태를 쓰지 않는다: ${marker}`);
    }
  });

  test("🔴 종류를 고를 때의 채우기와 처음 상태의 채우기가 같은 함수다", () => {
    const fill = sliceBetween(form, "function fillScopeFromTemplate(", "function fillRepairScopeFrom(");
    assert.ok(
      fill.includes("setScopeLines((prev) => scopeLinesFilledFromTemplate(prev, scopeTouched, defaults, toScopeRows));"),
      fill
    );
    // 채우는 규칙을 폼에 따로 적지 않는다.
    assert.ok(!form.includes('for (const section of ["INVESTIGATION", "POWER_TEST"] as const)'), "채우는 규칙이 폼에 따로 남았다");
    assert.ok(
      form.includes('import { scopeLinesFilledFromTemplate, startNewQuoteLines } from "@/components/quotes/quote-new-start";')
    );
  });

  test("🔴 오버홀 규칙은 장비 종류를 고를 때 **지금 종류**로 돈다 — OH 로 열었으면 OH 로", () => {
    const laborSelect = sliceBetween(form, 'aria-label="작업 목록의 장비 종류"', "</select>");
    const onChange = sliceBetween(form, "<select value={laborKind ?? \"\"}", 'aria-label="작업 목록의 장비 종류"');
    assert.ok(onChange.includes("setLaborKind(next); applyOverhaulRule(kind, next); fillScopeFromTemplate(kind, next);"), onChange);
    assert.ok(laborSelect.includes("장비 종류를 고르세요"), laborSelect);
    // 종류 select 는 그대로다 — 엑셀 전용이 아닐 때만 따라온다(quote-attachment-screens.test.ts 가 차례를 본다).
    // select 의 onChange 가 부르는 changeKind 안에서 본다(견적서 ①b — [엑셀 값으로 바꾸기]도 같은 함수를 탄다).
    const kindSelect = sliceBetween(form, "function changeKind(", "function editCustomerName(");
    assert.ok(indexOrFail(kindSelect, "setKind(next);") < indexOrFail(kindSelect, "if (!isExcelOnly) {"), kindSelect);
  });

  test("🔴 인수번호 자동 불러오기는 종류 · 엑셀 전용 · 줄을 덮지 않는다 — 품명만 지금 종류로 짓는다", () => {
    const lookup = sliceBetween(form, "async function handleLookup() {", "const didAutoLookup = useRef(false);");
    for (const setter of ["setKind(", "setIsExcelOnly(", "setExcelOnlyStash(", "setItems(", "setScopeLines(", "setScopeTouched(", "setTaskQuantities("]) {
      assert.ok(!lookup.includes(setter), `불러오기가 ${setter} 를 부른다`);
    }
    assert.ok(lookup.includes("buildQuoteSubject({ modelName: found.modelName, faultDescription: found.faultDescription, kind, })"), lookup);
    // 종류 · 엑셀 전용을 바꾸는 곳은 사람의 칸 하나씩이다 — 처음 상태 말고 몰래 바꾸는 길이 없다.
    assert.equal(form.split("setKind(").length - 1, 1, "종류를 바꾸는 곳이 select 하나가 아니다");
    assert.equal(form.split("setIsExcelOnly(").length - 1, 1, "엑셀 전용을 바꾸는 곳이 스위치 판정 하나가 아니다");
  });

  test("🔴 못 찾은 인수번호 — 조회가 받아 온 두 목록(출고 부품 · O/H 템플릿)을 비운다", () => {
    const lookup = sliceBetween(form, "async function handleLookup() {", "const didAutoLookup = useRef(false);");
    const notFound = sliceBetween(lookup, "if (!result.found) {", "const found = result.found;");
    // 🔴 실사용 결함(2026-09-22): D111(OH 건)을 불러온 뒤 인수번호를 없는 번호로 고쳐
    // 다시 부르면, 출고 부품 목록은 사라지는데 O/H 템플릿 목록은 앞 건 기종의 것이
    // 그대로 남고 [담기] 단추도 살아 있었다 — 담으면 지금 인수번호와 무관한 부품이
    // O/H 템플릿 단가를 달고 청구 줄로 들어간다. 못 찾음 갈래가 둘 다 비워야 한다.
    assert.ok(notFound.includes("setOhTemplateCode(null);"), notFound);
    assert.ok(notFound.includes("setOhTemplateParts([]);"), notFound);
    // 출고 부품을 비우는 지금까지의 동작도 살아 있다.
    assert.ok(notFound.includes("setUsedParts([]);"), notFound);
    // 🔴 같은 자리에서 **사람이 적는 칸은 그대로 둔다** — 비우는 것은 조회 결과의 사본뿐이다.
    // (종류 · 엑셀 전용 · 줄은 위 시험이 handleLookup 전체에 대해 못 박는다.)
    for (const setter of [
      "setRepairCaseId(",
      "setCustomerId(",
      "setCustomerNameText(",
      "setModelNameText(",
      "setLotNumberText(",
      "setSerialNumberText(",
      "setFaultDescriptionText(",
      "setSubject(",
      "setKind(",
      "setIsExcelOnly(",
      "setItems(",
      "setScopeLines(",
      "setScopeTouched(",
      "setTaskQuantities(",
    ]) {
      assert.ok(!notFound.includes(setter), `못 찾음 갈래가 ${setter} 를 부른다`);
    }
    // 찾았을 때의 갈래는 그대로다 — 받아 온 값으로 셋을 덮어쓴다.
    assert.ok(
      lookup.includes(
        "setUsedParts(found.usedParts); setOhTemplateCode(found.ohTemplateCode); setOhTemplateParts(found.ohTemplateParts);"
      ),
      lookup
    );
    // 왜 O/H 쪽만 눈에 남았는가 — 출고 부품 구역은 목록이 비면 구역째 안 그리지만,
    // O/H 구역은 종류가 OH 이기만 하면 값과 무관하게 그린다. 값을 비우는 것만이
    // 그 부품 줄과 [담기] 단추를 없앤다.
    assert.ok(form.includes("{!isCable && usedParts.length > 0 && ("), "출고 부품 구역의 그리는 조건이 바뀌었다");
    assert.ok(form.includes('{kind === "OVERHAUL" && ('), "O/H 템플릿 구역의 그리는 조건이 바뀌었다");
  });

  test("엑셀 전용이면 품목(부품) 구역이 없다 — 접는 조건이 부품 비용 구역 앞에서 열린다", () => {
    const open = indexOrFail(form, "{isExcelOnly ? (");
    // 구역의 제목은 2026-09-16(케이블 ③)부터 종류에 따라 갈린다 — 케이블이면 「품목」이다.
    assert.ok(
      open < indexOrFail(form, '{isCable ? "품목" : "부품 비용"}'),
      "부품 비용 구역이 접는 조건 밖이다"
    );
  });
});
