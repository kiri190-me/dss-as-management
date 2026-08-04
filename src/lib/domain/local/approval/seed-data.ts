import type { LocalApprovalEvent, LocalApprovalRecord } from "./approval-types";
import type { LocalShipmentDelegation } from "./delegation-types";
import { FINAL_SHIPMENT_REPRESENTATIVE_USER_ID, SEED_DELEGATE_USER_ID } from "./representative";

// 시드 레코드/이벤트/위임은 모두 고정된(결정론적) ID를 쓴다. crypto.randomUUID()는
// 사용자가 화면에서 직접 만든 레코드/이벤트/ID에만 사용한다(이 파일에는 없음).
export const SEED_DELEGATION_ACTIVE_ID = "delegation-seed-active";
export const SEED_DELEGATION_EXPIRED_ID = "delegation-seed-expired";

const REPRESENTATIVE_NAME = "김도윤";
const DELEGATE_NAME = "이서연";
const ENGINEER_NAMES: Record<string, string> = {
  "u-004": "최민서",
  "u-005": "정우진",
  "u-006": "한소율",
};

function hoursFromNow(now: number, hours: number): string {
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}
function daysFromNow(now: number, days: number): string {
  return hoursFromNow(now, days * 24);
}

/**
 * 위임 유효 기간은 실제 벽시계 초기화 시점(Date.now()) 기준 상대 오프셋으로
 * 계산한다 — 데모 스토리지가 언제 처음 생성되든 활성 위임이 항상 시연
 * 가능하도록 하기 위함이다(고정된 달력 날짜를 쓰지 않는다).
 */
export function buildSeedDelegations(now: number = Date.now()): LocalShipmentDelegation[] {
  const createdAt = new Date(now).toISOString();
  return [
    {
      id: SEED_DELEGATION_ACTIVE_ID,
      principalUserId: FINAL_SHIPMENT_REPRESENTATIVE_USER_ID,
      principalNameSnapshot: REPRESENTATIVE_NAME,
      delegateUserId: SEED_DELEGATE_USER_ID,
      delegateNameSnapshot: DELEGATE_NAME,
      startsAt: daysFromNow(now, -1),
      endsAt: daysFromNow(now, 7),
      reason: "대표 출장으로 인한 출하 승인 임시 위임(데모)",
      createdAt,
      source: "LOCAL_DEMO",
    },
    {
      id: SEED_DELEGATION_EXPIRED_ID,
      principalUserId: FINAL_SHIPMENT_REPRESENTATIVE_USER_ID,
      principalNameSnapshot: REPRESENTATIVE_NAME,
      delegateUserId: SEED_DELEGATE_USER_ID,
      delegateNameSnapshot: DELEGATE_NAME,
      startsAt: daysFromNow(now, -14),
      endsAt: daysFromNow(now, -7),
      reason: "대표 휴가로 인한 출하 승인 임시 위임(만료된 데모 사례)",
      createdAt,
      source: "LOCAL_DEMO",
    },
  ];
}

type SeedCaseSpec = {
  repairCaseId: string;
  engineerId: string;
  inspection: {
    status: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
    requestedAtOffsetH: number;
    decidedAtOffsetH: number;
    deciderId?: string; // 지정 없으면 self-review(요청자와 동일)
    comment: string | null;
  };
  shipment?: {
    status: "PENDING" | "APPROVED";
    requestedAtOffsetH: number;
    decidedAtOffsetH?: number;
    deciderId?: string;
    delegationId?: string;
    comment: string | null;
  };
};

const SEED_CASES: SeedCaseSpec[] = [
  {
    repairCaseId: "rc-001",
    engineerId: "u-004",
    inspection: { status: "APPROVED", requestedAtOffsetH: -144, decidedAtOffsetH: -120, comment: "이상 없음 확인" },
    shipment: {
      status: "APPROVED",
      requestedAtOffsetH: -96,
      decidedAtOffsetH: -72,
      deciderId: FINAL_SHIPMENT_REPRESENTATIVE_USER_ID,
      comment: "확인 후 승인",
    },
  },
  {
    repairCaseId: "rc-003",
    engineerId: "u-006",
    inspection: { status: "APPROVED", requestedAtOffsetH: -72, decidedAtOffsetH: -48, comment: "무상 수리 완료 확인" },
    shipment: {
      status: "APPROVED",
      requestedAtOffsetH: -20,
      decidedAtOffsetH: -10,
      deciderId: SEED_DELEGATE_USER_ID,
      delegationId: SEED_DELEGATION_ACTIVE_ID,
      comment: "위임 승인 처리",
    },
  },
  {
    repairCaseId: "rc-005",
    engineerId: "u-005",
    inspection: { status: "APPROVED", requestedAtOffsetH: -48, decidedAtOffsetH: -36, comment: null },
    shipment: {
      status: "PENDING",
      requestedAtOffsetH: -6,
      comment: null,
    },
  },
  {
    repairCaseId: "rc-006",
    engineerId: "u-006",
    inspection: {
      status: "CHANGES_REQUESTED",
      requestedAtOffsetH: -48,
      decidedAtOffsetH: -24,
      deciderId: "u-004",
      comment: "부품 수급 완료 후 재점검 필요",
    },
  },
  {
    repairCaseId: "rc-013",
    engineerId: "u-005",
    inspection: {
      status: "REJECTED",
      requestedAtOffsetH: -72,
      decidedAtOffsetH: -48,
      deciderId: "u-004",
      comment: "점검 결과 재확인 필요, 반려 처리",
    },
  },
];

function nameOf(userId: string): string {
  if (userId === FINAL_SHIPMENT_REPRESENTATIVE_USER_ID) return REPRESENTATIVE_NAME;
  if (userId === SEED_DELEGATE_USER_ID) return DELEGATE_NAME;
  return ENGINEER_NAMES[userId] ?? userId;
}

/**
 * 시드 승인 레코드/이벤트를 함께 생성한다. rc-001/003/005는 correction #2
 * 규칙(검수 승인 완료 후에만 출하 승인 요청 가능)을 만족하도록 검수를 항상
 * 먼저 APPROVED로 만든다. rc-003의 출하 승인 시각은 활성 위임 시드의 유효
 * 구간(now-1d ~ now+7d) 안에 들어오도록 -20h/-10h로 잡았다.
 */
export function buildSeedApprovalEnvelope(now: number = Date.now()): {
  records: LocalApprovalRecord[];
  events: LocalApprovalEvent[];
} {
  const records: LocalApprovalRecord[] = [];
  const events: LocalApprovalEvent[] = [];

  for (const spec of SEED_CASES) {
    const inspectionId = `approval-seed-${spec.repairCaseId}-repair-inspection`;
    const requestedAt = hoursFromNow(now, spec.inspection.requestedAtOffsetH);
    const decidedAt = hoursFromNow(now, spec.inspection.decidedAtOffsetH);
    const deciderId = spec.inspection.deciderId ?? spec.engineerId;

    records.push({
      id: inspectionId,
      repairCaseId: spec.repairCaseId,
      approvalType: "REPAIR_INSPECTION",
      status: spec.inspection.status,
      requestedByUserId: spec.engineerId,
      requestedByNameSnapshot: nameOf(spec.engineerId),
      requestedAt,
      decidedByUserId: deciderId,
      decidedByNameSnapshot: nameOf(deciderId),
      decidedAt,
      decisionComment: spec.inspection.comment,
      delegationId: null,
      createdAt: requestedAt,
      updatedAt: decidedAt,
      source: "LOCAL_DEMO",
    });
    events.push({
      id: `approval-event-seed-${spec.repairCaseId}-repair-inspection-requested`,
      approvalRecordId: inspectionId,
      repairCaseId: spec.repairCaseId,
      approvalType: "REPAIR_INSPECTION",
      eventType: "REQUESTED",
      actorUserId: spec.engineerId,
      actorNameSnapshot: nameOf(spec.engineerId),
      occurredAt: requestedAt,
      comment: null,
      delegationId: null,
      source: "LOCAL_DEMO",
    });
    events.push({
      id: `approval-event-seed-${spec.repairCaseId}-repair-inspection-${spec.inspection.status.toLowerCase()}`,
      approvalRecordId: inspectionId,
      repairCaseId: spec.repairCaseId,
      approvalType: "REPAIR_INSPECTION",
      eventType: spec.inspection.status,
      actorUserId: deciderId,
      actorNameSnapshot: nameOf(deciderId),
      occurredAt: decidedAt,
      comment: spec.inspection.comment,
      delegationId: null,
      source: "LOCAL_DEMO",
    });

    if (!spec.shipment) continue;

    const shipmentId = `approval-seed-${spec.repairCaseId}-final-shipment`;
    const shipmentRequestedAt = hoursFromNow(now, spec.shipment.requestedAtOffsetH);
    const isDecided = spec.shipment.status === "APPROVED";
    const shipmentDecidedAt = isDecided ? hoursFromNow(now, spec.shipment.decidedAtOffsetH!) : null;
    const shipmentDeciderId = isDecided ? (spec.shipment.deciderId ?? FINAL_SHIPMENT_REPRESENTATIVE_USER_ID) : null;
    const shipmentDelegationId = isDecided ? (spec.shipment.delegationId ?? null) : null;

    records.push({
      id: shipmentId,
      repairCaseId: spec.repairCaseId,
      approvalType: "FINAL_SHIPMENT",
      status: spec.shipment.status,
      requestedByUserId: spec.engineerId,
      requestedByNameSnapshot: nameOf(spec.engineerId),
      requestedAt: shipmentRequestedAt,
      decidedByUserId: shipmentDeciderId,
      decidedByNameSnapshot: shipmentDeciderId ? nameOf(shipmentDeciderId) : null,
      decidedAt: shipmentDecidedAt,
      decisionComment: isDecided ? spec.shipment.comment : null,
      delegationId: shipmentDelegationId,
      createdAt: shipmentRequestedAt,
      updatedAt: shipmentDecidedAt ?? shipmentRequestedAt,
      source: "LOCAL_DEMO",
    });
    events.push({
      id: `approval-event-seed-${spec.repairCaseId}-final-shipment-requested`,
      approvalRecordId: shipmentId,
      repairCaseId: spec.repairCaseId,
      approvalType: "FINAL_SHIPMENT",
      eventType: "REQUESTED",
      actorUserId: spec.engineerId,
      actorNameSnapshot: nameOf(spec.engineerId),
      occurredAt: shipmentRequestedAt,
      comment: null,
      delegationId: null,
      source: "LOCAL_DEMO",
    });
    if (isDecided && shipmentDeciderId) {
      events.push({
        id: `approval-event-seed-${spec.repairCaseId}-final-shipment-approved`,
        approvalRecordId: shipmentId,
        repairCaseId: spec.repairCaseId,
        approvalType: "FINAL_SHIPMENT",
        eventType: "APPROVED",
        actorUserId: shipmentDeciderId,
        actorNameSnapshot: nameOf(shipmentDeciderId),
        occurredAt: shipmentDecidedAt as string,
        comment: spec.shipment.comment,
        delegationId: shipmentDelegationId,
        source: "LOCAL_DEMO",
      });
    }
  }

  return { records, events };
}
