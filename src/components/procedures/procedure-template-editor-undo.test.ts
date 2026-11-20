import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 「기술 작업 절차」 편집기의 [이전]/[앞으로] — **화면 쪽 글루**(2026-11-03, 줄기 B-①).
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureTemplateEditorScreen 은 @xyflow/react 의 .css 와 서버 액션
 * (→ server-only)을 사슬로 물고 있어, 어느 목록에서도 import 자체가 던진다.
 * 그래서 이웃들(execution-current-task.test.ts · procedure-publish-flow.test.tsx)이
 * 같은 사정에서 쓴 방법을 그대로 쓴다 — 판정이 적혀 있는 자리를 원본에서 본다.
 *
 * ── 무엇을 여기서 재고 무엇을 저쪽에서 재는가 ───────────────────────────
 * **고르는 규칙 자체**(맨 위가 무엇이면 무엇을 하는가 · 역순 · 상한 50)는
 * unit 목록의 lib/domain/procedure-editor-undo-plan.test.ts 가 값으로 본다.
 * 여기서 못 박는 것은 **화면이 그 규칙을 제대로 물고 있는가** 하나다 —
 * 버그가 살던 자리가 바로 이 글루였고, 이 파일을 겨냥한 시험이 0개였다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 「왜」를 길게 적는다. 없앤 안내 문구를 「왜 없앴는지」 주석에
 * 적어 두었으므로, 주석을 안 걷으면 「그 문구가 사라졌는가」가 영영 깨진다.
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const screen = stripComments(read("src/components/procedures/ProcedureTemplateEditorScreen.tsx"));
const screenFlat = flat(screen);

/** `start` 로 시작해 괄호 깊이가 0으로 돌아올 때까지 — 함수 하나의 몸통만 떼어 낸다. */
function functionBody(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  assert.fail(`${start} 의 몸통이 안 닫혔다`);
}

/** JSX 요소 하나(여는 태그부터 `/>` 까지). */
function jsxElement(source: string, tag: string): string {
  const from = source.indexOf(`<${tag}`);
  assert.notEqual(from, -1, `원본에서 <${tag} 를 못 찾았다`);
  const to = source.indexOf("/>", from);
  assert.notEqual(to, -1, `<${tag} 가 안 닫혔다`);
  return source.slice(from, to + 2);
}

describe("절차 편집기 [이전]/[앞으로] — 화면이 판정을 가져다 쓴다", () => {
  test("🔵 먼저 표본 확인 — 되돌리기 두 손잡이가 실제로 이 파일에 있다", () => {
    assert.ok(screen.includes("async function handleUndo()"));
    assert.ok(screen.includes("async function handleRedo()"));
    assert.ok(screen.includes("<UndoRedoControls"));
  });

  test("🔴 판정은 lib/domain 의 순수 함수에서 온다 — 화면이 제 손으로 다시 고르지 않는다", () => {
    assert.ok(screenFlat.includes('from "@/lib/domain/procedure-editor-undo-plan"'));
    assert.ok(screen.includes("planProcedureUndo({"));
    assert.ok(screen.includes("planProcedureRedo({"));
  });

  test("🔴 옛 두 갈래 코드가 남아 있지 않다", () => {
    // 이 넷이 남아 있으면 화면이 아직 스택을 제 손으로 뒤지고 있다는 뜻이다.
    for (const gone of ["undoStep(", "redoStep(", "canUndoStack(", "canRedoStack("]) {
      assert.ok(!screen.includes(gone), `${gone} 가 아직 남아 있다`);
    }
  });

  test("🔴 되돌리기 조건에서 hasAnyPendingChanges 가 빠졌다 — 그것이 삭제를 막던 가드였다", () => {
    const undo = functionBody(screen, "async function handleUndo()");
    const redo = functionBody(screen, "async function handleRedo()");
    assert.ok(!undo.includes("hasAnyPendingChanges"));
    assert.ok(!redo.includes("hasAnyPendingChanges"));
    assert.ok(!jsxElement(screen, "UndoRedoControls").includes("hasAnyPendingChanges"));
  });

  test("🔵 그래도 hasAnyPendingChanges 를 지우지는 않았다 — [저장]·[취소]·나가기 확인이 계속 쓴다", () => {
    assert.ok(screen.includes("const hasAnyPendingChanges ="));
    // 🔴 2026-11-20(조각 4) — [저장] 단추의 조건에 `!canSendStructural` 이 한 칸
    //    늘었다(보낼 수 없는 구조 변경이 있으면 막는다). hasAnyPendingChanges 는
    //    그대로 남아 있어야 한다 — 빠지면 저장 대기가 없는데도 단추가 켜진다.
    assert.ok(screen.includes("disabled={!hasAnyPendingChanges || !canSendStructural || globalSaveStatus === \"saving\"}"));
    assert.ok(functionBody(screen, "function handleExit()").includes("hasAnyPendingChanges"));
    // 🔴 그리고 그 값이 **저장 전 구조 변경까지 센다.** 안 세면 노드만 추가한
    //    상태에서 나가기가 아무것도 안 묻고, 그 추가가 통째로 사라진다.
    assert.ok(
      flat(screen).includes("dirtyRouteEdgeIds.length + structuralPendingCount;"),
      "나가기 경고가 저장 전 구조 변경을 못 본다 — 묻지도 않고 날아간다"
    );
  });

  test("🔴 단추를 켜는 조건과 눌렀을 때 도는 코드가 **같은 계획 하나**를 본다", () => {
    const controls = flat(jsxElement(screen, "UndoRedoControls"));
    assert.ok(controls.includes("canUndo={canRunUndoPlan(undoPlan)}"));
    assert.ok(controls.includes("canRedo={canRunUndoPlan(redoPlan)}"));
    assert.ok(functionBody(screen, "async function handleUndo()").includes("undoPlan."));
    assert.ok(functionBody(screen, "async function handleRedo()").includes("redoPlan."));
  });

  test("🔴 「저장하지 않은 변경사항이 있어 … 사용할 수 없습니다」 안내가 사라졌다", () => {
    // 잠기는 상태 자체가 없어졌으므로 할 말이 없다. 🔵 주석을 안 걷으면 이
    // 단언이 영영 깨진다(없앤 까닭을 그 자리 주석에 적어 두었다).
    assert.ok(!screen.includes("실행 취소/다시 실행"));
    assert.ok(!screen.includes("먼저 저장하거나 취소하세요"));
    // 🔵 표본 확인 — 걷어내기 전 원본에는 그 글자가 **주석으로** 남아 있다.
    // 주석을 안 걷고 재면 위 단언이 영영 깨지므로, 이 줄이 걷어내기가 실제로
    // 일을 하고 있다는 증거다.
    assert.ok(read("src/components/procedures/ProcedureTemplateEditorScreen.tsx").includes("실행 취소/다시 실행"));
  });
});

describe("절차 편집기 [이전]/[앞으로] — 두 번 누르기와 실패를 막는다", () => {
  test("🔴 서버 되돌리기를 부르기 **전에** 빗장을 건다(state 는 다음 렌더에야 단추에 닿는다)", () => {
    for (const [name, action] of [
      ["async function handleUndo()", "undoProcedureTemplateChangeAction"],
      ["async function handleRedo()", "redoProcedureTemplateChangeAction"],
    ] as const) {
      const body = functionBody(screen, name);
      const lock = body.indexOf("undoRedoInFlightRef.current = true");
      const call = body.indexOf(`await ${action}`);
      assert.notEqual(lock, -1, `${name} 에 빗장이 없다`);
      assert.notEqual(call, -1);
      assert.ok(lock < call, `${name} 의 빗장이 서버 호출보다 늦다`);
      assert.ok(body.includes("undoRedoInFlightRef.current) return"), `${name} 가 빗장을 읽지 않는다`);
      assert.ok(body.indexOf("undoRedoInFlightRef.current = false") > call, `${name} 가 빗장을 안 푼다`);
    }
  });

  test("🔴 서버가 실패하면 스택을 건드리지 않는다 — 일어나지 않은 되돌리기가 사라지면 안 된다", () => {
    for (const [name, plan, action] of [
      ["async function handleUndo()", "undoPlan", "undoProcedureTemplateChangeAction"],
      ["async function handleRedo()", "redoPlan", "redoProcedureTemplateChangeAction"],
    ] as const) {
      // 🔴 서버를 부른 **뒤**만 잘라서 본다. 그 앞의 RESTORE_PENDING 갈래도
      // 같은 줄을 쓰므로, 몸통 전체에서 세면 "실패 검사 뒤에도 하나 있다"로
      // 늘 통과한다 — 가장 먼저 나오는 반영이 실패 검사 뒤여야 한다.
      const afterCall = functionBody(screen, name).split(`await ${action}`)[1];
      assert.ok(afterCall, `${name} 에서 서버 호출을 못 찾았다`);
      const guard = afterCall.indexOf("if (!result.ok)");
      const apply = afterCall.indexOf(`setPendingUndoStack(${plan}.nextStack)`);
      assert.notEqual(guard, -1);
      assert.notEqual(apply, -1, `${name} 가 성공 뒤에 스택을 안 반영한다`);
      assert.ok(apply > guard, `${name} 가 실패 검사보다 먼저 스택을 반영한다`);
    }
  });
});

describe("절차 편집기 [이전]/[앞으로] — 구조 변경이 성공했을 때만 한 걸음이 쌓인다", () => {
  test("🔵 먼저 표본 확인 — 쌓는 손잡이가 하나뿐이다", () => {
    assert.equal(screen.match(/const pushStructuralUndoStep = useCallback/g)?.length, 1);
    assert.ok(screen.includes("function handleStructuralSaved("));
  });

  test("🔴 **서버 이력 표시를 세우는 자리가 handleStructuralSaved 한 곳뿐**이다 — 둘이면 한 변경에 칸이 둘 선다", () => {
    // 🔴 2026-11-20(조각 4) 에 실제로 빠지기 쉬운 자리다. 모아 두는 통로
    //    (queueStructural)에서 이것을 함께 부르면 한 변경에 PENDING 한 칸과
    //    STRUCTURAL 한 칸이 같이 쌓여, [이전]을 두 번 눌러야 한 걸음이 돌아간다.
    //    그 둘째 칸은 서버 이력으로 가므로 **남의 변경이 대신 되돌려진다.**
    const uses = screen.match(/pushStructuralUndoStep\(\)/g) ?? [];
    assert.equal(uses.length, 1, `표시를 세우는 자리가 ${uses.length} 곳이다 — handleStructuralSaved 하나여야 한다`);
    assert.ok(functionBody(screen, "function handleStructuralSaved(").includes("pushStructuralUndoStep();"));
    // 🔵 모아 두는 통로는 **PENDING 쪽**만 쌓는다(아직 서버에 간 것이 없다).
    const queue = flat(functionBody(screen, "function queueStructural("));
    assert.ok(queue.includes("pushPendingUndoStep();"));
    assert.ok(!queue.includes("pushStructuralUndoStep"), "아직 안 보낸 변경에 서버 이력 표시를 세우고 있다");
  });

  test("🔴 handleSaved 자신은 아무것도 안 쌓는다 — 되돌리기도 그 통로를 지난다", () => {
    // 여기에 넣으면 [이전]이 제 흔적을 다시 쌓아 영영 안 끝난다.
    const saved = functionBody(screen, "function handleSaved(");
    assert.ok(!saved.includes("pushStructuralUndoStep"));
    assert.ok(functionBody(screen, "async function handleUndo()").includes("handleSaved(result.updatedAt)"));
  });

  /**
   * 🔴 2026-11-20(조각 4) — **이 절의 전제가 절반 바뀌었다.**
   *
   * 「구조 변경은 서버가 이미 저장했으니 표시만 한 칸 쌓는다」가 일곱(노드 추가·
   * 삭제·유형 변경 · 연결선 추가·삭제·재연결 · 연결선 위 노드 끼우기)에 대해서는
   * 더 이상 참이 아니다. 그 일곱은 **[저장] 때까지 모였다가** 한 번에 간다.
   *
   *   · 모아 둘 때   → PENDING 스냅샷 한 칸(queueStructural 이 목록을 고치기 **전에**)
   *   · 저장이 지난 뒤 → 보낸 건수만큼 STRUCTURAL 표시(planUndoStackAfterStructuralSave)
   *
   * 🔴 그래서 **둘 다 쌓으면 안 된다** — 한 변경에 칸이 둘이 되어 [이전]을 두 번
   * 눌러야 한 걸음이 된다. 아래가 그 둘을 갈라 지킨다.
   */
  test("🔴 구조 조작 일곱이 **모아 두는 손잡이**로 가고, 즉시 저장 셋만 옛 통로에 남았다", () => {
    for (const [tag, prop] of [
      ["NodePropertyPanel", "onQueueChangeType={"], // 노드 유형 변경
      ["NodePropertyPanel", "onQueueDelete={"], // 노드 삭제
      ["EdgePropertyPanel", "onQueueRetarget={"], // 재연결
      ["EdgePropertyPanel", "onQueueDelete={"], // 연결선 삭제
      ["EdgePropertyPanel", "onQueueInsertNode={"], // 연결선 위 노드 끼우기
      ["CreateEdgePanel", "onQueueCreate={handleQueueCreateEdge}"], // 연결선 생성
      ["CreateNodePanel", "onQueueCreate={handleQueueCreateNode}"], // 노드 생성
      ["EditHistoryPanel", "onRestored={handleStructuralSaved}"], // 이력 복원 — 여전히 즉시
    ] as const) {
      assert.ok(flat(jsxElement(screen, tag)).includes(prop), `<${tag} 가 ${prop} 를 안 넘긴다`);
    }
    // 🔴 **옛 통로가 그 일곱에 다시 붙으면 안 된다** — 붙으면 표시가 두 번 선다.
    assert.ok(!flat(jsxElement(screen, "NodePropertyPanel")).includes("handleStructuralSaved"));
    assert.ok(!flat(jsxElement(screen, "EdgePropertyPanel")).includes("handleStructuralSaved"));
    assert.ok(!flat(jsxElement(screen, "CreateEdgePanel")).includes("handleStructuralSaved"));
    assert.ok(!flat(jsxElement(screen, "CreateNodePanel")).includes("handleStructuralSaved"));
    // 🔵 삭제 둘의 지우개 뒤처리는 **모아 두는 손잡이 안으로** 옮겨 갔다.
    assert.ok(!screen.includes("function handleNodeDeleted("), "옛 즉시 삭제 통로가 아직 남아 있다");
    assert.ok(!screen.includes("function handleEdgeDeleted("));
    assert.ok(flat(screen).includes("function handleQueueDeleteNode(nodeId: string, reason: string | null) {"));
    // 이름 변경은 여전히 즉시 저장이고, 성공 갈래에서 통로를 탄다.
    assert.ok(functionBody(screen, "async function handleRenameSubmit()").includes("handleStructuralSaved(result.updatedAt)"));
  });

  test("🔴 모아 두는 손잡이가 **목록을 고치기 전에** 한 칸을 찍는다 — 뒤에 찍으면 [이전]이 한 칸씩 밀린다", () => {
    const body = flat(functionBody(screen, "function queueStructural("));
    const push = body.indexOf("pushPendingUndoStep();");
    const mutate = body.indexOf("setPendingStructuralOperations(");
    assert.ok(push !== -1 && mutate !== -1 && push < mutate, "목록을 고친 뒤에 찍고 있다");
    // 🔴 그리고 그 칸이 **버려지지 않아야** 한다. 구조 조작만 바뀐 단계는 지도
    //    다섯이 똑같아서, 견주기에 구조 목록 서명을 안 섞으면 「헛도는 단계」로
    //    조용히 버려진다(조각 3 의 ⑦절이 값으로 그 꼴을 시연한다).
    assert.ok(
      flat(screen).includes("procedureStructuralOperationsSignature(snapshot.structuralOperations),"),
      "서명을 안 섞으면 노드 추가 한 칸이 [이전]에서 통째로 사라진다"
    );
    // 🔵 스냅샷에 그 목록이 실제로 실려 있어야 서명에 뜻이 있다.
    assert.ok(flat(screen).includes("structuralOperations: pendingStructuralOperations,"));
  });

  test("🔴 서버 액션이 **실패하면 안 쌓인다** — 즉시 저장이 남은 쪽만 해당한다", () => {
    // 🔴 2026-11-20(조각 4) — 패널 넷에서 서버 호출이 사라져, 여기서 셀 수 있는
    //    것은 **여전히 즉시 저장되는 패널**뿐이다. 그 대신 ①절에서 「패널 넷이
    //    서버 액션을 하나도 안 부른다」를 따로 못 박는다
    //    (procedure-editor-confirm-dialogs.test.ts ①절).
    const panels = ["src/components/procedures/editor/EditHistoryPanel.tsx", "src/components/procedures/editor/FieldAddedStepsPanel.tsx"];
    let checked = 0;
    for (const path of panels) {
      const source = flat(stripComments(read(path)));
      const calls = [...source.matchAll(/\b(onSaved|onDeleted|onRestored|onAdopted)\(result\./g)];
      assert.ok(calls.length > 0, `${path} 에 알리는 자리가 없다 — 시험이 아무것도 안 재고 있다`);
      for (const call of calls) {
        const before = source.slice(Math.max(0, call.index - 400), call.index);
        assert.ok(before.includes("if (!result.ok)"), `${path} 의 ${call[0]} 앞에 실패 검사가 없다`);
        checked += 1;
      }
    }
    assert.ok(checked >= 2, `성공 갈래를 ${checked} 자리밖에 못 셌다 — 둘 이상이어야 한다`);
  });

  test("🔴 이름 변경도 실패하면 안 쌓인다", () => {
    const body = flat(functionBody(screen, "async function handleRenameSubmit()"));
    const guard = body.indexOf("if (!result.ok)");
    const push = body.indexOf("handleStructuralSaved(");
    assert.ok(guard !== -1 && push > guard);
  });

  test("🔴 전역 [저장]에 성공하면 스택을 비우되, **보낸 구조 변경만큼 표시를 세운다**", () => {
    const body = functionBody(screen, "async function handleGlobalSave()");
    // 🔴 2026-11-20(조각 4) — 그냥 비우기만 하면 이번 저장이 보낸 구조 변경이
    //    [이전]으로 되돌아갈 차례를 못 받는다. 그 갈래는 serverHasHistory 를 믿는데
    //    그 값은 서버에서 그려 온 것이라 방금 적힌 것이 아직 안 비쳐 있다
    //    (router.refresh() 가 닿기 전이다). 그래서 빈 스택을 넣어 계획 함수를 부른다.
    assert.ok(
      flat(body).includes("setPendingUndoStack(planUndoStackAfterStructuralSave(createProcedureEditorUndoStack<PendingSnapshot>(), { succeededOperations: succeededStructuralOperations }));"),
      "비우기만 하면 방금 보낸 구조 변경을 [이전]으로 못 되돌린다"
    );
    // 🔵 구조 변경이 0건이면 그 함수가 들어온 빈 스택을 그대로 돌려준다 — 전 동작과 같다.
    assert.ok(screen.includes("serverHasHistory: historyView.canUndo"));
    assert.ok(screen.includes("serverHasHistory: historyView.canRedo"));
  });

  test("🔴 부분 실패에서도 스택을 손본다 — 이미 보낸 것을 든 옛 스냅샷은 거짓이다", () => {
    // 🔴 구조가 전부 성공한 뒤 칸 값 단계가 깨진 자리다. 그대로 두면 옛 스냅샷이
    //    「아직 안 보냄」이라고 말하는데 이미 보냈고, 되돌려 다시 저장하면 같은
    //    노드가 두 번 만들어진다.
    const body = flat(functionBody(screen, "async function handleGlobalSave()"));
    const calls = body.match(/setPendingUndoStack\(\(prev\) => planUndoStackAfterStructuralSave\(prev, \{ succeededOperations: succeededStructuralOperations \}\)\);/g) ?? [];
    assert.equal(calls.length, 2, `끝나는 자리 둘(구조 멈춤 · 칸 값 실패)에서 모두 손봐야 한다 — 지금 ${calls.length}곳`);
  });

  test("「모두 취소」가 한 단계를 찍는 동작도 그대로다 — 🔴 그리고 **구조 목록도 함께 비운다**", () => {
    const body = functionBody(screen, "function handleDiscardAllPending()");
    assert.ok(body.includes("pushPendingUndoStep()"));
    // 🔴 안 비우면 취소한 뒤에도 노드 추가가 살아남아 다음 [저장]에 조용히 따라간다.
    //    그리고 이것이 **부분 실패로 남은 조작을 치우는 유일한 길**이다 — 못 보낸
    //    조작은 되돌리기 스택에 제 칸이 없다.
    assert.ok(body.includes("setPendingStructuralOperations([]);"), "취소해도 저장 전 구조 변경이 살아남는다");
  });
});

describe("절차 편집기 [이전]/[앞으로] — 옆 편집기를 안 깨뜨렸다", () => {
  const controls = stripComments(read("src/components/graph-editor-core/UndoRedoControls.tsx"));
  const caseScreen = stripComments(read("src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx"));

  test("🔴 공용 단추의 프롭이 그대로 여섯이다 — 「진단 Flowchart 편집기」와 함께 쓴다", () => {
    for (const prop of ["canUndo: boolean", "canRedo: boolean", "isUndoing: boolean", "isRedoing: boolean", "onUndo: () => void", "onRedo: () => void"]) {
      assert.ok(flat(controls).includes(prop), `${prop} 가 없어졌다`);
    }
  });

  test("🔴 진단 Flowchart 편집기는 예전 그대로 클라이언트 스택만 쓴다", () => {
    const element = flat(jsxElement(caseScreen, "UndoRedoControls"));
    assert.ok(element.includes("canUndo={canUndoStack(pendingUndoStack)}"));
    assert.ok(element.includes("canRedo={canRedoStack(pendingUndoStack)}"));
    assert.ok(!caseScreen.includes("procedure-editor-undo-plan"), "서버 이력이 없는 편집기에 절차용 판정을 끌고 오지 않았다");
    assert.ok(flat(caseScreen).includes('from "@/lib/graph-editor-core/undo-stack"'));
  });

  test("🔴 공용 스택의 상한을 안 건드렸다(사용자 요청은 20이었고 이미 50이다)", () => {
    assert.ok(stripComments(read("src/lib/graph-editor-core/undo-stack.ts")).includes("export const MAX_UNDO_STEPS = 50;"));
  });
});
