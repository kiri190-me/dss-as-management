import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../client";
import {
  customers,
  parts,
  quoteItems,
  quoteRepairTasks,
  quoteWorkScopeLines,
  quotes,
  repairCases,
} from "../schema";
import {
  quoteExcelOnlyFieldErrors,
  type QuoteFields,
  type QuoteItemInput,
  type QuoteRepairTaskInput,
} from "@/lib/validation/quote-input";
import {
  isQuoteContentUnchanged,
  type QuoteContentSnapshot,
} from "@/lib/domain/quote-change-detection";
import type { QuoteSaveOutcome } from "@/lib/domain/quote-save-outcome";
import { autoRejectQuoteApprovalAfterEdit } from "./quote-approval-auto-reject";

/**
 * ============================================================================
 * 견적서 — 만들기·고치기 (4단계)
 * ============================================================================
 * 이 계층은 **기계**다. 누가 고칠 수 있는지는 여기서 묻지 않는다 —
 * 세션·역할·설정은 서버 액션(server/actions/quotes.ts)이 보고, 이 파일은 자료의
 * 규칙만 지킨다(존재하는가 · 지워졌는가 · 번호가 겹치는가 · 그 사이 누가
 * 고쳤는가). mutations/domestic-orders.ts 와 같은 구조이고, 통합 테스트가 인가를
 * 흉내 내지 않고도 자료 규칙을 검증할 수 있는 이유이기도 하다.
 *
 * ── 동시 수정은 version 으로 막는다 ─────────────────────────────────────
 *  1. 트랜잭션을 열고 대상 행을 `.for("update")` 로 잠근다.
 *  2. 없거나 이미 지워진 행이면 NOT_FOUND.
 *  3. version 이 어긋나면 CONFLICT — 화면은 폼을 얼리고 다시 불러오게 한다.
 *  4. 값과 함께 version + 1, updated_at, updated_by 를 쓴다.
 *
 * 잠금을 먼저 잡는 이유: 읽고 나서 쓰기까지 사이에 남이 끼어들면 "둘 다
 * 성공했는데 한쪽 내용이 사라진" 상태가 만들어진다. 견적서는 고객사로 나가는
 * 문서라 금액이 조용히 덮이면 안 된다.
 *
 * ── 번호 중복은 DB 가 최종 판정한다 ─────────────────────────────────────
 * 부분 unique 인덱스(quotes_quote_number_not_deleted_unique)가 진짜 관문이다.
 * 아래에서 미리 한 번 보는 것은 **사용자에게 어느 칸이 문제인지 말해 주기
 * 위해서**이지 관문이 아니다 — 확인과 저장 사이에 남이 같은 번호를 쓸 수 있고,
 * 그때는 23505 가 올라온다. 그 오류도 잡아서 같은 칸 오류로 바꿔 돌려준다.
 *
 * **지워진 견적서의 번호는 다시 쓸 수 있다.** 인덱스가 `is_deleted = false`
 * 로 좁혀져 있고(schema/quotes.ts), 그러니 중복 검사도 같은 조건으로 봐야 한다 —
 * 여기서만 넓게 보면 "DB 는 허락하는데 화면이 거절하는" 번호가 생긴다.
 *
 * ── 부품 줄은 통째로 갈아 끼운다 ────────────────────────────────────────
 * 폼은 목록을 통째로 편집한다(줄을 더하고, 빼고, 순서대로 늘어놓는다). 저장이
 * 받는 것은 "이 견적서의 부품은 지금부터 이것이 전부"라는 말이고, 그 말을
 * 그대로 옮기는 방법이 전부 지우고 다시 넣는 것이다. 하나씩 대조해 넣고 빼는
 * 방식은 같은 결과를 훨씬 어렵게 만들 뿐이고, 그 어려움은 "폼에서 지웠는데
 * 남아 있는 부품" 같은 모양으로 드러난다(mutations/domestic-orders.ts 의
 * replaceDueDates 와 같은 판단).
 *
 * ── 🔴 **아무것도 안 바뀐 저장은 한 글자도 쓰지 않는다** (2026-10-31) ─────
 * 고치기는 저장 전에 **DB 의 지금 내용과 들어온 내용을 견준다**. 같으면 UPDATE 도,
 * 줄 갈아 끼우기도, **판 번호 올리기도** 하지 않고 `UNCHANGED` 로 끝낸다.
 *
 * 🔴 판 번호를 안 올리는 것이 요점이다. 전에는 내용과 무관하게 `version + 1` 이라,
 * 아무것도 고치지 않고 [저장]만 눌러도 승인 건이 「승인 후 변경됨」
 * (APPROVED_OUTDATED)으로 뒤집혔다 — 사용자가 「안 바뀐 저장은 반려하지 않는다」로
 * 정한 그 결정이 그대로는 아무 뜻이 없다(domain/quote-save-outcome.ts).
 *
 * 견주는 규칙(어디까지 보는가 · 「같다」의 기준)은 여기 적지 않는다 —
 * domain/quote-change-detection.ts 한 곳이다. 그래야 「`""` 과 `null` 이 같은가」
 * 같은 물음 하나에 DB 를 띄우는 시험이 붙지 않는다.
 *
 * ── 🔴 **내용이 바뀌면 올라가 있던 결재가 자동으로 반려된다** (2026-10-31) ──
 * 저장과 **같은 트랜잭션** 안에서 처리한다 — 저장이 되돌아가면 반려도 함께 없던
 * 일이 되어야 한다. 하는 일은 mutations/quote-approval-auto-reject.ts 한 곳에
 * 있고, 사람이 반려하는 길(decideQuoteApproval)은 건드리지 않았다. 2026-09-18 의
 * 「이 표를 보고 발행을 막지 말 것」과 어긋나지 않는 까닭은 그 파일 머리말에 있다.
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * subject · faultDescriptionText · validity · delivery · payment 는 사람이
 * 자유롭게 적는 값이라 고객사 사정이 섞일 수 있다(schema/quotes.ts 의 PII 항목).
 * 이 파일은 실패해도 그 값들을 오류 메시지에 담지 않는다.
 * ============================================================================
 */

/** 트랜잭션 핸들. 아래 도우미들이 같은 트랜잭션 안에서 읽도록 못 박는다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type QuoteMutationResultCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR";

export type QuoteMutationResult =
  | {
      ok: true;
      id: string;
      version: number;
      /**
       * 🔴 **저장이 무슨 일을 했는가**(2026-10-31). 화면이 이것을 보고 팝업을
       * 고른다 — 화면은 결재 상태도, DB 에 지금 무엇이 들어 있는지도 모른다
       * (domain/quote-save-outcome.ts 머리말).
       */
      outcome: QuoteSaveOutcome;
    }
  | {
      ok: false;
      code: QuoteMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 견적서를 먼저 수정했습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";
const NOT_FOUND_MESSAGE = "해당 견적서를 찾을 수 없습니다.";
const UNKNOWN_REFERENCE_MESSAGE = "입력값을 확인해 주세요.";
const DUPLICATE_NUMBER_MESSAGE = "이미 같은 발행번호의 견적서가 있습니다.";

/** Postgres unique_violation. 위 '번호 중복은 DB 가 최종 판정한다' 참조. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * quotes 에 실제로 쓰는 컬럼 묶음. 만들기와 고치기가 **같은 표**를 쓰도록 한
 * 함수로 뽑아 둔다 — 두 곳에 나눠 적으면 칸이 하나 늘어날 때 한쪽만 고쳐지고,
 * 그때 생기는 증상은 "새로 만들면 들어가는데 고치면 안 들어가는 칸"이다.
 */
function toColumnValues(fields: QuoteFields) {
  return {
    quoteNumber: fields.quoteNumber,
    // 종류. 여기 빠지면 사람이 골라도 저장되지 않는 칸이 된다.
    kind: fields.kind,
    quoteDate: fields.quoteDate,
    repairCaseId: fields.repairCaseId,
    intakeNumberText: fields.intakeNumberText,
    customerId: fields.customerId,
    customerNameText: fields.customerNameText,
    modelNameText: fields.modelNameText,
    lotNumberText: fields.lotNumberText,
    serialNumberText: fields.serialNumberText,
    faultDescriptionText: fields.faultDescriptionText,
    subject: fields.subject,
    validity: fields.validity,
    delivery: fields.delivery,
    payment: fields.payment,
    /**
     * 특이사항 — 케이블 견적서 양식 10번(2026-09-16). 만들 때도 고칠 때도 이 한
     * 곳을 지난다. 내자 · OH 는 화면이 보내지 않아 늘 null 이다(그 두 양식에는
     * 이 항목이 없다 — schema/quotes.ts 의 remarks).
     */
    remarks: fields.remarks,
    workCost: fields.workCost,
    // 작업비의 근거. 여기 빠지면 사람이 작업을 골라도 다시 열었을 때 사라진다
    // (이 함수 머리말의 "새로 만들면 들어가는데 고치면 안 들어가는 칸").
    laborEquipmentKind: fields.laborEquipmentKind,
    laborBaseCost: fields.laborBaseCost,
    /**
     * 통전작업 제외와 **그때 뺀 금액**.
     *
     * 🔴 **화면이 보낸 금액을 그대로 적는다.** 여기서 repair_labor_settings 를
     * 다시 보고 셈하면 스냅샷을 두는 이유가 무너진다 — 통전 공수시간이 바뀌는
     * 순간 이미 보낸 견적서의 근거가 소리 없이 달라진다(schema/quotes.ts).
     */
    powerTestExcluded: fields.powerTestExcluded,
    laborPowerTestDeduction: fields.laborPowerTestDeduction,
    /**
     * 「① 조사작업」 뺌 — 조사 칸을 손대서 비운 채 저장했는가(2026-09-15). 만들 때도
     * 고칠 때도 이 한 곳을 지난다 — 빠지면 고친 뒤 다시 열었을 때 결정이 사라진다.
     */
    investigationExcluded: fields.investigationExcluded,
    /**
     * 서류작업 제외 — 기본 작업비에서 서류 몫을 뺐는가(2026-09-16). 만들 때도 고칠 때도
     * 이 한 곳을 지난다 — 빠지면 켜고 저장해도 다시 열었을 때 꺼져 있다.
     *
     * 🔴 **금액 짝이 없다.** 통전의 laborPowerTestDeduction 같은 칸을 서류에는 두지
     * 않았다(조사에도 없다 — domain/quote-labor-cost.ts 머리말). 뺀 사실만 남는다.
     */
    documentExcluded: fields.documentExcluded,
    /**
     * 엑셀 전용 견적서와 손으로 적은 공급가액(2026-09-15 Q2). 만들 때도 고칠 때도 이 한
     * 곳을 지난다. 엑셀 전용이 아니면 수기 금액은 늘 null 이다 — 검증이 먼저 막고
     * (validation/quote-input.ts 의 quoteExcelOnlyFieldErrors), DB CHECK
     * quotes_manual_supply_amount_excel_only 가 마지막으로 막는다.
     */
    isExcelOnly: fields.isExcelOnly,
    manualSupplyAmount: fields.manualSupplyAmount,
  };
}

function duplicateNumberResult(): QuoteMutationResult {
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    fieldErrors: { quoteNumber: DUPLICATE_NUMBER_MESSAGE },
    message: DUPLICATE_NUMBER_MESSAGE,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

/**
 * 이 번호를 이미 쓰고 있는 살아 있는 견적서가 있는가.
 * excludeId 는 수정용이다 — 자기 번호를 자기가 중복이라고 말하면 안 된다.
 */
async function quoteNumberTaken(tx: Tx, quoteNumber: string, excludeId?: string): Promise<boolean> {
  const conditions = [eq(quotes.quoteNumber, quoteNumber), eq(quotes.isDeleted, false)];
  if (excludeId) conditions.push(ne(quotes.id, excludeId));
  const [row] = await tx
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
}

/**
 * 가리키는 곳들이 실제로 있는가. 없으면 FK 위반(23503)이 나는데, 그 오류는
 * 사용자에게 아무것도 설명하지 못한다 — 어느 칸이 문제인지 말해 주는 편이 낫다.
 *
 * **is_deleted 를 보지 않는 것은 일부러다.** 휴지통에 있는 수리 건·고객사·부품이
 * 이미 적혀 있는 견적서는 목록에 그대로 보이는데, 그 장의 다른 칸을 고치려 할 때
 * 그 연결 때문에 저장이 막히면 화면에 보이는 값을 저장할 수 없는 상태가 된다
 * (mutations/domestic-orders.ts 의 같은 항목). 새로 고르는 목록에서 빼는 일은
 * 조회 쪽이 한다.
 */
async function checkReferences(tx: Tx, fields: QuoteFields): Promise<QuoteMutationResult | null> {
  if (fields.repairCaseId) {
    const [row] = await tx
      .select({ id: repairCases.id })
      .from(repairCases)
      .where(eq(repairCases.id, fields.repairCaseId))
      .limit(1);
    if (!row) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { repairCaseId: "선택한 수리 건을 찾을 수 없습니다." },
        message: UNKNOWN_REFERENCE_MESSAGE,
      };
    }
  }

  if (fields.customerId) {
    const [row] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, fields.customerId))
      .limit(1);
    if (!row) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { customerId: "선택한 고객사를 찾을 수 없습니다." },
        message: UNKNOWN_REFERENCE_MESSAGE,
      };
    }
  }

  for (const [index, item] of fields.items.entries()) {
    if (!item.partId) continue;
    const [row] = await tx
      .select({ id: parts.id })
      .from(parts)
      .where(eq(parts.id, item.partId))
      .limit(1);
    if (!row) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { [`items.${index}.partId`]: `${index + 1}번째 부품을 재고에서 찾을 수 없습니다.` },
        message: UNKNOWN_REFERENCE_MESSAGE,
      };
    }
  }

  return null;
}

/**
 * 이 견적서의 부품 줄을 **받은 목록 그대로** 만든다 — 전부 지우고 다시 넣는다.
 *
 * ⚠️ **반드시 quote_id 로 좁힌다.** 조건 없는 delete 는 이 표를 통째로 비운다 —
 * 한 장의 부품을 고치는 일이 모든 견적서의 부품을 지우는 일이 되어서는 안 된다.
 *
 * ⚠️ **반드시 부르는 쪽의 트랜잭션 안에서만** 부른다(tx 를 받는 이유). 부모
 * 저장이 CONFLICT 로 끝나는 길에서는 아예 불리지 않아야 한다.
 *
 * 차례(line_no)는 배열 index + 1 이다. 폼에 늘어놓은 순서가 곧 차례라서
 * (validation/quote-input.ts 의 normalizeItems 주석), 조회가 그 차례로 다시
 * 읽으면 사람이 보던 순서가 그대로 돌아온다.
 *
 * 🔴 **설명 줄도 같은 목록에 섞여 온다**(케이블 견적서 — kind = "NOTE"). 그 줄이
 * 어느 품목 묶음 위에 붙는지가 곧 뜻이므로, 종류별로 나눠 담지 않고 **받은 차례
 * 그대로** 넣는다. 수량 · 단가는 검증이 이미 null 로 못 박았다.
 */
/**
 * 품목 줄 하나가 표에 **실제로 적히는 값**. 차례(line_no)는 여기 없다 — 배열
 * 순서가 곧 차례이고, 그것은 넣는 쪽이 정한다.
 *
 * 🔴 **따로 뽑아 둔 까닭**: 「안 바뀌었는가」를 견주는 쪽(updateQuote)이 **이 함수가
 * 만든 값**으로 견준다. 두 곳에 같은 기본값(`?? "ITEM"` · `?? null`)을 적으면
 * 언젠가 한쪽만 고쳐지고, 그때 증상은 「그 칸만 고치고 저장하면 아무 일도 안
 * 일어난다」로 나타난다 — 오류가 아니라 침묵이다.
 */
function itemRowValues(item: QuoteItemInput) {
  return {
    // 종류를 안 보낸 줄은 품목 줄이다 — DB 칸의 DEFAULT 와 같은 규칙이고, 설명
    // 줄이 잘못 끼면 CHECK 가 거절한다(schema/quotes.ts 의 quoteItemKindEnum).
    kind: item.kind ?? "ITEM",
    partId: item.partId,
    partNameText: item.partNameText,
    partSpecText: item.partSpecText ?? null,
    isOverhaulPart: item.isOverhaulPart,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    /**
     * 재고 관리의 부품 번호. 검증이 이미 정수로 재어 두었고, 설명 줄에서는 null 로
     * 못 박았다(validation/quote-input.ts 의 그 항목 · CHECK
     * quote_items_inventory_part_no_item_line_only).
     *
     * 🔴 **재고 연결(part_id)과 같은 줄에 둘 다 차는 일은 없다** — 화면이 집어 넣은 줄은
     *    FK 쪽을 비우고 이 번호를 적는다(그 번호는 A/S parts.id 가 아니다). 두 칸을 한
     *    칸으로 합칠 수 없는 까닭이 그것이다.
     */
    inventoryPartNo: item.inventoryPartNo ?? null,
  };
}

/** 고른 수리 작업 한 줄이 표에 적히는 값. 위 itemRowValues 와 같은 까닭으로 뽑아 둔다. */
function repairTaskRowValues(task: QuoteRepairTaskInput) {
  return {
    taskId: task.taskId,
    taskNameText: task.taskName,
    hours: task.hours,
    hourlyRate: task.hourlyRate,
  };
}

async function replaceItems(tx: Tx, quoteId: string, fields: QuoteFields) {
  await tx.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  if (fields.items.length === 0) return;

  await tx.insert(quoteItems).values(
    fields.items.map((item, index) => ({
      quoteId,
      lineNo: index + 1,
      ...itemRowValues(item),
    }))
  );
}

/**
 * 고른 수리 작업을 통째로 갈아 끼운다. 부품 줄(replaceItems)과 같은 방식이다 —
 * 폼이 목록을 통째로 편집하므로, 저장이 받는 것은 "이 견적서가 고른 작업은
 * 지금부터 이것이 전부"라는 말이다.
 *
 * 카탈로그를 보지 않고 **넘어온 사본을 그대로 넣는다.** 지금 카탈로그 값으로 다시
 * 읽으면, 단가가 오른 뒤 옛 견적서를 고칠 때 손대지도 않은 작업의 금액이 바뀐다.
 */
/**
 * 견적서에 적히는 작업 내역을 통째로 갈아 끼운다. 부품 줄·수리 작업과 같은 방식.
 *
 * 차례(line_no)는 **묶음 안에서** 1부터 매긴다 — 문서의 `1) 조사작업` 아래
 * 몇 번째 줄인가가 그 뜻이고, 세 묶음이 하나의 번호를 나눠 쓰면 한 묶음의 줄을
 * 지웠을 때 다른 묶음의 번호까지 흔들린다.
 */
async function replaceWorkScopeLines(tx: Tx, quoteId: string, fields: QuoteFields) {
  await tx.delete(quoteWorkScopeLines).where(eq(quoteWorkScopeLines.quoteId, quoteId));
  if (fields.workScopeLines.length === 0) return;

  const nextLineNo = new Map<string, number>();
  await tx.insert(quoteWorkScopeLines).values(
    fields.workScopeLines.map((line) => {
      const lineNo = (nextLineNo.get(line.section) ?? 0) + 1;
      nextLineNo.set(line.section, lineNo);
      return { quoteId, section: line.section, lineNo, text: line.text };
    })
  );
}

async function replaceRepairTasks(tx: Tx, quoteId: string, fields: QuoteFields) {
  await tx.delete(quoteRepairTasks).where(eq(quoteRepairTasks.quoteId, quoteId));
  if (fields.repairTasks.length === 0) return;

  await tx.insert(quoteRepairTasks).values(
    fields.repairTasks.map((task, index) => ({
      quoteId,
      lineNo: index + 1,
      ...repairTaskRowValues(task),
    }))
  );
}

/**
 * ============================================================================
 * 🔴 「정말 바뀌었는가」를 견줄 한 벌 (2026-10-31)
 * ============================================================================
 * 들어온 쪽과 DB 쪽을 **같은 모양**으로 만들어 domain/quote-change-detection.ts 에
 * 넘긴다. 규칙은 전부 그쪽에 있고, 여기서 하는 일은 모양을 맞추는 것뿐이다.
 */
function incomingSnapshot(fields: QuoteFields): QuoteContentSnapshot {
  return {
    // 🔴 **저장이 실제로 쓰는 묶음 그대로**다. 칸이 하나 늘면 비교도 저절로
    //    따라 는다(quoteColumnsEqual 이 이 묶음의 키를 돈다).
    columns: toColumnValues(fields),
    items: fields.items.map(itemRowValues),
    repairTasks: fields.repairTasks.map(repairTaskRowValues),
    workScopeLines: fields.workScopeLines,
  };
}

/**
 * DB 에 지금 들어 있는 내용. 🔴 **같은 트랜잭션 안에서** 읽는다 — 견적서 행을
 * 이미 FOR UPDATE 로 잡아 둔 뒤라, 견주는 동안 남이 끼어들 수 없다.
 *
 * 차례는 저장이 매긴 그대로 읽는다: 품목 · 수리 작업은 `line_no`, 작업 내역은
 * **묶음 안의** `line_no` 다(replaceWorkScopeLines 가 묶음마다 1부터 매긴다).
 */
async function storedSnapshot(
  tx: Tx,
  quoteId: string,
  storedColumns: Record<string, unknown>
): Promise<QuoteContentSnapshot> {
  const [items, repairTasks, workScopeLines] = await Promise.all([
    tx
      .select({
        kind: quoteItems.kind,
        partId: quoteItems.partId,
        partNameText: quoteItems.partNameText,
        partSpecText: quoteItems.partSpecText,
        isOverhaulPart: quoteItems.isOverhaulPart,
        quantity: quoteItems.quantity,
        unitPrice: quoteItems.unitPrice,
        inventoryPartNo: quoteItems.inventoryPartNo,
      })
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, quoteId))
      .orderBy(quoteItems.lineNo),
    tx
      .select({
        taskId: quoteRepairTasks.taskId,
        taskNameText: quoteRepairTasks.taskNameText,
        hours: quoteRepairTasks.hours,
        hourlyRate: quoteRepairTasks.hourlyRate,
      })
      .from(quoteRepairTasks)
      .where(eq(quoteRepairTasks.quoteId, quoteId))
      .orderBy(quoteRepairTasks.lineNo),
    tx
      .select({ section: quoteWorkScopeLines.section, text: quoteWorkScopeLines.text })
      .from(quoteWorkScopeLines)
      .where(eq(quoteWorkScopeLines.quoteId, quoteId))
      .orderBy(quoteWorkScopeLines.section, quoteWorkScopeLines.lineNo),
  ]);
  return { columns: storedColumns, items, repairTasks, workScopeLines };
}

/** 새 견적서 한 장. version 은 스키마 기본값 1로 시작한다. */
export async function createQuote(params: {
  fields: QuoteFields;
  actorUserId: string;
}): Promise<QuoteMutationResult> {
  const excelOnlyViolation = excelOnlyViolationResult(params.fields);
  if (excelOnlyViolation) return excelOnlyViolation;

  try {
    return await db.transaction(async (tx): Promise<QuoteMutationResult> => {
      const badReference = await checkReferences(tx, params.fields);
      if (badReference) return badReference;
      if (await quoteNumberTaken(tx, params.fields.quoteNumber)) return duplicateNumberResult();

      const [inserted] = await tx
        .insert(quotes)
        .values({
          ...toColumnValues(params.fields),
          createdBy: params.actorUserId,
          // 만든 사람이 곧 마지막으로 고친 사람이다. 비워 두면 "누가 마지막으로
          // 손댔는가"가 첫 수정 전까지 빈칸으로 남는다.
          updatedBy: params.actorUserId,
        })
        .returning({ id: quotes.id, version: quotes.version });

      // 같은 트랜잭션 안이다 — 부품을 넣다 실패하면 방금 만든 장도 함께 없던
      // 일이 된다. 부품만 빠진 견적서가 남는 편이 더 나쁘다: 화면에는 정상으로
      // 보이는데 금액이 작업비뿐인 장이 된다.
      await replaceItems(tx, inserted.id, params.fields);
      await replaceRepairTasks(tx, inserted.id, params.fields);
      await replaceWorkScopeLines(tx, inserted.id, params.fields);

      // 🔴 새 장에는 견줄 어제가 없고 결재도 아직 없다 — 언제나 `SAVED` 다.
      return { ok: true, id: inserted.id, version: inserted.version, outcome: "SAVED" };
    });
  } catch (err) {
    // 미리 본 뒤 저장 사이에 남이 같은 번호를 쓴 경우. 위 '번호 중복' 항목 참조.
    if (isUniqueViolation(err)) return duplicateNumberResult();
    throw err;
  }
}

/**
 * 엑셀 전용 견적서의 규칙 — **마지막 방어선**(2026-09-15 Q2). 검증이 이미 같은 함수로
 * 막았으므로(validation/quote-input.ts 의 quoteExcelOnlyFieldErrors) 여기까지 오는 것은
 * 검증을 거치지 않은 호출뿐이다. 그래도 막는 까닭: 엑셀 전용 장에 줄이 저장되면 문서
 * (붙인 엑셀)와 시스템의 품목이 두 벌이 되고, 어느 쪽이 보낸 금액인지 답할 수 없다.
 * 수기 금액 쪽은 DB CHECK 도 막지만, 거기서 걸리면 사람에게는 「일시적으로 저장할 수
 * 없습니다」로만 보인다. 트랜잭션을 열기 **전에** 본다 — 아무것도 쓰지 않는다.
 */
function excelOnlyViolationResult(fields: QuoteFields): QuoteMutationResult | null {
  const fieldErrors = quoteExcelOnlyFieldErrors(fields);
  const first = Object.values(fieldErrors)[0];
  if (first === undefined) return null;
  return { ok: false, code: "VALIDATION_ERROR", fieldErrors, message: first };
}

/** 있는 견적서 한 장. 위 '동시 수정은 version 으로 막는다' 순서를 그대로 따른다. */
export async function updateQuote(params: {
  id: string;
  expectedVersion: number;
  fields: QuoteFields;
  actorUserId: string;
}): Promise<QuoteMutationResult> {
  const excelOnlyViolation = excelOnlyViolationResult(params.fields);
  if (excelOnlyViolation) return excelOnlyViolation;

  try {
    return await db.transaction(async (tx): Promise<QuoteMutationResult> => {
      /**
       * 🔴 **행을 통째로 읽는다**(2026-10-31). 고를 칸을 적어 두지 않는 것은
       * 일부러다 — 아래에서 「바뀌었는가」를 견줄 때 `toColumnValues` 가 만든
       * 묶음의 **이름으로** 이 행에서 값을 집어 오기 때문이다. 칸 목록을 여기
       * 한 벌 더 적어 두면, 칸이 하나 늘어난 날 저장은 그 칸을 쓰는데 비교는
       * 못 보는 상태가 되고 그때 그 칸의 수정은 **조용히 버려진다.**
       *
       * (drizzle 의 칸 이름이 곧 `toColumnValues` 의 키다 — 둘이 같은 스키마
       * 객체에서 나온다.)
       */
      const [existing] = await tx
        .select()
        .from(quotes)
        .where(eq(quotes.id, params.id))
        .limit(1)
        .for("update");

      // 지워진 장은 목록에 없다. 화면에 없는 것을 고치려는 요청에는 "찾을 수
      // 없다"가 정확한 답이다 — 수정이 되살리기를 겸하면 지운 기록이 조용히
      // 되살아난다.
      if (!existing || existing.isDeleted) {
        return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
      }
      if (existing.version !== params.expectedVersion) {
        return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
      }

      const badReference = await checkReferences(tx, params.fields);
      if (badReference) return badReference;
      if (await quoteNumberTaken(tx, params.fields.quoteNumber, params.id)) {
        return duplicateNumberResult();
      }

      /**
       * 🔴 **아무것도 안 바뀌었으면 여기서 끝난다** — UPDATE 도, 줄 갈아 끼우기도,
       * 판 번호 올리기도, 결재 자동 반려도 하지 않는다(파일 머리말).
       *
       * 🔴 **검증을 모두 지난 뒤에** 본다. 번호가 겹치거나 가리키는 곳이 사라진
       * 요청은 「안 바뀜」이 아니라 **잘못된 요청**이고, 그 답을 「바뀐 게 없습니다」로
       * 덮으면 사람은 무엇이 문제인지 영영 모른다.
       */
      const stored = await storedSnapshot(tx, params.id, existing);
      if (isQuoteContentUnchanged(incomingSnapshot(params.fields), stored)) {
        return { ok: true, id: existing.id, version: existing.version, outcome: "UNCHANGED" };
      }

      const [updated] = await tx
        .update(quotes)
        .set({
          ...toColumnValues(params.fields),
          version: sql`${quotes.version} + 1`,
          updatedAt: new Date(),
          updatedBy: params.actorUserId,
        })
        .where(eq(quotes.id, params.id))
        .returning({ id: quotes.id, version: quotes.version });

      // version 대조를 통과한 뒤에만 부품을 건드린다 — CONFLICT 로 끝난 저장은
      // 부품을 한 줄도 지우지 않는다(같은 트랜잭션이므로 위에서 이미 반환됐다).
      await replaceItems(tx, params.id, params.fields);
      await replaceRepairTasks(tx, params.id, params.fields);
      await replaceWorkScopeLines(tx, params.id, params.fields);

      /**
       * 🔴 **내용이 바뀌었으니 올라가 있던 결재를 자동으로 반려한다**(2026-10-31
       * 사용자 요구). 여기까지 온 것은 「정말 바뀌었다」가 확인된 길뿐이다.
       *
       * 🔴 **같은 트랜잭션 안**이다 — 저장이 뒤에서 되돌아가면(번호 중복 23505 등)
       * 반려도 함께 없던 일이 되어야 한다. 되돌아가지 않으면 「견적서는 그대로인데
       * 결재만 반려된」 장이 남고, 그 상태를 설명하는 화면이 어디에도 없다.
       */
      const autoRejected = await autoRejectQuoteApprovalAfterEdit(tx, {
        quoteId: params.id,
        actorUserId: params.actorUserId,
      });

      return {
        ok: true,
        id: updated.id,
        version: updated.version,
        outcome: autoRejected.rejected ? "APPROVAL_AUTO_REJECTED" : "SAVED",
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return duplicateNumberResult();
    throw err;
  }
}
