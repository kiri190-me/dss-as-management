import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { attachmentCategoryLabels, type AttachmentCategory } from "@/lib/domain/attachment-category";
import {
  CONTACT_FOLDER_FILE_MAX_NAME_LENGTH,
  CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER,
  CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH,
} from "@/lib/domain/contact-folder-naming";
import {
  copyIntoContactFolder,
  copyIntoContactFolderCommonFolder,
  copyIntoContactFolderDataFolder,
} from "./contact-folder-archive";

/*
 * ============================================================================
 * 올릴 때 적은 **폴더 이름** — 분류 폴더 안에 한 겹 (2026-11-26)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더
 * (`\\192.168.0.222\…`)에 닿지 않는다. 끝나면 만든 임시 폴더를 통째로 지운다.
 * 고객사 · 모델 · S/N 은 가짜다(저장소가 공개다).
 *
 * 사용자 요청: 「파일 이름이 아니라 폴더 이름을 적는 자리로 바꿔서, 적힌 폴더 이름으로
 * 분류 폴더 아래에 폴더를 만들고 파일은 그 안에 저장되도록 해줘. (안 적혀 있다면 그대로
 * 분류 안에 저장되면 돼.)」
 *
 * 못 박는 것:
 *  · 🔴 **적으면** 분류 폴더 **안에** 그 폴더가 서고 파일이 그 안에 들어간다
 *  · 🔴 **안 적으면 2026-11-26 전과 한 글자도 같다** — 분류 폴더에 바로(값으로 맞댄다)
 *  · 🔴 **폴더 밖으로 못 나간다** — `../` 로 적어도 루트 위에 아무것도 안 생긴다
 *  · 🔴 **목록이 감추는 이름**(`.측정` · `~$측정`)으로는 폴더가 안 선다
 *  · 🔴 **이미 있으면 그대로 쓴다** — 안에 든 사람의 파일을 건드리지 않는다
 *  · 🔴 같은 이름의 **파일**이 막으면 **분류 폴더**에 꽂고 그 사실을 싣는다(지우지 않는다)
 *  · 🔴 파일 이름이 겹치면 그 폴더 안에서 ` (2)` — 기존 규율이 그대로 돈다
 *  · 🔴 여러 장은 **같은 폴더**에 들어간다(번호가 파일 이름에 붙지 않는다)
 *  · 🔴 한 겹이 늘어난 만큼 **파일 이름이 63 자로 잘린다**(경로 예산)
 *  · 🔴 [DATA에 저장] · 종류 공통 서류는 **한 글자도 안 바뀐다**(폴더 이름을 안 받는다)
 *
 * 다듬기 · 거절 규칙 자체는 domain/contact-folder-upload-folder-name.test.ts 가,
 * 꽂기 자체(덮어쓰지 않기 · NFC/NFD · 번호 상한)는 contact-folder-copy.test.ts 가 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-upload-folder-test-"));
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
const CATEGORY: AttachmentCategory = "INTAKE_PHOTO";
/** 🔴 분류 폴더 이름은 **한글 이름표**다 — 값을 베끼지 않고 목록에서 가져온다. */
const CATEGORY_FOLDER = attachmentCategoryLabels[CATEGORY];

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 루트 하나와 그 안의 연락서 폴더 하나(이 길은 연락서 폴더를 만들지 않는다). */
async function makeRootWithFolder(): Promise<string> {
  const root = await makeRoot();
  await mkdir(path.join(root, FOLDER));
  return root;
}

function copy(root: string, originalFileName: string, content: string, uploadFolderName?: string) {
  return copyIntoContactFolder({
    root,
    intakeNumber: INTAKE,
    category: CATEGORY,
    originalFileName,
    bytes: bytes(content),
    ...(uploadFolderName === undefined ? {} : { uploadFolderName }),
  });
}

async function entries(...segments: string[]): Promise<string[]> {
  return (await readdir(path.join(...segments))).sort();
}

/** 하위 폴더까지 걸어서 모은 한 벌 — 폴더는 뒤에 `/` 를 붙인다. */
async function snapshot(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      found.push(entry.isDirectory() ? `${relative}/` : relative);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
    }
  }
  await walk(root, "");
  return found.sort();
}

// ── 적었을 때 ───────────────────────────────────────────────────────────────

test("🔴 적은 이름으로 **분류 폴더 안에** 폴더가 서고 파일이 그 안에 들어간다", async () => {
  const root = await makeRootWithFolder();

  const result = await copy(root, "IMG_2847.jpg", "사진", "1차 측정");

  assert.deepEqual(result, {
    status: "copied",
    folderName: FOLDER,
    fileName: "IMG_2847.jpg",
    categoryFolderName: CATEGORY_FOLDER,
    categoryFolderBlockedByFile: false,
    uploadFolderName: "1차 측정",
    uploadFolderBlockedByFile: false,
  });
  // 🔴 **세 겹**이다 — 연락서 폴더 / 분류 폴더 / 적은 폴더 / 파일.
  assert.deepEqual(await snapshot(root), [
    `${FOLDER}/`,
    `${FOLDER}/${CATEGORY_FOLDER}/`,
    `${FOLDER}/${CATEGORY_FOLDER}/1차 측정/`,
    `${FOLDER}/${CATEGORY_FOLDER}/1차 측정/IMG_2847.jpg`,
  ]);
});

test("🔴 다듬은 이름으로 선다 — 적은 글자에 금지 글자가 섞여 있어도 폴더가 생긴다", async () => {
  const root = await makeRootWithFolder();

  const result = await copy(root, "파형.csv", "측정값", "2026:11 점검");

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  assert.equal(result.uploadFolderName, "2026 11 점검");
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER), ["2026 11 점검"]);
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER, "2026 11 점검"), ["파형.csv"]);
});

test("🔴 여러 장은 **같은 폴더**에 들어간다 — 파일 이름은 고른 그대로다", async () => {
  const root = await makeRootWithFolder();

  for (const name of ["A.jpg", "B.jpg", "C.jpg"]) {
    const result = await copy(root, name, `${name} 의 내용`, "1차 측정");
    assert.equal(result.status, "copied", JSON.stringify(result));
  }

  // 🔴 폴더는 하나이고 파일은 셋이다 — 이름에 (1)(2)(3) 이 붙지 않는다.
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER), ["1차 측정"]);
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER, "1차 측정"), [
    "A.jpg",
    "B.jpg",
    "C.jpg",
  ]);
});

test("🔴 이미 그 폴더가 있으면 **그대로 쓴다** — 안에 든 사람의 파일을 건드리지 않는다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, FOLDER, CATEGORY_FOLDER));
  await mkdir(path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정"));
  await writeFile(path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정", "사람것.txt"), "사람이 넣은 것");

  const result = await copy(root, "IMG_2847.jpg", "사진", "1차 측정");

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  assert.equal(result.uploadFolderName, "1차 측정");
  // 폴더가 둘이 되지 않았다.
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER), ["1차 측정"]);
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER, "1차 측정"), [
    "IMG_2847.jpg",
    "사람것.txt",
  ]);
  assert.equal(
    (await readFile(path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정", "사람것.txt"))).toString("utf8"),
    "사람이 넣은 것",
    "🔴 사람이 넣어 둔 파일을 건드렸다"
  );
});

test("🔴 같은 이름이 겹치면 그 폴더 안에서 ` (2)` 로 비켜 간다 — 덮어쓰지 않는다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, FOLDER, CATEGORY_FOLDER));
  await mkdir(path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정"));
  await writeFile(
    path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정", "IMG_2847.jpg"),
    "먼저 있던 것"
  );

  const result = await copy(root, "IMG_2847.jpg", "앱이 올린 것", "1차 측정");

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  assert.equal(result.fileName, "IMG_2847 (2).jpg");
  assert.equal(
    (await readFile(path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정", "IMG_2847.jpg"))).toString("utf8"),
    "먼저 있던 것",
    "🔴 남의 파일을 덮어썼다"
  );
});

test("🔴 같은 이름의 **파일**이 자리를 막으면 **분류 폴더**에 꽂고 알린다 — 그 파일을 지우지 않는다", async () => {
  const root = await makeRootWithFolder();
  await mkdir(path.join(root, FOLDER, CATEGORY_FOLDER));
  // 사람의 서류함에는 `1차 측정` 이라는 **파일**이 있을 수 있다.
  await writeFile(path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정"), "사람이 넣은 것");

  const result = await copy(root, "IMG_2847.jpg", "사진", "1차 측정");

  // 🔴 실패로 끝내지 않는다 — 한 겹 위(분류 폴더)에 들어갔다.
  assert.deepEqual(result, {
    status: "copied",
    folderName: FOLDER,
    fileName: "IMG_2847.jpg",
    categoryFolderName: CATEGORY_FOLDER,
    categoryFolderBlockedByFile: false,
    uploadFolderName: null,
    uploadFolderBlockedByFile: true,
  });
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER), ["1차 측정", "IMG_2847.jpg"]);
  // 🔴 막고 있던 파일은 한 글자도 안 바뀌었다(지우지도 옮기지도 않는다).
  assert.equal(
    (await readFile(path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정"))).toString("utf8"),
    "사람이 넣은 것"
  );
  assert.equal(
    (await stat(path.join(root, FOLDER, CATEGORY_FOLDER, "1차 측정"))).isFile(),
    true,
    "🔴 파일이 폴더가 되었다"
  );
});

test("🔴 분류 폴더가 막혀 있으면 적은 폴더도 **그 자리에** 선다 — 없는 폴더 안을 만들지 않는다", async () => {
  const root = await makeRootWithFolder();
  // 분류 폴더 자리를 같은 이름의 **파일**이 막고 있다(조각 11 의 그 상황).
  await writeFile(path.join(root, FOLDER, CATEGORY_FOLDER), "사람이 넣은 것");

  const result = await copy(root, "IMG_2847.jpg", "사진", "1차 측정");

  assert.deepEqual(result, {
    status: "copied",
    folderName: FOLDER,
    fileName: "IMG_2847.jpg",
    categoryFolderName: null,
    categoryFolderBlockedByFile: true,
    uploadFolderName: "1차 측정",
    uploadFolderBlockedByFile: false,
  });
  // 🔴 연락서 폴더 바로 아래에 `1차 측정` 이 서고 그 안에 파일이 들어갔다.
  assert.deepEqual(await snapshot(root), [
    `${FOLDER}/`,
    `${FOLDER}/1차 측정/`,
    `${FOLDER}/1차 측정/IMG_2847.jpg`,
    `${FOLDER}/${CATEGORY_FOLDER}`,
  ].sort());
});

test("🔴 한 겹이 늘면 파일 이름이 63 자로 잘린다 — 줄기만 잘리고 확장자는 그대로", async () => {
  const root = await makeRootWithFolder();
  const long = `${"가".repeat(200)}.jpg`;

  const inFolder = await copy(root, long, "폴더 안", "1차 측정");
  assert.equal(inFolder.status, "copied", JSON.stringify(inFolder));
  if (inFolder.status !== "copied") throw new Error("unreachable");
  assert.equal(inFolder.fileName.length, CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER - " (999)".length);
  assert.ok(inFolder.fileName.endsWith(".jpg"), inFolder.fileName);
  // 🔴 디스크에 **그 이름으로** 섰다(결과만 보고 믿지 않는다).
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER, "1차 측정"), [inFolder.fileName]);

  // 🔴 폴더를 안 적은 쪽은 **더 길게** 들어간다 — 상한이 안 내려갔다.
  const plain = await copy(root, long, "분류 폴더에 바로");
  assert.equal(plain.status, "copied", JSON.stringify(plain));
  if (plain.status !== "copied") throw new Error("unreachable");
  assert.equal(plain.fileName.length, CONTACT_FOLDER_FILE_MAX_NAME_LENGTH - " (999)".length);
  assert.ok(plain.fileName.length > inFolder.fileName.length, "두 상한이 같아졌다");
});

// ── 울타리 ─────────────────────────────────────────────────────────────────

test("🔴 폴더 밖으로 못 나간다 — `../` 로 적어도 루트 위에 아무것도 안 생긴다", async () => {
  const root = await makeRoot();
  // 루트 **밖**에 우리가 안 만드는 자리를 하나 만들어 두고, 그 안이 안 바뀌는지 본다.
  const outside = path.join(root, "바깥");
  await mkdir(outside);
  const inner = path.join(outside, "안쪽");
  await mkdir(inner);
  await mkdir(path.join(inner, FOLDER));
  const before = await snapshot(outside);

  /*
    🔴 사람이 적는 자리는 이런 글자를 **거절**한다(domain 쪽 검사자 — 화면과 통로가 함께
    쓴다). 여기까지 오는 길은 그 겹이 빠졌을 때뿐이고, 그때 **마지막으로 막는 것이 둘**이다:
     · 다듬기가 `/` · `\` 를 공백으로 바꾸고 점만 남은 조각을 지운다 → 경로가 **한 마디**가
       된다(`/바깥` → `바깥`. 폴더가 서기는 하되 **분류 폴더 안**이다).
     · 그래도 밖을 가리키면 assertInsideShareFolderRoot 가 던진다.
    그래서 여기서 재는 것은 「폴더가 서는가」가 아니라 **「한 겹이라도 밖으로 나가는가」**다.
  */
  for (const evil of ["../..", "../바깥", "..\\바깥", "/바깥", "..", "."]) {
    const result = await copyIntoContactFolder({
      root: inner,
      intakeNumber: INTAKE,
      category: CATEGORY,
      originalFileName: "IMG_2847.jpg",
      bytes: bytes(`「${evil}」로 적었을 때`),
      uploadFolderName: evil,
    });
    assert.equal(result.status, "copied", `${evil}: ${JSON.stringify(result)}`);
    if (result.status !== "copied") throw new Error("unreachable");
    // 🔴 폴더 이름이 섰다면 **마디 하나**여야 한다 — 구분자도 `..` 도 남아 있지 않다.
    const made = result.uploadFolderName ?? null;
    if (made !== null) {
      assert.equal(/[\\/]/.test(made), false, `「${evil}」가 구분자를 품은 채 섰다: ${made}`);
      assert.equal(made.includes(".."), false, `「${evil}」가 거슬러 오르는 이름으로 섰다: ${made}`);
    }
  }

  // 🔴 루트 밖에 새로 생긴 것이 하나도 없다.
  assert.deepEqual(
    (await snapshot(outside)).filter((entry) => !entry.startsWith("안쪽/")),
    before.filter((entry) => !entry.startsWith("안쪽/")),
    "🔴 공유폴더 밖에 무엇인가 생겼다"
  );
  // 🔴 루트(`안쪽`) 안에서도 **연락서 폴더 밖**에 생긴 것이 없다.
  assert.deepEqual(await entries(inner), [FOLDER]);
  // 들어간 것은 전부 분류 폴더 안이다 — 그 아래가 몇 겹이든 밖으로 새지 않았다.
  assert.deepEqual(await entries(inner, FOLDER), [CATEGORY_FOLDER]);
});

test("🔴 목록이 감추는 이름으로는 폴더가 안 선다 — 만들어도 아무도 못 본다", async () => {
  const root = await makeRootWithFolder();

  for (const hidden of [".측정", "~$측정", "Thumbs.db"]) {
    const result = await copy(root, `${hidden.replace(/[.~$]/g, "")}.jpg`, hidden, hidden);
    assert.equal(result.status, "copied", JSON.stringify(result));
    if (result.status !== "copied") throw new Error("unreachable");
    // 🔴 안 적은 것과 똑같이 다뤄진다 — 분류 폴더에 바로(위 울타리 시험과 같은 결).
    assert.equal("uploadFolderName" in result, false, `「${hidden}」로 폴더가 섰다`);
  }

  // 분류 폴더 안에는 **파일만** 있다 — 숨은 폴더가 하나도 없다.
  for (const entry of await readdir(path.join(root, FOLDER, CATEGORY_FOLDER), { withFileTypes: true })) {
    assert.equal(entry.isDirectory(), false, `숨은 폴더가 섰다: ${entry.name}`);
  }
});

test("🔴 거절 두 겹이 다 빠져도 **상한 안에서** 선다 — 긴 이름은 잘려서 폴더가 된다", async () => {
  const root = await makeRootWithFolder();
  const tooLong = "가".repeat(CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH + 10);

  const result = await copy(root, "IMG_2847.jpg", "사진", tooLong);

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  assert.equal(result.uploadFolderName?.length, CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH);
  assert.deepEqual(await entries(root, FOLDER, CATEGORY_FOLDER), [result.uploadFolderName!]);
});

// ── 안 적었을 때 — 🔴 2026-11-26 전과 한 글자도 같다 ────────────────────────

test("🔴 안 적으면 **분류 폴더에 바로** — 칸을 아예 안 주었을 때와 값이 같다", async () => {
  const notGiven = await makeRootWithFolder();
  const blank = await makeRootWithFolder();
  const spaces = await makeRootWithFolder();

  const a = await copy(notGiven, "IMG_2847.jpg", "사진");
  const b = await copy(blank, "IMG_2847.jpg", "사진", "");
  const c = await copy(spaces, "IMG_2847.jpg", "사진", "   ");

  // 🔴 **칸이 아예 없는 결과**가 기준이다 — 셋이 한 글자도 다르지 않아야 한다.
  assert.deepEqual(a, {
    status: "copied",
    folderName: FOLDER,
    fileName: "IMG_2847.jpg",
    categoryFolderName: CATEGORY_FOLDER,
    categoryFolderBlockedByFile: false,
  });
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  // 🔴 「안 적었다」일 때는 칸 자체가 결과에 **없다**(undefined 가 아니라 없는 키다).
  assert.equal("uploadFolderName" in a, false, "안 적었는데 칸이 붙었다");
  assert.equal("uploadFolderBlockedByFile" in a, false, "안 적었는데 칸이 붙었다");

  const places = [
    `${FOLDER}/`,
    `${FOLDER}/${CATEGORY_FOLDER}/`,
    `${FOLDER}/${CATEGORY_FOLDER}/IMG_2847.jpg`,
  ];
  for (const root of [notGiven, blank, spaces]) {
    assert.deepEqual(await snapshot(root), places, "분류 폴더 안이 아니다");
  }
});

// ── 🔴 옆 길 둘은 한 글자도 안 바뀐다 ───────────────────────────────────────

test("🔴 [DATA에 저장] · 종류 공통 서류는 **폴더 이름을 받지 않는다** — 자리가 그대로다", async () => {
  const root = await makeRootWithFolder();

  const data = await copyIntoContactFolderDataFolder({
    root,
    intakeNumber: INTAKE,
    originalFileName: "파형.csv",
    bytes: bytes("단추가 넣은 것"),
  });
  const common = await copyIntoContactFolderCommonFolder({
    root,
    intakeNumber: INTAKE,
    originalFileName: "점검표.xlsx",
    bytes: bytes("접수가 넣은 것"),
  });

  assert.deepEqual(data, {
    status: "copied",
    folderName: FOLDER,
    fileName: "파형.csv",
    categoryFolderName: "DATA",
    categoryFolderBlockedByFile: false,
  });
  assert.deepEqual(common, {
    status: "copied",
    folderName: FOLDER,
    fileName: "점검표.xlsx",
    categoryFolderName: "공통",
    categoryFolderBlockedByFile: false,
  });
  // 🔴 그 두 길의 결과에는 새 칸이 **아예 붙지 않는다**.
  assert.equal("uploadFolderName" in data, false);
  assert.equal("uploadFolderName" in common, false);
  assert.deepEqual(await snapshot(root), [
    `${FOLDER}/`,
    `${FOLDER}/DATA/`,
    `${FOLDER}/DATA/파형.csv`,
    `${FOLDER}/공통/`,
    `${FOLDER}/공통/점검표.xlsx`,
  ].sort());
});
