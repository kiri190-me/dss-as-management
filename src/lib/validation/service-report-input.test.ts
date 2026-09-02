import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SERVICE_REPORT_MAX_BODY_ROWS,
  validateServiceReportInput as assertFillerAccepts,
} from "@/lib/xlsx/service-report-template";
import {
  SERVICE_REPORT_MAX_REMARK_ROWS,
  validateServiceReportFields,
} from "./service-report-input";

/**
 * ============================================================================
 * 보고서 입력 검증
 * ============================================================================
 * 양식 파일이 필요 없다 — 여기는 **JSON 을 채우개가 받는 모양으로 바꾸는 자리**
 * 이고, 통합문서는 만지지 않는다.
 *
 * 마지막 시험이 이 파일의 요점이다: 여기를 통과한 값은 **채우개의 검사도
 * 통과해야 한다.** 두 검사가 어긋나면 사용자는 400 대신 500 을 받는다.
 * ============================================================================
 */

/** 통과하는 가장 작은 요청. 시험마다 필요한 칸만 덮어쓴다. */
function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "INSPECTION",
    customerName: "테스트상사",
    issuedOn: "2026-09-02",
    reportNumber: { prefix: "Z000", middle: "TEST1", tail: "0001" },
    body: { findings: ["외관 확인"], actions: ["청소"] },
    ...overrides,
  };
}

function expectOk(raw: unknown) {
  const result = validateServiceReportFields(raw);
  assert.equal(result.ok, true, `거부됐다: ${JSON.stringify(result.ok ? {} : result.fieldErrors)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.data;
}

function expectErrors(raw: unknown): Record<string, string> {
  const result = validateServiceReportFields(raw);
  assert.equal(result.ok, false, "통과하면 안 되는 값이 통과했다");
  if (result.ok) throw new Error("unreachable");
  return result.fieldErrors;
}

// ── 기본 ─────────────────────────────────────────────────────────────────

test("가장 작은 요청이 통과한다", () => {
  const data = expectOk(baseRequest());
  assert.equal(data.kind, "INSPECTION");
  assert.equal(data.customerName, "테스트상사");
  assert.deepEqual(data.reportNumber, { prefix: "Z000", middle: "TEST1", tail: "0001" });
  assert.deepEqual(data.body.findings, ["외관 확인"]);
});

test("보고서 종류가 아니면 거부한다", () => {
  for (const kind of ["REPORT", "", null, 1, undefined]) {
    assert.deepEqual(Object.keys(expectErrors(baseRequest({ kind }))), ["kind"]);
  }
});

test("객체가 아닌 본문은 통째로 거부한다", () => {
  for (const raw of [null, "보고서", 3, []]) {
    assert.equal(validateServiceReportFields(raw).ok, false);
  }
});

test("필수 칸이 비면 칸마다 한국어로 알려 준다", () => {
  const errors = expectErrors({ kind: "REPAIR", body: { findings: ["a"], actions: [], summary: [] } });
  assert.ok(errors.customerName);
  assert.ok(errors.issuedOn);
  assert.ok(errors["reportNumber.middle"]);
  assert.ok(errors["reportNumber.tail"]);
});

// ── 날짜 ─────────────────────────────────────────────────────────────────

test("🔴 날짜는 로컬 Date 다 — UTC 자정으로 읽으면 하루가 밀린다", () => {
  const data = expectOk(baseRequest({ issuedOn: "2026-09-02", receivedOn: "2026-08-31" }));
  assert.equal(data.issuedOn.getFullYear(), 2026);
  assert.equal(data.issuedOn.getMonth(), 8);
  assert.equal(data.issuedOn.getDate(), 2);
  assert.equal(data.receivedOn?.getDate(), 31);
  assert.equal(data.receivedOn?.getMonth(), 7);
});

test("달력에 없는 날짜는 거부한다", () => {
  assert.ok(expectErrors(baseRequest({ issuedOn: "2026-02-30" })).issuedOn);
  assert.ok(expectErrors(baseRequest({ issuedOn: "2026/09/02" })).issuedOn);
  assert.ok(expectErrors(baseRequest({ receivedOn: "9월 2일" })).receivedOn);
});

test("🔴 발생 년월일은 날짜도 글자도 받는다 — 양식이 `―――` 를 적어 두었다", () => {
  assert.equal(expectOk(baseRequest({ occurredOn: "―――" })).occurredOn, "―――");
  assert.equal(expectOk(baseRequest({ occurredOn: "불명" })).occurredOn, "불명");

  const parsed = expectOk(baseRequest({ occurredOn: "2026-01-05" })).occurredOn;
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getDate(), 5);
  assert.equal(parsed.getMonth(), 0);

  // 날짜 모양인데 달력에 없는 날은 오타다 — 글자로 흘려보내지 않는다.
  assert.ok(expectErrors(baseRequest({ occurredOn: "2026-02-30" })).occurredOn);
});

// ── 🔴 안 줌 / 비움 ──────────────────────────────────────────────────────

test("🔴 확인내용 머리글 — 안 주면 undefined 로 넘어간다(정형 문구가 산다)", () => {
  const data = expectOk(baseRequest());
  assert.equal(data.body.findingsIntro, undefined);
  assert.equal("findingsIntro" in data.body ? data.body.findingsIntro : "없음", undefined);
});

test("🔴 확인내용 머리글 — 빈 문자열은 「비움」이고 undefined 로 뭉개지지 않는다", () => {
  const data = expectOk(baseRequest({ body: { findings: ["a"], actions: [], findingsIntro: "" } }));
  assert.equal(data.body.findingsIntro, "");
  assert.notEqual(data.body.findingsIntro, undefined);
});

test("🔴 확인내용 머리글 — JSON 을 거쳐도 「비움」이 살아남는다", () => {
  // 화면 → JSON → 서버. `""` 가 키째 사라지거나 null 이 되면 지운 문장이 되살아난다.
  const wire = JSON.stringify(baseRequest({ body: { findings: ["a"], actions: [], findingsIntro: "" } }));
  assert.equal(expectOk(JSON.parse(wire)).body.findingsIntro, "");

  // 반대쪽: null 과 키 없음은 둘 다 「안 줌」이다(JSON 에는 undefined 가 없다).
  const nulled = JSON.parse(
    JSON.stringify(baseRequest({ body: { findings: ["a"], actions: [], findingsIntro: null } }))
  );
  assert.equal(expectOk(nulled).body.findingsIntro, undefined);
});

test("확인내용 머리글에 다른 문장을 주면 그것이 넘어간다", () => {
  const intro = "인수품에 대해 이하의 항목을 실시하였습니다.";
  const data = expectOk(baseRequest({ body: { findings: ["a"], actions: [], findingsIntro: intro } }));
  assert.equal(data.body.findingsIntro, intro);
});

// ── 원인 ─────────────────────────────────────────────────────────────────

test("원인은 양식이 아는 값만 받는다", () => {
  const data = expectOk(baseRequest({ causes: ["PART_DEFECT", "AGING"] }));
  assert.deepEqual(data.causes, ["PART_DEFECT", "AGING"]);

  assert.ok(expectErrors(baseRequest({ causes: ["부품불량"] }))["causes.0"]);
  assert.ok(expectErrors(baseRequest({ causes: ["PART_DEFECT", "UNKNOWN"] }))["causes.1"]);
  assert.ok(expectErrors(baseRequest({ causes: "PART_DEFECT" })).causes);
});

test("같은 원인을 두 번 보내도 체크는 하나다", () => {
  assert.deepEqual(expectOk(baseRequest({ causes: ["AGING", "AGING"] })).causes, ["AGING"]);
});

// ── 줄 수 상한 ───────────────────────────────────────────────────────────

test(`🔴 본문이 ${SERVICE_REPORT_MAX_BODY_ROWS}줄을 넘으면 채우개가 던지기 전에 막는다`, () => {
  const half = Math.ceil(SERVICE_REPORT_MAX_BODY_ROWS / 2);
  const errors = expectErrors(
    baseRequest({
      body: {
        findings: Array.from({ length: half }, (_, i) => `확인 ${i}`),
        actions: Array.from({ length: half }, (_, i) => `조치 ${i}`),
      },
    })
  );
  assert.match(errors.body, new RegExp(`${SERVICE_REPORT_MAX_BODY_ROWS}줄까지만`));
});

test("상한 바로 아래는 통과한다 — 확인내용·조치·정리를 합쳐 센다", () => {
  // 정형 문구 1줄 + 「～이　상～」 1줄이 더 든다.
  const lines = SERVICE_REPORT_MAX_BODY_ROWS - 2;
  const data = expectOk(
    baseRequest({ body: { findings: Array.from({ length: lines }, (_, i) => `줄 ${i}`), actions: [] } })
  );
  assert.equal(data.body.findings.length, lines);
});

test("본문이 한 줄도 없으면 거부한다", () => {
  assert.ok(expectErrors(baseRequest({ body: { findings: [], actions: [] } })).body);
  assert.ok(expectErrors(baseRequest({ body: {} })).body);
});

test(`비고는 ${SERVICE_REPORT_MAX_REMARK_ROWS}줄까지다 — 양식의 칸이 그만큼이다`, () => {
  const ok = expectOk(baseRequest({ remark: ["1", "2", "3", "4"] }));
  assert.equal(ok.remark?.length, 4);
  assert.ok(expectErrors(baseRequest({ remark: ["1", "2", "3", "4", "5"] })).remark);
});

test("본문 줄은 빈 줄도 그대로 간다 — 줄 사이를 띄우는 방법이다", () => {
  const data = expectOk(baseRequest({ body: { findings: ["앞", "", "뒤"], actions: [] } }));
  assert.deepEqual(data.body.findings, ["앞", "", "뒤"]);
});

// ── 검사 / 수리 ──────────────────────────────────────────────────────────

test("🔴 검사 보고서에 「정리」를 보내면 거부한다", () => {
  const errors = expectErrors(
    baseRequest({ body: { findings: ["a"], actions: [], summary: ["정리 한 줄"] } })
  );
  assert.match(errors["body.summary"], /정리/);
});

test("🔴 검사 보고서에 「조치 완료」를 보내면 거부한다", () => {
  const errors = expectErrors(baseRequest({ disposition: { completion: { on: "2026-09-02" } } }));
  assert.match(errors["disposition.completion"], /조치 완료/);
  // 빈 객체도 「체크해 달라」는 뜻이라 똑같이 막는다.
  assert.ok(expectErrors(baseRequest({ disposition: { completion: {} } }))["disposition.completion"]);
});

test("수리 보고서는 「정리」를 안 보내도 빈 목록으로 통과한다", () => {
  const data = expectOk(baseRequest({ kind: "REPAIR" }));
  assert.equal(data.kind, "REPAIR");
  assert.deepEqual(data.kind === "REPAIR" ? data.body.summary : null, []);
});

test("수리 보고서의 「정리」와 「조치 완료」는 그대로 넘어간다", () => {
  const data = expectOk(
    baseRequest({
      kind: "REPAIR",
      body: { findings: ["a"], actions: ["b"], summary: ["정리 한 줄"] },
      disposition: { completion: { on: "2026-09-02" } },
    })
  );
  assert.equal(data.kind, "REPAIR");
  if (data.kind !== "REPAIR") throw new Error("unreachable");
  assert.deepEqual(data.body.summary, ["정리 한 줄"]);
  assert.equal(data.disposition?.completion?.on?.getDate(), 2);
});

// ── 조치 ─────────────────────────────────────────────────────────────────

test("🔴 「현품 인수」는 빈 객체여도 체크다 — 있고 없음이 뜻이다", () => {
  const checked = expectOk(baseRequest({ disposition: { goodsReceipt: {} } }));
  assert.notEqual(checked.disposition?.goodsReceipt, undefined);

  const unchecked = expectOk(baseRequest({ disposition: {} }));
  assert.equal(unchecked.disposition?.goodsReceipt, undefined);

  // null 은 「안 줌」이다 — JSON 에는 undefined 가 없다.
  const nulled = expectOk(baseRequest({ disposition: { goodsReceipt: null } }));
  assert.equal(nulled.disposition?.goodsReceipt, undefined);
});

test("조치 체크는 boolean 만 받는다", () => {
  assert.equal(expectOk(baseRequest({ disposition: { onSiteRepair: true } })).disposition?.onSiteRepair, true);
  assert.ok(expectErrors(baseRequest({ disposition: { onSiteRepair: "예" } }))["disposition.onSiteRepair"]);
});

// ── 다듬는 칸 / 다듬지 않는 칸 ───────────────────────────────────────────

test("🔴 「상황」 두 칸은 앞 공백을 다듬지 않는다 — 글머리표다", () => {
  const data = expectOk(
    baseRequest({ situation: { request: " ・ 수리의뢰", detail: "  들여쓴 줄" } })
  );
  assert.equal(data.situation?.request, " ・ 수리의뢰");
  assert.equal(data.situation?.detail, "  들여쓴 줄");
});

test("한 줄로 적는 칸은 앞뒤 공백을 다듬는다", () => {
  const data = expectOk(baseRequest({ customerName: "  테스트상사  ", modelName: " ABC-1 " }));
  assert.equal(data.customerName, "테스트상사");
  assert.equal(data.modelName, "ABC-1");
});

test("숫자 칸은 0 이상의 정수만 받는다", () => {
  const data = expectOk(baseRequest({ manufacturedYear: 2019, usedMonths: "6" }));
  assert.equal(data.manufacturedYear, 2019);
  assert.equal(data.usedMonths, 6);
  assert.ok(expectErrors(baseRequest({ manufacturedMonth: 1.5 })).manufacturedMonth);
  assert.ok(expectErrors(baseRequest({ usedYears: -1 })).usedYears);
});

test("너무 긴 값은 DB 도 양식도 아닌 여기서 막는다", () => {
  assert.ok(expectErrors(baseRequest({ customerName: "가".repeat(201) })).customerName);
  assert.ok(
    expectErrors(baseRequest({ body: { findings: ["가".repeat(1001)], actions: [] } }))["body.findings.0"]
  );
});

// ── 🔴 채우개와 어긋나지 않는다 ──────────────────────────────────────────

test("🔴 여기를 통과한 값은 채우개의 검사도 통과한다", () => {
  const cases: Record<string, unknown>[] = [
    baseRequest(),
    baseRequest({ body: { findings: ["a"], actions: ["b"], findingsIntro: "" } }),
    baseRequest({ kind: "REPAIR" }),
    baseRequest({
      kind: "REPAIR",
      body: { findings: ["a"], actions: ["b"], summary: ["c"] },
      disposition: { onSiteRepair: true, goodsReceipt: {}, completion: { on: "2026-09-02" } },
      causes: ["PART_DEFECT", "OTHER"],
      occurredOn: "―――",
      remark: ["비고 한 줄"],
      situation: { request: " ・ 수리의뢰", detail: "상세" },
      manufacturedYear: 2019,
      manufacturedMonth: 4,
      usedYears: 6,
      usedMonths: 5,
      lotNumber: "LN-1",
      serialNumber: "1234567",
      repairNumber: "R-1",
      receivedOn: "2026-08-20",
    }),
  ];

  for (const raw of cases) {
    // 던지지 않으면 통과다. 여기서 던지면 사용자는 400 대신 500 을 받는다.
    assertFillerAccepts(expectOk(raw));
  }
});
