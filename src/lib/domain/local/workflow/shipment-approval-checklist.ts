/**
 * ============================================================================
 * 출하까지 남은 결재 — 무엇이 없어서 막혔는지 미리 보여 주기 위한 계산
 * ============================================================================
 * 출하 완료 전이는 `repair_case_approvals`의 **최종 출하 승인 결재**를
 * 요구한다(workflow_transitions.required_approval_type). 그런데 워크플로에는
 * `출하 승인됨`이라는 **단계**가 따로 있고, 그 단계로 가는 전이에는 승인
 * 요건이 없다 — 교산의 출하 승인을 받았다는 업무 사실을 기록하는 단계이지
 * 사내 결재가 아니다.
 *
 * 이름이 겹치는 두 가지가 나란히 있으니, 단계가 '출하 승인됨'이면 결재도 끝난
 * 것으로 읽힌다. 실제로 개발 DB에서 그 단계에 서 있는 9건이 전부 결재 기록 0건
 * 이었고, 마지막 버튼에 가서야 막힌 것을 알게 됐다.
 *
 * ── 왜 두 개를 함께 보여 주는가 ─────────────────────────────────────────
 * 최종 출하 승인은 혼자 요청할 수 없다. **수리 검수 승인이 먼저 결재돼 있어야**
 * 요청 버튼이 열린다(requestRepairCaseApproval의 사전 조건). 그래서 "최종 출하
 * 승인이 필요합니다"만 말하면 사람이 승인 화면에 가서 두 번째로 막힌다. 순서와
 * 현재 상태를 한 줄에 같이 보여 주는 것이 이 계산의 목적이다.
 *
 * ── 승인은 요청 당시의 version에 묶인다 ─────────────────────────────────
 * 승인 이후 접수 건이 바뀌면 다시 받아야 한다(APPROVAL_STALE). 그런데 그
 * version은 내용을 고칠 때뿐 아니라 **단계를 진행할 때도** 올라간다. 그래서
 * 검수 승인을 받고 단계를 진행하면 최종 출하 승인을 요청조차 할 수 없게 된다 —
 * 화면이 그 상태를 STALE로 구분해 보여 주고, 순서 안내에 "승인 사이에 단계를
 * 진행하지 말 것"을 적는 이유다.
 *
 * 이 파일은 순수 계산만 한다. 서버가 최종 판정이고(workflow-transitions.ts,
 * repair-case-approvals.ts), 여기 결과는 화면 안내일 뿐이다 — 두 곳의 규칙이
 * 어긋나면 "보이는 것과 되는 것"이 달라지므로 판정 규칙을 그대로 옮겨 적는다.
 * ============================================================================
 */

export type ShipmentApprovalType = "REPAIR_INSPECTION" | "FINAL_SHIPMENT";

export type ShipmentApprovalState =
  /** 요청한 적 없음 — 행이 아예 없다. */
  | "NOT_REQUESTED"
  /** 요청했고 결재를 기다리는 중. */
  | "PENDING"
  /** 결재됐고 지금 접수 건 version에도 유효하다. */
  | "APPROVED"
  | "REJECTED"
  /** 결재는 받았지만 그 뒤 접수 건이 바뀌어(단계 진행 포함) 다시 받아야 한다. */
  | "STALE";

export type ShipmentApprovalChecklistItem = {
  approvalType: ShipmentApprovalType;
  label: string;
  state: ShipmentApprovalState;
  /** 앞 결재가 끝나지 않아 지금은 요청조차 할 수 없는가. */
  blockedByPrevious: boolean;
};

export type ApprovalRecordForState = { status: string; repairCaseVersionAtRequest: number } | null;

type ApprovalInput = {
  approvalType: string;
  latest: ApprovalRecordForState;
};

export const LABELS: Record<ShipmentApprovalType, string> = {
  REPAIR_INSPECTION: "수리 검수 승인",
  FINAL_SHIPMENT: "최종 출하 승인",
};

/**
 * 결재 한 건의 현재 상태 — **승인 화면의 카드와 워크플로 패널의 체크리스트가
 * 함께 쓰는 단 하나의 판정**이다.
 *
 * 이 함수가 생긴 이유가 실제 사고다. 승인 카드는 `record.status`만 보고
 * "승인 완료"를 표시했고, version이 바뀌어 서버가 무효로 보는 승인도 똑같이
 * 승인 완료로 보였다. 그 상태의 카드에는 "이미 승인 완료되어 추가 처리를 할
 * 수 없습니다"만 있고 재요청 버튼이 없어서, 화면에서 빠져나갈 방법이 없었다 —
 * 서버는 "승인이 없다"고 하는데 화면은 "이미 다 됐다"고 하는 상태.
 *
 * 그래서 무효(STALE)를 승인과 구분하고, 그 판정을 한 곳에만 둔다.
 */
export function resolveApprovalState(latest: ApprovalRecordForState, currentVersion: number): ShipmentApprovalState {
  if (!latest) return "NOT_REQUESTED";
  if (latest.status === "REQUESTED") return "PENDING";
  if (latest.status === "REJECTED") return "REJECTED";
  // 서버의 두 판정(전이 게이트, 요청 사전 조건)이 모두 version 일치를 요구한다.
  return latest.repairCaseVersionAtRequest === currentVersion ? "APPROVED" : "STALE";
}

function stateOf(approvals: ApprovalInput[], type: ShipmentApprovalType, currentVersion: number): ShipmentApprovalState {
  const latest = approvals.find((approval) => approval.approvalType === type)?.latest ?? null;
  return resolveApprovalState(latest, currentVersion);
}

/**
 * 출하 완료까지 필요한 결재 두 개를 순서대로 돌려준다.
 *
 * 검수 승인이 유효하지 않으면 최종 출하 승인은 blockedByPrevious = true다 —
 * 요청 버튼을 눌러도 서버가 "수리 검수 승인이 완료된 후…"로 거절한다.
 */
export function buildShipmentApprovalChecklist(params: {
  approvals: ApprovalInput[];
  currentVersion: number;
}): ShipmentApprovalChecklistItem[] {
  const inspection = stateOf(params.approvals, "REPAIR_INSPECTION", params.currentVersion);
  const shipment = stateOf(params.approvals, "FINAL_SHIPMENT", params.currentVersion);

  return [
    {
      approvalType: "REPAIR_INSPECTION",
      label: LABELS.REPAIR_INSPECTION,
      state: inspection,
      blockedByPrevious: false,
    },
    {
      approvalType: "FINAL_SHIPMENT",
      label: LABELS.FINAL_SHIPMENT,
      state: shipment,
      // 이미 결재를 받아 둔 뒤라면 앞 결재 상태와 무관하게 유효하다 — 그때
      // "앞 단계가 막혔다"고 말하면 사실이 아니다.
      blockedByPrevious: shipment !== "APPROVED" && inspection !== "APPROVED",
    },
  ];
}

/** 이 목록이 전부 끝났는가 — 출하 완료를 누를 수 있는 상태인가. */
export function isShipmentApprovalChecklistComplete(items: ShipmentApprovalChecklistItem[]): boolean {
  return items.every((item) => item.state === "APPROVED");
}
