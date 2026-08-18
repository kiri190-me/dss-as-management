import type { UploadExcelImportPreviewActionResult } from "@/lib/server/actions/excel-import-preview";

export const EXCEL_IMPORT_ACTION_ERROR_MESSAGES: Record<string, string> = {
  FILE_REQUIRED: "분석할 .xlsx 파일을 선택해 주세요.",
  INVALID_FILE_NAME: "파일명과 확장자를 확인해 주세요.",
  UNSUPPORTED_MIME_TYPE: "올바른 .xlsx 파일 형식이 아닙니다.",
  FILE_TOO_LARGE: "파일은 20 MiB 이하여야 합니다.",
  UNSAFE_XLSX: "안전 검사에서 사용할 수 없는 파일로 판정되었습니다.",
  WORKBOOK_STRUCTURE_ERROR: "‘목록’ 시트와 3행 헤더를 확인해 주세요.",
  TEMP_FILE_CLEANUP_FAILED: "임시 파일을 안전하게 정리하지 못했습니다. 관리자에게 문의해 주세요.",
  SOURCE_DELETE_MARK_FAILED: "파일 분석 기록을 마무리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  INVALID_PREVIEW_INPUT: "분석 결과를 저장할 수 없습니다. 파일 내용을 확인해 주세요.",
  ACTOR_NOT_ALLOWED: "Excel 이관 권한을 확인할 수 없습니다.",
  EXISTING_IMPORT_IN_PROGRESS: "이 파일은 이미 이관 처리 중입니다.",
  EXISTING_PARTIAL_SUCCESS: "일부 행이 실패했습니다. 실패한 행만 재시도할 수 있습니다.",
  EXISTING_FAILED_IMPORT: "이관에 실패했습니다. 실패 원인을 확인한 뒤 다시 시도할 수 있습니다.",
  EXISTING_COMPLETED_IMPORT: "이 파일은 이미 이관이 완료된 기록입니다.",
  STALE_BATCH_VERSION: "화면 정보가 오래되었습니다. 파일을 다시 선택해 주세요.",
  BATCH_RESET_NOT_ALLOWED: "이 Preview에는 이미 이관 실행 흔적이 있어 다시 분석할 수 없습니다.",
  DATABASE_UNAVAILABLE: "Preview를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  UNAUTHORIZED: "로그인이 필요합니다.",
  FORBIDDEN: "이 기능을 사용할 권한이 없습니다.",
};

export type ExcelImportSubmitMode = "normal" | "expired" | "refresh";

export type ExcelImportSubmitConfirmation = {
  batchId: string;
  version: number;
};

export type ExcelImportSubmitOutcome =
  | {
      kind: "SUCCESS";
      batchId: string;
      notice: "created" | "reused" | "reset" | "refresh";
      message: string;
    }
  | {
      kind: "EXISTING_BATCH";
      batchId: string;
      status: string;
      message: string;
    }
  | {
      kind: "EXPIRED_CONFIRMATION";
      batchId: string;
      version: number;
      issueCodes: string[];
      message: string;
    }
  | {
      kind: "PARSER_REFRESH_CONFIRMATION";
      batchId: string;
      version: number;
      issueCodes: string[];
      message: string;
    }
  | {
      kind: "ERROR";
      issueCodes: string[];
      message: string;
    };

type Action = (formData: FormData) => Promise<UploadExcelImportPreviewActionResult>;

export async function submitExcelImportPreview(input: {
  formData: FormData;
  mode: ExcelImportSubmitMode;
  expired: ExcelImportSubmitConfirmation | null;
  parserRefresh: ExcelImportSubmitConfirmation | null;
  action: Action;
}): Promise<ExcelImportSubmitOutcome> {
  const { formData, mode, expired, parserRefresh, action } = input;
  if (mode === "expired" && expired) {
    formData.set("resetExpiredBatchId", expired.batchId);
    formData.set("expectedBatchVersion", String(expired.version));
    formData.set("confirmExpiredReset", "true");
  }
  if (mode === "refresh" && parserRefresh) {
    formData.set("refreshExistingBatchId", parserRefresh.batchId);
    formData.set("expectedBatchVersion", String(parserRefresh.version));
    formData.set("confirmParserRefresh", "true");
  }

  try {
    const result = await action(formData);
    if (result.ok) {
      if (result.outcome === "REUSED") {
        const message =
          result.batch.status === "COMPLETED"
            ? "이미 이관이 완료된 파일입니다."
            : result.batch.status === "PARTIAL_SUCCESS"
              ? "일부 행이 실패했습니다. 실패한 행만 재시도할 수 있습니다."
              : result.batch.status === "FAILED"
                ? "이관에 실패했습니다. 실패 원인을 확인한 뒤 다시 시도할 수 있습니다."
                : result.batch.status === "IMPORTING"
                  ? "이관이 진행 중입니다."
                  : "동일한 파일의 기존 Preview가 있습니다.";
        return {
          kind: "EXISTING_BATCH",
          batchId: result.batch.batchId,
          status: result.batch.status,
          message,
        };
      }
      const notice =
        result.outcome === "RESET"
            ? "reset"
            : result.outcome === "REFRESH"
              ? "refresh"
              : "created";
      return {
        kind: "SUCCESS",
        batchId: result.batch.batchId,
        notice,
        message:
          result.outcome === "REFRESH"
            ? "새 검토 정책으로 다시 분석했습니다. 최신 Preview를 불러옵니다."
            : "Preview 처리가 완료되었습니다. 결과를 불러옵니다.",
      };
    }

    const issueCodes = "issueCodes" in result ? result.issueCodes ?? [] : [];
    if (result.code === "EXPIRED_RESET_REQUIRES_CONFIRMATION" && "batch" in result && result.batch) {
      return {
        kind: "EXPIRED_CONFIRMATION",
        batchId: result.batch.batchId,
        version: result.batch.version,
        issueCodes,
        message: "이 파일의 이전 Preview가 만료되었습니다. 아래 확인 버튼을 눌러 다시 분석해 주세요.",
      };
    }
    if (result.code === "PARSER_REFRESH_REQUIRES_CONFIRMATION" && "batch" in result && result.batch) {
      return {
        kind: "PARSER_REFRESH_CONFIRMATION",
        batchId: result.batch.batchId,
        version: result.batch.version,
        issueCodes,
        message:
          "이 Preview는 이전 검토 정책으로 저장되었습니다. 다시 분석하면 기존 수동 매핑과 검토 선택은 폐기되고 현재 기준으로 재계산됩니다.",
      };
    }
    return {
      kind: "ERROR",
      issueCodes,
      message: EXCEL_IMPORT_ACTION_ERROR_MESSAGES[result.code] ?? "Preview 처리 중 오류가 발생했습니다.",
    };
  } catch {
    return {
      kind: "ERROR",
      issueCodes: [],
      message: "서버와 통신하지 못해 Preview 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

export async function completeExcelImportPreviewNavigation(input: {
  batchId: string;
  notice: "created" | "reused" | "reset" | "refresh";
  push: (href: string) => void | Promise<void>;
  refresh: () => void | Promise<void>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await input.push(
      `/excel-imports/repair-cases?batch=${encodeURIComponent(input.batchId)}&notice=${input.notice}`
    );
    await input.refresh();
    return { ok: true };
  } catch {
    return {
      ok: false,
      message:
        "재분석 결과는 저장되었지만 화면을 새로 불러오지 못했습니다. 이 페이지를 새로 고쳐 주세요.",
    };
  }
}
