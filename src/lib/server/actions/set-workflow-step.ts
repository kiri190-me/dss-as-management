"use server";

import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { transitionWorkflow } from "@/lib/db/mutations/workflow-transitions";
import {
  isValidExpectedVersion,
  isValidRepairCaseId,
  validateReasonFormat,
  type TransitionActionResult,
} from "@/lib/validation/workflow-transition-input";

export type SetWorkflowStepActionInput = {
  repairCaseId: string;
  expectedVersion: number;
  toStepKey: string;
  reason: string;
};

/**
 * Server Action: 작업내용 탭의 "현재 단계 직접 변경"(STEP_SET_MANUALLY).
 *
 * transition-workflow.ts와 나란히 두되 합치지 않은 이유가 있다. 그쪽의
 * isValidWorkflowActionCode는 정규 액션 5종만 통과시키는 검사이고, 그 5종
 * 목록은 클라이언트가 보낼 수 있는 값의 전부여야 한다. 여기에
 * "STEP_SET_MANUALLY"를 끼워 넣으면 기존 전이 엔드포인트로도 규칙 우회
 * 요청을 보낼 수 있게 된다 — 우회 경로는 입구부터 분리해 두는 편이 낫다.
 * 그래서 액션 코드는 클라이언트 입력이 아니라 이 파일이 상수로 고정한다.
 *
 * 권한/자격/단계 유효성은 여기서 판단하지 않는다. 이 파일은 다른 Server
 * Action들과 같은 층위의 일(모드 확인 + 세션 + 입력 형식 검증 + 오류 은닉)만
 * 하고, 실제 판정은 전부 transitionWorkflow()가 DB 상태를 다시 읽어 수행한다.
 */
export async function setWorkflowStepAction(
  input: SetWorkflowStepActionInput
): Promise<TransitionActionResult> {
  if (getRepairCaseWriteSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  if (getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "서버 설정 오류로 처리할 수 없습니다. 관리자에게 문의해 주세요.",
    };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "버전 정보를 확인할 수 없습니다." };
  }
  // 형식만 본다 — 이 키가 실제로 선택 가능한 단계인지는 mutation이
  // manual-step-options.ts로 다시 판정한다(UI 목록과 같은 규칙).
  if (typeof input.toStepKey !== "string" || input.toStepKey.trim() === "") {
    return { ok: false, code: "VALIDATION_ERROR", message: "변경할 단계를 선택해 주세요." };
  }

  const reasonValidation = validateReasonFormat(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }
  // 사유 필수는 mutation에서도 다시 검사한다. 여기서 먼저 걸러 주는 것은
  // 왕복 한 번을 아끼기 위한 것일 뿐, 이 검사가 없어도 서버는 안전하다.
  if (!reasonValidation.reason) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "단계를 직접 변경하려면 사유를 입력해야 합니다.",
    };
  }

  try {
    return await transitionWorkflow(
      input.repairCaseId,
      input.expectedVersion,
      "STEP_SET_MANUALLY",
      session.userId,
      reasonValidation.reason,
      input.toStepKey.trim()
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("setWorkflowStepAction: unexpected DB error", { code });
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
