import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — **노드를 지우면 붙은 연결선도 함께**, 화면 쪽 이음새 (2026-11-21)
 * ============================================================================
 * 쓰는 분의 결정(원문): 「노드를 지우면 연결된 연결선도 함께 지워지는 걸로 하자 —
 * 연결선을 지우지 않아도 노드를 지울 수 있도록.」
 *
 * **무엇을 쌓을지**를 정하는 규칙은 순수 함수에 있고 값으로 재어진다
 * (src/lib/domain/procedure-editor-node-deletion.test.ts — 18개). 이 파일이 재는
 * 것은 **화면이 그 판정을 제대로 물고 있는가** 하나다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① **화면이 붙은 선을 제 손으로 다시 세는 것.** 패널이 말한 수와 실제로 지워지는
 *     수가 갈리고, 그 어긋남은 [저장]이 끝난 뒤에야 드러난다.
 *  ② **서버 목록(template.edges)에서 찾는 것.** 저장 전에 긋거나 옮긴 선을
 *     빠뜨리고, 빠뜨린 선이 [저장]을 통째로 막는다(ENDPOINT_DELETED_IN_SAME_SAVE).
 *  ③ **쌓는 호출이 둘로 쪼개지는 것.** 그 순간 [이전] 한 칸이 아니게 된다 —
 *     한 번 눌러도 노드만(또는 선만) 돌아온다.
 *  ④ **몇 개가 함께 지워지는지 안 보이는 것.** 확인 창을 안 띄우기로 했으므로
 *     누르기 **전에** 보이는 자리가 하나는 있어야 한다.
 *  ⑤ **상시 안내를 세 번째로 세우는 것.** 이 편집기의 상시 안내를 2026-11-04 ·
 *     11-20 두 번 세웠다 두 번 다 지워 달라는 요청을 받았다(커밋 d57f664a).
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureTemplateEditorScreen 은 @xyflow/react 의 .css 와 서버 액션
 * (→ server-only)을 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다.
 * 이웃들(procedure-structural-deferred-save.test.ts ·
 * procedure-editor-delete-key-ui.test.ts)이 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이번 변경의 주석에는 **없어진 막음의 문구**가 글자 그대로 들어 있다(「연결선 N개가
 * 붙어 있어 삭제할 수 없습니다」). 안 걷으면 「없어졌는가」 쪽이 영영 깨진다.
 * ①절의 마지막 단언이 걷어내기가 실제로 일한다는 증거다.
 * ============================================================================
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

/** 글자가 몇 번 나오는가. 「호출이 하나뿐인가」처럼 **수**가 뜻을 갖는 자리에서 쓴다. */
function countOf(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

const PATHS = {
  screen: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  nodePanel: "src/components/procedures/editor/NodePropertyPanel.tsx",
  plan: "src/lib/domain/procedure-editor-node-deletion.ts",
} as const;

const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const f = flat(screen);
const nodePanelRaw = read(PATHS.nodePanel);
const nodePanel = flat(stripComments(nodePanelRaw));
const planModule = stripComments(read(PATHS.plan));

/** 삭제를 쌓는 손잡이 하나. 아래 여러 절이 **이 몸통 안에서만** 센다. */
const deleteNodeHandler = flat(functionBody(screen, "function handleQueueDeleteNode(nodeId: string, reason: string | null)"));

describe("노드 삭제에 선이 딸려 간다(화면) — ① 먼저 표본 확인", () => {
  test("🔵 파일 셋이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    // 🔵 길이는 **날것**으로 잰다. 새 판정 모듈은 주석을 걷어내면 1천 자가 안 되는데
    //    (거의 전부가 까닭을 적은 머리말이다), 걷어낸 길이로 재면 「파일이 비었다」와
    //    「주석이 많다」를 못 가른다.
    for (const [name, source] of Object.entries({ screenRaw, nodePanelRaw, planRaw: read(PATHS.plan) })) {
      assert.ok(source.length > 2000, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(planModule.includes("export function planProcedureNodeDeletionOperations("), "쌓을 줄을 정하는 본체");
    assert.ok(planModule.includes("export function findEdgesAttachedToNode("), "붙은 선을 찾는 본체");
    assert.ok(deleteNodeHandler.length > 200, "손잡이 몸통을 못 떼어 냈다 — 아래 절들이 빈 글자를 뒤지게 된다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 **없어진 막음의 문구**가 경위로 남아 있다", () => {
    assert.ok(screenRaw.includes("연결선 N개가 붙어 있어 삭제할 수 없습니다"), "뒤집기 전 문구가 주석에 경위로 남아 있어야 한다");
    assert.ok(!screen.includes("붙어 있어 삭제할 수 없습니다"), "걷어낸 쪽에 남아 있으면 화면이 아직 막고 있는 것이다");
  });
});

describe("노드 삭제에 선이 딸려 간다(화면) — ②🔴 붙은 선을 **함께** 쌓는다", () => {
  test("🔴 쌓는 줄을 순수 판정이 만든다 — 화면이 제 손으로 세지 않는다", () => {
    // 🔴 화면이 다시 세면 「패널이 말한 수」와 「실제로 지워지는 수」가 갈린다.
    assert.ok(deleteNodeHandler.includes("queueStructural(() => planProcedureNodeDeletionOperations(renderedEdges, nodeId, reason));"));
    assert.ok(!deleteNodeHandler.includes('kind: "DELETE_EDGE"'), "화면이 연결선 삭제 줄을 직접 적고 있다");
    assert.ok(!deleteNodeHandler.includes('kind: "DELETE_NODE"'), "화면이 노드 삭제 줄을 직접 적고 있다");
    assert.ok(!deleteNodeHandler.includes(".filter("), "화면이 붙은 선을 제 손으로 거르고 있다");
  });

  test("🔴 쌓는 호출이 **하나**다 — 둘로 쪼개지면 [이전] 한 칸이 아니게 된다", () => {
    // 🔴 queueStructural 은 부를 때마다 되돌리기 한 칸을 찍는다. 선과 노드를 나눠
    //    부르면 [이전] 한 번에 선만(또는 노드만) 돌아온다.
    assert.equal(countOf(deleteNodeHandler, "queueStructural("), 1, "삭제 한 번에 통로를 여러 번 지난다");
    // 🔵 그 통로가 목록을 고치기 **전에** 한 칸을 찍는다는 것은 이웃 시험들이 잰다
    //    (procedure-structural-deferred-save.test.ts ②절 · 이 줄은 그 전제를 확인만 한다).
    const queue = flat(functionBody(screen, "function queueStructural("));
    assert.ok(queue.indexOf("pushPendingUndoStep();") < queue.indexOf("setPendingStructuralOperations("));
  });

  test("🔴 찾는 목록이 **그려진 선**(renderedEdges)이다 — 서버 목록이면 저장 전 선을 빠뜨린다", () => {
    // 🔴 template.edges 로 세면 ① 저장 전에 그은 선을 못 보고(그 선이 [저장]을
    //    ENDPOINT_DELETED_IN_SAME_SAVE 로 막는다) ② 저장 전에 옮긴 선은 양 끝이
    //    달라 엉뚱한 선을 지운다. 값으로 재는 것은 unit 쪽 ⑥절이다.
    assert.equal(countOf(f, "findEdgesAttachedToNode(template.edges"), 0, "서버 목록에서 찾고 있다");
    assert.equal(countOf(f, "planProcedureNodeDeletionOperations(template.edges"), 0, "서버 목록에서 찾고 있다");
    assert.ok(deleteNodeHandler.includes("findEdgesAttachedToNode(renderedEdges, nodeId)"));
    assert.ok(f.includes("findEdgesAttachedToNode(renderedEdges, selectedNode.id).length"), "패널에 보이는 수도 같은 목록에서 센다");
  });

  test("🔴 함께 지워지는 선의 **초안·경로·저장 메모도 버린다** — 안 버리면 없는 선을 고치려 든다", () => {
    // 🔴 handleQueueDeleteEdge 가 선 하나에 하던 뒤처리 셋이다. 딸려 지워지는
    //    선에만 안 해 주면 「어떻게 지웠느냐」에 따라 뒤처리가 갈린다.
    for (const setter of ["setPendingEdgeFieldDraftsById((prev) =>", "setPendingEdgeRouteMoves((prev) =>", "setPendingEdgeSaveNoteById((prev) =>"]) {
      assert.ok(deleteNodeHandler.includes(setter), `노드 삭제가 ${setter} 를 안 치운다`);
    }
    // 🔵 노드 쪽 둘(초안 · 자리)은 전부터 있던 뒤처리다 — 함께 산다.
    assert.ok(deleteNodeHandler.includes("setPendingNodeFieldDraftsById((prev) =>"));
    assert.ok(deleteNodeHandler.includes("setPendingLayoutMoves((prev) =>"));
    // 🔵 그리고 함께 지워진 선을 고른 채였다면 선택도 푼다(고른 경로점이 남으면
    //    [Delete] 가 없는 선의 점을 지우러 간다).
    assert.ok(deleteNodeHandler.includes("setSelectedNodeId(null);"));
    assert.ok(deleteNodeHandler.includes("if (selectedEdgeId !== null && attachedEdgeIds.includes(selectedEdgeId)) {"));
  });
});

describe("노드 삭제에 선이 딸려 간다(화면) — ③🔴 막음에서 **선 조건만** 없어졌다", () => {
  test("🔴 선을 세어 막던 줄이 사라졌다 — 그것이 이번 일의 전부다", () => {
    assert.ok(!f.includes("const attached = renderedEdges.filter((e) => e.fromNodeId === selectedNode.id || e.toNodeId === selectedNode.id).length;"));
    assert.ok(!screen.includes("그 연결선을 먼저 지워 주세요"), "사람이 선을 먼저 지우라고 아직 말하고 있다");
  });

  test("🔴 **체크리스트·고장 진단표는 그대로 막는다** — 함께 지울 수 있는 성질이 아니다", () => {
    // 🔴 그 노드 안에는 사람이 쓴 점검 항목·진단 표가 들어 있고, 편집기에는 그것을
    //    옮기거나 지울 손잡이조차 없다. 서버도 NODE_HAS_DEPENDENT_CONTENT 로 거절한다.
    //
    // 🔴 **2026-11-21(조각 B3)에 이 셈이 화면에서 순수 모듈로 나갔다.** 조건도
    //    글자도 한 글자 안 바뀌었고 자리만 옮겼다 — [범위 선택]으로 고른 여럿을
    //    지우면서 **같은 질문을 노드마다** 하게 됐기 때문이다. 그래서 여기서 재는
    //    것이 둘로 늘었다: ㉠ 규칙이 그 모듈에 한 벌 있는가, ㉡ 화면이 제 손으로
    //    다시 적지 않고 **그 함수를 부르는가**. 값으로 재는 쪽은 unit 목록의
    //    procedure-editor-node-deletion.test.ts ⑧절이다.
    assert.ok(planModule.includes("if (node.hasChecklistContent || node.hasTroubleshootingContent) {"), "막는 조건이 모듈에 없다");
    assert.ok(planModule.includes("체크리스트 또는 고장 진단표 내용이 연결되어 있어 삭제할 수 없습니다."), "막는 글자가 모듈에 없다");
    assert.ok(planModule.includes("export function resolveProcedureNodeDeleteBlockedReason("), "판정 본체가 사라졌다");
    assert.ok(
      f.includes("const selectedNodeDeleteBlockedReason: string | null = resolveProcedureNodeDeleteBlockedReason(selectedNode);"),
      "화면이 그 함수를 안 부른다 — 제 손으로 다시 적으면 잣대가 둘이 된다"
    );
    // 🔵 `hasChecklistContent` 라는 낱말 자체는 화면에 아직 있다 — 유령 칸을 지어낼
    //    때 false 로 채우는 자리다. 막음을 **판정하는** 쪽만 없어야 한다.
    assert.ok(!f.includes("selectedNode.hasChecklistContent"), "화면이 아직 제 손으로 판정하고 있다");
    assert.ok(!screen.includes("체크리스트 또는 고장 진단표 내용이 연결되어 있어 삭제할 수 없습니다."), "막는 글자가 화면에 또 적혀 있다");
    const rule = flat(functionBody(planModule, "export function resolveProcedureNodeDeleteBlockedReason("));
    assert.ok(rule.length > 80, "판정 몸통을 못 떼어 냈다 — 아래 단언이 공짜로 통과한다");
    assert.ok(!rule.includes("edge"), `막는 까닭이 아직 선을 보고 있다: ${rule}`);
  });

  test("🔴 **복수 삭제도 같은 함수로 거른다** — 규칙이 두 벌이면 패널과 키가 다른 말을 한다", () => {
    // 🔴 패널이 「지울 수 있다」고 말한 노드를 복수가 빼거나 그 반대가 되는 자리다.
    //    그때 오류는 한 번도 안 난다 — 단추는 멀쩡히 눌리는데 키로만 안 지워진다.
    assert.equal(countOf(f, "resolveProcedureNodeDeleteBlockedReason("), 2, "부르는 자리가 단수·복수 둘이어야 한다");
    assert.ok(f.includes("deleteBlockedReason: resolveProcedureNodeDeleteBlockedReason(n)"), "복수 쪽이 같은 함수를 안 쓴다");
  });

  test("🔵 [Delete] 키도 **같은 값**을 보므로 키로도 지워진다 — 키 쪽은 한 글자도 안 고쳤다", () => {
    // 🔵 키 판정은 막힌 까닭을 제가 세지 않고 화면이 준 값만 본다. 까닭이 null 이
    //    되는 순간 키로도 지워진다(그것이 맞는 동작이다).
    assert.ok(f.includes("nodeDeleteBlockedReason: selectedNodeDeleteBlockedReason,"));
    assert.ok(f.includes("deleteBlockedReason={selectedNodeDeleteBlockedReason}"));
    assert.equal(countOf(f, "const selectedNodeDeleteBlockedReason"), 1, "까닭을 화면이 두 번 계산하고 있다");
  });
});

describe("노드 삭제에 선이 딸려 간다(화면) — ④🔴 **몇 개가 함께 지워지는지** 누르기 전에 보인다", () => {
  test("🔴 패널이 수를 받고, 그 수가 지울 때 쓰는 것과 **같은 함수·같은 목록**에서 나온다", () => {
    assert.ok(f.includes("attachedEdgeCount={selectedNodeAttachedEdgeCount}"), "패널이 수를 못 받는다");
    assert.ok(f.includes("const selectedNodeAttachedEdgeCount = selectedNode ? findEdgesAttachedToNode(renderedEdges, selectedNode.id).length : 0;"));
    assert.equal(countOf(f, "const selectedNodeAttachedEdgeCount"), 1, "수를 두 벌 세고 있다");
  });

  test("🔴 붙은 선이 있을 때만 서고, **막혔으면 안 선다** — 못 지우는 노드 옆에서는 거짓말이다", () => {
    assert.ok(nodePanel.includes("{deleteBlockedReason === null && attachedEdgeCount > 0 && ( <p"), "조건이 바뀌었거나 상시로 섰다");
    assert.ok(nodePanel.includes("붙어 있는 연결선 {attachedEdgeCount}개도 함께 지워집니다."), "수를 글에 안 싣고 있다");
  });

  test("🔵 자리는 **삭제 단추 바로 위**다 — 사유 칸이 사이에 끼면 눈이 그 글에서 떠난다", () => {
    const notice = nodePanel.indexOf("attachedEdgeCount > 0 && ( <p");
    const textarea = nodePanel.indexOf('placeholder="삭제 사유 (선택)"');
    const button = nodePanel.indexOf('disabled={deleteBlockedReason !== null}');
    assert.ok(textarea !== -1 && notice !== -1 && button !== -1, "세 자리 중 하나를 못 찾았다");
    assert.ok(textarea < notice, "수를 적은 줄이 사유 칸보다 위에 있다");
    assert.ok(notice < button, "수를 적은 줄이 단추보다 아래에 있다");
  });

  test("🔴 확인 창은 **안 띄운다** — [이전] 한 번이면 노드와 선이 함께 돌아온다", () => {
    assert.ok(!deleteNodeHandler.includes("confirm("), "노드 삭제에 확인 창이 생겼다");
    const panelDelete = flat(functionBody(stripComments(nodePanelRaw), "function handleDelete()"));
    assert.ok(!panelDelete.includes("confirm("), "단추 쪽에 확인 창이 생겼다");
  });
});

describe("노드 삭제에 선이 딸려 간다(화면) — ⑤🔴 **상시 안내를 세 번째로 세우지 않았다**", () => {
  test("🔴 편집기 화면에 새 안내 줄이 안 섰다 — 이 자리에 두 번 세웠다 두 번 다 지웠다(d57f664a)", () => {
    assert.ok(!screen.includes("함께 지워집니다"), "화면(편집기 본체)에 안내 줄이 섰다");
    assert.ok(!screen.includes("[Delete]"), "편집기 화면에 키 안내가 섰다");
  });

  test("🔴 삭제 상자에서 **늘 서는 글은 한 줄뿐**이다 — 새로 더한 줄에는 조건이 붙어 있다", () => {
    // 🔵 상자의 빨간 글은 셋이다(막힌 까닭 · 함께 지워질 수 · 「[저장]을 눌러야」).
    //    앞 둘은 조건이 붙어 있어 **한 번에 하나만** 뜬다 — 막혔으면 까닭이,
    //    안 막혔고 선이 붙었으면 수가 선다. 늘 서는 것은 전부터 있던
    //    「[저장]을 눌러야」 한 줄이다.
    //
    // 🔴 **2026-11-21 에 넷에서 셋이 됐다.** 전에는 맨 위에 체크리스트 전용 줄이
    //    따로 있었는데, 그 글자가 아래 `deleteBlockedReason` 과 **똑같아** 막힐 때마다
    //    같은 말이 두 줄 떴다(까닭이 둘이던 동안에는 하나에서만 겹쳐 덜 띄었고,
    //    연결선 막음이 없어지면서 **막히는 경우 100% 가 두 줄**이 됐다).
    //    🔵 패널이 제 손으로 판정하던 위쪽을 걷어냈다 — 단추를 잠그는 값과 툴팁이
    //       이미 아래 값을 보고 있어서, 위를 남기면 판정이 두 벌이 된다.
    const start = nodePanel.indexOf("노드 삭제</h4>");
    // 🔵 마지막 줄은 **그 줄이 시작하는 자리**에서 자른다 — 글자 위치로 자르면 그
    //    줄의 여는 `<p` 가 slice 안에 남아 셈이 하나 는다.
    const lastLine = nodePanel.indexOf("삭제는 화면 상단의 [저장]을 눌러야 서버에 반영됩니다.");
    const end = nodePanel.lastIndexOf("<p className=", lastLine);
    assert.ok(start !== -1 && lastLine !== -1 && end !== -1 && start < end, "삭제 상자의 처음과 끝을 못 찾았다");
    const box = nodePanel.slice(start, end);
    const paragraphs = countOf(box, "<p className=");
    assert.equal(paragraphs, 2, `마지막 줄 위의 글줄이 ${paragraphs} 개다 — 둘이어야 한다(막힌 까닭 · 함께 지워질 수)`);
    // 🔴 **같은 말을 두 번 적지 않는다.** 막힌 까닭의 글자를 패널이 제 손으로 또
    //    적으면(전에 그랬다) 막힐 때마다 같은 줄이 두 번 선다.
    assert.ok(
      !nodePanel.includes("체크리스트 또는 고장 진단표 내용이 연결되어 있어 삭제할 수 없습니다"),
      "막힌 까닭을 패널이 글자로 또 적고 있다 — 그 말은 deleteBlockedReason 한 곳에서만 와야 한다"
    );
    // 🔴 셋 다 조건이 붙어 있는가 — 하나라도 상시로 서면 세 번째 안내가 된 것이다.
    let at = box.indexOf("<p className=");
    while (at !== -1) {
      assert.ok(box.slice(Math.max(0, at - 80), at).includes("&&"), "조건 없이 서는 글이 삭제 상자에 생겼다");
      at = box.indexOf("<p className=", at + 1);
    }
  });
});
