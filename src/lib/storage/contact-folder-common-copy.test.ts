import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  CONTACT_FOLDER_COMMON_FOLDER_NAME,
  CONTACT_FOLDER_DATA_FOLDER_NAME,
} from "@/lib/domain/contact-folder-naming";
import { copyIntoContactFolderCommonFolder, type ContactFolderCopy } from "./contact-folder-archive";

/*
 * ============================================================================
 * 종류 공통 서류 — `공통` 폴더에 꽂기, mkdtemp 임시 폴더에서만 (2026-10-06)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더에 닿지 않는다.
 * 루트를 `root` 인자로 직접 넘기므로 `CONTACT_FOLDER_ARCHIVE_DIR` 을 보지 않는다.
 * 끝나면 만든 임시 폴더를 통째로 지운다. 고객사 · 모델 · S/N 은 가짜다.
 *
 * 못 박는 것:
 *  · 🔴 **`공통` 에 꽂는다** — `DATA` 도 분류 폴더도 아니다(자리가 셋이 되었다)
 *  · 🔴 폴더 이름에 **대괄호가 없다** — `[공통]` 이 아니다(`DATA` 와 같은 까닭)
 *  · 🔴 `공통` 이 **없으면 만든다** · 있으면 그대로 쓰고 안의 파일을 건드리지 않는다
 *  · 🔴 **연락서 폴더는 만들지 않는다** — 없으면 `no-folder`, 여럿이면 고르지 않는다
 *  · 🔴 **덮어쓰지 않는다** — 같은 이름이 있으면 ` (2)` 이고 원본 내용이 안 바뀐다
 *  · 🔴 **같은 서류를 두 번 꽂으면 두 번째는 안 쓴다**(`unchanged`) — 접수가 여러 번
 *       불려도 안전해야 한다(`found` 에서도 꽂는 까닭)
 *  · 🔴 여러 장을 **낱개로** 꽂는다(ZIP 으로 묶지 않는다)
 *  · 설정이 비면 아무 일도 하지 않는다 · 사유에 경로가 없다
 *
 * 꽂기의 공통 규율(NFC/NFD · 길이 상한 · 번호 상한)은 이웃 contact-folder-copy.test.ts 가
 * 본다 — 같은 `put` 을 지나므로 여기서 되풀이하지 않는다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-common-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const INTAKE = "D261006";
const FOLDER = "D261006 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";
/** 🔴 폴더 이름을 베끼지 않는다 — domain 이 정한 상수를 그대로 쓴다. */
const COMMON = CONTACT_FOLDER_COMMON_FOLDER_NAME;
/** 꽂았을 때 늘 함께 오는 「어디에 넣었는가」. */
const IN_COMMON = { categoryFolderName: COMMON, categoryFolderBlockedByFile: false };

async function makeRootWithFolder(folderName: string = FOLDER): Promise<string> {
  const root = await makeRoot();
  await mkdir(path.join(root, folderName));
  return root;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function save(root: string, originalFileName: string, content: string): Promise<ContactFolderCopy> {
  return copyIntoContactFolderCommonFolder({
    root,
    intakeNumber: INTAKE,
    originalFileName,
    bytes: bytes(content),
  });
}

/** `공통` 안의 이름들. */
async function commonNames(root: string, folderName: string = FOLDER): Promise<string[]> {
  return (await readdir(path.join(root, folderName, COMMON))).sort();
}

/** 연락서 폴더 맨 위 칸. */
async function folderTop(root: string, folderName: string = FOLDER): Promise<string[]> {
  return (await readdir(path.join(root, folderName))).sort();
}

async function contentOf(root: string, name: string, folderName: string = FOLDER): Promise<string> {
  return (await readFile(path.join(root, folderName, COMMON, name))).toString("utf8");
}

test("🔴 `공통` 에 꽂는다 — 이름에 대괄호가 없고 `DATA` 와도 다른 자리다", async () => {
  const root = await makeRootWithFolder();

  const result = await save(root, "제너레이터-기본파라미터.pdf", "파라미터");

  assert.deepEqual(result, {
    status: "copied",
    folderName: FOLDER,
    fileName: "제너레이터-기본파라미터.pdf",
    ...IN_COMMON,
  });
  assert.deepEqual(await commonNames(root), ["제너레이터-기본파라미터.pdf"]);
  // 🔴 값으로 못 박는다 — `[공통]` 이 아니다.
  assert.equal(CONTACT_FOLDER_COMMON_FOLDER_NAME, "공통");
  assert.equal(/[[\]]/.test(CONTACT_FOLDER_COMMON_FOLDER_NAME), false, "폴더 이름에 대괄호가 들어갔다");
  // 🔴 `DATA` 와 다른 폴더다 — 맨 위 칸에 `공통` 하나뿐이고 분류 폴더도 안 생긴다.
  assert.notEqual(CONTACT_FOLDER_COMMON_FOLDER_NAME, CONTACT_FOLDER_DATA_FOLDER_NAME);
  assert.deepEqual(await folderTop(root), [COMMON]);
});

test("🔴 `공통` 이 없으면 만든다 — 지난 접수 건의 폴더에는 없다", async () => {
  const root = await makeRootWithFolder();
  assert.deepEqual(await folderTop(root), [], "미리 공통 이 있으면 이 시험이 뜻을 잃는다");

  const result = await save(root, "점검표.xlsx", "a");

  assert.equal(result.status, "copied");
  assert.deepEqual(await folderTop(root), [COMMON]);
  assert.deepEqual(await commonNames(root), ["점검표.xlsx"]);
});

test("`공통` 이 이미 있으면 그대로 쓴다 — 안에 있던 파일도 그대로다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, FOLDER, COMMON));
  await writeFile(path.join(root, FOLDER, COMMON, "사람이 넣은 것.txt"), "손으로");

  const result = await save(root, "점검표.xlsx", "a");

  assert.equal(result.status, "copied");
  assert.deepEqual(await commonNames(root), ["사람이 넣은 것.txt", "점검표.xlsx"].sort());
  assert.equal(await contentOf(root, "사람이 넣은 것.txt"), "손으로");
});

test("🔴 연락서 폴더가 없으면 **만들지 않고** 알린다", async () => {
  const root = await makeRoot();

  const result = await save(root, "점검표.xlsx", "a");

  assert.deepEqual(result, { status: "no-folder" });
  // 🔴 루트에 아무것도 생기지 않았다.
  assert.deepEqual((await readdir(root)).sort(), []);
});

test("🔴 맞는 폴더가 여럿이면 고르지 않는다 — 아무 데도 꽂지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, `${FOLDER} (1)`));
  await mkdir(path.join(root, `${FOLDER} (2)`));

  const result = await save(root, "점검표.xlsx", "a");

  assert.equal(result.status, "multiple");
  assert.deepEqual(await folderTop(root, `${FOLDER} (1)`), []);
  assert.deepEqual(await folderTop(root, `${FOLDER} (2)`), []);
});

test("🔴 덮어쓰지 않는다 — 같은 이름이 있으면 ` (2)` 이고 그 파일 내용이 안 바뀐다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, FOLDER, COMMON));
  await writeFile(path.join(root, FOLDER, COMMON, "점검표.xlsx"), "직원이 넣은 것");

  const result = await save(root, "점검표.xlsx", "앱이 넣은 것");

  assert.deepEqual(result, { status: "copied", folderName: FOLDER, fileName: "점검표 (2).xlsx", ...IN_COMMON });
  assert.equal(await contentOf(root, "점검표.xlsx"), "직원이 넣은 것");
  assert.equal(await contentOf(root, "점검표 (2).xlsx"), "앱이 넣은 것");
});

test("🔴 같은 서류를 두 번 꽂으면 두 번째는 안 쓴다 — 접수가 여러 번 불려도 쌓이지 않는다", async () => {
  const root = await makeRootWithFolder();

  const first = await save(root, "제너레이터-점검표.xlsx", "같은 바이트");
  const second = await save(root, "제너레이터-점검표.xlsx", "같은 바이트");

  assert.deepEqual(first, {
    status: "copied",
    folderName: FOLDER,
    fileName: "제너레이터-점검표.xlsx",
    ...IN_COMMON,
  });
  // 🔴 `unchanged` — 디스크에 새로 쓴 것이 없다. 그래서 감사 기록도 남지 않는다.
  assert.deepEqual(second, {
    status: "unchanged",
    folderName: FOLDER,
    fileName: "제너레이터-점검표.xlsx",
    ...IN_COMMON,
  });
  assert.deepEqual(await commonNames(root), ["제너레이터-점검표.xlsx"]);
});

test("🔴 여러 장을 낱개로 꽂는다 — ZIP 으로 묶지 않는다", async () => {
  const root = await makeRootWithFolder();

  await save(root, "제너레이터-기본파라미터.pdf", "하나");
  await save(root, "제너레이터-점검표.xlsx", "둘");

  assert.deepEqual(await commonNames(root), ["제너레이터-기본파라미터.pdf", "제너레이터-점검표.xlsx"].sort());
  // 묶음 파일이 하나도 없다.
  assert.equal(
    (await commonNames(root)).some((name) => name.toLowerCase().endsWith(".zip")),
    false,
    "🔴 묶어서 꽂았다"
  );
});

test("🔴 `공통` 이라는 **파일**이 자리를 막으면 폴더 바로 아래로 비켜 가고, 그 파일을 지우지 않는다", async () => {
  const root = await makeRootWithFolder();
  await writeFile(path.join(root, FOLDER, COMMON), "사람이 넣은 파일");

  const result = await save(root, "점검표.xlsx", "a");

  assert.deepEqual(result, {
    status: "copied",
    folderName: FOLDER,
    fileName: "점검표.xlsx",
    categoryFolderName: null,
    categoryFolderBlockedByFile: true,
  });
  assert.deepEqual(await folderTop(root), [COMMON, "점검표.xlsx"].sort());
  // 🔴 막은 파일은 그대로다.
  assert.equal((await readFile(path.join(root, FOLDER, COMMON))).toString("utf8"), "사람이 넣은 파일");
});

test("설정이 비면 아무 일도 하지 않는다", async () => {
  assert.deepEqual(
    await copyIntoContactFolderCommonFolder({
      root: "",
      intakeNumber: INTAKE,
      originalFileName: "a.xlsx",
      bytes: bytes("a"),
    }),
    { status: "disabled" }
  );
  assert.deepEqual(
    await copyIntoContactFolderCommonFolder({
      root: "   ",
      intakeNumber: INTAKE,
      originalFileName: "a.xlsx",
      bytes: bytes("a"),
    }),
    { status: "disabled" }
  );
});

test("🔴 사유에 경로 · 루트 값이 섞이지 않는다", async () => {
  const root = await makeRoot();
  await rm(root, { recursive: true, force: true });

  const result = await save(root, "점검표.xlsx", "a");

  assert.equal(result.status, "failed");
  if (result.status !== "failed") throw new Error("unreachable");
  assert.ok(result.reason.length > 0);
  assert.ok(!result.reason.includes(root), `사유에 루트가 들어 있다: ${result.reason}`);
  assert.ok(!result.reason.includes(os.tmpdir()), `사유에 임시 폴더 경로가 들어 있다: ${result.reason}`);
  assert.ok(!/[\\/]/.test(result.reason), `사유에 경로 구분자가 들어 있다: ${result.reason}`);
});

test("인수번호가 비면 디스크를 보지 않고 끝난다", async () => {
  const root = await makeRootWithFolder();

  const result = await copyIntoContactFolderCommonFolder({
    root,
    intakeNumber: "   ",
    originalFileName: "점검표.xlsx",
    bytes: bytes("a"),
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(await folderTop(root), []);
});

test("🔴 `공통` 한 겹이 들어가도 파일 이름 상한이 그것을 덮는다 — 분류 폴더보다 짧다", async () => {
  // 파일 이름 상한(84)은 **가장 긴 분류 폴더 이름(10 자)**을 가정해 뽑은 값이다
  // (domain/contact-folder-naming.ts 의 계산식). `공통` 은 2 자라 더 짧으므로 같은
  // 상한이 그대로 덮는다 — 경로가 가장 길 때 49+1+72+1+2+1+84 = 210 ≤ 218.
  const EXCEL_PATH_LIMIT = 218;
  const worst = 49 + 1 + 72 + 1 + COMMON.length + 1 + 84;
  assert.ok(worst <= EXCEL_PATH_LIMIT, `가장 긴 경로가 엑셀 한도를 넘는다: ${worst}`);
  assert.ok(COMMON.length <= 10, "공통 폴더 이름이 분류 폴더 상한보다 길다 — 상한을 다시 뽑아야 한다");
});
