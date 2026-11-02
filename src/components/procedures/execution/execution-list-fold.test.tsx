import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionFoldSection from "./ExecutionFoldSection";
import {
  buildExecutionHistoryFold,
  buildExecutionListFold,
  type ExecutionFoldGroup,
  type FoldCandidate,
} from "@/lib/domain/procedure-execution-list-fold";
import type { ProcedureCaseExecutionNodeStatus } from "@/lib/domain/procedure-case-execution-types";

/**
 * 아래 목록을 담는 **접히는 묶음**이 실제로 무엇을 그리는가(2026-11-02, 조각 4·8).
 *
 * 이웃 execution-flow-strip.test.tsx 와 같은 방법 — 묶음 자체는 서버 액션도 DB
 * 조회 타입도 안 물게 적었으므로 **렌더해서** 잰다. 반대로
 * ProcedureExecutionScreen 은 서버 컴포넌트에 DB 조회 타입을 끌고 와서 import
 * 가 던지므로, **어디를 접고 어디를 안 접는가**는 원본 글자로 확인한다(🔴 주석은
 * 걷어낸 뒤에 — 이 저장소는 주석에 낱말이 적혀 있다는 이유로 셈이 틀린 적이
 * 있다).
 *
 * 🔴 조각 8 에서 묶음 하나가 **없어졌다**. 「지나온 길」의 카드가 「실행 이력」
 * 안으로 들어갔다(사용자 결정 — 「[실행 이력]에 [지나온 길]의 내용을 넣자」).
 * 그 묶음을 재던 단언은 지우지 않고 **새 자리에서 같은 것을 재도록** 옮겼다.
 */

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

const flat = (source: string) => source.replace(/\s+/g, " ");

function nodesOf(counts: Partial<Record<ProcedureCaseExecutionNodeStatus, number>>): FoldCandidate[] {
  const out: FoldCandidate[] = [];
  for (const [status, count] of Object.entries(counts) as [ProcedureCaseExecutionNodeStatus, number][]) {
    for (let i = 0; i < count; i += 1) out.push({ status });
  }
  return out;
}

/** 실측 66c8ba16(2026-11-02): 대기 16 · 차단됨 1 · 완료 4 · 건너뜀 1 = 22장. */
const MEASURED_RUNNING = nodesOf({ PENDING: 16, BLOCKED: 1, COMPLETED: 4, SKIPPED: 1 });
/** 차단됨이 없는 평범한 실행 — 평소 화면이 이 모양이다. */
const PLAIN_RUNNING = nodesOf({ PENDING: 15, IN_PROGRESS: 1, COMPLETED: 5, SKIPPED: 1 });
/** 실측 dd0389d1: 27장이 전부 완료라 남은 것이 0장. */
const MEASURED_FINISHED = nodesOf({ COMPLETED: 27 });
/** 남은 것은 있는데 전부 차단됨 — 「지금 할 일이 없다」의 **다른** 까닭. */
const ALL_BLOCKED = nodesOf({ BLOCKED: 3, COMPLETED: 2 });

/** 아직 도는 실행에서 접는다. */
const running = (nodes: FoldCandidate[]) => buildExecutionListFold({ nodes, isExecutionFinished: false });
/** 「실행 이력」 묶음 — 이력 줄 수와 노드 배열을 함께 받는다(조각 8). */
const historyGroup = (historyCount: number, nodes: FoldCandidate[]) =>
  buildExecutionHistoryFold({ historyCount, nodes })?.fold ?? null;

/**
 * 묶음을 그린다. 🔴 null 이면 그 자리에서 실패한다 — 「그려져야 하는데 안
 * 그려졌다」가 빈 글자로 조용히 넘어가면 아래 단언이 전부 뜻을 잃는다.
 */
function render(group: ExecutionFoldGroup | null): string {
  if (group === null) assert.fail("묶음이 null 이다 — 이 표본에서는 그려져야 한다");
  return renderToStaticMarkup(
    <ExecutionFoldSection group={group}>
      <p>노드 카드가 서는 자리</p>
    </ExecutionFoldSection>
  );
}

/** <details ...> 여는 태그만 — `group-open:hidden` 같은 클래스 이름에 속지 않는다. */
function detailsTag(html: string): string {
  const match = html.match(/<details[^>]*>/);
  assert.ok(match, "<details> 가 아예 안 그려졌다");
  return match[0];
}

const isOpen = (html: string) => /\sopen(=""|\s|>)/.test(detailsTag(html));

describe("🔵 먼저 — 렌더와 「펼침 재기」가 실제로 돌고 있다", () => {
  const closed = render(running(PLAIN_RUNNING).remaining);
  /**
   * 🔴 **손으로 만든 묶음**이다. 조각 8 부터는 어느 도메인 함수도 open 을 true 로
   * 안 돌려준다(마지막 하나였던 「지나온 길」의 ALL_FINISHED 가 그 묶음과 함께
   * 없어졌다). 그래도 이 표본이 있어야 아래의 「접혀 있다」가 **재는 것이 있는**
   * 단언이 된다 — 렌더러가 open 을 아예 안 보고 있어도 모르면 안 된다.
   */
  const opened = render({ summary: "표본 (1)", count: 1, open: true, openReason: "ALL_FINISHED", note: null });

  test("접힌 것과 펼친 것이 **서로 다르게** 읽힌다", () => {
    assert.ok(closed.includes("<details"), "묶음 자체가 안 그려졌다");
    assert.equal(isOpen(closed), false);
    assert.equal(isOpen(opened), true, "open 판정이 늘 false 면 아래 시험이 전부 공짜로 통과한다");
    assert.ok(opened.includes('data-fold-open-reason="ALL_FINISHED"'), "펼친 까닭도 속성으로 나와야 한다");
  });
});

describe("기본은 접혀 있다", () => {
  const fold = running(PLAIN_RUNNING);

  test("🔴 지금 할 일이 서 있고 차단됨이 없으면 두 묶음 다 접힌 채로 그려진다", () => {
    assert.equal(isOpen(render(fold.remaining)), false);
    assert.equal(isOpen(render(historyGroup(12, PLAIN_RUNNING))), false);
  });

  test("접혀 있어도 제목 줄의 글자는 그대로 보인다", () => {
    const html = render(fold.remaining);
    assert.ok(html.includes("전체 단계 보기 (16)"), "접힌 줄에 머릿수가 안 적혔다");
    assert.ok(html.includes("펼치기"));
    assert.ok(render(historyGroup(12, PLAIN_RUNNING)).includes("실행 이력 (12)"));
  });

  test("안쪽 카드는 접혀도 **지워지지 않는다** — 펼치면 전과 똑같아야 한다", () => {
    assert.ok(render(fold.remaining).includes("노드 카드가 서는 자리"));
  });
});

/**
 * 🔴 2026-11-02 에 **뜻이 뒤집힌 묶음**이다. 전에는 「접으면 안 되는 때」였고
 * 둘(지금 할 일이 없다 · 차단됨이 있다)을 펼쳐진 채로 그렸다. 사용자가 눈으로
 * 보고 「항상 닫혀 있는 상태를 기본으로」라고 정해서 규칙을 걷어냈다.
 *
 * 시험을 지우지 않고 **반대를 재도록** 고친다 — 지우면 규칙이 슬그머니
 * 되살아나도 화면에서 아무 데서도 안 걸린다.
 */
describe("🔴 「전체 단계 보기」는 어떤 경우에도 안 펼쳐진다", () => {
  test("남은 것이 있는데 지금 할 일이 없어도(전부 차단됨) 접힌 채로 그려진다", () => {
    const html = render(running(ALL_BLOCKED).remaining);
    assert.equal(isOpen(html), false);
    assert.ok(!html.includes("data-fold-open-reason"), "펼친 까닭이 남아 있으면 규칙이 되살아난 것이다");
    assert.ok(html.includes("펼치기"), "접힌 줄에는 「펼치기」가 보여야 한다");
  });

  test("🔴 차단됨이 있어도 접혀 있고, 대신 **차단됨 딱지가 제목 줄에** 남는다", () => {
    const html = render(running(MEASURED_RUNNING).remaining);
    assert.equal(isOpen(html), false);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    assert.ok(summary.includes("차단됨 1"), "접어 두었는데 딱지까지 없으면 막힌 것이 화면에서 사라진다");
    assert.ok(summary.includes("amber"));
  });

  test("🔴 「실행 이력」도 접혀 있다 — 남은 것이 하나도 없는 실행에서도 그렇다", () => {
    // 전에는 그 자리에서 「지나온 길」이 펼쳐졌다(ALL_FINISHED). 그 묶음이 「실행
    // 이력」 안으로 들어가면서 펼침도 함께 걷혔다 — 접힌 채가 기본이다(조각 5).
    const html = render(historyGroup(9, MEASURED_FINISHED));
    assert.equal(isOpen(html), false);
    assert.ok(!html.includes("data-fold-open-reason"));
    assert.ok(html.includes("실행 이력 (9)"));
  });
});

describe("🔴 남은 것이 한 장도 없을 때 — 빈 묶음을 펼치지 않는다", () => {
  test("「전체 단계 보기」가 null 이라 화면에 **아무것도 안 그려진다**", () => {
    // 전에는 여기서 「전체 단계 보기 (0)」이 펼쳐져 「…없습니다」 세 줄만 보였다.
    assert.equal(running(MEASURED_FINISHED).remaining, null);
  });

  test("대신 끝난 카드 27장이 「실행 이력」 안에 그대로 남는다", () => {
    const html = render(historyGroup(9, MEASURED_FINISHED));
    assert.ok(html.includes("실행 이력 (9)"));
    assert.ok(html.includes("완료 27"), "접힌 줄에 안 적히면 지나온 것이 저 안에 있다는 사실이 사라진다");
    assert.ok(html.includes("노드 카드가 서는 자리"), "안이 비면 아무 소용이 없다");
  });

  test("🔴 경계 — 노드도 이력도 아예 없으면 묶음 둘 다 null 이다", () => {
    assert.equal(running([]).remaining, null);
    assert.equal(historyGroup(0, []), null);
  });
});

describe("제목 줄의 덧말", () => {
  test("🔴 차단됨 수가 **제목 줄 안에** 뜬다 — 사람이 다시 접어도 안 사라진다", () => {
    const html = render(running(nodesOf({ PENDING: 10, BLOCKED: 2 })).remaining);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    assert.ok(summary.includes("전체 단계 보기 (12)"));
    assert.ok(summary.includes("차단됨 2"), "접힌 줄에 안 적히면 막힌 것이 화면에서 사라진다");
    assert.ok(summary.includes("amber"), "눈에 띄는 색(ATTENTION)이어야 한다 — 흐름 띠의 차단됨 칸과 같은 계열");
  });

  test("건너뛴 수가 제목 줄에 뜬다 — 완료와 뜻이 달라 합쳐 적으면 「다섯 개 했다」로 읽힌다", () => {
    const html = render(historyGroup(12, MEASURED_RUNNING));
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    assert.ok(summary.includes("실행 이력 (12)"));
    assert.ok(summary.includes("완료 4 · 건너뜀 1"));
    assert.ok(!summary.includes("amber"), "지나온 것은 알아 두면 되는 것(MUTED)이라 경고색을 쓰지 않는다");
  });

  test("없는 것은 아예 안 적는다 — 「차단됨 0」은 읽을 가치가 없다", () => {
    const html = render(running(nodesOf({ PENDING: 5, COMPLETED: 2 })).remaining);
    assert.ok(!html.includes("data-fold-note"));
    assert.ok(!html.includes("차단됨"));
  });
});

describe("🔴 자바스크립트 없이 접힌다 — 서버 컴포넌트가 유지된다", () => {
  const foldRaw = readFileSync(new URL("./ExecutionFoldSection.tsx", import.meta.url), "utf8");
  const screenRaw = readFileSync(new URL("./ProcedureExecutionScreen.tsx", import.meta.url), "utf8");
  const clientCardRaw = readFileSync(new URL("./CurrentTaskCard.tsx", import.meta.url), "utf8");
  const foldSource = stripComments(foldRaw);
  const screen = stripComments(screenRaw);

  test("🔵 주석 걷어내기와 「use client」 찾기가 실제로 듣는다", () => {
    assert.ok(foldRaw.includes("🔴") && screenRaw.includes("🔴"));
    assert.ok(!foldSource.includes("🔴") && !screen.includes("🔴"), "주석이 남으면 아래 「없어야 한다」가 주석만 보고 깨진다");
    assert.match(stripComments(clientCardRaw), /^\s*"use client";/, "표본 확인 — 진짜 클라이언트 파일은 이 잣대에 걸린다");
  });

  test('🔴 접기 때문에 "use client" 가 늘지 않았다', () => {
    for (const [name, source] of [
      ["ExecutionFoldSection", foldSource],
      ["ProcedureExecutionScreen", screen],
    ] as const) {
      assert.ok(!/"use client"/.test(source), `${name} 이 클라이언트가 되면 아래 트리가 통째로 따라 내려간다`);
    }
  });

  test("상태도 효과도 안 쓴다 — 네이티브 <details> 하나다", () => {
    assert.match(foldSource, /<details/);
    assert.match(foldSource, /<summary/);
    assert.ok(!/useState|useEffect|onClick/.test(foldSource), "접기를 손으로 만들면 서버 컴포넌트가 깨진다");
  });

  test("열고 닫은 상태를 기억하지 않는다 — 쿠키도 저장소도 안 쓴다", () => {
    assert.ok(!/localStorage|sessionStorage|cookies\(\)/.test(foldSource));
  });

  test("🔴 접을지 말지를 묶음이 **다시 판정하지 않는다** — group 이 정해 온 그대로 쓴다", () => {
    assert.match(flat(foldSource), /open=\{group\.open\}/);
    assert.ok(!/status ===|BLOCKED/.test(foldSource), "상태를 묶음이 다시 세면 판정이 두 벌이 된다");
  });
});

describe("실행 화면이 무엇을 접고 무엇을 안 접는가", () => {
  const screen = stripComments(readFileSync(new URL("./ProcedureExecutionScreen.tsx", import.meta.url), "utf8"));
  const source = flat(screen);
  const remainingAt = source.indexOf("<ExecutionFoldSection group={fold.remaining}>");
  const historyAt = source.indexOf("<ExecutionFoldSection group={historyFold.fold}>");

  test("🔵 먼저 — 두 묶음이 실제로 화면에 적혀 있다", () => {
    assert.ok(remainingAt >= 0 && historyAt >= 0, "둘을 못 찾으면 아래 자리 판정이 전부 뜻을 잃는다");
    assert.ok(remainingAt < historyAt, "「전체 단계 보기」가 「실행 이력」보다 위다");
  });

  test("🔴 판정은 도메인 함수 하나가 한다 — 화면에 if 로 흩어 두지 않았다", () => {
    assert.match(source, /const fold = buildExecutionListFold\(\{ nodes: executionDetail\.nodes, isExecutionFinished \}\);/);
    assert.ok(!/<details/.test(screen), "화면이 직접 접으면 「접는 규칙」이 두 자리에 생긴다");
    assert.ok(!/open=\{/.test(screen), "open 을 화면이 따로 계산하면 같은 판정이 두 벌이 된다");
  });

  test("🔴 「마쳤는가」는 **사실 한 줄**이고, 네 곳이 그 하나를 쓴다", () => {
    // 큰 카드(pickCurrentTask) · 흐름 띠(그 결과) · 아래 목록(buildExecutionListFold) ·
    // 🔵 요약 상자의 자리(placeExecutionSummary — 조각 8).
    // 화면마다 completedAt 을 다시 보면 한 곳만 고치는 날이 온다.
    assert.match(source, /const isExecutionFinished = executionDetail\.completedAt !== null;/);
    assert.match(source, /pickCurrentTask\(executionDetail\.nodes, \{ isExecutionFinished \}\)/);
    assert.match(
      source,
      /placeExecutionSummary\(\{ executionId: executionDetail\.executionId, isExecutionFinished \}\)/
    );
    assert.equal(
      (source.match(/executionDetail\.completedAt !== null/g) ?? []).length,
      1,
      "「마쳤는가」를 화면에서 두 번 이상 판정하면 넷이 따로 논다"
    );
  });

  test("🔴 「안 그린다」도 도메인이 정한다 — 화면은 null 을 따를 뿐 머릿수를 다시 세지 않는다", () => {
    assert.match(source, /\{fold\.remaining && \( <ExecutionFoldSection group=\{fold\.remaining\}>/);
    assert.match(source, /\{historyFold && \( <ExecutionFoldSection group=\{historyFold\.fold\}>/);
    assert.match(source, /\{historyFold\.showsTrail && \( <NodeSection title="완료 \/ 건너뜀"/);
    assert.ok(
      !/fold\.(remaining|count)\.count/.test(screen) &&
        !/doneNodes\.length/.test(screen) &&
        !/count > 0/.test(screen) &&
        !/count === 0/.test(screen),
      "화면이 머릿수로 다시 판정하면 「빈 묶음은 안 그린다」가 두 벌이 된다"
    );
  });

  test("🔴 괄호 안 수가 화면 구역과 **같은 배열**에서 나온다", () => {
    assert.match(source, /nodes: executionDetail\.nodes/);
    assert.ok(
      !/buildExecutionListFold\(\{ nodes: (pendingNodes|doneNodes|blockedNodes)/.test(source),
      "걸러낸 배열을 넘기면 접힌 줄의 수가 실제 줄 수와 어긋난다"
    );
    assert.match(
      source,
      /buildExecutionHistoryFold\(\{ historyCount: history\.length, nodes: executionDetail\.nodes \}\)/,
      "덧말의 완료·건너뜀도 화면 구역과 같은 배열에서 나와야 한다"
    );
  });

  test("아직 안 끝난 세 구역이 「전체 단계 보기」 안에 있다", () => {
    const inside = source.slice(remainingAt, source.indexOf("</ExecutionFoldSection>", remainingAt));
    for (const title of ["실행 가능", "진행 중", "차단됨"]) {
      assert.ok(inside.includes(`title="${title}"`), `${title} 구역이 「전체 단계 보기」 밖에 있다`);
    }
    assert.ok(!inside.includes('title="완료 / 건너뜀"'), "끝난 것이 「전체 단계 보기」에 섞이면 머릿수가 어긋난다");
  });

  test("🔴 끝난 구역과 시각 기록이 **한 묶음 안**에 있다 — 「지나온 길」 묶음은 없다", () => {
    const inside = source.slice(historyAt, source.indexOf("</ExecutionFoldSection>", historyAt));
    assert.ok(inside.includes('title="완료 / 건너뜀"'), "지나온 카드가 「실행 이력」 밖에 있다");
    assert.ok(inside.includes("<ExecutionHistoryTimeline history={history}"), "시각 기록이 같은 묶음 안에 없다");
    assert.ok(inside.includes("시각 기록 ({history.length})"), "한 묶음에 둘이 쌓이면 어디부터가 기록인지 적어야 한다");
    assert.ok(!inside.includes('title="실행 가능"'));
    // 🔴 묶음이 둘로 되돌아가면 여기서 걸린다.
    assert.ok(!source.includes("group={fold.done}"), "「지나온 길」 묶음이 되살아났다");
    assert.equal((source.match(/<ExecutionHistoryTimeline/g) ?? []).length, 1, "이력이 두 자리에 그려지면 안 된다");
  });

  test("🔴 「지금 할 일」 큰 카드와 흐름 띠는 **접지 않는다** — 설 때는 늘 보인다", () => {
    for (const tag of ["<ExecutionFlowStrip", "<CurrentTaskCard", "<NoCurrentTaskCard", "<ProgressSummary"]) {
      const at = source.indexOf(tag);
      assert.ok(at >= 0, `${tag} 이 화면에서 사라졌다`);
      assert.ok(at < remainingAt, `${tag} 이 접히는 묶음 아래로 내려갔다`);
    }
  });

  test("🔴 실행 이력도 **같은 그릇**으로 접는다 — 접히는 모양이 둘 생기지 않았다", () => {
    assert.match(
      source,
      /const historyFold = buildExecutionHistoryFold\(\{ historyCount: history\.length, nodes: executionDetail\.nodes \}\);/
    );
    // 전에는 테두리 상자 + <h2>실행 이력</h2> 이었다. 그 모양이 남아 있으면
    // 접히는 줄과 안 접히는 상자가 한 화면에 섞인다.
    assert.ok(!/<h2[^>]*>실행 이력<\/h2>/.test(screen), "옛 제목 상자가 남아 있다");
  });

  test("네 구역은 그대로다 — 이번 조각도 담는 그릇만 바꾼다", () => {
    const sections = source.match(/<NodeSection[\s\S]*?\/>/g) ?? [];
    assert.equal(sections.length, 4, "실행 가능·진행 중·차단됨·완료/건너뜀 넷이어야 한다");
    for (const section of sections) {
      assert.match(section, /currentTaskNodeId=\{currentTaskNodeId\}/);
    }
    assert.match(source, /<ExecutionNodeCard key=\{node\.id\}/, "작은 카드는 계속 쓴다");
  });
});
