import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_REFRESH_INTERVAL_MS,
  decideNotificationToasts,
  describeBrowserNotificationStatus,
  notificationSeenStorageKey,
  readSeenNotificationKeys,
  resolveBrowserNotificationStatus,
  shouldRefreshNotifications,
  writeSeenNotificationKeys,
  type SeenKeyStore,
} from "./notification-toast";
import {
  buildApprovalNotification,
  buildPartStockBelowMinimumNotification,
  buildPendingPartRequestNotification,
  type NotificationItem,
} from "./notifications";

/**
 * ============================================================================
 * 브라우저 알림 — 무엇을 띄울지 정하는 계산
 * ============================================================================
 * 여기서 지키려는 것은 하나다: **같은 알림이 반복해서 뜨지 않는다.** 새로고침
 * 할 때마다 알림창이 쏟아지면 사람들은 그 기능을 꺼 버리고, 한 번 꺼진 알림은
 * 브라우저 설정을 뒤져야 되돌아온다.
 * ============================================================================
 */

function approval(repairCaseId: string, intakeNumber: string, approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT") {
  return buildApprovalNotification({ repairCaseId, intakeNumber, approvalType });
}

function partRequest(requestId: string) {
  return buildPendingPartRequestNotification({
    requestId,
    intakeNumber: "D9705-100",
    requestedByName: "홍길동",
  });
}

function lowStock(partId: string, currentQuantity: number) {
  return buildPartStockBelowMinimumNotification({
    partId,
    partName: "커넥터 SMA",
    owner: "DSS",
    currentQuantity,
    minimumQuantity: 30,
  });
}

function keysOf(items: readonly NotificationItem[]): string[] {
  return items.map((item) => item.id);
}

// ───────────────────────────────────────────────────── 무엇을 새것으로 보는가

test("🔴 처음에는 쌓여 있던 것을 하나도 띄우지 않고 '이미 본 것'으로 적어 두기만 한다", () => {
  // 종에 21건이 떠 있는 상태로 처음 켜는 일이 실제로 있다. 그때 21개가 한꺼번에
  // 뜨면 그것이 곧 폭탄이다.
  const items = [approval("case-1", "D9705-012", "REPAIR_INSPECTION"), partRequest("req-1"), lowStock("part-1", 15)];
  const decision = decideNotificationToasts(items, null);

  assert.deepEqual(decision.toShow, [], "첫 방문에는 아무것도 띄우지 않는다");
  assert.deepEqual(decision.nextSeenKeys, keysOf(items), "대신 지금 있는 것을 전부 적어 둔다");
});

test("🔴 같은 목록을 두 번 줘도 두 번째에는 아무것도 띄우지 않는다", () => {
  const items = [approval("case-1", "D9705-012", "REPAIR_INSPECTION"), partRequest("req-1")];

  const first = decideNotificationToasts(items, null);
  const second = decideNotificationToasts(items, first.nextSeenKeys);
  const third = decideNotificationToasts(items, second.nextSeenKeys);

  assert.deepEqual(second.toShow, [], "화면만 새로 그렸는데 다시 뜨면 안 된다");
  assert.deepEqual(third.toShow, [], "몇 번을 다시 그려도 마찬가지다");
});

test("🔴 하나가 사라지고 하나가 생기면 개수가 같아도 새것을 띄운다", () => {
  // 개수만 비교하는 방식이 못 잡는 바로 그 경우다.
  const before = [partRequest("req-1"), partRequest("req-2")];
  const after = [partRequest("req-2"), partRequest("req-3")];

  const first = decideNotificationToasts(before, null);
  const second = decideNotificationToasts(after, first.nextSeenKeys);

  assert.equal(before.length, after.length, "개수는 그대로다");
  assert.deepEqual(keysOf(second.toShow), [partRequest("req-3").id], "새로 생긴 것만 뜬다");
});

test("🔴 사라진 알림은 기억에서도 지운다 — 다시 생기면 그것은 다시 알려야 할 새 일이다", () => {
  // 재고를 채워 알림이 없어졌다가 다시 떨어진 경우. 이미 알린 일이 아니라 다시
  // 생긴 일이므로 다시 울려야 한다.
  const shortage = [lowStock("part-1", 15)];

  const first = decideNotificationToasts(shortage, null);
  const refilled = decideNotificationToasts([], first.nextSeenKeys);
  assert.deepEqual(refilled.nextSeenKeys, [], "사라진 것은 적어 둔 것에서도 빠진다");

  const again = decideNotificationToasts(shortage, refilled.nextSeenKeys);
  assert.deepEqual(keysOf(again.toShow), keysOf(shortage), "다시 떨어졌으면 다시 알린다");
});

test("지난번이 0건이었던 것과 적어 둔 것이 아예 없는 것은 다르다", () => {
  const items = [partRequest("req-1")];

  // 빈 배열 = "지난번에는 알림이 0건이었다". 그 뒤에 생긴 것은 새것이다.
  assert.deepEqual(keysOf(decideNotificationToasts(items, []).toShow), keysOf(items));
  // null = "적어 둔 것이 없다"(첫 방문·저장소 접근 실패). 그때는 조용하다.
  assert.deepEqual(decideNotificationToasts(items, null).toShow, []);
});

test("🔴 열쇠는 targetKey가 아니라 id다 — 한 접수 건에 결재가 둘이면 둘 다 알린다", () => {
  // 배지는 이 둘을 1건으로 센다(targetKey가 접수 건 id라서). 세는 일에는 그게
  // 맞지만, 검수 승인이 걸려 있는 동안 출하 승인이 새로 붙은 것은 실제로 따로
  // 눌러야 하는 새 일이다.
  const inspection = approval("case-1", "D9705-012", "REPAIR_INSPECTION");
  const shipment = approval("case-1", "D9705-012", "FINAL_SHIPMENT");
  assert.equal(inspection.targetKey, shipment.targetKey, "targetKey는 같다");

  const first = decideNotificationToasts([inspection], null);
  const second = decideNotificationToasts([inspection, shipment], first.nextSeenKeys);

  assert.deepEqual(keysOf(second.toShow), [shipment.id], "새로 붙은 결재가 조용히 묻히지 않는다");
});

test("재고 수량만 흔들리는 것은 새 알림이 아니다", () => {
  // id가 (품번, 소유자)라 15 → 14로 줄어도 그대로다. 수량이 내려갈 때마다 다시
  // 울리면 부족한 동안 내내 시끄럽다.
  const first = decideNotificationToasts([lowStock("part-1", 15)], null);
  const second = decideNotificationToasts([lowStock("part-1", 14)], first.nextSeenKeys);

  assert.deepEqual(second.toShow, [], "같은 (품번, 소유자)의 부족은 한 번만 알린다");
});

test("같은 알림이 목록에 두 번 들어와도 한 번만 띄우고 한 번만 적는다", () => {
  const item = partRequest("req-1");
  const decision = decideNotificationToasts([item, item], []);

  assert.deepEqual(keysOf(decision.toShow), [item.id]);
  assert.deepEqual(decision.nextSeenKeys, [item.id]);
});

// ─────────────────────────────────────────────── 그 브라우저에 적어 두는 일

/** localStorage 흉내. 필요하면 읽기/쓰기가 던지게 만든다. */
function fakeStore(options?: { getThrows?: boolean; setThrows?: boolean; initial?: string }): SeenKeyStore & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      if (options?.getThrows) throw new Error("저장소 접근이 막혀 있다");
      if (options?.initial !== undefined && !values.has(key)) return options.initial;
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (options?.setThrows) throw new Error("저장 공간이 없다");
      values.set(key, value);
    },
  };
}

test("🔴 저장소가 터져도 던지지 않는다 — 알림 하나 때문에 화면이 죽으면 안 된다", () => {
  // 사생활 보호 창이나 저장을 막아 둔 브라우저에서는 접근 자체가 터진다.
  const reading = fakeStore({ getThrows: true });
  const writing = fakeStore({ setThrows: true });

  assert.equal(readSeenNotificationKeys(reading, "k"), null, "못 읽었으면 적어 둔 것이 없는 것과 같다");
  assert.doesNotThrow(() => writeSeenNotificationKeys(writing, "k", ["a"]));
});

test("저장소를 아예 못 얻었을 때(null)도 조용히 넘어간다", () => {
  assert.equal(readSeenNotificationKeys(null, "k"), null);
  assert.doesNotThrow(() => writeSeenNotificationKeys(null, "k", ["a"]));
});

test("못 읽었을 때는 폭탄이 아니라 침묵 쪽으로 기운다", () => {
  // 못 읽음 → null → 첫 방문 규칙 → 아무것도 띄우지 않는다. 반대로 "빈 배열"로
  // 다뤘다면 저장소가 막힌 브라우저에서 새로고침마다 전부 뜬다.
  const items = [approval("case-1", "D9705-012", "REPAIR_INSPECTION"), partRequest("req-1")];
  const seen = readSeenNotificationKeys(fakeStore({ getThrows: true }), "k");

  assert.deepEqual(decideNotificationToasts(items, seen).toShow, []);
});

test("적어 둔 것을 그대로 다시 읽는다", () => {
  const store = fakeStore();
  writeSeenNotificationKeys(store, "k", ["a", "b"]);

  assert.deepEqual(readSeenNotificationKeys(store, "k"), ["a", "b"]);
});

test("적어 둔 값이 깨져 있으면 첫 방문처럼 다룬다", () => {
  for (const broken of ["", "{", "null", '"a"', "123", '{"a":1}', "[1,2]", '["a",2]']) {
    const store = fakeStore();
    store.values.set("k", broken);
    assert.equal(readSeenNotificationKeys(store, "k"), null, `깨진 값: ${broken}`);
  }
});

test("🔴 로그인한 사람마다 갈라 적는다 — 공용 PC에서 앞사람이 본 것을 뒷사람이 못 받으면 안 된다", () => {
  const mine = notificationSeenStorageKey("user-1");
  const yours = notificationSeenStorageKey("user-2");

  assert.notEqual(mine, yours);
  assert.ok(mine.includes("user-1"));

  const store = fakeStore();
  writeSeenNotificationKeys(store, mine, ["already-seen"]);
  assert.equal(readSeenNotificationKeys(store, yours), null, "다른 사람에게는 첫 방문이다");
});

// ─────────────────────────────────────── 이 브라우저가 띄울 수 있는가

test("🔴 보안 접속이 아니면 물어봐야 소용없는 상태로 본다", () => {
  const status = resolveBrowserNotificationStatus({
    isSecureContext: false,
    hasNotificationApi: false,
    permission: null,
  });
  assert.equal(status, "INSECURE_CONTEXT");

  const notice = describeBrowserNotificationStatus(status);
  assert.equal(notice.canAsk, false, "눌러도 아무 일이 없는 단추를 그리면 고장으로 여긴다");
  assert.equal(notice.message, "이 기기에서는 알림을 띄울 수 없습니다 — 보안 접속(HTTPS)이 아닙니다.");
});

test("🔴 '이 시스템은 http니까 안 된다'고 단정하지 않는다 — 이미 허락받았으면 그것이 곧 된다는 증거다", () => {
  // 몇몇 폰은 Chrome 설정에 예외를 걸어 두어 이 주소를 보안 컨텍스트로 취급한다.
  // 그 기기에서 실제로 뜨고 있는데 안 된다고 적으면 그것이 거짓말이 된다.
  assert.equal(
    resolveBrowserNotificationStatus({ isSecureContext: false, hasNotificationApi: true, permission: "granted" }),
    "GRANTED"
  );
});

test("보안 접속인데 알림 기능이 없는 브라우저는 따로 말한다", () => {
  const status = resolveBrowserNotificationStatus({
    isSecureContext: true,
    hasNotificationApi: false,
    permission: null,
  });
  assert.equal(status, "UNSUPPORTED");
  assert.equal(describeBrowserNotificationStatus(status).canAsk, false);
  assert.ok(describeBrowserNotificationStatus(status).message?.includes("알림 기능"));
});

test("아직 묻지 않았을 때만 물어볼 수 있다", () => {
  assert.equal(
    resolveBrowserNotificationStatus({ isSecureContext: true, hasNotificationApi: true, permission: "default" }),
    "ASKABLE"
  );
  assert.equal(describeBrowserNotificationStatus("ASKABLE").canAsk, true);
  assert.equal(describeBrowserNotificationStatus("ASKABLE").message, null, "묻기 전에 겁줄 말은 없다");
});

test("한 번 거절당하면 다시 묻지 않고 되돌리는 법을 알려 준다", () => {
  const status = resolveBrowserNotificationStatus({
    isSecureContext: true,
    hasNotificationApi: true,
    permission: "denied",
  });
  assert.equal(status, "DENIED");

  const notice = describeBrowserNotificationStatus(status);
  assert.equal(notice.canAsk, false, "다시 물어도 브라우저가 창을 띄우지 않는다");
  assert.ok(notice.message?.includes("브라우저 설정"));
});

test("허락받았거나 아직 물어보기 전이면 화면에 할 말이 없다", () => {
  for (const status of ["GRANTED", "UNKNOWN"] as const) {
    const notice = describeBrowserNotificationStatus(status);
    assert.equal(notice.message, null, status);
    assert.equal(notice.canAsk, false, status);
  }
});

// ─────────────────────────────────────────────────────────────── 다시 세기

test("🔴 다시 세는 주기는 1분보다 짧지 않다", () => {
  // 한 번 세는 데 조회가 여러 개 돈다 — 주기가 곧 서버 부담이다.
  assert.ok(NOTIFICATION_REFRESH_INTERVAL_MS >= 60_000, `${NOTIFICATION_REFRESH_INTERVAL_MS}ms 는 너무 잦다`);
});

test("화면이 보이고 입력 중이 아니면 다시 센다", () => {
  assert.equal(
    shouldRefreshNotifications({
      visibilityState: "visible",
      focusedTagName: null,
      focusedIsContentEditable: false,
    }),
    true
  );
});

test("🔴 화면이 안 보이는 동안은 서버를 두드리지 않는다", () => {
  for (const visibilityState of ["hidden", "prerender"]) {
    assert.equal(
      shouldRefreshNotifications({ visibilityState, focusedTagName: null, focusedIsContentEditable: false }),
      false,
      visibilityState
    );
  }
});

test("🔴 글자를 치는 중이면 다시 세지 않는다 — 다음 주기에 따라잡는다", () => {
  for (const focusedTagName of ["INPUT", "TEXTAREA"]) {
    assert.equal(
      shouldRefreshNotifications({ visibilityState: "visible", focusedTagName, focusedIsContentEditable: false }),
      false,
      focusedTagName
    );
  }
  assert.equal(
    shouldRefreshNotifications({
      visibilityState: "visible",
      focusedTagName: "DIV",
      focusedIsContentEditable: true,
    }),
    false,
    "contenteditable도 글자를 치는 자리다"
  );
});

test("고르개(SELECT)와 단추는 막지 않는다 — 다시 그려도 잃을 것이 없다", () => {
  for (const focusedTagName of ["SELECT", "BUTTON", "A", "BODY"]) {
    assert.equal(
      shouldRefreshNotifications({ visibilityState: "visible", focusedTagName, focusedIsContentEditable: false }),
      true,
      focusedTagName
    );
  }
});
