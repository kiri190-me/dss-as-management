/**
 * Phase 4A — layout-override resolution (원본 배치 vs 사용자 배치). Pure,
 * single source of truth for "which coordinate does this node actually
 * render at" — used by both the editor canvas and the DRAFT-vs-parent
 * diff's moved-node detection, so the two can never disagree about a
 * node's effective position.
 *
 * position_x/position_y are the immutable source-imported (or
 * parent-version-cloned) coordinates — 원본 배치 always renders these,
 * never the override. 사용자 배치 renders the override
 * (user_position_x/user_position_y) when present and valid, and falls back
 * to the source coordinate otherwise — "invalid" meaning anything that
 * isn't a finite number (null/undefined/NaN/±Infinity), so a corrupt or
 * not-yet-set override can never silently render a node at (NaN, NaN) or
 * off-canvas at infinity.
 */

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

/** True only when both override coordinates are present and valid — used to show "이 노드는 재배치되었습니다" state, distinct from "falls back to source". */
export function hasUserLayoutOverride(node: LayoutOverride): boolean {
  return isValidOverrideCoordinate(node.userPositionX) && isValidOverrideCoordinate(node.userPositionY);
}
