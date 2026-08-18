export const EXCEL_IMPORT_PREVIEW_FILTERS = [
  "ALL",
  "EXECUTABLE",
  "AUTO_EXCLUDED",
  "CONFLICT",
  "IMPORTED",
] as const;

export type ExcelImportPreviewFilter = (typeof EXCEL_IMPORT_PREVIEW_FILTERS)[number];
export type ExcelImportPreviewClassification = Exclude<ExcelImportPreviewFilter, "ALL"> | "FAILED";

export const EXCEL_IMPORT_PREVIEW_FILTER_LABELS: Readonly<Record<ExcelImportPreviewFilter, string>> = {
  ALL: "전체",
  EXECUTABLE: "접수 가능",
  AUTO_EXCLUDED: "자동 제외",
  CONFLICT: "충돌",
  IMPORTED: "완료",
};

export function parseExcelImportPreviewFilter(value: unknown): ExcelImportPreviewFilter {
  return typeof value === "string" && (EXCEL_IMPORT_PREVIEW_FILTERS as readonly string[]).includes(value)
    ? value as ExcelImportPreviewFilter
    : "ALL";
}

export function matchesExcelImportPreviewFilter(
  classification: ExcelImportPreviewClassification,
  filter: ExcelImportPreviewFilter,
): boolean {
  return filter === "ALL" || classification === filter;
}

export function excelImportPreviewClassificationReason(classification: ExcelImportPreviewClassification): string {
  if (classification === "EXECUTABLE") return "현재 자동 접수가 가능한 행입니다.";
  if (classification === "AUTO_EXCLUDED") return "필수 입력이 부족하여 자동 접수 대상에서 제외된 행입니다.";
  if (classification === "CONFLICT") return "사용자 확인이 필요한 충돌이 있는 행입니다.";
  if (classification === "IMPORTED") return "Import가 완료되어 수리 건이 생성된 행입니다.";
  return "이전 Import 실행이 완료되지 않은 행입니다.";
}

export function buildExcelImportPreviewHref(input: {
  batchId: string;
  filter: ExcelImportPreviewFilter;
  page?: number;
}): string {
  const params = new URLSearchParams({ batch: input.batchId });
  if (input.filter !== "ALL") params.set("filter", input.filter);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  return `/excel-imports/repair-cases?${params.toString()}`;
}
