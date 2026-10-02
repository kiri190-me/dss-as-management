/**
 * ============================================================================
 * 명판 사진에서 QR 을 찾는 **훑는 차례** — 측정으로 확정됐다
 * ============================================================================
 * 사진 한 장(밝기값만)을 받아 조각조각 잘라 해독기에 넣는다. 🔴 해독기는
 * **주입받는다** — 그래야 브라우저에서는 `@zxing/library` 로, Node 시험에서는
 * 같은 라이브러리를 직접 끼워 **같은 값**을 보게 할 수 있다.
 *
 * ── 차례 (2026-10-02 실측 13장으로 확정) ───────────────────────────────
 *  0. EXIF 회전을 적용해 캔버스에 그린다 — 그러지 않으면 세로 사진의
 *     가로·세로가 뒤집힌다. **줄이지 않는다**(원본 해상도 그대로).
 *  1. 1차 — 타일 `T = round(짧은 변 / 2)`, 가로·세로 세 자리씩(앞·가운데·뒤).
 *  2. 2차 — 1차가 모두 실패하면 `T = round(짧은 변 / 4)`, 걸음 `T/2` 격자에
 *     **쌍선형 2배 확대**를 걸어 다시 푼다.
 *  3. 둘 다 실패하면 「사진이 흐릿합니다」다.
 *
 * 두 차례 모두 **가운데에서 가까운 타일부터** 본다 — 사람은 명판을 가운데에
 * 놓고 찍는다.
 *
 * ── 🔴 하지 말아야 할 것 세 가지 ───────────────────────────────────────
 *  · **사진 전체를 통째로 넣기** — 실측 0/4 다. 배율을 바꿔도 안 된다.
 *  · **줄여서 넣기** — 읽힌 QR 중 가장 작은 것이 65px 이었다. 줄이면 그 장이
 *    죽고, 그보다 작은 것들은 타일·배율·이진화를 바꿔 **1557번을 시도해도**
 *    안 풀렸다.
 *  · **캔버스 `drawImage` 로 확대하기** — 브라우저와 Node 시험이 다른 값을
 *    보게 되어 시험이 못 믿을 것이 된다. 확대는 아래 순수 JS 로 한다.
 * ============================================================================
 */

// 🔴 `import type` 다 — 글자만 빌려 온다. 컴파일에서 통째로 지워지므로 이 줄 때문에
//    `@zxing/library` 가 첫 화면 묶음에 끌려 들어오지 않는다(실제 꾸러미는 아래
//    `createZxingNameplateDecoder()` 의 동적 `import()` 로만 들어온다).
import type { DecodeHintType } from "@zxing/library";

import { parseNameplateCode, type NameplateCode } from "./nameplate-code";

/** 밝기값만 가진 그림 한 장. 한 칸이 한 픽셀이고 0~255 다. */
export type LuminanceImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/**
 * 해독기. 밝기 그림 한 조각을 받아 **QR 이 싣고 있던 글** 또는 `null` 을
 * 준다. 던지지 않는다 — 「못 읽음」은 결과의 한 갈래다.
 */
export type NameplateDecoder = (image: LuminanceImage) => string | null;

/** 훑을 자리 하나. `scale` 이 1보다 크면 잘라낸 뒤 그만큼 확대해 넣는다. */
export type NameplateTile = {
  x: number;
  y: number;
  size: number;
  scale: number;
  /** 1차인가 2차인가. 시험과 보고가 「어디서 풀렸는지」를 말할 때 쓴다. */
  pass: 1 | 2;
};

/** 1차 타일 크기 = 짧은 변 / 이 값. */
const PASS_ONE_DIVISOR = 2;
/** 2차 타일 크기 = 짧은 변 / 이 값. */
const PASS_TWO_DIVISOR = 4;
/** 2차에서 타일을 넓히는 배수. */
const PASS_TWO_SCALE = 2;

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * 가운데에서 가까운 차례로 눕힌다.
 *
 * 같은 거리면 위 → 왼쪽 차례다. 🔴 거리만으로 정렬하면 엔진마다 동률의
 * 차례가 달라질 수 있어, **같은 사진이 PC 마다 다른 답을 주는** 일이 생긴다.
 */
function orderFromCenter(tiles: NameplateTile[], width: number, height: number): NameplateTile[] {
  const cx = width / 2;
  const cy = height / 2;
  return [...tiles].sort((a, b) => {
    const da = (a.x + a.size / 2 - cx) ** 2 + (a.y + a.size / 2 - cy) ** 2;
    const db = (b.x + b.size / 2 - cx) ** 2 + (b.y + b.size / 2 - cy) ** 2;
    if (da !== db) return da - db;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
}

/** 1차 — 앞·가운데·뒤 세 자리씩, 겹치는 자리는 한 번만. */
export function passOneTiles(width: number, height: number): NameplateTile[] {
  const size = Math.round(Math.min(width, height) / PASS_ONE_DIVISOR);
  if (size < 1 || size > width || size > height) return [];
  const xs = uniqueSorted([0, Math.round((width - size) / 2), Math.max(0, width - size)]);
  const ys = uniqueSorted([0, Math.round((height - size) / 2), Math.max(0, height - size)]);
  const tiles: NameplateTile[] = [];
  for (const y of ys) for (const x of xs) tiles.push({ x, y, size, scale: 1, pass: 1 });
  return orderFromCenter(tiles, width, height);
}

/** 2차 — 절반씩 겹치는 격자. 마지막 자리는 가장자리에 붙인다. */
export function passTwoTiles(width: number, height: number): NameplateTile[] {
  const size = Math.round(Math.min(width, height) / PASS_TWO_DIVISOR);
  if (size < 1 || size > width || size > height) return [];
  const step = Math.max(1, Math.round(size / 2));

  const axis = (length: number): number[] => {
    const positions: number[] = [];
    for (let start = 0; start + size <= length; start += step) positions.push(start);
    // 걸음이 끝에 딱 맞아떨어지지 않으면 오른쪽(아래쪽) 끝이 통째로 빠진다.
    if (positions[positions.length - 1] !== length - size) positions.push(length - size);
    return uniqueSorted(positions);
  };

  const xs = axis(width);
  const ys = axis(height);
  const tiles: NameplateTile[] = [];
  for (const y of ys) for (const x of xs) tiles.push({ x, y, size, scale: PASS_TWO_SCALE, pass: 2 });
  return orderFromCenter(tiles, width, height);
}

/** 그림에서 네모 한 칸을 떼어낸다. 바깥으로 나가는 자리는 가장자리로 민다. */
export function cropLuminance(
  image: LuminanceImage,
  x: number,
  y: number,
  size: number
): LuminanceImage {
  const left = Math.min(Math.max(0, x), Math.max(0, image.width - size));
  const top = Math.min(Math.max(0, y), Math.max(0, image.height - size));
  const cutWidth = Math.min(size, image.width);
  const cutHeight = Math.min(size, image.height);
  const data = new Uint8ClampedArray(cutWidth * cutHeight);
  for (let row = 0; row < cutHeight; row += 1) {
    const from = (top + row) * image.width + left;
    data.set(image.data.subarray(from, from + cutWidth), row * cutWidth);
  }
  return { data, width: cutWidth, height: cutHeight };
}

/**
 * 쌍선형(bilinear) 확대 — 🔴 **우리 코드로 한다.**
 *
 * 캔버스의 배율 조정에 맡기면 브라우저와 Node 가 다른 픽셀을 보게 되어,
 * 시험이 통과해도 화면에서 다른 답이 나올 수 있다. 식은 측정에서 쓴 것과
 * 같다(픽셀 가운데를 기준으로 하는 표준 꼴).
 */
export function upscaleBilinear(image: LuminanceImage, scale: number): LuminanceImage {
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height);
  const { width: sw, height: sh, data: src } = image;

  for (let y = 0; y < height; y += 1) {
    const sy = (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));
    const rowTop = y0 * sw;
    const rowBottom = y1 * sw;
    for (let x = 0; x < width; x += 1) {
      const sx = (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      const top = src[rowTop + x0] * (1 - fx) + src[rowTop + x1] * fx;
      const bottom = src[rowBottom + x0] * (1 - fx) + src[rowBottom + x1] * fx;
      data[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return { data, width, height };
}

/** 읽어낸 결과. 어느 차례의 어느 자리에서 풀렸는지도 함께 들고 온다. */
export type NameplateScanResult = {
  code: NameplateCode;
  /** QR 이 싣고 있던 글 그대로. */
  text: string;
  tile: NameplateTile;
  /** 여기까지 본 자리 수. 「몇 번 만에」를 말할 때 쓴다. */
  tilesTried: number;
};

/**
 * 밝기 그림 한 장을 훑는다.
 *
 * 🔴 **꼴이 안 맞는 QR 은 버리고 다음 자리로 간다 — 멈추지 않는다.** 장비에는
 * ROM TYPE 딱지 QR(`M5259`)이 따로 붙어 있어, 먼저 풀린 것을 그대로 믿으면
 * 엉뚱한 값이 칸에 적힌다.
 */
export function scanNameplateLuminance(
  image: LuminanceImage,
  decode: NameplateDecoder
): NameplateScanResult | null {
  let tilesTried = 0;
  for (const tiles of [passOneTiles(image.width, image.height), passTwoTiles(image.width, image.height)]) {
    for (const tile of tiles) {
      tilesTried += 1;
      const cut = cropLuminance(image, tile.x, tile.y, tile.size);
      const fed = upscaleBilinear(cut, tile.scale);
      const text = decode(fed);
      const code = parseNameplateCode(text);
      if (code && text !== null) return { code, text, tile, tilesTried };
    }
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 해독기 — `@zxing/library`
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * zxing 으로 푸는 해독기를 만든다.
 *
 * 🔴 **동적 `import()` 다.** 단추를 누르기 전까지 이 꾸러미(약 300KB)는
 * 내려오지 않는다 — 접수 화면 첫 묶음에 들어가면 QR 을 안 쓰는 사람도 그
 * 값을 치른다. `npm run build` 의 첫 화면 묶음 크기로 확인한다.
 *
 * 🔴 **왜 `jsQR` 이 아닌가**: 가볍지만(15KB) 가장 먼 사진을 못 읽었고, 대신
 * 같은 장비의 ROM TYPE 딱지 QR 을 집어 왔다(2026-10-02 실측).
 */
export async function createZxingNameplateDecoder(): Promise<NameplateDecoder> {
  const zxing = await import("@zxing/library");
  return makeZxingDecoder(zxing);
}

/** 꾸러미를 이미 들고 있을 때(시험) 쓰는 길. 위와 **같은 설정**이어야 한다. */
export function makeZxingDecoder(zxing: typeof import("@zxing/library")): NameplateDecoder {
  const {
    BarcodeFormat,
    BinaryBitmap,
    DecodeHintType,
    GlobalHistogramBinarizer,
    HybridBinarizer,
    QRCodeReader,
    RGBLuminanceSource,
  } = zxing;

  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  /*
   * 🔴 **`MultiFormatReader` 가 아니라 `QRCodeReader` 다 — 고르는 결과는 같다.**
   *
   * `MultiFormatReader` 는 `POSSIBLE_FORMATS = [QR_CODE]` 를 받으면 해독기를
   * 딱 하나, `QRCodeReader` 만 세운다(0.23.0 의 `setHints`). 그러니 푸는 길은
   * 똑같다. 그런데 이 판의 `MultiFormatReader` 에는 흠이 있다 — 제 `decode` 가
   * 던진 `NotFoundException` 을 자기네 `ReaderException` 으로 알아보지 못해
   * **못 읽은 타일마다 `console.warn` 에 긴 호출 흔적을 찍는다.** 한 장을
   * 훑으면 타일이 수십 개라, 흐린 사진 한 장에 경고가 수십 줄씩 쌓인다.
   * 해독기를 직접 쓰면 그 예외가 우리 `try` 로 바로 와서 조용히 넘어간다.
   */
  const reader = new QRCodeReader();

  return (image: LuminanceImage): string | null => {
    /*
     * 🔴 `RGBLuminanceSource` 에 **밝기 배열을 그대로** 준다.
     *
     * 이 클래스는 `Int32Array` 를 받으면 ARGB 로 보고 `(R + 2G + B) >> 2` 로
     * 밝기를 뽑는데, 그 자리에 `(0xff<<24)|(g<<16)|(g<<8)|g` 를 넣으면
     * 결과는 다시 `g` 다 — 즉 `Uint8ClampedArray` 를 그대로 주는 것과 **한
     * 바이트도 다르지 않다.** 대신 메모리를 네 배 덜 쓴다(원본 해상도를
     * 그대로 쓰기 때문에 이 차이가 작지 않다).
     */
    const source = new RGBLuminanceSource(image.data, image.width, image.height);

    // 먼저 HybridBinarizer. 그늘이 진 사진에서 이쪽이 훨씬 잘 푼다.
    try {
      return reader.decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
    } catch {
      // 못 읽음은 예외로 온다 — 다음 이진화로 넘어간다.
    }
    try {
      return reader.decode(new BinaryBitmap(new GlobalHistogramBinarizer(source)), hints).getText();
    } catch {
      return null;
    }
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 사진 한 장을 밝기로 펼치기 — 브라우저에서만 돈다
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 고른 사진을 **EXIF 회전을 적용해** 밝기 그림으로 펼친다.
 *
 * 🔴 `imageOrientation: "from-image"` 가 빠지면 세로로 찍은 사진의 가로·세로가
 * 뒤집혀 타일 자리가 전부 어긋난다. 🔴 **줄이지 않는다.**
 *
 * 밝기는 `(R + 2G + B) >> 2` — zxing 의 `RGBLuminanceSource` 와 같은 식이다.
 */
export async function luminanceFromBlob(file: Blob): Promise<LuminanceImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("사진을 펼칠 수 없습니다 (캔버스를 쓸 수 없습니다).");
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const data = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0, p = 0; p < data.length; i += 4, p += 1) {
      data[p] = (rgba[i] + 2 * rgba[i + 1] + rgba[i + 2]) >> 2;
    }
    return { data, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

/** 화면이 받는 결과. 「실패」와 「못 읽음」은 다른 갈래다. */
export type NameplateReadOutcome =
  | { status: "READ"; code: NameplateCode; tile: NameplateTile; ms: number }
  | { status: "UNREAD"; ms: number }
  | { status: "FAILED"; message: string };

/**
 * 고른 사진 한 장에서 명판 QR 을 읽는다. 던지지 않는다.
 *
 * 🔴 사진은 **메모리에서만** 쓴다 — 저장하지 않고 첨부로 올리지도 않는다.
 */
export async function readNameplateFromFile(
  file: Blob,
  decoder: NameplateDecoder
): Promise<NameplateReadOutcome> {
  const startedAt = Date.now();
  try {
    const image = await luminanceFromBlob(file);
    const found = scanNameplateLuminance(image, decoder);
    return found
      ? { status: "READ", code: found.code, tile: found.tile, ms: Date.now() - startedAt }
      : { status: "UNREAD", ms: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
