/**
 * ============================================================================
 * Excel 날짜 일련번호 → `YYYY-MM-DD`
 * ============================================================================
 * scripts/lib/xlsx/repair-case-list-import.ts 에서 **그대로** 옮겨 왔다(2026-09-15,
 * 교산 인수품 가져오기 S1). 앱(src/)은 scripts/ 의 실행 코드를 가져오지 않으므로
 * 원본을 이쪽에 두고, 그 파일은 다시 내보내기만 한다. 동작은 바꾸지 않았다.
 *
 *  · 1900 체계(기본) — Excel 이 1900 년을 윤년으로 잘못 세는 탓에 생긴 가짜
 *    1900-02-29(일련번호 60)는 null 이다.
 *  · 1904 체계 — workbook.xml 에 `<workbookPr date1904="1"/>` 이 걸린 통합문서.
 *    같은 날짜가 1462 만큼 작은 번호로 적힌다.
 *
 * 소수 부분(시각)은 버린다 — 이 저장소가 다루는 것은 날짜뿐이다.
 * ============================================================================
 */

export type ExcelDateSystem = "1900" | "1904";

export function excelSerialToDateOnly(
  serial: number,
  dateSystem: ExcelDateSystem
): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const wholeDays = Math.floor(serial);
  if (dateSystem === "1900" && wholeDays === 60) return null; // Excel's fictional 1900-02-29.
  const epoch = dateSystem === "1904" ? Date.UTC(1904, 0, 1) : Date.UTC(1900, 0, 1);
  const dayOffset = dateSystem === "1904" ? wholeDays : wholeDays - (wholeDays > 60 ? 2 : 1);
  const date = new Date(epoch + dayOffset * 86_400_000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
