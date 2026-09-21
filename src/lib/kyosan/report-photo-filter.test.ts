import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { KyosanPhoto } from "./report-photos";
import {
  isRealKyosanPhoto,
  KYOSAN_FORM_ASSET_SHA256,
  KYOSAN_PHOTO_MIN_BYTES,
  splitKyosanPhotos,
} from "./report-photo-filter";

/**
 * 🔴 실제 연락서를 쓰지 않는다 — 손으로 지은 그림 정보만 넘긴다. 해시는 그림
 * **내용의 지문**이라 고객 정보가 아니고, 양식 자산 해시는 실측에서 78~246장에
 * 똑같이 들어 있던 것들이다.
 */

function photoOf(sha256: string, bytes: number, sheet = "参考写真"): KyosanPhoto {
  return { sha256, bytes, parts: [`xl/media/${sha256.slice(0, 6)}.jpg`], sheets: [sheet], placements: 1 };
}

const [firstFormAsset] = [...KYOSAN_FORM_ASSET_SHA256];

describe("연락서 사진 거르기", () => {
  test("10KB 미만은 사진이 아니다 — 양식 아이콘·도장이 여기 있다", () => {
    assert.equal(isRealKyosanPhoto(photoOf("a".repeat(64), 1_161)), false);
    assert.equal(isRealKyosanPhoto(photoOf("b".repeat(64), KYOSAN_PHOTO_MIN_BYTES - 1)), false);
  });

  test("10KB 이상이면 사진이다 — 시트 이름을 따지지 않는다(실측: 사진의 20%가 사진 시트 밖에 있다)", () => {
    assert.equal(isRealKyosanPhoto(photoOf("c".repeat(64), KYOSAN_PHOTO_MIN_BYTES)), true);
    assert.equal(isRealKyosanPhoto(photoOf("d".repeat(64), 240_000, "通電検査")), true);
  });

  test("🔴 양식 자산은 커도 뺀다 — 469장 가운데 78~246장에 똑같이 들어 있던 그림들", () => {
    assert.ok(firstFormAsset, "양식 자산 목록이 비어 있으면 안 된다");
    assert.equal(isRealKyosanPhoto(photoOf(firstFormAsset, 125_425)), false);
  });

  test("splitKyosanPhotos 는 사진과 양식 자산을 갈라 놓는다 — 개수를 둘 다 보여 주려고", () => {
    const photos = [
      photoOf("e".repeat(64), 30_000),
      photoOf(firstFormAsset, 125_425),
      photoOf("f".repeat(64), 1_161),
      photoOf("g".repeat(64), 80_000),
    ];
    const split = splitKyosanPhotos(photos);
    assert.deepEqual(
      split.photos.map((photo) => photo.bytes),
      [30_000, 80_000]
    );
    assert.equal(split.formAssets.length, 2);
  });

  test("빈 목록은 빈 결과다", () => {
    const split = splitKyosanPhotos([]);
    assert.deepEqual(split.photos, []);
    assert.deepEqual(split.formAssets, []);
  });
});
