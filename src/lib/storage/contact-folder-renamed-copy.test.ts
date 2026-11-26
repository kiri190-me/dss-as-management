import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  CONTACT_FOLDER_COMMON_FOLDER_NAME,
  CONTACT_FOLDER_FILE_MAX_NAME_LENGTH,
} from "@/lib/domain/contact-folder-naming";
import {
  checkContactFolderSaveFileName,
  contactFolderSaveFileName,
} from "@/lib/domain/contact-folder-save-file-name";
import { copyIntoContactFolderCommonFolder, type ContactFolderCopy } from "./contact-folder-archive";

/*
 * ============================================================================
 * [연락서 폴더에 저장] — **사람이 적은 이름으로 실제로 꽂히는가** (2026-11-26)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더에 닿지 않는다. 루트를
 * `root` 인자로 직접 넘기므로 `CONTACT_FOLDER_ARCHIVE_DIR` 을 보지 않는다. 끝나면 만든
 * 임시 폴더를 통째로 지운다. 인수번호 · 고객사 · 모델 · S/N 은 전부 가짜다.
 *
 * 값 시험(domain/contact-folder-save-file-name.test.ts)은 「무엇이 나가는가」를 재고,
 * 여기서는 **디스크에 무엇이 서는가**를 잰다. 둘을 가르는 까닭: 적은 이름이 다듬기를 지나고
 * 번호 비켜 가기까지 지나야 파일이 서는데, 그 사슬 가운데 하나만 빠져도 값 시험은 전부
 * 통과한다.
 *
 * 못 박는 것:
 *  · 🔴 사람이 적은 이름으로 **그 이름의 파일이 실제로 생긴다**
 *  · 🔴 확장자를 지우고 적어도 **원본 확장자로 선다**
 *  · 🔴 **다듬기를 지난다** — 금지 글자가 걷히고 길이 상한이 그대로 듣는다
 *  · 🔴 **이름이 겹치면 번호가 붙는다** — 먼저 있던 파일이 덮이지 않는다(기존 동작)
 *  · 🔴 같은 바이트면 **새로 안 쓴다**(기존 동작 — 이름을 적어도 그대로다)
 *  · 🔴 **경로를 깨는 이름은 폴더 밖으로 나가지 못한다** — 두 겹 다 재 본다
 *  · 🔴 **안 적으면 원본 이름** — 2026-10-08 부터의 동작이 한 글자도 안 바뀐다
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-rename-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const INTAKE = "D261126";
const FOLDER = "D261126 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";
/** 🔴 폴더 이름을 베끼지 않는다 — domain 이 정한 상수를 그대로 쓴다. */
const COMMON = CONTACT_FOLDER_COMMON_FOLDER_NAME;
/** 가리킴 한 줄이 들고 있는 자리와 그 마지막 마디(가짜). */
const SOURCE_PATH = "2. 인수시 서류/MB 인수시 체크시트.xlsx";
const SOURCE_NAME = "MB 인수시 체크시트.xlsx";

async function makeRootWithFolder(): Promise<string> {
  const root = await makeRoot();
  await mkdir(path.join(root, FOLDER));
  return root;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 통로가 하는 그대로다 — 사람이 적은 글자를 **domain 이 가린 뒤** 꽂는 함수에 넘긴다.
 * 🔴 다듬기를 여기서 미리 하지 않는다(통로도 안 한다).
 */
function save(root: string, typed: string | null, content: string): Promise<ContactFolderCopy> {
  return copyIntoContactFolderCommonFolder({
    root,
    intakeNumber: INTAKE,
    originalFileName: contactFolderSaveFileName(typed, SOURCE_NAME),
    bytes: bytes(content),
  });
}

/** `공통` 안의 이름들. */
async function commonNames(root: string): Promise<string[]> {
  return (await readdir(path.join(root, FOLDER, COMMON))).sort();
}

test("🔴 사람이 적은 이름으로 **그 파일이 실제로 선다**", async () => {
  const root = await makeRootWithFolder();
  // 🔵 무엇을 재는지 먼저 — 넣기 전에는 `공통` 이 아예 없다.
  assert.deepEqual(await readdir(path.join(root, FOLDER)), []);

  const result = await save(root, "점검표", "내용");

  assert.equal(result.status, "copied");
  assert.equal(result.status === "copied" && result.fileName, "점검표.xlsx");
  assert.deepEqual(await commonNames(root), ["점검표.xlsx"]);
  assert.equal(await readFile(path.join(root, FOLDER, COMMON, "점검표.xlsx"), "utf8"), "내용");
  // 🔴 원본 이름의 파일은 서지 않는다 — 두 벌이 생기면 사람이 어느 것을 열지 모른다.
  assert.equal((await commonNames(root)).includes(SOURCE_NAME), false);
});

test("🔴 확장자를 지우고 적어도 **원본 확장자로** 선다 — 두 번 눌러 열린다", async () => {
  const root = await makeRootWithFolder();
  await save(root, "점검표", "내용");
  assert.deepEqual(await commonNames(root), ["점검표.xlsx"]);
});

test("🔴 **다듬기를 지난다** — 금지 글자가 걷히고 길이 상한이 그대로 듣는다", async () => {
  const root = await makeRootWithFolder();

  // ① 금지 글자(`:` · `*` · `?`)는 거절형이 통과시키고 다듬기가 걷는다.
  const typed = "점검표:2026*최종?";
  assert.equal(checkContactFolderSaveFileName(typed), null, "거절형이 막았다 — 표본이 틀렸다");
  await save(root, typed, "내용");
  assert.deepEqual(await commonNames(root), ["점검표 2026 최종.xlsx"]);

  // ② 긴 이름은 **줄기만** 깎이고 확장자는 남는다.
  const long = await save(root, "가".repeat(200), "긴 이름");
  assert.equal(long.status, "copied");
  const written = long.status === "copied" ? long.fileName : "";
  assert.ok(written.length <= CONTACT_FOLDER_FILE_MAX_NAME_LENGTH, `${written.length}`);
  assert.ok(written.endsWith(".xlsx"), written);
  assert.ok((await commonNames(root)).includes(written), written);
});

test("🔴 **이름이 겹치면 번호가 붙는다** — 먼저 있던 파일이 덮이지 않는다", async () => {
  const root = await makeRootWithFolder();

  const first = await save(root, "점검표", "첫 번째");
  const second = await save(root, "점검표", "두 번째");

  assert.equal(first.status === "copied" && first.fileName, "점검표.xlsx");
  assert.equal(second.status === "copied" && second.fileName, "점검표 (2).xlsx");
  assert.deepEqual(await commonNames(root), ["점검표 (2).xlsx", "점검표.xlsx"]);
  // 🔴 먼저 있던 내용이 그대로다 — 덮어쓰기가 0 이다.
  assert.equal(await readFile(path.join(root, FOLDER, COMMON, "점검표.xlsx"), "utf8"), "첫 번째");
  assert.equal(await readFile(path.join(root, FOLDER, COMMON, "점검표 (2).xlsx"), "utf8"), "두 번째");
});

test("🔴 사람이 손으로 넣어 둔 같은 이름도 덮지 않는다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, FOLDER, COMMON));
  await writeFile(path.join(root, FOLDER, COMMON, "점검표.xlsx"), "사람이 넣은 것");

  const result = await save(root, "점검표", "앱이 넣는 것");

  assert.equal(result.status === "copied" && result.fileName, "점검표 (2).xlsx");
  assert.equal(await readFile(path.join(root, FOLDER, COMMON, "점검표.xlsx"), "utf8"), "사람이 넣은 것");
});

test("같은 바이트면 **새로 안 쓴다** — 이름을 적어도 기존 동작 그대로다", async () => {
  const root = await makeRootWithFolder();
  await save(root, "점검표", "같은 내용");
  const again = await save(root, "점검표", "같은 내용");

  assert.equal(again.status, "unchanged");
  assert.equal(again.status === "unchanged" && again.fileName, "점검표.xlsx");
  assert.deepEqual(await commonNames(root), ["점검표.xlsx"]);
});

test("🔴 **경로를 깨는 이름은 폴더 밖으로 못 나간다** — 두 겹 다 재 본다", async () => {
  const root = await makeRootWithFolder();

  // ① 첫 겹 — 창도 통로도 이 글자를 거절한다(요청이 여기까지 오지 않는다).
  assert.notEqual(checkContactFolderSaveFileName("../../탈출.xlsx"), null);

  // ② 둘째 겹 — 그래도 꽂는 함수까지 왔다고 치고 재 본다. 이름을 가리는 자리는
  //    **원본 이름으로 되돌리고**, 설령 날것이 그대로 가도 다듬기가 `/` 를 걷는다.
  assert.equal(contactFolderSaveFileName("../../탈출.xlsx", SOURCE_NAME), SOURCE_NAME);
  const raw = await copyIntoContactFolderCommonFolder({
    root,
    intakeNumber: INTAKE,
    originalFileName: "../../탈출.xlsx",
    bytes: bytes("탈출 시도"),
  });

  assert.equal(raw.status, "copied");
  // 🔴 루트 바로 아래에는 연락서 폴더 하나뿐이다 — 옆으로 새어 나간 것이 없다.
  assert.deepEqual(await readdir(root), [FOLDER]);
  // 🔴 그 건의 폴더 안에도 하위 폴더는 `공통` 하나뿐이고, 파일은 그 안에 있다.
  assert.deepEqual(await readdir(path.join(root, FOLDER)), [COMMON]);
  // 🔴 선 이름에 구분자가 한 글자도 없다. (다듬기는 `/` 를 **공백으로 바꿀** 뿐이라
  //    앞의 점들은 이름에 남는다 — 그것은 경로가 아니라 그냥 보기 싫은 이름이고,
  //    사람이 적은 글자를 여기까지 보내지 않는 것이 첫 겹의 몫이다.)
  const names = await commonNames(root);
  assert.equal(names.length, 1, JSON.stringify(names));
  assert.equal(/[\\/]/.test(names[0]), false, names[0]);
  assert.ok(names[0].endsWith("탈출.xlsx"), names[0]);
  assert.equal(await readFile(path.join(root, FOLDER, COMMON, names[0]), "utf8"), "탈출 시도");
});

test("🔴 **안 적으면 원본 이름** — 2026-10-08 의 동작이 한 글자도 안 바뀐다", async () => {
  const root = await makeRootWithFolder();
  // 🔵 가리킨 자리의 마지막 마디가 통로가 넘기는 그 이름이다.
  assert.equal(SOURCE_PATH.split("/").at(-1), SOURCE_NAME);

  for (const empty of [null, "", "   "]) {
    assert.equal(contactFolderSaveFileName(empty, SOURCE_NAME), SOURCE_NAME, JSON.stringify(empty));
  }
  const result = await save(root, null, "내용");

  assert.equal(result.status === "copied" && result.fileName, SOURCE_NAME);
  assert.deepEqual(await commonNames(root), [SOURCE_NAME]);
});
