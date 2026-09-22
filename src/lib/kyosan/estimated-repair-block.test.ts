import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSheetGrid } from "../xlsx/sheet-grid";
import {
  estimatedHeadingGroup,
  estimatedHeadingMood,
  isEstimatedRepairSheetName,
  pickEstimatedRepairSheetNames,
  readEstimatedQuantity,
  readEstimatedRepairBlock,
  splitEstimatedItemLine,
} from "./estimated-repair-block";

/**
 * ============================================================================
 * 🔴 시험용 연락서는 전부 **손으로 지은 가짜**다
 * ============================================================================
 * 실제 연락서에는 고객명·모델·S/N 이 그대로 들어 있다. 그래서 **양식의 글자**
 * (구역 라벨 · 머리글 문장 · 단위)만 실측에서 가져오고, 부품 이름 자리에는
 * `값-부품A` 를 넣는다. 이름 뽑기 규칙은 `の交換`·구분자·수량 단위만 보므로
 * 이름이 한국어 자리표여도 규칙이 그대로 시험된다.
 *
 * 🔴 예외가 하나 있다 — 「표기 변이」 시험(`스プリッタ` 세 표기)은 **그 글자
 * 자체가 시험 대상**이라 실측 글자를 쓴다. 그 세 글자는 이미
 * `report-preview.ts` 의 머리말에 적혀 있는 것이고, 부품 이름이라 고객 정보가
 * 아니다.
 * ============================================================================
 */

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `{ "A130": "推定修理内容" }` → 격자. */
function gridOf(cells: Record<string, string>) {
  const byRow = new Map<number, { column: string; xml: string }[]>();
  for (const [address, value] of Object.entries(cells)) {
    const matched = /^([A-Z]+)(\d+)$/.exec(address);
    assert.ok(matched, `칸 주소가 아니다: ${address}`);
    const row = Number(matched[2]);
    const xml = `<c r="${address}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
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

const SHEET = "進捗状況連絡書";

/** 실측 머리글 문장들 — 양식의 글자다. */
const REPAIR_HEADING = "修理として以下の作業をお勧めます。";
const PREVENTIVE_HEADING = "予防交換として以下の作業をお勧めます。";
const OVERHAUL_RECOMMEND_HEADING = "O/Hとして以下の作業を推奨致します。";
const OVERHAUL_WILL_HEADING = "O/Hとして以下の作業を実施します。";
const OVERHAUL_DID_HEADING = "OHとして以下の作業を行いました。";

function blockOf(lines: Record<string, string>, tail: Record<string, string> = {}) {
  return readEstimatedRepairBlock(gridOf({ A10: "推定修理内容", ...lines, ...tail }), SHEET);
}

describe("推定修理内容 — 시트 고르기", () => {
  test("두 갈래 시트 이름을 모두 알아본다(실측: 247장 · 222장)", () => {
    assert.equal(isEstimatedRepairSheetName("進捗状況連絡書"), true);
    assert.equal(isEstimatedRepairSheetName("Progress_Information"), true);
    assert.equal(isEstimatedRepairSheetName("progress_information"), true);
  });

  test("남의 시트를 집지 않는다", () => {
    assert.equal(isEstimatedRepairSheetName("Repair_Record"), false);
    assert.equal(isEstimatedRepairSheetName("交換部品詳細(RF)"), false);
    // 🔴 앞머리 일치가 아니다 — 비슷한 이름의 딴 시트를 집으면 엉뚱한 부품이 온다.
    assert.equal(isEstimatedRepairSheetName("進捗状況連絡書_旧"), false);
  });

  test("적힌 차례 그대로 고른다", () => {
    assert.deepEqual(
      pickEstimatedRepairSheetNames(["Card", "Progress_Information", "Rev", "進捗状況連絡書"]),
      ["Progress_Information", "進捗状況連絡書"]
    );
  });

  test("라벨이 없으면 null — 던지지 않는다", () => {
    assert.equal(readEstimatedRepairBlock(gridOf({ A1: "修理進捗状況連絡書" }), SHEET), null);
  });
});

describe("推定修理内容 — 블록의 끝", () => {
  test("🔴 `処置内容` 에서 끊는다 — 뒤 구역의 줄이 새어 들어오지 않는다", () => {
    const block = blockOf(
      {
        A11: REPAIR_HEADING,
        A12: "・값-부품Aの交換…3枚",
      },
      {
        A20: "処置内容",
        A21: "・값-처치줄の交換…9枚",
        A30: "必須事項",
        A31: "・값-필수줄の交換…9枚",
      }
    );
    assert.ok(block);
    assert.equal(block.endAddress, "A20");
    assert.deepEqual(
      block.parts.map((part) => [part.name, part.quantity]),
      [["값-부품A", 3]]
    );
  });

  test("🔴 `必須事項` 이 먼저 오는 장에서도 끊는다 — 실측 469장 중 326장이 이 꼴이다", () => {
    // 지시서는 「끝은 `処置内容` 이다」라고 적었지만, `処置内容` 이 없는 장이
    // 326장이다. `処置内容` 만 보면 그 장들에서 블록이 시트 끝까지 흘러
    // 필수사항 점검표를 통째로 삼킨다.
    const block = blockOf(
      {
        A11: REPAIR_HEADING,
        A12: "・값-부품Aの交換…3枚",
      },
      {
        A20: "必須事項",
        A21: "・값-필수줄の交換…9枚",
        A25: "客先希望納期",
      }
    );
    assert.ok(block);
    assert.equal(block.endAddress, "A20");
    assert.deepEqual(block.parts.map((part) => part.name), ["값-부품A"]);
  });

  test("`客先希望納期` 도 끝이 된다", () => {
    const block = blockOf({ A11: REPAIR_HEADING, A12: "・값-부품Aの交換…1個" }, { A20: "客先希望納期" });
    assert.ok(block);
    assert.equal(block.endAddress, "A20");
  });

  test("끝 라벨이 없으면 시트 끝까지 읽는다", () => {
    const block = blockOf({ A11: REPAIR_HEADING, A12: "・값-부품Aの交換…1個" });
    assert.ok(block);
    assert.equal(block.endAddress, null);
    assert.equal(block.parts.length, 1);
  });
});

describe("推定修理内容 — 줄 쪼개기", () => {
  test("⚠️ 한 칸 안의 `\\r\\n` 을 쪼갠다", () => {
    const block = blockOf({
      A11: `${REPAIR_HEADING}\r\n・값-부품Aの交換…3枚\r\n・값-부품Bの交換…2個`,
    });
    assert.ok(block);
    assert.deepEqual(
      block.parts.map((part) => [part.name, part.quantity, part.address]),
      [
        ["값-부품A", 3, "A11"],
        ["값-부품B", 2, "A11"],
      ]
    );
  });

  test("불릿만 있는 줄은 글자로 세지 않는다(실측 455줄)", () => {
    const block = blockOf({ A11: REPAIR_HEADING, A12: "・", A13: "・값-부품Aの交換…1個", A14: "・" });
    assert.ok(block);
    assert.equal(block.parts.length, 1);
  });

  test("A열만 읽는다 — 옆 상자의 글자는 부품이 아니다", () => {
    const block = blockOf({ A11: REPAIR_HEADING, B12: "・값-옆상자の交換…9枚", AI12: "값-날짜" });
    assert.ok(block);
    assert.deepEqual(block.parts, []);
  });
});

describe("推定修理内容 — 이름 뽑기", () => {
  test("`の交換` 앞이 이름이다(실측 1,425줄)", () => {
    assert.deepEqual(splitEstimatedItemLine("값-부품Aの交換…3枚"), {
      name: "값-부품A",
      tail: "…3枚",
    });
  });

  test("`の交換` 이 없으면 구분자 앞 — 가장 왼쪽 구분자에서 가른다(실측 143줄)", () => {
    assert.deepEqual(splitEstimatedItemLine("값-부품A…1個"), { name: "값-부품A", tail: "1個" });
    assert.deepEqual(splitEstimatedItemLine("값-부품A：2個"), { name: "값-부품A", tail: "2個" });
    assert.deepEqual(splitEstimatedItemLine("값-부품A...4枚"), { name: "값-부품A", tail: "4枚" });
    assert.deepEqual(splitEstimatedItemLine("값-부품A･･･1個"), { name: "값-부품A", tail: "1個" });
  });

  test("`交換` 이 딴 자리에 있으면 그 앞이 이름이다(실측 2줄)", () => {
    assert.deepEqual(splitEstimatedItemLine("값-부품Aを交換1枚"), { name: "값-부품Aを", tail: "1枚" });
  });

  /**
   * 🔴 **네 번째 갈래** — 「이름 + `の` + 수 + 단위」. 앞의 세 갈래가 모두 못
   * 잡는 꼴이라 마지막에 둔다. 실측으로 걸리는 줄이 **3줄**이고 전부 진짜
   * 부품이다(수량 11개분). 여기 쓰는 글자는 **실측 글자 그대로**다 — 자리표로
   * 바꾸면 이 갈래가 무엇을 잡는지 시험이 못 말한다.
   */
  test("🔴 `の交換`도 구분자도 `交換`도 없으면 「수 + 단위」 앞의 `の` 에서 가른다", () => {
    assert.deepEqual(splitEstimatedItemLine("終段AMPコンデンサ基板の1枚（右側内4）"), {
      name: "終段AMPコンデンサ基板",
      tail: "1枚（右側内4）",
    });
    assert.deepEqual(
      splitEstimatedItemLine("終段AMPコンデンサ基板の9枚（右側内1，2，3，5、左側外1，2，3，4，5）"),
      { name: "終段AMPコンデンサ基板", tail: "9枚（右側内1，2，3，5、左側外1，2，3，4，5）" }
    );
  });

  test("🔴 **오른쪽부터** 찾는다 — 이름 안의 `の` 에서 깎이지 않는다", () => {
    // 왼쪽부터 찾으면 이름이 `フィルターボックス` 로 깎인다.
    assert.deepEqual(splitEstimatedItemLine("フィルターボックスのVFCの1個"), {
      name: "フィルターボックスのVFC",
      tail: "1個",
    });
  });

  test("전각 수량도 이 갈래로 잡힌다", () => {
    assert.deepEqual(splitEstimatedItemLine("값-부품Aの１個"), { name: "값-부품A", tail: "１個" });
  });

  /**
   * 🔴 **부품이 아닌 2줄이 새 갈래에 걸리면 안 된다.** 막는 것은 「`の` 다음이
   * **곧 수량**이어야 한다」는 조건이다 — `の` 가 있다는 것만으로는 안 된다.
   * 실측 글자 그대로 못 박는다.
   */
  test("🔴 가를 자리가 없으면 null — 새 갈래가 부품 아닌 줄을 잡지 않는다", () => {
    // `の` 는 있지만 뒤가 `ため` 다 — 수도 단위도 없다.
    assert.equal(splitEstimatedItemLine("REV148->148Bのため"), null);
    // `の` 가 아예 없다.
    assert.equal(
      splitEstimatedItemLine("WR10775AA321D→故障基板、予防措置基板にRev.Fにする。"),
      null
    );
  });

  test("🔴 앞 갈래가 잡을 수 있는 줄을 새 갈래가 가로채지 않는다", () => {
    // `の交換` 이 있으면 그쪽이 먼저다 — `の` 가 이름 안에 있어도 이름이 온전하다.
    assert.deepEqual(splitEstimatedItemLine("フィルターボックスのVFCの交換…1個"), {
      name: "フィルターボックスのVFC",
      tail: "…1個",
    });
  });

  test("🔴 괄호를 떼지 않는다 — 이름의 일부다", () => {
    const block = blockOf({
      A11: REPAIR_HEADING,
      A12: "・값-콘덴서(S-CONT 基板用)の交換…1個(YE335)",
      A13: "・값-콘덴서(스너버)の交換…6個 (SC26P12233KP)",
    });
    assert.ok(block);
    // 무조건 떼면 이 둘이 **한 이름으로 뭉친다** — 서로 다른 부품이다.
    assert.deepEqual(block.parts.map((part) => part.name), [
      "값-콘덴서(S-CONT 基板用)",
      "값-콘덴서(스너버)",
    ]);
  });

  test("앞의 불릿을 뗀다", () => {
    const block = blockOf({
      A11: REPAIR_HEADING,
      A12: "・값-부품Aの交換…1個",
      A13: "･값-부품Bの交換…1個",
      A14: "●값-부품Cの交換…1個",
      A15: "※값-부품Dの交換…1個",
      A16: "-값-부품Eの交換…1個",
    });
    assert.ok(block);
    assert.deepEqual(block.parts.map((part) => part.name), [
      "값-부품A",
      "값-부품B",
      "값-부품C",
      "값-부품D",
      "값-부품E",
    ]);
  });
});

describe("推定修理内容 — 수량", () => {
  test("단위 여덟 가지와 `m`", () => {
    for (const [tail, want] of [
      ["…1個", 1],
      ["…2枚", 2],
      ["…3本", 3],
      ["…4台", 4],
      ["…5式", 5],
      ["…6組", 6],
      ["…7セット", 7],
      ["…8箇所", 8],
      ["…9m", 9],
    ] as const) {
      assert.equal(readEstimatedQuantity(tail), want, tail);
    }
  });

  test("🔴 전각 숫자와 한자 숫자를 푼다", () => {
    assert.equal(readEstimatedQuantity("…６個"), 6);
    assert.equal(readEstimatedQuantity("：１個"), 1);
    assert.equal(readEstimatedQuantity("…三枚"), 3);
    assert.equal(readEstimatedQuantity("…十枚"), 10);
    assert.equal(readEstimatedQuantity("…十二枚"), 12);
    assert.equal(readEstimatedQuantity("…二十枚"), 20);
  });

  test("🔴 줄 끝 괄호의 위치·형식번호를 수량으로 읽지 않는다", () => {
    // 가장 왼쪽 짝을 잡으므로 뒤에 붙은 위치(`右側内4，5`)와 형식번호가 안 걸린다.
    assert.equal(readEstimatedQuantity("…6個(右側内4，5，右側外5)"), 6);
    assert.equal(readEstimatedQuantity("…1枚 (ZWS240BP-48)"), 1);
    // 🔴 `m` 뒤에 영숫자가 오면 형식번호다.
    assert.equal(readEstimatedQuantity("(9G1248G1D01-C / C230930211)"), null);
  });

  test("⚠️ 구분자가 깨진 줄은 수량 없음으로 둔다 — 억지로 맞추지 않는다", () => {
    assert.equal(readEstimatedQuantity("..4.枚"), null);
  });

  test("수량이 없는 줄은 null — 부르는 쪽이 1로 센다(실측 25줄)", () => {
    const block = blockOf({ A11: REPAIR_HEADING, A12: "・값-호스の交換" });
    assert.ok(block);
    assert.deepEqual(
      block.parts.map((part) => [part.name, part.quantity]),
      [["값-호스", null]]
    );
  });
});

describe("推定修理内容 — 부품이 아닌 줄", () => {
  test("낱말 걸개로 버린다(실측 78줄)", () => {
    const block = blockOf({
      A11: REPAIR_HEADING,
      A12: "型式の変更 変更前：값-형식1、変更後：값-형식2",
      A13: "VPP、VDC値の再調整",
      A14: "값-판금の清掃",
      A15: "값-파라Cの改造作業",
      A16: "값-기판の故障確認",
      A17: "・값-부품Aの交換…1個",
    });
    assert.ok(block);
    assert.deepEqual(block.parts.map((part) => part.name), ["값-부품A"]);
  });

  test("🔴 `〜の取り付け：N枚` 도 버린다 — 수량이 붙어 있어도 그대로 버린다(실측 13줄)", () => {
    const block = blockOf({ A11: REPAIR_HEADING, A12: "・값-판금の取り付け：１枚" });
    assert.ok(block);
    assert.deepEqual(block.parts, []);
  });

  test("⚠️ 수량이 없어도 부품인 줄은 남는다 — 걸개에 안 걸린다", () => {
    const block = blockOf({ A11: REPAIR_HEADING, A12: "・값-내부호스の交換" });
    assert.ok(block);
    assert.equal(block.parts.length, 1);
  });
});

describe("推定修理内容 — 갈래와 서법", () => {
  test("머리글의 갈래", () => {
    assert.equal(estimatedHeadingGroup(REPAIR_HEADING), "fault");
    assert.equal(estimatedHeadingGroup("追加修理として以下の作業をお勧めます。"), "fault");
    assert.equal(estimatedHeadingGroup(PREVENTIVE_HEADING), "preventive");
    assert.equal(estimatedHeadingGroup("予防として以下の作業を推奨致します。"), "preventive");
    // 🔴 `として` 앞을 보는 규칙으로는 못 잡는 꼴이다.
    assert.equal(
      estimatedHeadingGroup("客先依頼の通り以下の予防交換作業を実施します。"),
      "preventive"
    );
    assert.equal(estimatedHeadingGroup(OVERHAUL_RECOMMEND_HEADING), "overhaul");
    assert.equal(estimatedHeadingGroup("OHとして以下の作業をお勧めます。"), "overhaul");
    assert.equal(estimatedHeadingGroup("O/H交換として以下の部品交換お勧めます。"), "overhaul");
    assert.equal(estimatedHeadingGroup("O/H/として以下の作業を推奨します。"), "overhaul");
    assert.equal(estimatedHeadingGroup("オーバーホールとして以下の作業を推奨します。"), "overhaul");
    // 🔴 그 밖은 고장분이다(`として` 앞이 무엇이든).
    assert.equal(estimatedHeadingGroup("REV変更として以下の作業をお勧めます。"), "fault");
    assert.equal(estimatedHeadingGroup("客先対応にて下記の作業をお勧めます。"), "fault");
    assert.equal(estimatedHeadingGroup("電流強化対策として以下の作業を実施します。"), "fault");
  });

  test("🔴 서법은 **동사**로 가른다 — 꼬리로 가르면 `お勧めました` 가 「했다」가 된다", () => {
    assert.equal(estimatedHeadingMood("修理として以下の作業をお勧めました。"), "recommend");
    assert.equal(estimatedHeadingMood(REPAIR_HEADING), "recommend");
    assert.equal(estimatedHeadingMood("修理として以下の作業をおすすめます。"), "recommend");
    assert.equal(estimatedHeadingMood("修理として以下の項目をお進めます。"), "recommend");
    assert.equal(estimatedHeadingMood("改善変更として以下の作業を押すすえっます。"), "recommend");
    assert.equal(estimatedHeadingMood("O/Hとして以下の作業を推奨します。"), "recommend");
    assert.equal(estimatedHeadingMood("修理として以下の作業を行いました。"), "did");
    assert.equal(estimatedHeadingMood("修理として以下の作業を実施しました。"), "did");
    assert.equal(estimatedHeadingMood("修理として以下の作業を実施します。"), "will");
    assert.equal(estimatedHeadingMood("修理として以下の作業を実施致します。"), "will");
    assert.equal(estimatedHeadingMood("依頼要請として以下の作業を実施予定です。"), "will");
  });

  test("머리글 없는 줄은 고장분이다(실측: 머리글이 하나도 없는 장 30 · 항목 줄 40)", () => {
    const block = blockOf({ A11: "・값-부품Aの交換…1個" });
    assert.ok(block);
    assert.deepEqual(
      block.parts.map((part) => [part.kind, part.group, part.mood]),
      [["fault", "fault", "will"]]
    );
  });

  test("머리글이 아래 줄들의 갈래를 정한다", () => {
    const block = blockOf({
      A11: REPAIR_HEADING,
      A12: "・값-부품Aの交換…3枚",
      A14: PREVENTIVE_HEADING,
      A15: "・값-부품Bの交換…7枚",
    });
    assert.ok(block);
    assert.deepEqual(
      block.parts.map((part) => [part.name, part.kind]),
      [
        ["값-부품A", "fault"],
        ["값-부품B", "preventive"],
      ]
    );
  });
});

describe("推定修理内容 — 🔴 O/H 권유는 수량에 넣지 않는다", () => {
  test("O/H + 권한다 → 부품 줄에서 빠지고 **원문**이 남는다", () => {
    const block = blockOf({
      A11: REPAIR_HEADING,
      A12: "・값-부품Aの交換…3枚",
      A14: OVERHAUL_RECOMMEND_HEADING,
      A15: "・값-부품Bの交換…7枚",
      A16: "・값-부품Cの交換…2個",
    });
    assert.ok(block);
    // 수량에는 고장분 3枚 하나만 남는다(청구 금액에 닿는 자리다).
    assert.deepEqual(
      block.parts.map((part) => [part.name, part.kind, part.quantity]),
      [["값-부품A", "fault", 3]]
    );
    // 🔴 버리지 않는다 — 머리글과 항목 줄의 **원문 그대로**를 들고 나간다.
    assert.deepEqual(block.overhaulRecommendations, [
      OVERHAUL_RECOMMEND_HEADING,
      "・값-부품Bの交換…7枚",
      "・값-부품Cの交換…2個",
    ]);
  });

  test("O/H 의 「한다」는 예방분 부품으로 남는다(실측 37줄)", () => {
    const block = blockOf({ A11: OVERHAUL_WILL_HEADING, A12: "・값-부품Bの交換…7枚" });
    assert.ok(block);
    assert.deepEqual(
      block.parts.map((part) => [part.name, part.kind, part.group, part.mood, part.quantity]),
      [["값-부품B", "preventive", "overhaul", "will", 7]]
    );
    assert.deepEqual(block.overhaulRecommendations, []);
  });

  test("O/H 의 「했다」도 예방분 부품으로 남는다(실측 13줄)", () => {
    const block = blockOf({ A11: OVERHAUL_DID_HEADING, A12: "・값-부품Bの交換…7枚" });
    assert.ok(block);
    assert.deepEqual(
      block.parts.map((part) => [part.kind, part.group, part.mood]),
      [["preventive", "overhaul", "did"]]
    );
  });

  test("O/H 권유만 있는 장은 부품이 0건이고 원문만 남는다(실측 19장)", () => {
    const block = blockOf({ A11: OVERHAUL_RECOMMEND_HEADING, A12: "・값-부품Bの交換…7枚" });
    assert.ok(block);
    assert.deepEqual(block.parts, []);
    assert.equal(block.overhaulRecommendations.length, 2);
  });

  test("머리글은 버린 줄이 있을 때만 적는다 — 빈 머리글만으로 메모를 만들지 않는다", () => {
    const block = blockOf({ A11: OVERHAUL_RECOMMEND_HEADING, A12: "・" });
    assert.ok(block);
    assert.deepEqual(block.overhaulRecommendations, []);
  });
});

describe("推定修理内容 — 사용자가 짚은 그 이름", () => {
  test("🔴 「이름 + の + 수량」 꼴 3줄도 부품으로 들어간다 — 수량 1 · 1 · 9", () => {
    const block = blockOf({
      A11: REPAIR_HEADING,
      A12: "・フィルターボックスのVFCの1個",
      A13: "・終段AMPコンデンサ基板の1枚（右側内4）",
      A14: "・終段AMPコンデンサ基板の9枚（右側内1，2，3，5、左側外1，2，3，4，5）",
      // 🔴 이 둘은 계속 빠져야 한다.
      A15: "REV148->148Bのため",
      A16: "WR10775AA321D→故障基板、予防措置基板にRev.Fにする。",
    });
    assert.ok(block);
    assert.deepEqual(
      block.parts.map((part) => [part.name, part.quantity]),
      [
        ["フィルターボックスのVFC", 1],
        ["終段AMPコンデンサ基板", 1],
        ["終段AMPコンデンサ基板", 9],
      ]
    );
  });

  test("🔴 대장 이름이 아니라 **사람이 적은 이름**이 나온다", () => {
    // 사용자 지적(2026-09-22): 「`[終段AMPデバイス基板]` 이라고 적혀 있어야 해」.
    // `交換部品詳細` 시트는 이것을 `終段AMP基板（AMP-DEH基板）` 로 적는다.
    const block = blockOf({
      A11: REPAIR_HEADING,
      A12: "・終段AMP入力保護ヒューズの交換…6個(右側内4，5，右側外5)",
      A13: "・終段AMPデバイス基板の交換…3枚(右側内4，5，右側外5)",
    });
    assert.ok(block);
    assert.deepEqual(
      block.parts.map((part) => [part.name, part.quantity]),
      [
        ["終段AMP入力保護ヒューズ", 6],
        ["終段AMPデバイス基板", 3],
      ]
    );
  });
});
