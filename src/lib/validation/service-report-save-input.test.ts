import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildServiceReportRequestBody } from "@/lib/domain/service-report-form";
import {
  serviceReportFormValues,
  toServiceReportColumns,
  toServiceReportSaveValues,
  type ServiceReportRecord,
  type ServiceReportSaveValues,
} from "./service-report-save-input";

/**
 * ============================================================================
 * 저장했다 불러오면 적어 둔 그대로인가
 * ============================================================================
 * 이 사전이 틀리면 **오류가 나지 않는다.** 다시 열었을 때 값이 조금 다를 뿐이고,
 * 그 차이는 고객사로 나간 문서에서야 드러난다. 그래서 여기서 못 박는 것은
 * 「무엇이 거절되는가」보다 **「무엇이 그대로 남는가」**에 무게가 있다.
 *
 * 뼈대는 왕복이다: 폼 값 → 칸 값 → 폼 값이 처음과 같아야 한다. 칸이 하나 늘면
 * `ServiceReportFormValues` 를 돌려주는 타입이 tsc 에서 먼저 잡고, 옮기는 것을
 * 잊으면 이 왕복이 잡는다.
 * ============================================================================
 */

const INTRO = "인수품에 대하여 이하의 항목을 확인하였습니다.";

/** 모든 칸이 채워진 한 장. 왕복 시험은 여기서 시작한다. */
function filled(overrides: Partial<ServiceReportSaveValues> = {}): ServiceReportSaveValues {
  return {
    kind: "REPAIR",

    customerName: "ICD Co.,Ltd",
    issuedOn: "2026-09-02",
    reportNumberPrefix: "DSS",
    reportNumberMiddle: "Z494",
    reportNumberTail: "001",
    customer: "생산기술부 김과장",
    receivedOn: "2026-08-20",
    occurrencePlace: "천안 2공장",
    occurrencePlaceDetail: "3층 라인 B",
    occurredOnMode: "DATE",
    occurredOnDate: "2026-08-15",
    occurredOnText: "",
    productName: "13.56MHz 30kW",
    productCategory: "RF Generator",
    modelName: "RFK300FH-AD1",
    manufacturedYear: "2015",
    manufacturedMonth: "2",
    lotNumber: "WU8042",
    serialNumber: "1502021",
    usedYears: "11",
    usedMonths: "6",
    // 🔴 앞 공백이 글머리표다 — 다듬으면 문서의 모양이 달라진다.
    situationRequest: " ・ 수리의뢰",
    situationDetail: " ・ Bias Fwd Drop 발생",

    onSiteRepair: true,
    replacementDelivery: false,
    goodsReceiptChecked: true,
    goodsReceiptOn: "2026-08-21",
    goodsReceiptNumber: "GR-2026-0821",
    completionChecked: true,
    completionOn: "2026-09-01",
    repairNumber: "R-2026-118",
    causes: ["PART_DEFECT", "AGING"],

    findingsIntro: INTRO,
    findings: "외관 확인\n\n내부 점검",
    actions: "바리콘 교환",
    summary: "정상 동작 확인",

    remark: "재발 시 연락 바랍니다.",
    ...overrides,
  };
}

function convert(values: ServiceReportSaveValues): ServiceReportRecord {
  const result = toServiceReportColumns(values);
  assert.equal(result.ok, true, `변환이 실패하면 안 된다: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.data;
}

/** 저장했다 곧바로 불러온 것과 같은 값. DB 를 거치지 않는 순수 왕복이다. */
function roundTrip(values: ServiceReportSaveValues): ServiceReportSaveValues {
  return toServiceReportSaveValues(convert(values));
}

describe("왕복 — 적어 둔 그대로 돌아온다", () => {
  test("모든 칸이 채워진 한 장이 글자 하나 안 틀리고 돌아온다", () => {
    const values = filled();
    assert.deepEqual(roundTrip(values), values);
  });

  test("빈 폼도 그대로 돌아온다 — 빈 글자가 NULL 을 거쳐 빈 글자로 온다", () => {
    const empty = filled({
      customerName: "",
      reportNumberPrefix: "",
      reportNumberMiddle: "",
      reportNumberTail: "",
      customer: "",
      receivedOn: "",
      occurrencePlace: "",
      occurrencePlaceDetail: "",
      occurredOnMode: "DATE",
      occurredOnDate: "",
      occurredOnText: "",
      productName: "",
      productCategory: "",
      modelName: "",
      manufacturedYear: "",
      manufacturedMonth: "",
      lotNumber: "",
      serialNumber: "",
      usedYears: "",
      usedMonths: "",
      situationRequest: "",
      situationDetail: "",
      goodsReceiptOn: "",
      goodsReceiptNumber: "",
      completionOn: "",
      repairNumber: "",
      causes: [],
      findings: "",
      actions: "",
      summary: "",
      remark: "",
    });
    assert.deepEqual(roundTrip(empty), empty);
  });

  test("🔴 「상황」의 앞 공백을 다듬지 않는다 — 양식 드롭다운의 글머리표다", () => {
    const columns = convert(filled()).columns;
    assert.equal(columns.situationRequest, " ・ 수리의뢰");
    assert.equal(columns.situationDetail, " ・ Bias Fwd Drop 발생");
  });
});

describe("🔴 본문의 빈 줄", () => {
  test("가운데 빈 줄이 한 줄을 차지하고, 이어 붙이면 그대로 돌아온다", () => {
    const record = convert(filled({ findings: "가\n\n나" }));

    assert.deepEqual(
      record.lines.filter((line) => line.section === "FINDINGS"),
      [
        { section: "FINDINGS", lineNo: 1, text: "가" },
        // 🔴 이 줄이 걸러지면 문서의 문단 나누기가 통째로 사라진다.
        { section: "FINDINGS", lineNo: 2, text: "" },
        { section: "FINDINGS", lineNo: 3, text: "나" },
      ]
    );
    assert.equal(toServiceReportSaveValues(record).findings, "가\n\n나");
  });

  test("빈 줄만으로 이루어진 문단도 살아남는다", () => {
    assert.equal(roundTrip(filled({ actions: "가\n\n\n나" })).actions, "가\n\n\n나");
  });

  test("차례는 구역 안에서 1부터 다시 매겨진다 — 넷이 번호를 나눠 쓰지 않는다", () => {
    const record = convert(filled({ findings: "가\n나", actions: "다", summary: "라\n마", remark: "바" }));
    const lineNos = (section: string) =>
      record.lines.filter((line) => line.section === section).map((line) => line.lineNo);

    assert.deepEqual(lineNos("FINDINGS"), [1, 2]);
    assert.deepEqual(lineNos("ACTIONS"), [1]);
    assert.deepEqual(lineNos("SUMMARY"), [1, 2]);
    assert.deepEqual(lineNos("REMARK"), [1]);
  });

  test("끝의 빈 줄만 버린다 — 문서로 나갈 때와 같은 규칙이다", () => {
    assert.equal(roundTrip(filled({ findings: "가\n" })).findings, "가");
  });
});

describe("🔴 findingsIntro — 「안 줌」과 「일부러 비움」", () => {
  test("빈 글자는 빈 글자로 저장된다 — NULL 로 바뀌지 않는다", () => {
    assert.equal(convert(filled({ findingsIntro: "" })).columns.findingsIntro, "");
  });

  test("빈 글자로 저장한 것은 빈 글자로 돌아온다", () => {
    assert.equal(roundTrip(filled({ findingsIntro: "" })).findingsIntro, "");
  });

  test("null(안 줌)은 null 로 돌아온다 — 조회가 빈 글자로 뭉개지 않는다", () => {
    assert.equal(roundTrip(filled({ findingsIntro: null })).findingsIntro, null);
  });

  test("화면에 부을 때만 null 이 정형 문구가 된다. 빈 글자는 그대로 빈 글자다", () => {
    // 「안 줌」 = 채우개가 정형 문구를 넣는다 = 화면에서는 미리 채워진 칸이다.
    assert.equal(serviceReportFormValues(filled({ findingsIntro: null }), INTRO).findingsIntro, INTRO);
    // 🔴 사람이 지운 문장은 다시 열어도 지워진 채여야 한다.
    assert.equal(serviceReportFormValues(filled({ findingsIntro: "" }), INTRO).findingsIntro, "");
  });
});

describe("발생 년월일 — 셋을 뭉개지 않는다", () => {
  test("날짜로 적었으면 mode 가 DATE 이고 글자 칸은 비어 있다", () => {
    const columns = convert(filled({ occurredOnMode: "DATE", occurredOnDate: "2026-08-15", occurredOnText: "" })).columns;
    assert.equal(columns.occurredOnMode, "DATE");
    assert.equal(columns.occurredOnDate, "2026-08-15");
    assert.equal(columns.occurredOnText, null);
  });

  test("글자로 적었으면 mode 가 TEXT 다 — 양식의 견본이 `―――` 다", () => {
    const values = filled({ occurredOnMode: "TEXT", occurredOnDate: "", occurredOnText: "―――" });
    const columns = convert(values).columns;
    assert.equal(columns.occurredOnMode, "TEXT");
    assert.equal(columns.occurredOnDate, null);
    assert.equal(columns.occurredOnText, "―――");
    assert.deepEqual(roundTrip(values), values);
  });

  test("🔴 아무것도 안 적었으면 mode 가 NULL 이다 — 「어느 쪽도 아님」이 뜻을 갖는다", () => {
    const columns = convert(filled({ occurredOnMode: "DATE", occurredOnDate: "", occurredOnText: "" })).columns;
    assert.equal(columns.occurredOnMode, null);
  });

  test("mode 가 NULL 이면 폼의 기본값(DATE)으로 열린다 — 두 칸 다 비어 있어 문서는 같다", () => {
    const values = filled({ occurredOnMode: "DATE", occurredOnDate: "", occurredOnText: "" });
    assert.deepEqual(roundTrip(values), values);
  });

  test("한쪽이라도 적혀 있으면 폼이 고른 쪽을 되짚지 않고 그대로 담는다", () => {
    // 글자 칸에 적어 두고 날짜 쪽을 펴 둔 상태도 다시 열었을 때 그대로여야 한다.
    const values = filled({ occurredOnMode: "DATE", occurredOnDate: "", occurredOnText: "―――" });
    assert.equal(convert(values).columns.occurredOnMode, "DATE");
    assert.deepEqual(roundTrip(values), values);
  });
});

describe("경계에서만 바꾼다 — 숫자와 날짜", () => {
  test("빈 숫자 칸은 NULL 이고, 다시 열면 빈 칸이다", () => {
    const columns = convert(filled({ manufacturedYear: "", usedMonths: "" })).columns;
    assert.equal(columns.manufacturedYear, null);
    assert.equal(columns.usedMonths, null);
  });

  test("숫자 칸은 정수로 저장되고 글자로 돌아온다", () => {
    assert.equal(convert(filled({ manufacturedMonth: "2" })).columns.manufacturedMonth, 2);
    assert.equal(roundTrip(filled({ manufacturedMonth: "2" })).manufacturedMonth, "2");
  });

  test("🔴 숫자가 아닌 값은 조용히 버리지 않고 칸 오류로 답한다", () => {
    const result = toServiceReportColumns(filled({ manufacturedYear: "이천십오" }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.fieldErrors.manufacturedYear);
  });

  test("발행일이 비어 있으면 거절한다 — NOT NULL 칸이라 저장 자체가 안 된다", () => {
    const result = toServiceReportColumns(filled({ issuedOn: "" }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.fieldErrors.issuedOn);
  });

  test("달력에 없는 날은 거절한다 — 그대로 두면 문서에 찍힌다", () => {
    const result = toServiceReportColumns(filled({ receivedOn: "2026-02-30" }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.fieldErrors.receivedOn);
  });

  test("빈 날짜 칸은 NULL 이다 — 「모른다」가 정상인 칸들이다", () => {
    const columns = convert(filled({ receivedOn: "", goodsReceiptOn: "", completionOn: "" })).columns;
    assert.equal(columns.receivedOn, null);
    assert.equal(columns.goodsReceiptOn, null);
    assert.equal(columns.completionOn, null);
  });
});

describe("조치와 원인", () => {
  test("🔴 체크와 날짜는 따로다 — 날짜 없이 체크만 된 상태가 남는다", () => {
    const columns = convert(filled({ goodsReceiptChecked: true, goodsReceiptOn: "", goodsReceiptNumber: "" })).columns;
    assert.equal(columns.goodsReceiptChecked, true);
    assert.equal(columns.goodsReceiptOn, null);
  });

  test("고른 원인만 담기고, 같은 원인을 두 번 보내도 한 줄이다", () => {
    const record = convert(filled({ causes: ["PART_DEFECT", "PART_DEFECT", "AGING"] }));
    assert.deepEqual(record.causes, ["PART_DEFECT", "AGING"]);
  });

  test("아무 원인도 안 골랐으면 한 줄도 없다", () => {
    assert.deepEqual(convert(filled({ causes: [] })).causes, []);
  });
});

describe("🔴 종류와 어긋나는 값도 지우지 않는다", () => {
  test("검사 보고서의 「정리」·「조치 완료」가 저장되고 그대로 돌아온다", () => {
    // 종류를 수리에서 검사로 바꿔도 화면은 적어 둔 글을 지우지 않는다 — 다시
    // 수리로 돌리면 그대로 있어야 한다.
    const values = filled({ kind: "INSPECTION", summary: "지우면 안 되는 정리", completionChecked: true });
    assert.deepEqual(roundTrip(values), values);
  });

  test("그래도 문서 요청 본문에는 안 나간다 — 걸러 내는 것은 buildServiceReportRequestBody 다", () => {
    const values = serviceReportFormValues(
      roundTrip(filled({ kind: "INSPECTION", summary: "지우면 안 되는 정리", completionChecked: true })),
      INTRO
    );
    const body = buildServiceReportRequestBody(values);

    assert.equal("summary" in (body.body as Record<string, unknown>), false);
    assert.equal("completion" in (body.disposition as Record<string, unknown>), false);
  });
});
