/**
 * ============================================================================
 * 첨부 미리보기 격자의 타일 크기 — 사람이 정한다
 * ============================================================================
 * A/S 상세 `파일 관리` 의 `미리보기` 는 칸 수가 **화면 너비로만** 정해져 있었다
 * (작은 화면 2칸, sm 3칸, lg 4칸). 사람이 정할 여지가 없어서, 사진이 한 장인
 * 접수 건을 열면 화면 1/4 짜리 타일 하나가 덩그러니 떴다 — "지금은 그냥 이렇게
 * 크게만 나오고 있어"가 그 화면이다.
 *
 * 그래서 **타일 너비를 사람이 고르고**, 칸 수는 그 너비에서 저절로 나오게 한다
 * (CSS `repeat(auto-fill, minmax(...))`). 이 파일은 그 계산만 한다 — 격자를
 * 그리는 일도, `localStorage` 를 두드리는 일도 여기 들어오지 않는다. 브라우저를
 * 부르는 자리는 components/repair-cases/files/StoredAttachmentList.tsx 하나뿐이고,
 * 그래서 아래 규칙들이 Node 단위 테스트로 그대로 돌아간다.
 *
 * ⚠️ **camera-zoom.ts 와 남남이다.** 그쪽은 카메라로 당겨 찍는 배율(찍힌 사진의
 *    화각이 달라진다)이고 이쪽은 이미 찍힌 것을 목록에서 얼마나 크게 그리느냐다.
 *    이름이 둘 다 "줌"이라 합치고 싶어지지만, 합치면 한쪽 범위를 손볼 때 다른
 *    쪽이 조용히 따라 바뀐다. 값도 뜻도 겹치는 것이 없다.
 *
 * ── 배율은 퍼센트 정수다 ────────────────────────────────────────────────
 * 화면에 `140%` 라고 적히는 그 숫자를 그대로 들고 다닌다. 1.4 같은 소수로 두면
 * 저장했다 읽는 사이에 0.1 + 0.2 류의 오차가 끼어들어 단계 격자에서 미끄러지고,
 * 그러면 `−`/`+` 를 눌러도 한 단계가 온전히 움직이지 않는다.
 * ============================================================================
 */

/**
 * 배율이 움직이는 구간 — **50% ~ 200%** 다.
 *
 * 아래(50%, 타일 110px):
 *   사용자의 불만이 "크게만 나온다"이므로 **지금보다 훨씬 작게** 갈 수 있어야
 *   한다. 1000px 남짓한 목록 자리에서 한 줄에 8장쯤 들어온다(오늘은 4장). 그
 *   아래로 더 내리지 않는 이유는 타일에 사진만 있는 것이 아니기 때문이다 —
 *   파일명·분류·`내려받기`·`지우기` 가 사진 밑에 붙어 있어서, 100px 아래로
 *   가면 사진이 작아지는 것이 아니라 **글자 줄이 먼저 무너진다.**
 *
 * 위(200%, 타일 440px):
 *   오늘보다 조금 더 커질 수 있게 열어 둔다. 라벨의 각인처럼 뷰어를 따로 열지
 *   않고 확인하고 싶은 것이 있다. 그 위는 열지 않는다 — 한 장을 크게 보는 일은
 *   AttachmentViewer(눌러서 크게 보기)가 할 일이고, 목록을 그 용도로 늘리면
 *   목록이기를 그만둔다.
 */
export const GALLERY_ZOOM_PERCENT_RANGE: { min: number; max: number } = { min: 50, max: 200 };

/**
 * `−`/`+` 한 번에 움직이는 폭. 10%(타일 22px)다.
 *
 * 한 번 눌러 달라진 것이 눈에 보일 만큼은 되고, 끝에서 끝까지는 15번이라 큰
 * 이동은 슬라이더가, 미세 조정은 단추가 맡는 모양이 된다. 윈도우 사진 앱의
 * 확대 바가 그렇게 갈라져 있고, 사용자가 보여 준 그림도 그 모양이다.
 */
export const GALLERY_ZOOM_STEP_PERCENT = 10;

/**
 * 아무것도 안 고른 사람이 보는 배율.
 *
 * 100% 의 타일 너비(220px)는 **오늘 lg 에서 4칸으로 나오던 크기와 거의 같다.**
 * 조절 기능이 생겼다고 남의 화면이 저절로 바뀌지는 않게 하려는 것이다 — 크기가
 * 불만이었던 사람만 움직이면 된다.
 */
export const DEFAULT_GALLERY_ZOOM_PERCENT = 100;

/** 100% 일 때의 타일 너비(px). 위 기본값 주석에 그 값을 고른 까닭이 있다. */
export const GALLERY_TILE_BASE_WIDTH_PX = 220;

/**
 * 이 브라우저에 배율을 적어 둘 이름.
 *
 * `무엇:어디` 꼴은 목록 보기 방식(`list-view-mode:<목록 이름>`)이 쓰는 그
 * 규칙이다 — 화면마다 따로 기억하되, 무엇을 기억한 값인지 키만 보고 안다.
 */
export const ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY =
  "attachment-gallery-zoom:repair-case-stored-attachments";

/**
 * 범위 안으로 접고, **단계 격자에 붙인다.**
 *
 * 격자에 붙이는 것이 핵심이다. 어디선가 137 같은 값이 들어오면(저장소에 남은
 * 옛 값, 손으로 고친 값) 그 뒤로 `−`/`+` 가 137→147→157 로 흐르고, 한계인
 * 200 에는 영영 정확히 닿지 못한다. 들어오는 자리에서 한 번 붙여 두면 그 뒤의
 * 모든 계산이 격자 위에서만 논다.
 *
 * NaN·Infinity 는 기본값으로 되돌린다. 최소값이 아니라 기본값인 이유는, 이
 * 배율에는 카메라의 1배 같은 "원래대로"가 따로 없어서 값이 성립하지 않을 때
 * 돌아갈 곳이 기본값뿐이기 때문이다.
 */
export function clampGalleryZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GALLERY_ZOOM_PERCENT;

  const { min, max } = GALLERY_ZOOM_PERCENT_RANGE;
  if (value <= min) return min;
  if (value >= max) return max;

  const steps = Math.round((value - min) / GALLERY_ZOOM_STEP_PERCENT);
  const snapped = min + steps * GALLERY_ZOOM_STEP_PERCENT;
  return snapped > max ? max : snapped;
}

/**
 * 한 단계 옮긴다. `+` 는 1, `−` 는 -1 이다.
 *
 * 한계 밖으로는 나가지 않는다(clamp 가 막는다) — 화면에서는 그때 단추가 눌리지
 * 않게 되지만, 키보드나 다른 길로 한 번 더 들어와도 값이 새지 않아야 한다.
 */
export function stepGalleryZoom(percent: number, steps: number): number {
  const current = clampGalleryZoom(percent);
  if (!Number.isFinite(steps)) return current;
  return clampGalleryZoom(current + Math.round(steps) * GALLERY_ZOOM_STEP_PERCENT);
}

/** `+` 를 누를 수 있는가. 못 누를 때 단추를 죽여 두는 데 쓴다. */
export function canZoomInGallery(percent: number): boolean {
  return clampGalleryZoom(percent) < GALLERY_ZOOM_PERCENT_RANGE.max;
}

/** `−` 를 누를 수 있는가. */
export function canZoomOutGallery(percent: number): boolean {
  return clampGalleryZoom(percent) > GALLERY_ZOOM_PERCENT_RANGE.min;
}

/**
 * 이 배율에서 타일 한 칸의 너비(px).
 *
 * 배율에 정비례한다 — 올렸는데 작아지는 일이 없어야 한다는 것이 이 함수에
 * 걸린 유일한 계약이고, 테스트가 전 구간을 훑어 그것을 못박는다.
 */
export function galleryTileWidth(percent: number): number {
  return Math.round((GALLERY_TILE_BASE_WIDTH_PX * clampGalleryZoom(percent)) / 100);
}

/**
 * 격자의 `grid-template-columns` 값. **칸 수는 여기서 정하지 않는다** — 브라우저가
 * 자리에 들어가는 만큼 채운다(auto-fill).
 *
 * 🔴 `min(…px, 100%)` 의 `100%` 가 **폰에서 화면이 깨지지 않게 하는 자물쇠**다.
 * 그냥 `minmax(440px, 1fr)` 로 두면 440px 가 칸의 최소 너비라 320px 짜리 화면에서
 * 칸 하나가 화면보다 넓어지고, 목록 전체가 가로로 넘친다 — 크게 키워 둔 채로
 * 폰을 열면 그렇게 된다. `min()` 을 씌우면 최소 너비가 자리 너비를 넘지 못해
 * **어떤 배율에서도 한 칸은 반드시 들어간다.**
 */
export function galleryGridTemplate(percent: number): string {
  return `repeat(auto-fill, minmax(min(${galleryTileWidth(percent)}px, 100%), 1fr))`;
}

/** 조절 바 오른쪽에 적는 글자. 사용자가 보여 준 그림 그대로 `140%` 꼴이다. */
export function formatGalleryZoom(percent: number): string {
  return `${clampGalleryZoom(percent)}%`;
}

// ────────────────────────────────────────────────── 그 브라우저에 적어 두기

/**
 * `localStorage` 처럼 생긴 것. 실물을 직접 부르지 않고 이 모양으로 받는 이유는
 * 두 가지다 — 시험에서 **던지는 저장소**를 그대로 흉내 낼 수 있고, 이 파일이
 * 브라우저 전역에 손대지 않아 Node 에서 그대로 돈다.
 * (notification-toast.ts 의 SeenKeyStore 와 같은 장치다.)
 */
export type GalleryZoomStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * 적혀 있던 글자를 배율로 읽는다. **무엇이 적혀 있어도 쓸 수 있는 값이 나온다.**
 *
 * 없음·빈 글자·숫자가 아닌 글자·`NaN`·`Infinity` 는 전부 기본값이고, 범위 밖
 * 숫자는 한계로 접힌다. 남이 넣어 둔 엉뚱한 글자가 곧바로 화면의 상태가 되어서는
 * 안 된다는 규칙(responsive-list 의 useStoredChoice 주석)을 여기서 지킨다.
 */
export function parseGalleryZoom(raw: string | null): number {
  if (raw === null) return DEFAULT_GALLERY_ZOOM_PERCENT;
  const text = raw.trim();
  if (text === "") return DEFAULT_GALLERY_ZOOM_PERCENT;

  const value = Number(text);
  if (!Number.isFinite(value)) return DEFAULT_GALLERY_ZOOM_PERCENT;
  return clampGalleryZoom(value);
}

/**
 * 적어 둔 배율을 읽는다. **어떤 경우에도 던지지 않는다.**
 *
 * 사생활 보호 창이나 저장을 막아 둔 브라우저에서는 저장소에 손대는 것 자체가
 * 터진다. 그때 여기서 던지면 첨부 목록 전체가 죽는다 — 미리보기 크기 하나 때문에
 * 파일을 못 받게 되는 것이다. 못 읽으면 기본값으로 그린다.
 */
export function readGalleryZoom(store: GalleryZoomStore | null, storageKey: string): number {
  if (!store) return DEFAULT_GALLERY_ZOOM_PERCENT;
  try {
    return parseGalleryZoom(store.getItem(storageKey));
  } catch {
    return DEFAULT_GALLERY_ZOOM_PERCENT;
  }
}

/**
 * 적어 둔다. 읽기와 같은 이유로 **어떤 경우에도 던지지 않는다**(저장 공간이 꽉 찬
 * 경우 포함). 적어 두지 못하면 다음에 열었을 때 기본값으로 돌아갈 뿐이다.
 */
export function writeGalleryZoom(
  store: GalleryZoomStore | null,
  storageKey: string,
  percent: number
): void {
  if (!store) return;
  try {
    store.setItem(storageKey, String(clampGalleryZoom(percent)));
  } catch {
    // 이번 방문 동안은 화면이 그대로 따라온다(부르는 쪽이 값을 들고 있다).
  }
}
