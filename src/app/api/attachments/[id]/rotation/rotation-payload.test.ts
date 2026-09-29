import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MAX_ATTACHMENT_PREVIEW_BYTES } from "@/lib/domain/attachment-allowlist";
import {
  ROTATION_SUPPORTED_MIME_TYPES,
  checkRotationPayload,
  checkRotationTarget,
  parseRotationRequest,
  storedExtensionOf,
} from "./rotation-payload";

/**
 * ============================================================================
 * 원본을 덮어쓰기 전에 무엇을 거르는가
 * ============================================================================
 * 🔴 이 통로는 되돌릴 수 없는 일을 한다. 그래서 「무엇을 받아 주는가」보다
 * **「무엇을 거절하는가」**가 이 시험의 중심이다.
 *
 * 판정이 route.ts 가 아니라 형제 파일에 있는 까닭은 download/inline-view.ts 와
 * 같다 — Next 는 route.ts 에서 정해진 이름 말고 다른 export 를 금지한다.
 * ============================================================================
 */

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
const WINDOWS_EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]);

function params(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

// ────────────────────────────────────────────── 인자

describe("주소의 인자", () => {
  test("방향과 경계를 읽는다", () => {
    const parsed = parseRotationRequest(params({ rotate: "90", flipX: "1", flipY: "0", previewBytes: "1234" }));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.request.orientation, { rotate: 90, flipX: true, flipY: false });
    assert.equal(parsed.request.previewBytes, 1234);
  });

  test("🔴 돌린 것이 없으면 거절한다 — 그대로인 원본을 다시 인코딩하지 않는다", () => {
    const parsed = parseRotationRequest(params({ rotate: "0", flipX: "0", flipY: "0", previewBytes: "10" }));
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.rejection.code, "NO_CHANGE");
    assert.equal(parsed.rejection.status, 400);
  });

  test("🔴 알아볼 수 없는 방향은 짐작하지 않는다", () => {
    for (const rotate of ["45", "-90", "", "ninety"]) {
      const parsed = parseRotationRequest(params({ rotate, previewBytes: "10" }));
      assert.equal(parsed.ok, false, `rotate=${rotate} 가 통과했다`);
      if (parsed.ok) continue;
      assert.equal(parsed.rejection.code, "INVALID_ORIENTATION");
    }
  });

  test("경계가 없거나 0 이거나 숫자가 아니면 거절한다", () => {
    for (const previewBytes of ["", "0", "-5", "12.5", "1e3", "abc"]) {
      const parsed = parseRotationRequest(params({ rotate: "90", previewBytes }));
      assert.equal(parsed.ok, false, `previewBytes=${previewBytes} 가 통과했다`);
      if (parsed.ok) continue;
      assert.equal(parsed.rejection.code, "INVALID_PREVIEW_SIZE");
    }
  });

  test("썸네일이라고 보낸 것이 상한을 넘으면 413 이다 — 원본을 한 벌 더 쌓는 자리가 아니다", () => {
    const parsed = parseRotationRequest(
      params({ rotate: "90", previewBytes: String(MAX_ATTACHMENT_PREVIEW_BYTES + 1) })
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.rejection.code, "PREVIEW_TOO_LARGE");
    assert.equal(parsed.rejection.status, 413);
  });
});

// ────────────────────────────────────────────── 이 첨부를 돌릴 수 있는가

describe("돌릴 수 있는 첨부인가 — 본문을 받기 전에 답이 난다", () => {
  test("사진 둘만 받는다", () => {
    assert.deepEqual([...ROTATION_SUPPORTED_MIME_TYPES].sort(), ["image/jpeg", "image/png"]);
  });

  test("🔴 PDF · 엑셀 · 압축은 여기서 끝난다", () => {
    for (const [mimeType, storedPath] of [
      ["application/pdf", "repair-cases/c/a.pdf"],
      ["application/zip", "repair-cases/c/a.zip"],
      ["text/plain", "repair-cases/c/a.txt"],
      ["application/vnd.ms-excel", "repair-cases/c/a.xls"],
    ] as const) {
      const checked = checkRotationTarget({ mimeType, storedPath });
      assert.equal(checked.ok, false, `${mimeType} 이 통과했다`);
      if (checked.ok) continue;
      assert.equal(checked.rejection.code, "NOT_AN_IMAGE");
    }
  });

  test("사진이면 저장 경로의 확장자를 함께 준다", () => {
    const jpg = checkRotationTarget({ mimeType: "image/jpeg", storedPath: "repair-cases/c/a.jpg" });
    assert.deepEqual(jpg, { ok: true, extension: "jpg" });
    const png = checkRotationTarget({
      mimeType: "image/png",
      storedPath: "product-models/m/a.png",
    });
    assert.deepEqual(png, { ok: true, extension: "png" });
    // .jpeg 도 image/jpeg 다 — 허용목록이 그렇게 적고 있다.
    const jpeg = checkRotationTarget({ mimeType: "image/jpeg", storedPath: "quotes/q/a.jpeg" });
    assert.deepEqual(jpeg, { ok: true, extension: "jpeg" });
  });

  test("🔴 행의 확장자와 mime 이 어긋나면 덮어쓰지 않는다", () => {
    // 정상 경로로는 생기지 않는 행이다(올리기가 확장자에서 mime 을 고른다).
    // 그런 행을 덮어쓰면 무엇이 저장되는지 아무도 답할 수 없다.
    const checked = checkRotationTarget({ mimeType: "image/png", storedPath: "repair-cases/c/a.jpg" });
    assert.equal(checked.ok, false);
    if (checked.ok) return;
    assert.equal(checked.rejection.code, "UNSUPPORTED_FILE");
  });

  test("거절 문장에 저장 경로가 실리지 않는다", () => {
    const checked = checkRotationTarget({
      mimeType: "image/png",
      storedPath: "repair-cases/비밀-건/a.jpg",
    });
    assert.equal(checked.ok, false);
    if (checked.ok) return;
    assert.ok(!checked.rejection.message.includes("repair-cases"), checked.rejection.message);
    assert.ok(!checked.rejection.message.includes("비밀"), checked.rejection.message);
  });

  test("저장 경로에서 마지막 마디의 확장자만 읽는다", () => {
    assert.equal(storedExtensionOf("repair-cases/c/a.jpg"), "jpg");
    assert.equal(storedExtensionOf("repair-cases/c/a.preview.jpg"), "jpg");
    assert.equal(storedExtensionOf("repair-cases/c.d/noext"), null);
  });
});

// ────────────────────────────────────────────── 받은 바이트

function payload(overrides: {
  extension?: string;
  declaredPreviewBytes?: number;
  preview?: { size: number; header: Uint8Array };
  original?: { size: number; header: Uint8Array };
}) {
  return checkRotationPayload({
    extension: overrides.extension ?? "jpg",
    declaredPreviewBytes: overrides.declaredPreviewBytes ?? 6,
    preview: overrides.preview ?? { size: 6, header: JPEG },
    original: overrides.original ?? { size: 64, header: JPEG },
  });
}

describe("🔴 받은 것이 정말 사진인가 — 확장자가 아니라 앞머리로 판정한다", () => {
  test("둘 다 제 형식이면 통과다", () => {
    assert.equal(payload({}), null);
    assert.equal(payload({ extension: "png", original: { size: 64, header: PNG } }), null);
    assert.equal(payload({ extension: "jpeg" }), null);
  });

  test("🔴 사진이 아닌 것을 원본 자리로 보내면 거절한다", () => {
    for (const [name, header] of [
      ["압축", ZIP],
      ["PDF", PDF],
      ["실행 파일", WINDOWS_EXE],
    ] as const) {
      const rejection = payload({ original: { size: 64, header } });
      assert.ok(rejection, `${name} 이(가) 원본 자리로 통과했다`);
      assert.equal(rejection.code, "CONTENT_MISMATCH");
      assert.equal(rejection.status, 415);
    }
  });

  test("🔴 형식을 바꿔 보내도 거절한다 — PNG 원본 자리에 JPEG 는 들어가지 않는다", () => {
    const rejection = payload({ extension: "png", original: { size: 64, header: JPEG } });
    assert.ok(rejection);
    assert.equal(rejection.code, "CONTENT_MISMATCH");
    // 반대 방향도 막힌다.
    const other = payload({ extension: "jpg", original: { size: 64, header: PNG } });
    assert.ok(other);
    assert.equal(other.code, "CONTENT_MISMATCH");
  });

  test("🔴 썸네일 자리에 사진이 아닌 것을 보내도 거절한다 — 썸네일은 언제나 JPEG 다", () => {
    for (const header of [PNG, ZIP, PDF, WINDOWS_EXE]) {
      const rejection = payload({ preview: { size: 6, header } });
      assert.ok(rejection, "썸네일 자리가 열려 있다");
      assert.equal(rejection.code, "PREVIEW_CONTENT_MISMATCH");
    }
  });

  test("빈 덩어리는 거절한다", () => {
    assert.equal(payload({ preview: { size: 0, header: JPEG } })?.code, "EMPTY_BODY");
    assert.equal(payload({ original: { size: 0, header: JPEG } })?.code, "EMPTY_BODY");
  });

  test("🔴 본문이 도중에 끊기면 거절한다 — 원본 앞에 썸네일 꼬리가 붙는 길을 막는다", () => {
    const rejection = payload({ declaredPreviewBytes: 100, preview: { size: 6, header: JPEG } });
    assert.ok(rejection);
    assert.equal(rejection.code, "PAYLOAD_TRUNCATED");
    assert.equal(rejection.status, 400);
  });
});
