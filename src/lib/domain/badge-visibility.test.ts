import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BADGES,
  BADGE_KEYS,
  BADGE_PLACEMENTS,
  BADGE_PLACES,
  BADGE_PLACE_KEYS,
  findBadge,
  findBadgePlace,
  isBadgePlacementAllowed,
  isBadgeVisible,
  NO_BADGE_VISIBILITY_SETTINGS,
  type BadgeVisibilityRow,
} from "./badge-visibility";

/**
 * ============================================================================
 * 배지 표시 설정 — 등록부와 판정 (2026-11-13, 조각 1)
 * ============================================================================
 * 이 조각은 **밑바탕뿐**이라 화면이 한 글자도 안 바뀐다. 그래서 눈으로 확인할 수
 * 있는 것이 하나도 없고, 지키는 일을 전부 이 파일이 한다.
 *
 * 🔴 가장 세게 지키는 둘:
 *  ① **쌍이 33개다** — 15 × 7 = 105 로 펼치면 설정 화면에 「어디에도 안 뜨는
 *     배지」의 스위치가 72개 생긴다. 꺼도 아무 일이 안 일어나므로, 끈 사람은
 *     기능이 고장 난 것으로 읽는다.
 *  ② **같은 배지라도 자리가 다르면 따로 판정된다** — 이 기능의 존재 이유다.
 *     한 자리를 끄는 설정이 다른 자리까지 끄면 (배지, 자리) 표를 만든 값이 통째로
 *     사라지는데, 그 어긋남은 끈 자리만 보는 사람 눈에는 「잘 된다」로 보인다.
 *
 * 🔵 읽는 함수(db/queries/badge-visibility-settings.ts)의 통합 시험은 표가 아직
 *    적용 전이라 여기 없다. 조각 2에서 db 목록에 붙인다.
 * ============================================================================
 */

describe("🔵 못 — 등록부가 실제로 차 있는가", () => {
  test("배지 15종 · 자리 7곳", () => {
    // 아래 시험들이 전부 등록부를 돌며 센다. 등록부가 비면 그 반복이 한 번도
    // 안 돌고 **전부 공짜로 통과한다** — 그 길을 여기서 먼저 막는다.
    assert.equal(BADGES.length, 15, "배지 수가 달라졌다 — 늘렸다면 뜨는 자리와 설명도 정했는가");
    assert.equal(BADGE_PLACES.length, 7, "자리 수가 달라졌다");
  });

  test("키 목록이 등록부의 차례를 그대로 따른다", () => {
    // BADGE_KEYS·BADGE_PLACE_KEYS 는 설정 화면이 줄을 그리는 차례이기도 하다.
    // 손으로 한 벌 더 적으면 타입이 같아(string[]) tsc 가 침묵한다.
    assert.deepEqual([...BADGE_KEYS], BADGES.map((badge) => badge.key));
    assert.deepEqual([...BADGE_PLACE_KEYS], BADGE_PLACES.map((place) => place.key));
  });
});

describe("🔴 허용 쌍 — 33개", () => {
  test("합이 33이다", () => {
    assert.equal(
      BADGE_PLACEMENTS.length,
      33,
      "설정할 수 있는 쌍의 수가 달라졌다 — 배지를 한 자리 더 그리기로 했다면 여기도 함께 고친다"
    );
  });

  test("🔴 곱(15 × 7 = 105)으로 펼치지 않았다", () => {
    assert.notEqual(
      BADGE_PLACEMENTS.length,
      BADGES.length * BADGE_PLACES.length,
      "배지 × 자리를 곱으로 펼쳤다 — 어디에도 안 뜨는 배지의 스위치가 생긴다"
    );
  });

  test("같은 쌍이 두 번 들어 있지 않다", () => {
    const seen = new Set(
      BADGE_PLACEMENTS.map((placement) => `${placement.badgeKey} ${placement.placeKey}`)
    );
    assert.equal(seen.size, BADGE_PLACEMENTS.length, "같은 (배지, 자리)가 두 번 적혀 있다");
  });

  test("모든 쌍이 등록부의 배지 키·자리 키를 쓴다", () => {
    for (const placement of BADGE_PLACEMENTS) {
      assert.ok(findBadge(placement.badgeKey), `등록부에 없는 배지 키: ${placement.badgeKey}`);
      assert.ok(findBadgePlace(placement.placeKey), `등록부에 없는 자리 키: ${placement.placeKey}`);
    }
  });

  test("배지마다 뜨는 자리가 적어도 하나는 있다", () => {
    // 자리가 0곳인 배지는 설정 화면에 줄만 서고 스위치가 하나도 없는 모양이 된다.
    for (const badge of BADGES) {
      assert.ok(badge.places.length >= 1, `${badge.key} 에 뜨는 자리가 하나도 없다`);
    }
  });

  test("배지 안에서 자리가 겹치지 않고, 차례가 BADGE_PLACES 를 따른다", () => {
    for (const badge of BADGES) {
      assert.equal(
        new Set(badge.places).size,
        badge.places.length,
        `${badge.key} 의 자리 목록에 같은 자리가 두 번 있다`
      );
      const expected = BADGE_PLACE_KEYS.filter((key) => badge.places.includes(key));
      assert.deepEqual(
        [...badge.places],
        [...expected],
        `${badge.key} 의 자리 차례가 설정 화면의 차례와 다르다`
      );
    }
  });

  test("🔴 뜨지 않는 자리는 허용되지 않는다 — 몇 자리를 콕 집어 본다", () => {
    // 뜨는 쪽.
    assert.equal(isBadgePlacementAllowed("repairStatus", "repairCaseList"), true);
    assert.equal(isBadgePlacementAllowed("miscCaseStatus", "miscCaseDetailHeader"), true);
    assert.equal(isBadgePlacementAllowed("finalShipmentApproved", "domesticOrderList"), true);
    // 안 뜨는 쪽 — 우선순위 배지는 내자 정리 목록에 없고, 기타건 상태는 수리건
    // 목록에 없다. 「(내자)」는 목록 전용이라 상세 기본 정보에는 긴 쪽이 뜬다.
    assert.equal(isBadgePlacementAllowed("priority", "domesticOrderList"), false);
    assert.equal(isBadgePlacementAllowed("miscCaseStatus", "repairCaseList"), false);
    assert.equal(
      isBadgePlacementAllowed("dueDateFromDomesticOrderShort", "repairCaseDetailBasicInfo"),
      false
    );
  });

  test("모르는 키는 던지지 않고 false·undefined 로 답한다", () => {
    assert.equal(isBadgePlacementAllowed("nopeBadge", "repairCaseList"), false);
    assert.equal(isBadgePlacementAllowed("repairStatus", "nopePlace"), false);
    assert.equal(isBadgePlacementAllowed("", ""), false);
    assert.equal(findBadge("nopeBadge"), undefined);
    assert.equal(findBadgePlace("nopePlace"), undefined);
  });
});

describe("🔴 글 — 이름과 설명이 비어 있지 않다", () => {
  test("배지 15종 전부에 이름과 설명이 있다", () => {
    let counted = 0;
    for (const badge of BADGES) {
      assert.ok(badge.label.trim().length > 0, `${badge.key} 에 한글 이름이 없다`);
      // 설명은 설정 화면에서 스위치 옆에 그대로 나간다. 비어 있으면 관리자는
      // 「무엇을 끄는 스위치인지」를 알 길이 없다.
      assert.ok(badge.description.trim().length > 0, `${badge.key} 에 설명 문구가 없다`);
      counted += 1;
    }
    // 🔵 못 — 위 반복이 **열다섯 번** 돌았는가.
    assert.equal(counted, 15);
  });

  test("자리 7곳 전부에 한글 이름이 있다", () => {
    let counted = 0;
    for (const place of BADGE_PLACES) {
      assert.ok(place.label.trim().length > 0, `${place.key} 에 한글 이름이 없다`);
      counted += 1;
    }
    assert.equal(counted, 7);
  });

  test("배지 키와 자리 키가 각각 고유하다", () => {
    assert.equal(new Set(BADGE_KEYS).size, BADGE_KEYS.length, "배지 키가 겹친다");
    assert.equal(new Set(BADGE_PLACE_KEYS).size, BADGE_PLACE_KEYS.length, "자리 키가 겹친다");
  });
});

describe("🔴 판정 — isBadgeVisible", () => {
  test("설정이 하나도 없으면 전부 보인다 — 이 기능을 넣기 전과 같은 화면", () => {
    let counted = 0;
    for (const placement of BADGE_PLACEMENTS) {
      assert.equal(
        isBadgeVisible(NO_BADGE_VISIBILITY_SETTINGS, placement.badgeKey, placement.placeKey),
        true,
        `${placement.badgeKey} × ${placement.placeKey} 가 빈 설정에서 숨겨졌다`
      );
      counted += 1;
    }
    // 🔵 못 — 33쌍을 실제로 다 돌았는가(목록이 비면 공짜로 통과한다).
    assert.equal(counted, 33);
  });

  test("그 쌍의 줄이 없으면 보인다 — 남의 줄만 있어도 마찬가지", () => {
    const settings: BadgeVisibilityRow[] = [
      { badgeKey: "priority", placeKey: "repairCaseList", isVisible: false },
    ];
    assert.equal(isBadgeVisible(settings, "repairStatus", "repairCaseList"), true);
    assert.equal(isBadgeVisible(settings, "priority", "repairCaseDetailHeader"), true);
  });

  test("isVisible: false 줄이 있으면 안 보인다", () => {
    const settings: BadgeVisibilityRow[] = [
      { badgeKey: "source", placeKey: "repairCaseList", isVisible: false },
    ];
    assert.equal(isBadgeVisible(settings, "source", "repairCaseList"), false);
  });

  test("isVisible: true 줄이면 보인다 — 껐다가 다시 켠 자리", () => {
    // 끄기를 되돌리는 길이 둘이다(행을 지우기 · true 로 되돌리기). 뒤엣것이
    // 「보임」으로 답하지 않으면 다시 켠 배지가 영영 안 돌아온다.
    const settings: BadgeVisibilityRow[] = [
      { badgeKey: "source", placeKey: "repairCaseList", isVisible: true },
    ];
    assert.equal(isBadgeVisible(settings, "source", "repairCaseList"), true);
  });

  test("🔴 같은 배지라도 **자리가 다르면 따로** 판정된다", () => {
    // 이 기능의 존재 이유다 — 「DB」 배지가 목록에서는 줄마다 되풀이돼 거슬리지만
    // 상세 머리말에서는 자료의 출처를 알려 주는 유일한 표시다.
    const settings: BadgeVisibilityRow[] = [
      { badgeKey: "source", placeKey: "repairCaseList", isVisible: false },
    ];
    assert.equal(isBadgeVisible(settings, "source", "repairCaseList"), false, "끈 자리가 보인다");
    assert.equal(
      isBadgeVisible(settings, "source", "repairCaseDetailHeader"),
      true,
      "🔴 한 자리를 껐는데 다른 자리까지 꺼졌다 — (배지, 자리) 표를 만든 값이 사라진다"
    );
    assert.equal(isBadgeVisible(settings, "source", "repairCaseDetailBasicInfo"), true);
    assert.equal(isBadgeVisible(settings, "source", "repairCaseDetailActivity"), true);
    // 🔵 못 — 이 배지가 정말 네 자리에 뜨는가(한 자리짜리 배지로 재면 아무것도 안 잰다).
    assert.equal(findBadge("source")?.places.length, 4);
  });

  test("🔴 허용되지 않는 쌍은 **꺼진 줄이 있어도** 보인다", () => {
    // 코드가 잘못 물어도 배지가 사라지지 않게 하려는 것이다. 「숨김」으로 틀리면
    // 화면에서 표식이 조용히 없어지고 아무도 오류를 못 보지만, 「보임」으로 틀리면
    // 지금과 똑같은 화면일 뿐이다.
    const settings: BadgeVisibilityRow[] = [
      { badgeKey: "priority", placeKey: "domesticOrderList", isVisible: false },
    ];
    assert.equal(isBadgePlacementAllowed("priority", "domesticOrderList"), false);
    assert.equal(isBadgeVisible(settings, "priority", "domesticOrderList"), true);
  });

  test("🔴 모르는 배지 키·자리 키를 줘도 던지지 않고 보임이다", () => {
    // DB 에는 등록부에서 사라진 옛 키의 행이 남아 있을 수 있다. 그때 이 함수가
    // 터지면 그 배지를 쓰는 화면이 통째로 안 뜬다.
    const settings: BadgeVisibilityRow[] = [
      { badgeKey: "legacyBadgeFromLastYear", placeKey: "repairCaseList", isVisible: false },
      { badgeKey: "repairStatus", placeKey: "placeThatNoLongerExists", isVisible: false },
    ];
    assert.equal(isBadgeVisible(settings, "legacyBadgeFromLastYear", "repairCaseList"), true);
    assert.equal(isBadgeVisible(settings, "repairStatus", "placeThatNoLongerExists"), true);
    assert.equal(isBadgeVisible(settings, "", ""), true);
    // 모르는 줄이 섞여 있어도 멀쩡한 쌍의 판정은 그대로다.
    assert.equal(isBadgeVisible(settings, "repairStatus", "repairCaseList"), true);
  });

  test("여러 자리를 한꺼번에 끈 설정도 자리마다 제 답을 준다", () => {
    const settings: BadgeVisibilityRow[] = [
      { badgeKey: "finalShipmentApproved", placeKey: "repairCaseList", isVisible: false },
      { badgeKey: "finalShipmentApproved", placeKey: "miscCaseList", isVisible: false },
      { badgeKey: "overdue", placeKey: "repairCaseDetailHeader", isVisible: false },
    ];
    assert.equal(isBadgeVisible(settings, "finalShipmentApproved", "repairCaseList"), false);
    assert.equal(isBadgeVisible(settings, "finalShipmentApproved", "miscCaseList"), false);
    assert.equal(isBadgeVisible(settings, "finalShipmentApproved", "domesticOrderList"), true);
    assert.equal(isBadgeVisible(settings, "finalShipmentApproved", "miscCaseDetailHeader"), true);
    assert.equal(isBadgeVisible(settings, "overdue", "repairCaseDetailHeader"), false);
    assert.equal(isBadgeVisible(settings, "overdue", "repairCaseList"), true);
  });
});
