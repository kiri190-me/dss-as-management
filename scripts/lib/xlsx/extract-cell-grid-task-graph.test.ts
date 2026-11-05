import { test } from "node:test";
import assert from "node:assert/strict";
import { readCellGridFlowchart, type CellGridWorksheet } from "./cell-grid-flowchart";
import { extractCellGridTaskGraph } from "./extract-cell-grid-task-graph";
import { classifyTechnicalNodeType } from "./extract-technical-task-graph";

/**
 * 🔴 **지어낸 값만 쓴다** — cell-grid-flowchart.test.ts 머리말과 같은 까닭이다.
 */

function sheet(cells: Record<string, string>, merges: string[]): CellGridWorksheet {
  return { cells, merges };
}

/**
 * ```
 *  A3 | 1. 가나다 알람
 *   5 | B:1. 가 측정  D:정상  E:2. 나 확인  G:정상  H:수리 완료
 *   6 |              D:→            G:→
 *   7 | B:N.G. C:↓   E:N.G. F:↓
 *   8 | B:가 교환     E:라 조정
 *  10 |              E:N.G. F:↓
 *  11 |              E:마 교환
 * ```
 */
const BLOCK = sheet(
  {
    A3: "1. 가나다 알람",
    B5: "1. 가 측정",
    D5: "정상",
    E5: "2. 나 확인",
    G5: "정상",
    H5: "수리 완료",
    D6: "→",
    G6: "→",
    B7: "N.G.",
    C7: "↓",
    E7: "N.G.",
    F7: "↓",
    B8: "가 교환",
    E8: "라 조정",
    E10: "N.G.",
    F10: "↓",
    E11: "마 교환",
  },
  ["B5:C6", "E5:F6", "H5:I6", "B8:C9", "E8:F9", "E11:F12"]
);

function build(worksheet: CellGridWorksheet, blockIndex = 0) {
  const read = readCellGridFlowchart(worksheet);
  assert.ok(read.geometry, "표본의 격자를 못 쟀다 — 아래 단언이 전부 공짜로 통과할 뻔했다");
  const block = read.blocks[blockIndex];
  assert.ok(block, "표본에 블록이 없다");
  return {
    read,
    block,
    ...extractCellGridTaskGraph({
      sheetName: "(MB) 가나다",
      nodeCodePrefix: "mb가나다1",
      startNodeTitle: "가나다 알람",
      block,
      geometry: read.geometry,
      warnings: read.warnings.filter((w) => w.blockHeaderRef === block.headerRef),
    }),
  };
}

test("🔴 상자 하나가 노드 하나다 — 차례는 위에서 아래로, 같은 줄이면 왼쪽부터", () => {
  const { result, counts } = build(BLOCK);
  assert.equal(counts.boxes, 6, "표본의 상자 수가 바뀌었다");
  assert.deepEqual(
    result.nodes.map((n) => n.nodeCode),
    ["mb가나다1-start", "mb가나다1-B5", "mb가나다1-E5", "mb가나다1-H5", "mb가나다1-B8", "mb가나다1-E8", "mb가나다1-E11"]
  );
  assert.deepEqual(
    result.nodes.map((n) => n.sortOrder),
    [0, 1, 2, 3, 4, 5, 6]
  );
});

test("🔴 노드 제목은 **칸의 글자 그대로**다 — 앞의 `1.` 도 안 뗀다", () => {
  const { result } = build(BLOCK);
  const node = result.nodes.find((n) => n.nodeCode === "mb가나다1-B5");
  assert.ok(node);
  assert.equal(node.title, "1. 가 측정");
  assert.equal(node.description, "1. 가 측정");
  // 도형 번호는 없고 **병합 범위**가 출처다.
  assert.equal(node.sourceShapeId, null);
  assert.equal(node.sourceCellRange, "B5:C6");
  assert.equal(node.origin, "EXCEL_SHAPE");
});

test("🔴 노드 유형은 **도형 쪽과 똑같은 함수**가 정한다", () => {
  const { result } = build(BLOCK);
  const real = result.nodes.filter((n) => n.origin === "EXCEL_SHAPE");
  assert.equal(real.length, 6, "표본이 비었다 — 아래 비교가 0번 돌 뻔했다");
  for (const node of real) {
    const outgoing = result.edges
      .filter((e) => e.fromNodeCode === node.nodeCode)
      .map((e) => e.branchType);
    const expected = classifyTechnicalNodeType({
      text: node.title,
      outgoingBranchTypes: outgoing,
      nextProcedureStageNumber: node.nextProcedureStageNumber,
    });
    assert.equal(node.nodeType, expected.nodeType, `${node.nodeCode} "${node.title}"`);
    assert.equal(node.nodeTypeReason, expected.reason, `${node.nodeCode} "${node.title}"`);
  }
  // 그 함수가 실제로 갈래를 나눴는지도 본다 — 전부 한 유형이면 비교가 싱겁다.
  assert.deepEqual(
    result.nodes.map((n) => n.nodeType),
    ["START", "DECISION", "DECISION", "END", "END", "DECISION", "END"]
  );
});

test("🔴 분기 갈래 — 가로는 「정상」(NORMAL) · 세로는 「NG」", () => {
  const { result, counts } = build(BLOCK);
  assert.equal(counts.normalLinks, 2);
  assert.equal(counts.ngLinks, 3);
  const named = result.edges.filter((e) => e.sourceConnectorId !== null);
  assert.equal(named.length, 5, "엑셀에서 온 분기가 다섯이 아니다");
  assert.deepEqual(
    named.map((e) => [e.fromNodeCode, e.toNodeCode, e.branchType, e.branchLabel, e.sourceConnectorId]),
    [
      ["mb가나다1-B5", "mb가나다1-E5", "NORMAL", "정상", "cell:D5"],
      ["mb가나다1-B5", "mb가나다1-B8", "NG", "NG", "cell:B7"],
      ["mb가나다1-E5", "mb가나다1-H5", "NORMAL", "정상", "cell:G5"],
      ["mb가나다1-E5", "mb가나다1-E8", "NG", "NG", "cell:E7"],
      ["mb가나다1-E8", "mb가나다1-E11", "NG", "NG", "cell:E10"],
    ]
  );
});

/**
 * 🔵 도형 쪽에는 「판단에서 NG 와 짝지어 나가는 **이름 없는 선**을 정상으로 올린다」는
 * 보정이 있다(조건 넷 가운데 ②가 「이름 없는 것이 **정확히 하나**」). 이 격자는 가로에
 * 「정상」이 이미 적혀 있어 **이름 없는 분기가 0개**다 — 조건 ②가 영영 안 맞으므로
 * 그 보정을 적용해도 **결과가 같다.** 이 시험이 그 전제를 못으로 박는다.
 */
test("🔴 엑셀에서 온 분기 가운데 **이름 없는 것이 하나도 없다** — 정상 올리기 보정이 탈 자리가 없다", () => {
  const { result } = build(BLOCK);
  const fromExcel = result.edges.filter((e) => e.sourceConnectorId !== null);
  assert.ok(fromExcel.length > 0, "표본에 엑셀 분기가 없다");
  assert.deepEqual(
    fromExcel.filter((e) => e.branchType === "DEFAULT"),
    [],
    "이름 없는 분기가 생겼다 — 도형 쪽 보정과 결과가 갈릴 수 있다"
  );
  // 기본 분기는 **자동으로 더한 시작 분기**뿐이고, 그 노드에서는 NG 가 안 나가므로
  // 보정의 조건 ①(형제에 NG 가 있다)도 안 맞는다.
  const defaults = result.edges.filter((e) => e.branchType === "DEFAULT");
  assert.deepEqual(defaults.map((e) => e.fromNodeCode), ["mb가나다1-start"]);
  assert.deepEqual(
    result.edges.filter((e) => e.fromNodeCode === "mb가나다1-start" && e.branchType === "NG"),
    []
  );
});

test("🔴 시작 노드를 자동으로 더하고, 들어오는 이음이 없던 상자 **전부**에 잇는다", () => {
  const { result, counts } = build(BLOCK);
  const start = result.nodes[0];
  assert.equal(start.origin, "AUTO_START");
  assert.equal(start.nodeType, "START");
  assert.equal(start.title, "가나다 알람");
  assert.equal(start.sourceCellRange, "A3", "시작 노드의 제목이 어디서 왔는지가 안 남았다");
  assert.equal(counts.startEdges, 1);
  assert.deepEqual(
    result.edges.filter((e) => e.sourceConnectorId === null).map((e) => [e.fromNodeCode, e.toNodeCode, e.branchType]),
    [["mb가나다1-start", "mb가나다1-B5", "DEFAULT"]]
  );
  assert.ok(
    result.issues.some((i) => i.issueType === "INVALID_START_STRUCTURE" && i.severity === "INFO"),
    "엑셀에 없는 것을 더했다는 사실이 메모에 안 남았다"
  );
});

test("🔵 블록의 셈이 서로 맞는다 — 상자 + 시작 = 노드, 이음 + 시작 분기 = 분기", () => {
  const { result, counts } = build(BLOCK);
  assert.equal(counts.boxes + counts.startEdges, counts.nodes);
  assert.equal(counts.links + counts.startEdges, counts.edges);
  assert.equal(counts.normalLinks + counts.ngLinks, counts.links);
  assert.equal(result.nodes.length, counts.nodes);
  assert.equal(result.edges.length, counts.edges);
  // 분기 차례는 0부터 빈틈없이 매겨진다(DB 의 sort_order 가 된다).
  assert.deepEqual(result.edges.map((e) => e.sortOrder), [0, 1, 2, 3, 4, 5]);
});

test("🔵 도형 길에만 있는 칸은 비어 있다 — 그것이 「도형에서 온 것이 아니다」의 증거다", () => {
  const { result } = build(BLOCK);
  assert.deepEqual(result.droppedShapes, []);
  assert.deepEqual(result.droppedConnectors, []);
  assert.deepEqual(result.labelBindings, []);
  assert.deepEqual(result.reboundEndpoints, []);
  assert.equal(result.isolationRuleSkippedReason, null);
  assert.equal(result.annotationBoundaryX, null);
  assert.match(result.annotationBoundaryReason, /셀 격자/);
});

test("🔴 격자가 남긴 경고는 **절차의 메모로 그대로** 옮겨진다", () => {
  const withStray = sheet(
    { A3: "1. 가나다 알람", B5: "가 측정", D5: "정상", D6: "→", E5: "나 확인", C8: "손으로 적은 메모" },
    ["B5:C6", "E5:F6"]
  );
  const { read, result } = build(withStray);
  const unread = read.warnings.filter((w) => w.code === "UNREAD_CELL");
  assert.equal(unread.length, 1, "표본에 읽다 만 칸이 없다 — 이 시험이 공짜로 통과할 뻔했다");
  const issue = result.issues.find((i) => i.sourceReference === "cell:C8");
  assert.ok(issue, "읽다 만 칸이 절차 메모로 안 올라왔다");
  assert.equal(issue.severity, "WARNING");
  assert.equal(issue.issueType, "UNSUPPORTED_OBJECT");
  assert.equal(issue.sourceWorksheet, "(MB) 가나다");
});

test("🔴 다른 절차를 가리키는 상자는 **종료**가 되고, 거기서 나가던 이음을 버린다", () => {
  const withRef = sheet(
    {
      A3: "1. 가나다 알람",
      B5: "가 측정",
      D5: "정상",
      D6: "→",
      E5: "(7) 라마바 작업",
      B7: "N.G.",
      C7: "↓",
      B8: "나 조치",
      E7: "N.G.",
      F7: "↓",
      E8: "다 조치",
    },
    ["B5:C6", "E5:F6", "B8:C9", "E8:F9"]
  );
  const { block, result } = build(withRef);
  assert.equal(block.links.length, 3, "표본의 이음이 셋이 아니다");

  const ref = result.nodes.find((n) => n.nodeCode === "mb가나다1-E5");
  assert.ok(ref);
  assert.equal(ref.nextProcedureStageNumber, "7");
  assert.equal(ref.nodeType, "END", "참조 노드가 종료가 아니다 — 나가는 분기가 달린 종료가 된다");
  assert.deepEqual(result.edges.filter((e) => e.fromNodeCode === "mb가나다1-E5"), []);

  // 🔴 버렸다는 사실과, 이어가기를 비워 뒀다는 사실이 **둘 다** 남아야 한다.
  assert.ok(
    result.issues.some((i) => i.sourceReference === "cell:E7" && /버렸습니다/.test(i.message)),
    "버린 이음이 조용히 사라졌다"
  );
  assert.ok(
    result.issues.some((i) => i.sourceReference === "node:mb가나다1-E5" && /비워 두었습니다/.test(i.message)),
    "이어가기를 비워 뒀다는 메모가 없다"
  );

  // 갈 곳을 잃은 상자는 뿌리가 되어 시작 노드에서 이어진다 — 떠다니지 않는다.
  assert.deepEqual(
    result.edges.filter((e) => e.fromNodeCode === "mb가나다1-start").map((e) => e.toNodeCode),
    ["mb가나다1-B5", "mb가나다1-E8"]
  );
});
