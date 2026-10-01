/**
 * ============================================================================
 * 통문증 전처리 **Web Worker** — 사진 한 장을 받아 회색 PNG 를 돌려준다.
 * ============================================================================
 * 하는 일은 둘뿐이다.
 *   1. JPEG → RGBA 픽셀 배열 (환경에 기대는 **유일한** 단계)
 *   2. pass-slip-preprocess.ts 의 순수 계산 → 회색 PNG 바이트
 *
 * ── 🔴 왜 워커인가 ──────────────────────────────────────────────────────
 * 전처리는 한 장에 0.2초쯤 걸리는 **통짜 계산**이다(1800px 로 늘린 뒤 가우시안을
 * 두 번 돈다). 메인 스레드에서 돌리면 그동안 화면이 멈춘다 — 단추도 안 눌리고
 * 「몇 장째」 표시도 갱신되지 않아 사람은 고장으로 읽는다. 여러 줄을 잇달아
 * 돌리므로 그 멈춤이 수 초가 된다.
 *
 * 글자 인식(약 1초)은 여기서 하지 않는다. tesseract.js 가 **제 워커**를 따로
 * 띄우므로 그쪽도 메인 스레드를 막지 않는다. 워커 안에서 워커를 또 띄우는 모양을
 * 피한 것은 브라우저마다 지원이 갈리기 때문이다.
 *
 * ── 🔴 색 변환을 끈다 ───────────────────────────────────────────────────
 * `colorSpaceConversion: "none"` · `premultiplyAlpha: "none"` ·
 * `imageOrientation: "from-image"` 세 가지가 측정에 쓴 설정 그대로다. 이것을
 * 빼면 사진에 박힌 색 프로파일에 따라 픽셀이 달라져, 같은 사진인데 PC 마다 다른
 * 값이 나온다. EXIF 회전(`from-image`)은 휴대폰 사진에 반드시 필요하다 —
 * 안 돌리면 띠를 엉뚱한 자리에서 잘라낸다.
 * ============================================================================
 */

import { PRESET_BAND_A, encodeGrayPNG, prepare } from "./pass-slip-preprocess";

/** 메인 스레드 → 워커. */
export type PassSlipPrepareRequest = {
  /** 요청을 짝지을 번호. 워커는 받은 차례대로 답하지만 번호로 맞춘다. */
  id: number;
  /** 원본 사진. Blob 은 구조화 복제로 그대로 건너간다. */
  image: Blob;
};

/** 워커 → 메인 스레드. */
export type PassSlipPrepareResponse =
  | {
      id: number;
      ok: true;
      /** 글자 인식기에 그대로 넘기는 회색 PNG 바이트. */
      png: Uint8Array;
      width: number;
      height: number;
      decodeMs: number;
      prepareMs: number;
    }
  | { id: number; ok: false; message: string };

/**
 * 워커 전역. `self` 를 다시 선언하면 lib.dom 의 것과 충돌하므로 모양만 좁혀 쓴다.
 */
type WorkerScope = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

const scope = self as unknown as WorkerScope;

async function decodeToRgba(image: Blob) {
  const bitmap = await createImageBitmap(image, {
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", {
      willReadFrequently: true,
      colorSpace: "srgb",
    } as CanvasRenderingContext2DSettings) as OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error("이 브라우저에서 사진을 펼칠 수 없습니다.");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height, {
      colorSpace: "srgb",
    });
    return {
      data: new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.length),
      width: pixels.width,
      height: pixels.height,
    };
  } finally {
    bitmap.close();
  }
}

scope.addEventListener("message", (event: MessageEvent) => {
  const request = event.data as PassSlipPrepareRequest;
  void (async () => {
    try {
      const startedAt = Date.now();
      const rgba = await decodeToRgba(request.image);
      const decodedAt = Date.now();
      const gray = prepare(rgba, PRESET_BAND_A);
      const png = encodeGrayPNG(gray.data, gray.width, gray.height);
      const response: PassSlipPrepareResponse = {
        id: request.id,
        ok: true,
        png,
        width: gray.width,
        height: gray.height,
        decodeMs: decodedAt - startedAt,
        prepareMs: Date.now() - decodedAt,
      };
      // 바이트를 복사하지 않고 넘긴다 — 한 장이 1MB 쯤 된다.
      scope.postMessage(response, [png.buffer as ArrayBuffer]);
    } catch (error) {
      const response: PassSlipPrepareResponse = {
        id: request.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
      scope.postMessage(response);
    }
  })();
});
