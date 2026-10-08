import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import {
  REPAIR_DOCS_FILE_MAX_BYTES,
  readRepairDocsFile,
  type RepairDocsFileRead,
} from "./repair-docs-archive";

/*
 * ============================================================================
 * 「1. 수리 관련」 서류함의 **바이트를 읽는** 갈래 — mkdtemp 임시 폴더에서만 (2026-10-08)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 서류함에 닿지 않는다.
 * 루트를 `root` 인자로 직접 넘기므로 `REPAIR_DOCS_ARCHIVE_DIR` 을 보지 않는다. 끝나면
 * 만든 임시 폴더를 통째로 지운다.
 *
 * 못 박는 것:
 *  · 🔴 **20MB 를 넘으면 읽기 전에 거절한다**(stat 이 먼저다)
 *  · 🔴 **실행 파일은 거절한다** — 그리고 `.xlsm` 은 통과한다(2026-10-08 결정)
 *  · 🔴 경로 규칙 밖(거슬러 올라가기 · 드라이브 · 역슬래시 · 빈 마디)은 **디스크를 보기
 *       전에** 거절한다
 *  · 🔴 **바로가기(심볼릭 링크 · 정션)는 따라가지 않는다**
 *  · 🔴 **폴더는 가져오지 않는다**
 *  · 🔴 **거절 사유에 경로가 한 글자도 없다** — 이 서류함의 폴더 이름에는 고객사명이
 *       섞여 있다
 *  · 설정이 비면 아무 일도 하지 않는다(`disabled`) · 읽은 바이트는 원본 그대로다
 *
 * 🔴 **쓰는 쪽은 여기에 없다.** 운영에서 이 볼륨은 읽기 전용으로 붙어 있고, 모듈에
 * 쓰기가 한 글자도 없다는 사실은 repair-docs-archive-source.test.ts 가 원본 글자로 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-docs-read-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

/** 🔴 고객사명이 섞인 자리를 일부러 쓴다 — 사유에 새어 나오면 바로 걸리게. */
const INSIDE = "2. 인수시 서류";
const SECRET = "INVENIA";

async function makeRootWithFile(
  name: string,
  content: string | Uint8Array = "hello"
): Promise<{ root: string; relativePath: string }> {
  const root = await makeRoot();
  await mkdir(path.join(root, INSIDE));
  await writeFile(path.join(root, INSIDE, name), content);
  return { root, relativePath: `${INSIDE}/${name}` };
}

function read(root: string, relativePath: string, overrides: { maxBytes?: number } = {}) {
  return readRepairDocsFile({ root, relativePath, ...overrides });
}

/** 거절 갈래를 꺼낸다 — 통과하면 터뜨린다(타입을 좁히려 if 를 늘어놓지 않게). */
function rejection(result: RepairDocsFileRead): { rejection: string; reason: string } {
  assert.equal(result.status, "rejected", `거절하지 않았다: ${JSON.stringify(result.status)}`);
  if (result.status !== "rejected") throw new Error("unreachable");
  return { rejection: result.rejection, reason: result.reason };
}

/**
 * **읽지 않은 것**을 한 낱말로 — `rejected:<갈래>` 이거나 `failed` 다.
 *
 * 🔴 **둘 다 「파일이 나가지 않았다」**이고, 사람에게 가는 것은 둘 다 경로 없는 짧은
 * 문장이다. 갈라지는 자리가 하나 있다: 걷다가 **중간 마디**가 없으면(옮겨졌거나
 * 바로가기다) 걷는 모듈이 `failed` 로 끝낸다 — 마지막 마디만 `not-found` 를 안다.
 */
function refusal(result: RepairDocsFileRead): { tag: string; reason: string } {
  assert.notEqual(result.status, "read", "읽어 버렸다");
  if (result.status === "rejected") return { tag: `rejected:${result.rejection}`, reason: result.reason };
  if (result.status === "failed") return { tag: "failed", reason: result.reason };
  throw new Error(`뜻밖의 결과: ${result.status}`);
}

test("읽는다 — 바이트가 원본 그대로이고 이름은 마디 하나다", async () => {
  const { root, relativePath } = await makeRootWithFile("MB 인수시 체크시트.xlsx", "① 점검표 내용");
  const result = await read(root, relativePath);

  assert.equal(result.status, "read");
  if (result.status !== "read") return;
  assert.equal(result.fileName, "MB 인수시 체크시트.xlsx");
  assert.equal(new TextDecoder().decode(result.bytes), "① 점검표 내용");
});

test("🔴 설정이 비면 아무 일도 하지 않는다 — 디스크를 보지 않는다", async () => {
  for (const root of [null, "", "   "]) {
    assert.deepEqual(await readRepairDocsFile({ root, relativePath: `${INSIDE}/a.pdf` }), {
      status: "disabled",
    });
  }
});

test("🔴 20MB 를 넘으면 **읽기 전에** 거절한다 — 상한은 첨부와 같은 값이다", async () => {
  // 상한을 낮춰 재면 「읽고 나서 버리는가」가 아니라 「재고 안 읽는가」를 볼 수 있다.
  const { root, relativePath } = await makeRootWithFile("큰 파일.pdf", "0123456789");
  const over = rejection(await read(root, relativePath, { maxBytes: 4 }));
  assert.equal(over.rejection, "TOO_LARGE");
  // 딱 맞는 크기는 통과한다 — 상한은 **넘을 때**만 걸린다.
  assert.equal((await read(root, relativePath, { maxBytes: 10 })).status, "read");

  // 🔴 기본값은 첨부 상한 그대로다(숫자를 따로 적지 않았다).
  assert.equal(REPAIR_DOCS_FILE_MAX_BYTES, MAX_ATTACHMENT_SIZE_BYTES);
});

test("🔴 실행 파일은 거절한다 — 그리고 `.xlsm` 은 통과한다(2026-10-08)", async () => {
  for (const name of ["설치.exe", "명령.bat", "모듈.dll", "매크로.docm", "쉘.sh"]) {
    const { root, relativePath } = await makeRootWithFile(name);
    const blocked = rejection(await read(root, relativePath));
    assert.equal(blocked.rejection, "EXECUTABLE", name);
  }

  // 🔵 매크로 엑셀은 2026-10-08 부터 실행 파일 목록 밖이다 — 그 결정과 일관된다.
  const macro = await makeRootWithFile("점검표.xlsm", "macro");
  assert.equal((await read(macro.root, macro.relativePath)).status, "read");

  // 확장자가 없는 이름도 막지 않는다 — 실행 파일 목록에 들 수가 없다.
  const bare = await makeRootWithFile("읽어주세요");
  assert.equal((await read(bare.root, bare.relativePath)).status, "read");
});

test("🔴 실행 파일은 **디스크에 없어도** 같은 자리에서 걸린다 — 보기 전에 끝난다", async () => {
  const root = await makeRoot();
  const blocked = rejection(await read(root, `${INSIDE}/없는 파일.exe`));
  assert.equal(blocked.rejection, "EXECUTABLE");
});

test("🔴 경로 규칙 밖은 거절한다 — 거슬러 올라가기 · 드라이브 · 역슬래시 · 빈 마디", async () => {
  const { root } = await makeRootWithFile("체크시트.xlsx");
  const outside = [
    `${INSIDE}/../../비밀.xlsx`,
    "../비밀.xlsx",
    "..",
    "/etc/passwd",
    "C:/Windows/win.ini",
    `${INSIDE}\\체크시트.xlsx`,
    `${INSIDE}//체크시트.xlsx`,
    `${INSIDE}/./체크시트.xlsx`,
    `${INSIDE}/끝이점.`,
    "",
    "   ",
  ];
  for (const relativePath of outside) {
    const no = rejection(await read(root, relativePath));
    assert.equal(no.rejection, "INVALID_PATH", relativePath);
  }
});

test("🔴 폴더는 가져오지 않는다 · 없는 자리는 읽지 않는다", async () => {
  const { root } = await makeRootWithFile("체크시트.xlsx");
  assert.equal(rejection(await read(root, INSIDE)).rejection, "NOT_A_FILE");
  assert.equal(rejection(await read(root, `${INSIDE}/없는 것.pdf`)).rejection, "NOT_FOUND");
  // 🔴 **중간 마디**가 없으면 걷는 모듈이 거기서 끝낸다 — 갈래만 다르고 결과는 같다.
  assert.equal(refusal(await read(root, "없는 폴더/체크시트.xlsx")).tag, "failed");
});

test("🔴 바로가기(심볼릭 링크)는 따라가지 않는다", async (t) => {
  const outsideDir = await makeRoot();
  await writeFile(path.join(outsideDir, "밖의 비밀.txt"), "secret");

  const root = await makeRoot();
  try {
    await symlink(path.join(outsideDir, "밖의 비밀.txt"), path.join(root, "링크.txt"), "file");
    await symlink(outsideDir, path.join(root, "링크폴더"), "junction");
  } catch {
    // Windows 에서는 관리자 권한이 없으면 링크를 못 만든다 — 그때는 이 시험을 건너뛴다.
    t.skip("이 PC 에서는 심볼릭 링크를 만들 수 없다");
    return;
  }

  // 🔴 링크는 목록에 서지 않으므로 파일로도 폴더로도 걷지 못한다 — **밖의 내용이 안 나온다.**
  assert.equal(refusal(await read(root, "링크.txt")).tag, "rejected:NOT_FOUND");
  assert.equal(refusal(await read(root, "링크폴더/밖의 비밀.txt")).tag, "failed");
});

test("🔴 거절 사유에 경로가 **한 글자도** 없다 — 폴더 이름에 고객사명이 섞여 있다", async () => {
  const root = await makeRoot();
  const folder = `${INSIDE} ${SECRET} WN3947`;
  await mkdir(path.join(root, folder));
  await writeFile(path.join(root, folder, "큰 파일.pdf"), "0123456789");

  const results = [
    await read(root, `${folder}/../../${SECRET}.xlsx`),
    await read(root, `${folder}/${SECRET} 설치.exe`),
    await read(root, `${folder}/${SECRET} 없는 것.pdf`),
    await read(root, folder),
    await read(root, `${folder}/큰 파일.pdf`, { maxBytes: 4 }),
    // 🔴 걷다 막힌 갈래(failed)도 같은 규율이다.
    await read(root, `${SECRET} 없는 폴더/${SECRET}.pdf`),
  ];

  for (const result of results) {
    const no = refusal(result);
    for (const forbidden of [SECRET, folder, root, "/", "\\", INSIDE, "큰 파일"]) {
      assert.equal(no.reason.includes(forbidden), false, `사유에 경로가 샜다: ${no.reason}`);
    }
  }
});

test("🔴 읽기만 한다 — 서류함에 아무것도 늘지 않고 원본이 그대로다", async () => {
  const { root, relativePath } = await makeRootWithFile("체크시트.xlsx", "원본");

  await read(root, relativePath);
  await read(root, `${INSIDE}/없는 것.pdf`);
  await read(root, `${INSIDE}/설치.exe`);

  assert.deepEqual((await readdir(root)).sort(), [INSIDE]);
  assert.deepEqual((await readdir(path.join(root, INSIDE))).sort(), ["체크시트.xlsx"]);
  const again = await read(root, relativePath);
  assert.equal(again.status === "read" ? new TextDecoder().decode(again.bytes) : null, "원본");
});
