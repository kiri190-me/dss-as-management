/**
 * 이 파일은 파일 래퍼(`validateRepairCaseXlsxFile`)만 들고, 나머지는 다시 내보낸다 —
 * 버퍼 검사의 실제 구현은 `src/lib/xlsx/xlsx-upload-safety.ts` 에 있다.
 *
 * 2026-09-15 교산 인수품 가져오기(S1)에서 앱이 사람이 올린 파일을 같은 검사로 걸러야
 * 해서 src 로 옮겼다(앱은 scripts/ 의 실행 코드를 가져오지 않는다 — zip-reader.ts 와
 * 같은 이유). `node:fs` 로 파일을 여는 이 래퍼는 개발 도구 쪽 일이라 여기에 남는다.
 *
 * 다시 내보내기를 남겨 두는 이유는 이 파일을 부르는 시험들의 가져오기를 건드리지 않기
 * 위해서다. 그 시험들이 그대로 통과해야 이번 이동이 무해했다고 말할 수 있다.
 */
import { readFileSync, statSync } from "node:fs";
import {
  REPAIR_CASE_XLSX_SAFETY_LIMITS,
  validateRepairCaseXlsxBuffer,
  type RepairCaseXlsxSafetyOptions,
  type RepairCaseXlsxSafetyResult,
} from "@/lib/xlsx/xlsx-upload-safety";

export {
  REPAIR_CASE_XLSX_SAFETY_LIMITS,
  validateRepairCaseXlsxBuffer,
  type RepairCaseXlsxSafetyCode,
  type RepairCaseXlsxSafetyIssue,
  type RepairCaseXlsxSafetyLimits,
  type RepairCaseXlsxSafetyOptions,
  type RepairCaseXlsxSafetyResult,
} from "@/lib/xlsx/xlsx-upload-safety";

export function validateRepairCaseXlsxFile(
  filePath: string,
  options: RepairCaseXlsxSafetyOptions = {}
): RepairCaseXlsxSafetyResult {
  const fileSize = statSync(filePath).size;
  if (fileSize > (options.limits?.maxCompressedBytes ?? REPAIR_CASE_XLSX_SAFETY_LIMITS.maxCompressedBytes)) {
    return { ok: false, issues: [{ code: "COMPRESSED_UPLOAD_SIZE_LIMIT_EXCEEDED", severity: "ERROR" }] };
  }
  return validateRepairCaseXlsxBuffer(readFileSync(filePath), filePath, options);
}
