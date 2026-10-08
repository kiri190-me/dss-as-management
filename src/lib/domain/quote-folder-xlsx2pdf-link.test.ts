import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { QUOTE_FOLDER_OPENABLE_EXTENSIONS } from "@/lib/domain/quote-folder-file-link";
import { QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH } from "@/lib/domain/quote-folder-link";
import {
  QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX,
  QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION,
  QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION,
  buildQuoteFolderXlsx2PdfLink,
  checkQuoteFolderXlsx2PdfSourcePath,
  isQuoteFolderXlsx2PdfSourceName,
  parseQuoteFolderXlsx2PdfLink,
  quoteFolderXlsx2PdfOutputName,
  quoteFolderXlsx2PdfOutputPath,
} from "@/lib/domain/quote-folder-xlsx2pdf-link";

/**
 * ============================================================================
 * 「엑셀 → PDF」 주소 규칙 (domain/quote-folder-xlsx2pdf-link.ts)
 * ============================================================================
 * 도우미 스크립트 쪽 짝은 server/quote-folder-helper.test.ts 가 실제로 PowerShell 을 돌려
 * 본다(DSS_FOLDER_DRY_RUN). 여기서는 **값으로만** 본다 — 규칙이 어긋나면 주소를 만들지
 * 않는다는 것, 그리고 결과 이름이 규칙으로 정해진다는 것.
 * ============================================================================
 */

const FOLDER = "21. 2026 내자견적서/DSS 2026-089 가나상사 MODEL-X1 전원 불량";
const XLSX = "DSS 2026-089 가나상사 MODEL-X1 전원 불량.xlsx";

describe("상수", () => {
  test("접두어 · 확장자는 도우미가 아는 그 글자다", () => {
    assert.equal(QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX, "dss-folder://xlsx2pdf/?p=");
    assert.equal(QUOTE_FOLDER_XLSX2PDF_SOURCE_EXTENSION, "xlsx");
    assert.equal(QUOTE_FOLDER_XLSX2PDF_OUTPUT_EXTENSION, "pdf");
  });

  test("🔴 읽기 허용 목록보다 좁다 — 일부러 다른 목록이다", () => {
    assert.ok(QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes("xlsm"));
    assert.ok(QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes("xls"));
    assert.ok(!isQuoteFolderXlsx2PdfSourceName("견적서.xlsm"));
    assert.ok(!isQuoteFolderXlsx2PdfSourceName("견적서.xls"));
  });
});

describe("주소를 만든다 · 안 만든다", () => {
  test("규칙대로 만든다 — 되읽으면 같은 경로다", () => {
    const link = buildQuoteFolderXlsx2PdfLink(`${FOLDER}/${XLSX}`);
    assert.ok(link !== null);
    assert.ok(link.startsWith(QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX));
    // 몸통은 base64url 글자만 — 명령줄 · 셸을 지나도 변하지 않는다.
    assert.match(link.slice(QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX.length), /^[A-Za-z0-9_-]+$/);
    assert.equal(parseQuoteFolderXlsx2PdfLink(link), `${FOLDER}/${XLSX}`);
  });

  test("🔴 `.xlsx` 밖은 주소를 만들지 않는다", () => {
    for (const name of ["견적서.xlsm", "견적서.xls", "견적서.pdf", "견적서.exe", "견적서", "견적서.", ".xlsx"]) {
      assert.equal(buildQuoteFolderXlsx2PdfLink(`${FOLDER}/${name}`), null, name);
    }
  });

  test("확장자는 접어서 본다 — 대문자도 같은 것", () => {
    assert.ok(isQuoteFolderXlsx2PdfSourceName("견적서.XLSX"));
    assert.ok(buildQuoteFolderXlsx2PdfLink(`${FOLDER}/견적서.XLSX`) !== null);
  });

  test("상대 경로 규칙은 그대로 거친다 — 절대 경로 · 거슬러 올라가기 · 금지 글자", () => {
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath("/뿌리/견적서.xlsx"), "ABSOLUTE");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath("C:/견적서.xlsx"), "ABSOLUTE");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath("../견적서.xlsx"), "DOT_SEGMENT");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath("폴더\\견적서.xlsx"), "FORBIDDEN_CHARACTER");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath("폴더//견적서.xlsx"), "EMPTY_SEGMENT");
    // 🔴 끝의 점 · 공백은 Windows 가 조용히 뗀다 — 상대 경로 규칙이 **먼저** 막는다.
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath("견적서.xlsx "), "TRAILING_DOT_OR_SPACE");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath("견적서.xlsx."), "TRAILING_DOT_OR_SPACE");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath(`${"가".repeat(QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH)}.xlsx`), "TOO_LONG");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath(""), "EMPTY");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath(null), "EMPTY");
  });

  test("확장자만 틀린 것과 아예 없는 것을 가른다", () => {
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath(`${FOLDER}/견적서.xlsm`), "NOT_XLSX");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath(`${FOLDER}/견적서`), "NO_EXTENSION");
    assert.equal(checkQuoteFolderXlsx2PdfSourcePath(`${FOLDER}/.xlsx`), "NO_EXTENSION");
  });

  test("이름 하나짜리 물음은 마디를 늘리지 못한다", () => {
    assert.ok(isQuoteFolderXlsx2PdfSourceName(XLSX));
    assert.ok(!isQuoteFolderXlsx2PdfSourceName(`하위/${XLSX}`));
    assert.ok(!isQuoteFolderXlsx2PdfSourceName(123));
  });
});

describe("🔴 결과 이름은 규칙이 정한다 — 주소가 고르지 못한다", () => {
  test("같은 폴더 · 같은 이름 · 확장자만 pdf", () => {
    assert.equal(quoteFolderXlsx2PdfOutputName(XLSX), "DSS 2026-089 가나상사 MODEL-X1 전원 불량.pdf");
    assert.equal(
      quoteFolderXlsx2PdfOutputPath(`${FOLDER}/${XLSX}`),
      `${FOLDER}/DSS 2026-089 가나상사 MODEL-X1 전원 불량.pdf`
    );
  });

  test("이름 안의 다른 점은 건드리지 않는다 — 맨 뒤 다섯 글자만 뗀다", () => {
    assert.equal(quoteFolderXlsx2PdfOutputName("v1.2 견적서.xlsx"), "v1.2 견적서.pdf");
  });

  test("대문자 확장자도 결과는 소문자 pdf 다", () => {
    assert.equal(quoteFolderXlsx2PdfOutputName("견적서.XLSX"), "견적서.pdf");
  });

  test("원본이 규칙 밖이면 이름을 지어내지 않는다", () => {
    assert.equal(quoteFolderXlsx2PdfOutputName("견적서.xlsm"), null);
    assert.equal(quoteFolderXlsx2PdfOutputPath("../견적서.xlsx"), null);
    assert.equal(quoteFolderXlsx2PdfOutputPath(42), null);
  });
});

describe("되읽기는 엄격하다 — 이 주소는 아무 웹페이지나 부를 수 있다", () => {
  test("접두어가 다르면 null", () => {
    const link = buildQuoteFolderXlsx2PdfLink(`${FOLDER}/${XLSX}`);
    assert.ok(link !== null);
    assert.equal(parseQuoteFolderXlsx2PdfLink(link.replace("xlsx2pdf", "openfile")), null);
    assert.equal(parseQuoteFolderXlsx2PdfLink("dss-folder://open/?p=YQ"), null);
    assert.equal(parseQuoteFolderXlsx2PdfLink(null), null);
  });

  test("몸통이 base64url 표준 모양이 아니면 null", () => {
    assert.equal(parseQuoteFolderXlsx2PdfLink(`${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}@@@@`), null);
    assert.equal(parseQuoteFolderXlsx2PdfLink(`${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}`), null);
  });

  test("싸 보냈어도 규칙 밖 경로는 되읽지 않는다", () => {
    const raw = (text: string) =>
      `${QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX}${Buffer.from(text, "utf8").toString("base64url")}`;
    assert.equal(parseQuoteFolderXlsx2PdfLink(raw("../../../어딘가/견적서.xlsx")), null);
    assert.equal(parseQuoteFolderXlsx2PdfLink(raw(`${FOLDER}/견적서.xlsm`)), null);
    // 맞는 것은 그대로 되읽는다 — 거절만 하는 함수가 아니다.
    assert.equal(parseQuoteFolderXlsx2PdfLink(raw(`${FOLDER}/${XLSX}`)), `${FOLDER}/${XLSX}`);
  });
});
