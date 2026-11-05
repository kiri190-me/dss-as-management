import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractTechnicalTaskGraph,
  type TechnicalTaskConnectorInput,
  type TechnicalTaskGraphInput,
  type TechnicalTaskShapeInput,
} from "./extract-technical-task-graph";
import { connectorPath, distancePointToPolyline, distancePointToRect } from "./drawing-geometry";
import { validateProcedureGraphStructure } from "@/lib/domain/procedure-graph-structural-validation";

/**
 * 🔴 **지어낸 값만 쓴다.** 이 저장소는 공개(public)이고 원본 워크북은 사내 업무
 * 자료다 — 도형 글자는 「가나다」식 가짜 낱말로 적고, 베끼는 것은 **구조**(도형이
 * 어디에 있고 선이 어디로 가는가)뿐이다.
 *
 * 좌표는 전부 EMU 다(914400 EMU = 1 inch). 실제 워크북의 자리 관계를 그대로
 * 축소해 옮겼다 — 특히 「판단 상자 하나에서 긴 세로 선과 짧은 대각선이 나가고,
 * 그 둘에 분기 이름이 하나씩 떠 있는」 모양. 그 모양이 지난 들여오기를 망가뜨린
 * 자리다(drawing-geometry.ts 머리말).
 */

function shape(
  id: string,
  text: string,
  box: { x: number; y: number; cx: number; cy: number }
): TechnicalTaskShapeInput {
  return { id, text, ...box, flipH: false, flipV: false };
}

/**
 * 연결선 하나.
 *
 * 🔴 **경로를 손으로 적지 않고 `connectorPath` 로 세운다**(2026-11-05). 그래프가
 * 받는 값이 경로로 바뀌었는데(`TechnicalTaskConnectorInput.path`), 시험이 그 경로를
 * 제 손으로 적으면 **엑셀을 읽는 쪽이 아무리 틀려도 시험은 영영 초록**이다.
 * 본보기는 엑셀이 적는 것과 같은 꼴(상자 + 뒤집기 + 돌리기 + 프리셋)로 쓰고,
 * 경로는 실제 코드가 세운다.
 */
function connector(
  id: string,
  from: string | null,
  to: string | null,
  box: { x: number; y: number; cx: number; cy: number },
  options: {
    flipH?: boolean;
    flipV?: boolean;
    /** `<a:prstGeom prst>`. 안 주면 곧은 선. */
    geom?: string;
    /** `<a:xfrm rot>` — 1/60000 도. */
    rot?: number;
    /** `<a:gd name="adjN">` — 꺾임점 조절값(10만분율). */
    adjustValues?: number[];
  } = {}
): TechnicalTaskConnectorInput {
  return {
    id,
    fromShapeId: from,
    toShapeId: to,
    path: connectorPath({
      id,
      ...box,
      flipH: options.flipH ?? false,
      flipV: options.flipV ?? false,
      rot: options.rot ?? 0,
      geom: options.geom ?? "straightConnector1",
      adjustValues: options.adjustValues ?? [],
    }),
  };
}

/**
 * 🔴 **엑셀에서 온 것만** 골라 센다.
 *
 * 2026-11-05 부터 시작(START) 노드를 **자동으로 더한다**(사용자 결정). 그래서
 * 「노드 수 + 버린 도형 수 = 입력 도형 수」 같은 셈을 그냥 `result.nodes` 로 재면
 * 하나씩 어긋난다 — 더한 것과 읽은 것을 갈라서 센다.
 */
function excelNodes(result: ReturnType<typeof extractTechnicalTaskGraph>) {
  return result.nodes.filter((n) => n.origin === "EXCEL_SHAPE");
}

/** 엑셀의 연결선에서 온 분기만. 자동으로 더한 시작 분기는 `sourceConnectorId` 가 없다. */
function excelEdges(result: ReturnType<typeof extractTechnicalTaskGraph>) {
  return result.edges.filter((e) => e.sourceConnectorId !== null);
}

/**
 * 선의 **바깥 상자 가운데**까지의 거리 — 고치기 전에 쓰던 자(아래 시험이 이것과 견준다).
 * 🔵 상자는 경로를 감싸는 네모로 되돌려 센다 — 연결선 입력이 상자를 더는 안 들고 다닌다.
 */
function distanceToConnectorBoxCenter(
  label: TechnicalTaskShapeInput,
  c: TechnicalTaskConnectorInput
): number {
  const xs = c.path.map((p) => p.x);
  const ys = c.path.map((p) => p.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return Math.hypot(label.x + label.cx / 2 - centerX, label.y + label.cy / 2 - centerY);
}

/**
 * 본보기 한 장. 담은 것:
 *   - 판단 상자(10)에서 **긴 세로 선**(→11)과 **짧은 대각선**(→12)이 나간다.
 *   - 그 둘에 분기 이름 "YES"(20) · "NO"(21)가 떠 있다.
 *   - 오른쪽 멀리에 글자가 든 설명 상자(30)와 빈 상자(31)가 있고, 본문에서 그 쪽으로
 *     가는 주석선(cF)이 하나 있다.
 *   - 꼬리에 조치 상자(13) · 작업 상자(15) · 다른 절차를 가리키는 상자(14)가 이어진다.
 */
function buildMainFixture(): TechnicalTaskGraphInput {
  const shapes: TechnicalTaskShapeInput[] = [
    shape("10", "가나다 정보가 같은지 확인", { x: 400000, y: 1000000, cx: 3000000, cy: 500000 }),
    shape("12", "라마바 재확인", { x: 3300000, y: 1800000, cx: 2000000, cy: 500000 }),
    shape("11", "가나다 점검 실시", { x: 400000, y: 5000000, cx: 3000000, cy: 500000 }),
    shape("13", "사아자 부품 교환\n(마바사 기준)", { x: 400000, y: 6000000, cx: 3000000, cy: 500000 }),
    shape("15", "타파하 준비\n*아아 주의", { x: 400000, y: 7000000, cx: 3000000, cy: 500000 }),
    shape("14", "(5) 차카타 절차 실시", { x: 400000, y: 8000000, cx: 3000000, cy: 500000 }),
    // 분기 이름 둘 — 어느 선의 것인지는 오직 좌표가 정한다.
    shape("20", "YES", { x: 1400000, y: 1550000, cx: 500000, cy: 300000 }),
    shape("21", "NO", { x: 2400000, y: 1650000, cx: 400000, cy: 300000 }),
    // 오른쪽 주석 덩어리 — 본문과 사이에 도형이 하나도 없는 띠가 생긴다.
    shape("30", "하거너 설명 상자", { x: 9000000, y: 1000000, cx: 2000000, cy: 2000000 }),
    shape("31", "", { x: 9500000, y: 4000000, cx: 1000000, cy: 1000000 }),
  ];
  const connectors: TechnicalTaskConnectorInput[] = [
    // 긴 세로 선 10 → 11. 상자 가운데는 라벨에서 한참 **아래**에 있다.
    connector("cA", "10", "11", { x: 1800000, y: 1500000, cx: 0, cy: 3500000 }),
    // 짧은 대각선 10 → 12. 상자 가운데가 "YES" 바로 옆이라, 가운데끼리 재면 이쪽이 이긴다.
    connector("cB", "10", "12", { x: 1800000, y: 1500000, cx: 1500000, cy: 400000 }),
    connector("cC", "11", "13", { x: 1800000, y: 5500000, cx: 0, cy: 500000 }),
    connector("cD", "13", "15", { x: 1800000, y: 6500000, cx: 0, cy: 500000 }),
    connector("cE", "15", "14", { x: 1800000, y: 7500000, cx: 0, cy: 500000 }),
    // 주석선 — 본문 노드에서 설명 상자로 간다.
    connector("cF", "10", "30", { x: 3400000, y: 1200000, cx: 5600000, cy: 300000 }),
  ];
  return {
    sheetName: "(TEST) 가상 흐름도",
    nodeCodePrefix: "t1",
    startNodeTitle: "가상 절차",
    shapes,
    connectors,
  };
}

test("🔴 본보기가 비어 있지 않다 — 아래 시험이 무엇을 재는지 먼저 못 박는다", () => {
  const input = buildMainFixture();
  assert.equal(input.shapes.length, 10);
  assert.equal(input.connectors.length, 6);

  const result = extractTechnicalTaskGraph(input);
  assert.equal(excelNodes(result).length, 6);
  assert.equal(excelEdges(result).length, 5);
  // 자동으로 더한 시작 노드 하나와 그 분기 하나가 더 있다.
  assert.equal(result.nodes.length, 7);
  assert.equal(result.edges.length, 6);
  // 🔴 조용히 사라지는 도형이 없다 — 들어온 도형은 노드가 되거나 까닭과 함께 버려진다.
  //    🔵 더한 시작 노드는 이 셈에 끼면 안 된다(엑셀에서 온 것이 아니다).
  assert.equal(excelNodes(result).length + result.droppedShapes.length, input.shapes.length);
  assert.equal(excelEdges(result).length + result.droppedConnectors.length, input.connectors.length);
});

test("🔴 분기 이름이 **제 선**에 붙는다 — 선분까지의 거리로 재고, 한 선에 하나씩만", () => {
  const input = buildMainFixture();
  const result = extractTechnicalTaskGraph(input);

  const yes = result.labelBindings.find((b) => b.labelText === "YES");
  const no = result.labelBindings.find((b) => b.labelText === "NO");
  assert.ok(yes, "YES 라벨이 아무 선에도 안 붙었다");
  assert.ok(no, "NO 라벨이 아무 선에도 안 붙었다");
  assert.equal(yes.connectorId, "cA");
  assert.equal(no.connectorId, "cB");
  // 두 라벨이 같은 선을 나눠 가질 수 없다.
  assert.notEqual(yes.connectorId, no.connectorId);
  assert.ok(yes.confident, "YES 가 차점과 거의 비겼다고 나왔다");
  assert.ok(no.confident, "NO 가 차점과 거의 비겼다고 나왔다");

  // 🔴 엑셀 글자는 `YES`·`NO` 지만 분기에 실리는 이름은 「정상」·「NG」로 통일된다
  //    (2026-11-05 사용자 결정). 어느 선에 붙었는지는 위에서 원본 글자로 재고,
  //    무엇이 실리는지는 여기서 통일된 값으로 잰다 — 둘은 다른 질문이다.
  const edgeToInspection = result.edges.find((e) => e.toNodeCode === "t1-11");
  const edgeToRecheck = result.edges.find((e) => e.toNodeCode === "t1-12");
  assert.equal(edgeToInspection?.branchType, "NORMAL");
  assert.equal(edgeToInspection?.branchLabel, "정상");
  assert.equal(edgeToRecheck?.branchType, "NG");
  assert.equal(edgeToRecheck?.branchLabel, "NG");
});

test("🔴 분기 이름은 「정상」·「NG」 둘뿐이다 — 이름 없는 분기에는 이름이 안 생긴다", () => {
  const input = buildMainFixture();
  const result = extractTechnicalTaskGraph(input);

  // ① 본보기가 비어 있지 않다 — 이름이 붙은 선 둘과 안 붙은 선 셋이 **둘 다** 있다.
  //    🔴 한쪽이 0이면 아래 단언이 공짜로 통과한다.
  const named = result.edges.filter((e) => e.branchLabel !== null);
  const unnamed = result.edges.filter((e) => e.branchLabel === null);
  assert.equal(named.length, 2, "이름이 붙은 분기가 둘이 아니다 — 본보기가 바뀌었다");
  assert.ok(unnamed.length >= 3, "이름 없는 분기가 없다 — 아래 단언이 아무것도 안 잰다");

  // ② 쓰이는 이름은 그 둘뿐이다.
  assert.deepEqual([...new Set(named.map((e) => e.branchLabel))].sort(), ["NG", "정상"]);
  // ③ 갈래도 이름과 어긋나지 않는다 — 어긋나면 화면이 「정상」을 파란 선으로 그린다.
  assert.deepEqual([...new Set(named.map((e) => e.branchType))].sort(), ["NG", "NORMAL"]);

  // ④ 🔴 **이름 없는 분기는 그대로 둔다.** 이것까지 안 재면 「전부 정상/NG 로
  //    뭉개기」로 바뀌어도 ②·③이 통과한다.
  //    🔵 이 본보기의 판단 상자(10)는 나가는 선 둘에 **이름이 다 붙어 있어서**
  //    「NG 의 짝인 이름 없는 선」 예외(5-3 절 · 아래 시험들)가 안 걸린다. 여기 남은
  //    이름 없는 넷은 시작 노드와 TASK·조치에서 그냥 다음 단계로 가는 선이다.
  for (const edge of unnamed) {
    assert.equal(edge.branchType, "DEFAULT", `이름 없는 분기에 갈래가 생겼다: ${edge.fromNodeCode}`);
  }
});

test("🔴 사람이 적은 이름(CUSTOM)은 통일에 안 휩쓸린다 — 다만 이 길로는 아직 안 들어온다", () => {
  // 🔴 「유상」 같은 글자가 든 작은 상자는 **분기 이름으로 안 읽힌다** —
  //    `isBranchLabelText` 가 NG·YES·NO·OK·정상 어휘만 분기 이름으로 치기 때문이다
  //    (글자 한 줄짜리 진짜 작업 상자를 이름으로 먹지 않으려고 일부러 그렇게 뒀다).
  //    그래서 선에 안 붙고, 어떤 연결선도 안 닿으므로 「흐름에 안 닿음」으로 버려진다.
  //    🔵 실측(열한 시트)에서도 CUSTOM 은 0건이고, 고립 도형 13개는 전부 사진 캡션이었다.
  const input = buildMainFixture();
  input.shapes.push(shape("22", "유상", { x: 1500000, y: 2600000, cx: 400000, cy: 300000 }));
  const result = extractTechnicalTaskGraph(input);

  assert.equal(
    result.labelBindings.some((b) => b.labelText === "유상"),
    false,
    "분기 어휘가 아닌 글자가 분기 이름으로 붙었다"
  );
  assert.equal(result.droppedShapes.find((d) => d.shapeId === "22")?.reason, "NOT_IN_FLOW");
  assert.equal(
    result.edges.some((e) => e.branchLabel === "유상"),
    false
  );
});

/**
 * ============================================================================
 * 🔴 판단에서 **NG 와 짝지어 갈라지는 이름 없는 선** (2026-11-05 사용자 지시)
 * ============================================================================
 * 엑셀 흐름도는 갈림길에 **NG 쪽에만** 이름을 적는다 — 정상 쪽은 그냥 아래로
 * 내려가는 선이라 글자가 없다. 실측으로 열한 시트의 판단 노드 **90곳**이 그 모양이다.
 *
 * 본보기가 담은 것:
 *   - 판단 상자(1)에서 **「NG」가 붙은 선**(→2)과 **이름 없는 선**(→3)이 나간다.
 *   - 그 아래에 **판단이 아닌** 평범한 이어짐(3 →4)이 하나 더 있다.
 *   - 들어오는 선이 없는 1 에 시작 노드가 자동으로 붙는다(그 분기도 이름이 없다).
 *
 * 🔴 **뒤의 둘이 알맹이다.** 「이름 없는 선을 정상으로」만 재면 「전부 정상으로
 * 뭉개기」가 통과한다 — 판단이 아닌 자리의 이름 없는 선이 그대로인지를 함께 잰다.
 */
function buildNgPairFixture(): TechnicalTaskGraphInput {
  return {
    sheetName: "(TEST) NG 의 짝",
    nodeCodePrefix: "p1",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 상태 확인", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 부품 교환", { x: 100000, y: 3000000, cx: 1000000, cy: 500000 }),
      shape("3", "사아자 작업", { x: 1500000, y: 3000000, cx: 1200000, cy: 500000 }),
      shape("4", "아자차 작업", { x: 1500000, y: 5000000, cx: 1200000, cy: 500000 }),
      // 분기 이름은 **NG 쪽에만** 붙어 있다 — 워크북의 실제 표기가 이렇다.
      shape("9", "NG", { x: 650000, y: 2000000, cx: 300000, cy: 300000 }),
    ],
    connectors: [
      connector("cNG", "1", "2", { x: 600000, y: 1500000, cx: 0, cy: 1500000 }),
      connector("cPair", "1", "3", { x: 2000000, y: 1500000, cx: 0, cy: 1500000 }),
      // 판단이 아닌 노드에서 그냥 다음 단계로 가는 선.
      connector("cChain", "3", "4", { x: 2100000, y: 3500000, cx: 0, cy: 1500000 }),
    ],
  };
}

test("🔴 본보기가 비어 있지 않다 — 판단 하나에 NG 선과 이름 없는 선이 **하나씩** 나간다", () => {
  const result = extractTechnicalTaskGraph(buildNgPairFixture());

  // 「NG」가 엉뚱한 선에 붙으면 아래 시험들이 전부 딴것을 재게 된다 — 먼저 못 박는다.
  const ng = result.labelBindings.find((b) => b.labelText === "NG");
  assert.equal(ng?.connectorId, "cNG", "NG 가 제 선에 안 붙었다 — 본보기가 바뀌었다");
  assert.ok(ng?.confident, "NG 가 차점과 거의 비겼다 — 본보기 좌표를 다시 봐야 한다");

  // 판단 상자가 **판단으로** 읽혔는지. 아니면 이 본보기는 다른 것을 재고 있다.
  assert.equal(result.nodes.find((n) => n.sourceShapeId === "1")?.nodeType, "DECISION");
  assert.equal(result.nodes.find((n) => n.sourceShapeId === "3")?.nodeType, "TASK");
  assert.equal(excelEdges(result).length, 3);
});

test("🔴 판단에서 NG 와 짝지어 나가는 **이름 없는 선**이 「정상」이 된다 (사용자 지시)", () => {
  const result = extractTechnicalTaskGraph(buildNgPairFixture());

  const pair = result.edges.find((e) => e.sourceConnectorId === "cPair");
  assert.equal(pair?.branchType, "NORMAL", "NG 의 짝이 이름 없는 채로 남았다");
  assert.equal(pair?.branchLabel, "정상");

  // NG 쪽은 그대로다 — 짝을 올리면서 제 이름을 잃으면 안 된다.
  const ng = result.edges.find((e) => e.sourceConnectorId === "cNG");
  assert.equal(ng?.branchType, "NG");
  assert.equal(ng?.branchLabel, "NG");

  // 🔵 이름이 생겨도 **노드 유형은 그대로**다(이미 NG 를 내보내 판단이었다).
  assert.equal(result.nodes.find((n) => n.sourceShapeId === "1")?.nodeType, "DECISION");
});

test("🔴 판단이 **아닌** 곳의 이름 없는 선은 그대로다 — 없으면 「전부 정상으로 뭉개기」가 통과한다", () => {
  const result = extractTechnicalTaskGraph(buildNgPairFixture());

  // ① 작업 → 작업. 갈림이 아니라 그냥 다음 단계다.
  const chain = result.edges.find((e) => e.sourceConnectorId === "cChain");
  assert.equal(chain?.branchType, "DEFAULT", "판단이 아닌 곳의 선에 갈래가 생겼다");
  assert.equal(chain?.branchLabel, null);

  // ② 자동으로 더한 시작 분기. 엑셀에 없던 선이라 더더욱 이름을 지어내면 안 된다.
  const fromStart = result.edges.find((e) => e.sourceConnectorId === null);
  assert.ok(fromStart, "시작 분기가 없다 — 이 시험이 아무것도 안 잰다");
  assert.equal(fromStart.branchType, "DEFAULT");
  assert.equal(fromStart.branchLabel, null);

  // ③ 이름이 생긴 선은 **딱 둘**이다(NG 하나와 그 짝 하나).
  assert.equal(result.edges.filter((e) => e.branchLabel !== null).length, 2);
});

test("🔴 이름 없는 선이 **둘**이면 안 올린다 — 어느 쪽이 정상인지 우리가 못 가린다", () => {
  const input = buildNgPairFixture();
  input.connectors.push(connector("cPair2", "1", "4", { x: 2300000, y: 1500000, cx: 900000, cy: 3500000 }));
  const result = extractTechnicalTaskGraph(input);

  // 본보기가 실제로 그 모양이 됐는지 먼저 본다 — 아니면 아래가 공짜로 통과한다.
  const fromDecision = result.edges.filter((e) => e.fromNodeCode === "p1-1");
  assert.equal(fromDecision.length, 3, "판단에서 나가는 선이 셋이 아니다");

  for (const connectorId of ["cPair", "cPair2"]) {
    const edge = result.edges.find((e) => e.sourceConnectorId === connectorId);
    assert.equal(edge?.branchType, "DEFAULT", `${connectorId} 를 찍어서 정상으로 올렸다`);
    assert.equal(edge?.branchLabel, null);
  }
});

test("🔴 「정상」이 **이미 따로** 있으면 안 올린다 — 한 판단에 정상이 둘 생긴다", () => {
  const input = buildNgPairFixture();
  // cPair 에 「O.K.」를 붙이고(= 통일되어 정상), 이름 없는 선을 하나 더 낸다.
  input.shapes.push(shape("10", "O.K.", { x: 2050000, y: 2000000, cx: 300000, cy: 300000 }));
  input.connectors.push(connector("cPair2", "1", "4", { x: 2300000, y: 1500000, cx: 900000, cy: 3500000 }));
  const result = extractTechnicalTaskGraph(input);

  assert.equal(
    result.labelBindings.find((b) => b.labelText === "O.K.")?.connectorId,
    "cPair",
    "O.K. 가 제 선에 안 붙었다 — 본보기가 바뀌었다"
  );
  assert.equal(result.edges.find((e) => e.sourceConnectorId === "cPair")?.branchLabel, "정상");

  const extra = result.edges.find((e) => e.sourceConnectorId === "cPair2");
  assert.equal(extra?.branchType, "DEFAULT", "정상이 이미 있는데 또 올렸다 — 한 판단에 정상이 둘이다");
  assert.equal(extra?.branchLabel, null);
});

test("🔴 NG 가 **없으면** 안 올린다 — 이름 없는 선 둘은 갈림이 아니다", () => {
  // 실측에서 이 모양이 두 곳 있다(나가는 선 둘인데 이름이 하나도 없음). 조건 ①이
  // 없으면 여기서 아무 선이나 「정상」이 되고, 갈림이 아닌 것에 갈래 이름이 생긴다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) NG 가 없는 갈림",
    nodeCodePrefix: "p2",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 100000, y: 3000000, cx: 1000000, cy: 500000 }),
      shape("3", "사아자 작업", { x: 1500000, y: 3000000, cx: 1200000, cy: 500000 }),
    ],
    connectors: [
      connector("cL", "1", "2", { x: 600000, y: 1500000, cx: 0, cy: 1500000 }),
      connector("cR", "1", "3", { x: 2000000, y: 1500000, cx: 0, cy: 1500000 }),
    ],
  });

  assert.equal(excelEdges(result).length, 2, "본보기가 바뀌었다 — 나가는 선이 둘이 아니다");
  for (const edge of result.edges) {
    assert.equal(edge.branchType, "DEFAULT", `NG 가 없는데 갈래가 생겼다: ${edge.sourceConnectorId}`);
    assert.equal(edge.branchLabel, null);
  }
});

test("🔴 선의 **상자 가운데**로 재면 YES 가 엉뚱한 선을 고른다 — 그래서 선분 거리를 쓴다", () => {
  // 이 시험이 지키는 것은 결과가 아니라 **방법**이다. 본보기가 「가운데 거리로는
  // 틀리는」 모양인지를 여기서 못 박아 두지 않으면, 위 시험은 자가 바뀌어도
  // 계속 통과해 버린다(어떤 자로 재든 맞는 평범한 모양이 되면 그렇다).
  const input = buildMainFixture();
  const yesLabel = input.shapes.find((s) => s.text === "YES")!;
  const cA = input.connectors.find((c) => c.id === "cA")!;
  const cB = input.connectors.find((c) => c.id === "cB")!;

  assert.ok(
    distanceToConnectorBoxCenter(yesLabel, cB) < distanceToConnectorBoxCenter(yesLabel, cA),
    "본보기가 더 이상 「가운데 거리로는 틀리는」 모양이 아니다 — 시험이 무뎌졌다"
  );
  // 그런데 실제 결과는 cA 다(위 시험). 선분까지의 거리가 고른 값이라는 뜻이다.
  const result = extractTechnicalTaskGraph(input);
  assert.equal(result.labelBindings.find((b) => b.labelText === "YES")?.connectorId, "cA");
});

test("🔴 주석 영역이 걸러진다 — 글자가 든 상자는 경고까지 함께 올린다", () => {
  const result = extractTechnicalTaskGraph(buildMainFixture());

  assert.equal(result.annotationBoundaryX, 9000000);
  assert.ok(result.annotationBoundaryReason.includes("연결선을 하나도"));

  const annotated = result.droppedShapes.find((d) => d.shapeId === "30");
  assert.equal(annotated?.reason, "ANNOTATION_REGION");
  assert.ok(
    result.issues.some((i) => i.severity === "WARNING" && i.sourceReference === "shape#30"),
    "글자가 있는 도형을 주석으로 버리면서 경고를 안 올렸다"
  );

  // 빈 상자는 주석 영역에 있든 없든 노드가 될 수 없다 — 제목이 될 글자가 없다.
  assert.equal(result.droppedShapes.find((d) => d.shapeId === "31")?.reason, "EMPTY_BOX");

  // 주석 상자를 가리키던 선은 분기가 아니라 **주석선**이다.
  const droppedConnector = result.droppedConnectors.find((d) => d.connectorId === "cF");
  assert.equal(droppedConnector?.reason, "POINTS_AT_DROPPED_SHAPE");
  assert.equal(result.edges.some((e) => e.sourceConnectorId === "cF"), false);
});

test("🔴 오른쪽 덩어리가 **연결선을 내보내면** 주석이 아니다 — 경계를 안 세운다", () => {
  // 같은 모양인데 오른쪽 상자가 본문으로 선을 되돌려 보낸다. 좌표만 보면 주석처럼
  // 생겼지만, 주석 상자는 가리켜질 뿐 가리키지 않는다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 오른쪽에도 본문",
    nodeCodePrefix: "t2",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 9000000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("3", "사아자 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [
      connector("c1", "1", "2", { x: 2400000, y: 1200000, cx: 6600000, cy: 100000 }),
      connector("c2", "2", "3", { x: 2400000, y: 1500000, cx: 7600000, cy: 1500000, }, { flipH: true }),
    ],
  });

  assert.equal(result.annotationBoundaryX, null);
  assert.ok(result.annotationBoundaryReason.includes("시트 전체가 본문"));
  assert.equal(excelNodes(result).length, 3);
  assert.equal(result.droppedShapes.length, 0);
});

test("🔴 `(숫자)` 로 시작하는 상자는 다음 절차 참조로 읽힌다", () => {
  const result = extractTechnicalTaskGraph(buildMainFixture());

  const reference = result.nodes.find((n) => n.sourceShapeId === "14");
  assert.equal(reference?.nextProcedureStageNumber, "5");
  assert.equal(reference?.nodeType, "END");
  assert.ok(reference?.nodeTypeReason.includes("(5)"));

  // 번호로 시작하지 않는 상자는 참조가 아니다.
  assert.equal(result.nodes.find((n) => n.sourceShapeId === "11")?.nextProcedureStageNumber, null);
});

test("🔴 **대괄호로 감싼** 번호도 다음 절차 참조다 — 글자 가운데 있어도", () => {
  // 2026-11-05 결정. 실제 워크북에 「…확인후[(7) …] 실시」 꼴이 한 건 있고,
  // 그 노드는 다음 절차로 이어져야 한다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 대괄호 참조",
    nodeCodePrefix: "b1",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 확인", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 없는지 확인후[(7) 사아자 작업 및 개선 작업] 실시", {
        x: 400000,
        y: 3000000,
        cx: 2000000,
        cy: 500000,
      }),
    ],
    connectors: [connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })],
  });

  const reference = result.nodes.find((n) => n.sourceShapeId === "2");
  assert.equal(reference?.nextProcedureStageNumber, "7");
  assert.equal(reference?.nodeType, "END");
  assert.ok(result.issues.some((i) => i.sourceReference === `node:${reference!.nodeCode}`));
});

test("🔴 대괄호 **없이** 글자 가운데 있는 `(숫자)` 는 참조가 아니다 — 항목 번호다", () => {
  // 🔴 이것이 이 규칙의 알맹이다. 「걸린다」만 재면 가짜 양성을 영영 못 잡는다.
  //    실제 워크북에서 글자 가운데 번호가 있는 도형 셋 중 **둘이 항목 번호**였다
  //    (한 상자 안에서 소항목을 세는 「… 확인(1)…」 꼴). 넓게 잡으면 그 둘이
  //    참조로 둔갑해 엉뚱한 절차로 이어지고, 오류는 한 번도 안 난다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 항목 번호",
    nodeCodePrefix: "b2",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "2. 가나다 확인(1)6면 확인 판금 및 나사 이상 유무", {
        x: 400000,
        y: 1000000,
        cx: 2000000,
        cy: 500000,
      }),
      shape("2", "2. 가나다 확인(2)냉각수 라인 및 인터페이스 라인", {
        x: 400000,
        y: 3000000,
        cx: 2000000,
        cy: 500000,
      }),
    ],
    connectors: [connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })],
  });

  assert.equal(excelNodes(result).length, 2, "본보기가 노드 둘을 안 만들었다 — 시험이 공짜로 통과한다");
  for (const node of excelNodes(result)) {
    assert.equal(
      node.nextProcedureStageNumber,
      null,
      `항목 번호를 참조로 읽었다: "${node.title}"`
    );
  }
  // 이어가기 메모도 하나도 안 남아야 한다 — 남으면 할 일이 아닌 것이 할 일로 센다.
  assert.equal(
    result.issues.some((i) => i.issueType === "INVALID_NEXT_PROCEDURE_LINK"),
    false
  );
  // 분기도 그대로다 — 참조로 읽혔다면 1→2 분기가 버려졌을 것이다.
  assert.equal(excelEdges(result).length, 1);
});

test("🔴 대괄호 안에 번호가 둘이면 첫 번째를 쓰되 **모호하다고 알린다**", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 번호 둘",
    nodeCodePrefix: "b3",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 확인", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 뒤[(9) 사아자 작업, (10) 아자차 검사] 실시", {
        x: 400000,
        y: 3000000,
        cx: 2000000,
        cy: 500000,
      }),
    ],
    connectors: [connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })],
  });

  assert.equal(result.nodes.find((n) => n.sourceShapeId === "2")?.nextProcedureStageNumber, "9");
  assert.ok(
    result.issues.some((i) => i.message.includes("절차 번호가 2개")),
    "어느 쪽인지 못 가린다는 사실을 안 알렸다"
  );
});

test("🔴 이어가기를 **비워 뒀다는 사실**이 노드 코드로 되찾을 수 있게 남는다", () => {
  // 🔴 절차끼리 가리키는 관계가 순환해서, 만들 때는 이어가기를 비워 두고 나중에
  //    잇는다. 비웠다는 사실이 안 남으면 「원래 안 이어지는 절차」와 구별되지
  //    않고, 그러면 아무도 안 잇는다.
  const result = extractTechnicalTaskGraph(buildMainFixture());
  const reference = result.nodes.find((n) => n.sourceShapeId === "14")!;

  const note = result.issues.find((i) => i.sourceReference === `node:${reference.nodeCode}`);
  assert.ok(note, `노드 코드로 되찾을 메모가 없다 (${reference.nodeCode})`);
  assert.equal(note.issueType, "INVALID_NEXT_PROCEDURE_LINK");
  assert.equal(note.severity, "WARNING");
  assert.ok(note.message.includes("비워 두었습니다"));
  assert.ok(note.message.includes("(5)"), "몇 번 절차를 이어야 하는지가 메모에 없다");

  // 🔵 참조가 아닌 노드에는 이 메모가 안 붙는다 — 붙으면 할 일이 아닌 것이 할 일로 센다.
  const plainNode = result.nodes.find((n) => n.sourceShapeId === "11")!;
  assert.equal(
    result.issues.some((i) => i.sourceReference === `node:${plainNode.nodeCode}`),
    false
  );
});

test("🔴 `(숫자)` 상자에 나가는 선이 있으면 **그 분기를 포기하고** 이어가기를 건다 (2026-11-05 결정)", () => {
  // 🔴 2026-11-04~05 에 설계가 뒤집혔다. 그전에는 「나가는 선이 있으면 이어가기를
  //    못 건다(ERROR)」였고, 지금은 「이어가기를 걸고 그 분기를 버린다」다.
  //    버리는 쪽이 원본 흐름도에 있던 되돌아가기를 없애므로 **조용하면 안 된다.**
  //
  // 본보기: 참조 상자(1)에서 「NO」 분기가 앞 노드(2)로 되돌아간다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 참조에 나가는 선",
    nodeCodePrefix: "t3",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("2", "라마바 작업", { x: 400000, y: 400000, cx: 2000000, cy: 500000 }),
      shape("1", "(7) 가나다 절차 실시", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
      shape("3", "사아자 작업", { x: 3000000, y: 400000, cx: 2000000, cy: 500000 }),
      // 되돌아가는 선 위에 떠 있는 분기 이름.
      shape("9", "NO", { x: 2500000, y: 1600000, cx: 300000, cy: 300000 }),
    ],
    connectors: [
      connector("c0", "3", "1", { x: 3900000, y: 900000, cx: 0, cy: 2100000 }),
      // 1 → 2 되돌아가기. 참조 노드에서 나가므로 버려진다.
      connector("c1", "1", "2", { x: 2400000, y: 900000, cx: 0, cy: 2100000 }),
    ],
  });

  // ① 종료가 된다
  const reference = result.nodes.find((n) => n.sourceShapeId === "1");
  assert.equal(reference?.nodeType, "END");
  // ② 다음 절차를 가리킨다
  assert.equal(reference?.nextProcedureStageNumber, "7");
  // ③ 그 분기가 분기 목록에서 빠진다
  assert.equal(result.edges.some((e) => e.sourceConnectorId === "c1"), false);
  assert.deepEqual(excelEdges(result).map((e) => e.sourceConnectorId), ["c0"]);
  // ④ 🔴 버린 목록에 **까닭과 함께** 들어간다 — ③만 재면 「조용히 사라지는 것」과
  //    구별이 안 된다.
  const dropped = result.droppedConnectors.find((d) => d.connectorId === "c1");
  assert.equal(dropped?.reason, "ABANDONED_FOR_NEXT_PROCEDURE");
  assert.ok(dropped?.detail.includes("사라진다"), "「원본에 있던 흐름이 사라진다」가 까닭에 없다");
  assert.ok(dropped?.detail.includes("NO"), "어떤 분기가 사라졌는지가 까닭에 없다");

  // 메모는 ERROR 가 아니라 WARNING 이다(막힌 상태가 아니라 결정된 동작이다).
  // 🔴 다만 0건으로 조용해지면 안 된다.
  const note = result.issues.find((i) => i.issueType === "INVALID_NEXT_PROCEDURE_LINK");
  assert.equal(note?.severity, "WARNING");
  assert.ok(note?.message.includes("사라집니다"));

  // 그 분기에 붙어 있던 이름도 함께 사라진다는 사실이 도형 쪽에도 남는다.
  const label = result.droppedShapes.find((d) => d.shapeId === "9");
  assert.equal(label?.reason, "BRANCH_LABEL");
  assert.ok(label?.detail.includes("함께 사라진다"), `분기 이름의 행방이 안 적혔다: ${label?.detail}`);
});

test("노드 유형 — 판단 · 검사 · 조치 · 작업 · 종료가 각각 제 근거로 정해진다", () => {
  const result = extractTechnicalTaskGraph(buildMainFixture());
  const typeByShapeId = new Map(result.nodes.map((n) => [n.sourceShapeId, n.nodeType]));

  assert.equal(typeByShapeId.get("10"), "DECISION"); // 분기 이름이 붙은 선이 나간다
  assert.equal(typeByShapeId.get("12"), "END"); // 나가는 선이 없다
  assert.equal(typeByShapeId.get("11"), "INSPECTION"); // 글자에 점검
  assert.equal(typeByShapeId.get("13"), "CORRECTIVE_ACTION"); // 글자에 교환
  assert.equal(typeByShapeId.get("15"), "TASK"); // 어디에도 안 걸린다
  assert.equal(typeByShapeId.get("14"), "END");

  // 🔴 **엑셀에서 읽은 상자는 하나도 START 가 되지 않는다.** START 는 실행이
  //    시작되는 순간 자동으로 완료 처리되는 표식이라, 진짜 작업이 그리로 가면
  //    실행 목록에서 통째로 사라진다. 시작 노드는 **따로 더한다**(아래 전용 시험).
  assert.equal(excelNodes(result).some((n) => n.nodeType === "START"), false);
});

test("🔴 노드 제목 = **엑셀 도형 글자 그대로**, 줄바꿈까지 (2026-11-05 사용자 요구)", () => {
  // 사용자: "원본 엑셀에서의 내용과 노드의 제목의 내용이 같도록 하는게 목표야.
  //          원본에서 줄바꿈이 되어 있다면 노드에서도 줄바꿈이 되어 있어야 해."
  //
  // 🔴 **두 줄짜리 표본으로 잰다.** 한 줄짜리로만 재면 줄바꿈을 공백으로 합쳐도
  //    통과해 버린다 — 그러면 이 시험은 아무것도 안 무는 것이다.
  const result = extractTechnicalTaskGraph(buildMainFixture());

  const multiline = result.nodes.find((n) => n.sourceShapeId === "13");
  assert.equal(multiline?.title, "사아자 부품 교환\n(마바사 기준)");
  assert.ok(multiline!.title.includes("\n"), "줄바꿈이 사라졌다");
  assert.equal(multiline!.title.split("\n").length, 2, "줄이 합쳐졌거나 늘었다");

  // 🔴 「설명과 같다」 — 둘이 어긋나면 같은 노드가 자리마다 다르게 읽힌다.
  assert.equal(multiline?.title, multiline?.description);
});

test("🔴 `*` 로 시작하는 줄도 **제목에 그대로 남는다** — 원본 글자의 일부다", () => {
  const result = extractTechnicalTaskGraph(buildMainFixture());
  const task = result.nodes.find((n) => n.sourceShapeId === "15");

  assert.equal(task?.title, "타파하 준비\n*아아 주의");
  assert.equal(task?.title, task?.description);
  // 🔵 `safetyCaution` 은 그 줄을 **따로 복사해** 담는다(빼는 것이 아니라 더하는
  //    것이라 「원본과 같다」가 안 깨진다).
  assert.equal(task?.safetyCaution, "*아아 주의");
  // 🔵 `instructions` 는 주의 줄을 뺀 본문이다 — 제목·설명과 뜻이 다른 칸이라
  //    여기만 다듬는다(이 조각에서 바꾸지 않은 기존 동작).
  assert.equal(task?.instructions, "타파하 준비");
});

test("🔴 모든 노드에서 제목과 설명이 글자 그대로 같다", () => {
  // 하나만 재면 다른 갈래(빈 글자 · 한 줄 · 여러 줄)에서 어긋나도 안 잡힌다.
  for (const input of [buildMainFixture(), buildCaptionHeavyFixture()]) {
    const result = extractTechnicalTaskGraph(input);
    const fromExcel = excelNodes(result);
    assert.ok(fromExcel.length > 0, `${input.sheetName}: 표본이 비었다`);
    for (const node of fromExcel) {
      assert.equal(node.title, node.description, `${node.nodeCode}: 제목과 설명이 다르다`);
    }
  }
});

test("🔴 분기 어휘가 적혔어도 **연결선이 가리키는** 도형이면 노드다", () => {
  // "정상" 한 낱말만 든 진짜 작업 상자가 있다. 글자만 보고 분기 이름으로 먹으면
  // 그 작업이 통째로 사라진다 — 연결선의 끝인지를 함께 본다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 분기 어휘를 쓴 노드",
    nodeCodePrefix: "t4",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 확인", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "정상", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })],
  });

  assert.equal(excelNodes(result).length, 2);
  assert.equal(result.nodes.find((n) => n.sourceShapeId === "2")?.title, "정상");
  assert.equal(result.labelBindings.length, 0);
});

test("🔴 똑같이 떨어진 선이 둘이면 「거의 비김」으로 올린다 — 조용히 하나를 고르지 않는다", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 비긴 라벨",
    nodeCodePrefix: "t5",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 판단", { x: 400000, y: 100000, cx: 1600000, cy: 300000 }),
      shape("2", "라마바 작업", { x: 200000, y: 1500000, cx: 1000000, cy: 300000 }),
      shape("3", "사아자 작업", { x: 1200000, y: 1500000, cx: 1000000, cy: 300000 }),
      // 두 선의 한가운데에 똑같이 떨어져 떠 있는 라벨.
      shape("9", "NG", { x: 900000, y: 850000, cx: 200000, cy: 300000 }),
    ],
    connectors: [
      connector("c1", "1", "2", { x: 800000, y: 400000, cx: 0, cy: 1100000 }),
      connector("c2", "1", "3", { x: 1200000, y: 400000, cx: 0, cy: 1100000 }),
    ],
  });

  assert.equal(result.labelBindings.length, 1);
  const binding = result.labelBindings[0];
  assert.equal(binding.distance, binding.runnerUpDistance);
  assert.equal(binding.confident, false, "완전히 비긴 라벨이 「확실」로 통과했다");
  assert.ok(result.issues.some((i) => i.issueType === "AMBIGUOUS_LABEL_EDGE_MATCH"));
});

test("🔴 붙일 선을 못 찾은 분기 이름은 버리되 경고로 남긴다", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 떠 있는 라벨",
    nodeCodePrefix: "t6",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
      // 선에서 제 상자 크기보다 훨씬 멀리 떨어진 라벨.
      shape("9", "NG", { x: 20000000, y: 20000000, cx: 300000, cy: 300000 }),
    ],
    connectors: [connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })],
  });

  assert.equal(result.labelBindings.length, 0);
  const dropped = result.droppedShapes.find((d) => d.shapeId === "9");
  assert.equal(dropped?.reason, "BRANCH_LABEL");
  assert.ok(dropped?.detail.includes("못 찾았다"));
  assert.ok(result.issues.some((i) => i.issueType === "AMBIGUOUS_LABEL_EDGE_MATCH"));
  // 이름을 못 받은 분기는 기본 경로로 남는다 — 분기 자체가 사라지지는 않는다.
  assert.equal(excelEdges(result).length, 1);
  assert.equal(excelEdges(result)[0].branchType, "DEFAULT");
});

test("🔴 같은 도형 번호가 두 번 나오면 뒤엣것을 버리고 오류로 올린다", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 번호 중복",
    nodeCodePrefix: "t7",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("1", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [],
  });

  assert.equal(excelNodes(result).length, 1);
  assert.equal(excelNodes(result)[0].title, "가나다 작업");
  assert.equal(result.droppedShapes[0]?.reason, "DUPLICATE_SHAPE_ID");
  assert.ok(result.issues.some((i) => i.issueType === "DUPLICATE_NODE_CODE" && i.severity === "ERROR"));
});

// ── 끊어진 선 끝을 좌표로 이어 붙이기 (2026-11-05 사용자 지적) ────────────

/**
 * 세로로 선 상자 셋을 선 둘로 잇되, **둘째 선의 시작을 비워 둔다**(엑셀에서 끝만
 * 도형에 붙이고 시작은 허공에 그린 꼴). 실측으로 한 시트의 연결선 6개 중 넷이
 * 그랬고, 받는 쪽이 전부 뿌리가 되어 시작에서 흩어지는 그림이 나왔다.
 */
function buildDanglingStartFixture(): TechnicalTaskGraphInput {
  return {
    sheetName: "(TEST) 시작이 끊긴 선",
    nodeCodePrefix: "r1",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
      shape("3", "사아자 작업", { x: 400000, y: 5000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [
      connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 }),
      // 🔴 시작이 비었다. 선은 상자 2 의 아래 가장자리에서 시작해 상자 3 으로 간다.
      connector("c2", null, "3", { x: 1400000, y: 3500000, cx: 0, cy: 1500000 }),
    ],
  };
}

test("🔴 끊어진 **시작**을 좌표로 이어 붙인다 — 안 그러면 받는 쪽이 뿌리가 된다", () => {
  const result = extractTechnicalTaskGraph(buildDanglingStartFixture());

  const rebound = result.reboundEndpoints;
  assert.equal(rebound.length, 1);
  assert.equal(rebound[0].connectorId, "c2");
  assert.equal(rebound[0].side, "START");
  assert.equal(rebound[0].shapeId, "2", "엉뚱한 상자에 붙였다");
  assert.ok(rebound[0].confident);

  // 흐름이 한 줄기로 선다 — 시작 노드에서 나가는 분기가 **하나**다.
  const startEdges = result.edges.filter((e) => e.fromNodeCode === "r1-start");
  assert.deepEqual(startEdges.map((e) => e.toNodeCode), ["r1-1"]);
  assert.deepEqual(
    excelEdges(result).map((e) => [e.fromNodeCode, e.toNodeCode]),
    [
      ["r1-1", "r1-2"],
      ["r1-2", "r1-3"],
    ]
  );
});

test("🔴 끊어진 **끝**도 이어 붙인다 — 한쪽만 다루면 절반이 그대로 남는다", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 끝이 끊긴 선",
    nodeCodePrefix: "r2",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [connector("c1", "1", null, { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })],
  });

  assert.equal(result.reboundEndpoints[0]?.side, "END");
  assert.equal(result.reboundEndpoints[0]?.shapeId, "2");
  assert.deepEqual(
    excelEdges(result).map((e) => [e.fromNodeCode, e.toNodeCode]),
    [["r2-1", "r2-2"]]
  );
});

test("🔴 **너무 먼** 끝은 안 붙인다 — 가까우면 무엇이든 붙이면 흐름이 조용히 엉뚱해진다", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 멀리 떨어진 끝",
    nodeCodePrefix: "r3",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    // 상자들에서 한참 떨어진 곳에 떠 있는 선.
    connectors: [connector("c9", null, null, { x: 40000000, y: 40000000, cx: 0, cy: 500000 })],
  });

  assert.deepEqual(result.reboundEndpoints, []);
  assert.equal(result.droppedConnectors[0]?.reason, "UNRESOLVED_ENDPOINT");
});

test("🔴 **자기 자신**으로는 안 붙인다", () => {
  // 반대쪽 끝이 이미 상자 1 이면, 끊어진 끝을 상자 1 에 붙여 자기 고리를 만들면 안 된다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 자기 고리 위험",
    nodeCodePrefix: "r4",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 3000000 }),
      shape("2", "라마바 작업", { x: 400000, y: 5000000, cx: 2000000, cy: 500000 }),
    ],
    // 끝은 상자 1 에 묶여 있고, 시작이 상자 1 **안쪽**에서 비어 있다.
    connectors: [connector("c1", null, "1", { x: 1400000, y: 2000000, cx: 0, cy: 500000 })],
  });

  assert.equal(result.reboundEndpoints.every((r) => r.shapeId !== "1"), true, "자기 자신에 붙였다");
});

test("🔴 이어 붙인 사실이 **메모로 남는다** — 엑셀에 적힌 연결과 믿음의 정도가 다르다", () => {
  const result = extractTechnicalTaskGraph(buildDanglingStartFixture());
  const note = result.issues.find((i) => i.sourceReference === "connector#c2");

  assert.ok(note, "좌표로 추측한 연결인데 아무 말도 안 남겼다");
  assert.equal(note.issueType, "DANGLING_CONNECTOR");
  assert.ok(note.message.includes("좌표로"));
  assert.ok(note.message.includes("라마바 작업"), "어느 도형에 붙였는지가 메모에 없다");
});

// ── 글자 없는 「이음목」 (2026-11-05) ──────────────────────────────────────
//
// 🔴 **고친 결함**: 글자 없는 작은 네모가 EMPTY_BOX 로 버려지면서 거기 닿던 선이
//    전부 함께 버려져, `(5)통전검사(3상입력)` 의 **NG 가지 넷이 통째로 사라졌다.**
//    네 점검 상자가 「아래로 선 하나뿐」인 INSPECTION 이 되고, 갈 곳 잃은 「NG」
//    글자 셋이 경고로 남고, 하나는 엉뚱한 선에 붙어 MISSING_OUTGOING_PATH 를 냈다.

/**
 * 이음목 본보기 — 실측 `(5)통전검사(3상입력)` 의 모양을 줄여 옮겼다(글자는 가짜).
 *
 *   점검 상자(1) ──아래──▶ 다음 작업(2)          ← 이름 없는 기본 선 c1
 *        └──오른쪽──▶ **글자 없는 네모(90)** ──▶ …  ← NG 선 c2 (그 위에 「NG」 글자 80)
 *
 * 🔵 이음목 건너편의 배선만 시험마다 갈아 끼운다 — 한 줄로 이어지는지, 연달아
 * 있는지, 둘로 갈라지는지, 고리를 이루는지가 이 규칙의 네 갈래 전부다.
 */
function buildPassThroughFixture(options: {
  sheetName: string;
  nodeCodePrefix: string;
  junctionShapes: TechnicalTaskShapeInput[];
  junctionConnectors: TechnicalTaskConnectorInput[];
}): TechnicalTaskGraphInput {
  return {
    sheetName: options.sheetName,
    nodeCodePrefix: options.nodeCodePrefix,
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 전원 점검", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업 실시", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
      shape("3", "사아자 기판 교환", { x: 400000, y: 5000000, cx: 2000000, cy: 500000 }),
      // 🔴 분기 이름은 **c2 선분 위**에 떠 있다. 이어 붙인 뒤에도 선이 그려진 자리가
      //    그대로여야 이 글자가 제 선을 찾는다 — 그 자리를 옮기면 지금 고치는 결함이
      //    모양만 바꿔 되살아난다(「NG」가 엉뚱한 선으로 간다).
      shape("80", "NG", { x: 3000000, y: 1050000, cx: 400000, cy: 300000 }),
      ...options.junctionShapes,
    ],
    connectors: [
      connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 }),
      connector("c2", "1", "90", { x: 2400000, y: 1200000, cx: 1600000, cy: 0 }),
      ...options.junctionConnectors,
    ],
  };
}

/** 글자 없는 작은 네모 하나. 이음목이 되는지는 **닿는 선의 모양**이 정한다. */
function emptyJunction(id: string, y: number): TechnicalTaskShapeInput {
  return shape(id, "", { x: 4000000, y, cx: 200000, cy: 200000 });
}

test("🔴 본보기가 비어 있지 않다 — 이음목 시험이 무엇을 재는지 먼저 못 박는다", () => {
  const input = buildPassThroughFixture({
    sheetName: "(TEST) 이음목 본보기",
    nodeCodePrefix: "j0",
    junctionShapes: [emptyJunction("90", 1100000)],
    junctionConnectors: [connector("c3", "90", "3", { x: 1400000, y: 1300000, cx: 2700000, cy: 3700000, })],
  });

  // ① 빈 네모가 **진짜 비어 있다**(이 글자가 차 있으면 아래 시험이 전부 공짜로 통과한다)
  assert.equal(input.shapes.find((s) => s.id === "90")?.text, "");
  // ② 그 네모에 선이 **들어오고 나간다**
  assert.deepEqual(
    input.connectors.filter((c) => c.toShapeId === "90").map((c) => c.id),
    ["c2"]
  );
  assert.deepEqual(
    input.connectors.filter((c) => c.fromShapeId === "90").map((c) => c.id),
    ["c3"]
  );
  // ③ 「NG」 글자가 **c2 선분 위**에 있다 — 다른 선보다 압도적으로 가깝다
  const c2 = input.connectors.find((c) => c.id === "c2")!;
  const c1 = input.connectors.find((c) => c.id === "c1")!;
  const label = input.shapes.find((s) => s.id === "80")!;
  assert.ok(
    distanceToConnectorBoxCenter(label, c2) < distanceToConnectorBoxCenter(label, c1),
    "본보기의 「NG」가 애초에 c2 쪽이 아니다"
  );
});

test("🔴 이음목은 **노드가 되지 않고**, 들어오던 선이 건너편으로 이어 붙는다", () => {
  const result = extractTechnicalTaskGraph(
    buildPassThroughFixture({
      sheetName: "(TEST) 이음목 하나",
      nodeCodePrefix: "j1",
      junctionShapes: [emptyJunction("90", 1100000)],
      junctionConnectors: [connector("c3", "90", "3", { x: 1400000, y: 1300000, cx: 2700000, cy: 3700000 })],
    })
  );

  // 🔴 노드는 **엑셀 상자 셋 그대로**다 — 이음목이 노드로 둔갑하면 안 된다.
  assert.deepEqual(excelNodes(result).map((n) => n.nodeCode), ["j1-1", "j1-2", "j1-3"]);

  // 🔴 NG 가지가 살아났다. 도착지는 이음목 **건너편**이다.
  assert.deepEqual(
    excelEdges(result).map((e) => [e.fromNodeCode, e.toNodeCode, e.branchType]),
    [
      // 짝 규칙이 이름 없는 쪽을 「정상」으로 올린다(NG 형제가 생겼으므로).
      ["j1-1", "j1-2", "NORMAL"],
      ["j1-1", "j1-3", "NG"],
    ]
  );

  // 🔴 그 결과 점검 상자가 **판단**이 된다 — 고치기 전에는 선이 아래로 하나뿐이라
  //    INSPECTION 이었다.
  assert.equal(result.nodes.find((n) => n.nodeCode === "j1-1")?.nodeType, "DECISION");

  // 이음목에서 **나가던** 선은 소비된다 — 따로 분기가 되지 않는다.
  const consumed = result.droppedConnectors.find((d) => d.connectorId === "c3");
  assert.equal(consumed?.reason, "PASS_THROUGH_JUNCTION");
  assert.ok(consumed!.detail.includes("두 번 그려진다"));

  // 버린 도형에 그 사실이 남는다 — 상자는 버렸지만 흐름은 살아 있다.
  const droppedJunction = result.droppedShapes.find((d) => d.shapeId === "90");
  assert.equal(droppedJunction?.reason, "EMPTY_BOX");
  assert.ok(droppedJunction!.detail.includes("이음목"), "건너뛴 사실이 조용히 사라졌다");

  // 메모 한 줄 — 어느 선이 어느 이음목을 지나 어디로 갔는지.
  const note = result.issues.find(
    (i) => i.sourceReference === "connector#c2" && i.message.includes("이음목")
  );
  assert.equal(note?.severity, "INFO");
  assert.equal(note?.issueType, "DANGLING_CONNECTOR");
  assert.ok(note!.message.includes("shape#90"));
  assert.ok(note!.message.includes("사아자 기판 교환"), "어디로 이었는지가 메모에 없다");
});

test("🔴 **들어오기만 하는** 빈 도형은 그대로 버린다 — 사진 꼬리표이지 이음목이 아니다", () => {
  /**
   * 🔴 이 시험이 없으면 「빈 도형이면 전부 잇는다」라는 **더 넓은 규칙도 통과한다.**
   * 실측으로 빈 도형은 여섯 시트에 있는데 다섯 시트(`(12)` 12개 · `(2)` 5개 · `(1)`
   * `(6)` `(MB)고장 접수` 각 1개)의 것은 **나가는 선이 없는 사진 꼬리표**이고, 그
   * 시트들의 노드 수는 사용자가 눈으로 확인해 준 확정값이다.
   */
  const input: TechnicalTaskGraphInput = {
    sheetName: "(TEST) 사진 꼬리표",
    nodeCodePrefix: "j2",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 전원 점검", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업 실시", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
      // 본문 상자들과 같은 x 띠에 둔다 — 주석 영역 규칙이 먼저 걷어 가지 않도록.
      shape("90", "", { x: 1000000, y: 5000000, cx: 800000, cy: 800000 }),
    ],
    connectors: [
      connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 }),
      // 본문에서 사진 상자를 **짚는** 선. 거기서 나가는 선은 없다.
      connector("c2", "2", "90", { x: 1400000, y: 3500000, cx: 0, cy: 1500000 }),
    ],
  };
  // 재는 대상이 실제로 「들어오기만 하는 빈 도형」인지 먼저 못 박는다.
  assert.equal(input.shapes.find((s) => s.id === "90")?.text, "");
  assert.equal(input.connectors.filter((c) => c.toShapeId === "90").length, 1);
  assert.equal(input.connectors.filter((c) => c.fromShapeId === "90").length, 0);

  const result = extractTechnicalTaskGraph(input);

  assert.deepEqual(excelNodes(result).map((n) => n.nodeCode), ["j2-1", "j2-2"]);
  assert.deepEqual(
    excelEdges(result).map((e) => [e.fromNodeCode, e.toNodeCode]),
    [["j2-1", "j2-2"]]
  );

  const droppedBox = result.droppedShapes.find((d) => d.shapeId === "90");
  assert.equal(droppedBox?.reason, "EMPTY_BOX");
  assert.ok(!droppedBox!.detail.includes("이음목"), "사진 꼬리표를 이음목으로 읽었다");

  // 🔴 그 선은 **지금까지와 똑같이** 버려진다 — 이음목 갈래로 새지 않는다.
  const droppedConnector = result.droppedConnectors.find((d) => d.connectorId === "c2");
  assert.equal(droppedConnector?.reason, "POINTS_AT_DROPPED_SHAPE");
  assert.equal(
    result.droppedConnectors.filter((d) => d.reason === "PASS_THROUGH_JUNCTION").length,
    0
  );
});

test("🔴 이음목이 **연달아** 있어도 끝까지 따라간다 — 실측 74 → 77 → 12", () => {
  const result = extractTechnicalTaskGraph(
    buildPassThroughFixture({
      sheetName: "(TEST) 연달은 이음목",
      nodeCodePrefix: "j3",
      junctionShapes: [emptyJunction("90", 1100000), emptyJunction("91", 2200000)],
      junctionConnectors: [
        connector("c3", "90", "91", { x: 4000000, y: 1300000, cx: 100000, cy: 900000 }),
        connector("c4", "91", "3", { x: 1400000, y: 2400000, cx: 2700000, cy: 2600000 }),
      ],
    })
  );

  assert.deepEqual(excelNodes(result).map((n) => n.nodeCode), ["j3-1", "j3-2", "j3-3"]);
  assert.deepEqual(
    excelEdges(result).map((e) => [e.fromNodeCode, e.toNodeCode, e.branchType]),
    [
      ["j3-1", "j3-2", "NORMAL"],
      ["j3-1", "j3-3", "NG"],
    ]
  );
  // 이음목에서 나가던 선 **둘 다** 소비된다.
  assert.deepEqual(
    result.droppedConnectors.filter((d) => d.reason === "PASS_THROUGH_JUNCTION").map((d) => d.connectorId),
    ["c3", "c4"]
  );
  // 메모에 **지나온 이음목이 차례대로** 적힌다 — 하나만 적으면 가운데가 숨는다.
  const note = result.issues.find((i) => i.sourceReference === "connector#c2")!;
  assert.ok(note.message.includes("shape#90 → shape#91"), note.message);
});

test("🔴 나가는 선이 **둘인** 이음목은 안 건드린다 — 어느 쪽으로 이을지 못 정한다", () => {
  const result = extractTechnicalTaskGraph(
    buildPassThroughFixture({
      sheetName: "(TEST) 갈라지는 이음목",
      nodeCodePrefix: "j4",
      junctionShapes: [emptyJunction("90", 1100000)],
      junctionConnectors: [
        connector("c3", "90", "3", { x: 1400000, y: 1300000, cx: 2700000, cy: 3700000 }),
        connector("c4", "90", "2", { x: 1400000, y: 1300000, cx: 2700000, cy: 1700000 }),
      ],
    })
  );

  // 🔴 **고치기 전 그대로**다. 찍어서 한쪽을 고르면 흐름이 조용히 틀린다.
  assert.deepEqual(
    excelEdges(result).map((e) => [e.fromNodeCode, e.toNodeCode, e.branchType]),
    [["j4-1", "j4-2", "DEFAULT"]]
  );
  assert.equal(
    result.droppedConnectors.filter((d) => d.reason === "PASS_THROUGH_JUNCTION").length,
    0,
    "이을 수 없는 이음목을 이었다"
  );
  assert.deepEqual(
    result.droppedConnectors.filter((d) => d.reason === "POINTS_AT_DROPPED_SHAPE").map((d) => d.connectorId),
    ["c2", "c3", "c4"]
  );

  // 🔴 그래도 **조용하지는 않다** — 들어오던 흐름이 사라진다는 사실을 올린다.
  const warning = result.issues.find((i) => i.sourceReference === "shape#90");
  assert.equal(warning?.severity, "WARNING");
  assert.equal(warning?.issueType, "UNSUPPORTED_OBJECT");
  assert.ok(warning!.message.includes("정할 수 없어"), warning!.message);
});

test("🔴 이음목끼리 **고리**를 이루면 멈추고 버리고 알린다 — 조용히 사라지면 안 된다", () => {
  const result = extractTechnicalTaskGraph(
    buildPassThroughFixture({
      sheetName: "(TEST) 이음목 고리",
      nodeCodePrefix: "j5",
      junctionShapes: [emptyJunction("90", 1100000), emptyJunction("91", 2200000)],
      junctionConnectors: [
        connector("c3", "90", "91", { x: 4000000, y: 1300000, cx: 100000, cy: 900000 }),
        // 🔴 되돌아간다 — 따라가는 것을 안 멈추면 영영 돈다.
        connector("c4", "91", "90", { x: 4100000, y: 1300000, cx: 100000, cy: 900000 }),
        // 상자 3 이 흐름 밖으로 떨어지지 않게 본문에서 이어 둔다.
        connector("c5", "2", "3", { x: 1400000, y: 3500000, cx: 0, cy: 1500000 }),
      ],
    })
  );

  assert.deepEqual(
    excelEdges(result).map((e) => [e.fromNodeCode, e.toNodeCode]),
    [
      ["j5-1", "j5-2"],
      ["j5-2", "j5-3"],
    ]
  );
  const dropped = result.droppedConnectors.find((d) => d.connectorId === "c2");
  assert.equal(dropped?.reason, "PASS_THROUGH_JUNCTION");
  assert.ok(dropped!.detail.includes("고리"), dropped!.detail);

  const warning = result.issues.find(
    (i) => i.sourceReference === "connector#c2" && i.message.includes("고리")
  );
  assert.equal(warning?.severity, "WARNING");
  assert.ok(warning!.message.includes("사라집니다"), warning!.message);
});

// ── 흐름에 닿지 않는 도형 (2026-11-05 사용자 지적) ────────────────────────

/**
 * 사용자: 「사진이 들어가 있는 박스는 첨부파일일 뿐이고 노드가 아니야.」
 *
 * 🔴 **구조만 베낀 본보기**다 — 실제 시트의 모양(연결선이 닿는 상자 7 + 사진 캡션
 * 13 + 분기 이름 2 = 도형 22)을 그대로 옮기되 글자는 전부 지어냈다. 그 시트는
 * 사람이 「노드는 일곱뿐」이라고 직접 확인해 준 자리라, 숫자를 여기 박아 둔다.
 */
function buildCaptionHeavyFixture(): TechnicalTaskGraphInput {
  const shapes: TechnicalTaskShapeInput[] = [];
  const connectors: TechnicalTaskConnectorInput[] = [];

  // 흐름 — 작업 넷이 한 줄로 이어지고, 판단 하나에서 YES/NO 로 갈린다 (= 일곱).
  const flowTitles = ["가나다 확인", "라마바 확인", "사아자 확인", "아자차 확인"];
  flowTitles.forEach((title, i) => {
    shapes.push(shape(`f${i}`, title, { x: 400000, y: 1000000 + i * 1000000, cx: 2000000, cy: 500000 }));
    if (i > 0) {
      connectors.push(
        connector(`e${i}`, `f${i - 1}`, `f${i}`, {
          x: 1400000,
          y: 1500000 + (i - 1) * 1000000,
          cx: 0,
          cy: 500000,
        })
      );
    }
  });
  shapes.push(shape("d", "차카타 문제 발견시 진행 여부", { x: 400000, y: 5000000, cx: 2000000, cy: 500000 }));
  shapes.push(shape("y", "타파하 그대로 진행", { x: 100000, y: 6200000, cx: 1200000, cy: 500000 }));
  shapes.push(shape("n", "파하가 교환 후 진행", { x: 1800000, y: 6200000, cx: 1200000, cy: 500000 }));
  connectors.push(connector("e4", "f3", "d", { x: 1400000, y: 4500000, cx: 0, cy: 500000 }));
  connectors.push(connector("ey", "d", "y", { x: 700000, y: 5500000, cx: 0, cy: 700000 }, { flipH: true }));
  connectors.push(connector("en", "d", "n", { x: 1400000, y: 5500000, cx: 1000000, cy: 700000 }));
  // 분기 이름 둘 — 각 선 옆에.
  shapes.push(shape("lblY", "YES", { x: 500000, y: 5700000, cx: 300000, cy: 300000 }));
  shapes.push(shape("lblN", "NO", { x: 1900000, y: 5700000, cx: 300000, cy: 300000 }));

  // 사진 캡션 13개 — 어떤 연결선도 안 닿는다. 글자 길이는 한 글자부터 긴 것까지
  // 섞여 있다(길이로는 못 가른다는 뜻이기도 하다).
  const captions = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차카 라인", "타파 파손 유무 확인", "하거", "너더러 장착품 및 지그"];
  captions.forEach((text, i) => {
    shapes.push(shape(`cap${i}`, text, { x: 5000000 + (i % 3) * 900000, y: 1000000 + Math.floor(i / 3) * 700000, cx: 800000, cy: 400000 }));
  });

  return { sheetName: "(TEST) 캡션 많은 시트", nodeCodePrefix: "cap", startNodeTitle: "가상 절차", shapes, connectors };
}

test("🔴 사진 캡션 상자는 노드가 아니다 — 도형 22개에서 **엑셀 노드는 일곱**", () => {
  const input = buildCaptionHeavyFixture();
  assert.equal(input.shapes.length, 22, "본보기 모양이 바뀌었다 — 시험이 무엇을 재는지 다시 봐야 한다");

  const result = extractTechnicalTaskGraph(input);
  assert.equal(excelNodes(result).length, 7, "사람이 확인해 준 숫자(일곱)와 다르다");
  assert.equal(result.droppedShapes.filter((d) => d.reason === "NOT_IN_FLOW").length, 13);
  // 🔵 분기 이름 둘은 **그보다 먼저** 걸러져 이 갈래로 안 샌다.
  assert.equal(result.droppedShapes.filter((d) => d.reason === "BRANCH_LABEL").length, 2);
  // 아무것도 조용히 안 사라진다.
  assert.equal(excelNodes(result).length + result.droppedShapes.length, input.shapes.length);
});

test("🔴 연결선이 **닿는** 도형은 이 규칙으로 안 버려진다 — 버려진 선이 닿은 것도 닿은 것이다", () => {
  // 주석선이 가리키는 상자는 사람이 **일부러 흐름에 붙인** 것이라 캡션과 다르다.
  // 그 상자는 제 까닭(빈 상자)으로 가려져야지, 「흐름에 안 닿음」이 되면 안 된다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 주석선이 닿는 빈 상자",
    nodeCodePrefix: "n1",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 확인", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 확인", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
      shape("9", "", { x: 6000000, y: 1000000, cx: 2000000, cy: 2000000 }),
    ],
    connectors: [
      connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 }),
      connector("c2", "1", "9", { x: 2400000, y: 1200000, cx: 3600000, cy: 300000 }),
    ],
  });

  assert.equal(result.droppedShapes.find((d) => d.shapeId === "9")?.reason, "EMPTY_BOX");
  assert.equal(result.droppedShapes.some((d) => d.reason === "NOT_IN_FLOW"), false);
  assert.equal(excelNodes(result).length, 2);
});

/**
 * 고립 도형 하나가 든 똑같은 시트를, 「끝이 안 묶인 선」만 넣고 빼서 두 번 읽는다.
 * `unbound` 가 true 면 끝이 한쪽만 묶인 선을 하나 더한다.
 */
function buildSheetWithIsolatedShape(unbound: boolean): TechnicalTaskGraphInput {
  const connectors = [connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })];
  if (unbound) {
    // 🔴 도형에서 **한참 떨어진 곳**에 그려진 선이다. 2026-11-05 부터 끊어진 끝은
    //    좌표로 이어 붙이므로(rebindDanglingEndpoints), 가까이 두면 그 자리에서
    //    묶여 버려 이 시험이 재려던 상황이 아예 안 생긴다 — 「이어 붙이지도 못한
    //    끝이 남았다」가 고립 규칙을 끄는 조건이다.
    connectors.push(connector("c2", null, "2", { x: 50000000, y: 50000000, cx: 0, cy: 1500000 }));
  }
  return {
    sheetName: unbound ? "(TEST) 안 묶인 선 있음" : "(TEST) 안 묶인 선 없음",
    nodeCodePrefix: unbound ? "u1" : "u0",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
      // 어떤 선도 안 닿는 상자 하나. 🔵 **본문과 같은 가로 자리**에 둔다 — 오른쪽
      //    멀리 두면 「주석 영역」 규칙이 먼저 집어 가서 이 시험이 그쪽을 재게 된다.
      shape("9", "사아자 상자", { x: 400000, y: 6000000, cx: 2000000, cy: 400000 }),
    ],
    connectors,
  };
}

test("🔴 끝이 안 묶인 선이 **없으면** 고립 도형을 버린다", () => {
  const result = extractTechnicalTaskGraph(buildSheetWithIsolatedShape(false));

  assert.equal(result.isolationRuleSkippedReason, null);
  assert.equal(result.droppedShapes.find((d) => d.shapeId === "9")?.reason, "NOT_IN_FLOW");
  assert.equal(excelNodes(result).length, 2);
});

test("🔴 끝이 안 묶인 선이 **있으면** 고립 도형을 노드로 남긴다 (2026-11-05 결정)", () => {
  // 안 묶인 선은 **연결 정보가 불완전하다**는 신호다 — 사람 눈에는 닿아 있는데
  // 파일에 기록이 없을 뿐일 수 있다. 그런 시트에서 「안 닿는다」를 믿으면 진짜
  // 작업 단계가 사라진다(실측: (MB) 통전검사에서 둘이 사라졌다).
  const result = extractTechnicalTaskGraph(buildSheetWithIsolatedShape(true));

  assert.equal(result.droppedShapes.some((d) => d.reason === "NOT_IN_FLOW"), false);
  assert.equal(excelNodes(result).length, 3, "고립 도형이 노드로 안 남았다");
  assert.ok(excelNodes(result).some((n) => n.sourceShapeId === "9"));
});

test("🔴 **끈 사실을 남긴다** — 조용히 끄면 진짜 캡션이 섞여도 아무도 모른다", () => {
  const result = extractTechnicalTaskGraph(buildSheetWithIsolatedShape(true));

  assert.ok(result.isolationRuleSkippedReason, "껐는데 까닭이 안 남았다");
  assert.ok(result.isolationRuleSkippedReason.includes("끝이 안 묶인 연결선이 1개"));
  const note = result.issues.find((i) => i.message === result.isolationRuleSkippedReason);
  assert.ok(note, "DB 에 남을 메모가 없다");
  // 🔵 갈래가 갈린다 — 이쪽은 「이 판정만 못 믿는다」(INFO)이고,
  //    아래 「연결선이 하나도 없다」는 「흐름도가 맞나」(WARNING)다.
  assert.equal(note.severity, "INFO");
});

test("🔴 고립 도형이 **없으면** 안 묶인 선이 있어도 끄지 않는다 — 끌 일이 없다", () => {
  // (4)·(5)·(6) 이 이 경우다. 괜히 「껐다」고 찍으면 사람이 없는 문제를 찾는다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 고립 없음 + 안 묶인 선",
    nodeCodePrefix: "u2",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [
      connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 }),
      connector("c2", null, "2", { x: 2600000, y: 1500000, cx: 0, cy: 1500000 }),
    ],
  });

  assert.equal(result.isolationRuleSkippedReason, null);
  assert.equal(excelNodes(result).length, 2);
});

test("🔴 확정값을 지킨다 — 캡션 많은 시트는 안 묶인 선이 0이라 **일곱 그대로**", () => {
  // 🔴 이 규칙이 「사람이 확인해 준 일곱」을 건드리면 안 된다. 안 묶인 선이
  //    하나라도 생기면 캡션 13개가 전부 노드로 되살아나 20이 된다.
  const input = buildCaptionHeavyFixture();
  assert.equal(
    input.connectors.filter((c) => !c.fromShapeId || !c.toShapeId).length,
    0,
    "본보기에 안 묶인 선이 생겼다 — 아래 단언이 무엇을 재는지 달라진다"
  );

  const result = extractTechnicalTaskGraph(input);
  assert.equal(result.isolationRuleSkippedReason, null);
  assert.equal(excelNodes(result).length, 7);
});

test("🔴 연결선이 **하나도 없는** 시트에서는 규칙을 적용하지 않는다 — 빈 절차가 된다", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 선이 없는 시트",
    nodeCodePrefix: "n2",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 항목", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 항목", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [],
  });

  // 전부 버려졌다면 노드가 0이 되고, 그 절차는 **빈 껍데기**로 만들어진다.
  assert.equal(excelNodes(result).length, 2, "연결선이 없다고 도형을 전부 버렸다");
  assert.equal(result.droppedShapes.some((d) => d.reason === "NOT_IN_FLOW"), false);
  assert.ok(
    result.issues.some((i) => i.message.includes("빈 절차가 됩니다")),
    "규칙을 건너뛰었다는 사실을 안 알렸다"
  );
});

// ── 자동으로 더하는 시작 노드 (2026-11-05 사용자 결정) ────────────────────

/**
 * 🔴 엑셀에 **없는 것을 더하는** 일이다. 1단계에서는 그래서 안 만들었고, 그 탓에
 * 편집기의 [검증]이 **모든 노드를 도달 불가**로 표시했다. 사용자가 「절차 제목을
 * 시작노드의 내용으로 해서 자동으로 붙여」로 정했다.
 */
test("🔴 시작 노드를 더하고, 제목은 절차 이름이다", () => {
  const result = extractTechnicalTaskGraph(buildMainFixture());

  const start = result.nodes.find((n) => n.nodeType === "START");
  assert.ok(start, "시작 노드를 안 만들었다");
  assert.equal(start.title, "가상 절차");
  assert.equal(start.nodeCode, "t1-start");
  assert.equal(start.origin, "AUTO_START", "엑셀에서 온 것으로 섞였다");
  assert.equal(start.sourceShapeId, null, "있지도 않은 도형 번호가 붙었다");
  assert.equal(start.sortOrder, 0, "시작 노드가 맨 앞이 아니다");

  // 🔴 「더했다」는 사실이 메모로 남아야 한다 — 엑셀에 없는 것을 넣는 일이다.
  const note = result.issues.find((i) => i.sourceReference === "node:t1-start");
  assert.ok(note, "엑셀에 없는 노드를 더하면서 아무 말도 안 남겼다");
  assert.equal(note.issueType, "INVALID_START_STRUCTURE");
  assert.ok(note.message.includes("자동으로 더했습니다"));
});

test("🔴 시작 노드에서 **뿌리 전부**로 분기가 나간다 — 이름 없는 기본 분기로", () => {
  const result = extractTechnicalTaskGraph(buildMainFixture());

  const startEdges = result.edges.filter((e) => e.fromNodeCode === "t1-start");
  assert.equal(startEdges.length, 1, "본보기의 뿌리는 하나다");
  assert.equal(startEdges[0].toNodeCode, "t1-10");
  // 🔵 엑셀에 없는 분기 이름을 지어내지 않는다.
  assert.equal(startEdges[0].branchType, "DEFAULT");
  assert.equal(startEdges[0].branchLabel, null);
  assert.equal(startEdges[0].sourceConnectorId, null);
});

test("🔴 뿌리가 **여럿**이면 전부 잇는다 — 하나만 이으면 나머지가 도달 불가로 남는다", () => {
  // 서로 안 닿는 줄기 둘(1→2, 3→4). 뿌리는 1 과 3.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 뿌리 둘",
    nodeCodePrefix: "s2",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
      shape("3", "사아자 작업", { x: 4000000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("4", "아자차 작업", { x: 4000000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [
      connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 }),
      connector("c2", "3", "4", { x: 5000000, y: 1500000, cx: 0, cy: 1500000 }),
    ],
  });

  const startEdges = result.edges.filter((e) => e.fromNodeCode === "s2-start");
  assert.deepEqual(
    startEdges.map((e) => e.toNodeCode).sort(),
    ["s2-1", "s2-3"],
    "뿌리 둘 가운데 하나만 이었다"
  );
});

test("🔴 그 결과 **도달 불가 경고가 사라진다** — 이것이 시작 노드를 더하는 목적이다", () => {
  // 편집기의 [검증]·게시 관문이 쓰는 바로 그 함수로 잰다. 「START 를 만들었다」만
  // 재면 선을 안 이어도 통과한다 — 그때 화면은 전과 똑같이 전부 도달 불가다.
  for (const input of [
    buildMainFixture(),
    {
      sheetName: "(TEST) 뿌리 둘",
      nodeCodePrefix: "s3",
      startNodeTitle: "가상 절차",
      shapes: [
        shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
        shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
        shape("3", "사아자 작업", { x: 4000000, y: 1000000, cx: 2000000, cy: 500000 }),
        shape("4", "아자차 작업", { x: 4000000, y: 3000000, cx: 2000000, cy: 500000 }),
      ],
      connectors: [
        connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 }),
        connector("c2", "3", "4", { x: 5000000, y: 1500000, cx: 0, cy: 1500000 }),
      ],
    },
  ]) {
    const result = extractTechnicalTaskGraph(input);
    const structural = validateProcedureGraphStructure(
      result.nodes.map((n) => ({ id: n.nodeCode, nodeType: n.nodeType })),
      result.edges.map((e, i) => ({
        id: `e${i}`,
        fromNodeId: e.fromNodeCode,
        toNodeId: e.toNodeCode,
        branchType: e.branchType,
      }))
    );
    const unreachable = structural.filter((i) => i.issueType === "UNREACHABLE_NODE");
    assert.deepEqual(unreachable, [], `${input.sheetName}: 도달 불가가 남았다`);
    // 시작 노드 자체의 구조 오류도 없어야 한다(들어오는 분기 0 · 나가는 분기 ≥ 1).
    assert.deepEqual(
      structural.filter((i) => i.issueType === "INVALID_START_STRUCTURE"),
      []
    );
  }
});

test("🔴 뿌리가 하나도 없으면(모두 순환 안) 시작 노드를 **안 만들고 알린다**", () => {
  // 만들면 나가는 분기가 없어 구조 검증이 ERROR 를 낸다 — 반쪽을 만드느니 알린다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 순환뿐",
    nodeCodePrefix: "s4",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [
      connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 }),
      connector("c2", "2", "1", { x: 1600000, y: 1500000, cx: 0, cy: 1500000 }),
    ],
  });

  assert.equal(result.nodes.some((n) => n.nodeType === "START"), false);
  assert.ok(
    result.issues.some(
      (i) => i.issueType === "INVALID_START_STRUCTURE" && i.message.includes("더하지 못했습니다")
    ),
    "못 만들었다는 사실을 안 알렸다"
  );
});

/**
 * 문서 제출/보관 글자가 든 상자 하나를 **나가는 분기만 바꿔** 두 번 읽는다.
 * `hasOutgoing` 이 true 면 그 상자에서 다음 상자로 선이 하나 나간다.
 */
function buildDocumentWordingFixture(hasOutgoing: boolean): TechnicalTaskGraphInput {
  const shapes = [
    shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
    shape("2", "라마바 자료실에 마지막 판 업로드", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
  ];
  const connectors = [connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })];
  if (hasOutgoing) {
    shapes.push(shape("3", "사아자 작업", { x: 400000, y: 5000000, cx: 2000000, cy: 500000 }));
    connectors.push(connector("c2", "2", "3", { x: 1400000, y: 3500000, cx: 0, cy: 1500000 }));
  }
  return {
    sheetName: hasOutgoing ? "(TEST) 문서 글자 + 뒷 단계" : "(TEST) 문서 글자 + 끝",
    nodeCodePrefix: hasOutgoing ? "d1" : "d0",
    startNodeTitle: "가상 절차",
    shapes,
    connectors,
  };
}

test("🔴 문서 글자가 있어도 **다음 단계로 이어지면** 문서 참조가 아니다 (2026-11-05 결정)", () => {
  // 🔴 까닭이 가볍지 않다: DOCUMENT_REFERENCE 는 실행 가능한 유형에서 빠져 있어
  //    (procedure-execution-topology.ts) 그 유형이 된 노드는 **기사의 실행 목록에
  //    아예 안 뜬다.** 흐름 한가운데의 진짜 작업이 그리로 가면 조용히 사라진다.
  const result = extractTechnicalTaskGraph(buildDocumentWordingFixture(true));
  const node = result.nodes.find((n) => n.sourceShapeId === "2");

  assert.notEqual(node?.nodeType, "DOCUMENT_REFERENCE");
  // 무엇이 되는지도 값으로 — 「아니다」만 재면 어디로 떨어지든 통과한다.
  assert.equal(node?.nodeType, "TASK");
  assert.equal(node?.nodeTypeReason, "위 규칙에 걸리지 않는다");
});

test("🔴 문서 글자가 있고 **흐름이 거기서 끝나면** 문서 참조 그대로다", () => {
  // 🔴 이쪽을 안 재면 규칙을 통째로 없애도 위 시험이 통과한다.
  const result = extractTechnicalTaskGraph(buildDocumentWordingFixture(false));
  const node = result.nodes.find((n) => n.sourceShapeId === "2");

  assert.equal(node?.nodeType, "DOCUMENT_REFERENCE");
  assert.ok(node?.nodeTypeReason.includes("나가는 선이 없다"), `근거에 조건이 안 적혔다: ${node?.nodeTypeReason}`);
});

test("🔴 문서 글자가 **없으면** 끝나는 노드는 그대로 종료다", () => {
  // 위 두 시험이 「나가는 선이 없으면 무조건 문서 참조」로 바뀌어도 통과하지
  // 않게, 반대쪽 표본을 함께 둔다.
  const result = extractTechnicalTaskGraph(buildMainFixture());
  assert.equal(result.nodes.find((n) => n.sourceShapeId === "12")?.nodeType, "END");
});

test("노드 코드는 앞가지로 갈린다 — 같은 시트에서 복제한 절차끼리 섞이지 않는다", () => {
  const input = buildMainFixture();
  const first = extractTechnicalTaskGraph(input);
  const second = extractTechnicalTaskGraph({ ...input, nodeCodePrefix: "t9" });

  assert.deepEqual(
    first.nodes.map((n) => n.nodeCode),
    ["t1-start", "t1-10", "t1-12", "t1-11", "t1-13", "t1-15", "t1-14"]
  );
  assert.equal(second.nodes.every((n) => n.nodeCode.startsWith("t9-")), true);
  // 내용은 글자 그대로 같아야 한다 — 복제본은 「같은 절차」다.
  assert.deepEqual(
    first.nodes.map((n) => [n.title, n.nodeType, n.sortOrder]),
    second.nodes.map((n) => [n.title, n.nodeType, n.sortOrder])
  );
});

/**
 * ============================================================================
 * 🔴 **되돌아가는 긴 선이 옆 선의 분기 이름을 빼앗던 자리** (2026-11-05)
 * ============================================================================
 * 실제로 일어난 일: `(7)원복 검사 및 개선 작업`(도형 250·선 225)에서 「판단 노드에
 * 정상/기본 진행 경로가 없습니다」 오류가 **28건** 났다. 까닭은 흐름도가 이상해서가
 * 아니라 **우리가 선의 자리를 틀리게 읽어서**였다.
 *
 * 아래 본보기는 그 모양을 그대로 줄인 것이다:
 *   「점검」 --NG--> 「교환」 --(이름 없음)--> 「다음 점검」
 * 「교환 → 다음 점검」은 멀리 돌아가는 **꺾이고 돌아간** 선이라, 적힌 상자가
 * 「점검 → 교환」의 짧은 곧은 선과 그 옆의 "NG" 글자를 **통째로 덮는다.**
 *
 * 옛 자로 재면 "NG" 가 그 덮는 선에 붙어(거리 0) 「교환」이 **NG 만 내보내는
 * 판단**이 되고, 동시에 「점검」은 제 NG 를 잃는다. 오류 한 건이 아니라 **흐름의
 * 뜻이 뒤집히는** 일이다.
 */
function buildLoopBackLabelTheftFixture(): TechnicalTaskGraphInput {
  return {
    sheetName: "(TEST) 되돌아가는 선",
    nodeCodePrefix: "lb",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 신호 점검", { x: 4000000, y: 5000000, cx: 2000000, cy: 400000 }),
      shape("2", "라마바 기판 교환", { x: 7000000, y: 5000000, cx: 2000000, cy: 400000 }),
      shape("3", "사아자 신호 점검", { x: 4000000, y: 8000000, cx: 2000000, cy: 400000 }),
      // "NG" 는 「점검 → 교환」 선 바로 아래에 떠 있다(선까지 100000 EMU).
      shape("8", "NG", { x: 6400000, y: 5250000, cx: 200000, cy: 100000 }),
    ],
    connectors: [
      // 점검 → 교환 (오른쪽으로 가는 짧은 곧은 선)
      connector("cNG", "1", "2", { x: 6000000, y: 5200000, cx: 1000000, cy: 0 }),
      // 점검 → 다음 점검 (아래로 내려가는 곧은 선 · 이름 없음)
      connector("cDown", "1", "3", { x: 5000000, y: 5400000, cx: 0, cy: 2600000 }),
      /**
       * 교환 → 다음 점검. 엑셀은 이것을 **90° 돌린 `bentConnector3`** 로 적는다.
       * 적힌 상자는 (5200000,5200000)~(7800000,8200000) 이라 "NG" 글자를 품지만,
       * 실제로 그려지는 경로는 (8000000,5400000) → (8000000,6700000) →
       * (5000000,6700000) → (5000000,8000000) 으로 그 글자를 멀찍이 비껴간다.
       */
      connector("cLoop", "2", "3", { x: 5200000, y: 5200000, cx: 2600000, cy: 3000000 }, {
        geom: "bentConnector3",
        rot: 5400000,
      }),
    ],
  };
}

test("🔴 못 — 본보기가 「옛 자로는 틀리는」 모양이 맞다(적힌 상자가 NG 글자를 품는다)", () => {
  // 이 못이 없으면 본보기가 밋밋해졌을 때 아래 시험들이 **무뎌진 줄도 모르고** 통과한다.
  const input = buildLoopBackLabelTheftFixture();
  const label = input.shapes.find((s) => s.text === "NG")!;
  const labelCenter = { x: label.x + label.cx / 2, y: label.y + label.cy / 2 };
  // 엑셀 파일에 **적혀 있는** 상자(= 2026-11-05 전에 거리를 재던 바로 그 네모).
  const writtenBox = { x: 5200000, y: 5200000, cx: 2600000, cy: 3000000 };

  assert.equal(
    distancePointToRect(labelCenter, writtenBox),
    0,
    "적힌 상자가 더 이상 NG 글자를 안 품는다 — 시험이 무뎌졌다"
  );
  const cNG = input.connectors.find((c) => c.id === "cNG")!;
  assert.equal(distancePointToPolyline(labelCenter, cNG.path), 100000);
  // 실제 경로로 재면 되돌아가는 선은 **열네 배** 멀다.
  const cLoop = input.connectors.find((c) => c.id === "cLoop")!;
  assert.equal(distancePointToPolyline(labelCenter, cLoop.path), 1400000);
});

test("🔴 NG 는 **옆의 짧은 곧은 선**에 붙는다 — 덮고 지나가는 선이 아니라", () => {
  const result = extractTechnicalTaskGraph(buildLoopBackLabelTheftFixture());
  const binding = result.labelBindings.find((b) => b.labelText === "NG");
  assert.equal(binding?.connectorId, "cNG");
  assert.equal(binding?.confident, true);
});

test("🔴 그래서 「교환」은 판단이 되지 않고, 「점검」이 제 NG 를 되찾는다", () => {
  const result = extractTechnicalTaskGraph(buildLoopBackLabelTheftFixture());
  const inspection = result.nodes.find((n) => n.sourceShapeId === "1");
  const action = result.nodes.find((n) => n.sourceShapeId === "2");

  assert.equal(inspection?.nodeType, "DECISION");
  assert.equal(action?.nodeType, "CORRECTIVE_ACTION");

  assert.deepEqual(
    excelEdges(result).map((e) => [e.sourceConnectorId, e.branchType]),
    [
      ["cNG", "NG"],
      ["cDown", "NORMAL"],
      ["cLoop", "DEFAULT"],
    ]
  );
});

test("🔴 구조 검증의 MISSING_OUTGOING_PATH 가 사라진다 — 28건이 난 바로 그 오류다", () => {
  const result = extractTechnicalTaskGraph(buildLoopBackLabelTheftFixture());
  const issues = validateProcedureGraphStructure(
    result.nodes.map((n) => ({ id: n.nodeCode, nodeType: n.nodeType })),
    result.edges.map((e, index) => ({
      id: `e${index}`,
      fromNodeId: e.fromNodeCode,
      toNodeId: e.toNodeCode,
      branchType: e.branchType,
    }))
  );
  assert.deepEqual(
    issues.filter((i) => i.issueType === "MISSING_OUTGOING_PATH"),
    []
  );
});

test("🔴 끊어진 끝은 **실제 경로의 끝**으로 이어 붙는다 — 적힌 상자의 귀퉁이가 아니라", () => {
  /**
   * 90° 돌아간 곧은 선 하나. 적힌 상자의 귀퉁이는 (3000000,1000000)·(4000000,5000000)
   * 이지만, 실제로 그려지는 선은 (5500000,2500000) → (1500000,3500000) 이다.
   * 상자 귀퉁이 쪽에는 **엉뚱한 상자**를 세워 두었다 — 옛 방법이면 그쪽으로 붙는다.
   */
  const input: TechnicalTaskGraphInput = {
    sheetName: "(TEST) 돌아간 선의 끊어진 끝",
    nodeCodePrefix: "rb",
    startNodeTitle: "가상 절차",
    shapes: [
      shape("1", "가나다 작업", { x: 5300000, y: 2300000, cx: 400000, cy: 400000 }),
      shape("2", "라마바 작업", { x: 1300000, y: 3300000, cx: 400000, cy: 400000 }),
      shape("9", "사아자 엉뚱한 상자", { x: 2800000, y: 800000, cx: 400000, cy: 400000 }),
    ],
    connectors: [
      connector("c1", null, "2", { x: 3000000, y: 1000000, cx: 1000000, cy: 4000000 }, { rot: 5400000 }),
    ],
  };

  // ① 못 — 적힌 상자의 시작 귀퉁이는 「엉뚱한 상자」 안에 있다(옛 방법의 답).
  assert.equal(distancePointToRect({ x: 3000000, y: 1000000 }, input.shapes[2]), 0);
  // ② 실제 경로의 시작점은 「가나다 작업」 안에 있다.
  assert.equal(distancePointToRect(input.connectors[0].path[0], input.shapes[0]), 0);

  const result = extractTechnicalTaskGraph(input);
  const rebound = result.reboundEndpoints.find((r) => r.connectorId === "c1" && r.side === "START");
  assert.equal(rebound?.shapeId, "1");
  assert.equal(result.edges.some((e) => e.sourceConnectorId === "c1" && e.fromNodeCode === "rb-1"), true);
});
