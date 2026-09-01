import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS,
  NOTIFICATION_REFRESH_INTERVAL_MS,
  NOTIFICATION_REFRESH_MIN_GAP_MS,
  NOTIFICATION_TOAST_ICON,
  buildNotificationSelfTestToast,
  buildNotificationToast,
  decideNotificationToasts,
  describeBrowserNotificationStatus,
  describeNotificationToastFailure,
  describeNotificationToastOutcome,
  notificationSeenStorageKey,
  readSeenNotificationKeys,
  resolveBrowserNotificationStatus,
  resolveNotificationToastChannel,
  shouldRefreshNotifications,
  shouldRefreshNotificationsNow,
  writeSeenNotificationKeys,
  type NotificationRefreshTrigger,
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

// ───────────────────────────────────────────── 어느 통로로 띄우는가

/**
 * 신고 ①("폰에서 알림이 안 뜬다")의 정체. 안드로이드 Chrome은 페이지에서 직접
 * 만드는 알림을 금지하고 `Illegal constructor`를 던진다 — 서비스워커가 없으면
 * 폰에서는 무엇을 해도 안 뜬다.
 */
test("🔴 서비스워커 등록이 있으면 그 통로로 띄운다 — 안드로이드에서 되는 유일한 길이다", () => {
  assert.equal(
    resolveNotificationToastChannel({
      hasServiceWorkerRegistration: true,
      hasNotificationConstructor: true,
    }),
    "SERVICE_WORKER"
  );
  // 생성자가 아예 없는 안드로이드에서도 서비스워커만 있으면 뜬다.
  assert.equal(
    resolveNotificationToastChannel({
      hasServiceWorkerRegistration: true,
      hasNotificationConstructor: false,
    }),
    "SERVICE_WORKER"
  );
});

test("🔴 서비스워커가 없고 생성자만 있으면 페이지 통로로 넘어간다", () => {
  // 등록이 실패하는 환경(보안 접속이 아닌 곳, 서비스워커를 끈 브라우저)에서도
  // 데스크톱이라면 종전 방식으로 뜬다 — 서비스워커를 붙이면서 되던 것이
  // 안 되게 만들지 않는다.
  assert.equal(
    resolveNotificationToastChannel({
      hasServiceWorkerRegistration: false,
      hasNotificationConstructor: true,
    }),
    "PAGE"
  );
});

test("🔴 둘 다 없으면 '불가'다 — 조용히 아무 일도 안 한 척하지 않는다", () => {
  assert.equal(
    resolveNotificationToastChannel({
      hasServiceWorkerRegistration: false,
      hasNotificationConstructor: false,
    }),
    "UNAVAILABLE"
  );
});

// ────────────────────────────────────── 브라우저에 무엇을 넘기는가

function toastFor(item: NotificationItem) {
  return buildNotificationToast({
    title: `알림 · ${item.subject}`,
    body: item.detail,
    tag: item.id,
    href: item.href,
  });
}

test("🔴 renotify가 켜져 있고 tag가 함께 있다 — 신고 ②의 처방이다", () => {
  // 같은 tag의 알림이 오면 브라우저는 기존 것을 **조용히 대체**한다(renotify
  // 기본값 false). 소리도 팝업도 없다. 그리고 renotify는 tag 없이 주면 브라우저가
  // 던지므로 둘은 반드시 함께 간다.
  const toast = toastFor(lowStock("part-1", 15));

  assert.equal(toast.options.renotify, true, "다시 알리지 않으면 알림창에 아무 일도 안 일어난다");
  assert.equal(typeof toast.options.tag, "string");
  assert.ok(toast.options.tag.length > 0, "renotify를 빈 tag와 함께 주면 브라우저가 던진다");
});

test("🔴 사라졌다 다시 생긴 재고 부족은 tag가 같다 — 그래서 renotify가 있어야 한다", () => {
  // 판정 쪽은 멀쩡하다: 사라진 것은 기억에서 지워지고 다시 생기면 새것으로
  // 골라낸다. 문제는 브라우저에 넘기는 순간에만 있었다.
  const shortage = [lowStock("part-1", 15)];
  const first = decideNotificationToasts(shortage, null);
  const refilled = decideNotificationToasts([], first.nextSeenKeys);
  const again = decideNotificationToasts(shortage, refilled.nextSeenKeys);

  assert.equal(again.toShow.length, 1, "판정은 다시 알릴 것으로 골라낸다");

  const before = toastFor(shortage[0]);
  const after = toastFor(again.toShow[0]);
  assert.equal(after.options.tag, before.options.tag, "재고 부족의 id는 사라졌다 생겨도 그대로다");
  assert.equal(after.options.renotify, true, "그래도 다시 울려야 한다 — 이것이 없으면 조용히 덮어쓴다");
});

test("아이콘과 클릭 주소를 함께 실어 보낸다", () => {
  const item = approval("case-1", "D9705-012", "REPAIR_INSPECTION");
  const toast = toastFor(item);

  assert.equal(toast.options.icon, NOTIFICATION_TOAST_ICON, "폰 알림창은 아이콘 자리가 비면 볼품이 없다");
  // 서비스워커로 띄우면 클릭이 페이지가 아니라 서비스워커에 닿는다 — 갈 곳을
  // 알림에 실어 보내지 않으면 눌러도 아무 데도 못 간다.
  assert.equal(toast.options.data.href, item.href);
});

test("제목과 본문은 받은 그대로 넘어간다", () => {
  const toast = buildNotificationToast({ title: "제목", body: "본문", tag: "t", href: "/x" });

  assert.equal(toast.title, "제목");
  assert.equal(toast.options.body, "본문");
});

test("🔴 시험 알림도 같은 규칙을 따른다 — 두 번 눌러도 두 번 울린다", () => {
  const toast = buildNotificationSelfTestToast();

  assert.equal(toast.options.renotify, true);
  assert.ok(toast.options.tag.length > 0);
  assert.ok(toast.title.length > 0);
  assert.ok(toast.options.body.length > 0, "무엇을 확인하는 알림인지 알림창에도 적혀야 한다");
});

// ──────────────────────────────────── 못 띄웠을 때 뭐라고 말하는가

test("🔴 안드로이드의 `Illegal constructor`를 사람이 읽을 말로 바꾼다", () => {
  // 이 예외를 빈 catch가 삼킨 것이 이 문제가 몇 세션째 진단되지 않은 원인이다.
  const message = describeNotificationToastFailure(
    new TypeError(
      "Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."
    )
  );

  assert.ok(!message.includes("Illegal constructor"), "영어 예외 원문만 보여 주면 그냥 고장으로 읽힌다");
  assert.ok(message.includes("서비스워커"), "무엇이 있어야 되는지까지 말해야 한다");
});

test("권한이 없어서 못 띄운 것은 되돌리는 법을 알려 준다", () => {
  const message = describeNotificationToastFailure(new Error("NotAllowedError: permission denied"));
  assert.ok(message.includes("브라우저 설정"));
});

test("renotify를 tag 없이 준 실수도 알아볼 수 있게 바꾼다", () => {
  const message = describeNotificationToastFailure(
    new TypeError("Notifications which set the renotify flag must specify a non-empty tag")
  );
  assert.ok(message.includes("태그"));
  assert.ok(!message.includes("renotify flag"), "원문만으로는 무슨 말인지 알기 어렵다");
});

test("모르는 까닭은 원문을 붙여 둔다 — 숨기는 것보다 낫다", () => {
  const message = describeNotificationToastFailure(new Error("무언가 알 수 없는 실패"));
  assert.ok(message.includes("무언가 알 수 없는 실패"));
});

test("🔴 무엇을 던져도 던지지 않고 글자 하나를 돌려준다", () => {
  // 브라우저가 던지는 것이 Error라는 보장이 없다. 여기서 터지면 알림 하나
  // 때문에 화면이 죽는다.
  const thrown: unknown[] = [new Error(""), "", null, undefined, 0, {}, [], Object.create(null)];

  for (const value of thrown) {
    const message = describeNotificationToastFailure(value);
    assert.equal(typeof message, "string", `${String(typeof value)} 에서 글자가 안 나왔다`);
    assert.ok(message.length > 0);
  }
});

test("띄웠을 때도 다음에 볼 곳을 함께 알려 준다", () => {
  // 브라우저는 "띄웠다"까지만 안다. 그 뒤에 기기의 알림 설정이나 방해 금지가
  // 가로막으면 **아무 오류 없이** 안 보인다.
  const message = describeNotificationToastOutcome({ ok: true, channel: "SERVICE_WORKER" });

  assert.ok(message.includes("서비스워커"), "어느 통로로 떴는지가 다음 진단의 출발점이다");
  assert.ok(message.includes("알림 설정"));
});

test("페이지 통로로 떴으면 그렇게 적는다", () => {
  const message = describeNotificationToastOutcome({ ok: true, channel: "PAGE" });
  assert.ok(message.includes("페이지"));
});

test("🔴 못 띄웠으면 까닭을 그대로 내보인다 — 삼키지 않는다", () => {
  const message = describeNotificationToastOutcome({ ok: false, reason: "이러이러해서 못 띄웠습니다." });
  assert.equal(message, "이러이러해서 못 띄웠습니다.");
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

test("이 판정은 **보고 있는 화면**의 규칙이다 — 안 보이면 여기서는 닫힌다", () => {
  // 🔴 이름이 바뀐 시험이다. 예전 이름은 "화면이 안 보이는 동안은 서버를 두드리지
  // 않는다"였는데 그것은 이제 사실이 아니다 — 창을 최소화해 두어도 새 알림이
  // 뜨게 하려고 숨은 상태의 주기(INTERVAL)를 열었다. 그 길은
  // shouldRefreshNotificationsNow가 따로 내고 이 문을 지나지 않는다(아래
  // "🔴 화면이 안 보여도 주기는 돈다" 시험).
  //
  // 이 함수 자체는 종전 그대로다: 보고 있는 사람을 방해하지 않는가만 본다.
  // 그러니 안 보이는 화면에는 여전히 false다 — 물을 사람이 없으니 물을 것도 없다.
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

// ──────────────────────────────── 주기를 기다리지 않고 즉시 다시 세기

/**
 * 아무것도 막지 않는 평범한 화면 — 보이고, 아무 데도 커서가 없다.
 * 여기서 갈라지는 것은 계기와 시각뿐이라 그 둘만 시험에 적는다.
 */
const IDLE_SCREEN = {
  visibilityState: "visible",
  focusedTagName: null,
  focusedIsContentEditable: false,
} as const;

/** 저절로 도는 계기 둘 — 사람이 누른 것이 아니다. */
const AUTOMATIC_TRIGGERS: readonly NotificationRefreshTrigger[] = ["INTERVAL", "VISIBLE"];

test("🔴 화면으로 돌아오면 다음 주기를 기다리지 않고 즉시 다시 센다", () => {
  // 폰은 다른 앱으로 수시로 나갔다 들어온다. 돌아와서 최대 1분을 더 기다리는
  // 것이 "새로고침해야만 알림이 바뀐다"의 정체였다.
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "VISIBLE",
      env: IDLE_SCREEN,
      lastRefreshedAt: null,
      now: 1_000_000,
    }),
    true
  );
});

test("🔴 종을 열면 즉시 다시 센다", () => {
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "BELL_OPENED",
      env: IDLE_SCREEN,
      lastRefreshedAt: null,
      now: 1_000_000,
    }),
    true
  );
});

test("🔴 최소 간격 안에 다시 오면 건너뛴다 — 앱을 여러 번 오가도 서버를 안 두드린다", () => {
  const lastRefreshedAt = 1_000_000;
  for (const trigger of ["VISIBLE", "BELL_OPENED", "INTERVAL"] as const) {
    assert.equal(
      shouldRefreshNotificationsNow({
        trigger,
        env: IDLE_SCREEN,
        lastRefreshedAt,
        // 방금 셌다. 1초 만에 또 셀 이유가 없다.
        now: lastRefreshedAt + 1_000,
      }),
      false,
      trigger
    );
    assert.equal(
      shouldRefreshNotificationsNow({
        trigger,
        env: IDLE_SCREEN,
        lastRefreshedAt,
        // 간격이 딱 차기 1ms 전까지는 막힌다.
        now: lastRefreshedAt + NOTIFICATION_REFRESH_MIN_GAP_MS - 1,
      }),
      false,
      `${trigger} — 경계 직전`
    );
  }
});

test("최소 간격이 지나면 다시 센다", () => {
  const lastRefreshedAt = 1_000_000;
  for (const trigger of ["VISIBLE", "BELL_OPENED", "INTERVAL"] as const) {
    assert.equal(
      shouldRefreshNotificationsNow({
        trigger,
        env: IDLE_SCREEN,
        lastRefreshedAt,
        now: lastRefreshedAt + NOTIFICATION_REFRESH_MIN_GAP_MS,
      }),
      true,
      trigger
    );
  }
});

test("🔴 최소 간격은 0보다 크고 주기보다 짧다", () => {
  // 0이면 연타를 막지 못해 안전장치가 없는 것과 같고, 주기보다 길면 1분 주기가
  // 제 시각에 못 돈다.
  assert.ok(NOTIFICATION_REFRESH_MIN_GAP_MS > 0, "최소 간격이 없으면 연타가 그대로 서버로 간다");
  assert.ok(
    NOTIFICATION_REFRESH_MIN_GAP_MS < NOTIFICATION_REFRESH_INTERVAL_MS,
    `${NOTIFICATION_REFRESH_MIN_GAP_MS}ms 는 주기(${NOTIFICATION_REFRESH_INTERVAL_MS}ms)를 막는다`
  );
});

test("한 사람이 1분에 다시 세는 횟수는 최소 간격이 정한 만큼을 넘지 못한다", () => {
  // 서버 부하의 최악을 이 한 줄로 셀 수 있어야 한다 — 즉시 다시 세는 계기를
  // 늘리면서 이 값이 이번 변경의 안전장치다.
  const worstCasePerMinute = Math.floor(60_000 / NOTIFICATION_REFRESH_MIN_GAP_MS);
  assert.ok(worstCasePerMinute <= 6, `1분에 최대 ${worstCasePerMinute}번은 너무 잦다`);
});

test("아직 한 번도 안 셌으면(첫 화면) 최소 간격이 막을 것이 없다", () => {
  for (const trigger of ["VISIBLE", "BELL_OPENED", "INTERVAL"] as const) {
    assert.equal(
      shouldRefreshNotificationsNow({ trigger, env: IDLE_SCREEN, lastRefreshedAt: null, now: 0 }),
      true,
      trigger
    );
  }
});

test("🔴 시계가 뒤로 가도 영영 막히지 않는다", () => {
  // 사람이 시간을 고치거나 절전에서 깨어난 기기에서 지금 시각이 마지막으로 센
  // 시각보다 앞설 수 있다. 그때 막아 버리면 시계가 따라잡을 때까지 안 세는
  // 화면이 된다.
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "VISIBLE",
      env: IDLE_SCREEN,
      lastRefreshedAt: 1_000_000,
      now: 1_000_000 - 60_000,
    }),
    true
  );
});

test("🔴 화면이 안 보이면 사람이 보고 있다는 뜻의 계기(화면 복귀·종 열기)는 돌지 않는다", () => {
  // 🔴 규칙이 바뀌어 고친 시험이다. 예전에는 "어떤 계기로도 다시 세지 않는다"였고
  // INTERVAL까지 여기 들어 있었다 — 그것 때문에 창을 최소화해 두면 새 알림이
  // 생겨도 영영 알아채지 못했다. INTERVAL은 이제 아래 시험이 "돈다"로 못 박는다.
  //
  // 나머지 둘은 그대로 막힌다. 화면 복귀도 종 열기도 **사람이 지금 화면을 보고
  // 있다**는 뜻이라, 안 보이는 화면에서 도는 것 자체가 말이 안 된다.
  for (const trigger of ["VISIBLE", "BELL_OPENED"] as const) {
    for (const visibilityState of ["hidden", "prerender"]) {
      assert.equal(
        shouldRefreshNotificationsNow({
          trigger,
          env: { ...IDLE_SCREEN, visibilityState },
          lastRefreshedAt: null,
          now: 1_000_000,
        }),
        false,
        `${trigger} / ${visibilityState}`
      );
    }
  }
});

test("🔴 화면이 안 보여도 주기는 돈다 — 창을 최소화해 두어도 새 알림이 알림창에 뜬다", () => {
  // 알림창을 띄우는 것 자체는 화면이 보이는지와 상관없다(숨은 탭에서도 잘 뜬다).
  // 막고 있던 것은 오직 "안 보이면 다시 세지 않는다"였고, 셀 것이 없으니 띄울
  // 것도 없었다. 여기가 그 문을 여는 자리다.
  for (const visibilityState of ["hidden", "prerender"]) {
    assert.equal(
      shouldRefreshNotificationsNow({
        trigger: "INTERVAL",
        env: { ...IDLE_SCREEN, visibilityState },
        lastRefreshedAt: null,
        now: 1_000_000,
      }),
      true,
      visibilityState
    );
  }
});

test("🔴 숨어 있으면 입력칸에 커서가 있어도 주기는 돈다 — 최소화된 창에서는 아무도 안 치고 있다", () => {
  // 🔴 이번 변경의 함정이다. 「입력칸에 커서가 있으면 쉰다」의 까닭은 한창 글자를
  // 치는 중에 화면이 다시 그려지면 불쾌하다는 것인데, 창이 최소화돼 있으면 치는
  // 사람이 없다. 커서는 최소화해도 그 자리에 남으므로, 이 규칙을 숨은 상태에까지
  // 적용하면 **검색칸에 커서를 둔 채 최소화한 사람은 알림을 영영 못 받는다.**
  for (const focusedTagName of ["INPUT", "TEXTAREA"]) {
    assert.equal(
      shouldRefreshNotificationsNow({
        trigger: "INTERVAL",
        env: { ...IDLE_SCREEN, visibilityState: "hidden", focusedTagName },
        lastRefreshedAt: null,
        now: 1_000_000,
      }),
      true,
      focusedTagName
    );
  }
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "INTERVAL",
      env: {
        visibilityState: "hidden",
        focusedTagName: "DIV",
        focusedIsContentEditable: true,
      },
      lastRefreshedAt: null,
      now: 1_000_000,
    }),
    true,
    "contenteditable"
  );
});

test("🔴 보이는 화면에서는 입력칸에 커서가 있으면 주기가 쉰다 — 기존 규칙 그대로다", () => {
  // 위 시험과 짝이다. 숨었을 때 입력 규칙을 안 보는 것이 "그 규칙을 없앴다"로
  // 새어 나가지 않게 여기서 못 박는다.
  for (const focusedTagName of ["INPUT", "TEXTAREA"]) {
    assert.equal(
      shouldRefreshNotificationsNow({
        trigger: "INTERVAL",
        env: { ...IDLE_SCREEN, focusedTagName },
        lastRefreshedAt: null,
        now: 1_000_000,
      }),
      false,
      focusedTagName
    );
  }
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "INTERVAL",
      env: { ...IDLE_SCREEN, focusedTagName: "DIV", focusedIsContentEditable: true },
      lastRefreshedAt: null,
      now: 1_000_000,
    }),
    false,
    "contenteditable"
  );
});

test("🔴 숨어 있는 동안의 최소 간격이 보이는 동안보다 길다", () => {
  // 숨은 탭이 서버를 두드리게 된 대가로 둔 안전장치다. 이 부등호가 뒤집히면
  // 아무도 안 보는 화면이 보고 있는 화면보다 자주 두드리게 된다.
  assert.ok(
    NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS > NOTIFICATION_REFRESH_MIN_GAP_MS,
    `숨은 간격 ${NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS}ms 는 보이는 간격 ${NOTIFICATION_REFRESH_MIN_GAP_MS}ms 보다 길어야 한다`
  );
  // 주기보다도 길다 — 숨어 있는 동안은 1분 주기가 매번 통과하지 못한다는 뜻이고,
  // 그것이 의도다(브라우저가 조이지 않는 곳에서도 상한이 걸린다).
  assert.ok(
    NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS > NOTIFICATION_REFRESH_INTERVAL_MS,
    `${NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS}ms 는 주기(${NOTIFICATION_REFRESH_INTERVAL_MS}ms)를 못 조인다`
  );
});

test("숨은 탭 하나가 한 시간에 다시 세는 횟수는 숨은 간격이 정한 만큼을 넘지 못한다", () => {
  // 서버 부하의 최악을 이 한 줄로 셀 수 있어야 한다 — 안 보는 탭을 열어 둔 사람
  // 수만큼 부담이 느는 것을 막는 값이다.
  const worstCasePerHour = Math.floor(3_600_000 / NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS);
  assert.ok(worstCasePerHour <= 20, `숨은 탭 하나가 시간당 ${worstCasePerHour}번은 너무 잦다`);
});

test("🔴 숨어 있는 동안 최소 간격 안에 주기가 또 오면 건너뛴다", () => {
  const lastRefreshedAt = 1_000_000;
  const hidden = { ...IDLE_SCREEN, visibilityState: "hidden" };

  // 보이는 간격(10초)은 지났지만 숨은 간격(3분)은 아직 안 찼다 — 숨었을 때는
  // 이 순간이 막혀야 한다. 보이는 화면이었다면 통과할 시각이라 두 값이 정말로
  // 갈라지는지가 여기서 붙잡힌다.
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "INTERVAL",
      env: hidden,
      lastRefreshedAt,
      now: lastRefreshedAt + NOTIFICATION_REFRESH_MIN_GAP_MS,
    }),
    false,
    "보이는 간격만 지난 시각"
  );
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "INTERVAL",
      env: hidden,
      lastRefreshedAt,
      now: lastRefreshedAt + NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS - 1,
    }),
    false,
    "경계 직전"
  );
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "INTERVAL",
      env: hidden,
      lastRefreshedAt,
      now: lastRefreshedAt + NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS,
    }),
    true,
    "간격이 차면 센다"
  );
});

test("🔴 저절로 도는 갱신은 글자를 치는 중이면 그대로 쉰다", () => {
  // 기존 규칙이다. 즉시 다시 세는 계기가 늘어도 이쪽은 달라지지 않는다.
  for (const trigger of AUTOMATIC_TRIGGERS) {
    for (const focusedTagName of ["INPUT", "TEXTAREA"]) {
      assert.equal(
        shouldRefreshNotificationsNow({
          trigger,
          env: { ...IDLE_SCREEN, focusedTagName },
          lastRefreshedAt: null,
          now: 1_000_000,
        }),
        false,
        `${trigger} / ${focusedTagName}`
      );
    }
    assert.equal(
      shouldRefreshNotificationsNow({
        trigger,
        env: { ...IDLE_SCREEN, focusedTagName: "DIV", focusedIsContentEditable: true },
        lastRefreshedAt: null,
        now: 1_000_000,
      }),
      false,
      `${trigger} / contenteditable`
    );
  }
});

test("🔴 종을 여는 것만은 입력 중이어도 다시 센다 — 사람이 지금 보려는 것이 그 목록이다", () => {
  // 저절로 도는 갱신을 입력 중에 미루는 것은 사람을 방해하지 않으려는 것이다.
  // 종은 반대다 — 그 사람이 직접 열었고, 여기서 건너뛰면 방금 연 패널이 낡은 채로
  // 남아 "새로고침해야만 바뀐다"가 그 자리에서 되풀이된다.
  for (const focusedTagName of ["INPUT", "TEXTAREA"]) {
    assert.equal(
      shouldRefreshNotificationsNow({
        trigger: "BELL_OPENED",
        env: { ...IDLE_SCREEN, focusedTagName },
        lastRefreshedAt: null,
        now: 1_000_000,
      }),
      true,
      focusedTagName
    );
  }
  assert.equal(
    shouldRefreshNotificationsNow({
      trigger: "BELL_OPENED",
      env: { ...IDLE_SCREEN, focusedTagName: "DIV", focusedIsContentEditable: true },
      lastRefreshedAt: null,
      now: 1_000_000,
    }),
    true,
    "contenteditable"
  );
});
