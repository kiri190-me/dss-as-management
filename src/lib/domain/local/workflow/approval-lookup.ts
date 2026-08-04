import { getApprovalStoreSnapshot } from "../approval/approval-storage";
import type { ApprovalType, LocalApprovalRecord } from "../approval/approval-types";
import { findRecordFor } from "../approval/transitions";
import type { ApprovalTypeForTransition } from "./workflow-types";

/**
 * Stage D-1 승인 저장소를 읽기 전용으로만 사용한다 — 이 파일의 어떤 함수도
 * approval/actions.ts를 호출하거나 승인 레코드를 생성·수정·삭제하지 않는다.
 */

export type ApprovalRequirementResult =
  | { satisfied: true; recordId: string }
  | { satisfied: false; reason: string };

/**
 * 쓰기 시점(actions.ts)에 사용한다: 최신 승인 저장소를 다시 읽고, 손상 여부를
 * 확인하고, repairCaseId+approvalType이 정확히 일치하는 레코드를 찾아
 * status === APPROVED인지 검증한 뒤에만 그 레코드의 실제 id를 반환한다.
 * 문자열 접두어만으로 판단하지 않는다.
 */
export function resolveVerifiedApprovalRecordId(
  repairCaseId: string,
  approvalType: ApprovalTypeForTransition
): ApprovalRequirementResult {
  const { records, isMalformed } = getApprovalStoreSnapshot();
  if (isMalformed) {
    return { satisfied: false, reason: "승인 데이터를 확인할 수 없어 이 작업을 진행할 수 없습니다." };
  }

  const record = findRecordFor(records, repairCaseId, approvalType as ApprovalType);
  if (!record || record.repairCaseId !== repairCaseId || record.approvalType !== approvalType) {
    return { satisfied: false, reason: "관련 승인 기록을 확인할 수 없습니다." };
  }
  if (record.status !== "APPROVED") {
    return { satisfied: false, reason: "관련 승인이 아직 완료되지 않았습니다." };
  }

  return { satisfied: true, recordId: record.id };
}

/**
 * 표시 시점(타임라인)에 사용한다: 이벤트에 저장된 relatedApprovalRecordId를
 * 정규화된 승인 레코드 목록과 대조해, repairCaseId와 승인 유형이 이벤트와
 * 정확히 일치하는 경우에만 그 레코드를 돌려준다. 접두어만 보고 신뢰하지
 * 않는다 — 매번 실제 레코드 목록에서 재확인한다.
 */
export function resolveDisplayApprovalRecord(
  relatedApprovalRecordId: string | null,
  repairCaseId: string,
  requiredApprovalType: ApprovalTypeForTransition,
  records: readonly LocalApprovalRecord[]
): LocalApprovalRecord | null {
  if (!relatedApprovalRecordId) return null;
  const record = records.find((r) => r.id === relatedApprovalRecordId);
  if (!record) return null;
  if (record.repairCaseId !== repairCaseId) return null;
  if (record.approvalType !== requiredApprovalType) return null;
  return record;
}
