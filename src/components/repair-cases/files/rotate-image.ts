"use client";

import {
  isIdentityOrientation,
  orientationDrawSteps,
  orientationSearchParams,
  orientedPixelSize,
  type ImageOrientation,
} from "@/lib/domain/image-orientation";
import { createPreviewBlob } from "./shrink-image";

/**
 * ============================================================================
 * 화면에서 돌린 그대로 **원본 파일에** 저장한다 — 돌리는 일은 브라우저가 한다
 * ============================================================================
 * 🔴 **되돌릴 수 없다.** 원본을 덮어쓴다(사용자 결정 2026-09-29). 확인 창은
 * 부르는 쪽(AttachmentViewer)이 띄우고, 이 파일은 그 뒤의 일만 한다.
 *
 * ── 서버는 픽셀을 다루지 않는다 ──────────────────────────────────────────
 * 미리보기를 만들어 보내는 것과 같은 판단이다(shrink-image.ts · preview 라우트
 * 머리말) — 이미지 처리 라이브러리는 네이티브 바이너리라 NAS 컨테이너로 옮길 때
 * 짐이 된다. **캔버스가 돌리고, 서버는 받아서 놓는다.**
 *
 * ── 🔴 원본과 썸네일을 **한 번에** 보낸다 ────────────────────────────────
 * 원본만 돌리고 썸네일을 그대로 두면 목록은 옛 방향으로 남는다. 그래서 둘을
 * 만들어 한 요청의 본문에 이어 붙이고, 경계는 주소의 `previewBytes` 로 알린다.
 * 하나라도 못 만들면 **아무것도 보내지 않는다** — 반만 저장되는 길이 없다.
 *
 * ── 형식을 바꾸지 않는다 ────────────────────────────────────────────────
 * PNG 원본은 PNG 로 다시 쓴다. JPEG 로 바꿔 보내면 디스크의 파일 이름
 * (`….png`)·DB 의 mime_type 과 내용이 어긋나고, 서버가 앞머리 대조에서 거절한다.
 * 썸네일만은 언제나 JPEG 다(붙이기 통로와 같은 규칙).
 *
 * ── 원본을 다시 받아 온다 — `?view=full` 로 ──────────────────────────────
 * 화면의 `<img>` 를 그대로 캔버스에 그릴 수도 있지만, 그러면 브라우저가 화면에
 * 맞춰 줄여 그린 그림을 저장하게 될 수 있다. 원본을 다시 받는다.
 *
 * 🔴 **`?view=full` 이다 — 내려받기 주소가 아니다.** 그쪽은 FILE_DOWNLOAD 감사를
 * 남긴다(download 라우트 7단계). 돌려서 저장하는 것은 파일을 가져가는 일이 아니라
 * **고치는 일**이고, 그 기록은 저장할 때 UPDATE 로 한 줄 남는다. 여기서 또
 * 남기면 같은 행위가 두 종류로 두 번 적힌다.
 * ============================================================================
 */

/** 다시 쓸 때의 JPEG 품질. 90° 회전은 어차피 다시 인코딩하는 일이라, 눈에 띄는 손실이 없을 만큼 높게 잡는다. */
const REWRITE_JPEG_QUALITY = 0.92;

export type SaveRotationResult = { ok: true } | { ok: false; message: string };

function encode(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      mimeType,
      // PNG 인코딩은 품질 값을 무시한다(무손실). 넘겨도 해가 없지만 뜻이
      // 없으므로 JPEG 일 때만 준다.
      mimeType === "image/jpeg" ? REWRITE_JPEG_QUALITY : undefined
    );
  });
}

/**
 * 돌리고 뒤집은 그림을 **같은 형식으로** 만든다. 사진이 아니거나 돌린 것이
 * 없으면 null.
 *
 * 🔴 변환의 차례가 화면(CSS)과 같아야 한다 — `translate → rotate → scale`.
 * 캔버스도 CSS 처럼 나중에 부른 변환이 점에 먼저 걸리므로, 이 차례가
 * `rotate(θ) scaleX(-1)` 과 같은 뜻이 된다(image-orientation.ts 의
 * orientationDrawSteps). 둘을 바꾸면 90°·270° 에서 저장된 그림이 화면과 달라진다.
 */
export async function rotateImageBlob(
  source: Blob,
  orientation: ImageOrientation
): Promise<Blob | null> {
  if (source.type !== "image/jpeg" && source.type !== "image/png") return null;
  if (isIdentityOrientation(orientation)) return null;

  const bitmap = await createImageBitmap(source);
  try {
    const output = orientedPixelSize({ width: bitmap.width, height: bitmap.height }, orientation);
    const canvas = document.createElement("canvas");
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext("2d");
    if (!context) return null;

    // 흰 바탕을 깔지 않는다. 90° 단위 회전은 캔버스를 **빈틈없이** 덮으므로 깔
    // 이유가 없고, 깔면 투명한 PNG 의 투명이 사라진다(줄여서 받기 쪽은 PNG 를
    // JPEG 로 바꾸므로 깐다 — 사정이 다르다).
    const steps = orientationDrawSteps(orientation);
    context.translate(output.width / 2, output.height / 2);
    context.rotate(steps.rotateRadians);
    context.scale(steps.scaleX, steps.scaleY);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2, bitmap.width, bitmap.height);

    return await encode(canvas, source.type);
  } finally {
    // 비트맵은 명시적으로 놓아 준다 — 여러 장을 연달아 다루면 쌓인다.
    bitmap.close();
  }
}

/**
 * 화면에 보이는 그 원본을 다시 받아 온다. **감사 로그를 남기지 않는 주소**다
 * (파일 머리말의 `?view=full`).
 */
async function fetchOriginalForRewrite(attachmentId: string): Promise<Blob> {
  const response = await fetch(
    `/api/attachments/${encodeURIComponent(attachmentId)}/download?view=full`
  );
  if (!response.ok) {
    throw new Error(`원본을 받지 못했습니다 (${response.status})`);
  }
  return response.blob();
}

/**
 * 돌린 대로 원본에 저장한다.
 *
 * 🔴 **둘 다 만든 뒤에만 보낸다.** 썸네일을 못 만들면 원본도 보내지 않는다 —
 * 반만 바뀌면 목록과 크게 보기가 서로 다른 그림을 보여 준다.
 */
export async function saveRotatedAttachment(params: {
  attachmentId: string;
  orientation: ImageOrientation;
}): Promise<SaveRotationResult> {
  if (isIdentityOrientation(params.orientation)) {
    return { ok: false, message: "돌리거나 뒤집은 것이 없습니다." };
  }

  let rotated: Blob | null;
  let preview: Blob | null;
  try {
    const source = await fetchOriginalForRewrite(params.attachmentId);
    rotated = await rotateImageBlob(source, params.orientation);
    if (!rotated) {
      return { ok: false, message: "이 사진은 돌려서 저장할 수 없습니다." };
    }
    preview = await createPreviewBlob(rotated);
    if (!preview) {
      // 여기서 멈추는 것이 요점이다 — 원본만 바꾸고 목록을 옛 방향으로 남기지 않는다.
      return { ok: false, message: "미리보기를 만들지 못해 저장하지 않았습니다." };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "사진을 돌리지 못했습니다.",
    };
  }

  // 본문 = [썸네일][돌린 원본]. 경계는 주소로 알린다(서버의 splitStreamAt).
  const body = new Blob([preview, rotated]);
  const query = new URLSearchParams({
    ...orientationSearchParams(params.orientation),
    previewBytes: String(preview.size),
  });

  let response: Response;
  try {
    response = await fetch(
      `/api/attachments/${encodeURIComponent(params.attachmentId)}/rotation?${query.toString()}`,
      { method: "PUT", body }
    );
  } catch {
    return { ok: false, message: "저장하지 못했습니다. 연결을 확인해 주세요." };
  }

  if (response.ok) return { ok: true };

  // 무엇이 왜 막혔는지는 서버가 사람이 읽을 수 있게 적어 준다 — 화면이 따로
  // 문장을 지으면 서버가 검사를 넓히는 날 두 문장이 갈라진다.
  const message = await response
    .json()
    .then((payload: { error?: unknown }) =>
      typeof payload?.error === "string" ? payload.error : null
    )
    .catch(() => null);
  return { ok: false, message: message ?? `저장하지 못했습니다 (${response.status})` };
}
