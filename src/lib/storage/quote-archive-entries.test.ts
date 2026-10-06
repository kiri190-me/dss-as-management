import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { QuoteArchiveNamingInput } from "@/lib/domain/quote-archive-naming";
import { quoteArchiveFolderName } from "@/lib/domain/quote-archive-naming";
import { resolveQuoteArchiveRoot } from "./quote-archive";
import {
  QUOTE_ARCHIVE_ENTRIES_LIMIT,
  QUOTE_ARCHIVE_ENTRIES_SLOW_REASON,
  QUOTE_ARCHIVE_ENTRIES_TIMEOUT_MS,
  compareQuoteArchiveEntries,
  listQuoteArchiveEntries,
  type QuoteArchiveEntriesResult,
} from "./quote-archive-entries";

/*
 * ============================================================================
 * 견적서 폴더 **안을 읽는다** — 맨 위 칸만, 상한을 걸고 (2026-10-06)
 * ============================================================================
 * 🔴 **모든 시험이 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지 않는다.**
 * 그것을 보장하는 길이 둘이다(이웃 quote-archive-create-folder.test.ts 와 같은 방법):
 *   1. 디스크를 보는 시험은 전부 `root` 에 **임시 폴더를 직접 넘긴다.** 그 값이 있으면
 *      listQuoteArchiveEntries 는 설정(QUOTE_ARCHIVE_DIR)을 **아예 읽지 않는다.**
 *   2. 설정을 읽는 길을 보는 시험(아래 `disabled`)은 그 환경변수를 **지우고** 부르고,
 *      부르기 전에 `resolveQuoteArchiveRoot() === null` 임을 먼저 확인한 뒤 되돌린다.
 * 끝나면 만든 임시 폴더를 통째로 지운다. 공급처 · 모델 · L/N · S/N 은 가짜다(저장소가 공개다).
 *
 * 🔴 이 모듈은 **읽기만** 한다. 그래서 거의 모든 시험이 「무엇도 만들거나 지우지
 * 않았다」를 함께 본다(snapshot). 원본에 쓰기 · 지우기 낱말이 한 글자도 없다는 것은
 * 이웃 quote-archive-entries-source.test.ts 가 글자로 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quote-entries-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

/** 이름을 짓는 재료 한 벌 — DB 에서 읽히는 모양 그대로. 🔴 전부 가짜다. */
const NAMING: QuoteArchiveNamingInput = {
  quoteNumber: "DSS 2026-089",
  kind: "DOMESTIC",
  customerName: "가나상사",
  modelName: "MODEL-X1",
  lotNumber: "L123",
  serialNumber: "S456",
};

const QUOTE_DATE = "2026-09-15";
const YEAR_2026 = "21. 2026 내자견적서";
/** 🔴 기대하는 이름은 **domain 이 짓는 것 그대로**다 — 시험이 다시 짓지 않는다. */
const FOLDER = quoteArchiveFolderName(NAMING);

function list(
  root: string | null | undefined,
  overrides: { naming?: Partial<QuoteArchiveNamingInput>; limit?: number; timeoutMs?: number } = {}
): Promise<QuoteArchiveEntriesResult> {
  const { naming, ...rest } = overrides;
  return listQuoteArchiveEntries({ root, quoteDate: QUOTE_DATE, naming: { ...NAMING, ...naming }, ...rest });
}

/** 루트와 그 안의 연도 폴더 · 견적서 폴더를 만든다 — 시험 준비지, 앱이 하는 일이 아니다. */
async function makeQuoteFolder(folderName: string = FOLDER): Promise<{ root: string; folder: string }> {
  const root = await makeRoot();
  const folder = path.join(root, YEAR_2026, folderName);
  await mkdir(folder, { recursive: true });
  return { root, folder };
}

/** 루트 아래의 모든 항목 — 폴더는 끝에 `/`. 읽기가 무엇인가를 만들거나 지웠으면 여기서 드러난다. */
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

function foundOrFail(result: QuoteArchiveEntriesResult) {
  assert.equal(result.status, "found", JSON.stringify(result));
  if (result.status !== "found") throw new Error("unreachable");
  return result;
}

function assertFailedWithoutPath(result: QuoteArchiveEntriesResult, root: string): string {
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
  const { root, folder } = await makeQuoteFolder();
  await writeFile(path.join(folder, "견적서.xlsx"), "가나다");
  const before = await snapshot(root);

  const result = foundOrFail(await list(root));

  // 🔴 폴더를 가리키는 값은 **루트 기준 상대 경로**뿐이다 — 이웃 통로가 [폴더 열기]에 쓰는 값과 같다.
  assert.equal(result.relativePath, `${YEAR_2026}/${FOLDER}`);
  assert.equal(result.entries.length, 1);
  assert.equal(result.totalCount, 1);
  assert.equal(result.truncated, false);
  const [entry] = result.entries;
  assert.equal(entry.name, "견적서.xlsx");
  assert.equal(entry.isDirectory, false);
  assert.equal(entry.sizeBytes, Buffer.byteLength("가나다"));
  assert.ok(entry.modifiedAtMs !== null && entry.modifiedAtMs > 0, String(entry.modifiedAtMs));

  assert.deepEqual(await snapshot(root), before, "읽기가 무엇인가를 만들거나 지웠다");
});

test("🔴 돌려주는 값에 **절대 경로가 한 글자도 없다** — 루트도, 이어 붙인 전체 경로도", async () => {
  const { root, folder } = await makeQuoteFolder();
  await writeFile(path.join(folder, "견적서.pdf"), "x");
  await mkdir(path.join(folder, "사진"));

  const result = foundOrFail(await list(root));
  const text = JSON.stringify(result);

  assert.equal(text.includes(root), false, text);
  assert.equal(text.includes(path.basename(root)), false, text);
  assert.equal(text.includes(os.tmpdir()), false, text);
  // 줄의 이름은 **그 폴더 안에서의 이름 하나**다 — 구분자가 섞여 나오지 않는다.
  for (const entry of result.entries) {
    assert.equal(/[\\/]/.test(entry.name), false, entry.name);
    assert.deepEqual(Object.keys(entry).sort(), ["isDirectory", "modifiedAtMs", "name", "sizeBytes"]);
  }
  // 나가는 칸은 이것들뿐이다.
  assert.deepEqual(Object.keys(result).sort(), ["entries", "relativePath", "status", "totalCount", "truncated"]);
});

test("🔴 프로그램이 남긴 것과 숨김 파일은 빠진다 — ~$ · Thumbs.db · desktop.ini · 점으로 시작", async () => {
  const { root, folder } = await makeQuoteFolder();
  // 🔴 실측(2026-10-06) 2026 연도 폴더의 파일 342 개 가운데 57 개가 찌꺼기였고 거의 전부 Thumbs.db 였다.
  for (const hidden of ["~$견적서.xlsx", "Thumbs.db", "thumbs.db", "desktop.ini", "Desktop.ini", ".DS_Store", ".@__thumb"]) {
    await writeFile(path.join(folder, hidden), "x");
  }
  await writeFile(path.join(folder, "견적서.xlsx"), "진짜");

  const result = foundOrFail(await list(root));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["견적서.xlsx"]
  );
  // 거른 줄은 전체 수에도 들지 않는다 — 「더 있습니다」가 거짓으로 서지 않게.
  assert.equal(result.totalCount, 1);
  assert.equal(result.truncated, false);
});

test("순서 — 폴더가 먼저, 그 안에서 이름순(탐색기와 같다)", async () => {
  const { root, folder } = await makeQuoteFolder();
  await writeFile(path.join(folder, "b.pdf"), "b");
  await writeFile(path.join(folder, "a.pdf"), "a");
  await mkdir(path.join(folder, "zz"));
  await mkdir(path.join(folder, "aa"));

  const result = foundOrFail(await list(root));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["aa", "zz", "a.pdf", "b.pdf"]
  );
  // 순수 비교 자체도 같은 말을 한다.
  assert.ok(compareQuoteArchiveEntries({ name: "zz", isDirectory: true }, { name: "a.pdf", isDirectory: false }) < 0);
  assert.ok(compareQuoteArchiveEntries({ name: "a.pdf", isDirectory: false }, { name: "b.pdf", isDirectory: false }) < 0);
});

test("🔴 하위 폴더로 내려가지 않는다 — 그 안의 파일은 목록에 없다, 폴더는 한 줄로만 선다", async () => {
  const { root, folder } = await makeQuoteFolder();
  await mkdir(path.join(folder, "사진"));
  await writeFile(path.join(folder, "사진", "안쪽사진.jpg"), "속");
  await writeFile(path.join(folder, "견적서.pdf"), "겉");

  const result = foundOrFail(await list(root));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["사진", "견적서.pdf"]
  );
  assert.equal(
    result.entries.some((entry) => entry.name === "안쪽사진.jpg"),
    false,
    JSON.stringify(result.entries)
  );
  // 폴더 줄은 크기를 재지 않는다 — 재려면 안으로 내려가야 한다.
  const photos = result.entries.find((entry) => entry.name === "사진");
  assert.equal(photos?.isDirectory, true);
  assert.equal(photos?.sizeBytes, 0);
  assert.equal(result.totalCount, 2);
});

test("🔴 줄 수 상한 — 넘으면 앞의 N 개만 주고 「더 있습니다」를 함께 나른다", async () => {
  const { root, folder } = await makeQuoteFolder();
  for (const name of ["1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf"]) {
    await writeFile(path.join(folder, name), name);
  }

  const result = foundOrFail(await list(root, { limit: 2 }));

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["1.pdf", "2.pdf"]
  );
  assert.equal(result.totalCount, 5);
  assert.equal(result.truncated, true);

  // 상한에 닿지 않으면 잘리지 않는다.
  const all = foundOrFail(await list(root, { limit: 5 }));
  assert.equal(all.entries.length, 5);
  assert.equal(all.truncated, false);
  assert.equal(all.totalCount, 5);

  // 기본 상한은 100 이다 — 왜 그 숫자인지는 모듈 머리말에 적었다(실측: 폴더당 3~4 개).
  assert.equal(QUOTE_ARCHIVE_ENTRIES_LIMIT, 100);
});

test("🔴 폴더가 없으면 `not-found` 이고 **목록이 없다** — 만들지 않는다", async () => {
  // 연도 폴더조차 없다.
  const emptyRoot = await makeRoot();
  assert.deepEqual(await list(emptyRoot), { status: "not-found" });
  assert.deepEqual(await readdir(emptyRoot), [], "없는 폴더를 만들었다");

  // 연도 폴더는 있지만 그 견적서의 폴더가 없다.
  const root = await makeRoot();
  await mkdir(path.join(root, YEAR_2026));
  const result = await list(root);
  assert.deepEqual(result, { status: "not-found" });
  assert.equal(JSON.stringify(result).includes("entries"), false, JSON.stringify(result));
  assert.deepEqual(await snapshot(root), [`${YEAR_2026}/`], "없는 폴더를 만들었다");
});

test("🔴 같은 번호의 폴더가 여럿이면 `multiple` — **목록도 경로도 내지 않는다**", async () => {
  const { root, folder } = await makeQuoteFolder();
  await writeFile(path.join(folder, "견적서.xlsx"), "이쪽");
  // 같은 본 번호로 시작하는 폴더가 하나 더 있다(사람이 손으로 만들어 둔 것).
  const other = path.join(root, YEAR_2026, `${NAMING.quoteNumber} 다른이름 수리 견적서`);
  await mkdir(other);
  await writeFile(path.join(other, "남의견적서.pdf"), "저쪽");
  const before = await snapshot(root);

  const result = await list(root);

  assert.deepEqual(result, { status: "multiple" });
  // 🔴 어느 폴더인지 모르는데 내용을 보이면 남의 건 서류를 보일 수 있다 — 한 줄도 새어 나오지 않는다.
  const text = JSON.stringify(result);
  for (const secret of ["견적서.xlsx", "남의견적서.pdf", FOLDER, YEAR_2026]) {
    assert.equal(text.includes(secret), false, text);
  }
  assert.deepEqual(await snapshot(root), before);
});

test("🔴 루트 설정이 없으면 `disabled` — 디스크를 한 번도 보지 않는다", async () => {
  const { root, folder } = await makeQuoteFolder();
  await writeFile(path.join(folder, "견적서.xlsx"), "x");
  const before = await snapshot(root);

  const configured = process.env.QUOTE_ARCHIVE_DIR;
  delete process.env.QUOTE_ARCHIVE_DIR;
  try {
    // 🔴 설정이 정말 비었는지 **먼저 확인한다** — 실제 공유폴더를 읽는 일이 없게.
    assert.equal(resolveQuoteArchiveRoot(), null);
    assert.deepEqual(await list(undefined), { status: "disabled" });
    assert.deepEqual(await list(null), { status: "disabled" });
    // 공백뿐인 값도 꺼진 것이다(기능이 꺼져 있다 — 실패가 아니다).
    // 🔴 `failed` 가 아니라 `disabled` 인 것이 곧 **디스크를 보기 전에 끝났다**는 뜻이다:
    //    공백 루트를 들고 디스크로 갔다면 requireExistingShareFolderRoot 가 `failed` 를 냈을 것이다.
    assert.deepEqual(await list("   "), { status: "disabled" });
    assert.deepEqual(await list(""), { status: "disabled" });
  } finally {
    if (configured === undefined) delete process.env.QUOTE_ARCHIVE_DIR;
    else process.env.QUOTE_ARCHIVE_DIR = configured;
  }

  assert.deepEqual(await snapshot(root), before, "꺼져 있는데 디스크를 건드렸다");
});

test("루트가 없으면 루트를 만들지 않고 `failed` — 사유에 경로가 없다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  assertFailedWithoutPath(await list(missingRoot), missingRoot);
  assert.deepEqual(await readdir(parent), [], "루트가 생겼다");
});

test("발행번호가 비면 `failed` — 어느 폴더와도 맞지 않는다, 사유에 경로가 없다", async () => {
  const { root, folder } = await makeQuoteFolder();
  await writeFile(path.join(folder, "견적서.xlsx"), "x");
  const before = await snapshot(root);

  assertFailedWithoutPath(await list(root, { naming: { quoteNumber: "   " } }), root);
  // 발행일자가 날짜가 아니어도 같다 — 연도 폴더를 정할 수 없다.
  assertFailedWithoutPath(
    await listQuoteArchiveEntries({ root, quoteDate: "날짜아님", naming: NAMING }),
    root
  );

  assert.deepEqual(await snapshot(root), before);
});

test("🔴 기다리기 상한 — 공유폴더가 답하지 않으면 그만두고, 공유폴더는 그대로다", async () => {
  // 🔴 이 상한 하나가 **찾기와 읽기를 함께** 덮는다(모듈 머리말).
  assert.equal(QUOTE_ARCHIVE_ENTRIES_TIMEOUT_MS, 3000);
  // 사유에 경로가 없다.
  assert.ok(!/[\\/]/.test(QUOTE_ARCHIVE_ENTRIES_SLOW_REASON), QUOTE_ARCHIVE_ENTRIES_SLOW_REASON);

  const { root, folder } = await makeQuoteFolder();
  await writeFile(path.join(folder, "견적서.xlsx"), "x");
  const before = await snapshot(root);

  // 상한을 0 으로 두면 기다리기가 바로 끝난다. readdir 이 먼저 끝날 수도 있으므로
  // 둘 중 어느 쪽이 나와도 **공유폴더가 그대로인 것**만은 반드시 참이어야 한다.
  const result = await list(root, { timeoutMs: 0 });

  assert.ok(result.status === "failed" || result.status === "found", result.status);
  if (result.status === "failed") {
    assert.equal(result.reason, QUOTE_ARCHIVE_ENTRIES_SLOW_REASON);
  }
  assert.deepEqual(await snapshot(root), before);
});

test("빈 폴더도 `found` 다 — 줄이 없을 뿐이다", async () => {
  const { root } = await makeQuoteFolder();

  const result = foundOrFail(await list(root));

  assert.deepEqual(result.entries, []);
  assert.equal(result.totalCount, 0);
  assert.equal(result.truncated, false);
});
