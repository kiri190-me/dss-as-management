import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — **[Delete] 키로 지우기**, 화면 쪽 이음새 (2026-11-21)
 * ============================================================================
 * 쓰는 분의 요청(원문): 「노드나 연결선을 지울 때 [DELETE] 키를 눌러서 지울 수
 * 있도록 해 달라.」
 *
 * **무엇을 지울지**를 정하는 규칙은 순수 함수에 있고 값으로 재어진다
 * (src/lib/domain/procedure-editor-delete-key.test.ts — 25개). 이 파일이 재는
 * 것은 **화면이 그 판정을 제대로 물고 있는가** 하나다.
 *
 * ── 🔴 여기서 가장 조용히 깨지는 것 ─────────────────────────────────────
 *  ① **화면이 제 나름대로 다시 판정하는 것.** 키 글자든 막힌 까닭이든 화면에
 *     한 벌 더 적히는 순간 잣대가 둘이 된다 — 한쪽만 고치는 날 「단추는 흐린데
 *     키로는 지워지는」 화면이 되고, 그 조작은 [저장] 때 통째로 막힌다.
 *  ② **NONE 인데 preventDefault 를 하는 것.** 글자 칸에서 [Delete] 가 글자를
 *     안 지우게 된다. 순수 판정은 멀쩡한데 화면에서만 깨지는 자리다.
 *  ③ **keydown 등록이 둘이 되는 것.** 한 번 누른 키에 둘이 반응한다.
 *  ④ **상시 안내를 세 번째로 세우는 것.** 이 편집기의 상시 안내를 2026-11-04 ·
 *     11-20 두 번 세웠다 두 번 다 지워 달라는 요청을 받았다(커밋 d57f664a).
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureTemplateEditorScreen 은 @xyflow/react 의 .css 와 서버 액션
 * (→ server-only)을 사슬로 물고 있어 어느 목록에서도 import 자체가 던진다.
 * 이웃들(procedure-structural-deferred-save.test.ts ·
 * procedure-editor-confirm-dialogs.test.ts)이 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이번 변경의 주석에는 쓰는 분의 요청 원문과 **옛 모습**이 글자 그대로 들어 있다.
 * 안 걷으면 「없어졌는가」 쪽이 영영 깨지고 「있어야 한다」 쪽은 주석만으로 영영
 * 통과한다. ①절의 마지막 단언이 걷어내기가 실제로 일한다는 증거다.
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

/** 글자가 몇 번 나오는가. 「등록이 하나뿐인가」처럼 **수**가 뜻을 갖는 자리에서 쓴다. */
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
  edgePanel: "src/components/procedures/editor/EdgePropertyPanel.tsx",
  plan: "src/lib/domain/procedure-editor-delete-key.ts",
} as const;

const screenRaw = read(PATHS.screen);
const screen = stripComments(screenRaw);
const f = flat(screen);
const nodePanelRaw = read(PATHS.nodePanel);
const edgePanelRaw = read(PATHS.edgePanel);
const nodePanel = flat(stripComments(nodePanelRaw));
const edgePanel = flat(stripComments(edgePanelRaw));
const planModule = stripComments(read(PATHS.plan));

/** 화면의 keydown 한 자리. 아래 여러 절이 **이 몸통 안에서만** 센다. */
const keyHandler = flat(functionBody(screen, "function handleKeyDown(e: KeyboardEvent)"));

describe("[Delete] 로 지우기(화면) — ① 먼저 표본 확인", () => {
  test("🔵 파일 넷이 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ screen, nodePanel, edgePanel, planModule })) {
      assert.ok(source.length > 2000, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(screen.includes("planProcedureDeleteKey({"), "화면이 판정을 부르는 자리");
    assert.ok(planModule.includes("export function planProcedureDeleteKey("), "판정 본체");
    assert.ok(planModule.includes("export function isTextEntryTarget("), "글자 칸 판정");
    assert.ok(keyHandler.length > 200, "keydown 몸통을 못 떼어 냈다 — 아래 절들이 빈 글자를 뒤지게 된다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 요청 원문이 남아 있다", () => {
    assert.ok(screenRaw.includes("[DELETE] 키를 눌러서 지울 수 있도록"), "요청 원문이 주석에 경위로 남아 있어야 한다");
    assert.ok(!screen.includes("[DELETE] 키를 눌러서 지울 수 있도록"), "걷어낸 쪽에는 없어야 한다");
  });
});

describe("[Delete] 로 지우기(화면) — ②🔴 화면이 판정을 **다시 하지 않는다**", () => {
  test("🔴 키 글자를 화면이 직접 비교하지 않는다 — Backspace 결정이 두 곳에 적히면 한쪽만 고쳐진다", () => {
    // 🔴 고치기 전에는 화면이 `e.key !== "Delete" && e.key !== "Backspace"` 를
    //    제 손으로 비교했다. 그 글자가 화면에 남아 있으면 2026-11-21 의 결정
    //    (노드·연결선은 Delete 만)이 판정과 화면 두 곳에 적힌 것이 된다.
    assert.ok(!screen.includes('"Backspace"'), "화면에 Backspace 글자가 남아 있다");
    assert.ok(!screen.includes('"Delete"'), "화면이 키 글자를 직접 비교하고 있다");
    assert.ok(keyHandler.includes("key: e.key,"), "키는 판정에 그대로 넘겨야 한다");
  });

  test("🔴 **단추를 흐리게 하는 그 값 하나**를 키도 본다", () => {
    // 🔴 같은 변수여야 한다. 키 쪽이 제 나름대로 다시 세면 「단추는 흐린데 키로는
    //    지워진다」가 생기고, 그 조작은 한참 뒤 [저장]을 통째로 막는다.
    assert.ok(f.includes("deleteBlockedReason={selectedNodeDeleteBlockedReason}"), "패널이 받는 값");
    assert.ok(keyHandler.includes("nodeDeleteBlockedReason: selectedNodeDeleteBlockedReason,"), "키가 보는 값");
    assert.equal(
      countOf(f, "const selectedNodeDeleteBlockedReason"),
      1,
      "못 지우는 까닭을 화면이 두 번 계산하고 있다 — 한 벌이어야 한다"
    );
  });

  test("🔴 권한도 **삭제 칸을 세우는 그 값**(canDeleteGraph)을 그대로 본다", () => {
    assert.ok(keyHandler.includes("canDeleteGraph,"), "키가 canDeleteGraph 를 안 본다");
    assert.ok(f.includes("canDelete={canDeleteGraph}"), "패널의 삭제 칸이 쓰는 값과 같아야 한다");
    assert.ok(keyHandler.includes("canEdit,"), "경로점 쪽 잣대(canEdit)도 함께 넘긴다");
  });

  test("🔴 고른 id 는 **그림에 그려진 것**에서 뽑는다 — 사라진 임시 노드에 삭제가 쌓이면 [저장]이 막힌다", () => {
    assert.ok(f.includes("const deletableNodeId = selectedNode?.id ?? null;"));
    assert.ok(f.includes("const deletableEdgeId = selectedEdge?.id ?? null;"));
    assert.ok(keyHandler.includes("selectedNodeId: deletableNodeId,"));
    assert.ok(keyHandler.includes("selectedEdgeId: deletableEdgeId,"));
  });

  test("🔴 바뀐 값이 keydown 에 닿는다 — 의존성에서 빠지면 **옛 값으로 판정**한다", () => {
    // 🔴 이 자리가 빠지면 「방금 선을 지워 풀린 노드」가 키로는 여전히 막혀 있다
    //    (또는 그 반대). 오류는 한 번도 안 난다.
    const deps = f.slice(f.indexOf("window.addEventListener(\"keydown\", handleKeyDown)"));
    for (const dep of [
      "canEdit",
      "canDeleteGraph",
      "deletableNodeId",
      "deletableEdgeId",
      "selectedWaypointIndex",
      "selectedNodeDeleteBlockedReason",
      "handleRemoveSelectedWaypoint",
    ]) {
      assert.ok(deps.slice(0, 400).includes(dep), `keydown 의 의존성에 ${dep} 가 없다`);
    }
  });
});

describe("[Delete] 로 지우기(화면) — ③🔴🔴 글자 칸 보호가 **화면에서도** 산다", () => {
  test("🔴 포커스가 어디인지 실제로 본다 — document.activeElement 를 판정에 넘긴다", () => {
    assert.ok(keyHandler.includes("isTypingTarget: isTextEntryTarget(document.activeElement),"));
  });

  test("🔴 NONE 이면 **preventDefault 를 안 한다** — 하면 글자 칸에서 글자가 안 지워진다", () => {
    const none = keyHandler.indexOf('if (plan.action === "NONE") return;');
    const prevent = keyHandler.indexOf("e.preventDefault();");
    assert.notEqual(none, -1, "NONE 에서 돌아가는 줄이 없다");
    assert.notEqual(prevent, -1, "지울 때는 preventDefault 를 해야 한다");
    assert.ok(none < prevent, "preventDefault 가 NONE 검사보다 앞에 있다 — 글자 칸에서 [Delete] 가 먹힌다");
    assert.equal(countOf(keyHandler, "e.preventDefault();"), 1, "preventDefault 가 여러 곳에 흩어져 있다");
  });
});

describe("[Delete] 로 지우기(화면) — ④🔴 지우는 길은 **단추와 같은 통로**다", () => {
  test("🔴 모아 두는 통로로 간다 — 키가 서버 액션을 직접 부르지 않는다", () => {
    // 🔴 직접 부르면 [저장] 없이 몰래 저장된다(2026-11-20 조각 4 가 옮겨 놓은 것을
    //    키 하나가 되돌리는 꼴). 되돌리기·나가기 경고도 함께 빠진다.
    assert.ok(keyHandler.includes("queueDeleteByKeyRef.current.node(plan.nodeId, null)"));
    assert.ok(keyHandler.includes("queueDeleteByKeyRef.current.edge(plan.edgeId, null)"));
    assert.ok(!keyHandler.includes("Action("), "키가 서버 액션을 직접 부르고 있다");
    assert.ok(
      f.includes("const queueDeleteByKeyRef = useRef({ node: handleQueueDeleteNode, edge: handleQueueDeleteEdge });"),
      "키가 부르는 둘이 패널과 같은 함수여야 한다"
    );
  });

  test("🔵 사유는 null 로 간다 — 사유 칸은 애초에 「선택」이다", () => {
    assert.ok(nodePanel.includes('placeholder="삭제 사유 (선택)"'), "노드 쪽 사유 칸이 선택이라는 근거");
    assert.ok(edgePanel.includes('placeholder="삭제 사유 (선택)"'), "연결선 쪽 사유 칸이 선택이라는 근거");
    assert.ok(nodePanel.includes("onQueueDelete(deleteReason.trim() || null);"), "단추도 빈 사유면 null 을 보낸다");
  });

  test("🔵 확인 창을 안 띄운다 — 지금 삭제 **단추**도 안 띄운다(모아 두기라 [이전]으로 돌아온다)", () => {
    assert.ok(!keyHandler.includes("confirm("), "키에 확인 창이 생겼다 — 단추와 다르게 굴면 안 된다");
    const nodeDelete = flat(functionBody(stripComments(nodePanelRaw), "function handleDelete()"));
    assert.ok(!nodeDelete.includes("confirm("), "단추 쪽에 확인 창이 생겼다면 이 시험의 전제가 바뀐 것이다");
  });

  test("🔴 경로점은 **쓰던 통로 그대로** 지운다 — 새로 베껴 적지 않는다", () => {
    assert.ok(keyHandler.includes("handleRemoveSelectedWaypoint();"));
    assert.ok(screen.includes("const handleRemoveSelectedWaypoint = useCallback("), "경로점 지우개가 사라졌다");
    assert.ok(!keyHandler.includes("removeWaypoint("), "키가 경로점 지우기를 제 손으로 다시 하고 있다");
  });
});

describe("[Delete] 로 지우기(화면) — ⑤🔴 등록은 **하나**, 그리고 치운다", () => {
  test("🔴 keydown 등록이 화면에 하나뿐이다 — 둘이면 한 번 누른 키에 둘이 반응한다", () => {
    assert.equal(countOf(screen, 'addEventListener("keydown"'), 1);
  });

  test("🔴 떼어 내는 줄이 있다 — 없으면 렌더마다 쌓여 한 번에 여럿이 지워진다", () => {
    assert.ok(f.includes('return () => window.removeEventListener("keydown", handleKeyDown);'));
  });
});

describe("[Delete] 로 지우기(화면) — ⑥🔴 **상시 안내를 세 번째로 세우지 않았다**", () => {
  test("🔴 화면에 키를 설명하는 글이 없다 — 이 자리에 두 번 세웠다 두 번 다 지웠다(d57f664a)", () => {
    assert.ok(!screen.includes("[Delete]"), "편집기 화면에 [Delete] 안내가 섰다");
    assert.ok(!screen.includes("Delete 키"), "편집기 화면에 키 설명이 섰다");
  });

  test("🔵 다만 삭제 단추의 **툴팁**에는 적는다 — 자리를 안 차지하고 찾는 사람만 본다", () => {
    assert.ok(nodePanel.includes('title={deleteBlockedReason ?? "[Delete] 키로도 지울 수 있습니다"}'));
    assert.ok(edgePanel.includes('"[Delete] 키로도 지울 수 있습니다"'));
  });

  test("🔴 그 글자가 **툴팁 밖으로 새지 않았다** — `<p>` 로 한 줄 더 서면 세 번째가 된다", () => {
    for (const [name, source] of [
      ["NodePropertyPanel", nodePanel],
      ["EdgePropertyPanel", edgePanel],
    ] as const) {
      let at = source.indexOf("[Delete]");
      assert.notEqual(at, -1, `${name} 에 툴팁이 아예 없다 — 위 단언과 함께 깨져야 한다`);
      while (at !== -1) {
        assert.ok(source.slice(Math.max(0, at - 160), at).includes("title="), `${name} 의 [Delete] 가 툴팁 밖에 있다`);
        at = source.indexOf("[Delete]", at + 1);
      }
    }
  });

  test("🔴 막힌 노드의 툴팁은 **키 이야기를 안 한다** — 그때는 키로도 안 지워진다", () => {
    // 🔴 `deleteBlockedReason ?? …` 차례가 뒤집히면 흐린 단추 위에 「[Delete] 로도
    //    지울 수 있습니다」가 뜬다 — 툴팁이 거짓말을 하게 된다.
    assert.ok(nodePanel.includes('title={deleteBlockedReason ?? "'), "막힌 까닭이 먼저여야 한다");
    assert.ok(!nodePanel.includes('title={"[Delete]'), "키 이야기가 막힌 까닭을 이기고 있다");
  });

  test("🔵 연결선 툴팁은 **경로점이 먼저**라는 차례를 그대로 말한다", () => {
    // 🔵 경로점을 고른 동안에는 [Delete] 가 그 점부터 지운다(가장 안쪽). 그 상태에서
    //    「[Delete] 로도 분기를 지울 수 있다」고 적으면 거짓이다.
    assert.ok(edgePanel.includes("selectedWaypointIndex === null ? \"[Delete] 키로도 지울 수 있습니다\""));
    assert.ok(edgePanel.includes("경로점을 고른 동안에는 [Delete] 가 그 경로점을 먼저 지웁니다"));
  });
});
