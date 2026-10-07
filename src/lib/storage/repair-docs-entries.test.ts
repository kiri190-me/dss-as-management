import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  REPAIR_DOCS_ENTRIES_LIMIT,
  REPAIR_DOCS_ENTRIES_MAX_DEPTH,
  REPAIR_DOCS_ENTRIES_SLOW_REASON,
  REPAIR_DOCS_ENTRIES_TIMEOUT_MS,
  REPAIR_DOCS_ENTRIES_TOO_DEEP_REASON,
  compareRepairDocsEntries,
  findRepairDocsEntry,
  listRepairDocsEntries,
  type RepairDocsEntriesResult,
  type RepairDocsEntryLookupResult,
} from "./repair-docs-entries";

/*
 * ============================================================================
 * 「수리 관련」 서류함을 읽는다 — 루트의 맨 위 칸부터, 상한을 걸고 (2026-10-07)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더에 닿지 않는다.
 * 끝나면 만든 임시 폴더를 통째로 지운다.
 *
 * 🔴 이 모듈은 **읽기만** 한다. 그래서 거의 모든 시험이 「무엇도 만들거나 지우지
 * 않았다」를 함께 본다(snapshot).
 *
 * 연락서 쪽(contact-folder-entries.test.ts)과 다른 것은 **시작점 하나**다 — 폴더를
 * 찾는 단계가 없고, 루트가 곧 맨 위 칸이다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-docs-entries-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

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

function listedOrFail(result: RepairDocsEntriesResult) {
  assert.equal(result.status, "listed", JSON.stringify(result));
  if (result.status !== "listed") throw new Error("unreachable");
  return result;
}

function assertNoPathInReason(reason: string, root: string): void {
  assert.ok(reason.length > 0);
  assert.ok(!reason.includes(root), `사유에 루트가 들어 있다: ${reason}`);
  assert.ok(!reason.includes(path.basename(root)), `사유에 루트 이름이 들어 있다: ${reason}`);
  assert.ok(!reason.includes(os.tmpdir()), `사유에 임시 폴더 경로가 들어 있다: ${reason}`);
  assert.ok(!/[\\/]/.test(reason), `사유에 경로 구분자가 들어 있다: ${reason}`);
}

function assertFailedWithoutPath(
  result: RepairDocsEntriesResult | RepairDocsEntryLookupResult,
  root: string
): string {
  assert.equal(result.status, "failed", JSON.stringify(result));
  if (result.status !== "failed") throw new Error("unreachable");
  assertNoPathInReason(result.reason, root);
  return result.reason;
}

/**
 * 🔴 한 줄 확인에서 **담을 수 있는 자리로 받아들여지지 않았다.**
 *
 * `failed`(규칙 밖 · 못 읽음)와 `not-found`(그 자리에 아무것도 없다) 둘 다 거절이다 —
 * 어느 쪽인지는 자리마다 다르고(`..` 는 디스크에 그 이름의 줄이 없어 `not-found` 로
 * 떨어진다), 담기는 둘 다 막는다. 🔴 **`found` 만은 절대 아니어야 한다.**
 */
function assertNotUsable(result: RepairDocsEntryLookupResult, root: string): void {
  assert.notEqual(result.status, "found", JSON.stringify(result));
  if (result.status === "failed") assertNoPathInReason(result.reason, root);
}

/** 실제 서류함의 모양을 흉내 낸 작은 트리 — 이름은 스키마 머리말의 본보기 그대로다. */
async function makeArchive(): Promise<string> {
  const root = await makeRoot();
  await mkdir(path.join(root, "2. 인수시 서류", "2. MB 인수시 체크시트"), { recursive: true });
  await writeFile(path.join(root, "2. 인수시 서류", "2. MB 인수시 체크시트", "체크시트.xlsx"), "시트");
  await writeFile(path.join(root, "2. 인수시 서류", "안내문.pdf"), "안내");
  await mkdir(path.join(root, "3. 업체별 수리품현황"));
  await writeFile(path.join(root, "읽어보기.txt"), "맨 위");
  return root;
}

test("루트의 맨 위 칸을 읽는다 — 이름 · 크기 · 수정시각 · 폴더인가, 🔴 아무것도 만들거나 지우지 않는다", async () => {
  const root = await makeArchive();
  const before = await snapshot(root);

  const result = listedOrFail(await listRepairDocsEntries({ root }));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["2. 인수시 서류", "3. 업체별 수리품현황", "읽어보기.txt"]
  );
  assert.equal(result.totalCount, 3);
  assert.equal(result.truncated, false);

  const file = result.entries.find((entry) => entry.name === "읽어보기.txt");
  assert.equal(file?.isDirectory, false);
  assert.equal(file?.sizeBytes, Buffer.byteLength("맨 위"));
  assert.ok(file?.modifiedAtMs !== null && (file?.modifiedAtMs ?? 0) > 0);
  // 폴더 줄은 크기를 재지 않는다 — 재려면 안으로 내려가야 한다.
  const folder = result.entries.find((entry) => entry.name === "2. 인수시 서류");
  assert.equal(folder?.isDirectory, true);
  assert.equal(folder?.sizeBytes, 0);

  assert.deepEqual(await snapshot(root), before, "읽기가 무엇인가를 만들거나 지웠다");
});

test("🔴 자리를 주지 않으면 하위 폴더로 내려가지 않는다 — 한 칸 · 두 칸씩만 내려간다", async () => {
  const root = await makeArchive();
  const before = await snapshot(root);

  const top = listedOrFail(await listRepairDocsEntries({ root }));
  for (const inner of ["2. MB 인수시 체크시트", "안내문.pdf", "체크시트.xlsx"]) {
    assert.equal(
      top.entries.some((entry) => entry.name === inner),
      false,
      `하위 폴더 안의 ${inner} 가 맨 위 목록에 올라왔다`
    );
  }

  const one = listedOrFail(await listRepairDocsEntries({ root, relativePath: "2. 인수시 서류" }));
  assert.deepEqual(
    one.entries.map((entry) => entry.name),
    ["2. MB 인수시 체크시트", "안내문.pdf"]
  );

  const two = listedOrFail(
    await listRepairDocsEntries({ root, relativePath: "2. 인수시 서류/2. MB 인수시 체크시트" })
  );
  assert.deepEqual(
    two.entries.map((entry) => entry.name),
    ["체크시트.xlsx"]
  );

  // 🔴 돌려주는 이름은 **그 자리에서의 이름 하나**다 — 경로가 섞여 나오지 않는다.
  for (const entry of [...one.entries, ...two.entries]) {
    assert.equal(/[\\/]/.test(entry.name), false, entry.name);
    assert.deepEqual(Object.keys(entry).sort(), ["isDirectory", "modifiedAtMs", "name", "sizeBytes"]);
  }

  // 빈 값 · 공백뿐인 값은 맨 위 칸이다.
  for (const same of ["", "   "]) {
    const asTop = listedOrFail(await listRepairDocsEntries({ root, relativePath: same }));
    assert.equal(asTop.entries.length, 3);
  }

  assert.deepEqual(await snapshot(root), before, "읽기가 무엇인가를 만들거나 지웠다");
});

test("🔴 프로그램이 남긴 것과 숨김 파일은 빠진다 — ~$ · Thumbs.db · desktop.ini · 점으로 시작", async () => {
  const root = await makeRoot();
  for (const hidden of ["~$체크시트.xlsx", "Thumbs.db", "thumbs.db", "desktop.ini", ".DS_Store", ".@__thumb"]) {
    await writeFile(path.join(root, hidden), "x");
  }
  await writeFile(path.join(root, "체크시트.xlsx"), "진짜");

  const result = listedOrFail(await listRepairDocsEntries({ root }));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["체크시트.xlsx"]
  );
  // 거른 줄은 전체 수에도 들지 않는다 — 「더 있습니다」가 거짓으로 서지 않게.
  assert.equal(result.totalCount, 1);
  assert.equal(result.truncated, false);
});

test("순서 — 폴더가 먼저, 그 안에서 이름순(탐색기와 같다)", async () => {
  const root = await makeRoot();
  await writeFile(path.join(root, "b.txt"), "b");
  await writeFile(path.join(root, "a.txt"), "a");
  await mkdir(path.join(root, "zz"));
  await mkdir(path.join(root, "aa"));

  const result = listedOrFail(await listRepairDocsEntries({ root }));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["aa", "zz", "a.txt", "b.txt"]
  );
  assert.ok(compareRepairDocsEntries({ name: "zz", isDirectory: true }, { name: "a.txt", isDirectory: false }) < 0);
  assert.ok(compareRepairDocsEntries({ name: "a.txt", isDirectory: false }, { name: "b.txt", isDirectory: false }) < 0);
});

test("🔴 줄 수 상한 — 넘으면 앞의 N 개만 주고 「더 있습니다」를 함께 나른다 (기본 200)", async () => {
  const root = await makeRoot();
  for (const name of ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"]) {
    await writeFile(path.join(root, name), name);
  }

  const cut = listedOrFail(await listRepairDocsEntries({ root, limit: 2 }));
  assert.deepEqual(
    cut.entries.map((entry) => entry.name),
    ["1.jpg", "2.jpg"]
  );
  assert.equal(cut.totalCount, 5);
  assert.equal(cut.truncated, true);

  const all = listedOrFail(await listRepairDocsEntries({ root, limit: 5 }));
  assert.equal(all.entries.length, 5);
  assert.equal(all.truncated, false);
  assert.equal(all.totalCount, 5);

  // 🔴 연락서(100)보다 두 배다 — 까닭은 모듈 머리말에 적었다.
  assert.equal(REPAIR_DOCS_ENTRIES_LIMIT, 200);
});

test("루트가 없으면 루트를 만들지 않고 failed", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  assertFailedWithoutPath(await listRepairDocsEntries({ root: missingRoot }), missingRoot);
  assertFailedWithoutPath(
    await findRepairDocsEntry({ root: missingRoot, relativePath: "아무거나" }),
    missingRoot
  );
  assert.deepEqual(await readdir(parent), [], "루트가 생겼다");
});

test("루트 값이 비면 failed — 환경변수를 스스로 읽지 않는다", async () => {
  for (const root of ["", "   "]) {
    const result = await listRepairDocsEntries({ root });
    assert.equal(result.status, "failed");
    if (result.status !== "failed") throw new Error("unreachable");
    assert.match(result.reason, /설정되지 않았습니다/);
  }
});

test("🔴 기다리기 상한 — 공유폴더가 답하지 않으면 그만두고, 공유폴더는 그대로다", async () => {
  assert.equal(REPAIR_DOCS_ENTRIES_TIMEOUT_MS, 3000);
  assert.ok(!/[\\/]/.test(REPAIR_DOCS_ENTRIES_SLOW_REASON), REPAIR_DOCS_ENTRIES_SLOW_REASON);

  const root = await makeArchive();
  const before = await snapshot(root);

  // 상한을 0 으로 두면 기다리기가 바로 끝난다. readdir 이 먼저 끝날 수도 있으므로
  // 둘 중 어느 쪽이 나와도 **공유폴더가 그대로인 것**만은 반드시 참이어야 한다.
  const result = await listRepairDocsEntries({ root, timeoutMs: 0 });
  assert.ok(result.status === "failed" || result.status === "listed", result.status);
  if (result.status === "failed") {
    assert.equal(result.reason, REPAIR_DOCS_ENTRIES_SLOW_REASON);
  }

  const lookup = await findRepairDocsEntry({ root, relativePath: "읽어보기.txt", timeoutMs: 0 });
  assert.ok(lookup.status === "failed" || lookup.status === "found", lookup.status);

  assert.deepEqual(await snapshot(root), before);
});

test("🔴 `..` · 절대 경로 · 드라이브 문자 · UNC · 끝이 점 · 공백인 마디가 거절된다 — 디스크는 그대로다", async () => {
  const root = await makeArchive();
  const outside = path.join(root, "..", `바깥-${path.basename(root)}.txt`);
  await writeFile(outside, "남의 것");
  createdRoots.push(outside);
  const before = await snapshot(root);

  const rejected = [
    "..",
    "../..",
    "2. 인수시 서류/..",
    "2. 인수시 서류/../..",
    ".",
    "./2. 인수시 서류",
    "/etc",
    "/",
    "C:\\Windows",
    "c:/Windows",
    "\\\\NAS01\\공유",
    "2. 인수시 서류.",
    "2. 인수시 서류 ",
    "2. 인수시 서류//2. MB 인수시 체크시트",
    "2. 인수시 서류/",
    "2. 인수시 서류\\2. MB 인수시 체크시트",
  ];
  for (const relativePath of rejected) {
    assertFailedWithoutPath(await listRepairDocsEntries({ root, relativePath }), root);
    // 한 줄 확인은 마지막 마디를 폴더로 요구하지 않으므로 `..` 같은 값이 `not-found`
    // 로 떨어진다 — 담기는 어느 쪽이든 막히고, `found` 만은 절대 나오지 않는다.
    assertNotUsable(await findRepairDocsEntry({ root, relativePath }), root);
  }

  assert.deepEqual(await snapshot(root), before, "거절하면서 무엇인가를 만들거나 지웠다");
});

test("🔴 바로가기(정션 · 심볼릭 링크)를 지나는 경로가 거절된다 — 목록에도 서지 않는다", async (t) => {
  const root = await makeRoot();
  const outsideParent = await makeRoot();
  await writeFile(path.join(outsideParent, "남의자료.xlsx"), "남의 것");
  const link = path.join(root, "지름길");
  try {
    await symlink(outsideParent, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("이 환경에서는 바로가기를 만들 수 없다");
    return;
  }

  // 목록에 서지도 않는다 — readdir 의 isDirectory() 는 링크를 따라가지 않는다.
  const top = listedOrFail(await listRepairDocsEntries({ root }));
  assert.equal(
    top.entries.some((entry) => entry.name === "지름길"),
    false,
    JSON.stringify(top.entries)
  );

  // 이름을 직접 적어 넣어도 들어가지 못하고, 링크 너머의 파일이 한 줄도 새어 나오지 않는다.
  const inside = await listRepairDocsEntries({ root, relativePath: "지름길" });
  assertFailedWithoutPath(inside, root);
  assert.equal(JSON.stringify(inside).includes("남의자료"), false, JSON.stringify(inside));

  // 가리킴으로도 담을 수 없다 — 「없다」로 답한다(링크는 줄로 서지 않으므로).
  const lookup = await findRepairDocsEntry({ root, relativePath: "지름길" });
  assert.equal(lookup.status, "not-found", JSON.stringify(lookup));
});

test("🔴 깊이 상한을 넘으면 거절된다 — 여섯 칸까지다", async () => {
  assert.equal(REPAIR_DOCS_ENTRIES_MAX_DEPTH, 6);
  assert.ok(!/[\\/]/.test(REPAIR_DOCS_ENTRIES_TOO_DEEP_REASON), REPAIR_DOCS_ENTRIES_TOO_DEEP_REASON);

  const root = await makeRoot();
  const names = ["a", "b", "c", "d", "e", "f", "g"];
  let here = root;
  for (const name of names) {
    here = path.join(here, name);
    await mkdir(here);
  }
  await writeFile(path.join(here, "맨아래.txt"), "깊다");
  const before = await snapshot(root);

  const deepest = listedOrFail(await listRepairDocsEntries({ root, relativePath: names.slice(0, 6).join("/") }));
  assert.deepEqual(
    deepest.entries.map((entry) => entry.name),
    ["g"]
  );

  const tooDeep = await listRepairDocsEntries({ root, relativePath: names.join("/") });
  assert.equal(tooDeep.status, "failed");
  if (tooDeep.status !== "failed") throw new Error("unreachable");
  assert.equal(tooDeep.reason, REPAIR_DOCS_ENTRIES_TOO_DEEP_REASON);

  const tooDeepLookup = await findRepairDocsEntry({ root, relativePath: `${names.join("/")}/맨아래.txt` });
  assert.equal(tooDeepLookup.status, "failed");

  assert.deepEqual(await snapshot(root), before);
});

test("🔴 보이지 않는 폴더 · 없는 폴더 · 파일 이름으로는 들어가지 못한다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, ".숨은폴더"));
  await writeFile(path.join(root, ".숨은폴더", "숨은자료.txt"), "숨김");
  await writeFile(path.join(root, "체크시트.xlsx"), "맨위");

  for (const relativePath of [".숨은폴더", "없는폴더", "체크시트.xlsx", "체크시트.xlsx/안"]) {
    const result = await listRepairDocsEntries({ root, relativePath });
    const reason = assertFailedWithoutPath(result, root);
    assert.equal(JSON.stringify(result).includes("숨은자료"), false, reason);
  }
});

/*
 * ============================================================================
 * 🔴 한 줄 확인 — 「그 자리에 지금 **무엇이** 있는가」 (가리킴을 담기 전에 묻는다)
 * ============================================================================
 */

test("🔴 파일이면 파일로, 폴더면 폴더로 답한다 — 목록을 내지 않는다", async () => {
  const root = await makeArchive();
  const before = await snapshot(root);

  const file = await findRepairDocsEntry({ root, relativePath: "2. 인수시 서류/안내문.pdf" });
  assert.deepEqual(file, { status: "found", isDirectory: false });

  const folder = await findRepairDocsEntry({ root, relativePath: "2. 인수시 서류/2. MB 인수시 체크시트" });
  assert.deepEqual(folder, { status: "found", isDirectory: true });

  const top = await findRepairDocsEntry({ root, relativePath: "읽어보기.txt" });
  assert.deepEqual(top, { status: "found", isDirectory: false });

  assert.deepEqual(await snapshot(root), before, "확인이 무엇인가를 만들거나 지웠다");
});

test("🔴 없는 자리 · 거르는 이름은 not-found 다 — 만들지 않는다", async () => {
  const root = await makeArchive();
  await writeFile(path.join(root, "~$체크시트.xlsx"), "잠금");
  const before = await snapshot(root);

  for (const relativePath of ["없는파일.pdf", "2. 인수시 서류/없는것.xlsx", "~$체크시트.xlsx"]) {
    const result = await findRepairDocsEntry({ root, relativePath });
    assert.deepEqual(result, { status: "not-found" }, relativePath);
  }

  // 부모 폴더가 없으면 failed 다(사유에 경로가 없다).
  const noParent = await findRepairDocsEntry({ root, relativePath: "없는폴더/안에것.pdf" });
  assertFailedWithoutPath(noParent, root);

  assert.deepEqual(await snapshot(root), before);
});

test("🔴 가리킬 자리가 비면 실패다 — 루트 자신은 가리킴이 될 수 없다", async () => {
  const root = await makeArchive();

  for (const relativePath of ["", "   "]) {
    const result = await findRepairDocsEntry({ root, relativePath });
    assertFailedWithoutPath(result, root);
  }
});
