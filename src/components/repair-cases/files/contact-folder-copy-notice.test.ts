import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import DeleteAttachmentDialog from "./DeleteAttachmentDialog";
import {
  CONTACT_FOLDER_COPY_MULTIPLE_TEXT,
  CONTACT_FOLDER_COPY_NO_FOLDER_TEXT,
  contactFolderCopyNotice,
  readContactFolderCopyNote,
  type ContactFolderCopyNote,
} from "./contact-folder-copy-notice";

/**
 * ============================================================================
 * 올린 결과를 **사실대로** 말한다 + 휴지통 확인창의 한 줄 (연락서 조각 6)
 * ============================================================================
 * 꽂기 자체는 lib/storage/contact-folder-copy.test.ts 가, 통로의 차례는
 * app/api/repair-cases/*\/attachments/route-source.test.ts 가 본다. 여기서는 **화면이
 * 무엇을 말하는가**를 본다.
 *
 * 못 박는 것:
 *  · 셋을 **갈라** 말한다 — 넣었다 / 폴더가 없다 / 못 넣었다
 *  · 이름이 바뀌었으면 **그 이름**이 문장에 있다
 *  · 설정이 꺼진 환경(응답에 그 칸이 없다)에서는 **아무 말도 하지 않는다**
 *  · 🔴 공유폴더 줄을 **저장 팝업에 싣지 않는다**(0.5 초 뒤 닫힌다)
 *  · 🔴 휴지통 확인창에 「사본은 그대로 남습니다」가 있다
 * ============================================================================
 */

const filesScreen = readFileSync(new URL("./FilesScreen.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const copied = (fileName: string): ContactFolderCopyNote => ({ status: "copied", fileName });

describe("공유폴더 사본 — 올린 결과를 사실대로 말한다", () => {
  test("넣었다 — 디스크에 쓴 이름을 그대로 보여 준다(번호가 붙었으면 그 이름)", () => {
    assert.deepEqual(contactFolderCopyNotice([copied("IMG_2847.jpg")]), {
      tone: "success",
      text: "공유폴더에도 넣었습니다 — IMG_2847.jpg",
    });
    // 같은 이름이 있어 비켜 간 경우 — 사람이 그 이름으로 찾아야 하므로 반드시 보여 준다.
    const renamed = contactFolderCopyNotice([copied("IMG_2847 (2).jpg")]);
    assert.equal(renamed?.tone, "success");
    assert.ok(renamed?.text.includes("IMG_2847 (2).jpg"), renamed?.text);
  });

  test("이미 같은 파일이 있었다 — 넣었다고 말하지 않는다", () => {
    const notice = contactFolderCopyNotice([{ status: "unchanged", fileName: "IMG_2847.jpg" }]);
    assert.equal(notice?.tone, "success");
    assert.ok(notice?.text.includes("이미 있어"), notice?.text);
    assert.ok(notice?.text.includes("IMG_2847.jpg"), notice?.text);
  });

  test("🔴 폴더가 없다 — [폴더 만들고 열기]로 이끈다", () => {
    const notice = contactFolderCopyNotice([{ status: "no-folder" }]);
    assert.equal(notice?.tone, "error");
    assert.ok(notice?.text.includes("시스템에는 저장했지만"), notice?.text);
    assert.ok(notice?.text.includes(CONTACT_FOLDER_COPY_NO_FOLDER_TEXT), notice?.text);
    assert.ok(CONTACT_FOLDER_COPY_NO_FOLDER_TEXT.includes("[폴더 만들고 열기]"));
  });

  test("🔴 못 넣었다 — 사유를 그대로 전한다(권한 · 연결 · 폴더가 여럿)", () => {
    const failed = contactFolderCopyNotice([{ status: "failed", reason: "공유폴더에 쓸 권한이 없습니다." }]);
    assert.equal(failed?.tone, "error");
    assert.ok(failed?.text.includes("공유폴더에 쓸 권한이 없습니다."), failed?.text);

    const multiple = contactFolderCopyNotice([{ status: "multiple" }]);
    assert.equal(multiple?.tone, "error");
    assert.ok(multiple?.text.includes(CONTACT_FOLDER_COPY_MULTIPLE_TEXT), multiple?.text);
  });

  test("여러 장 — 같은 사유를 한 번만 적고 몇 장이 빠졌는지 센다", () => {
    const notice = contactFolderCopyNotice([
      copied("a.jpg"),
      { status: "no-folder" },
      { status: "no-folder" },
      { status: "failed", reason: "공유폴더에 남은 공간이 없습니다." },
    ]);
    assert.equal(notice?.tone, "error");
    assert.ok(notice?.text.includes("3장은 공유폴더에 넣지 못했습니다"), notice?.text);
    assert.equal(notice?.text.match(/연락서 폴더가 아직 없습니다/g)?.length, 1, notice?.text);
    assert.ok(notice?.text.includes("공유폴더에 남은 공간이 없습니다."), notice?.text);
  });

  test("🔴 설정이 꺼진 환경에서는 아무 말도 하지 않는다 — 올리기 화면이 예전 그대로다", () => {
    assert.equal(contactFolderCopyNotice([]), null);
    // 응답에 그 칸이 없다 · 모르는 모양이다 → null(「넣었습니다」를 지어내지 않는다).
    assert.equal(readContactFolderCopyNote({ id: "a1" }), null);
    assert.equal(readContactFolderCopyNote(null), null);
    assert.equal(readContactFolderCopyNote({ contactFolderCopy: { status: "???" } }), null);
    assert.equal(readContactFolderCopyNote({ contactFolderCopy: { status: "copied" } }), null, "이름 없이 믿었다");
    assert.equal(readContactFolderCopyNote({ contactFolderCopy: { status: "failed" } }), null, "사유 없이 믿었다");
  });

  test("서버가 보낸 칸을 그대로 읽는다", () => {
    assert.deepEqual(readContactFolderCopyNote({ contactFolderCopy: { status: "copied", fileName: "a.jpg" } }), {
      status: "copied",
      fileName: "a.jpg",
    });
    assert.deepEqual(readContactFolderCopyNote({ contactFolderCopy: { status: "no-folder" } }), {
      status: "no-folder",
    });
    assert.deepEqual(readContactFolderCopyNote({ contactFolderCopy: { status: "failed", reason: "느립니다." } }), {
      status: "failed",
      reason: "느립니다.",
    });
  });
});

describe("파일 관리 화면 — 공유폴더 줄을 어디에 내는가", () => {
  test("🔴 저장 팝업이 아니라 화면에 남는 알림 칸으로 간다 — 팝업은 0.5 초 뒤 닫힌다", () => {
    const upload = filesScreen.slice(filesScreen.indexOf("async function handleUpload("));
    const notice = upload.indexOf("contactFolderCopyNotice(contactFolderCopies)");
    const popup = upload.indexOf("showSavePopup({ message");
    assert.ok(notice >= 0, "공유폴더 줄을 만들지 않는다");
    assert.ok(popup >= 0, "저장 팝업이 사라졌다");
    // 팝업에 넘기는 문장에는 공유폴더 줄이 섞이지 않는다.
    assert.ok(upload.includes("showSavePopup({ message, redirectTo: null });"), "팝업에 실었다");
    assert.ok(
      upload.includes("if (copyNotice) setStatusMessage({ type: copyNotice.tone, text: copyNotice.text });"),
      "알림 칸으로 보내지 않는다"
    );
  });

  test("🔴 사본이 실패해도 올리기는 성공으로 센다 — ok 를 뒤집지 않는다", () => {
    const uploadOne = filesScreen.slice(
      filesScreen.indexOf("async function uploadOne("),
      filesScreen.indexOf("function notePickedFiles(")
    );
    assert.ok(uploadOne.includes("readContactFolderCopyNote(created)"), "사본 결과를 읽지 않는다");
    assert.ok(uploadOne.includes("return { ok: true, previewUpload, contactFolderCopy:"), "사본 결과를 안 실어 보낸다");
    // 🔴 응답을 받은 뒤 — 사본 결과를 읽는 그 자리 — 에는 실패로 돌리는 길이 없다.
    const afterResponse = uploadOne.slice(
      uploadOne.indexOf("const created ="),
      uploadOne.indexOf("return { ok: true")
    );
    assert.ok(afterResponse.length > 0, "읽는 자리를 못 찾았다");
    assert.equal(/ok:\s*false/.test(afterResponse), false, "사본 때문에 실패로 돌렸다");
  });
});

describe("휴지통 확인창 — 공유폴더 사본은 그대로 남는다", () => {
  test("🔴 그 한 줄이 늘 보인다 — 앱은 공유폴더의 파일을 지우지 않는다", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteAttachmentDialog, {
        isOpen: true,
        displayName: "IMG_2847.jpg",
        isSubmitting: false,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      })
    );
    assert.ok(
      html.includes("공유폴더에 넣어 둔 사본은 그대로 남습니다 — 필요하면 탐색기에서 직접 지워 주세요."),
      html
    );
    // 예전 문장(되살릴 수 있다)도 그대로 있다 — 더한 것이지 바꾼 것이 아니다.
    assert.ok(html.includes("언제든 복원할 수 있습니다."), html);
  });
});
