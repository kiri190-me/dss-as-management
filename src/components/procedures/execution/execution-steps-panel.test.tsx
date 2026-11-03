import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionStepsPanel from "./ExecutionStepsPanel";
import {
  findJumpTarget,
  resolveJumpButtonState,
  searchJumpTargets,
  type JumpCandidateNode,
} from "@/lib/domain/procedure-execution-jump";
import type { ProcedureCaseExecutionNodeStatus } from "@/lib/domain/procedure-case-execution-types";

/**
 * 「전체 단계 보기」 창의 **속**이 실제로 무엇을 그리는가(2026-11-02, 조각 10).
 *
 * 이웃 procedure-start-picker-panel.test.tsx 와 같은 방법 — 이 묶음은 상태도
 * 서버 액션도 DB 조회 타입도 안 물게 적었으므로 **그려서** 잰다. 플로우차트는
 * @xyflow/react 의 .css 를 끌고 와서 여기서 import 가 던지므로 `graphSlot` 으로
 * 바깥에서 받고, 이 시험은 그 자리에 가짜를 넣는다.
 *
 * 🔴 창을 여닫고 서버를 부르는 쪽(ExecutionStepsDialog)은 서버 액션을 직접
 * import 하는 클라이언트 부품이라 여기서 못 부른다 — 그쪽의 불변식은 원본
 * 글자로 확인한다(아래 마지막 묶음).
 */

function node(
  n: number,
  status: ProcedureCaseExecutionNodeStatus,
  extra: Partial<JumpCandidateNode> = {}
): JumpCandidateNode {
  return { id: `e${n}`, graphNodeId: `t${n}`, orderIndex: n, title: `작업 ${n}`, status, version: 1, ...extra };
}

/** 실측을 닮은 한 실행 — 끝난 것 · 도는 것 · 남은 것 · 막힌 것이 다 있다. */
const NODES = [
  node(1, "COMPLETED", { title: "MCU 기판 교환" }),
  node(2, "IN_PROGRESS", { title: "조정 작업 실시" }),
  node(3, "PENDING", { title: "MCU 신호 점검" }),
  node(4, "BLOCKED", { title: "일본 교산에 연락" }),
  node(5, "SKIPPED", { title: "외관 점검" }),
];

const GRAPH_SLOT = <div data-fake-graph>플로우차트가 서는 자리</div>;

function render(options: {
  query?: string;
  chosenId?: string | null;
  isAlreadyCurrent?: boolean;
  isExecutionFinished?: boolean;
  eligible?: boolean;
  errorMessage?: string | null;
} = {}): string {
  const query = options.query ?? "";
  const chosen = findJumpTarget(NODES, options.chosenId ?? null);
  const button = resolveJumpButtonState({
    chosen,
    isAlreadyCurrent: options.isAlreadyCurrent ?? false,
    isSubmitting: false,
    isExecutionFinished: options.isExecutionFinished ?? false,
    eligible: options.eligible ?? true,
  });
  return renderToStaticMarkup(
    <ExecutionStepsPanel
      query={query}
      onQueryChange={() => {}}
      search={searchJumpTargets(NODES, query)}
      onHitSelect={() => {}}
      chosen={chosen}
      onClearChoice={() => {}}
      button={button}
      onJump={() => {}}
      onCancel={() => {}}
      errorMessage={options.errorMessage ?? null}
      graphSlot={GRAPH_SLOT}
    />
  );
}

/** 딱지로 그려진 상태 글자를 모은다 — 「상태가 보이는가」를 이것으로 센다. */
function statusChips(html: string): string[] {
  return [...html.matchAll(/data-jump-status-chip[^>]*>([^<]*)</g)].map((m) => m[1]);
}

/**
 * [여기로 옮기기] 단추가 흐려져 있는가.
 *
 * 🔴 `disabled` 를 **글자로 찾으면 안 된다** — class 에 `disabled:opacity-50` 이
 * 늘 붙어 있어서 언제나 걸린다. **속성**으로만 센다.
 *
 * 🔵 2026-11-03(조각 12)에 묶음 밖으로 꺼냈다 — 「완료를 고를 수 있는가」를 재는
 * 자리가 둘이 됐기 때문이다. 글자(「이미 끝난 작업입니다」)가 없다는 것만으로는
 * 모자란다: 막는 글이 다른 말로 바뀌어도 그 단언은 그대로 통과한다.
 */
const jumpButtonTag = (html: string) => {
  const at = html.lastIndexOf("여기로 옮기기");
  return html.slice(html.lastIndexOf("<button", at), at);
};
const isJumpDisabled = (html: string) => /\sdisabled(=""|\s|>)/.test(jumpButtonTag(html));

describe("🔵 먼저 — 렌더가 실제로 돌고 있다", () => {
  test("창의 속과 그림 자리가 그려진다", () => {
    const html = render();
    assert.ok(html.includes("data-fake-graph"), "그림 자리를 안 그리면 아래 판정이 전부 뜻을 잃는다");
    assert.ok(html.includes("여기로 옮기기"), "단추가 없다");
    assert.ok(statusChips(html).length > 0, "딱지가 하나도 없으면 「상태가 보인다」가 공짜로 통과한다");
  });
});

describe("🔴 노드 상태가 보인다", () => {
  test("상태 다섯이 **범례에 전부** 뜬다 — 그림의 딱지를 읽는 자다", () => {
    const chips = statusChips(render());
    for (const label of ["대기", "진행 중", "완료", "건너뜀", "차단됨"]) {
      assert.ok(chips.includes(label), `${label} 이 범례에 없다`);
    }
  });

  test("검색 결과 줄마다 **그 줄의 상태**가 붙는다", () => {
    const html = render({ query: "MCU" });
    const listAt = html.indexOf("<ul");
    const list = html.slice(listAt, html.indexOf("</ul>", listAt));
    assert.ok(list.includes("MCU 기판 교환") && list.includes("MCU 신호 점검"), "표본 확인 — 두 줄이 걸렸다");
    const chips = statusChips(list);
    assert.deepEqual(chips, ["완료", "대기"], "줄 차례대로 그 줄의 상태가 붙어야 한다");
  });

  test("세기가 색으로도 갈린다 — 막힌 것과 끝난 것이 같은 색이면 안 된다", () => {
    const html = render();
    const tones = new Set([...html.matchAll(/data-jump-status-tone="([A-Z]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...tones].sort(), ["AHEAD", "BLOCKED", "CURRENT", "DONE"]);
    assert.ok(html.includes("amber"), "차단됨은 눈에 띄는 색이어야 한다 — 흐름 띠의 차단됨 칸과 같은 계열");
  });
});

describe("검색 줄", () => {
  test("맞는 수를 적고, 하나도 없으면 그렇게 말한다", () => {
    assert.ok(render({ query: "MCU" }).includes("맞는 작업 2개"));
    assert.ok(render({ query: "없는이름" }).includes("일치하는 작업이 없습니다"));
  });

  test("검색어가 비면 결과 목록 자체를 안 그린다 — 빈 네모를 세우지 않는다", () => {
    const html = render();
    assert.ok(!html.includes("<ul"), "빈 목록 상자가 자리를 먹는다");
    assert.ok(!html.includes("맞는 작업"));
  });

  test("🔵 **못 옮기는 줄도 누를 수 있다** — 어디에 있는지 확인할 길까지 막지 않는다", () => {
    const html = render({ query: "일본" });
    const listAt = html.indexOf("<ul");
    const list = html.slice(listAt, html.indexOf("</ul>", listAt));
    assert.ok(list.includes("일본 교산에 연락"), "표본 확인 — 차단된 줄이 걸렸다");
    assert.ok(!list.includes("disabled"), "막는 것은 단추이지 결과 줄이 아니다");
  });
});

describe("🔴 못 누를 때는 까닭이 **글자로** 적힌다", () => {
  test("고른 것이 없으면 무엇을 하라고 적는다", () => {
    const html = render();
    assert.ok(html.includes("고른 것 없음"), "고른 것이 없다는 말이 없다");
    assert.ok(html.includes("그림에서 작업을 누르거나"), "다음에 할 일을 안 적으면 「왜 안 눌리지」가 된다");
  });

  /**
   * 🔴 2026-11-03(조각 12)에 **완료가 열렸다**(사용자 결정 — 「[전체 단계
   * 보기]에서는 [완료]로 되어 있어도 선택할 수 있도록 해줘」). 그래서 이 자리의
   * 단언이 **뒤집혔다**: 완료를 고르면 까닭이 뜨는 것이 아니라 단추가 눌려야 한다.
   * 지우지 않고 반대를 재도록 고친다 — 지우면 완료가 슬그머니 다시 막혀도 아무
   * 데서도 안 걸린다. 건너뜀 쪽은 바로 아래에서 그대로 막혀 있는지를 잰다.
   */
  test("🔴 완료된 줄은 **고를 수 있다** — 단추가 눌리고 막던 글이 안 뜬다", () => {
    const html = render({ chosenId: "e1" });
    assert.ok(html.includes("MCU 기판 교환"), "고른 것이 줄에 적혀야 한다");
    assert.ok(!html.includes("이미 끝난 작업입니다"), "완료를 막던 옛 글자가 남아 있다");
    assert.equal(isJumpDisabled(html), false, "완료를 고르면 단추가 눌려야 한다");
  });

  test("건너뛴 줄을 고르면 **사유**와 [재개(되돌림)]를 가리킨다", () => {
    const html = render({ chosenId: "e5" });
    assert.ok(html.includes("외관 점검"), "고른 것이 줄에 적혀야 한다");
    assert.ok(html.includes("건너뛴 작업입니다"));
    assert.ok(html.includes("재개(되돌림)"));
  });

  test("차단된 줄을 고르면 **사유**를 적어 풀라고 말한다", () => {
    assert.ok(render({ chosenId: "e4" }).includes("차단된 작업입니다"));
  });

  test("이미 지금 할 일이면 그렇게 말한다 — 눌러도 아무 일이 없는 단추를 안 만든다", () => {
    assert.ok(render({ chosenId: "e2", isAlreadyCurrent: true }).includes("이미 「지금 할 일」로 서 있는 작업입니다"));
  });

  test("마친 실행에서는 [절차 다시 잇기]를 가리킨다", () => {
    assert.ok(render({ chosenId: "e3", isExecutionFinished: true }).includes("절차 다시 잇기"));
  });

  test("못 옮기는 사람에게는 누구만 할 수 있는지 적는다", () => {
    assert.ok(render({ chosenId: "e3", eligible: false }).includes("담당 엔지니어 또는 관리자만"));
  });

  test("🔵 반대로 — 옮길 수 있으면 단추가 **안 흐려지고** 까닭도 안 적힌다", () => {
    assert.equal(isJumpDisabled(render({ chosenId: "e4" })), true, "표본 확인 — 막힌 줄에서는 흐려진다");
    assert.equal(isJumpDisabled(render({ chosenId: "e3" })), false, "눌려야 하는데 흐려져 있으면 위 단언이 전부 공짜로 통과한다");
    assert.ok(render({ chosenId: "e3" }).includes("MCU 신호 점검"), "고른 것이 줄에 적혀야 한다");
    // 🔴 조각 12 에서 열린 자리 — **완료도 눌려야** 한다(사용자 결정).
    assert.equal(isJumpDisabled(render({ chosenId: "e1" })), false, "완료가 막히면 되돌아갈 길이 「딴 노드를 골라 그 바람에」뿐이 된다");
    // 🔴 그리고 **건너뜀은 여전히 흐려져야** 한다 — 사유를 적어 정한 것이다.
    assert.equal(isJumpDisabled(render({ chosenId: "e5" })), true, "건너뜀이 열리면 사람의 판단이 사유 없이 뒤집힌다");
  });
});

describe("서버가 거절하면 그 말을 그대로 보인다", () => {
  test("오류 글이 창 안에 뜬다", () => {
    assert.ok(render({ errorMessage: "다른 사용자가 이 작업을 먼저 변경했습니다." }).includes("다른 사용자가"));
  });
});

describe("🔴 창을 여닫는 쪽의 불변식 — 원본 글자로", () => {
  const stripComments = (source: string) =>
    source
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
  const raw = readFileSync(new URL("./ExecutionStepsDialog.tsx", import.meta.url), "utf8");
  const dialog = stripComments(raw);
  const flat = dialog.replace(/\s+/g, " ");

  test("🔵 주석 걷어내기가 실제로 돌고 있다", () => {
    assert.ok(raw.includes("🔴"));
    assert.ok(!dialog.includes("🔴"), "주석이 남으면 아래 「없어야 한다」가 주석만 보고 깨진다");
  });

  test("🔴 판정을 창이 다시 하지 않는다 — 도메인 함수가 정해 온 그대로 쓴다", () => {
    assert.match(flat, /const button = resolveJumpButtonState\(\{/);
    assert.match(flat, /const search = useMemo\(\(\) => searchJumpTargets\(nodes, query\)/);
    assert.ok(
      !/status === "COMPLETED"|status === "BLOCKED"|completedAt/.test(dialog),
      "창이 상태를 다시 가르면 서버·시험과 말이 갈린다"
    );
  });

  test("🔴 옮길 때 **그 줄의 version** 을 싣는다 — 한 벌을 돌려 쓰면 남의 줄을 건드린다", () => {
    assert.match(flat, /expectedVersion: chosen\.node\.version/);
    assert.match(flat, /executionId, executionNodeId: chosen\.node\.id/);
  });

  test("🔴 창을 열면 **지금 할 일**이 골라진 채로 뜬다 — 「내가 어디에 있나」가 이 창을 여는 까닭이다", () => {
    assert.match(flat, /setChosenNodeId\(currentTaskNodeId\);/);
  });

  test("끝나면 창을 닫고 새로고침한다 — 저장 팝업은 안 띄운다(모달에 가린다)", () => {
    assert.match(flat, /setIsOpen\(false\); router\.refresh\(\);/);
    assert.ok(!/showSavePopup/.test(dialog), "모달 창 위의 저장 팝업은 창 뒤로 가려진다");
  });

  test("🔴 보내는 동안 창이 안 닫힌다 — 두 번 누르기와 중간에 닫기를 둘 다 막는다", () => {
    assert.match(flat, /if \(isSubmitting\) return;/);
    assert.match(flat, /if \(chosen === null \|\| isSubmitting\) return;/);
  });
});

/**
 * 🔴 **그림에 상태가 붙는 사슬** — 원본 글자로.
 *
 * 그림(ProcedureFlowGraph)은 @xyflow/react 의 .css 를 끌고 와서 여기서 import 가
 * 던진다. 그래서 「딱지가 실제로 그려지는가」는 못 그려 보고, **그 사슬이 끊기지
 * 않았는지**를 글자로 못 박는다: 창 → 감싸개 → 그림 → 칸.
 */
describe("🔴 절차 그림에 노드 상태가 붙는다 — 사슬을 글자로", () => {
  const stripComments = (source: string) =>
    source
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
  const flatten = (source: string) => stripComments(source).replace(/\s+/g, " ");

  const dialog = flatten(readFileSync(new URL("./ExecutionStepsDialog.tsx", import.meta.url), "utf8"));
  const wrapperRaw = readFileSync(new URL("./ExecutionStepsGraph.tsx", import.meta.url), "utf8");
  const wrapper = flatten(wrapperRaw);
  const graph = flatten(readFileSync(new URL("../ProcedureFlowGraph.tsx", import.meta.url), "utf8"));

  test("🔵 주석 걷어내기가 실제로 돌고 있다", () => {
    assert.ok(wrapperRaw.includes("🔴") && !wrapper.includes("🔴"));
  });

  test("① 창이 **실행 줄의 상태**로 지도를 만들어 그림에 넘긴다", () => {
    assert.match(dialog, /const nodeMarks = useMemo\(\(\) => buildJumpStatusMarks\(nodes\), \[nodes\]\);/);
    assert.match(dialog, /nodeMarks=\{nodeMarks\}/);
  });

  test("② 감싸개가 실행 상태의 세기를 **그림이 아는 세기**로 옮긴다", () => {
    // 🔴 그림은 「진행 중」이라는 낱말을 몰라야 한다 — 같은 자리에 다른 뜻의
    //    딱지를 붙이는 날이 온다.
    assert.match(wrapper, /mark\.tone === "CURRENT" \? "STRONG"/);
    assert.match(wrapper, /mark\.tone === "DONE" \? "MUTED"/);
    assert.match(wrapper, /mark\.tone === "BLOCKED" \? "WARN"/);
    assert.match(wrapper, /nodeMarks=\{graphMarks\}/);
    assert.ok(!/IN_PROGRESS|COMPLETED|SKIPPED/.test(wrapper), "실행 상태 글자가 그림 쪽으로 새어 나갔다");
  });

  test("③ 그림이 칸마다 그 딱지를 **그린다** — 세기마다 색이 다르다", () => {
    assert.match(graph, /mark: nodeMarks\?\.get\(n\.id\) \?\? null,/);
    assert.match(graph, /data-node-mark/);
    assert.match(graph, /\{data\.mark\.label\}/);
    assert.match(graph, /NODE_MARK_CLASS\[data\.mark\.tone\]/);
    for (const tone of ["STRONG", "PLAIN", "MUTED", "WARN"]) {
      assert.ok(graph.includes(`${tone}:`), `${tone} 색이 없다 — 세기가 뭉치면 상태를 못 가린다`);
    }
    assert.ok(graph.includes("amber"), "막힌 칸은 눈에 띄는 색이어야 한다");
  });

  test("🔴 딱지도 함께 흐려진다 — 혼자 또렷하면 흐리기가 뜻을 잃는다", () => {
    const markLayerAt = graph.indexOf("data-node-mark");
    const layer = graph.slice(markLayerAt, graph.indexOf("</span>", markLayerAt));
    assert.ok(layer.includes("data.isDimmed"), "검색으로 흐려진 칸에서 딱지만 또렷하게 남는다");
  });

  test("🔵 기본값이 **지금까지의 동작**이다 — 안 넘기면 아무 칸에도 안 붙는다", () => {
    assert.match(graph, /nodeMarks = null,/);
    assert.match(graph, /nodeMarks\?: ReadonlyMap<string, ProcedureFlowGraphNodeMark> \| null;/);
  });

  /**
   * 🔴 창의 **설명 한 줄이 하는 일과 맞아야** 한다(2026-11-02, 조각 11).
   *
   * 전에는 「앞의 작업들은 건너뛴 것이 아니라 **대기로 남습니다**」라고 적혀
   * 있었다. 조각 11 부터는 경로 위가 완료가 되고 경로 밖의 완료는 대기로
   * 돌아가면서 **그 작업의 메모가 지워진다** — 옛 글자를 그대로 두면 화면이
   * 반대로 적힌 설명을 달고 있게 되고, 누르는 사람은 메모가 지워질 줄 모른다.
   */
  test("🔴 창의 설명이 **지금 하는 일**을 적는다 — 옛 글자가 남아 있지 않다", () => {
    assert.ok(!dialog.includes("대기로 남습니다"), "하는 일이 바뀌었는데 설명이 옛말 그대로다");
    assert.match(dialog, /최단 경로 위의 앞 작업들이 완료로 바뀝니다/);
    assert.match(dialog, /다시 대기가 되고 그 작업의 메모는 지워집니다/);
    assert.match(dialog, /실행 이력/, "지워진 메모를 어디서 볼 수 있는지 안 적으면 사라진 것으로 읽힌다");
    // 🔴 2026-11-03(조각 12): **완료도 고를 수 있다**는 것과, 그 줄도 비워진다는
    //    것을 적는다. 안 적으면 누르는 사람은 완료 기록이 지워질 줄 모른다.
    assert.match(dialog, /이미 완료한 작업도 고를 수 있습니다/);
    assert.match(dialog, /그 둘로는 옮길 수 없습니다/, "건너뜀·차단됨이 여전히 막혀 있다는 말이 없다");
  });
});
