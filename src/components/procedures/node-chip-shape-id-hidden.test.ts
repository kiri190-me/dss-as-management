import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 노드 상자에서 **`shape#…` 이 안 보인다** (2026-11-05)
 * ============================================================================
 * 사용자 요구: "노드에 [shape#nn]은 표시되지 않도록 해줘."
 *
 * 🔴 **`sourceShapeId` 칸을 지우는 일이 아니다.** 검증 이슈가 `shape#50` 꼴로 노드를
 * 되찾고(`procedure-graph-navigation.ts`), 찾기 칸이 그 번호로 노드를 고른다. 이
 * 시험이 재는 것은 「값이 없는가」가 아니라 **「캔버스의 노드 상자에 글자로 그려지는가」**다.
 *
 * ── 🔴 어디를 끄고 어디를 켜 두는가 ─────────────────────────────────────
 * 끈 자리는 **캔버스의 노드 상자 하나**(ProcedureFlowGraph 의 subtitle)다.
 * 🔵 노드를 고른 뒤 옆에 뜨는 **상세 패널**(editor/NodePropertyPanel)은 **그대로
 * 둔다** — 「이 노드가 엑셀 어디서 왔나」를 아는 유일한 자리이고, 사용자가 말한
 * 「노드에 표시」는 상자 쪽이다. 그 사실도 아래 ③절에서 값으로 못 박는다. 안 그러면
 * 다음 사람이 「shape# 를 지워라」로만 읽고 패널까지 걷어, 검증 이슈에서 넘어온
 * 사람이 어느 도형인지 영영 못 보게 된다.
 *
 * ── 🔴 주석을 세면 안 된다 ──────────────────────────────────────────────
 * 이 저장소가 실제로 밟은 함정이다. 여기서는 더 위험하다 — **걷어낸 자리에 왜
 * 걷었는지를 주석으로 적어 두었고 그 주석에 `shape#` 글자가 그대로 들어 있다.**
 * 걸러내기가 안 돌면 고쳐 놓고도 빨갛게 터진다. 걸러내기가 일하고 있다는 증거는
 * ②절에 값으로 둔다(이웃 procedure-code-hidden-screens.test.ts 와 같은 방법).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/** 주석을 걷어낸 소스 — JSX 주석 · 블록 주석 · 줄 주석 셋 모두. */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const FLOW_GRAPH = "src/components/procedures/ProcedureFlowGraph.tsx";
const PROPERTY_PANEL = "src/components/procedures/editor/NodePropertyPanel.tsx";

/** 글자 안에 `shape#` 를 끼워 넣는 자리 — 템플릿 문자열이든 JSX 글자든. */
const SHAPE_ID_TEXT_RE = /shape#\$\{/;

describe("노드 상자에서 shape# 숨기기", () => {
  // ── ① 캔버스의 노드 상자에는 안 그린다 ──────────────────────────────
  test("🔴 ProcedureFlowGraph 의 노드 상자가 shape# 를 글자로 안 그린다", () => {
    const source = stripComments(read(FLOW_GRAPH));
    assert.equal(
      SHAPE_ID_TEXT_RE.test(source),
      false,
      "노드 상자에 shape# 를 끼워 넣는 자리가 다시 생겼다"
    );
  });

  test("시트 이름은 그대로 둔다 — 사용자가 말한 것은 도형 번호다", () => {
    const source = stripComments(read(FLOW_GRAPH));
    assert.match(source, /subtitle=\{data\.sourceWorksheet\}/);
  });

  test("🔵 `sourceShapeId` 칸 자체는 남아 있다 — 검증 이슈가 그 번호로 노드를 되찾는다", () => {
    const source = stripComments(read(FLOW_GRAPH));
    assert.match(source, /sourceShapeId/);
  });

  // ── ② 걸러내기가 실제로 일한다 ──────────────────────────────────────
  test("🔴 주석 걸러내기가 돈다 — 안 돌면 ①이 제 주석에 걸려 빨개진다", () => {
    const raw = read(FLOW_GRAPH);
    // 걷어낸 자리의 주석에 `shape#${…}` 꼴이 실제로 남아 있어야 이 증거가 성립한다.
    assert.equal(SHAPE_ID_TEXT_RE.test(raw), true, "주석에서도 사라졌다 — ②가 공짜로 통과한다");
    assert.equal(SHAPE_ID_TEXT_RE.test(stripComments(raw)), false);
  });

  // ── ③ 상세 패널은 그대로 ────────────────────────────────────────────
  test("🔴 노드 상세 패널은 shape# 를 **계속 보여 준다** — 엑셀 어디서 왔는지 아는 유일한 자리", () => {
    const source = stripComments(read(PROPERTY_PANEL));
    assert.equal(
      SHAPE_ID_TEXT_RE.test(source),
      true,
      "상세 패널에서까지 걷어냈다 — 검증 이슈에서 넘어온 사람이 어느 도형인지 못 본다"
    );
  });
});
