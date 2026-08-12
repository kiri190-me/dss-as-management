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

export const PROCEDURE_EQUIPMENT_TYPE_CODES = ["RFG", "MB", "COMMON"] as const;
export type ProcedureEquipmentType = (typeof PROCEDURE_EQUIPMENT_TYPE_CODES)[number];
export const procedureEquipmentTypeLabels: Record<ProcedureEquipmentType, string> = {
  RFG: "RF Generator",
  MB: "Matching Box",
  COMMON: "공통",
};

/**
 * Phase 5C-5A — WHAT KIND of procedure a template is, independent of
 * `status` (WHERE it is in its own DRAFT/PUBLISHED/ARCHIVED lifecycle) and
 * entirely independent of the separate `workflow_templates`/`workflow_steps`
 * system (WHERE a repair_case is in the business process — untouched by
 * this enum). See the schema's own doc comment
 * (db/schema/procedure-templates.ts) for the full rationale per value.
 */
export const PROCEDURE_TEMPLATE_CATEGORY_CODES = ["FULL_SERVICE", "TECHNICAL_TASK", "REFERENCE"] as const;
export type ProcedureTemplateCategory = (typeof PROCEDURE_TEMPLATE_CATEGORY_CODES)[number];
export const procedureTemplateCategoryLabels: Record<ProcedureTemplateCategory, string> = {
  FULL_SERVICE: "종합 수리 절차",
  TECHNICAL_TASK: "기술 작업 절차",
  REFERENCE: "참조 자료",
};

export const PROCEDURE_REFERENCE_ITEM_TYPE_CODES = [
  "NAV_LINK",
  "EXTERNAL_FILE_LINK",
  "CROSS_REFERENCE_ID",
  "TEXT_NOTE",
] as const;
export type ProcedureReferenceItemType = (typeof PROCEDURE_REFERENCE_ITEM_TYPE_CODES)[number];
export const procedureReferenceItemTypeLabels: Record<ProcedureReferenceItemType, string> = {
  NAV_LINK: "시트 이동 링크",
  EXTERNAL_FILE_LINK: "외부 파일/폴더 링크",
  CROSS_REFERENCE_ID: "교차 참조 번호",
  TEXT_NOTE: "설명 텍스트",
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

/**
 * Phase 5C-5B-1 — the server-side allow-list for
 * createProcedureTemplateNode (manual TECHNICAL_TASK authoring v1).
 * Deliberately a narrower, separate constant from PROCEDURE_NODE_TYPE_CODES
 * rather than a change to the global enum: CHECKLIST/TROUBLESHOOTING are
 * container node types whose real content lives in
 * procedure_checklist_sections/procedure_troubleshooting_entries, and v1
 * manual authoring has no UI or mutation path for creating that child
 * content yet — allowing either type here would create a node with no way
 * to ever populate it. Existing imported FULL_SERVICE rows of either type
 * are completely unaffected; this only gates what a NEW manually-created
 * node may be.
 */
export const MANUAL_TECHNICAL_NODE_TYPE_CODES = [
  "START",
  "TASK",
  "INSPECTION",
  "DECISION",
  "CORRECTIVE_ACTION",
  "DOCUMENT_REFERENCE",
  "END",
] as const satisfies readonly ProcedureNodeType[];
export type ManualTechnicalNodeType = (typeof MANUAL_TECHNICAL_NODE_TYPE_CODES)[number];

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
  "ORPHAN_REFERENCE_ITEM",
  "UNRESOLVED_CROSS_SHEET_REFERENCE",
  // Phase 4A — structural-validator categories (see
  // procedure-graph-structural-validation.ts). These are only ever produced
  // live by the editor's Validate action / publish gate, never written to
  // procedure_template_validation_issues — added here only so the shared
  // label map stays a single source of truth for every issue-type string
  // this codebase can ever surface.
  "INVALID_START_STRUCTURE",
  "INVALID_END_STRUCTURE",
  "DUPLICATE_EDGE",
  "INVALID_SELF_EDGE",
  "CROSS_TEMPLATE_REFERENCE",
  "ORPHAN_NODE",
  "INVALID_LOOP_BACK_TARGET",
  "INVALID_BRANCH_TYPE_FOR_NODE",
  "REFERENCE_NODE_IN_EXECUTABLE_PATH",
  "INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE",
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
  ORPHAN_REFERENCE_ITEM: "미해결 교차 참조 번호",
  UNRESOLVED_CROSS_SHEET_REFERENCE: "시트 간 참조 대상 누락",
  INVALID_START_STRUCTURE: "시작 노드 구조 오류",
  INVALID_END_STRUCTURE: "종료 노드 구조 오류",
  DUPLICATE_EDGE: "중복 분기",
  INVALID_SELF_EDGE: "자기 자신으로의 분기",
  CROSS_TEMPLATE_REFERENCE: "다른 템플릿 참조",
  ORPHAN_NODE: "고립 노드",
  INVALID_LOOP_BACK_TARGET: "잘못된 재진행 대상",
  INVALID_BRANCH_TYPE_FOR_NODE: "노드 유형에 맞지 않는 분기 유형",
  REFERENCE_NODE_IN_EXECUTABLE_PATH: "실행 경로 내 참조 노드",
  INVALID_CHECKLIST_OR_TROUBLESHOOTING_REFERENCE: "체크리스트/고장 진단표 참조 오류",
};

export const PROCEDURE_VALIDATION_RESOLUTION_STATUS_CODES = [
  "UNRESOLVED",
  "RESOLVED_WITH_GRAPH_CHANGE",
  "RESOLVED_NO_CHANGE",
  "DEFERRED",
] as const;
export type ProcedureValidationResolutionStatus = (typeof PROCEDURE_VALIDATION_RESOLUTION_STATUS_CODES)[number];
export const procedureValidationResolutionStatusLabels: Record<ProcedureValidationResolutionStatus, string> = {
  UNRESOLVED: "미해결",
  RESOLVED_WITH_GRAPH_CHANGE: "해결됨 (그래프 변경)",
  RESOLVED_NO_CHANGE: "해결됨 (변경 없음)",
  DEFERRED: "보류",
};

export const PROCEDURE_VALIDATION_RESOLUTION_ACTION_TYPE_CODES = [
  "ADD_EDGE",
  "BIND_SOURCE",
  "BIND_TARGET",
  "RETARGET_EDGE",
  "RELABEL_EDGE",
  "MARK_NO_CHANGE",
  "DEFER",
  "REOPEN",
  "ROLLBACK_EDGE",
] as const;
export type ProcedureValidationResolutionActionType = (typeof PROCEDURE_VALIDATION_RESOLUTION_ACTION_TYPE_CODES)[number];
export const procedureValidationResolutionActionTypeLabels: Record<ProcedureValidationResolutionActionType, string> = {
  ADD_EDGE: "분기 추가",
  BIND_SOURCE: "시작 노드 연결",
  BIND_TARGET: "대상 노드 연결",
  RETARGET_EDGE: "분기 대상 변경",
  RELABEL_EDGE: "분기 라벨 변경",
  MARK_NO_CHANGE: "변경 없이 확인",
  DEFER: "보류",
  REOPEN: "재검토 재개",
  ROLLBACK_EDGE: "분기 되돌리기",
};

/** Confidence classification for the deterministic-known-issue matcher (src/lib/domain/procedure-validation-known-issues.ts) — display-only, never used to gate or auto-apply a resolution. */
export const PROCEDURE_VALIDATION_CONFIDENCE_CODES = ["HIGH", "MEDIUM", "LOW"] as const;
export type ProcedureValidationConfidence = (typeof PROCEDURE_VALIDATION_CONFIDENCE_CODES)[number];
export const procedureValidationConfidenceLabels: Record<ProcedureValidationConfidence, string> = {
  HIGH: "높음",
  MEDIUM: "중간",
  LOW: "낮음",
};
