"use client";

/**
 * ============================================================================
 * 진짜 heic 변환기 — 🔴 라이브러리를 **그때 가서** 받는다 (2026-11-18)
 * ============================================================================
 * 규칙·판정은 heic-upload.ts 에 있고(무엇을 바꿀지, 이름을 어떻게 고칠지), 이 파일은
 * **실제로 바이트를 굽는** 부분이다. 둘을 가른 이유는 두 가지다.
 *
 *  1. 🔴 **늦게 받기.** `heic2any` 는 libheif 를 통째로 싣고 있어 1.4MB 다(압축 전).
 *     맨 위에서 import 하면 그 덩어리가 [파일 관리] 탭을 여는 **모든 사람**의 첫
 *     화면에 따라붙는다 — 아이폰 사진을 올리는 사람은 그중 일부다. 그래서
 *     `await import(...)` 로, 사람이 heic 를 실제로 고른 **그 순간에만** 받는다.
 *     (한 번 받으면 브라우저가 쥐고 있으므로 둘째 장부터는 다시 받지 않는다.)
 *  2. **시험.** wasm 디코더는 node 시험에서 돌릴 수 없다. 규칙 쪽은 가짜 변환기로
 *     전부 재고(heic-upload.test.ts), 이 파일은 「늦게 받는가」만 글자로 잰다.
 *
 * ── 품질 0.9 ─────────────────────────────────────────────────────────────
 * 🔴 원본 heic 가 **남지 않는** 길이라(2026-11-18 사용자 결정) 화질을 낮게 잡으면
 * 되돌릴 수가 없다. 그렇다고 1.0 으로 구우면 2400만 화소 사진이 20MB 상한
 * (MAX_ATTACHMENT_SIZE_BYTES)에 걸린다. 0.9 는 눈으로 차이를 느끼기 어려우면서
 * 상한에 닿지 않는 자리다(앱 안 카메라가 쓰는 0.92 와 같은 줄의 값).
 * ⚠️ 그래도 넘는 사진이 있으면 **평소의 상한 검사에 걸려** 「20MB 초과」로 거절된다 —
 * 이 조각이 그 길을 따로 만들지 않았다. 그때는 폰에서 크기를 줄여 다시 올려야 한다.
 *
 * ── 왜 서버가 아니라 브라우저인가 ───────────────────────────────────────
 * 서버에는 이미지 라이브러리가 없다(sharp · jimp 0건). 첨부 통로는 받은 바이트를
 * 그대로 적을 뿐이고, NAS(리눅스 컨테이너)로 옮기는 것이 정해져 있어 네이티브
 * 바이너리를 늘리지 않기로 한 결정이 그 위에 있다(image-shrink.ts 머리말).
 * ============================================================================
 */

/** heic2any 의 모양. 번들이 UMD 라 default 에 담겨 오기도 하고 함수 그 자체이기도 하다. */
type Heic2Any = (options: {
  blob: Blob;
  toType?: string;
  quality?: number;
}) => Promise<Blob | Blob[]>;

const JPEG_QUALITY = 0.9;

/**
 * heic/heif 한 장을 jpeg 바이트로 굽는다. 못 구우면 **던진다** — 부르는 쪽
 * (convertPickedHeic)이 그 한 장만 실패 목록에 넣고 나머지는 계속 올린다.
 */
export async function convertHeicToJpeg(file: File): Promise<Blob> {
  // 🔴 이 한 줄이 이 파일의 존재 이유다(위 머리말 1). 정적 import 로 바꾸지 말 것.
  const imported = await import("heic2any");
  // UMD 묶음이라 번들러에 따라 모듈 자체가 함수로 오는 환경이 있다. 둘 다 받는다 —
  // 틀리면 「함수가 아니다」로 터지고, 그건 실제 heic 를 고른 사람에게만 보인다.
  const candidate = imported as unknown as { default?: Heic2Any };
  const convert =
    typeof candidate.default === "function" ? candidate.default : (imported as unknown as Heic2Any);

  const result = await convert({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
  // 여러 장이 든 heic(라이브 포토·연사 묶음)는 배열로 온다. 첫 장만 쓴다 —
  // 한 장을 고른 사람에게 여러 장이 올라가면 그것대로 놀란다.
  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob || blob.size === 0) throw new Error("heic 변환 결과가 비어 있다");
  return blob;
}
