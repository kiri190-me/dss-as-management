"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IDENTITY_ORIENTATION,
  isIdentityOrientation,
  isQuarterTurned,
  orientedPixelSize,
  type ImageOrientation,
  type ViewerRotation,
} from "@/lib/domain/image-orientation";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";
import SaveRotationDialog, {
  type SaveRotationOutcome,
  type SaveRotationTarget,
} from "./SaveRotationDialog";

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
 * 🔴 **두 주소에는 파일의 지문(체크섬 앞 12자)이 `v` 로 붙는다**
 * (attachmentFingerprintSuffix). 「돌린 대로 저장」 뒤에도 이 화면의 그림이 옛
 * 방향으로 남아 있던 까닭이 그것이 없어서였다 — 응답이 `no-store` 라도 이미
 * 그려 놓은 `<img>` 는 주소가 같으면 다시 받지 않는다. 목록의 작은 그림이 쓰는
 * 규칙과 **같은 함수**다.
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

/**
 * **그림 자체의 방향.** 확대·이동과 한 덩어리로 섞지 않고 따로 모아 둔 값이고,
 * 이제 **실제로 서버까지 간다** — 「돌린 대로 저장」이 이 값을 주소에 싣고,
 * 캔버스가 이 값으로 원본을 다시 그린다.
 *
 * 🔴 그래서 **정본은 lib/domain/image-orientation.ts 로 옮겼다.** 같은 값이
 * 화면(CSS) · 주소(?rotate=90) · 캔버스 세 자리를 지나는데, 타입과 판정이 화면
 * 파일에 있으면 서버 쪽에서 베껴 쓰게 되고 그때부터 갈라진다. 여기서는 그대로
 * 다시 내보낸다 — 이 파일에서 가져다 쓰던 쪽(시험 포함)은 달라지지 않는다.
 */
export type { ImageOrientation, ViewerRotation };

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

export { IDENTITY_ORIENTATION, isQuarterTurned };

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

/**
 * 90°씩 돈다 — **방향 값 하나만** 받는다. 1이 오른쪽(시계 방향), -1이 왼쪽이다.
 *
 * 🔴 여러 장을 한꺼번에 돌리는 길이 생기면서 「돌린다」의 셈이 두 군데로 갈릴
 * 뻔했다. 배율·이동까지 들고 있는 ViewerTransform 을 거치지 않는 이 함수가
 * 정본이고, 아래 rotateViewer 와 고른 것들에 거는 mapPicked·orientPickedTo 가
 * 모두 이것을 부른다 — 한쪽만 고치면 화면과 저장이 갈라진다.
 */
export function rotateOrientation(
  orientation: ImageOrientation,
  quarterTurns: number
): ImageOrientation {
  if (!Number.isFinite(quarterTurns)) return orientation;
  const turns = Math.round(quarterTurns);
  const degrees = (((orientation.rotate + turns * 90) % 360) + 360) % 360;
  return { ...orientation, rotate: degrees as ViewerRotation };
}

/**
 * 🔴 **화면에서** 좌우로 뒤집는다 — 방향 값 하나만 받는다.
 *
 * 저장해 둔 flipX·flipY 는 **그림 자신의 축** 기준이다(그래야 나중에 파일에
 * 그대로 적을 수 있다). 그런데 90° 돌려 놓은 상태에서는 그림의 가로축이 화면의
 * 세로축이라, flipX 를 그냥 켜면 눌러 놓고 위아래가 뒤집힌다. 돌아가 있을 때는
 * 반대쪽 값을 켜야 화면에서 좌우가 뒤집힌다.
 */
export function flipOrientationAcrossScreenX(orientation: ImageOrientation): ImageOrientation {
  return isQuarterTurned(orientation)
    ? { ...orientation, flipY: !orientation.flipY }
    : { ...orientation, flipX: !orientation.flipX };
}

/** 화면에서 상하로 뒤집는다. 까닭은 위와 같다. */
export function flipOrientationAcrossScreenY(orientation: ImageOrientation): ImageOrientation {
  return isQuarterTurned(orientation)
    ? { ...orientation, flipX: !orientation.flipX }
    : { ...orientation, flipY: !orientation.flipY };
}

/** 90°씩 돈다. 1이 오른쪽(시계 방향), -1이 왼쪽이다. */
export function rotateViewer(transform: ViewerTransform, quarterTurns: number): ViewerTransform {
  const orientation = rotateOrientation(transform.orientation, quarterTurns);
  // 같은 값이 돌아오면(알아들을 수 없는 인자) 상태를 그대로 둔다 — 괜히 다시 그리지 않는다.
  if (orientation === transform.orientation) return transform;
  return { ...transform, orientation };
}

/** 화면에서 좌우로 뒤집는다(위 flipOrientationAcrossScreenX 주석). */
export function flipViewerAcrossScreenX(transform: ViewerTransform): ViewerTransform {
  return { ...transform, orientation: flipOrientationAcrossScreenX(transform.orientation) };
}

/** 화면에서 상하로 뒤집는다. */
export function flipViewerAcrossScreenY(transform: ViewerTransform): ViewerTransform {
  return { ...transform, orientation: flipOrientationAcrossScreenY(transform.orientation) };
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
    isIdentityOrientation(transform.orientation)
  );
}

/**
 * 「돌린 대로 저장」 단추를 내밀어야 하는가. 🔴 **셋이 모두 참일 때만이다.**
 *
 *  1. **부르는 쪽이 저장하는 길을 줬는가**(`hasHandler`). 이것이 곧 권한이다 —
 *     화면이 역할을 보고 스스로 판단하지 않는다. 지금 이 첨부를 지울 수 있는
 *     사람(repairCases.files WRITE)에게만 부모가 이 길을 넘긴다. 권한이 없으면
 *     눌렀다가 거절당하는 것이 아니라 **처음부터 단추가 없다.**
 *  2. **사진인가.** PDF·압축 파일에는 아예 없다. 뷰어에 들어오는 목록이 이미
 *     사진만 걸러져 있지만, 거르는 쪽이 넓어지는 날 되돌릴 수 없는 단추가
 *     조용히 따라 넓어지면 안 된다.
 *  3. **돌리거나 뒤집은 것이 있는가.** 그대로인 것을 저장하면 원본을 아무 뜻
 *     없이 다시 인코딩해 화질만 잃는다(서버도 NO_CHANGE 로 거절한다).
 *
 * 확대·이동은 보는 사람의 화면 사정이라 여기 끼지 않는다 — 키워 놓기만 한
 * 상태에서는 단추가 나오지 않는다.
 *
 * 화면 안에 이 조건을 흩어 두지 않고 함수 하나로 뽑은 까닭은 시험이 그것을
 * 못박을 수 있게 하려는 것이다(previewAffordanceOf 와 같은 방식).
 */
export function canOfferOrientationSave(params: {
  hasHandler: boolean;
  mimeType: string;
  orientation: ImageOrientation;
  /**
   * 「고르기」로 골라 둔 것 가운데 **저장할 것이 몇 장인가**(pickedSaveTargets).
   *
   * 🔴 여러 장 모드에서는 **지금 보고 있는 한 장이 그대로여도** 단추가 나와야
   * 한다 — 다른 사진들을 돌려 놓고 아직 안 돌린 사진을 보고 있는 중일 수 있다.
   * 넘기지 않으면 0 이라, 지금까지 이 함수를 부르던 자리의 판정은 한 글자도
   * 달라지지 않는다(셋째 조건 「돌린 것이 있는가」가 그대로 마지막에 남는다).
   */
  pickedCount?: number;
}): boolean {
  if (!params.hasHandler) return false;
  if (params.mimeType !== "image/jpeg" && params.mimeType !== "image/png") return false;
  if ((params.pickedCount ?? 0) > 0) return true;
  return !isIdentityOrientation(params.orientation);
}

// ══════════════════════════════════ 여러 장을 골라 한꺼번에 — 순수 계산부
//
// 🔴 **원본을 여러 장 한꺼번에 덮어쓰는 길이다.** 그래서 「무엇을 고쳤는가」와
// 「무엇을 저장하는가」의 셈을 전부 이 아래의 순수 함수로 빼 두었다 — 손가락
// 없이 시험이 못박을 수 있어야 한다.

/**
 * 고른 사진들과 **각자의 방향**. 열쇠가 있다는 것이 곧 「골랐다」는 표시이고,
 * 값이 그 사진에 걸어 둔 방향이다.
 *
 * 🔴 **한 방향 값을 모두가 나눠 쓰지 않는다.** 「전부 가로로」는 이미 가로인
 * 것을 건드리지 않으므로 같은 묶음 안에서도 사진마다 방향이 갈린다. 하나로
 * 뭉쳐 두면 그 순간 이미 맞는 사진까지 같이 돌아간다.
 */
export type PickedOrientations = Readonly<Record<string, ImageOrientation>>;

/** 아무것도 고르지 않은 상태. 「고르기」를 끌 때 이 값으로 되돌린다. */
export const NO_PICKS: PickedOrientations = {};

/** 그림의 가로·세로(px). 원본 파일을 읽어야 알 수 있는 값이다. */
export type PixelSize = { width: number; height: number };

/** 「전부 ○○로」가 맞추려는 쪽. */
export type OrientationTarget = "landscape" | "portrait";

/** 고른 것인가. `in` 으로 묻는다 — 값이 「그대로인 방향」이라 거짓처럼 보이지 않게. */
export function isPickedId(picked: PickedOrientations, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(picked, id);
}

/** 고른 것이면 그 방향, 아니면 null. */
export function pickedOrientationOf(
  picked: PickedOrientations,
  id: string
): ImageOrientation | null {
  return isPickedId(picked, id) ? picked[id] : null;
}

export function pickedCountOf(picked: PickedOrientations): number {
  return Object.keys(picked).length;
}

/** 썸네일을 눌렀다 — 고른 것이면 빼고, 아니면 **그대로인 방향**으로 넣는다. */
export function togglePicked(
  picked: PickedOrientations,
  id: string,
  orientation: ImageOrientation = IDENTITY_ORIENTATION
): PickedOrientations {
  if (isPickedId(picked, id)) {
    const next = { ...picked };
    delete next[id];
    return next;
  }
  return { ...picked, [id]: orientation };
}

/**
 * 저장에 성공한 것들을 뺀다. 🔴 **남는 것이 곧 「다시 시도할 것」이다** — 일부만
 * 실패했을 때 사람이 다시 고르지 않아도 되게.
 */
export function dropPicked(
  picked: PickedOrientations,
  ids: readonly string[]
): PickedOrientations {
  const next = { ...picked };
  let changed = false;
  for (const id of ids) {
    if (isPickedId(next, id)) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : picked;
}

/** 고른 것 **전부에 같은 값**을 건다 — 회전·뒤집기 단추가 이리로 온다. */
export function mapPicked(
  picked: PickedOrientations,
  change: (orientation: ImageOrientation) => ImageOrientation
): PickedOrientations {
  const next: Record<string, ImageOrientation> = {};
  for (const [id, orientation] of Object.entries(picked)) next[id] = change(orientation);
  return next;
}

/** 고른 것들의 방향을 전부 「그대로」로 되돌린다 — 「원래대로」가 부른다. */
export function resetPicked(picked: PickedOrientations): PickedOrientations {
  return mapPicked(picked, () => IDENTITY_ORIENTATION);
}

/** 고른 것 가운데 돌리거나 뒤집어 둔 것이 있는가. */
export function hasPickedRotation(picked: PickedOrientations): boolean {
  return Object.values(picked).some((orientation) => !isIdentityOrientation(orientation));
}

/**
 * 🔴 **지금 이 사진은 가로인가 세로인가.** 두 가지를 합쳐야 맞다.
 *
 *  1. **원본의 가로세로** — 그림을 읽어야 안다(naturalWidth·naturalHeight).
 *  2. **화면에서 이미 돌려 둔 것** — 원본이 세로라도 90°·270° 로 돌려 놓았으면
 *     **그것은 이미 가로다.**
 *
 * 하나만 보면 이미 맞는 사진을 또 돌린다. 합치는 셈은 이미 있는
 * `orientedPixelSize` 하나가 한다(90°·270° 면 가로·세로를 맞바꾼다) — 저장할 때
 * 캔버스 크기를 정하는 그 함수와 **같은 것**이라 화면과 파일이 갈라지지 않는다.
 *
 * 정사각이거나 크기를 모르면 null 이다. 돌려도 가로가 되지 않으므로 「맞출 수
 * 없다」가 답이고, 그런 사진은 건드리지 않는다.
 */
export function shownOrientationOf(
  size: PixelSize,
  orientation: ImageOrientation
): OrientationTarget | null {
  if (!(size.width > 0) || !(size.height > 0)) return null;
  const shown = orientedPixelSize(size, orientation);
  if (shown.width === shown.height) return null;
  return shown.width > shown.height ? "landscape" : "portrait";
}

/**
 * 「전부 가로로」·「전부 세로로」. 🔴 **방향만 바꾼다 — 파일은 한 글자도 건드리지
 * 않는다.** 저장은 「돌린 대로 저장」이 따로 한다.
 *
 * 🔴 **이미 그쪽인 것은 건드리지 않는다.** 90° 더 돌리면 맞던 사진이 어긋난다.
 * 크기를 모르는 사진(그림을 아직 못 읽었거나 깨진 것)도 그대로 둔다 — 짐작해서
 * 돌리면 되돌릴 수 없는 저장이 그 짐작 위에 얹힌다.
 *
 * 돌리는 쪽은 **오른쪽(시계 방향) 하나로 통일**한다. 왼쪽으로 도는 길을 섞으면
 * 같은 묶음 안에서 사진마다 위아래가 반대로 눕는다. 오른쪽을 고른 까닭은 확인
 * 창이 방향을 「오른쪽으로 90도 회전」으로 읽어 주기 때문이다
 * (describeOrientation) — 글자와 실제로 도는 쪽이 같아야 한다.
 */
export function orientPickedTo(
  picked: PickedOrientations,
  target: OrientationTarget,
  sizeOf: (id: string) => PixelSize | null
): PickedOrientations {
  const next: Record<string, ImageOrientation> = {};
  let changed = false;
  for (const [id, orientation] of Object.entries(picked)) {
    const size = sizeOf(id);
    const shown = size ? shownOrientationOf(size, orientation) : null;
    if (shown === null || shown === target) {
      next[id] = orientation;
      continue;
    }
    next[id] = rotateOrientation(orientation, 1);
    changed = true;
  }
  return changed ? next : picked;
}

/**
 * 실제로 저장할 것들 — 고른 것 가운데 **그대로가 아닌 것**만, **화면에 보이는
 * 차례대로**.
 *
 * 그대로인 것을 보내면 원본을 뜻 없이 다시 인코딩해 화질만 잃고, 서버도
 * NO_CHANGE 로 거절한다(canOfferOrientationSave 의 셋째 조건과 같은 판단).
 * 「전부 가로로」가 손대지 않은 사진이 여기서 빠지는 것도 같은 이유다.
 */
export function pickedSaveTargets<T extends { id: string }>(
  items: readonly T[],
  picked: PickedOrientations
): { item: T; orientation: ImageOrientation }[] {
  const targets: { item: T; orientation: ImageOrientation }[] = [];
  for (const item of items) {
    const orientation = pickedOrientationOf(picked, item.id);
    if (!orientation || isIdentityOrientation(orientation)) continue;
    targets.push({ item, orientation });
  }
  return targets;
}

/**
 * 아래 썸네일을 눌렀을 때 무슨 일이 일어나는가.
 *
 * 🔴 **고르기가 꺼져 있으면 지금까지와 똑같이 「그 사진으로 넘어가기」다.** 이
 * 규칙을 화면 안 삼항식에 흩어 두지 않고 함수 하나로 뽑은 까닭은, 「꺼져 있을
 * 때의 동작이 한 글자도 달라지지 않았다」를 시험이 못박을 수 있게 하려는 것이다.
 *
 * 저장이 도는 동안에는 아무 일도 하지 않는다 — 한 장씩 차례로 덮어쓰는 중에
 * 대상이 바뀌면 무엇이 저장됐는지 알 수 없게 된다.
 */
export function thumbnailPressAction(params: {
  isPicking: boolean;
  isSaving: boolean;
}): "navigate" | "pick" | "ignore" {
  if (params.isSaving) return "ignore";
  return params.isPicking ? "pick" : "navigate";
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

/**
 * 주소에 붙이는 **파일의 지문** — 체크섬 앞 12자. 인자 이름은 `v` 다.
 *
 * 🔴 **응답이 `no-store` 라도 이미 그려 놓은 `<img>` 는 주소가 그대로면 다시
 * 받지 않는다.** 「돌린 대로 저장」은 파일 내용을 바꾸므로 체크섬이 반드시
 * 달라지는데, 주소가 그대로면 브라우저는 옛 그림을 계속 쓴다 — 저장은 됐는데
 * 눈에는 옛 방향이 남고, 사람은 그것을 「저장이 안 됐다」로 읽는다.
 *
 * 🔴 **이 규칙이 한 군데인 것이 요점이다.** 목록의 작은 그림
 * (StoredAttachmentList 의 previewUrlOf)도 이 함수를 쓴다. 두 곳이 저마다
 * 붙이면 한쪽만 고쳐지는 날 목록과 크게 보기가 서로 다른 그림을 보여 준다.
 *
 * 서버는 이 인자를 **보지 않는다** — 무엇을 줄지는 `view` 하나가 정한다.
 */
export const ATTACHMENT_FINGERPRINT_LENGTH = 12;

/**
 * 주소 뒤에 이어 붙일 조각. 지문을 알 수 없으면(체크섬이 빈 값) **빈 문자열**
 * 이라 예전과 한 글자도 같은 주소가 된다 — 지문이 없다고 그림이 안 보이게
 * 되는 쪽이 더 나쁘다.
 */
export function attachmentFingerprintSuffix(checksumSha256: string | null | undefined): string {
  const fingerprint = (checksumSha256 ?? "").slice(0, ATTACHMENT_FINGERPRINT_LENGTH);
  return fingerprint ? `&v=${fingerprint}` : "";
}

/**
 * 주소를 만드는 데 필요한 만큼만. 목록 항목 전체
 * (RepairCaseAttachmentListItem)가 그대로 들어맞는다.
 */
export type ViewerUrlTarget = { id: string; checksumSha256?: string | null };

/** 크게 보는 자리. **원본**이다 — 파일 머리말의 사고가 이 값에 걸려 있다. */
export function viewerFullUrl(item: ViewerUrlTarget): string {
  const fingerprint = attachmentFingerprintSuffix(item.checksumSha256);
  return `/api/attachments/${encodeURIComponent(item.id)}/download?view=full${fingerprint}`;
}

/**
 * 아래쪽 썸네일 줄. 미리보기가 있으면 그것을, 없으면 원본을 준다.
 * 🔴 여기에 `full` 을 쓰면 한 건의 사진 전부가 원본으로 한꺼번에 내려온다.
 */
export function viewerThumbUrl(item: ViewerUrlTarget): string {
  const fingerprint = attachmentFingerprintSuffix(item.checksumSha256);
  return `/api/attachments/${encodeURIComponent(item.id)}/download?view=thumb${fingerprint}`;
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
  /**
   * 🔴 **돌린 대로 원본에 저장한다 — 되돌릴 수 없다.**
   *
   * **넘기지 않으면 단추가 아예 없다.** 그것이 권한을 다루는 방식이다 — 지금 이
   * 첨부를 지울 수 있는 사람에게만 부모가 이 길을 넘긴다(수리 건 상세는
   * repairCases.files WRITE). 화면이 역할을 보고 스스로 판단하지 않는다.
   *
   * 확인 창은 **이 컴포넌트가** 띄운다(돌린 방향을 아는 것이 여기라서다).
   * 부모가 하는 일은 실제로 보내는 것뿐이고, 막히면 사람이 읽을 문장을 돌려준다 —
   * 창은 그동안 닫히지 않고 그 문장을 보여 준다.
   *
   * 🔴 **여러 장을 고르면 이 길을 한 장씩 여러 번 부른다**(2026-09-29). 묶어서
   * 받는 통로를 새로 만들지 않았다 — 한 요청으로 묶으면 하나가 막힐 때 전부
   * 되돌아가지만, 한 장씩이면 앞서 저장된 것은 살아남는다(confirmSaveOrientation).
   */
  onSaveOrientation?: (
    item: RepairCaseAttachmentListItem,
    orientation: ImageOrientation
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
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
  onSaveOrientation,
}: AttachmentViewerProps) {
  const [state, setState] = useState<ViewerState>({
    index: initialIndex,
    transform: IDENTITY_TRANSFORM,
  });
  const { index, transform } = state;

  /** 「돌린 대로 저장」 확인 창이 떠 있는가. */
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  /** 저장이 도는 중 — 그동안 단추가 잠긴다. */
  const [isSaving, setIsSaving] = useState(false);
  /** 막혔을 때 서버가 준 문장. 창을 닫지 않고 그 안에 보여 준다. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 여러 장을 저장하는 중 어디까지 갔는지. 한 장짜리에서는 쓰지 않는다. */
  const [saveProgress, setSaveProgress] = useState<{ current: number; total: number } | null>(null);
  /**
   * 🔴 **일부만 실패했을 때의 결과.** 「5장 중 3장 저장, 2장 실패」를 어느 사진이
   * 왜 막혔는지와 함께 보여 준다 — 되돌릴 수 없는 일을 반만 해 놓고 조용히
   * 넘어가지 않는다.
   */
  const [saveOutcome, setSaveOutcome] = useState<SaveRotationOutcome | null>(null);

  /**
   * 🔴 **「고르기」가 켜져 있는가** — 켜면 아래 썸네일을 누르는 것이 **선택**이
   * 된다(사용자 결정 2026-09-29: 단추로 켜고 끈다).
   *
   * 꺼져 있을 때의 동작은 지금까지와 한 글자도 다르지 않다 — 썸네일을 누르면
   * 그 사진으로 넘어간다(thumbnailPressAction).
   */
  const [isPicking, setIsPicking] = useState(false);
  /** 고른 사진들과 각자의 방향. 열쇠가 있다는 것이 곧 「골랐다」다. */
  const [picked, setPicked] = useState<PickedOrientations>(NO_PICKS);

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
  /**
   * 썸네일이 실려 온 뒤 알게 된 **그림의 가로·세로**. 「전부 가로로」가 이것을 읽는다.
   *
   * 🔴 **크기를 알자고 사진을 한 번 더 받아 오지 않는다.** 아래 썸네일 줄의
   * `<img>` 가 실리는 그 자리에서 적는다. `?view=thumb` 은 줄인 그림이지만
   * **가로세로 비율이 원본과 같아서** 가로냐 세로냐를 가리는 데는 모자람이 없다.
   * 고르려면 그 썸네일을 눌러야 하고, 누를 수 있다는 것은 화면에 들어와 이미
   * 실렸다는 뜻이다(loading="lazy"). 그래도 모르는 것은 **건드리지 않는다**
   * (orientPickedTo).
   *
   * 그리는 데 쓰이지 않으므로 상태가 아니라 ref 다.
   */
  const naturalSizesRef = useRef<Map<string, PixelSize>>(new Map());

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
  //
  // 🔴 **확인 창이 떠 있는 동안에는 아무것도 하지 않는다.** 그 창은 맨 위 층에
  //    떠 있지만 이 listener 는 window 에 달려 있어 그대로 듣는다 — Escape 로
  //    크게 보기가 통째로 닫히거나, 방향키로 사진이 넘어가(방향이 초기화되어)
  //    확인 창이 "이제 없는 방향"을 저장하려는 상태가 된다.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isSaveOpen) return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSaveOpen, onClose, step]);

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

  /**
   * 화면에 실제로 걸 변환. 🔴 **고른 사진은 그 묶음에 걸어 둔 방향이 이긴다** —
   * 여러 장을 한꺼번에 돌렸을 때 그 결과가 눈에 보여야 무엇을 저장하려는 것인지
   * 알 수 있다. 배율·이동은 언제나 지금 보고 있는 사람의 것이라 그대로 둔다.
   */
  const currentPickedOrientation = isPicking ? pickedOrientationOf(picked, current.id) : null;
  const shownTransform = currentPickedOrientation
    ? { ...transform, orientation: currentPickedOrientation }
    : transform;

  /**
   * 🔴 **「고르기」 단추 자체를 그리는가.** 둘이 모두 참일 때만이다.
   *
   *  1. **저장할 길이 있는가**(권한). 없으면 골라 봐야 저장할 수가 없으므로
   *     「고르기」도 「전부 가로로」도 **처음부터 없다** — 「돌린 대로 저장」과
   *     같은 규칙이다.
   *  2. **사진이 여러 장인가.** 한 장뿐이면 아래 썸네일 줄 자체를 안 그리므로
   *     고를 자리가 없고, 「고르기」는 뜻이 없다.
   */
  const canPickMany = Boolean(onSaveOrientation) && count > 1;
  const pickedTotal = pickedCountOf(picked);
  /** 고른 것 가운데 실제로 저장할 것들 — 그대로인 것은 빠진다. */
  const pickedTargets = isPicking ? pickedSaveTargets(items, picked) : [];

  /**
   * 「돌린 대로 저장」 단추를 그리는가. 판정은 위의 순수 함수 하나가 한다 —
   * 길이 없거나(권한), 사진이 아니거나, 돌린 것이 없으면 단추 자체가 없다.
   * 고른 것이 있으면 그쪽이 앞선다(pickedCount 주석).
   */
  const canSaveOrientation = canOfferOrientationSave({
    hasHandler: Boolean(onSaveOrientation),
    mimeType: current.mimeType,
    orientation: transform.orientation,
    pickedCount: pickedTargets.length,
  });

  /**
   * 확인 창과 저장이 실제로 다루는 것들. **고른 것이 있으면 그것들, 없으면 지금
   * 보는 한 장** — 고르기를 꺼 두면 언제나 뒤쪽이라 지금까지와 같다.
   */
  const saveTargets: { item: RepairCaseAttachmentListItem; orientation: ImageOrientation }[] =
    pickedTargets.length > 0
      ? pickedTargets
      : [{ item: current, orientation: transform.orientation }];
  const dialogTargets: SaveRotationTarget[] = saveTargets.map(({ item, orientation }) => ({
    id: item.id,
    displayName: item.originalFileName,
    orientation,
  }));

  /**
   * 🔴 **한 장씩 차례로 저장한다.**
   *
   * ── 왜 한 요청으로 묶지 않는가 ────────────────────────────────────────
   * 이미 있는 통로(PUT …/rotation)를 **여러 번 부른다.** 새 통로를 만들지
   * 않았다. 한 요청으로 묶으면 하나가 막힐 때 **전부 되돌아간다** — 열 장 가운데
   * 아홉 장이 멀쩡히 돌아갔는데 마지막 한 장 때문에 처음부터 다시 하게 된다.
   * 한 장씩이면 앞서 저장된 것은 살아남고, 실패한 것만 다시 시도하면 된다.
   *
   * ── 🔴 일부만 실패한 것을 숨기지 않는다 ───────────────────────────────
   * 「5장 중 3장 저장, 2장 실패」를 어느 사진이 왜 막혔는지와 함께 창 안에
   * 보여 준다. 저장된 것은 고른 것에서 빼고 **실패한 것은 고른 채로 남겨** 그대로
   * 다시 누를 수 있게 한다.
   *
   * 한 장짜리(고르기를 안 쓴 지금까지의 길)는 예전 그대로다 — 서버가 준 문장을
   * 창 안에 보여 주고, 성공하면 크게 보기를 닫는다.
   */
  async function confirmSaveOrientation() {
    if (!onSaveOrientation) return;
    const targets = saveTargets;
    if (targets.length === 0) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveOutcome(null);
    const savedIds: string[] = [];
    const failures: { name: string; message: string }[] = [];
    try {
      for (const [position, target] of targets.entries()) {
        setSaveProgress({ current: position + 1, total: targets.length });
        try {
          const result = await onSaveOrientation(target.item, target.orientation);
          if (result.ok) savedIds.push(target.item.id);
          else failures.push({ name: target.item.originalFileName, message: result.message });
        } catch (error) {
          // 한 장이 던져도 나머지는 그대로 이어 간다 — 여기서 멈추면 뒤엣것이
          // 시도조차 되지 않은 채 「실패」로 뭉뚱그려진다.
          failures.push({
            name: target.item.originalFileName,
            message: error instanceof Error ? error.message : "저장하지 못했습니다.",
          });
        }
      }
    } finally {
      setIsSaving(false);
      setSaveProgress(null);
    }

    // 저장된 것은 고른 것에서 뺀다 — 다시 누르면 **실패한 것만** 다시 시도한다.
    if (savedIds.length > 0) setPicked((previous) => dropPicked(previous, savedIds));

    if (failures.length === 0) {
      // 🔴 성공하면 **크게 보기를 닫는다**(사용자 결정 2026-09-29 — 이 동작은
      //    그대로 둔다). 파일 자체가 이제 그 방향이므로 화면의 CSS 회전을 그대로
      //    두면 한 번 더 돌아간 것처럼 보이기 때문이다.
      //
      //    옛 그림이 남는 문제는 이제 없다 — 주소에 지문이 붙어 있어 저장 뒤
      //    목록이 새로 그려지면(부모의 router.refresh) 체크섬이 달라진 주소로
      //    바뀌고 브라우저가 새 그림을 받아 온다. 일부만 실패해 창이 열린 채로
      //    남는 아래 길이 그것에 기대고 있다.
      setIsSaveOpen(false);
      onClose();
      return;
    }
    if (targets.length === 1) {
      // 한 장짜리는 지금까지와 한 글자도 다르지 않다.
      setSaveError(failures[0].message);
      return;
    }
    setSaveOutcome({ total: targets.length, saved: savedIds.length, failures });
  }

  /**
   * 「고르기」를 켜고 끈다.
   *
   * 🔴 **끄면 고른 것을 비운다.** 켜 둔 채 잊고 다른 사진을 보다 「돌린 대로
   * 저장」을 누르면, 눈에 보이지도 않는 사진 여러 장의 원본이 덮어써진다.
   * 고른 표시도 걸어 둔 방향도 **고르기가 켜져 있을 때만 화면에 나타나므로**,
   * 꺼진 뒤에도 살아 있는 선택은 사람이 확인할 방법이 없는 되돌릴 수 없는
   * 폭탄이 된다. 비우는 대가는 다시 고르는 수고뿐이다.
   *
   * 켤 때, 지금 보는 사진을 이미 돌려 놓았다면 **그 사진부터 고른 것으로
   * 옮긴다.** 그러지 않으면 화면에는 돌아간 사진이 보이는데 저장 대상은 고른
   * 것들뿐이라, 눈앞의 그 사진만 조용히 빠진다. 옮긴 뒤 화면 쪽 방향을 지우는
   * 것은 같은 방향이 두 군데 남지 않게 하려는 것이다(보이는 모습은 그대로다).
   */
  function togglePicking() {
    if (isPicking) {
      setIsPicking(false);
      setPicked(NO_PICKS);
      return;
    }
    setIsPicking(true);
    if (!isIdentityOrientation(transform.orientation)) {
      setPicked({ [current.id]: transform.orientation });
      applyTransform((t) => ({ ...t, orientation: IDENTITY_ORIENTATION }));
    }
  }

  /** 아래 썸네일을 눌렀다. 무슨 일이 일어나는지는 순수 함수가 정한다. */
  function pressThumbnail(item: RepairCaseAttachmentListItem, itemIndex: number) {
    const action = thumbnailPressAction({ isPicking, isSaving });
    if (action === "ignore") return;
    if (action === "navigate") {
      go(itemIndex);
      return;
    }
    setPicked((previous) => togglePicked(previous, item.id));
  }

  /**
   * 회전·뒤집기를 **어디에** 거는가 — 고른 것이 있으면 그 **전부에** 같은 값을,
   * 없으면 지금 보는 한 장에. 뒤쪽이 지금까지의 동작 그대로다.
   */
  function applyOrientation(change: (orientation: ImageOrientation) => ImageOrientation) {
    if (isPicking && pickedTotal > 0) {
      setPicked((previous) => mapPicked(previous, change));
      return;
    }
    applyTransform((t) => {
      const orientation = change(t.orientation);
      return orientation === t.orientation ? t : { ...t, orientation };
    });
  }

  /** 「전부 가로로」·「전부 세로로」. 🔴 방향만 바꾼다 — 저장은 하지 않는다. */
  function orientPicked(target: OrientationTarget) {
    setPicked((previous) =>
      orientPickedTo(previous, target, (id) => naturalSizesRef.current.get(id) ?? null)
    );
  }

  /** 「원래대로」. 고른 것이 있으면 그것들의 방향까지 함께 푼다. */
  function resetEverything() {
    applyTransform(resetViewerTransform);
    if (isPicking && pickedTotal > 0) setPicked((previous) => resetPicked(previous));
  }

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
  /** 고르기 줄의 글자 단추 — 위 줄보다 한 칸 작게 두어 「보는 단추」와 갈린다. */
  const pickToolClass =
    "flex h-9 items-center justify-center rounded-full bg-white/15 px-3 text-xs font-medium text-white disabled:opacity-40";

  /** 몇 장을 덮어쓰려는 것인지 단추에서부터 말한다 — 확인 창이 한 번 더 말한다. */
  const saveButtonLabel =
    saveTargets.length > 1 ? `${saveTargets.length}장 돌린 대로 저장` : "돌린 대로 저장";
  /** 여러 장이라 시간이 걸린다 — 어디까지 갔는지 단추에도 보인다. */
  const saveButtonBusyLabel =
    saveProgress && saveProgress.total > 1
      ? `저장 중… ${saveProgress.current}/${saveProgress.total}`
      : "저장 중...";

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
          // 🔴 주소에 **파일의 지문**이 붙는다(attachmentFingerprintSuffix).
          // 돌려 저장하면 체크섬이 달라져 주소가 바뀌고, 그래야 브라우저가 이미
          // 그려 둔 옛 그림을 버리고 새 방향을 받아 온다.
          src={viewerFullUrl(current)}
          alt={current.originalFileName}
          // 끌기는 우리가 계산한다. 브라우저의 그림 끌어놓기가 먼저 잡으면
          // 손가락·커서를 따라가다 말고 "파일을 옮기는 중" 모양이 된다.
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
          style={{
            // 고른 사진이면 그 묶음의 방향으로 그린다(shownTransform 주석).
            transform: viewerTransformCss(shownTransform),
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
          {/*
            🔴 이 넷은 **고른 것이 있으면 고른 것 전부에** 같은 값을 건다
            (applyOrientation). 고르기가 꺼져 있으면 지금까지처럼 보고 있는
            한 장에만 걸린다.
          */}
          <button
            type="button"
            onClick={() => applyOrientation((o) => rotateOrientation(o, -1))}
            aria-label="왼쪽으로 90도 회전"
            disabled={isSaving}
            className={toolButtonClass}
          >
            ↺
          </button>
          <button
            type="button"
            onClick={() => applyOrientation((o) => rotateOrientation(o, 1))}
            aria-label="오른쪽으로 90도 회전"
            disabled={isSaving}
            className={toolButtonClass}
          >
            ↻
          </button>
          <button
            type="button"
            onClick={() => applyOrientation(flipOrientationAcrossScreenX)}
            aria-label="좌우 뒤집기"
            disabled={isSaving}
            className={toolButtonClass}
          >
            ⇄
          </button>
          <button
            type="button"
            onClick={() => applyOrientation(flipOrientationAcrossScreenY)}
            aria-label="상하 뒤집기"
            disabled={isSaving}
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
            onClick={resetEverything}
            aria-label="원래대로"
            disabled={isSaving || (isViewerTransformIdentity(transform) && !hasPickedRotation(picked))}
            className="flex h-10 items-center justify-center rounded-full bg-white/15 px-3 text-xs font-medium text-white disabled:opacity-40"
          >
            원래대로
          </button>
          {/*
            🔴 **되돌릴 수 없는 단추다 — 그래서 있을 때와 없을 때가 분명하다.**
            길이 없으면(권한) · 사진이 아니면 · 돌린 것이 없으면 그리지 않는다
            (canOfferOrientationSave). 눌러 놓고 거절당하는 자리가 아니다.

            색을 다르게 두는 것도 그 때문이다 — 옆의 보기 단추들과 같은 회색이면
            「보기만 바꾸는 것」으로 읽힌다. 실제로 누르는 순간 벌어지는 일은
            확인 창이 한 번 더 말한다.
          */}
          {canSaveOrientation && (
            <button
              type="button"
              onClick={() => {
                setSaveError(null);
                setSaveOutcome(null);
                setIsSaveOpen(true);
              }}
              disabled={isSaving}
              aria-label="돌린 대로 저장"
              className="flex h-10 items-center justify-center rounded-full bg-red-600 px-3 text-xs font-medium text-white disabled:opacity-40"
            >
              {isSaving ? saveButtonBusyLabel : saveButtonLabel}
            </button>
          )}
        </div>

        {/*
          🔴 **여러 장을 골라 한꺼번에 돌리는 자리**(사용자 결정 2026-09-29).

          저장할 길이 없거나(권한) 사진이 한 장뿐이면 이 줄 자체가 없다
          (canPickMany) — 골라 봐야 저장할 수 없고, 한 장이면 아래 썸네일 줄이
          아예 안 그려져 고를 자리도 없다.
        */}
        {canPickMany && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 px-4">
            <button
              type="button"
              onClick={togglePicking}
              aria-pressed={isPicking}
              disabled={isSaving}
              className={`flex h-9 items-center justify-center rounded-full px-3 text-xs font-medium disabled:opacity-40 ${
                // 켜져 있는 동안은 색을 뒤집는다 — 썸네일을 누르는 뜻이 「보기」에서
                // 「고르기」로 바뀌어 있다는 것이 한눈에 보여야 한다.
                isPicking ? "bg-white text-zinc-900" : "bg-white/15 text-white"
              }`}
            >
              고르기
            </button>
            {isPicking && (
              <>
                <span className="text-xs text-white/80 tabular-nums">{pickedTotal}장 선택</span>
                {/*
                  🔴 **방향만 바꾼다 — 누른다고 파일이 바뀌지 않는다.** 저장은
                  옆의 「돌린 대로 저장」이 한다. 이미 그쪽인 사진은 건드리지
                  않는다(orientPickedTo).
                */}
                <button
                  type="button"
                  onClick={() => orientPicked("landscape")}
                  disabled={isSaving || pickedTotal === 0}
                  className={pickToolClass}
                >
                  전부 가로로
                </button>
                <button
                  type="button"
                  onClick={() => orientPicked("portrait")}
                  disabled={isSaving || pickedTotal === 0}
                  className={pickToolClass}
                >
                  전부 세로로
                </button>
              </>
            )}
          </div>
        )}

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
              const isChosen = isPicking && isPickedId(picked, item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  ref={isCurrent ? currentThumbRef : null}
                  // 🔴 고르기가 꺼져 있으면 지금까지와 똑같이 그 사진으로 넘어간다.
                  onClick={() => pressThumbnail(item, itemIndex)}
                  aria-label={
                    isPicking ? `${item.originalFileName} 고르기` : `${item.originalFileName} 보기`
                  }
                  aria-current={isCurrent ? "true" : undefined}
                  aria-pressed={isPicking ? isChosen : undefined}
                  className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 ${
                    // 고른 것은 테두리 색과 밝기로 눈에 띈다. 고르지 않았어도 지금
                    // 보고 있는 것은 흰 테두리 그대로다 — 둘이 겹치면 고른 쪽이 이긴다.
                    isChosen
                      ? "border-sky-400"
                      : isCurrent
                        ? "border-white"
                        : "border-transparent opacity-50"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    // 🔴 여기도 **지문이 붙는다** — 돌려 저장한 사진이 이 줄에
                    // 옛 방향으로 남아 있던 것이 바로 그것이 없어서였다.
                    src={viewerThumbUrl(item)}
                    // 단추에 이름표가 붙어 있다. 여기에 또 적으면 읽어 주는
                    // 장치가 같은 파일명을 두 번 말한다.
                    alt=""
                    loading="lazy"
                    // 🔴 실려 온 김에 **그림의 가로·세로**를 적어 둔다 — 「전부
                    // 가로로」가 읽는 값이고, 이 한 줄이 있어 크기를 알자고 사진을
                    // 다시 받아 오지 않는다(naturalSizesRef 주석).
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                        naturalSizesRef.current.set(item.id, {
                          width: image.naturalWidth,
                          height: image.naturalHeight,
                        });
                      }
                    }}
                    // object-contain이다 — 잘라 채우면 파형 눈금과 외관 흠집이
                    // 양 끝에서 사라져, 어느 사진을 고르는 것인지 썸네일만 보고
                    // 가릴 수 없다. 여기는 고르는 자리라 전체 모습이 보여야 한다.
                    // 맞춰 넣으면 정사각 칸에 남는 자리가 생기므로 바탕을 깐다.
                    // 🔴 zinc-100(거의 흰색)이 아니라 bg-white/15 다 — 이 뷰어는
                    // 검은 바탕(769행 bg-black) 위라 밝은 회색은 튄다. white/15 는
                    // 이 화면의 단추들이 이미 쓰는 색(762·784·918·1000행)이라
                    // 남는 자리가 「덜 그려진 곳」이 아니라 단추 제 바닥으로 읽힌다.
                    className="h-full w-full bg-white/15 object-contain"
                  />
                  {isChosen && (
                    <span
                      // 테두리 색만으로는 색을 가리기 어려운 사람이 고른 것을
                      // 구별할 수 없다. 읽어 주는 장치에는 aria-pressed 가 이미
                      // 말하고 있으므로 이 표는 눈에만 보이면 된다.
                      aria-hidden="true"
                      className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-md bg-sky-400 text-[10px] font-bold text-zinc-900"
                    >
                      ✓
                    </span>
                  )}
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
          {isPicking
            ? "고르기가 켜져 있습니다 — 아래 썸네일을 누르면 골라집니다 · 고르기를 끄면 고른 것이 비워집니다"
            : count > 1
              ? "좌우로 밀거나 방향키로 넘길 수 있습니다 · 휠·손가락 두 개로 확대, 두 번 누르면 원래대로"
              : "휠·손가락 두 개로 확대, 두 번 누르면 원래대로"}
        </p>
      </div>

      {/*
        확인 창은 저장할 길이 있을 때만 붙인다 — 권한이 없는 사람의 화면에는
        열릴 수 없는 창이 DOM 에 남아 있지도 않다.
      */}
      {onSaveOrientation && (
        <SaveRotationDialog
          isOpen={isSaveOpen}
          targets={dialogTargets}
          isSubmitting={isSaving}
          progress={saveProgress}
          errorMessage={saveError}
          outcome={saveOutcome}
          onConfirm={() => void confirmSaveOrientation()}
          onCancel={() => {
            setIsSaveOpen(false);
            setSaveError(null);
            setSaveOutcome(null);
          }}
        />
      )}
    </div>
  );
}
