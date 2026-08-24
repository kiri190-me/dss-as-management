import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DIGITAL_ZOOM_RANGE,
  clampZoom,
  digitalCropRect,
  formatZoom,
  isZoomAtPreset,
  zoomFromPinch,
  zoomPresets,
  type ZoomRange,
} from "./camera-zoom";

/**
 * ============================================================================
 * 이 파일이 지키려는 것 — "화면에는 크게 보였는데 사진은 광각"
 * ============================================================================
 * 디지털 줌은 미리보기 확대와 촬영 잘라내기, 두 곳이 같은 배율로 움직여야
 * 성립한다. 한쪽만 움직여도 화면은 멀쩡해 보이고 타입·빌드도 전부 통과한다.
 * 어긋남은 현장에서 다 찍고 돌아와 파일을 열어 봐야 드러나고, 그때는 다시
 * 찍으러 갈 수 없다.
 *
 * 그래서 잘라내기 사각형이 **배율 1에서 원본 전체와 같은지**, 그리고 어떤
 * 배율에서도 **영상 밖으로 나가지 않는지**를 여기서 못박는다.
 * ============================================================================
 */

const HARDWARE: ZoomRange = { min: 1, max: 8 };
const WIDE: ZoomRange = { min: 0.5, max: 10 };

// ─────────────────────────────────────────── 범위 자르기

test("범위 밖 배율은 잘린다", () => {
  assert.equal(clampZoom(0.1, DIGITAL_ZOOM_RANGE), 1);
  assert.equal(clampZoom(99, DIGITAL_ZOOM_RANGE), 4);
});

test("경계값 자체는 통과한다 — 최대 배율을 못 쓰면 버튼이 하나 죽는다", () => {
  assert.equal(clampZoom(1, DIGITAL_ZOOM_RANGE), 1);
  assert.equal(clampZoom(4, DIGITAL_ZOOM_RANGE), 4);
  assert.equal(clampZoom(0.5, WIDE), 0.5);
  assert.equal(clampZoom(10, WIDE), 10);
});

test("NaN·Infinity는 최소 배율로 되돌린다 — 배율에 들어가면 촬영까지 무너진다", () => {
  assert.equal(clampZoom(Number.NaN, DIGITAL_ZOOM_RANGE), 1);
  assert.equal(clampZoom(Number.POSITIVE_INFINITY, WIDE), 0.5);
  assert.equal(clampZoom(Number.NEGATIVE_INFINITY, WIDE), 0.5);
});

// ─────────────────────────────────────────── 핀치

test("손가락을 두 배로 벌리면 두 배로 당겨진다", () => {
  assert.equal(zoomFromPinch(1, 100, 200, HARDWARE), 2);
  assert.equal(zoomFromPinch(2, 100, 200, HARDWARE), 4);
});

test("오므리면 되돌아온다", () => {
  assert.equal(zoomFromPinch(4, 200, 100, HARDWARE), 2);
});

test("시작과 같은 거리면 배율이 그대로다 — 손을 두면 흐르지 않는다", () => {
  assert.equal(zoomFromPinch(2.5, 137, 137, HARDWARE), 2.5);
});

test("★ 거리가 0이면 시작 배율 그대로다 — 0으로 나누지 않는다", () => {
  assert.equal(zoomFromPinch(3, 0, 120, HARDWARE), 3);
  assert.equal(zoomFromPinch(3, 120, 0, HARDWARE), 3);
  assert.equal(zoomFromPinch(3, 0, 0, HARDWARE), 3);
});

test("음수 거리·NaN 거리에도 터지지 않는다", () => {
  assert.equal(zoomFromPinch(2, -100, 200, HARDWARE), 2);
  assert.equal(zoomFromPinch(2, 100, -200, HARDWARE), 2);
  assert.equal(zoomFromPinch(2, Number.NaN, 200, HARDWARE), 2);
  assert.equal(zoomFromPinch(2, 100, Number.NaN, HARDWARE), 2);
});

test("핀치로도 범위를 넘지 못한다", () => {
  assert.equal(zoomFromPinch(4, 10, 1000, DIGITAL_ZOOM_RANGE), 4);
  assert.equal(zoomFromPinch(2, 1000, 1, DIGITAL_ZOOM_RANGE), 1);
});

test("시작 배율이 범위 밖이어도 결과는 범위 안이다", () => {
  const zoom = zoomFromPinch(50, 100, 110, DIGITAL_ZOOM_RANGE);
  assert.ok(zoom >= DIGITAL_ZOOM_RANGE.min && zoom <= DIGITAL_ZOOM_RANGE.max);
});

// ─────────────────────────────────────────── 배율 버튼

test("★ 1배 버튼은 언제나 있다 — 되돌릴 길이 없으면 카메라를 껐다 켜야 한다", () => {
  assert.ok(zoomPresets(DIGITAL_ZOOM_RANGE).includes(1));
  assert.ok(zoomPresets(HARDWARE).includes(1));
  assert.ok(zoomPresets(WIDE).includes(1));
});

test("범위 밖 배율은 버튼으로 나가지 않는다 — 눌러도 안 되면 고장으로 보인다", () => {
  for (const range of [DIGITAL_ZOOM_RANGE, HARDWARE, WIDE]) {
    for (const preset of zoomPresets(range)) {
      assert.ok(
        preset >= range.min && preset <= range.max,
        `${preset}는 ${range.min}~${range.max} 밖이다`
      );
    }
  }
});

test("초광각을 내주는 기기에서만 0.5x가 보인다", () => {
  assert.ok(zoomPresets(WIDE).includes(0.5));
  assert.ok(!zoomPresets(DIGITAL_ZOOM_RANGE).includes(0.5));
});

test("버튼은 작은 배율부터 차례로, 중복 없이 나온다", () => {
  const presets = zoomPresets(WIDE);
  assert.deepEqual(presets, [...presets].sort((left, right) => left - right));
  assert.equal(new Set(presets).size, presets.length);
});

test("배율을 못 움직이는 좁은 범위에서도 버튼이 비지 않는다", () => {
  // 하한이 1보다 큰 기기라면 그 하한이 곧 원래 화면이다.
  const presets = zoomPresets({ min: 2, max: 2 });
  assert.deepEqual(presets, [2]);
});

// ─────────────────────────────────────────── 촬영 잘라내기

test("★ 배율 1의 잘라내기는 원본 전체다 — 여기서 어긋나면 안 당겨도 사진이 잘린다", () => {
  assert.deepEqual(digitalCropRect(2560, 1440, 1), { sx: 0, sy: 0, sw: 2560, sh: 1440 });
});

test("2배는 가운데 절반이다 — 화면에서 본 만큼 저장된다", () => {
  assert.deepEqual(digitalCropRect(2560, 1440, 2), { sx: 640, sy: 360, sw: 1280, sh: 720 });
});

test("잘라낸 사각형은 언제나 영상 안에 들어온다", () => {
  const sizes: Array<[number, number]> = [
    [2560, 1440],
    [1920, 1080],
    [640, 480],
    [1281, 721],
    [3, 5],
  ];
  const zooms = [1, 1.3, 2, 2.7, 4, 10, 1000];
  for (const [width, height] of sizes) {
    for (const zoom of zooms) {
      const { sx, sy, sw, sh } = digitalCropRect(width, height, zoom);
      assert.ok(sx >= 0, `sx=${sx} (${width}x${height} @${zoom})`);
      assert.ok(sy >= 0, `sy=${sy} (${width}x${height} @${zoom})`);
      assert.ok(sw > 0 && sh > 0, `빈 사각형 (${width}x${height} @${zoom})`);
      assert.ok(sx + sw <= width, `가로로 넘쳤다 (${width}x${height} @${zoom})`);
      assert.ok(sy + sh <= height, `세로로 넘쳤다 (${width}x${height} @${zoom})`);
    }
  }
});

test("배율이 1보다 작아도 원본보다 넓게 잘라내지 않는다", () => {
  // 하드웨어가 0.5배로 넓게 담아 준 프레임은 이미 넓다. 여기서 더 넓힐 것은 없다.
  assert.deepEqual(digitalCropRect(1920, 1080, 0.5), { sx: 0, sy: 0, sw: 1920, sh: 1080 });
});

test("영상 크기가 0일 때 터지지 않는다 — 카메라 준비 전에 셔터를 누를 수 있다", () => {
  assert.deepEqual(digitalCropRect(0, 0, 2), { sx: 0, sy: 0, sw: 0, sh: 0 });
  assert.deepEqual(digitalCropRect(1920, 0, 2), { sx: 0, sy: 0, sw: 0, sh: 0 });
  assert.deepEqual(digitalCropRect(0, 1080, 2), { sx: 0, sy: 0, sw: 0, sh: 0 });
});

test("배율이 NaN이어도 원본 전체를 준다 — 사진이 사라지지 않는다", () => {
  assert.deepEqual(digitalCropRect(1920, 1080, Number.NaN), { sx: 0, sy: 0, sw: 1920, sh: 1080 });
});

// ─────────────────────────────────────────── 화면 표시

test("배율 표시는 정수와 소수를 다르게 적는다", () => {
  assert.equal(formatZoom(1), "1x");
  assert.equal(formatZoom(0.5), "0.5x");
  assert.equal(formatZoom(1.72), "1.7x");
  assert.equal(formatZoom(10), "10x");
});

test("핀치로 온 값도 가까운 버튼을 눌린 것으로 보여 준다", () => {
  assert.ok(isZoomAtPreset(1.98, 2));
  assert.ok(isZoomAtPreset(2, 2));
  assert.ok(!isZoomAtPreset(2.4, 2));
  assert.ok(!isZoomAtPreset(1, 2));
});
