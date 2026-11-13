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
import {
  DomesticOrderCompletedBadge,
  DueDateFromRepairCaseBadge,
  DueDateRowCompletedBadge,
  OrderIssuedDateMissingBadge,
} from "@/components/domestic-orders/badges";
import MiscCaseStatusBadge from "@/components/misc-cases/MiscCaseStatusBadge";
import BorrowedSourceNote from "@/components/repair-cases/BorrowedSourceNote";
import RequestedDueDateValue from "@/components/repair-cases/RequestedDueDateValue";
import type { BadgeKey } from "@/lib/domain/badge-visibility";
import { domesticOrderDueDateRowLabel } from "@/lib/domain/domestic-order-due-date-label";
import { DUE_DATE_FROM_DOMESTIC_ORDER_LABEL } from "@/lib/domain/requested-due-date-link";

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
 * ── 🔵 모양이 없는 배지는 이제 **하나도 없다** (2026-11-13) ──────────────
 * 이 파일이 생길 때는 다섯이 비어 있었다. 다섯 다 화면 파일 안의 **비공개 함수**가
 * 그리고 있어 가져다 쓸 수가 없었던 것들이고, 같은 날 둘로 나눠 떼어냈다:
 *  · 넷(`dueDateFromRepairCase` · `domesticOrderCompleted` · `dueDateRowCompleted` ·
 *    `orderIssuedDateMissing`)은 내자 정리 목록 화면에서 → domestic-orders/badges.tsx
 *  · 하나(`dueDateFromDomesticOrder`)는 수리건 상세 기본 정보 탭의 `Field` 에서
 *    → repair-cases/BorrowedSourceNote.tsx
 * 🔴 여기서 하는 일은 **그 조각들을 그대로 부르는 것**뿐이다 — 모양을 베껴 적지
 * 않았다(위 '베끼지 않는다'). 🔴 **다시 비는 줄이 생기면** 아래 표에 사본을 그리지
 * 말고 그 화면에서 조각을 떼어내 여기서 불러라.
 *
 * 🔵 떼어낸 조각이 **언제 그리는가를 함께 가져가지는 않았다.** 「내자 정리에서
 * 작성됨」의 관문(BadgeVisibilityGate · 배지 키 · 자리 키)은 부르는 화면
 * (repair-cases/detail/IntakeInfoSection.tsx)에 그대로 남아 있다 — 조각이 설정을
 * 스스로 읽으면 아래 보기가 함께 사라진다(위 '보기 배지는 설정 판정을 타면 안 된다').
 * ============================================================================
 */

/**
 * 배지 키 → 보기 배지. 🔵 지금은 **열다섯이 다 차 있다**(위 '모양이 없는 배지는 이제
 * 하나도 없다'). 🔴 그래도 타입을 `Partial` 로 둔다 — 배지를 새로 등록하는 날 보기를
 * 빠뜨릴 수 있고, 그때 **없는 키는 없는 대로 둔다**. 빈 네모나 "모양 없음" 같은 글자를
 * 대신 세우지 않는다: 줄이 한 칸 비는 것보다 뜻 없는 표식이 서는 쪽이 읽는 사람을 더
 * 헷갈리게 한다. 🔵 비는 줄이 생겼다는 사실은 시험이 잡는다
 * (badge-visibility-panel.test.tsx 의 「배지 열다섯에 **전부** 보기가 있다」).
 */
export const BADGE_SAMPLES: Partial<Record<BadgeKey, ReactNode>> = {
  // 열두 가지 중 하나가 늘 뜬다 — 가장 흔한 가운데 단계 하나로 족하다.
  repairStatus: <StatusBadge status="IN_REPAIR" />,
  priority: <PriorityBadge priority="URGENT" />,
  source: <SourceBadge source="DATABASE" />,
  // 🔵 **보기가 하나다**(2026-11-13). 그 전까지는 둘을 나란히 세웠다 — 이름이
  // 「납기 지연 / 정상」이라 한쪽만 세우면 나머지를 끄는 것인지 알 수 없었다. 같은 날
  // 「정상」 쪽 표시를 걷어내(badges.tsx 의 OverdueBadge) 이 배지가 그리는 것이 하나가
  // 됐고, 등록부의 이름도 「납기 지연」으로 줄였다. 🔴 `isOverdue={false}` 를 여기
  // 되돌려 적으면 **아무것도 안 그리는 빈 보기**가 하나 늘 뿐이다.
  overdue: <OverdueBadge isOverdue />,
  dueDateNear: <DueDateNearBadge isDueDateNear />,
  hold: <HoldBadge isOnHold />,
  workflowOverride: <WorkflowOverrideBadge hasOverride />,
  finalShipmentApproved: <FinalShipmentApprovedBadge approved />,
  // 🔵 이것만 알약이 아니라 **테두리 있는 상자 한 줄**이다 — 수리건 상세의 날짜
  // **아래**에 서기 때문이다(그 칸들이 2열 격자라 옆에 붙이면 어차피 접힌다).
  // 🔴 글자는 도메인 상수를 그대로 넘긴다. 「내자 정리에서 작성됨」을 여기 적으면
  // 그 말이 바뀌는 날 설정 화면만 옛말로 남는다 — 종 알림·편집 폼이 같은 말을 쓴다.
  // 🔴 자리 키는 안 넘긴다. 이 조각은 애초에 받지도 않는다(그 파일 머리말).
  dueDateFromDomesticOrder: <BorrowedSourceNote label={DUE_DATE_FROM_DOMESTIC_ORDER_LABEL} />,
  // 이 배지는 홀로 서지 않는다 — 날짜 뒤에 붙는 작은 꼬리표다. 그래서 날짜를 함께
  // 그리는 진짜 조각을 그대로 쓰고, 빌려 온 상태(이 건에는 날짜가 없고 내자 줄에만
  // 있다)를 만들어 넘긴다. 날짜는 뜻 없는 하루다.
  dueDateFromDomesticOrderShort: (
    <RequestedDueDateValue customerRequestedDueDate={null} domesticOrderDueDates={["2026-01-15"]} />
  ),
  // 🔵 바로 위와 **거울 관계**인 꼬리표다(이쪽은 내자 정리에서 수리 건의 날짜를
  // 빌려 온 자리). 날짜 없이 혼자 세우는 까닭은 위와 다르다 — 그 칸의 날짜를 그리는
  // 조각이 내자 줄 **한 행 전체**를 받으므로, 보기를 세우자고 가짜 줄을 지어내야
  // 한다. 꼬리표 조각만 부르면 모양은 화면의 것 그대로다.
  dueDateFromRepairCase: <DueDateFromRepairCaseBadge />,
  domesticOrderCompleted: <DomesticOrderCompletedBadge />,
  // 🔴 회차 번호와 이름은 **도메인 함수**가 만든다 — 「1차」를 여기 적으면 그 말이
  // 바뀌는 날 설정 화면만 옛 말로 남는다. 날짜는 뜻 없는 하루다(title 에만 쓰인다).
  dueDateRowCompleted: (
    <DueDateRowCompletedBadge
      rowOrder={1}
      label={domesticOrderDueDateRowLabel(1, { dueDate: "2026-01-15", note: null })}
    />
  ),
  orderIssuedDateMissing: <OrderIssuedDateMissingBadge />,
  miscCaseStatus: <MiscCaseStatusBadge status="IN_PROGRESS" />,
};

/**
 * 배지 하나의 보기. 모양이 없는 배지에는 **아무것도 그리지 않는다** — 🔵 2026-11-13
 * 현재 그런 배지는 **하나도 없고**, 이 아래 줄은 새 배지를 등록하고 보기를 아직 안
 * 단 사이를 버티는 길이다(위 표의 머리말).
 *
 * 🔴 이 조각도 자리 키를 받지 않는다(위 머리말). 인자가 배지 키 하나뿐이라는 것이
 * "설정 판정 밖"이라는 사실을 타입으로도 말해 준다.
 */
export function BadgeSample({ badgeKey }: { badgeKey: BadgeKey }) {
  const sample = BADGE_SAMPLES[badgeKey];
  if (!sample) return null;
  return <span className="inline-flex flex-wrap items-center gap-1">{sample}</span>;
}
