import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  PROCEDURE_AUTO_LAYOUT_SPACING,
  computeProcedureAutoLayout,
  procedureAutoLayoutNodeDimensions,
  procedureAutoLayoutNodeWidth,
  procedureBranchContinuesMainFlow,
  toAutoLayoutGhostNode,
  type ProcedureAutoLayoutEdge,
  type ProcedureAutoLayoutNode,
} from "./procedure-auto-layout";
import { buildFieldStepGhostGraph, fieldStepGhostNodeId, type FieldAddedStep, type FieldStepNeighbor } from "./procedure-field-added-steps";
import { decisionBranchSourceHandle } from "./procedure-edge-routing";
import {
  HORIZONTAL_HANDLE_IDS,
  VERTICAL_HANDLE_IDS,
  isAlignedHorizontalConnection,
  isAlignedVerticalConnection,
  resolveConnectionHandles,
} from "@/lib/graph-editor-core/layout";
import { PROCEDURE_BRANCH_TYPE_CODES } from "./procedure-template-types";

/**
 * ============================================================================
 * A 안 — **유령을 켠 그림 = 채택 뒤 그림** (2026-11-04)
 * ============================================================================
 * 사용자 결정: 「A로 가자」. 유령 칸을 자동 배치에 함께 세워, 미리 보기가 넣은 뒤의
 * 진짜 모습이 되게 한다. 이 파일이 그 약속을 **값으로** 지킨다.
 *
 * ── 🔴 무엇과 무엇을 맞대는가 ───────────────────────────────────────────
 * 왼쪽: 유령을 켠 그림  = computeProcedureAutoLayout(초안 + 유령)
 * 오른쪽: 채택 뒤 그림  = computeProcedureAutoLayout(초안 + 채택이 만든 진짜 노드)
 * 오른쪽의 「채택이 만든 노드」는 adoptFieldAddedStep 이 DB 에 적는 것을 그대로
 * 흉내 낸 것이다(아래 adoptIntoDraft — 흉내가 실제와 어긋나면 이 비교는 아무 뜻이
 * 없으므로, 규칙마다 뮤테이션의 어느 줄에서 왔는지 적어 둔다. 그 줄이 진짜 그렇게
 * 도는지는 DB 시험이 따로 지킨다 —
 * procedure-field-step-adoption.integration.test.ts).
 *
 * ── 🔵 먼저 표본을 확인한다 ─────────────────────────────────────────────
 * 「두 지도가 같다」는 **둘 다 비어 있을 때도** 통과한다. 그래서 첫 묶음에서
 * ① 지도가 실제로 차 있고 ② 유령이 지도에 **칸 하나로 실제로 들어가고**
 * ③ 노드 폭이 제목마다 다르다는 것을 먼저 못 박는다.
 * ============================================================================
 */

const SPACING = PROCEDURE_AUTO_LAYOUT_SPACING;

function node(id: string, sortOrder: number, overrides: Partial<ProcedureAutoLayoutNode> = {}): ProcedureAutoLayoutNode {
  return {
    id,
    nodeType: "TASK",
    title: `작업 ${id}`,
    sortOrder,
    positionX: 0,
    positionY: 0,
    userPositionX: null,
    userPositionY: null,
    ...overrides,
  };
}

/**
 * 🔴 `branchType` 은 2026-11-05 오후에 **필수 칸**이 됐다 — 자동 배치가 이 값으로
 * 「주 흐름의 계속」을 가르고, 그 자식이 부모의 열을 그대로 잇는다. 받침값을
 * "DEFAULT"(기본·이름 없는 선)로 두는 것은 이 파일의 표본이 전부 곧은 줄기이기
 * 때문이다. 갈래가 자리를 정말 가르는지는 layout.test.ts 가 따로 잰다.
 */
function edge(fromNodeId: string, toNodeId: string, branchType: ProcedureAutoLayoutEdge["branchType"] = "DEFAULT"): ProcedureAutoLayoutEdge {
  return { fromNodeId, toNodeId, branchType };
}

/**
 * 어떤 칸의 **중심 y**. 자동 배치가 2026-11-05 부터 세로도 중심으로 맞추므로
 * (`y = 깊이 × 눈금 - 높이/2`), 깊이를 재려면 높이를 되더해야 한다.
 *
 * 🔴 높이를 상수로 적지 않고 **그림이 쓰는 바로 그 함수**로 잰다 — 숫자를 베껴
 * 두면 제목 한 글자에 높이가 바뀌는 날 시험이 이유 없이 깨지고, 더 나쁘게는
 * 「52 라고 적었으니 52 겠지」로 틀린 값을 지키게 된다.
 */
function centerY(positions: Map<string, { x: number; y: number }>, id: string, node: { nodeType: ProcedureAutoLayoutNode["nodeType"]; title: string }): number {
  return positions.get(id)!.y + procedureAutoLayoutNodeDimensions(node).height / 2;
}

/**
 * 어떤 칸의 **중심 x**. 가로도 세로와 같은 자다 — 자동 배치가 정하는 것은 중심
 * 이고 돌려주는 x 는 좌상단이라, 폭이 다른 칸끼리 맞대려면 폭을 되더해야 한다.
 *
 * 🔴 이걸 안 하면 「같은 열에 선다」가 **폭이 다른 칸에서만 조용히 거짓**이 된다 —
 * 실제로 여기서 한 번 걸렸다(유령의 제목이 길어 폭이 233, 둘레는 132였다).
 */
function centerX(positions: Map<string, { x: number; y: number }>, id: string, node: { nodeType: ProcedureAutoLayoutNode["nodeType"]; title: string }): number {
  return positions.get(id)!.x + procedureAutoLayoutNodeDimensions(node).width / 2;
}

/**
 * 실측을 본뜬 초안 — **자리 값이 하나도 없는** 기술작업절차다(개발 DB 의 초안 "7"
 * 이 22개 중 0개였다). n2 밑에 **이미 자식이 둘**이라, 거기에 하나가 더 붙을 때
 * 둘레가 움직이는지를 잴 수 있다 — 2026-11-04 에 사용자가 본 그 움직임이다.
 * 🔵 2026-11-05 오후부터는 **안 움직인다**(새 자식이 맨 오른쪽에만 붙는다). 표본은
 * 그대로 두고 재는 값만 바꿨다 — 아래 「형제가 하나 늘어도 아무도 안 움직인다」.
 */
function sampleDraft(): { nodes: ProcedureAutoLayoutNode[]; edges: ProcedureAutoLayoutEdge[] } {
  return {
    nodes: [node("n1", 0), node("n2", 1), node("n3", 2), node("n4", 3), node("n5", 4)],
    edges: [edge("n1", "n2"), edge("n2", "n3"), edge("n3", "n4"), edge("n2", "n5")],
  };
}

const FIELD_STEP_TITLE = "440V INPUT 전압 재확인 및 기록";

function neighbor(overrides: Partial<FieldStepNeighbor> = {}): FieldStepNeighbor {
  return { draftNodeId: null, fieldStepExecutionNodeId: null, branchType: "DEFAULT", branchLabel: null, ...overrides };
}

function fieldStep(overrides: Partial<FieldAddedStep> = {}): FieldAddedStep {
  return {
    executionNodeId: "exec-1",
    nodeCode: "field-exec-1",
    title: FIELD_STEP_TITLE,
    instructions: null,
    nodeType: "TASK",
    userPositionX: null,
    userPositionY: null,
    adoptedNodeId: null,
    incoming: [neighbor({ draftNodeId: "n2" })],
    outgoing: [],
    intakeNumber: null,
    sourceTemplateVersion: 1,
    addedAt: "2026-11-01T00:00:00.000Z",
    addedByName: null,
    ...overrides,
  };
}

/** 채택이 만들 노드의 id. 🔵 유령 id 와 **일부러 다르게** 둔다 — 실제로도 새 UUID 가 나온다. */
const ADOPTED_NODE_ID = "adopted-node-uuid";

/**
 * 채택(adoptFieldAddedStep)이 이 초안에 **무엇을 더하는지**를 그대로 흉내 낸다.
 * 뮤테이션 본문과 맞대어 적는다:
 *
 *  - sort_order = 이 초안의 최댓값 + 1 (`(maxSortRow?.sortOrder ?? -1) + 1`)
 *  - 현장에서 끌어다 놓은 자리가 **둘 다** 있으면 position_x/y 와 user_position_x/y
 *    에 그 값을 그대로, 없으면 position_x=0 · position_y=맨 아래+150 ·
 *    user_position 은 null
 *  - 선은 이을 수 있는 것만, **맨 뒤에** 붙는다(새로 INSERT 한 줄이라 조회가 끝에
 *    돌려준다 — 선의 차례가 한 부모 밑 형제들의 좌우 차례를 정하므로 중요하다)
 *  - 기존 노드·간선에는 UPDATE 가 **한 줄도 없다**(그래서 아래에서 손대지 않는다)
 */
function adoptIntoDraft(
  draft: { nodes: ProcedureAutoLayoutNode[]; edges: ProcedureAutoLayoutEdge[] },
  step: FieldAddedStep
): { nodes: ProcedureAutoLayoutNode[]; edges: ProcedureAutoLayoutEdge[] } {
  const maxSortOrder = draft.nodes.reduce((max, n) => (n.sortOrder > max ? n.sortOrder : max), -1);
  const maxPositionY = draft.nodes.reduce((max, n) => (n.positionY > max ? n.positionY : max), -Infinity);
  const hasUserPosition = step.userPositionX !== null && step.userPositionY !== null;

  const adopted: ProcedureAutoLayoutNode = {
    id: ADOPTED_NODE_ID,
    nodeType: step.nodeType,
    title: step.title,
    sortOrder: maxSortOrder + 1,
    positionX: hasUserPosition ? step.userPositionX! : 0,
    positionY: hasUserPosition ? step.userPositionY! : (draft.nodes.length > 0 ? maxPositionY + 150 : 0),
    userPositionX: hasUserPosition ? step.userPositionX : null,
    userPositionY: hasUserPosition ? step.userPositionY : null,
  };

  const draftNodeIds = new Set(draft.nodes.map((n) => n.id));
  const createdEdges: ProcedureAutoLayoutEdge[] = [];
  // 🔴 갈래(branch_type)는 실행 쪽 선의 값을 **그대로** 베껴 적는다
  //    (`branchType: executionEdge.branchType` — 뮤테이션의 선 INSERT). 유령도
  //    같은 값을 들고 다니므로(buildFieldStepGhostGraph), 여기서 아무 값이나
  //    적으면 「켠 그림 = 채택 뒤 그림」 비교가 거짓으로 깨지거나 거짓으로 통과한다.
  for (const n of step.incoming) if (n.draftNodeId && draftNodeIds.has(n.draftNodeId)) createdEdges.push(edge(n.draftNodeId, ADOPTED_NODE_ID, n.branchType));
  for (const n of step.outgoing) if (n.draftNodeId && draftNodeIds.has(n.draftNodeId)) createdEdges.push(edge(ADOPTED_NODE_ID, n.draftNodeId, n.branchType));

  return { nodes: [...draft.nodes, adopted], edges: [...draft.edges, ...createdEdges] };
}

/** 유령을 켠 그림. 편집기가 그리는 길 그대로다 — 유령 그래프를 만들고 그대로 자동 배치에 넘긴다. */
function layoutWithGhost(draft: { nodes: ProcedureAutoLayoutNode[]; edges: ProcedureAutoLayoutEdge[] }, steps: FieldAddedStep[]) {
  const nextSortOrder = draft.nodes.reduce((max, n) => (n.sortOrder > max ? n.sortOrder : max), -1) + 1;
  const ghost = buildFieldStepGhostGraph({
    steps,
    // 🔵 받침 자리의 기준(저장된 자리). 자동 배치를 켠 절차에서는 안 쓰이지만,
    //    **일부러 엉뚱한 값**을 넣어 둔다 — 이 값이 결과에 새면 아래에서 갈린다.
    anchorPositions: new Map(draft.nodes.map((n) => [n.id, { x: -5000, y: -5000 }])),
    nextSortOrder,
  });
  return {
    ghost,
    positions: computeProcedureAutoLayout({
      nodes: draft.nodes,
      edges: draft.edges,
      ghostNodes: ghost.nodes.map(toAutoLayoutGhostNode),
      ghostEdges: ghost.edges,
    }),
  };
}

/** 유령 칸의 자리를 **채택된 노드의 자리와 맞대 보려고** 열쇠 이름만 바꾼다(값은 안 건드린다). */
function renameKey(map: Map<string, { x: number; y: number }>, from: string, to: string): Map<string, { x: number; y: number }> {
  const out = new Map(map);
  const value = out.get(from);
  assert.ok(value, `열쇠 ${from} 가 지도에 없다 — 맞대어 볼 것이 없으면 아래 비교가 공짜로 통과한다`);
  out.delete(from);
  out.set(to, value);
  return out;
}

describe("A 안 — ① 먼저 표본 확인", () => {
  test("🔵 자동 배치가 **실제로 자리를 내놓는다** · 눈금은 전에 인라인으로 적혀 있던 값 그대로다", () => {
    const draft = sampleDraft();
    const positions = computeProcedureAutoLayout(draft);
    assert.equal(positions.size, 5, "지도가 비면 아래 「같다」 단언이 전부 공짜로 통과한다");
    // 🔴 2026-11-05 오후에 **빈자리 둘이 더해졌다.** 전에는 이 줄이
    //    `{ horizontal: 280, vertical: 150 }` 이었다. 눈금 둘은 한 글자도 안
    //    바뀌었고, 더해진 148 · 98 은 **가장 흔한 노드(132×52)가 그 눈금에서
    //    이미 누리던 빈자리**다(280−132 · 150−52). 그래서 흔한 크기끼리는 값이
    //    전과 똑같고, 넓은 노드가 낄 때만 그만큼 벌어진다 — 근거는
    //    PROCEDURE_AUTO_LAYOUT_SPACING 의 주석에.
    assert.deepEqual({ ...SPACING }, { horizontal: 280, vertical: 150, horizontalGap: 148, verticalGap: 98 }, "눈금이 바뀌면 옮기면서 셈이 바뀐 것이다");
    assert.equal(SPACING.horizontal - SPACING.horizontalGap, 132, "가로 빈자리는 **가장 좁은 노드 폭**을 눈금에서 뺀 값이다");
    assert.equal(SPACING.vertical - SPACING.verticalGap, 52, "세로 빈자리는 **가장 낮은 노드 높이**를 눈금에서 뺀 값이다");
    // 🔴 재는 것은 **중심** y 다. 2026-11-05 오전 전에는 여기에 좌상단 y 가
    //    그대로 적혀 있었다(윗변 기준) — 높이가 다른 노드가 섞이면 그 셈은
    //    중심을 어긋나게 한다.
    assert.equal(centerY(positions, "n1", node("n1", 0)), 0);
    assert.equal(centerY(positions, "n2", node("n2", 1)), SPACING.vertical);
    // 🔴 2026-11-05 저녁 — 전에는 중심 y 가 곧 「깊이 × 눈금」이었다(n4 는 깊이
    //    3 이라 450). 세로를 깊이가 아니라 **앞에 놓인 것들이 쓴 높이**로 정하면서
    //    달라졌다: n2 의 가지 n5 가 한 줄(300)을 쓰고, 줄기 n3 가 그 아래(450),
    //    n4 는 다시 그 아래(600)다. 「가지가 낀 만큼 주 흐름이 내려간다」가 이 값이다.
    assert.equal(centerY(positions, "n5", node("n5", 4)), 300, "가지가 먼저 한 줄");
    assert.equal(centerY(positions, "n3", node("n3", 2)), 450, "줄기는 그 가지 아래");
    assert.equal(centerY(positions, "n4", node("n4", 3)), 600);
    // 🔵 좌상단 y 는 중심에서 높이의 절반만큼 위다 — 깊이 0 이 음수가 되는 것이 정상이다.
    assert.ok(positions.get("n1")!.y < 0, "깊이 0 의 좌상단 y 는 -높이/2 다");
  });

  test("🔵 노드 폭은 **제목마다 다르다** — 폭이 상수면 「같은 자로 잰다」가 아무것도 안 지킨다", () => {
    const short = procedureAutoLayoutNodeWidth({ nodeType: "TASK", title: "가" });
    const long = procedureAutoLayoutNodeWidth({ nodeType: "TASK", title: FIELD_STEP_TITLE });
    assert.ok(short > 0 && long > 0);
    assert.notEqual(short, long, "폭이 가운데 맞춤에 걸려 있어, 유령과 채택 노드가 같은 폭으로 재어져야 한다");
  });

  /**
   * 🔴 2026-11-05 오후 — 이 시험은 전에 「유령을 넣으면 **둘레가 정말 움직인다**」
   * 를 재고 있었다(`moved.length > 0`). 그 단언의 목적은 아래 「켠 그림 = 채택 뒤
   * 그림」이 **공짜로 통과하지 않는다**는 것을 보이는 데 있었고, 근거는 당시의
   * 부채꼴 셈(자식이 둘에서 셋이 되면 기존 둘이 140px 씩 밀린다)이었다.
   *
   * 그 셈이 바뀌었다 — 이제 새 자식은 **맨 오른쪽에만** 붙고 기존 형제는 한
   * 픽셀도 안 움직인다(layout.ts 의 「줄기 하나」 절). 그래서 단언을 약하게 만든
   * 것이 아니라 **재는 대상을 바꿨다**: 「움직인다」 대신 「유령이 **제 열에
   * 선다**」를 잰다. 지도가 비었거나 유령이 무시됐으면 이쪽이 먼저 깨진다.
   *
   * 🔵 「공짜로 통과하지 않는다」의 진짜 근거는 이 파일 맨 아래의 **일부러 깨뜨려
   * 보는 묶음**이다 — sort_order · 못 박기 · 유령 선을 틀리게 주면 비교가 실제로
   * 깨진다는 것을 값으로 보인다.
   */
  test("🔴 유령은 **자동 배치가 정한 제 열**에 선다 — 가로로는 둘레가 안 움직인다", () => {
    const draft = sampleDraft();
    const before = computeProcedureAutoLayout(draft);
    const { positions: after } = layoutWithGhost(draft, [fieldStep()]);
    const ghostId = fieldStepGhostNodeId("exec-1");

    assert.equal(before.size, 5);
    assert.equal(after.size, 6, "유령이 지도에 안 들어갔으면 아래가 전부 뜻을 잃는다");

    // 🔵 유령이 받은 x 는 **받침 앵커(-5000)가 아니다** — 자동 배치가 센 값이다.
    assert.notEqual(after.get(ghostId)!.x, -5000, "앵커 값이 새어 나오면 유령만 딴 좌표계에 서 있는 것이다");
    // 🔴 n2 밑 셋째 자식이라 **형제들의 오른쪽 끝**에 선다. 「두 칸」이라고 적을 수
    //    없다 — 한 칸의 크기가 그 쌍의 폭으로 정해지기 때문이다(2026-11-05 오후).
    //    유령은 폭이 233 이라 n5(132)와의 거리가 눈금 280 이 아니라 330.5 다.
    //    그래서 재는 것은 **모서리 사이에 남는 빈자리**다 — 그 값이 곧 안 포개짐이다.
    const ghostShape = { nodeType: fieldStep().nodeType, title: FIELD_STEP_TITLE };
    const gap = (leftId: string, left: { nodeType: ProcedureAutoLayoutNode["nodeType"]; title: string }, rightId: string) =>
      after.get(rightId)!.x - (after.get(leftId)!.x + procedureAutoLayoutNodeDimensions(left).width);
    assert.equal(gap("n3", node("n3", 2), "n5"), SPACING.horizontalGap, "n3 ↔ n5 사이 빈자리");
    assert.equal(gap("n5", node("n5", 4), ghostId), SPACING.horizontalGap, "n5 ↔ 유령 사이 빈자리 — 유령이 넓어도 **포개지지 않는다**");
    assert.equal(centerX(after, ghostId, ghostShape), 610.5, "그 결과 유령의 중심 열. 눈금의 배수(560)가 아니다");
    assert.ok(
      centerX(after, "n3", node("n3", 2)) < centerX(after, "n5", node("n5", 4)) && centerX(after, "n5", node("n5", 4)) < centerX(after, ghostId, ghostShape),
      "왼쪽부터 n3 · n5 · 유령 차례여야 한다"
    );

    /**
     * 🔴 2026-11-05 저녁 — 전에는 여기가 「둘레가 **아무도** 안 움직인다」였다.
     * 세로를 「앞에 놓인 것들이 쓴 높이」로 바꾸면서 **반만 참**이 됐다:
     *  - **가로**는 그대로다(새 칸은 맨 오른쪽에만 붙는다).
     *  - **세로**는 유령이 한 줄을 차지하므로 그 아래 줄기(n3)와 그 자식(n4)이
     *    한 줄씩 내려간다. 그것이 이번 변경의 요점 자체라 숨길 수 없다.
     * 🔵 「켠 그림 = 채택 뒤 그림」이라는 A 안의 약속은 **그대로 지켜진다** —
     * 양쪽이 같은 함수로 세어지므로 같은 만큼 움직인다(위 묶음이 값으로 잰다).
     */
    for (const n of draft.nodes) assert.equal(after.get(n.id)!.x, before.get(n.id)!.x, `${n.id} 의 가로가 유령 때문에 움직이면 안 된다`);
    for (const id of ["n1", "n2", "n5"]) assert.equal(after.get(id)!.y, before.get(id)!.y, `${id} 은 유령보다 위/옆이라 세로도 안 움직인다`);
    for (const id of ["n3", "n4"]) {
      assert.equal(after.get(id)!.y - before.get(id)!.y, SPACING.vertical, `${id} 은 유령이 쓴 한 줄만큼 내려간다`);
    }
  });
});

describe("A 안 — 🟢 유령을 안 넘기면 **값이 전과 똑같다** (화면 셋의 근거)", () => {
  test("🔴 null · 빈 배열 · 아예 안 넘김 — 셋이 **같은 값**이다", () => {
    const draft = sampleDraft();
    const omitted = computeProcedureAutoLayout({ nodes: draft.nodes, edges: draft.edges });
    const nulls = computeProcedureAutoLayout({ nodes: draft.nodes, edges: draft.edges, ghostNodes: null, ghostEdges: null });
    const empties = computeProcedureAutoLayout({ nodes: draft.nodes, edges: draft.edges, ghostNodes: [], ghostEdges: [] });
    assert.equal(omitted.size, 5, "표본 확인");
    assert.deepEqual(nulls, omitted);
    assert.deepEqual(empties, omitted);
    // 그리고 그 값이 유령을 켠 쪽과는 **다르다**(위 셋이 늘 같은 것이 아니라는 증거).
    // 🔴 2026-11-05 오후 — 전에는 여기서 「유령을 켜면 **둘레의 값까지** 달라진다」
    //    를 쟀다(id 가 "n" 으로 시작하는 칸만 걸러 맞댔다). 줄기/가지 셈으로 바뀐
    //    뒤로 둘레는 더는 안 움직이므로 그 단언은 사실이 아니다. 지금 재는 것은
    //    「지도 자체가 다르다」 — 유령이 **칸 하나로 실제로 들어간다**는 것이다.
    const { positions: withGhost } = layoutWithGhost(draft, [fieldStep()]);
    assert.notDeepEqual(withGhost, omitted);
    assert.equal(withGhost.size, omitted.size + 1, "늘어난 칸이 유령이다");
    assert.ok(withGhost.has(fieldStepGhostNodeId("exec-1")));
  });
});

describe("A 안 — 🔴 유령을 켠 그림과 채택 뒤 그림이 **노드 전부에서 같은 값**이다", () => {
  test("🔴 자리를 안 고른 현장 단계 — 둘레도 유령 자신도 같은 자리에 선다", () => {
    const draft = sampleDraft();
    const step = fieldStep();
    const { ghost, positions: withGhost } = layoutWithGhost(draft, [step]);
    const afterAdopt = computeProcedureAutoLayout(adoptIntoDraft(draft, step));

    assert.equal(ghost.nodes.length, 1, "표본 확인 — 유령이 없으면 아래가 공짜로 통과한다");
    assert.equal(withGhost.size, 6, "초안 5 + 유령 1");
    assert.equal(afterAdopt.size, 6, "초안 5 + 채택된 노드 1");

    const ghostId = fieldStepGhostNodeId(step.executionNodeId);
    assert.deepEqual(renameKey(withGhost, ghostId, ADOPTED_NODE_ID), afterAdopt, "켠 그림과 넣은 뒤 그림이 한 칸이라도 다르면 미리 보기가 거짓말을 한다");

    // 🔵 지도끼리 비교는 「전부 같다」를 한 줄로 말하지만, 어디가 같은지는 안
    //    보여 준다. 사람이 읽을 수 있게 **칸마다** 다시 적는다.
    for (const n of draft.nodes) {
      assert.deepEqual(withGhost.get(n.id), afterAdopt.get(n.id), `${n.id} 이 유령을 켤 때와 넣은 뒤에 다른 자리에 선다`);
    }
    assert.deepEqual(withGhost.get(ghostId), afterAdopt.get(ADOPTED_NODE_ID), "유령 자신이 채택된 노드와 다른 자리에 선다");
  });

  test("🔴 들어오는 선·나가는 선이 **둘 다** 있는 현장 단계에서도 같다 — 깊이가 선으로 정해진다", () => {
    const draft = sampleDraft();
    const step = fieldStep({ incoming: [neighbor({ draftNodeId: "n2" })], outgoing: [neighbor({ draftNodeId: "n4" })] });
    const { ghost, positions: withGhost } = layoutWithGhost(draft, [step]);
    const afterAdopt = computeProcedureAutoLayout(adoptIntoDraft(draft, step));

    assert.equal(ghost.edges.length, 2, "표본 확인 — 선이 하나도 없으면 「선이 깊이를 정한다」를 안 재고 있다");
    assert.deepEqual(renameKey(withGhost, fieldStepGhostNodeId(step.executionNodeId), ADOPTED_NODE_ID), afterAdopt);
  });

  test("🔴 **현장에서 끌어다 놓은 자리**가 있는 단계에서도 같다 — 그 칸은 양쪽 다 못 박힌다", () => {
    const draft = sampleDraft();
    const step = fieldStep({ userPositionX: 777, userPositionY: 333 });
    const { ghost, positions: withGhost } = layoutWithGhost(draft, [step]);
    const adoptedDraft = adoptIntoDraft(draft, step);
    const afterAdopt = computeProcedureAutoLayout(adoptedDraft);

    // 표본 확인 — 양쪽이 **정말로** 사람이 정한 자리를 들고 있나.
    assert.equal(ghost.nodes[0].hasUserPosition, true);
    assert.equal(ghost.nodes[0].x, 777);
    assert.equal(ghost.nodes[0].y, 333);
    const adoptedNode = adoptedDraft.nodes.find((n) => n.id === ADOPTED_NODE_ID)!;
    assert.deepEqual({ x: adoptedNode.userPositionX, y: adoptedNode.userPositionY }, { x: 777, y: 333 });
    // 🔵 그림은 이 칸을 자동 배치가 아니라 **사람이 정한 자리**에 그린다(양쪽 다 —
    //    유령은 hasUserPosition 으로, 채택된 노드는 resolveBaselinePosition 으로).
    //    그래도 **자동 배치 안에서는 못 박힌 채로 함께 세어져야** 이웃이 같은 만큼
    //    밀린다. 아래가 그것을 잰다.
    assert.deepEqual(renameKey(withGhost, fieldStepGhostNodeId(step.executionNodeId), ADOPTED_NODE_ID), afterAdopt);
    assert.equal(withGhost.get(fieldStepGhostNodeId(step.executionNodeId))!.x, 777, "못 박힌 칸의 x 는 사람이 정한 그 값이어야 한다");
  });

  test("🔴 현장 단계가 **둘**이어도 같다 — 하나씩 넣어도 마지막 그림이 켠 그림과 같다", () => {
    const draft = sampleDraft();
    const first = fieldStep({ executionNodeId: "exec-1", addedAt: "2026-11-01T00:00:00.000Z", incoming: [neighbor({ draftNodeId: "n2" })] });
    const second = fieldStep({ executionNodeId: "exec-2", title: "절연 저항 재측정", addedAt: "2026-11-01T00:00:01.000Z", incoming: [neighbor({ draftNodeId: "n3" })] });
    const { ghost, positions: withGhost } = layoutWithGhost(draft, [first, second]);
    assert.equal(ghost.nodes.length, 2, "표본 확인");

    // 차례대로 넣는다 — 둘째 채택은 첫째가 들어간 초안 위에서 돈다(sort_order 가 또 +1).
    const afterFirst = adoptIntoDraft(draft, first);
    const afterFirstRenamed = {
      nodes: afterFirst.nodes.map((n) => (n.id === ADOPTED_NODE_ID ? { ...n, id: "adopted-1" } : n)),
      edges: afterFirst.edges.map((e) => ({
        ...e,
        fromNodeId: e.fromNodeId === ADOPTED_NODE_ID ? "adopted-1" : e.fromNodeId,
        toNodeId: e.toNodeId === ADOPTED_NODE_ID ? "adopted-1" : e.toNodeId,
      })),
    };
    const afterBoth = adoptIntoDraft(afterFirstRenamed, second);
    const positions = computeProcedureAutoLayout(afterBoth);

    const renamed = renameKey(renameKey(withGhost, fieldStepGhostNodeId("exec-1"), "adopted-1"), fieldStepGhostNodeId("exec-2"), ADOPTED_NODE_ID);
    assert.deepEqual(renamed, positions);
  });
});

describe("A 안 — 🔴 유령을 켜면 **둘레가 얼마나 움직이는가** (사람에게 미리 알릴 값)", () => {
  /**
   * 🔴 **답이 2026-11-05 오후에 「한 픽셀도」로 바뀌었다.**
   *
   * 전에는 이 시험이 그 반대를 값으로 적고 있었다 — n2 밑의 형제가 둘 → 셋이
   * 되면서 부채꼴이 대칭으로 넓어지고(둘일 때 −140·+140 → 셋이면 −280·0·+280),
   * 기존 형제 n3 · n5 와 그 아래 n4 가 **전부 왼쪽으로 140px** 밀렸다. 2026-11-04
   * 에 사용자가 실제 초안에서 잰 값이 그 모양이었다(채택하는 순간 22개가 전부
   * 음수로 — 열넷이 −140, 여덟이 −110).
   *
   * 지금은 자식이 몇이든 **하나가 부모의 열에 그대로 남고** 나머지는 오른쪽으로만
   * 한 칸씩 간다(layout.ts 의 「줄기 하나」 절). 새 자식은 언제나 **맨 오른쪽**에
   * 붙으므로 앞선 형제의 차례(= 열)가 안 바뀐다. 그래서 움직임이 0 이다.
   *
   * 🔵 시험을 약하게 만든 것이 아니다 — 「−140 이다」를 「0 이다」로 바꾼 것이고,
   * 둘 다 **정확한 값 단언**이다. 부채꼴로 되돌아가면 이 시험이 바로 깨진다.
   *
   * 🔴 **그리고 2026-11-05 저녁에 세로가 갈라졌다.** 세로를 「앞에 놓인 것들이 쓴
   * 높이」로 바꾸면서, 새로 낀 가지가 **한 줄을 차지하므로** 그 아래 줄기와 자손이
   * 한 줄씩 내려간다. 가로는 여전히 「한 픽셀도」다. 사람에게 미리 알릴 값은 이제
   * 「**옆으로는 안 밀리고, 아래로 한 줄 내려간다**」이다.
   */
  test("🔴 형제가 하나 늘어도 **옆으로는 아무도 안 밀린다** — 아래로만 한 줄 내려간다", () => {
    const draft = sampleDraft();
    const before = computeProcedureAutoLayout(draft);
    const { positions: after } = layoutWithGhost(draft, [fieldStep()]);

    const delta = (id: string) => ({ dx: after.get(id)!.x - before.get(id)!.x, dy: after.get(id)!.y - before.get(id)!.y });
    for (const n of draft.nodes) assert.equal(delta(n.id).dx, 0, `${n.id} 이 옆으로 밀렸다 — 부채꼴 셈으로 되돌아간 것이다`);
    assert.deepEqual(
      draft.nodes.map((n) => delta(n.id).dy),
      [0, 0, SPACING.vertical, SPACING.vertical, 0],
      "n1 · n2 · n5 는 그대로, 유령 **아래**에 놓이는 n3 · n4 만 한 줄 내려간다"
    );

    // 🔵 표본 확인 — 「안 움직인다」는 **아무 일도 안 일어났을 때도** 통과한다.
    //    그래서 유령이 정말 들어갔고, 그 자리가 **형제들의 오른쪽**임을 함께 잰다.
    //    🔴 열은 **중심**으로 센다(폭이 칸마다 다르다 — centerX 주석 참고).
    //    🔴 한 칸의 크기는 **그 쌍의 폭**이 정하므로 눈금의 배수로 적을 수 없다
    //       (2026-11-05 오후). n3 · n5 는 둘 다 폭 132 라 전처럼 280 이고, 폭 233
    //       짜리 유령만 330.5 로 벌어진다.
    const parentColumn = centerX(after, "n2", node("n2", 1));
    assert.deepEqual(
      [
        centerX(after, "n3", node("n3", 2)),
        centerX(after, "n5", node("n5", 4)),
        centerX(after, fieldStepGhostNodeId("exec-1"), { nodeType: fieldStep().nodeType, title: FIELD_STEP_TITLE }),
      ],
      [parentColumn, parentColumn + 280, parentColumn + 610.5],
      "n2 의 세 자식이 왼쪽부터 — 첫째가 부모의 열이고 유령이 맨 오른쪽이다"
    );
  });
});

describe("A 안 — 🔴 유령이 들고 가는 값이 틀리면 **조용히 다른 자리**가 된다", () => {
  /**
   * 일부러 깨뜨려 보는 묶음이다. 아래 둘은 오류를 하나도 안 내고 자리만 바꾼다 —
   * 그래서 시험이 아니면 영영 안 드러난다.
   */
  test("🔴 뿌리로 서는 유령의 **sort_order** 가 채택이 줄 번호와 다르면 좌우가 갈린다", () => {
    const draft = sampleDraft();
    // 들어오는 선이 없는 현장 단계 = 자동 배치에서 **뿌리**가 된다.
    const step = fieldStep({ incoming: [], outgoing: [] });
    const ghostId = fieldStepGhostNodeId(step.executionNodeId);
    const ghostNode = { id: ghostId, nodeType: step.nodeType, title: step.title, x: 0, hasUserPosition: false };

    const correct = computeProcedureAutoLayout({
      ...draft,
      ghostNodes: [toAutoLayoutGhostNode({ ...ghostNode, sortOrder: 5 })], // 최댓값 4 + 1
      ghostEdges: [],
    });
    const wrong = computeProcedureAutoLayout({
      ...draft,
      // 🔵 **−1** 로 민다(채택은 최댓값+1 을 적는다). 0 을 넣으면 이 표본에서는
      //    n1 과 번호가 같아 차례가 안 바뀐다 — 「틀린 값」을 아무렇게나 고르면
      //    깨뜨려 보기가 조용히 성공한 것처럼 보인다(실제로 여기서 한 번 속았다).
      ghostNodes: [toAutoLayoutGhostNode({ ...ghostNode, sortOrder: -1 })],
      ghostEdges: [],
    });
    const afterAdopt = computeProcedureAutoLayout(adoptIntoDraft(draft, step));

    assert.deepEqual(renameKey(correct, ghostId, ADOPTED_NODE_ID), afterAdopt, "번호가 맞으면 채택 뒤와 같다");
    assert.notDeepEqual(renameKey(wrong, ghostId, ADOPTED_NODE_ID), afterAdopt, "번호가 틀려도 같아 보이면 이 시험은 아무것도 안 재고 있다");
  });

  test("🔴 **사람이 정한 자리**를 안 못 박으면 이웃이 다르게 밀린다", () => {
    const draft = sampleDraft();
    const step = fieldStep({ userPositionX: 777, userPositionY: 333 });
    const ghostId = fieldStepGhostNodeId(step.executionNodeId);
    const base = { id: ghostId, nodeType: step.nodeType, title: step.title, sortOrder: 5, x: 777 };

    const pinned = computeProcedureAutoLayout({
      ...draft,
      ghostNodes: [toAutoLayoutGhostNode({ ...base, hasUserPosition: true })],
      ghostEdges: [edge("n2", ghostId)],
    });
    const unpinned = computeProcedureAutoLayout({
      ...draft,
      ghostNodes: [toAutoLayoutGhostNode({ ...base, hasUserPosition: false })],
      ghostEdges: [edge("n2", ghostId)],
    });
    const afterAdopt = computeProcedureAutoLayout(adoptIntoDraft(draft, step));

    assert.deepEqual(renameKey(pinned, ghostId, ADOPTED_NODE_ID), afterAdopt);
    assert.notDeepEqual(renameKey(unpinned, ghostId, ADOPTED_NODE_ID), afterAdopt, "못 박는지 여부가 결과를 안 바꾸면 위 단언이 뜻을 잃는다");
  });

  test("🔴 유령 **선**을 안 넘기면 유령이 뿌리로 떨어진다 — 깊이가 달라진다", () => {
    const draft = sampleDraft();
    const step = fieldStep();
    const ghostId = fieldStepGhostNodeId(step.executionNodeId);
    const ghostNodes = [toAutoLayoutGhostNode({ id: ghostId, nodeType: step.nodeType, title: step.title, sortOrder: 5, x: 0, hasUserPosition: false })];

    const withEdges = computeProcedureAutoLayout({ ...draft, ghostNodes, ghostEdges: [edge("n2", ghostId)] });
    const withoutEdges = computeProcedureAutoLayout({ ...draft, ghostNodes, ghostEdges: [] });
    // 🔵 자리는 **중심** y 로 읽는다(2026-11-05 오전) — 좌상단 y 에는 높이의 절반이 섞여 있다.
    const ghostShape = { nodeType: step.nodeType, title: step.title };
    /**
     * 🔴 2026-11-05 저녁 — 전에는 이 둘이 「깊이 2(= 300)」와 「깊이 0(= 0)」이었다.
     * 세로가 깊이로 정해지던 때의 값이다. 지금은 **앞에 놓인 것들이 쓴 높이**가
     * 자리를 정하므로 둘 다 달라졌다:
     *  - 선이 있으면 n2 의 **셋째 자식**이라 가지 n5(300) 다음 줄인 450.
     *  - 선이 없으면 **뿌리**가 되는데, 뿌리도 이제 세로로 쌓이므로 0 이 아니라
     *    앞 나무(n1 가지) 전체 아래인 750 이다.
     * 🔵 재려는 것은 그대로다 — 「선이 있고 없고가 **자리를 가른다**」.
     */
    assert.equal(centerY(withEdges, ghostId, ghostShape), 450, "n2 의 셋째 자식 — 가지 n5 다음 줄");
    assert.equal(centerY(withoutEdges, ghostId, ghostShape), 750, "선이 없으면 뿌리라 앞 나무 **아래**에서 시작한다");
    assert.notEqual(centerY(withEdges, ghostId, ghostShape), centerY(withoutEdges, ghostId, ghostShape), "두 값이 같아지면 이 시험은 아무것도 안 재고 있다");
  });
});

/**
 * ============================================================================
 * 🔴 갈래(branch_type)가 **누가 부모의 열을 잇는지**를 정한다 (2026-11-05 오후)
 * ============================================================================
 * 사용자 요구: 「작업절차의 플로우차트를 시인성 좋게 배치를 바꿔줘」. 노드 79개 ·
 * 판단 40~51개짜리 절차가 화면에서 **왼쪽 위에서 오른쪽 아래로 비스듬한 띠**가 되어
 * 흐름을 눈으로 따라갈 수 없었다. 엑셀 원본은 주 흐름이 **왼쪽 한 열**에 고정되고
 * 분기만 오른쪽으로 뻗는다.
 *
 * 셈 자체(줄기 하나가 부모의 열에 남고 나머지는 오른쪽으로)는 graph-editor-core 의
 * computeLayeredGraphLayout 에 있고, layout.test.ts 가 폭을 값으로 잰다(판단 20개
 * 표본: 2940 → 280). 이 파일이 지키는 것은 그 앞단 — **절차 도메인이 갈래를 어떻게
 * 읽어 넘기는가**다. 여기가 틀리면 셈은 멀쩡한데 엉뚱한 자식이 줄기가 된다.
 * ============================================================================
 */
describe("🔴 갈래가 줄기를 정한다", () => {
  test("🔴 갈래마다 「주 흐름의 계속인가」 — 여덟 가지를 **빠짐없이** 적어 둔다", () => {
    const actual = Object.fromEntries(PROCEDURE_BRANCH_TYPE_CODES.map((code) => [code, procedureBranchContinuesMainFlow(code)]));
    assert.deepEqual(actual, {
      DEFAULT: true, // 이름 없는 선 — 그냥 다음 단계다
      NORMAL: true, // 「정상」 — 검사를 통과했으니 절차가 계속된다
      YES: true,
      NG: false, // 조치하러 옆으로 빠진다
      NO: false,
      RETRY: false, // 되돌아가는 선
      LOOP_BACK: false,
      CUSTOM: false, // 사람이 적은 이름표 — 어느 쪽도 「계속」이 아니다
    });
    // 🔵 갈래가 늘면 이 시험이 먼저 깨진다 — 새 갈래를 조용히 「가지」로 두고
    //    넘어가지 않게.
    assert.equal(Object.keys(actual).length, PROCEDURE_BRANCH_TYPE_CODES.length);
  });

  test("🔴 선이 붙는 면을 정하는 기존 규칙과 **어긋나지 않는다** — 다른 것은 CUSTOM 하나뿐이다", () => {
    // decisionBranchSourceHandle: YES/NORMAL/DEFAULT → 오른쪽, NO/NG → 왼쪽,
    // RETRY/LOOP_BACK → 되돌아가는 쪽. 남는 CUSTOM 은 `else` 라 오른쪽으로 간다.
    const disagreeing = PROCEDURE_BRANCH_TYPE_CODES.filter(
      (code) => procedureBranchContinuesMainFlow(code) !== (decisionBranchSourceHandle(code) === "right-out")
    );
    assert.deepEqual(disagreeing, ["CUSTOM"], "CUSTOM 말고 또 갈라지면 두 화면이 서로 다른 쪽으로 뻗는다");
  });

  test("🔴 판단 노드의 **NG 자식만 옆으로** 간다 — 정상은 부모의 열을 그대로 잇는다", () => {
    const nodes = [node("start", 0), node("check", 1, { nodeType: "DECISION" }), node("ng", 2), node("next", 3)];
    // 🔵 **NG 를 먼저** 넘긴다 — 엑셀에서 들여온 선의 차례가 실제로 이렇다.
    //    차례만 보고 고르면 NG 가 줄기가 돼 주 흐름이 옆으로 샌다.
    const edges = [edge("start", "check"), edge("check", "ng", "NG"), edge("check", "next", "NORMAL")];
    const positions = computeProcedureAutoLayout({ nodes, edges });
    assert.equal(positions.size, 4, "표본 확인");

    const column = (id: string) => centerX(positions, id, node(id, 0, id === "check" ? { nodeType: "DECISION" } : {}));
    assert.equal(column("next"), column("check"), "「정상」 쪽이 판단 노드의 열을 그대로 잇는다");
    /**
     * 🔴 2026-11-05 밤 — 전에는 여기가 「오른쪽으로 **눈금 한 칸**(280)」이었다.
     * NG 자식을 **부모와 같은 줄**에 세우게 되면서 두 가지가 바뀌었다:
     *  ① 부모와 나란히 서므로 **부모의 폭까지** 비켜 줘야 한다 — 거리가 눈금이
     *     아니라 `(부모 폭 + 자식 폭)/2 + 빈자리` 다.
     *  ② 세로가 **부모와 같다**(전에는 한 줄 아래였다).
     */
    const widthOf = (id: string) => procedureAutoLayoutNodeDimensions(nodes.find((n) => n.id === id)!).width;
    assert.equal(
      column("ng") - column("check"),
      Math.max(SPACING.horizontal, (widthOf("check") + widthOf("ng")) / 2 + SPACING.horizontalGap),
      "NG 는 부모의 오른쪽 — 거리는 **부모 폭까지 센** 값이다"
    );
    assert.equal(
      centerY(positions, "ng", nodes.find((n) => n.id === "ng")!),
      centerY(positions, "check", nodes.find((n) => n.id === "check")!),
      "🔴 NG 는 부모와 **같은 줄**이다 — 원본 엑셀의 모양(NG 97개 중 87개가 같은 줄)"
    );
    assert.notEqual(
      centerY(positions, "next", nodes.find((n) => n.id === "next")!),
      centerY(positions, "check", nodes.find((n) => n.id === "check")!),
      "정상은 같은 줄이 아니다 — 원본에서도 같은 줄이 0개다"
    );
    assert.equal(column("check"), column("start"), "그리고 판단 노드 자신도 뿌리의 열에 서 있다");
  });

  test("🔴 갈래를 **DEFAULT 로 뭉개면** 주 흐름이 옆으로 샌다 — 일부러 깨뜨려 본다", () => {
    const nodes = [node("start", 0), node("check", 1, { nodeType: "DECISION" }), node("ng", 2), node("next", 3)];
    const correct = computeProcedureAutoLayout({
      nodes,
      edges: [edge("start", "check"), edge("check", "ng", "NG"), edge("check", "next", "NORMAL")],
    });
    // 갈래를 안 읽고 전부 기본으로 넘기면(= 선의 차례만 남으면) 첫 자식인 NG 가 줄기가 된다.
    const flattened = computeProcedureAutoLayout({
      nodes,
      edges: [edge("start", "check"), edge("check", "ng"), edge("check", "next")],
    });
    const column = (p: Map<string, { x: number; y: number }>, id: string) => centerX(p, id, node(id, 0, id === "check" ? { nodeType: "DECISION" } : {}));

    assert.equal(column(flattened, "ng"), column(flattened, "check"), "뭉개면 NG 가 부모의 열을 차지한다");
    assert.equal(column(flattened, "next"), column(flattened, "check") + SPACING.horizontal, "그리고 주 흐름이 옆으로 밀린다");
    assert.notEqual(column(flattened, "next"), column(correct, "next"), "두 길이 같은 값을 내면 이 시험은 갈래를 하나도 안 재고 있다");
  });
});

/**
 * ============================================================================
 * 🔴 **노드가 서로 안 포개진다** (2026-11-05 오후)
 * ============================================================================
 * 사용자 신고: 「노드 가로폭이 길어서 노드끼리 겹쳐서 보이기도 하고, 연결선이
 * 노드에 겹쳐있어서 가시성이 좋지 않아」. 눈금(280 · 150)은 고정인데 노드 크기는
 * 제목이 정하기 때문이다 — 같은 날 제목을 **원본 엑셀 전문**(줄바꿈 포함)으로
 * 바꾸면서 폭이 넓어져 드러났다.
 *
 * 셈 자체는 graph-editor-core 에 있고 layout.test.ts 가 값으로 잰다. 여기서는
 * **실제 노드 크기 함수**(procedureAutoLayoutNodeDimensions)로 재어, 도메인이
 * 넘기는 빈자리 값이 실제로 충분한지를 본다.
 *
 * 🔵 아래 제목은 **지어낸 것**이다. 실제 고객사·절차 글자가 아니다 — 길이 분포만
 * 비슷하게 맞췄다(폭 132 ~ 527).
 * ============================================================================
 */
describe("🔴 노드가 서로 안 포개진다", () => {
  const LONG_TITLES = [
    "제어 보드 전원부 커넥터 체결 상태와 배선 피복 손상 여부를 눈으로 확인한다",
    "입력 전압(3상)을 측정하여 기록하고 기준 범위 안인지 판정한다",
    "절연 저항 측정값이 기준치 이상인가",
    "NG 항목을 기록하고 담당자에게 보고한 뒤 재작업을 지시한다",
  ];

  /** 판단이 연달아 서고 각자 NG 가지를 하나 내는 표본 — 제목이 전부 길다. */
  function longTitledChain(count: number) {
    const nodes: ProcedureAutoLayoutNode[] = [node("start", 0, { title: LONG_TITLES[0] })];
    const edges: ProcedureAutoLayoutEdge[] = [];
    let order = 1;
    for (let i = 1; i <= count; i++) {
      nodes.push(node(`d${i}`, order++, { title: LONG_TITLES[i % LONG_TITLES.length], nodeType: "DECISION" }));
      edges.push(edge(i === 1 ? "start" : `d${i - 1}`, `d${i}`, i === 1 ? "DEFAULT" : "NORMAL"));
      nodes.push(node(`n${i}`, order++, { title: LONG_TITLES[(i + 2) % LONG_TITLES.length] }));
      edges.push(edge(`d${i}`, `n${i}`, "NG"));
    }
    return { nodes, edges };
  }

  function boxesOf(positions: Map<string, { x: number; y: number }>, nodes: ProcedureAutoLayoutNode[]) {
    return nodes.map((n) => {
      const { width, height } = procedureAutoLayoutNodeDimensions(n);
      const p = positions.get(n.id)!;
      return { id: n.id, left: p.x, right: p.x + width, top: p.y, bottom: p.y + height };
    });
  }

  test("🔵 먼저 표본 확인 — 이 제목들이 **정말 넓다**(폭이 눈금을 넘는다)", () => {
    const widths = LONG_TITLES.map((title) => procedureAutoLayoutNodeWidth({ nodeType: "TASK", title }));
    assert.ok(Math.max(...widths) > SPACING.horizontal, `가장 넓은 제목이 ${Math.max(...widths)} — 눈금 ${SPACING.horizontal} 보다 좁으면 겹침을 안 재고 있다`);
    assert.ok(Math.min(...widths) >= 132, "가장 좁은 칸은 MIN_WIDTH 에 걸린다");
  });

  test("🔴 판단 20개 · 제목이 전부 긴 표본에서 **포개진 쌍이 0** 이다", () => {
    const { nodes, edges } = longTitledChain(20);
    const positions = computeProcedureAutoLayout({ nodes, edges });
    assert.equal(positions.size, nodes.length, "표본 확인 — 자리를 못 받은 칸이 있으면 아래가 거짓이다");

    const boxes = boxesOf(positions, nodes);
    const overlapping: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)) {
          overlapping.push(`${a.id} ↔ ${b.id}`);
        }
      }
    }
    // 🔴 고치기 전 같은 표본의 값: **포개진 쌍 19개**, 가장 깊이 포갠 곳 268px.
    assert.deepEqual(overlapping, [], "포개진 쌍이 남아 있다");
  });

  test("🔴 가지를 **둘씩** 내는 판단에서도 안 포개진다 — 한 줄에 셋이 선다", () => {
    const nodes: ProcedureAutoLayoutNode[] = [node("start", 0, { title: LONG_TITLES[0] })];
    const edges: ProcedureAutoLayoutEdge[] = [];
    let order = 1;
    for (let i = 1; i <= 10; i++) {
      nodes.push(node(`d${i}`, order++, { title: LONG_TITLES[0], nodeType: "DECISION" }));
      edges.push(edge(i === 1 ? "start" : `d${i - 1}`, `d${i}`, i === 1 ? "DEFAULT" : "NORMAL"));
      nodes.push(node(`n${i}`, order++, { title: LONG_TITLES[2] }));
      edges.push(edge(`d${i}`, `n${i}`, "NG"));
      nodes.push(node(`r${i}`, order++, { title: LONG_TITLES[0] }));
      edges.push(edge(`d${i}`, `r${i}`, "CUSTOM"));
    }
    const positions = computeProcedureAutoLayout({ nodes, edges });
    const boxes = boxesOf(positions, nodes);
    let count = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)) count += 1;
      }
    }
    // 🔴 고치기 전 같은 표본의 값: **포개진 쌍 28개**.
    assert.equal(count, 0);
    assert.equal(positions.size, 31, "표본 확인");
  });

  test("🔴 **줄기는 여전히 한 열**이고, 세로도 안 포갠다 — 간격을 벌려도 두 규칙이 그대로다", () => {
    const { nodes, edges } = longTitledChain(20);
    const positions = computeProcedureAutoLayout({ nodes, edges });

    const trunk = ["start", ...Array.from({ length: 20 }, (_, i) => `d${i + 1}`)];
    const columns = new Set(trunk.map((id) => centerX(positions, id, nodes.find((n) => n.id === id)!)));
    assert.equal(columns.size, 1, "줄기 21칸이 서로 다른 열을 쓰면 간격 고침이 줄기 규칙을 깬 것이다");

    // 세로 — 줄과 줄 사이가 **그 두 줄의 가장 높은 노드**를 담고도 남는가.
    const boxes = boxesOf(positions, nodes);
    const rows = new Map<number, { top: number; bottom: number }>();
    for (const b of boxes) {
      const center = (b.top + b.bottom) / 2;
      const row = rows.get(center) ?? { top: b.top, bottom: b.bottom };
      rows.set(center, { top: Math.min(row.top, b.top), bottom: Math.max(row.bottom, b.bottom) });
    }
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    assert.ok(ordered.length > 2, "표본 확인 — 줄이 둘뿐이면 줄 사이를 안 재고 있다");
    for (let i = 1; i < ordered.length; i++) {
      assert.ok(ordered[i].top >= ordered[i - 1].bottom, `${i - 1} 번째 줄과 ${i} 번째 줄이 세로로 포갠다`);
    }
  });
});

/**
 * 🔴 위 표본들은 **뿌리가 하나**라, 자리를 놓는 자리에서 이미 간격이 맞아
 * **충돌 풀기(resolveCollisions)가 한 번도 안 불린다.** 그러면 거기에 눈금이
 * 그대로 남아 있어도 이 파일이 조용히 통과한다 — 실제로 깨뜨려 보기에서 그랬다.
 * 그래서 **떨어진 둘째 줄기**를 더해 두 줄기의 가지가 같은 줄에서 부딪히게 만든다.
 * 들여온 절차에는 들어오는 선이 없는 칸(뿌리)이 실제로 여럿 있다.
 *
 * 🔵 가지 하나에 **네 줄짜리 제목**(높이 97)을 줘서 세로도 함께 잰다 — 줄 높이를
 * 그 줄의 **가장 높은 노드**로 안 재면 여기서 아래 줄을 뚫는다.
 */
describe("🔴 떨어진 줄기가 있어도 안 포갠다 — 충돌 풀기까지 재는 표본", () => {
  const WIDE = "제어 보드 전원부 커넥터 체결 상태와 배선 피복 손상 여부를 눈으로 확인한다";
  const TALL = "NG 항목 기록\n담당자 보고\n재작업 지시\n결과 확인";

  function twoRootSample() {
    const nodes: ProcedureAutoLayoutNode[] = [];
    const edges: ProcedureAutoLayoutEdge[] = [];
    let order = 0;
    for (const prefix of ["a", "b"]) {
      nodes.push(node(`${prefix}0`, order++, { title: WIDE }));
      for (let i = 1; i <= 8; i++) {
        nodes.push(node(`${prefix}${i}`, order++, { title: WIDE, nodeType: "DECISION" }));
        edges.push(edge(`${prefix}${i - 1}`, `${prefix}${i}`, "NORMAL"));
        nodes.push(node(`${prefix}ng${i}`, order++, { title: i % 2 === 0 ? TALL : WIDE }));
        edges.push(edge(`${prefix}${i}`, `${prefix}ng${i}`, "NG"));
      }
    }
    return { nodes, edges };
  }

  test("🔴 뿌리 둘 · 넓은 노드 · 네 줄짜리 제목이 섞여도 **포개진 쌍이 0** 이다", () => {
    const { nodes, edges } = twoRootSample();
    const positions = computeProcedureAutoLayout({ nodes, edges });
    assert.equal(positions.size, nodes.length, "표본 확인");

    const boxes = nodes.map((n) => {
      const { width, height } = procedureAutoLayoutNodeDimensions(n);
      const p = positions.get(n.id)!;
      return { id: n.id, left: p.x, right: p.x + width, top: p.y, bottom: p.y + height };
    });
    // 🔵 표본 확인 — 높이가 **정말 섞여 있나**. 전부 같으면 세로를 안 재고 있다.
    assert.equal(new Set(boxes.map((b) => b.bottom - b.top)).size, 2, "높이가 한 가지뿐이면 세로 단언이 공짜로 통과한다");

    const overlapping: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)) overlapping.push(`${a.id} ↔ ${b.id}`);
      }
    }
    assert.deepEqual(overlapping, []);
  });

  /**
   * 🔴 **첫 줄기는 한 열. 둘째 뿌리의 줄기는 두 열을 오간다** — 고치지 않고 값으로
   * 적어 두는 동작이다(2026-11-05 밤 실측).
   *
   * 메인줄기는 **뿌리마다 하나씩** 생기고, 서로 다른 뿌리의 줄기는 **서로를 민다**
   * (같은 뿌리의 줄기끼리나 가지에게는 안 밀린다 — layout.ts 의 충돌 풀기 주석).
   * 그래서 첫 뿌리의 줄기 칸이 같은 깊이에 있는 깊이에서는 둘째 줄기가 675 에서
   * 807 로 밀리고, 없는 깊이에서는 제 열 675 로 돌아온다.
   *
   * 🔵 **일부러 이렇게 뒀다.** 뿌리끼리 안 밀게 하면 둘째 줄기도 한 열이 되지만,
   * 그러면 「이웃한 두 칸은 크기만큼 벌어진다」가 **뿌리 사이에서만 조용히 깨진다**
   * (layout.test.ts 의 「뿌리끼리도 크기만큼 벌어진다」가 그것을 지킨다).
   * 🔵 **실제 절차에는 영향이 없다** — 오늘 들여온 열한 절차는 **전부 뿌리가 하나**다
   * (메인이 DB 로 확인). 둘째 뿌리는 대개 선이 안 이어진 낱개 칸이라 줄기가 없다.
   * 🔵 그리고 어느 쪽이든 **안 포갠다** — 뿌리 나무가 세로로 쌓여 줄이 안 겹친다.
   */
  test("🔵 **남는 것** — 첫 줄기는 한 열, 둘째 뿌리의 줄기는 두 열을 오간다", () => {
    const { nodes, edges } = twoRootSample();
    const positions = computeProcedureAutoLayout({ nodes, edges });
    const column = (id: string) => centerX(positions, id, nodes.find((n) => n.id === id)!);

    const a = Array.from({ length: 9 }, (_, i) => column(`a${i}`));
    assert.deepEqual(new Set(a), new Set([0]), "첫 줄기는 아홉 칸 전부 한 열이다");

    const b = Array.from({ length: 9 }, (_, i) => column(`b${i}`));
    assert.deepEqual(b, [675, 807, 807, 675, 807, 675, 807, 675, 807], "둘째 줄기는 제 열(675)과 밀린 열(807)을 오간다");
    assert.equal(new Set(b).size, 2, "두 열만 쓴다 — 셋 이상이면 계단으로 번진 것이다");
    // 🔵 두 줄기는 서로 **다른 열**에 선다(같으면 포개진 것이다).
    assert.notEqual(a[0], b[0]);
  });
});

/**
 * ============================================================================
 * 🔴 **주 흐름 사이가 가지만큼 벌어진다** (2026-11-05 저녁)
 * ============================================================================
 * 사용자가 엑셀 원본을 보여 주며: 「기준이 되는 메인줄기의 노드들이 서로 멀리
 * 띄어져 있어도 괜찮으니까 원본 엑셀처럼 만들어줘」. 셈은 graph-editor-core 에
 * 있고 layout.test.ts 가 값으로 잰다. 여기서는 **실제 노드 크기**로 재어, 도메인이
 * 넘기는 눈금·빈자리로도 그 모양이 나오는지를 본다.
 * ============================================================================
 */
describe("🔴 주 흐름 사이가 가지만큼 벌어진다", () => {
  const TITLE = "입력 전압(3상)을 측정하여 기록하고 기준 범위 안인지 판정한다";

  function chain(count: number, branchSteps: number) {
    const nodes: ProcedureAutoLayoutNode[] = [node("start", 0, { title: TITLE })];
    const edges: ProcedureAutoLayoutEdge[] = [];
    let order = 1;
    for (let i = 1; i <= count; i++) {
      nodes.push(node(`d${i}`, order++, { title: TITLE, nodeType: "DECISION" }));
      edges.push(edge(i === 1 ? "start" : `d${i - 1}`, `d${i}`, i === 1 ? "DEFAULT" : "NORMAL"));
      for (let s = 1; s <= branchSteps; s++) {
        nodes.push(node(`g${i}_${s}`, order++, { title: TITLE }));
        edges.push(edge(s === 1 ? `d${i}` : `g${i}_${s - 1}`, `g${i}_${s}`, s === 1 ? "NG" : "DEFAULT"));
      }
    }
    return { nodes, edges };
  }

  const trunkGap = (branchSteps: number) => {
    const { nodes, edges } = chain(3, branchSteps);
    const positions = computeProcedureAutoLayout({ nodes, edges });
    const at = (id: string) => centerY(positions, id, nodes.find((n) => n.id === id)!);
    const gaps = [at("d2") - at("d1"), at("d3") - at("d2")];
    assert.equal(new Set(gaps).size, 1, `가지 ${branchSteps}단계: 주 흐름 사이가 들쭉날쭉하다`);
    return gaps[0];
  };

  /**
   * 🔴 2026-11-05 **밤** — 값이 한 칸씩 줄었다. 이 표본의 가지는 **첫 단계가 NG**
   * 이고(그 뒤는 이름 없는 선), NG 자식은 이제 **부모와 같은 줄**에 선다. 즉 그
   * 한 칸은 세로를 **안 쓴다**. 저녁 값은 {0:150, 1:300, 2:450, 3:600} 이었다.
   * 🔵 「가지가 쓴 높이만큼 주 흐름이 내려간다」는 규칙은 그대로다 — NG 한 칸이
   * 높이를 0 으로 쓰게 된 것뿐이다.
   */
  test("🔴 가지가 **쓴 줄 수**만큼 주 흐름이 내려간다 — NG 한 칸은 부모 줄에 서므로 안 센다", () => {
    assert.equal(trunkGap(0), SPACING.vertical, "가지가 없으면 눈금 그대로 150");
    assert.equal(trunkGap(1), SPACING.vertical, "🔴 NG 한 칸뿐이면 부모 줄에 서므로 **안 늘어난다**");
    assert.equal(trunkGap(2), SPACING.vertical * 2, "NG 아래로 한 칸이 더 있으면 그만큼만");
    assert.equal(trunkGap(3), SPACING.vertical * 3);
  });

  test("🔴 그림이 세로로 얼마나 길어지는가 — 받아들인 대가를 값으로 적어 둔다", () => {
    const { nodes, edges } = chain(20, 1);
    const positions = computeProcedureAutoLayout({ nodes, edges });
    const boxes = nodes.map((n) => {
      const { width, height } = procedureAutoLayoutNodeDimensions(n);
      const p = positions.get(n.id)!;
      return { left: p.x, right: p.x + width, top: p.y, bottom: p.y + height };
    });
    const height = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
    /**
     * 🔴 세로가 세 판을 거쳤다. 노드 41개(판단 20 + NG 가지 20 + 시작) 기준:
     *  - **깊이로 정하던 때**: 21줄 = **3052**
     *  - **「앞에 놓인 것들이 쓴 높이」로 바꾼 뒤**(2026-11-05 저녁): 41줄 = **6052**
     *    (한 칸에 한 줄씩) — 사용자가 「멀리 띄어져 있어도 괜찮다」고 받아들인 값
     *  - **NG 를 부모 줄로 올린 뒤**(밤, 사용자 지시): **3202** — NG 20칸이 줄을
     *    안 쓰므로 21줄로 돌아왔고, 깊이로 정하던 때와 **거의 같아졌다.**
     * 🔵 즉 「주 흐름 사이가 가지만큼 벌어진다」를 얻고도 **세로는 안 길어졌다.**
     *    길어지는 것은 가지가 **두 단계 이상**일 때뿐이다.
     */
    assert.equal(nodes.length, 41);
    // 🔴 2026-11-05 밤(둘째 판) — 3202 → **3052**. 「외동 NG 는 안 올린다」 걸개를
    //    걷어내면서 이 표본의 NG 가 **전부** 부모 줄로 올라갔다. 공교롭게도 세로를
    //    깊이로 정하던 때(3052)와 **같은 값**이 됐다 — 줄 수가 21로 같아져서다.
    assert.equal(height, 3052);
    // 🔵 가로는 이번 변경이 안 건드렸다 — 셈이 폭과 선만 보고 세로를 아예 안 읽기
    //    때문이다(layout.ts 의 centerXById 는 centerYById 를 한 번도 안 쓴다).
    //    값을 못 박아 두어, 세로를 고치다 가로가 새면 여기서 걸리게 한다.
    const width = Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left));
    assert.equal(width, 1131);
  });

  test("🔴 줄기는 여전히 **한 열**이고 **포개진 쌍이 0** 이다 — 세로를 바꿔도 앞선 두 규칙이 그대로다", () => {
    const { nodes, edges } = chain(20, 2);
    const positions = computeProcedureAutoLayout({ nodes, edges });
    const columns = new Set(["start", ...Array.from({ length: 20 }, (_, i) => `d${i + 1}`)].map((id) => centerX(positions, id, nodes.find((n) => n.id === id)!)));
    assert.equal(columns.size, 1, "줄기가 한 열이 아니면 세로 고침이 가로 규칙을 깬 것이다");

    const boxes = nodes.map((n) => {
      const { width, height } = procedureAutoLayoutNodeDimensions(n);
      const p = positions.get(n.id)!;
      return { id: n.id, left: p.x, right: p.x + width, top: p.y, bottom: p.y + height };
    });
    const overlapping: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)) overlapping.push(`${a.id} ↔ ${b.id}`);
      }
    }
    assert.deepEqual(overlapping, []);
    /**
     * 🔴 2026-11-05 **밤** — 전에는 여기가 「어떤 두 칸도 같은 줄에 안 선다」
     * (서로 다른 줄 = 노드 수)였고, 그것이 겹침이 **구조적으로** 불가능한 까닭이었다.
     * NG 를 부모 줄로 올리면서 **그 보장은 사라졌다** — 부모와 NG 자식이 같은 줄에
     * 선다. 이제 안 포개는 근거는 **가로**다: 같은 줄에 서는 쌍은 부모–자식뿐이고,
     * 그 쌍은 `minCenterDistanceX` 로 부모의 폭까지 재어 떼어 놓는다.
     * 🔵 그래서 숨은 규칙을 값으로 적어 둔다 — 줄을 나눠 쓰는 칸이 **정확히 NG 수만큼**
     * 이고(61칸이 42줄 = 19개가 겹쳐 앉았다), 그런데도 포갬은 0 이다.
     */
    const rows = new Set(boxes.map((b) => (b.top + b.bottom) / 2)).size;
    assert.equal(nodes.length, 61);
    assert.equal(rows, 41, "줄을 나눠 쓰는 칸이 생겼다 — NG 를 부모 줄로 올린 결과다. 🔵 밤 둘째 판에서 42 → 41 (외동 걸개를 걷으며 한 칸이 더 올라갔다)");
    assert.ok(rows < nodes.length, "표본에 같은 줄 쌍이 하나도 없으면 가로 근거를 안 재고 있다");
  });
});

/**
 * ============================================================================
 * 🔴 **연결선이 곧게 붙는다** (2026-11-05 밤)
 * ============================================================================
 * 사용자 지시: 「연결선 정렬도 맞춰줘」. 자리를 옮겼으면 선도 그에 맞게 붙어야
 * 뜻이 있다 — NG 는 **곧은 가로 한 줄**, 주 흐름은 **곧은 세로 한 줄**.
 *
 * 🔴 **선이 어느 변에서 나오고 들어가는지는 `resolveConnectionHandles` 가 기하로
 * 정한다.** `procedure-edge-routing.ts` 의 decisionBranchSourceHandle(NG 를 왼쪽으로
 * 내보내는 그 규칙)은 **이 화면에서 한 번도 안 돈다** — 그쪽은 `routeAssignments` 를
 * 거치는데 그 memo 가 `layoutMode !== "STAGE_SORTED"` 이면 빈 지도를 돌려주고,
 * 절차 편집기는 EDITOR_LAYOUT_MODES = ["USER"] 라 그 모드를 **고를 수조차 없다**.
 * 그래서 그 파일은 안 고쳤다(2026-11-05 실측).
 *
 * 🔵 아래가 재는 것은 **곧음의 조건**이다. 실제로 직선을 그릴지는
 * computeDefaultEdgePath 가 `isAlignedVerticalConnection` ·
 * `isAlignedHorizontalConnection` 으로 정하는데, 그 둘에 넘어가는 값이 바로
 * 여기서 재는 **핸들의 좌표**다. 가로 핸들(HORIZONTAL_HANDLE_IDS)은 옆면 **세로
 * 중앙**에, 세로 핸들은 위/아랫변 **가로 중앙**에 붙어 있다(ProcedureFlowGraph 의
 * ProcedureNodeHandles — 거기 주석도 「옆면 세로 중앙에 붙어야 진짜 수평선이
 * 된다」고 적고 있다). 그래서 중심 y 가 같으면 가로 직선, 중심 x 가 같으면 세로
 * 직선이다.
 * ============================================================================
 */
describe("🔴 연결선이 곧게 붙는다", () => {
  const TITLE = "입력 전압(3상)을 측정하여 기록하고 기준 범위 안인지 판정한다";
  const geomOf = (positions: Map<string, { x: number; y: number }>, n: ProcedureAutoLayoutNode) => {
    const { width, height } = procedureAutoLayoutNodeDimensions(n);
    const p = positions.get(n.id)!;
    return { x: p.x, y: p.y, width, height };
  };

  function sample() {
    const nodes = [
      node("start", 0, { title: TITLE }),
      node("check", 1, { title: TITLE, nodeType: "DECISION" }),
      node("ng", 2, { title: TITLE }),
      node("next", 3, { title: TITLE }),
    ];
    const edges = [edge("start", "check", "DEFAULT"), edge("check", "ng", "NG"), edge("check", "next", "NORMAL")];
    return { nodes, edges, positions: computeProcedureAutoLayout({ nodes, edges }) };
  }

  test("🔴 NG 선 — **판단의 오른쪽 변 → NG 노드의 왼쪽 변**, 꺾임 없이", () => {
    const { nodes, positions } = sample();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const from = geomOf(positions, byId.get("check")!);
    const to = geomOf(positions, byId.get("ng")!);

    const handles = resolveConnectionHandles(from, to);
    assert.equal(handles.orientation, "HORIZONTAL");
    assert.equal(handles.sourceHandle, HORIZONTAL_HANDLE_IDS.rightOut, "판단의 **오른쪽** 변에서 나온다");
    assert.equal(handles.targetHandle, HORIZONTAL_HANDLE_IDS.leftIn, "NG 노드의 **왼쪽** 변으로 들어간다");

    // 🔵 가로 핸들은 옆면 **세로 중앙**에 붙는다 → 두 중심 y 가 같으면 곧은 가로선이다.
    const sourceY = from.y + from.height / 2;
    const targetY = to.y + to.height / 2;
    assert.equal(sourceY, targetY);
    assert.equal(isAlignedHorizontalConnection(sourceY, targetY), true, "그림이 직선을 그릴 조건 그 자체");
    // 🔵 표본 확인 — 정말 **옆에** 있나(겹쳐 있으면 위 단언이 뜻을 잃는다).
    assert.ok(to.x > from.x + from.width, "NG 는 판단의 오른쪽 바깥에 있다");
  });

  test("🔴 주 흐름 선 — **아랫변 → 윗변**, 꺾임 없이", () => {
    const { nodes, positions } = sample();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const [fromId, toId] of [["start", "check"], ["check", "next"]] as const) {
      const from = geomOf(positions, byId.get(fromId)!);
      const to = geomOf(positions, byId.get(toId)!);
      const handles = resolveConnectionHandles(from, to);
      assert.equal(handles.orientation, "VERTICAL", `${fromId} → ${toId}`);
      assert.equal(handles.sourceHandle, VERTICAL_HANDLE_IDS.bottomOut);
      assert.equal(handles.targetHandle, VERTICAL_HANDLE_IDS.topIn);
      // 🔵 세로 핸들은 위/아랫변 **가로 중앙**에 붙는다 → 두 중심 x 가 같으면 곧은 세로선.
      const sourceX = from.x + from.width / 2;
      const targetX = to.x + to.width / 2;
      assert.equal(sourceX, targetX, `${fromId} → ${toId} 가 한 열이 아니다`);
      assert.equal(isAlignedVerticalConnection(sourceX, targetX), true);
      assert.ok(to.y > from.y + from.height, "아래에 있다");
    }
  });

  test("🔵 깨뜨려 보기 — NG 를 부모 줄에서 내리면 **가로 직선 조건이 깨진다**", () => {
    // 같은 표본인데 갈래만 NG → CUSTOM 으로 바꾼다(= 부모 줄로 안 올라간다).
    const nodes = [
      node("start", 0, { title: TITLE }),
      node("check", 1, { title: TITLE, nodeType: "DECISION" }),
      node("ng", 2, { title: TITLE }),
      node("next", 3, { title: TITLE }),
    ];
    const positions = computeProcedureAutoLayout({
      nodes,
      edges: [edge("start", "check", "DEFAULT"), edge("check", "ng", "CUSTOM"), edge("check", "next", "NORMAL")],
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const from = geomOf(positions, byId.get("check")!);
    const to = geomOf(positions, byId.get("ng")!);
    assert.notEqual(from.y + from.height / 2, to.y + to.height / 2, "같은 줄이 아니게 된다");
    assert.equal(
      isAlignedHorizontalConnection(from.y + from.height / 2, to.y + to.height / 2),
      false,
      "그러면 가로 직선 조건이 깨진다 — 이 시험이 재는 것이 그 조건이라는 증거"
    );
  });
});
