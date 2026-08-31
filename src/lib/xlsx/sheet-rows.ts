/**
 * ============================================================================
 * 시트의 **줄**을 늘리고 줄인다 — 칸이 아니라 행 단위
 * ============================================================================
 * sheet-patch.ts 는 정해진 칸에 값을 넣는다. 그것만으로 되는 양식은 칸 수가
 * 고정된 것들이고(제너레이터 견적서의 부품 5줄 · OH 부품 13줄), 그래서 이
 * 저장소는 지금까지 줄을 건드릴 일이 없었다.
 *
 * 매쳐 견적서는 다르다. **양식 자체가 가변**이다 — 같은 매쳐인데 내자는 부품
 * 2줄·수리작업 2줄, OH 는 부품 7줄·수리작업 3줄이다. 사람이 그때그때 줄을 넣어
 * 만든 문서라, 담을 것이 많으면 줄이 늘어야 한다.
 *
 * ── 🔴 왜 위험한가 ─────────────────────────────────────────────────────
 * 줄을 하나 밀면 그 아래 **모든 행 번호와 셀 주소**가 바뀐다. 하나라도 놓치면
 * 엑셀이 파일을 못 열거나(복구 대화상자), 조용히 값이 엉뚱한 칸에 앉는다.
 * 그리고 그 결과물은 고객사로 나가는 문서다. 그래서 이 파일은 **순수 문자열
 * 함수만** 두고 시험으로 굳힌다 — 엑셀을 띄우지 않고도 검증할 수 있어야 한다.
 *
 * ── 다루지 않는 것 ──────────────────────────────────────────────────────
 * **수식은 여기서 고치지 않는다.** 행이 밀리면 `SUM(I28:I51)` 같은 범위도 따라
 * 가야 하지만, 임의의 수식을 문자열로 다시 쓰는 것은 조용히 틀리기 쉽다. 매쳐
 * 양식의 수식은 일곱 개뿐이고 어디를 가리키는지 우리가 안다 — 부르는 쪽이
 * 옮겨진 자리를 알고 **필요한 수식만 다시 써 넣는** 편이 안전하다.
 *
 * 병합 칸(mergeCells)도 마찬가지다. 매쳐 양식의 병합은 A1:I1 과 D22:F22 둘뿐이고
 * 둘 다 우리가 늘리는 구간보다 **위**에 있어 영향을 받지 않는다. 아래쪽에 병합이
 * 있는 양식을 다루게 되는 날 이 파일이 그것도 맡아야 한다.
 * ============================================================================
 */

/** `<row r="28" …>…</row>` 하나. */
export type SheetRow = {
  rowNumber: number;
  /** 여는 태그부터 닫는 태그까지 통째로. */
  xml: string;
};

const SHEET_DATA = /<sheetData>([\s\S]*?)<\/sheetData>/;

export class SheetRowError extends Error {}

/**
 * `<sheetData>` 안의 행들을 순서대로. 자기 닫힘 행(`<row r="9"/>`)도 담는다 —
 * 빈 줄에도 높이가 붙어 있어 지우면 문서의 세로 자리가 달라진다.
 */
export function parseSheetRows(sheetXml: string): SheetRow[] {
  const body = SHEET_DATA.exec(sheetXml)?.[1];
  if (body === undefined) throw new SheetRowError("시트에서 <sheetData> 를 찾지 못했습니다.");

  const rows: SheetRow[] = [];
  const pattern = /<row\s[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
  for (const match of body.matchAll(pattern)) {
    rows.push({ rowNumber: Number(match[1]), xml: match[0] });
  }
  if (rows.length === 0) throw new SheetRowError("시트에 행이 하나도 없습니다.");
  return rows;
}

/** 행 목록을 다시 `<sheetData>` 안에 넣는다. 바깥(머리·꼬리)은 그대로 둔다. */
export function writeSheetRows(sheetXml: string, rows: readonly SheetRow[]): string {
  const body = rows.map((row) => row.xml).join("");
  return sheetXml.replace(SHEET_DATA, `<sheetData>${body}</sheetData>`);
}

/**
 * 행 하나의 번호를 바꾼다 — `<row r>` 과 그 안 모든 `<c r>` 을 함께.
 *
 * 🔴 **둘 중 하나만 고치면 엑셀이 파일을 거부한다.** 행 번호와 셀 주소의 숫자가
 * 어긋난 시트는 규격 위반이고, 증상은 "복구할 수 없는 내용이 있습니다" 대화상자다.
 */
export function renumberRow(row: SheetRow, nextRowNumber: number): SheetRow {
  if (row.rowNumber === nextRowNumber) return row;
  const xml = row.xml
    .replace(/(<row\s[^>]*?r=")\d+(")/, `$1${nextRowNumber}$2`)
    .replace(/(<c\s[^>]*?r="[A-Z]+)\d+(")/g, `$1${nextRowNumber}$2`);
  return { rowNumber: nextRowNumber, xml };
}

/** 그 행의 값들을 비운다. 서식(`s=`)과 높이는 그대로 남는다. */
export function blankRow(row: SheetRow): SheetRow {
  // `<c …>…</c>` → `<c …/>` : 속성은 남기고 내용만 없앤다. 자기 닫힘 셀은 그대로.
  const xml = row.xml.replace(/<c(\s[^>]*?)>[\s\S]*?<\/c>/g, "<c$1/>");
  return { ...row, xml };
}

/**
 * 어느 줄에 그 글자가 있는가. 행 번호를 코드에 박지 않기 위한 것이다.
 *
 * 매쳐 양식은 같은 양식이라도 내자와 OH 의 행이 다르다(부품 줄 수가 달라 아래가
 * 통째로 밀려 있다). 행을 박아 두면 양식을 한 줄만 고쳐도 엉뚱한 자리에 값이
 * 앉는다 — **머리글을 찾아 자리를 정한다.**
 *
 * @param textOfCell 그 시트의 셀 하나를 글자로 읽어 주는 함수(공유 문자열 해석 포함).
 */
export function findRowByCellText(
  rows: readonly SheetRow[],
  column: string,
  wanted: string,
  textOfCell: (ref: string) => string | null
): number | null {
  for (const row of rows) {
    const value = textOfCell(`${column}${row.rowNumber}`);
    if (value !== null && value.trim() === wanted) return row.rowNumber;
  }
  return null;
}

/**
 * ============================================================================
 * 구간의 줄 수를 맞춘다 — 이 파일의 본체
 * ============================================================================
 * `firstRow` 부터 `currentCount` 줄이던 구간을 `targetCount` 줄로 만든다.
 *
 *  · 늘릴 때 — 구간의 **마지막 줄을 복제**한다. 사람이 서식을 입혀 둔 줄이라
 *    그대로 복제하면 새 줄도 같은 모양이 된다. 복제한 줄은 값을 비운다.
 *  · 줄일 때 — 뒤에서부터 지운다.
 *  · 그리고 **그 아래 모든 행을 밀거나 당긴다.**
 *
 * 🔴 **여러 구간을 고칠 때는 아래에서부터 부른다.** 위를 먼저 고치면 아래 구간의
 * firstRow 가 이미 밀려 있어 엉뚱한 줄을 잡는다. 부르는 쪽이 지켜야 하는 규칙이라
 * 여기서 강제하지 못한다 — 대신 이 함수는 **몇 줄이 밀렸는지 돌려준다.**
 * ============================================================================
 */
export function resizeRowBlock(
  rows: readonly SheetRow[],
  params: { firstRow: number; currentCount: number; targetCount: number }
): { rows: SheetRow[]; delta: number } {
  const { firstRow, currentCount, targetCount } = params;
  if (currentCount < 0 || targetCount < 0) {
    throw new SheetRowError("구간의 줄 수는 음수일 수 없습니다.");
  }
  const delta = targetCount - currentCount;
  if (delta === 0) return { rows: [...rows], delta: 0 };

  const lastRow = firstRow + currentCount - 1;
  const before: SheetRow[] = [];
  const inside: SheetRow[] = [];
  const after: SheetRow[] = [];
  for (const row of rows) {
    if (row.rowNumber < firstRow) before.push(row);
    else if (row.rowNumber <= lastRow) inside.push(row);
    else after.push(row);
  }

  let nextInside: SheetRow[];
  if (delta > 0) {
    // 복제할 본이 필요하다. 구간이 비어 있으면(currentCount 0) 복제할 것이 없다 —
    // 그때는 부르는 쪽이 양식에 최소 한 줄은 두어야 한다. 조용히 서식 없는 줄을
    // 만들면 문서에서 그 줄만 모양이 다르다.
    const model = inside[inside.length - 1];
    if (!model) {
      throw new SheetRowError(
        `${firstRow}행 구간이 비어 있어 늘릴 본이 없습니다. 양식에 줄을 하나 이상 두어야 합니다.`
      );
    }
    nextInside = [...inside];
    for (let i = 0; i < delta; i += 1) {
      nextInside.push(blankRow({ ...model, rowNumber: lastRow + 1 + i }));
    }
  } else {
    nextInside = inside.slice(0, targetCount);
  }

  // 구간 안을 firstRow 부터 다시 번호 매기고, 아래를 delta 만큼 민다.
  const renumberedInside = nextInside.map((row, index) => renumberRow(row, firstRow + index));
  const renumberedAfter = after.map((row) => renumberRow(row, row.rowNumber + delta));

  return { rows: [...before, ...renumberedInside, ...renumberedAfter], delta };
}

/**
 * `<dimension ref="A1:I77"/>` 의 마지막 행을 실제와 맞춘다.
 *
 * 엑셀은 이 값이 실제보다 작아도 대개 알아서 읽지만, 인쇄 범위와 스크롤 끝을
 * 정하는 데 쓰는 프로그램이 있어 어긋난 채 두지 않는다.
 */
export function syncDimension(sheetXml: string, rows: readonly SheetRow[]): string {
  const lastRow = rows.reduce((max, row) => Math.max(max, row.rowNumber), 0);
  return sheetXml.replace(
    /(<dimension\s+ref="[A-Z]+\d+:[A-Z]+)\d+(")/,
    `$1${lastRow}$2`
  );
}
