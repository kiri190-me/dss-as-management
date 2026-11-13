import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import FinalShipmentApprovedBadge from "./FinalShipmentApprovedBadge";
import RepairCaseTable from "@/components/repair-cases/RepairCaseTable";
import RepairCaseCardList from "@/components/repair-cases/RepairCaseCardList";
import MiscCaseTable from "@/components/misc-cases/MiscCaseTable";
import MiscCaseCardList from "@/components/misc-cases/MiscCaseCardList";
import MiscCaseStatusBadge from "@/components/misc-cases/MiscCaseStatusBadge";
import DomesticOrderDetailHeader from "@/components/domestic-orders/detail/DomesticOrderDetailHeader";
import type { MiscCaseRow } from "@/components/misc-cases/misc-case-fields";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { SortState } from "@/lib/domain/repair-case-filters";
import { MISC_CASE_DEFAULT_SORT } from "@/lib/domain/misc-case-list";
import { MISC_CASE_STATUS_LABELS } from "@/lib/domain/misc-case-status";
import { FINAL_SHIPMENT_APPROVED_LABEL } from "@/lib/domain/final-shipment-approval-badge";

/**
 * ============================================================================
 * 🔴 **[최종 출하 승인 완료] 배지 — 다섯 자리** (2026-11-08)
 * ============================================================================
 * 사용자 요구 원문: 「**수리건과 기타건 모두 최종출하승인이 되면 [최종 출하 승인
 * 완료]라는 베찌**가 **현황판과 상세페이지 헤드, 내자정리의 [완료 처리]버튼의
 * 오른쪽**에 베찌가 붙도록 해줘」.
 *
 * ── 🔴 다섯 자리와 **어떻게 재는가** ────────────────────────────────────
 *  ① 전체 A/S 현황 — 표와 카드 **둘 다 그려 본다.**
 *  ② 수리 건 상세 머리 카드 — **원본 글자**로 읽는다(훅 셋을 물고 있어 이 환경에서
 *    그려 볼 수 없다. 이웃 repair-cases/due-date-near-badge.test.tsx 와 같은 방법·
 *    같은 까닭이다).
 *  ③ 기타건 현황 — 표와 카드 **둘 다 그려 본다.**
 *  ④ 기타건 상세 머리 카드 — **그려 본다**(서버 컴포넌트다).
 *  ⑤ 내자 정리의 [완료 처리] 옆 — **원본 글자**로 읽는다(그 화면은 서버 액션과
 *    useRouter 를 물고 있다. 조각 B 의 시험이 같은 화면을 같은 방법으로 잰다).
 *
 * ── 🔴 「안 뜬다」 쪽을 **반드시 함께** 잰다 ────────────────────────────
 * 붙는 쪽만 재면 **언제나 그리는 코드도 통과한다.** 그리고 「안 뜬다」 쪽은 표본이
 * 비면 영영 통과하므로, 자리마다 **같은 표본으로 붙는 쪽과 안 붙는 쪽을 함께** 그려
 * 맞대어 본다.
 *
 * ── 🔴 **STALE 은 안 붙는다** ───────────────────────────────────────────
 * 값으로 재는 자리는 도메인 시험이다(lib/domain/final-shipment-approval-badge.test.ts).
 * 여기서는 **화면이 그 답을 그대로 쓰는가**를 본다 — 서버가 거짓을 주면 화면에는 한
 * 글자도 안 선다.
 *
 * ── 🔴 **회차 완료가 눈에 보이는가**(2026-11-08 사용자 지적) ────────────
 * 「[1차 완료]가 되었다는게 내자정리에서 **시각적으로 한눈에 파악이 안되는 것** 같아.」
 * 그 답으로 세운 「N차 완료 ✓」 표를 ⑤ 와 같은 자리에서 함께 잰다 — 🔴 **단추 글자와
 * 헷갈리지 않는가**가 요점이다(완료 안 된 2차의 단추도 「2차 완료」라고 적혀 있다).
 *
 * 🔴 값은 전부 가짜다. 실제 고객사 이름 · S/N · L/N · 접수번호는 한 글자도 쓰지 않는다.
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");
const flat = (source: string) => source.replace(/\s+/g, " ");
const count = (source: string, needle: string) => source.split(needle).length - 1;
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};

const LABEL = FINAL_SHIPMENT_APPROVED_LABEL;

/* ────────────────────────────────────── 표본 */

const FAKE_CASE_ID = "case-fake-approved-1";
const SORT: SortState = { column: "intakeNumber", direction: "desc" };

function fakeCase(): EffectiveRepairCase {
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
  };
}

function miscRow(approved: boolean, status: MiscCaseRow["status"] = "SHIPMENT_READY"): MiscCaseRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    repairCaseId: null,
    modelName: "케이블 교체 일식",
    customerName: "가나 테크",
    status,
    finalShipmentApproved: approved,
    displayQuoteNumber: null,
    displayQuoteIssuedDate: null,
    purchaseOrderNumber: null,
    orderIssuedDate: null,
    projectName: null,
    progressNote: null,
    displayAmountExcludingVat: null,
    paymentCompleted: false,
    deliveredDateLines: [],
    deliveredByLines: [],
    deliveredDateBorrowed: false,
  };
}

const HEAD_ROW = {
  modelName: "케이블 교체 일식",
  customerName: "가나 테크",
  displayQuoteIssuedDate: "2096-09-30",
  displayQuoteNumber: "DSS 2096-120",
};

/**
 * 그려 볼 수 있는 자리 넷. 🔴 **같은 표본으로 붙는 쪽과 안 붙는 쪽을 함께** 그린다 —
 * 두 결과가 같으면 아래 단언 중 하나가 반드시 깨진다.
 */
const RENDERED: { name: string; render: (approved: boolean) => string }[] = [
  {
    name: "① 전체 A/S 현황 표",
    render: (approved) =>
      renderToStaticMarkup(
        <RepairCaseTable
          rows={[fakeCase()]}
          sort={SORT}
          onSortChange={() => {}}
          finalShipmentApprovedCaseIds={approved ? new Set([FAKE_CASE_ID]) : undefined}
        />
      ),
  },
  {
    name: "① 전체 A/S 현황 카드",
    render: (approved) =>
      renderToStaticMarkup(
        <RepairCaseCardList
          rows={[fakeCase()]}
          finalShipmentApprovedCaseIds={approved ? new Set([FAKE_CASE_ID]) : undefined}
        />
      ),
  },
  {
    name: "③ 기타건 현황 표",
    render: (approved) =>
      renderToStaticMarkup(
        <MiscCaseTable
          rows={[miscRow(approved)]}
          sort={MISC_CASE_DEFAULT_SORT}
          onSortChange={() => {}}
        />
      ),
  },
  {
    name: "③ 기타건 현황 카드",
    render: (approved) => renderToStaticMarkup(<MiscCaseCardList rows={[miscRow(approved)]} />),
  },
  {
    name: "④ 기타건 상세 머리 카드",
    render: (approved) =>
      renderToStaticMarkup(
        <DomesticOrderDetailHeader
          row={HEAD_ROW}
          status="SHIPMENT_READY"
          finalShipmentApproved={approved}
        />
      ),
  },
];

test("🔵 못 — 표본이 비어 있지 않고, 주석 걷어내기가 실제로 문다", () => {
  for (const screen of RENDERED) {
    assert.ok(screen.render(true).length > 300, `${screen.name} 이 거의 안 그려졌다`);
  }
  assert.equal(LABEL, "최종 출하 승인 완료");
  assert.equal(count(stripComments("/* approved={true} */ const a = 1;"), "approved={true}"), 0);
  assert.equal(count(stripComments("  // approved={true}\nconst a = 1;"), "approved={true}"), 0);
});

/* ────────────────────────────────────── 그려 보는 자리 넷 */

for (const screen of RENDERED) {
  describe(`${screen.name} — [최종 출하 승인 완료]`, () => {
    test("🔴 승인이 끝난 건에만 선다 — 아니면 **한 글자도** 안 선다", () => {
      const withBadge = screen.render(true);
      const without = screen.render(false);
      assert.ok(withBadge.includes(`>${LABEL}</span>`), `배지가 없다: ${withBadge}`);
      assert.ok(
        !without.includes(LABEL),
        `승인 전인데 배지가 섰다 — 늘 켜져 있으면 아무도 안 본다: ${without}`
      );
    });

    test("🔴 같은 배지 조각을 쓴다 — 다섯 자리가 같은 말을 한다", () => {
      const badge = renderToStaticMarkup(<FinalShipmentApprovedBadge approved />);
      assert.ok(
        screen.render(true).includes(badge),
        `${screen.name} 의 배지가 공용 조각과 다르다 — 한쪽만 고쳐지는 날이 온다`
      );
    });
  });
}

/* ────────────────────────────────────── 배지 그 자체 */

describe("🔴 배지 — 이웃과 헷갈리지 않는다", () => {
  test("거짓이면 아무것도 안 그린다 — 「승인 전」 같은 말을 대신 적지 않는다", () => {
    assert.equal(renderToStaticMarkup(<FinalShipmentApprovedBadge approved={false} />), "");
  });

  test("🔴 「출하 대기」·「완료」와 **옷이 다르다** — 셋이 한 줄에 함께 설 수 있다", () => {
    const own = renderToStaticMarkup(<FinalShipmentApprovedBadge approved />);
    const ownClass = /class="([^"]+)"/.exec(own)?.[1];
    assert.ok(ownClass, own);

    for (const status of ["SHIPMENT_READY", "COMPLETED"] as const) {
      const neighbour = renderToStaticMarkup(<MiscCaseStatusBadge status={status} />);
      const neighbourClass = /class="([^"]+)"/.exec(neighbour)?.[1];
      assert.ok(neighbourClass, neighbour);
      assert.notEqual(
        ownClass,
        neighbourClass,
        `${MISC_CASE_STATUS_LABELS[status]} 와 같은 옷이다 — 나란히 서면 하나로 읽힌다`
      );
    }
    // 🔴 **채운 배지**여야 한다 — 내자 정리의 고객사 파스텔 줄 위에서 연한 배지는
    //    녹아 사라진다(그 파일 머리말의 실측 근거).
    assert.ok(ownClass.includes("bg-emerald-700"), ownClass);
    assert.ok(ownClass.includes("text-white"), ownClass);
    assert.ok(ownClass.includes("dark:"), "어두운 화면 짝이 없다");
  });

  test("🔵 좁은 자리(내자 정리 순번 칸)는 **11px 치수**를 쓴다 — 이웃 표·단추와 같다", () => {
    const compact = renderToStaticMarkup(<FinalShipmentApprovedBadge approved size="compact" />);
    assert.ok(compact.includes("text-[11px]"), compact);
    // 색은 두 치수가 같아야 한다 — 같은 사실이 자리마다 다른 색이면 안 된다.
    assert.ok(compact.includes("bg-emerald-700"), compact);
  });

  test("회차 이름을 넘기면 title 로 붙는다 — 보이는 글자만으로는 어느 회차인지 모른다", () => {
    const html = renderToStaticMarkup(
      <FinalShipmentApprovedBadge approved title="2차 · 납기 2096-02-15 (2차분)" />
    );
    assert.ok(html.includes('title="2차 · 납기 2096-02-15 (2차분)"'), html);
  });
});

/* ────────────────────────────────────── ② 수리 건 상세 머리 카드 */

describe("② 수리 건 상세 머리 카드 — 배지가 **같은 묶음 안**에 선다", () => {
  const headerSource = read("src/components/repair-cases/detail/DetailHeader.tsx");
  const header = flat(stripComments(headerSource));
  const layout = flat(stripComments(read("src/app/(app)/repair-cases/[id]/layout.tsx")));

  test("🔴 <DueDateNearBadge> 뒤, 묶음이 닫히기 전이다", () => {
    const near = indexOrFail(header, "<DueDateNearBadge");
    const own = indexOrFail(header, "<FinalShipmentApprovedBadge");
    assert.ok(own > near, "배지가 「납기 임박」보다 앞에 있다 — 차례가 바뀌었다");
    assert.equal(
      header.slice(near, own).includes("</div>"),
      false,
      "두 배지 사이에서 묶음이 닫힌다 — 배지만 따로 서던 줄이 되살아났다"
    );
  });

  test("🔴 레이아웃이 그 값을 **실제로 넘긴다** — 안 넘기면 배지는 영영 안 뜬다", () => {
    assert.ok(
      layout.includes("isFinalShipmentApproved={headerFinalShipmentApproved}"),
      "레이아웃이 판정을 안 넘긴다"
    );
    assert.ok(
      layout.includes("loadRepairCaseFinalShipmentApprovalStates([resolved.id])"),
      "레이아웃이 승인 상태를 안 읽는다"
    );
    // 🔴 판정을 레이아웃이 새로 적지 않는다 — 목록과 **같은 함수** 하나에 묻는다.
    assert.ok(layout.includes("isFinalShipmentApproved("), layout);
    assert.equal(
      header.includes('"APPROVED"'),
      false,
      "머리 카드가 승인 상태를 스스로 판정한다 — 목록과 두 말이 된다"
    );
  });
});

/* ────────────────────────────────────── ① ③ 페이지가 근거를 내려 준다 */

describe("🔴 페이지 넷이 근거를 내려 준다 — 하나라도 빠지면 그 화면만 조용히 안 뜬다", () => {
  const repairCasesPage = flat(stripComments(read("src/app/(app)/repair-cases/page.tsx")));
  const miscCasesPage = flat(stripComments(read("src/app/(app)/misc-cases/page.tsx")));
  const domesticPage = flat(stripComments(read("src/app/(app)/domestic-orders/page.tsx")));
  const domesticLayout = flat(
    stripComments(read("src/app/(app)/domestic-orders/[id]/layout.tsx"))
  );

  test("① 전체 A/S 현황", () => {
    assert.ok(
      repairCasesPage.includes("loadRepairCaseFinalShipmentApprovalStates("),
      repairCasesPage
    );
    assert.ok(
      repairCasesPage.includes("finalShipmentApprovedCaseIds={finalShipmentApprovedCaseIds}"),
      "묶음을 화면에 안 넘긴다"
    );
  });

  test("③ 기타건 현황 — **상태 배지와 따로** 간다(완료된 줄에서 덮이지 않게)", () => {
    assert.ok(miscCasesPage.includes("finalShipmentApproved: isFinalShipmentApproved("), miscCasesPage);
    // 🔵 질의는 늘지 않는다 — 상태 배지와 **같은 조회 하나**를 다시 읽는다.
    //    (가져오기 줄에는 괄호가 없으므로 이 셈은 **부르는 자리**만 센다.)
    assert.equal(
      count(miscCasesPage, "loadDomesticOrderApprovalStates("),
      1,
      "승인 조회를 두 번 부른다 — 같은 표를 한 요청에 두 번 훑는다"
    );
  });

  test("④ 기타건 상세 머리 카드", () => {
    assert.ok(
      domesticLayout.includes("finalShipmentApproved={finalShipmentApproved}"),
      domesticLayout
    );
    assert.ok(domesticLayout.includes("isFinalShipmentApproved(approval?.state ?? null)"), domesticLayout);
  });

  test("⑤ 내자 정리 — **두 종류의 줄**을 각각 읽는다", () => {
    assert.ok(domesticPage.includes("loadDomesticOrderApprovalUnitStates(miscRows)"), domesticPage);
    assert.ok(
      domesticPage.includes("loadRepairCaseFinalShipmentApprovalStates(linkedRows.map("),
      "수리 건이 붙은 줄의 승인을 안 읽는다 — 그 줄에서만 배지가 영영 안 뜬다"
    );
    assert.ok(
      domesticPage.includes("finalShipmentApprovedUnits={finalShipmentApprovedUnits}"),
      "묶음을 화면에 안 넘긴다"
    );
  });

  test("🔴 **N+1 이 아니다** — 조회는 줄 수와 무관하게 두 번뿐이다", () => {
    // 🔴 글자로 센다: 두 조회를 **한 번씩만** 부르고(가져오기 줄에는 괄호가 없다),
    //    줄을 도는 반복 안에 `await` 가 없어야 한다. 반복 안에서 부르면 줄 수만큼
    //    질의가 돈다.
    assert.equal(
      count(domesticPage, "loadDomesticOrderApprovalUnitStates("),
      1,
      "기타건 승인 조회를 부르는 자리가 하나가 아니다"
    );
    assert.equal(
      count(domesticPage, "loadRepairCaseFinalShipmentApprovalStates("),
      1,
      "수리 건 승인 조회를 부르는 자리가 하나가 아니다"
    );
    const loops = domesticPage.match(/for \(const row of (miscRows|linkedRows)\) \{[^}]*\}/g) ?? [];
    assert.ok(loops.length >= 2, "줄을 도는 반복을 못 찾았다 — 이 시험이 아무것도 못 잰다");
    for (const loop of loops) {
      assert.equal(loop.includes("await"), false, `반복 안에서 기다린다(N+1): ${loop}`);
    }
  });
});

/* ────────────────────────────────────── ⑤ 내자 정리의 단추 옆 */

describe("⑤ 내자 정리 — [완료 처리] 단추의 **오른쪽**", () => {
  const screen = flat(stripComments(read("src/components/domestic-orders/DomesticOrderListScreen.tsx")));

  test("🔴 표와 카드가 **둘 다** 근거를 받는다 — 한쪽만이면 창 크기에 따라 갈린다", () => {
    assert.equal(
      count(screen, "approvedRowOrders={approvedUnitsOf(row.id)}"),
      2,
      "두 자리(표·카드) 중 한 곳이 배지의 근거를 못 받는다"
    );
  });

  test("🔴 단추가 하나인 줄 — 배지가 단추 **뒤**에 서고, 단위 번호는 1 이다", () => {
    const button = indexOrFail(screen, '{completed ? "완료 해제" : "완료 처리"}');
    const badge = screen.indexOf("<FinalShipmentApprovedBadge", button);
    assert.ok(badge > button, "배지가 단추보다 앞에 있다 — 「오른쪽」이 아니다");
    assert.ok(
      screen.slice(button, badge + 200).includes("approvedRowOrders.includes(1)"),
      "단추 하나짜리 줄이 단위 1 을 안 본다"
    );
  });

  test("🔴 회차마다 — 완료 표는 단추 **왼쪽**, 승인 배지는 단추 **오른쪽**", () => {
    const group = screen.slice(indexOrFail(screen, "row.dueDates.map((dueDate, index) => {"));
    const completedBadge = indexOrFail(group, "<DueDateRowCompletedBadge");
    const button = indexOrFail(group, "<button");
    const approvedBadge = indexOrFail(group, "<FinalShipmentApprovedBadge");
    assert.ok(completedBadge < button, "회차 완료 표가 단추 뒤로 갔다");
    assert.ok(approvedBadge > button, "승인 배지가 단추 앞으로 갔다 — 「오른쪽」이 아니다");
    // 🔴 **그 회차의** 승인을 본다 — 줄 전체가 아니다.
    assert.ok(group.includes("approvedRowOrders.includes(rowOrder)"), group.slice(0, 600));
    // 🔴 회차 이름을 title 로 단다 — 배지 글자만으로는 어느 회차인지 모른다.
    assert.ok(group.includes("title={label}"), group.slice(0, 900));
  });

  test("🔴 승인 전 회차에는 안 붙는다 — 조건 없이 그리지 않는다", () => {
    // 「언제나 그린다」로 바뀌면 이 글자가 사라진다(배지가 조건을 잃는다).
    assert.equal(
      count(screen, "approved={approvedRowOrders.includes"),
      2,
      "배지가 조건 없이 그려진다 — 모든 줄에 늘 뜬다"
    );
  });
});

/* ────────────────────────────────────── 일 ① 회차 완료가 눈에 보인다 */

describe("🔴 회차 완료가 **한눈에 보인다** — 「N차 완료 ✓」 (2026-11-08 사용자 지적)", () => {
  const screenSource = read("src/components/domestic-orders/DomesticOrderListScreen.tsx");
  const screen = flat(stripComments(screenSource));
  /**
   * 🔵 표 둘이 **2026-11-13 에 제 파일로 내려갔다** — 배지 표시 설정을 붙이면서
   * [시스템 설정] → [배지 표시]가 그 모양을 **베끼지 않고** 가져다 세울 수 있게 한
   * 것이다(components/domestic-orders/badges.tsx 머리말). 화면에 남은 것은 「언제
   * 어디에 그리는가」뿐이고 **모양은 그 파일**이 쥔다. 아래 치수·글자 단언은 그래서
   * 그 파일을 읽는다 — 자리는 옮겼어도 재는 것은 한 글자도 줄이지 않았다.
   */
  const badgesSource = flat(stripComments(read("src/components/domestic-orders/badges.tsx")));
  const badgeBody = badgesSource.slice(
    indexOrFail(badgesSource, "export function DueDateRowCompletedBadge("),
    indexOrFail(badgesSource, "export function OrderIssuedDateMissingBadge(")
  );

  test("🔵 못 — 떼어낸 조각을 실제로 집었다(빈 글자를 뒤지면 아래가 공짜로 통과한다)", () => {
    assert.ok(badgeBody.length > 200, `회차 완료 표 조각이 너무 짧다(${badgeBody.length})`);
    assert.ok(badgeBody.includes("useIsBadgeVisible(\"dueDateRowCompleted\""), badgeBody);
  });

  test("🔴 완료된 회차에만 그린다 — 안 된 회차에는 한 글자도 없다", () => {
    assert.ok(
      screen.includes(
        "{completed && <DueDateRowCompletedBadge rowOrder={rowOrder} label={label} placeKey=\"domesticOrderList\" />}"
      ),
      "완료 표가 조건 없이 그려지거나 아예 없다"
    );
  });

  test("🔴 글자가 「N차 완료 ✓」다 — 단추의 「N차 완료」와 **갈려야** 한다", () => {
    assert.ok(badgeBody.includes("{rowOrder}차 완료 ✓"), badgeBody);
    // 🔴 ✓ 와 **채운 바탕** 둘이 가른다. 단추는 흰 바탕에 테두리뿐이다.
    assert.ok(badgeBody.includes("bg-zinc-700"), badgeBody);
    assert.ok(badgeBody.includes("text-white"), badgeBody);
    assert.ok(badgeBody.includes("dark:"), "어두운 화면 짝이 없다");
    const buttonClass = /const rowActionButtonClass = "([^"]+)"/.exec(screen)?.[1];
    assert.ok(buttonClass, "단추 모양을 못 찾았다 — 대조가 사라지면 이 시험은 아무것도 못 지킨다");
    // 🔴 **토큰으로 본다.** 글자 포함으로 보면 단추의 `dark:hover:bg-zinc-700` 에
    //    걸려 늘 「같은 옷」으로 읽힌다(이 저장소가 한 번 밟은 함정이다 —
    //    misc-case-list-screens.test.tsx 의 `underline` ↔ `hover:underline`).
    assert.equal(
      buttonClass.split(" ").includes("bg-zinc-700"),
      false,
      "단추도 채운 진한 회색이다 — 완료 표와 한눈에 갈리지 않는다"
    );
    assert.ok(buttonClass.split(" ").includes("bg-white"), `단추가 흰 바탕이 아니다: ${buttonClass}`);
  });

  test("🔴 줄 단위 「완료」 표와 **같은 치수**다 — 같은 칸에 나란히 선다", () => {
    // 🔵 둘이 같은 파일로 내려가 **바로 이웃**이 되었다 — 치수가 갈라질 자리가
    //    그만큼 줄었지만, 「같아야 한다」는 못은 그대로 박아 둔다.
    const rowBadge = badgesSource.slice(
      indexOrFail(badgesSource, "export function DomesticOrderCompletedBadge("),
      indexOrFail(badgesSource, "export function DueDateRowCompletedBadge(")
    );
    for (const token of ["rounded", "px-1.5", "py-0.5", "text-[11px]", "leading-none", "font-medium"]) {
      assert.ok(rowBadge.includes(token), `줄 단위 완료 표에서 ${token} 를 못 찾았다`);
      assert.ok(badgeBody.includes(token), `회차 완료 표에 ${token} 가 없다 — 치수가 어긋난다`);
    }
  });

  test("🔵 긴 회차 이름은 title 로 — 표 칸이 좁다", () => {
    assert.ok(badgeBody.includes("title={`${label} — 완료 처리됨`}"), badgeBody);
  });

  test("🔴 **카드에서도 보인다** — 좁은 화면에서만 사라지면 안 된다", () => {
    // 표와 카드가 같은 조각(CompletionToggle)을 쓰는 것이 그 근거다 — 두 자리에서
    // 각각 그리면 한쪽만 고쳐지는 날이 온다.
    assert.equal(count(screen, "<CompletionToggle"), 2, "표·카드 중 한쪽이 완료 단추를 안 그린다");
  });
});
