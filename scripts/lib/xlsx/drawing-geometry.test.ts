import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectorPath,
  connectorSegment,
  distancePointToPolyline,
  distancePointToRect,
  parseDrawingObjects,
  type ConnectorPathSource,
} from "./drawing-geometry";

/**
 * ============================================================================
 * 연결선이 **실제로 그려지는 자리**를 읽는가
 * ============================================================================
 * 🔴 2026-11-05 에 여기서 크게 틀렸다. 분기 이름("NG")은 **이름 상자에서 선까지의
 * 거리**로 붙으므로, 선의 자리가 틀리면 이름이 엉뚱한 선으로 간다 — 그런데 그
 * 틀림은 **오류를 한 번도 안 낸다.** 들여온 그림을 사람이 열어 보기 전에는 아무도
 * 모르고, 열어 봐도 선 225개 중 어느 것이 뒤바뀌었는지 눈으로 못 센다.
 *
 * 그래서 이 시험들은 결과가 아니라 **읽는 방법**을 못 박는다. 아래 시험마다
 * 「옛 방법으로 재면 이렇게 나온다」를 먼저 단언해 둔 까닭이 그것이다 — 그 못이
 * 없으면 본보기가 밋밋해졌을 때(어떤 자로 재도 같은 답이 나오는 모양) 시험이
 * **무뎌진 줄도 모르고 계속 초록**이다.
 *
 * 🔵 좌표는 전부 EMU(914400 EMU = 1 inch = 96 px)이고 **지어낸 값**이다. 실제
 * 워크북에서 베낀 것은 **모양**(어떤 프리셋이 어떻게 돌아가 있는가)뿐이다.
 */

/** 시험용 연결선 하나 — 엑셀이 적는 것과 같은 꼴(상자 + 뒤집기 + 돌리기 + 프리셋). */
function conn(
  box: { x: number; y: number; cx: number; cy: number },
  options: {
    geom?: string;
    rot?: number;
    flipH?: boolean;
    flipV?: boolean;
    adjustValues?: number[];
  } = {}
): ConnectorPathSource {
  return {
    id: "c",
    ...box,
    flipH: options.flipH ?? false,
    flipV: options.flipV ?? false,
    rot: options.rot ?? 0,
    geom: options.geom ?? "straightConnector1",
    adjustValues: options.adjustValues ?? [],
  };
}

test("🔵 곧은 선은 값이 한 자리도 안 바뀐다 — 경로가 곧 옛 선분이다(뒤집기 네 꼴 모두)", () => {
  for (const flipH of [false, true]) {
    for (const flipV of [false, true]) {
      const c = conn({ x: 1000000, y: 2000000, cx: 600000, cy: 900000 }, { flipH, flipV });
      const path = connectorPath(c);
      const segment = connectorSegment(c);
      assert.equal(path.length, 2, `flipH=${flipH} flipV=${flipV}`);
      assert.deepEqual(path[0], segment.start, `flipH=${flipH} flipV=${flipV} 시작`);
      assert.deepEqual(path[1], segment.end, `flipH=${flipH} flipV=${flipV} 끝`);
    }
  }
});

test("🔴 `rot=90°` 는 가로·세로를 바꿔 놓는다 — 안 읽으면 선이 엉뚱한 자리에 눕는다", () => {
  // 세로로 긴 상자(가로 1 · 세로 4)를 가운데를 축으로 90° 돌렸다. 엑셀은 꺾인
  // 연결선을 이렇게 적는 일이 아주 잦다(실측: 한 시트의 선 225개 중 35개).
  const c = conn({ x: 0, y: 0, cx: 1000000, cy: 4000000 }, { rot: 5400000 });

  // ① 못 — 옛 방법(적힌 상자 그대로)은 **세로로 긴** 선이라고 말한다.
  const written = connectorSegment(c);
  assert.deepEqual(written.start, { x: 0, y: 0 });
  assert.deepEqual(written.end, { x: 1000000, y: 4000000 });

  // ② 실제로 그려지는 선은 **가로로 긴** 선이고, 가운데(500000, 2000000)는 그대로다.
  const path = connectorPath(c);
  assert.equal(path.length, 2);
  assert.deepEqual(path[0], { x: 2500000, y: 1500000 });
  assert.deepEqual(path[1], { x: -1500000, y: 2500000 });
});

test("🔴 `rot=180°` 는 상자는 그대로 두고 **차례만** 뒤집는다 — 끝을 이어 붙일 때 갈린다", () => {
  const c = conn({ x: 1000000, y: 1000000, cx: 2000000, cy: 0 }, { rot: 10800000 });
  const path = connectorPath(c);
  // 선분 자체는 같은 점의 모음이라 **거리는 안 바뀐다**(아래 단언이 그 못이다).
  const written = connectorSegment(c);
  assert.deepEqual([path[0], path[1]], [written.end, written.start]);
  assert.equal(
    distancePointToPolyline({ x: 2000000, y: 1500000 }, path),
    distancePointToPolyline({ x: 2000000, y: 1500000 }, [written.start, written.end])
  );
});

test("🔴 꺾임점은 `adj` 가 정한다 — 안 읽으면 늘 한가운데로 꺾인다", () => {
  const box = { x: 0, y: 0, cx: 1000000, cy: 400000 };
  const middle = connectorPath(conn(box, { geom: "bentConnector3" }));
  const skewed = connectorPath(conn(box, { geom: "bentConnector3", adjustValues: [20000] }));

  // ① 못 — 조절값이 없으면 프리셋 기본값 50000(한가운데)이다.
  assert.deepEqual(middle, [
    { x: 0, y: 0 },
    { x: 500000, y: 0 },
    { x: 500000, y: 400000 },
    { x: 1000000, y: 400000 },
  ]);
  // ② adj1=20000 이면 꺾임이 왼쪽으로 치우친다 — 두 경로가 **실제로 다르다**.
  assert.deepEqual(skewed[1], { x: 200000, y: 0 });
  assert.notDeepEqual(skewed, middle);
});

test("🔴 `adj` 가 음수면 경로가 **제 상자 밖으로** 나간다 — 「상자 안에 있다」는 전제가 깨진다", () => {
  // 실제 워크북에 `bentConnector4 adj=[-16859, 55564]` 가 있다. 2026-11-05 전의
  // 주석은 「꺾인 선의 경로는 반드시 제 상자 안에 있다」고 적고 있었는데 거짓이다.
  const c = conn({ x: 0, y: 0, cx: 1000000, cy: 1000000 }, { geom: "bentConnector4", adjustValues: [-20000, 50000] });
  const path = connectorPath(c);
  const outside = path.filter((p) => p.x < 0 || p.x > 1000000 || p.y < 0 || p.y > 1000000);
  assert.ok(outside.length > 0, "본보기가 더 이상 상자 밖으로 안 나간다 — 시험이 무뎌졌다");
  assert.deepEqual(outside, [{ x: -200000, y: 0 }, { x: -200000, y: 500000 }]);
});

test("🔴 되돌아가는 긴 선: **상자**로 재면 0, **경로**로 재면 멀다 — 이름을 뺏기던 자리", () => {
  // 모양: 아래쪽 상자에서 나와 오른쪽으로 빠진 뒤 위로 한참 올라가 되돌아가는 선.
  // 그 바깥 상자는 시트의 한 기둥을 통째로 덮는다.
  const loopBack = conn(
    { x: 0, y: 0, cx: 1000000, cy: 10000000 },
    { geom: "bentConnector3", flipV: true, adjustValues: [100000] }
  );
  // 이름 상자는 그 기둥 **한가운데**에 떠 있다 — 실제 선과는 멀찍이 떨어져 있다.
  const labelCenter = { x: 500000, y: 5000000 };

  // ① 못 — 옛 자(바깥 상자까지의 거리)로 재면 **0** 이다. 0 은 「가깝다」가 아니라
  //    「잴 줄 모른다」였고, 0 은 「차점과 1.25배 벌어졌는가」도 공짜로 통과한다.
  assert.equal(distancePointToRect(labelCenter, loopBack), 0);

  // ② 새 자로 재면 실제로 그려지는 경로까지의 거리가 나온다 — 기둥 반쪽만큼 멀다.
  assert.equal(distancePointToPolyline(labelCenter, connectorPath(loopBack)), 500000);
});

test("🔴 그래서 짧은 곧은 선이 이긴다 — 같은 이름 상자를 두 선이 다툴 때", () => {
  const loopBack = conn(
    { x: 0, y: 0, cx: 1000000, cy: 10000000 },
    { geom: "bentConnector3", flipV: true, adjustValues: [100000] }
  );
  const shortLine = conn({ x: 300000, y: 5100000, cx: 400000, cy: 0 });
  const labelCenter = { x: 500000, y: 5000000 };

  // ① 못 — 옛 자로는 **되돌아가는 선이 이긴다**(0 < 100000). 이것이 실제로 일어난 일이다.
  assert.ok(
    distancePointToRect(labelCenter, loopBack) <
      distancePointToPolyline(labelCenter, connectorPath(shortLine)),
    "본보기가 더 이상 「옛 자로는 틀리는」 모양이 아니다 — 시험이 무뎌졌다"
  );
  // ② 새 자로는 짧은 곧은 선이 이긴다.
  assert.ok(
    distancePointToPolyline(labelCenter, connectorPath(shortLine)) <
      distancePointToPolyline(labelCenter, connectorPath(loopBack))
  );
});

test("🔴 `parseDrawingObjects` 가 `rot` 과 `adj` 를 **실제로** 읽는다", () => {
  const xml = `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="x" xmlns:a="a">
<xdr:twoCellAnchor><xdr:cxnSp macro=""><xdr:nvCxnSpPr>
<xdr:cNvPr id="75" name="연결선"/><xdr:cNvCxnSpPr><a:stCxn id="33" idx="2"/><a:endCxn id="36" idx="0"/></xdr:cNvCxnSpPr>
</xdr:nvCxnSpPr><xdr:spPr><a:xfrm rot="5400000"><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm>
<a:prstGeom prst="bentConnector4"><a:avLst><a:gd name="adj1" fmla="val -16859"/><a:gd name="adj2" fmla="val 55564"/></a:avLst></a:prstGeom>
</xdr:spPr></xdr:cxnSp><xdr:clientData/></xdr:twoCellAnchor>
<xdr:twoCellAnchor><xdr:sp macro=""><xdr:nvSpPr><xdr:cNvPr id="33" name="상자"/></xdr:nvSpPr>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
<xdr:txBody><a:p><a:r><a:t>가나다</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`;

  // ① 못 — 본보기 XML 에 그 값들이 **정말로 적혀 있다**. 이 단언이 없으면 파서가
  //    아무것도 안 읽어도 아래가 기본값으로 통과한다(rot 0 · adj 빈 배열).
  assert.ok(xml.includes('rot="5400000"'));
  assert.ok(xml.includes('name="adj1" fmla="val -16859"'));

  const { objects } = parseDrawingObjects(xml);
  const connector = objects.find((o) => o.id === "75")!;
  assert.equal(connector.kind, "connector");
  assert.equal(connector.rot, 5400000);
  assert.deepEqual(connector.adjustValues, [-16859, 55564]);
  assert.equal(connector.geom, "bentConnector4");

  // 돌리기가 없는 도형은 0 이고, 조절값이 비어 있으면 빈 배열이다.
  const shape = objects.find((o) => o.id === "33")!;
  assert.equal(shape.rot, 0);
  assert.deepEqual(shape.adjustValues, []);
});

test("🔴 프리셋 경로의 끝점이 **도형의 연결점**과 맞는다 — 꺾임 방향까지", () => {
  // 워크북 전수 검산(끝점 1101건 · 방향 88건)을 본보기 하나로 줄여 못 박는다.
  // 상자 A 의 **아래**(idx 2)에서 나와 상자 B 의 **위**(idx 0)로 들어가는 꼴이라,
  // 첫 토막과 마지막 토막이 둘 다 **세로**여야 한다.
  const bottomOfA = { x: 2000000, y: 1000000 };
  const topOfB = { x: 1000000, y: 3000000 };
  // 엑셀은 이 모양을 「가로로 긴 상자를 90° 돌린 bentConnector3」로 적는다 — 적힌
  // 상자(500000,1500000 · 2000000×1000000)는 실제로 그려지는 자리와 **겹치지도 않는다.**
  const c = conn(
    { x: 500000, y: 1500000, cx: 2000000, cy: 1000000 },
    { geom: "bentConnector3", rot: 5400000 }
  );
  const path = connectorPath(c);
  assert.deepEqual(path[0], bottomOfA);
  assert.deepEqual(path[path.length - 1], topOfB);
  // 첫 토막·마지막 토막이 세로다(가로 움직임이 0).
  assert.equal(path[0].x, path[1].x);
  assert.equal(path[path.length - 2].x, path[path.length - 1].x);
});
