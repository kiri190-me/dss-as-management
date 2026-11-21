import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「진단 Flowchart」 편집기 — **[Delete] 키로 지우기**, 화면 쪽 이음새 (2026-11-21)
 * ============================================================================
 * 쓰는 분의 요청(원문): 「[진단 FLOWCHART]에서도 같은 동작이 되야 해.」 — 2026-11-04
 * ~21 에 「기술 작업 절차」 편집기에 붙인 것을 이쪽으로도 옮기는 중이고, 이 파일이
 * 재는 것은 그 가운데 **[Delete] 키** 하나다.
 *
 * **무엇을 지울지**를 정하는 규칙은 순수 함수에 있고 값으로 재어진다
 * (src/lib/domain/procedure-editor-delete-key.test.ts). 🔵 그 파일은 절차 쪽과
 * **같은 한 벌**이다 — 이름이 `procedure-` 로 시작해도 import 가 하나도 없고 입력이
 * 전부 string·boolean·null 이라 그대로 쓴다. 베끼면 두 잣대가 생긴다.
 *
 * 이 파일이 재는 것은 **화면이 그 판정을 제대로 물고 있는가**와, 이번 조각의 가장
 * 큰 결정인 **「지우는 길이 하나인가」**다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① **지우는 길이 둘이 되는 것.** 2026-11-21 이전에는 속성 패널이 제 손으로 서버
 *     액션을 불렀다. 키가 또 제 손으로 부르면 「단추로 지울 때와 키로 지울 때가
 *     다른」 화면이 되고, 막힌 까닭·되돌리기 단계·저장 전 수정 치우기 가운데
 *     하나가 한쪽에만 남는 날이 온다. 오류는 한 번도 안 난다. (④절)
 *  ② **NONE 인데 preventDefault 를 하는 것.** 글자 칸에서 [Delete] 가 글자를
 *     안 지우게 된다. 순수 판정은 멀쩡한데 화면에서만 깨지는 자리다. (③절)
 *  ③ **keydown 등록이 둘이 되는 것.** 한 번 누른 키에 둘이 반응한다. (⑤절)
 *  ④ **상시 안내를 세우는 것.** 절차 쪽에서 두 번 세웠다 두 번 다 지워 달라는
 *     요청을 받았다(커밋 d57f664a). 진단 쪽에도 안 세운다. (⑥절)
 *  ⑤ **진단에 없는 개념을 있는 척 넘기는 것.** 절차의 「미리 막는 까닭」은 진단
 *     노드 행에 칸이 아예 없어 셀 수조차 없다 — null 이어야 한다. (⑦절)
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * CaseFlowchartEditorScreen 은 @xyflow/react 의 .css 와 서버 액션(→ server-only)을
 * 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다. 이웃
 * case-flowchart-fault-tags.test.tsx 가 편집기 화면만 「원본 글자로」 재는 것과
 * 같은 사정이다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이번 변경의 주석에는 쓰는 분의 요청 원문과 **옛 모습**(패널이 직접 부르던 액션
 * 이름)이 글자 그대로 들어 있다. 안 걷으면 「없어졌는가」 쪽이 영영 깨진다.
 * ①절의 마지막 두 단언이 걷어내기가 실제로 일한다는 증거다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/** `start` 로 시작해 괄호 깊이가 0으로 돌아올 때까지 — 함수 하나의 몸통만 떼어 낸다. */
function functionBody(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  assert.fail(`${start} 의 몸통이 안 닫혔다`);
}

/** 글자가 몇 번 나오는가. 「등록이 하나뿐인가」처럼 **수**가 뜻을 갖는 자리에서 쓴다. */
function countOf(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

const PATHS = {
  screen: "src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx",
  nodePanel: "src/components/repair-cases/flowchart/CaseFlowchartNodePropertyPanel.tsx",
  edgePanel: "src/components/repair-cases/flowchart/CaseFlowchartEdgePropertyPanel.tsx",
  graph: "src/components/repair-cases/flowchart/CaseFlowchartGraph.tsx",
  plan: "src/lib/domain/procedure-editor-delete-key.ts",
} as const;

const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const f = flat(screen);
const nodePanelRaw = read(PATHS.nodePanel);
const edgePanelRaw = read(PATHS.edgePanel);
const nodePanel = flat(stripComments(nodePanelRaw));
const edgePanel = flat(stripComments(edgePanelRaw));
const graph = stripComments(read(PATHS.graph));
const planModule = stripComments(read(PATHS.plan));

/** 화면의 keydown 한 자리. 아래 여러 절이 **이 몸통 안에서만** 센다. */
const keyHandler = flat(functionBody(screen, "function handleKeyDown(e: KeyboardEvent)"));
/** 서버로 보내는 자리 둘 — ④절이 「뒤처리를 하나도 안 잃었는가」를 여기서 센다. */
const deleteNodeFn = flat(functionBody(screen, "async function handleDeleteNode(nodeId: string)"));
const deleteEdgeFn = flat(functionBody(screen, "async function handleDeleteEdge(edgeId: string)"));
/** 지워진 **뒤**의 뒤처리 둘. */
const nodeDeletedFn = flat(functionBody(screen, "function handleNodeDeleted(nodeId: string, newUpdatedAt: string)"));
const edgeDeletedFn = flat(functionBody(screen, "function handleEdgeDeleted(edgeId: string, newUpdatedAt: string)"));

describe("[진단] [Delete] 로 지우기 — ① 먼저 표본 확인", () => {
  test("🔵 파일 다섯이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ screen, nodePanel, edgePanel, graph, planModule })) {
      assert.ok(source.length > 2000, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(screen.includes("planProcedureDeleteKey({"), "화면이 판정을 부르는 자리");
    assert.ok(screen.includes('from "@/lib/domain/procedure-editor-delete-key"'), "🔴 판정을 **베끼지 않고** 절차 쪽 한 벌을 그대로 쓴다");
    assert.ok(planModule.includes("export function planProcedureDeleteKey("), "판정 본체");
    assert.ok(planModule.includes("export function isTextEntryTarget("), "글자 칸 판정");
  });

  test("🔵 떼어 낸 몸통 다섯이 **비어 있지 않다** — 비면 아래 절들이 빈 글자를 뒤진다", () => {
    for (const [name, body] of Object.entries({ keyHandler, deleteNodeFn, deleteEdgeFn, nodeDeletedFn, edgeDeletedFn })) {
      assert.ok(body.length > 150, `${name} 몸통을 못 떼어 냈다 (길이 ${body.length})`);
    }
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 요청 원문과 옛 모습이 남아 있다", () => {
    assert.ok(screenRaw.includes("[진단 FLOWCHART]에서도 같은 동작이 되야 해"), "요청 원문이 주석에 경위로 남아 있어야 한다");
    assert.ok(!screen.includes("[진단 FLOWCHART]에서도 같은 동작이 되야 해"), "걷어낸 쪽에는 없어야 한다");
    assert.ok(nodePanelRaw.includes("deleteRepairCaseFlowchartNodeAction"), "패널 주석에 **전에는 여기서 불렀다**가 경위로 남아 있어야 한다");
  });
});

describe("[진단] [Delete] 로 지우기 — ②🔴 화면이 판정을 **다시 하지 않는다**", () => {
  test("🔴 키 글자를 화면이 직접 비교하지 않는다 — Backspace 결정이 두 곳에 적히면 한쪽만 고쳐진다", () => {
    // 🔴 「노드·연결선은 [Delete] 로만, 경로점은 Backspace 도」는 2026-11-21 쓰는 분
    //    결정이고 순수 함수 한 곳에 적혀 있다. 화면이 키 글자를 한 번 더 비교하면
    //    그 결정이 두 곳에 적힌 것이 된다.
    assert.ok(!screen.includes('"Backspace"'), "화면에 Backspace 글자가 남아 있다");
    assert.ok(!screen.includes('"Delete"'), "화면이 키 글자를 직접 비교하고 있다");
    assert.ok(keyHandler.includes("key: e.key,"), "키는 판정에 그대로 넘겨야 한다");
  });

  test("🔴 고른 id 는 **그림에 그려진 것**에서 뽑는다 — 사라진 노드에 삭제를 날리면 안 된다", () => {
    assert.ok(f.includes("const deletableNodeId = selectedNode?.id ?? null;"));
    assert.ok(f.includes("const deletableEdgeId = selectedEdge?.id ?? null;"));
    assert.ok(keyHandler.includes("selectedNodeId: deletableNodeId,"));
    assert.ok(keyHandler.includes("selectedEdgeId: deletableEdgeId,"));
    // 🔵 둘 다 renderedNodes/renderedEdges 에서 찾은 값이라는 근거.
    assert.ok(f.includes("const selectedNode = renderedNodes.find((n) => n.id === selectedNodeId) ?? null;"));
    assert.ok(f.includes("const selectedEdge = renderedEdges.find((e) => e.id === selectedEdgeId) ?? null;"));
  });

  test("🔴 바뀐 값이 keydown 에 닿는다 — 의존성에서 빠지면 **옛 값으로 판정**한다", () => {
    const deps = f.slice(f.indexOf('window.addEventListener("keydown", handleKeyDown)'));
    for (const dep of ["canEdit", "deletableNodeId", "deletableEdgeId", "selectedWaypointIndex"]) {
      assert.ok(deps.slice(0, 300).includes(dep), `keydown 의 의존성에 ${dep} 가 없다`);
    }
  });

  test("🔴 **연결선을 고르면 노드 선택이 풀린다** — 안 풀면 [Delete] 가 엉뚱한 노드를 지운다", () => {
    // 🔵 이 줄은 2026-08-20 부터 있던 것이고 이번 조각이 만든 것이 아니다. 그래도
    //    여기서 못 박는 까닭: 키는 패널과 **같은 차례**(노드가 서 있으면 노드)를
    //    따르므로, 이 줄이 사라지는 날 틀리는 쪽은 키가 아니라 **선택**이다.
    assert.ok(
      f.includes("setSelectedEdgeId(edgeId); setSelectedNodeId(null);"),
      "연결선을 고를 때 노드 선택을 푸는 줄이 사라졌다 — 선을 누르고 [Delete] 를 치면 노드가 지워진다"
    );
  });
});

describe("[진단] [Delete] 로 지우기 — ③🔴🔴 글자 칸 보호가 **화면에서도** 산다", () => {
  test("🔴 포커스가 어디인지 실제로 본다 — document.activeElement 를 판정에 넘긴다", () => {
    assert.ok(keyHandler.includes("isTypingTarget: isTextEntryTarget(document.activeElement),"));
  });

  test("🔴 NONE 이면 **preventDefault 를 안 한다** — 하면 글자 칸에서 글자가 안 지워진다", () => {
    const none = keyHandler.indexOf('if (plan.action === "NONE") return;');
    const prevent = keyHandler.indexOf("e.preventDefault();");
    assert.notEqual(none, -1, "NONE 에서 돌아가는 줄이 없다");
    assert.notEqual(prevent, -1, "지울 때는 preventDefault 를 해야 한다");
    assert.ok(none < prevent, "preventDefault 가 NONE 검사보다 앞에 있다 — 글자 칸에서 [Delete] 가 먹힌다");
    assert.equal(countOf(keyHandler, "e.preventDefault();"), 1, "preventDefault 가 여러 곳에 흩어져 있다");
  });

  test("🔵 제목·설명·작업 지시 칸이 실제로 textarea 다 — 보호가 무엇을 가리는지의 근거", () => {
    // 🔵 isTextEntryTarget 은 INPUT · TEXTAREA · SELECT · contenteditable 을 글자
    //    칸으로 친다. 이 패널의 칸들이 그 가운데 하나가 아니면 보호가 헛돈다.
    assert.equal(countOf(nodePanel, "<textarea"), 3, "제목·설명·작업 지시 요약 셋");
    assert.ok(nodePanel.includes("<select"), "노드 유형 칸");
    assert.ok(flat(stripComments(screenRaw)).includes('id="faultTagInput"'), "고장 개소 칸(화면 위쪽)도 글자 칸이다");
  });
});

describe("[진단] [Delete] 로 지우기 — ④🔴 지우는 길은 **단추와 같은 하나**다", () => {
  test("🔴 패널이 더 이상 서버 액션을 **제 손으로 안 부른다**", () => {
    assert.ok(!nodePanel.includes("deleteRepairCaseFlowchartNodeAction"), "노드 패널이 아직 제 손으로 지우고 있다");
    assert.ok(!edgePanel.includes("deleteRepairCaseFlowchartEdgeAction"), "연결선 패널이 아직 제 손으로 지우고 있다");
    // 🔵 다른 일은 그대로 패널에 남아 있다는 근거 — 통째로 비워 버린 것이 아니다.
    assert.ok(edgePanel.includes("insertRepairCaseFlowchartNodeOnEdgeAction("), "경로점 자리에 노드 삽입은 그대로 패널의 일이다");
  });

  test("🔴 화면에 부르는 자리가 **각각 하나뿐**이다", () => {
    assert.equal(countOf(f, "await deleteRepairCaseFlowchartNodeAction({"), 1);
    assert.equal(countOf(f, "await deleteRepairCaseFlowchartEdgeAction({"), 1);
  });

  test("🔴 단추와 키가 **같은 함수 둘**을 부른다", () => {
    assert.ok(f.includes("onDelete={() => void handleDeleteNode(selectedNode.id)}"), "노드 패널의 단추");
    assert.ok(f.includes("onDelete={() => void handleDeleteEdge(selectedEdge.id)}"), "연결선 패널의 단추");
    assert.ok(
      f.includes("const deleteByKeyRef = useRef({ node: handleDeleteNode, edge: handleDeleteEdge, removeSelectedWaypoint: handleRemoveSelectedWaypoint });"),
      "키가 부르는 셋이 단추와 같은 함수여야 한다"
    );
    assert.ok(keyHandler.includes("deleteByKeyRef.current.node(plan.nodeId)"));
    assert.ok(keyHandler.includes("deleteByKeyRef.current.edge(plan.edgeId)"));
    assert.ok(!keyHandler.includes("Action("), "키가 서버 액션을 직접 부르고 있다");
  });

  test("🔴 뒤처리를 하나도 안 잃었다 ① — 「연결된 분기가 N개」 거절 글이 그대로다", () => {
    assert.ok(deleteNodeFn.includes('if ("blockingEdgeCount" in result)'), "서버의 그 거절을 갈라 보는 줄");
    assert.ok(
      deleteNodeFn.includes("이 노드에 연결된 분기가 ${result.blockingEdgeCount}개 있어 삭제할 수 없습니다. 먼저 연결된 분기를 삭제해 주세요."),
      "막힌 까닭의 글자가 바뀌었다 — 이번 조각은 이 동작을 한 글자도 안 바꾼다"
    );
    assert.ok(nodePanel.includes("{deleteBlockedMessage && <p"), "그 글이 삭제 단추 위에 그대로 뜬다");
  });

  test("🔴 뒤처리를 하나도 안 잃었다 ② — 실패 사유 · 「삭제 중...」 이 그대로다", () => {
    assert.ok(deleteNodeFn.includes("setNodeDeleteErrorMessage({ nodeId, message: result.message });"));
    assert.ok(deleteEdgeFn.includes("setEdgeDeleteErrorMessage({ edgeId, message: result.message });"));
    assert.ok(nodePanel.includes("{deleteErrorMessage && <p"), "노드 패널의 실패 사유 자리");
    assert.ok(edgePanel.includes("{deleteErrorMessage && <p"), "연결선 패널의 실패 사유 자리");
    assert.ok(nodePanel.includes('{isDeleting ? "삭제 중..." : "노드 삭제"}'));
    assert.ok(edgePanel.includes('{isDeleting ? "삭제 중..." : "분기 삭제"}'));
    assert.ok(nodePanel.includes("disabled={isDeleting}") && edgePanel.includes("disabled={isDeleting}"));
  });

  test("🔴 뒤처리를 하나도 안 잃었다 ③ — 되돌리기 단계 · 저장 전 수정 치우기 · 선택 풀기 · 새로고침", () => {
    assert.ok(deleteNodeFn.includes("handleNodeDeleted(nodeId, result.updatedAt);"), "성공했을 때만 뒤처리로 간다");
    assert.ok(deleteEdgeFn.includes("handleEdgeDeleted(edgeId, result.updatedAt);"));
    for (const [name, body, undo, selection] of [
      ["노드", nodeDeletedFn, "pushNodeDeletionUndoStep({", "setSelectedNodeId(null);"],
      ["연결선", edgeDeletedFn, "pushEdgeDeletionUndoStep({", "setSelectedEdgeId(null);"],
    ] as const) {
      assert.ok(body.includes(undo), `${name} 삭제의 되돌리기 단계가 사라졌다 — [이전]으로 되살릴 수 없게 된다`);
      assert.ok(body.includes(selection), `${name} 삭제 뒤 선택을 푸는 줄이 사라졌다`);
      assert.ok(body.includes("handleSaved(newUpdatedAt);"), `${name} 삭제 뒤 서버 상태 따라잡기가 사라졌다`);
    }
    assert.ok(nodeDeletedFn.includes("setPendingNodeDraftsById(") && nodeDeletedFn.includes("setPendingNodePositionsById("));
    assert.ok(edgeDeletedFn.includes("setPendingEdgeDraftsById(") && edgeDeletedFn.includes("setPendingRoutePointsByEdgeId("));
    assert.ok(edgeDeletedFn.includes("setSelectedWaypointIndex(null);"), "연결선이 사라지면 그 위의 경로점 선택도 풀려야 한다");
  });

  test("🔴 지우는 중에 **또 부르지 못한다** — 키에는 막아 줄 단추가 없다", () => {
    for (const [name, body] of [
      ["노드", deleteNodeFn],
      ["연결선", deleteEdgeFn],
    ] as const) {
      assert.ok(body.includes("if (isDeleteInFlightRef.current) return;"), `${name} 쪽에 자동 반복 울타리가 없다`);
      assert.ok(body.includes("isDeleteInFlightRef.current = true;"));
      assert.ok(body.includes("if (!canEdit) return;"), `${name} 쪽에 권한 울타리가 없다`);
    }
  });

  test("🔴 경로점은 **쓰던 통로 그대로** 지운다 — 새로 베껴 적지 않는다", () => {
    assert.ok(keyHandler.includes("deleteByKeyRef.current.removeSelectedWaypoint();"));
    assert.ok(screen.includes("function handleRemoveSelectedWaypoint()"), "경로점 지우개가 사라졌다");
    assert.ok(f.includes("onRemoveSelectedWaypoint={handleRemoveSelectedWaypoint}"), "[선택 경로점 삭제] 단추가 부르는 그 함수여야 한다");
    // 🔴 `removeWaypoint(` 는 graph-editor-core/routing 의 **날 함수**다. 키가 그것을
    //    직접 부르면 되돌리기 단계(pushPendingUndoStep)와 선택 풀기가 통째로 빠진다 —
    //    그 둘은 handleRemoveSelectedWaypoint 안에만 있다.
    assert.ok(!keyHandler.includes("removeWaypoint("), "키가 경로점 지우기를 제 손으로 다시 하고 있다");
    assert.ok(
      functionBody(screen, "function handleRemoveSelectedWaypoint()").includes("pushPendingUndoStep();"),
      "경로점 지우개 안의 되돌리기 단계가 사라졌다 — 위 단언이 지키려던 것이 그것이다"
    );
  });

  test("🔵 확인 창을 안 띄운다 — 지금 삭제 **단추**도 안 띄운다([이전]이 서버에 다시 만든다)", () => {
    assert.ok(!keyHandler.includes("confirm("), "키에 확인 창이 생겼다 — 단추와 다르게 굴면 안 된다");
    assert.ok(!deleteNodeFn.includes("confirm(") && !deleteEdgeFn.includes("confirm("), "단추 쪽에 확인 창이 생겼다면 이 시험의 전제가 바뀐 것이다");
  });

  test("🔴 삭제 칸을 세우는 값과 키가 보는 값이 **같다**(canEdit)", () => {
    for (const [name, panel, heading] of [
      ["노드", nodePanel, "노드 삭제</h4>"],
      ["연결선", edgePanel, "분기 삭제</h4>"],
    ] as const) {
      const at = panel.indexOf(heading);
      assert.notEqual(at, -1, `${name} 삭제 칸이 사라졌다`);
      assert.ok(panel.slice(Math.max(0, at - 400), at).includes("{canEdit &&"), `${name} 삭제 칸을 세우는 값이 canEdit 이 아니다`);
    }
    assert.ok(keyHandler.includes("canDeleteGraph: canEdit,"), "키가 보는 값도 canEdit 이어야 한다");
  });
});

describe("[진단] [Delete] 로 지우기 — ⑤🔴 등록은 **하나**, 그리고 치운다", () => {
  test("🔴 keydown 등록이 화면에 하나뿐이다 — 둘이면 한 번 누른 키에 둘이 반응한다", () => {
    assert.equal(countOf(screen, 'addEventListener("keydown"'), 1);
  });

  test("🔴 그림·패널 어디에도 또 등록하지 않았다", () => {
    for (const [name, source] of [
      ["그림(CaseFlowchartGraph)", graph],
      ["노드 패널", nodePanel],
      ["연결선 패널", edgePanel],
    ] as const) {
      assert.ok(!source.includes('addEventListener("keydown"'), `${name} 에도 keydown 등록이 생겼다`);
    }
  });

  test("🔴 떼어 내는 줄이 있다 — 없으면 렌더마다 쌓여 한 번에 여럿이 지워진다", () => {
    assert.ok(f.includes('return () => window.removeEventListener("keydown", handleKeyDown);'));
  });
});

describe("[진단] [Delete] 로 지우기 — ⑥🔴 **상시 안내를 세우지 않았다**", () => {
  test("🔴 화면에 키를 설명하는 글이 없다 — 절차 쪽에서 두 번 세웠다 두 번 다 지웠다(d57f664a)", () => {
    assert.ok(!screen.includes("[Delete]"), "편집기 화면에 [Delete] 안내가 섰다");
    assert.ok(!screen.includes("Delete 키"), "편집기 화면에 키 설명이 섰다");
    // 🔵 지금 서 있는 안내 줄이 실제로 있다는 근거 — 「글이 없다」가 화면이 통째로
    //    비어서 통과하는 것이 아니다.
    assert.ok(screen.includes("편집 모드 — 노드를 드래그해 위치를 조정하고"), "원래 있던 안내 줄은 그대로여야 한다");
  });

  test("🔵 다만 삭제 단추의 **툴팁**에는 적는다 — 자리를 안 차지하고 찾는 사람만 본다", () => {
    assert.ok(nodePanel.includes('title="[Delete] 키로도 지울 수 있습니다"'));
    assert.ok(edgePanel.includes('"[Delete] 키로도 지울 수 있습니다"'));
  });

  test("🔴 그 글자가 **툴팁 밖으로 새지 않았다** — `<p>` 로 한 줄 더 서면 안내가 된다", () => {
    for (const [name, source] of [
      ["노드 패널", nodePanel],
      ["연결선 패널", edgePanel],
    ] as const) {
      let at = source.indexOf("[Delete]");
      assert.notEqual(at, -1, `${name} 에 툴팁이 아예 없다 — 위 단언과 함께 깨져야 한다`);
      while (at !== -1) {
        assert.ok(source.slice(Math.max(0, at - 160), at).includes("title="), `${name} 의 [Delete] 가 툴팁 밖에 있다`);
        at = source.indexOf("[Delete]", at + 1);
      }
    }
  });

  test("🔵 연결선 툴팁은 **경로점이 먼저**라는 차례를 그대로 말한다", () => {
    // 🔵 경로점을 고른 동안에는 [Delete] 가 그 점부터 지운다(가장 안쪽). 그 상태에서
    //    「[Delete] 로도 분기를 지울 수 있다」고 적으면 거짓이다.
    assert.ok(edgePanel.includes('title={selectedWaypointIndex === null ? "[Delete] 키로도 지울 수 있습니다"'));
    assert.ok(edgePanel.includes("경로점을 고른 동안에는 [Delete] 가 그 경로점을 먼저 지웁니다"));
    // 🔴 그 차례가 판정에도 실제로 적혀 있다는 근거(순수 함수의 ①).
    assert.ok(planModule.includes('return { action: "REMOVE_WAYPOINT", edgeId: input.selectedEdgeId, waypointIndex: input.selectedWaypointIndex };'));
  });
});

describe("[진단] [Delete] 로 지우기 — ⑦🔴 절차에 있고 **진단에 없는 개념 셋**", () => {
  test("🔴 미리 막는 까닭은 **null** 이다 — 진단 노드 행에는 그 칸이 아예 없다", () => {
    assert.ok(keyHandler.includes("nodeDeleteBlockedReason: null,"));
    // 🔴 「그 자리가 있긴 한가」를 함께 센다 — 이름이 바뀌면 위 단언이 조용히
    //    「없는 칸에 null 을 넘기는」 글자가 되어 영영 통과한다.
    assert.ok(planModule.includes("readonly nodeDeleteBlockedReason: string | null;"), "판정이 받는 칸이 사라졌다");
    // 🔴 절차 쪽의 셈 함수를 끌어다 쓰지 않았다는 근거. 진단 노드에는 체크리스트·
    //    고장 진단표 칸이 없어 그 함수는 컴파일도 안 된다.
    assert.ok(!screen.includes("resolveProcedureNodeDeleteBlockedReason"), "진단 화면이 절차의 셈 함수를 부르고 있다");
    // 🔴 그리고 그 「막힘」은 **서버만 안다**는 것이 이 null 의 근거다.
    assert.ok(deleteNodeFn.includes('"blockingEdgeCount" in result'), "막힘을 서버 응답에서 받는다는 근거가 사라졌다");
  });

  test("🔴 [범위 선택]은 진단에 아직 없다 — false / [] 를 넘겨 그 가지를 안 세운다", () => {
    assert.ok(keyHandler.includes("boxSelectActive: false,"));
    assert.ok(keyHandler.includes("boxSelectedNodes: [],"));
    assert.ok(!keyHandler.includes("DELETE_NODES"), "복수 갈래를 받는 길이 생겼다 — 아직 그 기능이 없다");
    assert.ok(!screen.includes("boxSelectedNodeIds"), "진단 화면에 범위 선택 상태가 생겼다");
    // 🔵 판정 쪽에는 그 갈래가 분명히 있다는 근거 — 「없는 갈래라 안 썼다」가 아니라
    //    **쓸 수 있는데 지금은 안 쓴다**는 것이 이 단언의 뜻이다.
    assert.ok(planModule.includes('readonly action: "DELETE_NODES"'), "판정의 복수 갈래가 사라졌다");
  });

  test("🔴 분류 개념이 없으므로 canDeleteGraph 자리에 canEdit 을 그대로 넘긴다", () => {
    assert.ok(keyHandler.includes("canEdit,"), "경로점 쪽 잣대(canEdit)");
    assert.ok(keyHandler.includes("canDeleteGraph: canEdit,"), "삭제 쪽 잣대도 같은 값");
    // 🔵 진단 편집기에 절차의 「분류/배치 모드」 같은 둘째 잣대가 없다는 근거.
    assert.ok(!screen.includes("layoutMode"), "진단 화면에 배치 모드 개념이 생겼다 — 그러면 잣대를 다시 봐야 한다");
  });
});
