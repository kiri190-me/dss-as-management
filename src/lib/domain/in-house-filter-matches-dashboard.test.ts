import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyFilters, DEFAULT_FILTERS } from "./repair-case-filters";
import { computeDashboardSummary } from "./dashboard-metrics";
import { REPAIR_STATUS_CODES } from "./types";
import type { EffectiveRepairCase } from "./local/workflow/effective-repair-case";

/**
 * 🔴 대시보드 [현재 입고 수]가 센 것 = [전체 A/S 현황] 의 「입고품 전체」가 남기는 것.
 *
 * 2026-11-11 사용자 개선요청의 뿌리가 이 어긋남이었다 — 카드를 누르면 조건 없이
 * 목록이 열려서 출하 완료 건까지 다 보였고, **카드에 적힌 수와 목록이 말하는 건수가
 * 달랐다.** 이제 카드는 `/repair-cases?status=IN_HOUSE` 로 보낸다.
 *
 * 두 수를 만드는 코드는 여전히 **두 군데**다(dashboard-metrics.ts 의
 * currentIntakeCount · repair-case-filters.ts 의 applyFilters). 한쪽을 합쳐 없애지
 * 않은 까닭은 세는 쪽과 거르는 쪽이 서로 다른 일을 하기 때문이지만, 그 대가로 한쪽만
 * 고치면 둘이 조용히 갈라진다 — 오류는 한 번도 안 나고, 카드와 목록을 나란히 본
 * 사람만 알아챈다. 그래서 **같은 표본에 두 함수를 돌려 수를 맞대는** 이 파일이 그
 * 울타리다. 잣대가 갈라지는 날 여기가 터진다.
 *
 * 🔵 표본이 비어서 공짜로 통과하지 않도록, 수를 맞대기 전에 **표본이 정말 무엇을
 * 재는 모양인지**부터 단언한다(출하 완료가 섞여 있는가 · 재정의로 두 칸이 갈린 줄이
 * 있는가). 둘 중 하나라도 없으면 틀린 구현도 통과한다.
 */

function row(overrides: Partial<EffectiveRepairCase> = {}): EffectiveRepairCase {
  return {
    id: "case-1",
    version: 1,
    source: "DATABASE",
    productId: null,
    intakeNumber: "D260801",
    legacyReportNumber: null,
    workflowType: "PAID_GENERATOR",
    status: "IN_REPAIR",
    priority: "NORMAL",
    exceptionStatus: null,
    currentWorkflowStepKey: "repair",
    receivedAt: "2026-08-03",
    customerRequestedDueDate: null,
    domesticOrderDueDates: [],
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    isOverdue: false,
    productCategory: "Generator",
    paidOrWarranty: "유상",
    billingType: "PAID",
    modelName: "TG-350",
    lotNumber: "LN-1",
    serialNumber: "SN-1",
    partNumber: null,
    customerId: "cust-1",
    customerName: "대성RF시스템",
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
    effectiveWorkflowStepKey: "repair",
    effectiveActualShipmentDate: null,
    effectiveIsOverdue: false,
    holdState: null,
    hasWorkflowOverride: false,
    ...overrides,
  };
}

/** 「입고품 전체」가 남기는 줄. 화면이 하는 것과 같은 호출이다. */
function inHouseRows(rows: EffectiveRepairCase[]): EffectiveRepairCase[] {
  return applyFilters(rows, { ...DEFAULT_FILTERS, status: "IN_HOUSE" });
}

/**
 * 열두 상태를 하나씩 + 워크플로 재정의로 두 칸이 갈린 줄 둘 + 출하일이 없는 출하
 * 완료 건 하나. 🔴 마지막 하나가 있는 까닭: 대시보드의 「금월 출하 완료」는 출하일이
 * 없으면 세지 않는데(dashboard-metrics.test.ts), [현재 입고 수]와 「입고품 전체」는
 * **둘 다 상태만 본다** — 한쪽이 출하일까지 보기 시작하면 이 줄에서 갈린다.
 */
function sampleCases(): EffectiveRepairCase[] {
  return [
    ...REPAIR_STATUS_CODES.map((status) =>
      row({
        id: `plain-${status}`,
        status,
        effectiveStatus: status,
        effectiveActualShipmentDate: status === "SHIPMENT_COMPLETED" ? "2026-11-02" : null,
      })
    ),
    // 원본은 출하 완료인데 재정의로 되돌아온 줄 — 두 자리 모두 "아직 입고 중"이어야 한다.
    row({
      id: "override-back-in",
      status: "SHIPMENT_COMPLETED",
      actualShipmentDate: "2026-10-20",
      effectiveStatus: "WAITING_SHIPMENT",
      effectiveActualShipmentDate: null,
      hasWorkflowOverride: true,
    }),
    // 🔴 되돌아온 줄이 하나 더 있다. 재정의된 줄이 양쪽으로 하나씩이면 원본 status 로
    //    세어도 **수가 우연히 같아져**, 아래 수 맞대기를 틀린 구현이 통과한다(처음에
    //    그랬다 — 남는 줄의 정체를 보는 시험만 터졌다). 한쪽을 하나 더 두어 수까지
    //    갈라지게 한다.
    row({
      id: "override-back-in-2",
      status: "SHIPMENT_COMPLETED",
      actualShipmentDate: "2026-10-22",
      effectiveStatus: "IN_REPAIR",
      effectiveActualShipmentDate: null,
      hasWorkflowOverride: true,
    }),
    // 원본은 수리 중인데 재정의로 출하가 끝난 줄 — 두 자리 모두 빠져야 한다.
    row({
      id: "override-shipped",
      status: "IN_REPAIR",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-05",
      hasWorkflowOverride: true,
    }),
    // 출하 완료인데 출하일이 비어 있는 줄.
    row({
      id: "shipped-without-date",
      status: "SHIPMENT_COMPLETED",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: null,
    }),
    row({ id: "overdue", effectiveStatus: "WAITING_PARTS_SUPPLY", isOverdue: true, effectiveIsOverdue: true }),
    row({ id: "unset-billing", effectiveStatus: "WAITING_PO", billingType: null, paidOrWarranty: "-" }),
  ];
}

// ─────────────────────────────────────────────── 표본부터 재 둔다

test("🔵 표본 점검 — 맞댈 것이 실제로 들어 있다", () => {
  const sample = sampleCases();

  assert.ok(sample.length > 0, "표본이 비면 0 === 0 으로 무엇이든 통과한다");
  assert.ok(
    sample.some((c) => c.effectiveStatus === "SHIPMENT_COMPLETED"),
    "출하 완료 건이 하나도 없으면 거르든 말든 수가 같아 아무것도 재지 못한다"
  );
  assert.ok(
    sample.some((c) => c.effectiveStatus !== "SHIPMENT_COMPLETED"),
    "남을 건이 하나도 없으면 빈 목록끼리 견주게 된다"
  );
  assert.ok(
    sample.some((c) => c.status !== c.effectiveStatus),
    "재정의로 두 칸이 갈린 줄이 없으면 원본 status 로 세는 구현도 통과한다"
  );
  // 🔴 "갈린 줄이 있다"만으로는 모자라다. 되돌아온 줄과 출하된 줄이 하나씩이면
  //    원본 status 로 세어도 **수가 같아져** 아래 수 맞대기를 그냥 통과한다.
  assert.notEqual(
    sample.filter((c) => c.status !== "SHIPMENT_COMPLETED").length,
    sample.filter((c) => c.effectiveStatus !== "SHIPMENT_COMPLETED").length,
    "원본 status 로 세어도 수가 같은 표본이다 — effectiveStatus 를 안 보는 구현이 통과한다"
  );
  assert.ok(
    sample.some((c) => c.effectiveStatus === "SHIPMENT_COMPLETED" && c.effectiveActualShipmentDate === null),
    "출하일이 없는 출하 완료 건이 없으면 한쪽이 출하일을 보기 시작해도 안 걸린다"
  );
});

// ─────────────────────────────────────────────── 핵심: 두 수가 같은가

test("🔴 「입고품 전체」가 남기는 건수 = 대시보드 [현재 입고 수]", () => {
  const sample = sampleCases();
  const summary = computeDashboardSummary(sample, new Date("2026-11-11T05:00:00.000Z"));
  const listed = inHouseRows(sample);

  assert.ok(listed.length > 0, "표본을 거른 결과가 비었다 — 수를 맞댈 것이 없다");
  assert.ok(
    listed.length < sample.length,
    "한 건도 안 걸러졌다 — 출하 완료를 빼지 않는 구현도 이 단언 없이는 통과한다"
  );
  assert.equal(
    listed.length,
    summary.currentIntakeCount,
    "대시보드 카드의 수와 목록의 건수가 다르다 — 두 잣대가 갈라졌다(카드를 눌러 들어온 사람이 바로 본다)"
  );
});

test("🔴 남는 줄의 정체도 같다 — 수만 맞고 다른 건이 남는 일이 없게", () => {
  const sample = sampleCases();
  const expected = sample.filter((c) => c.effectiveStatus !== "SHIPMENT_COMPLETED").map((c) => c.id);
  assert.deepEqual(inHouseRows(sample).map((c) => c.id), expected);
  assert.ok(expected.includes("override-back-in"), "재정의로 되돌아온 줄은 아직 입고 중이다");
  assert.ok(!expected.includes("override-shipped"), "재정의로 출하가 끝난 줄은 빠진다");
});

test("「입고품 전체」와 「출하 완료」는 겹치지도 빠지지도 않는다", () => {
  const sample = sampleCases();
  const shipped = applyFilters(sample, { ...DEFAULT_FILTERS, status: "SHIPMENT_COMPLETED" });
  const listed = inHouseRows(sample);

  assert.equal(listed.length + shipped.length, sample.length);
  const listedIds = new Set(listed.map((c) => c.id));
  assert.ok(shipped.every((c) => !listedIds.has(c.id)), "같은 건이 양쪽에 다 있으면 안 된다");
});

test("모두 출하가 끝났으면 둘 다 0 이다", () => {
  const sample = [
    row({ id: "a", status: "SHIPMENT_COMPLETED", effectiveStatus: "SHIPMENT_COMPLETED", effectiveActualShipmentDate: "2026-11-02" }),
    row({ id: "b", status: "SHIPMENT_COMPLETED", effectiveStatus: "SHIPMENT_COMPLETED", effectiveActualShipmentDate: "2026-11-03" }),
  ];
  const summary = computeDashboardSummary(sample, new Date("2026-11-11T05:00:00.000Z"));

  assert.equal(summary.currentIntakeCount, 0);
  assert.equal(inHouseRows(sample).length, 0);
});

test("표본이 하나도 없으면 둘 다 0 이다 — 빈 목록에서도 어긋나지 않는다", () => {
  const summary = computeDashboardSummary([], new Date("2026-11-11T05:00:00.000Z"));
  assert.equal(summary.currentIntakeCount, 0);
  assert.equal(inHouseRows([]).length, 0);
});

// ─────────────────────────────────────────────── 화면 둘이 그 값을 실제로 쓰는가
//
// 위까지는 값으로 도는 부분이다. 그런데 **카드가 그 주소로 보내지 않으면** 수가 같든
// 말든 사용자가 보는 것은 전과 똑같다 — 조각이 통째로 헛돈다. 두 화면 다 next/link ·
// 라우터 훅에 묶인 클라이언트 컴포넌트라 여기서 통째로 그릴 수 없어, 이웃
// fault-symptom-result-link.test.ts 와 같은 방법으로 **원본을 글자로** 읽는다.
//
// 🔴 읽기 전에 주석을 걷어낸다. 주석에도 `/repair-cases?status=IN_HOUSE` 가 적혀
// 있어서(그게 왜 그런지를 적은 자리다), 날것으로 세면 **코드를 되돌려도 주석만으로
// 영영 통과한다.** 걷어내기가 정말 듣는지도 아래에서 먼저 잰다.

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

function withoutComments(source: string): string {
  return source
    // JSX 주석 {/* … */}. 🔴 안쪽을 `[\s\S]*?` 로 적으면 안 된다 — 게으른 되풀이라도
    // 뒤의 `\s*\}` 를 맞추려고 **다른 주석의 닫힘까지** 뛰어넘어, `{` 로 열린 타입
    // 선언부터 파일 끝의 JSX 주석까지 한 덩어리로 지운다(처음 적었다가 실제로
    // 당했다: 3997자가 756자가 되고도 시험은 "코드가 없다"고만 말했다).
    // 그래서 **첫 `*/` 에서 반드시 끝나는** 모양으로 적는다.
    .replace(/\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g, " ")
    .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, " ") // 블록 주석
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1"); // 줄 주석 ("https://" 는 건드리지 않는다)
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const dashboardSource = read("src/components/dashboard/DashboardContent.tsx");
const filtersSource = read("src/components/repair-cases/RepairCaseFilters.tsx");

test("🔵 주석 걷어내기가 정말 듣는다 — 안 들으면 아래 둘이 주석만으로 통과한다", () => {
  const stripped = withoutComments(dashboardSource);
  assert.ok(dashboardSource.includes("사용자 개선요청"), "표지로 삼은 주석 글귀가 사라졌다");
  assert.ok(!stripped.includes("사용자 개선요청"), "주석이 그대로 남아 있다 — 아래 시험이 무의미해진다");
  assert.ok(stripped.includes("현재 입고 수"), "걷어내다 코드까지 날렸다");
  assert.ok(
    !withoutComments(filtersSource).includes("2026-11-11 사용자 결정"),
    "필터 화면 쪽 주석이 그대로 남아 있다"
  );
});

test("🔴 [현재 입고 수] 카드가 /repair-cases?status=IN_HOUSE 로 보낸다", () => {
  const stripped = flat(withoutComments(dashboardSource));
  const start = stripped.indexOf('label: "현재 입고 수"');
  assert.notEqual(start, -1, "카드를 짓는 줄을 찾지 못했다 — 글자가 바뀌었으면 이 시험도 함께 고칠 것");

  // 그 카드 한 덩어리 안에서만 본다. 파일 전체에 걸면 다른 카드의 href 에 걸린다.
  const card = stripped.slice(start, stripped.indexOf("}", start));
  assert.match(card, /value: summary\.currentIntakeCount/, "세는 값은 그대로 currentIntakeCount 다");
  assert.match(card, /href: "\/repair-cases\?status=IN_HOUSE"/);
});

test("🔴 조건 없는 /repair-cases 로 보내던 옛 링크가 되살아나지 않는다", () => {
  // 되돌아가면 출하 완료 건까지 보여 카드의 수와 목록의 건수가 다시 갈린다.
  // 오류는 안 나고, 눈으로 둘을 맞대 본 사람만 안다.
  const stripped = withoutComments(dashboardSource);
  assert.ok(!stripped.includes('href: "/repair-cases"'), "조건 없는 링크가 다시 생겼다");
});

test("다른 카드 아홉의 링크는 건드리지 않았다", () => {
  const stripped = withoutComments(dashboardSource);
  for (const href of [
    "/repair-cases?status=WAITING_INTAKE_INSPECTION",
    "/repair-cases?status=WAITING_KYOSAN_REPLY",
    "/repair-cases?status=WAITING_PO",
    "/repair-cases?status=WAITING_PARTS_SUPPLY",
    "/repair-cases?status=IN_REPAIR",
    "/repair-cases?status=WAITING_SHIPMENT_APPROVAL",
    "/repair-cases?status=WAITING_SHIPMENT",
    "/repair-cases?overdue=1",
  ]) {
    assert.ok(stripped.includes(href), `${href} 가 사라졌다`);
  }
  assert.ok(stripped.includes("status=SHIPMENT_COMPLETED&shipmentMonth="), "금월 출하 완료 링크가 사라졌다");
});

test("🔴 [현재 상태] 고르개에서 「입고품 전체」는 「전체」 바로 아래다", () => {
  // 사용자가 고른 자리다(2026-11-11). 그다음이 낱낱의 상태 열둘이다.
  const stripped = withoutComments(filtersSource);
  const start = stripped.indexOf('id="repair-case-status"');
  assert.notEqual(start, -1, "현재 상태 고르개를 찾지 못했다");
  const block = flat(stripped.slice(start, stripped.indexOf("</select>", start)));

  assert.match(
    block,
    /<option value="ALL">전체<\/option> <option value="IN_HOUSE">입고품 전체<\/option> \{REPAIR_STATUS_CODES\.map/
  );
});
