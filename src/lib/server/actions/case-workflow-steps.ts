"use server";

import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { addCaseWorkflowStep } from "@/lib/db/mutations/case-workflow-steps";
import { STEP_CATEGORY_CODES, type StepCategory } from "@/lib/domain/local/workflow/step-category";
import { REPAIR_STATUS_CODES, type RepairStatus } from "@/lib/domain/types";
import { isValidExpectedVersion, isValidRepairCaseId } from "@/lib/validation/workflow-transition-input";

export type AddCaseWorkflowStepActionInput = {
  repairCaseId: string;
  expectedVersion: number;
  label: string;
  status: string;
  category: string | null;
};

export type AddCaseWorkflowStepActionResult =
  | { ok: true; message: string; createdCaseVersion: boolean }
  | { ok: false; message: string };

const MAX_LABEL_LENGTH = 60;

/**
 * Server Action: 실행 가능한 작업 화면의 "이 건에만 단계 추가".
 *
 * 다른 Server Action과 같은 층위의 일만 한다 — 모드 확인, 세션, 입력 형식
 * 검증, 오류 은닉. 권한(담당 엔지니어/관리자), 잠금, 낙관적 잠금, 전이 재배선은
 * 전부 addCaseWorkflowStep()이 DB를 다시 읽어 판정한다.
 *
 * 결과를 성공/실패 두 갈래로만 좁혀 돌려주는 이유: 호출하는 화면이 하는 일이
 * 메시지 표시와 새로고침뿐이라, 실패 코드를 그대로 노출하면 화면이 서버
 * 내부 사정을 알아야 하는 대신 얻는 것이 없다.
 */
export async function addCaseWorkflowStepAction(
  input: AddCaseWorkflowStepActionInput
): Promise<AddCaseWorkflowStepActionResult> {
  if (getRepairCaseWriteSource() !== "database" || getRepairCaseReadSource() !== "database") {
    return { ok: false, message: "데이터베이스 저장 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) return { ok: false, message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, message: "계정이 아직 승인되지 않았습니다." };
  }

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return { ok: false, message: "버전 정보를 확인할 수 없습니다." };
  }

  // 단계 키는 받지 않는다 — mutation이 case_step_N으로 만든다.
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label || label.length > MAX_LABEL_LENGTH) {
    return { ok: false, message: `단계 이름은 1~${MAX_LABEL_LENGTH}자로 입력해 주세요.` };
  }
  if (!(REPAIR_STATUS_CODES as readonly string[]).includes(input.status)) {
    return { ok: false, message: "진행 상태를 확인할 수 없습니다." };
  }
  if (input.category !== null && !(STEP_CATEGORY_CODES as readonly string[]).includes(input.category)) {
    return { ok: false, message: "담당 구분을 확인할 수 없습니다." };
  }

  try {
    const result = await addCaseWorkflowStep({
      repairCaseId: input.repairCaseId,
      expectedVersion: input.expectedVersion,
      label,
      status: input.status as RepairStatus,
      category: input.category as StepCategory | null,
      actorUserId: session.userId,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      createdCaseVersion: result.createdCaseVersion,
      message: result.createdCaseVersion
        ? `"${label}" 단계를 현재 단계 바로 다음에 추가했습니다. 이 접수 건 전용 워크플로가 만들어졌습니다.`
        : `"${label}" 단계를 현재 단계 바로 다음에 추가했습니다.`,
    };
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("addCaseWorkflowStepAction: unexpected DB error", { code });
    return { ok: false, message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
