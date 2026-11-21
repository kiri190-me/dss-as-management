import type { ProcedureBranchType, ProcedureNodeType } from "./procedure-template-types";
import type { PendingStructuralOperation, StructuralConflictReason, StructuralOperationConflict } from "./procedure-editor-structural-changes";
import type { Position } from "./procedure-editor-save-state";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — 모아 둔 구조 변경을 **그림에 미리 그린다** (2026-11-20, 조각 4)
 * ============================================================================
 * 조각 1~3 이 만든 것은 전부 「보낼 목록」을 다루는 쪽이었다. 이 모듈은 그 목록을
 * **지금 화면에 보여 주는** 쪽을 맡는다 — 서버가 준 노드·연결선 목록 위에 아직 안
 * 보낸 조작을 차례로 얹어, 사람이 [저장]을 누르기 **전에도** 제가 한 일을 그림에서
 * 보게 한다.
 *
 * 🔴 **이것이 없으면 조각 1~3 이 통째로 안 보인다.** 화면의 renderedNodes/
 * renderedEdges 는 `template.nodes`(서버 목록)만 돌기 때문에, 임시 노드·연결선을
 * 섞어 넣지 않으면 노드를 추가해도 **화면에 아무 일도 안 일어난다.**
 *
 * 🔵 이웃들과 같은 규약이다 — DOM · React · 서버 액션 · DB 를 한 줄도 안 문다.
 * 행의 **모양**(EditorNodeRow 의 칸 스물몇 개)을 여기서 알지 않으려고 만드는 일은
 * 전부 factories 로 밖에 맡긴다. 그래야 이 모듈이 db/queries 타입을 안 물고,
 * 시험이 아주 작은 가짜 행으로 돌 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 **사람이 한 차례 그대로** 얹는다 — 보낼 차례(planProcedureStructuralSteps)가 아니다
 * ──────────────────────────────────────────────────────────────────────────
 * 보낼 차례는 서버의 의존(선이 붙은 노드는 못 지운다 · 중복 연결선 거절)을 피하려고
 * 갈래별로 다시 세운 것이다. 그 차례로 그리면 **사람이 한 일과 다른 그림**이 나온다 —
 * 이를테면 「A→B 를 지우고 다시 A→B 를 긋기」를 보낼 차례로 그리면 지우기가 먼저라
 * 결과는 같지만, 「A→B 를 긋고 다시 지우기」는 보낼 차례에서 지우기가 **먼저** 돌아
 * 선이 남아 버린다. 미리보기는 **사람이 누른 차례**가 유일하게 맞는 차례다.
 *
 * 🔵 접기(coalescePendingStructuralOperations)도 여기서 안 돌린다. 접기는 「보낼 것이
 * 몇 건인가」를 세는 일이고, 그린 결과는 접기 전후가 **같아야** 한다(접기가 결과를
 * 바꾸면 그건 접기 쪽 결함이다). 두 번 돌릴 값이 없다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 가리키는 대상이 없으면 **조용히 건너뛴다**
 * ──────────────────────────────────────────────────────────────────────────
 * 없는 노드를 지우라거나 없는 연결선을 재연결하라는 줄이 들어올 수 있다 — 두 사람이
 * 같은 초안을 고치는 중이거나, 부분 실패 뒤 남은 조작이 가리키던 것이 사라진 경우다.
 * 그릴 때 던지면 **화면 전체가 하얘진다.** 보낼 때는 서버가 제대로 거절하고 그 글이
 * 사람에게 보이므로, 그리는 쪽은 건너뛰는 것이 맞다.
 */

// ==================== ① 새로 그릴 행의 씨앗 ====================

/**
 * 🔵 칸이 **여섯뿐**인 까닭: 서버가 새 노드에 실제로 적는 값이 이것뿐이다
 * (createProcedureTemplateNode — 나머지는 전부 열의 기본값/null 이다). 여기에 칸을
 * 더하면 미리보기가 저장 뒤 모습과 갈린다.
 */
export type StructuralPreviewNodeSeed = {
  /** 임시 id(`tmp:node:N`). 저장이 지나간 뒤에는 진짜 id 가 들어온다. */
  readonly id: string;
  readonly nodeType: ProcedureNodeType;
  readonly title: string;
  /**
   * null 이면 **자리를 안 정한 것**이다 — 서버가 세로로 쌓고, 그림은 제 자동 배치로
   * 그린다. 0,0 으로 떨어뜨리면 안 된다(그 자리에 진짜로 서 있는 노드와 포개진다).
   */
  readonly position: Position | null;
  /** 🔴 **짐작한 값**이다 — 아래 머리말의 「정렬 번호」 절을 볼 것. */
  readonly sortOrder: number;
};

export type StructuralPreviewEdgeSeed = {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly branchType: ProcedureBranchType;
  readonly branchLabel: string | null;
  /** 🔴 **짐작한 값**이다(노드 쪽과 같다). */
  readonly sortOrder: number;
};

/**
 * 행을 **만들고 고치는 일을 밖에 맡긴다.** 이 모듈은 행에 칸이 몇 개 있는지 모른다.
 *
 * 🔴 `changeNodeType`·`retargetEdge` 도 밖으로 뺀 까닭: 부르는 쪽의 행은 읽기 전용
 * 객체(`readonly`)일 수도 있고, 칸 이름이 다를 수도 있다. 여기서 `{...node,
 * nodeType}` 를 적으면 그 순간 이 모듈이 행의 모양을 아는 것이 된다.
 */
export type StructuralPreviewFactories<TNode, TEdge> = {
  readonly createNode: (seed: StructuralPreviewNodeSeed) => TNode;
  readonly createEdge: (seed: StructuralPreviewEdgeSeed) => TEdge;
  readonly changeNodeType: (node: TNode, newNodeType: ProcedureNodeType) => TNode;
  readonly retargetEdge: (edge: TEdge, fromNodeId: string, toNodeId: string) => TEdge;
};

/**
 * 🔴 `sortOrder` 가 **선택 칸**인 까닭 (2026-11-21, 진단 Flowchart 조각 C2).
 *
 * 이 모듈을 「기술 작업 절차」 말고 **진단 Flowchart** 편집기도 쓰게 되었는데,
 * 진단 쪽 표에는 `sort_order` 칸이 **일부러 없다**(repair_case_flowchart_nodes ·
 * repair_case_flowchart_edges — 엑셀 수입도 판 복제도 없는 표라 차례를 따로 들
 * 까닭이 없다는 것이 그 스키마 주석의 까닭이다). 필수로 두면 진단 쪽 행
 * (CaseFlowchartGraphNode)이 `TNode extends MinimalNode` 를 만족하지 못해
 * **컴파일조차 안 된다.**
 *
 * 🔵 절차 쪽 동작은 한 글자도 안 바뀐다 — 절차의 행은 늘 `sortOrder: number` 를
 * 들고 오므로 아래 `?? 0` 이 한 번도 안 선다. 이 칸이 쓰이는 데는 씨앗 번호를
 * 매기는 두 줄뿐이고, 그 값은 **서버로 안 간다**(아래 머리말의 「정렬 번호」 절).
 */
type MinimalNode = { readonly id: string; readonly sortOrder?: number };
type MinimalEdge = { readonly id: string; readonly fromNodeId: string; readonly toNodeId: string; readonly sortOrder?: number };

export type StructuralPreviewGraph<TNode, TEdge> = {
  readonly nodes: TNode[];
  readonly edges: TEdge[];
  /** 이번 미리보기에서 **새로 그려진** 노드의 id. 화면이 「아직 저장 안 된 노드」를 가려내는 잣대다. */
  readonly addedNodeIds: string[];
  /** 이번 미리보기에서 **새로 그려진** 연결선의 id. */
  readonly addedEdgeIds: string[];
};

// ==================== ② 얹기 ====================

/**
 * 서버 목록 위에 모아 둔 조작을 **사람이 한 차례 그대로** 얹는다.
 *
 * ── 🔴 정렬 번호는 **짐작**이다 — 그려 보이기에만 쓰고 보내지 않는다 ───────
 * 서버는 새 노드에 「그 절차에서 가장 큰 번호 + 1」을 매긴다. 여기서도 같은 셈을
 * 하지만 **재는 시점이 다르다**: 서버는 구조 단계 맨 앞(= 노드 지우기가 아직 안 돈
 * 시점)에서 재고, 여기서는 사람이 누른 그 순간의 목록에서 잰다. 그래서 같은 저장
 * 안에서 노드를 지웠다 만들면 두 값이 어긋난다.
 *
 * 🔴 그래서 화면은 이 번호를 **서버로 보내면 안 된다**(조각 2 의
 * includeBrandNewDraftEntries 가 경고한 그 자리다 — 보내면 서버가 방금 매긴 번호를
 * 덮어쓴다). 이 값이 하는 일은 둘뿐이다: 그림의 자동 배치가 뿌리 칸을 가로로
 * 늘어놓는 차례, 그리고 속성 패널의 받침값.
 *
 * ── 🔵 연결선 번호도 같은 성격이다 ───────────────────────────────────────
 * 서버는 **같은 시작 노드에서 나가는 선들 안에서** 번호를 매긴다. 여기서도 그렇게
 * 센다. 값 자체는 화면에 안 보이고 보내지도 않는다.
 */
export function previewPendingStructuralGraph<TNode extends MinimalNode, TEdge extends MinimalEdge>(
  nodes: readonly TNode[],
  edges: readonly TEdge[],
  operations: readonly PendingStructuralOperation[],
  factories: StructuralPreviewFactories<TNode, TEdge>
): StructuralPreviewGraph<TNode, TEdge> {
  const nextNodes: TNode[] = [...nodes];
  const nextEdges: TEdge[] = [...edges];
  const addedNodeIds: string[] = [];
  const addedEdgeIds: string[] = [];

  // 🔵 번호가 없는 행(= 진단 Flowchart 의 노드·연결선)은 **0 으로 친다** — 그 표에는
  //    차례 칸 자체가 없으므로 「맨 뒤 + 1」의 받침으로 0 말고 고를 값이 없다.
  //    절차 쪽은 늘 값이 들어와 이 받침이 한 번도 안 선다.
  const nextNodeSortOrder = () => nextNodes.reduce((max, n) => ((n.sortOrder ?? 0) > max ? (n.sortOrder ?? 0) : max), -1) + 1;
  const nextEdgeSortOrder = (fromNodeId: string) =>
    nextEdges.reduce((max, e) => (e.fromNodeId === fromNodeId && (e.sortOrder ?? 0) > max ? (e.sortOrder ?? 0) : max), -1) + 1;

  const addNode = (seed: StructuralPreviewNodeSeed) => {
    nextNodes.push(factories.createNode(seed));
    addedNodeIds.push(seed.id);
  };
  const addEdge = (seed: StructuralPreviewEdgeSeed) => {
    nextEdges.push(factories.createEdge(seed));
    addedEdgeIds.push(seed.id);
  };

  for (const operation of operations) {
    switch (operation.kind) {
      case "CREATE_NODE":
        addNode({
          id: operation.tempNodeId,
          nodeType: operation.nodeType,
          title: operation.title,
          position: operation.position,
          sortOrder: nextNodeSortOrder(),
        });
        break;

      case "DELETE_NODE": {
        const index = nextNodes.findIndex((n) => n.id === operation.nodeId);
        if (index !== -1) nextNodes.splice(index, 1);
        break;
      }

      case "CHANGE_NODE_TYPE": {
        const index = nextNodes.findIndex((n) => n.id === operation.nodeId);
        if (index !== -1) nextNodes[index] = factories.changeNodeType(nextNodes[index], operation.newNodeType);
        break;
      }

      case "CREATE_EDGE":
        addEdge({
          id: operation.tempEdgeId,
          fromNodeId: operation.fromNodeId,
          toNodeId: operation.toNodeId,
          branchType: operation.branchType,
          branchLabel: operation.branchLabel,
          sortOrder: nextEdgeSortOrder(operation.fromNodeId),
        });
        break;

      case "DELETE_EDGE": {
        const index = nextEdges.findIndex((e) => e.id === operation.edgeId);
        if (index !== -1) nextEdges.splice(index, 1);
        break;
      }

      case "RETARGET_EDGE": {
        const index = nextEdges.findIndex((e) => e.id === operation.edgeId);
        if (index !== -1) nextEdges[index] = factories.retargetEdge(nextEdges[index], operation.newFromNodeId, operation.newToNodeId);
        break;
      }

      case "INSERT_NODE_ON_EDGE": {
        const index = nextEdges.findIndex((e) => e.id === operation.edgeId);
        // 🔴 쪼갤 선이 없으면 **노드도 안 만든다.** 선 없이 노드만 남기면 화면에
        //    외톨이 칸이 서고, 그것은 사람이 시킨 일이 아니다(삽입은 한 덩어리다 —
        //    서버도 한 트랜잭션으로 셋을 함께 한다).
        if (index === -1) break;
        const original = nextEdges[index];
        const originalToNodeId = original.toNodeId;
        addNode({
          id: operation.tempNodeId,
          nodeType: operation.nodeType,
          title: operation.title,
          position: operation.position,
          sortOrder: nextNodeSortOrder(),
        });
        // 🔵 원래 선의 분기 유형·라벨은 **첫 구간에 그대로 남고**, 새로 생기는 둘째
        //    구간은 언제나 기본(DEFAULT)이다 — 서버의 insertProcedureTemplateNodeOnEdge
        //    가 하는 그대로다(「경로점은 길의 생김새지 둘째 판단이 아니다」).
        nextEdges[index] = factories.retargetEdge(original, original.fromNodeId, operation.tempNodeId);
        addEdge({
          id: operation.tempSecondEdgeId,
          fromNodeId: operation.tempNodeId,
          toNodeId: originalToNodeId,
          branchType: "DEFAULT",
          branchLabel: null,
          sortOrder: nextEdgeSortOrder(operation.tempNodeId),
        });
        break;
      }
    }
  }

  return { nodes: nextNodes, edges: nextEdges, addedNodeIds, addedEdgeIds };
}

// ==================== ③ 막힌 까닭을 사람 말로 ====================

/**
 * 🔴 **막는 것만으로는 부족하다.** 조각 1 이 conflicts 로 올리는 넷은 전부 「사람이
 * 화면에서 한 일인데 보낼 수가 없는」 경우라, 까닭을 안 적으면 [저장]이 꺼져 있는
 * 이유를 알 길이 없다(그리고 사람은 그것을 고장으로 읽는다).
 *
 * 🔵 글이 **무엇을 해야 하는지**로 끝나게 적는다 — 「안 됩니다」만 적으면 화면 앞에서
 * 할 수 있는 일이 없다.
 */
export const PROCEDURE_STRUCTURAL_CONFLICT_LABELS: Record<StructuralConflictReason, string> = {
  DANGLING_TEMP_ID: "저장 전에 만든 항목을 가리키는데 그 항목이 목록에 없습니다. [취소]로 저장 전 변경을 비우고 다시 해 주세요.",
  INSERT_ON_UNSAVED_EDGE: "아직 저장하지 않은 연결선 위에는 노드를 끼울 수 없습니다. 먼저 [저장]으로 그 연결선을 저장한 뒤 다시 끼워 주세요.",
  ENDPOINT_DELETED_IN_SAME_SAVE: "이번 저장에서 지워질 노드에 연결선을 걸었습니다. 연결선을 지우거나 노드 삭제를 되돌려 주세요.",
  TEMP_NODE_TYPE_NOT_CREATABLE: "아직 저장하지 않은 노드는 [체크리스트]·[고장 진단표]로 바꿀 수 없습니다. 다른 유형을 고르거나 먼저 [저장]해 주세요.",
};

/** 조작 한 건을 사람 말로. 🔵 막힌 줄이 **어떤 조작**인지까지 말해 줘야 어디를 고칠지 안다. */
export const PROCEDURE_STRUCTURAL_OPERATION_LABELS: Record<PendingStructuralOperation["kind"], string> = {
  CREATE_NODE: "노드 추가",
  DELETE_NODE: "노드 삭제",
  CHANGE_NODE_TYPE: "노드 유형 변경",
  CREATE_EDGE: "연결선 추가",
  DELETE_EDGE: "연결선 삭제",
  RETARGET_EDGE: "연결선 대상 변경",
  INSERT_NODE_ON_EDGE: "연결선 위 노드 끼우기",
};

/** 화면에 그대로 그릴 수 있는 한 줄씩. 🔵 같은 글이 여러 줄 겹쳐도 지우지 않는다 — 막힌 조작이 몇 건인지가 뜻이 있다. */
export function describeStructuralConflicts(conflicts: readonly StructuralOperationConflict[]): string[] {
  return conflicts.map(
    (conflict) => `${PROCEDURE_STRUCTURAL_OPERATION_LABELS[conflict.operation.kind]} — ${PROCEDURE_STRUCTURAL_CONFLICT_LABELS[conflict.reason]}`
  );
}
