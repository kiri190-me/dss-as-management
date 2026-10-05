import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  CONTACT_FOLDER_ENTRIES_LIMIT,
  CONTACT_FOLDER_ENTRIES_MAX_DEPTH,
  CONTACT_FOLDER_ENTRIES_SLOW_REASON,
  CONTACT_FOLDER_ENTRIES_TIMEOUT_MS,
  CONTACT_FOLDER_ENTRIES_TOO_DEEP_REASON,
  compareContactFolderEntries,
  isIgnoredContactFolderEntryName,
  listContactFolderEntries,
  type ContactFolderEntriesResult,
} from "./contact-folder-entries";

/*
 * ============================================================================
 * 연락서 폴더 **안을 읽는다** — 맨 위 칸만, 상한을 걸고 (조각 3)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더에 닿지 않는다.
 * 끝나면 만든 임시 폴더를 통째로 지운다. 고객사 · 모델 · S/N 은 가짜다(저장소가 공개다).
 *
 * 🔴 이 모듈은 **읽기만** 한다. 그래서 거의 모든 시험이 「무엇도 만들거나 지우지
 * 않았다」를 함께 본다(snapshot).
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-entries-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

/** 루트와 그 안의 연락서 폴더를 만든다 — 시험 준비지, 앱이 하는 일이 아니다. */
async function makeCaseFolder(): Promise<{ root: string; folder: string }> {
  const root = await makeRoot();
  const folder = path.join(root, FOLDER);
  await mkdir(folder);
  return { root, folder };
}

function list(
  root: string,
  overrides: { folderName?: string; relativePath?: string; limit?: number; timeoutMs?: number } = {}
) {
  return listContactFolderEntries({ root, folderName: FOLDER, ...overrides });
}

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

function listedOrFail(result: ContactFolderEntriesResult) {
  assert.equal(result.status, "listed", JSON.stringify(result));
  if (result.status !== "listed") throw new Error("unreachable");
  return result;
}

function assertFailedWithoutPath(result: ContactFolderEntriesResult, root: string): string {
  assert.equal(result.status, "failed", JSON.stringify(result));
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

test("맨 위 칸을 읽는다 — 이름 · 크기 · 수정시각 · 폴더인가, 🔴 아무것도 만들거나 지우지 않는다", async () => {
  const { root, folder } = await makeCaseFolder();
  await writeFile(path.join(folder, "연락서.xlsx"), "가나다");
  const before = await snapshot(root);

  const result = listedOrFail(await list(root));

  assert.equal(result.entries.length, 1);
  assert.equal(result.totalCount, 1);
  assert.equal(result.truncated, false);
  const [entry] = result.entries;
  assert.equal(entry.name, "연락서.xlsx");
  assert.equal(entry.isDirectory, false);
  assert.equal(entry.sizeBytes, Buffer.byteLength("가나다"));
  assert.ok(entry.modifiedAtMs !== null && entry.modifiedAtMs > 0, String(entry.modifiedAtMs));

  assert.deepEqual(await snapshot(root), before, "읽기가 무엇인가를 만들거나 지웠다");
});

test("🔴 자리를 주지 않으면 하위 폴더로 내려가지 않는다 — 그 안의 파일은 목록에 없다, 폴더는 한 줄로만 선다", async () => {
  const { root, folder } = await makeCaseFolder();
  await mkdir(path.join(folder, "사진"));
  await writeFile(path.join(folder, "사진", "안쪽사진.jpg"), "속");
  await mkdir(path.join(folder, "사진", "더안쪽"));
  await writeFile(path.join(folder, "사진", "더안쪽", "더안쪽파일.txt"), "더속");
  await writeFile(path.join(folder, "연락서.pdf"), "겉");

  const result = listedOrFail(await list(root));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["사진", "연락서.pdf"]
  );
  for (const inner of ["안쪽사진.jpg", "더안쪽", "더안쪽파일.txt"]) {
    assert.equal(
      result.entries.some((entry) => entry.name === inner),
      false,
      `하위 폴더 안의 ${inner} 가 목록에 올라왔다`
    );
  }
  // 폴더 줄은 크기를 재지 않는다 — 재려면 안으로 내려가야 한다.
  const photos = result.entries.find((entry) => entry.name === "사진");
  assert.equal(photos?.isDirectory, true);
  assert.equal(photos?.sizeBytes, 0);
  assert.equal(result.totalCount, 2);
});

test("🔴 프로그램이 남긴 것과 숨김 파일은 빠진다 — ~$ · Thumbs.db · desktop.ini · 점으로 시작", async () => {
  const { root, folder } = await makeCaseFolder();
  for (const hidden of ["~$연락서.xlsx", "Thumbs.db", "thumbs.db", "desktop.ini", ".DS_Store", ".@__thumb"]) {
    await writeFile(path.join(folder, hidden), "x");
  }
  await writeFile(path.join(folder, "연락서.xlsx"), "진짜");

  const result = listedOrFail(await list(root));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["연락서.xlsx"]
  );
  // 거른 줄은 전체 수에도 들지 않는다 — 「더 있습니다」가 거짓으로 서지 않게.
  assert.equal(result.totalCount, 1);
  assert.equal(result.truncated, false);
});

test("순서 — 폴더가 먼저, 그 안에서 이름순(탐색기와 같다)", async () => {
  const { root, folder } = await makeCaseFolder();
  await writeFile(path.join(folder, "b.txt"), "b");
  await writeFile(path.join(folder, "a.txt"), "a");
  await mkdir(path.join(folder, "zz"));
  await mkdir(path.join(folder, "aa"));

  const result = listedOrFail(await list(root));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["aa", "zz", "a.txt", "b.txt"]
  );
  // 순수 비교 자체도 같은 말을 한다.
  assert.ok(compareContactFolderEntries({ name: "zz", isDirectory: true }, { name: "a.txt", isDirectory: false }) < 0);
  assert.ok(compareContactFolderEntries({ name: "a.txt", isDirectory: false }, { name: "b.txt", isDirectory: false }) < 0);
});

test("🔴 줄 수 상한 — 넘으면 앞의 N 개만 주고 「더 있습니다」를 함께 나른다", async () => {
  const { root, folder } = await makeCaseFolder();
  for (const name of ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"]) {
    await writeFile(path.join(folder, name), name);
  }

  const result = listedOrFail(await list(root, { limit: 2 }));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["1.jpg", "2.jpg"]
  );
  assert.equal(result.totalCount, 5);
  assert.equal(result.truncated, true);

  // 상한에 닿지 않으면 잘리지 않는다.
  const all = listedOrFail(await list(root, { limit: 5 }));
  assert.equal(all.entries.length, 5);
  assert.equal(all.truncated, false);
  assert.equal(all.totalCount, 5);

  // 기본 상한은 100 이다 — 왜 500 이 아닌지는 모듈 머리말에 적었다.
  assert.equal(CONTACT_FOLDER_ENTRIES_LIMIT, 100);
});

test("🔴 폴더가 없으면 failed — 만들지 않는다, 사유에 경로가 없다", async () => {
  const root = await makeRoot();

  const result = await list(root);

  const reason = assertFailedWithoutPath(result, root);
  assert.match(reason, /찾을 수 없습니다/);
  assert.deepEqual(await readdir(root), [], "없는 폴더를 만들었다");
});

test("루트가 없으면 루트를 만들지 않고 failed", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  assertFailedWithoutPath(await list(missingRoot), missingRoot);
  assert.deepEqual(await readdir(parent), [], "루트가 생겼다");
});

test("🔴 폴더 이름이 비거나 구분자가 들어 있으면 failed — 디스크를 보지 않는다", async () => {
  const { root, folder } = await makeCaseFolder();
  await writeFile(path.join(folder, "연락서.xlsx"), "x");
  const before = await snapshot(root);

  for (const folderName of ["", "   ", `${FOLDER}/사진`, "..", `..${path.sep}..`]) {
    assertFailedWithoutPath(await list(root, { folderName }), root);
  }
  assert.deepEqual(await snapshot(root), before);
});

test("🔴 기다리기 상한 — 공유폴더가 답하지 않으면 그만두고, 공유폴더는 그대로다", async () => {
  assert.equal(CONTACT_FOLDER_ENTRIES_TIMEOUT_MS, 2000);
  // 사유에 경로가 없다.
  assert.ok(!/[\\/]/.test(CONTACT_FOLDER_ENTRIES_SLOW_REASON), CONTACT_FOLDER_ENTRIES_SLOW_REASON);

  const { root, folder } = await makeCaseFolder();
  await writeFile(path.join(folder, "연락서.xlsx"), "x");
  const before = await snapshot(root);

  // 상한을 0 으로 두면 기다리기가 바로 끝난다. readdir 이 먼저 끝날 수도 있으므로
  // 둘 중 어느 쪽이 나와도 **공유폴더가 그대로인 것**만은 반드시 참이어야 한다.
  const result = await list(root, { timeoutMs: 0 });

  assert.ok(result.status === "failed" || result.status === "listed", result.status);
  if (result.status === "failed") {
    assert.equal(result.reason, CONTACT_FOLDER_ENTRIES_SLOW_REASON);
  }
  assert.deepEqual(await snapshot(root), before);
});

test("거르는 규칙은 순수하다 — 디스크 없이도 같은 말을 한다", () => {
  for (const ignored of ["~$연락서.xlsx", "Thumbs.db", "THUMBS.DB", "desktop.ini", "Desktop.ini", ".DS_Store", "."]) {
    assert.equal(isIgnoredContactFolderEntryName(ignored), true, ignored);
  }
  for (const kept of ["연락서.xlsx", "사진", "D260908 메모.txt", "~연락서.xlsx", "my.desktop.ini"]) {
    assert.equal(isIgnoredContactFolderEntryName(kept), false, kept);
  }
});

/*
 * ============================================================================
 * 🔴 하위 폴더 **안으로** 들어간다 (조각 10) — 한 칸씩, 보이는 폴더 줄로만
 * ============================================================================
 * 사람이 폴더 줄을 눌렀을 때만 한 칸 더 내려간다. 들어가는 길은 **그 자리에 보이는 폴더
 * 줄** 하나뿐이라 `..` · 드라이브 · UNC · 바로가기(정션)는 같은 자리에서 막힌다. 여기서도
 * 모든 시험이 임시 폴더에서만 돌고, 「무엇도 만들거나 지우지 않았다」를 함께 본다.
 * ============================================================================
 */

test("🔴 한 칸 · 두 칸 내려가면 그 자리의 맨 위 칸이 나온다 — 아무것도 만들거나 지우지 않는다", async () => {
  const { root, folder } = await makeCaseFolder();
  await mkdir(path.join(folder, "사진"));
  await mkdir(path.join(folder, "사진", "2026"));
  await writeFile(path.join(folder, "사진", "겉사진.jpg"), "겉");
  await writeFile(path.join(folder, "사진", "2026", "안쪽.jpg"), "안");
  await writeFile(path.join(folder, "연락서.xlsx"), "맨위");
  const before = await snapshot(root);

  const top = listedOrFail(await list(root));
  assert.deepEqual(
    top.entries.map((entry) => entry.name),
    ["사진", "연락서.xlsx"]
  );

  const inside = listedOrFail(await list(root, { relativePath: "사진" }));
  assert.deepEqual(
    inside.entries.map((entry) => entry.name),
    ["2026", "겉사진.jpg"]
  );
  assert.equal(inside.totalCount, 2);

  const deeper = listedOrFail(await list(root, { relativePath: "사진/2026" }));
  assert.deepEqual(
    deeper.entries.map((entry) => entry.name),
    ["안쪽.jpg"]
  );
  // 🔴 돌려주는 이름은 **그 자리에서의 이름 하나**다 — 경로가 섞여 나오지 않는다.
  for (const entry of [...inside.entries, ...deeper.entries]) {
    assert.equal(/[\\/]/.test(entry.name), false, entry.name);
    assert.deepEqual(Object.keys(entry).sort(), ["isDirectory", "modifiedAtMs", "name", "sizeBytes"]);
  }
  // 빈 값 · 공백뿐인 값은 맨 위 칸이다(들어가지 않는다).
  for (const same of ["", "   "]) {
    const asTop = listedOrFail(await list(root, { relativePath: same }));
    assert.deepEqual(
      asTop.entries.map((entry) => entry.name),
      ["사진", "연락서.xlsx"]
    );
  }

  assert.deepEqual(await snapshot(root), before, "읽기가 무엇인가를 만들거나 지웠다");
});

test("🔴 하위 폴더 안에서도 제외 규칙 · 줄 수 상한이 그대로다", async () => {
  const { root, folder } = await makeCaseFolder();
  const inside = path.join(folder, "사진");
  await mkdir(inside);
  for (const hidden of ["~$연락서.xlsx", "Thumbs.db", "desktop.ini", ".DS_Store"]) {
    await writeFile(path.join(inside, hidden), "x");
  }
  for (const name of ["1.jpg", "2.jpg", "3.jpg"]) {
    await writeFile(path.join(inside, name), name);
  }

  const all = listedOrFail(await list(root, { relativePath: "사진" }));
  assert.deepEqual(
    all.entries.map((entry) => entry.name),
    ["1.jpg", "2.jpg", "3.jpg"]
  );
  assert.equal(all.totalCount, 3);
  assert.equal(all.truncated, false);

  const cut = listedOrFail(await list(root, { relativePath: "사진", limit: 2 }));
  assert.deepEqual(
    cut.entries.map((entry) => entry.name),
    ["1.jpg", "2.jpg"]
  );
  assert.equal(cut.totalCount, 3);
  assert.equal(cut.truncated, true);
});

test("🔴 `..` · 절대 경로 · 드라이브 문자 · UNC · 끝이 점 · 공백인 마디가 거절된다 — 디스크는 그대로다", async () => {
  const { root, folder } = await makeCaseFolder();
  await mkdir(path.join(folder, "사진"));
  await writeFile(path.join(folder, "사진", "안쪽.jpg"), "안");
  await writeFile(path.join(root, "남의건.txt"), "남의 것");
  const before = await snapshot(root);

  const rejected = [
    "..",
    "../..",
    "사진/..",
    "사진/../..",
    ".",
    "./사진",
    "/etc",
    "/",
    "C:\\Windows",
    "c:/Windows",
    "\\\\NAS01\\공유",
    "사진.",
    "사진 ",
    "사진//2026",
    "사진/",
    "사진\\2026",
  ];
  for (const relativePath of rejected) {
    const result = await list(root, { relativePath });
    const reason = assertFailedWithoutPath(result, root);
    assert.ok(reason.length > 0, relativePath);
  }

  assert.deepEqual(await snapshot(root), before, "거절하면서 무엇인가를 만들거나 지웠다");
});

test("🔴 바로가기(정션 · 심볼릭 링크)를 지나는 경로가 거절된다 — 목록에도 서지 않는다", async (t) => {
  const { root, folder } = await makeCaseFolder();
  const outside = path.join(root, "바깥폴더");
  await mkdir(outside);
  await writeFile(path.join(outside, "남의자료.xlsx"), "남의 것");
  const link = path.join(folder, "지름길");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("이 환경에서는 바로가기를 만들 수 없다");
    return;
  }

  // 목록에 서지도 않는다 — readdir 의 isDirectory() 는 링크를 따라가지 않는다.
  const top = listedOrFail(await list(root));
  assert.equal(
    top.entries.some((entry) => entry.name === "지름길"),
    false,
    JSON.stringify(top.entries)
  );

  // 이름을 직접 적어 넣어도 들어가지 못한다.
  const result = await list(root, { relativePath: "지름길" });
  assertFailedWithoutPath(result, root);
  assert.equal(result.status, "failed");
  // 링크 너머의 파일이 한 줄도 새어 나오지 않는다.
  assert.equal(JSON.stringify(result).includes("남의자료"), false, JSON.stringify(result));
});

test("🔴 깊이 상한을 넘으면 거절된다 — 다섯 칸까지다", async () => {
  assert.equal(CONTACT_FOLDER_ENTRIES_MAX_DEPTH, 5);
  // 사유에 경로가 없다.
  assert.ok(!/[\\/]/.test(CONTACT_FOLDER_ENTRIES_TOO_DEEP_REASON), CONTACT_FOLDER_ENTRIES_TOO_DEEP_REASON);

  const { root, folder } = await makeCaseFolder();
  const names = ["a", "b", "c", "d", "e", "f"];
  let here = folder;
  for (const name of names) {
    here = path.join(here, name);
    await mkdir(here);
  }
  await writeFile(path.join(here, "맨아래.txt"), "깊다");
  const before = await snapshot(root);

  const deepest = listedOrFail(await list(root, { relativePath: names.slice(0, 5).join("/") }));
  assert.deepEqual(
    deepest.entries.map((entry) => entry.name),
    ["f"]
  );

  const tooDeep = await list(root, { relativePath: names.join("/") });
  assert.equal(tooDeep.status, "failed");
  if (tooDeep.status !== "failed") throw new Error("unreachable");
  assert.equal(tooDeep.reason, CONTACT_FOLDER_ENTRIES_TOO_DEEP_REASON);

  assert.deepEqual(await snapshot(root), before);
});

test("🔴 보이지 않는 폴더 · 없는 폴더 · 파일 이름으로는 들어가지 못한다", async () => {
  const { root, folder } = await makeCaseFolder();
  await mkdir(path.join(folder, ".숨은폴더"));
  await writeFile(path.join(folder, ".숨은폴더", "숨은자료.txt"), "숨김");
  await writeFile(path.join(folder, "연락서.xlsx"), "맨위");

  for (const relativePath of [".숨은폴더", "없는폴더", "연락서.xlsx", "연락서.xlsx/안"]) {
    const result = await list(root, { relativePath });
    const reason = assertFailedWithoutPath(result, root);
    assert.equal(JSON.stringify(result).includes("숨은자료"), false, reason);
  }
});

test("stat 을 못 읽는 줄이 있어도 목록을 통째로 버리지 않는다 — 이름은 보인다", async () => {
  const { root, folder } = await makeCaseFolder();
  await writeFile(path.join(folder, "연락서.xlsx"), "x");

  const result = listedOrFail(await list(root));
  const [entry] = result.entries;
  // 지금은 읽히는 상황이다 — 읽히면 값이 들어 있고, 못 읽으면 null 이 되는 모양이다.
  assert.equal(typeof entry.modifiedAtMs === "number" || entry.modifiedAtMs === null, true);
  assert.ok((await stat(path.join(folder, entry.name))).isFile());
});
