import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  absoluteNotificationHref,
  externalNotificationCount,
  toExternalNotificationItems,
} from "./notification-links";
import { buildApprovalNotification, type NotificationItem } from "./notifications";
import { NOTIFICATION_KIND_META } from "./notification-settings";

/**
 * 🔴 다른 사이트에서 눌러도 A/S 로 와야 한다 — 이 파일이 지키는 것이 그것이다.
 * 상대경로 그대로 내보내면 포털 화면에서 누를 때 포털 안의 없는 주소로 간다.
 */

const BASE = "http://192.168.0.13:3000";

describe("absoluteNotificationHref", () => {
  test("🔴 상대경로에 기준 주소가 붙는다", () => {
    assert.equal(
      absoluteNotificationHref("/repair-cases/abc/approval", BASE),
      "http://192.168.0.13:3000/repair-cases/abc/approval"
    );
  });

  test("기준 주소 끝의 슬래시는 겹치지 않는다", () => {
    assert.equal(absoluteNotificationHref("/inventory", `${BASE}/`), `${BASE}/inventory`);
    assert.equal(absoluteNotificationHref("/inventory", `${BASE}///`), `${BASE}/inventory`);
  });

  test("슬래시로 시작하지 않는 경로에도 하나만 붙는다", () => {
    assert.equal(absoluteNotificationHref("inventory/requests", BASE), `${BASE}/inventory/requests`);
  });

  test("🔴 `//남의사이트` 는 남의 사이트로 가지 않는다 — 앞의 슬래시를 한 칸으로 줄인다", () => {
    // 프로토콜 상대 주소. 그대로 두면 브라우저가 https://evil.example 로 읽는다.
    assert.equal(absoluteNotificationHref("//evil.example/x", BASE), `${BASE}/evil.example/x`);
  });

  test("이미 절대 주소면 손대지 않는다", () => {
    assert.equal(absoluteNotificationHref("https://other.example/a", BASE), "https://other.example/a");
  });

  test("🔴 기준 주소가 비면 조용히 상대경로를 돌려주지 않고 던진다", () => {
    assert.throws(() => absoluteNotificationHref("/x", ""), /기준 주소/);
    assert.throws(() => absoluteNotificationHref("/x", "///"), /기준 주소/);
  });
});

describe("toExternalNotificationItems", () => {
  const item = buildApprovalNotification({
    repairCaseId: "11111111-1111-4111-8111-111111111111",
    intakeNumber: "DSS-2026-0001",
    approvalType: "REPAIR_INSPECTION",
  });

  test("🔴 링크가 절대 주소로 나온다 — 원래 값은 상대경로다", () => {
    assert.ok(item.href.startsWith("/"), "원본은 상대경로여야 한다(도메인 빌더는 그대로 둔다)");
    const [out] = toExternalNotificationItems([item], BASE);
    assert.equal(out.href, `${BASE}${item.href}`);
  });

  test("사람이 읽는 종류 이름이 함께 나간다 — 받는 쪽은 A/S 의 코드표를 모른다", () => {
    const [out] = toExternalNotificationItems([item], BASE);
    assert.equal(out.kindLabel, NOTIFICATION_KIND_META.REPAIR_CASE_APPROVAL.label);
  });

  test("나머지 칸은 그대로 실린다", () => {
    const [out] = toExternalNotificationItems([item], BASE);
    assert.equal(out.id, item.id);
    assert.equal(out.kind, item.kind);
    assert.equal(out.targetKey, item.targetKey);
    assert.equal(out.subject, item.subject);
    assert.equal(out.detail, item.detail);
  });

  test("🔴 Tailwind 클래스(toneClassName)는 나가지 않는다 — 남의 빌드에는 그 클래스가 없다", () => {
    const [out] = toExternalNotificationItems([item], BASE);
    assert.ok(!("toneClassName" in out), "색 클래스를 내보내면 받는 쪽에서 조용히 색이 안 나온다");
  });

  test("순서를 바꾸지 않는다", () => {
    const second: NotificationItem = {
      id: "PART_REQUEST_PENDING:x",
      kind: "PART_REQUEST_PENDING",
      targetKey: "x",
      subject: "S",
      detail: "D",
      href: "/inventory/requests",
    };
    const out = toExternalNotificationItems([item, second], BASE);
    assert.deepEqual(
      out.map((one) => one.id),
      [item.id, second.id]
    );
  });
});

describe("externalNotificationCount", () => {
  test("같은 대상은 한 번만 센다 — A/S 의 종과 같은 규칙", () => {
    const repairCaseId = "22222222-2222-4222-8222-222222222222";
    const items = toExternalNotificationItems(
      [
        buildApprovalNotification({ repairCaseId, intakeNumber: "DSS-1", approvalType: "REPAIR_INSPECTION" }),
        buildApprovalNotification({ repairCaseId, intakeNumber: "DSS-1", approvalType: "FINAL_SHIPMENT" }),
      ],
      BASE
    );
    assert.equal(items.length, 2);
    assert.equal(externalNotificationCount(items), 1);
  });
});
