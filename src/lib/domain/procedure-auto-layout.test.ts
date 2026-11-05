import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  PROCEDURE_AUTO_LAYOUT_SPACING,
  computeProcedureAutoLayout,
  procedureAutoLayoutNodeDimensions,
  procedureAutoLayoutNodeWidth,
  toAutoLayoutGhostNode,
  type ProcedureAutoLayoutEdge,
  type ProcedureAutoLayoutNode,
} from "./procedure-auto-layout";
import { buildFieldStepGhostGraph, fieldStepGhostNodeId, type FieldAddedStep, type FieldStepNeighbor } from "./procedure-field-added-steps";

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
 * ① 지도가 실제로 차 있고 ② 유령이 없을 때와 있을 때가 **정말 다르고**
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

function edge(fromNodeId: string, toNodeId: string): ProcedureAutoLayoutEdge {
  return { fromNodeId, toNodeId };
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
 * 실측을 본뜬 초안 — **자리 값이 하나도 없는** 기술작업절차다(개발 DB 의 초안 "7"
 * 이 22개 중 0개였다). n2 밑에 이미 자식이 둘이라, 거기에 하나가 더 붙으면 부채꼴이
 * 넓어지며 둘레가 **좌우로 비켜선다** — 2026-11-04 에 사용자가 본 그 움직임이다.
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
  for (const n of step.incoming) if (n.draftNodeId && draftNodeIds.has(n.draftNodeId)) createdEdges.push(edge(n.draftNodeId, ADOPTED_NODE_ID));
  for (const n of step.outgoing) if (n.draftNodeId && draftNodeIds.has(n.draftNodeId)) createdEdges.push(edge(ADOPTED_NODE_ID, n.draftNodeId));

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
    assert.deepEqual({ ...SPACING }, { horizontal: 280, vertical: 150 }, "눈금이 바뀌면 옮기면서 셈이 바뀐 것이다");
    // 🔴 **중심** y 가 오로지 깊이다 — n1(0) → n2(1) → n3(2) → n4(3).
    //    2026-11-05 전에는 여기에 좌상단 y 가 그대로 적혀 있었다(윗변 기준).
    //    높이가 다른 노드가 한 줄에 섞이면 그 셈은 중심을 어긋나게 한다.
    assert.equal(centerY(positions, "n1", node("n1", 0)), 0);
    assert.equal(centerY(positions, "n2", node("n2", 1)), SPACING.vertical);
    assert.equal(centerY(positions, "n4", node("n4", 3)), SPACING.vertical * 3);
    // 🔵 좌상단 y 는 중심에서 높이의 절반만큼 위다 — 깊이 0 이 음수가 되는 것이 정상이다.
    assert.ok(positions.get("n1")!.y < 0, "깊이 0 의 좌상단 y 는 -높이/2 다");
  });

  test("🔵 노드 폭은 **제목마다 다르다** — 폭이 상수면 「같은 자로 잰다」가 아무것도 안 지킨다", () => {
    const short = procedureAutoLayoutNodeWidth({ nodeType: "TASK", title: "가" });
    const long = procedureAutoLayoutNodeWidth({ nodeType: "TASK", title: FIELD_STEP_TITLE });
    assert.ok(short > 0 && long > 0);
    assert.notEqual(short, long, "폭이 가운데 맞춤에 걸려 있어, 유령과 채택 노드가 같은 폭으로 재어져야 한다");
  });

  test("🔴 유령을 넣으면 **둘레가 정말 움직인다** — 안 움직이면 아래 「같다」가 거저 통과한다", () => {
    const draft = sampleDraft();
    const before = computeProcedureAutoLayout(draft);
    const { positions: after } = layoutWithGhost(draft, [fieldStep()]);
    const moved = draft.nodes.filter((n) => before.get(n.id)!.x !== after.get(n.id)!.x || before.get(n.id)!.y !== after.get(n.id)!.y);
    assert.ok(moved.length > 0, "움직임이 0 이면 이 표본으로는 A 안이 무엇을 바꿨는지 잴 수 없다");
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
    const { positions: withGhost } = layoutWithGhost(draft, [fieldStep()]);
    assert.notDeepEqual(new Map([...withGhost].filter(([id]) => id.startsWith("n"))), omitted);
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
  test("🔴 부채꼴이 넓어지며 형제가 좌우로 비켜선다 — 값으로 적어 둔다", () => {
    const draft = sampleDraft();
    const before = computeProcedureAutoLayout(draft);
    const { positions: after } = layoutWithGhost(draft, [fieldStep()]);

    const delta = (id: string) => ({ dx: after.get(id)!.x - before.get(id)!.x, dy: after.get(id)!.y - before.get(id)!.y });
    /**
     * 🔴 n2 밑의 형제가 둘 → 셋이 되면서 부채꼴이 **대칭으로** 넓어지고, 새 칸이
     * **맨 뒤(오른쪽)** 에 붙는다: 둘일 때 (−140, +140) 이던 자리가 셋이면
     * (−280, 0, +280) 이 된다. 그래서 기존 형제는 **둘 다 왼쪽으로 140px**
     * (가로 눈금의 절반) 밀린다 — 한쪽은 왼쪽, 한쪽은 오른쪽이 아니다.
     *
     * 🔵 2026-11-04 에 사용자가 실제 초안에서 잰 값이 이 모양이다 — 채택하는 순간
     * 22개가 **전부 음수**로 움직였다(열넷이 −140, 여덟이 −110). A 안은 그 움직임을
     * 「넣는 순간」에서 「켜는 순간」으로 앞당길 뿐, 크기를 줄이지 않는다.
     */
    const FAN_OUT_SHIFT = SPACING.horizontal / 2;
    assert.equal(FAN_OUT_SHIFT, 140);
    assert.deepEqual(delta("n3"), { dx: -FAN_OUT_SHIFT, dy: 0 });
    assert.deepEqual(delta("n5"), { dx: -FAN_OUT_SHIFT, dy: 0 }, "맨 뒤에 붙으므로 기존 형제는 **둘 다** 왼쪽으로 밀린다");
    // 그 아래로 이어지는 칸은 부모를 따라간다 — **한 칸이 움직이면 줄기가 움직인다**.
    assert.deepEqual(delta("n4"), { dx: -FAN_OUT_SHIFT, dy: 0 });
    // 위쪽(뿌리와 부모)은 가만히 있다. 전부 움직인다고 잘못 알리지 않도록 함께 잰다.
    assert.deepEqual(delta("n1"), { dx: 0, dy: 0 });
    assert.deepEqual(delta("n2"), { dx: 0, dy: 0 });
    // 🔵 세로는 아무도 안 움직인다 — 깊이가 안 바뀌기 때문이다(선이 새로 생겨도
    //    기존 노드의 깊이는 그대로다). 가로로만 비켜선다는 것이 이 결정의 대가다.
    for (const n of draft.nodes) assert.equal(delta(n.id).dy, 0);
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
      ghostEdges: [{ fromNodeId: "n2", toNodeId: ghostId }],
    });
    const unpinned = computeProcedureAutoLayout({
      ...draft,
      ghostNodes: [toAutoLayoutGhostNode({ ...base, hasUserPosition: false })],
      ghostEdges: [{ fromNodeId: "n2", toNodeId: ghostId }],
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

    const withEdges = computeProcedureAutoLayout({ ...draft, ghostNodes, ghostEdges: [{ fromNodeId: "n2", toNodeId: ghostId }] });
    const withoutEdges = computeProcedureAutoLayout({ ...draft, ghostNodes, ghostEdges: [] });
    // 🔵 깊이는 **중심** y 로 읽는다(2026-11-05) — 좌상단 y 에는 높이의 절반이 섞여 있다.
    const ghostShape = { nodeType: step.nodeType, title: step.title };
    assert.equal(centerY(withEdges, ghostId, ghostShape), SPACING.vertical * 2, "n2(깊이 1) 의 자식이므로 깊이 2 다");
    assert.equal(centerY(withoutEdges, ghostId, ghostShape), 0, "선이 없으면 뿌리라 깊이 0 이다");
  });
});
