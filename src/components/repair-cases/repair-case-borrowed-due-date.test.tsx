import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import RepairCaseTable from "./RepairCaseTable";
import RepairCaseCardList from "./RepairCaseCardList";
import MyActiveWorkTable from "./mine/MyActiveWorkTable";
import MyActiveWorkCardList from "./mine/MyActiveWorkCardList";
import {
  DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL,
  DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_NOTE,
} from "@/lib/domain/requested-due-date-link";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { SortState } from "@/lib/domain/repair-case-filters";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";
import { DEFAULT_MY_WORK_SORT } from "@/lib/domain/my-active-work-sort";

/**
 * ============================================================================
 * 목록의 「고객 요청 납기일」 — 비면 내자 정리에서 빌려 그린다 (2026-10-19)
 * ============================================================================
 * 사용자 신고: 「[내자정리]에서 고객 요청 납기일을 적으면 [전체 A/S 현황] 표에는
 * 그 날짜가 안 나온다」. 빌려 오는 규칙은 2026-08-26 에 이미 있었는데 **상세정보와
 * 내자 목록 두 화면에만** 붙어 있었다. 어제 만든 종 알림 「납기 임박」이 빌려 온
 * 날짜로 뜨면서 같은 건이 두 날짜로 보이게 돼 틈이 드러났다.
 *
 * 🔴 **그린 결과(HTML)만 본다.** 원본을 글자로 읽는 시험이었다면 주석에 적힌
 * 「내자」에 단언이 걸려 화면에서 사라져도 통과한다(이웃 파일
 * repair-case-symptom-column.test.tsx 와 같은 규율).
 *
 * 🔴 못 박는 것 넷
 *  · 자기 칸이 비고 내자에 날짜가 있으면 **그 날짜가 보인다**(예전엔 "-" 였다).
 *  · 빌려 온 값에만 꼬리표가 붙고, 설명(title)이 함께 붙는다 — 표시 없이 날짜만
 *    그리면 "이 줄에 내가 적어 둔 값"으로 읽힌다.
 *  · 자기 칸이 적혀 있으면 **그 값이 이기고 꼬리표가 붙지 않는다.**
 *  · 양쪽 다 없으면 이 목록들이 쓰던 대로 "-" 다 — 「없음」 같은 말을 짓지 않는다.
 *
 * 🔵 네 화면(전체 A/S 현황 표·카드, 내 작업 표·카드)을 같은 잣대로 잰다. 한
 * 조각을 나눠 쓰지만, 네 곳 중 하나라도 그 조각을 안 쓰면 거기만 조용히 "-" 로
 * 남는다 — 그게 이번 결함의 모양이었다.
 *
 * 🔴 값은 전부 가짜다. 실제 고객사 이름·S/N·L/N 은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

/** 내자에 붙어 있는 날짜 둘. 빌려 올 때는 **가장 이른 하루**만 보여야 한다. */
const DOMESTIC_DUE_DATES = ["2094-11-20", "2094-10-20"];
const EARLIEST_DOMESTIC_DUE_DATE = "2094-10-20";
const OWN_DUE_DATE = "2094-12-01";

function fakeRow(overrides: Partial<EffectiveRepairCase> = {}): EffectiveRepairCase {
  return {
    id: "case-fake-1",
    version: 1,
    source: "DATABASE",
    productId: "product-fake-1",
    intakeNumber: "D940101",
    legacyReportNumber: null,
    workflowType: "PAID_MATCHER",
    status: "IN_REPAIR",
    priority: "NORMAL",
    exceptionStatus: null,
    currentWorkflowStepKey: "REPAIR",
    receivedAt: "2094-01-02",
    customerRequestedDueDate: null,
    domesticOrderDueDates: [],
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    createdAt: "2094-01-02T00:00:00.000Z",
    isOverdue: false,
    productCategory: "TEST-CATEGORY",
    paidOrWarranty: "유상",
    billingType: "PAID",
    modelName: "TEST-MODEL-A",
    lotNumber: "TEST-LN-0001",
    serialNumber: "TEST-SN-0001",
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
    effectiveIsOverdue: false,
    holdState: null,
    hasWorkflowOverride: false,
    ...overrides,
  };
}

function fakeMyRow(overrides: Partial<MyActiveWorkRow> = {}): MyActiveWorkRow {
  return {
    id: "case-fake-1",
    intakeNumber: "D940101",
    receivedAt: "2094-01-02",
    customerId: "customer-fake-1",
    customerName: "시험용 고객사",
    endUserName: null,
    productCategory: "TEST-CATEGORY",
    modelName: "TEST-MODEL-A",
    billingType: "PAID",
    serialNumber: "TEST-SN-0001",
    lotNumber: "TEST-LN-0001",
    status: "IN_REPAIR",
    currentWorkflowStepLabel: "수리",
    exceptionStatus: null,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    customerRequestedDueDate: null,
    domesticOrderDueDates: [],
    lastActivityAt: null,
    lastWorkRecordAt: null,
    activePartsRequestStatus: null,
    ...overrides,
  };
}

const SORT: SortState = { column: "intakeNumber", direction: "desc" };

/** 태그를 걷어 낸 보이는 글자. 공백은 한 칸으로 줄인다. */
function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 그려진 HTML 의 속성값에 들어간 모양. React 는 따옴표·앰퍼샌드를 실체 참조로
 * 바꿔 내보내므로(설명 문장에 작은따옴표가 들어 있다) 상수를 그대로 찾으면
 * **없는 것처럼 보인다** — 그러면 "설명이 붙었는가"도 "안 붙었는가"도 둘 다
 * 초록색이 되어 아무것도 지키지 못한다.
 */
function asAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** 바깥 태그 하나(td/dd …)마다 [여는 태그, 속 내용] 을 차례대로 뽑는다. */
function cells(html: string, tag: string): { open: string; inner: string }[] {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
  return [...html.matchAll(pattern)].map((m) => ({ open: m[1], inner: m[2] }));
}

/**
 * 네 화면을 같은 모양으로 재기 위한 어댑터. `due` 는 「그 화면이 고객 요청
 * 납기일을 그리는 칸」의 HTML 이다.
 */
const SCREENS: {
  name: string;
  due: (args: { own: string | null; domestic: readonly string[] }) => string;
}[] = [
  {
    name: "전체 A/S 현황 표",
    due: ({ own, domestic }) =>
      // 출하일 칸(여덟째 td) 안의 보조 줄이다 — 그 칸 전체를 보면 출하일까지
      // 섞이므로, 여기서는 칸 안쪽을 그대로 넘기고 아래에서 "고객요청" 뒤만 본다.
      cells(
        renderToStaticMarkup(
          <RepairCaseTable
            rows={[fakeRow({ customerRequestedDueDate: own, domesticOrderDueDates: domestic })]}
            sort={SORT}
            onSortChange={() => {}}
          />
        ),
        "td"
      )[7].inner,
  },
  {
    name: "전체 A/S 현황 카드",
    due: ({ own, domestic }) =>
      cells(
        renderToStaticMarkup(
          <RepairCaseCardList
            rows={[fakeRow({ customerRequestedDueDate: own, domesticOrderDueDates: domestic })]}
          />
        ),
        "dd"
      )[4].inner,
  },
  {
    name: "내 작업 표",
    due: ({ own, domestic }) =>
      cells(
        renderToStaticMarkup(
          <MyActiveWorkTable
            rows={[fakeMyRow({ customerRequestedDueDate: own, domesticOrderDueDates: domestic })]}
            sort={DEFAULT_MY_WORK_SORT}
            onSortChange={() => {}}
          />
        ),
        "td"
      )[5].inner,
  },
  {
    name: "내 작업 카드",
    due: ({ own, domestic }) =>
      cells(
        renderToStaticMarkup(
          <MyActiveWorkCardList
            rows={[fakeMyRow({ customerRequestedDueDate: own, domesticOrderDueDates: domestic })]}
          />
        ),
        "dd"
        // 🔵 dt 차례와 다르다 — 「제품」 칸이 dd 를 둘 쓴다(모델 줄 + S/N·L/N 줄).
      )[6].inner,
  },
];

for (const screen of SCREENS) {
  describe(`${screen.name} — 고객 요청 납기일`, () => {
    test("🔴 자기 칸이 비면 내자 정리의 가장 이른 날짜를 그린다 — 예전엔 \"-\" 였다", () => {
      const html = screen.due({ own: null, domestic: DOMESTIC_DUE_DATES });
      const text = visibleText(html);

      assert.ok(
        text.includes(EARLIEST_DOMESTIC_DUE_DATE),
        `빌려 온 날짜가 그려지지 않았다: ${text}`
      );
      // 여럿 중 하나를 고르는 일은 도메인이 한다 — 늦은 날짜가 함께 나오면
      // 화면이 제멋대로 전부 늘어놓고 있다는 뜻이다.
      assert.ok(!text.includes("2094-11-20"), `가장 이른 하루만 그려야 한다: ${text}`);
    });

    test("🔴 빌려 온 값에만 꼬리표가 붙고, 설명(title)이 함께 붙는다", () => {
      const html = screen.due({ own: null, domestic: DOMESTIC_DUE_DATES });

      assert.ok(
        visibleText(html).includes(DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL),
        "빌려 온 날짜에 꼬리표가 없다 — 이 줄에 적어 둔 값으로 읽힌다"
      );
      assert.ok(
        html.includes(`title="${asAttribute(DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_NOTE)}"`),
        "꼬리표만 붙고 설명이 없다 — 「내자」가 무슨 뜻인지 알 길이 없다"
      );
    });

    test("🔴 자기 칸이 적혀 있으면 그 값이 이기고 꼬리표가 붙지 않는다", () => {
      const html = screen.due({ own: OWN_DUE_DATE, domestic: DOMESTIC_DUE_DATES });
      const text = visibleText(html);

      assert.ok(text.includes(OWN_DUE_DATE), `자기 칸의 값이 그려지지 않았다: ${text}`);
      assert.ok(!text.includes(EARLIEST_DOMESTIC_DUE_DATE), `내자 날짜가 함께 새어 나왔다: ${text}`);
      assert.ok(
        !text.includes(DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL),
        "자기 칸의 값인데 빌려 왔다는 꼬리표가 붙었다"
      );
      assert.ok(
        !html.includes(asAttribute(DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_NOTE)),
        "빌리지 않았는데 설명이 붙었다"
      );
    });

    test("양쪽 다 없으면 쓰던 대로 \"-\" 다 — 「없음」 같은 말을 짓지 않는다", () => {
      const html = screen.due({ own: null, domestic: [] });
      const text = visibleText(html);

      assert.ok(text.includes("-"), `값이 없을 때 "-" 가 아니다: ${text}`);
      assert.ok(!text.includes("없음"), "없는 값에 「없음」 같은 말을 지어냈다");
      assert.ok(
        !text.includes(DUE_DATE_FROM_DOMESTIC_ORDER_SHORT_LABEL),
        "빌려 온 것이 없는데 꼬리표가 붙었다"
      );
    });
  });
}
