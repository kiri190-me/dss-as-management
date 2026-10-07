import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { resolveQuoteArchiveRoot } from "./quote-archive";
import {
  QUOTE_ARCHIVE_CASE_NUMBERS_READ_TIMEOUT_MS,
  QUOTE_ARCHIVE_CASE_NUMBERS_SCAN_TIMEOUT_MS,
  QUOTE_ARCHIVE_CASE_NUMBERS_SLOW_REASON,
  listQuoteArchiveFolderRefs,
  quoteArchiveProductKey,
  readQuoteArchiveNumbersForProducts,
  type QuoteArchiveFolderRef,
} from "./quote-archive-case-numbers";

/*
 * ============================================================================
 * **여러 장비의 견적서 번호를 한 번에** 공유폴더에서 읽는다 (2026-10-07)
 * ============================================================================
 * 「고객 안내 현황」의 견적서 번호 칸이 쓴다. 내자 정리에 번호가 적혀 있지 **않은** 줄만
 * 여기까지 온다 — 그 규칙 자체는 조회(db/queries/customer-portal.ts)가 지킨다.
 *
 * 🔴 **모든 시험이 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지 않는다.**
 * 그것을 보장하는 길이 둘이다(이웃 quote-archive-product-folders.test.ts 와 **같은 방법**):
 *   1. 디스크를 보는 시험은 전부 `root` 에 **임시 폴더를 직접 넘긴다.** 그 값이 있으면
 *      두 함수 모두 설정(QUOTE_ARCHIVE_DIR)을 **아예 읽지 않는다.**
 *   2. 설정을 읽는 길을 보는 시험(아래 `disabled`)은 그 환경변수를 **지우고** 부르고,
 *      부르기 전에 `resolveQuoteArchiveRoot() === null` 임을 먼저 확인한 뒤 되돌린다.
 * 끝나면 만든 임시 폴더를 통째로 지운다.
 *
 * 🔴 **고객사명 · 모델 · L/N · S/N 은 전부 가짜다**(저장소가 공개다) — 모양만 실제와 같다
 * (L/N 은 영문 2 + 숫자 4, S/N 은 숫자 7).
 *
 * 🔴 이 모듈은 **읽기만** 한다. 그래서 디스크를 보는 시험이 「무엇도 만들거나 지우지
 * 않았다」를 함께 본다(snapshot). 원본에 쓰기 · 지우기 낱말이 한 글자도 없다는 것은 이웃
 * quote-archive-case-numbers-source.test.ts 가 글자로 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quote-case-numbers-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

/** 🔴 가짜 장비 한 대. */
const LOT = "AB1234";
const SERIAL = "1234567";

const YEAR_2023 = "18. 2023 내자견적서";
const YEAR_2024 = "19. 2024 내자견적서";
const YEAR_2026 = "21. 2026 내자견적서";

/** 폴더 이름 모양 — `DSS <번호> <고객사> <모델> <L/N> <S/N> <신고증상>`. */
function folderName(quoteNumber: string, lot: string = LOT, serial: string = SERIAL): string {
  return `DSS ${quoteNumber} 가나상사 MODEL-X1 ${lot} ${serial} 전원 불량`;
}

/** 연도 폴더 아래에 견적서 폴더를 만들고 그 안에 파일 이름들을 둔다 — 시험 준비다. */
async function makeFolder(
  root: string,
  yearFolder: string,
  name: string,
  fileNames: readonly string[] = []
): Promise<void> {
  const folder = path.join(root, yearFolder, name);
  await mkdir(folder, { recursive: true });
  for (const fileName of fileNames) {
    await writeFile(path.join(folder, fileName), "시험용 빈 파일");
  }
}

/** 루트 아래의 모든 항목 — 폴더는 끝에 `/`. 읽기가 무엇인가를 만들거나 지웠으면 드러난다. */
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

/** 훑기 → 읽기를 잇는다. 화면이 하는 일과 같은 차례다(훑기는 화면당 한 번이다). */
async function numbersFor(
  root: string,
  products: readonly { lotNumber: string | null; serialNumber: string | null }[],
  overrides: { folderLimit?: number; timeoutMs?: number } = {}
): Promise<Map<string, string[]>> {
  const scanned = await listQuoteArchiveFolderRefs({ root });
  assert.equal(scanned.status, "found", JSON.stringify(scanned));
  const folders = scanned.status === "found" ? scanned.folders : [];
  const read = await readQuoteArchiveNumbersForProducts({ root, folders, products, ...overrides });
  assert.equal(read.status, "found", JSON.stringify(read));
  return read.status === "found" ? read.numbersByProduct : new Map();
}

function keyOf(lot: string | null, serial: string | null): string {
  const key = quoteArchiveProductKey(lot, serial);
  assert.notEqual(key, null, "열쇠를 만들지 못했다");
  return key!;
}

// ── 열쇠 ─────────────────────────────────────────────────────────────────

test("🔴 열쇠는 L/N 과 S/N 이 **둘 다** 있어야 만들어진다", () => {
  assert.notEqual(quoteArchiveProductKey(LOT, SERIAL), null);
  for (const [lot, serial] of [
    [LOT, null],
    [null, SERIAL],
    [LOT, ""],
    ["   ", SERIAL],
    // 🔴 `-` 는 빈 값이다 — 수리 건 조회가 빈 칸을 그렇게 채워 내려보낸다
    //    (mappers/repair-case.ts). 그것을 열쇠로 쓰면 이름에 `-` 가 든 폴더가 전부 걸린다.
    [LOT, "-"],
    ["-", SERIAL],
    ["-", "-"],
  ] as const) {
    assert.equal(quoteArchiveProductKey(lot, serial), null, `${String(lot)} / ${String(serial)}`);
  }
});

test("열쇠는 대소문자 · 앞뒤 공백을 접는다 — 사람이 적은 값이라 모양이 흔들린다", () => {
  assert.equal(quoteArchiveProductKey("ab1234", SERIAL), quoteArchiveProductKey(" AB1234 ", SERIAL));
});

// ── 훑기 ─────────────────────────────────────────────────────────────────

test("연도 폴더를 전부 훑어 견적서 폴더 이름을 모은다 — 연도 폴더가 아닌 것은 안 본다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-100"));
  await makeFolder(root, YEAR_2024, folderName("2023-018"));
  // 연도 폴더가 아닌 폴더(사람이 만들어 둔 것) — 그 안은 보지 않는다.
  await makeFolder(root, "보관함", "아무 폴더");
  const before = await snapshot(root);

  const scanned = await listQuoteArchiveFolderRefs({ root });
  assert.equal(scanned.status, "found");
  const folders = scanned.status === "found" ? scanned.folders : [];
  assert.deepEqual(
    folders.map((folder: QuoteArchiveFolderRef) => `${folder.yearFolderName}/${folder.folderName}`).sort(),
    [`${YEAR_2024}/${folderName("2023-018")}`, `${YEAR_2026}/${folderName("2026-100")}`]
  );

  assert.deepEqual(await snapshot(root), before, "훑기가 무엇인가를 만들거나 지웠다");
});

test("🔴 루트 설정이 없으면 `disabled` — 디스크를 한 번도 보지 않는다", async () => {
  const configured = process.env.QUOTE_ARCHIVE_DIR;
  delete process.env.QUOTE_ARCHIVE_DIR;
  try {
    // 🔴 설정이 정말 비었는지 **먼저 확인한다** — 실제 공유폴더를 읽는 일이 없게.
    assert.equal(resolveQuoteArchiveRoot(), null);
    assert.deepEqual(await listQuoteArchiveFolderRefs(), { status: "disabled" });
    assert.deepEqual(await listQuoteArchiveFolderRefs({ root: null }), { status: "disabled" });
    // 공백뿐인 값도 꺼진 것이다(기능이 꺼져 있다 — 실패가 아니다).
    assert.deepEqual(await listQuoteArchiveFolderRefs({ root: "   " }), { status: "disabled" });
    assert.deepEqual(
      await readQuoteArchiveNumbersForProducts({
        folders: [{ yearFolderName: YEAR_2026, folderName: folderName("2026-100") }],
        products: [{ lotNumber: LOT, serialNumber: SERIAL }],
      }),
      { status: "disabled" }
    );
  } finally {
    if (configured !== undefined) process.env.QUOTE_ARCHIVE_DIR = configured;
  }
});

test("루트가 없는 폴더를 가리키면 `failed` 이고, 없는 루트를 만들지 않는다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "없는폴더");

  const scanned = await listQuoteArchiveFolderRefs({ root: missingRoot });
  assert.equal(scanned.status, "failed", JSON.stringify(scanned));
  assert.deepEqual(await readdir(parent), [], "없는 루트를 만들었다");
});

test("🔴 기다리기 상한 — 공유폴더가 답하지 않으면 그만두고, 공유폴더는 그대로다", async () => {
  // 실측 851ms(연도 폴더 21 개)보다 넉넉하다. 사유에 경로가 없다.
  assert.equal(QUOTE_ARCHIVE_CASE_NUMBERS_SCAN_TIMEOUT_MS, 8000);
  assert.equal(QUOTE_ARCHIVE_CASE_NUMBERS_READ_TIMEOUT_MS, 8000);
  assert.ok(!/[\\/]/.test(QUOTE_ARCHIVE_CASE_NUMBERS_SLOW_REASON), QUOTE_ARCHIVE_CASE_NUMBERS_SLOW_REASON);

  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-100"), [`${folderName("2026-100")}.xls`]);
  const before = await snapshot(root);

  // 상한을 0 으로 두면 기다리기가 바로 끝난다. 디스크가 먼저 끝날 수도 있으므로(이웃
  // quote-archive-product-folders.test.ts 와 같은 사정) 둘 중 어느 쪽이 나와도 **공유폴더가
  // 그대로인 것**만은 반드시 참이어야 한다.
  const scanned = await listQuoteArchiveFolderRefs({ root, timeoutMs: 0 });
  assert.ok(scanned.status === "failed" || scanned.status === "found", scanned.status);
  if (scanned.status === "failed") {
    assert.equal(scanned.reason, QUOTE_ARCHIVE_CASE_NUMBERS_SLOW_REASON);
  }

  const read = await readQuoteArchiveNumbersForProducts({
    root,
    folders: [{ yearFolderName: YEAR_2026, folderName: folderName("2026-100") }],
    products: [{ lotNumber: LOT, serialNumber: SERIAL }],
    timeoutMs: 0,
  });
  assert.ok(read.status === "failed" || read.status === "found", read.status);
  if (read.status === "failed") {
    assert.equal(read.reason, QUOTE_ARCHIVE_CASE_NUMBERS_SLOW_REASON);
  }

  assert.deepEqual(await snapshot(root), before);
});

// ── 번호 읽기 ────────────────────────────────────────────────────────────

test("🔴 폴더 **안 파일 이름**에서 번호를 뽑는다 — 한 건에 번호가 여럿일 수 있다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-100"), [
    `${folderName("2026-100")}.xls`,
    // 가지 번호와 개정본 — 🔴 폴더 **이름**만 보면 이 둘은 영영 안 보인다.
    `${folderName("2026-100-1")}(OH포함).xls`,
    `${folderName("2026-104R1")} - 有印.pdf`,
  ]);
  const before = await snapshot(root);

  const numbers = await numbersFor(root, [{ lotNumber: LOT, serialNumber: SERIAL }]);
  assert.deepEqual(numbers.get(keyOf(LOT, SERIAL)), ["DSS 2026-100", "DSS 2026-100-1", "DSS 2026-104R1"]);

  assert.deepEqual(await snapshot(root), before, "읽기가 무엇인가를 만들거나 지웠다");
});

test("🔴 연도를 추측하지 않는다 — 다른 해 폴더에 든 번호도 함께 나온다", async () => {
  const root = await makeRoot();
  // 실측(2026-10-06): `DSS 2023-018` 폴더가 **2024 연도 폴더** 안에 있었다.
  await makeFolder(root, YEAR_2024, folderName("2023-018"), [`${folderName("2023-018")}.xls`]);
  await makeFolder(root, YEAR_2026, folderName("2026-100"), [`${folderName("2026-100")}.xlsx`]);
  await makeFolder(root, YEAR_2023, folderName("2023-001"), [`${folderName("2023-001")}.xls`]);

  const numbers = await numbersFor(root, [{ lotNumber: LOT, serialNumber: SERIAL }]);
  assert.deepEqual(numbers.get(keyOf(LOT, SERIAL)), ["DSS 2023-001", "DSS 2023-018", "DSS 2026-100"]);
});

test("🔴 L/N 과 S/N 이 **둘 다** 맞아야 한다 — 남의 장비 번호가 섞이지 않게", async () => {
  const root = await makeRoot();
  // S/N 만 같은 다른 장비(같은 S/N 에 모델이 여럿인 사례가 실제로 있다).
  await makeFolder(root, YEAR_2026, folderName("2026-200", "ZZ9999", SERIAL), [
    `${folderName("2026-200", "ZZ9999", SERIAL)}.xls`,
  ]);
  // L/N 만 같은 다른 장비.
  await makeFolder(root, YEAR_2026, folderName("2026-201", LOT, "9999999"), [
    `${folderName("2026-201", LOT, "9999999")}.xls`,
  ]);
  await makeFolder(root, YEAR_2026, folderName("2026-100"), [`${folderName("2026-100")}.xls`]);

  const numbers = await numbersFor(root, [{ lotNumber: LOT, serialNumber: SERIAL }]);
  assert.deepEqual(numbers.get(keyOf(LOT, SERIAL)), ["DSS 2026-100"]);
});

test("🔴 마디 경계를 본다 — `1234567` 이 `12345678` 폴더에 걸리지 않는다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-300", LOT, "12345678"), [
    `${folderName("2026-300", LOT, "12345678")}.xls`,
  ]);

  const numbers = await numbersFor(root, [{ lotNumber: LOT, serialNumber: SERIAL }]);
  assert.equal(numbers.get(keyOf(LOT, SERIAL)), undefined);
});

test("밑줄도 구분자다 — `MODEL_LOT_SERIAL` 로 이은 이름이 실제로 있다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, `DSS 2026-400 가나상사 MODEL-X1_${LOT}_${SERIAL} 전원 불량`, [
    `DSS 2026-400 가나상사 MODEL-X1_${LOT}_${SERIAL}.xls`,
  ]);

  const numbers = await numbersFor(root, [{ lotNumber: LOT, serialNumber: SERIAL }]);
  assert.deepEqual(numbers.get(keyOf(LOT, SERIAL)), ["DSS 2026-400"]);
});

test("장비 여럿을 한 번에 — 훑기 한 번으로 줄마다 제 번호를 받는다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-100"), [`${folderName("2026-100")}.xls`]);
  await makeFolder(root, YEAR_2026, folderName("2026-500", "CD5678", "7654321"), [
    `${folderName("2026-500", "CD5678", "7654321")}.xls`,
  ]);

  const numbers = await numbersFor(root, [
    { lotNumber: LOT, serialNumber: SERIAL },
    { lotNumber: "CD5678", serialNumber: "7654321" },
    // 🔴 L/N 이 빈 장비는 아예 보지 않는다 — 결과에도 없다.
    { lotNumber: "-", serialNumber: "1111111" },
  ]);
  assert.equal(numbers.size, 2);
  assert.deepEqual(numbers.get(keyOf(LOT, SERIAL)), ["DSS 2026-100"]);
  assert.deepEqual(numbers.get(keyOf("CD5678", "7654321")), ["DSS 2026-500"]);
});

test("찌꺼기와 하위 폴더는 빼고 본다 — 번호가 없는 폴더는 지도에 들어가지 않는다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-600"), [
    "Thumbs.db",
    "desktop.ini",
    "~$작업중.xlsx",
    ".DS_Store",
    "단가기재 참고용.XLS",
    // 🔴 번호 뒤가 공백이 아닌 오타 — 사람이 적지 않은 번호를 우리가 지어내지 않는다.
    "DSS 2026-046- ICD 참고.xls",
  ]);
  await mkdir(path.join(root, YEAR_2026, folderName("2026-600"), "사진"), { recursive: true });
  await writeFile(
    path.join(root, YEAR_2026, folderName("2026-600"), "사진", "DSS 2026-999 몰래.xls"),
    "하위 폴더까지 내려가면 이것이 번호로 잡힌다"
  );

  const numbers = await numbersFor(root, [{ lotNumber: LOT, serialNumber: SERIAL }]);
  assert.equal(numbers.get(keyOf(LOT, SERIAL)), undefined, JSON.stringify([...numbers]));
});

test("폴더가 비어 있으면 그 장비는 결과에 없다 — 빈 배열도 담지 않는다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-700"));

  const numbers = await numbersFor(root, [{ lotNumber: LOT, serialNumber: SERIAL }]);
  assert.equal(numbers.size, 0);
});

test("🔴 폴더 수 상한에 걸리면 거기까지 읽고 `truncated` 로 알린다", async () => {
  const root = await makeRoot();
  for (const number of ["2026-801", "2026-802", "2026-803"]) {
    await makeFolder(root, YEAR_2026, folderName(number), [`${folderName(number)}.xls`]);
  }

  const scanned = await listQuoteArchiveFolderRefs({ root });
  assert.equal(scanned.status, "found");
  const read = await readQuoteArchiveNumbersForProducts({
    root,
    folders: scanned.status === "found" ? scanned.folders : [],
    products: [{ lotNumber: LOT, serialNumber: SERIAL }],
    folderLimit: 2,
  });
  assert.equal(read.status, "found");
  if (read.status !== "found") return;
  assert.equal(read.truncated, true);
  assert.deepEqual(read.numbersByProduct.get(keyOf(LOT, SERIAL)), ["DSS 2026-801", "DSS 2026-802"]);
});

test("🔴 볼 장비가 없거나 훑어 둔 폴더가 없으면 디스크를 아예 보지 않는다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "없는폴더");

  // 폴더 목록이 비었다(훑기가 `disabled` · `failed` 였을 때의 모양이다).
  assert.deepEqual(
    await readQuoteArchiveNumbersForProducts({
      root: missingRoot,
      folders: [],
      products: [{ lotNumber: LOT, serialNumber: SERIAL }],
    }),
    { status: "found", numbersByProduct: new Map(), truncated: false }
  );

  // 쓸 수 있는 열쇠가 하나도 없다.
  assert.deepEqual(
    await readQuoteArchiveNumbersForProducts({
      root: missingRoot,
      folders: [{ yearFolderName: YEAR_2026, folderName: folderName("2026-100") }],
      products: [{ lotNumber: "-", serialNumber: null }],
    }),
    { status: "found", numbersByProduct: new Map(), truncated: false }
  );

  assert.deepEqual(await readdir(parent), [], "디스크를 보고 없는 루트를 만들었다");
});

test("🔴 훑은 뒤 폴더가 사라져도 던지지 않는다 — `failed` 이고 사유에 경로가 없다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-100"), [`${folderName("2026-100")}.xls`]);
  const scanned = await listQuoteArchiveFolderRefs({ root });
  assert.equal(scanned.status, "found");
  const folders = scanned.status === "found" ? scanned.folders : [];

  // 사람이 훑기와 읽기 사이에 폴더를 치웠다(실제로 일어난다 — 연결이 끊기기도 한다).
  await rm(path.join(root, YEAR_2026, folderName("2026-100")), { recursive: true, force: true });

  const read = await readQuoteArchiveNumbersForProducts({
    root,
    folders,
    products: [{ lotNumber: LOT, serialNumber: SERIAL }],
  });
  assert.equal(read.status, "failed", JSON.stringify(read));
  if (read.status !== "failed") return;
  assert.ok(!/[\\/]/.test(read.reason), read.reason);
});
