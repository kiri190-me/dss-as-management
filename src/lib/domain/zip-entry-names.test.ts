import { test } from "node:test";
import assert from "node:assert/strict";

// 이 함수는 ZIP을 만드는 파일에 함께 있지만 순수 계산이라 여기서 검증한다.
// (그 파일의 나머지는 Blob·TextEncoder가 필요해 브라우저에서만 돈다.)
import { uniqueEntryNames } from "@/components/repair-cases/files/zip-store";

/**
 * ============================================================================
 * ZIP 안에서 같은 이름이 겹치는 문제
 * ============================================================================
 * 폰이 붙이는 사진 이름은 잘 겹친다. 같은 이름 두 개를 그대로 담으면 압축을
 * 푸는 쪽에서 하나가 다른 하나를 덮어쓰거나 경고가 뜬다 — 열 장을 받았는데
 * 아홉 장만 나오는 일이 조용히 생긴다.
 * ============================================================================
 */

test("겹치지 않으면 그대로 둔다", () => {
  assert.deepEqual(uniqueEntryNames(["a.jpg", "b.jpg"]), ["a.jpg", "b.jpg"]);
});

test("겹치면 두 번째부터 번호를 붙인다 — 확장자 앞에 붙인다", () => {
  assert.deepEqual(uniqueEntryNames(["파형.jpg", "파형.jpg", "파형.jpg"]), [
    "파형.jpg",
    "파형 (2).jpg",
    "파형 (3).jpg",
  ]);
});

test("확장자가 없는 이름도 다룬다", () => {
  assert.deepEqual(uniqueEntryNames(["메모", "메모"]), ["메모", "메모 (2)"]);
});

test("점이 여러 개인 이름은 마지막 점만 확장자로 본다", () => {
  assert.deepEqual(uniqueEntryNames(["2026.08.24 파형.jpg", "2026.08.24 파형.jpg"]), [
    "2026.08.24 파형.jpg",
    "2026.08.24 파형 (2).jpg",
  ]);
});

test("서로 다른 이름끼리는 번호가 섞이지 않는다", () => {
  assert.deepEqual(uniqueEntryNames(["a.jpg", "b.jpg", "a.jpg", "b.jpg"]), [
    "a.jpg",
    "b.jpg",
    "a (2).jpg",
    "b (2).jpg",
  ]);
});

test("빈 목록은 빈 목록이다", () => {
  assert.deepEqual(uniqueEntryNames([]), []);
});

test("결과 이름은 서로 달라야 한다 — 이 함수의 존재 이유다", () => {
  const names = uniqueEntryNames(["x.jpg", "x.jpg", "x.jpg", "y.png", "y.png"]);
  assert.equal(new Set(names).size, names.length);
});
