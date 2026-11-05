import { test } from "node:test";
import assert from "node:assert/strict";
import { readCellGridFlowchart, type CellGridWorksheet } from "./cell-grid-flowchart";

/**
 * 🔴 **지어낸 값만 쓴다.** 베끼는 것은 격자의 **모양**(상자 2칸×2줄 · 간격 3 ·
 * 이름표와 화살표가 그 사이 한 칸)과 네 낱말(`정상`·`N.G.`·`→`·`↓`)뿐이고, 상자 안의
 * 글은 전부 가짜다 — 이 저장소는 공개이고 원본은 사내 업무 자료다.
 *
 * 🔵 네 낱말은 가릴 수 없다. 그것이 곧 읽는 규칙 자체라서, 가짜로 바꾸면 이 시험이
 * **읽개가 아니라 가짜 어휘**를 재게 된다.
 */

function sheet(cells: Record<string, string>, merges: string[]): CellGridWorksheet {
  return { cells, merges };
}

/**
 * 블록 둘 · 세로 사슬 2단짜리 기준 표본.
 *
 * ```
 *  A3 | 1. 가나다 알람
 *   5 | B:1. 가 측정   D:정상  E:2. 나 측정  G:정상  H:수리 완료
 *   6 |               D:→            G:→
 *   7 | B:N.G. C:↓    E:N.G. F:↓
 *   8 | B:가 교환      E:라 확인
 *  10 |               E:N.G. F:↓
 *  11 |               E:마 교환          ← 🔴 세로가 2단으로 내려간다
 * A13 | 2. 바사아 알람
 *  15 | B:1. 바 확인   D:정상  E:수리 완료
 *  16 |               D:→
 *  17 | B:N.G. C:↓
 *  18 | B:사 교환
 * ```
 */
const TWO_BLOCKS = sheet(
  {
    A3: "1. 가나다 알람",
    B5: "1. 가 측정",
    D5: "정상",
    E5: "2. 나 측정",
    G5: "정상",
    H5: "수리 완료",
    D6: "→",
    G6: "→",
    B7: "N.G.",
    C7: "↓",
    E7: "N.G.",
    F7: "↓",
    B8: "가 교환",
    E8: "라 확인",
    E10: "N.G.",
    F10: "↓",
    E11: "마 교환",
    A13: "2. 바사아 알람",
    B15: "1. 바 확인",
    D15: "정상",
    E15: "수리 완료",
    D16: "→",
    B17: "N.G.",
    C17: "↓",
    B18: "사 교환",
  },
  [
    "B5:C6",
    "E5:F6",
    "H5:I6",
    "B8:C9",
    "E8:F9",
    "E11:F12",
    "B15:C16",
    "E15:F16",
    "B18:C19",
  ]
);

test("🔴 격자 치수를 **재서** 찾는다 — 상자 크기도 간격도 코드에 박지 않는다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  assert.ok(read.geometry, "격자를 못 쟀다 — 아래 단언이 전부 공짜로 통과할 뻔했다");
  assert.equal(read.geometry.boxWidth, 2);
  assert.equal(read.geometry.boxHeight, 2);
  assert.equal(read.geometry.colStep, 3);
  assert.equal(read.geometry.rowStep, 3);
  // 어떻게 쟀는지가 사람이 읽는 글에 남아야 한다 — 조용히 고르면 상자가 사라진다.
  assert.match(read.geometry.reason, /2칸×2줄/);
  assert.match(read.geometry.reason, /실측 3칸/);
});

test("🔴 블록을 가른다 — A 열의 `숫자.` 머리글이 블록의 머리다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  assert.equal(read.blocks.length, 2, "블록이 둘이 아니다 — 표본이 비면 아래가 전부 공짜로 통과한다");
  assert.deepEqual(
    read.blocks.map((b) => [b.headerRef, b.blockNumber, b.label, b.headerRow, b.endRow]),
    [
      ["A3", "1", "가나다 알람", 3, 12],
      ["A13", "2", "바사아 알람", 13, 19],
    ]
  );
  // 상자는 제 블록의 줄 범위로 갈린다.
  assert.deepEqual(
    read.blocks.map((b) => b.boxes.map((x) => x.ref)),
    [
      ["B5", "E5", "H5", "B8", "E8", "E11"],
      ["B15", "E15", "B18"],
    ]
  );
});

test("🔴 상자 글자는 **칸의 글자 그대로**다 — 앞의 `1.` 도 안 뗀다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  const first = read.blocks[0].boxes.find((b) => b.ref === "B5");
  assert.ok(first, "B5 상자가 없다");
  assert.equal(first.text, "1. 가 측정");
  // 병합 범위를 들고 다녀야 노드의 `sourceCellRange` 가 된다.
  assert.equal(first.mergeRange, "B5:C6");
});

test("🔴 가로 이음 — 「정상」 한 칸 건너 상자로 이어지고, 화살표는 그 바로 아래다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  const horizontal = read.blocks[0].links.filter((l) => l.direction === "HORIZONTAL");
  assert.equal(horizontal.length, 2, "가로 이음이 둘이 아니다");
  assert.deepEqual(
    horizontal.map((l) => [l.fromRef, l.toRef, l.labelRef, l.labelText, l.branchType, l.branchLabel, l.arrowRef]),
    [
      ["B5", "E5", "D5", "정상", "NORMAL", "정상", "D6"],
      ["E5", "H5", "G5", "정상", "NORMAL", "정상", "G6"],
    ]
  );
});

test("🔴 세로 이음 — 「N.G.」 한 줄 건너 상자로 이어지고, 화살표는 그 바로 오른쪽이다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  const vertical = read.blocks[0].links.filter((l) => l.direction === "VERTICAL");
  assert.equal(vertical.length, 3, "세로 이음이 셋이 아니다");
  assert.deepEqual(
    vertical.map((l) => [l.fromRef, l.toRef, l.labelRef, l.labelText, l.branchType, l.branchLabel, l.arrowRef]),
    [
      ["B5", "B8", "B7", "N.G.", "NG", "NG", "C7"],
      ["E5", "E8", "E7", "N.G.", "NG", "NG", "F7"],
      // 🔴 2단째 — 한 칸만 내려가고 멈추면 이 줄이 사라진다.
      ["E8", "E11", "E10", "N.G.", "NG", "NG", "F10"],
    ]
  );
});

test("🔴 **세로 사슬이 2단 이상 간다** — 한 칸만 내려가고 멈추면 안 된다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  const links = read.blocks[0].links;
  // 사슬을 따라가 본다: 2. 나 측정 --NG--> 라 확인 --NG--> 마 교환
  const first = links.find((l) => l.fromRef === "E5" && l.branchType === "NG");
  assert.ok(first, "1단째 세로 이음이 없다");
  const second = links.find((l) => l.fromRef === first.toRef && l.branchType === "NG");
  assert.ok(second, "🔴 2단째 세로 이음이 사라졌다");
  assert.equal(second.toRef, "E11");
  const third = links.find((l) => l.fromRef === second.toRef);
  assert.equal(third, undefined, "사슬이 끝나야 할 자리에서 더 이어졌다");
});

test("🔴 엑셀 글자를 통일한 갈래로 싣는다 — 분기 이름의 출처가 한 곳이다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  const all = read.blocks.flatMap((b) => b.links);
  assert.equal(all.length, 7, "이음 수가 달라졌다");
  // 엑셀에 적힌 글자(`N.G.`)와 분기에 실리는 이름(`NG`)은 **다를 수 있다.**
  const ng = all.filter((l) => l.branchType === "NG");
  assert.equal(ng.length, 4);
  assert.deepEqual([...new Set(ng.map((l) => l.labelText))], ["N.G."]);
  assert.deepEqual([...new Set(ng.map((l) => l.branchLabel))], ["NG"]);
  const normal = all.filter((l) => l.branchType === "NORMAL");
  assert.equal(normal.length, 3);
  assert.deepEqual([...new Set(normal.map((l) => l.branchLabel))], ["정상"]);
});

test("🔵 글자를 하나도 남기지 않고 읽는다 — 읽은 칸 수가 글자 있는 칸 수와 같다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  assert.equal(read.textCellCount, 25, "표본의 칸 수가 바뀌었다 — 아래 셈의 뜻이 달라진다");
  assert.equal(read.usedCellCount, read.textCellCount);
  assert.deepEqual(read.warnings, []);
});

// ── 🔴 어긋난 격자 · 읽다 만 칸 ─────────────────────────────────────────

test("🔴 상자 사이의 틈이 한 칸이 아니면 **안 읽고** ERROR 로 올린다", () => {
  // 상자는 2칸인데 간격이 4칸 — 이름표가 어느 칸에 있는지 우리가 못 정한다.
  const read = readCellGridFlowchart(
    sheet(
      { A3: "1. 가나다 알람", B5: "가 측정", D5: "정상", F5: "나 측정" },
      ["B5:C6", "F5:G6"]
    )
  );
  assert.equal(read.geometry, null, "격자를 쟀다 — 찍어서 읽으면 흐름이 조용히 틀린다");
  assert.deepEqual(read.blocks, []);
  const irregular = read.warnings.filter((w) => w.code === "IRREGULAR_GRID");
  assert.equal(irregular.length, 1);
  assert.equal(irregular[0].severity, "ERROR");
  assert.match(irregular[0].message, /틈이 1칸이어야/);
});

test("🔴 블록 안의 줄 간격이 어긋나면 경고한다", () => {
  // 같은 열의 상자가 3줄이 아니라 4줄 아래에 서 있다.
  const read = readCellGridFlowchart(
    sheet(
      { A3: "1. 가나다 알람", B5: "가 측정", B8: "나 조치", B12: "다 조치", B7: "N.G.", C7: "↓" },
      ["B5:C6", "B8:C9", "B12:C13"]
    )
  );
  assert.ok(read.geometry, "격자를 못 쟀다");
  const offGrid = read.warnings.filter((w) => w.code === "IRREGULAR_BLOCK_ROWS");
  assert.equal(offGrid.length, 1, "어긋난 줄을 조용히 넘겼다");
  assert.equal(offGrid[0].ref, "B12");
});

test("🔴 이름표는 있는데 건너편에 상자가 없으면 **선을 지어내지 않고** 경고한다", () => {
  const read = readCellGridFlowchart(
    sheet(
      { A3: "1. 가나다 알람", B5: "가 측정", D5: "정상", D6: "→", B7: "N.G.", C7: "↓", B8: "나 조치" },
      ["B5:C6", "B8:C9"]
    )
  );
  assert.equal(read.blocks.length, 1);
  // 세로는 멀쩡히 이어지고, 가로만 사라진다.
  assert.deepEqual(
    read.blocks[0].links.map((l) => [l.fromRef, l.toRef, l.branchType]),
    [["B5", "B8", "NG"]]
  );
  const missing = read.warnings.filter((w) => w.code === "MISSING_TARGET_BOX");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].ref, "D5");
  assert.match(missing[0].message, /E5/);
});

test("🔴 화살표만 있고 이름표가 없으면 갈래를 못 정한다 — 선을 안 만들고 경고한다", () => {
  const read = readCellGridFlowchart(
    sheet({ A3: "1. 가나다 알람", B5: "가 측정", C7: "↓", B8: "나 조치" }, ["B5:C6", "B8:C9"])
  );
  assert.equal(read.blocks.length, 1);
  assert.deepEqual(read.blocks[0].links, []);
  assert.deepEqual(
    read.warnings.filter((w) => w.code === "ORPHAN_ARROW").map((w) => w.ref),
    ["C7"]
  );
  // 선이 없으니 두 상자가 흐름에서 떨어진다 — 그것도 조용히 넘기지 않는다.
  assert.deepEqual(
    read.warnings.filter((w) => w.code === "ISOLATED_BOX").map((w) => w.ref),
    ["B5", "B8"]
  );
});

test("🔴 이름표 자리에 분기 어휘가 아닌 글자가 있으면 선을 안 만든다", () => {
  const read = readCellGridFlowchart(
    sheet({ A3: "1. 가나다 알람", B5: "가 측정", D5: "아마도", D6: "→", E5: "나 측정" }, [
      "B5:C6",
      "E5:F6",
    ])
  );
  assert.deepEqual(read.blocks[0].links, []);
  const unknown = read.warnings.filter((w) => w.code === "UNKNOWN_LABEL_WORD");
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].ref, "D5");
  // 그 칸을 「읽다 만 칸」으로 **두 번** 보고하지 않는다.
  assert.deepEqual(read.warnings.filter((w) => w.ref === "D5" && w.code === "UNREAD_CELL"), []);
});

test("🔴 글자가 있는데 끝까지 못 읽은 칸은 전부 경고로 올린다", () => {
  const read = readCellGridFlowchart(
    sheet(
      {
        A1: "머리말",
        A3: "1. 가나다 알람",
        B5: "가 측정",
        D5: "정상",
        D6: "→",
        E5: "나 측정",
        C8: "손으로 적은 메모",
      },
      ["B5:C6", "E5:F6"]
    )
  );
  const unread = read.warnings.filter((w) => w.code === "UNREAD_CELL");
  assert.deepEqual(
    unread.map((w) => [w.ref, w.severity]),
    [
      // 첫 블록보다 위는 시트 머리말 — 사람이 할 일이 다르므로 INFO 다.
      ["A1", "INFO"],
      // 블록 안의 글자는 흐름의 일부일 수 있다 — WARNING.
      ["C8", "WARNING"],
    ]
  );
  assert.equal(read.usedCellCount, read.textCellCount - 2);
});

// ── 🔵 「이 시트가 셀 격자 흐름도인가」의 판정 ───────────────────────────

test("🔴 머리글이 없으면 블록 0개다 — 다른 시트가 이 길로 새지 않게 막는 문이다", () => {
  const read = readCellGridFlowchart(
    sheet({ B5: "가 측정", D5: "정상", D6: "→", E5: "나 측정" }, ["B5:C6", "E5:F6"])
  );
  assert.ok(read.geometry, "격자는 쟀다(상자는 있다)");
  assert.deepEqual(read.blocks, []);
});

test("🔵 상자 글자가 `숫자.` 로 시작해도 머리글이 아니다 — 머리글은 상자보다 **왼쪽**이다", () => {
  const read = readCellGridFlowchart(TWO_BLOCKS);
  // `1. 가 측정`(B5) 이 머리글로 둔갑하면 블록이 넷이 된다.
  assert.equal(read.blocks.length, 2);
  assert.deepEqual(read.blocks.map((b) => b.headerRef), ["A3", "A13"]);
});

test("병합이 없거나 한 번뿐이면 격자가 아니다", () => {
  assert.deepEqual(readCellGridFlowchart(sheet({ A3: "1. 가나다", B5: "가" }, [])).blocks, []);
  assert.deepEqual(
    readCellGridFlowchart(sheet({ A3: "1. 가나다", B5: "가" }, ["B5:C6"])).blocks,
    []
  );
});

test("🔵 칸 안의 `\\r\\n` 은 `\\n` 으로 맞춘다 — 제목·본문을 가르는 코드가 두 길에서 한 벌이다", () => {
  const read = readCellGridFlowchart(
    sheet({ A3: "1. 가나다 알람", B5: "가 측정\r\n(두 줄째)" }, ["B5:C6", "B8:C9"])
  );
  assert.equal(read.blocks[0].boxes[0].text, "가 측정\n(두 줄째)");
});
