import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { attachmentCategoryLabels, type AttachmentCategory } from "@/lib/domain/attachment-category";
import {
  CONTACT_FOLDER_FILE_MAX_NAME_BYTES,
  CONTACT_FOLDER_FILE_MAX_NAME_LENGTH,
  CONTACT_FOLDER_MAX_NUMBERED_COPIES,
} from "@/lib/domain/contact-folder-naming";
import { copyIntoContactFolder, type ContactFolderCopy } from "./contact-folder-archive";

/*
 * ============================================================================
 * 연락서 폴더에 **사본 꽂기** — mkdtemp 임시 폴더에서만 (연락서 조각 6)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더
 * (`\\192.168.0.222\…`)에 닿지 않는다. 끝나면 만든 임시 폴더를 통째로 지운다.
 * 고객사 · 모델 · S/N 은 가짜다(저장소가 공개다).
 *
 * 못 박는 것:
 *  · 🔴 **덮어쓰지 않는다** — 같은 이름이 있으면 ` (2)` 이고 **원본 내용이 안 바뀐다**
 *  · 🔴 **NFC/NFD** — 디스크에 풀어쓴(NFD) 한글 이름이 있으면 모아쓴(NFC) 이름도
 *       같은 이름으로 보고 ` (2)` 로 간다(똑같아 보이는 파일이 둘 생기지 않는다)
 *  · 내용이 같으면 **새로 쓰지 않는다** — 번호가 쌓이지 않는다
 *  · 🔴 **긴 이름** — 글자 수와 **바이트 수**를 둘 다 지키고, 줄기만 잘린다
 *  · 🔴 **폴더가 없으면 만들지 않고** 건너뛴다 · 여럿이면 고르지 않는다
 *  · 설정이 비면 아무 일도 하지 않는다
 * 쓰기 · 지우기 금지는 contact-folder-archive-source.test.ts 가 원본 글자로 본다.
 *
 * ── 🔴 2026-10-05 조각 11 — 파일이 **분류 폴더 안**으로 들어갔다 ─────────
 * 조각 6 은 연락서 폴더 **바로 아래**에 꽂았다. 이제 `연락서폴더/인수 사진/…` 처럼 그
 * 파일의 분류 이름표로 된 하위 폴더 안이다. 그래서 이 파일의 아래 도우미들
 * (fileNames · contentOf)이 **한 겹 더 들어가** 본다 — 못 박는 규율(덮어쓰지 않기 ·
 * NFC/NFD · 내용 같으면 안 쓰기 · 번호 상한)은 **한 글자도 느슨해지지 않았다.**
 * 분류 폴더 자체의 규율(없으면 만들기 · 파일이 막으면 비켜 가기 · 이름표 쓰기)은
 * 이웃 contact-folder-subfolders.test.ts 가 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-copy-test-"));
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
/** 이 파일은 분류 하나로만 본다 — 분류별 규율은 contact-folder-subfolders.test.ts 가 본다. */
const CATEGORY: AttachmentCategory = "INTAKE_PHOTO";
/** 🔴 폴더 이름은 **한글 이름표**다(코드가 아니다) — 값을 베끼지 않고 목록에서 가져온다. */
const CATEGORY_FOLDER = attachmentCategoryLabels[CATEGORY];
/** 꽂았을 때 늘 함께 오는 「어디에 넣었는가」. */
const IN_CATEGORY = { categoryFolderName: CATEGORY_FOLDER, categoryFolderBlockedByFile: false };

/** 루트 하나와 그 안의 연락서 폴더 하나. */
async function makeRootWithFolder(folderName: string = FOLDER): Promise<string> {
  const root = await makeRoot();
  await mkdir(path.join(root, folderName));
  return root;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function copy(root: string, originalFileName: string, content: string): Promise<ContactFolderCopy> {
  return copyIntoContactFolder({
    root,
    intakeNumber: INTAKE,
    category: CATEGORY,
    originalFileName,
    bytes: bytes(content),
  });
}

/** 🔴 조각 11 — 파일은 **분류 폴더 안**에 있다. 한 겹 더 들어가 본다. */
async function fileNames(root: string, folderName: string = FOLDER): Promise<string[]> {
  return (await readdir(path.join(root, folderName, CATEGORY_FOLDER))).sort();
}

/** 연락서 폴더 **맨 위 칸** — 분류 폴더가 하나 서 있고 파일은 없어야 한다. */
async function folderTop(root: string, folderName: string = FOLDER): Promise<string[]> {
  return (await readdir(path.join(root, folderName))).sort();
}

async function contentOf(root: string, name: string, folderName: string = FOLDER): Promise<string> {
  return (await readFile(path.join(root, folderName, CATEGORY_FOLDER, name))).toString("utf8");
}

/**
 * 직원이 손으로 넣어 둔 파일 하나 — **분류 폴더 안**에 둔다(앱이 꽂는 바로 그 자리다).
 * 그 자리에 같은 이름이 있을 때 앱이 어떻게 하는가가 이 파일이 보는 것이다.
 */
async function putByHand(root: string, name: string, content: string, folderName: string = FOLDER): Promise<void> {
  const directory = path.join(root, folderName, CATEGORY_FOLDER);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), content);
}

function assertFailedWithoutPath(result: ContactFolderCopy, root: string): string {
  assert.equal(result.status, "failed");
  if (result.status !== "failed") throw new Error("unreachable");
  const { reason } = result;
  assert.ok(reason.length > 0);
  // 사유는 화면 · 응답으로 나간다 — 경로 · 루트 값이 섞이면 안 된다.
  assert.ok(!reason.includes(root), `사유에 루트가 들어 있다: ${reason}`);
  assert.ok(!reason.includes(path.basename(root)), `사유에 루트 이름이 들어 있다: ${reason}`);
  assert.ok(!reason.includes(os.tmpdir()), `사유에 임시 폴더 경로가 들어 있다: ${reason}`);
  assert.ok(!/[\\/]/.test(reason), `사유에 경로 구분자가 들어 있다: ${reason}`);
  return reason;
}

test("사람이 읽는 이름 그대로 꽂는다 — 🔴 분류 라벨을 앞에 붙이지 않는다", async () => {
  const root = await makeRootWithFolder();

  const result = await copy(root, "IMG_2847.jpg", "사진");

  assert.deepEqual(result, { status: "copied", folderName: FOLDER, fileName: "IMG_2847.jpg", ...IN_CATEGORY });
  assert.deepEqual(await fileNames(root), ["IMG_2847.jpg"]);
  assert.equal(await contentOf(root, "IMG_2847.jpg"), "사진");
  // 🔴 맨 위 칸에는 **분류 폴더만** 선다 — 파일은 한 겹 안이다(조각 11).
  assert.deepEqual(await folderTop(root), [CATEGORY_FOLDER]);
});

test("🔴 덮어쓰지 않는다 — 같은 이름이 있으면 ` (2)` 이고 원본은 한 글자도 안 바뀐다", async () => {
  const root = await makeRootWithFolder();
  // 직원이 손으로 넣어 둔 파일. 같은 이름이면 **그것은 남의 파일이다.**
  await putByHand(root, "IMG_2847.jpg", "직원이 손으로 넣은 것");

  const result = await copy(root, "IMG_2847.jpg", "앱이 올린 것");

  assert.deepEqual(result, { status: "copied", folderName: FOLDER, fileName: "IMG_2847 (2).jpg", ...IN_CATEGORY });
  assert.deepEqual(await fileNames(root), ["IMG_2847 (2).jpg", "IMG_2847.jpg"]);
  assert.equal(await contentOf(root, "IMG_2847.jpg"), "직원이 손으로 넣은 것", "🔴 남의 파일을 덮어썼다");
  assert.equal(await contentOf(root, "IMG_2847 (2).jpg"), "앱이 올린 것");
});

test("🔴 NFD 로 앉은 한글 이름도 같은 이름으로 본다 — 똑같아 보이는 파일이 둘 생기지 않는다", async () => {
  const root = await makeRootWithFolder();
  const nfd = "외관사진.jpg".normalize("NFD");
  const nfc = "외관사진.jpg".normalize("NFC");
  assert.notEqual(nfd, nfc, "시험 전제가 깨졌다 — 두 모양이 같다");
  // 사람이 Mac · 옛 DSM 웹에서 올린 이름은 디스크에 풀어쓴 모양으로 앉는다.
  await putByHand(root, nfd, "먼저 있던 것");

  const result = await copy(root, nfc, "앱이 올린 것");

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  assert.equal(result.fileName, "외관사진 (2).jpg");
  const names = await fileNames(root);
  assert.equal(names.length, 2, `똑같아 보이는 파일이 둘 생겼다: ${JSON.stringify(names)}`);
  assert.equal(await contentOf(root, nfd), "먼저 있던 것", "🔴 풀어쓴 이름의 파일을 덮어썼다");
});

test("내용이 같으면 새로 쓰지 않는다 — 같은 사진을 열 번 올려도 번호가 안 쌓인다", async () => {
  const root = await makeRootWithFolder();

  const first = await copy(root, "IMG_2847.jpg", "같은 사진");
  assert.equal(first.status, "copied");

  for (let n = 0; n < 9; n += 1) {
    const again = await copy(root, "IMG_2847.jpg", "같은 사진");
    assert.deepEqual(again, { status: "unchanged", folderName: FOLDER, fileName: "IMG_2847.jpg", ...IN_CATEGORY });
  }
  assert.deepEqual(await fileNames(root), ["IMG_2847.jpg"]);
});

test("내용이 같은 파일이 **번호 자리**에 있어도 새로 쓰지 않는다 — NFD 이름이어도", async () => {
  const root = await makeRootWithFolder();
  await putByHand(root, "외관사진.jpg", "다른 것");
  await putByHand(root, "외관사진 (2).jpg".normalize("NFD"), "같은 사진");

  const result = await copy(root, "외관사진.jpg", "같은 사진");

  assert.equal(result.status, "unchanged", JSON.stringify(result));
  assert.equal((await fileNames(root)).length, 2, "같은 내용이 있는데 하나 더 썼다");
});

test("🔴 폴더가 없으면 만들지 않고 건너뛴다 — 루트가 빈 채로 남는다", async () => {
  const root = await makeRoot();

  const result = await copy(root, "IMG_2847.jpg", "사진");

  assert.deepEqual(result, { status: "no-folder" });
  assert.deepEqual(await readdir(root), [], "🔴 폴더나 파일을 만들었다");
});

test("🔴 맞는 폴더가 여럿이면 고르지 않는다 — 아무것도 쓰지 않는다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, "D260908 INVENIA 나중에 또 만든 폴더"));

  const result = await copy(root, "IMG_2847.jpg", "사진");

  assert.equal(result.status, "multiple", JSON.stringify(result));
  if (result.status !== "multiple") throw new Error("unreachable");
  assert.equal(result.folderNames.length, 2);
  for (const folder of result.folderNames) {
    assert.deepEqual(await readdir(path.join(root, folder)), [], "고르지 않기로 해 놓고 썼다");
  }
});

test("사람이 적어 둔 폴더 이름(소문자 · 공백 두 칸)에도 꽂는다 — 디스크의 실제 이름으로 잇는다", async () => {
  const human = "d260908  INVENIA 옛날에 만든 폴더";
  const root = await makeRootWithFolder(human);

  const result = await copy(root, "IMG_2847.jpg", "사진");

  assert.deepEqual(result, { status: "copied", folderName: human, fileName: "IMG_2847.jpg", ...IN_CATEGORY });
  assert.deepEqual(await fileNames(root, human), ["IMG_2847.jpg"]);
});

test("🔴 긴 이름 — 글자 수와 바이트 수를 둘 다 지키고 줄기만 잘린다 (한글)", async () => {
  const root = await makeRootWithFolder();
  const long = `${"가".repeat(200)}.jpg`;

  const result = await copy(root, long, "사진");

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  const written = result.fileName;
  // 🔴 확장자는 자르지 않는다 — 줄기만 줄어든다.
  assert.ok(written.endsWith(".jpg"), written);
  assert.ok(/^가+\.jpg$/.test(written), written);
  // 🔴 두 상한을 **둘 다** 지킨다.
  assert.ok(written.length <= CONTACT_FOLDER_FILE_MAX_NAME_LENGTH, `${written.length} 자`);
  assert.ok(
    new TextEncoder().encode(written).length <= CONTACT_FOLDER_FILE_MAX_NAME_BYTES,
    `${new TextEncoder().encode(written).length} 바이트`
  );
  // 🔴 조각 11 에서 글자 수 상한이 95 → 84 로 내려가(분류 폴더가 한 겹 더 들어갔다) 한글도
  //    **글자 수 쪽이 먼저** 걸린다 — 조각 6 에서는 바이트 쪽이 먼저 걸려 85 자였다.
  //    바이트 상한은 그대로 두었다(NAS 의 진짜 한도이고, 글자 수를 올리면 다시 먼저 걸린다).
  assert.equal(written.length, 78, "상한에서 멈추는 자리가 달라졌다");
  assert.deepEqual(await fileNames(root), [written]);

  // 🔴 번호 꼬리가 붙어도 두 상한 안이다 — 꼬리 자리를 미리 빼 두었기 때문이다.
  const second = await copy(root, long, "다른 사진");
  assert.equal(second.status, "copied", JSON.stringify(second));
  if (second.status !== "copied") throw new Error("unreachable");
  assert.ok(second.fileName.endsWith(" (2).jpg"), second.fileName);
  assert.ok(second.fileName.length <= CONTACT_FOLDER_FILE_MAX_NAME_LENGTH);
  assert.ok(new TextEncoder().encode(second.fileName).length <= CONTACT_FOLDER_FILE_MAX_NAME_BYTES);
});

test("🔴 긴 이름 — 영문도 글자 수 쪽에서 멈춘다", async () => {
  const root = await makeRootWithFolder();

  const result = await copy(root, `${"a".repeat(200)}.jpg`, "사진");

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  assert.ok(/^a+\.jpg$/.test(result.fileName), result.fileName);
  assert.equal(result.fileName.length, 78, "글자 상한에서 멈추는 자리가 달라졌다");
  assert.ok(result.fileName.length <= CONTACT_FOLDER_FILE_MAX_NAME_LENGTH);
});

test("금지 글자 · 끝의 점은 다듬어 꽂는다 — 경로를 거슬러 오르는 이름이 생기지 않는다", async () => {
  const root = await makeRootWithFolder();

  const result = await copy(root, "..\\..\\위험한:이름?.jpg", "사진");

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  assert.equal(/[\\/:*?"<>|]/.test(result.fileName), false, result.fileName);
  assert.deepEqual(await fileNames(root), [result.fileName]);
  // 폴더 밖으로 새어 나간 것이 없다.
  assert.deepEqual(await readdir(root), [FOLDER]);
});

test("쓸 수 있는 글자가 하나도 없는 이름이면 failed — 디스크를 건드리지 않는다", async () => {
  const root = await makeRootWithFolder();

  const reason = assertFailedWithoutPath(await copy(root, "...jpg", ""), root);

  assert.match(reason, /파일 이름/);
  // 🔴 분류 폴더조차 만들지 않았다 — 이름을 먼저 짓고 그 뒤에 디스크를 본다.
  assert.deepEqual(await folderTop(root), [], "이름을 못 지었는데 무엇인가 생겼다");
});

test("인수번호가 비면 failed — 디스크를 보지 않는다", async () => {
  const root = await makeRootWithFolder();

  for (const intakeNumber of ["", "   "]) {
    const result = await copyIntoContactFolder({
      root,
      intakeNumber,
      category: CATEGORY,
      originalFileName: "IMG_2847.jpg",
      bytes: bytes("사진"),
    });
    assert.match(assertFailedWithoutPath(result, root), /인수번호/);
  }
  assert.deepEqual(await folderTop(root), []);
});

test("🔴 루트가 없으면 루트를 만들지 않고 failed — 사유에 경로가 없다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  const result = await copyIntoContactFolder({
    root: missingRoot,
    intakeNumber: INTAKE,
    category: CATEGORY,
    originalFileName: "IMG_2847.jpg",
    bytes: bytes("사진"),
  });

  assert.match(assertFailedWithoutPath(result, missingRoot), /공유폴더를 찾을 수 없습니다/);
  assert.deepEqual(await readdir(parent), [], "🔴 루트가 생겼다");
});

test("🔴 설정이 비면 disabled — 아무 일도 하지 않는다", async () => {
  const original = process.env.CONTACT_FOLDER_ARCHIVE_DIR;
  try {
    delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    const input = {
      intakeNumber: INTAKE,
      category: CATEGORY,
      originalFileName: "IMG_2847.jpg",
      bytes: bytes("사진"),
    };
    assert.deepEqual(await copyIntoContactFolder(input), { status: "disabled" });
    assert.deepEqual(await copyIntoContactFolder({ ...input, root: "   " }), { status: "disabled" });
  } finally {
    if (original === undefined) delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    else process.env.CONTACT_FOLDER_ARCHIVE_DIR = original;
  }
});

test("🔴 동시에 네 장을 올려도 덮어쓰기 0 — 네 파일이 각각 온전하다", async () => {
  const root = await makeRootWithFolder();

  const results = await Promise.all([
    copy(root, "IMG_2847.jpg", "첫째"),
    copy(root, "IMG_2847.jpg", "둘째"),
    copy(root, "IMG_2847.jpg", "셋째"),
    copy(root, "IMG_2847.jpg", "넷째"),
  ]);

  for (const result of results) assert.equal(result.status, "copied", JSON.stringify(result));
  const names = await fileNames(root);
  assert.equal(names.length, 4, `파일이 넷이 아니다: ${JSON.stringify(names)}`);
  const contents = await Promise.all(names.map((name) => contentOf(root, name)));
  assert.deepEqual([...contents].sort(), ["넷째", "둘째", "셋째", "첫째"].sort(), "덮어쓴 것이 있다");
});

test(`번호 상한(${CONTACT_FOLDER_MAX_NUMBERED_COPIES})은 견적서의 99 보다 크다 — 사진이 수십 장 들어가는 폴더다`, async () => {
  assert.ok(CONTACT_FOLDER_MAX_NUMBERED_COPIES > 99);
  const root = await makeRootWithFolder();
  // 견적서 상한(99)까지 꽉 찬 폴더 — 내용은 길이가 다 달라 「같은 내용」에 걸리지 않는다.
  await putByHand(root, "IMG_2847.jpg", "x");
  for (let n = 2; n <= 99; n += 1) {
    await putByHand(root, `IMG_2847 (${n}).jpg`, "x".repeat(n));
  }

  // 100 번째도 막히지 않는다(견적서 상한이었다면 여기서 failed 였다).
  const result = await copy(root, "IMG_2847.jpg", "백 번째 사진");

  assert.deepEqual(result, { status: "copied", folderName: FOLDER, fileName: "IMG_2847 (100).jpg", ...IN_CATEGORY });
  assert.equal((await fileNames(root)).length, 100);
});
