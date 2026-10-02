import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NAMEPLATE_OCR_PAGE_SEG_MODES,
  NAMEPLATE_OCR_VARIANTS,
  NAMEPLATE_OCR_WIDTH,
  NAMEPLATE_SMALL_REGION_WIDTH,
  NAMEPLATE_STAGE1_WIDTH,
  applyNameplateVariant,
  buildNameplateOcrImage,
  invertGray,
  isNameplateRegionSmall,
  nameplateRegionPixelWidth,
  prepareNameplateBase,
  readNameplateRegion,
  rotateGray,
  sameNameplateSetting,
  stage1NameplateSettings,
  stage2NameplateSettings,
  type NameplateRecognizer,
} from "./nameplate-ocr";
import type { GrayImage, RgbaImage } from "./pass-slip-preprocess";

/**
 * ============================================================================
 * 명판 네모를 다듬는 차례 — **순서가 성적을 정한다**
 * ============================================================================
 * 전처리는 전부 순수 계산이라 Node 에서 그대로 잴 수 있다. 여기서 지키는 것은
 * 「무엇을 하는가」가 아니라 **「어떤 차례로 하는가」**다 — 같은 연산을 순서만
 * 바꿔 걸었더니 구 양식 4장의 모델명이 1장에서 0장이 됐다(2026-10-02).
 * ============================================================================
 */

/** 반반으로 밝기가 갈리는 작은 그림. 자르기·확대·이진화를 모두 재 볼 수 있다. */
function twoToneRgba(width: number, height: number, left: number, right: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = x < width / 2 ? left : right;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function values(gray: GrayImage): Set<number> {
  return new Set(gray.data);
}

describe("조합 표", () => {
  test("🔴 여섯 그림 × 세 쪽나눔 = 열여덟 번. 줄이면 성적이 떨어진다", () => {
    assert.equal(NAMEPLATE_OCR_VARIANTS.length, 6);
    assert.equal(NAMEPLATE_OCR_PAGE_SEG_MODES.length, 3);
    assert.deepEqual([...NAMEPLATE_OCR_PAGE_SEG_MODES], ["6", "4", "11"]);
  });

  test("🔴 뒤집은 것과 안 뒤집은 것이 모두 들어 있다 — 흰 글자와 검은 글자가 섞여 있다", () => {
    assert.equal(NAMEPLATE_OCR_VARIANTS.filter((v) => v.invert).length, 3);
    assert.equal(NAMEPLATE_OCR_VARIANTS.filter((v) => !v.invert).length, 3);
    assert.deepEqual(
      [...new Set(NAMEPLATE_OCR_VARIANTS.map((v) => v.threshold))],
      [null, 128, 160]
    );
  });
});

describe("뒤집기", () => {
  test("밝기를 255 에서 뺀다", () => {
    const gray: GrayImage = { data: new Uint8Array([0, 10, 128, 255]), width: 4, height: 1 };
    assert.deepEqual([...invertGray(gray).data], [255, 245, 127, 0]);
  });

  test("원본을 고치지 않는다 — 여섯 조합이 같은 바탕을 나눠 쓴다", () => {
    const gray: GrayImage = { data: new Uint8Array([0, 255]), width: 2, height: 1 };
    invertGray(gray);
    assert.deepEqual([...gray.data], [0, 255]);
  });
});

describe("바탕 다듬기", () => {
  test("네모만 잘라 낸다 — 아직 늘리지 않는다", () => {
    const base = prepareNameplateBase(twoToneRgba(100, 40, 30, 200), {
      l: 0.5,
      t: 0,
      w: 0.5,
      h: 1,
    });
    assert.equal(base.width, 50);
    assert.equal(base.height, 40);
  });

  test("대비정규화가 걸린다 — 밋밋한 사진의 밝기 차가 활짝 벌어진다", () => {
    // 60 과 90 밖에 없는(차이 30) 그림이 거의 0~255 까지 펴진다.
    const base = prepareNameplateBase(twoToneRgba(40, 10, 60, 90), null);
    const seen = [...values(base)].sort((a, b) => a - b);
    assert.equal(seen.length, 2);
    assert.ok(seen[1] - seen[0] > 200, `대비정규화가 빠졌다 — 밝기 차 ${seen[1] - seen[0]}`);
  });
});

describe("조합 입히기 — 🔴 차례가 전부다", () => {
  test("이진화한 뒤에 늘린다 — 늘린 뒤 이진화하면 0 과 255 밖에 안 남는다", () => {
    const base = prepareNameplateBase(twoToneRgba(100, 10, 0, 255), null);
    const made = applyNameplateVariant(base, { invert: false, threshold: 128 });
    assert.equal(made.width, NAMEPLATE_OCR_WIDTH);
    // 🔴 이진화 → lanczos3 확대 차례라서 테두리에 중간값이 생긴다. 차례를
    //    뒤집으면(확대 → 이진화) 중간값이 하나도 없고 글자가 톱니처럼 거칠어져
    //    모델명과 S/N 이 한 덩어리로 붙어 읽힌다.
    const middle = [...values(made)].filter((v) => v !== 0 && v !== 255);
    assert.ok(middle.length > 0, "이진화를 확대 뒤에 걸고 있다 — 차례가 뒤집혔다");
  });

  test("이진화를 끄면 회색 그대로 늘린다", () => {
    const base = prepareNameplateBase(twoToneRgba(100, 10, 0, 255), null);
    const made = applyNameplateVariant(base, { invert: false, threshold: null });
    assert.equal(made.width, NAMEPLATE_OCR_WIDTH);
  });

  test("뒤집기는 이진화보다 먼저다 — 문턱이 뒤집힌 밝기에 걸린다", () => {
    // 왼쪽 0 · 오른쪽 255 → 뒤집으면 왼쪽 255 · 오른쪽 0.
    const base = prepareNameplateBase(twoToneRgba(100, 10, 0, 255), null);
    const plain = applyNameplateVariant(base, { invert: false, threshold: 128 });
    const flipped = applyNameplateVariant(base, { invert: true, threshold: 128 });
    assert.equal(plain.data[0], 0);
    assert.equal(flipped.data[0], 255);
  });

  test("이미 2000px 보다 넓으면 줄이지 않는다", () => {
    const base = prepareNameplateBase(twoToneRgba(2400, 10, 0, 255), null);
    const made = applyNameplateVariant(base, { invert: false, threshold: null });
    assert.equal(made.width, 2400);
  });
});

describe("PNG 만들기", () => {
  test("조합마다 2000px 짜리 회색 PNG 가 나온다", () => {
    const base = prepareNameplateBase(twoToneRgba(200, 20, 0, 255), null);
    for (const variant of NAMEPLATE_OCR_VARIANTS) {
      const image = buildNameplateOcrImage(base, variant);
      assert.equal(image.width, NAMEPLATE_OCR_WIDTH);
      assert.equal(image.variant, variant);
      // PNG 서명 여덟 바이트.
      assert.deepEqual([...image.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });
});

describe("🔴 사진 속 명판이 작으면 알린다 — 막지는 않는다", () => {
  test("비율로 친 네모를 **원본 픽셀**로 잰다", () => {
    // 화면에서 880px 로 줄여 보여 줬어도, 읽는 것은 원본 3024px 쪽이다.
    assert.equal(nameplateRegionPixelWidth(0.25, 3024), 756);
    assert.equal(nameplateRegionPixelWidth(0.6, 648), 389);
  });

  test("🔴 600px 를 경계로 삼는다 — 실측 다섯 장이 756 과 310~389 로 갈렸다", () => {
    assert.equal(NAMEPLATE_SMALL_REGION_WIDTH, 600);
    // 제일 잘 읽힌 장(모델·S/N 둘 다)
    assert.equal(isNameplateRegionSmall(756), false);
    // 무언가를 잃은 넷
    for (const width of [389, 360, 346, 310]) {
      assert.equal(isNameplateRegionSmall(width), true, `${width}px 를 작다고 보지 않는다`);
    }
  });

  test("아직 네모를 안 쳤으면 아무 말도 하지 않는다", () => {
    assert.equal(isNameplateRegionSmall(0), false);
    assert.equal(nameplateRegionPixelWidth(0.25, 0), 0);
  });
});

describe("기울기", () => {
  test("0도는 그대로 둔다 — 쓸데없이 다시 표본하지 않는다", () => {
    const gray: GrayImage = { data: new Uint8Array([1, 2, 3, 4]), width: 2, height: 2 };
    assert.equal(rotateGray(gray, 0), gray);
  });

  test("돌려도 크기는 그대로다", () => {
    const base = prepareNameplateBase(twoToneRgba(40, 20, 0, 255), null);
    const turned = rotateGray(base, 2);
    assert.equal(turned.width, base.width);
    assert.equal(turned.height, base.height);
  });

  test("🔴 바깥을 흰색·검은색으로 메우지 않는다 — 없던 테두리가 생기면 글줄로 읽힌다", () => {
    // 전부 같은 밝기인 그림을 돌리면, 가장자리로 메우므로 **값이 하나도 안 변한다.**
    const flat: GrayImage = { data: new Uint8Array(40 * 20).fill(123), width: 40, height: 20 };
    const turned = rotateGray(flat, -2);
    assert.deepEqual([...new Set(turned.data)], [123]);
  });

  test("실제로 돌아간다 — 돌리면 픽셀이 달라진다", () => {
    const base = prepareNameplateBase(twoToneRgba(40, 20, 0, 255), null);
    const turned = rotateGray(base, 2);
    assert.notDeepEqual([...turned.data], [...base.data]);
  });
});

describe("1단계·2단계 설정", () => {
  test("🔴 1단계는 2000px 한 바퀴뿐이다 — 바퀴를 더 돌면 틀린 값이 늘었다", () => {
    const settings = stage1NameplateSettings();
    assert.deepEqual(settings, [{ width: NAMEPLATE_STAGE1_WIDTH, rotateDegrees: 0 }]);
    assert.equal(NAMEPLATE_STAGE1_WIDTH, 2000);
  });

  test("2단계는 배율 셋 × 기울기 셋", () => {
    const settings = stage2NameplateSettings([]);
    assert.equal(settings.length, 9);
    assert.deepEqual(
      [...new Set(settings.map((s) => s.rotateDegrees))].sort((a, b) => a - b),
      [-2, 0, 2]
    );
  });

  test("🔴 1단계에서 이미 돈 설정은 2단계가 또 돌지 않는다", () => {
    const done = [{ width: 2000, rotateDegrees: 0 }];
    const settings = stage2NameplateSettings(done);
    assert.equal(settings.length, 8);
    assert.ok(!settings.some((s) => sameNameplateSetting(s, done[0])));
  });
});

describe("읽는 차례", () => {
  function countingRecognizer(answers: string[]): {
    recognize: NameplateRecognizer;
    calls: { pageSegMode: string; bytes: number }[];
  } {
    const calls: { pageSegMode: string; bytes: number }[] = [];
    return {
      calls,
      recognize: async (png, pageSegMode) => {
        calls.push({ pageSegMode, bytes: png.length });
        return answers[calls.length - 1] ?? "";
      },
    };
  }

  test("🔴 열여덟 번 읽는다 — 세 칸이 찼다고 중간에 멈추지 않는다", async () => {
    const engine = countingRecognizer(["AUTOMATCHINGBOX CMK150M-1C2 S/N 1307009 L/N WZ6243"]);
    const outcome = await readNameplateRegion(
      twoToneRgba(200, 20, 0, 255),
      null,
      engine.recognize,
      ["CMK150M-IC2"]
    );
    assert.equal(engine.calls.length, 18);
    assert.equal(outcome.passes.length, 18);
  });

  test("한 그림마다 쪽나눔 셋을 돌린다", async () => {
    const engine = countingRecognizer([]);
    await readNameplateRegion(twoToneRgba(200, 20, 0, 255), null, engine.recognize, []);
    assert.deepEqual(engine.calls.slice(0, 4).map((c) => c.pageSegMode), ["6", "4", "11", "6"]);
    // 같은 그림을 쓰는 동안에는 바이트 수가 같다.
    assert.equal(engine.calls[0].bytes, engine.calls[1].bytes);
  });

  test("🔴 조합마다 나온 글을 **전부 합쳐** 판단한다", async () => {
    // 한 조합은 모델명만, 다른 조합은 S/N 만 준다 — 실제 명판이 그렇다.
    const answers = new Array<string>(18).fill("");
    answers[0] = "AUTOMATCHINGBOX CMK150M-1C2";
    answers[9] = "S/N 1307009";
    const engine = countingRecognizer(answers);
    const outcome = await readNameplateRegion(
      twoToneRgba(200, 20, 0, 255),
      null,
      engine.recognize,
      ["CMK150M-IC2", "CMK300M-IC2"]
    );
    assert.equal(outcome.reading.modelName, "CMK150M-IC2");
    assert.equal(outcome.reading.serialNumber, "1307009");
    assert.equal(outcome.reading.lotNumber, null);
  });

  test("🔴 2단계는 1단계가 찾은 것을 **지우지 않고 보탠다**", async () => {
    // 1단계에서 S/N 만 나왔고, 2단계에서 모델명이 나온 상황.
    const first = countingRecognizer(["AUTOMATCHINGBOX S/N 1307009"]);
    const one = await readNameplateRegion(
      twoToneRgba(200, 20, 0, 255),
      null,
      first.recognize,
      ["CMK150M-IC2"]
    );
    assert.equal(one.reading.serialNumber, "1307009");
    assert.equal(one.reading.modelName, null);

    const second = countingRecognizer(["AUTOMATCHINGBOX CMK150M-1C2"]);
    const two = await readNameplateRegion(
      twoToneRgba(200, 20, 0, 255),
      null,
      second.recognize,
      ["CMK150M-IC2"],
      { settings: stage2NameplateSettings(one.settings), previousPasses: one.passes }
    );
    // 🔴 1단계에서 찾은 S/N 이 그대로 살아 있고, 모델명이 **더해졌다.**
    assert.equal(two.reading.serialNumber, "1307009", "2단계가 1단계 결과를 지웠다");
    assert.equal(two.reading.modelName, "CMK150M-IC2");
    assert.ok(two.passes.length > one.passes.length);
    assert.ok(two.settings.length > one.settings.length);
  });

  test("아무 글도 못 받으면 세 칸이 비어 있다", async () => {
    const engine = countingRecognizer([]);
    const outcome = await readNameplateRegion(
      twoToneRgba(200, 20, 0, 255),
      null,
      engine.recognize,
      ["CMK150M-IC2"]
    );
    assert.deepEqual(
      {
        m: outcome.reading.modelName,
        l: outcome.reading.lotNumber,
        s: outcome.reading.serialNumber,
      },
      { m: null, l: null, s: null }
    );
  });
});
