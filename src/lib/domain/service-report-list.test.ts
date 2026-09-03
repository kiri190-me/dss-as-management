import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildServiceReportListName,
  SERVICE_REPORT_LIST_NAME_FALLBACK,
} from "./service-report-list";

/**
 * ============================================================================
 * 목록에서 어느 장인지 알아볼 수 있는가
 * ============================================================================
 * 이 파일이 못 박는 것은 셋이다:
 *
 *   1. 붙이는 **순서**(모델명 → L/N → S/N)와 잇는 글자(밑줄).
 *   2. 빈 칸이 자리를 남기지 않는다 — `RFK300FH-AD1__WU12345` 가 나오면 안 된다.
 *   3. 되돌아가는 순서: 장비 셋 → 문서번호 → 「이름 없음」.
 * ============================================================================
 */

const SAMPLE = {
  modelName: "RFK300FH-AD1",
  lotNumber: "WU8042",
  serialNumber: "1612027",
  reportNumber: "Z494-P33A7-4013",
};

test("이름은 모델명_L/N_S/N 이다 — 밑줄로 잇는다", () => {
  assert.equal(buildServiceReportListName(SAMPLE), "RFK300FH-AD1_WU8042_1612027");
});

/**
 * 이 시험이 이 파일에서 제일 중요하다. 값의 모양(WU 접두 vs 숫자만)으로 짐작하면
 * 정확히 반대로 붙는다 — 견적서 목록에서 실제로 한 번 틀렸던 자리다.
 */
test("🔴 L/N 이 S/N 보다 앞이다 — 값 모양으로 짐작하지 않는다", () => {
  const name = buildServiceReportListName(SAMPLE);
  assert.ok(
    name.indexOf("WU8042") < name.indexOf("1612027"),
    "WU8042(L/N)가 1612027(S/N)보다 앞에 와야 한다"
  );
});

test("빈 칸은 자리를 남기지 않고 통째로 빠진다", () => {
  assert.equal(
    buildServiceReportListName({ ...SAMPLE, lotNumber: null }),
    "RFK300FH-AD1_1612027"
  );
  assert.equal(
    buildServiceReportListName({ ...SAMPLE, modelName: null }),
    "WU8042_1612027"
  );
  assert.equal(
    buildServiceReportListName({ ...SAMPLE, serialNumber: null }),
    "RFK300FH-AD1_WU8042"
  );
  // 밑줄이 겹치면 "무언가 빠졌다"가 아니라 "글자가 깨졌다"로 읽힌다.
  assert.ok(!buildServiceReportListName({ ...SAMPLE, lotNumber: null }).includes("__"));
});

test("공백만 적힌 값도 없는 것으로 접고, 앞뒤 공백은 다듬는다", () => {
  assert.equal(
    buildServiceReportListName({ ...SAMPLE, lotNumber: "   ", serialNumber: "" }),
    "RFK300FH-AD1"
  );
  assert.equal(
    buildServiceReportListName({
      ...SAMPLE,
      modelName: "  RFK300FH-AD1 ",
      lotNumber: " WU8042",
      serialNumber: "1612027  ",
    }),
    "RFK300FH-AD1_WU8042_1612027"
  );
});

test("장비 셋이 다 비면 문서번호로 되돌아간다", () => {
  assert.equal(
    buildServiceReportListName({
      modelName: null,
      lotNumber: "  ",
      serialNumber: "",
      reportNumber: " Z494-P33A7-4013 ",
    }),
    "Z494-P33A7-4013"
  );
});

test("넷 다 비면 「이름 없음」 — 누를 곳이 이름 없는 줄이 되지 않게", () => {
  assert.equal(
    buildServiceReportListName({
      modelName: null,
      lotNumber: null,
      serialNumber: null,
      reportNumber: "",
    }),
    SERVICE_REPORT_LIST_NAME_FALLBACK
  );
  assert.equal(SERVICE_REPORT_LIST_NAME_FALLBACK, "이름 없음");
});

/** 장비가 하나라도 있으면 문서번호는 이름 자리에 오지 않는다 — 옆에 따로 그린다. */
test("🔴 장비 값이 하나라도 있으면 문서번호로 되돌아가지 않는다", () => {
  assert.equal(
    buildServiceReportListName({
      modelName: null,
      lotNumber: null,
      serialNumber: "1612027",
      reportNumber: "Z494-P33A7-4013",
    }),
    "1612027"
  );
});
