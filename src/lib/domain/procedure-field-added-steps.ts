import { ADDED_NODE_GAP_X, ADDED_NODE_GAP_Y } from "./procedure-execution-layout";
import type { ProcedureBranchType, ProcedureNodeType } from "./procedure-template-types";

/**
 * ============================================================================
 * 현장에서 더한 단계를 **절차에 넣을까요?** — 고르고 · 희미하게 그리고 · 셈한다
 * ============================================================================
 * 사용자 결정(2026-11-02): 「원본 절차를 편집할 때, 이번에 만들었던 단계를
 * 희미하게 표시해주고, 적용할 것인지 묻도록 하자」.
 *
 * 수리 건을 진행하다 그 자리에서 더한 작업·연결은 **그 건에만** 산다
 * (procedure_case_execution_nodes 중 procedure_template_node_id 가 빈 줄 ·
 * procedure_case_execution_edges). 원본 절차는 한 글자도 안 바뀐다. 이 파일은
 * 그렇게 쌓인 것을 **초안 편집기 화면이 읽을 수 있는 모양**으로 접는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 「넣었다」를 기억하는 자리가 **node_code** 다
 * ──────────────────────────────────────────────────────────────────────
 * 채택하면 만들어지는 절차 노드의 node_code 가 `field-<그 실행 노드 id>` 다.
 * 따로 표를 만들지 않았다(2026-11-03 사용자 결정 — 스키마 0). 그래도 「두 번
 * 묻지 않기」가 지켜지는 까닭 넷:
 *
 *  1. node_code 는 이미 **그런 쓰임**이다 — 손으로 만든 노드가 `manual-<id>` 다
 *     (procedure-template-editor.ts 의 createProcedureTemplateNode).
 *  2. unique(procedure_template_id, node_code) 가 **같은 것을 두 번 넣는 일을
 *     DB 에서** 막는다. 화면이 잊어도 막힌다.
 *  3. **판본을 넘어 따라간다.** createNewDraftVersion 이 node_code 를 그대로
 *     복제하고, 그 값이 옛 id → 새 id 를 잇는 열쇠다. v2 에서 넣은 단계는
 *     v3·v4 초안에서 다시 안 물어본다.
 *  4. node_code 의 앞글자를 보고 **동작을 가르는 코드가 하나도 없다**(실측
 *     2026-11-03: `nodeCode.startsWith`·`nodeCode.split` 이 src 에 없다). 그래서
 *     `field-` 를 더해도 기존 동작이 한 글자도 안 바뀐다.
 *
 * 🔴 **「안 넣기로 했다」는 기억하지 않는다**(같은 결정). 적을 자리가 없고, 새
 * 표를 만들지 않기로 했다. 그래서 안 넣은 단계는 편집기를 열 때마다 그대로
 * 남는다 — **그 사실이 화면 설계를 묶는다: 창(모달)으로 띄우면 안 된다.** 열
 * 때마다 창이 뜨면 그것이 바로 「두 번 묻는」 것이다. 접힌 패널과 탭의 숫자
 * 딱지로만 알린다(FieldAddedStepsPanel).
 *
 * 🔵 채택한 노드를 나중에 지우면 표식도 함께 사라져 **다시 물어본다.** 일부러
 * 그대로 둔 성질이다 — 사람이 뺀 것은 다시 권할 만하다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 왜 자리 계산까지 여기 있는가
 * ──────────────────────────────────────────────────────────────────────
 * 유령 칸이 어디에 서는지는 **DB 도 그림도 아닌 규칙**이다. 순수 함수로 두면
 * `npm test` 로 잴 수 있고, 그림(ProcedureFlowGraph)은 받은 값을 그리기만 하면 된다.
 *
 * 🔴 **2026-11-04 에 그 규칙의 한 갈래가 뒤집혔다.** 여기에는 「유령은 원본 절차의
 * 자동 배치 계산에 섞이지 않는다 — 섞으면 자리 값 없는 기존 노드가 유령 때문에
 * 움직인다」고 적혀 있었다. 그 전제가 틀렸다: 움직이는 것은 유령 탓이 아니라
 * **노드가 하나 느는 것** 자체이고, 유령을 빼 두면 그 움직임이 「넣기」를 누른 뒤로
 * 미뤄질 뿐이었다. 게다가 유령만 저장 좌표계에 서서 미리 보기가 엉뚱한 자리였다.
 * 사용자 결정(「A로 가자」)으로 **유령도 자동 배치에 함께 세운다** — 까닭과 그 대가는
 * procedure-auto-layout.ts 머리말에.
 *
 * 그래서 아래 buildFieldStepGhostGraph 가 세는 x/y 는 이제 **받침**이다(자동 배치를
 * 안 쓰는 절차와, 사람이 현장에서 끌어다 놓은 자리). 자동 배치를 쓰는 절차에서는
 * 그림이 computeProcedureAutoLayout 의 값을 쓴다.
 * ============================================================================
 */

/** 채택된 절차 노드의 node_code 앞글자. 🔴 이 저장소에서 이 값을 아는 곳은 여기 하나다. */
export const FIELD_STEP_NODE_CODE_PREFIX = "field-";

/** 유령 칸의 그림 위 id 앞글자 — 진짜 노드 id(UUID)와 절대 안 겹친다. */
export const FIELD_STEP_GHOST_NODE_ID_PREFIX = "field-ghost::";

/** 유령 연결선의 그림 위 id 앞글자. */
export const FIELD_STEP_GHOST_EDGE_ID_PREFIX = "field-ghost-edge::";

/** 채택했을 때 절차 노드가 가질 node_code. 쓰기 쪽(뮤테이션)과 읽기 쪽(조회)이 **이 함수 하나**를 쓴다. */
export function fieldStepNodeCode(executionNodeId: string): string {
  return `${FIELD_STEP_NODE_CODE_PREFIX}${executionNodeId}`;
}

/**
 * node_code 에서 실행 노드 id 를 되뽑는다. 현장 단계에서 온 노드가 아니면 null.
 *
 * 🔵 `field-` 로 시작하기만 하면 되는 것이 아니라 **뒤가 비어 있지 않아야** 한다.
 * 사람이 손으로 `field-` 하나만 적어 둔 노드가 있어도 현장 단계로 읽히지 않는다.
 */
export function parseFieldStepNodeCode(nodeCode: string): string | null {
  if (!nodeCode.startsWith(FIELD_STEP_NODE_CODE_PREFIX)) return null;
  const rest = nodeCode.slice(FIELD_STEP_NODE_CODE_PREFIX.length);
  return rest.length > 0 ? rest : null;
}

export function fieldStepGhostNodeId(executionNodeId: string): string {
  return `${FIELD_STEP_GHOST_NODE_ID_PREFIX}${executionNodeId}`;
}

/**
 * 현장 단계의 **이웃 한 쪽** — 「이 작업 앞/뒤에 무엇이 있었나」.
 *
 * 🔴 셋 중 하나다: ① 이 초안에 그대로 있는 절차 노드(draftNodeId 가 찬다) ②
 * 또 다른 현장 단계(fieldStepExecutionNodeId 가 찬다) ③ **둘 다 비었다** — 그
 * 상대가 원본 절차에는 있었는데 이 초안에서 지워졌다는 뜻이다. ③ 을 ① 과 같이
 * 다루면 「이을 곳이 없는데 잇겠다고 하는」 줄이 생긴다.
 */
export type FieldStepNeighbor = {
  draftNodeId: string | null;
  fieldStepExecutionNodeId: string | null;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
};

/** 한 줄 = 현장에서 더한 작업 하나. 조회(getFieldAddedStepsForDraft)가 만들어 준다. */
export type FieldAddedStep = {
  executionNodeId: string;
  /** 채택하면 쓰일 node_code — 조회가 fieldStepNodeCode 로 미리 채워 넘긴다. */
  nodeCode: string;
  title: string;
  instructions: string | null;
  nodeType: ProcedureNodeType;
  /** 현장에서 사람이 끌어다 놓은 자리. 둘 다 차 있을 때만 쓴다(반쪽은 자리가 아니다). */
  userPositionX: number | null;
  userPositionY: number | null;
  /** 이미 이 초안에 들어가 있으면 그 절차 노드 id. 비어 있으면 아직 안 넣은 것. */
  adoptedNodeId: string | null;
  incoming: FieldStepNeighbor[];
  outgoing: FieldStepNeighbor[];
  /** 어느 접수 건에서 나왔나(사람이 판단할 근거). 건이 완전 삭제됐으면 null. */
  intakeNumber: string | null;
  /** 어느 판본을 돌리다 더했나 — v1 에서 나온 것이 v3 초안에 보이는 일이 정상이다. */
  sourceTemplateVersion: number;
  addedAt: string;
  addedByName: string | null;
};

export function isFieldStepAdopted(step: FieldAddedStep): boolean {
  return step.adoptedNodeId !== null;
}

/** 아직 안 넣은 것만. 🔴 탭의 숫자 딱지와 유령 칸이 **같은 목록**을 봐야 「패널엔 3인데 그림엔 2」가 안 생긴다. */
export function pendingFieldSteps(steps: readonly FieldAddedStep[]): FieldAddedStep[] {
  return steps.filter((s) => !isFieldStepAdopted(s));
}

export function adoptedFieldSteps(steps: readonly FieldAddedStep[]): FieldAddedStep[] {
  return steps.filter(isFieldStepAdopted);
}

export type GraphPoint = { x: number; y: number };

/** 그림이 그대로 그리는 유령 칸 하나. ProcedureFlowGraph 의 ghostNodes 프롭이 받는 모양이다. */
export type FieldStepGhostNode = {
  id: string;
  nodeType: ProcedureNodeType;
  title: string;
  subtitle: string | null;
  /**
   * 🔵 **받침 자리**다(2026-11-04). 자동 배치를 쓰는 절차(기술작업절차)에서는
   * 그림이 이 값 대신 computeProcedureAutoLayout 이 센 자리에 그린다. 아래
   * hasUserPosition 이 참이면 이 x/y 가 곧 사람이 정한 자리이고, 그때는 자동
   * 배치를 쓰는 절차에서도 이 값이 그대로 쓰인다(채택도 같은 값을 적는다).
   */
  x: number;
  y: number;
  /**
   * 🔴 채택하면 받게 될 **sort_order**. adoptFieldAddedStep 이 이 초안의 최댓값
   * +1 을 적는다. 자동 배치에서 **뿌리의 가로 차례**가 이 번호로 정해지므로,
   * 값이 어긋나면 켠 그림과 넣은 뒤 그림이 좌우로 갈린다.
   */
  sortOrder: number;
  /**
   * 현장에서 **사람이 끌어다 놓은 자리**가 있는가. 참이면 위 x/y 가 그 자리이고,
   * 채택은 그것을 user_position_x/y 로 그대로 적는다 — 자동 배치는 그런 칸을
   * 밀지 않는다(pinned). 거짓이면 자리는 자동 배치가 정한다.
   */
  hasUserPosition: boolean;
};

export type FieldStepGhostEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel: string | null;
};

export type FieldStepGhostGraph = {
  nodes: FieldStepGhostNode[];
  edges: FieldStepGhostEdge[];
};

/** 유령 칸에 적는 꼬리말 — 그림만 보고도 「아직 절차에 없는 것」임을 알아야 한다. */
export const FIELD_STEP_GHOST_SUBTITLE = "현장에서 더한 단계 (아직 절차에 없음)";

/**
 * 유령이 하나도 없을 때의 **한 벌**.
 *
 * 🔴 매번 `{ nodes: [], edges: [] }` 를 새로 만들면 안 된다. 그림이 「유령이 없으면
 * 간선 배열의 **신원까지** 그대로」로 전과 같음을 보증하는데(ProcedureFlowGraph 의
 * flowEdgesWithGhosts), 빈 배열의 신원이 매번 바뀌면 그 위의 memo 들이 매 렌더마다
 * 다시 돈다. 숨기기(아래)와 「아직 안 넣은 것이 없다」가 **같은 값**을 쓰도록
 * 여기 한 곳에 둔다.
 */
export const EMPTY_FIELD_STEP_GHOST_GRAPH: FieldStepGhostGraph = { nodes: [], edges: [] };

/**
 * 아직 안 넣은 현장 단계를 **그림 위 유령 칸·선**으로 편다.
 *
 * `anchorPositions` 는 이 초안 노드들의 **저장된 자리**다(편집기의
 * workingLayoutPositions — 저장된 자리 + 끌고 있는 자리를 합친 것).
 *
 * 자리를 정하는 규칙은 실행 화면이 쓰는 것과 **같은 셋**이다
 * (procedure-case-execution.ts 의 placeAddedGraphNodes):
 *   ① 현장에서 사람이 끌어다 놓은 자리가 있으면 그대로 — 세지 않는다.
 *   ② 없으면 **앞 칸의 오른쪽**, 같은 앞 칸에 둘이 붙으면 아래로 내린다.
 *   ③ 앞 칸도 없으면 그림의 가장 오른쪽 바깥에 위에서부터 쌓는다.
 *
 * 🔴 **②③ 은 「자동 배치를 안 쓰는 절차」의 받침이다**(2026-11-04 에 뜻이 바뀌었다).
 * 자리 값이 없는 노드를 기술작업절차의 그림은 제 나름의 자동 배치로 그리고
 * (ProcedureFlowGraph 의 useAutoLayoutForUnpositionedNodes — 개발 DB 의 초안은
 * 22개 중 0개 · 28개 중 1개만 자리 값이 차 있다), 거기서는 유령도 **그 자동 배치에
 * 함께 세운다**(사용자 결정 「A로 가자」). 그래서 ②③ 이 센 x/y 는 그 절차에서는
 * 안 쓰인다 — 자동 배치를 안 켠 절차(엑셀에서 들여온 것)에서만 쓰인다.
 *
 * 🔴 **채택 쪽(adoptFieldAddedStep)과 값이 같은 것은 ① 뿐이다** — 그리고 ① 은
 * 이제 「값이 같다」를 넘어 **그려지는 자리까지 같다**: 양쪽 다 user_position 을
 * 그대로 쓰고, 자동 배치는 그런 칸을 밀지 않는다(hasUserPosition → pinnedX).
 * ②③ 쪽은 채택이 자리 값을 **안 적어**(position_x=0 · position_y=맨 아래+150,
 * user_position 은 null) 그림이 알아서 세우게 두는데, 유령도 같은 자동 배치를
 * 타므로 **그 자리가 서로 같다**(procedure-auto-layout.test.ts 가 값으로 지킨다).
 *
 * 🔵 ② 의 앞 칸은 **또 다른 현장 단계**일 수도 있다(사슬). 그래서 차례대로 돌며
 * 이미 자리를 정한 유령도 앞 칸으로 쓴다 — 차례가 흔들리면 같은 입력에서 다른
 * 그림이 나오므로, 정렬은 「더한 때 → id」로 못 박는다.
 *
 * 🔴 **이 초안에 없는 이웃은 선을 안 긋는다.** React Flow 는 한쪽 끝이 없는 선을
 * 받으면 경고만 내고 조용히 안 그린다 — 여기서 걸러야 「패널은 연결 2개라는데
 * 그림엔 1개」가 안 생긴다.
 */
export function buildFieldStepGhostGraph(params: {
  steps: readonly FieldAddedStep[];
  anchorPositions: ReadonlyMap<string, GraphPoint>;
  /**
   * 🔴 **첫 채택이 받게 될 sort_order**(= 이 초안 노드들의 최댓값 + 1). 기본값을
   * 두지 않는다 — 넘기는 것을 잊으면 컴파일이 멈춰야 한다. 조용히 0 이 들어가면
   * 유령이 뿌리들의 **맨 앞**에 서고, 넣고 나면 맨 뒤로 건너뛴다.
   *
   * 🔵 여럿이면 넣는 차례대로 +1 씩 간다. 아래 ordered(더한 때 → id) 차례를 쓰는데,
   * 사람이 다른 차례로 넣으면 번호가 바뀌어 **뿌리로 서는 유령들끼리는** 좌우가
   * 서로 바뀔 수 있다. 앞 칸이 있는 유령(거의 전부)은 영향을 안 받는다.
   */
  nextSortOrder: number;
}): FieldStepGhostGraph {
  const pending = pendingFieldSteps(params.steps);
  if (pending.length === 0) return EMPTY_FIELD_STEP_GHOST_GRAPH;

  const ordered = [...pending].sort((a, b) => {
    if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? -1 : 1;
    return a.executionNodeId < b.executionNodeId ? -1 : a.executionNodeId > b.executionNodeId ? 1 : 0;
  });

  let rightmostX = 0;
  for (const point of params.anchorPositions.values()) {
    if (point.x > rightmostX) rightmostX = point.x;
  }

  const placed = new Map<string, GraphPoint>();
  const siblingCountByAnchor = new Map<string, number>();
  let floatingCount = 0;
  const nodes: FieldStepGhostNode[] = [];

  /** 이웃이 가리키는 **그림 위 자리**. 이 초안에 없으면 null. */
  const resolveNeighborGraphId = (neighbor: FieldStepNeighbor): string | null => {
    if (neighbor.draftNodeId) return neighbor.draftNodeId;
    if (neighbor.fieldStepExecutionNodeId && pending.some((s) => s.executionNodeId === neighbor.fieldStepExecutionNodeId)) {
      return fieldStepGhostNodeId(neighbor.fieldStepExecutionNodeId);
    }
    return null;
  };

  for (const [index, step] of ordered.entries()) {
    const ghostId = fieldStepGhostNodeId(step.executionNodeId);
    let point: GraphPoint;
    const hasUserPosition = step.userPositionX !== null && step.userPositionY !== null;

    if (step.userPositionX !== null && step.userPositionY !== null) {
      point = { x: step.userPositionX, y: step.userPositionY };
    } else {
      // 앞 칸 — 들어오는 선 가운데 **자리를 아는 첫째**.
      let anchorPoint: GraphPoint | null = null;
      let anchorKey: string | null = null;
      for (const neighbor of step.incoming) {
        const graphId = resolveNeighborGraphId(neighbor);
        if (!graphId) continue;
        const known = params.anchorPositions.get(graphId) ?? placed.get(graphId) ?? null;
        if (known) {
          anchorPoint = known;
          anchorKey = graphId;
          break;
        }
      }
      if (anchorPoint && anchorKey) {
        const sibling = siblingCountByAnchor.get(anchorKey) ?? 0;
        siblingCountByAnchor.set(anchorKey, sibling + 1);
        point = { x: anchorPoint.x + ADDED_NODE_GAP_X, y: anchorPoint.y + sibling * ADDED_NODE_GAP_Y };
      } else {
        point = { x: rightmostX + ADDED_NODE_GAP_X, y: floatingCount * ADDED_NODE_GAP_Y };
        floatingCount += 1;
      }
    }

    placed.set(ghostId, point);
    nodes.push({
      id: ghostId,
      nodeType: step.nodeType,
      title: step.title,
      subtitle: FIELD_STEP_GHOST_SUBTITLE,
      x: point.x,
      y: point.y,
      sortOrder: params.nextSortOrder + index,
      hasUserPosition,
    });
  }

  const edges: FieldStepGhostEdge[] = [];
  const seen = new Set<string>();
  const pushEdge = (fromNodeId: string, toNodeId: string, neighbor: FieldStepNeighbor) => {
    const id = `${FIELD_STEP_GHOST_EDGE_ID_PREFIX}${fromNodeId}__${toNodeId}__${neighbor.branchType}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, fromNodeId, toNodeId, branchType: neighbor.branchType, branchLabel: neighbor.branchLabel });
  };

  for (const step of ordered) {
    const ghostId = fieldStepGhostNodeId(step.executionNodeId);
    for (const neighbor of step.incoming) {
      const from = resolveNeighborGraphId(neighbor);
      if (from) pushEdge(from, ghostId, neighbor);
    }
    for (const neighbor of step.outgoing) {
      const to = resolveNeighborGraphId(neighbor);
      if (to) pushEdge(ghostId, to, neighbor);
    }
  }

  return { nodes, edges };
}

/**
 * 패널 한 줄이 사람에게 보여 줄 셈 — 「넣으면 연결 몇 개가 함께 생기고, 몇 개는
 * 못 잇는가」.
 *
 * 🔴 **못 잇는 것을 따로 세는 까닭**: 그 상대는 원본 절차에 있었는데 이 초안에서
 * 지워진 노드다. 말 안 하고 넣으면 「연결도 같이 올 줄 알았는데 안 왔다」가 된다.
 * 넣는 것 자체는 막지 않는다 — 작업만 들어오고 선은 사람이 다시 긋는 것이 맞다.
 */
export type FieldStepAdoptionSummary = {
  /** 이 초안에 끝이 살아 있어 함께 그어질 선의 수. */
  connectableEdgeCount: number;
  /** 끝이 이 초안에 없어 못 그을 선의 수. */
  danglingEdgeCount: number;
  /** 상대가 **아직 안 넣은 다른 현장 단계**라 지금은 못 긋는 선의 수(그쪽을 먼저 넣으면 된다). */
  waitingOnOtherFieldStepCount: number;
};

/**
 * ============================================================================
 * 「현장 단계」를 그림에서 **한 번에 끄고 켜기** (2026-11-04)
 * ============================================================================
 * 사용자 결정 — 「편집기에서 [현장 단계]를 모두 비가시 처리할 수 있는 기능을
 * 넣어줘」.
 *
 * ── 🔴 끄는 것은 **그림의 유령**이지 「현장 단계가 있다는 사실」이 아니다 ──
 * 탭과 딱지 숫자는 꺼도 그대로 남는다. 탭까지 같이 숨기면 꺼 둔 사람은 **새
 * 현장 단계가 생긴 것을 영영 모른다** — 그리고 「안 넣기로 했다」를 기억하지
 * 않기로 한 설계(이 파일 머리말)에서 그 알림은 탭의 숫자 딱지 하나뿐이다.
 * 끈 상태에서도 패널의 [절차에 넣기]는 그대로 눌린다(넣으면 진짜 노드가 되어
 * 당연히 보인다 — 유령이 아니므로 이 설정과 상관이 없다).
 *
 * ── 🔵 **브라우저에만** 기억한다 ────────────────────────────────────────
 * 「보이기/숨기기」는 사람마다 다른 **보기 상태**다. DB 에 적으면 한 사람이 끈
 * 것이 다른 사람의 화면까지 끄고, 그러려고 표를 하나 더 만드는 셈이 된다(이
 * 줄기는 스키마 0 으로 간다는 결정이 서 있다). 적어 두지 못하는 브라우저
 * (사생활 보호 창)에서도 **이번 방문 동안은** 먹혀야 하므로, 부르는 쪽이 고른
 * 값을 제 안에 들고 있는다(주간보고 가로폭과 같은 길 — weekly-report-table-width).
 *
 * ── 🔴 기본값은 **보임**이다 ────────────────────────────────────────────
 * 한 번도 끈 적 없는 사람에게는 지금까지와 한 글자도 다르지 않아야 한다. 적힌
 * 글자가 없거나 · 빈 글자거나 · 엉뚱한 글자면 전부 「보임」으로 읽는다 — 남이
 * 넣어 둔 글자가 곧바로 화면 상태가 되어서는 안 된다(responsive-list 의
 * useStoredChoice 와 같은 잣대).
 * ============================================================================
 */
export const FIELD_STEP_GHOST_VISIBILITY_STORAGE_KEY = "procedure-editor-field-step-ghosts:visible";

/** `window.localStorage` 처럼 생긴 것. 실물을 직접 안 부르는 까닭은 시험에서 바꿔 끼우기 위해서다. */
export type FieldStepGhostVisibilityStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** 숨겨 둔 사람에게만 적히는 글자. 「보임」은 **아무것도 안 적는** 것이 아니라 "1" 을 적는다(아래 write). */
const FIELD_STEP_GHOST_HIDDEN_VALUE = "0";
const FIELD_STEP_GHOST_VISIBLE_VALUE = "1";

/** 적힌 글자를 보기 상태로 읽는다. **무엇이 적혀 있어도 쓸 수 있는 값이 나온다.** 오직 "0" 만 숨김이다. */
export function parseFieldStepGhostVisibility(raw: string | null): boolean {
  if (raw === null) return true;
  return raw.trim() !== FIELD_STEP_GHOST_HIDDEN_VALUE;
}

/**
 * 적어 둔 보기 상태를 읽는다. **어떤 경우에도 던지지 않는다** — 저장소에 손대는
 * 것 자체가 터지는 브라우저가 있고(사생활 보호 창), 거기서 던지면 유령 하나
 * 때문에 편집기 전체가 죽는다.
 */
export function readFieldStepGhostVisibility(store: FieldStepGhostVisibilityStore | null, storageKey: string): boolean {
  if (!store) return true;
  try {
    return parseFieldStepGhostVisibility(store.getItem(storageKey));
  } catch {
    return true;
  }
}

/**
 * 적어 둔다. 읽기와 같은 까닭으로 **어떤 경우에도 던지지 않는다**(저장 공간이 꽉
 * 찬 경우 포함).
 *
 * 🔵 「보임」일 때 칸을 지우지 않고 "1" 을 적는 까닭: 지우면 「한 번도 안 골랐다」와
 * 「골라서 다시 켰다」가 구별되지 않는다. 지금은 둘 다 보임이라 결과가 같지만,
 * 나중에 기본값을 바꿀 일이 생기면 그때 **이미 켜 둔 사람의 선택을 덮어쓰게** 된다.
 */
export function writeFieldStepGhostVisibility(
  store: FieldStepGhostVisibilityStore | null,
  storageKey: string,
  visible: boolean
): void {
  if (!store) return;
  try {
    store.setItem(storageKey, visible ? FIELD_STEP_GHOST_VISIBLE_VALUE : FIELD_STEP_GHOST_HIDDEN_VALUE);
  } catch {
    // 이번 방문 동안은 화면이 그대로 따라온다(부르는 쪽이 고른 값을 들고 있다).
  }
}

export function summarizeFieldStepAdoption(step: FieldAddedStep, allSteps: readonly FieldAddedStep[]): FieldStepAdoptionSummary {
  const adoptedByExecutionNodeId = new Map(allSteps.filter(isFieldStepAdopted).map((s) => [s.executionNodeId, s.adoptedNodeId!]));
  const knownExecutionNodeIds = new Set(allSteps.map((s) => s.executionNodeId));

  let connectableEdgeCount = 0;
  let danglingEdgeCount = 0;
  let waitingOnOtherFieldStepCount = 0;

  for (const neighbor of [...step.incoming, ...step.outgoing]) {
    if (neighbor.draftNodeId) {
      connectableEdgeCount += 1;
      continue;
    }
    const other = neighbor.fieldStepExecutionNodeId;
    if (other && adoptedByExecutionNodeId.has(other)) {
      connectableEdgeCount += 1;
      continue;
    }
    if (other && knownExecutionNodeIds.has(other)) {
      waitingOnOtherFieldStepCount += 1;
      continue;
    }
    danglingEdgeCount += 1;
  }

  return { connectableEdgeCount, danglingEdgeCount, waitingOnOtherFieldStepCount };
}
