/**
 * 도형·연결선의 **그림판 절대 좌표**(EMU)를 drawing XML 에서 읽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 칸(col/row) 좌표로는 안 되는가 — 실측으로 갈린 자리
 * ──────────────────────────────────────────────────────────────────────
 * `ooxml-parser.ts` 의 `parseDrawing` 은 `<xdr:from>`·`<xdr:to>` 의 **칸 번호만**
 * 읽고 그 안의 `colOff`·`rowOff`(칸 안쪽 오프셋)는 버린다. 칸 하나가 1cm 넘게
 * 넓은 시트에서는 그 버림이 치명적이다.
 *
 * 2026-11-05 에 실제 흐름도 한 장으로 재 봤다. 「판단」 상자 하나에서 두 선이
 * 나가고 각각에 분기 레이블 상자가 떠 있는, 가장 흔한 모양이다. 칸 좌표의
 * 중점끼리 거리를 재면(= 기존 extract-shape-graph.ts 의 방식) **레이블 둘이
 * 똑같은 선 하나에 붙는다.** 다른 쪽 선은 레이블을 못 받고, 받은 쪽은 나중에
 * 들어온 레이블로 덮어써진다. 오류는 한 번도 안 난다 — 그래서 들여온 결과를
 * 열어 보기 전에는 아무도 모른다.
 *
 * 같은 두 레이블을 이 모듈의 EMU 좌표로, 선의 **중점이 아니라 선분까지의 거리**로
 * 재면 둘 다 제 선에 붙는다(실측 거리 비 1:1.5 · 1:3.9 로 여유 있게 갈린다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 칸 폭·행 높이를 몰라도 된다
 * ──────────────────────────────────────────────────────────────────────
 * 엑셀은 도형마다 `<xdr:spPr><a:xfrm><a:off x y/><a:ext cx cy/>` 에 **이미 계산된
 * 절대 좌표**를 함께 적어 둔다. 그래서 워크시트의 `<cols width>`·`<row ht>` 를
 * 파싱해 칸을 픽셀로 환산하는(글꼴에 따라 달라져 근사밖에 안 되는) 일이 아예
 * 필요 없다. 한 시트 안의 모든 도형이 같은 좌표계에 있으므로 서로의 거리는 정확하다.
 *
 * 🔴 **기존 파서를 고치지 않는다.** `ooxml-parser.ts` 는 기존 들여오기 경로가
 * 그대로 쓰는 파일이라 칸 하나도 건드리지 않고, 필요한 것만 여기서 따로 읽는다.
 * 두 벌을 읽게 되지만 읽기 전용이고, 같은 XML 을 두 번 훑는 비용은 시트당 수십 ms 다.
 */

/** 한 도형/연결선의 절대 좌표. 단위는 EMU(914400 EMU = 1 inch = 96 px). */
export type DrawingGeometry = {
  /** `<xdr:cNvPr id>` — 연결선의 `stCxn`/`endCxn` 가 가리키는 바로 그 번호다. */
  id: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  /** `<a:xfrm flipH="1">` — 선이 상자 안에서 **오른쪽 위 → 왼쪽 아래**로 그려진다. */
  flipH: boolean;
  /** `<a:xfrm flipV="1">` — 선이 상자 안에서 **왼쪽 아래 → 오른쪽 위**로 그려진다. */
  flipV: boolean;
};

export type Point = { x: number; y: number };

/** EMU → 픽셀(96 DPI). 노드의 화면 좌표를 만들 때 쓴다. */
export const EMU_PER_PIXEL = 9525;

const ANCHOR_RE = /<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)(?:[^>]*)>([\s\S]*?)<\/xdr:\1>/g;
const CNVPR_ID_RE = /<xdr:cNvPr id="(\d+)"/;
/**
 * `<a:ext uri="...">`(확장 메타데이터)와 헷갈리지 않는다 — 이쪽은 `cx=` 로 시작하는
 * 크기 전용 요소다. `<a:off>` 는 음수가 될 수 있어 부호를 받는다.
 */
const XFRM_RE =
  /<a:xfrm([^>]*)>\s*<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(-?\d+)" cy="(-?\d+)"\s*\/>/;

/**
 * drawing XML 한 장에서 **도형 번호 → 절대 좌표** 표를 만든다.
 *
 * 🔵 그림(`xdr:pic`)도 함께 담는다. 흐름도 옆에 붙은 설명 그림이 본문 영역 계산에
 * 끼면 안 되므로 거르는 일은 부르는 쪽이 하지만, 「거기에 무엇이 있었는지」를
 * 보고하려면 좌표가 있어야 한다.
 *
 * 🔴 `<a:xfrm>` 이 없는 앵커는 **표에 안 담는다**(빈 좌표로 0,0 에 두면 모든 거리
 * 계산이 조용히 틀린다). 부르는 쪽이 「좌표를 못 읽은 도형」으로 보고해야 한다.
 */
export function parseDrawingGeometry(xml: string | null): Map<string, DrawingGeometry> {
  const byId = new Map<string, DrawingGeometry>();
  if (!xml) return byId;

  let anchorMatch: RegExpExecArray | null;
  ANCHOR_RE.lastIndex = 0;
  while ((anchorMatch = ANCHOR_RE.exec(xml))) {
    const body = anchorMatch[2];
    const idMatch = body.match(CNVPR_ID_RE);
    if (!idMatch) continue;
    const xfrmMatch = body.match(XFRM_RE);
    if (!xfrmMatch) continue;
    const attrs = xfrmMatch[1] ?? "";
    byId.set(idMatch[1], {
      id: idMatch[1],
      x: Number(xfrmMatch[2]),
      y: Number(xfrmMatch[3]),
      cx: Number(xfrmMatch[4]),
      cy: Number(xfrmMatch[5]),
      flipH: /\bflipH="(?:1|true)"/.test(attrs),
      flipV: /\bflipV="(?:1|true)"/.test(attrs),
    });
  }
  return byId;
}

export function geometryCenter(g: Pick<DrawingGeometry, "x" | "y" | "cx" | "cy">): Point {
  return { x: g.x + g.cx / 2, y: g.y + g.cy / 2 };
}

/**
 * 연결선이 제 상자 안에서 실제로 **어느 꼭짓점에서 어느 꼭짓점으로** 그려지는지.
 *
 * 엑셀은 선을 「상자 + 뒤집기 두 개」로 적는다. 뒤집기를 안 보면 ↘ 로 가는 선과
 * ↗ 로 가는 선이 같은 선분으로 읽혀, 레이블이 엉뚱한 선에 붙는다.
 */
export function connectorSegment(g: DrawingGeometry): { start: Point; end: Point } {
  const left = g.x;
  const right = g.x + g.cx;
  const top = g.y;
  const bottom = g.y + g.cy;
  return {
    start: { x: g.flipH ? right : left, y: g.flipV ? bottom : top },
    end: { x: g.flipH ? left : right, y: g.flipV ? top : bottom },
  };
}

/** 점에서 선분까지의 최단 거리. 선분 **밖**으로 떨어진 점은 가까운 끝점까지로 잰다. */
export function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // 선분을 0~1 로 매개화하고 그 바깥은 잘라 낸다 — 자르지 않으면 선을 무한히
  // 늘린 직선까지의 거리가 되어, 선분이 끝난 한참 뒤의 글상자도 가깝게 나온다.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * 점에서 직사각형까지의 거리(안에 있으면 0).
 *
 * 꺾인 연결선(`bentConnector*`)에 쓴다 — 실제 경로는 ㄱ 자 꺾임이라 선분 하나가
 * 아니지만, 그 경로는 **반드시 제 상자 안**에 있다. 그래서 상자까지의 거리는 참
 * 거리보다 **항상 작거나 같다**(과소평가). 과대평가하면 맞는 레이블을 놓치지만
 * 과소평가는 잘못 붙을 뿐이라, 경쟁 후보와의 차이를 함께 보고해 사람이 가리게 한다.
 */
export function distancePointToRect(p: Point, g: Pick<DrawingGeometry, "x" | "y" | "cx" | "cy">): number {
  const dx = Math.max(g.x - p.x, 0, p.x - (g.x + g.cx));
  const dy = Math.max(g.y - p.y, 0, p.y - (g.y + g.cy));
  return Math.hypot(dx, dy);
}
