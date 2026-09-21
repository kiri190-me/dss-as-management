import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSheetGrid } from "../xlsx/sheet-grid";
import { helperZoneColumn, pickRepairReportSheetName, readMarkGroup } from "./report-marks";

/**
 * 🔴 시험용 보고서는 손으로 지은 가짜다. 보기 글자(`製作不良` 따위)는 양식에
 * 인쇄된 것이라 고객 내용이 아니고, 값 자리에는 `값-접수번호` 를 넣는다.
 */

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function gridOf(cells: Record<string, string | number>) {
  const byRow = new Map<number, { column: string; xml: string }[]>();
  for (const [address, value] of Object.entries(cells)) {
    const matched = /^([A-Z]+)(\d+)$/.exec(address);
    assert.ok(matched, `칸 주소가 아니다: ${address}`);
    const row = Number(matched[2]);
    const xml =
      typeof value === "number"
        ? `<c r="${address}"><v>${value}</v></c>`
        : `<c r="${address}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    byRow.set(row, [...(byRow.get(row) ?? []), { column: matched[1], xml }]);
  }
  const rowsXml = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([row, entries]) =>
        `<row r="${row}">${entries
          .sort((a, b) => a.column.length - b.column.length || (a.column < b.column ? -1 : 1))
          .map((entry) => entry.xml)
          .join("")}</row>`
    )
    .join("");
  return buildSheetGrid(`<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`, [], false);
}

/** 실측 그대로의 수리보고서 조각 — 열과 줄이 실제 파일에서 왔다. */
const REPORT: Record<string, string | number> = {
  AY7: "BAKA避け",
  C28: "処　置",
  J28: "現地修理",
  X28: "○",
  Z28: "現品引取",
  AF28: 46086,
  AO28: "No.",
  AQ28: "값-접수번호",
  J29: "代品納入",
  X29: "○",
  Z29: "処置完了",
  AF29: 46129,
  AO29: "---",
  C30: "原　因",
  J30: "製作不良",
  R30: "部品不良",
  Z30: "経年劣化",
  AH30: "輸送不良",
  AP30: "保管不良",
  J31: "仕様不備",
  R31: "検査ミス",
  Z31: "取扱不備",
  AH31: "再現せず",
  AN31: "○",
  AP31: "その他",
  AY31: "○",
  C64: "備　考",
};

describe("🔴 ○ 는 보기의 **왼쪽** 칸에 있다", () => {
  const grid = gridOf(REPORT);

  test("원인 — `AN31` 의 ○ 가 고르는 것은 오른쪽 `AP31` 이다", () => {
    const cause = readMarkGroup(grid, "原因");
    assert.equal(cause.sectionAddress, "C30");
    assert.deepEqual(cause.marked, ["その他"]);
  });

  test("처치 — ○ 두 개가 각각 오른쪽 보기를 고른다", () => {
    const action = readMarkGroup(grid, "処置");
    assert.equal(action.sectionAddress, "C28");
    assert.deepEqual(action.marked, ["現品引取", "処置完了"]);
  });

  test("🔴 오른쪽으로 읽었다면 나왔을 답이 나오지 않는다", () => {
    const action = readMarkGroup(grid, "処置");
    // ○ 오른쪽이 아니라 왼쪽을 고른다면 `現地修理`·`代品納入` 이 골렸을 것이다.
    assert.equal(action.marked.includes("現地修理"), false);
    assert.equal(action.marked.includes("代品納入"), false);
    const cause = readMarkGroup(grid, "原因");
    assert.equal(cause.marked.includes("再現せず"), false);
  });

  test("보기 목록은 양식 그대로 — 열 차례로", () => {
    const cause = readMarkGroup(grid, "原因");
    assert.deepEqual(cause.options, [
      "製作不良",
      "部品不良",
      "経年劣化",
      "輸送不良",
      "保管不良",
      "仕様不備",
      "検査ミス",
      "取扱不備",
      "再現せず",
      "その他",
    ]);
  });
});

describe("🔴 옆 상자와 도움 칸은 보기가 아니다", () => {
  const grid = gridOf(REPORT);

  test("처치 줄 오른쪽의 처치일자·`No.`·접수번호를 보기로 세지 않는다", () => {
    const action = readMarkGroup(grid, "処置");
    assert.deepEqual(action.options, ["現地修理", "現品引取", "代品納入", "処置完了"]);
    assert.equal(action.options.includes("No."), false);
    assert.equal(action.options.includes("값-접수번호"), false);
  });

  test("도움 칸 구역(`BAKA避け`)부터는 보지 않는다 — `AY31` 의 ○ 는 아무것도 고르지 않는다", () => {
    assert.equal(helperZoneColumn(grid), 51);
    const cause = readMarkGroup(grid, "原因");
    assert.equal(cause.marked.length, 1);
  });

  test("도움 칸 이름이 없어도 맨 뒤 보기 오른쪽의 ○ 는 아무것도 고르지 않는다", () => {
    const noHelper = { ...REPORT };
    delete noHelper.AY7;
    const cause = readMarkGroup(gridOf(noHelper), "原因");
    assert.deepEqual(cause.marked, ["その他"]);
  });
});

describe("○ 가 없으면 「없음」", () => {
  test("하나도 안 찍힌 보고서", () => {
    const blank = { ...REPORT };
    delete blank.X28;
    delete blank.X29;
    delete blank.AN31;
    const grid = gridOf(blank);
    assert.deepEqual(readMarkGroup(grid, "原因").marked, []);
    assert.deepEqual(readMarkGroup(grid, "処置").marked, []);
  });

  test("구역 자체가 없으면 빈 값", () => {
    const grid = gridOf({ C12: "修　理　報　告　書" });
    assert.deepEqual(readMarkGroup(grid, "原因"), { sectionAddress: null, options: [], marked: [] });
  });

  test("다음 구역 이름(`備　考`)을 넘어가지 않는다", () => {
    const grid = gridOf({ C30: "原　因", J30: "製作不良", C31: "備　考", J31: "값-비고" });
    const cause = readMarkGroup(grid, "原因");
    assert.deepEqual(cause.options, ["製作不良"]);
  });
});

describe("pickRepairReportSheetName — 비슷한 이름이 여럿일 때", () => {
  test("정확히 `Repair_Report` 가 `1st_Repair_Report` 를 이긴다", () => {
    assert.equal(
      pickRepairReportSheetName(["List", "Card", "1st_Repair_Report", "Repair_Report", "引取品フロー"]),
      "Repair_Report"
    );
  });

  test("제너레이터 양식은 `修理報告書GEx` 를 고른다 — `調査報告書GEx` 가 아니다", () => {
    assert.equal(
      pickRepairReportSheetName(["ｶｰﾄﾞ", "調査報告書GEx", "修理報告書GEx", "Repair_Report (한글)"]),
      "修理報告書GEx"
    );
  });

  test("하나도 없으면 null", () => {
    assert.equal(pickRepairReportSheetName(["Card", "リスト"]), null);
  });
});
