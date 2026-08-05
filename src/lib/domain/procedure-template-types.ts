/**
 * Client-safe mirror of the procedure-template Postgres enums
 * (src/lib/db/schema/procedure-template*.ts) — same convention as
 * ROLE_CODES/WORKFLOW_TYPE_CODES in domain/types.ts: plain TS constants so
 * client components and the importer can reference these values without
 * pulling in the "server-only" schema modules. Values must stay in sync
 * with the pgEnum definitions; nothing here is a separate source of truth.
 */

export const PROCEDURE_TEMPLATE_STATUS_CODES = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
] as const;
export type ProcedureTemplateStatus = (typeof PROCEDURE_TEMPLATE_STATUS_CODES)[number];
export const procedureTemplateStatusLabels: Record<ProcedureTemplateStatus, string> = {
  DRAFT: "초안",
  PUBLISHED: "게시됨",
  ARCHIVED: "보관됨",
};

export const PROCEDURE_TEMPLATE_SOURCE_TYPE_CODES = ["MANUAL", "EXCEL_IMPORT"] as const;
export type ProcedureTemplateSourceType = (typeof PROCEDURE_TEMPLATE_SOURCE_TYPE_CODES)[number];
export const procedureTemplateSourceTypeLabels: Record<ProcedureTemplateSourceType, string> = {
  MANUAL: "수동 작성",
  EXCEL_IMPORT: "Excel 가져오기",
};

export const PROCEDURE_EQUIPMENT_TYPE_CODES = ["RFG", "MB"] as const;
export type ProcedureEquipmentType = (typeof PROCEDURE_EQUIPMENT_TYPE_CODES)[number];
export const procedureEquipmentTypeLabels: Record<ProcedureEquipmentType, string> = {
  RFG: "RF Generator",
  MB: "Matching Box",
};

export const PROCEDURE_NODE_TYPE_CODES = [
  "START",
  "TASK",
  "INSPECTION",
  "DECISION",
  "CORRECTIVE_ACTION",
  "CHECKLIST",
  "TROUBLESHOOTING",
  "DOCUMENT_REFERENCE",
  "END",
] as const;
export type ProcedureNodeType = (typeof PROCEDURE_NODE_TYPE_CODES)[number];
export const procedureNodeTypeLabels: Record<ProcedureNodeType, string> = {
  START: "시작",
  TASK: "작업",
  INSPECTION: "검사",
  DECISION: "판단",
  CORRECTIVE_ACTION: "조치",
  CHECKLIST: "체크리스트",
  TROUBLESHOOTING: "고장 진단표",
  DOCUMENT_REFERENCE: "문서 참조",
  END: "종료",
};

export const PROCEDURE_BRANCH_TYPE_CODES = [
  "DEFAULT",
  "NORMAL",
  "NG",
  "YES",
  "NO",
  "RETRY",
  "LOOP_BACK",
  "CUSTOM",
] as const;
export type ProcedureBranchType = (typeof PROCEDURE_BRANCH_TYPE_CODES)[number];
export const procedureBranchTypeLabels: Record<ProcedureBranchType, string> = {
  DEFAULT: "기본",
  NORMAL: "정상",
  NG: "NG",
  YES: "YES",
  NO: "NO",
  RETRY: "재측정",
  LOOP_BACK: "재진행",
  CUSTOM: "사용자 정의",
};

export const PROCEDURE_VALIDATION_SEVERITY_CODES = ["INFO", "WARNING", "ERROR"] as const;
export type ProcedureValidationSeverity = (typeof PROCEDURE_VALIDATION_SEVERITY_CODES)[number];
export const procedureValidationSeverityLabels: Record<ProcedureValidationSeverity, string> = {
  INFO: "정보",
  WARNING: "경고",
  ERROR: "오류",
};

/**
 * Non-exhaustive by design (see procedure-template-validation-issues.ts
 * schema comment) — this is the closed set the importer currently emits;
 * procedure_template_validation_issues.issue_type stays a free-text column
 * so a later phase can introduce a new category without a migration.
 */
export const PROCEDURE_VALIDATION_ISSUE_TYPES = [
  "DANGLING_CONNECTOR",
  "MISSING_SOURCE_NODE",
  "AMBIGUOUS_LABEL_EDGE_MATCH",
  "UNREACHABLE_NODE",
  "MISSING_OUTGOING_PATH",
  "FORMULA_ERROR",
  "IMPLICIT_CONVERGENCE",
  "MISSING_WORKSHEET",
  "UNSUPPORTED_OBJECT",
  "DUPLICATE_NODE_CODE",
] as const;
export type ProcedureValidationIssueType = (typeof PROCEDURE_VALIDATION_ISSUE_TYPES)[number];
export const procedureValidationIssueTypeLabels: Record<ProcedureValidationIssueType, string> = {
  DANGLING_CONNECTOR: "연결선 참조 오류",
  MISSING_SOURCE_NODE: "원본 도형 누락",
  AMBIGUOUS_LABEL_EDGE_MATCH: "분기 라벨 매칭 모호",
  UNREACHABLE_NODE: "도달 불가 노드",
  MISSING_OUTGOING_PATH: "출력 경로 누락",
  FORMULA_ERROR: "수식 오류 (#VALUE!)",
  IMPLICIT_CONVERGENCE: "암묵적 합류",
  MISSING_WORKSHEET: "워크시트 누락",
  UNSUPPORTED_OBJECT: "지원되지 않는 개체",
  DUPLICATE_NODE_CODE: "노드 코드 중복",
};
