"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  isValidDomesticOrderId,
  isValidExpectedVersion,
  validateDomesticOrderFields,
} from "@/lib/validation/domestic-order-input";
import {
  createDomesticOrder,
  setDomesticOrderCompletion,
  updateDomesticOrder,
} from "@/lib/db/mutations/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 — 행 추가·수정 서버 액션 (정책 계층)
 * ============================================================================
 * end-users.ts 와 같은 형식이다: 세션 확인 → 인가 확인 → 입력 검증 →
 * mutation 호출. 순서가 곧 규칙이다 — 검증을 먼저 하면 로그인하지 않은 요청이
 * 어떤 값이 유효한지를 알아낼 수 있게 된다.
 *
 * ── 관문이 둘인 이유 ────────────────────────────────────────────────────
 * canEditDomesticOrders(역할 정책)와 hasPermission("domesticOrders", "WRITE")
 * (관리자가 설정한 수준)를 **둘 다** 통과해야 저장된다.
 *
 * 내자 정리는 아직 permission-features.ts 의 '설정이 최종 판정' 목록에 없다.
 * 그 목록에 없는 메뉴는 기존 역할 함수가 여전히 최종 관문이고, 설정으로는
 * 좁힐 수만 있다 — 여기 두 검사를 AND 로 두는 것이 정확히 그 뜻이다. 설정
 * 화면도 이 사실을 그대로 표시하므로, 관리자가 "열어 줬다고 믿는데 막혀 있는"
 * 상태가 생기지 않는다.
 *
 * ── 화면이 감춘 것은 경계가 아니다 ──────────────────────────────────────
 * 목록 화면은 고칠 수 없는 역할에게 '행 추가' 버튼과 편집 폼을 그리지 않는다.
 * 그것은 편의일 뿐이고, 이 액션은 화면이 무엇을 보여 줬든 상관없이 매번 처음부터
 * 다시 검사한다.
 * ============================================================================
 */

export type DomesticOrderActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type DomesticOrderActionResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: DomesticOrderActionResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";

async function resolveAuthorizedActingUser() {
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
  // 세션에 박혀 있는 role 이 아니라 **살아 있는 계정을 다시 읽는다** —
  // 강등된 계정이 토큰 만료 전까지 예전 권한으로 저장하는 구멍을 막는다
  // (area-guard.ts 의 currentRole 과 같은 이유).
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  // 관문은 하나다 — 관리자가 설정한 수준(2026-08-31 전환). 예전에는
  // canEditDomesticOrders(역할)와 AND 였고, 그래서 넓혀 줘도 열리지 않았다.
  // 기본값은 그대로다 — permission-baseline.ts 의 domesticOrders 기본값이
  // 바로 그 역할 함수라, 설정을 건드리지 않으면 같은 답을 낸다.
  if (!(await hasPermission(actingUser.role, "domesticOrders", "WRITE"))) {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "이 작업을 수행할 권한이 없습니다." };
  }
  return { ok: true as const, actingUser };
}

export async function createDomesticOrderAction(input: {
  fields: Record<string, unknown>;
}): Promise<DomesticOrderActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const validation = validateDomesticOrderFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await createDomesticOrder({ fields: validation.data, actorUserId: auth.actingUser.id });
  } catch (err) {
    // 값 자체는 절대 로그에 담지 않는다 — 현황·이력·기타·납품자에 사람 이름이
    // 섞일 수 있다(schema/domestic-orders.ts 의 PII 항목).
    console.error("createDomesticOrderAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

export async function updateDomesticOrderAction(input: {
  id: string;
  expectedVersion: number;
  fields: Record<string, unknown>;
}): Promise<DomesticOrderActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidDomesticOrderId(input.id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { id: "항목을 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedVersion: "수정 시점 정보를 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }

  const validation = validateDomesticOrderFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await updateDomesticOrder({
      id: input.id,
      expectedVersion: input.expectedVersion,
      fields: validation.data,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    console.error("updateDomesticOrderAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 완료 처리 · 완료 해제.
 *
 * 관문은 위 둘과 **똑같다** — canEditDomesticOrders AND
 * hasPermission("domesticOrders", "WRITE"). 권한 상한을 따로 올리지 않는다:
 * 완료는 누른 그 자리에서 다시 눌러 되돌릴 수 있는 조작이고, 값이 사라지지도
 * 않는다. 되돌릴 수 없는 조작(삭제 등)이 생기면 그때 별도의 수준을 논한다.
 */
export async function setDomesticOrderCompletionAction(input: {
  id: string;
  expectedVersion: number;
  completed: boolean;
}): Promise<DomesticOrderActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidDomesticOrderId(input.id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { id: "항목을 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedVersion: "수정 시점 정보를 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }
  // 불리언이 아닌 값을 받아 두면 undefined 가 "해제"로 조용히 읽힌다.
  if (typeof input.completed !== "boolean") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { completed: "완료 여부를 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await setDomesticOrderCompletion({
      id: input.id,
      expectedVersion: input.expectedVersion,
      completed: input.completed,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    console.error("setDomesticOrderCompletionAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}
