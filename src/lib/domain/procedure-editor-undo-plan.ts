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
 *   ① 저장 전 스냅샷(클라이언트) — 드래그 · 안전 필드 수정 · 경로점, 그리고
 *      2026-11-20 부터 **저장 전 구조 변경 목록**까지(아래 「조각 3」 절).
 *      아직 서버에 안 보낸 상태를 통째로 찍어 두었다가 갈아끼운다.
 *   ② 서버 이력(procedure-template-undo-redo) — **이미 서버에 적힌** 변경.
 *      되돌리기도 서버가 한다(진짜 DB 행을 거꾸로 돌리고, 지웠던 노드를 원래
 *      번호 그대로 되살린다).
 *      🔴 2026-11-20 에 **여기로 오는 길이 줄었다** — 아래 「조각 3」 절.
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
 * 🔴 2026-11-20 (조각 3) — 구조 변경도 [저장]을 눌러야 저장된다
 * ──────────────────────────────────────────────────────────────────────
 * 노드·연결선의 추가·삭제·유형 변경·재연결·삽입 일곱이 **누르는 즉시 서버로**
 * 가던 것을, 모아 두었다가 [저장] 때 한 번에 보내는 쪽으로 바꿨다(조각 1·2 가
 * 그 모아 두기와 보내기를 만들었다). 그래서 **STRUCTURAL 의 전제가 그 일곱에
 * 대해서는 깨졌다** — 저장을 누르기 전에는 되돌릴 것이 서버에 없다.
 *
 * 고친 방식은 **스택 모양을 안 바꾸는 것**이다. 저장 전 구조 변경 목록을
 * PENDING 스냅샷 **안에** 한 칸으로 싣기로 했고(까닭 셋은
 * procedure-editor-structural-undo.ts 머리말), 그러면 저장 전 구조 변경은 저절로
 * PENDING 길로 간다 — 「목록을 한 칸 전 모습으로 되돌려 놓는」 것이 곧 되돌리기다.
 * 시간순을 다시 풀 자리도 안 생긴다. **이 파일에서 갈래를 고르는 규칙
 * (planProcedureUndo/planProcedureRedo)은 한 글자도 안 바뀌었다.**
 *
 * 🔴 그래서 지금 STRUCTURAL 에 오는 것은 이 둘뿐이다.
 *    · 여전히 **즉시** 서버로 가는 것 — 템플릿 이름 변경 · 이력 복원.
 *    · [저장]이 **방금 서버로 보낸** 구조 변경 한 건 한 건
 *      (아래 planUndoStackAfterStructuralSave).
 *
 * ── 🔴 「아직 안 보낸 것」과 「이미 보낸 것」이 한 스택에 섞이는 자리 ──────
 * 그 둘을 가르는 선은 **[저장]을 누른 순간**이다. 저장이 지나가면, 보낸 것은
 * 서버 이력의 몫이 되고 **그보다 앞에 쌓여 있던 스냅샷은 전부 거짓이 된다** —
 * 그 안의 조작 목록은 「아직 보낼 것」이라고 말하는데 이미 보냈고, 임시 번호를
 * 들고 있는데 그 번호는 이제 진짜 id 다. 그대로 되돌려 다시 저장하면 같은 노드가
 * 두 번 만들어진다(조각 2 가 경고한 ㄱ 이 이것이다).
 *
 * 그 답이 planUndoStackAfterStructuralSave 다 — 거기에 까닭을 적었다.
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
import type { PendingStructuralOperation } from "./procedure-editor-structural-changes";

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
 *
 * 🔴 조각 4 부터는 **저장 전 구조 변경**(노드 추가 · 연결선 긋기 …)도 이 길로
 * 쌓인다. 반드시 조작 목록을 고치기 **전에** 불러야 한다 — 뒤에 부르면 스냅샷이
 * 이미 바뀐 목록을 담아 [이전]이 한 칸씩 밀린다(드래그가 지켜 온 규칙 그대로다).
 *
 * 🔴 그리고 `pendingEquals` 가 **구조 목록까지 견뎌야** 한다. 구조 조작만 바뀐
 * 단계는 다섯 지도가 똑같아서, 지금 화면의 pendingSnapshotsEqual 을 그대로 쓰면
 * 「헛도는 단계」로 **조용히 버려진다.** procedure-editor-structural-undo.ts 의
 * procedureStructuralOperationsSignature 를 서명에 한 줄 섞으면 된다.
 */
export function pushPendingUndoEntry<TPending>(
  stack: ProcedureEditorUndoStack<TPending>,
  snapshot: TPending,
  pendingEquals: (a: TPending, b: TPending) => boolean
): ProcedureEditorUndoStack<TPending> {
  return pushUndoStep<ProcedureEditorUndoEntry<TPending>>(stack, { kind: "PENDING", snapshot }, entriesEqual(pendingEquals));
}

/**
 * 서버가 **이미 저장한** 구조 변경 한 걸음을 쌓는다.
 *
 * 🔴 서버 액션이 **성공했을 때만** 부른다. 실패한 호출까지 쌓으면 일어나지도
 * 않은 일을 되돌리려 들어, 바로 아래 있던 멀쩡한 변경이 대신 날아간다.
 *
 * 🔵 여기 오는 조작의 범위가 2026-11-20 에 줄어드는 중이다(머리말 「조각 3」 절).
 *    조각 3 시점의 화면은 아직 옛 모습이라 노드/연결선 생성·삭제·유형 변경·
 *    재연결·연결선 위 노드 삽입까지 전부 이 길로 쌓는다. 조각 4 가 그 일곱을
 *    [저장] 쪽으로 옮기고 나면 여기 남는 것은 **템플릿 이름 변경 · 이력 복원**
 *    둘이다 — 둘은 여전히 누르는 즉시 서버로 간다.
 */
export function pushStructuralUndoEntry<TPending>(stack: ProcedureEditorUndoStack<TPending>): ProcedureEditorUndoStack<TPending> {
  // entriesEqual 이 STRUCTURAL 을 무엇과도 같지 않다고 보므로 pendingEquals 는
  // 불리지 않는다 — 그래도 타입을 맞추려면 하나는 넘겨야 해서 늘 false 를 준다.
  return pushUndoStep<ProcedureEditorUndoEntry<TPending>>(stack, { kind: "STRUCTURAL" }, entriesEqual<TPending>(() => false));
}

/**
 * [저장]이 모아 둔 구조 변경을 서버로 보내고 **난 뒤**의 스택.
 * (runProcedureStructuralSequence 의 결과를 그대로 넘긴다.)
 *
 * ── 🔴 ㄱ. 옛 스냅샷은 **옮기지 않고 버린다** ────────────────────────────
 * 조각 2 가 길 둘을 적어 두고 고르라고 했다 — 스냅샷도 resolvedIds 로 **함께
 * 옮기든지**, 구조가 한 건이라도 성공하면 **스택을 비우든지.** 버리는 쪽을 골랐다.
 *
 *  · 🔴 **옮기기는 반쪽짜리다.** 옛 스냅샷에서 이미 보낸 조작을 빼고 임시 번호를
 *    진짜 번호로 옮겨 놓아도, 그 스냅샷들은 여전히 「방금 보낸 것」을 한 칸도 안
 *    들고 있다. 그러면 [이전]이 **옛 스냅샷부터** 되돌리고 방금 보낸 구조 변경은
 *    스택이 빌 때까지 차례가 안 온다 — 「드래그한 뒤에 지운 노드가 안 되돌려진다」,
 *    곧 이 스택이 애초에 고치려고 만들어진 바로 그 증상이 되돌아온다. 제대로 하려면
 *    옮기기 **더하기** 표시 세우기인데, 그러면 아래 버리기보다 훨씬 복잡한 것이
 *    같은 자리에 선다.
 *  · 🔴 버리면 **거짓 스냅샷이 하나도 안 남는다.** 옮기기는 지도 다섯 · 조작 목록 ·
 *    임시 번호를 스택의 **모든 칸에서 빠짐없이** 옮겨야 성립하고, 한 칸이라도
 *    놓치면 그 칸이 같은 노드를 두 번 만든다. 버리는 쪽은 놓칠 칸이 없다.
 *  · 🔵 잃는 것은 **되돌리기 이력뿐**이다. 저장 전 초안 자체(다섯 지도와 아직 못
 *    보낸 조작)는 그대로 남는다 — 화면이 부분 실패에서 그것들을 안 비운다. 그리고
 *    전부 성공한 경우엔 지금도 화면이 스택을 통째로 비우고 있다. 새 규칙을 만든
 *    것이 아니라 **이미 있던 규칙을 부분 성공까지 넓힌 것**이다.
 *
 * ── 🔴 ㄴ. 비우되 **보낸 건수만큼 STRUCTURAL 을 세운다** ──────────────────
 * 보낸 조작 한 건 = 서버 액션 한 번 = 이력 묶음(change_group) 하나 = 서버
 * 되돌리기 한 걸음이다. 2026-11-20 에 둘을 읽고 확인했다 —
 * db/mutations/procedure-template-editor.ts 의 일곱이 저마다 randomUUID 로 묶음을
 * **하나씩** 열고(insertProcedureTemplateNodeOnEdge 는 이력 줄을 셋 적지만 묶음은
 * 하나다), db/mutations/procedure-template-undo-redo.ts 가 **묶음 단위**로 거슬러
 * 올라간다. 그래서 **건수가 그대로 칸 수**다.
 *
 * 🔴 그냥 비우기만 해도 「스택이 비었고 서버 이력에 남은 것이 있다」 갈래가 받아
 * 준다 — 다만 그 갈래는 `serverHasHistory` 를 믿는데, 그 값은 **서버에서 그려 온**
 * 값이고 화면은 **부분 실패에서 router.refresh() 를 안 부른다.** 방금 서버에 적힌
 * 것이 그 값에 안 비친다는 뜻이고, 그러면 되돌릴 것이 있는데 단추가 꺼진다.
 * 표시를 세워 두면 그 틈이 없다.
 *
 * 🔵 많이 세우는 쪽은 안전하고 모자라게 세우는 쪽이 위험하다 — 남는 표시는 서버가
 *    NO_UNDO_AVAILABLE 로 깔끔히 거절하지만, 모자란 표시는 위의 꺼진 단추가 된다.
 *    그래서 접기 결과(coalesced.operations)가 아니라 **실제로 성공한 것**을 센다.
 *
 * ── 🔵 ㄷ. 한 건도 안 갔으면 들어온 스택을 **그대로** 돌려준다 ────────────
 * BLOCKED_BY_CONFLICTS 거나 첫 걸음에서 실패한 경우다. 서버에 아무 일도 안
 * 일어났으므로 스냅샷은 여전히 참이고, 비우면 멀쩡한 되돌리기를 공짜로 버린다.
 * 🔵 전부 성공해서 「스택도 함께 비우고 싶은」 자리에서는 빈 스택을 넣어 부르면
 *    된다 — planUndoStackAfterStructuralSave(createProcedureEditorUndoStack(), outcome).
 *
 * 🔵 future 를 비우는 까닭은 일반 규약 그대로다 — [저장]은 새 조작이고, 되돌려
 *    두었던 것을 다시 적용하는 길은 저장이 지나간 뒤에는 성립하지 않는다.
 *
 * 🔴 **아직 못 보낸 조작(remainingOperations)은 스택에 제 칸이 없다.** 되돌리는
 *    길은 「모두 취소」뿐이다 — 조각 4 는 그 단추가 다섯 지도와 **함께 구조 목록도**
 *    비우게 해야 한다. 안 그러면 취소한 뒤에도 노드 추가가 살아남아 다음 [저장]에
 *    따라간다.
 */
export function planUndoStackAfterStructuralSave<TPending>(
  stack: ProcedureEditorUndoStack<TPending>,
  outcome: { readonly succeededOperations: readonly PendingStructuralOperation[] }
): ProcedureEditorUndoStack<TPending> {
  if (outcome.succeededOperations.length === 0) return stack;
  const markers: ProcedureEditorUndoEntry<TPending>[] = outcome.succeededOperations.map(() => ({ kind: "STRUCTURAL" }));
  // 상한은 쌓는 쪽(pushUndoStep)과 같은 값을 쓴다. 넘쳐 잘린 몫은 스택이 빈 뒤의
  // 「서버 이력에 남은 것이 있다」 갈래가 이어받는다 — 그 지점에서는 이미 서버
  // 되돌리기를 여러 번 돈 뒤라 화면이 새로 받아온 serverHasHistory 가 맞다.
  return { past: markers.length > MAX_UNDO_STEPS ? markers.slice(markers.length - MAX_UNDO_STEPS) : markers, future: [] };
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
