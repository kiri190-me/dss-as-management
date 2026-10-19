import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import RepairCaseTable from "./RepairCaseTable";
import RepairCaseCardList from "./RepairCaseCardList";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { SortState } from "@/lib/domain/repair-case-filters";

/**
 * ============================================================================
 * 「납기 임박」 배지 — 전체 A/S 현황 표·카드와 상세 머리 줄 (2026-10-19)
 * ============================================================================
 * 사용자 요구: 「납기 임박 배지를 전체 A/S 현황과 수리 건 상세 맨 위에 띄울 것」.
 * 같은 사실을 종 알림이 전날부터 말하고 있어서, 이 시험이 지키는 것은 **그 둘이
 * 같은 말을 하는가**가 먼저다.
 *
 * 🔴 못 박는 것 다섯
 *  ① 서버가 짚어 준 건에만 배지가 서고, 아닌 건에는 **한 글자도 안 선다**.
 *  ② 🔴 표와 카드가 **둘 다** 선다 — 표에만 넣으면 창 크기에 따라 보이는 사람과
 *    안 보이는 사람이 갈린다(RepairCaseCardList.tsx 머리말이 세 번 겪은 결함).
 *  ③ 🔴 「납기 지연」과 **색이 다르다.** 같은 색이면 「이미 늦음」과 「곧 늦음」이
 *    구별되지 않는다(사용자 결정 — 임박은 rose, 지연은 red).
 *  ④ 상세 머리 줄에도 같은 배지가 [폴더 열기] 묶음 안에 선다.
 *  ⑤ 🔴 **판정을 화면이 하지 않는다.** 「오늘」을 화면에서 만들면 서버가 그린 것과
 *    어긋나고(hydration), 조건을 화면에 적으면 종과 두 말이 된다. 화면은 서버가
 *    재 둔 묶음만 받는다.
 *
 * 🔴 ④⑤ 는 **글자로 읽는다** — 레이아웃과 페이지는 세션 · DB · server-only 사슬을
 * 물고 있어 이 환경에서 그려 볼 수 없다(이웃 detail-header-placement.test.ts 와 같은
 * 방법·같은 까닭).
 *
 * 🔴 값은 전부 가짜다. 실제 고객사 이름·S/N·L/N 은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 🔴 **주석을 걷어 낸 코드만.** 이 파일의 금지 단언(「오늘」을 만들지 않는다)을
 * 원본 그대로에 걸면 **주석에 적힌 `new Date()` 세 글자에 걸린다** — 그 함정을
 * 경고하려고 적어 둔 문장이 경고를 깨는 꼴이다. 반대쪽(이웃 파일
 * repair-case-borrowed-due-date.test.tsx)이 「주석에 걸려 통과한다」를 경계하는
 * 것과 같은 규율의 뒷면이다.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 종 알림이 이 종류를 부르는 이름 그대로 — 배지가 글자를 새로 짓지 않는다. */
const BADGE_LABEL = NOTIFICATION_KIND_META.REPAIR_CASE_DUE_DATE_NEAR.label;
const OVERDUE_LABEL = "납기 지연";

const FAKE_CASE_ID = "case-fake-1";
const SORT: SortState = { column: "intakeNumber", direction: "desc" };

function fakeRow(overrides: Partial<EffectiveRepairCase> = {}): EffectiveRepairCase {
  return {
    id: FAKE_CASE_ID,
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
    customerRequestedDueDate: "2094-12-01",
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

/** 서버가 내려 주는 모양 그대로 — 임박이 아니면 **아예 넘기지 않는다**(기본값 검사). */
function nearingIds(nearing: boolean): ReadonlySet<string> | undefined {
  return nearing ? new Set([FAKE_CASE_ID]) : undefined;
}

/** 그 이름표를 단 배지의 class 속성. 없으면 null — 「안 섰다」와 갈라 본다. */
function badgeClass(html: string, label: string): string | null {
  const match = html.match(new RegExp(`<span class="([^"]*)">${label}</span>`));
  return match ? match[1] : null;
}

const SCREENS: { name: string; render: (args: { nearing: boolean; overdue?: boolean }) => string }[] = [
  {
    name: "전체 A/S 현황 표",
    render: ({ nearing, overdue = false }) =>
      renderToStaticMarkup(
        <RepairCaseTable
          rows={[fakeRow({ effectiveIsOverdue: overdue })]}
          sort={SORT}
          onSortChange={() => {}}
          dueDateNearCaseIds={nearingIds(nearing)}
        />
      ),
  },
  {
    name: "전체 A/S 현황 카드",
    render: ({ nearing, overdue = false }) =>
      renderToStaticMarkup(
        <RepairCaseCardList
          rows={[fakeRow({ effectiveIsOverdue: overdue })]}
          dueDateNearCaseIds={nearingIds(nearing)}
        />
      ),
  },
];

for (const screen of SCREENS) {
  describe(`${screen.name} — 납기 임박 배지`, () => {
    test("🔴 서버가 짚어 준 건에만 선다", () => {
      const withBadge = screen.render({ nearing: true });
      const without = screen.render({ nearing: false });

      assert.ok(withBadge.includes(`>${BADGE_LABEL}</span>`), `임박인데 배지가 없다: ${withBadge}`);
      assert.ok(
        !without.includes(BADGE_LABEL),
        `임박이 아닌 건에 배지가 섰다 — 「곧 늦는다」가 늘 켜져 있으면 아무도 안 본다: ${without}`
      );
    });

    test("🔴 배지 글자는 종 알림의 종류 이름 그대로다 — 같은 것을 두 말로 부르지 않는다", () => {
      assert.equal(BADGE_LABEL, "납기 임박");
      assert.ok(screen.render({ nearing: true }).includes(`>${BADGE_LABEL}</span>`));
    });

    test("🔴 「납기 지연」과 색이 다르다 — 이미 늦음과 곧 늦음이 갈려 보여야 한다", () => {
      const html = screen.render({ nearing: true, overdue: true });

      const nearing = badgeClass(html, BADGE_LABEL);
      const overdue = badgeClass(html, OVERDUE_LABEL);
      assert.ok(nearing !== null, `임박 배지가 없다: ${html}`);
      assert.ok(overdue !== null, `지연 배지가 없다 — 대조가 사라지면 이 시험은 아무것도 못 지킨다: ${html}`);
      assert.notEqual(nearing, overdue, "두 배지가 같은 옷을 입었다 — 한 줄에 서면 구별되지 않는다");
      assert.ok(nearing?.includes("rose"), `임박 배지가 장미빛이 아니다: ${nearing}`);
      assert.ok(nearing?.includes("dark:"), "어두운 화면 짝이 없다");
    });
  });
}

describe("🔴 상세 머리 줄 — 같은 배지가 [폴더 열기] 묶음 안에 선다", () => {
  const headerSource = read("src/components/repair-cases/detail/DetailHeader.tsx");
  const header = flat(headerSource);

  test("배지가 <SourceBadge> 뒤, 같은 묶음 안이다", () => {
    const source = header.indexOf("<SourceBadge");
    const nearing = header.indexOf("<DueDateNearBadge");
    assert.ok(source >= 0 && nearing >= 0, "머리 카드에서 두 배지를 찾지 못했다");
    assert.ok(nearing > source, "납기 임박 배지가 DB 배지보다 앞에 있다");
    assert.equal(
      header.slice(source, nearing).includes("</div>"),
      false,
      "두 배지 사이에서 묶음이 닫힌다 — 배지만 따로 서던 줄이 되살아났다"
    );
  });

  test("🔴 레이아웃이 재서 넘긴다 — 머리 카드는 「오늘」도 내자 날짜도 모른다", () => {
    const layout = flat(read("src/app/(app)/repair-cases/[id]/layout.tsx"));
    assert.ok(layout.includes("isDueDateNear={isDueDateNear}"), "레이아웃이 판정을 안 넘긴다");
    assert.ok(
      layout.includes("listDomesticOrderDueDatesForRepairCase(resolved.id)"),
      "레이아웃이 내자 납기요청일을 안 읽는다 — 상세정보엔 날짜가 보이는데 머리 줄에만 배지가 없는 건이 생긴다"
    );
    assert.ok(
      !codeOnly(headerSource).includes("new Date("),
      "머리 카드가 스스로 「오늘」을 만든다 — 서버가 그린 것과 어긋난다(hydration)"
    );
  });
});

describe("🔴 판정은 종과 같은 함수 하나로 — 화면도 서버도 조건을 새로 적지 않는다", () => {
  const JUDGE = "isRepairCaseDueDateNear(";

  test("배지·글자색을 켜는 서버 자리 셋이 모두 그 함수를 부른다", () => {
    for (const file of [
      "src/app/(app)/repair-cases/page.tsx", // 전체 A/S 현황 표·카드
      "src/app/(app)/repair-cases/[id]/layout.tsx", // 상세 머리 줄 배지
      "src/app/(app)/repair-cases/[id]/page.tsx", // 상세 「인수 정보」 날짜 글자
    ]) {
      const source = read(file);
      assert.ok(source.includes(JUDGE), `${file} 가 공용 판정 함수를 부르지 않는다`);
      assert.ok(
        source.includes('from "@/lib/domain/notifications"'),
        `${file} 가 종 알림과 같은 자리에서 판정을 가져오지 않는다`
      );
    }
  });

  test("🔴 내 작업 화면은 종이 쓰는 **그 조회**를 그대로 부른다 — 행에 출하일 칸이 없다", () => {
    const source = read("src/app/(app)/repair-cases/mine/page.tsx");
    assert.ok(
      source.includes("listRepairCasesWithDueDateNear()"),
      "내 작업이 판정을 따로 짓고 있다 — 출하일을 못 보는 자리라 종과 어긋난다"
    );
    assert.ok(
      source.includes('from "@/lib/db/queries/repair-case-due-date-notifications"'),
      "종 알림이 쓰는 그 조회 파일에서 가져오지 않는다"
    );
  });

  test("🔴 그 함수는 종 알림의 세 함수를 묶기만 한다", () => {
    // 값으로 재는 쪽(창 경계·출하 완료·빌려 온 날짜)은 domain/notifications.test.ts 가 본다.
    const domain = read("src/lib/domain/notifications.ts");
    const body = domain.slice(domain.indexOf("export function isRepairCaseDueDateNear"));
    for (const used of [
      "resolveRepairCaseRequestedDueDate(",
      "isRepairCaseDueDateWithinNotificationWindow(",
      "isRepairCaseShipmentFinished(",
    ]) {
      assert.ok(body.includes(used), `공용 판정이 ${used} 를 안 쓴다 — 규칙이 두 벌이 된다`);
    }
  });

  test("🔴 그리는 조각 넷은 「오늘」을 만들지 않는다", () => {
    for (const file of [
      "src/components/repair-cases/RepairCaseTable.tsx",
      "src/components/repair-cases/RepairCaseCardList.tsx",
      "src/components/repair-cases/mine/MyActiveWorkTable.tsx",
      "src/components/repair-cases/mine/MyActiveWorkCardList.tsx",
    ]) {
      assert.ok(
        !codeOnly(read(file)).includes("new Date("),
        `${file} 가 스스로 「오늘」을 만든다 — 서버가 그린 것과 어긋난다(hydration)`
      );
    }
  });
});
