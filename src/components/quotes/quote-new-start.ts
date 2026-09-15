import type { NewQuoteStart } from "@/lib/domain/quote-new-link";
import type { RepairTaskQuantities } from "@/lib/domain/quote-repair-task-selection";
import { quoteTemplateKey } from "@/lib/domain/quote-template-variant";
import {
  QUOTE_WORK_SCOPE_SECTIONS,
  type QuoteKind,
  type QuoteWorkScopeSection,
} from "@/lib/validation/quote-input";
import { countQuoteLinesForExcelOnly, planExcelOnlyToggle } from "./quote-attachment-files";

/**
 * ============================================================================
 * 새 견적서의 처음 상태 — [새 견적서] 팝업에서 고른 값으로 연다 (견적서 ⑤)
 * ============================================================================
 * 팝업에서 **견적서 종류**(내자 · OH)와 **엑셀 전용 여부**를 고르면 작성 화면이 그 값으로
 * 처음부터 채워진 채 열린다(domain/quote-new-link.ts 의 parseNewQuoteStart).
 *
 * 🔴 **처음 값만 바꾸면 안 된다.** 폼에서는 종류 · 엑셀 전용을 고르면 따라 일어나는 일이
 * 있다(QuoteEditForm.tsx):
 *  · 견적서 종류 select → applyOverhaulRule(오버홀 작업 체크) · fillScopeFromTemplate(조사 ·
 *    통전 칸을 그 양식의 기본 목록으로).
 *  · 엑셀 전용 스위치 → planExcelOnlyToggle(줄을 넣어 두고 비운다 — 저장 전에 끄면 돌아온다).
 * 초기값만 바꾸고 이것을 빠뜨리면 「OH 인데 작업 내역은 내자 기본 목록」 같은 어긋난 폼이
 * 된다. 그래서 여기서는 **빈 폼을 연 뒤 사람이 ① 종류 select 를 고르고 ② 엑셀 전용 스위치를
 * 켠 것**을 그 순서 그대로, **폼의 onChange 가 쓰는 바로 그 함수들로** 한 번에 돌린다:
 *  ① scopeLinesFilledFromTemplate — 폼의 fillScopeFromTemplate 도 이 함수 하나로 채운다.
 *  ② planExcelOnlyToggle — 폼의 toggleExcelOnly 가 부르는 그 판정.
 *
 * ── 왜 이 순서인가(종류 → 엑셀 전용) ────────────────────────────────────
 * 폼의 칸 순서가 그렇고(종류가 첫 칸, 스위치는 상단 정보 끝), 그래야 엑셀 전용을 저장 전에
 * 껐을 때 **그 종류의 폼**(OH 면 OH 양식 목록)이 돌아온다. 거꾸로 하면 넣어 둔 줄이 내자
 * 빈 폼이라, 끄는 순간 OH 인데 조사 · 통전 칸이 빈 폼이 된다.
 *
 * OH 를 먼저 고르면 조사 · 통전 칸에 양식 목록이 차 있어서, 사람이 스위치를 켜면 폼은 「적힌
 * 줄을 비워야 합니다」를 묻는다(ExcelOnlyClearLinesDialog). 여기서는 **그 물음에 「비우고 켜기」
 * 를 고른 것**으로 친다(confirmedClear) — 팝업에서 엑셀 전용을 고른 것이 곧 그 대답이고,
 * 비우는 줄은 사람이 적은 것이 아니라 양식 기본 목록뿐이다.
 *
 * ── 오버홀 규칙은 지금 돌 일이 없다 ─────────────────────────────────────
 * applyOverhaulRule 은 **장비 종류**의 작업 목록에서 오버홀 작업을 찾는다. 새 견적서는 장비
 * 종류를 아직 안 골랐으므로(laborKind null) 사람이 종류를 OH 로 골라도 이 규칙은 아무 일도
 * 하지 않는다. 사람이 나중에 장비 종류를 고르는 순간 폼의 그 select 가 applyOverhaulRule(kind,
 * …) 을 부르고, 그때 kind 가 이미 OH 라 오버홀 작업이 체크된다 — 손으로 고른 폼과 같다.
 *
 * ── 인수번호 자동 불러오기와 겹칠 때 ────────────────────────────────────
 * 불러오기(handleLookup)는 종류 · 엑셀 전용 · 줄을 건드리지 않는다(고객사 · 모델명 · 참고용
 * 부품 목록만 채운다). 품명을 비어 있을 때 지어 줄 때만 종류를 읽는데, 그 종류가 이미 팝업의
 * 값이다 — 사람이 종류를 먼저 고르고 [불러오기]를 누른 것과 같다.
 * ============================================================================
 */

/**
 * 폼이 들고 있는 줄 묶음 — 부품 · 작업 내역 · 작업 내역의 「손댔는가」 · 고른 수리 작업. 엑셀
 * 전용을 켤 때 비우고 끌 때 돌려놓는 그 묶음(QuoteEditForm 의 ExcelOnlyLines)과 같은 모양이다.
 * 줄 한 칸의 모양(`Item` · `Row`)은 폼이 정한다.
 */
export type QuoteFormLines<Item, Row> = {
  items: Item[];
  scopeLines: Record<QuoteWorkScopeSection, Row[]>;
  scopeTouched: Record<QuoteWorkScopeSection, boolean>;
  taskQuantities: RepairTaskQuantities;
};

/** 양식 하나의 작업 내역 기본값에서 여기서 쓰는 것만(storage/quote-template.ts 의 QuoteWorkScopeSectionView). */
export type QuoteTemplateScopeDefaults = Partial<Record<QuoteWorkScopeSection, { items: readonly string[] }>>;

/**
 * 종류 · 장비 종류를 고를 때 **양식의 기본 목록**으로 채우는 묶음. 「2) 수리 작업」은 양식이
 * 아니라 **고른 수리 작업**이 채운다(QuoteEditForm 의 fillRepairScopeFrom).
 */
export const TEMPLATE_FILLED_SCOPE_SECTIONS: readonly QuoteWorkScopeSection[] = ["INVESTIGATION", "POWER_TEST"];

/**
 * 조사 · 통전 칸을 그 양식의 기본 목록으로 채운 줄 묶음. 🔴 **손댄 묶음은 건드리지 않는다** —
 * 종류를 바꿀 때마다 덮으면 적어 둔 문장이 소리 없이 사라진다(QuoteEditForm 의 scopeTouched).
 *
 * 폼의 fillScopeFromTemplate(종류 · 장비 select 의 onChange)과 새 견적서의 처음 상태
 * (startNewQuoteLines)가 **이 함수 하나로** 채운다 — 두 벌이면 언젠가 한쪽만 바뀌고, 그때 팝업으로
 * 연 폼과 손으로 고른 폼이 다른 목록을 들고 있게 된다.
 */
export function scopeLinesFilledFromTemplate<Row>(
  prev: Record<QuoteWorkScopeSection, Row[]>,
  touched: Record<QuoteWorkScopeSection, boolean>,
  defaults: QuoteTemplateScopeDefaults,
  toRows: (texts: readonly string[]) => Row[]
): Record<QuoteWorkScopeSection, Row[]> {
  const next = { ...prev };
  for (const section of TEMPLATE_FILLED_SCOPE_SECTIONS) {
    if (touched[section]) continue;
    next[section] = toRows(defaults[section]?.items ?? []);
  }
  return next;
}

/** 빈 폼이 여는 견적서 종류 — 지금까지 [새 견적서]가 열던 그대로다. */
export const BLANK_NEW_QUOTE_KIND: QuoteKind = "DOMESTIC";

/** 새 견적서 폼의 처음 상태. 폼의 상태 칸마다 처음 값이 된다. */
export type NewQuoteStartState<Item, Row> = {
  kind: QuoteKind;
  isExcelOnly: boolean;
  lines: QuoteFormLines<Item, Row>;
  /** 엑셀 전용을 켤 때 넣어 둔 줄 — 폼의 excelOnlyStash 처음 값. 켜지 않았으면 null. */
  excelOnlyStash: QuoteFormLines<Item, Row> | null;
};

/**
 * 새 견적서의 처음 상태 — 빈 폼(`blank`)을 연 뒤 사람이 ① 종류 select 를 `start.kind` 로 고르고
 * ② `start.excelOnly` 면 엑셀 전용 스위치를 켠 것과 **같은 상태**다(머리말).
 *
 * 두 값이 없으면(`kind` null · 내자, 엑셀 전용 아님) `blank` 를 **그대로** 돌려준다 — 지금까지의
 * 빈 폼과 한 글자도 다르지 않다.
 */
export function startNewQuoteLines<
  Item extends { partNameText: string; unitPrice: string },
  Row extends { text: string },
>(params: {
  start: NewQuoteStart;
  /** 빈 폼의 줄 — 폼이 두 값 없이 열 때 들고 시작하는 그대로. */
  blank: QuoteFormLines<Item, Row>;
  /** 엑셀 전용을 켤 때 바꿔 넣는 빈 묶음(QuoteEditForm 의 clearedExcelOnlyLines). */
  cleared: QuoteFormLines<Item, Row>;
  /** 양식 넷의 작업 내역 기본값(`장비:종류` 키). 못 읽은 양식은 없을 수 있다. */
  workScopeDefaults: Partial<Record<string, QuoteTemplateScopeDefaults>>;
  toRows: (texts: readonly string[]) => Row[];
}): NewQuoteStartState<Item, Row> {
  const kind = params.start.kind ?? BLANK_NEW_QUOTE_KIND;
  let lines = params.blank;

  // ① 견적서 종류 select. 빈 폼은 내자로 열리므로 내자면 select 가 바뀌지 않는다(onChange 가
  //    돌지 않는다). 새 견적서는 장비 종류가 없어(laborKind null) 양식 키가
  //    quoteTemplateKey(null, kind) 이고, applyOverhaulRule 은 작업 목록을 못 찾아 아무 일도
  //    하지 않는다(머리말). 양식을 못 읽었으면 폼처럼 그대로 둔다.
  if (kind !== BLANK_NEW_QUOTE_KIND) {
    const defaults = params.workScopeDefaults[quoteTemplateKey(null, kind)];
    if (defaults) {
      lines = {
        ...lines,
        scopeLines: scopeLinesFilledFromTemplate(lines.scopeLines, lines.scopeTouched, defaults, params.toRows),
      };
    }
  }

  if (!params.start.excelOnly) return { kind, isExcelOnly: false, lines, excelOnlyStash: null };

  // ② 엑셀 전용 스위치 — 폼의 toggleExcelOnly 와 같은 판정. 줄이 있으면 폼은 먼저 묻는데, 그
  //    물음에 「비우고 켜기」를 고른 것으로 친다(머리말). 새 견적서는 장비 종류가 없어 고른 수리
  //    작업이 0건이다(폼의 selectedTasks 가 빈 목록).
  const plan = planExcelOnlyToggle({
    turnOn: true,
    confirmedClear: true,
    counts: countQuoteLinesForExcelOnly({
      items: lines.items,
      workScopeTexts: QUOTE_WORK_SCOPE_SECTIONS.flatMap((section) => lines.scopeLines[section].map((row) => row.text)),
      repairTaskCount: 0,
    }),
    current: lines,
    cleared: params.cleared,
    stash: null,
  });
  // confirmedClear 라 묻는 갈래(ASK_TO_CLEAR)는 오지 않는다. 혹시 오면 사람이 물음에 [취소]를
  // 누른 것과 같게 — 엑셀 전용이 아닌 채로 — 연다.
  if (plan.kind !== "APPLY") return { kind, isExcelOnly: false, lines, excelOnlyStash: null };
  return { kind, isExcelOnly: plan.isExcelOnly, lines: plan.lines ?? lines, excelOnlyStash: plan.stash };
}
