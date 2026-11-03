/**
 * 이 건에서 더한 작업이 **그림의 어디에 서는가**(2026-11-03, 조각 14).
 * 순수 함수만 — DOM 도 React 도 DB 도 건드리지 않는다
 * (procedure-execution-minimap.ts · procedure-execution-case-edit.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가 (사용자 말 그대로, 2026-11-03)
 * ──────────────────────────────────────────────────────────────────────
 * 「노드를 추가하면 현재 선택한 노드를 기준으로 상하좌우 어디에 위치시킬지
 *  선택할 수 있도록 해주고, 노드를 드래그로 옮길 수 있도록 해줘.」
 *
 * 조각 13 까지 더한 작업은 **언제나 앞 칸 오른쪽**이었다. 자리를 저장할 칸이
 * 없어서 볼 때마다 다시 셌기 때문이다(getExecutionDetail 의 placeAddedGraphNodes).
 * 조각 14 에서 procedure_case_execution_nodes 에 user_position_x/y 가 생겼고,
 * **사람이 정한 자리**는 거기 적힌다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 눈금을 **여기 한 곳에만** 적는다
 * ──────────────────────────────────────────────────────────────────────
 * ADDED_NODE_GAP_X / ADDED_NODE_GAP_Y 는 원래 조회 파일(server-only)의 상수였다.
 * 이제 **화면도 같은 눈금으로 센다** — 「고른 작업의 오른쪽」을 화면이 계산해
 * 보내므로, 두 곳에 같은 숫자를 따로 적으면 한쪽만 고치는 날이 온다. 그때
 * 생기는 어긋남은 오류를 하나도 안 내고 **자리만 조금 다른** 그림으로 나타나서
 * 아무도 신고하지 않는다.
 *
 * 🔵 새 숫자를 만들지 않았다. 방향 넷이 전부 이 둘로만 움직이고, 「겹쳤다」를
 * 재는 잣대도 이 둘에서 나눠 쓴다(아래).
 */

/** 앞 칸에서 **가로로** 띄우는 거리. 절차 편집기의 「상대 위치로 이동」과 같은 눈금이다. */
export const ADDED_NODE_GAP_X = 300;
/** 앞 칸에서 **세로로** 띄우는 거리. 편집기의 세로 간격과 같다. */
export const ADDED_NODE_GAP_Y = 150;

/**
 * 「고른 작업을 기준으로 **어느 쪽**에 놓는가」.
 *
 * 🔵 네 값뿐이고 **기울어진 방향은 없다.** 절차 그림의 선은 위아래·좌우로만
 * 붙으므로(resolveConnectionHandles), 대각선에 놓으면 이어 붙인 선이 반드시
 * 꺾인다 — 고를 수 있게 해 봐야 아무도 안 고를 자리다.
 */
export const EXTRA_TASK_DIRECTION_CODES = ["RIGHT", "LEFT", "DOWN", "UP"] as const;
export type ExtraTaskDirection = (typeof EXTRA_TASK_DIRECTION_CODES)[number];

/**
 * 화면에 적는 이름. 🔴 「오른쪽」이 맨 앞인 까닭: 그것이 **조각 13 까지의
 * 동작**이고, 기본값이 지금까지와 같아야 아무 생각 없이 [작업 추가]를 누른
 * 사람이 전과 같은 결과를 얻는다.
 */
export const extraTaskDirectionLabels: Record<ExtraTaskDirection, string> = {
  RIGHT: "오른쪽",
  LEFT: "왼쪽",
  DOWN: "아래",
  UP: "위",
};

export function isExtraTaskDirection(value: unknown): value is ExtraTaskDirection {
  return typeof value === "string" && (EXTRA_TASK_DIRECTION_CODES as readonly string[]).includes(value);
}

export type GraphPoint = { x: number; y: number };

/**
 * 한 걸음에 움직이는 양. 방향마다 **한 축만** 움직인다.
 *
 * 🔴 「아래」가 +y 인 까닭: 이 그림의 세로축은 화면 좌표라 아래로 갈수록 커진다
 * (React Flow 의 좌표계 그대로다). 수학 좌표로 착각해 부호를 뒤집으면 「아래」가
 * 위로 간다 — 오류는 안 나고 화면에서만 드러난다.
 */
const DIRECTION_STEP: Record<ExtraTaskDirection, GraphPoint> = {
  RIGHT: { x: ADDED_NODE_GAP_X, y: 0 },
  LEFT: { x: -ADDED_NODE_GAP_X, y: 0 },
  DOWN: { x: 0, y: ADDED_NODE_GAP_Y },
  UP: { x: 0, y: -ADDED_NODE_GAP_Y },
};

/**
 * **겹쳤다고 보는 거리** — 간격의 절반이다.
 *
 * 🔵 새 숫자가 아니라 위 두 눈금에서 나눠 쓴다. 칸 사이가 한 걸음의 절반보다
 * 가까우면 사람 눈에는 포개진 것으로 보인다 — 칸 하나의 가로폭이 눈금(300)과
 * 비슷하게 잡혀 있기 때문이다(computeNodeDimensions).
 *
 * 🔴 **정확히 같은 자리**만 세면 안 된다. 원본 절차에서 들여온 좌표는 눈금에
 * 안 맞는 아무 값이라(엑셀 도형의 자리 그대로다), 「x 가 1 다르다」만으로 빈
 * 자리로 판정하면 두 칸이 거의 완전히 겹친 그림이 나온다.
 */
const OVERLAP_X = ADDED_NODE_GAP_X / 2;
const OVERLAP_Y = ADDED_NODE_GAP_Y / 2;

/**
 * 같은 방향으로 몇 걸음까지 비켜 볼 것인가.
 *
 * 🔴 뚜껑이 필요한 까닭은 **안 멈추는 고리**를 막기 위해서다 — 입력이 이상하면
 * (예: 같은 자리에 수백 칸) 빈자리를 영영 못 찾는다. 뚜껑에 닿으면 마지막
 * 후보를 그냥 쓴다. 겹친 칸 하나가 못 만든 작업보다 낫다.
 *
 * 🔵 실측(2026-11-03): 게시된 두 절차의 노드가 23·28개이고 한 칸에 붙는 형제는
 * 많아야 둘이라, 이 뚜껑에 닿는 길이 지금은 없다.
 */
const MAX_NUDGE_STEPS = 24;

/**
 * 좌표로 받아 줄 수 있는 범위. 🔴 쓰기 쪽이 화면에서 온 수를 믿지 않기 위한
 * 울타리다 — 오래된 탭이나 손으로 만든 요청이 1e308 같은 수를 보내면 그림이
 * 통째로 한 점으로 쪼그라들고, 사람이 화면에서 되돌릴 길이 없다(그 칸을 다시
 * 찾아 끌어야 하는데 보이질 않는다).
 */
export const EXTRA_TASK_POSITION_LIMIT = 1_000_000;

/** 하나의 좌표로 쓸 수 있는 수인가 — 유한하고 울타리 안인가. */
export function isUsableGraphCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= EXTRA_TASK_POSITION_LIMIT;
}

export function isUsableGraphPoint(value: unknown): value is GraphPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as { x?: unknown; y?: unknown };
  return isUsableGraphCoordinate(point.x) && isUsableGraphCoordinate(point.y);
}

/** 두 칸이 사람 눈에 포개져 보이는가. */
function overlaps(a: GraphPoint, b: GraphPoint): boolean {
  return Math.abs(a.x - b.x) < OVERLAP_X && Math.abs(a.y - b.y) < OVERLAP_Y;
}

/**
 * 고른 작업(`base`)을 기준으로 **한 걸음** 떨어진 자리를 돌려준다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 겹치면 **같은 방향으로 더 간다** — 비키지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * 그 자리에 이미 칸이 있으면 한 걸음 더, 또 있으면 또 한 걸음 — 방향은 그대로
 * 둔다. 옆으로 비키는(예: 오른쪽이 막히면 오른쪽 아래로) 길도 생각했지만 안
 * 골랐다: 사람이 고른 것은 **「오른쪽」이라는 방향**이고, 자리가 모자란다고
 * 해서 아래로 내려가면 고른 것과 다른 답이 나온다. 한 줄로 늘어선 결과는
 * 적어도 「내가 고른 쪽으로 갔다」가 눈에 보인다.
 *
 * 🔴 **겹친 채로 두지는 않는다.** 같은 자리에 둘을 놓으면 칸이 포개져 **하나로
 * 보이고**, 「등록했는데 안 생겼다」가 된다 — 조각 13 이 선에 안 닿은 작업을
 * 세로로 쌓은 것도 같은 까닭이다(placeAddedGraphNodes 의 그 자리 주석).
 *
 * `occupied` 는 **지금 그림에 서 있는 모든 칸**의 자리를 받는다. 템플릿 칸까지
 * 넣어야 한다 — 더한 작업끼리만 안 겹치는 것으로는 원본 칸 위에 올라앉는 것을
 * 못 막는다.
 */
export function placeExtraTaskByDirection(input: {
  base: GraphPoint;
  direction: ExtraTaskDirection;
  occupied: readonly GraphPoint[];
}): GraphPoint {
  const step = DIRECTION_STEP[input.direction];
  let candidate: GraphPoint = { x: input.base.x + step.x, y: input.base.y + step.y };

  for (let nudged = 0; nudged < MAX_NUDGE_STEPS; nudged += 1) {
    if (!input.occupied.some((taken) => overlaps(candidate, taken))) return candidate;
    candidate = { x: candidate.x + step.x, y: candidate.y + step.y };
  }
  return candidate;
}
