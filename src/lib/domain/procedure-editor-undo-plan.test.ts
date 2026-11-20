import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createProcedureEditorUndoStack,
  pushPendingUndoEntry,
  pushStructuralUndoEntry,
  planUndoStackAfterStructuralSave,
  planProcedureUndo,
  planProcedureRedo,
  canRunUndoPlan,
  MAX_UNDO_STEPS,
  type ProcedureEditorUndoStack,
  type ProcedureUndoPlan,
} from "./procedure-editor-undo-plan";
import { procedureStructuralOperationsSignature } from "./procedure-editor-structural-undo";
import type { PendingStructuralOperation } from "./procedure-editor-structural-changes";

/**
 * 「기술 작업 절차」 편집기의 [이전]/[앞으로] 판정.
 *
 * 🔴 이 시험이 왜 생겼나: 편집기에는 되돌리기가 두 벌(저장 전 스냅샷 · 서버
 * 이력)인데 화면 코드가 "클라이언트 스택에 뭐가 있으면 그것만 되돌리고 끝"으로
 * 갈라 놓아서, **세션 중에 노드를 한 번이라도 드래그하면 그 뒤에 무엇을 지워도
 * [이전]이 삭제를 못 되돌렸다.** 사용자가 스크린샷과 함께 두 번 신고했다.
 * 아래 ①②가 그 정확한 재현이고, 나머지는 고친 뒤에 깨지면 안 되는 것들이다.
 *
 * 저장 전 상태의 실제 모양(Map 다섯)은 이 판정이 전혀 모른다 — 같다/다르다를
 * 가르는 함수를 호출자가 준다. 그래서 여기서는 읽기 쉬운 가짜 스냅샷을 쓴다.
 *
 * 🔴 2026-11-20(조각 3)에 ⑦⑧절이 더해졌다. 구조 변경이 [저장] 전까지 서버에 안
 * 가게 되면서 **저장 전 구조 변경 목록이 PENDING 스냅샷 안으로 들어왔고**, 저장이
 * 지나간 뒤에는 「보낸 것」과 「안 보낸 것」을 갈라야 한다. ①~⑥절은 한 줄도 안
 * 바뀌었다 — 갈래를 고르는 규칙 자체는 그대로이고, 새 것이 그 규칙을 **타고
 * 들어왔을 뿐**이라는 것이 ⑦절이 재는 바로 그 점이다.
 */
type Snap = { readonly layout: Record<string, string> };

function snap(layout: Record<string, string> = {}): Snap {
  return { layout };
}

const snapEquals = (a: Snap, b: Snap) => JSON.stringify(a.layout) === JSON.stringify(b.layout);

/** 화면이 넘기는 인자 한 벌의 기본값. 재는 것만 덮어쓴다. */
function undoPlan(over: {
  stack: ProcedureEditorUndoStack<Snap>;
  currentPending?: Snap;
  serverHasHistory?: boolean;
  canUseHistory?: boolean;
  isRunning?: boolean;
}): ProcedureUndoPlan<Snap> {
  return planProcedureUndo({
    stack: over.stack,
    currentPending: over.currentPending ?? snap(),
    serverHasHistory: over.serverHasHistory ?? false,
    canUseHistory: over.canUseHistory ?? true,
    isRunning: over.isRunning ?? false,
    pendingEquals: snapEquals,
  });
}

function redoPlan(over: {
  stack: ProcedureEditorUndoStack<Snap>;
  currentPending?: Snap;
  serverHasHistory?: boolean;
  canUseHistory?: boolean;
  isRunning?: boolean;
}): ProcedureUndoPlan<Snap> {
  return planProcedureRedo({
    stack: over.stack,
    currentPending: over.currentPending ?? snap(),
    serverHasHistory: over.serverHasHistory ?? false,
    canUseHistory: over.canUseHistory ?? true,
    isRunning: over.isRunning ?? false,
    pendingEquals: snapEquals,
  });
}

describe("절차 편집기 되돌리기 — ① 드래그한 뒤에 지운 노드가 먼저 되돌려진다(신고된 버그의 재현)", () => {
  // 사람이 한 일: 노드 A를 끌어 옮겼다(아직 저장 안 함) → 노드 B를 지웠다(서버가 즉시 저장).
  function draggedThenDeleted() {
    let stack = createProcedureEditorUndoStack<Snap>();
    stack = pushPendingUndoEntry(stack, snap(), snapEquals); // 드래그 "직전" 상태 = 아무 변경 없음
    stack = pushStructuralUndoEntry(stack); // 노드 삭제 성공
    return stack;
  }

  test("🔵 먼저 표본을 확인한다 — 스택에 정말 두 칸이 서로 다른 종류로 쌓였다", () => {
    const stack = draggedThenDeleted();
    assert.equal(stack.past.length, 2, "빈 스택에 대고 재면 아래 단언들이 공짜로 통과한다");
    assert.equal(stack.past[0]?.kind, "PENDING");
    assert.equal(stack.past[1]?.kind, "STRUCTURAL");
  });

  test("🔴 [이전] 한 번 — 드래그가 아니라 **삭제**가 먼저 되돌려진다", () => {
    const plan = undoPlan({ stack: draggedThenDeleted(), currentPending: snap({ A: "250,100" }) });
    assert.equal(plan.action, "SERVER_HISTORY");
    assert.equal(plan.reason, "STACK_TOP_IS_STRUCTURAL");
  });

  test("🔴 고치기 전 동작이 재현되지 않는다 — 저장 전 변경이 있어도 서버 길이 막히지 않는다", () => {
    // 옛 코드는 여기서 "클라이언트 스택에 뭐가 있다 → 스냅샷 복원"으로 갔다.
    const plan = undoPlan({ stack: draggedThenDeleted(), currentPending: snap({ A: "250,100" }) });
    assert.notEqual(plan.action, "RESTORE_PENDING");
  });

  test("[이전] 두 번째에 드래그가 되돌려진다 — 역순 그대로", () => {
    const first = undoPlan({ stack: draggedThenDeleted(), currentPending: snap({ A: "250,100" }) });
    // assert.equal 은 @types/node 에서 `asserts actual is T` 라 여기서부터
    // first 가 SERVER_HISTORY 갈래로 좁혀진다 — nextStack 을 그냥 읽을 수 있다.
    assert.equal(first.action, "SERVER_HISTORY");
    const second = undoPlan({ stack: first.nextStack, currentPending: snap({ A: "250,100" }) });
    assert.equal(second.action, "RESTORE_PENDING");
    assert.ok(second.action === "RESTORE_PENDING");
    assert.deepEqual(second.snapshot, snap(), "드래그 직전(= 아무 변경 없음)으로 돌아간다");
  });

  test("서버 되돌리기를 마치면 그 걸음이 [앞으로] 쪽 맨 위에 선다", () => {
    const plan = undoPlan({ stack: draggedThenDeleted(), currentPending: snap({ A: "250,100" }) });
    assert.ok(plan.action === "SERVER_HISTORY");
    assert.equal(plan.nextStack.past.length, 1);
    assert.equal(plan.nextStack.future.at(-1)?.kind, "STRUCTURAL");
  });
});

describe("절차 편집기 되돌리기 — ② 드래그한 뒤에 지운 연결선도 같은 길로 돌아온다", () => {
  test("🔴 경로점을 만지고 연결선을 지운 뒤 [이전]을 누르면 연결선 쪽(서버)으로 간다", () => {
    let stack = createProcedureEditorUndoStack<Snap>();
    stack = pushPendingUndoEntry(stack, snap({ route: "자동" }), snapEquals); // 경로점 편집 직전
    stack = pushStructuralUndoEntry(stack); // 연결선 삭제 성공
    assert.equal(stack.past.length, 2);

    const plan = undoPlan({ stack, currentPending: snap({ route: "수동 3점" }) });
    assert.equal(plan.action, "SERVER_HISTORY");
    assert.equal(plan.reason, "STACK_TOP_IS_STRUCTURAL");

    // 그다음에야 경로점 편집이 되돌려진다.
    assert.ok(plan.action === "SERVER_HISTORY");
    const next = undoPlan({ stack: plan.nextStack, currentPending: snap({ route: "수동 3점" }) });
    assert.ok(next.action === "RESTORE_PENDING");
    assert.deepEqual(next.snapshot, snap({ route: "자동" }));
  });
});

describe("절차 편집기 되돌리기 — ③ 섞어 쌓아도 시간순 역순으로 나온다", () => {
  test("PENDING · STRUCTURAL · PENDING · STRUCTURAL 을 쌓으면 정확히 거꾸로 나온다", () => {
    let stack = createProcedureEditorUndoStack<Snap>();
    stack = pushPendingUndoEntry(stack, snap({ s: "1" }), snapEquals);
    stack = pushStructuralUndoEntry(stack);
    stack = pushPendingUndoEntry(stack, snap({ s: "3" }), snapEquals);
    stack = pushStructuralUndoEntry(stack);
    assert.equal(stack.past.length, 4, "네 칸이 다 남아 있어야 아래 차례 검사가 뜻이 있다");

    const seen: string[] = [];
    let current = snap({ s: "now" });
    let cursor = stack;
    for (let i = 0; i < 4; i += 1) {
      const plan = undoPlan({ stack: cursor, currentPending: current });
      assert.ok(plan.action !== "NONE", `${i + 1}번째에서 멈췄다`);
      seen.push(plan.action === "RESTORE_PENDING" ? `PENDING:${plan.snapshot.layout.s}` : "SERVER");
      if (plan.action === "RESTORE_PENDING") current = plan.snapshot;
      cursor = plan.nextStack;
    }
    assert.deepEqual(seen, ["SERVER", "PENDING:3", "SERVER", "PENDING:1"]);
  });

  test("🔴 연달아 일어난 구조 변경 둘이 하나로 뭉쳐지지 않는다", () => {
    // 들고 있는 내용이 없어서 "같다"로 접히기 쉬운 자리다. 접히면 두 번 지운
    // 것 가운데 하나가 영영 안 돌아온다.
    let stack = createProcedureEditorUndoStack<Snap>();
    stack = pushStructuralUndoEntry(stack);
    stack = pushStructuralUndoEntry(stack);
    assert.equal(stack.past.length, 2);
  });

  test("같은 상태를 다시 쌓으면 한 칸으로 접힌다 — 저장 전 스냅샷에만 해당한다", () => {
    let stack = createProcedureEditorUndoStack<Snap>();
    stack = pushPendingUndoEntry(stack, snap({ s: "1" }), snapEquals);
    stack = pushPendingUndoEntry(stack, snap({ s: "1" }), snapEquals);
    assert.equal(stack.past.length, 1);
  });
});

describe("절차 편집기 되돌리기 — ④ 쌓는 규칙", () => {
  test("구조 변경 한 번이 스택 한 칸이고, 내용은 안 들고 있다", () => {
    const stack = pushStructuralUndoEntry(createProcedureEditorUndoStack<Snap>());
    assert.deepEqual(stack.past, [{ kind: "STRUCTURAL" }]);
  });

  test("🔴 아무것도 안 쌓았으면 되돌릴 것이 없다 — 서버 액션이 실패해 안 쌓인 경우가 이것이다", () => {
    // 화면은 서버가 ok 를 준 뒤에만 pushStructuralUndoEntry 를 부른다. 실패하면
    // 스택이 그대로이고, 그때 [이전]은 아래 칸(= 멀쩡한 저장 전 변경)을 대신
    // 날리지 않고 "되돌릴 것 없음"이어야 한다.
    const plan = undoPlan({ stack: createProcedureEditorUndoStack<Snap>(), serverHasHistory: false });
    assert.equal(plan.action, "NONE");
    assert.equal(plan.reason, "NOTHING_LEFT");
    assert.equal(canRunUndoPlan(plan), false);
  });

  test("🔴 서버 되돌리기 계획은 **적용 전후가 다른** 스택을 준다 — 성공했을 때만 반영하라는 뜻", () => {
    const stack = pushStructuralUndoEntry(createProcedureEditorUndoStack<Snap>());
    const plan = undoPlan({ stack });
    assert.ok(plan.action === "SERVER_HISTORY");
    assert.notDeepEqual(plan.nextStack, stack);
    assert.equal(plan.nextStack.past.length, 0);
  });

  test("새 조작을 쌓으면 [앞으로] 쪽이 비워진다(일반적인 되돌리기 규약)", () => {
    let stack = pushPendingUndoEntry(createProcedureEditorUndoStack<Snap>(), snap({ s: "1" }), snapEquals);
    const undone = undoPlan({ stack, currentPending: snap({ s: "2" }) });
    assert.ok(undone.action === "RESTORE_PENDING");
    assert.equal(undone.nextStack.future.length, 1);
    stack = pushStructuralUndoEntry(undone.nextStack);
    assert.equal(stack.future.length, 0);
  });

  test("🔴 되돌릴 수 있는 단계 상한이 50 그대로다(사용자 요청은 20이었고 이미 50이다 — 줄이면 기능 축소)", () => {
    assert.equal(MAX_UNDO_STEPS, 50);
    let stack = createProcedureEditorUndoStack<Snap>();
    for (let i = 0; i < 60; i += 1) stack = pushPendingUndoEntry(stack, snap({ s: String(i) }), snapEquals);
    assert.equal(stack.past.length, 50);
    assert.deepEqual(stack.past[0], { kind: "PENDING", snapshot: snap({ s: "10" }) }, "넘치면 가장 오래된 것부터 버린다");
  });
});

describe("절차 편집기 되돌리기 — ⑤ 도는 동안 잠긴다 / 권한이 없으면 안 켜진다", () => {
  test("🔴 서버 되돌리기가 도는 중이면 [이전]도 [앞으로]도 아무 일을 안 한다", () => {
    const stack = pushStructuralUndoEntry(createProcedureEditorUndoStack<Snap>());
    const running = undoPlan({ stack, isRunning: true });
    assert.equal(running.action, "NONE");
    assert.equal(running.reason, "ALREADY_RUNNING");
    assert.equal(canRunUndoPlan(running), false);

    // 🔵 표본 확인 — 돌고 있지 않으면 같은 스택이 실제로 움직인다(늘 NONE 이라 통과한 것이 아니다).
    assert.equal(undoPlan({ stack, isRunning: false }).action, "SERVER_HISTORY");
  });

  test("도는 중에는 [앞으로]도 함께 잠긴다 — 둘은 같은 대상을 건드린다", () => {
    const stack: ProcedureEditorUndoStack<Snap> = { past: [], future: [{ kind: "STRUCTURAL" }] };
    assert.equal(redoPlan({ stack, isRunning: true }).reason, "ALREADY_RUNNING");
    assert.equal(redoPlan({ stack, isRunning: false }).action, "SERVER_HISTORY");
  });

  test("되돌리기를 쓸 수 없는 사람에게는 까닭이 다르다(권한 ≠ 되돌릴 것 없음)", () => {
    const stack = pushStructuralUndoEntry(createProcedureEditorUndoStack<Snap>());
    const plan = undoPlan({ stack, canUseHistory: false, serverHasHistory: true });
    assert.equal(plan.action, "NONE");
    assert.equal(plan.reason, "NOT_ALLOWED");
  });
});

describe("절차 편집기 되돌리기 — ⑥ 스택이 비어 있어도 서버 이력으로 간다", () => {
  test("🔴 페이지를 새로 연 경우 — 스택은 비었고 서버에 이력이 있으면 그것을 되돌린다", () => {
    const plan = undoPlan({ stack: createProcedureEditorUndoStack<Snap>(), serverHasHistory: true });
    assert.equal(plan.action, "SERVER_HISTORY");
    assert.equal(plan.reason, "STACK_EMPTY_SERVER_HAS_HISTORY");
  });

  test("[앞으로]도 같다", () => {
    const plan = redoPlan({ stack: createProcedureEditorUndoStack<Snap>(), serverHasHistory: true });
    assert.equal(plan.action, "SERVER_HISTORY");
    assert.equal(plan.reason, "STACK_EMPTY_SERVER_HAS_HISTORY");
  });

  test("🔵 그 길로 되돌린 것도 [앞으로] 차례에 끼어든다 — 되돌린 차례와 다시 적용하는 차례가 어긋나지 않는다", () => {
    // 저장 전 변경 하나를 되돌려 future 에 넣어 둔 상태에서, 스택 바깥의 서버
    // 이력을 한 걸음 더 되돌린다. 표시를 안 남기면 [앞으로]가 그 서버 걸음을
    // 건너뛰고 더 오래된 저장 전 변경부터 다시 적용한다.
    let stack = pushPendingUndoEntry(createProcedureEditorUndoStack<Snap>(), snap({ s: "1" }), snapEquals);
    const first = undoPlan({ stack, currentPending: snap({ s: "2" }) });
    assert.ok(first.action === "RESTORE_PENDING");
    stack = first.nextStack;
    assert.equal(stack.past.length, 0);
    assert.equal(stack.future.length, 1);

    const second = undoPlan({ stack, currentPending: snap({ s: "1" }), serverHasHistory: true });
    assert.ok(second.action === "SERVER_HISTORY");
    assert.equal(second.reason, "STACK_EMPTY_SERVER_HAS_HISTORY");
    assert.equal(second.nextStack.future.at(-1)?.kind, "STRUCTURAL", "가장 먼저 다시 적용될 자리에 서야 한다");

    const back = redoPlan({ stack: second.nextStack, currentPending: snap({ s: "1" }) });
    assert.equal(back.action, "SERVER_HISTORY");
    assert.equal(back.reason, "STACK_TOP_IS_STRUCTURAL");
  });

  test("스택도 비고 서버 이력도 없으면 단추가 꺼진다", () => {
    const plan = undoPlan({ stack: createProcedureEditorUndoStack<Snap>(), serverHasHistory: false });
    assert.equal(canRunUndoPlan(plan), false);
  });
});

describe("절차 편집기 되돌리기 — 헛도는 단계와 [앞으로] 대칭", () => {
  test("지금 상태와 똑같은 저장 전 칸은 조용히 버리고 그다음을 본다", () => {
    let stack = createProcedureEditorUndoStack<Snap>();
    stack = pushPendingUndoEntry(stack, snap({ s: "1" }), snapEquals);
    stack = pushStructuralUndoEntry(stack);
    stack = pushPendingUndoEntry(stack, snap({ s: "9" }), snapEquals);
    assert.equal(stack.past.length, 3);

    // 맨 위 칸이 지금 화면 상태와 같다 — 눌러도 아무 일이 없는 단계다.
    const plan = undoPlan({ stack, currentPending: snap({ s: "9" }) });
    assert.equal(plan.action, "SERVER_HISTORY", "헛도는 칸을 건너뛰고 그 아래 구조 변경으로 간다");
    assert.ok(plan.action === "SERVER_HISTORY");
    assert.equal(plan.nextStack.past.length, 1, "버린 칸은 스택에서도 사라진다");
  });

  test("되돌렸다 다시 적용하면 원래 상태로 돌아온다(저장 전 스냅샷 왕복)", () => {
    const stack = pushPendingUndoEntry(createProcedureEditorUndoStack<Snap>(), snap({ s: "before" }), snapEquals);
    const undone = undoPlan({ stack, currentPending: snap({ s: "after" }) });
    assert.ok(undone.action === "RESTORE_PENDING");
    assert.deepEqual(undone.snapshot, snap({ s: "before" }));

    const redone = redoPlan({ stack: undone.nextStack, currentPending: undone.snapshot });
    assert.ok(redone.action === "RESTORE_PENDING");
    assert.deepEqual(redone.snapshot, snap({ s: "after" }));
  });

  test("🔴 [앞으로]도 맨 위가 구조 변경이면 서버로 간다", () => {
    const stack: ProcedureEditorUndoStack<Snap> = {
      past: [],
      future: [{ kind: "PENDING", snapshot: snap({ s: "old" }) }, { kind: "STRUCTURAL" }],
    };
    const plan = redoPlan({ stack, currentPending: snap() });
    assert.equal(plan.action, "SERVER_HISTORY");
    assert.equal(plan.reason, "STACK_TOP_IS_STRUCTURAL");
    assert.ok(plan.action === "SERVER_HISTORY");
    assert.equal(plan.nextStack.past.at(-1)?.kind, "STRUCTURAL");
    assert.equal(plan.nextStack.future.length, 1, "아래의 저장 전 칸은 그대로 남는다");
  });
});

/* ========================================================================
 * 2026-11-20 (조각 3) — 저장 전 구조 변경이 PENDING 스냅샷을 타고 들어온다
 * ====================================================================== */

/** 진짜 id 표본(서버의 randomUUID() 와 같은 모양이면 된다 — 실제 데이터와 무관하다). */
const REAL_NODE_A = "11111111-1111-4111-8111-111111111111";

function createNodeOp(tempNodeId: string): PendingStructuralOperation {
  return { kind: "CREATE_NODE", tempNodeId, nodeType: "TASK", title: "새 작업", position: null };
}
function deleteNodeOp(nodeId: string): PendingStructuralOperation {
  return { kind: "DELETE_NODE", nodeId, reason: null };
}

/**
 * 조각 4 의 PendingSnapshot 을 읽기 쉽게 줄인 것. 🔴 `drafts` 가 **임시 id 를 키로**
 * 들고 있는 것이 핵심이다 — 구조 목록과 한 스냅샷에 실어야 하는 까닭이 그것이다.
 */
type StructuralSnap = {
  readonly layout: Record<string, string>;
  readonly drafts: Record<string, string>;
  readonly structural: readonly PendingStructuralOperation[];
};

function sSnap(over: Partial<StructuralSnap> = {}): StructuralSnap {
  return { layout: {}, drafts: {}, structural: [], ...over };
}

/** 🔴 화면이 **줘야 하는** 비교 — 지도들에 더해 구조 목록 서명까지 섞는다. */
const structuralSnapEquals = (a: StructuralSnap, b: StructuralSnap) =>
  JSON.stringify([a.layout, a.drafts, procedureStructuralOperationsSignature(a.structural)]) ===
  JSON.stringify([b.layout, b.drafts, procedureStructuralOperationsSignature(b.structural)]);

/** 🔴 구조 목록을 **안 보는** 비교 — 조각 4 가 서명을 안 섞었을 때의 모습. 아래 함정 시험이 이것으로 잰다. */
const draftsOnlyEquals = (a: StructuralSnap, b: StructuralSnap) => JSON.stringify([a.layout, a.drafts]) === JSON.stringify([b.layout, b.drafts]);

function undoStructuralPlan(over: {
  stack: ProcedureEditorUndoStack<StructuralSnap>;
  currentPending: StructuralSnap;
  serverHasHistory?: boolean;
  pendingEquals?: (a: StructuralSnap, b: StructuralSnap) => boolean;
}): ProcedureUndoPlan<StructuralSnap> {
  return planProcedureUndo({
    stack: over.stack,
    currentPending: over.currentPending,
    serverHasHistory: over.serverHasHistory ?? false,
    canUseHistory: true,
    isRunning: false,
    pendingEquals: over.pendingEquals ?? structuralSnapEquals,
  });
}

describe("절차 편집기 되돌리기 — ⑦ 저장 전 구조 변경은 PENDING 길로 돌아온다", () => {
  test("🔵 표본부터 — 노드 추가 '직전'이 한 칸 쌓이고, 지금 상태에는 조작이 한 건 있다", () => {
    const stack = pushPendingUndoEntry(createProcedureEditorUndoStack<StructuralSnap>(), sSnap(), structuralSnapEquals);
    const current = sSnap({ structural: [createNodeOp("tmp:node:1")] });
    assert.equal(stack.past.length, 1, "빈 스택에 대고 재면 아래 단언들이 공짜로 통과한다");
    assert.equal(stack.past[0]?.kind, "PENDING");
    assert.equal(current.structural.length, 1);
  });

  test("🔴 [이전] 한 번에 조작이 **목록에서 빠진다** — 서버로 가지 않는다", () => {
    // 아직 서버에 보낸 적이 없으므로 서버 이력에는 되돌릴 것이 없다.
    // 되돌리기는 「할 일 목록에서 한 줄을 빼는 일」이어야 한다.
    const stack = pushPendingUndoEntry(createProcedureEditorUndoStack<StructuralSnap>(), sSnap(), structuralSnapEquals);
    const current = sSnap({ structural: [createNodeOp("tmp:node:1")] });

    const plan = undoStructuralPlan({ stack, currentPending: current });
    assert.equal(plan.action, "RESTORE_PENDING");
    assert.equal(plan.reason, "STACK_TOP_IS_PENDING");
    assert.ok(plan.action === "RESTORE_PENDING");
    assert.deepEqual(plan.snapshot.structural, [], "보낼 목록에서 빠져야 한다");
  });

  test("🔴 임시 id 로 적힌 **초안도 함께** 되돌아온다 — 한 스냅샷에 실은 까닭", () => {
    // 따로 되돌리면 지도에 tmp:node:1 짜리 초안이 남고, 다음에 만든 노드가
    // 같은 번호를 받는 날 **지운 적 없는 남의 글**이 그 노드에 붙는다.
    const stack = pushPendingUndoEntry(createProcedureEditorUndoStack<StructuralSnap>(), sSnap(), structuralSnapEquals);
    const current = sSnap({
      structural: [createNodeOp("tmp:node:1")],
      drafts: { "tmp:node:1": "임시 노드에 적어 둔 설명" },
    });
    assert.deepEqual(Object.keys(current.drafts), ["tmp:node:1"], "표본 확인 — 되돌리기 전에는 초안이 정말 들어 있다");

    const plan = undoStructuralPlan({ stack, currentPending: current });
    assert.ok(plan.action === "RESTORE_PENDING");
    assert.deepEqual(plan.snapshot.structural, []);
    assert.deepEqual(plan.snapshot.drafts, {}, "조작과 초안이 같이 움직인다");
  });

  test("🔴 드래그와 구조 변경을 섞어 쌓아도 **정확히 역순**으로 나온다(시간순)", () => {
    let stack = createProcedureEditorUndoStack<StructuralSnap>();
    const step0 = sSnap();
    const step1 = sSnap({ layout: { A: "1" } });
    const step2 = sSnap({ layout: { A: "1" }, structural: [createNodeOp("tmp:node:1")] });
    const step3 = sSnap({ layout: { A: "2" }, structural: [createNodeOp("tmp:node:1")] });
    const now = sSnap({ layout: { A: "2" }, structural: [createNodeOp("tmp:node:1"), deleteNodeOp(REAL_NODE_A)] });

    stack = pushPendingUndoEntry(stack, step0, structuralSnapEquals); // 드래그 직전
    stack = pushPendingUndoEntry(stack, step1, structuralSnapEquals); // 노드 추가 직전
    stack = pushPendingUndoEntry(stack, step2, structuralSnapEquals); // 또 드래그 직전
    stack = pushPendingUndoEntry(stack, step3, structuralSnapEquals); // 노드 삭제 직전
    assert.equal(stack.past.length, 4, "네 칸이 다 남아 있어야 아래 차례 검사가 뜻이 있다");

    const seen: string[] = [];
    let current = now;
    let cursor = stack;
    for (let i = 0; i < 4; i += 1) {
      const plan = undoStructuralPlan({ stack: cursor, currentPending: current });
      assert.ok(plan.action === "RESTORE_PENDING", `${i + 1}번째에서 멈췄다`);
      seen.push(`A=${plan.snapshot.layout.A ?? "-"}|조작${plan.snapshot.structural.length}`);
      current = plan.snapshot;
      cursor = plan.nextStack;
    }
    assert.deepEqual(seen, ["A=2|조작1", "A=1|조작1", "A=1|조작0", "A=-|조작0"]);
    assert.equal(undoStructuralPlan({ stack: cursor, currentPending: current }).action, "NONE", "더 되돌릴 것이 없다");
  });

  test("🔴 비교 함수가 구조 목록을 안 보면 그 단계가 **조용히 사라진다**", () => {
    // 저장 전 초안이 없는 노드를 지운 경우 — 지도는 앞뒤가 똑같고 구조 목록만
    // 늘어난다. 서명을 안 섞으면 planProcedureUndo 가 「헛도는 단계」로 보고 버린다.
    const stack = pushPendingUndoEntry(createProcedureEditorUndoStack<StructuralSnap>(), sSnap(), structuralSnapEquals);
    const current = sSnap({ structural: [deleteNodeOp(REAL_NODE_A)] });

    const broken = undoStructuralPlan({ stack, currentPending: current, pendingEquals: draftsOnlyEquals });
    assert.equal(broken.action, "NONE");
    assert.equal(broken.reason, "NOTHING_LEFT", "🔴 삭제를 되돌릴 길이 사라졌다 — 조각 4 가 서명을 안 섞으면 이 꼴이 된다");

    const fixed = undoStructuralPlan({ stack, currentPending: current });
    assert.equal(fixed.action, "RESTORE_PENDING", "서명을 섞으면 같은 자리에서 멀쩡히 돌아온다");
  });

  test("되돌렸다 [앞으로]를 누르면 목록이 그대로 돌아온다(왕복)", () => {
    const stack = pushPendingUndoEntry(createProcedureEditorUndoStack<StructuralSnap>(), sSnap(), structuralSnapEquals);
    const current = sSnap({ structural: [createNodeOp("tmp:node:1")] });

    const undone = undoStructuralPlan({ stack, currentPending: current });
    assert.ok(undone.action === "RESTORE_PENDING");

    const redone = planProcedureRedo({
      stack: undone.nextStack,
      currentPending: undone.snapshot,
      serverHasHistory: false,
      canUseHistory: true,
      isRunning: false,
      pendingEquals: structuralSnapEquals,
    });
    assert.ok(redone.action === "RESTORE_PENDING");
    assert.deepEqual(redone.snapshot.structural, current.structural);
  });
});

describe("절차 편집기 되돌리기 — ⑧ [저장]을 지나면 보낸 것은 서버 몫이 된다", () => {
  /** 저장 전 스냅샷 둘이 쌓여 있는 스택 — 「비워졌는가」를 재려면 먼저 차 있어야 한다. */
  function stackWithTwoPendingSteps(): ProcedureEditorUndoStack<StructuralSnap> {
    let stack = createProcedureEditorUndoStack<StructuralSnap>();
    stack = pushPendingUndoEntry(stack, sSnap(), structuralSnapEquals);
    stack = pushPendingUndoEntry(stack, sSnap({ layout: { A: "1" } }), structuralSnapEquals);
    return stack;
  }

  test("🔴 보낸 건수만큼 STRUCTURAL 이 서고, 옛 스냅샷은 **한 칸도 안 남는다**", () => {
    const before = stackWithTwoPendingSteps();
    assert.equal(before.past.length, 2, "비우기 전에 정말 차 있어야 아래 단언이 뜻이 있다");

    const after = planUndoStackAfterStructuralSave(before, {
      succeededOperations: [createNodeOp("tmp:node:1"), deleteNodeOp(REAL_NODE_A)],
    });
    assert.deepEqual(after.past, [{ kind: "STRUCTURAL" }, { kind: "STRUCTURAL" }]);
    assert.equal(
      after.past.filter((entry) => entry.kind === "PENDING").length,
      0,
      "🔴 옛 스냅샷은 이미 보낸 조작과 임시 번호를 들고 있어 거짓이 됐다"
    );
    assert.deepEqual(after.future, [], "[저장]은 새 조작이다 — 다시 적용할 미래가 무효가 된다");
  });

  test("🔴 그 스택에서 [이전]은 serverHasHistory 가 **꺼져 있어도** 서버로 간다 — 보낸 건수만큼", () => {
    // 화면은 부분 실패에서 router.refresh() 를 안 부른다. 그래서 「서버에 이력이
    // 있나」는 방금 보낸 것을 모른 채 낡아 있을 수 있다. 표시를 세워 두는 까닭이다.
    let cursor = planUndoStackAfterStructuralSave(stackWithTwoPendingSteps(), {
      succeededOperations: [createNodeOp("tmp:node:1"), deleteNodeOp(REAL_NODE_A)],
    });

    for (let i = 0; i < 2; i += 1) {
      const plan = undoStructuralPlan({ stack: cursor, currentPending: sSnap(), serverHasHistory: false });
      assert.equal(plan.action, "SERVER_HISTORY", `${i + 1}번째가 서버로 안 갔다`);
      assert.equal(plan.reason, "STACK_TOP_IS_STRUCTURAL");
      assert.ok(plan.action === "SERVER_HISTORY");
      cursor = plan.nextStack;
    }
    assert.equal(undoStructuralPlan({ stack: cursor, currentPending: sSnap(), serverHasHistory: false }).reason, "NOTHING_LEFT");
  });

  test("🔴 한 건도 안 갔으면 들어온 스택을 **그대로** 돌려준다(막힌 저장 · 첫 걸음에서 실패)", () => {
    const before = stackWithTwoPendingSteps();
    const after = planUndoStackAfterStructuralSave(before, { succeededOperations: [] });
    assert.equal(after, before, "서버에 아무 일도 안 일어났다 — 비우면 멀쩡한 되돌리기를 공짜로 버린다");
  });

  test("🔴 부분 실패 — **보낸 것만** 칸이 된다", () => {
    // 셋 가운데 둘이 성공하고 하나가 실패한 자리. 못 보낸 것은 서버에 없으므로
    // 되돌릴 거리도 없다(되돌리는 길은 「모두 취소」뿐이다 — 조각 4 의 몫).
    const after = planUndoStackAfterStructuralSave(stackWithTwoPendingSteps(), {
      succeededOperations: [createNodeOp("tmp:node:1"), createNodeOp("tmp:node:2")],
    });
    assert.equal(after.past.length, 2, "보낸 둘만 선다 — 못 보낸 하나는 칸이 없다");
  });

  test("전부 성공한 자리에서는 빈 스택을 넣어 부른다 — 표시만 남는다", () => {
    const after = planUndoStackAfterStructuralSave(createProcedureEditorUndoStack<StructuralSnap>(), {
      succeededOperations: [createNodeOp("tmp:node:1")],
    });
    assert.deepEqual(after, { past: [{ kind: "STRUCTURAL" }], future: [] });
  });

  test("구조 변경이 하나도 없던 저장이면 넘긴 스택 그대로다 — 화면의 '비우기'와 겹치지 않는다", () => {
    const empty = createProcedureEditorUndoStack<StructuralSnap>();
    assert.deepEqual(planUndoStackAfterStructuralSave(empty, { succeededOperations: [] }), { past: [], future: [] });
  });

  test("🔴 표시도 상한 50을 넘지 않는다 — 쌓는 쪽과 같은 값이다", () => {
    const many = Array.from({ length: 60 }, (_, index) => createNodeOp(`tmp:node:${index + 1}`));
    const after = planUndoStackAfterStructuralSave(createProcedureEditorUndoStack<StructuralSnap>(), { succeededOperations: many });
    assert.equal(after.past.length, MAX_UNDO_STEPS);
    assert.equal(MAX_UNDO_STEPS, 50);
  });
});
