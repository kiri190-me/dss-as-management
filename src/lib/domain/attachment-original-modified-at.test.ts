import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ORIGINAL_MODIFIED_AT_AHEAD_MS,
  MIN_ORIGINAL_MODIFIED_AT_MS,
  ORIGINAL_MODIFIED_AT_PARAM,
  originalModifiedAtFromEpochMs,
  originalModifiedAtFromParam,
  originalModifiedAtFromSearchParams,
  originalModifiedAtParamValue,
} from "./attachment-original-modified-at";

/**
 * ============================================================================
 * 원본 수정일 — **믿을 수 없는 값을 어디까지 받아들이는가**
 * ============================================================================
 * 이 값은 우리가 잰 것이 아니라 올리는 PC 의 브라우저가 주는 것이다. 그래서 이
 * 시험이 보는 것은 「되는가」보다 **「이상한 값이 와도 거짓이 표에 적히지
 * 않는가」** 다: 없음 · 0 · 아주 먼 과거 · 미래 · 숫자 아님 · 같은 이름 두 번 →
 * 전부 빈칸(null)이고, 그때도 **업로드는 막히지 않는다**(이 파일의 함수들은
 * 던지지 않는다 — 부르는 쪽에 '거절' 갈래가 없다는 것이 그 보장이다).
 *
 * 그리고 🔴 **보내는 쪽과 받는 쪽이 같은 문을 지나는가** — 화면이 실어 보낸 값이
 * 서버에서 조용히 버려지는 어긋남이 생길 자리가 없어야 한다.
 * ============================================================================
 */

/** 시험을 고정하기 위한 '지금'. 실제 시각에 기대면 몇 년 뒤에 뜻이 달라진다. */
const NOW = new Date("2026-09-30T12:00:00.000Z");

/** 사람이 실제로 올릴 법한 값 — 2026-09-01 09:30 UTC 에 저장한 엑셀 양식. */
const REAL_SAVE_MS = Date.UTC(2026, 8, 1, 9, 30, 0);

describe("쓸 수 있는 값", () => {
  test("사람이 저장한 시각은 그대로 살아 온다", () => {
    const parsed = originalModifiedAtFromEpochMs(REAL_SAVE_MS, NOW);
    assert.ok(parsed instanceof Date);
    assert.equal(parsed.getTime(), REAL_SAVE_MS);
  });

  test("지금 막 저장한 파일도 받는다", () => {
    const parsed = originalModifiedAtFromEpochMs(NOW.getTime(), NOW);
    assert.equal(parsed?.getTime(), NOW.getTime());
  });

  test("경계값 — 1990-01-01 00:00:00Z 는 받고 그 1밀리초 전은 버린다", () => {
    assert.equal(
      originalModifiedAtFromEpochMs(MIN_ORIGINAL_MODIFIED_AT_MS, NOW)?.getTime(),
      MIN_ORIGINAL_MODIFIED_AT_MS
    );
    assert.equal(originalModifiedAtFromEpochMs(MIN_ORIGINAL_MODIFIED_AT_MS - 1, NOW), null);
  });

  test("시계가 하루 안쪽으로 앞서 있는 PC 의 파일은 받는다 — 흔한 오차다", () => {
    const ahead = NOW.getTime() + MAX_ORIGINAL_MODIFIED_AT_AHEAD_MS;
    assert.equal(originalModifiedAtFromEpochMs(ahead, NOW)?.getTime(), ahead);
    assert.equal(originalModifiedAtFromEpochMs(ahead + 1, NOW), null, "하루를 넘겨 앞선 값은 버린다");
  });
});

describe("🔴 터무니없는 값은 빈칸이 된다", () => {
  test("값이 없다 — undefined · null", () => {
    assert.equal(originalModifiedAtFromEpochMs(undefined, NOW), null);
    assert.equal(originalModifiedAtFromEpochMs(null, NOW), null);
  });

  test("0 — 파일시스템이 수정 시각을 주지 못했을 때 그대로 들어오는 값이다", () => {
    assert.equal(originalModifiedAtFromEpochMs(0, NOW), null);
  });

  test("압축을 풀어 받은 파일의 바닥값(1980-01-01)도 '모른다'는 뜻이라 버린다", () => {
    assert.equal(originalModifiedAtFromEpochMs(Date.UTC(1980, 0, 1), NOW), null);
  });

  test("아주 먼 과거 — 1970-01-01 이전(음수)", () => {
    assert.equal(originalModifiedAtFromEpochMs(-1, NOW), null);
    assert.equal(originalModifiedAtFromEpochMs(Date.UTC(1969, 0, 1), NOW), null);
  });

  test("미래 — 다음 해에 저장된 양식은 없다", () => {
    assert.equal(originalModifiedAtFromEpochMs(Date.UTC(2027, 0, 1), NOW), null);
  });

  test("숫자가 아니다 — 글자 · 불린 · 객체 · 배열", () => {
    for (const value of ["1790000000000", true, {}, [REAL_SAVE_MS], new Date(REAL_SAVE_MS)]) {
      assert.equal(originalModifiedAtFromEpochMs(value, NOW), null, String(value));
    }
  });

  test("숫자이긴 하나 값이 아니다 — NaN · 무한대 · 소수", () => {
    assert.equal(originalModifiedAtFromEpochMs(Number.NaN, NOW), null);
    assert.equal(originalModifiedAtFromEpochMs(Number.POSITIVE_INFINITY, NOW), null);
    assert.equal(originalModifiedAtFromEpochMs(Number.NEGATIVE_INFINITY, NOW), null);
    assert.equal(
      originalModifiedAtFromEpochMs(REAL_SAVE_MS + 0.5, NOW),
      null,
      "File.lastModified 는 언제나 정수 밀리초다 — 소수는 브라우저가 준 값이 아니다"
    );
  });

  test("🔴 어떤 값에도 던지지 않는다 — 날짜 하나 때문에 업로드가 멈추면 안 된다", () => {
    const wild: unknown[] = [
      undefined,
      null,
      Number.NaN,
      0,
      -1,
      "어제",
      {},
      [],
      Symbol("x"),
      new Map([["lastModified", REAL_SAVE_MS]]),
      () => REAL_SAVE_MS,
    ];
    for (const value of wild) {
      assert.doesNotThrow(() => originalModifiedAtFromEpochMs(value, NOW), String(value));
      assert.doesNotThrow(() => originalModifiedAtParamValue(value, NOW));
    }
  });
});

describe("주소에서 읽기", () => {
  test("정수 글자는 그대로 읽힌다 — 앞뒤 공백은 걷어낸다", () => {
    assert.equal(originalModifiedAtFromParam(String(REAL_SAVE_MS), NOW)?.getTime(), REAL_SAVE_MS);
    assert.equal(originalModifiedAtFromParam(`  ${REAL_SAVE_MS}  `, NOW)?.getTime(), REAL_SAVE_MS);
  });

  test("🔴 숫자가 조용히 되는 글자들을 막는다 — 빈 값 · 16진수 · 지수 · 소수", () => {
    for (const text of ["", "   ", "0x10", "1e15", "1790000000000.5", "어제", "NaN", "+1790000000000"]) {
      assert.equal(originalModifiedAtFromParam(text, NOW), null, `'${text}' 가 통과했다`);
    }
  });

  test("값이 없거나 같은 이름이 두 번이면 버린다", () => {
    assert.equal(originalModifiedAtFromParam(undefined, NOW), null);
    assert.equal(originalModifiedAtFromParam(null, NOW), null);
    assert.equal(originalModifiedAtFromParam([String(REAL_SAVE_MS)], NOW), null);
  });

  test("아주 긴 숫자 글자도 죽지 않고 빈칸이 된다", () => {
    assert.equal(originalModifiedAtFromParam("9".repeat(40), NOW), null);
  });

  test("URLSearchParams 에서 읽는다 — 같은 이름이 두 번이면 첫 값을 몰래 쓰지 않는다", () => {
    const one = new URLSearchParams({ [ORIGINAL_MODIFIED_AT_PARAM]: String(REAL_SAVE_MS) });
    assert.equal(originalModifiedAtFromSearchParams(one, NOW)?.getTime(), REAL_SAVE_MS);

    const twice = new URLSearchParams();
    twice.append(ORIGINAL_MODIFIED_AT_PARAM, String(REAL_SAVE_MS));
    twice.append(ORIGINAL_MODIFIED_AT_PARAM, "0");
    assert.equal(originalModifiedAtFromSearchParams(twice, NOW), null);

    assert.equal(originalModifiedAtFromSearchParams(new URLSearchParams(), NOW), null);
  });
});

describe("🔴 보내는 쪽과 받는 쪽이 같은 문을 지난다", () => {
  test("실을 수 있는 값은 실어 보내고, 받는 쪽이 같은 시각으로 읽는다", () => {
    const text = originalModifiedAtParamValue(REAL_SAVE_MS, NOW);
    assert.equal(text, String(REAL_SAVE_MS));
    const query = new URLSearchParams({ [ORIGINAL_MODIFIED_AT_PARAM]: text! });
    assert.equal(originalModifiedAtFromSearchParams(query, NOW)?.getTime(), REAL_SAVE_MS);
  });

  test("실을 수 없는 값은 아예 보내지 않는다 — 보냈는데 버려지는 어긋남이 없다", () => {
    for (const value of [undefined, 0, -1, Date.UTC(2030, 0, 1), Number.NaN, "1790000000000"]) {
      assert.equal(originalModifiedAtParamValue(value, NOW), null, String(value));
    }
  });
});
