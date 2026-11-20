import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * **「다음 절차」 고르는 칸** (2026-11-04, 줄기 B ④ 조각 ②)
 * ============================================================================
 * 🔴 **2026-11-20 에 이 절의 전제가 뒤집혔다.** 전에는 「고르는 칸이
 * `node.nodeType === "END"` 로 가려진다」를 글자로 재고 있었고, 그 시험 이름이
 * 「[종료] 노드에만 선다」였다. [작업]도 열기로 한 날 그 글자를 그대로 두면
 * **초록 ✔ 옆에 거짓이 남는다.** 그래서 지금은 **허용 목록 상수를 보는지**를
 * 잰다 — 다음에 유형을 또 열 때 이 파일을 고칠 일이 없어야 한다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * NodePropertyPanel 은 서버 액션을 직접 import 하는 클라이언트 컴포넌트라 사슬
 * 끝에 `server-only` 가 있고, ProcedureTemplateEditorScreen 은 @xyflow/react 의
 * .css 까지 끌고 온다 — 어느 목록에서도 import 자체가 던진다. 이웃
 * procedure-editor-confirm-dialogs.test.ts 가 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 조각도 「왜 이렇게 했는지」를 그 자리 주석에 길게 적었고, 거기에 재려는
 * 글자(`isNextProcedureLinkAllowedOn` · `newNodeType` · `=== "END"`)가 **글자
 * 그대로** 들어 있다. 안 걷으면 「있어야 한다」 쪽이 주석만으로 영영 통과하고,
 * 「없어야 한다」 쪽은 주석 때문에 영영 실패한다. ①절 첫 단언이 걷어내기가
 * 실제로 일을 하고 있다는 증거다.
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

describe("다음 절차 고르기 — ① 허용 목록 상수가 칸을 가린다", () => {
  test("🔵 먼저 표본 — 주석 걷어내기가 실제로 일을 한다", () => {
    assert.ok(
      flat(panelRaw).includes("그 값은 아직 서버에 안 간"),
      "표본이 되려면 패널 주석에 이 글이 실제로 있어야 한다"
    );
    assert.ok(!panel.includes("그 값은 아직 서버에 안 간"), "걷어내기가 일을 안 하고 있다");
  });

  test("🔴 고르는 칸이 **허용 목록 상수**로 가려진다 — 유형 글자를 박지 않는다", () => {
    assert.ok(
      panel.includes("{isNextProcedureLinkAllowedOn(node.nodeType) && ("),
      "달 수 없는 유형에 뜨면 저장이 거절한다"
    );
    assert.ok(
      panel.includes('from "@/lib/domain/procedure-next-procedure-link"'),
      "판정을 화면이 따로 들고 있으면 서버와 어긋나는 날이 온다"
    );
  });

  test("🔴 **`=== \"END\"` 로 가리지 않는다** (2026-11-20) — 유형을 열 때 빠뜨리는 자리다", () => {
    assert.ok(
      !panel.includes('node.nodeType === "END" && ('),
      "글자로 박으면 [작업]을 연 날처럼 이 한 줄만 END 로 남아 화면에서만 안 열린다"
    );
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

  /**
   * 🔴 같은 칸이지만 **일어나는 일이 다르다.** [종료]는 절차가 끝나면서 이어지고,
   * 나머지 유형은 절차 **한가운데서** 이어진다(원래 절차는 다음 단계로 그대로 간다).
   * 한 글로 뭉개면 중간 노드에 지정한 사람이 「여기서 절차가 끝난다」로 읽는다.
   */
  test("🔴 안내 글이 [종료]와 나머지에서 갈린다 — 한 글로 뭉개면 거짓이 된다", () => {
    assert.ok(panel.includes("이 절차가 끝나면 고른 절차를 이어서 엽니다."), "[종료] 쪽 글");
    assert.ok(panel.includes("지금 절차는 끝나지 않고 다음 단계로 그대로 이어집니다."), "중간 노드 쪽 글");
  });

  /**
   * 🔴 **갈래는 [종료] 하나뿐이어야 한다**(2026-11-20). 허용 유형이 넷이 됐는데
   * 유형마다 글을 따로 두면 다섯째가 열리는 날 또 손대야 하고, 그때 빠뜨린 유형은
   * **아무 글도 없는 칸**이 된다. 「이 단계를」은 [작업]·[검사]·[조치] 셋에 다 맞다.
   */
  test("🔴 중간 노드 쪽 글이 **「이 단계를」**이다 — 「이 작업을」은 [검사]·[조치]에서 거짓이 된다", () => {
    assert.ok(
      panel.includes("이 단계를 완료할 때 고른 절차를 이어서 열지 한 번 묻습니다."),
      "유형 셋에 다 맞는 한 글이어야 한다"
    );
    assert.ok(
      !panel.includes("이 작업을 완료할 때"),
      "검사 노드에 지정해 놓고 「작업을 완료할 때」를 읽으면 자기 노드 얘기가 아닌 줄 안다"
    );
  });

  /**
   * 🔵 갈래가 늘지 않았는지를 **세어서** 못 박는다. 위 두 시험은 「있는가」만 재므로
   * 유형별 갈래가 하나 더 생겨도 통과한다.
   */
  test("🔴 안내 글의 유형 갈래는 **[종료] 하나뿐**이다 — 유형이 늘 때마다 손댈 자리를 안 만든다", () => {
    const 갈래 = panel.match(/node\.nodeType === "[A-Z_]+"/g) ?? [];
    assert.deepEqual(
      갈래,
      ['node.nodeType === "END"'],
      "유형 글자로 가르는 자리가 늘면, 다음에 유형을 열 때 이 파일을 또 찾아 고쳐야 한다"
    );
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
