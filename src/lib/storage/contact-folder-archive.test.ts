import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  CONTACT_FOLDER_LOOKUP_TIMEOUT_MS,
  CONTACT_FOLDER_SLOW_REASON,
  findContactFolder,
  resolveContactFolderArchiveRoot,
  type ContactFolderLookup,
} from "./contact-folder-archive";
import { ShareFolderTimeout, withShareFolderTimeout } from "./share-folder-fs";

/*
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더
 * (`\\192.168.0.222\…`)에 닿지 않는다. 끝나면 만든 임시 폴더를 통째로 지운다.
 * 고객사 · 모델 · S/N 은 가짜다(저장소가 공개다).
 *
 * 🔴 이 모듈은 **찾기만** 한다. 그래서 거의 모든 시험이 「무엇도 만들거나 지우지
 * 않았다」를 함께 본다(snapshot).
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const NAME = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

function find(root: string, intakeNumber = "D260908"): Promise<ContactFolderLookup> {
  return findContactFolder({ root, intakeNumber });
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

function assertFailedWithoutPath(result: ContactFolderLookup, root: string): string {
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

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

test("찾기 — 사람이 만든 폴더들 가운데 인수번호가 맞는 하나를 찾는다, 🔴 아무것도 만들지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "D260907 다른상사 MB-100 점검요청"));
  await mkdir(path.join(root, NAME));
  await mkdir(path.join(root, "D2609081 번호가 이어지는 남의 폴더"));
  await mkdir(path.join(root, "메모 폴더"));
  const before = await snapshot(root);

  const result = await find(root);

  assert.deepEqual(result, { status: "found", folderName: NAME });
  assert.deepEqual(await snapshot(root), before, "찾기가 무엇인가를 만들거나 지웠다");
});

test("🔴 번호가 이어지는 폴더(D2609081)는 걸리지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "D2609081 다른상사 점검요청"));
  await mkdir(path.join(root, "D260908X 다른상사 점검요청"));

  assert.deepEqual(await find(root), { status: "not-found" });
});

test("🔴 소문자로 적힌 폴더(d260908)도 걸린다 — 돌려주는 것은 디스크의 실제 이름", async () => {
  const root = await makeRoot();
  const human = "d260908  INVENIA  점검요청";
  await mkdir(path.join(root, human));

  const result = await find(root);

  assert.deepEqual(result, { status: "found", folderName: human });
  if (result.status !== "found") throw new Error("unreachable");
  // 🔴 다듬은 이름이 아니라 디스크에 적힌 그대로다 — 이 이름으로만 경로를 이을 수 있다.
  assert.equal(await exists(path.join(root, result.folderName)), true);
});

test("찾기 — 인수번호 뒤가 전각 공백이거나 공백 두 칸이어도 걸린다(정규화가 접는다)", async () => {
  const root = await makeRoot();
  // 🔴 탭이 든 이름은 **Windows 가 만들지 못한다**(mkdir 이 EINVAL). 리눅스(NAS)에서는
  // 만들어지므로 탭 · 제어문자 쪽 대조는 순수 시험(domain/contact-folder-naming.test.ts)이 본다.
  const human = `D260908${String.fromCodePoint(0x3000)}INVENIA  점검요청`;
  await mkdir(path.join(root, human));

  const result = await find(root);

  assert.deepEqual(result, { status: "found", folderName: human });
});

test("찾기 — 맞는 폴더가 둘이면 multiple(앱이 고르지 않는다)", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  await mkdir(path.join(root, "D260908 INVENIA 나중에 또 만든 폴더"));

  const result = await find(root);

  assert.equal(result.status, "multiple");
  if (result.status !== "multiple") throw new Error("unreachable");
  assert.deepEqual(result.folderNames.slice().sort(), [NAME, "D260908 INVENIA 나중에 또 만든 폴더"].sort());
});

test("찾기 — 맞는 폴더가 없으면 not-found, 빈 루트도 not-found, 🔴 만들지 않는다", async () => {
  const root = await makeRoot();
  assert.deepEqual(await find(root), { status: "not-found" });
  assert.deepEqual(await readdir(root), []);

  await mkdir(path.join(root, "D260907 다른상사 점검요청"));
  assert.deepEqual(await find(root), { status: "not-found" });
  assert.deepEqual(await readdir(root), ["D260907 다른상사 점검요청"]);
});

test("🔴 같은 이름의 파일은 후보가 아니다 — 폴더만 센다", async () => {
  const root = await makeRoot();
  await writeFile(path.join(root, NAME), "폴더가 아니다");
  const before = await snapshot(root);

  assert.deepEqual(await find(root), { status: "not-found" });
  assert.deepEqual(await snapshot(root), before);
});

test("🔴 루트가 없으면 루트를 만들지 않고 failed — 사유에 경로가 없다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  const result = await find(missingRoot);

  const reason = assertFailedWithoutPath(result, missingRoot);
  assert.match(reason, /공유폴더를 찾을 수 없습니다/);
  assert.equal(await exists(missingRoot), false, "루트가 생겼다");
  assert.deepEqual(await readdir(parent), []);
});

test("루트가 파일이면 failed — 그 파일을 건드리지 않는다", async () => {
  const parent = await makeRoot();
  const fileRoot = path.join(parent, "공유폴더인-척하는-파일");
  await writeFile(fileRoot, "파일");

  assertFailedWithoutPath(await find(fileRoot), fileRoot);
  assert.deepEqual(await snapshot(parent), ["공유폴더인-척하는-파일"]);
});

test("인수번호가 비면 failed — 디스크를 보지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));

  for (const intakeNumber of ["", "   "]) {
    const reason = assertFailedWithoutPath(await find(root, intakeNumber), root);
    assert.match(reason, /인수번호/);
  }
  assert.deepEqual(await readdir(root), [NAME]);
});

test("🔴 환경변수가 비면 disabled — 루트를 주지 않으면 설정을 읽는다", async () => {
  const original = process.env.CONTACT_FOLDER_ARCHIVE_DIR;
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  try {
    delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    assert.deepEqual(await findContactFolder({ intakeNumber: "D260908" }), { status: "disabled" });

    process.env.CONTACT_FOLDER_ARCHIVE_DIR = "";
    assert.deepEqual(await findContactFolder({ intakeNumber: "D260908" }), { status: "disabled" });

    process.env.CONTACT_FOLDER_ARCHIVE_DIR = "   ";
    assert.deepEqual(await findContactFolder({ intakeNumber: "D260908" }), { status: "disabled" });

    // 루트를 빈 값으로 넘겨도 같다 — 설정이 없는 것이지 실패가 아니다.
    assert.deepEqual(await findContactFolder({ intakeNumber: "D260908", root: "  " }), { status: "disabled" });

    // 설정이 있으면 그 루트에서 찾는다.
    process.env.CONTACT_FOLDER_ARCHIVE_DIR = `  ${root}  `;
    assert.deepEqual(await findContactFolder({ intakeNumber: "D260908" }), { status: "found", folderName: NAME });
  } finally {
    if (original === undefined) delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    else process.env.CONTACT_FOLDER_ARCHIVE_DIR = original;
  }
});

test("resolveContactFolderArchiveRoot — 부르는 시점에 읽고, 비었거나 공백이면 null(기능 꺼짐)", () => {
  const original = process.env.CONTACT_FOLDER_ARCHIVE_DIR;
  try {
    delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    assert.equal(resolveContactFolderArchiveRoot(), null);

    process.env.CONTACT_FOLDER_ARCHIVE_DIR = "";
    assert.equal(resolveContactFolderArchiveRoot(), null);

    process.env.CONTACT_FOLDER_ARCHIVE_DIR = "   ";
    assert.equal(resolveContactFolderArchiveRoot(), null);

    const first = path.join(os.tmpdir(), "contact-folder-root-a");
    process.env.CONTACT_FOLDER_ARCHIVE_DIR = `  ${first}  `;
    assert.equal(resolveContactFolderArchiveRoot(), path.resolve(first));

    // 모듈을 불러온 뒤에 바꿔도 새 값을 읽는다.
    const second = path.join(os.tmpdir(), "contact-folder-root-b");
    process.env.CONTACT_FOLDER_ARCHIVE_DIR = second;
    assert.equal(resolveContactFolderArchiveRoot(), path.resolve(second));
  } finally {
    if (original === undefined) delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    else process.env.CONTACT_FOLDER_ARCHIVE_DIR = original;
  }
});

test("🔴 기다리기 상한 — 공유폴더가 답하지 않으면 기다리기를 그만두고 사유를 돌려준다", async () => {
  assert.equal(CONTACT_FOLDER_LOOKUP_TIMEOUT_MS, 1500);
  // 사유에 경로가 없다.
  assert.ok(!/[\\/]/.test(CONTACT_FOLDER_SLOW_REASON), CONTACT_FOLDER_SLOW_REASON);

  // 영영 안 끝나는 일 — NAS 가 멎었을 때의 모양이다.
  const never = new Promise<string>(() => undefined);
  await assert.rejects(() => withShareFolderTimeout(never, 5), ShareFolderTimeout);

  // 제때 끝나면 그 값이 그대로 나온다.
  assert.equal(await withShareFolderTimeout(Promise.resolve("값"), 1000), "값");

  // 🔴 뒤늦게 깨지는 일이 unhandled rejection 이 되지 않는다(매달린 작업은 뒤에서 끝난다).
  const late = new Promise<string>((_resolve, reject) => {
    setTimeout(() => reject(new Error("뒤늦게 실패")), 20);
  });
  await assert.rejects(() => withShareFolderTimeout(late, 5), ShareFolderTimeout);
  await new Promise((resolve) => setTimeout(resolve, 50));
});

test("🔴 타임아웃이 걸려도 공유폴더를 건드리지 않는다 — failed 로 끝난다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  const before = await snapshot(root);

  // 상한을 0 으로 두면 기다리기가 바로 끝난다. readdir 이 먼저 끝날 수도 있으므로
  // 둘 중 어느 쪽이 나와도 **공유폴더가 그대로인 것**만은 반드시 참이어야 한다.
  const result = await findContactFolder({ root, intakeNumber: "D260908", timeoutMs: 0 });

  assert.ok(result.status === "failed" || result.status === "found", result.status);
  if (result.status === "failed") {
    assert.equal(result.reason, CONTACT_FOLDER_SLOW_REASON);
    assertFailedWithoutPath(result, root);
  }
  assert.deepEqual(await snapshot(root), before);
});
