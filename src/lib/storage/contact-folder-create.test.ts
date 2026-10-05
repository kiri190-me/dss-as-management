import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { contactFolderName, type ContactFolderNamingInput } from "@/lib/domain/contact-folder-naming";
import { createContactFolder, type ContactFolderCreation } from "./contact-folder-archive";

/*
 * ============================================================================
 * 연락서 폴더 **만들기** — mkdtemp 임시 폴더에서만 (연락서 조각 5)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더
 * (`\\192.168.0.222\…`)에 닿지 않는다. 끝나면 만든 임시 폴더를 통째로 지운다.
 * 고객사 · 모델 · S/N 은 가짜다(저장소가 공개다).
 *
 * 못 박는 것:
 *  · 🔴 **있으면 만들지 않는다** · 🔴 **루트를 만들지 않는다**
 *  · 🔴 같은 이름의 **파일**이 자리를 막으면 만들지 않는다
 *  · 🔴 **비슷한 폴더가 있으면 만들지 않는다** — 하나뿐이어도 사람이 고른다
 *  · 🔴 맞는 폴더가 **여럿**이면 만들지 않는다
 *  · 둘이 **동시에** 눌러도 폴더는 하나다(EEXIST 면 다시 찾는다)
 * 찾기 쪽 규율은 contact-folder-archive.test.ts 가, 이름 규칙은
 * domain/contact-folder-naming.test.ts 가 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-create-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

/** 이름을 짓는 재료 한 벌 — DB 에서 읽히는 모양 그대로(빈 칸은 null). */
const NAMING: ContactFolderNamingInput = {
  intakeNumber: "D260908",
  customerName: "INVENIA",
  modelName: "T2RCONT-AD2",
  lotNumber: "WN3947",
  serialNumber: "1802034",
  reportedSymptom: "점검요청",
};

/** 🔴 기대하는 이름은 **domain 이 짓는 것 그대로**다 — 시험이 다시 짓지 않는다. */
const NAME = contactFolderName(NAMING);

function create(root: string, naming: Partial<ContactFolderNamingInput> = {}): Promise<ContactFolderCreation> {
  return createContactFolder({ root, naming: { ...NAMING, ...naming } });
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

function assertFailedWithoutPath(result: ContactFolderCreation, root: string): string {
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

test("빈 루트에 폴더 하나를 만든다 — 이름은 domain 이 지은 그대로", async () => {
  const root = await makeRoot();

  const result = await create(root);

  assert.deepEqual(result, { status: "created", folderName: NAME });
  assert.deepEqual(await snapshot(root), [`${NAME}/`]);
  assert.equal(NAME, "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청");
});

test("🔴 이미 있으면 만들지 않는다 — 디스크가 한 글자도 안 바뀐다", async () => {
  const root = await makeRoot();
  // 사람이 적어 둔 이름(공백 두 칸 · 소문자)이라 앱이 지을 이름과 다르다.
  const human = "d260908  INVENIA 옛날에 만든 폴더";
  await mkdir(path.join(root, human));
  const before = await snapshot(root);

  const result = await create(root);

  assert.deepEqual(result, { status: "found", folderName: human });
  assert.deepEqual(await snapshot(root), before, "이미 있는데 또 만들었다");
  assert.equal(await exists(path.join(root, NAME)), false, "앱이 제 이름으로 하나 더 만들었다");
});

test("🔴 맞는 폴더가 여럿이면 만들지 않는다 — 사람이 정리한다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  await mkdir(path.join(root, "D260908 INVENIA 나중에 또 만든 폴더"));
  const before = await snapshot(root);

  const result = await create(root);

  assert.equal(result.status, "multiple");
  if (result.status !== "multiple") throw new Error("unreachable");
  assert.equal(result.folderNames.length, 2);
  assert.deepEqual(await snapshot(root), before, "여럿인데 하나 더 만들었다");
});

test("🔴 루트가 없으면 루트를 만들지 않고 failed — 사유에 경로가 없다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  const result = await create(missingRoot);

  const reason = assertFailedWithoutPath(result, missingRoot);
  assert.match(reason, /공유폴더를 찾을 수 없습니다/);
  assert.equal(await exists(missingRoot), false, "🔴 루트가 생겼다");
  assert.deepEqual(await readdir(parent), [], "루트 밑에 폴더까지 생겼다");
});

test("루트가 파일이면 failed — 그 파일을 건드리지 않는다", async () => {
  const parent = await makeRoot();
  const fileRoot = path.join(parent, "공유폴더인-척하는-파일");
  await writeFile(fileRoot, "파일");

  assertFailedWithoutPath(await create(fileRoot), fileRoot);
  assert.deepEqual(await snapshot(parent), ["공유폴더인-척하는-파일"]);
});

test("🔴 같은 이름의 파일이 자리를 막으면 만들지 않고 failed — 그 파일을 지우지 않는다", async () => {
  const root = await makeRoot();
  await writeFile(path.join(root, NAME), "폴더가 아니다");
  const before = await snapshot(root);

  const result = await create(root);

  const reason = assertFailedWithoutPath(result, root);
  assert.match(reason, /같은 이름의 파일/);
  assert.deepEqual(await snapshot(root), before, "파일을 지웠거나 옮겼다");
});

test("🔴 S/N 을 품은 비슷한 폴더가 있으면 만들지 않는다 — 하나뿐이어도 사람이 고른다", async () => {
  const root = await makeRoot();
  // 사람이 인수번호 없이 만들어 둔 폴더. 인수번호가 없으니 찾기로는 안 걸린다.
  const human = "INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";
  await mkdir(path.join(root, human));
  const before = await snapshot(root);

  const result = await create(root);

  assert.deepEqual(result, { status: "candidates", folderNames: [human] });
  assert.deepEqual(await snapshot(root), before, "🔴 비슷한 폴더가 있는데 하나 더 만들었다");
});

test("🔴 S/N 을 띄어 적은 폴더도 걸린다 — 공백을 지우고 마디로 견준다", async () => {
  const root = await makeRoot();
  const human = "INVENIA 1912 120 점검요청";
  await mkdir(path.join(root, human));

  const result = await create(root, { serialNumber: "1912120" });

  assert.deepEqual(result, { status: "candidates", folderNames: [human] });
});

test("S/N 이 **일부로만** 들어 있는 폴더는 걸리지 않는다 — 마디 경계를 본다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "INVENIA 18020345 점검요청"));
  await mkdir(path.join(root, "INVENIA X1802034 점검요청"));

  const result = await create(root);

  assert.equal(result.status, "created", JSON.stringify(result));
  assert.equal(await exists(path.join(root, NAME)), true);
});

test("🔴 인수번호로 시작하는 폴더는 훑지 않는다 — 같은 장비의 지난번 수리 건이다", async () => {
  const root = await makeRoot();
  // 같은 S/N 의 지난 건. S/N 은 고유키가 아니라 같은 장비가 여러 번 수리를 온다.
  await mkdir(path.join(root, "D250101 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청"));

  const result = await create(root);

  assert.deepEqual(result, { status: "created", folderName: NAME });
  assert.equal(await exists(path.join(root, NAME)), true);
});

test("S/N 이 비면 그 훑기를 건너뛴다 — 아무 폴더나 걸리지 않게", async () => {
  for (const serialNumber of [null, "", "   "] as const) {
    const root = await makeRoot();
    await mkdir(path.join(root, "INVENIA T2RCONT-AD2 점검요청"));

    const result = await create(root, { serialNumber });

    assert.equal(result.status, "created", `${String(serialNumber)}: ${JSON.stringify(result)}`);
  }
});

test("🔴 둘이 동시에 눌러도 폴더는 하나다 — EEXIST 면 다시 찾아 그것을 쓴다", async () => {
  const root = await makeRoot();

  const results = await Promise.all([create(root), create(root), create(root), create(root)]);

  const created = results.filter((result) => result.status === "created");
  assert.equal(created.length, 1, `만든 쪽이 하나가 아니다: ${JSON.stringify(results)}`);
  for (const result of results) {
    assert.ok(result.status === "created" || result.status === "found", JSON.stringify(result));
    if (result.status === "created" || result.status === "found") {
      assert.equal(result.folderName, NAME);
    }
  }
  assert.deepEqual(await snapshot(root), [`${NAME}/`], "폴더가 둘이 되었다");
});

test("인수번호가 비면 failed — 디스크를 보지 않는다", async () => {
  const root = await makeRoot();

  for (const intakeNumber of ["", "   "]) {
    const reason = assertFailedWithoutPath(await create(root, { intakeNumber }), root);
    assert.match(reason, /인수번호/);
  }
  assert.deepEqual(await readdir(root), [], "이름을 못 지었는데 무엇인가 생겼다");
});

test("🔴 루트 설정이 비면 disabled — 디스크를 건드리지 않는다", async () => {
  const original = process.env.CONTACT_FOLDER_ARCHIVE_DIR;
  try {
    delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    assert.deepEqual(await createContactFolder({ naming: NAMING }), { status: "disabled" });
    assert.deepEqual(await createContactFolder({ naming: NAMING, root: "   " }), { status: "disabled" });
  } finally {
    if (original === undefined) delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
    else process.env.CONTACT_FOLDER_ARCHIVE_DIR = original;
  }
});

test("이름이 너무 길어도 상한 안에서 만든다 — 자르기는 domain 이 한다", async () => {
  const root = await makeRoot();
  const naming = {
    ...NAMING,
    reportedSymptom: "출력이 저하되고 노이즈가 발생하여 전원부 점검이 필요합니다. ".repeat(20),
    customerName: "아주아주아주긴고객사이름주식회사",
  };

  const result = await createContactFolder({ root, naming });

  assert.equal(result.status, "created", JSON.stringify(result));
  if (result.status !== "created") throw new Error("unreachable");
  assert.equal(result.folderName, contactFolderName(naming));
  assert.ok(result.folderName.length <= 72, `${result.folderName.length}`);
  assert.equal(await exists(path.join(root, result.folderName)), true);
});
