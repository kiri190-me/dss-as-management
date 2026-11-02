import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessExecutionFinish } from "@/lib/domain/procedure-execution-lifecycle";

/**
 * 실행을 **끝내는** 단추와 **그만두는** 단추, 그리고 그것들이 선 화면
 * (2026-11-02, 조각 5).
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ExecutionLifecycleActions 는 **서버 액션을 직접 import 하는 클라이언트
 * 컴포넌트**다(@/lib/server/actions/procedure-case-execution → server-only).
 * 그 사슬 때문에 react-server 조건 없이 도는 test:components 에서는 import
 * 자체가 던진다. 이웃 execution-current-task.test.ts 가 같은 사정에서 쓴 방법을
 * 그대로 쓴다 — 판정이 적혀 있는 자리를 원본에서 직접 확인한다.
 *
 * 서버 쪽 동작(정말 치워지는가 · completed_at 이 차는가 · 확인 없이 끝내면
 * 거절하는가)은 db 목록의 procedure-case-execution.integration.test.ts 가 잰다.
 * 묻는 규칙 자체는 unit 목록의 procedure-execution-lifecycle.test.ts 가 잰다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 주석에 낱말이 적혀 있다는 이유로 셈이 틀린 적이 있다. 모든 판정은
 * **주석을 걷어낸 글자**로만 한다.
 */

const repoUrl = new URL("../../../../", import.meta.url);
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

const actionsRaw = read("src/components/procedures/execution/ExecutionLifecycleActions.tsx");
const screenRaw = read("src/components/procedures/execution/ProcedureExecutionScreen.tsx");
const formRaw = read("src/components/repair-cases/work-records/WorkRecordForm.tsx");
const pageRaw = read("src/app/(app)/repair-cases/[id]/execution/page.tsx");
const actions = stripComments(actionsRaw);
const screen = stripComments(screenRaw);
const form = stripComments(formRaw);
const page = stripComments(pageRaw);

describe("🔵 먼저 — 주석 걷어내기가 실제로 돌고 있다", () => {
  test("걷어낸 글자가 원본보다 짧고, 주석에만 쓰는 표시(🔴)가 남지 않는다", () => {
    for (const [name, raw, stripped] of [
      ["ExecutionLifecycleActions", actionsRaw, actions],
      ["ProcedureExecutionScreen", screenRaw, screen],
      ["WorkRecordForm", formRaw, form],
    ] as const) {
      assert.ok(raw.includes("🔴"), `${name} 원본에 🔴 주석이 있어야 이 확인이 뜻을 가진다`);
      assert.ok(stripped.length < raw.length, `${name}: 걷어낸 것이 없다 — 스트리퍼가 안 듣는다`);
      assert.ok(!stripped.includes("🔴"), `${name}: 주석이 남아 있으면 아래 판정이 주석만 보고 통과한다`);
    }
  });
});

describe("㉠ 실행을 그만둘 길이 생겼다", () => {
  test("단추 글자는 「실행 그만두기」다", () => {
    assert.match(actions, /실행 그만두기/);
    assert.match(flat(actions), /data-execution-abandon/);
  });

  test("🔴 되돌리기 어려운 일이라 **확인 창**을 거친다 — 누르자마자 치우지 않는다", () => {
    // 단추의 onClick 은 창을 여는 것뿐이고, 실제 호출은 창의 onConfirm 에 있다.
    assert.match(flat(actions), /onClick=\{\(\) => \{ setErrorMessage\(null\); setIsAbandoning\(true\); \}\}/);
    assert.match(flat(actions), /<ReasonPromptDialog isOpen=\{isAbandoning\}/);
    assert.match(flat(actions), /onConfirm=\{handleAbandonConfirm\}/);
  });

  test("🔴 **사유를 받는다** — 이 저장소의 사유 창을 그대로 쓴다", () => {
    // 나중에 「잘못 불러와서 치운 것」과 「수리가 취소돼 멈춘 것」을 가를 수단이
    // 그 글자뿐이다. 창은 건너뛰기·차단·재개가 쓰는 바로 그것이다.
    assert.match(actions, /import ReasonPromptDialog from "\.\/ReasonPromptDialog"/);
    assert.match(flat(actions), /abandonProcedureExecutionAction\(\{ executionId, expectedVersion: executionVersion, reason, \}\)/);
  });

  test("무엇이 일어나는지 창에 적는다 — 기록은 남지만 화면에서는 사라진다", () => {
    assert.match(flat(actions), /warningNote="[^"]*지나온 기록은 지워지지 않지만[^"]*"/);
  });
});

/**
 * 🔴 2026-11-02 에 **보이는 때가 바뀐** 묶음이다. 처음에는 단추 아래에 늘 보이는
 * 한 줄로 달았는데, 사용자가 「포인터를 갖다 댔을 때만」으로 정했다. 글자는 한
 * 글자도 안 바꿨고 **보이는 때만** 바뀌었다 — 그래서 시험도 지우지 않고 「어디에
 * 적혀 있는가」만 옮겨 잰다.
 */
describe("🔴 두 단추의 뜻이 **올려 두면 뜨는 글자**(title)에 있다", () => {
  const flatActions = flat(actions);
  const FINISH_HINT = "이 절차를 다 했다고 기록합니다 — 지나온 길이 남습니다.";
  const ABANDON_HINT = "잘못 불러왔거나 이 절차를 안 쓰게 됐을 때 — 이 건에서 치웁니다.";

  /** 그 단추 하나만 잘라 본다 — 다른 단추의 title 을 보고 통과하지 않게. */
  function buttonBlock(marker: string): string {
    const at = flatActions.indexOf(marker);
    assert.ok(at >= 0, `${marker} 단추를 못 찾았다`);
    return flatActions.slice(at, flatActions.indexOf("</button>", at));
  }

  test("🔵 먼저 — 글자 둘이 소스에 그대로 있다", () => {
    assert.ok(actions.includes(FINISH_HINT) && actions.includes(ABANDON_HINT), "글자가 바뀌었으면 아래가 전부 뜻을 잃는다");
  });

  test("[절차 끝내기] 단추에 **남기는 것**이라고 적혀 있다", () => {
    assert.match(buttonBlock("data-execution-finish"), /title=\{FINISH_HINT\}/);
  });

  test("[실행 그만두기] 단추에 **치우는 것**이라고 적혀 있다", () => {
    assert.match(buttonBlock("data-execution-abandon"), /title=\{ABANDON_HINT\}/);
  });

  test("🔴 **평소에는 화면에 안 뜬다** — 글자가 나오는 자리가 선언 한 곳뿐이다", () => {
    // title 은 값으로만 넘기므로, 글자 자체가 소스에 나오는 자리는 상수 선언
    // 하나다. 늘 보이는 줄로 되돌아오면(JSX 본문에 다시 적으면) 여기서 걸린다.
    for (const hint of [FINISH_HINT, ABANDON_HINT]) {
      assert.equal(
        actions.split(hint).length - 1,
        1,
        `「${hint}」 가 소스에 두 번 이상 나온다 — 늘 보이는 줄이 되살아났는지 보라`
      );
    }
    // 보이는 글자로 그리는 모양(>글자<)이 아니어야 한다.
    assert.ok(!flatActions.includes(`> ${FINISH_HINT} <`) && !flatActions.includes(`> ${ABANDON_HINT} <`));
    assert.ok(!flatActions.includes("data-execution-finish-hint"), "늘 보이던 줄의 표시가 남아 있다");
    assert.ok(!flatActions.includes("data-execution-abandon-hint"));
  });

  test("🔴 두 글자가 **서로 다른 말**을 한다 — 같은 말이면 가르는 데 쓸모가 없다", () => {
    assert.ok(FINISH_HINT.includes("기록합니다") && !FINISH_HINT.includes("치웁니다"));
    assert.ok(ABANDON_HINT.includes("치웁니다") && !ABANDON_HINT.includes("기록합니다"));
  });

  test("🔴 이 저장소가 **이미 쓰는 방식**이다 — 직접 만든 말풍선이 아니다", () => {
    // 말풍선을 absolute 로 띄웠다면 바로 아래 「지금 할 일」 큰 카드를 덮는다.
    // sr-only 는 이 저장소에서 창 스크롤을 하나 더 만든 전력이 있다(1px 고장).
    assert.ok(!/absolute/.test(actions), "직접 띄운 말풍선은 아래 카드를 가린다");
    assert.ok(!/sr-only/.test(actions), "이 저장소의 sr-only 는 position:absolute 라 문서 바닥에 자리를 주장한다");
    assert.ok(!/group-hover/.test(actions), "hover 전용 CSS 는 폰에서 첫 탭이 먹히는 수가 있다");
  });

  test("⚠️ 폰에는 올려 두기가 없다 — **창 안의 설명은 그대로** 남아 서로를 가리킨다", () => {
    assert.match(flatActions, /잘못 불러온 절차를 <span className="font-medium">치우려는<\/span> 것이라면 \[실행 그만두기\]입니다\./);
    assert.match(flatActions, /warningNote="[^"]*다 한 절차를 마무리하려는 것이라면 \[절차 끝내기\]입니다\./);
  });
});

describe("🔴 마친 실행에서는 「지금 할 일」이 안 그려진다", () => {
  const flatScreen = flat(screen);

  test("마쳤다는 까닭이면 카드 자리를 **비운다** — 안내조차 안 세운다", () => {
    assert.match(
      flatScreen,
      /\{currentTask\.kind === "NONE" \? \( currentTask\.reason === "EXECUTION_FINISHED" \? null : <NoCurrentTaskCard reason=\{currentTask\.reason\} \/> \) : \( <CurrentTaskCard/
    );
  });

  test("🔴 화면이 completedAt 을 **다시 보지 않는다** — 도메인이 준 까닭을 따른다", () => {
    const between = flatScreen.slice(flatScreen.indexOf("<ExecutionFlowStrip"), flatScreen.indexOf("{fold.remaining &&"));
    assert.ok(between.length > 0, "큰 카드 자리를 못 찾았다");
    assert.ok(!between.includes("completedAt"), "이 자리에서 completedAt 을 또 보면 판정이 두 벌이 된다");
  });

  test("안내 카드의 prop 타입에서 EXECUTION_FINISHED 가 **빠져 있다** — 컴파일러가 막는다", () => {
    assert.match(flatScreen, /reason: Exclude<NoCurrentTaskReason, "EXECUTION_FINISHED">/);
  });

  test("🔵 흐름 띠도 함께 물러난다 — 따로 숨기지 않아도 된다", () => {
    // 띠는 「지금 할 일」을 받아 그린다. 마치면 그것이 null 이 되고, 도메인이
    // HIDDEN 을 돌려주며, 띠는 HIDDEN 에서 아무것도 안 그린다(null). 셋이 한
    // 사슬이라 화면에 조건을 더 붙이지 않았다 — 그 사슬을 여기서 못 박는다.
    assert.match(flatScreen, /current: currentTask\.kind === "NONE" \? null : currentTask\.node,/);
    const strip = stripComments(read("src/components/procedures/execution/ExecutionFlowStrip.tsx"));
    assert.match(strip, /if \(minimap\.kind === "HIDDEN"\) return null;/);
    const minimapSource = stripComments(read("src/lib/domain/procedure-execution-minimap.ts"));
    assert.match(minimapSource, /if \(!input\.current\) return \{ kind: "HIDDEN", reason: "NO_CURRENT_TASK" \};/);
  });

  test("「지나온 길」과 「실행 이력」은 마친 뒤에도 그려진다 — 조건이 안 붙어 있다", () => {
    // 둘 다 「담을 것이 있는가」(null 여부)만 보고, 마쳤는지는 안 본다.
    assert.match(flatScreen, /\{fold\.done && \( <ExecutionFoldSection group=\{fold\.done\}>/);
    assert.match(flatScreen, /\{historyFold && \( <ExecutionFoldSection group=\{historyFold\}>/);
  });
});

describe("㉡ 실행을 끝낼 길이 생겼다", () => {
  test("단추 글자는 「절차 끝내기」이고, 끝낸 뒤에는 「절차를 마쳤습니다」가 뜬다", () => {
    assert.match(actions, /절차 끝내기/);
    assert.match(flat(actions), /data-execution-finished[^>]*>\s*절차를 마쳤습니다/);
  });

  test("🔴 끝내기는 **사유를 안 받는다** — 절차를 마치는 것은 예외 상황이 아니다", () => {
    const finishDialog = flat(actions).slice(
      flat(actions).indexOf('id="execution-finish-dialog-title"'),
      flat(actions).indexOf("<ReasonPromptDialog")
    );
    assert.ok(finishDialog.length > 0, "끝내기 확인 창을 못 찾았다 — 이름이 바뀌었나");
    assert.ok(!finishDialog.includes("사유"), "사유를 요구하면 매번 「완료」 같은 빈말을 적게 된다");
  });

  test("🔴 남은 것이 있으면 **확인을 받고** 부른다 — 바로 끝내지 않는다", () => {
    assert.match(
      flat(actions),
      /if \(finish\.needsConfirmation\) \{ setErrorMessage\(null\); setConfirmMessage\(finish\.confirmationMessage\); setIsConfirmingFinish\(true\); return; \}/
    );
    // 확인 창의 단추만 confirmedRemaining=true 로 부른다.
    assert.match(flat(actions), /onClick=\{\(\) => void runFinish\(true\)\}/);
    assert.match(flat(actions), /void runFinish\(false\)/);
  });

  test("🔴 서버가 「아직 남았다」로 돌려보내면 **그때도 묻는다** — 삼키지 않는다", () => {
    // 화면이 세어 둔 수는 옛말일 수 있다(그 사이 남이 노드를 되돌렸을 수 있다).
    assert.match(
      flat(actions),
      /if \(result\.code === "UNFINISHED_NODES_REMAIN"\) \{ setConfirmMessage\(result\.message\); setIsConfirmingFinish\(true\); return; \}/
    );
  });

  test("🔴 확인 문구를 화면에서 **다시 만들지 않는다** — 도메인이 만든 글자를 그대로 띄운다", () => {
    assert.match(flat(actions), /data-execution-finish-confirm[^>]*>\s*\{confirmMessage\}/);
    assert.ok(
      !/remainingCount\}개/.test(flat(actions).slice(flat(actions).indexOf('id="execution-finish-dialog-title"'))),
      "창에서 수를 다시 조립하면 서버가 보는 수와 사람이 읽는 수가 갈린다"
    );
  });

  test("🔵 다 끝났을 때 단추가 **눈에 띈다** — 그 자리에는 「지금 할 일」 큰 카드가 안 선다", () => {
    const flatActions = flat(actions);
    const at = flatActions.indexOf("data-execution-finish");
    const button = flatActions.slice(at, flatActions.indexOf("</button>", at));
    assert.ok(button.includes("finish.needsConfirmation ?"), "남은 것이 있을 때와 없을 때가 같은 모양이면 안 띈다");
    // 남은 것이 없을 때(= 삼항의 뒤쪽)가 꽉 찬 단추다.
    assert.match(button, /: "rounded-md bg-emerald-600/);
  });

  test("표본 확인 — 도메인 판정이 두 표본에서 실제로 갈린다", () => {
    // 위 단추가 두 모양으로 갈리는 근거가 되는 값이다. 늘 같은 값이면 위
    // 단언들이 재는 것이 없다.
    assert.equal(assessExecutionFinish([{ status: "COMPLETED" }]).needsConfirmation, false);
    assert.equal(assessExecutionFinish([{ status: "PENDING" }]).needsConfirmation, true);
  });
});

describe("끝낸 뒤·그만둔 뒤의 화면", () => {
  test("🔴 끝낸 실행에서는 「+ 기술 절차 불러오기」 카드가 **다시 선다**", () => {
    assert.match(
      flat(screen),
      /\{executionDetail\.completedAt && \( <ExecutionStartCard repairCaseId=\{repairCaseId\}/,
      "다시 안 서면 「마쳤습니다」만 남고 화면이 또 막힌다"
    );
  });

  test("그 카드에 넣을 목록을 페이지가 **끝났을 때만** 읽는다", () => {
    assert.match(flat(page), /activeExecution\.completedAt \? getExecutableTemplateOptions\(\) : Promise\.resolve\(\[\]\)/);
  });

  test("🔴 그만둔 실행은 조회가 **아예 안 돌려준다** — 그래서 불러오기 카드가 다시 선다", () => {
    // 화면의 「실행이 없을 때」 갈래는 전부터 있던 그것 그대로다. 그만두기가
    // 한 일은 activeExecution 을 null 로 만드는 것뿐이다.
    const queries = stripComments(read("src/lib/db/queries/procedure-case-execution.ts"));
    // 🔴 자르는 끝을 **주석 줄로 잡지 않는다** — 위에서 주석을 걷어낸 글자라
    // 구역 머리말(`// ---- 실행 상세`)은 이미 없다. 못 찾으면 slice 가 파일
    // 끝까지 가져오고, 바로 아래 getExecutionDetail 의 같은 글자를 보고 이
    // 단언이 **영영 통과한다**(실제로 그랬다).
    const flatQueries = flat(queries);
    const from = flatQueries.indexOf("export async function getActiveExecutionForCase");
    const to = flatQueries.indexOf("export async function getExecutionDetail");
    assert.ok(from >= 0 && to > from, "조회 함수를 못 찾았다 — 이름이 바뀌었나");
    const active = flatQueries.slice(from, to);
    assert.match(active, /eq\(procedureCaseExecutions\.isDeleted, false\)/, "치운 것을 안 거르면 그만둬도 화면이 그대로다");
    assert.match(flat(screen), /if \(!activeExecution \|\| !executionDetail\) \{ return \( <div/);
  });

  test("단추 묶음은 요약 **바로 아래**이고, 접히는 묶음보다 위다", () => {
    const source = flat(screen);
    const summaryAt = source.indexOf("<ProgressSummary");
    const actionsAt = source.indexOf("<ExecutionLifecycleActions");
    const foldAt = source.indexOf("<ExecutionFoldSection");
    assert.ok(summaryAt >= 0 && actionsAt >= 0 && foldAt >= 0, "셋 중 하나를 못 찾았다");
    assert.ok(summaryAt < actionsAt, "요약보다 위로 올라가면 「몇 %인가」와 멀어진다");
    assert.ok(actionsAt < foldAt, "접히는 묶음 안으로 들어가면 접었을 때 끝낼 길이 사라진다");
  });

  test("🔴 남은 수를 화면이 다시 세지 않는다 — 도메인 함수 하나가 센다", () => {
    assert.match(flat(screen), /const finish = assessExecutionFinish\(executionDetail\.nodes\);/);
    assert.match(flat(screen), /<ExecutionLifecycleActions[^>]*finish=\{finish\}/);
  });

  test('🔴 이번 조각으로 "use client" 가 늘지 않았다 — 실행 화면은 서버 컴포넌트 그대로다', () => {
    assert.ok(!/"use client"/.test(screen), "화면이 클라이언트가 되면 아래 트리가 통째로 따라 내려간다");
    assert.match(stripComments(actionsRaw), /^\s*"use client";/, "표본 확인 — 단추 쪽은 이 잣대에 걸린다");
  });

  test("기존 구역은 그대로 있다 — 이번 조각도 더하기만 한다", () => {
    for (const tag of ["<ProgressSummary", "<ExecutionFlowStrip", "<CurrentTaskCard", "<NoCurrentTaskCard"]) {
      assert.ok(screen.includes(tag), `${tag} 이 화면에서 사라졌다`);
    }
    for (const title of ["실행 가능", "진행 중", "차단됨", "완료 / 건너뜀"]) {
      assert.ok(screen.includes(`title="${title}"`), `${title} 구역이 사라지면 안 된다`);
    }
  });
});

describe("㉢ 작업 기록이 「지금 할 일」에 저절로 붙는다", () => {
  test("🔴 드롭다운의 기본값이 「지금 할 일」 노드다", () => {
    assert.match(flat(form), /useState\(defaultProcedureNodeId \?\? ""\)/);
  });

  test("🔴 「연결 안 함」 선택지는 **그대로 남는다** — 절차와 무관한 기록이 있다", () => {
    assert.match(flat(form), /<option value="">연결 안 함<\/option>/);
  });

  test("저장한 뒤에도 빈 값이 아니라 기본값으로 돌아간다", () => {
    assert.match(flat(form), /setSelectedNodeId\(defaultProcedureNodeId \?\? ""\)/);
  });

  test("🔴 상태로 거르지 않는다 — 받은 목록을 그대로 그린다", () => {
    assert.match(flat(form), /\{procedureNodeOptions\.map\(\(option\) => \( <option key=\{option\.id\} value=\{option\.id\}> \{option\.label\}/);
    assert.ok(
      !/IN_PROGRESS|status ===/.test(form),
      "폼이 상태로 거르면 「진행 중만 담는다」가 되살아난다"
    );
  });

  test("🔴 「지금 할 일」을 페이지가 **다시 고르지 않는다** — 실행 화면과 같은 함수를 쓴다", () => {
    assert.match(
      flat(page),
      /const currentTaskNode = pickCurrentTaskNode\(executionDetail\.nodes, \{ isExecutionFinished: executionDetail\.completedAt !== null, \}\);/,
      "실행 화면과 같은 함수를, 같은 인자로 불러야 둘이 같은 노드를 가리킨다"
    );
    assert.match(
      flat(page),
      /buildWorkRecordProcedureLink\(\{ nodes: executionDetail\.nodes, currentTaskNodeId: currentTaskNode\?\.id \?\? null, \}\)/
    );
    assert.ok(
      !/filter\(\(n\) => n\.status === "IN_PROGRESS"\)/.test(page),
      "옛 셈(진행 중만 담기)이 페이지에 남아 있다"
    );
  });
});
