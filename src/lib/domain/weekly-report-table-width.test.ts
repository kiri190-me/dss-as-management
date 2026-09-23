import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT,
  WEEKLY_REPORT_WIDTH_PERCENT_RANGE,
  WEEKLY_REPORT_WIDTH_STEP_PERCENT,
  WEEKLY_REPORT_WIDTH_STORAGE_KEY,
  canNarrowWeeklyReport,
  canWidenWeeklyReport,
  clampWeeklyReportWidth,
  formatWeeklyReportWidth,
  parseWeeklyReportWidth,
  readWeeklyReportWidth,
  stepWeeklyReportWidth,
  weeklyReportWidthStyle,
  writeWeeklyReportWidth,
  type WeeklyReportWidthStore,
} from "./weekly-report-table-width";

/**
 * ============================================================================
 * 이 파일이 지키려는 것
 * ============================================================================
 * 1. 🔴 **아무것도 안 고른 사람의 화면이 한 픽셀도 안 바뀐다.** 기본값이 100% 고,
 *    그때 weeklyReportWidthStyle 이 `undefined` 라 감싸는 상자에 폭을 정하는
 *    속성이 한 줄도 붙지 않는다.
 * 2. 🔴 **RFG 와 MB 가 같은 값 하나를 나눠 쓴다.** 열쇠에 종류 이름이 들어가는
 *    순간 「RFG 에서 조절한 폭이 MB 에도」라는 요구가 깨진다 — 열쇠를 글자로
 *    본다.
 * 3. **넓히는 기능이 아니라 좁히는 기능이다.** 100% 를 넘는 값은 나오지 않는다 —
 *    넘으면 화면 밖으로 나가 주간보고 전체에 가로 스크롤이 생긴다.
 * 4. **저장소에서 읽은 값이 무엇이든 화면이 살아 있다.** 사생활 보호 창에서는
 *    localStorage 를 읽는 것만으로 던지고, 그때 여기서 던지면 가로폭 하나 때문에
 *    주간보고 전체를 못 보게 된다.
 * ============================================================================
 */

const { min, max } = WEEKLY_REPORT_WIDTH_PERCENT_RANGE;

/** 저장소 흉내. 시험이 넣어 둔 글자를 그대로 돌려준다. */
function fakeStore(initial: string | null): WeeklyReportWidthStore & { saved: string | null } {
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
const throwingStore: WeeklyReportWidthStore = {
  getItem() {
    throw new Error("SecurityError: 저장소에 접근할 수 없습니다");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

// ─────────────────────────────────────────────── 범위 · 단계 · 기본값

test("🔴 기본값은 100% 다 — 아무것도 안 고른 사람의 화면이 지금 그대로다", () => {
  assert.equal(DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, 100);
});

test("🔴 위 한계가 100% 다 — 넓히는 기능이 아니라 좁히는 기능이다", () => {
  assert.equal(max, 100);
  assert.ok(min < max, "좁힐 자리가 있어야 한다");
  assert.equal(clampWeeklyReportWidth(120), 100, "100 을 넘기면 화면 밖으로 나간다");
  assert.equal(clampWeeklyReportWidth(100_000), 100);
});

test("기본값은 범위 안이고 단계 격자 위에 있다", () => {
  assert.ok(DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT >= min && DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT <= max);
  assert.equal((DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT - min) % WEEKLY_REPORT_WIDTH_STEP_PERCENT, 0);
  // 한계도 격자 위에 있어야 `−`를 계속 눌러 최소에 정확히 닿는다.
  assert.equal((max - min) % WEEKLY_REPORT_WIDTH_STEP_PERCENT, 0);
});

test("범위 밖 값은 한계 안으로 접힌다 — 아래로도 위로도", () => {
  assert.equal(clampWeeklyReportWidth(0), min);
  assert.equal(clampWeeklyReportWidth(-5), min);
  assert.equal(clampWeeklyReportWidth(-500), min);
  assert.equal(clampWeeklyReportWidth(999), max);
});

test("경계값 자체는 통과한다 — 가장 좁은 폭을 못 쓰면 한 단계가 죽는다", () => {
  assert.equal(clampWeeklyReportWidth(min), min);
  assert.equal(clampWeeklyReportWidth(max), max);
});

test("NaN·Infinity는 기본값으로 되돌린다 — 이 값의 '원래대로'가 기본값이다", () => {
  assert.equal(clampWeeklyReportWidth(Number.NaN), DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT);
  assert.equal(clampWeeklyReportWidth(Number.POSITIVE_INFINITY), DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT);
  assert.equal(clampWeeklyReportWidth(Number.NEGATIVE_INFINITY), DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT);
});

test("격자에서 벗어난 값은 가장 가까운 단계에 붙는다 — 안 붙이면 한계에 영영 못 닿는다", () => {
  // 47 은 45 와 50 사이에서 45 쪽이 가깝다(단계 5).
  assert.equal(clampWeeklyReportWidth(47), 45);
  assert.equal(clampWeeklyReportWidth(48), 50);
  assert.equal(clampWeeklyReportWidth(63), 65);
  for (const value of [41, 47, 63, 78.4, 99]) {
    assert.equal(
      (clampWeeklyReportWidth(value) - min) % WEEKLY_REPORT_WIDTH_STEP_PERCENT,
      0,
      `${value} 가 격자에 안 붙었다`
    );
  }
});

// ─────────────────────────────────────────────── `−` / `+`

test("`+`와 `−`는 한 번에 한 단계씩 움직인다", () => {
  const start = 70;
  assert.equal(stepWeeklyReportWidth(start, 1), start + WEEKLY_REPORT_WIDTH_STEP_PERCENT);
  assert.equal(stepWeeklyReportWidth(start, -1), start - WEEKLY_REPORT_WIDTH_STEP_PERCENT);
  // 한 단계 좁혔다 넓히면 제자리다.
  assert.equal(stepWeeklyReportWidth(stepWeeklyReportWidth(start, -1), 1), start);
});

test("한계에서는 더 나가지 않는다", () => {
  assert.equal(stepWeeklyReportWidth(max, 1), max);
  assert.equal(stepWeeklyReportWidth(max, 5), max);
  assert.equal(stepWeeklyReportWidth(min, -1), min);
  assert.equal(stepWeeklyReportWidth(min, -5), min);
});

test("눌러 나갈 곳이 없으면 단추가 죽는다 — 기본값에서는 `+`가 죽어 있다", () => {
  assert.equal(canWidenWeeklyReport(max), false);
  assert.equal(canNarrowWeeklyReport(min), false);
  assert.equal(canWidenWeeklyReport(min), true);
  assert.equal(canNarrowWeeklyReport(max), true);
  // 기본값이 곧 최대폭이므로, 처음 화면에서는 넓히기가 눌리지 않는다.
  assert.equal(canWidenWeeklyReport(DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT), false);
  assert.equal(canNarrowWeeklyReport(DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT), true);
});

test("`−`를 계속 누르면 최소에서 멈추고, `+`는 최대에서 멈춘다", () => {
  let down = max;
  for (let i = 0; i < 100; i += 1) down = stepWeeklyReportWidth(down, -1);
  assert.equal(down, min);

  let up = min;
  for (let i = 0; i < 100; i += 1) up = stepWeeklyReportWidth(up, 1);
  assert.equal(up, max);
});

// ─────────────────────────────────────────────── 감싸는 상자에 붙는 style

test("🔴 기본값(100%)에서는 style 이 아예 없다 — 기능이 생겨도 남의 화면이 안 바뀐다", () => {
  assert.equal(weeklyReportWidthStyle(DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT), undefined);
  assert.equal(weeklyReportWidthStyle(max), undefined);
  // 범위를 벗어난 값도 100% 로 접히므로 style 이 붙지 않는다.
  assert.equal(weeklyReportWidthStyle(999), undefined);
  assert.equal(weeklyReportWidthStyle(Number.NaN), undefined);
});

test("좁혀 둔 값은 퍼센트 그대로 style 이 된다 — 고정 px 이 아니다", () => {
  assert.deepEqual(weeklyReportWidthStyle(70), { maxWidth: "70%" });
  assert.deepEqual(weeklyReportWidthStyle(min), { maxWidth: `${min}%` });
  assert.deepEqual(weeklyReportWidthStyle(-5), { maxWidth: `${min}%` }, "범위 밖(아래)");
  assert.deepEqual(weeklyReportWidthStyle(47), { maxWidth: "45%" }, "격자에 붙은 뒤의 값이다");
});

test("🔴 style 은 `maxWidth` 하나만 정한다 — 가운데 정렬은 상자의 mx-auto 가 한다", () => {
  const style = weeklyReportWidthStyle(60);
  assert.ok(style);
  assert.deepEqual(Object.keys(style), ["maxWidth"]);
});

// ─────────────────────────────────────────────── 화면에 적는 글자

test("가로폭 글자는 `70%` 꼴이다", () => {
  assert.equal(formatWeeklyReportWidth(70), "70%");
  assert.equal(formatWeeklyReportWidth(DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT), "100%");
  assert.equal(formatWeeklyReportWidth(min), `${min}%`);
});

test("가로폭 글자도 쓰레기 값에 안 터진다", () => {
  assert.equal(formatWeeklyReportWidth(Number.NaN), `${DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT}%`);
  assert.equal(formatWeeklyReportWidth(99999), `${max}%`);
  assert.equal(formatWeeklyReportWidth(-3), `${min}%`);
});

// ─────────────────────────────────────────────── 🔴 열쇠 하나를 나눠 쓴다

test("🔴 열쇠에 RFG · MB 가 들어 있지 않다 — 한쪽에서 조절한 폭이 다른 쪽에도 간다", () => {
  assert.ok(!WEEKLY_REPORT_WIDTH_STORAGE_KEY.includes("RFG"), WEEKLY_REPORT_WIDTH_STORAGE_KEY);
  assert.ok(!WEEKLY_REPORT_WIDTH_STORAGE_KEY.includes("MB"), WEEKLY_REPORT_WIDTH_STORAGE_KEY);
  assert.ok(!/rfg|mb|kind/i.test(WEEKLY_REPORT_WIDTH_STORAGE_KEY), WEEKLY_REPORT_WIDTH_STORAGE_KEY);
});

test("열쇠는 `무엇:어디` 꼴이다 — 키만 보고 무엇을 기억한 값인지 안다", () => {
  assert.equal(WEEKLY_REPORT_WIDTH_STORAGE_KEY, "weekly-report-table-width:dashboard");
  assert.equal(WEEKLY_REPORT_WIDTH_STORAGE_KEY.split(":").length, 2);
});

test("🔴 RFG 에서 적은 값을 MB 에서 그대로 읽는다 — 저장소 한 칸을 나눠 쓴다", () => {
  const store = fakeStore(null);
  // `RFG 만` 화면에서 70% 로 좁혔다.
  writeWeeklyReportWidth(store, WEEKLY_REPORT_WIDTH_STORAGE_KEY, 70);
  // `MB 만` 으로 옮겨도 같은 열쇠를 읽으므로 같은 폭이다.
  assert.equal(readWeeklyReportWidth(store, WEEKLY_REPORT_WIDTH_STORAGE_KEY), 70);
});

// ─────────────────────────────────────────────── 저장소에서 읽은 값

test("적혀 있던 글자가 쓰레기여도 쓸 수 있는 값이 나온다 — 던지지 않는다", () => {
  for (const [raw, expected, why] of [
    [null, DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "없음"],
    ["", DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "빈 글자"],
    ["   ", DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "공백뿐"],
    ["abc", DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "숫자가 아닌 글자"],
    ["좁게", DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "우리말"],
    ["NaN", DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "NaN"],
    ["Infinity", DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "Infinity"],
    ["1e999", DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "넘쳐서 Infinity가 되는 수"],
    ["{}", DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT, "JSON 조각"],
    ["12.7", min, "범위 밖(아래)인 소수"],
    ["99999", max, "범위 밖(위)"],
    ["-5", min, "음수"],
    ["67", 65, "격자 밖"],
    ["70", 70, "제대로 적혀 있으면 그대로"],
  ] as const) {
    assert.doesNotThrow(() => parseWeeklyReportWidth(raw), String(why));
    assert.equal(parseWeeklyReportWidth(raw), expected, String(why));
  }
});

test("저장소가 없으면 기본값으로 그린다 — 서버에서 그릴 때가 그렇다", () => {
  assert.equal(readWeeklyReportWidth(null, WEEKLY_REPORT_WIDTH_STORAGE_KEY), DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT);
});

test("🔴 읽는 것만으로 던지는 저장소에서도 안 터진다 — 여기서 던지면 주간보고가 죽는다", () => {
  assert.equal(
    readWeeklyReportWidth(throwingStore, WEEKLY_REPORT_WIDTH_STORAGE_KEY),
    DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT
  );
});

test("적어 둔 값을 그대로 읽어 온다", () => {
  const store = fakeStore("55");
  assert.equal(readWeeklyReportWidth(store, WEEKLY_REPORT_WIDTH_STORAGE_KEY), 55);
});

test("적을 때도 범위 밖 값은 접혀서 들어간다 — 저장소에 쓰레기를 남기지 않는다", () => {
  const store = fakeStore(null);
  writeWeeklyReportWidth(store, WEEKLY_REPORT_WIDTH_STORAGE_KEY, 99999);
  assert.equal(store.saved, String(max));

  writeWeeklyReportWidth(store, WEEKLY_REPORT_WIDTH_STORAGE_KEY, Number.NaN);
  assert.equal(store.saved, String(DEFAULT_WEEKLY_REPORT_WIDTH_PERCENT));

  writeWeeklyReportWidth(store, WEEKLY_REPORT_WIDTH_STORAGE_KEY, 47);
  assert.equal(store.saved, "45", "격자에 붙은 값이 들어간다");
});

test("🔴 못 쓰는 저장소에서도 안 터진다(저장 공간이 꽉 찬 경우 포함)", () => {
  assert.doesNotThrow(() => {
    writeWeeklyReportWidth(throwingStore, WEEKLY_REPORT_WIDTH_STORAGE_KEY, 60);
  });
  assert.doesNotThrow(() => {
    writeWeeklyReportWidth(null, WEEKLY_REPORT_WIDTH_STORAGE_KEY, 60);
  });
});
