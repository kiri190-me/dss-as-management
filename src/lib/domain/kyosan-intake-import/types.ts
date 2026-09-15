import type { NewIntakeWorkflowType } from "@/lib/domain/types";
import type { WorkflowKind } from "@/lib/domain/workflow-kind";
import type { RepairCaseXlsxSafetyCode } from "@/lib/xlsx/xlsx-upload-safety";

/**
 * ============================================================================
 * 교산 인수품 리스트 가져오기 — 읽은 결과의 모양
 * ============================================================================
 * S1(이 폴더)은 DB 없이 판정만 한다. S2(서버 액션)가 이 모양을 그대로 받아 미리보기와
 * 실행에 쓴다 — 이름과 뜻을 바꾸려면 S2 도 함께 봐야 한다.
 * ============================================================================
 */

/**
 * 엑셀 한 줄에서 뽑은 값. 빈 칸은 null. 날짜는 `YYYY-MM-DD`(못 읽은 날짜도 null —
 * 원래 적힌 글자는 확인 필요 사유에 들어간다).
 *
 * 🔴 글자를 어떻게 다듬었는지가 칸마다 다르다:
 *  · 인수번호·L/N·S/N — **식별자**라 NFKC + trim(전각 숫자·영문을 반각으로). 숫자 칸이면
 *    `.0`·지수 표기 없는 정수 문자열.
 *  · 모델·고객사·END-USER·신고증상·보고서 번호 — DB 에 **원문 그대로** 들어갈 값이라
 *    trim 만 한다. 대조가 필요하면 `nfkcNameKey` 로 따로 키를 만든다.
 *  · 종류·상태·유/무상 — 원문(trim 만). 판정은 규칙이 NFKC 로 따로 한다.
 */
export type KyosanRawRow = {
  rowNumber: number;
  intakeNumber: string | null;
  receivedAt: string | null;
  modelName: string | null;
  kindText: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  customerName: string | null;
  endUserName: string | null;
  reportedSymptom: string | null;
  statusText: string | null;
  shippedAt: string | null;
  reportNumber: string | null;
  billingText: string | null;
};

/**
 * 유/무상 원문과 다르게 가져온 까닭. 지금은 하나뿐이다.
 *  · `WARRANTY_PO_TO_PARTIAL_PAID` — 無償 인데 상태가 中断:客先待ち(PO 대기)라 일부 유상으로
 *    가져왔다(사용자 결정 2026-09-15, rules.ts 의 resolveBilling).
 */
export type KyosanBillingAdjustment = "WARRANTY_PO_TO_PARTIAL_PAID";

export type KyosanImportableOutcome = {
  outcome: "IMPORTABLE";
  workflowKind: WorkflowKind;
  /** PARTIAL_PAID 는 無償 + PO 대기 줄에서만 나온다(아래 billingAdjustment). */
  billingType: "PAID" | "PARTIAL_PAID" | "WARRANTY";
  /** 일부 유상은 유상 절차를 탄다 — PARTIAL_PAID 여도 PAID_*. */
  workflowType: NewIntakeWorkflowType;
  /** 만든 수리 건을 옮겨 둘 단계의 key(case_workflow_steps 의 step key). */
  targetStepKey: string;
  /** 상태가 出荷済み 일 때만 출하일. 그 밖에는 S열에 무엇이 있어도 null. */
  actualShipmentDate: string | null;
  /** 유/무상 칸이 有償·無償 이 아니어서 PAID 로 가져오는 줄 — 가져오되 표시한다. */
  billingReview: boolean;
  /** 유/무상 칸의 원문(trim 만). 빈칸이면 null. 일부 유상으로 바꿔 가져와도 원문(無償) 그대로다. */
  sourceBilling: string | null;
  /**
   * 원문과 다른 유/무상으로 가져왔으면 그 까닭, 아니면 null. S2 가 이 값을 보고 수리 건
   * 메모에 한 줄을 남긴다.
   */
  billingAdjustment: KyosanBillingAdjustment | null;
  /** 가져오긴 하지만 사람이 한 번 볼 만한 것(인수일과 인수번호의 연월이 다름 등). */
  warnings: string[];
};

export type KyosanExcludedOutcome = { outcome: "EXCLUDED"; reason: string };

export type KyosanNeedsReviewOutcome = { outcome: "NEEDS_REVIEW"; reasons: string[] };

export type KyosanClassifiedRow = { raw: KyosanRawRow } & (
  | KyosanImportableOutcome
  | KyosanExcludedOutcome
  | KyosanNeedsReviewOutcome
);

export type KyosanHeaderMismatch = {
  /** 열 문자(`"G"`). */
  column: string;
  /** 머리글 첫 줄에 있어야 하는 글자. */
  expected: string;
  /** 실제 머리글 첫 줄(trim). 비었으면 null. */
  actual: string | null;
};

export type KyosanParseFailureCode =
  | "UNSAFE_FILE"
  | "SHEET_NOT_FOUND"
  | "HEADER_NOT_FOUND"
  | "HEADER_MISMATCH";

export type KyosanParseResult =
  | {
      ok: true;
      /** 올린 파일 바이트의 sha256(hex). 같은 파일을 두 번 올렸는지 알아볼 때 쓴다. */
      fileSha256: string;
      sheetName: "リスト";
      /** 머리글이 있던 행 번호(샘플은 17). 자료는 그 아래부터다. */
      headerRow: number;
      /** 지정 열이 전부 빈 줄은 **들어 있지 않다**(세지도 않는다). */
      rows: KyosanClassifiedRow[];
    }
  | {
      ok: false;
      code: KyosanParseFailureCode;
      message: string;
      mismatches?: KyosanHeaderMismatch[];
      /** UNSAFE_FILE 일 때 걸린 안전 검사 코드들(ERROR 만). */
      safetyCodes?: RepairCaseXlsxSafetyCode[];
    };
