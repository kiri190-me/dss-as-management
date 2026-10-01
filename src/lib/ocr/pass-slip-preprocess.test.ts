import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";

import {
  PRESET_BAND_A,
  cropRGBA,
  encodeGrayPNG,
  normaliseGray,
  prepare,
  resizeRGBA,
  toGray,
  type RgbaImage,
} from "./pass-slip-preprocess";

/**
 * ============================================================================
 * 통문증 전처리 — **숫자가 바뀌지 않았는가**
 * ============================================================================
 * 이 계산은 통문증 14장에서 통문번호 14/14 · 날짜 검산 14/14 를 낸 바로 그
 * 알고리즘이다. 상수 하나, 반올림 한 번만 달라져도 그 성적이 조용히 떨어진다 —
 * 아무 오류도 나지 않고 "어떤 사진은 안 읽히네"가 될 뿐이라 사람이 못 잡는다.
 *
 * 그래서 두 겹으로 못 박는다.
 *
 *  1. **어디서나 도는 시험** — 되풀이 가능한 합성 그림을 넣어 나온 픽셀의 해시를
 *     박아 둔다. 설정값(PRESET_BAND_A)도 하나씩 적어 둔다.
 *  2. **측정 자료가 있을 때만 도는 시험** — 실제 통문증 14장을 넣어 기준 답안
 *     (node-ref.json)의 픽셀 해시와 **한 비트도 다르지 않은지** 본다. 이것이
 *     14/14 를 보증하는 자리다.
 *
 * 🔴 **사진은 저장소에 넣지 않는다**(고객 자료다). 측정 폴더가 없으면 2번을
 * 건너뛰되, **건너뛴다는 사실이 보이게** 넘어간다.
 *
 * JPEG 를 펼치는 일은 이 파일 밖이다 — 시험에서는 측정 폴더의 sharp 를 빌려
 * 쓴다(저장소에 sharp 를 들이지 않는다. 네이티브 바이너리라 NAS 이식에 짐이다).
 * ============================================================================
 */

const FIXTURE_DIR = process.env.PASS_SLIP_FIXTURE_DIR ?? "C:/DSS-AS-DATA/통문증-시험";
const NODE_REF = path.join(FIXTURE_DIR, "browser", "node-ref.json");

type NodeRefItem = {
  caseNo: string;
  file: string;
  grayW: number;
  grayH: number;
  grayHash: string;
  pngLen: number;
};

/** 브라우저·Node 양쪽에서 같은 값이 나오는 가벼운 해시 (FNV-1a 32비트). */
function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return `00000000${hash.toString(16)}`.slice(-8);
}

/**
 * 되풀이 가능한 합성 그림 — 세로 줄무늬에 정해진 난수를 섞는다.
 * 🔴 난수 씨앗과 수식을 바꾸면 아래 박아 둔 해시가 뜻을 잃는다.
 */
function syntheticImage(width: number, height: number): RgbaImage {
  let seed = 12345;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const stripe = (x >> 3) % 2 === 0 ? 40 : 215;
      const noise = nextRandom() % 24;
      data[p] = Math.min(255, stripe + noise);
      data[p + 1] = Math.min(255, stripe + ((noise * 3) % 24));
      data[p + 2] = Math.min(255, stripe + ((noise * 7) % 24));
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

function solidImage(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe("🔴 설정값 — 바꾸면 14/14 가 깨진다", () => {
  test("「통문정보」 띠의 자리와 크기", () => {
    assert.deepEqual(PRESET_BAND_A.region, { l: 0.0, t: 0.14, w: 0.52, h: 0.22 });
  });

  test("1800px 로 늘리고 lanczos3 로 다시 뜬다", () => {
    assert.equal(PRESET_BAND_A.width, 1800);
    assert.equal(PRESET_BAND_A.kernel, "lanczos3");
  });

  test("회색조는 libvips 와 같은 길(vips)이다", () => {
    assert.equal(PRESET_BAND_A.gray, "vips");
  });

  test("🔴 대비정규화는 전구간 늘이기다 — 1~99 백분위로 바꾸면 날짜 검산이 12/14 로 떨어졌다", () => {
    assert.deepEqual(PRESET_BAND_A.normalise, { lower: "min", upper: "max" });
  });

  test("선명화 sigma 는 1.2", () => {
    assert.deepEqual(PRESET_BAND_A.sharpen, { sigma: 1.2 });
  });
});

describe("조각들", () => {
  test("자르기 — 비율을 반올림해 픽셀 수를 정한다", () => {
    const cropped = cropRGBA(solidImage(10, 10, [1, 2, 3]), { l: 0.2, t: 0.2, w: 0.5, h: 0.5 });
    assert.equal(cropped.width, 5);
    assert.equal(cropped.height, 5);
    assert.equal(cropped.data.length, 5 * 5 * 4);
  });

  test("자르기 — 상자가 그림 밖으로 나가면 안쪽으로 줄인다", () => {
    const cropped = cropRGBA(solidImage(10, 10, [1, 2, 3]), { l: 0.8, t: 0.8, w: 0.5, h: 0.5 });
    assert.equal(cropped.width, 2);
    assert.equal(cropped.height, 2);
  });

  test("자르기 — 상자가 없으면 그대로 돌려준다", () => {
    const source = solidImage(4, 4, [1, 2, 3]);
    assert.equal(cropRGBA(source, null), source);
  });

  test("확대 — 높이는 비율대로 따라온다", () => {
    const resized = resizeRGBA(solidImage(100, 40, [128, 128, 128]), 300, "lanczos3");
    assert.equal(resized.width, 300);
    assert.equal(resized.height, 120);
  });

  test("회색조 — 흰색은 255, 검정은 0", () => {
    assert.equal(toGray(solidImage(2, 2, [255, 255, 255]), "vips").data[0], 255);
    assert.equal(toGray(solidImage(2, 2, [0, 0, 0]), "vips").data[0], 0);
  });

  test("회색조 — 회색은 그대로 남는다(채널이 같으면 휘도도 같다)", () => {
    assert.equal(toGray(solidImage(2, 2, [137, 137, 137]), "vips").data[0], 137);
  });

  test("대비정규화 — 늘릴 범위가 없으면 아무것도 하지 않는다", () => {
    const flat = toGray(solidImage(4, 4, [120, 120, 120]), "vips");
    assert.equal(normaliseGray(flat, PRESET_BAND_A.normalise), flat);
  });
});

describe("회색 PNG 만들기", () => {
  const gray = new Uint8Array([0, 64, 128, 255, 7, 9]);
  const png = encodeGrayPNG(gray, 3, 2);

  test("PNG 표지로 시작한다", () => {
    assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("IHDR 가 크기와 8비트 회색조를 적는다", () => {
    assert.equal(String.fromCharCode(...png.slice(12, 16)), "IHDR");
    const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    const height = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    assert.equal(width, 3);
    assert.equal(height, 2);
    assert.equal(png[24], 8, "비트 깊이");
    assert.equal(png[25], 0, "색 종류 0 = 회색조");
  });

  test("IEND 로 끝난다", () => {
    assert.equal(String.fromCharCode(...png.slice(png.length - 8, png.length - 4)), "IEND");
  });

  test("압축하지 않으므로 같은 픽셀은 언제나 같은 바이트가 된다", () => {
    assert.deepEqual([...encodeGrayPNG(gray, 3, 2)], [...png]);
  });
});

describe("전체 파이프라인 — 되풀이 가능한 합성 그림", () => {
  const gray = prepare(syntheticImage(320, 240), PRESET_BAND_A);
  const png = encodeGrayPNG(gray.data, gray.width, gray.height);

  test("크기는 띠를 1800px 로 늘린 그대로다", () => {
    assert.equal(gray.width, 1800);
    assert.equal(gray.height, 575);
  });

  test("🔴 픽셀이 한 비트도 달라지지 않았다", () => {
    assert.equal(fnv1a(gray.data), "322361e4");
  });

  test("🔴 넘기는 PNG 바이트도 그대로다", () => {
    assert.equal(png.length, 1035718);
    assert.equal(fnv1a(png), "b2a47b3a");
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * 실제 통문증 14장 — 측정 폴더가 있을 때만
 * ────────────────────────────────────────────────────────────────────────── */

type SharpLike = (
  input: string,
  options: { failOn: string }
) => {
  rotate(): {
    ensureAlpha(): {
      raw(): {
        toBuffer(options: { resolveWithObject: true }): Promise<{
          data: Buffer;
          info: { width: number; height: number };
        }>;
      };
    };
  };
};

function loadFixture(): { items: NodeRefItem[]; sharp: SharpLike } | string {
  if (!fs.existsSync(NODE_REF)) {
    return `측정 자료가 없어 건너뜁니다: ${NODE_REF} (PASS_SLIP_FIXTURE_DIR 로 가리킬 수 있습니다)`;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(NODE_REF, "utf8")) as { items: NodeRefItem[] };
    // 저장소에 sharp 를 들이지 않는다 — 측정 폴더의 것을 빌려 쓴다.
    const requireFromFixture = createRequire(path.join(FIXTURE_DIR, "package.json"));
    const sharp = requireFromFixture("sharp") as SharpLike;
    return { items: parsed.items, sharp };
  } catch (error) {
    return `측정 자료를 읽지 못해 건너뜁니다: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const fixture = loadFixture();
const fixtureSkip = typeof fixture === "string" ? fixture : false;

describe("실제 통문증 14장 — 기준 답안과 픽셀까지 같은가", () => {
  test(
    "🔴 14장 모두 기준 답안과 한 비트도 다르지 않다",
    { skip: fixtureSkip },
    async () => {
      const { items, sharp } = fixture as { items: NodeRefItem[]; sharp: SharpLike };
      assert.equal(items.length, 14, "측정 자료의 장수가 14가 아니다");

      const different: string[] = [];
      for (const item of items) {
        const file = path.join(FIXTURE_DIR, "browser", item.file);
        const { data, info } = await sharp(file, { failOn: "none" })
          .rotate()
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const rgba: RgbaImage = {
          data: new Uint8Array(data.buffer, data.byteOffset, data.length),
          width: info.width,
          height: info.height,
        };
        const gray = prepare(rgba, PRESET_BAND_A);
        const png = encodeGrayPNG(gray.data, gray.width, gray.height);
        const actual = `${gray.width}x${gray.height}/${fnv1a(gray.data)}/${png.length}`;
        const expected = `${item.grayW}x${item.grayH}/${item.grayHash}/${item.pngLen}`;
        if (actual !== expected) different.push(`${item.caseNo}: ${actual} ≠ ${expected}`);
      }
      assert.deepEqual(different, [], "전처리 결과가 기준 답안과 달라졌다");
    }
  );
});
