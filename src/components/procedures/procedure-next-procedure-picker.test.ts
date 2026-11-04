import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * [종료]의 **「다음 절차」 고르는 칸** (2026-11-04, 줄기 B ④ 조각 ②)
 * ============================================================================
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * NodePropertyPanel 은 서버 액션을 직접 import 하는 클라이언트 컴포넌트라 사슬
 * 끝에 `server-only` 가 있고, ProcedureTemplateEditorScreen 은 @xyflow/react 의
 * .css 까지 끌고 온다 — 어느 목록에서도 import 자체가 던진다. 이웃
 * procedure-editor-confirm-dialogs.test.ts 가 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 조각도 「왜 이렇게 했는지」를 그 자리 주석에 길게 적었고, 거기에 재려는
 * 글자(`node.nodeType === "END"` · `newNodeType`)가 **글자 그대로** 들어 있다.
 * 안 걷으면 「있어야 한다」 쪽이 주석만으로 영영 통과한다. ①절 마지막 단언이
 * 걷어내기가 실제로 일을 하고 있다는 증거다.
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

const flat = (source: string) => source.replace(/\s+/g, " ");

const panelRaw = read("src/components/procedures/editor/NodePropertyPanel.tsx");
const screenRaw = read("src/components/procedures/ProcedureTemplateEditorScreen.tsx");
const pageRaw = read("src/app/(app)/procedures/[id]/edit/page.tsx");
const panel = flat(stripComments(panelRaw));
const screen = flat(stripComments(screenRaw));
const page = flat(stripComments(pageRaw));

describe("다음 절차 고르기 — ① [종료] 노드에만 선다", () => {
  test("🔵 먼저 표본 — 주석 걷어내기가 실제로 일을 한다", () => {
    assert.ok(
      flat(panelRaw).includes("그 값은 아직 서버에 안 간"),
      "표본이 되려면 패널 주석에 이 글이 실제로 있어야 한다"
    );
    assert.ok(!panel.includes("그 값은 아직 서버에 안 간"), "걷어내기가 일을 안 하고 있다");
  });

  test("🔴 고르는 칸이 `node.nodeType === \"END\"` 로 가려진다", () => {
    assert.ok(panel.includes('node.nodeType === "END" && ('), "END 가 아닌 노드에 뜨면 저장이 거절한다");
  });

  test("🔴 **저장 안 된 `newNodeType` 으로 가리지 않는다** — 아직 서버에 안 간 값이다", () => {
    const gate = panel.slice(panel.indexOf("다음 절차") - 400, panel.indexOf("다음 절차"));
    assert.ok(
      !gate.includes('newNodeType === "END"'),
      "고르는 중인 유형으로 칸을 열면, 고른 값이 저장 단계에서 END 가 아니라는 이유로 거절된다"
    );
  });

  test("「이어가지 않음」을 고를 수 있다 — 지정을 지우는 길이 화면에 있어야 한다", () => {
    assert.ok(panel.includes('<option value="">이어가지 않음</option>'));
  });
});

describe("다음 절차 고르기 — ② 목록에 없는 지정이 조용히 지워지지 않는다", () => {
  test("🔴 후보에 없는 값을 따로 센다", () => {
    assert.ok(panel.includes("const orphanedNextProcedureId ="));
    assert.ok(
      panel.includes("!nextProcedureCandidates.some((c) => c.id === draft.nextProcedureTemplateId)"),
      "후보에 있는지 보지 않으면 만료·삭제된 지정이 「이어가지 않음」으로 보인다"
    );
  });

  test("🔴 그때 **글자로 밝힌다** — 빈 자리로 두면 사람이 못 알아챈다", () => {
    assert.ok(panel.includes("orphanedNextProcedureId && ("));
    assert.ok(panel.includes("고를 수 있는 목록에 없습니다"));
  });
});

describe("다음 절차 고르기 — ③ 고른 값이 저장까지 간다", () => {
  test("🔴 [저장]이 보내는 patch 에 들어 있다 — 없으면 고르기만 되고 안 올라간다", () => {
    assert.ok(
      screen.includes("nextProcedureTemplateId: draft.nextProcedureTemplateId,"),
      "patch 에서 빠지면 [저장]이 성공이라 말하고 값은 그대로다"
    );
  });

  test("🔴 빈 글자로 떨어뜨리지 않는다 — FK 에 빈 글자가 날아간다", () => {
    assert.ok(
      !screen.includes("nextProcedureTemplateId: draft.nextProcedureTemplateId.trim()"),
      "이 값은 id 아니면 null 이라 글자 다듬기를 거치면 안 된다"
    );
    assert.ok(!screen.includes("nextProcedureTemplateId: draft.nextProcedureTemplateId || null"));
  });

  test("후보 목록이 페이지 → 화면 → 패널로 이어진다", () => {
    assert.ok(page.includes("listNextProcedureLinkCandidates(template.code)"), "자기 계열을 빼려면 code 가 필요하다");
    assert.ok(page.includes("nextProcedureCandidates={nextProcedureCandidates}"));
    assert.ok(screen.includes("nextProcedureCandidates={nextProcedureCandidates}"));
  });

  test("🔵 안 넘기는 호출부에서는 빈 목록이다 — 기본값이 fail-closed 다", () => {
    assert.ok(screen.includes("nextProcedureCandidates = [],"));
    assert.ok(panel.includes("nextProcedureCandidates = [],"));
  });
});
