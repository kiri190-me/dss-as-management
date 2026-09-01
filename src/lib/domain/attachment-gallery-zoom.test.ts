import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY,
  DEFAULT_GALLERY_ZOOM_PERCENT,
  GALLERY_TILE_BASE_WIDTH_PX,
  GALLERY_ZOOM_PERCENT_RANGE,
  GALLERY_ZOOM_STEP_PERCENT,
  canZoomInGallery,
  canZoomOutGallery,
  clampGalleryZoom,
  formatGalleryZoom,
  galleryGridTemplate,
  galleryTileWidth,
  parseGalleryZoom,
  readGalleryZoom,
  stepGalleryZoom,
  writeGalleryZoom,
  type GalleryZoomStore,
} from "./attachment-gallery-zoom";

/**
 * ============================================================================
 * 이 파일이 지키려는 것
 * ============================================================================
 * 1. **배율을 올렸는데 타일이 작아지는 일이 없다.** 화면에서는 한 번에 한 단계씩만
 *    움직여 보므로 뒤집힘이 있어도 눈에 잘 안 띈다 — 전 구간을 훑어 못박는다.
 * 2. **저장소에서 읽은 값이 무엇이든 화면이 살아 있다.** 사생활 보호 창에서는
 *    localStorage 를 읽는 것만으로 던지고, 그때 여기서 던지면 미리보기 크기 하나
 *    때문에 첨부 목록 전체를 못 쓰게 된다.
 * 3. **아주 크게 키운 채로 폰을 열어도 격자가 안 깨진다** — grid 최소 너비에
 *    씌운 `min(…, 100%)` 이 그 자물쇠다.
 * ============================================================================
 */

const { min, max } = GALLERY_ZOOM_PERCENT_RANGE;

/** 저장소 흉내. 시험이 넣어 둔 글자를 그대로 돌려준다. */
function fakeStore(initial: string | null): GalleryZoomStore & { saved: string | null } {
  return {
    saved: initial,
    getItem() {
      return this.saved;
    },
    setItem(_key: string, value: string) {
      this.saved = value;
    },
  };
}

/** 손대는 것만으로 던지는 저장소(사생활 보호 창). */
const throwingStore: GalleryZoomStore = {
  getItem() {
    throw new Error("SecurityError: 저장소에 접근할 수 없습니다");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

// ─────────────────────────────────────────────── 범위·단계·기본값

test("기본값은 범위 안이고 단계 격자 위에 있다", () => {
  assert.ok(DEFAULT_GALLERY_ZOOM_PERCENT >= min && DEFAULT_GALLERY_ZOOM_PERCENT <= max);
  assert.equal((DEFAULT_GALLERY_ZOOM_PERCENT - min) % GALLERY_ZOOM_STEP_PERCENT, 0);
  // 한계도 격자 위에 있어야 `+`를 계속 눌러 최대에 정확히 닿는다.
  assert.equal((max - min) % GALLERY_ZOOM_STEP_PERCENT, 0);
});

test("범위 밖 값은 한계 안으로 접힌다 — 아래로도 위로도", () => {
  assert.equal(clampGalleryZoom(0), min);
  assert.equal(clampGalleryZoom(-500), min);
  assert.equal(clampGalleryZoom(max + 1), max);
  assert.equal(clampGalleryZoom(100_000), max);
});

test("경계값 자체는 통과한다 — 최대 배율을 못 쓰면 한 단계가 죽는다", () => {
  assert.equal(clampGalleryZoom(min), min);
  assert.equal(clampGalleryZoom(max), max);
});

test("NaN·Infinity는 기본값으로 되돌린다 — 이 배율에는 '원래대로'가 기본값뿐이다", () => {
  assert.equal(clampGalleryZoom(Number.NaN), DEFAULT_GALLERY_ZOOM_PERCENT);
  assert.equal(clampGalleryZoom(Number.POSITIVE_INFINITY), DEFAULT_GALLERY_ZOOM_PERCENT);
  assert.equal(clampGalleryZoom(Number.NEGATIVE_INFINITY), DEFAULT_GALLERY_ZOOM_PERCENT);
});

test("격자에서 벗어난 값은 가장 가까운 단계에 붙는다 — 안 붙이면 한계에 영영 못 닿는다", () => {
  assert.equal(clampGalleryZoom(min + GALLERY_ZOOM_STEP_PERCENT * 1.7), min + GALLERY_ZOOM_STEP_PERCENT * 2);
  assert.equal(clampGalleryZoom(min + GALLERY_ZOOM_STEP_PERCENT * 1.2), min + GALLERY_ZOOM_STEP_PERCENT);
  assert.equal((clampGalleryZoom(137) - min) % GALLERY_ZOOM_STEP_PERCENT, 0);
});

// ─────────────────────────────────────────────── `−` / `+`

test("`+`와 `−`는 한 번에 한 단계씩 움직인다", () => {
  const start = DEFAULT_GALLERY_ZOOM_PERCENT;
  assert.equal(stepGalleryZoom(start, 1), start + GALLERY_ZOOM_STEP_PERCENT);
  assert.equal(stepGalleryZoom(start, -1), start - GALLERY_ZOOM_STEP_PERCENT);
  // 한 단계 올렸다 내리면 제자리다.
  assert.equal(stepGalleryZoom(stepGalleryZoom(start, 1), -1), start);
});

test("한계에서는 더 나가지 않는다", () => {
  assert.equal(stepGalleryZoom(max, 1), max);
  assert.equal(stepGalleryZoom(max, 5), max);
  assert.equal(stepGalleryZoom(min, -1), min);
  assert.equal(stepGalleryZoom(min, -5), min);
});

test("눌러 나갈 곳이 없으면 단추가 죽는다", () => {
  assert.equal(canZoomInGallery(max), false);
  assert.equal(canZoomOutGallery(min), false);
  assert.equal(canZoomInGallery(min), true);
  assert.equal(canZoomOutGallery(max), true);
  assert.equal(canZoomInGallery(DEFAULT_GALLERY_ZOOM_PERCENT), true);
  assert.equal(canZoomOutGallery(DEFAULT_GALLERY_ZOOM_PERCENT), true);
});

test("`+`를 계속 누르면 최대에서 멈추고, `−`는 최소에서 멈춘다", () => {
  let up = min;
  for (let i = 0; i < 100; i += 1) up = stepGalleryZoom(up, 1);
  assert.equal(up, max);

  let down = max;
  for (let i = 0; i < 100; i += 1) down = stepGalleryZoom(down, -1);
  assert.equal(down, min);
});

// ─────────────────────────────────────────────── 타일 너비

test("배율을 올리면 타일이 반드시 커진다 — 전 구간", () => {
  for (let percent = min; percent < max; percent += GALLERY_ZOOM_STEP_PERCENT) {
    const here = galleryTileWidth(percent);
    const next = galleryTileWidth(percent + GALLERY_ZOOM_STEP_PERCENT);
    assert.ok(next > here, `${percent}% → ${percent + GALLERY_ZOOM_STEP_PERCENT}% 에서 타일이 안 커졌다 (${here} → ${next})`);
  }
});

test("기본 배율의 타일이 기준 너비다 — 아무것도 안 고른 사람의 화면이 오늘과 같다", () => {
  assert.equal(galleryTileWidth(DEFAULT_GALLERY_ZOOM_PERCENT), GALLERY_TILE_BASE_WIDTH_PX);
});

test("가장 작을 때는 지금보다 훨씬 작고, 가장 클 때는 지금보다 크다", () => {
  assert.ok(galleryTileWidth(min) < GALLERY_TILE_BASE_WIDTH_PX / 1.5);
  assert.ok(galleryTileWidth(max) > GALLERY_TILE_BASE_WIDTH_PX);
});

test("타일 너비는 언제나 양의 정수다 — 0이나 소수가 CSS로 나가면 격자가 무너진다", () => {
  for (const value of [Number.NaN, -1, 0, min, DEFAULT_GALLERY_ZOOM_PERCENT, max, 9999]) {
    const width = galleryTileWidth(value);
    assert.ok(Number.isInteger(width) && width > 0, `${value} → ${width}`);
  }
});

// ─────────────────────────────────────────────── 격자

test("칸 수는 자리가 정한다 — auto-fill 이고 고정 칸 수가 아니다", () => {
  const template = galleryGridTemplate(DEFAULT_GALLERY_ZOOM_PERCENT);
  assert.ok(template.startsWith("repeat(auto-fill,"), template);
  assert.ok(template.includes(`${GALLERY_TILE_BASE_WIDTH_PX}px`), template);
  assert.ok(template.includes("1fr"), template);
});

test("🔴 어떤 배율에서도 한 칸은 들어간다 — 폰에서 가로로 넘치지 않는 자물쇠", () => {
  for (let percent = min; percent <= max; percent += GALLERY_ZOOM_STEP_PERCENT) {
    const template = galleryGridTemplate(percent);
    assert.ok(
      template.includes(`min(${galleryTileWidth(percent)}px, 100%)`),
      `${percent}% 에서 min(…, 100%) 이 빠졌다: ${template}`
    );
  }
});

// ─────────────────────────────────────────────── 화면에 적는 글자

test("배율 글자는 `140%` 꼴이다", () => {
  assert.equal(formatGalleryZoom(140), "140%");
  assert.equal(formatGalleryZoom(DEFAULT_GALLERY_ZOOM_PERCENT), `${DEFAULT_GALLERY_ZOOM_PERCENT}%`);
  assert.equal(formatGalleryZoom(min), `${min}%`);
  assert.equal(formatGalleryZoom(max), `${max}%`);
});

test("배율 글자도 쓰레기 값에 안 터진다", () => {
  assert.equal(formatGalleryZoom(Number.NaN), `${DEFAULT_GALLERY_ZOOM_PERCENT}%`);
  assert.equal(formatGalleryZoom(99999), `${max}%`);
  assert.equal(formatGalleryZoom(-3), `${min}%`);
});

// ─────────────────────────────────────────────── 저장소에서 읽은 값

test("적혀 있던 글자가 쓰레기여도 쓸 수 있는 값이 나온다", () => {
  assert.equal(parseGalleryZoom(null), DEFAULT_GALLERY_ZOOM_PERCENT, "없음");
  assert.equal(parseGalleryZoom(""), DEFAULT_GALLERY_ZOOM_PERCENT, "빈 글자");
  assert.equal(parseGalleryZoom("   "), DEFAULT_GALLERY_ZOOM_PERCENT, "공백뿐");
  assert.equal(parseGalleryZoom("크게"), DEFAULT_GALLERY_ZOOM_PERCENT, "숫자가 아닌 글자");
  assert.equal(parseGalleryZoom("NaN"), DEFAULT_GALLERY_ZOOM_PERCENT, "NaN");
  assert.equal(parseGalleryZoom("Infinity"), DEFAULT_GALLERY_ZOOM_PERCENT, "Infinity");
  assert.equal(parseGalleryZoom("1e999"), DEFAULT_GALLERY_ZOOM_PERCENT, "넘쳐서 Infinity가 되는 수");
  assert.equal(parseGalleryZoom("{}"), DEFAULT_GALLERY_ZOOM_PERCENT, "JSON 조각");
  assert.equal(parseGalleryZoom("99999"), max, "범위 밖(위)");
  assert.equal(parseGalleryZoom("-5"), min, "범위 밖(아래)");
  assert.equal(parseGalleryZoom("137"), clampGalleryZoom(137), "격자 밖");
  assert.equal(parseGalleryZoom(String(max)), max, "제대로 적혀 있으면 그대로");
});

test("저장소가 없으면 기본값으로 그린다", () => {
  assert.equal(readGalleryZoom(null, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY), DEFAULT_GALLERY_ZOOM_PERCENT);
});

test("🔴 읽는 것만으로 던지는 저장소에서도 안 터진다 — 여기서 던지면 첨부 목록이 죽는다", () => {
  assert.equal(
    readGalleryZoom(throwingStore, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY),
    DEFAULT_GALLERY_ZOOM_PERCENT
  );
});

test("적어 둔 값을 그대로 읽어 온다", () => {
  const store = fakeStore(String(max));
  assert.equal(readGalleryZoom(store, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY), max);
});

test("고른 값이 적히고, 다시 읽으면 같은 값이다", () => {
  const store = fakeStore(null);
  writeGalleryZoom(store, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY, 140);
  assert.equal(store.saved, "140");
  assert.equal(readGalleryZoom(store, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY), 140);
});

test("적을 때도 범위 밖 값은 접혀서 들어간다 — 저장소에 쓰레기를 남기지 않는다", () => {
  const store = fakeStore(null);
  writeGalleryZoom(store, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY, 99999);
  assert.equal(store.saved, String(max));

  writeGalleryZoom(store, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY, Number.NaN);
  assert.equal(store.saved, String(DEFAULT_GALLERY_ZOOM_PERCENT));
});

test("🔴 못 쓰는 저장소에서도 안 터진다(저장 공간이 꽉 찬 경우 포함)", () => {
  assert.doesNotThrow(() => {
    writeGalleryZoom(throwingStore, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY, 150);
  });
  assert.doesNotThrow(() => {
    writeGalleryZoom(null, ATTACHMENT_GALLERY_ZOOM_STORAGE_KEY, 150);
  });
});
