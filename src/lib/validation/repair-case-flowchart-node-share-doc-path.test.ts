import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { validateNodeShareDocRelativePath } from "./repair-case-flowchart-graph-input";
import {
  QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH,
  checkQuoteFolderRelativePath,
} from "@/lib/domain/quote-folder-link";
import { checkQuoteFolderOpenableFilePath } from "@/lib/domain/quote-folder-file-link";

/**
 * ============================================================================
 * 진단 Flowchart 노드가 가리키는 **파일 한 자리** — 검사와 저장 배선 (2026-11-25)
 * ============================================================================
 * 재는 것 넷:
 *  ① 🔴 **길이 상한이 어긋나 있다** — 공용 검사는 512, DB CHECK 는 400. 401~512 글자가
 *     검사를 통과해 insert 에서 터지면, 사람에게 가는 말은 「일시적으로 처리할 수
 *     없습니다」뿐이라 무엇이 틀렸는지 영영 알 수 없다. 그 틈을 이 자리에서 메웠는지.
 *  ② 🔴 **앞뒤 공백**도 DB CHECK(`값 = btrim(값)`)와 같게 막는지. 공용 검사는 마디
 *     **끝**의 공백만 보아 맨 앞 공백이 그대로 지나간다.
 *  ③ 🔴 쓰기가 **공유폴더를 실제로 확인**하고, 설정이 비면 **멈추는지**(읽기는 조용히
 *     꺼지는 것과 일부러 다르다 — 확인 안 된 경로가 표에 남지 않게).
 *  ④ 🔴 DB 자리(파라미터 · set · before/after)에 칸이 **하나도 안 빠졌는지**.
 *
 * 🔵 ③④ 는 원본을 글자로 읽어 본다 — 액션은 `"use server"` 모듈이라 이 틀에서 불러
 *    실행할 수 없고(이 저장소의 오랜 제약), DB 에 붙는 시험은 db 목록의 몫이다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const actionSource = read("src/lib/server/actions/repair-case-flowchart-graph.ts");
const mutationSource = read("src/lib/db/mutations/repair-case-flowchart-graph.ts");
const querySource = read("src/lib/db/queries/repair-case-flowchart-graph.ts");
const screenSource = read("src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx");

/** 길이 n 짜리, **모양은 올바른** 파일 경로 하나. 🔵 손으로 센 글자 수를 믿지 않는다. */
function pathOfLength(n: number): string {
  const prefix = "1. 수리 관련/";
  const suffix = ".pdf";
  return `${prefix}${"a".repeat(n - prefix.length - suffix.length)}${suffix}`;
}

const OK_PATH = "1. 수리 관련/2026/점검 절차.pdf";

describe("① 🔴 길이 — 공용 512 와 DB 400 의 틈을 이 자리에서 메운다", () => {
  test("🔵 먼저 표본 확인 — 만든 글자가 정말 그 길이이고, 모양은 올바르다", () => {
    assert.equal(pathOfLength(400).length, 400);
    assert.equal(pathOfLength(401).length, 401);
    assert.equal(checkQuoteFolderOpenableFilePath(pathOfLength(400)), null, "400자가 모양에서 막히면 아래가 틈을 재는 것이 아니다");
  });

  test("🔵 전제 확인 — 공용 상한은 **여전히 512** 다(이 조각에서 고치지 않았다)", () => {
    assert.equal(QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH, 512);
    // 🔴 바로 이것이 틈이다: 공용 검사는 401자를 **받아들인다**.
    assert.equal(checkQuoteFolderOpenableFilePath(pathOfLength(401)), null);
    assert.equal(checkQuoteFolderRelativePath(pathOfLength(500)), null);
  });

  test("🔴 400자는 받고 401자는 거절한다 — DB CHECK 와 같은 수다", () => {
    const ok = validateNodeShareDocRelativePath(pathOfLength(400));
    assert.equal(ok.ok, true, JSON.stringify(ok));
    if (ok.ok) assert.equal(ok.shareDocRelativePath, pathOfLength(400));

    const tooLong = validateNodeShareDocRelativePath(pathOfLength(401));
    assert.equal(tooLong.ok, false, "401자가 통과했다 — insert 에서 터진다");
    if (!tooLong.ok) assert.ok(tooLong.error.includes("400"), tooLong.error);
  });
});

describe("② 🔴 앞뒤 공백 — `값 = btrim(값)` 과 같게 막는다(다듬지 않는다)", () => {
  test("🔵 전제 확인 — 공용 검사는 **맨 앞 공백을 그대로 지나보낸다**", () => {
    assert.equal(checkQuoteFolderOpenableFilePath(" 1. 수리 관련/점검.pdf"), null);
  });

  test("🔴 앞 공백은 거절한다 — 다듬어 담으면 디스크에 없는 경로가 된다", () => {
    const result = validateNodeShareDocRelativePath(" 1. 수리 관련/점검.pdf");
    assert.equal(result.ok, false);
  });

  test("뒤 공백은 공용 검사가 먼저 막는다(마디 끝 규칙) — 어느 쪽이든 안 들어간다", () => {
    assert.equal(validateNodeShareDocRelativePath("1. 수리 관련/점검.pdf ").ok, false);
  });

  test("🔴 가운데 공백은 그대로 산다 — 공유폴더 이름에는 공백이 흔하다", () => {
    const result = validateNodeShareDocRelativePath(OK_PATH);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.shareDocRelativePath, OK_PATH, "글자를 다듬었다");
  });
});

describe("🔴 안 가리킴 · 모양 · 허용 확장자", () => {
  test("null · undefined 는 「가리킴 지우기」다 — 검사를 한 줄도 안 지난다", () => {
    for (const value of [null, undefined]) {
      const result = validateNodeShareDocRelativePath(value);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.shareDocRelativePath, null);
    }
  });

  test("글자가 아니면 거절 · 빈 글자도 거절(빈 글자는 「지우기」가 아니다)", () => {
    for (const value of [123, {}, [], true]) {
      assert.equal(validateNodeShareDocRelativePath(value).ok, false, String(value));
    }
    assert.equal(validateNodeShareDocRelativePath("").ok, false);
  });

  test("🔴 거슬러 오르기 · 역슬래시 · 드라이브 문자 · 빈 마디를 막는다", () => {
    for (const bad of [
      "1. 수리 관련/../비밀/점검.pdf",
      "..\\점검.pdf",
      "C:/점검.pdf",
      "/점검.pdf",
      "1. 수리 관련//점검.pdf",
      "1. 수리 관련/점검.pdf/",
    ]) {
      assert.equal(validateNodeShareDocRelativePath(bad).ok, false, bad);
    }
  });

  test("🔴 열 수 없는 파일은 가리키지 않는다 — 확장자 목록을 **여기서 다시 적지 않는다**", () => {
    for (const bad of ["1. 수리 관련/설치.exe", "1. 수리 관련/실행.BAT", "1. 수리 관련/문서"]) {
      assert.equal(validateNodeShareDocRelativePath(bad).ok, false, bad);
    }
    for (const good of ["1. 수리 관련/점검.pdf", "1. 수리 관련/체크시트.xlsx", "1. 수리 관련/사진.JPG"]) {
      assert.equal(validateNodeShareDocRelativePath(good).ok, true, good);
    }
    // 판정은 공용 함수 하나가 쥔다 — 검사 모듈이 제 목록을 들지 않는다.
    // 🔵 2026-11-25(조각 E2) — 본체가 flowchart-node-share-doc-path.ts 로 **옮겨 갔다**
    //    (기술 작업 절차 쪽 노드도 같은 칸을 쓴다). 재는 것은 그대로다: 「그 모듈이 제
    //    확장자 목록을 들지 않는가」. 위 import 는 여전히 진단 쪽 모듈을 거쳐 들어온다
    //    (거기서 같은 이름으로 다시 내보낸다) — 그 길이 살아 있는지도 함께 재는 셈이다.
    const validationSource = code(read("src/lib/validation/flowchart-node-share-doc-path.ts"));
    assert.ok(validationSource.includes("checkQuoteFolderOpenableFilePath"));
    for (const forbidden of ["xlsm", "\\.exe", 'endsWith\\("\\.', "lastIndexOf"]) {
      assert.equal(new RegExp(forbidden).test(validationSource), false, `확장자를 직접 센다: ${forbidden}`);
    }
  });
});

describe("③ 🔴 쓰기는 **확인되지 않은 경로**를 담지 않는다", () => {
  test("가리킬 때만 공유폴더를 묻는다 — null 은 그 검사를 지나지 않는다", () => {
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
    // 🔴 조용히 통과하는 길(= 루트가 없을 때 그냥 담는 길)이 없다.
    assert.equal(action.includes('status: "disabled"'), false, "쓰기 쪽에 조용히 꺼지는 길이 생겼다");
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
      action.indexOf("validateNodeShareDocRelativePath(input.shareDocRelativePath)") <
        action.indexOf("resolveRepairDocsArchiveRoot()")
    );
  });

  test("🔴 거절 문장에 **경로가 한 글자도** 안 들어간다", () => {
    const action = code(actionSource);
    // shareFolderError 로 나가는 말은 전부 붙박이 글자이거나 저장소 모듈이 만든 사유다.
    // 🔵 `return` 을 함께 찾는 까닭은 **함수를 정의한 줄**까지 세지 않기 위해서다.
    const calls = [...action.matchAll(/return shareFolderError\(([\s\S]*?)\);/g)].map((m) => m[1]);
    assert.equal(calls.length, 4, `거절하는 자리가 ${calls.length}곳이다 — 늘었으면 함께 본다`);
    for (const argument of calls) {
      assert.equal(argument.includes("shareDocRelativePath"), false, `경로를 문장에 실었다: ${argument}`);
      assert.equal(argument.includes("archiveRoot"), false, `루트를 문장에 실었다: ${argument}`);
    }
  });
});

describe("④ 🔴 DB 까지 가는 길에 칸이 하나도 안 빠졌다", () => {
  test("mutation — 파라미터 · 바뀜 판정 · set · before/after 넷 모두", () => {
    const mutation = mutationSource;
    const updateAt = mutation.indexOf("export async function updateRepairCaseFlowchartNode(");
    assert.ok(updateAt > 0, "고치기 mutation 을 못 찾았다");
    const body = mutation.slice(updateAt, mutation.indexOf("export type ChangeNodeTypeResult"));
    assert.ok(body.includes("shareDocRelativePath: string | null;"), "파라미터에 칸이 없다");
    assert.ok(
      body.includes("node.shareDocRelativePath !== params.shareDocRelativePath"),
      "🔴 바뀜 판정에서 빠졌다 — 파일만 바꾼 저장이 changed:false 로 조용히 끝난다"
    );
    assert.ok(body.includes("shareDocRelativePath: node.shareDocRelativePath,"), "beforeState 에서 빠졌다");
    assert.equal(
      body.match(/shareDocRelativePath: params\.shareDocRelativePath,/g)?.length,
      2,
      "afterState · set() 가운데 한쪽이 빠졌다"
    );
  });

  test("🔴 지우는 쪽 이력 — 노드 스냅숏에도 그 칸이 있다(진짜 DELETE 라 여기에만 남는다)", () => {
    assert.ok(mutationSource.includes("shareDocRelativePath: node.shareDocRelativePath,"));
  });

  test("🔴 조회가 그 칸을 **읽어 온다** — 안 읽으면 새로 고칠 때마다 지워진 것처럼 보인다", () => {
    assert.ok(querySource.includes("shareDocRelativePath: repairCaseFlowchartNodes.shareDocRelativePath,"));
    assert.ok(querySource.includes("shareDocRelativePath: string | null;"));
  });

  test("🔴 화면이 보내는 값을 **다듬지 않는다** — 다듬으면 없는 파일이 된다", () => {
    const screen = code(screenSource);
    assert.ok(screen.includes("shareDocRelativePath: draft.shareDocRelativePath,"), "저장 걸음이 그 칸을 안 싣는다");
    for (const forbidden of [
      "shareDocRelativePath: draft.shareDocRelativePath.trim()",
      "shareDocRelativePath: draft.shareDocRelativePath?.trim()",
    ]) {
      assert.equal(screen.includes(forbidden), false, `글자를 다듬는다: ${forbidden}`);
    }
    // 받침에서 읽어 오는 자리도 있다(초안의 첫 값).
    assert.ok(screen.includes("shareDocRelativePath: serverNode?.shareDocRelativePath ?? null,"));
  });
});
