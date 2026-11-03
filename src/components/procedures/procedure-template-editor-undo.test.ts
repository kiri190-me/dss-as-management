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
    assert.ok(screen.includes("disabled={!hasAnyPendingChanges || globalSaveStatus === \"saving\"}"));
    assert.ok(functionBody(screen, "function handleExit()").includes("hasAnyPendingChanges"));
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

  test("🔴 handleSaved 자신은 아무것도 안 쌓는다 — 되돌리기도 그 통로를 지난다", () => {
    // 여기에 넣으면 [이전]이 제 흔적을 다시 쌓아 영영 안 끝난다.
    const saved = functionBody(screen, "function handleSaved(");
    assert.ok(!saved.includes("pushStructuralUndoStep"));
    assert.ok(functionBody(screen, "async function handleUndo()").includes("handleSaved(result.updatedAt)"));
  });

  test("🔴 구조 조작 여섯 자리가 전부 그 통로를 지난다", () => {
    for (const [tag, prop] of [
      ["NodePropertyPanel", "onSaved={handleStructuralSaved}"], // 노드 유형 변경
      ["EdgePropertyPanel", "onSaved={handleStructuralSaved}"], // 재연결 · 연결선 위 노드 삽입
      ["CreateEdgePanel", "onSaved={handleStructuralSaved}"], // 연결선 생성
      ["CreateNodePanel", "onSaved={handleStructuralSaved}"], // 노드 생성
      ["EditHistoryPanel", "onRestored={handleStructuralSaved}"], // 이력 복원
    ] as const) {
      assert.ok(flat(jsxElement(screen, tag)).includes(prop), `<${tag} 가 ${prop} 를 안 넘긴다`);
    }
    // 삭제 둘은 지우개 뒤처리가 있어 제 함수에서 같은 것을 쌓는다.
    assert.ok(functionBody(screen, "function handleNodeDeleted(").includes("pushStructuralUndoStep()"));
    assert.ok(functionBody(screen, "function handleEdgeDeleted(").includes("pushStructuralUndoStep()"));
    // 이름 변경은 성공 갈래에서 통로를 탄다.
    assert.ok(functionBody(screen, "async function handleRenameSubmit()").includes("handleStructuralSaved(result.updatedAt)"));
  });

  test("🔴 서버 액션이 **실패하면 안 쌓인다** — 알리는 쪽이 전부 성공 갈래 안이다", () => {
    const panels = [
      "src/components/procedures/editor/NodePropertyPanel.tsx",
      "src/components/procedures/editor/EdgePropertyPanel.tsx",
      "src/components/procedures/editor/CreateEdgePanel.tsx",
      "src/components/procedures/editor/CreateNodePanel.tsx",
      "src/components/procedures/editor/EditHistoryPanel.tsx",
    ];
    let checked = 0;
    for (const path of panels) {
      const source = flat(stripComments(read(path)));
      const calls = [...source.matchAll(/\b(onSaved|onDeleted|onRestored)\(result\./g)];
      assert.ok(calls.length > 0, `${path} 에 알리는 자리가 없다 — 시험이 아무것도 안 재고 있다`);
      for (const call of calls) {
        const before = source.slice(Math.max(0, call.index - 400), call.index);
        assert.ok(before.includes("if (!result.ok)"), `${path} 의 ${call[0]} 앞에 실패 검사가 없다`);
        checked += 1;
      }
    }
    assert.ok(checked >= 6, `성공 갈래를 ${checked} 자리밖에 못 셌다 — 여섯 이상이어야 한다`);
  });

  test("🔴 이름 변경도 실패하면 안 쌓인다", () => {
    const body = flat(functionBody(screen, "async function handleRenameSubmit()"));
    const guard = body.indexOf("if (!result.ok)");
    const push = body.indexOf("handleStructuralSaved(");
    assert.ok(guard !== -1 && push > guard);
  });

  test("전역 [저장]에 성공하면 스택을 비우는 동작은 그대로다", () => {
    const body = functionBody(screen, "async function handleGlobalSave()");
    assert.ok(body.includes("setPendingUndoStack(createProcedureEditorUndoStack<PendingSnapshot>())"));
    // 🔵 비워도 막히지 않는다 — 스택이 빈 채로 누르면 서버 이력 길이 받는다
    // (그 갈래 자체는 unit 목록의 procedure-editor-undo-plan.test.ts ⑥절이 본다).
    assert.ok(screen.includes("serverHasHistory: historyView.canUndo"));
    assert.ok(screen.includes("serverHasHistory: historyView.canRedo"));
  });

  test("「모두 취소」가 한 단계를 찍는 동작도 그대로다", () => {
    assert.ok(functionBody(screen, "function handleDiscardAllPending()").includes("pushPendingUndoStep()"));
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
