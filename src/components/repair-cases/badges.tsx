"use client";

import { useIsBadgeVisible } from "@/components/providers/BadgeVisibilityProvider";
import { useUiText } from "@/components/providers/UiTextProvider";
import type { BadgePlaceKey } from "@/lib/domain/badge-visibility";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import type { Priority, RepairStatus } from "@/lib/domain/types";

/**
 * ============================================================================
 * 🔴 `placeKey` — 「이 배지가 지금 **어느 자리**에 서는가」 (2026-11-13, 조각 3)
 * ============================================================================
 * 아래 배지들이 전부 선택적 인자 `placeKey` 를 하나씩 받는다. 받으면 저장된 배지
 * 표시 설정을 보고 **스스로 안 그린다**(null). 안 받으면 지금까지와 **글자 하나
 * 다르지 않게** 그린다.
 *
 * ── 🔴 판단이 배지 안에 있는 까닭 ───────────────────────────────────────
 * 부르는 자리가 스물이 넘는다. 그 자리마다 `{보일까 && <배지/>}` 를 적으면 조건이
 * 스물몇 벌이 되고, 새 화면에서 배지를 하나 더 그리는 날 그 줄을 빠뜨린 것이
 * **아무 오류 없이** 지나간다 — 끈 사람에게는 「한 화면에서만 안 꺼지는」 모양으로
 * 보인다. 조건은 배지 쪽에 한 벌만 둔다.
 *
 * ── 🔴 **안 주면 언제나 보인다** — 이것이 안전장치다 ─────────────────────
 *  · 설정 화면의 보기 배지(settings/badge-samples.tsx)가 자리를 한 글자도 안 넘긴다.
 *    넘기게 되면 「상태」를 끈 순간 설정 화면의 그 줄이 비고, 끈 사람은 무엇을 껐는지
 *    볼 수도 다시 켤 수도 없다(badge-visibility-panel.test.tsx 의 ③ 묶음이 지킨다).
 *  · 설정 대상이 아닌 화면 — 내 담당 제품 · 내 작업기록 · 휴지통 · 고객사 상세 ·
 *    제품모델 상세 · 워크플로 관리 — 도 자리를 안 넘겨 예전 그대로다. 등록부
 *    (domain/badge-visibility.ts)에 그 자리들이 아예 없다.
 *
 * ── 🔵 글자 이름이 `placeKey` 인 까닭 ───────────────────────────────────
 * DB 의 `place_key` · 등록부의 `BadgePlaceKey` 와 같은 말이다. 자리마다 다른 이름을
 * 지으면 설정 화면에서 끈 쌍과 화면이 묻는 쌍이 같은 것인지 눈으로 맞춰 봐야 한다.
 * ============================================================================
 */

/**
 * 🔴 이 파일에 "use client" 를 붙인 이유 — 상태·우선순위 이름표를 저장된 문구로
 * 읽으려면 훅(useUiText)이 필요하고, 훅은 서버 컴포넌트에서 부르면 렌더가 터진다.
 * 이 줄이 생긴 계기는 서버에서 렌더되던 한 갈래였다(검수/승인 탭의 머리말 상자 —
 * 2026-10-06 에 탭 위 머리 카드와 겹쳐 걷어냈다). 그 갈래가 사라진 뒤에도 경계는
 * 파일에 그대로 적어 둔다: 지금 어느 부모가 클라이언트인지에 기대는 것보다,
 * 경계가 파일에 적혀 있어야 나중에 서버 화면에서 배지를 하나 더 쓰는 날 조용히
 * 깨지지 않는다. 받는 값이 전부 문자열/불리언이라 경계를 건너는 데 드는 비용도
 * 없고, 만들어지는 HTML 은 이전과 같다.
 */

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function StatusBadge({
  status,
  placeKey,
}: {
  status: RepairStatus;
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const uiText = useUiText();
  const visible = useIsBadgeVisible("repairStatus", placeKey);
  if (!visible) return null;
  const tone =
    status === "SHIPMENT_COMPLETED"
      ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`${baseBadgeClass} ${tone}`}>{uiText.repairStatus[status]}</span>;
}

export function PriorityBadge({
  priority,
  placeKey,
}: {
  priority: Priority;
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const uiText = useUiText();
  const visible = useIsBadgeVisible("priority", placeKey);
  if (!visible) return null;
  const tone =
    priority === "URGENT"
      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
      : priority === "HIGH"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`${baseBadgeClass} ${tone}`}>{uiText.priority[priority]}</span>;
}

export function SourceBadge({
  source,
  placeKey,
}: {
  source: "MOCK" | "LOCAL_DEMO" | "DATABASE";
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("source", placeKey);
  if (!visible) return null;
  if (source === "LOCAL_DEMO") {
    return (
      <span
        className={`${baseBadgeClass} bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400`}
      >
        로컬 데모 데이터
      </span>
    );
  }
  if (source === "DATABASE") {
    return (
      <span
        className={`${baseBadgeClass} bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400`}
      >
        DB
      </span>
    );
  }
  // MOCK stays unbadged, unchanged from before Stage G-2.
  return null;
}

/**
 * 「납기 지연」 — **고객 요청 납기일**이 지났고 아직 안 나간 건 (2026-11-03).
 *
 * 🔴 그 전까지 이 배지가 재던 것은 **사내 목표 완료일**(칸 이름은
 * internalTargetShipmentDate 그대로)이었다. 사용자 결정으로 바뀌었다 — 「사내 목표
 * 완료일을 지났다고 해서 납기 지연 배지가 뜨지 않도록 해줘. (고객 요청 납기일을
 * 지났을 때만 [납기 지연]이 뜨도록 해줘.)」 사내 날짜는 우리가 스스로 잡은 일정이고,
 * 그것을 넘긴 것은 고객과의 약속을 어긴 것이 아니다.
 *
 * 🔴 **2026-11-07 — 그 칸이 비면 연결된 내자 정리의 납기요청일을 빌려 잰다.** 사용자
 * 요구: 「고객 요청 납기일이 **내자정리에서 읽어온 경우 [납기지연]이 안뜨는** 것
 * 같아. … **수리건 상세에서 적은 것과 같은 취급**을 해주도록 해줘」. 그 전까지 이
 * 배지만 제 칸 하나를 봐서, 바로 아래 「납기 임박」·「납기 역전」은 빌려 온 날짜로
 * 뜨는데 이것만 안 뜨고 있었다.
 * 🔵 꼬리표(「내자 정리에서 작성됨」) 표시는 그대로다 — 넓힌 것은 판정뿐이다
 * (2026-10-30 「동기화해도 출처 표시는 남긴다」 결정).
 *
 * 🔴 판정은 여기서 하지 않는다 — 받는 것은 불리언 하나뿐이고, 조건은
 * domain/repair-case-overdue.ts 의 isRepairCaseOverdue 하나에 있다(바로 아래
 * DueDateNearBadge 와 같은 규율). 🔵 종 알림 「납기 지연」도 **그 함수 하나**를 쓴다
 * (2026-11-07 — queries/repair-case-overdue-notifications.ts). 글자도 나눠 쓰지 않고
 * 종류 이름표가 이 배지와 같은 말을 적는다(NOTIFICATION_KIND_META).
 *
 * ── 🔴 **지연이 아니면 아무것도 안 그린다** (2026-11-13) ────────────────────
 * 그 전까지는 지연이 아닌 건에 회색 글자 「정상」을 세웠다(표에서는 파란 알약이었다).
 * 사용자 결정으로 걷어냈다 — 「[정상] 배지는 없애 달라. 납기가 지연되었을 때에
 * [납기 지연] 배지만 뜨면 된다」.
 * 🔵 그래서 이 배지도 이웃들과 **같은 규율**이 됐다: 바로 아래 DueDateNearBadge ·
 * HoldBadge · WorkflowOverrideBadge · FinalShipmentApprovedBadge 가 전부 「아닐 때는
 * 아무것도 안 그린다」다. 안 붙는 것이 기본값인 배지에 빈자리 글자를 두면 목록의
 * 모든 줄이 한 칸씩 길어진다.
 */
export function OverdueBadge({
  isOverdue,
  placeKey,
}: {
  isOverdue: boolean;
  /**
   * 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말).
   *
   * 🔵 끄면 「납기 지연」이 안 그려진다 — 그것이 이 배지가 그리는 전부다. 🔴 예전에는
   * 「정상」까지 **함께** 꺼야 한다는 주의가 여기 적혀 있었는데, 2026-11-13 에 「정상」
   * 자체를 걷어내 그 짝이 사라졌다(바로 위 머리말). 등록부의 이름도 같은 날
   * 「납기 지연 / 정상」에서 「납기 지연」으로 줄였다.
   */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("overdue", placeKey);
  if (!visible) return null;
  if (!isOverdue) return null;
  return (
    <span
      className={`${baseBadgeClass} bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400`}
    >
      납기 지연
    </span>
  );
}

/**
 * 「납기 임박」 — 고객 요청 납기일이 **오늘부터 7일 안**으로 다가온 건 (2026-10-19).
 *
 * ── 🔴 「납기 지연」(OverdueBadge)과 **다른 판정이고 다른 색**이다 ───────────
 * 🔵 2026-11-03 부터 **둘이 같은 날짜를 본다** — 바로 위의 OverdueBadge 는 고객 요청
 * 납기일을 **넘겼는가**(isRepairCaseOverdue), 이 배지는 그 날짜가 **다가왔는가**다.
 * 그 전까지 지연 쪽은 사내 목표 완료일을 봤다. 날짜가 같아져도 **둘은 여전히 섞이지
 * 않는다**: 두 창이 겹치지 않으므로(지났다 ↔ 오늘부터 7일) 한 건에 둘이 동시에
 * 붙지는 않는다 — 날짜가 갈려 있던 동안에는 겹칠 수 있었다.
 * 🔵 **2026-11-07 부터 빌려 오기도 같다** — 둘 다 자기 칸이 비면 연결된 내자 줄의
 * 가장 이른 하루를 본다(resolveRepairCaseRequestedDueDate). 그 전까지는 이 배지만
 * 빌려 왔고, 그 어긋남이 사용자가 신고한 결함이었다.
 *
 * 🔴 색을 red 가 아니라 rose 로 둔 것은 사용자 결정이다. 진한 빨강으로 하면 바로
 * 옆의 「납기 지연」과 **같은 색**이 되어 「이미 늦음」과 「곧 늦음」이 구별되지
 * 않는다. 그 둘은 하는 일이 다르다 — 지연은 사과할 일이고 임박은 서두를 일이다.
 *
 * ── 🔴 판정은 이 조각이 하지 않는다 ─────────────────────────────────────────
 * 받는 것은 불리언 하나뿐이다. 「오늘」을 화면에서 `new Date()` 로 만들면 서버가
 * 그린 것과 어긋나 hydration 이 깨지고(app/(app)/repair-cases/page.tsx 의
 * longPendingPoCaseIds 주석), 조건을 여기 적으면 종 알림과 두 말이 된다. 판정은
 * 서버가 domain/notifications.ts 의 isRepairCaseDueDateNear 하나로 한다 —
 * 종 알림이 쓰는 바로 그 세 함수를 묶은 것이다.
 *
 * 글자는 종 알림의 종류 이름을 그대로 가져온다(NOTIFICATION_KIND_META) — 같은
 * 사실을 종에서는 「납기 임박」, 표에서는 다른 말로 부르지 않기 위해서다.
 */
export function DueDateNearBadge({
  isDueDateNear,
  placeKey,
}: {
  isDueDateNear: boolean;
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("dueDateNear", placeKey);
  if (!visible) return null;
  if (!isDueDateNear) return null;
  return (
    <span className={`${baseBadgeClass} bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400`}>
      {NOTIFICATION_KIND_META.REPAIR_CASE_DUE_DATE_NEAR.label}
    </span>
  );
}

/**
 * Stage E-1: 워크플로 보류(holdState)는 exceptionStatus·isOverdue와 완전히
 * 별개의 축이다 — 이 배지는 절대 다른 배지와 문자열/의미를 합치지 않는다.
 */
export function HoldBadge({
  isOnHold,
  placeKey,
}: {
  isOnHold: boolean;
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("hold", placeKey);
  if (!visible) return null;
  if (!isOnHold) return null;
  return (
    <span className={`${baseBadgeClass} bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>
      보류 중
    </span>
  );
}

/** 해당 접수 건에 Stage E-1 로컬 워크플로 재정의가 적용되어 있음을 표시한다. */
export function WorkflowOverrideBadge({
  hasOverride,
  placeKey,
}: {
  hasOverride: boolean;
  /** 지금 서는 자리. 안 주면 설정과 상관없이 늘 그린다(파일 머리말). */
  placeKey?: BadgePlaceKey;
}) {
  const visible = useIsBadgeVisible("workflowOverride", placeKey);
  if (!visible) return null;
  if (!hasOverride) return null;
  return (
    <span className={`${baseBadgeClass} bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400`}>
      로컬 워크플로 재정의
    </span>
  );
}
