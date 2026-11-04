import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 「기술 작업 절차」의 **초안 판 관리**(2026-11-04, 줄기 B-⑥).
 *
 * ── 사용자가 말한 것 ────────────────────────────────────────────────────
 * "게시한 [기술 작업 절차]를 [새 DRAFT 버전 만들기]로 편집할 때 버전 관리를
 * 제대로 해줘" — 그리고 "잘못 만든 초안을 버리는 길까지 포함해서".
 *
 * 그 자리에 있던 결함 둘:
 *  ① 막기만 하고 **갈 길을 안 줬다** — "이미 진행 중인 초안 버전이 있습니다"
 *     한 줄뿐이라, 같은 이름의 판이 여럿인 목록에서 사람이 손으로 찾아야 했다.
 *  ② **누르는 순간 행이 생기는데 취소할 길이 없었다** — 버리는 길 자체는
 *     목록 화면(/procedures/technical)에 있었지만, 잘못 눌러 떨어진 편집기에서
 *     거기까지 가는 길이 화면 어디에도 적혀 있지 않았다.
 *
 * ── 이 파일이 재는 것 ───────────────────────────────────────────────────
 *  ① 표본 확인(파일이 실제로 읽혔고 손잡이가 거기 있다) + 주석 걷어내기가
 *     정말 일을 한다.
 *  ② 가 — 막을 때 그 초안으로 가는 **링크**가 나온다. 서버가 id 를 싣고
 *     화면이 그린다. 둘 중 하나만 있으면 아무 일도 일어나지 않는다.
 *  ③ 나 — [새 DRAFT 버전 만들기]에는 확인 창이 없고, 대신 **되돌리는 길을
 *     누르기 전에** 말해 준다. 흐린 단추도 말 없는 단추도 두지 않는다.
 *  ④ 다 — [초안 버리기]는 확인 창을 띄우고, DRAFT 에서만 보이고, 서버에
 *     "DRAFT 만"을 넘기고, 실패하면 창을 닫지 않는다.
 *  ⑤ 앞 조각들을 안 깼다 — 게시 확인 창(줄기 B-②·④)과 새 초안의 배치 복제
 *     (줄기 B-⑤).
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * 이 단추들은 서버 액션(@/lib/server/actions/...)을 직접 import 하는 클라이언트
 * 컴포넌트라 사슬 끝에 `server-only` 가 있다 — 어느 목록에서도 import 자체가
 * 던진다. 이웃들(procedure-editor-confirm-dialogs.test.ts ·
 * procedure-publish-flow.test.tsx)이 같은 사정에서 쓴 방법을 그대로 쓴다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 「왜 그렇게 했는지」를 그 자리 주석에 길게 적는다. 그래서 날것을
 * 그대로 세면 "창이 없는가"는 주석의 `<dialog>` 글자 때문에 영영 깨지고,
 * 반대로 "있는가" 쪽은 주석만으로 영영 통과한다. ①절의 마지막 단언이 걷어내기가
 * 실제로 일을 하고 있다는 증거다.
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

/** `start` 로 시작해 괄호 깊이가 0으로 돌아올 때까지 — 함수 하나의 몸통만 떼어 낸다. */
function functionBody(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
  const open = source.indexOf("{", from);
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

/**
 * 맨 바깥(들여쓰기 0)에 선언된 함수 하나 — 선언부터 **열 0의 닫는 중괄호**까지.
 *
 * 🔴 위의 functionBody 를 쓸 수 없는 자리가 있다. 그쪽은 "이름 뒤 첫 `{` 부터
 * 괄호 깊이가 0으로 돌아올 때까지"인데, 이 파일이 재는 서버 액션·mutation 은
 * 인자가 `input: { templateId: string }` 처럼 **객체 모양**이라 그 첫 `{` 가
 * 몸통이 아니라 인자 타입이다. 그대로 쓰면 몸통을 한 글자도 못 읽은 채
 * 단언들이 전부 거짓이 된다(실제로 그렇게 깨졌다).
 */
function topLevelFunction(source: string, start: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `원본에서 ${start} 를 못 찾았다 — 이름이 바뀌었으면 시험도 함께 고쳐야 한다`);
  const end = source.indexOf("\n}\n", from);
  assert.notEqual(end, -1, `${start} 의 몸통이 안 닫혔다`);
  const body = source.slice(from, end + 3);
  assert.ok(body.length > start.length + 100, `${start} 의 몸통이 너무 짧다 — 잘못 잘랐다`);
  return body;
}

const PATHS = {
  createDraft: "src/components/procedures/editor/CreateDraftVersionButton.tsx",
  discardDraft: "src/components/procedures/editor/DiscardDraftButton.tsx",
  publish: "src/components/procedures/editor/PublishTemplateButton.tsx",
  editorScreen: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  editPage: "src/app/(app)/procedures/[id]/edit/page.tsx",
  trashActions: "src/lib/server/actions/procedure-template-trash.ts",
  templateMutations: "src/lib/db/mutations/procedure-templates.ts",
} as const;

const createDraft = stripComments(read(PATHS.createDraft));
const discardDraft = stripComments(read(PATHS.discardDraft));
const publish = stripComments(read(PATHS.publish));
const editorScreen = stripComments(read(PATHS.editorScreen));
const editPage = stripComments(read(PATHS.editPage));
const trashActions = stripComments(read(PATHS.trashActions));
const templateMutations = stripComments(read(PATHS.templateMutations));

describe("초안 판 관리 — ① 먼저 표본 확인", () => {
  test("🔵 일곱 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({
      createDraft,
      discardDraft,
      publish,
      editorScreen,
      editPage,
      trashActions,
      templateMutations,
    })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(createDraft.includes("async function handleCreate()"));
    assert.ok(discardDraft.includes("async function handleDiscard()"));
    assert.ok(trashActions.includes("export async function discardProcedureTemplateDraftAction("));
    assert.ok(templateMutations.includes("export async function createNewDraftVersion("));
    assert.ok(templateMutations.includes("export async function softDeleteProcedureTemplate("));
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 `<dialog>` 가 남아 있다", () => {
    // CreateDraftVersionButton 머리말이 "이웃 PublishTemplateButton 은 <dialog>
    // 확인 창을 띄운다"고 적고 있다. 이 단언이 깨지면(= 주석에서 그 글자가
    // 사라지면) 아래 "창이 없다"가 주석을 안 걷어도 통과하게 되어, 시험이
    // 아무것도 안 재는 상태로 조용히 바뀐다.
    assert.ok(read(PATHS.createDraft).includes("<dialog>"), "머리말에 이웃의 모습이 적혀 있어야 한다");
    assert.ok(!createDraft.includes("<dialog"), "걷어낸 쪽에는 창이 없어야 한다");
  });
});

describe("초안 판 관리 — ② 가: 막을 때 그 초안으로 가는 길을 함께 준다", () => {
  test("🔴 서버가 막으면서 **그 초안의 id** 를 싣는다", () => {
    const body = flat(topLevelFunction(templateMutations, "export async function createNewDraftVersion("));
    assert.match(
      body,
      /fail\("CONFLICT", "이미 진행 중인 초안 버전이 있습니다\.", \{ existingDraftId: existingDraft\.id \}\)/,
      "막는 자리에서 id 를 안 실으면 화면이 그릴 것이 없다"
    );
    // 그 자리에서 찾은 초안이 **살아 있는 것**이어야 한다 — 휴지통의 초안을
    // 가리키면 사람이 열 수 없는 곳으로 보내게 된다.
    assert.ok(body.includes("eq(procedureTemplates.isDeleted, false)"));
  });

  test("🔴 타입이 그 칸을 들고 있다 — 액션이 그대로 흘려보낸다", () => {
    assert.ok(flat(templateMutations).includes("existingDraftId?: string;"));
    // 액션은 mutation 의 결과를 손대지 않고 그대로 돌려준다(그 파일의 규약).
    const actions = stripComments(read("src/lib/server/actions/procedure-templates.ts"));
    assert.ok(
      topLevelFunction(actions, "export async function createNewDraftVersionAction(").includes(
        "return await createNewDraftVersion(input.templateId, session.userId);"
      ),
      "액션이 결과를 다시 만들면 existingDraftId 가 조용히 떨어진다"
    );
  });

  test("🔴 화면이 그 id 를 받아 **링크**를 그린다 — 흐린 글만 남기지 않는다", () => {
    const body = flat(functionBody(createDraft, "async function handleCreate()"));
    assert.ok(body.includes("setErrorMessage(result.message);"), "까닭을 받아 둔다");
    assert.ok(body.includes("setExistingDraftId(result.existingDraftId ?? null);"), "갈 곳을 받아 둔다");

    const painted = flat(createDraft);
    assert.ok(painted.includes("{errorMessage && ("), "까닭을 화면에 그린다");
    assert.match(
      painted,
      /\{existingDraftId && \( <Link href=\{`\/procedures\/\$\{existingDraftId\}\/edit`\}/,
      "그 초안의 편집기로 가는 링크가 있어야 한다"
    );
    assert.ok(painted.includes("진행 중인 초안 편집기로 이동"));
  });

  test("🔴 다음 시도에서 묵은 링크가 남지 않는다 — 누를 때마다 비운다", () => {
    const body = flat(functionBody(createDraft, "async function handleCreate()"));
    const reset = body.indexOf("setExistingDraftId(null);");
    const call = body.indexOf("await createNewDraftVersionAction(");
    assert.ok(reset !== -1 && reset < call, "서버를 부르기 전에 지난 링크를 비워야 한다");
  });
});

describe("초안 판 관리 — ③ 나: 새 초안 만들기에는 확인 창을 두지 않는다", () => {
  test("🔴 창이 없고, 단추가 서버 호출로 곧장 간다", () => {
    assert.ok(!createDraft.includes("<dialog"), "확인 창이 생겼다 — 되돌릴 수 있는 일에는 창을 안 둔다");
    assert.ok(!createDraft.includes("window.confirm("));
    assert.ok(flat(createDraft).includes("onClick={() => void handleCreate()}"));
    assert.ok(flat(createDraft).includes('{isCreating ? "생성 중..." : "새 DRAFT 버전 만들기"}'));
    assert.ok(flat(createDraft).includes("disabled={isCreating}"), "두 번 눌러도 두 번 나가면 안 된다");
  });

  test("🔴 안내 글은 걷혔다 — 그래도 **되돌리는 길이 화면에 둘** 있다", () => {
    // ── 이 시험은 2026-11-04 에 **뒤집혔다** ─────────────────────────────
    // 전에는 "그 한 줄이 이 판단의 대가다" 라며 안내 문장이 **있는지**를 쟀다.
    // 같은 날 사용자가 "[새 DRAFT 버전 만들기] 아래에 있는 설명들을 없애줘"
    // 라고 해서 걷었다. 지우지 않고 뒤집어 적는 까닭은, 걷어낸 자리에 아무
    // 단언도 없으면 다음 사람이 그 글을 되살리거나(사용자가 싫다고 한 것)
    // 확인 창을 도로 넣기 때문이다.
    //
    // 🔴 창을 안 두는 근거는 **글이 아니라 길**이다: 잘못 눌러 생긴 초안을
    //    치우는 자리가 화면에 둘 있다 — 편집기의 [초안 버리기]와,
    //    [절차 상세] > [버전 목록]의 [삭제](같은 날 생겼다). 그 둘이 사라지면
    //    여기서 먼저 깨져야 한다.
    const painted = flat(createDraft);
    assert.ok(!painted.includes("게시된 판은 그대로 두고 새 초안을 하나 만듭니다."), "걷어낸 안내가 돌아왔다");
    assert.ok(!painted.includes("[초안 버리기]로 치울 수 있습니다."), "걷어낸 안내가 돌아왔다");
    assert.ok(!createDraft.includes("<dialog"), "설명이 없다고 확인 창을 도로 넣으면 안 된다");

    // 🔵 되돌리는 길 둘이 실제로 있다 — 없으면 위 단언들이 "말도 길도 없는
    //    단추"를 지키는 꼴이 된다.
    assert.ok(discardDraft.includes("초안 버리기"), "편집기의 되돌리는 길");
    const deleteVersionButton = read("src/components/procedures/editor/DeleteProcedureVersionButton.tsx");
    assert.ok(deleteVersionButton.includes("deleteProcedureTemplateVersionAction"), "[버전 목록]의 되돌리는 길");
  });

  test("🟢 함께 걷지 않은 둘 — 막혔을 때의 까닭과 갈 곳은 그대로다", () => {
    // 이쪽이 더 중요하다. 함께 걷히면 눌러도 아무 일이 없는 화면이 된다.
    const painted = flat(createDraft);
    assert.ok(painted.includes("{errorMessage && ("), "왜 안 됐는지");
    assert.ok(painted.includes("{existingDraftId && ("), "그때 갈 곳");
    assert.ok(painted.includes("진행 중인 초안 편집기로 이동"));
  });
});

describe("초안 판 관리 — ④ 다: 초안 버리기", () => {
  test("🔴 확인 창이 있다 — 그리고 되살리는 자리를 적는다", () => {
    assert.ok(discardDraft.includes("<dialog"), "버리기는 그 자리에서 되돌리는 일이 아니다 — 창이 있어야 한다");
    assert.ok(discardDraft.includes('id="discard-draft-dialog-title"'));
    assert.ok(flat(discardDraft).includes("[기술 작업 절차] → [휴지통]"), "어디서 되살리는지를 적어야 한다");
    assert.ok(flat(discardDraft).includes("게시된 판은 그대로 남습니다."), "무엇이 안 사라지는지도 적는다");
    assert.ok(flat(discardDraft).includes("버린 판 번호(v{templateVersion})는 돌아오지 않습니다"));
  });

  test("🔴 실패하면 창을 닫지 않고 서버가 준 이유를 그 자리에 그린다", () => {
    const body = flat(functionBody(discardDraft, "async function handleDiscard()"));
    assert.match(body, /if \(!result\.ok\) \{ setIsDiscarding\(false\); setErrorMessage\(result\.message\); return; \}/);
    assert.ok(!body.includes("if (!result.ok) { setIsOpen(false)"), "실패를 '아무 일도 안 일어남'으로 보이게 하면 안 된다");
    assert.ok(flat(discardDraft).includes('{errorMessage && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}'));
  });

  test("🔴 성공하면 **떠난다** — 지워진 초안 위에 편집기가 남지 않는다", () => {
    const body = flat(functionBody(discardDraft, "async function handleDiscard()"));
    assert.ok(body.includes('router.replace("/procedures/technical");'), "목록으로 보내야 한다");
    assert.ok(!body.includes("router.refresh()"), "같은 주소를 다시 읽으면 빈손이 돌아와 고장처럼 보인다");
  });

  test("🔴 서버에 **DRAFT 만**이라고 넘긴다 — 게시본은 이 길로 못 지운다", () => {
    const action = flat(topLevelFunction(trashActions, "export async function discardProcedureTemplateDraftAction("));
    assert.ok(action.includes("await softDeleteProcedureTemplate({"));
    assert.ok(action.includes('requireStatus: "DRAFT",'), "이 한 줄이 게시본을 막는 전부다");
    assert.ok(action.includes("isValidUuid(input?.templateId)"));

    // 🔵 그 값을 받는 쪽이 실제로 상태를 본다 — 넘기기만 하고 안 보면 아무 일도 안 한다.
    //
    // 🔴 2026-11-04 — requireStatus 가 **여럿도 받게** 넓어졌다([버전 목록]의
    //    [삭제]가 초안·만료본 둘을 허용한다). 글자 하나를 넘기는 이 길의
    //    동작은 한 글자도 안 바뀌었다 — 아래가 그것을 값의 모양으로 못 박는다:
    //    문자열이면 배열 하나로 감싸고, 그 묶음에 없으면 거절한다.
    const mutation = flat(topLevelFunction(templateMutations, "export async function softDeleteProcedureTemplate("));
    assert.match(
      mutation,
      /if \(input\.requireStatus !== undefined\) \{ const allowed = typeof input\.requireStatus === "string" \? \[input\.requireStatus\] : input\.requireStatus; if \(!allowed\.includes\(template\.status\)\) \{ fail\( "CONFLICT",/,
      "mutation 이 requireStatus 를 안 보면 화면만 막는 셈이다"
    );
    // 🔴 "안 넘기면 상태를 안 본다"가 그대로여야 한다 — 참 검사(`&&`)로
    //    되돌아가면 빈 배열이 "아무 상태나 통과"로 뒤집힌다.
    assert.ok(
      !mutation.includes("if (input.requireStatus &&"),
      "빈 묶음이 '전부 허용'으로 읽히는 모양으로 돌아갔다"
    );
    // 상태 검사가 참조 검사보다 **앞**이어야 한다 — 게시본을 참조 수로 거절하면
    // "지금은 참조가 없으니 지울 수 있다"로 읽힌다. 화면도 같은 차례로 까닭을
    // 고른다(domain/procedure-version-deletion.ts).
    const statusCheck = mutation.indexOf("allowed.includes(template.status)");
    const referenceCheck = mutation.indexOf("countProcedureTemplateReferences(");
    assert.ok(statusCheck !== -1 && referenceCheck !== -1 && statusCheck < referenceCheck);
  });

  test("🔴 일괄 삭제 쪽은 그대로다 — requireStatus 를 안 넘긴다", () => {
    // 목록 화면(/procedures/technical)의 [삭제 모드]는 이 조각이 건드리지
    // 않았다. 거기에도 "DRAFT 만"을 끼워 넣으면 휴지통의 「삭제 당시 상태」
    // 칸이 뜻을 잃는다(발행본도 올 수 있다는 전제로 서 있다).
    const bulk = flat(topLevelFunction(trashActions, "export async function deleteProcedureTemplatesAction("));
    assert.ok(bulk.includes("softDeleteProcedureTemplate({ templateId: item.id, actorUserId: actor.userId, reason: reason || null })"));
    assert.ok(!bulk.includes("requireStatus"));
  });

  test("🔴 편집기 화면은 DRAFT 일 때만, 권한이 있을 때만 단추를 낸다", () => {
    const painted = flat(editorScreen);
    assert.match(
      painted,
      /\{template\.status === "DRAFT" && canDiscardDraft && \( <DiscardDraftButton templateId=\{template\.id\} templateName=\{template\.name\} templateVersion=\{template\.version\} \/> \)\}/
    );
    assert.ok(painted.includes("canDiscardDraft = false,"), "넘기는 것을 잊은 호출부는 단추가 없어야 한다(fail-closed)");
  });

  test("🔴 페이지가 **서버가 보는 관문 둘**을 모두 보고 넘긴다", () => {
    const flatPage = flat(editPage);
    assert.match(
      flatPage,
      /const canDiscardDraft = actorMay\(actingUser, \(role\) => canDeleteTechnicalTemplates\(role, template\.category\)\) && \(await hasPermission\(actingUser, "technicalProcedures\.lifecycle", "MANAGE"\)\);/,
      "역할 고정 관문과 설정 관문을 함께 보지 않으면 서버가 거절할 단추가 보인다"
    );
    assert.ok(flatPage.includes("canDiscardDraft={canDiscardDraft}"), "계산해 놓고 안 넘기면 단추가 영영 안 보인다");
  });
});

describe("초안 판 관리 — ⑤ 앞 조각을 안 깼다", () => {
  test("🟢 게시 확인 창은 그대로다 — 되돌리기 밖의 일이다(줄기 B-②)", () => {
    assert.ok(publish.includes("<dialog"), "게시는 다시 초안으로 못 돌린다 — 창이 사라지면 안 된다");
    assert.ok(publish.includes("기술 절차 게시"));
    assert.ok(publish.includes("되돌릴 수 없"));
  });

  test("🟢 편집기의 [게시] 단추도 그대로 선다(줄기 B-④)", () => {
    const painted = flat(editorScreen);
    assert.ok(painted.includes('{template.status === "DRAFT" && canPublish && ( <PublishTemplateButton'));
    assert.ok(painted.includes("저장하지 않은 변경"), "게시를 막는 까닭을 적던 자리가 남아 있어야 한다");
  });

  test("🔴 새 초안이 **배치를 여전히 물려받는다**(줄기 B-⑤) — 판 번호 바꾸며 복제 목록을 건드리지 않았다", () => {
    const body = flat(topLevelFunction(templateMutations, "export async function createNewDraftVersion("));
    for (const column of [
      "userPositionX: n.userPositionX,",
      "userPositionY: n.userPositionY,",
      "userRoutePoints: e.userRoutePoints,",
      "clonedFromEdgeId: e.id,",
    ]) {
      assert.ok(body.includes(column), `복제 목록에서 ${column} 이 사라졌다`);
    }
  });

  test("🔴 판 번호는 **버린 행까지 세어** 다음 번호를 고른다", () => {
    const body = flat(topLevelFunction(templateMutations, "export async function createNewDraftVersion("));
    assert.ok(body.includes("version: nextVersion,"), "부모+1 로 되돌아가면 버린 뒤 다시 만들기가 터진다");
    assert.match(
      body,
      /\.select\(\{ highest: sql<number>`max\(\$\{procedureTemplates\.version\}\)::int` \}\) \.from\(procedureTemplates\) \.where\(eq\(procedureTemplates\.code, published\.code\)\)/,
      "같은 줄기의 모든 판을 봐야 한다"
    );
    const ceiling = body.slice(body.indexOf("const [versionCeiling]"), body.indexOf("const nextVersion"));
    assert.ok(
      !ceiling.includes("isDeleted"),
      "휴지통의 행을 빼고 세면 그 행이 쥐고 있는 번호를 다시 쓰려다 유니크 위반으로 터진다"
    );
  });
});
