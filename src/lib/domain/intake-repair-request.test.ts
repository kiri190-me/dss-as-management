import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_ATTACHMENT_SIZE_BYTES, canonicalMimeTypeForExtension } from "./attachment-allowlist";
import { attachmentCategoryLabels } from "./attachment-category";
import { contactFolderCategoryFolderName } from "./contact-folder-naming";
import {
  INTAKE_REPAIR_REQUEST_CATEGORY,
  INTAKE_REPAIR_REQUEST_MAX_FILE_NAME_LENGTH,
  checkIntakeRepairRequestFile,
} from "./intake-repair-request";

/*
 * ============================================================================
 * 접수와 함께 올라온 수리 의뢰서 — 받아도 되는 파일인가 (2026-10-19)
 * ============================================================================
 * 🔴 여기서 못 박는 것은 **잣대를 새로 짓지 않았다**는 사실이다. 크기 상한 ·
 * 허용목록 · 앞머리 바이트 대조가 [파일 관리] 올리기 통로와 **같은 값**이어야
 * 한다 — 한 벌을 더 지으면 느슨한 쪽이 곧 구멍이 된다.
 *
 * 그리고 🔴 **브라우저가 보낸 형식을 믿지 않는다**: 이 함수는 MIME 을 **받지도
 * 않고**, 내놓는 MIME 은 확장자에서 서버가 고른 정본이다.
 * ============================================================================
 */

function pdf(extra = ""): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${extra}`);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
/** 윈도 실행체의 앞머리(MZ) — 이름만 바꿔 들어오는 길이 있으면 안 된다. */
const WINDOWS_EXECUTABLE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);

describe("수리 의뢰서 — 받는 경우", () => {
  test("PDF 를 받는다 — 🔴 MIME 은 **확장자에서 서버가 고른 정본**이다", () => {
    const checked = checkIntakeRepairRequestFile({ fileName: "수리의뢰서.pdf", bytes: pdf() });
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.equal(checked.extension, "pdf");
    assert.equal(checked.fileName, "수리의뢰서.pdf");
    // 🔴 브라우저가 보낸 Content-Type 을 받는 칸 자체가 없다 — 정본은 여기서 나온다.
    assert.equal(checked.mimeType, canonicalMimeTypeForExtension("pdf"));
    assert.equal(checked.mimeType, "application/pdf");
  });

  test("사진(PNG) · 엑셀 · 한글 이름도 받는다 — 좁히지 않았다", () => {
    const png = checkIntakeRepairRequestFile({ fileName: "의뢰서 사진.png", bytes: PNG });
    assert.equal(png.ok, true);
    const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const xlsx = checkIntakeRepairRequestFile({ fileName: "의뢰서.xlsx", bytes: zipHeader });
    assert.equal(xlsx.ok, true);
  });

  test("앞뒤 공백은 다듬어 돌려준다 — 공유폴더에 그 이름으로 꽂힌다", () => {
    const checked = checkIntakeRepairRequestFile({ fileName: "  의뢰서.pdf  ", bytes: pdf() });
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.equal(checked.fileName, "의뢰서.pdf");
  });

  test("상한 **그 크기까지는** 받는다 — 경계에서 한 바이트 차이로 갈리지 않게", () => {
    const bytes = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES);
    bytes.set(pdf(), 0);
    assert.equal(checkIntakeRepairRequestFile({ fileName: "큰의뢰서.pdf", bytes }).ok, true);
  });
});

describe("수리 의뢰서 — 되돌려 보내는 경우", () => {
  test("🔴 20MB 를 넘으면 거절한다 — 첨부와 같은 상한이다", () => {
    const bytes = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1);
    bytes.set(pdf(), 0);
    const checked = checkIntakeRepairRequestFile({ fileName: "큰의뢰서.pdf", bytes });
    assert.equal(checked.ok, false);
    if (checked.ok) return;
    assert.ok(checked.message.includes("20MB"), "상한을 사람 말로 알리지 않는다");
  });

  test("🔴 이름만 바꾼 실행 파일을 받지 않는다 — 앞머리 바이트를 본다", () => {
    const checked = checkIntakeRepairRequestFile({ fileName: "의뢰서.pdf", bytes: WINDOWS_EXECUTABLE });
    assert.equal(checked.ok, false);
    if (checked.ok) return;
    assert.ok(checked.message.includes("이름만 바꾼"), "무엇이 문제인지 알려 주지 않는다");
  });

  test("🔴 허용목록 밖 확장자를 받지 않는다 — 이 분류는 형식을 안 가리는 셋이 아니다", () => {
    for (const fileName of ["의뢰서.exe", "의뢰서.hwp", "의뢰서.xlsm", "의뢰서"]) {
      const checked = checkIntakeRepairRequestFile({ fileName, bytes: pdf() });
      assert.equal(checked.ok, false, `${fileName} 가 통과했다`);
    }
  });

  test("빈 파일 · 빈 이름 · 너무 긴 이름을 받지 않는다", () => {
    assert.equal(checkIntakeRepairRequestFile({ fileName: "의뢰서.pdf", bytes: new Uint8Array(0) }).ok, false);
    assert.equal(checkIntakeRepairRequestFile({ fileName: "   ", bytes: pdf() }).ok, false);
    const longName = `${"가".repeat(INTAKE_REPAIR_REQUEST_MAX_FILE_NAME_LENGTH)}.pdf`;
    assert.equal(checkIntakeRepairRequestFile({ fileName: longName, bytes: pdf() }).ok, false);
  });

  test("🔴 거절 문구에 경로 · 루트가 없다 — 그대로 접수 화면에 뜬다", () => {
    const messages = [
      checkIntakeRepairRequestFile({ fileName: "의뢰서.exe", bytes: pdf() }),
      checkIntakeRepairRequestFile({ fileName: "의뢰서.pdf", bytes: WINDOWS_EXECUTABLE }),
      checkIntakeRepairRequestFile({ fileName: "의뢰서.pdf", bytes: new Uint8Array(0) }),
    ].map((checked) => (checked.ok ? "" : checked.message));
    for (const message of messages) {
      for (const forbidden of ["\\", "/", "UPLOADS_DIR", "CONTACT_FOLDER_ARCHIVE_DIR", "C:"]) {
        assert.equal(message.includes(forbidden), false, `사유에 ${forbidden} 가 들어간다`);
      }
    }
  });
});

describe("수리 의뢰서 — 연락서 폴더의 자리", () => {
  test("🔴 들어갈 폴더 이름은 **분류 이름표**에서 나온다 — 글자로 박지 않는다", () => {
    // 🔴 「수리 의뢰서」라고 적어 굳히지 않는다. 이름표가 바뀌면 폴더도 함께 바뀌어야
    //    하고, 글자로 박으면 그날 폴더가 둘로 갈린다.
    assert.equal(
      contactFolderCategoryFolderName(INTAKE_REPAIR_REQUEST_CATEGORY),
      attachmentCategoryLabels[INTAKE_REPAIR_REQUEST_CATEGORY],
      "분류 이름표와 폴더 이름이 어긋난다"
    );
    assert.notEqual(contactFolderCategoryFolderName(INTAKE_REPAIR_REQUEST_CATEGORY), null, "폴더 이름이 없다");
  });
});
