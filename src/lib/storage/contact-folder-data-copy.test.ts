import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { CONTACT_FOLDER_DATA_FOLDER_NAME } from "@/lib/domain/contact-folder-naming";
import { copyIntoContactFolderDataFolder, type ContactFolderCopy } from "./contact-folder-archive";

/*
 * ============================================================================
 * [DATA에 저장] — `DATA` 폴더에 꽂기, mkdtemp 임시 폴더에서만 (연락서 조각 12)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더에 닿지 않는다.
 * 끝나면 만든 임시 폴더를 통째로 지운다. 고객사 · 모델 · S/N 은 가짜다.
 *
 * 못 박는 것:
 *  · 🔴 **`DATA` 에 꽂는다** — 분류 폴더가 아니다(올리기와 자리가 다르다)
 *  · 🔴 `DATA` 가 **없으면 만든다** — 조각 11 전에 생긴 폴더에는 없기 때문이다
 *  · 🔴 **연락서 폴더는 만들지 않는다** — 없으면 `no-folder`, 여럿이면 고르지 않는다
 *  · 🔴 **덮어쓰지 않는다** — 같은 이름이 있으면 ` (2)` 이고 원본 내용이 안 바뀐다
 *  · 내용이 같으면 **새로 쓰지 않는다**
 *  · 🔴 같은 이름의 **파일**이 `DATA` 자리를 막으면 폴더 바로 아래로 비켜 가고
 *       그 사실을 결과에 싣는다(막은 파일을 지우지 않는다)
 *  · 설정이 비면 아무 일도 하지 않는다 · 사유에 경로가 없다
 *
 * 꽂기의 공통 규율(NFC/NFD · 길이 상한 · 번호 상한)은 이웃 contact-folder-copy.test.ts 가
 * 본다 — 같은 `put` 을 지나므로 여기서 되풀이하지 않는다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-data-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const INTAKE = "D260908";
const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";
/** 🔴 폴더 이름을 베끼지 않는다 — domain 이 정한 상수를 그대로 쓴다. */
const DATA = CONTACT_FOLDER_DATA_FOLDER_NAME;
/** 꽂았을 때 늘 함께 오는 「어디에 넣었는가」. */
const IN_DATA = { categoryFolderName: DATA, categoryFolderBlockedByFile: false };

async function makeRootWithFolder(folderName: string = FOLDER): Promise<string> {
  const root = await makeRoot();
  await mkdir(path.join(root, folderName));
  return root;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function save(root: string, originalFileName: string, content: string): Promise<ContactFolderCopy> {
  return copyIntoContactFolderDataFolder({
    root,
    intakeNumber: INTAKE,
    originalFileName,
    bytes: bytes(content),
  });
}

/** `DATA` 안의 이름들. */
async function dataNames(root: string, folderName: string = FOLDER): Promise<string[]> {
  return (await readdir(path.join(root, folderName, DATA))).sort();
}

/** 연락서 폴더 맨 위 칸. */
async function folderTop(root: string, folderName: string = FOLDER): Promise<string[]> {
  return (await readdir(path.join(root, folderName))).sort();
}

async function contentOf(root: string, name: string, folderName: string = FOLDER): Promise<string> {
  return (await readFile(path.join(root, folderName, DATA, name))).toString("utf8");
}

test("🔴 `DATA` 에 꽂는다 — 분류 폴더가 아니다", async () => {
  const root = await makeRootWithFolder();

  const result = await save(root, "측정값.csv", "1,2,3");

  assert.deepEqual(result, { status: "copied", folderName: FOLDER, fileName: "측정값.csv", ...IN_DATA });
  assert.deepEqual(await dataNames(root), ["측정값.csv"]);
  // 맨 위 칸에는 `DATA` 하나뿐 — 분류 폴더(「인수 사진」 …)가 생기지 않는다.
  assert.deepEqual(await folderTop(root), [DATA]);
});

test("🔴 `DATA` 가 없으면 만든다 — 조각 11 전에 생긴 폴더에는 없다", async () => {
  const root = await makeRootWithFolder();
  assert.deepEqual(await folderTop(root), [], "미리 DATA 가 있으면 이 시험이 뜻을 잃는다");

  const result = await save(root, "파형.csv", "a");

  assert.equal(result.status, "copied");
  assert.deepEqual(await folderTop(root), [DATA]);
  assert.deepEqual(await dataNames(root), ["파형.csv"]);
});

test("`DATA` 가 이미 있으면 그대로 쓴다 — 안에 있던 파일도 그대로다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, FOLDER, DATA));
  await writeFile(path.join(root, FOLDER, DATA, "사람이 넣은 것.txt"), "손으로");

  const result = await save(root, "파형.csv", "a");

  assert.equal(result.status, "copied");
  assert.deepEqual(await dataNames(root), ["사람이 넣은 것.txt", "파형.csv"].sort());
  assert.equal(await contentOf(root, "사람이 넣은 것.txt"), "손으로");
});

test("🔴 연락서 폴더가 없으면 **만들지 않고** 알린다", async () => {
  const root = await makeRoot();

  const result = await save(root, "파형.csv", "a");

  assert.deepEqual(result, { status: "no-folder" });
  // 🔴 루트에 아무것도 생기지 않았다.
  assert.deepEqual((await readdir(root)).sort(), []);
});

test("🔴 맞는 폴더가 여럿이면 고르지 않는다 — 아무 데도 꽂지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, `${FOLDER} (1)`));
  await mkdir(path.join(root, `${FOLDER} (2)`));

  const result = await save(root, "파형.csv", "a");

  assert.equal(result.status, "multiple");
  assert.deepEqual(await folderTop(root, `${FOLDER} (1)`), []);
  assert.deepEqual(await folderTop(root, `${FOLDER} (2)`), []);
});

test("🔴 덮어쓰지 않는다 — 같은 이름이 있으면 ` (2)` 이고 그 파일 내용이 안 바뀐다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, FOLDER, DATA));
  await writeFile(path.join(root, FOLDER, DATA, "파형.csv"), "직원이 넣은 것");

  const result = await save(root, "파형.csv", "앱이 넣은 것");

  assert.deepEqual(result, { status: "copied", folderName: FOLDER, fileName: "파형 (2).csv", ...IN_DATA });
  assert.equal(await contentOf(root, "파형.csv"), "직원이 넣은 것");
  assert.equal(await contentOf(root, "파형 (2).csv"), "앱이 넣은 것");
});

test("내용이 같으면 새로 쓰지 않는다 — 번호가 쌓이지 않는다", async () => {
  const root = await makeRootWithFolder();

  const first = await save(root, "파형.csv", "같은 바이트");
  const second = await save(root, "파형.csv", "같은 바이트");

  assert.deepEqual(first, { status: "copied", folderName: FOLDER, fileName: "파형.csv", ...IN_DATA });
  assert.deepEqual(second, { status: "unchanged", folderName: FOLDER, fileName: "파형.csv", ...IN_DATA });
  assert.deepEqual(await dataNames(root), ["파형.csv"]);
});

test("🔴 `DATA` 라는 **파일**이 자리를 막으면 폴더 바로 아래로 비켜 가고, 그 파일을 지우지 않는다", async () => {
  const root = await makeRootWithFolder();
  await writeFile(path.join(root, FOLDER, DATA), "사람이 넣은 파일");

  const result = await save(root, "파형.csv", "a");

  assert.deepEqual(result, {
    status: "copied",
    folderName: FOLDER,
    fileName: "파형.csv",
    categoryFolderName: null,
    categoryFolderBlockedByFile: true,
  });
  assert.deepEqual(await folderTop(root), [DATA, "파형.csv"].sort());
  // 🔴 막은 파일은 그대로다.
  assert.equal((await readFile(path.join(root, FOLDER, DATA))).toString("utf8"), "사람이 넣은 파일");
});

test("설정이 비면 아무 일도 하지 않는다", async () => {
  assert.deepEqual(await copyIntoContactFolderDataFolder({ root: "", intakeNumber: INTAKE, originalFileName: "a.csv", bytes: bytes("a") }), {
    status: "disabled",
  });
  assert.deepEqual(await copyIntoContactFolderDataFolder({ root: "   ", intakeNumber: INTAKE, originalFileName: "a.csv", bytes: bytes("a") }), {
    status: "disabled",
  });
});

test("🔴 사유에 경로 · 루트 값이 섞이지 않는다", async () => {
  const root = await makeRoot();
  await rm(root, { recursive: true, force: true });

  const result = await save(root, "파형.csv", "a");

  assert.equal(result.status, "failed");
  if (result.status !== "failed") throw new Error("unreachable");
  assert.ok(result.reason.length > 0);
  assert.ok(!result.reason.includes(root), `사유에 루트가 들어 있다: ${result.reason}`);
  assert.ok(!result.reason.includes(os.tmpdir()), `사유에 임시 폴더 경로가 들어 있다: ${result.reason}`);
  assert.ok(!/[\\/]/.test(result.reason), `사유에 경로 구분자가 들어 있다: ${result.reason}`);
});

test("인수번호가 비면 디스크를 보지 않고 끝난다", async () => {
  const root = await makeRootWithFolder();

  const result = await copyIntoContactFolderDataFolder({
    root,
    intakeNumber: "   ",
    originalFileName: "파형.csv",
    bytes: bytes("a"),
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(await folderTop(root), []);
});
