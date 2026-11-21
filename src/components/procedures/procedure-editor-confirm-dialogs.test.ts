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
 * ── 🔴 2026-11-20(조각 4) — **네 패널이 서버를 더 이상 안 부른다** ──────────
 * 쓰는 분의 요청으로 구조 변경 일곱(노드 추가·삭제·유형 변경 · 연결선 추가·삭제·
 * 재연결 · 연결선 위 노드 끼우기)이 **[저장]을 눌러야** 저장되게 바뀌었다. 그래서
 * 이 파일이 재던 것 가운데 둘이 **뜻이 달라졌다.**
 *
 *  · 「단추가 **서버 호출**로 곧장 간다」 → 「단추가 **모아 두기**로 곧장 간다」.
 *    창을 없앤 그 판단(되돌릴 수 있는 추가에 한 번 더 묻지 않는다)은 그대로다.
 *  · 「실패를 알리는 자리가 패널 안에 있다」 → **그 자리가 화면 한 곳으로 옮겨
 *    갔다.** 패널에는 실패할 호출이 한 건도 안 남았기 때문이다. 없앤 것이 아니라
 *    옮긴 것이므로, 아래 ④절은 **옮겨 간 자리에 글이 서는지**를 잰다.
 *
 * 🔴 그리고 **새로 지켜야 할 것**이 하나 생겼다 — 패널이 서버 액션을 **다시
 * 부르면 안 된다.** 한 곳이라도 되돌아가면 그 조작만 [저장] 없이 몰래 저장되고,
 * 그 쪽은 화면에서 티가 안 난다(지도는 어차피 바뀌어 보인다).
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
    // 🔴 2026-11-20(조각 4) — 넷 다 `async` 가 떨어졌다. 기다릴 서버 호출이
    //    없어졌기 때문이고, 그것이 이 조각의 핵심이다.
    assert.ok(createEdge.includes("function handleAdd()"));
    assert.ok(!createEdge.includes("async function handleAdd()"), "아직 서버를 기다리고 있다");
    assert.ok(createNode.includes("function handleCreate()"));
    assert.ok(!createNode.includes("async function handleCreate()"));
    assert.ok(edgeProperty.includes("function handleRetarget()"));
    assert.ok(!edgeProperty.includes("async function handleRetarget()"));
    assert.ok(nodeProperty.includes("function handleSelectNodeType("));
    assert.ok(nodeProperty.includes("function handleChangeType("));
    assert.ok(!nodeProperty.includes("async function handleChangeType("));
  });

  test("🔴 네 패널 어디에도 구조 변경 서버 액션이 **남아 있지 않다** — 하나라도 남으면 그 조작만 몰래 저장된다", () => {
    // 🔴 「[저장]을 눌러야 저장된다」가 깨지는 길은 **한 패널이 옛 길로 돌아가는
    //    것** 하나뿐이고, 화면에서는 티가 안 난다(지도는 어차피 바뀌어 보인다).
    //    그래서 글자로 못 박는다.
    const structuralActions = [
      "createProcedureTemplateNodeAction",
      "deleteProcedureTemplateNodeAction",
      "changeProcedureTemplateNodeTypeAction",
      "createProcedureTemplateEdgeAction",
      "deleteProcedureTemplateEdgeAction",
      "retargetProcedureTemplateEdgeAction",
      "insertProcedureTemplateNodeOnEdgeAction",
    ];
    for (const [name, source] of [
      ["CreateEdgePanel", createEdge],
      ["CreateNodePanel", createNode],
      ["EdgePropertyPanel", edgeProperty],
      ["NodePropertyPanel", nodeProperty],
    ] as const) {
      for (const action of structuralActions) {
        assert.ok(!source.includes(action), `${name} 이 ${action} 을 아직 직접 부른다`);
      }
    }
    // 🔵 그러면 **누군가는 불러야 한다** — 화면이 [저장]에서 일곱을 전부 부른다.
    //    이것이 없으면 위 일곱 단언은 「아무도 안 부른다」로도 통과한다.
    for (const action of structuralActions) {
      assert.ok(screen.includes(`${action}(`), `화면이 ${action} 을 안 부른다 — 그 조작이 영영 저장되지 않는다`);
    }
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
  test("🔴 연결 추가 — 창이 없고, 단추가 **모아 두기**로 곧장 간다", () => {
    assert.ok(!createEdge.includes("<dialog"), "확인 창이 남아 있다");
    assert.ok(!createEdge.includes("setConfirming("), "창을 여닫던 상태가 남아 있다");
    assert.ok(!createEdge.includes("showModal()"));
    const button = flat(createEdge);
    assert.ok(button.includes("onClick={handleAdd}"), "단추가 창을 여는 대신 본체를 바로 불러야 한다");
    assert.ok(button.includes("> 연결 추가 </button>"), "단추 글자가 「검토」가 아니라 「추가」여야 한다");
    // 🔴 2026-11-20(조각 4) — 가는 곳이 서버가 아니라 모아 두는 통로다. 🔵 사유가
    //    그 통로에 **그대로 실리는지**까지 본다 — 안 실으면 [저장] 때 사유 없이 가고,
    //    FULL_SERVICE/REFERENCE 에서는 서버가 거절한다.
    const body = flat(functionBody(createEdge, "function handleAdd()"));
    assert.ok(body.includes("onQueueCreate({ fromNodeId, toNodeId, branchType, branchLabel: branchLabel.trim() || null, reason: reason.trim() || null });"));
  });

  test("🔴 연결 추가 — 갖춰야 할 것이 그대로다(특히 사유) — 창을 없앨 때와 같은 식이다", () => {
    // 🔵 「두 번 눌러도 두 번 안 나간다」는 뜻을 잃었다 — 나가는 것이 없어졌다.
    //    두 번 누르면 조작이 두 줄 쌓이고, 그건 사람이 두 번 시킨 것이 맞다.
    //    대신 **무엇이 갖춰져야 누를 수 있는가**가 안 느슨해졌는지를 그대로 잰다.
    assert.ok(flat(createEdge).includes("disabled={!canAdd}"));
    assert.ok(
      createEdge.includes("const canAdd = fromNodeId.length > 0 && toNodeId.length > 0 && fromNodeId !== toNodeId && !labelRequired && (isTechnical || reason.trim().length > 0);"),
      "사유 필수 조건이 느슨해지면 [저장] 때 서버가 거절한다"
    );
  });

  test("🔴 분기 대상 변경(재연결) — 창이 없고, 단추가 **모아 두기**로 곧장 간다", () => {
    assert.ok(!edgeProperty.includes("<dialog"), "확인 창이 남아 있다");
    assert.ok(!edgeProperty.includes("setConfirmingRetarget("));
    assert.ok(!edgeProperty.includes("showModal()"));
    const flatSource = flat(edgeProperty);
    assert.ok(flatSource.includes("onClick={handleRetarget}"));
    assert.ok(flatSource.includes("> 대상 변경 </button>"));
    assert.ok(
      flatSource.includes("disabled={!hasRetarget || newFromNodeId === newToNodeId || (!isTechnical && retargetReason.trim().length === 0)}"),
      "갖춰야 할 것(특히 사유)이 느슨해지면 [저장] 때 서버가 거절한다"
    );
    assert.ok(flat(functionBody(edgeProperty, "function handleRetarget()")).includes("onQueueRetarget(newFromNodeId, newToNodeId, retargetReason.trim() || null);"));
  });

  test("🔴 노드 유형 변경 — 기술 작업 절차는 고르는 순간 적용된다", () => {
    const body = flat(functionBody(nodeProperty, "function handleSelectNodeType("));
    assert.match(
      body,
      /if \(value === node\.nodeType\) return; if \(isTechnical\) \{ handleChangeType\(value\); return; \} setConfirmingTypeChange\(true\);/,
      "기술 작업 절차는 바로, 그 밖의 분류는 (사유를 받으려고) 창을 연다"
    );
    // 창을 여는 자리가 여기 하나뿐이다 — 다른 데서 또 열면 위 단언이 통과해도 창이 뜬다.
    assert.equal(nodeProperty.match(/setConfirmingTypeChange\(true\)/g)?.length, 1);
  });

  test("🔴 노드 유형 변경 — 고른 값을 **인자로** 넘긴다(state 를 읽으면 직전 유형이 간다)", () => {
    // 확인 창이 있던 시절에는 창을 띄우는 사이에 렌더가 한 번 돌아 state 가
    // 최신이었다. 바로 적용하는 지금은 같은 이벤트 안이라 state 가 아직 옛 값이다.
    assert.ok(nodeProperty.includes("function handleChangeType(targetNodeType: ProcedureNodeType)"));
    assert.ok(
      flat(functionBody(nodeProperty, "function handleChangeType(")).includes("onQueueChangeType(targetNodeType, typeChangeReason.trim() || null);"),
      "고른 값이 아니라 state 를 넘기면 직전 유형이 모아진다"
    );
  });

  test("🔴 노드 유형 변경 — 되돌리면 드롭다운도 함께 돌아온다(안 바뀐 유형이 골라진 채 남으면 화면이 거짓말을 한다)", () => {
    // 🔴 2026-11-20(조각 4) — 「실패하면 되돌린다」가 **성립하지 않게** 됐다.
    //    여기서는 서버를 안 불러 실패할 일이 없다. 대신 **[이전]으로 되돌렸을 때**
    //    같은 거짓말이 생긴다 — 행의 유형은 옛 값으로 돌아오는데 드롭다운은 고른
    //    값에 남는다. 그래서 그 자리를 adjust-state-during-render 로 지킨다.
    const flatSource = flat(nodeProperty);
    assert.ok(
      flatSource.includes("} else if (node.nodeType !== prevNodeType) { setPrevNodeType(node.nodeType); setNewNodeType(node.nodeType); }"),
      "되돌렸는데 드롭다운만 옛 값으로 남는다"
    );
    // 🔵 노드가 바뀔 때의 맞추기(전부터 있던 것)는 그대로여야 한다.
    assert.ok(flatSource.includes("if (node.id !== prevNodeId) { setPrevNodeId(node.id); setPrevNodeType(node.nodeType); setNewNodeType(node.nodeType);"));
  });

  test("🔴 노드 유형 변경 — 「변경 중」 잠금이 사라졌다(기다릴 것이 없어졌다)", () => {
    const flatSource = flat(nodeProperty);
    assert.ok(flatSource.includes("disabled={!canEdit}"), "유형 드롭다운이 권한 말고 다른 것으로 잠기면 안 된다");
    assert.ok(!flatSource.includes("isChangingType"), "도는 상태가 남아 있으면 영영 안 풀리는 잠금이 된다");
  });

  test("🔵 노드 추가는 원래부터 창이 없었다 — 이 조각이 되돌려 놓지 않았다", () => {
    assert.ok(!createNode.includes("<dialog"));
    assert.ok(flat(createNode).includes("onClick={handleCreate}"));
  });

  test("🔴 네 패널이 **[저장]을 눌러야 간다**고 글로 말한다 — 지도가 바뀌는 것은 더 이상 증거가 아니다", () => {
    // 🔴 전에는 「지도에 나타나는 것」이 곧 저장됐다는 증거였다. 이제는 나타나도
    //    아직 안 갔다. 글이 없으면 추가해 놓고 그냥 나가는 사람이 생긴다.
    for (const [name, source] of [
      ["CreateEdgePanel", createEdge],
      ["CreateNodePanel", createNode],
      ["EdgePropertyPanel", edgeProperty],
      ["NodePropertyPanel", nodeProperty],
    ] as const) {
      assert.ok(/\[저장\]을 눌러야/.test(source), `${name} 에 「[저장]을 눌러야」라고 말하는 자리가 없다`);
    }
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

  test("🔴 삭제 둘에 확인 창을 새로 더하지 않았다 — 다만 **가는 곳**이 [저장]으로 바뀌었다", () => {
    // 🔴 실측(2026-11-03): 이 편집기의 **노드 삭제·분기 삭제에는 원래부터 확인
    // 창이 없다.** 사유 칸 하나와 단추 하나뿐이다. 그래서 여기서 "여전히
    // 묻는가"는 잴 수가 없다 — 대신 이 조각(줄기 B-②)이 삭제 길에 창을 **새로
    // 더하지 않았음**을 못 박는다.
    //
    // 🔴 2026-11-20(조각 4) — 삭제 둘도 [저장] 쪽으로 옮겨 갔다. 창은 여전히
    //    없고(위 판단 그대로), 사유 칸도 그대로이며, 바뀐 것은 **언제 가는가**다.
    const nodeDelete = flat(functionBody(nodeProperty, "function handleDelete()"));
    assert.ok(nodeDelete.includes("onQueueDelete(deleteReason.trim() || null);"), "삭제 사유가 모아 두는 조작에 안 실리면 이력에서 사라진다");
    assert.ok(!nodeProperty.includes("<dialog") || nodeProperty.includes('id="node-type-confirm-title"'), "삭제에 창을 새로 더하지 않았다");
    assert.ok(flat(nodeProperty).includes("> 노드 삭제 </button>"));
    assert.ok(flat(nodeProperty).includes("placeholder=\"삭제 사유 (선택)\""));

    const edgeDelete = flat(functionBody(edgeProperty, "function handleDelete()"));
    assert.ok(edgeDelete.includes("onQueueDelete(deleteReason.trim() || null);"));
    assert.ok(flat(edgeProperty).includes("> 분기 삭제 </button>"));
    assert.ok(!edgeProperty.includes("<dialog"), "분기 쪽에는 창이 하나도 없다");
  });
});

describe("절차 편집기 확인 창 — ④ 실패하면 사람이 안다", () => {
  test("🔴 실패를 알리는 자리가 **화면 한 곳으로 옮겨 갔다** — 없앤 것이 아니다", () => {
    // 🔴 2026-11-20(조각 4) — 네 패널에는 실패할 서버 호출이 한 건도 안 남았다
    //    (①절이 글자로 못 박는다). 그래서 패널의 errorMessage 자리도 함께 사라졌다.
    //    조용해지지 않으려면 **옮겨 간 자리**가 반드시 있어야 한다.
    for (const [name, source] of [
      ["CreateEdgePanel", createEdge],
      ["CreateNodePanel", createNode],
      ["EdgePropertyPanel", edgeProperty],
      ["NodePropertyPanel", nodeProperty],
    ] as const) {
      assert.ok(!source.includes("setErrorMessage("), `${name} 에 쓰이지 않는 실패 자리가 남아 있다`);
    }
    // 옮겨 간 자리 — [저장]이 실패하면 그 글이 도구막대 아래 한 줄로 선다.
    assert.ok(
      flat(screen).includes('{globalSaveStatus === "failed" && globalSaveError && <p className="text-xs text-red-600 dark:text-red-400">{globalSaveError}</p>}'),
      "실패를 알리는 자리가 화면에도 없다 — 그러면 거절이 통째로 조용해진다"
    );
    // 🔴 그 글이 **서버가 준 글**이어야 한다. 화면이 제 말로 바꾸면 어디서 막혔는지
    //    알 수 없다(「저장에 실패했습니다」는 아무것도 안 알려 준다).
    assert.ok(flat(screen).includes("setGlobalSaveError(outcome.failureMessage);"));
    assert.ok(flat(screen).includes("structuralOutcome.failureMessage ??"), "구조 단계의 실패 글이 버려지고 있다");
  });

  test("🔴 **보낼 수 없는 구조 변경**은 저장을 누르기 전에 미리 말한다", () => {
    // 🔴 접기가 conflicts 로 올리는 것들은 [저장]을 **아예 막는다**(한 건도 안 보낸다).
    //    흐린 단추만 두면 사람은 고장으로 읽으므로, 그 까닭이 그 자리에 적혀야 한다.
    const f = flat(screen);
    assert.ok(f.includes("const canSendStructural = canSendStructuralChanges(coalescedStructural);"));
    assert.ok(f.includes("disabled={!hasAnyPendingChanges || !canSendStructural || globalSaveStatus === \"saving\"}"));
    assert.ok(f.includes("{canEdit && structuralConflictMessages.length > 0 && ("), "막힌 까닭을 그리는 자리가 없다");
    // 🔵 글은 화면에서 짓지 않고 도메인에서 받아 온다 — 두 곳에 적으면 어긋난다.
    assert.ok(f.includes("describeStructuralConflicts(coalescedStructural.conflicts)"));
  });

  /**
   * 🔴 2026-11-04(줄기 B-⑦) — 이 시험의 이름이 예전에는 「성공 알림은 따로
   * 띄우지 않는다 — 지도에 나타나는 것이 증거다」였고, 그 판단은 **절반이
   * 뒤집혔다.** 사용자가 신고한 것: "노드, 연결선등을 추가/제거 하기만 했을
   * 때는 [저장]이 활성화가 안되더라고 ... 수정된 사항이라고 인식을 안하고 있는
   * 것 같아." 지도는 바뀌었는데도 **저장됐다는 말을 아무도 안 했기** 때문에
   * 고장으로 읽힌 것이다(삭제는 "사라짐"이 유일한 증거라 더 약하다).
   *
   * 뒤집힌 것과 그대로인 것을 갈라 둔다:
   *  - 그대로: **창은 안 띄운다.** SavePopup 도 window.alert 도 여전히 없다 —
   *    확인 창을 걷어낸 줄기 B-② 의 까닭(조작마다 창이 뜨면 손이 막힌다)은
   *    성공 알림에도 똑같이 적용된다.
   *  - 뒤집힌 것: 도구막대에 **저절로 꺼지는 한 줄**이 뜬다. 창이 아니라
   *    글자고, 아무것도 막지 않는다.
   * 이 주석이 없으면 다음 사람이 옛 이름만 보고 그 한 줄을 도로 걷어낸다.
   */
  test("🔵 성공을 알리되 창은 안 띄운다 — 도구막대의 꺼지는 한 줄이다(줄기 B-⑦ 에서 반만 뒤집혔다)", () => {
    for (const source of [createEdge, edgeProperty, nodeProperty, createNode]) {
      assert.ok(!/SavePopup/.test(source), "SavePopup 은 0.5초 뒤 저절로 닫히는 성공 전용 창이다 — 여기 쓸 자리가 아니다");
      assert.ok(!/window\.alert\(/.test(source));
    }
    // 지도가 다시 그려지는 길: 패널의 onSaved → 화면의 handleStructuralSaved →
    // handleSaved → router.refresh(). 그 끝단이 살아 있는지만 본다.
    const saved = functionBody(screen, "function handleSaved(");
    assert.ok(saved.includes("router.refresh();"));
    // 🔴 알리는 자리도 **같은 함수 안**이어야 한다. 패널마다 따로 두면 새 패널이
    //    생긴 날 그 하나만 조용히 말을 안 한다.
    assert.ok(
      saved.includes("setStructuralSaveNoticeId((id) => id + 1);"),
      "구조 변경이 저장됐다고 말하는 자리가 handleSaved 에서 사라졌다 — 사용자가 신고한 그 침묵으로 되돌아간다"
    );
    // 🔴 그러면서 globalSaveStatus 는 **안 건드린다.** 거기에 끼면 "변경사항 N건
    //    저장 대기 중" 안내가 2.5초 깜빡인다(그 문구가 idle 일 때만 뜬다).
    assert.ok(
      !saved.includes("setGlobalSaveStatus"),
      "handleSaved 가 globalSaveStatus 를 건드리면 저장 대기 안내가 깜빡인다 — 별도 상태로 둔 까닭이 그것이다"
    );
  });
});

describe("절차 편집기 확인 창 — ⑤ 줄기 B-① 의 되돌리기를 안 깨뜨렸다", () => {
  test("🔴 되돌리기 한 걸음이 **목록을 고치기 전**에 쌓인다 — 뒤에 쌓으면 [이전]이 한 칸씩 밀린다", () => {
    // 🔴 2026-11-04 까지 이 절이 재던 것은 「실패한 서버 호출로 한 걸음이
    //    쌓이지 않는가」였다. 2026-11-20(조각 4)에 그 길이 통째로 사라졌다 —
    //    패널이 서버를 안 부르므로 실패한 호출이라는 것이 없다.
    //    **같은 위험이 자리를 옮겼다**: 이제는 「목록을 고친 뒤에 찍으면 한 칸이
    //    밀린다」가 그 자리다. 통로가 하나뿐인지, 그 안의 차례가 맞는지를 잰다.
    const body = flat(functionBody(screen, "function queueStructural("));
    const push = body.indexOf("pushPendingUndoStep();");
    const mutate = body.indexOf("setPendingStructuralOperations(");
    assert.notEqual(push, -1, "모아 두는 통로가 되돌리기 한 칸을 안 찍는다");
    assert.notEqual(mutate, -1);
    assert.ok(push < mutate, "목록을 고친 뒤에 찍고 있다 — [이전]이 한 칸씩 밀린다");
  });

  test("🔴 구조 조작 여덟이 **그 통로 하나로만** 목록을 고친다 — 한 곳이라도 새면 그 조작만 안 되돌려진다", () => {
    // 🔵 setPendingStructuralOperations 를 부르는 자리를 센다. 통로(queueStructural) ·
    //    저장 뒤처리 · 되돌리기 복원 · 「모두 취소」 넷뿐이어야 한다.
    const calls = screen.match(/setPendingStructuralOperations\(/g) ?? [];
    assert.equal(calls.length, 4, `목록을 고치는 자리가 ${calls.length} 곳이다 — 넷이어야 한다(통로 · 저장 뒤 · 되돌리기 · 모두 취소)`);
    // 🔴 여기서 functionBody 를 쓰면 안 된다 — 이 파일의 그 도우미는 「서명 뒤 첫
    //    `{`」를 몸통으로 보는데, 아래 손잡이 가운데 둘은 인자를 인라인 객체 타입
    //    (`input: { nodeType: … }`)으로 받아서 그 `{` 가 **인자 타입**이다. 그러면
    //    몸통 대신 인자 선언 몇 줄을 떼어 내 단언이 조용히 거짓이 된다
    //    (procedure-structural-save-notice.test.ts 가 같은 함정을 적어 두었다).
    //    그래서 「이름이 나온 뒤 가까운 자리에 통로가 있는가」로 잰다.
    const f = flat(screen);
    const handlers = [
      "function handleQueueCreateNode(",
      "function handleQueueChangeNodeType(",
      "function handleQueueDeleteNode(",
      // 🔵 2026-11-21(조각 B3)에 여덟째가 생겼다 — [범위 선택]으로 고른 여럿을
      //    한 번에 지우는 길이다. 단수와 **다른 함수**여야 하는 까닭은 그쪽에
      //    적혀 있다(단수 안에 넣으면 통로를 두 번 지나기 쉽고, 그러면 [이전]
      //    한 칸이 아니게 된다).
      "function handleQueueDeleteNodes(",
      "function handleQueueCreateEdge(",
      "function handleQueueRetargetEdge(",
      "function handleQueueDeleteEdge(",
      "function handleQueueInsertNodeOnEdge(",
    ];
    for (const handler of handlers) {
      const at = f.indexOf(handler);
      assert.notEqual(at, -1, `${handler} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
      assert.ok(f.slice(at, at + 600).includes("queueStructural("), `${handler} 가 통로를 안 지난다`);
    }
    // 🔵 통로를 부르는 자리가 **위 목록만큼**이어야 한다 — 아홉째가 생기면 그 조작은
    //    위 목록에 없어 이 시험이 못 본다.
    assert.equal((f.match(/queueStructural\(/g) ?? []).length, handlers.length + 1, "통로를 부르는 자리 수가 안 맞는다(정의 한 줄 + 여덟)");
  });

  test("🔴 화면이 네 패널을 **모아 두는 손잡이**로 묶는다 — 끊기면 그 조작이 아무 데도 안 간다", () => {
    for (const [tag, prop] of [
      ["NodePropertyPanel", "onQueueChangeType={"],
      ["NodePropertyPanel", "onQueueDelete={"],
      ["EdgePropertyPanel", "onQueueRetarget={"],
      ["EdgePropertyPanel", "onQueueDelete={"],
      ["EdgePropertyPanel", "onQueueInsertNode={"],
      ["CreateEdgePanel", "onQueueCreate={handleQueueCreateEdge}"],
      ["CreateNodePanel", "onQueueCreate={handleQueueCreateNode}"],
    ] as const) {
      assert.ok(flat(jsxElement(screen, tag)).includes(prop), `<${tag} 가 ${prop} 를 안 넘긴다`);
    }
    // 🔵 즉시 저장이 남은 셋(이름 변경 · 이력 복원 · 현장 단계 넣기)은 여전히
    //    handleStructuralSaved 를 지난다 — 그쪽은 서버가 그 자리에서 저장한다.
    assert.ok(functionBody(screen, "function handleStructuralSaved(").includes("pushStructuralUndoStep();"));
    assert.ok(flat(jsxElement(screen, "EditHistoryPanel")).includes("onRestored={handleStructuralSaved}"));
  });
});
