"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  isValidExpectedVersion,
  isValidQuoteId,
  validateQuoteFields,
} from "@/lib/validation/quote-input";
import { createQuote, updateQuote } from "@/lib/db/mutations/quotes";
import { restoreQuote, softDeleteQuote } from "@/lib/db/mutations/quote-trash";
import { lookupIntakeForQuote, type QuoteIntakeLookup } from "@/lib/db/queries/quotes";

/**
 * ============================================================================
 * 견적서 — 서버 액션 (정책 계층)
 * ============================================================================
 * server/actions/domestic-orders.ts 와 같은 형식이다: 세션 확인 → 인가 확인 →
 * 입력 검증 → mutation 호출. **순서가 곧 규칙이다** — 검증을 먼저 하면
 * 로그인하지 않은 요청이 어떤 값이 유효한지를 알아낼 수 있게 된다.
 *
 * ── 관문은 하나다 ───────────────────────────────────────────────────────
 * 관리자가 설정한 수준(hasPermission)만 본다. 예전에는 canEditQuotes(역할
 * 정책)와 AND 였고, 그래서 **넓혀 줘도 열리지 않았다** — 권한 화면은 "넓히면
 * 열립니다"라고 말하는데 실제로는 막혀 있는 상태였다(2026-08-31 전환).
 *
 * 기본값은 그대로다. permission-baseline.ts 의 quotes 사다리가 바로 그
 * canViewQuotes/canEditQuotes/canDeleteQuotes 를 불러 만들어지므로, 설정을
 * 건드리지 않은 상태에서는 예전과 **정확히 같은 답**을 낸다(모든 역할로
 * 대조해 확인). 달라지는 것은 관리자가 넓혔을 때뿐이다.
 *
 * ── 화면이 감춘 것은 경계가 아니다 ──────────────────────────────────────
 * 목록은 고칠 수 없는 역할에게 `새 견적서` 단추를 그리지 않는다. 그것은 편의일
 * 뿐이고, 이 액션은 화면이 무엇을 보여 줬든 상관없이 매번 처음부터 다시 검사한다.
 *
 * ── 불러오기는 읽기 권한으로 충분하다 ───────────────────────────────────
 * lookupIntakeAction 은 저장하지 않는다. 다만 **접수 건의 고객사·모델·증상과
 * 사용한 부품을 돌려주므로** 아무나 부를 수 있으면 인수번호를 넣어 보는 것만으로
 * 그 정보가 새어 나간다. 그래서 쓰기와 같은 자리에서 세션을 확인하고, 문턱만
 * READ 로 둔다.
 * ============================================================================
 */

export type QuoteActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type QuoteActionResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: QuoteActionResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

export type QuoteLookupResult =
  | { ok: true; found: QuoteIntakeLookup | null }
  | { ok: false; code: QuoteActionResultCode; message: string };

const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";

async function resolveActingUser(required: "READ" | "WRITE") {
  if (getAuthSource() !== "database") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "계정이 아직 승인되지 않았습니다." };
  }
  // 세션에 박혀 있는 role 이 아니라 **살아 있는 계정을 다시 읽는다** — 강등된
  // 계정이 토큰 만료 전까지 예전 권한으로 저장하는 구멍을 막는다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }

  // 관문은 하나다 — 관리자가 설정한 수준(2026-08-31 전환). 예전에는 역할 정책
  // (canEditQuotes/canViewQuotes)과 AND 여서, 넓혀 줘도 열리지 않았다. 기본값은
  // 그대로다 — permission-baseline.ts 의 quotes 사다리가 바로 그 함수들이다.
  if (!(await hasPermission(actingUser.role, "quotes", required))) {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "이 작업을 수행할 권한이 없습니다." };
  }
  return { ok: true as const, actingUser };
}

export async function createQuoteAction(input: {
  fields: Record<string, unknown>;
}): Promise<QuoteActionResult> {
  const auth = await resolveActingUser("WRITE");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const validation = validateQuoteFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await createQuote({ fields: validation.data, actorUserId: auth.actingUser.id });
  } catch (err) {
    // 값 자체는 절대 로그에 담지 않는다 — 품명·신고증상에 고객사 사정이 섞일 수
    // 있다(schema/quotes.ts 의 PII 항목).
    console.error("createQuoteAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

export async function updateQuoteAction(input: {
  id: string;
  expectedVersion: number;
  fields: Record<string, unknown>;
}): Promise<QuoteActionResult> {
  const auth = await resolveActingUser("WRITE");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidQuoteId(input.id)) {
    return { ok: false, code: "NOT_FOUND", message: "해당 견적서를 찾을 수 없습니다." };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return { ok: false, code: "CONFLICT", message: "최신 정보를 다시 불러온 뒤 시도해 주세요." };
  }

  const validation = validateQuoteFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await updateQuote({
      id: input.id,
      expectedVersion: input.expectedVersion,
      fields: validation.data,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    console.error("updateQuoteAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 인수번호로 접수 건을 찾아 폼에 채울 값을 돌려준다.
 *
 * 못 찾은 것은 **오류가 아니다**(`found: null`). 아직 접수되지 않은 건으로 먼저
 * 견적을 내는 일이 실제로 있고, 그때 화면은 "찾지 못했습니다 — 직접 입력하세요"
 * 로 안내하고 사람이 손으로 채운다. 오류로 만들면 그 정상적인 흐름이 빨간
 * 글씨로 막힌 것처럼 보인다.
 */
export async function lookupIntakeForQuoteAction(input: {
  intakeNumber: string;
}): Promise<QuoteLookupResult> {
  const auth = await resolveActingUser("READ");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const intakeNumber = typeof input.intakeNumber === "string" ? input.intakeNumber.trim() : "";
  if (intakeNumber === "") return { ok: true, found: null };

  try {
    return { ok: true, found: await lookupIntakeForQuote(intakeNumber) };
  } catch (err) {
    console.error("lookupIntakeForQuoteAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * ============================================================================
 * 휴지통 — 지우기와 되살리기
 * ============================================================================
 * 관문이 하나 더 좁다. 만들기·고치기는 `quotes` WRITE 지만, 지우고 되살리는
 * 것은 `quotes` MANAGE 다 — 견적서는
 * 고객사에 나간 문서라 지우는 판단을 담당자 각자에게 맡기지 않는다
 * (quote-authorization.ts 의 '삭제는 관리자 이상이다').
 * ============================================================================
 */

async function resolveDeletingUser() {
  if (getAuthSource() !== "database") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "계정이 아직 승인되지 않았습니다." };
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  if (!(await hasPermission(actingUser.role, "quotes", "MANAGE"))) {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "견적서를 지울 권한이 없습니다." };
  }
  return { ok: true as const, actingUser };
}

export async function deleteQuoteAction(input: {
  id: string;
  expectedVersion: number;
  reason: string | null;
}): Promise<QuoteActionResult> {
  const auth = await resolveDeletingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidQuoteId(input.id)) {
    return { ok: false, code: "NOT_FOUND", message: "해당 견적서를 찾을 수 없습니다." };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return { ok: false, code: "CONFLICT", message: "최신 정보를 다시 불러온 뒤 시도해 주세요." };
  }

  try {
    const reason = typeof input.reason === "string" && input.reason.trim() !== "" ? input.reason.trim() : null;
    const result = await softDeleteQuote({
      quoteId: input.id,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.actingUser.id,
      reason,
    });
    if (!result.ok) {
      return { ok: false, code: result.code === "CONFLICT" ? "CONFLICT" : "NOT_FOUND", message: result.message };
    }
    return result;
  } catch (err) {
    console.error("deleteQuoteAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

export async function restoreQuoteAction(input: {
  id: string;
  expectedVersion: number;
}): Promise<QuoteActionResult> {
  const auth = await resolveDeletingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidQuoteId(input.id)) {
    return { ok: false, code: "NOT_FOUND", message: "해당 견적서를 찾을 수 없습니다." };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return { ok: false, code: "CONFLICT", message: "최신 정보를 다시 불러온 뒤 시도해 주세요." };
  }

  try {
    const result = await restoreQuote({
      quoteId: input.id,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.actingUser.id,
    });
    if (!result.ok) {
      // NUMBER_TAKEN 은 형식 오류가 아니라 지금 상태 때문에 못 하는 일이라,
      // 사용자가 무엇을 해야 하는지 그 문장이 이미 말해 준다.
      const code = result.code === "CONFLICT" ? "CONFLICT" : result.code === "NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_ERROR";
      return { ok: false, code, message: result.message };
    }
    return result;
  } catch (err) {
    console.error("restoreQuoteAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}
