import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { QuoteArchiveNamingInput } from "@/lib/domain/quote-archive-naming";
import {
  QUOTE_ARCHIVE_MAX_NUMBERED_COPIES,
  findQuoteArchiveFolder,
  resolveQuoteArchiveRoot,
  saveToQuoteArchive,
  type QuoteArchiveFolderLookup,
  type QuoteArchiveSaveResult,
} from "./quote-archive";

/*
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더에 닿지 않는다.
 * 끝나면 만든 임시 폴더를 통째로 지운다. 공급처 · 모델 이름은 가짜다(저장소가 공개다).
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quote-archive-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const DOMESTIC: QuoteArchiveNamingInput = {
  quoteNumber: "DSS 2026-089",
  kind: "DOMESTIC",
  customerName: "가나상사",
  modelName: "MODEL-X1",
  lotNumber: "L123",
  serialNumber: "S456",
};
const OVERHAUL_BRANCH: QuoteArchiveNamingInput = { ...DOMESTIC, quoteNumber: "DSS 2026-089-1", kind: "OVERHAUL" };

const YEAR_2026 = "21. 2026 내자견적서";
const STEM = "DSS 2026-089 가나상사 MODEL-X1 L123 S456 수리 견적서";
const BRANCH_STEM = "DSS 2026-089-1 가나상사 MODEL-X1 L123 S456 수리 견적서";

function bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

function saveQuoteFile(root: string, content: Uint8Array, naming: QuoteArchiveNamingInput = DOMESTIC) {
  return saveToQuoteArchive({
    root,
    quoteDate: "2026-09-15",
    naming,
    fileKind: "QUOTE_FILE",
    extension: "xlsx",
    bytes: content,
  });
}

function absolute(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}

function assertSaved(result: QuoteArchiveSaveResult): asserts result is Extract<QuoteArchiveSaveResult, { status: "saved" }> {
  assert.equal(result.status, "saved", result.status === "failed" ? result.reason : "");
}

function assertFailedWithoutPath(result: QuoteArchiveSaveResult, root: string): string {
  assert.equal(result.status, "failed");
  if (result.status !== "failed") throw new Error("unreachable");
  const { reason } = result;
  assert.ok(reason.length > 0);
  // 사유는 화면 · 응답 헤더로 나간다 — 경로 · 루트 값이 섞이면 안 된다.
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

test("연도 폴더가 없으면 `NN. YYYY 내자견적서` 로 만들고, 견적서 폴더 · 파일을 새로 쓴다", async () => {
  const root = await makeRoot();
  const result = await saveQuoteFile(root, bytes("견적서 A"));

  assertSaved(result);
  assert.equal(result.relativePath, `${YEAR_2026}/${STEM}/${STEM}.xlsx`);
  assert.equal(result.multipleFolderMatches, false);
  assert.equal(await readFile(absolute(root, result.relativePath), "utf8"), "견적서 A");
  assert.deepEqual(await readdir(root), [YEAR_2026]);
});

test("앞 번호가 다른 연도 폴더가 있으면 그 폴더를 쓴다 — 새 연도 폴더를 만들지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "20. 2026 내자견적서"));
  await mkdir(path.join(root, "20. 2025 내자견적서"));

  const result = await saveQuoteFile(root, bytes("견적서"));

  assertSaved(result);
  assert.equal(result.relativePath, `20. 2026 내자견적서/${STEM}/${STEM}.xlsx`);
  assert.deepEqual((await readdir(root)).sort(), ["20. 2025 내자견적서", "20. 2026 내자견적서"]);
});

test("풀어쓴(NFD) 이름의 연도 폴더도 그 연도 — 경로는 디스크의 실제 이름으로 잇는다", async () => {
  const root = await makeRoot();
  const nfdYear = YEAR_2026.normalize("NFD");
  await mkdir(path.join(root, nfdYear));

  const result = await saveQuoteFile(root, bytes("견적서"));

  assertSaved(result);
  assert.equal(result.relativePath, `${nfdYear}/${STEM}/${STEM}.xlsx`);
  assert.ok(await exists(absolute(root, result.relativePath)));
  assert.deepEqual(await readdir(root), [nfdYear]);
});

test("본 번호 폴더가 있으면 가지 번호 OH 파일이 그 폴더로 — 사람이 적은 폴더 이름 그대로", async () => {
  const root = await makeRoot();
  const yearDirectory = path.join(root, YEAR_2026);
  await mkdir(yearDirectory);
  // 사람이 적은 이름: 공백 두 칸, S/N 없이.
  const humanFolder = "DSS 2026-089  가나상사  MODEL-X1 수리 견적서";
  await mkdir(path.join(yearDirectory, humanFolder));
  // 번호가 이어지는 다른 견적서 폴더와, 폴더가 아닌 파일은 쓰지 않는다.
  await mkdir(path.join(yearDirectory, "DSS 2026-0891 다라상사 수리 견적서"));
  await writeFile(path.join(yearDirectory, "DSS 2026-089 메모.txt"), "메모");

  const result = await saveToQuoteArchive({
    root,
    quoteDate: "2026-09-15",
    naming: OVERHAUL_BRANCH,
    fileKind: "QUOTE_FILE",
    extension: "xls",
    bytes: bytes("OH 견적서"),
  });

  assertSaved(result);
  assert.equal(result.relativePath, `${YEAR_2026}/${humanFolder}/${BRANCH_STEM}(OH포함).xls`);
  assert.equal(result.multipleFolderMatches, false);
  assert.equal(await readFile(absolute(root, result.relativePath), "utf8"), "OH 견적서");
  // 새 견적서 폴더는 생기지 않았다.
  assert.equal((await readdir(yearDirectory)).length, 3);
});

test("맞는 폴더가 둘이면 이름순 첫째를 쓰고 그 사실을 싣는다", async () => {
  const root = await makeRoot();
  const yearDirectory = path.join(root, YEAR_2026);
  await mkdir(yearDirectory);
  await mkdir(path.join(yearDirectory, "DSS 2026-089 나 수리 견적서"));
  await mkdir(path.join(yearDirectory, "DSS 2026-089 가 수리 견적서"));

  const result = await saveQuoteFile(root, bytes("견적서"));

  assertSaved(result);
  assert.equal(result.relativePath, `${YEAR_2026}/DSS 2026-089 가 수리 견적서/${STEM}.xlsx`);
  assert.equal(result.multipleFolderMatches, true);
  assert.deepEqual(await readdir(path.join(yearDirectory, "DSS 2026-089 나 수리 견적서")), []);
});

test("같은 이름이 있으면 덮어쓰지 않고 ` (2)`, ` (3)` 으로 새로 쓴다 — 결재 PDF 도 같다", async () => {
  const root = await makeRoot();

  const first = await saveQuoteFile(root, bytes("첫째"));
  const second = await saveQuoteFile(root, bytes("둘째"));
  const third = await saveQuoteFile(root, bytes("셋째"));
  assertSaved(first);
  assertSaved(second);
  assertSaved(third);
  assert.equal(second.relativePath, `${YEAR_2026}/${STEM}/${STEM} (2).xlsx`);
  assert.equal(third.relativePath, `${YEAR_2026}/${STEM}/${STEM} (3).xlsx`);
  // 앞의 파일은 그대로다.
  assert.equal(await readFile(absolute(root, first.relativePath), "utf8"), "첫째");
  assert.equal(await readFile(absolute(root, second.relativePath), "utf8"), "둘째");

  const signedInput = {
    root,
    quoteDate: "2026-09-15",
    naming: OVERHAUL_BRANCH,
    fileKind: "SIGNED_PDF",
    bytes: bytes("%PDF 결재본"),
  } as const;
  const pdf = await saveToQuoteArchive(signedInput);
  // 같은 이름 자리에 **다른 내용**이 오면 ` (2)` — 같은 바이트면 새로 쓰지 않는다(아래 「내용이 같으면」).
  const pdfAgain = await saveToQuoteArchive({ ...signedInput, bytes: bytes("%PDF 다시 받은 결재본") });
  assertSaved(pdf);
  assertSaved(pdfAgain);
  assert.equal(pdf.relativePath, `${YEAR_2026}/${STEM}/${BRANCH_STEM}(OH포함) - 有印.pdf`);
  assert.equal(pdfAgain.relativePath, `${YEAR_2026}/${STEM}/${BRANCH_STEM}(OH포함) - 有印 (2).pdf`);
  assert.equal(await readFile(absolute(root, pdf.relativePath), "utf8"), "%PDF 결재본");
});

// ── 내용이 같으면 새로 쓰지 않는다 (2026-09-15 사용자 결정) ──────────────────

function assertUnchanged(
  result: QuoteArchiveSaveResult
): asserts result is Extract<QuoteArchiveSaveResult, { status: "unchanged" }> {
  assert.equal(result.status, "unchanged", result.status === "failed" ? result.reason : result.status);
}

test("같은 바이트를 두 번 저장하면 둘째는 unchanged — 파일은 하나, 앞의 파일은 그대로", async () => {
  const root = await makeRoot();
  const first = await saveQuoteFile(root, bytes("같은 견적서"));
  const second = await saveQuoteFile(root, bytes("같은 견적서"));

  assertSaved(first);
  assertUnchanged(second);
  assert.equal(second.relativePath, first.relativePath);
  assert.equal(second.multipleFolderMatches, false);
  assert.deepEqual(await readdir(path.join(root, YEAR_2026, STEM)), [`${STEM}.xlsx`]);
  assert.equal(await readFile(absolute(root, first.relativePath), "utf8"), "같은 견적서");
});

test("결재 PDF 도 같다 — 같은 PDF 를 두 번 저장하면 공유폴더 파일은 하나", async () => {
  const root = await makeRoot();
  const signedInput = {
    root,
    quoteDate: "2026-09-15",
    naming: DOMESTIC,
    fileKind: "SIGNED_PDF",
    bytes: bytes("%PDF 같은 결재본"),
  } as const;

  const first = await saveToQuoteArchive(signedInput);
  const second = await saveToQuoteArchive(signedInput);

  assertSaved(first);
  assertUnchanged(second);
  assert.equal(second.relativePath, `${YEAR_2026}/${STEM}/${STEM} - 有印.pdf`);
  assert.deepEqual(await readdir(path.join(root, YEAR_2026, STEM)), [`${STEM} - 有印.pdf`]);
});

test("같은 바이트가 번호 붙은 자리에 있으면 그 자리를 가리킨다 — 다른 내용은 다음 번호", async () => {
  const root = await makeRoot();
  const a = await saveQuoteFile(root, bytes("가 판"));
  const b = await saveQuoteFile(root, bytes("나 판"));
  const c = await saveQuoteFile(root, bytes("다 판"));
  assertSaved(a);
  assertSaved(b);
  assertSaved(c);
  assert.equal(c.relativePath, `${YEAR_2026}/${STEM}/${STEM} (3).xlsx`);

  const againB = await saveQuoteFile(root, bytes("나 판"));
  assertUnchanged(againB);
  assert.equal(againB.relativePath, `${YEAR_2026}/${STEM}/${STEM} (2).xlsx`);
  const againA = await saveQuoteFile(root, bytes("가 판"));
  assertUnchanged(againA);
  assert.equal(againA.relativePath, `${YEAR_2026}/${STEM}/${STEM}.xlsx`);

  const d = await saveQuoteFile(root, bytes("라 판"));
  assertSaved(d);
  assert.equal(d.relativePath, `${YEAR_2026}/${STEM}/${STEM} (4).xlsx`);
  assert.equal((await readdir(path.join(root, YEAR_2026, STEM))).length, 4);
});

test("크기가 같아도 내용이 다르면 새로 쓴다", async () => {
  const root = await makeRoot();
  const first = await saveQuoteFile(root, bytes("가나"));
  const second = await saveQuoteFile(root, bytes("나가"));
  assertSaved(first);
  assertSaved(second);
  assert.equal(second.relativePath, `${YEAR_2026}/${STEM}/${STEM} (2).xlsx`);
  assert.equal(await readFile(absolute(root, first.relativePath), "utf8"), "가나");
});

test("다른 이름의 파일은 보지 않는다 — 같은 바이트여도 이번 이름의 후보가 아니면 새로 쓴다", async () => {
  const root = await makeRoot();
  const quoteDirectory = path.join(root, YEAR_2026, STEM);
  await mkdir(quoteDirectory, { recursive: true });
  const others = [`${STEM} 사본.xlsx`, `${STEM}.xls`, `${STEM} (2) 메모.xlsx`, `${BRANCH_STEM}(OH포함).xlsx`];
  for (const name of others) await writeFile(path.join(quoteDirectory, name), "같은 바이트");

  const result = await saveQuoteFile(root, bytes("같은 바이트"));

  assertSaved(result);
  assert.equal(result.relativePath, `${YEAR_2026}/${STEM}/${STEM}.xlsx`);
  assert.equal((await readdir(quoteDirectory)).length, others.length + 1);
});

test(`${QUOTE_ARCHIVE_MAX_NUMBERED_COPIES}개가 다 차 있어도 그 가운데 같은 바이트가 있으면 unchanged — 실패하지 않는다`, async () => {
  const root = await makeRoot();
  const quoteDirectory = path.join(root, YEAR_2026, STEM);
  await mkdir(quoteDirectory, { recursive: true });
  await writeFile(path.join(quoteDirectory, `${STEM}.xlsx`), "1");
  for (let n = 2; n <= QUOTE_ARCHIVE_MAX_NUMBERED_COPIES; n += 1) {
    await writeFile(path.join(quoteDirectory, `${STEM} (${n}).xlsx`), String(n));
  }

  const result = await saveQuoteFile(root, bytes("57"));

  assertUnchanged(result);
  assert.equal(result.relativePath, `${YEAR_2026}/${STEM}/${STEM} (57).xlsx`);
  assert.equal((await readdir(quoteDirectory)).length, QUOTE_ARCHIVE_MAX_NUMBERED_COPIES);
});

test("같은 내용을 동시에 두 번 — 덮어쓰기 0(둘 다 새로 쓸 수는 있다: 머리말의 틈)", async () => {
  const root = await makeRoot();
  const results = await Promise.all([saveQuoteFile(root, bytes("동시 같은 내용")), saveQuoteFile(root, bytes("동시 같은 내용"))]);

  for (const result of results) {
    assert.ok(result.status === "saved" || result.status === "unchanged", result.status === "failed" ? result.reason : "");
  }
  assert.ok(results.some((result) => result.status === "saved"), "적어도 하나는 썼다");
  const names = await readdir(path.join(root, YEAR_2026, STEM));
  assert.ok(names.length === 1 || names.length === 2, `파일 수: ${names.length}`);
  for (const name of names) {
    assert.equal(await readFile(path.join(root, YEAR_2026, STEM, name), "utf8"), "동시 같은 내용");
  }
});

test("동시에 저장해도 덮어쓰기 0 — 파일이 다 남고 내용이 각각 온전하다", async () => {
  const root = await makeRoot();

  // 연도 폴더도 견적서 폴더도 없는 상태에서 둘이 동시에 — 폴더 만들기도 겹친다.
  const pair = await Promise.all([saveQuoteFile(root, bytes("가 사람의 견적서")), saveQuoteFile(root, bytes("나 사람의 견적서"))]);
  const [a, b] = pair;
  assertSaved(a);
  assertSaved(b);
  assert.notEqual(a.relativePath, b.relativePath);
  assert.deepEqual(
    [a.relativePath, b.relativePath].sort(),
    [`${YEAR_2026}/${STEM}/${STEM} (2).xlsx`, `${YEAR_2026}/${STEM}/${STEM}.xlsx`]
  );
  assert.equal(await readFile(absolute(root, a.relativePath), "utf8"), "가 사람의 견적서");
  assert.equal(await readFile(absolute(root, b.relativePath), "utf8"), "나 사람의 견적서");
  // 폴더는 하나씩만 생겼다.
  assert.deepEqual(await readdir(root), [YEAR_2026]);
  assert.deepEqual(await readdir(path.join(root, YEAR_2026)), [STEM]);

  // 여섯이 한꺼번에 와도 같다.
  const many = await Promise.all(
    Array.from({ length: 6 }, (_, index) => saveQuoteFile(root, bytes(`동시 ${index}`)))
  );
  const paths = new Set<string>();
  for (const [index, result] of many.entries()) {
    assertSaved(result);
    paths.add(result.relativePath);
    assert.equal(await readFile(absolute(root, result.relativePath), "utf8"), `동시 ${index}`);
  }
  assert.equal(paths.size, 6);
  assert.equal((await readdir(path.join(root, YEAR_2026, STEM))).length, 8);
});

test("루트가 없으면 failed — 루트를 만들지 않는다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  const result = await saveQuoteFile(missingRoot, bytes("견적서"));

  const reason = assertFailedWithoutPath(result, missingRoot);
  assert.match(reason, /공유폴더를 찾을 수 없습니다/);
  assert.equal(await exists(missingRoot), false, "루트가 생겼다");
  assert.deepEqual(await readdir(parent), []);
});

test("루트가 파일이면 failed", async () => {
  const parent = await makeRoot();
  const fileRoot = path.join(parent, "공유폴더인-척하는-파일");
  await writeFile(fileRoot, "파일");

  const result = await saveQuoteFile(fileRoot, bytes("견적서"));

  assertFailedWithoutPath(result, fileRoot);
  assert.equal(await readFile(fileRoot, "utf8"), "파일");
});

test("루트 값이 비었으면 failed", async () => {
  const result = await saveQuoteFile("   ", bytes("견적서"));
  assert.equal(result.status, "failed");
});

test("발행일자가 이상하면 failed — 아무것도 만들지 않는다", async () => {
  const root = await makeRoot();
  for (const quoteDate of ["2026-02-30", "not-a-date", "2005-12-31"]) {
    const result = await saveToQuoteArchive({
      root,
      quoteDate,
      naming: DOMESTIC,
      fileKind: "QUOTE_FILE",
      extension: "xlsx",
      bytes: bytes("견적서"),
    });
    const reason = assertFailedWithoutPath(result, root);
    assert.match(reason, /발행일자/);
  }
  assert.deepEqual(await readdir(root), []);
});

test("발행번호가 비면 failed", async () => {
  const root = await makeRoot();
  const result = await saveQuoteFile(root, bytes("견적서"), { ...DOMESTIC, quoteNumber: "   " });
  assertFailedWithoutPath(result, root);
  assert.deepEqual(await readdir(root), []);
});

test("만들 폴더 자리를 같은 이름의 파일이 차지하고 있으면 failed", async () => {
  const root = await makeRoot();
  await writeFile(path.join(root, YEAR_2026), "폴더가 아니다");

  const result = await saveQuoteFile(root, bytes("견적서"));

  assertFailedWithoutPath(result, root);
  assert.equal(await readFile(path.join(root, YEAR_2026), "utf8"), "폴더가 아니다");
});

test(`같은 이름이 ${QUOTE_ARCHIVE_MAX_NUMBERED_COPIES}개 다 차 있으면 failed — 더 쓰지 않는다`, async () => {
  const root = await makeRoot();
  const quoteDirectory = path.join(root, YEAR_2026, STEM);
  await mkdir(quoteDirectory, { recursive: true });
  await writeFile(path.join(quoteDirectory, `${STEM}.xlsx`), "1");
  for (let n = 2; n <= QUOTE_ARCHIVE_MAX_NUMBERED_COPIES; n += 1) {
    await writeFile(path.join(quoteDirectory, `${STEM} (${n}).xlsx`), String(n));
  }

  const result = await saveQuoteFile(root, bytes("견적서"));

  const reason = assertFailedWithoutPath(result, root);
  assert.match(reason, /너무 많습니다/);
  assert.equal((await readdir(quoteDirectory)).length, QUOTE_ARCHIVE_MAX_NUMBERED_COPIES);
  assert.equal(await readFile(path.join(quoteDirectory, `${STEM}.xlsx`), "utf8"), "1");
});

test("열고 나서 쓰다 실패하면 방금 만든 그 파일만 지우고 failed — 앞의 파일은 그대로", async () => {
  const root = await makeRoot();
  const first = await saveQuoteFile(root, bytes("먼저 저장한 견적서"));
  assertSaved(first);

  // 쓸 수 없는 값을 넘겨 「열린 뒤의 쓰기 실패」를 만든다(실제로는 공간 부족 · 연결 끊김).
  const broken = await saveQuoteFile(root, 12345 as unknown as Uint8Array);

  assertFailedWithoutPath(broken, root);
  const quoteDirectory = path.join(root, YEAR_2026, STEM);
  assert.deepEqual(await readdir(quoteDirectory), [`${STEM}.xlsx`]);
  assert.equal(await readFile(absolute(root, first.relativePath), "utf8"), "먼저 저장한 견적서");
});

// ── 읽기 전용 찾기 (견적서 ④a — [폴더 열기]) ────────────────────────────────

/** 루트 아래 전부(폴더 · 파일)를 슬래시 경로로 — 찾기 앞뒤가 같은지(아무것도 안 만들었는지) 본다. */
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

function find(root: string, naming: QuoteArchiveNamingInput = DOMESTIC, quoteDate = "2026-09-15") {
  return findQuoteArchiveFolder({ root, quoteDate, naming });
}

function assertFound(
  result: QuoteArchiveFolderLookup
): asserts result is Extract<QuoteArchiveFolderLookup, { status: "found" }> {
  assert.equal(result.status, "found", result.status === "failed" ? result.reason : result.status);
}

function assertFindFailedWithoutPath(result: QuoteArchiveFolderLookup, root: string): string {
  assert.equal(result.status, "failed");
  if (result.status !== "failed") throw new Error("unreachable");
  const { reason } = result;
  assert.ok(reason.length > 0);
  assert.ok(!reason.includes(root), `사유에 루트가 들어 있다: ${reason}`);
  assert.ok(!reason.includes(os.tmpdir()), `사유에 임시 폴더 경로가 들어 있다: ${reason}`);
  assert.ok(!/[\\/]/.test(reason), `사유에 경로 구분자가 들어 있다: ${reason}`);
  return reason;
}

test("찾기 — 연도 폴더 · 견적서 폴더가 있으면 found, 경로는 디스크의 실제 이름(NFD · 공백 두 칸 그대로)", async () => {
  const root = await makeRoot();
  const nfdYear = YEAR_2026.normalize("NFD");
  const humanFolder = "DSS 2026-089  가나상사  MODEL-X1 수리 견적서";
  await mkdir(path.join(root, nfdYear, humanFolder), { recursive: true });
  await writeFile(path.join(root, nfdYear, humanFolder, `${STEM}.xlsx`), "견적서");
  const before = await snapshot(root);

  const result = await find(root);

  assertFound(result);
  assert.equal(result.relativePath, `${nfdYear}/${humanFolder}`);
  assert.equal(result.multipleFolderMatches, false);
  assert.deepEqual(await snapshot(root), before, "찾기가 무엇인가를 만들거나 지웠다");
});

test("찾기 — 저장이 고르는 폴더와 같은 폴더를 가리킨다(저장한 뒤 찾으면 그 폴더)", async () => {
  const root = await makeRoot();
  const saved = await saveQuoteFile(root, bytes("견적서"));
  assertSaved(saved);

  const result = await find(root);

  assertFound(result);
  assert.equal(result.relativePath, `${YEAR_2026}/${STEM}`);
  assert.equal(saved.relativePath.startsWith(`${result.relativePath}/`), true);
});

test("찾기 — 가지 번호 견적서도 본 번호 폴더를 찾는다 · 번호가 이어지는 다른 폴더 · 같은 이름의 파일은 아니다", async () => {
  const root = await makeRoot();
  const yearDirectory = path.join(root, YEAR_2026);
  await mkdir(yearDirectory);
  await mkdir(path.join(yearDirectory, "DSS 2026-0891 다라상사 수리 견적서"));
  await writeFile(path.join(yearDirectory, "DSS 2026-089 메모.txt"), "메모");
  await mkdir(path.join(yearDirectory, STEM));
  const before = await snapshot(root);

  const result = await find(root, OVERHAUL_BRANCH);

  assertFound(result);
  assert.equal(result.relativePath, `${YEAR_2026}/${STEM}`);
  assert.deepEqual(await snapshot(root), before);
});

test("찾기 — 맞는 폴더가 둘이면 저장과 같이 이름순 첫째 · 그 사실을 싣는다", async () => {
  const root = await makeRoot();
  const yearDirectory = path.join(root, YEAR_2026);
  await mkdir(path.join(yearDirectory, "DSS 2026-089 나 수리 견적서"), { recursive: true });
  await mkdir(path.join(yearDirectory, "DSS 2026-089 가 수리 견적서"));

  const result = await find(root);

  assertFound(result);
  assert.equal(result.relativePath, `${YEAR_2026}/DSS 2026-089 가 수리 견적서`);
  assert.equal(result.multipleFolderMatches, true);
});

test("찾기 — 연도 폴더가 없으면 not-found, 🔴 아무것도 만들지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "20. 2025 내자견적서"));
  const before = await snapshot(root);

  const result = await find(root);

  assert.deepEqual(result, { status: "not-found" });
  assert.deepEqual(await snapshot(root), before);
});

test("찾기 — 연도 폴더는 있고 견적서 폴더가 없으면 not-found, 🔴 아무것도 만들지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, YEAR_2026, "DSS 2026-090 다른 견적서"), { recursive: true });
  // 견적서 폴더 이름과 같은 **파일**은 폴더가 아니다.
  await writeFile(path.join(root, YEAR_2026, STEM), "폴더가 아니다");
  const before = await snapshot(root);

  const result = await find(root);

  assert.deepEqual(result, { status: "not-found" });
  assert.deepEqual(await snapshot(root), before);
});

test("찾기 — 빈 루트에서도 not-found 이고 루트는 빈 채로 남는다", async () => {
  const root = await makeRoot();
  const result = await find(root);
  assert.deepEqual(result, { status: "not-found" });
  assert.deepEqual(await readdir(root), []);
});

test("찾기 — 루트가 없으면 failed, 🔴 루트를 만들지 않는다 · 사유에 경로가 없다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  const result = await find(missingRoot);

  const reason = assertFindFailedWithoutPath(result, missingRoot);
  assert.match(reason, /공유폴더를 찾을 수 없습니다/);
  assert.equal(await exists(missingRoot), false, "루트가 생겼다");
  assert.deepEqual(await readdir(parent), []);
});

test("찾기 — 루트가 파일이거나 비었으면 failed", async () => {
  const parent = await makeRoot();
  const fileRoot = path.join(parent, "공유폴더인-척하는-파일");
  await writeFile(fileRoot, "파일");

  assertFindFailedWithoutPath(await find(fileRoot), fileRoot);
  assert.equal(await readFile(fileRoot, "utf8"), "파일");
  assert.equal((await find("   ")).status, "failed");
});

test("찾기 — 발행일자가 이상하거나 발행번호가 비면 failed, 아무것도 만들지 않는다", async () => {
  const root = await makeRoot();
  for (const quoteDate of ["2026-02-30", "not-a-date", "2005-12-31"]) {
    const reason = assertFindFailedWithoutPath(await find(root, DOMESTIC, quoteDate), root);
    assert.match(reason, /발행일자/);
  }
  const reason = assertFindFailedWithoutPath(await find(root, { ...DOMESTIC, quoteNumber: "   " }), root);
  assert.match(reason, /발행번호/);
  assert.deepEqual(await readdir(root), []);
});

test("resolveQuoteArchiveRoot — 부르는 시점에 읽고, 비었거나 공백이면 null(기능 꺼짐)", () => {
  const original = process.env.QUOTE_ARCHIVE_DIR;
  try {
    delete process.env.QUOTE_ARCHIVE_DIR;
    assert.equal(resolveQuoteArchiveRoot(), null);

    process.env.QUOTE_ARCHIVE_DIR = "";
    assert.equal(resolveQuoteArchiveRoot(), null);

    process.env.QUOTE_ARCHIVE_DIR = "   ";
    assert.equal(resolveQuoteArchiveRoot(), null);

    const first = path.join(os.tmpdir(), "quote-archive-root-a");
    process.env.QUOTE_ARCHIVE_DIR = `  ${first}  `;
    assert.equal(resolveQuoteArchiveRoot(), path.resolve(first));

    // 모듈을 불러온 뒤에 바꿔도 새 값을 읽는다.
    const second = path.join(os.tmpdir(), "quote-archive-root-b");
    process.env.QUOTE_ARCHIVE_DIR = second;
    assert.equal(resolveQuoteArchiveRoot(), path.resolve(second));
  } finally {
    if (original === undefined) delete process.env.QUOTE_ARCHIVE_DIR;
    else process.env.QUOTE_ARCHIVE_DIR = original;
  }
});
