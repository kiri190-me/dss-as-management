import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSheetGrid } from "../xlsx/sheet-grid";
import {
  isKyosanStateOnlyPartName,
  isPartsDetailSheetName,
  pickPartsDetailSheetNames,
  readPartsDetailSheet,
} from "./parts-detail-sheet";

/**
 * ============================================================================
 * 🔴 시험용 연락서는 전부 **손으로 지은 가짜**다
 * ============================================================================
 * 실제 연락서에는 고객명·모델·S/N 이 그대로 들어 있다. 한 장이라도 고정 시험
 * 파일로 넣으면 그 고객 정보가 git 에 영영 남는다. 그래서 **양식의 글자**(머리글
 * 이름 · `措置`·`状況` 의 보기 · 드롭다운 목록 제목)만 실측에서 가져오고, 부품
 * 이름 자리에는 `값-부품A` 를 넣는다.
 *
 * 🔴 다만 **판본별 열 배치와 머리글 줄 번호는 실측값 그대로** 못 박는다 —
 * 그것이 이 판독기가 있는 까닭이고, 세 판본 중 하나만 맞추면 나머지 두 판본의
 * 부품이 조용히 사라진다. 실측(2026-09-22, 연락서 472장 · 이 시트 636장):
 *
 *   A · 334시트 · 머리글 7행
 *       `B=措置 C=部品名 D=型式 E=仕様書番号 H=数量 I=対象 N=部品名リスト`
 *   B · 159시트 · 머리글 7행 + 40행(143시트) 또는 50행(16시트)
 *       `A=UNIT B=措置 C=部品名 E=型式 G=仕様書番号 I=数量 J=状況`
 *   C · 143시트 · 머리글 16행 + 29행 + 42행
 *       `B=部品名 / 型式 D=仕様書番号 / 型式 G=数量 H=状況`
 *
 * ── 🔴 이름은 **품번 칸**에서 온다 (2026-10-28) ────────────────────────
 * 이 묶음의 기대값 여럿이 그날 뒤집혔다. 2026-09-22 부터는 `部品名` 이 이름이고
 * `型式`·`仕様書番号` 는 「형식번호·규격번호」라 버려졌는데, 사용자가 **실물
 * 연락서 두 장을 열어 보여 주었다**:
 *
 *     탭 `交換部品詳細(RF)` · `部品名`=일본어 설명 · `型式`=**빈칸** · `仕様書番号`=**품번**
 *     탭 `交換部品詳細`     · `部品名`=일본어 설명 · `型式`=**품번**  · `仕様書番号`=빈칸
 *
 * 🔴 `部品名` 은 두 장 다 **사람이 읽는 설명**이다. 재고관리 시스템의 부품명과
 * 같은 글자는 **품번**이고 `型式`·`仕様書番号` 가운데 **값이 있는 쪽**에 있다.
 *
 * 🔴 **값은 전부 지어낸 것이다.** 품번 자리에도 **모양만** 베낀 가짜를 넣는다
 * (`ZX-1000-A`·`AA000111` 꼴) — 실물의 품번·고객사·L/N·S/N·접수번호는 한 글자도
 * 넣지 않는다.
 *
 * ── 🔴 판본 C 도 **D열이 품번**이다 (2026-10-29 운영 실측으로 뒤집음) ──
 * 2026-10-28 에는 판본 A·B 만 뒤집고 판본 C 는 그대로 두었다. **그때의 글을
 * 인용해 남긴다**:
 *
 *     「🔴 바뀌는 것은 세 칸이 **홑뜻으로 따로 선** 판본 A·B 다. 판본 C 는 두
 *       칸 다 `型式` 을 품은 겹뜻(`部品名 / 型式` · `仕様書番号 / 型式`)이라
 *       가를 근거가 없고, 사용자가 보여 준 두 장도 판본 C 가 아니었다 —
 *       **차례를 그대로 둔다.**」
 *
 * 🔴 **그렇게 보았으나 실물이 아니었다.** 사용자가 판본 C 인 운영 연락서를
 * 열어 보여 주었고(2026-10-29), B열은 판본 A·B 의 `部品名` 과 똑같은 **설명**,
 * D열이 **품번**이었다. **양식이 안 가를 뿐 실물은 한 가지였다.**
 *
 * 그래서 차례가 **`型式` → `仕様書番号` → `仕様書番号 / 型式` → `部品名`(비상구)**
 * 이고, 이제 **세 판본이 모두 품번 칸을 먼저 본다.** 아래 시험들이 **판본별로
 * 따로** 그것을 못 박는다 — 한 판본만 맞추면 나머지가 조용히 어긋난다.
 * ============================================================================
 */

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `{ "C8": "값-부품A" }` → 격자. 숫자를 주면 숫자 칸이 된다. */
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

/** 판본 A 의 머리글 줄(7행) — 실측 배치 그대로. */
const HEADER_A = {
  B7: "措置",
  C7: "部品名",
  D7: "型式",
  E7: "仕様書番号",
  H7: "数量",
  I7: "対象",
  N7: "部品名リスト",
} as const;

/** 판본 B 의 머리글 줄 — 실측 배치 그대로. 줄 번호만 바꿔 쓴다. */
function headerB(row: number): Record<string, string> {
  return {
    [`A${row}`]: "UNIT",
    [`B${row}`]: "措置",
    [`C${row}`]: "部品名",
    [`E${row}`]: "型式",
    [`G${row}`]: "仕様書番号",
    [`I${row}`]: "数量",
    [`J${row}`]: "状況",
  };
}

/** 판본 C 의 머리글 줄 — 실측 배치 그대로. 16행은 `部品名 / 型式`, 29·42행은 `部品名`. */
function headerC(row: number, combined: boolean): Record<string, string> {
  return {
    [`B${row}`]: combined ? "部品名 / 型式" : "部品名",
    [`D${row}`]: combined ? "仕様書番号 / 型式" : "仕様書番号/型式",
    [`G${row}`]: "数量",
    [`H${row}`]: "状況",
  };
}

describe("交換部品詳細 시트 이름", () => {
  test("실측 세 가지 이름을 모두 알아본다", () => {
    assert.equal(isPartsDetailSheetName("交換部品詳細"), true);
    assert.equal(isPartsDetailSheetName("交換部品詳細(RF)"), true);
    assert.equal(isPartsDetailSheetName("交換部品詳細(DC)"), true);
  });

  test("전각·반각·대소문자를 눌러 견준다", () => {
    assert.equal(isPartsDetailSheetName("交換部品詳細（ＲＦ）"), true);
    assert.equal(isPartsDetailSheetName(" 交換部品詳細 (dc) "), true);
  });

  test("딴 시트는 아니다", () => {
    assert.equal(isPartsDetailSheetName("Card"), false);
    assert.equal(isPartsDetailSheetName("Repair_Report"), false);
    assert.equal(isPartsDetailSheetName("交換部品"), false);
    assert.equal(isPartsDetailSheetName("参考写真"), false);
  });

  test("🔴 (RF)/(DC) 두 장짜리 판본은 두 시트를 다 고른다 — 한쪽만 읽으면 DC 부가 사라진다", () => {
    assert.deepEqual(
      pickPartsDetailSheetNames([
        "Card",
        "交換部品詳細(RF)",
        "Repair_Report",
        "交換部品詳細(DC)",
        "Repair_Record",
      ]),
      ["交換部品詳細(RF)", "交換部品詳細(DC)"]
    );
  });

  test("🔴 시트가 없으면 빈 목록이다 — 옛 판본에서 던지지 않는다", () => {
    assert.deepEqual(pickPartsDetailSheetNames(["Card", "Repair_Report"]), []);
  });
});

describe("交換部品詳細 판독 — 판본 A (머리글 7행)", () => {
  /**
   * 🔴 **뜻을 다시 정한 시험** (2026-10-28). 예전 제목은 「실측 열 배치에서
   * 품명 · 규격 · 수량 · 상황 · 措置 를 읽는다」였고, 기대값이
   * `name: "값-부품A"`(= `部品名` 칸) · `spec: "값-형식A"`(= `型式` 칸)였다.
   * 사용자가 실물 연락서를 열어 **`部品名` 은 사람이 읽는 설명이고 재고관리와
   * 같은 글자는 `型式`·`仕様書番号` 의 품번**임을 보여 주어 뒤집었다.
   * 이 줄은 `型式` 이 차 있는 꼴(실물 판본 ②)이라 그것이 이름이 된다.
   */
  test("🔴 이름은 품번 칸에서 온다 — `型式` 이 차 있으면 그것이고, `部品名` 은 곁 칸으로 남는다", () => {
    const grid = gridOf({
      C1: "引取番号：",
      D1: "D210105",
      A4: "交換部品詳細(RF)",
      A6: "交換部品（修理、O/H、改修、最新仕様Verアップ）",
      ...HEADER_A,
      A8: 1,
      B8: "故障①",
      C8: "값-부품A",
      D8: "값-형식A",
      E8: "값-규격A",
      H8: 3,
      I8: "修理",
      A9: 2,
      B9: "故障②",
      C9: "―",
      A10: 3,
      B10: "予防①",
      C10: "값-부품B",
      H10: 2,
      I10: "O/H",
    });

    assert.deepEqual(readPartsDetailSheet(grid, "交換部品詳細(RF)"), [
      {
        // 🔴 **이 네 줄이 2026-10-28 의 뒤집기다.** 되돌리면 여기서 깨진다.
        //    예전 기대값: `name: "값-부품A"` · `spec: "값-형식A"` · `address: "C8"`.
        //    ⚠️ 그때는 `仕様書番号`(E8 의 `값-규격A`)가 **아무 데도 안 실렸다** —
        //       `spec` 이 왼쪽부터 첫 값을 집었고 그것이 `型式` 이었다.
        name: "값-형식A",
        model: "값-형식A",
        partName: "값-부품A",
        spec: "값-규격A",
        kind: "fault",
        quantity: 3,
        status: "修理",
        measure: "故障①",
        sheetName: "交換部品詳細(RF)",
        address: "D8",
      },
      {
        // 🔴 `型式` 이 빈 줄은 `部品名` 으로 떨어진다 — 그러지 않으면 이름이 사라진다.
        name: "값-부품B",
        model: null,
        partName: "값-부품B",
        spec: null,
        kind: "preventive",
        quantity: 2,
        status: "O/H",
        measure: "予防①",
        sheetName: "交換部品詳細(RF)",
        address: "C10",
      },
    ]);
  });

  /**
   * 🔵 **되살아나면 깨지는 단언** — 이름 고르기의 차례를 값으로 못 박는다.
   * 🔴 사용자가 보여 준 **실물 두 장이 서로 다른 칸에 품번을 적고 있었다** —
   * 한 장은 `仕様書番号` 에, 다른 장은 `型式` 에. 그래서 **둘 다** 봐야 하고,
   * 둘이 함께 찼을 때 `型式` 이 이긴다. `部品名` 은 사람이 읽는 설명이라
   * **맨 마지막 비상구**다(그 글자로는 재고관리와 안 묶인다).
   *
   * 네 줄이 네 갈래다 — 실물에서 본 둘 + 둘 다 찬 줄 + 비상구만 남은 줄.
   * 품번 자리의 값은 **모양만 베낀 가짜**다.
   */
  test("🔴 이름 고르기 차례 — `型式` → `仕様書番号` → `部品名`(비상구)", () => {
    const grid = gridOf({
      ...HEADER_A,
      // 둘 다 찬 줄 — `型式` 이 이긴다.
      B8: "故障①",
      C8: "값-부품설명A",
      D8: "ZX-1000-A",
      E8: "ZY-2000-A",
      H8: 1,
      // 🔴 실물 판본 ①(`交換部品詳細(RF)` 탭) — `型式` 이 비고 `仕様書番号` 에 품번.
      B9: "故障②",
      C9: "값-부품설명B",
      E9: "ZY-2000-B",
      H9: 1,
      // 🔴 실물 판본 ②(`交換部品詳細` 탭) — `型式` 에 품번, `仕様書番号` 빈칸.
      B10: "故障③",
      C10: "값-부품설명C",
      D10: "ZX-1000-C",
      H10: 1,
      // 비상구 — 품번 칸이 둘 다 비면 설명이라도 남긴다.
      B11: "故障④",
      C11: "값-부품설명D",
      H11: 1,
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細(RF)").map((part) => [
        part.name,
        part.model,
        part.spec,
        part.partName,
        part.address,
      ]),
      [
        ["ZX-1000-A", "ZX-1000-A", "ZY-2000-A", "값-부품설명A", "D8"],
        ["ZY-2000-B", null, "ZY-2000-B", "값-부품설명B", "E9"],
        ["ZX-1000-C", "ZX-1000-C", null, "값-부품설명C", "D10"],
        ["값-부품설명D", null, null, "값-부품설명D", "C11"],
      ]
    );
  });

  test("🔴 `措置` 가 예방분이면 `状況` 이 `修理` 여도 예방분이다 — 실측 141줄이 그 꼴이다", () => {
    const grid = gridOf({ ...HEADER_A, B8: "予防⑤", C8: "값-부품A", H8: 1, I8: "修理" });
    const [part] = readPartsDetailSheet(grid, "交換部品詳細(RF)");
    assert.equal(part.kind, "preventive");
    assert.equal(part.status, "修理");
  });

  test("🔴 드롭다운 목록 열(`部品名リスト`·그 오른쪽)을 부품으로 읽지 않는다", () => {
    const grid = gridOf({
      ...HEADER_A,
      B8: "故障①",
      C8: "값-부품A",
      H8: 1,
      I8: "修理",
      // 실측: N 열에 교산 부품 대장이, O 열에 `対象` 보기가 통째로 들어 있다.
      N8: "＜該当項目なしの場合＞",
      O8: "修理",
      N9: "終段AMP基板（AMP-DEH基板）",
      O9: "O/H",
      N10: "スプリッタ基板",
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細(RF)").map((part) => part.name),
      ["값-부품A"]
    );
  });

  test("🔴 아래쪽 「판본 이력」 표를 부품으로 읽지 않는다 — 실측에서 2,004줄이 그렇게 들어왔다", () => {
    const grid = gridOf({
      ...HEADER_A,
      B8: "故障①",
      C8: "값-부품A",
      H8: 1,
      I8: "修理",
      // 실측: 부품 표 아래에 양식 개정 이력 표가 붙어 있고, C 열이 품명 열과 같은 자리다.
      B65: "変更実施日",
      C65: "変更及び追加内容",
      K65: "変更者",
      B66: 41920,
      C66: "交換部品名リスト化",
      K66: "값-사람",
      B67: 42255,
      C67: "部品名リスト追加",
      K67: "값-사람",
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細(RF)").map((part) => part.name),
      ["값-부품A"]
    );
  });
});

describe("交換部品詳細 판독 — 판본 B (머리글 7행 + 40행)", () => {
  test("🔴 묶음이 둘이면 둘 다 읽는다 — 둘째 머리글이 40행에 있다(실측 143시트)", () => {
    const grid = gridOf({
      ...headerB(7),
      A8: "単体/Source",
      B8: "故障①",
      C8: "값-부품A",
      E8: "값-형식A",
      G8: "값-규격A",
      I8: 1,
      J8: "修理",
      L8: '←故障①は、"―"禁止)',
      B9: "故障②",
      C9: "―",
      A39: "修理以外の追加交換部品（必須交換・必須改造、必須交換（客先報告不可）、作業ミス）",
      ...headerB(40),
      B41: "故障①",
      C41: "값-부품B",
      I41: 5,
      J41: "改修",
      // 실측: N 열에 `状況` 보기가 드롭다운 목록으로 들어 있다.
      N41: "修理",
      N42: "O/H",
    });

    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => ({
        name: part.name,
        quantity: part.quantity,
        address: part.address,
      })),
      [
        // 🔴 판본 B 의 `型式` 은 E열이다 — 이름이 거기서 온다(2026-10-28).
        //    되돌리면 `값-부품A` · `C8` 로 돌아가 깨진다.
        { name: "값-형식A", quantity: 1, address: "E8" },
        // 둘째 묶음에는 `型式` 이 안 적혀 있어 `部品名`(C41)으로 떨어진다.
        { name: "값-부품B", quantity: 5, address: "C41" },
      ]
    );
  });

  /**
   * 🔵 **되살아나면 깨지는 단언** — 판본 B 는 열 글자가 판본 A 와 다르다
   * (`型式`=E열 · `仕様書番号`=G열 · `部品名`=C열). 차례를 판본 A 의 열 번호로
   * 못 박아 두면 이 판본에서 조용히 어긋난다 — 그래서 `address` 까지 본다.
   */
  test("🔴 판본 B 도 같은 차례다 — `型式`(E) 이 비면 `仕様書番号`(G) 로, 그것도 비면 `部品名`(C) 로", () => {
    const grid = gridOf({
      ...headerB(7),
      B8: "故障①",
      C8: "값-부품설명A",
      E8: "ZX-1000-A",
      G8: "ZY-2000-A",
      I8: 1,
      B9: "故障②",
      C9: "값-부품설명B",
      G9: "ZY-2000-B",
      I9: 1,
      B10: "故障③",
      C10: "값-부품설명C",
      I10: 1,
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => [part.name, part.address]),
      [
        ["ZX-1000-A", "E8"],
        ["ZY-2000-B", "G9"],
        ["값-부품설명C", "C10"],
      ]
    );
  });

  test("🔴 둘째 머리글이 50행인 판본(실측 16시트)도 같이 읽힌다", () => {
    const grid = gridOf({
      ...headerB(7),
      B8: "故障①",
      C8: "값-부품A",
      I8: 1,
      ...headerB(50),
      B51: "予防①",
      C51: "값-부품B",
      I51: 2,
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => [part.name, part.kind, part.quantity]),
      [
        ["값-부품A", "fault", 1],
        ["값-부품B", "preventive", 2],
      ]
    );
  });

  test("🔴 `部品名` 칸의 `交換無し` 는 상태값이라 부품으로 만들지 않는다 — 실측 187줄", () => {
    const grid = gridOf({
      ...headerB(7),
      B8: "故障①",
      C8: "값-부품A",
      I8: 1,
      B18: "予防①",
      C18: "交換無し",
      L18: '←予防①は、"―"禁止)',
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => part.name),
      ["값-부품A"]
    );
  });

  /**
   * 🔵 **되살아나면 깨지는 단언** (2026-10-28). `型式` 이 이름 칸이 된 뒤에도
   * 상태값 판정은 **`部品名` 칸에 그대로 걸려 있다** — 실측 187줄이 거기 적혀
   * 있고, 판정을 「고른 이름」으로 옮기면 그 187줄의 거름이 재어 보지 않은
   * 규칙으로 바뀐다. 그래서 `部品名` 이 `交換無し` 면 **`型式` 에 글자가 있어도
   * 줄을 만들지 않는다.** 이 조합이 실측에 몇 줄인지는 세지 못했다.
   */
  test("🔴 `部品名` 이 `交換無し` 면 `型式` 에 값이 있어도 부품이 아니다 — 판정 자리를 옮기지 않았다", () => {
    const grid = gridOf({
      ...headerB(7),
      B8: "故障①",
      C8: "交換無し",
      E8: "값-형식A",
      I8: 1,
      B9: "故障②",
      C9: "값-부품A",
      I9: 1,
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => part.name),
      ["값-부품A"]
    );
  });

  /**
   * 🔴 같은 판정을 **Card 시트 경로도 함께 쓴다**(`card-fields.ts` 의
   * `CardListSpec.isPartNameList`). 예전에는 이 시트에만 걸려 있어서 실측 469장
   * 중 165장이 Card 쪽으로 `交換無し` 를 들여보냈다. 목록을 두 벌로 적지 않는
   * 대신 이 함수를 내보내 둔다 — 그래서 함수 자체에 시험이 붙어야 한다.
   */
  test("🔴 상태값 판정은 내보낸 함수 하나다 — 표기 변이와 반각·전각을 함께 흡수한다", () => {
    for (const name of ["交換無し", "交換なし", "交換無", " 交換無し "]) {
      assert.equal(isKyosanStateOnlyPartName(name), true, name);
    }
    for (const name of ["값-부품A", "交換無しで返却", "交換部品"]) {
      assert.equal(isKyosanStateOnlyPartName(name), false, name);
    }
  });
});

describe("交換部品詳細 판독 — 판본 C (머리글 16 · 29 · 42행)", () => {
  test("🔴 묶음 셋을 다 읽는다 — 머리글이 16 · 29 · 42행이고 열 이름이 서로 다르다", () => {
    const grid = gridOf({
      // 실측: H1:H8 이 `状況` 드롭다운 목록이다. 머리글 **위**라 읽히지 않아야 한다.
      H1: "故障・修理",
      H2: "O/H",
      H3: "予防措置",
      H8: "作業ミス",
      B10: "引取番号：",
      C10: "D210105",
      A13: "交換部品詳細",
      A15: "交換部品（故障・予防措置）",
      ...headerC(16, true),
      A17: "①",
      // 🔴 B열은 설명, D열은 품번이다(2026-10-29 운영 실측). 이름은 D열에서 온다.
      B17: "값-부품설명A",
      D17: "AA000111",
      G17: 1,
      H17: "故障・修理",
      A18: "②",
      A28: "追加交換部品",
      ...headerC(29, false),
      A30: "①",
      B30: "값-부품설명B",
      D30: "AA000222",
      G30: 4,
      H30: "予防措置",
      // 실측: L 열에 부품 이름 목록이 값으로 들어 있다(머리글 없음).
      L30: "サーモセンサー",
      A41: "追加交換部品（作業ミス等）",
      ...headerC(42, false),
      A43: "①",
      B43: "값-부품C",
      G43: 2,
      H43: "改修・改造",
    });

    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => ({
        name: part.name,
        spec: part.spec,
        kind: part.kind,
        quantity: part.quantity,
        status: part.status,
        measure: part.measure,
        address: part.address,
      })),
      [
        // 🔴 이름이 D열(품번)에서 온다 — 2026-10-29 전에는 `값-부품설명A`·`B17` 이었다.
        {
          name: "AA000111",
          spec: "AA000111",
          kind: "fault",
          quantity: 1,
          status: "故障・修理",
          measure: null,
          address: "D17",
        },
        {
          name: "AA000222",
          spec: "AA000222",
          kind: "preventive",
          quantity: 4,
          status: "予防措置",
          measure: null,
          address: "D30",
        },
        // 🔵 셋째 묶음은 D열이 비어 **설명으로 떨어진다**(비상구). 이 줄은 안 바뀌었다.
        {
          name: "값-부품C",
          spec: null,
          kind: "fault",
          quantity: 2,
          status: "改修・改造",
          measure: null,
          address: "B43",
        },
      ]
    );
  });

  test("🔴 `措置` 칸이 없는 판본은 `状況` 으로 고장분·예방분을 가른다", () => {
    const grid = gridOf({
      ...headerC(16, true),
      B17: "값-부품A",
      G17: 1,
      H17: "予防措置",
      B18: "값-부품B",
      G18: 1,
      H18: "O/H",
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => [part.name, part.kind]),
      [
        ["값-부품A", "preventive"],
        ["값-부품B", "fault"],
      ]
    );
  });

  test("🔴 품명 칸이 비고 규격만 있는 줄은 규격을 이름으로 쓴다 — 실측 11줄(D210102 가 그렇다)", () => {
    const grid = gridOf({
      ...headerC(16, true),
      A17: "①",
      D17: "값-규격만",
      G17: 1,
      H17: "故障・修理",
    });
    assert.deepEqual(readPartsDetailSheet(grid, "交換部品詳細"), [
      {
        name: "값-규격만",
        model: null,
        partName: null,
        // 🔴 2026-10-28 에 바뀐 두 칸. 예전에는 `spec: null`(이름으로 올려 쓴 칸을
        //    비웠다) · `address: "B17"`(언제나 품명 열을 적었다)이었다. 지금은
        //    **칸 글자 그대로** 싣고, `address` 는 **이름을 가져온 칸**을 적는다 —
        //    「이름이 이상하다」는 신고를 어느 칸까지 되짚을 수 있어야 한다.
        spec: "값-규격만",
        kind: "fault",
        quantity: 1,
        status: "故障・修理",
        measure: null,
        sheetName: "交換部品詳細",
        address: "D17",
      },
    ]);
  });

  /**
   * 🔵 **되살아나면 깨지는 단언** (2026-10-29 에 기대값이 뒤집혔다).
   * 🔴 **이 시험은 하루 동안 틀린 설계를 적고 있었다.** 제목과 기대값을 인용해
   * 남긴다 — 초록 ✔ 옆의 글은 의심받지 않으므로, 지우면 같은 길로 되돌아간다:
   *
   *     「🔴 판본 C 는 차례가 그대로다 — `仕様書番号 / 型式`(D) 이 `部品名`(B) 을
   *       이기지 않는다」
   *     `[["값-부품A", null, "값-부품A", "ZY-2000-A", "B17"], …]`
   *
   * 그때 댄 까닭은 「머리글이 둘 다 `型式` 을 품은 겹뜻이라 품번이 어느 칸에
   * 들었는지 **가를 근거가 양식에 없다**」, 「사용자가 보여 준 실물 두 장도 판본
   * C 가 아니었다」였다. 🔴 **양식이 안 가를 뿐 실물은 한 가지였다** — 2026-10-29
   * 에 사용자가 판본 C 인 운영 연락서를 열어 보여 주었고, B열은 설명이고 D열이
   * 품번이었다. 그 사이 운영에는 설명 글자가 들어갔고, 설명이 같고 품번이 다른
   * 별개 부품 둘이 한 줄로 뭉개져 수량까지 사라졌다.
   *
   * 머리글이 겹뜻인 묶음(16행)과 홑뜻 `部品名` 인 묶음(29행)을 **둘 다** 본다:
   * 둘 다 D열이 `仕様書番号 / 型式` 이라 같은 차례를 탄다.
   */
  test("🔴 판본 C 는 `仕様書番号 / 型式`(D) 이 품번이다 — `部品名`(B) 설명을 이긴다", () => {
    const grid = gridOf({
      ...headerC(16, true),
      A17: "①",
      B17: "값-부품설명A",
      D17: "ZY-2000-A",
      G17: 1,
      H17: "故障・修理",
      A28: "追加交換部品",
      ...headerC(29, false),
      A30: "①",
      B30: "값-부품설명B",
      D30: "ZY-2000-B",
      G30: 1,
      H30: "故障・修理",
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => [
        part.name,
        part.model,
        part.partName,
        part.spec,
        part.address,
      ]),
      [
        ["ZY-2000-A", null, "값-부품설명A", "ZY-2000-A", "D17"],
        ["ZY-2000-B", null, "값-부품설명B", "ZY-2000-B", "D30"],
      ]
    );
  });
});

describe("交換部品詳細 판독 — 수량", () => {
  test("🔴 수량이 실려 온다. 실측 값 범위가 1…37 이다", () => {
    const grid = gridOf({
      ...headerC(16, true),
      B17: "값-부품A",
      G17: 1,
      B18: "값-부품B",
      G18: 37,
      B19: "값-부품C",
      G19: "18",
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => part.quantity),
      [1, 37, 18]
    );
  });

  test("🔴 수량 칸이 빈 줄은 null 이다 — 넣는 쪽이 1 로 본다(실측 30/1,315줄)", () => {
    const grid = gridOf({ ...headerC(16, true), B17: "값-부품A", H17: "故障・修理" });
    assert.equal(readPartsDetailSheet(grid, "交換部品詳細")[0].quantity, null);
  });

  test("🔴 0 이하·정수 아닌 수량은 null 이다 — 표의 CHECK 가 0 이하를 막는다", () => {
    const grid = gridOf({
      ...headerC(16, true),
      B17: "값-부품A",
      G17: 0,
      B18: "값-부품B",
      G18: -2,
      B19: "값-부품C",
      G19: 1.5,
      B20: "값-부품D",
      G20: "두 개",
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細").map((part) => part.quantity),
      [null, null, null, null]
    );
  });
});

describe("交換部品詳細 판독 — 빈 시트", () => {
  test("🔴 줄이 하나도 없는 격자에서 던지지 않는다", () => {
    assert.deepEqual(readPartsDetailSheet(gridOf({}), "交換部品詳細"), []);
  });

  test("🔴 머리글을 못 찾으면 빈 목록이다 — 이름만 같고 속이 다른 시트에서 아무것도 지어내지 않는다", () => {
    const grid = gridOf({ A1: "交換部品詳細", B3: "값-무엇", C4: "값-무엇2" });
    assert.deepEqual(readPartsDetailSheet(grid, "交換部品詳細"), []);
  });

  test("머리글만 있고 아래가 비면 빈 목록이다 — 정말 무교체인 장(D210101)", () => {
    const grid = gridOf({ ...headerC(16, true), A17: "①", A18: "②", A19: "③" });
    assert.deepEqual(readPartsDetailSheet(grid, "交換部品詳細"), []);
  });

  test("빈칸 채움(`―`)만 적힌 줄은 부품이 아니다", () => {
    const grid = gridOf({
      ...HEADER_A,
      B8: "故障①",
      C8: "―",
      B9: "予防①",
      C9: "－－－",
      B10: "予防②",
      C10: "값-부품A",
    });
    assert.deepEqual(
      readPartsDetailSheet(grid, "交換部品詳細(RF)").map((part) => part.name),
      ["값-부품A"]
    );
  });

  test("🔴 인수 정보 줄의 `単体(So側)型式：` 을 열 이름으로 잘못 잡지 않는다", () => {
    const grid = gridOf({
      B10: "引取番号：",
      C10: "D210105",
      D10: "単体(So側)型式：",
      E10: "값-모델",
      F10: "L/N：",
      G10: "값-로트",
      H10: "S/N：",
      I10: "값-일련번호",
    });
    assert.deepEqual(readPartsDetailSheet(grid, "交換部品詳細"), []);
  });
});
