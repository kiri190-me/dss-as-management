import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import RepairCaseTable from "./RepairCaseTable";
import RepairCaseCardList from "./RepairCaseCardList";
import {
  DueDateNearBadge,
  HoldBadge,
  OverdueBadge,
  PriorityBadge,
  SourceBadge,
  StatusBadge,
  WorkflowOverrideBadge,
} from "./badges";
import FinalShipmentApprovedBadge from "@/components/approvals/FinalShipmentApprovedBadge";
import { BadgeVisibilityProvider } from "@/components/providers/BadgeVisibilityProvider";
import {
  BADGE_PLACEMENTS,
  BADGE_PLACES,
  type BadgeKey,
  type BadgePlaceKey,
  type BadgePlacement,
  type BadgeVisibilityRow,
} from "@/lib/domain/badge-visibility";
import { DEFAULT_UI_TEXT } from "@/lib/domain/ui-text";
import { FINAL_SHIPMENT_APPROVED_LABEL } from "@/lib/domain/final-shipment-approval-badge";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import { DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL } from "@/lib/domain/requested-due-date-link";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { SortState } from "@/lib/domain/repair-case-filters";

/**
 * ============================================================================
 * 배지 표시 설정이 **수리건 쪽 화면 셋**에서 실제로 먹는다 (2026-11-13, 조각 3)
 * ============================================================================
 * 조각 1이 등록부와 판정을, 조각 2가 설정 화면과 저장을 만들었다. 거기까지는 체크를
 * 풀어도 **화면이 한 글자도 안 바뀌었다.** 이 조각이 그 설정을 화면에 잇는다.
 *
 * 🔴 못 박는 것 일곱
 *  ① 자리를 **주고** 그 쌍을 끄면 그 배지가 한 글자도 안 그려진다.
 *  ② 자리를 **안 주면** 끈 설정이 있어도 예전 그대로 그려진다 — 설정 화면의 보기
 *    배지와 설정 대상이 아닌 화면들(고객사 상세·제품모델 상세·내 작업·휴지통)이
 *    사는 길이다.
 *  ③ **다른 자리**를 끈 설정은 이 자리에 영향이 없다 — 쌍으로 끄는 기능이라 그렇다.
 *  ④ 🔴 **표와 카드를 각각** 잰다. 한쪽만 재면 폰에서만 안 꺼지는 것을 못 잡는다
 *    (RepairCaseCardList.tsx 머리말이 유·무상·날짜·L/N 에서 세 번 겪은 결함).
 *  ⑤ 🔴 「(내자)」는 **꼬리표만** 사라지고 **날짜는 남는다.** 표시 설정으로 자료가
 *    사라지면 그것은 표시 설정이 아니라 자료를 가리는 설정이다.
 *  ⑥ 🔴 배지를 숨겨도 **그 줄은 목록에 그대로 있다.** 배지는 표시일 뿐이라 거르기·
 *    차례에 손대면 안 된다.
 *  ⑦ 🔵 Provider 가 없어도 **전부 보임**으로 떨어진다(마이그레이션 전 DB·시험 환경).
 *
 * 🔵 함께 세는 것: 수리건 쪽 **세 자리의 쌍이 20개**이고 그 20개가 전부 화면에
 * 붙었는가. 셋 중 둘(상세 머리말·기본 정보 탭)은 이 환경에서 그려 볼 수 없어
 * (usePathname·server-only 사슬) 원본 글자로 읽는다 — 이웃
 * detail-header-placement.test.ts 와 같은 방법·같은 까닭이다.
 *
 * 🔵 **2026-11-13 늦게 「수리건 상세 — 작업 이력 탭」 묶음을 통째로 지웠다.** 이 파일에
 * ActivityHeaderSummary 의 네 쌍을 재는 묶음이 있었는데, 같은 날 등록부에서 그 자리를
 * 걷어내 **잴 것이 없어졌다**(그 자리를 그리는 살아 있는 화면이 없었다). 그 조각이
 * 자리를 다시 들고 있지 않은지는 아래 「설정 대상이 **아닌** 화면들」이 이어서 지킨다.
 *
 * 🔴 값은 전부 지어낸 것이다. 실제 고객사 이름·L/N·S/N 은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");

const FAKE_CASE_ID = "case-fake-badge-1";
const SORT: SortState = { column: "intakeNumber", direction: "desc" };

/** 이 건에는 날짜가 없고 연결된 내자 줄에만 있다 — 그래야 「(내자)」 꼬리표가 선다. */
const BORROWED_DUE_DATE = "2094-03-04";

/** 🔴 지어낸 값들. 공개 저장소라 실제 고객사·L/N·S/N 을 쓰지 않는다. */
function fakeRow(overrides: Partial<EffectiveRepairCase> = {}): EffectiveRepairCase {
  return {
    id: FAKE_CASE_ID,
    version: 1,
    source: "DATABASE",
    productId: "product-fake-1",
    intakeNumber: "D940202",
    legacyReportNumber: null,
    workflowType: "PAID_MATCHER",
    status: "IN_REPAIR",
    priority: "URGENT",
    exceptionStatus: null,
    currentWorkflowStepKey: "REPAIR",
    receivedAt: "2094-02-02",
    customerRequestedDueDate: null,
    domesticOrderDueDates: [BORROWED_DUE_DATE],
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    createdAt: "2094-02-02T00:00:00.000Z",
    isOverdue: true,
    productCategory: "TEST-CATEGORY",
    paidOrWarranty: "유상",
    billingType: "PAID",
    modelName: "TEST-MODEL-B",
    lotNumber: "TEST-LN-0002",
    serialNumber: "TEST-SN-0002",
    partNumber: null,
    customerId: "customer-fake-1",
    customerName: "시험용 고객사",
    endUserId: null,
    endUserName: null,
    assignedEngineerId: null,
    engineerName: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    effectiveStatus: "IN_REPAIR",
    effectiveWorkflowStepKey: "REPAIR",
    effectiveActualShipmentDate: null,
    effectiveIsOverdue: true,
    holdState: {
      isOnHold: true,
      reason: null,
      startedByUserId: null,
      startedByNameSnapshot: null,
      startedAt: null,
    },
    hasWorkflowOverride: true,
    ...overrides,
  };
}

const CASE_IDS: ReadonlySet<string> = new Set([FAKE_CASE_ID]);

/**
 * 끈 쌍을 저장된 행 모양으로. **끈 것만 행이 된다** — 켠 자리는 행이 아예 없고,
 * 그 빈자리가 「보임」이다(db/mutations 의 저장 규칙 · isBadgeVisible 의 규칙 2).
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

/**
 * 🔴 전체 A/S 현황에 서는 배지 아홉. 글자는 **한 벌도 여기서 짓지 않는다** —
 * 도메인·기본 문구에서 가져온다. 베껴 적으면 이름이 바뀌는 날 시험과 화면이 함께
 * 틀린 채로 통과한다.
 */
const LIST_BADGES: readonly { badgeKey: BadgeKey; label: string }[] = [
  { badgeKey: "repairStatus", label: DEFAULT_UI_TEXT.repairStatus.IN_REPAIR },
  { badgeKey: "priority", label: DEFAULT_UI_TEXT.priority.URGENT },
  { badgeKey: "source", label: "DB" },
  { badgeKey: "overdue", label: "납기 지연" },
  { badgeKey: "dueDateNear", label: NOTIFICATION_KIND_META.REPAIR_CASE_DUE_DATE_NEAR.label },
  { badgeKey: "hold", label: "보류 중" },
  { badgeKey: "workflowOverride", label: "로컬 워크플로 재정의" },
  { badgeKey: "finalShipmentApproved", label: FINAL_SHIPMENT_APPROVED_LABEL },
  { badgeKey: "dueDateFromDomesticOrderShort", label: DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL },
];

/** 표와 카드 — 🔴 **둘 다** 잰다(④). 자리를 받는 쪽과 안 받는 쪽을 함께 만든다. */
const LIST_SCREENS: readonly {
  name: string;
  render: (args: { placed: boolean }) => ReactElement;
}[] = [
  {
    name: "전체 A/S 현황 표",
    render: ({ placed }) => (
      <RepairCaseTable
        rows={[fakeRow()]}
        sort={SORT}
        onSortChange={() => {}}
        dueDateNearCaseIds={CASE_IDS}
        finalShipmentApprovedCaseIds={CASE_IDS}
        badgePlaceKey={placed ? "repairCaseList" : undefined}
      />
    ),
  },
  {
    name: "전체 A/S 현황 카드",
    render: ({ placed }) => (
      <RepairCaseCardList
        rows={[fakeRow()]}
        dueDateNearCaseIds={CASE_IDS}
        finalShipmentApprovedCaseIds={CASE_IDS}
        badgePlaceKey={placed ? "repairCaseList" : undefined}
      />
    ),
  },
];

/* ───────────────────────────── ⓪ 표본이 비어 있지 않다 */

describe("⓪ 무엇을 재는지 먼저 — 아홉이 **전부** 서 있는 화면에서 시작한다", () => {
  for (const screen of LIST_SCREENS) {
    test(`${screen.name}: 아무것도 안 끄면 배지 아홉이 다 보인다`, () => {
      const html = renderWith([], screen.render({ placed: true }));
      assert.ok(html.length > 500, `화면이 거의 비어 있다 — 아래 셈이 아무것도 안 잰다: ${html}`);
      for (const badge of LIST_BADGES) {
        assert.ok(
          hasBadge(html, badge.label),
          `${badge.badgeKey}: 끄지도 않았는데 안 보인다 — 표본이 비면 아래 시험이 공짜로 통과한다`
        );
      }
    });
  }

  test("🔵 등록부의 아홉과 글자가 맞는다 — 세는 대상이 등록부에서 왔다", () => {
    const registered = BADGE_PLACEMENTS.filter((one) => one.placeKey === "repairCaseList")
      .map((one) => one.badgeKey)
      .sort();
    assert.deepEqual(
      LIST_BADGES.map((one) => one.badgeKey).sort(),
      registered,
      "전체 A/S 현황에 뜨는 배지 목록이 등록부와 어긋난다"
    );
    assert.equal(registered.length, 9);
    for (const badge of LIST_BADGES) {
      assert.ok(badge.label.length > 0, `${badge.badgeKey}: 글자가 비었다`);
    }
  });
});

/* ───────────────────────────── ①②③ 끄면 사라지고, 옆은 그대로 */

for (const screen of LIST_SCREENS) {
  describe(`${screen.name} — 끈 쌍만 사라진다`, () => {
    for (const badge of LIST_BADGES) {
      test(`🔴 ${badge.badgeKey} 를 끄면 「${badge.label}」 가 한 글자도 안 남는다`, () => {
        const html = renderWith(
          [{ badgeKey: badge.badgeKey, placeKey: "repairCaseList" }],
          screen.render({ placed: true })
        );
        assert.equal(
          hasBadge(html, badge.label),
          false,
          `껐는데 그대로 있다: ${badge.badgeKey}`
        );
        // ③ 옆 배지는 멀쩡하다 — 하나를 끄면 줄이 통째로 비는 식이면 안 된다.
        for (const other of LIST_BADGES) {
          if (other.badgeKey === badge.badgeKey) continue;
          assert.ok(
            hasBadge(html, other.label),
            `${badge.badgeKey} 를 껐는데 ${other.badgeKey} 까지 사라졌다`
          );
        }
      });

      test(`🔴 자리를 안 넘기면 ${badge.badgeKey} 를 꺼도 그대로 그린다`, () => {
        const html = renderWith(
          [{ badgeKey: badge.badgeKey, placeKey: "repairCaseList" }],
          screen.render({ placed: false })
        );
        assert.ok(
          hasBadge(html, badge.label),
          `자리를 안 넘겼는데 사라졌다: ${badge.badgeKey} — 설정 화면의 보기 배지와 고객사 상세가 함께 죽는 모양이다`
        );
      });

      test(`🔵 **다른 자리**를 끈 것은 ${badge.badgeKey} 에 영향이 없다`, () => {
        const html = renderWith(
          [{ badgeKey: badge.badgeKey, placeKey: "repairCaseDetailHeader" }],
          screen.render({ placed: true })
        );
        assert.ok(
          hasBadge(html, badge.label),
          `상세 머리말을 껐는데 목록에서 사라졌다: ${badge.badgeKey} — 쌍이 아니라 배지째 꺼지고 있다`
        );
      });
    }

    test("🔵 Provider 가 아예 없어도 아홉이 전부 보인다", () => {
      // 마이그레이션 전 DB · 로컬 데모 모드 · 이 환경의 다른 시험들이 사는 길이다.
      const html = renderToStaticMarkup(screen.render({ placed: true }));
      for (const badge of LIST_BADGES) {
        assert.ok(hasBadge(html, badge.label), `${badge.badgeKey}: Provider 없이 사라졌다`);
      }
    });
  });
}

/* ───────────────────────────── ⑤ 「(내자)」는 꼬리표만 */

describe("⑤ 🔴 「(내자)」를 끄면 꼬리표만 빠지고 **날짜는 남는다**", () => {
  for (const screen of LIST_SCREENS) {
    test(`${screen.name}: 끄기 전에는 날짜와 꼬리표가 함께 선다`, () => {
      const html = renderWith([], screen.render({ placed: true }));
      assert.ok(html.includes(BORROWED_DUE_DATE), `빌려 온 날짜가 안 보인다: ${html}`);
      assert.ok(hasBadge(html, DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL), "꼬리표가 안 보인다");
    });

    test(`🔴 ${screen.name}: 끈 뒤에도 날짜가 그대로다`, () => {
      const html = renderWith(
        [{ badgeKey: "dueDateFromDomesticOrderShort", placeKey: "repairCaseList" }],
        screen.render({ placed: true })
      );
      assert.equal(
        hasBadge(html, DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL),
        false,
        "꼬리표가 안 꺼졌다"
      );
      assert.ok(
        html.includes(BORROWED_DUE_DATE),
        "꼬리표를 껐더니 날짜까지 사라졌다 — 표시 설정이 자료를 가리고 있다"
      );
    });
  }
});

/* ───────────────────────────── ⑥ 줄은 그대로 남는다 */

describe("⑥ 🔴 배지를 다 꺼도 **그 건이 목록에서 사라지지 않는다**", () => {
  /** 전체 A/S 현황의 아홉 쌍을 전부 끈 설정. */
  const ALL_LIST_HIDDEN: readonly BadgePlacement[] = LIST_BADGES.map((badge) => ({
    badgeKey: badge.badgeKey,
    placeKey: "repairCaseList" as BadgePlaceKey,
  }));

  for (const screen of LIST_SCREENS) {
    test(`${screen.name}: 배지 아홉이 다 사라져도 줄의 값은 그대로다`, () => {
      const row = fakeRow();
      const html = renderWith(ALL_LIST_HIDDEN, screen.render({ placed: true }));

      for (const badge of LIST_BADGES) {
        assert.equal(hasBadge(html, badge.label), false, `${badge.badgeKey}: 안 꺼졌다`);
      }
      // 🔴 배지는 **표시**일 뿐이다 — 거르기·차례·줄 수에 손대면 안 된다.
      for (const value of [row.intakeNumber, row.customerName, row.modelName, row.serialNumber]) {
        assert.ok(html.includes(value), `배지를 껐더니 줄의 값이 사라졌다: ${value}`);
      }
      assert.ok(html.includes(`/repair-cases/${FAKE_CASE_ID}`), "상세로 가는 길이 사라졌다");
    });
  }

  test("🔴 표의 줄 수가 그대로다 — 숨긴 건이 빠지지 않았다", () => {
    const rows = [fakeRow(), fakeRow({ id: "case-fake-badge-2", intakeNumber: "D940203" })];
    const node = (
      <RepairCaseTable
        rows={rows}
        sort={SORT}
        onSortChange={() => {}}
        dueDateNearCaseIds={CASE_IDS}
        finalShipmentApprovedCaseIds={CASE_IDS}
        badgePlaceKey="repairCaseList"
      />
    );
    const shown = renderWith([], node);
    const hidden = renderWith(ALL_LIST_HIDDEN, node);
    const bodyRows = (html: string) => html.split("<tr").length - 1;

    assert.equal(bodyRows(shown), 3, "머리글 한 줄 + 본문 두 줄이 아니다 — 표본이 달라졌다");
    assert.equal(bodyRows(hidden), bodyRows(shown), "배지를 껐더니 줄이 줄었다");
    assert.ok(hidden.includes("D940203"), "둘째 줄이 통째로 사라졌다");
  });

  test("🔵 거르기·차례는 애초에 배지를 모른다 — 도메인 쪽에 그 함수들이 따로 있다", () => {
    // 🔴 화면 코드가 배지 설정으로 줄을 빼거나 순서를 바꾸는 길을 아예 만들지
    //    않았는지 원본으로 본다(값 쪽은 domain/repair-case-filters.test.ts 가 본다).
    const filters = read("src/lib/domain/repair-case-filters.ts");
    for (const forbidden of ["badgeVisibility", "isBadgeVisible", "placeKey"]) {
      assert.equal(
        filters.includes(forbidden),
        false,
        `거르기·차례가 배지 설정을 안다: ${forbidden}`
      );
    }
  });
});

/* ───────────────────────────── 배지 조각 자체 */

describe("배지 조각 자체 — 자리를 안 주면 **언제나** 그린다", () => {
  /**
   * 🔴 이것이 설정 화면의 보기 배지를 지키는 바로 그 성질이다. 보기 배지 쪽은
   * settings/badge-visibility-panel.test.tsx 의 ③ 묶음이 화면째로 다시 본다 —
   * 여기서는 **조각 하나하나**가 그렇게 동작하는지를 잰다.
   */
  const EVERY_PLACEMENT_HIDDEN = hiddenRows(BADGE_PLACEMENTS);

  const SAMPLES: readonly { badgeKey: BadgeKey; node: ReactElement; label: string }[] = [
    {
      badgeKey: "repairStatus",
      node: <StatusBadge status="IN_REPAIR" />,
      label: DEFAULT_UI_TEXT.repairStatus.IN_REPAIR,
    },
    {
      badgeKey: "priority",
      node: <PriorityBadge priority="URGENT" />,
      label: DEFAULT_UI_TEXT.priority.URGENT,
    },
    { badgeKey: "source", node: <SourceBadge source="DATABASE" />, label: "DB" },
    { badgeKey: "overdue", node: <OverdueBadge isOverdue />, label: "납기 지연" },
    {
      badgeKey: "dueDateNear",
      node: <DueDateNearBadge isDueDateNear />,
      label: NOTIFICATION_KIND_META.REPAIR_CASE_DUE_DATE_NEAR.label,
    },
    { badgeKey: "hold", node: <HoldBadge isOnHold />, label: "보류 중" },
    {
      badgeKey: "workflowOverride",
      node: <WorkflowOverrideBadge hasOverride />,
      label: "로컬 워크플로 재정의",
    },
    {
      badgeKey: "finalShipmentApproved",
      node: <FinalShipmentApprovedBadge approved />,
      label: FINAL_SHIPMENT_APPROVED_LABEL,
    },
  ];

  test("🔴 29쌍을 전부 꺼도 **자리 없는** 배지 여덟이 그대로 그려진다", () => {
    assert.equal(EVERY_PLACEMENT_HIDDEN.length, 29, "등록부의 쌍이 29가 아니다");
    for (const sample of SAMPLES) {
      const html = renderToStaticMarkup(
        <BadgeVisibilityProvider value={EVERY_PLACEMENT_HIDDEN}>
          {sample.node}
        </BadgeVisibilityProvider>
      );
      assert.ok(
        hasBadge(html, sample.label),
        `${sample.badgeKey}: 자리를 안 줬는데 설정을 따라 사라졌다 — 설정 화면의 보기 배지가 함께 죽는다`
      );
    }
  });

  test("🔴 「납기 지연 / 정상」은 **둘 다** 끄는 한 쌍이다", () => {
    // 「정상」만 남으면 지연인 건에만 표시가 없는 꼴이 되어 거꾸로 읽힌다.
    const hiddenHere = hiddenRows([{ badgeKey: "overdue", placeKey: "repairCaseDetailHeader" }]);
    const normal = renderToStaticMarkup(
      <BadgeVisibilityProvider value={hiddenHere}>
        <OverdueBadge isOverdue={false} placeKey="repairCaseDetailHeader" />
      </BadgeVisibilityProvider>
    );
    const late = renderToStaticMarkup(
      <BadgeVisibilityProvider value={hiddenHere}>
        <OverdueBadge isOverdue placeKey="repairCaseDetailHeader" />
      </BadgeVisibilityProvider>
    );
    assert.equal(normal, "", `「정상」이 남았다: ${normal}`);
    assert.equal(late, "", `「납기 지연」이 남았다: ${late}`);
  });

  test("🔴 표의 「정상」 파란 알약도 함께 꺼진다 — 그 조각은 이 표에만 있다", () => {
    const node = (
      <RepairCaseTable
        rows={[fakeRow({ effectiveIsOverdue: false })]}
        sort={SORT}
        onSortChange={() => {}}
        badgePlaceKey="repairCaseList"
      />
    );
    assert.ok(hasBadge(renderWith([], node), "정상"), "표본이 비었다 — 「정상」이 애초에 없다");
    assert.equal(
      hasBadge(renderWith([{ badgeKey: "overdue", placeKey: "repairCaseList" }], node), "정상"),
      false,
      "「납기 지연 / 정상」을 껐는데 파란 「정상」만 남았다"
    );
  });

  test("🔵 승인 전이면 자리를 줘도 애초에 아무것도 안 그린다", () => {
    // 관문이 승인 판정 **뒤**에 있다는 사실(목록 한 쪽이 50줄이다).
    assert.equal(
      renderToStaticMarkup(
        <FinalShipmentApprovedBadge approved={false} placeKey="repairCaseList" />
      ),
      ""
    );
  });
});

/* ───────────────────────────── 세 자리 20쌍이 전부 붙었다 */

describe("🔴 수리건 쪽 세 자리 — 쌍 **20개**가 전부 화면에 붙었다", () => {
  const REPAIR_CASE_PLACES: readonly BadgePlaceKey[] = [
    "repairCaseList",
    "repairCaseDetailHeader",
    "repairCaseDetailBasicInfo",
  ];

  test("🔴 등록부에서 세어 20이다 — 이 수가 달라지면 아래 셋을 다시 볼 것", () => {
    const pairs = BADGE_PLACEMENTS.filter((one) =>
      (REPAIR_CASE_PLACES as readonly string[]).includes(one.placeKey)
    );
    assert.equal(pairs.length, 20);
    // 나머지 아홉은 내자 정리·기타건 쪽이다 — 조각 4의 일이라 아직 안 붙였다.
    assert.equal(BADGE_PLACEMENTS.length - pairs.length, 9);
    // 🔵 못 — 수리건 쪽 자리가 **등록부에도 꼭 셋**인가. 여기 목록만 줄이고 등록부에
    //    자리가 남아 있으면 「안 붙은 자리」가 생기는데 위 두 셈은 그대로 맞는다.
    assert.equal(
      BADGE_PLACES.filter((place) => place.key.startsWith("repairCase")).length,
      REPAIR_CASE_PLACES.length
    );
  });

  /**
   * 🔴 상세 머리말과 기본 정보 탭은 이 환경에서 **그려 볼 수 없다** — DetailHeader 는
   * usePathname 을, 두 구역의 부모는 server-only 사슬을 물고 있다. 그래서 글자로
   * 읽는다(detail-header-placement.test.ts 와 같은 방법). 목록(표·카드)은 위에서
   * 진짜로 그려서 쟀다.
   */
  const headerSource = flat(read("src/components/repair-cases/detail/DetailHeader.tsx"));
  const productInfoSource = flat(read("src/components/repair-cases/detail/ProductInfoSection.tsx"));
  const intakeInfoSource = flat(read("src/components/repair-cases/detail/IntakeInfoSection.tsx"));

  /** 그 여는 태그 하나만 잘라 본다 — 옆 태그의 자리 키에 걸리지 않게. */
  function openingTag(source: string, marker: string): string {
    const at = source.indexOf(marker);
    assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
    const end = source.indexOf("/>", at);
    assert.ok(end > at, `'${marker}' 의 태그가 안 닫힌다`);
    return source.slice(at, end);
  }

  test("🔴 상세 머리말 — 배지 여덟이 모두 `repairCaseDetailHeader` 를 받는다", () => {
    for (const marker of [
      "<StatusBadge",
      "<PriorityBadge",
      "<OverdueBadge",
      "<HoldBadge",
      "<WorkflowOverrideBadge",
      "<SourceBadge",
      "<DueDateNearBadge",
      "<FinalShipmentApprovedBadge",
    ]) {
      assert.ok(
        openingTag(headerSource, marker).includes('placeKey="repairCaseDetailHeader"'),
        `${marker} 가 자리를 안 받는다 — 머리말에서만 안 꺼진다`
      );
    }
    // 등록부의 그 자리에 뜨는 배지가 여덟이라는 사실과 맞대어 본다.
    assert.equal(
      BADGE_PLACEMENTS.filter((one) => one.placeKey === "repairCaseDetailHeader").length,
      8
    );
  });

  test("🔴 기본 정보 탭 — 과거 이력 줄의 둘과 출처 표시 하나", () => {
    for (const marker of ["<SourceBadge", "<StatusBadge"]) {
      assert.ok(
        openingTag(productInfoSource, marker).includes('placeKey="repairCaseDetailBasicInfo"'),
        `${marker} 가 자리를 안 받는다`
      );
    }
    // 「내자 정리에서 작성됨」은 알약이 아니라 상자 한 줄이라 조각 이름이 다르다.
    assert.ok(
      intakeInfoSource.includes('borrowedLabelPlaceKey="repairCaseDetailBasicInfo"'),
      "출처 표시가 자리를 안 받는다"
    );
    assert.ok(
      intakeInfoSource.includes('badgeKey="dueDateFromDomesticOrder"'),
      "출처 표시가 등록부의 어느 배지인지 말하지 않는다"
    );
    assert.equal(
      BADGE_PLACEMENTS.filter((one) => one.placeKey === "repairCaseDetailBasicInfo").length,
      3
    );
  });

  test("🔴 설정 대상이 **아닌** 화면들은 자리를 한 글자도 안 넘긴다", () => {
    // 등록부에 그 자리들이 없다 — 넘기면 허용되지 않는 쌍이라 판정은 「보임」이지만,
    // 자리를 적어 두는 것 자체가 「여기도 끌 수 있다」는 거짓말이 된다.
    // 🔵 짝으로 적은 글자는 **그 화면이 배지를 실제로 세운다는 증거**다. 없으면
    //    표본이 빈 것이고, 그 줄은 「자리를 안 넘긴다」를 공짜로 통과한다.
    //
    // 🔴 맨 아래 ActivityHeaderSummary 는 **아무도 안 부르는 죽은 파일**이라 다른 여덟과
    //    사정이 다르다. 그래도 여기 적는 까닭: 2026-11-13 에 등록부에서 「수리건 상세 —
    //    작업 이력 탭」 자리를 걷어냈는데(그 자리를 그리는 살아 있는 화면이 없었다),
    //    그 파일은 바로 전까지 그 자리를 넷에 들고 있었다. 자리를 되돌려 적어 넣으면
    //    허용되지 않는 쌍이라 판정은 언제나 「보임」 — 오류도 안 나고 화면도 안 바뀌어
    //    **조용히 아무것도 안 하는 글자**가 된다. 이 줄이 그때 멈춘다.
    //    🔵 이 파일을 지우기로 하면 여기 한 줄도 함께 지운다(읽기가 먼저 터진다).
    const SCREENS_OUTSIDE: readonly [string, string][] = [
      ["src/components/customers/CustomerRepairCaseHistory.tsx", "<RepairCaseTable"],
      ["src/components/product-models/ProductModelRepairCaseHistory.tsx", "<RepairCaseCardList"],
      ["src/components/repair-cases/mine/MyActiveWorkTable.tsx", "<StatusBadge"],
      ["src/components/repair-cases/mine/MyActiveWorkCardList.tsx", "<RequestedDueDateValue"],
      ["src/components/repair-cases/mine/MyWorkRecordsScreen.tsx", "<StatusBadge"],
      ["src/components/repair-cases/trash/RepairCaseTrashTable.tsx", "<StatusBadge"],
      ["src/components/repair-cases/trash/RepairCaseTrashCardList.tsx", "<StatusBadge"],
      ["src/components/repair-cases/workflow/WorkflowStageStatus.tsx", "<HoldBadge"],
      ["src/components/repair-cases/work-history/ActivityHeaderSummary.tsx", "<StatusBadge"],
    ];
    assert.equal(SCREENS_OUTSIDE.length, 9, "표본 수가 달라졌다 — 목록을 줄이지 않았는가");
    for (const [relativePath, marker] of SCREENS_OUTSIDE) {
      const source = read(relativePath);
      assert.ok(
        source.includes(marker),
        `${relativePath}: 표본이 비었다 — '${marker}' 가 없다(이 화면엔 잴 배지가 없다)`
      );
      for (const forbidden of ["placeKey", "badgePlaceKey"]) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${relativePath}: 설정 대상이 아닌 화면이 자리를 넘긴다`
        );
      }
    }
  });

  test("🔴 전체 A/S 현황만 자리를 넘긴다 — 표와 카드에 **같은 값**으로", () => {
    const listPage = flat(read("src/components/repair-cases/RepairCaseListPage.tsx"));
    assert.equal(
      listPage.split('badgePlaceKey="repairCaseList"').length - 1,
      2,
      "표와 카드 둘 다에 같은 자리를 안 넘긴다 — 한쪽만 넘기면 폰에서만 안 꺼진다"
    );
  });
});
