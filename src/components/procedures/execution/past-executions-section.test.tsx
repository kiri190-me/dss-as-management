import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import PastExecutionsSection from "./PastExecutionsSection";
import type { PastExecutionCandidate } from "@/lib/domain/procedure-execution-past-runs";
import type { ProcedureCaseExecutionNodeStatus } from "@/lib/domain/procedure-case-execution-types";

/**
 * 「이 건의 다른 절차」 묶음이 **실제로 무엇을 그리는가**(2026-11-02, 조각 6).
 *
 * 이웃 execution-list-fold.test.tsx 와 같은 방법 — 묶음은 서버 액션도 DB 조회
 * 타입도 안 물게 적었으므로 **렌더해서** 잰다. 반대로 ProcedureExecutionScreen
 * 은 DB 조회 타입을 끌고 와서 import 가 던지므로, **어디에 놓았는가**는 원본
 * 글자로 확인한다(🔴 주석을 걷어낸 뒤에 — 이 저장소는 주석에 낱말이 적혀
 * 있다는 이유로 셈이 틀린 적이 있다).
 *
 * 배지·진행도·차례를 **무엇으로 가르는가**는 unit 목록의
 * procedure-execution-past-runs.test.ts 가 잰다. 여기서는 그 결과가 화면 글자로
 * 나오는지만 본다.
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

function nodesOf(counts: Partial<Record<ProcedureCaseExecutionNodeStatus, number>>): { status: ProcedureCaseExecutionNodeStatus }[] {
  const out: { status: ProcedureCaseExecutionNodeStatus }[] = [];
  for (const [status, count] of Object.entries(counts) as [ProcedureCaseExecutionNodeStatus, number][]) {
    for (let i = 0; i < count; i += 1) out.push({ status });
  }
  return out;
}

function candidate(overrides: Partial<PastExecutionCandidate> = {}): PastExecutionCandidate {
  return {
    executionId: "exec-1",
    templateName: "원복 검사 및 개선 작업 (3상 입력)",
    templateCode: "7",
    nodes: nodesOf({ COMPLETED: 1 }),
    startedAt: "2026-11-02T01:00:00.000Z",
    startedByName: "홍길동",
    completedAt: "2026-11-02T02:00:00.000Z",
    isDeleted: false,
    deletedAt: null,
    deletedByName: null,
    deleteReason: null,
    ...overrides,
  };
}

/** 실측 dd0389d1 — 27장이 전부 완료(완주). */
const COMPLETED_ALL = candidate({
  executionId: "dd0389d1",
  templateName: "기본 통전 검사 (3상 입력)",
  templateCode: "기본 통전 검사 (3상 입력)",
  nodes: nodesOf({ COMPLETED: 27 }),
  completedAt: "2026-11-02T06:02:10.922Z",
});
/** 실측 66c8ba16 — 19장이 남은 채로 마쳤다(중단 마침). */
const FINISHED_WITH_REMAINING = candidate({
  executionId: "66c8ba16",
  nodes: nodesOf({ PENDING: 16, IN_PROGRESS: 2, BLOCKED: 1, COMPLETED: 2, SKIPPED: 1 }),
  completedAt: "2026-11-02T06:00:59.628Z",
});
/** 실측 f7244886 — 사유 한 글자로 그만뒀다. */
const ABANDONED = candidate({
  executionId: "f7244886",
  nodes: nodesOf({ PENDING: 21, IN_PROGRESS: 1 }),
  completedAt: null,
  isDeleted: true,
  deletedAt: "2026-11-02T06:00:19.036Z",
  deletedByName: "홍길동",
  deleteReason: ".",
});
/** 실측 e5e9424a — 아직 도는 실행. 큰 카드에 못 선 둘째다. */
const STILL_RUNNING = candidate({
  executionId: "e5e9424a",
  nodes: nodesOf({ PENDING: 22 }),
  completedAt: null,
  startedAt: "2026-11-02T06:10:11.048Z",
});

const render = (candidates: PastExecutionCandidate[]) => renderToStaticMarkup(<PastExecutionsSection candidates={candidates} />);

describe("🔵 먼저 — 렌더가 실제로 돌고 있다", () => {
  test("줄이 있을 때와 없을 때가 **서로 다르게** 읽힌다", () => {
    const drawn = render([ABANDONED]);
    assert.ok(drawn.includes("<details"), "묶음이 아예 안 그려졌다 — 아래 단언이 전부 뜻을 잃는다");
    assert.ok(drawn.includes("이 건의 다른 절차 (1)"));
    assert.equal(render([]), "", "빈 입력이 빈 글자를 내야 「안 그린다」를 잴 수 있다");
  });
});

describe("🔴 배지 넷이 화면에 **각각 다른 글자와 색**으로 뜬다", () => {
  const html = render([COMPLETED_ALL, FINISHED_WITH_REMAINING, ABANDONED, STILL_RUNNING]);

  test("글자가 넷 다 있다", () => {
    assert.ok(html.includes(">완주<"), "완주 배지가 없다");
    assert.ok(html.includes(">중단 마침<"), "중단 마침 배지가 없다");
    assert.ok(html.includes(">그만둠<"), "그만둠 배지가 없다");
    assert.ok(html.includes(">진행 중<"), "진행 중 배지가 없다");
    assert.equal((html.match(/data-past-execution-badge/g) ?? []).length, 4);
  });

  test("갈래가 글자에만 있지 않다 — data 속성으로도 갈린다", () => {
    for (const outcome of ["COMPLETED_ALL", "FINISHED_WITH_REMAINING", "ABANDONED", "STILL_RUNNING"]) {
      assert.ok(html.includes(`data-past-execution-badge="${outcome}"`), outcome);
    }
  });

  test("🔴 **경고색(빨강·호박)을 안 쓴다** — 「중단 마침」도 「진행 중」도 나무람이 아니다", () => {
    // 사람이 「여기까지가 이 건에 필요한 전부」라고 판단해서 끝낸 것이고, 도는
    // 실행은 멀쩡히 살아 있는 것이다. 같은 화면의 [실행 그만두기] 단추가 red-*,
    // 차단됨 딱지가 amber-* 를 쓰므로 배지가 그 색을 쓰면 뜻이 섞인다.
    const badges = html.match(/<span data-past-execution-badge[^>]*>/g) ?? [];
    assert.equal(badges.length, 4, "배지를 못 찾으면 아래 색 단언이 공짜로 통과한다");
    for (const badge of badges) {
      assert.ok(!/red-|rose-|amber-/.test(badge), `경고색이 섞였다: ${badge}`);
    }
  });

  test("넷의 색이 서로 다르다 — 같으면 배지를 나눈 뜻이 없다", () => {
    const classOf = (outcome: string) => {
      const match = html.match(new RegExp(`<span data-past-execution-badge="${outcome}"[^>]*class="([^"]*)"`));
      assert.ok(match, `${outcome} 배지의 class 를 못 찾았다`);
      return match[1];
    };
    const classes = ["COMPLETED_ALL", "FINISHED_WITH_REMAINING", "ABANDONED", "STILL_RUNNING"].map(classOf);
    assert.equal(new Set(classes).size, 4, classes.join(" | "));
    assert.match(classes[0], /emerald/);
    assert.match(classes[1], /sky/);
    assert.match(classes[2], /zinc/);
    assert.match(classes[3], /violet/);
  });
});

describe("한 줄에 무엇이 적히는가", () => {
  test("배지 · 절차 이름 · 진행도 · 날짜가 한 줄에 함께 있다", () => {
    const html = render([FINISHED_WITH_REMAINING]);
    assert.ok(html.includes(">중단 마침<"));
    assert.ok(html.includes("원복 검사 및 개선 작업 (3상 입력) (7)"));
    assert.ok(html.includes("진행 3 / 22"), "진행도가 안 보이면 「어디까지 했나」가 안 읽힌다");
    assert.ok(/2026\.?\s*11\.?\s*2/.test(html), `날짜가 안 보인다: ${html}`);
    assert.ok(html.includes("마침"));
    assert.ok(html.includes("홍길동님이 시작"));
  });

  test("🔴 그만둔 줄에는 **사유도** 보인다", () => {
    const html = render([ABANDONED]);
    assert.ok(html.includes("홍길동님이 그만둠"));
    assert.ok(html.includes("사유: ."), "「잘못 불러옴」과 「수리 취소」를 가를 수단이 이 글자뿐이다");
    assert.ok(html.includes("진행 0 / 22"));
  });

  test("마친 줄에는 사유 자리가 아예 없다", () => {
    assert.ok(!render([COMPLETED_ALL]).includes("data-past-execution-reason"));
  });

  test("코드가 이름과 같은 절차는 이름을 두 번 안 적는다", () => {
    const html = render([COMPLETED_ALL]);
    assert.ok(html.includes("기본 통전 검사 (3상 입력)"));
    assert.ok(!html.includes("기본 통전 검사 (3상 입력) (기본 통전 검사"), html);
  });
});

describe("🔴 담을 줄이 없으면 **아무것도 안 그린다**", () => {
  test("실행이 아예 없으면 빈 글자다 — 그때만 빈 글자다", () => {
    assert.equal(render([]), "");
  });

  test("🔴 도는 실행 하나만 있어도 **그린다** — 안 그리면 「불러왔는데 사라졌다」가 그대로다", () => {
    const html = render([STILL_RUNNING]);
    assert.ok(html.includes("이 건의 다른 절차 (1)"), "처음 판은 여기서 빈 글자라 둘째 절차가 통째로 숨었다");
    assert.ok(html.includes(">진행 중<"));
    assert.ok(html.includes("진행 0 / 22"));
    assert.ok(html.includes("홍길동님이 시작"));
  });

  test("🔴 접힌 줄에 **「진행 중 1」 딱지**가 남는다 — 안 펼쳐도 보여야 한다", () => {
    const html = render([STILL_RUNNING, ABANDONED, COMPLETED_ALL]);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    assert.ok(summary.includes("이 건의 다른 절차 (3)"));
    assert.ok(summary.includes("진행 중 1"), "접어 두면 도는 줄이 숨는다 — 제목 줄에 적어야 안 사라진다");
    assert.ok(!summary.includes("amber"), "경고로 읽히면 안 된다 — 도는 실행은 고장이 아니다");
  });

  test("도는 것과 끝난 것이 섞이면 줄이 둘 다 선다 — 도는 것이 위", () => {
    const html = render([ABANDONED, STILL_RUNNING]);
    assert.ok(html.includes("이 건의 다른 절차 (2)"));
    // 🔵 `data-past-execution-badge` 에 속지 않도록 `="` 까지 붙여 센다.
    assert.equal((html.match(/data-past-execution="/g) ?? []).length, 2);
    assert.ok(
      html.indexOf('data-past-execution-badge="STILL_RUNNING"') < html.indexOf('data-past-execution-badge="ABANDONED"'),
      "도는 줄이 아래로 내려가면 찾으러 온 사람이 또 못 찾는다"
    );
  });
});

describe("🔴 읽기 전용이다 — 누를 것이 하나도 없다", () => {
  const raw = readFileSync(new URL("./PastExecutionsSection.tsx", import.meta.url), "utf8");
  const source = stripComments(raw);

  test("🔵 주석 걷어내기가 실제로 듣는다", () => {
    assert.ok(raw.includes("🔴"));
    assert.ok(!source.includes("🔴"), "주석이 남으면 아래 「없어야 한다」가 주석만 보고 깨진다");
  });

  test("단추도 링크도 입력 칸도 없다 — 되살리는 길은 이 조각에 없다", () => {
    for (const forbidden of ["<button", "<a ", "<Link", "<form", "<input", "onClick", "href="]) {
      assert.ok(!source.includes(forbidden), `${forbidden} 이 있으면 눌러도 아무 일도 안 일어나는 자리가 생긴다`);
    }
    const html = render([COMPLETED_ALL, ABANDONED]);
    assert.ok(!/<button|<a\s|href=/.test(html), html.slice(0, 400));
  });

  test('🔴 "use client" 가 늘지 않았다 — 서버 컴포넌트 그대로다', () => {
    assert.ok(!/"use client"/.test(source));
  });

  test("🔴 판정을 다시 하지 않는다 — 도메인이 돌려준 null 과 값을 그대로 쓴다", () => {
    assert.match(flat(source), /const panel = buildPastExecutionPanel\(candidates\);/);
    assert.match(flat(source), /if \(!panel\) return null;/);
    assert.ok(
      !/status ===|completedAt|isDeleted|\.length > 0|\.length === 0/.test(source),
      "화면이 배지나 머릿수를 다시 세면 판정이 두 벌이 된다"
    );
  });

  test("접는 그릇은 **같은 것**을 쓴다 — 화면에 접히는 모양이 둘 생기지 않았다", () => {
    assert.match(source, /<ExecutionFoldSection group=\{panel\.fold\}>/);
    assert.ok(!/<details/.test(source), "직접 접으면 「펼치기/접기」가 두 벌이 된다");
  });
});

describe("실행 화면 어디에 놓였는가", () => {
  const screenRaw = readFileSync(new URL("./ProcedureExecutionScreen.tsx", import.meta.url), "utf8");
  const screen = stripComments(screenRaw);
  const source = flat(screen);

  test("🔵 먼저 — 묶음이 화면에 실제로 적혀 있다", () => {
    assert.ok(screenRaw.includes("🔴") && !screen.includes("🔴"), "주석 걷어내기가 안 듣는다");
    assert.equal(
      (source.match(/<PastExecutionsSection candidates=\{pastExecutions\} \/>/g) ?? []).length,
      2,
      "🔴 두 번이어야 한다 — 도는 실행이 있을 때와, 그만둔 뒤 불러오기 카드만 설 때"
    );
  });

  test("🔴 도는 실행이 없을 때도 그린다 — 그만둔 뒤의 화면이 바로 그 모습이다", () => {
    // 🔵 자르는 자리는 **코드 한 줄**로 잡는다. 주석 글귀로 자르면 stripComments
    // 가 그것을 지워 indexOf 가 -1 이 되고, 자른 적이 없는데 통과한다.
    const splitAt = source.indexOf("const pendingNodes");
    assert.ok(splitAt > 0, "두 가지를 가르는 자리를 못 찾으면 아래가 아무것도 안 잰다");
    const startBranch = source.slice(0, splitAt);
    assert.ok(startBranch.includes("<ExecutionStartCard"), "표본 확인 — 불러오기 카드 가지를 제대로 잘랐다");
    assert.ok(startBranch.includes("<PastExecutionsSection"), "불러오기 카드만 서는 가지에 묶음이 없다");
    assert.ok(
      startBranch.indexOf("<ExecutionStartCard") < startBranch.indexOf("<PastExecutionsSection"),
      "불러오기 카드 **아래**다"
    );
  });

  test("도는 실행의 화면 **아래**다 — 큰 카드도 띠도 목록도 밀어내지 않는다", () => {
    const at = source.lastIndexOf("<PastExecutionsSection");
    for (const tag of ["<ProgressSummary", "<ExecutionFlowStrip", "<CurrentTaskCard", "group={fold.remaining}", "group={fold.done}"]) {
      const tagAt = source.indexOf(tag);
      assert.ok(tagAt >= 0, `${tag} 이 화면에서 사라졌다`);
      assert.ok(tagAt < at, `${tag} 이 「이 건의 다른 절차」 아래로 내려갔다`);
    }
  });

  test("🔴 도는 실행의 화면은 그대로다 — 이번 조각이 더하기만 했다", () => {
    const sections = source.match(/<NodeSection[\s\S]*?\/>/g) ?? [];
    assert.equal(sections.length, 4, "실행 가능·진행 중·차단됨·완료/건너뜀 넷 그대로");
    assert.match(source, /const fold = buildExecutionListFold\(\{ nodes: executionDetail\.nodes, isExecutionFinished \}\);/);
    assert.match(source, /<ExecutionLifecycleActions/);
  });

  test("🔴 화면이 배지를 다시 고르지 않는다 — 재료만 내려보낸다", () => {
    assert.ok(
      !/buildPastExecutionPanel|classifyPastExecution/.test(screen),
      "화면이 도메인을 직접 부르면 두 가지에서 판정이 두 벌이 된다"
    );
  });
});
