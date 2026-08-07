/**
 * Phase 4B — pure waypoint math for manual edge-route editing. Nothing
 * here touches the DB or React/ReactFlow; both the mutation layer
 * (server-side validation) and the editor UI (client-side interaction)
 * call into this module, so the two can never disagree about what a
 * "valid" or "effective" route looks like. Mirrors
 * procedure-template-layout.ts's override/fallback convention exactly:
 * `user_route_points = null` always means "use deterministic routing."
 */

export type RoutePoint = { x: number; y: number };

/** Hard cap on the *persisted* (post-normalization) point count per edge — a deliberately small, human-editable limit, not a performance ceiling. */
export const MAX_ROUTE_POINTS = 50;

/** Defensive cap on *raw* input length, checked before any per-point work — guards against pathological payloads well before the business-rule MAX_ROUTE_POINTS check even runs. */
const MAX_RAW_INPUT_LENGTH = 500;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Exactly `{x: number, y: number}` — no extra keys. The "no React Flow
 * internal objects stored" requirement means this must reject a raw RF
 * node/handle/position object (which typically carries `id`, `type`,
 * `data`, etc. alongside x/y), not just check that x/y happen to be
 * present.
 */
export function isValidRoutePoint(v: unknown): v is RoutePoint {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  if (keys.length !== 2 || !keys.includes("x") || !keys.includes("y")) return false;
  const { x, y } = v as { x: unknown; y: unknown };
  return isFiniteNumber(x) && isFiniteNumber(y);
}

/** Drops a point that is identical to the immediately preceding one — normalization, not rejection, per this task's explicit choice. */
function dedupeAdjacent(points: RoutePoint[]): RoutePoint[] {
  const result: RoutePoint[] = [];
  for (const p of points) {
    const last = result[result.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) result.push(p);
  }
  return result;
}

export type SanitizeRoutePointsResult = { ok: true; points: RoutePoint[] | null } | { ok: false; message: string };

/**
 * The single validation/normalization gate every route-point array passes
 * through before it can be persisted (called server-side, unconditionally,
 * regardless of what the client already checked). `null`/`undefined`/an
 * empty array/an all-duplicates array all normalize to `null` ("no
 * override") — the column's meaning must never drift into "an empty array
 * means something different from no override."
 */
export function sanitizeRoutePoints(input: unknown): SanitizeRoutePointsResult {
  if (input === null || input === undefined) return { ok: true, points: null };
  if (!Array.isArray(input)) return { ok: false, message: "경로점은 순서가 있는 배열이어야 합니다." };
  if (input.length === 0) return { ok: true, points: null };
  if (input.length > MAX_RAW_INPUT_LENGTH) {
    return { ok: false, message: `경로점은 최대 ${MAX_ROUTE_POINTS}개까지 지정할 수 있습니다.` };
  }

  for (const p of input) {
    if (!isValidRoutePoint(p)) {
      return { ok: false, message: "유효하지 않은 경로점이 포함되어 있습니다 (x/y는 유한한 숫자여야 합니다)." };
    }
  }

  const points = dedupeAdjacent(input as RoutePoint[]);
  if (points.length > MAX_ROUTE_POINTS) {
    return { ok: false, message: `경로점은 최대 ${MAX_ROUTE_POINTS}개까지 지정할 수 있습니다.` };
  }
  return { ok: true, points: points.length > 0 ? points : null };
}

export type EditorLayoutMode = "SOURCE" | "USER" | "STAGE_SORTED";

/**
 * Waypoints are coordinate-space-dependent on the node layout they were
 * drawn against, so they only ever apply in 사용자 배치 (USER) — never in
 * 원본 배치 or 단계별 정렬, exactly mirroring how node dragging itself is
 * scoped. Every other layout mode always renders through the unchanged
 * deterministic routing regardless of what's stored.
 */
export function resolveEffectiveEdgeRoute(edge: { userRoutePoints: RoutePoint[] | null | undefined }, layoutMode: EditorLayoutMode): RoutePoint[] | null {
  if (layoutMode !== "USER") return null;
  const points = edge.userRoutePoints;
  if (!points || points.length === 0) return null;
  return points;
}

/** True only when a real, renderable override exists — distinct from "falls back to deterministic routing." */
export function hasManualRoute(edge: { userRoutePoints: RoutePoint[] | null | undefined }): boolean {
  return !!edge.userRoutePoints && edge.userRoutePoints.length > 0;
}

function distanceToSegment(p: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Inserts `insertAt` into `points` at whichever segment of the full chain
 * (source -> points... -> target) it sits closest to — the double-click
 * shortcut's insertion rule (this task's "additional shortcut", never the
 * only way to add a point). Nearest-segment projection, not raw click
 * position vs. every point, so a click anywhere along a long segment still
 * inserts in the right place.
 */
export function insertWaypointAtSegment(points: RoutePoint[], source: RoutePoint, target: RoutePoint, insertAt: RoutePoint): RoutePoint[] {
  const chain = [source, ...points, target];
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < chain.length - 1; i++) {
    const d = distanceToSegment(insertAt, chain[i], chain[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  const next = [...points];
  next.splice(bestIndex, 0, insertAt);
  return next;
}

/**
 * The primary insertion method (explicit "경로점 추가" button, no click
 * position available) — inserts at the midpoint of the single longest
 * segment in the chain, a deterministic, always-sensible default.
 */
export function addWaypointAtDefaultPosition(points: RoutePoint[], source: RoutePoint, target: RoutePoint): RoutePoint[] {
  const chain = [source, ...points, target];
  let bestIndex = 0;
  let bestLengthSq = -1;
  for (let i = 0; i < chain.length - 1; i++) {
    const dx = chain[i + 1].x - chain[i].x;
    const dy = chain[i + 1].y - chain[i].y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq > bestLengthSq) {
      bestLengthSq = lengthSq;
      bestIndex = i;
    }
  }
  const mid = { x: (chain[bestIndex].x + chain[bestIndex + 1].x) / 2, y: (chain[bestIndex].y + chain[bestIndex + 1].y) / 2 };
  const next = [...points];
  next.splice(bestIndex, 0, mid);
  return next;
}

/** Updates exactly one waypoint's coordinates — never touches edge endpoints, never reorders. Out-of-range index is a no-op (defensive; the UI never produces one). */
export function moveWaypoint(points: RoutePoint[], index: number, next: RoutePoint): RoutePoint[] {
  if (index < 0 || index >= points.length) return points;
  const result = [...points];
  result[index] = next;
  return result;
}

/** Removing the last remaining waypoint returns `null` — "clearing manual waypoints restores deterministic automatic routing" is this function's own natural result, not a separate special case the caller has to detect. */
export function removeWaypoint(points: RoutePoint[], index: number): RoutePoint[] | null {
  if (index < 0 || index >= points.length) return points.length > 0 ? points : null;
  const result = points.filter((_, i) => i !== index);
  return result.length > 0 ? result : null;
}

/** Structural equality treating `null` and an empty/absent array as the same "no override" state — the single comparison both dirty-tracking and diffing should use, so they can never disagree about whether a route "really" changed. */
export function routePointsEqual(a: RoutePoint[] | null | undefined, b: RoutePoint[] | null | undefined): boolean {
  const an = a && a.length > 0 ? a : null;
  const bn = b && b.length > 0 ? b : null;
  if (an === null && bn === null) return true;
  if (an === null || bn === null) return false;
  if (an.length !== bn.length) return false;
  return an.every((p, i) => p.x === bn[i].x && p.y === bn[i].y);
}
