import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { toKstDateOnly } from "@/lib/domain/date-only";
import { quoteNumbersFromArchiveFileNames } from "@/lib/domain/quote-archive-file-number";
import { quoteArchiveYearFolderName } from "@/lib/domain/quote-archive-naming";
import { resolveQuoteArchiveRoot } from "./quote-archive";
import {
  QUOTE_NUMBER_SUGGESTION_SLOW_REASON,
  QUOTE_NUMBER_SUGGESTION_TIMEOUT_MS,
  suggestNextQuoteNumber,
  type QuoteNumberSuggestionResult,
} from "./quote-number-suggestion";

/*
 * ============================================================================
 * 다음 견적서 번호 **제안** (2026-10-06)
 * ============================================================================
 * 🔴 **제안이지 채번이 아니다.** 번호 칸은 여전히 사람이 손으로 적는 자유 텍스트이고,
 * 여기서 보는 것은 「그 칸에 미리 적어 둘 값이 무엇인가」뿐이다.
 *
 * 🔴 **모든 시험이 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지 않는다.**
 * 그것을 보장하는 길이 둘이다(이웃 quote-archive-product-folders.test.ts 와 **같은 방법**):
 *   1. 디스크를 보는 시험은 전부 `root` 에 **임시 폴더를 직접 넘긴다.** 그 값이 있으면
 *      suggestNextQuoteNumber 는 설정(QUOTE_ARCHIVE_DIR)을 **아예 읽지 않는다.**
 *   2. 설정을 읽는 길을 보는 시험(아래 `disabled`)은 그 환경변수를 **지우고** 부르고,
 *      부르기 전에 `resolveQuoteArchiveRoot() === null` 임을 먼저 확인한 뒤 되돌린다.
 * 끝나면 만든 임시 폴더를 통째로 지운다.
 *
 * 🔴 **고객사명 · 모델 · L/N · S/N 은 전부 가짜다**(저장소가 공개다) — 모양만 실제와 같다.
 *
 * 🔴 이 모듈은 **읽기만** 한다. 그래서 시험들이 「무엇도 만들거나 지우지 않았다」를 함께
 * 본다(snapshot). 원본에 쓰기 · 지우기 낱말이 한 글자도 없다는 것은 이웃
 * quote-number-suggestion-source.test.ts 가 글자로 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quote-number-suggestion-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const YEAR_2026 = quoteArchiveYearFolderName(2026);
const YEAR_2025 = quoteArchiveYearFolderName(2025);

/** 폴더 이름 모양 — `DSS <번호> <고객사> <모델> <L/N> <S/N> <신고증상>`. 🔴 전부 가짜다. */
function folderName(quoteNumber: string): string {
  return `DSS ${quoteNumber} 가나상사 MODEL-X1 AB1234 1234567 전원 불량`;
}

/** 연도 폴더 아래에 견적서 폴더들을 만든다 — 시험 준비지, 앱이 하는 일이 아니다. */
async function makeFolders(root: string, yearFolder: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await mkdir(path.join(root, yearFolder, name), { recursive: true });
  }
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

function readyOrFail(result: QuoteNumberSuggestionResult) {
  assert.equal(result.status, "ready", JSON.stringify(result));
  if (result.status !== "ready") throw new Error("unreachable");
  return result;
}

/** 번호를 세 자리로 — `1` → `DSS 2026-001`. */
function numbered(sequence: number, year = 2026): string {
  return `${year}-${String(sequence).padStart(3, "0")}`;
}

test("🔴 실측 그대로 — 1~95 가 **연속**이면 096 을 제안한다", async () => {
  const root = await makeRoot();
  // 실측(2026-10-06): 2026 연도 폴더에 견적서 폴더 106 개 · 본 번호 1~95 · 빠진 번호 0 개 ·
  // 개정 접미가 붙은 것 11 개. 그 모양을 그대로 만든다.
  const names: string[] = [];
  for (let sequence = 1; sequence <= 95; sequence += 1) names.push(folderName(numbered(sequence)));
  for (let sequence = 1; sequence <= 11; sequence += 1) names.push(folderName(`${numbered(sequence)}R1`));
  await makeFolders(root, YEAR_2026, names);
  const before = await snapshot(root);

  const result = readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 }));

  assert.equal(result.quoteNumber, "DSS 2026-096");
  assert.equal(result.sequence, 96);
  assert.equal(result.year, 2026);
  assert.equal(result.folderCount, 106);
  assert.equal(result.numberedFolderCount, 106, "이름에서 번호를 못 읽은 폴더가 있다");
  assert.equal(result.highestFolderSequence, 95);
  assert.equal(result.highestKnownSequence, null);
  assert.deepEqual(await snapshot(root), before, "읽기가 무엇인가를 만들거나 지웠다");
});

test("🔴 중간에 번호가 비어도 **가장 큰 것 + 1** 이다 — 빈 자리를 메우지 않는다", async () => {
  const root = await makeRoot();
  // 3 · 4 · 6~40 이 비어 있다 — 취소된 견적서의 자리일 수 있다. 그 자리를 채우지 않는다.
  await makeFolders(root, YEAR_2026, [
    folderName(numbered(1)),
    folderName(numbered(2)),
    folderName(numbered(5)),
    folderName(numbered(41)),
  ]);

  const result = readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 }));

  assert.equal(result.quoteNumber, "DSS 2026-042");
  assert.equal(result.highestFolderSequence, 41);
});

test("🔴 개정 접미(R1) · 가지 번호(-1)는 **본 번호**로 센다", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [folderName("2026-004R1")]);

  // `2026-004R1` 은 004 의 개정본이지 005 가 아니다 — 다음은 005 다.
  assert.equal(readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 })).quoteNumber, "DSS 2026-005");

  const branched = await makeRoot();
  await makeFolders(branched, YEAR_2026, [folderName("2026-004-1")]);
  assert.equal(
    readyOrFail(await suggestNextQuoteNumber({ root: branched, year: 2026 })).quoteNumber,
    "DSS 2026-005"
  );

  // 개정본이 본 번호보다 커 보이게 적혀 있어도(R12) 본 번호는 그대로 004 다.
  const revised = await makeRoot();
  await makeFolders(revised, YEAR_2026, [folderName("2026-004R12")]);
  assert.equal(
    readyOrFail(await suggestNextQuoteNumber({ root: revised, year: 2026 })).quoteNumber,
    "DSS 2026-005"
  );
});

test("🔴 그 해 폴더가 없거나 번호가 하나도 없으면 **001** — 그 해 첫 장이다", async () => {
  // 연도 폴더 자체가 없다(해가 바뀐 1 월).
  const empty = await makeRoot();
  const first = readyOrFail(await suggestNextQuoteNumber({ root: empty, year: 2026 }));
  assert.equal(first.quoteNumber, "DSS 2026-001");
  assert.equal(first.folderCount, 0);
  assert.equal(first.numberedFolderCount, 0);
  assert.equal(first.highestFolderSequence, null);
  assert.deepEqual(await readdir(empty), [], "없는 연도 폴더를 만들었다");

  // 연도 폴더는 있는데 번호가 든 폴더가 없다(사람이 참고 자료만 넣어 두었다).
  const noNumbers = await makeRoot();
  await makeFolders(noNumbers, YEAR_2026, ["참고 자료", "작업중"]);
  const still = readyOrFail(await suggestNextQuoteNumber({ root: noNumbers, year: 2026 }));
  assert.equal(still.quoteNumber, "DSS 2026-001");
  assert.equal(still.folderCount, 2);
  assert.equal(still.numberedFolderCount, 0);
});

test("🔴 번호를 못 읽는 폴더는 **조용히 건너뛴다** — 실패가 아니다", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [
    folderName(numbered(7)),
    // 번호 뒤에 공백 대신 `-` 를 찍은 오타 — 실측에 있었다. 🔴 여기서 2026-046 을 뽑으면
    // 사람이 적지 않은 번호를 우리가 지어내는 셈이다.
    "DSS 2026-046- 가나상사 MODEL-X1 전원 불량",
    // 머리가 번호가 아닌 폴더 · 번호가 아예 없는 폴더.
    "RFK300FH-AD1_WN3769_1802083 검사보고서",
    "단가기재 참고용",
    // 다른 해의 번호가 섞여 들어와 있다(실측에 그런 폴더가 있었다) — 2026 의 번호가 아니다.
    folderName("2023-918"),
  ]);
  const before = await snapshot(root);

  const result = readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 }));

  assert.equal(result.quoteNumber, "DSS 2026-008");
  assert.equal(result.folderCount, 5);
  assert.equal(result.numberedFolderCount, 1, "건너뛸 폴더를 셌다");
  assert.deepEqual(await snapshot(root), before);
});

test("🔴 `DSS` 뒤가 하이픈인 것도 읽는다 — 번호가 자유 입력이라 실제로 들어왔다", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, ["DSS-2026-099 가나상사 MODEL-X1 AB1234 1234567 전원 불량"]);

  assert.equal(readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 })).quoteNumber, "DSS 2026-100");

  // 대소문자도 접어 본다(`dss` 로 적은 폴더가 섞여 있어도 같은 번호로 센다).
  const lower = await makeRoot();
  await makeFolders(lower, YEAR_2026, ["dss 2026-101 가나상사 전원 불량"]);
  assert.equal(readyOrFail(await suggestNextQuoteNumber({ root: lower, year: 2026 })).quoteNumber, "DSS 2026-102");
});

test("🔴 루트 설정이 없으면 `disabled` — 디스크를 한 번도 보지 않는다", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [folderName(numbered(1))]);
  const before = await snapshot(root);

  const configured = process.env.QUOTE_ARCHIVE_DIR;
  delete process.env.QUOTE_ARCHIVE_DIR;
  try {
    // 🔴 설정이 정말 비었는지 **먼저 확인한다** — 실제 공유폴더를 읽는 일이 없게.
    assert.equal(resolveQuoteArchiveRoot(), null);
    assert.deepEqual(await suggestNextQuoteNumber(), { status: "disabled" });
    assert.deepEqual(await suggestNextQuoteNumber({ root: undefined }), { status: "disabled" });
    assert.deepEqual(await suggestNextQuoteNumber({ root: null }), { status: "disabled" });
    // 공백뿐인 값도 꺼진 것이다(기능이 꺼져 있다 — 실패가 아니다).
    assert.deepEqual(await suggestNextQuoteNumber({ root: "   " }), { status: "disabled" });
    assert.deepEqual(await suggestNextQuoteNumber({ root: "" }), { status: "disabled" });
    // 🔴 넘겨받은 번호가 있어도 꺼진 것은 꺼진 것이다 — 반쪽 근거로 제안하지 않는다.
    assert.deepEqual(
      await suggestNextQuoteNumber({ root: null, knownQuoteNumbers: ["DSS 2026-300"] }),
      { status: "disabled" }
    );
  } finally {
    if (configured === undefined) delete process.env.QUOTE_ARCHIVE_DIR;
    else process.env.QUOTE_ARCHIVE_DIR = configured;
  }

  assert.deepEqual(await snapshot(root), before, "꺼져 있는데 디스크를 건드렸다");
});

test("🔴 **그 해의 연도 폴더만** 읽는다 — 다른 해의 더 큰 번호를 보지 않는다", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [folderName(numbered(12))]);
  // 지난해 폴더에 더 큰 번호가 있다 — 번호는 해마다 다시 1 부터라 볼 까닭이 없다.
  await makeFolders(root, YEAR_2025, [folderName(numbered(200, 2025))]);

  const result = readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 }));

  assert.equal(result.quoteNumber, "DSS 2026-013");
  assert.equal(result.folderCount, 1, "다른 해 폴더까지 훑었다");

  // 2025 를 물으면 2025 의 폴더만 본다.
  assert.equal(readyOrFail(await suggestNextQuoteNumber({ root, year: 2025 })).quoteNumber, "DSS 2025-201");
});

test("🔴 **이미 쓰인 번호**(DB)가 더 크면 그쪽 다음이다 — 저장이 거절되지 않게", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [folderName(numbered(50))]);

  // 공유폴더에는 아직 없고 DB 에만 있는 번호. 🔴 폴더만 보면 051 을 제안해 저장이 거절된다.
  const result = readyOrFail(
    await suggestNextQuoteNumber({
      root,
      year: 2026,
      knownQuoteNumbers: ["DSS 2026-051", "DSS 2026-052-1", "DSS 2026-049"],
    })
  );

  assert.equal(result.quoteNumber, "DSS 2026-053");
  assert.equal(result.highestFolderSequence, 50);
  assert.equal(result.highestKnownSequence, 52, "가지 번호의 본 번호를 못 읽었다");

  // 공유폴더 쪽이 더 크면 그쪽이 이긴다.
  const folderWins = readyOrFail(
    await suggestNextQuoteNumber({ root, year: 2026, knownQuoteNumbers: ["DSS 2026-003"] })
  );
  assert.equal(folderWins.quoteNumber, "DSS 2026-051");

  // 🔴 다른 해의 번호 · 모양이 아닌 번호는 조용히 건너뛴다.
  const otherYears = readyOrFail(
    await suggestNextQuoteNumber({
      root,
      year: 2026,
      knownQuoteNumbers: ["DSS 2025-900", "Q-7", "", "   ", "견적서"],
    })
  );
  assert.equal(otherYears.quoteNumber, "DSS 2026-051");
  assert.equal(otherYears.highestKnownSequence, null);

  // 공유폴더가 비어 있고 DB 에만 번호가 있어도 그 다음이다.
  const emptyFolder = await makeRoot();
  assert.equal(
    readyOrFail(await suggestNextQuoteNumber({ root: emptyFolder, year: 2026, knownQuoteNumbers: ["DSS 2026-007"] }))
      .quoteNumber,
    "DSS 2026-008"
  );
});

test("🔴 번호로 **끝나는** 이름도 읽는다 — 파일 이름용 규칙과 어긋나는 **단 하나**다", async () => {
  // 파일 이름용 함수(domain/quote-archive-file-number.ts)는 번호 뒤에 공백이 와야 뽑는다.
  // 파일 이름은 늘 뒤에 무언가가 따라오지만, 폴더 이름과 DB 의 번호는 **번호로 끝날 수 있다.**
  assert.deepEqual(quoteNumbersFromArchiveFileNames(["DSS 2026-150"]), [], "파일 이름용 규칙이 바뀌었다");

  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, ["DSS 2026-150"]);
  assert.equal(readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 })).quoteNumber, "DSS 2026-151");

  // DB 의 번호도 번호 그 자체다.
  const empty = await makeRoot();
  assert.equal(
    readyOrFail(await suggestNextQuoteNumber({ root: empty, year: 2026, knownQuoteNumbers: ["DSS 2026-150"] }))
      .quoteNumber,
    "DSS 2026-151"
  );
});

test("🔴 그 하나 말고는 파일 이름용 규칙과 **같은 것을 읽는다** — 두 벌이 어긋나지 않게", async () => {
  // 🔴 두 규칙에 **같은 표본**을 넣어 같은 번호를 보는지 본다(모양 넷 + 못 읽어야 하는 둘).
  const samples = [
    "DSS 2026-001 가나상사 MODEL-X1 AB1234 1234567 전원 불량",
    "DSS 2026-007-1 가나상사 MODEL-X1 AB1234 1234567 전원 불량",
    "DSS 2026-004R1 가나상사 MODEL-X1 AB1234 1234567 전원 불량",
    "DSS-2026-099 가나상사 MODEL-X1 AB1234 1234567 전원 불량",
    "dss 2026-012 가나상사 MODEL-X1 AB1234 1234567 전원 불량",
    // 🔴 둘 다 못 읽어야 한다 — 번호 뒤 오타와, 머리가 번호가 아닌 이름.
    "DSS 2026-046- 가나상사 MODEL-X1 전원 불량",
    "RFK300FH-AD1_WN3769_1802083 검사보고서",
  ];

  // 파일 이름용 규칙이 본 가장 큰 본 번호 — `2026-099` 의 99.
  const byFileRule = quoteNumbersFromArchiveFileNames(samples);
  assert.deepEqual(byFileRule, ["2026-001", "2026-004R1", "2026-007-1", "2026-012", "2026-099"]);

  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, samples);

  const result = readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 }));

  assert.equal(result.highestFolderSequence, 99, "두 규칙이 서로 다른 번호를 본다");
  assert.equal(result.quoteNumber, "DSS 2026-100");
  assert.equal(result.numberedFolderCount, byFileRule.length, "두 규칙이 읽은 이름 수가 다르다");
});

test("🔴 **폴더 이름만** 본다 — 연도 폴더에 놓인 파일은 세지 않는다", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [folderName(numbered(3))]);
  // 사람이 연도 폴더에 바로 올려 둔 파일. 폴더가 아니므로 후보가 아니다.
  await writeFile(path.join(root, YEAR_2026, "DSS 2026-900 가나상사 수리 견적서.xlsx"), "x");
  const before = await snapshot(root);

  const result = readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 }));

  assert.equal(result.quoteNumber, "DSS 2026-004");
  assert.equal(result.folderCount, 1);
  assert.deepEqual(await snapshot(root), before);
});

test("맞는 연도 폴더가 둘이면 **양쪽을 다 읽는다** — 한쪽의 더 큰 번호를 놓치지 않게", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [folderName(numbered(4))]);
  // 앞 번호가 달라도 2026 의 연도 폴더다(`20. 2026` 도 2026).
  await makeFolders(root, "20. 2026 내자견적서", [folderName(numbered(77))]);
  // 연도 폴더 모양이 아닌 자리는 훑지 않는다.
  await makeFolders(root, "작업중", [folderName(numbered(900))]);
  await makeFolders(root, "12026 내자견적서", [folderName(numbered(901))]);

  const result = readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 }));

  assert.equal(result.quoteNumber, "DSS 2026-078");
  assert.equal(result.folderCount, 2, "연도 폴더가 아닌 자리까지 훑었다");
});

test("🔴 돌려주는 값에 **절대 경로가 한 글자도 없다**", async () => {
  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [folderName(numbered(9))]);

  const result = readyOrFail(await suggestNextQuoteNumber({ root, year: 2026 }));
  const text = JSON.stringify(result);

  assert.equal(text.includes(root), false, text);
  assert.equal(text.includes(path.basename(root)), false, text);
  assert.equal(text.includes(os.tmpdir()), false, text);
  assert.deepEqual(Object.keys(result).sort(), [
    "folderCount",
    "highestFolderSequence",
    "highestKnownSequence",
    "numberedFolderCount",
    "quoteNumber",
    "sequence",
    "status",
    "year",
  ]);
});

test("루트가 없으면 루트를 만들지 않고 `failed` — 사유에 경로가 없다", async () => {
  const parent = await makeRoot();
  const missingRoot = path.join(parent, "연결-안-된-공유폴더");

  const result = await suggestNextQuoteNumber({ root: missingRoot, year: 2026 });

  assert.equal(result.status, "failed", JSON.stringify(result));
  if (result.status !== "failed") throw new Error("unreachable");
  assert.ok(!result.reason.includes(missingRoot), result.reason);
  assert.ok(!result.reason.includes(os.tmpdir()), result.reason);
  assert.ok(!/[\\/]/.test(result.reason), result.reason);
  assert.deepEqual(await readdir(parent), [], "루트가 생겼다");
});

test("🔴 기다리기 상한 — 공유폴더가 답하지 않으면 그만두고, 공유폴더는 그대로다", async () => {
  // 읽는 것이 두 겹뿐이라(연도 폴더 고르기 · 그 안 읽기) 이웃(5000)보다 짧다 — 까닭은 모듈 머리말.
  assert.equal(QUOTE_NUMBER_SUGGESTION_TIMEOUT_MS, 2000);
  // 사유에 경로가 없다.
  assert.ok(!/[\\/]/.test(QUOTE_NUMBER_SUGGESTION_SLOW_REASON), QUOTE_NUMBER_SUGGESTION_SLOW_REASON);

  const root = await makeRoot();
  await makeFolders(root, YEAR_2026, [folderName(numbered(1))]);
  const before = await snapshot(root);

  // 상한을 0 으로 두면 기다리기가 바로 끝난다. 디스크가 먼저 끝날 수도 있으므로 둘 중 어느
  // 쪽이 나와도 **공유폴더가 그대로인 것**만은 반드시 참이어야 한다.
  const result = await suggestNextQuoteNumber({ root, year: 2026, timeoutMs: 0 });

  assert.ok(result.status === "failed" || result.status === "ready", result.status);
  if (result.status === "failed") {
    assert.equal(result.reason, QUOTE_NUMBER_SUGGESTION_SLOW_REASON);
  }
  assert.deepEqual(await snapshot(root), before);
});

test("연도를 주지 않으면 **한국 표준시 올해**다", async () => {
  const thisYear = Number(toKstDateOnly(new Date()).slice(0, 4));
  const root = await makeRoot();
  await makeFolders(root, quoteArchiveYearFolderName(thisYear), [
    `DSS ${thisYear}-030 가나상사 MODEL-X1 AB1234 1234567 전원 불량`,
  ]);

  const result = readyOrFail(await suggestNextQuoteNumber({ root }));

  assert.equal(result.year, thisYear);
  assert.equal(result.quoteNumber, `DSS ${thisYear}-031`);
});
