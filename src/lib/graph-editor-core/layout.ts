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
