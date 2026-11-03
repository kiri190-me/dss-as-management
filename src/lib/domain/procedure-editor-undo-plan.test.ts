import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createProcedureEditorUndoStack,
  pushPendingUndoEntry,
  pushStructuralUndoEntry,
  planProcedureUndo,
  planProcedureRedo,
  canRunUndoPlan,
  MAX_UNDO_STEPS,
  type ProcedureEditorUndoStack,
  type ProcedureUndoPlan,
} from "./procedure-editor-undo-plan";

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
