import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import BadgeVisibilityPanel from "./BadgeVisibilityPanel";
import { BADGE_SAMPLES } from "./badge-samples";
import { badgeDraftKey } from "./badge-visibility-draft";
import {
  StatusBadge,
  PriorityBadge,
  SourceBadge,
  OverdueBadge,
  DueDateNearBadge,
  HoldBadge,
  WorkflowOverrideBadge,
} from "@/components/repair-cases/badges";
import FinalShipmentApprovedBadge from "@/components/approvals/FinalShipmentApprovedBadge";
import {
  DomesticOrderCompletedBadge,
  DueDateFromRepairCaseBadge,
  DueDateRowCompletedBadge,
  OrderIssuedDateMissingBadge,
} from "@/components/domestic-orders/badges";
import MiscCaseStatusBadge from "@/components/misc-cases/MiscCaseStatusBadge";
import BorrowedSourceNote from "@/components/repair-cases/BorrowedSourceNote";
import { domesticOrderDueDateRowLabel } from "@/lib/domain/domestic-order-due-date-label";
import { DUE_DATE_FROM_DOMESTIC_ORDER_LABEL } from "@/lib/domain/requested-due-date-link";
import {
  BADGES,
  BADGE_PLACEMENTS,
  BADGE_PLACES,
  findBadgePlace,
  type BadgeKey,
  type BadgePlacement,
} from "@/lib/domain/badge-visibility";
import type { BadgeVisibilityBadgeView } from "@/lib/db/queries/badge-visibility-settings";

/**
 * ============================================================================
 * [시스템 설정] → [배지 표시] 탭을 **그려서** 잰다 (2026-11-13, 조각 2)
 * ============================================================================
 * 이 탭에서 눈으로만 잡히는 결함이 둘이다: ① 체크상자가 엉뚱한 쌍에 생기는 것
 * ② 보기 배지가 안 보이는 것. 둘 다 글자로 읽어서는 못 잡아 **진짜로 그린다.**
 * 그릴 수 있는 까닭은 화면 본체(BadgeVisibilityPanel)가 서버 액션을 직접 가져오지
 * 않기 때문이다 — 저장은 `onSave` 로 받는다(그 파일 머리말).
 *
 * 재는 것:
 *  ① 🔴 체크상자가 **29개**인가 — 곱으로 펼치면 「어디에도 안 뜨는 배지」의 스위치가
 *     61개 생기고, 꺼도 아무 일이 안 일어나 끈 사람은 기능이 고장 난 것으로 읽는다.
 *  ② 배지 15개의 이름·설명·차례가 등록부 그대로인가.
 *  ③ 🔴 **전부 꺼도 보기 배지가 그려지는가** — 이것이 이 파일에서 가장 중요한 줄이다.
 *     조각 3에서 배지가 설정을 읽어 스스로 숨게 되는데, 그때 이 화면의 보기 배지까지
 *     사라지면 **끈 사람이 다시 켤 길을 잃는다**(줄이 비어 있어 무엇을 껐는지 모른다).
 *  ④ 🔴 보기 배지가 **진짜 배지 컴포넌트의 출력**인가 — 모양을 베낀 사본이면 색이
 *     바뀌는 날 설정 화면만 옛 모양으로 남고 오류가 안 나서 아무도 모른다.
 *  ⑤ 🔴 못 고치는 사람에게 체크상자가 비활성이고 [저장]이 없는가(보기는 된다).
 *
 * 🔴 값은 전부 지어낸 것이다 — 실제 고객사 이름·L/N·S/N 은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");
const count = (source: string, needle: string) => source.split(needle).length - 1;

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

const noop = async () => ({ ok: true, message: "" });

const MANAGED = renderToStaticMarkup(
  <BadgeVisibilityPanel badges={viewWithHidden([])} canManage onSave={noop} />
);
const READ_ONLY = renderToStaticMarkup(
  <BadgeVisibilityPanel badges={viewWithHidden([])} canManage={false} onSave={noop} />
);
/** 🔴 29쌍을 **전부 끈** 화면. ③ 이 재는 자리다. */
const ALL_HIDDEN = renderToStaticMarkup(
  <BadgeVisibilityPanel badges={viewWithHidden(BADGE_PLACEMENTS)} canManage onSave={noop} />
);

/**
 * 배지 컴포넌트를 **직접 그려서** 얻은 글자. 설정 화면의 보기 배지가 이것과 한
 * 글자도 다르지 않아야 한다(③).
 *
 * 🔴 여기 모양을 적지 않는다 — 컴포넌트를 부른다. 글자를 적어 두면 색이 바뀌는 날
 * 시험과 화면이 **함께** 틀린 채로 통과한다.
 */
const SAMPLE_MARKUP: Record<string, string> = {
  repairStatus: renderToStaticMarkup(<StatusBadge status="IN_REPAIR" />),
  priority: renderToStaticMarkup(<PriorityBadge priority="URGENT" />),
  source: renderToStaticMarkup(<SourceBadge source="DATABASE" />),
  overdueYes: renderToStaticMarkup(<OverdueBadge isOverdue />),
  overdueNo: renderToStaticMarkup(<OverdueBadge isOverdue={false} />),
  dueDateNear: renderToStaticMarkup(<DueDateNearBadge isDueDateNear />),
  hold: renderToStaticMarkup(<HoldBadge isOnHold />),
  workflowOverride: renderToStaticMarkup(<WorkflowOverrideBadge hasOverride />),
  finalShipmentApproved: renderToStaticMarkup(<FinalShipmentApprovedBadge approved />),
  // 🔵 **2026-11-13 에 마지막 하나가 늘었다.** 수리건 상세 기본 정보 탭의 비공개
  //    `Field` 조각이 그리던 한 줄인데, 제 파일로 내려 내보내게 했다
  //    (components/repair-cases/BorrowedSourceNote.tsx). 🔴 **글자를 여기서 짓지
  //    않는다** — 화면이 쓰는 그 도메인 상수를 그대로 넘긴다.
  dueDateFromDomesticOrder: renderToStaticMarkup(
    <BorrowedSourceNote label={DUE_DATE_FROM_DOMESTIC_ORDER_LABEL} />
  ),
  // 🔵 **2026-11-13(조각 4)에 넷이 늘었다.** 내자 정리 목록 화면 안의 비공개 함수라
  //    가져다 쓸 수 없던 것들인데, 그 화면에 배지 표시 설정을 붙이면서 제 파일로
  //    내려 내보내게 했다(components/domestic-orders/badges.tsx). 모양을 베끼지
  //    않았다는 사실을 아래 ③의 두 시험이 그대로 잰다.
  dueDateFromRepairCase: renderToStaticMarkup(<DueDateFromRepairCaseBadge />),
  domesticOrderCompleted: renderToStaticMarkup(<DomesticOrderCompletedBadge />),
  dueDateRowCompleted: renderToStaticMarkup(
    <DueDateRowCompletedBadge
      rowOrder={1}
      label={domesticOrderDueDateRowLabel(1, { dueDate: "2026-01-15", note: null })}
    />
  ),
  orderIssuedDateMissing: renderToStaticMarkup(<OrderIssuedDateMissingBadge />),
  miscCaseStatus: renderToStaticMarkup(<MiscCaseStatusBadge status="IN_PROGRESS" />),
};

/**
 * 🔵 보기가 있는 배지 키 — **등록부의 열다섯 전부**다(2026-11-13).
 *
 * 🔴 위 SAMPLE_MARKUP 과 **수가 다를 수 있다**: overdue 는 거기 둘(지연·정상)로
 * 들어 있고, `dueDateFromDomesticOrderShort` 는 날짜와 함께 서야 모양이 나와 거기
 * 없고 ⑤가 따로 본다. 그래서 「보기 배지 열다섯」을 세는 잣대는 이 목록이다.
 */
const SAMPLED_BADGE_KEYS: readonly BadgeKey[] = [
  "repairStatus",
  "priority",
  "source",
  "overdue",
  "dueDateNear",
  "hold",
  "workflowOverride",
  "finalShipmentApproved",
  "dueDateFromDomesticOrder",
  "dueDateFromDomesticOrderShort",
  "dueDateFromRepairCase",
  "domesticOrderCompleted",
  "dueDateRowCompleted",
  "orderIssuedDateMissing",
  "miscCaseStatus",
];

describe("① 체크상자 29개 — 그 배지가 뜨는 자리만", () => {
  test("표본이 비어 있지 않다 — 그린 글자가 실제로 있다", () => {
    assert.ok(MANAGED.length > 1000, "화면이 거의 비어 있다 — 아래 셈이 아무것도 안 잰다");
    assert.match(MANAGED, /배지 표시/);
  });

  test("🔴 체크상자가 정확히 29개다", () => {
    assert.equal(count(MANAGED, 'type="checkbox"'), 29);
    assert.equal(count(MANAGED, 'type="checkbox"'), BADGE_PLACEMENTS.length);
  });

  test("🔴 자리 이름이 **뜨는 배지 수만큼만** 나온다 — 곱으로 펼치지 않았다", () => {
    for (const place of BADGE_PLACES) {
      const expected = BADGES.filter((badge) =>
        (badge.places as readonly string[]).includes(place.key)
      ).length;
      assert.ok(expected > 0, `${place.label}: 표본이 비었다 — 아무 배지도 안 뜨는 자리다`);
      assert.equal(
        count(MANAGED, place.label),
        expected,
        `${place.label}: 체크상자 수가 등록부와 다르다`
      );
    }
  });

  test("🔴 「수리 건 요청일」에는 칸이 **하나**뿐이다 — 안 뜨는 자리의 스위치가 없다", () => {
    // 곱으로 펼쳤다면 이 배지에만 칸이 여섯 생긴다. 끈 사람은 아무 일도 일어나지
    // 않는 스위치를 보고 기능이 고장 났다고 읽는다.
    const badge = BADGES.find((one) => one.key === "dueDateFromRepairCase");
    assert.ok(badge);
    assert.deepEqual([...badge.places], ["domesticOrderList"]);
    const blockStart = MANAGED.indexOf(badge.label);
    assert.ok(blockStart > 0, "그 배지의 이름을 화면에서 못 찾았다");
    const block = MANAGED.slice(blockStart, MANAGED.indexOf("</li>", blockStart));
    assert.equal(count(block, 'type="checkbox"'), 1);
    assert.equal(count(block, "전체 A/S 현황 — 목록"), 0);
  });
});

describe("② 배지 15개 — 이름 · 설명 · 차례", () => {
  test("이름과 설명이 등록부 글자 그대로다", () => {
    assert.equal(BADGES.length, 15);
    for (const badge of BADGES) {
      assert.ok(MANAGED.includes(badge.label), `${badge.key}: 이름이 안 보인다`);
      assert.ok(
        MANAGED.includes(badge.description),
        `${badge.key}: 설명이 안 보인다 — 끄기 전에 읽을 글이 사라졌다`
      );
    }
  });

  test("🔴 차례가 등록부 차례다", () => {
    let cursor = -1;
    for (const badge of BADGES) {
      const at = MANAGED.indexOf(badge.label, cursor + 1);
      assert.ok(at > cursor, `${badge.key}: 차례가 어긋났다`);
      cursor = at;
    }
  });

  test("체크 상태가 서버가 넘긴 값이다 — 끈 자리만 풀려 있다", () => {
    const oneHidden = renderToStaticMarkup(
      <BadgeVisibilityPanel
        badges={viewWithHidden([{ badgeKey: "repairStatus", placeKey: "repairCaseList" }])}
        canManage
        onSave={noop}
      />
    );
    // 체크된 칸에는 checked 가 붙고, 풀린 칸에는 안 붙는다.
    assert.equal(count(MANAGED, "checked="), 29);
    assert.equal(count(oneHidden, "checked="), 28);
  });
});

describe("③ 🔴 보기 배지는 설정을 따르지 않는다", () => {
  /**
   * 🔴 **조각 3을 맡는 사람에게**: 이 묶음이 깨지면 배지가 설정 화면의 보기까지
   * 끄고 있는 것이다. 그 상태에서는 관리자가 배지를 하나 끈 뒤 **무엇을 껐는지
   * 볼 수 없고, 다시 켜려 해도 그 줄이 비어 있어 못 찾는다.**
   */
  test("표본이 비어 있지 않다 — 전부 끈 화면에서도 체크상자 29개가 그대로 있다", () => {
    assert.equal(count(ALL_HIDDEN, 'type="checkbox"'), 29);
    assert.equal(count(ALL_HIDDEN, "checked="), 0, "전부 끈 화면인데 체크가 남아 있다");
  });

  test("🔴 29쌍을 전부 꺼도 보기 배지가 **그대로** 그려진다 — 열다섯 전부", () => {
    // 🔵 표본이 줄면 이 줄이 덜 잰 채로 초록이 된다.
    assert.equal(Object.keys(SAMPLE_MARKUP).length, 15, "표본이 줄었다 — 덜 재고 있다");
    for (const [badgeKey, markup] of Object.entries(SAMPLE_MARKUP)) {
      assert.ok(
        ALL_HIDDEN.includes(markup),
        `${badgeKey}: 전부 끈 화면에서 보기 배지가 사라졌다 — 끈 사람이 되돌릴 길을 잃는다`
      );
    }

    // 🔴 **열다섯을 하나도 빠뜨리지 않았는가.** 위 표의 열쇠는 배지 키와 일대일이
    //    아니다(overdue 가 지연·정상 둘로 들어 있다). 그래서 등록부 쪽 목록으로
    //    되짚어, 배지마다 전부 끈 화면에서 잰 글자가 **적어도 하나** 있는지 본다.
    //    🔵 「(내자)」만 이 표에 없다 — 날짜와 함께 서야 모양이 나오는 꼬리표라
    //    ⑤가 ALL_HIDDEN 에서 따로 본다.
    for (const key of SAMPLED_BADGE_KEYS) {
      if (key === "dueDateFromDomesticOrderShort") continue;
      const entries = Object.keys(SAMPLE_MARKUP).filter((name) => name.startsWith(key));
      assert.ok(entries.length > 0, `${key}: 전부 끈 화면에서 잴 글자가 하나도 없다`);
    }
    assert.match(ALL_HIDDEN, /\(내자\)/, "「(내자)」 보기가 전부 끈 화면에서 사라졌다");
    assert.equal(SAMPLED_BADGE_KEYS.length, BADGES.length, "덮지 못한 배지가 남았다");
  });

  test("🔴 보기 배지가 **진짜 배지 컴포넌트의 출력**이다 — 베낀 사본이 아니다", () => {
    // 아래 글자는 배지 컴포넌트를 직접 그려서 얻은 것이다. 설정 화면이 모양을
    // 베껴 적었다면 색 한 글자만 달라도 여기서 어긋난다.
    assert.equal(Object.keys(SAMPLE_MARKUP).length, 15);
    for (const [badgeKey, markup] of Object.entries(SAMPLE_MARKUP)) {
      assert.ok(markup.length > 0, `${badgeKey}: 표본이 비었다`);
      assert.ok(MANAGED.includes(markup), `${badgeKey}: 보기 배지가 안 보인다`);
    }
  });

  test("🔴 보기 배지를 그리는 자리는 **자리 키도 설정도 모른다**", () => {
    const source = stripComments(read("src/components/settings/badge-samples.tsx"));
    for (const forbidden of ["placeKey", "isBadgeVisible", "BadgeVisibilityRow", "settings"]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `badge-samples.tsx 가 '${forbidden}' 를 안다 — 보기 배지가 설정 판정을 타기 시작했다`
      );
    }
    // 등록부의 자리 여섯 가운데 설정 화면인 것이 하나도 없다는 사실이 이 구조의
    // 근거다 — 자리를 안 주는 것이 곧 "판정 밖"이다(허용되지 않는 쌍은 언제나 보임).
    for (const place of BADGE_PLACES) {
      assert.equal(
        source.includes(place.key),
        false,
        `${place.key}: 보기 배지가 자리를 하나 들고 있다`
      );
    }
  });

  test("🔴 배지 열다섯에 **전부** 보기가 있다 — 2026-11-13 에 다섯에서 영이 됐다", () => {
    // 🔵 다섯 다 화면 파일 안의 **비공개 함수**가 그려서 가져다 쓸 수 없던 것들이고,
    //    같은 날 둘로 나눠 떼어냈다: 넷은 내자 정리 목록에서(domestic-orders/
    //    badges.tsx), 하나(`dueDateFromDomesticOrder`)는 수리건 상세 기본 정보 탭의
    //    `Field` 에서(repair-cases/BorrowedSourceNote.tsx). 베껴 그린 것이 아니라는
    //    사실은 위 두 시험이 그 조각들을 직접 그려 글자를 맞대어 본다.
    //
    // 🔴 **「없는 것이 없다」를 빈 목록으로 재지 않는다.** 등록부가 통째로 비어도
    //    `missing` 은 빈 목록이라 그 단언은 공짜로 통과한다. 그래서 세는 방향을
    //    뒤집어, **배지 하나하나에 보기가 있는가**를 묻는다 — 표본(열다섯)이 먼저
    //    서야 아래 줄이 뜻을 가진다.
    assert.equal(BADGES.length, 15, "등록부의 배지가 열다섯이 아니다 — 표본이 달라졌다");
    for (const badge of BADGES) {
      assert.ok(
        badge.key in BADGE_SAMPLES,
        `${badge.key}: 보기가 없다 — 이름과 설명만 서는 줄이 생겼다. 🔴 모양을 설정 화면에 ` +
          "베껴 그리지 말고 그 화면에서 조각을 떼어내 불러라(위 두 줄이 그 결정이다)"
      );
      // 모양이 생겨도 이름과 설명은 그대로 선다 — 체크상자도 똑같이 돈다.
      assert.ok(MANAGED.includes(badge.label), `${badge.key}: 이름이 안 보인다`);
    }
    assert.equal(
      Object.keys(BADGE_SAMPLES).length,
      BADGES.length,
      "보기 수와 배지 수가 다르다 — 등록부에 없는 보기가 섞였거나 빠진 줄이 있다"
    );
    // 🔵 위 둘이면 이 수는 0이다. 그래도 한 줄 남기는 까닭은, 이 수가 다시 늘어나는
    //    날 **무엇이 비었는지**를 이름으로 말해 주기 때문이다.
    const missing = BADGES.map((badge) => badge.key).filter((key) => !(key in BADGE_SAMPLES));
    assert.deepEqual(missing, []);
  });

  test("등록부에 없는 배지 키의 보기는 없다", () => {
    const badgeKeys = new Set<string>(BADGES.map((badge) => badge.key));
    for (const key of Object.keys(BADGE_SAMPLES)) {
      assert.equal(badgeKeys.has(key), true, `${key}: 등록부에 없는 배지의 보기가 있다`);
    }
  });
});

describe("④ 고칠 수 없는 사람", () => {
  test("🔴 체크상자가 전부 비활성이고 [저장]이 없다 — 그래도 보인다", () => {
    assert.equal(count(READ_ONLY, 'type="checkbox"'), 29);
    assert.equal(count(READ_ONLY, "disabled="), 29, "비활성이 아닌 체크상자가 있다");
    assert.equal(READ_ONLY.includes(">저장</button>"), false);
  });

  test("🔵 고칠 수 있는 사람에게는 [저장] 이 있다 — 표본을 맞대어 본다", () => {
    assert.equal(MANAGED.includes(">저장</button>"), true);
    // 바꾼 것이 없으므로 그 단추는 꺼져 있다(단추 1개 + 체크상자 0개 = disabled 1개).
    assert.equal(count(MANAGED, "disabled="), 1);
  });

  test("🔴 [저장] 은 **바뀐 쌍이 있을 때만** 켜진다 — 조건이 한 곳이다", () => {
    // 누르는 것은 이 환경에서 흉내 낼 수 없어(DOM 이 없다) 조건을 원본으로 읽는다.
    // 값 쪽은 unit 목록의 badge-visibility-draft.test.ts 가 본다.
    const source = stripComments(read("src/components/settings/BadgeVisibilityPanel.tsx"));
    assert.match(source, /disabled=\{pending \|\| changed\.length === 0\}/);
    assert.match(source, /changedBadgePlacements\(badges, draft\)/);
    assert.equal(count(source, "changedBadgePlacements"), 2, "바뀐 쌍을 두 곳에서 세고 있다");
  });

  test("🔴 성공은 저장 팝업 · 실패는 화면에 남는다", () => {
    const panel = stripComments(read("src/components/settings/BadgeVisibilityPanel.tsx"));
    // 0.5초 뒤 저절로 닫히는 팝업은 **성공 전용**이다 — 실패를 실으면 읽기 전에 닫힌다.
    assert.equal(panel.includes("showSavePopup"), false, "실패도 팝업으로 알릴 길이 열려 있다");
    assert.match(panel, /role="alert"/);
    const outer = stripComments(read("src/components/settings/BadgeVisibilitySettings.tsx"));
    assert.match(outer, /if \(!result\.ok\) return result;/);
    // 🔵 `showSavePopup` 은 맨 위 import 줄에도 나온다 — **부르는 자리**로 견준다.
    const refreshAt = outer.indexOf("router.refresh()");
    const popupAt = outer.indexOf("showSavePopup({");
    assert.ok(refreshAt > 0, "저장 뒤 화면을 다시 읽지 않는다");
    assert.ok(popupAt > refreshAt, "팝업이 화면 다시 읽기보다 앞에 있다");
  });
});

describe("⑤ 보기가 있는 배지 열", () => {
  test("등록부의 배지 열에 보기가 달려 있다", () => {
    for (const key of SAMPLED_BADGE_KEYS) {
      assert.ok(key in BADGE_SAMPLES, `${key}: 보기 배지가 사라졌다`);
    }
    assert.equal(Object.keys(BADGE_SAMPLES).length, SAMPLED_BADGE_KEYS.length);
  });

  test("🔴 「(내자)」 꼬리표도 **진짜 조각**으로 그린다 — 날짜와 함께 선다", () => {
    // 이 배지는 홀로 서지 않는다. 날짜 뒤에 붙는 작은 꼬리표라 날짜를 함께 그리는
    // RequestedDueDateValue 를 그대로 쓴다(badge-samples.tsx).
    assert.match(MANAGED, /2026-01-15/);
    assert.match(MANAGED, /\(내자\)/);
    assert.match(ALL_HIDDEN, /\(내자\)/, "전부 끈 화면에서 꼬리표 보기가 사라졌다");
  });
});
