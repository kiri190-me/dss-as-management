"use client";

import type { ReactNode } from "react";
import {
  DueDateNearBadge,
  HoldBadge,
  OverdueBadge,
  PriorityBadge,
  SourceBadge,
  StatusBadge,
  WorkflowOverrideBadge,
} from "@/components/repair-cases/badges";
import FinalShipmentApprovedBadge from "@/components/approvals/FinalShipmentApprovedBadge";
import MiscCaseStatusBadge from "@/components/misc-cases/MiscCaseStatusBadge";
import RequestedDueDateValue from "@/components/repair-cases/RequestedDueDateValue";
import type { BadgeKey } from "@/lib/domain/badge-visibility";

/**
 * ============================================================================
 * [배지 표시] 탭에 세우는 **보기 배지** (2026-11-13)
 * ============================================================================
 * 사용자 요구: 「상태」·「로컬 워크플로 재정의」라는 **글자만 봐서는** 화면의 어느
 * 표식인지 모른다. 이름 옆에 실제 모양을 함께 세우면 끄기 전에 무엇을 끄는지 바로
 * 안다.
 *
 * ── 🔴 모양을 **베끼지 않는다** ─────────────────────────────────────────
 * 진짜 배지 컴포넌트를 그대로 가져다 그린다. 색과 치수를 여기 옮겨 적으면, 나중에
 * 배지 색이 바뀌는 날 **설정 화면만 옛 모양으로 남고** 오류가 안 나서 아무도 모른다
 * — 그러면 "끄기 전에 무엇을 끄는지 보여 준다"는 이 보기 배지의 목적 자체가 조용히
 * 거짓이 된다.
 *
 * ── 🔴🔴 보기 배지는 **설정 판정을 타면 안 된다** ───────────────────────
 * 조각 3에서 배지 컴포넌트들이 이 설정을 읽어 **스스로 안 그리게** 된다. 아무 장치가
 * 없으면 그때 **이 화면의 보기 배지도 함께 사라진다** — 끈 사람은 자기가 무엇을 껐는지
 * 볼 수 없고, 다시 켜려 해도 그 줄이 비어 있어 못 찾는다. 설정 화면이 제 손으로
 * 만든 막다른 길이 된다.
 *
 * 🔴 **그래서 이 파일은 「자리」를 한 글자도 넘기지 않는다.** 아래 어느 줄에도
 * placeKey·settings·isBadgeVisible 이 없다. 등록부의 자리 여섯 가운데 **설정 화면인
 * 것은 하나도 없고**(domain/badge-visibility.ts 의 BADGE_PLACES), 허용되지 않는 쌍은
 * 판정이 언제나 "보임"으로 답한다 — 자리를 안 주는 것이 곧 "판정 밖"이다.
 *
 * 🔴 **조각 3을 맡는 사람에게**: 배지에 자리별 판정을 붙일 때 그 판정은
 *   · 배지 컴포넌트가 **받은 자리 키로** 하거나(이 파일은 안 넘긴다), 또는
 *   · 배지를 **부르는 화면 쪽**에서 하라(이 파일은 그 화면들이 아니다).
 * 🔴 **배지 컴포넌트 안에서 자리 키 없이도 설정을 읽어 스스로 숨는 길**은 만들지 마라
 * — 그 순간 이 보기 배지가 함께 사라진다. 그 일이 일어나면 아래 시험이 잡는다
 * (badge-visibility-panel.test.tsx 의 「전부 꺼도 보기 배지는 그려진다」).
 *
 * ── 🔴 값은 전부 지어낸 것이다 ──────────────────────────────────────────
 * 공개 저장소라 실제 고객사 이름·L/N·S/N 을 한 글자도 쓰지 않는다. 날짜도 뜻 없는
 * 하루다(그 칸의 배지는 날짜가 있어야 모양이 나온다).
 *
 * ── 🔵 모양이 없는 배지 다섯 ────────────────────────────────────────────
 * 아래 표에 없는 다섯(`dueDateFromDomesticOrder` · `dueDateFromRepairCase` ·
 * `domesticOrderCompleted` · `dueDateRowCompleted` · `orderIssuedDateMissing`)은
 * **가져다 쓸 컴포넌트가 없다** — 넷은 내자 정리 목록 화면 안의 비공개 함수이고
 * (DomesticOrderListScreen.tsx 의 CompletedBadge · DueDateRowCompletedBadge ·
 * OrderIssuedDateContent), 하나는 수리건 상세 기본 정보 탭의 비공개 `Field` 가 그린다.
 * 🔴 그 화면들을 고쳐 내보내게 하는 것도, 모양을 여기 베끼는 것도 하지 않았다
 * (위 '베끼지 않는다' 참조 — 베낀 사본은 색이 바뀌는 날 조용히 거짓말을 한다).
 * 그 다섯은 이름과 설명만 서고, 그래도 체크상자는 똑같이 돈다.
 * ============================================================================
 */

/**
 * 배지 키 → 보기 배지. 🔴 **없는 키는 없는 대로 둔다**(위 '모양이 없는 배지 다섯') —
 * 빈 네모나 "모양 없음" 같은 글자를 대신 세우지 않는다. 줄이 한 칸 비는 것보다
 * 뜻 없는 표식이 서는 쪽이 읽는 사람을 더 헷갈리게 한다.
 */
export const BADGE_SAMPLES: Partial<Record<BadgeKey, ReactNode>> = {
  // 열두 가지 중 하나가 늘 뜬다 — 가장 흔한 가운데 단계 하나로 족하다.
  repairStatus: <StatusBadge status="IN_REPAIR" />,
  priority: <PriorityBadge priority="URGENT" />,
  source: <SourceBadge source="DATABASE" />,
  // 🔴 **이름 자체가 두 값을 말한다**(「납기 지연 / 정상」) — 둘 다 세운다. 하나만
  // 세우면 나머지 한쪽을 끄는 것인지 아닌지 알 수 없다.
  overdue: (
    <>
      <OverdueBadge isOverdue />
      <OverdueBadge isOverdue={false} />
    </>
  ),
  dueDateNear: <DueDateNearBadge isDueDateNear />,
  hold: <HoldBadge isOnHold />,
  workflowOverride: <WorkflowOverrideBadge hasOverride />,
  finalShipmentApproved: <FinalShipmentApprovedBadge approved />,
  // 이 배지는 홀로 서지 않는다 — 날짜 뒤에 붙는 작은 꼬리표다. 그래서 날짜를 함께
  // 그리는 진짜 조각을 그대로 쓰고, 빌려 온 상태(이 건에는 날짜가 없고 내자 줄에만
  // 있다)를 만들어 넘긴다. 날짜는 뜻 없는 하루다.
  dueDateFromDomesticOrderShort: (
    <RequestedDueDateValue customerRequestedDueDate={null} domesticOrderDueDates={["2026-01-15"]} />
  ),
  miscCaseStatus: <MiscCaseStatusBadge status="IN_PROGRESS" />,
};

/**
 * 배지 하나의 보기. 모양이 없는 배지에는 **아무것도 그리지 않는다**.
 *
 * 🔴 이 조각도 자리 키를 받지 않는다(위 머리말). 인자가 배지 키 하나뿐이라는 것이
 * "설정 판정 밖"이라는 사실을 타입으로도 말해 준다.
 */
export function BadgeSample({ badgeKey }: { badgeKey: BadgeKey }) {
  const sample = BADGE_SAMPLES[badgeKey];
  if (!sample) return null;
  return <span className="inline-flex flex-wrap items-center gap-1">{sample}</span>;
}
