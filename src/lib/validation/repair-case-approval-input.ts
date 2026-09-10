const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRepairCaseId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Standalone literal tuple (not imported from the local-demo domain layer),
 * matching workflow-transition-input.ts's existing convention of keeping
 * this validation module free of a domain-layer dependency. Values are
 * identical to approval-types.ts's APPROVAL_TYPE_CODES — no new approval
 * types invented.
 */
export const REPAIR_CASE_APPROVAL_TYPES = ["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const;
export type RepairCaseApprovalType = (typeof REPAIR_CASE_APPROVAL_TYPES)[number];

export function isValidApprovalType(value: unknown): value is RepairCaseApprovalType {
  return typeof value === "string" && (REPAIR_CASE_APPROVAL_TYPES as readonly string[]).includes(value);
}

export const APPROVAL_DECISION_CODES = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecisionCode = (typeof APPROVAL_DECISION_CODES)[number];

export function isValidApprovalDecision(value: unknown): value is ApprovalDecisionCode {
  return typeof value === "string" && (APPROVAL_DECISION_CODES as readonly string[]).includes(value);
}

const MAX_REASON_LENGTH = 2000;

export type ReasonValidationResult =
  | { ok: true; reason: string | null }
  | { ok: false; error: string };

/**
 * Pure format check only — identical shape to workflow-transition-input.ts's
 * validateReasonFormat. Whether a reason is *required* (e.g. REJECTED
 * always requires one, matching the local-demo layer's
 * COMMENT_REQUIRED rule) is a stateful decision made in the mutation layer,
 * not here.
 */
export function validateReasonFormat(value: unknown): ReasonValidationResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, reason: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "사유 값을 확인할 수 없습니다." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { ok: false, error: "사유 내용이 너무 깁니다." };
  }
  return { ok: true, reason: trimmed === "" ? null : trimmed };
}

export type AssignedApproverValidationResult =
  | { ok: true; userId: string | null }
  | { ok: false; error: string };

/**
 * 「누구에게 보낼까」의 **형식만** 본다 — 값이 없으면 `null`(= 지정하지 않음,
 * 정상값이고 기본값이다), 있으면 UUID 모양인지만 확인한다.
 *
 * 🔴 **그 사람이 실제로 그 승인을 처리할 수 있는지는 여기서 보지 않는다.**
 * 그것은 DB 를 읽어야 알 수 있고(역할·계정 상태), 읽는 순간과 쓰는 순간
 * 사이에 바뀔 수 있으므로 mutation 이 자기 트랜잭션 안에서 판정한다
 * (validateReasonFormat 이 「사유가 필수인가」를 여기서 정하지 않는 것과 같은
 * 이유).
 */
export function validateAssignedApproverId(value: unknown): AssignedApproverValidationResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, userId: null };
  }
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return { ok: false, error: "지정할 승인자를 확인할 수 없습니다." };
  }
  return { ok: true, userId: value };
}

export type ApprovalActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ALREADY_REQUESTED"
  | "CASE_LOCKED"
  | "BILLING_DECISION_REQUIRED"
  | "INVALID_APPROVAL_TYPE"
  /**
   * 요청할 때 지정한 사람이 그 승인을 처리할 수 없는 사람이다(역할이 맞지
   * 않거나 계정이 승인 전·비활성·잠김·삭제됨). FORBIDDEN 과 굳이 나눈 이유:
   * FORBIDDEN 은 **요청하는 나**에 대한 거절이고 이것은 **내가 고른 상대**에
   * 대한 거절이라, 사람이 해야 할 다음 행동이 서로 다르다(포기 vs 다른 사람
   * 고르기). 메시지에는 누구를 왜 지정할 수 없는지 이름과 함께 담는다.
   */
  | "ASSIGNEE_NOT_ELIGIBLE"
  /**
   * 승인 절차(결재선)의 단계가 **전부 요청자 본인**이라 보낼 곳이 없다. 자기가
   * 올린 것을 자기가 결재하는 칸은 건너뛰는데, 건너뛰고 나니 아무도 남지
   * 않은 것이다.
   *
   * FORBIDDEN·VALIDATION_ERROR 로 뭉뚱그리지 않는 이유는 위
   * ASSIGNEE_NOT_ELIGIBLE 과 같다 — 사람이 해야 할 다음 행동이 다르다.
   * FORBIDDEN 은 「나는 이 일을 할 수 없다」(포기),
   * VALIDATION_ERROR 는 「내가 적어 넣은 값을 고쳐라」인데, 여기서 고쳐야 할
   * 것은 요청하는 사람이 이 화면에서 적는 값이 아니라 **승인 절차 그 자체**다.
   * 메시지에도 그것까지 적는다.
   */
  | "ROUTE_HAS_NO_OTHER_APPROVER"
  | "DATABASE_UNAVAILABLE";

export type ApprovalActionResult =
  | { ok: true; id: string }
  | { ok: false; code: ApprovalActionResultCode; message: string };
