import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildServiceReportFileName,
  formatServiceReportNumber,
  serviceReportContentDisposition,
} from "./service-report-file-name";
import { buildServiceReportListName } from "./service-report-list";
import { quoteContentDisposition } from "./quote-file-name";

/** 제어문자는 소스에 적지 않는다 — 눈에 안 보이는 채로 파일에 박힌다. */
const NUL = String.fromCharCode(0);
const UNIT_SEPARATOR = String.fromCharCode(31);
const DEL = String.fromCharCode(127);

/** 장비 셋이 다 적힌 흔한 한 장. */
const EQUIPMENT = {
  modelName: "RFK300FH-AD1",
  lotNumber: "WU8042",
  serialNumber: "1612027",
} as const;

test("받는 사람이 다운로드 폴더에서 어느 장비인지 알아볼 수 있는 이름", () => {
  assert.equal(
    buildServiceReportFileName({
      kind: "INSPECTION",
      ...EQUIPMENT,
      reportNumber: "Z494-P33A3-4013",
    }),
    "검사보고서_RFK300FH-AD1_WU8042_1612027.xlsx"
  );
});

test("🔴 목록에 보이는 이름과 파일 이름이 같다 — 규칙이 한 곳에 있다", () => {
  const reportNumber = "Z494-P33A3-4013";
  const listName = buildServiceReportListName({ ...EQUIPMENT, reportNumber });
  const fileName = buildServiceReportFileName({
    kind: "REPAIR",
    ...EQUIPMENT,
    reportNumber,
  });

  assert.equal(fileName, `수리보고서_${listName}.xlsx`);
});

test("🔴 L/N 이 먼저고 S/N 이 나중이다 — 값 모양으로 짐작하지 않는다", () => {
  const name = buildServiceReportFileName({
    kind: "REPAIR",
    ...EQUIPMENT,
    reportNumber: "",
  });
  assert.ok(
    name.indexOf(EQUIPMENT.lotNumber) < name.indexOf(EQUIPMENT.serialNumber),
    `L/N 이 S/N 보다 앞이어야 한다: ${name}`
  );
});

test("🔴 검사와 수리는 이름으로 갈린다 — 같은 장비로 두 장이 나온다", () => {
  const common = { ...EQUIPMENT, reportNumber: "Z494-P33A3-4013" };
  const inspection = buildServiceReportFileName({ kind: "INSPECTION", ...common });
  const repair = buildServiceReportFileName({ kind: "REPAIR", ...common });

  assert.notEqual(inspection, repair);
  assert.ok(inspection.startsWith("검사보고서_"));
  assert.ok(repair.startsWith("수리보고서_"));
});

test("파일 이름에 쓸 수 없는 글자를 지운다 — 손으로 적는 칸이라 섞여 들어온다", () => {
  const name = buildServiceReportFileName({
    kind: "REPAIR",
    modelName: "RFK300FH/AD1",
    lotNumber: "WU8042*",
    serialNumber: "1612027?",
    reportNumber: "Z494-P33A3-4013",
  });
  // 못 쓰는 글자는 공백이 되고, 끝의 공백만 다듬어진다(`sanitize` 그대로다).
  assert.equal(name, "수리보고서_RFK300FH AD1_WU8042 _1612027.xlsx");
  for (const forbidden of ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]) {
    assert.ok(!name.slice("수리보고서_".length).includes(forbidden), `${forbidden} 가 남아 있다`);
  }
});

test("제어문자는 헤더를 깨뜨린다 — 통째로 뺀다", () => {
  const name = buildServiceReportFileName({
    kind: "INSPECTION",
    modelName: `RFK300${UNIT_SEPARATOR}FH`,
    lotNumber: `WU${NUL}${DEL}8042`,
    serialNumber: "1612027",
    reportNumber: "",
  });
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    assert.ok(code >= 32 && code !== 127, `제어문자가 남았다: ${code}`);
  }
  assert.equal(name, "검사보고서_RFK300 FH_WU 8042_1612027.xlsx");
});

test("하이픈과 마침표는 살아남는다 — 형식과 문서번호의 모양이다", () => {
  const name = buildServiceReportFileName({
    kind: "REPAIR",
    ...EQUIPMENT,
    reportNumber: "Z494-P33A3-4013",
  });
  assert.ok(name.includes("RFK300FH-AD1"), name);

  const numberOnly = buildServiceReportFileName({
    kind: "REPAIR",
    reportNumber: "Z494-P33A3.4013",
  });
  assert.equal(numberOnly, "수리보고서_Z494-P33A3.4013.xlsx");
});

// ── 되돌아가는 순서: 장비 셋 → 문서번호 → 종류만 ─────────────────────────

test("🔴 빈 칸은 통째로 뺀다 — `__` 가 겹치지 않는다", () => {
  // L/N 이 없는 장비가 실제로 있다.
  assert.equal(
    buildServiceReportFileName({
      kind: "INSPECTION",
      modelName: "RFK300FH-AD1",
      lotNumber: "",
      serialNumber: "1612027",
      reportNumber: "Z494-P33A3-4013",
    }),
    "검사보고서_RFK300FH-AD1_1612027.xlsx"
  );
  // 안 준 것과 빈 것이 같은 뜻이다 — 공백만 적힌 값도 마찬가지다.
  assert.equal(
    buildServiceReportFileName({
      kind: "REPAIR",
      modelName: "RFK300FH-AD1",
      lotNumber: null,
      serialNumber: "   ",
      reportNumber: "",
    }),
    "수리보고서_RFK300FH-AD1.xlsx"
  );
});

test("장비 셋이 다 비면 문서번호로 되돌아간다", () => {
  assert.equal(
    buildServiceReportFileName({
      kind: "INSPECTION",
      modelName: null,
      lotNumber: null,
      serialNumber: null,
      reportNumber: "Z494-P33A3-4013",
    }),
    "검사보고서_Z494-P33A3-4013.xlsx"
  );
  // 칸을 아예 안 줘도 같은 뜻이다(채우개 입력은 없는 칸을 들고 오지 않는다).
  assert.equal(
    buildServiceReportFileName({ kind: "REPAIR", reportNumber: "Z494-P33A3-4013" }),
    "수리보고서_Z494-P33A3-4013.xlsx"
  );
});

test("🔴 넷 다 비면 종류만 남는다 — 「이름 없음」은 파일 이름이 아니다", () => {
  assert.equal(
    buildServiceReportFileName({
      kind: "INSPECTION",
      modelName: "",
      lotNumber: "",
      serialNumber: "",
      reportNumber: "",
    }),
    "검사보고서.xlsx"
  );
  assert.equal(buildServiceReportFileName({ kind: "REPAIR", reportNumber: "  " }), "수리보고서.xlsx");
  // 못 쓰는 글자만 남은 값도 다듬고 나면 빈 글자다.
  assert.equal(
    buildServiceReportFileName({ kind: "REPAIR", modelName: "///", reportNumber: "" }),
    "수리보고서.xlsx"
  );
});

test("이름이 길어도 상한에서 잘린다", () => {
  const name = buildServiceReportFileName({
    kind: "REPAIR",
    modelName: "가".repeat(200),
    lotNumber: "나".repeat(200),
    serialNumber: "다".repeat(200),
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
    modelName: "형식이름",
    lotNumber: "WU8042",
    serialNumber: "1612027",
    reportNumber: "Z494-P33A3-4013",
  });
  const header = serviceReportContentDisposition(fileName);

  assert.match(header, /^attachment; /);
  const asciiPart = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
  assert.ok(!/[^\x20-\x7E]/.test(asciiPart), `ASCII 대체값에 비ASCII 가 남았다: ${asciiPart}`);
  assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent(fileName)}`));
});
