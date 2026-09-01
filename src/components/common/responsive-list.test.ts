import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readStoredChoice,
  resolveShowTable,
  writeStoredChoice,
  type StoredChoiceFallback,
  type StoredChoiceStore,
} from "./responsive-list";

// 목록이 표를 보여 줄지 카드를 보여 줄지 정하는 단 하나의 판단. 이 규칙이
// 흔들리면 13개 목록이 한꺼번에 흔들리므로 여기서 못 박아 둔다.

test("고른 적이 없으면 폭이 정한다 — 예전 규칙 그대로", () => {
  assert.equal(resolveShowTable(null, true), true, "들어가면 표");
  assert.equal(resolveShowTable(null, false), false, "안 들어가면 카드");
});

test("한 번 고르면 그 선택이 폭을 이긴다", () => {
  assert.equal(resolveShowTable("CARD", true), false, "표가 들어가도 카드를 골랐으면 카드");
  assert.equal(resolveShowTable("TABLE", false), true, "안 들어가도 표를 골랐으면 표(가로 스크롤)");
});

test("고른 대로 보여 준 뒤에도 폭 판정은 계속 유효하다", () => {
  // 표를 골라 둔 사람이 창을 넓혀도 계속 표다 — fits가 true로 바뀌었다고
  // 선택이 초기화되지는 않는다.
  assert.equal(resolveShowTable("TABLE", true), true);
  assert.equal(resolveShowTable("CARD", false), false);
});

// ── defaultMode — 폭이 정하게 두면 안 되는 목록만 ──────────────────────────
// 사진 격자처럼 무엇을 보러 온 자리인지가 이미 정해진 목록을 위한 것이다.
// 나머지 목록은 이 인자를 넘기지 않고, 넘기지 않은 쪽이 위 세 시험 그대로다.

test("defaultMode 를 주면 고른 적이 없을 때 폭 대신 그것이 정한다", () => {
  // 넓은 화면(fits=true)에서도 사진 격자부터 보인다 — 표가 들어간다는 사실이
  // "사진을 보러 온 사람에게 글자 표를 먼저 내밀 이유"가 되지는 않는다.
  assert.equal(resolveShowTable(null, true, "CARD"), false, "들어가도 카드");
  assert.equal(resolveShowTable(null, false, "CARD"), false, "안 들어가도 카드");
  // 반대 방향도 같은 규칙이다.
  assert.equal(resolveShowTable(null, false, "TABLE"), true, "안 들어가도 표");
  assert.equal(resolveShowTable(null, true, "TABLE"), true, "들어가도 표");
});

test("defaultMode 가 있어도 사람이 고른 값이 언제나 이긴다", () => {
  // 이 성질이 깨지면 "골라 놨는데 새로고침하면 되돌아간다"가 된다.
  assert.equal(resolveShowTable("TABLE", false, "CARD"), true, "표를 골랐으면 표");
  assert.equal(resolveShowTable("TABLE", true, "CARD"), true);
  assert.equal(resolveShowTable("CARD", true, "TABLE"), false, "카드를 골랐으면 카드");
  assert.equal(resolveShowTable("CARD", false, "TABLE"), false);
});

test("defaultMode 를 넘기지 않으면 예전 규칙 그대로다", () => {
  // 인자를 아예 안 준 호출과 undefined 를 준 호출이 같아야, 이 인자를 모르는
  // 나머지 목록이 한 픽셀도 달라지지 않는다.
  for (const fits of [true, false]) {
    assert.equal(resolveShowTable(null, fits, undefined), resolveShowTable(null, fits));
    assert.equal(resolveShowTable(null, fits, undefined), fits);
    assert.equal(resolveShowTable("TABLE", fits, undefined), true);
    assert.equal(resolveShowTable("CARD", fits, undefined), false);
  }
});

// ── 저장소가 막혀 있어도 목록이 죽지 않는다 ────────────────────────────────
// 사생활 보호 창이나 「사이트 데이터 차단」을 켠 브라우저에서는 localStorage 에
// 손대는 것 자체가 던진다. 렌더 도중에 던지면 이 파일을 쓰는 목록 화면이 통째로
// 죽으므로, 읽기·쓰기 어느 쪽도 던지지 않아야 한다.

const KEY = "list-view-mode:시험";

/** 멀쩡한 저장소. */
function healthyStore(): StoredChoiceStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

/** 읽는 것만으로 던지는 저장소(사생활 보호 창). */
const readThrowsStore: StoredChoiceStore = {
  getItem: () => {
    throw new Error("SecurityError: 저장소를 읽을 수 없습니다");
  },
  setItem: () => {
    throw new Error("SecurityError: 저장소에 적을 수 없습니다");
  },
};

/** 읽기는 되는데 적을 때 던지는 저장소(저장 공간이 꽉 참). */
function writeThrowsStore(): StoredChoiceStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
}

function newFallback(): StoredChoiceFallback {
  return new Map<string, string>();
}

test("읽는 것만으로 던지는 저장소 — 안 터지고 「고른 적 없음」으로 다룬다", () => {
  const fallback = newFallback();
  assert.equal(readStoredChoice(readThrowsStore, fallback, KEY), null);
  // 고른 적 없음이므로 폭이 정하던 예전 규칙으로 그대로 돌아간다.
  assert.equal(resolveShowTable(null, true), true);
  assert.equal(resolveShowTable(null, false), false);
});

test("적을 때 던지는 저장소 — 안 터진다", () => {
  const fallback = newFallback();
  assert.doesNotThrow(() => writeStoredChoice(writeThrowsStore(), fallback, KEY, "TABLE"));
  assert.doesNotThrow(() => writeStoredChoice(readThrowsStore, fallback, KEY, "CARD"));
});

test("🔴 쓰기가 막혀도 그 방문 동안은 고른 값이 유지된다", () => {
  // 이것이 없으면 저장이 막힌 브라우저에서 `표`를 눌러도 곧바로 되돌아간다 —
  // 죽지는 않지만 사람 눈에는 고장이다.
  const fallback = newFallback();
  const store = writeThrowsStore();

  assert.equal(readStoredChoice(store, fallback, KEY), null, "고르기 전에는 고른 적 없음");
  writeStoredChoice(store, fallback, KEY, "TABLE");
  assert.equal(readStoredChoice(store, fallback, KEY), "TABLE", "누른 대로 남는다");
  assert.equal(resolveShowTable("TABLE", false), true, "안 들어가는 폭에서도 표가 유지된다");

  // 다시 눌러 바꾼 것도 그대로 따라온다.
  writeStoredChoice(store, fallback, KEY, "CARD");
  assert.equal(readStoredChoice(store, fallback, KEY), "CARD");
});

test("읽는 것조차 던지는 저장소에서도 그 방문 동안의 선택은 살아 있다", () => {
  const fallback = newFallback();
  writeStoredChoice(readThrowsStore, fallback, KEY, "CARD");
  assert.equal(readStoredChoice(readThrowsStore, fallback, KEY), "CARD");
});

test("저장소가 아예 없어도(null) 안 터진다", () => {
  const fallback = newFallback();
  assert.equal(readStoredChoice(null, fallback, KEY), null);
  assert.doesNotThrow(() => writeStoredChoice(null, fallback, KEY, "TABLE"));
  assert.equal(readStoredChoice(null, fallback, KEY), "TABLE", "그 방문 동안은 먹는다");
});

test("저장소가 멀쩡하면 지금과 똑같이 동작한다", () => {
  const fallback = newFallback();
  const store = healthyStore();

  assert.equal(readStoredChoice(store, fallback, KEY), null, "적어 둔 것이 없으면 null");

  writeStoredChoice(store, fallback, KEY, "TABLE");
  assert.equal(store.data.get(KEY), "TABLE", "저장소에 실제로 적힌다");
  assert.equal(readStoredChoice(store, fallback, KEY), "TABLE");

  // 적어 두는 데 성공한 키는 들고 있지 않는다 — 저장소가 그 값의 주인이다.
  assert.equal(fallback.size, 0);

  // 키가 다르면 서로 남남이다(목록마다 따로 기억한다).
  assert.equal(readStoredChoice(store, fallback, "list-view-mode:다른목록"), null);

  // 저장소에 직접 적힌 값도 그대로 읽는다 — 들고 있던 것이 가로채지 않는다.
  store.data.set(KEY, "CARD");
  assert.equal(readStoredChoice(store, fallback, KEY), "CARD");
});

test("적어 두기에 성공하면 들고 있던 값을 놓는다", () => {
  // 저장이 막혔다가 풀린 경우(사생활 보호를 껐다, 공간을 비웠다). 계속 들고 있으면
  // 저장소의 값을 영영 가리게 된다.
  const fallback = newFallback();
  const blocked = writeThrowsStore();
  writeStoredChoice(blocked, fallback, KEY, "TABLE");
  assert.equal(fallback.get(KEY), "TABLE");

  const store = healthyStore();
  writeStoredChoice(store, fallback, KEY, "CARD");
  assert.equal(fallback.size, 0, "성공했으면 놓는다");
  assert.equal(readStoredChoice(store, fallback, KEY), "CARD");
});

test("적혀 있는 글자 그대로 돌려준다 — 뜻이 있는지는 부르는 쪽이 판정한다", () => {
  const fallback = newFallback();
  const store = healthyStore();
  store.data.set(KEY, "엉뚱한값");
  assert.equal(readStoredChoice(store, fallback, KEY), "엉뚱한값");

  // 못 적은 값도 마찬가지다 — 여기서 "CARD"/"TABLE" 을 판정해 버리지 않는다.
  const blocked = newFallback();
  writeStoredChoice(readThrowsStore, blocked, KEY, "엉뚱한값");
  assert.equal(readStoredChoice(readThrowsStore, blocked, KEY), "엉뚱한값");
});

test("🔴 돌려주는 것은 string | null 이다 — 새 객체를 만들지 않는다", () => {
  // useSyncExternalStore 의 스냅샷이라, 값이 안 바뀌었는데 참조가 흔들리면 React 가
  // "계속 바뀐다"고 보고 무한 렌더에 빠진다 — 이 파일을 쓰는 26개 화면이 한꺼번에
  // 멎는다.
  const fallback = newFallback();
  const store = healthyStore();

  for (const [target, keep] of [
    [store, fallback],
    [readThrowsStore, fallback],
    [null, fallback],
    [writeThrowsStore(), newFallback()],
  ] as const) {
    const first = readStoredChoice(target, keep, KEY);
    const second = readStoredChoice(target, keep, KEY);
    assert.ok(first === null || typeof first === "string", "string 이거나 null 이다");
    assert.ok(Object.is(first, second), "같은 값이면 같은 것을 돌려준다");
  }

  // 저장소에 값이 있을 때도, 못 적어 들고 있을 때도 마찬가지다.
  store.data.set(KEY, "TABLE");
  assert.ok(Object.is(readStoredChoice(store, fallback, KEY), readStoredChoice(store, fallback, KEY)));

  const blocked = newFallback();
  writeStoredChoice(readThrowsStore, blocked, KEY, "CARD");
  assert.ok(
    Object.is(readStoredChoice(readThrowsStore, blocked, KEY), readStoredChoice(readThrowsStore, blocked, KEY))
  );
});
