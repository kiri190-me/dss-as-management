import "server-only";

import { and, asc, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import { db } from "../client";
import {
  attachments,
  customers,
  inventoryPartRequestItems,
  inventoryPartRequests,
  ohPartTemplateItems,
  ohPartTemplateModels,
  ohPartTemplates,
  partOverhaulUnitPrices,
  partUnitPrices,
  parts,
  products,
  quoteItems,
  quoteRepairTasks,
  quoteWorkScopeLines,
  quotes,
  repairCases,
} from "../schema";
import {
  buildQuoteSummaryLine,
  isQuoteAmountItemLine,
  quoteSupplyAmountOf,
  type QuoteAmountLine,
} from "@/lib/domain/quote-list";
import type { StockOwner } from "@/lib/domain/inventory-types";
import type { WorkflowKind } from "@/lib/domain/workflow-kind";
import {
  isQuoteKind,
  type QuoteKind,
  type QuoteWorkScopeSection,
  type StoredQuoteKind,
} from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서 목록 — 읽는 쪽
 * ============================================================================
 * 이 파일에는 **쓰기 함수가 없다.** 견적서를 만들고 고치는 일은 트랜잭션과
 * 낙관적 잠금이 필요해 mutations/quotes.ts 가 맡는다(이 저장소의 queries/
 * mutations 구분). 3단계는 목록까지다.
 *
 * ── 조인이 거의 없다 ────────────────────────────────────────────────────
 * 내자 정리 목록은 고객사·제품·수리 건을 전부 조인해서 "이 행의 값이 먼저,
 * 없으면 수리 건의 값" 규칙을 편다. 견적서는 그럴 것이 없다 — 발행 시점에
 * 값이 통째로 복사돼 들어오는 **스냅샷**이기 때문이다(schema/quotes.ts 의
 * '이 표의 값은 스냅샷이다'). 목록 여섯 칸이 전부 quotes 한 표에 있다.
 *
 * repair_cases 를 왼쪽 조인하는 것은 **인수번호 하나** 때문이다. 그 값은
 * 스냅샷이 아니라 "지금 이 견적서가 어느 접수 건에 걸려 있는가"라는 현재의
 * 연결이라, 화면에서 눌러 접수 건으로 건너가는 링크가 된다. 연결이 없거나
 * 접수 건이 영구 삭제된 장은 quotes.intake_number_text 에 남은 글자를 쓴다.
 * ============================================================================
 */

export type QuoteListItem = {
  id: string;
  /**
   * 🔴 **DB 가 내주는 값을 그대로 받는다**(StoredQuoteKind — QuoteKind 가 아니다).
   * 목록은 있는 것을 보여 주는 자리라, 앱이 아직 다루지 못하는 종류(CABLE)를
   * 만나도 **둘 중 하나로 접지 않는다.** 접으면 케이블 견적서가 「내자 견적서」라는
   * 딱지를 달고 목록에 앉는다. 두 이름을 왜 갈랐는지는 validation/quote-input.ts 의
   * STORED_QUOTE_KINDS 머리말에 있다.
   */
  kind: StoredQuoteKind;
  /** 수정 폼이 저장할 때 되돌려 보낼 값. 목록에 그리지는 않는다. */
  version: number;
  quoteNumber: string;
  quoteDate: string;
  customerName: string;
  modelName: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  faultDescription: string | null;
  subject: string;
  /**
   * 접수 건으로 건너가는 링크. 연결이 없으면 null 이고, 그때는
   * intakeNumberText 만 글자로 남는다.
   */
  repairCaseId: string | null;
  intakeNumber: string | null;
  /** 목록 한 줄(quote-list.ts). 서버에서 만들어 내려보낸다 — 검색이 붙어도 같은 문자열을 본다. */
  summaryLine: string;
  /**
   * 공급가(부가세 별도). 일반 견적서는 부품 줄 합 + 작업비, **엑셀 전용 견적서는 손으로
   * 적은 공급가액**이다(domain/quote-list.ts 의 quoteSupplyAmountOf — 2026-09-15 Q2).
   *
   * `null` 은 「금액을 알 수 없다」— 엑셀 전용인데 공급가액이 비어 있는 장이다(검증이 필수로
   * 받아 정상 경로로는 생기지 않는다). 화면은 「—」로 그린다. 0 으로 접지 않는다 — 0 은
   * 「무상 견적」이라는 실제 값이다.
   */
  supplyAmount: number | null;
  itemCount: number;
  /** 엑셀 전용 견적서인가(2026-09-15 Q2) — 품목 없이 손으로 만든 엑셀이 곧 보낸 문서다. */
  isExcelOnly: boolean;
  /**
   * 결재 PDF 칸 · 수기 엑셀 칸에 지금 파일이 붙어 있는가(휴지통 것은 세지 않는다). 엑셀 전용
   * 견적서인데 엑셀이 없으면 받기가 404 로 끝나므로 화면이 그 사실을 미리 알린다 — 저장
   * 때는 강제할 수 없다(새 견적서는 저장한 **뒤에** 파일을 올린다).
   */
  hasSignedPdf: boolean;
  hasExcel: boolean;
};

/**
 * 목록. **부품 줄을 N+1 로 읽지 않는다** — 견적서 하나마다 한 번씩 읽으면 스무
 * 장짜리 목록에 스물한 번의 왕복이 생기고, 그 값은 장수만큼 그대로 늘어난다.
 * 내자 정리의 납기 요청일이 같은 이유로 같은 방식을 쓴다.
 *
 * 정렬은 **발행일자 내림차순 → 만든 시각 내림차순**이다. 최근에 낸 견적서를
 * 먼저 보는 것이 이 화면을 여는 목적이고, 같은 날 여러 장을 낸 경우가 실제로
 * 있어서(재견적) 그때 순서가 매번 달라지지 않도록 두 번째 기준을 둔다.
 * 견적서번호로 정렬하지 않는 것은 그것이 사람이 손으로 적는 값이라
 * 문자열 정렬이 발행 순서와 어긋날 수 있기 때문이다.
 */
export async function listQuotes(): Promise<QuoteListItem[]> {
  return selectQuoteList();
}

/** 접수 건 id 는 UUID 다. 다른 글자가 그대로 조회에 들어가면 Postgres 가 22P02 로
 *  던져 화면이 오류 페이지가 된다(queries/attachments.ts 와 같은 방어). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * **이 접수 건**에 붙은 견적서. 수리 건 상세의 「견적서」 탭이 쓴다.
 *
 * 🔴 위 목록과 **같은 함수 몸통을 쓴다.** 조건 하나만 다르고 select·join·정렬·
 * 매핑이 전부 같아야 하기 때문이다 — 두 벌로 적어 두면 한쪽만 고쳐지는 날이
 * 오고, 그때 사람은 PO/내자 목록과 이 탭에서 **같은 견적서의 다른 금액**을 보게
 * 된다. 그 차이는 한참 뒤에 드러난다.
 *
 * 지운 장은 여기에도 나오지 않는다(`is_deleted = false`) — 휴지통은 PO/내자
 * 목록 화면에만 있다.
 */
export async function listQuotesForRepairCase(repairCaseId: string): Promise<QuoteListItem[]> {
  if (!UUID_PATTERN.test(repairCaseId)) return [];
  return selectQuoteList(eq(quotes.repairCaseId, repairCaseId));
}

/**
 * 위 둘의 공통 몸통. `narrow` 는 `is_deleted = false` 에 **더해지는** 조건이다 —
 * 대신하지 않는다. 지운 장을 되살리는 통로가 이 함수를 통해 열리면 안 된다.
 */
async function selectQuoteList(narrow?: SQL): Promise<QuoteListItem[]> {
  const rows = await db
    .select({
      id: quotes.id,
      version: quotes.version,
      quoteNumber: quotes.quoteNumber,
      kind: quotes.kind,
      quoteDate: quotes.quoteDate,
      customerNameText: quotes.customerNameText,
      modelNameText: quotes.modelNameText,
      lotNumberText: quotes.lotNumberText,
      serialNumberText: quotes.serialNumberText,
      faultDescriptionText: quotes.faultDescriptionText,
      subject: quotes.subject,
      workCost: quotes.workCost,
      // 엑셀 전용 견적서의 금액은 품목이 아니라 손으로 적은 공급가액이다(2026-09-15 Q2).
      isExcelOnly: quotes.isExcelOnly,
      manualSupplyAmount: quotes.manualSupplyAmount,
      repairCaseId: quotes.repairCaseId,
      // 연결이 살아 있으면 진짜 인수번호, 아니면 이 표에 남은 글자.
      linkedIntakeNumber: repairCases.intakeNumber,
      intakeNumberText: quotes.intakeNumberText,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .leftJoin(repairCases, eq(repairCases.id, quotes.repairCaseId))
    .where(narrow ? and(eq(quotes.isDeleted, false), narrow) : eq(quotes.isDeleted, false))
    .orderBy(desc(quotes.quoteDate), desc(quotes.createdAt));

  const quoteIds = rows.map((row) => row.id);
  const itemsByQuoteId = await loadItemsByQuoteId(quoteIds);
  // 결재 PDF · 엑셀이 붙어 있는가 — 부품 줄과 같이 **질의 한 번으로**(N+1 없음).
  const attachmentFlagsByQuoteId = await loadAttachmentFlagsByQuoteId(quoteIds);

  return rows.map((row) => {
    const items = itemsByQuoteId.get(row.id) ?? [];
    const attachmentFlags = attachmentFlagsByQuoteId.get(row.id);
    return {
      isExcelOnly: row.isExcelOnly,
      hasSignedPdf: attachmentFlags?.hasSignedPdf ?? false,
      hasExcel: attachmentFlags?.hasExcel ?? false,
      id: row.id,
      kind: row.kind,
      version: row.version,
      quoteNumber: row.quoteNumber,
      quoteDate: row.quoteDate,
      customerName: row.customerNameText,
      modelName: row.modelNameText,
      lotNumber: row.lotNumberText,
      serialNumber: row.serialNumberText,
      faultDescription: row.faultDescriptionText,
      subject: row.subject,
      repairCaseId: row.repairCaseId,
      intakeNumber: row.linkedIntakeNumber ?? row.intakeNumberText,
      summaryLine: buildQuoteSummaryLine({
        quoteNumber: row.quoteNumber,
        customerName: row.customerNameText,
        modelName: row.modelNameText,
        lotNumber: row.lotNumberText,
        serialNumber: row.serialNumberText,
        faultDescription: row.faultDescriptionText,
      }),
      // 서버가 금액을 셈하는 단 한 곳(domain/quote-list.ts) — 엑셀 전용 장은 손으로 적은
      // 공급가액이고, 그 값이 비어 있으면 null(화면이 「—」로 그린다).
      supplyAmount: quoteSupplyAmountOf({
        isExcelOnly: row.isExcelOnly,
        manualSupplyAmount: row.manualSupplyAmount,
        items,
        workCost: row.workCost,
      }),
      // 화면이 「n품목」으로 그리는 값이라 **품목 줄만 센다** — 설명 줄은 품목이
      // 아니다. 합계와 같은 잣대를 쓴다(domain/quote-list.ts 의 isQuoteAmountItemLine).
      itemCount: items.filter(isQuoteAmountItemLine).length,
    };
  });
}

type QuoteAttachmentFlags = { hasSignedPdf: boolean; hasExcel: boolean };

/**
 * 여러 장의 결재 PDF · 엑셀 칸이 차 있는가를 **질의 한 번으로** 걷어 온다(2026-09-15 Q2).
 * 부품 줄(loadItemsByQuoteId)과 같은 까닭이다 — 장마다 한 번씩 물으면 목록 장수만큼
 * 왕복이 는다.
 *
 * 휴지통의 첨부는 세지 않는다(`is_deleted = false` — 부분 인덱스
 * attachments_quote_id_not_deleted_idx 를 타는 모양). 칸 교체로 밀려난 옛 파일은 휴지통에
 * 있으므로 여기서 빠진다.
 */
async function loadAttachmentFlagsByQuoteId(quoteIds: string[]): Promise<Map<string, QuoteAttachmentFlags>> {
  const flags = new Map<string, QuoteAttachmentFlags>();
  if (quoteIds.length === 0) return flags;

  const rows = await db
    .select({ quoteId: attachments.quoteId, category: attachments.category })
    .from(attachments)
    .where(and(inArray(attachments.quoteId, quoteIds), eq(attachments.isDeleted, false)));

  for (const row of rows) {
    if (row.quoteId === null) continue;
    const current = flags.get(row.quoteId) ?? { hasSignedPdf: false, hasExcel: false };
    if (row.category === "SIGNED_QUOTE_PDF") current.hasSignedPdf = true;
    if (row.category === "QUOTE_EXCEL") current.hasExcel = true;
    flags.set(row.quoteId, current);
  }
  return flags;
}

export type DeletedQuoteRow = {
  id: string;
  version: number;
  quoteNumber: string;
  quoteDate: string;
  summaryLine: string;
  subject: string;
  deletedAt: string | null;
  deleteReason: string | null;
};

/**
 * 휴지통. 지운 시각 내림차순 — 방금 지운 것을 되살리려고 여는 화면이다.
 *
 * 부품 줄은 읽지 않는다. 휴지통은 "무엇을 지웠는가"를 알아보고 되살리는 자리라
 * 금액까지 필요하지 않고, 목록 한 줄이면 어느 견적서인지 가려진다.
 */
export async function listDeletedQuotes(): Promise<DeletedQuoteRow[]> {
  const rows = await db
    .select({
      id: quotes.id,
      version: quotes.version,
      quoteNumber: quotes.quoteNumber,
      quoteDate: quotes.quoteDate,
      customerNameText: quotes.customerNameText,
      modelNameText: quotes.modelNameText,
      lotNumberText: quotes.lotNumberText,
      serialNumberText: quotes.serialNumberText,
      faultDescriptionText: quotes.faultDescriptionText,
      subject: quotes.subject,
      deletedAt: quotes.deletedAt,
      deleteReason: quotes.deleteReason,
    })
    .from(quotes)
    .where(eq(quotes.isDeleted, true))
    .orderBy(desc(quotes.deletedAt));

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    quoteNumber: row.quoteNumber,
    quoteDate: row.quoteDate,
    subject: row.subject,
    summaryLine: buildQuoteSummaryLine({
      quoteNumber: row.quoteNumber,
      customerName: row.customerNameText,
      modelName: row.modelNameText,
      lotNumber: row.lotNumberText,
      serialNumber: row.serialNumberText,
      faultDescription: row.faultDescriptionText,
    }),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    deleteReason: row.deleteReason,
  }));
}

/**
 * 여러 장의 부품 줄을 **질의 한 번으로** 걷어 와 장마다 묶는다. 위 '목록' 주석 참조.
 *
 * 🔴 **`kind` 를 함께 싣는다**(2026-09-16). 설명 줄은 합계에 들어가지 않는데,
 * 그 판단을 여기서 하지 않는 것은 **품목 줄이 무엇인가를 한 곳에서만 정하기**
 * 위해서다(domain/quote-list.ts 의 isQuoteAmountItemLine). 여기서 미리 걸러 버리면
 * 같은 규칙이 두 벌이 되고, 한쪽만 고쳐지는 날 목록의 금액과 줄 수가 서로 다른
 * 기준을 말하게 된다.
 */
async function loadItemsByQuoteId(quoteIds: string[]): Promise<Map<string, QuoteAmountLine[]>> {
  const grouped = new Map<string, QuoteAmountLine[]>();
  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다. 읽을 장이 없으면
  // 질의 자체를 하지 않는 것이 맞다.
  if (quoteIds.length === 0) return grouped;

  const rows = await db
    .select({
      quoteId: quoteItems.quoteId,
      kind: quoteItems.kind,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
    })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, quoteIds))
    .orderBy(asc(quoteItems.lineNo));

  for (const row of rows) {
    const bucket = grouped.get(row.quoteId);
    const item: QuoteAmountLine = {
      kind: row.kind,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
    };
    if (bucket) bucket.push(item);
    else grouped.set(row.quoteId, [item]);
  }
  return grouped;
}

/*
 * 견적서번호 중복 확인은 여기 없다 — mutations/quotes.ts 가 **트랜잭션 안에서**
 * 본다. 조회 함수로 빼 두면 확인과 저장 사이가 벌어져, 그 틈에 남이 같은 번호를
 * 쓰면 "화면은 괜찮다고 했는데 저장이 실패하는" 상태가 된다. 최종 판정은 어차피
 * 부분 unique 인덱스다(schema/quotes.ts).
 *
 * 공급처 드롭다운 목록도 새로 만들지 않는다. queries/domestic-orders.ts 의
 * listCustomerOptions 가 이미 같은 일을 한다.
 */

export type QuoteEditData = {
  id: string;
  version: number;
  quoteNumber: string;
  /**
   * 🔴 **앱이 다루는 종류만 온다**(QuoteKind — 목록의 StoredQuoteKind 와 다르다).
   * 이 자료는 수정 화면 · 미리보기 · xlsx 생성기가 받는데, 그들이 아직 케이블
   * 견적서를 그릴 줄 모른다. 그래서 그런 장은 **아예 오지 않는다** — 아래
   * getQuoteForEdit 의 관문이 null 로 답한다.
   */
  kind: QuoteKind;
  quoteDate: string;
  repairCaseId: string | null;
  intakeNumberText: string | null;
  customerId: string | null;
  customerNameText: string;
  modelNameText: string | null;
  lotNumberText: string | null;
  serialNumberText: string | null;
  faultDescriptionText: string | null;
  subject: string;
  validity: string | null;
  delivery: string | null;
  payment: string | null;
  workCost: string;
  /**
   * 위 workCost 를 만든 근거. **다시 열었을 때 금액만 남고 무엇을 골랐는지
   * 사라지지 않게** 함께 싣는다(schema/quotes.ts 의 labor_* 주석).
   *
   * 이 기능이 생기기 전에 만든 견적서는 셋 다 비어 있다 — 그때는 작업을 고르는
   * 방법 자체가 없었다. 화면은 그 상태를 "아직 고른 적 없음"으로 그린다.
   */
  laborEquipmentKind: WorkflowKind | null;
  laborBaseCost: string | null;
  /**
   * 통전작업을 빼고 청구한 장인가, 그리고 **그때 실제로 뺀 금액**.
   *
   * 🔴 **다시 셈하지 않는다.** 저장된 이 두 값이 곧 근거다 — 통전 공수시간이나
   * 시간당 단가가 나중에 바뀌어도 이미 보낸 견적서는 그대로여야 한다
   * (schema/quotes.ts 의 그 항목).
   *
   * 옛 견적서는 `false` · `null` 이다. 그때는 제외할 방법 자체가 없었다.
   */
  powerTestExcluded: boolean;
  laborPowerTestDeduction: string | null;
  /**
   * 「① 조사작업」을 문서에서 빼는가 — 조사 칸을 손대서 비운 채 저장한 장이다
   * (schema/quotes.ts 의 그 항목). **다시 셈하지 않는다** — 옛 견적서의 빈 조사 칸과
   * 가르는 것이 이 저장된 결정뿐이다. 옛 견적서는 `false` 다.
   */
  investigationExcluded: boolean;
  /**
   * 서류작업을 빼고 청구한 장인가(2026-09-16 — schema/quotes.ts 의 그 항목).
   *
   * 수정 화면이 체크 상자로 켜고 끄며, 이 값으로 다시 편다(왕복). **뺀 금액을 담는 짝
   * 칸은 없다** — 조사와 같다(domain/quote-labor-cost.ts 머리말).
   *
   * 🔴 **문서는 이 칸을 읽지 않는다** — 견적서의 구역은 조사 · 수리 · 통전 셋뿐이라
   * 서류작업은 적히는 자리가 없다. 금액만 빠진다. 옛 견적서는 `false` 다.
   */
  documentExcluded: boolean;
  /**
   * 엑셀 전용 견적서인가 · 손으로 적은 공급가액(2026-09-15 Q2 — schema/quotes.ts). 엑셀
   * 전용 장은 품목이 없고, 받기(/api/quotes/{id}/xlsx)가 앱 양식 대신 붙인 엑셀을 내려준다.
   * 옛 견적서는 `false` · `null` 이다.
   */
  isExcelOnly: boolean;
  manualSupplyAmount: string | null;
  repairTasks: {
    /** 카탈로그의 그 줄. 지워졌으면 null 일 수 있다(참고용). */
    taskId: string | null;
    taskNameText: string;
    hours: number;
    /** 그때의 시간당 작업비. 지금 값으로 다시 셈하지 않는다. */
    hourlyRate: string;
  }[];
  /**
   * 견적서에 적히는 작업 내역(조사/수리/통전). 묶음 안의 차례대로 온다.
   *
   * 이 기능이 생기기 전에 만든 견적서는 빈 배열이다 — 그때는 적을 방법이
   * 없었다. 화면은 그때 양식의 기본 목록으로 채워 준다.
   */
  workScopeLines: { section: QuoteWorkScopeSection; text: string }[];
  /**
   * 🔴 **품목 줄만 온다**(2026-09-16). 설명 줄(quote_items.kind = 'NOTE')은 케이블
   * 견적서의 것이고, 이 자료를 받는 세 곳(수정 화면 · 미리보기 · xlsx 생성기)이
   * 아직 그 줄을 그릴 줄 모른다. 그래서 수량 · 단가도 **여기서는 비지 않는다** —
   * DB 칸이 nullable 이 된 것(0101)은 설명 줄 하나 때문이고, 품목 줄에는 언제나
   * 있다(CHECK quote_items_item_line_amounts_required).
   *
   * 위 kind 관문이 케이블 견적서를 막고 있어 **지금 걸러지는 줄은 없다.** 케이블
   * 화면 조각이 저 셋을 함께 고치면서 이 타입을 설명 줄까지 담게 넓히면 된다.
   */
  items: {
    partId: string | null;
    partNameText: string;
    isOverhaulPart: boolean;
    quantity: number;
    unitPrice: string;
  }[];
};

/**
 * 수정 폼이 여는 한 장. **version 을 반드시 함께 싣는다** — 저장할 때 되돌려
 * 보낼 낙관적 잠금 토큰이고, 폼을 열 때 따로 한 번 더 읽으면 그 사이의 변경을
 * 놓친다.
 *
 * 지워진 장은 null 이다. 목록에 없는 것을 주소로 열 수 있으면 휴지통이 뜻을
 * 잃는다(mutations 의 '지워진 장은 고칠 수 없다'와 같은 판단).
 */
export async function getQuoteForEdit(id: string): Promise<QuoteEditData | null> {
  const [row] = await db
    .select({
      id: quotes.id,
      version: quotes.version,
      quoteNumber: quotes.quoteNumber,
      kind: quotes.kind,
      quoteDate: quotes.quoteDate,
      repairCaseId: quotes.repairCaseId,
      intakeNumberText: quotes.intakeNumberText,
      customerId: quotes.customerId,
      customerNameText: quotes.customerNameText,
      modelNameText: quotes.modelNameText,
      lotNumberText: quotes.lotNumberText,
      serialNumberText: quotes.serialNumberText,
      faultDescriptionText: quotes.faultDescriptionText,
      subject: quotes.subject,
      validity: quotes.validity,
      delivery: quotes.delivery,
      payment: quotes.payment,
      workCost: quotes.workCost,
      laborEquipmentKind: quotes.laborEquipmentKind,
      laborBaseCost: quotes.laborBaseCost,
      powerTestExcluded: quotes.powerTestExcluded,
      laborPowerTestDeduction: quotes.laborPowerTestDeduction,
      investigationExcluded: quotes.investigationExcluded,
      documentExcluded: quotes.documentExcluded,
      isExcelOnly: quotes.isExcelOnly,
      manualSupplyAmount: quotes.manualSupplyAmount,
    })
    .from(quotes)
    .where(and(eq(quotes.id, id), eq(quotes.isDeleted, false)))
    .limit(1);

  if (!row) return null;

  /**
   * 🔴 **아직 다루지 못하는 종류는 열지 않는다**(2026-09-16).
   *
   * DB 의 quote_kind 에는 이제 CABLE 이 있지만(0101), 이 자료를 받는 수정 화면 ·
   * 미리보기 · xlsx 생성기는 케이블 견적서를 그릴 줄 모른다. 그렇다고 그 값을
   * 내자나 OH 로 접으면 **다른 종류의 양식으로 문서가 나간다** — 그 편이 못 여는
   * 것보다 나쁘다. 그래서 목록(있는 그대로 보여 준다)과 달리 여기서는 **없는 장으로
   * 답한다.**
   *
   * 판정을 isQuoteKind 에 맡긴 것은 일부러다 — 「앱이 다루는 종류」 목록이 한
   * 곳(QUOTE_KINDS)뿐이라, 뒤 조각이 거기에 CABLE 을 더하는 순간 이 관문도 함께
   * 열린다. 지금은 케이블 견적서를 만들 길 자체가 없어 실제로 걸리는 장이 없다.
   */
  if (!isQuoteKind(row.kind)) return null;
  const kind = row.kind;

  const itemRows = await db
    .select({
      partId: quoteItems.partId,
      partNameText: quoteItems.partNameText,
      isOverhaulPart: quoteItems.isOverhaulPart,
      kind: quoteItems.kind,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
    })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.lineNo));

  /**
   * 🔴 **품목 줄만 내보낸다** — 아래 QuoteEditData.items 의 그 항목 참조. 바로 위
   * 관문이 케이블 견적서를 막고 있어 걸러지는 줄이 실제로는 없다.
   */
  const items = itemRows.filter(isQuoteAmountItemLine).map((item) => ({
    partId: item.partId,
    partNameText: item.partNameText,
    isOverhaulPart: item.isOverhaulPart,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));

  // 고른 수리 작업. **그때 값의 사본**이라 카탈로그를 조인하지 않는다 —
  // 조인하면 단가가 오른 뒤 옛 견적서의 근거가 소리 없이 바뀐다.
  const repairTasks = await db
    .select({
      taskId: quoteRepairTasks.taskId,
      taskNameText: quoteRepairTasks.taskNameText,
      hours: quoteRepairTasks.hours,
      hourlyRate: quoteRepairTasks.hourlyRate,
    })
    .from(quoteRepairTasks)
    .where(eq(quoteRepairTasks.quoteId, id))
    .orderBy(asc(quoteRepairTasks.lineNo));

  // 작업 내역. 묶음 안의 차례대로 — 문서에 적히는 순서 그대로다.
  const workScopeLines = await db
    .select({ section: quoteWorkScopeLines.section, text: quoteWorkScopeLines.text })
    .from(quoteWorkScopeLines)
    .where(eq(quoteWorkScopeLines.quoteId, id))
    .orderBy(asc(quoteWorkScopeLines.section), asc(quoteWorkScopeLines.lineNo));

  // kind 를 따로 싣는 것은 위 관문이 좁혀 둔 값을 쓰기 위해서다 — `...row` 는
  // DB 가 내주는 넓은 값(CABLE 포함)을 그대로 펴 놓는다.
  return { ...row, kind, items, repairTasks, workScopeLines };
}

export type QuoteIntakeLookup = {
  repairCaseId: string;
  intakeNumber: string;
  customerId: string | null;
  customerName: string | null;
  modelName: string | null;
  /** L/N — 목록·양식 모두에서 S/N 과 헷갈리기 쉬운 자리다(domain/quote-list.ts). */
  lotNumber: string | null;
  serialNumber: string | null;
  faultDescription: string | null;
  /**
   * 이 접수 건에 **실제로 출고된** 부품. 참고용이다 — 폼이 자동으로 채우지 않고
   * 옆에 늘어놓기만 하고, 사람이 골라 담는다.
   *
   * 단가가 없다: parts 표에 가격 칼럼이 자체가 없다. 무엇을 몇 개 썼는지까지가
   * 시스템이 아는 전부이고, 얼마에 청구할지는 사람이 정한다.
   */
  usedParts: {
    partId: string;
    partName: string;
    partSpec: string | null;
    /**
     * 어느 소유구분으로 요청됐는가. **null 이 정상이다** — 이 칸이 생기기 전의
     * 요청은 영영 NULL 로 남는다(schema/inventory-part-requests.ts 의 소유구분
     * checkpoint). 화면은 stockOwnerLabelOrUnspecified 로 "미지정"이라 그린다.
     */
    owner: StockOwner | null;
    quantity: number;
    /**
     * 그 소유구분에 정해 둔 단가. **null 이면 "정하지 않음"이고 빈칸으로 둔다** —
     * 0 으로 바꾸면 견적서가 정하지 않은 부품을 0원으로 청구하게 된다
     * (schema/part-unit-prices.ts 머리말). "0"은 무상 부품이라는 뜻이라 그대로 쓴다.
     *
     * 소유구분이 NULL 인 옛 요청은 붙일 단가가 없다 — 어느 소유구분의 값인지
     * 알 수 없는데 아무거나 가져오면 **다른 소유구분의 값으로 청구**하게 된다.
     */
    unitPrice: string | null;
    /**
     * 이 부품의 작업비(원, 수량과 무관). **null 이면 정하지 않은 것**이고,
     * 견적서 화면이 작업비 합계를 낼 때 그 부품 몫을 빼고 그 사실을 알린다
     * (schema/inventory.ts 의 laborCost — 0 으로 뭉개면 작업비를 실제보다
     * 적게 부르게 된다).
     */
    laborCost: string | null;
  }[];
  /** 이 장비에 이어진 O/H 부품 템플릿의 기종 코드. 안 이어져 있으면 null. */
  ohTemplateCode: string | null;
  /**
   * 그 기종의 **O/H 부품 목록**. 위 usedParts 와 성격이 전혀 다르다.
   *
   * ── 왜 출고 기록만으로는 안 되는가 ────────────────────────────────────
   * **O/H 견적은 부품을 출고하기 전에 낸다**(2026-08-31 사용자 확인). 얼마에
   * 할지를 먼저 알려 주고 승인을 받은 뒤에 뜯기 시작하므로, 그 시점에 출고
   * 기록은 비어 있다. 그래서 "무엇을 쓸 예정인가"는 템플릿이 답한다.
   *
   * ── 단가는 O/H 단가다 ────────────────────────────────────────────────
   * 여기서 온 줄은 O/H 템플릿에 적어 둔 단가를 따른다. 출고 기록에서 온 줄이
   * 부품 상세의 일반 단가를 따르는 것과 짝이다 — **어느 견적서인지가 아니라
   * 그 줄이 어디서 왔는지가 단가를 정한다**(2026-08-31 사용자 결정).
   *
   * 재고와 이어지지 않은 줄(part_id 가 NULL)도 그대로 준다. 이름과 수량은
   * 쓸모가 있고, 단가만 붙일 곳이 없어 null 이다.
   */
  ohTemplateParts: {
    /** 재고 마스터 연결. **null 이 정상이다**(schema/oh-part-templates.ts). */
    partId: string | null;
    /** 템플릿에 적힌 품명 그대로. part_id 가 있어도 이 글자를 쓴다. */
    partNameText: string;
    quantity: number;
    /** 그 부품의 O/H 단가. **null 이면 정하지 않은 것**이고 빈칸으로 둔다. */
    overhaulUnitPrice: string | null;
  }[];
};

/**
 * 인수번호 하나로 견적서 상단을 채울 값을 걷어 온다.
 *
 * 못 찾으면 null 이다. 아직 접수되지 않은 건으로 먼저 견적을 내는 일이 있어서
 * **오류가 아니다**(server/actions/quotes.ts 의 같은 항목).
 *
 * ── 지워진 접수 건도 찾는다 ─────────────────────────────────────────────
 * is_deleted 로 좁히지 않는다. 휴지통에 있는 건이라도 그 건으로 이미 견적을
 * 냈거나 내야 할 수 있고, 여기서 막으면 사람은 같은 값을 손으로 다시 적게 된다.
 * 보이지 않는 자료를 새로 만들어 주는 것이 아니라 **이미 시스템에 있는 값을
 * 옮겨 적어 주는 일**이라, 읽기 권한이 있는 사람에게 숨길 이유가 없다.
 *
 * ── 출고된 것만 센다 ────────────────────────────────────────────────────
 * inventory_part_request_items.issued_quantity > 0 인 줄만 본다. 요청했지만
 * 아직 안 나간 부품을 견적에 올리면 쓰지도 않은 값을 청구하게 된다.
 * 같은 부품을 여러 번 요청했으면 합쳐서 한 줄로 준다.
 */
export async function lookupIntakeForQuote(intakeNumber: string): Promise<QuoteIntakeLookup | null> {
  const [row] = await db
    .select({
      repairCaseId: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerId: repairCases.customerId,
      customerName: customers.name,
      modelName: products.modelName,
      lotNumber: products.lotNumber,
      serialNumber: products.serialNumber,
      faultDescription: repairCases.reportedSymptom,
      // 이 장비에 이어진 O/H 부품 템플릿의 기종 코드. 안 이어져 있으면 null 이고,
      // 그때 화면은 "모델을 이어 주세요"를 그린다.
      ohTemplateCode: ohPartTemplates.code,
      ohTemplateId: ohPartTemplates.id,
    })
    .from(repairCases)
    .leftJoin(customers, eq(customers.id, repairCases.customerId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    // 제품 모델 → O/H 부품 템플릿. **모델 하나는 템플릿 하나에만 붙으므로**
    // (schema/oh-part-templates.ts 의 unique) 이 조인이 행을 늘리지 않는다.
    // 지운 템플릿은 붙이지 않는다 — 휴지통에 있는 설정으로 청구하면 안 된다.
    .leftJoin(ohPartTemplateModels, eq(ohPartTemplateModels.productModelId, products.productModelId))
    .leftJoin(
      ohPartTemplates,
      and(eq(ohPartTemplates.id, ohPartTemplateModels.templateId), eq(ohPartTemplates.isDeleted, false))
    )
    .where(eq(repairCases.intakeNumber, intakeNumber))
    .limit(1);

  if (!row) return null;

  const usedPartRows = await db
    .select({
      partId: inventoryPartRequestItems.partId,
      partName: parts.partName,
      partSpec: parts.partSpec,
      owner: inventoryPartRequestItems.owner,
      issuedQuantity: inventoryPartRequestItems.issuedQuantity,
      // 그 소유구분에 정해 둔 단가. 소유구분이 NULL 이면 조인이 붙지 않아
      // null 이 온다 — 그때는 붙일 단가가 없는 것이 맞다(위 타입 주석).
      unitPrice: partUnitPrices.unitPrice,
      // 작업비는 소유구분과 무관하다 — parts 에 바로 있다.
      laborCost: parts.laborCost,
    })
    .from(inventoryPartRequestItems)
    .innerJoin(
      inventoryPartRequests,
      eq(inventoryPartRequests.id, inventoryPartRequestItems.requestId)
    )
    .innerJoin(parts, eq(parts.id, inventoryPartRequestItems.partId))
    .leftJoin(
      partUnitPrices,
      and(
        eq(partUnitPrices.partId, inventoryPartRequestItems.partId),
        eq(partUnitPrices.owner, inventoryPartRequestItems.owner)
      )
    )
    .where(
      and(
        eq(inventoryPartRequests.repairCaseId, row.repairCaseId),
        gt(inventoryPartRequestItems.issuedQuantity, 0)
      )
    )
    .orderBy(asc(parts.partName));

  /**
   * **(부품, 소유구분)** 짝으로 묶는다. 부품 하나로만 묶지 않는 이유는 단가가
   * 소유구분마다 다르기 때문이다 — DSS 것 하나와 교산 것 둘을 한 줄로 합치면
   * 어느 쪽 단가로 청구할지 답할 수 없다. 같은 부품이 두 줄로 보이는 편이
   * 정확하고, 실제로 두 소유구분에서 나간 것이 맞다.
   */
  const byPartAndOwner = new Map<string, QuoteIntakeLookup["usedParts"][number]>();
  for (const part of usedPartRows) {
    const key = `${part.partId}|${part.owner ?? ""}`;
    const existing = byPartAndOwner.get(key);
    if (existing) existing.quantity += part.issuedQuantity;
    else
      byPartAndOwner.set(key, {
        partId: part.partId,
        partName: part.partName,
        partSpec: part.partSpec,
        owner: part.owner,
        quantity: part.issuedQuantity,
        unitPrice: part.unitPrice,
        laborCost: part.laborCost,
      });
  }

  /**
   * 그 기종의 O/H 부품과 각각의 O/H 단가.
   *
   * 템플릿이 안 이어져 있으면 질의를 열지 않는다 — 없는 id 로 조회하는 것보다
   * 아예 묻지 않는 편이 낫고, 그때 화면은 "모델을 이어 주세요"를 그린다.
   *
   * 차례는 템플릿에 늘어놓은 순서 그대로다. **양식의 부품 순서가 뜻을 갖는다**
   * (휴즈 22개가 셋째 줄인 데는 이유가 있다 — schema/oh-part-templates.ts).
   */
  const ohTemplateParts = row.ohTemplateId
    ? await db
        .select({
          partId: ohPartTemplateItems.partId,
          partNameText: ohPartTemplateItems.partNameText,
          quantity: ohPartTemplateItems.quantity,
          // 재고와 이어지지 않은 줄은 붙일 단가가 없어 null 이 온다. 그 줄도
          // 버리지 않는다 — 이름과 수량은 그대로 쓸모가 있다.
          overhaulUnitPrice: partOverhaulUnitPrices.unitPrice,
        })
        .from(ohPartTemplateItems)
        .leftJoin(
          partOverhaulUnitPrices,
          eq(partOverhaulUnitPrices.partId, ohPartTemplateItems.partId)
        )
        .where(eq(ohPartTemplateItems.templateId, row.ohTemplateId))
        .orderBy(asc(ohPartTemplateItems.displayOrder))
    : [];

  // 칸을 하나씩 적는다. `...row` 로 펼치면 **ohTemplateId 까지 딸려 나가는데**,
  // 그 값은 여기서 부품을 걷어 오는 데만 쓴 내부 id 이고 화면은 쓰지 않는다.
  // 이 저장소는 "넘기는 값을 줄인다"를 지켜 왔다(oh-templates 페이지의 같은 판단).
  return {
    repairCaseId: row.repairCaseId,
    intakeNumber: row.intakeNumber,
    customerId: row.customerId,
    customerName: row.customerName,
    modelName: row.modelName,
    lotNumber: row.lotNumber,
    serialNumber: row.serialNumber,
    faultDescription: row.faultDescription,
    ohTemplateCode: row.ohTemplateCode,
    usedParts: [...byPartAndOwner.values()],
    ohTemplateParts,
  };
}

/**
 * 내자 정리 폼의 견적서 드롭다운. 살아 있는 견적서만, 최근 발행순으로.
 *
 * 목록 한 줄을 그대로 준다 — 사람이 고를 때 보는 것이 `DSS 2026-077 ICD
 * CFK300FH-IC2 …` 이고, 번호만 보여 주면 같은 모델의 여러 장 중 어느 것인지
 * 가릴 수 없다(domain/quote-list.ts).
 *
 * `repairCaseId` 는 글자로 그리는 값이 아니다 — 폼이 **지금 고른 수리 건의
 * 견적서만** 후보로 남기는 데 쓴다(domain/quote-link-options.ts). NULL 이면
 * 수리 건이 붙지 않은 견적서라 어느 건의 후보에도 뜨지 않는다.
 */
export async function listQuoteOptions(): Promise<
  { id: string; summaryLine: string; quoteDate: string; repairCaseId: string | null }[]
> {
  const rows = await db
    .select({
      id: quotes.id,
      repairCaseId: quotes.repairCaseId,
      quoteNumber: quotes.quoteNumber,
      quoteDate: quotes.quoteDate,
      customerNameText: quotes.customerNameText,
      modelNameText: quotes.modelNameText,
      lotNumberText: quotes.lotNumberText,
      serialNumberText: quotes.serialNumberText,
      faultDescriptionText: quotes.faultDescriptionText,
    })
    .from(quotes)
    .where(eq(quotes.isDeleted, false))
    .orderBy(desc(quotes.quoteDate), desc(quotes.createdAt));

  return rows.map((row) => ({
    id: row.id,
    quoteDate: row.quoteDate,
    repairCaseId: row.repairCaseId,
    summaryLine: buildQuoteSummaryLine({
      quoteNumber: row.quoteNumber,
      customerName: row.customerNameText,
      modelName: row.modelNameText,
      lotNumber: row.lotNumberText,
      serialNumber: row.serialNumberText,
      faultDescription: row.faultDescriptionText,
    }),
  }));
}
