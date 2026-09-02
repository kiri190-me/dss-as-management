import assert from "node:assert/strict";
import { test } from "node:test";

import { createServiceReportFormValues } from "./service-report-form";
import { serviceReportKindFromParam } from "./service-report-kind-param";

/** 씨앗의 나머지 칸은 이 시험의 관심사가 아니다 — 종류만 본다. */
function kindOf(param: string | string[] | undefined | null): string {
  return createServiceReportFormValues({
    today: "2026-09-02",
    findingsIntro: "인수품에 대하여",
    kind: serviceReportKindFromParam(param) ?? undefined,
  }).kind;
}

test("우리가 만드는 두 링크의 값은 그대로 쓰인다", () => {
  assert.equal(serviceReportKindFromParam("INSPECTION"), "INSPECTION");
  assert.equal(serviceReportKindFromParam("REPAIR"), "REPAIR");
});

test("없거나 빈 값이면 고르지 않는다", () => {
  assert.equal(serviceReportKindFromParam(undefined), null);
  assert.equal(serviceReportKindFromParam(null), null);
  assert.equal(serviceReportKindFromParam(""), null);
});

test("🔴 손으로 고친 주소는 통과하지 못한다 — 소문자·공백·엉뚱한 글자", () => {
  assert.equal(serviceReportKindFromParam("repair"), null);
  assert.equal(serviceReportKindFromParam("Inspection"), null);
  assert.equal(serviceReportKindFromParam(" REPAIR"), null);
  assert.equal(serviceReportKindFromParam("REPAIR "), null);
  assert.equal(serviceReportKindFromParam("DROP TABLE"), null);
  assert.equal(serviceReportKindFromParam("수리"), null);
});

test("🔴 프로토타입 이름도 종류 행세를 못 한다", () => {
  assert.equal(serviceReportKindFromParam("constructor"), null);
  assert.equal(serviceReportKindFromParam("toString"), null);
  assert.equal(serviceReportKindFromParam("__proto__"), null);
  assert.equal(serviceReportKindFromParam("hasOwnProperty"), null);
});

test("값이 여러 개 와도 터지지 않는다 — 어느 쪽을 고를 근거가 없어 버린다", () => {
  assert.equal(serviceReportKindFromParam(["INSPECTION", "REPAIR"]), null);
  assert.equal(serviceReportKindFromParam(["REPAIR", "REPAIR"]), null);
  assert.equal(serviceReportKindFromParam([]), null);
});

test("고르지 못한 값은 폼 씨앗의 기본값으로 떨어진다 — 기본값의 사본을 만들지 않았다", () => {
  assert.equal(kindOf(undefined), "REPAIR");
  assert.equal(kindOf(""), "REPAIR");
  assert.equal(kindOf("repair"), "REPAIR");
  assert.equal(kindOf("DROP TABLE"), "REPAIR");
  assert.equal(kindOf(["INSPECTION", "REPAIR"]), "REPAIR");
});

test("주소가 고른 종류가 폼의 시작값이 된다", () => {
  assert.equal(kindOf("INSPECTION"), "INSPECTION");
  assert.equal(kindOf("REPAIR"), "REPAIR");
});
