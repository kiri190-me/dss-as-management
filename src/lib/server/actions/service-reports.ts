"use server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
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
  permanentlyDeleteServiceReport,
  restoreServiceReport,
  softDeleteServiceReport,
  updateServiceReport,
} from "@/lib/db/mutations/service-reports";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import {
  readServiceReportActionValues,
  readServiceReportDeleteReason,
  readServiceReportPurgeReason,
} from "@/lib/server/service-report-action-input";
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
 * ── 🔴 완전 삭제만 문턱이 하나 더 있다 (2026-10-28) ────────────────────
 * MANAGE 를 넘은 **다음에** 개발자 모드 관문(`mayEnterDeveloperMode`)을 한 번
 * 더 지난다. 되돌릴 수 없는 데다 법인 직인이 찍혀 고객사로 나간 문서라, 평소에는
 * 그 단추가 아예 없는 쪽으로 정했다(2026-10-28 사용자 결정).
 *
 * 🔴 **판정을 여기에 새로 적지 않는다.** `actor.isDeveloper === true` 라고
 * 적으면 「이 사람이 개발자냐」를 답하는 자리가 둘이 되고, `developer-mode-gate.ts`
 * 가 "이 질문의 답은 여기 한 곳에서만 나온다"고 못 박아 둔 것이 깨진다. 그
 * 함수를 그대로 부르므로 **승인되지 않은 계정은 개발자 표시가 켜져 있어도
 * 막히고**, 역할이 최고관리자인 사람은 표시와 무관하게 통과한다 — 그것이 그
 * 관문이 정의한 「개발자」다.
 *
 * ⚠️ 권한 수준(MANAGE)을 **먼저** 본다. 순서를 뒤집으면 접수 건을 볼 권한조차
 * 없는 개발자 계정이 남의 건의 보고서를 지울 수 있게 된다.
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

/**
 * 완전 삭제의 결과. **성공에 version 이 없다** — 행이 사라진 뒤에는 돌려줄
 * 다음 판이 없다(mutation 의 `ServiceReportPurgeResult`). 실패 코드는 위의
 * 것을 그대로 쓴다: 개발자 모드 관문에 막히면 `FORBIDDEN`, 휴지통에 없으면
 * `NOT_FOUND`, 그 사이에 누가 되살렸으면 `CONFLICT` 다.
 */
export type ServiceReportPurgeActionResult =
  | { ok: true; id: string }
  | { ok: false; code: ServiceReportActionResultCode; message: string };

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
 * **어느 문턱인지만** 고른다. `"purge"` 는 `"delete"` 와 같은 수준을 요구한 뒤
 * 개발자 모드 관문을 하나 더 지난다 — 위 머리말의 '완전 삭제만 문턱이 하나 더
 * 있다'.
 */
async function resolveAuthorizedActor(need: "edit" | "delete" | "purge"): Promise<AuthorizedActor> {
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

  const level = await getPermissionLevel(actingUser, SERVICE_REPORT_PERMISSION_AREA);
  const allowed =
    need === "edit" ? canEditServiceReports(level) : canDeleteServiceReports(level);
  if (!allowed) {
    return { ok: false, code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다." };
  }

  /**
   * 🔴 완전 삭제만 지나는 두 번째 문. 화면이 단추를 감췄든 말든 **여기서 다시**
   * 본다 — 이 파일 머리말의 '화면이 감춘 것은 경계가 아니다' 가 바로 이 자리에
   * 걸린다. 주소로 직접 부르면 이 줄이 거절한다.
   */
  if (need === "purge" && !mayEnterDeveloperMode(actingUser)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      // 🔴 「개발자 표시가 꺼져 있다」고 알려 주지 않는다 — 어떤 칸을 켜면
      //    뚫리는지를 거절 문구가 가르쳐 줄 이유가 없다.
      message: "이 작업을 수행할 권한이 없습니다.",
    };
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
 * 휴지통으로 보낸다. **영구 삭제가 아니다** — 그쪽은 아래
 * `permanentlyDeleteServiceReportAction` 이고, 휴지통에 든 장만 받는다
 * (mutation 의 '영구 삭제 — 2026-10-28 에 생겼다').
 *
 * 문턱이 저장보다 높다(MANAGE) — 이미 고객사에 나간 문서라, 지우면 "무엇을
 * 확인했고 원인이 무엇이었다고 알렸는가"의 기록이 목록에서 사라진다
 * (`auth/service-report-authorization.ts` 의 '지우기·되살리기는 MANAGE').
 *
 * 🔴 **사유를 받는다(선택).** 확인 창(`MasterDataDeleteDialog`)에 「삭제 사유
 * (선택)」 칸이 있고, 적을 수 있게 해 놓고 버리는 것이 가장 나쁘다 — 표에는 담을
 * 칸이 이미 있다(`service_reports.delete_reason`). 다듬는 규칙과 길이 상한은
 * `service-report-action-input.ts` 가 정한다(순수 함수라 시험이 붙는다).
 */
export async function deleteServiceReportAction(input: {
  serviceReportId: string;
  expectedVersion: number;
  /** 다듬어서 빈 글자면 「사유 없음」과 같게 다룬다. */
  reason: string | null;
}): Promise<ServiceReportActionResult> {
  const auth = await resolveAuthorizedActor("delete");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const identity = validateReportIdentity(input?.serviceReportId, input?.expectedVersion);
  if (identity) return identity;

  const reason = readServiceReportDeleteReason(input?.reason);
  if (!reason.ok) {
    // 🔴 이 실패는 **확인 창 안에** 그대로 뜬다(`submitError`). 창에는 칸별 오류를
    //    놓을 자리가 없으므로 `message` 에도 같은 문장을 담는다.
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { reason: reason.message },
      message: reason.message,
    };
  }

  try {
    return await softDeleteServiceReport({
      serviceReportId: input.serviceReportId,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.actorUserId,
      reason: reason.reason,
    });
  } catch (err) {
    console.error("deleteServiceReportAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 휴지통에서 되살린다.
 *
 * 문턱이 지우기와 **같다**(MANAGE) — `auth/service-report-authorization.ts` 가
 * "지울 수는 있는데 되돌릴 수는 없는" 역할을 만들지 않으려고 둘을 한 함수로
 * 묶어 두었다. 그래서 여기서도 `"delete"` 를 그대로 쓴다.
 *
 * 🔴 **사유를 받지 않는다.** 되돌리는 일에는 이유를 묻지 않는다 — 공용 복원
 * 창(`MasterDataRestoreDialog`)에도 사유 칸이 없고, mutation 이 남기는 감사
 * 기록(`RESTORE`)에 누가 언제 되살렸는지가 이미 있다.
 *
 * 되살리기를 막는 겹침은 없다(mutation 머리말 — 문서번호에 유일성을 걸지
 * 않았다). 그래서 실패는 `NOT_FOUND`(이미 되살려졌거나 없는 장)와
 * `CONFLICT`(그 사이에 누가 손댔다) 둘뿐이다.
 */
export async function restoreServiceReportAction(input: {
  serviceReportId: string;
  expectedVersion: number;
}): Promise<ServiceReportActionResult> {
  const auth = await resolveAuthorizedActor("delete");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const identity = validateReportIdentity(input?.serviceReportId, input?.expectedVersion);
  if (identity) return identity;

  try {
    return await restoreServiceReport({
      serviceReportId: input.serviceReportId,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.actorUserId,
    });
  } catch (err) {
    console.error("restoreServiceReportAction: unexpected DB error", err);
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 🔴 **휴지통의 보고서 한 장을 되돌릴 수 없게 지운다** (2026-10-28).
 *
 * 순서는 이 파일의 다른 액션과 **같다** — 관문 → 신원 검증 → 사유 → mutation.
 * 순서가 곧 규칙이라는 머리말이 여기에도 그대로 걸린다: 사유를 먼저 보면
 * 로그인하지 않은 요청이 "사유가 몇 자까지 되나"를 알아낼 수 있다.
 *
 * 🔴 **관문이 `"purge"` 다** — MANAGE 를 넘은 뒤 개발자 모드 관문을 한 번 더
 * 지난다(위 머리말의 '완전 삭제만 문턱이 하나 더 있다'). 화면도 같은 판정으로
 * 단추를 감추지만(`report/page.tsx`), 그것은 편의일 뿐이라 이 줄이 없으면
 * 아무것도 막지 못한다.
 *
 * 🔴 **사유가 필수다**(`readServiceReportPurgeReason` — 지우기의 선택 사유와
 * 다른 함수다). 되돌릴 수 없는 조작이라 왜 지웠는지가 감사에 남아야 한다.
 *
 * 결과에 **version 이 없다** — 행이 사라졌으므로 돌려줄 다음 판이 없다
 * (mutation 의 `ServiceReportPurgeResult`). 그래서 이 액션만 반환 타입이 다르다.
 */
export async function permanentlyDeleteServiceReportAction(input: {
  serviceReportId: string;
  expectedVersion: number;
  reason: string;
}): Promise<ServiceReportPurgeActionResult> {
  const auth = await resolveAuthorizedActor("purge");
  if (!auth.ok) return { ok: false, code: auth.code, message: auth.message };

  const identity = validateReportIdentity(input?.serviceReportId, input?.expectedVersion);
  if (identity) return { ok: false, code: identity.code, message: identity.message };

  const reason = readServiceReportPurgeReason(input?.reason);
  if (!reason.ok) {
    // 🔴 이 실패는 **확인 창 안에** 그대로 뜬다(`submitError`) — 지우기 액션의
    //    같은 자리와 같은 까닭이다. 창에는 칸별 오류를 놓을 자리가 없다.
    return { ok: false, code: "VALIDATION_ERROR", message: reason.message };
  }

  try {
    const result = await permanentlyDeleteServiceReport({
      serviceReportId: input.serviceReportId,
      expectedVersion: input.expectedVersion,
      actorUserId: auth.actorUserId,
      reason: reason.reason,
    });
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true, id: result.id };
  } catch (err) {
    // 🔴 오류 객체를 통째로 남기지 않고 코드만 남긴다 — 되돌릴 수 없는 조작의
    //    실패라 사유(사람이 적은 글자)가 오류 문맥에 섞여 로그로 새면 안 된다
    //    (`actions/quotes.ts` 의 완전 삭제와 같은 판단).
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    console.error("permanentlyDeleteServiceReportAction: unexpected DB error", {
      id: input.serviceReportId,
      code,
    });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * 「어느 장을 어느 시점 기준으로」가 성립하는가. 성립하면 `null`, 아니면 그대로
 * 돌려줄 실패다.
 *
 * ⚠️ 이 파일은 `"use server"` 라 **내보내는 것은 전부 async 함수여야 한다.** 그래서
 * 이 도우미는 내보내지 않는다(Next 가 빌드에서 막는다).
 *
 * 🔴 반환 타입이 **실패 갈래로 좁혀져 있다**(`Extract<…, { ok: false }>`).
 * `ServiceReportActionResult` 를 그대로 쓰면 「성공일 수도 있는 값」이 되어,
 * 반환 모양이 다른 완전 삭제 액션이 여기서 받은 실패를 되넘길 수 없다 — 그 액션은
 * `version` 을 돌려주지 않으므로 `code`·`message` 만 꺼내 다시 싸야 한다.
 * 기존 세 액션은 `return identity;` 그대로다(실패 갈래는 원래 타입에 그대로 든다).
 */
function validateReportIdentity(
  serviceReportId: unknown,
  expectedVersion: unknown
): Extract<ServiceReportActionResult, { ok: false }> | null {
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
