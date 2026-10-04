"use server";

import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { setWeeklyReportStatus } from "@/lib/db/mutations/weekly-report-status";
import { isWeeklyReportStatus } from "@/lib/domain/weekly-report-status-step";
import {
  isValidExpectedVersion,
  isValidRepairCaseId,
  type TransitionActionResult,
} from "@/lib/validation/workflow-transition-input";

export type SetWeeklyReportStatusActionInput = {
  repairCaseId: string;
  expectedVersion: number;
  /** 주간보고 분류 6칸 중 하나. **단계 키가 아니다.** */
  status: string;
};

/**
 * Server Action: 주간보고 상세표의 `현 상태` 칸 직접 변경(2026-10-04 사용자 요청).
 *
 * set-workflow-step.ts 와 **같은 결**로 짰고, 합치지 않은 이유도 그 파일과 같다 —
 * 들어오는 값의 종류가 다르다. 저쪽은 단계 키를 받고 이쪽은 **분류**를 받는다.
 * 한 입구로 합치면 "단계 키 아니면 분류"라는 느슨한 입력이 생기고, 그 느슨함이
 * 곧 우회로가 된다. 그래서 액션 코드와 마찬가지로 **입구부터 분리**한다.
 *
 * 이 파일이 하는 일은 다른 Server Action 들과 같은 층위의 일뿐이다 — 모드 확인 +
 * 세션 + 입력 형식 검증 + 오류 은닉. 실제 판정(권한·자격·보류·잠금·버전 충돌)은
 * 전부 db/mutations/weekly-report-status.ts → transitionWorkflow 가 DB 상태를
 * 다시 읽어 수행한다. 화면의 canEditStatus 는 그리기 위한 값일 뿐이고, 이 경로가
 * 진짜 관문이다.
 */
export async function setWeeklyReportStatusAction(
  input: SetWeeklyReportStatusActionInput
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
  // 받은 값이 실제로 6칸 중 하나인가. 목록은 도메인의 WEEKLY_REPORT_STATUSES
  // 하나뿐이다 — 여기 베껴 적으면 칸이 바뀔 때 한쪽만 따라간다.
  if (!isWeeklyReportStatus(input.status)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "변경할 상태를 확인할 수 없습니다." };
  }

  try {
    return await setWeeklyReportStatus(
      input.repairCaseId,
      input.expectedVersion,
      input.status,
      session.userId
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("setWeeklyReportStatusAction: unexpected DB error", { code });
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
