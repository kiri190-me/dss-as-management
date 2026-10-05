import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_TARGET_BYTES,
  SHRINK_RATIO_PRESETS,
  averagePerImageBytes,
  estimateTotalBytes,
  formatBytes,
  isShrinkLabel,
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

// ─────────────────────────────────────────── 한 장 평균(화면이 읽히는 방식)

/**
 * 여기부터는 **계산이 아니라 읽히는 방식**을 지킨다(2026-09-29).
 *
 * 목표는 처음부터 한 장 기준이었는데 화면이 합계만 보여 주어 "총합 기준"으로
 * 읽혔다. 화면이 평균을 앞세우게 바꿨고, 그 나누기는 여기 한 함수가 한다.
 */

test("한 장 평균은 합계를 장수로 나눈 값이다", () => {
  assert.equal(averagePerImageBytes(3 * 1024 * 1024, 3), 1024 * 1024);
  assert.equal(averagePerImageBytes(1_500_000, 2), 750_000);
});

test("★ 0장이면 0이다 — 0으로 나누기를 화면마다 따로 막지 않게 한다", () => {
  // 화면에서 직접 나누면 자리마다 "0장인가"를 붙여야 하고 한 곳이 반드시 빠진다.
  // 빠진 자리에는 NaN 이 떠서 사용자에게는 "용량을 못 읽는다"로 보인다.
  assert.equal(averagePerImageBytes(0, 0), 0);
  assert.equal(averagePerImageBytes(1234, 0), 0);
  assert.equal(averagePerImageBytes(1234, -1), 0, "음수 장수도 0이다");
  assert.equal(averagePerImageBytes(1234, Number.NaN), 0, "장수가 NaN 이어도 숫자를 돌려준다");
});

test("나누어떨어지지 않으면 반올림한다 — 바이트라 표시에만 쓴다", () => {
  assert.equal(averagePerImageBytes(1000, 3), 333);
  assert.equal(averagePerImageBytes(1001, 3), 334);
});

test("★ 장수가 늘어도 한 장당 목표는 그대로다 — 목표는 합계 기준이 아니다", () => {
  // 사용자가 "총합 기준 아니냐"고 읽은 자리가 바로 여기다. 한 장당 500KB 를
  // 고르고 3장을 고르면 예상이 1.46MB 로 뜨는데, 그것은 500KB×3 이지
  // "전부 합쳐 500KB"가 아니다. 평균으로 되돌리면 다시 500KB 가 나온다.
  const target = { kind: "bytes", bytes: 500 * 1024 } as const;
  const one = estimateTotalBytes(target, [4_000_000]);
  const three = estimateTotalBytes(target, [4_000_000, 4_000_000, 4_000_000]);

  assert.equal(one, 500 * 1024);
  assert.equal(three, 3 * 500 * 1024);
  assert.equal(averagePerImageBytes(three, 3), 500 * 1024, "한 장 평균이 곧 한 장당 목표다");
});

test("비율도 마찬가지다 — 한 장 평균은 원본 한 장 평균의 그 비율이다", () => {
  const sizes = [4_000_000, 2_000_000];
  const originalAverage = averagePerImageBytes(6_000_000, sizes.length);
  const estimate = estimateTotalBytes({ kind: "ratio", ratio: 0.5 }, sizes);

  assert.equal(originalAverage, 3_000_000);
  assert.equal(averagePerImageBytes(estimate, sizes.length), 1_500_000);
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

// ─────────────────────────── 줄임 이름표가 서버로 간다 (연락서 조각 12)

test("화면이 만드는 이름표는 전부 통과한다 — 비율 · 목표 용량", () => {
  for (const ratio of SHRINK_RATIO_PRESETS) {
    assert.ok(isShrinkLabel(ratioLabel(ratio)), `${ratioLabel(ratio)} 가 막혔다`);
  }
  // 목표 용량 쪽은 사람이 적은 숫자 + 고른 단위가 그대로 붙는다(ShrinkDownloadDialog).
  for (const label of ["500KB", "1MB", "1.5MB", "10pct", "95pct"]) {
    assert.ok(isShrinkLabel(label), `${label} 가 막혔다`);
  }
});

test("🔴 뜻 없는 꼬리는 막는다 — 파일 이름이 되는 값이다", () => {
  for (const label of [
    "",
    "   ",
    "pct",
    "50",
    "50%",
    "50pct ",
    "50pct.jpg",
    "../../etc",
    "50pct/..",
    String.raw`50pct\x`,
    "5e3KB",
    "-50pct",
    "50gb",
    "50KB50KB",
    "1234567pct",
  ]) {
    assert.equal(isShrinkLabel(label), false, `${JSON.stringify(label)} 가 통과했다`);
  }
  // 글자가 아닌 값도 막는다 — 쿼리 문자열 밖에서 불릴 수 있다.
  for (const value of [null, undefined, 50, {}, ["50pct"]]) {
    assert.equal(isShrinkLabel(value), false, `${JSON.stringify(value)} 가 통과했다`);
  }
});

test("통과한 이름표는 줄여받기와 **같은 이름**을 만든다", () => {
  const label = ratioLabel(0.5);
  assert.ok(isShrinkLabel(label));
  assert.equal(shrunkFileName("IMG_2847.jpg", label), "IMG_2847_50pct.jpg");
  // PNG 도 줄이면 JPEG 라 확장자가 바뀐다(줄여받기와 같다).
  assert.equal(shrunkFileName("파형.png", "500KB"), "파형_500KB.jpg");
});
