import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 🔴 그림이 **자동 배치 기억을 정말 쓰는가** (2026-11-20)
 * ============================================================================
 * 쓰는 분 신고: 「연결선을 삭제하면 노드 위치가 튄다.」 고친 길은 「한 번 그려 준
 * 자리는 다시 안 센다」이고, **셈과 규칙은 순수 함수 한 곳**에 있다
 * (src/lib/domain/procedure-auto-layout.ts 의 applyProcedureAutoLayoutMemory —
 * 「선을 지워도 한 칸도 안 움직인다」를 값으로 재는 시험이 그 옆에 있다:
 * src/lib/domain/procedure-auto-layout-stability.test.ts).
 *
 * 🔴 **여기서 재는 것은 배선 하나뿐이다** — 그림이 그 함수를 부르고, 돌려받은
 * 값을 **실제로 그리는가**. 파일에 함수가 있어도 아무도 안 부르면 화면은 한 글자도
 * 안 바뀐다(이 저장소에서 실제로 났던 함정이다). 값 쪽 시험은 그 경우에도 전부
 * 통과하므로, 그 둘을 함께 둬야 결함이 잡힌다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureFlowGraph 는 @xyflow/react 의 .css 를 물고 있어 import 자체가 던진다.
 * 이웃 시험들(procedure-editor-field-steps-ui.test.ts 등)과 같은 사정·같은 방법이다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 조각에서 늘어난 주석에 "applyProcedureAutoLayoutMemory"·"기억" 같은 글자가
 * 잔뜩 들어 있다. 안 걷으면 「있어야 한다」 쪽이 **주석만으로 영영 통과**한다.
 * ①절의 마지막 단언이 걷어내기가 실제로 일을 한다는 증거다.
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

const PATHS = {
  graph: "src/components/procedures/ProcedureFlowGraph.tsx",
  autoLayout: "src/lib/domain/procedure-auto-layout.ts",
  detail: "src/components/procedures/ProcedureTemplateDetailScreen.tsx",
  editor: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
} as const;

const graph = stripComments(read(PATHS.graph));
const autoLayout = stripComments(read(PATHS.autoLayout));
const detail = stripComments(read(PATHS.detail));
const editor = stripComments(read(PATHS.editor));

describe("자동 배치 기억 — ① 먼저 표본 확인", () => {
  test("🔵 네 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ graph, autoLayout, detail, editor })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래가 전부 공짜로 통과한다`);
    }
    assert.ok(graph.includes("export default function ProcedureFlowGraph({"), "그림 부품을 못 찾았다");
    assert.ok(autoLayout.includes("export function applyProcedureAutoLayoutMemory("), "기억 규칙이 순수 함수로 있어야 한다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 코드에 없는 글자가 주석으로 적혀 있다", () => {
    assert.ok(read(PATHS.autoLayout).includes("순수 함수로는 못 고친다"), "기억을 둔 까닭이 주석에 적혀 있어야 한다");
    assert.ok(!autoLayout.includes("순수 함수로는 못 고친다"), "코드에는 그 문장이 없다 — 걷어내기가 일을 안 하고 있다");
  });
});

describe("자동 배치 기억 — ② 그림이 그 기억을 정말 쓴다", () => {
  test("🔴 그림이 기억 규칙을 **제 손으로 다시 적지 않고** 그 함수를 부른다", () => {
    const f = flat(graph);
    assert.ok(f.includes("applyProcedureAutoLayoutMemory,"), "import 가 없으면 아래 호출이 애초에 안 선다");
    assert.ok(f.includes("return applyProcedureAutoLayoutMemory(fresh, memory);"));
    // 🔴 그림이 제 손으로 「기억이 있으면 그것」을 적으면 두 곳이 조용히 갈린다 —
    //    값으로 재는 시험은 순수 함수만 보므로 그 갈림을 못 잡는다.
    assert.ok(!f.includes("?? fresh.get("), "옮기는 규칙이 그림에 다시 적히면 시험이 보는 곳과 화면이 갈린다");
  });

  test("🔴 **갓 센 값이 아니라 기억을 얹은 값**이 그리는 자리가 된다 — 여기서 틀리면 아무것도 안 바뀐다", () => {
    const f = flat(graph);
    assert.ok(f.includes("const layeredLayout = useMemo( () => stabilizedAutoLayout?.layout ?? EMPTY_AUTO_LAYOUT_MEMORY,"));
    assert.ok(!f.includes("const layeredLayout = useMemo( () => fresh"), "fresh 를 그대로 쓰면 고치기 전과 똑같다");
  });

  /**
   * 🔴 **기억을 어디에 담는지가 lint 에 걸린다 — 두 번 걸렸다.**
   *  ① ref 로 적었더니 `react-hooks/refs`(「Cannot access/update refs during
   *     render」)가 막았다 → state 로.
   *  ② 효과 본문에서 곧바로 담았더니 `react-hooks/set-state-in-effect` 가 막았다
   *     → 한 틱 미뤄서.
   * 둘 중 어느 쪽으로 되돌아가도 **시험은 통과하는데 lint 가 깨진다.** 그래서
   * 여기서 글자로 못 박는다.
   */
  test("🔴 다음 렌더가 쓸 **기억을 state 로, 한 틱 미뤄** 담는다 — 안 담으면 기억이 영영 비어 있다", () => {
    const f = flat(graph);
    assert.ok(f.includes("const [autoLayoutMemory, setAutoLayoutMemory] = useState<{ templateId: string; positions: ProcedureAutoLayoutMemory }>("));
    assert.ok(f.includes("const timer = setTimeout(() => { setAutoLayoutMemory((prev) =>"));
    assert.ok(f.includes("prev.templateId === templateId && prev.positions === remembered ? prev : { templateId, positions: remembered }"));
    assert.ok(f.includes("return () => clearTimeout(timer);"), "안 치우면 떠난 화면에서 상태를 바꾼다");
    assert.ok(!f.includes("autoLayoutMemoryRef"), "ref 로 되돌아가면 lint 가 깨진다 — 그리는 중에 읽고 쓰는 값은 state 여야 한다");
  });

  test("🔴 **절차가 바뀌면 기억을 버린다** — 같은 자리에서 templateId 만 갈아 끼우는 호출부가 있다", () => {
    const f = flat(graph);
    assert.ok(f.includes("autoLayoutMemory.templateId === templateId ? autoLayoutMemory.positions : EMPTY_AUTO_LAYOUT_MEMORY"));
    // 의존 목록에 templateId·autoLayoutMemory 가 빠지면 절차가 바뀌거나 기억이 쌓여도 memo 가 안 다시 돈다.
    assert.ok(f.includes("[templateId, autoLayoutMemory, useAutoLayoutForUnpositionedNodes, nodeRows, edgeRows, ghostNodes, ghostEdges]"));
  });

  /**
   * 🔴 **렌더가 멈추는 근거**가 신원 둘이다. 빈 기억을 쓰는 자리마다 `new Map()` 을
   * 만들면 effect 의 「안 바뀌었다」가 영영 거짓이 되어 담기–다시 그리기가 끝없이 돈다.
   */
  test("🔴 빈 기억은 **하나만 만들어 돌려 쓴다** — 자리마다 새로 만들면 렌더가 안 멈춘다", () => {
    const f = flat(graph);
    assert.ok(f.includes("const EMPTY_AUTO_LAYOUT_MEMORY: ReadonlyMap<string, { x: number; y: number }> = new Map();"));
    assert.ok(!f.includes("positions: new Map()"), "빈 기억을 그 자리에서 만들면 신원이 매번 바뀐다");
  });

  /**
   * 🔴 세어 놓고 **안 쓰면** 화면은 그대로다. 자리를 고르는 차례(①사람이 정한 자리
   * ②자동 배치 ③받침)는 전과 한 글자도 안 바뀌었고, 그 ②가 이제 기억을 얹은 값이다.
   */
  test("🔴 그 값이 실제로 **그리는 자리**로 간다 — 진짜 노드와 유령 양쪽", () => {
    const f = flat(graph);
    assert.ok(f.includes("if (useAutoLayoutForUnpositionedNodes) return layeredLayout.get(n.id) ?? { x: n.positionX, y: n.positionY + bandOffsetY };"));
    assert.ok(f.includes("if (useAutoLayoutForUnpositionedNodes) return layeredLayout.get(ghost.id) ?? { x: ghost.x, y: ghost.y };"));
    // ①번 자리(사람이 정한 자리)가 여전히 가장 세다 — 끌어다 놓은 자리를 기억이 덮으면 안 된다.
    assert.ok(f.includes("if (hasUserLayoutOverride({ userPositionX: n.userPositionX, userPositionY: n.userPositionY })) {"));
  });
});

describe("자동 배치 기억 — ③ 다른 화면은 안 바뀐다", () => {
  /**
   * 기억은 **그림 안에만** 산다. 쓰는 화면들은 프롭 하나도 안 바뀌었다 —
   * 그 근거가 「바깥에 기억이라는 손잡이가 없다」이다.
   */
  test("🔴 바깥으로 새 프롭이 안 생겼다 — 호출부 다섯이 한 글자도 안 바뀐다", () => {
    const f = flat(graph);
    assert.ok(!f.includes("autoLayoutMemory?:"), "기억을 프롭으로 받으면 호출부마다 다른 값이 들어와 화면이 갈린다");
    assert.ok(detail.includes('useAutoLayoutForUnpositionedNodes={template.category === "TECHNICAL_TASK"}'), "보기 화면의 깃발이 그대로여야 한다");
    assert.ok(editor.includes("useAutoLayoutForUnpositionedNodes={isTechnical}"), "편집기의 깃발이 그대로여야 한다");
  });

  test("🔴 자동 배치가 **꺼진** 절차는 기억을 아예 안 탄다 — 이른 반환이 먼저다", () => {
    const f = flat(graph);
    const memoStart = f.indexOf("const stabilizedAutoLayout = useMemo(() => {");
    assert.ok(memoStart !== -1, "memo 를 못 찾았다 — 아래 차례 비교가 뜻을 잃는다");
    const guard = f.indexOf("if (!useAutoLayoutForUnpositionedNodes) return null;", memoStart);
    const call = f.indexOf("applyProcedureAutoLayoutMemory(fresh, memory)", memoStart);
    assert.ok(guard !== -1 && call !== -1, "둘 다 있어야 차례를 잴 수 있다");
    assert.ok(guard < call, "깃발 판정이 기억보다 뒤면 FULL_SERVICE/REFERENCE 절차도 기억을 탄다");
    // 🔵 꺼진 절차에서 기억을 담는 일도 없어야 한다(effect 가 null 에서 바로 돌아선다).
    assert.ok(f.includes("if (stabilizedAutoLayout === null) return;"));
  });
});
