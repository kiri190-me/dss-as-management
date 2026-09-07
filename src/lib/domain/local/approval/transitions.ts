import type { AccountApprovalStatus, Role } from "../../types";
import { isDelegationValidAt, type LocalShipmentDelegation } from "./delegation-types";
import { FINAL_SHIPMENT_REPRESENTATIVE_USER_ID } from "./representative";
import type { ApprovalType, DisplayApprovalStatus, LocalApprovalRecord } from "./approval-types";

/**
 * 세션에서 가져온 최소한의 검증된 사용자 정보다. 이 값 자체를
 * localStorage에 "현재 로그인 사용자"로 저장하지 않는다 — 매 액션마다
 * 서버에서 내려온 이 prop을 그대로 사용할 뿐이다.
 */
export type ActingUser = {
  id: string;
  name: string;
  role: Role;
  approvalStatus: AccountApprovalStatus;
  /**
   * 개발자 표시(users.is_developer).
   *
   * **역할이 아니다.** 이 값이 켜져도 role은 그대로다 — A/S 엔지니어인 개발자는
   * 배정·「내 작업」·부품 요청 자격·역할 이름표·감사 기록에서 계속 엔지니어다.
   * 바뀌는 것은 권한 판정 하나뿐이고, 그 승격은 permission-resolver.ts 한 곳에서만
   * 일어난다(개발자면 최고관리자로 해석한다).
   *
   * mock 모드에는 이 칸이 없으므로 언제나 false다.
   */
  isDeveloper: boolean;
};

export const REQUEST_ELIGIBLE_ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"];
export const INSPECTION_DECIDE_ELIGIBLE_ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"];

function isApprovedAccount(user: ActingUser): boolean {
  return user.approvalStatus === "APPROVED";
}

/** 검수/출하 요청(및 보완요청·반려 후 재요청) 모두에 공통으로 쓰는 자격이다. */
export function isRequestEligible(user: ActingUser): boolean {
  return isApprovedAccount(user) && REQUEST_ELIGIBLE_ROLES.includes(user.role);
}

export function isInspectionDecideEligible(user: ActingUser): boolean {
  return isApprovedAccount(user) && INSPECTION_DECIDE_ELIGIBLE_ROLES.includes(user.role);
}

export type ShipmentAuthorization =
  | { allowed: true; delegationId: string | null }
  | { allowed: false };

/**
 * 대표(u-001)는 직접(DIRECT) 처리, 그 시점에 유효한 위임을 받은 사용자는
 * 위임(DELEGATED) 처리로 허용한다. 그 외에는 SUPER_ADMIN을 포함해 누구도
 * 허용하지 않는다 — 역할이 아니라 명시적 대표 ID로만 판정한다.
 */
export function resolveShipmentAuthorization(
  user: ActingUser,
  delegations: readonly LocalShipmentDelegation[],
  nowIso: string
): ShipmentAuthorization {
  if (!isApprovedAccount(user)) return { allowed: false };
  if (user.id === FINAL_SHIPMENT_REPRESENTATIVE_USER_ID) {
    return { allowed: true, delegationId: null };
  }
  const active = delegations.find(
    (d) =>
      d.delegateUserId === user.id &&
      d.principalUserId === FINAL_SHIPMENT_REPRESENTATIVE_USER_ID &&
      isDelegationValidAt(d, nowIso)
  );
  if (active) return { allowed: true, delegationId: active.id };
  return { allowed: false };
}

export function findRecordFor(
  records: readonly LocalApprovalRecord[],
  repairCaseId: string,
  approvalType: ApprovalType
): LocalApprovalRecord | null {
  return records.find((r) => r.repairCaseId === repairCaseId && r.approvalType === approvalType) ?? null;
}

export function getDisplayStatus(record: LocalApprovalRecord | null): DisplayApprovalStatus {
  return record?.status ?? "NOT_REQUESTED";
}

/** correction #2: 검수 승인이 APPROVED여야만 출하 승인을 요청할 수 있다. */
export function isInspectionApprovedFor(
  records: readonly LocalApprovalRecord[],
  repairCaseId: string
): boolean {
  const record = findRecordFor(records, repairCaseId, "REPAIR_INSPECTION");
  return record?.status === "APPROVED";
}
