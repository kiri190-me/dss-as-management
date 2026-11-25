import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_TONE_COUNT } from "@dss/ui";
import {
  absoluteNotificationHref,
  externalNotificationCount,
  toExternalNotificationItems,
} from "./notification-links";
import {
  buildApprovalNotification,
  NOTIFICATION_KINDS,
  type NotificationItem,
  type NotificationKind,
} from "./notifications";
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

  // 🔵 아래 두 시험의 경로는 **주소를 잇는 규칙만** 재는 보기다(어느 화면인지는 잴
  // 것에 없다). 2026-10-27 까지는 `/inventory` 였고, 그 주소가 13-A 에서 404 가 된 뒤
  // 살아 있는 경로로 바꿔 적었다 — 뜻은 한 글자도 달라지지 않는다. 죽은 주소를 보기로
  // 두면 「아직 그 화면이 있다」로 읽힌다.
  test("기준 주소 끝의 슬래시는 겹치지 않는다", () => {
    assert.equal(absoluteNotificationHref("/repair-cases", `${BASE}/`), `${BASE}/repair-cases`);
    assert.equal(absoluteNotificationHref("/repair-cases", `${BASE}///`), `${BASE}/repair-cases`);
  });

  test("슬래시로 시작하지 않는 경로에도 하나만 붙는다", () => {
    assert.equal(absoluteNotificationHref("repair-cases/abc", BASE), `${BASE}/repair-cases/abc`);
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
    // 🔴 둘째 줄은 **첫째와 다른 종류**여야 한다 — 같은 종류 둘이면 「종류별로 묶어
    // 다시 세우지 않는가」를 못 잰다. 2026-10-27 까지는 PART_REQUEST_PENDING 이었고,
    // 재고 알림 셋을 걷어내면서(13-C4) 살아 있는 종류로 바꿨다(kind 가 NotificationKind
    // 라 타입이 먼저 걸린다).
    const second: NotificationItem = {
      id: "QUOTE_APPROVAL_PENDING:x",
      kind: "QUOTE_APPROVAL_PENDING",
      targetKey: "x",
      subject: "S",
      detail: "D",
      href: "/quotes/x",
    };
    const out = toExternalNotificationItems([item, second], BASE);
    assert.deepEqual(
      out.map((one) => one.id),
      [item.id, second.id]
    );
  });
});

describe("색 칸 번호(tone)를 실어 보낸다", () => {
  /**
   * 🔴 2026-11-25 에 생긴 칸이다. 그 전까지 받는 쪽(포털)은 **종류 코드를 해시해**
   * 색을 집었고, 그 셈은 뜻을 모른다 — 열 종류 가운데 아홉이 A/S 의 종과 다른
   * 색으로 나왔다(실측). 사용자 요구는 「A/S 에 뜨는 색을 기준으로 맞춰 줘」였다.
   *
   * 🔵 **색이 같아지는지는 여기서 잴 수 없다.** 번호를 색으로 바꾸는 것은 묶음의
   *    CSS 이고 그것을 읽어 맞대는 일은 notification-settings.test.ts 가 한다
   *    (toneClassName ↔ toneIndex). 이 파일이 지키는 것은 **그 번호가 밖으로
   *    나가는가** 하나다 — 빠지면 그 자리에서 해시로 돌아가고 아무 오류도 없다.
   */
  const SAMPLE_HREF = "/repair-cases/sample";

  function sampleOf(kind: NotificationKind): NotificationItem {
    return { id: `${kind}:sample`, kind, targetKey: `T:${kind}`, subject: "S", detail: "D", href: SAMPLE_HREF };
  }

  test("🔴 종류마다 도메인 표의 칸 번호가 그대로 실린다", () => {
    const source = NOTIFICATION_KINDS.map(sampleOf);
    // 🔵 무엇을 재는지 먼저 세운다 — 표본이 한 종류뿐이면 「언제나 같은 수를
    //    싣는다」로도 통과하고, 번호가 하나로 쏠린 것을 못 가린다.
    assert.equal(source.length, NOTIFICATION_KINDS.length);
    const out = toExternalNotificationItems(source, BASE);
    assert.equal(out.length, source.length, "줄이 사라지거나 늘었다");
    assert.ok(
      new Set(out.map((one) => one.tone)).size >= 2,
      "번호가 전부 같다 — 표 조회가 아니라 상수를 싣고 있다"
    );

    for (const [index, item] of source.entries()) {
      assert.equal(
        out[index].tone,
        NOTIFICATION_KIND_META[item.kind].toneIndex,
        `${item.kind}: 색 칸 번호가 도메인 표와 다르다 — 받는 쪽이 해시로 아무 칸이나 집는다`
      );
    }
  });

  test("🔴 열 종류가 **하나도 빠짐없이** 번호를 갖고 나간다", () => {
    const out = toExternalNotificationItems(NOTIFICATION_KINDS.map(sampleOf), BASE);
    // 🔵 `tone` 이 선택 칸이 아니므로 타입이 먼저 막지만, 받는 쪽은 JSON 으로
    //    받는다 — 값이 `undefined` 면 그 칸은 그물을 빠져나가 조용히 사라진다.
    for (const one of out) {
      assert.equal(typeof one.tone, "number", `${one.kind}: 번호가 숫자가 아니다`);
      assert.equal(Number.isInteger(one.tone), true, `${one.kind}: ${one.tone} 는 정수가 아니다`);
      // 🔴 범위는 **묶음에서 가져다** 잰다(16 을 여기 적지 않는다). 범위 밖 번호는
      //    받는 쪽이 해시로 떨어뜨려 뜻과 어긋난 색이 되는데, 그 칸 수를 정하는
      //    곳은 묶음 하나뿐이다(@dss/ui 의 tone.ts). 🔵 그 번호가 묶음 CSS 에
      //    실제로 있는 칸인지는 notification-settings.test.ts 가 그 파일을 읽어
      //    따로 맞댄다 — 여기서는 「밖으로 나가는 값이 그 범위인가」만 본다.
      assert.ok(
        one.tone >= 0 && one.tone < NOTIFICATION_TONE_COUNT,
        `${one.kind}: ${one.tone} 는 0 … ${NOTIFICATION_TONE_COUNT - 1} 밖이다`
      );
    }
  });

  test("색 **클래스**는 여전히 나가지 않는다 — 번호만 간다", () => {
    // 🔵 표본을 **0번이 아닌 종류**로 고른다(결재 대기 = 파랑 15). 0번 종류로 재면
    //    「언제나 0 을 싣는」 고장이 이 줄을 그냥 지나간다 — 실제로 한 번 그렇게
    //    새어 나갔다(일부러 깨뜨려 보고 알았다).
    const [out] = toExternalNotificationItems([sampleOf("REPAIR_CASE_APPROVAL")], BASE);
    assert.equal("toneClassName" in out, false, "Tailwind 클래스는 받는 쪽 빌드에 없다");
    assert.notEqual(NOTIFICATION_KIND_META.REPAIR_CASE_APPROVAL.toneIndex, 0);
    assert.equal(out.tone, NOTIFICATION_KIND_META.REPAIR_CASE_APPROVAL.toneIndex);
  });
});

describe("externalNotificationCount", () => {
  /**
   * 🔴 **2026-11-06 에 뜻이 뒤집혔다. 이 시험의 이름도 함께 뒤집었다.**
   *
   * 여기에는 「같은 대상은 한 번만 센다 — A/S 의 종과 같은 규칙」이라고 적혀 있었고
   * 단언은 `1` 이었다. 그 단언은 **맞아서 영영 통과했을 것**이다 — 바뀐 것은 「A/S 의
   * 종이 무엇을 세는가」이기 때문이다. 사용자 결정으로 종이 **보이는 줄**을 세게 되어
   * (「종을 눌렀을 때 나오는 알림의 수와 알림종의 숫자가 동일했으면 좋겠어」), 「종과
   * 같은 규칙」을 지키는 모양이 줄 수가 됐다.
   */
  test("🔴 내보내는 개수는 **줄 수**다 — 한 건에 결재가 둘이면 2 다", () => {
    const repairCaseId = "22222222-2222-4222-8222-222222222222";
    const items = toExternalNotificationItems(
      [
        buildApprovalNotification({ repairCaseId, intakeNumber: "DSS-1", approvalType: "REPAIR_INSPECTION" }),
        buildApprovalNotification({ repairCaseId, intakeNumber: "DSS-1", approvalType: "FINAL_SHIPMENT" }),
      ],
      BASE
    );
    // 🔵 「무엇을 재는지」를 먼저 세운다 — 두 줄이 **같은 대상**이어야 이 시험이
    //    건 단위(1)와 줄 단위(2)를 가른다. 대상이 다르면 둘 다 2 라 공짜로 통과한다.
    assert.equal(items.length, 2);
    assert.equal(items[0].targetKey, items[1].targetKey, "두 줄이 같은 대상이 아니면 아무것도 못 가른다");
    assert.equal(
      externalNotificationCount(items),
      2,
      "🔴 건으로 세고 있다 — 다른 사이트의 종이 보이는 줄보다 적은 숫자를 찍는다"
    );
  });

  test("빈 목록은 0 · 대상이 다른 두 줄도 2 다", () => {
    assert.equal(externalNotificationCount([]), 0);
    const items = toExternalNotificationItems(
      [
        buildApprovalNotification({
          repairCaseId: "33333333-3333-4333-8333-333333333333",
          intakeNumber: "DSS-2",
          approvalType: "REPAIR_INSPECTION",
        }),
        buildApprovalNotification({
          repairCaseId: "44444444-4444-4444-8444-444444444444",
          intakeNumber: "DSS-3",
          approvalType: "REPAIR_INSPECTION",
        }),
      ],
      BASE
    );
    assert.equal(externalNotificationCount(items), 2);
  });
});
