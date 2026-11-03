import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 「기술 작업 절차」 편집기 — **검증 오류를 누르면 그 노드·연결선을 짚어
 * 준다**(2026-11-03, 줄기 B-③).
 *
 * ── 왜 이 시험이 있는가 ─────────────────────────────────────────────────
 * 사용자가 말한 것: "[검증]에서 이런저런 오류/경고 들이 뜨는데, 그것들을
 * 클릭하면 어느 노드, 연결선이 잘못된 건지 편집창에 표시해줘."
 *
 * 값은 전부터 있었다 — 구조 검증이 한 건마다 nodeId/edgeId 를 싣고 서버
 * 액션을 그대로 지나 화면까지 온다. 없던 것은 **그걸 그림에 잇는 길**과
 * **연결선을 짚는 길**이다(그림에는 노드 쪽 강조만 있었다). 그래서 이 시험이
 * 지키는 것은 셋이다:
 *   ① 누를 수 있는 줄과 없는 줄이 **한 판정**에서 갈리는가 — 둘로 갈리면
 *      "흐려 보이는데 눌리는" 또는 "눌리는데 아무 일도 안 일어나는" 줄이
 *      생기고, 사람은 뒤쪽을 고장으로 읽는다.
 *   ② 🔴 **이 그림을 함께 쓰는 나머지 세 화면**(절차 상세 · 실행 시작
 *      고르기 · 「전체 단계 보기」 팝업)이 글자 하나 안 바뀌는가.
 *   ③ 바로 앞 두 조각(줄기 B-① 되돌리기 · B-② 확인 창)을 안 깨뜨렸는가.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureFlowGraph 는 @xyflow/react 의 .css 를 물고 있고
 * ProcedureTemplateEditorScreen 은 그 위에 서버 액션까지 끌고 온다 — 어느
 * 목록에서도 import 자체가 던진다. 이웃들
 * (procedure-template-editor-undo.test.ts ·
 * procedure-editor-confirm-dialogs.test.ts)이 같은 사정에서 쓴 방법 그대로다.
 *
 * 🔵 **판정 자체는 원본 글자가 아니라 진짜로 돌려 본다** — 순수 함수로 꺼내
 * 두었기 때문이다: unit 목록의
 * src/lib/domain/procedure-validation-issue-focus.test.ts(어디를 가리키는가)와
 * src/lib/domain/procedure-edge-routing.test.ts(강조가 선 하나에 무엇을 하는가,
 * 특히 **안 넘겼을 때 아무 영향이 없다**). 이 파일은 "화면이 그 판정을 정말
 * 물고 있는가"만 본다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 까닭을 그 자리 주석에 길게 적는다. 실제로 두 파일의 주석에
 * 다른 파일의 함수 이름(focusHighlightProps · keepOnlyExisting)이 글자
 * 그대로 적혀 있어서, 주석을 안 걷으면 "그 함수를 쓰는가"가 공짜로 통과한다.
 * ①절의 마지막 단언이 걷어내기가 실제로 일을 한다는 증거다.
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
  startPicker: "src/components/procedures/execution/ProcedureStartPickerGraph.tsx",
  stepsGraph: "src/components/procedures/execution/ExecutionStepsGraph.tsx",
  focusHelper: "src/lib/domain/procedure-validation-issue-focus.ts",
  edgeRouting: "src/lib/domain/procedure-edge-routing.ts",
} as const;

const graph = stripComments(read(PATHS.graph));
const editor = stripComments(read(PATHS.editor));
const detail = stripComments(read(PATHS.detail));
const startPicker = stripComments(read(PATHS.startPicker));
const stepsGraph = stripComments(read(PATHS.stepsGraph));
const focusHelper = stripComments(read(PATHS.focusHelper));
const edgeRouting = stripComments(read(PATHS.edgeRouting));

describe("검증 오류 짚기(화면) — ① 먼저 표본 확인", () => {
  test("🔵 일곱 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ graph, editor, detail, startPicker, stepsGraph, focusHelper, edgeRouting })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(graph.includes("const flowEdges = useMemo"), "그림의 연결선 만드는 자리를 못 찾았다");
    assert.ok(editor.includes("function handleIssueRowFocus("), "오류 줄 누르기 처리를 못 찾았다");
    assert.ok(editor.includes("function ValidationIssueRow("), "오류 줄 부품을 못 찾았다");
    assert.ok(focusHelper.includes("export function buildValidationIssueFocusMap("));
    assert.ok(edgeRouting.includes("export function resolveExternalEdgeHighlight("));
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 다른 파일의 함수 이름이 주석으로 적혀 있다", () => {
    // 까닭을 그 자리에 적어 두었기 때문이다. 이 단언이 깨지면(= 주석에서 그
    // 글자가 사라지면) 아래 "이 함수를 쓰는가" 단언들이 주석을 안 걷어도
    // 통과하게 되어, 시험이 아무것도 안 재는 상태로 조용히 바뀐다.
    assert.ok(read(PATHS.graph).includes("focusHighlightProps"), "그림 주석에 접기의 출처가 적혀 있어야 한다");
    assert.ok(!graph.includes("focusHighlightProps"), "그림은 그 함수를 코드로는 쓰지 않는다(편집기가 쓴다)");
    assert.ok(read(PATHS.editor).includes("keepOnlyExisting"), "편집기 주석에 자동 해제의 까닭이 적혀 있어야 한다");
    assert.ok(!editor.includes("keepOnlyExisting"), "편집기는 그 함수를 직접 부르지 않는다(지도 만들 때 helper 안에서 돈다)");
  });
});

describe("검증 오류 짚기(화면) — ② 그림: 연결선을 짚는 길이 새로 생겼다", () => {
  test("🔴 highlightedEdgeIds 프롭이 있고 **기본값이 null** 이다 — 안 넘기는 화면이 전과 같아야 한다", () => {
    assert.ok(flat(graph).includes("highlightedEdgeIds = null,"), "기본값이 null 이 아니면 안 넘긴 화면이 조용히 바뀐다");
    assert.ok(flat(graph).includes("highlightedEdgeIds?: readonly string[] | null;"), "선택 프롭이어야 한다");
  });

  test("🔴 null 과 빈 배열이 갈린다 — 빈 배열은 「전부 흐려짐」이라 뜻이 정반대다", () => {
    assert.ok(
      flat(graph).includes("() => (highlightedEdgeIds === null ? null : new Set(highlightedEdgeIds)),"),
      "null 일 때 Set 을 아예 안 만들어야 두 뜻이 갈린다"
    );
  });

  test("🔴 연결선을 만드는 **두 갈래 모두**가 같은 판정 하나를 지난다", () => {
    // 갈래는 둘이다: 원본/사용자 배치(그 안에서 수동 경로와 기본 모양이
    // 다시 갈리지만 external 하나를 함께 쓴다)와 단계별 정렬. 한쪽이 빠지면
    // 그 배치에서만 짚기가 안 듣고, 증상은 "배치를 바꾸면 안 된다"다.
    const uses = flat(graph).match(/resolveExternalEdgeHighlight\(e\.id, highlightedEdgeIdSet\)/g) ?? [];
    assert.equal(uses.length, 2, "연결선 묶음 두 갈래(원본·사용자 배치 / 단계별 정렬) 모두에서 불러야 한다");
    assert.ok(flat(graph).includes("const isEmphasized = isHighlighted || external.pinned;"));
    assert.ok(flat(graph).includes("const isFaded = !external.pinned && (isDimmed || external.muted);"));
  });

  test("🔴 굵기·겹침·흐리기가 더 이상 선택(isHighlighted) 하나로만 정해지지 않는다", () => {
    const f = flat(graph);
    assert.ok(!f.includes("strokeWidth: isHighlighted ?"), "굵기가 선택만 본다면 짚은 선이 굵어지지 않는다");
    assert.ok(!f.includes("zIndex: isHighlighted ?"), "겹침이 선택만 본다면 짚은 선이 다른 선 밑에 깔린다");
    assert.ok(!f.includes("opacity: isDimmed ? dimOpacity : 1,"), "흐리기가 선택만 본다면 짚기 밖의 선이 안 흐려진다");
    assert.ok(f.includes("strokeWidth: isEmphasized ? config.strokeWidth + 1.5 : config.strokeWidth,"));
    assert.ok(f.includes("opacity: isFaded ? dimOpacity : 1,"));
  });

  test("🔴 단계별 정렬에서 **숨김(hidden)은 건드리지 않는다** — 사람이 직접 고른 「연결 표시」 필터다", () => {
    const f = flat(graph);
    assert.ok(f.includes("if (visibility.hidden) continue;"), "숨김 판정이 그대로 남아 있어야 한다");
    // 짚힌 선은 모드가 정한 값을 덮어쓰고 1 로, 밖의 선은 그 값을 한 번 더 누른다.
    assert.ok(f.includes("const effectiveOpacity = external.pinned ? 1 : external.muted ? Math.min(visibility.opacity, 0.25) : visibility.opacity;"));
  });

  test("🟢 노드 쪽 강조와 다른 프롭 둘(nodeMarks · draggableNodeIds)은 그대로다", () => {
    const f = flat(graph);
    assert.ok(f.includes("highlightedNodeIds = null,"));
    assert.ok(f.includes("nodeMarks = null,"));
    assert.ok(f.includes("draggableNodeIds = null,"));
    assert.ok(f.includes("isDimmed: !isSelected && (dimmedBySelection || dimmedByHighlight),"), "노드 흐리기 규칙은 손대지 않았다");
  });
});

describe("검증 오류 짚기(화면) — ③ 🔴 나머지 세 화면은 이 프롭을 안 넘긴다", () => {
  // 안 넘기면 아무 영향이 없다는 것 자체는 순수 함수 시험이 잰다
  // (procedure-edge-routing.test.ts 의 "안 넘겼으면(null) 아무 영향이 없다").
  // 여기서는 "정말 안 넘기는가"만 본다.
  test("절차 상세(읽기 전용)", () => {
    assert.ok(detail.includes("<ProcedureFlowGraph"), "표본이 비었다 — 이 화면이 그림을 안 쓴다면 단언이 공짜로 통과한다");
    assert.ok(!detail.includes("highlightedEdgeIds"));
  });

  test("실행 시작 고르기", () => {
    assert.ok(startPicker.includes("<ProcedureFlowGraph"));
    assert.ok(startPicker.includes("highlightedNodeIds={highlightedNodeIds}"), "노드 쪽 강조는 원래 쓰던 화면이다");
    assert.ok(!startPicker.includes("highlightedEdgeIds"));
  });

  test("「전체 단계 보기」 팝업", () => {
    assert.ok(stepsGraph.includes("<ProcedureFlowGraph"));
    assert.ok(stepsGraph.includes("highlightedNodeIds={highlightedNodeIds}"));
    assert.ok(!stepsGraph.includes("highlightedEdgeIds"));
  });
});

describe("검증 오류 짚기(화면) — ④ 편집기: 오류 줄을 누르면 짚힌다", () => {
  test("🔴 고른 오류가 가리키는 곳이 그림의 두 프롭으로 그대로 간다", () => {
    const f = flat(editor);
    assert.ok(f.includes("highlightedNodeIds={focusHighlightedNodeIds}"));
    assert.ok(f.includes("highlightedEdgeIds={focusHighlightedEdgeIds}"));
    assert.ok(
      f.includes("const { highlightedNodeIds: focusHighlightedNodeIds, highlightedEdgeIds: focusHighlightedEdgeIds } = focusHighlightProps(focusedIssue);"),
      "빈 배열을 null 로 접는 일은 helper 한 곳이 한다 — 화면이 직접 접으면 두 벌이 된다"
    );
  });

  test("🔴 누를 수 있는지와 무엇을 짚는지가 **지도 하나**에서 나온다", () => {
    const f = flat(editor);
    assert.ok(f.includes("buildValidationIssueFocusMap({"), "지도를 helper 로 만들어야 한다");
    assert.ok(f.includes("structuralIssues: lastStructuralValidation?.issues ?? [],"), "구조 검증 결과가 들어가야 한다");
    assert.ok(f.includes("importedIssues: template.unresolvedIssues,"), "가져오기 시점 이슈도 함께 들어가야 한다 — 탭에 둘 다 있다");
    // 🔴 "누를 수 있나"의 근거가 두 목록 모두에서 같은 지도 하나다.
    const canFocusUses = f.match(/canFocus=\{issueFocusByKey\.has\(focusKey\)\}/g) ?? [];
    assert.equal(canFocusUses.length, 2, "두 목록이 같은 지도를 봐야 한다");
    // 🔴 짚기 자체도 그 지도에서 뽑는다(state 에 복사해 두면 사라진 id 가 남는다).
    assert.ok(f.includes("const focusedIssue = focusedIssueKey === null ? null : issueFocusByKey.get(focusedIssueKey) ?? null;"));
  });

  test("🔴 짚을 대상이 없는 줄은 **단추가 아니다** — 눌리는데 아무 일도 안 일어나면 고장으로 읽힌다", () => {
    const f = flat(editor);
    assert.ok(f.includes("if (!canFocus) { return ( <li"), "못 짚는 줄은 단추 없이 <li> 로 끝나야 한다");
    assert.ok(f.includes("그림에서 짚을 노드·연결선이 없습니다"), "왜 못 누르는지를 그 자리에 적어야 한다");
    // 눌리는 줄에만 붙는 안내 — 보기에도 달라야 한다는 요구가 글자로 남는다.
    assert.ok(f.includes("누르면 그림에서 표시"));
    assert.ok(f.includes("aria-pressed={isFocused}"));
  });

  test("🔴 다른 줄을 누르면 옮겨가고, 같은 줄을 다시 누르면 풀린다 — 규칙은 helper 하나가 갖는다", () => {
    const f = flat(editor);
    assert.ok(f.includes("const next = toggleIssueFocusKey(focusedIssueKey, key);"));
    assert.ok(f.includes("setFocusedIssueKey(next);"));
    // 푸는 길이 하나 더: 고른 줄이 스크롤 밖으로 밀려도 돌아올 수 있어야 한다.
    assert.ok(f.includes("onClick={() => setFocusedIssueKey(null)}"));
    assert.ok(f.includes("표시 해제"));
  });

  test("🔵 짚은 곳이 화면 밖이면 카메라를 옮긴다 — 새 장치가 아니라 이미 들고 있던 인스턴스를 쓴다", () => {
    const f = flat(editor);
    assert.ok(f.includes("resolveFocusFitNodeIds(issueFocusByKey.get(next) ?? null, renderedEdges)"), "연결선만 가리키는 오류는 양 끝 칸으로 바꿔야 한다");
    assert.ok(f.includes("reactFlowInstanceRef.current?.fitView({ nodes: fitNodeIds.map((id) => ({ id })), duration: 300, padding: 1.5 });"));
    // 🔴 빈 목록이면 카메라를 아예 안 건드린다(fitView([]) 는 그래프 전체를 다시 맞춰 버린다).
    assert.ok(f.includes("if (fitNodeIds.length === 0) return;"));
  });

  test("🔴 [검증]을 다시 돌리면 짚기가 풀린다 — 구조 검증 줄의 이름은 목록 안 **자리**다", () => {
    const f = flat(editor);
    assert.ok(
      f.includes("setLastStructuralValidation(result.structuralValidation); setFocusedIssueKey(null);"),
      "결과를 갈아끼우면서 짚기를 안 풀면 사람이 고른 적 없는 곳이 짚혀 있다"
    );
  });
});

describe("검증 오류 짚기(화면) — ⑤ 🟢 앞 두 조각을 안 깨뜨렸다", () => {
  test("줄기 B-① — 되돌리기 단추의 조건과 도는 코드가 여전히 같은 계획 하나를 본다", () => {
    const f = flat(editor);
    assert.ok(f.includes("canUndo={canRunUndoPlan(undoPlan)}"));
    assert.ok(f.includes("canRedo={canRunUndoPlan(redoPlan)}"));
    assert.ok(!f.includes("hasAnyPendingChanges && canRunUndoPlan"), "되돌리기를 막던 옛 가드가 되살아나면 안 된다");
  });

  test("줄기 B-② — 구조 조작 세 패널이 여전히 handleStructuralSaved 한 통로로 묶인다", () => {
    const f = flat(editor);
    const uses = f.match(/onSaved=\{handleStructuralSaved\}/g) ?? [];
    assert.ok(uses.length >= 4, `구조 조작 패널들이 한 통로를 지나야 한다 — 지금 ${uses.length}곳`);
    assert.ok(!f.includes("<dialog"), "확인 창은 이 화면에 다시 생기지 않았다");
  });

  test("🟢 [검증] 탭의 두 목록과 집계 문구가 그대로 남아 있다 — 더하는 조각이지 바꾸는 조각이 아니다", () => {
    const f = flat(editor);
    assert.ok(f.includes("가져오기 시점 검증 이슈 (미해결)"));
    assert.ok(f.includes("구조 검증 결과"));
    assert.ok(f.includes("오류가 있으면 이 초안을 게시할 수 없습니다."));
  });
});
