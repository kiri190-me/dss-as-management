import type { LoadedSheet } from "./workbook-loader";
import { extractSheetGraph, matchStageRestartReference } from "./extract-shape-graph";
import type { ExtractedTemplate, ExtractedValidationIssue } from "./types";
import type { ProcedureEquipmentType } from "@/lib/domain/procedure-template-types";

/**
 * Combines multiple per-sheet shape-graph extractions into one
 * procedure_template. This is what lets a cross-stage LOOP_BACK edge be a
 * real, resolvable edge instead of a dead-end text reference (Phase 1
 * report §2/§9): each included sheet's nodes/edges/issues are extracted
 * independently first (node_type classification only ever looks at a
 * node's own sheet, per extract-shape-graph.ts), then this pass scans
 * every node's text for the verified stage-restart wording and, if the
 * referenced stage's sheet is also included in this same template, adds a
 * real LOOP_BACK edge to that sheet's START node.
 */
export function combineShapeGraphSheets(
  sheets: LoadedSheet[],
  opts: { code: string; name: string; equipmentType: ProcedureEquipmentType; description: string }
): ExtractedTemplate {
  const template: ExtractedTemplate = {
    code: opts.code,
    name: opts.name,
    equipmentType: opts.equipmentType,
    description: opts.description,
    sourceWorksheets: sheets.map((s) => s.name),
    isReferenceOnly: false,
    nodes: [],
    edges: [],
    checklistSections: [],
    troubleshootingEntries: [],
    referenceItems: [],
    issues: [],
  };

  const startNodeCodeBySheetName = new Map<string, string | null>();
  const seenNodeCodes = new Set<string>();
  let globalNodeSort = 0;
  let globalEdgeSort = 0;

  for (const sheet of sheets) {
    const result = extractSheetGraph(sheet);
    startNodeCodeBySheetName.set(sheet.name, result.startNodeCode);

    for (const node of result.nodes) {
      if (seenNodeCodes.has(node.nodeCode)) {
        template.issues.push({
          severity: "ERROR",
          issueType: "DUPLICATE_NODE_CODE",
          message: `노드 코드 "${node.nodeCode}"가 이미 사용되었습니다 — 이 노드는 가져오지 않았습니다.`,
          sourceWorksheet: sheet.name,
          sourceReference: `shape#${node.sourceShapeId}`,
        });
        continue;
      }
      seenNodeCodes.add(node.nodeCode);
      template.nodes.push({ ...node, sortOrder: globalNodeSort++ });
    }

    for (const edge of result.edges) {
      template.edges.push({ ...edge, sortOrder: globalEdgeSort++ });
    }
    template.issues.push(...result.issues);
  }

  // ---- cross-stage loop-back wiring ----
  const includedSheetsByStageNumber = new Map<string, LoadedSheet>();
  for (const sheet of sheets) {
    const m = sheet.name.match(/\((\d+)\)/);
    if (m) includedSheetsByStageNumber.set(m[1], sheet);
  }

  for (const node of [...template.nodes]) {
    const ref = matchStageRestartReference(node.description ?? node.title);
    if (!ref) continue;

    const targetSheet = includedSheetsByStageNumber.get(ref.stageNumber);
    if (!targetSheet) {
      template.issues.push({
        severity: "INFO",
        issueType: "MISSING_SOURCE_NODE",
        message: `노드 "${node.title}"가 (${ref.stageNumber})단계로의 재진행을 참조하지만, 해당 단계 시트는 이번 가져오기 범위에 포함되지 않았습니다.`,
        sourceWorksheet: node.sourceWorksheet,
        sourceReference: `shape#${node.sourceShapeId}`,
      });
      continue;
    }
    const targetStartCode = startNodeCodeBySheetName.get(targetSheet.name);
    if (!targetStartCode) {
      template.issues.push({
        severity: "WARNING",
        issueType: "MISSING_SOURCE_NODE",
        message: `노드 "${node.title}"가 (${ref.stageNumber})단계로의 재진행을 참조하지만, 해당 시트에서 시작 노드를 확인하지 못했습니다.`,
        sourceWorksheet: node.sourceWorksheet,
        sourceReference: `shape#${node.sourceShapeId}`,
      });
      continue;
    }

    template.edges.push({
      fromNodeCode: node.nodeCode,
      toNodeCode: targetStartCode,
      branchType: "LOOP_BACK",
      branchLabel: `${node.title}`,
      sortOrder: globalEdgeSort++,
      sourceConnectorId: null,
    });
  }

  return template;
}

export type { ExtractedValidationIssue };
