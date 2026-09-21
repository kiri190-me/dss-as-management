"use server";

import { sessionActorWithDeveloperFlag } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import {
  KYOSAN_REPORT_UPLOAD_MAX_BYTES,
  type KyosanReportPreviewOutcome,
} from "@/lib/domain/kyosan-report-import/preview-view";
import { readKyosanReport } from "@/lib/kyosan/kyosan-report";
import {
  KYOSAN_IMPORT_PERMISSION_AREA,
  type KyosanImportActor,
} from "@/lib/server/services/kyosan-intake-import";
import {
  importKyosanReport,
  type KyosanReportImportResult,
} from "@/lib/server/services/kyosan-report-import";
import { buildKyosanReportImportPreview } from "@/lib/server/services/kyosan-report-preview";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";

/**
 * ============================================================================
 * 연락서 한 장 넣기 — 서버 액션 (정책 계층, 2026-09-21 조각 S4)
 * ============================================================================
 * 관문 차례는 과거 인수품 가져오기와 같다(actions/kyosan-intake-import.ts):
 * 저장 모드 · 읽기 원천 → 세션 → 승인 → 권한 → 파일 → 서비스. 권한을 파일보다
 * 먼저 본다 — 권한 없는 요청이 어떤 파일이 통과하는지를 알아낼 수 없게.
 *
 * ── 🔴 액션이 권한을 **다시** 판정한다 ───────────────────────────────
 * 화면 가드(`requireAreaAccessForCurrentUser`)는 화면을 그릴 때만 돈다. 서버
 * 액션은 주소만 알면 브라우저에서 직접 부를 수 있으므로, 두 액션 모두 세션부터
 * 다시 읽고 실효 권한(`hasPermission … "MANAGE"`)을 다시 본다.
 *
 * ── 🔴 권한을 새로 만들지 않았다 ─────────────────────────────────────
 * 같은 교산 양식을 다루고 같은 무게의 일(남의 수리 건에 자료가 들어간다)이라
 * **과거 인수품 가져오기와 같은 판정**을 그대로 쓴다 —
 * `KYOSAN_IMPORT_PERMISSION_AREA`(= `kyosanIntakeImport`) 의 관리 수준이다.
 * 흉내 낸 검사를 새로 적지 않았다.
 *
 * ── 🔴 화면이 보내는 것은 셋뿐이다 ───────────────────────────────────
 *  · `file`               연락서 원본
 *  · `repairCaseId`       화면이 저장하려는 건 — 저장 함수에서 **자물쇠**로 쓰인다
 *  · `chosenRepairCaseId` 후보가 여럿이라 **사람이 골랐을 때만** 실린다(S4b)
 *
 * 🔴 뒤의 둘은 **뜻이 다르다.** 앞의 것은 「화면이 본 건과 서버가 다시 판정한
 * 건이 같은가」를 보는 자물쇠이고, 뒤의 것은 「사람이 후보 중 이것을 골랐다」를
 * 나르는 통로다. 하나로 합치면 자물쇠가 제 구실을 못 한다. 실려 오면 둘은 같은
 * 값이어야 하고(아래에서 확인한다), 고르기가 실제로 먹히는지는 저장 함수가
 * **다시 만든 후보 목록**으로 정한다.
 *
 * 미리보기 결과 · 넣을 줄 · 부품 목록은 **받지 않는다** — 저장 함수가 파일에서
 * 처음부터 다시 만든다(services/kyosan-report-import.ts 머리말). 화면이 계산한
 * 것을 받는 순간 「사람이 본 것」과 「들어간 것」이 갈라진다.
 *
 * ── 🔴 로그에 입력값을 싣지 않는다 ───────────────────────────────────
 * 연락서에는 고객사 · 모델 · S/N · 고장 내용이 그대로 들어 있다. 예상 밖 오류는
 * 이름 · PG 코드 · 제약 이름만 적는다("use server" 파일은 async 함수만 내보낼 수
 * 있어 같은 도우미를 가져오지 못하고 여기 다시 적는다).
 * ============================================================================
 */

export type KyosanReportActionFailure = {
  ok: false;
  code: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION_ERROR" | "DATABASE_UNAVAILABLE";
  message: string;
};

export type PreviewKyosanReportActionResult = KyosanReportPreviewOutcome | KyosanReportActionFailure;
export type ImportKyosanReportActionResult = KyosanReportImportResult | KyosanReportActionFailure;

const FORBIDDEN_MESSAGE = "연락서를 가져올 권한이 없습니다.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MB = Math.floor(KYOSAN_REPORT_UPLOAD_MAX_BYTES / (1024 * 1024));

function invalid(message: string): KyosanReportActionFailure {
  return { ok: false, code: "VALIDATION_ERROR", message };
}

/**
 * 🔴 두 액션이 **각자** 부르는 관문. 세션 · 승인 · 권한을 여기서 다시 본다.
 */
async function resolveReportImportActor(): Promise<
  { ok: true; actor: KyosanImportActor } | KyosanReportActionFailure
> {
  if (getRepairCaseWriteSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  if (getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "서버 설정 오류로 저장할 수 없습니다. 관리자에게 문의해 주세요.",
    };
  }
  const session = await readSession();
  if (!session) return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  const { isDeveloper } = await sessionActorWithDeveloperFlag(session);
  const actor: KyosanImportActor = {
    userId: session.userId,
    role: session.role,
    approvalStatus: session.approvalStatus,
    isDeveloper,
  };
  if (!(await hasPermission(actor, KYOSAN_IMPORT_PERMISSION_AREA, "MANAGE"))) {
    return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MESSAGE };
  }
  return { ok: true, actor };
}

/** 연락서 원본 한 장. `.xlsm`(매크로 양식)과 `.xlsx` 둘 다 받는다. */
async function readReportFile(
  formData: FormData
): Promise<{ ok: true; bytes: Buffer; fileName: string } | KyosanReportActionFailure> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return invalid("파일을 확인할 수 없습니다. 연락서 파일을 골라 주세요.");
  }
  if (!/\.(xlsm|xlsx)$/i.test(file.name)) {
    return invalid(".xlsm 또는 .xlsx 연락서 파일만 올릴 수 있습니다.");
  }

  const tooLarge = `${MAX_MB}MB 이하의 연락서 파일만 올릴 수 있습니다.`;
  if (file.size === 0) return invalid("빈 파일입니다.");
  if (file.size > KYOSAN_REPORT_UPLOAD_MAX_BYTES) return invalid(tooLarge);

  const bytes = Buffer.from(await file.arrayBuffer());
  // 브라우저가 알려 준 크기와 실제 바이트가 다를 수 있다 — 실물로 다시 본다.
  if (bytes.length === 0) return invalid("빈 파일입니다.");
  if (bytes.length > KYOSAN_REPORT_UPLOAD_MAX_BYTES) return invalid(tooLarge);
  return { ok: true, bytes, fileName: file.name };
}

/** 오류에서 값이 없는 부분만 꺼낸다 — 파일 머리의 '로그에 입력값을 싣지 않는다'. */
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

function logUnexpectedError(actionName: string, err: unknown): void {
  console.error(`${actionName}: unexpected error`, describeErrorWithoutValues(err));
}

function databaseUnavailable(): KyosanReportActionFailure {
  return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
}

/**
 * 미리보기 — 🔴 **DB 에 한 줄도 쓰지 않는다.** FormData: `file`.
 */
export async function previewKyosanReportAction(
  formData: FormData
): Promise<PreviewKyosanReportActionResult> {
  const auth = await resolveReportImportActor();
  if (!auth.ok) return auth;
  const file = await readReportFile(formData);
  if (!file.ok) return file;

  try {
    return await buildKyosanReportImportPreview({ bytes: file.bytes });
  } catch (err) {
    logUnexpectedError("previewKyosanReportAction", err);
    return databaseUnavailable();
  }
}

/**
 * 이식 — 🔴 **DB 에 쓴다.** FormData 는 셋뿐이다(머리말):
 *  · `file`               미리보기에 쓴 것과 같은 연락서 원본
 *  · `repairCaseId`       화면이 저장하려는 수리 건 — **자물쇠**
 *  · `chosenRepairCaseId` 후보가 여럿이라 사람이 골랐을 때만
 *
 * 🔴 미리보기 결과는 받지 않는다. 저장 함수가 파일에서 짝짓기 · 미리보기를
 * 처음부터 다시 돌리고, `repairCaseId` 는 **「사람이 본 건이 맞는가」를 확인하는
 * 자물쇠**로만 쓰인다(다르면 `TARGET_CHANGED`).
 */
export async function importKyosanReportAction(
  formData: FormData
): Promise<ImportKyosanReportActionResult> {
  const auth = await resolveReportImportActor();
  if (!auth.ok) return auth;
  const file = await readReportFile(formData);
  if (!file.ok) return file;

  const repairCaseId = formData.get("repairCaseId");
  if (typeof repairCaseId !== "string" || !UUID_PATTERN.test(repairCaseId)) {
    return invalid("넣을 수리 건을 고르지 않았습니다. 미리보기에서 수리 건을 골라 주세요.");
  }

  // 🔴 고르기는 실려 올 수도, 안 올 수도 있다(접수번호로 확정된 짝에는 없다).
  //    실려 왔다면 자물쇠와 같은 건이어야 한다 — 서로 다른 건을 가리키면
  //    「무엇을 보고 눌렀는가」가 갈라진 것이므로 문 앞에서 막는다.
  const chosenRepairCaseId = formData.get("chosenRepairCaseId");
  if (chosenRepairCaseId !== null && typeof chosenRepairCaseId !== "string") {
    return invalid("고른 수리 건을 확인할 수 없습니다. 미리보기부터 다시 해 주세요.");
  }
  if (chosenRepairCaseId !== null && chosenRepairCaseId !== repairCaseId) {
    return invalid("고른 수리 건이 화면과 다릅니다. 미리보기부터 다시 해 주세요.");
  }

  const read = readKyosanReport(file.bytes);
  if (!read.ok) {
    return invalid("연락서를 읽지 못했습니다. 미리보기부터 다시 해 주세요.");
  }

  try {
    return await importKyosanReport({
      report: read.report,
      sourceFileName: file.fileName,
      sourceBytes: file.bytes,
      // 🔴 자물쇠와 고르기는 **다른 매개변수**다(머리말). 저장 함수에서 뜻이 다르다.
      expectedRepairCaseId: repairCaseId,
      chosenRepairCaseId,
      actorUserId: auth.actor.userId,
      storage: getAttachmentStorage(),
    });
  } catch (err) {
    logUnexpectedError("importKyosanReportAction", err);
    return databaseUnavailable();
  }
}
