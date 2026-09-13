"use server";

import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isImprovementRequestStatus } from "@/lib/domain/improvement-request";
import { validateImprovementRequestFields } from "@/lib/validation/improvement-request-input";
import {
  changeImprovementRequestStatus,
  createImprovementRequest,
  deleteImprovementRequest,
  updateImprovementRequestBody,
} from "@/lib/db/mutations/improvement-requests";

/**
 * ============================================================================
 * 개선 요청 — 서버 액션 (정책 계층)
 * ============================================================================
 * 관문 순서는 update-customer.ts 와 같다: DB 모드 → 세션 → 승인 → 사용자(살아
 * 있는 계정을 다시 읽는다) → 권한 → 입력 검증 → mutation → 예상 밖 예외는
 * DATABASE_UNAVAILABLE. 검증을 권한보다 먼저 하면 권한 없는 요청이 어떤 값이
 * 유효한지를 알아낼 수 있게 된다.
 *
 * ── 권한 ────────────────────────────────────────────────────────────────
 *  · 적기 · 고치기 · 지우기 — hasPermission("improvementRequests", "WRITE")
 *  · 상태 옮기기           — hasPermission("improvementRequests", "MANAGE")
 *  · 지우기의 canManage    — 같은 MANAGE 판정을 계산해 mutation 에 넘긴다.
 * 「접수 상태인 자기 글인가」처럼 글 한 건에 대한 판정은 여기서 하지 않는다 —
 * mutation 이 **잠근 행**으로 도메인 함수를 불러 판정한다(그 파일 헤더).
 *
 * 영역 `improvementRequests` 는 4조각(2026-09-13)에서 permission-areas.ts 에
 * 등록됐다. 역할 기본값은 permission-baseline.ts 가 improvement-request-
 * authorization.ts 를 불러 정한다(전원 WRITE, 최고관리자·관리자 MANAGE). 화면의
 * 페이지 가드·단추 표시(settings/improvement-requests/page.tsx)도 같은 두 수준을
 * 본다 — 짝이 어긋나면 화면은 열어 주는데 여기서 거절된다.
 *
 * ── 화면이 감춘 것은 경계가 아니다 ──────────────────────────────────────
 * 화면이 단추를 그리지 않는 것은 편의일 뿐이다. 이 액션은 화면이 무엇을 보여
 * 줬든 매번 처음부터 다시 검사한다.
 *
 * ── 🔴 로그에 본문을 싣지 않는다 ────────────────────────────────────────
 * 예상 밖 오류를 `console.error(…, err)` 로 통째로 넘기지 않는다. drizzle 의
 * DrizzleQueryError 는 메시지에 `params:` 로 쿼리 인자를 그대로 싣고(본문이
 * 거기 있다), Postgres 의 CHECK 오류는 detail 에 「Failing row contains (…)」로
 * 행 전체를 싣는다. 그래서 오류 이름 · Postgres 오류 코드 · 제약 이름만 남긴다
 * (logUnexpectedDbError).
 * ============================================================================
 */

export type ImprovementRequestActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type ImprovementRequestActionResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: ImprovementRequestActionResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

/** 권한 영역 키. permission-areas.ts 의 `improvementRequests` 와 같은 글자다(4조각에서 등록). */
const AREA_KEY = "improvementRequests";
/** 설정 › 개선 요청 화면. 저장이 성공하면 이 경로를 다시 그린다. */
const LIST_PATH = "/settings/improvement-requests";

const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const FORBIDDEN_MESSAGE = "이 작업을 수행할 권한이 없습니다.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidImprovementRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function forbidden(): ImprovementRequestActionResult {
  return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
}

function invalid(fieldErrors: Record<string, string>): ImprovementRequestActionResult {
  return { ok: false, code: "VALIDATION_ERROR", fieldErrors, message: VALIDATION_MESSAGE };
}

function databaseUnavailable(): ImprovementRequestActionResult {
  return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
}

/** 권한 앞까지의 관문 — DB 모드 · 세션 · 승인 · 살아 있는 계정. */
async function resolveActingUser() {
  if (getAuthSource() !== "database") {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
      message: "데이터베이스 저장 모드가 아닙니다.",
    };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
      message: "계정이 아직 승인되지 않았습니다.",
    };
  }
  // 세션에 박힌 role 이 아니라 살아 있는 계정을 다시 읽는다 — 강등된 계정이 토큰
  // 만료 전까지 예전 권한으로 저장하는 구멍을 막는다(weekly-report-goals.ts 와 같다).
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  return { ok: true as const, actingUser };
}

/** 고치기 · 상태 옮기기 · 지우기가 공통으로 받는 대상 글과 그 version. */
function validateTarget(input: { id: unknown; expectedVersion: unknown }): ImprovementRequestActionResult | null {
  if (!isValidImprovementRequestId(input.id)) {
    return invalid({ id: "개선 요청을 확인할 수 없습니다." });
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return invalid({ expectedVersion: "수정 시점 정보를 확인할 수 없습니다." });
  }
  return null;
}

/** 오류에서 값이 없는 부분만 꺼낸다 — 파일 헤더의 '로그에 본문을 싣지 않는다'. */
function describeErrorWithoutValues(err: unknown): {
  name: string;
  code: string | null;
  constraint: string | null;
} {
  const name = err instanceof Error ? err.name : typeof err;
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        name,
        code: candidate.code,
        constraint: typeof candidate.constraint_name === "string" ? candidate.constraint_name : null,
      };
    }
    current = candidate.cause;
  }
  return { name, code: null, constraint: null };
}

function logUnexpectedDbError(actionName: string, err: unknown): void {
  console.error(`${actionName}: unexpected DB error`, describeErrorWithoutValues(err));
}

/** 새 글 하나. */
export async function createImprovementRequestAction(input: {
  fields: Record<string, unknown>;
}): Promise<ImprovementRequestActionResult> {
  const auth = await resolveActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };
  if (!(await hasPermission(auth.actingUser, AREA_KEY, "WRITE"))) return forbidden();

  const validation = validateImprovementRequestFields(input.fields ?? {});
  if (!validation.ok) return invalid(validation.fieldErrors);

  try {
    const result = await createImprovementRequest({
      body: validation.data.body,
      actorUserId: auth.actingUser.id,
    });
    if (result.ok) revalidatePath(LIST_PATH);
    return result;
  } catch (err) {
    logUnexpectedDbError("createImprovementRequestAction", err);
    return databaseUnavailable();
  }
}

/** 글의 내용을 고친다. 접수 상태인 자기 글인가는 mutation 이 잠근 행으로 판정한다. */
export async function updateImprovementRequestAction(input: {
  id: string;
  expectedVersion: number;
  fields: Record<string, unknown>;
}): Promise<ImprovementRequestActionResult> {
  const auth = await resolveActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };
  if (!(await hasPermission(auth.actingUser, AREA_KEY, "WRITE"))) return forbidden();

  const targetError = validateTarget(input);
  if (targetError) return targetError;
  const validation = validateImprovementRequestFields(input.fields ?? {});
  if (!validation.ok) return invalid(validation.fieldErrors);

  try {
    const result = await updateImprovementRequestBody({
      id: input.id,
      expectedVersion: input.expectedVersion,
      body: validation.data.body,
      actorUserId: auth.actingUser.id,
    });
    if (result.ok) revalidatePath(LIST_PATH);
    return result;
  } catch (err) {
    logUnexpectedDbError("updateImprovementRequestAction", err);
    return databaseUnavailable();
  }
}

/** 상태를 옮긴다 — 관리 권한(MANAGE)이 있을 때만. */
export async function changeImprovementRequestStatusAction(input: {
  id: string;
  expectedVersion: number;
  to: string;
}): Promise<ImprovementRequestActionResult> {
  const auth = await resolveActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };
  const canManage = await hasPermission(auth.actingUser, AREA_KEY, "MANAGE");
  if (!canManage) return forbidden();

  const targetError = validateTarget(input);
  if (targetError) return targetError;
  if (!isImprovementRequestStatus(input.to)) {
    return invalid({ to: "옮길 상태를 확인할 수 없습니다." });
  }

  try {
    const result = await changeImprovementRequestStatus({
      id: input.id,
      expectedVersion: input.expectedVersion,
      to: input.to,
      actorUserId: auth.actingUser.id,
      canManage,
    });
    if (result.ok) revalidatePath(LIST_PATH);
    return result;
  } catch (err) {
    logUnexpectedDbError("changeImprovementRequestStatusAction", err);
    return databaseUnavailable();
  }
}

/**
 * 글을 바로 지운다(휴지통 없음). 관문은 WRITE 이고, 남의 글·진행중인 글까지 지울
 * 수 있는가는 MANAGE 판정을 canManage 로 넘겨 mutation 이 잠근 행으로 정한다.
 */
export async function deleteImprovementRequestAction(input: {
  id: string;
  expectedVersion: number;
}): Promise<ImprovementRequestActionResult> {
  const auth = await resolveActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };
  if (!(await hasPermission(auth.actingUser, AREA_KEY, "WRITE"))) return forbidden();

  const targetError = validateTarget(input);
  if (targetError) return targetError;

  const canManage = await hasPermission(auth.actingUser, AREA_KEY, "MANAGE");

  try {
    const result = await deleteImprovementRequest({
      id: input.id,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.actingUser.id,
      canManage,
    });
    if (result.ok) revalidatePath(LIST_PATH);
    return result;
  } catch (err) {
    logUnexpectedDbError("deleteImprovementRequestAction", err);
    return databaseUnavailable();
  }
}
