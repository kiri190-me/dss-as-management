import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractTechnicalTaskGraph,
  type TechnicalTaskConnectorInput,
  type TechnicalTaskGraphInput,
  type TechnicalTaskShapeInput,
} from "./extract-technical-task-graph";

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

function connector(
  id: string,
  from: string | null,
  to: string | null,
  box: { x: number; y: number; cx: number; cy: number },
  options: { flipH?: boolean; flipV?: boolean; isStraight?: boolean } = {}
): TechnicalTaskConnectorInput {
  return {
    id,
    fromShapeId: from,
    toShapeId: to,
    ...box,
    flipH: options.flipH ?? false,
    flipV: options.flipV ?? false,
    isStraight: options.isStraight ?? true,
  };
}

/** 선의 **바깥 상자 가운데**까지의 거리 — 고치기 전에 쓰던 자(아래 시험이 이것과 견준다). */
function distanceToConnectorBoxCenter(
  label: TechnicalTaskShapeInput,
  c: TechnicalTaskConnectorInput
): number {
  return Math.hypot(label.x + label.cx / 2 - (c.x + c.cx / 2), label.y + label.cy / 2 - (c.y + c.cy / 2));
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
  return { sheetName: "(TEST) 가상 흐름도", nodeCodePrefix: "t1", shapes, connectors };
}

test("🔴 본보기가 비어 있지 않다 — 아래 시험이 무엇을 재는지 먼저 못 박는다", () => {
  const input = buildMainFixture();
  assert.equal(input.shapes.length, 10);
  assert.equal(input.connectors.length, 6);

  const result = extractTechnicalTaskGraph(input);
  assert.equal(result.nodes.length, 6);
  assert.equal(result.edges.length, 5);
  // 🔴 조용히 사라지는 도형이 없다 — 들어온 도형은 노드가 되거나 까닭과 함께 버려진다.
  assert.equal(result.nodes.length + result.droppedShapes.length, input.shapes.length);
  assert.equal(result.edges.length + result.droppedConnectors.length, input.connectors.length);
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

  const edgeToInspection = result.edges.find((e) => e.toNodeCode === "t1-11");
  const edgeToRecheck = result.edges.find((e) => e.toNodeCode === "t1-12");
  assert.equal(edgeToInspection?.branchType, "YES");
  assert.equal(edgeToInspection?.branchLabel, "YES");
  assert.equal(edgeToRecheck?.branchType, "NO");
  assert.equal(edgeToRecheck?.branchLabel, "NO");
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
  assert.equal(result.nodes.length, 3);
  assert.equal(result.droppedShapes.length, 0);
});

test("🔴 `(숫자)` 로 시작하는 상자는 다음 절차 참조로 읽힌다 — 나가는 선이 없을 때만", () => {
  const result = extractTechnicalTaskGraph(buildMainFixture());

  const reference = result.nodes.find((n) => n.sourceShapeId === "14");
  assert.equal(reference?.nextProcedureStageNumber, "5");
  assert.equal(reference?.nodeType, "END");
  assert.ok(reference?.nodeTypeReason.includes("(5)"));

  // 번호로 시작하지 않는 상자는 참조가 아니다.
  assert.equal(result.nodes.find((n) => n.sourceShapeId === "11")?.nextProcedureStageNumber, null);
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
  assert.deepEqual(result.edges.map((e) => e.sourceConnectorId), ["c0"]);
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

  // 🔴 맨 위 상자를 START 로 바꾸지 않는다 — START 는 실행이 시작되는 순간 자동으로
  //    완료 처리되는 표식이라, 진짜 작업이 그리로 가면 실행 목록에서 사라진다.
  assert.equal(result.nodes.some((n) => n.nodeType === "START"), false);
  assert.ok(
    result.issues.some((i) => i.issueType === "INVALID_START_STRUCTURE" && i.severity === "INFO"),
    "시작 노드가 없다는 사실을 안 알렸다"
  );
});

test("노드 제목 — 이어지는 괄호 줄은 붙여 읽고, 별표 줄은 주의로 뗀다", () => {
  const result = extractTechnicalTaskGraph(buildMainFixture());

  assert.equal(result.nodes.find((n) => n.sourceShapeId === "13")?.title, "사아자 부품 교환(마바사 기준)");

  const task = result.nodes.find((n) => n.sourceShapeId === "15");
  assert.equal(task?.title, "타파하 준비");
  assert.equal(task?.safetyCaution, "*아아 주의");
  assert.equal(task?.instructions, "타파하 준비");
  // 전문은 그대로 남는다 — 제목이 줄였다고 내용이 사라지면 안 된다.
  assert.equal(task?.description, "타파하 준비\n*아아 주의");
});

test("🔴 분기 어휘가 적혔어도 **연결선이 가리키는** 도형이면 노드다", () => {
  // "정상" 한 낱말만 든 진짜 작업 상자가 있다. 글자만 보고 분기 이름으로 먹으면
  // 그 작업이 통째로 사라진다 — 연결선의 끝인지를 함께 본다.
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 분기 어휘를 쓴 노드",
    nodeCodePrefix: "t4",
    shapes: [
      shape("1", "가나다 확인", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("2", "정상", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [connector("c1", "1", "2", { x: 1400000, y: 1500000, cx: 0, cy: 1500000 })],
  });

  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes.find((n) => n.sourceShapeId === "2")?.title, "정상");
  assert.equal(result.labelBindings.length, 0);
});

test("🔴 똑같이 떨어진 선이 둘이면 「거의 비김」으로 올린다 — 조용히 하나를 고르지 않는다", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 비긴 라벨",
    nodeCodePrefix: "t5",
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
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].branchType, "DEFAULT");
});

test("🔴 같은 도형 번호가 두 번 나오면 뒤엣것을 버리고 오류로 올린다", () => {
  const result = extractTechnicalTaskGraph({
    sheetName: "(TEST) 번호 중복",
    nodeCodePrefix: "t7",
    shapes: [
      shape("1", "가나다 작업", { x: 400000, y: 1000000, cx: 2000000, cy: 500000 }),
      shape("1", "라마바 작업", { x: 400000, y: 3000000, cx: 2000000, cy: 500000 }),
    ],
    connectors: [],
  });

  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].title, "가나다 작업");
  assert.equal(result.droppedShapes[0]?.reason, "DUPLICATE_SHAPE_ID");
  assert.ok(result.issues.some((i) => i.issueType === "DUPLICATE_NODE_CODE" && i.severity === "ERROR"));
});

test("노드 코드는 앞가지로 갈린다 — 같은 시트에서 복제한 절차끼리 섞이지 않는다", () => {
  const input = buildMainFixture();
  const first = extractTechnicalTaskGraph(input);
  const second = extractTechnicalTaskGraph({ ...input, nodeCodePrefix: "t9" });

  assert.deepEqual(
    first.nodes.map((n) => n.nodeCode),
    ["t1-10", "t1-12", "t1-11", "t1-13", "t1-15", "t1-14"]
  );
  assert.equal(second.nodes.every((n) => n.nodeCode.startsWith("t9-")), true);
  // 내용은 글자 그대로 같아야 한다 — 복제본은 「같은 절차」다.
  assert.deepEqual(
    first.nodes.map((n) => [n.title, n.nodeType, n.sortOrder]),
    second.nodes.map((n) => [n.title, n.nodeType, n.sortOrder])
  );
});
