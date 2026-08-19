/**
 * Generic graph-editor-core — layout mechanics. Domain-free: two
 * independent pieces extracted from the procedure domain in Phase 5C-4,
 * neither aware of procedure templates, worksheets, node types, or any
 * other consumer's data model:
 *
 *  - resolveEffectiveNodePosition/hasUserLayoutOverride (from
 *    procedure-template-layout.ts, moved unchanged) — generic
 *    override-vs-fallback position resolution.
 *  - packNodesIntoRows (newly extracted from the row-packing core of
 *    procedure-visual-language.ts's computeStageSortedLayout) — a pure,
 *    generic "pack sized items into wrapped rows" primitive. It knows
 *    nothing about worksheets, DECISION nodes, or LOOP_BACK edges; a
 *    caller wanting per-node extra trailing gap or extra row clearance
 *    supplies those as plain per-item numeric/boolean hints
 *    (`extraTrailingGap`, `causesExtraRowGap`) it has already computed
 *    itself. The procedure domain's own worksheet-band iteration,
 *    DECISION_BRANCH_GAP, and LOOPBACK_ROW_EXTRA_GAP weighting remain in
 *    procedure-visual-language.ts, which calls this once per worksheet band.
 */

// ---- position override/fallback ----

export type SourcePosition = { positionX: number; positionY: number };
export type LayoutOverride = { userPositionX: number | null | undefined; userPositionY: number | null | undefined };

function isValidOverrideCoordinate(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function resolveEffectiveNodePosition(
  node: SourcePosition & LayoutOverride,
  layoutMode: "SOURCE" | "USER"
): { x: number; y: number } {
  if (layoutMode === "SOURCE") {
    return { x: node.positionX, y: node.positionY };
  }
  const x = isValidOverrideCoordinate(node.userPositionX) ? node.userPositionX : node.positionX;
  const y = isValidOverrideCoordinate(node.userPositionY) ? node.userPositionY : node.positionY;
  return { x, y };
}

/** True only when both override coordinates are present and valid — used to show "this node has been repositioned" state, distinct from "falls back to source". */
export function hasUserLayoutOverride(node: LayoutOverride): boolean {
  return isValidOverrideCoordinate(node.userPositionX) && isValidOverrideCoordinate(node.userPositionY);
}

// ---- relative positioning ("상대 위치로 이동") ----

export type RelativeDirection = "LEFT" | "RIGHT" | "UP" | "DOWN";

/**
 * Computes a target coordinate near a reference node, in one of the four
 * cardinal directions — the pure math behind "상대 위치로 이동"
 * (NodePropertyPanel) and "새 노드를 선택된 노드 아래에 추가" (CreateNodePanel).
 * Domain-free: takes an already-resolved reference position (the caller
 * decides whether that's a node's source or user-overridden position), no
 * procedure/node-type concept here at all.
 *
 * Round-2 fix — this used to take/return only `{x, y}` (left-edge,
 * React Flow's own position convention) and never knew either node's
 * width, so DOWN/UP silently copied the reference's LEFT edge, not its
 * CENTER — invisible for same-width nodes, but visibly crooked the moment
 * two nodes differ in width (e.g. a multiline title). This was the actual
 * reason the earlier computeLayeredGraphLayout center-fix didn't fix
 * real-world alignment: creating a node via "노드 추가" (or moving one via
 * "상대 위치로 이동") always writes an explicit/pinned userPositionX/Y —
 * computeLayeredGraphLayout's fallback never runs for it at all, so its
 * own correctness was never the bottleneck; this function was.
 *
 * DOWN/UP now preserve the reference's CENTER x
 * (`referenceCenterX - targetWidth / 2`) regardless of either node's
 * width. LEFT/RIGHT place the target just outside the reference's actual
 * bounding box (edge + gap), never overlapping regardless of width.
 */
export function computeRelativePosition(
  reference: { x: number; y: number; width: number },
  direction: RelativeDirection,
  spacing: { horizontal: number; vertical: number },
  targetWidth: number
): { x: number; y: number } {
  const referenceCenterX = reference.x + reference.width / 2;
  switch (direction) {
    case "LEFT":
      return { x: reference.x - spacing.horizontal - targetWidth, y: reference.y };
    case "RIGHT":
      return { x: reference.x + reference.width + spacing.horizontal, y: reference.y };
    case "UP":
      return { x: referenceCenterX - targetWidth / 2, y: reference.y - spacing.vertical };
    case "DOWN":
      return { x: referenceCenterX - targetWidth / 2, y: reference.y + spacing.vertical };
  }
}

// ---- effective node dimensions (5C-6D follow-up #5) ----

export type NodeDimensionsLike = { width: number; height: number };

/**
 * THE single, authoritative measured-vs-fallback priority rule — used
 * identically for a relative-position operation's target, reference, AND
 * every column-snap candidate node, so none of them can ever drift onto a
 * different resolution rule than the others. `measured` is the RAW,
 * possibly-partial value straight from React Flow's own internal node
 * store (each axis independently `number | undefined` until that axis has
 * actually been measured) — resolved PER AXIS, not all-or-nothing, so a
 * node with only one dimension measured so far still gets the real value
 * for that axis and only falls back on the other. `fallback` (the
 * presentation-only, description-blind `computeNodeDimensions` estimate)
 * is used only for whichever axis isn't validly measured — a valid
 * measured value on an axis is NEVER overridden by the fallback, no matter
 * how different the two disagree (that disagreement, in fact, is exactly
 * what root-caused the original bug this function fixes: description text
 * the estimate never accounted for).
 *
 * `> 0` (not just finite) — a measured 0 is never a real chip's rendered
 * size, so it's treated the same as "not yet measured."
 */
export function resolveEffectiveNodeDimensions(measured: { width?: number; height?: number } | null | undefined, fallback: NodeDimensionsLike): NodeDimensionsLike {
  const width = measured && Number.isFinite(measured.width) && (measured.width as number) > 0 ? (measured.width as number) : fallback.width;
  const height = measured && Number.isFinite(measured.height) && (measured.height as number) > 0 ? (measured.height as number) : fallback.height;
  return { width, height };
}

// ---- straighten-connection (double-click edge, 5C-6D follow-up #6) ----

export type ConnectedNodeGeometry = { x: number; y: number; width: number; height: number };
export type StraightenedConnectionOrientation = "VERTICAL" | "HORIZONTAL";
export type StraightenedConnectionResult = { orientation: StraightenedConnectionOrientation; position: { x: number; y: number } };

/**
 * "Double-click an edge to straighten it" — keeps the SOURCE node fixed and
 * computes where the TARGET node should move so their VISUAL centers align
 * on whichever axis currently separates them more (the dominant separation
 * represents the user's visible intent: a mostly-vertical relationship
 * straightens vertically, a mostly-horizontal one straightens
 * horizontally). A tie (`|dy| === |dx|`) prefers VERTICAL, matching this
 * domain's own top-to-bottom flow convention.
 *
 * VERTICAL: target's Y is left untouched; only X moves, to
 * `sourceCenterX - target.width / 2`. HORIZONTAL: target's X is left
 * untouched; only Y moves, to `sourceCenterY - target.height / 2`. Uses
 * each node's ACTUAL width/height (not raw left-edge/top-edge equality) —
 * see this checkpoint's own doc trail (follow-up #5) for why an estimate-
 * only approach silently misaligns nodes with different rendered sizes
 * (multiline titles, descriptions, different shapes).
 *
 * Domain-agnostic and deliberately ignorant of edge id, branch type,
 * routePoints, or persistence — a caller decides whether/how to apply the
 * returned position and whether an edge's own manual route should also
 * reset to automatic. Never mutates its inputs. If the nodes are already
 * exactly aligned on the dominant axis, the returned position equals the
 * target's current position (nothing moves) — this is the formula's own
 * natural behavior, not a special case handled here.
 */
export function computeStraightenedConnectedNodePosition(source: ConnectedNodeGeometry, target: ConnectedNodeGeometry): StraightenedConnectionResult {
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const dx = targetCenterX - sourceCenterX;
  const dy = targetCenterY - sourceCenterY;

  if (Math.abs(dy) >= Math.abs(dx)) {
    return { orientation: "VERTICAL", position: { x: sourceCenterX - target.width / 2, y: target.y } };
  }
  return { orientation: "HORIZONTAL", position: { x: target.x, y: sourceCenterY - target.height / 2 } };
}

// ---- center-aligned relative positioning (5C-6D follow-up #3) ----

/**
 * Same LEFT/RIGHT/UP/DOWN math as computeRelativePosition, except LEFT/RIGHT
 * now also align by vertical CENTER, not raw top-left y — two nodes of
 * different height (a multiline title, a different node shape) must still
 * share the same center y once placed side by side, or their connecting
 * edge visibly kinks even though "y" superficially matched. UP/DOWN are
 * unchanged (computeRelativePosition already center-aligns those by x);
 * reproduced here rather than delegating, so this function is a complete,
 * self-contained replacement a caller can switch to on its own.
 *
 * Deliberately a NEW function, not a change to computeRelativePosition in
 * place — that function is still called by the Procedure editor
 * (NodePropertyPanel.tsx/CreateNodePanel.tsx), and changing its LEFT/RIGHT
 * behavior there was explicitly out of scope for this checkpoint (5C-6D-1
 * will decide whether to standardize this across both editors). Case
 * Flowchart is the only caller of this function today.
 */
export function computeCenterAlignedRelativePosition(
  reference: { x: number; y: number; width: number; height: number },
  direction: RelativeDirection,
  spacing: { horizontal: number; vertical: number },
  target: { width: number; height: number }
): { x: number; y: number } {
  const referenceCenterX = reference.x + reference.width / 2;
  const referenceCenterY = reference.y + reference.height / 2;
  switch (direction) {
    case "LEFT":
      return { x: reference.x - spacing.horizontal - target.width, y: referenceCenterY - target.height / 2 };
    case "RIGHT":
      return { x: reference.x + reference.width + spacing.horizontal, y: referenceCenterY - target.height / 2 };
    case "UP":
      return { x: referenceCenterX - target.width / 2, y: reference.y - spacing.vertical };
    case "DOWN":
      return { x: referenceCenterX - target.width / 2, y: reference.y + spacing.vertical };
  }
}

// ---- column-aware snapping for LEFT/RIGHT relative placement ----

export type ColumnSnapCandidate = { id: string; x: number; y: number; width: number; height: number };
export type ColumnSnapResult = { x: number; y: number; snappedToNodeId: string | null };

/**
 * Refines a LEFT/RIGHT candidate position (typically from
 * computeCenterAlignedRelativePosition) so that placing a node into a
 * column that already has a node directly above it snaps to that existing
 * node's exact center-x column, instead of landing at a slightly different
 * x purely because this particular reference node happens to have a
 * different width. Deterministic: among existing nodes strictly ABOVE the
 * candidate (smaller center y — a node at or below the candidate is never a
 * column candidate, see the caller-facing tests) and within `tolerance` of
 * the candidate's own center x, the one closest above (largest center y)
 * wins — never array order.
 *
 * `tolerance` should be derived from real layout geometry by the caller
 * (e.g. half its own horizontal relative-position spacing constant), never
 * an arbitrary large number — this function applies whatever tolerance
 * it's given without judging it, so a caller passing too large a value can
 * still produce a surprising jump; keeping the tolerance sane is the
 * caller's responsibility, by design (this stays a generic, domain-agnostic
 * helper with no opinion on any particular editor's spacing constants).
 *
 * UP/DOWN never call this — column snapping is a LEFT/RIGHT-only concept
 * for this checkpoint.
 */
export function resolveColumnSnappedRelativePosition(input: {
  candidateX: number;
  candidateY: number;
  targetWidth: number;
  targetHeight: number;
  existingNodes: ColumnSnapCandidate[];
  excludeNodeIds: string[];
  tolerance: number;
}): ColumnSnapResult {
  const candidateCenterX = input.candidateX + input.targetWidth / 2;
  const candidateCenterY = input.candidateY + input.targetHeight / 2;
  const excludeSet = new Set(input.excludeNodeIds);

  let best: { node: ColumnSnapCandidate; centerY: number } | null = null;
  for (const node of input.existingNodes) {
    if (excludeSet.has(node.id)) continue;
    const nodeCenterY = node.y + node.height / 2;
    if (nodeCenterY >= candidateCenterY) continue; // only nodes strictly ABOVE the intended target position qualify
    const nodeCenterX = node.x + node.width / 2;
    if (Math.abs(nodeCenterX - candidateCenterX) > input.tolerance) continue; // outside the candidate's column
    if (best === null || nodeCenterY > best.centerY) best = { node, centerY: nodeCenterY };
  }

  if (best === null) return { x: input.candidateX, y: input.candidateY, snappedToNodeId: null };

  const snappedCenterX = best.node.x + best.node.width / 2;
  return { x: snappedCenterX - input.targetWidth / 2, y: input.candidateY, snappedToNodeId: best.node.id };
}

// ---- generic row-packing primitive ----

export type PackableNode = {
  id: string;
  width: number;
  height: number;
  /** Extra horizontal gap appended after this node's own trailing gap, beyond the standard `hGap` (e.g. proportional to a branch count) — a plain caller-supplied number, no meaning assumed here. */
  extraTrailingGap?: number;
  /** If true and this node's row wraps to a new row, `extraRowGap` is added on top of the ordinary `vGap` before the new row starts — a plain caller-supplied flag, no meaning assumed here. */
  causesExtraRowGap?: boolean;
};

export type PackNodesIntoRowsOptions = {
  /** y-coordinate of the first row */
  startY: number;
  /** once a row's accumulated width would exceed this, wrap to a new row */
  rowMaxWidth: number;
  /** standard horizontal gap between adjacent nodes in the same row */
  hGap: number;
  /** standard vertical gap between rows */
  vGap: number;
  /** extra vertical gap added on top of `vGap` when wrapping past a row whose `causesExtraRowGap` flag was set */
  extraRowGap: number;
};

export type PackNodesIntoRowsResult = {
  positions: Map<string, { x: number; y: number }>;
  /** 0-based row index, reset by the caller per group (this function never groups on its own) */
  rowIndexByNodeId: Map<string, number>;
  /** rightmost x any node reaches (its own right edge, including any extraTrailingGap, excluding the trailing hGap) */
  maxX: number;
  /** total vertical extent consumed, from `startY` to the bottom of the last row */
  height: number;
};

/**
 * Packs a pre-ordered list of sized items into left-to-right rows that wrap
 * once a row's accumulated width would exceed `rowMaxWidth`, exactly
 * mirroring the packing decision procedure-visual-language.ts's
 * computeStageSortedLayout used inline before Phase 5C-4. Deterministic and
 * order-dependent only on the input array's order (callers sort/group
 * before calling). No worksheet/DECISION/LOOP_BACK concept lives here —
 * callers that need that weighting pre-compute `extraTrailingGap`/
 * `causesExtraRowGap` per item.
 */
export function packNodesIntoRows(nodes: PackableNode[], options: PackNodesIntoRowsOptions): PackNodesIntoRowsResult {
  const positions = new Map<string, { x: number; y: number }>();
  const rowIndexByNodeId = new Map<string, number>();
  let maxX = 0;
  let rowY = options.startY;
  let x = 0;
  let rowMaxHeight = 0;
  let rowHasExtraGapTrigger = false;
  let rowIndex = 0;

  for (const n of nodes) {
    if (x > 0 && x + n.width > options.rowMaxWidth) {
      rowY += rowMaxHeight + options.vGap + (rowHasExtraGapTrigger ? options.extraRowGap : 0);
      x = 0;
      rowMaxHeight = 0;
      rowHasExtraGapTrigger = false;
      rowIndex += 1;
    }

    positions.set(n.id, { x, y: rowY });
    rowIndexByNodeId.set(n.id, rowIndex);

    const advance = n.width + options.hGap + (n.extraTrailingGap ?? 0);
    x += advance;
    maxX = Math.max(maxX, x - options.hGap);
    rowMaxHeight = Math.max(rowMaxHeight, n.height);
    if (n.causesExtraRowGap) rowHasExtraGapTrigger = true;
  }

  return { positions, rowIndexByNodeId, maxX, height: rowY + rowMaxHeight - options.startY };
}

// ---- layered (depth-based) graph layout ----

/**
 * `pinnedX`, when present, is a node's already-resolved TOP-LEFT x (a
 * persisted userPositionX override, same convention as positionX/
 * userPositionX elsewhere) — see computeLayeredGraphLayout's own doc
 * comment for why this must be threaded through rather than letting the
 * algorithm invent its own x for every node independently.
 *
 * `width` is the node's actual rendered width (e.g. from
 * computeNodeDimensions — nodes can differ in width because a multiline
 * title needs more horizontal room). Required so this function can align
 * nodes by CENTER x rather than left-edge x — React Flow's `position` is
 * top-left-based, so two nodes sharing the same `position.x` do NOT share
 * the same center once their widths differ, and their bottom/top handles
 * (computed from each node's own center) would then disagree too,
 * producing a visibly bent connector despite `position.x` matching.
 */
export type LayeredLayoutNode = { id: string; sortOrder: number; width: number; pinnedX?: number | null };
export type LayeredLayoutEdge = { fromNodeId: string; toNodeId: string };
export type LayeredLayoutSpacing = { horizontal: number; vertical: number };

/**
 * A minimal layered/hierarchical DAG layout: `y` is purely BFS depth from
 * each root (a node with no incoming edge among the given set) times
 * `spacing.vertical`; the returned `x` follows one rule, computed by
 * CENTER — a node with exactly one parent inherits that parent's CENTER x
 * exactly (`childCenterX = parentCenterX`, converted back to the returned
 * top-left `x = childCenterX - childWidth / 2`) UNLESS it has siblings
 * (other children of the same parent), in which case siblings fan out
 * symmetrically around the parent's center. All internal arithmetic
 * (seeding, fan-out offsets, same-depth collision spacing) operates in
 * this CENTER-x space throughout, only converting to left-edge `x` in the
 * final result — aligning left edges instead would silently break for any
 * two nodes of different width (see LayeredLayoutNode's own doc comment).
 * This is deliberately NOT the same algorithm as
 * packNodesIntoRows/computeStageSortedLayout above (a row-*wrapping* flow
 * layout, which does not track graph depth at all and can place an
 * unrelated pair of nodes side by side in the same row purely because they
 * fit — see this function's own call site in ProcedureFlowGraph.tsx for
 * why that distinction matters): a straight single-parent/single-child
 * chain (A->B->C) always lands in the same `x` column here, one row per
 * hop, which is the "vertical continuation" a row-packing layout cannot
 * guarantee.
 *
 * Cycle-safe (LOOP_BACK/RETRY edges are common in this domain): depth is
 * assigned on first BFS discovery only, so a back-edge to an
 * already-visited node never re-queues it or loops forever. A node with no
 * discoverable root (an isolated cycle, or entirely edge-less) is seeded as
 * its own depth-0 root, in `sortOrder`, once the primary BFS is exhausted.
 * A same-depth collision pass (sort by `x`, push right in minimum-spacing
 * increments) guarantees no two nodes at the same depth ever overlap,
 * regardless of how many independent root chains share that depth — a
 * pinned node is never itself pushed (a persisted manual position must
 * never move), only unpinned siblings are shifted clear of it.
 *
 * `pinnedX` (usability fix — "layout and line geometry must agree"): a
 * node the caller marks pinned (its actual persisted userPositionX, i.e.
 * hasUserLayoutOverride) keeps that exact x here rather than getting a
 * synthetic depth-based one, AND every unpinned child's `baseX` is derived
 * from its parent's real position (pinned or computed) via the same
 * `xById` lookup either way. Without this, a child left unpositioned under
 * a manually-dragged parent would center itself on where the algorithm
 * *thinks* the parent is (a from-scratch, override-blind computation),
 * not where the parent actually renders — producing a visibly crooked
 * connector even though this function believed it had drawn a perfectly
 * straight one.
 */
export function computeLayeredGraphLayout(
  nodes: LayeredLayoutNode[],
  edges: LayeredLayoutEdge[],
  spacing: LayeredLayoutSpacing
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return result;

  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  for (const n of nodes) {
    childrenOf.set(n.id, []);
    parentsOf.set(n.id, []);
  }
  for (const e of edges) {
    if (!childrenOf.has(e.fromNodeId) || !parentsOf.has(e.toNodeId)) continue;
    childrenOf.get(e.fromNodeId)!.push(e.toNodeId);
    parentsOf.get(e.toNodeId)!.push(e.fromNodeId);
  }

  const sortedNodes = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder);
  const depthById = new Map<string, number>();
  const discoveryOrder: string[] = [];

  function seedAndBfs(rootId: string) {
    depthById.set(rootId, 0);
    const queue = [rootId];
    discoveryOrder.push(rootId);
    let qi = 0;
    while (qi < queue.length) {
      const id = queue[qi++];
      const d = depthById.get(id)!;
      for (const childId of childrenOf.get(id) ?? []) {
        if (depthById.has(childId)) continue;
        depthById.set(childId, d + 1);
        queue.push(childId);
        discoveryOrder.push(childId);
      }
    }
  }

  for (const n of sortedNodes) {
    if ((parentsOf.get(n.id)?.length ?? 0) === 0 && !depthById.has(n.id)) seedAndBfs(n.id);
  }
  // Any node still unreached (isolated cycle with no zero-indegree entry point) becomes its own root, in sortOrder.
  for (const n of sortedNodes) {
    if (!depthById.has(n.id)) seedAndBfs(n.id);
  }

  const maxDepth = Math.max(...discoveryOrder.map((id) => depthById.get(id)!));
  const nodesByDepth: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const id of discoveryOrder) nodesByDepth[depthById.get(id)!].push(id);

  const widthById = new Map<string, number>();
  for (const n of nodes) widthById.set(n.id, Number.isFinite(n.width) ? n.width : 0);

  // Pinned CENTER x, not the raw (left-edge) pinnedX — every downstream
  // comparison/inheritance in this function operates in center-x space.
  const pinnedXById = new Map<string, number>();
  for (const n of nodes) {
    if (typeof n.pinnedX === "number" && Number.isFinite(n.pinnedX)) {
      pinnedXById.set(n.id, n.pinnedX + (widthById.get(n.id) ?? 0) / 2);
    }
  }

  /** A persisted manual position is never pushed to resolve a same-depth collision — only its unpinned neighbors are. Shared by depth 0 (root seeding has no other collision guard of its own) and every deeper depth. */
  function resolveCollisions(idsAtDepth: string[]) {
    const order = [...idsAtDepth].sort((a, b) => centerXById.get(a)! - centerXById.get(b)!);
    for (let i = 1; i < order.length; i++) {
      if (pinnedXById.has(order[i])) continue;
      const minX = centerXById.get(order[i - 1])! + spacing.horizontal;
      if (centerXById.get(order[i])! < minX) centerXById.set(order[i], minX);
    }
  }

  const centerXById = new Map<string, number>();
  nodesByDepth[0].forEach((id, i) => centerXById.set(id, (i - (nodesByDepth[0].length - 1) / 2) * spacing.horizontal));
  for (const [id, x] of pinnedXById) if (depthById.get(id) === 0) centerXById.set(id, x);
  resolveCollisions(nodesByDepth[0]);

  for (let depth = 1; depth <= maxDepth; depth++) {
    const idsAtDepth = nodesByDepth[depth];
    const byParentKey = new Map<string, string[]>();
    for (const id of idsAtDepth) {
      const knownParents = (parentsOf.get(id) ?? []).filter((p) => centerXById.has(p));
      const key = knownParents.length > 0 ? knownParents.slice().sort().join(",") : `__root__${id}`;
      if (!byParentKey.has(key)) byParentKey.set(key, []);
      byParentKey.get(key)!.push(id);
    }
    for (const [key, ids] of byParentKey) {
      // A single child (the common vertical-continuation case) always
      // gets offset 0 here — it inherits the parent's center x exactly,
      // regardless of either node's width. No row-packing or width-based
      // heuristic ever moves a lone child sideways.
      const baseX = key.startsWith("__root__") ? 0 : key.split(",").reduce((sum, p) => sum + (centerXById.get(p) ?? 0), 0) / key.split(",").length;
      ids.forEach((id, i) => {
        const offset = (i - (ids.length - 1) / 2) * spacing.horizontal;
        centerXById.set(id, baseX + offset);
      });
    }
    // A pinned node's own center is never a synthetic fan-out value —
    // restore it now that the loop above may have overwritten it, same as
    // the depth-0 seeding above. Its children's baseX lookups next
    // iteration therefore always see the real center.
    for (const id of idsAtDepth) {
      const pinned = pinnedXById.get(id);
      if (pinned !== undefined) centerXById.set(id, pinned);
    }
    resolveCollisions(idsAtDepth);
  }

  for (const id of discoveryOrder) {
    const centerX = centerXById.get(id) ?? 0;
    const width = widthById.get(id) ?? 0;
    result.set(id, { x: centerX - width / 2, y: depthById.get(id)! * spacing.vertical });
  }
  return result;
}

/**
 * Round-3 straight-edge fix — whether a source/target pair's rendered
 * CENTER x are close enough to treat as a genuine vertical continuation,
 * the only condition under which a caller should draw an explicit
 * straight connector rather than falling through to its normal
 * (smoothstep/branch) routing. A small epsilon guards only against
 * floating-point drift from layout arithmetic (e.g.
 * computeLayeredGraphLayout above) — it is not a visual "close enough"
 * tolerance, and a non-finite input (an unknown/unresolved node) always
 * returns false, never a false positive.
 */
export function isAlignedVerticalConnection(sourceCenterX: number, targetCenterX: number): boolean {
  return Number.isFinite(sourceCenterX) && Number.isFinite(targetCenterX) && Math.abs(sourceCenterX - targetCenterX) < 0.5;
}

/** 세로 판정(isAlignedVerticalConnection)의 가로 짝 — 양 끝 핸들의 y가 사실상 같으면 가로 직선으로 그린다. 판정 기준·epsilon 모두 세로와 동일하다. */
export function isAlignedHorizontalConnection(sourceY: number, targetY: number): boolean {
  return Number.isFinite(sourceY) && Number.isFinite(targetY) && Math.abs(sourceY - targetY) < 0.5;
}

/**
 * 가로 직선 연결선 전용 핸들 id. 세로 흐름의 bottom-out/top-in과 별개로 두어,
 * 기존 라우팅(분기 핸들, 워크시트 간 이동 등)이 쓰는 id와 절대 겹치지 않는다.
 * 두 그래프(절차 편집기 / 케이스 플로우차트)가 같은 id를 쓴다.
 */
export const HORIZONTAL_HANDLE_IDS = {
  rightOut: "h-right-out",
  leftIn: "h-left-in",
  leftOut: "h-left-out",
  rightIn: "h-right-in",
} as const;

/** 기본(세로) 연결 핸들 — 지금까지 모든 일반 엣지가 쓰던 그 쌍이다. */
export const VERTICAL_HANDLE_IDS = { bottomOut: "bottom-out", topIn: "top-in" } as const;

export type ResolvedConnectionHandles = {
  sourceHandle: string;
  targetHandle: string;
  orientation: StraightenedConnectionOrientation;
};

/**
 * 두 노드의 실제 위치/크기로부터 "이 연결선을 세로로 붙일지 가로로 붙일지"와
 * 그에 맞는 핸들 쌍을 고른다. 지금까지 일반 엣지는 무조건 아래→위(bottom-out/
 * top-in)로 붙어서, 노드를 나란히 옆에 놓아도 선이 아래로 나갔다가 옆으로 도는
 * 계단 모양이 됐다 — 가로로 놓인 관계는 가로로 붙어야 직선이 된다.
 *
 * 판정은 중심 간 거리의 지배축이며, 동률(|dy| === |dx|)이면 세로다 —
 * computeStraightenedConnectedNodePosition("연결선 곧게 펴기")과 정확히 같은
 * 규칙이라, 곧게 편 결과와 선이 붙는 방향이 서로 어긋나지 않는다.
 *
 * 위치/크기를 알 수 없는 노드(아직 측정 전, 필터로 빠진 노드 등)는 언제나
 * 기존 동작 그대로 세로다 — 추측해서 옆으로 붙이지 않는다.
 */
export function resolveConnectionHandles(
  source: ConnectedNodeGeometry | null | undefined,
  target: ConnectedNodeGeometry | null | undefined
): ResolvedConnectionHandles {
  const vertical: ResolvedConnectionHandles = {
    sourceHandle: VERTICAL_HANDLE_IDS.bottomOut,
    targetHandle: VERTICAL_HANDLE_IDS.topIn,
    orientation: "VERTICAL",
  };
  if (!source || !target) return vertical;

  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return vertical;
  if (Math.abs(dy) >= Math.abs(dx)) return vertical;

  return dx > 0
    ? { sourceHandle: HORIZONTAL_HANDLE_IDS.rightOut, targetHandle: HORIZONTAL_HANDLE_IDS.leftIn, orientation: "HORIZONTAL" }
    : { sourceHandle: HORIZONTAL_HANDLE_IDS.leftOut, targetHandle: HORIZONTAL_HANDLE_IDS.rightIn, orientation: "HORIZONTAL" };
}
