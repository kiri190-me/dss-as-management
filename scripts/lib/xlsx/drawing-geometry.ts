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

/** 그림판 위의 도형 하나 — 글자·연결 정보까지 함께. */
export type DrawingObject = DrawingGeometry & {
  kind: "shape" | "connector" | "picture";
  /** `<a:prstGeom prst>` — 곧은 선인지 꺾인 선인지 가릴 때 쓴다. */
  geom: string | null;
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

  out.push({
    id: idMatch[1],
    kind: tag === "cxnSp" ? "connector" : tag === "pic" ? "picture" : "shape",
    x,
    y,
    cx,
    cy,
    flipH: /\bflipH="(?:1|true)"/.test(attrs),
    flipV: /\bflipV="(?:1|true)"/.test(attrs),
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
