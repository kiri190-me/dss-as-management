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
 * cardinal directions — the pure math behind "상대 위치로 이동" and
 * "새 노드를 선택된 노드 아래에 추가". Domain-free: takes an already-resolved
 * reference position (the caller decides whether that's a node's source or
 * user-overridden position), no procedure/node-type concept here at all.
 *
 * 🔴 2026-11-05 — 이 함수를 부르는 곳은 이제 **수리건 플로우차트의
 * CaseFlowchartCreateNodePanel 하나뿐**이다. 절차 편집기의 두 패널
 * (NodePropertyPanel · CreateNodePanel)은 아래
 * computeCenterAlignedRelativePosition 으로 옮겨 갔다 — 높이가 다른 노드의
 * UP/DOWN 을 **중심 간 간격**으로 잡아야 하기 때문이다(그쪽 주석 참고).
 * 🔵 **그래서 이 함수는 안 고쳤다.** 수리건 플로우차트는 저장 좌표가 곧 화면
 * 자리라 지금 멀쩡히 동작하고, 여기를 고치면 이번 조각의 범위 밖인 그 화면까지
 * 조용히 바뀐다.
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
 * Same LEFT/RIGHT/UP/DOWN math as computeRelativePosition, except **네 방향
 * 전부를 노드의 중심점으로 잰다** — 사각형 대각선의 교차점, 곧
 * `(x + width/2, y + height/2)` 이다.
 *
 * LEFT/RIGHT: 세로 CENTER 를 맞춘다(raw top-left y 가 아니다) — 높이가 다른 두
 * 노드(여러 줄 제목, 다른 모양)를 나란히 놓았을 때 "y" 는 같아 보여도 중심이
 * 어긋나 연결선이 꺾인다.
 *
 * UP/DOWN: 가로 CENTER 를 맞추고, **세로 간격도 중심 간 간격**으로 잡는다 —
 * `targetCenterY = referenceCenterY ± spacing.vertical`.
 *
 * 🔴 2026-11-05 — UP/DOWN 의 세로가 전에는 `reference.y ± spacing.vertical`
 * (윗변 간 간격)이었다. 이름이 "center aligned" 인데 UP/DOWN 만 윗변 기준인 것이
 * 오히려 불일치였고, 실제로 어긋났다: 제목이 세 줄이라 높이가 82 인 노드와 52 인
 * 노드를 세로로 이으면 중심 간 거리가 150 이 아니라 165 가 됐다(브라우저 실측).
 * 🔵 **높이가 같으면 값이 한 픽셀도 안 바뀐다** — `ref.y + h/2 + v - h/2 =
 * ref.y + v`. 그래서 같은 모양·같은 줄 수의 노드만 쓰던 화면은 그대로다
 * (layout.test.ts 가 값으로 지킨다).
 *
 * Deliberately a NEW function, not a change to computeRelativePosition in
 * place — see that function's own doc comment for who still calls it and
 * why it stays as-is.
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
      return { x: referenceCenterX - target.width / 2, y: referenceCenterY - spacing.vertical - target.height / 2 };
    case "DOWN":
      return { x: referenceCenterX - target.width / 2, y: referenceCenterY + spacing.vertical - target.height / 2 };
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
 * `width`/`height` are the node's actual rendered size (e.g. from
 * computeNodeDimensions — nodes differ in both because a multiline title
 * needs more horizontal room AND more lines). Required so this function can
 * align nodes by their CENTER point — 사각형 대각선의 교차점, 곧
 * `(x + width/2, y + height/2)` — rather than by left edge / top edge.
 * React Flow's `position` is top-left-based, so two nodes sharing the same
 * `position.x` do NOT share the same center once their widths differ, and
 * their bottom/top handles (computed from each node's own center) would then
 * disagree too, producing a visibly bent connector despite `position.x`
 * matching. The same holds on the other axis for `position.y`.
 *
 * 🔴 `height` 는 **선택이 아니라 필수**다(2026-11-05). 안 넘겨도 되게 두면
 * 안 넘긴 자리에서 중심 정렬이 **오류 없이 조용히 안 된다** — 그것이 바로
 * 2026-11-05 에 고친 결함의 모양이었다(같은 줄에 선 높이 52 · 52 · 82 의 노드
 * 셋이 윗변만 0 으로 같고 중심은 26 · 26 · 41 로 갈려 있었다).
 */
export type LayeredLayoutNode = { id: string; sortOrder: number; width: number; height: number; pinnedX?: number | null };

/**
 * `continuesMainFlow` 는 「이 선이 **줄기의 계속**인가」다 — 참이면 그 자식이 한
 * 부모 밑에서 **부모의 중심 x 를 그대로 잇는 자리**(줄기)를 가져갈 1순위가 된다.
 * 뜻은 **부르는 쪽이 정한다**: 이 파일은 갈래 이름도 노드 종류도 모르고, 넘어온
 * 참/거짓만 쓴다(위 packNodesIntoRows 의 extraTrailingGap 과 같은 식이다 —
 * 도메인 지식은 부르는 쪽에 둔다). 절차 도메인이 무엇을 참으로 치는지는
 * procedure-auto-layout.ts 의 procedureBranchContinuesMainFlow 에 있다.
 *
 * 🔵 **안 넘겨도 된다.** 한 부모의 자식 가운데 참인 선이 하나도 없으면 넘어온
 * 차례의 **첫 자식**이 줄기가 된다 — 줄기가 아예 없는 경우는 만들지 않는다
 * (아래 computeLayeredGraphLayout 머리말의 「줄기 하나」 절 참고).
 */
/**
 * `sameRowBranch` 는 「이 자식을 **부모와 같은 줄**에 세우라」다 — 아래로 한 칸
 * 내려가는 대신 부모의 오른쪽에 나란히 선다. 뜻은 `continuesMainFlow` 와 마찬가지로
 * **부르는 쪽이 정한다**(절차 도메인은 NG·NO 를 참으로 친다 —
 * procedureBranchSitsOnParentRow).
 *
 * 🔵 **참이어도 안 올리는 경우가 셋** 있다(까닭은 sameRowBranchParentById 주석):
 * 합류점일 때 · 외동일 때 · 못 박힌 칸일 때.
 */
export type LayeredLayoutEdge = { fromNodeId: string; toNodeId: string; continuesMainFlow?: boolean; sameRowBranch?: boolean };
/**
 * `horizontal`/`vertical` 은 **중심 사이의 최소 거리**다 — 한 칸의 눈금.
 *
 * 🔴 `horizontalGap`/`verticalGap` 은 그 위에 얹는 **모서리에서 모서리까지 반드시
 * 남겨야 하는 빈 자리**다(2026-11-05 오후). 눈금만으로는 노드가 **포개진다** —
 * 눈금은 고정인데 노드 크기는 제목에 따라 제각각이기 때문이다(절차 도메인 실측:
 * 폭 132 ~ 527 — 🔵 527 은 **상한이 아니다**, 그쪽 폭에는 상한이 없다 · 높이는
 * 52 ~ 97 로 **상한이 있다**, 네 줄에서 잘린다). 이웃한 두 칸의 중심 거리는 이제
 * `max(눈금, (왼쪽 크기 + 오른쪽 크기) / 2 + 빈자리)` 다.
 *
 * 🔵 **안 넘겨도 된다 — 안 넘기면 0 이다.** 그때도 `(크기 합)/2` 는 그대로 걸리므로
 * **포개지지는 않는다**(모서리가 **맞닿는다**, 틈이 0 일 뿐이다 — 실측 확인).
 * 그래서 두 가지가 동시에 참이다:
 *  - 크기를 0 으로 넘기는 부르는 쪽(이 파일의 시험 대부분)은 `max(눈금, 0)` 이라
 *    **값이 전과 글자 그대로 같다.**
 *  - 실제 크기를 넘기면서 빈자리를 안 넘기면 **겹치지는 않되 숨 쉴 자리가 없다.**
 * 절차 도메인이 PROCEDURE_AUTO_LAYOUT_SPACING 에 값을 박아 두는 까닭이 뒤쪽이다.
 */
export type LayeredLayoutSpacing = { horizontal: number; vertical: number; horizontalGap?: number; verticalGap?: number };

/**
 * A minimal layered/hierarchical DAG layout. **자리는 두 축 모두 노드의
 * 중심점으로 센다**(사각형 대각선의 교차점) — 돌려주는 `x`/`y` 만 React Flow 의
 * 규약대로 좌상단으로 되돌린다.
 *
 * `y`: 그 노드의 **중심 y** 를 BFS 깊이가 정한다(뿌리 = 깊이 0). 깊이 사이 거리는
 * `max(spacing.vertical, (위 줄 최대높이 + 아래 줄 최대높이) / 2 + verticalGap)`
 * 이고(아래 「크기만큼 벌린다」 절), 돌려주는 값은 `중심 y - height / 2` 다.
 * 🔵 `verticalGap` 을 안 넘기면 예전 그대로 `깊이 × spacing.vertical` 이다.
 *
 * 🔴 2026-11-05 전에는 `y` 가 곧 `깊이 × spacing.vertical`(= **윗변** 기준)
 * 이었다. 높이가 모두 같을 때는 멀쩡해 보이지만, 제목이 여러 줄이라 높이가 다른
 * 노드가 한 줄에 섞이는 순간 중심이 갈린다 — 실측으로 같은 줄의 셋이 윗변은 전부
 * 0 인데 중심은 26 · 26 · 41 이었다. 🔵 깊이 0 의 `y` 가 음수(`-height/2`)가 되는
 * 것은 정상이다. `x` 는 전부터 음수가 나왔고 React Flow 는 음수 좌표를 문제없이
 * 다룬다. 높이가 모두 같은 그래프는 **전체가 `height/2` 만큼 위로 평행이동**할
 * 뿐 서로의 관계가 안 바뀐다.
 *
 * `x` 는 한 규칙을 따른다, 역시 CENTER 로 — 한 부모 밑의 자식 가운데 **언제나
 * 하나**(줄기)가 그 부모의 CENTER x 를 **그대로** 물려받고
 * (`childCenterX = parentCenterX`, converted back to the returned top-left
 * `x = childCenterX - childWidth / 2`), 나머지 형제는 그 오른쪽으로 한 칸씩
 * 비켜선다(그 「한 칸」은 눈금이 아니라 **이웃한 두 칸의 크기**가 정한다) —
 * 자세한 까닭과 실측값은 아래 「줄기 하나」· 「크기만큼 벌린다」 두 절에.
 * All internal arithmetic
 * (seeding, branch offsets, same-depth collision spacing) operates in
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
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 깊이 0(뿌리)의 가로 자리는 **왼쪽부터 한 칸씩**이다 (2026-11-05)
 * ──────────────────────────────────────────────────────────────────────
 * `centerX = i * spacing.horizontal` — `i` 는 그 노드가 뿌리 가운데 몇 번째로
 * 발견됐는가(= `sortOrder` 차례)다.
 *
 * 전에는 **가운데 대칭**이었다: `(i - (뿌리수 - 1) / 2) * spacing.horizontal`.
 * 뿌리가 하나 늘 때마다 분모가 바뀌어 **손도 안 댄 기존 뿌리가 전부
 * `spacing.horizontal / 2` 만큼 옆으로 밀렸다.** 브라우저 실측(눈금 280):
 * A 만 있을 때 A 의 x 는 −66, B 를 더하니 A 가 −206, C 를 더하니 −346 이 됐고,
 * A→C 선을 잇자(C 가 깊이 0 에서 빠지자) A 가 −206 으로 되돌아왔다. 사용자가
 * 「노드를 만들면 이상한 위치에 생기고, 연결선을 이으면 원래 자리로 돌아온다」고
 * 신고한 것이 이 한 줄이다.
 *
 * 왼쪽부터 쌓으면 새 노드는 `sortOrder` 가 가장 커서 맨 뒤에 붙고, **앞선
 * 노드들의 `i` 가 안 바뀌므로 아무도 안 움직인다.**
 *
 * 🔵 **남는 것 하나** — 선을 이어 어떤 노드가 깊이 0 에서 빠지면, 그 **뒤쪽**
 * 뿌리들의 `i` 가 하나씩 줄어 한 칸(`spacing.horizontal`)씩 당겨진다. 순수
 * 함수라 이전 배치를 기억할 수 없어서 그렇다 — 고치지 않았고, 시험이 「이렇게
 * 동작한다」를 값으로 적어 두고 있다.
 *
 * 🔵 대가: 기존 절차의 그림이 **통째로 오른쪽으로 한 번 이동**한다(서로의 위치
 * 관계는 그대로다). 2026-11-05 에 받아들이기로 한 값이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 한 부모 밑에서 **줄기 하나**는 부모의 중심을 그대로 잇는다 (2026-11-05 오후)
 * ──────────────────────────────────────────────────────────────────────
 * 자식이 여럿일 때 전에는 **부모 중심을 기준으로 좌우 대칭**으로 폈다:
 * `offset = (i - (자식수 - 1) / 2) * spacing.horizontal`. 자식이 둘이면 −140 과
 * +140 이라 **아무도 부모의 열에 안 남는다.** 판단 노드가 한 번 나올 때마다 줄기가
 * 반 칸씩 옆으로 밀리고, 그것이 쌓여 그림이 **왼쪽 위에서 오른쪽 아래로 비스듬한
 * 띠**가 됐다. 측정(눈금 280, 판단 20개가 연달아 서고 각자 NG 가지를 하나씩 내는
 * 표본, 🔵 **폭을 0 으로** 두어 줄기가 어디로 가는지만 본 값이다 — 아래 「크기만큼
 * 벌린다」 절의 숫자와는 재는 것이 다르다): 줄기 22칸이 **서로 다른 x 를 21개**
 * 쓰고 그림의 가로 폭이 **2940** 이었다.
 * 엑셀 원본은 반대로 주 흐름이 **왼쪽 한 열에 고정**되고 분기만 오른쪽으로 뻗는다.
 *
 * 지금은 한 부모 밑 자식을 이렇게 세운다:
 *  - **줄기 하나**가 `offset = 0` — 부모의 중심 x 를 그대로 잇는다. 누가 줄기인지는
 *    `continuesMainFlow` 가 참인 첫 자식, 하나도 없으면 **넘어온 차례의 첫 자식**이다
 *    (줄기가 없는 경우는 만들지 않는다 — 그러면 아무도 부모의 열에 안 남아 예전
 *    대각선으로 되돌아간다).
 *  - 나머지 형제는 줄기에서 시작해 **오른쪽으로만** 한 칸씩 간다. 🔵 그 「한 칸」은
 *    눈금의 배수가 **아니다** — 바로 왼쪽 형제와 이 형제의 **크기**가 정한다
 *    (아래 「크기만큼 벌린다」 절 · minCenterDistanceX). 2026-11-05 오후에
 *    `1·2·3… × spacing.horizontal` 이던 것을 그렇게 바꿨다.
 *
 * 🔴 **오른쪽으로만** 가는 것이 핵심이다. 왼쪽으로도 보내면 줄기보다 왼쪽에 노드가
 * 생기고, 충돌 풀기(resolveCollisions)는 **왼쪽에서 오른쪽으로 밀기** 때문에 그
 * 노드가 줄기를 오른쪽으로 밀어낸다 — 고치려던 대각선이 그 길로 되돌아온다.
 * 전부 오른쪽이면 줄기가 그 깊이의 가장 왼쪽이라 **밀릴 상대가 없다.**
 *
 * 🔵 덤 — 형제가 하나 늘어도 **기존 형제가 안 움직인다**(새 자식은 맨 오른쪽에만
 * 붙는다). 대칭으로 펴던 때는 자식이 둘에서 셋이 되면 기존 둘이 140px 씩 밀렸고,
 * 그것이 2026-11-04 에 「채택하는 순간 22개가 전부 움직인다」로 신고된 모양이다.
 *
 * 🔵 대가: 전체 그림이 **오른쪽으로 치우친다**(줄기가 왼쪽 끝에 서므로). 그리고
 * 분기 열이 같은 깊이에서 겹치면 충돌 풀기가 더 오른쪽으로 밀어 **그림이 가로로
 * 넓어질 수** 있다 — 다만 밀리는 것은 가지뿐이고 줄기는 안 밀린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **합류점**의 기준 열은 평균이 아니라 **줄기 쪽 부모**다 (2026-11-05 오후)
 * ──────────────────────────────────────────────────────────────────────
 * 부모가 여럿인 칸(가지가 줄기로 되돌아와 만나는 자리)의 기준 열은 전부터
 * **알고 있는 부모들의 중심 평균**이었다. 줄기(0)와 가지(280)가 만나면 140 —
 * 눈금의 절반만큼 어긋난 자리이고, 그 아래로 줄기가 통째로 따라간다. 다음
 * 다이아몬드가 또 140 을 보태므로 **합류할 때마다 반 칸씩 밀리는 대각선**이 된다.
 * 측정(눈금 280, 두 팔 길이가 같은 다이아몬드 10개): 줄기가 서로 다른 x 를
 * **11개** 쓰고 가로 폭이 **1540** 이었다 — 위의 줄기 규칙만으로는 안 풀린다.
 *
 * 그래서 합류점은 **줄기 선(`continuesMainFlow`)으로 들어온 부모의 열**을 쓴다.
 * 그런 부모가 없을 때만 전처럼 평균이다 — 힌트를 안 주는 부르는 쪽의 값은 한
 * 픽셀도 안 바뀐다.
 *
 * 🔵 합류점이 여러 부모에게서 줄기 선을 받으면 **id 차례로 첫 부모**를 쓴다.
 * 차례가 정해져 있으니 같은 입력이면 늘 같은 그림이다.
 *
 * 🔴 **여기서 고른 부모가 가지 쪽일 수 있다.** 되돌아오는 선이 이름 없는 선
 * (DEFAULT)이면 그 선도 「줄기」로 쳐지기 때문이다 — 들여온 절차에서 흔한 모양이고,
 * 그러면 합류점이 가지의 열로 가 그 아래 줄기가 통째로 따라갔다(실측: 다이아몬드
 * 8개에서 줄기가 **서로 다른 열을 9개** 썼다).
 *
 * 🟢 **2026-11-05 밤에 풀렸다** — 「메인줄기」 절이 생기면서다. 합류점이 사슬 위에
 * 있으면 부모가 누구든 **제 뿌리의 열에 못 박히므로**, 여기서 어느 부모를 고르든
 * 줄기는 한 열에 남는다. 사슬 밖의 합류점에만 이 차례가 쓰인다.
 * 🔵 그날 저녁에 이 자리에 「고치려면 가장 왼쪽 부모로 — 가로 규칙이라 안 했다」고
 * 적어 두었는데, **실제로 고친 길은 그것이 아니었다**(열을 고르는 대신 사슬을 못
 * 박았다). 그리고 실측해 보니 기전도 하나가 아니었다 — 「줄기 고르기가 NG 로 들어온
 * 칸을 뽑는 것」이 여섯 번 중 넷의 원인이었다(mainChainIds 주석).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이웃 사이는 **그 둘의 크기만큼** 벌린다 (2026-11-05 오후)
 * ──────────────────────────────────────────────────────────────────────
 * 눈금(`spacing.horizontal`/`vertical`)은 **고정값**인데 노드 크기는 제목에 따라
 * 제각각이다. 그래서 눈금만으로 자리를 잡으면 **넓은 노드끼리 포개진다** — 절차
 * 도메인 실측(눈금 280): 폭 527 짜리 둘이 나란히 서면 **247px 이 겹친다.**
 * 사용자 신고: 「노드끼리 겹쳐서 보이기도 하고, 연결선이 노드에 겹쳐 있어서
 * 가시성이 좋지 않아」. 측정(판단 20개 · 제목이 전부 긴 표본): **포개진 쌍 19개**,
 * 가장 깊이 포갠 곳이 **268px** 이었다.
 *
 * 이제 이웃한 두 칸의 **중심 거리**는 이렇다:
 *   가로: `max(spacing.horizontal, (왼쪽 폭 + 오른쪽 폭) / 2 + horizontalGap)`
 *   세로: `max(spacing.vertical, (위 줄 최대높이 + 아래 줄 최대높이) / 2 + verticalGap)`
 *
 * 🔴 **가로는 두 자리**가 이 자를 쓴다 — 가지를 오른쪽에 놓는 자리와 **충돌 풀기**.
 * 둘의 무게가 다르다(실측으로 하나씩 눈금으로 되돌려 보았다):
 *  - **충돌 풀기**가 겹침을 실제로 막는다. 거기만 눈금으로 되돌리면 표본에서 바로
 *    포개진다.
 *  - **가지 놓기**는 「놓는 자리부터 맞게」 두는 쪽이다. 되돌려도 뒤따르는 충돌
 *    풀기가 겹침은 고쳐 주지만, 나오는 **좌표가 달라진다**(표본에서 477.5 ↔ 1152.5).
 * 🔵 **깊이 0 의 뿌리 쌓기는 일부러 눈금 그대로다** — 거기에도 걸어 봤지만 바로
 * 뒤의 충돌 풀기가 같은 값을 내서 한 픽셀도 안 달라졌다. 까닭은 그 자리 주석에
 * (「두 길이 같은 값을 내면 한쪽은 죽은 코드가 된다」).
 * 🔴 **세로는 줄(깊이) 단위**라 그 줄에서 **가장 높은 노드**로 잰다. 한 노드만 보고
 * 정하면 같은 줄의 더 높은 이웃이 아래 줄을 뚫는다.
 *
 * 🔵 **이웃끼리** 재고, 「그 깊이의 최대 폭으로 열을 통일」하지 않는다. 통일하면
 * 열은 가지런해지지만 가장 넓은 노드 하나가 **그래프 전체**를 벌려 놓는다(실측
 * 표본에서 527 짜리 하나가 모든 열을 그만큼 넓힌다). 이웃끼리 재면 꼭 필요한
 * 만큼만 벌어지고, **줄기는 어차피 부모의 열을 그대로 물려받으므로**(위 절)
 * 간격이 쌍마다 달라도 **한 열에 곧게 선다** — 가지런함을 잃는 것은 가지 쪽뿐이다.
 *
 * 🔵 「이웃끼리만 재면 멀리 있는 쌍이 포개지지 않나」 — 안 포개진다. 중심 x 로
 * 줄을 세우면 `A < B < C` 일 때 `거리(A,C) = 거리(A,B) + 거리(B,C) ≥
 * (wA+wB)/2 + (wB+wC)/2 ≥ (wA+wC)/2` 이므로, 이웃 쌍만 지켜도 전체가 지켜진다.
 *
 * 🔵 못 박힌 칸(pinnedX)은 여전히 **안 밀린다.** 벌어지는 것은 그 이웃뿐이다.
 *
 * 🔵 빈자리를 **안 넘겨도 겹침은 사라진다**(크기 절반 합이 그대로 걸린다 —
 * 모서리가 맞닿을 뿐이다). 빈자리는 「안 겹치게」가 아니라 「숨 쉴 자리를
 * 얼마나 둘까」를 정하는 값이다.
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
  /**
   * 자식 id → 그 자식에게 **줄기 선**을 보낸 부모들. 두 가지에 쓴다:
   *  - 열쇠가 있는가(= 줄기로 들어오는 선을 하나라도 가졌는가) → 한 부모 밑에서
   *    누가 부모의 열을 그대로 잇는지(offset 0)를 고른다.
   *  - 값 안에 어떤 부모가 있는가 → 부모가 여럿인 합류점의 기준 열을 고른다.
   * 둘 다 **고르기**에만 쓴다 — 여기 없다고 자리가 사라지지는 않는다.
   *
   * 🔵 모르는 노드로 가는 선은 childrenOf/parentsOf 와 **같은 잣대로** 걸러
   * 낸다. 한쪽만 거르면 「선은 무시됐는데 줄기 표시는 남는」 칸이 생긴다.
   */
  const mainFlowParentIds = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!childrenOf.has(e.fromNodeId) || !parentsOf.has(e.toNodeId)) continue;
    childrenOf.get(e.fromNodeId)!.push(e.toNodeId);
    parentsOf.get(e.toNodeId)!.push(e.fromNodeId);
    if (!e.continuesMainFlow) continue;
    if (!mainFlowParentIds.has(e.toNodeId)) mainFlowParentIds.set(e.toNodeId, new Set());
    mainFlowParentIds.get(e.toNodeId)!.add(e.fromNodeId);
  }

  const sortedNodes = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder);
  const depthById = new Map<string, number>();
  const discoveryOrder: string[] = [];
  /**
   * **처음 발견한 부모** — BFS 가 지나가며 만드는 뻗어나간 나무(spanning forest)다.
   * 세로 자리를 「부분나무가 쓴 높이」로 셀 때 이 나무를 탄다(아래 「세로는 깊이가
   * 아니라」 절).
   *
   * 🔴 **고리를 끊는 자리가 여기다.** 되돌아가는 선(LOOP_BACK·RETRY)은 이미 발견된
   * 노드를 가리키므로 `depthById.has(childId)` 에 걸려 **나무에 안 들어온다.** 그래서
   * 높이 셈이 그 선을 타고 되돌아가 끝없이 내려가는 일이 없다 — 깊이 셈이 무한 루프에
   * 안 빠지는 것과 **같은 한 줄**이 막아 준다.
   */
  const treeParentById = new Map<string, string>();

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
        treeParentById.set(childId, id);
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

  // 높이도 폭과 똑같이 「모르면 0」이다 — 0 이면 중심 보정이 0 이라 윗변 기준과
  // 같은 값이 나온다. 즉 못 재어 온 칸만 전처럼 서고, 나머지는 중심으로 선다.
  const heightById = new Map<string, number>();
  for (const n of nodes) heightById.set(n.id, Number.isFinite(n.height) ? n.height : 0);

  // Pinned CENTER x, not the raw (left-edge) pinnedX — every downstream
  // comparison/inheritance in this function operates in center-x space.
  const pinnedXById = new Map<string, number>();
  for (const n of nodes) {
    if (typeof n.pinnedX === "number" && Number.isFinite(n.pinnedX)) {
      pinnedXById.set(n.id, n.pinnedX + (widthById.get(n.id) ?? 0) / 2);
    }
  }

  /**
   * 🔴 **메인줄기** — 뿌리마다, 거기서 **줄기 선만 따라 내려간 하나의 사슬**이다
   * (2026-11-05 밤). 「묶음마다 고른 줄기」와는 다른 것이고, 더 센 것이다:
   *  - 한 부모 밑에서 누가 부모의 열을 잇는지 고를 때 **1순위**다.
   *  - 충돌 풀기에서 **안 밀린다**(못 박힌 칸 다음가는 대접).
   *
   * 🔴 **왜 필요한가** — 묶음별로만 고르면 「이 묶음의 줄기」가 **진짜 메인줄기가
   * 아닐 수 있다.** 실측(`[RFG] 통전검사(3상입력)` 89칸): 한 부모 밑 자식 둘 가운데
   * **NG 로 들어온 쪽**이 「딴 데서 줄기 선을 하나라도 받았다」는 이유로 부모의 열을
   * 가져가고, 정작 이 부모에서 DEFAULT 로 이어진 **진짜 주 흐름이 옆으로 밀렸다.**
   * 그렇게 여섯 번 밀려 줄기가 **서로 다른 열을 7개** 썼다(0 → 489.5 → 719.5 →
   * 856.5 → 1596.5 → 2674.5 → 2976.5). 「이 선이 줄기냐」만 보면 **어느 선 하나로는
   * 사슬을 못 고른다** — 사슬 전체를 봐야 한다.
   *
   * 🔵 사슬은 **다음 칸을 하나만** 고른다(줄기 선이 여럿이면 넘어온 첫 선). 그래야
   * 사슬이 갈라지지 않고 한 열이 된다. 이미 지나온 칸을 다시 만나면 멈춘다 —
   * 되돌아가는 선이 있어도 무한 루프가 안 난다.
   */
  /** 그 노드의 나무 자식들. 넘어온 차례(= childrenOf 차례)를 그대로 지킨다. */
  const treeChildrenOf = new Map<string, string[]>();
  for (const id of discoveryOrder) {
    const parent = treeParentById.get(id);
    if (parent === undefined) continue;
    if (!treeChildrenOf.has(parent)) treeChildrenOf.set(parent, []);
    treeChildrenOf.get(parent)!.push(id);
  }

  const mainChainIds = new Set<string>();
  /** 사슬 칸 → 그 사슬이 시작한 뿌리. 열을 그 뿌리의 열로 못 박는 데 쓴다. */
  const mainChainRootById = new Map<string, string>();
  for (const rootId of nodesByDepth[0]) {
    let cur: string | undefined = rootId;
    while (cur !== undefined && !mainChainIds.has(cur)) {
      mainChainIds.add(cur);
      mainChainRootById.set(cur, rootId);
      const here: string = cur;
      cur = (childrenOf.get(here) ?? []).find((childId) => mainFlowParentIds.get(childId)?.has(here));
    }
  }

  // 빈자리는 「안 넘기면 0」이다 — 폭·높이와 같은 규칙이다. 🔵 0 이어도 크기 절반
  // 합은 그대로 걸리므로 **겹치지는 않는다**(모서리가 맞닿을 뿐). 값이 전과 글자
  // 그대로 같아지는 것은 **크기를 0 으로 넘길 때**다(그러면 늘 눈금이 이긴다).
  const horizontalGap = Number.isFinite(spacing.horizontalGap) ? (spacing.horizontalGap as number) : 0;
  const verticalGap = Number.isFinite(spacing.verticalGap) ? (spacing.verticalGap as number) : 0;

  /**
   * 🔴 **부모와 같은 줄에 세울 자식** → 그 부모 (2026-11-05 밤).
   *
   * 사용자 지시: 「[NG]로 연결되는 노드는 **수평으로 배치**되도록 해줘」. 원본 엑셀
   * 실측이 그 모양을 뒷받침한다 — 열한 시트의 분기 193개를 도형 좌표로 세니
   * **NG 97개 중 94개가 부모의 오른쪽**, 그 가운데 **87개가 같은 줄**이었다.
   * 반대로 **정상 96개 중 같은 줄은 0개**다(아래로 내려간다).
   *
   * 🔵 참으로 들어와도 **안 올리는 경우가 셋**이다:
   *  ① **합류점**(들어오는 선이 둘 이상) — 부모 줄로 끌어올리면 **다른 부모보다
   *     위로** 올라가 선이 거슬러 올라간다. 실제 데이터에서 97개 중 4개가 여기다.
   *  ② **외동**(그 부모의 나무 자식이 하나뿐) — 올릴 자리가 곧 줄기 자리라 부모와
   *     **같은 줄·같은 열**이 되어 포갠다. 실제 데이터에서 2개가 여기다.
   *  ③ **못 박힌 칸** — 사람이 끌어다 놓은 자리가 가장 세다(줄기보다도 위다).
   *
   * 🔴 ④ **한 부모에 하나만** 올린다. 올린 칸은 제 부분나무를 부모의 줄에서부터
   * 아래로 펼치는데, 그 자리는 **앞서 놓인 형제가 이미 쓴 줄**일 수 있다. 둘을
   * 올리면 두 부분나무가 같은 줄들을 나눠 쓰게 되고, 가로 충돌 풀기는 **같은
   * 깊이**끼리만 보므로 그 둘을 못 떼어 놓는다 — 퍼즈에서 실제로 포갰다. 그래서
   * **맨 먼저 놓는 한 칸**만 올리고, 둘째부터는 평소대로 아래로 내려간다.
   */
  const sameRowBranchParentById = new Map<string, string>();
  {
    const takenByParent = new Set<string>();
    // 🔵 **자식 차례**로 훑는다(선 차례가 아니다) — 아래 placeSubtree 가 맨 앞에
    //    세우는 칸과 같은 칸을 골라야 한다.
    for (const [parentId, children] of treeChildrenOf) {
      for (const childId of children) {
        if (takenByParent.has(parentId)) break;
        const lifted = edges.some((e) => e.sameRowBranch === true && e.fromNodeId === parentId && e.toNodeId === childId);
        if (!lifted) continue;
        if ((parentsOf.get(childId) ?? []).length !== 1) continue;
        if (children.length < 2) continue;
        if (pinnedXById.has(childId)) continue;
        sameRowBranchParentById.set(childId, parentId);
        takenByParent.add(parentId);
      }
    }
  }

  /**
   * 가로로 이웃한 두 칸의 **중심 사이 최소 거리**. 눈금과 「두 폭의 절반 합 +
   * 빈자리」 중 큰 쪽이다 — 좁은 칸끼리는 전처럼 눈금대로 서고, 넓은 칸이 끼면
   * 그만큼만 벌어진다.
   *
   * 🔴 이 함수를 쓰는 곳은 **두 자리**다 — 가지 놓기와 충돌 풀기. 그 가운데
   * **충돌 풀기**에서 눈금을 직접 쓰면 거기서 그대로 포개진다(실측).
   *
   * 🔵 **깊이 0 의 뿌리 쌓기는 일부러 안 쓴다.** 거기에도 걸어 봤지만 바로 뒤에
   * resolveCollisions 가 돌아 **값이 한 픽셀도 안 달라졌다** — 그래서 되돌렸다.
   * 까닭은 그 자리(`nodesByDepth[0].forEach…`) 주석에 적어 두었다. 「왜 깊이 0 만
   * 빠졌지」를 다시 조사하지 않아도 되게 여기서 먼저 가리킨다.
   */
  function minCenterDistanceX(leftId: string, rightId: string): number {
    const halves = (widthById.get(leftId) ?? 0) / 2 + (widthById.get(rightId) ?? 0) / 2;
    return Math.max(spacing.horizontal, halves + horizontalGap);
  }

  /** A persisted manual position is never pushed to resolve a same-depth collision — only its unpinned neighbors are. Shared by depth 0 (root seeding has no other collision guard of its own) and every deeper depth. */
  function resolveCollisions(idsAtDepth: string[]) {
    const order = [...idsAtDepth].sort((a, b) => centerXById.get(a)! - centerXById.get(b)!);
    for (let i = 1; i < order.length; i++) {
      if (pinnedXById.has(order[i])) continue;
      /**
       * 🔴 **메인줄기는 가지에게 안 밀린다** — 사용자가 「**기준이 되는** 메인줄기」
       * 라고 했다. 기준이면 밀리는 쪽은 언제나 가지여야 한다.
       *
       * 미는 쪽이 누구냐에 따라 셋으로 갈린다:
       *  - **못 박힌 칸**이면 줄기가 비켜선다. 사람이 끌어다 놓은 자리가 가장 세다.
       *  - **다른 뿌리의 줄기**면 비켜선다. 나무끼리는 서로의 기준이 아니다
       *    (뿌리 둘이 나란히 설 때 이 줄이 없으면 둘 다 안 밀려 간격 규칙이
       *    조용히 깨진다 — 시험이 값으로 잡는다).
       *  - **같은 뿌리의 줄기**거나 **가지**면 안 비켜선다. 같은 사슬의 두 칸이
       *    같은 깊이에 떨어지는 일이 실제로 있고(통전검사의 지름길), 그때 서로
       *    밀어내면 한 열이 깨진다. 🔵 같은 열에 둘이 서도 세로가 한 칸에
       *    하나씩이라 안 포갠다.
       */
      const previousIsOtherChain =
        mainChainRootById.has(order[i - 1]) && mainChainRootById.get(order[i - 1]) !== mainChainRootById.get(order[i]);
      if (mainChainIds.has(order[i]) && !pinnedXById.has(order[i - 1]) && !previousIsOtherChain) continue;
      const minX = centerXById.get(order[i - 1])! + minCenterDistanceX(order[i - 1], order[i]);
      if (centerXById.get(order[i])! < minX) centerXById.set(order[i], minX);
    }
  }

  /** 한 부모 밑에서 **부모의 열을 그대로 이은 칸**들. 아래 세로 셈이 그대로 쓴다. */
  const trunkNodeIds = new Set<string>();
  const centerXById = new Map<string, number>();
  // 🔴 **왼쪽부터 한 칸씩.** 가운데 대칭(`(i - (뿌리수 - 1) / 2) * 눈금`)이면
  //    뿌리가 하나 늘 때마다 기존 뿌리가 전부 눈금의 절반만큼 밀린다 —
  //    까닭과 실측값은 이 함수의 머리말에.
  // 🔵 여기는 **눈금 그대로** 쌓는다. 넓은 뿌리끼리 눈금으로는 포개지지만, 바로
  //    아래 resolveCollisions 가 **같은 minCenterDistanceX 로** 벌려 주므로 결과가
  //    같다 — 실측으로 확인했다(여기만 크기 규칙으로 바꿔 놔도 값이 한 픽셀도 안
  //    달라졌고, 거꾸로 여기만 눈금으로 되돌려도 시험이 하나도 안 깨졌다).
  //    🔴 그래서 **일부러 안 고쳤다**: 두 길이 같은 값을 내면 한쪽은 아무도 못
  //    지키는 죽은 코드가 된다.
  nodesByDepth[0].forEach((id, i) => centerXById.set(id, i * spacing.horizontal));
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
      // heuristic ever moves a lone child sideways. 🔵 형제가 여럿일 때도
      // **줄기 하나**는 똑같이 offset 0 이다(아래) — 외동일 때만의 특례가 아니다.
      const parents = key.startsWith("__root__") ? [] : key.split(",");
      // 🔴 자식이 여럿이어도 **하나는 반드시 부모의 열에 남는다**(offset 0).
      //    줄기로 들어오는 선이 있으면 그 자식이, 하나도 없으면 첫 자식이다 —
      //    「아무도 안 남는」 경우를 만들면 머리말의 대각선으로 되돌아간다.
      // 🔴 **메인줄기가 1순위다.** 그 다음이 「줄기 선을 하나라도 받은 칸」,
      //    마지막이 넘어온 첫 자식이다. 2026-11-05 밤 전에는 둘째 규칙만 있었고,
      //    그래서 NG 로 들어온 칸이 부모의 열을 가져가는 일이 생겼다(mainChainIds 주석).
      // 🔴 그리고 **부모와 같은 줄에 설 가지는 줄기로 안 뽑는다** — 줄기는 부모의
      //    **열**을 그대로 쓰므로, 같은 줄로까지 끌어올리면 **같은 열·같은 줄**이
      //    되어 부모와 포갠다(퍼즈에서 실제로 났다).
      const trunkId =
        ids.find((id) => mainChainIds.has(id) && !sameRowBranchParentById.has(id)) ??
        ids.find((id) => mainFlowParentIds.has(id) && !sameRowBranchParentById.has(id)) ??
        ids.find((id) => !sameRowBranchParentById.has(id)) ??
        ids[0];
      // 🔵 자식이 **전부** 같은 줄 가지인 드문 경우에만 마지막 받침(ids[0])으로 온다.
      //    그때는 그 칸의 끌어올리기를 취소한다 — 줄기 자리가 먼저다.
      sameRowBranchParentById.delete(trunkId);
      // 세로 셈이 **가로와 똑같은 줄기 판정**을 쓰도록 여기서 적어 둔다. 따로
      // 고르면 「가로로는 가지인데 세로로는 줄기」인 칸이 생긴다.
      trunkNodeIds.add(trunkId);
      // 🔴 부모가 여럿인 칸(가지가 줄기로 **되돌아오는 합류점**)의 기준 열 —
      //    줄기 선으로 들어온 부모가 있으면 **그 부모의 열**이다. 평균을 쓰면
      //    합류할 때마다 눈금의 절반씩 밀린다(머리말의 다이아몬드 참고).
      const trunkParent = parents.find((p) => mainFlowParentIds.get(trunkId)?.has(p));
      const baseX =
        parents.length === 0
          ? 0
          : trunkParent !== undefined
            ? centerXById.get(trunkParent) ?? 0
            : parents.reduce((sum, p) => sum + (centerXById.get(p) ?? 0), 0) / parents.length;
      // 🔵 가지는 줄기에서 시작해 **왼쪽 이웃과의 거리를 하나씩 더해** 간다 —
      //    눈금의 배수가 아니라 **그 쌍의 폭**이 한 칸의 크기다(머리말 참고).
      let previousSiblingId = trunkId;
      let branchCenterX = baseX;
      for (const id of ids) {
        if (id === trunkId) {
          centerXById.set(id, baseX);
          continue;
        }
        // 🔴 **오른쪽으로만.** 왼쪽에 형제를 두면 충돌 풀기가 그 형제를 통해
        //    줄기를 오른쪽으로 밀어낸다(머리말 참고).
        branchCenterX += minCenterDistanceX(previousSiblingId, id);
        // 🔴 **부모와 같은 줄에 설 가지는 부모와도 거리를 지켜야 한다**
        //    (2026-11-05 밤). 위 거리는 **형제**와만 잰 것이라 부모의 폭을 안 본다 —
        //    폭 527 짜리 부모가 제 NG 자식과 그대로 포갠다. 같은 줄에 세우는 순간
        //    부모–자식도 「이웃한 두 칸」이 되므로 같은 자로 한 번 더 잰다.
        const rowParentId = sameRowBranchParentById.get(id);
        if (rowParentId !== undefined) {
          const rowParentCenterX = centerXById.get(rowParentId);
          if (rowParentCenterX !== undefined) {
            branchCenterX = Math.max(branchCenterX, rowParentCenterX + minCenterDistanceX(rowParentId, id));
          }
        }
        centerXById.set(id, branchCenterX);
        previousSiblingId = id;
      }
    }
    /**
     * 🔴 **메인줄기는 제 뿌리의 열에 못 박는다** (2026-11-05 밤). 부모에게서
     * 물려받는 것이 아니라 **값으로 박는다** — 그래야 한 열이 **셈으로 보장**된다.
     *
     * 물려받기만으로는 안 되는 경우가 실제로 있다: 사슬의 두 칸이 **같은 깊이**에
     * 떨어질 수 있다. `[RFG] 통전검사(3상입력)` 에서 「FAN 회전 확인」이 이름 없는
     * 선 둘을 내는데, 하나는 48V 갈래로 돌아가고 다른 하나는 그 갈래 끝(「FAN 풍절음
     * 확인」)으로 **질러간다.** BFS 는 지름길을 타고 그 칸을 깊이 9 에 놓지만 사슬
     * 차례로는 13번째다 — 같은 깊이에 사슬 칸이 둘이면 **「한 자식만 부모의 열」**
     * 규칙으로는 둘 다 열에 둘 수 없다. 못 박으면 둘 다 그 열에 선다.
     * 🔵 같은 열에 둘이 서도 **안 포갠다** — 세로가 한 칸에 하나씩이기 때문이다.
     */
    for (const id of idsAtDepth) {
      const chainRoot = mainChainRootById.get(id);
      if (chainRoot === undefined) continue;
      const rootCenterX = centerXById.get(chainRoot);
      if (rootCenterX !== undefined) centerXById.set(id, rootCenterX);
    }
    // A pinned node's own center is never a synthetic fan-out value —
    // restore it now that the loop above may have overwritten it, same as
    // the depth-0 seeding above. Its children's baseX lookups next
    // iteration therefore always see the real center.
    // 🔴 **못 박힌 칸이 메인줄기를 이긴다** — 위 줄기 못 박기보다 **뒤에** 둔다.
    for (const id of idsAtDepth) {
      const pinned = pinnedXById.get(id);
      if (pinned !== undefined) centerXById.set(id, pinned);
    }
    resolveCollisions(idsAtDepth);
  }

  /** 세로로 이웃한(부모–자식) 두 칸의 **중심 사이 최소 거리**. 가로의 minCenterDistanceX 와 같은 자다. */
  function minCenterDistanceY(upperId: string, lowerId: string): number {
    const halves = (heightById.get(upperId) ?? 0) / 2 + (heightById.get(lowerId) ?? 0) / 2;
    return Math.max(spacing.vertical, halves + verticalGap);
  }

  // ── 세로 자리 ────────────────────────────────────────────────────────────
  const centerYById = new Map<string, number>();
  /**
   * 한 노드와 그 **부분나무 전체**를 세운다. 돌려주는 값은 그 부분나무가 쓴
   * **아랫변**(가장 아래 칸의 아래 끝)이다.
   *
   * 차례가 전부다: **가지를 먼저, 줄기를 맨 마지막**에 놓고, 뒤에 놓는 것은 언제나
   * 앞서 놓인 것들의 아랫변 아래로 내려 보낸다. 그래서 줄기의 다음 칸이 **그 사이에
   * 낀 가지가 차지한 높이만큼** 내려간다 — 엑셀 원본의 모양이다.
   *
   * 🔵 되돌이(재귀) 깊이는 노드 수를 못 넘는다. 이 그림의 최대 규모(400여 칸)에서
   * 문제가 없고, 고리는 나무에 안 들어오므로 끝없이 내려가지도 않는다.
   */
  function placeSubtree(id: string, centerY: number): number {
    centerYById.set(id, centerY);
    let bottom = centerY + (heightById.get(id) ?? 0) / 2;
    const children = treeChildrenOf.get(id) ?? [];
    // 🔴 줄기는 **가로와 같은 판정**(trunkNodeIds)으로 고른다. 여럿이면 첫째만
    //    줄기로 치고 나머지는 가지로 돌린다 — 한 부모 밑 자식이 서로 다른 부모
    //    묶음에 속하면 둘 다 제 묶음의 줄기일 수 있기 때문이다(드물다).
    const trunkChild = children.find((childId) => trunkNodeIds.has(childId));
    const branches = trunkChild === undefined ? [...children] : children.filter((childId) => childId !== trunkChild);
    // 🔴 **부모 줄로 올릴 칸을 맨 앞에** 세운다. 그 칸만 `bottom` 이 아직 부모의
    //    아랫변일 때 놓이고, 뒤따르는 형제는 그 부분나무 **아래**로 쌓인다 —
    //    그래야 두 부분나무가 같은 줄을 나눠 쓰지 않는다(위 ④ 주석).
    const lifted = branches.filter((childId) => sameRowBranchParentById.get(childId) === id);
    const rest = branches.filter((childId) => sameRowBranchParentById.get(childId) !== id);
    const ordered = trunkChild === undefined ? [...lifted, ...rest] : [...lifted, ...rest, trunkChild];
    for (const childId of ordered) {
      // 🔴 **부모와 같은 줄에 서는 가지**(NG)는 아래로 안 내려간다 — 부모의 중심 y
      //    를 그대로 쓴다. 가로는 sameRowBranchParentById 가 부모와의 거리까지
      //    지켜 두었으므로 포개지 않는다.
      // 🔵 **그 가지 아래로는 평소대로** 내려간다 — 바뀌는 것은 그 한 칸의 줄뿐이고,
      //    제 자식들은 재귀가 그대로 처리한다. 그리고 그 부분나무의 아랫변이
      //    `bottom` 에 반영되므로 **줄기는 여전히 그 밑**으로 간다.
      const childCenterY =
        sameRowBranchParentById.get(childId) === id
          ? centerY
          : Math.max(
              // ① 제 부모보다는 반드시 한 칸 아래
              centerY + minCenterDistanceY(id, childId),
              // ② 그리고 **앞서 놓인 형제의 부분나무 전체**보다 아래
              bottom + verticalGap + (heightById.get(childId) ?? 0) / 2
            );
      bottom = Math.max(bottom, placeSubtree(childId, childCenterY));
    }
    return bottom;
  }

  /**
   * 🔴 **뿌리도 세로로 쌓는다** — 둘째 뿌리의 나무는 첫째 나무가 쓴 높이 아래에서
   * 시작한다. 자식들을 쌓는 규칙과 글자 그대로 같은 셈이다.
   *
   * 전처럼 뿌리를 전부 중심 y 0 에 두면 **서로 다른 나무가 같은 줄을 나눠 쓰게**
   * 되고, 가로 충돌 풀기는 **같은 깊이**끼리만 보기 때문에 「같은 줄 · 같은 열 ·
   * 다른 깊이」인 쌍을 못 막는다. 무작위 그래프 4000개로 재어 보니 뿌리가 둘 이상일
   * 때 **포개진 쌍이 294개** 나왔고, 뿌리를 하나로 묶으면 **0개**였다 — 겹침이
   * 전부 나무 사이에서 났다는 뜻이다.
   *
   * 🟢 쌓고 나면 **어떤 두 칸도 같은 줄에 안 선다**(한 나무 안에서는 차례가
   * 엄격히 늘어나고, 나무끼리는 아예 떨어져 있다). 그래서 세로가 겹칠 일이 없고,
   * 가로가 어떻든 **포개짐이 구조적으로 불가능**해진다.
   *
   * 🔵 대가: 뿌리가 여럿인 절차의 그림이 **세로로 길어진다.** 사용자가 「멀리
   * 띄어져 있어도 괜찮다」고 한 범위 안이라고 보고 받아들였다. 가로 자리는 전과
   * 같다 — 뿌리는 여전히 왼쪽부터 한 칸씩이다(2026-11-05 오전 결정).
   */
  let previousRootId: string | null = null;
  let forestBottom = 0;
  for (const rootId of nodesByDepth[0]) {
    const rootCenterY =
      previousRootId === null
        ? 0
        : Math.max(
            (centerYById.get(previousRootId) ?? 0) + minCenterDistanceY(previousRootId, rootId),
            forestBottom + verticalGap + (heightById.get(rootId) ?? 0) / 2
          );
    forestBottom = placeSubtree(rootId, rootCenterY);
    previousRootId = rootId;
  }

  for (const id of discoveryOrder) {
    const centerX = centerXById.get(id) ?? 0;
    const width = widthById.get(id) ?? 0;
    // 🔴 세로도 가로와 **같은 자**다: 위에서 정한 것은 그 노드의 **중심 y** 이고,
    //    돌려주는 값만 React Flow 의 좌상단 규약으로 되돌린다. 윗변을 맞추면
    //    높이가 다른 이웃과 중심이 갈린다(머리말의 26 · 26 · 41).
    const centerY = centerYById.get(id) ?? 0;
    const height = heightById.get(id) ?? 0;
    result.set(id, { x: centerX - width / 2, y: centerY - height / 2 });
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
