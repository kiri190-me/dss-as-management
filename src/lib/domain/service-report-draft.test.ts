import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as serviceReportDraftModule from "./service-report-draft";
import {
  formatServiceReportKstDateTime,
  serviceReportValuesChanged,
} from "./service-report-draft";
import {
  createServiceReportFormValues,
  type ServiceReportFormValues,
} from "./service-report-form";

/**
 * ============================================================================
 * 🔴 **임시보관을 걷어낸 뒤** 이 파일이 지키는 것 (2026-10-19)
 * ============================================================================
 * 예전에는 「적던 내용을 브라우저에 보관했다가 되살리는가」를 보던 시험이었다.
 * 사용자 요구로 그 장치를 없앴다(모듈 머리말 참조). 지금 보는 것은 셋이다:
 *
 *   1. 🔴 **브라우저에 적어 두는 길이 이 모듈에서 사라졌다** — `localStorage` 도,
 *      열쇠를 짓는 함수도, 읽기·적기·지우기도 없다. 하나라도 남아 있으면 화면과
 *      저장된 값이 다시 갈라질 수 있다.
 *   2. 🔴 **고친 것이 있는가**를 바르게 가른다 — [취소]가 물을지 말지가 여기서
 *      갈린다. 못 보고 지나치면 **적은 글이 말없이 사라진다.**
 *   3. 시각 한 줄의 모양(KST). 「보고서」 탭 목록과 흐름도가 함께 쓴다.
 * ============================================================================
 */

/** 화면이 처음 열릴 때 만드는 자동 채움 값 — 「고쳤는가」의 기준선이다. */
function autofilled(): ServiceReportFormValues {
  return createServiceReportFormValues({
    today: "2026-09-02",
    findingsIntro: "아래와 같이 확인하였습니다.",
    actionsIntro: { INSPECTION: "", REPAIR: "" },
    summaryIntro: "",
    productNames: ["13.56MHz 30kW"],
    repairCase: {
      customerName: "OO전자",
      modelName: "RFK300FH-AD1",
      lotNumber: "L-1",
      serialNumber: "1502021",
      receivedAt: "2024-03-21",
      productCategory: "RF Generator",
      reportedSymptom: "출력이 나오지 않음",
    },
  });
}

// ─────────────────────────────── 1. 브라우저에 남는 자리가 없다

const source = readFileSync(new URL("./service-report-draft.ts", import.meta.url), "utf8");
/** 머리말이 «없앴다»를 설명하느라 적은 낱말에 걸리지 않게 주석을 뺀다. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("🔴 브라우저 저장소를 두드리는 길이 이 모듈에 없다", () => {
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "getItem",
    "setItem",
    "removeItem",
    "JSON.parse",
    "JSON.stringify",
    "dss.service-report.draft",
  ]) {
    assert.equal(code.includes(forbidden), false, `임시보관이 남아 있다: ${forbidden}`);
  }
});

test("🔴 열쇠를 짓거나 임시보관을 읽고 적던 함수가 사라졌다", () => {
  const names = Object.keys(serviceReportDraftModule).sort();
  assert.deepEqual(names, ["formatServiceReportKstDateTime", "serviceReportValuesChanged"]);
});

// ─────────────────────────────── 2. 고친 것이 있는가

test("한 칸도 안 고쳤으면 «안 고쳤다» — [취소]가 묻지 않는다", () => {
  assert.equal(serviceReportValuesChanged(autofilled(), autofilled()), false);
});

test("🔴 글자 칸을 한 글자만 고쳐도 잡는다", () => {
  const before = autofilled();
  assert.equal(serviceReportValuesChanged(before, { ...before, findings: "a" }), true);
  assert.equal(serviceReportValuesChanged(before, { ...before, remark: " " }), true);
  assert.equal(
    serviceReportValuesChanged(before, { ...before, customer: `${before.customer} ` }),
    true
  );
});

test("🔴 체크·고르개·종류도 잡는다 — 글자 칸만 보지 않는다", () => {
  const before = autofilled();
  assert.equal(serviceReportValuesChanged(before, { ...before, onSiteRepair: true }), true);
  assert.equal(serviceReportValuesChanged(before, { ...before, completionChecked: true }), true);
  assert.equal(serviceReportValuesChanged(before, { ...before, occurredOnMode: "TEXT" }), true);
  assert.equal(serviceReportValuesChanged(before, { ...before, kind: "INSPECTION" }), true);
});

test("고른 원인이 늘거나 줄면 잡는다", () => {
  const before: ServiceReportFormValues = { ...autofilled(), causes: [] };
  const picked: ServiceReportFormValues = { ...before, causes: ["AGING"] };
  assert.equal(serviceReportValuesChanged(before, picked), true);
  assert.equal(serviceReportValuesChanged(picked, before), true);
});

test("🔴 원인은 **차례가 뜻을 갖지 않는다** — 체크를 풀었다 다시 켠 것은 고친 것이 아니다", () => {
  const before: ServiceReportFormValues = {
    ...autofilled(),
    causes: ["AGING", "TRANSPORT_DAMAGE"],
  };
  const reordered: ServiceReportFormValues = {
    ...before,
    causes: ["TRANSPORT_DAMAGE", "AGING"],
  };
  assert.equal(serviceReportValuesChanged(before, reordered), false);
});

test("🔴 칸이 하나 늘면 비교에서 빠지지 않는다 — 모든 칸을 돈다", () => {
  const before = autofilled();
  // 폼 값의 모든 칸을 하나씩 바꿔 보고, **전부** 잡히는지 본다.
  const base = before as unknown as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const value = base[key];
    const next =
      key === "causes"
        ? [...before.causes, "OTHER"]
        : typeof value === "boolean"
          ? !value
          : `${String(value)}·고침`;
    const changed = { ...base, [key]: next } as unknown as ServiceReportFormValues;
    assert.equal(serviceReportValuesChanged(before, changed), true, `칸이 비교에서 빠졌다: ${key}`);
  }
});

// ─────────────────────────────── 3. 시각 한 줄

test("시각을 KST 로 못 박아 한 가지 모양으로 적는다", () => {
  assert.equal(
    formatServiceReportKstDateTime(new Date("2026-09-02T05:33:00.000Z")),
    "2026-09-02 14:33"
  );
  // UTC 로 적으면 날짜가 하루 어긋나는 자리.
  assert.equal(
    formatServiceReportKstDateTime(new Date("2026-09-02T15:00:00.000Z")),
    "2026-09-03 00:00"
  );
  // 자정은 24:00 이 아니라 00:00 이다(hourCycle: h23).
  assert.equal(
    formatServiceReportKstDateTime(new Date("2026-09-01T15:00:00.000Z")),
    "2026-09-02 00:00"
  );
});

test("읽을 수 없는 시각은 지어내지 않는다", () => {
  assert.equal(formatServiceReportKstDateTime(new Date("어제쯤")), null);
});
