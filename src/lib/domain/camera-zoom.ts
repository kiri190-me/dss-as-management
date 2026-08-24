/**
 * ============================================================================
 * 카메라 배율 — 당겨 찍기 위한 계산
 * ============================================================================
 * 앱 안 카메라(InAppCamera)는 켜면 그 기기가 주는 화각 그대로만 찍힌다. 그래서
 * 부품 각인이나 파형을 남기려면 장비에 몸을 붙여야 하는데, 랙 안쪽이나 전원이
 * 들어와 있는 보드 앞에서는 그렇게 할 수 없다. 배율이 필요한 이유다.
 *
 * ── 당기는 방법이 두 가지다 ──────────────────────────────────────────────
 *  1. **하드웨어 줌.** Android Chrome은 카메라 트랙에 zoom 능력을 노출한다.
 *     이때는 들어오는 영상 프레임 자체가 확대되므로 우리가 할 일이 없다.
 *  2. **디지털 줌.** iOS Safari나 PC 웹캠에는 그 능력이 없다. 미리보기를 CSS로
 *     확대하고, **찍을 때 같은 배율로 가운데를 잘라낸다.**
 *
 * ── 이 파일이 막으려는 고장 ──────────────────────────────────────────────
 * 디지털 줌에서 미리보기만 확대하고 촬영을 그대로 두면 **화면에는 크게 보이는데
 * 저장된 사진은 광각**이 된다. 이 어긋남은 찍는 순간에는 드러나지 않는다 —
 * 현장에서 다 찍고 돌아와 파일을 열어 봐야 안다. 그때는 다시 갈 수 없다.
 *
 * 그래서 잘라낼 사각형을 정하는 계산을 브라우저에서 떼어 여기에 두고, 배율 1에서
 * 원본 전체와 같은지를 테스트로 못박는다. 확대·촬영에 필요한 브라우저 쪽 일
 * (applyConstraints, transform, canvas)은 컴포넌트에 남는다.
 * ============================================================================
 */

/** 배율이 움직일 수 있는 구간. 하드웨어는 기기가 알려 주고, 디지털은 우리가 정한다. */
export type ZoomRange = { min: number; max: number };

/** 잘라낼 사각형. canvas의 drawImage에 그대로 넘기는 모양이다. */
export type CropRect = { sx: number; sy: number; sw: number; sh: number };

/**
 * 디지털 줌의 범위 — 4배까지다.
 *
 * 디지털 줌은 이미 받은 화소를 잘라 쓰는 것이라 배율만큼 해상도가 그대로 준다.
 * 4배면 면적이 1/16이다. 그 이상은 각인을 읽으려고 당겼는데 오히려 뭉개져서
 * 당긴 보람이 없다 — 그럴 때는 폰 기본 카메라 앱으로 찍는 편이 낫다.
 */
export const DIGITAL_ZOOM_RANGE: ZoomRange = { min: 1, max: 4 };

/**
 * 배율 버튼에 내놓을 후보. 순정 카메라 앱이 쓰는 눈금과 같게 두었다 — 손이
 * 이미 외우고 있는 자리여야 화면을 보지 않고도 누른다.
 *
 * 이 중 **그 기기가 실제로 낼 수 있는 것만** 화면에 나간다. 낼 수 없는 배율을
 * 버튼으로 두면 눌러도 아무 일이 없어서 고장으로 보인다.
 */
const PRESET_CANDIDATES = [0.5, 1, 2, 3, 5, 10] as const;

/**
 * 범위 밖으로 나간 배율을 잘라 낸다.
 *
 * NaN·Infinity도 여기서 막는다. 핀치는 손가락이 하나로 줄어드는 순간처럼 값이
 * 성립하지 않는 상태를 지나가고, 배율에 NaN이 한 번 들어가면 화면 표시와 촬영
 * 잘라내기가 같이 무너진다. 그때는 최소 배율로 되돌린다.
 */
export function clampZoom(value: number, range: ZoomRange): number {
  if (!Number.isFinite(value)) return range.min;
  if (value < range.min) return range.min;
  if (value > range.max) return range.max;
  return value;
}

/**
 * 두 손가락 사이 거리가 변한 만큼 배율을 옮긴다.
 *
 * 손가락을 두 배로 벌리면 두 배로 당겨진다 — 순정 카메라 앱과 같은 느낌이다.
 * 기준은 **핀치를 시작한 순간의 배율과 거리**다. 매 프레임의 직전 값과 비교하면
 * 반올림 오차가 쌓여 손을 그대로 두어도 배율이 흐른다.
 *
 * 거리가 0이거나 음수이면 비율을 낼 수 없다(0으로 나누기). 그때는 시작 배율을
 * 그대로 둔다 — 손가락을 떼는 순간 배율이 튀지 않는 것이 화면에서 자연스럽다.
 */
export function zoomFromPinch(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
  range: ZoomRange
): number {
  if (!Number.isFinite(startDistance) || !Number.isFinite(currentDistance)) {
    return clampZoom(startZoom, range);
  }
  if (startDistance <= 0 || currentDistance <= 0) {
    return clampZoom(startZoom, range);
  }
  return clampZoom(startZoom * (currentDistance / startDistance), range);
}

/**
 * 이 기기에서 실제로 낼 수 있는 배율 버튼들.
 *
 * 1배는 "원래 화면으로 돌아오는" 유일한 버튼이라 빠지면 안 된다. 당겨 놓고
 * 되돌릴 길이 없으면 카메라를 껐다 켜는 수밖에 없어진다. 범위가 1을 담지 못하는
 * 기기(하한이 1보다 큰 경우)라면 그 하한이 곧 원래 화면이므로 그것을 넣는다.
 */
export function zoomPresets(range: ZoomRange): number[] {
  const values = new Set<number>(
    PRESET_CANDIDATES.filter((candidate) => candidate >= range.min && candidate <= range.max)
  );
  values.add(clampZoom(1, range));
  return [...values].sort((left, right) => left - right);
}

/**
 * 디지털 줌으로 찍을 때 원본 프레임에서 잘라낼 사각형.
 *
 * **가운데 기준이다.** 화면의 확대도 가운데 기준(transform-origin: center)이고
 * 좌우로 미는(pan) 기능을 두지 않았다. 그래서 이 사각형이 화면에 보이는 것과
 * 일치한다 — 미는 기능을 만드는 순간 이 계산도 같이 바뀌어야 한다.
 *
 * 배율 1은 원본 전체다. 하드웨어 줌으로 찍을 때도 이 함수에 1을 넘기면 되고,
 * 그러면 이미 확대돼 들어온 프레임을 또 자르지 않는다.
 *
 * 잘라낸 크기를 그대로 저장한다. 원래 크기로 다시 늘리지 않는다 — 없는 화질을
 * 만들어 내지 못하면서 파일만 커진다.
 */
export function digitalCropRect(videoWidth: number, videoHeight: number, zoom: number): CropRect {
  // 카메라가 준비되기 전에는 videoWidth가 0이다. 그대로 나누면 Infinity가 나가고
  // 그 값이 drawImage로 들어간다.
  if (!(videoWidth > 0) || !(videoHeight > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };

  // 1배 아래로는 잘라낼 것이 없다. 원본보다 넓은 화각은 만들어 낼 수 없기 때문에
  // 0.5배 같은 값은 하드웨어가 프레임 자체를 넓게 줄 때만 의미가 있다.
  const factor = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;

  const sw = Math.min(videoWidth, Math.max(1, Math.round(videoWidth / factor)));
  const sh = Math.min(videoHeight, Math.max(1, Math.round(videoHeight / factor)));
  return {
    sx: Math.floor((videoWidth - sw) / 2),
    sy: Math.floor((videoHeight - sh) / 2),
    sw,
    sh,
  };
}

/** 화면에 적는 배율. 정수는 "2x", 그 사이는 "1.7x"다. */
export function formatZoom(zoom: number): string {
  if (!Number.isFinite(zoom)) return "1x";
  const rounded = Math.round(zoom * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}x` : `${rounded.toFixed(1)}x`;
}

/**
 * 이 버튼이 지금 눌린 것으로 보여야 하는가.
 *
 * 핀치로 온 배율은 2.0000이 아니라 1.98처럼 온다. 정확히 같은지로 따지면 버튼이
 * 영영 눌린 상태가 되지 않아, 지금 어디쯤인지 화면에서 읽을 수 없다.
 */
export function isZoomAtPreset(zoom: number, preset: number): boolean {
  return Math.abs(zoom - preset) < 0.05;
}
