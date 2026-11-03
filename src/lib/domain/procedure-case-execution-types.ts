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

import type { ProcedureNodeType } from "./procedure-template-types";

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
 * 「추가 작업 등록」 창에서 **고를 수 있는 노드 갈래**(2026-11-03, 조각 13) —
 * procedure_case_execution_nodes.extra_task_node_type 에 들어갈 수 있는 값이다.
 *
 * 🔴 **새 enum 이 아니다.** DB 칸은 절차 노드가 쓰는 그 enum
 * (procedure_template_node_type)을 그대로 재사용하고, 이 목록은 그 가운데
 * **실행 중에 더할 수 있는 것만** 추린 허용 목록이다. 절차 편집기의
 * MANUAL_TECHNICAL_NODE_TYPE_CODES 가 같은 까닭으로 같은 모양을 하고 있다.
 *
 * 왜 이 넷인가 — 뺀 다섯에 각각 까닭이 있다:
 *  - START … 시스템이 자동으로 관리하는 표식이다. 실행을 만들 때 바로 완료로
 *    차고, 사람이 시작·완료·건너뛸 수 없다(assertNotSystemEntryNode). 더할 수
 *    있게 두면 **아무 단추도 안 듣는 작업**이 목록에 선다.
 *  - END … 절차의 **끝점**이라, 하나 더하는 순간 진행률의 분모가 바뀐다
 *    (collectEndNodeIds → computeExecutionProgress 의 뒤 토막). 「이 건에서 할 일
 *    하나를 더한다」와 「이 절차가 어디서 끝나는지를 다시 정한다」는 다른 일이고,
 *    뒤쪽은 이 창이 하기로 한 일이 아니다.
 *  - DOCUMENT_REFERENCE … 실행 행이 **애초에 안 생기는** 갈래다
 *    (isExecutableNodeType 이 유일하게 뺀 값). 실행 행을 가진 참고 문서는 그
 *    자체로 앞뒤가 안 맞는다.
 *  - CHECKLIST · TROUBLESHOOTING … 속 내용이 딴 표에 사는 **그릇**인데
 *    (procedure_checklist_* · procedure_troubleshooting_*), 그 속을 채울 길이
 *    아직 어디에도 없다. 더해 봐야 영영 빈 그릇이다 — 절차 편집기가 같은
 *    까닭으로 둘을 뺀다.
 */
export const EXTRA_TASK_NODE_TYPE_CODES = [
  "TASK",
  "INSPECTION",
  "DECISION",
  "CORRECTIVE_ACTION",
] as const satisfies readonly ProcedureNodeType[];
export type ExtraTaskNodeType = (typeof EXTRA_TASK_NODE_TYPE_CODES)[number];

/** 글자 하나가 허용 목록 안에 있는가 — 서버 액션이 화면에서 온 값을 좁히는 데 쓴다. */
export function isExtraTaskNodeType(value: unknown): value is ExtraTaskNodeType {
  return typeof value === "string" && (EXTRA_TASK_NODE_TYPE_CODES as readonly string[]).includes(value);
}

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
