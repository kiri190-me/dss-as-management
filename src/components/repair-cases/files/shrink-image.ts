"use client";

import { readImageSize } from "@/lib/domain/image-header";
import { MIN_TARGET_BYTES } from "@/lib/domain/image-shrink";

/**
 * ============================================================================
 * 실제로 사진을 줄이는 일 — canvas가 필요해 브라우저에서만 돈다
 * ============================================================================
 * 목표를 정하는 규칙은 `@/lib/domain/image-shrink`에 있고 거기서 검증한다.
 * 이 파일은 그 목표에 **실제로 맞춰 보는** 부분이다.
 *
 * ── 빠르게 만든 두 가지 ──────────────────────────────────────────────────
 * JPEG는 품질 값과 결과 크기의 관계가 사진마다 다르다. 하늘처럼 단순한 사진은
 * 품질을 낮춰도 잘 안 줄고, 회로 기판처럼 세밀한 사진은 급격히 준다. 그래서
 * "품질 몇이면 몇 KB"를 계산으로 알 수 없고 실제로 인코딩해 봐야 안다. 처음에는
 * 원본 크기로 최대 열여섯 번까지 인코딩했고, 폰에서 한 장에 몇 초가 걸렸다.
 *
 *  1. **필요한 배율을 먼저 계산한다.** JPEG 크기는 대체로 픽셀 수에 비례하므로
 *     용량을 r배로 만들려면 배율은 √r이다. 여기서 출발하면 대개 한 번에 닿고,
 *     빗나가도 그만큼만 보정하면 된다 — 인코딩이 최대 세 번이다.
 *  2. **처음부터 작게 푼다.** 앞머리에서 원본 크기를 읽어(image-header.ts)
 *     브라우저에게 줄인 크기로 풀어 달라고 부탁한다. 원본 화소를 만들었다가
 *     버리지 않으므로 여는 시간과 메모리가 함께 준다.
 *
 * ── PNG는 JPEG가 된다 ────────────────────────────────────────────────────
 * canvas의 PNG 인코딩은 품질 값을 무시한다(무손실이라 줄일 손잡이가 없다).
 * 그래서 줄일 때는 JPEG로 바꾼다. 투명한 부분은 흰색으로 채운다 — 안 채우면
 * 검게 나온다. 파일 이름의 확장자도 함께 바뀐다(shrunkFileName).
 * ============================================================================
 */

export type ShrinkResult = {
  blob: Blob;
  /** 목표에 맞췄는가. 못 맞췄으면 할 수 있는 만큼 줄인 것이다. */
  reachedTarget: boolean;
};

/**
 * 목표 비율에서 필요한 축소 배율을 미리 계산한다.
 *
 * JPEG 크기는 대체로 **픽셀 수에 비례**한다. 픽셀 수는 가로·세로를 함께 줄이면
 * 배율의 제곱으로 줄므로, 용량을 r배로 만들려면 배율은 √r이다. 여기서 출발하면
 * 대개 한 번에 목표 근처에 닿는다.
 *
 * 1.08을 곱해 살짝 크게 잡는 이유는, 품질 값이 나머지를 마저 줄여 주기 때문이다.
 * 처음부터 너무 작게 잡으면 목표보다 훨씬 작은 사진이 나와 화질만 버린다.
 */
function estimateScale(targetBytes: number, sourceBytes: number): number {
  const ratio = targetBytes / sourceBytes;
  return Math.min(1, Math.max(0.1, Math.sqrt(ratio) * 1.08));
}

/** 첫 시도의 품질. 눈으로 차이를 느끼기 어려우면서 크기가 크게 준다. */
const FIRST_QUALITY = 0.82;

function drawTo(bitmap: ImageBitmap, scale: number): HTMLCanvasElement | null {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  // 투명한 부분이 검게 나오지 않도록 흰 바탕을 먼저 깐다(PNG → JPEG).
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

/**
 * 이 사진을 목표 용량 이하로 줄인다.
 *
 * 목표를 못 맞추면 **가장 작게 나온 결과**를 돌려주고 reachedTarget을 false로
 * 둔다. 실패로 처리해 아무것도 주지 않으면 사용자는 "왜 안 되지"만 남는데,
 * 줄어든 파일이라도 손에 쥐는 편이 낫다 — 얼마나 줄었는지는 화면이 말해 준다.
 */
export async function shrinkImageBlob(source: Blob, targetBytes: number): Promise<ShrinkResult> {
  // 이미 목표보다 작으면 손대지 않는다. 다시 인코딩하면 화질만 잃고 커질 수 있다.
  if (source.size <= Math.max(targetBytes, MIN_TARGET_BYTES)) {
    return { blob: source, reachedTarget: true };
  }

  // ── 0) 크기를 앞머리에서 읽어, 처음부터 작게 푼다 ──────────────────────
  //
  // 여기가 가장 큰 시간 절약이다. 사진을 원본 화소로 다 푼 다음 줄이면, 폰에서
  // 1200만 화소를 만들었다가 버리는 셈이 된다. 크기를 미리 알면 브라우저에게
  // "이 크기로 풀어 달라"고 부탁할 수 있고, JPEG 디코더는 그때 원본 화소를
  // 만들지 않고 곧바로 작게 푸는 길을 쓴다.
  //
  // 앞머리를 못 읽으면(낯선 형식·잘린 파일) 종전대로 통째로 푼다 — 느릴 뿐
  // 결과는 같다.
  const wantedScale = estimateScale(targetBytes, source.size);
  const header = new Uint8Array(await source.slice(0, 256 * 1024).arrayBuffer());
  const size = readImageSize(header);

  const bitmap = size
    ? await createImageBitmap(source, {
        // 두 번째 시도에서 조금 더 줄일 여지를 남기려고 1.15배로 넉넉히 푼다.
        // 딱 맞게 풀면 보정할 때 늘려야 하고, 늘린 사진은 흐릿해진다.
        resizeWidth: Math.max(1, Math.round(size.width * Math.min(1, wantedScale * 1.15))),
        resizeHeight: Math.max(1, Math.round(size.height * Math.min(1, wantedScale * 1.15))),
        resizeQuality: "medium",
      })
    : await createImageBitmap(source);

  try {
    let smallest: Blob | null = null;

    function keep(blob: Blob): void {
      if (!smallest || blob.size < smallest.size) smallest = blob;
    }

    // ── 1) 계산한 배율로 한 번 ──────────────────────────────────────────
    // 예전에는 원본 크기에서 품질만 바꿔 가며 최대 열여섯 번까지 인코딩했다.
    // 이제는 필요한 배율을 먼저 계산해 줄인 크기에서 인코딩하므로 한 번이
    // 훨씬 싸고, 대개 그 한 번으로 끝난다.
    //
    // 이미 작게 풀어 두었으므로 여기서의 배율은 **푼 크기 기준**이다.
    let scale = size ? Math.min(1, wantedScale / Math.min(1, wantedScale * 1.15)) : wantedScale;
    let canvas = drawTo(bitmap, scale);
    if (!canvas) return { blob: source, reachedTarget: false };

    let blob = await encode(canvas, FIRST_QUALITY);
    if (!blob) return { blob: source, reachedTarget: false };
    keep(blob);
    if (blob.size <= targetBytes) return { blob, reachedTarget: true };

    // ── 2) 빗나간 만큼 한 번 더 줄인다 ──────────────────────────────────
    // 첫 결과가 목표의 몇 배인지 알았으니, 그 비율만큼 배율을 다시 줄인다.
    // 0.97은 경계에 아슬아슬하게 걸려 한 번 더 돌지 않도록 하는 여유다.
    scale = Math.max(0.08, scale * Math.sqrt(targetBytes / blob.size) * 0.97);
    canvas = drawTo(bitmap, scale);
    if (canvas) {
      blob = await encode(canvas, FIRST_QUALITY);
      if (blob) {
        keep(blob);
        if (blob.size <= targetBytes) return { blob, reachedTarget: true };

        // ── 3) 마지막으로 품질을 낮춘다 ──────────────────────────────────
        // 여기까지 오는 것은 아주 세밀한 사진이거나 목표가 매우 작은 경우다.
        // 같은 배율에서 품질만 내리므로 인코딩 한 번이면 된다.
        const lower = await encode(canvas, 0.5);
        if (lower) {
          keep(lower);
          if (lower.size <= targetBytes) return { blob: lower, reachedTarget: true };
        }
      }
    }

    // 세 번 안에 못 맞췄다. 가장 작게 나온 것을 준다 — 아무것도 주지 않으면
    // 사용자에게는 "왜 안 되지"만 남는다. 얼마나 줄었는지는 화면이 말해 준다.
    return { blob: smallest ?? source, reachedTarget: false };
  } finally {
    // 비트맵은 명시적으로 놓아 준다 — 여러 장을 연달아 줄일 때 쌓인다.
    bitmap.close();
  }
}

/**
 * 목록에 쓸 썸네일을 만든다.
 *
 * 긴 변을 480px으로 맞춘다 — 격자에서 가장 크게 보이는 칸(PC 4열)이 그보다
 * 작고, 고해상도 화면에서 두 배로 그려도 흐릿하지 않은 크기다. 보통 30~60KB가
 * 되므로 3MB 원본과 견주면 오십분의 일이다.
 *
 * 사진이 아니면 null이다 — 압축 파일에 붙일 그림이 없다.
 */
export async function createPreviewBlob(source: Blob): Promise<Blob | null> {
  if (source.type !== "image/jpeg" && source.type !== "image/png") return null;

  const header = new Uint8Array(await source.slice(0, 256 * 1024).arrayBuffer());
  const size = readImageSize(header);

  // 크기를 알면 처음부터 작게 푼다(shrinkImageBlob과 같은 이유). 모르면
  // 통째로 푼 뒤 줄인다 — 느릴 뿐 결과는 같다.
  const longest = size ? Math.max(size.width, size.height) : 0;
  const scale = longest > PREVIEW_LONGEST_EDGE ? PREVIEW_LONGEST_EDGE / longest : 1;

  const bitmap =
    size && scale < 1
      ? await createImageBitmap(source, {
          resizeWidth: Math.max(1, Math.round(size.width * scale)),
          resizeHeight: Math.max(1, Math.round(size.height * scale)),
          resizeQuality: "medium",
        })
      : await createImageBitmap(source);

  try {
    // 이미 작게 풀었으면 그대로 그린다. 못 풀었으면 여기서 줄인다.
    const drawScale = size && scale < 1 ? 1 : Math.min(1, PREVIEW_LONGEST_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = drawTo(bitmap, drawScale);
    if (!canvas) return null;
    return await encode(canvas, 0.72);
  } finally {
    bitmap.close();
  }
}

/** 목록에 쓰기 충분한 크기. 서버의 상한(512KB)보다 한참 작게 나온다. */
const PREVIEW_LONGEST_EDGE = 480;

/**
 * 만든 썸네일을 올린다. **실패해도 조용히 넘어간다.**
 *
 * 미리보기는 없어도 되는 것이다 — 없으면 목록이 원본으로 보여 준다. 그래서
 * 이것 때문에 업로드가 실패한 것처럼 보이면 안 된다. 사용자가 한 일(사진
 * 올리기)은 이미 끝났다.
 */
export async function uploadPreview(attachmentId: string, source: Blob): Promise<void> {
  try {
    const preview = await createPreviewBlob(source);
    if (!preview) return;
    await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}/preview`, {
      method: "PUT",
      body: preview,
    });
  } catch {
    // 조용히 넘어간다(위 주석).
  }
}

/**
 * 저장된 첨부의 **원본**을 받아 온다.
 *
 * `?view=thumb`을 붙이지 않는 것이 중요하다. 그 주소는 미리보기가 있으면
 * 미리보기를 주므로, 줄여서 받기나 미리보기 채우기가 그 값을 쓰면 **480px짜리
 * 썸네일을 원본이라 여기고 다시 줄이게 된다.** 화질이 두 번 깎이고, 채우기는
 * 미리보기로 미리보기를 만드는 꼴이 된다.
 *
 * 이 경로는 감사 로그에 FILE_DOWNLOAD를 남긴다 — 실제로 원본을 가져가는
 * 행위이기 때문이다.
 */
export async function fetchAttachmentBlob(attachmentId: string): Promise<Blob> {
  const response = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}/download`);
  if (!response.ok) {
    throw new Error(`파일을 받지 못했습니다 (${response.status})`);
  }
  return response.blob();
}

/** 만들어진 파일을 디스크로 내려보낸다. */
export function saveBlobAs(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 곧바로 놓으면 내려받기가 시작되기 전에 주소가 사라지는 브라우저가 있다.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
