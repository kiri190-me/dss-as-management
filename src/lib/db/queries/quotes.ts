import "server-only";

import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  inventoryPartRequestItems,
  inventoryPartRequests,
  partUnitPrices,
  parts,
  products,
  quoteItems,
  quotes,
  repairCases,
} from "../schema";
import { buildQuoteSummaryLine, sumQuoteSupplyAmount } from "@/lib/domain/quote-list";
import type { StockOwner } from "@/lib/domain/inventory-types";
import type { QuoteKind } from "@/lib/validation/quote-input";

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
  kind: QuoteKind;
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
  /** 공급가(부가세 별도). 부품 줄 합 + 작업비. */
  supplyAmount: number;
  itemCount: number;
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
      repairCaseId: quotes.repairCaseId,
      // 연결이 살아 있으면 진짜 인수번호, 아니면 이 표에 남은 글자.
      linkedIntakeNumber: repairCases.intakeNumber,
      intakeNumberText: quotes.intakeNumberText,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .leftJoin(repairCases, eq(repairCases.id, quotes.repairCaseId))
    .where(eq(quotes.isDeleted, false))
    .orderBy(desc(quotes.quoteDate), desc(quotes.createdAt));

  const itemsByQuoteId = await loadItemsByQuoteId(rows.map((row) => row.id));

  return rows.map((row) => {
    const items = itemsByQuoteId.get(row.id) ?? [];
    return {
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
      supplyAmount: sumQuoteSupplyAmount(items, row.workCost),
      itemCount: items.length,
    };
  });
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

type QuoteItemAmount = { quantity: number; unitPrice: string };

/** 여러 장의 부품 줄을 **질의 한 번으로** 걷어 와 장마다 묶는다. 위 '목록' 주석 참조. */
async function loadItemsByQuoteId(quoteIds: string[]): Promise<Map<string, QuoteItemAmount[]>> {
  const grouped = new Map<string, QuoteItemAmount[]>();
  // inArray 에 빈 배열을 넘기면 뜻 없는 SQL 이 만들어진다. 읽을 장이 없으면
  // 질의 자체를 하지 않는 것이 맞다.
  if (quoteIds.length === 0) return grouped;

  const rows = await db
    .select({
      quoteId: quoteItems.quoteId,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
    })
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, quoteIds))
    .orderBy(asc(quoteItems.lineNo));

  for (const row of rows) {
    const bucket = grouped.get(row.quoteId);
    const item: QuoteItemAmount = { quantity: row.quantity, unitPrice: row.unitPrice };
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
    })
    .from(quotes)
    .where(and(eq(quotes.id, id), eq(quotes.isDeleted, false)))
    .limit(1);

  if (!row) return null;

  const items = await db
    .select({
      partId: quoteItems.partId,
      partNameText: quoteItems.partNameText,
      isOverhaulPart: quoteItems.isOverhaulPart,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
    })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.lineNo));

  return { ...row, items };
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
     * 이 부품 한 개당 작업비(원). **null 이면 정하지 않은 것**이고,
     * 견적서 화면이 작업비 합계를 낼 때 그 부품 몫을 빼고 그 사실을 알린다
     * (schema/inventory.ts 의 laborCost — 0 으로 뭉개면 작업비를 실제보다
     * 적게 부르게 된다).
     */
    laborCost: string | null;
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
    })
    .from(repairCases)
    .leftJoin(customers, eq(customers.id, repairCases.customerId))
    .leftJoin(products, eq(products.id, repairCases.productId))
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

  return { ...row, usedParts: [...byPartAndOwner.values()] };
}

/**
 * 내자 정리 폼의 견적서 드롭다운. 살아 있는 견적서만, 최근 발행순으로.
 *
 * 목록 한 줄을 그대로 준다 — 사람이 고를 때 보는 것이 `DSS 2026-077 ICD
 * CFK300FH-IC2 …` 이고, 번호만 보여 주면 같은 모델의 여러 장 중 어느 것인지
 * 가릴 수 없다(domain/quote-list.ts).
 */
export async function listQuoteOptions(): Promise<
  { id: string; summaryLine: string; quoteDate: string }[]
> {
  const rows = await db
    .select({
      id: quotes.id,
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
