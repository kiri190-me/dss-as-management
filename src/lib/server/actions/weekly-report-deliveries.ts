"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  isValidExpectedVersion,
  isValidWeeklyReportDeliveryId,
  validateWeeklyReportDeliveryFields,
} from "@/lib/validation/weekly-report-delivery-input";
import {
  createWeeklyReportDelivery,
  deleteWeeklyReportDelivery,
  updateWeeklyReportDelivery,
} from "@/lib/db/mutations/weekly-report-deliveries";

/**
 * ============================================================================
 * 주간보고 납입 예정 건 — 서버 액션 (정책 계층)
 * ============================================================================
 * actions/weekly-report-goals.ts 와 **같은 자리·같은 형식**이다: 세션 확인 →
 * 인가 확인 → 입력 검증 → mutation 호출. 순서가 곧 규칙이다 — 검증을 먼저 하면
 * 로그인하지 않은 요청이 어떤 값이 유효한지를 알아낼 수 있게 된다.
 *
 * ── 관문이 둘인 이유 ────────────────────────────────────────────────────
 * canEditWeeklyReportGoals(역할 정책)와 hasPermission("weeklyReport", "WRITE")
 * (관리자가 설정한 수준)를 **둘 다** 통과해야 저장된다. 주간보고는
 * permission-features.ts 의 '설정이 최종 판정' 목록에 없으므로 역할 함수가
 * 여전히 최종 관문이고, 설정으로는 좁힐 수만 있다.
 *
 * ── 권한 함수를 새로 만들지 않는다 ──────────────────────────────────────
 * 이름이 `...Goals` 라서 이 파일에서는 어색하게 읽히지만, **같은 화면이고 같은
 * `weeklyReport` 권한 영역이다.** 권한을 둘로 쪼개면 관리자가 설정 화면에서
 * 무엇을 고른 것인지 알 수 없게 된다 — '주간보고 쓰기'를 켰는데 위 상자만
 * 열리고 아래 표는 안 열리는 화면을, 설정 화면은 설명할 방법이 없다.
 *
 * 적을 수 있는 역할의 근거도 그대로 이어진다(weekly-report-authorization.ts):
 * 이번 주에 어느 장비를 언제 납입할지는 **작업 쪽이 아는 값**이라 최고관리자 ·
 * 관리자 · A/S 엔지니어가 적는다. 삭제도 같은 집합이다 — 지워지는 것은 이번 주
 * 목록에 올려 둔 표시이고, 잘못 지웠으면 그 건을 다시 고르면 된다.
 *
 * **보는 쪽은 달라지지 않는다.** 페이지는 종전대로
 * requireAreaAccessForCurrentUser("weeklyReport") 하나로 들어간다 — 이 파일이
 * 좁히는 것은 적는 일뿐이다.
 *
 * ── 화면이 감춘 것은 경계가 아니다 ──────────────────────────────────────
 * 화면은 적을 수 없는 역할에게 입력칸과 버튼을 그리지 않는다. 그것은 편의일
 * 뿐이고, 이 액션은 화면이 무엇을 보여 줬든 상관없이 매번 처음부터 다시
 * 검사한다.
 * ============================================================================
 */

export type WeeklyReportDeliveryActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type WeeklyReportDeliveryActionResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: WeeklyReportDeliveryActionResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";

async function resolveAuthorizedActingUser() {
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
  // 세션에 박혀 있는 role 이 아니라 **살아 있는 계정을 다시 읽는다** —
  // 강등된 계정이 토큰 만료 전까지 예전 권한으로 저장하는 구멍을 막는다
  // (area-guard.ts 의 currentRole 과 같은 이유).
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false as const, code: "UNAUTHORIZED" as const, message: "로그인이 필요합니다." };
  }
  // 관문은 하나다 — 관리자가 설정한 수준(2026-08-31 전환). 예전에는
  // canEditWeeklyReportGoals(역할)와 AND 여서, 넓혀 줘도 열리지 않았다.
  // 기본값은 그대로다 — permission-baseline.ts 의 weeklyReport WRITE 기본값이
  // 바로 그 역할 함수다.
  if (!(await hasPermission(actingUser, "weeklyReport", "WRITE"))) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
      message: "이 작업을 수행할 권한이 없습니다.",
    };
  }
  return { ok: true as const, actingUser };
}

export async function createWeeklyReportDeliveryAction(input: {
  fields: Record<string, unknown>;
}): Promise<WeeklyReportDeliveryActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const validation = validateWeeklyReportDeliveryFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await createWeeklyReportDelivery({
      fields: validation.data,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    // 값 자체는 절대 로그에 담지 않는다 — 비고에 사람 이름이나 고객사 사정이
    // 섞일 수 있다(schema/weekly-report-deliveries.ts 의 PII 항목).
    console.error("createWeeklyReportDeliveryAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

export async function updateWeeklyReportDeliveryAction(input: {
  id: string;
  expectedVersion: number;
  fields: Record<string, unknown>;
}): Promise<WeeklyReportDeliveryActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidWeeklyReportDeliveryId(input.id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { id: "납입 예정 건을 확인할 수 없습니다." },
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

  const validation = validateWeeklyReportDeliveryFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await updateWeeklyReportDelivery({
      id: input.id,
      expectedVersion: input.expectedVersion,
      fields: validation.data,
      actorUserId: auth.actingUser.id,
    });
  } catch (err) {
    console.error("updateWeeklyReportDeliveryAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 줄 삭제. **휴지통 없이 바로 지운다**(승인된 결정).
 *
 * 관문은 위 둘과 **똑같다** — canEditWeeklyReportGoals AND
 * hasPermission("weeklyReport", "WRITE"). '관리' 수준을 따로 요구하지 않는
 * 이유는 weekly-report-authorization.ts 의 '삭제도 같은 집합이다' 항목과 같다.
 *
 * expectedVersion 을 받는 것이 이 조작의 안전장치다 — 낡은 화면에서 누른 삭제가
 * 그 사이 남이 적어 둔 비고를 지우면 안 된다(mutation 헤더).
 */
export async function deleteWeeklyReportDeliveryAction(input: {
  id: string;
  expectedVersion: number;
}): Promise<WeeklyReportDeliveryActionResult> {
  const auth = await resolveAuthorizedActingUser();
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isValidWeeklyReportDeliveryId(input.id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { id: "납입 예정 건을 확인할 수 없습니다." },
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

  try {
    return await deleteWeeklyReportDelivery({
      id: input.id,
      expectedVersion: input.expectedVersion,
    });
  } catch (err) {
    console.error("deleteWeeklyReportDeliveryAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}
