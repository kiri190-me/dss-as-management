import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import MiscCaseCardList from "./MiscCaseCardList";
import MiscCaseTable from "./MiscCaseTable";
import type { MiscCaseRow } from "./misc-case-fields";
import DomesticOrderDetailHeader from "@/components/domestic-orders/detail/DomesticOrderDetailHeader";
import { DueDateNearBadge } from "@/components/repair-cases/badges";
import { MISC_CASE_DEFAULT_SORT } from "@/lib/domain/misc-case-list";
import { MISC_CASE_STATUS_LABELS } from "@/lib/domain/misc-case-status";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";

/**
 * ============================================================================
 * 「납기 임박」 배지 — **기타건 현황(표·카드)과 기타건 상세 머리 카드** (2026-11-25)
 * ============================================================================
 * 사용자 요구: 「기타건 목록과 상세에 [납기 임박] 배지가 뜨도록 해 줘」. 같은 사실을
 * 종 알림이 그날 아침부터 말하고 있어서(커밋 3731fcf7), **둘이 같은 건을 가리키는가**는
 * 도메인 시험이 값으로 잰다(lib/domain/misc-case-due-date-near.test.ts). 이 파일이
 * 재는 것은 **그 답이 실제로 화면에 나오는가**다.
 *
 * 🔴 못 박는 것 넷
 *  ① 서버가 짚어 준 줄에만 서고, 아닌 줄에는 **한 글자도 안 선다**.
 *  ② 🔴 **표와 카드가 둘 다** 선다 — 한쪽만 재면 창 크기에 따라 보이는 사람과 안 보이는
 *    사람이 갈린다(이 저장소가 유·무상·날짜·L/N 에서 세 번 겪은 결함).
 *  ③ 🔴 **수리 건 쪽과 같은 배지 조각**이다 — 모양을 베낀 사본이면 색이 바뀌는 날
 *    기타건 화면만 옛 모양으로 남고 **오류가 안 나서 아무도 모른다.** 글자도 종 알림의
 *    종류 이름 그대로다(「납기 임박」 — 「기타건 납기 임박」이 아니다).
 *  ④ 🔵 상세 머리 카드는 **안 넘기면 안 그린다** — 값만 보려고 그려 보는 자리(시험)가
 *    승인·납기 조회까지 세우지 않게 하는 기본값이다.
 *
 * 🔵 「설정에서 그 자리를 끄면 사라지는가」는 이웃이 자리별로 순회하며 잰다
 * (domestic-orders/badge-visibility-screens.test.tsx — 2026-11-25 에 쌍 둘이 늘었다).
 *
 * 🔴 값은 전부 지어낸 것이다 — 실제 고객사 이름·발주서번호는 한 글자도 쓰지 않는다.
 * ============================================================================
 */

/** 종 알림이 이 종류를 부르는 이름 그대로 — 배지가 글자를 새로 짓지 않는다. */
const BADGE_LABEL = NOTIFICATION_KIND_META.REPAIR_CASE_DUE_DATE_NEAR.label;

const FAKE_ID = "misc-fake-due-near-1";

function fakeRow(isDueDateNear: boolean): MiscCaseRow {
  return {
    id: FAKE_ID,
    repairCaseId: null,
    modelName: "시험용 품목",
    customerName: "시험용 공급처",
    status: "IN_PROGRESS",
    finalShipmentApproved: false,
    isDueDateNear,
    displayQuoteNumber: "TEST-Q-0001",
    displayQuoteIssuedDate: "2094-09-30",
    purchaseOrderNumber: "TEST-PO-0001",
    orderIssuedDate: "2094-10-02",
    projectName: "시험용 PJT",
    progressNote: "시험용 현황",
    displayAmountExcludingVat: "1234567",
    paymentCompleted: false,
    deliveredDateLines: [],
    deliveredByLines: [],
    deliveredDateBorrowed: false,
  };
}

const SCREENS: readonly { name: string; render: (isDueDateNear: boolean) => string }[] = [
  {
    name: "기타건 현황 표",
    render: (isDueDateNear) =>
      renderToStaticMarkup(
        <MiscCaseTable
          rows={[fakeRow(isDueDateNear)]}
          sort={MISC_CASE_DEFAULT_SORT}
          onSortChange={() => {}}
        />
      ),
  },
  {
    name: "기타건 현황 카드",
    render: (isDueDateNear) =>
      renderToStaticMarkup(<MiscCaseCardList rows={[fakeRow(isDueDateNear)]} />),
  },
  {
    name: "기타건 상세 머리 카드",
    render: (isDueDateNear) =>
      renderToStaticMarkup(
        <DomesticOrderDetailHeader
          row={{
            modelName: "시험용 품목",
            customerName: "시험용 공급처",
            displayQuoteIssuedDate: "2094-09-30",
            displayQuoteNumber: "TEST-Q-0001",
          }}
          status="IN_PROGRESS"
          isDueDateNear={isDueDateNear}
        />
      ),
  },
];

test("🔵 못 — 세 화면이 실제로 그려진다(표본이 비면 아래가 전부 공짜로 통과한다)", () => {
  for (const screen of SCREENS) {
    const html = screen.render(true);
    assert.ok(html.length > 300, `${screen.name} 이 거의 안 그려졌다: ${html}`);
    // 🔵 배지 말고도 그 화면의 값이 실제로 들어 있다 — 「화면이 통째로 안 그려졌다」와
    //    「배지가 없다」를 가르는 줄이다.
    assert.ok(html.includes("시험용 품목"), `${screen.name} 에 줄의 값이 없다`);
  }
  assert.equal(BADGE_LABEL, "납기 임박");
});

for (const screen of SCREENS) {
  describe(`${screen.name} — 납기 임박 배지`, () => {
    test("🔴 서버가 짚어 준 줄에만 선다", () => {
      const withBadge = screen.render(true);
      const without = screen.render(false);

      assert.ok(
        withBadge.includes(`>${BADGE_LABEL}</span>`),
        `임박인데 배지가 없다: ${withBadge}`
      );
      assert.equal(
        without.includes(BADGE_LABEL),
        false,
        `임박이 아닌 줄에 배지가 섰다 — 「곧 늦는다」가 늘 켜져 있으면 아무도 안 본다: ${without}`
      );
    });

    test("🔴 **수리 건 쪽과 같은 배지 조각**이다 — 모양을 베끼지 않았다", () => {
      // 글자를 여기 적지 않고 그 조각을 직접 그려서 맞댄다. 베낀 사본이면 색 한
      // 글자만 달라도 여기서 어긋나고, 그 어긋남은 화면에서만 드러날 결함이다.
      const badge = renderToStaticMarkup(<DueDateNearBadge isDueDateNear />);
      assert.ok(badge.includes("rose"), `배지가 장미빛이 아니다: ${badge}`);
      assert.ok(screen.render(true).includes(badge), `${screen.name} 의 배지가 그 조각과 다르다`);
    });

    test("🔵 줄의 값은 배지와 상관없이 그대로다 — 배지는 **표시**일 뿐이다", () => {
      const without = screen.render(false);
      assert.ok(without.includes("시험용 품목"), `배지가 없으니 줄까지 사라졌다: ${without}`);
      assert.ok(
        without.includes(MISC_CASE_STATUS_LABELS.IN_PROGRESS),
        "옆에 서던 상태 배지까지 사라졌다"
      );
    });
  });
}

describe("④ 🔵 상세 머리 카드 — 안 넘기면 안 그린다", () => {
  test("인자를 아예 안 주면 배지가 없다", () => {
    const plain = renderToStaticMarkup(
      <DomesticOrderDetailHeader
        row={{
          modelName: "시험용 품목",
          customerName: "시험용 공급처",
          displayQuoteIssuedDate: "2094-09-30",
          displayQuoteNumber: "TEST-Q-0001",
        }}
      />
    );
    assert.ok(plain.includes("기타건 상세"), plain);
    assert.equal(plain.includes(BADGE_LABEL), false, `안 넘겼는데 배지가 섰다: ${plain}`);
  });
});

describe("🔴 상태 칸 — 배지 셋이 **한 줄에** 선다(칸을 새로 만들지 않았다)", () => {
  /**
   * 🔴 기타건 현황 목록에는 **납기요청일 칸이 없다**(2026-11-06 에 일부러 뺀 자리).
   * 그래서 이 배지는 상태 칸에 얹히고, 열이 늘지 않는다 — 열을 늘리면 이미 아홉인
   * 표가 더 옆으로 벌어진다. 그 사실을 **열 수**로 못 박는다.
   */
  test("표의 머리글 칸 수가 그대로 아홉이다", () => {
    const html = renderToStaticMarkup(
      <MiscCaseTable rows={[fakeRow(true)]} sort={MISC_CASE_DEFAULT_SORT} onSortChange={() => {}} />
    );
    // ⚠️ `"<th"` 로 세지 않는다 — `<thead>` 가 함께 걸려 늘 하나가 더 나온다.
    assert.equal(
      html.split('<th scope="col"').length - 1,
      9,
      `표의 열 수가 달라졌다: ${html.slice(0, 400)}`
    );
    // ⚠️ 날것으로 「납기요청일」을 찾으면 **납품일 칸의 title 안내**에 걸린다(그 글에
    //    「납기요청일 줄마다」가 적혀 있다). 이름표로 선 글자만 본다.
    assert.equal(html.includes(">납기요청일<"), false, "납기요청일 칸이 되살아났다");
  });

  test("🔴 상태 배지와 **같은 묶음 안**이다 — 셋이 한 줄에서 접힌다", () => {
    const html = renderToStaticMarkup(<MiscCaseCardList rows={[fakeRow(true)]} />);
    const statusAt = html.indexOf(MISC_CASE_STATUS_LABELS.IN_PROGRESS);
    const nearAt = html.indexOf(BADGE_LABEL);
    assert.ok(statusAt > 0 && nearAt > 0, `두 배지를 못 찾았다: ${html}`);
    assert.ok(nearAt > statusAt, "납기 임박이 상태 배지보다 앞에 있다");
    // 🔴 사이에서 묶음이 닫히면 좁은 폭에서 둘이 **함께 안 접힌다**(flex-wrap 은
    //    한 상자 안의 칸끼리만 접는다).
    assert.equal(
      html.slice(statusAt, nearAt).includes("</span></div>"),
      false,
      `두 배지 사이에서 묶음이 닫힌다: ${html.slice(statusAt, nearAt)}`
    );
  });
});
