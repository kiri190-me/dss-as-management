/**
 * Client-safe mirror of the repair_case_flowchart_* Postgres enums
 * (src/lib/db/schema/repair-case-flowchart-*.ts) — same convention as
 * procedure-template-types.ts: plain TS constants so client components and
 * validation modules can reference these values without pulling in the
 * "server-only" schema modules. Values must stay in sync with the pgEnum
 * definitions; nothing here is a separate source of truth.
 *
 * Independently owned from procedure-template-types.ts's equivalents —
 * never imported from there and never re-exported into it, per the 5C-6A/
 * 5C-6C approved design (case-flowchart data stays fully decoupled from
 * procedure-template data, including at the type-mirror level).
 */

export const REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES = [
  "START",
  "TASK",
  "INSPECTION",
  "DECISION",
  "CORRECTIVE_ACTION",
  "DOCUMENT_REFERENCE",
  "END",
] as const;
export type RepairCaseFlowchartNodeType = (typeof REPAIR_CASE_FLOWCHART_NODE_TYPE_CODES)[number];
export const repairCaseFlowchartNodeTypeLabels: Record<RepairCaseFlowchartNodeType, string> = {
  START: "시작",
  TASK: "작업",
  INSPECTION: "검사",
  DECISION: "판단",
  CORRECTIVE_ACTION: "조치",
  DOCUMENT_REFERENCE: "문서 참조",
  END: "종료",
};

/** Full parity with procedure_template_branch_type's value set (5C-6 design approval — RETRY/LOOP_BACK are valid real-world diagnostic-flow concepts, not Excel-import-only artifacts). */
export const REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES = [
  "DEFAULT",
  "NORMAL",
  "NG",
  "YES",
  "NO",
  "RETRY",
  "LOOP_BACK",
  "CUSTOM",
] as const;
export type RepairCaseFlowchartBranchType = (typeof REPAIR_CASE_FLOWCHART_BRANCH_TYPE_CODES)[number];
export const repairCaseFlowchartBranchTypeLabels: Record<RepairCaseFlowchartBranchType, string> = {
  DEFAULT: "기본",
  NORMAL: "정상",
  NG: "NG",
  YES: "예",
  NO: "아니오",
  RETRY: "재측정",
  LOOP_BACK: "이전 단계로",
  CUSTOM: "사용자 정의",
};
