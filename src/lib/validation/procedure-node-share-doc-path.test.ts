import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { validateNodeShareDocRelativePath } from "./flowchart-node-share-doc-path";
import { QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH } from "@/lib/domain/quote-folder-link";
import { checkQuoteFolderOpenableFilePath } from "@/lib/domain/quote-folder-file-link";
import {
  computeDirtyProcedureNodeFieldEntries,
  isProcedureNodeFieldDraftDirty,
  mergeProcedureNodeForRender,
  planProcedureSaveSteps,
  type ProcedureNodeFieldDraft,
  type ProcedureServerNodeSnapshot,
} from "@/lib/domain/procedure-editor-save-state";

/**
 * ============================================================================
 * 기술 작업 절차 노드가 가리키는 **파일 한 자리** — 검사와 저장 배선 (2026-11-25, 조각 E2)
 * ============================================================================
 * 재는 것 넷:
 *  ① 🔴 **검사가 두 벌이 아니다.** 같은 칸이 진단 Flowchart 와 이쪽 두 표에 있고 DB
 *     CHECK 식이 글자까지 같다(마이그레이션 0132). 그래서 앱 쪽 검사도 한 벌이어야
 *     하고, 400자 상한과 앞뒤 공백 규칙은 **이 표에도 그대로** 적용돼야 한다.
 *  ② 🔴 **저장 배선이 하나도 안 빠졌다** — 특히 「바뀜 판정」과 「보낼 걸음」. 여기만
 *     빠지면 오류도 안 나고 「저장할 변경 없음」이 뜬 채로 고른 파일이 사라진다.
 *     🔵 이 절은 **글자가 아니라 값으로** 잰다(순수 함수들이라 불러 볼 수 있다).
 *  ③ 🔴 쓰기가 **공유폴더를 실제로 확인**하고, 설정이 비면 **멈추는지**(읽기는 조용히
 *     꺼지는 것과 일부러 다르다 — 확인 안 된 경로가 표에 남지 않게).
 *  ④ 🔴 DB 자리(patch 칸 · before/after · 조회 · 화면이 보내는 값)에 칸이 하나도 안
 *     빠졌는지.
 *
 * 🔵 ③④ 는 원본을 글자로 읽어 본다 — 액션은 `"use server"` 모듈이라 이 틀에서 불러
 *    실행할 수 없고(이 저장소의 오랜 제약), DB 에 붙는 시험은 db 목록의 몫이다
 *    (db/mutations/procedure-node-share-doc.integration.test.ts — 거기서 초안↔게시본을
 *    **짝으로** 재고 판 복제까지 값으로 본다).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const actionSource = read("src/lib/server/actions/procedure-template-editor.ts");
const mutationSource = read("src/lib/db/mutations/procedure-template-editor.ts");
const querySource = read("src/lib/db/queries/procedure-template-editor.ts");
const screenSource = read("src/components/procedures/ProcedureTemplateEditorScreen.tsx");
const saveStateSource = read("src/lib/domain/procedure-editor-save-state.ts");
const clientStateSource = read("src/lib/domain/procedure-editor-client-state.ts");
const versionCloneSource = read("src/lib/db/mutations/procedure-templates.ts");
const routeSource = read("src/app/api/procedure-templates/[id]/share-folder/entries/route.ts");

/** 길이 n 짜리, **모양은 올바른** 파일 경로 하나. 🔵 손으로 센 글자 수를 믿지 않는다. */
function pathOfLength(n: number): string {
  const prefix = "1. 수리 관련/";
  const suffix = ".pdf";
  return `${prefix}${"a".repeat(n - prefix.length - suffix.length)}${suffix}`;
}

const OK_PATH = "1. 수리 관련/2026/점검 절차.pdf";

const serverNode: ProcedureServerNodeSnapshot = {
  id: "n1",
  title: "작업",
  description: null,
  instructions: null,
  sortOrder: 3,
  isActive: true,
  nextProcedureTemplateId: null,
  shareDocRelativePath: null,
  positionX: 0,
  positionY: 0,
};

function draftOf(over: Partial<ProcedureNodeFieldDraft> = {}): ProcedureNodeFieldDraft {
  return {
    title: serverNode.title,
    description: "",
    instructions: "",
    sortOrder: serverNode.sortOrder,
    isActive: serverNode.isActive,
    nextProcedureTemplateId: serverNode.nextProcedureTemplateId,
    shareDocRelativePath: serverNode.shareDocRelativePath,
    ...over,
  };
}

describe("① 🔴 검사는 **한 벌**이고, 400자·앞뒤 공백 규칙이 이 표에도 그대로다", () => {
  test("🔵 먼저 표본 확인 — 읽은 원본 여덟이 비어 있지 않다", () => {
    for (const [name, source] of Object.entries({
      actionSource,
      mutationSource,
      querySource,
      screenSource,
      saveStateSource,
      clientStateSource,
      versionCloneSource,
      routeSource,
    })) {
      assert.ok(source.length > 1000, `${name} 이 비어 있거나 너무 짧다 — 아래 단언이 공짜로 통과한다`);
    }
  });

  test("🔴 절차 쪽 액션이 **공용 검사를 가져다 쓴다** — 제 것을 짓지 않는다", () => {
    assert.ok(
      actionSource.includes('import { validateNodeShareDocRelativePath } from "@/lib/validation/flowchart-node-share-doc-path";'),
      "공용 검사를 안 쓴다 — 두 벌이 되면 한쪽만 고쳐지는 날이 온다"
    );
    const body = code(actionSource);
    // 확장자 목록도 상한 숫자도 **그 아래 단계도** 이 모듈이 제 손으로 들지 않는다.
    // 🔵 `.exe` 같은 글자로 세지 않는다 — 이 파일에는 `fieldStep.executionNodeId` 처럼
    //    그 조각을 품은 이름이 있어 **엉뚱하게 걸린다**(실제로 한 번 걸렸다).
    for (const forbidden of [
      "xlsm",
      "MAX_SHARE_DOC_PATH_LENGTH",
      "checkQuoteFolderOpenableFilePath",
      "QUOTE_FOLDER_OPENABLE_EXTENSIONS",
    ]) {
      assert.equal(body.includes(forbidden), false, `검사를 베꼈다: ${forbidden}`);
    }
  });

  test("🔵 전제 확인 — 공용 상한은 **여전히 512** 다(이 조각에서 고치지 않았다)", () => {
    assert.equal(QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH, 512);
    // 🔴 바로 이것이 틈이다: 공용 검사는 401자를 **받아들인다**.
    assert.equal(checkQuoteFolderOpenableFilePath(pathOfLength(401)), null);
  });

  test("🔴 400자는 받고 401자는 거절한다 — 이 표의 DB CHECK 와 같은 수다", () => {
    const ok = validateNodeShareDocRelativePath(pathOfLength(400));
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const tooLong = validateNodeShareDocRelativePath(pathOfLength(401));
    assert.equal(tooLong.ok, false, "401자가 통과했다 — insert 에서 터진다");
    if (!tooLong.ok) assert.ok(tooLong.error.includes("400"), tooLong.error);
  });

  test("🔴 앞뒤 공백은 거절한다(다듬지 않는다) · 가운데 공백은 그대로 산다", () => {
    // 🔵 전제 — 공용 검사는 맨 앞 공백을 그대로 지나보낸다.
    assert.equal(checkQuoteFolderOpenableFilePath(" 1. 수리 관련/점검.pdf"), null);
    assert.equal(validateNodeShareDocRelativePath(" 1. 수리 관련/점검.pdf").ok, false);
    assert.equal(validateNodeShareDocRelativePath("1. 수리 관련/점검.pdf ").ok, false);
    const kept = validateNodeShareDocRelativePath(OK_PATH);
    assert.equal(kept.ok, true);
    if (kept.ok) assert.equal(kept.shareDocRelativePath, OK_PATH, "글자를 다듬었다");
  });
});

describe("② 🔴 저장 배선 — 값으로 잰다(「바뀜 판정」과 「보낼 걸음」)", () => {
  test("🔵 먼저 무엇을 재는지 — 아무것도 안 고친 초안은 **0건**으로 센다", () => {
    assert.equal(isProcedureNodeFieldDraftDirty(draftOf(), serverNode), false);
    assert.deepEqual(computeDirtyProcedureNodeFieldEntries(new Map([["n1", draftOf()]]), new Map([["n1", serverNode]])), []);
  });

  test("🔴 **파일만** 고른 노드가 「바뀜」으로 센다 — 이 줄이 없으면 조용히 안 나간다", () => {
    const draft = draftOf({ shareDocRelativePath: OK_PATH });
    assert.equal(isProcedureNodeFieldDraftDirty(draft, serverNode), true);
    const dirty = computeDirtyProcedureNodeFieldEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
    assert.deepEqual(dirty.map(([id]) => id), ["n1"]);
  });

  test("🔴 **보낼 걸음**이 실제로 생긴다 — 「바뀜인데 보낼 것이 0개」가 아니다", () => {
    const draft = draftOf({ shareDocRelativePath: OK_PATH });
    const dirty = computeDirtyProcedureNodeFieldEntries(new Map([["n1", draft]]), new Map([["n1", serverNode]]));
    const steps = planProcedureSaveSteps({
      dirtyNodeFieldEntries: dirty,
      dirtyEdgeFieldEntries: [],
      dirtyPositionNodeIds: [],
      dirtyRouteEdgeIds: [],
    });
    assert.deepEqual(steps, [{ kind: "NODE_FIELDS", nodeId: "n1" }]);
    // 🔵 반대쪽 — 안 고쳤으면 걸음이 하나도 안 생긴다(위가 「언제나 하나」가 아님).
    assert.deepEqual(
      planProcedureSaveSteps({ dirtyNodeFieldEntries: [], dirtyEdgeFieldEntries: [], dirtyPositionNodeIds: [], dirtyRouteEdgeIds: [] }),
      []
    );
  });

  test("🔴 **가리킴 지우기**(null)도 「바뀜」이다 — 담겨 있던 것을 지운 저장이 나가야 한다", () => {
    const pointing: ProcedureServerNodeSnapshot = { ...serverNode, shareDocRelativePath: OK_PATH };
    assert.equal(isProcedureNodeFieldDraftDirty(draftOf({ shareDocRelativePath: null }), pointing), true);
    // 같은 값을 그대로 둔 초안은 「안 바뀜」이다.
    assert.equal(isProcedureNodeFieldDraftDirty(draftOf({ shareDocRelativePath: OK_PATH }), pointing), false);
  });

  test("🔴 화면에 **그려지는 값**이 초안을 따른다 — 지운 것이 되살아나지 않는다", () => {
    const pointing: ProcedureServerNodeSnapshot = { ...serverNode, shareDocRelativePath: OK_PATH };
    // 초안이 없으면 받침 그대로.
    assert.equal(mergeProcedureNodeForRender(pointing, undefined, undefined).shareDocRelativePath, OK_PATH);
    // 🔴 초안이 null 이면 **null 로 그린다**(`??` 였다면 여기서 OK_PATH 가 되살아난다).
    assert.equal(mergeProcedureNodeForRender(pointing, draftOf({ shareDocRelativePath: null }), undefined).shareDocRelativePath, null);
    // 새로 고른 값도 그대로 비친다.
    assert.equal(
      mergeProcedureNodeForRender(serverNode, draftOf({ shareDocRelativePath: OK_PATH }), undefined).shareDocRelativePath,
      OK_PATH
    );
  });
});

describe("③ 🔴 쓰기는 **확인되지 않은 경로**를 담지 않는다", () => {
  test("가리킬 때만 공유폴더를 묻는다 — null 과 「안 실음」은 그 검사를 지나지 않는다", () => {
    const action = code(actionSource);
    const guardAt = action.indexOf("if (shareDocRelativePath !== null) {");
    assert.ok(guardAt > 0, "「가리킬 때만」 관문이 없다 — 지우기까지 공유폴더를 묻는다");
    assert.ok(action.indexOf("resolveRepairDocsArchiveRoot()") > guardAt, "관문 밖에서 루트를 읽는다");
    assert.ok(action.indexOf("findRepairDocsEntry({") > guardAt, "관문 밖에서 디스크를 본다");
  });

  test("🔴 설정이 비면 **멈춘다** — 읽기 통로의 `disabled` 와 일부러 다르다", () => {
    const action = code(actionSource);
    assert.ok(action.includes("if (archiveRoot === null) {"));
    assert.ok(action.includes("shareFolderError("), "거절하는 길이 없다");
    // 🔴 쓰기 쪽에 조용히 꺼지는 길(= 루트가 없을 때 그냥 담는 길)이 없다.
    assert.equal(action.includes('status: "disabled"'), false, "쓰기 쪽에 조용히 꺼지는 길이 생겼다");
    // 🔵 반대쪽 — **읽기 통로에는 그 길이 있다**(비대칭이 진짜로 서 있는지).
    assert.ok(code(routeSource).includes('respond({ status: "disabled" })'), "읽기 통로가 조용히 안 꺼진다");
  });

  test("🔴 그 자리에 **파일이** 있어야 한다 — 폴더면 거절(칸에 종류를 담을 자리가 없다)", () => {
    const action = code(actionSource);
    assert.ok(action.includes('found.status === "failed"'));
    assert.ok(action.includes('found.status === "not-found"'));
    assert.ok(action.includes("found.isDirectory"), "폴더를 가려내지 않는다");
  });

  test("🔴 검사 차례 — 글자 규칙이 **디스크보다 앞**이다", () => {
    const action = code(actionSource);
    assert.ok(
      action.indexOf("validateNodeShareDocRelativePath(input.patch.shareDocRelativePath)") <
        action.indexOf("resolveRepairDocsArchiveRoot()")
    );
  });

  test("🔴 거절 문장에 **경로가 한 글자도** 안 들어간다", () => {
    const action = code(actionSource);
    // 🔵 `return` 을 함께 찾는 까닭은 **함수를 정의한 줄**까지 세지 않기 위해서다.
    const calls = [...action.matchAll(/return shareFolderError\(([\s\S]*?)\);/g)].map((m) => m[1]);
    assert.equal(calls.length, 4, `거절하는 자리가 ${calls.length}곳이다 — 늘었으면 함께 본다`);
    for (const argument of calls) {
      assert.equal(argument.includes("shareDocRelativePath"), false, `경로를 문장에 실었다: ${argument}`);
      assert.equal(argument.includes("archiveRoot"), false, `루트를 문장에 실었다: ${argument}`);
    }
  });

  test("🔴 **초안 울타리를 안 건드렸다** — 이 칸만 빠져나가는 길이 없다", () => {
    const mutation = code(mutationSource);
    // assertEditableDraft 는 그대로 한 자리에서 status 를 본다.
    assert.ok(mutation.includes('if (template.status !== "DRAFT") fail("NOT_DRAFT"'), "초안 관문이 사라졌다");
    // 🔴 「파일 칸이면 봐 준다」 식의 갈래가 생기지 않았다.
    for (const forbidden of ["shareDocRelativePath !== undefined && template.status", "shareDocOnly", "skipDraftCheck"]) {
      assert.equal(mutation.includes(forbidden), false, `초안 울타리에 예외가 생겼다: ${forbidden}`);
    }
    // 🔴 그 칸을 고치는 mutation 은 그 관문을 **지나야** 한다.
    const updateAt = mutation.indexOf("export async function updateProcedureTemplateNode(");
    assert.ok(updateAt > 0);
    const body = mutation.slice(updateAt, mutation.indexOf("export type ChangeNodeTypeResult"));
    assert.ok(body.includes("await assertEditableDraft(tx, node.procedureTemplateId"), "초안 관문을 안 지난다");
  });

  test("🔴 목록 통로의 검사 차례 — 출처 → 세션 → 권한 → 대상 → 경로 → 루트", () => {
    const route = code(routeSource);
    const order = [
      "isTrustedOrigin(request)",
      "await readSession()",
      "mayEnterTemplateEditor(actingUser)",
      "getProcedureTemplateEditorGate(templateId)",
      "mayEditTemplateOfCategory(actingUser, template.category)",
      "checkQuoteFolderRelativePath(insidePath)",
      "resolveRepairDocsArchiveRoot()",
      "listRepairDocsEntries({",
    ];
    let previous = -1;
    for (const marker of order) {
      const at = route.indexOf(marker);
      assert.ok(at > previous, `차례가 어긋났다(또는 없다): ${marker}`);
      previous = at;
    }
    // 🔴 응답에 루트도 전체 경로도 안 실린다 — **나가는 몸통만** 본다.
    //    🔵 `archiveRoot` 라는 글자 자체는 파일 안에 있다(디스크를 읽을 때 쓴다). 그것을
    //       통째로 금지하면 멀쩡한 쓰임까지 막는다 — 그래서 자리를 좁혀 센다.
    const listedAt = route.lastIndexOf('status: "listed"');
    assert.ok(listedAt > 0, "나가는 몸통을 못 찾았다");
    const responseBody = route.slice(listedAt);
    for (const forbidden of ["archiveRoot", "root", "relativePath"]) {
      assert.equal(responseBody.includes(forbidden), false, `나가는 몸통에 ${forbidden} 가 실렸다`);
    }
    // 🔴 **타입 수준에도** 경로 칸이 없다 — 줄 하나의 모양이 이름·폴더인가·크기·시각 넷뿐이다.
    const typeAt = route.indexOf("type RepairDocsEntryBody = {");
    assert.ok(typeAt > 0, "줄 하나의 타입을 못 찾았다");
    const entryType = route.slice(typeAt, route.indexOf("};", typeAt));
    assert.deepEqual(
      entryType.match(/^\s*(\w+)\??:/gm)?.map((s) => s.trim().replace(/\??:$/, "")),
      ["name", "isDirectory", "sizeBytes", "modifiedAt"]
    );
    // 🔴 읽기 통로에 쓰기 메서드가 없다.
    for (const method of ["export async function POST", "export async function PUT", "export async function DELETE"]) {
      assert.equal(route.includes(method), false, `읽기 통로에 ${method} 가 생겼다`);
    }
  });
});

describe("④ 🔴 DB 까지 가는 길에 칸이 하나도 안 빠졌다", () => {
  test("mutation — patch 칸 · beforeState · set(스프레드)", () => {
    const updateAt = mutationSource.indexOf("export type UpdateNodePatch");
    assert.ok(updateAt > 0, "patch 타입을 못 찾았다");
    const patchBlock = mutationSource.slice(updateAt, mutationSource.indexOf("export type NodeMutationResult"));
    assert.ok(patchBlock.includes("shareDocRelativePath?: string | null;"), "patch 에 칸이 없다");

    const bodyAt = mutationSource.indexOf("export async function updateProcedureTemplateNode(");
    const body = mutationSource.slice(bodyAt, mutationSource.indexOf("export type ChangeNodeTypeResult"));
    assert.ok(body.includes("shareDocRelativePath: node.shareDocRelativePath,"), "beforeState 에서 빠졌다");
    // afterState 와 set 은 **스프레드**가 나른다 — 그 두 줄이 그대로인지 함께 본다.
    assert.ok(body.includes("const afterState = { ...beforeState, ...normalizedPatch };"), "afterState 가 스프레드가 아니게 됐다");
    assert.ok(body.includes(".set({ ...normalizedPatch, updatedAt: new Date() })"), "set 이 스프레드가 아니게 됐다");
  });

  test("🔴 조회가 그 칸을 **읽어 온다** — 안 읽으면 새로 고칠 때마다 지워진 것처럼 보인다", () => {
    assert.ok(querySource.includes("shareDocRelativePath: n.shareDocRelativePath,"), "행을 옮기는 자리에서 빠졌다");
    assert.ok(querySource.includes("shareDocRelativePath: string | null;"), "EditorNodeRow 에 칸이 없다");
  });

  test("🔴 「바뀜 판정」과 「저장 안 됨」 세기 둘 다에 칸이 있다", () => {
    assert.ok(
      saveStateSource.includes("draft.shareDocRelativePath !== server.shareDocRelativePath"),
      "바뀜 판정에서 빠졌다 — ②가 값으로 재는 그 자리"
    );
    assert.ok(clientStateSource.includes('"shareDocRelativePath",'), "NODE_FIELD_KEYS 에서 빠졌다");
  });

  test("🔴 화면이 보내는 값을 **다듬지 않는다** — 다듬으면 없는 파일이 된다", () => {
    const screen = code(screenSource);
    assert.ok(screen.includes("shareDocRelativePath: draft.shareDocRelativePath,"), "저장 걸음이 그 칸을 안 싣는다");
    for (const forbidden of [
      "shareDocRelativePath: draft.shareDocRelativePath.trim()",
      "shareDocRelativePath: draft.shareDocRelativePath?.trim()",
      "shareDocRelativePath: draft.shareDocRelativePath || null",
    ]) {
      assert.equal(screen.includes(forbidden), false, `글자를 다듬는다: ${forbidden}`);
    }
    // 받침에서 읽어 오는 자리 둘 — 초안의 첫 값과 서버 스냅숏.
    assert.ok(screen.includes("shareDocRelativePath: server?.shareDocRelativePath ?? null,"), "초안의 첫 값을 안 읽는다");
    assert.ok(screen.includes("shareDocRelativePath: source.shareDocRelativePath,"), "서버 스냅숏에 칸이 없다");
    // 🔴 패널에 넘기는 것은 **절차 템플릿 id** 다(노드 id 가 아니다 — 둘 다 UUID 라 겉은 같다).
    const panelAt = screen.indexOf("<NodePropertyPanel");
    assert.ok(panelAt > 0, "패널을 세우는 자리를 못 찾았다");
    const props = screen.slice(panelAt, screen.indexOf("/>", panelAt));
    assert.ok(props.includes("procedureTemplateId={template.id}"), props);
    assert.equal(props.includes("procedureTemplateId={selectedNode"), false, props);
  });

  test("🔴 판 복제 — 새 초안을 만들 때 그 칸을 **싣는다**", () => {
    // 🔵 값으로 재는 쪽은 db 목록의 통합 시험이다. 여기서는 그 한 줄이 살아 있는지만 본다.
    assert.ok(
      versionCloneSource.includes("shareDocRelativePath: n.shareDocRelativePath,"),
      "복제 목록에서 빠졌다 — 개정할 때마다 매 둔 파일 위치가 오류 없이 사라진다"
    );
  });
});
