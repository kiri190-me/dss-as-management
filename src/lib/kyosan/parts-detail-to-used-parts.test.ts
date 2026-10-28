import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSheetGrid } from "../xlsx/sheet-grid";
import {
  CARD_FIELDS,
  CARD_LISTS,
  type CardFieldKey,
  type CardFieldValue,
  type CardFields,
  type CardListKey,
  type CardListValue,
} from "./card-fields";
import type { KyosanReport } from "./kyosan-report";
import { readPartsDetailSheet } from "./parts-detail-sheet";
import { buildKyosanPreviewParts, mergeKyosanPartsForUsedParts } from "./report-preview";

/**
 * ============================================================================
 * 🔴 판본 C 한 장을 **시트 칸부터 사용 부품 칸까지** 끝까지 따라간다 (2026-10-29)
 * ============================================================================
 * 운영에서 틀린 값이 나왔는데, 그 길에 모듈이 **셋**이라 어느 하나만 단위로
 * 재면 아무것도 안 걸린다:
 *
 *   `readPartsDetailSheet`        — 어느 칸을 이름으로 집는가(`parts-detail-sheet.ts`)
 *   `buildKyosanPreviewParts`     — 갈래별로 줄을 묶고 수량을 붙인다(`report-preview.ts`)
 *   `mergeKyosanPartsForUsedParts`— 갈래를 지우고 수량을 더한다(같은 파일)
 *
 * 🔴 **실제로 틀린 값은 셋이 이어진 끝에서만 보였다.** 그래서 이 파일은 셋을
 * 이어 붙여 **줄 수와 수량 합**을 못 박는다 — 가운데 한 모듈의 기대값만 고치고
 * 끝에서 값이 새는 일이 다시 일어나지 않게.
 *
 * ── 실측 (2026-10-29, 운영 연락서 한 장) ───────────────────────────────
 * 사용자가 실물 `交換部品詳細` 탭(판본 C)과 그 장이 만든 사용 부품 칸을 나란히
 * 열어 보여 주었다. 시트에는 **10줄 · 수량 합 12** 가 적혀 있는데 들어간 것은
 * **6줄 · 수량 합 11** 이었다. 두 가지가 겹쳐 있었다:
 *
 *  1. 이름을 `部品名 / 型式`(B열, **사람이 읽는 설명**)에서 집었다. 품번은
 *     `仕様書番号 / 型式`(D열)에 있다.
 *  2. B열 설명이 같고 D열 품번이 **다른 두 줄**이 한 줄로 뭉개지면서 뒤 줄의
 *     수량이 **사라졌다**(더해지지 않고 버려졌다).
 *
 * 🔴 **값은 전부 지어낸 가짜다.** 실물의 품번·고객사·L/N·S/N·접수번호는 한
 * 글자도 넣지 않는다 — 이 저장소는 공개 저장소다. 베낀 것은 **양식의 글자**
 * (머리글 이름 · `状況` 의 보기)와 **줄의 짜임**(어느 칸이 비었고 어느 품번이
 * 몇 줄에 걸쳐 있는가)뿐이다.
 * ============================================================================
 */

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * `{ "B17": "값-부품A" }` → 격자. 숫자를 주면 숫자 칸이 된다.
 * 🔵 이 저장소의 시트 판독 시험들은 저마다 이 작은 XML 조립기를 하나씩 들고
 * 있다(`card-grid.test.ts` · `card-fields.test.ts` · `report-marks.test.ts` ·
 * `estimated-repair-block.test.ts` · `parts-detail-sheet.test.ts`). 하는 일이
 * 없는 조립기라 따라 적는다 — 집의 방식을 바꾸는 것은 이 조각의 일이 아니다.
 */
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

/** 판본 C 의 머리글 줄(16행) — 실측 배치 그대로. */
const HEADER_C_16 = {
  B16: "部品名 / 型式",
  D16: "仕様書番号 / 型式",
  G16: "数量",
  H16: "状況",
} as const;

/**
 * 🔴 **실물 한 장의 짜임 그대로**(값만 가짜). ①…⑩ 은 사용자가 보여 준 표의
 * 줄 번호다. 네째 줄은 **B열이 비고 D열에만 적힌 줄**이고, ⑥⑦ 은 **B열 설명이
 * 같은데 D열 품번이 다른** 두 줄이다 — 이 둘이 운영에서 한 줄로 뭉개졌다.
 */
const REAL_SHAPE_SHEET: Record<string, string | number> = {
  ...HEADER_C_16,
  // ① 故障・修理 · 1개
  A17: "①",
  B17: "값-종단앰프기판",
  D17: "AA000111",
  G17: 1,
  H17: "故障・修理",
  // ② 故障・修理 · 1개
  A18: "②",
  B18: "값-종단앰프콘덴서기판",
  D18: "AA000222",
  G18: 1,
  H18: "故障・修理",
  // ③ 故障・修理 · 2개
  A19: "③",
  B19: "값-종단앰프입력휴즈",
  D19: "AA000333",
  G19: 2,
  H19: "故障・修理",
  // ④ 🔴 B열이 비었다 — D열에만 적힌 줄이다(실측에 있는 꼴).
  A20: "④",
  D20: "값-누름쇠",
  G20: 1,
  H20: "故障・修理",
  // ⑤ 故障・修理 · 1개
  A21: "⑤",
  B21: "값-종단앰프게이트기판",
  D21: "AA000444",
  G21: 1,
  H21: "故障・修理",
  // ⑥⑦ 🔴 B열 설명이 **같고** D열 품번이 **다르다** — 별개 부품 둘이다.
  A22: "⑥",
  B22: "값-종단앰프RF트랜스",
  D22: "AA000555",
  G22: 1,
  H22: "故障・修理",
  A23: "⑦",
  B23: "값-종단앰프RF트랜스",
  D23: "AA000666",
  G23: 1,
  H23: "故障・修理",
  // ⑧ 予防措置 · 1개 — ② 와 같은 품번이다.
  A24: "⑧",
  B24: "값-종단앰프콘덴서기판",
  D24: "AA000222",
  G24: 1,
  H24: "予防措置",
  // ⑨ 予防措置 · 2개 — ① 과 같은 품번이다.
  A25: "⑨",
  B25: "값-종단앰프기판",
  D25: "AA000111",
  G25: 2,
  H25: "予防措置",
  // ⑩ 予防措置 · 1개 — ⑤ 와 같은 품번이다.
  A26: "⑩",
  B26: "값-종단앰프게이트기판",
  D26: "AA000444",
  G26: 1,
  H26: "予防措置",
};

function cardOf(lists: Partial<Record<CardListKey, string[]>> = {}): CardFields {
  const fieldMap = {} as Record<CardFieldKey, CardFieldValue>;
  for (const spec of CARD_FIELDS) {
    fieldMap[spec.key] = { value: null, labelAddress: null, valueAddress: null };
  }
  const listMap = {} as Record<CardListKey, CardListValue>;
  for (const spec of CARD_LISTS) {
    const values = lists[spec.key] ?? [];
    listMap[spec.key] = { values, labelCount: values.length, usedLegacy: false };
  }
  return { fields: fieldMap, lists: listMap };
}

/**
 * 시트 하나를 읽어 미리보기까지 갈 수 있는 가장 작은 연락서.
 * 🔴 `estimatedRepair` 를 **리터럴에 적는다** — null 이어야 `交換部品詳細` 쪽
 * 길이 돌고, 옵셔널로 두면 이 시험이 엉뚱한 출처를 재게 된다.
 */
function reportFromSheet(
  cells: Record<string, string | number>,
  lists: Partial<Record<CardListKey, string[]>> = {}
): KyosanReport {
  return {
    formFamily: "card",
    cardSheetName: "Card",
    repairReportSheetName: null,
    sheetNames: ["Card", "交換部品詳細"],
    sourceSha256: "7".repeat(64),
    card: cardOf(lists),
    cause: { sectionAddress: null, options: [], marked: [] },
    action: { sectionAddress: null, options: [], marked: [] },
    detailParts: readPartsDetailSheet(gridOf(cells), "交換部品詳細"),
    estimatedRepair: null,
    photos: [],
    problems: [],
  };
}

/** 사용 부품 칸에 들어갈 수량의 합. 「줄이 줄었나」만 보면 새는 수량을 못 본다. */
function totalQuantity(lines: readonly { quantity: number }[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

describe("판본 C 실물 한 장 — 시트 칸 → 사용 부품 칸", () => {
  /**
   * 🔴 **D열(`仕様書番号 / 型式`)이 품번이다.** 2026-10-28 까지 이 판본만 B열
   * (`部品名 / 型式`)을 먼저 보고 있었고, 그래서 운영에 **설명 글자**가 들어갔다.
   * 네째 줄(B열이 빈 줄)도 **같은 차례로 그대로 집힌다** — D열을 먼저 보니까.
   */
  test("🔴 이름은 D열(`仕様書番号 / 型式`)에서 온다 — B열은 사람이 읽는 설명이다", () => {
    const parts = readPartsDetailSheet(gridOf(REAL_SHAPE_SHEET), "交換部品詳細");
    assert.deepEqual(
      parts.map((part) => [part.name, part.partName, part.address]),
      [
        ["AA000111", "값-종단앰프기판", "D17"],
        ["AA000222", "값-종단앰프콘덴서기판", "D18"],
        ["AA000333", "값-종단앰프입력휴즈", "D19"],
        // 🔴 B열이 빈 줄 — 예전 차례에서도 여기로 떨어졌고 지금도 같다.
        ["값-누름쇠", null, "D20"],
        ["AA000444", "값-종단앰프게이트기판", "D21"],
        ["AA000555", "값-종단앰프RF트랜스", "D22"],
        ["AA000666", "값-종단앰프RF트랜스", "D23"],
        ["AA000222", "값-종단앰프콘덴서기판", "D24"],
        ["AA000111", "값-종단앰프기판", "D25"],
        ["AA000444", "값-종단앰프게이트기판", "D26"],
      ]
    );
  });

  /** 시트에 적힌 것이 10줄·합 12 라는 사실 자체를 먼저 못 박는다(표본이 비면 아래가 공짜로 통과한다). */
  test("🔴 시트에 적힌 것은 10줄 · 수량 합 12 다", () => {
    const parts = readPartsDetailSheet(gridOf(REAL_SHAPE_SHEET), "交換部品詳細");
    assert.equal(parts.length, 10);
    assert.equal(
      parts.reduce((sum, part) => sum + (part.quantity ?? 1), 0),
      12
    );
    assert.deepEqual(
      parts.map((part) => part.kind),
      ["fault", "fault", "fault", "fault", "fault", "fault", "fault", "preventive", "preventive", "preventive"]
    );
  });

  /**
   * 🔴 **미리보기에서 10줄이 그대로 남아야 한다.** ⑥⑦ 은 품번이 달라 안 묶이고,
   * ①⑨·②⑧·⑤⑩ 은 품번은 같지만 **갈래가 달라** 두 줄로 남는다(고장분·예방분을
   * 가르는 것이 미리보기의 일이다 — `report-preview.ts` 의 「겹침 열쇠에 갈래가
   * 들어간다」).
   */
  test("🔴 미리보기는 10줄 — 품번이 다르면(⑥⑦) 설명이 같아도 안 묶인다", () => {
    assert.deepEqual(buildKyosanPreviewParts(reportFromSheet(REAL_SHAPE_SHEET)), [
      { kind: "fault", text: "AA000111", quantity: 1 },
      { kind: "fault", text: "AA000222", quantity: 1 },
      { kind: "fault", text: "AA000333", quantity: 2 },
      { kind: "fault", text: "값-누름쇠", quantity: 1 },
      { kind: "fault", text: "AA000444", quantity: 1 },
      { kind: "fault", text: "AA000555", quantity: 1 },
      { kind: "fault", text: "AA000666", quantity: 1 },
      { kind: "preventive", text: "AA000222", quantity: 1 },
      { kind: "preventive", text: "AA000111", quantity: 2 },
      { kind: "preventive", text: "AA000444", quantity: 1 },
    ]);
  });

  /**
   * 🔴 **사용 부품 칸은 7줄 · 수량 합 12.** 운영에서 본 것은 6줄 · 합 11 이었다 —
   * 줄 하나와 수량 하나가 함께 사라졌고, 둘 다 ⑥⑦ 에서 났다.
   * 🔵 수량 합이 12 인 것이 요점이다. 갈래를 지우고 묶는 자리는 **수량을 더하므로**
   * 줄은 줄어도 합은 시트에 적힌 수 그대로여야 한다.
   */
  test("🔴 사용 부품 칸은 7줄 · 수량 합 12 — 시트에 적힌 합과 같다", () => {
    const lines = mergeKyosanPartsForUsedParts(
      buildKyosanPreviewParts(reportFromSheet(REAL_SHAPE_SHEET))
    );
    assert.deepEqual(lines, [
      // ① + ⑨ — 갈래가 달라 미리보기에서는 두 줄이고, 여기서 더해진다.
      { text: "AA000111", quantity: 3 },
      // ② + ⑧
      { text: "AA000222", quantity: 2 },
      { text: "AA000333", quantity: 2 },
      { text: "값-누름쇠", quantity: 1 },
      // ⑤ + ⑩
      { text: "AA000444", quantity: 2 },
      // 🔴 ⑥ 과 ⑦ — **두 줄로 남는다.** 뭉개지면 여기가 한 줄 · 수량 1 이 된다.
      { text: "AA000555", quantity: 1 },
      { text: "AA000666", quantity: 1 },
    ]);
    assert.equal(totalQuantity(lines), 12);
  });

  /**
   * 🔴 **같은 갈래에서 같은 품번이 두 줄이면 수량을 더한다** (2026-10-29).
   * 위의 한 장에는 이 꼴이 없다(같은 품번끼리는 갈래가 갈려 있다). 그런데 실측에
   * 분명히 있는 꼴이다 — `report-preview.ts` 가 「`予防③`·`予防⑩` 두 줄」을 실측
   * 예로 적고 있다. 그 자리에서 **뒤 줄의 수량이 버려지고 있었다**: 줄을 하나로
   * 묶는 것은 맞지만(화면이 `${kind}-${text}` 를 React 열쇠로 쓴다), 수량까지
   * 첫 줄 것만 쓰면 적힌 수가 조용히 사라진다.
   *
   * 🔵 차례를 고쳐 이름이 품번이 된 뒤로 이 꼴은 **정말로 같은 부품 두 줄**이다 —
   * 더하는 것 말고 다른 답이 없다.
   */
  test("🔴 같은 갈래·같은 품번이 두 줄이면 한 줄로 묶되 수량을 **더한다**", () => {
    const report = reportFromSheet({
      ...HEADER_C_16,
      B17: "값-종단앰프게이트기판",
      D17: "AA000777",
      G17: 1,
      H17: "予防措置",
      B18: "값-종단앰프게이트기판",
      D18: "AA000777",
      G18: 2,
      H18: "予防措置",
    });
    // 미리보기에서 이미 한 줄이고 수량이 3 이다 — 더하는 자리가 여기다.
    assert.deepEqual(buildKyosanPreviewParts(report), [
      { kind: "preventive", text: "AA000777", quantity: 3 },
    ]);
    assert.deepEqual(mergeKyosanPartsForUsedParts(buildKyosanPreviewParts(report)), [
      { text: "AA000777", quantity: 3 },
    ]);
  });

  /**
   * 🔵 수량이 **안 적힌 줄**이 섞여도 더하는 쪽이 1로 센다 — 넣는 쪽의 `?? 1` 과
   * 같은 규칙이다(`kyosan-report-import.ts` 의 `replaceUsedParts`). 더하기를
   * 넣으면서 이 자리가 `undefined + 2` 가 되지 않는지 못 박는다.
   */
  test("🔴 수량이 안 적힌 줄과 적힌 줄이 만나면 1로 세어 더한다", () => {
    const report = reportFromSheet({
      ...HEADER_C_16,
      B17: "값-설명",
      D17: "AA000888",
      H17: "故障・修理",
      B18: "값-설명",
      D18: "AA000888",
      G18: 2,
      H18: "故障・修理",
    });
    assert.deepEqual(buildKyosanPreviewParts(report), [
      { kind: "fault", text: "AA000888", quantity: 3 },
    ]);
  });

  /**
   * 🔴 **둘 다 안 적힌 줄은 2 다** — 2026-10-29 에 함께 바뀐 자리라 값으로 적어
   * 둔다. 예전에는 수량이 null 인 줄을 아예 안 보았으므로 열쇠가 비었고, 넣는
   * 쪽이 **1** 로 셌다. 지금은 **줄마다 1** 로 세어 더하므로 2 다.
   *
   * 🔵 **한 줄뿐일 때는 그대로 열쇠가 비어 있다**(바로 아래 단언) — 그때만
   * 「수량이 안 적힌 한 줄」이고, 넣는 쪽의 `?? 1` 이 그 줄을 1 로 센다.
   * 두 규칙이 어긋나지 않는다: 어느 쪽이든 **줄 하나가 1 개**다.
   */
  test("🔴 수량이 둘 다 안 적힌 두 줄은 2 다 — 한 줄뿐이면 열쇠가 그대로 비어 있다", () => {
    const twoRows = reportFromSheet({
      ...HEADER_C_16,
      B17: "값-설명",
      D17: "AA000999",
      H17: "故障・修理",
      B18: "값-설명",
      D18: "AA000999",
      H18: "故障・修理",
    });
    assert.deepEqual(buildKyosanPreviewParts(twoRows), [
      { kind: "fault", text: "AA000999", quantity: 2 },
    ]);

    const oneRow = reportFromSheet({
      ...HEADER_C_16,
      B17: "값-설명",
      D17: "AA000999",
      H17: "故障・修理",
    });
    assert.deepEqual(buildKyosanPreviewParts(oneRow), [{ kind: "fault", text: "AA000999" }]);
  });

  /**
   * 🔴 **차례를 고쳐도 판본 A·B 는 한 글자도 안 바뀐다.** 바뀐 것은 겹뜻 칸
   * `仕様書番号 / 型式`(`specCombined`)을 `部品名` 앞으로 올린 것 하나이고, 그
   * 칸은 **판본 C 에만 있다.** 판본 A·B 는 `型式`(`model`) · `仕様書番号`(`spec`)
   * 라는 홑뜻 칸을 쓰고 그 둘은 예전부터 1·2 순위였다.
   *
   * 🔵 「없으니까 안 바뀐다」를 말로 두지 않고 **값으로** 둔다 — 판본 A 한 줄과
   * 판본 B 한 줄을 실제로 읽어 이름이 품번 칸에서 오는 것을 다시 못 박는다.
   * (`parts-detail-sheet.test.ts` 가 같은 것을 판본별로 더 넓게 본다. 여기서는
   * **차례를 고친 날 깨지는지**만 본다.)
   */
  test("🔴 판본 A·B 에는 겹뜻 칸이 없다 — 차례를 고쳐도 이름이 그대로다", () => {
    const versionA = gridOf({
      B7: "措置",
      C7: "部品名",
      D7: "型式",
      E7: "仕様書番号",
      H7: "数量",
      I7: "対象",
      B8: "故障①",
      C8: "값-부품설명A",
      D8: "ZX-1000-A",
      E8: "ZY-2000-A",
      H8: 1,
    });
    assert.deepEqual(
      readPartsDetailSheet(versionA, "交換部品詳細(RF)").map((part) => [part.name, part.address]),
      [["ZX-1000-A", "D8"]]
    );

    const versionB = gridOf({
      A7: "UNIT",
      B7: "措置",
      C7: "部品名",
      E7: "型式",
      G7: "仕様書番号",
      I7: "数量",
      J7: "状況",
      B8: "故障①",
      C8: "값-부품설명B",
      G8: "ZY-2000-B",
      I8: 1,
    });
    assert.deepEqual(
      readPartsDetailSheet(versionB, "交換部品詳細").map((part) => [part.name, part.address]),
      [["ZY-2000-B", "G8"]]
    );
  });
});
