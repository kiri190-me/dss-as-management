import { test } from "node:test";
import assert from "node:assert/strict";

import { readImageSize } from "./image-header";

/**
 * ============================================================================
 * 앞머리에서 크기를 읽는 일이 틀리면 조용히 느려지거나 조용히 망가진다
 * ============================================================================
 * 이 함수가 null을 주면 부르는 쪽은 사진을 통째로 푼다 — 느릴 뿐 결과는 같다.
 * 그런데 **틀린 숫자**를 주면 엉뚱한 크기로 줄여서, 사진이 늘어나거나 아주
 * 작아진 채로 저장된다. 그래서 "못 읽는 것"보다 "잘못 읽는 것"을 막는 데
 * 무게를 둔다.
 *
 * 특히 JPEG는 크기가 적힌 조각(SOF)과 그렇지 않은 조각(허프만 표 C4 등)이
 * 번호가 붙어 있어, 걸러 내지 않으면 표의 내용을 크기로 읽는다.
 * ============================================================================
 */

/** 최소한의 PNG 앞머리를 만든다. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false); // IHDR 길이
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

/** 조각들을 이어 붙여 JPEG 앞머리를 만든다. */
function jpegHeader(segments: { marker: number; payload: number[] }[]): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  for (const segment of segments) {
    const length = segment.payload.length + 2;
    parts.push(0xff, segment.marker, (length >> 8) & 0xff, length & 0xff, ...segment.payload);
  }
  return new Uint8Array(parts);
}

/** SOF 조각의 내용: 정밀도(1) + 세로(2) + 가로(2) + 성분 수(1). */
function sofPayload(width: number, height: number): number[] {
  return [8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 3];
}

// ─────────────────────────────────────────── PNG

test("PNG 크기를 읽는다", () => {
  assert.deepEqual(readImageSize(pngHeader(1920, 1080)), { width: 1920, height: 1080 });
});

test("PNG 서명이 아니면 PNG로 읽지 않는다", () => {
  const bytes = pngHeader(100, 100);
  bytes[0] = 0x00;
  assert.equal(readImageSize(bytes), null);
});

test("IHDR가 아니면 null이다", () => {
  const bytes = pngHeader(100, 100);
  bytes[12] = 0x58; // "XHDR"
  assert.equal(readImageSize(bytes), null);
});

// ─────────────────────────────────────────── JPEG

test("JPEG 크기를 읽는다", () => {
  const bytes = jpegHeader([{ marker: 0xc0, payload: sofPayload(4000, 3000) }]);
  assert.deepEqual(readImageSize(bytes), { width: 4000, height: 3000 });
});

test("★ 허프만 표(C4)를 크기로 읽지 않는다 — 번호가 SOF 사이에 끼어 있다", () => {
  // C4는 0xC0~0xCF 범위 안이지만 크기가 아니다. 걸러 내지 않으면 표의 앞부분
  // 숫자를 가로·세로로 읽어 엉뚱한 크기가 나온다.
  const bytes = jpegHeader([
    { marker: 0xc4, payload: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66] },
    { marker: 0xc0, payload: sofPayload(1600, 1200) },
  ]);
  assert.deepEqual(readImageSize(bytes), { width: 1600, height: 1200 });
});

test("C8·CC도 크기 조각이 아니다", () => {
  for (const marker of [0xc8, 0xcc]) {
    const bytes = jpegHeader([
      { marker, payload: [0x09, 0x99, 0x99, 0x99, 0x99, 0x01] },
      { marker: 0xc2, payload: sofPayload(800, 600) },
    ]);
    assert.deepEqual(readImageSize(bytes), { width: 800, height: 600 }, `${marker.toString(16)}`);
  }
});

test("EXIF 같은 큰 조각을 건너뛰고 뒤쪽 SOF를 찾는다", () => {
  const bytes = jpegHeader([
    { marker: 0xe1, payload: new Array(2000).fill(0x00) }, // EXIF
    { marker: 0xdb, payload: new Array(64).fill(0x10) }, // 양자화 표
    { marker: 0xc2, payload: sofPayload(3024, 4032) }, // 세로로 찍은 사진
  ]);
  assert.deepEqual(readImageSize(bytes), { width: 3024, height: 4032 });
});

test("progressive JPEG(C2)도 읽는다 — 폰 사진에 흔하다", () => {
  const bytes = jpegHeader([{ marker: 0xc2, payload: sofPayload(2048, 1536) }]);
  assert.deepEqual(readImageSize(bytes), { width: 2048, height: 1536 });
});

test("앞머리가 잘려 SOF까지 못 가면 null이다 — 짐작하지 않는다", () => {
  const full = jpegHeader([
    { marker: 0xe1, payload: new Array(500).fill(0x00) },
    { marker: 0xc0, payload: sofPayload(1000, 800) },
  ]);
  assert.equal(readImageSize(full.slice(0, 100)), null);
});

test("JPEG도 PNG도 아니면 null이다", () => {
  assert.equal(readImageSize(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), null); // ZIP
  assert.equal(readImageSize(new Uint8Array([])), null);
  assert.equal(readImageSize(new Uint8Array([0xff])), null);
});

test("가로나 세로가 0이면 쓸 수 없는 값이라 null이다", () => {
  assert.equal(readImageSize(pngHeader(0, 100)), null);
  const bytes = jpegHeader([{ marker: 0xc0, payload: sofPayload(0, 0) }]);
  assert.equal(readImageSize(bytes), null);
});
