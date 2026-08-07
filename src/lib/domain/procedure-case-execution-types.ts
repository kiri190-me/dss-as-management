/**
 * Client-safe mirror of the procedure-case-execution Postgres enums
 * (src/lib/db/schema/procedure-case-execution.ts) — same convention as
 * PROCEDURE_NODE_TYPE_CODES in procedure-template-types.ts. Deliberately
 * trimmed to exactly what Phase 5A implements (see the Phase 5A plan §2):
 * no FAILED/IMPOSSIBLE/CANCELLED node status, no EXECUTION_COMPLETED/
 * EXECUTION_ABANDONED/NODE_FAILED/NODE_IMPOSSIBLE/NODE_CANCELLED action
 * type. Those arrive in a later migration once their exact behavior is
 * approved — do not add them speculatively.
 */

export const PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "BLOCKED",
] as const;
export type ProcedureCaseExecutionNodeStatus = (typeof PROCEDURE_CASE_EXECUTION_NODE_STATUS_CODES)[number];
export const procedureCaseExecutionNodeStatusLabels: Record<ProcedureCaseExecutionNodeStatus, string> = {
  PENDING: "대기",
  IN_PROGRESS: "진행 중",
  COMPLETED: "완료",
  SKIPPED: "건너뜀",
  BLOCKED: "차단됨",
};

/**
 * NODE_MEMO_UPDATED is the one addition beyond the plan's originally-listed
 * action set — a direct, non-speculative consequence of the work-memo
 * audit requirement (plan §9), not a hypothetical future feature.
 */
export const PROCEDURE_CASE_EXECUTION_ACTION_TYPE_CODES = [
  "EXECUTION_STARTED",
  "NODE_ADDED",
  "NODE_STARTED",
  "NODE_COMPLETED",
  "NODE_SKIPPED",
  "NODE_BLOCKED",
  "NODE_REOPENED",
  "NODE_MEMO_UPDATED",
] as const;
export type ProcedureCaseExecutionActionType = (typeof PROCEDURE_CASE_EXECUTION_ACTION_TYPE_CODES)[number];
export const procedureCaseExecutionActionTypeLabels: Record<ProcedureCaseExecutionActionType, string> = {
  EXECUTION_STARTED: "실행 시작",
  NODE_ADDED: "추가 작업 등록",
  NODE_STARTED: "작업 시작",
  NODE_COMPLETED: "작업 완료",
  NODE_SKIPPED: "작업 건너뜀",
  NODE_BLOCKED: "작업 차단",
  NODE_REOPENED: "작업 재개(되돌림)",
  NODE_MEMO_UPDATED: "작업 메모 수정",
};
