import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_TARGET_BYTES,
  SHRINK_RATIO_PRESETS,
  estimateTotalBytes,
  formatBytes,
  parseTargetBytes,
  ratioLabel,
  resolveTargetBytes,
  shrunkFileName,
} from "./image-shrink";

/**
 * ============================================================================
 * 이 파일이 지키려는 것 — "줄였는데 커졌다"
 * ============================================================================
 * 사진을 줄여서 내려받는 기능에서 사용자가 가장 먼저 알아채는 고장은 결과가
 * 목표와 다른 것이다. 특히 **줄이랬는데 커지는 것**은 JPEG를 다시 인코딩할 때
 * 실제로 일어난다 — 이미 많이 압축된 사진을 높은 품질로 다시 저장하면 커진다.
 *
 * 그래서 목표를 정하는 단계에서 원본 크기를 넘지 못하게 막는다. 이 규칙이
 * 깨지면 화면의 "예상 용량"부터 거짓말이 되므로 여기서 못박는다.
 * ============================================================================
 */

// ─────────────────────────────────────────── 목표 용량

test("비율은 원본 대비다 — 50%면 절반", () => {
  assert.equal(resolveTargetBytes({ kind: "ratio", ratio: 0.5 }, 4_000_000), 2_000_000);
  assert.equal(resolveTargetBytes({ kind: "ratio", ratio: 0.25 }, 4_000_000), 1_000_000);
});

test("절대 용량은 원본과 무관하게 그 값이다", () => {
  assert.equal(resolveTargetBytes({ kind: "bytes", bytes: 500 * 1024 }, 4_000_000), 500 * 1024);
});

test("★ 목표가 원본보다 클 수 없다 — 줄이랬는데 커지는 일을 막는다", () => {
  // 이미 400KB인 사진에 "1MB로 맞춰라"를 주면 목표는 400KB다. 그러지 않으면
  // 다시 인코딩해서 화질만 잃고 크기는 늘어난 파일이 나온다.
  const original = 400 * 1024;
  assert.equal(resolveTargetBytes({ kind: "bytes", bytes: 1024 * 1024 }, original), original);
});

test("목표가 너무 작아지지 않는다 — 알아볼 수 없는 사진을 만들지 않는다", () => {
  const target = resolveTargetBytes({ kind: "ratio", ratio: 0.25 }, 40 * 1024);
  assert.equal(target, MIN_TARGET_BYTES, "하한 아래로는 내려가지 않는다");
});

test("하한과 원본 상한이 부딪히면 하한이 이긴다", () => {
  // 원본이 하한보다도 작은 경우. 이때는 줄일 것이 없다는 뜻이고, 실제 인코딩
  // 단계가 원본을 그대로 쓰게 된다.
  const tiny = 5 * 1024;
  assert.equal(resolveTargetBytes({ kind: "ratio", ratio: 0.5 }, tiny), MIN_TARGET_BYTES);
});

// ─────────────────────────────────────────── 예상 합계

test("예상 합계는 장별 목표의 합이다", () => {
  const sizes = [4_000_000, 2_000_000];
  assert.equal(estimateTotalBytes({ kind: "ratio", ratio: 0.5 }, sizes), 3_000_000);
});

test("이미 작은 장은 줄지 않는 것으로 세어, 예상이 실제보다 커지지 않는다", () => {
  // 3MB + 300KB에 "한 장당 1MB" — 뒤 장은 이미 1MB보다 작으므로 그대로다.
  const sizes = [3 * 1024 * 1024, 300 * 1024];
  const estimate = estimateTotalBytes({ kind: "bytes", bytes: 1024 * 1024 }, sizes);
  assert.equal(estimate, 1024 * 1024 + 300 * 1024);
});

test("빈 목록의 예상은 0이다", () => {
  assert.equal(estimateTotalBytes({ kind: "ratio", ratio: 0.5 }, []), 0);
});

// ─────────────────────────────────────────── 파일 이름

test("줄인 파일은 이름이 달라 원본과 섞이지 않는다", () => {
  assert.equal(shrunkFileName("파형.jpg", "50pct"), "파형_50pct.jpg");
});

test("PNG도 확장자가 jpg가 된다 — 줄일 때 JPEG로 바꾸기 때문이다", () => {
  assert.equal(shrunkFileName("외관.png", "25pct"), "외관_25pct.jpg");
});

test("점이 여러 개거나 없는 이름도 다룬다", () => {
  assert.equal(shrunkFileName("2026.08.24 파형.jpg", "75pct"), "2026.08.24 파형_75pct.jpg");
  assert.equal(shrunkFileName("확장자없음", "50pct"), "확장자없음_50pct.jpg");
});

test("숨김 파일처럼 점으로 시작하는 이름을 통째로 날리지 않는다", () => {
  // lastIndexOf(".")가 0이면 확장자가 아니라 이름의 시작이다.
  assert.equal(shrunkFileName(".hidden", "50pct"), ".hidden_50pct.jpg");
});

test("비율 이름표는 퍼센트 정수다", () => {
  assert.equal(ratioLabel(0.25), "25pct");
  assert.equal(ratioLabel(0.9), "90pct");
});

// ─────────────────────────────────────────── 사람이 적은 값

test("적은 용량을 바이트로 바꾼다", () => {
  assert.equal(parseTargetBytes("500", "KB"), 500 * 1024);
  assert.equal(parseTargetBytes("1.5", "MB"), Math.floor(1.5 * 1024 * 1024));
});

test("빈 값·0·음수·글자는 고르지 못하게 null이다", () => {
  assert.equal(parseTargetBytes("", "KB"), null);
  assert.equal(parseTargetBytes("0", "KB"), null);
  assert.equal(parseTargetBytes("-3", "MB"), null);
  assert.equal(parseTargetBytes("오백", "KB"), null);
});

test("앞뒤 공백은 무시한다", () => {
  assert.equal(parseTargetBytes("  200  ", "KB"), 200 * 1024);
});

// ─────────────────────────────────────────── 화면 표시

test("용량 표시는 단위가 바뀌어도 읽을 수 있다", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.00 MB");
});

test("빠른 선택 비율은 전부 0과 1 사이다 — 100%는 줄이지 않는 것이라 넣지 않는다", () => {
  for (const ratio of SHRINK_RATIO_PRESETS) {
    assert.ok(ratio > 0 && ratio < 1, `${ratio}는 범위 밖이다`);
  }
});
