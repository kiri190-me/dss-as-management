import { test } from "node:test";
import assert from "node:assert/strict";
import { PROCEDURE_NODE_TYPE_CODES, PROCEDURE_BRANCH_TYPE_CODES } from "./procedure-template-types";
import {
  NODE_VISUAL_CONFIG,
  EDGE_VISUAL_CONFIG,
  GRAPH_SPACING,
  NODE_SIZE,
  getSemanticNodeVisualType,
  getNodeIconKey,
  getNodeChipVisual,
  computeConnectedIds,
  searchNodes,
  groupNodesByWorksheet,
  computeNodeDimensions,
  computeStageSortedLayout,
  type MinimalEdge,
  type StageSortedLayoutNode,
  type StageSortedLayoutEdge,
} from "./procedure-visual-language";

test("getSemanticNodeVisualType: every stored ProcedureNodeType maps to a defined NODE_VISUAL_CONFIG entry", () => {
  for (const nodeType of PROCEDURE_NODE_TYPE_CODES) {
    const semanticType = getSemanticNodeVisualType(nodeType);
    assert.ok(NODE_VISUAL_CONFIG[semanticType], `no visual config for ${nodeType} -> ${semanticType}`);
  }
});

test("getSemanticNodeVisualType: START and END use the capsule shape", () => {
  assert.equal(NODE_VISUAL_CONFIG[getSemanticNodeVisualType("START")].shape, "capsule");
  assert.equal(NODE_VISUAL_CONFIG[getSemanticNodeVisualType("END")].shape, "capsule");
});

test("getSemanticNodeVisualType: TASK, INSPECTION, CORRECTIVE_ACTION share the TASK shape", () => {
  const taskShape = NODE_VISUAL_CONFIG[getSemanticNodeVisualType("TASK")].shape;
  assert.equal(NODE_VISUAL_CONFIG[getSemanticNodeVisualType("INSPECTION")].shape, taskShape);
  assert.equal(NODE_VISUAL_CONFIG[getSemanticNodeVisualType("CORRECTIVE_ACTION")].shape, taskShape);
});

test("getNodeIconKey: TASK, INSPECTION, CORRECTIVE_ACTION are individually recognizable via distinct icons", () => {
  const taskIcon = getNodeIconKey("TASK");
  const inspectionIcon = getNodeIconKey("INSPECTION");
  const correctiveIcon = getNodeIconKey("CORRECTIVE_ACTION");
  assert.notEqual(taskIcon, inspectionIcon);
  assert.notEqual(taskIcon, correctiveIcon);
  assert.notEqual(inspectionIcon, correctiveIcon);
});

test("getSemanticNodeVisualType: DECISION uses the diamond shape", () => {
  assert.equal(NODE_VISUAL_CONFIG[getSemanticNodeVisualType("DECISION")].shape, "diamond");
});

test("getSemanticNodeVisualType: CHECKLIST and TROUBLESHOOTING are distinguishable from each other and from TASK", () => {
  const checklist = NODE_VISUAL_CONFIG[getSemanticNodeVisualType("CHECKLIST")];
  const troubleshooting = NODE_VISUAL_CONFIG[getSemanticNodeVisualType("TROUBLESHOOTING")];
  const task = NODE_VISUAL_CONFIG[getSemanticNodeVisualType("TASK")];
  assert.notEqual(checklist.shape === troubleshooting.shape && checklist.borderLight === troubleshooting.borderLight, true);
  assert.notEqual(checklist.shape, task.shape);
  assert.notEqual(troubleshooting.shape, task.shape);
});

test("getNodeChipVisual: bundles semantic type and icon key for a real stored node type", () => {
  const result = getNodeChipVisual("INSPECTION");
  assert.equal(result.semanticType, "TASK");
  assert.equal(result.iconKey, "inspection");
});

test("EDGE_VISUAL_CONFIG: every stored ProcedureBranchType maps to a defined entry", () => {
  for (const branchType of PROCEDURE_BRANCH_TYPE_CODES) {
    assert.ok(EDGE_VISUAL_CONFIG[branchType], `no edge visual config for ${branchType}`);
  }
});

test("EDGE_VISUAL_CONFIG: YES and NO differ in more than color (dash pattern and/or marker shape)", () => {
  const yes = EDGE_VISUAL_CONFIG.YES;
  const no = EDGE_VISUAL_CONFIG.NO;
  const differsNonColor = yes.dashPattern !== no.dashPattern || yes.markerShape !== no.markerShape;
  assert.ok(differsNonColor, "YES and NO must be distinguishable without relying on color alone");
});

test("EDGE_VISUAL_CONFIG: LOOP_BACK has a distinct dash/route from DEFAULT and RETRY", () => {
  const loopBack = EDGE_VISUAL_CONFIG.LOOP_BACK;
  const defaultCfg = EDGE_VISUAL_CONFIG.DEFAULT;
  const retry = EDGE_VISUAL_CONFIG.RETRY;
  assert.notEqual(loopBack.routeStyle, defaultCfg.routeStyle);
  assert.notEqual(loopBack.dashPattern, defaultCfg.dashPattern);
  assert.equal(loopBack.routeStyle, retry.routeStyle);
  assert.notEqual(loopBack.dashPattern, retry.dashPattern);
  assert.notEqual(loopBack.animated, retry.animated);
});

test("computeConnectedIds: returns empty sets when nothing is selected", () => {
  const edges: MinimalEdge[] = [{ id: "e1", source: "a", target: "b" }];
  const result = computeConnectedIds(null, edges);
  assert.equal(result.nodeIds.size, 0);
  assert.equal(result.edgeIds.size, 0);
});

test("computeConnectedIds: returns 1-hop incoming+outgoing sets for the selected node", () => {
  const edges: MinimalEdge[] = [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "c", target: "b" },
    { id: "e3", source: "b", target: "d" },
    { id: "e4", source: "x", target: "y" },
  ];
  const result = computeConnectedIds("b", edges);
  assert.deepEqual([...result.nodeIds].sort(), ["a", "b", "c", "d"]);
  assert.deepEqual([...result.edgeIds].sort(), ["e1", "e2", "e3"]);
});

test("computeConnectedIds: correctly includes both endpoints of a real RFG LOOP_BACK-style edge", () => {
  // Regression guard for the two real LOOP_BACK edges wired in Phase 2.5 — a
  // loop-back edge is just a normal source/target pair to this function, so
  // selecting either endpoint must surface the other.
  const edges: MinimalEdge[] = [{ id: "loop-1", source: "node-late-step", target: "node-earlier-step" }];
  const fromLateStep = computeConnectedIds("node-late-step", edges);
  assert.ok(fromLateStep.nodeIds.has("node-earlier-step"));
  assert.ok(fromLateStep.edgeIds.has("loop-1"));
  const fromEarlierStep = computeConnectedIds("node-earlier-step", edges);
  assert.ok(fromEarlierStep.nodeIds.has("node-late-step"));
  assert.ok(fromEarlierStep.edgeIds.has("loop-1"));
});

test("searchNodes: matches by title, node code, or source shape id (case-insensitive substring)", () => {
  const nodes = [
    { id: "1", title: "전원 인가 확인", nodeCode: "N-001", sourceShapeId: "12" },
    { id: "2", title: "출력 측정", nodeCode: "N-002", sourceShapeId: "34" },
    { id: "3", title: "Retry Step", nodeCode: "n-loop-99", sourceShapeId: null },
  ];
  assert.deepEqual(searchNodes(nodes, "출력").map((n) => n.id), ["2"]);
  assert.deepEqual(searchNodes(nodes, "n-001").map((n) => n.id), ["1"]);
  assert.deepEqual(searchNodes(nodes, "34").map((n) => n.id), ["2"]);
  assert.deepEqual(searchNodes(nodes, "RETRY").map((n) => n.id), ["3"]);
  assert.deepEqual(searchNodes(nodes, "   "), []);
});

test("groupNodesByWorksheet: stacks each worksheet's nodes into a non-overlapping vertical band in first-seen order", () => {
  const nodes = [
    { id: "1", sourceWorksheet: "sheet-A", positionY: 0 },
    { id: "2", sourceWorksheet: "sheet-A", positionY: 100 },
    { id: "3", sourceWorksheet: "sheet-B", positionY: 0 },
    { id: "4", sourceWorksheet: "sheet-B", positionY: 50 },
  ];
  const { orderedWorksheets, bands } = groupNodesByWorksheet(nodes, 150);
  assert.deepEqual(orderedWorksheets, ["sheet-A", "sheet-B"]);
  const bandA = bands.get("sheet-A")!;
  const bandB = bands.get("sheet-B")!;
  assert.equal(bandA.yOffset, 0);
  // sheet-B's band must start after sheet-A's band plus the margin, so the
  // two sheets' reused source coordinates never visually overlap.
  assert.equal(bandB.yOffset, bandA.maxY - bandA.minY + 150);
});

// ---- Phase 3B revision: adaptive sizing + compact layout ----

test("computeNodeDimensions: an empty title hits exactly the minimum bounds", () => {
  const dims = computeNodeDimensions({ title: "", shape: "capsule" });
  assert.equal(dims.width, NODE_SIZE.MIN_WIDTH);
  assert.equal(dims.height, NODE_SIZE.MIN_HEIGHT);
  assert.equal(dims.visibleLines, 1);
  assert.equal(dims.isTruncated, false);
});

test("computeNodeDimensions: a short title produces a compact box, well below the maximum width, on one line", () => {
  const dims = computeNodeDimensions({ title: "완료", shape: "capsule" });
  assert.ok(dims.width < 170, `short titles must stay compact, got width=${dims.width}`);
  assert.equal(dims.height, NODE_SIZE.MIN_HEIGHT);
  assert.equal(dims.visibleLines, 1);
  assert.equal(dims.isTruncated, false);
});

test("computeNodeDimensions: a long Korean TASK title wraps to multiple lines without being truncated", () => {
  const longTitle = "종단 AMP 디바이스 기판 외관 및 다이오드 상태를 육안으로 정밀하게 확인하고 이상 유무를 기록한다";
  const dims = computeNodeDimensions({ title: longTitle, shape: "rect" });
  assert.ok(dims.visibleLines > 1, "a long title must wrap to more than one visible line");
  assert.equal(dims.isTruncated, false, "a moderately long title must not be truncated — it should grow height instead");
  assert.ok(dims.height > NODE_SIZE.MIN_HEIGHT, "height must grow to fit the wrapped lines");
});

test("computeNodeDimensions: an extremely long title is bounded — clamped with isTruncated, never grows past MAX_HEIGHT", () => {
  const extremeTitle = "가".repeat(500);
  const dims = computeNodeDimensions({ title: extremeTitle, shape: "rect" });
  assert.equal(dims.isTruncated, true);
  assert.equal(dims.visibleLines, NODE_SIZE.MAX_VISIBLE_LINES);
  assert.equal(dims.height, NODE_SIZE.MAX_HEIGHT);
  assert.equal(dims.width, NODE_SIZE.MAX_WIDTH);
});

test("computeNodeDimensions: DECISION (diamond) gets wider bounds than an ordinary TASK (rect) for the same title", () => {
  const title = "CHOPPER IGBT 다이오드 확인 시 정상 경로가 없는 경우 다음 단계는 무엇인가?";
  const decisionDims = computeNodeDimensions({ title, shape: "diamond" });
  const taskDims = computeNodeDimensions({ title, shape: "rect" });
  assert.ok(decisionDims.width >= taskDims.width, "DECISION's wider bounds must never produce a narrower box than TASK for the same text");
  assert.ok(decisionDims.width <= NODE_SIZE.DECISION_MAX_WIDTH);
});

test("computeNodeDimensions: width and height always stay within configured min/max bounds across a range of title lengths", () => {
  for (const shape of ["rect", "diamond", "capsule", "double-border-rect", "document", "pentagon-warning"] as const) {
    const [minW, maxW] = shape === "diamond" ? [NODE_SIZE.DECISION_MIN_WIDTH, NODE_SIZE.DECISION_MAX_WIDTH] : [NODE_SIZE.MIN_WIDTH, NODE_SIZE.MAX_WIDTH];
    for (const len of [0, 1, 5, 20, 50, 120, 300, 1000]) {
      const dims = computeNodeDimensions({ title: "가".repeat(len), shape });
      assert.ok(dims.width >= minW && dims.width <= maxW, `width ${dims.width} out of [${minW},${maxW}] for shape=${shape} len=${len}`);
      assert.ok(
        dims.height >= NODE_SIZE.MIN_HEIGHT && dims.height <= NODE_SIZE.MAX_HEIGHT,
        `height ${dims.height} out of [${NODE_SIZE.MIN_HEIGHT},${NODE_SIZE.MAX_HEIGHT}] for shape=${shape} len=${len}`
      );
    }
  }
});

test("computeNodeDimensions: badge/issue state is not a parameter — text sizing can never be squeezed by badge presence", () => {
  // computeNodeDimensions intentionally has no issue/badge parameter: sizing
  // is derived purely from title+shape, so a warning badge (rendered as an
  // absolutely-positioned corner overlay in ProcedureNodeChip, outside the
  // padded content box) can never shrink the space available to the title.
  assert.equal(computeNodeDimensions.length, 1);
});

test("GRAPH_SPACING: the compact layout uses smaller spacing than the previous fixed grid (BAND_GAP < 150, NODE_V_GAP < 130)", () => {
  assert.ok(GRAPH_SPACING.BAND_GAP < 150, "worksheet-band gap must be smaller than the old fixed 150px margin");
  assert.ok(GRAPH_SPACING.NODE_V_GAP < 130, "row pitch must be smaller than the old fixed 130px row height");
});

function makeLayoutNode(id: string, title: string, nodeType: StageSortedLayoutNode["nodeType"], sortOrder: number, sourceWorksheet: string): StageSortedLayoutNode {
  return { id, title, nodeType, sortOrder, sourceWorksheet };
}

test("computeStageSortedLayout: every input node receives a position — none are dropped", () => {
  const nodes: StageSortedLayoutNode[] = [];
  for (let i = 0; i < 120; i++) {
    nodes.push(makeLayoutNode(`n${i}`, `단계 ${i}`, "TASK", i, i < 60 ? "sheet-A" : "sheet-B"));
  }
  const { positions } = computeStageSortedLayout(nodes, [], ["sheet-A", "sheet-B"]);
  assert.equal(positions.size, nodes.length, "every node must be positioned — this is the layer that guarantees all RFG nodes stay accessible");
  for (const n of nodes) assert.ok(positions.has(n.id), `missing position for ${n.id}`);
});

test("computeStageSortedLayout: packs multiple short nodes into the same row instead of one node per row", () => {
  const nodes = [
    makeLayoutNode("a", "짧음", "TASK", 0, "sheet-A"),
    makeLayoutNode("b", "짧음", "TASK", 1, "sheet-A"),
    makeLayoutNode("c", "짧음", "TASK", 2, "sheet-A"),
  ];
  const { positions } = computeStageSortedLayout(nodes, [], ["sheet-A"]);
  const ys = new Set([...positions.values()].map((p) => p.y));
  assert.equal(ys.size, 1, "short nodes should share one row, not each get their own row");
  const xs = [...positions.values()].map((p) => p.x).sort((x, y) => x - y);
  assert.deepEqual(xs, [...new Set(xs)], "nodes packed into the same row must not overlap in x");
});

test("computeStageSortedLayout: a DECISION node with more outgoing branches gets more trailing horizontal space than one with fewer", () => {
  const edgesFew: StageSortedLayoutEdge[] = [{ fromNodeId: "d", toNodeId: "next", branchType: "DEFAULT" }];
  const edgesMany: StageSortedLayoutEdge[] = [
    { fromNodeId: "d", toNodeId: "yesNode", branchType: "YES" },
    { fromNodeId: "d", toNodeId: "noNode", branchType: "NO" },
    { fromNodeId: "d", toNodeId: "ngNode", branchType: "NG" },
  ];
  const nodes = [makeLayoutNode("d", "판단", "DECISION", 0, "sheet-A"), makeLayoutNode("next", "다음", "TASK", 1, "sheet-A")];

  const fewLayout = computeStageSortedLayout(nodes, edgesFew, ["sheet-A"]);
  const manyLayout = computeStageSortedLayout(nodes, edgesMany, ["sheet-A"]);
  const gapFew = fewLayout.positions.get("next")!.x - fewLayout.positions.get("d")!.x;
  const gapMany = manyLayout.positions.get("next")!.x - manyLayout.positions.get("d")!.x;
  assert.ok(gapMany > gapFew, "more outgoing branches on a DECISION node must widen the gap to the next node");
});

test("computeStageSortedLayout: a row touching a LOOP_BACK/RETRY endpoint gets extra vertical clearance before the next row", () => {
  const wideTitle = "가".repeat(60); // wide enough (clamped to MAX_WIDTH) that 6 of them wrap into 2 rows within ROW_MAX_WIDTH
  const ids = ["a", "b", "c", "d", "e", "f"];
  const nodes: StageSortedLayoutNode[] = ids.map((id, i) => makeLayoutNode(id, wideTitle, "TASK", i, "sheet-A"));
  const withLoopBackEdges: StageSortedLayoutEdge[] = [{ fromNodeId: "f", toNodeId: "a", branchType: "LOOP_BACK" }];

  const base = computeStageSortedLayout(nodes, [], ["sheet-A"]);
  const withLoopBack = computeStageSortedLayout(nodes, withLoopBackEdges, ["sheet-A"]);

  const rowsOf = (result: typeof base) => [...new Set(ids.map((id) => result.positions.get(id)!.y))].sort((x, y) => x - y);
  const baseRows = rowsOf(base);
  const loopBackRows = rowsOf(withLoopBack);
  assert.ok(baseRows.length >= 2, "fixture must actually wrap into multiple rows for this test to be meaningful");
  assert.ok(loopBackRows[1] > baseRows[1], "the second row must start lower when the first row contains a loop-back endpoint");
});

test("computeStageSortedLayout: worksheet bands remain vertically separated and stage headers precede their first row", () => {
  const nodes = [makeLayoutNode("a", "노드", "TASK", 0, "sheet-A"), makeLayoutNode("b", "노드", "TASK", 0, "sheet-B")];
  const { positions, headerPositions } = computeStageSortedLayout(nodes, [], ["sheet-A", "sheet-B"]);
  assert.ok(headerPositions.get("sheet-B")!.y > headerPositions.get("sheet-A")!.y, "sheet-B's band must start after sheet-A's");
  assert.ok(positions.get("a")!.y > headerPositions.get("sheet-A")!.y, "a node's row must sit below its own worksheet header");
  assert.ok(positions.get("b")!.y > positions.get("a")!.y, "sheet-B's nodes must sit below sheet-A's nodes");
});

test("computeStageSortedLayout: a long worksheet name's header never overlaps the first row (header has real height too)", () => {
  const longWorksheetName = "(RFG) 이 워크시트 이름은 매우 길어서 헤더 자체의 높이가 상당히 커질 수 있습니다";
  const nodes = [makeLayoutNode("a", "노드", "TASK", 0, longWorksheetName)];
  const { positions, headerPositions } = computeStageSortedLayout(nodes, [], [longWorksheetName]);
  const headerHeight = computeNodeDimensions({ title: longWorksheetName, shape: "rect" }).height;
  const headerY = headerPositions.get(longWorksheetName)!.y;
  const firstRowY = positions.get("a")!.y;
  assert.ok(firstRowY >= headerY + headerHeight, "the first row must start at or below the header's own bottom edge, not overlap it");
});

test("computeStageSortedLayout (Problem 1): rowIndexByNodeId groups nodes packed into the same row under the same index", () => {
  const nodes = [
    makeLayoutNode("a", "짧음", "TASK", 0, "sheet-A"),
    makeLayoutNode("b", "짧음", "TASK", 1, "sheet-A"),
    makeLayoutNode("c", "짧음", "TASK", 2, "sheet-A"),
  ];
  const { rowIndexByNodeId } = computeStageSortedLayout(nodes, [], ["sheet-A"]);
  assert.equal(rowIndexByNodeId.get("a"), rowIndexByNodeId.get("b"));
  assert.equal(rowIndexByNodeId.get("b"), rowIndexByNodeId.get("c"));
});

test("computeStageSortedLayout (Problem 1): rowIndexByNodeId increments when a row wraps, and resets to 0 for each worksheet band", () => {
  const wideTitle = "가".repeat(60);
  const idsA = ["a", "b", "c", "d", "e", "f"];
  const nodesA = idsA.map((id, i) => makeLayoutNode(id, wideTitle, "TASK", i, "sheet-A"));
  const nodeB = makeLayoutNode("g", "노드", "TASK", 0, "sheet-B");
  const { rowIndexByNodeId } = computeStageSortedLayout([...nodesA, nodeB], [], ["sheet-A", "sheet-B"]);

  const rowsInSheetA = new Set(idsA.map((id) => rowIndexByNodeId.get(id)));
  assert.ok(rowsInSheetA.size >= 2, "fixture must actually wrap into multiple rows for this test to be meaningful");
  assert.equal(rowIndexByNodeId.get("g"), 0, "the next worksheet band must start its own row index back at 0");
});

test("computeStageSortedLayout (Problem 1): canvasMaxX reaches at least as far right as every node's own right edge", () => {
  const nodes = [
    makeLayoutNode("a", "짧음", "TASK", 0, "sheet-A"),
    makeLayoutNode("b", "이 제목은 조금 더 길어서 더 넓은 노드를 만듭니다", "TASK", 1, "sheet-A"),
  ];
  const { positions, canvasMaxX } = computeStageSortedLayout(nodes, [], ["sheet-A"]);
  for (const n of nodes) {
    const dims = computeNodeDimensions({ title: n.title, shape: "rect" });
    assert.ok(canvasMaxX >= positions.get(n.id)!.x + dims.width, `canvasMaxX must clear ${n.id}'s right edge`);
  }
});
