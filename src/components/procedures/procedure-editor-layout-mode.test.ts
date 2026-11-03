import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 편집기의 「배치」를 **「사용자 배치」 하나로** (2026-11-03, 줄기 B-⑤ 나).
 *
 * ── 왜 이 시험이 있는가 ─────────────────────────────────────────────────
 * 사용자가 말한 것: "[배치]도 [사용자 배치]만 있으면 될 것 같아."
 *
 * 그런데 그 드롭다운은 ProcedureFlowGraph **한 곳**에만 있고, 그 부품을 **네
 * 화면**이 쓴다 — 편집기 · 절차 상세(읽기 전용) · 실행 시작 노드 고르기 ·
 * 「전체 단계 보기」 팝업. 그래서 좁히는 일은 **편집기에서만** 일어나야 하고,
 * 나머지 셋은 글자 하나 안 바뀌어야 한다. 그 「안 바뀜」은 눈으로는 확인이 안
 * 된다(읽기 전용 화면 둘은 조작줄 자체를 안 그린다) — 여기서 잰다.
 *
 * 함께 재는 것이 하나 더 있다: **편집기의 기본 배치가 고를 수 있는 것 안에
 * 있는가.** 전에는 기본이 "SOURCE" 였으므로, 선택지에서 빼면서 기본값을 안
 * 바꾸면 **고를 수 없는 모드로 떠 있는** 화면이 된다. 그 어긋남은 화면에
 * 오류로 나타나지 않는다 — 드롭다운이 없으니 사람이 알아챌 길도 없다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * 이웃들(procedure-editor-confirm-dialogs.test.ts ·
 * procedure-editor-publish-and-issue-row.test.ts)과 같은 사정이다:
 * ProcedureFlowGraph/편집기 화면은 @xyflow/react 의 .css 와 서버 액션을 함께
 * 물고 있어 import 자체가 던진다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 까닭을 그 자리 주석에 길게 적는다. 이 조각에서 늘어난 주석에는
 * "SOURCE"·"STAGE_SORTED" 같은 글자가 잔뜩 들어 있어서, 안 걷으면 "없어졌는가"
 * 쪽이 영영 깨지고 "남아 있는가" 쪽이 주석만으로 영영 통과한다. ①절의 마지막
 * 단언이 걷어내기가 실제로 일을 한다는 증거다.
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

const PATHS = {
  graph: "src/components/procedures/ProcedureFlowGraph.tsx",
  editor: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  detail: "src/components/procedures/ProcedureTemplateDetailScreen.tsx",
  picker: "src/components/procedures/execution/ProcedureStartPickerGraph.tsx",
  executionSteps: "src/components/procedures/execution/ExecutionStepsGraph.tsx",
} as const;

const graph = stripComments(read(PATHS.graph));
const editor = stripComments(read(PATHS.editor));
const detail = stripComments(read(PATHS.detail));
const picker = stripComments(read(PATHS.picker));
const executionSteps = stripComments(read(PATHS.executionSteps));

/** `const <name>: … = [ … ];` 의 대괄호 안에서 따옴표로 묶인 값만 뽑는다. */
function stringArrayLiteral(source: string, declaration: string): string[] {
  const from = source.indexOf(declaration);
  assert.notEqual(from, -1, `${declaration} 를 못 찾았다`);
  // 🔵 `[` 로 찾으면 타입 쪽의 `LayoutMode[]` 를 먼저 집는다 — 대입 기호까지 함께 본다.
  const open = source.indexOf("= [", from) + 2;
  const close = source.indexOf("]", open);
  assert.ok(open !== -1 && close > open, `${declaration} 의 배열을 못 읽었다`);
  return [...source.slice(open, close).matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

describe("줄기 B-⑤ 나 — ① 먼저 표본 확인", () => {
  test("🔵 다섯 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ graph, editor, detail, picker, executionSteps })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(graph.includes('export type LayoutMode = "SOURCE" | "USER" | "STAGE_SORTED";'), "배치 모드 셋이 그대로여야 한다 — 하나도 없앤 것이 아니다");
    assert.ok(graph.includes("function layoutModeLabel(mode: LayoutMode): string {"), "이름 푸는 자리를 못 찾았다");
    for (const source of [detail, picker, executionSteps]) {
      assert.ok(source.includes("<ProcedureFlowGraph"), "읽기 전용 셋이 정말 이 그림을 그려야 아래 단언에 뜻이 있다");
    }
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 코드에 없는 글자가 주석으로 적혀 있다", () => {
    assert.ok(read(PATHS.graph).includes("고장으로 읽힌다"), "그림 주석에 드롭다운을 안 그리는 까닭이 적혀 있어야 한다");
    assert.ok(!graph.includes("고장으로 읽힌다"), "코드에는 그 문장이 없다 — 걷어내기가 일을 안 하고 있다");
    assert.ok(read(PATHS.editor).includes("한 줄기로 합쳤다"), "편집기 주석에 기본값을 바꾼 까닭이 적혀 있어야 한다");
    assert.ok(!editor.includes("한 줄기로 합쳤다"));
  });
});

describe("줄기 B-⑤ 나 — 고를 수 있는 배치를 바깥에서 정한다", () => {
  test("🔴 프롭의 기본값이 **지금까지의 셋 그대로**다 — 안 넘기는 화면 셋이 안 바뀌는 근거", () => {
    assert.deepEqual(
      stringArrayLiteral(graph, "const DEFAULT_LAYOUT_MODE_OPTIONS"),
      ["SOURCE", "USER", "STAGE_SORTED"],
      "기본 목록이 줄면 아무것도 안 넘긴 화면들이 함께 바뀐다"
    );
    assert.ok(flat(graph).includes("layoutModeOptions = DEFAULT_LAYOUT_MODE_OPTIONS,"), "프롭을 안 넘기면 그 기본 목록이 쓰여야 한다");
    assert.ok(flat(graph).includes("layoutModeOptions?: readonly LayoutMode[];"), "프롭은 선택이어야 한다 — 필수가 되면 호출부 넷이 전부 바뀐다");
  });

  test("🔴 「사용자 배치」 관문은 그대로다 — 목록에 적는 것만으로는 읽기 전용 그림에서 안 열린다", () => {
    // 끌기·경로점이 함께 열리는 모드라, 바깥 목록이 editable 을 이기면 안 된다.
    assert.ok(flat(graph).includes('const selectableLayoutModes = layoutModeOptions.filter((mode) => mode !== "USER" || editable);'));
    // 그 전부터 있던 끌기 관문 둘은 한 글자도 안 건드렸다.
    assert.ok(graph.includes('nodesDraggable={editable && layoutMode === "USER"}'));
    assert.ok(graph.includes('if (!editable || layoutMode !== "USER") return;'));
  });

  test("🔴 고를 것이 둘 이상이면 드롭다운, 하나뿐이면 **글자**로 그린다", () => {
    const f = flat(graph);
    assert.ok(f.includes("{selectableLayoutModes.length > 1 ? ("), "가지는 「셀 수 있는 선택지」 하나로 갈려야 한다");
    assert.ok(f.includes('<select id="procedure-flow-layout-mode" value={layoutMode}'), "둘 이상이면 전과 같은 드롭다운이다");
    assert.ok(f.includes("{selectableLayoutModes.map((mode) => ( <option key={mode} value={mode}> {layoutModeLabel(mode)} </option> ))}"));
    // 하나뿐일 때 — 지금 보고 있는 모드의 이름이 그대로 보인다.
    assert.ok(f.includes("배치: <span className=\"font-medium text-zinc-700 dark:text-zinc-300\">{layoutModeLabel(layoutMode)}</span>"));
    // 옛 모양(세 줄을 손으로 적던 option)은 남지 않았다 — 남으면 좁히기가 반만 듣는다.
    assert.ok(!f.includes('<option value="SOURCE">원본 배치</option>'), "손으로 적던 option 이 남아 있으면 목록 프롭이 무시된다");
    assert.ok(!f.includes('{editable && <option value="USER">사용자 배치</option>}'));
  });

  test("🔵 세 모드의 이름은 글자 그대로 남았다 — 읽기 전용 드롭다운이 전과 같은 말을 한다", () => {
    const f = flat(graph);
    assert.ok(f.includes('if (mode === "SOURCE") return "원본 배치";'));
    assert.ok(f.includes('if (mode === "USER") return "사용자 배치";'));
    assert.ok(f.includes('return `단계별 정렬 ${editable ? "미리보기" : "(컴팩트)"}`;'), "편집기/읽기 전용의 꼬리말 차이도 그대로다");
  });
});

describe("줄기 B-⑤ 나 — 편집기만 좁아졌다", () => {
  test("🔴 편집기가 넘기는 목록은 「사용자 배치」 하나다", () => {
    assert.deepEqual(stringArrayLiteral(editor, "const EDITOR_LAYOUT_MODES"), ["USER"]);
    assert.ok(flat(editor).includes("layoutModeOptions={EDITOR_LAYOUT_MODES}"), "만들어 놓고 안 넘기면 아무것도 안 바뀐다");
    // 렌더마다 새 배열을 만들면 프롭이 매번 바뀐 것이 된다 — 모듈 바깥 상수여야 한다.
    assert.ok(!flat(editor).includes('layoutModeOptions={["USER"]}'));
  });

  test("🔴 편집기의 **기본 배치**가 그 하나와 같다 — 고를 수 없는 모드로 떠 있으면 안 된다", () => {
    const match = /const \[layoutMode, setLayoutMode\] = useState<LayoutMode>\("([A-Z_]+)"\);/.exec(editor);
    assert.ok(match, "편집기의 배치 기본값을 못 찾았다");
    const [onlyOption] = stringArrayLiteral(editor, "const EDITOR_LAYOUT_MODES");
    assert.equal(match![1], onlyOption, "기본값과 고를 수 있는 것이 갈라졌다");
    assert.equal(match![1], "USER", "표본 확인 — 둘 다 엉뚱한 값으로 함께 바뀌면 위 단언은 통과한다");
  });

  test("🔵 경로점을 더할 때 모드를 USER 로 미는 길은 그대로 남았다 — 이제 거의 항상 이미 USER 지만, 지우면 안 된다", () => {
    // 되돌리기(undo)가 배치 모드까지 되돌리는 날이 오면 다시 필요해진다.
    assert.ok(flat(editor).includes('setLayoutMode("USER");'));
  });
});

describe("줄기 B-⑤ 나 — 🟢 나머지 화면 셋은 글자 하나 안 바뀌었다", () => {
  test("🔴 셋 다 layoutModeOptions 를 안 넘긴다 — 그래서 선택지가 전과 같은 셋이다", () => {
    for (const [name, source] of Object.entries({ detail, picker, executionSteps })) {
      assert.ok(!source.includes("layoutModeOptions"), `${name} 이 목록을 넘기기 시작했다`);
      assert.ok(!source.includes("layoutMode="), `${name} 이 배치 모드를 제어하기 시작했다 — 안 넘기면 내부 기본값(SOURCE)이다`);
    }
  });

  test("🔴 그림의 내부 기본값은 여전히 SOURCE 다 — 안 넘기는 셋이 떠 있는 자리", () => {
    assert.ok(graph.includes('const [internalLayoutMode, setInternalLayoutMode] = useState<LayoutMode>("SOURCE");'));
    assert.ok(graph.includes("const layoutMode = controlledLayoutMode ?? internalLayoutMode;"));
  });

  test("🔵 조작줄을 숨기는 둘은 애초에 드롭다운이 없다 — 이 조각이 닿지 않는다", () => {
    assert.ok(picker.includes("showChrome={false}"));
    assert.ok(executionSteps.includes("showChrome={false}"));
    assert.ok(graph.includes("{showChrome && ("), "조작줄 전체가 그 깃발 안에 있어야 한다");
  });
});
