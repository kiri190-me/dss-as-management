/**
 * ============================================================================
 * 통문증 글자 인식 — **전처리**. 환경에 기대지 않는 순수 계산.
 * ============================================================================
 * 주성엔지니어링이 발행하는 반출·환입 서류(통문증)를 휴대폰으로 찍은 사진에서
 * 「통문번호」를 읽기 위한 앞 단계다. 자르기 · 확대 · 회색조 · 대비정규화 ·
 * 선명화를 **전부 직접 계산한다.**
 *
 * ── 🔴 왜 sharp 도 canvas.drawImage 도 쓰지 않는가 ───────────────────────
 * 그것들은 같은 입력에 환경마다 다른 픽셀을 낸다(라이브러리 판 · 그래픽 드라이버 ·
 * 색공간 변환). 전처리가 환경을 타면 "어느 PC 에서는 읽히고 어느 PC 에서는 안
 * 읽힌다"가 되고, 그 차이는 재현되지 않아 영영 못 잡는다. 여기서 환경에 기대는
 * 단계는 **「JPEG → RGBA 픽셀 배열」 하나뿐**이고 그것은 이 파일 밖에 있다
 * (브라우저는 createImageBitmap, Node 시험은 sharp).
 *
 * ── 🔴 알고리즘과 상수를 바꾸지 마라 ────────────────────────────────────
 * 이 코드와 아래 PRESET_BAND_A 의 값은 **실측으로 고른 것**이다. 통문증 14장에
 * 대해 통문번호 14/14 · 날짜 검산 14/14 를 냈고, 브라우저와 Node 가 전처리된
 * 회색 픽셀까지 똑같았다(2026-10-01 측정). 숫자 하나를 바꾸면 그 성적이 깨진다 —
 * 어느 값이 왜 그 값인지는 자리마다 주석으로 남겨 두었다.
 *
 * 원본은 저장소 밖 측정 폴더의 `lib/preprocess.js` 이고, 이 파일은 알고리즘을
 * 한 줄도 바꾸지 않은 TypeScript 판이다.
 *
 * ── sharp 대응표 ────────────────────────────────────────────────────────
 *   .extract()                 → region
 *   .resize({width,kernel})    → width / kernel
 *   .greyscale()               → toGray   (libvips: 선형광 Rec.709 휘도 → sRGB 재부호화)
 *   .normalise()               → normaliseGray (libvips: L* 로 바꿔 범위를 0~100 으로 늘림)
 *   .sharpen({sigma})          → sharpenGray   (libvips sharpen: L* 언샤프 + 전달함수)
 * ============================================================================
 */

/** RGBA 네 바이트씩 늘어선 그림. 크기는 픽셀 단위다. */
export type RgbaImage = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

/** 회색 한 바이트씩 늘어선 그림. */
export type GrayImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

/** 전체 크기 대비 비율로 적은 자를 상자. */
export type CropRegion = { l: number; t: number; w: number; h: number };

export type ResizeKernel = "bilinear" | "bicubic" | "lanczos3";
export type GrayMode = "vips" | "rec709" | "rec601";

/**
 * 대비정규화의 아래·위 경계.
 *   숫자        — 그 백분위에 해당하는 L* 정수칸
 *   "min"/"max" — 실제 최솟값 / 최댓값
 */
export type NormaliseBound = number | "min" | "max";
export type NormaliseOptions = { lower?: NormaliseBound; upper?: NormaliseBound };

export type SharpenOptions = {
  sigma?: number;
  m1?: number;
  m2?: number;
  x1?: number;
  y2?: number;
  y3?: number;
  minAmpl?: number;
};

export type PreprocessOptions = {
  region?: CropRegion | null;
  width?: number | null;
  kernel?: ResizeKernel;
  gray?: GrayMode;
  normalise?: NormaliseOptions | null;
  sharpen?: SharpenOptions | null;
  threshold?: number | null;
};

/* ────────────────────────────────────────────────────────────────────────── *
 * 0. 색 변환 보조 — 전부 표 또는 수식이라 환경 의존이 없다.
 * ────────────────────────────────────────────────────────────────────────── */

/** sRGB 8비트 → 선형광 0..1 */
const SRGB_TO_LIN = new Float64Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 선형광 0..1 → sRGB 0..1 */
function linToSrgb(y: number): number {
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
}

/** 선형광 Y → CIE L* (D65 백색 Y=1) */
function linToLstar(y: number): number {
  const t = y <= 0 ? 0 : y;
  const f = t > 0.008856451679035631 ? Math.cbrt(t) : (903.2962962962963 * t + 16) / 116;
  return 116 * f - 16;
}

/** L* → 선형광 Y */
function lstarToLin(L: number): number {
  const f = (L + 16) / 116;
  const f3 = f * f * f;
  return f3 > 0.008856451679035631 ? f3 : (116 * f - 16) / 903.2962962962963;
}

/** 회색 8비트 → L* (미리 만든 표) */
const GRAY_TO_LSTAR = new Float64Array(256);
for (let i = 0; i < 256; i += 1) GRAY_TO_LSTAR[i] = linToLstar(SRGB_TO_LIN[i]);

/** L* → 회색 8비트 (반올림 + 자르기) */
function lstarToGray8(L: number): number {
  if (L <= 0) return 0;
  if (L >= 100) return 255;
  const v = Math.round(linToSrgb(lstarToLin(L)) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function clamp255(value: number): number {
  const v = Math.round(value);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 1. 자르기
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 비율 상자로 잘라낸다. sharp 의 `.extract()` 와 **같은 반올림**을 쓴다 — 여기서
 * 한 픽셀이 어긋나면 확대 뒤에는 열 픽셀이 되고 글자 끝이 잘린다.
 */
export function cropRGBA(image: RgbaImage, region?: CropRegion | null): RgbaImage {
  if (!region) return image;
  const W = image.width;
  const H = image.height;
  const left = Math.max(0, Math.round(region.l * W));
  const top = Math.max(0, Math.round(region.t * H));
  let w = Math.min(W, Math.round(region.w * W));
  let h = Math.min(H, Math.round(region.h * H));
  if (left + w > W) w = W - left;
  if (top + h > H) h = H - top;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const s = ((top + y) * W + left) * 4;
    out.set(image.data.subarray(s, s + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 2. 확대/축소 — 분리형 재표본화. 직접 계산하므로 어디서나 같은 값.
 * ────────────────────────────────────────────────────────────────────────── */

function kBilinear(x: number): number {
  const a = x < 0 ? -x : x;
  return a < 1 ? 1 - a : 0;
}

/** Catmull-Rom (a = -0.5) */
function kBicubic(x: number): number {
  const a = x < 0 ? -x : x;
  if (a < 1) return (1.5 * a - 2.5) * a * a + 1;
  if (a < 2) return ((-0.5 * a + 2.5) * a - 4) * a + 2;
  return 0;
}

function kLanczos3(x: number): number {
  const a = x < 0 ? -x : x;
  if (a < 1e-8) return 1;
  if (a >= 3) return 0;
  const px = Math.PI * a;
  return (Math.sin(px) / px) * (Math.sin(px / 3) / (px / 3));
}

const KERNELS: Record<ResizeKernel, { f: (x: number) => number; support: number }> = {
  bilinear: { f: kBilinear, support: 1 },
  bicubic: { f: kBicubic, support: 2 },
  lanczos3: { f: kLanczos3, support: 3 },
};

/** 출력 한 칸마다 (시작 인덱스, 가중치 배열)를 미리 만든다. */
function buildTaps(srcLen: number, dstLen: number, kernel: ResizeKernel) {
  const k = KERNELS[kernel] ?? KERNELS.lanczos3;
  const scale = dstLen / srcLen;
  // 축소할 때만 커널을 늘린다(확대는 원래 폭 그대로).
  const fscale = scale < 1 ? 1 / scale : 1;
  const support = k.support * fscale;
  const starts = new Int32Array(dstLen);
  const counts = new Int32Array(dstLen);
  const maxN = Math.ceil(support * 2) + 2;
  const weights = new Float64Array(dstLen * maxN);
  for (let i = 0; i < dstLen; i += 1) {
    const center = (i + 0.5) / scale - 0.5;
    let lo = Math.ceil(center - support);
    let hi = Math.floor(center + support);
    if (lo < 0) lo = 0;
    if (hi > srcLen - 1) hi = srcLen - 1;
    if (hi < lo) {
      lo = Math.min(srcLen - 1, Math.max(0, Math.round(center)));
      hi = lo;
    }
    const n = hi - lo + 1;
    const base = i * maxN;
    let sum = 0;
    for (let j = 0; j < n; j += 1) {
      const w = k.f((lo + j - center) / fscale);
      weights[base + j] = w;
      sum += w;
    }
    if (sum !== 0) for (let j = 0; j < n; j += 1) weights[base + j] /= sum;
    starts[i] = lo;
    counts[i] = n;
  }
  return { starts, counts, weights, maxN };
}

/**
 * RGBA 를 목표 폭으로 재표본화한다(높이는 비율 유지).
 * 중간값을 float 로 들고 가는 것이 sharp 와 같은 결과를 내는 조건이다.
 */
export function resizeRGBA(image: RgbaImage, dstW: number, kernel: ResizeKernel): RgbaImage {
  const sw = image.width;
  const sh = image.height;
  const src = image.data;
  if (!dstW || dstW === sw) return image;
  const dstH = Math.max(1, Math.round(sh * (dstW / sw)));

  // 가로 패스: (dstW x sh x 3) float
  const hx = buildTaps(sw, dstW, kernel);
  const tmp = new Float32Array(dstW * sh * 3);
  for (let y = 0; y < sh; y += 1) {
    const srow = y * sw * 4;
    const trow = y * dstW * 3;
    for (let x = 0; x < dstW; x += 1) {
      const base = x * hx.maxN;
      const s0 = hx.starts[x];
      const n = hx.counts[x];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < n; j += 1) {
        const w = hx.weights[base + j];
        const p = srow + (s0 + j) * 4;
        r += w * src[p];
        g += w * src[p + 1];
        b += w * src[p + 2];
      }
      const t = trow + x * 3;
      tmp[t] = r;
      tmp[t + 1] = g;
      tmp[t + 2] = b;
    }
  }

  // 세로 패스
  const vy = buildTaps(sh, dstH, kernel);
  const out = new Uint8Array(dstW * dstH * 4);
  for (let oy = 0; oy < dstH; oy += 1) {
    const vbase = oy * vy.maxN;
    const v0 = vy.starts[oy];
    const vn = vy.counts[oy];
    const orow = oy * dstW * 4;
    for (let ox = 0; ox < dstW; ox += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < vn; k += 1) {
        const w = vy.weights[vbase + k];
        const q = ((v0 + k) * dstW + ox) * 3;
        r += w * tmp[q];
        g += w * tmp[q + 1];
        b += w * tmp[q + 2];
      }
      const o = orow + ox * 4;
      out[o] = clamp255(r);
      out[o + 1] = clamp255(g);
      out[o + 2] = clamp255(b);
      out[o + 3] = 255;
    }
  }
  return { data: out, width: dstW, height: dstH };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 3. 회색조
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * mode
 *  "vips"   — libvips/sharp `.greyscale()` 와 같은 길:
 *             sRGB → 선형광 → Rec.709 휘도 → sRGB 재부호화. **기본값이다.**
 *  "rec709" — 감마값 그대로 0.2126/0.7152/0.0722
 *  "rec601" — 감마값 그대로 0.299/0.587/0.114 (브라우저 canvas 류가 흔히 쓰는 식)
 */
export function toGray(image: RgbaImage, mode: GrayMode): GrayImage {
  const n = image.width * image.height;
  const out = new Uint8Array(n);
  const d = image.data;
  if (mode === "rec601" || mode === "rec709") {
    const a = mode === "rec601" ? 0.299 : 0.2126;
    const b = mode === "rec601" ? 0.587 : 0.7152;
    const c = mode === "rec601" ? 0.114 : 0.0722;
    for (let i = 0, p = 0; i < n; i += 1, p += 4) {
      out[i] = clamp255(a * d[p] + b * d[p + 1] + c * d[p + 2]);
    }
    return { data: out, width: image.width, height: image.height };
  }
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const Y =
      0.2126 * SRGB_TO_LIN[d[p]] + 0.7152 * SRGB_TO_LIN[d[p + 1]] + 0.0722 * SRGB_TO_LIN[d[p + 2]];
    out[i] = clamp255(linToSrgb(Y) * 255);
  }
  return { data: out, width: image.width, height: image.height };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 4. 대비 정규화 (sharp `.normalise()`)
 *
 *  sharp src/operations.cc Normalise():
 *    LAB 의 L 만 꺼내 min = percent(lower), max = percent(upper) (정수)
 *    f = 100/(max-min), a = -min*f  →  L' = L*f + a  → 원래 색공간으로
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 실측 기록(2026-10-01):
 *   sharp 0.33.5 의 기본값 {lower:1, upper:99} 가 실제로 고르는 상한은 99 백분위가
 *   아니라 **L* 최댓값을 올림한 값**이었다(14장 모두). 하한은 1 백분위 칸 +1.
 *   숫자 99 를 그대로 쓰면 sharp 보다 훨씬 센 대비 확장이 되어 결과가 달라진다.
 */
export function normaliseGray(gray: GrayImage, options?: NormaliseOptions | null): GrayImage {
  const lower: NormaliseBound = options?.lower ?? 1;
  const upper: NormaliseBound = options?.upper ?? "max";
  const d = gray.data;
  const n = d.length;

  // 회색 8비트 → L* 는 1:1 단조 대응이므로 256칸 히스토그램이면 충분하다.
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i += 1) hist[d[i]] += 1;

  // L* 정수칸(0..100) 히스토그램 — sharp 가 정수 임계값을 쓰기 때문이다.
  const lh = new Float64Array(101);
  let minBin = 100;
  let maxBin = 0;
  for (let g = 0; g < 256; g += 1) {
    if (!hist[g]) continue;
    let bin = Math.round(GRAY_TO_LSTAR[g]);
    if (bin < 0) bin = 0;
    if (bin > 100) bin = 100;
    lh[bin] += hist[g];
    if (bin < minBin) minBin = bin;
    if (bin > maxBin) maxBin = bin;
  }

  const min = normaliseBound(lh, n, lower, minBin, maxBin, false);
  const max = normaliseBound(lh, n, upper, minBin, maxBin, true);

  // sharp 과 같은 예외 처리 — 범위가 한 칸 이하면 늘리지 않는다.
  if (!(Math.abs(max - min) > 1)) return gray;

  const f = 100 / (max - min);
  const a = -(min * f);

  // 회색값 256개에 대한 대응표만 만들면 된다.
  const lut = new Uint8Array(256);
  for (let g = 0; g < 256; g += 1) lut[g] = lstarToGray8(GRAY_TO_LSTAR[g] * f + a);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = lut[d[i]];
  return { data: out, width: gray.width, height: gray.height };
}

function normaliseBound(
  lh: Float64Array,
  total: number,
  spec: NormaliseBound,
  minBin: number,
  maxBin: number,
  isUpper: boolean
): number {
  if (spec === "min") return minBin;
  // 실측: sharp 는 최댓값 칸보다 하나 위를 쓴다.
  if (spec === "max") return maxBin + 1;
  if (spec === 0) return minBin;
  if (spec === 100) return maxBin;
  const want = (total * spec) / 100;
  let cum = 0;
  for (let i = 0; i <= 100; i += 1) {
    cum += lh[i];
    // 실측: 하한은 한 칸 위다.
    if (cum >= want) return isUpper ? i : i + 1;
  }
  return maxBin;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 5. 선명화 (sharp `.sharpen({sigma})` == libvips vips_sharpen)
 *
 *  libvips sharpen.c:
 *    LabS 로 바꿔 L 만 꺼낸다 → gaussblur(sigma) → diff = L - blur
 *    전달함수: |diff| < x1 이면 기울기 m1, 아니면 m2 (x1 에서 이어붙임)
 *              결과를 [-y3, +y2] 로 자른다
 *    L' = L + 전달함수(diff)
 *  sharp 기본값: m1=1, m2=2, x1=2, y2=10, y3=20
 * ────────────────────────────────────────────────────────────────────────── */

/** libvips vips_gaussmat 과 같은 기준으로 가우시안 마스크를 만든다. */
function gaussMask(sigma: number, minAmpl: number) {
  const radius = Math.max(1, Math.ceil(sigma * Math.sqrt(-2 * Math.log(minAmpl))));
  const mask = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    mask[i + radius] = v;
    sum += v;
  }
  for (let j = 0; j < mask.length; j += 1) mask[j] /= sum;
  return { mask, radius };
}

function blurF32(
  src: Float32Array,
  w: number,
  h: number,
  mask: Float64Array,
  radius: number
): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        let xx = x + k;
        // 가장자리는 복제한다(libvips 와 같다).
        if (xx < 0) xx = 0;
        else if (xx >= w) xx = w - 1;
        acc += mask[k + radius] * src[row + xx];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        let yy = y + k;
        if (yy < 0) yy = 0;
        else if (yy >= h) yy = h - 1;
        acc += mask[k + radius] * tmp[yy * w + x];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

export function sharpenGray(gray: GrayImage, options?: SharpenOptions | null): GrayImage {
  const sigma = options?.sigma ?? 1.2;
  const m1 = options?.m1 ?? 1;
  const m2 = options?.m2 ?? 2;
  const x1 = options?.x1 ?? 2;
  const y2 = options?.y2 ?? 10;
  const y3 = options?.y3 ?? 20;
  const minAmpl = options?.minAmpl ?? 0.2;

  const w = gray.width;
  const h = gray.height;
  const n = w * h;
  const d = gray.data;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i += 1) L[i] = GRAY_TO_LSTAR[d[i]];

  const gm = gaussMask(sigma, minAmpl);
  const B = blurF32(L, w, h, gm.mask, gm.radius);

  const out = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) {
    const diff = L[p] - B[p];
    let y: number;
    if (diff < -x1) y = (diff + x1) * m2 + -x1 * m1;
    else if (diff < x1) y = diff * m1;
    else y = (diff - x1) * m2 + x1 * m1;
    if (y < -y3) y = -y3;
    else if (y > y2) y = y2;
    out[p] = lstarToGray8(L[p] + y);
  }
  return { data: out, width: w, height: h };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 6. 2진화 (sharp `.threshold()` 대응 — 참고용. 기본 경로에는 쓰지 않는다)
 * ────────────────────────────────────────────────────────────────────────── */

export function thresholdGray(gray: GrayImage, t: number): GrayImage {
  const n = gray.data.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = gray.data[i] >= t ? 255 : 0;
  return { data: out, width: gray.width, height: gray.height };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 7. 전체 파이프라인
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 **통문증에 쓰는 설정.** 숫자 하나하나가 실측으로 고른 값이다.
 *
 * `region` — 「통문정보」 띠. 통문번호와 통문작성일이 나란히 있는 왼쪽 위 구역이다.
 *   서류 전체를 넣으면 글자가 너무 작아져 번호를 놓치고, 좁히면 작성일이 잘려
 *   **날짜 검산이 불가능해진다.** 왼쪽 0.00 · 위 0.14 · 너비 0.52 · 높이 0.22.
 *
 * `width` — 1800px. 더 키우면 느려지기만 하고 성적이 같았다.
 *
 * `kernel` — lanczos3. bicubic · bilinear 로도 14/14 였지만 가장 선명했다.
 *
 * `normalise` — 전구간 늘이기({min, max}). 측정 성적(14장 기준):
 *     {lower:"min", upper:"max"} → 통문번호 14/14 · 날짜검산 14/14
 *     {lower:1,     upper:"max"} → 통문번호 14/14 · 날짜검산 12/14
 *     {lower:1,     upper:99}    → 통문번호 14/14 · 날짜검산 12/14
 *   🔴 날짜 검산이 오독을 잡아내는 장치라 14/14 인 쪽을 쓴다.
 *
 * `sharpen` — sigma 1.2. 끄면 워터마크가 옅은 사진에서 떨어졌다.
 */
export const PRESET_BAND_A: Required<
  Pick<PreprocessOptions, "region" | "width" | "kernel" | "gray" | "normalise" | "sharpen">
> = {
  region: { l: 0.0, t: 0.14, w: 0.52, h: 0.22 },
  width: 1800,
  kernel: "lanczos3",
  gray: "vips",
  normalise: { lower: "min", upper: "max" },
  sharpen: { sigma: 1.2 },
};

/** 글자 인식기에 주는 쪽 나눔 방식. 6 = 「하나의 균일한 글자 덩어리」. */
export const PASS_SLIP_PAGE_SEG_MODE = "6";

/* ────────────────────────────────────────────────────────────────────────── *
 * 7-나. 물품정보 표 — PRV No. · Q코드
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 **물품정보 표의 자리.** 통문증 14장 측정으로 고른 값이다(2026-10-01).
 *
 * 「항번 + Part No./모델명 + 품명 및 규격」 세 칸까지만 담고 **비고 칸은 자른다** —
 * 비고까지 넣으면 글줄이 길어져 psm 4 가 한 줄로 묶지 못한다.
 *
 * 🔴 **파주 양식과 구미 양식이 이 한 좌표로 둘 다 된다.** 사업장별로 가르지 마라 —
 * 가르는 순간 「어느 사업장인가」를 먼저 알아내야 하는데, 그것을 알 길이 사진
 * 안에 확실히 있지 않다.
 */
export const PASS_SLIP_GOODS_REGION: CropRegion = {
  l: 0.035,
  t: 0.385,
  w: 0.65,
  h: 0.15,
};

/**
 * 🔴 **물품정보 표는 psm 4 로 읽는다. 이것이 핵심이었다.**
 *
 * 같은 그림을 psm 6 으로 읽으면 Q코드 7/14, psm 4 로 읽으면 **14/14** 다
 * (2026-10-01 측정). psm 6 은 「하나의 균일한 글자 덩어리」라 표의 가로 테두리를
 * 글줄에 섞어 **첫 줄을 통째로 깨뜨린다.** 4 는 「크기가 제각각인 글줄이 한 단에
 * 늘어선 것」이라 표의 줄을 줄대로 읽는다. 바꾸지 마라.
 *
 * 통문정보 띠(PASS_SLIP_PAGE_SEG_MODE = 6)와 **다르다** — 띠는 테두리가 없는
 * 글자 덩어리라 6 이 맞는다. 둘을 하나로 맞추려 들지 마라.
 */
export const PASS_SLIP_GOODS_PAGE_SEG_MODE = "4";

/** 전처리 설정 한 벌 + 그것으로 읽을 때의 쪽 나눔 방식. */
export type PassSlipPass = {
  /** 기록·시험에서 부르는 이름. */
  name: string;
  options: PreprocessOptions;
  pageSegMode: string;
};

/**
 * 🔴 **물품정보는 설정이 다른 세 번을 읽어 투표한다.** 한 번만 읽으면 글자 하나가
 * 틀려도 그대로 칸에 들어간다. 셋 가운데 둘 이상이 같은 값을 냈을 때만 쓴다
 * (판정은 pass-slip-goods.ts).
 *
 * 세 설정이 **일부러 서로 다르다** — 같은 설정을 세 번 돌리면 글자 인식기가
 * 결정적이라 **언제나 같은 답**이 나와 투표가 아무 일도 하지 않는다. 크기(1800 ·
 * 3000 · 2400)와 선명화 유무를 바꾼 것이 측정에서 서로 다른 오독을 냈다.
 *
 * 🔴 대비정규화가 통문번호 띠(`{min, max}`)와 **다르다**(`{1, max}`). 측정에 쓴
 * 그대로다 — 맞추려 들지 마라.
 */
export const PASS_SLIP_GOODS_PASSES: readonly PassSlipPass[] = [
  {
    name: "A1800",
    options: {
      region: PASS_SLIP_GOODS_REGION,
      width: 1800,
      kernel: "lanczos3",
      gray: "vips",
      normalise: { lower: 1, upper: "max" },
      sharpen: { sigma: 1.2 },
    },
    pageSegMode: PASS_SLIP_GOODS_PAGE_SEG_MODE,
  },
  {
    name: "B3000n",
    options: {
      region: PASS_SLIP_GOODS_REGION,
      width: 3000,
      kernel: "lanczos3",
      gray: "vips",
      normalise: { lower: 1, upper: "max" },
      sharpen: null,
    },
    pageSegMode: PASS_SLIP_GOODS_PAGE_SEG_MODE,
  },
  {
    name: "C2400",
    options: {
      region: PASS_SLIP_GOODS_REGION,
      width: 2400,
      kernel: "lanczos3",
      gray: "vips",
      normalise: { lower: 1, upper: "max" },
      sharpen: { sigma: 1.2 },
    },
    pageSegMode: PASS_SLIP_GOODS_PAGE_SEG_MODE,
  },
];

/** 통문번호 띠 한 패스. 위 물품정보 세 패스와 같은 모양으로 묶어 둔다. */
export const PASS_SLIP_BAND_A_PASS: PassSlipPass = {
  name: "BAND_A",
  options: PRESET_BAND_A,
  pageSegMode: PASS_SLIP_PAGE_SEG_MODE,
};

/**
 * 전처리 워커에 「무엇을 만들어 달라」고 말할 때 쓰는 이름.
 *
 * 🔴 사진 한 장을 **한 번만 펼쳐**(JPEG 디코드) 네 가지 전처리가 나눠 쓰기 위한
 * 것이다. 영역마다 따로 부르면 디코드가 네 번 돌아 한 장이 몇 배로 느려진다.
 */
export type PassSlipPassName = "BAND_A" | "A1800" | "B3000n" | "C2400";

/** 이름 → 그 패스. 워커가 이 표로만 설정을 고른다(화면이 설정을 보내지 않는다). */
export const PASS_SLIP_PASSES: Record<PassSlipPassName, PassSlipPass> = {
  BAND_A: PASS_SLIP_BAND_A_PASS,
  A1800: PASS_SLIP_GOODS_PASSES[0],
  B3000n: PASS_SLIP_GOODS_PASSES[1],
  C2400: PASS_SLIP_GOODS_PASSES[2],
};

/** 물품정보 세 패스의 이름만. 화면·시험이 차례를 그대로 쓴다. */
export const PASS_SLIP_GOODS_PASS_NAMES: readonly PassSlipPassName[] = [
  "A1800",
  "B3000n",
  "C2400",
];

/**
 * 자르기 → 확대 → 회색조 → 대비정규화 → 선명화. 결과는 회색 1바이트/픽셀.
 */
export function prepare(rgba: RgbaImage, options: PreprocessOptions = PRESET_BAND_A): GrayImage {
  let image = cropRGBA(rgba, options.region);
  if (options.width) image = resizeRGBA(image, options.width, options.kernel ?? "lanczos3");
  let gray = toGray(image, options.gray ?? "vips");
  if (options.normalise) gray = normaliseGray(gray, options.normalise);
  if (options.sharpen) gray = sharpenGray(gray, options.sharpen);
  if (options.threshold) gray = thresholdGray(gray, options.threshold);
  return gray;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 8. 순수 JS PNG 인코더 (8비트 회색조, deflate "stored" 블록)
 *
 * 글자 인식기에 넘기는 **바이트까지** 어디서나 똑같게 만들기 위한 것이다.
 * 압축을 하지 않으므로 환경별 zlib 차이가 끼어들 여지가 없다. 대신 파일이 크지만
 * 디스크에 쓰지 않고 메모리에서 바로 넘기므로 상관없다.
 * ────────────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i += 1) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32(b: Uint8Array, p: number, v: number): void {
  b[p] = (v >>> 24) & 0xff;
  b[p + 1] = (v >>> 16) & 0xff;
  b[p + 2] = (v >>> 8) & 0xff;
  b[p + 3] = v & 0xff;
}

function writeChunk(png: Uint8Array, offset: number, type: string, data: Uint8Array): number {
  let o = offset;
  writeUint32(png, o, data.length);
  o += 4;
  const typeStart = o;
  for (let i = 0; i < 4; i += 1) {
    png[o] = type.charCodeAt(i);
    o += 1;
  }
  png.set(data, o);
  o += data.length;
  writeUint32(png, o, crc32(png, typeStart, o));
  o += 4;
  return o;
}

export function encodeGrayPNG(gray: Uint8Array, width: number, height: number): Uint8Array {
  // 1) 필터 바이트 0 을 줄마다 앞에 붙인 원시 데이터
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    raw.set(gray.subarray(y * width, y * width + width), y * (width + 1) + 1);
  }
  // 2) zlib: 헤더 2바이트 + stored 블록들 + adler32
  const blocks = Math.ceil(raw.length / 65535) || 1;
  const z = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let zp = 0;
  z[zp] = 0x78;
  zp += 1;
  z[zp] = 0x01;
  zp += 1;
  let off = 0;
  for (let bi = 0; bi < blocks; bi += 1) {
    const len = Math.min(65535, raw.length - off);
    z[zp] = bi === blocks - 1 ? 1 : 0;
    zp += 1;
    z[zp] = len & 0xff;
    zp += 1;
    z[zp] = (len >>> 8) & 0xff;
    zp += 1;
    z[zp] = ~len & 0xff;
    zp += 1;
    z[zp] = (~len >>> 8) & 0xff;
    zp += 1;
    z.set(raw.subarray(off, off + len), zp);
    zp += len;
    off += len;
  }
  const ad = adler32(raw);
  z[zp] = (ad >>> 24) & 0xff;
  zp += 1;
  z[zp] = (ad >>> 16) & 0xff;
  zp += 1;
  z[zp] = (ad >>> 8) & 0xff;
  zp += 1;
  z[zp] = ad & 0xff;
  zp += 1;

  // 3) PNG 컨테이너
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type 0 = greyscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = new Uint8Array(8 + (12 + 13) + (12 + z.length) + 12);
  let o = 0;
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], o);
  o += 8;
  o = writeChunk(png, o, "IHDR", ihdr);
  o = writeChunk(png, o, "IDAT", z);
  writeChunk(png, o, "IEND", new Uint8Array(0));
  return png;
}
