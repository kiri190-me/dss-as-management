import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { WORKFLOW_KIND_CODES, type WorkflowKind } from "@/lib/domain/workflow-kind";
import type { GridCell } from "@/lib/xlsx/sheet-grid";
import {
  cellToDate,
  cellToIdentifier,
  classifyKyosanRows,
  isKnownStatus,
  mapBilling,
  mapKind,
  mapStatus,
  resolveBilling,
  type KyosanDateCell,
  type KyosanExtractedRow,
} from "./rules";
import type { KyosanClassifiedRow, KyosanRawRow } from "./types";

const TODAY = "2026-09-15";

const text = (value: string): GridCell => ({ kind: "text", text: value });
const number = (value: number): GridCell => ({ kind: "number", value });
const date = (value: string): KyosanDateCell => ({ kind: "date", date: value });

/** 문제 없는 기본 줄. 고객사 이름은 가짜다. */
function extracted(
  overrides: Partial<KyosanRawRow> = {},
  dates: { received?: KyosanDateCell; shipped?: KyosanDateCell } = {}
): KyosanExtractedRow {
  const receivedDate = dates.received ?? date("2021-01-04");
  const shippedDate = dates.shipped ?? { kind: "empty" };
  return {
    raw: {
      rowNumber: 18,
      intakeNumber: "D210101",
      receivedAt: receivedDate.kind === "date" ? receivedDate.date : null,
      modelName: "TEST-MODEL-RF",
      kindText: "RF(FH)",
      lotNumber: "LN-0001",
      serialNumber: "1912120",
      customerName: "TEST-CUSTOMER-A",
      endUserName: "TEST-END-USER-A",
      reportedSymptom: "출력이 나오지 않음",
      statusText: "受付",
      shippedAt: shippedDate.kind === "date" ? shippedDate.date : null,
      reportNumber: null,
      billingText: "有償",
      ...overrides,
    },
    receivedDate,
    shippedDate,
  };
}

function classifyOne(row: KyosanExtractedRow): KyosanClassifiedRow {
  return classifyKyosanRows([row], { today: TODAY })[0];
}

function reasonsOf(row: KyosanClassifiedRow): string[] {
  if (row.outcome !== "NEEDS_REVIEW") throw new Error(`NEEDS_REVIEW 여야 합니다: ${JSON.stringify(row)}`);
  return row.reasons;
}

function importable(row: KyosanClassifiedRow) {
  if (row.outcome !== "IMPORTABLE") throw new Error(`IMPORTABLE 이어야 합니다: ${JSON.stringify(row)}`);
  return row;
}

describe("칸 → 글자", () => {
  test("숫자 칸은 .0·지수 표기 없는 정수 문자열", () => {
    assert.equal(cellToIdentifier(number(1912120)), "1912120");
    assert.equal(cellToIdentifier(number(1.91212e6)), "1912120");
    assert.equal(cellToIdentifier(number(1e21)), "1000000000000000000000");
    assert.equal(cellToIdentifier(number(0.1 + 0.2)), "0.3");
  });

  test("글자 칸은 trim 만, 비면 null", () => {
    assert.equal(cellToIdentifier(text("  LN-01 \n")), "LN-01");
    assert.equal(cellToIdentifier(text("ＬＮ－０１")), "ＬＮ－０１");
    assert.equal(cellToIdentifier(text("   ")), null);
    assert.equal(cellToIdentifier(undefined), null);
  });
});

describe("날짜 칸", () => {
  test("Excel 일련번호 — 1900 / 1904 체계, 시각은 버린다", () => {
    assert.deepEqual(cellToDate(number(44200), false), date("2021-01-04"));
    assert.deepEqual(cellToDate(number(42738), true), date("2021-01-04"));
    assert.deepEqual(cellToDate(number(44200.75), false), date("2021-01-04"));
  });

  test("글자 날짜 — YYYY-MM-DD · YYYY/MM/DD · 전각 숫자", () => {
    assert.deepEqual(cellToDate(text("2021/01/05"), false), date("2021-01-05"));
    assert.deepEqual(cellToDate(text("2021-1-6"), false), date("2021-01-06"));
    assert.deepEqual(cellToDate(text("２０２１／０１／０７"), false), date("2021-01-07"));
  });

  test("못 읽는 날짜는 invalid(적힌 글자와 함께), 빈칸은 empty", () => {
    assert.deepEqual(cellToDate(text("2021-02-30"), false), { kind: "invalid", text: "2021-02-30" });
    assert.deepEqual(cellToDate(text("2021/01-05"), false), { kind: "invalid", text: "2021/01-05" });
    assert.deepEqual(cellToDate(text(" 令和3年1月4日 "), false), { kind: "invalid", text: "令和3年1月4日" });
    assert.deepEqual(cellToDate(number(60), false), { kind: "invalid", text: "60" });
    assert.deepEqual(cellToDate(number(-1), false), { kind: "invalid", text: "-1" });
    assert.deepEqual(cellToDate(number(3_000_000), false), { kind: "invalid", text: "3000000" });
    assert.deepEqual(cellToDate(text("   "), false), { kind: "empty" });
    assert.deepEqual(cellToDate(undefined, false), { kind: "empty" });
  });
});

describe("종류(G) · 상태(O) · 유/무상(Y) 표", () => {
  test("종류 — RF… · MB… · その他 · TTB/DUO · 빈칸 · 그 밖", () => {
    const cases: [string | null, ReturnType<typeof mapKind>][] = [
      ["RF(FH)", "GENERATOR"],
      ["RF(FS)", "GENERATOR"],
      ["RF(TP)", "GENERATOR"],
      ["rf(tp)", "GENERATOR"],
      ["ＲＦ（ＦＨ）", "GENERATOR"],
      ["MB", "MATCHER"],
      ["mb-2", "MATCHER"],
      ["その他", "TOTAL_CONTROLLER"],
      [" その他 ", "TOTAL_CONTROLLER"],
      ["TTB/DUO", "EXCLUDED"],
      ["ＴＴＢ／ｄｕｏ", "EXCLUDED"],
      [null, null],
      ["   ", null],
      ["DC", null],
      ["TTB", null],
    ];
    for (const [kindText, expected] of cases) assert.equal(mapKind(kindText), expected, String(kindText));
  });

  const STATUS_TABLE: readonly [string, Record<WorkflowKind, string>][] = [
    ["受付", { MATCHER: "intake_inspection", GENERATOR: "intake_inspection", TOTAL_CONTROLLER: "intake_inspection" }],
    ["調査完了", { MATCHER: "intake_inspection", GENERATOR: "intake_inspection", TOTAL_CONTROLLER: "intake_inspection" }],
    ["中断:客先待ち", { MATCHER: "waiting_po", GENERATOR: "waiting_po", TOTAL_CONTROLLER: "waiting_po" }],
    ["中断:部材待ち", { MATCHER: "parts_supply", GENERATOR: "parts_supply", TOTAL_CONTROLLER: "parts_supply" }],
    [
      "中断:指示待ち",
      { MATCHER: "waiting_kyosan_reply", GENERATOR: "waiting_kyosan_reply", TOTAL_CONTROLLER: "waiting_kyosan_reply" },
    ],
    [
      "修理作業待ち",
      {
        MATCHER: "repair_in_progress",
        GENERATOR: "repair_or_defective_parts_replacement",
        TOTAL_CONTROLLER: "repair_or_defective_parts_replacement",
      },
    ],
    [
      "修理中",
      {
        MATCHER: "repair_in_progress",
        GENERATOR: "repair_or_defective_parts_replacement",
        TOTAL_CONTROLLER: "repair_or_defective_parts_replacement",
      },
    ],
    [
      "修理完了",
      {
        MATCHER: "repair_in_progress",
        GENERATOR: "repair_or_defective_parts_replacement",
        TOTAL_CONTROLLER: "repair_or_defective_parts_replacement",
      },
    ],
    ["出荷待ち", { MATCHER: "waiting_shipment", GENERATOR: "shipment_approved", TOTAL_CONTROLLER: "shipment_approved" }],
    ["出荷済み", { MATCHER: "shipment_completed", GENERATOR: "shipment_completed", TOTAL_CONTROLLER: "shipment_completed" }],
  ];

  test("상태 10가지 × 종류 3가지 → 목표 단계", () => {
    for (const [status, byKind] of STATUS_TABLE) {
      assert.equal(isKnownStatus(status), true, status);
      for (const kind of WORKFLOW_KIND_CODES) {
        assert.equal(mapStatus(status, kind), byKind[kind], `${status} × ${kind}`);
      }
    }
  });

  test("전각 콜론은 NFKC 로 같은 상태", () => {
    assert.equal(mapStatus("中断：客先待ち", "GENERATOR"), "waiting_po");
    assert.equal(mapStatus(" 中断：部材待ち ", "MATCHER"), "parts_supply");
    assert.equal(mapStatus("中断：指示待ち", "TOTAL_CONTROLLER"), "waiting_kyosan_reply");
  });

  test("모르는 상태 · 빈칸은 null", () => {
    assert.equal(mapStatus("保留", "GENERATOR"), null);
    assert.equal(mapStatus(null, "MATCHER"), null);
    assert.equal(isKnownStatus("保留"), false);
    assert.equal(isKnownStatus(null), false);
  });

  test("유/무상 — 有償 · 無償 · 調整中 · 빈칸 · 그 밖", () => {
    assert.deepEqual(mapBilling("有償"), { billingType: "PAID", billingReview: false, sourceBilling: "有償" });
    assert.deepEqual(mapBilling(" 無償 "), { billingType: "WARRANTY", billingReview: false, sourceBilling: "無償" });
    assert.deepEqual(mapBilling("調整中"), { billingType: "PAID", billingReview: true, sourceBilling: "調整中" });
    assert.deepEqual(mapBilling(null), { billingType: "PAID", billingReview: true, sourceBilling: null });
    assert.deepEqual(mapBilling("  "), { billingType: "PAID", billingReview: true, sourceBilling: null });
    assert.deepEqual(mapBilling("半額"), { billingType: "PAID", billingReview: true, sourceBilling: "半額" });
  });
});

describe("줄 분류 — 가져오는 줄", () => {
  test("기본 줄 — 모양 전체", () => {
    const row = extracted();
    assert.deepEqual(classifyOne(row), {
      raw: row.raw,
      outcome: "IMPORTABLE",
      workflowKind: "GENERATOR",
      billingType: "PAID",
      workflowType: "PAID_GENERATOR",
      targetStepKey: "intake_inspection",
      actualShipmentDate: null,
      billingReview: false,
      sourceBilling: "有償",
      billingAdjustment: null,
      warnings: [],
    });
  });

  test("종류 × 유/무상 → workflowType(deriveWorkflowType)", () => {
    const cases: [string, string | null, WorkflowKind, string][] = [
      ["RF(FH)", "有償", "GENERATOR", "PAID_GENERATOR"],
      ["RF(TP)", "無償", "GENERATOR", "WARRANTY_GENERATOR"],
      ["MB", "有償", "MATCHER", "PAID_MATCHER"],
      ["MB", "無償", "MATCHER", "WARRANTY_MATCHER"],
      ["その他", "有償", "TOTAL_CONTROLLER", "PAID_TOTAL_CONTROLLER"],
      ["その他", "無償", "TOTAL_CONTROLLER", "WARRANTY_TOTAL_CONTROLLER"],
      ["その他", "調整中", "TOTAL_CONTROLLER", "PAID_TOTAL_CONTROLLER"],
      ["MB", null, "MATCHER", "PAID_MATCHER"],
    ];
    for (const [kindText, billingText, workflowKind, workflowType] of cases) {
      const row = importable(classifyOne(extracted({ kindText, billingText })));
      assert.equal(row.workflowKind, workflowKind, `${kindText} ${billingText}`);
      assert.equal(row.workflowType, workflowType, `${kindText} ${billingText}`);
    }
  });

  test("유/무상이 有償·無償 이 아니면 가져오되 PAID + billingReview", () => {
    const blank = importable(classifyOne(extracted({ billingText: null })));
    assert.deepEqual(
      [blank.billingType, blank.billingReview, blank.sourceBilling],
      ["PAID", true, null]
    );
    const adjusting = importable(classifyOne(extracted({ billingText: "調整中" })));
    assert.deepEqual(
      [adjusting.billingType, adjusting.billingReview, adjusting.sourceBilling],
      ["PAID", true, "調整中"]
    );
    const warranty = importable(classifyOne(extracted({ billingText: "無償" })));
    assert.deepEqual(
      [warranty.billingType, warranty.billingReview, warranty.sourceBilling],
      ["WARRANTY", false, "無償"]
    );
  });

  test("상태 10가지 × 매쳐·제너레이터·T/C — 출하일은 出荷済み 에서만 쓴다", () => {
    const kindText: Record<WorkflowKind, string> = { MATCHER: "MB", GENERATOR: "RF(FS)", TOTAL_CONTROLLER: "その他" };
    const expectations: Record<string, Record<WorkflowKind, string>> = {
      受付: { MATCHER: "intake_inspection", GENERATOR: "intake_inspection", TOTAL_CONTROLLER: "intake_inspection" },
      調査完了: { MATCHER: "intake_inspection", GENERATOR: "intake_inspection", TOTAL_CONTROLLER: "intake_inspection" },
      "中断：客先待ち": { MATCHER: "waiting_po", GENERATOR: "waiting_po", TOTAL_CONTROLLER: "waiting_po" },
      "中断：部材待ち": { MATCHER: "parts_supply", GENERATOR: "parts_supply", TOTAL_CONTROLLER: "parts_supply" },
      "中断：指示待ち": {
        MATCHER: "waiting_kyosan_reply",
        GENERATOR: "waiting_kyosan_reply",
        TOTAL_CONTROLLER: "waiting_kyosan_reply",
      },
      修理作業待ち: {
        MATCHER: "repair_in_progress",
        GENERATOR: "repair_or_defective_parts_replacement",
        TOTAL_CONTROLLER: "repair_or_defective_parts_replacement",
      },
      修理中: {
        MATCHER: "repair_in_progress",
        GENERATOR: "repair_or_defective_parts_replacement",
        TOTAL_CONTROLLER: "repair_or_defective_parts_replacement",
      },
      修理完了: {
        MATCHER: "repair_in_progress",
        GENERATOR: "repair_or_defective_parts_replacement",
        TOTAL_CONTROLLER: "repair_or_defective_parts_replacement",
      },
      出荷待ち: { MATCHER: "waiting_shipment", GENERATOR: "shipment_approved", TOTAL_CONTROLLER: "shipment_approved" },
      出荷済み: { MATCHER: "shipment_completed", GENERATOR: "shipment_completed", TOTAL_CONTROLLER: "shipment_completed" },
    };
    for (const [statusText, byKind] of Object.entries(expectations)) {
      for (const kind of WORKFLOW_KIND_CODES) {
        const row = importable(
          classifyOne(
            extracted(
              { kindText: kindText[kind], modelName: `TEST-MODEL-${kind}`, statusText },
              { shipped: date("2021-02-01") }
            )
          )
        );
        const label = `${statusText} × ${kind}`;
        assert.equal(row.targetStepKey, byKind[kind], label);
        assert.equal(row.actualShipmentDate, statusText === "出荷済み" ? "2021-02-01" : null, label);
        assert.equal(row.raw.statusText, statusText, label);
      }
    }
  });

  test("END-USER · 신고증상 · 보고서 번호는 비어도 된다", () => {
    importable(classifyOne(extracted({ endUserName: null, reportedSymptom: null, reportNumber: null })));
  });

  test("출하 완료가 아닌 줄의 출하일은 무시한다 — 못 읽는 글자여도", () => {
    const row = importable(
      classifyOne(extracted({ statusText: "修理中" }, { shipped: { kind: "invalid", text: "未定" } }))
    );
    assert.equal(row.actualShipmentDate, null);
  });

  test("출하일 경계 — 인수일과 같은 날 · 오늘은 된다", () => {
    const sameDay = importable(
      classifyOne(extracted({ statusText: "出荷済み" }, { shipped: date("2021-01-04") }))
    );
    assert.equal(sameDay.actualShipmentDate, "2021-01-04");
    const today = importable(classifyOne(extracted({ statusText: "出荷済み" }, { shipped: date(TODAY) })));
    assert.equal(today.actualShipmentDate, TODAY);
  });

  test("인수일 경계 — 2000-01-01 은 된다", () => {
    importable(classifyOne(extracted({ intakeNumber: "D000101" }, { received: date("2000-01-01") })));
  });

  test("경고: 인수일의 연월 ≠ 인수번호의 연월 — 가져오긴 한다", () => {
    const row = importable(classifyOne(extracted({ intakeNumber: "D210201" })));
    assert.deepEqual(row.warnings, [
      "인수일(D열) 2021-01-04 의 연월(2101)이 인수번호 D210201 의 연월(2102)과 다릅니다.",
    ]);
  });
});

describe("無償 + 中断:客先待ち → 일부 유상(PARTIAL_PAID) · waiting_po (사용자 결정 2026-09-15)", () => {
  const WARNING = "費用(Y열)은 無償이지만 상태가 中断：客先待ち(PO 대기)라 일부 유상으로 가져옵니다.";
  const KINDS: readonly [string, WorkflowKind][] = [
    ["MB", "MATCHER"],
    ["RF(FH)", "GENERATOR"],
    ["その他", "TOTAL_CONTROLLER"],
  ];
  const PAID_TYPE: Record<WorkflowKind, string> = {
    MATCHER: "PAID_MATCHER",
    GENERATOR: "PAID_GENERATOR",
    TOTAL_CONTROLLER: "PAID_TOTAL_CONTROLLER",
  };
  const WARRANTY_TYPE: Record<WorkflowKind, string> = {
    MATCHER: "WARRANTY_MATCHER",
    GENERATOR: "WARRANTY_GENERATOR",
    TOTAL_CONTROLLER: "WARRANTY_TOTAL_CONTROLLER",
  };

  function billingOf(row: KyosanClassifiedRow) {
    const result = importable(row);
    return {
      workflowKind: result.workflowKind,
      billingType: result.billingType,
      workflowType: result.workflowType,
      targetStepKey: result.targetStepKey,
      billingReview: result.billingReview,
      sourceBilling: result.sourceBilling,
      billingAdjustment: result.billingAdjustment,
      warnings: result.warnings,
    };
  }

  function rowOf(kindText: string, kind: WorkflowKind, billingText: string | null, statusText: string) {
    return extracted({ kindText, modelName: `TEST-MODEL-${kind}`, billingText, statusText });
  }

  test("매쳐 · 제너레이터 · T/C 모두 — 유상 절차의 PO 대기로, 원문은 無償 그대로", () => {
    for (const [kindText, kind] of KINDS) {
      assert.deepEqual(
        billingOf(classifyOne(rowOf(kindText, kind, "無償", "中断:客先待ち"))),
        {
          workflowKind: kind,
          billingType: "PARTIAL_PAID",
          workflowType: PAID_TYPE[kind],
          targetStepKey: "waiting_po",
          billingReview: false,
          sourceBilling: "無償",
          billingAdjustment: "WARRANTY_PO_TO_PARTIAL_PAID",
          warnings: [WARNING],
        },
        kindText
      );
    }
  });

  test("전각 콜론 · 앞뒤 공백이 섞인 입력도 같은 결과", () => {
    for (const [kindText, kind] of KINDS) {
      assert.deepEqual(
        billingOf(classifyOne(rowOf(kindText, kind, " 無償 ", " 中断：客先待ち "))),
        {
          workflowKind: kind,
          billingType: "PARTIAL_PAID",
          workflowType: PAID_TYPE[kind],
          targetStepKey: "waiting_po",
          billingReview: false,
          sourceBilling: "無償",
          billingAdjustment: "WARRANTY_PO_TO_PARTIAL_PAID",
          warnings: [WARNING],
        },
        kindText
      );
    }
  });

  test("有償 + 客先待ち — 바뀌지 않는다(PAID · waiting_po · 표시 없음)", () => {
    for (const [kindText, kind] of KINDS) {
      assert.deepEqual(
        billingOf(classifyOne(rowOf(kindText, kind, "有償", "中断：客先待ち"))),
        {
          workflowKind: kind,
          billingType: "PAID",
          workflowType: PAID_TYPE[kind],
          targetStepKey: "waiting_po",
          billingReview: false,
          sourceBilling: "有償",
          billingAdjustment: null,
          warnings: [],
        },
        kindText
      );
    }
  });

  test("調整中 · 빈칸 + 客先待ち — 바뀌지 않는다(PAID · waiting_po · 확인 표시)", () => {
    for (const [kindText, kind] of KINDS) {
      for (const billingText of ["調整中", null]) {
        assert.deepEqual(
          billingOf(classifyOne(rowOf(kindText, kind, billingText, "中断:客先待ち"))),
          {
            workflowKind: kind,
            billingType: "PAID",
            workflowType: PAID_TYPE[kind],
            targetStepKey: "waiting_po",
            billingReview: true,
            sourceBilling: billingText,
            billingAdjustment: null,
            warnings: [],
          },
          `${kindText} ${String(billingText)}`
        );
      }
    }
  });

  test("無償 + 다른 상태 9가지 — WARRANTY 그대로", () => {
    const otherStatuses = [
      "受付",
      "調査完了",
      "中断：部材待ち",
      "中断：指示待ち",
      "修理作業待ち",
      "修理中",
      "修理完了",
      "出荷待ち",
      "出荷済み",
    ];
    for (const statusText of otherStatuses) {
      for (const [kindText, kind] of KINDS) {
        const row = extracted(
          { kindText, modelName: `TEST-MODEL-${kind}`, billingText: "無償", statusText },
          { shipped: date("2021-02-01") }
        );
        const result = billingOf(classifyOne(row));
        const label = `${statusText} × ${kind}`;
        assert.equal(result.billingType, "WARRANTY", label);
        assert.equal(result.workflowType, WARRANTY_TYPE[kind], label);
        assert.equal(result.billingAdjustment, null, label);
        assert.equal(result.billingReview, false, label);
        assert.deepEqual(result.warnings, [], label);
      }
    }
  });

  test("연월 경고와 함께면 경고 둘 — 연월 → 유/무상 순", () => {
    const result = billingOf(
      classifyOne(extracted({ intakeNumber: "D210201", billingText: "無償", statusText: "中断:客先待ち" }))
    );
    assert.deepEqual(result.warnings, [
      "인수일(D열) 2021-01-04 의 연월(2101)이 인수번호 D210201 의 연월(2102)과 다릅니다.",
      WARNING,
    ]);
  });

  test("일부 유상으로 바꿔도 확인 필요 사유 · 제외는 그대로 이긴다", () => {
    assert.deepEqual(
      reasonsOf(classifyOne(extracted({ billingText: "無償", statusText: "中断:客先待ち", serialNumber: null }))),
      ["S/N(I열)이 비어 있습니다."]
    );
    assert.equal(
      classifyOne(extracted({ kindText: "TTB/DUO", billingText: "無償", statusText: "中断:客先待ち" })).outcome,
      "EXCLUDED"
    );
  });

  test("resolveBilling — 유/무상 × 상태만 보고 정한다", () => {
    assert.deepEqual(resolveBilling("無償", "中断：客先待ち"), {
      billingType: "PARTIAL_PAID",
      billingReview: false,
      sourceBilling: "無償",
      billingAdjustment: "WARRANTY_PO_TO_PARTIAL_PAID",
    });
    assert.deepEqual(resolveBilling("無償", "受付"), {
      billingType: "WARRANTY",
      billingReview: false,
      sourceBilling: "無償",
      billingAdjustment: null,
    });
    assert.deepEqual(resolveBilling("有償", "中断:客先待ち"), {
      billingType: "PAID",
      billingReview: false,
      sourceBilling: "有償",
      billingAdjustment: null,
    });
    assert.deepEqual(resolveBilling(null, "中断:客先待ち"), {
      billingType: "PAID",
      billingReview: true,
      sourceBilling: null,
      billingAdjustment: null,
    });
    assert.deepEqual(resolveBilling("無償", null), {
      billingType: "WARRANTY",
      billingReview: false,
      sourceBilling: "無償",
      billingAdjustment: null,
    });
  });
});

describe("줄 분류 — 제외", () => {
  test("TTB/DUO 는 다른 문제가 있어도 제외가 이긴다", () => {
    const row = classifyOne(
      extracted({ kindText: "TTB/DUO", intakeNumber: null, serialNumber: null, statusText: "保留" })
    );
    assert.deepEqual(
      { outcome: row.outcome, reason: row.outcome === "EXCLUDED" ? row.reason : null },
      { outcome: "EXCLUDED", reason: '종류(G열)이 "TTB/DUO" 입니다 — TTB/DUO 는 가져오지 않습니다.' }
    );
  });
});

describe("줄 분류 — 확인 필요 사유", () => {
  const cases: [string, KyosanExtractedRow, string[]][] = [
    ["인수번호 빈칸", extracted({ intakeNumber: null }), ["인수번호(C열)이 비어 있습니다."]],
    [
      "인수번호 소문자 d",
      extracted({ intakeNumber: "d210101" }),
      ['인수번호(C열) 형식이 틀렸습니다: "d210101" — 대문자 D 뒤에 연월 4자리와 순번 2자리(예: D210105)여야 합니다.'],
    ],
    [
      "인수번호 13월",
      extracted({ intakeNumber: "D211301" }),
      ['인수번호(C열) 형식이 틀렸습니다: "D211301" — 대문자 D 뒤에 연월 4자리와 순번 2자리(예: D210105)여야 합니다.'],
    ],
    [
      "인수번호 자릿수",
      extracted({ intakeNumber: "D2101001" }),
      ['인수번호(C열) 형식이 틀렸습니다: "D2101001" — 대문자 D 뒤에 연월 4자리와 순번 2자리(예: D210105)여야 합니다.'],
    ],
    ["인수일 빈칸", extracted({}, { received: { kind: "empty" } }), ["인수일(D열)이 비어 있습니다."]],
    [
      "인수일 못 읽음",
      extracted({}, { received: { kind: "invalid", text: "3월 초" } }),
      ['인수일(D열)을 날짜로 읽지 못했습니다: "3월 초" — 날짜 서식이나 YYYY-MM-DD 로 적어 주세요.'],
    ],
    [
      "인수일 2000-01-01 이전",
      extracted({ intakeNumber: "D991201" }, { received: date("1999-12-31") }),
      ["인수일(D열) 1999-12-31 이 너무 이릅니다 — 2000-01-01 이후여야 합니다."],
    ],
    ["모델 빈칸", extracted({ modelName: null }), ["모델(F열)이 비어 있습니다."]],
    ["고객사 빈칸", extracted({ customerName: null }), ["고객사(J열)이 비어 있습니다."]],
    ["L/N 빈칸", extracted({ lotNumber: null }), ["L/N(H열)이 비어 있습니다."]],
    ["S/N 빈칸", extracted({ serialNumber: null }), ["S/N(I열)이 비어 있습니다."]],
    ["종류 빈칸", extracted({ kindText: null }), ["종류(G열)이 비어 있습니다."]],
    [
      "종류 모름",
      extracted({ kindText: "DC" }),
      ['종류(G열)을 알 수 없습니다: "DC" — RF…·MB…·その他·TTB/DUO 가운데 하나여야 합니다.'],
    ],
    [
      "종류 모름 + 종류에 따라 갈리는 상태 — 사유는 종류 하나",
      extracted({ kindText: "DC", statusText: "修理中" }),
      ['종류(G열)을 알 수 없습니다: "DC" — RF…·MB…·その他·TTB/DUO 가운데 하나여야 합니다.'],
    ],
    ["상태 빈칸", extracted({ statusText: null }), ["상태(O열)이 비어 있습니다."]],
    [
      "상태 모름",
      extracted({ statusText: "保留" }),
      [
        '상태(O열)을 알 수 없습니다: "保留" — 受付·調査完了·中断:客先待ち·中断:部材待ち·中断:指示待ち·修理作業待ち·修理中·修理完了·出荷待ち·出荷済み 가운데 하나여야 합니다.',
      ],
    ],
    [
      "出荷済み 인데 출하일 빈칸",
      extracted({ statusText: "出荷済み" }),
      ["상태(O열)이 出荷済み 인데 출하일(S열)이 비어 있습니다."],
    ],
    [
      "出荷済み 인데 출하일 못 읽음",
      extracted({ statusText: "出荷済み" }, { shipped: { kind: "invalid", text: "未定" } }),
      ['출하일(S열)을 날짜로 읽지 못했습니다: "未定" — 날짜 서식이나 YYYY-MM-DD 로 적어 주세요.'],
    ],
    [
      "출하일 < 인수일",
      extracted({ statusText: "出荷済み" }, { shipped: date("2021-01-03") }),
      ["출하일(S열) 2021-01-03 이 인수일(D열) 2021-01-04 보다 이릅니다."],
    ],
    [
      "출하일이 오늘 이후",
      extracted({ statusText: "出荷済み" }, { shipped: date("2026-09-16") }),
      ["출하일(S열) 2026-09-16 이 오늘(2026-09-15)보다 뒤입니다."],
    ],
    [
      "사유 여러 개",
      extracted({ customerName: null, lotNumber: null, serialNumber: null }),
      ["고객사(J열)이 비어 있습니다.", "L/N(H열)이 비어 있습니다.", "S/N(I열)이 비어 있습니다."],
    ],
  ];

  for (const [name, row, expected] of cases) {
    test(name, () => {
      assert.deepEqual(reasonsOf(classifyOne(row)), expected);
    });
  }
});

describe("줄 분류 — 파일 안에서 겹치는 것", () => {
  function numbered(rowNumber: number, overrides: Partial<KyosanRawRow>): KyosanExtractedRow {
    return extracted({ rowNumber, ...overrides });
  }

  test("같은 인수번호가 두 줄 — 그 줄들 전부", () => {
    const [first, other, second] = classifyKyosanRows(
      [
        numbered(18, { intakeNumber: "D210101" }),
        numbered(20, { intakeNumber: "D210102" }),
        numbered(25, { intakeNumber: "D210101" }),
      ],
      { today: TODAY }
    );
    const reason = "인수번호 D210101 이 파일 안에 여러 번 있습니다(18·25행) — 한 번만 적혀 있어야 합니다.";
    assert.deepEqual(reasonsOf(first), [reason]);
    assert.deepEqual(reasonsOf(second), [reason]);
    importable(other);
  });

  test("여러 번이면 다섯 줄까지 적고 나머지는 '외 N줄'", () => {
    const rows = classifyKyosanRows(
      [18, 19, 20, 21, 22, 23, 24].map((rowNumber) => numbered(rowNumber, { intakeNumber: "D210101" })),
      { today: TODAY }
    );
    assert.deepEqual(reasonsOf(rows[6]), [
      "인수번호 D210101 이 파일 안에 여러 번 있습니다(18·19·20·21·22행 외 2줄) — 한 번만 적혀 있어야 합니다.",
    ]);
  });

  test("제외될 줄과 번호가 겹쳐도 나머지 줄은 확인 필요 — 제외 줄은 제외 그대로", () => {
    const [kept, excluded] = classifyKyosanRows(
      [
        numbered(18, { intakeNumber: "D210101" }),
        numbered(19, { intakeNumber: "D210101", kindText: "TTB/DUO", modelName: "TEST-MODEL-TTB" }),
      ],
      { today: TODAY }
    );
    assert.deepEqual(reasonsOf(kept), [
      "인수번호 D210101 이 파일 안에 여러 번 있습니다(18·19행) — 한 번만 적혀 있어야 합니다.",
    ]);
    assert.equal(excluded.outcome, "EXCLUDED");
  });

  test("같은 모델(NFKC 키)이 다른 종류로 — 그 줄들 전부, 이름은 원문대로", () => {
    const rows = classifyKyosanRows(
      [
        numbered(18, { intakeNumber: "D210101", modelName: "TEST-MODEL-X", kindText: "RF(FH)" }),
        numbered(19, { intakeNumber: "D210102", modelName: "ｔｅｓｔ－ｍｏｄｅｌ－ｘ", kindText: "MB" }),
        numbered(20, { intakeNumber: "D210103", modelName: "TEST-MODEL-Y", kindText: "RF(FH)" }),
        numbered(21, { intakeNumber: "D210104", modelName: "TEST-MODEL-X", kindText: "RF(TP)" }),
      ],
      { today: TODAY }
    );
    const where = "18행 RF(FH) · 19행 MB · 21행 RF(TP)";
    assert.deepEqual(reasonsOf(rows[0]), [
      `모델 "TEST-MODEL-X" 이 파일 안에서 서로 다른 종류로 적혀 있습니다(${where}) — 한 종류로 맞춰 주세요.`,
    ]);
    assert.deepEqual(reasonsOf(rows[1]), [
      `모델 "ｔｅｓｔ－ｍｏｄｅｌ－ｘ" 이 파일 안에서 서로 다른 종류로 적혀 있습니다(${where}) — 한 종류로 맞춰 주세요.`,
    ]);
    importable(rows[2]);
    assert.equal(reasonsOf(rows[3]).length, 1);
  });

  test("글자만 다르고 판정이 같은 종류(RF(FH)·RF(FS))는 충돌이 아니다", () => {
    const rows = classifyKyosanRows(
      [
        numbered(18, { intakeNumber: "D210101", modelName: "TEST-MODEL-X", kindText: "RF(FH)" }),
        numbered(19, { intakeNumber: "D210102", modelName: "TEST-MODEL-X", kindText: "RF(FS)" }),
      ],
      { today: TODAY }
    );
    rows.forEach(importable);
  });

  test("TTB/DUO 와 같은 모델이면 다른 줄은 확인 필요, 종류 모름 줄은 견주지 않는다", () => {
    const withExcluded = classifyKyosanRows(
      [
        numbered(18, { intakeNumber: "D210101", modelName: "TEST-MODEL-X", kindText: "RF(FH)" }),
        numbered(19, { intakeNumber: "D210102", modelName: "TEST-MODEL-X", kindText: "TTB/DUO" }),
      ],
      { today: TODAY }
    );
    assert.equal(reasonsOf(withExcluded[0]).length, 1);
    assert.equal(withExcluded[1].outcome, "EXCLUDED");

    const withUnknown = classifyKyosanRows(
      [
        numbered(18, { intakeNumber: "D210101", modelName: "TEST-MODEL-X", kindText: "RF(FH)" }),
        numbered(19, { intakeNumber: "D210102", modelName: "TEST-MODEL-X", kindText: "DC" }),
      ],
      { today: TODAY }
    );
    importable(withUnknown[0]);
    assert.deepEqual(reasonsOf(withUnknown[1]), [
      '종류(G열)을 알 수 없습니다: "DC" — RF…·MB…·その他·TTB/DUO 가운데 하나여야 합니다.',
    ]);
  });
});

test("today 가 YYYY-MM-DD 날짜가 아니면 던진다", () => {
  assert.throws(() => classifyKyosanRows([], { today: "2026-9-15" }), /today/);
  assert.throws(() => classifyKyosanRows([], { today: "2026-02-30" }), /today/);
});
