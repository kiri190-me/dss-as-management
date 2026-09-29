/**
 * ============================================================================
 * 그림의 방향 — 화면에서 돌린 것을 파일에 적을 때 쓰는 한 벌
 * ============================================================================
 * 크게 보기(AttachmentViewer)에서 돌리고 뒤집는 것은 지금까지 **CSS 로 보기만**
 * 바꾸는 일이었다. 그것을 원본 파일에 저장하게 되면서, 같은 값이 세 군데를
 * 지나게 된다:
 *
 *   화면(CSS transform)  →  주소의 인자(?rotate=90&flipX=1)  →  캔버스로 다시 그리기
 *
 * 세 자리가 **같은 뜻**이어야 화면에서 본 것과 저장된 것이 같다. 그래서 타입과
 * 판정을 여기 하나로 모으고, 셋이 어긋나지 않는지를 단위 시험이 못박는다.
 *
 * **이 파일은 순수하다.** server-only / drizzle / next / React 를 import 하지
 * 않는다 — 브라우저(캔버스로 다시 그리는 쪽)와 서버(인자를 받는 쪽)가 함께 쓴다.
 *
 * ── 🔴 flipX·flipY 는 **그림 자신의 축** 기준이다 ────────────────────────
 * 화면 기준이 아니다. 90° 돌려 놓은 상태에서 그림의 가로축은 화면의 세로축이라,
 * 화면에서 「좌우 뒤집기」를 누르면 저장되는 값은 flipY 다(AttachmentViewer 의
 * flipViewerAcrossScreenX). 그림 기준으로 적어 두어야 파일에 그대로 옮길 수 있다.
 *
 * ── 🔴 걸리는 차례가 뜻을 바꾼다 ─────────────────────────────────────────
 * CSS 는 `rotate(θ) scaleX(-1) scaleY(-1)` 로 적혀 있고, CSS 변환은 **오른쪽
 * 것이 점에 먼저** 걸린다 — 즉 **뒤집기가 먼저, 회전이 나중**이다. 캔버스도
 * 같은 차례여야 한다(orientationDrawSteps 주석). 뒤집으면 뒤집기와 회전의
 * 차례가 바뀌어 90°·270° 에서 결과가 상하로 뒤집힌 그림이 저장된다.
 * ============================================================================
 */

/** 90° 단위로만 돈다. 그림 파일의 방향(EXIF)도 이 네 값뿐이다. */
export type ViewerRotation = 0 | 90 | 180 | 270;

/**
 * **그림 자체의 방향.** 확대·이동(scale·offset)은 보는 사람의 화면 사정일 뿐이라
 * 여기 섞지 않는다 — 저장되는 것은 이 셋뿐이다.
 */
export type ImageOrientation = {
  rotate: ViewerRotation;
  flipX: boolean;
  flipY: boolean;
};

export const IDENTITY_ORIENTATION: ImageOrientation = { rotate: 0, flipX: false, flipY: false };

const ROTATIONS: readonly ViewerRotation[] = [0, 90, 180, 270];

/** 아무것도 안 돌리고 안 뒤집은 상태인가 — 저장할 것이 없다는 뜻이다. */
export function isIdentityOrientation(orientation: ImageOrientation): boolean {
  return orientation.rotate === 0 && !orientation.flipX && !orientation.flipY;
}

/** 90°·270° 로 돌아가 있으면 그림의 가로축이 화면에서는 세로축이다. */
export function isQuarterTurned(orientation: ImageOrientation): boolean {
  return orientation.rotate === 90 || orientation.rotate === 270;
}

/**
 * 주소의 인자를 방향 값으로 읽는다. **조금이라도 어긋나면 null** — 저장은
 * 되돌릴 수 없는 일이라, 알아들을 수 없는 값을 짐작해서 돌리지 않는다.
 *
 * 회전은 `0·90·180·270` 글자 그대로만, 뒤집기는 `1`(켬)과 `0`·없음(끔)만 받는다.
 * `true`·`yes` 같은 말을 받아 주기 시작하면 무엇이 켜진 것인지 화면과 서버가
 * 저마다 다르게 읽을 수 있다.
 */
export function parseOrientation(raw: {
  rotate: string | null;
  flipX: string | null;
  flipY: string | null;
}): ImageOrientation | null {
  const rotate = ROTATIONS.find((value) => String(value) === raw.rotate);
  if (rotate === undefined) return null;

  const flipX = parseFlag(raw.flipX);
  const flipY = parseFlag(raw.flipY);
  if (flipX === null || flipY === null) return null;

  return { rotate, flipX, flipY };
}

function parseFlag(raw: string | null): boolean | null {
  if (raw === null || raw === "" || raw === "0") return false;
  if (raw === "1") return true;
  return null;
}

/** 주소에 실을 값. parseOrientation 과 짝이며, 왕복해도 같은 값이어야 한다. */
export function orientationSearchParams(orientation: ImageOrientation): Record<string, string> {
  return {
    rotate: String(orientation.rotate),
    flipX: orientation.flipX ? "1" : "0",
    flipY: orientation.flipY ? "1" : "0",
  };
}

/** 돌리고 난 뒤의 가로·세로. 뒤집기는 크기를 바꾸지 않는다. */
export function orientedPixelSize(
  size: { width: number; height: number },
  orientation: ImageOrientation
): { width: number; height: number } {
  return isQuarterTurned(orientation)
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * 캔버스에 다시 그릴 때의 변환. 부르는 쪽은 **적힌 차례 그대로** 쓴다:
 *
 *   ctx.translate(출력폭/2, 출력높이/2);
 *   ctx.rotate(rotateRadians);
 *   ctx.scale(scaleX, scaleY);
 *   ctx.drawImage(그림, -원본폭/2, -원본높이/2, 원본폭, 원본높이);
 *
 * 🔴 **scale 이 rotate 보다 뒤다.** 캔버스도 CSS 처럼 나중에 부른 변환이 점에
 * 먼저 걸리므로, 이 차례가 CSS 의 `rotate(θ) scaleX(-1)` 과 같은 뜻이 된다
 * (파일 머리말). 둘을 바꾸면 90°·270° 에서 저장된 그림이 화면과 달라진다.
 */
export function orientationDrawSteps(orientation: ImageOrientation): {
  rotateRadians: number;
  scaleX: number;
  scaleY: number;
} {
  return {
    rotateRadians: (orientation.rotate * Math.PI) / 180,
    scaleX: orientation.flipX ? -1 : 1,
    scaleY: orientation.flipY ? -1 : 1,
  };
}

/**
 * 사람이 읽는 말. **감사 기록에 그대로 들어간다** — 「어느 방향으로 돌렸는지」를
 * 3년 뒤에 그 줄만 읽고도 알 수 있어야 한다(숫자만 남기면 flipX 가 무엇인지
 * 코드를 찾아봐야 한다).
 */
export function describeOrientation(orientation: ImageOrientation): string {
  const parts: string[] = [];
  if (orientation.rotate !== 0) parts.push(`오른쪽으로 ${orientation.rotate}도 회전`);
  if (orientation.flipX) parts.push("좌우 뒤집기");
  if (orientation.flipY) parts.push("상하 뒤집기");
  return parts.length > 0 ? parts.join(" · ") : "그대로";
}
