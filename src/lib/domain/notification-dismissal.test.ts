import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTIFICATION_KINDS } from "./notifications";
import {
  ACKNOWLEDGEABLE_NOTIFICATION_KINDS,
  isAcknowledgeableNotificationKind,
} from "./notification-acknowledgement";
import {
  DISMISSAL_STORAGE_PREFIX,
  canDismissNotification,
  dismissableNotificationKeys,
  purgeStoredDismissals,
  type DismissalStore,
} from "./notification-dismissal";

/**
 * 종에서 알림을 **지우는** 규칙과, 브라우저에 남은 **옛 기록을 치우는** 일.
 *
 * 🔴 이 파일이 지키는 선이 셋이다:
 *  1. **지울 수 있는 줄**을 가리는 규칙 — 2026-10-20부터 **전부** 지울 수 있다.
 *  2. 🔴 **이 모듈은 브라우저에 적지 않는다**(2026-10-20). 지움은 포털에 적히고
 *     (server/integration/portal-inbox.ts 의 dismissPortalNotifications), 여기
 *     남은 저장소 일은 **옛 칸을 한 번 치우는 것**뿐이다. 둘 다 적으면
 *     「브라우저엔 있는데 포털엔 없거나 반대이거나」가 생긴다.
 *  3. 저장소가 터져도 **던지지 않는다** — 알림 하나 때문에 머리말이 죽지 않는다.
 */

/**
 * 진짜 localStorage 처럼 구는 가짜. 칸 번호가 당겨지는 것까지 같다.
 *
 * 🔴 `getItem`/`setItem` 은 **DismissalStore 에 없다**(적지도 읽지도 않으므로).
 * 가짜 쪽에는 그대로 두어 「적힌 것이 하나도 없다」를 시험이 들여다볼 수 있게 한다.
 */
function 가짜저장소(처음: Record<string, string> = {}) {
  const 칸 = new Map<string, string>(Object.entries(처음));
  const store: DismissalStore = {
    get length() {
      return 칸.size;
    },
    key: (index) => [...칸.keys()][index] ?? null,
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
  removeItem: () => {
    throw new Error("막혀 있다");
  },
};

/** 2026-10-19 까지 쓰던 칸 이름 — 사람 id 와 로그인 시각이 붙어 있었다. */
function 옛칸(userId: string, issuedAt: number): string {
  return `${DISMISSAL_STORAGE_PREFIX}v1.${userId}.${issuedAt}`;
}

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

// ────────────────── 2. 🔴 브라우저에는 **적지 않는다**(2026-10-20)

test("🔴 이 모듈에는 저장소에 **적는 길이 없다** — 포털과 두 벌이 되지 않게", () => {
  // 지움이 포털로 옮겨 가면서 브라우저 저장을 걷어냈다. 둘 다 두면 「브라우저엔
  // 있는데 포털엔 없거나 반대이거나」가 생기고, 그 어긋남은 **「계측기에서는
  // 지웠는데 A/S 에만 뜬다」** 라는 신고로만 드러난다.
  //
  // 🔴 타입 자체에 적는 칸이 없어야 한다 — 칸을 남겨 두면 다음 사람이 「여기에
  //    적어도 되나 보다」로 읽는다. 값으로는 확인할 수 없는 선이라 원본을 본다.
  const source = readFileSync(new URL("./notification-dismissal.ts", import.meta.url), "utf8");
  const 타입 = source.slice(
    source.indexOf("export type DismissalStore"),
    source.indexOf("export const DISMISSAL_STORAGE_PREFIX")
  );
  assert.ok(타입.includes("removeItem"), "치우는 칸까지 사라졌다 — 옛 기록이 영영 남는다");
  assert.ok(!/\bsetItem\b/.test(타입), "저장소에 적는 칸이 다시 생겼다");
  assert.ok(!/\bgetItem\b/.test(타입), "저장소에서 읽는 칸이 다시 생겼다");

  // 🔴 본문 어디에도 적거나 읽는 부름이 없다. (글자 `localStorage` 자체는
  //    주석에 남아 있다 — 걷어낸 경위를 적어 둔 자리라 지우지 않는다.)
  assert.ok(!/store\.setItem|store\.getItem/.test(source), "저장소를 다시 읽거나 적고 있다");
  assert.ok(!/window\./.test(source), "이 순수 모듈이 브라우저 전역을 직접 만진다");
});

// ─────────────────────────── 3. 옛 기록 치우기 — 한 번 돌고 조용히 끝난다

test("🔴 **우리 열쇠만** 치운다 — 앞머리가 다른 칸은 한 글자도 안 건드린다", () => {
  // 🔴 `seen.v1.` 은 **지금도 쓰인다**(컴퓨터·폰 알림창이 「이미 띄운 줄」을
  //    적어 두는 자리 — notification-toast.ts). 한 글자 차이라 함께 쓸려 가면
  //    같은 알림이 다시 한 번 폰에 뜬다.
  const { store, 이름들 } = 가짜저장소({
    [옛칸("user-a", 100)]: "[]",
    [옛칸("user-a", 200)]: '["A:1"]',
    "dss.notifications.seen.v1.user-a": "[]",
    "dss.notifications.dismissedX": "x",
    "남의 앱 칸": "x",
  });

  const 치운것 = purgeStoredDismissals(store);

  assert.deepEqual(치운것.sort(), [옛칸("user-a", 100), 옛칸("user-a", 200)].sort());
  assert.deepEqual(
    이름들().sort(),
    ["dss.notifications.seen.v1.user-a", "dss.notifications.dismissedX", "남의 앱 칸"].sort(),
    "남의 칸이 함께 치워졌다"
  );
});

test("🔴 **남의 것도 옛 판도 가리지 않고** 전부 치운다 — 영영 안 쓰이는 칸이다", () => {
  // 옛 함수(pruneOldDismissalKeys)는 「같은 사람의 옛 로그인 칸」만 치우고 지금
  // 쓰는 것 하나와 남의 것은 남겼다. 이제 **쓰는 칸이 하나도 없으므로** 남길
  // 까닭도 없다 — 공용 PC 에 앞사람 것이 몇 해씩 쌓여 있다.
  const 처음: Record<string, string> = {};
  for (let i = 0; i < 40; i += 1) 처음[옛칸("user-a", i)] = "[]";
  for (let i = 0; i < 10; i += 1) 처음[옛칸("user-b", i)] = "[]";
  // 판이 올라간 뒤의 모양도, 사람·시각이 안 붙은 모양도 함께 쓸려 가야 한다.
  처음[`${DISMISSAL_STORAGE_PREFIX}v2.user-a.1`] = "[]";
  처음[DISMISSAL_STORAGE_PREFIX] = "[]";
  처음["남의 앱 칸"] = "x";

  const { store, 이름들 } = 가짜저장소(처음);
  const 치운것 = purgeStoredDismissals(store);

  // 🔴 **하나도 안 남는다.** 지우면서 훑으면 뒤 칸 번호가 당겨져 절반만
  //    치워진다 — 그래도 오류가 안 나서 아무도 모른다.
  assert.equal(치운것.length, 52);
  assert.deepEqual(이름들(), ["남의 앱 칸"]);
});

test("치울 것이 없으면 아무 일도 아니고, 저장소가 없거나 터져도 던지지 않는다", () => {
  const { store, 이름들 } = 가짜저장소({ "dss.notifications.seen.v1.user-a": "[]" });

  assert.deepEqual(purgeStoredDismissals(store), []);
  assert.deepEqual(이름들(), ["dss.notifications.seen.v1.user-a"]);

  // 사생활 보호 창 · 저장을 막아 둔 브라우저. 못 치워도 잃는 것이 없다.
  assert.doesNotThrow(() => purgeStoredDismissals(터지는저장소));
  assert.deepEqual(purgeStoredDismissals(터지는저장소), []);
  assert.deepEqual(purgeStoredDismissals(null), []);
});

test("🔴 앞머리에 판 번호를 넣지 않는다 — 넣으면 옛 판이 영영 남는다", () => {
  // 옛 칸 이름은 `…dismissed.v1.{userId}.{issuedAt}` 이었다. 앞머리를 `v1.`
  // 까지로 잡으면 그 뒤에 올라간 판은 걸리지 않는다.
  assert.equal(DISMISSAL_STORAGE_PREFIX, "dss.notifications.dismissed.");
  assert.ok(옛칸("user-a", 1).startsWith(DISMISSAL_STORAGE_PREFIX));
  assert.ok(!DISMISSAL_STORAGE_PREFIX.includes("v1"));
  // 🔴 옆 기능의 칸과 섞이지 않는다.
  assert.ok(!"dss.notifications.seen.v1.user-a".startsWith(DISMISSAL_STORAGE_PREFIX));
});
