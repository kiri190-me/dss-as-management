/**
 * 「기술 작업 절차」 편집기에서 **[Delete] 키를 눌렀을 때 무엇을 지울 것인가**를
 * 정하는 순수 판정. DOM 도 React 도 서버 액션도 DB 도 건드리지 않는다
 * (procedure-editor-undo-plan.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 쓰는 분의 요청 (2026-11-21)
 * ──────────────────────────────────────────────────────────────────────
 * 「노드나 연결선을 지울 때 [DELETE] 키를 눌러서 지울 수 있도록 해 달라.」
 *
 * 지우는 일 자체는 이미 있다 — 오른쪽 속성 패널의 [노드 삭제] · [분기 삭제]다.
 * 그 둘은 2026-11-20(조각 4)부터 **모아 두기**가 되어, 누르면 그림에서만 사라지고
 * 서버로는 화면 위 [저장] 때 나간다. 키로 지우는 것도 **똑같이 그 통로**
 * (handleQueueDeleteNode / handleQueueDeleteEdge → queueStructural)로 들어가므로
 * 되돌리기 · [저장] 모으기 · 나가기 경고가 저절로 따라붙는다. 그래서 이 파일이
 * 정하는 것은 「보낼까 말까」가 아니라 **「지금 키가 가리키는 것이 무엇인가」** 하나다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 순수 함수로 떼어 내는가 — 「단추는 흐린데 키로는 지워진다」를 막는다
 * ──────────────────────────────────────────────────────────────────────
 * 삭제 단추는 흐려지는 조건이 있다. 체크리스트/고장 진단표가 걸린 노드는 서버가
 * 거절하므로 화면이 미리 막아 두었고(화면의 selectedNodeDeleteBlockedReason),
 * 분류가 「기술 작업」이 아니거나 편집 권한이 없으면 삭제 칸 자체가 안 선다
 * (canDeleteGraph).
 *
 * 🔵 2026-11-21 — 그 막음에 **「선이 붙어 있다」가 있었는데 없어졌다**(쓰는 분
 * 결정 — 노드를 지우면 붙은 선도 함께 지워진다). 이 파일은 한 글자도 안 고쳐도
 * 그 결정을 그대로 따른다 — 막힌 까닭을 **제가 세지 않고 받아만 쓰기** 때문이다.
 * 까닭이 null 이 되는 순간 키로도 지워진다. 「두 잣대를 만들지 않는다」가 실제로
 * 값을 치른 자리다.
 *
 * 키가 그 판정을 **다시 적으면** 두 잣대가 생긴다. 한쪽만 고치는 날 「흐린 단추
 * 옆에서 키로는 지워지는」 화면이 되고, 그것은 서버가 [저장]에서 거절할 조작을
 * 목록에 쌓는 길이다(그림에서는 이미 사라져 보이고 한참 뒤 저장이 통째로 막힌다).
 * 그래서 화면은 **단추에 넘기는 그 값 그대로**를 이 함수에 넘기고, 이 함수 하나가
 * 답한다.
 *
 * 🔵 떼어 내는 둘째 까닭은 **잴 수 있어야 하기 때문**이다. 편집기 화면은
 * @xyflow/react 의 .css 와 서버 액션(→ server-only)을 사슬로 물고 있어 어느 시험
 * 목록에서도 import 자체가 던진다 — 이웃들이 전부 「원본 글자로」 재고 있는 까닭이다.
 * 판정만 여기 있으면 **값으로** 잴 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴🔴 글자를 치는 중에는 절대 안 된다
 * ──────────────────────────────────────────────────────────────────────
 * 이 기능이 사고를 낼 수 있는 가장 큰 자리다. 제목 · 설명 · 작업 지시 · **삭제
 * 사유** 칸에 글을 쓰다 [Delete] 를 누르는 것은 「글자 하나 지우기」이지 「노드
 * 지우기」가 아니다. 포커스가 input · textarea · select · contenteditable 안에
 * 있으면 이 판정은 **아무것도 안 한다**(isTextEntryTarget).
 *
 * 🔴 그리고 화면은 그때 preventDefault 도 하면 안 된다 — 하면 글자가 안 지워진다.
 * 그래서 「아무 일도 안 한다」가 NONE 한 갈래로 나오고, 화면은 NONE 이면 이벤트를
 * 손도 안 대고 돌려보낸다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 차례 — **가장 안쪽 것부터** (경로점 → 복수 노드 → 노드 → 연결선)
 * ──────────────────────────────────────────────────────────────────────
 * ① **경로점**(연결선 위의 점)이 고른 상태면 그것부터다. 경로점을 고르는 것은
 *    연결선을 고른 **뒤** 그 위의 점 하나를 다시 고른 것이라 더 안쪽이고,
 *    2026-11-21 이전부터 [Delete]/[Backspace] 가 경로점을 지워 왔다(화면의 그
 *    keydown 이 이 판정의 뿌리다). 여기서 연결선을 지우기로 바꾸면 **지금 그렇게
 *    쓰고 있는 손이 깨진다** — 점 하나 지우려다 선이 통째로 사라진다.
 * ①' **[범위 선택]으로 고른 여럿**이 있으면 그것들이다(2026-11-21, 조각 B3).
 *    단수 노드보다 **앞**에 둔다. 🔵 지금은 둘이 동시에 설 수 없다 — 도구를
 *    바꾸면 그림이 양쪽 선택을 다 비우고(changeCanvasTool), 범위 선택 모드에서는
 *    칸을 눌러도 단수 선택을 한 글자도 안 건드린다. 그래도 차례를 정해 두는
 *    까닭은, 나중에 둘이 같이 설 수 있게 되는 날 **어느 쪽이 이기는지가 코드에
 *    적혀 있어야** 하기 때문이다. 고른 것이 여럿일 때 하나만 지우면 사람은
 *    「나머지는 왜 안 지워졌지」를 묻게 된다.
 * ② **노드**가 고른 상태면 노드다. 화면의 오른쪽 패널도 같은 차례다 —
 *    노드가 고른 상태면 EdgePropertyPanel 은 아예 안 선다(`!selectedNode &&
 *    selectedEdge`). 그러니 「보이는 삭제 단추」도 [노드 삭제] 하나다.
 * ③ 노드가 없고 **연결선**만 고른 상태면 연결선이다.
 *
 * 🔴 ②에서 **막혔으면 ③으로 흘러내리지 않는다.** 체크리스트가 걸려 못 지우는
 * 노드를 고른 채로 키를 누르면 「그 노드에 붙어 있던 선이 대신 지워지는」 것이
 * 되는데, 사람은 노드를 지우려 한 것이고 화면에 떠 있는 단추도 [노드 삭제](흐림)
 * 하나다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 Backspace 로는 노드 · 연결선을 안 지운다 (2026-11-21 쓰는 분 결정)
 * ──────────────────────────────────────────────────────────────────────
 * 「Delete 키만 받는다. Backspace 는 받지 마라.」 — 이 PC 는 윈도우고, Backspace 는
 * 글자를 지우는 키이지 삭제키가 아니다. 나중에 「맥 쓰는 사람을 위해」로 조용히
 * 더하기 쉬운 자리라 시험으로 못 박아 두었다
 * (procedure-editor-delete-key.test.ts ⑥절).
 *
 * 🔵 **경로점 지우기는 이 결정의 대상이 아니다** — 쓰는 분이 말한 것은 「노드나
 * 연결선」이었고, 경로점의 Backspace 는 그 전부터 있던 동작이다. 묻지도 않은 기존
 * 동작을 이 조각에서 걷어낼 까닭이 없다. 그래서 Backspace 는 **경로점까지만**
 * 간다(아래 ①을 지나고 ②③ 앞에서 멈춘다).
 */

/**
 * 「아무 일도 안 한다」의 까닭. 참·거짓이 아니라 까닭을 돌려주는 것은 이 저장소의
 * 규약이고(procedure-editor-undo-plan.ts 머리말), 여기서는 **시험이 갈라 재기
 * 위해서**이기도 하다 — 「안 지워졌다」는 글자 칸 보호가 일한 것일 수도, 권한이
 * 없는 것일 수도, 고른 것이 없어서일 수도 있다. 셋이 한 값이면 보호를 통째로
 * 빼먹어도 다른 까닭으로 통과해 버린다.
 *
 * 🔴 이 까닭은 **화면에 글로 세우지 않는다.** 2026-11-04 · 11-20 에 이 편집기의
 * 상시 안내를 두 번 세웠다 두 번 다 지워 달라는 요청을 받았다(커밋 d57f664a).
 * 막힌 까닭을 사람에게 보이는 자리는 이미 있다 — 삭제 단추 위의 빨간 한 줄이다.
 */
export type ProcedureDeleteKeyReason =
  /** 삭제키가 아예 아니다(a · Escape · 방향키 …). */
  | "NOT_A_DELETE_KEY"
  /** 🔴🔴 글자 칸 안이다 — 화면은 preventDefault 도 하면 안 된다. */
  | "TYPING"
  /** Backspace 다 — 경로점까지만 간다(2026-11-21 결정). */
  | "BACKSPACE_IS_NOT_FOR_GRAPH"
  /** 고른 것이 없다. */
  | "NOTHING_SELECTED"
  /** 지울 권한이 없다(읽기 전용 · 「기술 작업」 분류가 아님). */
  | "NOT_ALLOWED"
  /** 노드를 고르긴 했는데 지금은 못 지운다 — 단추도 흐린 그 상태다. */
  | "NODE_DELETE_BLOCKED";

/**
 * 다음에 할 일 한 가지. 지울 대상의 id 를 **판정이 들고 나온다** — 화면이
 * 「계획은 노드」라고 듣고 제 state 에서 id 를 다시 꺼내면, 그 사이에 선택이
 * 바뀐 경우 엉뚱한 것을 지운다.
 */
export type ProcedureDeleteKeyPlan =
  | { readonly action: "REMOVE_WAYPOINT"; readonly edgeId: string; readonly waypointIndex: number }
  /** [범위 선택]으로 고른 **여럿**. 차례는 화면이 넘긴 그대로(= 그림이 그린 차례)다. */
  | { readonly action: "DELETE_NODES"; readonly nodeIds: readonly string[] }
  | { readonly action: "DELETE_NODE"; readonly nodeId: string }
  | { readonly action: "DELETE_EDGE"; readonly edgeId: string }
  | { readonly action: "NONE"; readonly reason: ProcedureDeleteKeyReason };

export type ProcedureDeleteKeyInput = {
  /** KeyboardEvent.key 그대로. */
  readonly key: string;
  /** 포커스가 글자 칸 안인가 — isTextEntryTarget 로 잰 값. */
  readonly isTypingTarget: boolean;
  /**
   * 경로점을 고칠 수 있는가. 🔵 노드·연결선 삭제와 **잣대가 다르다** — 경로는
   * 「모양」이라 분류와 무관하게 편집 권한만 보고(화면의 canEdit), 삭제는 「기술
   * 작업」 분류에서만 열린다(아래 canDeleteGraph).
   */
  readonly canEdit: boolean;
  /**
   * 노드·연결선을 지울 수 있는가. 🔴 화면이 삭제 패널을 켜는 데 쓰는 바로 그
   * 값(canDeleteGraph = 기술 작업 분류 && 편집 권한)을 그대로 받는다.
   */
  readonly canDeleteGraph: boolean;
  /**
   * 지금 고른 노드의 id. 🔴 **그림에 실제로 그려진 노드**여야 한다(화면은
   * renderedNodes 에서 찾은 것의 id 를 넘긴다). 목록에 없는 id 로 삭제를 쌓으면
   * [저장]이 없는 행을 지우려 들고, 그 상태에서는 속성 패널도 안 서 있어
   * 「단추와 같은 판정」도 성립하지 않는다.
   */
  readonly selectedNodeId: string | null;
  /** 지금 고른 연결선의 id. 위와 같은 까닭으로 **그려진 것**이어야 한다. */
  readonly selectedEdgeId: string | null;
  /** 고른 경로점의 자리(없으면 null). 화면에서 이미 「고른 연결선의 것」으로 걸러진 값이다. */
  readonly selectedWaypointIndex: number | null;
  /**
   * 🔴 노드를 **지금** 못 지우는 까닭(없으면 null). 화면이 [노드 삭제] 단추를
   * 흐리게 하고 빨간 글로 세우는 **그 값 그대로**다 — 여기서 다시 세거나 다시
   * 판정하지 않는다(머리말의 「두 잣대」 절).
   */
  readonly nodeDeleteBlockedReason: string | null;
  /**
   * 🔴 지금 **[범위 선택] 도구로 그림을 보고 있는가**(2026-11-21, 조각 B3).
   * 거짓이면 아래 집합에 무엇이 들어 있든 **쳐다보지 않는다.**
   *
   * 까닭: 점선 네모는 끌 수 있는 그림에서만 산다(`editable && 사용자 배치`).
   * 모드를 벗어나면 고른 집합이 화면에서 **안 보이는데**(그림이 그 모드에서만
   * `selected` 를 싣는다) state 에는 남아 있을 수 있다. 그때 [Delete] 가 보이지도
   * 않는 것을 지우면, 사람은 제가 무엇을 지웠는지 모른다.
   */
  readonly boxSelectActive: boolean;
  /**
   * 🔴 [범위 선택]으로 고른 칸들 — **그림에 실제로 그려진 것만**, 그린 차례대로.
   * 칸마다 **못 지우는 까닭을 함께** 들고 온다. 단수 쪽
   * nodeDeleteBlockedReason 과 **같은 약속**이다: 이 판정은 까닭을 제가 세지
   * 않고 받아만 쓴다(머리말의 「두 잣대」 절). 화면은 노드마다
   * resolveProcedureNodeDeleteBlockedReason 을 돌려 채운다 — [노드 삭제] 단추를
   * 흐리게 하는 그 함수 그대로다.
   */
  readonly boxSelectedNodes: readonly { readonly id: string; readonly deleteBlockedReason: string | null }[];
};

/**
 * 포커스가 **글자를 받는 자리**인가. `document.activeElement` 를 그대로 넘겨
 * 부른다(Element 는 tagName 을 들고 있고, HTMLElement 면 isContentEditable 도
 * 들고 있다).
 *
 * 🔵 input 은 종류를 안 가린다 — 체크박스·라디오까지 「글자 칸」으로 친다. 가르려면
 * type 을 읽어야 하는데, 틀리는 쪽이 「노드가 사라진다」라서 **안 지우는 쪽으로
 * 기울여 둔다.**
 *
 * 🔵 tagName 을 대문자로 맞추는 까닭: HTML 문서에서는 언제나 대문자로 오지만
 * (SVG 같은) XML 쪽은 소문자다. 그림판 안에서 키를 누르는 기능이라 섞일 수 있다.
 */
export function isTextEntryTarget(target: { readonly tagName: string; readonly isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * 키 하나에 대한 답 하나. 차례와 까닭은 이 파일 머리말에 있다.
 *
 * 🔵 키를 **누르고 있을 때**(자동 반복)를 따로 막지 않는 까닭: 지우기는 성공하면
 * 그 선택을 바로 푼다(handleQueueDeleteNode 의 setSelectedNodeId(null) ·
 * handleQueueDeleteEdge 의 setSelectedEdgeId(null)). 두 번째 키부터는 고른 것이
 * 없어 NOTHING_SELECTED 로 떨어진다.
 * 🔵 복수도 같다 — 화면이 **지운 것만** 집합에서 뺀다(removeNodesFromSelection).
 * 남는 것은 못 지운 칸뿐이라, 키를 누르고 있어도 두 번째부터는 NODE_DELETE_BLOCKED
 * 로 떨어져 아무 일도 안 일어난다.
 */
export function planProcedureDeleteKey(input: ProcedureDeleteKeyInput): ProcedureDeleteKeyPlan {
  if (input.key !== "Delete" && input.key !== "Backspace") {
    return { action: "NONE", reason: "NOT_A_DELETE_KEY" };
  }
  // 🔴🔴 무엇보다 먼저다. 아래 어느 갈래로도 가면 안 된다.
  if (input.isTypingTarget) {
    return { action: "NONE", reason: "TYPING" };
  }

  // ① 가장 안쪽 — 고른 경로점.
  if (input.canEdit && input.selectedEdgeId !== null && input.selectedWaypointIndex !== null) {
    return { action: "REMOVE_WAYPOINT", edgeId: input.selectedEdgeId, waypointIndex: input.selectedWaypointIndex };
  }

  // 🔴 여기부터는 [Delete] 하나뿐이다(2026-11-21 쓰는 분 결정 — 머리말).
  if (input.key !== "Delete") {
    return { action: "NONE", reason: "BACKSPACE_IS_NOT_FOR_GRAPH" };
  }

  // ①' [범위 선택]으로 고른 여럿(조각 B3). 🔴 모드일 때만 본다.
  if (input.boxSelectActive && input.boxSelectedNodes.length > 0) {
    if (!input.canDeleteGraph) return { action: "NONE", reason: "NOT_ALLOWED" };
    // 🔴 **막힌 것은 빼고 나머지를 지운다**(쓰는 분 결정 — 「하나라도 막히면 전부
    //    안 함」이 아니다). 다섯을 골랐는데 하나가 체크리스트 노드면 넷이 지워지고
    //    그 하나는 **골라진 채 남는다**(화면이 그렇게 뒤처리한다). 전부 막는 쪽을
    //    골랐다면 아무 일도 안 일어나는 것과 구별이 안 돼서(키 경로는 조용하다)
    //    사람은 기능이 고장 난 줄 안다.
    const deletable = input.boxSelectedNodes.filter((node) => node.deleteBlockedReason === null);
    // 🔴 하나도 못 지우면 **여기서 끝난다** — 단수로 흘러내리지 않는다. 사람이
    //    지우려 한 것은 네모로 고른 그것들이고, 그 자리에서 엉뚱한 것이 사라지면 안 된다.
    //    (②의 「막혀도 안 흘러내린다」와 같은 까닭이다.)
    if (deletable.length === 0) return { action: "NONE", reason: "NODE_DELETE_BLOCKED" };
    return { action: "DELETE_NODES", nodeIds: deletable.map((node) => node.id) };
  }

  // ② 노드. 🔴 막혔으면 ③으로 흘러내리지 않고 여기서 끝난다.
  if (input.selectedNodeId !== null) {
    if (!input.canDeleteGraph) return { action: "NONE", reason: "NOT_ALLOWED" };
    if (input.nodeDeleteBlockedReason !== null) return { action: "NONE", reason: "NODE_DELETE_BLOCKED" };
    return { action: "DELETE_NODE", nodeId: input.selectedNodeId };
  }

  // ③ 연결선. 🔵 연결선 삭제에는 미리 막는 까닭이 없다 — 화면의 [분기 삭제] 단추도
  //    흐려지지 않는다(붙은 노드가 있어도 선 쪽은 서버가 받아 준다).
  if (input.selectedEdgeId !== null) {
    if (!input.canDeleteGraph) return { action: "NONE", reason: "NOT_ALLOWED" };
    return { action: "DELETE_EDGE", edgeId: input.selectedEdgeId };
  }

  return { action: "NONE", reason: "NOTHING_SELECTED" };
}
