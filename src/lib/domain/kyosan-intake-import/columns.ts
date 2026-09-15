import type { GridCell, SheetGrid } from "@/lib/xlsx/sheet-grid";
import type { KyosanHeaderMismatch, KyosanRawRow } from "./types";

/**
 * ============================================================================
 * 교산 인수품 리스트 — 어느 열을 읽는가, 머리글이 맞는가
 * ============================================================================
 * 시트 `リスト` 의 머리글 칸은 일본어⏎한국어 두 줄이다. **첫 줄(일본어)** 을 NFKC ·
 * 공백 제거 뒤 대조한다. 지정한 열 가운데 하나라도 다르면 파일 전체를 거절한다 —
 * 열이 한 칸 밀린 파일을 조용히 읽으면 고객사 칸에 모델이 들어가는 식의 사고가
 * 수백 건 한꺼번에 난다.
 *
 * 머리글 행 번호는 박지 않는다(샘플은 17행). C열에 `引取番号` 가 들어 있는 첫 행을
 * 머리글로 본다 — 위쪽 범례가 한 줄만 늘어도 행 번호는 바뀐다.
 *
 * 여기 없는 열은 읽지 않는다.
 * ============================================================================
 */

export const KYOSAN_SHEET_NAME = "リスト";

/** 머리글 행을 찾는 표지 — C열 칸 글자(NFKC 후)에 들어 있어야 한다. */
export const KYOSAN_HEADER_ANCHOR = "引取番号";

export type KyosanColumnField = Exclude<keyof KyosanRawRow, "rowNumber">;

export type KyosanColumnSpec = {
  readonly field: KyosanColumnField;
  /** 열 문자. */
  readonly column: string;
  /** 머리글 첫 줄. */
  readonly header: string;
  /** 사유 문구에 쓰는 한국어 이름. */
  readonly label: string;
};

/**
 * 필드 → 열. `Record` 로 적어 두면 KyosanRawRow 에 필드가 늘거나 줄 때 여기서
 * 컴파일이 깨진다 — 한 열을 빠뜨린 채 도는 일이 없다. 적는 순서가 곧 열 순서다.
 */
const COLUMN_SPECS: Readonly<Record<KyosanColumnField, Omit<KyosanColumnSpec, "field">>> = {
  intakeNumber: { column: "C", header: "引取番号", label: "인수번호" },
  receivedAt: { column: "D", header: "引取日", label: "인수일" },
  modelName: { column: "F", header: "型式", label: "모델" },
  kindText: { column: "G", header: "種別", label: "종류" },
  lotNumber: { column: "H", header: "L/N", label: "L/N" },
  serialNumber: { column: "I", header: "S/N", label: "S/N" },
  customerName: { column: "J", header: "客先名称", label: "고객사" },
  endUserName: { column: "K", header: "End-User", label: "END-USER" },
  reportedSymptom: { column: "L", header: "客先返却理由", label: "신고증상" },
  statusText: { column: "O", header: "状態", label: "상태" },
  shippedAt: { column: "S", header: "出荷日", label: "출하일" },
  reportNumber: { column: "V", header: "報告書番号", label: "보고서 번호" },
  billingText: { column: "Y", header: "費用", label: "유/무상" },
};

export const KYOSAN_COLUMNS: readonly KyosanColumnSpec[] = (
  Object.keys(COLUMN_SPECS) as KyosanColumnField[]
).map((field) => ({ field, ...COLUMN_SPECS[field] }));

export function columnOf(field: KyosanColumnField): string {
  return COLUMN_SPECS[field].column;
}

/** 사유 문구의 칸 이름 — `S/N(I열)`. */
export function columnCaption(field: KyosanColumnField): string {
  const spec = COLUMN_SPECS[field];
  return `${spec.label}(${spec.column}열)`;
}

/** 머리글 칸의 첫 줄(trim). 비었으면 null. */
export function headerFirstLine(cell: GridCell | undefined): string | null {
  if (!cell) return null;
  const text = cell.kind === "text" ? cell.text : String(cell.value);
  const firstLine = text.trim().split(/\r\n|\r|\n/)[0].trim();
  return firstLine === "" ? null : firstLine;
}

/** 머리글 대조 키 — NFKC, 공백 전부 제거. */
export function headerKey(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "");
}

/** C열 글자(NFKC 후)에 `引取番号` 가 들어 있는 첫 행. 없으면 null. */
export function findHeaderRow(grid: Pick<SheetGrid, "rowNumbers" | "cells">): number | null {
  const anchorColumn = columnOf("intakeNumber");
  for (const rowNumber of grid.rowNumbers) {
    const cell = grid.cells(rowNumber).get(anchorColumn);
    if (cell?.kind === "text" && cell.text.normalize("NFKC").includes(KYOSAN_HEADER_ANCHOR)) {
      return rowNumber;
    }
  }
  return null;
}

/** 지정 열 가운데 머리글 첫 줄이 다른 것들. 빈 배열이면 전부 맞다. */
export function verifyHeaders(
  grid: Pick<SheetGrid, "cells">,
  headerRow: number
): KyosanHeaderMismatch[] {
  const cells = grid.cells(headerRow);
  const mismatches: KyosanHeaderMismatch[] = [];
  for (const spec of KYOSAN_COLUMNS) {
    const actual = headerFirstLine(cells.get(spec.column));
    if (actual === null || headerKey(actual) !== headerKey(spec.header)) {
      mismatches.push({ column: spec.column, expected: spec.header, actual });
    }
  }
  return mismatches;
}
