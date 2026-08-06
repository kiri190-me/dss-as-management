import type { LoadedSheet } from "./workbook-loader";
import type { DrawingConnector, DrawingShape, DrawingPos } from "./ooxml-parser";
import { classifyBranchLabel, matchStageRestartReference } from "./branch-classification";
import { classifyNodeType } from "./node-classification";
import type { ExtractedEdge, ExtractedNode, ExtractedValidationIssue, ExtractedValidationIssueCandidate } from "./types";
import type { ProcedureBranchType } from "@/lib/domain/procedure-template-types";

const NODE_SPACING_X = 220;
const NODE_SPACING_Y = 130;
const LABEL_MAX_LEN = 12;
const LABEL_MATCH_THRESHOLD = 4;
const LABEL_CONFIDENT_THRESHOLD = 2.5;
const MAX_EVIDENCE_CANDIDATES = 8;
/** Exact-match branch-label vocabulary — a shape with exactly this text is a branch label, never a valid bind candidate (Phase 3A evidence ranking). */
const EXACT_LABEL_TEXT_RE = /^(N\.?\s*G\.?|YES|NO|OK|O\.\s*K\.?|정상)$/i;

function mid(pos: { from: DrawingPos | null; to: DrawingPos | null }): { x: number; y: number } {
  if (!pos.from) return { x: 0, y: 0 };
  const to = pos.to ?? pos.from;
  return { x: (pos.from.col + to.col) / 2, y: (pos.from.row + to.row) / 2 };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toXY(pos: DrawingPos): { x: number; y: number } {
  return { x: pos.col, y: pos.row };
}

/**
 * Ranks real content shapes near an anchor point by distance, for the
 * Phase 3A "raw connector inspector" evidence — reuses the exact same
 * col/row Euclidean metric already used above for label matching. Branch
 * labels (NG/YES/NO/OK/정상) and explicitly excluded shape ids (an
 * already-known endpoint, or the node's own shape) are never candidates —
 * this ranks *possible bind targets*, not everything nearby.
 */
function rankCandidates(
  anchor: { x: number; y: number },
  shapes: DrawingShape[],
  excludeShapeIds: Set<string>
): ExtractedValidationIssueCandidate[] {
  return shapes
    .filter(
      (s) =>
        s.id &&
        !excludeShapeIds.has(s.id) &&
        s.text.trim().length > 0 &&
        !EXACT_LABEL_TEXT_RE.test(s.text.trim())
    )
    .map((s) => ({ shapeId: s.id!, text: firstLine(s.text), distance: dist(anchor, mid(s)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_EVIDENCE_CANDIDATES);
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 0 ? line : text.trim();
}

/** Splits the "*"-prefixed caution convention documented in Phase 1 report §2/§6. */
function splitInstructionsAndCaution(text: string): { instructions: string; caution: string | null } {
  const lines = text.split("\n");
  const cautionLines = lines.filter((l) => l.trim().startsWith("*"));
  const instructionLines = lines.filter((l) => !l.trim().startsWith("*"));
  return {
    instructions: instructionLines.join(" ").trim() || text.trim(),
    caution: cautionLines.length > 0 ? cautionLines.map((l) => l.trim()).join(" ") : null,
  };
}

export type SheetGraphResult = {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
  issues: ExtractedValidationIssue[];
  /** shapeId -> nodeCode, needed by the combine step for loop-back wiring */
  nodeCodeByShapeId: Map<string, string>;
  /** the node with the smallest reading-order position and no local incoming edge */
  startNodeCode: string | null;
};

/**
 * Strategy A (Phase 1 report §7): a sheet whose drawing layer has
 * connectors with resolvable stCxn/endCxn ids. One node per shape
 * referenced by at least one connector; one edge per connector, with its
 * branch label resolved from the nearest short unconnected text shape
 * (Phase 1's proximity heuristic). Never imports an edge whose endpoint
 * can't be resolved — those become DANGLING_CONNECTOR /
 * MISSING_SOURCE_NODE validation issues instead (this task's explicit
 * rule: ambiguous edges are reported, not guessed).
 */
export function extractSheetGraph(sheet: LoadedSheet): SheetGraphResult {
  const anchors = sheet.drawing ?? [];
  const shapes = anchors.filter((a): a is DrawingShape => a.kind === "shape");
  const connectors = anchors.filter((a): a is DrawingConnector => a.kind === "connector");

  const connectedIds = new Set<string>();
  for (const c of connectors) {
    if (c.stCxnId) connectedIds.add(c.stCxnId);
    if (c.endCxnId) connectedIds.add(c.endCxnId);
  }

  const flowShapes = shapes.filter((s) => s.id && connectedIds.has(s.id));
  const unconnectedShapes = shapes.filter((s) => !s.id || !connectedIds.has(s.id));

  // Reading order: top-to-bottom, then left-to-right — matches how a
  // person visually scans the diagram, and gives a stable sortOrder.
  const orderedFlowShapes = [...flowShapes].sort((a, b) => {
    const am = mid(a);
    const bm = mid(b);
    return am.y - bm.y || am.x - bm.x;
  });

  const nodeCodeByShapeId = new Map<string, string>();
  for (const s of orderedFlowShapes) {
    if (s.id) nodeCodeByShapeId.set(s.id, `s${sheet.sheetId}-${s.id}`);
  }

  const issues: ExtractedValidationIssue[] = [];

  // Proximity-match short unconnected text shapes to their nearest
  // connector (candidate branch labels — NG/YES/NO/정상/etc).
  const labelCandidates = unconnectedShapes.filter(
    (s) => s.text.replace(/\s/g, "").length > 0 && s.text.replace(/\s/g, "").length <= LABEL_MAX_LEN
  );
  const usedAsLabel = new Set<DrawingShape>();
  const edgeLabelByConnectorId = new Map<string, { text: string; distance: number }>();
  for (const label of labelCandidates) {
    const lp = mid(label);
    let best: DrawingConnector | null = null;
    let bestD = Infinity;
    for (const c of connectors) {
      const d = dist(lp, mid(c));
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best?.id && bestD <= LABEL_MATCH_THRESHOLD) {
      const existing = edgeLabelByConnectorId.get(best.id);
      if (!existing || bestD < existing.distance) {
        edgeLabelByConnectorId.set(best.id, { text: label.text.replace(/\n/g, " ").trim(), distance: bestD });
        usedAsLabel.add(label);
      }
    }
  }

  // Unconnected shapes that look like a connector/arrow autoshape carrying
  // its own text (Phase 1 report §6, finding 3 — e.g. (MB) 통전검사's
  // "O.K." arrow) rather than a plain label box: not resolvable into a
  // graph edge by this strategy, reported rather than silently dropped.
  for (const s of unconnectedShapes) {
    if (usedAsLabel.has(s)) continue;
    if (s.text.trim().length === 0) continue;
    if (s.geom && /connector|arrow/i.test(s.geom)) {
      issues.push({
        severity: "WARNING",
        issueType: "UNSUPPORTED_OBJECT",
        message: `연결선 모양의 도형에 텍스트가 포함되어 있어 자동으로 분기로 연결하지 못했습니다: "${firstLine(s.text)}"`,
        sourceWorksheet: sheet.name,
        sourceReference: s.id ? `shape#${s.id}` : null,
      });
    }
  }

  // ---- edges (built first — node_type classification needs each node's
  // own outgoing branch types) ----
  const rawEdges: { fromNodeCode: string; toNodeCode: string; branchType: ProcedureBranchType; branchLabel: string | null; sourceConnectorId: string | null }[] = [];
  for (const c of connectors) {
    if (!c.stCxnId || !c.endCxnId) {
      const excludeIds = new Set<string>([c.stCxnId, c.endCxnId].filter((x): x is string => !!x));
      issues.push({
        severity: "ERROR",
        issueType: "DANGLING_CONNECTOR",
        message: `연결선의 시작 또는 끝 도형 참조가 없습니다 (connector#${c.id ?? "?"}).`,
        sourceWorksheet: sheet.name,
        sourceReference: c.id ? `connector#${c.id}` : null,
        rawEvidence: {
          connectorId: c.id ?? null,
          stCxnId: c.stCxnId ?? null,
          endCxnId: c.endCxnId ?? null,
          from: c.from ?? null,
          to: c.to ?? null,
          headType: c.headType ?? null,
          tailType: c.tailType ?? null,
          fromCandidates: !c.stCxnId && c.from ? rankCandidates(toXY(c.from), shapes, excludeIds) : undefined,
          toCandidates: !c.endCxnId && c.to ? rankCandidates(toXY(c.to), shapes, excludeIds) : undefined,
        },
      });
      continue;
    }
    const fromCode = nodeCodeByShapeId.get(c.stCxnId);
    const toCode = nodeCodeByShapeId.get(c.endCxnId);
    if (!fromCode || !toCode) {
      const excludeIds = new Set<string>([c.stCxnId, c.endCxnId]);
      issues.push({
        severity: "ERROR",
        issueType: "MISSING_SOURCE_NODE",
        message: `연결선(connector#${c.id ?? "?"})이 참조하는 도형(shape#${!fromCode ? c.stCxnId : c.endCxnId})을 찾을 수 없습니다.`,
        sourceWorksheet: sheet.name,
        sourceReference: c.id ? `connector#${c.id}` : null,
        rawEvidence: {
          connectorId: c.id ?? null,
          stCxnId: c.stCxnId,
          endCxnId: c.endCxnId,
          from: c.from ?? null,
          to: c.to ?? null,
          headType: c.headType ?? null,
          tailType: c.tailType ?? null,
          fromCandidates: !fromCode && c.from ? rankCandidates(toXY(c.from), shapes, excludeIds) : undefined,
          toCandidates: !toCode && c.to ? rankCandidates(toXY(c.to), shapes, excludeIds) : undefined,
        },
      });
      continue;
    }

    const labelInfo = edgeLabelByConnectorId.get(c.id ?? "");
    const { branchType, branchLabel } = classifyBranchLabel(labelInfo?.text ?? null);
    if (labelInfo && labelInfo.distance > LABEL_CONFIDENT_THRESHOLD) {
      issues.push({
        severity: "WARNING",
        issueType: "AMBIGUOUS_LABEL_EDGE_MATCH",
        message: `분기 라벨 "${labelInfo.text}"이(가) 연결선(connector#${c.id})에서 다소 떨어져 있어 매칭 확신도가 낮습니다.`,
        sourceWorksheet: sheet.name,
        sourceReference: `connector#${c.id}`,
      });
    }

    rawEdges.push({ fromNodeCode: fromCode, toNodeCode: toCode, branchType, branchLabel, sourceConnectorId: c.id ?? null });
  }

  // ---- node_type classification (local edges only — see extract-shape-graph.ts module doc) ----
  const outgoingByNode = new Map<string, ProcedureBranchType[]>();
  const hasIncoming = new Set<string>();
  for (const e of rawEdges) {
    outgoingByNode.set(e.fromNodeCode, [...(outgoingByNode.get(e.fromNodeCode) ?? []), e.branchType]);
    hasIncoming.add(e.toNodeCode);
  }

  const nodes: ExtractedNode[] = [];
  let sortOrder = 0;
  let startNodeCode: string | null = null;
  for (const s of orderedFlowShapes) {
    if (!s.id) continue;
    const nodeCode = nodeCodeByShapeId.get(s.id)!;
    const isEarliest = sortOrder === 0;
    const nodeType = classifyNodeType({
      text: s.text,
      outgoingBranchTypes: outgoingByNode.get(nodeCode) ?? [],
      hasIncoming: hasIncoming.has(nodeCode),
      isEarliestInSheet: isEarliest,
    });
    if (nodeType === "START" && startNodeCode === null) startNodeCode = nodeCode;

    const { instructions, caution } = splitInstructionsAndCaution(s.text);
    const pos = s.from ?? { col: 0, row: sortOrder };
    nodes.push({
      nodeCode,
      nodeType,
      title: firstLine(s.text) || `(제목 없음 · shape#${s.id})`,
      description: s.text.trim() || null,
      instructions,
      safetyCaution: caution,
      positionX: pos.col * NODE_SPACING_X,
      positionY: pos.row * NODE_SPACING_Y,
      sortOrder: sortOrder++,
      sourceWorksheet: sheet.name,
      sourceShapeId: s.id,
      sourceCellRange: pos ? `${pos.col},${pos.row}` : null,
    });
  }

  const edges: ExtractedEdge[] = rawEdges.map((e, i) => ({
    fromNodeCode: e.fromNodeCode,
    toNodeCode: e.toNodeCode,
    branchType: e.branchType,
    branchLabel: e.branchLabel,
    sortOrder: i,
    sourceConnectorId: e.sourceConnectorId,
  }));

  // ---- structural validation: DECISION nodes must have a complete
  // "normal continuation" path — either an explicit DEFAULT/NORMAL edge,
  // or a complete YES+NO pair (which together already cover the decision
  // space and need no separate default edge). ----
  for (const node of nodes) {
    if (node.nodeType !== "DECISION") continue;
    const outgoing = outgoingByNode.get(node.nodeCode) ?? [];
    const hasCompleteYesNo = outgoing.includes("YES") && outgoing.includes("NO");
    if (!outgoing.includes("DEFAULT") && !outgoing.includes("NORMAL") && !hasCompleteYesNo) {
      const shape = node.sourceShapeId ? orderedFlowShapes.find((s) => s.id === node.sourceShapeId) : undefined;
      const alreadyTargetedIds = new Set<string>(
        connectors.filter((c) => c.stCxnId === node.sourceShapeId && c.endCxnId).map((c) => c.endCxnId!)
      );
      if (node.sourceShapeId) alreadyTargetedIds.add(node.sourceShapeId);
      issues.push({
        severity: "ERROR",
        issueType: "MISSING_OUTGOING_PATH",
        message: `판단 노드 "${node.title}"에 정상/기본 진행 경로가 없습니다 (NG/YES/NO 분기만 존재).`,
        sourceWorksheet: sheet.name,
        sourceReference: `shape#${node.sourceShapeId}`,
        rawEvidence: shape
          ? {
              shapeId: node.sourceShapeId,
              from: shape.from,
              to: shape.to,
              candidates: rankCandidates(mid(shape), shapes, alreadyTargetedIds),
            }
          : undefined,
      });
    }
  }

  // ---- reachability from the sheet's own start node ----
  if (startNodeCode) {
    const adjacency = new Map<string, string[]>();
    for (const e of rawEdges) {
      adjacency.set(e.fromNodeCode, [...(adjacency.get(e.fromNodeCode) ?? []), e.toNodeCode]);
    }
    const visited = new Set<string>([startNodeCode]);
    const stack = [startNodeCode];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    for (const node of nodes) {
      if (!visited.has(node.nodeCode)) {
        issues.push({
          severity: "WARNING",
          issueType: "UNREACHABLE_NODE",
          message: `노드 "${node.title}"에 시작 노드로부터 도달하는 경로가 없습니다.`,
          sourceWorksheet: sheet.name,
          sourceReference: `shape#${node.sourceShapeId}`,
        });
      }
    }
  }

  return { nodes, edges, issues, nodeCodeByShapeId, startNodeCode };
}

export { matchStageRestartReference };
