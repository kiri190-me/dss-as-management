import { isDomesticOrderCompleted } from "./domestic-order-list";
import type { ShipmentApprovalState } from "./local/workflow/shipment-approval-checklist";

/**
 * ============================================================================
 * 기타건의 **지금 상태** — 배지 하나로 말한다 (2026-11-06)
 * ============================================================================
 * 사용자 요구 그대로다: 「[기타건 최종 출하 승인]요청을 누르면 **[출하 승인 대기]**
 * 베찌가 뜨도록 해줘(기타건 상세의 헤드와 기타건 현황 목록에) 그리고 출하 승인이
 * 모두 완료되면 **[출하 대기]**로 베찌가 바뀌도록 해줘」.
 *
 * ── 🔴 **상태를 저장하지 않는다** ───────────────────────────────────────
 * 이 값은 칸이 아니라 **계산**이다. 기타건에는 워크플로가 없고(조각 5 에서 자동
 * 전환을 안 하기로 정했다 — domain/domestic-order-approval-rules.ts), 그래서 「지금
 * 어디까지 왔나」를 적어 둘 자리가 없다. 적어 두면 승인 기록과 그 칸이 어긋나는 날이
 * 오고, 그때 어느 쪽이 참인지 답할 방법이 없다 — 이 저장소가 완료 여부를
 * `completed_at` **한 칸**으로만 두는 것과 같은 까닭이다(schema/domestic-orders.ts).
 *
 * ── 🔴 **두 화면이 이 함수 하나를 부른다** ──────────────────────────────
 * 기타건 상세의 머리 카드와 기타건 현황의 목록이다. 사용자가 둘 다에 붙이라고
 * 했으므로, 판정을 양쪽에 적으면 **한쪽만 바뀌는 날**이 온다 — 같은 줄이 목록에서는
 * 「출하 대기」인데 상세에서는 「진행 중」인 상태가 된다.
 *
 * ── 🔴 보는 차례가 곧 뜻이다 ────────────────────────────────────────────
 *  ① **완료** — `completed_at` 이 찍혔으면 그것이 종착점이다.
 *
 *     🔴 **2026-11-07 에 승인이 완료를 막기 시작했는데도 이 차례는 그대로다**
 *     (domain/domestic-order-approval-rules.ts). 「완료인데 승인은 완료가 아닌」 줄이
 *     **여전히 생기기 때문**이고, 이제는 길이 셋이다:
 *       · 관문이 서기 전에 완료된 옛 줄(2026-11-07 개발 DB 실측 1건, 운영에도 있다).
 *       · 완료한 **뒤에** 승인을 새로 올린 줄 — 그쪽은 일부러 막지 않았다
 *         (mutations/domestic-order-approvals.ts 의 「완료된 줄에서도 올릴 수 있다」).
 *       · 완료한 뒤 줄을 고쳐 그 승인이 `STALE` 이 된 줄.
 *     그때 「출하 승인 대기」라고 말하면 끝난 건을 아직 안 끝난 것으로 읽는다.
 *  ② 그 아래는 **승인 상태 그대로**다. 판정을 새로 적지 않고 접수 건 승인 카드가
 *     쓰는 그 함수의 답(resolveApprovalState)을 받아 말만 바꾼다.
 *
 * ── 🔴 사용자가 말한 것은 **둘**이고 나머지 셋은 내가 정했다 ─────────────
 * 「출하 승인 대기」(PENDING) · 「출하 대기」(APPROVED) 둘만 지정됐다. 남은 셋은
 * 같은 말투로 잇는다 — 이 배지가 답하는 물음이 **「이 기타건이 출하까지 어디쯤
 * 왔나」** 하나이기 때문이다:
 *  · REJECTED → **출하 승인 반려**  · STALE → **출하 재승인 필요**
 *  · NOT_REQUESTED → **진행 중**(아직 승인을 올린 적이 없다. 이 화면이 그 전부터
 *    쓰던 말 그대로라, 승인 기능이 생기기 전과 같은 줄은 같은 글자로 보인다.)
 *
 * ⚠️ **[승인] 탭의 배지와 글자가 다르다**(거기는 「승인 대기 · 승인 완료 · 반려 ·
 * 재승인 필요」 — components/repair-cases/approval/DatabaseApprovalStatusBadge).
 * 일부러다: 그 배지는 **결재 기록 자체**의 상태를 말하고(수리 건 승인 카드와 한 벌로
 * 쓰는 말이다), 이것은 **기타건**의 상태를 말한다. 같은 자리에 두 말을 섞지 않도록
 * 상세에서도 자리가 다르다 — 머리 카드는 이 배지, [승인] 탭 안은 그 배지다.
 * ============================================================================
 */

export type MiscCaseStatus =
  | "COMPLETED"
  | "SHIPMENT_READY"
  | "SHIPMENT_APPROVAL_PENDING"
  | "SHIPMENT_APPROVAL_REJECTED"
  | "SHIPMENT_APPROVAL_STALE"
  | "IN_PROGRESS";

/** 화면과 시험이 같은 글자를 쓴다. 🔴 사용자가 지정한 두 글자가 여기 있다. */
export const MISC_CASE_STATUS_LABELS: Record<MiscCaseStatus, string> = {
  COMPLETED: "완료",
  SHIPMENT_READY: "출하 대기",
  SHIPMENT_APPROVAL_PENDING: "출하 승인 대기",
  SHIPMENT_APPROVAL_REJECTED: "출하 승인 반려",
  SHIPMENT_APPROVAL_STALE: "출하 재승인 필요",
  IN_PROGRESS: "진행 중",
};

/**
 * 거르개에 세울 차례 — **흐름의 순서**다(아직 안 올림 → 올림 → 승인됨 → 끝남, 그
 * 다음에 어긋난 둘). 이름순으로 세우면 「완료」가 「진행 중」보다 앞에 서서, 고르는
 * 사람이 단계를 거꾸로 읽는다.
 */
export const MISC_CASE_STATUS_ORDER: readonly MiscCaseStatus[] = [
  "IN_PROGRESS",
  "SHIPMENT_APPROVAL_PENDING",
  "SHIPMENT_READY",
  "COMPLETED",
  "SHIPMENT_APPROVAL_REJECTED",
  "SHIPMENT_APPROVAL_STALE",
];

/**
 * 이 줄이 지금 무엇인가.
 *
 * `approvalState` 가 `null` 인 것은 「승인을 올린 적이 없다」와 같은 뜻이다 — 결재
 * 기록이 한 줄도 없으면 조회가 애초에 그 줄을 지도에 넣지 않는다(화면 쪽에서 `??`
 * 로 메우지 않도록 여기서 받아 준다).
 */
export function resolveMiscCaseStatus(row: {
  /** 완료 처리한 시각(ISO 문자열). 판정은 내자 정리와 **같은 도메인 함수**가 한다. */
  completedAt: string | null;
  approvalState: ShipmentApprovalState | null;
}): MiscCaseStatus {
  // ① 끝난 건이 먼저다(파일 머리말).
  if (isDomesticOrderCompleted(row)) return "COMPLETED";

  switch (row.approvalState) {
    case "PENDING":
      return "SHIPMENT_APPROVAL_PENDING";
    case "APPROVED":
      return "SHIPMENT_READY";
    case "REJECTED":
      return "SHIPMENT_APPROVAL_REJECTED";
    case "STALE":
      return "SHIPMENT_APPROVAL_STALE";
    case "NOT_REQUESTED":
    case null:
    case undefined:
      return "IN_PROGRESS";
  }
}
