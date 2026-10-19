import "server-only";

import { canEditProductModels } from "@/lib/auth/product-model-authorization";
import { actorHasAllowedRole, actorMay } from "@/lib/auth/developer-promotion";
import {
  claimIdempotencyKey,
  markIdempotencyKeyFailed,
  markIdempotencyKeySucceeded,
} from "@/lib/db/mutations/idempotency-keys";
import { recordContactFolderFileSaved } from "@/lib/db/mutations/contact-folders";
import { createRepairCase, type LegacyImportMetadata } from "@/lib/db/mutations/repair-cases";
import { listAttachmentsForProductModelKind } from "@/lib/db/queries/product-model-kind-attachments";
import { createContactFolderForIntake } from "./create-contact-folder";
import { saveIntakeRepairRequest } from "./save-intake-repair-request";
import { sendIntakeNotificationMail } from "./send-intake-mail";
import type { IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { productModelKindOfWorkflowKind } from "@/lib/domain/product-model-kind";
import type { Role } from "@/lib/domain/types";
import { WORKFLOW_KIND_CODES, workflowKindOf, type WorkflowKind } from "@/lib/domain/workflow-kind";
import { copyIntoContactFolderCommonFolder } from "@/lib/storage/contact-folder-archive";
import { getAttachmentStorage } from "@/lib/storage/local-fs-adapter";
import {
  isValidIdempotencyKey,
  validateCreateRepairCaseInput,
  type CreateRepairCaseResult,
} from "@/lib/validation/repair-case-input";

export const ALLOWED_INTAKE_CREATOR_ROLES: readonly Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "AS_ENGINEER",
  "SALES",
  "INVENTORY_MANAGER",
];

export type RepairCaseCreator = {
  userId: string;
  role: Role;
  approvalStatus: "PENDING" | "APPROVED";
  /**
   * 개발자 표시(users.is_developer). 세션 토큰에는 없는 값이라 호출부가 살아
   * 있는 계정에서 읽어 넘긴다 — 못 읽으면 false 다(닫히는 쪽).
   *
   * 접수 화면은 이미 승격된 판정으로 「새 Model 등록」 칸을 여닫으므로
   * (repair-cases/new/page.tsx 의 hasPermission), 이 값이 없으면 화면은
   * 열어 두고 저장은 거절하는 어긋남이 생긴다.
   */
  isDeveloper: boolean;
};

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

/**
 * 과거 상태 이관이 수리 건을 놓을 수 있는 단계. 인수점검 · 교산 회신 대기 · 출하 승인(제너레이터·T/C 의
 * 出荷待ち)은 과거 인수품 가져오기(2026-09-15)가 더했다 — 셋 다 관리자 수동 단계 변경으로도 갈 수 있는
 * 자리이고, 그 뒤는 정규 흐름(검수 → 최종 출하 승인 → 출하 완료)을 탄다.
 */
const LEGACY_IMPORT_TARGET_STEPS = new Set([
  "intake_inspection",
  "waiting_kyosan_reply",
  "shipment_approved",
  "shipment_completed",
  "waiting_po",
  "parts_supply",
  "waiting_shipment",
  "repair_in_progress",
  "repair_or_defective_parts_replacement",
]);

/** 가져오기 흔적 metadata 가 가질 수 있는 칸 — 이것만, 전부 있어야 한다. */
const LEGACY_IMPORT_METADATA_KEYS = new Set([
  "source",
  "fileSha256",
  "billingReview",
  "billingAdjustment",
  "sourceStatus",
  "sourceBilling",
  "sourceReportedSymptom",
]);

/** metadata 에 싣는 원문 글자의 한도. 부르는 쪽이 잘라서 넘긴다. */
const LEGACY_IMPORT_METADATA_TEXT_MAX = 50;

function isShortTextOrNull(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length <= LEGACY_IMPORT_METADATA_TEXT_MAX);
}

/**
 * 가져오기 흔적(LEGACY_IMPORT_STATE_SET 이력)의 metadata.
 *
 * 🔴 고객 이름 같은 개인정보가 섞이지 않게 **정해진 칸만** 받는다 — 칸이 하나라도 더 있거나
 * 모자라면 거절한다(schema/status-change-histories.ts 의 metadata 주석). source 는 고정값,
 * sha 는 64자리 hex, 원문 글자는 50자 이하.
 */
function validLegacyImportMetadata(metadata: unknown): boolean {
  if (metadata === undefined) return true;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return false;
  const keys = Object.keys(metadata);
  if (keys.length !== LEGACY_IMPORT_METADATA_KEYS.size || !keys.every((key) => LEGACY_IMPORT_METADATA_KEYS.has(key))) {
    return false;
  }
  const value = metadata as Record<string, unknown>;
  return (
    value.source === "KYOSAN_INTAKE_LIST" &&
    typeof value.fileSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.fileSha256) &&
    typeof value.billingReview === "boolean" &&
    (value.billingAdjustment === null || value.billingAdjustment === "WARRANTY_PO_TO_PARTIAL_PAID") &&
    isShortTextOrNull(value.sourceStatus) &&
    isShortTextOrNull(value.sourceBilling) &&
    isShortTextOrNull(value.sourceReportedSymptom)
  );
}

function validLegacyImportState(input: NonNullable<Parameters<typeof createRepairCaseWithIdempotency>[0]["legacyImportState"]>): boolean {
  const completed = input.targetStepKey === "shipment_completed";
  return LEGACY_IMPORT_TARGET_STEPS.has(input.targetStepKey)
    && Number.isInteger(input.sourceRowNumber)
    && input.sourceRowNumber >= 4
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.batchId)
    && (completed
      ? input.actualShipmentDate === null || /^\d{4}-\d{2}-\d{2}$/.test(input.actualShipmentDate)
      : input.actualShipmentDate === null)
    && validLegacyImportMetadata(input.metadata)
    && (input.productModelKindForNew === undefined
      || (WORKFLOW_KIND_CODES as readonly string[]).includes(input.productModelKindForNew));
}

/**
 * ============================================================================
 * 접수한 건의 연락서 폴더에 **그 종류의 공통 서류**를 꽂는다 (2026-10-06)
 * ============================================================================
 * 종류(제너레이터 · 매쳐 · T/C)마다 늘 같은 서류가 붙는다 — 기본 파라미터 표 · 점검표
 * 같은 것이다. 사람이 건마다 탐색기로 복사해 넣던 일을 접수가 대신한다.
 *
 *  · 🔴 **어느 종류인가는 접수할 때 사람이 고른 것**으로 정한다(workflowType → 워크플로
 *    종류 → 제품 종류). 제품 모델 마스터의 `kind` 를 쓰지 않는 까닭과 두 축을 옮기는
 *    규율은 domain/product-model-kind.ts 의 productModelKindOfWorkflowKind 머리말에 있다.
 *  · 🔴 **서류가 0 장이면 아무 일도 하지 않는다** — 빈 `공통/` 폴더가 서지 않게, 한 번도
 *    꽂기를 부르지 않는다(폴더는 꽂을 때 생긴다).
 *  · 🔴 **한 장이 실패해도 나머지를 계속** 꽂는다. 원본을 못 읽는 서류 하나 때문에 그 건의
 *    다른 서류가 통째로 빠지면 안 된다.
 *  · 🔴 **ZIP 으로 묶지 않는다** — 낱개로 꽂는다([DATA에 저장] 통로와 같은 판단: 공유폴더에
 *    ZIP 을 두면 사람이 탐색기에서 또 풀어야 한다).
 *  · 🔴 **감사는 `copied` 일 때만** 남긴다 — 같은 내용이 이미 있어 쓰지 않은 경우
 *    (`unchanged`)에는 공유폴더에 새로 생긴 것이 없다(db/mutations/contact-folders.ts 의
 *    recordContactFolderFileSaved 머리말과 같은 규율). 기록이 실패해도 **숨기지 않고**
 *    세어서 돌려준다 — 접수는 그것 때문에 멈추지 않는다.
 *  · 🔴 **던지지 않는다.** 밖으로 나가는 것은 센 수뿐이고, 🔴 **파일 이름 · 폴더 이름 ·
 *    경로 · 오류 메시지를 담는 칸이 없다**(부르는 쪽이 그대로 로그에 적는다).
 * ============================================================================
 */
type IntakeCommonFileTally = {
  /** 이번에 새로 꽂은 수. */
  copied: number;
  /** 같은 내용이 이미 있어 건너뛴 수(`unchanged`). */
  unchanged: number;
  /** 꽂지 못한 수 — 원본을 못 읽었거나 꽂기가 실패했다. */
  failed: number;
  /** 꽂기는 했는데 감사 기록을 남기지 못한 수. */
  auditFailed: number;
  /** 🔴 마지막으로 꽂지 못한 까닭의 **상태 코드**. 사유 문장도 경로도 아니다. */
  lastFailureStatus: string | null;
};

/** 저장된 원본을 못 읽었다 — 꽂기 모듈의 상태 코드와 섞이지 않는 이름이다. */
const COMMON_FILE_READ_FAILED = "read-failed";
/** 꽂기는 성공했는데 감사 기록이 안 남았다. */
const COMMON_FILE_AUDIT_FAILED = "audit-failed";

async function copyKindCommonFilesForIntake(input: {
  repairCaseId: string;
  /** 🔴 연락서 폴더를 찾는 열쇠는 인수번호 하나뿐이다. */
  intakeNumber: string;
  /** 접수할 때 사람이 고른 워크플로의 종류. */
  kind: WorkflowKind;
  /** 🔴 접수한 사람. 이 길에도 시스템이 혼자 하는 경우가 없다. */
  actorUserId: string;
}): Promise<IntakeCommonFileTally> {
  const tally: IntakeCommonFileTally = {
    copied: 0,
    unchanged: 0,
    failed: 0,
    auditFailed: 0,
    lastFailureStatus: null,
  };

  // 🔴 **안 지워진** 서류만 온다(휴지통은 빠진다) — 조회가 부분 인덱스를 타는 모양
  //    그대로 `is_deleted = false` 를 걸고 있다.
  const files = await listAttachmentsForProductModelKind(productModelKindOfWorkflowKind(input.kind));

  for (const file of files) {
    // 🔴 바이너리는 DB 에 없다 — 디스크(UPLOADS_DIR)에서 읽는다. stored_path 는 그 루트
    //    기준 상대 경로이고, 읽는 모양은 [DATA에 저장] 통로와 같다.
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(
        await new Response(await getAttachmentStorage().read(file.storedPath)).arrayBuffer()
      );
    } catch {
      // 🔴 잡은 오류를 들여다보지 않는다 — message 에 전체 경로가 들어 있다.
      tally.failed += 1;
      tally.lastFailureStatus = COMMON_FILE_READ_FAILED;
      continue;
    }

    const placed = await copyIntoContactFolderCommonFolder({
      intakeNumber: input.intakeNumber,
      originalFileName: file.originalFileName,
      bytes,
    });

    if (placed.status === "unchanged") {
      tally.unchanged += 1;
      continue;
    }
    if (placed.status !== "copied") {
      tally.failed += 1;
      tally.lastFailureStatus = placed.status;
      continue;
    }

    tally.copied += 1;
    try {
      await recordContactFolderFileSaved({
        actorUserId: input.actorUserId,
        repairCaseId: input.repairCaseId,
        attachmentId: file.id,
        fileName: placed.fileName,
        // 🔴 적어 둔 칸 값이 아니라 **실제로 쓴 바이트 수**다([DATA에 저장] 통로와 같다).
        fileSize: bytes.byteLength,
      });
    } catch {
      // 공유폴더에는 이미 들어갔다 — 🔴 지우지 않는다. 숨기지도 않는다.
      tally.auditFailed += 1;
      tally.lastFailureStatus = COMMON_FILE_AUDIT_FAILED;
    }
  }

  return tally;
}

/**
 * Shared intake execution boundary. The interactive Server Action and Excel
 * chunk runner both enter here, so validation, authorization, idempotency and
 * the one-case transaction remain identical. It never reads a session and is
 * therefore safe to call repeatedly after a batch action resolved its actor.
 */
export async function createRepairCaseWithIdempotency(input: {
  actor: RepairCaseCreator;
  intake: IntakeSubmissionInput;
  idempotencyKey: string;
  logContext: "INTERACTIVE" | "EXCEL_IMPORT";
  legacyImportState?: {
    targetStepKey: string;
    actualShipmentDate: string | null;
    batchId: string;
    sourceRowNumber: number;
    /** 가져오기 흔적 이력에 더 적을 것 — validLegacyImportMetadata 가 칸을 본다. */
    metadata?: LegacyImportMetadata;
    /** 이 줄이 새 모델을 만들게 되면 그 모델의 종류. 기존 모델은 건드리지 않는다. */
    productModelKindForNew?: WorkflowKind;
  };
  legacyReportNumber?: string | null;
  /**
   * ==========================================================================
   * 🔴 접수와 함께 올라온 **수리 의뢰서** — 선택이다 (2026-10-19)
   * ==========================================================================
   * 붙이면 그 건의 연락서 폴더 안 「수리 의뢰서」 폴더에 저장되고, 접수 알림
   * 메일에 **진짜 첨부**로 함께 나간다.
   *
   *  · 🔴 **없으면 아래 흐름이 예전과 한 글자도 다르지 않게 돈다** — 선택 기능이다.
   *  · 🔴 **바이트는 메모리에만 있다.** 서버 디스크에 쓰지 않고, 첨부 표
   *    (`attachments`)에 행도 만들지 않는다 — 디스크에 없는 파일의 기록만 남기면
   *    화면에 **눌러도 안 열리는 줄**이 된다(사용자에게 알린 판단이다).
   *    그래서 **지울 임시본 자체가 없다.**
   *  · 🔴 `mimeType` 은 **확장자에서 서버가 고른 정본**이다(브라우저가 보낸 값이
   *    아니다). 받아도 되는 파일인지는 부르는 쪽이 이미
   *    `checkIntakeRepairRequestFile` 로 가렸다 — 이 서비스는 다시 가르지 않는다.
   *  · 🔴 **EXCEL_IMPORT 에는 오지 않는다.** 아래 쓰는 자리가 전부 대화형 문 안이다.
   * ==========================================================================
   */
  repairRequest?: {
    fileName: string;
    mimeType: string;
    bytes: Buffer;
  } | null;
}): Promise<CreateRepairCaseResult> {
  const { actor, intake, idempotencyKey } = input;
  if (
    actor.approvalStatus !== "APPROVED" ||
    !actorHasAllowedRole({ role: actor.role, isDeveloper: actor.isDeveloper }, ALLOWED_INTAKE_CREATOR_ROLES)
  ) {
    return { ok: false, code: "FORBIDDEN", message: "A/S 접수 등록 권한이 없습니다." };
  }
  if (
    intake.newProductModelName &&
    !actorMay({ role: actor.role, isDeveloper: actor.isDeveloper }, canEditProductModels)
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      fieldErrors: { modelName: "새 Model 등록 권한이 없습니다. 등록된 Model을 선택해 주세요." },
      message: "새 Model 등록 권한이 없습니다.",
    };
  }
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { idempotencyKey: "제출 식별자를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요." },
      message: "입력값을 확인해 주세요.",
    };
  }
  const validation = validateCreateRepairCaseInput(intake, {
    allowPendingBilling: input.logContext === "EXCEL_IMPORT",
  });
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: "입력값을 확인해 주세요.",
    };
  }
  if (input.legacyImportState && input.logContext !== "EXCEL_IMPORT") {
    return { ok: false, code: "FORBIDDEN", message: "과거 상태 지정은 Excel 이관에서만 사용할 수 있습니다." };
  }
  if (input.legacyReportNumber !== undefined && input.logContext !== "EXCEL_IMPORT") {
    return { ok: false, code: "FORBIDDEN", message: "레거시 보고서번호는 Excel 이관에서만 사용할 수 있습니다." };
  }
  if (input.legacyReportNumber !== undefined && input.legacyReportNumber !== null && input.legacyReportNumber.length > 32767) {
    return { ok: false, code: "VALIDATION_ERROR", message: "레거시 보고서번호를 확인할 수 없습니다." };
  }
  if (input.legacyImportState && !validLegacyImportState(input.legacyImportState)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "과거 상태 이관 정보를 확인할 수 없습니다." };
  }

  const claim = await claimIdempotencyKey(idempotencyKey, actor.userId);
  if (claim.state === "IN_PROGRESS") {
    return { ok: false, code: "SUBMISSION_IN_PROGRESS", message: "이전 제출이 아직 처리 중입니다. 잠시 후 다시 시도해 주세요." };
  }
  if (claim.state === "SUCCEEDED") {
    return { ok: true, id: claim.repairCaseId, intakeNumber: claim.intakeNumber };
  }
  if (claim.state === "USER_MISMATCH") {
    return { ok: false, code: "FORBIDDEN", message: "A/S 접수 등록 권한이 없습니다." };
  }

  try {
    const result = await createRepairCase(validation.data, {
      legacyReportNumber: input.legacyReportNumber,
      ...(input.legacyImportState
        ? {
            legacyImportState: {
              ...input.legacyImportState,
              actorUserId: actor.userId,
            },
          }
        : {}),
    });
    if (result.ok) {
      await markIdempotencyKeySucceeded(idempotencyKey, result.id, result.intakeNumber);

      /*
       * ====================================================================
       * 접수가 확정된 뒤의 네 가지 — **대화형에서만, 이 차례로** (2026-10-19)
       * ====================================================================
       *   1) 연락서 폴더 만들기
       *   2) 🔴 수리 의뢰서를 그 폴더에 꽂기   (붙였을 때만)
       *   3) 접수 알림 메일 (의뢰서를 첨부해서)
       *   4) 종류 공통 서류 꽂기
       *
       * ■ 🔴 **왜 메일이 셋째로 내려왔나** (예전에는 맨 처음이었다)
       *   메일이 파일보다 먼저 나가면 안 되기 때문이다. 사용자가 받는 메일에는
       *   의뢰서가 붙어 있는데 공유폴더에는 아직 없거나 영영 없는 상태가 생기면,
       *   「메일에는 왔는데 폴더에 없다」를 아무도 설명할 수 없다. 그래서 **먼저
       *   서류함에 넣고 그 다음에 알린다.**
       *   ⚠️ 그 대가로 **의뢰서가 없는 접수에서도 메일이 폴더 만들기 뒤로 밀린다.**
       *   폴더 만들기는 설정이 비면 즉시 끝나고(디스크를 보지 않는다), 켜져 있을
       *   때도 readdir 한 번 + mkdir 한 번이라 보통 수십 ms 다. 차례를 건마다
       *   가르지 않는 쪽을 골랐다 — 길이 둘이면 「메일이 파일보다 뒤다」가 한쪽에서만
       *   지켜지고, 나중에 누가 분기를 바꿔도 아무도 모른다.
       *
       * ■ 🔴 **넷이 서로 모른다** — try 가 넷이다. 하나가 실패해도 나머지는 돈다.
       *
       * ■ EXCEL_IMPORT 를 제외하는 이유 (넷 모두)
       *   과거 자료를 옮기는 경로다. 여기서 돌면 이관 한 번에 메일 수백 통이
       *   전사원에게 나가고 공유폴더에 폴더가 수백 개 생긴다.
       *
       * ■ 🔴 **무엇이 실패해도 접수는 성공이다**
       *   넷 다 값을 돌려주기로 약속한 함수지만, 그 약속이 깨져도 접수 응답이
       *   실패로 뒤집히면 안 된다 — 물건은 이미 들어와 있고 접수 번호도 나갔다.
       *   그래서 네 토막 전부 try 로 감싸고, 안에 `return` 도 `throw` 도 없다.
       *
       * ■ 기다렸다가 응답한다(뒤로 미루지 않는다)
       *   접수 등록은 사람이 버튼을 누르고 기다리는 조작이다. 응답 뒤에 돌리려면
       *   그 작업을 살려 둘 장치가 따로 필요한데(서버리스에서는 응답과 함께
       *   죽는다) 이 시스템에는 그런 것이 없다. 늦어지는 만큼은 메일 transport 의
       *   타임아웃과 공유폴더 쪽 상한이 막는다.
       *
       * ■ 🔴 **로그에 경로 · 루트 · 폴더 이름 · 파일 이름을 적지 않는다**
       *   운영 로그가 사내 폴더 구조를 알려 주는 창구가 되면 안 된다 — 폴더 이름에는
       *   고객사와 S/N 이, fs 오류 message 에는 전체 경로가 들어 있다.
       * ====================================================================
       */

      /*
       * ── 1) 연락서 공유폴더 ── **접수가 확정된 뒤에, 대화형에서만.** (연락서 조각 7)
       *
       * 🔴 **맨 앞이다**(2026-10-19 에 메일보다 앞으로 올라왔다 — 위 차례 주석).
       * 수리 의뢰서를 꽂을 자리가 여기서 서야 하기 때문이다.
       *
       * 세 규율은 그대로다. 까닭도 같다:
       *
       * ■ EXCEL_IMPORT 를 제외한다
       *   과거 자료를 옮기는 경로다. 여기서 만들면 이관 한 번에 공유폴더에 폴더가
       *   수백 개 생긴다 — 이관 건의 폴더는 나중에 사람이 [폴더 만들고 열기]로 만든다.
       *
       * ■ 실패해도 접수는 그대로다
       *   createContactFolderForIntake 는 던지지 않고 값을 돌려준다. 그래도 여기서 한 번
       *   더 감싸는 이유는 메일과 같다 — 그 약속이 깨져도 접수 응답이 실패로 뒤집히면
       *   안 된다. 폴더가 안 만들어져도 접수는 성공이다.
       *
       * ■ 기다렸다가 응답한다(뒤로 미루지 않는다)
       *   응답 뒤에 돌리면 그 작업이 죽는다(위 메일 주석의 까닭 그대로). 공유폴더가
       *   느릴 때의 상한은 storage 쪽이 들고 있다.
       *
       * 🔴 **메일과 서로 모른다.** try 를 따로 두어 하나가 실패해도 다른 하나는 돈다.
       *
       * 🔴 **로그에 경로 · 루트를 적지 않는다.** 운영 로그가 사내 폴더 구조를 알려 주는
       *   창구가 되면 안 된다 — 남기는 것은 사유 코드와 수리 건 id 뿐이고, 폴더 이름도
       *   적지 않는다(고객사 · S/N 이 들어 있다).
       */
      if (input.logContext === "INTERACTIVE") {
        /*
         * 🔴 폴더가 **이번에 생겼거나 이미 있었는가.** 아래 공통 서류 꽂기가 이 값만
         *   본다 — `disabled`(기능이 꺼져 있다) · `multiple`(어느 폴더인지 앱이 고르지
         *   않는다) · `failed`(폴더가 없다)일 때는 꽂을 자리가 없거나 어디인지 모른다.
         *   `audit-failed` 도 꽂지 않는다: 디스크에 폴더는 있지만 그 순간 DB 쓰기가
         *   실패한 것이라, 꽂아 봐야 이어지는 감사 기록도 같이 실패할 자리다.
         */
        let contactFolderReady = false;
        try {
          const folder = await createContactFolderForIntake({
            repairCaseId: result.id,
            actorUserId: actor.userId,
          });
          contactFolderReady = folder.status === "created" || folder.status === "found";
          // 만들었다 · 이미 있었다 · 꺼져 있다는 정상 상태라 시끄럽게 굴지 않는다.
          // 나머지(인수번호가 같은 폴더가 여럿 · 기록 실패 · 실패)는 사람이 손을 대야 한다.
          if (folder.status !== "created" && folder.status !== "found" && folder.status !== "disabled") {
            console.error("접수 때 연락서 폴더를 만들지 못했습니다", {
              repairCaseId: result.id,
              status: folder.status,
              ...(folder.status === "failed" ? { reason: folder.reason } : {}),
            });
          }
        } catch (folderError) {
          // 🔴 오류의 message 를 적지 않는다 — fs 오류에는 경로가 들어 있다.
          console.error("접수 때 연락서 폴더에서 예상치 못한 오류", {
            repairCaseId: result.id,
            name: folderError instanceof Error ? folderError.name : typeof folderError,
          });
        }

        /*
         * ── 2) 🔴 **수리 의뢰서를 연락서 폴더에** ── 붙였을 때만 (2026-10-19)
         *
         * ■ 🔴 **메일보다 앞이다** — 이 조각의 요점이다(위 차례 주석). 먼저 서류함에
         *   넣고 그 다음에 알린다.
         *
         * ■ 🔴 **안 붙였으면 아무 일도 하지 않는다** — 선택 기능이다. 조건이 거짓이면
         *   DB 도 디스크도 보지 않는다.
         *
         * ■ 🔴 **폴더가 `created` · `found` 일 때만** 꽂는다(아래 공통 서류와 같은
         *   판정 하나를 쓴다). 꽂기 자체는 폴더를 만들지 않으므로, 폴더가 없으면
         *   `no-folder` 로 끝날 뿐이지만 — NAS 를 공연히 한 번 더 두드리지 않는다.
         *
         * ■ 🔴 **첨부 표에 행을 만들지 않는다.** 디스크에 남기지 않을 파일이라
         *   기록만 남기면 눌러도 안 열리는 줄이 된다(services/save-intake-repair-request.ts
         *   머리말). 감사 기록도 남기지 않는다 — 그 기록 함수는 첨부 id 를 요구한다.
         *
         * ■ 🔴 **실패해도 메일은 나간다.** try 가 따로이고, 이 토막은 메일을 모른다.
         *   공유폴더가 꺼져 있거나 느려도 사람은 메일로 의뢰서를 받아야 한다.
         */
        if (input.repairRequest && contactFolderReady) {
          try {
            const saved = await saveIntakeRepairRequest({
              intakeNumber: result.intakeNumber,
              fileName: input.repairRequest.fileName,
              bytes: input.repairRequest.bytes,
            });
            // 넣었다 · 같은 내용이 이미 있었다 · 꺼져 있다는 정상 상태다.
            if (saved.status !== "copied" && saved.status !== "unchanged" && saved.status !== "disabled") {
              // 🔴 파일 이름 · 폴더 이름 · 경로를 적지 않는다 — 상태 코드와 수리 건 id 뿐이다.
              console.error("접수 때 수리 의뢰서를 공유폴더에 넣지 못했습니다", {
                repairCaseId: result.id,
                status: saved.status,
              });
            }
          } catch (repairRequestError) {
            // 🔴 오류의 message 를 적지 않는다 — fs 오류에는 경로가 들어 있다.
            console.error("접수 때 수리 의뢰서에서 예상치 못한 오류", {
              repairCaseId: result.id,
              name: repairRequestError instanceof Error ? repairRequestError.name : typeof repairRequestError,
            });
          }
        }

        /*
         * ── 3) 접수 알림 메일 ── 🔴 **수리 의뢰서를 꽂은 뒤에** (2026-10-19 에 내려왔다)
         *
         * ■ 🔴 **첨부는 폴더 결과와 무관하다.** 공유폴더가 꺼져 있거나 실패해도 의뢰서는
         *   메일로 나간다 — 사람이 붙인 까닭의 절반이 「메일로 함께 보내기」다.
         *
         * ■ 🔴 **메일이 실패해도 이미 꽂은 파일을 지우지 않는다.** 지우면 다시 보낼
         *   길이 없다(공유폴더에 남아 있으면 사람이 그것을 첨부해 보낼 수 있다).
         *   이 토막에도, 꽂기 쪽 모듈에도 지우는 코드가 한 글자도 없다.
         *
         * ■ 의뢰서를 안 붙였으면 `undefined` 가 넘어가고, 메일은 **예전과 한 글자도
         *   다르지 않게** 서명 그림만 동봉해 나간다.
         *
         * ■ 실패해도 접수는 그대로다 — sendIntakeNotificationMail 은 던지지 않고 값을
         *   돌려주지만, 그 약속이 깨져도 접수가 뒤집히지 않게 한 번 더 감싼다.
         */
        try {
          const mail = await sendIntakeNotificationMail({
            repairCaseId: result.id,
            ...(input.repairRequest
              ? {
                  repairRequestAttachment: {
                    fileName: input.repairRequest.fileName,
                    // 🔴 확장자에서 서버가 고른 정본이다(브라우저가 보낸 값이 아니다).
                    mimeType: input.repairRequest.mimeType,
                    content: input.repairRequest.bytes,
                  },
                }
              : {}),
          });
          if (!mail.sent && mail.reason !== "DISABLED" && mail.reason !== "NO_RECIPIENTS") {
            // 껐거나 아무도 안 고른 것은 정상 상태라 시끄럽게 굴지 않는다.
            // 나머지는 아무도 모르게 지나가면 안 된다.
            console.error("접수 알림 메일을 보내지 못했습니다", {
              intakeNumber: result.intakeNumber,
              reason: mail.reason,
              detail: mail.detail,
            });
          }
        } catch (mailError) {
          console.error("접수 알림 메일에서 예상치 못한 오류", {
            intakeNumber: result.intakeNumber,
            message: mailError instanceof Error ? mailError.message : String(mailError),
          });
        }

        /*
         * ── 4) 종류 공통 서류 ── **독립된 try 로.** (2026-10-06)
         *
         * 🔴 **맨 뒤다** — 2026-10-19 에 메일이 위로 올라오면서 이 토막이 마지막이
         * 되었다(예전에도 메일보다 뒤였다). 서류가 여러 장이면 가장 오래 걸리는
         * 일이라, 사람에게 알리는 메일을 이것 뒤로 미루지 않는다.
         *
         * ■ 폴더 만들기와 서로 모른다
         *   try 가 따로다. 폴더 만들기가 실패해도 거기서 끝나야지 접수가 흔들리면 안
         *   되고, 서류 꽂기가 실패해도 폴더 만들기의 결과가 뒤집히면 안 된다(위 메일과
         *   폴더 만들기가 서로 모르는 것과 같은 규율이다).
         *
         * ■ 🔴 `created` 만이 아니라 `found` 에서도 꽂는다
         *   꽂기는 **덮어쓰지 않고, 내용이 같으면 아예 쓰지 않는다**(`unchanged`). 그래서
         *   여러 번 불려도 같은 서류가 쌓이지 않는다. 그리고 사람이 수기 인수번호로 폴더를
         *   미리 만들어 둔 건도 **그 종류의 서류를 받아야 한다** — 그 건만 서류가 없으면
         *   왜 없는지 아무도 설명할 수 없다.
         *
         * ■ 🔴 로그에 적는 것은 센 수와 상태 코드뿐이다
         *   파일 이름 · 폴더 이름 · 경로 · 오류 메시지를 적지 않는다(폴더 이름에는 고객사와
         *   S/N 이, fs 오류 메시지에는 경로가 들어 있다). 전부 잘 들어간 날은 조용하다 —
         *   꽂은 한 장마다 감사 기록이 남으므로 로그로 또 알릴 것이 없다.
         */
        if (contactFolderReady) {
          try {
            const common = await copyKindCommonFilesForIntake({
              repairCaseId: result.id,
              intakeNumber: result.intakeNumber,
              // 🔴 접수할 때 사람이 고른 종류다 — 제품 모델 마스터의 칸이 아니다.
              kind: workflowKindOf(validation.data.workflowType),
              actorUserId: actor.userId,
            });
            if (common.failed > 0 || common.auditFailed > 0) {
              console.error("접수 때 종류 공통 서류를 다 넣지 못했습니다", {
                repairCaseId: result.id,
                copied: common.copied,
                unchanged: common.unchanged,
                failed: common.failed,
                auditFailed: common.auditFailed,
                status: common.lastFailureStatus,
              });
            }
          } catch (commonError) {
            // 🔴 여기서도 오류의 message 를 적지 않는다.
            console.error("접수 때 종류 공통 서류에서 예상치 못한 오류", {
              repairCaseId: result.id,
              name: commonError instanceof Error ? commonError.name : typeof commonError,
            });
          }
        }
      }
    } else {
      await markIdempotencyKeyFailed(idempotencyKey);
    }
    return result;
  } catch (err) {
    await markIdempotencyKeyFailed(idempotencyKey);
    console.error("createRepairCaseWithIdempotency: unexpected DB error", {
      context: input.logContext,
      code: isPgErrorLike(err) ? err.code : undefined,
    });
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}
