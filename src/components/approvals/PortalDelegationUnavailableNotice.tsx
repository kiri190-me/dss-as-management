import {
  PORTAL_DELEGATION_UNAVAILABLE_HEADLINE,
  PORTAL_DELEGATION_UNAVAILABLE_NOTICE,
} from "@/lib/domain/portal-approval-delegation";

/**
 * ============================================================================
 * 🔴 **「포털에 못 물었다」를 결재 화면에서 말하는 상자** (2026-11-16, 설계 B-7)
 * ============================================================================
 * 2026-11-13 결정으로 결재권 위임이 통합 로그인 포털 한 곳에 모였다(설계 B-1 —
 * dss-approvals/DELEGATION_DESIGN.md). 포털에 못 물으면 A/S 는 **「위임 없음」으로
 * 보고 결재를 그대로 진행한다**(B-6) — 포털 한 곳이 멈춘 날 세 시스템의 결재가
 * 전부 멈추는 쪽이 더 비싸다고 판단한 것이다.
 *
 * 🔴 **그 판단의 대가가 「대리인만 조용히 막힌다」**이다. 본인은 멀쩡히 누르므로
 * 아무도 못 알아챈다 — 이 저장소들에서 가장 비싼 결함 모양이 바로 그것이고, 그래서
 * 설계 B-7 이 **눈에 보이는 안내를 띄우라**고 못 박았다. 🔴 **이 파일이 그 안내다.
 * 지우면 B-6 을 고른 값을 치르지 못한다.**
 *
 * ── 🔴 「없다」로 그리지 않는다 ─────────────────────────────────────────
 * 「지금 확인할 수 없다」와 「위임이 없다」는 다른 말이다. 후자로 적으면 맡긴 사람은
 * 맡겨 뒀다고 믿고, 대리인은 왜 못 누르는지 끝내 모른다. 통합 승인함의 같은 자리도
 * 같은 규율이다(dss-approvals 의 delegationEmptyMessage — 「지금은 불러오지
 * 못했습니다」). 🔵 **낱말을 그 집과 맞춰 두었다** — 두 화면을 오가는 사람이 다른
 * 종류의 일로 읽지 않게 하려는 것이다.
 *
 * ── 🔵 서버 컴포넌트다(`"use client"` 가 없다) ─────────────────────────
 * 상태도 훅도 없는 표시 전용이라 **서버 화면이 그대로 그리고**(접수 건 검수/승인
 * 화면), **클라이언트 화면에서도 그대로 쓰인다**(견적서·기타건 결재 패널 — 부모를
 * 따라 클라이언트 모듈이 된다). FinalShipmentApprovedBadge 가 선 자리와 같은 판단이다.
 *
 * 🔴 **글자는 여기 없다.** 말은 domain/portal-approval-delegation.ts 한 벌이고, 이
 * 파일에는 색과 치수만 있다 — 눌렀다가 거절당한 사람에게 같은 말을 덧붙이는 자리
 * (appendPortalDelegationOutage)가 **같은 상수**를 쓰기 때문이다. 두 벌로 적으면
 * 한쪽만 고쳐지는 날이 온다.
 * ============================================================================
 */

export default function PortalDelegationUnavailableNotice({
  unavailable,
}: {
  /**
   * 🔴 **판정은 여기서 하지 않는다** — 서버가 포털에 물어 본 결과 그대로다
   * (server/acting-approvers.ts 의 `portalDelegationUnavailable`).
   *
   * 🔴 **거짓이 평소**다. 포털이 멀쩡하면 아무것도 안 그린다 — 「확인했습니다」 같은
   * 말을 대신 적지 않는다. 결재 화면마다 상시 경고가 깔리면 진짜 장애일 때 아무도
   * 안 읽는다.
   */
  unavailable: boolean;
}) {
  if (!unavailable) return null;
  return (
    <div
      role="status"
      className="break-keep rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
    >
      <p className="font-medium">{PORTAL_DELEGATION_UNAVAILABLE_HEADLINE}</p>
      <p className="mt-1">{PORTAL_DELEGATION_UNAVAILABLE_NOTICE}</p>
    </div>
  );
}
