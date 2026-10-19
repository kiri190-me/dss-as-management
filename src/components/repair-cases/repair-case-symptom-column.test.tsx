import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import RepairCaseTable from "./RepairCaseTable";
import RepairCaseCardList from "./RepairCaseCardList";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { SortState } from "@/lib/domain/repair-case-filters";

/**
 * ============================================================================
 * 전체 A/S 현황 — 신고증상 열, 그리고 카드의 L/N·신고증상 (2026-10-17 요구)
 * ============================================================================
 * 「전체 A/S 현황의 수리 건 표에 신고증상 열을 제품 바로 오른쪽에 더해 달라」,
 * 이어서 「작은 화면에서 뜨는 카드에도 L/N 과 신고증상을 보이게 해 달라」.
 *
 * 🔴 **그린 결과(HTML)만 본다.** 원본을 글자로 읽는 시험이었다면 주석에 적힌
 * 「신고증상」·「L/N」 에 단언이 걸려 열이 사라져도 통과한다. JSX 주석은 그려진
 * 글자에 남지 않으므로, 여기서 세는 <th>·<td>·<dt> 는 전부 **진짜로 그려진
 * 것**이다.
 *
 * 🔴 못 박는 것
 *  · 열 차례가 「제품」 바로 다음인가 — 열이 생기기만 하고 자리가 틀리면 다시 해야 한다.
 *  · 머리글 칸 수 = 몸통 칸 수(삭제 모드일 때와 아닐 때 둘 다). 둘 중 하나만
 *    고치면 표가 통째로 어긋나는데 그 어긋남은 눈에서만 보인다.
 *  · 신고증상은 **정렬 대상이 아니다** — 머리글에 누를 것이 없다(SortColumn 에도 없다).
 *  · 긴 글은 두 줄에서 잘리고(line-clamp-2) **잘렸다는 것이 보인다**(… + title 로 전체).
 *  · 값이 없으면 이 표/카드가 쓰던 대로 "-" 다 — 「없음」 같은 말을 짓지 않는다.
 *  · 카드의 Model 칸이 L/N 까지 보인다(표의 제품 셀 둘째 줄과 짝이다).
 *
 * 🔴 값은 전부 가짜다. 실제 고객사 이름·S/N·L/N·신고증상 문장은 한 글자도 쓰지 않는다
 * (공개 저장소다 — 신고증상에는 고객사 사정이 섞인다).
 * ============================================================================
 */

/** 가짜 신고증상. 두 줄 자르기가 동하는지 보려고 일부러 길게 적는다. */
const FAKE_SYMPTOM =
  "시험용 가짜 증상입니다. 전원이 들어오지 않는다고 적혀 있고, 다시 넣으면 잠깐 켜졌다가 꺼진다고 합니다. 이 문장은 두 줄에서 잘려야 합니다.";

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
    reportedSymptom: FAKE_SYMPTOM,
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

const SORT: SortState = { column: "intakeNumber", direction: "desc" };

function tableMarkup(
  rows: EffectiveRepairCase[],
  options: { selectionMode?: boolean } = {}
): string {
  return renderToStaticMarkup(
    <RepairCaseTable
      rows={rows}
      sort={SORT}
      onSortChange={() => {}}
      selectionMode={options.selectionMode}
      selectedIds={options.selectionMode ? new Set<string>() : undefined}
      selectableIds={options.selectionMode ? new Set(rows.map((r) => r.id)) : undefined}
      onToggleSelect={options.selectionMode ? () => {} : undefined}
      onToggleSelectAll={options.selectionMode ? () => {} : undefined}
    />
  );
}

/** 태그를 걷어 낸 보이는 글자. 공백은 한 칸으로 줄인다. */
function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 바깥 태그 하나(th/td/dt/dd …)마다 [여는 태그, 속 내용] 을 차례대로 뽑는다. */
function cells(html: string, tag: string): { open: string; inner: string }[] {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
  return [...html.matchAll(pattern)].map((m) => ({ open: m[1], inner: m[2] }));
}

describe("전체 A/S 현황 표 — 신고증상 열", () => {
  test("🔴 머리글 차례: 신고증상은 「제품」 바로 다음, 「유·무상」 바로 앞이다", () => {
    // 지금 눌려 있는 차례 표시(▲▼)는 자리와 상관없으므로 걷어 내고 본다.
    const headers = cells(tableMarkup([fakeRow()]), "th").map((c) =>
      visibleText(c.inner).replace(/[▲▼]/g, "")
    );

    assert.deepEqual(
      headers,
      [
        "인수번호인수일",
        "상태우선순위",
        "고객사",
        "제품",
        "신고증상",
        "유·무상",
        "담당 엔지니어",
        "출하일고객 요청 납기일",
        "상세",
      ],
      `머리글 차례가 다르다: ${JSON.stringify(headers)}`
    );
  });

  test("🔴 머리글 칸 수 = 몸통 칸 수 — 삭제 모드가 꺼졌을 때와 켜졌을 때 둘 다", () => {
    const plain = tableMarkup([fakeRow()]);
    assert.equal(cells(plain, "th").length, 9, "머리글이 아홉 칸이 아니다");
    assert.equal(cells(plain, "td").length, 9, "몸통이 아홉 칸이 아니다");

    const selecting = tableMarkup([fakeRow()], { selectionMode: true });
    assert.equal(cells(selecting, "th").length, 10, "삭제 모드 머리글이 열 칸이 아니다");
    assert.equal(cells(selecting, "td").length, 10, "삭제 모드 몸통이 열 칸이 아니다");
  });

  test("🔴 두 줄 다 늘어나도 수가 함께 간다 — 행이 둘이면 몸통은 머리글의 두 배다", () => {
    const html = tableMarkup([fakeRow(), fakeRow({ id: "case-fake-2", intakeNumber: "D940102" })]);
    const thCount = cells(html, "th").length;
    assert.equal(cells(html, "td").length, thCount * 2, "행마다 칸 수가 머리글과 같지 않다");
  });

  test("🔴 정렬 대상이 아니다 — 신고증상 머리글에는 누를 것이 없다", () => {
    const header = cells(tableMarkup([fakeRow()]), "th")[4];
    assert.equal(visibleText(header.inner), "신고증상", "다섯째 머리글이 신고증상이 아니다");
    assert.ok(!header.inner.includes("<button"), "신고증상 머리글에 정렬 단추가 붙었다");
  });

  test("🔴 긴 글은 두 줄에서 잘리고, 잘렸다는 것이 보인다(… + title 로 전체)", () => {
    const cell = cells(tableMarkup([fakeRow()]), "td")[4];
    assert.ok(cell.open.includes("max-w-["), "신고증상 칸의 폭이 묶여 있지 않다 — 긴 글이 표를 늘인다");
    assert.ok(cell.inner.includes("line-clamp-2"), "두 줄에서 자르지 않는다");
    assert.ok(
      cell.inner.includes(`title="${FAKE_SYMPTOM}"`),
      "잘린 뒤 전체를 볼 길(title)이 없다 — 조용히 잘리면 사람은 그게 전부인 줄 안다"
    );
    assert.equal(visibleText(cell.inner), FAKE_SYMPTOM, "신고증상 값이 그려지지 않았다");
  });

  test("🔴 값이 없는 건도 깨지지 않는다 — 빈 신고증상은 이 표가 쓰던 대로 \"-\" 다", () => {
    const html = tableMarkup([fakeRow({ reportedSymptom: null })]);
    const cell = cells(html, "td")[4];
    assert.equal(visibleText(cell.inner), "-", "빈 신고증상을 '-' 로 그리지 않는다");
    assert.ok(!cell.inner.includes("title="), "값이 없는데 title 이 붙었다");
    assert.ok(!/없음/.test(visibleText(html)), "없는 값에 「없음」 같은 말을 지어냈다");
    assert.equal(cells(html, "th").length, cells(html, "td").length, "값이 없으면 칸 수가 어긋난다");
  });

  test("원래 있던 열은 그대로다 — 제품 셀은 여전히 S/N·L/N 을 함께 보인다", () => {
    const product = visibleText(cells(tableMarkup([fakeRow()]), "td")[3].inner);
    assert.ok(product.includes("TEST-MODEL-A"), "제품 셀에서 모델이 사라졌다");
    assert.ok(product.includes("S/N TEST-SN-0001"), "제품 셀에서 S/N 이 사라졌다");
    assert.ok(product.includes("L/N TEST-LN-0001"), "제품 셀에서 L/N 이 사라졌다");
  });
});

describe("전체 A/S 현황 카드 — L/N 과 신고증상", () => {
  function cardMarkup(rows: EffectiveRepairCase[]): string {
    return renderToStaticMarkup(<RepairCaseCardList rows={rows} />);
  }

  test("🔴 칸 차례 — Model 칸이 L/N 까지 안고, 신고증상이 맨 끝이다", () => {
    const labels = cells(cardMarkup([fakeRow()]), "dt").map((c) => visibleText(c.inner));
    assert.deepEqual(
      labels,
      [
        "고객사",
        "담당 엔지니어",
        "Model / S/N / L/N",
        "유·무상",
        "고객 요청 납기일",
        "실제 출하일",
        "신고증상",
      ],
      `카드 칸 차례가 다르다: ${JSON.stringify(labels)}`
    );
  });

  test("🔴 L/N 이 실제로 그려진다 — 표의 제품 셀 둘째 줄과 같은 값이다", () => {
    const values = cells(cardMarkup([fakeRow()]), "dd").map((c) => visibleText(c.inner));
    assert.equal(values[2], "TEST-MODEL-A / TEST-SN-0001 / TEST-LN-0001", `Model 칸: ${values[2]}`);
  });

  test("🔴 신고증상이 두 열을 가로지르고, 두 줄에서 잘린다(… + title 로 전체)", () => {
    const html = cardMarkup([fakeRow()]);
    const dd = cells(html, "dd")[6];
    assert.equal(visibleText(dd.inner), FAKE_SYMPTOM, "카드에 신고증상 값이 그려지지 않았다");
    assert.ok(dd.open.includes("line-clamp-2"), "카드의 신고증상이 두 줄에서 잘리지 않는다");
    assert.ok(dd.open.includes(`title="${FAKE_SYMPTOM}"`), "잘린 뒤 전체를 볼 길(title)이 없다");
    assert.ok(html.includes("col-span-2"), "신고증상이 두 열을 가로지르지 않는다");
    assert.ok(html.includes("grid-cols-2"), "2열 격자가 아니게 됐다");
  });

  test("🔴 값이 없는 건도 깨지지 않는다 — 카드가 쓰던 대로 \"-\" 다", () => {
    const html = cardMarkup([fakeRow({ reportedSymptom: null })]);
    const values = cells(html, "dd").map((c) => visibleText(c.inner));
    assert.equal(values[6], "-", "빈 신고증상을 '-' 로 그리지 않는다");
    assert.ok(!/없음/.test(visibleText(html)), "없는 값에 「없음」 같은 말을 지어냈다");
    assert.equal(cells(html, "dt").length, cells(html, "dd").length, "이름표와 값의 수가 어긋난다");
  });
});
