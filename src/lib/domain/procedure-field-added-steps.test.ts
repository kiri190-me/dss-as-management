import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_FIELD_STEP_GHOST_GRAPH,
  FIELD_STEP_GHOST_SUBTITLE,
  FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY,
  adoptedFieldSteps,
  buildFieldStepGhostGraph,
  fieldStepGhostNodeId,
  fieldStepNodeCode,
  parseFieldStepGhostVisibility,
  parseFieldStepNodeCode,
  pendingFieldSteps,
  readFieldStepGhostVisibility,
  summarizeFieldStepAdoption,
  writeFieldStepGhostVisibility,
  type FieldAddedStep,
  type FieldStepNeighbor,
} from "./procedure-field-added-steps";
import { ADDED_NODE_GAP_X, ADDED_NODE_GAP_Y } from "./procedure-execution-layout";
import { computeLayeredGraphLayout } from "../graph-editor-core/layout";

/**
 * 줄기 B-⑧ — 현장에서 더한 단계를 고르고 · 희미하게 그릴 자리를 세고 · 셈한다.
 *
 * 🔵 **먼저 표본을 확인한다.** 아래의 많은 단언이 「걸러진 목록」을 재는데,
 * 거르기가 통째로 망가져 빈 배열이 나와도 `deepEqual([], [])` 는 통과한다. 그래서
 * 첫 묶음에서 「무엇을 재는지」 — 표본에 넣은 것과 안 넣은 것이 실제로 둘 다
 * 있는지 — 를 먼저 단언한다.
 */

function neighbor(overrides: Partial<FieldStepNeighbor> = {}): FieldStepNeighbor {
  return { draftNodeId: null, fieldStepExecutionNodeId: null, branchType: "DEFAULT", branchLabel: null, ...overrides };
}

/**
 * 🔵 `nextSortOrder` 는 **채택이 줄 번호**(이 초안 sort_order 최댓값 + 1)다. 아래
 * 시험 대부분은 그 번호가 실제로 쓰이는 자리(자동 배치에서 뿌리의 가로 차례)를 안
 * 재므로 한 값으로 고정해 둔다 — 그 자리를 값으로 재는 것은
 * procedure-auto-layout.test.ts 다.
 *
 * 🔴 그런데도 **함수 쪽에는 기본값을 안 두었다**: 화면이 넘기는 것을 잊으면
 * 컴파일이 멈춰야 한다. 조용히 0 이 들어가면 유령이 뿌리들의 맨 앞에 섰다가 넣고
 * 나면 맨 뒤로 건너뛴다.
 */
const TEST_NEXT_SORT_ORDER = 7;

function buildGhostGraph(params: {
  steps: readonly FieldAddedStep[];
  anchorPositions: ReadonlyMap<string, { x: number; y: number }>;
  nextSortOrder?: number;
}) {
  return buildFieldStepGhostGraph({ ...params, nextSortOrder: params.nextSortOrder ?? TEST_NEXT_SORT_ORDER });
}

function step(overrides: Partial<FieldAddedStep> & { executionNodeId: string }): FieldAddedStep {
  return {
    nodeCode: fieldStepNodeCode(overrides.executionNodeId),
    title: `작업 ${overrides.executionNodeId}`,
    instructions: null,
    nodeType: "TASK",
    userPositionX: null,
    userPositionY: null,
    adoptedNodeId: null,
    incoming: [],
    outgoing: [],
    intakeNumber: null,
    sourceTemplateVersion: 1,
    addedAt: "2026-11-01T00:00:00.000Z",
    addedByName: null,
    ...overrides,
  };
}

describe("줄기 B-⑧ — ① 먼저 표본 확인", () => {
  test("🔵 표본에 **넣은 것과 안 넣은 것이 둘 다** 있다 — 아래 거르기 단언이 공짜로 통과하지 않는 근거", () => {
    const steps = [step({ executionNodeId: "a" }), step({ executionNodeId: "b", adoptedNodeId: "draft-b" })];
    assert.equal(steps.length, 2);
    assert.equal(steps.filter((s) => s.adoptedNodeId === null).length, 1, "안 넣은 것이 하나는 있어야 한다");
    assert.equal(steps.filter((s) => s.adoptedNodeId !== null).length, 1, "이미 넣은 것도 하나는 있어야 한다");
  });

  test("🔵 자리 눈금이 실제 값이다 — 0 이면 「앞 칸 오른쪽」 단언이 뜻을 잃는다", () => {
    assert.ok(ADDED_NODE_GAP_X > 0, "가로 눈금이 0 이면 겹쳐 놓고도 통과한다");
    assert.ok(ADDED_NODE_GAP_Y > 0, "세로 눈금이 0 이면 형제가 겹쳐도 통과한다");
  });
});

describe("줄기 B-⑧ — 「넣었다」를 기억하는 열쇠는 node_code 하나다", () => {
  test("🔴 실행 노드 id 를 넣으면 `field-<id>` 가 나오고, 그대로 되뽑힌다", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    assert.equal(fieldStepNodeCode(id), `field-${id}`);
    assert.equal(parseFieldStepNodeCode(fieldStepNodeCode(id)), id);
  });

  test("🔴 현장 단계에서 온 것이 아닌 node_code 는 안 걸린다", () => {
    assert.equal(parseFieldStepNodeCode("manual-11111111-2222-3333-4444-555555555555"), null);
    assert.equal(parseFieldStepNodeCode("s11-14"), null);
    // 앞글자만 있고 뒤가 비면 가리키는 실행 노드가 없다 — 현장 단계가 아니다.
    assert.equal(parseFieldStepNodeCode("field-"), null);
  });

  test("🔵 손으로 만든 노드의 꼴(`manual-`)과 **겹치지 않는다** — 눈으로도 갈린다", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    assert.notEqual(fieldStepNodeCode(id), `manual-${id}`);
    assert.ok(fieldStepNodeCode(id).startsWith("field-"));
  });
});

describe("줄기 B-⑧ — 현장에서 더한 것만 골라 낸다", () => {
  const steps = [
    step({ executionNodeId: "a" }),
    step({ executionNodeId: "b", adoptedNodeId: "draft-b" }),
    step({ executionNodeId: "c" }),
  ];

  test("🔴 아직 안 넣은 것만 pending 이다", () => {
    assert.deepEqual(pendingFieldSteps(steps).map((s) => s.executionNodeId), ["a", "c"]);
  });

  test("🔴 이미 넣은 것만 adopted 다 — 둘을 합치면 원래 목록이다", () => {
    assert.deepEqual(adoptedFieldSteps(steps).map((s) => s.executionNodeId), ["b"]);
    assert.equal(pendingFieldSteps(steps).length + adoptedFieldSteps(steps).length, steps.length);
  });
});

describe("줄기 B-⑧ — 유령 칸: 어디에 서는가", () => {
  test("🔴 이미 넣은 단계는 **유령이 안 된다** — 진짜 노드로 이미 그려져 있다", () => {
    const graph = buildGhostGraph({
      steps: [step({ executionNodeId: "a", adoptedNodeId: "draft-a" })],
      anchorPositions: new Map(),
    });
    assert.deepEqual(graph.nodes, []);
    assert.deepEqual(graph.edges, []);
  });

  test("🔴 현장에서 **사람이 끌어 놓은 자리**는 그대로 쓴다 — 다시 세지 않는다", () => {
    const graph = buildGhostGraph({
      steps: [step({ executionNodeId: "a", userPositionX: 42, userPositionY: -7, incoming: [neighbor({ draftNodeId: "n1" })] })],
      anchorPositions: new Map([["n1", { x: 1000, y: 1000 }]]),
    });
    assert.equal(graph.nodes.length, 1);
    assert.deepEqual({ x: graph.nodes[0].x, y: graph.nodes[0].y }, { x: 42, y: -7 }, "앞 칸이 있어도 사람이 정한 자리가 이긴다");
  });

  test("🔵 자리가 **반쪽만** 찬 줄은 자리가 아니다 — 세는 쪽으로 간다", () => {
    const graph = buildGhostGraph({
      steps: [step({ executionNodeId: "a", userPositionX: 42, userPositionY: null, incoming: [neighbor({ draftNodeId: "n1" })] })],
      anchorPositions: new Map([["n1", { x: 100, y: 200 }]]),
    });
    assert.deepEqual({ x: graph.nodes[0].x, y: graph.nodes[0].y }, { x: 100 + ADDED_NODE_GAP_X, y: 200 });
  });

  test("🔴 자리가 없으면 **앞 칸의 오른쪽**, 같은 앞 칸의 형제는 아래로 내려간다", () => {
    const graph = buildGhostGraph({
      steps: [
        step({ executionNodeId: "a", addedAt: "2026-11-01T00:00:00.000Z", incoming: [neighbor({ draftNodeId: "n1" })] }),
        step({ executionNodeId: "b", addedAt: "2026-11-01T00:00:01.000Z", incoming: [neighbor({ draftNodeId: "n1" })] }),
      ],
      anchorPositions: new Map([["n1", { x: 100, y: 200 }]]),
    });
    assert.deepEqual({ x: graph.nodes[0].x, y: graph.nodes[0].y }, { x: 400, y: 200 });
    assert.deepEqual({ x: graph.nodes[1].x, y: graph.nodes[1].y }, { x: 400, y: 200 + ADDED_NODE_GAP_Y });
    assert.notDeepEqual(
      { x: graph.nodes[0].x, y: graph.nodes[0].y },
      { x: graph.nodes[1].x, y: graph.nodes[1].y },
      "형제가 겹치면 칸 하나처럼 보인다"
    );
  });

  test("🔴 앞 칸이 없으면 그림의 **가장 오른쪽 바깥**에 위에서부터 쌓인다", () => {
    const graph = buildGhostGraph({
      steps: [
        step({ executionNodeId: "a", addedAt: "2026-11-01T00:00:00.000Z" }),
        step({ executionNodeId: "b", addedAt: "2026-11-01T00:00:01.000Z" }),
      ],
      anchorPositions: new Map([
        ["n1", { x: 100, y: 0 }],
        ["n2", { x: 900, y: 0 }],
      ]),
    });
    assert.equal(graph.nodes[0].x, 900 + ADDED_NODE_GAP_X, "가장 오른쪽(900)을 기준으로 삼아야 그림에 안 겹친다");
    assert.equal(graph.nodes[0].y, 0);
    assert.equal(graph.nodes[1].y, ADDED_NODE_GAP_Y);
  });

  test("🔵 같은 입력이면 **언제나 같은 그림**이다 — 넣는 차례를 바꿔도 결과가 같다", () => {
    const a = step({ executionNodeId: "a", addedAt: "2026-11-01T00:00:00.000Z" });
    const b = step({ executionNodeId: "b", addedAt: "2026-11-01T00:00:01.000Z" });
    const anchors = new Map([["n1", { x: 0, y: 0 }]]);
    const first = buildGhostGraph({ steps: [a, b], anchorPositions: anchors });
    const second = buildGhostGraph({ steps: [b, a], anchorPositions: anchors });
    assert.deepEqual(first, second);
  });

  test("🔵 유령 칸의 꼬리말이 「아직 절차에 없음」을 말한다 · 갈래는 현장에서 고른 그대로다", () => {
    const graph = buildGhostGraph({
      steps: [step({ executionNodeId: "a", nodeType: "DECISION", title: "추가 판단" })],
      anchorPositions: new Map(),
    });
    assert.equal(graph.nodes[0].title, "추가 판단");
    assert.equal(graph.nodes[0].nodeType, "DECISION");
    assert.equal(graph.nodes[0].subtitle, FIELD_STEP_GHOST_SUBTITLE);
    assert.ok(FIELD_STEP_GHOST_SUBTITLE.includes("아직 절차에 없음"));
  });
});

describe("줄기 B-⑧ — 유령 선: 이을 수 있는 것만 긋는다", () => {
  test("🔴 이 초안에 있는 절차 노드와는 **들어오는 쪽·나가는 쪽 모두** 이어진다", () => {
    const graph = buildGhostGraph({
      steps: [
        step({
          executionNodeId: "a",
          incoming: [neighbor({ draftNodeId: "n1", branchType: "NG", branchLabel: "이상" })],
          outgoing: [neighbor({ draftNodeId: "n2" })],
        }),
      ],
      anchorPositions: new Map([
        ["n1", { x: 0, y: 0 }],
        ["n2", { x: 0, y: 300 }],
      ]),
    });
    const ghostId = fieldStepGhostNodeId("a");
    assert.equal(graph.edges.length, 2);
    assert.deepEqual(
      graph.edges.map((e) => [e.fromNodeId, e.toNodeId]),
      [
        ["n1", ghostId],
        [ghostId, "n2"],
      ]
    );
    assert.equal(graph.edges[0].branchType, "NG", "갈래가 바뀌면 그림에서 무슨 선이었는지 알 수 없다");
    assert.equal(graph.edges[0].branchLabel, "이상");
  });

  test("🔴 **이 초안에 없는 상대**에는 선을 안 긋는다 — 한쪽 끝이 없는 선은 조용히 안 그려진다", () => {
    const graph = buildGhostGraph({
      // 둘 다 비어 있다 = 원본에는 있었는데 이 초안에서 지워진 노드.
      steps: [step({ executionNodeId: "a", incoming: [neighbor()] })],
      anchorPositions: new Map(),
    });
    assert.equal(graph.nodes.length, 1, "칸 자체는 그린다 — 넣는 것을 막지는 않는다");
    assert.deepEqual(graph.edges, [], "이을 곳이 없는 선은 그리지 않는다");
  });

  test("🔴 현장 단계끼리의 **사슬**도 이어진다 — 둘 다 아직 안 넣었어도 그림에서는 이어 보여야 한다", () => {
    const graph = buildGhostGraph({
      steps: [
        step({ executionNodeId: "a", addedAt: "2026-11-01T00:00:00.000Z", incoming: [neighbor({ draftNodeId: "n1" })] }),
        step({
          executionNodeId: "b",
          addedAt: "2026-11-01T00:00:01.000Z",
          incoming: [neighbor({ fieldStepExecutionNodeId: "a" })],
        }),
      ],
      anchorPositions: new Map([["n1", { x: 0, y: 0 }]]),
    });
    assert.deepEqual(
      graph.edges.map((e) => [e.fromNodeId, e.toNodeId]),
      [
        ["n1", fieldStepGhostNodeId("a")],
        [fieldStepGhostNodeId("a"), fieldStepGhostNodeId("b")],
      ]
    );
    // 사슬의 자식은 부모 오른쪽에 선다 — 부모가 먼저 자리를 잡아야 가능한 일이다.
    assert.equal(graph.nodes[1].x, graph.nodes[0].x + ADDED_NODE_GAP_X);
  });

  test("🔴 양쪽이 같은 선을 적고 있어도 **한 줄**이다 — 겹쳐 그리면 지울 때 두 번 눌러야 한다", () => {
    const graph = buildGhostGraph({
      steps: [
        step({ executionNodeId: "a", addedAt: "2026-11-01T00:00:00.000Z", outgoing: [neighbor({ fieldStepExecutionNodeId: "b" })] }),
        step({ executionNodeId: "b", addedAt: "2026-11-01T00:00:01.000Z", incoming: [neighbor({ fieldStepExecutionNodeId: "a" })] }),
      ],
      anchorPositions: new Map(),
    });
    assert.equal(graph.edges.length, 1);
    assert.equal(new Set(graph.edges.map((e) => e.id)).size, graph.edges.length, "그림 위 id 가 겹치면 React Flow 가 하나만 그린다");
  });

  test("🔴 이미 넣은 현장 단계로 가는 선은 **유령으로 안 그린다** — 그쪽은 진짜 노드라 진짜 선이 이미 있다", () => {
    const graph = buildGhostGraph({
      steps: [
        step({ executionNodeId: "a", outgoing: [neighbor({ fieldStepExecutionNodeId: "b" })] }),
        step({ executionNodeId: "b", adoptedNodeId: "draft-b" }),
      ],
      anchorPositions: new Map([["draft-b", { x: 0, y: 0 }]]),
    });
    assert.equal(graph.nodes.length, 1, "b 는 이미 넣었으므로 유령이 아니다");
    assert.deepEqual(graph.edges, [], "넣은 쪽으로 가는 선은 채택할 때 진짜 선으로 그어진다");
  });
});

describe("줄기 B-⑧ — 넣으면 연결이 몇 개 생기는가", () => {
  test("🔴 셋을 **따로** 센다 — 이을 수 있는 것 · 상대를 먼저 넣어야 하는 것 · 영영 못 잇는 것", () => {
    const other = step({ executionNodeId: "other" });
    const adoptedOther = step({ executionNodeId: "adopted-other", adoptedNodeId: "draft-x" });
    const target = step({
      executionNodeId: "a",
      incoming: [neighbor({ draftNodeId: "n1" }), neighbor({ fieldStepExecutionNodeId: "other" })],
      outgoing: [neighbor({ fieldStepExecutionNodeId: "adopted-other" }), neighbor()],
    });
    const summary = summarizeFieldStepAdoption(target, [target, other, adoptedOther]);
    assert.equal(summary.connectableEdgeCount, 2, "초안의 절차 노드 하나 + 이미 넣은 현장 단계 하나");
    assert.equal(summary.waitingOnOtherFieldStepCount, 1, "아직 안 넣은 현장 단계로 가는 선");
    assert.equal(summary.danglingEdgeCount, 1, "이 초안에 상대가 없는 선");
  });

  test("🔵 이웃이 하나도 없으면 전부 0 이다 — 「작업만 들어온다」", () => {
    const only = step({ executionNodeId: "a" });
    assert.deepEqual(summarizeFieldStepAdoption(only, [only]), {
      connectableEdgeCount: 0,
      danglingEdgeCount: 0,
      waitingOnOtherFieldStepCount: 0,
    });
  });
});

describe("줄기 B-⑧ 뒷정리 — 유령 자리와 **채택이 적는 자리**가 같은 값인가 (2026-11-04)", () => {
  /**
   * 채택 쪽(adoptFieldAddedStep)의 규칙은 **두 칸이 다 차 있으면 그 값을 그대로**
   * position_x/y 와 user_position_x/y 에 적는 것이다. DB 시험 5번이 (777, 333) 으로
   * 그것을 지키고 있다(procedure-field-step-adoption.integration.test.ts). 여기서는
   * **같은 수로 유령 쪽**을 재서, 두 자리가 한 값에서 나온다는 것을 값으로 못 박는다.
   */
  const ADOPT_WRITES_X = 777;
  const ADOPT_WRITES_Y = 333;

  test("🔴 현장에서 끌어 놓은 자리가 있으면 유령은 **채택이 적는 바로 그 값**에 선다", () => {
    const graph = buildGhostGraph({
      steps: [
        step({
          executionNodeId: "a",
          userPositionX: ADOPT_WRITES_X,
          userPositionY: ADOPT_WRITES_Y,
          incoming: [neighbor({ draftNodeId: "n1" })],
        }),
      ],
      // 앞 칸을 **일부러 엉뚱한 곳**에 둔다 — 유령이 앵커를 보고 다시 세기 시작하면
      // 여기서 갈린다(그것이 「둘로 갈려 어긋난다」의 모양이다).
      anchorPositions: new Map([["n1", { x: -5000, y: -5000 }]]),
    });
    assert.equal(graph.nodes.length, 1, "표본 확인 — 유령이 하나도 없으면 아래가 공짜로 통과한다");
    assert.equal(graph.nodes[0].x, ADOPT_WRITES_X);
    assert.equal(graph.nodes[0].y, ADOPT_WRITES_Y);
  });

  /**
   * 🔴 **값이 같다고 화면에서 같은 자리에 서는 것은 아니다**(2026-11-04 실측).
   *
   * 저장된 좌표를 그대로 쓰는 칸과, 그림이 제 나름의 자동 배치로 세운 칸은 **서로
   * 다른 좌표계**에 산다. 기술작업절차의 노드는 자리 값이 비어 있는 것이 흔해서
   * (개발 DB 실측: 초안 "7" 은 22개 중 0개, "기본 통전 검사" 는 28개 중 1개만 찼다)
   * 거의 모든 칸이 자동 배치 쪽이다.
   *
   * 🔵 이 어긋남이 바로 **유령을 자동 배치에 함께 세운 까닭**이다(같은 날, 사용자
   * 결정 「A로 가자」). 전에는 유령만 저장 좌표에 서서 미리 보기가 엉뚱한 자리였다.
   * 지금 유령이 어디에 서는지는 procedure-auto-layout.test.ts 가 값으로 지킨다 —
   * 이 시험은 그 고침이 **필요했다는 사실**(두 좌표계가 정말 다르다)을 남겨 둔다.
   * 받침 자리(아래 buildGhostGraph 가 세는 x/y)는 자동 배치를 안 켠 절차에서 그대로
   * 쓰이므로 여전히 뜻이 있다.
   */
  test("🔴 자리 값이 없는 절차에서는 **그려지는 자리 ≠ 저장된 자리**다 — 유령을 자동 배치에 함께 세운 까닭", () => {
    const nodes = [
      { id: "n1", sortOrder: 0, width: 191 },
      { id: "n2", sortOrder: 1, width: 191 },
      { id: "n3", sortOrder: 2, width: 191 },
    ];
    const drawn = computeLayeredGraphLayout(nodes, [{ fromNodeId: "n1", toNodeId: "n2" }], { horizontal: 280, vertical: 150 });
    assert.equal(drawn.size, 3, "표본 확인 — 자동 배치가 비어 있으면 아래가 공짜로 통과한다");
    // 저장된 자리(편집기가 유령의 앵커로 넘기는 값)는 이것들이었다고 하자.
    const stored = new Map([
      ["n1", { x: -209.5, y: 102 }],
      ["n2", { x: -214, y: 252 }],
      ["n3", { x: -222.5, y: 361.1 }],
    ]);
    const samePlace = [...stored].filter(([id, point]) => drawn.get(id)!.x === point.x && drawn.get(id)!.y === point.y);
    assert.equal(samePlace.length, 0, "둘이 우연히 같아지면 이 시험은 아무것도 안 재고 있다");
  });

  /**
   * ──────────────────────────────────────────────────────────────────────
   * 유령 칸이 **자동 배치에 들어갈 때 들고 가는 두 값** (A 안, 2026-11-04)
   * ──────────────────────────────────────────────────────────────────────
   * 자리 자체가 맞는지는 procedure-auto-layout.test.ts 가 끝까지 잰다. 여기서는
   * 그 계산에 넘길 **입력 두 칸**이 채택 쪽과 같은 규칙으로 채워지는지를 본다 —
   * 틀리면 자동 배치는 아무 오류 없이 다른 자리를 내놓는다.
   */
  test("🔴 유령은 **채택이 줄 sort_order** 를 들고 간다 — 여럿이면 넣는 차례대로 +1", () => {
    const graph = buildGhostGraph({
      steps: [
        step({ executionNodeId: "a", addedAt: "2026-11-01T00:00:00.000Z" }),
        step({ executionNodeId: "b", addedAt: "2026-11-01T00:00:01.000Z" }),
      ],
      anchorPositions: new Map(),
      nextSortOrder: 22,
    });
    assert.deepEqual(graph.nodes.map((n) => n.sortOrder), [22, 23], "채택은 max+1 을 적고, 둘째는 그 다음 번호를 받는다");
    // 넘긴 값을 안 쓰고 제 나름의 번호를 매기면 여기서 갈린다.
    assert.notDeepEqual(graph.nodes.map((n) => n.sortOrder), [0, 1]);
  });

  test("🔴 **사람이 끌어다 놓은 자리**가 있는 유령만 hasUserPosition 이다 — 그 칸은 자동 배치가 안 민다", () => {
    const graph = buildGhostGraph({
      steps: [
        step({ executionNodeId: "a", addedAt: "2026-11-01T00:00:00.000Z", userPositionX: ADOPT_WRITES_X, userPositionY: ADOPT_WRITES_Y }),
        step({ executionNodeId: "b", addedAt: "2026-11-01T00:00:01.000Z" }),
        // 반쪽만 찬 줄은 자리가 아니다 — 채택도 그때는 user_position 을 안 적는다.
        step({ executionNodeId: "c", addedAt: "2026-11-01T00:00:02.000Z", userPositionX: ADOPT_WRITES_X, userPositionY: null }),
      ],
      anchorPositions: new Map(),
    });
    assert.deepEqual(graph.nodes.map((n) => n.hasUserPosition), [true, false, false]);
    // 참인 칸의 x/y 는 곧 사람이 정한 자리다(그 값이 그대로 pinnedX 가 된다).
    assert.deepEqual({ x: graph.nodes[0].x, y: graph.nodes[0].y }, { x: ADOPT_WRITES_X, y: ADOPT_WRITES_Y });
  });
});

describe("줄기 B-⑧ 뒷정리 — 「현장 단계」를 그림에서 끄고 켠 상태는 **브라우저에만** 남는다 (2026-11-04)", () => {
  /** 적는 것을 흉내 낸 저장소. 시험이 실물 localStorage 에 손대지 않는다. */
  function fakeStore(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
  }

  test("🔵 표본 확인 — 열쇠가 비어 있지 않다", () => {
    assert.ok(FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY.length > 0, "빈 열쇠면 아래 읽기/쓰기가 같은 칸을 안 본다");
  });

  test("🔴 한 번도 안 고른 사람은 **보임**이다 — 지금까지와 한 글자도 달라지면 안 된다", () => {
    assert.equal(parseFieldStepGhostVisibility(null), true);
    assert.equal(parseFieldStepGhostVisibility(""), true);
    assert.equal(parseFieldStepGhostVisibility("아무 글자"), true, "남이 넣어 둔 글자가 화면을 끄면 안 된다");
    assert.equal(readFieldStepGhostVisibility(fakeStore(), FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY), true);
  });

  test("🔴 **끈 사람만** 숨김이다 — 적힌 \"0\" 하나로 갈린다", () => {
    assert.equal(parseFieldStepGhostVisibility("0"), false);
    assert.equal(parseFieldStepGhostVisibility(" 0 "), false, "앞뒤 공백 때문에 다시 켜지면 안 된다");
    assert.equal(parseFieldStepGhostVisibility("1"), true);
    const store = fakeStore({ [FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY]: "0" });
    assert.equal(readFieldStepGhostVisibility(store, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY), false);
  });

  test("🔴 끄고 다시 열면 **그대로 꺼져 있다** — 쓰고 읽기가 한 바퀴 돈다", () => {
    const store = fakeStore();
    writeFieldStepGhostVisibility(store, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY, false);
    assert.equal(readFieldStepGhostVisibility(store, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY), false);
    writeFieldStepGhostVisibility(store, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY, true);
    assert.equal(readFieldStepGhostVisibility(store, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY), true);
    // 🔵 「보임」일 때도 칸을 지우지 않는다 — 안 고른 사람과 다시 켠 사람을 갈라 둔다.
    assert.equal(store.data.get(FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY), "1");
  });

  test("🔴 저장소가 없거나 **손대는 것 자체가 터져도** 안 던진다 — 편집기 전체가 죽는다", () => {
    const throwing = {
      getItem(): string | null {
        throw new Error("사생활 보호 창");
      },
      setItem(): void {
        throw new Error("저장 공간이 꽉 찼다");
      },
    };
    assert.equal(readFieldStepGhostVisibility(null, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY), true);
    assert.equal(readFieldStepGhostVisibility(throwing, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY), true, "못 읽으면 보임이다");
    assert.doesNotThrow(() => writeFieldStepGhostVisibility(null, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY, false));
    assert.doesNotThrow(() => writeFieldStepGhostVisibility(throwing, FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY, false));
  });

  test("🔴 끌 때 넘기는 **빈 한 벌의 신원이 늘 같다** — 매번 새로 만들면 그림의 「전과 똑같다」 보증이 깨진다", () => {
    assert.deepEqual(EMPTY_FIELD_STEP_GHOST_GRAPH, { nodes: [], edges: [] });
    // 아직 안 넣은 것이 하나도 없을 때도 **같은 것**이 나온다(한 곳에서만 만든다).
    const empty = buildGhostGraph({ steps: [step({ executionNodeId: "a", adoptedNodeId: "draft-a" })], anchorPositions: new Map() });
    assert.equal(empty, EMPTY_FIELD_STEP_GHOST_GRAPH, "신원까지 같아야 한다 — deepEqual 로는 이 차이가 안 잡힌다");
    // 반대쪽 표본 — 유령이 있으면 당연히 다른 것이 나온다(위 단언이 늘 참이 아니라는 증거).
    const notEmpty = buildGhostGraph({ steps: [step({ executionNodeId: "b" })], anchorPositions: new Map() });
    assert.notEqual(notEmpty, EMPTY_FIELD_STEP_GHOST_GRAPH);
  });
});
