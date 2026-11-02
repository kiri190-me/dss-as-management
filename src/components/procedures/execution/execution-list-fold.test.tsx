import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionFoldSection from "./ExecutionFoldSection";
import {
  buildExecutionListFold,
  type ExecutionFoldGroup,
  type FoldCandidate,
} from "@/lib/domain/procedure-execution-list-fold";
import type { ProcedureCaseExecutionNodeStatus } from "@/lib/domain/procedure-case-execution-types";

/**
 * 아래 목록을 담는 **접히는 묶음**이 실제로 무엇을 그리는가(2026-11-02, 조각 4).
 *
 * 이웃 execution-flow-strip.test.tsx 와 같은 방법 — 묶음 자체는 서버 액션도 DB
 * 조회 타입도 안 물게 적었으므로 **렌더해서** 잰다. 반대로
 * ProcedureExecutionScreen 은 서버 컴포넌트에 DB 조회 타입을 끌고 와서 import
 * 가 던지므로, **어디를 접고 어디를 안 접는가**는 원본 글자로 확인한다(🔴 주석은
 * 걷어낸 뒤에 — 이 저장소는 주석에 낱말이 적혀 있다는 이유로 셈이 틀린 적이
 * 있다).
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
  const closed = render(buildExecutionListFold({ nodes: PLAIN_RUNNING, hasCurrentTask: true }).remaining);
  const opened = render(buildExecutionListFold({ nodes: PLAIN_RUNNING, hasCurrentTask: false }).remaining);

  test("접힌 것과 펼친 것이 **서로 다르게** 읽힌다", () => {
    assert.ok(closed.includes("<details"), "묶음 자체가 안 그려졌다");
    assert.equal(isOpen(closed), false);
    assert.equal(isOpen(opened), true, "open 판정이 늘 false 면 아래 시험이 전부 공짜로 통과한다");
  });
});

describe("기본은 접혀 있다", () => {
  const fold = buildExecutionListFold({ nodes: PLAIN_RUNNING, hasCurrentTask: true });

  test("🔴 지금 할 일이 서 있고 차단됨이 없으면 두 묶음 다 접힌 채로 그려진다", () => {
    assert.equal(isOpen(render(fold.remaining)), false);
    assert.equal(isOpen(render(fold.done)), false);
  });

  test("접혀 있어도 제목 줄의 글자는 그대로 보인다", () => {
    const html = render(fold.remaining);
    assert.ok(html.includes("전체 단계 보기 (16)"), "접힌 줄에 머릿수가 안 적혔다");
    assert.ok(html.includes("펼치기"));
    assert.ok(render(fold.done).includes("지나온 길 (6)"));
  });

  test("안쪽 카드는 접혀도 **지워지지 않는다** — 펼치면 전과 똑같아야 한다", () => {
    assert.ok(render(fold.remaining).includes("노드 카드가 서는 자리"));
  });
});

describe("🔴 접으면 안 되는 때", () => {
  test("남은 것이 있는데 지금 할 일이 없으면(전부 차단됨) 「전체 단계 보기」가 펼쳐진 채로 선다", () => {
    const fold = buildExecutionListFold({ nodes: ALL_BLOCKED, hasCurrentTask: false });
    const html = render(fold.remaining);
    assert.equal(isOpen(html), true);
    assert.ok(html.includes('data-fold-open-reason="NO_CURRENT_TASK"'), "까닭이 화면에 안 남으면 왜 펼쳤는지 못 되읽는다");
    assert.ok(html.includes("접기"));
  });

  test("차단됨이 있으면 펼쳐지고, 까닭이 HAS_BLOCKED 로 남는다", () => {
    const html = render(buildExecutionListFold({ nodes: MEASURED_RUNNING, hasCurrentTask: true }).remaining);
    assert.equal(isOpen(html), true);
    assert.ok(html.includes('data-fold-open-reason="HAS_BLOCKED"'));
  });

  test("남은 것이 있으면 「지나온 길」은 그 둘에도 안 펼쳐진다", () => {
    assert.equal(isOpen(render(buildExecutionListFold({ nodes: MEASURED_RUNNING, hasCurrentTask: false }).done)), false);
  });
});

describe("🔴 남은 것이 한 장도 없을 때 — 빈 묶음을 펼치지 않는다", () => {
  const fold = buildExecutionListFold({ nodes: MEASURED_FINISHED, hasCurrentTask: false });

  test("「전체 단계 보기」가 null 이라 화면에 **아무것도 안 그려진다**", () => {
    // 전에는 여기서 「전체 단계 보기 (0)」이 펼쳐져 「…없습니다」 세 줄만 보였다.
    assert.equal(fold.remaining, null);
  });

  test("대신 「지나온 길」이 펼쳐진 채로 그려진다", () => {
    const html = render(fold.done);
    assert.equal(isOpen(html), true);
    assert.ok(html.includes('data-fold-open-reason="ALL_FINISHED"'));
    assert.ok(html.includes("지나온 길 (27)"));
    assert.ok(html.includes("노드 카드가 서는 자리"), "펼쳐 놓고 안이 비면 아무 소용이 없다");
  });

  test("🔴 경계 — 노드가 아예 0장이면 묶음 둘 다 null 이다", () => {
    const empty = buildExecutionListFold({ nodes: [], hasCurrentTask: false });
    assert.equal(empty.remaining, null);
    assert.equal(empty.done, null);
  });
});

describe("제목 줄의 덧말", () => {
  test("🔴 차단됨 수가 **제목 줄 안에** 뜬다 — 사람이 다시 접어도 안 사라진다", () => {
    const html = render(buildExecutionListFold({ nodes: nodesOf({ PENDING: 10, BLOCKED: 2 }), hasCurrentTask: true }).remaining);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    assert.ok(summary.includes("전체 단계 보기 (12)"));
    assert.ok(summary.includes("차단됨 2"), "접힌 줄에 안 적히면 막힌 것이 화면에서 사라진다");
    assert.ok(summary.includes("amber"), "눈에 띄는 색(ATTENTION)이어야 한다 — 흐름 띠의 차단됨 칸과 같은 계열");
  });

  test("건너뛴 수가 제목 줄에 뜬다 — 완료와 뜻이 달라 합쳐 적으면 「여섯 개 했다」로 읽힌다", () => {
    const html = render(buildExecutionListFold({ nodes: MEASURED_RUNNING, hasCurrentTask: true }).done);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    assert.ok(summary.includes("지나온 길 (5)"));
    assert.ok(summary.includes("건너뜀 1"));
    assert.ok(!summary.includes("amber"), "건너뜀은 알아 두면 되는 것(MUTED)이라 경고색을 쓰지 않는다");
  });

  test("없는 것은 아예 안 적는다 — 「차단됨 0」은 읽을 가치가 없다", () => {
    const html = render(buildExecutionListFold({ nodes: nodesOf({ PENDING: 5, COMPLETED: 2 }), hasCurrentTask: true }).remaining);
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
  const doneAt = source.indexOf("<ExecutionFoldSection group={fold.done}>");

  test("🔵 먼저 — 두 묶음이 실제로 화면에 적혀 있다", () => {
    assert.ok(remainingAt >= 0 && doneAt >= 0, "둘을 못 찾으면 아래 자리 판정이 전부 뜻을 잃는다");
    assert.ok(remainingAt < doneAt, "「전체 단계 보기」가 「지나온 길」보다 위다");
  });

  test("🔴 판정은 도메인 함수 하나가 한다 — 화면에 if 로 흩어 두지 않았다", () => {
    assert.match(source, /const fold = buildExecutionListFold\(\{ nodes: executionDetail\.nodes, hasCurrentTask: currentTask\.kind !== "NONE", \}\);/);
    assert.ok(!/<details/.test(screen), "화면이 직접 접으면 「펼친 채로 둘 때」가 두 자리에 생긴다");
    assert.ok(!/open=\{/.test(screen), "open 을 화면이 따로 계산하면 같은 판정이 두 벌이 된다");
  });

  test("🔴 「안 그린다」도 도메인이 정한다 — 화면은 null 을 따를 뿐 머릿수를 다시 세지 않는다", () => {
    assert.match(source, /\{fold\.remaining && \( <ExecutionFoldSection group=\{fold\.remaining\}>/);
    assert.match(source, /\{fold\.done && \( <ExecutionFoldSection group=\{fold\.done\}>/);
    assert.ok(
      !/fold\.(remaining|done)\.count/.test(screen) && !/count > 0/.test(screen) && !/count === 0/.test(screen),
      "화면이 머릿수로 다시 판정하면 「빈 묶음은 안 그린다」가 두 벌이 된다"
    );
  });

  test("🔴 괄호 안 수가 화면 구역과 **같은 배열**에서 나온다", () => {
    assert.match(source, /nodes: executionDetail\.nodes/);
    assert.ok(
      !/buildExecutionListFold\(\{ nodes: (pendingNodes|doneNodes|blockedNodes)/.test(source),
      "걸러낸 배열을 넘기면 접힌 줄의 수가 실제 줄 수와 어긋난다"
    );
  });

  test("아직 안 끝난 세 구역이 「전체 단계 보기」 안에 있다", () => {
    const inside = source.slice(remainingAt, source.indexOf("</ExecutionFoldSection>", remainingAt));
    for (const title of ["실행 가능", "진행 중", "차단됨"]) {
      assert.ok(inside.includes(`title="${title}"`), `${title} 구역이 「전체 단계 보기」 밖에 있다`);
    }
    assert.ok(!inside.includes('title="완료 / 건너뜀"'), "끝난 것이 「전체 단계 보기」에 섞이면 머릿수가 어긋난다");
  });

  test("끝난 구역이 「지나온 길」 안에 있다", () => {
    const inside = source.slice(doneAt, source.indexOf("</ExecutionFoldSection>", doneAt));
    assert.ok(inside.includes('title="완료 / 건너뜀"'));
    assert.ok(!inside.includes('title="실행 가능"'));
  });

  test("🔴 「지금 할 일」 큰 카드와 흐름 띠는 **접지 않는다** — 늘 보인다", () => {
    for (const tag of ["<ExecutionFlowStrip", "<CurrentTaskCard", "<NoCurrentTaskCard", "<ProgressSummary"]) {
      const at = source.indexOf(tag);
      assert.ok(at >= 0, `${tag} 이 화면에서 사라졌다`);
      assert.ok(at < remainingAt, `${tag} 이 접히는 묶음 아래로 내려갔다`);
    }
  });

  test("네 구역은 그대로다 — 이번 조각은 담는 그릇만 바꾼다", () => {
    const sections = source.match(/<NodeSection[\s\S]*?\/>/g) ?? [];
    assert.equal(sections.length, 4, "실행 가능·진행 중·차단됨·완료/건너뜀 넷이어야 한다");
    for (const section of sections) {
      assert.match(section, /currentTaskNodeId=\{currentTaskNodeId\}/);
    }
    assert.match(source, /<ExecutionNodeCard key=\{node\.id\}/, "작은 카드는 계속 쓴다");
  });
});
