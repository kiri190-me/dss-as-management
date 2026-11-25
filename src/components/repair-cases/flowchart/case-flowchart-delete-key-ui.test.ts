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

/**
 * 🔴 **차례를 2026-11-25 에 뒤집었다.** 전에는 JSX 주석(`{/* … *\/}`)을 **통째로** 먼저
 * 걷었는데, 그 정규식은 `{` 뒤 아무 블록 주석에서나 시작해 **파일 뒤쪽의 첫 `*\/}` 까지**
 * 게을리 삼킨다. 이 패널의 props 타입이 `}: {` 바로 뒤에 JSDoc 으로 시작하는 탓에, 패널
 * 본문에 JSX 주석이 **하나 생기자마자** 그 사이의 7천 자가 통째로 사라졌다 —
 * `<textarea` 세 개가 0 개로 세어지는, 원본은 멀쩡한데 시험만 우는 자리다.
 * 🔵 지금 차례는 이웃 case-flowchart-structural-deferred-save.test.ts 와 **같다**: 블록
 * 주석을 먼저 걷으면 JSX 주석은 **속이 비어** `{ }` 짝만 남고, 그것만 치우면 된다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석(JSX 주석의 속도 여기서 걷힌다)
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n")
    .replace(/\{\s*\}/g, " "); // 속이 걷히고 남은 빈 JSX 주석 자리
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
/**
 * 지우기를 받는 자리 둘 — ④절이 「뒤처리를 하나도 안 잃었는가」를 여기서 센다.
 *
 * 🔴 2026-11-21(조각 C2)에 **async 가 떨어졌다.** 지우기가 [저장] 쪽으로 옮겨가면서
 * 이 둘은 더 이상 서버를 안 부르고, 지워진 **뒤**의 뒤처리를 맡던 handleNodeDeleted /
 * handleEdgeDeleted 는 통째로 이 안으로 들어왔다(기다릴 것이 없어 둘로 나눌 까닭이
 * 사라졌다). 그 뒤처리 하나하나를 ④절이 여기서 다시 센다.
 */
const deleteNodeFn = flat(functionBody(screen, "function handleDeleteNode(nodeId: string)"));
const deleteEdgeFn = flat(functionBody(screen, "function handleDeleteEdge(edgeId: string)"));
/** 구조 변경을 모아 두는 **단 하나의 통로**. ④절이 「지우기가 이것을 정확히 한 번 지나는가」를 센다. */
const queueFn = flat(functionBody(screen, "function queueStructural("));
/** 모아 둔 조작 한 건을 실제로 서버로 보내는 자리 — 지우기의 서버 호출이 **여기로 옮겨 왔다.** */
const executeStructuralFn = flat(functionBody(screen, "async function executeStructuralOperation("));

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
    for (const [name, body] of Object.entries({ keyHandler, deleteNodeFn, deleteEdgeFn, queueFn, executeStructuralFn })) {
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
    // 🔴 2026-11-21(조각 C2) — **삽입도 패널을 떠났다.** 전에는 이 자리가
    //    「다른 일은 그대로 패널에 남아 있다」는 근거였는데, 그날 구조 변경 다섯이
    //    모두 [저장] 쪽으로 옮겨가면서 패널에 남은 서버 호출이 **하나도 없다.**
    assert.ok(!edgePanel.includes("insertRepairCaseFlowchartNodeOnEdgeAction"), "연결선 패널이 아직 제 손으로 노드를 끼우고 있다");
    assert.ok(!edgePanel.includes("Action("), "연결선 패널에 서버 액션 호출이 남아 있다");
    assert.ok(!nodePanel.includes("Action("), "노드 패널에 서버 액션 호출이 남아 있다");
    // 🔵 통째로 비워 버린 것이 아니라는 근거 — 끼우기는 **올려 보내는 일**로 남아 있고,
    //    서버를 부르던 시절의 울타리 둘(고른 경로점이 없다 · 그 자리에 점이 없다)도 그대로다.
    assert.ok(edgePanel.includes("onQueueInsertNode({ nodeType: insertNodeType, title: insertNodeTitle, position: point });"), "끼우기를 올려 보내는 줄");
    assert.ok(edgePanel.includes("if (selectedWaypointIndex === null || !routePoints) return;"), "끼우기의 울타리 ①");
    assert.ok(edgePanel.includes("if (!point) return;"), "끼우기의 울타리 ②");
  });

  test("🔴 화면에 부르는 자리가 **각각 하나뿐**이다", () => {
    assert.equal(countOf(f, "await deleteRepairCaseFlowchartNodeAction({"), 1);
    assert.equal(countOf(f, "await deleteRepairCaseFlowchartEdgeAction({"), 1);
    // 🔴 그 하나가 **구조 보내기 안**이라는 근거(2026-11-21, 조각 C2) — 지우기는
    //    이제 [저장]이 부른다. 여기가 어긋나면 「지우는 길이 둘」이 다시 생긴 것이다.
    assert.ok(executeStructuralFn.includes("await deleteRepairCaseFlowchartNodeAction({"), "노드 지우기가 구조 보내기 밖에서 불린다");
    assert.ok(executeStructuralFn.includes("await deleteRepairCaseFlowchartEdgeAction({"), "연결선 지우기가 구조 보내기 밖에서 불린다");
    assert.ok(!deleteNodeFn.includes("Action("), "handleDeleteNode 가 아직 서버를 직접 부른다");
    assert.ok(!deleteEdgeFn.includes("Action("), "handleDeleteEdge 가 아직 서버를 직접 부른다");
  });

  test("🔴 단추와 키가 **같은 함수 둘**을 부른다", () => {
    assert.ok(f.includes("onDelete={() => handleDeleteNode(selectedNode.id)}"), "노드 패널의 단추");
    assert.ok(f.includes("onDelete={() => handleDeleteEdge(selectedEdge.id)}"), "연결선 패널의 단추");
    // 🔵 2026-11-21(조각 B3′)에 ref 에 **넷째가 붙었다** — [범위 선택]으로 고른 여럿을
    //    지우는 handleDeleteNodes 다. 단수 둘이 패널과 같은 함수라는 것은 그대로
    //    지킨다(그것이 「단추와 같은 통로」의 근거다). 그 넷과 함께 모드·고른 칸도
    //    같은 ref 로 나른다(까닭은 그 자리 주석에 — 의존성에 넣으면 글자 한 자마다
    //    keydown 등록이 돈다).
    assert.ok(
      f.includes(
        "const deleteByKeyRef = useRef({ node: handleDeleteNode, edge: handleDeleteEdge, nodes: handleDeleteNodes, removeSelectedWaypoint: handleRemoveSelectedWaypoint, boxSelectActive, boxSelectedNodes: boxSelectedDeleteCandidates, });"
      ),
      "키가 부르는 넷이 단추와 같은 함수여야 한다"
    );
    assert.ok(keyHandler.includes("deleteByKeyRef.current.node(plan.nodeId)"));
    assert.ok(keyHandler.includes("deleteByKeyRef.current.edge(plan.edgeId)"));
    assert.ok(keyHandler.includes("deleteByKeyRef.current.nodes(plan.nodeIds)"), "복수도 같은 ref 를 지나야 한다");
    assert.ok(!keyHandler.includes("Action("), "키가 서버 액션을 직접 부르고 있다");
  });

  test("🔴 뒤처리를 하나도 안 잃었다 ① — 막던 길이 **통째로 사라졌다**(C3: 붙은 선도 함께 지운다)", () => {
    // 🔴 2026-11-21(조각 C2) 에 **세는 쪽이 서버에서 화면으로 옮겨 왔고**, 같은 날
    //    조각 C3 에서 **막음 자체가 없어졌다.** 쓰는 분의 결정(원문): 「노드를 지우면
    //    연결된 연결선도 지워지는 거로 하자(연결선을 지우지 않아도 노드를 지울 수
    //    있도록).」 그래서 이 절은 뒤집혔다 — 지우지 **않고 돌아가는** 길이 하나도
    //    없는가를 잰다. 🔵 지우려는 **뜻**은 그대로다: 선이 붙은 채로 [저장]에 가면
    //    서버가 NODE_HAS_CONNECTED_EDGES 로 거절해 저장이 통째로 멈춘다. 화면이
    //    「막는다」에서 「함께 지운다」로 답을 바꿨을 뿐이다.
    assert.ok(!deleteNodeFn.includes("if (attachedEdgeIds.length > 0) {"), "붙은 선이 있으면 돌아가는 관문이 아직 있다");
    assert.ok(!screen.includes("삭제할 수 없습니다"), "화면이 아직 못 지운다고 말한다");
    assert.ok(!screen.includes("먼저 연결된 분기를 삭제해 주세요"), "사람이 선을 먼저 지우라고 아직 말하고 있다");
    // 🔴 **돌아가는 길은 권한 울타리 하나뿐**이다. 수로 재야 「다른 까닭으로 조용히
    //    안 지워지는」 가지가 새로 생겼을 때 걸린다 — 그 가지는 오류를 안 낸다.
    assert.equal(countOf(deleteNodeFn, "return;"), 1, "노드 삭제에 돌아가는 길이 늘었다 — 권한 울타리 말고는 없어야 한다");
    assert.ok(deleteNodeFn.includes("if (!canEdit) return;"), "그 하나가 권한 울타리라는 근거");
    // 🔴 그런데 **없어진 글은 주석에 경위로 남아 있어야 한다** — 걷어내기가 실제로
    //    일한다는 증거이자, 왜 막음이 없어졌는지를 다음 사람이 읽을 자리다.
    assert.ok(
      screenRaw.includes("이 노드에 연결된 분기가 N개 있어 삭제할 수 없습니다. 먼저 연결된 분기를 삭제해 주세요."),
      "뒤집기 전 문구가 주석에 경위로 남아 있어야 한다(주석 걷어내기가 일한다는 증거이기도 하다)"
    );
    // 🔴 세는 목록이 **그림에 그려진 선**(renderedEdges)이라는 근거. 서버 목록
    //    (`edges`)은 저장 전에 그은 선을 못 보고, 미리보기 목록
    //    (`structuralPreview.edges`)은 **저장 전에 옮긴 선의 옛 양 끝**을 들고 있다
    //    — 이 편집기는 재연결을 구조 조작이 아니라 초안 지도로 들고 있기 때문이다.
    //    그것으로 세면 떠난 선을 지우고 옮겨 온 선을 남긴다(둘 다 안 시킨 일이다).
    assert.ok(deleteNodeFn.includes("const attachedEdgeIds = findEdgesAttachedToNode(renderedEdges, nodeId);"), "붙은 선을 세는 줄");
    assert.ok(!deleteNodeFn.includes("findEdgesAttachedToNode(edges,"), "서버 목록으로 세고 있다");
    assert.ok(!deleteNodeFn.includes("findEdgesAttachedToNode(structuralPreview.edges,"), "초안을 안 얹은 목록으로 세고 있다");
    assert.ok(!deleteNodeFn.includes("planProcedureNodeDeletionOperations(structuralPreview.edges,"), "초안을 안 얹은 목록으로 쌓고 있다");
    assert.ok(!deleteNodeFn.includes("planProcedureNodeDeletionOperations(edges,"), "서버 목록으로 쌓고 있다");
  });

  test("🔴 뒤처리를 하나도 안 잃었다 ①-2 — 막음을 띄우던 **죽은 칸을 걷어냈다**", () => {
    // 🔴 막는 까닭이 하나뿐이었으므로, 그것이 없어진 순간 까닭을 쥐고 내려보내던
    //    칸도 값이 영영 null 이 된다 — 남기면 「꺼도 아무 일 없는 스위치」가 된다.
    //    🔵 서버 쪽 관문(NODE_HAS_CONNECTED_EDGES)은 **그대로 있다.** 화면이 선을
    //       먼저 보내서 안 걸릴 뿐이고, 그것을 재는 자리는 이웃
    //       case-flowchart-node-delete-cascade-ui.test.ts 다.
    assert.ok(!screen.includes("nodeDeleteBlockedMessage"), "화면에 막힌 까닭을 쥐는 칸이 남아 있다");
    assert.ok(!screen.includes("setNodeDeleteBlockedMessage"), "화면에 막힌 까닭을 띄우는 줄이 남아 있다");
    assert.ok(!screen.includes("deleteBlockedMessage={"), "패널로 내려보내는 프롭이 남아 있다");
    assert.ok(!nodePanel.includes("deleteBlockedMessage"), "노드 패널에 죽은 프롭이 남아 있다");
    // 🔵 걷어낸 것이 **삭제 칸 전체가 아니라는** 근거 — 단추와 상자는 그대로 산다.
    assert.ok(nodePanel.includes("> 노드 삭제 </button>"), "삭제 단추까지 걷어냈다");
    assert.ok(nodePanel.includes("노드 삭제</h4>"), "삭제 상자까지 걷어냈다");
  });

  test("🔴 뒤처리를 하나도 안 잃었다 ② — 「삭제 중...」·실패 사유는 **일어날 수 없게 되어** 없앴다", () => {
    // 🔴 지우기가 서버를 안 부르므로 기다릴 것도, 그 자리에서 날 실패도 없다. 값이
    //    늘 false/null 인 칸을 남겨 두면 「꺼도 아무 일 없는 스위치」가 된다.
    for (const [name, panel] of [
      ["노드", nodePanel],
      ["연결선", edgePanel],
    ] as const) {
      assert.ok(!panel.includes("isDeleting"), `${name} 패널에 「삭제 중」 칸이 남아 있다`);
      assert.ok(!panel.includes("deleteErrorMessage"), `${name} 패널에 삭제 실패 칸이 남아 있다`);
    }
    assert.ok(!screen.includes("isDeleteInFlightRef"), "화면에 자동 반복 빗장이 남아 있다 — 기다릴 서버가 없어 영영 안 풀린다");
    assert.ok(!screen.includes("setNodeDeleteErrorMessage") && !screen.includes("setEdgeDeleteErrorMessage"), "화면에 삭제 실패 칸이 남아 있다");
    // 🔵 **단추 글자는 그대로**다 — 없앤 것은 「삭제 중...」으로 바뀌던 갈래뿐이다.
    // 🔵 `flat` 이 공백을 하나로 접으므로 여는 꺾쇠와 글자 사이에 한 칸이 남는다.
    assert.ok(nodePanel.includes("> 노드 삭제 </button>"));
    assert.ok(edgePanel.includes("> 분기 삭제 </button>"));
    // 🔴 실패를 말하는 자리가 **사라진 것이 아니라 옮겨 간** 근거 — 서버가 거절하면
    //    [저장]의 빨간 글로 뜬다. 이 줄이 없으면 거절이 어디에도 안 보인다.
    assert.ok(f.includes("{globalSaveStatus === \"failed\" && globalSaveError && <span"), "저장 실패를 띄우는 자리가 사라졌다");
    assert.ok(flat(functionBody(screen, "async function handleGlobalSave()")).includes("setGlobalSaveError(outcome.failureMessage);"));
  });

  test("🔴 뒤처리를 하나도 안 잃었다 ③ — 되돌리기 한 칸 · 저장 전 수정 치우기 · 선택 풀기", () => {
    // 🔴 되돌리기 한 칸은 이제 queueStructural 이 **목록을 고치기 전에** 찍는다.
    //    뒤에 찍으면 이미 바뀐 목록이 담겨 [이전]이 한 칸씩 밀린다.
    const push = queueFn.indexOf("pushPendingUndoStep();");
    const append = queueFn.indexOf("appendPendingStructuralOperations(");
    assert.ok(push !== -1, "되돌리기 한 칸을 찍는 줄이 사라졌다 — [이전]으로 되살릴 수 없게 된다");
    assert.ok(append !== -1 && push < append, "되돌리기 한 칸이 목록을 고친 **뒤**에 찍힌다");

    // 🔴 2026-11-21(조각 C3) — 노드 쪽이 쌓는 줄이 **한 줄에서 N+1 줄**이 됐다(붙은
    //    선의 DELETE_EDGE 들 + 노드의 DELETE_NODE). 그래도 **통로는 한 번**이다 —
    //    그것이 「[이전] 한 번에 노드와 선이 함께 돌아온다」의 근거다.
    for (const [name, body, queued, selection] of [
      ["노드", deleteNodeFn, "queueStructural(() => planProcedureNodeDeletionOperations(renderedEdges, nodeId, null));", "setSelectedNodeId(null);"],
      ["연결선", deleteEdgeFn, 'queueStructural(() => [{ kind: "DELETE_EDGE", edgeId, reason: null }]);', "setSelectedEdgeId(null);"],
    ] as const) {
      assert.ok(body.includes(queued), `${name} 삭제가 쌓는 줄이 바뀌었다`);
      assert.ok(body.includes(selection), `${name} 삭제 뒤 선택을 푸는 줄이 사라졌다`);
      // 🔴 **한 번만** 지난다 — 두 번 지나면 [이전]을 두 번 눌러야 한 걸음이 되돌아간다.
      assert.equal(countOf(body, "queueStructural("), 1, `${name} 삭제 한 번에 통로를 여러 번 지난다`);
    }
    // 🔴 지워질 것의 저장 전 수정을 함께 버린다 — 안 버리면 같은 저장에서 없는 행에
    //    칸 값을 쓰려 들어 **저장 전체가 실패한다**.
    assert.ok(deleteNodeFn.includes("setPendingNodeDraftsById((prev) => dropKeys(prev, [nodeId]));"));
    assert.ok(deleteNodeFn.includes("setPendingNodePositionsById((prev) => dropKeys(prev, [nodeId]));"));
    assert.ok(deleteEdgeFn.includes("setPendingEdgeDraftsById((prev) => dropKeys(prev, [edgeId]));"));
    assert.ok(deleteEdgeFn.includes("setPendingRoutePointsByEdgeId((prev) => dropKeys(prev, [edgeId]));"));
    assert.ok(deleteEdgeFn.includes("setSelectedWaypointIndex(null);"), "연결선이 사라지면 그 위의 경로점 선택도 풀려야 한다");
    // 🔴 조각 C3 — **함께 지워지는 선들의 뒤처리도 노드 쪽에 똑같이 있어야 한다.**
    //    선 하나를 어떻게 지웠느냐(단추로 직접 vs 노드에 딸려서)에 따라 뒤처리가
    //    갈리면, 딸려 지워진 선의 초안이 남아 [저장]이 없는 선을 고치려 든다.
    assert.ok(deleteNodeFn.includes("setPendingEdgeDraftsById((prev) => dropKeys(prev, attachedEdgeIds));"), "딸려 지워진 선의 칸 초안을 안 버린다");
    assert.ok(deleteNodeFn.includes("setPendingRoutePointsByEdgeId((prev) => dropKeys(prev, attachedEdgeIds));"), "딸려 지워진 선의 경로점을 안 버린다");
    assert.ok(
      deleteNodeFn.includes("if (selectedEdgeId !== null && attachedEdgeIds.includes(selectedEdgeId)) { setSelectedEdgeId(null); setSelectedWaypointIndex(null); }"),
      "딸려 지워진 선을 고른 채였을 때 선택·경로점을 안 푼다 — [Delete] 가 없는 선의 점을 지우러 간다"
    );
  });

  test("🔴 되돌리기 서명에 **구조 목록이 섞여 있다** — 안 섞으면 삭제 한 칸이 조용히 사라진다", () => {
    // 🔴 노드를 하나 지웠을 뿐이면 저장 전 지도 넷은 **완전히 똑같다.** 그러면
    //    pushUndoStep 이 「직전과 같은 상태」로 보고 안 쌓고, undoStep 은 「헛도는
    //    단계」로 보고 건너뛴다 — 오류도 경고도 없이 [이전]이 한 칸을 건너뛴다.
    assert.ok(f.includes("procedureStructuralOperationsSignature(snapshot.structuralOperations),"), "서명에 구조 목록이 안 섞여 있다");
    assert.ok(f.includes("structuralOperations: pendingStructuralOperations,"), "스냅샷에 구조 목록이 안 실린다");
    // 🔵 서명이 지도 넷도 **그대로** 센다는 근거 — 구조만 세도록 바뀌면 글자 편집
    //    되돌리기가 통째로 사라진다.
    for (const field of ["dump(snapshot.nodeDrafts)", "dump(snapshot.nodePositions)", "dump(snapshot.edgeDrafts)", "dump(snapshot.routePoints)"]) {
      assert.ok(f.includes(field), `서명에서 ${field} 가 빠졌다`);
    }
  });

  test("🔴 지우기에 **권한 울타리**가 그대로 있다", () => {
    for (const [name, body] of [
      ["노드", deleteNodeFn],
      ["연결선", deleteEdgeFn],
    ] as const) {
      assert.ok(body.includes("if (!canEdit) return;"), `${name} 쪽에 권한 울타리가 없다`);
    }
    // 🔵 통로 자체도 한 번 더 막는다 — 읽기 전용인데 목록에 줄이 쌓이면 [저장]이 켜진다.
    assert.ok(queueFn.includes("if (!canEdit) return [];"), "모아 두는 통로에 권한 울타리가 없다");
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

  test("🔵 확인 창을 안 띄운다 — 지금 삭제 **단추**도 안 띄운다([이전]이 목록에서 그 줄을 뺀다)", () => {
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
  test("🔴 미리 막는 까닭은 **null** 이다 — 키가 판정을 두 벌로 만들지 않는다", () => {
    assert.ok(keyHandler.includes("nodeDeleteBlockedReason: null,"));
    // 🔴 「그 자리가 있긴 한가」를 함께 센다 — 이름이 바뀌면 위 단언이 조용히
    //    「없는 칸에 null 을 넘기는」 글자가 되어 영영 통과한다.
    assert.ok(planModule.includes("readonly nodeDeleteBlockedReason: string | null;"), "판정이 받는 칸이 사라졌다");
    // 🔴 절차 쪽의 셈 함수를 끌어다 쓰지 않았다는 근거. 진단 노드에는 체크리스트·
    //    고장 진단표 칸이 없어 그 함수는 컴파일도 안 된다.
    assert.ok(!screen.includes("resolveProcedureNodeDeleteBlockedReason"), "진단 화면이 절차의 셈 함수를 부르고 있다");
    // 🔴 2026-11-21(조각 C2)에 잠깐 「연결선이 붙은 노드」라는 막음이 화면에 섰다가,
    //    같은 날 조각 C3 에서 **없어졌다**(붙은 선도 함께 지운다). 그래서 이 칸이
    //    null 인 까닭은 다시 처음 그대로다 — **진단에는 미리 막는 까닭이 하나도 없다.**
    //    🔴 C2 때 적힌 「키가 미리 막으면 패널에 까닭이 안 뜨니까」는 **폐기됐다.**
    //       띄울 까닭도, 패널에 그 자리도 더는 없다.
    assert.ok(!keyHandler.includes("findEdgesAttachedToNode"), "키가 붙은 선을 제 손으로 다시 세고 있다 — 판정이 두 벌이 된다");
    assert.ok(!deleteNodeFn.includes("setNodeDeleteBlockedMessage"), "막음을 띄우는 줄이 아직 handleDeleteNode 에 있다");
    // 🔴 **단추와 키가 같은 답을 낸다**는 것이 이 절의 뜻이다. 화면 어디에도 노드
    //    삭제를 미리 막는 판정이 없고(위 ①-2), 키도 null 을 넘긴다 — 둘이 맞아야
    //    「단추로는 지워지는데 키로는 안 된다」(또는 그 반대)가 안 생긴다.
    assert.ok(!screen.includes("BlockedMessage"), "막힌 까닭을 쥐는 칸이 화면에 다시 생겼다");
    assert.equal(countOf(f, "nodeDeleteBlockedReason"), 1, "화면에서 그 낱말이 나오는 자리는 키에 null 을 넘기는 한 줄뿐이어야 한다");
  });

  test("🔴 [범위 선택]이 **[Delete] 까지 왔다** — 다만 막는 까닭은 칸마다 여전히 null 이다", () => {
    // 🔴 2026-11-21(조각 B3′) — 이 절의 단언이 **두 번째로 뒤집혔다.** 처음에는
    //    「화면에 `boxSelectedNodeIds` 가 **없다**」였고(C3), B2′ 가 도구를 세우면서
    //    「상태는 있는데 **키로는 안 흘러간다**」가 됐다. 이번 조각이 바로 그 흘러가는
    //    길을 뚫었으므로 또 **반대 방향으로** 고쳐 적는다 — 지우면 「들어왔다 다시
    //    빠져도」 아무도 모른다.
    // 🔴 **이 절이 계속 지키는 것**: 복수 갈래가 서도 「미리 막는 까닭」은 진단에
    //    여전히 **하나도 없다.** 칸마다 싣는 deleteBlockedReason 이 전부 null 이어야
    //    하고(절차는 체크리스트·고장 진단표를 보고 채운다), 그 말은 **고른 것이 전부
    //    지워진다**는 뜻이다.
    assert.ok(keyHandler.includes("boxSelectActive: deleteByKeyRef.current.boxSelectActive,"), "모드를 판정에 안 넘긴다");
    assert.ok(keyHandler.includes("boxSelectedNodes: deleteByKeyRef.current.boxSelectedNodes,"), "고른 칸들을 판정에 안 넘긴다");
    assert.ok(keyHandler.includes('if (plan.action === "DELETE_NODES") {'), "복수 갈래를 받는 길이 없다");
    assert.ok(screen.includes("const [boxSelectedNodeIds, setBoxSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set<string>());"), "범위 선택 상태가 화면에서 사라졌다");
    assert.ok(
      flat(screen).includes("boxSelectedNodeIds={boxSelectedNodeIds} onBoxSelectionChange={setBoxSelectedNodeIds}"),
      "고른 집합을 그림에 안 넘긴다 — 그림이 제 안의 값으로 돌면 화면이 그것을 못 읽는다"
    );
    // 🔴 **그 낱말이 화면에 나오는 자리는 다섯**이다(상태 선언 · 그림에 넘기는 둘 ·
    //    고른 칸을 추리는 한 줄 · [연결 정렬]이 펼 선을 세는 한 줄). 수로 재지 않으면
    //    여섯째가 몰래 꽂혀도 위 단언들은 멀쩡히 통과한다.
    // 🔴 2026-11-22(조각 D2) — **넷에서 다섯**이 됐다. 늘어난 하나는 [Delete] 와
    //    아무 상관이 없다(고른 칸들 **사이의 연결선**을 한 번에 곧게 펴는 기능이다 —
    //    case-flowchart-straighten-selected-edges-ui.test.ts). 지우지 않고 **수를
    //    올려 적는** 까닭은 위와 같다. 🔵 늘어난 자리가 **읽기**라는 것도 함께
    //    못 박는다 — 갈아 끼우는 쪽(setBoxSelectedNodeIds)이 늘면 「언제 비워지는가」가
    //    화면에도 적히기 시작한 것이고, 그것은 다른 이야기다.
    assert.equal(countOf(f, "boxSelectedNodeIds"), 5, "고른 집합을 쓰는 자리가 늘었다 — 어디로 샜는지 보라");
    assert.ok(
      f.includes("planStraightenEdgeOrder(renderedEdges, boxSelectedNodeIds)"),
      "그 다섯째 자리가 **[연결 정렬]이 펼 선을 세는 줄**이 아니다 — 무엇이 늘었는지 모른 채 수만 올리면 이 단언이 뜻을 잃는다"
    );
    // 🔴🔴 **막는 까닭은 칸마다 null 이다** — 진단 노드 행에는 절차가 보는 칸
    //      (체크리스트·고장 진단표)이 아예 없어 셀 수조차 없다. 글자로 못 박아 두지
    //      않으면 어느 날 「임시로」 다른 값이 들어가고, 그러면 단추와 키가 다른 답을
    //      낸다(단추 쪽에는 미리 막는 판정이 아예 없다 — ①-2절).
    assert.ok(
      f.includes("renderedNodes .filter((n) => boxSelectedNodeIds.has(n.id)) .map((n) => ({ id: n.id, deleteBlockedReason: null }));"),
      "고른 칸을 추리는 줄이 바뀌었다 — 그려진 목록을 돌지 않거나, 막는 까닭이 null 이 아니다"
    );
    assert.ok(!screen.includes("resolveProcedureNodeDeleteBlockedReason"), "진단 화면이 절차의 셈 함수를 부르고 있다");
    assert.ok(planModule.includes("readonly deleteBlockedReason: string | null }"), "판정이 칸마다 받는 그 자리가 사라졌다");
    // 🔵 판정 쪽 복수 갈래가 실제로 있다는 근거.
    assert.ok(planModule.includes('readonly action: "DELETE_NODES"'), "판정의 복수 갈래가 사라졌다");
  });

  test("🔴 분류 개념이 없으므로 canDeleteGraph 자리에 canEdit 을 그대로 넘긴다", () => {
    assert.ok(keyHandler.includes("canEdit,"), "경로점 쪽 잣대(canEdit)");
    assert.ok(keyHandler.includes("canDeleteGraph: canEdit,"), "삭제 쪽 잣대도 같은 값");
    // 🔵 진단 편집기에 절차의 「분류/배치 모드」 같은 둘째 잣대가 없다는 근거.
    assert.ok(!screen.includes("layoutMode"), "진단 화면에 배치 모드 개념이 생겼다 — 그러면 잣대를 다시 봐야 한다");
  });
});
