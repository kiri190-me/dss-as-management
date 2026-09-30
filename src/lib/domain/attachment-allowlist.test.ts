import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANY_EXTENSION_CATEGORIES,
  ATTACHMENT_EXTENSION_RULES,
  CATEGORY_EXTENSION_ALLOWLIST,
  CONTENT_SNIFF_BYTES,
  MAX_ATTACHMENT_SIZE_BYTES,
  canonicalMimeTypeForExtension,
  getAllowedMimeTypesForExtension,
  isAllowedExtension,
  isCategoryOpenToAnyExtension,
  isContentCompatibleWithExtension,
  isExecutableExtension,
  isExtensionAllowedForCategory,
  isExtensionMimeCompatible,
  isPreviewCapableExtension,
  isUploadContentCompatible,
  normalizeFileExtension,
} from "./attachment-allowlist";
import {
  ATTACHMENT_EXTENSION_RULES as DEMO_EXTENSION_RULES,
  CATEGORY_EXTENSION_ALLOWLIST as DEMO_CATEGORY_ALLOWLIST,
  MAX_ATTACHMENT_SIZE_BYTES as DEMO_MAX_ATTACHMENT_SIZE_BYTES,
} from "./local/attachments/allowlist";
import {
  ATTACHMENT_CATEGORY_CODES,
  isAttachmentCategoryAllowedForOwner,
} from "./attachment-category";

/**
 * ============================================================================
 * 이 파일이 지키려는 것 — 같은 목록이 두 곳에 있고, 어긋나면 조용히 깨진다
 * ============================================================================
 * 확장자 규칙은 지금 두 군데에 적혀 있다.
 *
 *   1. 데모 화면    src/lib/domain/local/attachments/allowlist.ts
 *   2. 실제 저장    src/lib/domain/attachment-allowlist.ts   (이 테스트의 대상)
 *
 * 데모는 데모가 걷힐 때까지 그대로 남으므로 **어느 한 곳만 고치는 일이 실제로
 * 가능하다.** 한 곳만 고쳐지면 화면은 올릴 수 있다고 말하는데 서버가 거부하거나,
 * 반대로 화면이 막는 파일을 서버가 받는다. 그래서 두 목록을 순서까지 맞춰 본다
 * (분류 목록에 attachment-category.test.ts가 하는 것과 같은 방식).
 *
 * ── 크기 상한은 일부러 비교하지 않는다 ───────────────────────────────────
 * 데모는 300MB, 실제 저장은 **20MB**다. 이것은 어긋남이 아니라 승인된 결정이다 —
 * 데모는 파일 내용을 한 바이트도 다루지 않아 그 숫자가 아무 자원도 쓰지 않지만,
 * 실제 저장에서는 그 값이 그대로 업로드 시간·디스크·백업·NAS 이전 시간이 된다.
 * 그래서 크기만 비교 대상에서 빼고, 대신 **두 값이 서로 다르다는 사실 자체를**
 * 아래에서 단언한다. 어느 날 누가 둘을 같게 맞춰 버리면 그때 이 테스트가 깨진다.
 * ============================================================================
 */

// ───────────────────────────────────────── 데모 목록과 어긋나지 않는가

test("확장자 규칙이 데모 파일과 순서·값까지 정확히 같다", () => {
  assert.deepEqual([...ATTACHMENT_EXTENSION_RULES], [...DEMO_EXTENSION_RULES]);
});

test("분류별 확장자 제한이 데모 파일과 같다 — 주인 전용 분류 셋만 빼고", () => {
  // SCREENSHOT(개선 요청 스크린샷)과 견적서 두 칸 SIGNED_QUOTE_PDF · QUOTE_EXCEL 은 데모에
  // 분류 자체가 없다(attachment-category.ts 헤더의 '데모 파일과의 관계'). 빼는 것은 그
  // 세 줄뿐이다.
  const ownerOnly = ["SCREENSHOT", "SIGNED_QUOTE_PDF", "QUOTE_EXCEL"];
  const withoutOwnerOnly = Object.fromEntries(
    Object.entries(CATEGORY_EXTENSION_ALLOWLIST).filter(([category]) => !ownerOnly.includes(category))
  );
  assert.deepEqual(withoutOwnerOnly, DEMO_CATEGORY_ALLOWLIST);
});

test("크기 상한은 데모와 일부러 다르다 — 실제 저장은 20MB다", () => {
  assert.equal(MAX_ATTACHMENT_SIZE_BYTES, 20 * 1024 * 1024);
  assert.equal(DEMO_MAX_ATTACHMENT_SIZE_BYTES, 300 * 1024 * 1024);
  assert.notEqual(
    MAX_ATTACHMENT_SIZE_BYTES,
    DEMO_MAX_ATTACHMENT_SIZE_BYTES,
    "두 값이 같아졌다면 승인된 20MB 상한이 사라졌거나 데모 쪽이 바뀐 것이다"
  );
});

// ────────────────────────────────────────────── 목록 자체의 무결성

test("확장자는 14종이고 중복이 없다", () => {
  assert.equal(ATTACHMENT_EXTENSION_RULES.length, 14);
  assert.equal(new Set(ATTACHMENT_EXTENSION_RULES.map((rule) => rule.extension)).size, 14);
});

test("모든 확장자는 소문자이고 MIME이 최소 하나 있다", () => {
  for (const rule of ATTACHMENT_EXTENSION_RULES) {
    assert.equal(rule.extension, rule.extension.toLowerCase(), rule.extension);
    assert.ok(rule.allowedMimeTypes.length > 0, `${rule.extension}에 MIME이 없다`);
  }
});

test("분류별 제한에 쓰인 확장자는 전부 전체 허용목록 안에 있다", () => {
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSION_ALLOWLIST)) {
    for (const extension of extensions ?? []) {
      assert.ok(isAllowedExtension(extension), `${category}의 ${extension}이 허용목록에 없다`);
    }
  }
});

test("제한이 없는 분류는 허용목록 전체를 쓸 수 있다 — 그 밖은 여전히 못 쓴다", () => {
  // 형식을 가리지 않는 분류(파라미터 · 통전검사 · 점검표)는 여기서 뺀다 — 그쪽은
  // "허용목록 전체"가 아니라 "실행 파일만 빼고 전부"라 아래 전용 시험이 따로 본다.
  const unrestricted = ATTACHMENT_CATEGORY_CODES.filter(
    (code) => !(code in CATEGORY_EXTENSION_ALLOWLIST) && !isCategoryOpenToAnyExtension(code)
  );
  assert.ok(unrestricted.length > 0, "비교 대상이 있어야 한다");
  for (const category of unrestricted) {
    assert.equal(isExtensionAllowedForCategory("pdf", category), true);
    assert.equal(isExtensionAllowedForCategory("exe", category), false);
    // 🔴 이 셋이 열린 것이 다른 분류를 함께 열지 않았다 — 허용목록 밖은 그대로 막힌다.
    for (const extension of ["hwp", "dwg", "par", "webp"]) {
      assert.equal(
        isExtensionAllowedForCategory(extension, category),
        false,
        `${category} 에 .${extension} 이 통과했다`
      );
    }
  }
});

// ─────────────── 형식을 가리지 않는 분류 (2026-09-30 — 모델 기본 자료 셋)

test("형식을 가리지 않는 분류는 모델 전용 셋 그대로다 — 다른 분류는 하나도 안 열렸다", () => {
  assert.deepEqual([...ANY_EXTENSION_CATEGORIES], ["PARAMETER", "POWER_TEST", "CHECKLIST"]);
  // 주인이 제품 모델 하나뿐인 분류여야 한다. 접수 건 · 견적서 통로는 이 길에
  // 닿지 못한다 — 닿게 되는 날 여기서 걸린다.
  for (const category of ANY_EXTENSION_CATEGORIES) {
    assert.equal(isAttachmentCategoryAllowedForOwner(category, "PRODUCT_MODEL"), true, category);
    assert.equal(isAttachmentCategoryAllowedForOwner(category, "REPAIR_CASE"), false, category);
    assert.equal(isAttachmentCategoryAllowedForOwner(category, "QUOTE"), false, category);
  }
  // 나머지 분류는 전부 닫힌 채다.
  const open = ATTACHMENT_CATEGORY_CODES.filter((code) => isCategoryOpenToAnyExtension(code));
  assert.deepEqual(open, ["PARAMETER", "POWER_TEST", "CHECKLIST"]);
  // 좁히는 목록(CATEGORY_EXTENSION_ALLOWLIST)은 한 글자도 안 건드렸다.
  for (const category of ANY_EXTENSION_CATEGORIES) {
    assert.equal(category in CATEGORY_EXTENSION_ALLOWLIST, false, `${category} 가 좁히는 목록에 들어갔다`);
  }
});

test("모델 기본 자료 셋은 허용목록 밖 형식도 받는다 — 장비마다 도구가 다르다", () => {
  // 전체 허용목록(14종) 안팎을 가리지 않는다. 여기 적은 것은 현장에서 실제로
  // 나오는 이름들이고, 목록으로 셀 수 없다는 것이 이 분류의 요점이다.
  for (const category of ANY_EXTENSION_CATEGORIES) {
    for (const extension of ["pdf", "xlsx", "csv", "txt", "jpg", "zip", "bin", "hex"]) {
      assert.equal(isExtensionAllowedForCategory(extension, category), true, `${category} 에 .${extension} 이 막혔다`);
    }
    for (const extension of ["hwp", "dwg", "dxf", "par", "prm", "cfg", "ini", "json", "xml", "rtf", "7z", "webp"]) {
      assert.equal(isExtensionAllowedForCategory(extension, category), true, `${category} 에 .${extension} 이 막혔다`);
    }
  }
});

test("🔴 모델 기본 자료 셋에 실행 파일은 못 올라간다 — 윈도 · 리눅스 · 스크립트 · 매크로", () => {
  // 사내에서 서로 나누는 자리라 한 번 잘못 올라가면 그대로 퍼진다(2026-09-30 사용자).
  const executables = [
    // 윈도 실행체·설치본·적재 모듈
    "exe", "com", "scr", "pif", "msi", "msix", "dll", "ocx", "cpl", "sys",
    // 윈도 스크립트·손잡이
    "bat", "cmd", "ps1", "vbs", "js", "wsf", "hta", "lnk", "reg", "inf",
    // 유닉스·맥
    "sh", "bash", "run", "out", "elf", "so", "dylib", "app", "pkg", "dmg", "deb", "rpm", "appimage",
    // 해석기 스크립트
    "py", "pyc", "rb", "pl", "php", "lua", "ahk",
    // 자바·안드로이드
    "jar", "apk", "class", "dex",
    // 매크로가 들어가는 오피스 — 매크로는 코드다
    "xlsm", "xlsb", "docm", "pptm", "xlam",
  ];
  for (const category of ANY_EXTENSION_CATEGORIES) {
    for (const extension of executables) {
      assert.equal(
        isExtensionAllowedForCategory(extension, category),
        false,
        `${category} 에 실행 파일 .${extension} 이 통과했다`
      );
    }
  }
  // 목록에 적은 것은 전부 거절 함수가 알아야 한다.
  for (const extension of executables) {
    assert.equal(isExecutableExtension(extension), true, `.${extension} 이 실행 파일 목록에 없다`);
  }
  // 확장자가 없는 이름은 애초에 normalizeFileExtension 이 null 이지만, 이 함수만
  // 따로 불러도 열리지 않아야 한다.
  assert.equal(isExtensionAllowedForCategory("", "PARAMETER"), false);
});

test("펌웨어 확장자(bin · hex)는 실행 파일로 보지 않는다", () => {
  // 계측·펌웨어 덤프의 이름이고, 윈도도 리눅스도 그 이름만으로 실행하지 않는다.
  // 파라미터가 .bin 으로 나오는 장비가 실제로 있다. 실행 파일 서명은 아래 내용
  // 대조가 확장자와 무관하게 따로 막는다.
  assert.equal(isExecutableExtension("bin"), false);
  assert.equal(isExecutableExtension("hex"), false);
  assert.equal(isExtensionAllowedForCategory("bin", "PARAMETER"), true);
  // 기존 허용목록 14종 가운데 실행 파일로 분류된 것은 하나도 없다 — 하나라도
  // 생기면 그 분류가 조용히 좁아진다.
  for (const rule of ATTACHMENT_EXTENSION_RULES) {
    assert.equal(isExecutableExtension(rule.extension), false, `.${rule.extension} 이 실행 파일이 됐다`);
  }
});

test("크기 상한은 열리지 않았다 — 형식만 열었다", () => {
  // 승인된 20MB 다. 형식을 가리지 않는 분류라고 더 큰 파일을 받지 않는다.
  assert.equal(MAX_ATTACHMENT_SIZE_BYTES, 20 * 1024 * 1024);
});

test("제한이 있는 분류는 그 목록 밖 확장자를 거부한다", () => {
  assert.equal(isExtensionAllowedForCategory("pdf", "CIRCUIT_DIAGRAM"), true);
  // 회로도의 부정 예시는 zip이다. 예전에는 jpg가 이 자리에 있었는데, 종이
  // 회로도를 폰으로 찍어 올리는 길을 열면서 사진 확장자가 허용목록에 들어갔다
  // (아래 전용 테스트 참조). zip은 전체 허용목록에는 있지만 회로도는 아니다 —
  // 넓힌 것이 "아무거나 받는다"가 되지 않았음을 여기서 못 박는다.
  assert.equal(isExtensionAllowedForCategory("zip", "CIRCUIT_DIAGRAM"), false);
  assert.equal(isExtensionAllowedForCategory("bin", "FIRMWARE"), true);
  assert.equal(isExtensionAllowedForCategory("pdf", "FIRMWARE"), false);
  assert.equal(isExtensionAllowedForCategory("csv", "OSCILLOSCOPE_DATA"), true);
  assert.equal(isExtensionAllowedForCategory("log", "LOG_FILE"), true);
});

test("회로도는 PDF와 사진(jpg/jpeg/png)을 받는다 — 종이 회로도를 폰으로 찍어 올린다", () => {
  for (const extension of ["pdf", "jpg", "jpeg", "png"]) {
    assert.equal(
      isExtensionAllowedForCategory(extension, "CIRCUIT_DIAGRAM"),
      true,
      `회로도에 .${extension}이 막혔다`
    );
  }
});

test("회로도를 넓힌 것이 '아무거나 받는다'가 되지는 않았다", () => {
  // 허용목록 안에 있으면서 회로도에는 뜻이 없는 확장자들. 하나라도 통과하면
  // 분류 제한이 사실상 사라진 것이다.
  for (const extension of ["zip", "xlsx", "xls", "doc", "docx", "csv", "txt", "log", "bin", "hex"]) {
    assert.equal(
      isExtensionAllowedForCategory(extension, "CIRCUIT_DIAGRAM"),
      false,
      `회로도에 .${extension}이 통과했다`
    );
  }
  // 허용목록 밖은 당연히 막힌다.
  assert.equal(isExtensionAllowedForCategory("exe", "CIRCUIT_DIAGRAM"), false);
  assert.equal(isExtensionAllowedForCategory("svg", "CIRCUIT_DIAGRAM"), false);
});

test("스크린샷은 이미지(png/jpg/jpeg)만 받는다 — 개선 요청 글의 화면 사진", () => {
  assert.deepEqual([...(CATEGORY_EXTENSION_ALLOWLIST.SCREENSHOT ?? [])], ["png", "jpg", "jpeg"]);
  for (const extension of ["png", "jpg", "jpeg"]) {
    assert.equal(isExtensionAllowedForCategory(extension, "SCREENSHOT"), true, `.${extension}이 막혔다`);
    // 셋 다 화면에서 바로 볼 수 있는 형식이다.
    assert.equal(isPreviewCapableExtension(extension), true, `.${extension}이 미리보기 불가다`);
  }
  // 허용목록 안에 있지만 이미지가 아닌 것들 — 하나라도 통과하면 "이미지만"이 깨진다.
  for (const extension of ["pdf", "zip", "xlsx", "xls", "doc", "docx", "csv", "txt", "log", "bin", "hex"]) {
    assert.equal(isExtensionAllowedForCategory(extension, "SCREENSHOT"), false, `.${extension}이 통과했다`);
  }
  // 허용목록 밖의 이미지 형식도 막힌다.
  for (const extension of ["webp", "gif", "bmp", "svg", "heic", "exe"]) {
    assert.equal(isExtensionAllowedForCategory(extension, "SCREENSHOT"), false, `.${extension}이 통과했다`);
  }
});

test("결재 견적서는 PDF 만 받는다 — 사진 · 엑셀 · 문서는 거절", () => {
  assert.deepEqual([...(CATEGORY_EXTENSION_ALLOWLIST.SIGNED_QUOTE_PDF ?? [])], ["pdf"]);
  assert.equal(isExtensionAllowedForCategory("pdf", "SIGNED_QUOTE_PDF"), true);
  for (const extension of ["jpg", "jpeg", "png", "xlsx", "xls", "doc", "docx", "zip", "csv", "txt", "log", "bin", "hex"]) {
    assert.equal(isExtensionAllowedForCategory(extension, "SIGNED_QUOTE_PDF"), false, `.${extension}이 통과했다`);
  }
  for (const extension of ["exe", "hwp", "webp", ""]) {
    assert.equal(isExtensionAllowedForCategory(extension, "SIGNED_QUOTE_PDF"), false, `.${extension}이 통과했다`);
  }
});

test("수기 견적서는 엑셀(xlsx · xls)만 받는다 — PDF · 사진 · 문서는 거절", () => {
  assert.deepEqual([...(CATEGORY_EXTENSION_ALLOWLIST.QUOTE_EXCEL ?? [])], ["xlsx", "xls"]);
  for (const extension of ["xlsx", "xls"]) {
    assert.equal(isExtensionAllowedForCategory(extension, "QUOTE_EXCEL"), true, `.${extension}이 막혔다`);
  }
  for (const extension of ["pdf", "jpg", "jpeg", "png", "doc", "docx", "zip", "csv", "txt", "log", "bin", "hex"]) {
    assert.equal(isExtensionAllowedForCategory(extension, "QUOTE_EXCEL"), false, `.${extension}이 통과했다`);
  }
  // 전체 허용목록 밖의 스프레드시트 형식은 막힌다 — 매크로가 든 xlsm 을 따로 열지 않는다.
  for (const extension of ["xlsm", "xlsb", "ods", "exe"]) {
    assert.equal(isExtensionAllowedForCategory(extension, "QUOTE_EXCEL"), false, `.${extension}이 통과했다`);
  }
});

test("webp는 전체 허용목록에 없다 — 스크린샷에 넣지 않은 까닭", () => {
  // 스크린샷에 webp를 더하려면 전체 허용목록부터 넓혀야 하고, 그러면 제한 없는
  // 분류 전부에 함께 열린다. 그 결정 없이 조용히 열리지 않았음을 못 박는다.
  assert.equal(isAllowedExtension("webp"), false);
});

// ────────────────────────────────────────────────── 확장자 정규화

test("확장자는 소문자로 눕는다 — NAS(Linux)에서 대소문자는 다른 파일이다", () => {
  assert.equal(normalizeFileExtension("사진.JPG"), "jpg");
  assert.equal(normalizeFileExtension("REPORT.PdF"), "pdf");
  assert.equal(normalizeFileExtension("archive.tar.GZ"), "gz");
});

test("확장자를 뽑을 수 없는 이름은 null이다", () => {
  for (const name of ["README", "trailing.", ".hidden", "", "   ", "이름.한글확장자", "x.a-b"]) {
    assert.equal(normalizeFileExtension(name), null, name);
  }
});

test("경로 구분자나 '..'가 확장자로 둔갑하지 않는다", () => {
  assert.equal(normalizeFileExtension("evil.jpg/../../etc/passwd"), null);
  assert.equal(normalizeFileExtension("evil.."), null);
  assert.equal(normalizeFileExtension("dir/name"), null);
});

// ────────────────────────────────────────────────────── MIME 판정

test("확장자에 대한 정본 MIME은 서버가 고른다", () => {
  assert.equal(canonicalMimeTypeForExtension("jpg"), "image/jpeg");
  assert.equal(canonicalMimeTypeForExtension("pdf"), "application/pdf");
  assert.equal(canonicalMimeTypeForExtension("zip"), "application/zip");
  assert.equal(canonicalMimeTypeForExtension("exe"), null);
});

test("확장자와 MIME이 어긋나면 호환되지 않는다", () => {
  assert.equal(isExtensionMimeCompatible("png", "image/png"), true);
  assert.equal(isExtensionMimeCompatible("png", "application/pdf"), false);
  assert.equal(isExtensionMimeCompatible("exe", "application/octet-stream"), false);
  assert.deepEqual([...getAllowedMimeTypesForExtension("hex")], ["application/octet-stream", "text/plain"]);
});

test("미리보기 가능 확장자는 jpg/jpeg/png/pdf/txt/csv 6종이다", () => {
  const previewable = ATTACHMENT_EXTENSION_RULES.filter((rule) => rule.previewCapable).map((r) => r.extension);
  assert.deepEqual(previewable, ["jpg", "jpeg", "png", "pdf", "csv", "txt"]);
  assert.equal(isPreviewCapableExtension("log"), false);
});

// ──────────────────────────────── 내용 대조 — 확장자만 바꾼 파일은 통과 못 한다

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_HEADER = new Uint8Array(Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary"));
const ZIP_HEADER = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const OLE2_HEADER = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
const TEXT_HEADER = new Uint8Array(Buffer.from("시각,전압\n0.000,1.23\n", "utf8"));
const WINDOWS_EXE_HEADER = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const ELF_HEADER = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00]);

test("확장자와 실제 내용이 맞으면 통과한다", () => {
  assert.equal(isContentCompatibleWithExtension("jpg", JPEG_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("jpeg", JPEG_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("png", PNG_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("pdf", PDF_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("zip", ZIP_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("xlsx", ZIP_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("docx", ZIP_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("xls", OLE2_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("doc", OLE2_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("csv", TEXT_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("txt", TEXT_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("log", TEXT_HEADER), true);
});

test("이름만 바꾼 실행 파일은 어떤 확장자로도 통과하지 못한다", () => {
  for (const extension of ["jpg", "png", "pdf", "zip", "xlsx", "xls", "csv", "txt", "log", "bin", "hex"]) {
    assert.equal(
      isContentCompatibleWithExtension(extension, WINDOWS_EXE_HEADER),
      false,
      `MZ 실행 파일이 .${extension}으로 통과했다`
    );
    assert.equal(
      isContentCompatibleWithExtension(extension, ELF_HEADER),
      false,
      `ELF 실행 파일이 .${extension}으로 통과했다`
    );
  }
});

test("형식이 다른 파일에 확장자만 붙여도 거부된다", () => {
  assert.equal(isContentCompatibleWithExtension("png", JPEG_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("jpg", PNG_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("pdf", ZIP_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("txt", PNG_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("csv", ZIP_HEADER), false);
});

test("회로도로 올린 사진도 앞머리 바이트 대조를 그대로 받는다", () => {
  // 분류 허용목록은 "이 확장자를 이 분류에 쓸 수 있는가"만 본다. 이름만 .jpg로
  // 바꾼 파일을 막는 것은 여전히 내용 대조 쪽이고, 회로도를 넓히면서 그 관문이
  // 헐거워지지 않았음을 여기서 함께 못 박는다.
  assert.equal(isContentCompatibleWithExtension("jpg", JPEG_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("png", PNG_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("jpg", WINDOWS_EXE_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("png", PDF_HEADER), false);
});

test("견적서 두 칸(결재 PDF · 엑셀)도 앞머리 바이트 대조를 그대로 받는다", () => {
  // 분류 허용목록은 "이 확장자를 이 분류에 쓸 수 있는가"만 본다. 이름만 .pdf/.xlsx 로
  // 바꾼 파일을 막는 것은 여전히 내용 대조 쪽이다.
  assert.equal(isContentCompatibleWithExtension("pdf", PDF_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("pdf", ZIP_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("xlsx", ZIP_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("xlsx", PDF_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("xls", OLE2_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("xlsx", WINDOWS_EXE_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("pdf", WINDOWS_EXE_HEADER), false);
  // 크기 상한은 다른 분류와 같은 20MB 다 — 분류마다 따로 두지 않는다.
  assert.equal(MAX_ATTACHMENT_SIZE_BYTES, 20 * 1024 * 1024);
});

test("허용목록 밖 확장자는 내용이 무엇이든 통과하지 못한다", () => {
  assert.equal(isContentCompatibleWithExtension("exe", TEXT_HEADER), false);
  assert.equal(isContentCompatibleWithExtension("js", TEXT_HEADER), false);
});

test("빈 파일은 통과하지 못한다", () => {
  assert.equal(isContentCompatibleWithExtension("txt", new Uint8Array(0)), false);
  assert.equal(isContentCompatibleWithExtension("bin", new Uint8Array(0)), false);
});

test("펌웨어(bin/hex)는 서명을 요구하지 않는다 — 덤프는 정의상 임의의 바이트다", () => {
  const arbitrary = new Uint8Array([0x12, 0x00, 0xff, 0x7e, 0x00]);
  assert.equal(isContentCompatibleWithExtension("bin", arbitrary), true);
  assert.equal(isContentCompatibleWithExtension("hex", arbitrary), true);
});

test("옛 Office 확장자는 OLE2와 ZIP 둘 다 받는다 — 이름만 바꾼 xlsx가 흔하다", () => {
  assert.equal(isContentCompatibleWithExtension("xls", ZIP_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("doc", ZIP_HEADER), true);
  assert.equal(isContentCompatibleWithExtension("xls", TEXT_HEADER), false);
});

test("대조에 쓰는 앞머리 크기는 PDF 규격(1024바이트)을 담는다", () => {
  assert.equal(CONTENT_SNIFF_BYTES, 1024);
});

// ─────── 통로가 부르는 내용 대조 — 분류까지 함께 본다 (2026-09-30)

test("여느 분류에서는 통로의 내용 대조가 예전 그대로다", () => {
  // isUploadContentCompatible 이 생겼다고 해서 느슨해진 자리가 하나도 없다.
  for (const [extension, header, expected] of [
    ["jpg", JPEG_HEADER, true],
    ["png", JPEG_HEADER, false],
    ["pdf", PDF_HEADER, true],
    ["xlsx", ZIP_HEADER, true],
    ["txt", TEXT_HEADER, true],
    ["jpg", WINDOWS_EXE_HEADER, false],
    // 허용목록 밖은 내용이 무엇이든 거절이다.
    ["hwp", TEXT_HEADER, false],
    ["exe", TEXT_HEADER, false],
  ] as const) {
    // 분류가 무엇이든 — 열리지 않은 분류에서는 예전 함수와 글자 그대로 같은 답이다.
    for (const category of ["CIRCUIT_DIAGRAM", "OTHER", "FIRMWARE", "INTAKE_PHOTO"] as const) {
      assert.equal(isUploadContentCompatible(extension, category, header), expected, `${category} / ${extension}`);
    }
    assert.equal(isContentCompatibleWithExtension(extension, header), expected, `예전 함수 / ${extension}`);
  }
});

test("🔴 모델 기본 자료 셋에서도 이름만 바꾼 실행 파일은 못 들어온다", () => {
  for (const category of ANY_EXTENSION_CATEGORIES) {
    // 허용목록 밖 확장자 — 대조할 서명이 없어 실행 파일 서명만 본다.
    for (const extension of ["hwp", "dwg", "par", "prm"]) {
      assert.equal(isUploadContentCompatible(extension, category, TEXT_HEADER), true, `.${extension}`);
      assert.equal(
        isUploadContentCompatible(extension, category, WINDOWS_EXE_HEADER),
        false,
        `MZ 실행 파일이 .${extension} 으로 통과했다`
      );
      assert.equal(
        isUploadContentCompatible(extension, category, ELF_HEADER),
        false,
        `ELF 실행 파일이 .${extension} 으로 통과했다`
      );
    }
    // 허용목록 **안** 확장자는 앞머리 바이트 대조를 그대로 받는다 — 분류가 열렸다고
    // .pdf 로 이름만 바꾼 파일이 들어오지는 않는다.
    assert.equal(isUploadContentCompatible("pdf", category, PDF_HEADER), true);
    assert.equal(isUploadContentCompatible("pdf", category, ZIP_HEADER), false, "PDF 가 아닌 것이 .pdf 로 통과했다");
    assert.equal(isUploadContentCompatible("png", category, JPEG_HEADER), false);
    assert.equal(isUploadContentCompatible("xlsx", category, WINDOWS_EXE_HEADER), false);
    // 빈 파일은 어느 쪽에서도 통과하지 않는다.
    assert.equal(isUploadContentCompatible("par", category, new Uint8Array(0)), false);
    assert.equal(isUploadContentCompatible("pdf", category, new Uint8Array(0)), false);
  }
});
