/**
 * Phase 5C-5C — pure forward replay of a template's full edit history,
 * reconstructing the exact graph/template-metadata state as of any past
 * point (used by Historical Restore to compute a diff against the live
 * current state). Never touches the DB itself — the caller loads every
 * history row for the template once and passes them in, since a full
 * replay from the beginning is required to reconstruct any single past
 * point (any entity could have been touched by any earlier row).
 *
 * Identity priority (see resolveNodeIdentity/resolveEdgeIdentity below):
 *   1. beforeState.id / afterState.id — every writer (procedure-template-
 *      editor.ts) now embeds this directly in UPDATE_NODE/CHANGE_NODE_TYPE/
 *      UPDATE_EDGE/RETARGET_EDGE/CREATE_EDGE going forward, so it survives
 *      forever, immune to the node_id/edge_id FK column ever being nulled.
 *   2. the row's live node_id/edge_id FK column — reliable only for older
 *      rows predating that invariant, and only as long as the entity was
 *      never independently deleted since (that column is ON DELETE SET
 *      NULL and reflects the CURRENT/now state of the referenced row, not
 *      a point-in-time snapshot — a column NULL today may have been valid
 *      when an earlier row was written).
 *   3. (edges only, CREATE_EDGE) the approved UNDO-mirror / DELETE_EDGE
 *      content-match fallback for older rows that predate step 1 entirely
 *      — see findUndoMirrorEdge/findEdgeByContentMatch. Passing the full
 *      row set in-memory lets this run as a simple scan, no DB round-trip.
 *   4. explicit ReplayError — never a guess, never a silently generated id.
 */

export type ReplayNodeState = {
  id: string;
  nodeCode: string;
  nodeType: string;
  title: string;
  description: string | null;
  objective: string | null;
  preparation: string | null;
  toolsAndEquipment: string | null;
  safetyCaution: string | null;
  instructions: string | null;
  expectedNormalResult: string | null;
  ngSymptoms: string | null;
  recommendedCorrectiveAction: string | null;
  acceptanceCriteria: string | null;
  workerMayAddNextTask: boolean;
  positionX: number;
  positionY: number;
  userPositionX: number | null;
  userPositionY: number | null;
  sortOrder: number;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
  sourceCellRange: string | null;
  isActive: boolean;
  createdAt: string;
};

export type ReplayEdgeState = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: string;
  branchLabel: string | null;
  conditionDefinition: unknown;
  sortOrder: number;
  sourceConnectorId: string | null;
  clonedFromEdgeId: string | null;
  userRoutePoints: { x: number; y: number }[] | null;
};

export type ReplayHistoryRow = {
  id: string;
  changeGroupId: string;
  origin: "USER_EDIT" | "UNDO" | "REDO" | "RESTORE";
  sourceGroupId: string | null;
  sequenceNumber: number;
  actionType: string;
  nodeId: string | null;
  edgeId: string | null;
  beforeState: unknown;
  afterState: unknown;
};

export type ReconstructedGraphState = {
  templateName: string;
  nodes: Map<string, ReplayNodeState>;
  edges: Map<string, ReplayEdgeState>;
};

export class ReplayError extends Error {}

function extractId(state: unknown): string | null {
  if (state && typeof state === "object" && "id" in state) {
    const id = (state as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Reconstructs the graph/template-name state as of immediately after the
 * row with the highest sequence_number <= cutoffSequenceNumber. `rows`
 * must be the template's COMPLETE history (every row, every origin) — a
 * partial set breaks both the forward walk and the UNDO-mirror fallback.
 * `currentTemplateName` seeds the name only for templates that have never
 * had an UPDATE_TEMPLATE_METADATA row at all (i.e. never renamed) — the
 * name at any point before the first rename is otherwise recovered from
 * that first row's own beforeState, since template creation itself isn't
 * a procedure_template_edit_history event.
 */
export function reconstructStateAtSequenceNumber(rows: ReplayHistoryRow[], cutoffSequenceNumber: number, currentTemplateName: string): ReconstructedGraphState {
  const sorted = [...rows].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const firstMetadataRow = sorted.find((r) => r.actionType === "UPDATE_TEMPLATE_METADATA");
  let templateName = firstMetadataRow ? (firstMetadataRow.beforeState as { name: string }).name : currentTemplateName;

  const nodes = new Map<string, ReplayNodeState>();
  const edges = new Map<string, ReplayEdgeState>();

  function findUndoMirrorEdge(originalGroupId: string): ReplayEdgeState | null {
    const candidates = rows.filter((r) => r.sourceGroupId === originalGroupId && r.origin === "UNDO" && r.actionType === "DELETE_EDGE");
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.sequenceNumber - a.sequenceNumber);
    return candidates[0].beforeState as ReplayEdgeState;
  }

  /**
   * Fallback used when no UNDO-mirror exists (e.g. the edge was deleted by
   * a plain, non-Undo DELETE_EDGE — which nulls edge_id on the CREATE_EDGE
   * row exactly the same way an Undo's delete would, but carries no
   * source_group_id linking the two). Any DELETE_EDGE row's own beforeState
   * is a full, FK-nulling-immune snapshot of the edge it removed; if
   * EXACTLY ONE such row's recorded (fromNodeId, toNodeId, branchType,
   * branchLabel) matches this CREATE_EDGE's own afterState, that's the
   * edge — deterministic, not a guess. If zero or more than one match,
   * identity genuinely cannot be proven and this returns null (the caller
   * fails explicitly), never picking arbitrarily among candidates.
   */
  function findEdgeByContentMatch(createRow: ReplayHistoryRow): ReplayEdgeState | null {
    const after = createRow.afterState as { fromNodeId: string; toNodeId: string; branchType: string; branchLabel: string | null };
    const candidates = rows.filter((r) => {
      if (r.actionType !== "DELETE_EDGE") return false;
      const b = r.beforeState as ReplayEdgeState | null;
      return !!b && b.fromNodeId === after.fromNodeId && b.toNodeId === after.toNodeId && b.branchType === after.branchType && b.branchLabel === after.branchLabel;
    });
    if (candidates.length !== 1) return null;
    return candidates[0].beforeState as ReplayEdgeState;
  }

  // Phase 5C-5C — normalized identity-resolution priority (see this
  // module's own doc comment): beforeState.id/afterState.id first (every
  // writer now embeds this going forward), then the row's live
  // node_id/edge_id FK column (older rows, entity never independently
  // deleted since), then (edges only) the approved UNDO-mirror/content-
  // match fallback, then explicit ReplayError — never a guess.
  function resolveNodeIdentity(row: ReplayHistoryRow): string | null {
    return extractId(row.beforeState) ?? extractId(row.afterState) ?? row.nodeId;
  }
  function resolveEdgeIdentity(row: ReplayHistoryRow): string | null {
    return extractId(row.beforeState) ?? extractId(row.afterState) ?? row.edgeId;
  }

  for (const row of sorted) {
    if (row.sequenceNumber > cutoffSequenceNumber) break;

    switch (row.actionType) {
      case "CREATE_NODE": {
        const snapshot = row.afterState as ReplayNodeState;
        nodes.set(snapshot.id, snapshot);
        break;
      }
      case "DELETE_NODE": {
        const id = resolveNodeIdentity(row);
        if (!id) throw new ReplayError(`cannot resolve node identity for DELETE_NODE row ${row.id}`);
        nodes.delete(id);
        break;
      }
      case "UPDATE_NODE": {
        const id = resolveNodeIdentity(row);
        if (!id) throw new ReplayError(`cannot resolve node identity for UPDATE_NODE row ${row.id} — node_id is null`);
        const existing = nodes.get(id);
        if (!existing) throw new ReplayError(`UPDATE_NODE row ${row.id} targets node ${id}, which does not exist at this point in history`);
        const patch = row.afterState as { title: string; description: string | null; instructions: string | null; sortOrder: number; isActive: boolean };
        nodes.set(id, { ...existing, ...patch });
        break;
      }
      case "CHANGE_NODE_TYPE": {
        const id = resolveNodeIdentity(row);
        if (!id) throw new ReplayError(`cannot resolve node identity for CHANGE_NODE_TYPE row ${row.id} — node_id is null`);
        const existing = nodes.get(id);
        if (!existing) throw new ReplayError(`CHANGE_NODE_TYPE row ${row.id} targets node ${id}, which does not exist at this point in history`);
        const { nodeType } = row.afterState as { nodeType: string };
        nodes.set(id, { ...existing, nodeType });
        break;
      }
      case "CREATE_EDGE": {
        const after = row.afterState as { fromNodeId: string; toNodeId: string; branchType: string; branchLabel: string | null };
        let id = resolveEdgeIdentity(row);
        let conditionDefinition: unknown = null;
        let sortOrder = 0;
        let sourceConnectorId: string | null = null;
        let clonedFromEdgeId: string | null = null;
        let userRoutePoints: { x: number; y: number }[] | null = null;
        if (!id) {
          const mirror = findUndoMirrorEdge(row.changeGroupId) ?? findEdgeByContentMatch(row);
          if (!mirror) throw new ReplayError(`cannot resolve edge identity for CREATE_EDGE row ${row.id} — edge_id is null, no UNDO-mirror snapshot exists, and no unambiguous DELETE_EDGE content match exists`);
          id = mirror.id;
          conditionDefinition = mirror.conditionDefinition;
          sortOrder = mirror.sortOrder;
          sourceConnectorId = mirror.sourceConnectorId;
          clonedFromEdgeId = mirror.clonedFromEdgeId;
          userRoutePoints = mirror.userRoutePoints;
        }
        edges.set(id, { id, fromNodeId: after.fromNodeId, toNodeId: after.toNodeId, branchType: after.branchType, branchLabel: after.branchLabel, conditionDefinition, sortOrder, sourceConnectorId, clonedFromEdgeId, userRoutePoints });
        break;
      }
      case "DELETE_EDGE": {
        const id = resolveEdgeIdentity(row);
        if (!id) throw new ReplayError(`cannot resolve edge identity for DELETE_EDGE row ${row.id}`);
        edges.delete(id);
        break;
      }
      case "UPDATE_EDGE": {
        const id = resolveEdgeIdentity(row);
        if (!id) throw new ReplayError(`cannot resolve edge identity for UPDATE_EDGE row ${row.id} — edge_id is null`);
        const existing = edges.get(id);
        if (!existing) throw new ReplayError(`UPDATE_EDGE row ${row.id} targets edge ${id}, which does not exist at this point in history`);
        const patch = row.afterState as { branchType: string; branchLabel: string | null };
        edges.set(id, { ...existing, ...patch });
        break;
      }
      case "RETARGET_EDGE": {
        const id = resolveEdgeIdentity(row);
        if (!id) throw new ReplayError(`cannot resolve edge identity for RETARGET_EDGE row ${row.id} — edge_id is null`);
        const existing = edges.get(id);
        if (!existing) throw new ReplayError(`RETARGET_EDGE row ${row.id} targets edge ${id}, which does not exist at this point in history`);
        const patch = row.afterState as { fromNodeId: string; toNodeId: string };
        edges.set(id, { ...existing, fromNodeId: patch.fromNodeId, toNodeId: patch.toNodeId });
        break;
      }
      case "SAVE_LAYOUT": {
        const positions = row.afterState as { nodeId: string; x: number; y: number }[];
        for (const p of positions) {
          const existing = nodes.get(p.nodeId);
          if (existing) nodes.set(p.nodeId, { ...existing, userPositionX: p.x, userPositionY: p.y });
        }
        break;
      }
      case "SAVE_EDGE_ROUTE": {
        const routes = row.afterState as { edgeId: string; points: { x: number; y: number }[] | null }[];
        for (const r of routes) {
          const existing = edges.get(r.edgeId);
          if (existing) edges.set(r.edgeId, { ...existing, userRoutePoints: r.points });
        }
        break;
      }
      case "UPDATE_TEMPLATE_METADATA": {
        const { name } = row.afterState as { name: string };
        templateName = name;
        break;
      }
      default:
        // VALIDATE_TEMPLATE and any unsupported/legacy action type never
        // mutates the graph — correctly a no-op for state reconstruction,
        // not a gap.
        break;
    }
  }

  return { templateName, nodes, edges };
}
