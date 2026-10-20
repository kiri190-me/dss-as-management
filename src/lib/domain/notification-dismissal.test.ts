import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_KINDS } from "./notifications";
import {
  ACKNOWLEDGEABLE_NOTIFICATION_KINDS,
  isAcknowledgeableNotificationKind,
} from "./notification-acknowledgement";
import {
  canDismissNotification,
  dismissableNotificationKeys,
  notificationDismissalKeyPrefixForUser,
  notificationDismissalStorageKey,
  pruneOldDismissalKeys,
  readDismissedNotificationKeys,
  writeDismissedNotificationKeys,
  type DismissalStore,
} from "./notification-dismissal";

/**
 * 종에서 알림을 **지우는** 규칙과, 그것을 이 브라우저에 적어 두는 자리.
 *
 * 🔴 이 파일이 지키는 선이 셋이다:
 *  1. **지울 수 있는 줄**을 가리는 규칙 — 2026-10-20부터 **전부** 지울 수 있다.
 *  2. 열쇠가 **사람과 로그인 시각**으로 갈린다 — 공용 PC 와 다음 로그인.
 *  3. 저장소가 터져도 **던지지 않는다** — 알림 하나 때문에 머리말이 죽지 않는다.
 */

/** 진짜 localStorage 처럼 구는 가짜. 칸 번호가 당겨지는 것까지 같다. */
function 가짜저장소(처음: Record<string, string> = {}) {
  const 칸 = new Map<string, string>(Object.entries(처음));
  const store: DismissalStore = {
    get length() {
      return 칸.size;
    },
    key: (index) => [...칸.keys()][index] ?? null,
    getItem: (key) => 칸.get(key) ?? null,
    setItem: (key, value) => {
      칸.set(key, value);
    },
    removeItem: (key) => {
      칸.delete(key);
    },
  };
  return { store, 이름들: () => [...칸.keys()], 값: (key: string) => 칸.get(key) ?? null };
}

/** 손대는 것마다 던지는 저장소(사생활 보호 창 · 저장을 막아 둔 브라우저). */
const 터지는저장소: DismissalStore = {
  get length(): number {
    throw new Error("막혀 있다");
  },
  key: () => {
    throw new Error("막혀 있다");
  },
  getItem: () => {
    throw new Error("막혀 있다");
  },
  setItem: () => {
    throw new Error("막혀 있다");
  },
  removeItem: () => {
    throw new Error("막혀 있다");
  },
};

// ─────────────────────────────────────────── 1. 지울 수 있는 줄 가리기

test("🔴 남의 시스템에서 온 줄은 **종류를 가리지 않고** 전부 지울 수 있다", () => {
  // 저쪽 종류 목록은 이 저장소의 것이 아니다. 이름을 여기 박아 두면 저쪽이
  // 바꾸는 날 조용히 안 맞는다 — 아무 오류 없이 「안 지워지는 알림」이 된다.
  //
  // 🔴 2026-10-20부터 자기 줄도 전부 지울 수 있어 답이 같아졌지만, **까닭이
  //    다르다** — 자기 줄은 「사용자가 그렇게 정했다」, 남의 줄은 「저쪽 종류를
  //    알 수 없다」다. 다시 좁힐 때 둘이 갈리므로 이 시험을 남겨 둔다.
  const 남의종류 = [
    "IMPROVEMENT",
    "CALIBRATION_DUE",
    "LEAVE_REQUEST",
    "무엇이든",
    "",
    // 🔴 최악의 경우 — 종류 코드까지 A/S 의 「눌러서 확인하는」 종류와 같을 때.
    ...ACKNOWLEDGEABLE_NOTIFICATION_KINDS,
    ...NOTIFICATION_KINDS,
  ];

  for (const kind of 남의종류) {
    assert.equal(
      canDismissNotification({ kind, sourceId: "dss-improvements" }),
      true,
      `${kind}: 남의 줄을 못 지운다`
    );
  }
});

test("🔴 A/S 자기 줄은 **종류 전부** 지울 수 있다 — 할 일 알림도(2026-10-20)", () => {
  // 옛 규칙은 「눌러서 확인하는 종류」(결재 결과 둘)만 열어 두었다. 그 막은 이미
  // 뚫려 있었다 — 같은 줄이 포털을 거쳐 다른 사이트로 가면 그쪽에서는 「남의
  // 시스템 줄」이 되어 언제나 지워졌다. A/S 안에서만 막혀 헷갈리기만 했다.
  //
  // 🔴 목록을 NOTIFICATION_KINDS 에서 가져오므로 **종류가 늘어도 따라온다** —
  //    새 종류를 더하면 이 시험이 그 종류까지 「지울 수 있어야 한다」로 본다.
  assert.deepEqual(
    NOTIFICATION_KINDS.filter((kind) => canDismissNotification({ kind, sourceId: "" })),
    [...NOTIFICATION_KINDS],
    "자기 줄 가운데 못 지우는 종류가 남아 있다"
  );
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(canDismissNotification({ kind, sourceId: "" }), true, `${kind}: 자기 줄을 못 지운다`);
  }

  // 🔴 대조 — **옛 규칙이 막던 종류가 실제로 이 목록 안에 있다.** 이것이 없으면
  //    ACKNOWLEDGEABLE 가 전부가 되는 날 위 단언이 공짜로 통과한다.
  const 옛날에막히던것 = NOTIFICATION_KINDS.filter((kind) => !isAcknowledgeableNotificationKind(kind));
  assert.ok(옛날에막히던것.length > 0, "할 일 알림이 하나도 없다 — 이 시험이 아무것도 안 본다");
  for (const kind of 옛날에막히던것) {
    assert.equal(canDismissNotification({ kind, sourceId: "" }), true, `${kind}: 옛 규칙이 되살아났다`);
  }

  // 🔴 그리고 **확인 기록 쪽은 그대로 좁혀 둔 채**다 — 지우기와 확인 기록은
  //    다른 기능이고, 이쪽을 열었다고 영구 기록까지 열지 않았다.
  assert.deepEqual(
    [...ACKNOWLEDGEABLE_NOTIFICATION_KINDS],
    ["APPROVAL_GRANTED", "APPROVAL_REJECTED"],
    "확인 기록의 종류 목록이 지우기를 따라 넓어졌다"
  );
});

test("🔴 `sourceId` 칸의 모양이 답을 바꾸지 않는다 — 없음 · 빈 문자열 · 값 있음", () => {
  // A/S 안쪽 모양(NotificationItem)에는 이 칸이 아예 없고, 옮겨 담은 뒤에는 빈
  // 문자열이며, 포털 줄에만 값이 있다. 셋 다 같은 답이어야 호출부가 어느 모양을
  // 넘기든 단추가 들쭉날쭉하지 않는다.
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(canDismissNotification({ kind }), true, `${kind}: 칸이 없는 모양에서 못 지운다`);
    assert.equal(canDismissNotification({ kind, sourceId: "" }), true, `${kind}: 빈 문자열에서 못 지운다`);
    assert.equal(canDismissNotification({ kind, sourceId: "njlee" }), true, `${kind}: 값이 있을 때 못 지운다`);
  }
});

test("🔴 일괄 지우기는 **보이는 줄 전부**를 집는다 — 차례는 그대로", () => {
  // 「보이는 알림 지우기 n건」의 n 이 이 길이다. 한 줄이라도 빠지면 열어 보면
  // 남아 있는데 단추는 안 세는 종이 된다.
  const 보이는것 = [
    ...NOTIFICATION_KINDS.map((kind) => ({ key: `mine:${kind}`, kind, sourceId: "" })),
    { key: "dss-improvements:IMPROVEMENT:7", kind: "IMPROVEMENT", sourceId: "dss-improvements" },
    { key: "njlee:CAL:3", kind: NOTIFICATION_KINDS[0], sourceId: "njlee" },
  ];

  assert.deepEqual(
    dismissableNotificationKeys(보이는것),
    보이는것.map((row) => row.key),
    "지우지 못한다고 빠진 줄이 있다"
  );
  assert.equal(
    dismissableNotificationKeys(보이는것).length,
    NOTIFICATION_KINDS.length + 2,
    "자기 줄 전부 + 포털 둘이 아니다 — 「보이는 알림 지우기 n건」의 n 이 줄어든다"
  );
  assert.deepEqual(dismissableNotificationKeys([]), []);
});

// ────────────────────────────────── 2. 열쇠 — 사람과 로그인 시각으로 갈린다

test("🔴 열쇠는 사람으로 갈린다 — 공용 PC 에서 앞사람 것이 남으면 안 된다", () => {
  const 앞사람 = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 1_700_000_000 });
  const 뒷사람 = notificationDismissalStorageKey({ userId: "user-b", issuedAt: 1_700_000_000 });

  assert.notEqual(앞사람, 뒷사람);
  assert.ok(앞사람.includes("user-a"));
});

test("🔴 열쇠는 **로그인 시각**으로도 갈린다 — 다시 로그인하면 저절로 비워진다", () => {
  const 어제 = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 1_700_000_000 });
  const 오늘 = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 1_700_086_400 });

  assert.notEqual(어제, 오늘, "다시 로그인해도 같은 칸을 본다 — 지운 알림이 영영 안 돌아온다");

  // 같은 사람 · 같은 로그인이면 같은 칸이다(화면을 옮겨 다녀도 그대로).
  assert.equal(오늘, notificationDismissalStorageKey({ userId: "user-a", issuedAt: 1_700_086_400 }));

  // 🔴 그리고 **지운 것이 실제로 안 걸러진다** — 열쇠만 다른 것이 아니라
  //    어제 칸에 적힌 것이 오늘 칸에서 읽히지 않는다.
  const { store } = 가짜저장소();
  writeDismissedNotificationKeys(store, 어제, ["APPROVAL:1"]);
  assert.deepEqual(readDismissedNotificationKeys(store, 오늘), []);
  assert.deepEqual(readDismissedNotificationKeys(store, 어제), ["APPROVAL:1"]);
});

test("같은 사람의 열쇠들은 한 앞머리를 나눠 갖는다 — 옛 것을 가려내는 재료다", () => {
  const prefix = notificationDismissalKeyPrefixForUser("user-a");

  assert.ok(notificationDismissalStorageKey({ userId: "user-a", issuedAt: 1 }).startsWith(prefix));
  assert.ok(notificationDismissalStorageKey({ userId: "user-a", issuedAt: 2 }).startsWith(prefix));
  assert.equal(
    notificationDismissalStorageKey({ userId: "user-b", issuedAt: 1 }).startsWith(prefix),
    false
  );
});

// ───────────────────────────────────────────────── 3. 적어 두고 읽어 오기

test("적어 둔 것을 그대로 읽는다", () => {
  const { store } = 가짜저장소();
  const key = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 7 });

  assert.deepEqual(readDismissedNotificationKeys(store, key), [], "아직 아무것도 안 지웠다");
  writeDismissedNotificationKeys(store, key, ["A:1", "dss-improvements:IMPROVEMENT:7"]);
  assert.deepEqual(readDismissedNotificationKeys(store, key), ["A:1", "dss-improvements:IMPROVEMENT:7"]);
});

test("🔴 깨진 값·저장소 없음·터지는 저장소는 전부 「아무것도 안 지웠다」로 읽는다", () => {
  // 반대로 기울면(못 읽었는데 뭔가 지워진 것으로 치면) 알림이 사라진다.
  const key = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 7 });

  for (const 깨진값 of ["{", "null", '"글자"', "123", '{"a":1}', '["ok", 7]']) {
    const { store } = 가짜저장소({ [key]: 깨진값 });
    assert.deepEqual(readDismissedNotificationKeys(store, key), [], 깨진값);
  }

  assert.deepEqual(readDismissedNotificationKeys(null, key), []);
  assert.deepEqual(readDismissedNotificationKeys(터지는저장소, key), []);
});

test("🔴 적어 두지 못해도 던지지 않는다 — 알림 하나 때문에 머리말이 죽으면 안 된다", () => {
  const key = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 7 });

  assert.doesNotThrow(() => writeDismissedNotificationKeys(null, key, ["A:1"]));
  assert.doesNotThrow(() => writeDismissedNotificationKeys(터지는저장소, key, ["A:1"]));
});

// ─────────────────────────────────────────────────── 4. 옛 열쇠 치우기

test("🔴 같은 사람의 **옛 로그인 칸만** 치운다 — 지금 것도 남의 것도 그대로", () => {
  const 지금 = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 300 });
  const 어제 = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 200 });
  const 그제 = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 100 });
  const 남의것 = notificationDismissalStorageKey({ userId: "user-b", issuedAt: 100 });

  const { store, 이름들 } = 가짜저장소({
    [그제]: "[]",
    [어제]: "[]",
    [지금]: '["A:1"]',
    [남의것]: "[]",
    "dss.notifications.seen.v1.user-a": "[]",
    "남의 앱 칸": "x",
  });

  const 치운것 = pruneOldDismissalKeys(store, {
    prefix: notificationDismissalKeyPrefixForUser("user-a"),
    keep: 지금,
  });

  // 🔴 **둘 다** 치워져야 한다. 지우면서 훑으면 뒤 칸 번호가 당겨져 하나만
  //    치워진다 — 절반만 남고 아무도 모른다.
  assert.deepEqual(치운것.sort(), [그제, 어제].sort());
  assert.deepEqual(이름들().sort(), [지금, 남의것, "dss.notifications.seen.v1.user-a", "남의 앱 칸"].sort());
  // 지금 칸의 내용은 손대지 않았다.
  assert.deepEqual(readDismissedNotificationKeys(store, 지금), ["A:1"]);
});

test("치울 것이 없으면 아무 일도 아니고, 저장소가 터져도 던지지 않는다", () => {
  const 지금 = notificationDismissalStorageKey({ userId: "user-a", issuedAt: 300 });
  const { store, 이름들 } = 가짜저장소({ [지금]: "[]" });

  assert.deepEqual(
    pruneOldDismissalKeys(store, {
      prefix: notificationDismissalKeyPrefixForUser("user-a"),
      keep: 지금,
    }),
    []
  );
  assert.deepEqual(이름들(), [지금]);

  assert.doesNotThrow(() =>
    pruneOldDismissalKeys(터지는저장소, { prefix: "dss.", keep: 지금 })
  );
  assert.deepEqual(pruneOldDismissalKeys(null, { prefix: "dss.", keep: 지금 }), []);
});
