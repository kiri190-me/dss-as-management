import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildServiceReportFileName,
  formatServiceReportNumber,
  serviceReportContentDisposition,
} from "./service-report-file-name";
import { quoteContentDisposition } from "./quote-file-name";

/** 제어문자는 소스에 적지 않는다 — 눈에 안 보이는 채로 파일에 박힌다. */
const NUL = String.fromCharCode(0);
const UNIT_SEPARATOR = String.fromCharCode(31);
const DEL = String.fromCharCode(127);

test("받는 사람이 다운로드 폴더에서 알아볼 수 있는 이름", () => {
  assert.equal(
    buildServiceReportFileName({
      kind: "INSPECTION",
      customerName: "ICD Co.,Ltd",
      reportNumber: "Z494-P33A3-4013",
    }),
    "검사보고서_ICD Co.,Ltd_Z494-P33A3-4013.xlsx"
  );
});

test("🔴 검사와 수리는 이름으로 갈린다 — 같은 건에서 두 장이 나온다", () => {
  const common = { customerName: "ICD", reportNumber: "Z494-P33A3-4013" };
  const inspection = buildServiceReportFileName({ kind: "INSPECTION", ...common });
  const repair = buildServiceReportFileName({ kind: "REPAIR", ...common });

  assert.notEqual(inspection, repair);
  assert.ok(inspection.startsWith("검사보고서_"));
  assert.ok(repair.startsWith("수리보고서_"));
});

test("파일 이름에 쓸 수 없는 글자를 지운다 — 슬래시가 든 상호가 실제로 있다", () => {
  const name = buildServiceReportFileName({
    kind: "REPAIR",
    customerName: "㈜디에스에스 A/S 사업부",
    reportNumber: "Z494*P33A3?4013",
  });
  assert.equal(name, "수리보고서_㈜디에스에스 A S 사업부_Z494 P33A3 4013.xlsx");
  for (const forbidden of ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]) {
    assert.ok(!name.slice("수리보고서_".length).includes(forbidden), `${forbidden} 가 남아 있다`);
  }
});

test("제어문자는 헤더를 깨뜨린다 — 통째로 뺀다", () => {
  const name = buildServiceReportFileName({
    kind: "INSPECTION",
    customerName: `ICD${UNIT_SEPARATOR}Co`,
    reportNumber: `Z494${NUL}${DEL}4013`,
  });
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    assert.ok(code >= 32 && code !== 127, `제어문자가 남았다: ${code}`);
  }
  assert.equal(name, "검사보고서_ICD Co_Z494 4013.xlsx");
});

test("하이픈과 마침표는 살아남는다 — 문서번호의 모양이다", () => {
  const name = buildServiceReportFileName({
    kind: "REPAIR",
    customerName: "ICD Co.,Ltd",
    reportNumber: "Z494-P33A3-4013",
  });
  assert.ok(name.includes("Z494-P33A3-4013"), name);
  assert.ok(name.includes("Co.,Ltd"), name);
});

test("값이 비어도 이름이 망가지지 않는다", () => {
  assert.equal(
    buildServiceReportFileName({ kind: "INSPECTION", customerName: "", reportNumber: "" }),
    "검사보고서.xlsx"
  );
  // 공백만 적힌 값도 없는 것과 같다.
  assert.equal(
    buildServiceReportFileName({ kind: "REPAIR", customerName: "   ", reportNumber: "///" }),
    "수리보고서.xlsx"
  );
  // 한쪽만 있으면 그 한쪽만 붙는다 — `_` 가 덜렁 남지 않는다.
  assert.equal(
    buildServiceReportFileName({ kind: "REPAIR", customerName: "ICD", reportNumber: "" }),
    "수리보고서_ICD.xlsx"
  );
});

test("이름이 길어도 상한에서 잘린다", () => {
  const name = buildServiceReportFileName({
    kind: "REPAIR",
    customerName: "가".repeat(200),
    reportNumber: "Z".repeat(200),
  });
  assert.ok(name.length < 200, `너무 길다: ${name.length}`);
  assert.ok(name.endsWith(".xlsx"));
});

// ── 문서번호 ─────────────────────────────────────────────────────────────

test("문서번호는 양식의 세 칸을 이어 붙인 모양이다", () => {
  assert.equal(
    formatServiceReportNumber({ prefix: "Z494", middle: "P33A3", tail: "4013" }),
    "Z494-P33A3-4013"
  );
});

test("앞자리가 없으면 빼고 잇는다 — `Z494--4013` 이 나오지 않게", () => {
  assert.equal(formatServiceReportNumber({ middle: "P33A3", tail: "4013" }), "P33A3-4013");
  assert.equal(
    formatServiceReportNumber({ prefix: "  ", middle: "P33A3", tail: "4013" }),
    "P33A3-4013"
  );
});

// ── Content-Disposition ──────────────────────────────────────────────────

test("🔴 RFC 5987 은 견적서 것을 그대로 쓴다 — 규칙을 두 벌 두지 않는다", () => {
  assert.equal(serviceReportContentDisposition, quoteContentDisposition);
});

test("Content-Disposition: 한글은 RFC 5987 로도 함께 보낸다", () => {
  const fileName = buildServiceReportFileName({
    kind: "INSPECTION",
    customerName: "테스트상사",
    reportNumber: "Z494-P33A3-4013",
  });
  const header = serviceReportContentDisposition(fileName);

  assert.match(header, /^attachment; /);
  const asciiPart = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
  assert.ok(!/[^\x20-\x7E]/.test(asciiPart), `ASCII 대체값에 비ASCII 가 남았다: ${asciiPart}`);
  assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent(fileName)}`));
});
