import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { resolveQuoteArchiveRoot } from "../../storage/quote-archive";
import {
  joinQuoteNumbers,
  listArchiveQuoteNumbers,
  repairCaseQuoteNumbers,
} from "./repair-case-quote-numbers";

/*
 * ============================================================================
 * 🔴 **내자 정리에 번호가 있으면 그것만** — 공유폴더 규칙이 거기까지 번지지 않는다
 * ============================================================================
 * 2026-10-12 에 공유폴더 쪽 규칙이 둘 들어왔다(최신 폴더 하나만 · 개정본이 원본을 가린다).
 * 🔴 **그 둘은 공유폴더에서 읽은 번호에만 걸린다.** 내자 정리에 사람이 적어 둔 번호는
 * 2026-10-07 결정대로 **그대로** 나가고, 그때는 공유폴더를 **보지도 않는다**.
 *
 * 이웃 repair-case-quote-numbers-source.test.ts 는 그 규칙이 **원본 글자로** 남아 있는지를
 * 본다. 여기는 **임시 폴더를 놓고 실제로 돌려** 두 갈래가 다른 값을 내는지를 본다 — 글자가
 * 맞아도 공유폴더 쪽 규칙이 내자 값에 섞여 들어가면 여기서 드러난다.
 *
 * 🔴 **임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지 않는다.** 이 모듈은 루트를
 * 인자로 받지 않으므로(요청 수명 캐시가 쥐고 있다) 설정(QUOTE_ARCHIVE_DIR)을 임시 폴더로
 * 바꿔 두고, 바꾼 값이 실제로 그 임시 폴더인지 `resolveQuoteArchiveRoot()` 로 **먼저
 * 확인한다.** 끝나면 설정을 되돌리고 만든 폴더를 통째로 지운다.
 *
 * 🔴 **고객사명 · 모델 · L/N · S/N 은 전부 가짜다**(저장소가 공개다) — 모양만 실제와 같다.
 * ============================================================================
 */

const LOT = "AB1234";
const SERIAL = "1234567";
const YEAR_2023 = "18. 2023 내자견적서";
const YEAR_2026 = "21. 2026 내자견적서";

/** 폴더 · 파일 이름 모양 — `DSS <번호> <고객사> <모델> <L/N> <S/N> <신고증상>`. */
function archiveName(quoteNumber: string): string {
  return `DSS ${quoteNumber} 가나상사 MODEL-X1 ${LOT} ${SERIAL} 전원 불량`;
}

let root = "";
let configured: string | undefined;

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "repair-case-quote-numbers-test-"));
  configured = process.env.QUOTE_ARCHIVE_DIR;
  process.env.QUOTE_ARCHIVE_DIR = root;
  // 🔴 설정이 정말 임시 폴더를 가리키는지 **먼저 확인한다** — 실제 공유폴더를 읽는 일이 없게.
  assert.equal(resolveQuoteArchiveRoot(), path.resolve(root));

  // 지난 해 폴더 · 올해 폴더 둘 — 최신은 `2026-104` 다.
  for (const [yearFolder, quoteNumber, fileNumbers] of [
    [YEAR_2023, "2023-001", ["2023-001"]],
    [YEAR_2026, "2026-100", ["2026-100"]],
    // 🔴 원본 · 개정본 · 가지 번호가 한 폴더에 있다(실측 모양).
    [YEAR_2026, "2026-104", ["2026-104", "2026-104R1", "2026-104-1"]],
  ] as const) {
    const folder = path.join(root, yearFolder, archiveName(quoteNumber));
    await mkdir(folder, { recursive: true });
    for (const fileNumber of fileNumbers) {
      await writeFile(path.join(folder, `${archiveName(fileNumber)}.xls`), "시험용 빈 파일");
    }
  }
});

after(async () => {
  if (configured === undefined) delete process.env.QUOTE_ARCHIVE_DIR;
  else process.env.QUOTE_ARCHIVE_DIR = configured;
  if (root !== "") await rm(root, { recursive: true, force: true });
});

const CASE = { id: "case-1", lotNumber: LOT, serialNumber: SERIAL };

test("내자 정리에 번호가 **없으면** 공유폴더 — 최신 폴더 하나 · 개정본이 원본을 가린다", async () => {
  const quoteInfo = new Map([[CASE.id, { quoteNumber: null }]]);
  const archive = await listArchiveQuoteNumbers([CASE], quoteInfo);

  const numbers = repairCaseQuoteNumbers(null, archive, CASE.lotNumber, CASE.serialNumber);
  // `2023-001` · `2026-100` 폴더는 열리지 않았고(최신이 아니다), `2026-104` 원본은 가려졌다.
  assert.deepEqual(numbers, ["DSS 2026-104-1", "DSS 2026-104R1"]);
  assert.equal(joinQuoteNumbers(numbers), "DSS 2026-104-1\nDSS 2026-104R1");
});

test("🔴 내자 정리에 번호가 **있으면 그것만** — 공유폴더를 보지도 않는다 (2026-10-07)", async () => {
  // 🔴 일부러 **공유폴더에 없는** 번호다. 공유폴더 값이 조금이라도 섞이면 여기서 드러난다.
  const ordered = "DSS 2026-077";
  const quoteInfo = new Map([[CASE.id, { quoteNumber: ordered }]]);

  const archive = await listArchiveQuoteNumbers([CASE], quoteInfo);
  assert.equal(archive.size, 0, "번호가 이미 있는 건까지 공유폴더를 읽었다");

  assert.deepEqual(repairCaseQuoteNumbers(ordered, archive, CASE.lotNumber, CASE.serialNumber), [ordered]);
});

test("🔴 내자 정리 값은 **추려지지 않는다** — 원본 번호도, 지난 해 번호도 그대로 나간다", async () => {
  // 공유폴더였다면 `2026-104` 는 개정본에 가려지고 `2023-001` 은 최신이 아니라 안 읽힌다.
  for (const ordered of ["DSS 2026-104", "DSS 2023-001"]) {
    const quoteInfo = new Map([[CASE.id, { quoteNumber: ordered }]]);
    const archive = await listArchiveQuoteNumbers([CASE], quoteInfo);
    assert.equal(archive.size, 0, ordered);
    assert.deepEqual(repairCaseQuoteNumbers(ordered, archive, CASE.lotNumber, CASE.serialNumber), [ordered]);
  }
});

test("공백만 적힌 칸은 **없는 것**이다 — 그때는 공유폴더를 본다", async () => {
  const quoteInfo = new Map([[CASE.id, { quoteNumber: "   " }]]);
  const archive = await listArchiveQuoteNumbers([CASE], quoteInfo);

  assert.deepEqual(repairCaseQuoteNumbers("   ", archive, CASE.lotNumber, CASE.serialNumber), [
    "DSS 2026-104-1",
    "DSS 2026-104R1",
  ]);
});

test("L/N 이나 S/N 이 비면 빈 목록이다 — 공유폴더를 보는 목록에 들어가지도 않는다", async () => {
  // 🔴 `-` 는 빈 값이다(수리 건 조회가 빈 칸을 그렇게 채워 내려보낸다).
  const blank = { id: "case-2", lotNumber: "-", serialNumber: null };
  const quoteInfo = new Map([[blank.id, { quoteNumber: null }]]);
  const archive = await listArchiveQuoteNumbers([blank], quoteInfo);

  assert.equal(archive.size, 0);
  assert.deepEqual(repairCaseQuoteNumbers(null, archive, blank.lotNumber, blank.serialNumber), []);
  assert.equal(joinQuoteNumbers([]), null);
});
