/**
 * ============================================================================
 * 명판 네모 한 칸을 **글자로** 읽는다 — 전처리 조합과 읽는 차례
 * ============================================================================
 * QR 이 안 읽히는 명판(2013년 구 양식에는 QR 이 아예 인쇄돼 있지 않다)을 위해
 * 사람이 표 위에 네모를 치면, 그 **원본 해상도 영역**을 여러 모양으로 다듬어
 * 글자 인식기에 거듭 넣는다.
 *
 * ── 🔴 왜 한 번이 아니라 열여덟 번인가 ─────────────────────────────────
 * 구 양식 표는 **한 표 안에 흰 글자와 검은 글자가 섞여 있다** — `Wt` `INPUT:`
 * `L/N` 같은 말머리는 검은 칸에 흰 글자로, 값은 흰 칸에 검은 글자로 찍혀
 * 있다. 그래서 어느 한 조합도 세 칸을 다 주지 못한다. 뒤집은 그림에서
 * 말머리가 나오고, 안 뒤집은 그림에서 값이 나온다.
 *
 *   뒤집음 2 × 이진화 3(없음·128·160) × 쪽나눔 3(psm 6·4·11) = **18 번**
 *
 * 🔴 **조합을 줄이지 마라.** 느리다고 줄이면 성적이 그대로 떨어진다. 나온 글은
 * 전부 합쳐서 `nameplate-text.ts` 가 꼴과 대조로 걸러낸다.
 *
 * ── 🔴 사진 전체를 넣지 않는다 ─────────────────────────────────────────
 * 실측 0/4 였다(2026-10-02). 명판 표를 자동으로 찾아내는 것도 되지 않았다 —
 * 그래서 **사람이 네모를 친다.** 이 모듈은 그 네모를 받는다.
 *
 * ── 🔴 글자 인식기는 주입받는다 ────────────────────────────────────────
 * 브라우저에서는 `/ocr/` 의 tesseract.js 로, Node 시험에서는 같은 엔진을
 * 직접 끼워 **같은 전처리 바이트**를 보게 한다. 전처리는 전부
 * `pass-slip-preprocess.ts` 의 순수 함수라 환경에 따라 달라지지 않는다.
 *
 * ── 🔴 **정밀판 언어 자료(tessdata_best)는 쓰지 않는다 — 재 보고 뺐다** ──
 * 「더 정확한 모델을 쓰면 낫지 않겠나」는 당연히 떠오르는 생각이고, 실제로
 * 받아서 쟀다(2026-10-02, 구 양식 5장 × 지금 1단계 18조합 그대로):
 *
 *                      표준판(5.2MB)   정밀판(15.4MB)
 *   모델명                   0              0
 *   모델명 조각              0              0
 *   L/N                      5              6
 *   S/N                     34             34
 *   한 바퀴 평균           801ms         **1239ms**
 *
 * **차이가 사실상 없고 55% 느리며 저장소가 10MB 는다.** 명판 글자가 작아서
 * 지는 것이지 모델이 모자라서 지는 것이 아니다 — 같은 까닭으로 배율·기울기
 * 쓸기도 도움이 안 됐다(아래 `stage1NameplateSettings`). 🔴 다시 넣어 보려거든
 * 이 표를 먼저 볼 것. 올릴 것은 모델이 아니라 **사진 속 명판의 크기**다.
 * ============================================================================
 */

import {
  cropRGBA,
  encodeGrayPNG,
  normaliseGray,
  resizeRGBA,
  thresholdGray,
  toGray,
  type CropRegion,
  type GrayImage,
  type RgbaImage,
} from "./pass-slip-preprocess";
import { readNameplateFromTexts, type NameplateTextReading } from "./nameplate-text";

/**
 * 🔴 네모 안을 이 폭까지 늘린다. 2000px 는 실측으로 고른 값이다 — 카카오톡이
 * 1440px 로 줄여 보낸 사진에서도 표 한 칸이 글자 인식기가 볼 만한 크기가 된다.
 */
export const NAMEPLATE_OCR_WIDTH = 2000;

/**
 * 🔴 글자 제한. 명판에 한글도 소문자도 없다 — 풀어 주면 `1` 이 `l` 로,
 * `0` 이 `o` 로 나와 꼴 검사가 전부 미끄러진다.
 */
export const NAMEPLATE_OCR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/.:";

/** 쪽 나눔 방식 셋. 6 = 한 덩어리 · 4 = 글줄이 한 단에 늘어선 것 · 11 = 흩어진 글. */
export const NAMEPLATE_OCR_PAGE_SEG_MODES: readonly string[] = ["6", "4", "11"];

/** 그림 한 벌을 어떻게 다듬는가. */
export type NameplateOcrVariant = {
  /** 🔴 흰 글자(검은 칸)를 읽으려면 뒤집어야 한다. */
  invert: boolean;
  /** 이진화 문턱. `null` 이면 회색 그대로 넣는다. */
  threshold: number | null;
};

/** 🔴 여섯 가지 그림. 줄이지 마라 — 실측에서 쓸 만했던 조합 그대로다. */
export const NAMEPLATE_OCR_VARIANTS: readonly NameplateOcrVariant[] = [
  { invert: false, threshold: null },
  { invert: false, threshold: 128 },
  { invert: false, threshold: 160 },
  { invert: true, threshold: null },
  { invert: true, threshold: 128 },
  { invert: true, threshold: 160 },
];

/**
 * 회색 그림을 가운데를 축으로 돌린다. 크기는 그대로.
 *
 * 🔴 **손으로 찍은 사진은 늘 조금 기울어 있다.** 1~2도만 틀어져도 글자 인식기가
 * 글줄을 하나로 묶지 못해 표가 통째로 깨진다. 실측에서 읽힌 조합의 상당수가
 * ±2도 돌린 쪽이었다.
 *
 * 바깥으로 나가는 자리는 **가장자리 픽셀로 메운다**(clamp). 흰색이나 검은색으로
 * 메우면 네 귀퉁이에 없던 테두리가 생겨 글자 인식기가 그것을 글줄로 읽는다.
 * ±2도에서 잘려 나가는 것은 귀퉁이 몇 픽셀뿐이라 글자에 닿지 않는다.
 */
export function rotateGray(gray: GrayImage, degrees: number): GrayImage {
  if (degrees === 0) return gray;
  const { width: w, height: h, data } = gray;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const dy = y - cy;
    for (let x = 0; x < w; x += 1) {
      const dx = x - cx;
      // 결과 픽셀이 원본의 어디에서 왔는지(역변환) 본다.
      let sx = cos * dx + sin * dy + cx;
      let sy = -sin * dx + cos * dy + cy;
      if (sx < 0) sx = 0;
      else if (sx > w - 1) sx = w - 1;
      if (sy < 0) sy = 0;
      else if (sy > h - 1) sy = h - 1;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1 > w - 1 ? w - 1 : x0 + 1;
      const y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
      const fx = sx - x0;
      const fy = sy - y0;
      const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
      const bottom = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
      out[y * w + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return { data: out, width: w, height: h };
}

/** 회색을 뒤집는다. 검은 칸의 흰 글자를 「흰 칸의 검은 글자」로 만든다. */
export function invertGray(gray: GrayImage): GrayImage {
  const out = new Uint8Array(gray.data.length);
  for (let i = 0; i < gray.data.length; i += 1) out[i] = 255 - gray.data[i];
  return { data: out, width: gray.width, height: gray.height };
}

/** 회색 한 장을 RGBA 로 편다. 확대 함수가 RGBA 만 받기 때문이다. */
function grayToRgba(gray: GrayImage): RgbaImage {
  const out = new Uint8Array(gray.data.length * 4);
  for (let p = 0, i = 0; p < gray.data.length; p += 1, i += 4) {
    const v = gray.data[p];
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { data: out, width: gray.width, height: gray.height };
}

/**
 * 네모 안을 **한 번만** 다듬는다 — 자르기 → 회색조 → 대비정규화.
 *
 * 🔴 **아직 확대하지 않는다.** 확대는 뒤집기·이진화 **뒤**다 — 차례를 바꾸면
 * 성적이 무너진다(아래 `applyNameplateVariant` 참조).
 *
 * 🔴 **선명화(sharpen)는 하지 않는다. 넣어 보고 뺀 것이다.** 통문증 쪽
 * (`PRESET_BAND_A`)이 `sigma 1.2` 로 선명화를 쓰기에 같이 걸어 봤더니 구 양식
 * 4장 성적이 이렇게 됐다(2026-10-02 실측):
 *
 *            선명화 없음        선명화 1.2
 *   Model    1장 + 비김 2장  →  0장          🔴 전멸
 *   L/N      1장            →  0장          🔴 전멸
 *   S/N      3장            →  3장
 *
 * 확대 배율이 5~6배라 선명화가 글자 테두리에 만드는 후광이 그대로 커져
 * 이진화를 먹어 버린다. 통문증은 1800px 로 1.5배쯤 늘릴 뿐이라 사정이 다르다.
 */
export function prepareNameplateBase(rgba: RgbaImage, region: CropRegion | null): GrayImage {
  return normaliseGray(toGray(cropRGBA(rgba, region), "vips"), { lower: "min", upper: "max" });
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 🔴 **사진 속 명판이 작으면 미리 알려 준다**
 *
 * 지금까지 잰 것 가운데 성적을 가장 잘 설명하는 것은 모델도 배율도 기울기도
 * 아니라 **네모 안의 원본 픽셀 폭**이었다(2026-10-02, 구 양식 5장):
 *
 *   네모 폭   Model            L/N(자동)   S/N
 *   756px    CMK150M-IC2 ○    후보4위     ○      ← 유일한 원본 화질
 *   389px    MBK150M-IC1 ○    —           ○
 *   360px    —                —           —      ← 아무것도 안 나왔다
 *   346px    비김             WZ6216 ○    ○
 *   310px    비김             후보1위     ○
 *
 * **600px 를 경계로 삼는다.** 다섯 장이 756 과 310~389 로 뚝 갈려 그 사이에
 * 자료가 없다 — 가운데를 잡았다. 756px 한 장만이 모델명을 **편집거리로** 깔끔히
 * 집었고, 나머지 넷은 넷 다 무언가를 잃었다(모델이 비기거나 L/N 이 후보로만
 * 남거나 아예 아무것도 안 나왔다).
 *
 * 🔴 **읽기를 막지는 않는다.** 작아도 S/N 은 다섯 중 넷에서 나온다 — 막으면
 * 지금 되는 것까지 못 쓰게 된다. 알리기만 한다.
 * ────────────────────────────────────────────────────────────────────────── */

/** 이 폭보다 좁으면 「작게 찍혔다」고 알린다(원본 픽셀 기준). */
export const NAMEPLATE_SMALL_REGION_WIDTH = 600;

/** 비율로 친 네모가 **원본 사진에서 몇 픽셀**인가. */
export function nameplateRegionPixelWidth(regionWidth: number, imageWidth: number): number {
  return Math.max(0, Math.round(regionWidth * imageWidth));
}

/** 가까이서 다시 찍으라고 할 만큼 작은가. */
export function isNameplateRegionSmall(pixelWidth: number): boolean {
  return pixelWidth > 0 && pixelWidth < NAMEPLATE_SMALL_REGION_WIDTH;
}

/** 한 바퀴를 어떤 **배율·기울기**로 돌 것인가. */
export type NameplateOcrSetting = {
  /** 늘릴 목표 폭(px). */
  width: number;
  /** 가운데를 축으로 돌릴 각도(도). 0 이면 안 돌린다. */
  rotateDegrees: number;
};

/** 같은 설정인가 — 2단계가 1단계에서 이미 돈 것을 또 돌지 않게 한다. */
export function sameNameplateSetting(a: NameplateOcrSetting, b: NameplateOcrSetting): boolean {
  return a.width === b.width && a.rotateDegrees === b.rotateDegrees;
}

/**
 * 다듬어 둔 회색에 **기울기 → 뒤집기 → 이진화 → 늘리기** 를 이 차례로 입힌다.
 *
 * 🔴 **차례가 전부다.** 먼저 늘리고 나중에 이진화하면 글자 테두리가 톱니처럼
 * 거칠어져, 한 줄에 붙어 있는 `TYPE` 과 `S/N` 이 **한 덩어리로 붙어** 읽힌다
 * (실측: `CMK150M-1C2IJ4N1307009` 처럼 모델명과 일련번호가 글자 하나 없이
 * 이어졌다). 먼저 이진화하고 lanczos3 로 늘리면 테두리가 부드럽게 보간돼
 * 글자 사이가 벌어진다. 측정에 쓴 차례가 이쪽이다.
 *
 * 기울기는 **맨 앞**이다 — 원본 해상도에서 돌려야 보간 손실이 가장 적다.
 *
 * 네모가 이미 목표 폭보다 넓으면 줄이지 않는다 — 원본 해상도 사진에서 명판을
 * 크게 찍었을 때 일부러 작게 만들 까닭이 없다.
 */
export function applyNameplateVariant(
  base: GrayImage,
  variant: NameplateOcrVariant,
  setting: NameplateOcrSetting = { width: NAMEPLATE_OCR_WIDTH, rotateDegrees: 0 }
): GrayImage {
  const turned = rotateGray(base, setting.rotateDegrees);
  const flipped = variant.invert ? invertGray(turned) : turned;
  const binary = variant.threshold === null ? flipped : thresholdGray(flipped, variant.threshold);
  if (binary.width >= setting.width) return binary;
  return toGray(resizeRGBA(grayToRgba(binary), setting.width, "lanczos3"), "vips");
}

/** 글자 인식기에 넘길 회색 PNG 한 벌. */
export type NameplateOcrImage = {
  variant: NameplateOcrVariant;
  png: Uint8Array;
  width: number;
  height: number;
};

/** 다듬어 둔 바탕에서 조합 하나의 PNG 를 만든다. */
export function buildNameplateOcrImage(
  base: GrayImage,
  variant: NameplateOcrVariant,
  setting?: NameplateOcrSetting
): NameplateOcrImage {
  const gray = applyNameplateVariant(base, variant, setting);
  return {
    variant,
    png: encodeGrayPNG(gray.data, gray.width, gray.height),
    width: gray.width,
    height: gray.height,
  };
}

/**
 * 글자 인식기. 회색 PNG 와 쪽 나눔 방식을 받아 **날것의 글**을 돌려준다.
 *
 * 🔴 주입받는 까닭 — 브라우저는 `/ocr/` 의 tesseract.js 를, Node 시험은 같은
 * 엔진을 직접 끼운다. 이 모듈 자체는 어느 쪽에도 기대지 않는다.
 */
export type NameplateRecognizer = (png: Uint8Array, pageSegMode: string) => Promise<string>;

/** 한 번 읽은 기록. 보고가 「무엇이 날것으로 나왔는가」를 적을 때 쓴다. */
export type NameplatePassText = {
  setting: NameplateOcrSetting;
  variant: NameplateOcrVariant;
  pageSegMode: string;
  text: string;
};

export type NameplateOcrOutcome = {
  reading: NameplateTextReading;
  /** 🔴 **이번에 돈 것 + 앞서 돈 것**을 전부 담는다(2단계가 1단계를 지우지 않는다). */
  passes: NameplatePassText[];
  /** 이번 outcome 을 만드는 데 쓴 설정들(앞서 돈 것 포함). */
  settings: NameplateOcrSetting[];
  ms: number;
};

/* ────────────────────────────────────────────────────────────────────────── *
 * 🔴 1단계·2단계 — 「배율을 얼마로 할 것인가」
 *
 * 고정 2000px 은 최선이 아니다. 네모 폭이 사진마다 310px ~ 756px 로 두 배 넘게
 * 차이 나는데 무조건 2000px 로 키우면 배율이 2.6배~6.5배로 제각각이 된다.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 **1단계는 2000px 한 바퀴뿐이다. 배율로 바꾸거나 기울기를 더하지 마라.**
 *
 * 「네모 크기에 맞춰 배율을 정하고 기울기도 쓸면 더 잘 읽히지 않겠나」는
 * 그럴듯하고, **날것의 글만 보면 실제로 더 잘 읽힌다.** 그런데 끝까지 돌려
 * 「칸에 무엇이 들어가는가」로 재면 **정반대**였다(2026-10-02, 구 양식 5장을
 * 다섯 가지 설정으로 끝까지 돌린 결과):
 *
 *   설정                       모델  L/N자동  S/N   🔴틀린 값
 *   A 2000px 고정 · 기울기 0    2/5    1/5    4/5    **0**
 *   B 네모×4 [1400,3000]       2/5    1/5    4/5      1   (S/N 1301013)
 *   C A + B 둘 다               2/5    2/5    4/5      2
 *   D 2000px × 기울기 -2/0/+2   2/5    1/5    3/5    **5**
 *   E 네모×4 × 기울기 -2/0/+2   2/5    0/5    4/5    **5** (모델까지 틀렸다)
 *
 * 🔴 **바퀴를 더 돌수록 틀린 값이 늘어난다.** 글을 더 많이 모으면 맞는 값만
 * 늘어나는 것이 아니라 **비슷한 오답도 같이 늘어나고**, 투표에서 그쪽이 이기는
 * 일이 생긴다. E 에서는 모델명이 `DEMO-GENERATOR-016` 으로 들어가기까지 했다.
 * 빈칸은 사람이 알아채지만 **틀린 글자는 알아챌 방법이 없다** — 그래서 성적이
 * 같거나 조금 낮더라도 틀린 값이 0인 A 를 쓴다.
 *
 * 배율·기울기를 쓸어 보는 길은 **없애지 않고 2단계 단추로 옮겼다.** 거기서는
 * 🔴 **1단계가 정한 값을 건드리지 않고, 새로 찾은 것도 자동으로 채우지 않는다**
 * (사람이 눌러야 들어간다). 그래야 위의 「틀린 값 5건」이 칸에 닿지 않는다.
 */
export const NAMEPLATE_STAGE1_WIDTH = 2000;

export function stage1NameplateSettings(): NameplateOcrSetting[] {
  return [{ width: NAMEPLATE_STAGE1_WIDTH, rotateDegrees: 0 }];
}

/** 2단계가 쓸어 보는 배율(목표 폭). */
export const NAMEPLATE_STAGE2_WIDTHS: readonly number[] = [1400, 2000, 2800];
/** 🔴 2단계가 쓸어 보는 기울기 — 손으로 찍은 사진은 늘 조금 기울어 있다. */
export const NAMEPLATE_STAGE2_ROTATIONS: readonly number[] = [-2, 0, 2];

/**
 * 2단계 — 배율 셋 × 기울기 셋. **이미 돈 설정은 뺀다.**
 *
 * 🔴 1단계가 찾은 것을 지우지 않는다. 부르는 쪽이 1단계의 `passes` 를 그대로
 * 넘기면 두 바퀴의 글이 **합쳐져서** 판단된다.
 */
export function stage2NameplateSettings(
  alreadyDone: readonly NameplateOcrSetting[] = []
): NameplateOcrSetting[] {
  const out: NameplateOcrSetting[] = [];
  for (const width of NAMEPLATE_STAGE2_WIDTHS) {
    for (const rotateDegrees of NAMEPLATE_STAGE2_ROTATIONS) {
      const setting = { width, rotateDegrees };
      const seen = [...alreadyDone, ...out].some((done) => sameNameplateSetting(done, setting));
      if (!seen) out.push(setting);
    }
  }
  return out;
}

/**
 * 네모 한 칸을 **설정마다 열여덟 번** 읽어 세 칸을 정한다.
 *
 * 🔴 중간에 멈추지 않는다 — 「세 칸이 다 찼으니 그만」을 넣고 싶어지지만,
 * 뒤에 오는 조합이 **더 자주 나오는 값**을 보태 투표를 뒤집는 일이 실제로
 * 있다. 멈추면 그 보정이 사라진다.
 *
 * 🔴 그림은 **조합 차례가 올 때 하나씩** 만든다(여섯 장을 미리 만들지
 * 않는다). 확대가 한 장에 0.3초쯤 걸리는 통짜 계산이라 여섯을 몰아 만들면
 * 브라우저가 2초 가까이 멈춰 「읽는 중」 표시조차 그려지지 않는다. 글자 인식을
 * 기다리는 `await` 사이사이에 끼워 넣으면 화면이 그 틈에 숨을 쉰다.
 *
 * 🔴 `previousPasses` 를 주면 **그 글까지 합쳐서** 판단한다 — 2단계가 1단계
 * 결과를 지우지 않게 하는 길이 이것이다.
 */
export async function readNameplateRegion(
  rgba: RgbaImage,
  region: CropRegion | null,
  recognize: NameplateRecognizer,
  models: readonly string[],
  options?: {
    /** 안 주면 네모 폭을 보고 1단계 설정을 쓴다. */
    settings?: readonly NameplateOcrSetting[];
    /** 앞 바퀴에서 나온 글. 지우지 않고 **보탠다.** */
    previousPasses?: readonly NameplatePassText[];
  }
): Promise<NameplateOcrOutcome> {
  const startedAt = Date.now();
  const base = prepareNameplateBase(rgba, region);
  const settings = options?.settings ?? stage1NameplateSettings();
  const passes: NameplatePassText[] = [...(options?.previousPasses ?? [])];
  for (const setting of settings) {
    for (const variant of NAMEPLATE_OCR_VARIANTS) {
      const image = buildNameplateOcrImage(base, variant, setting);
      for (const pageSegMode of NAMEPLATE_OCR_PAGE_SEG_MODES) {
        const text = await recognize(image.png, pageSegMode);
        passes.push({ setting, variant, pageSegMode, text });
      }
    }
  }
  const reading = readNameplateFromTexts(
    passes.map((pass) => pass.text),
    models
  );
  const seenSettings: NameplateOcrSetting[] = [];
  for (const pass of passes) {
    if (!seenSettings.some((done) => sameNameplateSetting(done, pass.setting))) {
      seenSettings.push(pass.setting);
    }
  }
  return { reading, passes, settings: seenSettings, ms: Date.now() - startedAt };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 브라우저 쪽 글자 인식기 — `/ocr/` 에 둔 tesseract.js 를 쓴다.
 *
 * 🔴 고객 자료가 이 PC 를 떠나지 않는다. 클라우드 OCR 도 CDN 도 쓰지 않는다.
 * 통문증 쪽(`pass-slip-reader.ts`)과 **같은 파일·같은 설정**이다 — 두 번째부터는
 * IndexedDB 에 남은 언어 데이터를 쓰므로 다시 받지 않는다.
 * ────────────────────────────────────────────────────────────────────────── */

const OCR_ASSET_BASE = "/ocr";

/**
 * 고른 사진에서 **사람이 친 네모 안만** 원본 해상도로 꺼낸다.
 *
 * 🔴 **줄여서 꺼내지 않는다.** 화면에는 폭에 맞춰 줄여 보여 주지만 읽을 때는
 * 원본 픽셀이어야 한다 — 네모 안이 작을수록 글자가 작고, 거기서 또 줄이면
 * 읽을 것이 남지 않는다. 네모는 **비율**(0~1)로 받으므로 화면에서 얼마나
 * 줄여 보였는지와 상관없이 같은 자리를 가리킨다.
 *
 * 🔴 EXIF 회전을 적용해 펼친다(`from-image`). 화면의 `<img>` 도 같은 회전으로
 * 보여 주므로, 그러지 않으면 사람이 친 네모와 꺼내는 자리가 어긋난다.
 * 색 변환을 끄는 세 설정은 통문증 쪽과 같다 — PC 마다 다른 픽셀을 보지 않게.
 *
 * 🔴 사진은 **저장하지 않는다.** 메모리에서만 펼쳐 쓰고 버린다.
 */
export async function cropNameplateRegionFromFile(
  file: Blob,
  region: CropRegion
): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  try {
    const left = Math.min(bitmap.width - 1, Math.max(0, Math.round(region.l * bitmap.width)));
    const top = Math.min(bitmap.height - 1, Math.max(0, Math.round(region.t * bitmap.height)));
    const width = Math.max(1, Math.min(bitmap.width - left, Math.round(region.w * bitmap.width)));
    const height = Math.max(
      1,
      Math.min(bitmap.height - top, Math.round(region.h * bitmap.height))
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("사진을 펼칠 수 없습니다 (캔버스를 쓸 수 없습니다).");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(left, top, width, height);
    return { data: pixels.data, width: pixels.width, height: pixels.height };
  } finally {
    bitmap.close();
  }
}

type TesseractWorkerLike = {
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  recognize(image: unknown): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

type TesseractGlobal = {
  createWorker(
    languages: string,
    oem: number,
    options: Record<string, unknown>
  ): Promise<TesseractWorkerLike>;
};

let tesseractScriptPromise: Promise<TesseractGlobal> | null = null;

function tesseractOnWindow(): TesseractGlobal | null {
  return (window as unknown as { Tesseract?: TesseractGlobal }).Tesseract ?? null;
}

function loadTesseract(): Promise<TesseractGlobal> {
  const already = tesseractOnWindow();
  if (already) return Promise.resolve(already);
  if (tesseractScriptPromise) return tesseractScriptPromise;

  tesseractScriptPromise = new Promise<TesseractGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${OCR_ASSET_BASE}/tesseract.min.js`;
    script.async = true;
    script.onload = () => {
      const loaded = tesseractOnWindow();
      if (loaded) resolve(loaded);
      else reject(new Error("글자 인식기를 불러왔지만 쓸 수 없습니다."));
    };
    script.onerror = () => {
      tesseractScriptPromise = null;
      reject(new Error("글자 인식기를 불러오지 못했습니다 (/ocr/tesseract.min.js)."));
    };
    document.head.appendChild(script);
  });
  return tesseractScriptPromise;
}

/** 브라우저에서 쓰는 글자 인식기 한 벌. 다 쓰면 `dispose()` 로 정리한다. */
export type BrowserNameplateRecognizer = {
  recognize: NameplateRecognizer;
  dispose(): void;
};

export async function createBrowserNameplateRecognizer(): Promise<BrowserNameplateRecognizer> {
  const Tesseract = await loadTesseract();
  // oem 1 = LSTM 만. 옛 엔진을 빼면 wasm 코어가 한 벌만 필요하다.
  const worker = await Tesseract.createWorker("eng", 1, {
    workerPath: `${OCR_ASSET_BASE}/worker.min.js`,
    // 🔴 폴더가 아니라 **파일 하나**를 못박는다 — 통문증 쪽과 같은 까닭이다
    //    (SIMD 없는 브라우저용 예비본은 저장소에 두지 않기로 했다).
    corePath: `${OCR_ASSET_BASE}/tesseract-core-simd-lstm.wasm.js`,
    langPath: `${OCR_ASSET_BASE}/tessdata`,
    gzip: true,
    cacheMethod: "write",
    logger: () => {},
    errorHandler: (error: unknown) => {
      console.error("[nameplate-ocr] tesseract", error);
    },
  });
  let alive = true;
  return {
    recognize: async (png, pageSegMode) => {
      if (!alive) return "";
      await worker.setParameters({
        tessedit_pageseg_mode: pageSegMode,
        tessedit_char_whitelist: NAMEPLATE_OCR_WHITELIST,
      });
      const result = await worker.recognize(png);
      return result.data.text ?? "";
    },
    dispose: () => {
      alive = false;
      void worker.terminate().catch(() => {});
    },
  };
}
