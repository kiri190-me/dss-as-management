"use server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getPermissionLevel } from "@/lib/auth/permission-resolver";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  canDeleteServiceReports,
  canEditServiceReports,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  createServiceReport,
  softDeleteServiceReport,
  updateServiceReport,
} from "@/lib/db/mutations/service-reports";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { readServiceReportActionValues } from "@/lib/server/service-report-action-input";
import { SERVICE_REPORT_CAUSES } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 검사·수리 보고서 — 서버 액션 (정책 계층)
 * ============================================================================
 * `actions/weekly-report-goals.ts` 와 같은 형식이다: 저장 모드 → 세션 → 계정 승인
 * → 살아 있는 계정 → 인가 → 입력 검증 → mutation. **순서가 곧 규칙**이다 —
 * 검증을 먼저 하면 로그인하지 않은 요청이 "어떤 값이 유효한지"를 알아낼 수 있다.
 *
 * ── 🔴 화면이 감춘 것은 경계가 아니다 ──────────────────────────────────
 * 화면은 저장·지우기 단추를 권한 없는 사람에게 그리지 않는다. 그것은 편의일
 * 뿐이고, 이 파일은 화면이 무엇을 보여 줬든 **매번 처음부터 다시 검사한다.**
 * 서버 액션은 주소를 가진 창구라, 단추를 감추는 것으로는 아무것도 막지 못한다.
 *
 * ── 🔴 세션의 role 을 믿지 않는다 ──────────────────────────────────────
 * `resolveActingUserForSession` 으로 **살아 있는 계정을 다시 읽는다** — 강등되거나
 * 정지된 계정이 토큰 만료(8시간) 전까지 예전 권한으로 저장하는 구멍을 막는다.
 * 내려받기 라우트가 이미 그렇게 하고 있고(`api/…/service-report/xlsx/route.ts`),
 * 같은 문서를 만드는 이 창구가 그보다 느슨할 이유가 없다.
 *
 * ── 요구하는 수준은 인가 모듈이 정한다 ─────────────────────────────────
 * 저장 = WRITE, 지우기 = MANAGE. 여기에 `"WRITE"` 를 적어 두지 않고
 * `canEditServiceReports`/`canDeleteServiceReports` 를 부르는 까닭은
 * `auth/service-report-authorization.ts` 가 그 판단의 **원본**이기 때문이다 —
 * 라우트·액션·화면이 각자 수준을 적어 두면 한 곳만 고쳐지는 날이 온다.
 *
 * ── 결과 코드는 mutation 의 것을 그대로 나른다 ─────────────────────────
 * `NOT_FOUND`·`CONFLICT`·`VALIDATION_ERROR` 는 `mutations/service-reports.ts` 가
 * 정한 뜻 그대로다. 화면은 그 셋을 서로 다르게 다뤄야 한다(CONFLICT 는 적어 둔
 * 글을 지키는 자리다 — `ServiceReportForm.tsx`).
 * ============================================================================
 */

export type ServiceReportActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

export type ServiceReportActionResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: ServiceReportActionResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const VALIDATION_MESSAGE = "보고서 내용을 확인해 주세요.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";
const UNKNOWN_REPORT_MESSAGE = "보고서를 확인할 수 없습니다.";

/** 화면이 되돌려 보내는 id 는 우리가 준 uuid 여야 한다. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * 낙관적 잠금 토큰. 서버가 준 것을 그대로 되돌려 받는 값이라 **양의 정수**다.
 * 모양이 틀리면 mutation 까지 보내지 않는다 — `1.5` 나 `NaN` 은 어떤 행과도 맞지
 * 않아 CONFLICT 로 보이지만, 실제로는 화면이 보낸 것이 잘못된 것이다.
 */
function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

type AuthorizedActor =
  | { ok: true; actorUserId: string }
  | { ok: false; code: ServiceReportActionResultCode; message: string };

/**
 * 저장 모드 → 세션 → 계정 승인 → 살아 있는 계정 → 인가.
 *
 * `need` 는 이 조작이 요구하는 문턱이다. 판정 자체는 인가 모듈이 하고, 여기서는
 * **어느 문턱인지만** 고른다.
 */
async function resolveAuthorizedActor(need: "edit" | "delete"): Promise<AuthorizedActor> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }

  // 세션에 박혀 있는 role 이 아니라 살아 있는 계정을 다시 읽는다 — 위 머리말의
  // '세션의 role 을 믿지 않는다'.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }

  const level = await getPermissionLevel(actingUser.role, SERVICE_REPORT_PERMISSION_AREA);
  const allowed =
    need === "delete" ? canDeleteServiceReports(level) : canEditServiceReports(level);
  if (!allowed) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }

  return { ok: true, actorUserId: actingUser.id };
}

/**
 * 새 보고서 한 장.
 *
 * 🔴 **지워진 접수 건에서는 새로 만들지 못한다.** mutation 은 접수 건이 있는지만
 * 보고 `is_deleted` 는 일부러 보지 않는다(그쪽 머리말 — 이미 만들어 둔 보고서의
 * 오타를 고치는 길이 막히면 안 된다). 그 판단은 **부르는 쪽의 몫**이라고 적혀
 * 있고, 여기가 그 부르는 쪽이다. 내려받기 라우트가 같은 자리에서 같은 함수를
 * 쓴다(`resolveRepairCaseForServer`).
 */
export async function createServiceReportAction(input: {
  repairCaseId: string;
  values: unknown;
}): Promise<ServiceReportActionResult> {
  const auth = await resolveAuthorizedActor("edit");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  if (!isUuid(input?.repairCaseId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { repairCaseId: "접수 건을 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }

  const parsed = readServiceReportActionValues(input?.values, SERVICE_REPORT_CAUSES);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: parsed.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    const repairCase = await resolveRepairCaseForServer(input.repairCaseId);
    if (!repairCase) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }

    return await createServiceReport({
      repairCaseId: repairCase.id,
      values: parsed.values,
      actorUserId: auth.actorUserId,
    });
  } catch (err) {
    // 🔴 값은 로그에 담지 않는다 — 확인내용·조치에는 고객사의 장비 사정이 섞인다
    //    (mutations/service-reports.ts 의 '감사에는 본문을 담지 않는다').
    console.error("createServiceReportAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 저장된 보고서 한 장을 갱신한다.
 *
 * 🔴 **접수 건 id 를 받지 않는다.** 보고서는 언제나 처음 붙은 건에 딸린 문서라
 * 옮길 수 없고(mutation 의 «접수 건은 옮기지 않는다»), 받아 봐야 쓸 데가 없는
 * 값을 경계에서 검사해야 할 짐만 는다.
 */
export async function updateServiceReportAction(input: {
  serviceReportId: string;
  expectedVersion: number;
  values: unknown;
}): Promise<ServiceReportActionResult> {
  const auth = await resolveAuthorizedActor("edit");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const identity = validateReportIdentity(input?.serviceReportId, input?.expectedVersion);
  if (identity) return identity;

  const parsed = readServiceReportActionValues(input?.values, SERVICE_REPORT_CAUSES);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: parsed.fieldErrors,
      message: VALIDATION_MESSAGE,
    };
  }

  try {
    return await updateServiceReport({
      id: input.serviceReportId,
      expectedVersion: input.expectedVersion,
      values: parsed.values,
      actorUserId: auth.actorUserId,
    });
  } catch (err) {
    console.error("updateServiceReportAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 휴지통으로 보낸다. **영구 삭제가 아니다**(mutation 의 '영구 삭제는 없다').
 *
 * 문턱이 저장보다 높다(MANAGE) — 이미 고객사에 나간 문서라, 지우면 "무엇을
 * 확인했고 원인이 무엇이었다고 알렸는가"의 기록이 목록에서 사라진다
 * (`auth/service-report-authorization.ts` 의 '지우기·되살리기는 MANAGE').
 *
 * 사유는 받지 않는다(`null`). 화면에 그 칸이 없어서인데, 없는 채로 둔 까닭은
 * 지우기가 되돌릴 수 있는 조작이고 감사 로그에 **누가 언제 지웠는지**가 이미
 * 남기 때문이다. 사유 칸이 필요해지면 그때 화면과 함께 더한다.
 */
export async function deleteServiceReportAction(input: {
  serviceReportId: string;
  expectedVersion: number;
}): Promise<ServiceReportActionResult> {
  const auth = await resolveAuthorizedActor("delete");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const identity = validateReportIdentity(input?.serviceReportId, input?.expectedVersion);
  if (identity) return identity;

  try {
    return await softDeleteServiceReport({
      serviceReportId: input.serviceReportId,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.actorUserId,
      reason: null,
    });
  } catch (err) {
    console.error("deleteServiceReportAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 「어느 장을 어느 시점 기준으로」가 성립하는가. 성립하면 `null`, 아니면 그대로
 * 돌려줄 실패다.
 *
 * ⚠️ 이 파일은 `"use server"` 라 **내보내는 것은 전부 async 함수여야 한다.** 그래서
 * 이 도우미는 내보내지 않는다(Next 가 빌드에서 막는다).
 */
function validateReportIdentity(
  serviceReportId: unknown,
  expectedVersion: unknown
): ServiceReportActionResult | null {
  if (!isUuid(serviceReportId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { serviceReportId: UNKNOWN_REPORT_MESSAGE },
      message: VALIDATION_MESSAGE,
    };
  }
  if (!isValidExpectedVersion(expectedVersion)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedVersion: "수정 시점 정보를 확인할 수 없습니다." },
      message: VALIDATION_MESSAGE,
    };
  }
  return null;
}
