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
import type { QuoteFields } from "@/lib/validation/quote-input";

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
  | { ok: true; id: string; version: number }
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
    workCost: fields.workCost,
    // 작업비의 근거. 여기 빠지면 사람이 작업을 골라도 다시 열었을 때 사라진다
    // (이 함수 머리말의 "새로 만들면 들어가는데 고치면 안 들어가는 칸").
    laborEquipmentKind: fields.laborEquipmentKind,
    laborBaseCost: fields.laborBaseCost,
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
 */
async function replaceItems(tx: Tx, quoteId: string, fields: QuoteFields) {
  await tx.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  if (fields.items.length === 0) return;

  await tx.insert(quoteItems).values(
    fields.items.map((item, index) => ({
      quoteId,
      lineNo: index + 1,
      partId: item.partId,
      partNameText: item.partNameText,
      isOverhaulPart: item.isOverhaulPart,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
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
      taskId: task.taskId,
      taskNameText: task.taskName,
      hours: task.hours,
      hourlyRate: task.hourlyRate,
    }))
  );
}

/** 새 견적서 한 장. version 은 스키마 기본값 1로 시작한다. */
export async function createQuote(params: {
  fields: QuoteFields;
  actorUserId: string;
}): Promise<QuoteMutationResult> {
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

      return { ok: true, id: inserted.id, version: inserted.version };
    });
  } catch (err) {
    // 미리 본 뒤 저장 사이에 남이 같은 번호를 쓴 경우. 위 '번호 중복' 항목 참조.
    if (isUniqueViolation(err)) return duplicateNumberResult();
    throw err;
  }
}

/** 있는 견적서 한 장. 위 '동시 수정은 version 으로 막는다' 순서를 그대로 따른다. */
export async function updateQuote(params: {
  id: string;
  expectedVersion: number;
  fields: QuoteFields;
  actorUserId: string;
}): Promise<QuoteMutationResult> {
  try {
    return await db.transaction(async (tx): Promise<QuoteMutationResult> => {
      const [existing] = await tx
        .select({ id: quotes.id, version: quotes.version, isDeleted: quotes.isDeleted })
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

      return { ok: true, id: updated.id, version: updated.version };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return duplicateNumberResult();
    throw err;
  }
}
