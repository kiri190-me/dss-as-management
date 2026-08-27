import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTACHMENT_EXTENSION_RULES,
  CATEGORY_EXTENSION_ALLOWLIST,
  CONTENT_SNIFF_BYTES,
  MAX_ATTACHMENT_SIZE_BYTES,
  canonicalMimeTypeForExtension,
  getAllowedMimeTypesForExtension,
  isAllowedExtension,
  isContentCompatibleWithExtension,
  isExtensionAllowedForCategory,
  isExtensionMimeCompatible,
  isPreviewCapableExtension,
  normalizeFileExtension,
} from "./attachment-allowlist";
import {
  ATTACHMENT_EXTENSION_RULES as DEMO_EXTENSION_RULES,
  CATEGORY_EXTENSION_ALLOWLIST as DEMO_CATEGORY_ALLOWLIST,
  MAX_ATTACHMENT_SIZE_BYTES as DEMO_MAX_ATTACHMENT_SIZE_BYTES,
} from "./local/attachments/allowlist";
import { ATTACHMENT_CATEGORY_CODES } from "./attachment-category";

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

test("분류별 확장자 제한이 데모 파일과 같다", () => {
  assert.deepEqual(CATEGORY_EXTENSION_ALLOWLIST, DEMO_CATEGORY_ALLOWLIST);
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

test("제한이 없는 분류는 허용목록 전체를 쓸 수 있다", () => {
  const unrestricted = ATTACHMENT_CATEGORY_CODES.filter((code) => !(code in CATEGORY_EXTENSION_ALLOWLIST));
  assert.ok(unrestricted.length > 0, "비교 대상이 있어야 한다");
  for (const category of unrestricted) {
    assert.equal(isExtensionAllowedForCategory("pdf", category), true);
    assert.equal(isExtensionAllowedForCategory("exe", category), false);
  }
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
