"use server";

import { sessionActorWithDeveloperFlag } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { toKstDateOnly } from "@/lib/domain/date-only";
import {
  KYOSAN_IMPORT_PERMISSION_AREA,
  buildKyosanImportPreview,
  executeKyosanImportChunk,
  type KyosanChunkResult,
  type KyosanImportActor,
  type KyosanPreviewResult,
} from "@/lib/server/services/kyosan-intake-import";
import { REPAIR_CASE_XLSX_SAFETY_LIMITS } from "@/lib/xlsx/xlsx-upload-safety";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 서버 액션 (정책 계층)
 * ============================================================================
 * 관문 순서: 저장 모드 · 읽기 원천(actions/create-repair-case.ts 와 같다) → 세션 → 승인 →
 * 권한(kyosanIntakeImport 관리) → 파일 → 서비스. 권한을 파일보다 먼저 본다 — 권한 없는 요청이
 * 어떤 파일이 통과하는지를 알아낼 수 없게.
 *
 * 행위자는 A/S 접수 액션과 같다 — 역할 · 승인은 세션 값, 개발자 표시만 살아 있는 계정에서
 * 읽는다(sessionActorWithDeveloperFlag). 수리 건을 만드는 창구도 같다
 * (createRepairCaseWithIdempotency, EXCEL_IMPORT — 접수 메일을 보내지 않는다).
 *
 * 파일은 FormData 로 받는다(actions/intake-mail-settings.ts 의 서명 이미지와 같은 이유 —
 * base64 는 33% 부푼다). 크기 한도는 xlsx 안전 검사 한도(20MiB)이고, next.config 의
 * serverActions bodySizeLimit(21mb)이 그보다 조금 크게 잡혀 있다.
 *
 * `today` 는 서버의 한국 날짜다(출하일이 미래인지 볼 때 쓴다).
 *
 * ── 🔴 로그에 입력값을 싣지 않는다 ─────────────────────────────────────────
 * 파일에는 고객사 · S/N 이 있다. 예상 밖 오류는 이름 · PG 코드 · 제약 이름만 적는다
 * (improvement-requests.ts 의 describeErrorWithoutValues 와 같은 방식 — "use server" 파일은
 * async 함수만 내보낼 수 있어 가져오지 못하고 여기 다시 적는다).
 * ============================================================================
 */

export type KyosanImportActionFailure = {
  ok: false;
  code: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION_ERROR" | "DATABASE_UNAVAILABLE";
  message: string;
};

export type PreviewKyosanIntakeImportActionResult = KyosanPreviewResult | KyosanImportActionFailure;
export type ExecuteKyosanIntakeImportChunkActionResult = KyosanChunkResult | KyosanImportActionFailure;

const FORBIDDEN_MESSAGE = "과거 인수품을 가져올 권한이 없습니다.";
const DATABASE_UNAVAILABLE_MESSAGE = "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
/** rowNumbers 칸 글자 수의 상한 — 50줄의 행 번호는 넉넉히 들어가고, 거대한 본문은 막는다. */
const ROW_NUMBERS_FIELD_MAX = 2_000;

function invalid(message: string): KyosanImportActionFailure {
  return { ok: false, code: "VALIDATION_ERROR", message };
}

async function resolveImportActor(): Promise<{ ok: true; actor: KyosanImportActor } | KyosanImportActionFailure> {
  if (getRepairCaseWriteSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  // DB 에 만든 건이 목(mock) 읽기 원천에서 404 가 되면 안 된다 — actions/create-repair-case.ts 와 같다.
  if (getRepairCaseReadSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "서버 설정 오류로 저장할 수 없습니다. 관리자에게 문의해 주세요." };
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

async function readWorkbookFile(
  formData: FormData
): Promise<{ ok: true; bytes: Buffer; fileName: string } | KyosanImportActionFailure> {
  const file = formData.get("file");
  if (!(file instanceof File)) return invalid("파일을 확인할 수 없습니다. .xlsx 파일을 골라 주세요.");

  const limit = REPAIR_CASE_XLSX_SAFETY_LIMITS.maxCompressedBytes;
  const tooLarge = `${Math.round(limit / (1024 * 1024))}MB 이하의 .xlsx 파일만 올릴 수 있습니다.`;
  if (file.size === 0) return invalid("빈 파일입니다.");
  if (file.size > limit) return invalid(tooLarge);

  const bytes = Buffer.from(await file.arrayBuffer());
  // 브라우저가 알려 준 크기와 실제 바이트가 다를 수 있다 — 실물로 다시 본다.
  if (bytes.length === 0) return invalid("빈 파일입니다.");
  if (bytes.length > limit) return invalid(tooLarge);
  return { ok: true, bytes, fileName: file.name };
}

/** `[18,19,20]` 모양의 JSON. 숫자 배열이 아니면 null. 줄 수 · 값 범위는 서비스가 본다. */
function parseRowNumbers(raw: FormDataEntryValue | null): number[] | null {
  if (typeof raw !== "string" || raw.length > ROW_NUMBERS_FIELD_MAX) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((item) => typeof item === "number") ? value : null;
  } catch {
    return null;
  }
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

function databaseUnavailable(): KyosanImportActionFailure {
  return { ok: false, code: "DATABASE_UNAVAILABLE", message: DATABASE_UNAVAILABLE_MESSAGE };
}

/**
 * 미리보기 — DB 에 쓰지 않는다. FormData: `file`(.xlsx).
 */
export async function previewKyosanIntakeImportAction(
  formData: FormData
): Promise<PreviewKyosanIntakeImportActionResult> {
  const auth = await resolveImportActor();
  if (!auth.ok) return auth;
  const file = await readWorkbookFile(formData);
  if (!file.ok) return file;

  try {
    return await buildKyosanImportPreview({
      bytes: file.bytes,
      fileName: file.fileName,
      actor: auth.actor,
      today: toKstDateOnly(new Date()),
    });
  } catch (err) {
    logUnexpectedError("previewKyosanIntakeImportAction", err);
    return databaseUnavailable();
  }
}

/**
 * 조각 하나 실행. FormData: `file`(미리보기 때와 같은 .xlsx) · `batchId` · `fileSha256`
 * (미리보기가 준 값) · `rowNumbers`(JSON 숫자 배열, 최대 50개 — 화면은 25개씩).
 */
export async function executeKyosanIntakeImportChunkAction(
  formData: FormData
): Promise<ExecuteKyosanIntakeImportChunkActionResult> {
  const auth = await resolveImportActor();
  if (!auth.ok) return auth;
  const file = await readWorkbookFile(formData);
  if (!file.ok) return file;

  const batchId = formData.get("batchId");
  const fileSha256 = formData.get("fileSha256");
  const rowNumbers = parseRowNumbers(formData.get("rowNumbers"));
  if (typeof batchId !== "string" || typeof fileSha256 !== "string" || rowNumbers === null) {
    return invalid("실행 정보를 확인할 수 없습니다. 미리보기부터 다시 해 주세요.");
  }

  try {
    return await executeKyosanImportChunk({
      bytes: file.bytes,
      fileName: file.fileName,
      batchId,
      fileSha256,
      rowNumbers,
      actor: auth.actor,
      today: toKstDateOnly(new Date()),
    });
  } catch (err) {
    logUnexpectedError("executeKyosanIntakeImportChunkAction", err);
    return databaseUnavailable();
  }
}
