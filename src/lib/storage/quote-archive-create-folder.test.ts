import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { QuoteArchiveNamingInput } from "@/lib/domain/quote-archive-naming";
import { quoteArchiveFolderName } from "@/lib/domain/quote-archive-naming";
import {
  createQuoteArchiveFolder,
  resolveQuoteArchiveRoot,
  type QuoteArchiveFolderCreation,
} from "./quote-archive";

/*
 * ============================================================================
 * 견적서 폴더 **만들기만** — mkdtemp 임시 폴더에서만 (2026-10-06)
 * ============================================================================
 * 🔴 **모든 시험이 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지 않는다.**
 * 그것을 보장하는 길이 둘이다:
 *   1. 폴더를 만드는 시험은 전부 `root` 에 **임시 폴더를 직접 넘긴다.** 그 값이 있으면
 *      createQuoteArchiveFolder 는 설정(QUOTE_ARCHIVE_DIR)을 **아예 읽지 않는다.**
 *   2. 설정을 읽는 길을 보는 시험(아래 `disabled`)은 그 환경변수를 **지우고** 부르고,
 *      부르기 전에 `resolveQuoteArchiveRoot() === null` 임을 먼저 확인한 뒤 되돌린다.
 * 끝나면 만든 임시 폴더를 통째로 지운다. 공급처 · 모델 이름은 가짜다(저장소가 공개다).
 *
 * 못 박는 것:
 *  · 🔴 **파일을 한 자도 쓰지 않는다** — 폴더만 선다
 *  · 🔴 **루트 설정이 없으면 `disabled`** 이고 디스크를 보지 않는다
 *  · 🔴 **루트를 만들지 않는다** — 없으면 `failed`
 *  · 🔴 **본 번호로 먼저 찾는다** — 꼬리가 달라도 기존 폴더를 쓴다(만들지 않는다)
 *  · 🔴 새로 만드는 이름의 꼬리는 **신고증상**이다
 *  · 🔴 **던지지 않는다** — 사유에 경로 · 루트가 없다
 *  · 둘이 동시에 저장해도 폴더는 하나다(EEXIST 면 다시 찾는다)
 *
 * 저장(파일 쓰기)·찾기 쪽 규율은 이웃 quote-archive.test.ts 가, 이름 규칙은
 * domain/quote-archive-naming.test.ts 가 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quote-archive-create-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

/** 이름을 짓는 재료 한 벌 — DB 에서 읽히는 모양 그대로(빈 칸은 null). */
const NAMING: QuoteArchiveNamingInput = {
  quoteNumber: "DSS 2026-089",
  kind: "DOMESTIC",
  customerName: "가나상사",
  modelName: "MODEL-X1",
  lotNumber: "L123",
  serialNumber: "S456",
  faultDescription: "전원 불량 발생",
};

const YEAR_2026 = "21. 2026 내자견적서";
/** 🔴 기대하는 이름은 **domain 이 짓는 것 그대로**다 — 시험이 다시 짓지 않는다. */
const FOLDER = quoteArchiveFolderName(NAMING);

function create(
  root: string | null | undefined,
  naming: Partial<QuoteArchiveNamingInput> = {},
  quoteDate = "2026-09-15"
): Promise<QuoteArchiveFolderCreation> {
  return createQuoteArchiveFolder({ root, quoteDate, naming: { ...NAMING, ...naming } });
}

/** 루트 아래의 모든 항목 — 폴더는 끝에 `/`. 파일이 하나라도 있으면 여기서 드러난다. */
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

function assertFailedWithoutPath(result: QuoteArchiveFolderCreation, root: string): string {
  assert.equal(result.status, "failed");
  if (result.status !== "failed") throw new Error("unreachable");
  const { reason } = result;
  assert.ok(reason.length > 0);
  // 사유는 서버 로그로 나간다 — 경로 · 루트 값이 섞이면 안 된다.
  assert.ok(!reason.includes(root), `사유에 루트가 들어 있다: ${reason}`);
  assert.ok(!reason.includes(path.basename(root)), `사유에 루트 이름이 들어 있다: ${reason}`);
  assert.ok(!reason.includes(os.tmpdir()), `사유에 임시 폴더 경로가 들어 있다: ${reason}`);
  assert.ok(!/[\\/]/.test(reason), `사유에 경로 구분자가 들어 있다: ${reason}`);
  return reason;
}

test("🔴 연도 폴더 · 견적서 폴더를 만들고 **파일은 하나도 쓰지 않는다**", async () => {
  const root = await makeRoot();

  const result = await create(root);

  assert.deepEqual(result, {
    status: "created",
    relativePath: `${YEAR_2026}/${FOLDER}`,
    multipleFolderMatches: false,
  });
  // 🔴 선 것은 폴더 둘뿐이다 — 끝에 `/` 가 없는 항목(파일)이 하나도 없다.
  const entries = await snapshot(root);
  assert.deepEqual(entries, [`${YEAR_2026}/`, `${YEAR_2026}/${FOLDER}/`]);
  assert.deepEqual(entries.filter((entry) => !entry.endsWith("/")), []);
  // 새로 만든 견적서 폴더는 비어 있다.
  assert.deepEqual(await readdir(path.join(root, YEAR_2026, FOLDER)), []);
});

test("🔴 새 폴더 이름의 꼬리는 **신고증상**이고, 증상이 비면 「수리 견적서」다", async () => {
  const root = await makeRoot();

  assert.equal((await create(root)).status, "created");
  assert.ok(FOLDER.endsWith(" 전원 불량 발생"), FOLDER);

  const other = await create(root, { quoteNumber: "DSS 2026-090", faultDescription: null });
  if (other.status !== "created") throw new Error(`만들지 않았다: ${other.status}`);
  assert.equal(other.relativePath, `${YEAR_2026}/DSS 2026-090 가나상사 MODEL-X1 L123 S456 수리 견적서`);
});

test("🔴 본 번호의 폴더가 이미 있으면 **만들지 않는다** — 꼬리가 달라도 그 폴더다", async () => {
  const root = await makeRoot();
  const yearDirectory = path.join(root, YEAR_2026);
  await mkdir(yearDirectory);
  // 사람이 손으로 만들어 둔 폴더 — 꼬리가 「수리 견적서」인 옛 이름이고 공백이 두 칸이다.
  const existing = "DSS 2026-089  가나상사 MODEL-X1 수리 견적서";
  await mkdir(path.join(yearDirectory, existing));
  // 그 안에 사람이 넣어 둔 서류 한 장 — 건드리지 않는다.
  await writeFile(path.join(yearDirectory, existing, "메모.txt"), "사람이 넣은 서류");

  const result = await create(root);

  assert.deepEqual(result, {
    status: "found",
    // 🔴 디스크의 **실제 이름**으로 잇는다(다듬은 이름이 아니다).
    relativePath: `${YEAR_2026}/${existing}`,
    multipleFolderMatches: false,
  });
  assert.deepEqual(await snapshot(root), [
    `${YEAR_2026}/`,
    `${YEAR_2026}/${existing}/`,
    `${YEAR_2026}/${existing}/메모.txt`,
  ]);
});

test("가지 번호 견적서도 **본 번호 폴더** 하나로 모인다", async () => {
  const root = await makeRoot();

  assert.equal((await create(root)).status, "created");
  const branch = await create(root, { quoteNumber: "DSS 2026-089-1", kind: "OVERHAUL" });

  assert.equal(branch.status, "found");
  assert.deepEqual(await snapshot(root), [`${YEAR_2026}/`, `${YEAR_2026}/${FOLDER}/`]);
});

test("🔴 루트 설정이 없으면 `disabled` — 디스크를 한 번도 보지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, YEAR_2026));

  const configured = process.env.QUOTE_ARCHIVE_DIR;
  delete process.env.QUOTE_ARCHIVE_DIR;
  try {
    // 🔴 설정이 정말 비었는지 **먼저 확인한다** — 실제 공유폴더에 폴더가 서는 일이 없게.
    assert.equal(resolveQuoteArchiveRoot(), null);
    assert.deepEqual(await create(undefined), { status: "disabled" });
    assert.deepEqual(await create(null), { status: "disabled" });
    // 공백뿐인 값도 꺼진 것이다(기능이 꺼져 있다 — 실패가 아니다).
    assert.deepEqual(await create("   "), { status: "disabled" });
  } finally {
    if (configured === undefined) delete process.env.QUOTE_ARCHIVE_DIR;
    else process.env.QUOTE_ARCHIVE_DIR = configured;
  }

  // 디스크는 그대로다 — 연도 폴더 하나뿐이고 그 안은 비어 있다.
  assert.deepEqual(await snapshot(root), [`${YEAR_2026}/`]);
});

test("🔴 루트가 없거나 폴더가 아니면 만들지 않는다 — `failed`, 사유에 경로가 없다", async () => {
  const root = await makeRoot();
  const missing = path.join(root, "없는 폴더");

  const gone = await create(missing);
  assertFailedWithoutPath(gone, root);
  // 🔴 루트를 만들지 않았다.
  assert.deepEqual(await snapshot(root), []);

  const asFile = path.join(root, "루트가 아니라 파일");
  await writeFile(asFile, "x");
  assertFailedWithoutPath(await create(asFile), root);
});

test("🔴 던지지 않는다 — 발행일자 · 발행번호가 이상하면 `failed`", async () => {
  const root = await makeRoot();

  assertFailedWithoutPath(await create(root, {}, "2026-02-30"), root);
  assertFailedWithoutPath(await create(root, {}, ""), root);
  assertFailedWithoutPath(await create(root, {}, "2005-12-31"), root);
  assertFailedWithoutPath(await create(root, { quoteNumber: "   " }), root);

  // 하나도 서지 않았다.
  assert.deepEqual(await snapshot(root), []);
});

test("같은 이름의 **파일**이 자리를 막으면 만들지 않는다 — `failed`", async () => {
  const root = await makeRoot();
  const yearDirectory = path.join(root, YEAR_2026);
  await mkdir(yearDirectory);
  await writeFile(path.join(yearDirectory, FOLDER), "폴더 자리를 막은 파일");

  assertFailedWithoutPath(await create(root), root);
  assert.deepEqual(await snapshot(root), [`${YEAR_2026}/`, `${YEAR_2026}/${FOLDER}`]);
});

test("둘이 동시에 저장해도 폴더는 하나다 — `EEXIST` 면 다시 찾는다", async () => {
  const root = await makeRoot();

  const results = await Promise.all([create(root), create(root), create(root)]);

  for (const result of results) {
    assert.ok(result.status === "created" || result.status === "found", JSON.stringify(result));
  }
  assert.equal(results.filter((result) => result.status === "created").length, 1, "폴더가 둘 이상 생겼다");
  assert.deepEqual(await snapshot(root), [`${YEAR_2026}/`, `${YEAR_2026}/${FOLDER}/`]);
});

test("앞 번호가 다른 연도 폴더가 있으면 그 폴더를 쓴다 — 새 연도 폴더를 만들지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "20. 2026 내자견적서"));
  await mkdir(path.join(root, "20. 2025 내자견적서"));

  const result = await create(root);

  assert.equal(result.status, "created");
  if (result.status !== "created") throw new Error("unreachable");
  assert.equal(result.relativePath, `20. 2026 내자견적서/${FOLDER}`);
  assert.deepEqual(await snapshot(root), [
    "20. 2025 내자견적서/",
    "20. 2026 내자견적서/",
    `20. 2026 내자견적서/${FOLDER}/`,
  ]);
});

test("맞는 연도 폴더가 둘이면 이름순 첫째를 쓰고 `multipleFolderMatches` 로 알린다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "21. 2026 내자견적서"));
  await mkdir(path.join(root, "20. 2026 내자견적서"));

  const result = await create(root);

  assert.deepEqual(result, {
    status: "created",
    relativePath: `20. 2026 내자견적서/${FOLDER}`,
    multipleFolderMatches: true,
  });
});
