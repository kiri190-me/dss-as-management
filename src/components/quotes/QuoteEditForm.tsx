"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { generateClientUuid } from "@/lib/client-uuid";
import { stockOwnerLabelOrUnspecified } from "@/lib/domain/inventory-types";
import { sumQuoteSupplyAmount } from "@/lib/domain/quote-list";
import { sumQuoteLaborCost } from "@/lib/domain/quote-labor-cost";
import { workflowKindLabels, type WorkflowKind } from "@/lib/domain/workflow-kind";
import type { RepairLaborKindRow } from "@/lib/db/queries/repair-labor";
import { isPriceUnset, toPriceFieldValue } from "@/lib/domain/quote-part-price";
import { buildQuoteSubject } from "@/lib/domain/quote-subject";
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
 * 담으면 **그 소유구분에 정해 둔 단가가 따라온다**(재고 관리 › 부품 상세의
 * 소유 구분별 단가). 소유구분마다 값이 다를 수 있어서 목록도 (부품, 소유구분)
 * 짝으로 나온다 — 같은 부품이 두 줄로 보이면 실제로 두 소유구분에서 나간 것이다.
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

type ItemRow = {
  key: string;
  partId: string | null;
  /** `2) OH 부품 비용` 칸으로 갈 줄인가. OH 견적서에만 그 칸이 있다. */
  isOverhaulPart: boolean;
  partNameText: string;
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
    partNameText: "",
    quantity: "1",
    unitPrice: "",
    sourceKey: null,
  };
}

/**
 * 출고 부품 목록의 한 줄을 가리키는 키. **부품 하나가 아니라 (부품, 소유구분)**
 * 이다 — 같은 부품이 DSS 것과 교산 것으로 따로 나갔으면 단가가 달라 두 줄이고,
 * 그 둘은 따로 담기고 따로 세어야 한다(queries/quotes.ts 의 같은 판단).
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
 * 단가는 **부품 상세에 적어 둔 일반 단가**다. 실제로 나간 물건이라 그 소유구분의
 * 값으로 청구한다(domain/quote-part-price.ts 의 '출처가 정한다').
 *
 * `isOverhaulPart` 는 false — 양식의 `1) 부품 비용` 칸으로 간다.
 */
function usedPartToItem(part: QuoteIntakeLookup["usedParts"][number]): ItemRow {
  return {
    key: generateClientUuid(),
    partId: part.partId,
    isOverhaulPart: false,
    partNameText: part.partSpec ? `${part.partName} (${part.partSpec})` : part.partName,
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
    partNameText: part.partNameText,
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
    const written = scopeLines[section].map((row) => row.text.trim()).filter((text) => text !== "");
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
  printHeaders,
  workScopeDefaults,
  initialIntakeNumber = null,
  returnHref = null,
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
   * 저장·취소 뒤에 돌아갈 곳. 수리 건에서 들어왔으면 그 건의 「견적서」 탭이다.
   * null 이면 지금까지와 같이 `/quotes/{새 id}` 와 `/quotes` 로 간다.
   *
   * 주소는 **서버가 만들어** 넘긴다(domain/quote-new-link.ts) — 링크가 실어 온
   * 글자를 그대로 밀어 넣으면 남이 만든 링크가 사람을 바깥으로 보낼 수 있다.
   */
  returnHref?: string | null;
}) {
  const router = useRouter();

  const [quoteNumber, setQuoteNumber] = useState(quote?.quoteNumber ?? "");
  const [kind, setKind] = useState<QuoteKind>(quote?.kind ?? "DOMESTIC");
  const [quoteDate, setQuoteDate] = useState(quote?.quoteDate ?? defaultQuoteDate ?? todayInSeoul());
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
  const [workCost, setWorkCost] = useState(quote?.workCost ?? "0");
  const [items, setItems] = useState<ItemRow[]>(
    quote?.items.length
      ? quote.items.map((item) => ({
          key: generateClientUuid(),
          partId: item.partId,
          // 저장된 줄에는 작업비를 싣지 않는다 — 그 값은 부품 마스터의 지금 값이고,
          // 이미 정해진 작업비를 다시 제안할 이유가 없다.
          isOverhaulPart: item.isOverhaulPart,
          partNameText: item.partNameText,
          quantity: String(item.quantity),
          unitPrice: item.unitPrice,
          // 저장돼 있던 줄이 어느 출고 기록에서 왔는지는 남지 않는다. 그래서
          // 이미 담긴 것으로 세지 않는다 — 사람이 지웠다가 다시 담을 수 있어야 한다.
          sourceKey: null,
        }))
      : [emptyItem()]
  );

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
   * 체크한 작업의 카탈로그 id.
   *
   * 저장된 견적서는 `task_id` 로 되살린다. 카탈로그에서 지워진 작업은 id 가
   * 없거나 목록에 없어 체크가 살아나지 않는데, **그 줄의 금액은 이미 work_cost 에
   * 들어 있다** — 화면이 그 사실을 아래에서 알린다.
   */
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(
    () =>
      new Set(
        (quote?.repairTasks ?? [])
          .map((task) => task.taskId)
          .filter((id): id is string => id !== null)
      )
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
   */
  const [scopeLines, setScopeLines] = useState<Record<QuoteWorkScopeSection, ScopeRow[]>>(() => {
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
  const [scopeTouched, setScopeTouched] = useState<Record<QuoteWorkScopeSection, boolean>>(() => ({
    INVESTIGATION: (quote?.workScopeLines ?? []).some((l) => l.section === "INVESTIGATION"),
    REPAIR: (quote?.workScopeLines ?? []).some((l) => l.section === "REPAIR"),
    POWER_TEST: (quote?.workScopeLines ?? []).some((l) => l.section === "POWER_TEST"),
  }));
  const [isConflict, setIsConflict] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const supplyAmount = useMemo(
    () =>
      sumQuoteSupplyAmount(
        items.map((item) => ({ quantity: Number(item.quantity) || 0, unitPrice: item.unitPrice })),
        workCost
      ),
    [items, workCost]
  );
  const vat = supplyAmount * VAT_RATE;

  /**
   * 모델명·신고증상·종류로 지은 품명. 지금 적힌 것과 같으면 아래 단추를
   * 그리지 않는다 — 눌러도 아무 일도 일어나지 않는 단추는 두지 않는다.
   *
   * 작업비와 같은 방식이다: **자동으로 덮지 않고 제안만 한다.** 글자를 칠
   * 때마다 덮으면 손으로 다듬어 둔 품명이 사라진다.
   */
  const suggestedSubject = useMemo(
    () =>
      buildQuoteSubject({
        modelName: modelNameText,
        faultDescription: faultDescriptionText,
        kind,
      }),
    [modelNameText, faultDescriptionText, kind]
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
   */
  const selectedTasks = useMemo(() => {
    if (!activeLabor) return [];
    return activeLabor.tasks
      .filter((task) => checkedTaskIds.has(task.id))
      .map((task) => ({
        taskId: task.id,
        taskName: task.taskName,
        hours: task.hours,
        hourlyRate: activeLabor.hourlyRate,
      }));
  }, [activeLabor, checkedTaskIds]);

  /**
   * 🔴 **통전 공수시간과 시간당 단가는 이미 화면에 들어와 있다**(activeLabor).
   * 새로 불러오지 않는다 — 그때 값을 그대로 셈에 쓰고, 그대로 저장한다.
   *
   * 장비 종류를 아직 안 골랐으면 차감을 아예 부탁하지 않는다. 그래야 옛
   * 견적서를 열었을 때와 한 글자도 다르지 않은 값이 나온다
   * (domain/quote-labor-cost.ts 의 그 항목).
   */
  const laborSuggestion = useMemo(
    () =>
      sumQuoteLaborCost(
        selectedTasks,
        activeLabor?.baseCost ?? null,
        activeLabor
          ? {
              excluded: powerTestExcluded,
              hours: activeLabor.powerTestHours,
              hourlyRate: activeLabor.hourlyRate,
            }
          : undefined
      ),
    [selectedTasks, activeLabor, powerTestExcluded]
  );
  /** 실제로 뺀 금액(원). 켜지 않았거나 뺄 수 없었으면 null. */
  const powerTestDeduction = laborSuggestion.powerTestDeduction ?? null;

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
    setScopeLines((prev) => {
      const next = { ...prev };
      for (const section of ["INVESTIGATION", "POWER_TEST"] as const) {
        if (scopeTouched[section]) continue;
        next[section] = toScopeRows(defaults[section]?.items ?? []);
      }
      return next;
    });
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

  function applyOverhaulRule(nextQuoteKind: QuoteKind, nextLaborKind: WorkflowKind | null) {
    const labor = repairLabor.find((row) => row.equipmentKind === nextLaborKind);
    if (!labor) return;
    const overhaulIds = labor.tasks.filter((task) => task.isOverhaul).map((task) => task.id);
    // 오버홀 작업이 표시돼 있지 않은 장비면 따라 움직일 줄이 없다. 이름으로
    // 맞히지 않는다(schema/repair-labor.ts 의 is_overhaul).
    if (overhaulIds.length === 0) return;

    const shouldCheck = nextQuoteKind === "OVERHAUL";
    const next = new Set(checkedTaskIds);
    for (const id of overhaulIds) {
      if (shouldCheck) next.add(id);
      else next.delete(id);
    }
    setCheckedTaskIds(next);
    // 고른 작업이 바뀌었으니 수리작업 목록도 따라간다(손대지 않았을 때만).
    fillRepairScopeFrom(taskNamesOf(labor, next));
  }

  /** 고른 작업의 건명들. 목록 차례를 그대로 따른다 — 문서에 적히는 순서다. */
  function taskNamesOf(labor: RepairLaborKindRow, ids: Set<string>): string[] {
    return labor.tasks.filter((task) => ids.has(task.id)).map((task) => task.taskName);
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
        setUsedParts([]);
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
      workCost,
      /**
       * 작업비의 근거. **그때 값의 사본을 보낸다** — 나중에 시간당 단가가 오르거나
       * 공수시간이 고쳐져도 이미 보낸 견적서의 근거는 그대로여야 한다
       * (schema/repair-labor.ts 의 quote_repair_tasks 머리말).
       */
      laborEquipmentKind: laborKind,
      laborBaseCost: activeLabor?.baseCost ?? null,
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
      powerTestExcluded,
      laborPowerTestDeduction: powerTestDeduction === null ? null : toAmountText(powerTestDeduction),
      repairTasks: selectedTasks,
      /**
       * 문서에 적히는 작업 내역. 빈 줄은 검증이 걸러 낸다 — 적힐 것이 없는
       * 문장이라 버려도 잃는 것이 없다.
       *
       * 묶음 차례는 배열 순서가 그대로다: 조사 → 수리 → 통전, 양식에 적히는
       * 순서와 같게 보낸다.
       */
      workScopeLines: QUOTE_WORK_SCOPE_SECTIONS.flatMap((section) =>
        scopeLines[section].map((row) => ({ section, text: row.text }))
      ),
      // 통째로 빈 줄은 보내지 않는다 — 사람이 `+ 부품 추가`를 눌러 두고 안 채운
      // 줄이 저장을 막으면, 어디가 문제인지 찾느라 폼을 다시 훑게 된다.
      items: items
        .filter((row) => row.partNameText.trim() !== "" || row.unitPrice.trim() !== "")
        .map((row) => ({
          partId: row.partId,
          // 내자 견적서에는 OH 칸이 없다 — 종류를 바꿔 저장하면 그 표시를 지운다.
          isOverhaulPart: kind === "OVERHAUL" ? row.isOverhaulPart : false,
          partNameText: row.partNameText,
          quantity: Number(row.quantity),
          unitPrice: row.unitPrice,
        })),
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
      const result = quote
        ? await updateQuoteAction({ id: quote.id, expectedVersion: quote.version, fields })
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

      if (quote) {
        // 고치기는 이미 이 주소에 있다. 옮길 곳이 없으니 다시 읽기만 한다.
        router.refresh();
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
       * 그냥 `/quotes/new` 로 들어왔으면 지금까지와 똑같이 새 장의 수정 화면으로
       * 간다.
       */
      leaving = true;
      router.push(returnHref ?? `/quotes/${result.id}`);
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

  if (showPreview) {
    /**
     * 지금 폼에 적힌 값 그대로 미리보기를 그린다.
     *
     * ── 빈 칸은 null 로 넘긴다 ────────────────────────────────────────
     * 미리보기는 유효기간·납기·결재조건을 `?? 양식의 기본 문구` 로 채우는데,
     * 빈 문자열은 null 이 아니라서 그 기본값이 안 뜬다. 그러면 실제로 나갈
     * 문서에는 "발행일로부터 4주"가 찍히는데 미리보기만 비어 보인다.
     */
    const orNull = (value: string) => (value.trim() === "" ? null : value);
    return (
      <QuotePrintView
        quoteId={quote?.id ?? null}
        onClose={() => setShowPreview(false)}
        header={activePrintHeader}
        workSections={activeWorkSections}
        quote={{
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
          // 저장할 때와 **같은 규칙으로** 거른다 — 여기서만 빈 줄을 남겨 두면
          // 미리보기의 줄 수와 실제 문서의 줄 수가 달라진다.
          items: items
            .filter((row) => row.partNameText.trim() !== "" || row.unitPrice.trim() !== "")
            .map((row) => ({
              partId: row.partId,
              partNameText: row.partNameText,
              isOverhaulPart: kind === "OVERHAUL" ? row.isOverhaulPart : false,
              quantity: Number(row.quantity) || 0,
              unitPrice: row.unitPrice.trim() === "" ? "0" : row.unitPrice,
            })),
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {quote ? "견적서 수정" : "새 견적서"}
        </h1>
        <div className="flex gap-2">
          {/* 🔴 **지금 화면의 값으로** 그린다 — 저장 여부와 무관하다.
              새 견적서도 저장하기 전에 어떻게 나갈지 볼 수 있어야 하고(그게
              미리보기의 본래 쓸모다), 수정 중일 때도 DB 의 옛 값이 아니라
              방금 고친 값이 보여야 한다. 예전에는 `/quotes/{id}/print` 로
              보냈는데, 그 통로는 저장된 값을 그려서 고치는 중에 누르면 화면과
              다른 문서가 나왔다. */}
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            미리보기 · PDF
          </button>
          {/* 파일은 저장된 장에서만 받을 수 있다 — 만드는 라우트가 DB 의 그 줄을
              읽기 때문이다. 그래서 이 단추만 저장 뒤에 나타난다. */}
          {quote && (
            <a
              href={`/api/quotes/${quote.id}/xlsx`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              견적서 받기
            </a>
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
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isSubmitting ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

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

      {/* ── 인수번호로 불러오기 ─────────────────────────────────────────── */}
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

      {/* ── 상단 정보 ───────────────────────────────────────────────────── */}
      <section className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
        {/* 종류가 첫 칸이다 — 무엇을 만드는지 정하고 나머지를 채운다.
            **O/H 대상 판정과는 별개다**: 대상품이어도 일반 견적서와 OH 견적서를
            모두 발행하므로(사용자 확인), 아래 배지는 알려 주기만 하고 이 칸을
            자동으로 바꾸지 않는다. */}
        <Field label="견적서 종류" error={fieldErrors.kind} required>
          <select
            value={kind}
            onChange={(e) => {
              const next = e.target.value as QuoteKind;
              setKind(next);
              // O/H 로 바꾸면 오버홀 작업이 자동으로 체크되고, 내자로 바꾸면
              // 풀린다(applyOverhaulRule 머리말).
              applyOverhaulRule(next, laborKind);
              // 양식이 바뀌면 조사·통전 기본 목록도 그 양식 것으로 간다.
              fillScopeFromTemplate(next, laborKind);
            }}
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
            onChange={(e) => setQuoteDate(e.target.value)}
            className={editInputClass}
            disabled={disabled}
          />
        </Field>
        <Field label="공급처" error={fieldErrors.customerNameText} required>
          <input
            value={customerNameText}
            onChange={(e) => {
              setCustomerNameText(e.target.value);
              // 이름을 손으로 고치면 고객사 연결은 끊는다 — 이름과 id 가 서로
              // 다른 곳을 가리키는 상태를 만들지 않는다.
              setCustomerId(null);
            }}
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
        <Field label="모델명" error={fieldErrors.modelNameText}>
          <input value={modelNameText} onChange={(e) => setModelNameText(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="L/N" error={fieldErrors.lotNumberText}>
            <input value={lotNumberText} onChange={(e) => setLotNumberText(e.target.value)} className={editInputClass} disabled={disabled} />
          </Field>
          <Field label="S/N" error={fieldErrors.serialNumberText}>
            <input value={serialNumberText} onChange={(e) => setSerialNumberText(e.target.value)} className={editInputClass} disabled={disabled} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          {/* S/N 에 생산 연월이 들어 있어 O/H 4년 기준을 볼 수 있다.
              형식이 다른 S/N 이면 아무것도 그리지 않는다(domain/overhaul.ts). */}
          <OverhaulBadge serialNumber={serialNumberText} referenceDate={new Date()} />
        </div>
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
        <Field label="유효기간" error={fieldErrors.validity} hint="비우면 양식 문구(발행일로부터 4주)">
          <input value={validity} onChange={(e) => setValidity(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
        <Field label="납기" error={fieldErrors.delivery} hint="비우면 양식 문구(발주일로부터 3주 이내)">
          <input value={delivery} onChange={(e) => setDelivery(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
        <Field label="결재조건" error={fieldErrors.payment} hint="비우면 양식 문구(귀사 결제 조건)">
          <input value={payment} onChange={(e) => setPayment(e.target.value)} className={editInputClass} disabled={disabled} />
        </Field>
      </section>

      {/* ── O/H 템플릿 부품 ──────────────────────────────────────────────
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

      {/* ── 사용한 부품 (참고) ──────────────────────────────────────────── */}
      {usedParts.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            이 접수 건에 출고된 부품 <span className="font-normal text-zinc-500 dark:text-zinc-400">(참고용)</span>
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
            재고에서 나간 것과 청구하는 것이 늘 같지는 않습니다. 담을 것만 골라 주세요. 단가는 재고 관리에
            소유구분별로 적어 둔 값이 따라오고, 정해 두지 않았으면 빈칸으로 들어옵니다.
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

      {/* ── 부품 줄 ─────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">부품 비용</h2>
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, emptyItem()])}
            disabled={disabled || items.length >= MAX_QUOTE_ITEMS}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
          >
            + 부품 추가
          </button>
        </div>

        {kind === "OVERHAUL" && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            <b>OH</b> 를 체크한 줄은 양식의 <b>2) OH 부품 비용</b> 칸으로, 체크하지 않은 줄은
            <b> 1) 부품 비용</b> 칸으로 갑니다. 두 칸 모두 담을 만큼 줄이 늘어납니다.
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {items.map((row, index) => (
            <div key={row.key} className={`grid grid-cols-1 gap-2 ${kind === "OVERHAUL" ? "sm:grid-cols-[1fr_5rem_8rem_auto_auto]" : "sm:grid-cols-[1fr_5rem_8rem_auto]"}`}>
              <div>
                <input
                  value={row.partNameText}
                  onChange={(e) => updateItem(row.key, { partNameText: e.target.value, partId: null })}
                  placeholder={`${index + 1}번째 부품 품명`}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`items.${index}.partNameText`] && (
                  <p className={editErrorClass}>{fieldErrors[`items.${index}.partNameText`]}</p>
                )}
              </div>
              <div>
                <input
                  value={row.quantity}
                  onChange={(e) => updateItem(row.key, { quantity: e.target.value })}
                  inputMode="numeric"
                  aria-label={`${index + 1}번째 부품 수량`}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`items.${index}.quantity`] && (
                  <p className={editErrorClass}>{fieldErrors[`items.${index}.quantity`]}</p>
                )}
              </div>
              <div>
                <input
                  value={row.unitPrice}
                  onChange={(e) => updateItem(row.key, { unitPrice: e.target.value })}
                  inputMode="decimal"
                  placeholder="단가"
                  aria-label={`${index + 1}번째 부품 단가`}
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
                aria-label={`${index + 1}번째 부품 줄 지우기`}
                className="rounded-md border border-zinc-300 px-2 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {fieldErrors.items && <p className={editErrorClass}>{fieldErrors.items}</p>}

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
                    const checked = checkedTaskIds.has(task.id);
                    return (
                      <li key={task.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(checkedTaskIds);
                              if (e.target.checked) next.add(task.id);
                              else next.delete(task.id);
                              setCheckedTaskIds(next);
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
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {task.hours}시간 ·{" "}
                            {formatAmount(task.hours * Number(activeLabor.hourlyRate))}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* 🔴 식을 그대로 보여 준다. 합계 하나만 보이면 "왜 이 숫자지"에
                  답할 것이 없고, 기본 작업비가 더해진 것도 드러나지 않는다.
                  통전작업 제외도 마찬가지다 — **뺀 금액을 눈에 보이게 적는다.** */}
              <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300">
                기본 작업비{" "}
                {laborSuggestion.baseCost === null ? (
                  <b className="text-amber-700 dark:text-amber-400">정하지 않음</b>
                ) : (
                  <b className="tabular-nums">{formatAmount(laborSuggestion.baseCost)}</b>
                )}{" "}
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
                  {workflowKindLabels[activeLabor.equipmentKind]}의 기본 작업비를 정하지 않아 합계에
                  더해지지 않았습니다 — [PO/내자] › 수리 작업 비용에서 적어 주세요.
                </p>
              )}
              {/* 🔴 못 뺐으면 못 뺐다고 말한다. 조용히 두면 사람은 210만원이
                  나온 줄 알고 그대로 고객사에 보낸다. */}
              {laborSuggestion.powerTestNotice === "NO_POWER_TEST_HOURS" && (
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
              {laborSuggestion.powerTestNotice === "CLAMPED_TO_ZERO" && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  뺄 통전작업 몫이 기본 작업비보다 커서 기본 작업비를 0원에서 멈췄습니다 — 두 값을
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
              return (
                <div key={section} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={editLabelClass}>
                      {QUOTE_WORK_SCOPE_SECTIONS.indexOf(section) + 1}){" "}
                      {quoteWorkScopeSectionLabels[section]}
                    </span>
                    {/* 다시 맞추는 길을 열어 둔다 — 손댄 뒤로는 자동으로 따라가지
                        않으므로, 되돌리고 싶을 때 누를 곳이 없으면 사람이 손으로
                        지우고 다시 적게 된다. */}
                    {section === "REPAIR" ? (
                      <button
                        type="button"
                        onClick={() =>
                          fillRepairScopeFrom(
                            activeLabor ? taskNamesOf(activeLabor, checkedTaskIds) : [],
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
                        onClick={() => {
                          setScopeLines((prev) => ({ ...prev, [section]: toScopeRows(templateDefaults) }));
                          setScopeTouched((prev) => ({ ...prev, [section]: false }));
                        }}
                        disabled={disabled || templateDefaults.length === 0}
                        className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] disabled:opacity-50 dark:border-zinc-700"
                      >
                        양식 기본값으로
                      </button>
                    )}
                  </div>

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
                          onClick={() => editScope(section, rows.filter((r) => r.key !== row.key))}
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
            <input
              value={workCost}
              onChange={(e) => setWorkCost(e.target.value)}
              inputMode="decimal"
              className={editInputClass}
              disabled={disabled}
            />
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
      </section>

      {/* ── 합계 미리보기 ───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="flex flex-wrap justify-end gap-x-8 gap-y-1 tabular-nums">
          <div className="flex gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">공 급 가</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatAmount(supplyAmount)}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">부 가 세</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatAmount(vat)}</dd>
          </div>
          <div className="flex gap-3 font-medium">
            <dt className="text-zinc-500 dark:text-zinc-400">합　　계</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{formatAmount(supplyAmount + vat)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-right text-xs text-zinc-500 dark:text-zinc-400">
          미리보기입니다. 저장되는 값은 수량과 단가뿐이고, 견적서 파일에서는 양식의 수식이 계산합니다.
        </p>
      </section>
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

