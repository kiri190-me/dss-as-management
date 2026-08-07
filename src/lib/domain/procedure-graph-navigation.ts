/**
 * Phase 3B revision — error-to-node navigation. Pure functions only: no DOM,
 * no React, no fetch. These are the single source of truth for how a
 * validation issue's stable source identity (procedure template id,
 * worksheet, shape id, connector id, or a resolved imported node id) turns
 * into a graph URL, and how that URL turns back into a concrete node to
 * select/center on. Never depends on node title text, since titles may be
 * duplicated across a template.
 */

export type NavigableNode = {
  id: string;
  sourceWorksheet: string | null;
  sourceShapeId: string | null;
};

export type NavigableEdge = {
  fromNodeId: string;
  toNodeId: string;
  sourceConnectorId: string | null;
};

/** Extracts the shape or connector id embedded in a validation issue's `sourceReference` (e.g. "shape#50", "connector#57"). Never both — a given issue's sourceReference is one or the other. */
export function parseSourceReference(sourceReference: string | null): { shapeId: string | null; connectorId: string | null } {
  if (!sourceReference) return { shapeId: null, connectorId: null };
  const shapeMatch = sourceReference.match(/shape#(\w+)/);
  if (shapeMatch) return { shapeId: shapeMatch[1], connectorId: null };
  const connectorMatch = sourceReference.match(/connector#(\w+)/);
  if (connectorMatch) return { shapeId: null, connectorId: connectorMatch[1] };
  return { shapeId: null, connectorId: null };
}

export type WorkflowViewLinkParams = {
  templateId: string;
  issueId?: string | null;
  worksheet?: string | null;
  /** A precisely-resolved imported node id — preferred over shapeId/connectorId whenever the caller already knows it (e.g. the issue detail screen, which has already resolved currentNode/fallbackNodeId with full candidate ranking). */
  nodeId?: string | null;
  /** Used when the caller only has the raw source reference (e.g. the issue list screen, which doesn't load per-issue node resolution to avoid an N+1 query) — the graph screen resolves this against its already-loaded node list. */
  shapeId?: string | null;
  connectorId?: string | null;
  /** True when nodeId is a nearest-endpoint/candidate approximation, not an exact match — e.g. an unbound-connector issue with no fully bound node. */
  isFallback?: boolean;
  /** Phase 3B revision (Problem 2) — set true from an issue row/detail's navigation action so the graph screen lands directly in 오류 집중 보기 instead of the plain full graph. */
  errorFocus?: boolean;
};

/**
 * Builds the "워크플로우에서 보기" / "오류 위치로 이동" href. Query params
 * only — direct navigation and browser refresh both work since the graph
 * screen re-derives everything from the URL on every load, never from
 * client-only state.
 */
export function buildWorkflowViewHref(params: WorkflowViewLinkParams): string {
  const qs = new URLSearchParams();
  if (params.issueId) qs.set("issue", params.issueId);
  if (params.worksheet) qs.set("worksheet", params.worksheet);
  if (params.nodeId) {
    qs.set("node", params.nodeId);
  } else {
    if (params.shapeId) qs.set("shape", params.shapeId);
    if (params.connectorId) qs.set("connector", params.connectorId);
  }
  if (params.isFallback) qs.set("fallback", "1");
  if (params.errorFocus) qs.set("mode", "error-focus");
  const query = qs.toString();
  return `/procedures/${params.templateId}${query ? `?${query}` : ""}`;
}

/**
 * Phase 4A — the editor route's own version of buildWorkflowViewHref, same
 * query-param shape (issue/worksheet/node/shape/connector/fallback/mode)
 * but pointing at /procedures/{id}/edit instead of /procedures/{id}, so
 * "검토/처리 화면 열기"-style links can send a reviewer straight into the
 * controlled editor already focused on the right node, instead of the
 * read-only graph. Deliberately a thin wrapper around buildWorkflowViewHref
 * rather than a duplicate implementation — the two hrefs must never drift
 * apart in how they encode state.
 */
export function buildProcedureEditorHref(params: WorkflowViewLinkParams): string {
  const readOnlyHref = buildWorkflowViewHref(params);
  const [path, query] = readOnlyHref.split("?");
  return `${path}/edit${query ? `?${query}` : ""}`;
}

export type GraphNavigationParams = {
  nodeParam?: string | null;
  worksheetParam?: string | null;
  shapeParam?: string | null;
  connectorParam?: string | null;
  fallbackParam?: string | null;
  modeParam?: string | null;
};

export type ResolvedGraphTarget = {
  /** null means no worksheet was specified — the graph keeps its default (전체 보기) */
  worksheetFilter: string | null;
  nodeId: string | null;
  /** true when nodeId is an approximation (nearest bound connector endpoint), not an exact match for the issue */
  isFallback: boolean;
  /** true when the URL requested `mode=error-focus` — the graph should land in 오류 집중 보기 rather than the plain full graph */
  errorFocus: boolean;
};

/**
 * Turns the graph route's query params into a concrete node to select —
 * this is what makes "clear any filter that would hide the node" and
 * "locate the exact node" deterministic:
 *   1. an explicit `node` id (already resolved by the caller) wins outright;
 *   2. otherwise a `shape` id is matched against the currently-loaded node
 *      list by sourceWorksheet+sourceShapeId (the same stable-identity
 *      technique used server-side for open-issue markers);
 *   3. otherwise a `connector` id is matched against edges by
 *      sourceConnectorId, falling back to that edge's source node — "center
 *      on the nearest bound source or target node" for an issue whose
 *      connector never fully bound into a real edge;
 *   4. otherwise no node is resolvable and the caller must show the
 *      "no fully bound node exists yet" state.
 */
export function resolveInitialGraphTarget(
  params: GraphNavigationParams,
  nodes: NavigableNode[],
  edges: NavigableEdge[]
): ResolvedGraphTarget {
  const worksheetFilter = params.worksheetParam ?? null;
  const errorFocus = params.modeParam === "error-focus";

  if (params.nodeParam) {
    return { worksheetFilter, nodeId: params.nodeParam, isFallback: params.fallbackParam === "1", errorFocus };
  }

  if (params.shapeParam) {
    const match = nodes.find(
      (n) => n.sourceShapeId === params.shapeParam && (worksheetFilter === null || n.sourceWorksheet === worksheetFilter)
    );
    if (match) return { worksheetFilter, nodeId: match.id, isFallback: false, errorFocus };
  }

  if (params.connectorParam) {
    const edge = edges.find((e) => e.sourceConnectorId === params.connectorParam);
    if (edge) return { worksheetFilter, nodeId: edge.fromNodeId, isFallback: true, errorFocus };
  }

  return { worksheetFilter, nodeId: null, isFallback: false, errorFocus };
}
