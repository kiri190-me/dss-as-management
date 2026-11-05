import { columnNumberToLetters } from "@/lib/xlsx/sheet-grid";
import { classifyUnifiedBranchLabel } from "./branch-classification";
import { colLettersToNum, splitCellRef } from "./ooxml-parser";
import { splitBlockHeading } from "./technical-task-sheet-plan";
import type { ProcedureBranchType } from "@/lib/domain/procedure-template-types";

/**
 * ============================================================================
 * **셀 격자로 그린 흐름도**를 읽는다 — 도형 읽개와 나란히 서는 세 번째 길
 * ============================================================================
 * `(MB) 수리` 한 장이 이 꼴이다. 다른 흐름도 시트는 전부 도형(`xl/drawings/…`)으로
 * 그려져 있는데, 이 시트만 **셀을 병합해 상자를 만들고 그 사이 칸에 「정상」·「N.G.」·
 * 「→」·「↓」를 적어** 흐름을 그렸다. 그림층이 아예 없어서(`drawingPath` 가 null)
 * 도형 읽개로는 「도형 0 · 연결선 0」, 곧 **「흐름도가 없다」**가 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 도형 읽개를 고치지 않고 **따로** 만드는가
 * ──────────────────────────────────────────────────────────────────────
 * 두 모양은 **입력이 다르고 판정이 다르다.** 도형 쪽은 EMU 좌표·연결선 끝점·레이블
 * 거리로 흐름을 세우고, 이쪽은 **칸 번호의 규칙성**이 전부다(거리도 좌표도 없다).
 * 한 함수에 섞으면 둘 다 깨지기 쉬워지고, 이미 사람이 눈으로 확인해 준 절차 열넷의
 * 결과가 이 시트 때문에 흔들린다. 그래서 **읽개를 고르는 일**만 윗단
 * (`technical-task-workbook.ts`)이 하고, 여기는 셀만 본다.
 *
 * 🔵 **같은 것을 두 벌로 적지 않는다**: 분기 어휘(정상/N.G.)의 판정은
 * `classifyUnifiedBranchLabel` 한 곳에서 오고, 블록 머리글을 가르는 규칙은
 * `technical-task-sheet-plan.ts` 의 `splitBlockHeading` 한 곳에서 온다.
 * 노드 유형·시작 노드는 이 모듈이 아니라 `extract-cell-grid-task-graph.ts` 가
 * **도형 쪽과 똑같은 함수**로 정한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **격자 치수는 재서 찾는다** — 그래도 기대는 전제가 하나 있다
 * ──────────────────────────────────────────────────────────────────────
 * 상자 크기(2칸×2줄)도 상자 간격(3칸·3줄)도 코드에 안 박는다. 상자 크기는 **가장
 * 많이 쓰인 병합 모양**에서, 간격은 **상자들이 실제로 선 자리의 최소 간격**에서
 * 나온다(실측 2026-11-05: `(MB) 수리` 는 병합 112개 중 111개가 2×2, 상자 열은
 * 2·5·8·…·26, 줄은 5·8 / 13·16·19 / … 로 전부 3씩 벌어져 있다).
 *
 * 🔴 **다만 「상자 사이의 틈이 정확히 한 칸」은 전제다.** 이름표와 화살표가 그
 * 한 칸에 들어가기 때문이다 — 틈이 둘이면 이름표가 어느 칸에 있는지 우리가 정할 수
 * 없고, 찍어서 고르면 흐름이 조용히 틀린다. 그래서 재 본 간격이 `상자 크기 + 1` 이
 * **아니면 그 시트를 안 읽고 ERROR 로 올린다.** 조용히 틀리느니 아무것도 안 읽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **읽다 만 칸을 조용히 버리지 않는다**
 * ──────────────────────────────────────────────────────────────────────
 * 상자·이름표·화살표·블록 머리글로 **쓰인 칸을 하나하나 표시**하고, 글자가 있는데
 * 끝까지 안 쓰인 칸은 전부 경고로 올린다. 도형 읽개의 `droppedShapes`·`issues` 와
 * 같은 결이다 — 지난 들여오기가 못 쓰게 된 가장 큰 까닭이 「무엇이 사라졌는지
 * 아무도 모른다」였다.
 */

// ---------------------------------------------------------------------------
// 입력 — 워크북도 zip 도 모른다(시험이 지어낸 칸으로 그대로 세울 수 있어야 한다)
// ---------------------------------------------------------------------------

export type CellGridWorksheet = {
  /** `{ "B5": "1. VVC용량 측정", … }` — 글자가 있는 칸만. */
  cells: Readonly<Record<string, string>>;
  /** `["B5:C6", …]` — `<mergeCells>` 에 적힌 그대로. */
  merges: readonly string[];
};

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

export type CellGridWarningCode =
  /** 잰 격자가 우리가 읽을 수 있는 꼴이 아니다 — 이 시트는 안 읽는다. */
  | "IRREGULAR_GRID"
  /** 이름표는 있는데 그 너머에 상자가 없다 — 선을 지어내지 않는다. */
  | "MISSING_TARGET_BOX"
  /** 이름표는 있는데 화살표 칸이 비었다(선은 만든다). */
  | "MISSING_ARROW"
  /** 화살표만 있고 이름표가 없다 — 어느 갈래인지 우리가 못 정한다. */
  | "ORPHAN_ARROW"
  /** 이름표 자리에 분기 어휘가 아닌 글자가 있다. */
  | "UNKNOWN_LABEL_WORD"
  /** 가로인데 NG, 세로인데 정상 — 글자대로 읽되 사람이 한 번 본다. */
  | "UNEXPECTED_DIRECTION"
  /** 어느 블록의 줄 범위에도 안 드는 상자. */
  | "BOX_OUTSIDE_BLOCK"
  /** 블록 안의 상자인데 들어오는 선도 나가는 선도 없다. */
  | "ISOLATED_BOX"
  /** 글자가 있는데 끝까지 아무 쓰임도 못 찾은 칸. */
  | "UNREAD_CELL"
  /** 블록 안의 줄 간격이 잰 값과 어긋난다. */
  | "IRREGULAR_BLOCK_ROWS";

export type CellGridWarning = {
  code: CellGridWarningCode;
  severity: "INFO" | "WARNING" | "ERROR";
  /** 어느 칸 이야기인가. 시트 전체 이야기면 null. */
  ref: string | null;
  /** 어느 블록 이야기인가(머리 칸 주소). 블록을 못 정하면 null. */
  blockHeaderRef: string | null;
  message: string;
};

/** 병합 하나가 만든 상자. 글자는 **왼쪽 위 칸**에 들어 있다(엑셀이 그렇게 적는다). */
export type CellGridBox = {
  /** 왼쪽 위 칸 주소 — 이 상자의 열쇠다. */
  ref: string;
  col: number;
  row: number;
  /** 병합 범위 그대로(`B5:C6`) — 노드의 `sourceCellRange` 가 된다. */
  mergeRange: string;
  /** 🔴 칸 글자 **그대로**다. 앞의 `1.` 도 안 뗀다(2026-11-05 사용자 결정). */
  text: string;
};

export type CellGridLinkDirection = "HORIZONTAL" | "VERTICAL";

export type CellGridLink = {
  fromRef: string;
  toRef: string;
  direction: CellGridLinkDirection;
  /** 이름표 칸과 **엑셀에 적힌 글자 그대로**(`정상`·`N.G.`). */
  labelRef: string;
  labelText: string;
  /**
   * 🔵 이쪽은 **통일된** 갈래다(`classifyUnifiedBranchLabel`) — 분기에 실리는 값과
   * 같다. `N.G.` 가 `NG` 로, `정상` 이 `NORMAL` 로 온다.
   */
  branchType: ProcedureBranchType;
  branchLabel: string | null;
  /** 화살표 칸. 글자가 없으면 null(경고로 함께 올린다). */
  arrowRef: string | null;
  arrowText: string | null;
};

export type CellGridBlock = {
  /** `A3` — 머리글이 적힌 칸. 이 블록의 열쇠다. */
  headerRef: string;
  headerRow: number;
  /** 다음 블록 바로 앞 줄(마지막 블록은 시트의 마지막 줄). */
  endRow: number;
  /** 머리글 칸 글자 그대로 — `1. 반사파(Reflect) 관련 알람 발생`. */
  rawHeaderText: string;
  /**
   * 머리글 앞의 번호. 🔴 **워크북의 단계 번호가 아니다** — 이 시트 안에서만 뜻이 있는
   * 증상 차례다. 그래서 절차 계획의 `stageNumber` 로 쓰지 않는다
   * (technical-task-sheet-plan.ts 의 `planCellGridProcedures` 머리말).
   */
  blockNumber: string;
  /** 번호를 뗀 이름 — 절차 이름과 시작 노드 제목이 된다. */
  label: string;
  boxes: CellGridBox[];
  links: CellGridLink[];
};

export type CellGridGeometry = {
  /** 상자 한 칸의 너비·높이(칸 수) — 가장 많이 쓰인 병합 모양에서 잰다. */
  boxWidth: number;
  boxHeight: number;
  /** 상자와 상자 사이의 간격(칸 수) — 실제로 선 자리에서 잰다. */
  colStep: number;
  rowStep: number;
  /** 그 값을 어떻게 쟀는가 — 드라이런이 그대로 찍는다. */
  reason: string;
};

export type CellGridFlowchart = {
  /** 격자를 못 재면 null(그러면 blocks 도 비어 있다). */
  geometry: CellGridGeometry | null;
  blocks: CellGridBlock[];
  warnings: CellGridWarning[];
  /** 글자가 있는 칸 전부(블록 밖까지) — 합계를 검산하는 자리. */
  textCellCount: number;
  /** 그 가운데 상자·이름표·화살표·머리글로 **쓰인** 칸. */
  usedCellCount: number;
};

// ---------------------------------------------------------------------------
// 격자 어휘 — 숫자·글자를 박을 때는 바로 옆에 근거를 적는다
// ---------------------------------------------------------------------------

/**
 * 가로/세로 이음을 그리는 화살표 글자.
 *
 * 🔴 **엑셀에 적힌 그대로**다. 실측(2026-11-05 · `(MB) 수리`)으로 가로는 `→` 47개,
 * 세로는 `↓` 53개뿐이고 다른 화살표 글자(`⇒`·`▶`·`↘`)는 한 칸도 없다. 넓게 잡으면
 * 본문 글자가 화살표로 둔갑하므로 **본 것만** 적고, 못 보던 글자가 나오면
 * 「화살표가 없다」로 경고가 뜨게 둔다.
 */
const HORIZONTAL_ARROW_TEXTS: ReadonlySet<string> = new Set(["→"]);
const VERTICAL_ARROW_TEXTS: ReadonlySet<string> = new Set(["↓"]);

/**
 * 상자 사이에 **이름표와 화살표가 들어갈 틈**(칸 수).
 *
 * 🔴 이것만은 재지 않고 **전제한다.** 틈이 한 칸이어야 이름표 칸이 「상자 오른쪽
 * 끝 바로 다음」으로 유일하게 정해진다. 아래 `measureGeometry` 가 잰 간격이
 * `상자 크기 + 이 값` 이 아니면 그 시트는 **안 읽고** ERROR 로 올린다.
 */
const LABEL_GAP = 1;

/**
 * 칸 하나의 **그림 크기**(픽셀). 🔴 엑셀에서 잰 값이 **아니다** — 이 읽개는 열 폭도
 * 행 높이도 안 읽는다.
 *
 * 🔵 그래도 되는 까닭: 절차 화면이 이 값으로 그리지 않는다. `ProcedureFlowGraph.
 * resolveBaselinePosition` 의 차례는 ① 사람이 옮긴 자리 ② 기술 작업 절차는 **자동
 * 배치** ③ 그것도 없을 때만 이 칸이다(extract-technical-task-graph.ts 의 같은 주석).
 * 그래서 이 값은 **받침**이고, 상자들의 앞뒤 차례만 지키면 된다.
 */
const CELL_WIDTH_PX = 64;
const CELL_HEIGHT_PX = 20;

// ---------------------------------------------------------------------------

type Rect = { c1: number; r1: number; c2: number; r2: number; range: string };

function parseMergeRange(range: string): Rect | null {
  const [start, end] = range.split(":");
  if (!start || !end) return null;
  try {
    const s = splitCellRef(start);
    const e = splitCellRef(end);
    return { c1: colLettersToNum(s.col), r1: s.row, c2: colLettersToNum(e.col), r2: e.row, range };
  } catch {
    return null;
  }
}

export function cellRefOf(col: number, row: number): string {
  return `${columnNumberToLetters(col)}${row}`;
}

/** 정렬된 수열의 **이웃한 차이** 가운데 0보다 큰 최솟값. 표본이 없으면 null. */
function smallestPositiveGap(values: readonly number[]): number | null {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  let smallest: number | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0 && (smallest === null || gap < smallest)) smallest = gap;
  }
  return smallest;
}

/**
 * 상자 모양 = **가장 많이 쓰인 병합 모양**.
 *
 * 🔵 「2칸×2줄」을 박지 않는 까닭: 다음에 같은 꼴의 시트가 3칸짜리 상자로 그려져도
 * 그대로 읽히게 하려는 것이다. 🔴 대신 **고른 모양이 무엇인지 드라이런이 찍는다** —
 * 조용히 엉뚱한 모양을 고르면 상자가 통째로 사라진다.
 */
function dominantMergeShape(
  rects: readonly Rect[]
): { width: number; height: number; count: number; total: number } | null {
  if (rects.length === 0) return null;
  const tally = new Map<string, number>();
  for (const rect of rects) {
    const key = `${rect.c2 - rect.c1 + 1}x${rect.r2 - rect.r1 + 1}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of tally) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  if (!bestKey) return null;
  const [width, height] = bestKey.split("x").map(Number);
  return { width, height, count: bestCount, total: rects.length };
}

// ---------------------------------------------------------------------------

/**
 * 시트 한 장을 **셀 격자 흐름도**로 읽는다.
 *
 * 🔵 이 함수는 「이 시트가 셀 격자 흐름도인가」의 판정도 겸한다 — 블록이 **0개면
 * 아니다.** 그래서 워크북의 모든 시트에 그냥 물어봐도 되고, 물어본 결과가
 * 시트 제외 판정에 그대로 쓰인다(technical-task-sheet-plan.ts).
 */
export function readCellGridFlowchart(worksheet: CellGridWorksheet): CellGridFlowchart {
  const warnings: CellGridWarning[] = [];
  const cells = worksheet.cells;
  const textRefs = Object.keys(cells);
  const empty: CellGridFlowchart = {
    geometry: null,
    blocks: [],
    warnings,
    textCellCount: textRefs.length,
    usedCellCount: 0,
  };

  const rects = worksheet.merges
    .map(parseMergeRange)
    .filter((rect): rect is Rect => rect !== null);
  const shape = dominantMergeShape(rects);
  // 병합이 아예 없거나 그 모양이 한 번뿐이면 「격자」라고 부를 근거가 없다.
  if (!shape || shape.count < 2) return empty;

  const boxRects = rects.filter(
    (rect) => rect.c2 - rect.c1 + 1 === shape.width && rect.r2 - rect.r1 + 1 === shape.height
  );
  const boxes: CellGridBox[] = [];
  for (const rect of boxRects) {
    const ref = cellRefOf(rect.c1, rect.r1);
    const text = cells[ref];
    // 🔵 글자 없는 병합은 상자가 아니다(이 시트에는 0개다). 흐름도의 「빈 상자」와
    //    달리 셀 쪽에는 이어 붙일 이음목이라는 것이 없다 — 그냥 빈 칸이다.
    if (text === undefined || text.trim() === "") continue;
    boxes.push({ ref, col: rect.c1, row: rect.r1, mergeRange: rect.range, text: normalizeCellText(text) });
  }
  if (boxes.length === 0) return empty;

  const measured = measureGeometry(boxes, shape);
  warnings.push(...measured.warnings);
  if (!measured.geometry) return { ...empty, warnings };
  const geometry = measured.geometry;

  // ── 블록 가르기 ────────────────────────────────────────────────────────
  //
  // 🔴 「A 열」을 박지 않는다 — **상자보다 왼쪽에 있는 칸**이 머리글 자리다. 상자가
  //    선 가장 왼쪽 열을 재서 그보다 왼쪽만 본다. 이렇게 해야 상자 글자(`1. VVC용량
  //    측정`)가 머리글로 둔갑하지 않는다(그쪽은 상자 열에 있다).
  const minBoxCol = Math.min(...boxes.map((b) => b.col));
  const headerRefs: { ref: string; row: number; blockNumber: string; label: string; raw: string }[] = [];
  for (const ref of textRefs) {
    let parsed: { col: string; row: number };
    try {
      parsed = splitCellRef(ref);
    } catch {
      continue;
    }
    if (colLettersToNum(parsed.col) >= minBoxCol) continue;
    const heading = splitBlockHeading(cells[ref]);
    if (!heading) continue;
    headerRefs.push({
      ref,
      row: parsed.row,
      blockNumber: heading.blockNumber,
      label: heading.label,
      raw: normalizeCellText(cells[ref]),
    });
  }
  headerRefs.sort((a, b) => a.row - b.row);
  if (headerRefs.length === 0) return { ...empty, geometry, warnings };

  const maxRow = Math.max(
    ...boxes.map((b) => b.row + geometry.boxHeight - 1),
    ...textRefs.map((ref) => {
      try {
        return splitCellRef(ref).row;
      } catch {
        return 0;
      }
    })
  );

  const used = new Set<string>();
  const blocks: CellGridBlock[] = headerRefs.map((header, index) => {
    used.add(header.ref);
    return {
      headerRef: header.ref,
      headerRow: header.row,
      endRow: index + 1 < headerRefs.length ? headerRefs[index + 1].row - 1 : maxRow,
      rawHeaderText: header.raw,
      blockNumber: header.blockNumber,
      label: header.label,
      boxes: [],
      links: [],
    };
  });

  const blockOfRow = (row: number): CellGridBlock | null =>
    blocks.find((block) => row >= block.headerRow && row <= block.endRow) ?? null;

  const boxByRef = new Map<string, CellGridBox>();
  for (const box of boxes) boxByRef.set(box.ref, box);

  for (const box of [...boxes].sort((a, b) => a.row - b.row || a.col - b.col)) {
    used.add(box.ref);
    const block = blockOfRow(box.row);
    if (!block) {
      warnings.push({
        code: "BOX_OUTSIDE_BLOCK",
        severity: "WARNING",
        ref: box.ref,
        blockHeaderRef: null,
        message:
          `상자 "${firstLineOf(box.text)}"(${box.ref})가 어느 블록의 줄 범위에도 안 듭니다 — ` +
          "이 상자는 어느 절차에도 안 들어갑니다.",
      });
      continue;
    }
    block.boxes.push(box);
  }

  // ── 이음 읽기 ──────────────────────────────────────────────────────────
  for (const block of blocks) {
    for (const box of block.boxes) {
      block.links.push(
        ...readLinksFrom(box, {
          cells,
          geometry,
          boxByRef,
          block,
          blocks,
          used,
          warnings,
        })
      );
    }
    checkBlockRowSpacing(block, geometry, warnings);
  }

  // ── 🔴 읽다 만 칸 · 흐름에 안 닿는 상자 ────────────────────────────────
  reportIsolatedBoxes(blocks, warnings);
  reportUnreadCells(cells, textRefs, used, blocks, headerRefs[0].row, warnings);

  return {
    geometry,
    blocks,
    warnings,
    textCellCount: textRefs.length,
    usedCellCount: used.size,
  };
}

/**
 * 🔵 `\r\n` 을 `\n` 으로만 바꾼다. 글자를 **고치는 것이 아니라** 줄바꿈 표기를 도형
 * 쪽과 맞추는 것이다 — 제목·본문을 가르는 코드(`split("\n")`)가 양쪽에서 같은 한 벌
 * 이고, `\r` 이 남으면 그 조각들의 꼬리에 보이지 않는 글자가 달라붙는다.
 */
function normalizeCellText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function firstLineOf(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 0 ? line : text.trim();
}

function measureGeometry(
  boxes: readonly CellGridBox[],
  shape: { width: number; height: number; count: number; total: number }
): { geometry: CellGridGeometry | null; warnings: CellGridWarning[] } {
  const warnings: CellGridWarning[] = [];
  const colGap = smallestPositiveGap(boxes.map((b) => b.col));
  const rowGap = smallestPositiveGap(boxes.map((b) => b.row));
  // 🔵 표본이 하나뿐이면 간격을 **못 잰다**(「없다」가 아니다). 그럴 때는 전제값
  //    (상자 크기 + 틈 한 칸)을 쓰되 그 사실을 남긴다.
  const colStep = colGap ?? shape.width + LABEL_GAP;
  const rowStep = rowGap ?? shape.height + LABEL_GAP;
  const reason =
    `병합 ${shape.total}개 가운데 ${shape.count}개가 ${shape.width}칸×${shape.height}줄 — 이것을 상자로 본다. ` +
    `상자 사이 간격은 ${colGap === null ? `표본이 없어 ${colStep}로 가정` : `실측 ${colGap}칸`}(가로) · ` +
    `${rowGap === null ? `표본이 없어 ${rowStep}로 가정` : `실측 ${rowGap}줄`}(세로).`;

  // 🔴 틈이 한 칸이 아니면 이름표 자리를 못 정한다 — 안 읽는다(모듈 머리말).
  if (colStep !== shape.width + LABEL_GAP || rowStep !== shape.height + LABEL_GAP) {
    warnings.push({
      code: "IRREGULAR_GRID",
      severity: "ERROR",
      ref: null,
      blockHeaderRef: null,
      message:
        `${reason} 🔴 상자 사이의 틈이 ${LABEL_GAP}칸이어야 이름표·화살표 자리가 하나로 정해지는데, ` +
        `가로 ${colStep - shape.width}칸 · 세로 ${rowStep - shape.height}줄입니다 — ` +
        "이 시트를 셀 격자 흐름도로 읽지 않았습니다(찍어서 읽으면 흐름이 조용히 틀립니다).",
    });
    return { geometry: null, warnings };
  }

  // 상자 열이 전부 같은 간격 위에 서 있는가. 🔵 줄은 블록마다 시작이 달라 여기서
  //    못 본다 — 블록을 가른 뒤 `checkBlockRowSpacing` 이 본다.
  const minCol = Math.min(...boxes.map((b) => b.col));
  const offGrid = boxes.filter((b) => (b.col - minCol) % colStep !== 0);
  if (offGrid.length > 0) {
    warnings.push({
      code: "IRREGULAR_GRID",
      severity: "WARNING",
      ref: offGrid[0].ref,
      blockHeaderRef: null,
      message:
        `상자 ${offGrid.length}개가 ${colStep}칸 간격의 열 위에 서 있지 않습니다 ` +
        `(${offGrid.slice(0, 5).map((b) => b.ref).join(", ")}) — 가로 이음을 못 찾을 수 있습니다.`,
    });
  }

  return {
    geometry: { boxWidth: shape.width, boxHeight: shape.height, colStep, rowStep, reason },
    warnings,
  };
}

function checkBlockRowSpacing(
  block: CellGridBlock,
  geometry: CellGridGeometry,
  warnings: CellGridWarning[]
): void {
  if (block.boxes.length === 0) return;
  const firstRow = Math.min(...block.boxes.map((b) => b.row));
  const offGrid = block.boxes.filter((b) => (b.row - firstRow) % geometry.rowStep !== 0);
  if (offGrid.length === 0) return;
  warnings.push({
    code: "IRREGULAR_BLOCK_ROWS",
    severity: "WARNING",
    ref: offGrid[0].ref,
    blockHeaderRef: block.headerRef,
    message:
      `"${block.label}" 블록의 상자 ${offGrid.length}개가 ${geometry.rowStep}줄 간격 위에 서 있지 않습니다 ` +
      `(${offGrid.slice(0, 5).map((b) => b.ref).join(", ")}) — 세로 이음을 못 찾을 수 있습니다.`,
  });
}

type LinkContext = {
  cells: Readonly<Record<string, string>>;
  geometry: CellGridGeometry;
  boxByRef: ReadonlyMap<string, CellGridBox>;
  block: CellGridBlock;
  blocks: readonly CellGridBlock[];
  used: Set<string>;
  warnings: CellGridWarning[];
};

/**
 * 상자 하나에서 **오른쪽**과 **아래쪽**으로 나가는 이음을 읽는다.
 *
 * 자리는 전부 `geometry` 에서 나온다(상자 크기와 틈 한 칸):
 * ```
 *   가로:  이름표 = (col + 너비, row)                화살표 = (col + 너비, row + 높이 - 1)
 *   세로:  이름표 = (col,        row + 높이)         화살표 = (col + 너비 - 1, row + 높이)
 *   건너편 상자: 가로 (col + colStep, row) · 세로 (col, row + rowStep)
 * ```
 * 🔴 **이름표가 있어야 이음이다.** 화살표만으로는 갈래를 못 정한다 — 그런 칸은
 * 선을 만들지 않고 경고로 올린다.
 */
function readLinksFrom(box: CellGridBox, ctx: LinkContext): CellGridLink[] {
  const { geometry } = ctx;
  const links: CellGridLink[] = [];

  const sides = [
    {
      direction: "HORIZONTAL" as const,
      labelRef: cellRefOf(box.col + geometry.boxWidth, box.row),
      arrowRef: cellRefOf(box.col + geometry.boxWidth, box.row + geometry.boxHeight - 1),
      targetRef: cellRefOf(box.col + geometry.colStep, box.row),
      arrowTexts: HORIZONTAL_ARROW_TEXTS,
      expected: "NORMAL" as ProcedureBranchType,
      word: "가로",
    },
    {
      direction: "VERTICAL" as const,
      labelRef: cellRefOf(box.col, box.row + geometry.boxHeight),
      arrowRef: cellRefOf(box.col + geometry.boxWidth - 1, box.row + geometry.boxHeight),
      targetRef: cellRefOf(box.col, box.row + geometry.rowStep),
      arrowTexts: VERTICAL_ARROW_TEXTS,
      expected: "NG" as ProcedureBranchType,
      word: "세로",
    },
  ];

  for (const side of sides) {
    const labelText = ctx.cells[side.labelRef];
    const arrowText = ctx.cells[side.arrowRef];
    if (labelText === undefined || labelText.trim() === "") {
      // 화살표만 있고 이름표가 없다 — 갈래를 못 정하므로 선을 안 만든다.
      if (arrowText !== undefined && side.arrowTexts.has(arrowText.trim())) {
        ctx.used.add(side.arrowRef);
        ctx.warnings.push({
          code: "ORPHAN_ARROW",
          severity: "WARNING",
          ref: side.arrowRef,
          blockHeaderRef: ctx.block.headerRef,
          message:
            `"${firstLineOf(box.text)}"(${box.ref})의 ${side.word} 화살표(${side.arrowRef})는 있는데 ` +
            `이름표 칸(${side.labelRef})이 비어 있습니다 — 어느 갈래인지 정할 수 없어 선을 만들지 않았습니다.`,
        });
      }
      continue;
    }

    const normalized = normalizeCellText(labelText).replace(/\n/g, " ").trim();
    const branch = classifyUnifiedBranchLabel(normalized);
    if (branch.branchType !== "NORMAL" && branch.branchType !== "NG") {
      // 🔴 **지어내지 않는다.** 분기 어휘가 아닌 글자가 이름표 자리에 있으면 그 칸이
      //    무엇인지 우리가 모르는 것이다. 칸은 「읽었다」로 표시하되(같은 칸이 아래
      //    「읽다 만 칸」에서 또 뜨면 한 일이 두 번 보고된다) 선은 안 만든다.
      ctx.used.add(side.labelRef);
      ctx.warnings.push({
        code: "UNKNOWN_LABEL_WORD",
        severity: "WARNING",
        ref: side.labelRef,
        blockHeaderRef: ctx.block.headerRef,
        message:
          `"${firstLineOf(box.text)}"(${box.ref})의 ${side.word} 이름표 자리(${side.labelRef})에 ` +
          `분기 어휘가 아닌 글자가 있습니다: "${normalized}" — 선을 만들지 않았습니다.`,
      });
      continue;
    }

    const target = ctx.boxByRef.get(side.targetRef);
    if (!target) {
      ctx.used.add(side.labelRef);
      if (arrowText !== undefined) ctx.used.add(side.arrowRef);
      ctx.warnings.push({
        code: "MISSING_TARGET_BOX",
        severity: "WARNING",
        ref: side.labelRef,
        blockHeaderRef: ctx.block.headerRef,
        message:
          `"${firstLineOf(box.text)}"(${box.ref})에 ${side.word} 이름표 "${normalized}"가 붙어 있는데 ` +
          `그 너머(${side.targetRef})에 상자가 없습니다 — 선을 지어내지 않았습니다.`,
      });
      continue;
    }

    ctx.used.add(side.labelRef);
    let boundArrowRef: string | null = null;
    if (arrowText !== undefined && side.arrowTexts.has(arrowText.trim())) {
      boundArrowRef = side.arrowRef;
      ctx.used.add(side.arrowRef);
    } else {
      ctx.warnings.push({
        code: "MISSING_ARROW",
        severity: "INFO",
        ref: side.arrowRef,
        blockHeaderRef: ctx.block.headerRef,
        message:
          `"${firstLineOf(box.text)}"(${box.ref}) → "${firstLineOf(target.text)}"(${target.ref}) 의 ` +
          `${side.word} 화살표 칸(${side.arrowRef})이 ` +
          (arrowText === undefined ? "비어 있습니다" : `"${arrowText.trim()}" 입니다`) +
          " — 이름표가 있으므로 선은 만들었습니다.",
      });
    }

    if (branch.branchType !== side.expected) {
      // 🔵 **글자가 이긴다.** 방향은 교차 검사일 뿐이다 — 글자를 뒤집으면 엑셀에
      //    없는 흐름을 만드는 일이 된다. 실측 0건.
      ctx.warnings.push({
        code: "UNEXPECTED_DIRECTION",
        severity: "WARNING",
        ref: side.labelRef,
        blockHeaderRef: ctx.block.headerRef,
        message:
          `${side.word} 이음인데 이름표가 "${normalized}"(${branch.branchType})입니다 — ` +
          `이 시트는 ${side.word}가 ${side.expected} 였습니다. 글자대로 읽었으니 한 번 보세요.`,
      });
    }

    links.push({
      fromRef: box.ref,
      toRef: target.ref,
      direction: side.direction,
      labelRef: side.labelRef,
      labelText: normalized,
      branchType: branch.branchType,
      branchLabel: branch.branchLabel,
      arrowRef: boundArrowRef,
      arrowText: boundArrowRef === null ? null : (arrowText ?? "").trim(),
    });
  }

  return links;
}

function reportIsolatedBoxes(blocks: readonly CellGridBlock[], warnings: CellGridWarning[]): void {
  for (const block of blocks) {
    const touched = new Set<string>();
    for (const link of block.links) {
      touched.add(link.fromRef);
      touched.add(link.toRef);
    }
    for (const box of block.boxes) {
      if (touched.has(box.ref)) continue;
      warnings.push({
        code: "ISOLATED_BOX",
        severity: "WARNING",
        ref: box.ref,
        blockHeaderRef: block.headerRef,
        message:
          `상자 "${firstLineOf(box.text)}"(${box.ref})에 들어오는 선도 나가는 선도 없습니다 — ` +
          "노드로는 만들지만 흐름에서 떨어져 있습니다.",
      });
    }
  }
}

/**
 * 🔴 글자가 있는데 끝까지 아무 쓰임도 못 찾은 칸.
 *
 * 블록 **안**이면 흐름의 일부일 수 있으므로 WARNING, 첫 블록 **앞**(시트 제목 따위)
 * 이면 INFO 다 — 사람이 할 일이 다르다.
 */
function reportUnreadCells(
  cells: Readonly<Record<string, string>>,
  textRefs: readonly string[],
  used: ReadonlySet<string>,
  blocks: readonly CellGridBlock[],
  firstHeaderRow: number,
  warnings: CellGridWarning[]
): void {
  for (const ref of textRefs) {
    if (used.has(ref)) continue;
    const text = cells[ref];
    if (text === undefined || text.trim() === "") continue;
    let row: number;
    try {
      row = splitCellRef(ref).row;
    } catch {
      row = 0;
    }
    const block = blocks.find((b) => row >= b.headerRow && row <= b.endRow) ?? null;
    const before = row < firstHeaderRow;
    warnings.push({
      code: "UNREAD_CELL",
      severity: before ? "INFO" : "WARNING",
      ref,
      blockHeaderRef: block?.headerRef ?? null,
      message:
        `칸 ${ref} 의 글자 "${firstLineOf(normalizeCellText(text))}"를 상자·이름표·화살표·블록 머리글 ` +
        `어느 쪽으로도 못 읽었습니다` +
        (before ? " (첫 블록보다 위 — 시트 머리말로 보입니다)." : ` ("${block?.label ?? "블록 밖"}" 자리).`),
    });
  }
}

/**
 * 상자의 **그림 자리**(픽셀). 받침일 뿐이고 화면은 자동 배치를 쓴다
 * (`CELL_WIDTH_PX` 주석 참고).
 */
export function cellGridPosition(box: CellGridBox): { positionX: number; positionY: number } {
  return { positionX: (box.col - 1) * CELL_WIDTH_PX, positionY: (box.row - 1) * CELL_HEIGHT_PX };
}

/** 시작 노드를 세울 자리 — 뿌리 상자들의 **가로 가운데**, 한 상자 높이만큼 위. */
export function cellGridStartPosition(
  roots: readonly CellGridBox[],
  geometry: CellGridGeometry
): { positionX: number; positionY: number } {
  if (roots.length === 0) return { positionX: 0, positionY: 0 };
  const centers = roots.map((b) => (b.col - 1 + geometry.boxWidth / 2) * CELL_WIDTH_PX);
  const average = centers.reduce((a, b) => a + b, 0) / centers.length;
  const topRow = Math.min(...roots.map((b) => b.row));
  return {
    positionX: Math.round(average - (geometry.boxWidth * CELL_WIDTH_PX) / 2),
    positionY: Math.round((topRow - 1) * CELL_HEIGHT_PX - geometry.boxHeight * 2 * CELL_HEIGHT_PX),
  };
}
