import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SERVICE_REPORT_MAX_REMARK_ROWS,
  validateServiceReportFields,
} from "@/lib/validation/service-report-input";
import {
  SERVICE_REPORT_CAUSE_LABELS,
  SERVICE_REPORT_CAUSES,
  SERVICE_REPORT_FINDINGS_INTRO,
  SERVICE_REPORT_MAX_BODY_ROWS,
} from "@/lib/xlsx/service-report-template";

import {
  buildServiceReportRequestBody,
  countServiceReportBodyRows,
  countServiceReportRemarkRows,
  createServiceReportFormValues,
  isServiceReportBodyEmpty,
  serviceReportCauseOptions,
  serviceReportFieldError,
  serviceReportLines,
  serviceReportManufacturedFromSerialNumber,
  serviceReportManufacturedPatch,
  serviceReportProductNameFromModel,
  serviceReportRowLimitErrors,
  serviceReportSerialNumberWarning,
  type ServiceReportFormValues,
} from "./service-report-form";

/**
 * ============================================================================
 * 화면과 서버가 어긋나지 않는다는 자동 증거
 * ============================================================================
 * 이 파일의 핵심은 `validateServiceReportFields` 를 **실제로 통과시키는** 시험이다.
 * 화면이 만든 본문을 서버의 검증 함수에 그대로 넣어 보는 것 말고는, 두 벌이
 * 어긋난 것을 알아낼 방법이 없다 — 어긋나면 사람이 폼을 다 채우고 [Excel
 * 내려받기] 를 누른 뒤에야 400 을 본다.
 *
 * 상한 값(300·4)과 정형 문구, 원인 코드 목록은 **원래 있던 상수에서 가져온다.**
 * 숫자를 여기 적으면 양식이 늘어난 날 이 시험만 통과하고 화면이 뒤처진다.
 * ============================================================================
 */

const SEED = {
  today: "2026-09-02",
  findingsIntro: SERVICE_REPORT_FINDINGS_INTRO,
} as const;

const LIMITS = {
  maxBodyRows: SERVICE_REPORT_MAX_BODY_ROWS,
  maxRemarkRows: SERVICE_REPORT_MAX_REMARK_ROWS,
} as const;

/** 발행할 수 있는 최소한을 채운 폼. 각 시험은 여기서 필요한 칸만 고친다. */
function filledForm(overrides: Partial<ServiceReportFormValues> = {}): ServiceReportFormValues {
  return {
    ...createServiceReportFormValues(SEED),
    customerName: "ICD Co.,Ltd",
    reportNumberPrefix: "Z494",
    reportNumberMiddle: "P33A3",
    reportNumberTail: "4013",
    findings: "출력 이상 확인",
    actions: "전원부 교체",
    ...overrides,
  };
}

// ── 접수 건 자료가 폼으로 옮겨진다 ───────────────────────────────────────

test("접수 건 자료가 폼 초기값으로 옮겨진다", () => {
  const values = createServiceReportFormValues({
    ...SEED,
    repairCase: {
      customerName: "㈜한국반도체",
      modelName: "RFG-3000",
      lotNumber: "L2601",
      serialNumber: "2601001",
      receivedAt: "2026-08-20",
      productCategory: "RF 제네레이터",
      reportedSymptom: "출력이 나오지 않음",
    },
  });

  assert.equal(values.customerName, "㈜한국반도체");
  assert.equal(values.modelName, "RFG-3000");
  assert.equal(values.lotNumber, "L2601");
  assert.equal(values.serialNumber, "2601001");
  assert.equal(values.receivedOn, "2026-08-20");
  assert.equal(values.productCategory, "RF 제네레이터");
  assert.equal(values.situationDetail, "출력이 나오지 않음");
  // 발행일은 접수 건이 아니라 오늘이다.
  assert.equal(values.issuedOn, "2026-09-02");
});

test("접수 건이 없어도 빈 폼이 만들어진다 — 발행일과 정형 문구만 채워진다", () => {
  const values = createServiceReportFormValues(SEED);

  assert.equal(values.customerName, "");
  assert.equal(values.modelName, "");
  assert.equal(values.receivedOn, "");
  assert.equal(values.issuedOn, "2026-09-02");
  assert.equal(values.findingsIntro, SERVICE_REPORT_FINDINGS_INTRO);
  assert.equal(values.kind, "REPAIR");
});

test("목록 화면의 빈 값 표시 `-` 는 문서로 옮기지 않는다", () => {
  const values = createServiceReportFormValues({
    ...SEED,
    repairCase: {
      customerName: "ICD",
      modelName: "-",
      lotNumber: "-",
      serialNumber: "-",
      receivedAt: null,
      productCategory: "RF 제네레이터",
      reportedSymptom: null,
    },
  });

  assert.equal(values.modelName, "");
  assert.equal(values.lotNumber, "");
  assert.equal(values.serialNumber, "");
  assert.equal(values.situationDetail, "");
});

test("접수일이 시각까지 붙어 와도 날짜 칸이 받는 모양으로 자른다", () => {
  const values = createServiceReportFormValues({
    ...SEED,
    repairCase: {
      customerName: "ICD",
      modelName: null,
      lotNumber: null,
      serialNumber: null,
      receivedAt: "2026-08-20T00:00:00.000Z",
      productCategory: null,
      reportedSymptom: null,
    },
  });

  assert.equal(values.receivedOn, "2026-08-20");
});

// ── 🔴 「안 줌」과 「비움」 ──────────────────────────────────────────────

test("🔴 정형 문구를 지우면 요청 본문에 빈 문자열로 나간다 — 안 준 것이 아니다", () => {
  const body = buildServiceReportRequestBody(filledForm({ findingsIntro: "" }));
  const sent = body.body as Record<string, unknown>;

  // 키가 없거나 undefined 이면 서버가 기본 문구를 되살린다 — 지운 문장이 문서에 찍힌다.
  assert.ok("findingsIntro" in sent, "findingsIntro 키가 있어야 한다");
  assert.equal(sent.findingsIntro, "");
  assert.notEqual(sent.findingsIntro, undefined);

  // JSON 을 거쳐도 `""` 는 살아남아야 한다(`undefined` 였다면 키가 사라진다).
  const roundTripped = JSON.parse(JSON.stringify(body)) as { body: Record<string, unknown> };
  assert.ok("findingsIntro" in roundTripped.body);
  assert.equal(roundTripped.body.findingsIntro, "");

  const result = validateServiceReportFields(roundTripped);
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.data.body.findingsIntro, "");
});

test("정형 문구를 그대로 두면 그 문장이 그대로 나간다", () => {
  const body = buildServiceReportRequestBody(filledForm());
  const sent = body.body as Record<string, unknown>;
  assert.equal(sent.findingsIntro, SERVICE_REPORT_FINDINGS_INTRO);

  const result = validateServiceReportFields(JSON.parse(JSON.stringify(body)));
  assert.ok(result.ok);
  assert.equal(result.data.body.findingsIntro, SERVICE_REPORT_FINDINGS_INTRO);
});

// ── 줄 나누기 ────────────────────────────────────────────────────────────

test("가운데 빈 줄은 살리고 끝의 빈 줄만 버린다", () => {
  assert.deepEqual(serviceReportLines("가\n\n나"), ["가", "", "나"]);
  assert.deepEqual(serviceReportLines("가\n나\n\n\n"), ["가", "나"]);
  assert.deepEqual(serviceReportLines(""), []);
  assert.deepEqual(serviceReportLines("   \n  "), []);
  assert.deepEqual(serviceReportLines("가\r\n나"), ["가", "나"]);
});

test("줄 안의 들여쓰기는 다듬지 않는다 — 사람이 뜻을 담아 넣은 것이다", () => {
  assert.deepEqual(serviceReportLines("가\n  나"), ["가", "  나"]);
});

// ── 줄 수 세기 (상수에서 가져온 값으로) ──────────────────────────────────

test("본문 줄 수를 검증 모듈과 같은 셈으로 센다 — 정형 문구 한 줄과 맺음 표시 한 줄이 든다", () => {
  const values = filledForm({ findings: "가\n나", actions: "다", summary: "라" });
  // 확인내용 2 + 정형 문구 1 + 조치 1 + 정리 1 + 맺음 1
  assert.equal(countServiceReportBodyRows(values), 6);

  // 정형 문구를 지우면 그 한 줄이 빠진다.
  assert.equal(countServiceReportBodyRows({ ...values, findingsIntro: "" }), 5);

  // 확인내용이 없으면 정형 문구도 안 들어간다.
  assert.equal(countServiceReportBodyRows({ ...values, findings: "" }), 3);

  // 검사 보고서에는 「정리」 구역이 없다.
  assert.equal(countServiceReportBodyRows({ ...values, kind: "INSPECTION" }), 5);
});

test(`본문 ${SERVICE_REPORT_MAX_BODY_ROWS}줄까지는 통과하고 한 줄만 넘어도 서버가 막는다`, () => {
  // 확인내용 N + 정형 문구 1 + 맺음 1 = 상한
  const atLimit = filledForm({
    findings: Array.from({ length: SERVICE_REPORT_MAX_BODY_ROWS - 2 }, (_, i) => `확인 ${i + 1}`).join("\n"),
    actions: "",
    summary: "",
  });
  assert.equal(countServiceReportBodyRows(atLimit), SERVICE_REPORT_MAX_BODY_ROWS);
  assert.deepEqual(serviceReportRowLimitErrors(atLimit, LIMITS), {});
  assert.equal(validateServiceReportFields(buildServiceReportRequestBody(atLimit)).ok, true);

  const overLimit = { ...atLimit, findings: `${atLimit.findings}\n한 줄 더` };
  assert.equal(countServiceReportBodyRows(overLimit), SERVICE_REPORT_MAX_BODY_ROWS + 1);
  assert.ok(serviceReportRowLimitErrors(overLimit, LIMITS).body);

  const rejected = validateServiceReportFields(buildServiceReportRequestBody(overLimit));
  assert.equal(rejected.ok, false);
  assert.ok(!rejected.ok && rejected.fieldErrors.body);
});

test(`비고 ${SERVICE_REPORT_MAX_REMARK_ROWS}줄까지는 통과하고 한 줄만 넘어도 서버가 막는다`, () => {
  const atLimit = filledForm({
    remark: Array.from({ length: SERVICE_REPORT_MAX_REMARK_ROWS }, (_, i) => `비고 ${i + 1}`).join("\n"),
  });
  assert.equal(countServiceReportRemarkRows(atLimit), SERVICE_REPORT_MAX_REMARK_ROWS);
  assert.deepEqual(serviceReportRowLimitErrors(atLimit, LIMITS), {});
  assert.equal(validateServiceReportFields(buildServiceReportRequestBody(atLimit)).ok, true);

  const overLimit = { ...atLimit, remark: `${atLimit.remark}\n한 줄 더` };
  assert.equal(countServiceReportRemarkRows(overLimit), SERVICE_REPORT_MAX_REMARK_ROWS + 1);
  assert.ok(serviceReportRowLimitErrors(overLimit, LIMITS).remark);

  const rejected = validateServiceReportFields(buildServiceReportRequestBody(overLimit));
  assert.equal(rejected.ok, false);
  assert.ok(!rejected.ok && rejected.fieldErrors.remark);
});

test("본문이 한 줄도 없으면 화면이 먼저 안다 — 서버도 거부한다", () => {
  const empty = filledForm({ findings: "", actions: "", summary: "" });
  assert.equal(isServiceReportBodyEmpty(empty), true);

  const rejected = validateServiceReportFields(buildServiceReportRequestBody(empty));
  assert.equal(rejected.ok, false);

  assert.equal(isServiceReportBodyEmpty(filledForm()), false);
});

// ── 🔴 화면이 만든 본문이 서버 검증을 실제로 통과한다 ────────────────────

test("🔴 사람이 다 채운 수리 보고서 폼이 validateServiceReportFields 를 통과한다", () => {
  const values = filledForm({
    kind: "REPAIR",
    customer: "구매팀",
    receivedOn: "2026-08-20",
    occurrencePlace: "천안",
    occurrencePlaceDetail: "공장",
    occurredOnMode: "DATE",
    occurredOnDate: "2026-08-18",
    // 🔴 앞 공백이 글머리표다 — 양식의 드롭다운 값을 그대로 고른 모양.
    productName: "13.56MHz 30kW",
    productCategory: "RF제네레이터",
    modelName: "RFG-3000",
    manufacturedYear: "2019",
    manufacturedMonth: "7",
    lotNumber: "L2601",
    serialNumber: "2601001",
    usedYears: "6",
    usedMonths: "2",
    situationRequest: " ・ 수리의뢰",
    situationDetail: "출력이 나오지 않음\n간헐적으로 재기동",
    onSiteRepair: true,
    replacementDelivery: false,
    goodsReceiptChecked: true,
    goodsReceiptOn: "2026-08-20",
    goodsReceiptNumber: "R-1024",
    completionChecked: true,
    completionOn: "2026-09-02",
    repairNumber: "R2601",
    causes: ["PART_DEFECT", "AGING"],
    findings: "출력 이상 확인\n\n전원부 전압 강하",
    actions: "전원부 교체\n동작 확인",
    summary: "정상 동작 확인",
    remark: "재발 시 연락 바랍니다.",
  });

  // 화면이 실제로 보내는 것은 JSON 이다 — 그 왕복까지 거쳐서 확인한다.
  const payload = JSON.parse(JSON.stringify(buildServiceReportRequestBody(values)));
  const result = validateServiceReportFields(payload);

  assert.equal(result.ok, true, JSON.stringify(!result.ok ? result.fieldErrors : {}));
  assert.ok(result.ok);
  assert.equal(result.data.kind, "REPAIR");
  assert.equal(result.data.customerName, "ICD Co.,Ltd");
  assert.deepEqual(result.data.reportNumber, { prefix: "Z494", middle: "P33A3", tail: "4013" });
  // 「상황」은 앞 공백을 다듬지 않는다.
  assert.equal(result.data.situation?.request, " ・ 수리의뢰");
  assert.deepEqual(result.data.causes, ["PART_DEFECT", "AGING"]);
  assert.equal(result.data.disposition?.goodsReceipt !== undefined, true);
  assert.deepEqual(result.data.body.findings, ["출력 이상 확인", "", "전원부 전압 강하"]);
  assert.ok(result.data.kind === "REPAIR");
  assert.deepEqual(result.data.body.summary, ["정상 동작 확인"]);
  assert.deepEqual(result.data.remark, ["재발 시 연락 바랍니다."]);
});

test("🔴 검사 보고서 폼도 통과한다 — 「정리」와 「조치 완료」 키가 아예 없다", () => {
  const values = filledForm({
    kind: "INSPECTION",
    // 수리로 적어 두었던 값이 남아 있어도 검사로는 나가지 않는다.
    summary: "정리로 적어 둔 글",
    completionChecked: true,
    completionOn: "2026-09-02",
  });

  const body = buildServiceReportRequestBody(values);
  const sentBody = body.body as Record<string, unknown>;
  const sentDisposition = body.disposition as Record<string, unknown>;

  assert.equal("summary" in sentBody, false, "검사 보고서에 정리 키를 보내면 서버가 거부한다");
  assert.equal("completion" in sentDisposition, false);

  const result = validateServiceReportFields(JSON.parse(JSON.stringify(body)));
  assert.equal(result.ok, true, JSON.stringify(!result.ok ? result.fieldErrors : {}));

  // 화면 상태에는 남아 있다 — 다시 수리로 돌리면 그대로 있어야 한다.
  assert.equal(values.summary, "정리로 적어 둔 글");
});

test("현품 인수는 체크만 되어 있으면 날짜가 비어도 체크로 나간다", () => {
  const values = filledForm({ goodsReceiptChecked: true, goodsReceiptOn: "", goodsReceiptNumber: "" });
  const result = validateServiceReportFields(
    JSON.parse(JSON.stringify(buildServiceReportRequestBody(values)))
  );

  assert.ok(result.ok);
  assert.notEqual(result.data.disposition?.goodsReceipt, undefined);
  assert.equal(result.data.disposition?.goodsReceipt?.on, undefined);
});

test("현품 인수를 체크하지 않으면 키 자체가 없다 — 빈 객체를 보내면 체크가 찍힌다", () => {
  const body = buildServiceReportRequestBody(filledForm({ goodsReceiptChecked: false }));
  assert.equal("goodsReceipt" in (body.disposition as Record<string, unknown>), false);
});

test("발생 년월일은 날짜와 글자를 둘 다 받는다 — 양식이 `―――` 를 적어 두었다", () => {
  const asText = buildServiceReportRequestBody(
    filledForm({ occurredOnMode: "TEXT", occurredOnText: "―――", occurredOnDate: "2026-08-18" })
  );
  assert.equal(asText.occurredOn, "―――");

  const result = validateServiceReportFields(JSON.parse(JSON.stringify(asText)));
  assert.ok(result.ok);
  assert.equal(result.data.occurredOn, "―――");

  const asDate = buildServiceReportRequestBody(
    filledForm({ occurredOnMode: "DATE", occurredOnDate: "2026-08-18", occurredOnText: "―――" })
  );
  assert.equal(asDate.occurredOn, "2026-08-18");
});

test("공백만 남은 숫자 칸은 0 으로 찍히지 않는다", () => {
  const body = buildServiceReportRequestBody(filledForm({ manufacturedYear: "   " }));
  assert.equal(body.manufacturedYear, "");

  const result = validateServiceReportFields(JSON.parse(JSON.stringify(body)));
  assert.ok(result.ok);
  assert.equal(result.data.manufacturedYear, undefined);
});

// ── 원인 라벨 ────────────────────────────────────────────────────────────

test("🔴 원인 라벨이 채우개가 아는 코드 열 가지와 같은 순서로 딱 맞는다", () => {
  assert.deepEqual(Object.keys(SERVICE_REPORT_CAUSE_LABELS), [...SERVICE_REPORT_CAUSES]);
  assert.deepEqual(
    serviceReportCauseOptions(SERVICE_REPORT_CAUSE_LABELS).map((option) => option.value),
    [...SERVICE_REPORT_CAUSES]
  );
  // 라벨은 양식의 글자와 같아야 한다(채우개의 CAUSE_CELLS).
  assert.equal(SERVICE_REPORT_CAUSE_LABELS.PART_DEFECT, "부품불량");
  assert.equal(SERVICE_REPORT_CAUSE_LABELS.NOT_REPRODUCED, "재현 안됨");
});

/**
 * 🔴 라벨의 출처가 **하나**라는 증거. 화면이 사본을 들고 있으면 양식의 라벨이
 * 바뀐 날 화면과 문서가 서로 다른 이름을 부른다 — 아무 오류도 안 나서 아무도
 * 모른다. 여기서는 표를 다른 것으로 주면 체크박스 이름이 그대로 따라간다는 것을
 * 본다(즉 이 모듈 안에 베껴 둔 글자가 없다).
 */
test("🔴 원인 라벨은 넘겨받은 표에서만 나온다 — 화면에 사본이 없다", () => {
  const renamed = { ...SERVICE_REPORT_CAUSE_LABELS, PART_DEFECT: "부품 결함(양식이 바뀜)" };
  const options = serviceReportCauseOptions(renamed);

  assert.deepEqual(
    options.map((option) => option.value),
    [...SERVICE_REPORT_CAUSES]
  );
  assert.equal(
    options.find((option) => option.value === "PART_DEFECT")?.label,
    "부품 결함(양식이 바뀜)"
  );
});

// ── 형식(모델명) → 품명 첫째 줄 ─────────────────────────────────────────

/** 실제 양식의 「품명」 드롭다운 열두 가지. 시험 안에서만 쓰는 본이다. */
const PRODUCT_NAMES = [
  "13.56MHz 30kW",
  "13.56MHz 20kW",
  "13.56MHz 15kW",
  "4MHz 30kW",
  "4MHz 20kW",
  "4MHz 15kW",
  "3.39MHz 30kW",
  "3.39MHz 20kW",
  "3.39MHz 15kW",
  "3.39MHz T/C",
  "4MHz T/C",
  "13.56MHz T/C",
] as const;

test("형식 앞 3글자가 주파수를, 뒤따르는 숫자가 출력을 정한다", () => {
  const pick = (model: string) => serviceReportProductNameFromModel(model, PRODUCT_NAMES);

  // RFG 계열 — Source 13.56MHz · Bias 4MHz / 3.39MHz.
  assert.equal(pick("RFK300FH-AD1"), "13.56MHz 30kW");
  assert.equal(pick("CFK150FH-IC1"), "4MHz 15kW");
  assert.equal(pick("KFK150FH-AD1"), "3.39MHz 15kW");
  // MB 계열 — 앞글자만 다르고 규칙은 같다.
  assert.equal(pick("MBK300M-IC1"), "13.56MHz 30kW");
  assert.equal(pick("CMK200M-IC2A"), "4MHz 20kW");
  assert.equal(pick("KMK200M-AD1"), "3.39MHz 20kW");
});

test("하이픈이 빠지거나 글자가 섞인 형식도 맞는다 — 앞 3글자와 그 뒤 숫자만 본다", () => {
  const pick = (model: string) => serviceReportProductNameFromModel(model, PRODUCT_NAMES);

  assert.equal(pick("RFK300FHJS1"), "13.56MHz 30kW");
  assert.equal(pick("CFK150FHIC1"), "4MHz 15kW");
  assert.equal(pick("CFK150JFH-IC1"), "4MHz 15kW");
  // 앞뒤 공백과 소문자도 받는다.
  assert.equal(pick("  rfk300fh-ad1 "), "13.56MHz 30kW");
});

/**
 * 🔴 이 시험이 이 규칙의 안전장치다. **목록에 없으면 비워 둔다** — 잘못 채운
 * 문서가 고객사로 나가는 것보다 사람이 드롭다운에서 고르는 편이 낫다.
 */
test("🔴 목록에 없는 값은 골라 주지 않는다 — 60kW · T/C 계열 · TG", () => {
  const pick = (model: string) => serviceReportProductNameFromModel(model, PRODUCT_NAMES);

  // 60kW 는 양식 드롭다운에 없다. 그런데 형식은 실제로 있다.
  assert.equal(pick("MBK600M-IC1"), "");
  assert.equal(pick("CMK600M-IC2"), "");
  assert.equal(pick("KMK600M-AD1"), "");
  // T/C 계열과 TG 는 형식만으로 주파수를 알 수 없다.
  assert.equal(pick("T2CCONT-IC1"), "");
  assert.equal(pick("T2RCONT-AD1"), "");
  assert.equal(pick("TG-200"), "");
  assert.equal(pick("TG-100"), "");
  // 규칙 밖의 앞글자·없는 출력·빈 값.
  assert.equal(pick("XYZ300FH-AD1"), "");
  assert.equal(pick("RFK250FH-AD1"), "");
  assert.equal(pick("RFK"), "");
  assert.equal(pick(""), "");
});

/**
 * 🔴 목록 값을 코드에 베끼지 않았다는 증거 — **목록을 인자로 받아** 그 안에서
 * 고른다. 양식의 표기가 바뀌면 결과도 따라 바뀌어야 한다.
 */
test("🔴 고르는 값은 넘겨받은 목록에서 나온다 — 목록을 바꾸면 결과도 바뀐다", () => {
  // 30kW 를 뺀 목록이면 그 형식은 아무것도 못 고른다.
  const without = PRODUCT_NAMES.filter((name) => name !== "13.56MHz 30kW");
  assert.equal(serviceReportProductNameFromModel("RFK300FH-AD1", without), "");

  // 양식이 표기를 바꾸면 **그 글자 그대로** 돌려준다(우리가 만든 글자가 아니다).
  assert.equal(
    serviceReportProductNameFromModel("RFK300FH-AD1", ["13.56 MHz  30 kW"]),
    "13.56 MHz  30 kW"
  );
  // 양식에 60kW 가 생기면 저절로 따라간다.
  assert.equal(
    serviceReportProductNameFromModel("MBK600M-IC1", [...PRODUCT_NAMES, "13.56MHz 60kW"]),
    "13.56MHz 60kW"
  );
  // 목록을 못 읽었으면(빈 목록) 아무것도 안 고른다.
  assert.equal(serviceReportProductNameFromModel("RFK300FH-AD1", []), "");
});

test("접수 건의 형식에서 품명이 미리 골라진다", () => {
  const values = createServiceReportFormValues({
    ...SEED,
    productNames: PRODUCT_NAMES,
    repairCase: {
      customerName: "ICD",
      modelName: "RFK300FH-AD1",
      lotNumber: null,
      serialNumber: null,
      receivedAt: null,
      productCategory: null,
      reportedSymptom: null,
    },
  });

  assert.equal(values.productName, "13.56MHz 30kW");
  // 형식 자체는 그대로 옮겨진다.
  assert.equal(values.modelName, "RFK300FH-AD1");
});

test("규칙 밖의 형식이면 품명은 빈 채로 열린다 — 사람이 고른다", () => {
  const values = createServiceReportFormValues({
    ...SEED,
    productNames: PRODUCT_NAMES,
    repairCase: {
      customerName: "ICD",
      modelName: "MBK600M-IC1",
      lotNumber: null,
      serialNumber: null,
      receivedAt: null,
      productCategory: null,
      reportedSymptom: null,
    },
  });

  assert.equal(values.productName, "");
});

// ── S/N → 제조년월 ──────────────────────────────────────────────────────

test("S/N 7자리는 `YYMMNNN` 이다 — 앞 넉 자가 제조년월", () => {
  assert.deepEqual(serviceReportManufacturedFromSerialNumber("1502021"), {
    year: "2015",
    month: "2",
  });
  assert.deepEqual(serviceReportManufacturedFromSerialNumber("2612345"), {
    year: "2026",
    month: "12",
  });
  assert.deepEqual(serviceReportManufacturedFromSerialNumber("0101001"), {
    year: "2001",
    month: "1",
  });
  // 앞뒤 공백은 다듬고 본다.
  assert.deepEqual(serviceReportManufacturedFromSerialNumber(" 1502021 "), {
    year: "2015",
    month: "2",
  });
});

/**
 * 🔴 7자리가 아니거나 월이 말이 안 되면 **아무것도 하지 않는다.** 억지로 읽으면
 * 없는 제조년월이 고객사로 나간다. 양식이 S/N 을 7자리로 보는 것(`BC24`)과 같은
 * 뿌리다.
 */
test("🔴 7자리 숫자가 아니거나 월이 01~12 가 아니면 읽지 않는다", () => {
  for (const serialNumber of [
    "150202", // 6자리
    "15020211", // 8자리
    "1599021", // 월 99
    "1500021", // 월 00
    "1513021", // 월 13
    "15A2021", // 숫자가 아니다
    "SN12345",
    "",
    "   ",
  ]) {
    assert.equal(
      serviceReportManufacturedFromSerialNumber(serialNumber),
      null,
      `${JSON.stringify(serialNumber)} 에서 제조년월을 읽었다`
    );
  }
});

test("접수 건의 S/N 에서 제조년월이 미리 채워진다", () => {
  const values = createServiceReportFormValues({
    ...SEED,
    repairCase: {
      customerName: "ICD",
      modelName: null,
      lotNumber: null,
      serialNumber: "1502021",
      receivedAt: null,
      productCategory: null,
      reportedSymptom: null,
    },
  });

  assert.equal(values.manufacturedYear, "2015");
  assert.equal(values.manufacturedMonth, "2");

  // 규칙이 안 맞는 S/N 이면 빈 채로 열린다.
  const other = createServiceReportFormValues({
    ...SEED,
    repairCase: {
      customerName: "ICD",
      modelName: null,
      lotNumber: null,
      serialNumber: "SN12345",
      receivedAt: null,
      productCategory: null,
      reportedSymptom: null,
    },
  });
  assert.equal(other.manufacturedYear, "");
  assert.equal(other.manufacturedMonth, "");
});

/** 🔴 사람이 S/N 칸을 고쳤을 때도 따라 채운다 — 화면이 부르는 그 함수다. */
test("🔴 S/N 을 고치면 제조년월이 따라 채워지되 적어 둔 값은 덮지 않는다", () => {
  const empty = { manufacturedYear: "", manufacturedMonth: "" };
  assert.deepEqual(serviceReportManufacturedPatch("1502021", empty), {
    manufacturedYear: "2015",
    manufacturedMonth: "2",
  });

  // 🔴 이미 적어 둔 값은 그대로 둔다.
  assert.deepEqual(
    serviceReportManufacturedPatch("1502021", { manufacturedYear: "2013", manufacturedMonth: "7" }),
    {}
  );
  // 한쪽만 비어 있으면 그쪽만 채운다.
  assert.deepEqual(
    serviceReportManufacturedPatch("1502021", { manufacturedYear: "2013", manufacturedMonth: "" }),
    { manufacturedMonth: "2" }
  );
  // 공백만 남은 칸은 빈 칸이다.
  assert.deepEqual(
    serviceReportManufacturedPatch("1502021", { manufacturedYear: "  ", manufacturedMonth: "  " }),
    { manufacturedYear: "2015", manufacturedMonth: "2" }
  );

  // 규칙이 안 맞는 S/N 이면 아무것도 하지 않는다.
  assert.deepEqual(serviceReportManufacturedPatch("150202", empty), {});
  assert.deepEqual(serviceReportManufacturedPatch("1599021", empty), {});

  // 채운 값이 서버 검증을 통과한다 — 숫자 칸이라 모양이 어긋나면 400 이다.
  const values = filledForm({
    serialNumber: "1502021",
    ...serviceReportManufacturedPatch("1502021", empty),
  });
  const result = validateServiceReportFields(
    JSON.parse(JSON.stringify(buildServiceReportRequestBody(values)))
  );
  assert.ok(result.ok);
  assert.equal(result.data.manufacturedYear, 2015);
  assert.equal(result.data.manufacturedMonth, 2);
});

// ── S/N 경고 ─────────────────────────────────────────────────────────────

test("S/N 이 7자리가 아니면 알려 주되 막지 않는다", () => {
  assert.equal(serviceReportSerialNumberWarning(filledForm({ serialNumber: "2601001" })), null);
  assert.equal(serviceReportSerialNumberWarning(filledForm({ serialNumber: "" })), null);
  assert.equal(serviceReportSerialNumberWarning(filledForm({ serialNumber: "   " })), null);

  const warning = serviceReportSerialNumberWarning(filledForm({ serialNumber: "26010" }));
  assert.ok(warning);
  assert.ok(warning.includes("5자리"));

  // 경고가 있어도 서버는 받아 준다.
  const result = validateServiceReportFields(
    JSON.parse(JSON.stringify(buildServiceReportRequestBody(filledForm({ serialNumber: "26010" }))))
  );
  assert.equal(result.ok, true);
});

// ── 서버가 돌려준 칸별 오류 ──────────────────────────────────────────────

test("줄 번호가 붙은 오류도 그 칸 옆에 보인다", () => {
  const fieldErrors = {
    "body.findings": "확인내용을 확인할 수 없습니다.",
    "body.findings.3": "확인내용 4번째 줄이 1000자를 넘습니다.",
    customerName: "고객사명을 입력해 주세요.",
  };

  const findings = serviceReportFieldError(fieldErrors, "body.findings");
  assert.ok(findings);
  assert.ok(findings.includes("4번째 줄"));
  assert.equal(serviceReportFieldError(fieldErrors, "customerName"), "고객사명을 입력해 주세요.");
  assert.equal(serviceReportFieldError(fieldErrors, "modelName"), null);
  assert.equal(serviceReportFieldError(null, "customerName"), null);
  // 접두사가 같은 다른 칸을 끌어오지 않는다.
  assert.equal(serviceReportFieldError({ "body.findingsIntro": "x" }, "body.findings"), null);
});
