import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { resolveQuoteArchiveRoot } from "../../storage/quote-archive";
import { quoteArchiveProductKey } from "../../storage/quote-archive-case-numbers";
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
 * 🔴 같은 날 셋째 규칙이 들어왔다 — **견적발행일이 적혀 있을 때만** 공유폴더를 본다.
 * 번호가 비어도 발행일이 비어 있으면 그 장비는 **훑는 목록에 들어가지 않고**, 그 건의 번호
 * 칸은 빈 채로 남는다. 아래 「발행일」 묶음이 그것을 **값으로** 본다 — 디스크에 폴더가 있는
 * 장비 둘을 놓고, 발행일이 있는 쪽의 번호만 결과에 들어오는지로 가른다(결과가 비는 것만
 * 보면 「열쇠를 못 만들어서 빈 것」과 구별되지 않는다).
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
/** 🔴 **둘째 장비** — 발행일 하나만 다를 때 훑는 목록이 갈리는지 보려고 둔다. */
const LOT_B = "CD5678";
const SERIAL_B = "7654321";
const YEAR_2023 = "18. 2023 내자견적서";
const YEAR_2026 = "21. 2026 내자견적서";

/** 폴더 · 파일 이름 모양 — `DSS <번호> <고객사> <모델> <L/N> <S/N> <신고증상>`. */
function archiveName(quoteNumber: string, lot = LOT, serial = SERIAL): string {
  return `DSS ${quoteNumber} 가나상사 MODEL-X1 ${lot} ${serial} 전원 불량`;
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
  for (const [yearFolder, quoteNumber, fileNumbers, lot, serial] of [
    [YEAR_2023, "2023-001", ["2023-001"], LOT, SERIAL],
    [YEAR_2026, "2026-100", ["2026-100"], LOT, SERIAL],
    // 🔴 원본 · 개정본 · 가지 번호가 한 폴더에 있다(실측 모양).
    [YEAR_2026, "2026-104", ["2026-104", "2026-104R1", "2026-104-1"], LOT, SERIAL],
    // 🔴 둘째 장비도 **디스크에 폴더가 있다** — 그래야 「안 읽혔다」가 「없어서 빈 것」과
    //    구별된다.
    [YEAR_2026, "2026-200", ["2026-200"], LOT_B, SERIAL_B],
  ] as const) {
    const folder = path.join(root, yearFolder, archiveName(quoteNumber, lot, serial));
    await mkdir(folder, { recursive: true });
    for (const fileNumber of fileNumbers) {
      await writeFile(
        path.join(folder, `${archiveName(fileNumber, lot, serial)}.xls`),
        "시험용 빈 파일"
      );
    }
  }
});

after(async () => {
  if (configured === undefined) delete process.env.QUOTE_ARCHIVE_DIR;
  else process.env.QUOTE_ARCHIVE_DIR = configured;
  if (root !== "") await rm(root, { recursive: true, force: true });
});

const CASE = { id: "case-1", lotNumber: LOT, serialNumber: SERIAL };
/** 둘째 장비의 건. 🔴 이 장비도 디스크에 폴더가 있다 — `DSS 2026-200`. */
const CASE_B = { id: "case-2", lotNumber: LOT_B, serialNumber: SERIAL_B };

/**
 * 견적발행일이 적혀 있는 평범한 줄. 🔴 **날짜 값 자체는 아무 뜻이 없다** — 「적혀 있는가」
 * 하나만 본다(비교도, 차례도 여기서는 하지 않는다).
 */
const ISSUED = "2026-10-01";

/**
 * 내자 정리가 내는 값 한 벌 — 🔴 번호와 발행일이 **같은 줄**에서 온다
 * (queries/domestic-orders.ts 의 RepairCaseQuoteInfo).
 */
function quoteInfoOf(
  ...rows: [id: string, quoteNumber: string | null, quoteIssuedDate: string | null][]
): Map<string, { quoteNumber: string | null; quoteIssuedDate: string | null }> {
  return new Map(
    rows.map(
      ([id, quoteNumber, quoteIssuedDate]): [
        string,
        { quoteNumber: string | null; quoteIssuedDate: string | null },
      ] => [id, { quoteNumber, quoteIssuedDate }]
    )
  );
}

/** 결과 표의 열쇠 — 🔴 **읽는 쪽과 같은 함수로** 만든다(손으로 이으면 다듬기 규칙이 갈린다). */
function productKey(lotNumber: string | null, serialNumber: string | null): string {
  const key = quoteArchiveProductKey(lotNumber, serialNumber);
  if (key === null) throw new Error("시험 장비의 열쇠가 만들어지지 않았다");
  return key;
}

test("내자 정리에 번호가 **없으면** 공유폴더 — 최신 폴더 하나 · 개정본이 원본을 가린다", async () => {
  const quoteInfo = quoteInfoOf([CASE.id, null, ISSUED]);
  const archive = await listArchiveQuoteNumbers([CASE], quoteInfo);

  const numbers = repairCaseQuoteNumbers(quoteInfo.get(CASE.id), archive, CASE.lotNumber, CASE.serialNumber);
  // `2023-001` · `2026-100` 폴더는 열리지 않았고(최신이 아니다), `2026-104` 원본은 가려졌다.
  assert.deepEqual(numbers, ["DSS 2026-104-1", "DSS 2026-104R1"]);
  assert.equal(joinQuoteNumbers(numbers), "DSS 2026-104-1\nDSS 2026-104R1");
});

// ── 🔴 견적발행일이 적혀 있을 때만 공유폴더를 본다 (사용자 요구 2026-10-12) ──

test("🔴 발행일이 **비어 있으면** 훑는 목록에 그 장비가 **안 들어간다** (2026-10-12)", async () => {
  // 🔴 두 장비 다 디스크에 폴더가 있고, 둘 다 내자 번호가 비었다. **다른 것은 발행일뿐이다.**
  const quoteInfo = quoteInfoOf([CASE.id, null, ISSUED], [CASE_B.id, null, null]);
  const archive = await listArchiveQuoteNumbers([CASE, CASE_B], quoteInfo);

  const keyA = productKey(CASE.lotNumber, CASE.serialNumber);
  const keyB = productKey(CASE_B.lotNumber, CASE_B.serialNumber);

  // 🔴 **값으로** 가른다 — 결과 표에 들어온 장비가 발행일이 있는 쪽 하나뿐이다.
  assert.deepEqual([...archive.keys()], [keyA]);
  assert.deepEqual(archive.get(keyA), ["DSS 2026-104-1", "DSS 2026-104R1"]);
  assert.equal(archive.has(keyB), false, "발행일이 빈 장비까지 공유폴더를 읽었다");

  // 그 건의 번호 칸은 **빈 채로** 남는다(사용자 요구).
  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(CASE_B.id), archive, CASE_B.lotNumber, CASE_B.serialNumber),
    []
  );
});

/**
 * 🔴 **같은 장비의 건이 둘일 때** — 2026-10-12 실측으로 잡은 샘을 굳힌다.
 *
 * `archiveNumbers` 의 열쇠는 건이 아니라 **장비**(L/N + S/N)다. 그래서 훑는 목록에서 뺀 건도
 * **옆 건이 읽어 온 번호를 그 열쇠로 꺼내 갈 수** 있었다 — 막기 전 실측에서 둘 다
 * `DSS 2026-300` 이 나왔다. 줄마다 같은 판정(readsArchive)을 한 번 더 지나 막는다.
 *
 * 🔴 **훑기는 그대로 한 번**이다 — 발행일이 있는 쪽이 있으니 그 장비는 여전히 읽힌다.
 * 막은 것은 「읽어 온 번호를 **누가 보는가**」뿐이다(아래 첫 단언이 그것을 함께 본다).
 */
test("🔴 같은 L/N·S/N 건이 둘, 한쪽만 발행일 — **없는 쪽은 빈다** (2026-10-12)", async () => {
  // 🔴 L/N · S/N 이 **같다**. 같은 실물 장비의 건이 둘 다 진행 중인 모양이다.
  const twinA = { id: "twin-a", lotNumber: LOT, serialNumber: SERIAL };
  const twinB = { id: "twin-b", lotNumber: LOT, serialNumber: SERIAL };
  const quoteInfo = quoteInfoOf([twinA.id, null, ISSUED], [twinB.id, null, null]);

  const archive = await listArchiveQuoteNumbers([twinA, twinB], quoteInfo);
  // 발행일이 있는 쪽 때문에 그 **장비**는 읽힌다 — 열쇠가 하나뿐이라 표에는 한 줄이다.
  assert.deepEqual([...archive.keys()], [productKey(LOT, SERIAL)]);

  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(twinA.id), archive, twinA.lotNumber, twinA.serialNumber),
    ["DSS 2026-104-1", "DSS 2026-104R1"],
    "발행일이 있는 건의 번호가 사라졌다"
  );
  // 🔴 막기 전에는 여기에 옆 건의 번호가 그대로 들어왔다.
  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(twinB.id), archive, twinB.lotNumber, twinB.serialNumber),
    [],
    "발행일 없는 건이 옆 건의 번호를 열쇠로 꺼내 갔다"
  );
});

test("🔴 발행일만 채우면 **같은 장비**가 들어온다 — 디스크에 없어서 빈 것이 아니다", async () => {
  const quoteInfo = quoteInfoOf([CASE_B.id, null, ISSUED]);
  const archive = await listArchiveQuoteNumbers([CASE_B], quoteInfo);

  assert.deepEqual([...archive.keys()], [productKey(CASE_B.lotNumber, CASE_B.serialNumber)]);
  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(CASE_B.id), archive, CASE_B.lotNumber, CASE_B.serialNumber),
    ["DSS 2026-200"]
  );
});

test("🔴 내자 줄이 **아예 없는** 건도 보지 않는다 — 그 건은 표에 자리가 없다", async () => {
  // listQuoteInfoForRepairCases 는 내자 줄이 없거나 완료된 줄뿐이면 그 건을 넣지 않는다.
  const quoteInfo = quoteInfoOf();
  const archive = await listArchiveQuoteNumbers([CASE], quoteInfo);
  assert.equal(archive.size, 0, "발행일을 알 수 없는 건까지 공유폴더를 읽었다");
  // 표에 자리가 없는 건(undefined)도 번호 칸이 빈다 — 줄마다의 판정이 그것까지 받는다.
  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(CASE.id), archive, CASE.lotNumber, CASE.serialNumber),
    []
  );
});

test("🔴 번호가 적혀 있으면 발행일이 비어도 **그 번호가 그대로** 보인다 (2026-10-07)", async () => {
  // 🔴 발행일 조건이 여기까지 번지면 사람이 적어 둔 값이 사라진다.
  const ordered = "DSS 2026-077";
  const quoteInfo = quoteInfoOf([CASE.id, ordered, null]);

  const archive = await listArchiveQuoteNumbers([CASE], quoteInfo);
  assert.equal(archive.size, 0, "번호가 이미 있는 건까지 공유폴더를 읽었다");

  // 🔴 줄마다 다시 묻게 됐어도(2026-10-12) 적어 둔 번호가 **먼저**다 — 차례가 규칙이다.
  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(CASE.id), archive, CASE.lotNumber, CASE.serialNumber),
    [ordered]
  );
});

test("🔴 같은 L/N·S/N 이라도 **번호가 적힌 건**은 옆 건의 공유폴더 번호에 안 밀린다", async () => {
  // 옆 건(발행일 있음)이 그 장비를 읽어 와 표에 번호가 들어 있는 상태다.
  const twinA = { id: "twin-c", lotNumber: LOT, serialNumber: SERIAL };
  const twinB = { id: "twin-d", lotNumber: LOT, serialNumber: SERIAL };
  const ordered = "DSS 2026-077"; // 🔴 일부러 공유폴더에 **없는** 번호다.
  const quoteInfo = quoteInfoOf([twinA.id, null, ISSUED], [twinB.id, ordered, null]);

  const archive = await listArchiveQuoteNumbers([twinA, twinB], quoteInfo);
  assert.deepEqual(archive.get(productKey(LOT, SERIAL)), ["DSS 2026-104-1", "DSS 2026-104R1"]);

  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(twinB.id), archive, twinB.lotNumber, twinB.serialNumber),
    [ordered],
    "사람이 적어 둔 번호가 공유폴더 번호에 밀렸다"
  );
});

test("🔴 두 화면이 **같은 값**을 본다 — 고객 안내 현황과 주간보고가 같은 함수를 지난다", async () => {
  // 🔴 내자 정리 조회가 내는 모양 **그대로**다 — 주간보고가 쓰지 않는 칸까지 실려 있다.
  const quoteInfo = new Map([
    [CASE.id, { repairCaseId: CASE.id, quoteNumber: null, quoteIssuedDate: ISSUED, orderIssuedDate: "2026-10-05" }],
    [CASE_B.id, { repairCaseId: CASE_B.id, quoteNumber: null, quoteIssuedDate: null, orderIssuedDate: null }],
  ]);

  // 고객 안내 현황은 수리 건 목록을, 주간보고는 칸이 더 많은 줄을 넘긴다.
  const portalCases = [CASE, CASE_B];
  const weeklyRows = [
    { ...CASE, intakeNumber: "D260001", modelName: "MODEL-X1" },
    { ...CASE_B, intakeNumber: "D260002", modelName: "MODEL-X1" },
  ];

  const portalArchive = await listArchiveQuoteNumbers(portalCases, quoteInfo);
  const weeklyArchive = await listArchiveQuoteNumbers(weeklyRows, quoteInfo);

  assert.deepEqual([...portalArchive.keys()], [...weeklyArchive.keys()]);
  for (const row of portalCases) {
    // 🔴 두 화면 다 **값 하나를 통째로** 넘긴다 — 꺼내 쓰는 모양까지 같다.
    const info = quoteInfo.get(row.id);
    assert.deepEqual(
      repairCaseQuoteNumbers(info, portalArchive, row.lotNumber, row.serialNumber),
      repairCaseQuoteNumbers(info, weeklyArchive, row.lotNumber, row.serialNumber),
      row.id
    );
  }

  // 발행일이 있는 쪽만 번호가 보인다 — 두 화면 다.
  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(CASE.id), portalArchive, CASE.lotNumber, CASE.serialNumber),
    ["DSS 2026-104-1", "DSS 2026-104R1"]
  );
  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(CASE_B.id), weeklyArchive, CASE_B.lotNumber, CASE_B.serialNumber),
    []
  );
});

test("🔴 내자 정리 값은 **추려지지 않는다** — 원본 번호도, 지난 해 번호도 그대로 나간다", async () => {
  // 공유폴더였다면 `2026-104` 는 개정본에 가려지고 `2023-001` 은 최신이 아니라 안 읽힌다.
  for (const ordered of ["DSS 2026-104", "DSS 2023-001"]) {
    const quoteInfo = quoteInfoOf([CASE.id, ordered, ISSUED]);
    const archive = await listArchiveQuoteNumbers([CASE], quoteInfo);
    assert.equal(archive.size, 0, ordered);
    assert.deepEqual(
      repairCaseQuoteNumbers(quoteInfo.get(CASE.id), archive, CASE.lotNumber, CASE.serialNumber),
      [ordered]
    );
  }
});

test("공백만 적힌 칸은 **없는 것**이다 — 번호도 발행일도 같은 잣대다", async () => {
  // 번호가 공백뿐이면 「없다」 — 발행일이 있으니 공유폴더를 본다.
  const blankNumber = quoteInfoOf([CASE.id, "   ", ISSUED]);
  assert.deepEqual(
    repairCaseQuoteNumbers(
      blankNumber.get(CASE.id),
      await listArchiveQuoteNumbers([CASE], blankNumber),
      CASE.lotNumber,
      CASE.serialNumber
    ),
    ["DSS 2026-104-1", "DSS 2026-104R1"]
  );

  // 🔴 발행일이 공백뿐이면 그것도 「없다」 — 그러면 공유폴더를 보지 않는다.
  const blankDate = quoteInfoOf([CASE.id, null, "   "]);
  const archive = await listArchiveQuoteNumbers([CASE], blankDate);
  assert.equal(archive.size, 0, "공백만 적힌 발행일을 적혀 있는 것으로 봤다");
  assert.deepEqual(
    repairCaseQuoteNumbers(blankDate.get(CASE.id), archive, CASE.lotNumber, CASE.serialNumber),
    []
  );
});

test("L/N 이나 S/N 이 비면 빈 목록이다 — 공유폴더를 보는 목록에 들어가지도 않는다", async () => {
  // 🔴 `-` 는 빈 값이다(수리 건 조회가 빈 칸을 그렇게 채워 내려보낸다).
  // 🔴 발행일은 **적혀 있다** — 그래야 빈 까닭이 열쇠 쪽이라는 것이 드러난다.
  const blank = { id: "case-3", lotNumber: "-", serialNumber: null };
  const quoteInfo = quoteInfoOf([blank.id, null, ISSUED]);
  const archive = await listArchiveQuoteNumbers([blank], quoteInfo);

  assert.equal(archive.size, 0);
  assert.deepEqual(
    repairCaseQuoteNumbers(quoteInfo.get(blank.id), archive, blank.lotNumber, blank.serialNumber),
    []
  );
  assert.equal(joinQuoteNumbers([]), null);
});
