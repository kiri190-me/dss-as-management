import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildWeeklyReport,
  pairWeeklyReportBlocksByCustomer,
  type WeeklyReportCase,
} from "./weekly-report";
import {
  WEEKLY_REPORT_KIND_FILTERS,
  buildWeeklyReportKindView,
  normalizeWeeklyReportKindFilter,
  visibleWeeklyReportKinds,
  weeklyReportHref,
  weeklyReportKindFilterLabels,
  weeklyReportPairBlock,
} from "./weekly-report-kind-filter";

/** 이 시험이 지키려는 파일의 원본. CRLF 저장소에서도 같게 읽는다. */
const selfSource = readFileSync(
  new URL("./weekly-report-kind-filter.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

/**
 * ============================================================================
 * 주간보고 `전체 / RFG 만 / MB 만` — 무엇을 보여 주고, 무엇을 세는가
 * ============================================================================
 * 이 파일이 못 박는 것은 넷이다.
 *
 *  1. 세 가지가 **각각 무엇을 보여 주는가** — 종류 · 총합 블록 · PO 발행 현황.
 *  2. 🔴 **합계가 고른 것과 맞는가.** `RFG 만` 인데 합계에 MB 가 섞이면 안 된다.
 *     화면의 모든 숫자가 view.counts 하나에서 나오므로, 이 값이 틀리면 사람이
 *     「지난주보다 줄었네」로 잘못 읽는다.
 *  3. 🔴 **여기서 세지 않는다.** view.counts 는 buildWeeklyReport 가 이미 센 값
 *     **그 객체 그대로**여야 한다 — 다시 더해 만들면 같은 화면의 두 숫자가 갈릴
 *     자리가 생긴다. 아래 「같은 객체다」가 그것을 동일성으로 못 박는다.
 *  4. 이상한 값이 주소에 와도 **전체로 떨어지는가**(`?kind=XXX`).
 * ============================================================================
 */

/** 시험의 "오늘". 도메인 시험과 같은 값·같은 이유다(weekly-report.test.ts). */
const MIDDAY_KST = new Date("2026-08-25T05:00:00.000Z");

let sequence = 0;

function makeCase(overrides: Partial<WeeklyReportCase> = {}): WeeklyReportCase {
  sequence += 1;
  return {
    id: `case-${sequence}`,
    version: 1,
    intakeNumber: `D2601${String(sequence).padStart(2, "0")}`,
    customerName: "INVENIA",
    customerRowColor: null,
    workflowType: "PAID_MATCHER",
    status: "IN_REPAIR",
    currentWorkflowStepKey: "repair_in_progress",
    hasIntakeInspectionRecord: false,
    modelName: "RFG-1000",
    serialNumber: "SN-1",
    lotNumber: "LN-1",
    quoteIssuedDate: null,
    orderIssuedDate: null,
    notes: null,
    ...overrides,
  };
}

/**
 * 시험이 쓰는 보고서 — 두 종류의 숫자를 **서로 다르게** 만들어 둔다. 같으면
 * 「MB 가 섞였다」를 숫자로 알아볼 수 없다.
 *
 *   RFG  3대 (PO 발행 완료 1, 분류 안 됨 0)  — 수리 중 1 · PO 대기 중 1 · 출하 대기 1
 *   MB   3대 (PO 발행 완료 1, 분류 안 됨 1)  — 수리 중 1 · PO 대기 중 1 · 분류 안 됨 1
 *   전체 6대 (PO 발행 완료 2, 분류 안 됨 1)
 *
 * 총 대수만 같고(3·3) 칸의 내용이 달라서, 한쪽 값이 다른 쪽에 새면 반드시
 * 어느 칸에선가 드러난다.
 */
function buildFixture() {
  sequence = 0;
  const cases: WeeklyReportCase[] = [
    // ── RFG: Generator 둘, Total Controller 하나(도메인이 RFG 로 접는다) ──
    makeCase({ customerName: "INVENIA", workflowType: "PAID_GENERATOR", status: "IN_REPAIR" }),
    makeCase({
      customerName: "INVENIA",
      workflowType: "PAID_GENERATOR",
      status: "WAITING_PO",
      currentWorkflowStepKey: "waiting_po",
      orderIssuedDate: "2026-08-01",
    }),
    makeCase({
      customerName: "ATLAS",
      workflowType: "PAID_TOTAL_CONTROLLER",
      status: "WAITING_SHIPMENT",
      currentWorkflowStepKey: "waiting_shipment",
    }),
    // ── MB: Matcher 셋. 마지막 한 건은 어느 칸에도 안 맞는다 ──────────────
    makeCase({ customerName: "INVENIA", workflowType: "PAID_MATCHER", status: "IN_REPAIR" }),
    makeCase({
      customerName: "ATLAS",
      workflowType: "PAID_MATCHER",
      status: "WAITING_PO",
      currentWorkflowStepKey: "po_received",
      orderIssuedDate: "2026-08-02",
    }),
    makeCase({
      customerName: "ATLAS",
      workflowType: "PAID_MATCHER",
      status: null,
      currentWorkflowStepKey: "unknown_step",
    }),
  ];
  return buildWeeklyReport(cases, MIDDAY_KST);
}

// ────────────────────────────────────── 주소의 값을 접는다 (이상한 값 → 전체)

describe("주소의 `?kind=` 을 접는다", () => {
  test("세 가지는 그대로 통과한다", () => {
    assert.equal(normalizeWeeklyReportKindFilter("ALL"), "ALL");
    assert.equal(normalizeWeeklyReportKindFilter("RFG"), "RFG");
    assert.equal(normalizeWeeklyReportKindFilter("MB"), "MB");
  });

  test("🔴 모르는 값 · 없는 값은 전체로 떨어진다 — 지어내지 않는다", () => {
    for (const bad of ["XXX", "", " ", "rfg", "mb", "Rfg", "ALL ", "RFG,MB"]) {
      assert.equal(normalizeWeeklyReportKindFilter(bad), "ALL", `?kind=${bad}`);
    }
    assert.equal(normalizeWeeklyReportKindFilter(undefined), "ALL");
    assert.equal(normalizeWeeklyReportKindFilter(null), "ALL");
  });

  test("🔴 같은 이름이 두 번 오면(배열) 고르지 않고 전체로 떨어진다", () => {
    assert.equal(normalizeWeeklyReportKindFilter(["RFG", "MB"]), "ALL");
    assert.equal(normalizeWeeklyReportKindFilter(["RFG"]), "ALL");
    assert.equal(normalizeWeeklyReportKindFilter([]), "ALL");
  });

  test("고르개는 셋뿐이고 이름이 다 있다", () => {
    assert.deepEqual([...WEEKLY_REPORT_KIND_FILTERS], ["ALL", "RFG", "MB"]);
    assert.equal(weeklyReportKindFilterLabels.ALL, "전체");
    assert.equal(weeklyReportKindFilterLabels.RFG, "RFG 만");
    assert.equal(weeklyReportKindFilterLabels.MB, "MB 만");
  });
});

// ─────────────────────────────────────────── 주소를 만든다 (주와 종류가 함께)

describe("고른 값을 주소에 담는다", () => {
  test("🔴 주와 종류가 한 주소에 함께 실린다 — 주를 넘겨도 종류가 유지된다", () => {
    assert.equal(
      weeklyReportHref({ weekStart: "2026-08-24", kind: "RFG" }),
      "/dashboard/weekly-report?week=2026-08-24&kind=RFG"
    );
    assert.equal(
      weeklyReportHref({ weekStart: "2026-08-31", kind: "MB" }),
      "/dashboard/weekly-report?week=2026-08-31&kind=MB"
    );
  });

  test("전체는 `kind` 를 아예 적지 않는다 — 기본값을 주소에 남기지 않는다", () => {
    assert.equal(
      weeklyReportHref({ weekStart: "2026-08-24", kind: "ALL" }),
      "/dashboard/weekly-report?week=2026-08-24"
    );
  });

  test("만든 주소를 다시 접으면 넣은 값이 그대로 나온다", () => {
    for (const kind of WEEKLY_REPORT_KIND_FILTERS) {
      const href = weeklyReportHref({ weekStart: "2026-08-24", kind });
      const value = new URL(href, "https://example.invalid").searchParams.get("kind");
      assert.equal(normalizeWeeklyReportKindFilter(value), kind, href);
    }
  });
});

// ───────────────────────────────────────── 세 가지가 각각 무엇을 보여 주는가

describe("세 가지가 각각 무엇을 보여 주는가", () => {
  test("전체 — 두 종류, 총합 두 블록, PO 발행 현황 두 칸", () => {
    const view = buildWeeklyReportKindView(buildFixture(), "ALL");
    assert.equal(view.isFiltered, false);
    assert.deepEqual([...view.kinds], ["RFG", "MB"]);
    assert.deepEqual([...view.hiddenKinds], []);
    assert.deepEqual(
      view.totalsByKind.map((entry) => entry.kind),
      ["RFG", "MB"]
    );
    assert.deepEqual(
      view.poIssuance.map((entry) => entry.kind),
      ["RFG", "MB"]
    );
  });

  test("RFG 만 — RFG 하나뿐이고, 감춘 것은 MB 다", () => {
    const view = buildWeeklyReportKindView(buildFixture(), "RFG");
    assert.equal(view.isFiltered, true);
    assert.deepEqual([...view.kinds], ["RFG"]);
    assert.deepEqual([...view.hiddenKinds], ["MB"]);
    assert.deepEqual(
      view.totalsByKind.map((entry) => entry.kind),
      ["RFG"]
    );
    assert.deepEqual(
      view.poIssuance.map((entry) => entry.kind),
      ["RFG"]
    );
  });

  test("MB 만 — MB 하나뿐이고, 감춘 것은 RFG 다", () => {
    const view = buildWeeklyReportKindView(buildFixture(), "MB");
    assert.equal(view.isFiltered, true);
    assert.deepEqual([...view.kinds], ["MB"]);
    assert.deepEqual([...view.hiddenKinds], ["RFG"]);
    assert.deepEqual(
      view.totalsByKind.map((entry) => entry.kind),
      ["MB"]
    );
    assert.deepEqual(
      view.poIssuance.map((entry) => entry.kind),
      ["MB"]
    );
  });

  test("전체일 때 왼쪽은 언제나 RFG 다 — 차례가 매주 뒤바뀌면 견줄 수 없다", () => {
    const view = buildWeeklyReportKindView(buildFixture(), "ALL");
    assert.equal(view.kinds[0], "RFG");
    assert.equal(view.totalsByKind[0]?.kind, "RFG");
    assert.equal(view.poIssuance[0]?.kind, "RFG");
  });

  test("고객사 한 줄에서 그 종류의 블록을 꺼낸다 — 짝은 그대로 둔다", () => {
    const report = buildFixture();
    const pair = pairWeeklyReportBlocksByCustomer(report.blocks).find(
      (row) => row.customerName === "INVENIA"
    );
    assert.ok(pair);
    assert.equal(weeklyReportPairBlock(pair, "RFG"), pair.rfg);
    assert.equal(weeklyReportPairBlock(pair, "MB"), pair.mb);
    assert.equal(weeklyReportPairBlock(pair, "RFG").kind, "RFG");
    assert.equal(weeklyReportPairBlock(pair, "MB").kind, "MB");
  });

  test("visibleWeeklyReportKinds — 전체는 둘, 나머지는 고른 하나", () => {
    assert.deepEqual([...visibleWeeklyReportKinds("ALL")], ["RFG", "MB"]);
    assert.deepEqual([...visibleWeeklyReportKinds("RFG")], ["RFG"]);
    assert.deepEqual([...visibleWeeklyReportKinds("MB")], ["MB"]);
  });
});

// ────────────────────────── 🔴 합계가 고른 것과 맞는가 (MB 가 섞이면 안 된다)

describe("🔴 합계가 고른 것과 맞는가", () => {
  test("전체 — 화면의 숫자는 보고서 전체 총합 그대로다", () => {
    const report = buildFixture();
    const view = buildWeeklyReportKindView(report, "ALL");
    assert.equal(view.counts.total, 6);
    assert.equal(view.counts.poIssued, 2);
    assert.equal(view.counts.unclassified, 1);
    assert.equal(view.overallTotal, 6);
    assert.equal(view.hiddenTotal, 0);
  });

  test("🔴 RFG 만 — 합계에 MB 가 한 대도 섞이지 않는다", () => {
    const view = buildWeeklyReportKindView(buildFixture(), "RFG");
    assert.equal(view.counts.total, 3);
    // MB 의 PO 발행 완료 1건이 섞이면 2 가 된다.
    assert.equal(view.counts.poIssued, 1);
    // 분류 안 된 한 건은 MB 다 — RFG 화면에 그 경고가 뜨면 안 된다.
    assert.equal(view.counts.unclassified, 0);
    // 칸마다 본다: 전체로 세면 수리 중이 2 다.
    assert.equal(view.counts.byStatus.IN_REPAIR, 1);
    assert.equal(view.counts.byStatus.PO_WAITING, 1);
    assert.equal(view.counts.byStatus.SHIPMENT_WAITING, 1);
  });

  test("🔴 MB 만 — 합계에 RFG 가 한 대도 섞이지 않는다", () => {
    const view = buildWeeklyReportKindView(buildFixture(), "MB");
    assert.equal(view.counts.total, 3);
    assert.equal(view.counts.poIssued, 1);
    assert.equal(view.counts.unclassified, 1);
    assert.equal(view.counts.byStatus.IN_REPAIR, 1);
    assert.equal(view.counts.byStatus.PO_WAITING, 1);
    // 출하 대기 한 건은 RFG 다.
    assert.equal(view.counts.byStatus.SHIPMENT_WAITING, 0);
  });

  test("🔴 두 종류의 합이 전체와 같다 — 어느 것도 두 번 세거나 빠지지 않는다", () => {
    const report = buildFixture();
    const rfg = buildWeeklyReportKindView(report, "RFG");
    const mb = buildWeeklyReportKindView(report, "MB");
    const all = buildWeeklyReportKindView(report, "ALL");
    assert.equal(rfg.counts.total + mb.counts.total, all.counts.total);
    assert.equal(rfg.counts.poIssued + mb.counts.poIssued, all.counts.poIssued);
    assert.equal(rfg.counts.unclassified + mb.counts.unclassified, all.counts.unclassified);
  });

  test("🔴 감춘 대수를 말할 수 있다 — 숫자만 조용히 줄지 않는다", () => {
    const report = buildFixture();
    const rfg = buildWeeklyReportKindView(report, "RFG");
    assert.equal(rfg.overallTotal, 6);
    assert.equal(rfg.hiddenTotal, 3);
    assert.equal(rfg.counts.total + rfg.hiddenTotal, rfg.overallTotal);

    const mb = buildWeeklyReportKindView(report, "MB");
    assert.equal(mb.hiddenTotal, 3);
    assert.equal(mb.counts.total + mb.hiddenTotal, mb.overallTotal);
  });

  test("🔴 PO 발행 현황의 합이 그 종류의 PO 발행 완료 칸과 같다", () => {
    const report = buildFixture();
    for (const filter of ["ALL", "RFG", "MB"] as const) {
      const view = buildWeeklyReportKindView(report, filter);
      for (const issuance of view.poIssuance) {
        const totals = view.totalsByKind.find((entry) => entry.kind === issuance.kind);
        assert.ok(totals, `${filter} / ${issuance.kind}`);
        assert.equal(issuance.total, totals.counts.poIssued, `${filter} / ${issuance.kind}`);
      }
    }
  });
});

// ────────────────────────────────────────── 🔴 여기서 세지 않는다 (같은 객체)

describe("🔴 고르개는 보여 줄 뿐 세지 않는다", () => {
  test("전체의 합계는 report.total **그 객체 그대로**다", () => {
    const report = buildFixture();
    assert.equal(buildWeeklyReportKindView(report, "ALL").counts, report.total);
  });

  test("한 종류의 합계는 report.totalsByKind 의 **그 객체 그대로**다", () => {
    const report = buildFixture();
    for (const kind of ["RFG", "MB"] as const) {
      const fromReport = report.totalsByKind.find((entry) => entry.kind === kind);
      assert.ok(fromReport);
      assert.equal(buildWeeklyReportKindView(report, kind).counts, fromReport.counts);
    }
  });

  test("고르개를 어떻게 눌러도 보고서 자체는 한 글자도 바뀌지 않는다", () => {
    const report = buildFixture();
    const before = JSON.stringify(report);
    buildWeeklyReportKindView(report, "RFG");
    buildWeeklyReportKindView(report, "MB");
    buildWeeklyReportKindView(report, "ALL");
    assert.equal(JSON.stringify(report), before);
  });

  test("🔴 RFG/MB 판정 규칙을 이 파일이 다시 적지 않는다 — 대시보드가 같은 것을 쓴다", () => {
    // 접는 일은 buildWeeklyReport 안의 foldWeeklyReportKind 하나가 한다. 여기
    // 워크플로 종류가 한 번이라도 나오면 그 규칙이 둘로 갈라졌다는 뜻이다.
    // **부르는 자리만 본다** — 그 이름은 저 파일 머리말에 「손대지 않는다」로
    // 적혀 있고, 그 문장은 남아 있어야 한다.
    assert.ok(!/foldWeeklyReportKind\(/.test(selfSource), selfSource);
    assert.ok(!selfSource.includes("workflowType"), selfSource);
    assert.ok(!selfSource.includes("PAID_"), selfSource);
  });
});
