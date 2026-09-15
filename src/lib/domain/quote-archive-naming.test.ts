import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isQuoteArchiveYearFolder,
  matchesQuoteArchiveFolder,
  numberedQuoteArchiveName,
  QUOTE_ARCHIVE_MAX_STEM_LENGTH,
  quoteArchiveBaseNumber,
  quoteArchiveFileName,
  quoteArchiveFolderName,
  quoteArchiveSignedPdfFileName,
  quoteArchiveYearFolderName,
  quoteArchiveYearFromDate,
  sanitizeQuoteArchiveNamePiece,
  type QuoteArchiveNamingInput,
} from "./quote-archive-naming";

// 공급처 · 모델 이름은 가짜다(저장소가 공개다).
const DOMESTIC: QuoteArchiveNamingInput = {
  quoteNumber: "DSS 2026-089",
  kind: "DOMESTIC",
  customerName: "가나상사",
  modelName: "MODEL-X1",
  lotNumber: "L123",
  serialNumber: "S456",
};
const OVERHAUL_BRANCH: QuoteArchiveNamingInput = { ...DOMESTIC, quoteNumber: "DSS 2026-089-1", kind: "OVERHAUL" };

const STEM = "DSS 2026-089 가나상사 MODEL-X1 L123 S456 수리 견적서";
const BRANCH_STEM = "DSS 2026-089-1 가나상사 MODEL-X1 L123 S456 수리 견적서";

test("연도 폴더 이름 — 앞 번호는 연도 − 2005, 두 자리", () => {
  assert.equal(quoteArchiveYearFolderName(2026), "21. 2026 내자견적서");
  assert.equal(quoteArchiveYearFolderName(2027), "22. 2027 내자견적서");
  assert.equal(quoteArchiveYearFolderName(2006), "01. 2006 내자견적서");
  // 앞 번호가 0 이하가 되는 연도는 폴더를 정할 수 없다.
  assert.throws(() => quoteArchiveYearFolderName(2005));
  assert.throws(() => quoteArchiveYearFolderName(2026.5));
});

test("연도 폴더 찾기 — `YYYY 내자견적서` 로 끝나면 앞 번호가 달라도 그 연도", () => {
  assert.equal(isQuoteArchiveYearFolder("21. 2026 내자견적서", 2026), true);
  assert.equal(isQuoteArchiveYearFolder("20. 2026 내자견적서", 2026), true);
  assert.equal(isQuoteArchiveYearFolder("2026 내자견적서", 2026), true);
  // 사람이 적은 이름 — 공백이 여러 칸이거나 풀어쓴(NFD) 한글이어도 같은 폴더.
  assert.equal(isQuoteArchiveYearFolder("21.  2026   내자견적서 ", 2026), true);
  assert.equal(isQuoteArchiveYearFolder("21. 2026 내자견적서".normalize("NFD"), 2026), true);

  assert.equal(isQuoteArchiveYearFolder("2025 내자견적서", 2026), false);
  assert.equal(isQuoteArchiveYearFolder("20. 2025 내자견적서", 2026), false);
  // 연도 바로 앞이 숫자면 다른 연도다.
  assert.equal(isQuoteArchiveYearFolder("12026 내자견적서", 2026), false);
  assert.equal(isQuoteArchiveYearFolder("21. 2026 내자견적서 백업", 2026), false);
});

test("발행일자에서 연도 — 글자에서 바로 읽고, 달력에 없는 날은 거절", () => {
  assert.equal(quoteArchiveYearFromDate("2026-09-15"), 2026);
  assert.equal(quoteArchiveYearFromDate("2026-12-31"), 2026);
  assert.equal(quoteArchiveYearFromDate("2028-02-29"), 2028);
  assert.equal(quoteArchiveYearFromDate("2026-02-29"), null);
  assert.equal(quoteArchiveYearFromDate("2026-13-01"), null);
  assert.equal(quoteArchiveYearFromDate("26-09-15"), null);
  assert.equal(quoteArchiveYearFromDate(""), null);
  assert.equal(quoteArchiveYearFromDate("2005-12-31"), null);
});

test("본 번호 — 「연도 네 자리-일련번호」 뒤의 가지 번호만 한 겹 뗀다", () => {
  assert.equal(quoteArchiveBaseNumber("DSS 2026-089"), "DSS 2026-089");
  assert.equal(quoteArchiveBaseNumber("DSS 2026-089-1"), "DSS 2026-089");
  assert.equal(quoteArchiveBaseNumber("DSS 2026-089-12"), "DSS 2026-089");
  assert.equal(quoteArchiveBaseNumber("Q-7"), "Q-7");
  // 사람이 공백을 빠뜨린 번호도 같은 모양이다.
  assert.equal(quoteArchiveBaseNumber("DSS2026-089-1"), "DSS2026-089");
  // 「연도-일련번호」 모양은 떼지 않는다 — 떼면 `Q-2026` 이 되어 그해 견적서가 한 폴더로 모인다.
  assert.equal(quoteArchiveBaseNumber("Q-2026-0001"), "Q-2026-0001");
  assert.equal(quoteArchiveBaseNumber("QT-2024-115"), "QT-2024-115");
  assert.equal(quoteArchiveBaseNumber("DEMO-QT-2026-001"), "DEMO-QT-2026-001");
  // 숫자가 아닌 꼬리는 가지 번호가 아니다.
  assert.equal(quoteArchiveBaseNumber("DSS 2026-TEST"), "DSS 2026-TEST");
  assert.equal(quoteArchiveBaseNumber("  DSS 2026-089-1 "), "DSS 2026-089");
});

test("견적서 폴더 대조 — 본 번호로 시작하고 바로 뒤가 공백", () => {
  const folder = `${STEM}`;
  assert.equal(matchesQuoteArchiveFolder(folder, "DSS 2026-089"), true);
  // 가지 번호 견적서도 본 번호 폴더로 간다.
  assert.equal(matchesQuoteArchiveFolder(folder, "DSS 2026-089-1"), true);
  assert.equal(matchesQuoteArchiveFolder(folder, "DSS 2026-089-12"), true);

  // 번호가 이어지는 다른 견적서(0891)는 맞지 않는다.
  assert.equal(matchesQuoteArchiveFolder("DSS 2026-0891 가나상사 수리 견적서", "DSS 2026-089"), false);
  assert.equal(matchesQuoteArchiveFolder("DSS 2026-0891 가나상사 수리 견적서", "DSS 2026-089-1"), false);
  assert.equal(matchesQuoteArchiveFolder(folder, "DSS 2026-08"), false);
  assert.equal(matchesQuoteArchiveFolder(folder, "DSS 2026-090"), false);

  // 사람이 적은 공백 두 칸 — 비교할 때만 다듬는다.
  assert.equal(matchesQuoteArchiveFolder("DSS 2026-089  가나상사  수리 견적서", "DSS 2026-089"), true);
  assert.equal(matchesQuoteArchiveFolder("DSS  2026-089 가나상사 수리 견적서", "DSS 2026-089"), true);
  // 풀어쓴(NFD) 한글로 적힌 이름 — 번호에 한글이 들어간 경우까지.
  assert.equal(
    matchesQuoteArchiveFolder("견적 2026-089 가나상사 수리 견적서".normalize("NFD"), "견적 2026-089-1"),
    true
  );
  // 「연도-일련번호」 모양은 일련번호를 떼지 않는다 — 이웃 번호의 폴더와 섞이지 않는다.
  assert.equal(matchesQuoteArchiveFolder("Q-2026-0001 가나상사 수리 견적서", "Q-2026-0001"), true);
  assert.equal(matchesQuoteArchiveFolder("Q-2026-0001 가나상사 수리 견적서", "Q-2026-0002"), false);
  // 공백을 빠뜨린 번호도 가지 번호는 본 번호 폴더로.
  assert.equal(matchesQuoteArchiveFolder("DSS2026-089 가나상사 수리 견적서", "DSS2026-089-1"), true);
  // 이름이 본 번호 그 자체인 폴더.
  assert.equal(matchesQuoteArchiveFolder("DSS 2026-089", "DSS 2026-089-1"), true);
  // 가지 번호로 시작하는 폴더는 본 번호 폴더가 아니다(바로 뒤가 공백이 아니다).
  assert.equal(matchesQuoteArchiveFolder(BRANCH_STEM, "DSS 2026-089"), false);
});

test("폴더 이름 — 본 번호 + 조각 + 「수리 견적서」, 빈 조각은 뺀다", () => {
  assert.equal(quoteArchiveFolderName(DOMESTIC), STEM);
  // 가지 번호 견적서의 새 폴더 이름은 본 번호다.
  assert.equal(quoteArchiveFolderName(OVERHAUL_BRANCH), STEM);
  assert.equal(
    quoteArchiveFolderName({ ...DOMESTIC, modelName: null, lotNumber: "", serialNumber: "   " }),
    "DSS 2026-089 가나상사 수리 견적서"
  );
  assert.equal(
    quoteArchiveFolderName({ ...DOMESTIC, modelName: undefined, lotNumber: undefined, serialNumber: "S456" }),
    "DSS 2026-089 가나상사 S456 수리 견적서"
  );
  // 발행번호가 비면 이름을 만들 수 없다.
  assert.throws(() => quoteArchiveFolderName({ ...DOMESTIC, quoteNumber: "  " }));
});

test("금지 글자 · 제어문자는 공백으로, 끝의 점은 걷는다, 점만 있는 조각은 빠진다", () => {
  const name = quoteArchiveFolderName({
    ...DOMESTIC,
    customerName: '가나/상사:본사*"<>|?\\',
    modelName: "MODEL\u0000X1\u001F",
    lotNumber: "..",
    serialNumber: "S456...",
  });
  assert.equal(name, "DSS 2026-089 가나 상사 본사 MODEL X1 S456 수리 견적서");
  for (const forbidden of ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]) {
    assert.ok(!name.includes(forbidden), `${forbidden} 가 남아 있다`);
  }
  assert.ok(!/[\u0000-\u001F\u007F]/.test(name), "제어문자가 남았다");

  assert.equal(sanitizeQuoteArchiveNamePiece("가나상사 Co., Ltd."), "가나상사 Co., Ltd");
  assert.equal(sanitizeQuoteArchiveNamePiece("  가나   상사  "), "가나 상사");
  assert.equal(sanitizeQuoteArchiveNamePiece("."), "");
  assert.equal(sanitizeQuoteArchiveNamePiece(null), "");
  // 탐색기에서 확장자를 뒤집어 보이게 하는 방향 제어문자.
  assert.equal(sanitizeQuoteArchiveNamePiece("가나\u202Excod.exe"), "가나 xcod.exe");
});

test("NFC — 풀어쓴 한글 입력도 모아쓴 이름으로 나간다", () => {
  const name = quoteArchiveFolderName({ ...DOMESTIC, customerName: "가나상사".normalize("NFD") });
  assert.equal(name, STEM);
  assert.equal(name, name.normalize("NFC"));
  const file = quoteArchiveFileName({ ...OVERHAUL_BRANCH, customerName: "가나상사".normalize("NFD") }, { extension: "xls" });
  assert.equal(file, file.normalize("NFC"));
});

test("길이 상한 — 공급처 · 모델 · L/N · S/N 만 줄이고 번호 · 「수리 견적서」 · 꼬리는 그대로", () => {
  const long: QuoteArchiveNamingInput = {
    ...OVERHAUL_BRANCH,
    // 모두 한글 — UTF-8 바이트로 가장 무거운 경우.
    customerName: "가".repeat(200),
    modelName: "모".repeat(150),
    lotNumber: "L123",
    serialNumber: "시".repeat(100),
  };

  const folder = quoteArchiveFolderName(long);
  assert.ok(folder.length <= QUOTE_ARCHIVE_MAX_STEM_LENGTH, `폴더 이름이 길다: ${folder.length}`);
  assert.ok(folder.startsWith("DSS 2026-089 "), folder);
  assert.ok(folder.endsWith(" 수리 견적서"), folder);
  // 짧은 조각은 살아남는다 — 가장 긴 조각부터 줄인다.
  assert.ok(folder.includes(" L123 "), folder);

  const file = quoteArchiveFileName(long, { extension: "xlsx" });
  assert.ok(file.startsWith("DSS 2026-089-1 "), file);
  assert.ok(file.endsWith(" 수리 견적서(OH포함).xlsx"), file);
  assert.ok(file.length <= QUOTE_ARCHIVE_MAX_STEM_LENGTH + "(OH포함).xlsx".length, `파일 이름이 길다: ${file.length}`);

  const pdf = quoteArchiveSignedPdfFileName(long);
  assert.ok(pdf.startsWith("DSS 2026-089-1 "), pdf);
  assert.ok(pdf.endsWith(" 수리 견적서(OH포함) - 有印.pdf"), pdf);

  // UTF-8 바이트로도 NAS 한도(255) 안 — 번호 붙인 꼬리까지.
  assert.ok(Buffer.byteLength(numberedQuoteArchiveName(pdf, 99)) <= 255);
  assert.ok(Buffer.byteLength(numberedQuoteArchiveName(file, 99)) <= 255);

  // 자른 자리에 공백 · 점이 남지 않는다 — 공급처에 줄 수 있는 칸은 72 − (번호 12 + 「수리 견적서」 6
  // + 공백 5 + MODEL-X1 8 + L123 4 + S456 4) = 33 자라 `가`×32 + `.` 에서 잘리고, 끝의 점을 걷는다.
  const cut = quoteArchiveFolderName({ ...DOMESTIC, customerName: `${"가".repeat(32)}. ${"나".repeat(40)}` });
  assert.equal(cut, `DSS 2026-089 ${"가".repeat(32)} MODEL-X1 L123 S456 수리 견적서`);

  // 번호가 비정상적으로 길어도 번호는 자르지 않는다(조각만 모두 빠진다).
  const longNumber = `DSS ${"9".repeat(80)}`;
  assert.equal(quoteArchiveFolderName({ ...DOMESTIC, quoteNumber: longNumber }), `${longNumber} 수리 견적서`);
});

test("파일 이름 — 번호는 이 견적서 번호 그대로, OH 는 `(OH포함)` 을 앞 공백 없이", () => {
  assert.equal(quoteArchiveFileName(DOMESTIC, { extension: "xlsx" }), `${STEM}.xlsx`);
  assert.equal(quoteArchiveFileName(DOMESTIC, { extension: "xls" }), `${STEM}.xls`);
  assert.equal(quoteArchiveFileName(OVERHAUL_BRANCH, { extension: "xls" }), `${BRANCH_STEM}(OH포함).xls`);
  // 가지 번호 없는 OH 견적서도 같은 표시.
  assert.equal(
    quoteArchiveFileName({ ...DOMESTIC, kind: "OVERHAUL" }, { extension: "xlsx" }),
    `${STEM}(OH포함).xlsx`
  );
  // 확장자는 앞의 점을 떼고 소문자로 — 이상한 값은 거절.
  assert.equal(quoteArchiveFileName(DOMESTIC, { extension: ".XLSX" }), `${STEM}.xlsx`);
  assert.throws(() => quoteArchiveFileName(DOMESTIC, { extension: "x/y" }));
  assert.throws(() => quoteArchiveFileName(DOMESTIC, { extension: "" }));
});

test("결재 PDF — 파일 이름에서 확장자를 떼고 ` - 有印.pdf`", () => {
  assert.equal(quoteArchiveSignedPdfFileName(DOMESTIC), `${STEM} - 有印.pdf`);
  assert.equal(quoteArchiveSignedPdfFileName(OVERHAUL_BRANCH), `${BRANCH_STEM}(OH포함) - 有印.pdf`);
});

test("번호 붙인 후보 — 1 이면 그대로, 2 부터 확장자 앞에 ` (n)`", () => {
  const file = `${STEM}.xlsx`;
  assert.equal(numberedQuoteArchiveName(file, 1), file);
  assert.equal(numberedQuoteArchiveName(file, 2), `${STEM} (2).xlsx`);
  assert.equal(numberedQuoteArchiveName(file, 3), `${STEM} (3).xlsx`);
  assert.equal(
    numberedQuoteArchiveName(`${BRANCH_STEM}(OH포함) - 有印.pdf`, 2),
    `${BRANCH_STEM}(OH포함) - 有印 (2).pdf`
  );
  assert.equal(numberedQuoteArchiveName("이름", 2), "이름 (2)");
  assert.throws(() => numberedQuoteArchiveName(file, 0));
  assert.throws(() => numberedQuoteArchiveName(file, 1.5));
});
