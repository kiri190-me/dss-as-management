"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import AmountInput from "@/components/common/AmountInput";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { generateClientUuid } from "@/lib/client-uuid";
import { stockOwnerLabelOrUnspecified } from "@/lib/domain/inventory-types";
import {
  QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE,
  canRenderQuoteDocument,
} from "@/lib/domain/quote-document-support";
import { quoteSupplyAmountOf, type QuoteItemKind } from "@/lib/domain/quote-list";
import { sumQuoteLaborCost } from "@/lib/domain/quote-labor-cost";
import {
  MAX_REPAIR_TASK_QUANTITY,
  MIN_REPAIR_TASK_QUANTITY,
  applyOverhaulQuantities,
  expandRepairTaskLines,
  repairTaskQuantityOf,
  restoreRepairTaskQuantities,
  selectedRepairTaskNames,
  uncheckRepairTaskForRemovedLine,
  setRepairTaskChecked,
  setRepairTaskQuantity,
  type RepairTaskQuantities,
} from "@/lib/domain/quote-repair-task-selection";
import { workflowKindLabels, type WorkflowKind } from "@/lib/domain/workflow-kind";
import type { RepairLaborKindRow } from "@/lib/db/queries/repair-labor";
import { isPriceUnset, toPriceFieldValue } from "@/lib/domain/quote-part-price";
import { buildQuoteSubject } from "@/lib/domain/quote-subject";
import {
  isInvestigationScopeEmptied,
  isRepairSectionDropped,
  isWorkScopeSectionSuppressed,
} from "@/lib/domain/quote-work-scope-suppression";
import {
  MAX_QUOTE_ITEMS,
  QUOTE_WORK_SCOPE_SECTIONS,
  quoteWorkScopeSectionLabels,
  QUOTE_KINDS,
  quoteKindLabels,
  type QuoteKind,
  type QuoteWorkScopeSection,
} from "@/lib/validation/quote-input";
import OverhaulBadge from "@/components/common/OverhaulBadge";
import QuotePrintView, { type QuoteWorkSections } from "@/components/quotes/QuotePrintView";
import {
  QuotePartSuggestionList,
  filterPartOptions,
  partPickPatch,
} from "@/components/quotes/quote-part-picker";
/* 조회 자체는 서버 것이지만 줄의 생김새는 여기서도 알아야 한다 — 형 선언만 가져오므로
   번들에는 아무것도 실리지 않는다(PartRequestSection 이 PartListRow 를 받는 것과 같다). */
import type { PartPickerPriceRow, PartPickerRow } from "@/lib/db/queries/inventory";
import type {
  QuoteTemplateHeader,
  QuoteWorkScopeSectionView,
} from "@/lib/storage/quote-template";
import { quoteTemplateKey } from "@/lib/domain/quote-template-variant";
import type { QuoteEditData, QuoteIntakeLookup } from "@/lib/db/queries/quotes";
import {
  createQuoteAction,
  lookupIntakeForQuoteAction,
  updateQuoteAction,
} from "@/lib/server/actions/quotes";
import QuoteAttachmentsSection, { useQuoteAttachments } from "@/components/quotes/QuoteAttachmentsSection";
import {
  ExcelOnlyClearLinesDialog,
  ExcelOnlySwitch,
  QuoteExcelAutofillNotice,
} from "@/components/quotes/QuoteAttachmentParts";
import { takeNewQuoteExcelHandoff } from "@/components/quotes/new-quote-excel-handoff";
import { createLatestQuoteExcelReader, type QuoteExcelReadFields } from "@/components/quotes/quote-excel-parse";
import {
  planQuoteExcelAutofill,
  quoteExcelAutofillNoticeLines,
  quoteExcelPlanFormValues,
  type QuoteExcelAutofillField,
  type QuoteExcelFieldChange,
  type QuoteExcelFormValues,
} from "@/components/quotes/quote-excel-autofill";
import { scopeLinesFilledFromTemplate, startNewQuoteLines } from "@/components/quotes/quote-new-start";
import {
  countQuoteLinesForExcelOnly,
  createdWithAttachmentFailuresText,
  planExcelOnlyToggle,
  quoteAttachmentUploadProgressText,
  type QuoteLineCounts,
} from "@/components/quotes/quote-attachment-files";
import type { QuoteAttachmentSlots } from "@/lib/db/queries/attachments";
import QuoteIssueButton, { QuoteIssueNoticeLines } from "@/components/quotes/QuoteIssueButton";
import { shouldReloadSlotsAfterIssue, type QuoteIssueRunOutcome } from "@/components/quotes/quote-issue-download";
import type { QuoteIssueNoticeLine } from "@/components/quotes/quote-issue-messages";
import QuoteFolderOpenButton, { QuoteFolderOpenNotice } from "@/components/quotes/QuoteFolderOpenButton";
import type { QuoteFolderOpenOutcome } from "@/components/quotes/quote-folder-open";

/**
 * ============================================================================
 * 견적서 작성·수정 폼 (4단계)
 * ============================================================================
 * 만들기와 고치기가 **같은 컴포넌트**다. 칸도 규칙도 같으므로 두 벌로 나누면
 * 한쪽만 고쳐지는 날이 오고, 그때 증상은 "새로 만들면 들어가는데 고치면 안
 * 들어가는 칸"이다(mutations/quotes.ts 의 toColumnValues 와 같은 판단).
 *
 * ── 인수번호로 불러온다 ─────────────────────────────────────────────────
 * 접수 건 하나로 고객사·모델명·L/N·S/N·신고증상이 따라온다. **덮어쓰기는
 * 사람이 누른 뒤에만** 일어난다 — 타이핑하는 동안 자동으로 채우면, 손으로
 * 고쳐 둔 값이 글자를 하나 더 칠 때마다 되돌아간다.
 *
 * 불러온 값은 **그대로 저장된다**(스냅샷). 나중에 접수 건의 S/N 이 정정돼도 이미
 * 보낸 견적서는 바뀌지 않는다 — schema/quotes.ts 의 '스냅샷이다' 항목.
 *
 * ── 사용한 부품은 참고일 뿐이다 ─────────────────────────────────────────
 * 그 접수 건에 실제로 **출고된** 부품을 옆에 늘어놓기만 하고, 부품 줄에 자동으로
 * 넣지 않는다. 재고에서 나간 것과 고객사에 청구하는 것이 늘 같지는 않다(무상
 * 교체, 내부 소모, 반품). 담을지는 사람이 정한다.
 *
 * 담으면 **그 부품에 정해 둔 단가가 따라온다**(재고 관리 › 부품 상세의 단가).
 * 🔴 소유구분과 무관하다 — 부품 하나에 단가 하나다(2026-09-17 사용자 정정).
 * 목록이 (부품, 소유구분) 짝으로 나오는 것은 단가 때문이 아니라 **어느
 * 소유구분에서 나갔는지를 보여 주기 위해서**다(queries/quotes.ts 의 같은 판단).
 * 정해 두지 않은 부품은 **빈칸**으로 들어온다: 0 으로 채우면 정하지 않은 것을
 * 0원으로 청구하게 된다(schema/part-unit-prices.ts 의 그 구분).
 *
 * ── 부품 줄 수에 상한이 없다 ────────────────────────────────────────────
 * 예전에는 다섯 줄이 넘으면 파일에서 한 줄로 합산돼 나갔고, 화면이 그 사실을
 * 미리 알려 주었다. 이제 양식이 담을 만큼 줄을 늘리므로(xlsx/quote-sheet-layout.ts)
 * 합산도 경고도 없다.
 *
 * ── 합계는 미리 보여 주기만 한다 ────────────────────────────────────────
 * 여기서 셈한 값을 저장하지 않는다. 저장되는 것은 수량과 단가뿐이고, 합계는
 * 조회가 다시 셈하며 실제 문서에서는 양식의 수식이 계산한다. 세 곳이 각자
 * 저장하면 어긋날 자리가 생긴다(schema/quotes.ts 의 '합계 금액을 담지 않는다').
 *
 * ── 견적서 파일 · 엑셀 전용 (2026-09-15 Q3) ─────────────────────────────
 * 결재 PDF · 수기 엑셀 두 칸은 QuoteAttachmentsSection 이 그리고, 상태는 이 폼이 부르는
 * 훅(useQuoteAttachments)에 있다 — 미리보기를 열어도 골라 둔 파일이 살아남게. 새 견적서는
 * [저장]이 견적서를 만든 **직후** 파일을 올리고, 하나라도 못 올리면 목록으로 넘기지 않는다.
 * 엑셀 전용을 켜면 부품 · 작업 구역을 접고 공급가액을 손으로 받는다. 줄이 있으면 서버가
 * 저장을 거절하므로 켤 때 비울지 묻고, 비운 줄은 저장 전에 끄면 돌아온다.
 *
 * ── 수기 견적서 엑셀로 칸 채우기 (견적서 ①b) ───────────────────────────
 * 엑셀 전용 장에서 「수기 견적서 엑셀」 칸에 파일을 고르는 순간(훅의 onExcelPicked) 읽기 통로로
 * 그 엑셀을 읽는다(quote-excel-parse.ts). 🔴 올리기와 따로 간다 — 읽기가 실패해도 파일은 그대로
 * 붙는다. 채우는 규칙은 quote-excel-autofill.ts 한 곳이다: **빈 칸만 채우고**, 이미 적힌 칸이
 * 엑셀과 다르면 덮지 않고 「엑셀과 다른 칸」 목록 · [엑셀 값으로 바꾸기]를 칸 곁에 보인다. 종류도
 * 제안만 하고, 바꿀 때는 종류 select 와 같은 함수(changeKind)를 탄다. 엑셀 전용이 아니면 읽지
 * 않는다. 두 번 고르면 마지막에 고른 파일의 결과만 쓴다(createLatestQuoteExcelReader).
 *
 * ── [새 견적서] 팝업이 건네준 엑셀 (견적서 ⑤b) ──────────────────────────
 * 팝업에서 엑셀을 올리고 어떤 견적서인지 고른 뒤 [만들기]를 누르면, 파일이 작은 상자로 건너온다
 * (new-quote-excel-handoff.ts). 첫 그림에서 꺼내 **사람이 칸에 고른 것과 같은 길**(pickFile)에
 * 태우고, 팝업이 고른 시트 차례를 첫 읽기에 실어 준다. 🔴 상자가 비어 있으면(새로고침 · 주소
 * 직접 입력 · 뒤로가기) 지금까지와 똑같다 — 칸에 직접 붙이면 된다.
 * ============================================================================
 */

const VAT_RATE = 0.1;
const AMOUNT_FORMAT = new Intl.NumberFormat("ko-KR");

/**
 * 서버 액션 자체가 끊긴 경우. 액션이 돌려주는 오류(권한·검증·충돌)는 각자
 * 제 문장을 갖고 있고, 이 문구는 **대답이 아예 오지 않은** 자리에만 쓴다.
 */
const SAVE_FAILED_MESSAGE =
  "저장 요청이 끝나지 못했습니다. 잠시 후 다시 시도해 주세요. 계속 그러면 화면을 새로고침해 주세요.";

/**
 * 「작업 내역」에서 문서에 나가지 않는 칸 자리에 두는 안내. 「통전작업 제외」를 켰을
 * 때의 「3) 통전작업」, 제너레이터에서 수리 작업을 하나도 고르지 않았을 때의
 * 「2) 수리 작업」, 「조사작업 제외」를 켰을 때의 「1) 조사작업」 셋이다
 * (domain/quote-work-scope-suppression.ts). 줄은 감췄을 뿐이라 되돌리면 그대로 다시
 * 보인다 — 그 사실도 함께 말한다.
 */
const WORK_SCOPE_SUPPRESSED_NOTICE =
  "통전작업 제외 — 이 구역은 견적서에 나가지 않습니다. 체크를 풀면 적어 둔 줄이 다시 보입니다.";
const REPAIR_SCOPE_DROPPED_NOTICE =
  "수리 작업을 하나도 고르지 않아 이 구역은 견적서에 나가지 않습니다. 위 목록에서 작업을 고르면 다시 보입니다.";
/**
 * 「조사작업 제외」를 켰을 때 「1) 조사작업」 칸 자리의 안내. 🔴 **기본 작업비 중 조사작업
 * 몫(조사 공수시간 × 시간당 작업비)이 작업비 계산에서 빠진다**는 것을 함께 말한다(2026-09-15
 * 사용자 결정 — domain/quote-labor-cost.ts). 문서에서 구역만 빠지는 줄 알고 켜면, 계산한
 * 작업비가 그만큼 줄어든 것을 모른 채 적용한다.
 *
 * 🔴 2026-09-16 에 셈이 바뀌었다 — 조사 몫은 「기본 작업비 − 통전작업 몫」이라는 **나머지가
 * 아니라** 제 공수시간으로 정해지는 몫이다. 옛 문구를 남기면 사람이 통전 시간을 고쳤을 때
 * 조사 몫이 따라 움직이는 줄로 읽는다.
 *
 * 예전에는 되돌리는 체크 상자가 없어 조사 칸을 감추지 않고 칸 안에 「줄을 모두 지워 빠진다」
 * 안내를 두었다. 이제 체크를 풀면 되돌아오므로 통전작업처럼 감춘다.
 */
const INVESTIGATION_EXCLUDED_NOTICE =
  "조사작업 제외 — 이 구역은 견적서에 나가지 않고, 기본 작업비 중 조사작업 몫(조사 공수시간 × 시간당 작업비)이 빠집니다. 체크를 풀면 적어 둔 줄이 다시 보이고, 줄이 없었으면 양식 기본 목록으로 채워집니다.";
/** 감춘 칸마다의 안내. `Record` 라 묶음이 하나 더 생기면 컴파일러가 여기를 짚는다. */
const SUPPRESSED_SCOPE_NOTICES: Record<QuoteWorkScopeSection, string> = {
  INVESTIGATION: INVESTIGATION_EXCLUDED_NOTICE,
  REPAIR: REPAIR_SCOPE_DROPPED_NOTICE,
  POWER_TEST: WORK_SCOPE_SUPPRESSED_NOTICE,
};

type ItemRow = {
  key: string;
  partId: string | null;
  /** `2) OH 부품 비용` 칸으로 갈 줄인가. OH 견적서에만 그 칸이 있다. */
  isOverhaulPart: boolean;
  /**
   * 품목 줄인가 **설명 줄**인가 — 케이블 견적서의 품목 표에는 금액 없는 줄이 낀다
   * (`* 20kW RFG 부속케이블 Parts 3종`, schema/quotes.ts 의 quoteItemKindEnum).
   *
   * 🔴 설명 줄에는 수량 · 단가 칸을 **그리지 않는다.** 값이 남은 채로 저장되면 DB 가
   * 거절한다(CHECK quote_items_amounts_item_line_only) — 화면이 먼저 막는 방법은 칸을
   * 안 두는 것이다(잠가 두면 이미 적힌 값이 그대로 실려 간다).
   */
  lineKind: QuoteItemKind;
  partNameText: string;
  /**
   * 규격 — **케이블 견적서 양식의 셋째 칸**(quote_items.part_spec_text). 내자 · OH
   * 양식에는 이 칸이 없어 그 두 종류에서는 그리지도 보내지도 않는다.
   */
  partSpecText: string;
  quantity: string;
  unitPrice: string;
  /**
   * 위 「출고된 부품」 목록의 어느 줄에서 담아 온 것인가. 손으로 적은 줄과
   * 저장돼 있던 줄은 null 이다.
   *
   * 이것이 있어야 **같은 것을 두 번 담지 않는다** — 일괄 담기가 이미 담은 것을
   * 건너뛰고, 목록 쪽도 담긴 줄을 「담김」으로 보여 줄 수 있다. 저장되지 않는
   * 화면 전용 값이다.
   */
  sourceKey: string | null;
};

function emptyItem(): ItemRow {
  return {
    key: generateClientUuid(),
    partId: null,
    isOverhaulPart: false,
    lineKind: "ITEM",
    partNameText: "",
    partSpecText: "",
    quantity: "1",
    unitPrice: "",
    sourceKey: null,
  };
}

/**
 * 빈 설명 줄(케이블 견적서). **수량 · 단가를 비운 채 시작한다** — 이 줄은 그 두
 * 값을 갖지 못한다(CHECK quote_items_amounts_item_line_only). 품목 줄이 `quantity: "1"`
 * 로 시작하는 것과 일부러 다르다.
 */
function emptyNoteItem(): ItemRow {
  return {
    key: generateClientUuid(),
    partId: null,
    isOverhaulPart: false,
    lineKind: "NOTE",
    partNameText: "",
    partSpecText: "",
    quantity: "",
    unitPrice: "",
    sourceKey: null,
  };
}

/**
 * ============================================================================
 * 사람이 보는 번호는 **종류마다 따로 센다** (2026-09-17 사용자 요청)
 * ============================================================================
 * 품목 표는 품목 줄과 설명 줄이 **한 목록에 섞여** 있고 그 차례가 곧 문서의 차례다.
 * 그래서 목록의 index 를 그대로 자리표시 · 이름표에 쓰면, 설명 줄이 하나 끼는 순간
 * 그 밑의 품목이 죄 한 칸씩 밀려 보인다 — 손도 안 댄 「1번째 품목 품명」이 「2번째
 * 품목 품명」이 된다(사용자가 본 그 증상).
 *
 * 그래서 품목은 품목끼리, 설명은 설명끼리 센다. 줄마다 미리 한 번 세어 두고 쓴다 —
 * 그리면서 앞을 다시 세면(줄마다 `slice` + `filter`) 줄이 늘수록 느려진다.
 *
 * 🔴 **오류 자리는 목록 index 그대로다**(`fieldErrors["items.<index>.…"]`) — 서버가
 *    돌려주는 자리 번호가 그것이다. 여기서 바뀌는 것은 **사람이 보는 번호뿐**이다.
 * 🔴 내자 · OH 에는 설명 줄이 없다(케이블 전용) — 종류별로 세어도 보이는 번호는
 *    지금과 한 글자도 다르지 않다.
 * ============================================================================
 */
function lineOrdinalsOf(rows: readonly ItemRow[]): number[] {
  let itemSoFar = 0;
  let noteSoFar = 0;
  return rows.map((row) => {
    if (row.lineKind === "NOTE") {
      noteSoFar += 1;
      return noteSoFar;
    }
    itemSoFar += 1;
    return itemSoFar;
  });
}

/**
 * 출고 부품 목록의 한 줄을 가리키는 키. **부품 하나가 아니라 (부품, 소유구분)**
 * 이다 — 같은 부품이 DSS 것과 교산 것으로 따로 나갔으면 목록에 두 줄로 보이고,
 * 그 둘은 따로 담기고 따로 세어야 한다(queries/quotes.ts 의 같은 판단).
 * 단가가 달라서가 아니다 — 단가는 부품마다 하나다(2026-09-17 사용자 정정).
 */
function usedPartKey(part: QuoteIntakeLookup["usedParts"][number]): string {
  return `issued:${part.partId}|${part.owner ?? ""}`;
}

/**
 * O/H 템플릿 목록의 한 줄을 가리키는 키. 출고 줄과 **접두사로 갈라 둔다** —
 * 같은 부품이 양쪽에 다 있을 수 있고, 그 둘은 단가가 다른 별개의 줄이다.
 * 차례(index)로 세는 것은 템플릿 줄에 재고 연결이 없을 수 있어(part_id 가 NULL)
 * 부품 id 만으로는 줄을 가릴 수 없기 때문이다.
 */
function ohTemplatePartKey(index: number): string {
  return `ohtpl:${index}`;
}

/**
 * 출고 부품 한 줄 → 견적서 부품 줄.
 *
 * 단가는 **부품 상세에 적어 둔 일반 단가**다. 실제로 나간 물건이라 O/H 단가가
 * 아니라 이 값으로 청구한다(domain/quote-part-price.ts 의 '출처가 정한다').
 *
 * `isOverhaulPart` 는 false — 양식의 `1) 부품 비용` 칸으로 간다.
 */
function usedPartToItem(part: QuoteIntakeLookup["usedParts"][number]): ItemRow {
  return {
    key: generateClientUuid(),
    partId: part.partId,
    isOverhaulPart: false,
    lineKind: "ITEM",
    partNameText: part.partSpec ? `${part.partName} (${part.partSpec})` : part.partName,
    // 규격 칸은 케이블 견적서에만 있다. 여기(출고 부품)는 내자 · OH 의 길이라
    // 지금까지처럼 품명 뒤에 괄호로 붙인 그대로 둔다 — 문구를 바꾸지 않는다.
    partSpecText: "",
    quantity: String(part.quantity),
    unitPrice: toPriceFieldValue(part.unitPrice),
    sourceKey: usedPartKey(part),
  };
}

/**
 * O/H 템플릿 한 줄 → 견적서 부품 줄.
 *
 * 단가는 **템플릿 쪽에 적어 둔 O/H 단가**다. 아직 출고되지 않은 "쓸 예정인"
 * 부품이라 일반 단가와 다른 값으로 청구한다.
 *
 * 🔴 `isOverhaulPart` 가 **true** 인 것이 핵심이다 — O/H 견적서 양식에는 부품
 * 칸이 둘이고(`1) 부품 비용` 27~31행 · `2) OH 부품 비용` 34~46행), 템플릿에서
 * 온 줄은 뒤쪽으로 가야 한다. 템플릿 담을 수 있는 부품이 13종으로 막혀 있는 것도
 * 그 칸이 13줄이기 때문이다(validation/oh-part-template-input.ts).
 *
 * 작업비는 이 줄에 붙지 않는다. 작업비는 부품이 아니라 **수리 작업**에 붙고,
 * 아래 「수리 작업 목록」에서 고른 것들로 따로 셈한다(2026-08-31 사용자 정정).
 */
function ohTemplatePartToItem(
  part: QuoteIntakeLookup["ohTemplateParts"][number],
  index: number
): ItemRow {
  return {
    key: generateClientUuid(),
    partId: part.partId,
    isOverhaulPart: true,
    lineKind: "ITEM",
    partNameText: part.partNameText,
    partSpecText: "",
    quantity: String(part.quantity),
    unitPrice: toPriceFieldValue(part.overhaulUnitPrice),
    sourceKey: ohTemplatePartKey(index),
  };
}

/** 작업 내역 한 줄. `key` 는 화면에서만 쓰는 값이고 저장되지 않는다. */
type ScopeRow = { key: string; text: string };

function toScopeRows(texts: readonly string[]): ScopeRow[] {
  return texts.map((text) => ({ key: generateClientUuid(), text }));
}

/**
 * 그 묶음에서 **문서에 적힐 줄**. 빈 줄과 앞뒤 공백을 버린다 — 저장할 때 그렇게 걸러지므로
 * (validation/quote-input.ts 의 normalizeWorkScopeLines). 하나도 없으면 문서에는 양식의 기본
 * 목록이 나간다(previewWorkSections). 「조사작업 제외」를 풀 때 다시 채울지도 이것으로 본다 —
 * 화면과 문서가 「비었다」를 같은 뜻으로 읽게.
 */
function writtenScopeTexts(rows: readonly ScopeRow[]): string[] {
  return rows.map((row) => row.text.trim()).filter((text) => text !== "");
}

/**
 * 미리보기에 그릴 작업 내역 세 묶음 — **지금 화면에 적혀 있는 값**으로 만든다.
 *
 * 🔴 저장된 견적서를 그릴 때와 **같은 답이 나와야 한다**
 * (storage/quote-template.ts 의 readQuoteWorkSections). 세 가지가 같아야 한다:
 *
 *   · **빈 묶음은 양식의 기본 목록**으로 그린다. 파일도 정확히 그 규칙으로
 *     나가기 때문이다(xlsx/quote-sheet-layout.ts 의 '빈 묶음은 양식 그대로
 *     둔다'). 여기서 빈 채로 그리면 화면에는 아무것도 없는데 파일에는 표준
 *     통전검사 7줄이 적힌, 서로 다른 문서가 된다.
 *   · **빈 줄과 앞뒤 공백은 버린다.** 저장할 때 그렇게 걸러지므로
 *     (validation/quote-input.ts 의 normalizeWorkScopeLines), 여기서 남겨 두면
 *     저장 전 미리보기와 저장 뒤 미리보기의 줄 수가 달라진다.
 *   · **머리글은 그 양식에 적힌 그대로**다 — 매쳐는 `조사작업`, 제너레이터 O/H
 *     의 ② 는 `OH 및 수리 작업` 이다. 그래서 사람이 장비 종류·견적서 종류를
 *     바꾸면 미리보기의 머리글도 따라 바뀐다.
 */
function previewWorkSections(
  templateDefaults: Record<QuoteWorkScopeSection, QuoteWorkScopeSectionView> | undefined,
  scopeLines: Record<QuoteWorkScopeSection, readonly ScopeRow[]>
): QuoteWorkSections {
  const sections = {} as Record<QuoteWorkScopeSection, { label: string; items: string[] }>;
  for (const section of QUOTE_WORK_SCOPE_SECTIONS) {
    const written = writtenScopeTexts(scopeLines[section]);
    const fromTemplate = templateDefaults?.[section];
    sections[section] = {
      // 양식을 아예 못 읽었을 때만 화면 표기로 물러선다 — 머리글 자리가 빈 채로
      // 그려지는 것보다는 낫다.
      label: fromTemplate?.label ?? quoteWorkScopeSectionLabels[section],
      items: written.length > 0 ? written : (fromTemplate?.items ?? []),
    };
  }
  return sections;
}

function formatAmount(value: number): string {
  return `₩${AMOUNT_FORMAT.format(Math.round(value))}`;
}

/** 금액을 알 수 없으면(엑셀 전용인데 공급가액이 비었다) 「—」 — 0 으로 접지 않는다. */
function formatMaybeAmount(value: number | null): string {
  return value === null ? "—" : formatAmount(value);
}

/**
 * 엑셀 전용을 켤 때 비우고, 끌 때 돌려놓는 줄 묶음 — 서버가 엑셀 전용 장에서 거절하는
 * 셋(부품 · 작업 내역 · 고른 수리 작업)과 작업 내역의 「손댔는가」 표시다
 * (quote-attachment-files.ts 의 planExcelOnlyToggle).
 */
type ExcelOnlyLines = {
  items: ItemRow[];
  scopeLines: Record<QuoteWorkScopeSection, ScopeRow[]>;
  scopeTouched: Record<QuoteWorkScopeSection, boolean>;
  taskQuantities: RepairTaskQuantities;
};

/**
 * 「수기 견적서 엑셀」로 칸 채우기의 지금 상태(견적서 ①b). 마지막에 고른 파일 하나의 것이다.
 *  · reading — 읽는 중(칸 곁에 「엑셀을 읽는 중…」).
 *  · failed — 읽지 못했다. 파일은 그대로 붙어 있다(읽기는 붙이기와 따로 간다).
 *  · read — 읽었다. `fields` 는 엑셀 값 그대로 들고 있다가, 그릴 때마다 지금 폼 값과 견줘
 *    「엑셀과 다른 칸」을 뽑는다 — 바꾼 칸은 저절로 목록에서 빠진다. `filled` 는 결과가 온 순간
 *    채운 칸, `readCount` 는 엑셀에 값이 있던 칸의 수(알림 문장이 쓴다).
 */
type ExcelAutofillState =
  | { status: "reading" }
  | { status: "failed"; reason: string; code: string | null }
  | {
      status: "read";
      fields: QuoteExcelReadFields;
      filled: QuoteExcelAutofillField[];
      readCount: number;
      warnings: string[];
    };

/**
 * 비운 묶음. 작업 내역은 **손댄 것으로** 둔다 — 아니면 양식 기본값이 빈 칸을 몰래 다시
 * 채워, 접힌 구역에 줄이 생기고 저장이 거절된다.
 */
function clearedExcelOnlyLines(): ExcelOnlyLines {
  return {
    items: [emptyItem()],
    scopeLines: { INVESTIGATION: [], REPAIR: [], POWER_TEST: [] },
    scopeTouched: { INVESTIGATION: true, REPAIR: true, POWER_TEST: true },
    taskQuantities: restoreRepairTaskQuantities([]),
  };
}

/**
 * 두 값 없이 연 새 견적서의 줄 묶음 — 지금까지 새 견적서가 들고 시작한 그대로다(부품 빈 줄
 * 하나 · 작업 내역 없음 · 손대지 않음 · 고른 작업 없음). [새 견적서] 팝업의 처음 값은 이 위에서
 * 사람이 고른 것처럼 돈다(quote-new-start.ts 의 startNewQuoteLines).
 */
function blankNewQuoteLines(): ExcelOnlyLines {
  return {
    items: [emptyItem()],
    scopeLines: { INVESTIGATION: [], REPAIR: [], POWER_TEST: [] },
    scopeTouched: { INVESTIGATION: false, REPAIR: false, POWER_TEST: false },
    taskQuantities: restoreRepairTaskQuantities([]),
  };
}

/**
 * 셈한 금액을 numeric(15,2) 칸으로 보낼 글자로.
 *
 * 소수 둘째 자리에서 끊는 것은 **부동소수점의 꼬리를 그대로 보내면 검증에
 * 걸려 저장 자체가 막히기** 때문이다(validation/quote-input.ts 의 AMOUNT_PATTERN).
 */
function toAmountText(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** 오늘(한국 표준시). 새 견적서의 발행일자 기본값이다. */
function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export default function QuoteEditForm({
  quote,
  defaultQuoteDate,
  repairLabor,
  partOptions,
  partPrices,
  cableMaxLines,
  printHeaders,
  workScopeDefaults,
  initialIntakeNumber = null,
  initialKind = null,
  initialExcelOnly = false,
  returnHref = null,
  attachmentSlots = null,
}: {
  /** 수정이면 기존 값, 새로 만들기면 null. */
  quote: QuoteEditData | null;
  /** 서버가 정한 오늘 날짜. 클라이언트에서 만들면 hydration 이 어긋난다. */
  defaultQuoteDate: string;
  /**
   * 장비 종류별 수리 작업 목록과 단가(`수리 작업 비용` 화면이 정하는 값).
   * 셋 다 온다 — 사람이 장비 종류를 골라 그 목록에서 체크한다.
   */
  repairLabor: RepairLaborKindRow[];
  /**
   * 부품 마스터 — 품명 칸에서 찾아 고르는 데 쓴다(queries/inventory.ts 의 getPartPickerList).
   *
   * 🔴 **재고 · 소유구분 · 내부 비고가 없는 가벼운 목록이다.** 그 값들은 재고 담당의
   * 정보라 견적서 화면으로 내보내지 않는다 — 그래서 재고를 조인하는 getPartList 대신
   * 형제 조회를 따로 두었다(그 함수의 머리말).
   *
   * 통째로 한 번 받아 **브라우저에서 거른다** — 부품 마스터가 백 줄 안쪽이라 글자마다
   * 서버를 부를 까닭이 없다(quote-part-picker.tsx 의 filterPartOptions).
   */
  partOptions: PartPickerRow[];
  /**
   * 단가가 적혀 있는 부품들(queries/inventory.ts 의 getPartPickerUnitPrices) — 부품을
   * 고르면 **단가 칸도 함께 채우는** 데 쓴다.
   *
   * 🔴 부품 목록과 **따로** 오는 까닭: 단가가 적힌 부품은 통틀어 열몇이고(부품은 일흔몇),
   * 그 열몇 줄만 실으면 된다. 고를 때마다 서버를 다녀오지 않는 것은 부품 목록과 같은
   * 판단이다 — 늦게 온 응답이 사람이 그새 적은 금액을 덮는 일이 없다.
   *
   * 채우는 규칙(덮지 않는다 · null 은 빈칸 · O/H 는 O/H 단가로만)은 고르개에 있다
   * (quote-part-picker.tsx 의 partPickUnitPrice).
   */
  partPrices: PartPickerPriceRow[];
  /**
   * 케이블 견적서 한 장에 담을 수 있는 줄 수 — **품목 줄 + 설명 줄을 합쳐서**다
   * (xlsx/cable-quote-template.ts 의 `CABLE_QUOTE_MAX_LINES`). 넘치면 생성기가
   * 문서를 만들지 않고 던지므로, 화면이 **줄을 더하는 자리에서 미리 막는다** —
   * 열 줄을 넣고 저장한 뒤 [견적서 받기]에서야 실패하면 늦다.
   *
   * 🔴 **숫자를 여기에 다시 적지 않고 서버에서 받아 온다.** 그 상수는 채우개
   * 파일에 있고, 그 파일은 `node:fs`·`node:zlib` 를 끌고 와 클라이언트 번들에
   * 들어올 수 없다(components/repair-cases/report/ServiceReportTabs.tsx 의 같은
   * 항목). 그래서 **서버 컴포넌트인 페이지가 읽어 넘긴다** — 두 벌이 되면 양식이
   * 바뀌는 날 한쪽만 고쳐진다.
   */
  cableMaxLines: number;
  /**
   * 양식 **넷**의 회사 정보·기본 문구·계좌(장비 종류 × 견적서 종류).
   *
   * 넷을 다 들고 있다가 사람이 종류를 바꾸는 순간 그에 맞는 것으로 갈아 끼운다 —
   * 서버에 다시 묻지 않으니 기다리는 시간이 없다. 못 읽은 양식은 칸이 전부
   * null 이고, 그래도 미리보기는 뜬다.
   */
  printHeaders: Record<string, QuoteTemplateHeader>;
  /**
   * 양식 넷의 작업 내역 기본값(조사/수리/통전) — **머리글과 줄 목록**.
   *
   * 줄 목록은 새 견적서를 열 때 조사·통전 칸을 채우는 데 쓰고, 머리글은
   * 미리보기가 쓴다: 양식마다 머리글이 달라서(매쳐 `조사작업`, 제너레이터
   * `인수 조사`), 없으면 매쳐 견적서에 제너레이터 문구가 붙는다.
   *
   * 양식을 못 읽으면 줄 목록만 빈 배열이고 머리글은 그대로 온다.
   */
  workScopeDefaults: Record<string, Record<QuoteWorkScopeSection, QuoteWorkScopeSectionView>>;
  /**
   * 수리 건의 「견적서」 탭에서 들어왔을 때 그 건의 인수번호. 없으면 null 이고,
   * 그때 이 폼은 지금까지와 완전히 같다.
   *
   * 🔴 **이 값 하나만 받는다.** 고객사·모델명·L/N·S/N 을 미리 채워 받지 않는
   * 까닭은, 그러면 폼을 채우는 길이 둘이 되기 때문이다 — 아래 useEffect 가
   * 이 번호로 **기존 「인수번호로 불러오기」를 그대로 눌러 준다**. 채우는 규칙이
   * 한 곳(lookupIntakeForQuoteAction)에만 남는다.
   */
  initialIntakeNumber?: string | null;
  /**
   * 목록의 [새 견적서] 팝업에서 고른 견적서 종류(견적서 ⑤ — domain/quote-new-link.ts 의
   * parseNewQuoteStart). null 이면 지금까지처럼 내자로 연다. 새 견적서에만 쓴다.
   *
   * 🔴 처음 값만 바꾸지 않는다 — 빈 폼에서 사람이 종류 select 를 고른 것과 **같은 상태**로
   * 연다(아래 newQuoteStart · quote-new-start.ts). 폼에서는 여전히 바꿀 수 있다.
   */
  initialKind?: QuoteKind | null;
  /**
   * 팝업에서 엑셀 전용을 골랐는가(견적서 ⑤). 참이면 사람이 엑셀 전용 스위치를 켠 것과 같은
   * 상태로 연다 — 저장 전에 끄면 그 종류의 폼이 돌아온다. 새 견적서에만 쓴다.
   */
  initialExcelOnly?: boolean;
  /**
   * 저장·취소 뒤에 돌아갈 곳. 수리 건에서 들어왔으면 그 건의 「견적서」 탭이다.
   * null 이면 지금까지와 같이 `/quotes/{새 id}` 와 `/quotes` 로 간다.
   *
   * 주소는 **서버가 만들어** 넘긴다(domain/quote-new-link.ts) — 링크가 실어 온
   * 글자를 그대로 밀어 넣으면 남이 만든 링크가 사람을 바깥으로 보낼 수 있다.
   */
  returnHref?: string | null;
  /**
   * 결재 PDF · 수기 엑셀 두 칸에 지금 붙어 있는 파일(queries/attachments.ts 의
   * listQuoteAttachmentSlots). 수정 화면이 읽어 넘기고, 새 견적서는 null 이다.
   */
  attachmentSlots?: QuoteAttachmentSlots | null;
}) {
  const router = useRouter();

  /**
   * [새 견적서] 팝업에서 고른 처음 값(initialKind · initialExcelOnly)으로 연 새 견적서의 처음
   * 상태 — 한 번만 셈한다(견적서 ⑤).
   *
   * 🔴 **처음 값만 바꾸지 않는다.** 빈 폼을 연 뒤 사람이 ① 견적서 종류 select 를 고르고 ② 엑셀
   * 전용 스위치를 켠 것과 **같은 상태**다 — 종류를 고르면 조사 · 통전 칸에 그 양식의 기본 목록이
   * 따라오고, 엑셀 전용을 켜면 줄을 넣어 두고 비운다. 그 따라오는 일을 아래 onChange 들이 쓰는
   * 그 함수들로 돌린다(quote-new-start.ts 머리말). 두 값이 없으면 지금까지의 빈 폼 그대로다.
   *
   * 고치기(quote 가 있다)에는 null 이다 — 저장된 값이 곧 처음 값이다.
   */
  const [newQuoteStart] = useState(() =>
    quote === null
      ? startNewQuoteLines({
          start: { kind: initialKind, excelOnly: initialExcelOnly },
          blank: blankNewQuoteLines(),
          cleared: clearedExcelOnlyLines(),
          workScopeDefaults,
          toRows: toScopeRows,
        })
      : null
  );

  const [quoteNumber, setQuoteNumber] = useState(quote?.quoteNumber ?? "");
  const [kind, setKind] = useState<QuoteKind>(quote?.kind ?? newQuoteStart?.kind ?? "DOMESTIC");
  const [quoteDate, setQuoteDate] = useState(quote?.quoteDate ?? defaultQuoteDate ?? todayInSeoul());
  /**
   * 발행일자를 처음 값에서 한 번이라도 바꿨는가(견적서 ①b). 값이 아니라 표시로 가른다 — 고쳤다가
   * 오늘로 되돌려도 고친 것이다. 새 견적서에서 이것이 거짓이면 엑셀 자동 채우기가 날짜를 빈 칸처럼
   * 채운다(quoteExcelPlanFormValues). 바꾸는 길은 editQuoteDate 하나다.
   */
  const [quoteDateTouched, setQuoteDateTouched] = useState(false);
  const [intakeNumberText, setIntakeNumberText] = useState(
    quote?.intakeNumberText ?? initialIntakeNumber ?? ""
  );
  const [repairCaseId, setRepairCaseId] = useState<string | null>(quote?.repairCaseId ?? null);
  const [customerId, setCustomerId] = useState<string | null>(quote?.customerId ?? null);
  const [customerNameText, setCustomerNameText] = useState(quote?.customerNameText ?? "");
  const [modelNameText, setModelNameText] = useState(quote?.modelNameText ?? "");
  const [lotNumberText, setLotNumberText] = useState(quote?.lotNumberText ?? "");
  const [serialNumberText, setSerialNumberText] = useState(quote?.serialNumberText ?? "");
  const [faultDescriptionText, setFaultDescriptionText] = useState(quote?.faultDescriptionText ?? "");
  const [subject, setSubject] = useState(quote?.subject ?? "");
  const [validity, setValidity] = useState(quote?.validity ?? "");
  const [delivery, setDelivery] = useState(quote?.delivery ?? "");
  const [payment, setPayment] = useState(quote?.payment ?? "");
  /**
   * 특이사항 — **케이블 견적서 양식 10번**(quotes.remarks). 여러 줄이 들어간다.
   * 다른 두 종류에서는 칸을 그리지 않고 보내지도 않는다 — 그 양식에는 이 항목이 없다.
   * 글자는 종류를 바꿔도 지우지 않는다(유효기간 · 납기와 같다) — 다시 케이블로
   * 돌리면 적어 둔 값이 그대로 있다.
   */
  const [remarks, setRemarks] = useState(quote?.remarks ?? "");
  const [workCost, setWorkCost] = useState(quote?.workCost ?? "0");
  /**
   * 품목 표. 🔴 **`itemLines` 로 편다 — `items` 가 아니다**(queries/quotes.ts 의 두
   * 항목). `items` 는 문서로 나가는 쪽이 읽는 품목 줄만이라, 그것으로 펴면 케이블
   * 견적서를 다시 열 때 **설명 줄이 사라지고** 저장하는 순간 영영 없어진다.
   */
  const [items, setItems] = useState<ItemRow[]>(
    quote?.itemLines.length
      ? quote.itemLines.map((item) => ({
          key: generateClientUuid(),
          partId: item.partId,
          // 저장된 줄에는 작업비를 싣지 않는다 — 그 값은 부품 마스터의 지금 값이고,
          // 이미 정해진 작업비를 다시 제안할 이유가 없다.
          isOverhaulPart: item.isOverhaulPart,
          lineKind: item.kind,
          partNameText: item.partNameText,
          partSpecText: item.partSpecText ?? "",
          // 설명 줄은 수량 · 단가가 NULL 이다 — 빈 칸으로 편다(0 으로 접지 않는다).
          quantity: item.quantity === null ? "" : String(item.quantity),
          unitPrice: item.unitPrice ?? "",
          // 저장돼 있던 줄이 어느 출고 기록에서 왔는지는 남지 않는다. 그래서
          // 이미 담긴 것으로 세지 않는다 — 사람이 지웠다가 다시 담을 수 있어야 한다.
          sourceKey: null,
        }))
      : (newQuoteStart?.lines.items ?? [emptyItem()])
  );

  /**
   * 부품 후보 목록을 지금 펴 둔 줄(ItemRow.key). null 이면 아무 줄도 안 펴 둔 것이다.
   *
   * 🔴 **줄마다 두지 않고 한 값으로 둔다** — 여러 줄의 목록이 한꺼번에 떠 서로를
   * 가리면 어느 줄을 고르는지 알 수 없다. 칸에 들어가면 그 줄이 열리고, 나오면 닫힌다.
   */
  const [partPickerKey, setPartPickerKey] = useState<string | null>(null);

  const [usedParts, setUsedParts] = useState<QuoteIntakeLookup["usedParts"]>([]);
  /**
   * 이 장비의 기종에 정해 둔 O/H 작업비와 그 기종 코드. 인수번호를 불러올 때
   * 함께 온다.
   *
   * `ohTemplateCode` 가 null 이면 **이 모델에 O/H 부품 템플릿이 안 이어져 있다**는
   * 뜻이고, 코드는 있는데 작업비가 null 이면 **이어져 있는데 값을 안 정했다**는
   * 뜻이다. 사람이 고쳐야 할 자리가 서로 달라서 화면이 둘을 다르게 말한다.
   */
  const [ohTemplateCode, setOhTemplateCode] = useState<string | null>(null);
  /**
   * 그 기종의 O/H 부품 목록. **O/H 견적은 부품을 출고하기 전에 내므로** 위
   * usedParts 가 비어 있는 것이 정상이고, 청구할 부품은 여기서 온다.
   */
  const [ohTemplateParts, setOhTemplateParts] = useState<QuoteIntakeLookup["ohTemplateParts"]>([]);

  /**
   * 어느 장비의 작업 목록으로 작업비를 셈하는가. 목록이 장비 종류마다 통째로
   * 다르다. 저장된 견적서는 **그때 고른 종류를 그대로 다시 편다** — 안 그러면
   * 열 때마다 다른 목록이 뜬다.
   */
  const [laborKind, setLaborKind] = useState<WorkflowKind | null>(
    quote?.laborEquipmentKind ?? null
  );
  /**
   * 체크한 작업의 카탈로그 id → 수량(≥ 1). 같은 작업을 여러 번 더해 작업비를
   * 늘릴 수 있다(2026-09-11). 규칙은 전부 domain/quote-repair-task-selection.ts 에
   * 있다 — 여기서는 부르기만 한다.
   *
   * 저장된 견적서는 `task_id` 별 줄 수를 세어 수량으로 되살린다. 카탈로그에서
   * 지워진 작업은 id 가 없거나 목록에 없어 체크가 살아나지 않는데, **그 줄의
   * 금액은 이미 work_cost 에 들어 있다** — 화면이 그 사실을 아래에서 알린다.
   */
  const [taskQuantities, setTaskQuantities] = useState<RepairTaskQuantities>(
    () => newQuoteStart?.lines.taskQuantities ?? restoreRepairTaskQuantities(quote?.repairTasks ?? [])
  );
  /**
   * 「통전작업 제외」. **사람의 결정**이고, 켜면 기본 작업비에서 통전작업 몫
   * (통전 공수시간 × 시간당 작업비)이 빠지고 문서에서 「③ 통전검사」 구역이
   * 사라진다.
   *
   * 저장된 견적서는 그때 결정을 그대로 편다. 옛 견적서는 전부 꺼짐이다 —
   * 그때는 제외할 방법 자체가 없었다.
   */
  const [powerTestExcluded, setPowerTestExcluded] = useState<boolean>(
    quote?.powerTestExcluded ?? false
  );
  /**
   * 「조사작업 제외」(2026-09-15 사용자 결정). **사람의 결정**이고, 켜면 문서에서
   * 「① 조사작업」 구역이 머리글까지 빠지고 🔴 **기본 작업비 중 조사작업 몫(조사 공수시간 ×
   * 시간당 작업비)이 작업비 계산에서 빠진다**(domain/quote-labor-cost.ts). 작업비 칸은 [계산한
   * 작업비 적용]을 누르기 전까지 그대로다.
   *
   * 저장된 견적서는 그때 결정(quotes.investigation_excluded)을 그대로 편다. 조사 칸의 마지막
   * 줄을 지우면 저절로 켜지고(removeScopeRow), 켜도 줄은 감출 뿐 지우지 않는다. 비어 있는 채
   * 풀면 양식 기본 목록으로 다시 채운다(toggleInvestigationExcluded).
   *
   * 예전에는 상태가 아니라 「조사 칸을 손대서 비웠는가」를 렌더마다 셈한 값이었다. 체크
   * 상자가 생겨 줄이 있어도 뺄 수 있고 비어 있어도 되돌릴 수 있게 되어 상태로 바꿨다.
   */
  const [investigationExcluded, setInvestigationExcluded] = useState<boolean>(
    quote?.investigationExcluded ?? false
  );
  /**
   * 「서류작업 제외」(2026-09-16). 켜면 기본 작업비 중 서류작업 몫(서류 공수시간 ×
   * 시간당 작업비)이 빠진다 — 문서에는 서류작업 구역이 없어 **금액만** 빠진다
   * (사용자 결정 2026-09-16).
   *
   * 🔴 **문서는 이 결정에 반응하지 않는다.** 견적서의 구역은 조사 · 수리 · 통전 셋뿐이라
   * 서류작업은 적히는 자리가 없다 — 「조사작업 제외」가 문서에서 「① 조사작업」을 빼는 것과
   * 다르다. 그래서 미리보기 · xlsx 로 넘기지 않는다(넘길 자리조차 만들지 않는다).
   *
   * 저장된 견적서는 그때 결정(quotes.document_excluded)을 그대로 편다. 옛 견적서는 전부
   * 꺼짐이다 — 그때는 제외할 방법 자체가 없었다.
   *
   * 🔴 **`scopeTouched` 판정에는 들어가지 않는다.** 조사 제외가 그 판정에 든 까닭은 종류를
   * 바꿀 때 **감춰 둔 조사 칸**에 양식 기본값이 사람 모르게 들어와 함께 저장되기 때문인데,
   * 서류에는 감출 칸도 저장될 줄도 없다(작업 내역 묶음은 조사 · 수리 · 통전 셋뿐이다).
   *
   * 🔴 **뺀 금액은 저장하지 않는다** — 통전의 laborPowerTestDeduction 같은 짝이 없다(조사도
   * 마찬가지다 — domain/quote-labor-cost.ts 머리말).
   */
  const [documentExcluded, setDocumentExcluded] = useState<boolean>(
    quote?.documentExcluded ?? false
  );
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * 미리보기를 펴 두었는가.
   *
   * 폼을 **떠나지 않는다** — 이 컴포넌트가 그대로 살아 있고 그리는 것만 바뀐다.
   * 그래서 돌아왔을 때 적어 둔 값이 하나도 사라지지 않는다. 새 창이나 새 주소로
   * 보내면 저장하지 않은 값을 들고 갈 방법이 없다.
   */
  const [showPreview, setShowPreview] = useState(false);

  /**
   * 견적서에 적히는 작업 내역. 묶음마다 줄 목록을 들고 있다.
   *
   * 저장된 견적서는 그때 적힌 글자를 그대로 편다. 새 견적서는 빈 채로 시작하고,
   * 장비 종류를 고르는 순간 양식의 기본 목록이 들어온다(아래 fillScopeFrom...).
   * [새 견적서] 팝업에서 OH 를 골랐으면 종류를 고른 순간처럼 그 양식의 목록으로 시작한다
   * (newQuoteStart).
   */
  const [scopeLines, setScopeLines] = useState<Record<QuoteWorkScopeSection, ScopeRow[]>>(() => {
    if (newQuoteStart) return newQuoteStart.lines.scopeLines;
    const initial: Record<QuoteWorkScopeSection, ScopeRow[]> = {
      INVESTIGATION: [],
      REPAIR: [],
      POWER_TEST: [],
    };
    for (const line of quote?.workScopeLines ?? []) {
      initial[line.section].push({ key: generateClientUuid(), text: line.text });
    }
    return initial;
  });

  /**
   * 사람이 그 묶음을 손댔는가.
   *
   * 🔴 **손댄 묶음은 자동으로 다시 채우지 않는다.** 종류를 바꿀 때마다 양식 기본값이
   * 덮어쓰면 적어 둔 문장이 소리 없이 사라지고, 사람은 자기가 지운 줄 안다.
   * 처음 열었을 때 이미 적혀 있던 견적서도 손댄 것으로 본다 — 그 글자가 곧
   * 사람이 정한 내용이다.
   */
  const [scopeTouched, setScopeTouched] = useState<Record<QuoteWorkScopeSection, boolean>>(
    () =>
      // 새 견적서는 처음 상태가 정한다(newQuoteStart) — 엑셀 전용으로 열었으면 비운 칸이 「손댄
      // 것」이다(스위치를 켤 때와 같다).
      newQuoteStart?.lines.scopeTouched ?? {
        // 「조사작업 제외」로 저장한 장(investigationExcluded)도 손댄 것으로 본다 — 아니면 종류를
        // 바꿀 때 감춰 둔 조사 칸에 양식 기본값이 사람 모르게 들어와 함께 저장된다. 비어 있는 채
        // 체크를 풀면 그때 다시 채운다(toggleInvestigationExcluded).
        INVESTIGATION:
          (quote?.workScopeLines ?? []).some((l) => l.section === "INVESTIGATION") ||
          quote?.investigationExcluded === true,
        REPAIR: (quote?.workScopeLines ?? []).some((l) => l.section === "REPAIR"),
        POWER_TEST: (quote?.workScopeLines ?? []).some((l) => l.section === "POWER_TEST"),
      }
  );
  const [isConflict, setIsConflict] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * 엑셀 전용 견적서인가 · 손으로 적는 공급가액(2026-09-15 Q3). 저장된 장은 그때 값을 편다.
   * 공급가액 칸의 글자는 **꺼도 지우지 않는다** — 다시 켜면 그대로다. 보내는 것은 켜져 있을
   * 때뿐이다(collectFields).
   */
  const [isExcelOnly, setIsExcelOnly] = useState<boolean>(quote?.isExcelOnly ?? newQuoteStart?.isExcelOnly ?? false);
  const [manualSupplyAmount, setManualSupplyAmount] = useState(quote?.manualSupplyAmount ?? "");
  /**
   * 엑셀 전용을 켤 때 비운 줄 — 저장 전에 끄면 그대로 돌려놓는다. 팝업에서 엑셀 전용을 골라 연
   * 새 견적서는 스위치를 켤 때처럼 그 종류의 줄을 넣어 둔 채 시작한다(newQuoteStart).
   */
  const [excelOnlyStash, setExcelOnlyStash] = useState<ExcelOnlyLines | null>(newQuoteStart?.excelOnlyStash ?? null);
  /** 줄이 있는 채로 켜려 할 때 여는 확인 창의 줄 수. null 이면 닫혀 있다. */
  const [clearLinesAsk, setClearLinesAsk] = useState<QuoteLineCounts | null>(null);
  /**
   * 새 견적서를 만들었는데 파일을 다 올리지 못해 이 화면에 머문 경우의 그 견적서.
   * 🔴 있으면 다음 [저장]은 **고치기**다 — 다시 만들면 같은 견적서가 두 장 생긴다.
   */
  const [createdQuote, setCreatedQuote] = useState<{ id: string; version: number } | null>(null);
  /** 새 견적서 저장 뒤 파일 올리기의 진행 · 실패 안내. */
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  /**
   * [견적서 받기](발행 통로)의 결과 줄 — 머리의 단추들 바로 아래에 보인다(견적서 B1c).
   * 저장하지 않은 변경이 있어 통로를 부르지 않았을 때의 「먼저 [저장]」도 여기다.
   */
  const [issueNotice, setIssueNotice] = useState<QuoteIssueNoticeLine[]>([]);
  /** [폴더 열기](견적서 ④b)의 결과 — [견적서 받기] 결과 아래에 보인다. 누르는 동안은 비운다(null). */
  const [folderOpenOutcome, setFolderOpenOutcome] = useState<QuoteFolderOpenOutcome | null>(null);
  /**
   * 「수기 견적서 엑셀」로 칸 채우기의 상태(견적서 ①b — ExcelAutofillState). 없으면 null.
   * 읽개는 한 번 만들어 들고 있는다 — 마지막에 고른 파일의 결과만 돌려주는 차례표가 그 안에 있다.
   */
  const [excelAutofill, setExcelAutofill] = useState<ExcelAutofillState | null>(null);
  const [excelReader] = useState(() => createLatestQuoteExcelReader());
  /**
   * [새 견적서] 팝업이 건네준 **시트 차례**(견적서 ⑤b — new-quote-excel-handoff.ts). 팝업에서
   * 고른 종류에 짝지어지는 탭이고, 첫 읽기 한 번에만 쓰고 비운다 — 그다음에 사람이 다른 엑셀을
   * 고르면 그 파일은 지금까지처럼 통로가 혼자 고른 시트로 읽는다. 상자가 비어 있었으면 undefined
   * 라, 지금까지와 한 글자도 다르지 않은 요청이다.
   */
  const handoffSheetIndex = useRef<number | undefined>(undefined);

  /** 저장된 견적서 — 수정 화면의 그 장, 또는 이 화면에서 방금 만든 장. 없으면 새 견적서. */
  const savedQuote = quote ? { id: quote.id, version: quote.version } : createdQuote;

  /**
   * ============================================================================
   * 🔴 케이블 견적서인가 — 이 한 값이 화면의 절반을 가른다 (2026-09-16 케이블 ③)
   * ============================================================================
   * 케이블 견적서는 **수리품과 이어지지 않는 별도 견적서**다. 그래서 이 화면에서
   * 그 종류일 때 **없는 것들**이 있다:
   *
   *   · 인수번호로 불러오기 · 수리 건 연결 — 고칠 물건이 없다.
   *   · O/H 부품 템플릿 · 출고된 부품(참고) — 같은 이유다.
   *   · 수리 작업 목록 · 세 가지 제외 · 작업비 · 작업 내역(조사 · 수리 · 통전) —
   *     양식에 그 구역이 아예 없다(xlsx/cable-quote-template.ts 머리말).
   *
   * 🔴 **감추는 것만으로는 모자라다.** 감춘 칸의 값이 저장에 실리면 나중에 금액이
   * 어긋난다 — 그 장을 다시 열면 보이지 않는 작업비가 합계에 들어 있다. 그래서
   * collectFields 가 케이블일 때 그 값들을 **비워서 보낸다**(그 함수의 그 항목).
   *
   * 반대로 케이블에만 있는 것: 품목 표의 **규격** 칸 · **설명 줄** · **특이사항**.
   * ============================================================================
   */
  const isCable = kind === "CABLE";

  /**
   * 🔴 이 장의 문서를 앱이 만들 수 있는가 — [미리보기 · PDF]와 [견적서 받기]를 그릴지
   * 가른다(2026-09-16 케이블 ③). 판정은 **받기 통로 둘 · 미리보기 화면 · 목록과 같은
   * 함수 하나**다(domain/quote-document-support.ts) — 화면이 따로 셈하면 서버가 거절하는
   * 장에 단추가 남거나, 케이블 양식이 붙는 날 여기만 안 열린다.
   *
   * 🔴 **케이블이어도 엑셀 전용이면 된다** — 그 장의 문서는 손으로 만든 엑셀(과 결재
   * PDF)이라 앱 양식을 쓰지 않는다. 그래서 `isCable` 이 아니라 이 판정을 본다.
   */
  const canGetDocument = canRenderQuoteDocument({ kind, isExcelOnly });

  /**
   * 결재 PDF · 수기 엑셀 두 칸의 상태. 🔴 폼이 들고 있는다 — 미리보기는 폼을 통째로
   * 갈아 그리므로, 구역 안에 두면 미리보기를 여는 순간 골라 둔 파일이 사라진다
   * (QuoteAttachmentsSection.tsx 머리말).
   *
   * 「수기 견적서 엑셀」을 고른 순간 훅이 onExcelPicked 를 부른다 — 엑셀 전용 장이면 그 엑셀을 읽어
   * 칸을 채운다(견적서 ①b, handleExcelPicked). 붙이기는 훅이 먼저 시작해 두었다.
   */
  const attachments = useQuoteAttachments({
    quoteId: savedQuote?.id ?? null,
    serverSlots: attachmentSlots,
    onExcelPicked: (file) => handleExcelPicked(file),
  });

  /**
   * 엑셀로 채울 수 있는 칸의 **지금** 값(견적서 ①b). 이름은 폼 상태 이름 그대로다.
   * 읽기는 기다리는 동안 사람이 칸을 고칠 수 있어서, 결과가 온 순간에는 고른 때의 값이 아니라
   * 마지막으로 그린 값과 견준다(latestExcelFormValues) — 그 사이 적은 값을 빈 칸으로 읽고 덮지 않게.
   */
  const excelFormValues: QuoteExcelFormValues = quoteExcelPlanFormValues(
    {
      kind,
      quoteNumber,
      quoteDate,
      customerNameText,
      subject,
      modelNameText,
      lotNumberText,
      serialNumberText,
      validity,
      delivery,
      payment,
      manualSupplyAmount,
    },
    // 🔴 새 견적서(아직 저장 전)에서 손대지 않은 기본 발행일자(오늘)는 빈 칸으로 본다 — 엑셀 날짜로
    // 곧바로 채운다(2026-09-16 사용자 결정). 저장된 장 · 손댄 날짜는 그대로 「적힌 값」이다.
    { isNewQuote: savedQuote === null, touched: quoteDateTouched }
  );
  const latestExcelFormValues = useRef(excelFormValues);
  useEffect(() => {
    latestExcelFormValues.current = excelFormValues;
  });

  /**
   * 합계 미리보기 — 서버가 금액을 셈하는 그 함수 하나로(domain/quote-list.ts 의
   * quoteSupplyAmountOf). 엑셀 전용이면 손으로 적은 공급가액이고, 비어 있으면 null(「—」).
   *
   * 🔴 **설명 줄은 합계에 들어가지 않는다.** 여기서 거르지 않고 줄의 종류와 빈 값을
   * 그대로 넘겨 `isQuoteAmountItemLine` 이 가르게 한다(도메인 한 곳) — 설명 줄의 수량을
   * `Number("") || 0` 으로 접어 넘기면 「0원짜리 품목 줄」이 되어 셈에 **들어간 것과
   * 구별되지 않는다**(그 함수의 그 항목).
   */
  const supplyAmount = useMemo(
    () =>
      quoteSupplyAmountOf({
        isExcelOnly,
        manualSupplyAmount,
        items: items.map((item) => ({
          kind: item.lineKind,
          quantity: item.lineKind === "NOTE" ? null : Number(item.quantity) || 0,
          unitPrice: item.lineKind === "NOTE" ? null : item.unitPrice,
        })),
        workCost,
      }),
    [isExcelOnly, manualSupplyAmount, items, workCost]
  );
  const vat = supplyAmount === null ? null : supplyAmount * VAT_RATE;

  /**
   * 모델명·신고증상·종류로 지은 품명. 지금 적힌 것과 같으면 아래 단추를
   * 그리지 않는다 — 눌러도 아무 일도 일어나지 않는 단추는 두지 않는다.
   *
   * 작업비와 같은 방식이다: **자동으로 덮지 않고 제안만 한다.** 글자를 칠
   * 때마다 덮으면 손으로 다듬어 둔 품명이 사라진다.
   *
   * 🔴 **케이블 견적서에는 제안하지 않는다**(2026-09-16). 지어 주는 말이
   * `… 수리 件`(OH 면 `+ OH`)인데, 케이블은 **고칠 물건이 없는 별도 견적서**라 그 말이
   * 맞지 않는다(domain/quote-subject.ts 의 `수리 件` 은 수리 건에서 온 표기다). 억지로
   * 다른 말을 지어내지 않고 **사람이 적게 둔다** — 빈 문자열이면 단추가 아예 안 그려진다.
   * 지어내는 규칙(quote-subject.ts)은 내자 · OH 의 것이라 한 글자도 건드리지 않았다.
   */
  const suggestedSubject = useMemo(
    () =>
      isCable
        ? ""
        : buildQuoteSubject({
            modelName: modelNameText,
            faultDescription: faultDescriptionText,
            kind,
          }),
    [modelNameText, faultDescriptionText, kind, isCable]
  );

  /**
   * 담긴 부품들의 작업비 합계. 규칙과 그 이유는 domain/quote-labor-cost.ts 에
   * 있다 — **수량을 곱하지 않는다.**
   *
   * 자동으로 채우지 않고 **제안만 한다.** 사람이 적어 둔 값을 글자를 칠
   * 때마다 덮으면 손으로 조정한 금액이 사라진다. 누르면 그때 들어간다.
   */
  /** 고른 장비의 작업 목록과 단가. 아직 안 골랐으면 null. */
  const activeLabor = useMemo(
    () => repairLabor.find((row) => row.equipmentKind === laborKind) ?? null,
    [repairLabor, laborKind]
  );

  /**
   * 체크한 작업들을 **그때 단가와 함께** 넘긴다. 저장할 때도 이 모양 그대로
   * 베껴 둔다 — 나중에 단가가 올라도 이미 보낸 견적서의 근거는 그대로여야 한다
   * (schema/repair-labor.ts 의 quote_repair_tasks).
   *
   * 수량 N 은 **같은 작업 N 줄**로 펴진다 — 합계·서버·DB 가 그대로 맞는다.
   */
  const selectedTasks = useMemo(() => {
    if (!activeLabor) return [];
    return expandRepairTaskLines(activeLabor.tasks, taskQuantities, activeLabor.hourlyRate);
  }, [activeLabor, taskQuantities]);

  /**
   * 🔴 **세 공수시간과 시간당 단가는 이미 화면에 들어와 있다**(activeLabor).
   * 새로 불러오지 않는다 — 그때 값을 그대로 셈에 쓰고, 그대로 저장한다.
   *
   * 기본 작업비는 **(조사h + 통전h + 서류h) × 시간당 단가**다(2026-09-16 —
   * domain/quote-labor-cost.ts). 정하지 않은 몫은 더하지 않는다.
   *
   * 장비 종류를 아직 안 골랐으면 차감을 아예 부탁하지 않는다 — 결과에 키조차
   * 생기지 않는다(그 파일의 그 항목).
   */
  const laborSuggestion = useMemo(
    () =>
      sumQuoteLaborCost(
        selectedTasks,
        activeLabor
          ? {
              hourlyRate: activeLabor.hourlyRate,
              investigationHours: activeLabor.investigationHours,
              powerTestHours: activeLabor.powerTestHours,
              documentHours: activeLabor.documentHours,
            }
          : null,
        // 사람이 켠 세 가지 제외. 각 몫은 **제 공수시간 × 단가**이고 서로를 보지 않는다.
        // 셋 다 체크 상자가 있고, 「서류작업 제외」만 문서에 닿지 않는다(금액만 빠진다).
        activeLabor
          ? {
              investigation: investigationExcluded,
              powerTest: powerTestExcluded,
              document: documentExcluded,
            }
          : undefined
      ),
    [selectedTasks, activeLabor, powerTestExcluded, investigationExcluded, documentExcluded]
  );
  /** 실제로 뺀 금액(원). 켜지 않았거나 뺄 수 없었으면 null. */
  const powerTestDeduction = laborSuggestion.powerTestDeduction ?? null;
  /**
   * 「조사작업 제외」로 실제로 뺀 조사 몫(원). 켜지 않았거나 셀 수 없었으면 null.
   * 🔴 저장하지 않는다 — 담을 칸이 없다(domain/quote-labor-cost.ts 머리말).
   */
  const investigationDeduction = laborSuggestion.investigationDeduction ?? null;
  /**
   * 「서류작업 제외」로 실제로 뺀 서류 몫(원). 켜지 않았거나 셀 수 없었으면 null —
   * 🔴 지금 세 장비 모두 서류 공수시간이 NULL 이라 **켜도 못 빼는 길이 실제로 쓰인다**
   * (아래 documentNotice 안내). 조사와 같이 저장하지 않는다 — 담을 칸이 없다.
   */
  const documentDeduction = laborSuggestion.documentDeduction ?? null;

  /**
   * 견적서 종류를 바꾸면 **오버홀 작업이 따라 체크·해제된다**(2026-08-31 요구).
   * 장비 종류를 고를 때도 같은 규칙을 한 번 적용한다.
   *
   * 🔴 **effect 로 하지 않는다.** effect 에 두면 화면이 그려진 뒤 상태를 또 바꾸는
   * 모양이 되고(react-hooks/set-state-in-effect 가 오류로 잡는다), 무엇보다
   * **처음 열 때 저장돼 있던 선택까지 덮어쓴다** — 사람이 고쳐 둔 것이 소리 없이
   * 사라지고 다음 저장에서 그 상태가 굳는다.
   *
   * 이 규칙이 도는 자리는 "사람이 종류를 고른 순간" 하나뿐이다. 그래서 두 select
   * 의 onChange 에서만 부른다.
   */
  /**
   * 조사작업·통전작업을 그 양식의 기본 목록으로 채운다. **손대지 않은 묶음만**
   * 건드린다(scopeTouched 주석).
   *
   * 종류를 고르는 순간에만 돈다 — effect 로 두면 화면이 그려진 뒤 상태를 또
   * 바꾸는 모양이 되고, 처음 열 때 저장돼 있던 글자를 덮는다.
   */
  function fillScopeFromTemplate(nextQuoteKind: QuoteKind, nextLaborKind: WorkflowKind | null) {
    const defaults = workScopeDefaults[quoteTemplateKey(nextLaborKind, nextQuoteKind)];
    if (!defaults) return;
    // 채우는 규칙은 quote-new-start.ts 한 곳이다 — [새 견적서] 팝업의 처음 값(newQuoteStart)도
    // 같은 함수로 채워, 팝업으로 연 폼과 손으로 고른 폼이 같은 목록을 든다.
    setScopeLines((prev) => scopeLinesFilledFromTemplate(prev, scopeTouched, defaults, toScopeRows));
  }

  /**
   * 수리작업을 **고른 수리 작업**으로 채운다. 손대지 않았을 때만.
   *
   * 청구하는 작업과 문서에 적는 문장이 늘 1:1은 아니라서(한 작업을 두 줄로
   * 설명하거나, 청구하지 않는 부수 작업을 적기도 한다) 한번 고친 뒤로는
   * 따로 산다 — 사람이 다시 맞추고 싶으면 그 자리의 단추를 누른다.
   */
  function fillRepairScopeFrom(taskNames: readonly string[], force = false) {
    if (!force && scopeTouched.REPAIR) return;
    setScopeLines((prev) => ({ ...prev, REPAIR: toScopeRows(taskNames) }));
    if (force) setScopeTouched((prev) => ({ ...prev, REPAIR: false }));
  }

  function editScope(section: QuoteWorkScopeSection, rows: ScopeRow[]) {
    setScopeLines((prev) => ({ ...prev, [section]: rows }));
    setScopeTouched((prev) => ({ ...prev, [section]: true }));
  }

  /**
   * 그 묶음을 **지금 양식의 기본 목록**으로 되돌린다 — [양식 기본값으로] 단추, 그리고 빈 채로
   * 「조사작업 제외」를 풀 때(toggleInvestigationExcluded). 되돌린 뒤로는 손대지 않은 것으로
   * 본다 — 종류를 바꾸면 새 양식의 목록을 따라간다(fillScopeFromTemplate).
   */
  function resetScopeToTemplate(section: QuoteWorkScopeSection) {
    const items = workScopeDefaults[quoteTemplateKey(laborKind, kind)]?.[section]?.items ?? [];
    setScopeLines((prev) => ({ ...prev, [section]: toScopeRows(items) }));
    setScopeTouched((prev) => ({ ...prev, [section]: false }));
  }

  /**
   * 「조사작업 제외」 체크 상자.
   *
   * 🔴 **켜면 값만 바꾼다** — 줄은 감출 뿐 지우지 않는다(「통전작업 제외」와 같다). 풀면 적어 둔
   * 줄이 그대로 돌아온다.
   *
   * 🔴 **비어 있는 채 풀면 양식 기본 목록으로 다시 채운다.** 빈 묶음은 문서에 양식의 기본 목록이
   * 그대로 나가므로(previewWorkSections · xlsx 의 「빈 묶음은 양식 그대로」), 화면만 빈 채로 두면
   * 화면에는 아무것도 없는데 문서에는 표준 조사 목록이 적힌 — 서로 다른 말을 하게 된다.
   * 「비었다」는 문서가 읽는 그 뜻(writtenScopeTexts — 공백뿐인 줄은 없는 줄)으로 본다.
   */
  function toggleInvestigationExcluded(excluded: boolean) {
    setInvestigationExcluded(excluded);
    if (excluded) return;
    if (writtenScopeTexts(scopeLines.INVESTIGATION).length > 0) return;
    resetScopeToTemplate("INVESTIGATION");
  }

  /**
   * 작업 내역 줄 하나를 지운다. 「2) 수리 작업」 줄이면 **그 줄을 만든 작업의 체크도
   * 푼다**(2026-09-15 사용자 — 무엇을 풀고 무엇을 두는지는 domain/quote-repair-task-
   * selection.ts 의 uncheckRepairTaskForRemovedLine 이 정한다). 줄은 여기서 이미
   * 지웠으므로 fillRepairScopeFrom 으로 다시 채우지 않는다. 체크가 풀리면 작업비
   * 합계도 그만큼 줄고, 제너레이터에서 마지막 작업이 풀리면 이 칸은 문서에서 빠진다
   * (domain/quote-work-scope-suppression.ts).
   */
  function removeScopeRow(section: QuoteWorkScopeSection, rows: ScopeRow[], removed: ScopeRow) {
    const remaining = rows.filter((r) => r.key !== removed.key);
    editScope(section, remaining);
    // 「3) 통전작업」의 마지막 줄을 지우면 「통전작업 제외」를 켠다(2026-09-15 사용자).
    // 손으로 켤 때와 같은 일이 따라온다 — 칸이 감춰지고 문서에서 ③ 이 빠진다.
    // 되돌리려면 체크를 풀고 [양식 기본값으로]를 누른다.
    if (section === "POWER_TEST" && remaining.length === 0) setPowerTestExcluded(true);
    // 「1) 조사작업」도 같다 — 줄을 다 지우면 「조사작업 제외」를 켠다(2026-09-15, 예전의 「손대서
    // 비우면 뺀다」를 이어받는다). 공백뿐인 줄은 문서에 안 나가므로 없는 줄로 본다
    // (isInvestigationScopeEmptied). 켜기만 한다 — 끄는 길은 체크 상자 하나다. 🔴 기본 작업비 중
    // 조사작업 몫이 계산에서 빠지지만, 작업비 칸은 [계산한 작업비 적용]을 누르기 전까지 그대로다.
    if (section === "INVESTIGATION" && isInvestigationScopeEmptied({ touched: true, texts: remaining.map((r) => r.text) })) {
      setInvestigationExcluded(true);
    }
    if (section !== "REPAIR" || !activeLabor) return;
    const next = uncheckRepairTaskForRemovedLine(activeLabor.tasks, taskQuantities, removed.text, remaining.map((r) => r.text));
    if (next !== taskQuantities) setTaskQuantities(next);
  }

  function applyOverhaulRule(nextQuoteKind: QuoteKind, nextLaborKind: WorkflowKind | null) {
    const labor = repairLabor.find((row) => row.equipmentKind === nextLaborKind);
    if (!labor) return;
    // O/H 면 오버홀 작업이 없을 때만 수량 1 로 넣고(있으면 수량을 건드리지
    // 않는다), 아니면 뺀다. 오버홀 작업이 표시돼 있지 않은 장비면 null — 따라
    // 움직일 줄이 없다. 이름으로 맞히지 않는다(schema/repair-labor.ts 의 is_overhaul).
    const next = applyOverhaulQuantities(labor.tasks, taskQuantities, nextQuoteKind === "OVERHAUL");
    if (next === null) return;

    setTaskQuantities(next);
    // 고른 작업이 바뀌었으니 수리작업 목록도 따라간다(손대지 않았을 때만).
    fillRepairScopeFrom(taskNamesOf(labor, next));
  }

  /**
   * 견적서 종류를 바꾼다 — **종류 select 와 엑셀 자동 채우기의 [엑셀 값으로 바꾸기](견적서 ①b)가
   * 이 함수 하나를 부른다.** 종류를 바꾸면 따라 일어나는 일(오버홀 규칙 · 양식 기본 목록)이 있어,
   * 길이 둘이면 한쪽만 그 일을 빠뜨리는 날이 온다.
   */
  function changeKind(next: QuoteKind) {
    setKind(next);
    // 엑셀 전용이면 줄을 건드리지 않는다 — 접힌 구역에 작업 · 작업 내역이 몰래
    // 생기면 서버가 저장을 거절하고, 사람은 그 줄을 볼 수 없다. 끄면 켤 때 넣어
    // 둔 줄이 그대로 돌아온다.
    if (!isExcelOnly) {
      // O/H 로 바꾸면 오버홀 작업이 자동으로 체크되고, 내자로 바꾸면
      // 풀린다(applyOverhaulRule 머리말).
      applyOverhaulRule(next, laborKind);
      // 양식이 바뀌면 조사·통전 기본 목록도 그 양식 것으로 간다.
      fillScopeFromTemplate(next, laborKind);
    }
  }

  /**
   * 공급처 이름을 바꾼다 — 칸에 치는 것과 [엑셀 값으로 바꾸기](견적서 ①b)가 같은 길이다.
   * 이름을 바꾸면 고객사 연결은 끊는다 — 이름과 id 가 서로 다른 곳을 가리키는 상태를 만들지 않는다.
   */
  function editCustomerName(value: string) {
    setCustomerNameText(value);
    setCustomerId(null);
  }

  /**
   * 발행일자를 바꾼다 — 날짜 칸에 친 것 · [엑셀 값으로 바꾸기] · 엑셀 자동 채우기가 모두 이 길이고,
   * 셋 다 「손댐」을 켠다(견적서 ①b, 2026-09-16 사용자 결정). 빈 칸처럼 채우는 것은 새 견적서의
   * 손대지 않은 처음 기본값 하나뿐이라, 한 번 채운 뒤 다시 고른 엑셀의 날짜는 제안만 한다.
   */
  function editQuoteDate(value: string) {
    setQuoteDate(value);
    setQuoteDateTouched(true);
  }

  /**
   * 고른 작업의 건명들. 목록 차례를 그대로 따른다 — 문서에 적히는 순서다.
   * 🔴 **수량을 보지 않는다** — 수량은 작업비에만 들어가고 문구는 그대로다.
   */
  function taskNamesOf(labor: RepairLaborKindRow, quantities: RepairTaskQuantities): string[] {
    return selectedRepairTaskNames(labor.tasks, quantities);
  }

  /**
   * 이미 담은 출고 부품과 아직 안 담은 것.
   *
   * 일괄 담기가 이것으로 "몇 종이 남았는지"를 말하고, 목록 쪽은 담긴 줄의 단추를
   * 「담김」으로 바꾼다. **두 번 담기는 것을 막는 것이 요점이다** — 두 번 담기면
   * 같은 부품이 두 줄이 되어 청구가 두 배가 되는데, 화면만 보고는 그게 실수인지
   * (두 줄로 나눠 적으려는) 뜻인지 구별되지 않는다.
   */
  const addedSourceKeys = useMemo(
    () => new Set(items.map((row) => row.sourceKey).filter((key): key is string => key !== null)),
    [items]
  );
  const unaddedUsedParts = useMemo(
    () => usedParts.filter((part) => !addedSourceKeys.has(usedPartKey(part))),
    [usedParts, addedSourceKeys]
  );
  /** 아직 안 담은 템플릿 줄. 차례(index)를 함께 들고 다녀야 키를 만들 수 있다. */
  const unaddedOhTemplateParts = useMemo(
    () =>
      ohTemplateParts
        .map((part, index) => ({ part, index }))
        .filter(({ index }) => !addedSourceKeys.has(ohTemplatePartKey(index))),
    [ohTemplateParts, addedSourceKeys]
  );

  async function handleLookup() {
    const intakeNumber = intakeNumberText.trim();
    if (intakeNumber === "") {
      setLookupMessage("인수번호를 입력한 뒤 눌러 주세요.");
      return;
    }
    setIsLookingUp(true);
    setLookupMessage(null);
    try {
      const result = await lookupIntakeForQuoteAction({ intakeNumber });
      if (!result.ok) {
        setLookupMessage(result.message);
        return;
      }
      if (!result.found) {
        // 오류가 아니다 — 아직 접수 전인 건으로 먼저 견적을 내는 일이 있다.
        setLookupMessage(`${intakeNumber} 로 접수된 건을 찾지 못했습니다. 아래 칸을 직접 입력해 주세요.`);
        /**
         * 🔴 **비우는 것은 조회가 받아 온 두 목록뿐이다.** 고객사명 · 모델명 · L/N ·
         * S/N · 신고증상 · 품명 · 종류 · 부품 줄 · 작업 내역처럼 **사람이 칠 수 있는
         * 칸은 하나도 건드리지 않는다** — 못 찾았다고 손으로 다듬어 둔 값을 지우면 안 된다.
         *
         * 아래 세 값의 성격이 그 칸들과 다르다. 출고 부품(usedParts)과 O/H 부품
         * 템플릿(ohTemplateCode · ohTemplateParts)은 사람이 칠 수 없고, **직전
         * 불러오기가 서버에서 받아 온 것을 그대로 담아 둔 사본**이다. 그리고 그 사본에는
         * 어느 인수번호의 것인지가 적혀 있지 않다. 그래서 인수번호를 고쳐 다시 불러
         * 「못 찾음」이 되면, 화면에 남은 두 목록은 **지금 칸에 적힌 인수번호와 아무
         * 상관이 없는 앞 건의 부품**이 된다. 사본은 받아 온 근거가 없어지면 함께
         * 없어져야 한다.
         *
         * 🔴 **O/H 쪽을 비우지 않으면 청구 금액이 틀린다**(2026-09-22 실사용 결함).
         * 출고 부품 구역은 `usedParts.length > 0` 일 때만 그려서 비우면 화면에서
         * 사라지지만, O/H 구역은 `kind === "OVERHAUL"` 이기만 하면 값과 무관하게
         * 그려진다 — 비우지 않으면 앞 건 기종의 부품 줄과 [담기] 단추가 그대로 살아
         * 있고, 그것을 담으면 관계없는 부품이 **O/H 템플릿 단가까지 달고** 청구 줄로
         * 들어간다. 비워야 그 자리에 안내 문구만 남는다.
         */
        setUsedParts([]);
        setOhTemplateCode(null);
        setOhTemplateParts([]);
        return;
      }

      const found = result.found;
      setRepairCaseId(found.repairCaseId);
      setCustomerId(found.customerId);
      if (found.customerName) setCustomerNameText(found.customerName);
      setModelNameText(found.modelName ?? "");
      setLotNumberText(found.lotNumber ?? "");
      setSerialNumberText(found.serialNumber ?? "");
      setFaultDescriptionText(found.faultDescription ?? "");

      // 품명은 **비어 있을 때만** 지어 준다. 인수번호를 고쳐 다시 불러올
      // 때마다 손으로 다듬어 둔 품명이 사라지면 안 된다 — 다시 짓고 싶으면
      // 품명 칸 아래의 단추를 누른다.
      if (subject.trim() === "") {
        setSubject(
          buildQuoteSubject({
            modelName: found.modelName,
            faultDescription: found.faultDescription,
            kind,
          })
        );
      }
      setUsedParts(found.usedParts);
      setOhTemplateCode(found.ohTemplateCode);
      setOhTemplateParts(found.ohTemplateParts);
      setLookupMessage(
        found.usedParts.length > 0
          ? `불러왔습니다. 이 건에 출고된 부품 ${found.usedParts.length}종이 아래 참고 목록에 있습니다.`
          : "불러왔습니다. 이 건에 출고된 부품 기록은 없습니다."
      );
    } finally {
      setIsLookingUp(false);
    }
  }

  /**
   * 🔴 수리 건의 「견적서」 탭에서 들어왔으면 **「불러오기」를 한 번 대신 눌러
   * 준다.** 방금 그 건에서 눌러 왔는데 인수번호를 손으로 다시 적게 하지 않으려는
   * 것이고, 무엇보다 **`repairCaseId` 가 채워지는 곳이 여기 하나이기 때문**이다 —
   * 그 값이 비면 저장된 견적서가 그 건의 탭에서 영영 보이지 않는다.
   *
   * 값을 서버에서 미리 받아 칸에 꽂지 않는 것이 요점이다. 그러면 폼을 채우는
   * 길이 둘이 되고, 두 입구가 서로 다른 값을 채우기 시작한다(그 차이는 한참 뒤에
   * 금액으로 드러난다). 여기서는 **사람이 누르는 것과 똑같은 길**을 탄다.
   *
   * 새로 만들 때만, 그리고 한 번만 돈다. 고치기(quote !== null)에는 이미 저장된
   * 값이 있어서 불러오기가 그것을 덮어쓰면 안 된다.
   */
  const didAutoLookup = useRef(false);
  useEffect(() => {
    if (quote !== null) return;
    if ((initialIntakeNumber ?? "").trim() === "") return;
    /**
     * 효과 **본문에서 곧바로** 부르지 않는다. 불러오기는 첫 줄부터 상태를
     * 건드려서(`setIsLookingUp(true)`) 그리자마자 렌더가 연쇄한다
     * (react-hooks/set-state-in-effect). 한 틱 미루면 첫 그림은 그대로 나오고,
     * 불러오기는 그 뒤에 시작된다 — 사람 눈에는 차이가 없다.
     *
     * 깃발을 **타이머 안에서** 세운다. 개발 모드의 StrictMode 는 효과를 두 번
     * 도는데, 바깥에서 세우면 첫 번째가 깃발만 세우고 정리(cleanup)에 지워져
     * 불러오기가 아예 안 도는 상태가 된다.
     */
    const timer = setTimeout(() => {
      if (didAutoLookup.current) return;
      didAutoLookup.current = true;
      void handleLookup();
    }, 0);
    return () => clearTimeout(timer);
    // handleLookup 은 매 렌더 새로 만들어진다 — 넣으면 무한히 다시 불러온다.
    // 위 깃발이 "처음 한 번"을 보장한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, initialIntakeNumber]);

  /**
   * ============================================================================
   * [새 견적서] 팝업이 건네준 수기 견적서 엑셀 (견적서 ⑤b)
   * ============================================================================
   * 팝업에서 엑셀 전용을 켜고 엑셀을 올린 뒤 [만들기]를 누르면, 파일은 주소에 실리지 못하므로
   * 작은 상자로 건너온다(new-quote-excel-handoff.ts). 여기서 꺼내 **사람이 「수기 견적서
   * 엑셀」 칸에 파일을 고른 것과 똑같은 길**(attachments.pickFile)에 태운다 — 붙이기도 읽기도
   * 그 한 길이 한다. 팝업이 골라 둔 시트 차례는 위 handoffSheetIndex 가 첫 읽기에 실어 준다.
   *
   * 🔴 **비어 있는 것이 보통이다.** 새로고침 · 주소 직접 입력 · 뒤로가기로 들어오면 상자는
   * 비어 있고, 그때 이 폼은 지금까지와 완전히 같다 — 사람이 칸에 직접 붙이면 된다.
   * 🔴 상자는 꺼내는 순간 비워지므로(take), 그 주소를 다시 열어도 엉뚱한 파일이 붙지 않는다.
   *
   * 효과 본문에서 곧바로 부르지 않고 한 틱 미루는 까닭 · 깃발을 타이머 안에서 세우는 까닭은
   * 바로 위 자동 불러오기와 같다(그 머리말). 고치기(quote !== null)에는 상자를 건드리지 않는다.
   * ============================================================================
   */
  const didTakeExcelHandoff = useRef(false);
  useEffect(() => {
    if (quote !== null) return;
    const timer = setTimeout(() => {
      if (didTakeExcelHandoff.current) return;
      didTakeExcelHandoff.current = true;
      const handoff = takeNewQuoteExcelHandoff();
      if (handoff === null) return;
      handoffSheetIndex.current = handoff.sheetIndex ?? undefined;
      attachments.pickFile("QUOTE_EXCEL", handoff.file);
    }, 0);
    return () => clearTimeout(timer);
    // attachments 는 매 렌더 새로 만들어진다 — 넣으면 매번 다시 돈다(위 깃발이 한 번을 보장하지만
    // 타이머를 세웠다 지우기를 되풀이한다). 첫 그림의 것으로 충분하다 — 그때가 상자를 꺼낼 때다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  /**
   * 출고 부품을 부품 줄에 담는다. 하나든 여럿이든 이 함수 하나를 쓴다 —
   * 일괄 담기가 하나씩 담기를 여러 번 부르면 setItems 가 여러 번 돌아 "빈 첫 줄"
   * 처리가 중간 상태에 걸린다.
   */
  function addUsedParts(list: readonly QuoteIntakeLookup["usedParts"][number][]) {
    if (list.length === 0) return;
    setItems((prev) => {
      // 빈 첫 줄이 남아 있으면 그 자리를 쓴다 — 담을 때마다 빈 줄이 밀려
      // 내려가면 저장할 때 "품명을 입력해 주세요"가 뜬다.
      const next = prev.filter(
        (row) => !(row.partNameText.trim() === "" && row.unitPrice.trim() === "")
      );
      return [...next, ...list.map(usedPartToItem)];
    });
  }

  /**
   * O/H 템플릿의 부품을 담는다. 출고 줄과 **다른 함수인 것이 요점이다** —
   * 단가가 오는 곳도(O/H 단가) 양식에서 갈 자리도(`2) OH 부품 비용`) 다르다.
   */
  function addOhTemplateParts(list: readonly { part: QuoteIntakeLookup["ohTemplateParts"][number]; index: number }[]) {
    if (list.length === 0) return;
    setItems((prev) => {
      const next = prev.filter(
        (row) => !(row.partNameText.trim() === "" && row.unitPrice.trim() === "")
      );
      return [...next, ...list.map(({ part, index }) => ohTemplatePartToItem(part, index))];
    });
  }

  function updateItem(key: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length === 1 ? [emptyItem()] : prev.filter((row) => row.key !== key)));
  }

  /**
   * ============================================================================
   * 🔴 줄 수의 상한 — 케이블은 아홉 줄이고, 넘으면 **문서가 만들어지지 않는다**
   * ============================================================================
   * 케이블 양식은 품목 자리가 아홉이고 줄을 늘리지 않는다. 열째 줄을 넣으면 채우개가
   * 자르지 않고 **던진다**(xlsx/cable-quote-template.ts 의 CABLE_QUOTE_MAX_LINES).
   * 그래서 저장한 뒤 [견적서 받기]에서 실패하는 대신 **여기서 막는다.**
   *
   * **설명 줄도 한 자리를 먹는다** — 그래서 종류를 가리지 않고 `items.length` 를 센다.
   * 내자 · OH 는 지금까지와 같은 상한(MAX_QUOTE_ITEMS = 50)이다.
   * ============================================================================
   */
  const maxItemLines = isCable ? cableMaxLines : MAX_QUOTE_ITEMS;
  const itemLinesFull = items.length >= maxItemLines;

  /** 줄 하나를 표 끝에 더한다. 🔴 단추를 잠그는 것과 **별개로** 여기서도 막는다. */
  function addItemRow(row: ItemRow) {
    setItems((prev) => (prev.length >= maxItemLines ? prev : [...prev, row]));
  }

  /**
   * ============================================================================
   * 설명 줄은 **언제나 맨 위**에 들어간다 (2026-09-17 사용자 요청)
   * ============================================================================
   * 설명 줄은 밑에 오는 품목 묶음의 **머리글**이다(`* 20kW RFG 부속케이블 Parts 3종`) —
   * 미리보기도 완성된 문서도 그렇게 읽는다. 그런데 표 끝에 붙이면 방금 적은 품목
   * **밑으로** 들어가, 누를 때마다 사람이 줄을 손으로 끌어 올려야 한다.
   *
   * 처음에는 마지막 품목 줄을 찾아 그 위에 끼웠는데, 사람이 바란 규칙은 그보다 단순했다 —
   * 「설명줄은 무조건 제일 위에 떠야 해」. 그래서 품목을 찾지 않고 **언제나 0번 자리**에
   * 넣는다. 품목 줄이 있든 없든, 설명 줄만 여럿 적어 두든 같은 규칙이다(나중에 더한
   * 설명 줄이 위로 온다).
   *
   * 🔴 **[+ 품목 추가]는 그대로 끝에 붙인다**(addItemRow) — 품목은 적는 차례가 곧 문서의
   *    차례라, 끼워 넣으면 방금 적은 것이 어디로 갔는지 알 수 없다.
   * 🔴 상한은 addItemRow 와 **같은 규칙**이다 — 단추를 잠그는 것과 별개로 여기서도 막는다.
   *    앞에 붙이는 길만 상한을 안 보면 아홉 줄 양식에 열째 줄이 들어가 [견적서 받기]가 던진다.
   * ============================================================================
   */
  function addNoteRowAtTop(row: ItemRow) {
    setItems((prev) => {
      if (prev.length >= maxItemLines) return prev;
      return [row, ...prev];
    });
  }

  /** 줄마다 「제 종류 안에서 몇 번째인가」 — 자리표시 · 이름표가 쓰는 번호다(lineOrdinalsOf). */
  const lineOrdinals = lineOrdinalsOf(items);

  /**
   * 엑셀 전용 장에 있으면 안 되는 줄의 수 — 서버 규칙이 세는 그대로다(저장이 거르는 빈
   * 줄은 세지 않는다). 하나라도 있으면 켜기 전에 묻는다.
   */
  const excelOnlyLineCounts = countQuoteLinesForExcelOnly({
    items,
    workScopeTexts: QUOTE_WORK_SCOPE_SECTIONS.flatMap((section) => scopeLines[section].map((row) => row.text)),
    repairTaskCount: selectedTasks.length,
  });

  function applyExcelOnlyLines(lines: ExcelOnlyLines) {
    setItems(lines.items);
    setScopeLines(lines.scopeLines);
    setScopeTouched(lines.scopeTouched);
    setTaskQuantities(lines.taskQuantities);
  }

  /**
   * 엑셀 전용 스위치. 판정은 planExcelOnlyToggle(quote-attachment-files.ts) 한 곳이다 —
   * 줄이 있는 채로 켜려 하면 먼저 묻고(`confirmedClear` 가 거짓), 켜면 줄을 넣어 두고
   * 비우며, 끄면 넣어 둔 줄을 그대로 돌려놓는다.
   *
   * 🔴 줄을 **조용히 버리지 않는다.** 서버가 줄이 있는 엑셀 전용 장을 거절하는 까닭(되돌렸을
   * 때 무엇을 적었는지 되찾을 길이 없다)과 같은 판단이라, 비우는 것은 사람이 고른 뒤이고
   * 저장 전에는 끄는 것으로 되돌릴 수 있다.
   */
  function toggleExcelOnly(turnOn: boolean, confirmedClear = false) {
    const plan = planExcelOnlyToggle<ExcelOnlyLines>({
      turnOn,
      confirmedClear,
      counts: excelOnlyLineCounts,
      current: { items, scopeLines, scopeTouched, taskQuantities },
      cleared: clearedExcelOnlyLines(),
      stash: excelOnlyStash,
    });
    if (plan.kind === "ASK_TO_CLEAR") {
      setClearLinesAsk(plan.counts);
      return;
    }
    setClearLinesAsk(null);
    if (plan.lines) applyExcelOnlyLines(plan.lines);
    setExcelOnlyStash(plan.stash);
    setIsExcelOnly(plan.isExcelOnly);
    // 엑셀 전용을 끄면 엑셀 읽기는 할 일이 없다 — 읽는 중이면 그 결과를 버리고 알림을 걷는다(견적서 ①b).
    if (!plan.isExcelOnly) {
      excelReader.cancel();
      setExcelAutofill(null);
    }
  }

  /**
   * 「수기 견적서 엑셀」 칸에 파일을 고른 순간(견적서 ①b — 훅의 onExcelPicked). 붙이기는 훅이 이미
   * 시작했다. 🔴 엑셀 전용 장만 읽는다 — 일반 견적서의 엑셀 칸은 앱이 만든 파일이 들어가는 칸이라
   * 읽을 까닭이 없다(B1b).
   */
  function handleExcelPicked(file: File) {
    if (!isExcelOnly) return;
    void readPickedExcel(file);
  }

  /**
   * 고른 엑셀을 읽어 칸을 채운다. 규칙은 quote-excel-autofill.ts 의 planQuoteExcelAutofill 한 곳이다 —
   * **빈 칸만 채우고**, 이미 적힌 칸이 다르면 덮지 않는다(그 목록은 그릴 때 excelConflicts 가 뽑는다).
   *
   * 🔴 두 번 고르면 마지막 파일의 결과만 쓴다 — 늦게 온 옛 결과는 읽개가 null 로 돌려주고, 칸을
   * 건드리기 전에 버린다. 🔴 견주는 값은 고른 때가 아니라 **마지막으로 그린** 폼 값이다
   * (latestExcelFormValues) — 읽는 사이 사람이 적은 값을 빈 칸으로 보고 덮지 않게.
   * 읽기가 실패해도 파일은 그대로 붙어 있다(붙이기는 훅이 따로 한다).
   */
  async function readPickedExcel(file: File) {
    setExcelAutofill({ status: "reading" });
    // [새 견적서] 팝업이 골라 둔 시트 — **한 번 쓰고 비운다**(위 handoffSheetIndex).
    const sheetIndex = handoffSheetIndex.current;
    handoffSheetIndex.current = undefined;
    const result = await excelReader.read(file, { sheetIndex });
    if (result === null) return;
    if (!result.ok) {
      setExcelAutofill({ status: "failed", reason: result.reason, code: result.code });
      return;
    }
    const plan = planQuoteExcelAutofill(latestExcelFormValues.current, result.fields);
    for (const change of plan.fills) applyExcelValue(change);
    setExcelAutofill({
      status: "read",
      fields: result.fields,
      filled: plan.fills.map((change) => change.field),
      readCount: plan.fills.length + plan.conflicts.length + plan.unchanged.length,
      warnings: result.warnings,
    });
  }

  /**
   * 엑셀 값 하나를 폼 칸에 넣는다 — 빈 칸 채우기와 [엑셀 값으로 바꾸기]가 이 함수 하나를 부른다
   * (견적서 ①b). 🔴 종류는 select 와 같은 changeKind, 공급처는 칸에 치는 것과 같은 editCustomerName
   * 을 탄다. `Record` 라 채울 칸이 하나 늘면 컴파일러가 여기를 짚는다.
   */
  function applyExcelValue(change: QuoteExcelFieldChange) {
    const setters: Record<QuoteExcelAutofillField, (value: string) => void> = {
      kind: (value) => {
        const next = QUOTE_KINDS.find((candidate) => candidate === value);
        if (next) changeKind(next);
      },
      quoteNumber: setQuoteNumber,
      // 채운 날짜 · 바꾼 날짜도 손댐이다 — 다시 고른 엑셀의 날짜는 제안만 한다(2026-09-16 사용자 결정).
      quoteDate: editQuoteDate,
      customerNameText: editCustomerName,
      subject: setSubject,
      modelNameText: setModelNameText,
      lotNumberText: setLotNumberText,
      serialNumberText: setSerialNumberText,
      validity: setValidity,
      delivery: setDelivery,
      payment: setPayment,
      manualSupplyAmount: setManualSupplyAmount,
    };
    setters[change.field](change.excelValue);
  }

  function collectFields() {
    return {
      quoteNumber,
      kind,
      quoteDate,
      repairCaseId,
      intakeNumberText,
      customerId,
      customerNameText,
      modelNameText,
      lotNumberText,
      serialNumberText,
      faultDescriptionText,
      subject,
      validity,
      delivery,
      payment,
      /**
       * 특이사항은 **케이블 견적서에서만** 보낸다 — 다른 두 양식에는 이 항목이 없어
       * 적힐 자리가 없다. 칸의 글자는 지우지 않으므로(위 remarks) 종류를 되돌리면
       * 그대로 돌아온다. 공급가액이 엑셀 전용일 때만 실리는 것과 같은 규칙이다.
       */
      remarks: isCable ? remarks : null,
      /**
       * ────────────────────────────────────────────────────────────────────
       * 🔴 케이블 견적서는 **작업 값 일곱을 비워 보낸다** (2026-09-16 케이블 ③)
       * ────────────────────────────────────────────────────────────────────
       * 그 양식에는 작업비 구역이 없고, 화면도 그 칸들을 접어 두었다(isCable).
       * 감춘 값을 그대로 실어 보내면 **보이지 않는 작업비가 합계에 들어간다** —
       * 내자로 적다가 종류만 케이블로 바꾼 장이 정확히 그 꼴이 된다(작업비 350만원이
       * 그대로 남는다). 그래서 여기서 비운다:
       *
       *   workCost "0" · laborEquipmentKind null · laborBaseCost null ·
       *   powerTestExcluded false · laborPowerTestDeduction null ·
       *   investigationExcluded false · documentExcluded false ·
       *   repairTasks [] · workScopeLines []
       *
       * 🔴 **화면의 상태는 지우지 않는다** — 종류를 되돌리면 적어 둔 작업 내역과
       * 고른 작업이 그대로 돌아온다(엑셀 전용 스위치가 줄을 넣어 두는 것과 같은 판단).
       * 보내지 않을 뿐이다.
       */
      workCost: isCable ? "0" : workCost,
      /**
       * 작업비의 근거. **그때 값의 사본을 보낸다** — 나중에 시간당 단가가 오르거나
       * 공수시간이 고쳐져도 이미 보낸 견적서의 근거는 그대로여야 한다
       * (schema/repair-labor.ts 의 quote_repair_tasks 머리말).
       */
      laborEquipmentKind: isCable ? null : laborKind,
      /**
       * 기본 작업비 스냅숏 — **이 장에 실제로 더해진 금액**이다(정해진 세 공수시간의 합 ×
       * 시간당 단가). 🔴 `repair_labor_settings.base_cost` 를 베끼지 않는다: 2026-09-16 부터
       * 그 칸은 계산의 근거가 아니라 넘어오기 전의 기록이라, 앞으로 공수시간을 고치면 두 값이
       * 갈라진다. 근거로 남길 것은 **그때 청구한 기본 작업비** 쪽이다.
       */
      laborBaseCost:
        isCable || laborSuggestion.baseCost === null ? null : toAmountText(laborSuggestion.baseCost),
      /**
       * 통전작업 제외 — **결정과 그때 뺀 금액을 따로 보낸다.**
       *
       * 🔴 뺀 금액은 **화면이 셈한 값**이다. 서버가 설정 표를 다시 보고
       * 계산하게 하면, 통전 공수시간이 바뀌는 순간 이미 보낸 견적서의 근거가
       * 소리 없이 달라진다(schema/quotes.ts 의 그 항목).
       *
       * 제외를 켰는데 금액이 null 인 것은 **"빼기로 했으나 빼지 못했다"**
       * 이다(그 장비의 통전 공수시간을 아직 정하지 않았다). 화면이 아래에서
       * 그 사실을 말한다.
       */
      powerTestExcluded: isCable ? false : powerTestExcluded,
      laborPowerTestDeduction:
        isCable || powerTestDeduction === null ? null : toAmountText(powerTestDeduction),
      /**
       * 「조사작업 제외」 체크 — 문서는 저장된 이 결정만 읽는다(「① 조사작업」을 뺀다). 빈
       * 칸만으로 가르면 옛 견적서의 빈 칸과 구별되지 않아 따로 보낸다.
       *
       * 🔴 기본 작업비 스냅숏(laborBaseCost)은 **조사 몫을 뺐어도 그대로 보낸다** — 그 장비의
       * 기본 작업비가 얼마였는지는 근거로 남고, 조사 몫을 뺐다는 사실은 이 칸이 말한다. 뺀 조사
       * 몫 자체는 **저장하지 않는다**(칸이 없다 — domain/quote-labor-cost.ts 머리말). 금액은
       * 사람이 [계산한 작업비 적용]으로 넣은 workCost 그대로다.
       */
      investigationExcluded: isCable ? false : investigationExcluded,
      /**
       * 「서류작업 제외」 체크(2026-09-16) — **금액에만 쓰이는 결정**이다. 문서는 이 칸을
       * 읽지 않는다(견적서에 서류작업 구역이 없다). 조사와 같이 **뺀 금액은 보내지 않는다** —
       * 담을 칸이 없고, 청구 금액은 사람이 [계산한 작업비 적용]으로 넣은 workCost 그대로다.
       */
      documentExcluded: isCable ? false : documentExcluded,
      /**
       * 엑셀 전용 · 손으로 적은 공급가액. 공급가액은 **켜져 있을 때만** 보낸다 — 꺼진 장에
       * 값이 있으면 검증이 거절한다(validation/quote-input.ts 의 quoteExcelOnlyFieldErrors).
       */
      isExcelOnly,
      manualSupplyAmount: isExcelOnly ? manualSupplyAmount : null,
      repairTasks: isCable ? [] : selectedTasks,
      /**
       * 문서에 적히는 작업 내역. 빈 줄은 검증이 걸러 낸다 — 적힐 것이 없는
       * 문장이라 버려도 잃는 것이 없다.
       *
       * 묶음 차례는 배열 순서가 그대로다: 조사 → 수리 → 통전, 양식에 적히는
       * 순서와 같게 보낸다.
       */
      workScopeLines: isCable
        ? []
        : QUOTE_WORK_SCOPE_SECTIONS.flatMap((section) =>
            scopeLines[section].map((row) => ({ section, text: row.text }))
          ),
      // 통째로 빈 줄은 보내지 않는다 — 사람이 `+ 부품 추가`를 눌러 두고 안 채운
      // 줄이 저장을 막으면, 어디가 문제인지 찾느라 폼을 다시 훑게 된다. 설명 줄은
      // 단가 칸이 아예 없으므로 **글자 하나로** 빈 줄인지 가려진다.
      items: items
        .filter((row) => row.partNameText.trim() !== "" || row.unitPrice.trim() !== "")
        .map((row) => {
          const isNote = row.lineKind === "NOTE";
          return {
            partId: row.partId,
            // 내자 견적서에는 OH 칸이 없다 — 종류를 바꿔 저장하면 그 표시를 지운다.
            isOverhaulPart: kind === "OVERHAUL" ? row.isOverhaulPart : false,
            kind: row.lineKind,
            partNameText: row.partNameText,
            /**
             * 규격은 **케이블 견적서에서만** 보낸다 — 다른 두 양식에는 규격 칸이 없다.
             * OH 표시를 종류가 바뀌면 지우는 것과 같은 규칙이다.
             */
            partSpecText: isCable && !isNote ? row.partSpecText : null,
            /**
             * 🔴 설명 줄은 수량 · 단가가 **NULL 이어야 한다**(CHECK
             * quote_items_amounts_item_line_only). 화면에 그 칸이 없으므로 여기서
             * 지어낼 것도 없다 — `Number("")` 가 NaN 으로 새어 나가지 않게 못 박는다.
             */
            quantity: isNote ? null : Number(row.quantity),
            unitPrice: isNote ? null : row.unitPrice,
          };
        }),
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    // 새 장을 만든 뒤에는 화면을 옮기는 중이다. 그 사이에 단추를 되살리면
    // 사람이 한 번 더 눌러 같은 견적서가 두 장 만들어진다 — 아래 finally 가
    // 이 깃발을 보고 `저장 중…` 그대로 둔다.
    let leaving = false;
    try {
      const fields = collectFields();
      // 이 화면에서 방금 만든 장(createdQuote)도 고치기다 — 다시 만들면 두 장이 된다.
      const result = savedQuote
        ? await updateQuoteAction({ id: savedQuote.id, expectedVersion: savedQuote.version, fields })
        : await createQuoteAction({ fields });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 낡은 값을 그대로 다시 밀어 넣지 못하게 폼을 얼린다.
          setIsConflict(true);
          setSubmitError(result.message);
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      // 🔴 이제 이 값이 DB 에 저장된 값이다 — [견적서 받기]의 「저장하지 않은 변경」 기준을 옮긴다.
      // 고치기는 곧 목록으로 떠나지만, 새 견적서가 파일을 못 올려 이 화면에 머물면 이 기준으로 받는다.
      setSavedFieldsSnapshot(JSON.stringify(fields));

      if (savedQuote) {
        // 고친 뒤에도 저장 팝업을 0.5초 띄우고 왔던 목록으로 넘어간다(2026-09-15
        // 사용자 요청). 떠날 화면이라 다시 읽지 않고, 넘어갈 때까지 단추를 잠가 둔다.
        leaving = true;
        showSavePopup({ message: "견적서를 저장했습니다.", redirectTo: returnHref ?? "/quotes" });
        return;
      }

      /**
       * 새 견적서가 생겼다 — 들고 있던 파일(결재 PDF · 수기 엑셀)을 **지금** 올린다. id 가
       * 이제야 생겼기 때문이다(2026-09-15 Q3).
       *
       * 🔴 올리기 **전에** 만든 장을 기억한다(createdQuote). 올리다 무엇이 잘못돼도 다음
       * [저장]은 고치기가 되어야 한다 — 새로 만들면 같은 견적서가 두 장이 된다.
       *
       * 하나라도 못 올리면 **목록으로 넘기지 않는다** — 견적서는 저장됐고, 이 화면의
       * 「견적서 파일」 칸이 못 올린 파일을 까닭과 함께 들고 [다시 올리기]를 내민다.
       * 올릴 것이 없으면 곧바로 지나간다(예전 그대로).
       */
      setCreatedQuote({ id: result.id, version: result.version });
      const upload = await attachments.uploadQueuedAfterCreate(result.id, (current, total) =>
        setAttachmentNotice(quoteAttachmentUploadProgressText(current, total))
      );
      if (upload.failures.length > 0) {
        setAttachmentNotice(createdWithAttachmentFailuresText(upload.total, upload.failures));
        return;
      }

      /**
       * 🔴 만들기는 **옮기기만 한다 — 뒤에 refresh 를 붙이지 않는다.**
       *
       * `router.push()` 바로 뒤에 `router.refresh()` 를 부르면, 아직 끝나지
       * 않은 이동을 새로고침이 덮어쓴다. 새로고침이 다시 그리는 것은 **지금
       * 있는 주소**(/quotes/new)라서, 서버는 새 견적서 화면을 통째로 다시
       * 그리느라 시간을 쓰고 화면은 폼에 그대로 남는다 — 저장은 됐는데 아무
       * 일도 일어나지 않은 것처럼 보인다(2026-08-28 사용자 신고 — "시간이 많이
       * 걸리면서 넘어가지 않는다". 근거는 next/dist 의 refresh-reducer.js 다:
       * "A refresh is modeled as a navigation to the current URL", navigateType
       * = 'replace').
       *
       * 옮겨 간 곳은 force-dynamic 이라 어차피 서버가 새로 그린다 —
       * 새로고침이 할 일이 애초에 없다. 접수 등록(IntakeFormInner)도 저장 뒤
       * push 하나뿐이고, 이 화면만 달랐다.
       *
       * ── 어디로 옮기는가 ──────────────────────────────────────────────
       * 🔴 **왔던 곳으로 돌아간다.** 수리 건의 「견적서」 탭에서 들어왔으면 그
       * 탭으로 — 방금 만든 장이 그 목록에 붙어 있는 것을 그 자리에서 보게 된다.
       * 그냥 `/quotes/new` 로 들어왔으면 견적서 목록으로 간다(2026-09-15 사용자
       * 요청: 저장하면 목록으로. 그 전에는 새 장의 수정 화면으로 갔다).
       *
       * 옮기는 것은 저장 팝업이 0.5초 뒤에 한다(common/SavePopup.tsx) — 그쪽도
       * push 하나뿐이고 뒤에 refresh 를 붙이지 않는다.
       */
      leaving = true;
      showSavePopup({ message: "견적서를 등록했습니다.", redirectTo: returnHref ?? "/quotes" });
    } catch (err) {
      // 액션이 대답을 못 하고 끊긴 자리(서버 재시작·네트워크 끊김). 아무 말도
      // 없이 단추만 되살아나면, 저장이 된 건지 만 건지 알 수 없다.
      console.error("견적서 저장 실패", err);
      setSubmitError(SAVE_FAILED_MESSAGE);
    } finally {
      if (!leaving) setIsSubmitting(false);
    }
  }

  const disabled = isSubmitting || isConflict;

  /**
   * 지금 고른 장비 종류·견적서 종류에 맞는 양식의 문구.
   *
   * 넷 중 하나를 고르는 규칙은 domain/quote-template-variant.ts 한 곳에만 있다 —
   * 화면과 서버가 같은 규칙을 봐야 "화면에 뜨는 납기와 실제로 나가는 납기가
   * 다른" 일이 생기지 않는다.
   */
  const activePrintHeader = printHeaders[quoteTemplateKey(laborKind, kind)];

  /**
   * 미리보기에 그릴 작업 내역 — **지금 적혀 있는 값**이다(저장된 값이 아니다).
   * 규칙은 previewWorkSections 주석에 있고, 저장된 견적서를 그리는 쪽
   * (`/quotes/{id}/print`)과 같은 답이 나와야 한다.
   */
  const activeWorkSections = previewWorkSections(
    workScopeDefaults[quoteTemplateKey(laborKind, kind)],
    scopeLines
  );

  /**
   * 제너레이터 견적서에서 수리 작업을 하나도 고르지 않았는가 — 그러면 「2) 수리
   * 작업」이 문서에서 빠진다(domain/quote-work-scope-suppression.ts). 고른 작업은
   * 저장되는 그 목록(selectedTasks)으로 센다 — 저장된 견적서를 그리는 쪽이 세는
   * repairTasks 가 곧 이것이다.
   */
  const repairSectionDropped = isRepairSectionDropped({
    equipmentKind: laborKind,
    chosenRepairTaskCount: selectedTasks.length,
  });

  /**
   * 🔴 저장하지 않은 변경이 있는가 — [견적서 받기]를 부를지 가른다(견적서 B1c).
   *
   * 발행 통로는 **DB 에 저장된 값**으로 파일을 만든다. 이 폼은 저장하지 않은 변경을 따로
   * 추적하지 않으므로, 고치고 저장하지 않은 채 누르면 옛 내용이 최종 이름으로 사람의
   * 서류함(공유폴더)에 들어간다. 그래서 **저장이 보내는 바로 그 값**(collectFields)을 글자로
   * 접어 마지막 저장값과 맞춰 본다 — 다르면 통로를 부르지 않고 「먼저 [저장]」을 보인다.
   *
   *  · 기준은 처음 열 때의 폼 값(저장된 견적서를 편 것)이고, [저장]이 성공하면 그때 보낸
   *    값으로 옮긴다(handleSubmit). 고쳤다가 되돌리면 같은 글자라 막지 않는다.
   *  · 저장이 보내지 않는 것(화면 전용 key · 출고 부품 참고 목록 · 미리보기 여부)은 보지
   *    않는다 — 파일에 들어가지 않는다.
   *  · 파일 칸(결재 PDF · 수기 엑셀)은 [저장]과 따로 곧바로 반영되므로 여기 들지 않는다.
   *  · 기준이 없으면(새 견적서, 아직 저장 전) 변경이 있는 것으로 본다 — 받을 장이 없어 단추도 없다.
   */
  const [savedFieldsSnapshot, setSavedFieldsSnapshot] = useState<string | null>(() =>
    quote ? JSON.stringify(collectFields()) : null
  );
  const hasUnsavedChanges = savedFieldsSnapshot === null || JSON.stringify(collectFields()) !== savedFieldsSnapshot;

  /** 발행 뒤 「수기 견적서 엑셀」 칸이 바뀌었으면(또는 모르면) 서버 칸을 다시 그려 온다 — 폼 값은 그대로다. */
  function reloadSlotsAfterIssue(outcome: QuoteIssueRunOutcome) {
    if (shouldReloadSlotsAfterIssue(outcome)) attachments.reloadAfterIssue();
  }

  /** 머리의 [견적서 받기] — 결과 줄을 단추들 아래에 두고, 칸을 다시 그려 온다. */
  function handleIssueOutcome(outcome: QuoteIssueRunOutcome) {
    setIssueNotice(outcome.lines);
    reloadSlotsAfterIssue(outcome);
  }

  if (showPreview) {
    /**
     * 지금 폼에 적힌 값 그대로 미리보기를 그린다.
     *
     * ── 빈 칸은 null 로 넘긴다 ────────────────────────────────────────
     * 미리보기는 유효기간·납기·결재조건을 `?? 양식의 기본 문구` 로 채우는데,
     * 빈 문자열은 null 이 아니라서 그 기본값이 안 뜬다. 그러면 실제로 나갈
     * 문서에는 "발행일로부터 4주"가 찍히는데 미리보기만 비어 보인다.
     *
     * ── 미리보기의 받기도 발행 단추다 (견적서 B1c) ──────────────────────
     * 이 화면은 수정 권한자만 들어오므로 canIssue 다. 🔴 저장하지 않은 변경이 있으면 머리의
     * 단추와 **같은 규칙**으로 통로를 부르지 않는다 — 미리보기는 지금 폼 값을 그리지만 통로는
     * DB 에 저장된 값으로 파일을 만들기 때문이다.
     */
    const orNull = (value: string) => (value.trim() === "" ? null : value);
    return (
      <QuotePrintView
        quoteId={savedQuote?.id ?? null}
        onClose={() => setShowPreview(false)}
        canIssue
        hasUnsavedChanges={hasUnsavedChanges}
        onIssueOutcome={reloadSlotsAfterIssue}
        header={activePrintHeader}
        workSections={activeWorkSections}
        signedPdf={attachments.signedPdfForPreview}
        hasExcel={attachments.excelAttachedOrQueued}
        quote={{
          // 엑셀 전용이면 앱 양식 대신 결재 PDF 를 보인다(QuotePrintView 의 엑셀 전용 갈래) —
          // 받아 볼 문서가 손으로 만든 엑셀이기 때문이다. 일반 견적서는 아래 값으로 지금 그대로.
          isExcelOnly,
          manualSupplyAmount: isExcelOnly ? orNull(manualSupplyAmount) : null,
          /**
           * 🔴 종류를 넘겨야 케이블이 **케이블 양식의 모양**으로 그려진다 (2026-09-17
           * 케이블 ④). 안 넘기면 미리보기가 내자 · OH 모양을 그리고, 그 종이에는 없는
           * 작업 범위 · 작업비 구역이 화면에만 뜬다.
           */
          kind,
          quoteNumber,
          quoteDate,
          customerNameText,
          subject,
          validity: orNull(validity),
          delivery: orNull(delivery),
          payment: orNull(payment),
          modelNameText: orNull(modelNameText),
          serialNumberText: orNull(serialNumberText),
          lotNumberText: orNull(lotNumberText),
          workCost,
          // 켜면 미리보기에서도 「③ 통전검사」 묶음이 사라진다 — 파일이 정확히
          // 그렇게 나가기 때문이다. 둘이 다르면 받아 본 쪽이 다른 문서로 읽는다.
          powerTestExcluded,
          // 수리 작업을 하나도 안 골랐으면 「② 수리 작업」도 사라진다 — 같은 이유.
          repairSectionDropped,
          // 「조사작업 제외」를 켜면 「① 인수 조사」도 사라진다 — 저장할 때와 같은 그 상태다.
          investigationExcluded,
          // 저장할 때와 **같은 규칙으로** 거른다 — 여기서만 빈 줄을 남겨 두면
          // 미리보기의 줄 수와 실제 문서의 줄 수가 달라진다.
          // 🔴 설명 줄은 넘기지 않는다 — 내자 · OH 모양을 그리는 쪽은 수량 · 단가가 있는
          // 품목 줄만 안다(queries/quotes.ts 의 items · itemLines). 케이블 모양은 아래
          // itemLines 를 본다 — 두 목록이 갈리는 까닭이 그 조회의 머리말에 있다.
          items: items
            .filter((row) => row.lineKind === "ITEM")
            .filter((row) => row.partNameText.trim() !== "" || row.unitPrice.trim() !== "")
            .map((row) => ({
              partId: row.partId,
              partNameText: row.partNameText,
              isOverhaulPart: kind === "OVERHAUL" ? row.isOverhaulPart : false,
              quantity: Number(row.quantity) || 0,
              unitPrice: row.unitPrice.trim() === "" ? "0" : row.unitPrice,
            })),
          /**
           * 특이사항은 **케이블에만 있는 칸**이다 — 저장에 싣는 규칙(collectFields)과 같게
           * 가른다. 종류를 되돌려도 칸의 글자는 지우지 않으므로 여기서 한 번 더 가른다.
           */
          remarks: isCable ? remarks : null,
          /**
           * 🔴 품목 표 **전체** — 설명 줄까지 **차례 그대로**. 케이블 모양이 이것을 그린다.
           * 위 items 처럼 종류로 거르면 미리보기에서 설명 줄이 사라져, 받아 본 문서와 다른
           * 종이가 된다. 빈 줄을 거르는 규칙은 저장과 같다(collectFields 의 그 항목).
           */
          itemLines: items
            .filter((row) => row.partNameText.trim() !== "" || row.unitPrice.trim() !== "")
            .map((row) => {
              const isNote = row.lineKind === "NOTE";
              return {
                partId: row.partId,
                kind: row.lineKind,
                partNameText: row.partNameText,
                partSpecText: isCable && !isNote ? row.partSpecText : null,
                isOverhaulPart: row.isOverhaulPart,
                // 설명 줄은 수량 · 단가가 **없다** — 0 으로 접으면 합계에 0원짜리 품목으로 섞인다.
                quantity: isNote ? null : Number(row.quantity) || 0,
                unitPrice: isNote ? null : row.unitPrice,
              };
            }),
        }}
      />
    );
  }

  /**
   * 「수기 견적서 엑셀」 칸 곁의 엑셀 읽기 알림(견적서 ①b). 🔴 엑셀 전용일 때만 그린다 — 끄면
   * 아무것도 없다. 「엑셀과 다른 칸」은 그릴 때마다 **지금 폼 값**으로 다시 뽑는다 — 바꾼 칸
   * (또는 사람이 같게 고친 칸)은 저절로 목록에서 빠진다. 단추는 모두 applyExcelValue 를 탄다.
   */
  const excelConflicts =
    isExcelOnly && excelAutofill?.status === "read"
      ? planQuoteExcelAutofill(excelFormValues, excelAutofill.fields).conflicts
      : [];
  const excelAutofillLines =
    excelAutofill?.status === "failed"
      ? quoteExcelAutofillNoticeLines({ kind: "failed", reason: excelAutofill.reason, code: excelAutofill.code })
      : excelAutofill?.status === "read"
        ? quoteExcelAutofillNoticeLines({
            kind: "read",
            filled: excelAutofill.filled,
            readCount: excelAutofill.readCount,
            conflictCount: excelConflicts.length,
            warnings: excelAutofill.warnings,
          })
        : [];
  const excelAutofillPanel =
    isExcelOnly && excelAutofill !== null ? (
      <QuoteExcelAutofillNotice
        reading={excelAutofill.status === "reading"}
        lines={excelAutofillLines}
        conflicts={excelConflicts}
        disabled={disabled}
        onReplace={(change) => applyExcelValue(change)}
        onReplaceAll={() => excelConflicts.forEach((change) => applyExcelValue(change))}
        onDismiss={() => setExcelAutofill(null)}
      />
    ) : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {savedQuote ? "견적서 수정" : "새 견적서"}
        </h1>
        <div className="flex gap-2">
          {/* 🔴 **지금 화면의 값으로** 그린다 — 저장 여부와 무관하다.
              새 견적서도 저장하기 전에 어떻게 나갈지 볼 수 있어야 하고(그게
              미리보기의 본래 쓸모다), 수정 중일 때도 DB 의 옛 값이 아니라
              방금 고친 값이 보여야 한다. 예전에는 `/quotes/{id}/print` 로
              보냈는데, 그 통로는 저장된 값을 그려서 고치는 중에 누르면 화면과
              다른 문서가 나왔다. */}
          {/* 🔴 **앱 양식이 없는 종류에는 이 단추가 없다**(2026-09-16 케이블 ③). 미리보기는
              내자 · OH 양식을 그리는 화면이라, 케이블 장을 그리면 **다른 종류의 문서**가 보이고
              그대로 인쇄된다. 그 화면과 받기 통로 둘은 **서버에서도 거절한다** — 여기서 감추는
              것은 「눌러서 실패하는 단추를 두지 않는다」이지 그것이 관문인 것은 아니다.
              못 하는 일을 잠긴 단추로 두지 않는 것은 이 저장소의 규칙이다 — 「왜 안 눌리지」가 된다. */}
          {canGetDocument && (
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              미리보기 · PDF
            </button>
          )}
          {/* 파일은 저장된 장에서만 받을 수 있다 — 만드는 통로가 DB 의 그 줄을
              읽기 때문이다. 그래서 이 단추만 저장 뒤에 나타난다.
              🔴 이 화면은 수정 권한자만 들어온다(page 가 redirect) — 그래서 링크가 아니라 발행
              단추다(공유폴더 저장 · 엑셀 칸 교체, 견적서 B1c). 저장하지 않은 변경이 있으면 통로를
              부르지 않고 「먼저 [저장]」을 알린다. 저장 중 · 충돌이면 잠근다. */}
          {savedQuote && canGetDocument && (
            <QuoteIssueButton
              quoteId={savedQuote.id}
              label="견적서 받기"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
              hasUnsavedChanges={hasUnsavedChanges}
              disabled={disabled}
              showNotice={false}
              onOutcome={handleIssueOutcome}
            />
          )}
          {/* [폴더 열기](견적서 ④b) — 공유폴더의 이 견적서 폴더를 PC 의 도우미가 탐색기로 연다.
              파일을 만들지 않으므로 저장하지 않은 변경이 있어도 막지 않는다. 저장 중 · 충돌이면 잠근다.
              🔴 Windows 가 아니면 단추 자체가 없다 — 처음 렌더는 감춘 채 그린다. */}
          {savedQuote && (
            <QuoteFolderOpenButton
              quoteId={savedQuote.id}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
              disabled={disabled}
              onOutcome={setFolderOpenOutcome}
            />
          )}
          {/* 취소도 왔던 곳으로 — 수리 건에서 들어왔으면 그 건의 「견적서」 탭,
              아니면 지금까지와 같이 PO/내자 목록이다. */}
          <button
            type="button"
            onClick={() => router.push(returnHref ?? "/quotes")}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={disabled}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-primary-100 dark:text-zinc-900"
          >
            {isSubmitting ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      {/* 🔴 **지금 안 되는 일**을 말한다(2026-09-16 케이블 ③). 단추를 말없이 감추면 사람은
          화면이 고장 난 줄 안다 — 무엇이 없고 왜 없는지 한 줄로 적는다. 🔴 문장은 서버가
          거절할 때 돌려주는 것과 **같은 하나**다(domain/quote-document-support.ts) — 두 벌이면
          화면과 통로가 다른 말을 한다. */}
      {!canGetDocument && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE}
        </p>
      )}

      {/* [견적서 받기] 결과 — 단추들 바로 아래(견적서 B1c). 「먼저 [저장]」도 여기에 뜬다. */}
      {issueNotice.length > 0 && (
        <div className="flex justify-end">
          <QuoteIssueNoticeLines
            lines={issueNotice}
            className="max-w-xl rounded-md border border-zinc-200 bg-white p-3 text-right dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>
      )}

      {/* [폴더 열기] 결과 — 받기 결과와 같은 자리(머리 아래, 견적서 ④b). 도우미가 없으면 설치 파일 안내,
          있으면 「탐색기가 열리지 않았다면 [설치 파일 다시 받기]」. */}
      {folderOpenOutcome && (
        <div className="flex justify-end">
          <QuoteFolderOpenNotice
            outcome={folderOpenOutcome}
            className="max-w-xl rounded-md border border-zinc-200 bg-white p-3 text-right dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>
      )}

      {submitError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>{submitError}</p>
          {isConflict && (
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-2 rounded-md border border-red-300 px-2 py-1 text-xs dark:border-red-800"
            >
              다시 불러오기
            </button>
          )}
        </div>
      )}

      {/* 새 견적서 저장 뒤 파일 올리기 — 진행, 또는 못 올린 것(견적서는 이미 저장됐다). */}
      {attachmentNotice && (
        <div
          role="status"
          className={
            isSubmitting
              ? "rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              : "rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          }
        >
          <p>{attachmentNotice}</p>
          {createdQuote && !isSubmitting && (
            <button
              type="button"
              onClick={() => router.push(returnHref ?? "/quotes")}
              className="mt-2 rounded-md border border-amber-400 px-2 py-1 text-xs dark:border-amber-700"
            >
              목록으로
            </button>
          )}
        </div>
      )}

      {/* ── 인수번호로 불러오기 ───────────────────────────────────────────
          🔴 **케이블 견적서에는 없다**(2026-09-16 케이블 ③). 이 구역이 하는 일은 수리 건
          하나를 골라 그 장비의 값을 끌어오고 `repairCaseId` 를 잇는 것인데, 케이블 견적서는
          고칠 물건이 없는 별도 견적서다(schema/quotes.ts 의 'CABLE 은 수리품에 딸린 장이
          아니다'). 검증도 수리 건을 선택 사항으로 본다 — 이어야 할 것이 없다.

          🔴 **이미 이어져 있던 연결은 끊지 않는다** — 내자로 만들어 어느 건에 붙여 둔 장을
          케이블로 바꿔도 `repairCaseId` 는 그대로 보낸다. 끊으면 그 건의 「견적서」 탭에서
          이 장이 소리 없이 사라지고, 되돌릴 길이 화면에 없다. */}
      {!isCable && (
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">인수번호로 불러오기</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          접수 건의 고객사 · 모델명 · L/N · S/N · 신고증상을 아래 칸에 채우고, 그 건에 출고된 부품을
          참고용으로 보여 줍니다. 누르기 전에는 아무것도 바뀌지 않습니다.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={editLabelClass}>인수번호</span>
            <input
              value={intakeNumberText}
              onChange={(e) => setIntakeNumberText(e.target.value)}
              placeholder="D260706"
              className={editInputClass}
              disabled={disabled}
            />
          </label>
          <button
            type="button"
            onClick={handleLookup}
            disabled={disabled || isLookingUp}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
          >
            {isLookingUp ? "불러오는 중…" : "불러오기"}
          </button>
        </div>
        {fieldErrors.intakeNumberText && <p className={editErrorClass}>{fieldErrors.intakeNumberText}</p>}
        {lookupMessage && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{lookupMessage}</p>
        )}
        {repairCaseId && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            접수 건에 연결되어 있습니다. 아래 값을 고쳐도 그 접수 건은 바뀌지 않습니다.
          </p>
        )}
      </section>
      )}

      {/* ── 상단 정보 ───────────────────────────────────────────────────── */}
      <section className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
        {/* 종류가 첫 칸이다 — 무엇을 만드는지 정하고 나머지를 채운다.
            **O/H 대상 판정과는 별개다**: 대상품이어도 일반 견적서와 OH 견적서를
            모두 발행하므로(사용자 확인), 아래 배지는 알려 주기만 하고 이 칸을
            자동으로 바꾸지 않는다. */}
        <Field label="견적서 종류" error={fieldErrors.kind} required>
          <select
            value={kind}
            // 종류를 바꾸면 따라 일어나는 일(오버홀 규칙 · 양식 기본 목록)은 changeKind 한 곳이다 —
            // 엑셀 자동 채우기의 [엑셀 값으로 바꾸기]도 같은 함수를 부른다(견적서 ①b).
            onChange={(e) => changeKind(e.target.value as QuoteKind)}
            className={editInputClass}
            disabled={disabled}
          >
            {QUOTE_KINDS.map((value) => (
              <option key={value} value={value}>
                {quoteKindLabels[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="발행번호" error={fieldErrors.quoteNumber} required>
          <input
            value={quoteNumber}
            onChange={(e) => setQuoteNumber(e.target.value)}
            placeholder="DSS 2026-077"
            className={editInputClass}
            disabled={disabled}
          />
        </Field>
        <Field label="발행일자" error={fieldErrors.quoteDate} required>
          <input
            type="date"
            value={quoteDate}
            // 사람이 고치면 「손댐」이 켜진다 — 엑셀 자동 채우기가 그 날짜를 덮지 않는다(editQuoteDate).
            onChange={(e) => editQuoteDate(e.target.value)}
            className={editInputClass}
            disabled={disabled}
          />
        </Field>
        <Field label="공급처" error={fieldErrors.customerNameText} required>
          <input
            value={customerNameText}
            // 이름을 손으로 고치면 고객사 연결은 끊는다(editCustomerName — [엑셀 값으로 바꾸기]도 같은 길).
            onChange={(e) => editCustomerName(e.target.value)}
            placeholder="ICD Co.,Ltd"
            className={editInputClass}
            disabled={disabled}
          />
        </Field>
        <Field label="품명(건명)" error={fieldErrors.subject} required>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="RFK300FH-AD1 Bias Fwd Drop 수리 件"
            className={editInputClass}
            disabled={disabled}
          />
          {/* 종류를 OH 로 바꾸거나 모델명·신고증상을 고친 뒤 다시 지을 수
              있다. 불러오기 때 지어 준 값은 그 시점의 종류 기준이다. */}
          {suggestedSubject !== "" && suggestedSubject !== subject && (
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              <button
                type="button"
                onClick={() => setSubject(suggestedSubject)}
                disabled={disabled}
                className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-zinc-700"
              >
                자동으로 채우기
              </button>{" "}
              <span className="break-all">{suggestedSubject}</span>
            </div>
          )}
        </Field>
        {/* ── 물건 정보 — 내자 · OH 에만 있다 (2026-09-17 사용자 요청) ────────
            케이블 견적서 양식에는 모델명 · L/N · S/N · 신고증상 칸이 **없다.** 고칠 물건이
            아니라 파는 케이블을 적는 장이라 적을 자리가 없어, 케이블에서는 그리지 않는다
            (인수번호로 불러오기 구역을 접는 것과 같은 까닭이다).

            🔴 **감추기만 하고 지우지는 않는다** — 아래 작업비 구역과 일부러 다르다.
            그쪽은 감춘 값이 합계에 섞이므로 collectFields 가 비워 보내지만, 이 네 값은
            섞일 합계가 없다. 게다가 엑셀 자동 채우기가 이 칸들을 채우고
            (quote-excel-autofill 의 fills), 종류를 케이블로 바꿨다 되돌리면 적어 둔 것이
            그대로 돌아와야 한다. 그래서 상태도 저장도 한 글자도 건드리지 않았다.

            🔴 네 덩이를 하나로 묶지 않은 까닭 — 묶으면 `{!isCable && ( <>` 가 두 벌이 되어,
            작업 구역이 접히는지 원본 글자로 보는 시험(quote-edit-cable ㉡)이 작업 구역
            대신 이 덩이를 집는다. 덩이마다 조건을 붙이면 그 시험이 제자리를 가리킨다. */}
        {!isCable && (
          <Field label="모델명" error={fieldErrors.modelNameText}>
            <input value={modelNameText} onChange={(e) => setModelNameText(e.target.value)} className={editInputClass} disabled={disabled} />
          </Field>
        )}
        {!isCable && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="L/N" error={fieldErrors.lotNumberText}>
              <input value={lotNumberText} onChange={(e) => setLotNumberText(e.target.value)} className={editInputClass} disabled={disabled} />
            </Field>
            <Field label="S/N" error={fieldErrors.serialNumberText}>
              <input value={serialNumberText} onChange={(e) => setSerialNumberText(e.target.value)} className={editInputClass} disabled={disabled} />
            </Field>
          </div>
        )}
        {/* S/N 에 생산 연월이 들어 있어 O/H 4년 기준을 볼 수 있다.
            형식이 다른 S/N 이면 아무것도 그리지 않는다(domain/overhaul.ts).
            🔴 S/N 칸과 함께 접는다 — 칸이 없으면 근거가 화면에 없는 딱지가 된다. */}
        {!isCable && (
          <div className="sm:col-span-2">
            <OverhaulBadge serialNumber={serialNumberText} referenceDate={new Date()} />
          </div>
        )}
        {!isCable && (
          <div className="sm:col-span-2">
            <Field label="신고증상" error={fieldErrors.faultDescriptionText}>
              <textarea
                value={faultDescriptionText}
                onChange={(e) => setFaultDescriptionText(e.target.value)}
                className={`${editInputClass} min-h-20 resize-y`}
                disabled={disabled}
              />
            </Field>
          </div>
        )}
        <Field label="유효기간" error={fieldErrors.validity} hint="비우면 양식 문구(발행일로부터 4주)">
          <input value={validity} onChange={(e) => setValidity(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
        <Field label="납기" error={fieldErrors.delivery} hint="비우면 양식 문구(발주일로부터 3주 이내)">
          <input value={delivery} onChange={(e) => setDelivery(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
        <Field label="결재조건" error={fieldErrors.payment} hint="비우면 양식 문구(귀사 결제 조건)">
          <input value={payment} onChange={(e) => setPayment(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>

        {/* ── 특이사항 (케이블 견적서 양식 10번, 2026-09-16) ──────────────
            🔴 **케이블 견적서에만 있다** — 내자 · OH 양식에는 이 항목이 자체가 없어,
            거기서 적으면 어디에도 나가지 않는 글이 된다. 여러 줄이 들어가므로
            textarea 이고, 줄바꿈은 적은 그대로 저장된다(schema/quotes.ts 의 remarks). */}
        {isCable && (
          <div className="sm:col-span-2">
            <Field
              label="특이사항"
              error={fieldErrors.remarks}
              hint="케이블 견적서 양식의 10번 항목 · 여러 줄"
            >
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="예) 케이블 길이는 발주 시 확정합니다."
                className={`${editInputClass} min-h-20 resize-y`}
                disabled={disabled}
              />
            </Field>
          </div>
        )}

        {/* ── 엑셀 전용 (2026-09-15 Q3) ──────────────────────────────────
            켜면 아래 부품 · 작업 구역을 접고 공급가액을 손으로 받는다. 켜고 끄는 판정은
            toggleExcelOnly 한 곳 — 줄이 있으면 먼저 묻는다. */}
        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 sm:col-span-2 dark:border-zinc-800">
          <ExcelOnlySwitch checked={isExcelOnly} disabled={disabled} onToggle={(next) => toggleExcelOnly(next)} />
          {isExcelOnly && (
            <div className="max-w-md">
              <Field
                label="공급가액(부가세 별도)"
                error={fieldErrors.manualSupplyAmount}
                required
                hint="엑셀에 적은 공급가액 그대로"
              >
                {/* 세 자리마다 콤마를 붙여 보여 준다 — 들고 있는 값은 콤마 없는 그대로다. */}
                <AmountInput value={manualSupplyAmount} onValueChange={setManualSupplyAmount} placeholder="0" className={editInputClass} disabled={disabled} />
              </Field>
            </div>
          )}
          {/* 접힌 구역의 오류 — 줄이 남아 서버가 거절했으면 여기에 보인다(그 자리는 접혀 있다). */}
          {isExcelOnly &&
            [fieldErrors.items, fieldErrors.workScopeLines, fieldErrors.repairTasks]
              .filter((message): message is string => Boolean(message))
              .map((message) => (
                <p key={message} className={editErrorClass}>
                  {message}
                </p>
              ))}
        </div>
      </section>

      {/* ── 견적서 파일(결재 PDF · 수기 엑셀) ─────────────────────────────
          상단 정보 바로 아래. 수정 화면에서는 [저장]과 따로 곧바로 반영되고, 새 견적서는
          [저장] 뒤에 올라간다(QuoteAttachmentsSection.tsx 머리말). */}
      <QuoteAttachmentsSection
        controller={attachments}
        isExcelOnly={isExcelOnly}
        disabled={disabled}
        excelSlotDetails={excelAutofillPanel}
      />

      {/* ── 엑셀 전용이면 부품 · 작업 구역을 접는다 (2026-09-15 Q3) ──────
          줄은 켤 때 비웠고(저장 전에 끄면 돌아온다), 금액은 위의 공급가액 칸이 받는다.
          아래 세 구역(O/H 템플릿 · 출고된 부품 · 부품 비용과 그 안의 수리 작업 · 작업
          내역 · 작업비)은 들여쓰기를 바꾸지 않고 이 조건으로만 감쌌다. */}
      {isExcelOnly ? (
        <section className="rounded-lg border border-dashed border-zinc-300 p-4 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <p>
            엑셀 전용 견적서 — 부품 · 수리 작업 · 작업 내역 · 작업비 구역을 접었습니다. 금액은 위의 공급가액이고,
            [견적서 받기]는 「수기 견적서 엑셀」 칸의 파일을 내려줍니다.
          </p>
          {excelOnlyStash !== null && (
            <p className="mt-1">켤 때 비운 줄은 저장하기 전에 엑셀 전용을 끄면 그대로 돌아옵니다.</p>
          )}
        </section>
      ) : (
      <>
      {/* ── O/H 템플릿 부품──────────────────────────────────────────────
          🔴 **O/H 견적은 부품을 출고하기 전에 낸다**(2026-08-31 사용자 확인).
          얼마에 할지를 먼저 알려 주고 승인을 받은 뒤에 뜯기 시작하므로, 그 시점에
          아래 「출고된 부품」은 비어 있는 것이 정상이다. 청구할 부품은 이 기종의
          O/H 템플릿이 답한다.

          O/H 견적서일 때만 그린다. 내자 견적서에는 이 칸 자체가 없다. */}
      {kind === "OVERHAUL" && (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/40">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            O/H 부품 템플릿
            {ohTemplateCode && (
              <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                기종 {ohTemplateCode}
              </span>
            )}
          </h2>
          {ohTemplateParts.length === 0 ? (
            // 못 담는 이유가 셋이고 **고쳐야 할 자리가 다 다르다.** 한 문장으로
            // 뭉치면 사람이 어디로 가야 하는지 알 수 없다.
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {repairCaseId === null
                ? "인수번호를 먼저 불러오면 그 장비의 기종에 맞는 O/H 부품을 여기서 담을 수 있습니다."
                : ohTemplateCode === null
                  ? "이 장비의 제품 모델에 O/H 부품 템플릿이 이어져 있지 않습니다 — 재고 관리 › O/H 부품 템플릿에서 모델을 이어 주세요."
                  : `기종 ${ohTemplateCode} 템플릿에 담긴 부품이 없습니다 — 재고 관리 › O/H 부품 템플릿에서 부품을 넣어 주세요.`}
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                단가는 <b>O/H 템플릿에 적어 둔 값</b>이 따라옵니다 — 출고된 부품이 부품 상세의 단가를 쓰는
                것과 다릅니다. 담은 줄은 견적서의 <b>2) OH 부품 비용</b> 칸으로 갑니다.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => addOhTemplateParts(unaddedOhTemplateParts)}
                  disabled={disabled || unaddedOhTemplateParts.length === 0}
                  className="rounded border border-sky-500 bg-white px-2 py-1 text-xs font-medium text-sky-900 disabled:opacity-50 dark:border-sky-600 dark:bg-zinc-900 dark:text-sky-200"
                >
                  {unaddedOhTemplateParts.length === 0
                    ? "전부 담았습니다"
                    : `O/H 템플릿에서 불러오기 (${unaddedOhTemplateParts.length}종)`}
                </button>
                <span className="text-xs text-zinc-600 dark:text-zinc-300">
                  이미 담은 것은 건너뜁니다. 담은 뒤에도 줄마다 고치거나 지울 수 있습니다.
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {ohTemplateParts.map((part, index) => {
                  const added = addedSourceKeys.has(ohTemplatePartKey(index));
                  return (
                    <li key={ohTemplatePartKey(index)} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-zinc-800 dark:text-zinc-200">{part.partNameText}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{part.quantity}개</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {isPriceUnset(part.overhaulUnitPrice) ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            {part.partId === null
                              ? "재고 미연결 — O/H 단가 없음"
                              : "O/H 단가 미정"}
                          </span>
                        ) : (
                          `O/H 단가 ₩${AMOUNT_FORMAT.format(Number(part.overhaulUnitPrice))}`
                        )}
                      </span>
                      {added ? (
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">담김 ✓</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addOhTemplateParts([{ part, index }])}
                          disabled={disabled}
                          className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-zinc-700"
                        >
                          부품 줄에 담기
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ── 사용한 부품 (참고) ────────────────────────────────────────────
          🔴 케이블 견적서에는 그리지 않는다 — 출고된 부품은 수리 건에 딸린 값이고, 그
          종류에는 수리 건이 없다. (내자로 불러온 뒤 종류만 바꾼 장에서도 감춘다.) */}
      {!isCable && usedParts.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            이 접수 건에 출고된 부품 <span className="font-normal text-zinc-500 dark:text-zinc-400">(참고용)</span>
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
            재고에서 나간 것과 청구하는 것이 늘 같지는 않습니다. 담을 것만 골라 주세요. 단가는 재고 관리에
            부품마다 적어 둔 값이 따라오고, 정해 두지 않았으면 빈칸으로 들어옵니다.
          </p>
          {/* 일괄 담기. 출고된 부품이 열 종을 넘는 일이 흔한데 하나씩 누르게
              두면 사람이 중간에 하나를 빠뜨리고, 빠뜨린 것은 청구에서 통째로
              사라진다. **이미 담은 것은 건너뛴다** — 두 번 담기면 청구가 두 배가
              되고 화면만 봐서는 실수인지 뜻인지 구별되지 않는다. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => addUsedParts(unaddedUsedParts)}
              disabled={disabled || unaddedUsedParts.length === 0}
              className="rounded border border-zinc-400 bg-white px-2 py-1 text-xs font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {unaddedUsedParts.length === 0
                ? "전부 담았습니다"
                : `출고된 부품 ${unaddedUsedParts.length}종 전부 담기`}
            </button>
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              담은 뒤에도 줄마다 고치거나 지울 수 있습니다.
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {usedParts.map((part) => {
              const added = addedSourceKeys.has(usedPartKey(part));
              return (
              <li key={usedPartKey(part)} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-zinc-800 dark:text-zinc-200">{part.partName}</span>
                {part.partSpec && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{part.partSpec}</span>
                )}
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {stockOwnerLabelOrUnspecified(part.owner)} · {part.quantity}개 출고
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {isPriceUnset(part.unitPrice) ? (
                    <span className="text-amber-700 dark:text-amber-400">단가 미정</span>
                  ) : (
                    `단가 ₩${AMOUNT_FORMAT.format(Number(part.unitPrice))}`
                  )}
                </span>
                {added ? (
                  // 담긴 줄은 단추를 없앤다. 회색으로 잠가 두기만 하면 "왜 안
                  // 눌리지" 가 되고, 그건 이 저장소가 이미 한 번 겪은 고장 신고다.
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">담김 ✓</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => addUsedParts([part])}
                    disabled={disabled}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-zinc-700"
                  >
                    부품 줄에 담기
                  </button>
                )}
              </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── 부품 줄 ───────────────────────────────────────────────────────
          케이블 견적서에서는 이 표가 **품목 표 전체**다 — 그 양식에는 작업비 구역이
          없고(아래 세 구역을 접는다), 칸이 하나 더 많으며(규격), 금액 없는 설명 줄이 낀다. */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {isCable ? "품목" : "부품 비용"}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* 🔴 설명 줄은 **따로 더한다** — 줄마다 종류를 바꾸는 스위치를 두지 않았다.
                바꾸는 순간 이미 적어 둔 수량 · 단가를 어떻게 할지(지울지, 숨긴 채 들고
                있을지) 정해야 하는데, 숨긴 채 들고 있으면 DB 가 거절하고 지우면 되돌릴
                길이 없다. 더하고 지우는 두 길만 두면 그 물음이 생기지 않는다. */}
            {isCable && (
              <button
                type="button"
                onClick={() => addNoteRowAtTop(emptyNoteItem())}
                disabled={disabled || itemLinesFull}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
              >
                + 설명 줄 추가
              </button>
            )}
            <button
              type="button"
              onClick={() => addItemRow(emptyItem())}
              disabled={disabled || itemLinesFull}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
            >
              {isCable ? "+ 품목 추가" : "+ 부품 추가"}
            </button>
          </div>
        </div>

        {/* 찾아 고르는 길이 생긴 것을 칸만 보고는 알 수 없다 — 지금까지 자유 글자였기
            때문이다. 손으로 적는 길이 그대로라는 것도 함께 적는다. */}
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
          품명 칸에 글자를 치면 재고의 부품을 <b>품명 / 품명2 / 도번 / 교산 품번</b>으로 찾아
          고를 수 있습니다. 고르면 그 줄이 재고의 부품과 이어지고, 이름을 손으로 고치면 이어짐이
          풀립니다 — 재고에 없는 {isCable ? "품목" : "부품"}은 지금처럼 그냥 적으면 됩니다.
        </p>

        {kind === "OVERHAUL" && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            <b>OH</b> 를 체크한 줄은 양식의 <b>2) OH 부품 비용</b> 칸으로, 체크하지 않은 줄은
            <b> 1) 부품 비용</b> 칸으로 갑니다. 두 칸 모두 담을 만큼 줄이 늘어납니다.
          </p>
        )}

        {isCable && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            품목 줄과 설명 줄을 합쳐 <b>{cableMaxLines}줄</b>까지 넣을 수 있습니다 — 양식의 품목
            자리가 그만큼입니다. 설명 줄은 글자만 적히고 <b>합계에 들어가지 않습니다</b>. 적어 둔
            차례가 그대로 문서의 차례입니다. [+ 설명 줄 추가]는 <b>언제나 맨 위</b>에
            들어갑니다 — 밑에 오는 품목들의 머리글이기 때문입니다.
          </p>
        )}
        {/* 🔴 상한에 닿으면 **까닭을 적는다.** 단추만 잠가 두면 「왜 안 눌리지」가 된다. */}
        {isCable && itemLinesFull && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            줄이 {cableMaxLines}줄을 다 찼습니다 — 케이블 견적서 양식에 더 넣을 자리가 없습니다.
            줄을 지우거나 견적서를 나눠 주세요.
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {items.map((row, index) =>
            /**
             * 🔴 설명 줄에는 **수량 · 단가 칸이 없다.** 잠가 두는 것이 아니라 아예 그리지
             * 않는다 — 잠가 두면 이미 적혀 있던 값이 그대로 실려 가고, DB 가 그 줄을
             * 거절한다(CHECK quote_items_amounts_item_line_only).
             */
            row.lineKind === "NOTE" ? (
              <div key={row.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto]">
                <span className="self-center rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  설명 줄
                </span>
                <div>
                  <input
                    value={row.partNameText}
                    onChange={(e) => updateItem(row.key, { partNameText: e.target.value })}
                    placeholder="* 20kW RFG 부속케이블 Parts 3종"
                    aria-label={`${lineOrdinals[index]}번째 설명 줄`}
                    className={editInputClass}
                    disabled={disabled}
                  />
                  {fieldErrors[`items.${index}.partNameText`] && (
                    <p className={editErrorClass}>{fieldErrors[`items.${index}.partNameText`]}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(row.key)}
                  disabled={disabled}
                  aria-label={`${lineOrdinals[index]}번째 설명 줄 지우기`}
                  className="rounded-md border border-zinc-300 px-2 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
                >
                  ×
                </button>
              </div>
            ) : (
            <div
              key={row.key}
              className={`grid grid-cols-1 gap-2 ${
                isCable
                  ? "sm:grid-cols-[1fr_1fr_5rem_8rem_auto]"
                  : kind === "OVERHAUL"
                    ? "sm:grid-cols-[1fr_5rem_8rem_auto_auto]"
                    : "sm:grid-cols-[1fr_5rem_8rem_auto]"
              }`}
            >
              {/* 🔴 `relative` — 부품 후보 목록이 이 칸 **바로 밑에 떠야** 한다. 흐름 안에
                  두면 목록이 뜰 때마다 밑의 줄들이 통째로 밀려 내려가, 고르려던 자리가
                  눈앞에서 움직인다. */}
              <div className="relative">
                <input
                  value={row.partNameText}
                  /**
                   * 🔴 글자를 치면 재고 연결을 **푼다**(partId: null). 고른 뒤 이름만 고쳤는데
                   * part_id 가 남아 있으면 화면의 글자와 통계가 세는 부품이 서로 다른 것을
                   * 가리킨다. 마스터에 없는 부품을 손으로 적는 길이 그대로 남는 까닭이기도
                   * 하다 — 고르면 붙고, 고쳐 쓰면 풀린다.
                   */
                  onChange={(e) => {
                    updateItem(row.key, { partNameText: e.target.value, partId: null });
                    setPartPickerKey(row.key);
                  }}
                  onFocus={() => setPartPickerKey(row.key)}
                  /* 다른 줄을 이미 펴 두었으면 그것을 닫지 않는다 — 닫는 것은 제 줄뿐이다. */
                  onBlur={() => setPartPickerKey((prev) => (prev === row.key ? null : prev))}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setPartPickerKey(null);
                  }}
                  placeholder={`${lineOrdinals[index]}번째 ${isCable ? "품목 품명" : "부품 품명"}`}
                  className={editInputClass}
                  disabled={disabled}
                  /* 브라우저가 제 기억으로 만든 목록이 부품 후보 위에 겹쳐 뜨지 않게. */
                  autoComplete="off"
                />
                {partPickerKey === row.key && !disabled && (
                  <QuotePartSuggestionList
                    options={filterPartOptions(partOptions, row.partNameText)}
                    listLabel={`${lineOrdinals[index]}번째 ${isCable ? "품목" : "부품"} 후보`}
                    /**
                     * 🔴 고르면 **단가도 함께** 채운다(2026-09-17 사용자 요청). 규칙은 전부
                     * 고르개 쪽에 있다(quote-part-picker.tsx 의 partPickUnitPrice) — 여기서는
                     * 그 판단에 필요한 세 가지를 건넨다:
                     *
                     *  · `prices` — 단가가 적힌 부품들(페이지가 한 번 실어 보낸 그 목록)
                     *  · `isOverhaulPart` — 🔴 **`2) OH 부품 비용` 칸으로 갈 줄일 때만** true 다.
                     *    OH 표시는 O/H 견적서에만 그리고, 저장도 그때만 싣는다(collectFields 의
                     *    같은 식) — 종류를 바꿔 표시가 사라진 줄은 일반 단가로 청구된다.
                     *  · `currentUnitPrice` — 적혀 있으면 덮지 않는다(사람이 조정해 둔 금액이다)
                     */
                    onPick={(option) => {
                      updateItem(
                        row.key,
                        partPickPatch(option, {
                          prices: partPrices,
                          isOverhaulPart: kind === "OVERHAUL" && row.isOverhaulPart,
                          currentUnitPrice: row.unitPrice,
                        })
                      );
                      setPartPickerKey(null);
                    }}
                  />
                )}
                {fieldErrors[`items.${index}.partNameText`] && (
                  <p className={editErrorClass}>{fieldErrors[`items.${index}.partNameText`]}</p>
                )}
              </div>
              {/* 🔴 규격 칸은 **케이블 견적서에만** 있다 — 내자 · OH 양식에는 그 칸이 없어,
                  거기서 적으면 어디에도 안 나가는 값이 된다(저장도 하지 않는다 — collectFields). */}
              {isCable && (
                <div>
                  <input
                    value={row.partSpecText}
                    onChange={(e) => updateItem(row.key, { partSpecText: e.target.value })}
                    placeholder="규격 (없으면 비워 두세요)"
                    aria-label={`${lineOrdinals[index]}번째 품목 규격`}
                    className={editInputClass}
                    disabled={disabled}
                  />
                  {fieldErrors[`items.${index}.partSpecText`] && (
                    <p className={editErrorClass}>{fieldErrors[`items.${index}.partSpecText`]}</p>
                  )}
                </div>
              )}
              <div>
                <input
                  value={row.quantity}
                  onChange={(e) => updateItem(row.key, { quantity: e.target.value })}
                  inputMode="numeric"
                  aria-label={`${lineOrdinals[index]}번째 ${isCable ? "품목" : "부품"} 수량`}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`items.${index}.quantity`] && (
                  <p className={editErrorClass}>{fieldErrors[`items.${index}.quantity`]}</p>
                )}
              </div>
              <div>
                {/* 세 자리마다 콤마를 붙여 보여 준다 — 들고 있는 값은 콤마 없는 그대로다
                    (common/AmountInput.tsx). */}
                <AmountInput
                  value={row.unitPrice}
                  onValueChange={(raw) => updateItem(row.key, { unitPrice: raw })}
                  placeholder="단가"
                  aria-label={`${lineOrdinals[index]}번째 ${isCable ? "품목" : "부품"} 단가`}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`items.${index}.unitPrice`] && (
                  <p className={editErrorClass}>{fieldErrors[`items.${index}.unitPrice`]}</p>
                )}
              </div>
              {kind === "OVERHAUL" && (
                <label className="flex items-center gap-1 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={row.isOverhaulPart}
                    onChange={(e) => updateItem(row.key, { isOverhaulPart: e.target.checked })}
                    disabled={disabled}
                  />
                  OH
                </label>
              )}
              <button
                type="button"
                onClick={() => removeItem(row.key)}
                disabled={disabled}
                aria-label={`${lineOrdinals[index]}번째 ${isCable ? "품목" : "부품"} 줄 지우기`}
                className="rounded-md border border-zinc-300 px-2 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
              >
                ×
              </button>
            </div>
            )
          )}
        </div>
        {fieldErrors.items && <p className={editErrorClass}>{fieldErrors.items}</p>}

        {/* ── 🔴 케이블이면 여기부터 세 구역을 접는다 (2026-09-16 케이블 ③) ──
            수리 작업 목록 · 세 가지 제외 · 작업 내역(조사 · 수리 · 통전) · 작업비 —
            케이블 양식에는 그 구역이 하나도 없다(xlsx/cable-quote-template.ts 머리말의
            '작업 범위 구역이 없다'). 엑셀 전용이 부품 · 작업 구역을 접는 것과 같은 방식이고,
            아래 세 덩이는 **들여쓰기를 바꾸지 않고** 이 조건으로만 감쌌다.

            🔴 접기만 하면 모자라다 — 감춘 값이 저장에 실리지 않게 collectFields 가
            비워 보낸다(그 함수의 '작업 값 일곱을 비워 보낸다'). 상태는 그대로 두므로
            종류를 되돌리면 적어 둔 것이 그대로 돌아온다. */}
        {!isCable && (
        <>

        {/* ── 수리 작업 목록 ─────────────────────────────────────────────
            🔴 **작업비는 부품이 아니라 '작업'에 붙는다**(2026-08-31 사용자 정정).
            여기서 고른 작업들이 `기본 작업비 + Σ(공수시간 × 시간당 단가)` 로
            작업비를 만든다. 오버홀도 이 목록의 한 줄이다. */}
        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">수리 작업 목록</span>
            <select
              value={laborKind ?? ""}
              onChange={(e) => {
                const next = (e.target.value || null) as WorkflowKind | null;
                setLaborKind(next);
                applyOverhaulRule(kind, next);
                fillScopeFromTemplate(kind, next);
              }}
              disabled={disabled}
              aria-label="작업 목록의 장비 종류"
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">장비 종류를 고르세요…</option>
              {repairLabor.map((row) => (
                <option key={row.equipmentKind} value={row.equipmentKind}>
                  {workflowKindLabels[row.equipmentKind]} ({row.tasks.length}건)
                </option>
              ))}
            </select>

            {/* ── 통전작업 제외 ─────────────────────────────────────────
                🔴 기본 작업비 안에 **통전작업 몫이 이미 들어 있다**(2026-09-04
                사용자: 350만원 중 14시간 = 140만원). 켜면 그 몫이 빠져 210만원이
                되고, 문서에서도 「③ 통전검사」 구역이 사라진다 — 하지 않은
                시험을 했다고 적어 보내지 않기 위해서다. */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={powerTestExcluded}
                onChange={(e) => setPowerTestExcluded(e.target.checked)}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-zinc-800 dark:text-zinc-200">통전작업 제외</span>
            </label>
            {/* ── 조사작업 제외 (2026-09-15 사용자 결정) ──────────────────────
                🔴 켜면 문서에서 「① 조사작업」 구역이 빠지고, 기본 작업비 중 **조사작업 몫(기본
                작업비 − 통전작업 몫)**이 작업비 계산에서 빠진다. 기본 작업비 = 조사 몫 + 통전 몫
                이라 둘을 함께 켜면 두 몫이 다 빠진다(domain/quote-labor-cost.ts). 조사 칸의 마지막
                줄을 지우면 저절로 켜진다. */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={investigationExcluded}
                onChange={(e) => toggleInvestigationExcluded(e.target.checked)}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-zinc-800 dark:text-zinc-200">조사작업 제외</span>
            </label>
            {/* ── 서류작업 제외 (2026-09-16 사용자 결정) ──────────────────────
                🔴 **문서는 이것에 반응하지 않는다.** 견적서의 구역은 조사 · 수리 · 통전
                셋뿐이라 서류작업은 적히는 자리가 없다 — 옆의 「조사작업 제외」가 문서에서
                「① 조사작업」까지 빼는 것과 다르다. 그래서 **금액만** 빠진다는 것을 곁말로
                적는다: 이 한 줄이 없으면 조사와 같은 일을 한다고 읽는다. */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={documentExcluded}
                onChange={(e) => setDocumentExcluded(e.target.checked)}
                disabled={disabled}
                className="h-4 w-4"
              />
              <span className="text-zinc-800 dark:text-zinc-200">서류작업 제외</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                (견적서에는 서류작업 항목이 없어 금액만 빠집니다)
              </span>
            </label>
          </div>

          {activeLabor === null ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              장비 종류를 고르면 그 장비의 수리 작업 목록이 나옵니다. 고른 작업으로 작업비가 계산됩니다.
            </p>
          ) : (
            <>
              {/* 🔴 작업 목록이 비어 있어도 계산 내역은 그린다 — T/C 가 그렇다.
                  목록이 없다고 셈까지 숨기면, 통전작업 제외를 켰는데 왜 금액이
                  그대로인지(통전 공수시간을 아직 안 정했다) 말할 자리가 없다. */}
              {activeLabor.tasks.length === 0 ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {workflowKindLabels[activeLabor.equipmentKind]}의 작업 목록이 아직 없습니다 —
                  [PO/내자] › 수리 작업 비용에서 넣어 주세요.
                </p>
              ) : (
                <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {activeLabor.tasks.map((task) => {
                    const quantity = repairTaskQuantityOf(taskQuantities, task.id);
                    const checked = quantity > 0;
                    return (
                      <li key={task.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = setRepairTaskChecked(taskQuantities, task.id, e.target.checked);
                              setTaskQuantities(next);
                              // 고른 작업이 곧 문서의 「2) 수리작업」이다
                              // (손대지 않았을 때만 따라간다).
                              fillRepairScopeFrom(taskNamesOf(activeLabor, next));
                            }}
                            disabled={disabled}
                            className="h-4 w-4"
                          />
                          <span className="text-zinc-800 dark:text-zinc-200">{task.taskName}</span>
                          {/* 오버홀 줄임을 표시한다 — 견적서 종류를 바꾸면 이 줄이
                              저절로 움직이는데, 어느 줄인지 안 보이면 사람은 자기가
                              체크한 것이 왜 풀렸는지 알 수 없다. */}
                          {task.isOverhaul && (
                            <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                              O/H
                            </span>
                          )}
                          {/* 수량이 2 이상이면 그 줄이 실제로 더하는 금액을 보인다 —
                              합계만 늘고 줄의 금액이 그대로면 어디서 늘었는지 모른다. */}
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {task.hours}시간 ·{" "}
                            <span className="tabular-nums">
                              {formatAmount(task.hours * Number(activeLabor.hourlyRate) * Math.max(quantity, 1))}
                            </span>
                          </span>
                        </label>
                        {/* ── 수량 ─────────────────────────────────────────
                            같은 작업을 여러 번 더한다(2026-09-11). **체크된 작업에만**
                            보인다. − 로 0 이 되지 않는다 — 빼려면 체크를 푼다.
                            🔴 수량은 작업비에만 들어가고 「2) 수리작업」 문구는 그대로라,
                            여기서는 그 칸을 다시 채우지 않는다. */}
                        {checked && (
                          <span
                            role="group"
                            aria-label={`${task.taskName} 수량`}
                            className="inline-flex items-center rounded-md border border-zinc-300 text-xs dark:border-zinc-700"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setTaskQuantities(setRepairTaskQuantity(taskQuantities, task.id, quantity - 1))
                              }
                              disabled={disabled || quantity <= MIN_REPAIR_TASK_QUANTITY}
                              aria-label={`${task.taskName} 수량 줄이기`}
                              className="px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              −
                            </button>
                            <span
                              aria-live="polite"
                              className="min-w-[1.75rem] border-x border-zinc-300 px-1 text-center tabular-nums text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                            >
                              {quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setTaskQuantities(setRepairTaskQuantity(taskQuantities, task.id, quantity + 1))
                              }
                              disabled={disabled || quantity >= MAX_REPAIR_TASK_QUANTITY}
                              aria-label={`${task.taskName} 수량 늘리기`}
                              className="px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              +
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* 🔴 식을 그대로 보여 준다. 합계 하나만 보이면 "왜 이 숫자지"에
                  답할 것이 없고, 기본 작업비가 더해진 것도 드러나지 않는다.
                  통전작업 제외도 마찬가지다 — **뺀 금액을 눈에 보이게 적는다.**
                  「고른 작업 N건」은 **줄 수**다 — 같은 작업을 두 번 더했으면 2건이다. */}
              <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300">
                기본 작업비{" "}
                {laborSuggestion.baseCost === null ? (
                  <b className="text-amber-700 dark:text-amber-400">정하지 않음</b>
                ) : (
                  <b className="tabular-nums">{formatAmount(laborSuggestion.baseCost)}</b>
                )}{" "}
                {/* 🔴 뺀 몫과 까닭을 말한다 — 이유 없이 금액만 작아지면 사람은 계산이 틀린 줄 안다.
                    기본 작업비에서 조사 몫만 빠진다(통전 몫은 남는다 — 통전 차감은 아래에 따로다). */}
                {investigationDeduction !== null && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">− 조사작업 몫</span>{" "}
                    <b className="tabular-nums text-amber-700 dark:text-amber-400">
                      {formatAmount(investigationDeduction)}
                    </b>
                    <span className="text-zinc-500 dark:text-zinc-400">(조사작업 제외)</span>{" "}
                  </>
                )}
                {/* 서류 몫도 기본 작업비의 한 조각이라 같은 자리에 같은 모양으로 적는다 —
                    빠진 것은 금액뿐이고 문서는 그대로다. */}
                {documentDeduction !== null && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">− 서류작업 몫</span>{" "}
                    <b className="tabular-nums text-amber-700 dark:text-amber-400">
                      {formatAmount(documentDeduction)}
                    </b>
                    <span className="text-zinc-500 dark:text-zinc-400">(서류작업 제외)</span>{" "}
                  </>
                )}
                + 고른 작업 {selectedTasks.length}건{" "}
                <b className="tabular-nums">{formatAmount(laborSuggestion.tasksTotal)}</b>{" "}
                {powerTestDeduction !== null && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-400">· 통전작업 제외</span>{" "}
                    <b className="tabular-nums text-amber-700 dark:text-amber-400">
                      −{formatAmount(powerTestDeduction)}
                    </b>{" "}
                  </>
                )}
                ={" "}
                <b className="tabular-nums text-zinc-900 dark:text-zinc-50">
                  {formatAmount(laborSuggestion.total)}
                </b>
              </p>
              {laborSuggestion.baseCost === null && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {workflowKindLabels[activeLabor.equipmentKind]}의 조사·통전·서류 공수시간을 하나도 정하지
                  않아 기본 작업비가 합계에 더해지지 않았습니다 — [PO/내자] › 수리 작업 비용에서 적어
                  주세요.
                </p>
              )}
              {/* 🔴 못 뺐으면 못 뺐다고 말한다. 조용히 두면 사람은 210만원이
                  나온 줄 알고 그대로 고객사에 보낸다. 세 갈래가 저마다 제 공수시간을
                  보므로 까닭도 갈래마다 따로다(domain/quote-labor-cost.ts). */}
              {laborSuggestion.powerTestNotice === "NO_HOURS" && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {workflowKindLabels[activeLabor.equipmentKind]}의 통전 공수시간을 먼저 정해 주세요 —
                  정하기 전까지는 통전작업 몫을 빼지 않습니다([PO/내자] › 작업 비용 › 통전 작업 비용).
                </p>
              )}
              {laborSuggestion.powerTestNotice === "UNKNOWN_HOURLY_RATE" && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  시간당 작업비를 읽지 못해 통전작업 몫을 빼지 않았습니다 — [PO/내자] › 작업 비용에서
                  확인해 주세요.
                </p>
              )}
              {/* 🔴 조사작업 몫도 같다 — 조사 공수시간을 모르면 뺄 금액을 모른다.
                  예전에는 「기본 작업비 − 통전 몫」이라 통전 쪽을 함께 봐야 했지만,
                  이제 조사 몫은 제 공수시간 하나로 정해진다. */}
              {laborSuggestion.investigationNotice === "NO_HOURS" && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {workflowKindLabels[activeLabor.equipmentKind]}의 조사 공수시간을 먼저 정해 주세요 —
                  정하기 전까지는 조사작업 몫을 빼지 않습니다([PO/내자] › 작업 비용 › 조사 작업 비용).
                </p>
              )}
              {laborSuggestion.investigationNotice === "UNKNOWN_HOURLY_RATE" && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  시간당 작업비를 읽지 못해 조사작업 몫을 빼지 않았습니다 — [PO/내자] › 작업 비용에서
                  확인해 주세요.
                </p>
              )}
              {/* 🔴 서류작업 몫도 같다. 지금 세 장비 모두 서류 공수시간이 비어 있어 **이 안내가
                  실제로 뜨는 자리**다 — 켰는데 합계가 그대로인 까닭을 여기서만 말한다. */}
              {laborSuggestion.documentNotice === "NO_HOURS" && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {workflowKindLabels[activeLabor.equipmentKind]}의 서류 공수시간을 먼저 정해 주세요 —
                  정하기 전까지는 서류작업 몫을 빼지 않습니다([PO/내자] › 작업 비용 › 서류 작업 비용).
                </p>
              )}
              {laborSuggestion.documentNotice === "UNKNOWN_HOURLY_RATE" && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  시간당 작업비를 읽지 못해 서류작업 몫을 빼지 않았습니다 — [PO/내자] › 작업 비용에서
                  확인해 주세요.
                </p>
              )}
              {laborSuggestion.unknown.length > 0 && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  값을 읽지 못해 합계에서 빠진 작업이 있습니다: {laborSuggestion.unknown.join(", ")}
                </p>
              )}
            </>
          )}
        </div>

        {/* ── 작업 내역 ───────────────────────────────────────────────────
            견적서의 `2. 작업 비용` 아래에 세 묶음으로 적히는 글이다.
            조사·통전은 양식의 기본 목록에서, 수리는 위에서 고른 작업에서
            채워지고, 셋 다 사람이 고치거나 줄을 더할 수 있다.

            양식 넷 모두 이 구역이 있다 — 머리글만 다르다(매쳐는 `조사작업`,
            제너레이터는 `인수 조사`·`통전검사[출하검사]`). 비워 두면 그 양식의
            기본 목록이 그대로 문서에 적혀 나간다. */}
        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">작업 내역</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              견적서의 <b>2. 작업 비용</b> 아래에 적힙니다
            </span>
          </div>

          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            {QUOTE_WORK_SCOPE_SECTIONS.map((section) => {
              const rows = scopeLines[section];
              const templateDefaults =
                workScopeDefaults[quoteTemplateKey(laborKind, kind)]?.[section]?.items ?? [];
              /**
               * 문서에 나가지 않는 칸인가 — 「통전작업 제외」를 켜면 「3) 통전작업」이
               * 그렇다. 판정은 xlsx 생성기와 같은 규칙이다(domain/quote-work-scope-
               * suppression.ts). 줄이 떠 있으면 사람은 견적서에 나가는 줄로 읽는다.
               *
               * 🔴 **그리기만 감춘다.** scopeLines·scopeTouched 는 건드리지 않는다 —
               * 체크를 풀면 손으로 고쳐 둔 줄까지 그대로 돌아와야 하고, 저장하는
               * 값도 지금과 같다(collectFields 의 workScopeLines). 칸 제목은 남긴다 —
               * 칸이 통째로 사라지면 어디 갔는지 모른다.
               */
              // 「조사작업 제외」를 켜면 「1) 조사작업」도 감춘다 — 체크를 풀면 되돌아오므로 통전과
              // 같다(예전에는 되돌리는 체크 상자가 없어 감추지 않고 칸 안에 안내를 띄웠다).
              const suppressed = isWorkScopeSectionSuppressed(section, {
                powerTestExcluded,
                repairSectionDropped,
                investigationExcluded,
              });
              return (
                <div key={section} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={editLabelClass}>
                      {QUOTE_WORK_SCOPE_SECTIONS.indexOf(section) + 1}){" "}
                      {quoteWorkScopeSectionLabels[section]}
                    </span>
                    {/* 다시 맞추는 길을 열어 둔다 — 손댄 뒤로는 자동으로 따라가지
                        않으므로, 되돌리고 싶을 때 누를 곳이 없으면 사람이 손으로
                        지우고 다시 적게 된다. 감춘 칸에는 두지 않는다. */}
                    {suppressed ? null : section === "REPAIR" ? (
                      <button
                        type="button"
                        onClick={() =>
                          fillRepairScopeFrom(
                            activeLabor ? taskNamesOf(activeLabor, taskQuantities) : [],
                            true
                          )
                        }
                        disabled={disabled || activeLabor === null}
                        className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] disabled:opacity-50 dark:border-zinc-700"
                      >
                        고른 작업으로
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => resetScopeToTemplate(section)}
                        disabled={disabled || templateDefaults.length === 0}
                        className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] disabled:opacity-50 dark:border-zinc-700"
                      >
                        양식 기본값으로
                      </button>
                    )}
                  </div>

                  {suppressed ? (
                    <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {SUPPRESSED_SCOPE_NOTICES[section]}
                    </p>
                  ) : (
                    <>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {rows.map((row, index) => (
                          <div key={row.key} className="flex items-center gap-1.5">
                            <span className="text-xs text-zinc-400">-</span>
                            <input
                              value={row.text}
                              onChange={(e) =>
                                editScope(
                                  section,
                                  rows.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r))
                                )
                              }
                              aria-label={`${quoteWorkScopeSectionLabels[section]} ${index + 1}번째 줄`}
                              className={editInputClass}
                              disabled={disabled}
                            />
                            <button
                              type="button"
                              onClick={() => removeScopeRow(section, rows, row)}
                              disabled={disabled}
                              aria-label={`${quoteWorkScopeSectionLabels[section]} ${index + 1}번째 줄 지우기`}
                              className="rounded border border-zinc-300 px-1.5 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {rows.length === 0 && (
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            아직 없습니다. 아래에서 줄을 더하세요.
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          editScope(section, [...rows, { key: generateClientUuid(), text: "" }])
                        }
                        disabled={disabled}
                        className="mt-2 rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
                      >
                        + 줄 추가
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 max-w-md">
          <Field
            label="작업비"
            error={fieldErrors.workCost}
            hint="기본 작업비 + 고른 작업(공수시간 × 시간당 단가)"
          >
            {/* 세 자리마다 콤마를 붙여 보여 준다 — 들고 있는 값은 콤마 없는 그대로다. */}
            <AmountInput value={workCost} onValueChange={setWorkCost} className={editInputClass} disabled={disabled} />
          </Field>
          {/* 작업 목록이 비어 있는 장비(T/C)에서도 적용할 것이 있다 — 기본
              작업비와 통전작업 제외가 그것이다. */}
          {activeLabor !== null && (
            <button
              type="button"
              onClick={() => setWorkCost(String(laborSuggestion.total))}
              disabled={disabled}
              className="mt-2 rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-zinc-700"
            >
              계산한 작업비 적용 ({formatAmount(laborSuggestion.total)})
            </button>
          )}
        </div>

        </>
        )}
      </section>
      </>
      )}

      {/* ── 합계 미리보기───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="flex flex-wrap justify-end gap-x-8 gap-y-1 tabular-nums">
          <div className="flex gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">공 급 가</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatMaybeAmount(supplyAmount)}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">부 가 세</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatMaybeAmount(vat)}</dd>
          </div>
          <div className="flex gap-3 font-medium">
            <dt className="text-zinc-500 dark:text-zinc-400">합　　계</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatMaybeAmount(supplyAmount === null || vat === null ? null : supplyAmount + vat)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-right text-xs text-zinc-500 dark:text-zinc-400">
          {isExcelOnly
            ? "엑셀 전용 견적서의 공급가는 위에 적은 공급가액입니다. [견적서 받기]는 붙인 엑셀을 그대로 내려줍니다."
            : isCable
              ? "미리보기입니다. 설명 줄은 합계에 들어가지 않고, 견적서 파일에서는 양식의 수식이 계산합니다."
              : "미리보기입니다. 저장되는 값은 수량과 단가뿐이고, 견적서 파일에서는 양식의 수식이 계산합니다."}
        </p>
      </section>

      {/* 줄이 있는 채로 엑셀 전용을 켜려 할 때 — 비울지 묻는다(toggleExcelOnly). */}
      {clearLinesAsk && (
        <ExcelOnlyClearLinesDialog
          counts={clearLinesAsk}
          onConfirm={() => toggleExcelOnly(true, true)}
          onCancel={() => setClearLinesAsk(null)}
        />
      )}
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={editLabelClass}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </span>
      {children}
      {error && <p className={editErrorClass}>{error}</p>}
    </label>
  );
}

