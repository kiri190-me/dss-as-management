import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 「기술 작업 절차」 편집기 — **검증 줄 다듬기 + DRAFT 게시 단추**
 * (2026-11-03, 줄기 B-④).
 *
 * ── 왜 이 시험이 있는가 ─────────────────────────────────────────────────
 * 두 가지를 함께 못 박는다. 둘 다 바로 앞 조각(B-③)이 만든 [검증] 탭과 같은
 * 머리말 줄에 얹히는 일이라, 한쪽을 고치다 다른 쪽을 밀어내기 쉽다.
 *
 *  가) **꼬리말이 글자 한가운데서 잘리지 않는다.** B-③ 은 안내 글
 *      (「— 누르면 그림에서 표시」)을 본문 뒤에 그대로 이어 붙였고, 320px 짜리
 *      오른쪽 패널에서 그 글이 줄 끝에 걸려 「— 누 / 르면 그림에서 표시」로
 *      접혔다. 사용자가 말한 것: "[누르면 그림에서 표시]가 다음 줄로 가던가
 *      작은 버튼으로 표시되던가 아에 없던가 해도 될 것 같아."
 *      🔴 줄이던 것이 **까닭까지 없애는 일이 되면 안 된다** — 왜 못 누르는지
 *      모르는 줄은 고장으로 읽힌다. 그래서 「줄였는가」와 「까닭이 남았는가」를
 *      함께 잰다.
 *      🔴 같은 문장이 13줄 늘어서던 문제도 여기서 함께 푼다(고립된 노드 경고).
 *      줄마다 **가리키는 칸의 이름**이 붙는다 — 서버에 없는 값을 만든 것이
 *      아니라 그림이 이미 그리고 있는 제목이다.
 *
 *  나) **초안을 편집기 안에서 게시할 수 있다.** 전까지 게시하는 길은 절차 상세
 *      화면에만 있었다. 옮기는 것이 아니라 **더하는** 일이라, 상세 쪽이 한 글자도
 *      안 바뀌었는지를 함께 잰다.
 *      🔴 저장하지 않은 변경이 있으면 막는다. 편집기의 안전 보류 변경은 [저장]을
 *      눌러야 서버로 가므로, 그대로 게시하면 **사람이 본 것과 게시된 것이 달라진다.**
 *      🔴 게시 확인 창은 그대로다 — B-② 에서 확인 창 셋을 걷어냈지만 게시는
 *      일부러 남겼다(되돌릴 수 없다).
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * 이웃들(procedure-editor-confirm-dialogs.test.ts ·
 * procedure-validation-issue-focus-ui.test.ts)과 같은 사정이다:
 * ProcedureTemplateEditorScreen 은 @xyflow/react 의 .css 와 서버 액션을 함께
 * 물고 있어 import 자체가 던진다. 줄에 보일 이름을 **푸는 규칙**은 순수 함수로
 * 꺼내 두어 unit 목록의 procedure-validation-issue-focus.test.ts ⑧절이 진짜로
 * 돌려 본다 — 이 파일은 "화면이 그 판정을 물고 있는가"만 본다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 까닭을 그 자리 주석에 길게 적는다. 안 걷으면 "없어졌는가" 쪽이
 * 영영 깨지고 "남아 있는가" 쪽이 주석만으로 영영 통과한다. ①절의 마지막
 * 단언이 걷어내기가 실제로 일을 한다는 증거다.
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
  editor: "src/components/procedures/ProcedureTemplateEditorScreen.tsx",
  publishButton: "src/components/procedures/editor/PublishTemplateButton.tsx",
  detailScreen: "src/components/procedures/ProcedureTemplateDetailScreen.tsx",
  editPage: "src/app/(app)/procedures/[id]/edit/page.tsx",
  detailPage: "src/app/(app)/procedures/[id]/page.tsx",
} as const;

const editor = stripComments(read(PATHS.editor));
const publishButton = stripComments(read(PATHS.publishButton));
const detailScreen = stripComments(read(PATHS.detailScreen));
const editPage = stripComments(read(PATHS.editPage));
const detailPage = stripComments(read(PATHS.detailPage));

/** `const canPublish = …;` 한 문장만 떼어 낸다 — 두 페이지가 같은지 맞대려고. */
function canPublishExpression(source: string): string {
  const from = source.indexOf("const canPublish =");
  assert.notEqual(from, -1, "canPublish 계산부를 못 찾았다");
  const to = source.indexOf(";", from);
  assert.notEqual(to, -1, "canPublish 계산부가 안 닫혔다");
  return flat(source.slice(from, to + 1));
}

describe("줄기 B-④ — ① 먼저 표본 확인", () => {
  test("🔵 다섯 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ editor, publishButton, detailScreen, editPage, detailPage })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래 단언이 전부 공짜로 통과한다`);
    }
    assert.ok(editor.includes("function ValidationIssueRow("), "오류 줄 부품을 못 찾았다");
    assert.ok(editor.includes("const issueTargetLabelByKey = useMemo("), "줄에 보일 이름을 모으는 자리를 못 찾았다");
    assert.ok(publishButton.includes("export default function PublishTemplateButton("), "게시 단추 부품을 못 찾았다");
    assert.ok(editPage.includes("<ProcedureTemplateEditorScreen"), "편집기 경로가 편집기 화면을 안 그린다면 아래가 공짜로 통과한다");
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에는 코드에 없는 글자가 주석으로 적혀 있다", () => {
    // 게시 길이 언제 어디에 생겼는지를 편집기 JSX 주석에 커밋 해시로 적어 두었다.
    // 이 단언이 깨지면(= 주석에서 그 글자가 사라지면) 아래 "없어졌는가" 단언들이
    // 주석을 안 걷어도 통과하게 되어, 시험이 아무것도 안 재는 상태로 조용히 바뀐다.
    assert.ok(read(PATHS.editor).includes("09d16d8"), "편집기 주석에 게시 길의 출처가 적혀 있어야 한다");
    assert.ok(!editor.includes("09d16d8"), "코드에는 커밋 해시가 없다 — 걷어내기가 일을 안 하고 있다");
    assert.ok(read(PATHS.publishButton).includes("흐린 단추만 두면"), "게시 단추 주석에 막는 방식의 까닭이 적혀 있어야 한다");
    assert.ok(!publishButton.includes("흐린 단추만 두면"));
  });
});

describe("줄기 B-④ 가 — 꼬리말이 본문에서 떨어져 나왔다", () => {
  test("🔴 본문과 딱지가 **가로로 갈린** 한 줄이다 — 본문이 몇 줄이 되든 딱지가 안 깨진다", () => {
    const f = flat(editor);
    // 본문: 제 안에서 접힌다(min-w-0 이 없으면 flex 칸이 안 줄어 딱지를 밀어낸다).
    assert.ok(f.includes('const body = ( <span className="min-w-0 flex-1">'), "본문이 줄어들 수 있는 칸이어야 한다");
    // 못 누르는 줄 · 누르는 줄 둘 다 가로 배치다.
    assert.ok(f.includes('<li className="flex items-start gap-1.5 rounded border border-zinc-100 p-1.5 dark:border-zinc-800">'));
    assert.ok(f.includes("className={`flex w-full items-start gap-1.5 rounded border p-1.5 text-left"));
    // 딱지 둘 다 안 줄고 안 접힌다.
    const badges = f.match(/shrink-0 whitespace-nowrap rounded/g) ?? [];
    assert.equal(badges.length, 2, "딱지가 둘(못 누르는 줄 · 누르는 줄) 다 shrink-0 whitespace-nowrap 이어야 한다");
  });

  test("🔴 꼬리말을 본문 **뒤에 이어 붙이던** 옛 모양은 남지 않았다 — 그것이 글자를 잘랐다", () => {
    const f = flat(editor);
    assert.ok(!f.includes("block w-full rounded border p-1.5 text-left"), "옛 블록 배치가 남아 있으면 딱지가 다시 본문 흐름을 탄다");
    assert.ok(!f.includes("— 누르면 그림에서 표시"), "앞에 붙던 긴 줄표 꼬리말이 남아 있다");
    assert.ok(!f.includes("— 그림에서 짚을 노드·연결선이 없습니다"));
    // 줄 부품이 더 이상 children 을 받지 않는다 — 심각도·이름·문장을 따로 받아야
    // 이름을 가운데에 끼울 수 있다.
    assert.equal(f.match(/<\/ValidationIssueRow>/g), null, "줄 부품은 두 호출부 모두에서 자기 닫음이어야 한다");
    assert.ok(f.includes("severity: ProcedureValidationSeverity; "), "심각도를 프롭으로 받아야 한다");
  });

  test("🔴 짚는 중과 아닌 상태의 딱지 글자가 다르다", () => {
    assert.ok(flat(editor).includes('{isFocused ? "표시 중" : "표시"}'));
    assert.ok(flat(editor).includes("aria-pressed={isFocused}"), "눌림 상태는 보조기술에도 전해져야 한다");
  });

  test("🔴 못 누르는 줄에 **까닭이 여전히 보인다** — 짧아졌을 뿐 사라지지 않았다", () => {
    const f = flat(editor);
    assert.ok(f.includes("짚을 곳 없음"), "눈에 보이는 짧은 까닭");
    assert.ok(f.includes('title="그림에서 짚을 노드·연결선이 없습니다"'), "마우스를 올리면 한 문장이 그대로 나온다");
    // 못 누르는 줄은 여전히 단추가 아니다(B-③ 의 불변식 — 일부러 겹쳐 둔다).
    assert.ok(f.includes("if (!canFocus) { return ( <li"), "못 짚는 줄은 단추 없이 <li> 로 끝나야 한다");
  });

  test("🔴 누를 수 있는 줄의 긴 설명도 사라지지 않았다 — title 로 옮겼을 뿐이다", () => {
    assert.ok(flat(editor).includes('title={isFocused ? "그림에서 표시 중 (다시 누르면 해제)" : "누르면 그림에서 표시"}'));
  });
});

describe("줄기 B-④ 가 — 같은 문장 13줄에 이름이 붙는다", () => {
  test("🔴 이름과 「누를 수 있나」가 **같은 지도 하나**에서 나온다 — 이름만 붙고 안 눌리는 줄이 생길 수 없다", () => {
    const f = flat(editor);
    assert.ok(f.includes("for (const [key, focus] of issueFocusByKey) {"), "이름 지도를 짚기 지도에서 그대로 돌려야 한다");
    assert.ok(f.includes("const label = describeValidationIssueTarget(focus, renderedNodes, renderedEdges);"));
    // 두 목록(가져오기 시점 이슈 · 구조 검증 결과) 모두 그 지도를 본다.
    const uses = f.match(/targetLabel=\{issueTargetLabelByKey\.get\(focusKey\) \?\? null\}/g) ?? [];
    assert.equal(uses.length, 2, "두 목록이 같은 이름 지도를 봐야 한다");
  });

  test("🔵 이름은 **이미 화면에 있는 값**으로 만든다 — 서버에 새로 달라고 하지 않았다", () => {
    const f = flat(editor);
    // renderedNodes/renderedEdges 는 그림에 그대로 그려지는 바로 그 목록이다.
    assert.ok(f.includes("describeValidationIssueTarget(focus, renderedNodes, renderedEdges)"));
    assert.ok(f.includes("nodes={renderedNodes}"), "표본이 비었다 — 그림이 그 목록을 안 쓴다면 위 단언의 뜻이 사라진다");
  });

  test("🔴 이름이 본문 안에서 심각도와 문장 사이에 들어간다 — 딱지 자리를 침범하지 않는다", () => {
    const f = flat(editor);
    assert.ok(
      f.includes('{targetLabel && ( <> {" · "} <span className="font-medium text-zinc-900 dark:text-zinc-100">{targetLabel}</span> </> )}'),
      "이름은 본문(min-w-0 flex-1) 안에 있어야 접힌다"
    );
    assert.ok(f.includes('<span className="text-zinc-600 dark:text-zinc-400">{message}</span>'));
  });
});

describe("줄기 B-④ 나 — 편집기에서 게시할 수 있다", () => {
  test("🔴 게시 자리는 편집기에 딱 하나이고, **DRAFT 이고 권한이 있을 때만** 그린다", () => {
    const occurrences = editor.match(/<PublishTemplateButton\b/g) ?? [];
    assert.equal(occurrences.length, 1, "게시 자리가 둘이면 한쪽만 고쳐지는 날이 온다");
    assert.match(
      flat(editor),
      /\{template\.status === "DRAFT" && canPublish && \( <PublishTemplateButton/,
      "조건은 'DRAFT 이고 권한이 있을 때'여야 한다 — 상세 화면과 같은 모양이다"
    );
  });

  test("🔴 canPublish 의 기본값은 false — 넘기는 것을 잊은 호출부는 단추가 없다", () => {
    assert.match(flat(editor), /canPublish = false,/, "권한은 fail-closed 여야 한다");
    assert.match(flat(editor), /canPublish\?: boolean;/);
  });

  test("🔴 편집기 경로의 판정이 상세 경로의 판정과 **글자 그대로 같다**", () => {
    // 한 글자라도 다르면 "상세에서는 보이는데 편집기에서는 안 보이는" 단추가
    // 생기고, 사람은 권한이 오락가락한다고 읽는다.
    const fromEdit = canPublishExpression(editPage);
    const fromDetail = canPublishExpression(detailPage);
    // 표본 확인 — 정말 세 관문이 다 들어 있는 문장인가.
    assert.match(fromDetail, /actorMay\(actingUser, canManageTechnicalTemplates\)/);
    assert.match(fromDetail, /canActorPublishTemplateOfCategory\(role, template\.category\)/);
    assert.match(fromDetail, /await mayPublishTemplateOfCategory\(actingUser, template\.category\)/);
    assert.equal(fromEdit, fromDetail, "두 경로의 게시 판정이 갈라졌다");
    assert.match(flat(editPage), /canPublish=\{canPublish\}/, "계산한 값을 화면에 넘겨야 한다");
  });

  test("🔴 저장하지 않은 변경이 있으면 막히고, **왜 막혔는지가 그 자리에 적힌다**", () => {
    const f = flat(editor);
    assert.ok(
      f.includes(
        "disabledReason={hasAnyPendingChanges ? `저장하지 않은 변경 ${totalPendingCount}건이 있어 게시할 수 없습니다 — [저장] 먼저` : null}"
      ),
      "가드는 편집기가 이미 쓰는 hasAnyPendingChanges 하나여야 한다"
    );
    // 표본 확인 — 그 값이 정말 이 화면의 저장 대기 판정인가.
    assert.ok(f.includes("const hasAnyPendingChanges = totalPendingCount > 0;"));
    assert.ok(f.includes("disabled={!hasAnyPendingChanges || globalSaveStatus === \"saving\"}"), "[저장] 단추가 쓰는 바로 그 값이다");
  });

  test("🔴 단추를 흐리게 하는 판정과 창이 열리는 판정이 **같은 값 하나**다", () => {
    const f = flat(publishButton);
    assert.ok(f.includes("function openDialog() { if (disabledReason) return;"), "막혔는데 창이 열리면 되돌릴 수 없는 일이 난다");
    assert.ok(f.includes("disabled={disabledReason !== null}"));
    assert.ok(f.includes("{disabledReason && <span"), "까닭을 화면에 그려야 한다 — 흐린 단추만 두지 않는다");
    assert.ok(f.includes("title={disabledReason ?? undefined}"));
  });

  test("🔴 disabledReason 의 기본값은 null — 이 프롭을 안 넘기는 호출부(절차 상세)는 전과 똑같다", () => {
    assert.ok(flat(publishButton).includes("disabledReason = null,"));
    assert.ok(flat(publishButton).includes("disabledReason?: string | null;"));
    assert.ok(!detailScreen.includes("disabledReason"), "상세 화면은 이 프롭을 안 넘긴다");
  });

  test("🔴 게시 확인 창은 그대로다 — B-② 에서 확인 창 셋을 걷어냈지만 게시는 일부러 남겼다", () => {
    assert.ok(publishButton.includes("<dialog"), "게시는 다시 초안으로 못 돌린다");
    assert.ok(publishButton.includes("기술 절차 게시"));
    assert.ok(publishButton.includes("되돌릴 수 없"));
    // 부품을 새로 만들지 않았다 — 편집기 화면 자체에는 여전히 창이 없다(B-② 불변식).
    assert.ok(!flat(editor).includes("<dialog"), "확인 창은 편집기 화면에 다시 생기지 않았다");
  });

  test("🟢 상세 화면의 기존 게시 길은 한 글자도 안 바뀌었다 — 옮긴 것이 아니라 더한 것이다", () => {
    const occurrences = detailScreen.match(/<PublishTemplateButton\b/g) ?? [];
    assert.equal(occurrences.length, 1);
    assert.match(flat(detailScreen), /\{template\.status === "DRAFT" && canPublish && \( <PublishTemplateButton templateId=\{template\.id\} templateName=\{template\.name\} isReferenceOnly=\{template\.isReferenceOnly\} \/> \)\}/);
  });

  test("🔵 게시 뒤 편집기에 머물지 않는다 — 같은 경로가 PUBLISHED 를 보면 편집기를 아예 안 그린다", () => {
    // router.refresh() 가 이 경로의 서버 컴포넌트를 다시 돌린다. 그때
    // page.tsx 의 PUBLISHED 가지가 편집기 대신 "새 DRAFT 버전을 만드세요"
    // 안내를 그린다 — 이미 게시된 초안 위에 편집기가 남는 일이 없다.
    assert.ok(flat(publishButton).includes("setIsOpen(false); router.refresh();"), "게시 성공 뒤 화면을 다시 받아야 한다");
    const f = flat(editPage);
    assert.ok(f.includes('if (template.status === "PUBLISHED") {'), "표본이 비었다 — 이 가지가 없으면 위 설명이 거짓이 된다");
    assert.ok(f.includes("게시된 템플릿은 직접 편집할 수 없습니다"));
    assert.ok(f.indexOf('if (template.status === "PUBLISHED") {') < f.indexOf("<ProcedureTemplateEditorScreen"), "그 가지가 편집기보다 먼저 와야 한다");
  });
});
