import { test } from "node:test";
import assert from "node:assert/strict";

import type { AttachmentCategory } from "./attachment-category";
import {
  ATTACHMENT_KIND_LABELS,
  DEFAULT_ATTACHMENT_LIST_FILTERS,
  applyAttachmentListFilters,
  attachmentKindOf,
  countByKind,
  hasActiveFilters,
} from "./attachment-list-filters";

/**
 * ============================================================================
 * 걸러 놓고 눌렀는데 안 되는 일이 없어야 한다
 * ============================================================================
 * "사진"으로 걸러 낸 것은 크게 보기와 줄여서 받기가 되는 것과 **같은 범위**여야
 * 한다. 두 판정이 어긋나면 사용자는 사진만 골라 놓고 "줄여서 받기"를 눌렀다가
 * 아무 일도 일어나지 않는 것을 본다.
 *
 * 그 범위는 서버가 화면 안에 그대로 보여 주는 형식(inline)과도 같아야 한다.
 * 셋이 같은 목록이라는 것을 여기서 못박는다.
 * ============================================================================
 */

function item(overrides: Partial<{
  mimeType: string;
  category: AttachmentCategory;
  originalFileName: string;
  description: string | null;
}> = {}) {
  return {
    mimeType: "image/jpeg",
    category: "INTAKE_PHOTO" as AttachmentCategory,
    originalFileName: "파형.jpg",
    description: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────── 종류 판정

test("JPG·PNG는 사진이다", () => {
  assert.equal(attachmentKindOf("image/jpeg"), "image");
  assert.equal(attachmentKindOf("image/png"), "image");
});

test("★ 그 밖은 전부 문서다 — 화면에서 열 수 없는 것을 사진이라 하지 않는다", () => {
  // image/로 시작해도 화면에서 그대로 보여 주지 않는 형식이 있다(SVG는 특히
  // 열면 그 안의 스크립트가 도는 형식이라 서버가 inline으로 내주지 않는다).
  // 그런 것을 "사진"으로 세면 걸러 놓고 눌렀을 때 아무 일도 일어나지 않는다.
  assert.equal(attachmentKindOf("image/svg+xml"), "file");
  assert.equal(attachmentKindOf("application/pdf"), "file");
  assert.equal(attachmentKindOf("application/zip"), "file");
  assert.equal(attachmentKindOf("text/plain"), "file");
  assert.equal(attachmentKindOf(""), "file");
});

test("종류 이름표가 둘 다 있다", () => {
  assert.equal(ATTACHMENT_KIND_LABELS.image, "사진");
  assert.equal(ATTACHMENT_KIND_LABELS.file, "문서");
});

// ─────────────────────────────────────────── 거르기

const SAMPLE = [
  item({ originalFileName: "파형1.jpg", mimeType: "image/jpeg", category: "INTAKE_PHOTO" }),
  item({ originalFileName: "외관.png", mimeType: "image/png", category: "EXTERNAL_CONDITION" }),
  item({ originalFileName: "견적서.pdf", mimeType: "application/pdf", category: "CUSTOMER_DOCUMENT" }),
  item({
    originalFileName: "log_2026.txt",
    mimeType: "text/plain",
    category: "LOG_FILE",
    description: "전원 인가 시 기록",
  }),
];

test("기본 조건은 아무것도 거르지 않는다", () => {
  assert.equal(applyAttachmentListFilters(SAMPLE, DEFAULT_ATTACHMENT_LIST_FILTERS).length, 4);
  assert.equal(hasActiveFilters(DEFAULT_ATTACHMENT_LIST_FILTERS), false);
});

test("종류로 거른다", () => {
  const images = applyAttachmentListFilters(SAMPLE, {
    ...DEFAULT_ATTACHMENT_LIST_FILTERS,
    kind: "image",
  });
  assert.deepEqual(images.map((row) => row.originalFileName), ["파형1.jpg", "외관.png"]);

  const files = applyAttachmentListFilters(SAMPLE, {
    ...DEFAULT_ATTACHMENT_LIST_FILTERS,
    kind: "file",
  });
  assert.deepEqual(files.map((row) => row.originalFileName), ["견적서.pdf", "log_2026.txt"]);
});

test("업무 분류로 거른다", () => {
  const result = applyAttachmentListFilters(SAMPLE, {
    ...DEFAULT_ATTACHMENT_LIST_FILTERS,
    category: "LOG_FILE",
  });
  assert.deepEqual(result.map((row) => row.originalFileName), ["log_2026.txt"]);
});

test("이름으로 찾는다 — 대소문자를 가리지 않는다", () => {
  const result = applyAttachmentListFilters(SAMPLE, {
    ...DEFAULT_ATTACHMENT_LIST_FILTERS,
    query: "LOG",
  });
  assert.deepEqual(result.map((row) => row.originalFileName), ["log_2026.txt"]);
});

test("설명으로도 찾는다 — 폰이 붙인 파일명은 기억에 남지 않는다", () => {
  const result = applyAttachmentListFilters(SAMPLE, {
    ...DEFAULT_ATTACHMENT_LIST_FILTERS,
    query: "전원 인가",
  });
  assert.deepEqual(result.map((row) => row.originalFileName), ["log_2026.txt"]);
});

test("검색어 앞뒤 공백은 무시한다", () => {
  const result = applyAttachmentListFilters(SAMPLE, {
    ...DEFAULT_ATTACHMENT_LIST_FILTERS,
    query: "  외관  ",
  });
  assert.equal(result.length, 1);
});

test("공백만 적은 것은 조건이 아니다", () => {
  assert.equal(
    applyAttachmentListFilters(SAMPLE, { ...DEFAULT_ATTACHMENT_LIST_FILTERS, query: "   " }).length,
    4
  );
  assert.equal(hasActiveFilters({ ...DEFAULT_ATTACHMENT_LIST_FILTERS, query: "   " }), false);
});

test("조건이 겹치면 모두 만족하는 것만 남는다", () => {
  const result = applyAttachmentListFilters(SAMPLE, {
    kind: "image",
    category: "INTAKE_PHOTO",
    query: "파형",
  });
  assert.deepEqual(result.map((row) => row.originalFileName), ["파형1.jpg"]);
});

test("맞는 것이 없으면 빈 목록이다 — 조용히 전부 보여 주지 않는다", () => {
  const result = applyAttachmentListFilters(SAMPLE, {
    ...DEFAULT_ATTACHMENT_LIST_FILTERS,
    query: "있을 리 없는 이름",
  });
  assert.equal(result.length, 0);
});

test("거르는 조건이 켜졌는지 안다", () => {
  assert.equal(hasActiveFilters({ ...DEFAULT_ATTACHMENT_LIST_FILTERS, kind: "image" }), true);
  assert.equal(hasActiveFilters({ ...DEFAULT_ATTACHMENT_LIST_FILTERS, category: "FIRMWARE" }), true);
  assert.equal(hasActiveFilters({ ...DEFAULT_ATTACHMENT_LIST_FILTERS, query: "a" }), true);
});

// ─────────────────────────────────────────── 개수

test("종류별 개수를 센다", () => {
  assert.deepEqual(countByKind(SAMPLE), { image: 2, file: 2 });
});

test("빈 목록도 센다", () => {
  assert.deepEqual(countByKind([]), { image: 0, file: 0 });
});
