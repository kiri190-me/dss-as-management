import { createHash } from "node:crypto";
import { readSheetGrid, type SheetGrid } from "@/lib/xlsx/sheet-grid";
import { validateRepairCaseXlsxBuffer } from "@/lib/xlsx/xlsx-upload-safety";
import { ZipArchive } from "@/lib/xlsx/zip-reader";
import { KYOSAN_SHEET_NAME, columnOf, findHeaderRow, verifyHeaders, type KyosanColumnField } from "./columns";
import {
  assertDateOnly,
  cellToDate,
  cellToIdentifier,
  classifyKyosanRows,
  normalizeIdentifier,
  type KyosanExtractedRow,
} from "./rules";
import type { KyosanParseResult, KyosanRawRow } from "./types";

/**
 * ============================================================================
 * 교산 인수품 리스트 xlsx → 줄마다 판정 — S1 의 입구
 * ============================================================================
 * 순서:
 *  1. 안전 검사(매크로·외부 연결·압축 폭탄 등) — 걸리면 UNSAFE_FILE
 *  2. 시트 `リスト` 찾기 — 없으면 SHEET_NOT_FOUND
 *  3. 머리글 행 찾기(C열의 `引取番号`) — 없으면 HEADER_NOT_FOUND
 *  4. 지정 열 13개의 머리글 대조 — 하나라도 다르면 HEADER_MISMATCH(파일 전체 거절)
 *  5. 머리글 아래 줄들을 뽑아 판정. **지정 열이 전부 빈 줄은 버린다**(세지도 않는다) —
 *     원본은 600줄 가운데 대부분이 일련번호(B)·X·AA 만 있는 빈 틀이다.
 *
 * DB 를 보지 않는다. 같은 인수번호가 DB 에 이미 있는지, 고객사·모델이 목록에 있는지는
 * S2(서버 액션)가 이 결과를 받아 본다.
 *
 * `today` 는 인자로 받는다(출하일이 미래인지 볼 때 쓴다) — 시계를 여기서 읽으면
 * 시험이 날짜에 따라 달라진다.
 * ============================================================================
 */
export function parseKyosanIntakeWorkbook(
  bytes: Buffer,
  fileName: string,
  options: { today: string }
): KyosanParseResult {
  assertDateOnly(options.today, "today");

  const safety = validateRepairCaseXlsxBuffer(bytes, fileName);
  if (!safety.ok) {
    const safetyCodes = safety.issues
      .filter((issue) => issue.severity === "ERROR")
      .map((issue) => issue.code);
    return {
      ok: false,
      code: "UNSAFE_FILE",
      message: `안전 검사를 통과하지 못한 파일입니다(${safetyCodes.join(", ")}). 매크로·외부 연결이 없는 보통 .xlsx 로 다시 저장해 올려 주세요.`,
      safetyCodes,
    };
  }

  const grid = readSheetGrid(ZipArchive.fromBuffer(bytes), KYOSAN_SHEET_NAME);
  if (!grid) {
    return {
      ok: false,
      code: "SHEET_NOT_FOUND",
      message: `"${KYOSAN_SHEET_NAME}" 시트를 찾지 못했습니다. 교산 인수품 리스트 원본(시트 ${KYOSAN_SHEET_NAME} 가 있는 파일)인지 확인해 주세요.`,
    };
  }

  const headerRow = findHeaderRow(grid);
  if (headerRow === null) {
    return {
      ok: false,
      code: "HEADER_NOT_FOUND",
      message: `"${KYOSAN_SHEET_NAME}" 시트의 ${columnOf("intakeNumber")}열에서 머리글(引取番号)을 찾지 못했습니다.`,
    };
  }

  const mismatches = verifyHeaders(grid, headerRow);
  if (mismatches.length > 0) {
    const details = mismatches
      .map(
        (mismatch) =>
          `${mismatch.column}열은 ${mismatch.expected} 이어야 하는데 ${
            mismatch.actual === null ? "비어 있습니다" : `"${mismatch.actual}" 입니다`
          }`
      )
      .join(" · ");
    return {
      ok: false,
      code: "HEADER_MISMATCH",
      message: `"${KYOSAN_SHEET_NAME}" 시트 ${headerRow}행의 머리글이 예상과 다릅니다 — ${details}. 열이 옮겨졌거나 다른 양식의 파일일 수 있습니다.`,
      mismatches,
    };
  }

  return {
    ok: true,
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
    sheetName: KYOSAN_SHEET_NAME,
    headerRow,
    rows: classifyKyosanRows(extractRows(grid, headerRow), options),
  };
}

/** 머리글 아래 줄들. 지정 열이 전부 빈 줄은 넣지 않는다. */
function extractRows(grid: SheetGrid, headerRow: number): KyosanExtractedRow[] {
  const rows: KyosanExtractedRow[] = [];
  for (const rowNumber of grid.rowNumbers) {
    if (rowNumber <= headerRow) continue;
    const cells = grid.cells(rowNumber);
    const text = (field: KyosanColumnField) => cellToIdentifier(cells.get(columnOf(field)));
    const receivedDate = cellToDate(cells.get(columnOf("receivedAt")), grid.date1904);
    const shippedDate = cellToDate(cells.get(columnOf("shippedAt")), grid.date1904);

    const raw: KyosanRawRow = {
      rowNumber,
      intakeNumber: normalizeIdentifier(text("intakeNumber")),
      receivedAt: receivedDate.kind === "date" ? receivedDate.date : null,
      modelName: text("modelName"),
      kindText: text("kindText"),
      lotNumber: normalizeIdentifier(text("lotNumber")),
      serialNumber: normalizeIdentifier(text("serialNumber")),
      customerName: text("customerName"),
      endUserName: text("endUserName"),
      reportedSymptom: text("reportedSymptom"),
      statusText: text("statusText"),
      shippedAt: shippedDate.kind === "date" ? shippedDate.date : null,
      reportNumber: text("reportNumber"),
      billingText: text("billingText"),
    };

    if (isBlankRow(raw, receivedDate.kind === "empty" && shippedDate.kind === "empty")) continue;
    rows.push({ raw, receivedDate, shippedDate });
  }
  return rows;
}

function isBlankRow(raw: KyosanRawRow, datesEmpty: boolean): boolean {
  return (
    datesEmpty &&
    raw.intakeNumber === null &&
    raw.modelName === null &&
    raw.kindText === null &&
    raw.lotNumber === null &&
    raw.serialNumber === null &&
    raw.customerName === null &&
    raw.endUserName === null &&
    raw.reportedSymptom === null &&
    raw.statusText === null &&
    raw.reportNumber === null &&
    raw.billingText === null
  );
}
