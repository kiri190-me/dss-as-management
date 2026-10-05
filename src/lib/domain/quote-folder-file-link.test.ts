import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  QUOTE_FOLDER_FILE_LINK_PREFIX,
  QUOTE_FOLDER_OPENABLE_EXTENSIONS,
  buildQuoteFolderFileLink,
  checkQuoteFolderOpenableFilePath,
  isOpenableQuoteFolderExtension,
  isOpenableQuoteFolderFileName,
  isOpenableQuoteFolderFilePath,
  parseQuoteFolderFileLink,
} from "./quote-folder-file-link";
import {
  QUOTE_FOLDER_LINK_PREFIX,
  QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH,
  buildQuoteFolderLink,
  parseQuoteFolderLink,
} from "./quote-folder-link";

/*
 * ============================================================================
 * 「파일 열기」 주소 — `dss-folder://openfile/?p=…` (연락서 조각 4)
 * ============================================================================
 * 🔴 여기서 값으로 못 박는 것은 **거절**이다. 이 주소는 아무 웹페이지나 만들 수 있고, 받는
 * 쪽(PowerShell 도우미)이 마지막 울타리다 — 그쪽은 quote-folder-helper.test.ts 가 실제로
 * 돌려 본다. 이 파일은 **서버 · 화면이 쓰는 순수 판정**이 같은 규칙인지를 본다.
 * ============================================================================
 */

const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

describe("허용 목록", () => {
  test("🔴 사용자가 정한 열여덟 개 그대로 · 소문자 · 점 없이", () => {
    assert.deepEqual(
      [...QUOTE_FOLDER_OPENABLE_EXTENSIONS],
      "xlsx xls xlsm pdf docx doc pptx ppt hwp hwpx jpg jpeg png gif bmp txt csv zip".split(" ")
    );
    for (const extension of QUOTE_FOLDER_OPENABLE_EXTENSIONS) {
      assert.equal(extension, extension.toLowerCase(), extension);
      assert.equal(extension.includes("."), false, extension);
    }
    // 같은 것이 두 번 적히지 않았다.
    assert.equal(new Set(QUOTE_FOLDER_OPENABLE_EXTENSIONS).size, QUOTE_FOLDER_OPENABLE_EXTENSIONS.length);
  });

  test("🔴 .xlsm 은 일부러 들어 있다 — 연락서 원본이 그것이다", () => {
    assert.ok(QUOTE_FOLDER_OPENABLE_EXTENSIONS.includes("xlsm"));
    assert.ok(isOpenableQuoteFolderFileName("연락서.xlsm"));
  });

  test("🔴 실행되는 것은 하나도 없다 — 거절 목록이 아니라 허용 목록이다", () => {
    for (const dangerous of [
      "exe", "bat", "cmd", "ps1", "vbs", "js", "lnk", "url", "scf", "msi",
      "reg", "hta", "com", "scr", "jar", "pif", "cpl", "msc", "wsf", "jse",
      "vbe", "wsh", "chm", "application", "gadget", "ws", "psm1", "sh",
    ]) {
      assert.equal(isOpenableQuoteFolderExtension(dangerous), false, dangerous);
      assert.equal(isOpenableQuoteFolderFileName(`무언가.${dangerous}`), false, dangerous);
    }
  });

  test("🔴 접어서 본다 — .PDF 는 되고 .EXE 는 안 된다", () => {
    for (const name of ["보고서.PDF", "보고서.Pdf", "사진.JPG", "연락서.XLSM"]) {
      assert.ok(isOpenableQuoteFolderFileName(name), name);
    }
    for (const name of ["무언가.EXE", "무언가.Exe", "무언가.LNK", "무언가.Ps1"]) {
      assert.equal(isOpenableQuoteFolderFileName(name), false, name);
    }
  });
});

describe("🔴 거절 — 파일 이름", () => {
  test("확장자가 없으면 거절 — 점이 없는 것 · 점이 맨 앞인 것 · 점으로 끝나는 것", () => {
    assert.equal(checkQuoteFolderOpenableFilePath("문서"), "NO_EXTENSION");
    assert.equal(checkQuoteFolderOpenableFilePath("연락서사본"), "NO_EXTENSION");
    assert.equal(checkQuoteFolderOpenableFilePath(".pdf"), "NO_EXTENSION");
    assert.equal(checkQuoteFolderOpenableFilePath(".xlsm"), "NO_EXTENSION");
    // 점으로 끝나는 것은 **경로 규칙**이 먼저 막는다.
    assert.equal(checkQuoteFolderOpenableFilePath("보고서."), "TRAILING_DOT_OR_SPACE");
  });

  test("목록 밖 확장자는 EXTENSION_NOT_ALLOWED", () => {
    assert.equal(checkQuoteFolderOpenableFilePath("설치.exe"), "EXTENSION_NOT_ALLOWED");
    assert.equal(checkQuoteFolderOpenableFilePath(`${FOLDER}/설치.exe`), "EXTENSION_NOT_ALLOWED");
    assert.equal(checkQuoteFolderOpenableFilePath("보고서.pdf.exe"), "EXTENSION_NOT_ALLOWED");
  });

  test("🔴 끝에 점 · 공백이 붙은 이름은 경로 규칙이 먼저 막는다 — Windows 가 조용히 뗀다", () => {
    for (const value of ["보고서.pdf.", "보고서.pdf ", "보고서.pdf. ", `${FOLDER}/보고서.pdf.`]) {
      assert.equal(checkQuoteFolderOpenableFilePath(value), "TRAILING_DOT_OR_SPACE", value);
    }
  });

  test("🔴 경로 규칙은 폴더 주소와 **같은 것**을 그대로 쓴다", () => {
    assert.equal(checkQuoteFolderOpenableFilePath(""), "EMPTY");
    assert.equal(checkQuoteFolderOpenableFilePath(undefined), "EMPTY");
    assert.equal(checkQuoteFolderOpenableFilePath("/연락서.pdf"), "ABSOLUTE");
    assert.equal(checkQuoteFolderOpenableFilePath("C:/Windows/win.ini"), "ABSOLUTE");
    assert.equal(checkQuoteFolderOpenableFilePath("\\\\NAS\\share\\문서.pdf"), "ABSOLUTE");
    assert.equal(checkQuoteFolderOpenableFilePath(`${FOLDER}\\연락서.pdf`), "FORBIDDEN_CHARACTER");
    assert.equal(checkQuoteFolderOpenableFilePath(`${FOLDER}/연락서.pdf:stream`), "FORBIDDEN_CHARACTER");
    assert.equal(checkQuoteFolderOpenableFilePath(`${FOLDER}//연락서.pdf`), "EMPTY_SEGMENT");
    assert.equal(checkQuoteFolderOpenableFilePath(`${FOLDER}/../연락서.pdf`), "DOT_SEGMENT");
    assert.equal(checkQuoteFolderOpenableFilePath(`${FOLDER}/연락\u0000서.pdf`), "CONTROL_CHARACTER");
    assert.equal(checkQuoteFolderOpenableFilePath(`${"가".repeat(QUOTE_FOLDER_RELATIVE_PATH_MAX_LENGTH)}.pdf`), "TOO_LONG");
  });

  test("🔴 이름 하나를 묻는 길에는 경로가 들어오지 못한다", () => {
    assert.equal(isOpenableQuoteFolderFileName(`${FOLDER}/연락서.pdf`), false);
    assert.equal(isOpenableQuoteFolderFileName("하위/연락서.pdf"), false);
    assert.equal(isOpenableQuoteFolderFileName(123), false);
    assert.equal(isOpenableQuoteFolderFileName(null), false);
    assert.ok(isOpenableQuoteFolderFileName("연락서.pdf"));
  });
});

describe("주소 만들기 · 되읽기", () => {
  test("접두어가 폴더 주소와 다르다 — 같은 스킴, 다른 동작", () => {
    assert.equal(QUOTE_FOLDER_FILE_LINK_PREFIX, "dss-folder://openfile/?p=");
    assert.equal(QUOTE_FOLDER_LINK_PREFIX, "dss-folder://open/?p=");
    assert.ok(QUOTE_FOLDER_FILE_LINK_PREFIX.startsWith("dss-folder://"), "스킴이 하나여야 설치가 한 번이다");
  });

  test("만들고 되읽으면 같은 경로 — 한글 · 공백 · & · % · 작은따옴표", () => {
    for (const relative of [
      `${FOLDER}/연락서.xlsm`,
      `${FOLDER}/D260908 연락서 (주)한국 & 제어 100%.xlsm`,
      `${FOLDER}/R&D 'Q' 보고서.pdf`,
      "연락서.pdf",
    ]) {
      const link = buildQuoteFolderFileLink(relative);
      assert.ok(link !== null, relative);
      assert.ok(link.startsWith(QUOTE_FOLDER_FILE_LINK_PREFIX), link);
      assert.equal(parseQuoteFolderFileLink(link), relative);
      // 몸통은 base64url 글자뿐이다 — 명령줄을 지나도 해석될 글자가 없다.
      assert.match(link.slice(QUOTE_FOLDER_FILE_LINK_PREFIX.length), /^[A-Za-z0-9_-]+$/);
    }
  });

  test("🔴 열 수 없는 것은 주소를 지어내지 않는다 — null", () => {
    for (const relative of ["설치.exe", "문서", "보고서.pdf.", `${FOLDER}/../연락서.pdf`, ""]) {
      assert.equal(buildQuoteFolderFileLink(relative), null, relative);
    }
  });

  test("🔴 되읽기도 허용 목록을 본다 — 다른 사이트가 싼 주소", () => {
    const evil = `${QUOTE_FOLDER_FILE_LINK_PREFIX}${Buffer.from(`${FOLDER}/설치.exe`, "utf8").toString("base64url")}`;
    assert.equal(parseQuoteFolderFileLink(evil), null);
    const noExtension = `${QUOTE_FOLDER_FILE_LINK_PREFIX}${Buffer.from("문서", "utf8").toString("base64url")}`;
    assert.equal(parseQuoteFolderFileLink(noExtension), null);
  });

  test("🔴 인코딩이 표준이 아니면 거절 — 빈 몸통 · 채움 · 알파벳 밖 · UTF-8 아님", () => {
    const body = (buildQuoteFolderFileLink("연락서.pdf") ?? "").slice(QUOTE_FOLDER_FILE_LINK_PREFIX.length);
    assert.notEqual(body, "");
    for (const encoded of [
      "",
      `${body}=`,
      `${body}+`,
      "YR",
      "A",
      Buffer.from([0xff]).toString("base64url"),
      Buffer.from([0xed, 0xa0, 0x80]).toString("base64url"),
    ]) {
      assert.equal(parseQuoteFolderFileLink(`${QUOTE_FOLDER_FILE_LINK_PREFIX}${encoded}`), null, encoded);
    }
    for (const value of [undefined, null, 1, {}, "https://example.com/"]) {
      assert.equal(parseQuoteFolderFileLink(value), null);
    }
  });

  test("🔴 두 주소는 서로를 읽지 못한다 — 접두어가 동작을 가른다", () => {
    const fileLink = buildQuoteFolderFileLink(`${FOLDER}/연락서.pdf`);
    const folderLink = buildQuoteFolderLink(FOLDER);
    assert.ok(fileLink !== null && folderLink !== null);
    assert.equal(parseQuoteFolderLink(fileLink), null, "폴더 되읽기가 파일 주소를 받았다");
    assert.equal(parseQuoteFolderFileLink(folderLink), null, "파일 되읽기가 폴더 주소를 받았다");
  });

  test("🔴 폴더 주소 쪽은 한 글자도 바뀌지 않았다", () => {
    const link = buildQuoteFolderLink(FOLDER);
    assert.equal(link, `${QUOTE_FOLDER_LINK_PREFIX}${Buffer.from(FOLDER, "utf8").toString("base64url")}`);
    assert.equal(parseQuoteFolderLink(link), FOLDER);
    // 폴더 주소는 확장자를 보지 않는다 — 조각 4 가 그 규칙을 건드리지 않았다.
    assert.equal(parseQuoteFolderLink(buildQuoteFolderLink("2026 폴더.exe")), "2026 폴더.exe");
  });

  test("상대 경로 판정은 둘 다 같은 글자를 받는다", () => {
    assert.ok(isOpenableQuoteFolderFilePath(`${FOLDER}/연락서.pdf`));
    assert.equal(isOpenableQuoteFolderFilePath(`${FOLDER}/연락서.exe`), false);
  });
});
