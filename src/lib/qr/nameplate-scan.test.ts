import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { EncodeHintType } from "@zxing/library";

import {
  cropLuminance,
  makeZxingDecoder,
  passOneTiles,
  passTwoTiles,
  scanNameplateLuminance,
  upscaleBilinear,
  type LuminanceImage,
  type NameplateDecoder,
} from "./nameplate-scan";

/**
 * ============================================================================
 * 훑는 차례 — **측정으로 확정된 것이라 바뀌면 성적이 떨어진다**
 * ============================================================================
 * 1차 타일 자리 · 2차 격자 · 쌍선형 확대 · 가운데부터 보는 차례 — 이 넷은
 * 실물 13장으로 5/13 을 뽑아낸 설정 그대로다. 그래서 이 시험은 「되는가」가
 * 아니라 **「그 설정이 그대로인가」**를 값으로 못 박는다.
 *
 * 여기서는 해독기를 **가짜로 끼운다.** 진짜 QR 로 푸는 것은 바로 아래
 * `zxing 해독기` 묶음과 `nameplate-fixture.test.ts` 가 맡는다 — 자리 계산과
 * 해독을 섞어 두면 어느 쪽이 깨졌는지 알 수 없다.
 *
 * 🔴 함께 못 박는 것 —
 *  · **사진을 통째로 해독기에 넣지 않는다**(실측 0/4 다. 쓰지 않기로 했다).
 *  · **꼴이 안 맞는 QR 에 멈추지 않는다**(ROM TYPE 딱지 `M5259`).
 *  · **2차는 1차가 모두 실패한 뒤에만** 돈다(2차는 타일이 수십 개라 느리다).
 *  · 확대는 **우리 식**이다 — 캔버스에 맡기면 브라우저와 Node 가 달라진다.
 * ============================================================================
 */

const CODE_TEXT = "MBK600M-AD1,WN6445,1808012";

function solid(width: number, height: number, value = 0): LuminanceImage {
  return { data: new Uint8ClampedArray(width * height).fill(value), width, height };
}

function imageOf(values: number[], width: number, height: number): LuminanceImage {
  return { data: Uint8ClampedArray.from(values), width, height };
}

describe("1차 타일 자리", () => {
  test("타일은 짧은 변의 절반이고, 앞·가운데·뒤 세 자리씩 아홉 칸이다", () => {
    const tiles = passOneTiles(1000, 600);
    assert.equal(tiles.length, 9);
    assert.deepEqual(new Set(tiles.map((t) => t.size)), new Set([300]));
    assert.deepEqual([...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b), [0, 350, 700]);
    assert.deepEqual([...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b), [0, 150, 300]);
    assert.deepEqual(new Set(tiles.map((t) => t.scale)), new Set([1]));
    assert.deepEqual(new Set(tiles.map((t) => t.pass)), new Set([1]));
  });

  test("🔴 가운데에서 가까운 타일부터 본다 — 사람은 명판을 가운데 두고 찍는다", () => {
    const tiles = passOneTiles(1000, 600);
    assert.deepEqual({ x: tiles[0].x, y: tiles[0].y }, { x: 350, y: 150 });
    const distances = tiles.map((t) => (t.x + t.size / 2 - 500) ** 2 + (t.y + t.size / 2 - 300) ** 2);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  });

  test("자리가 겹치면 한 번만 본다", () => {
    // 2x2 → 타일 1px. 앞·가운데·뒤가 [0, 1, 1] 이라 세 자리가 두 자리가 된다.
    assert.equal(passOneTiles(2, 2).length, 4);
  });

  test("사진이랄 것이 없으면 볼 자리도 없다 — 던지지 않는다", () => {
    assert.deepEqual(passOneTiles(0, 0), []);
    assert.deepEqual(passOneTiles(-10, 10), []);
    // 1x1 은 타일도 1px 이다. 쓸모는 없지만 터지지 않는 것이 중요하다.
    assert.deepEqual(passOneTiles(1, 1), [{ x: 0, y: 0, size: 1, scale: 1, pass: 1 }]);
  });

  test("🔴 어떤 타일도 사진 전체가 아니다 — 통째로 넣는 길은 쓰지 않기로 했다", () => {
    for (const [w, h] of [
      [3024, 4032],
      [1440, 1080],
      [1050, 1400],
    ]) {
      for (const tile of passOneTiles(w, h)) {
        assert.ok(tile.size < Math.max(w, h), `${w}x${h} 의 타일이 사진을 통째로 덮는다`);
        assert.ok(tile.x + tile.size <= w && tile.y + tile.size <= h, "타일이 사진 밖으로 나간다");
      }
    }
  });
});

describe("2차 타일 자리", () => {
  test("타일은 짧은 변의 1/4, 걸음은 그 절반이다", () => {
    const tiles = passTwoTiles(1000, 600);
    assert.deepEqual(new Set(tiles.map((t) => t.size)), new Set([150]));
    assert.deepEqual(new Set(tiles.map((t) => t.scale)), new Set([2]));
    assert.deepEqual(new Set(tiles.map((t) => t.pass)), new Set([2]));
    const xs = [...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b);
    assert.deepEqual(xs.slice(0, 4), [0, 75, 150, 225]);
    assert.deepEqual(ys, [0, 75, 150, 225, 300, 375, 450]);
  });

  test("🔴 걸음이 끝에 맞아떨어지지 않으면 가장자리 한 자리를 더 본다", () => {
    const xs = [...new Set(passTwoTiles(1000, 600).map((t) => t.x))].sort((a, b) => a - b);
    // 825 다음은 900 인데 900+150 이 사진 밖이다 — 그대로 두면 오른쪽 끝이 통째로 빠진다.
    assert.deepEqual(xs.slice(-2), [825, 850]);
  });

  test("🔴 여기서도 가운데부터 본다", () => {
    const tiles = passTwoTiles(1000, 600);
    const distances = tiles.map((t) => (t.x + t.size / 2 - 500) ** 2 + (t.y + t.size / 2 - 300) ** 2);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  });

  test("같은 거리의 타일 차례가 늘 같다 — 같은 사진이 PC 마다 다른 답을 주면 안 된다", () => {
    const once = passTwoTiles(800, 800).map((t) => `${t.x},${t.y}`);
    const twice = passTwoTiles(800, 800).map((t) => `${t.x},${t.y}`);
    assert.deepEqual(once, twice);
  });
});

describe("조각 떼어내기", () => {
  test("고른 네모의 픽셀을 그대로 가져온다", () => {
    // 4x3: 0 1 2 3 / 10 11 12 13 / 20 21 22 23
    const image = imageOf([0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23], 4, 3);
    const cut = cropLuminance(image, 1, 1, 2);
    assert.equal(cut.width, 2);
    assert.equal(cut.height, 2);
    assert.deepEqual([...cut.data], [11, 12, 21, 22]);
  });

  test("바깥으로 나가는 자리는 가장자리로 민다 — 던지지 않는다", () => {
    const image = imageOf([0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23], 4, 3);
    assert.deepEqual([...cropLuminance(image, 99, 99, 2).data], [12, 13, 22, 23]);
    assert.deepEqual([...cropLuminance(image, -5, -5, 2).data], [0, 1, 10, 11]);
  });
});

describe("쌍선형 확대 — 🔴 우리 식 그대로", () => {
  test("2배 확대의 픽셀값이 측정에서 쓴 식과 같다", () => {
    const grown = upscaleBilinear(imageOf([0, 100, 200, 255], 2, 2), 2);
    assert.equal(grown.width, 4);
    assert.equal(grown.height, 4);
    assert.deepEqual(
      [...grown.data],
      [0, 25, 75, 100, 50, 72, 117, 139, 150, 167, 200, 216, 200, 214, 241, 255]
    );
  });

  test("한 줄짜리도 같은 식으로 늘어난다 — 가장자리는 복제한다", () => {
    const grown = upscaleBilinear(imageOf([0, 100], 2, 1), 2);
    assert.deepEqual({ width: grown.width, height: grown.height }, { width: 4, height: 2 });
    assert.deepEqual([...grown.data], [0, 25, 75, 100, 0, 25, 75, 100]);
  });

  test("고른 밝기는 늘려도 고르다", () => {
    const grown = upscaleBilinear(solid(5, 4, 137), 2);
    assert.deepEqual(new Set(grown.data), new Set([137]));
    assert.equal(grown.width, 10);
    assert.equal(grown.height, 8);
  });

  test("1배는 그대로 돌려준다 — 쓸데없이 베끼지 않는다", () => {
    const image = solid(3, 3, 7);
    assert.equal(upscaleBilinear(image, 1), image);
  });
});

describe("훑기", () => {
  test("아무 데서도 안 풀리면 null — 1차와 2차를 모두 본 뒤다", () => {
    const seen: string[] = [];
    const decode: NameplateDecoder = (image) => {
      seen.push(`${image.width}x${image.height}`);
      return null;
    };
    assert.equal(scanNameplateLuminance(solid(400, 300), decode), null);
    assert.equal(seen.length, passOneTiles(400, 300).length + passTwoTiles(400, 300).length);
  });

  test("🔴 사진을 통째로 해독기에 넣지 않는다", () => {
    const fed: string[] = [];
    scanNameplateLuminance(solid(400, 300), (image) => {
      fed.push(`${image.width}x${image.height}`);
      return null;
    });
    assert.equal(fed.includes("400x300"), false);
  });

  test("1차에서 풀리면 2차는 돌지 않는다", () => {
    let calls = 0;
    const found = scanNameplateLuminance(solid(400, 300), () => {
      calls += 1;
      return CODE_TEXT;
    });
    assert.equal(calls, 1);
    assert.equal(found?.tile.pass, 1);
    assert.equal(found?.tilesTried, 1);
    assert.deepEqual(found?.code, {
      modelName: "MBK600M-AD1",
      lotNumber: "WN6445",
      serialNumber: "1808012",
    });
  });

  test("🔴 꼴이 안 맞는 QR(ROM TYPE 딱지 M5259)에서 멈추지 않는다", () => {
    let calls = 0;
    const found = scanNameplateLuminance(solid(400, 300), () => {
      calls += 1;
      return calls < 4 ? "M5259" : CODE_TEXT;
    });
    assert.equal(found?.text, CODE_TEXT);
    assert.equal(found?.tilesTried, 4);
  });

  test("🔴 2차는 1차를 다 보고 난 뒤에 돌고, 타일을 2배로 늘려 넣는다", () => {
    const passOne = passOneTiles(400, 300);
    const passTwoSize = passTwoTiles(400, 300)[0].size;
    const fed: LuminanceImage[] = [];
    const found = scanNameplateLuminance(solid(400, 300), (image) => {
      fed.push(image);
      return fed.length === passOne.length + 1 ? CODE_TEXT : null;
    });
    assert.equal(found?.tile.pass, 2);
    assert.equal(found?.tilesTried, passOne.length + 1);
    // 1차는 자른 그대로, 2차는 두 배로 늘려 들어간다.
    assert.equal(fed[0].width, passOne[0].size);
    assert.equal(fed[passOne.length].width, passTwoSize * 2);
    assert.equal(fed[passOne.length].height, passTwoSize * 2);
  });

  test("해독기가 꼴에 안 맞는 글만 주면 끝까지 보고 null 이다", () => {
    assert.equal(
      scanNameplateLuminance(solid(200, 200), () => "M5259"),
      null
    );
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────
 * 진짜 해독기 — 지어낸 QR 한 장으로 왕복해 본다
 * ────────────────────────────────────────────────────────────────────────
 * 실물 사진은 `nameplate-fixture.test.ts` 가 본다(그 폴더가 없는 PC 도 있다).
 * 여기서는 **이 PC 에 늘 있는 것**으로 해독기 설정 자체가 살아 있는지를 본다 —
 * 꾸러미를 바꾸거나 이진화 설정을 건드리면 여기서 먼저 깨진다.
 */
describe("zxing 해독기", () => {
  test("QR 로 찍은 글을 그대로 돌려준다", async () => {
    const zxing = await import("@zxing/library");
    const hints = new Map<EncodeHintType, unknown>();
    hints.set(zxing.EncodeHintType.ERROR_CORRECTION, "M");
    const matrix = new zxing.MultiFormatWriter().encode(
      CODE_TEXT,
      zxing.BarcodeFormat.QR_CODE,
      0,
      0,
      hints
    );

    // 한 칸 8px, 둘레에 흰 여백 4칸(QR 이 요구하는 정숙 구역)을 두고 그린다.
    const scale = 8;
    const quiet = 4 * scale;
    const side = matrix.getWidth() * scale + quiet * 2;
    const data = new Uint8ClampedArray(side * side).fill(255);
    for (let my = 0; my < matrix.getHeight(); my += 1) {
      for (let mx = 0; mx < matrix.getWidth(); mx += 1) {
        if (!matrix.get(mx, my)) continue;
        for (let dy = 0; dy < scale; dy += 1) {
          const row = (quiet + my * scale + dy) * side + quiet + mx * scale;
          data.fill(0, row, row + scale);
        }
      }
    }

    const decode = makeZxingDecoder(zxing);
    assert.equal(decode({ data, width: side, height: side }), CODE_TEXT);
  });

  test("QR 이 없는 그림에서는 null 이다 — 던지지 않는다", async () => {
    const zxing = await import("@zxing/library");
    assert.equal(makeZxingDecoder(zxing)(solid(120, 120, 255)), null);
  });
});
