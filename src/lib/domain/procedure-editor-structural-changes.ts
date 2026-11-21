import type { ProcedureBranchType, ProcedureNodeType, ManualTechnicalNodeType } from "./procedure-template-types";
import { MANUAL_TECHNICAL_NODE_TYPE_CODES } from "./procedure-template-types";
import type { Position } from "./procedure-editor-save-state";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — 구조 변경도 [저장]을 눌러야 저장된다 (2026-11-20, 조각 1)
 * ============================================================================
 * 노드·연결선의 **추가 · 삭제 · 유형 변경 · 재연결 · 연결선 위 노드 삽입**을
 * 「누르는 즉시 서버로」가 아니라 **모아 두었다가 [저장] 때 한 번에** 보내기 위한
 * 순수 도메인 모듈. 이웃 procedure-editor-save-state.ts 와 같은 규약이다 —
 * DOM · React · 서버 액션 · DB 를 한 줄도 건드리지 않는다.
 *
 * 🔴 이 조각(1)은 **화면을 한 픽셀도 안 바꾼다.** 여기 있는 것은 아직 아무도
 * 부르지 않는다. 화면·서버 연결은 조각 2~4 가 한다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 왜 생겼나 — 2026-11-04 의 결정을 뒤집는다
 * ──────────────────────────────────────────────────────────────────────────
 * procedure-editor-save-state.ts 의 「EXPLICITLY EXCLUDED」 절은 이 일곱 가지를
 * **일부러** 즉시 저장으로 남겼다. 까닭이 있었다 — 사유를 받는 것이 있고, 확인
 * 창을 띄우는 것이 있고, 구조 검증을 다시 돌리는 것이 있고, 서버 이력에 제
 * 나름의 action type 으로 따로 남는다. 모아서 보내면 그 넷이 전부 「저장을
 * 누른 시점」으로 밀린다.
 *
 * 2026-11-04 에는 그 결정을 지킨 채 **안내로** 풀었다 — 「방금 저장됐습니다」를
 * 화면에 띄웠다(components 목록의 procedure-structural-save-notice.test.ts 에
 * 그때의 경위가 그대로 적혀 있다). 2026-11-20 에 **같은 요청이 다시 왔다**:
 * 「노드·연결선 추가·삭제·재연결은 [저장] 없이 바로 저장되는데, 그것들도
 * [저장]을 눌러야 저장되도록 해 달라.」 안내로는 부족했다는 뜻이다. 그래서
 * 이번에는 **동작을 바꾼다.**
 *
 * 2026-11-04 의 까닭은 사라지지 않았다 — 밀린다는 사실은 그대로다. 다만 그것이
 * 쓰는 분이 원하는 모습이고, 밀린 뒤에도 사유·확인 창·구조 검증·이력은 저장
 * 시점에 전부 그대로 돈다(이 모듈이 보낼 입력에 reason 칸을 그대로 들고 있는
 * 까닭이다).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔵 되돌리기(procedure-editor-undo-plan.ts)와 어떻게 만나는가 — 조각 3 의 몫
 * ──────────────────────────────────────────────────────────────────────────
 * 지금 되돌리기 스택은 두 종류를 시간순으로 섞어 쌓는다.
 *
 *   { kind: "PENDING",   snapshot } — 저장 전 화면 상태를 통째로 들고 있다.
 *   { kind: "STRUCTURAL" }          — **내용이 없다.** 「서버 이력에 물어봐라」는
 *                                     표시뿐이다. 구조 변경이 이미 서버에
 *                                     저장돼 있었기 때문에 그래도 됐다.
 *
 * 🔴 이 모듈이 들어오면 **STRUCTURAL 의 전제가 깨진다** — 아직 서버에 안 간
 * 구조 변경을 「서버 이력에 물어봐라」로 되돌릴 수는 없다. 아래
 * PendingStructuralOperation 의 목록 자체가 저장 전 상태의 일부이므로, 조각 3 이
 * 할 일은 그 목록을 PENDING 스냅샷 안에 **함께 싣는 것**으로 보인다(그러면
 * 저장 전 구조 변경은 PENDING 길로, 이미 저장된 구조 변경은 지금처럼
 * STRUCTURAL 길로 갈린다). 🔴 다만 그것은 조각 3 의 판단이다 — 이 조각에서는
 * procedure-editor-undo-plan.ts 를 한 글자도 고치지 않았다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 서버 함수 일곱 — 2026-11-20 에 직접 읽고 적은 입력 모양
 * ──────────────────────────────────────────────────────────────────────────
 * 아래 PendingStructuralOperation 의 칸은 전부 이 일곱의 인자에서 왔다.
 * 조각 2 가 **그대로 실어 보낼 수 있어야** 하므로 이름도 서버 쪽을 따랐다.
 *
 *  ① createProcedureTemplateNodeAction({ templateId, nodeType, title,
 *     position?, expectedTemplateUpdatedAt }) → { ok, nodeId, updatedAt }
 *     🔴 nodeType 은 ManualTechnicalNodeType — CHECKLIST·TROUBLESHOOTING 은 새로
 *     만들 수 없다(담길 자식 내용을 만들 길이 아직 없다).
 *  ② deleteProcedureTemplateNodeAction({ nodeId, reason?, expected… })
 *  ③ changeProcedureTemplateNodeTypeAction({ nodeId, newNodeType, reason?,
 *     expected… }) — 🔴 여기 newNodeType 은 **넓은 쪽**(ProcedureNodeType)이다.
 *     만들 수 있는 유형과 바꿀 수 있는 유형이 다르다는 이 비대칭이 아래 접기
 *     규칙 하나를 갈라 놓는다.
 *  ④ createProcedureTemplateEdgeAction({ templateId, fromNodeId, toNodeId,
 *     branchType, branchLabel?, reason?, expected… }) → { ok, edgeId, updatedAt }
 *  ⑤ deleteProcedureTemplateEdgeAction({ edgeId, reason?, expected… })
 *  ⑥ retargetProcedureTemplateEdgeAction({ edgeId, newFromNodeId, newToNodeId,
 *     reason?, expected… })
 *  ⑦ insertProcedureTemplateNodeOnEdgeAction({ edgeId, nodeType, title,
 *     position, expected… }) → { ok, nodeId, firstEdgeId, secondEdgeId, updatedAt }
 *     🔴 **한 번에 셋을 한다** — 노드를 만들고, 원래 연결선(firstEdgeId, 넘긴
 *     edgeId 그 자체다)의 toNodeId 를 새 노드로 돌리고, 새 노드 → 원래 대상으로
 *     DEFAULT 연결선(secondEdgeId)을 하나 더 만든다. 한 트랜잭션이라 쪼갤 수
 *     없고, 그래서 아래에서도 **하나의 조작**으로 모델링한다. 돌려받는 **새 id 가
 *     둘**이라는 점이 치환에서 가장 빠뜨리기 쉬운 자리다.
 *
 * 🔵 일곱 모두 TECHNICAL_TASK 에서는 사유가 필수가 아니다(Phase 5C-5B). 그래도
 * reason 칸을 남겨 둔 까닭은, 지금 화면이 ④⑥⑦ 에서 확인 창으로 사유를 받고
 * 있고 그 동작을 조각 2 가 그대로 이어받아야 하기 때문이다.
 *
 * 🔵 **값 검증은 여기서 안 한다.** 빈 제목, CUSTOM 인데 라벨이 없는 연결선,
 * 자기 자신으로 가는 연결선 — 전부 서버가 이미 막고 있고, 여기서 한 벌 더 적으면
 * 두 잣대가 어긋나는 날 아무도 못 잡는다(procedure-editor-save-state.ts 가
 * routePointsEqual 을 서버와 나눠 쓰는 것과 같은 까닭).
 */

// ==================== ② 임시 번호(temp id) ====================

/**
 * 🔴 **저장소에 전례가 없다**(2026-11-20 조사). 지금까지 노드·연결선 id 는 늘
 * 서버의 randomUUID() 가 정했고, 연결선은 **그 id 가 DB 에 들어간 뒤에야**
 * 가리킬 수 있었다. 저장 전에 「노드를 만들고 거기에 선을 긋는」 일이 되려면
 * 아직 서버에 없는 노드를 가리키는 이름이 필요하다.
 *
 * ── 🔴 왜 이 모양인가 ─────────────────────────────────────────────────────
 * 진짜 id 는 UUID 다. 서버 액션의 첫 관문이 `isValidUuid` 이고 그 정규식은
 * `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` —
 * **16진수와 하이픈뿐**이다. 그래서 임시 id 에는 그 글자집합에 **없는 글자**를
 * 반드시 넣는다. `:` 가 그것이다(`t`·`m`·`p`·`n`·`o` 도 16진수가 아니지만,
 * 길이·글자 둘 다로 갈리게 해 두는 쪽이 안전하다).
 *
 * 덕분에 세 가지가 동시에 성립한다.
 *   ① **진짜 id 가 임시로 읽힐 수 없다** — UUID 에 `:` 가 들어갈 길이 없다.
 *   ② **임시 id 가 UUID 로 읽힐 수 없다** — 길이도 글자도 안 맞는다.
 *   ③ 혹시 하나가 새 나가도 **서버 액션이 FORBIDDEN 으로 막는다**. 조용히
 *      엉뚱한 노드를 가리키는 일(가장 나쁜 쪽)은 일어나지 않는다. 🔵 그래도
 *      그 방어막에 기대지 않는다 — 보내기 직전에 findUnresolvedTempIds 로
 *      먼저 잡는다. 서버가 막아 주는 것은 「사용자에게 FORBIDDEN 이 보인다」는
 *      뜻이고, 그건 고쳐야 할 결함이지 설계가 아니다.
 *
 * 🔴 노드용과 연결선용을 **글자로 가른다**(`tmp:node:` / `tmp:edge:`). 둘을 한
 * 글자집합으로 두면 연결선 id 를 노드 자리에 넣은 실수가 타입에서도 글자에서도
 * 안 드러난다 — 두 칸 모두 그냥 `string` 이기 때문이다.
 */
export const TEMP_ID_PREFIX = "tmp:";
export const TEMP_NODE_ID_PREFIX = `${TEMP_ID_PREFIX}node:`;
export const TEMP_EDGE_ID_PREFIX = `${TEMP_ID_PREFIX}edge:`;

export function makeTempNodeId(sequence: number): string {
  return `${TEMP_NODE_ID_PREFIX}${sequence}`;
}

export function makeTempEdgeId(sequence: number): string {
  return `${TEMP_EDGE_ID_PREFIX}${sequence}`;
}

/** 임시 id 인가 — 노드든 연결선이든. 「서버에 보내도 되는 id 인가」를 가르는 단 하나의 잣대다. */
export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX);
}

export function isTempNodeId(id: string): boolean {
  return id.startsWith(TEMP_NODE_ID_PREFIX);
}

export function isTempEdgeId(id: string): boolean {
  return id.startsWith(TEMP_EDGE_ID_PREFIX);
}

/**
 * 한 편집 세션 동안 임시 번호를 찍어 내는 도장.
 *
 * 🔴 **같은 번호를 두 번 내주면 안 된다.** 두 노드가 한 이름을 쓰면 아래 접기가
 * 둘을 한 덩어리로 보고, 하나를 지웠을 때 다른 하나가 같이 사라진다. 그래서
 * 세는 수를 안에 가둔다 — 부르는 쪽이 번호를 직접 셀 수 있게 열어 두면 언젠가
 * 두 곳에서 세게 된다.
 *
 * 🔵 노드와 연결선이 **세는 수를 따로** 쓴다. 한 수를 나눠 쓰면 `tmp:node:1` 과
 * `tmp:edge:2` 처럼 번호가 뜀뛰어 사람이 읽기 어렵고, 시험이 「몇 번째로 만든
 * 노드인가」를 못 적는다.
 */
export function createTempIdMinter(startAt: number = 1): { nextNodeId: () => string; nextEdgeId: () => string } {
  let nodeSequence = startAt;
  let edgeSequence = startAt;
  return {
    nextNodeId: () => makeTempNodeId(nodeSequence++),
    nextEdgeId: () => makeTempEdgeId(edgeSequence++),
  };
}

// ==================== ① 모아 둔 구조 변경 한 건 ====================

/**
 * 🔴 칸 이름이 서버 액션의 인자 이름과 같다 — 조각 2 가 그대로 펼쳐 보낼 수
 * 있도록. 다른 것은 **임시 id 를 담는 칸**뿐이고, 그 칸은 이름에 `temp` 가
 * 붙어 있다. 「이름에 temp 가 붙은 칸은 서버에 안 간다」가 이 타입의 규칙이다
 * (findUnresolvedTempIds 가 그 규칙을 글자로 못 박는다).
 *
 * 🔵 `position` 이 CREATE_NODE 에서는 null 을 받고(없으면 서버가 세로로 쌓는다)
 * INSERT_NODE_ON_EDGE 에서는 필수인 것도 서버 쪽 모양 그대로다 — 후자는 「경로점
 * 바로 그 자리」가 삽입의 뜻 자체라 비워 둘 수가 없다.
 */
export type PendingStructuralOperation =
  | {
      readonly kind: "CREATE_NODE";
      /** 🔴 서버에 안 간다. 이 노드를 가리키는 **화면 쪽 이름**이다. */
      readonly tempNodeId: string;
      readonly nodeType: ManualTechnicalNodeType;
      readonly title: string;
      readonly position: Position | null;
    }
  | {
      readonly kind: "DELETE_NODE";
      /** 진짜 id 일 수도, 아직 안 보낸 임시 id 일 수도 있다. 후자는 접기에서 통째로 사라진다. */
      readonly nodeId: string;
      readonly reason: string | null;
    }
  | {
      readonly kind: "CHANGE_NODE_TYPE";
      readonly nodeId: string;
      /** 🔴 넓은 쪽(ProcedureNodeType)이다 — ①의 ManualTechnicalNodeType 과 다르다. */
      readonly newNodeType: ProcedureNodeType;
      readonly reason: string | null;
    }
  | {
      readonly kind: "CREATE_EDGE";
      /** 🔴 서버에 안 간다. */
      readonly tempEdgeId: string;
      readonly fromNodeId: string;
      readonly toNodeId: string;
      readonly branchType: ProcedureBranchType;
      readonly branchLabel: string | null;
      readonly reason: string | null;
    }
  | {
      readonly kind: "DELETE_EDGE";
      readonly edgeId: string;
      readonly reason: string | null;
    }
  | {
      readonly kind: "RETARGET_EDGE";
      readonly edgeId: string;
      readonly newFromNodeId: string;
      readonly newToNodeId: string;
      readonly reason: string | null;
    }
  | {
      readonly kind: "INSERT_NODE_ON_EDGE";
      /** 쪼갤 연결선. 🔴 **반드시 진짜 id** 여야 한다 — 아래 INSERT_ON_UNSAVED_EDGE 참고. */
      readonly edgeId: string;
      /** 🔴 서버에 안 간다. 새로 생길 노드의 화면 쪽 이름. */
      readonly tempNodeId: string;
      /** 🔴 서버에 안 간다. 새 노드 → 원래 대상으로 자동으로 생기는 **둘째** 연결선의 이름. */
      readonly tempSecondEdgeId: string;
      readonly nodeType: ManualTechnicalNodeType;
      readonly title: string;
      readonly position: Position;
    };

export type ProcedureStructuralOperationKind = PendingStructuralOperation["kind"];

// ==================== ③ 겹치는 것 접기 ====================

/**
 * 「보낼 필요가 없어졌다」는 까닭. 🔵 사라지는 것이 **조용히** 사라지면 안 돼서
 * 전부 이름을 붙여 돌려준다 — 조각 2 가 「변경 N건」을 셀 때도, 나중에 누가
 * 「내가 지운 노드가 왜 안 지워졌지」를 쫓을 때도 이 이름이 답이다.
 */
export type StructuralDropReason =
  /** 저장 전에 만들었다가 저장 전에 지웠다 — 서버에 보낼 것이 아예 없다. */
  | "CREATED_THEN_DELETED"
  /** 매달려 있던 임시 노드가 사라져서 함께 사라진다. */
  | "ON_VANISHED_TEMP_NODE"
  /** 매달려 있던 임시 연결선이 사라져서 함께 사라진다. */
  | "ON_VANISHED_TEMP_EDGE"
  /** 아직 안 보낸 「만들기」의 칸으로 흡수됐다(유형 변경 → CREATE_NODE.nodeType 등). */
  | "FOLDED_INTO_CREATE"
  /** 같은 대상에 더 나중 것이 있다 — 마지막 것만 보낸다. */
  | "SUPERSEDED_BY_LATER"
  /** 같은 저장에서 그 대상이 지워진다 — 지워질 것을 고쳐 봐야 왕복만 는다. */
  | "TARGET_DELETED_IN_SAME_SAVE"
  /** 같은 것을 두 번 지우라고 적혀 있다. */
  | "DUPLICATE_DELETE";

/**
 * 「보낼 수 **없다**」는 까닭. 🔴 drop 과 달리 이쪽은 **저장을 막아야 한다** —
 * 그냥 빼고 보내면 사용자가 화면에서 한 일이 설명 없이 사라진다.
 * canSendStructuralChanges 가 그 관문이다.
 */
export type StructuralConflictReason =
  /** 만든 적 없는 임시 id 를 가리킨다 — 부르는 쪽의 결함이다(접기로 사라진 것과는 다르다). */
  | "DANGLING_TEMP_ID"
  /** 아직 저장 안 된 연결선 위에 노드를 삽입하려 한다. 서버 함수가 진짜 연결선 하나를 전제한다. */
  | "INSERT_ON_UNSAVED_EDGE"
  /** 같은 저장에서 지워질 노드에 선을 긋거나 선을 옮기려 한다 — 둘 다 성립할 수 없다. */
  | "ENDPOINT_DELETED_IN_SAME_SAVE"
  /** 임시 노드의 유형을 「새로 만들 수 없는 유형」으로 바꿨다(CHECKLIST·TROUBLESHOOTING). */
  | "TEMP_NODE_TYPE_NOT_CREATABLE";

export type DroppedStructuralOperation = { readonly operation: PendingStructuralOperation; readonly reason: StructuralDropReason };
export type StructuralOperationConflict = { readonly operation: PendingStructuralOperation; readonly reason: StructuralConflictReason };

export type CoalescedStructuralChanges = {
  /** 실제로 서버에 보낼 것. 사용자가 한 순서 그대로다(차례 세우기는 planProcedureStructuralSteps 가 따로 한다). */
  readonly operations: PendingStructuralOperation[];
  readonly dropped: DroppedStructuralOperation[];
  readonly conflicts: StructuralOperationConflict[];
};

/**
 * 🔴 **이 조각에서 가장 중요한 함수.** 사람이 화면에서 이것저것 하다 보면 서로
 * 지우는 조작이 쌓인다. 그대로 보내면 없는 것을 지우려 하거나 쓸데없이
 * 왕복한다.
 *
 * ── 다루는 겹침 (아홉) ───────────────────────────────────────────────────
 *  1. 저장 전에 만들었다가 지운 **임시 노드** → 만들기·지우기 **둘 다** 사라진다.
 *  2. 그 노드에 걸린 **임시 연결선**도 함께 사라진다. 전이적이다 — 사라진 연결선을
 *     가리키던 재연결·삭제도 뒤따라 사라진다.
 *  3. 저장 전에 만들었다가 지운 **임시 연결선** → 둘 다 사라진다.
 *  4. 임시 노드의 **유형 변경**은 그 노드의 CREATE_NODE 칸으로 **접힌다**(왕복 0회).
 *  5. 임시 연결선의 **재연결**은 그 연결선의 CREATE_EDGE 칸으로 **접힌다**.
 *  6. 같은 노드의 유형을 두 번 바꾸면 **마지막 것만**.
 *  7. 같은 연결선을 두 번 재연결하면 **마지막 것만**.
 *  8. 같은 저장에서 지워질 노드/연결선에 대한 유형 변경·재연결은 버린다.
 *  9. 같은 것을 두 번 지우라는 줄은 하나로.
 *
 * ── 🔴 접으면 **안 되는** 것 ─────────────────────────────────────────────
 *  · **이미 서버에 있는 노드·연결선을 지운 것**은 접지 않는다. 그건 진짜 보낼
 *    일이고, 접으면 사용자가 지운 것이 화면에서만 사라지고 다음 새로고침에
 *    되살아난다.
 *  · INSERT_NODE_ON_EDGE 의 **둘째 연결선만** 지운 경우도 접지 않는다. 삽입은
 *    한 트랜잭션이라 「둘째 연결선 없이 삽입」이 없다 — 삽입을 보내고(차례 2),
 *    돌려받은 진짜 id 로 치환한 뒤 그 연결선을 지운다(차례 4). 만들었다 지우는
 *    왕복 한 번이 아깝지만, 쪼갤 수 없는 것을 쪼갠 척하는 것보다 낫다.
 *
 * ── 🔵 일부러 **안 다룬** 겹침과 그 까닭 ─────────────────────────────────
 *  · **똑같은 연결선을 두 번 만든 것**(같은 from·to·branchType). 서버가
 *    assertNoDuplicateEdge 로 거절한다. 여기서 둘째를 조용히 버리면 화면에 그려져
 *    있던 선 하나가 저장 뒤 까닭 없이 사라진다 — 사용자가 **일부러** 평행선을
 *    두 개 그었을 수도 있고, 그게 안 된다는 말은 서버가 해야 맞다.
 *  · **만들고 다시 원래 유형으로 되돌린 변경**(A→B→A). 이론상 왕복 0회로 접을 수
 *    있지만, 「원래 유형」을 알려면 서버 스냅샷이 필요하다. 이 모듈은 **조작 목록만**
 *    보고 판단한다(그래야 시험이 그래프 없이 돈다). 서버 스냅샷을 함께 보는 접기는
 *    조각 2 가 ProcedureServerNodeSnapshot 을 들고 할 수 있는 일이다.
 *  · **지울 노드에 아직 선이 붙어 있는 것**. 서버가 NODE_HAS_CONNECTED_EDGES 로
 *    거절하는데, 그걸 미리 알려면 지금 그래프 전체가 있어야 한다. 위와 같은 까닭으로
 *    여기서는 안 본다.
 *    🔴 2026-11-21 — **화면이 그 규칙을 지키는 방식이 바뀌었다.** 전에는 선이 붙은
 *    노드의 삭제를 아예 막았고(단추를 잠갔다), 지금은 **붙은 선의 DELETE_EDGE 를
 *    같은 묶음에 함께 쌓는다**(procedure-editor-node-deletion.ts — 쓰는 분 결정).
 *    그래서 이 모듈에 그런 입력이 들어오는 것이 **정상**이 되었고, 서버가 안 걸리는
 *    까닭은 아래 차례(DELETE_EDGE 3단계 → DELETE_NODE 6단계)뿐이다.
 *  · **빈 제목 · CUSTOM 인데 라벨 없음 · 자기 자신으로 가는 선**. 값 검증은 서버의
 *    몫이다(머리말 마지막 줄).
 */
export function coalescePendingStructuralOperations(input: readonly PendingStructuralOperation[]): CoalescedStructuralChanges {
  const dropped: DroppedStructuralOperation[] = [];
  const conflicts: StructuralOperationConflict[] = [];

  // 🔵 접기가 칸을 고쳐 쓰므로(④⑤) 입력은 건드리지 않고 얕은 사본으로 일한다.
  //    들어온 배열도, 그 안의 객체도 부르는 쪽 것이다 — 순수 함수의 약속이다.
  const work: (PendingStructuralOperation | null)[] = input.map((op) => ({ ...op }));

  const drop = (index: number, reason: StructuralDropReason) => {
    const op = work[index];
    if (!op) return;
    work[index] = null;
    dropped.push({ operation: op, reason });
  };
  const flagConflict = (index: number, reason: StructuralConflictReason) => {
    const op = work[index];
    if (!op) return;
    work[index] = null;
    conflicts.push({ operation: op, reason });
  };

  // ── 들어온 목록 전체에서 **한 번이라도** 만들어진 임시 id ────────────────
  // 🔴 「접기로 사라진 임시 id」와 「처음부터 없던 임시 id」를 가르는 잣대다.
  //    앞엣것은 조용히 함께 사라지는 것이 맞고, 뒤엣것은 부르는 쪽의 결함이라
  //    반드시 소리를 내야 한다. 이 집합을 안 두면 둘이 구별되지 않는다.
  const everCreatedTempNodeIds = new Set<string>();
  const everCreatedTempEdgeIds = new Set<string>();
  for (const op of input) {
    if (op.kind === "CREATE_NODE") everCreatedTempNodeIds.add(op.tempNodeId);
    else if (op.kind === "CREATE_EDGE") everCreatedTempEdgeIds.add(op.tempEdgeId);
    else if (op.kind === "INSERT_NODE_ON_EDGE") {
      everCreatedTempNodeIds.add(op.tempNodeId);
      everCreatedTempEdgeIds.add(op.tempSecondEdgeId);
    }
  }

  // ── 1단계: 「만들었다가 지운 것」과 거기 매달린 것들을 **더 이상 없을 때까지** 걷어낸다 ──
  // 🔴 한 바퀴로는 모자란다. 임시 노드가 사라지면 거기 걸린 임시 연결선이
  //    사라지고, 그러면 그 연결선을 가리키던 재연결이 또 사라진다. 그래서
  //    「이번 바퀴에 아무것도 안 사라질 때까지」 돈다.
  for (;;) {
    const liveTempNodeIds = new Set<string>();
    const liveTempEdgeIds = new Set<string>();
    for (const op of work) {
      if (!op) continue;
      if (op.kind === "CREATE_NODE") liveTempNodeIds.add(op.tempNodeId);
      else if (op.kind === "CREATE_EDGE") liveTempEdgeIds.add(op.tempEdgeId);
      else if (op.kind === "INSERT_NODE_ON_EDGE") {
        liveTempNodeIds.add(op.tempNodeId);
        liveTempEdgeIds.add(op.tempSecondEdgeId);
      }
    }

    let changed = false;

    // (a) 살아 있는 임시 노드를 지우는 DELETE_NODE — 만든 쪽과 함께 사라진다.
    //     🔴 만든 쪽이 INSERT_NODE_ON_EDGE 면 **삽입 전체**가 사라진다. 그래도
    //        된다(그래야 맞다) — 아직 아무것도 서버에 안 갔으므로, 삽입 조작을
    //        통째로 버리면 원래 연결선 A→B 가 손도 안 댄 상태 그대로다.
    for (let i = 0; i < work.length && !changed; i++) {
      const op = work[i];
      if (!op || op.kind !== "DELETE_NODE" || !isTempNodeId(op.nodeId)) continue;
      if (!liveTempNodeIds.has(op.nodeId)) continue;
      for (let j = 0; j < work.length; j++) {
        const creator = work[j];
        if (!creator) continue;
        const creates =
          (creator.kind === "CREATE_NODE" && creator.tempNodeId === op.nodeId) ||
          (creator.kind === "INSERT_NODE_ON_EDGE" && creator.tempNodeId === op.nodeId);
        if (creates) drop(j, "CREATED_THEN_DELETED");
      }
      drop(i, "CREATED_THEN_DELETED");
      changed = true;
    }
    if (changed) continue;

    // (b) 살아 있는 임시 연결선을 지우는 DELETE_EDGE — CREATE_EDGE 로 만든
    //     것일 때만 짝지어 사라진다. 🔴 INSERT_NODE_ON_EDGE 가 딸려 만든
    //     둘째 연결선은 **접지 않는다**(위 「접으면 안 되는 것」 참고).
    for (let i = 0; i < work.length && !changed; i++) {
      const op = work[i];
      if (!op || op.kind !== "DELETE_EDGE" || !isTempEdgeId(op.edgeId)) continue;
      let creatorIndex = -1;
      for (let j = 0; j < work.length; j++) {
        const creator = work[j];
        if (creator && creator.kind === "CREATE_EDGE" && creator.tempEdgeId === op.edgeId) creatorIndex = j;
      }
      if (creatorIndex === -1) continue;
      drop(creatorIndex, "CREATED_THEN_DELETED");
      drop(i, "CREATED_THEN_DELETED");
      changed = true;
    }
    if (changed) continue;

    // (c) 사라진 임시 id 를 가리키는 것들. 🔴 한 번도 만들어진 적 없는 id 면
    //     조용히 버리지 않고 conflict 로 올린다.
    for (let i = 0; i < work.length && !changed; i++) {
      const op = work[i];
      if (!op) continue;

      const deadNodeRef = (id: string) => isTempNodeId(id) && !liveTempNodeIds.has(id);
      const deadEdgeRef = (id: string) => isTempEdgeId(id) && !liveTempEdgeIds.has(id);
      const killNodeRef = (id: string) => {
        if (everCreatedTempNodeIds.has(id)) drop(i, "ON_VANISHED_TEMP_NODE");
        else flagConflict(i, "DANGLING_TEMP_ID");
        changed = true;
      };
      const killEdgeRef = (id: string) => {
        if (everCreatedTempEdgeIds.has(id)) drop(i, "ON_VANISHED_TEMP_EDGE");
        else flagConflict(i, "DANGLING_TEMP_ID");
        changed = true;
      };

      switch (op.kind) {
        case "CREATE_NODE":
          break;
        case "DELETE_NODE":
          if (deadNodeRef(op.nodeId)) killNodeRef(op.nodeId);
          break;
        case "CHANGE_NODE_TYPE":
          if (deadNodeRef(op.nodeId)) killNodeRef(op.nodeId);
          break;
        case "CREATE_EDGE":
          if (deadNodeRef(op.fromNodeId)) killNodeRef(op.fromNodeId);
          else if (deadNodeRef(op.toNodeId)) killNodeRef(op.toNodeId);
          break;
        case "DELETE_EDGE":
          if (deadEdgeRef(op.edgeId)) killEdgeRef(op.edgeId);
          break;
        case "RETARGET_EDGE":
          if (deadEdgeRef(op.edgeId)) killEdgeRef(op.edgeId);
          else if (deadNodeRef(op.newFromNodeId)) killNodeRef(op.newFromNodeId);
          else if (deadNodeRef(op.newToNodeId)) killNodeRef(op.newToNodeId);
          break;
        case "INSERT_NODE_ON_EDGE":
          if (deadEdgeRef(op.edgeId)) killEdgeRef(op.edgeId);
          break;
      }
    }
    if (!changed) break;
  }

  // ── 2단계: 아직 안 보낸 「만들기」로 접기 · 마지막 것만 남기기 ────────────
  const deletedNodeIds = new Set<string>();
  const deletedEdgeIds = new Set<string>();

  // (a) 같은 것을 두 번 지우라는 줄은 하나로. 🔵 먼저 해야 아래 8번(「같은 저장에서
  //     지워진다」)이 두 번째 줄을 기준으로 삼는 일이 없다.
  for (let i = 0; i < work.length; i++) {
    const op = work[i];
    if (!op) continue;
    if (op.kind === "DELETE_NODE") {
      if (deletedNodeIds.has(op.nodeId)) drop(i, "DUPLICATE_DELETE");
      else deletedNodeIds.add(op.nodeId);
    } else if (op.kind === "DELETE_EDGE") {
      if (deletedEdgeIds.has(op.edgeId)) drop(i, "DUPLICATE_DELETE");
      else deletedEdgeIds.add(op.edgeId);
    }
  }

  // (b) 유형 변경 — 지워질 노드면 버리고, 임시 노드면 만들기로 접고, 아니면 마지막 것만.
  const lastChangeTypeIndexByNodeId = new Map<string, number>();
  for (let i = 0; i < work.length; i++) {
    const op = work[i];
    if (!op || op.kind !== "CHANGE_NODE_TYPE") continue;

    if (deletedNodeIds.has(op.nodeId)) {
      // 🔵 이력 한 줄이 사라지는 것은 맞지만, 사용자가 [저장]을 누르기 전의
      //    중간 상태는 **일어난 적이 없다** — 그게 이번 일의 전제다.
      drop(i, "TARGET_DELETED_IN_SAME_SAVE");
      continue;
    }

    if (isTempNodeId(op.nodeId)) {
      if (!(MANUAL_TECHNICAL_NODE_TYPE_CODES as readonly string[]).includes(op.newNodeType)) {
        // 🔴 서버의 비대칭(머리말 ③) 때문에 생기는 단 하나의 빈틈 — 「바꿀 수는
        //    있지만 새로 만들 수는 없는」 유형으로 **아직 안 만든 노드**를 바꾼 경우.
        //    접을 데가 없고 보낼 수도 없다(임시 id 는 서버에 못 간다).
        flagConflict(i, "TEMP_NODE_TYPE_NOT_CREATABLE");
        continue;
      }
      for (let j = 0; j < work.length; j++) {
        const creator = work[j];
        if (!creator) continue;
        if (creator.kind === "CREATE_NODE" && creator.tempNodeId === op.nodeId) {
          work[j] = { ...creator, nodeType: op.newNodeType as ManualTechnicalNodeType };
        } else if (creator.kind === "INSERT_NODE_ON_EDGE" && creator.tempNodeId === op.nodeId) {
          work[j] = { ...creator, nodeType: op.newNodeType as ManualTechnicalNodeType };
        }
      }
      drop(i, "FOLDED_INTO_CREATE");
      continue;
    }

    const previous = lastChangeTypeIndexByNodeId.get(op.nodeId);
    if (previous !== undefined) drop(previous, "SUPERSEDED_BY_LATER");
    lastChangeTypeIndexByNodeId.set(op.nodeId, i);
  }

  // (c) 재연결 — 같은 규칙. 🔴 임시 연결선이라도 **삽입이 딸려 만든 둘째 연결선**은
  //     접을 수 없다(CREATE_EDGE 가 아니라 접어 넣을 칸이 없다). 그 경우는 삽입이
  //     끝나고 진짜 id 로 치환된 뒤에 보낸다 — 차례 세우기가 그것을 보장한다.
  const lastRetargetIndexByEdgeId = new Map<string, number>();
  for (let i = 0; i < work.length; i++) {
    const op = work[i];
    if (!op || op.kind !== "RETARGET_EDGE") continue;

    if (deletedEdgeIds.has(op.edgeId)) {
      drop(i, "TARGET_DELETED_IN_SAME_SAVE");
      continue;
    }

    if (isTempEdgeId(op.edgeId)) {
      let foldedInto = -1;
      for (let j = 0; j < work.length; j++) {
        const creator = work[j];
        if (creator && creator.kind === "CREATE_EDGE" && creator.tempEdgeId === op.edgeId) {
          work[j] = { ...creator, fromNodeId: op.newFromNodeId, toNodeId: op.newToNodeId };
          foldedInto = j;
        }
      }
      if (foldedInto !== -1) {
        drop(i, "FOLDED_INTO_CREATE");
        continue;
      }
      // 접을 CREATE_EDGE 가 없다 = 삽입이 딸려 만든 둘째 연결선이다. 그대로 둔다.
    }

    const previous = lastRetargetIndexByEdgeId.get(op.edgeId);
    if (previous !== undefined) drop(previous, "SUPERSEDED_BY_LATER");
    lastRetargetIndexByEdgeId.set(op.edgeId, i);
  }

  // ── 3단계: 보낼 수 **없는** 것을 가려낸다 ────────────────────────────────
  for (let i = 0; i < work.length; i++) {
    const op = work[i];
    if (!op) continue;

    if (op.kind === "INSERT_NODE_ON_EDGE" && isTempEdgeId(op.edgeId)) {
      // 🔴 쪼갤 수 있는 차례가 없다. 삽입은 노드를 만드는 조작이기도 해서 연결선
      //    만들기보다 **앞**에 서야 하는데, 아직 안 만든 연결선 위에 삽입하려면
      //    연결선 만들기가 **먼저**여야 한다 — 두 요구가 서로 어긋난다.
      //    🔵 조각 2 의 화면은 「저장 안 된 연결선은 쪼갤 수 없다」로 막거나,
      //       그 경우만 삽입 대신 (노드 만들기 + 임시 연결선 재연결 + 연결선
      //       만들기) 셋으로 직접 적어 내려보내야 한다.
      flagConflict(i, "INSERT_ON_UNSAVED_EDGE");
      continue;
    }

    if (op.kind === "CREATE_EDGE" && (deletedNodeIds.has(op.fromNodeId) || deletedNodeIds.has(op.toNodeId))) {
      // 🔴 버리지 않고 소리를 낸다. 버리면 화면에 그려져 있던 선이 저장 뒤
      //    까닭 없이 사라진다.
      flagConflict(i, "ENDPOINT_DELETED_IN_SAME_SAVE");
      continue;
    }

    if (op.kind === "RETARGET_EDGE" && (deletedNodeIds.has(op.newFromNodeId) || deletedNodeIds.has(op.newToNodeId))) {
      flagConflict(i, "ENDPOINT_DELETED_IN_SAME_SAVE");
      continue;
    }
  }

  return { operations: work.filter((op): op is PendingStructuralOperation => op !== null), dropped, conflicts };
}

/**
 * 보내도 되는가. 🔴 화면이 조건을 다시 적지 않게 계획을 그대로 읽는다
 * (procedure-editor-undo-plan.ts 의 canRunUndoPlan 과 같은 규약).
 *
 * 🔴 **conflicts 가 하나라도 있으면 저장하면 안 된다.** operations 만 들고
 * 보내면 사용자가 화면에서 한 일 하나가 설명 없이 사라진다.
 */
export function canSendStructuralChanges(result: CoalescedStructuralChanges): boolean {
  return result.conflicts.length === 0;
}

// ==================== ④ 보낼 차례 세우기 ====================

/**
 * 🔴 **의존 관계가 있다.** 아래 차례는 그 의존을 전부 만족하는 **유일한 뼈대**로
 * 고른 것이지, 보기 좋아서 늘어놓은 것이 아니다. 한 칸씩 왜 거기인지 적는다.
 *
 *  0. CREATE_NODE      — 선을 그으려면 노드가 **먼저** 있어야 한다. 임시 id 가
 *                        진짜 id 로 바뀌는 자리도 여기다.
 *  1. INSERT_NODE_ON_EDGE — 이것도 노드를 만든다(그리고 연결선 하나 더). 뒤에
 *                        오는 연결선 만들기·재연결이 이 노드를 가리킬 수 있어야 해서
 *                        만들기 무리에 함께 둔다.
 *  2. CHANGE_NODE_TYPE — 임시 노드 것은 이미 접혀 사라졌으므로 여기 남는 것은
 *                        **진짜 노드**뿐이다. 앞뒤 어디에 두어도 의존이 없지만
 *                        차례는 하나로 못 박아야 시험이 설 수 있다.
 *  3. DELETE_EDGE      — 🔴 **연결선 만들기보다 앞**이어야 한다. 서버가
 *                        (from, to, branchType) 중복을 막기 때문에, A→B 를 지우고
 *                        같은 A→B 를 새로 긋는 흔한 조작이 차례가 뒤집히면 거절된다.
 *                        🔴 2026-11-21 부터 **노드 지우기보다 앞**인 것도 기능 하나를
 *                        떠받친다 — 「노드를 지우면 붙은 선도 함께」가 바로 이 차례에
 *                        기대고 있다(6번 참고). 뒤집으면 그 삭제가 전부 실패한다.
 *  4. RETARGET_EDGE    — 🔴 **노드 지우기보다 앞**이어야 한다. 지울 노드에 붙어
 *                        있던 선을 먼저 다른 데로 옮겨야 그 노드를 지울 수 있다
 *                        (서버는 선이 붙은 노드의 삭제를 NODE_HAS_CONNECTED_EDGES
 *                        로 거절한다). 🔵 3번 뒤인 것도 같은 중복 규칙 때문이다.
 *  5. CREATE_EDGE      — 양 끝 노드가 0·1 에서 만들어진 뒤라야 그을 수 있다.
 *  6. DELETE_NODE      — 🔴 **맨 마지막.** 3·4 가 끝나야 그 노드에 아무 선도 안
 *                        붙어 있다. 🔴 2026-11-21 부터 이것이 **가장 흔한 경우**다 —
 *                        노드 삭제는 이제 제게 붙은 선의 DELETE_EDGE 를 늘 함께
 *                        데리고 온다(procedure-editor-node-deletion.ts).
 *
 * 🔵 한 칸 안에서는 **사용자가 한 차례 그대로**다(안정 정렬). 뒤섞으면 같은
 * 입력이 실행마다 다른 차례로 나가고, 실패했을 때 어디까지 갔는지를 사람이 못 읽는다.
 *
 * 🔵 planProcedureSaveSteps(procedure-editor-save-state.ts)가 다섯 Map 을
 * 단계화하는 수법을 본떴다 — **계획만 세우고 아무것도 부르지 않는다.** 실제 실행과
 * expectedTemplateUpdatedAt 이어 넘기기는 거기 있는 runProcedureSaveSequence 가
 * 그대로 맡으면 된다(이 모듈은 그 함수를 다시 만들지 않는다).
 */
export const PROCEDURE_STRUCTURAL_PHASE_ORDER: readonly ProcedureStructuralOperationKind[] = [
  "CREATE_NODE",
  "INSERT_NODE_ON_EDGE",
  "CHANGE_NODE_TYPE",
  "DELETE_EDGE",
  "RETARGET_EDGE",
  "CREATE_EDGE",
  "DELETE_NODE",
];

export function planProcedureStructuralSteps(operations: readonly PendingStructuralOperation[]): PendingStructuralOperation[] {
  const phaseOf = (kind: ProcedureStructuralOperationKind) => PROCEDURE_STRUCTURAL_PHASE_ORDER.indexOf(kind);
  return operations
    .map((operation, index) => ({ operation, index }))
    .sort((a, b) => phaseOf(a.operation.kind) - phaseOf(b.operation.kind) || a.index - b.index)
    .map((entry) => entry.operation);
}

// ==================== ⑤ 임시 id → 진짜 id 치환 ====================

/**
 * 이 조작이 **서버에 보낼 때 진짜 id 여야 하는 칸**에 아직 임시 id 를 들고
 * 있는가. 있으면 그 id 들을 돌려준다.
 *
 * 🔴 **보내기 직전에, 그 한 걸음에 대해서만** 불러야 한다. 계획 전체에 미리
 * 돌리면 멀쩡한 계획이 걸린다 — 뒤 차례의 조작이 앞 차례가 아직 안 돌려준 id 를
 * 들고 있는 것은 **정상**이고, 그걸 메우는 것이 차례 세우기의 일이다.
 *
 * 🔴 이름에 `temp` 가 붙은 칸(tempNodeId·tempEdgeId·tempSecondEdgeId)은 여기
 * 안 센다. 그 칸은 서버에 안 가고, 치환 뒤에도 화면이 같은 것을 계속 가리킬 수
 * 있도록 남는다.
 */
export function findUnresolvedTempIds(operation: PendingStructuralOperation): string[] {
  const sent: string[] = [];
  switch (operation.kind) {
    case "CREATE_NODE":
      break;
    case "DELETE_NODE":
      sent.push(operation.nodeId);
      break;
    case "CHANGE_NODE_TYPE":
      sent.push(operation.nodeId);
      break;
    case "CREATE_EDGE":
      sent.push(operation.fromNodeId, operation.toNodeId);
      break;
    case "DELETE_EDGE":
      sent.push(operation.edgeId);
      break;
    case "RETARGET_EDGE":
      sent.push(operation.edgeId, operation.newFromNodeId, operation.newToNodeId);
      break;
    case "INSERT_NODE_ON_EDGE":
      sent.push(operation.edgeId);
      break;
  }
  return sent.filter(isTempId);
}

/**
 * 한 걸음이 성공해서 서버가 돌려준 진짜 id 를 「임시 id → 진짜 id」 짝으로 모은다.
 *
 * 🔴 **INSERT_NODE_ON_EDGE 는 id 를 둘 돌려준다**(nodeId · secondEdgeId). 여기가
 * 이 모듈에서 가장 빠뜨리기 쉬운 자리다 — 하나만 모으면 나머지 변경이 임시 id 를
 * 든 채로 남는데, 타입은 둘 다 그냥 `string` 이라 tsc 가 아무 말도 안 한다.
 * 🔵 그래서 이 함수가 비어 있는 값을 조용히 넘겨도 **보내기 직전의
 * findUnresolvedTempIds 가 반드시 잡는다.** 소리를 내는 자리를 하나로 모은 것이다.
 *
 * 🔵 firstEdgeId 는 짝에 안 넣는다 — 삽입이 돌려주는 firstEdgeId 는 **넘긴
 * edgeId 그 자체**(이미 진짜 id)라 바꿀 것이 없다.
 */
export function collectResolvedStructuralIds(
  operation: PendingStructuralOperation,
  serverIds: { nodeId?: string; edgeId?: string; secondEdgeId?: string }
): Map<string, string> {
  const resolved = new Map<string, string>();
  if (operation.kind === "CREATE_NODE" && serverIds.nodeId) resolved.set(operation.tempNodeId, serverIds.nodeId);
  if (operation.kind === "CREATE_EDGE" && serverIds.edgeId) resolved.set(operation.tempEdgeId, serverIds.edgeId);
  if (operation.kind === "INSERT_NODE_ON_EDGE") {
    if (serverIds.nodeId) resolved.set(operation.tempNodeId, serverIds.nodeId);
    if (serverIds.secondEdgeId) resolved.set(operation.tempSecondEdgeId, serverIds.secondEdgeId);
  }
  return resolved;
}

/**
 * 아직 안 보낸 나머지 변경들의 **모든 id 칸**을 짝표대로 갈아 끼운다.
 *
 * 🔴 **모든** 칸이다 — 서버에 가는 칸만이 아니라 tempNodeId 같은 화면 쪽 이름까지.
 * 두 가지 까닭이 있다. ① 칸 목록을 아는 곳이 이 함수 하나뿐이어야 한다. 둘로
 * 나누면 새 칸이 생긴 날 한쪽만 고치고 다른 쪽은 조용히 옛 id 를 남긴다.
 * ② 화면이 「방금 만든 노드」를 계속 가리키고 있을 때, 그 이름도 함께 진짜 id 로
 * 옮겨 가야 선택이 끊기지 않는다.
 *
 * 짝표에 없는 id 는 그대로 둔다(진짜 id 는 애초에 바꿀 것이 없다).
 */
export function applyResolvedStructuralIds(
  operations: readonly PendingStructuralOperation[],
  resolved: ReadonlyMap<string, string>
): PendingStructuralOperation[] {
  if (resolved.size === 0) return [...operations];
  const swap = (id: string) => resolved.get(id) ?? id;

  return operations.map((operation): PendingStructuralOperation => {
    switch (operation.kind) {
      case "CREATE_NODE":
        return { ...operation, tempNodeId: swap(operation.tempNodeId) };
      case "DELETE_NODE":
        return { ...operation, nodeId: swap(operation.nodeId) };
      case "CHANGE_NODE_TYPE":
        return { ...operation, nodeId: swap(operation.nodeId) };
      case "CREATE_EDGE":
        return { ...operation, tempEdgeId: swap(operation.tempEdgeId), fromNodeId: swap(operation.fromNodeId), toNodeId: swap(operation.toNodeId) };
      case "DELETE_EDGE":
        return { ...operation, edgeId: swap(operation.edgeId) };
      case "RETARGET_EDGE":
        return {
          ...operation,
          edgeId: swap(operation.edgeId),
          newFromNodeId: swap(operation.newFromNodeId),
          newToNodeId: swap(operation.newToNodeId),
        };
      case "INSERT_NODE_ON_EDGE":
        return {
          ...operation,
          edgeId: swap(operation.edgeId),
          tempNodeId: swap(operation.tempNodeId),
          tempSecondEdgeId: swap(operation.tempSecondEdgeId),
        };
    }
  });
}
