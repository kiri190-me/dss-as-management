import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  badgeDraftFromView,
  badgeDraftKey,
  badgeViewSignature,
  changedBadgePlacements,
} from "./badge-visibility-draft";
import {
  BADGES,
  BADGE_PLACEMENTS,
  findBadgePlace,
  type BadgePlacement,
} from "@/lib/domain/badge-visibility";
import type { BadgeVisibilityBadgeView } from "@/lib/db/queries/badge-visibility-settings";

/**
 * ============================================================================
 * [배지 표시] 탭의 체크 상태 규칙 (2026-11-13, 조각 2)
 * ============================================================================
 * 재는 것 셋:
 *  ① 처음 체크 상태가 **서버가 넘긴 값 그대로**인가(29칸 전부).
 *  ② 🔴 **바뀐 쌍만** 보내는가 — 29개를 통째로 보내면 다른 관리자가 그 사이에 바꿔
 *     둔 자리를 내 화면의 옛 값으로 덮어쓴다.
 *  ③ 🔴 서버 값이 **안 바뀌었을 때** 지문이 같은가 — 저장이 실패한 뒤 사람이 고쳐
 *     둔 체크가 날아가면 안 된다(실패 문장을 읽고 다시 누르려는데 체크가 전부
 *     되돌아가 있는 모양이다).
 *
 * ── 표본을 등록부에서 만든다 ────────────────────────────────────────────
 * 🔵 자료는 **진짜 등록부**(BADGES)로 만든다. 손으로 지어낸 두 줄로 재면 「29칸」도
 * 「자리마다 따로」도 아무것도 안 잰다.
 *
 * ⚠️ 서버가 실제로 쓰는 합치기(queries/badge-visibility-settings.ts 의
 * mergeBadgeVisibilityView)를 **여기서 부를 수 없다** — 그 모듈이 DB 클라이언트를
 * 물고 있어 unit 목록(DATABASE_URL 이 없다)에서 import 하는 순간 던진다. 그래서 같은
 * 모양을 아래에서 손으로 만든다. 🔴 **그 합치기가 옳은지는 여기서 재지 않는다** —
 * db 목록의 badge-visibility-settings.integration.test.ts 가 실제 DB 위에서 잰다
 * (배지 15 · 체크상자 29 · 차례 · 저장된 행이 그 자리에만 반영되는가).
 * ============================================================================
 */

/** 서버가 넘기는 모양을 등록부에서 만든다. `hidden` 에 적은 쌍만 체크가 풀린다. */
function viewWithHidden(hidden: readonly BadgePlacement[]): BadgeVisibilityBadgeView[] {
  const hiddenKeys = new Set(hidden.map((one) => badgeDraftKey(one.badgeKey, one.placeKey)));
  return BADGES.map((badge) => ({
    badgeKey: badge.key,
    label: badge.label,
    description: badge.description,
    places: badge.places.map((placeKey) => ({
      placeKey,
      label: findBadgePlace(placeKey)?.label ?? placeKey,
      visible: !hiddenKeys.has(badgeDraftKey(badge.key, placeKey)),
    })),
  }));
}

/** 저장된 행이 하나도 없을 때의 화면 자료 — 전부 보임(체크됨). */
const ALL_VISIBLE = viewWithHidden([]);

describe("① 처음 체크 상태", () => {
  test("표본이 비어 있지 않다 — 배지 15 · 체크상자 29", () => {
    assert.equal(ALL_VISIBLE.length, 15);
    assert.equal(
      ALL_VISIBLE.reduce((sum, badge) => sum + badge.places.length, 0),
      29
    );
    assert.equal(BADGE_PLACEMENTS.length, 29);
  });

  test("빈 표면 29칸이 전부 체크다", () => {
    const draft = badgeDraftFromView(ALL_VISIBLE);
    assert.equal(Object.keys(draft).length, 29);
    assert.equal(
      Object.values(draft).every((checked) => checked === true),
      true
    );
  });

  test("🔴 끈 자리만 체크가 풀린다 — 같은 배지의 다른 자리는 그대로다", () => {
    // 「상태」는 자리가 셋이다. 그중 하나만 끈다.
    const view = viewWithHidden([{ badgeKey: "repairStatus", placeKey: "repairCaseList" }]);
    const draft = badgeDraftFromView(view);
    assert.equal(draft[badgeDraftKey("repairStatus", "repairCaseList")], false);
    assert.equal(draft[badgeDraftKey("repairStatus", "repairCaseDetailHeader")], true);
    assert.equal(
      Object.values(draft).filter((checked) => checked === false).length,
      1,
      "한 자리를 껐는데 다른 칸까지 풀렸다"
    );
  });

  test("열쇠가 쌍마다 하나씩이다 — 두 쌍이 한 칸으로 접히지 않는다", () => {
    const keys = BADGE_PLACEMENTS.map((placement) =>
      badgeDraftKey(placement.badgeKey, placement.placeKey)
    );
    assert.equal(new Set(keys).size, 29);
  });
});

describe("② 보낼 것 — 바뀐 쌍만", () => {
  test("아무것도 안 만지면 보낼 것이 없다(= [저장] 이 꺼져 있다)", () => {
    assert.deepEqual(changedBadgePlacements(ALL_VISIBLE, badgeDraftFromView(ALL_VISIBLE)), []);
  });

  test("🔴 체크를 푼 쌍 **하나만** 간다 — 나머지 28개는 안 실린다", () => {
    const draft = badgeDraftFromView(ALL_VISIBLE);
    draft[badgeDraftKey("priority", "repairCaseDetailHeader")] = false;
    assert.deepEqual(changedBadgePlacements(ALL_VISIBLE, draft), [
      { badgeKey: "priority", placeKey: "repairCaseDetailHeader", isVisible: false },
    ]);
  });

  test("🔴 다시 켠 쌍은 `isVisible: true` 로 간다 — 저장 쪽이 그 행을 지운다", () => {
    const view = viewWithHidden([{ badgeKey: "hold", placeKey: "repairCaseList" }]);
    const draft = badgeDraftFromView(view);
    draft[badgeDraftKey("hold", "repairCaseList")] = true;
    assert.deepEqual(changedBadgePlacements(view, draft), [
      { badgeKey: "hold", placeKey: "repairCaseList", isVisible: true },
    ]);
  });

  test("🔴 이미 꺼져 있는 자리는 보낼 것이 없다 — 같은 값을 다시 적지 않는다", () => {
    const view = viewWithHidden([{ badgeKey: "hold", placeKey: "repairCaseList" }]);
    assert.deepEqual(changedBadgePlacements(view, badgeDraftFromView(view)), []);
  });

  test("전부 끄면 29개가 간다 — 차례는 화면에 보이는 차례(배지 → 자리)", () => {
    const draft = badgeDraftFromView(ALL_VISIBLE);
    for (const key of Object.keys(draft)) draft[key] = false;
    const changed = changedBadgePlacements(ALL_VISIBLE, draft);
    assert.equal(changed.length, 29);
    assert.equal(
      changed.every((placement) => placement.isVisible === false),
      true
    );
    assert.deepEqual(
      changed.map((placement) => `${placement.badgeKey} ${placement.placeKey}`),
      BADGE_PLACEMENTS.map((placement) => `${placement.badgeKey} ${placement.placeKey}`)
    );
    // 🔵 차례가 등록부 그대로라는 말은 곧 화면 차례 그대로라는 말이다.
    assert.equal(changed[0].badgeKey, BADGES[0].key);
  });
});

describe("③ 지문 — 언제 체크를 버리는가", () => {
  test("🔴 같은 값이면 지문이 같다 — 저장 실패 뒤 고쳐 둔 체크가 안 날아간다", () => {
    // 서버 컴포넌트는 다시 그릴 때마다 **새 배열**을 만든다. 신원으로 재면 저장이
    // 실패해 아무것도 안 바뀐 요청에서도 사람이 만지던 체크가 전부 되돌아간다.
    const again = viewWithHidden([]);
    assert.notEqual(again, ALL_VISIBLE, "표본이 같은 배열이라 이 시험이 아무것도 안 잰다");
    assert.equal(badgeViewSignature(again), badgeViewSignature(ALL_VISIBLE));
  });

  test("🔴 한 자리만 달라져도 지문이 달라진다 — 저장 뒤 새 값으로 갈아탄다", () => {
    const afterSave = viewWithHidden([{ badgeKey: "source", placeKey: "repairCaseList" }]);
    assert.notEqual(badgeViewSignature(afterSave), badgeViewSignature(ALL_VISIBLE));
  });
});
