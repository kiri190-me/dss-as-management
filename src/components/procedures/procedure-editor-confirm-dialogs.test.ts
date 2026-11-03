import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 「기술 작업 절차」 편집기의 **확인 창 걷어내기**(2026-11-03, 줄기 B-②).
 *
 * ── 왜 이 시험이 있는가 ─────────────────────────────────────────────────
 * 사용자가 말한 것: "연결 추가라던가 뭔가 추가/수정 할 때마다 팝업이 뜨는데
 * 그런 팝업 안뜨도록 해줘." 그 팝업들은 성공 알림이 아니라 **「취소 / 추가」를
 * 묻는 확인 창**이었다. 그래서 없애는 일은 곧 **확인 단계를 없애는 일**이고,
 * 잘못 없애면 두 가지가 조용히 망가진다:
 *   ① 되돌릴 수 없는 조작(삭제·게시)의 확인까지 함께 사라진다 — 아무도 오류를
 *      보지 못하고, 사라진 뒤에야 안다.
 *   ② 확인 창이 **실패를 보여 주던 자리**이기도 했다 — 창을 지우면서 그
 *      자리까지 지우면 실패가 "아무 일도 안 일어남"으로 보인다(고장으로 읽힌다).
 * 그래서 「뺐는가」만 재지 않고 **「남겼는가」와 「실패를 알리는가」를 함께** 잰다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * 이 패널들은 서버 액션(@/lib/server/actions/...)을 직접 import 하는 클라이언트
 * 컴포넌트라 사슬 끝에 `server-only` 가 있고, ProcedureTemplateEditorScreen 은
 * @xyflow/react 의 .css 까지 끌고 온다 — 어느 목록에서도 import 자체가 던진다.
 * 이웃들(procedure-template-editor-undo.test.ts ·
 * procedure-publish-flow.test.tsx)이 같은 사정에서 쓴 방법을 그대로 쓴다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 「왜 없앴는지」를 그 자리 주석에 길게 적는다. 실제로 세 패널의
 * 머리말에 `<dialog>` 와 `[연결 검토]`·`[변경 검토]` 가 **글자 그대로** 남아
 * 있다. 주석을 안 걷으면 「창이 없어졌는가」가 영영 깨지고, 반대로 「남아
 * 있는가」 쪽은 주석만으로 영영 통과한다. ①절의 마지막 단언이 걷어내기가 실제로
 * 일을 하고 있다는 증거다.
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

const PATHS = {
  createEdge: "src/components/procedures/editor/CreateEdgePanel.tsx",
  createNode: "src/components/procedures/editor/CreateNodePanel.tsx",
  edgeProperty: "src/components/procedures/editor/EdgePropertyPanel.tsx",
  nodeProperty: "src/components/procedures/editor/NodePropertyPanel.tsx",
  history: "src/components/procedures/editor/EditHistoryPanel.tsx",
  publish: "src/components/procedures/editor/PublishTemplateButton.tsx",
  screen: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
} as const;

const createEdge = stripComments(read(PATHS.createEdge));
const createNode = stripComments(read(PATHS.createNode));
const edgeProperty = stripComments(read(PATHS.edgeProperty));
const nodeProperty = stripComments(read(PATHS.nodeProperty));
const history = stripComments(read(PATHS.history));
const publish = stripComments(read(PATHS.publish));
const screen = stripComments(read(PATHS.screen));

describe("절차 편집기 확인 창 — ① 먼저 표본 확인", () => {
  test("🔵 일곱 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ createEdge, createNode, edgeProperty, nodeProperty, history, publish, screen })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(createEdge.includes("async function handleAdd()"));
    assert.ok(createNode.includes("async function handleCreate()"));
    assert.ok(edgeProperty.includes("async function handleRetarget()"));
    assert.ok(nodeProperty.includes("function handleSelectNodeType("));
    assert.ok(nodeProperty.includes("async function handleChangeType("));
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 `<dialog>` 와 옛 단추 글자가 남아 있다", () => {
    // 없앤 까닭을 그 자리 주석에 적어 두었기 때문이다. 이 단언이 깨지면
    // (= 주석에서 그 글자가 사라지면) 아래 "창이 없다" 단언들이 주석을 안 걷어도
    // 통과하게 되어, 시험이 아무것도 안 재는 상태로 조용히 바뀐다.
    assert.ok(read(PATHS.createEdge).includes("<dialog>"), "CreateEdgePanel 머리말에 옛 모습이 적혀 있어야 한다");
    assert.ok(read(PATHS.createEdge).includes("연결 검토"));
    assert.ok(read(PATHS.edgeProperty).includes("<dialog>"));
    assert.ok(read(PATHS.edgeProperty).includes("변경 검토"));
    // 걷어낸 쪽에는 둘 다 없다.
    assert.ok(!createEdge.includes("<dialog"));
    assert.ok(!createEdge.includes("연결 검토"));
    assert.ok(!edgeProperty.includes("변경 검토"));
  });
});

describe("절차 편집기 확인 창 — ② 없앤 것: 확인 없이 바로 반영된다", () => {
  test("🔴 연결 추가 — 창이 없고, 단추가 서버 호출로 곧장 간다", () => {
    assert.ok(!createEdge.includes("<dialog"), "확인 창이 남아 있다");
    assert.ok(!createEdge.includes("setConfirming("), "창을 여닫던 상태가 남아 있다");
    assert.ok(!createEdge.includes("showModal()"));
    const button = flat(createEdge);
    assert.ok(button.includes("onClick={() => void handleAdd()}"), "단추가 창을 여는 대신 본체를 바로 불러야 한다");
    assert.ok(button.includes('{isSubmitting ? "추가 중..." : "연결 추가"}'), "단추 글자가 「검토」가 아니라 「추가」여야 한다");
    assert.ok(functionBody(createEdge, "async function handleAdd()").includes("await createProcedureTemplateEdgeAction("));
  });

  test("🔴 연결 추가 — 두 번 눌러도 두 번 안 나간다(창의 [추가] 단추가 하던 잠금을 단추가 물려받았다)", () => {
    assert.ok(flat(createEdge).includes("disabled={!canAdd || isSubmitting}"));
  });

  test("🔴 분기 대상 변경(재연결) — 창이 없고, 단추가 서버 호출로 곧장 간다", () => {
    assert.ok(!edgeProperty.includes("<dialog"), "확인 창이 남아 있다");
    assert.ok(!edgeProperty.includes("setConfirmingRetarget("));
    assert.ok(!edgeProperty.includes("showModal()"));
    const flatSource = flat(edgeProperty);
    assert.ok(flatSource.includes("onClick={() => void handleRetarget()}"));
    assert.ok(flatSource.includes('{isRetargeting ? "변경 중..." : "대상 변경"}'));
    assert.ok(flatSource.includes("|| isRetargeting}"), "도는 동안 단추가 잠겨야 한다");
    assert.ok(functionBody(edgeProperty, "async function handleRetarget()").includes("await retargetProcedureTemplateEdgeAction("));
  });

  test("🔴 노드 유형 변경 — 기술 작업 절차는 고르는 순간 적용된다", () => {
    const body = flat(functionBody(nodeProperty, "function handleSelectNodeType("));
    assert.match(
      body,
      /if \(value === node\.nodeType\) return; if \(isTechnical\) \{ void handleChangeType\(value\); return; \} setConfirmingTypeChange\(true\);/,
      "기술 작업 절차는 바로, 그 밖의 분류는 (사유를 받으려고) 창을 연다"
    );
    // 창을 여는 자리가 여기 하나뿐이다 — 다른 데서 또 열면 위 단언이 통과해도 창이 뜬다.
    assert.equal(nodeProperty.match(/setConfirmingTypeChange\(true\)/g)?.length, 1);
  });

  test("🔴 노드 유형 변경 — 고른 값을 **인자로** 넘긴다(state 를 읽으면 직전 유형이 간다)", () => {
    // 확인 창이 있던 시절에는 창을 띄우는 사이에 렌더가 한 번 돌아 state 가
    // 최신이었다. 바로 적용하는 지금은 같은 이벤트 안이라 state 가 아직 옛 값이다.
    assert.ok(nodeProperty.includes("async function handleChangeType(targetNodeType: ProcedureNodeType)"));
    assert.ok(flat(functionBody(nodeProperty, "async function handleChangeType(")).includes("newNodeType: targetNodeType,"));
  });

  test("🔴 노드 유형 변경 — 실패하면 드롭다운을 되돌린다(안 바뀐 유형이 골라진 채 남으면 화면이 거짓말을 한다)", () => {
    const body = flat(functionBody(nodeProperty, "async function handleChangeType("));
    assert.match(body, /if \(!result\.ok\) \{ setErrorMessage\(result\.message\); setNewNodeType\(node\.nodeType\); return; \}/);
  });

  test("🔴 노드 유형 변경 — 도는 동안 드롭다운이 잠긴다(창의 [적용] 단추가 하던 일)", () => {
    assert.ok(flat(nodeProperty).includes("disabled={!canEdit || isChangingType}"));
  });

  test("🔵 노드 추가는 원래부터 창이 없었다 — 이 조각이 되돌려 놓지 않았다", () => {
    assert.ok(!createNode.includes("<dialog"));
    assert.ok(flat(createNode).includes("onClick={() => void handleCreate()}"));
  });
});

describe("절차 편집기 확인 창 — ③ 남긴 것: 여전히 묻는다", () => {
  test("🟢 이력 복원은 여전히 묻는다 — 되돌릴 수는 있어도 초안 전체가 과거로 갈아끼워진다", () => {
    const body = functionBody(history, "async function handleRestoreClick(");
    assert.ok(body.includes("window.confirm("), "복원 확인이 사라졌다");
    assert.ok(body.includes("계속하시겠습니까?"));
    assert.ok(body.includes("if (!confirmed) return;"), "묻기만 하고 답을 안 보면 묻지 않는 것과 같다");
  });

  test("🟢 편집기 나가기 확인은 그대로다 — 저장 전 변경을 들고 나가는 것은 추가/수정이 아니다", () => {
    const body = functionBody(screen, "function handleExit()");
    assert.ok(body.includes("window.confirm(\"저장하지 않은 변경사항이 있습니다. 나가시겠습니까?\")"));
    assert.ok(body.includes("hasAnyPendingChanges &&"));
  });

  test("🟢 게시 확인 창은 그대로다 — 되돌리기 밖의 일이다", () => {
    assert.ok(publish.includes("<dialog"), "게시는 다시 초안으로 못 돌린다 — 창이 사라지면 안 된다");
    assert.ok(publish.includes("기술 절차 게시"));
    assert.ok(publish.includes("되돌릴 수 없"));
  });

  test("🔴 사유가 **필수**인 분류의 노드 유형 변경 창은 남아 있다 — 확인이 아니라 입력을 받는 창이다", () => {
    // 서버가 FULL_SERVICE/REFERENCE 에서 빈 사유를 거절한다
    // (changeProcedureTemplateNodeType). 사유 칸이 이 창 안에만 있으므로, 창을
    // 통째로 없애면 유형 변경이 "눌러도 빨간 글씨만 뜨는" 죽은 기능이 된다.
    assert.ok(nodeProperty.includes("<dialog"));
    assert.ok(nodeProperty.includes('id="node-type-confirm-title"'));
    assert.ok(flat(nodeProperty).includes("value={typeChangeReason}"), "창이 받는 것은 확인이 아니라 사유다");
    assert.ok(nodeProperty.includes("const canConfirmTypeChange = newNodeType !== node.nodeType && (isTechnical || typeChangeReason.trim().length > 0)"));
    // 🔵 서버 쪽 규칙이 정말 그런가 — 화면 혼자 믿고 남기는 것이 아니다.
    const mutation = stripComments(read("src/lib/db/mutations/procedure-template-editor.ts"));
    const changeType = functionBody(mutation, "export async function changeProcedureTemplateNodeType(");
    assert.ok(changeType.includes('template.category !== "TECHNICAL_TASK" && isBlank(reason)'));
  });

  test("🔴 삭제 둘은 손대지 않았다 — 사용자가 말한 것은 추가/수정이다", () => {
    // 🔴 실측(2026-11-03): 이 편집기의 **노드 삭제·분기 삭제에는 원래부터 확인
    // 창이 없다.** 사유 칸 하나와 단추 하나뿐이다. 그래서 여기서 "여전히
    // 묻는가"는 잴 수가 없다 — 대신 이 조각이 삭제 길을 **조금도** 건드리지
    // 않았음을 못 박는다. 확인 창을 새로 더할지는 이 조각의 일이 아니다.
    const nodeDelete = flat(functionBody(nodeProperty, "async function handleDelete()"));
    assert.ok(nodeDelete.includes("await deleteProcedureTemplateNodeAction({ nodeId: node.id, reason: deleteReason,"));
    assert.ok(flat(nodeProperty).includes('{isDeleting ? "삭제 중..." : "노드 삭제"}'));
    assert.ok(flat(nodeProperty).includes("placeholder=\"삭제 사유 (선택)\""));

    const edgeDelete = flat(functionBody(edgeProperty, "async function handleDelete()"));
    assert.ok(edgeDelete.includes("await deleteProcedureTemplateEdgeAction({ edgeId: edge.id, reason: deleteReason,"));
    assert.ok(flat(edgeProperty).includes('{isDeleting ? "삭제 중..." : "분기 삭제"}'));
  });
});

describe("절차 편집기 확인 창 — ④ 실패하면 사람이 안다", () => {
  test("🔴 세 패널 모두 실패 갈래에서 서버가 준 이유를 그대로 받아 둔다", () => {
    for (const [name, source] of [
      ["CreateEdgePanel", createEdge],
      ["EdgePropertyPanel", edgeProperty],
      ["NodePropertyPanel", nodeProperty],
    ] as const) {
      assert.match(flat(source), /if \(!result\.ok\) \{ setErrorMessage\(result\.message\);/, `${name} 가 실패 이유를 안 받는다`);
    }
  });

  test("🔴 받아 둔 이유를 화면에 **그린다** — 창이 없어진 지금 이 자리가 유일한 통로다", () => {
    const paint = '{errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}';
    assert.ok(flat(createEdge).includes(paint));
    assert.ok(flat(edgeProperty).includes(paint));
    assert.ok(flat(nodeProperty).includes(paint));
    // 창이 있던 시절에는 같은 글을 창 안에도 한 벌 더 그렸다. 창을 없앴으니
    // 연결 추가·재연결은 한 자리만 남아야 한다(둘이면 안 지워진 창이 있다는 뜻).
    assert.equal(flat(createEdge).match(/\{errorMessage && </g)?.length, 1);
    assert.equal(flat(edgeProperty).match(/\{errorMessage && </g)?.length, 1);
  });

  test("🔵 성공 알림은 따로 띄우지 않는다 — 지도에 나타나는 것이 증거다(조각 13 과 같은 판단)", () => {
    for (const source of [createEdge, edgeProperty, nodeProperty, createNode]) {
      assert.ok(!/SavePopup/.test(source), "SavePopup 은 0.5초 뒤 저절로 닫히는 성공 전용 창이다 — 여기 쓸 자리가 아니다");
      assert.ok(!/window\.alert\(/.test(source));
    }
    // 지도가 다시 그려지는 길: 패널의 onSaved → 화면의 handleStructuralSaved →
    // handleSaved → router.refresh(). 그 끝단이 살아 있는지만 본다.
    assert.ok(functionBody(screen, "function handleSaved(").includes("router.refresh();"));
  });
});

describe("절차 편집기 확인 창 — ⑤ 줄기 B-① 의 되돌리기를 안 깨뜨렸다", () => {
  test("🔴 알리는 자리가 전부 실패 검사 **뒤**다 — 실패한 호출을 쌓으면 멀쩡한 변경이 대신 날아간다", () => {
    // procedure-template-editor-undo.test.ts 와 겹치는 단언이다. 일부러 겹쳐
    // 둔다 — 확인 창을 걷어내며 호출 순서를 흐트러뜨리는 사고가 바로 이 세
    // 파일에서 나고, 그때 이 파일이 먼저 깨지는 편이 원인을 찾기 쉽다.
    let checked = 0;
    for (const [name, source] of [
      ["CreateEdgePanel", createEdge],
      ["EdgePropertyPanel", edgeProperty],
      ["NodePropertyPanel", nodeProperty],
    ] as const) {
      const flatSource = flat(source);
      const calls = [...flatSource.matchAll(/\b(onSaved|onDeleted)\(result\./g)];
      assert.ok(calls.length > 0, `${name} 에 알리는 자리가 없다 — 시험이 아무것도 안 재고 있다`);
      for (const call of calls) {
        const before = flatSource.slice(Math.max(0, call.index - 400), call.index);
        assert.ok(before.includes("if (!result.ok)"), `${name} 의 ${call[0]} 앞에 실패 검사가 없다`);
        checked += 1;
      }
    }
    assert.ok(checked >= 6, `성공 갈래를 ${checked} 자리밖에 못 셌다 — 여섯 이상이어야 한다`);
  });

  test("🔴 화면이 세 패널을 여전히 handleStructuralSaved 로 묶는다 — 여기가 되돌리기 한 걸음이 쌓이는 자리다", () => {
    for (const tag of ["NodePropertyPanel", "EdgePropertyPanel", "CreateEdgePanel"] as const) {
      assert.ok(flat(jsxElement(screen, tag)).includes("onSaved={handleStructuralSaved}"), `<${tag} 의 통로가 끊겼다`);
    }
    assert.ok(functionBody(screen, "function handleStructuralSaved(").includes("pushStructuralUndoStep();"));
  });
});
