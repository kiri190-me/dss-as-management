import { runSaveSequence as runGenericSaveSequence, type SaveStepResult as GenericSaveStepResult } from "@/lib/graph-editor-core/save-sequence";
import {
  applyResolvedStructuralIds,
  canSendStructuralChanges,
  coalescePendingStructuralOperations,
  collectResolvedStructuralIds,
  findUnresolvedTempIds,
  isTempEdgeId,
  isTempId,
  isTempNodeId,
  planProcedureStructuralSteps,
  type CoalescedStructuralChanges,
  type PendingStructuralOperation,
} from "./procedure-editor-structural-changes";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — 모아 둔 구조 변경을 서버로 **보내는 길** (2026-11-20, 조각 2)
 * ============================================================================
 * 이웃 procedure-editor-structural-changes.ts(조각 1)가 모아 두고 접고 차례까지
 * 세워 놓은 조작 목록을, **한 번의 [저장]으로** 서버에 내려보내는 실행 한 벌.
 *
 * 🔴 이 조각(2)도 **화면을 한 픽셀도 안 바꾼다.** 서버 뮤테이션도 한 글자 안
 * 바꿨다 — 이미 있는 액션 일곱을 **부르기만** 한다. 그마저도 이 모듈이 직접
 * 부르지 않는다(아래 「왜 실행을 밖에서 받는가」). 화면 연결은 조각 4 다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔵 왜 실행(서버 액션 호출)을 **밖에서 받는가**
 * ──────────────────────────────────────────────────────────────────────────
 * 이웃 procedure-editor-save-state.ts 의 runProcedureSaveSequence 와 같은
 * 규약이다 — 「무엇을 어떤 차례로 보낼지」는 여기가 정하고, 「그 한 건을 실제로
 * 어느 액션으로 어떻게 부르는지」는 화면이 넘긴 함수가 한다. 그래야 이 모듈이
 * React·서버 액션·DB 를 한 줄도 안 물고, 시험이 진짜 DB 없이 전체 흐름을
 * 돌려볼 수 있다(아래 함정 셋은 전부 그 시험으로만 잡힌다).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔴 두 계획의 차례 — **구조가 먼저, 칸 값이 나중**
 * ──────────────────────────────────────────────────────────────────────────
 * 지금 [저장]은 다섯 지도(노드 칸 값 · 연결선 칸 값 · 연결선 비고 · 자리 ·
 * 경로점)를 planProcedureSaveSteps 로 묶어 보낸다. 이제 구조 변경도 함께 가야
 * 하는데, **차례는 하나뿐**이다.
 *
 *   ① 구조 변경 (이 모듈)  →  ② 칸 값·자리 (procedure-editor-save-state.ts)
 *
 * 까닭은 둘이고, 둘 다 뒤집으면 조용히 깨진다.
 *
 *  · **새 노드는 아직 서버에 없다.** 칸 값 단계는 「이미 있는 행의 칸을 고치는」
 *    일이라 진짜 id 를 요구한다. 구조를 나중에 보내면 새 노드의 칸 값은 보낼
 *    자리 자체가 없다.
 *  · 🔴 **그리고 그 사라짐에 오류가 안 난다.** 새 노드의 칸 값·자리는 **임시 id 를
 *    키로** 들고 있는데, 세는 쪽(computeDirtyProcedureNodeFieldEntries)이
 *    `serverNodesById.get(id)` 가 없으면 **조용히 건너뛴다.** 즉 설명·지시 요약·
 *    정렬·다음 절차를 적어 두고 [저장]을 눌러도 「저장됐습니다」가 뜨고 값만
 *    사라진다. 그래서 구조를 먼저 보내 진짜 id 를 받은 뒤 **그 지도들의 키까지
 *    함께 옮겨야** 한다 — 아래 ④절(rebaseDraftMapAfterStructuralSave)이 그 일이고,
 *    그러고도 「서버 스냅숏에 그 노드가 없다」는 사실은 그대로이므로
 *    includeBrandNewDraftEntries 가 한 겹 더 받친다.
 *    🔵 CREATE_NODE 가 title·position 은 이미 싣고 가므로 그 둘은 구조 단계에서
 *       이미 저장된다. 사라지는 것은 나머지 칸이다.
 *
 * 🔴 **구조가 중간에 멈추면 칸 값 단계로 넘어가지 않는다**(canProceedToFieldSave).
 * 넘어가면 실패 메시지가 둘이 되고, 둘째 단계가 쓰는 토큰과 id 가 어디까지
 * 맞는지 사람이 읽을 수 없다. 🔵 넘어가지 않아도 **잃는 것은 없다** — 아직 안 간
 * 칸 값 초안은 그대로 남아 다음 [저장]에 다시 간다.
 *
 * 🔴 성공해서 ②로 넘어갈 때 **토큰은 outcome.finalUpdatedAt 이다.** 화면이 들고
 * 있던 currentUpdatedAt 은 구조 단계가 서버를 건드린 순간 이미 낡았다.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 🔵 서버가 돌려주는 검증 요약 — **마지막 것만** 쓴다
 * ──────────────────────────────────────────────────────────────────────────
 * CREATE_EDGE · RETARGET_EDGE · CHANGE_NODE_TYPE 은 매번 구조 검증을 다시 돌려
 * structuralValidation 을 돌려준다. 한 번의 저장에 여러 개가 오는데, 앞엣것은
 * **뒤 걸음이 아직 반영 안 된 상태의 사진**이라 이미 틀렸다. 그래서 마지막으로
 * 받은 것 하나만 남긴다(lastStructuralValidation).
 * 🔴 그래도 그것이 「지금 서버 상태」라는 보장은 없다 — 검증을 안 돌려주는
 * 걸음(DELETE_EDGE 등)이 그 뒤에 서면 요약은 그만큼 낡는다. 이건 지금 화면이
 * 이미 그렇게 살고 있는 모습 그대로다(구조 변경마다 즉시 저장하던 시절에도
 * handleStructuralSaved 가 요약 없는 변경에서는 옛 요약을 그대로 두었다).
 * 정확한 값이 필요하면 [검증] 단추가 따로 있다.
 * 🔴 ②단계의 EDGE_FIELDS 도 요약을 돌려준다 — 둘을 함께 돌리는 조각 4 는 **더
 * 나중 것**(②쪽)이 이기게 해야 한다.
 * ========================================================================
 */

// ==================== ① 한 걸음을 실제로 보내는 함수(밖에서 받는다) ====================

/**
 * 서버 액션 하나의 결과 중 **이 모듈이 쓰는 것만** 추린 모양. 액션마다 돌려주는
 * 칸이 다르므로 전부 선택 칸이다 — 부르는 쪽이 그 액션의 결과를 그대로 펼쳐
 * 넘기면 맞게 들어간다.
 *
 * 🔴 `nodeId`·`edgeId`·`secondEdgeId` 를 **빠뜨리면 뒤가 깨진다.** 특히
 * INSERT_NODE_ON_EDGE 는 **둘**(nodeId · secondEdgeId)이다. 빠뜨려도 타입은
 * 아무 말도 안 하지만(전부 선택 칸이고 전부 `string` 이다), 보내기 직전 관문
 * (findUnresolvedTempIds)이 반드시 운다 — 소리 나는 자리를 하나로 모아 두었다.
 * 🔵 삽입이 돌려주는 firstEdgeId 는 **넘긴 edgeId 그 자체**(이미 진짜 id)라 받지
 *    않는다.
 *
 * 🔵 검증 요약의 타입을 `StructuralValidationSummary` 로 박지 않고 타입 매개변수로
 *    둔 까닭: 그 타입은 `import "server-only"` 가 걸린 db/mutations 모듈에 있고,
 *    src/lib/domain 의 어떤 모듈도 지금까지 거기서 무엇도 가져오지 않는다(2026-11-20
 *    실측 0건). 타입만 가져오면 지워지기는 하지만, 그 **전례를 여는 값**이
 *    이 조각에는 없다 — 여기서는 요약을 들여다볼 일이 전혀 없고 그대로 돌려줄
 *    뿐이다. 부르는 쪽(화면)은 이미 그 타입을 들고 있다.
 */
export type ProcedureStructuralStepResult<TValidation> =
  | {
      ok: true;
      updatedAt: string;
      /** CREATE_NODE · INSERT_NODE_ON_EDGE 가 돌려주는 **새 노드**의 진짜 id. */
      nodeId?: string;
      /** CREATE_EDGE 가 돌려주는 **새 연결선**의 진짜 id. */
      edgeId?: string;
      /** 🔴 INSERT_NODE_ON_EDGE 만 돌려주는 **둘째** 연결선의 진짜 id. */
      secondEdgeId?: string;
      /** CREATE_EDGE · RETARGET_EDGE · CHANGE_NODE_TYPE 이 매번 돌려주는 구조 검증 요약. */
      structuralValidation?: TValidation | null;
    }
  | { ok: false; message: string };

/**
 * 조작 한 건을 서버로 보내는 함수. 🔴 **넘어오는 operation 은 치환이 끝난,
 * 그대로 보내면 되는 모습**이다 — 부르는 쪽이 임시 id 를 다시 들여다볼 필요가
 * 없다(들여다보면 안 된다. 그때쯤이면 이미 진짜 id 로 바뀌어 있다).
 */
export type ProcedureStructuralExecutor<TValidation> = (
  operation: PendingStructuralOperation,
  expectedUpdatedAt: string
) => Promise<ProcedureStructuralStepResult<TValidation>>;

// ==================== ② 실행 결과 ====================

export type ProcedureStructuralSaveStatus =
  /** 🔴 보낼 수 없는 것이 섞여 있어 **한 건도 안 보냈다.** */
  | "BLOCKED_BY_CONFLICTS"
  /** 보낼 것을 전부 보냈다(보낼 것이 0건이었던 경우도 여기다 — 밑의 runSaveSequence 가 빈 계획을 성공으로 보는 것과 같은 잣대). */
  | "ALL_SENT"
  /** 중간에 한 건이 실패해서 그 뒤를 **안 보내고 멈췄다.** */
  | "STOPPED_AT_FAILURE";

export type ProcedureStructuralFailureCause =
  /** 서버가 거절했다(토큰이 낡았다 · 선이 붙은 노드를 지우려 했다 · 권한 등). */
  | "SERVER_REJECTED"
  /** 🔴 보내기 직전 관문에 걸렸다 — **우리 쪽 결함**이다. 서버는 이 요청을 보지도 못했다. */
  | "UNRESOLVED_TEMP_ID";

export type ProcedureStructuralSaveOutcome<TValidation> = {
  readonly status: ProcedureStructuralSaveStatus;
  /** 접기 결과 그대로 — 부르는 쪽이 「N건 저장 · M건은 서로 지워져 보낼 것이 없었음 · K건은 막힘」을 셀 때 쓴다. */
  readonly coalesced: CoalescedStructuralChanges;
  /**
   * 🔴 **서버가 받아 끝낸** 조작들. 치환이 끝난, 실제로 보낸 그 모습이다.
   * 🔴 이것을 「아직 안 보냄」으로 되돌리면 **같은 노드가 두 번 만들어진다.**
   */
  readonly succeededOperations: PendingStructuralOperation[];
  /**
   * 🔴 **아직 서버에 안 간 것.** 부르는 쪽은 모아 둔 목록을 이것으로 **그대로
   * 갈아 끼우면 된다** — 세 갈래 모두에서 그 말이 맞게 채운다.
   *   · ALL_SENT            → 빈 목록
   *   · STOPPED_AT_FAILURE  → 실패한 그 건부터 끝까지(치환 반영본).
   *     🔵 실패한 건을 여기 **넣는** 까닭: 서버 액션은 한 트랜잭션이라 거절된
   *        요청은 **한 글자도 안 적용**됐다. 그러니 다시 보내는 것이 맞다.
   *        (액션이 아예 던져서 통신이 끊긴 「모름」 상태는 여기로 오지 않는다 —
   *        그 예외는 이 모듈이 삼키지 않고 그대로 위로 올라간다.)
   *   · BLOCKED_BY_CONFLICTS → **들어온 목록 그대로**(접기 전 원본). 한 건도 안
   *     보냈으므로 아무것도 빼면 안 된다 — 여기서 접힌 목록을 돌려주면 사람이
   *     화면에서 한 일이 설명 없이 사라진다.
   */
  readonly remainingOperations: PendingStructuralOperation[];
  /** 첫 실패. null 이면 끝까지 갔다. */
  readonly failedOperation: PendingStructuralOperation | null;
  readonly failureMessage: string | null;
  readonly failureCause: ProcedureStructuralFailureCause | null;
  /**
   * 🔴 임시 id → 진짜 id. **부분 실패여도 여기까지는 확정**이다. 부르는 쪽은
   * 이것으로 남은 목록뿐 아니라 **초안 지도의 키**까지 옮겨야 한다(머리말 참고).
   */
  readonly resolvedIds: Map<string, string>;
  /** 마지막으로 성공한 걸음이 돌려준 토큰. 아무것도 성공 못 했으면 넘긴 값 그대로다. */
  readonly finalUpdatedAt: string;
  /** 🔵 마지막으로 받은 구조 검증 요약 하나(머리말 참고). 한 번도 안 왔으면 null — 부르는 쪽은 그때 들고 있던 것을 그대로 두면 된다. */
  readonly lastStructuralValidation: TValidation | null;
};

/**
 * 칸 값·자리 단계로 넘어가도 되는가. 🔴 화면이 조건을 다시 적지 않게 결과를
 * 그대로 읽는다(canSendStructuralChanges 와 같은 규약).
 */
export function canProceedToFieldSave(outcome: { readonly status: ProcedureStructuralSaveStatus }): boolean {
  return outcome.status === "ALL_SENT";
}

// ==================== ③ 보내기 ====================

/**
 * 모아 둔 구조 변경을 **접고 → 막고 → 차례 세우고 → 한 건씩 보내고 → 치환하며**
 * 끝까지 간다.
 *
 * ── 🔴 왜 밑의 제네릭 runSaveSequence 를 직접 쓰는가 ───────────────────────
 * 이웃 runProcedureSaveSequence 는 인자가 `ProcedureSaveStep[]` 으로 못 박혀
 * 있어 구조 조작을 넘길 수 없다(2026-11-20 에 읽고 확인했다). 그 밑의
 * graph-editor-core/save-sequence.ts 의 제네릭을 직접 쓰면 **토큰 이어 넘기기와
 * 「첫 실패에서 멈춤」이 저장소에 한 벌만** 남는다 — 여기에 for 문을 한 벌 더
 * 적으면 둘이 어긋나는 날 아무도 못 잡는다.
 *
 * ── 🔴 걸음으로 **조작이 아니라 자리 번호**를 넘기는 까닭 ─────────────────
 * 제네릭은 걸음 목록을 **처음에 한 번** 받는다. 그런데 이 계획은 도는 도중에
 * 내용이 바뀐다 — 앞 걸음이 진짜 id 를 받아 오면 **뒤 걸음의 id 칸을 갈아
 * 끼워야** 하기 때문이다. 조작 객체를 그대로 넘기면 제네릭이 들고 있는 것은
 * 치환되기 **전** 모습이라, 뒤 걸음이 임시 id 를 든 채 서버로 간다.
 * 그래서 넘기는 것은 자리 번호뿐이고, 실제 조작은 보낼 때 그 자리에서 **그때
 * 꺼내 읽는다.** 제네릭이 걸음의 속을 한 번도 안 들여다보기 때문에 되는 일이다.
 *
 * ── 🔴 치환은 **걸음마다**, 미리 한 번에가 아니다 ────────────────────────
 * findUnresolvedTempIds 를 계획 전체에 미리 돌리면 멀쩡한 계획이 걸린다. 뒤
 * 차례가 앞 차례의 결과를 기다리는 것이 **정상**이기 때문이다(조각 1 의 경고).
 * 그래서 ① 한 걸음 보내기 직전에 **그 걸음만** 재고, ② 보낸 뒤 돌려받은 진짜
 * id 를 거둬 **남은 전체**에 갈아 끼운다.
 *
 * 🔵 치환을 이미 끝난 걸음에까지 함께 먹이는 까닭: succeededOperations 가
 *    「실제로 보낸 모습」으로 읽혀야 하고, 조각 1 의 applyResolvedStructuralIds 가
 *    tempNodeId 같은 **화면 쪽 이름**까지 함께 옮기도록 일부러 만들어져 있기
 *    때문이다(화면이 「방금 만든 노드」를 계속 가리킬 수 있게). 그 덕에 아래
 *    collectStructuralIdEffects 가 새로 생긴 진짜 id 를 그 칸에서 그대로 읽는다.
 *
 * 🔴 실행 함수가 **예외를 던지면 삼키지 않는다** — 그대로 위로 올라간다. 여기서
 * `{ok:false}` 로 바꿔 버리면 「서버가 거절했다(= 하나도 안 적용)」와 「통신이
 * 끊겨 모른다(= 적용됐을 수 있다)」가 한 칸에 섞이고, 그러면 부르는 쪽이 다시
 * 보내 같은 노드를 두 번 만든다. 이웃 runProcedureSaveSequence 도 같다.
 */
export async function runProcedureStructuralSequence<TValidation>(
  pendingOperations: readonly PendingStructuralOperation[],
  initialUpdatedAt: string,
  execute: ProcedureStructuralExecutor<TValidation>
): Promise<ProcedureStructuralSaveOutcome<TValidation>> {
  const coalesced = coalescePendingStructuralOperations(pendingOperations);
  const resolvedIds = new Map<string, string>();

  // 🔴 막는 것이 먼저다. 반쯤 보내 놓고 막히는 쪽이 훨씬 나쁘다 — 구조 변경에는
  //    되돌릴 수 없는 것이 섞여 있다(이미 지워진 노드).
  if (!canSendStructuralChanges(coalesced)) {
    return {
      status: "BLOCKED_BY_CONFLICTS",
      coalesced,
      succeededOperations: [],
      remainingOperations: [...pendingOperations],
      failedOperation: null,
      failureMessage: null,
      failureCause: null,
      resolvedIds,
      finalUpdatedAt: initialUpdatedAt,
      lastStructuralValidation: null,
    };
  }

  let working = planProcedureStructuralSteps(coalesced.operations);
  const stepIndexes = working.map((_, index) => index);

  let lastStructuralValidation: TValidation | null = null;
  let failureCause: ProcedureStructuralFailureCause | null = null;

  const executeIndex = async (index: number, expectedUpdatedAt: string): Promise<GenericSaveStepResult<string>> => {
    const operation = working[index];

    // ── 보내기 직전 관문 ──────────────────────────────────────────────────
    // 🔴 여기 걸리면 그건 **우리 쪽 결함**이다(앞 걸음의 진짜 id 를 안 거뒀다).
    //    그대로 보내면 서버의 isValidUuid 가 FORBIDDEN 을 내고, 사람에게는
    //    「요청 정보를 확인할 수 없습니다」라는 영문 모를 글만 뜬다.
    const unresolved = findUnresolvedTempIds(operation);
    if (unresolved.length > 0) {
      failureCause = "UNRESOLVED_TEMP_ID";
      return {
        ok: false,
        message: `내부 오류: 새로 만든 항목의 번호가 아직 정해지지 않아 저장을 멈췄습니다(${unresolved.join(", ")}). 이미 저장된 변경은 그대로 남아 있습니다.`,
      };
    }

    const result = await execute(operation, expectedUpdatedAt);
    if (!result.ok) {
      failureCause = "SERVER_REJECTED";
      return { ok: false, message: result.message };
    }

    const justResolved = collectResolvedStructuralIds(operation, result);
    if (justResolved.size > 0) {
      for (const [tempId, realId] of justResolved) resolvedIds.set(tempId, realId);
      working = applyResolvedStructuralIds(working, justResolved);
    }
    if (result.structuralValidation) lastStructuralValidation = result.structuralValidation;

    return { ok: true, token: result.updatedAt };
  };

  const outcome = await runGenericSaveSequence(stepIndexes, initialUpdatedAt, executeIndex);

  // 🔴 `failedAtStep` 은 **자리 번호**다 — 0 번째 걸음에서 실패하면 그 값이 `0`,
  //    곧 falsy 다. `if (outcome.failedAtStep)` 로 읽으면 첫 걸음의 실패가 통째로
  //    사라져 「전부 성공」이 된다. 반드시 null 과 견준다.
  const failedIndex = outcome.failedAtStep !== null ? outcome.failedAtStep : -1;
  const succeededOperations = outcome.succeededSteps.map((index) => working[index]);
  const remainingOperations = failedIndex === -1 ? [] : working.slice(failedIndex);

  return {
    status: failedIndex === -1 ? "ALL_SENT" : "STOPPED_AT_FAILURE",
    coalesced,
    succeededOperations,
    remainingOperations,
    failedOperation: failedIndex === -1 ? null : working[failedIndex],
    failureMessage: outcome.failureMessage,
    failureCause,
    resolvedIds,
    finalUpdatedAt: outcome.finalToken,
    lastStructuralValidation,
  };
}

// ==================== ④ 두 계획의 이음새 ====================

/**
 * 이번 저장이 **id 의 세계에 한 일**. 구조 단계가 끝난 뒤 칸 값 단계가 쓰는
 * 지도들을 손보려면 이 넷이 필요하다.
 *
 * 🔵 「만든 것」은 succeededOperations 의 임시 id 칸에서 읽는다 — 치환이 이미
 *    끝나 있어 그 칸에는 **진짜 id** 가 들어 있다(runProcedureStructuralSequence
 *    머리말 참고). 혹시 서버가 id 를 안 돌려줘 아직 임시인 것이 있으면 세지
 *    않는다 — 그건 만들어진 적이 없다고 보는 쪽이 안전하다.
 */
export type ProcedureStructuralIdEffects = {
  /** 임시 id → 진짜 id. */
  readonly resolvedIds: ReadonlyMap<string, string>;
  /** 이번 저장에서 **새로 생긴** 노드의 진짜 id. */
  readonly createdNodeIds: string[];
  /** 이번 저장에서 **새로 생긴** 연결선의 진짜 id(삽입이 딸려 만든 둘째 연결선 포함). */
  readonly createdEdgeIds: string[];
  /** 이번 저장에서 **사라진** 노드의 id. */
  readonly deletedNodeIds: string[];
  /** 이번 저장에서 **사라진** 연결선의 id. */
  readonly deletedEdgeIds: string[];
};

export function collectStructuralIdEffects(outcome: {
  readonly succeededOperations: readonly PendingStructuralOperation[];
  readonly resolvedIds: ReadonlyMap<string, string>;
}): ProcedureStructuralIdEffects {
  const createdNodeIds: string[] = [];
  const createdEdgeIds: string[] = [];
  const deletedNodeIds: string[] = [];
  const deletedEdgeIds: string[] = [];

  for (const operation of outcome.succeededOperations) {
    switch (operation.kind) {
      case "CREATE_NODE":
        if (!isTempId(operation.tempNodeId)) createdNodeIds.push(operation.tempNodeId);
        break;
      case "CREATE_EDGE":
        if (!isTempId(operation.tempEdgeId)) createdEdgeIds.push(operation.tempEdgeId);
        break;
      case "INSERT_NODE_ON_EDGE":
        // 🔴 **둘**이다 — 노드 하나와 둘째 연결선 하나. 🔵 쪼개진 원래 연결선
        //    (operation.edgeId)은 그대로 살아 있으므로 「만든 것」도 「사라진
        //    것」도 아니다.
        if (!isTempId(operation.tempNodeId)) createdNodeIds.push(operation.tempNodeId);
        if (!isTempId(operation.tempSecondEdgeId)) createdEdgeIds.push(operation.tempSecondEdgeId);
        break;
      case "DELETE_NODE":
        deletedNodeIds.push(operation.nodeId);
        break;
      case "DELETE_EDGE":
        deletedEdgeIds.push(operation.edgeId);
        break;
      case "CHANGE_NODE_TYPE":
      case "RETARGET_EDGE":
        // 가리키는 대상이 그대로다 — id 의 세계는 아무 일도 없었다.
        break;
    }
  }

  return { resolvedIds: outcome.resolvedIds, createdNodeIds, createdEdgeIds, deletedNodeIds, deletedEdgeIds };
}

/**
 * 🔴 **이 조각에서 가장 조용히 깨지는 자리.** 초안 지도의 **키**를 구조 저장
 * 뒤의 세상에 맞춘다 — 둘을 한다.
 *
 *  ① 임시 키 → 진짜 키. 안 하면 그 줄은 영영 서버에 안 간다. 세는 쪽이
 *     `serverNodesById.get(임시 id)` 로 못 찾고 **조용히 건너뛰기** 때문이다.
 *     오류도 안 나고 「저장됐습니다」까지 뜬다. 사라지는 것은 새 노드의 설명 ·
 *     지시 요약 · 정렬 · 다음 절차, 그리고 새 연결선의 분기 유형 · 라벨이다.
 *  ② 이번 저장에서 **지워진** 대상의 줄은 버린다. 안 버리면 다음 단계가 방금
 *     지운 행을 고치려 들어 저장 전체가 「없는 노드입니다」로 실패한다 — 구조
 *     변경은 이미 끝난 뒤라 더 나쁘다.
 *
 * 🔵 아직 임시인 채로 남은 키는 **그대로 둔다.** 구조 저장이 중간에 멈춰 그
 *    노드가 아직 안 만들어진 경우인데, 다음 [저장]에서 만들어지면 그때 옮겨진다.
 *
 * 🔵 `scope` 로 노드용·연결선용을 가른다. 지우는 목록을 부르는 쪽이 고르게 하면
 *    언젠가 노드 지도에 연결선 삭제 목록을 넘긴다 — 두 칸 모두 그냥 `string` 이라
 *    타입이 한마디도 안 한다. 같은 까닭으로 치환도 그 갈래의 임시 id 에만 먹인다.
 */
export function rebaseDraftMapAfterStructuralSave<T>(
  drafts: ReadonlyMap<string, T>,
  effects: ProcedureStructuralIdEffects,
  scope: "node" | "edge"
): Map<string, T> {
  const isTempOfScope = scope === "node" ? isTempNodeId : isTempEdgeId;
  const removed = new Set(scope === "node" ? effects.deletedNodeIds : effects.deletedEdgeIds);

  const next = new Map<string, T>();
  for (const [key, value] of drafts) {
    const movedKey = isTempOfScope(key) ? (effects.resolvedIds.get(key) ?? key) : key;
    if (removed.has(movedKey)) continue;
    next.set(movedKey, value);
  }
  return next;
}

/**
 * 🔴 **막 생긴 노드·연결선의 초안은 「바뀐 것」으로 안 세어진다.** 키를 진짜 id 로
 * 옮겨도 마찬가지다 — 세는 함수들(computeDirtyProcedure*)은 **서버 스냅숏과
 * 맞대어** 재는데, 방금 만든 행은 그 스냅숏에 아직 없다(화면을 새로 받아오기
 * 전이다). 없으면 조용히 건너뛴다.
 *
 * 그래서 「이번 저장에서 막 생긴 id 는 초안이 있으면 **무조건 보낸다**」로 한 겹
 * 더 받친다. 맞대어 볼 기준값이 아예 없으니 그것이 유일하게 맞는 판단이다 —
 * 안 보내면 사람이 적은 값이 사라지고, 보내면 사람이 적은 값이 그대로 들어간다.
 *
 * 🔴 **그래서 막 생긴 노드의 초안을 지어내면 안 된다.** 이 함수가 넣은 줄은 그
 * 초안이 가진 **모든 칸**을 서버에 덮어쓴다. 예를 들어 화면의 nodeFieldDraft 는
 * 서버 스냅숏이 없을 때 `sortOrder: 0` 으로 받침을 세우는데, 서버는 새 노드에
 * 「맨 뒤 번호 + 1」을 매긴 참이다. 그 받침 값이 그대로 올라가면 **새 노드의
 * 정렬 번호가 0 으로 되돌아간다.** 조각 4 는 막 생긴 노드의 초안을 세울 때 이
 * 칸을 어떻게 다룰지 반드시 정해야 한다(보낼 칸에서 빼거나, 서버가 매긴 값을
 * 받아 오거나).
 *
 * 🔵 이미 들어 있는 줄은 **두 번 넣지 않는다.** 차례는 원래 것 먼저, 막 생긴 것
 *    나중 — 세 단계가 서로 독립이라 차례 자체에 뜻은 없지만, 같은 입력이 늘 같은
 *    차례로 나가야 실패했을 때 사람이 읽을 수 있다.
 */
export function includeBrandNewDraftEntries<T>(
  dirtyEntries: readonly (readonly [string, T])[],
  brandNewIds: readonly string[],
  draftsById: ReadonlyMap<string, T>
): [string, T][] {
  const result: [string, T][] = dirtyEntries.map(([id, draft]) => [id, draft]);
  const already = new Set(result.map(([id]) => id));
  for (const id of brandNewIds) {
    if (already.has(id)) continue;
    const draft = draftsById.get(id);
    if (draft === undefined) continue;
    result.push([id, draft]);
    already.add(id);
  }
  return result;
}

/** 위와 같은 규칙의 「id 목록」판 — 자리(위치)와 경로점은 초안 내용이 아니라 id 목록으로 세어진다. */
export function includeBrandNewDraftIds(
  dirtyIds: readonly string[],
  brandNewIds: readonly string[],
  pendingById: ReadonlyMap<string, unknown>
): string[] {
  const result = [...dirtyIds];
  const already = new Set(result);
  for (const id of brandNewIds) {
    if (already.has(id)) continue;
    if (!pendingById.has(id)) continue;
    result.push(id);
    already.add(id);
  }
  return result;
}
