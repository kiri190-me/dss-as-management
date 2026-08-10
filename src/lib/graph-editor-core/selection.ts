/**
 * Generic graph-editor-core — selection/neighborhood mechanics. Domain-free:
 * operates only on a minimal {id, source, target} edge shape, with no
 * knowledge of procedure templates or any other consumer's node/edge
 * payload. Extracted unchanged from the procedure domain's
 * procedure-visual-language.ts (Phase 5C-4) — behavior is identical; only
 * its home moved.
 */

export type MinimalEdge = { id: string; source: string; target: string };

/** 1-hop incoming+outgoing node/edge ids for the selected node — the basis for path highlighting and dimming everything else. Returns empty sets when nothing is selected. */
export function computeConnectedIds(
  selectedNodeId: string | null,
  edges: MinimalEdge[]
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!selectedNodeId) return { nodeIds, edgeIds };
  nodeIds.add(selectedNodeId);
  for (const e of edges) {
    if (e.source === selectedNodeId) {
      nodeIds.add(e.target);
      edgeIds.add(e.id);
    }
    if (e.target === selectedNodeId) {
      nodeIds.add(e.source);
      edgeIds.add(e.id);
    }
  }
  return { nodeIds, edgeIds };
}
