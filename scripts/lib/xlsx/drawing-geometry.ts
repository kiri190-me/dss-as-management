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

/**
 * `<a:xfrm rot>` — 상자를 **제 가운데를 축으로** 돌린 각. 단위는 1/60000 도
 * (90° = 5400000). 적혀 있지 않으면 0.
 *
 * 🔴 **2026-11-05 에 이 칸을 안 읽어서 틀렸다.** `off`·`ext` 는 **돌리기 전**의
 * 상자다 — 엑셀은 꺾인 연결선을 그릴 때 세로로 선 상자를 90°·270° 돌려 눕히는
 * 일이 아주 잦고, 그때 `off`·`ext` 만 읽으면 **가로·세로가 뒤바뀐 엉뚱한 상자**가
 * 나온다. 실측으로 `(7)원복 검사 및 개선 작업` 의 연결선 225개 중 **38개**가
 * 돌아가 있었고(90°18 · 270°17 · 180°3), 그 탓에 분기 이름이 엉뚱한 선에 붙어
 * 구조 오류 28건이 났다.
 *
 * 🔵 180°는 상자가 그대로이고 **그려지는 차례만 뒤집힌다**(flip 둘을 함께 뒤집은
 * 것과 같다). 그래서 거리에는 영향이 없지만 「어느 끝이 시작인가」는 달라진다.
 */
export type DrawingRotation = { rot: number };

export type Point = { x: number; y: number };

/** EMU → 픽셀(96 DPI). 노드의 화면 좌표를 만들 때 쓴다. */
export const EMU_PER_PIXEL = 9525;

import { decodeXmlEntities } from "@/lib/xlsx/xml-entities";

const ANCHOR_RE = /<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)(?:[^>]*)>([\s\S]*?)<\/xdr:\1>/g;
const CNVPR_ID_RE = /<xdr:cNvPr id="(\d+)"/;
/**
 * `<a:ext uri="...">`(확장 메타데이터)와 헷갈리지 않는다 — 이쪽은 `cx=` 로 시작하는
 * 크기 전용 요소다. `<a:off>` 는 음수가 될 수 있어 부호를 받는다.
 */
const XFRM_RE =
  /<a:xfrm([^>]*)>\s*<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(-?\d+)" cy="(-?\d+)"\s*\/>/;

/** 묶음 안의 자식 좌표를 바깥 좌표로 옮기는 변환(아래 `GROUP_XFRM_RE` 참고). */
type GroupTransform = { offX: number; offY: number; chOffX: number; chOffY: number; sx: number; sy: number };

/**
 * 묶음(`<xdr:grpSp>`)의 `<a:xfrm>` — 바깥 자리(`off`·`ext`)와 **자식 좌표계**
 * (`chOff`·`chExt`)가 함께 적힌다.
 */
const GROUP_XFRM_RE =
  /<a:xfrm[^>]*>\s*<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(-?\d+)" cy="(-?\d+)"\s*\/>\s*<a:chOff x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:chExt cx="(-?\d+)" cy="(-?\d+)"\s*\/>/;

/** `<xdr:sp>`·`<xdr:cxnSp>`·`<xdr:pic>` 한 덩이(묶음 안이든 밖이든). */
const OBJECT_RE = /<xdr:(sp|cxnSp|pic)(?:\s[^>]*)?>([\s\S]*?)<\/xdr:\1>/g;

/** `<a:gd name="adj2" fmla="val 37500"/>` — 꺾임점 조절값. 이름의 숫자가 몇 번째인지 말해 준다. */
const ADJUST_VALUE_RE = /<a:gd name="adj(\d+)" fmla="val (-?\d+)"\s*\/>/g;

/** 그림판 위의 도형 하나 — 글자·연결 정보까지 함께. */
export type DrawingObject = DrawingGeometry &
  DrawingRotation & {
    kind: "shape" | "connector" | "picture";
    /** `<a:prstGeom prst>` — 곧은 선인지 꺾인 선인지 가릴 때 쓴다. */
    geom: string | null;
    /**
     * `<a:prstGeom><a:avLst><a:gd name="adj1" fmla="val 50000"/>` — 꺾인 선이 **어디서
     * 꺾이는지**를 정하는 값들(0번이 adj1). 10만분율이고, 없으면 프리셋 기본값 50000
     * (= 한가운데)이다. 이 값을 안 읽으면 꺾임점이 늘 한가운데로 가정되어, 한쪽으로
     * 치우쳐 꺾인 선의 경로가 통째로 틀어진다.
     */
    adjustValues: number[];
    /** 도형 안의 글자. 문단(`<a:p>`) 사이가 줄바꿈이고 조각(`<a:r>`) 사이는 아니다. */
    text: string;
    /** `<a:stCxn id>` — 이 선이 나가는 도형 번호. 비어 있을 수 있다(손으로 그린 선). */
    stCxnId: string | null;
    /** `<a:endCxn id>` — 이 선이 닿는 도형 번호. 비어 있을 수 있다. */
    endCxnId: string | null;
    /** 🔵 묶음 안에 있던 것인가 — 드라이런이 「묶음을 풀었다」를 보여 줄 수 있게. */
    inGroup: boolean;
  };

export type DrawingObjects = {
  objects: DrawingObject[];
  /** `<a:xfrm>` 이 없어 좌표를 못 읽은 것들. 그래프에 못 올리므로 보고해야 한다. */
  missingGeometryIds: string[];
  /** 푼 묶음의 개수. */
  groupCount: number;
};

function textOf(body: string): string {
  const txBody = body.match(/<xdr:txBody>([\s\S]*?)<\/xdr:txBody>/);
  if (!txBody) return "";
  const paragraphs = txBody[1].match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
  return paragraphs
    .map((p) =>
      (p.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? [])
        .map((t) => decodeXmlEntities(t.replace(/<a:t>|<\/a:t>/g, "")))
        .join("")
    )
    .filter((line) => line.length > 0)
    .join("\n");
}

function readObject(
  tag: "sp" | "cxnSp" | "pic",
  body: string,
  transform: GroupTransform | null,
  out: DrawingObject[],
  missing: string[]
): void {
  const idMatch = body.match(CNVPR_ID_RE);
  if (!idMatch) return;
  const xfrmMatch = body.match(XFRM_RE);
  if (!xfrmMatch) {
    missing.push(`${tag === "cxnSp" ? "connector" : tag === "pic" ? "picture" : "shape"}#${idMatch[1]}`);
    return;
  }
  const attrs = xfrmMatch[1] ?? "";
  const rawX = Number(xfrmMatch[2]);
  const rawY = Number(xfrmMatch[3]);
  const rawCx = Number(xfrmMatch[4]);
  const rawCy = Number(xfrmMatch[5]);
  // 🔴 묶음 안의 좌표는 **자식 좌표계**에 적혀 있다. 바깥으로 옮기지 않으면 거리
  //    계산이 통째로 틀린다(실측: 한 시트에서 1.03배·0.95배 어긋났다).
  const x = transform ? transform.offX + (rawX - transform.chOffX) * transform.sx : rawX;
  const y = transform ? transform.offY + (rawY - transform.chOffY) * transform.sy : rawY;
  const cx = transform ? rawCx * transform.sx : rawCx;
  const cy = transform ? rawCy * transform.sy : rawCy;

  const adjustValues: number[] = [];
  for (const gd of body.matchAll(ADJUST_VALUE_RE)) adjustValues[Number(gd[1]) - 1] = Number(gd[2]);

  out.push({
    id: idMatch[1],
    kind: tag === "cxnSp" ? "connector" : tag === "pic" ? "picture" : "shape",
    x,
    y,
    cx,
    cy,
    flipH: /\bflipH="(?:1|true)"/.test(attrs),
    flipV: /\bflipV="(?:1|true)"/.test(attrs),
    // 🔵 묶음의 `<a:xfrm rot>` 은 **안 더한다.** 이 워크북의 묶음 둘은 안 돌아가 있고
    //    (실측), 돌아간 묶음까지 받으려면 자식의 자리도 함께 돌려야 해서 변환이
    //    통째로 달라진다. 지어내지 않고 제 칸에 적힌 것만 읽는다.
    rot: Number(attrs.match(/\brot="(-?\d+)"/)?.[1] ?? "0"),
    adjustValues,
    geom: body.match(/<a:prstGeom prst="([^"]+)"/)?.[1] ?? null,
    text: textOf(body),
    stCxnId: body.match(/<a:stCxn id="(\d+)"/)?.[1] ?? null,
    endCxnId: body.match(/<a:endCxn id="(\d+)"/)?.[1] ?? null,
    inGroup: transform !== null,
  });
}

/**
 * drawing XML 한 장의 **모든 도형·연결선**을 절대 좌표로 읽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **묶음(`<xdr:grpSp>`)을 푼다** — 2026-11-05 에 이것 때문에 흐름이 틀렸다
 * ──────────────────────────────────────────────────────────────────────
 * 엑셀에서 도형 몇 개를 묶어 두면 앵커 하나 안에 **여러 도형과 연결선**이 들어간다.
 * `ooxml-parser.ts` 의 `parseDrawing` 은 그 앵커를 **하나짜리로** 읽어 안의 것들을
 * 통째로 잃는다. 실측으로 `(MB) 통전검사` 가 그랬다 — 묶음 하나에 연결선 둘과 분기
 * 이름 둘("O.K."·"N.G.")이 들어 있었고, 그 넷이 전부 사라져 **분기 이름이 붙을 선이
 * 없고 노드 둘이 어디서도 안 이어진** 그림이 나왔다.
 *
 * 🔵 그래서 **연결선 셈이 달랐다** — 묶음 안의 둘을 못 세어 4개로 보였다(실제 6개).
 *
 * 🔵 묶음은 워크북 전체에 두 장(`(MB) 통전검사` · `(MB) 외관 및 내부 검사`)뿐이고,
 * 뒤엣것은 만들지 않기로 한 시트다.
 *
 * 🔴 `<a:xfrm>` 이 없는 것은 **안 담고 따로 돌려준다**(빈 좌표로 0,0 에 두면 모든
 * 거리 계산이 조용히 틀린다).
 */
export function parseDrawingObjects(xml: string | null): DrawingObjects {
  const objects: DrawingObject[] = [];
  const missingGeometryIds: string[] = [];
  let groupCount = 0;
  if (!xml) return { objects, missingGeometryIds, groupCount };

  let anchorMatch: RegExpExecArray | null;
  ANCHOR_RE.lastIndex = 0;
  while ((anchorMatch = ANCHOR_RE.exec(xml))) {
    const body = anchorMatch[2];
    const group = body.match(/<xdr:grpSp>([\s\S]*)<\/xdr:grpSp>/);
    if (group) {
      groupCount += 1;
      const g = group[1].match(GROUP_XFRM_RE);
      // chExt 가 0 이면 나눌 수 없다 — 변환 없이(배율 1) 읽는다. 자리가 조금
      // 어긋날 수는 있어도 도형을 통째로 잃는 것보다 낫다.
      const transform: GroupTransform | null = g
        ? {
            offX: Number(g[1]),
            offY: Number(g[2]),
            chOffX: Number(g[5]),
            chOffY: Number(g[6]),
            sx: Number(g[7]) === 0 ? 1 : Number(g[3]) / Number(g[7]),
            sy: Number(g[8]) === 0 ? 1 : Number(g[4]) / Number(g[8]),
          }
        : null;
      OBJECT_RE.lastIndex = 0;
      let child: RegExpExecArray | null;
      while ((child = OBJECT_RE.exec(group[1]))) {
        readObject(child[1] as "sp" | "cxnSp" | "pic", child[2], transform, objects, missingGeometryIds);
      }
      continue;
    }
    OBJECT_RE.lastIndex = 0;
    const single = OBJECT_RE.exec(body);
    if (single) {
      readObject(single[1] as "sp" | "cxnSp" | "pic", single[2], null, objects, missingGeometryIds);
    }
  }
  return { objects, missingGeometryIds, groupCount };
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
 * 🔴 **연결선에는 더 이상 쓰지 않는다**(2026-11-05). 쓰던 자리는 「꺾인 선은 제
 * 상자 안을 지나가니 상자까지의 거리로 대신 재자」였는데, 그 어림이 실제로
 * 망가지는 시트가 나왔다 — 아래 `connectorPath` 머리말에 값으로 적어 두었다.
 * 지금 남은 쓰임은 **끊어진 선 끝을 도형에 이어 붙일 때**(그쪽은 상자가 곧 도형의
 * 몸이라 어림이 아니다) 하나다.
 */
export function distancePointToRect(p: Point, g: Pick<DrawingGeometry, "x" | "y" | "cx" | "cy">): number {
  const dx = Math.max(g.x - p.x, 0, p.x - (g.x + g.cx));
  const dy = Math.max(g.y - p.y, 0, p.y - (g.y + g.cy));
  return Math.hypot(dx, dy);
}

/** 점에서 **꺾은선 전체**까지의 최단 거리 — 토막마다 재서 가장 작은 것. */
export function distancePointToPolyline(p: Point, path: readonly Point[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, distancePointToSegment(p, path[i], path[i + 1]));
  }
  return best;
}

/**
 * 돌림각의 코사인·사인.
 *
 * 🔴 **직각(0°·90°·180°·270°)은 표에서 꺼낸다.** `Math.cos(Math.PI/2)` 는 0 이
 * 아니라 6.1e-17 이고, EMU 는 수가 커서(1000만 단위) 그 티끌이 좌표에서 1 가까이
 * 자란다. 그러면 같은 자리를 가리키는 두 점이 **미세하게 다른 수**가 되어, 값이
 * 같은지 보는 시험과 「선이 세로인가」(x 가 같은가) 같은 판정이 조용히 어긋난다.
 * 🔵 실측으로 이 워크북의 돌아간 연결선은 **전부 직각**이다(90° · 180° · 270°).
 * 직각이 아닌 각은 아래 일반식으로 가는데, 그때는 애초에 티끌이 뜻을 갖지 않는다.
 */
function rotationCosSin(rot: number): { cos: number; sin: number } {
  const normalized = ((rot % 21600000) + 21600000) % 21600000;
  if (normalized === 0) return { cos: 1, sin: 0 };
  if (normalized === 5400000) return { cos: 0, sin: 1 };
  if (normalized === 10800000) return { cos: -1, sin: 0 };
  if (normalized === 16200000) return { cos: 0, sin: -1 };
  const theta = (normalized / 60000) * (Math.PI / 180);
  return { cos: Math.cos(theta), sin: Math.sin(theta) };
}

/** `connectorPath` 가 경로를 세우는 데 필요한 것 전부. */
export type ConnectorPathSource = DrawingGeometry &
  DrawingRotation & {
    geom: string | null;
    adjustValues: number[];
  };

/**
 * 프리셋 연결선이 **제 상자 안에서** 지나는 점들. 상자의 왼쪽 위 (0,0) 에서
 * 오른쪽 아래 (w,h) 로 간다 — 뒤집기·돌리기는 아직 안 먹인 날것이다.
 *
 * 🔵 ECMA-376 의 `presetShapeDefinitions` 를 그대로 옮겼다. 🔴 **그대로 믿지 않고
 * 이 워크북으로 검산했다**(2026-11-05):
 *   ① 꺾인 선 88개 전부에서 **첫 점이 출발 도형의 연결점과, 끝 점이 도착 도형의
 *      연결점과 1px 안쪽으로 일치**한다(끝점 검산 1101건 중 어긋남 7건이고, 그 일곱은
 *      전부 `straightConnector1` 이라 이 표와 무관하다 — 손으로 끌어다 놓아 좌표가
 *      도형과 안 맞는 선들이다).
 *   ② 첫 토막·마지막 토막의 **방향**(가로/세로)이 `stCxn idx`·`endCxn idx` 가 말하는
 *      변(0=위·1=왼·2=아래·3=오른)과 88개 전부에서 맞는다. ①만으로는 가운데 꺾임점이
 *      맞는지 알 수 없어 이 검산을 따로 했다 — `bentConnector2` 는 첫 점과 끝 점이
 *      프리셋과 무관하게 상자의 두 귀퉁이라, ①이 **공짜로 통과**한다.
 */
function presetConnectorPoints(g: ConnectorPathSource): Point[] {
  const w = g.cx;
  const h = g.cy;
  // 🔵 적혀 있지 않은 조절값은 프리셋 기본값 50000(한가운데)이다.
  const adj = (index: number): number => (g.adjustValues[index] ?? 50000) / 100000;
  switch (g.geom) {
    case "bentConnector2":
      return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }];
    case "bentConnector3": {
      const x1 = w * adj(0);
      return [{ x: 0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: h }, { x: w, y: h }];
    }
    case "bentConnector4": {
      const x1 = w * adj(0);
      const y1 = h * adj(1);
      return [{ x: 0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: y1 }, { x: w, y: y1 }, { x: w, y: h }];
    }
    case "bentConnector5": {
      const x1 = w * adj(0);
      const y1 = h * adj(1);
      const x2 = w * adj(2);
      return [
        { x: 0, y: 0 },
        { x: x1, y: 0 },
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: h },
        { x: w, y: h },
      ];
    }
    default:
      // `straightConnector1`·`line`, 그리고 우리가 모르는 프리셋. 모르는 것을 곧은
      // 선으로 보는 것은 **상자 대각선**이라, 지금까지 쓰던 어림과 같은 값이다.
      return [{ x: 0, y: 0 }, { x: w, y: h }];
  }
}

/**
 * ============================================================================
 * 🔴 연결선이 **실제로 그려지는 경로**(그림판 절대 좌표) (2026-11-05)
 * ============================================================================
 * 분기 이름("NG")을 어느 선에 붙일지는 **이름 상자에서 선까지의 거리**가 정한다.
 * 그래서 「선이 어디에 있는가」가 한 자리라도 틀리면 이름이 엉뚱한 선으로 간다 —
 * 오류는 한 번도 안 나고, 들여온 그림을 열어 보기 전에는 아무도 모른다.
 *
 * ── 안 고치면 무슨 일이 나는가 (실측 · `(7)원복 검사 및 개선 작업`) ──────────
 * 이 시트는 도형 250·선 225 로 지금까지 중 가장 크고, **꺾인 선과 돌아간 선이
 * 처음으로 많이** 나왔다(꺾인 선 77 · 돌아간 선 38). 옛 자(= 상자까지의 거리 +
 * `rot` 무시)로 재면 「판단 노드에 정상/기본 진행 경로가 없다」는 구조 오류가
 * **28건** 났다. 까닭 둘이 겹쳐 있었다:
 *
 *   ① **`rot` 을 안 읽었다.** 세로로 선 상자를 90° 눕혀 적은 선이 38개인데,
 *      돌리기를 빼먹으면 가로·세로가 뒤바뀐 엉뚱한 자리에 선이 놓인다.
 *      보기: `connector#75` 는 적힌 상자가 (1137,560)~(1253,922)px 인데
 *      실제로 그려지는 자리는 (1014,683)~(1376,798)px 다.
 *
 *   ② **꺾인 선을 제 바깥 상자로 쟀다.** 되돌아가는 긴 선은 상자가 시트의 절반을
 *      덮는다(보기: `connector#277` 은 가로 300 · 세로 2457px). 그 안에 든 이름
 *      상자는 **거리가 0** 으로 나와, 바로 옆 8px 짜리 곧은 선을 언제나 이긴다.
 *      🔴 게다가 0 은 「차점과 1.25배 벌어졌는가」도 **공짜로 통과**한다(0 ≥ 0×1.25)
 *      — 가장 모호한 경우가 **가장 확실한 것**으로 뒤집혀, 모호 경고도 안 떴다.
 *
 * 경로를 제대로 세우면 ①은 제자리를 찾고, ②는 되돌아가는 선이 **상자 가장자리로만**
 * 지나가므로 가운데 떠 있는 이름을 더 이상 끌어가지 않는다.
 *
 * 🔵 **곧은 선의 값은 한 자리도 안 바뀐다** — 돌리기가 없으면 경로가 상자의 대각선
 * 두 점이고, 그것은 `connectorSegment` 가 주던 바로 그 선분이다. 180° 돌아간 곧은
 * 선은 두 점의 **차례**만 바뀌는데 선분은 같은 점의 모음이라 거리도 같다.
 */
export function connectorPath(g: ConnectorPathSource): Point[] {
  const w = g.cx;
  const h = g.cy;
  const { cos, sin } = rotationCosSin(g.rot);
  const halfW = w / 2;
  const halfH = h / 2;
  return presetConnectorPoints(g).map((p) => {
    // 뒤집기가 먼저, 돌리기가 나중이다 — 엑셀이 그리는 차례가 그렇고, 뒤집기는
    // 상자 **안**의 거울이라 돌린 뒤에 먹이면 축이 달라져 다른 그림이 된다.
    const fx = g.flipH ? w - p.x : p.x;
    const fy = g.flipV ? h - p.y : p.y;
    // 돌리기는 **상자 가운데**를 축으로 한다(DrawingML). y 가 아래로 자라는
    // 좌표계라 양의 각이 시계 방향이다.
    const dx = fx - halfW;
    const dy = fy - halfH;
    return { x: g.x + halfW + dx * cos - dy * sin, y: g.y + halfH + dx * sin + dy * cos };
  });
}
