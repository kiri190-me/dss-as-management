import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import {
  DomesticOrderCompletedBadge,
  DueDateFromRepairCaseBadge,
  DueDateRowCompletedBadge,
  OrderIssuedDateMissingBadge,
  OrderIssuedDateMissingText,
} from "./badges";
import DomesticOrderDetailHeader from "./detail/DomesticOrderDetailHeader";
import FinalShipmentApprovedBadge from "@/components/approvals/FinalShipmentApprovedBadge";
import MiscCaseCardList from "@/components/misc-cases/MiscCaseCardList";
import MiscCaseStatusBadge from "@/components/misc-cases/MiscCaseStatusBadge";
import MiscCaseTable from "@/components/misc-cases/MiscCaseTable";
import type { MiscCaseRow } from "@/components/misc-cases/misc-case-fields";
import { BadgeVisibilityProvider } from "@/components/providers/BadgeVisibilityProvider";
import {
  BADGE_PLACEMENTS,
  BADGE_PLACES,
  type BadgeKey,
  type BadgePlaceKey,
  type BadgePlacement,
  type BadgeVisibilityRow,
} from "@/lib/domain/badge-visibility";
import { dash, NO_ORDER_DATE_LABEL } from "@/lib/domain/domestic-order-display";
import { domesticOrderDueDateRowLabel } from "@/lib/domain/domestic-order-due-date-label";
import { FINAL_SHIPMENT_APPROVED_LABEL } from "@/lib/domain/final-shipment-approval-badge";
import { MISC_CASE_DEFAULT_SORT } from "@/lib/domain/misc-case-list";
import { MISC_CASE_STATUS_LABELS } from "@/lib/domain/misc-case-status";
import { DUE_DATE_FROM_REPAIR_CASE_LABEL } from "@/lib/domain/requested-due-date-link";

/**
 * ============================================================================
 * 배지 표시 설정이 **내자 정리 · 기타건 쪽 자리 셋**에서 실제로 먹는다
 * (2026-11-13, 조각 4)
 * ============================================================================
 * 조각 1이 등록부와 판정을, 조각 2가 설정 화면과 저장을, 조각 3이 **수리건 쪽 자리
 * 셋(20쌍)** 을 붙였다. 남은 **아홉 쌍**이 등록부에만 있고 꺼도 화면이 안 바뀌고
 * 있었다 — 이 파일이 그 아홉을 못 박는다. 🔴 **이 조각이 끝나면 29쌍이 전부 듣는다**
 * (아래 「쌍 세기」 묶음이 그 수를 등록부에서 직접 세어 보여 준다).
 *
 * 🔴 못 박는 것 여덟
 *  ① 자리를 **주고** 그 쌍을 끄면 그 배지가 한 글자도 안 그려진다.
 *  ② 자리를 **안 주면** 끈 설정이 있어도 예전 그대로 그려진다 — 설정 화면의 보기
 *    배지가 사는 길이다(badge-samples.tsx 는 자리를 한 글자도 안 넘긴다).
 *  ③ **다른 자리**를 끈 설정은 이 자리에 영향이 없다 — 쌍으로 끄는 기능이라 그렇다.
 *  ④ 🔴 **표와 카드를 각각** 잰다. 한쪽만 재면 폰에서만 안 꺼지는 것을 못 잡는다.
 *  ⑤ 🔴 「수리 건 요청일」은 **꼬리표만** 사라지고 **날짜는 남는다.** 표시 설정으로
 *    자료가 사라지면 그것은 표시 설정이 아니라 자료를 가리는 설정이다.
 *  ⑥ 🔴 「발주일 미정」은 꺼져도 **칸이 비지 않는다** — 다른 빈 칸과 같은 "-" 가
 *    남는다. 그 칸이 **눌러서 고치는 단추의 내용**이라, 통째로 비면 그 줄의
 *    발주발행일을 고치는 길이 사라진다(badges.tsx 의 그 조각 머리말).
 *  ⑦ 🔴 배지를 숨겨도 **그 줄은 목록에 그대로 있다.** 거르기·차례에 손대면 안 된다.
 *  ⑧ 🔵 Provider 가 없어도 **전부 보임**으로 떨어진다(마이그레이션 전 DB·시험 환경).
 *
 * ── 🔴 왜 **내자 정리 목록만** 글자로 읽는가 ────────────────────────────
 * DomesticOrderListScreen 은 서버 액션을 import 하는 클라이언트 컴포넌트라, 그 사슬
 * 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * **import 자체가 던진다**(이웃 domestic-order-inline-cells.test.ts ·
 * domestic-order-due-date-inversion.test.ts 가 같은 자리에서 같은 방법을 쓴다).
 * 🔵 그래서 그 화면의 배지 넷은 **떼어낸 조각을 진짜로 그려서** 재고(./badges.tsx —
 * 2026-11-13 에 바로 이 일을 하려고 내려놓았다), 화면이 그 조각에 **자리를 넘기는가**
 * 만 원본 글자로 본다. 기타건 쪽 셋은 전부 진짜로 그린다.
 *
 * 🔴 값은 전부 지어낸 것이다. 실제 고객사 이름·L/N·S/N·발주서번호는 한 글자도 쓰지
 * 않는다 — 공개 저장소다.
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
/** 🔴 주석을 걷어 낸다 — 규칙이 주석에 글자로 적혀 있어 날것으로 세면 공짜로 통과한다. */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");
const flat = (source: string) => source.replace(/\s+/g, " ");
const codeOf = (relativePath: string) => flat(stripComments(read(relativePath)));

/**
 * 끈 쌍을 저장된 행 모양으로. **끈 것만 행이 된다** — 켠 자리는 행이 아예 없고,
 * 그 빈자리가 「보임」이다(isBadgeVisible 의 규칙 2).
 */
function hiddenRows(hidden: readonly BadgePlacement[]): readonly BadgeVisibilityRow[] {
  return hidden.map((one) => ({
    badgeKey: one.badgeKey,
    placeKey: one.placeKey,
    isVisible: false,
  }));
}

function renderWith(hidden: readonly BadgePlacement[], node: ReactElement): string {
  return renderToStaticMarkup(
    <BadgeVisibilityProvider value={hiddenRows(hidden)}>{node}</BadgeVisibilityProvider>
  );
}

/** 배지 글자가 **제 알약 안에** 찍혔는가 — 아무 데나 들어 있는 글자와 갈라 본다. */
function hasBadge(html: string, label: string): boolean {
  return html.includes(`>${label}</span>`);
}

/* ═══════════════════════════════ 내자 정리 — 목록 (배지 다섯 조각) */

/**
 * 🔴 **내자 정리 목록에 서는 다섯 조각.** 쌍은 다섯인데 조각이 여섯인 까닭은
 * 「발주일 미정」이 표에서는 알약, 카드에서는 글자이기 때문이다(그 화면이 일부러
 * 갈라 둔 자리다) — 둘 다 **같은 쌍**으로 꺼진다.
 *
 * `whenHidden` 이 「꺼졌을 때 남는 글자」다. 🔴 「발주일 미정」 둘만 빈 글자가 아니다
 * (위 머리말 ⑥).
 */
const LIST_BADGES: readonly {
  name: string;
  badgeKey: BadgeKey;
  label: string;
  render: (placeKey?: BadgePlaceKey) => ReactElement;
  whenHidden: string;
}[] = [
  {
    name: "최종 출하 승인 완료(줄 단위 단추 옆)",
    badgeKey: "finalShipmentApproved",
    label: FINAL_SHIPMENT_APPROVED_LABEL,
    render: (placeKey) => <FinalShipmentApprovedBadge size="compact" approved placeKey={placeKey} />,
    whenHidden: "",
  },
  {
    name: "수리 건 요청일(빌려 온 날짜의 꼬리표)",
    badgeKey: "dueDateFromRepairCase",
    label: DUE_DATE_FROM_REPAIR_CASE_LABEL,
    render: (placeKey) => <DueDateFromRepairCaseBadge placeKey={placeKey} />,
    whenHidden: "",
  },
  {
    name: "완료(줄 단위)",
    badgeKey: "domesticOrderCompleted",
    label: "완료",
    render: (placeKey) => <DomesticOrderCompletedBadge placeKey={placeKey} />,
    whenHidden: "",
  },
  {
    name: "회차별 완료",
    badgeKey: "dueDateRowCompleted",
    label: "1차 완료 ✓",
    render: (placeKey) => (
      <DueDateRowCompletedBadge
        rowOrder={1}
        label={domesticOrderDueDateRowLabel(1, { dueDate: "2094-01-15", note: null })}
        placeKey={placeKey}
      />
    ),
    whenHidden: "",
  },
  {
    name: "발주일 미정(표의 알약)",
    badgeKey: "orderIssuedDateMissing",
    label: NO_ORDER_DATE_LABEL,
    render: (placeKey) => <OrderIssuedDateMissingBadge placeKey={placeKey} />,
    // 🔴 빈 칸이 아니라 "-" 다 — 이 칸은 눌러서 고치는 단추의 내용이다(머리말 ⑥).
    whenHidden: dash(null),
  },
  {
    name: "발주일 미정(카드의 글자)",
    badgeKey: "orderIssuedDateMissing",
    label: NO_ORDER_DATE_LABEL,
    render: (placeKey) => <OrderIssuedDateMissingText placeKey={placeKey} />,
    whenHidden: dash(null),
  },
];

describe("내자 정리 — ⓪ 무엇을 재는지 먼저", () => {
  test("🔵 아무것도 안 끄면 여섯 조각이 **전부** 제 글자를 그린다", () => {
    for (const badge of LIST_BADGES) {
      const html = renderWith([], badge.render("domesticOrderList"));
      assert.ok(
        html.includes(badge.label),
        `${badge.name}: 끄지도 않았는데 안 보인다 — 표본이 비면 아래 시험이 공짜로 통과한다`
      );
      // 🔵 꺼졌을 때의 글자와 **다른 글자**여야 한다. 같으면 아래 ①이 아무것도 못 잰다.
      assert.notEqual(html, badge.whenHidden, `${badge.name}: 켠 것과 끈 것이 같은 글자다`);
    }
  });

  test("🔵 등록부의 다섯과 글자가 맞는다 — 세는 대상이 등록부에서 왔다", () => {
    const registered = [
      ...new Set(
        BADGE_PLACEMENTS.filter((one) => one.placeKey === "domesticOrderList").map(
          (one) => one.badgeKey as string
        )
      ),
    ].sort();
    const measured = [...new Set(LIST_BADGES.map((one) => one.badgeKey as string))].sort();
    assert.deepEqual(measured, registered, "내자 정리 목록에 뜨는 배지 목록이 등록부와 어긋난다");
    assert.equal(registered.length, 5);
  });
});

describe("내자 정리 — ①②③ 끈 쌍만 사라진다", () => {
  for (const badge of LIST_BADGES) {
    test(`🔴 ${badge.name}: 끄면 그 글자가 한 글자도 안 남는다`, () => {
      const html = renderWith(
        [{ badgeKey: badge.badgeKey, placeKey: "domesticOrderList" }],
        badge.render("domesticOrderList")
      );
      assert.equal(html.includes(badge.label), false, `껐는데 그대로 있다: ${badge.name}`);
      assert.equal(html, badge.whenHidden, `꺼진 자리에 남는 글자가 달라졌다: ${html}`);
    });

    test(`🔴 ${badge.name}: 자리를 안 넘기면 꺼도 그대로 그린다`, () => {
      const html = renderWith(
        [{ badgeKey: badge.badgeKey, placeKey: "domesticOrderList" }],
        badge.render(undefined)
      );
      assert.ok(
        html.includes(badge.label),
        `자리를 안 넘겼는데 사라졌다: ${badge.name} — 설정 화면의 보기 배지가 함께 죽는 모양이다`
      );
    });

    test(`🔵 ${badge.name}: **다른 자리**를 끈 것은 영향이 없다`, () => {
      const html = renderWith(
        [{ badgeKey: badge.badgeKey, placeKey: "repairCaseDetailHeader" }],
        badge.render("domesticOrderList")
      );
      assert.ok(
        html.includes(badge.label),
        `다른 자리를 껐는데 여기서 사라졌다: ${badge.name} — 쌍이 아니라 배지째 꺼지고 있다`
      );
    });

    test(`🔵 ${badge.name}: Provider 가 아예 없어도 보인다`, () => {
      const html = renderToStaticMarkup(badge.render("domesticOrderList"));
      assert.ok(html.includes(badge.label), `${badge.name}: Provider 없이 사라졌다`);
    });
  }
});

/* ═══════════════════════════════ ⑤ 「수리 건 요청일」은 꼬리표만 */

describe("⑤ 🔴 「수리 건 요청일」을 끄면 **꼬리표만** 빠진다 — 날짜는 못 끈다", () => {
  const listScreen = codeOf("src/components/domestic-orders/DomesticOrderListScreen.tsx");
  const badges = codeOf("src/components/domestic-orders/badges.tsx");

  test("🔴 꼬리표 조각은 **날짜를 아예 받지 않는다** — 구조상 날짜를 가릴 수 없다", () => {
    const start = badges.indexOf("export function DueDateFromRepairCaseBadge(");
    assert.ok(start >= 0, "꼬리표 조각을 못 찾았다");
    const props = badges.slice(start, badges.indexOf(") {", start));
    // 받는 것은 자리 하나뿐이다. 날짜를 받게 되는 순간 「날짜까지 사라지는」 길이 열린다.
    for (const forbidden of ["dueDate", "line", "display", "row"]) {
      assert.equal(props.includes(forbidden), false, `꼬리표가 날짜 쪽을 받는다: ${props}`);
    }
    assert.ok(props.includes("placeKey"), props);
  });

  test("🔴 날짜는 꼬리표 **밖**에 있다 — 화면이 둘을 한 덩이로 묶지 않았다", () => {
    const cell = listScreen.slice(
      listScreen.indexOf("function DueDateCellContent("),
      listScreen.indexOf("function OrderIssuedDateContent(")
    );
    assert.ok(cell.length > 200, `표본이 비었다(${cell.length})`);
    const dateAt = cell.indexOf(
      "{inverted ? <span className={DUE_DATE_NEAR_TEXT_CLASS}>{line}</span> : line}"
    );
    const badgeAt = cell.indexOf("<DueDateFromRepairCaseBadge");
    assert.ok(dateAt > 0, "날짜를 그리는 자리를 못 찾았다");
    assert.ok(badgeAt > dateAt, "꼬리표가 날짜보다 앞에 있다 — 날짜가 꼬리표 안에 들어갔다");
  });

  test("🔴 날짜와 꼬리표 **사이의 빈칸도 꼬리표 쪽**이다 — 끈 자리에 빈칸이 안 남는다", () => {
    // 빈칸을 밖에 두면 꼬리표를 끈 줄 끝에 빈칸 하나가 남아 줄바꿈을 일으킨다.
    // 그 빈칸은 꼬리표가 입는 옷 안에 있다(borrowedBadgeClass 의 ml-1.5).
    const hidden = renderWith(
      [{ badgeKey: "dueDateFromRepairCase", placeKey: "domesticOrderList" }],
      <DueDateFromRepairCaseBadge placeKey="domesticOrderList" />
    );
    assert.equal(hidden, "", `꺼진 꼬리표가 무언가를 남겼다: ${JSON.stringify(hidden)}`);
    const shown = renderWith([], <DueDateFromRepairCaseBadge placeKey="domesticOrderList" />);
    assert.ok(shown.includes("ml-1.5"), `빈칸이 꼬리표 밖에 있다: ${shown}`);
  });
});

/* ═══════════════════════════════ 기타건 현황 — 표와 카드를 **둘 다** */

/** 🔴 지어낸 값들. 공개 저장소라 실제 고객사·발주서번호를 쓰지 않는다. */
const FAKE_MISC_ID = "misc-fake-badge-1";
function fakeMiscRow(overrides: Partial<MiscCaseRow> = {}): MiscCaseRow {
  return {
    id: FAKE_MISC_ID,
    repairCaseId: null,
    modelName: "시험용 품목",
    customerName: "시험용 공급처",
    status: "SHIPMENT_READY",
    finalShipmentApproved: true,
    displayQuoteNumber: "TEST-Q-0001",
    displayQuoteIssuedDate: "2094-09-30",
    purchaseOrderNumber: "TEST-PO-0001",
    orderIssuedDate: "2094-10-02",
    projectName: "시험용 PJT",
    progressNote: "시험용 현황",
    displayAmountExcludingVat: "1234567",
    paymentCompleted: false,
    deliveredDateLines: ["2094-10-20"],
    deliveredByLines: ["시험용 담당"],
    deliveredDateBorrowed: false,
    ...overrides,
  };
}

/** 기타건 현황에 서는 배지 둘. 글자는 **한 벌도 여기서 짓지 않는다**. */
const MISC_BADGES: readonly { badgeKey: BadgeKey; label: string }[] = [
  { badgeKey: "miscCaseStatus", label: MISC_CASE_STATUS_LABELS.SHIPMENT_READY },
  { badgeKey: "finalShipmentApproved", label: FINAL_SHIPMENT_APPROVED_LABEL },
];

/** 🔴 표와 카드 **둘 다** 잰다(④). 자리 키는 misc-case-fields.tsx 한 벌에 박혀 있다. */
const MISC_SCREENS: readonly { name: string; render: (rows: MiscCaseRow[]) => ReactElement }[] = [
  {
    name: "기타건 현황 표",
    render: (rows) => (
      <MiscCaseTable rows={rows} sort={MISC_CASE_DEFAULT_SORT} onSortChange={() => {}} />
    ),
  },
  { name: "기타건 현황 카드", render: (rows) => <MiscCaseCardList rows={rows} /> },
];

describe("기타건 현황 — ⓪ 표본이 비어 있지 않다", () => {
  for (const screen of MISC_SCREENS) {
    test(`${screen.name}: 아무것도 안 끄면 배지 둘이 다 보인다`, () => {
      const html = renderWith([], screen.render([fakeMiscRow()]));
      assert.ok(html.length > 500, `화면이 거의 비어 있다: ${html}`);
      for (const badge of MISC_BADGES) {
        assert.ok(hasBadge(html, badge.label), `${badge.badgeKey}: 끄지도 않았는데 안 보인다`);
      }
    });
  }

  test("🔵 등록부의 둘과 글자가 맞는다", () => {
    const registered = BADGE_PLACEMENTS.filter((one) => one.placeKey === "miscCaseList")
      .map((one) => one.badgeKey as string)
      .sort();
    assert.deepEqual(MISC_BADGES.map((one) => one.badgeKey as string).sort(), registered);
    assert.equal(registered.length, 2);
  });
});

for (const screen of MISC_SCREENS) {
  describe(`${screen.name} — ①③ 끈 쌍만 사라진다`, () => {
    for (const badge of MISC_BADGES) {
      test(`🔴 ${badge.badgeKey} 를 끄면 「${badge.label}」 가 한 글자도 안 남는다`, () => {
        const html = renderWith(
          [{ badgeKey: badge.badgeKey, placeKey: "miscCaseList" }],
          screen.render([fakeMiscRow()])
        );
        assert.equal(hasBadge(html, badge.label), false, `껐는데 그대로 있다: ${badge.badgeKey}`);
        // ③ 옆 배지는 멀쩡하다 — 하나를 끄면 칸이 통째로 비는 식이면 안 된다.
        for (const other of MISC_BADGES) {
          if (other.badgeKey === badge.badgeKey) continue;
          assert.ok(
            hasBadge(html, other.label),
            `${badge.badgeKey} 를 껐는데 ${other.badgeKey} 까지 사라졌다`
          );
        }
      });

      test(`🔵 **기타건 상세 머리말**을 끈 것은 ${badge.badgeKey} 에 영향이 없다`, () => {
        const html = renderWith(
          [{ badgeKey: badge.badgeKey, placeKey: "miscCaseDetailHeader" }],
          screen.render([fakeMiscRow()])
        );
        assert.ok(
          hasBadge(html, badge.label),
          `상세 머리말을 껐는데 목록에서 사라졌다: ${badge.badgeKey}`
        );
      });
    }

    test("🔵 Provider 가 아예 없어도 둘이 전부 보인다", () => {
      const html = renderToStaticMarkup(screen.render([fakeMiscRow()]));
      for (const badge of MISC_BADGES) {
        assert.ok(hasBadge(html, badge.label), `${badge.badgeKey}: Provider 없이 사라졌다`);
      }
    });
  });
}

/* ═══════════════════════════════ ⑦ 줄은 그대로 남는다 */

describe("⑦ 🔴 배지를 다 꺼도 **그 줄이 목록에서 사라지지 않는다**", () => {
  const ALL_MISC_HIDDEN: readonly BadgePlacement[] = MISC_BADGES.map((badge) => ({
    badgeKey: badge.badgeKey,
    placeKey: "miscCaseList" as BadgePlaceKey,
  }));

  for (const screen of MISC_SCREENS) {
    test(`${screen.name}: 배지 둘이 다 사라져도 줄의 값은 그대로다`, () => {
      const row = fakeMiscRow();
      const html = renderWith(ALL_MISC_HIDDEN, screen.render([row]));
      for (const badge of MISC_BADGES) {
        assert.equal(hasBadge(html, badge.label), false, `${badge.badgeKey}: 안 꺼졌다`);
      }
      // 🔴 배지는 **표시**일 뿐이다 — 거르기·차례·줄 수에 손대면 안 된다.
      for (const value of [row.modelName, row.customerName, row.purchaseOrderNumber]) {
        assert.ok(html.includes(value as string), `배지를 껐더니 줄의 값이 사라졌다: ${value}`);
      }
      assert.ok(html.includes(`/domestic-orders/${FAKE_MISC_ID}`), "상세로 가는 길이 사라졌다");
    });
  }

  test("🔴 표의 줄 수가 그대로다 — 숨긴 건이 빠지지 않았다", () => {
    const rows = [fakeMiscRow(), fakeMiscRow({ id: "misc-fake-badge-2", modelName: "시험용 품목2" })];
    const node = (
      <MiscCaseTable rows={rows} sort={MISC_CASE_DEFAULT_SORT} onSortChange={() => {}} />
    );
    const shown = renderWith([], node);
    const hidden = renderWith(ALL_MISC_HIDDEN, node);
    const bodyRows = (html: string) => html.split("<tr").length - 1;

    assert.equal(bodyRows(shown), 3, "머리글 한 줄 + 본문 두 줄이 아니다 — 표본이 달라졌다");
    assert.equal(bodyRows(hidden), bodyRows(shown), "배지를 껐더니 줄이 줄었다");
    assert.ok(hidden.includes("시험용 품목2"), "둘째 줄이 통째로 사라졌다");
  });

  test("🔵 거르기·차례는 애초에 배지를 모른다 — 도메인 쪽에 그 함수들이 따로 있다", () => {
    for (const relativePath of [
      "src/lib/domain/domestic-order-list.ts",
      "src/lib/domain/misc-case-list.ts",
    ]) {
      const source = read(relativePath);
      // 🔵 못 — 표본이 비면 아래가 아무것도 안 잰다(그 파일이 실제로 거르기를 쥔다).
      assert.ok(source.includes("export function"), `${relativePath}: 표본이 비었다`);
      for (const forbidden of ["badgeVisibility", "isBadgeVisible", "placeKey"]) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${relativePath}: 거르기·차례가 배지 설정을 안다: ${forbidden}`
        );
      }
    }
  });
});

/* ═══════════════════════════════ 기타건 상세 — 머리 카드 */

/** 🔴 지어낸 값들. 네 알약이 그려지는 데 필요한 만큼만. */
const FAKE_HEAD_ROW = {
  modelName: "시험용 품목",
  customerName: "시험용 공급처",
  displayQuoteIssuedDate: "2094-09-30",
  displayQuoteNumber: "TEST-Q-0001",
};

describe("기타건 상세 머리 카드 — 배지 둘이 이 자리에서만 꺼진다", () => {
  const header = (hidden: readonly BadgePlacement[]) =>
    renderWith(
      hidden,
      <DomesticOrderDetailHeader
        row={FAKE_HEAD_ROW}
        status="SHIPMENT_READY"
        finalShipmentApproved
      />
    );
  const HEAD_BADGES: readonly { badgeKey: BadgeKey; label: string }[] = [
    { badgeKey: "miscCaseStatus", label: MISC_CASE_STATUS_LABELS.SHIPMENT_READY },
    { badgeKey: "finalShipmentApproved", label: FINAL_SHIPMENT_APPROVED_LABEL },
  ];

  test("⓪ 아무것도 안 끄면 둘이 다 보인다", () => {
    const html = header([]);
    assert.ok(html.includes("기타건 상세"), html);
    for (const badge of HEAD_BADGES) {
      assert.ok(hasBadge(html, badge.label), `${badge.badgeKey}: 끄지도 않았는데 안 보인다`);
    }
  });

  test("🔵 등록부의 둘과 글자가 맞는다", () => {
    const registered = BADGE_PLACEMENTS.filter((one) => one.placeKey === "miscCaseDetailHeader")
      .map((one) => one.badgeKey as string)
      .sort();
    assert.deepEqual(HEAD_BADGES.map((one) => one.badgeKey as string).sort(), registered);
    assert.equal(registered.length, 2);
  });

  for (const badge of HEAD_BADGES) {
    test(`🔴 ${badge.badgeKey} 를 끄면 머리 카드에서 사라진다 — 값 알약 넷은 그대로다`, () => {
      const html = header([{ badgeKey: badge.badgeKey, placeKey: "miscCaseDetailHeader" }]);
      assert.equal(hasBadge(html, badge.label), false, `껐는데 그대로 있다: ${badge.badgeKey}`);
      // 🔴 값 알약 넷은 **배지가 아니다** — 설정으로 사라지면 안 된다.
      for (const value of Object.values(FAKE_HEAD_ROW)) {
        assert.ok(html.includes(value), `배지를 껐더니 값 알약이 사라졌다: ${value}`);
      }
      // ③ 옆 배지는 멀쩡하다.
      for (const other of HEAD_BADGES) {
        if (other.badgeKey === badge.badgeKey) continue;
        assert.ok(hasBadge(html, other.label), `${badge.badgeKey} 를 껐는데 ${other.badgeKey} 까지 사라졌다`);
      }
    });

    test(`🔵 **기타건 현황 목록**을 끈 것은 머리 카드에 영향이 없다`, () => {
      const html = header([{ badgeKey: badge.badgeKey, placeKey: "miscCaseList" }]);
      assert.ok(hasBadge(html, badge.label), `목록을 껐는데 머리 카드에서 사라졌다: ${badge.badgeKey}`);
    });
  }

  test("🔵 Provider 가 아예 없어도 둘이 전부 보인다", () => {
    const html = renderToStaticMarkup(
      <DomesticOrderDetailHeader
        row={FAKE_HEAD_ROW}
        status="SHIPMENT_READY"
        finalShipmentApproved
      />
    );
    for (const badge of HEAD_BADGES) {
      assert.ok(hasBadge(html, badge.label), `${badge.badgeKey}: Provider 없이 사라졌다`);
    }
  });
});

/* ═══════════════════════════════ ② 자리를 안 주면 언제나 그린다 */

describe("② 🔴 29쌍을 **전부** 꺼도 자리 없는 조각들은 그대로 그려진다", () => {
  /**
   * 🔴 이것이 설정 화면의 보기 배지를 지키는 바로 그 성질이다. 이 조각에서 보기
   * 배지가 넷 늘었으므로(badge-samples.tsx — 떼어낸 조각을 그대로 쓴다) 여기서
   * **그 넷과 기타건 쪽 둘**을 함께 본다. 화면째로 다시 보는 것은
   * settings/badge-visibility-panel.test.tsx 의 ③ 묶음이다.
   */
  const EVERY_PLACEMENT_HIDDEN = BADGE_PLACEMENTS;

  const SAMPLES: readonly { name: string; node: ReactElement; label: string }[] = [
    ...LIST_BADGES.map((badge) => ({
      name: badge.name,
      node: badge.render(undefined),
      label: badge.label,
    })),
    {
      name: "기타건 상태",
      node: <MiscCaseStatusBadge status="IN_PROGRESS" />,
      label: MISC_CASE_STATUS_LABELS.IN_PROGRESS,
    },
    {
      name: "최종 출하 승인 완료(기본 치수)",
      node: <FinalShipmentApprovedBadge approved />,
      label: FINAL_SHIPMENT_APPROVED_LABEL,
    },
  ];

  test("🔴 등록부의 쌍이 29다 — 이 수가 곧 설정 화면의 체크상자 수다", () => {
    assert.equal(EVERY_PLACEMENT_HIDDEN.length, 29);
  });

  for (const sample of SAMPLES) {
    test(`🔴 ${sample.name}: 자리를 안 주면 29쌍을 다 꺼도 그대로다`, () => {
      const html = renderWith(EVERY_PLACEMENT_HIDDEN, sample.node);
      assert.ok(
        html.includes(sample.label),
        `${sample.name}: 자리를 안 줬는데 설정을 따라 사라졌다 — 설정 화면의 보기 배지가 함께 죽는다`
      );
    });
  }
});

/* ═══════════════════════════════ 쌍 세기 — 아홉, 그리고 스물아홉 */

describe("🔴 쌍 세기 — 이번 아홉이 전부 붙었고, 29쌍이 **전부** 붙었다", () => {
  /** 이번 조각이 맡은 자리 셋. */
  const NEW_PLACES: readonly BadgePlaceKey[] = [
    "domesticOrderList",
    "miscCaseList",
    "miscCaseDetailHeader",
  ];

  test("🔴 등록부에서 세어 **9** 다 — 이 수가 달라지면 아래 전수 검사를 다시 볼 것", () => {
    const pairs = BADGE_PLACEMENTS.filter((one) =>
      (NEW_PLACES as readonly string[]).includes(one.placeKey)
    );
    assert.equal(pairs.length, 9);
    // 나머지 스물은 조각 3이 붙인 수리건 쪽이다
    // (repair-cases/badge-visibility-screens.test.tsx 가 그 20을 따로 센다).
    assert.equal(BADGE_PLACEMENTS.length - pairs.length, 20);
    // 🔴 **합이 29** — 설정 화면의 체크상자 수와 같은 수다.
    assert.equal(BADGE_PLACEMENTS.length, 29);
    // 🔵 못 — 자리가 **등록부에도 꼭 셋**인가. 여기 목록만 줄이고 등록부에 자리가
    //    남아 있으면 「안 붙은 자리」가 생기는데 위 셈은 그대로 맞는다.
    assert.equal(
      BADGE_PLACES.filter((place) => !place.key.startsWith("repairCase")).length,
      NEW_PLACES.length
    );
  });

  /**
   * 🔴 **자리를 넘기는 호출부 전수.** 그 여는 태그가 **하나도 빠짐없이** 제 자리를
   * 받는지 본다 — 「하나라도 받으면 통과」로 세면 표는 꺼지는데 카드는 안 꺼지는
   * 모양이 그대로 통과한다(이 저장소가 유·무상·날짜·L/N 에서 세 번 겪은 결함).
   */
  const CALL_SITES: readonly {
    file: string;
    tag: string;
    placeKey: BadgePlaceKey;
    badgeKey: BadgeKey;
    count: number;
  }[] = [
    // 내자 정리 목록 — 여덟 자리(쌍은 다섯이다. 완료·발주일 미정은 표와 카드 둘씩,
    // 최종 출하 승인은 줄 단위와 회차별 둘이다).
    {
      file: "src/components/domestic-orders/DomesticOrderListScreen.tsx",
      tag: "<FinalShipmentApprovedBadge",
      placeKey: "domesticOrderList",
      badgeKey: "finalShipmentApproved",
      count: 2,
    },
    {
      file: "src/components/domestic-orders/DomesticOrderListScreen.tsx",
      tag: "<DueDateFromRepairCaseBadge",
      placeKey: "domesticOrderList",
      badgeKey: "dueDateFromRepairCase",
      count: 1,
    },
    {
      file: "src/components/domestic-orders/DomesticOrderListScreen.tsx",
      tag: "<DomesticOrderCompletedBadge",
      placeKey: "domesticOrderList",
      badgeKey: "domesticOrderCompleted",
      count: 2,
    },
    {
      file: "src/components/domestic-orders/DomesticOrderListScreen.tsx",
      tag: "<DueDateRowCompletedBadge",
      placeKey: "domesticOrderList",
      badgeKey: "dueDateRowCompleted",
      count: 1,
    },
    {
      file: "src/components/domestic-orders/DomesticOrderListScreen.tsx",
      tag: "<OrderIssuedDateMissingBadge",
      placeKey: "domesticOrderList",
      badgeKey: "orderIssuedDateMissing",
      count: 1,
    },
    {
      file: "src/components/domestic-orders/DomesticOrderListScreen.tsx",
      tag: "<OrderIssuedDateMissingText",
      placeKey: "domesticOrderList",
      badgeKey: "orderIssuedDateMissing",
      count: 1,
    },
    // 기타건 현황 — 표와 카드가 **이 한 벌**을 먹는다(한쪽만 꺼질 자리가 없다).
    {
      file: "src/components/misc-cases/misc-case-fields.tsx",
      tag: "<MiscCaseStatusBadge",
      placeKey: "miscCaseList",
      badgeKey: "miscCaseStatus",
      count: 1,
    },
    {
      file: "src/components/misc-cases/misc-case-fields.tsx",
      tag: "<FinalShipmentApprovedBadge",
      placeKey: "miscCaseList",
      badgeKey: "finalShipmentApproved",
      count: 1,
    },
    // 기타건 상세 머리 카드.
    {
      file: "src/components/domestic-orders/detail/DomesticOrderDetailHeader.tsx",
      tag: "<MiscCaseStatusBadge",
      placeKey: "miscCaseDetailHeader",
      badgeKey: "miscCaseStatus",
      count: 1,
    },
    {
      file: "src/components/domestic-orders/detail/DomesticOrderDetailHeader.tsx",
      tag: "<FinalShipmentApprovedBadge",
      placeKey: "miscCaseDetailHeader",
      badgeKey: "finalShipmentApproved",
      count: 1,
    },
  ];

  /** 여는 태그를 **전부** 잘라 온다 — 하나만 보면 나머지가 조용히 빠진다. */
  function openingTags(source: string, tag: string): string[] {
    const tags: string[] = [];
    let at = source.indexOf(tag);
    while (at >= 0) {
      const end = source.indexOf("/>", at);
      assert.ok(end > at, `'${tag}' 의 태그가 안 닫힌다`);
      tags.push(source.slice(at, end));
      at = source.indexOf(tag, end);
    }
    return tags;
  }

  test("🔴 호출부 열 자리가 **하나도 빠짐없이** 제 자리 키를 받는다", () => {
    for (const site of CALL_SITES) {
      const tags = openingTags(codeOf(site.file), site.tag);
      assert.equal(
        tags.length,
        site.count,
        `${site.file} 의 ${site.tag} 자리 수가 달라졌다(${tags.length}) — 늘었으면 함께 자리를 넘길 것`
      );
      for (const tag of tags) {
        assert.ok(
          tag.includes(`placeKey="${site.placeKey}"`),
          `${site.file}: ${site.tag} 가 자리를 안 받는다 — 그 한 자리만 안 꺼진다`
        );
      }
    }
  });

  test("🔴 호출부가 덮은 쌍이 **등록부의 아홉과 꼭 같다**", () => {
    const covered = [
      ...new Set(CALL_SITES.map((site) => `${site.badgeKey} ${site.placeKey}`)),
    ].sort();
    const registered = BADGE_PLACEMENTS.filter((one) =>
      (NEW_PLACES as readonly string[]).includes(one.placeKey)
    )
      .map((one) => `${one.badgeKey} ${one.placeKey}`)
      .sort();
    assert.deepEqual(covered, registered, "붙인 쌍과 등록부의 쌍이 어긋난다");
    assert.equal(covered.length, 9);
  });

  test("🔴 이 셋은 **남의 자리 키를 들고 있지 않다** — 적어 두는 것 자체가 거짓말이다", () => {
    // 허용되지 않는 쌍은 판정이 언제나 「보임」이라 오류도 안 나고 화면도 안 바뀐다 —
    // 꺼도 아무 일이 안 일어나는 글자가 조용히 남는다.
    const OWN: Record<string, readonly string[]> = {
      "src/components/domestic-orders/DomesticOrderListScreen.tsx": ["domesticOrderList"],
      "src/components/misc-cases/misc-case-fields.tsx": ["miscCaseList"],
      "src/components/domestic-orders/detail/DomesticOrderDetailHeader.tsx": [
        "miscCaseDetailHeader",
      ],
    };
    for (const [file, own] of Object.entries(OWN)) {
      const source = codeOf(file);
      // 🔵 못 — 제 자리는 실제로 적혀 있다(표본이 비면 아래 금지가 공짜로 통과한다).
      for (const key of own) assert.ok(source.includes(`placeKey="${key}"`), `${file}: 표본이 비었다`);
      for (const place of BADGE_PLACES) {
        if (own.includes(place.key)) continue;
        assert.equal(
          source.includes(`placeKey="${place.key}"`),
          false,
          `${file}: 남의 자리(${place.key})를 들고 있다`
        );
      }
    }
  });
});
