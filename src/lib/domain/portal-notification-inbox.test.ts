import { test } from "node:test";
import assert from "node:assert/strict";
import type { NotificationBellItem } from "@dss/ui";
import {
  EMPTY_PORTAL_INBOX,
  asPortalNotificationInbox,
  normalizePortalNotificationFeed,
} from "./portal-notification-inbox";

/**
 * 포털이 준 JSON 이 A/S 화면 안으로 들어오는 **유일한 문**을 지킨다.
 *
 * 여기 실려 오는 글자는 **다른 시스템들이 만든 것**이다(개선요청 · 계측기 ·
 * PO/내자 · 휴가). 그래서 이 파일이 못 박는 것은 두 가지다:
 *  1. 무엇이 들어와도 **던지지 않는다** — 이 값은 모든 화면에 딸려 오는 머리말에
 *     실린다. 여기서 던지면 알림 하나 때문에 사이트 전체가 빈 화면이 된다.
 *  2. 이상한 줄은 **그 줄만** 버린다 — 한 시스템이 한 줄을 잘못 보냈다고 나머지
 *     시스템의 알림까지 사라지면 안 된다.
 */

/** 규격서(dss-auth/docs/사이트-알림-통로.md)의 아홉 칸이 다 든 한 줄. */
function row(overrides: Partial<NotificationBellItem> = {}): Record<string, unknown> {
  return {
    key: "dss-improvements:IMPROVEMENT:7",
    sourceId: "dss-improvements",
    sourceName: "DSS 개선요청",
    id: "IMPROVEMENT:7",
    kind: "IMPROVEMENT",
    kindLabel: "검토 대기",
    subject: "IMP-2026-0031",
    detail: "검토를 기다리고 있습니다.",
    href: "http://192.168.1.132:3300/improvements/7",
    ...overrides,
  };
}

test("정상 응답 — 아홉 칸을 그대로 싣고 개수와 degraded 를 나른다", () => {
  const inbox = normalizePortalNotificationFeed({
    items: [row(), row({ key: "njlee:CAL:3", sourceId: "njlee", id: "CAL:3" })],
    count: 5,
    sources: [{ clientId: "njlee", ok: true }],
    degraded: false,
  });

  assert.equal(inbox.items.length, 2);
  assert.deepEqual(inbox.items[0], row());
  assert.equal(inbox.count, 5, "포털이 센 값이 그대로 와야 한다");
  assert.equal(inbox.degraded, false);
});

test("🔴 개수를 다시 세지 않는다 — 줄 수와 달라도 포털이 센 값이다", () => {
  // 세는 규칙이 시스템마다 다르다(A/S 는 같은 대상을 한 번만 센다). 줄 수로
  // 대신 세면 그 시스템의 종과 이 종이 서로 다른 숫자를 말한다.
  const inbox = normalizePortalNotificationFeed({ items: [row()], count: 9 });
  assert.equal(inbox.count, 9);

  const fewer = normalizePortalNotificationFeed({
    items: [row(), row({ key: "a:1" }), row({ key: "b:2" })],
    count: 1,
  });
  assert.equal(fewer.count, 1);
});

test("🔴 받은 차례를 섞지 않는다", () => {
  const keys = ["a:1", "b:2", "c:3"];
  const inbox = normalizePortalNotificationFeed({
    items: keys.map((key) => row({ key })),
    count: 3,
  });
  assert.deepEqual(
    inbox.items.map((item) => item.key),
    keys
  );
});

test("🔴 칸이 빠졌거나 글자가 아닌 줄은 **그 줄만** 빠진다", () => {
  for (const field of [
    "key",
    "sourceId",
    "sourceName",
    "id",
    "kind",
    "kindLabel",
    "subject",
    "detail",
    "href",
  ] as const) {
    const broken = row();
    delete broken[field];
    const inbox = normalizePortalNotificationFeed({
      items: [broken, row({ key: "ok:1" })],
      count: 2,
    });
    assert.deepEqual(
      inbox.items.map((item) => item.key),
      ["ok:1"],
      `${field} 가 빠진 줄이 걸러지지 않았다`
    );
    // 🔴 개수는 그대로다 — 포털이 센 값을 우리가 고쳐 세지 않는다.
    assert.equal(inbox.count, 2, `${field}: 개수를 다시 셌다`);
  }

  // 줄이 아예 객체가 아닌 경우도 같다.
  const mixed = normalizePortalNotificationFeed({
    items: [null, "줄", 7, [], row({ key: "ok:1" })],
    count: 1,
  });
  assert.deepEqual(
    mixed.items.map((item) => item.key),
    ["ok:1"]
  );
});

test("🔴 `javascript:` 같은 주소는 그 줄만 빠진다 — 남의 시스템에서 온 글자다", () => {
  const dangerous = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ];
  for (const href of dangerous) {
    const inbox = normalizePortalNotificationFeed({
      items: [row({ href }), row({ key: "ok:1" })],
      count: 2,
    });
    assert.deepEqual(
      inbox.items.map((item) => item.key),
      ["ok:1"],
      `${href} 가 통과했다`
    );
  }

  // 대조 — 포털이 실어 보내는 절대 주소와 우리 쪽 상대 주소는 그대로 통과한다.
  for (const href of ["http://192.168.1.132:3300/improvements/7", "/repair-cases/1"]) {
    const inbox = normalizePortalNotificationFeed({ items: [row({ href })], count: 1 });
    assert.equal(inbox.items.length, 1, `${href} 가 걸러졌다`);
  }
});

test("🔴 무엇이 들어와도 던지지 않고 빈 것이 된다", () => {
  for (const body of [null, undefined, 0, 7, "", "응답", true, () => {}, NaN]) {
    assert.deepEqual(
      normalizePortalNotificationFeed(body),
      EMPTY_PORTAL_INBOX,
      `${String(body)} 에서 빈 것이 나오지 않았다`
    );
  }

  // 객체이긴 한데 안이 엉뚱한 경우 — 「물어보기는 했다」라 degraded 는 거짓이다.
  assert.deepEqual(normalizePortalNotificationFeed({}), { items: [], count: 0, degraded: false });
  assert.deepEqual(normalizePortalNotificationFeed({ items: "목록", count: "셋" }), {
    items: [],
    count: 0,
    degraded: false,
  });
});

test("개수가 숫자가 아니거나 0 이하면 0 이다 — 목록은 그대로 보인다", () => {
  for (const count of ["3", null, undefined, -1, 0, NaN, Infinity, {}]) {
    const inbox = normalizePortalNotificationFeed({ items: [row()], count });
    assert.equal(inbox.count, 0, `count=${String(count)}`);
    assert.equal(inbox.items.length, 1, "개수가 이상하다고 목록까지 버리지 않는다");
  }
});

test("degraded 는 포털이 참이라고 말할 때만 참이다 — 「알림이 없다」와 다른 말이다", () => {
  assert.equal(normalizePortalNotificationFeed({ items: [], degraded: true }).degraded, true);
  for (const degraded of ["true", 1, null, undefined, {}]) {
    assert.equal(
      normalizePortalNotificationFeed({ items: [], degraded }).degraded,
      false,
      `degraded=${String(degraded)}`
    );
  }
});

test("🔴 못 물어봤을 때의 답은 얼린 상수 하나다 — 종이 useState 초깃값으로 쓴다", () => {
  assert.deepEqual(EMPTY_PORTAL_INBOX, { items: [], count: 0, degraded: true });
  assert.ok(Object.isFrozen(EMPTY_PORTAL_INBOX), "얼지 않으면 누군가 고칠 수 있다");
  // 두 번 불러도 **같은 객체**다 — 렌더마다 참조가 달라지면 안 된다.
  assert.equal(normalizePortalNotificationFeed(null), normalizePortalNotificationFeed("x"));
});

// ───────────────────────── 화면이 값을 받을 때의 마지막 한 겹

test("🔴 약속이 풀린 값이 기대한 모양이 아니면 빈 것으로 친다", () => {
  for (const value of [null, undefined, 7, "목록", true, {}, { items: "x" }, { count: 3 }]) {
    assert.deepEqual(
      asPortalNotificationInbox(value),
      EMPTY_PORTAL_INBOX,
      `${JSON.stringify(value) ?? String(value)} 에서 빈 것이 나오지 않았다`
    );
  }
});

test("모양이 맞으면 목록을 그대로 쓰고 개수만 다시 본다", () => {
  const items = [row()] as unknown as NotificationBellItem[];
  const inbox = asPortalNotificationInbox({ items, count: 4, degraded: true });

  assert.equal(inbox.items, items, "목록을 새로 만들지 않는다");
  assert.equal(inbox.count, 4);
  assert.equal(inbox.degraded, true);

  // 개수가 못 믿을 값이면 0 — 목록은 남는다(배지만 안 늘어난다).
  const odd = asPortalNotificationInbox({ items, count: "넷" });
  assert.equal(odd.count, 0);
  assert.equal(odd.items, items);
});
