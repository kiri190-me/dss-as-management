export type LocalShipmentDelegation = {
  id: string;
  /** 이 데모에서 principalUserId는 항상 대표(u-001)다. */
  principalUserId: string;
  principalNameSnapshot: string;
  delegateUserId: string;
  delegateNameSnapshot: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  createdAt: string;
  source: "LOCAL_DEMO";
};

export type LocalDelegationEnvelope = {
  version: 1;
  delegations: LocalShipmentDelegation[];
};

export const DELEGATION_STORAGE_KEY = "dss-as-local-delegations-v1";

/**
 * 위임 유효성은 저장된 boolean이 아니라 항상 이 함수로 그때그때 계산한다
 * (PROJECT_REQUIREMENTS.md: "위임은 유효 종료 일시가 지나면 자동으로
 * 만료된다"). 미래 위임과 만료된 위임은 모두 사용할 수 없다.
 */
export function isDelegationValidAt(delegation: LocalShipmentDelegation, atIso: string): boolean {
  return delegation.startsAt <= atIso && atIso <= delegation.endsAt;
}
