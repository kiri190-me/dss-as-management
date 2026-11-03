/**
 * 「기술 작업 절차」 편집기의 [이전]/[앞으로]가 **지금 무엇을 되돌려야 하는가**를
 * 정하는 순수 판정. DOM 도 React 도 서버 액션도 DB 도 건드리지 않는다
 * (procedure-editor-save-state.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 생겼나 — 되돌리기가 두 벌인데 서로 시간순으로 안 섞였다
 * ──────────────────────────────────────────────────────────────────────
 * 편집기에는 성격이 다른 되돌리기가 둘 있다.
 *
 *   ① 저장 전 스냅샷(클라이언트) — 드래그 · 안전 필드 수정 · 경로점.
 *      아직 서버에 안 보낸 상태를 통째로 찍어 두었다가 갈아끼운다.
 *   ② 서버 이력(procedure-template-undo-redo) — 노드/연결선 **삭제** · 생성 ·
 *      재연결 · 유형 변경 · 이름 변경. 누르는 즉시 저장되므로 되돌리기도 서버가 한다.
 *
 * 예전 화면 코드는 이렇게 갈랐다:
 *
 *     클라이언트 스택에 뭐가 있나? → 있으면 그것만 되돌리고 끝
 *                                 → 없으면 서버 되돌리기
 *
 * 그래서 **세션 중에 노드를 한 번이라도 드래그했거나 제목을 고쳤으면, 그 뒤에
 * 무엇을 지워도 [이전]이 그 옛 스냅샷부터 되돌렸다.** 사용자가 보기에는
 * 「삭제가 되돌려지지 않는다」였다(스크린샷과 함께 두 번 들어온 요청이다).
 * 게다가 그 스택은 전역 [저장] 성공 때만 비워져서 「모두 취소」를 눌러도 남았다 —
 * 한 번 드래그하면 그 세션 내내 삭제를 되돌릴 수 없었다는 뜻이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 고친 방식 — 스택 **하나**에 둘을 시간순으로 섞는다
 * ──────────────────────────────────────────────────────────────────────
 * 스택 항목에 종류를 붙인다.
 *
 *   { kind: "PENDING",   snapshot } — 저장 전 상태를 통째로 들고 있다.
 *   { kind: "STRUCTURAL" }          — **되돌릴 내용을 안 들고 있다.**
 *                                     서버 이력이 이미 들고 있으니 「여기서는
 *                                     서버에 한 번 물어봐라」는 표시만 한다.
 *
 * 🔴 STRUCTURAL 이 비어 있는 것이 이 설계의 핵심이다. 삭제된 노드의 모든 칸을
 * 클라이언트가 베껴 두었다가 되살리는 길도 있지만, 그 되살리기는 이미 서버에
 * 있고(DELETE_NODE/DELETE_EDGE 를 **같은 id 로** 되살리는 것까지 시험 21개가
 * 물고 있다) 두 벌이 되면 둘이 어긋나는 날 아무도 못 잡는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 스택이 **비었을 때도** 서버로 간다 — 페이지를 새로 연 경우
 * ──────────────────────────────────────────────────────────────────────
 * 이 스택은 화면 상태라 새로고침하면 사라진다. 어제 지운 노드를 오늘 되돌리는
 * 길은 그래서 「스택이 비었고 서버 이력에 남은 것이 있다」 한 갈래다. 전역
 * [저장]에 성공하면 화면이 스택을 통째로 비우는데(저장된 것은 서버 이력의
 * 몫이다), 그때도 이 갈래가 받아 준다.
 *
 * 🔵 그 갈래로 서버 이력을 되돌렸을 때는 **반대쪽(future)에 STRUCTURAL 표시를
 * 하나 남긴다.** 안 남기면 [앞으로]가 그 서버 되돌리기를 건너뛰고 더 오래된
 * PENDING 부터 다시 적용해, 되돌린 차례와 다시 적용하는 차례가 어긋난다.
 * 남겨 두면 「마지막에 되돌린 것이 가장 먼저 다시 적용된다」가 양쪽 길에서
 * 똑같이 성립한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 「판정」을 따로 빼 두는가
 * ──────────────────────────────────────────────────────────────────────
 * 이 저장소의 규약이다 — 판정은 순수 함수로, 참·거짓이 아니라 **까닭**(reason)을
 * 돌려주고, 화면은 다시 판정하지 않는다. 특히 여기서는 **단추를 켤지**와
 * **눌렀을 때 무엇을 할지**가 같은 함수 한 번에서 나와야 한다. 고치기 전에는 그
 * 둘이 서로 다른 변수를 봐서, 안내 문구는 「쓸 수 없습니다」인데 단추는 눌리는
 * 화면이 코드상 가능했다.
 */

import { MAX_UNDO_STEPS, pushUndoStep, type UndoStack } from "@/lib/graph-editor-core/undo-stack";

/** 스택 한 칸. PENDING 만 내용을 들고, STRUCTURAL 은 표시뿐이다(위 머리말 참고). */
export type ProcedureEditorUndoEntry<TPending> =
  | { readonly kind: "PENDING"; readonly snapshot: TPending }
  | { readonly kind: "STRUCTURAL" };

/** 저장 전 스냅샷과 서버 이력 표시가 **한 줄에 시간순으로** 섞여 있는 스택. */
export type ProcedureEditorUndoStack<TPending> = UndoStack<ProcedureEditorUndoEntry<TPending>>;

/**
 * 판정의 까닭. 「할 수 없다」가 왜인지까지 적는 이유는, 세 가지가 사람에게 서로
 * 다른 뜻이기 때문이다 — 권한이 없는 것(NOT_ALLOWED)과 지금 도는 중인 것
 * (ALREADY_RUNNING)과 정말 되돌릴 것이 없는 것(NOTHING_LEFT)은 다음에 할 행동이
 * 각각 다르다.
 */
export type ProcedureUndoReason =
  | "STACK_TOP_IS_PENDING"
  | "STACK_TOP_IS_STRUCTURAL"
  | "STACK_EMPTY_SERVER_HAS_HISTORY"
  | "NOT_ALLOWED"
  | "ALREADY_RUNNING"
  | "NOTHING_LEFT";

/**
 * 다음에 할 일 한 가지.
 *
 * `nextStack` 은 「이 계획이 **성공했을 때**의 스택」이다. RESTORE_PENDING 은
 * 화면 상태만 갈아끼우므로 실패할 길이 없어 곧바로 반영하면 되고,
 * SERVER_HISTORY 는 서버가 ok 를 돌려준 **뒤에** 반영해야 한다 — 실패했는데
 * 반영하면 일어나지도 않은 되돌리기가 스택에서 사라진다.
 */
export type ProcedureUndoPlan<TPending> =
  | {
      readonly action: "RESTORE_PENDING";
      readonly reason: "STACK_TOP_IS_PENDING";
      readonly snapshot: TPending;
      readonly nextStack: ProcedureEditorUndoStack<TPending>;
    }
  | {
      readonly action: "SERVER_HISTORY";
      readonly reason: "STACK_TOP_IS_STRUCTURAL" | "STACK_EMPTY_SERVER_HAS_HISTORY";
      readonly nextStack: ProcedureEditorUndoStack<TPending>;
    }
  | {
      readonly action: "NONE";
      readonly reason: "NOT_ALLOWED" | "ALREADY_RUNNING" | "NOTHING_LEFT";
    };

export function createProcedureEditorUndoStack<TPending>(): ProcedureEditorUndoStack<TPending> {
  return { past: [], future: [] };
}

/**
 * 두 칸이 「같은 상태」인가. STRUCTURAL 은 무엇과도 같지 않다 — 서버 이력의 한
 * 걸음 한 걸음은 내용이 달라도 각각 되돌려야 하는 별개의 사건이고, 같다고 보면
 * 연달아 지운 둘 가운데 하나가 조용히 사라진다.
 */
function entriesEqual<TPending>(
  pendingEquals: (a: TPending, b: TPending) => boolean
): (a: ProcedureEditorUndoEntry<TPending>, b: ProcedureEditorUndoEntry<TPending>) => boolean {
  return (a, b) => a.kind === "PENDING" && b.kind === "PENDING" && pendingEquals(a.snapshot, b.snapshot);
}

/**
 * 저장 전 변경이 일어나기 **직전** 상태를 쌓는다(드래그 시작 · 안전 필드 수정 ·
 * 경로점 · 「모두 취소」). 상한 50단계와 「새 조작은 future 를 무효로 만든다」는
 * graph-editor-core/undo-stack.ts 의 규칙을 그대로 쓴다 — 저장 전 스냅샷만 쌓던
 * 시절과 한 글자도 다르지 않아야 한다.
 */
export function pushPendingUndoEntry<TPending>(
  stack: ProcedureEditorUndoStack<TPending>,
  snapshot: TPending,
  pendingEquals: (a: TPending, b: TPending) => boolean
): ProcedureEditorUndoStack<TPending> {
  return pushUndoStep<ProcedureEditorUndoEntry<TPending>>(stack, { kind: "PENDING", snapshot }, entriesEqual(pendingEquals));
}

/**
 * 서버가 **이미 저장한** 구조 변경 한 걸음을 쌓는다(노드/연결선 생성·삭제,
 * 유형 변경, 재연결, 연결선 위 노드 삽입, 이름 변경, 이력 복원).
 *
 * 🔴 서버 액션이 **성공했을 때만** 부른다. 실패한 호출까지 쌓으면 일어나지도
 * 않은 일을 되돌리려 들어, 바로 아래 있던 멀쩡한 변경이 대신 날아간다.
 */
export function pushStructuralUndoEntry<TPending>(stack: ProcedureEditorUndoStack<TPending>): ProcedureEditorUndoStack<TPending> {
  // entriesEqual 이 STRUCTURAL 을 무엇과도 같지 않다고 보므로 pendingEquals 는
  // 불리지 않는다 — 그래도 타입을 맞추려면 하나는 넘겨야 해서 늘 false 를 준다.
  return pushUndoStep<ProcedureEditorUndoEntry<TPending>>(stack, { kind: "STRUCTURAL" }, entriesEqual<TPending>(() => false));
}

type PlanInput<TPending> = {
  stack: ProcedureEditorUndoStack<TPending>;
  /** 지금 화면에 떠 있는 저장 전 상태. 「헛도는 단계」를 가려내는 기준이다. */
  currentPending: TPending;
  /** 서버 이력에 되돌릴(다시 적용할) 것이 남아 있는가 — 서버가 매 새로고침마다 계산해 준 값. */
  serverHasHistory: boolean;
  /** 이 사람이 이 템플릿의 되돌리기를 쓸 수 있는가(TECHNICAL_TASK + 편집 권한). */
  canUseHistory: boolean;
  /** 앞선 서버 되돌리기가 아직 안 끝났는가. 🔴 두 번 빠르게 누르면 둘이 날아간다. */
  isRunning: boolean;
  pendingEquals: (a: TPending, b: TPending) => boolean;
};

/**
 * [이전]을 눌렀을 때(그리고 단추를 켤지 정할 때) 쓰는 판정.
 *
 *   맨 위가 PENDING    → 그 스냅샷으로 되돌린다
 *   맨 위가 STRUCTURAL → 서버 이력을 한 걸음 되돌린다
 *   스택이 비었음      → 서버 이력에 남은 것이 있으면 그것을 되돌린다
 *
 * 🔴 **역순으로만** 간다. 건너뛰면 이미 없어진 노드를 가리키는 스냅샷이
 * 복원된다.
 *
 * 🔵 현재 상태와 똑같은 PENDING 칸은 조용히 버리고 다음 칸을 본다 — 눌렀는데
 * 화면이 그대로인 「헛도는 되돌리기」를 만들지 않기 위함이다(undo-stack.ts 가
 * 원래 갖고 있던 규칙을 그대로 옮겼다).
 */
export function planProcedureUndo<TPending>(input: PlanInput<TPending>): ProcedureUndoPlan<TPending> {
  if (!input.canUseHistory) return { action: "NONE", reason: "NOT_ALLOWED" };
  if (input.isRunning) return { action: "NONE", reason: "ALREADY_RUNNING" };

  const past = [...input.stack.past];
  const future = [...input.stack.future];

  while (past.length > 0) {
    const top = past.pop() as ProcedureEditorUndoEntry<TPending>;
    if (top.kind === "STRUCTURAL") {
      return { action: "SERVER_HISTORY", reason: "STACK_TOP_IS_STRUCTURAL", nextStack: { past, future: [...future, { kind: "STRUCTURAL" }] } };
    }
    if (input.pendingEquals(top.snapshot, input.currentPending)) continue;
    return {
      action: "RESTORE_PENDING",
      reason: "STACK_TOP_IS_PENDING",
      snapshot: top.snapshot,
      nextStack: { past, future: [...future, { kind: "PENDING", snapshot: input.currentPending }] },
    };
  }

  if (input.serverHasHistory) {
    return { action: "SERVER_HISTORY", reason: "STACK_EMPTY_SERVER_HAS_HISTORY", nextStack: { past, future: [...future, { kind: "STRUCTURAL" }] } };
  }
  return { action: "NONE", reason: "NOTHING_LEFT" };
}

/** [앞으로] — planProcedureUndo 와 정확히 대칭이다(past 와 future 를 맞바꾼 것). */
export function planProcedureRedo<TPending>(input: PlanInput<TPending>): ProcedureUndoPlan<TPending> {
  if (!input.canUseHistory) return { action: "NONE", reason: "NOT_ALLOWED" };
  if (input.isRunning) return { action: "NONE", reason: "ALREADY_RUNNING" };

  const past = [...input.stack.past];
  const future = [...input.stack.future];

  while (future.length > 0) {
    const top = future.pop() as ProcedureEditorUndoEntry<TPending>;
    if (top.kind === "STRUCTURAL") {
      return { action: "SERVER_HISTORY", reason: "STACK_TOP_IS_STRUCTURAL", nextStack: { past: [...past, { kind: "STRUCTURAL" }], future } };
    }
    if (input.pendingEquals(top.snapshot, input.currentPending)) continue;
    return {
      action: "RESTORE_PENDING",
      reason: "STACK_TOP_IS_PENDING",
      snapshot: top.snapshot,
      nextStack: { past: [...past, { kind: "PENDING", snapshot: input.currentPending }], future },
    };
  }

  if (input.serverHasHistory) {
    return { action: "SERVER_HISTORY", reason: "STACK_EMPTY_SERVER_HAS_HISTORY", nextStack: { past: [...past, { kind: "STRUCTURAL" }], future } };
  }
  return { action: "NONE", reason: "NOTHING_LEFT" };
}

/** 단추를 켤지. 화면이 조건을 다시 적지 않게, 계획을 그대로 읽는다. */
export function canRunUndoPlan<TPending>(plan: ProcedureUndoPlan<TPending>): boolean {
  return plan.action !== "NONE";
}

/** 상한은 graph-editor-core 의 것을 그대로 쓴다 — 여기서 두 번째 값을 만들지 않는다. */
export { MAX_UNDO_STEPS };
