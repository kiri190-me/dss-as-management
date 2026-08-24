/**
 * ============================================================================
 * 사진의 가로·세로를 앞머리 몇 바이트만 읽어 알아낸다
 * ============================================================================
 * 사진을 줄이려면 원래 크기를 알아야 하는데, 보통은 이미지를 통째로 푸는
 * (디코딩) 수밖에 없다고 여긴다. 1200만 화소 사진 한 장을 푸는 것은 폰에서
 * 눈에 띄게 느리고 메모리도 많이 쓴다.
 *
 * 그런데 크기는 **파일 앞머리에 그대로 적혀 있다.** 그 숫자만 읽으면 푸는
 * 일을 건너뛸 수 있고, 그러면 처음부터 **줄인 크기로 풀도록** 브라우저에
 * 부탁할 수 있다(createImageBitmap의 resizeWidth). JPEG 디코더는 그럴 때
 * 원본 화소를 전부 만들지 않고 곧바로 작게 푸는 길을 쓴다 — 이것이 이 기능에서
 * 가장 큰 시간 절약이다.
 *
 * ── 못 읽으면 null이다 ───────────────────────────────────────────────────
 * 형식이 낯설거나 앞머리가 잘려 있으면 억지로 짐작하지 않고 null을 준다.
 * 부르는 쪽은 그때 종전대로 통째로 풀면 된다 — 느릴 뿐 결과는 같다.
 * ============================================================================
 */

export type ImageSize = { width: number; height: number };

/** PNG는 앞머리가 고정이라 자리만 보면 된다. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * JPEG에서 크기가 적힌 조각(SOF)들. C4·C8·CC는 크기가 아니라 다른 표라서
 * 빼야 한다 — 이걸 빼먹으면 엉뚱한 숫자를 크기로 읽는다.
 */
function isStartOfFrame(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readPngSize(bytes: Uint8Array): ImageSize | null {
  // 서명(8) + 길이(4) + "IHDR"(4) 다음에 가로(4)·세로(4)가 온다.
  if (bytes.length < 24) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null; // "IHDR"가 아니다
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  // 조각을 하나씩 건너뛰며 크기가 적힌 조각을 찾는다. EXIF 썸네일이 앞에
  // 들어 있으면 한참 뒤에 나오기도 해서, 부르는 쪽이 넉넉히 읽어 넘겨 준다.
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      // 조각 사이를 채우는 0xFF가 이어질 수 있다. 한 칸씩 밀며 맞춘다.
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // 0xFF가 연달아 나오면 아직 조각 표시 중이다.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // 이 표시들은 길이가 없는 조각이다.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (offset + 3 >= bytes.length) return null;
    const length = view.getUint16(offset + 2, false);
    if (length < 2) return null;

    if (isStartOfFrame(marker)) {
      // 길이(2) + 정밀도(1) 다음이 세로(2)·가로(2)다.
      if (offset + 9 >= bytes.length) return null;
      const height = view.getUint16(offset + 5, false);
      const width = view.getUint16(offset + 7, false);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    offset += 2 + length;
  }
  return null;
}

/**
 * 앞머리에서 크기를 읽는다. 읽지 못하면 null.
 *
 * JPEG와 PNG만 본다 — 이 시스템에서 줄이는 대상이 그 둘뿐이기 때문이다
 * (attachment-download-policy의 화면 표시 가능 형식과 같은 범위).
 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  return readPngSize(bytes) ?? readJpegSize(bytes);
}
