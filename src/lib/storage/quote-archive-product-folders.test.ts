import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { resolveQuoteArchiveRoot } from "./quote-archive";
import {
  QUOTE_ARCHIVE_PRODUCT_FOLDERS_LIMIT,
  QUOTE_ARCHIVE_PRODUCT_FOLDERS_SLOW_REASON,
  QUOTE_ARCHIVE_PRODUCT_FOLDERS_TIMEOUT_MS,
  listQuoteArchiveProductFolders,
  type QuoteArchiveProductFoldersResult,
} from "./quote-archive-product-folders";

/*
 * ============================================================================
 * **같은 장비(L/N + S/N)의 지난 견적서 폴더**를 찾는다 (2026-10-06)
 * ============================================================================
 * 🔴 **모든 시험이 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지 않는다.**
 * 그것을 보장하는 길이 둘이다(이웃 quote-archive-entries.test.ts 와 **같은 방법**):
 *   1. 디스크를 보는 시험은 전부 `root` 에 **임시 폴더를 직접 넘긴다.** 그 값이 있으면
 *      listQuoteArchiveProductFolders 는 설정(QUOTE_ARCHIVE_DIR)을 **아예 읽지 않는다.**
 *   2. 설정을 읽는 길을 보는 시험(아래 `disabled`)은 그 환경변수를 **지우고** 부르고,
 *      부르기 전에 `resolveQuoteArchiveRoot() === null` 임을 먼저 확인한 뒤 되돌린다.
 * 끝나면 만든 임시 폴더를 통째로 지운다.
 *
 * 🔴 **고객사명 · 모델 · L/N · S/N 은 전부 가짜다**(저장소가 공개다) — 모양만 실제와 같다
 * (L/N 은 영문 2 + 숫자 4, S/N 은 숫자 7).
 *
 * 🔴 이 모듈은 **읽기만** 한다. 그래서 거의 모든 시험이 「무엇도 만들거나 지우지 않았다」를
 * 함께 본다(snapshot). 원본에 쓰기 · 지우기 낱말이 한 글자도 없다는 것은 이웃
 * quote-archive-product-folders-source.test.ts 가 글자로 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quote-product-folders-test-"));
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

function list(
  root: string | null | undefined,
  overrides: Partial<Parameters<typeof listQuoteArchiveProductFolders>[0]> = {}
): Promise<QuoteArchiveProductFoldersResult> {
  return listQuoteArchiveProductFolders({ root, lotNumber: LOT, serialNumber: SERIAL, ...overrides });
}

/** 연도 폴더 아래에 견적서 폴더를 만든다 — 시험 준비지, 앱이 하는 일이 아니다. */
async function makeFolder(root: string, yearFolder: string, name: string): Promise<string> {
  const folder = path.join(root, yearFolder, name);
  await mkdir(folder, { recursive: true });
  return folder;
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

function foundOrFail(result: QuoteArchiveProductFoldersResult) {
  assert.equal(result.status, "found", JSON.stringify(result));
  if (result.status !== "found") throw new Error("unreachable");
  return result;
}

test("🔴 L/N 과 S/N 이 **둘 다** 맞아야 걸린다 — 하나만 맞으면 안 걸린다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-001"));
  // L/N 만 같은 다른 장비.
  await makeFolder(root, YEAR_2026, folderName("2026-002", LOT, "7654321"));
  // S/N 만 같은 다른 장비 — 🔴 같은 S/N 에 모델이 여럿인 사례가 이 시스템에 실제로 있다.
  await makeFolder(root, YEAR_2026, folderName("2026-003", "CD5678", SERIAL));
  // 둘 다 아닌 장비.
  await makeFolder(root, YEAR_2026, folderName("2026-004", "EF9012", "9999999"));
  const before = await snapshot(root);

  const result = foundOrFail(await list(root));

  assert.deepEqual(
    result.folders.map((folder) => folder.folderName),
    [folderName("2026-001")]
  );
  assert.deepEqual(await snapshot(root), before, "읽기가 무엇인가를 만들거나 지웠다");
});

test("🔴 경계를 본다 — S/N 이 더 긴 번호의 **앞부분**인 폴더는 걸리지 않는다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-005", LOT, `${SERIAL}8`));
  await makeFolder(root, YEAR_2026, folderName("2026-006", `${LOT}5`, SERIAL));

  assert.deepEqual(foundOrFail(await list(root)).folders, []);
});

test("🔴 같은 장비가 여러 폴더에 걸리면 **전부** 나온다 — 연도 내림차순, 같은 해면 이름순", async () => {
  const root = await makeRoot();
  // 실측(2026-10-06): 한 장비가 최대 4 개 폴더에 걸렸다.
  await makeFolder(root, YEAR_2023, folderName("2023-052"));
  await makeFolder(root, YEAR_2024, folderName("2023-018"));
  await makeFolder(root, YEAR_2024, folderName("2024-027"));
  await makeFolder(root, YEAR_2026, folderName("2026-001"));

  const result = foundOrFail(await list(root));

  assert.deepEqual(
    result.folders.map((folder) => [folder.year, folder.folderName]),
    [
      [2026, folderName("2026-001")],
      [2024, folderName("2023-018")],
      [2024, folderName("2024-027")],
      [2023, folderName("2023-052")],
    ]
  );
  assert.equal(result.truncated, false);
});

test("🔴 번호의 연도와 **연도 폴더가 달라도** 찾는다 — 번호로 연도를 추측하지 않는다", async () => {
  const root = await makeRoot();
  // 실측 사례: `DSS 2023-018` 폴더가 2024 연도 폴더에 들어 있었다.
  await makeFolder(root, YEAR_2024, folderName("2023-018"));

  const result = foundOrFail(await list(root));

  assert.equal(result.folders.length, 1);
  assert.equal(result.folders[0].year, 2024, "연도 폴더가 아니라 번호의 연도를 보았다");
  assert.equal(result.folders[0].yearFolderName, YEAR_2024);
  assert.equal(result.folders[0].relativePath, `${YEAR_2024}/${folderName("2023-018")}`);
});

test("🔴 L/N 이나 S/N 이 비면 **디스크를 아예 보지 않는다**", async () => {
  // 🔴 루트가 **없는 경로**인데도 `failed` 가 아니다 — 디스크를 봤다면 「공유폴더를 찾을 수
  //    없습니다」로 끝났을 것이다. 비어 있다는 사실만으로 끝났다는 증거다.
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  for (const keys of [
    { lotNumber: "", serialNumber: SERIAL },
    { lotNumber: LOT, serialNumber: "" },
    { lotNumber: "   ", serialNumber: SERIAL },
    { lotNumber: null, serialNumber: SERIAL },
    { lotNumber: LOT, serialNumber: undefined },
    // 🔴 수리 건 조회가 빈 칸을 `-` 로 채워 내려보낸다 — 빈 값과 똑같이 다룬다.
    { lotNumber: "-", serialNumber: "-" },
    { lotNumber: "-", serialNumber: SERIAL },
  ]) {
    assert.deepEqual(
      await listQuoteArchiveProductFolders({ root: missingRoot, ...keys }),
      { status: "found", folders: [], truncated: false },
      JSON.stringify(keys)
    );
  }

  assert.deepEqual(await readdir(parent), [], "없는 루트를 만들었다");

  // 열쇠가 멀쩡하면 같은 루트에서 `failed` 가 된다 — 위가 디스크를 안 봤다는 대조다.
  const touched = await list(missingRoot);
  assert.equal(touched.status, "failed", JSON.stringify(touched));
});

test("🔴 루트 설정이 없으면 `disabled` — 디스크를 한 번도 보지 않는다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-001"));
  const before = await snapshot(root);

  const configured = process.env.QUOTE_ARCHIVE_DIR;
  delete process.env.QUOTE_ARCHIVE_DIR;
  try {
    // 🔴 설정이 정말 비었는지 **먼저 확인한다** — 실제 공유폴더를 읽는 일이 없게.
    assert.equal(resolveQuoteArchiveRoot(), null);
    assert.deepEqual(await list(undefined), { status: "disabled" });
    assert.deepEqual(await list(null), { status: "disabled" });
    // 공백뿐인 값도 꺼진 것이다(기능이 꺼져 있다 — 실패가 아니다).
    assert.deepEqual(await list("   "), { status: "disabled" });
    assert.deepEqual(await list(""), { status: "disabled" });
  } finally {
    if (configured === undefined) delete process.env.QUOTE_ARCHIVE_DIR;
    else process.env.QUOTE_ARCHIVE_DIR = configured;
  }

  assert.deepEqual(await snapshot(root), before, "꺼져 있는데 디스크를 건드렸다");
});

test("🔴 **이 건의 견적서 폴더는 빠진다** — 위 구역이 이미 그리고 있다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-078"));
  await makeFolder(root, YEAR_2024, folderName("2024-027"));

  // 이 수리 건에 `DSS 2026-078` 과 그 가지 번호가 등록되어 있다.
  const result = foundOrFail(await list(root, { excludeQuoteNumbers: ["DSS 2026-078-1", "DSS 2026-078"] }));

  assert.deepEqual(
    result.folders.map((folder) => folder.folderName),
    [folderName("2024-027")]
  );

  // 🔴 연도 폴더를 가리지 않는다 — 번호가 이 건의 것이면 어느 해 폴더에 있어도 「지난 것」이 아니다.
  const otherYear = await makeRoot();
  await makeFolder(otherYear, YEAR_2023, folderName("2026-078"));
  assert.deepEqual(foundOrFail(await list(otherYear, { excludeQuoteNumbers: ["DSS 2026-078"] })).folders, []);

  // 번호가 비어 있으면 아무것도 거르지 않는다(모든 폴더가 사라지지 않게).
  assert.equal(foundOrFail(await list(root, { excludeQuoteNumbers: ["", "   "] })).folders.length, 2);
});

test("폴더 안에서 **번호를 뽑고 파일을 센다** — 찌꺼기와 하위 폴더는 빼고", async () => {
  const root = await makeRoot();
  const folder = await makeFolder(root, YEAR_2024, folderName("2024-027"));
  await writeFile(path.join(folder, `DSS 2024-027 가나상사 MODEL-X1 수리 견적서.xlsx`), "x");
  await writeFile(path.join(folder, `DSS 2024-027 가나상사 MODEL-X1 수리 견적서 - 有印.pdf`), "x");
  await writeFile(path.join(folder, `DSS 2024-027-1 가나상사 MODEL-X1(OH포함).xls`), "x");
  await writeFile(path.join(folder, "단가기재 참고용.XLS"), "x");
  // 🔴 찌꺼기는 세지 않는다(실측: 파일 342 개 중 57 개).
  await writeFile(path.join(folder, "Thumbs.db"), "x");
  await writeFile(path.join(folder, "~$견적서.xlsx"), "x");
  // 하위 폴더는 파일이 아니다 — 안으로 내려가지도 않는다.
  await mkdir(path.join(folder, "사진"));
  await writeFile(path.join(folder, "사진", "DSS 2026-999 안쪽.xlsx"), "x");
  const before = await snapshot(root);

  const [found] = foundOrFail(await list(root)).folders;

  assert.deepEqual(found.quoteNumbers, ["2024-027", "2024-027-1"]);
  assert.equal(found.fileCount, 4);
  assert.equal(found.quoteNumbers.includes("2026-999"), false, "하위 폴더 안을 읽었다");
  assert.deepEqual(await snapshot(root), before);
});

test("번호가 없는 폴더 · 빈 폴더도 줄로 나온다 — 번호만 비어 있다", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-001"));

  const [found] = foundOrFail(await list(root)).folders;

  assert.deepEqual(found.quoteNumbers, []);
  assert.equal(found.fileCount, 0);
});

test("🔴 돌려주는 값에 **절대 경로가 한 글자도 없다** — 루트도, 이어 붙인 전체 경로도", async () => {
  const root = await makeRoot();
  const folder = await makeFolder(root, YEAR_2026, folderName("2026-001"));
  await writeFile(path.join(folder, "DSS 2026-001 가나상사 수리 견적서.xlsx"), "x");

  const result = foundOrFail(await list(root));
  const text = JSON.stringify(result);

  assert.equal(text.includes(root), false, text);
  assert.equal(text.includes(path.basename(root)), false, text);
  assert.equal(text.includes(os.tmpdir()), false, text);
  for (const found of result.folders) {
    assert.deepEqual(Object.keys(found).sort(), [
      "fileCount",
      "folderName",
      "quoteNumbers",
      "relativePath",
      "year",
      "yearFolderName",
    ]);
    // 경로는 **두 마디**다 — 루트가 앞에 붙지 않는다.
    assert.equal(found.relativePath.split("/").length, 2, found.relativePath);
  }
  assert.deepEqual(Object.keys(result).sort(), ["folders", "status", "truncated"]);
});

test("연도 폴더가 아닌 폴더는 보지 않는다", async () => {
  const root = await makeRoot();
  // 연도 폴더 모양이 아닌 자리에 같은 장비의 폴더가 있어도 훑지 않는다.
  await makeFolder(root, "작업중", folderName("2026-001"));
  await makeFolder(root, "12026 내자견적서", folderName("2026-002"));
  // 앞 번호가 달라도 연도 폴더다(`20. 2026` 도 2026).
  await makeFolder(root, "20. 2026 내자견적서", folderName("2026-003"));

  const result = foundOrFail(await list(root));

  assert.deepEqual(
    result.folders.map((folder) => folder.folderName),
    [folderName("2026-003")]
  );
});

test("🔴 폴더 수 상한 — 넘으면 앞의 N 개만 주고 「더 있습니다」를 함께 나른다", async () => {
  const root = await makeRoot();
  for (const number of ["2026-001", "2026-002", "2026-003"]) {
    await makeFolder(root, YEAR_2026, folderName(number));
  }

  const result = foundOrFail(await list(root, { limit: 2 }));

  assert.deepEqual(
    result.folders.map((folder) => folder.folderName),
    [folderName("2026-001"), folderName("2026-002")]
  );
  assert.equal(result.truncated, true);

  const all = foundOrFail(await list(root, { limit: 3 }));
  assert.equal(all.folders.length, 3);
  assert.equal(all.truncated, false);

  // 기본 상한은 20 이다 — 왜 그 숫자인지는 모듈 머리말에 적었다(실측 최대 4 개).
  assert.equal(QUOTE_ARCHIVE_PRODUCT_FOLDERS_LIMIT, 20);
});

test("🔴 기다리기 상한 — 공유폴더가 답하지 않으면 그만두고, 공유폴더는 그대로다", async () => {
  // 실측 851ms(연도 폴더 21 개)보다 넉넉히 잡되 요청 워커가 매달리지 않을 만큼이다.
  assert.equal(QUOTE_ARCHIVE_PRODUCT_FOLDERS_TIMEOUT_MS, 5000);
  // 사유에 경로가 없다.
  assert.ok(!/[\\/]/.test(QUOTE_ARCHIVE_PRODUCT_FOLDERS_SLOW_REASON), QUOTE_ARCHIVE_PRODUCT_FOLDERS_SLOW_REASON);

  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, folderName("2026-001"));
  const before = await snapshot(root);

  // 상한을 0 으로 두면 기다리기가 바로 끝난다. 디스크가 먼저 끝날 수도 있으므로 둘 중 어느
  // 쪽이 나와도 **공유폴더가 그대로인 것**만은 반드시 참이어야 한다.
  const result = await list(root, { timeoutMs: 0 });

  assert.ok(result.status === "failed" || result.status === "found", result.status);
  if (result.status === "failed") {
    assert.equal(result.reason, QUOTE_ARCHIVE_PRODUCT_FOLDERS_SLOW_REASON);
  }
  assert.deepEqual(await snapshot(root), before);
});

test("루트가 없으면 루트를 만들지 않고 `failed` — 사유에 경로가 없다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  const result = await list(missingRoot);

  assert.equal(result.status, "failed", JSON.stringify(result));
  if (result.status !== "failed") throw new Error("unreachable");
  assert.ok(!result.reason.includes(missingRoot), result.reason);
  assert.ok(!result.reason.includes(os.tmpdir()), result.reason);
  assert.ok(!/[\\/]/.test(result.reason), result.reason);
  assert.deepEqual(await readdir(parent), [], "루트가 생겼다");
});

test("사람이 적은 이름의 흔들림 — 대소문자 · 공백 두 칸 · 밑줄로 이은 이름", async () => {
  const root = await makeRoot();
  await makeFolder(root, YEAR_2026, `DSS 2026-001 가나상사 MODEL-X1  ${LOT.toLowerCase()}  ${SERIAL} 전원 불량`);
  // 밑줄로 이은 이름이 사내에 실제로 있다.
  await makeFolder(root, YEAR_2024, `DSS 2024-027 가나상사 MODEL-X1_${LOT}_${SERIAL} 전원 불량`);

  const result = foundOrFail(await list(root));

  assert.equal(result.folders.length, 2, JSON.stringify(result.folders));
});
