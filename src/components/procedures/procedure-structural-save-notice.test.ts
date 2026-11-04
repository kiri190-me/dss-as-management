import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「기술 작업 절차」 편집기 — 구조 변경이 **저장됐다고 말한다**(2026-11-04, 줄기 B-⑦)
 * ============================================================================
 * ── 왜 이 시험이 있는가 ─────────────────────────────────────────────────
 * 사용자가 신고한 것(원문): "노드, 연결선등을 추가/제거 하기만 했을 때는
 * [저장]이 활성화가 안되더라고, 노드, 연결선에 대해서는 수정된 사항이라고
 * 인식을 안하고 있는 것 같아."
 *
 * 조사해 보니 **인식을 안 한 것이 아니라 이미 저장한 것**이었다. 구조 변경은
 * 그 자리에서 서버로 가고(handleSaved 가 그 성공 통로다), [저장]이 맡은 것은
 * 안 보낸 칸 값·배치뿐이라 목록이 비어 있는 것이 맞다. 문제는 **화면이 그렇게
 * 말하지 않았다**는 것이다 — 남는 글자가 [저장] 단추의 "저장할 변경 없음"
 * 하나뿐이고, 그 문구는 「아직 아무것도 안 건드렸다」와 「방금 저장이 끝났다」를
 * 똑같이 말한다. 삭제는 "사라짐"이 유일한 증거라 가장 약하다.
 *
 * ── 🔴 여기서 가장 조용히 깨질 수 있는 것 ──────────────────────────────
 * ① **globalSaveStatus 에 얹는 것.** 한 줄이면 되지만, "변경사항 N건 저장 대기
 *    중" 안내가 그 값이 idle 일 때만 뜨므로 저장 대기가 있는 채로 노드를 하나
 *    지우면 그 안내가 2.5초 사라졌다 돌아온다. 고치려던 오해(화면이 저장
 *    상태를 두고 두 말을 한다)를 고친 자리에서 다시 만드는 셈이다.
 * ② **실패했는데 뜨는 것.** 알리는 자리가 ok 검사보다 앞서면 일어나지 않은
 *    저장을 "저장됐다"고 말한다. 각 패널이 제자리에 빨간 글로 알리는 동작은
 *    그대로 두어야 한다.
 * ③ **안 꺼지는 것.** 몇 분 전 저장을 계속 주장하면 다음 변경 때 뜬 것인지
 *    아직 안 꺼진 것인지 구분이 안 된다.
 * 세 가지를 전부 원본 글자로 못 박는다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * ProcedureTemplateEditorScreen 은 @xyflow/react 의 .css 까지 끌고 오고, 서버
 * 액션 파일들은 사슬 끝에 `server-only` 가 있다 — 어느 목록에서도 import 자체가
 * 던진다. 이웃들(procedure-editor-confirm-dialogs.test.ts ·
 * procedure-draft-version-lifecycle.test.ts)이 같은 사정에서 쓴 방법 그대로다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 「왜 그렇게 했는가」를 그 자리 주석에 길게 적고, 이번 변경의
 * 주석에는 **고치기 전의 모습이 글자 그대로** 들어 있다(사용자 신고 원문, 옛
 * 문구). 주석을 안 걷으면 "그 모습은 사라졌는가" 쪽이 영영 깨지고, 반대로
 * "있어야 한다" 쪽은 주석만으로 영영 통과한다. ①절의 마지막 단언이 걷어내기가
 * 실제로 일하고 있다는 증거다.
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

/**
 * 함수 하나의 **몸통**만 떼어 낸다.
 *
 * 🔴 "start 뒤 첫 `{`" 로 잡으면 안 된다. 이 저장소의 서버 함수는 인자를
 * `input: { templateId: string; ... }` 인라인 객체 타입으로 받는 것이 보통이라
 * 그 첫 `{` 는 **몸통이 아니라 인자 타입**이다. 그러면 몸통 대신 인자 선언
 * 몇 줄만 떼어 내게 되고, 거기 없는 것을 "없다"고 읽어 단언이 조용히 거짓이
 * 된다(이 파일을 쓰면서 실제로 그렇게 두 개가 깨졌다 — 이웃
 * procedure-editor-confirm-dialogs.test.ts 의 같은 이름 도우미는 인자가 단순한
 * 화면 함수에만 써서 여태 드러나지 않았다).
 *
 * 그래서 **서명의 괄호가 닫힌 뒤** 처음 나오는 `{` 를 몸통으로 본다.
 */
function functionBody(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);

  let signatureEnd = source.indexOf("(", from);
  assert.notEqual(signatureEnd, -1, `${start} 의 인자 괄호를 못 찾았다`);
  for (let depth = 0; signatureEnd < source.length; signatureEnd += 1) {
    if (source[signatureEnd] === "(") depth += 1;
    else if (source[signatureEnd] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  const open = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  assert.fail(`${start} 의 몸통이 안 닫혔다`);
}

const PATHS = {
  screen: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  trashMutation: "src/lib/db/mutations/procedure-templates.ts",
  trashAction: "src/lib/server/actions/procedure-template-trash.ts",
} as const;

const screen = stripComments(read(PATHS.screen));
const mutation = stripComments(read(PATHS.trashMutation));
const action = stripComments(read(PATHS.trashAction));

describe("구조 변경 저장 알림 — ① 먼저 표본 확인", () => {
  test("🔵 세 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ screen, mutation, action })) {
      assert.ok(source.length > 2000, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(screen.includes("function handleSaved("), "구조 변경의 성공 통로");
    assert.ok(screen.includes("async function handleGlobalSave()"), "[저장] 단추가 쓰는 다른 통로");
    assert.ok(mutation.includes("export async function restoreProcedureTemplate("), "휴지통 복원 mutation");
    assert.ok(action.includes("export async function restoreProcedureTemplatesAction("), "일괄 복원 액션");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 신고 원문과 옛 문구가 남아 있다", () => {
    // 왜 그렇게 고쳤는지를 그 자리 주석에 적어 두었기 때문이다. 이 단언이 깨지면
    // (= 주석에서 그 글자가 사라지면) 아래 단언들이 주석을 안 걷어도 통과하게 되어,
    // 시험이 아무것도 안 재는 상태로 조용히 바뀐다.
    assert.ok(read(PATHS.screen).includes("활성화가 안되더라고"), "신고 원문이 주석에 남아 있어야 한다");
    assert.ok(!screen.includes("활성화가 안되더라고"), "걷어낸 쪽에는 없어야 한다");
    // "저장 완료" 는 날것에서 주석 둘 + 실제 문구 하나로 여러 줄에 나오지만,
    // 걷어낸 뒤에는 **그리는 자리 하나뿐**이어야 한다.
    assert.ok((read(PATHS.screen).match(/저장 완료/g)?.length ?? 0) >= 3);
    assert.equal(screen.match(/저장 완료/g)?.length, 1);
    assert.ok(read(PATHS.trashMutation).includes("이미 진행 중인 초안이 있다"), "복원 주석에 옛 설명이 남아 있어야 한다");
    assert.ok(!mutation.includes("이미 진행 중인 초안이 있다"));
  });
});

describe("구조 변경 저장 알림 — ② 뜬다", () => {
  test("🔴 알리는 자리는 handleSaved **한 곳**이다 — 패널마다 따로 두면 새 패널이 조용히 말을 안 한다", () => {
    const saved = functionBody(screen, "function handleSaved(");
    assert.ok(
      saved.includes("setStructuralSaveNoticeId((id) => id + 1);"),
      "handleSaved 가 아무 말도 안 하면 사용자가 신고한 그 침묵으로 되돌아간다"
    );
    // 화면 전체에서 올리는 자리는 그 하나뿐이다(0 으로 되돌리는 타이머는 따로 센다).
    const raises = screen.match(/setStructuralSaveNoticeId\(\(id\) => id \+ 1\)/g) ?? [];
    assert.equal(raises.length, 1, `올리는 자리가 ${raises.length} 곳이다 — 한 곳이어야 한다`);
  });

  test("🔴 구조 변경 다섯 갈래가 전부 그 통로를 지난다 — 하나라도 빠지면 그 조작만 조용하다", () => {
    // handleStructuralSaved(패널 넷 + 이름 변경 + 이력 복원) · 노드 삭제 ·
    // 연결선 삭제 · [이전] · [앞으로] — 전부 handleSaved 로 모인다.
    assert.ok(functionBody(screen, "function handleStructuralSaved(").includes("handleSaved(newUpdatedAt, structuralValidation);"));
    assert.ok(functionBody(screen, "function handleNodeDeleted(").includes("handleSaved(newUpdatedAt);"));
    assert.ok(functionBody(screen, "function handleEdgeDeleted(").includes("handleSaved(newUpdatedAt);"));
    assert.ok(functionBody(screen, "async function handleUndo()").includes("handleSaved(result.updatedAt);"));
    assert.ok(functionBody(screen, "async function handleRedo()").includes("handleSaved(result.updatedAt);"));
  });

  test("🔴 화면에 **그리는** 자리가 있다 — 올리기만 하고 안 그리면 아무 일도 안 일어난다", () => {
    const flatScreen = flat(screen);
    assert.ok(
      flatScreen.includes('{structuralSaveNoticeId > 0 && ( <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">방금 변경은 바로 저장됐습니다</span> )}'),
      "띄우는 한 줄이 사라졌거나 조건이 바뀌었다"
    );
  });

  test("🔵 문구가 [저장] 단추와 **반대말을 하지 않는다** — 이번 오해의 실체가 그 충돌이었다", () => {
    // 구조 변경 직후 [저장] 단추는 "저장할 변경 없음"이다. 그 옆에 "저장 완료"가
    // 서면 "완료라면서 왜 변경이 없다고 하지"가 된다 — 그래서 **무엇이** 저장됐는지를
    // 말한다. 두 글이 같은 낱말로 갈리지 않는지 글자로 못 박는다.
    assert.ok(screen.includes("저장할 변경 없음"), "[저장] 단추의 문구는 그대로 둔다");
    assert.ok(screen.includes("방금 변경은 바로 저장됐습니다"));
    assert.ok(
      !screen.includes("구조 변경 저장 완료"),
      '"저장 완료"를 다시 쓰면 바로 옆 "저장할 변경 없음"과 같은 낱말로 부딪힌다'
    );
    // 아무 일도 없을 때 서 있는 상시 안내 — 띄우는 표시는 2.5초면 사라지지만
    // 사용자가 막힌 지점은 그 뒤에도 남아 있는 화면이었다.
    assert.ok(
      flat(screen).includes('{!hasAnyPendingChanges && structuralSaveNoticeId === 0 && globalSaveStatus === "idle" && ( <span className="text-xs text-zinc-500 dark:text-zinc-400">노드·연결선 추가·삭제·재연결은 [저장] 없이 바로 저장됩니다</span> )}'),
      "상시 안내가 사라졌다 — [저장]이 무엇을 맡고 무엇을 안 맡는지 말하는 자리가 화면에서 없어진다"
    );
  });
});

describe("구조 변경 저장 알림 — ③ 실패하면 안 뜬다", () => {
  test("🔴 화면 안에서 handleSaved 를 부르는 자리가 전부 ok 검사 **뒤**다", () => {
    const flatScreen = flat(screen);
    const calls = [...flatScreen.matchAll(/handleSaved\(result\./g)];
    assert.ok(calls.length >= 2, `되돌리기 쪽 호출을 ${calls.length} 자리밖에 못 셌다 — 둘 이상이어야 한다`);
    for (const call of calls) {
      const before = flatScreen.slice(Math.max(0, call.index - 400), call.index);
      assert.ok(before.includes("if (!result.ok)"), "실패한 되돌리기를 '저장됐다'고 말하게 된다");
    }
    // 패널에서 들어오는 길(onSaved/onDeleted)의 같은 순서는
    // procedure-editor-confirm-dialogs.test.ts ⑤절이 지킨다 — 거기서 한 번 더 센다.
  });

  test("🔴 아무것도 저장하지 않는 길에서는 안 뜬다 — [취소]와 검증은 서버에 쓰지 않는다", () => {
    assert.ok(!functionBody(screen, "function handleDiscardAllPending()").includes("setStructuralSaveNoticeId"));
    assert.ok(!functionBody(screen, "async function handleValidate()").includes("setStructuralSaveNoticeId"));
  });

  test("🔴 [저장] 단추의 길은 제 신호(globalSaveStatus)를 그대로 쓴다 — 둘이 겹쳐 뜨지 않는다", () => {
    const globalSave = functionBody(screen, "async function handleGlobalSave()");
    assert.ok(globalSave.includes('setGlobalSaveStatus("saved");'), "[저장]의 성공 신호는 전과 같다");
    assert.ok(
      !globalSave.includes("setStructuralSaveNoticeId"),
      "[저장]까지 이 표시를 띄우면 '저장 완료'와 '방금 변경은 바로 저장됐습니다'가 한 줄에 둘 다 선다"
    );
    assert.ok(!globalSave.includes("handleSaved("), "[저장]은 구조 변경 통로를 지나지 않는다 — 지나면 위 단언이 뜻을 잃는다");
  });
});

describe("구조 변경 저장 알림 — ④ 저장 대기 문구가 안 깜빡인다", () => {
  test("🔴 handleSaved 는 globalSaveStatus 를 건드리지 않는다", () => {
    const saved = functionBody(screen, "function handleSaved(");
    assert.ok(
      !saved.includes("setGlobalSaveStatus"),
      "여기서 globalSaveStatus 를 'saved' 로 바꾸면 저장 대기가 있을 때 '변경사항 N건 저장 대기 중'이 2.5초 사라졌다 돌아온다"
    );
  });

  test("🔴 저장 대기 안내의 조건이 그대로다 — 이 시험이 무는 그 조건이다", () => {
    assert.ok(
      flat(screen).includes('{hasAnyPendingChanges && globalSaveStatus === "idle" && <span className="text-xs text-zinc-500 dark:text-zinc-400">변경사항 {totalPendingCount}건 저장 대기 중</span>}'),
      "조건이 바뀌면 위 '깜빡이지 않는다' 단언이 무엇을 지키는지 뜻을 잃는다"
    );
    // 띄우는 표시는 그 조건을 **안 쓴다** — 두 문구가 서로의 조건을 공유하지 않는 것이
    // "별도 상태로 둔다"의 전부다.
    assert.ok(!flat(screen).includes("structuralSaveNoticeId > 0 && globalSaveStatus"));
  });
});

describe("구조 변경 저장 알림 — ⑤ 잠시 뒤 사라진다", () => {
  test("🔴 제 타이머가 있고, 0 으로 되돌린다", () => {
    const flatScreen = flat(screen);
    assert.ok(
      flatScreen.includes("useEffect(() => { if (structuralSaveNoticeId === 0) return; const timer = setTimeout(() => setStructuralSaveNoticeId(0), 2500); return () => clearTimeout(timer); }, [structuralSaveNoticeId]);"),
      "타이머가 없거나 모양이 바뀌었다 — 안 꺼지면 몇 분 전 저장을 계속 주장한다"
    );
  });

  test("🔵 숫자다 — 불린이면 표시가 떠 있는 동안 들어온 둘째 변경이 타이머를 못 미룬다", () => {
    assert.ok(
      screen.includes("const [structuralSaveNoticeId, setStructuralSaveNoticeId] = useState(0);"),
      "불린으로 바꾸면 state 값이 그대로라 효과가 다시 돌지 않고, 타이머가 첫 변경 기준으로 끝난다"
    );
  });
});

/**
 * ============================================================================
 * 줄기 B-⑦ 가 — 복원이 막힐 때 **그 초안으로 가는 길**이 서버에서 나온다
 * ============================================================================
 * 막히는 동작 자체는 실제 DB 로 잰다
 * (procedure-templates-trash.integration.test.ts 의 「줄기 B-⑦ 가」 절).
 * 여기서는 **액션이 그 값을 떨어뜨리지 않는지**만 본다 — 액션은 세션을 읽어서
 * DB 시험이 부를 수 없고, mutation 이 아무리 잘 실어도 중간에서 버리면 화면은
 * 영영 못 받는다.
 * ============================================================================
 */
describe("휴지통 복원 — 막을 때 갈 길을 함께 준다", () => {
  test("🔴 mutation 이 **초안일 때만** 세고, 막을 때 그 초안의 id 를 싣는다", () => {
    const restore = functionBody(mutation, "export async function restoreProcedureTemplate(");
    const flatRestore = flat(restore);
    assert.ok(
      flatRestore.includes('if (template.status === "DRAFT") {'),
      "상태 울타리가 사라지면 게시본·보관본 복원까지 막혀 멀쩡한 복원이 죽는다"
    );
    assert.ok(flatRestore.includes('eq(procedureTemplates.status, "DRAFT")'));
    assert.ok(flatRestore.includes("eq(procedureTemplates.isDeleted, false)"));
    assert.ok(flatRestore.includes("{ existingDraftId: liveDraft.id }"), "막기만 하고 어디 있는지 안 알려 주면 사람이 목록을 뒤져야 한다");
    // 판 번호를 글에도 싣는다 — 휴지통 창은 message 만 그린다.
    assert.ok(flatRestore.includes("초안(v${liveDraft.version})"));
  });

  test("🔴 액션이 그 칸을 그대로 넘긴다 — 중간에서 버리면 화면은 영영 못 받는다", () => {
    assert.ok(
      flat(action).includes("...(result.existingDraftId ? { existingDraftId: result.existingDraftId } : {}),"),
      "건별 결과에서 existingDraftId 가 빠졌다"
    );
    assert.ok(action.includes("existingDraftId?: string;"), "타입에서 빠지면 화면이 그 칸을 읽을 수조차 없다");
  });

  test("🔴 일괄 복원은 전과 같은 모양이다 — 한 건이 막혀도 나머지가 돈다", () => {
    const bulk = functionBody(action, "export async function restoreProcedureTemplatesAction(");
    assert.ok(
      flat(bulk).includes('runEach(input.items, "restoreProcedureTemplatesAction"'),
      "건마다 제 트랜잭션·제 결과라는 전제가 깨지면 DB 시험의 '막힌 건이 뒤 건을 안 멈춘다'가 뜻을 잃는다"
    );
    // runEach 자체가 멈추지 않는다는 것도 글자로 못 박는다 — 실패는 담아 두고
    // for 루프를 계속 돈다. 빠져나가는 자리가 **맨 끝 하나뿐**인지로 센다.
    const runEach = flat(functionBody(action, "async function runEach("));
    assert.ok(runEach.includes("for (const item of items) {"));
    assert.ok(runEach.includes("catch (err) {"), "실패를 삼키는 자리가 없으면 한 건이 터질 때 뒤 건이 안 돈다");
    assert.equal(
      runEach.match(/\breturn\b/g)?.length,
      1,
      "중간에 빠져나가는 자리가 생겼다 — 막힌 건이 나머지를 멈춘다"
    );
    assert.ok(runEach.endsWith("return results; }"));
  });
});
