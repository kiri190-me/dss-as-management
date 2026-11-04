import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * [종료]에서 **다음 절차로 넘어가는 순간** (2026-11-04, 줄기 B ④ 조각 ④)
 * ============================================================================
 * 사용자 결정(2026-11-04): 「넘어가는 순간 한번 물어보도록 해줘」 ·
 * 「안 끝난 채로 두자」. 이 파일이 지키는 것은 **그 두 결정**이다.
 *
 * 🔴 결정이 뒤집히면 여기가 먼저 깨져서 알려 줘야 한다. 통과하는 시험 이름에
 * 틀린 설계가 적혀 있는 일을 막으려면 이름이 아니라 **글자**가 결정을 재야 한다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * CurrentTaskCard 는 서버 액션을 직접 import 하는 클라이언트 컴포넌트라 사슬
 * 끝에 `server-only` 가 있다 — 어느 목록에서도 import 자체가 던진다. 이웃
 * procedure-editor-confirm-dialogs.test.ts 가 같은 사정에서 쓴 방법 그대로다.
 *
 * 🔴 **주석을 걷어내고 센다.** 이 조각도 까닭을 그 자리 주석에 길게 적었고,
 * 거기에 재려는 글자가 그대로 들어 있다. ①절 첫 단언이 걷어내기가 일하고
 * 있다는 증거다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

const flat = (source: string) => source.replace(/\s+/g, " ");

const cardRaw = read("src/components/procedures/execution/CurrentTaskCard.tsx");
const dialogRaw = read("src/components/procedures/execution/NextProcedureConfirmDialog.tsx");
const actionsRaw = read("src/lib/server/actions/procedure-case-execution.ts");
const card = flat(stripComments(cardRaw));
const dialog = flat(stripComments(dialogRaw));
const actions = flat(stripComments(actionsRaw));

describe("이어가기 — ① 넘어가는 순간 한 번 묻는다 (사용자 결정)", () => {
  test("🔵 먼저 표본 — 주석 걷어내기가 실제로 일을 한다", () => {
    assert.ok(flat(cardRaw).includes("되돌릴 수 있으면 묻지 않는다"), "표본이 되려면 그 글이 주석에 있어야 한다");
    assert.ok(!card.includes("되돌릴 수 있으면 묻지 않는다"), "걷어내기가 일을 안 하고 있다");
  });

  test("🔴 [완료]가 **바로 완료하지 않고** 창을 연다 — 이어갈 절차가 있을 때만", () => {
    assert.ok(
      card.includes("onClick={canStartNextProcedure ? () => setNextProcedureDialogOpen(true) : handleComplete}"),
      "창을 안 거치면 사용자 결정(한 번 묻기)이 깨진다"
    );
  });

  test("🔴 지정이 없으면 전과 똑같이 바로 완료한다 — 멀쩡한 절차에 창이 끼어들지 않는다", () => {
    assert.ok(card.includes("const canStartNextProcedure = node.nextProcedure?.ok === true;"));
    assert.ok(card.includes(": handleComplete}"), "지정이 없는 쪽은 예전 길 그대로여야 한다");
  });

  test("🔴 창에 길이 **셋**이다 — [취소]만 두면 「완료는 하고 싶다」가 갈 곳이 없다", () => {
    assert.ok(dialog.includes("완료하고 이어서 시작"));
    assert.ok(dialog.includes("완료만 하기"));
    assert.ok(dialog.includes("취소 </button>"), "창을 닫는 길이 없으면 갇힌다");
  });
});

describe("이어가기 — ② 지금 절차는 안 끝난 채로 둔다 (사용자 결정)", () => {
  test("🔴 창이 **끝나지 않는다고 글로 적는다** — 안 적으면 「완료」를 절차 종료로 읽는다", () => {
    assert.ok(dialog.includes("지금 절차는"));
    assert.ok(dialog.includes("끝나지 않습니다"));
  });

  test("🔴 통로가 **끝내기를 부르지 않는다** — 이 한 줄이 그 결정의 전부다", () => {
    const body = actions.slice(actions.indexOf("export async function completeAndStartNextProcedureAction"));
    assert.ok(
      !body.includes("finishProcedureExecution("),
      "끝내기를 부르면 「안 끝난 채로 두자」가 조용히 뒤집힌다"
    );
  });
});

describe("이어가기 — ③ 「안 가리킴」과 「못 엶」을 가른다", () => {
  test("🔴 못 여는 까닭을 **글로 보인다** — 조용하면 원래 없는 기능으로 읽힌다", () => {
    assert.ok(card.includes("const nextProcedureBlockedReason = node.nextProcedure?.ok === false ? node.nextProcedure.reason : null;"));
    assert.ok(card.includes("이어갈 절차가 지정되어 있지만 지금은 열 수 없습니다"));
  });

  test("🔵 지정이 아예 없으면 그 줄도 안 뜬다", () => {
    assert.ok(card.includes("{nextProcedureBlockedReason && ("), "null 일 때 그려지면 모든 END 에 노란 줄이 뜬다");
  });
});

describe("이어가기 — ④ 「무엇까지 됐는지」를 말한다", () => {
  test("🔴 결과가 셋이다 — 완료도 안 됨 · 완료는 됨 · 다 됨", () => {
    assert.ok(actions.includes("ok: false; completed: true; message: string"));
    assert.ok(actions.includes("ok: false; completed: false; message: string"));
    assert.ok(actions.includes("ok: true; startedExecutionId: string"));
  });

  test("🔴 완료만 된 경우 화면이 **다시 읽는다** — 안 읽으면 사람이 [완료]를 또 누른다", () => {
    assert.ok(card.includes("if (result.completed) {"));
    const branch = card.slice(card.indexOf("if (result.completed) {"));
    assert.ok(branch.slice(0, 200).includes("router.refresh()"));
  });

  test("🔴 **시작할 곳을 먼저 푼다** — 완료부터 하면 이어갈 곳이 없을 때 완료만 일어난다", () => {
    const body = actions.slice(
      actions.indexOf("export async function completeAndStartNextProcedureAction"),
      actions.indexOf("export async function startNextProcedureAction")
    );
    const resolveAt = body.indexOf("resolveNextProcedureForExecutionNode(");
    const completeAt = body.indexOf("completeExecutionNode({");
    assert.ok(resolveAt > -1 && completeAt > -1);
    assert.ok(resolveAt < completeAt, "차례가 뒤집히면 「이어서 시작」을 눌렀는데 완료만 되는 날이 온다");
  });

  test("🔴 화면이 보낸 절차 id 를 **안 쓴다** — 보내는 쪽이 고칠 수 있는 값이다", () => {
    const body = actions.slice(
      actions.indexOf("export async function completeAndStartNextProcedureAction"),
      actions.indexOf("export async function startNextProcedureAction")
    );
    assert.ok(!body.includes("input.nextProcedureTemplateId"), "입력에 절차 id 를 받는 순간 남의 절차를 열 수 있다");
    assert.ok(body.includes("target.templateId"), "서버가 제 눈으로 푼 값만 쓴다");
  });
});
