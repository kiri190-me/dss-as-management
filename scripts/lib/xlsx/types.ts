import type {
  ProcedureBranchType,
  ProcedureEquipmentType,
  ProcedureNodeType,
  ProcedureReferenceItemType,
  ProcedureTemplateCategory,
  ProcedureValidationIssueType,
  ProcedureValidationSeverity,
} from "@/lib/domain/procedure-template-types";

/**
 * Intermediate representation the three extraction strategies
 * (extract-shape-graph.ts, extract-checklist-form.ts,
 * extract-troubleshooting-matrix.ts) all produce, independent of the DB
 * layer — import-procedure-templates.ts is the only place that turns this
 * into actual INSERTs, so the extractors stay unit-testable without a
 * database.
 */

export type ExtractedNode = {
  nodeCode: string;
  nodeType: ProcedureNodeType;
  title: string;
  description?: string | null;
  objective?: string | null;
  preparation?: string | null;
  toolsAndEquipment?: string | null;
  safetyCaution?: string | null;
  instructions?: string | null;
  expectedNormalResult?: string | null;
  ngSymptoms?: string | null;
  recommendedCorrectiveAction?: string | null;
  acceptanceCriteria?: string | null;
  positionX: number;
  positionY: number;
  sortOrder: number;
  sourceWorksheet: string;
  sourceShapeId?: string | null;
  sourceCellRange?: string | null;
};

export type ExtractedEdge = {
  fromNodeCode: string;
  toNodeCode: string;
  branchType: ProcedureBranchType;
  branchLabel?: string | null;
  sortOrder: number;
  sourceConnectorId?: string | null;
};

export type ExtractedChecklistItem = {
  itemCode: string;
  title: string;
  instructions?: string | null;
  measurementType?: string | null;
  measurementUnit?: string | null;
  minValue?: string | null;
  maxValue?: string | null;
  expectedText?: string | null;
  acceptanceRule?: string | null;
  required: boolean;
  sortOrder: number;
  sourceCellRange?: string | null;
};

export type ExtractedChecklistSection = {
  nodeCode: string; // the CHECKLIST-type node this section belongs to
  sectionCode: string;
  title: string;
  sortOrder: number;
  sourceWorksheet: string;
  sourceCellRange?: string | null;
  items: ExtractedChecklistItem[];
};

export type ExtractedTroubleshootingEntry = {
  nodeCode: string; // the TROUBLESHOOTING-type node this entry belongs to
  symptom: string;
  inspectionAction?: string | null;
  normalNextAction?: string | null;
  ngAction?: string | null;
  retryInstruction?: string | null;
  sortOrder: number;
  sourceCellRange?: string | null;
};

/**
 * A geometrically-ranked candidate shape for an unresolved connector/node
 * gap (Phase 3A) — never a chosen answer, just a distance-sorted option for
 * a human reviewer. `distance` uses the same col/row Euclidean metric as
 * the label-matching heuristic in extract-shape-graph.ts.
 */
export type ExtractedValidationIssueCandidate = {
  shapeId: string;
  text: string;
  distance: number;
};

/**
 * Structured (never binary) snapshot of the workbook geometry behind a
 * DANGLING_CONNECTOR / MISSING_SOURCE_NODE / MISSING_OUTGOING_PATH issue,
 * computed once at import time (Phase 3A) so the validation-resolution UI
 * can render a "raw connector inspector" and ranked candidates without the
 * running server ever needing filesystem access to the source .xlsx.
 */
export type ExtractedValidationIssueRawEvidence = {
  connectorId?: string | null;
  stCxnId?: string | null;
  endCxnId?: string | null;
  from?: { col: number; row: number } | null;
  to?: { col: number; row: number } | null;
  headType?: string | null;
  tailType?: string | null;
  /** the decision shape itself, for MISSING_OUTGOING_PATH */
  shapeId?: string | null;
  /** candidates near the connector's 'from' anchor — present only when stCxnId is missing */
  fromCandidates?: ExtractedValidationIssueCandidate[];
  /** candidates near the connector's 'to' anchor — present only when endCxnId is missing */
  toCandidates?: ExtractedValidationIssueCandidate[];
  /** candidates near a decision shape's own position — MISSING_OUTGOING_PATH only */
  candidates?: ExtractedValidationIssueCandidate[];
};

export type ExtractedValidationIssue = {
  severity: ProcedureValidationSeverity;
  issueType: ProcedureValidationIssueType;
  message: string;
  sourceWorksheet?: string | null;
  sourceReference?: string | null;
  rawEvidence?: ExtractedValidationIssueRawEvidence | null;
};

/**
 * A row of a reference-only template's content (Main page / QC — see
 * extract-reference-index.ts). These templates have zero
 * ExtractedNode/ExtractedEdge rows by design; this is their entire content.
 */
export type ExtractedReferenceItem = {
  itemType: ProcedureReferenceItemType;
  label: string;
  sourceWorksheet: string;
  sourceCellRange?: string | null;
  hyperlinkTarget?: string | null;
  crossReferenceNumber?: string | null;
  sortOrder: number;
};

export type ExtractedTemplate = {
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  // Phase 5C-5A — explicit per-builder value (see combineShapeGraphSheets
  // and buildReferenceOnlyTemplate in scripts/import-procedure-templates.ts),
  // never inferred here. See procedure_templates.category.
  category: ProcedureTemplateCategory;
  description: string;
  sourceWorksheets: string[];
  // True only for the two navigational/reference-index templates (Main
  // page, QC) — see procedure_templates.is_reference_only.
  isReferenceOnly: boolean;
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
  checklistSections: ExtractedChecklistSection[];
  troubleshootingEntries: ExtractedTroubleshootingEntry[];
  referenceItems: ExtractedReferenceItem[];
  issues: ExtractedValidationIssue[];
};
