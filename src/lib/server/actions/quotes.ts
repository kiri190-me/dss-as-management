"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  isValidExpectedVersion,
  isValidQuoteId,
  validateQuoteFields,
  type QuoteFields,
} from "@/lib/validation/quote-input";
import { createQuote, updateQuote } from "@/lib/db/mutations/quotes";
import { permanentlyDeleteQuote, restoreQuote, softDeleteQuote } from "@/lib/db/mutations/quote-trash";
import { lookupIntakeForQuote, type QuoteIntakeLookup } from "@/lib/db/queries/quotes";
import { archiveQuoteDocumentOnSave } from "@/lib/server/services/quote-issue";
import { createQuoteArchiveFolder } from "@/lib/storage/quote-archive";

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
  if (!(await hasPermission(actingUser, "quotes", required))) {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "이 작업을 수행할 권한이 없습니다." };
  }
  return { ok: true as const, actingUser };
}

/**
 * ============================================================================
 * 🔴 새 견적서를 저장하면 그 순간 **공유폴더에 폴더가 선다** (2026-10-06)
 * ============================================================================
 * 전에는 [견적서 받기] · 결재 PDF 저장이 파일을 쓸 때 폴더가 함께 생겼다. 그래서 견적서를
 * 적어 두기만 한 건은 서류함에 자리가 없었고, 사람이 그 사이에 받은 서류를 넣을 곳이 없었다.
 * 이제 **만드는 순간**(고치는 순간이 아니다) 빈 폴더를 세운다.
 *
 * 접수 때 연락서 폴더를 만드는 자리(services/create-repair-case.ts)가 정해 둔 규율을
 * 글자 그대로 따른다:
 *
 *  · 🔴 **DB 트랜잭션 바깥이다** — mutation 이 돌아온 **뒤**, `if (result.ok)` 블록 안.
 *    파일시스템 작업은 롤백되지 않는다.
 *  · 🔴 **폴더를 못 만들어도 견적서 저장은 그대로다.** 이 토막에 `return` 도 `throw` 도
 *    없고, 끝은 늘 아래의 `return result;` 하나다. 창고가 늦거나 꺼져 있다고 사람이 적은
 *    견적서가 사라지면 안 된다.
 *  · 🔴 **고치기(updateQuoteAction)에는 붙이지 않는다.** 이름 재료가 바뀌었다고 폴더를
 *    하나 더 세우면 같은 견적서의 서류가 두 폴더로 갈라진다(찾기는 번호만 보므로 기존
 *    폴더를 그대로 쓴다 — 고칠 때 할 일이 없다).
 *  · 🔴 **로그에 폴더 이름 · 경로 · 오류 message 를 적지 않는다.** 폴더 이름에는 공급처와
 *    S/N 이, fs 오류 message 에는 경로가 들어 있다. 남기는 것은 견적서 id 와 상태 코드,
 *    그리고 storage 가 경로 없이 만든 짧은 사유뿐이다.
 *  · `created` · `found` · `disabled` 는 정상 상태라 조용히 지나간다.
 *
 * 폴더를 만드는 일 자체(루트를 만들지 않기 · 본 번호로 먼저 찾기 · 파일을 쓰지 않기)는
 * storage/quote-archive.ts 의 createQuoteArchiveFolder 한 자리에만 있다.
 * ============================================================================
 */

/** 폴더 이름을 짓는 재료 — 🔴 꼬리는 **신고증상**이다(domain/quote-archive-naming.ts). */
function archiveNamingOfFields(fields: QuoteFields) {
  return {
    quoteNumber: fields.quoteNumber,
    kind: fields.kind,
    customerName: fields.customerNameText,
    modelName: fields.modelNameText,
    lotNumber: fields.lotNumberText,
    serialNumber: fields.serialNumberText,
    faultDescription: fields.faultDescriptionText,
  };
}

/**
 * ============================================================================
 * 🔴 저장하면 그것만으로 견적서 엑셀이 공유폴더에 들어간다 (2026-10-06)
 * ============================================================================
 * 위 폴더 만들기와 **같은 자리 · 같은 규율**이다(트랜잭션 바깥 · 독립 try · 경로를 적지 않는
 * 로그). 다른 점은 둘이다:
 *
 *  · 🔴 **만들기와 고치기 둘 다**에 붙는다. 폴더는 한 번만 서면 되지만 견적서 엑셀은
 *    **고칠 때마다 내용이 달라진다** — 마지막 판이 서류함에 있어야 한다.
 *  · 🔴 **쌓이지 않는다.** 공유폴더 쪽은 이름 줄기가 같은 그 한 장을 덮어쓰고
 *    (storage/quote-archive.ts 의 「덮어쓰기는 QUOTE_FILE 에만」), 내용이 그대로면 아예
 *    쓰지 않는다. 결재본(有印 PDF)은 그 덮어쓰기에 들어가지 않는다 — 사람이 올린 원본이다.
 *
 * 무엇을 만들고 어디에 넣는지는 **services/quote-issue.ts 한 자리**에 있다
 * (archiveQuoteDocumentOnSave). [견적서 받기]와 같은 도우미를 지나므로 두 벌이 되지 않는다.
 * 🔴 이 액션은 공유폴더 위치도 파일 이름도 알지 못한다 — 견적서 id 와 행위자만 넘긴다.
 *
 * 🔴 **실패해도 저장은 되돌아가지 않는다.** 아래 함수에 `return` 도 `throw` 도 없고, 남기는
 * 것은 견적서 id + 상태 코드 + 사유 코드뿐이다(파일 이름 · 폴더 이름 · 경로 · 오류 message 를
 * 적지 않는다 — 폴더 이름에는 공급처와 S/N 이, fs 오류에는 경로가 들어 있다).
 * ============================================================================
 */
async function archiveDocumentAfterSave(quoteId: string, actorUserId: string): Promise<void> {
  try {
    const archived = await archiveQuoteDocumentOnSave({ quoteId, actorUserId });
    // 건너뛴 장(엑셀 전용 · 앱 양식이 없는 종류)과 끝난 장은 정상이라 조용히 지나간다.
    if (archived.status === "failed") {
      console.error("견적서 엑셀을 공유폴더에 남기지 못했습니다", {
        quoteId,
        status: archived.status,
        reason: archived.reason,
      });
    }
  } catch (documentError) {
    // 🔴 오류의 message 를 적지 않는다 — fs · DB 오류에는 경로와 입력값이 들어 있다.
    console.error("견적서 엑셀을 남기는 중 예상치 못한 오류", {
      quoteId,
      name: documentError instanceof Error ? documentError.name : typeof documentError,
    });
  }
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

  let result: QuoteActionResult;
  try {
    result = await createQuote({ fields: validation.data, actorUserId: auth.actingUser.id });
  } catch (err) {
    // 값 자체는 절대 로그에 담지 않는다 — 품명·신고증상에 고객사 사정이 섞일 수
    // 있다(schema/quotes.ts 의 PII 항목).
    console.error("createQuoteAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }

  if (result.ok) {
    try {
      const folder = await createQuoteArchiveFolder({
        quoteDate: validation.data.quoteDate,
        naming: archiveNamingOfFields(validation.data),
      });
      // 만들었다 · 이미 있었다 · 꺼져 있다는 정상 상태라 시끄럽게 굴지 않는다.
      if (folder.status !== "created" && folder.status !== "found" && folder.status !== "disabled") {
        console.error("새 견적서의 공유폴더 폴더를 만들지 못했습니다", {
          quoteId: result.id,
          status: folder.status,
          reason: folder.reason,
        });
      }
    } catch (folderError) {
      // 🔴 오류의 message 를 적지 않는다 — fs 오류에는 경로가 들어 있다.
      console.error("새 견적서의 공유폴더 폴더에서 예상치 못한 오류", {
        quoteId: result.id,
        name: folderError instanceof Error ? folderError.name : typeof folderError,
      });
    }
    await archiveDocumentAfterSave(result.id, auth.actingUser.id);
  }

  return result;
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

  let updated: QuoteActionResult;
  try {
    updated = await updateQuote({
      id: input.id,
      expectedVersion: input.expectedVersion,
      fields: validation.data,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    console.error("updateQuoteAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }

  // 🔴 고친 내용으로 견적서 엑셀을 다시 만들어 서류함의 그 한 장을 바꾼다(위 머리말).
  //    폴더 만들기는 여기 붙지 않는다 — 번호로 찾으므로 만들 때 선 폴더를 그대로 쓴다.
  if (updated.ok) {
    await archiveDocumentAfterSave(updated.id, auth.actingUser.id);
  }

  return updated;
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
 * 휴지통 — 보내기 · 되살리기 · 완전 삭제
 * ============================================================================
 * 관문이 하나 더 좁다. 만들기·고치기는 `quotes` WRITE 지만, 지우고 되살리고
 * 완전히 지우는 것은 `quotes` MANAGE 다 — 견적서는
 * 고객사에 나간 문서라 지우는 판단을 담당자 각자에게 맡기지 않는다
 * (quote-authorization.ts 의 '삭제는 관리자 이상이다'). 완전 삭제
 * (2026-09-11)도 같은 관문이다 — 내자 정리 휴지통의 셋이 한 관문인 것과 같다.
 *
 * 셋 다 한 건씩 받는다(이 파일의 관례). 화면이 한 번에 한 장씩만 다룬다.
 * ============================================================================
 */

/** 완전 삭제 사유의 길이 상한. 내자 정리 휴지통(actions/domestic-orders.ts)과 같은 값이다. */
const MAX_PURGE_REASON_LENGTH = 2000;

export type QuotePermanentDeleteActionResult =
  | { ok: true; id: string }
  | { ok: false; code: QuoteActionResultCode; message: string };

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
  if (!(await hasPermission(actingUser, "quotes", "MANAGE"))) {
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

/**
 * 15일을 기다리지 않고 휴지통의 견적서를 완전히 지운다. 되돌릴 수 없으므로 사유가
 * 필수다. 휴지통에 있는 장만 지워진다 — 그 판정은 mutation 이 잠금 안에서 한다
 * (mutations/quote-trash.ts 의 permanentlyDeleteQuote).
 */
export async function permanentlyDeleteQuoteAction(input: {
  id: string;
  expectedVersion: number;
  reason: string;
}): Promise<QuotePermanentDeleteActionResult> {
  const auth = await resolveDeletingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidQuoteId(input?.id)) {
    return { ok: false, code: "NOT_FOUND", message: "해당 견적서를 찾을 수 없습니다." };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return { ok: false, code: "CONFLICT", message: "최신 정보를 다시 불러온 뒤 시도해 주세요." };
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유를 입력해 주세요." };
  }
  if (reason.length > MAX_PURGE_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유가 너무 깁니다." };
  }

  try {
    const result = await permanentlyDeleteQuote({
      quoteId: input.id,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.actingUser.id,
      reason,
    });
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true, id: result.id };
  } catch (err) {
    // 오류 객체를 통째로 남기지 않고 코드만 남긴다 — 되돌릴 수 없는 조작의 실패라
    // 사유(사람이 적은 글자)가 오류 문맥에 섞여 로그로 새지 않게 한다(actions/
    // domestic-orders.ts 의 휴지통 액션과 같은 판단).
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
    console.error("permanentlyDeleteQuoteAction: unexpected DB error", { id: input.id, code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}
