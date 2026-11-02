import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessExecutionFinish } from "@/lib/domain/procedure-execution-lifecycle";
import { placeExecutionSummary } from "@/lib/domain/procedure-execution-summary-placement";

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
/**
 * 🔵 2026-11-02(조각 8 보완)에 **그만두기 단추가 제 파일로 갈라졌다** — 「이
 * 건의 다른 절차」의 줄마다 같은 단추가 붙어야 해서다(사용자 지적 「건별로
 * 있도록 해주고」). 그만두기를 재던 단언들은 지우지 않고 **읽는 파일만** 이쪽으로
 * 옮겼다.
 */
const abandonRaw = read("src/components/procedures/execution/ExecutionAbandonButton.tsx");
/**
 * 🔵 2026-11-02(조각 9) — 마친 실행을 **다시 잇는** 단추가 하나 더 생겼다.
 * 사용자 말: 「절차를 다 진행하지 않고 절차를 마친 경우는 마쳐진 노드부터 절차를
 * 재개할 수 있도록 해주고.」 짝인 [실행 그만두기]와 **붙는 줄이 다르고**(중단
 * 마침 하나) 하는 일이 정반대라, 둘을 나란히 두고 잰다.
 */
const resumeRaw = read("src/components/procedures/execution/ExecutionResumeButton.tsx");
const screenRaw = read("src/components/procedures/execution/ProcedureExecutionScreen.tsx");
const formRaw = read("src/components/repair-cases/work-records/WorkRecordForm.tsx");
const pageRaw = read("src/app/(app)/repair-cases/[id]/execution/page.tsx");
const actions = stripComments(actionsRaw);
const abandon = stripComments(abandonRaw);
const resume = stripComments(resumeRaw);
const screen = stripComments(screenRaw);
const form = stripComments(formRaw);
const page = stripComments(pageRaw);

describe("🔵 먼저 — 주석 걷어내기가 실제로 돌고 있다", () => {
  test("걷어낸 글자가 원본보다 짧고, 주석에만 쓰는 표시(🔴)가 남지 않는다", () => {
    for (const [name, raw, stripped] of [
      ["ExecutionLifecycleActions", actionsRaw, actions],
      ["ExecutionAbandonButton", abandonRaw, abandon],
      ["ExecutionResumeButton", resumeRaw, resume],
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
    assert.match(abandon, /실행 그만두기/);
    assert.match(flat(abandon), /data-execution-abandon/);
  });

  test("🔴 되돌리기 어려운 일이라 **확인 창**을 거친다 — 누르자마자 치우지 않는다", () => {
    // 단추의 onClick 은 창을 여는 것뿐이고, 실제 호출은 창의 onConfirm 에 있다.
    assert.match(flat(abandon), /onClick=\{\(\) => \{ setErrorMessage\(null\); setIsAbandoning\(true\); \}\}/);
    assert.match(flat(abandon), /<ReasonPromptDialog isOpen=\{isAbandoning\}/);
    assert.match(flat(abandon), /onConfirm=\{handleAbandonConfirm\}/);
  });

  test("🔴 **사유를 받는다** — 이 저장소의 사유 창을 그대로 쓴다", () => {
    // 나중에 「잘못 불러와서 치운 것」과 「수리가 취소돼 멈춘 것」을 가를 수단이
    // 그 글자뿐이다. 창은 건너뛰기·차단·재개가 쓰는 바로 그것이다.
    assert.match(abandon, /import ReasonPromptDialog from "\.\/ReasonPromptDialog"/);
    assert.match(flat(abandon), /abandonProcedureExecutionAction\(\{ executionId, expectedVersion: executionVersion, reason, \}\)/);
  });

  test("무엇이 일어나는지 창에 적는다 — 기록은 남지만 화면에서는 사라진다", () => {
    assert.match(flat(abandon), /warningNote="[^"]*지나온 기록은 지워지지 않지만[^"]*"/);
  });

  test("🔴 **expectedVersion 은 받은 그대로** 넘긴다 — 줄마다 제 version 이다", () => {
    // 줄이 여럿일 때 한 값을 돌려 쓰면 남의 실행을 치우려 드는 호출이 된다.
    // 이 컴포넌트가 제 손으로 version 을 만들거나 고르지 않는다.
    assert.match(flat(abandon), /expectedVersion: executionVersion/);
    assert.ok(!/version \+ 1|version - 1|\.version\b/.test(abandon), "버전을 손보면 낙관적 잠금이 뜻을 잃는다");
  });

  test("🔵 **누가 누를 수 있는가는 여기서 안 가른다** — 받는 쪽이 정한다", () => {
    // 상자와 줄이 적는 말이 서로 달라서(상자는 끝내기까지 함께 말한다) 이쪽으로
    // 끌고 오면 한쪽이 거짓말을 하게 된다.
    assert.ok(!/eligible/.test(abandon), "권한 판정이 두 자리에 생기면 한쪽만 고치는 날이 온다");
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
  // 🔵 2026-11-02(조각 8)에 뒤쪽 반 마디가 바뀌었다 — 전에는 「지나온 길이
  // 남습니다」였다. 그 이름의 묶음이 「실행 이력」 안으로 들어가 화면에서
  // 사라졌으므로, 사람이 찾아갈 수 있는 지금 있는 이름으로 적는다.
  const FINISH_HINT = "이 절차를 다 했다고 기록합니다 — 지나온 기록은 [실행 이력]에 남습니다.";
  const ABANDON_HINT = "잘못 불러왔거나 이 절차를 안 쓰게 됐을 때 — 이 건에서 치웁니다.";

  const flatAbandon = flat(abandon);

  /**
   * 그 단추 하나만 잘라 본다 — 다른 단추의 title 을 보고 통과하지 않게.
   * 🔵 둘이 **서로 다른 파일**에 있으므로(조각 8 보완) 어느 글자에서 자를지도
   * 함께 받는다.
   */
  function buttonBlock(source: string, marker: string): string {
    const at = source.indexOf(marker);
    assert.ok(at >= 0, `${marker} 단추를 못 찾았다`);
    return source.slice(at, source.indexOf("</button>", at));
  }

  test("🔵 먼저 — 글자 둘이 소스에 그대로 있다", () => {
    assert.ok(actions.includes(FINISH_HINT), "끝내기 글자가 바뀌었으면 아래가 뜻을 잃는다");
    assert.ok(abandon.includes(ABANDON_HINT), "그만두기 글자가 바뀌었으면 아래가 뜻을 잃는다");
  });

  test("[절차 끝내기] 단추에 **남기는 것**이라고 적혀 있다", () => {
    assert.match(buttonBlock(flatActions, "data-execution-finish"), /title=\{FINISH_HINT\}/);
  });

  test("[실행 그만두기] 단추에 **치우는 것**이라고 적혀 있다", () => {
    assert.match(buttonBlock(flatAbandon, "data-execution-abandon"), /title=\{ABANDON_HINT\}/);
  });

  test("🔴 **평소에는 화면에 안 뜬다** — 글자가 나오는 자리가 선언 한 곳뿐이다", () => {
    // title 은 값으로만 넘기므로, 글자 자체가 소스에 나오는 자리는 상수 선언
    // 하나다. 늘 보이는 줄로 되돌아오면(JSX 본문에 다시 적으면) 여기서 걸린다.
    for (const [source, hint] of [
      [actions, FINISH_HINT],
      [abandon, ABANDON_HINT],
    ] as const) {
      assert.equal(
        source.split(hint).length - 1,
        1,
        `「${hint}」 가 소스에 두 번 이상 나온다 — 늘 보이는 줄이 되살아났는지 보라`
      );
    }
    // 보이는 글자로 그리는 모양(>글자<)이 아니어야 한다.
    assert.ok(!flatActions.includes(`> ${FINISH_HINT} <`) && !flatAbandon.includes(`> ${ABANDON_HINT} <`));
    assert.ok(!flatActions.includes("data-execution-finish-hint"), "늘 보이던 줄의 표시가 남아 있다");
    assert.ok(!flatAbandon.includes("data-execution-abandon-hint"));
  });

  test("🔴 두 글자가 **서로 다른 말**을 한다 — 같은 말이면 가르는 데 쓸모가 없다", () => {
    assert.ok(FINISH_HINT.includes("기록합니다") && !FINISH_HINT.includes("치웁니다"));
    assert.ok(ABANDON_HINT.includes("치웁니다") && !ABANDON_HINT.includes("기록합니다"));
  });

  test("🔴 이 저장소가 **이미 쓰는 방식**이다 — 직접 만든 말풍선이 아니다", () => {
    // 말풍선을 absolute 로 띄웠다면 바로 아래 「지금 할 일」 큰 카드를 덮는다.
    // sr-only 는 이 저장소에서 창 스크롤을 하나 더 만든 전력이 있다(1px 고장).
    // 🔵 둘로 갈라졌으므로 **둘 다** 본다 — 한쪽만 보면 나머지가 슬그머니 말풍선을
    //    만들어도 안 걸린다.
    for (const [name, source] of [
      ["ExecutionLifecycleActions", actions],
      ["ExecutionAbandonButton", abandon],
    ] as const) {
      assert.ok(!/absolute/.test(source), `${name}: 직접 띄운 말풍선은 아래 카드를 가린다`);
      assert.ok(!/sr-only/.test(source), `${name}: 이 저장소의 sr-only 는 position:absolute 라 문서 바닥에 자리를 주장한다`);
      assert.ok(!/group-hover/.test(source), `${name}: hover 전용 CSS 는 폰에서 첫 탭이 먹히는 수가 있다`);
    }
  });

  test("⚠️ 폰에는 올려 두기가 없다 — **창 안의 설명은 그대로** 남아 서로를 가리킨다", () => {
    assert.match(flatActions, /잘못 불러온 절차를 <span className="font-medium">치우려는<\/span> 것이라면 \[실행 그만두기\]입니다\./);
    assert.match(flatAbandon, /warningNote="[^"]*다 한 절차를 마무리하려는 것이라면 \[절차 끝내기\]입니다\./);
  });
});

/**
 * 🔴 2026-11-02(조각 9) — 마친 실행을 **다시 잇는** 단추.
 *
 * 조각 8 에서 마친 실행이 큰 카드에서 내려오면서, **남은 작업이 있는데 마친
 * 실행**을 다시 이을 길이 화면에서 통째로 사라졌다. 그때 남은 단추가 [실행
 * 그만두기] 하나였는데 그것은 **치우는 것**이지 잇는 것이 아니다.
 *
 * 서버가 정말 completed_at 을 비우는지·노드를 안 건드리는지는 db 목록의
 * procedure-case-execution.integration.test.ts(65~70번)가, 어느 줄에 붙는지는
 * unit 목록의 procedure-execution-past-runs.test.ts 가 잰다.
 */
describe("㉤ 마친 절차를 다시 잇는 길이 생겼다", () => {
  const flatResume = flat(resume);
  const RESUME_HINT = "마쳤다는 표시만 지웁니다 — 지나온 기록과 남은 작업은 그대로라, 마칠 때 하던 작업부터 다시 이어집니다.";

  test("단추 글자는 「절차 다시 잇기」다", () => {
    assert.match(resume, /절차 다시 잇기/);
    assert.match(flatResume, /data-execution-resume/);
    // 🔵 「재개」를 안 쓴다 — 노드 하나를 되돌리는 [재개(되돌림)]가 같은 화면에
    //    이미 있어서, 같은 낱말이면 둘이 같은 일로 읽힌다.
    assert.ok(!/재개/.test(resume), "노드 단추와 같은 낱말을 쓰면 둘이 섞인다");
  });

  test("🔴 **확인 창이 없다** — 짝인 [실행 그만두기]와 다른 점이 그것이다", () => {
    // 그만두기는 되돌릴 수 없어 사유 창을 거치지만, 다시 잇기는 그 자리에서
    // [절차 끝내기]를 다시 누르면 누르기 전과 같아진다. 되돌릴 수 있는 일에 창을
    // 세우면 매번 두 번 누르게 될 뿐이다.
    assert.ok(!/ReasonPromptDialog|<dialog|showModal/.test(resume), "되돌릴 수 있는 일에 창을 세우지 않는다");
    assert.match(flatResume, /resumeProcedureExecutionAction\(\{ executionId, expectedVersion: executionVersion \}\)/);
    // 🔵 사유도 안 받는다 — 끝내기가 사유를 안 받는 것과 같은 잣대다.
    assert.ok(!/reason/.test(resume), "사유를 받으면 매번 「재개」 같은 빈말을 적게 된다");
  });

  test("🔴 두 번 누르기를 막는다 — 둘째 호출은 CONFLICT 로 거짓말을 한다", () => {
    // 첫 호출이 성공하면 version 이 오르므로 둘째는 서버가 「다른 사용자가 먼저
    // 변경했습니다」로 거절하는데, 혼자 두 번 누른 사람에게 그 글자는 거짓이다.
    assert.match(flatResume, /if \(isSubmitting\) return;/);
    assert.match(flatResume, /disabled=\{isSubmitting\}/);
  });

  test("🔴 **expectedVersion 은 받은 그대로** 넘긴다 — 줄마다 제 version 이다", () => {
    assert.match(flatResume, /expectedVersion: executionVersion/);
    assert.ok(!/version \+ 1|version - 1|\.version\b/.test(resume), "버전을 손보면 낙관적 잠금이 뜻을 잃는다");
  });

  test("🔵 **누가 누를 수 있는가는 여기서 안 가른다** — 받는 쪽이 정한다", () => {
    assert.ok(!/eligible/.test(resume), "권한 판정이 두 자리에 생기면 한쪽만 고치는 날이 온다");
  });

  test("🔴 뜻이 **올려 두면 뜨는 글자**(title)에 있다 — 조각 5 의 두 단추와 같은 방식", () => {
    assert.ok(resume.includes(RESUME_HINT), "글자가 바뀌었으면 아래가 뜻을 잃는다");
    const at = flatResume.indexOf("data-execution-resume");
    assert.ok(at >= 0, "단추를 못 찾았다");
    assert.match(flatResume.slice(at, flatResume.indexOf("</button>", at)), /title=\{RESUME_HINT\}/);
    // 평소에는 안 뜬다 — 글자가 소스에 나오는 자리가 선언 하나뿐이다.
    assert.equal(resume.split(RESUME_HINT).length - 1, 1, "늘 보이는 줄이 되살아났는지 보라");
    assert.ok(!/absolute|sr-only|group-hover/.test(resume), "직접 띄운 말풍선은 아래 줄을 가린다");
  });

  test("🔴 세 글자가 **서로 다른 말**을 한다 — 치운다 · 기록한다 · 그대로 둔다", () => {
    // 한 화면에 셋이 함께 서므로(요약 상자의 둘, 줄의 둘) 글자가 겹치면 가르는 데
    // 쓸모가 없다. 사람이 가장 궁금해하는 「지금까지 한 것이 날아가나」의 답이
    // 이 글자에 있다.
    assert.ok(RESUME_HINT.includes("그대로") && !RESUME_HINT.includes("치웁니다"));
    assert.ok(!RESUME_HINT.includes("기록합니다"), "[절차 끝내기]와 같은 말을 하면 안 된다");
  });

  test("⚠️ 폰에는 올려 두기가 없다 — 누른 **뒤**에 같은 사실을 한 번 더 말한다", () => {
    // 🔴 「위에서 이어서 하세요」라고는 **안 적는다** — 같은 건에 더 나중에 시작한
    //    실행이 돌고 있으면 큰 카드는 그쪽이고, 그때 그 글자는 거짓이 된다.
    assert.match(flatResume, /showSavePopup\(\{ message: "절차를 다시 이었습니다\. 마칠 때 하던 작업부터 이어서 하면 됩니다\.", redirectTo: null \}\)/);
    assert.ok(!/맨 위|위에서/.test(resume), "큰 카드에 선다고 단정하면 다른 실행이 돌 때 거짓이 된다");
  });

  test("🔴 다시 이은 뒤 화면을 **다시 읽는다** — 안 읽으면 줄이 옛 배지 그대로다", () => {
    assert.match(flatResume, /router\.refresh\(\);/);
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
    // 🔵 2026-11-02(조각 10): 끝 표지가 바뀌었다. 「전체 단계 보기」 묶음이
    //    팝업으로 옮겨 가면서 `{fold.remaining &&` 이 사라지고, 그 자리에
    //    차단됨 구역의 `{fold.remaining?.note &&` 가 섰다. 🔴 표지를 안 고치면
    //    indexOf 가 -1 이 되어 **화면 끝까지**를 자르고도 조용히 통과한다.
    const endAt = flatScreen.indexOf("{fold.remaining?.note &&");
    assert.ok(endAt > 0, "차단됨 구역을 못 찾았다 — 자르는 자리가 없으면 아래가 아무것도 안 잰다");
    const between = flatScreen.slice(flatScreen.indexOf("<ExecutionFlowStrip"), endAt);
    assert.ok(between.length > 0, "큰 카드 자리를 못 찾았다");
    assert.ok(!between.includes("completedAt"), "이 자리에서 completedAt 을 또 보면 판정이 두 벌이 된다");
  });

  test("안내 카드의 prop 타입에서 EXECUTION_FINISHED 가 **빠져 있다** — 컴파일러가 막는다", () => {
    assert.match(flatScreen, /reason: Exclude<NoCurrentTaskReason, "EXECUTION_FINISHED">/);
  });

  test("🔵 **그림은** 함께 물러난다 — 따로 숨기지 않아도 된다", () => {
    // 띠는 「지금 할 일」을 받아 그린다. 마치면 그것이 null 이 되고, 도메인이
    // HIDDEN 을 돌려준다. 셋이 한 사슬이라 화면에 조건을 더 붙이지 않았다 —
    // 그 사슬을 여기서 못 박는다.
    //
    // 🔴 2026-11-02(조각 10)에 **물러나는 것이 그림뿐**이 됐다. 상자 머리줄의
    // 단추 둘([전체 단계 보기]·[추가 작업 등록])은 남는다 — 흐름이 안 그려질
    // 때야말로 전체를 보고 자리를 옮길 길이 필요하기 때문이다. 단추를 안 넘긴
    // 호출부에서는 전과 같이 **통째로** 안 그린다.
    assert.match(flatScreen, /current: currentTask\.kind === "NONE" \? null : currentTask\.node,/);
    const strip = stripComments(read("src/components/procedures/execution/ExecutionFlowStrip.tsx"));
    const flatStrip = flat(strip);
    assert.match(flatStrip, /if \(minimap\.kind === "HIDDEN"\) \{ if \(!actions\) return null;/);
    assert.ok(
      !/<FlowChip|<CurrentColumn|<FlowLevel/.test(flatStrip.slice(flatStrip.indexOf('minimap.kind === "HIDDEN"'), flatStrip.indexOf('minimap.kind === "NOTE"'))),
      "HIDDEN 가지가 칸을 그리면 「그림은 물러난다」가 깨진다"
    );
    const minimapSource = stripComments(read("src/lib/domain/procedure-execution-minimap.ts"));
    assert.match(minimapSource, /if \(!input\.current\) return \{ kind: "HIDDEN", reason: "NO_CURRENT_TASK" \};/);
  });

  test("🔴 마친 실행에서는 **옮기기 단추가 까닭과 함께 흐려진다** — 눌리는데 반드시 실패하는 단추를 안 만든다", () => {
    // 서버가 ALREADY_FINISHED 로 거절하므로(jumpToExecutionNode), 화면이 안
    // 가리면 누를 수는 있는데 언제나 실패하는 단추가 된다.
    assert.match(flatScreen, /isExecutionFinished=\{isExecutionFinished\}/);
    const jump = stripComments(read("src/lib/domain/procedure-execution-jump.ts"));
    assert.match(flat(jump), /if \(input\.isExecutionFinished\) \{ return \{ label: JUMP_BUTTON_LABEL, disabled: true,/);
  });

  test("「실행 이력」(지나온 길을 품은)은 마친 뒤에도 그려진다 — 조건이 안 붙어 있다", () => {
    // 「담을 것이 있는가」(null 여부)만 보고, 마쳤는지는 안 본다.
    // 🔵 조각 8 에서 「지나온 길」 묶음이 이 안으로 들어왔다 — 묶음이 하나로
    //    줄었을 뿐, 마친 뒤에도 그려진다는 규칙은 그대로다.
    assert.match(flatScreen, /\{historyFold && \( <ExecutionFoldSection group=\{historyFold\.fold\}>/);
    assert.ok(!flatScreen.includes("group={fold.done}"), "「지나온 길」 묶음이 되살아났다");
  });
});

describe("㉡ 실행을 끝낼 길이 생겼다", () => {
  test("단추 글자는 「절차 끝내기」이고, **마친 실행에는 이 묶음이 아예 안 선다**", () => {
    assert.match(actions, /절차 끝내기/);
    // 🔴 2026-11-02(조각 8)에 **적는 자리가 옮겨 갔다.** 전에는 이 묶음이 끝낸 뒤
    //    「절차를 마쳤습니다」를 제 상자에 적었다. 지금은 마친 실행이 「이 건의
    //    다른 절차」의 한 줄로 내려가고, 그 줄이 배지(완주 · 중단 마침)와 마친
    //    시각으로 같은 말을 한다 — 두 번 적지 않는다(사용자 결정).
    //    시험을 지우지 않고 **반대를 재도록** 고친다.
    //    🔵 그 말이 소스에 남는 자리는 **누른 직후의 저장 팝업** 하나다 — 그것은
    //    화면에 머무는 글이 아니라 0.5초 뒤 저절로 닫히는 알림이라 겹치지 않는다.
    assert.equal(
      flat(actions).split("절차를 마쳤습니다").length - 1,
      1,
      "같은 말이 화면 글로도 남아 있으면 내려간 줄과 두 번 쌓인다"
    );
    assert.match(flat(actions), /showSavePopup\(\{ message: "절차를 마쳤습니다\.", redirectTo: null \}\)/);
    assert.ok(!flat(actions).includes("data-execution-finished"), "옛 자리의 표시가 남아 있다");
    // 🔴 이 묶음은 **도는 실행에서만** 선다(placement.slot === "TOP"). 그래서
    //    completedAt 을 아예 안 받는다 — 닿지 않는 가지를 남기지 않는다
    //    (NoCurrentTaskCard 가 EXECUTION_FINISHED 를 타입에서 뺀 것과 같은 규약).
    assert.ok(!/completedAt/.test(actions), "안 쓰는 prop 을 남기면 다음 사람이 그것으로 뭔가를 되살린다");
    assert.match(flat(actions), /<button type="button" data-execution-finish/);
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

  test("🔴 단추 묶음이 **진행 요약 상자 안**에 있다 — 따로 선 상자가 없다", () => {
    // 2026-11-02 사용자 결정(조각 8): 「이 두 내용이 서로 다른 박스로 있을 필요
    // 없을 것 같은데? [절차 끝내기], [실행 그만두기]도 진행바가 있는 박스 안에
    // 포함시켜줘.」 전에는 요약 상자 **바로 아래**에 제 테두리를 두른 상자가 따로
    // 섰고, 절차 이름을 두 상자가 한 번씩 적고 있었다.
    const source = flat(screen);
    const summaryFrom = source.indexOf("function ProgressSummary");
    const summaryTo = source.indexOf("function NodeSection");
    assert.ok(summaryFrom >= 0 && summaryTo > summaryFrom, "요약 상자를 못 찾았다 — 이름이 바뀌었나");
    const summaryBody = source.slice(summaryFrom, summaryTo);
    assert.ok(summaryBody.includes("<ExecutionLifecycleActions"), "단추 묶음이 요약 상자 밖에 있다");

    // 🔴 상자 안의 차례 — 진행바와 수치가 **먼저**, 단추가 **나중**이다. 단추가
    //    위에 있으면 지금 눌러야 할 것처럼 보인다.
    // 🔵 2026-11-02(조각 11)에 이름이 donePct → progressPct 로 바뀌었다. 재던 것은
    //    「끝낸 비율」이었는데 이제는 **경로상 자리**라, 옛 이름을 그대로 두면 글자가
    //    하는 일과 어긋난다(이 저장소가 주석·이름에 걸려 넘어진 자리다).
    const barAt = summaryBody.indexOf('style={{ width: `${progressPct}%` }}');
    const countsAt = summaryBody.indexOf("<span>차단됨 {blocked}</span>");
    const buttonsAt = summaryBody.indexOf("<ExecutionLifecycleActions");
    assert.ok(barAt >= 0 && countsAt >= 0, "진행바나 수치 줄을 못 찾았다");
    assert.ok(barAt < buttonsAt && countsAt < buttonsAt, "단추가 진행바·수치보다 위로 올라갔다");
  });

  test("🔴 단추 묶음은 **제 테두리를 안 두른다** — 담는 상자가 이미 있다", () => {
    const root = flat(actions).slice(flat(actions).indexOf("<div data-execution-lifecycle"));
    const openTag = root.slice(0, root.indexOf(">"));
    assert.ok(!/rounded-lg/.test(openTag) && !/bg-white/.test(openTag), `상자가 되살아났다: ${openTag}`);
    assert.ok(/border-t/.test(openTag), "윗줄과 가르는 선 하나는 있어야 단추가 수치에 붙어 보이지 않는다");
    assert.ok(!flat(actions).includes("<section data-execution-lifecycle"), "옛 상자 태그가 남아 있다");
  });

  test("🔴 절차 이름을 **두 번 안 적는다** — 상자가 맨 위에서 이미 적고 있다", () => {
    // 전에는 이 묶음이 제 상자 안에 <p>{templateName}</p> 를 또 그렸다.
    assert.ok(!/>\{templateName\}</.test(flat(actions)), "이름이 한 화면에 두 번 뜬다");
    // 창 제목에는 그대로 쓴다 — 무엇을 그만두는지 창에서 다시 말해야 한다.
    // 🔴 줄마다 단추가 붙은 뒤로는 이것이 **어느 줄의 것인지** 가리는 마지막
    //    방벽이기도 하다(열고 나서 절차 이름이 보인다).
    assert.match(flat(abandon), /title=\{`실행 그만두기: \$\{templateName\}`\}/);
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
    // 🔵 2026-11-02(조각 10)에 구역이 **넷에서 둘로** 줄었다(사용자 결정 —
    //    「전체 단계 보기」가 팝업이 됐다). 「실행 가능」·「진행 중」 카드가 하던
    //    일은 맨 위 큰 카드와 팝업이 나눠 맡는다. 🔴 지우지 않고 **남는 둘을
    //    못 박도록** 고친다 — 둘 중 하나라도 사라지면 여기서 걸린다.
    for (const title of ["차단됨", "완료 / 건너뜀"]) {
      assert.ok(screen.includes(`title="${title}"`), `${title} 구역이 사라지면 안 된다`);
    }
    // 🔴 걷힌 둘이 **몰래 돌아오지 않는지**도 함께 본다 — 돌아오면 팝업과 목록이
    //    같은 일을 두 자리에서 하게 된다.
    for (const title of ["실행 가능", "진행 중"]) {
      assert.ok(!screen.includes(`title="${title}"`), `${title} 구역이 되살아났다 — 그 자리는 팝업이다`);
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

/**
 * 🔴 2026-11-02(조각 8) — 사용자 결정 「절차가 마쳐진 경우 진행바 상자가
 * [이 건의 다른 절차]에 속하게 해줘.」
 *
 * 여기서 잡아야 하는 고장은 둘이고, 둘 다 오류가 한 번도 안 나고 **화면에서만**
 * 드러난다: 같은 절차가 한 화면에 두 번 뜨거나, 마친 절차가 어디에도 안 뜨거나.
 */
describe("㉣ 마친 실행은 위에 안 서고 「이 건의 다른 절차」로 내려간다", () => {
  const flatScreen = flat(screen);
  const flatPage = flat(page);

  test("🔵 먼저 — 자리를 정하는 도메인 함수가 **두 답**을 낸다", () => {
    // 늘 같은 답이면 아래의 「화면이 그 답을 따른다」가 아무것도 안 잰다.
    assert.equal(placeExecutionSummary({ executionId: "x", isExecutionFinished: false }).slot, "TOP");
    assert.equal(placeExecutionSummary({ executionId: "x", isExecutionFinished: true }).slot, "OTHER_RUNS");
  });

  test("🔴 요약 상자가 **그 답을 따라** 선다 — completedAt 으로 다시 가르지 않는다", () => {
    assert.match(
      flatScreen,
      /const placement = placeExecutionSummary\(\{ executionId: executionDetail\.executionId, isExecutionFinished \}\);/
    );
    // 🔵 2026-11-02(조각 11)에 프롭이 하나 늘었다(currentTaskNodeId — 진행률을
    //    「지금 할 일」을 경유하는 경로로 세기 때문이다). 재는 것은 그대로다 —
    //    **자리 판정이 상자를 가린다**는 것. 프롭 목록까지 글자로 못 박으면
    //    프롭이 늘 때마다 이 단언이 깨지면서 정작 재려던 것은 안 재게 된다.
    assert.match(flatScreen, /\{placement\.slot === "TOP" && \( <ProgressSummary /);
    assert.match(flatScreen, /<ProgressSummary [^>]*detail=\{executionDetail\}/);
    assert.match(flatScreen, /<ProgressSummary [^>]*currentTaskNodeId=\{currentTaskNodeId\}/);
  });

  test("🔴 페이지의 **빼기**도 같은 함수가 정한다 — 두 벌로 갈라져 있지 않다", () => {
    // 전에는 `activeExecution?.id ?? null` 이었다. 마친 실행까지 빼 버리면 상자도
    // 안 서고 줄도 없어서 그 절차가 화면 어디에도 안 뜬다.
    assert.match(
      flatPage,
      /const summaryPlacement = placeExecutionSummary\( activeExecution \? \{ executionId: activeExecution\.id, isExecutionFinished: activeExecution\.completedAt !== null \} : null \);/
    );
    assert.match(
      flatPage,
      /getOtherExecutionsForCase\(resolved\.id, summaryPlacement\.excludedFromOtherRuns\)/
    );
    assert.ok(
      !flatPage.includes("getOtherExecutionsForCase(resolved.id, activeExecution?.id ?? null)"),
      "옛 빼기(언제나 뺀다)가 남아 있으면 마친 절차가 화면에서 사라진다"
    );
  });

  test("🔴 [실행 그만두기]가 **줄마다** 붙는다 — 그 줄을 치우는 길이다", () => {
    // 🔴 2026-11-02 사용자 지적 — 「[실행 그만두기]가 [중단 마침]인 해당 건에
    //    대한 것인지 모든 [중단 마침]에 대한 것인지 모르겠어. 건별로 있도록
    //    해주고.」 처음 판은 **내려온 한 줄에만** 붙여서 그 모호함이 남았다.
    // 🔵 조각 9 에서 줄에 붙는 것이 둘이 되면서, 단추마다 **제 까닭으로** 가린다.
    assert.match(flatScreen, /renderRowAction=\{\(row\) => ordinaryActionEligible \? \( <>/);
    assert.match(flatScreen, /\{row\.abandonBlockedReason === null && \( <ExecutionAbandonButton/);
    // 🔴 줄의 재료를 그대로 쥐어 준다 — 큰 카드 쪽 값을 돌려 쓰면 남의 실행을
    //    치우려 드는 호출이 된다.
    assert.match(flatScreen, /executionId=\{row\.executionId\} executionVersion=\{row\.version\} templateName=\{row\.title\}/);
    assert.ok(
      !/renderRowAction=\{\(row\) =>[^}]*executionDetail\./.test(flatScreen),
      "줄 단추가 화면에 선 실행의 값을 쓰면 아무 줄이나 그 실행을 치운다"
    );
  });

  test("🔴 [절차 다시 잇기]는 **제 까닭**으로 가린다 — 그만두기 답을 돌려 쓰지 않는다", () => {
    // 🔴 둘은 붙는 줄이 다르다(다시 잇기는 중단 마침 하나, 그만두기는 거기에
    //    진행 중까지). 한 답을 돌려 쓰면 **도는 줄에 [절차 다시 잇기]가 뜨고**,
    //    눌러도 서버가 거절만 하는 단추가 된다 — 사람 눈에는 「아무 일도 안
    //    일어난다」로 보인다.
    assert.match(flatScreen, /\{row\.resumeBlockedReason === null && \( <ExecutionResumeButton executionId=\{row\.executionId\} executionVersion=\{row\.version\} \/> \)\}/);
    // 🔵 차례는 **잇기가 먼저**다 — 되돌릴 수 없는 쪽(그만두기)을 오른쪽 끝에 두면
    //    잘못 누를 일이 준다. 요약 상자의 [절차 끝내기] → [실행 그만두기] 와 같은 잣대.
    assert.ok(
      flatScreen.indexOf("<ExecutionResumeButton") < flatScreen.indexOf("<ExecutionAbandonButton"),
      "되돌릴 수 없는 단추가 앞에 서면 잘못 누르기 쉬워진다"
    );
  });

  test("🔴 못 누르는 사람에게는 **까닭**이 그 자리에 뜬다 — 조용히 비우지 않는다", () => {
    // 🔵 조각 9 에서 글자가 늘었다 — 그 자리에서 막히는 일이 둘이 됐으므로
    //    「그만둘 수 있습니다」만 적으면 다시 잇기가 왜 없는지를 아무도 안 알려 준다.
    assert.match(
      flatScreen,
      /\) : \( <p className="text-xs text-zinc-500 dark:text-zinc-400"> 담당 엔지니어 또는 관리자만 절차를 다시 잇거나 그만둘 수 있습니다\. <\/p> \)/
    );
  });

  test("🔴 단추 묶음은 **요약 상자 안 하나**뿐이다 — 줄에는 끝내기가 안 간다", () => {
    assert.equal(
      (flatScreen.match(/<ExecutionLifecycleActions/g) ?? []).length,
      1,
      "줄에까지 끝내기를 달면 보고 있지도 않은 절차를 끝내는 길이 생긴다"
    );
    assert.equal((flatScreen.match(/<ExecutionAbandonButton/g) ?? []).length, 1, "줄 쪽 단추를 만드는 자리는 한 곳이다");
    assert.equal((flatScreen.match(/<ExecutionResumeButton/g) ?? []).length, 1, "줄 쪽 단추를 만드는 자리는 한 곳이다");
  });

  test("🔴 마친 실행이 **두 번 안 뜬다** — 위에 안 서고 줄에만 뜬다", () => {
    // 상자를 그리는 자리가 한 곳뿐이고 그 앞에 placement 가 붙어 있다.
    assert.equal((flatScreen.match(/<ProgressSummary /g) ?? []).length, 1);
    const at = flatScreen.indexOf("<ProgressSummary ");
    assert.ok(flatScreen.slice(at - 60, at).includes('placement.slot === "TOP"'), "자리 판정 없이 상자가 선다");
    // 아래 줄 쪽은 조회가 빼고 말고로 갈린다 — 그 답이 위와 한 몸임은
    // procedure-execution-summary-placement.test.ts 가 불변식으로 못 박는다.
    assert.equal(placeExecutionSummary({ executionId: "x", isExecutionFinished: true }).excludedFromOtherRuns, null);
    assert.equal(placeExecutionSummary({ executionId: "x", isExecutionFinished: false }).excludedFromOtherRuns, "x");
  });
});
