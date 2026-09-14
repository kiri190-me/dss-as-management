import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import { IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT } from "@/lib/domain/improvement-request";
import {
  SCREENSHOT_FILE_ACCEPT,
  checkScreenshotFile,
  createdWithScreenshotFailuresText,
  deleteRequestScreenshotNotice,
  isPlaceholderPastedName,
  kstFileStamp,
  nameScreenshotFile,
  pastedScreenshotName,
  pickPastedScreenshots,
  screenScreenshotBatch,
  screenshotBatchNotice,
  screenshotExtensionForMime,
  screenshotFullUrl,
  screenshotRoomLeft,
  screenshotThumbUrl,
  screenshotUploadProgressText,
  screenshotUploadUrl,
  type ClipboardItemLike,
} from "./improvement-request-screenshot-files";

/**
 * ============================================================================
 * 개선 요청 스크린샷 — 고르기 · 이름 짓기 · 사전 검사 · 5장
 * ============================================================================
 * 화면의 편의 판정이다(막는 것은 서버). 그래도 여기가 서버와 다른 말을 하면
 * 사람은 「화면은 받았는데 서버가 거절했다」를 겪는다 — 그래서 수와 형식은 서버와
 * 같은 상수(허용목록 · 20MB · 도메인의 5장)로 대조한다.
 * ============================================================================
 */

const T0 = new Date("2026-09-13T15:04:05.000Z"); // KST 2026-09-14 00:04:05

function clip(kind: string, type: string, file: File | null = null): ClipboardItemLike {
  return { kind, type, getAsFile: () => file };
}

function png(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

// ───────────────────────────── 붙여넣기에서 이미지 고르기

test("이미지만 붙여넣으면 이미지를 고르고, 글자는 없다 — 부르는 쪽이 기본 동작을 막는다", () => {
  const image = png("image.png");
  const plan = pickPastedScreenshots([clip("file", "image/png", image)]);
  assert.deepEqual(plan.images, [image]);
  assert.equal(plan.hasText, false);
});

test("🔴 글자와 이미지가 섞이면 이미지만 고르고 「글자도 있다」를 알린다 — 글자 붙여넣기는 그대로 둔다", () => {
  const image = png("image.png");
  const plan = pickPastedScreenshots([clip("string", "text/plain"), clip("string", "text/html"), clip("file", "image/png", image)]);
  assert.deepEqual(plan.images, [image]);
  assert.equal(plan.hasText, true);
});

test("글자만 붙여넣으면 고를 이미지가 없다", () => {
  const plan = pickPastedScreenshots([clip("string", "text/plain")]);
  assert.deepEqual(plan.images, []);
  assert.equal(plan.hasText, true);
});

test("text/html 만 딸려 온 이미지는 「글자 없음」이다 — textarea 에 들어갈 글자가 없다", () => {
  const plan = pickPastedScreenshots([clip("string", "text/html"), clip("file", "image/png", png("image.png"))]);
  assert.equal(plan.images.length, 1);
  assert.equal(plan.hasText, false);
});

test("png 가 아닌 이미지도 고른다(사전 검사가 까닭과 함께 거절한다), 이미지가 아닌 파일 · 빈 항목은 거른다", () => {
  const gif = new File([new Uint8Array(3)], "image.gif", { type: "image/gif" });
  const pdf = new File([new Uint8Array(3)], "a.pdf", { type: "application/pdf" });
  const plan = pickPastedScreenshots([
    clip("file", "image/gif", gif),
    clip("file", "application/pdf", pdf),
    clip("file", "image/png", null),
  ]);
  assert.deepEqual(plan.images, [gif]);
});

// ───────────────────────────── 이름 짓기

test("KST 도장 — UTC 15시는 다음 날 0시다", () => {
  assert.equal(kstFileStamp(T0), "20260914-000405");
});

test("붙여넣은 이미지의 이름 — 스크린샷-YYYYMMDD-HHmmss-N, 확장자는 MIME 으로", () => {
  assert.equal(pastedScreenshotName("image/png", T0, 1), "스크린샷-20260914-000405-1.png");
  assert.equal(pastedScreenshotName("image/jpeg", T0, 2), "스크린샷-20260914-000405-2.jpg");
  assert.equal(screenshotExtensionForMime("image/gif"), "gif");
  assert.equal(screenshotExtensionForMime(""), "img");
});

test("자리표시 이름(빈 이름 · image.png)만 새로 짓고, 사람이 붙인 이름은 그대로 둔다", () => {
  assert.equal(isPlaceholderPastedName(""), true);
  assert.equal(isPlaceholderPastedName("image.png"), true);
  assert.equal(isPlaceholderPastedName("Image.JPEG"), true);
  assert.equal(isPlaceholderPastedName("화면 캡처.png"), false);

  const renamed = nameScreenshotFile(png("image.png", 7), T0, 3);
  assert.equal(renamed.name, "스크린샷-20260914-000405-3.png");
  assert.equal(renamed.size, 7, "바이트는 그대로다");
  assert.equal(renamed.type, "image/png");

  const unnamed = nameScreenshotFile(new File([new Uint8Array(1)], "", { type: "image/jpeg" }), T0, 1);
  assert.equal(unnamed.name, "스크린샷-20260914-000405-1.jpg");

  const kept = png("화면 캡처.png");
  assert.equal(nameScreenshotFile(kept, T0, 1), kept);
});

// ───────────────────────────── 한 장 사전 검사

test("형식 — png · jpg · jpeg 만(대소문자 무관), 나머지는 까닭과 함께 거절", () => {
  for (const name of ["a.png", "a.jpg", "a.jpeg", "A.PNG", "b.JPG"]) {
    assert.equal(checkScreenshotFile({ name, size: 10 }), null, name);
  }
  for (const name of ["a.gif", "a.webp", "a.pdf", "확장자없음", "a."]) {
    assert.match(checkScreenshotFile({ name, size: 10 }) ?? "", /png · jpg · jpeg/, name);
  }
});

test("빈 파일은 거절한다", () => {
  assert.equal(checkScreenshotFile({ name: "a.png", size: 0 }), "빈 파일");
});

test("🔴 20MB 까지는 받고, 한 바이트라도 넘으면 거절한다 — 서버와 같은 상한", () => {
  assert.equal(MAX_ATTACHMENT_SIZE_BYTES, 20 * 1024 * 1024);
  assert.equal(checkScreenshotFile({ name: "a.png", size: MAX_ATTACHMENT_SIZE_BYTES }), null);
  assert.match(checkScreenshotFile({ name: "a.png", size: MAX_ATTACHMENT_SIZE_BYTES + 1 }) ?? "", /^20MB 초과/);
});

// ───────────────────────────── 5장

test("🔴 5장을 넘는 것은 받지 않고 몇 장을 못 넣었는지 센다", () => {
  assert.equal(IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT, 5);
  const seven = Array.from({ length: 7 }, (_, index) => png(`s${index}.png`));
  const fresh = screenScreenshotBatch(seven, 0);
  assert.deepEqual(
    fresh.accepted.map((file) => file.name),
    ["s0.png", "s1.png", "s2.png", "s3.png", "s4.png"],
    "고른 차례대로 앞에서부터 받는다"
  );
  assert.equal(fresh.overflowCount, 2);

  const partly = screenScreenshotBatch(seven.slice(0, 4), 3);
  assert.equal(partly.accepted.length, 2);
  assert.equal(partly.overflowCount, 2);

  const full = screenScreenshotBatch([png("x.png")], 5);
  assert.equal(full.accepted.length, 0);
  assert.equal(full.overflowCount, 1);
  assert.equal(screenshotRoomLeft(5), 0);
  assert.equal(screenshotRoomLeft(7), 0, "이미 넘친 수가 와도 음수가 되지 않는다");
});

test("🔴 틀린 장만 거절하고 나머지는 받는다 — 틀린 장은 자리를 차지하지 않는다", () => {
  const batch = screenScreenshotBatch(
    [png("bad.gif"), png("empty.png", 0), ...Array.from({ length: 5 }, (_, index) => png(`ok${index}.png`))],
    0
  );
  assert.equal(batch.accepted.length, 5);
  assert.equal(batch.overflowCount, 0);
  assert.deepEqual(
    batch.rejected.map((rejection) => rejection.fileName),
    ["bad.gif", "empty.png"]
  );
});

test("받지 못한 것을 한 문장으로 — 다 받았으면 null", () => {
  assert.equal(screenshotBatchNotice({ rejected: [], overflowCount: 0 }), null);
  const text = screenshotBatchNotice({ rejected: [{ fileName: "bad.gif", reason: "형식" }], overflowCount: 2 }) ?? "";
  assert.ok(text.includes("bad.gif: 형식"), text);
  assert.ok(text.includes("5장까지"), text);
  assert.ok(text.includes("2장은 넣지 못했습니다"), text);
});

// ───────────────────────────── 문구 · 주소

test("진행 · 일부 실패 · 글 지우기 문구", () => {
  assert.equal(screenshotUploadProgressText(2, 3), "스크린샷 올리는 중 2/3…");
  assert.equal(
    createdWithScreenshotFailuresText(3, [
      { fileName: "a.png", reason: "파일이 20MB를 넘습니다." },
      { fileName: "b.png", reason: "네트워크 문제" },
    ]),
    "글은 등록됐습니다. 스크린샷 3장 중 2장을 올리지 못했습니다 — a.png: 파일이 20MB를 넘습니다 · b.png: 네트워크 문제. 목록의 [스크린샷 추가]로 다시 붙일 수 있습니다."
  );
  assert.equal(deleteRequestScreenshotNotice(0), null);
  assert.equal(deleteRequestScreenshotNotice(3), "붙은 스크린샷 3장은 첨부 휴지통으로 옮겨집니다.");
});

test("주소 — 썸네일은 view=thumb, 크게 보기는 view=full, 올리기는 이름을 쿼리로", () => {
  assert.equal(screenshotThumbUrl("att-1"), "/api/attachments/att-1/download?view=thumb");
  assert.equal(screenshotFullUrl("att-1"), "/api/attachments/att-1/download?view=full");
  const upload = screenshotUploadUrl("req-1", "스크린샷 1.png");
  assert.ok(upload.startsWith("/api/improvement-requests/req-1/attachments?fileName="), upload);
  assert.equal(new URL(upload, "http://x").searchParams.get("fileName"), "스크린샷 1.png");
  assert.equal(SCREENSHOT_FILE_ACCEPT, "image/png,image/jpeg");
});
