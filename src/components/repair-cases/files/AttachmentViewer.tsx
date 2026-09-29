"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";

/**
 * ============================================================================
 * 사진 크게 보기 — 목록에서 누르면 열리는 화면
 * ============================================================================
 * 썸네일로는 파형의 눈금도, 외관의 흠집도 확인할 수 없다. 확인하려고 찍은
 * 사진이므로 **크게 볼 수 있어야 찍은 뜻이 산다.**
 *
 * ── 받아 보지 않고 화면에서 본다. 다만 **원본**이다 ──────────────────────
 * 주소는 `?view=full`이다. 목록의 썸네일이 쓰는 `?view=thumb`과 갈라 둔 이유가
 * 실제로 겪은 사고다 — 미리보기를 도입하자 크게 보기까지 480px 썸네일을 보여
 * 주게 되었다. 파형의 눈금을 확인하려고 여는 화면인데 확인할 수 없는 해상도가
 * 된 것이다.
 *
 * 🔴 그래서 이 파일에는 주소를 만드는 자리가 셋으로 갈려 있다
 * (viewerFullUrl · viewerThumbUrl · viewerDownloadUrl). **아래쪽 썸네일 줄은
 * `?view=thumb` 이다** — 거기서 원본을 부르면 한 건의 사진 수십 장이 한꺼번에
 * 원본으로 내려온다. 크게 보는 자리만 `?view=full` 이다.
 *
 * 두 주소 모두 **감사 로그를 남기지 않는다** — 화면에서 보는 것과 파일을
 * 가져가는 것은 다른 일이고, 기록해야 하는 것은 뒤쪽이다(라우트 주석 참조).
 *
 * ── 앞뒤로 넘긴다 ────────────────────────────────────────────────────────
 * 사진은 한 장만 보는 일이 드물다. 한 건에 여러 장을 찍어 두고 비교하므로,
 * 열고 닫기를 반복하지 않게 좌우로 넘길 수 있어야 한다. 폰에서는 손가락으로
 * 밀어서, PC에서는 방향키와 화살표 버튼으로 넘긴다. 아래쪽 썸네일 줄을 눌러
 * 바로 건너뛸 수도 있다.
 *
 * 넘길 수 있는 것은 **화면에서 볼 수 있는 형식뿐**이다. 압축 파일 사이를
 * 지나가게 두면 넘기다 빈 화면을 만난다 — 부르는 쪽이 사진만 걸러 넘긴다.
 *
 * ── 확대·회전은 **보는 방식**일 뿐이다 ──────────────────────────────────
 * 휠과 핀치로 키우고, 키운 뒤에는 끌어서 움직인다. 왼쪽·오른쪽 90° 회전과
 * 좌우·상하 뒤집기도 있다. 전부 CSS `transform` 이고 **파일은 한 글자도 바뀌지
 * 않는다.** 그래서 사진을 넘기면 초기화된다 — 다음 사진은 똑바로, 1배로 시작
 * 하는 것이 "이 사진을 이렇게 돌려 뒀다"보다 예측 가능하다.
 *
 * 돌린 결과를 원본에 저장하는 기능이 나중에 붙는다(사용자 결정: 원본을
 * 덮어쓴다). 그때 서버로 보낼 값이 `ViewerTransform.orientation` 하나로 모여
 * 있게 둔 것이 그 준비다 — 확대·이동(scale·offset)은 보는 사람의 화면 사정일
 * 뿐이라 저장할 것이 아니고, 회전·뒤집기만 그림 자체의 방향이다.
 * ============================================================================
 */

// ════════════════════════════════════════════════════ 보는 방식 — 순수 계산부
//
// 이 아래는 브라우저를 부르지 않는다. 화면에서 벌어지는 일(휠·핀치·끌기·넘김)을
// 전부 "지금 상태 → 다음 상태" 함수로 적어 두면 Node 단위 시험이 그대로 돌고,
// 「확대 중에는 스와이프가 먹지 않는다」 같은 규칙을 손가락 없이 못박을 수 있다.

/** 90° 단위로만 돈다. 그림 파일의 방향(EXIF)도 이 네 값뿐이다. */
export type ViewerRotation = 0 | 90 | 180 | 270;

/**
 * **그림 자체의 방향.** 나중에 원본에 저장하게 되면 서버로 넘어갈 값이 이것
 * 하나다 — 그래서 확대·이동과 한 덩어리로 섞지 않고 따로 모아 둔다.
 */
export type ImageOrientation = {
  rotate: ViewerRotation;
  flipX: boolean;
  flipY: boolean;
};

/** 방향 + 지금 화면에서의 배율·이동. 뒤의 둘은 저장 대상이 아니다. */
export type ViewerTransform = {
  orientation: ImageOrientation;
  scale: number;
  /** 화면 좌표(px)다. 돌아가 있어도 값의 뜻이 변하지 않는다 — viewerTransformCss 주석. */
  offsetX: number;
  offsetY: number;
};

/** 뷰어가 들고 있는 전부. 자리를 옮기면 변환이 함께 초기화되어야 해서 한 덩어리다. */
export type ViewerState = {
  index: number;
  transform: ViewerTransform;
};

export const IDENTITY_ORIENTATION: ImageOrientation = { rotate: 0, flipX: false, flipY: false };

export const IDENTITY_TRANSFORM: ViewerTransform = {
  orientation: IDENTITY_ORIENTATION,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

/**
 * 1배 아래로는 내려가지 않는다. 화면에 맞춰 놓은(object-contain) 크기가 이미
 * "전부 보이는" 상태라, 그보다 줄이면 검은 바탕만 넓어진다.
 */
export const VIEWER_MIN_SCALE = 1;

/** 8배. 12MP 사진이라면 눈금 한 칸이 화면에서 손가락만 해진다 — 그 위는 뭉갠 픽셀뿐이다. */
export const VIEWER_MAX_SCALE = 8;

/** 두 번 눌렀을 때 가는 배율. 한 번에 "확인할 만큼"은 커지되 길을 잃지 않는 정도다. */
export const VIEWER_DOUBLE_TAP_SCALE = 2.5;

/** 확대·축소 단추 한 번의 폭. 휠 한 칸도 같은 폭이라 두 길이 같은 격자 위에서 논다. */
export const VIEWER_ZOOM_STEP = 1.25;

/**
 * 60px은 "밀었다"와 "누르다 손이 조금 움직였다"를 가르는 선이다. 더 작게 잡으면
 * 사진을 보려고 누른 것이 넘김으로 읽힌다.
 */
export const SWIPE_THRESHOLD_PX = 60;

/** 이 안쪽이면 "민 것"이 아니라 "톡 친 것"이다. 두 번 누르기를 가려내는 데 쓴다. */
const TAP_SLOP_PX = 10;

/** 두 번 누르기로 인정하는 간격(ms). */
const DOUBLE_TAP_WINDOW_MS = 300;

/**
 * 손가락으로 두 번 누르면 브라우저가 뒤이어 가짜 dblclick 을 한 번 더 보낸다.
 * 그대로 두면 배율이 켜졌다 곧바로 꺼진다 — 손으로 만진 직후의 dblclick 은 무시한다.
 */
const SYNTHETIC_DBLCLICK_WINDOW_MS = 700;

export function clampViewerScale(scale: number): number {
  if (!Number.isFinite(scale)) return VIEWER_MIN_SCALE;
  if (scale < VIEWER_MIN_SCALE) return VIEWER_MIN_SCALE;
  if (scale > VIEWER_MAX_SCALE) return VIEWER_MAX_SCALE;
  return scale;
}

/** 키워 놓은 상태인가. 소수 오차로 1.0000001 이 남아도 "확대 중"으로 읽히지 않게 여유를 둔다. */
export function isViewerZoomed(transform: ViewerTransform): boolean {
  return transform.scale > VIEWER_MIN_SCALE + 1e-6;
}

/**
 * 🔴 **확대 중에는 끌기가 넘김을 이긴다.**
 *
 * 키운 사진의 오른쪽 끝을 보려고 왼쪽으로 끄는 동작과, 다음 사진으로 넘기려고
 * 왼쪽으로 미는 동작은 손가락만 보면 똑같다. 둘 다 받으면 사진 속을 돌아다닐
 * 수가 없다 — 배율이 1일 때만 넘김으로 읽는다.
 */
export function canSwipeNavigate(transform: ViewerTransform): boolean {
  return !isViewerZoomed(transform);
}

/**
 * 배율을 바꾸되 **기준점(anchor) 아래의 그림이 제자리에 머물게** 이동값을 다시 잡는다.
 * 기준점은 무대 한가운데를 원점으로 한 화면 좌표(px)다 — 커서 밑이나 두 손가락
 * 사이가 그대로 확대의 중심이 되어야 "그 부분을 보려고" 키운 뜻이 산다.
 *
 * 화면점 s = offset + scale·p 에서 s 를 고정한 채 scale 만 k배 하면
 * offset' = anchor·(1−k) + offset·k 가 된다. 회전·뒤집기가 끼어도 그대로다
 * (그쪽은 안쪽에서 돌 뿐 바깥 좌표를 건드리지 않는다).
 */
export function zoomViewerTo(
  transform: ViewerTransform,
  nextScale: number,
  anchorX = 0,
  anchorY = 0
): ViewerTransform {
  const scale = clampViewerScale(nextScale);
  if (scale === transform.scale) return transform;

  // 1배로 돌아오면 이동값도 함께 지운다. 화면에 딱 맞는 그림을 옆으로 밀어 둘
  // 이유가 없고, 남겨 두면 다음에 키울 때 엉뚱한 자리에서 시작한다.
  if (scale <= VIEWER_MIN_SCALE) {
    return { ...transform, scale: VIEWER_MIN_SCALE, offsetX: 0, offsetY: 0 };
  }

  const ratio = scale / transform.scale;
  return {
    ...transform,
    scale,
    offsetX: anchorX * (1 - ratio) + transform.offsetX * ratio,
    offsetY: anchorY * (1 - ratio) + transform.offsetY * ratio,
  };
}

/** 지금 배율에 factor 를 곱한다. 휠 한 칸·단추 한 번이 이 길로 들어온다. */
export function zoomViewerBy(
  transform: ViewerTransform,
  factor: number,
  anchorX = 0,
  anchorY = 0
): ViewerTransform {
  if (!Number.isFinite(factor) || factor <= 0) return transform;
  return zoomViewerTo(transform, transform.scale * factor, anchorX, anchorY);
}

/**
 * 두 번 눌렀을 때. 키워 놨으면 원래대로, 1배면 눌린 자리를 중심으로 키운다.
 * **방향(회전·뒤집기)은 건드리지 않는다** — 돌려 놓고 확대해 보는 일이 잦은데
 * 두 번 눌렀다고 돌린 것까지 풀리면 다시 돌려야 한다.
 */
export function toggleViewerZoom(
  transform: ViewerTransform,
  anchorX = 0,
  anchorY = 0
): ViewerTransform {
  if (isViewerZoomed(transform)) return zoomViewerTo(transform, VIEWER_MIN_SCALE);
  return zoomViewerTo(transform, VIEWER_DOUBLE_TAP_SCALE, anchorX, anchorY);
}

/** 끌어 옮긴 만큼 더한다. dx·dy 는 손가락(커서)이 화면에서 움직인 px 그대로다. */
export function panViewerBy(transform: ViewerTransform, dx: number, dy: number): ViewerTransform {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return transform;
  if (dx === 0 && dy === 0) return transform;
  return { ...transform, offsetX: transform.offsetX + dx, offsetY: transform.offsetY + dy };
}

/**
 * 그림을 화면 밖으로 완전히 내보내지 못하게 막는다. 한계는 키운 만큼 늘어난
 * 여백의 절반이다 — 무대 크기로 재는 것이라 세로로 긴 사진에서는 조금 헐겁지만,
 * 막으려는 것은 "검은 화면만 남고 되돌릴 길을 잃는" 쪽이다.
 *
 * 무대 크기를 아직 모르면(서버 렌더 등) 아무것도 하지 않는다.
 */
export function clampViewerPan(
  transform: ViewerTransform,
  stageWidth: number,
  stageHeight: number
): ViewerTransform {
  if (!(stageWidth > 0) || !(stageHeight > 0)) return transform;

  const limitX = Math.max(0, ((transform.scale - 1) * stageWidth) / 2);
  const limitY = Math.max(0, ((transform.scale - 1) * stageHeight) / 2);
  const offsetX = Math.min(Math.max(transform.offsetX, -limitX), limitX);
  const offsetY = Math.min(Math.max(transform.offsetY, -limitY), limitY);
  if (offsetX === transform.offsetX && offsetY === transform.offsetY) return transform;
  return { ...transform, offsetX, offsetY };
}

/** 90°씩 돈다. 1이 오른쪽(시계 방향), -1이 왼쪽이다. */
export function rotateViewer(transform: ViewerTransform, quarterTurns: number): ViewerTransform {
  if (!Number.isFinite(quarterTurns)) return transform;
  const turns = Math.round(quarterTurns);
  const degrees = (((transform.orientation.rotate + turns * 90) % 360) + 360) % 360;
  return {
    ...transform,
    orientation: { ...transform.orientation, rotate: degrees as ViewerRotation },
  };
}

/** 90°·270° 로 돌아가 있으면 그림의 가로축이 화면에서는 세로축이다. */
export function isQuarterTurned(orientation: ImageOrientation): boolean {
  return orientation.rotate === 90 || orientation.rotate === 270;
}

/**
 * 🔴 **화면에서** 좌우로 뒤집는다.
 *
 * 저장해 둔 flipX·flipY 는 **그림 자신의 축** 기준이다(그래야 나중에 파일에
 * 그대로 적을 수 있다). 그런데 90° 돌려 놓은 상태에서는 그림의 가로축이 화면의
 * 세로축이라, flipX 를 그냥 켜면 눌러 놓고 위아래가 뒤집힌다. 돌아가 있을 때는
 * 반대쪽 값을 켜야 화면에서 좌우가 뒤집힌다.
 */
export function flipViewerAcrossScreenX(transform: ViewerTransform): ViewerTransform {
  return isQuarterTurned(transform.orientation)
    ? toggleFlipY(transform)
    : toggleFlipX(transform);
}

/** 화면에서 상하로 뒤집는다. 까닭은 위와 같다. */
export function flipViewerAcrossScreenY(transform: ViewerTransform): ViewerTransform {
  return isQuarterTurned(transform.orientation)
    ? toggleFlipX(transform)
    : toggleFlipY(transform);
}

function toggleFlipX(transform: ViewerTransform): ViewerTransform {
  return {
    ...transform,
    orientation: { ...transform.orientation, flipX: !transform.orientation.flipX },
  };
}

function toggleFlipY(transform: ViewerTransform): ViewerTransform {
  return {
    ...transform,
    orientation: { ...transform.orientation, flipY: !transform.orientation.flipY },
  };
}

/** 방향도 배율도 처음으로. 「원래대로」 단추가 부른다. */
export function resetViewerTransform(): ViewerTransform {
  return IDENTITY_TRANSFORM;
}

/** 무엇이든 건드려 놓았는가 — 「원래대로」를 눌러 볼 일이 있는지 판단한다. */
export function isViewerTransformIdentity(transform: ViewerTransform): boolean {
  return (
    transform.scale === VIEWER_MIN_SCALE &&
    transform.offsetX === 0 &&
    transform.offsetY === 0 &&
    transform.orientation.rotate === 0 &&
    !transform.orientation.flipX &&
    !transform.orientation.flipY
  );
}

/**
 * CSS `transform` 값. 🔴 **차례가 뜻을 바꾼다.**
 *
 * CSS 는 적힌 순서대로 행렬을 곱하므로 점에는 **오른쪽 것이 먼저** 걸린다.
 * `translate` 를 맨 앞에 두면 이동은 모든 회전 바깥에서, 즉 **화면 좌표 그대로**
 * 일어난다 — 그래서 90° 돌려 놓고 끌어도 손가락을 따라간다. 반대로
 * `rotate(90deg) translate(x,y)` 로 적으면 이동이 그림과 함께 돌아, 위로 끌면
 * 옆으로 움직이는 화면이 된다(실제로 그렇게 어긋난다).
 *
 * 뒤집기가 맨 끝인 것도 같은 이유다. 그림 자신의 축에 먼저 걸려야 저장해 둔
 * flipX/flipY 의 뜻이 "그림의 좌우"로 유지된다.
 */
export function viewerTransformCss(transform: ViewerTransform): string {
  const round = (value: number) => Math.round(value * 100) / 100;
  const parts = [
    `translate(${round(transform.offsetX)}px, ${round(transform.offsetY)}px)`,
    `scale(${round(transform.scale)})`,
  ];
  if (transform.orientation.rotate !== 0) parts.push(`rotate(${transform.orientation.rotate}deg)`);
  if (transform.orientation.flipX) parts.push("scaleX(-1)");
  if (transform.orientation.flipY) parts.push("scaleY(-1)");
  return parts.join(" ");
}

/**
 * 다른 사진으로 간다. **넘어가면 변환이 초기화된다** — 돌리고 키운 것은 그
 * 사진을 확인하려던 사정이지 다음 사진의 사정이 아니다. 자리가 그대로면 상태
 * 객체도 그대로 돌려주어(같은 참조) 괜히 다시 그리지 않는다.
 */
export function goToViewerIndex(state: ViewerState, next: number, count: number): ViewerState {
  if (count <= 0) return state;
  const bounded = Math.min(Math.max(Math.round(next), 0), count - 1);
  if (bounded === state.index) return state;
  return { index: bounded, transform: IDENTITY_TRANSFORM };
}

/** 한 장 앞·뒤로. 끝에서는 더 가지 않는다(감기지 않는다). */
export function stepViewerIndex(state: ViewerState, delta: number, count: number): ViewerState {
  return goToViewerIndex(state, state.index + delta, count);
}

/**
 * 손가락으로 민 결과. deltaX 는 뗀 자리 − 닿은 자리(px)다.
 * 오른쪽으로 밀면(양수) 앞 사진, 왼쪽으로 밀면 다음 사진.
 *
 * 🔴 확대 중이면 **아무 일도 일어나지 않는다**(canSwipeNavigate 주석).
 */
export function swipeViewerIndex(state: ViewerState, deltaX: number, count: number): ViewerState {
  if (!canSwipeNavigate(state.transform)) return state;
  if (deltaX >= SWIPE_THRESHOLD_PX) return stepViewerIndex(state, -1, count);
  if (deltaX <= -SWIPE_THRESHOLD_PX) return stepViewerIndex(state, 1, count);
  return state;
}

// ───────────────────────────────────────────────────────────── 주소 세 가지

/** 크게 보는 자리. **원본**이다 — 파일 머리말의 사고가 이 값에 걸려 있다. */
export function viewerFullUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download?view=full`;
}

/**
 * 아래쪽 썸네일 줄. 미리보기가 있으면 그것을, 없으면 원본을 준다.
 * 🔴 여기에 `full` 을 쓰면 한 건의 사진 전부가 원본으로 한꺼번에 내려온다.
 */
export function viewerThumbUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download?view=thumb`;
}

/** 실제로 가져가는 길. view 값이 없고, **이 경로만 감사 로그를 남긴다.** */
export function viewerDownloadUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/download`;
}

// ════════════════════════════════════════════════════════════════════ 화면

type AttachmentViewerProps = {
  /** 화면에서 볼 수 있는 것들만. 이 사이를 좌우로 오간다. */
  items: RepairCaseAttachmentListItem[];
  /** 처음 보여 줄 항목의 자리. */
  initialIndex: number;
  onClose: () => void;
  /** 지금 보고 있는 사진을 줄여서 받는다. 부모가 창을 띄운다. */
  onShrinkDownload?: (item: RepairCaseAttachmentListItem) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 손가락과 커서가 공통으로 갖춘 것. Touch 와 MouseEvent 둘 다 이 모양이다. */
type ScreenPoint = { clientX: number; clientY: number };

function distanceBetween(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * 지금 손가락이 무엇을 하고 있는가. 한 손가락은 **닿은 순간의 배율**로 갈린다 —
 * 1배면 넘기려는 것, 키워 놨으면 사진 속을 옮기려는 것이다.
 */
type TouchGesture =
  | null
  | {
      kind: "single";
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      startedAt: number;
      /** 닿은 순간 이미 키워져 있었는가. 도중에 배율이 바뀌어도 이 판단은 안 바뀐다. */
      panning: boolean;
    }
  | {
      kind: "pinch";
      startDistance: number;
      /** 벌리는 동안의 계산 기준. 매 프레임 누적하면 오차가 쌓여 손가락과 어긋난다. */
      startTransform: ViewerTransform;
      anchorX: number;
      anchorY: number;
      startMidX: number;
      startMidY: number;
    };

export default function AttachmentViewer({
  items,
  initialIndex,
  onClose,
  onShrinkDownload,
}: AttachmentViewerProps) {
  const [state, setState] = useState<ViewerState>({
    index: initialIndex,
    transform: IDENTITY_TRANSFORM,
  });
  const { index, transform } = state;

  /** 사진이 놓이는 칸. 확대 기준점과 이동 한계를 이 칸의 크기로 잰다. */
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** 지금 손가락이 하는 일. 그리는 데 쓰이지 않으므로 상태가 아니라 ref 다. */
  const gestureRef = useRef<TouchGesture>(null);
  /** 마우스로 끄는 중인 자리. 확대 중일 때만 채워진다. */
  const mouseDragRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapAtRef = useRef(0);
  const lastTouchEndAtRef = useRef(0);
  /** 지금 보고 있는 썸네일 단추. 넘길 때 줄이 따라 움직이게 하려고 들고 있다. */
  const currentThumbRef = useRef<HTMLButtonElement | null>(null);

  const count = items.length;
  const current = items[index];

  const go = useCallback(
    (next: number) => setState((value) => goToViewerIndex(value, next, count)),
    [count]
  );
  const step = useCallback(
    (delta: number) => setState((value) => stepViewerIndex(value, delta, count)),
    [count]
  );
  /** 변환만 갈아 끼운다. 같은 값이 돌아오면 상태를 그대로 두어 다시 그리지 않는다. */
  const applyTransform = useCallback((change: (t: ViewerTransform) => ViewerTransform) => {
    setState((value) => {
      const next = change(value.transform);
      return next === value.transform ? value : { ...value, transform: next };
    });
  }, []);

  // 키보드로 넘기고 닫는다. PC에서 여러 장을 훑을 때 마우스를 옮기지 않아도
  // 되고, Escape는 겹쳐 뜬 화면을 닫는 일반적인 약속이다.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, step]);

  // 뒤 페이지가 스크롤되지 않게 한다 — 사진을 보며 손가락을 끌면 뒤 목록이
  // 밀려, 닫았을 때 엉뚱한 자리에 가 있다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // 넘길 때 아래 썸네일 줄이 따라온다. 스무 장짜리 건에서 방향키로 훑으면
  // 지금 보는 것이 줄 밖으로 나가 버려, 어디쯤인지 알 수 없게 된다.
  // `block: "nearest"` 로 두어 가로만 움직이게 한다.
  useEffect(() => {
    currentThumbRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

  if (!current) return null;

  const hasPrevious = index > 0;
  const hasNext = index < count - 1;
  const zoomed = isViewerZoomed(transform);

  /** 무대 한가운데를 원점으로 한 좌표 — 확대의 기준점은 이 자리로 잰다. */
  function anchorOf(clientX: number, clientY: number): { x: number; y: number } {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  }

  function stageSize(): { width: number; height: number } {
    const rect = stageRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }

  function panBy(dx: number, dy: number) {
    const { width, height } = stageSize();
    applyTransform((t) => clampViewerPan(panViewerBy(t, dx, dy), width, height));
  }

  function zoomBy(factor: number, clientX?: number, clientY?: number) {
    const anchor =
      clientX === undefined || clientY === undefined ? { x: 0, y: 0 } : anchorOf(clientX, clientY);
    const { width, height } = stageSize();
    applyTransform((t) => clampViewerPan(zoomViewerBy(t, factor, anchor.x, anchor.y), width, height));
  }

  function toggleZoom(clientX: number, clientY: number) {
    const anchor = anchorOf(clientX, clientY);
    const { width, height } = stageSize();
    applyTransform((t) => clampViewerPan(toggleViewerZoom(t, anchor.x, anchor.y), width, height));
  }

  function onTouchStart(event: React.TouchEvent) {
    const [first, second] = [event.touches[0], event.touches[1]];
    if (first && second) {
      const midX = (first.clientX + second.clientX) / 2;
      const midY = (first.clientY + second.clientY) / 2;
      const anchor = anchorOf(midX, midY);
      gestureRef.current = {
        kind: "pinch",
        startDistance: Math.max(distanceBetween(first, second), 1),
        startTransform: transform,
        anchorX: anchor.x,
        anchorY: anchor.y,
        startMidX: midX,
        startMidY: midY,
      };
      return;
    }
    if (!first) return;
    gestureRef.current = {
      kind: "single",
      startX: first.clientX,
      startY: first.clientY,
      lastX: first.clientX,
      lastY: first.clientY,
      startedAt: Date.now(),
      // 🔴 여기서 한 번 갈라 두면 확대 중 끌기가 넘김으로 읽히지 않는다.
      panning: zoomed,
    };
  }

  function onTouchMove(event: React.TouchEvent) {
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.kind === "pinch") {
      const [first, second] = [event.touches[0], event.touches[1]];
      if (!first || !second) return;
      const ratio = distanceBetween(first, second) / gesture.startDistance;
      const midX = (first.clientX + second.clientX) / 2;
      const midY = (first.clientY + second.clientY) / 2;
      const { width, height } = stageSize();
      // 시작 상태에서 한 번에 계산한다 — 두 손가락을 벌렸다 좁히는 동안
      // 프레임마다 곱하면 반올림이 쌓여 손가락과 그림이 어긋난다.
      const zoomedTransform = zoomViewerTo(
        gesture.startTransform,
        gesture.startTransform.scale * ratio,
        gesture.anchorX,
        gesture.anchorY
      );
      const moved = panViewerBy(zoomedTransform, midX - gesture.startMidX, midY - gesture.startMidY);
      const settled = clampViewerPan(moved, width, height);
      applyTransform(() => settled);
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;
    if (gesture.panning) {
      panBy(touch.clientX - gesture.lastX, touch.clientY - gesture.lastY);
    }
    gesture.lastX = touch.clientX;
    gesture.lastY = touch.clientY;
  }

  function onTouchEnd(event: React.TouchEvent) {
    const gesture = gestureRef.current;
    lastTouchEndAtRef.current = Date.now();

    // 손가락이 아직 남아 있으면(핀치에서 하나만 뗀 경우) 새 동작을 시작하지
    // 않는다. 남은 손가락이 곧바로 넘김으로 읽히면 벌리다 말고 사진이 바뀐다.
    if (event.touches.length > 0) {
      gestureRef.current = null;
      return;
    }
    gestureRef.current = null;
    if (!gesture || gesture.kind !== "single") return;

    const touch = event.changedTouches[0];
    const endX = touch?.clientX ?? gesture.startX;
    const endY = touch?.clientY ?? gesture.startY;
    const movedX = endX - gesture.startX;
    const movedY = endY - gesture.startY;
    const now = Date.now();

    const isTap =
      Math.abs(movedX) < TAP_SLOP_PX &&
      Math.abs(movedY) < TAP_SLOP_PX &&
      now - gesture.startedAt < DOUBLE_TAP_WINDOW_MS;
    if (isTap) {
      if (now - lastTapAtRef.current < DOUBLE_TAP_WINDOW_MS) {
        lastTapAtRef.current = 0;
        toggleZoom(endX, endY);
      } else {
        lastTapAtRef.current = now;
      }
      return;
    }

    // 끌어 옮기던 손가락은 여기서 끝일 뿐이다 — 넘김으로 이어지지 않는다.
    if (gesture.panning) return;
    setState((value) => swipeViewerIndex(value, movedX, count));
  }

  function onWheel(event: React.WheelEvent) {
    // preventDefault 를 부르지 않는다. React 는 wheel 을 수동(passive) 으로 달아
    // 막을 수 없고, 어차피 body 스크롤을 잠가 두어(위 effect) 뒤가 밀리지 않는다.
    if (event.deltaY === 0) return;
    zoomBy(event.deltaY < 0 ? VIEWER_ZOOM_STEP : 1 / VIEWER_ZOOM_STEP, event.clientX, event.clientY);
  }

  function onMouseDown(event: React.MouseEvent) {
    if (!zoomed || event.button !== 0) return;
    mouseDragRef.current = { x: event.clientX, y: event.clientY };
  }

  function onMouseMove(event: React.MouseEvent) {
    const drag = mouseDragRef.current;
    if (!drag) return;
    panBy(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  }

  function onMouseUp() {
    mouseDragRef.current = null;
  }

  function onDoubleClick(event: React.MouseEvent) {
    // 손가락으로 두 번 누르면 브라우저가 dblclick 을 한 번 더 흉내 내 보낸다.
    // 그것까지 받으면 방금 켠 확대가 곧바로 꺼진다.
    if (Date.now() - lastTouchEndAtRef.current < SYNTHETIC_DBLCLICK_WINDOW_MS) return;
    toggleZoom(event.clientX, event.clientY);
  }

  const toolButtonClass =
    "flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-base leading-none text-white disabled:opacity-40";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${current.originalFileName} 크게 보기`}
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      {/* 위쪽 — 이름과 자리, 닫기 */}
      <div className="flex shrink-0 items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-6 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{current.originalFileName}</p>
          <p className="text-xs text-white/70 tabular-nums">
            {index + 1} / {count} · {formatBytes(current.fileSize)}
            {zoomed ? ` · ${Math.round(transform.scale * 100)}%` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white"
        >
          ×
        </button>
      </div>

      {/*
        사진 — 남는 공간을 전부 쓴다. object-contain이라 잘리지 않는다.
        손가락 동작을 이 칸에만 단다(예전에는 창 전체였다). 아래 썸네일 줄을
        옆으로 밀어 훑는 것과 사진을 넘기는 것이 섞이지 않게 하려는 것이다.
        `touchAction: none` 이 없으면 브라우저가 먼저 스크롤·확대를 가져가 핀치가
        화면 전체를 키운다.
      */}
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={onDoubleClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          // key를 주어 넘길 때마다 새로 그리게 한다 — 안 그러면 앞 사진이
          // 남아 있다가 바뀌어 무엇을 보고 있는지 잠깐 헷갈린다.
          key={current.id}
          src={viewerFullUrl(current.id)}
          alt={current.originalFileName}
          // 끌기는 우리가 계산한다. 브라우저의 그림 끌어놓기가 먼저 잡으면
          // 손가락·커서를 따라가다 말고 "파일을 옮기는 중" 모양이 된다.
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
          style={{
            transform: viewerTransformCss(transform),
            cursor: zoomed ? "grab" : "default",
          }}
        />

        {hasPrevious && (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="이전 사진"
            className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white"
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="다음 사진"
            className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white"
          >
            ›
          </button>
        )}
      </div>

      {/*
        아래쪽 한 덩어리 — 단추 줄 · 썸네일 줄 · 설명과 내려받기.
        🔴 safe-area 여백을 이 바깥 칸에서 **한 번만** 준다. 예전처럼 안쪽 줄마다
        주면 줄을 하나 더할 때마다 여백이 겹치거나, 반대로 맨 아래 줄이 폰의
        둥근 모서리·홈 바에 가린다.
      */}
      <div className="shrink-0 bg-gradient-to-t from-black/80 to-transparent pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-4">
        {/*
          보기만 바꾸는 단추들. 파일은 그대로다 — 돌려 놓고 내려받아도 받는 것은
          원본이다(그 저장 기능은 다음에 붙는다).
        */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 px-4">
          <button
            type="button"
            onClick={() => applyTransform((t) => rotateViewer(t, -1))}
            aria-label="왼쪽으로 90도 회전"
            className={toolButtonClass}
          >
            ↺
          </button>
          <button
            type="button"
            onClick={() => applyTransform((t) => rotateViewer(t, 1))}
            aria-label="오른쪽으로 90도 회전"
            className={toolButtonClass}
          >
            ↻
          </button>
          <button
            type="button"
            onClick={() => applyTransform(flipViewerAcrossScreenX)}
            aria-label="좌우 뒤집기"
            className={toolButtonClass}
          >
            ⇄
          </button>
          <button
            type="button"
            onClick={() => applyTransform(flipViewerAcrossScreenY)}
            aria-label="상하 뒤집기"
            className={toolButtonClass}
          >
            ⇅
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / VIEWER_ZOOM_STEP)}
            aria-label="축소"
            disabled={!zoomed}
            className={toolButtonClass}
          >
            −
          </button>
          <button
            type="button"
            onClick={() => zoomBy(VIEWER_ZOOM_STEP)}
            aria-label="확대"
            disabled={transform.scale >= VIEWER_MAX_SCALE}
            className={toolButtonClass}
          >
            ＋
          </button>
          <button
            type="button"
            onClick={() => applyTransform(resetViewerTransform)}
            aria-label="원래대로"
            disabled={isViewerTransformIdentity(transform)}
            className="flex h-10 items-center justify-center rounded-full bg-white/15 px-3 text-xs font-medium text-white disabled:opacity-40"
          >
            원래대로
          </button>
        </div>

        {/*
          썸네일 줄 — 한 장뿐이면 아예 그리지 않는다. 자기 사진 한 장을 밑에 또
          깔아 두면 정작 사진 볼 자리만 좁아진다.
          🔴 주소는 `viewerThumbUrl`(?view=thumb)이다. 여기서 원본을 부르면 스무
          장짜리 건을 열 때 원본 스무 장이 한꺼번에 내려온다.
        */}
        {count > 1 && (
          <div
            className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1"
            role="group"
            aria-label="이 건의 사진 목록"
          >
            {items.map((item, itemIndex) => {
              const isCurrent = itemIndex === index;
              return (
                <button
                  key={item.id}
                  type="button"
                  ref={isCurrent ? currentThumbRef : null}
                  onClick={() => go(itemIndex)}
                  aria-label={`${item.originalFileName} 보기`}
                  aria-current={isCurrent ? "true" : undefined}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 ${
                    isCurrent ? "border-white" : "border-transparent opacity-50"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewerThumbUrl(item.id)}
                    // 단추에 이름표가 붙어 있다. 여기에 또 적으면 읽어 주는
                    // 장치가 같은 파일명을 두 번 말한다.
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        )}

        {/* 분류·설명과 내려받기 */}
        <div className="mt-3 flex items-center justify-between gap-3 px-4">
          <p className="min-w-0 truncate text-xs text-white/80">{current.description ?? ""}</p>
          {/*
            평범한 링크다(view 값이 없다). 이쪽이 실제로 파일을 가져가는
            행위이고, 그래서 이 경로만 감사 로그를 남긴다.
          */}
          <div className="flex shrink-0 items-center gap-2">
            {onShrinkDownload && (
              <button
                type="button"
                onClick={() => onShrinkDownload(current)}
                className="rounded-md bg-white/15 px-3 py-2 text-sm font-medium text-white"
              >
                줄여서 받기
              </button>
            )}
            <a
              href={viewerDownloadUrl(current.id)}
              className="rounded-md bg-white/15 px-3 py-2 text-sm font-medium text-white"
            >
              내려받기
            </a>
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-white/40">
          {count > 1
            ? "좌우로 밀거나 방향키로 넘길 수 있습니다 · 휠·손가락 두 개로 확대, 두 번 누르면 원래대로"
            : "휠·손가락 두 개로 확대, 두 번 누르면 원래대로"}
        </p>
      </div>
    </div>
  );
}
