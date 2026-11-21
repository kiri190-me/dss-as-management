import type { PendingStructuralOperation } from "./procedure-editor-structural-changes";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — **노드를 지우면 붙은 연결선도 함께 지운다** (2026-11-21)
 * ============================================================================
 * 쓰는 분의 결정(원문): 「노드를 지우면 연결된 연결선도 함께 지워지는 걸로 하자 —
 * 연결선을 지우지 않아도 노드를 지울 수 있도록.」
 *
 * 그 전까지 화면은 **선이 붙은 노드를 못 지우게 막았다**(화면의
 * selectedNodeDeleteBlockedReason — 「연결선 N개가 붙어 있어 삭제할 수 없습니다.
 * 그 연결선을 먼저 지워 주세요.」). 사람이 선을 하나씩 먼저 지우고 나서야 노드를
 * 지울 수 있었다. 이 모듈이 그 손일을 대신한다 — **붙은 선의 삭제와 노드의 삭제를
 * 한 묶음으로** 적어 낸다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 서버는 한 글자도 안 바꿨다 — 차례가 그 규칙을 지킨다
 * ──────────────────────────────────────────────────────────────────────────
 * deleteProcedureTemplateNode 는 **여전히** 선이 붙은 노드를
 * NODE_HAS_CONNECTED_EDGES 로 거절한다(db/mutations/procedure-template-editor.ts).
 * 막음을 걷어낼 수 있는 까닭은 그 규칙이 없어져서가 아니라, 모아 둔 구조 변경을
 * 보내는 차례(procedure-editor-structural-changes.ts 의
 * PROCEDURE_STRUCTURAL_PHASE_ORDER)가 **DELETE_EDGE(3단계) → DELETE_NODE(6단계)**
 * 이기 때문이다. 선이 먼저 지워진 뒤에 노드가 가므로 서버가 받을 때는 이미 아무
 * 선도 안 붙어 있다.
 *
 * 🔴 그래서 **그 차례가 이제 이 기능을 떠받친다.** 둘의 앞뒤를 뒤집으면 이 기능의
 * 모든 삭제가 [저장]에서 NODE_HAS_CONNECTED_EDGES 로 실패한다. 아래 시험
 * (procedure-editor-node-deletion.test.ts ④절)이 접기·차례를 통과시킨 결과에서
 * 「선이 전부 노드보다 앞인가」를 값으로 잰다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 **어느 목록에서 붙은 선을 찾는가** — 서버 목록이 아니라 **그려진 목록**이다
 * ──────────────────────────────────────────────────────────────────────────
 * 화면은 두 목록을 들고 있다. `template.edges`(서버가 준 것)와
 * `renderedEdges`(= structuralPreview.edges 에 저장 전 변경을 얹은 것, 그림과
 * 패널이 실제로 그리는 그것). 받는 쪽은 **뒤엣것**이어야 한다. 까닭 셋이고 셋 다
 * 서버 목록으로는 틀린 답이 나온다.
 *
 *  ① **저장 전에 그은 선**(tmp:edge:N)은 서버 목록에 아예 없다. 빠뜨리면 그 선이
 *     지워질 노드에 매달린 채 남아, 접기가 ENDPOINT_DELETED_IN_SAME_SAVE 를
 *     conflict 로 올려 **[저장]이 통째로 막힌다**(조각 1 의 관문). 고치려던 일이
 *     더 나쁜 꼴로 돌아오는 셈이다.
 *  ② **이미 지우기로 쌓아 둔 선**은 미리보기에서 **이미 빠져 있다.** 그래서 같은
 *     선을 두 번 쌓는 일이 애초에 일어나지 않는다. 🔵 설령 쌓인다 해도 접기의
 *     DUPLICATE_DELETE 가 받아 한 줄로 만든다(같은 시험 ⑤절이 둘 다 잰다) —
 *     다만 그 그물에 기대지 않는다. 사람이 보고 있는 그림과 보낼 목록이 어긋나는
 *     순간 「몇 개가 함께 지워지는가」라는 화면의 숫자부터 거짓이 된다.
 *  ③ **저장 전에 옮긴 선**(RETARGET_EDGE)은 양 끝이 서버 목록과 다르다. 서버
 *     목록으로 세면 **이 노드에서 떠난 선을 지우고, 이 노드로 옮겨 온 선은
 *     남긴다** — 둘 다 사람이 시킨 적 없는 일이고, 남은 쪽은 다시 서버 거절이다.
 *
 * 🔵 화면의 renderedEdges 는 structuralPreview.edges 를 1:1 로 옮기며 분기 유형 ·
 *    라벨 · 경로점만 덮어쓴다 — **id 와 양 끝은 건드리지 않는다.** 둘 중 어느 것을
 *    넘겨도 답이 같지만, 화면은 「함께 지워질 수」를 보이는 자리와 같은 목록을
 *    쓴다(두 수가 갈리면 사람이 본 숫자가 거짓말이 된다).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔵 왜 순수 함수로 떼어 내는가
 * ──────────────────────────────────────────────────────────────────────────
 * 편집기 화면은 @xyflow/react 의 .css 와 서버 액션(→ server-only)을 사슬로 물고
 * 있어 어느 시험 목록에서도 import 자체가 던진다. 판정이 화면 안에 있으면
 * 「원본 글자가 거기 있는가」로밖에 못 재는데, 이 기능에서 틀릴 수 있는 것은 글자가
 * 아니라 **값**이다(몇 개가 잡히는가 · 차례가 맞는가 · 겹치면 어떻게 되는가).
 * 이웃 procedure-editor-delete-key.ts 가 같은 사정에서 같은 모양으로 떨어져 나왔다.
 */

/**
 * 붙은 선을 찾는 데 **필요한 칸만** 받는다. 화면의 EditorEdgeRow 는 칸이 아홉이고
 * db/queries 타입을 물고 있어, 그대로 받으면 이 모듈과 시험이 그 사슬을 함께 문다.
 */
export type NodeDeletionEdge = {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
};

/**
 * 이 노드에 **한쪽 끝이라도 닿아 있는** 연결선의 id. 차례는 받은 목록 그대로다
 * (그림이 그린 차례 = 사람이 보고 있는 차례).
 *
 * 🔵 들어오는 선과 나가는 선을 **안 가른다.** 어느 쪽이든 노드가 사라지면 매달릴
 *    곳이 없어지고, 서버의 거절도 방향을 안 가린다(blockingEdgeIds 가 양쪽을
 *    함께 센다).
 * 🔵 자기 자신으로 가는 선(from === to === nodeId)은 **한 번만** 잡힌다 — 선 하나에
 *    한 번 묻기 때문이다. 서버는 그런 선을 거절하지만, 저장 **전**에는 그릴 수
 *    있으므로(값 검증은 서버 몫 — 조각 1 머리말) 미리보기에 실제로 서 있을 수 있다.
 */
export function findEdgesAttachedToNode(edges: readonly NodeDeletionEdge[], nodeId: string): string[] {
  const attached: string[] = [];
  for (const edge of edges) {
    if (edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId) continue;
    attached.push(edge.id);
  }
  return attached;
}

/**
 * 노드 하나를 지우려 할 때 **모아 둘 줄 전부**. 붙은 선의 DELETE_EDGE 들이 먼저,
 * 노드의 DELETE_NODE 가 마지막이다.
 *
 * 🔴 **한 번에 돌려주는 것이 핵심이다.** 화면의 queueStructural 은 목록을 고치기
 * 전에 되돌리기 한 칸을 찍고, 받은 **배열을 통째로** 목록 뒤에 붙인다
 * (appendPendingStructuralOperations). 그래서 이 함수가 돌려준 N+1 줄이 [이전]
 * **한 칸**이 된다 — 노드와 선들이 함께 되살아난다. 선을 따로 쌓도록 쪼개 부르면
 * [이전]을 선 수만큼 더 눌러야 노드가 돌아온다.
 *
 * 🔵 줄 **안**의 차례(선 먼저)는 보내는 차례와는 별개다 — 보낼 때는
 * planProcedureStructuralSteps 가 갈래별로 다시 세운다. 그래도 같은 차례로 적는
 * 까닭은 둘이다. ① 미리보기는 **사람이 누른 차례 그대로** 얹으므로, 선을 먼저
 * 걷는 쪽이 「선을 걷고 노드를 뺀다」는 사람 머릿속 그림과 같다(결과는 어느
 * 차례로도 같다 — 둘 다 사라진다). ② 차례 세우기가 언젠가 바뀌어도 이 배열 자체는
 * 이미 서버가 받을 수 있는 차례다.
 *
 * 🔵 **사유는 선에도 같은 것이 실린다.** 서버는 조작마다 이력 한 줄을 남기는데,
 * 그 선이 왜 사라졌는지에 대한 답은 노드 삭제 사유 말고 없다. 빈 사유로 두면
 * 이력에서 「누가 왜 지웠는지 모르는 선 N개」가 된다. 🔵 사유 칸은 애초에
 * 「선택」이라(패널의 `placeholder="삭제 사유 (선택)"`) 대개 null 이 실린다.
 */
export function planProcedureNodeDeletionOperations(
  edges: readonly NodeDeletionEdge[],
  nodeId: string,
  reason: string | null
): PendingStructuralOperation[] {
  const attachedEdgeIds = findEdgesAttachedToNode(edges, nodeId);
  return [
    ...attachedEdgeIds.map((edgeId): PendingStructuralOperation => ({ kind: "DELETE_EDGE", edgeId, reason })),
    { kind: "DELETE_NODE", nodeId, reason },
  ];
}
