import { isValidUuid } from "./procedure-validation-resolution-input";
import {
  normalizeNote,
  validateRawQuantity,
  validateRequiredReason,
  type RawIssueAllocation,
} from "@/lib/domain/inventory-part-request-rules";

/**
 * ============================================================================
 * 부품 불출 승인 — 바깥에서 들어온 값의 **형식만** 본다
 * ============================================================================
 * 서버 액션이 화면(또는 손으로 만든 요청)이 보낸 값을 그대로 믿지 않기 위한
 * 자리다. validation/repair-case-approval-input.ts 와 같은 규약이고, 그 파일의
 * 머리말에 적힌 이유가 여기서도 그대로다:
 *
 *  · 여기서 보는 것은 **자료를 읽지 않고 알 수 있는 것**뿐이다 — UUID 모양인가,
 *    수량이 정수인가, 글이 너무 길지 않은가.
 *  · 「그 사람이 실제로 이 불출을 신청할 수 있는가」·「그 부품 요청이 지금
 *    불출 가능한 상태인가」·「재고가 남아 있는가」는 **자료를 봐야** 알 수 있고,
 *    읽는 순간과 쓰는 순간 사이에 달라진다. 그래서 그 판정은 전부 mutation 이
 *    자기 트랜잭션 안에서 다시 한다(db/mutations/inventory-part-issue-requests.ts).
 *
 * 🔴 여기를 통과했다는 것이 「해도 된다」는 뜻이 아니다. 통과한 값도 mutation 이
 * 같은 검사를 처음부터 다시 한다 — 이 파일은 mutation 을 **대신하지 않고** 그
 * 앞에서 명백한 쓰레기를 걸러 낼 뿐이다.
 * ============================================================================
 */

/**
 * 결재자가 내릴 수 있는 결정. 표의 enum(`inventory_part_issue_approval_status`)
 * 에서 `REQUESTED`(아직 결정 전)를 뺀 둘이다.
 *
 * 🔴 repair-case 쪽의 같은 이름 목록(APPROVAL_DECISION_CODES)을 **가져오지
 * 않는다.** 값이 우연히 같을 뿐 다른 표의 것이고, 한쪽이 값을 하나 더할 때 다른
 * 쪽이 조용히 함께 바뀌면 안 된다. 이 저장소가 영역마다 자기 목록을 두는 관례와
 * 같다(schema/inventory-part-issue-requests.ts 의 enum 주석 참조).
 */
export const PART_ISSUE_APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type PartIssueApprovalDecision = (typeof PART_ISSUE_APPROVAL_DECISIONS)[number];

export function isValidPartIssueApprovalDecision(
  value: unknown
): value is PartIssueApprovalDecision {
  return (
    typeof value === "string" &&
    (PART_ISSUE_APPROVAL_DECISIONS as readonly string[]).includes(value)
  );
}

export type PartIssueReasonValidationResult =
  | { ok: true; reason: string | null }
  | { ok: false; error: string };

/**
 * 사유의 **형식만** 본다 — 없으면 `null`(정상값), 있으면 앞뒤 공백을 털고 길이만
 * 확인한다.
 *
 * 🔴 「사유가 **필수**인가」는 여기서 정하지 않는다. 반려에는 사유가 반드시 있어야
 * 하지만(표의 CHECK 이 그것을 최종적으로 막는다) 그것은 상태에 따라 달라지는
 * 판정이라 mutation 의 몫이다 — validateReasonFormat(repair-case 쪽)이 같은
 * 이유로 같은 모양을 하고 있다.
 *
 * 길이 상한을 여기 새로 적지 않고 재고 영역이 이미 쓰는 검사를 그대로 부른다
 * (domain/inventory-part-request-rules.ts 의 validateRequiredReason). 상한을 한 벌
 * 더 적으면 부품 요청의 사유는 통과하는데 불출 신청의 사유는 거절되는(또는 그
 * 반대의) 어긋남이 생긴다.
 */
export function validatePartIssueReasonFormat(value: unknown): PartIssueReasonValidationResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, reason: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "사유 값을 확인할 수 없습니다." };
  }
  if (value.trim().length === 0) {
    return { ok: true, reason: null };
  }
  const checked = validateRequiredReason(value);
  return checked.ok ? { ok: true, reason: checked.reason } : { ok: false, error: checked.message };
}

/** 사용처(직접 사용) 같은 짧은 글 — 비면 `null`, 길면 거절. */
export function validatePartIssueNoteFormat(value: unknown): PartIssueReasonValidationResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, reason: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "사용처 값을 확인할 수 없습니다." };
  }
  const normalized = normalizeNote(value);
  if (normalized === null) return { ok: true, reason: null };
  const checked = validateRequiredReason(normalized);
  return checked.ok ? { ok: true, reason: checked.reason } : { ok: false, error: "사용처 내용이 너무 깁니다." };
}

/**
 * ============================================================================
 * 신청 한 건의 모양 — 두 갈래
 * ============================================================================
 * 🔴 두 갈래를 **한 타입의 합집합**으로 둔다. 갈래마다 함수를 따로 두면 부르는
 * 쪽이 어느 것을 부를지 스스로 정해야 하고, 그때 「요청 기반인데 사용처를 함께
 * 보내는」 조합이 아무 데도 걸리지 않고 통과한다 — 표의 CHECK 이 최종적으로
 * 막지만, 그 실패는 사람에게 「알 수 없는 오류」로 보인다.
 * ============================================================================
 */

/** 부품 요청에 대한 불출 — 접수 건·사용처는 그 요청이 이미 들고 있다. */
export type PartRequestBasedIssueInput = {
  kind: "PART_REQUEST";
  partRequestId: string;
  /** 기존 불출과 **같은 모양**이다(domain/inventory-part-request-rules.ts). */
  allocations: RawIssueAllocation[];
  requestReason: string | null;
};

/** 요청 없이 바로 빼는 불출 — 접수 건이나 사용처를 **여기가** 들고 있어야 한다. */
export type DirectUseIssueInput = {
  kind: "DIRECT_USE";
  partStockBalanceId: string;
  quantity: number;
  repairCaseId: string | null;
  destinationNote: string | null;
  procedureExecutionNodeId: string | null;
  requestReason: string | null;
};

export type ValidatedCreatePartIssueRequestInput =
  | PartRequestBasedIssueInput
  | DirectUseIssueInput;

export type CreatePartIssueRequestInputValidationResult =
  | { ok: true; input: ValidatedCreatePartIssueRequestInput }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 신청 한 건의 형식. 통과하면 **정규화된 값**을 돌려준다(공백 턴 사유, 빈 문자열
 * 대신 null).
 *
 * 🔴 항목이 0개인지, 같은 잔량 행이 두 번 들어왔는지는 여기서 **묻지 않는다** —
 * 그 판정은 이미 순수 규칙에 있고(validateRawIssueAllocations ·
 * mergeDuplicateAllocations) mutation 이 그것을 부른다. 여기서 한 벌 더 적으면
 * 두 벌이 되고, 그때 한쪽만 고쳐진 날에 화면과 서버가 다른 답을 낸다.
 */
export function validateCreatePartIssueRequestInput(
  raw: unknown
): CreatePartIssueRequestInputValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "신청 정보를 확인할 수 없습니다." };
  }

  const reasonCheck = validatePartIssueReasonFormat(raw.requestReason);
  if (!reasonCheck.ok) return { ok: false, error: reasonCheck.error };

  if (raw.kind === "PART_REQUEST") {
    if (!isValidUuid(raw.partRequestId)) {
      return { ok: false, error: "부품 요청 정보를 확인할 수 없습니다." };
    }
    if (!Array.isArray(raw.allocations)) {
      return { ok: false, error: "불출할 항목을 확인할 수 없습니다." };
    }
    const allocations: RawIssueAllocation[] = [];
    for (const entry of raw.allocations) {
      if (!isPlainObject(entry)) {
        return { ok: false, error: "불출할 항목을 확인할 수 없습니다." };
      }
      if (!isValidUuid(entry.requestItemId) || !isValidUuid(entry.partStockBalanceId)) {
        return { ok: false, error: "요청 항목 정보를 확인할 수 없습니다." };
      }
      const quantityCheck = validateRawQuantity(entry.quantity);
      if (!quantityCheck.ok) return { ok: false, error: quantityCheck.message };
      allocations.push({
        requestItemId: entry.requestItemId,
        partStockBalanceId: entry.partStockBalanceId,
        quantity: entry.quantity as number,
      });
    }
    return {
      ok: true,
      input: {
        kind: "PART_REQUEST",
        partRequestId: raw.partRequestId,
        allocations,
        requestReason: reasonCheck.reason,
      },
    };
  }

  if (raw.kind === "DIRECT_USE") {
    if (!isValidUuid(raw.partStockBalanceId)) {
      return { ok: false, error: "재고 정보를 확인할 수 없습니다." };
    }
    const quantityCheck = validateRawQuantity(raw.quantity);
    if (!quantityCheck.ok) return { ok: false, error: quantityCheck.message };

    const repairCaseId =
      raw.repairCaseId === null || raw.repairCaseId === undefined || raw.repairCaseId === ""
        ? null
        : raw.repairCaseId;
    if (repairCaseId !== null && !isValidUuid(repairCaseId)) {
      return { ok: false, error: "접수 건 정보를 확인할 수 없습니다." };
    }

    const nodeId =
      raw.procedureExecutionNodeId === null ||
      raw.procedureExecutionNodeId === undefined ||
      raw.procedureExecutionNodeId === ""
        ? null
        : raw.procedureExecutionNodeId;
    if (nodeId !== null && !isValidUuid(nodeId)) {
      return { ok: false, error: "절차 작업 정보를 확인할 수 없습니다." };
    }

    const destinationCheck = validatePartIssueNoteFormat(raw.destinationNote);
    if (!destinationCheck.ok) return { ok: false, error: destinationCheck.error };

    // 🔴 「접수 건이나 사용처 중 하나는 있어야 한다」는 여기서도 본다. 표의 CHECK
    // 과 consumeStock 이 같은 것을 요구하므로 **막히는 자리를 앞으로 당기는**
    // 것뿐이고, 판정을 새로 만드는 것이 아니다 — 여기서 걸러 두면 결재를 다 받고
    // 실행 순간에야 「사용처를 입력해 주세요」로 거절되는 일이 없다.
    if (repairCaseId === null && destinationCheck.reason === null) {
      return { ok: false, error: "수리 건 또는 사용처를 입력해 주세요." };
    }

    return {
      ok: true,
      input: {
        kind: "DIRECT_USE",
        partStockBalanceId: raw.partStockBalanceId,
        quantity: raw.quantity as number,
        repairCaseId,
        destinationNote: destinationCheck.reason,
        procedureExecutionNodeId: nodeId,
        requestReason: reasonCheck.reason,
      },
    };
  }

  return { ok: false, error: "불출 종류를 확인할 수 없습니다." };
}

/**
 * ============================================================================
 * 실패 코드 — 사람이 **무엇을 해야 하는지**가 코드마다 다르다
 * ============================================================================
 * 뭉뚱그리지 않는 이유는 repair-case-approval-input.ts 에 적힌 것과 같다:
 * 「권한이 없습니다」만 돌려주면 사람은 포기하는 것 말고 할 수 있는 일이 없다.
 * ============================================================================
 */
export type PartIssueActionResultCode =
  /** 형식이 틀렸다(수량·UUID·너무 긴 글·항목 0개). 사람이 적은 값을 고친다. */
  | "INVALID_INPUT"
  /** 로그인하지 않았다. */
  | "UNAUTHORIZED"
  /** 이 사람은 이 일을 할 수 없다(권한·계정 상태·지정된 결재자가 아님). */
  | "FORBIDDEN"
  /** 대상이 없다(부품 요청·신청·잔량 행·접수 건). */
  | "NOT_FOUND"
  /** 그 사이 남이 먼저 처리했다. 새로 고쳐 다시 본다. */
  | "CONFLICT"
  /** 부품 요청이 지금 불출할 수 있는 상태가 아니다(취소·거절·보류·완료). */
  | "NOT_ISSUABLE"
  /** 유·무상이 아직 정해지지 않았다 — 먼저 확정해야 한다. */
  | "BILLING_DECISION_REQUIRED"
  /** 요청 줄의 남은 수량보다 많이 빼려 한다. */
  | "EXCEEDS_REMAINING_REQUESTED"
  /**
   * 지금 잔량으로도 명백히 모자란다. 🔴 **신청이 재고를 잡아 두지는 않는다** —
   * 이 검사는 「결재를 다 받고 실행할 때 처음 알게 되는 것」을 앞으로 당기는
   * 것뿐이고, 그 사이 남이 가져가면 실행 시점에 다시 막힌다.
   */
  | "INSUFFICIENT_STOCK"
  /**
   * 🔴 「부품 불출」 승인 절차(결재선)가 아직 없다 — 판이 하나도 없거나 단계가
   * 0개다.
   *
   * FORBIDDEN 과 나누는 이유가 둘이다. 하나는 사람이 할 일이 다르기 때문이고
   * (최고관리자가 승인 절차를 만들어야 한다), 다른 하나는 **다음 조각이 이
   * 코드를 보고 갈래를 정하기 때문**이다: 절차가 없으면 지금까지처럼 그 자리에서
   * 바로 불출하는 것이 맞다(schema/inventory-part-issue-requests.ts 머리말의
   * 안전장치 — 절차를 만들기 전까지 재고가 잠기지 않는다).
   */
  | "ROUTE_NOT_CONFIGURED"
  /**
   * 승인 절차의 단계가 **전부 신청자 본인**이라 보낼 곳이 없다. 고쳐야 할 것은 이
   * 사람이 지금 적는 값이 아니라 승인 절차 그 자체라 코드를 따로 둔다
   * (출하 승인의 같은 이름 코드와 같은 뜻이다).
   */
  | "ROUTE_HAS_NO_OTHER_APPROVER"
  /** 이미 나갔거나 이미 끝난 신청은 무를 수 없다. */
  | "NOT_CANCELLABLE"
  /**
   * 🔴 **지금 실행할 수 있는 상태가 아니다** — 아직 결재 중이거나, 이미 나갔거나,
   * 반려·취소됐다. 사람이 할 일이 셋 다 다르므로 메시지로 나눈다(아직 결재
   * 중이면 기다린다 · 이미 나갔으면 되돌리려면 반품이다 · 반려·취소됐으면 새로
   * 신청한다).
   *
   * NOT_CANCELLABLE 과 나누는 이유: 그쪽은 「무를 수 없다」이고 이쪽은 「뺄 수
   * 없다」다. 뭉뚱그리면 화면이 어느 단추를 닫아야 할지 알 수 없다.
   */
  | "NOT_EXECUTABLE"
  /** 예상 못 한 DB 오류를 서버 액션이 가린 것. */
  | "DATABASE_UNAVAILABLE";

export type PartIssueActionFailure = {
  ok: false;
  code: PartIssueActionResultCode;
  message: string;
};
