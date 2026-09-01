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
 * ── 병합 칸·범위는 **부르는 쪽이 골라서** 민다 ─────────────────────────
 * 매쳐 견적서의 병합은 A1:I1 과 D22:F22 둘뿐이고 둘 다 늘리는 구간보다 **위**라
 * 영향을 받지 않는다. 그래서 세 견적서 채우개는 병합을 밀지 않는다.
 *
 * 검사·수리 보고서 양식은 다르다 — 병합이 221개고 본문 아래에 비고·담당·승인·
 * 문서번호가 병합으로 들어 있다. 그것들을 안 밀면 문서가 통째로 어긋난다.
 *
 * 🔴 그래서 미는 일을 `resizeRowBlock` **안에 넣지 않았다.** 넣었다면 견적서
 * 채우개 셋의 동작이 함께 바뀐다. 아래의 `shiftMergeCellRows`·
 * `cloneRowMergeCells`·`shiftSqrefRows` 는 **부르는 쪽이 필요할 때만 부르는**
 * 별도 함수다. 부르지 않으면 예전과 한 글자도 다르지 않다.
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

/**
 * 그 행의 값들을 비운다. 서식(`s=`)과 높이는 그대로 남는다.
 *
 * 🔴 **여는 태그의 마지막 글자가 `/` 이면 안 된다.** 그것은 이미 빈 칸
 * (`<c r="A29" s="80"/>`)이라 비울 것이 없는데, 여는 태그로 잘못 읽으면 그 뒤의
 * `</c>` 까지를 '내용'으로 삼아 **사이에 있던 셀들을 통째로 먹는다.** 실제
 * 양식은 빈 칸이 절반이라 이 실수는 반드시 터진다.
 */
export function blankRow(row: SheetRow): SheetRow {
  // `<c …>…</c>` → `<c …/>` : 속성은 남기고 내용만 없앤다.
  const xml = row.xml.replace(/<c(\s[^>]*?[^/])>[\s\S]*?<\/c>/g, "<c$1/>");
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
 *
 * ── 🔴 줄이 0개인 구간도 늘릴 수 있다 — `modelRow` ─────────────────────
 * 제너레이터 양식의 「② 수리 작업」 은 머리글만 있고 그 아래에 줄이 하나도 없다.
 * 구간 안에 복제할 본이 없으니 예전에는 여기서 던졌고, 그래서 그 구역은 통째로
 * 비어 나갔다.
 *
 * 양식에 손으로 빈 줄을 넣어 푸는 길은 택하지 않는다 — 이 양식들은 사람이 건마다
 * 다시 저장하는 문서라 다음 판에서 그대로 다시 깨지고, 그때 증상은 견적서
 * 내려받기가 통째로 실패하는 것이다. 대신 **부르는 쪽이 "이 행을 본으로 써라"고
 * 건네준다**(같은 서식의 다른 묶음 줄). 그래도 본이 하나도 없으면 던진다 —
 * 서식 없는 줄을 조용히 만들면 문서에서 그 줄만 모양이 다르다.
 * ============================================================================
 */
export function resizeRowBlock(
  rows: readonly SheetRow[],
  params: {
    firstRow: number;
    currentCount: number;
    targetCount: number;
    /**
     * 구간이 비어 있을 때 복제할 본의 행 번호. 구간 안에 줄이 하나라도 있으면
     * **그쪽이 이긴다** — 그 묶음의 제 서식을 지키는 편이 맞다.
     */
    modelRow?: number;
  }
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
    // 복제할 본이 필요하다. 구간 안의 마지막 줄이 1순위고, 구간이 비어 있으면
    // (currentCount 0) 부르는 쪽이 건네준 `modelRow` 를 쓴다. 둘 다 없으면
    // 던진다 — 조용히 서식 없는 줄을 만들면 문서에서 그 줄만 모양이 다르다.
    const model =
      inside[inside.length - 1] ??
      (params.modelRow === undefined
        ? undefined
        : rows.find((row) => row.rowNumber === params.modelRow));
    if (!model) {
      throw new SheetRowError(
        `${firstRow}행 구간이 비어 있어 늘릴 본이 없습니다. 양식에 줄을 하나 이상 두거나 ` +
          `복제할 본(modelRow)을 건네주어야 합니다.`
      );
    }
    nextInside = [...inside];
    for (let i = 0; i < delta; i += 1) {
      // 🔴 복제본은 **본의 행 번호를 그대로 달고 나온다.** 여기서 미리 번호만
      // 갈아 끼우면 메타의 번호와 XML 의 `r=` 이 어긋나고, 바로 아래 renumberRow
      // 의 '이미 그 번호다' 지름길이 그 거짓말을 믿어 XML 을 안 고친다 — 같은
      // 주소의 셀이 여러 개인 시트가 만들어진다.
      nextInside.push(blankRow(model));
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
 * ============================================================================
 * 행이 밀리면 함께 밀려야 하는 것들 — **부르는 쪽이 골라서** 부른다
 * ============================================================================
 * `resizeRowBlock` 은 `<sheetData>` 안의 행만 다시 번호 매긴다. 시트에는 행
 * 번호를 들고 있는 곳이 그것 말고도 여럿이고, 하나라도 빠뜨리면 문서가 조용히
 * 어긋난다. 아래 함수들은 그 나머지를 맡되 **따로 부르게** 두었다 — 견적서
 * 채우개 셋은 이것들을 부르지 않으므로 동작이 바뀌지 않는다.
 * ============================================================================
 */

/** `A1:B2` 또는 `$A$1:$B$2`, 그리고 한 칸짜리 `A1` 을 행 번호만 민다. */
function shiftRangeRows(reference: string, fromRow: number, delta: number): string {
  return reference.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (whole, d1, column, d2, row) => {
    const rowNumber = Number(row);
    return rowNumber >= fromRow ? `${d1}${column}${d2}${rowNumber + delta}` : whole;
  });
}

const MERGE_CELLS = /<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/;

function readMergeRefs(sheetXml: string): string[] | null {
  const block = MERGE_CELLS.exec(sheetXml);
  if (!block) return null;
  return [...block[1].matchAll(/<mergeCell[^>]*\sref="([^"]+)"/g)].map((match) => match[1]);
}

/**
 * `<mergeCells>` 를 통째로 다시 쓴다. `count` 는 **셈해서** 넣는다 — 실제
 * 개수와 어긋난 `count` 는 Excel 이 파일 열기를 거부하는 사유다.
 */
function writeMergeRefs(sheetXml: string, refs: readonly string[]): string {
  const body = refs.map((ref) => `<mergeCell ref="${ref}"/>`).join("");
  // 바꿔 넣을 글자를 함수로 돌려준다 — 문자열로 주면 `$&` 같은 것이 해석된다.
  return sheetXml.replace(
    MERGE_CELLS,
    () => `<mergeCells count="${refs.length}">${body}</mergeCells>`
  );
}

/**
 * 삽입 지점(`fromRow`) 이상의 병합 칸을 `delta` 만큼 민다.
 *
 * 삽입 지점을 **걸치는** 병합(위에서 시작해 아래에서 끝나는 것)은 밀리지 않고
 * **늘어난다** — 시작 행은 그대로, 끝 행만 밀리기 때문이다. 그것이 엑셀에서
 * 사람이 행을 끼워 넣었을 때와 같은 결과다.
 */
export function shiftMergeCellRows(sheetXml: string, fromRow: number, delta: number): string {
  if (delta === 0) return sheetXml;
  const refs = readMergeRefs(sheetXml);
  if (refs === null) return sheetXml;
  return writeMergeRefs(
    sheetXml,
    refs.map((ref) => shiftRangeRows(ref, fromRow, delta))
  );
}

/**
 * 새로 생긴 줄에도 병합을 만들어 준다.
 *
 * 어떤 병합이 필요한지는 **양식이 알려 준다** — 본으로 삼은 줄(`modelRow`)에
 * 걸려 있는 한 줄짜리 병합(`C58:G58`·`H58:AU58`)을 그대로 새 줄 번호로 복제한다.
 * 행을 코드에 박지 않는 것과 같은 이유로 병합 범위도 박지 않는다.
 *
 * 여러 줄에 걸친 병합은 복제하지 않는다 — 그런 것(`C60:G63` 같은 라벨 칸)은
 * 한 줄만 떼어 복제하면 뜻이 달라진다.
 */
export function cloneRowMergeCells(
  sheetXml: string,
  modelRow: number,
  newRows: readonly number[]
): string {
  if (newRows.length === 0) return sheetXml;
  const refs = readMergeRefs(sheetXml);
  if (refs === null) return sheetXml;

  const models: { startColumn: string; endColumn: string }[] = [];
  for (const ref of refs) {
    const found = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
    if (!found) continue;
    if (Number(found[2]) !== modelRow || Number(found[4]) !== modelRow) continue;
    models.push({ startColumn: found[1], endColumn: found[3] });
  }
  if (models.length === 0) {
    throw new SheetRowError(
      `${modelRow}행에 한 줄짜리 병합이 없어 새 줄의 병합을 만들 수 없습니다.`
    );
  }

  const added: string[] = [];
  const existing = new Set(refs);
  for (const row of newRows) {
    for (const model of models) {
      const ref = `${model.startColumn}${row}:${model.endColumn}${row}`;
      // 🔴 같은 범위를 두 번 담지 않는다 — 중복된 병합은 Excel 이 거부한다.
      if (existing.has(ref)) continue;
      existing.add(ref);
      added.push(ref);
    }
  }
  return writeMergeRefs(sheetXml, [...refs, ...added]);
}

/**
 * 조건부 서식(`conditionalFormatting sqref=`)과 데이터 유효성 검사
 * (`dataValidation sqref=`)의 범위를 민다. 안 밀면 삽입 지점 아래에 걸려 있던
 * 서식·드롭다운이 **엉뚱한 줄에 남는다.**
 *
 * ⚠️ `sqref` 는 공백으로 나뉜 여러 범위를 담을 수 있다
 * (`P29:Q30 AF29:AG30 X27:Y30`). 통째로 정규식을 돌리면 될 것 같지만, 범위마다
 * 따로 밀어야 한 칸짜리 범위(`AY30`)도 함께 맞는다.
 */
export function shiftSqrefRows(sheetXml: string, fromRow: number, delta: number): string {
  if (delta === 0) return sheetXml;
  return sheetXml.replace(/sqref="([^"]+)"/g, (_whole, value: string) => {
    const shifted = value
      .split(/\s+/)
      .map((range) => shiftRangeRows(range, fromRow, delta))
      .join(" ");
    return `sqref="${shifted}"`;
  });
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
