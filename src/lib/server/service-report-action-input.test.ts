import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createServiceReportFormValues,
  type ServiceReportFormValues,
} from "@/lib/domain/service-report-form";
import {
  serviceReportFormValues,
  type ServiceReportSaveValues,
} from "@/lib/validation/service-report-save-input";
import { SERVICE_REPORT_CAUSES } from "@/lib/xlsx/service-report-template";

import { readServiceReportActionValues } from "./service-report-action-input";

/**
 * ============================================================================
 * 이 파일이 지키려는 것
 * ============================================================================
 * 1. **서버가 값을 지어내지 않는다.** 칸이 빠지거나 모양이 틀리면 거절이지,
 *    자동 채움 값으로 떨어뜨리는 것이 아니다 — 저장은 고객사로 나가는 문서를
 *    남기는 일이라, 사람이 보낸 적 없는 문장이 저장되면 다음 사람이 그것을
 *    그대로 뽑아 간다.
 * 2. **모양이 이상한 요청에 서버가 죽지 않는다.** 브라우저가 아닌 것이 부를 수
 *    있는 자리다.
 * 3. 🔴 **값이 새지 않는다.** 앞 공백(글머리표)과 본문의 빈 줄(문단 나누기)은
 *    이 관문을 그대로 통과해야 한다.
 * 4. 🔴 **저장해 둔 것을 다시 폼에 부어도 같은 값이다** — 특히 `findingsIntro` 의
 *    「안 줌(null)」과 「일부러 비움('')」이 뭉개지지 않는다.
 *
 * 인정할 원인 코드는 `SERVICE_REPORT_CAUSES` 에서 가져온다 — 목록을 여기 베끼면
 * 양식에 원인이 하나 늘어난 날 이 시험만 통과한다.
 * ============================================================================
 */

const CAUSE_CODES: readonly string[] = SERVICE_REPORT_CAUSES;

const INTRO = "아래와 같이 확인하였습니다.";

/** 화면이 보내는 온전한 폼 값 한 벌. */
function formValues(patch: Partial<ServiceReportFormValues> = {}): ServiceReportFormValues {
  return {
    // 미리 채우는 조치·정리 문구는 이 시험의 관심사가 아니다(form 시험이 본다).
    ...createServiceReportFormValues({
      today: "2026-09-02",
      findingsIntro: INTRO,
      actionsIntro: { INSPECTION: "", REPAIR: "" },
      summaryIntro: "",
    }),
    ...patch,
  };
}

function read(raw: unknown) {
  return readServiceReportActionValues(raw, CAUSE_CODES);
}

// ─────────────────────────────────────────────────────── 통과하는 것

test("화면이 보낸 온전한 폼 값은 한 칸도 달라지지 않고 통과한다", () => {
  const values = formValues({
    kind: "INSPECTION",
    findings: "1. 전원부 확인",
    actions: "부품 교체",
    causes: ["AGING", "PART_DEFECT"],
    onSiteRepair: true,
    occurredOnMode: "TEXT",
    occurredOnText: "―――",
  });

  const result = read({ ...values });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.values, values);
});

test("🔴 앞 공백과 본문의 빈 줄이 그대로 지나간다", () => {
  // 「상황」의 앞 공백은 글머리표이고, 빈 줄은 문단 나누기다. 어느 쪽도 이
  // 관문에서 다듬지 않는다.
  const values = formValues({
    situationRequest: " ・ 수리의뢰",
    findings: "첫 문단\n\n둘째 문단\n",
    remark: "  들여쓴 비고",
  });

  const result = read({ ...values });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.values.situationRequest, " ・ 수리의뢰");
  assert.equal(result.ok && result.values.findings, "첫 문단\n\n둘째 문단\n");
  assert.equal(result.ok && result.values.remark, "  들여쓴 비고");
});

test("원인을 하나도 안 골랐어도 통과한다", () => {
  const result = read({ ...formValues({ causes: [] }) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.values.causes, []);
});

test("모르는 키가 섞여 와도 폼 값에는 들어가지 않는다", () => {
  const result = read({ ...formValues(), 엉뚱한칸: "무시된다", isAdmin: true });
  assert.equal(result.ok, true);
  assert.equal(result.ok && Object.prototype.hasOwnProperty.call(result.values, "isAdmin"), false);
  assert.deepEqual(result.ok && Object.keys(result.values).sort(), Object.keys(formValues()).sort());
});

// ─────────────────────────────────────────────────────── 거절하는 것

test("🔴 칸이 빠지면 거절한다 — 서버가 대신 채우지 않는다", () => {
  const missing: Record<string, unknown> = { ...formValues() };
  delete missing.findings;

  const result = read(missing);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.fieldErrors.findings, "빠진 칸의 이름이 오류에 담긴다");
});

test("글자 칸에 글자가 아닌 것이 오면 거절한다", () => {
  for (const bad of [123, null, ["여러 줄"], { 객체: true }]) {
    const result = read({ ...formValues(), findings: bad });
    assert.equal(result.ok, false, `보낸 값: ${JSON.stringify(bad)}`);
    assert.ok(!result.ok && result.fieldErrors.findings);
  }
});

test("체크 칸에 불리언이 아닌 것이 오면 거절한다", () => {
  const result = read({ ...formValues(), onSiteRepair: "true" });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.fieldErrors.onSiteRepair);
});

test("종류와 발생일 방식은 정해진 값이 아니면 거절한다", () => {
  const wrongKind = read({ ...formValues(), kind: "SOMETHING_ELSE" });
  assert.equal(wrongKind.ok, false);
  assert.ok(!wrongKind.ok && wrongKind.fieldErrors.kind);

  const wrongMode = read({ ...formValues(), occurredOnMode: "MAYBE" });
  assert.equal(wrongMode.ok, false);
  assert.ok(!wrongMode.ok && wrongMode.fieldErrors.occurredOnMode);
});

test("🔴 모르는 원인 코드는 조용히 버리지 않고 거절한다", () => {
  // 말없이 걸러 내면 원인이 하나 빠진 보고서가 고객사로 나간다.
  const result = read({ ...formValues(), causes: ["AGING", "없는코드"] });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.fieldErrors.causes);
});

test("원인이 배열이 아니면 거절한다", () => {
  const result = read({ ...formValues(), causes: "AGING" });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.fieldErrors.causes);
});

test("폼 값이 아예 아닌 것(배열 · 숫자 · null · 글자)에도 안 터진다", () => {
  for (const bad of [null, undefined, 42, "보고서", [1, 2, 3], true]) {
    let result: ReturnType<typeof read> | undefined;
    assert.doesNotThrow(() => {
      result = read(bad);
    }, `보낸 값: ${JSON.stringify(bad)}`);
    assert.equal(result?.ok, false);
  }
});

// ───────────────────────── 저장해 둔 것 → 폼 값 → 다시 저장(왕복)

test("🔴 「안 줌(null)」으로 저장된 정형 문구는 폼에서 문구로 펴지고, 그대로 다시 통과한다", () => {
  // null = 안 줌 → 채우개가 정형 문구를 넣는다. 화면은 그것과 같은 상태로 열려야
  // 하므로 문구가 미리 채워진 칸이 된다.
  const saved: ServiceReportSaveValues = { ...formValues(), findingsIntro: null };

  const poured = serviceReportFormValues(saved, INTRO);
  assert.equal(poured.findingsIntro, INTRO);

  const result = read({ ...poured });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.values.findingsIntro, INTRO);
});

test("🔴 「일부러 비움('')」은 빈 칸으로 열리고, 빈 칸인 채로 다시 통과한다", () => {
  // 여기서 null 로 뭉개면 사람이 지운 문장이 다음 문서에 되살아난다.
  const saved: ServiceReportSaveValues = { ...formValues(), findingsIntro: "" };

  const poured = serviceReportFormValues(saved, INTRO);
  assert.equal(poured.findingsIntro, "");

  const result = read({ ...poured });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.values.findingsIntro, "");
});

test("저장해 둔 값을 폼에 부었다가 그대로 되보내면 한 칸도 달라지지 않는다", () => {
  const saved: ServiceReportSaveValues = {
    ...formValues({
      kind: "REPAIR",
      findings: "확인내용 첫 줄\n\n확인내용 셋째 줄",
      actions: "조치",
      summary: "정리",
      causes: ["PART_DEFECT"],
      situationDetail: " ・ 수리의뢰",
    }),
    findingsIntro: null,
  };

  const poured = serviceReportFormValues(saved, INTRO);
  const result = read({ ...poured });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.values, poured);
});
