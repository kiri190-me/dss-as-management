import {
  APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS,
  NOTIFICATION_KINDS,
  REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS,
  type NotificationKind,
} from "./notifications";
import { ROLE_CODES, type Role } from "./types";

/**
 * ============================================================================
 * 알림 설정 — 기본값과 어휘
 * ============================================================================
 * `사용자 관리 › 알림 설정` 화면이 다루는 값의 뜻을 정하는 곳이다. DB도,
 * server-only도 여기 들어오지 않는다 — 화면(NotificationSettings)과 서버
 * (db/queries/notification-settings.ts, db/mutations/notification-settings.ts)가
 * **같은 규칙**을 쓰게 하려고 가운데에 둔 것이고, 그래서 Node 단위 테스트로
 * 그대로 돌아간다. permission-baseline.ts / permission-features.ts가 권한 쪽에서
 * 하는 일과 같은 자리다.
 *
 * ── 설정은 윗단 필터다. 원래 판정을 대신하지 않는다 ─────────────────────
 *
 *     알림이 간다 = 종류가 켜져 있다 ∧ 이 역할이 그 종류를 받는다
 *                   ∧ **그 종류의 원래 판정이 참이다**
 *
 * 세 번째 항이 중요하다. REPAIR_CASE_APPROVAL은 **역할로 정해지는 알림이
 * 아니다** — 그 사람이 그 건의 결재자인지(대표 자격·위임)로 정해지고, 그
 * 판정은 SQL 안에 있다(queries/repair-case-approvals-pending.ts). 역할 스위치를
 * 끄면 "결재자인데 알림을 못 받는" 상태가 되는데, 그것은 관리자가 이 화면에서
 * 내릴 수 있는 결정이지 이 설정이 결재자 판정을 대신한다는 뜻이 아니다.
 *
 * 그래서 역할 스위치는 "이 역할이 이 종류를 받을 **수** 있는가"라는 윗단
 * 필터로만 둔다. 켜져 있다고 알림이 가는 것이 아니라, 꺼져 있으면 가지 않는다.
 * 원래 판정은 종전 그대로 각 조회가 계속한다 — 설정을 넓게 열어도 남의 결재
 * 건이 보이지 않는다.
 *
 * ── 기본값은 "지금과 같음"이다 ──────────────────────────────────────────
 * 저장된 행이 없을 때 이 파일의 답이 그대로 통한다. 그 답은 이 화면을 만들기
 * 전의 동작과 **한 줄도 다르지 않아야 한다** — 표를 만들었다는 이유로 알림이
 * 하나라도 달라지면 그것이 이 작업의 가장 나쁜 결과다.
 *
 * 🔴 **2026-10-30: 역할 명단으로 갈리는 종류가 다시 하나 생겼다** —
 * REPAIR_CASE_TARGET_SHIPMENT_MISSING(사내 목표 출하일 미등록)은 **A/S 엔지니어**가
 * 받는 것이 기본값이다(2026-10-29 사용자 결정 — 거기에 종류를 가리지 않는 잠금으로
 * 최고관리자가 더해진다). 아래 두 규칙 중 **「명단을 여기 적는다」** 쪽을 골랐고
 * 까닭은 그 case 에 적어 두었다. 나머지 다섯은 여전히 「모든 역할이 받고, 실제로
 * 누구에게 가는지는 그 종류의 원래 판정이 정한다」 쪽이다.
 *
 * 🔵 2026-10-27(조각 13-C4) ~ 2026-10-29 사이에는 역할로 갈리는 종류가 **하나도
 * 없었다.** 그 전에는 갈림이 둘 있었고 규칙도 둘이었다 —
 *  · 부품 요청 대기(PART_REQUEST_PENDING)는 명단을 여기 옮겨 적지 않고
 *    auth/inventory-authorization.ts 의 canReceivePartRequestNotifications 를
 *    **호출해서** 썼다. 옮겨 담는 종류라 가리킬 「지금」이 있었기 때문이다
 *    (permission-baseline.ts 머리말의 그 규칙). 🔵 **그 함수 자체는 2026-10-28
 *    (조각 13-D)에 지웠다** — 부를 종류가 없어진 뒤로 아무도 안 불렀다. 지금
 *    그 파일에 남은 것은 부품 요청 기본값 셋뿐이라, 다시 붙일 때 그대로 가져다
 *    쓸 함수는 **없다**(여기 적힌 것은 규칙이지 그 함수가 아니다).
 *  · 재고 부족(PART_STOCK_BELOW_MINIMUM)은 반대로 명단을 **이 파일에 적었다.**
 *    새로 태어나는 종류라 재현할 옛 동작이 없었고, 「밀린 요청을 처리할 사람」과
 *    「재고를 채울 사람」은 명단이 같아도 **다른 질문**이라 한쪽을 넓히는 결정이
 *    다른 쪽까지 조용히 열어서는 안 됐다.
 * 🔵 두 규칙은 그대로 살아 있다. 역할로 갈리는 종류를 붙일 때 둘 중 어느 쪽인지를
 *    먼저 가려라 — 옮겨 담는 것이면 그 판정이 적힌 곳을 부르고, 새로 태어나는
 *    것이면 명단을 여기 적는다. 2026-10-30 의 사내 목표 출하일 미등록이 뒤쪽이다.
 * ============================================================================
 */

/**
 * 종류마다 사람이 읽는 이름·한 줄 설명·글자색.
 *
 * 알림 설정을 정하는 사람은 코드를 읽지 않으므로 여기 적힌 말이 그 사람이 가진
 * 정보의 전부다 — permission-features.ts의 label/description과 같은 모양으로,
 * 화면이 아니라 도메인에 둔다. 화면에 적어 두면 종류가 늘 때 화면을 고쳐야
 * 하는데, 그것은 "종류가 늘어도 화면을 안 고친다"는 이 구조의 목적과 정면으로
 * 어긋난다.
 *
 * ── 색도 같은 이유로 여기 있다 ──────────────────────────────────────────
 * 종 패널에 종류가 셋씩 섞여 나오면 어느 줄이 무엇인지 눈으로 갈라지지 않는다.
 * 그렇다고 화면에 `switch (kind)`를 두면 종류가 늘 때마다 화면을 고쳐야 해서
 * 위 목적이 그 자리에서 깨진다. 그래서 색을 **이 표의 한 칸**으로 두고 화면은
 * 읽기만 한다 — 종류가 늘면 이 표를 채우는 것으로 끝나고, 빠뜨리면
 * notification-settings.test.ts가 곧바로 잡는다.
 *
 * ── 🔴 2026-10-19: 색을 **뜻으로** 배정했다(사용자 결정) ────────────────
 * 그 전까지 이 표의 색은 「색상환에서 서로 멀리」만 보고 골랐고, 그나마도 종
 * 패널에 실제로 나오는 색은 그것과 아예 달랐다 — 묶음 종이 **종류 코드를 해시해**
 * 열여섯 칸 중 하나를 자동으로 집었기 때문이다(@dss/ui 의 tone.ts). 그 결과
 * 화면에서 「재고 부족」이 초록 · 「승인 완료」가 분홍 · 「반려됨」이 청록으로
 * 나왔다. 경고가 「괜찮다」로 읽히고 좋고 나쁨이 뒤집힌 것이라, 색이 보조
 * 신호라 해도 그대로 둘 수 없었다.
 *
 * 이제 칸 번호를 이 표에 적어 묶음에 **넘긴다**(toneIndex). 뜻의 갈래는 셋이다:
 *
 *   1. **급한 경고** — 납기 임박(빨강 0).
 *      가장 눈에 띄는 색을 준다. 사람이 눌러 없애는 줄이 아니라 **밖의 일이
 *      풀려야** 사라진다(출하). 🔵 2026-10-27 에 재고 부족(호박 14)을 걷어내
 *      이 갈래는 지금 하나뿐이다 — 호박 칸은 비어 있다.
 *   2. **결과 둘** — 승인 완료(초록 12) · 반려됨(장미 9).
 *      할 일이 아니라 지나간 사건이라 아래 둘과 갈라야 하고, 둘끼리는 좋고
 *      나쁨이 한눈에 갈려야 한다. 초록이 「됐다」, 붉은 쪽이 「안 됐다」다.
 *      반려에 빨강을 주지 않는 것은 그 자리를 급한 경고가 쓰기 때문이다 —
 *      한 칸 비켜선 장미다.
 *   3. **내가 할 일 셋** — 결재 대기(파랑 15) · 견적서 결재 대기(보라 13) ·
 *      사내 목표 출하일 미등록(주황 7).
 *      앞의 둘은 「눌러 처리하면 없어지는 대기 줄」이라 **파랑 계열로 묶어** 한
 *      덩어리로 읽히게 했다.
 *      🔴 **셋째는 그 묶음에서 벗어난다 — 2026-10-30 사용자 요청으로 붉은 계열이다**
 *      (「알림 제목 색을 붉은 계열로 해줘」). 그래서 「파랑 계열 = 내가 할 일」은
 *      이제 **예외 하나를 가진 규칙**이다. 색만 다를 뿐 갈래는 그대로 할 일이고
 *      (날짜를 적으면 사라진다), 붉은 쪽 둘과 섞이지 않게 빨강 0·장미 9가 아닌
 *      주황 7을 골랐다 — 그 종류의 주석에 까닭이 적혀 있다.
 *      🔵 비어 있는 칸: 호박 14(재고 부족) · 하늘 8(부품 요청 대기) ·
 *      남보라 6(불출 승인 대기).
 *
 * ⚠️ 그래서 2026-09 ~ 2026-10 에 적어 두었던 고른 까닭들(「amber 는 밀린 일」·
 *    「승인 완료는 lime」·「납기 임박은 teal」·「fuchsia 가 가장 멀다」)은 더
 *    이상 통하지 않는다. 그때는 고를 수 있는 것이 색 **이름**뿐이었고 서로
 *    떨어뜨리는 것이 유일한 기준이었다. 지금은 칸을 직접 고르므로 기준이
 *    「뜻」으로 올라섰고, 갈라지는지는 아래 시험이 따로 본다.
 *
 * ── 🔴 toneClassName 과 toneIndex 는 **같은 색**이어야 한다 ──────────────
 * 둘은 서로 다른 길로 색이 된다 — 클래스 이름은 이 저장소의 Tailwind 가, 칸
 * 번호는 묶음의 CSS 가 바꾼다. 한쪽만 고치면 같은 종류가 자리에 따라 다른 색이
 * 되고 **아무 오류도 나지 않는다**(예전에 둘이 따로 논 것이 바로 그 모양이다).
 * notification-settings.test.ts 가 묶음 CSS 와 Tailwind 의 색표를 **읽어** 둘을
 * 맞대 보므로, 한쪽만 고치면 그 자리에서 걸린다.
 *
 * ── 색만으로 구분하지 않는다 ────────────────────────────────────────────
 * 색약이신 분에게는 amber와 red가 붙어 보이고, 흑백으로 인쇄하면 셋 다 같은
 * 회색이 된다. 그래서 화면은 이 색과 **함께 label을 글자로도** 그린다
 * (NotificationBell.tsx). 색은 훑을 때 빨리 갈라 주는 보조 신호이지 유일한
 * 신호가 아니다.
 *
 * ── 클래스 이름은 반드시 온전한 글자 그대로 적는다 ──────────────────────
 * Tailwind는 소스 파일에서 클래스 이름을 글자로 찾아 CSS를 만든다.
 * `` `text-${hue}-700` `` 처럼 조립하면 그 클래스는 빌드 결과에 존재하지 않아
 * 화면에서 색이 아예 나오지 않는다(customer-row-color.ts가 같은 이유로 같은
 * 규칙을 지킨다). 밝은 화면과 어두운 화면 값이 한 문자열에 함께 들어 있는
 * 것도 그래서다 — 두 벌을 따로 두면 한쪽만 고쳐지기 쉽다.
 */
export const NOTIFICATION_KIND_META: Record<
  NotificationKind,
  {
    label: string;
    description: string;
    /** 종 패널에서 이 종류를 가리키는 글자색. 밝은 화면 값과 어두운 화면 값이 한 벌이다. */
    toneClassName: string;
    /**
     * 묶음 종(@dss/ui)의 **색 칸 번호**. 0 … NOTIFICATION_TONE_COUNT-1 의 정수다.
     *
     * 🔴 바로 위 toneClassName 과 **같은 색**을 가리켜야 한다(머리말). 안 넘기면
     *    묶음이 종류 코드를 해시해 아무 칸이나 집는데, 그것이 뜻과 어긋난 색을
     *    만들던 자리다. 범위 밖 번호를 적으면 묶음이 해시로 떨어뜨린다 — 색이
     *    통째로 사라지는 것보다 낫다는 그쪽 판단이다(tone.ts).
     */
    toneIndex: number;
  }
> = {
  REPAIR_CASE_APPROVAL: {
    label: "결재 대기",
    description:
      "내가 결재해야 할 검수·출하 승인 요청입니다. 실제로 누구에게 가는지는 그 건의 결재자(대표 자격·위임)가 정하고, 여기 역할 설정은 그 위에 덧씌우는 필터입니다.",
    // 내가 할 일 — 파랑 계열 넷의 기준색.
    toneClassName: "text-blue-700 dark:text-blue-400",
    toneIndex: 15,
  },
  QUOTE_APPROVAL_PENDING: {
    label: "견적서 결재 대기",
    description:
      "내가 결재해야 할 견적서입니다. 실제로 누구에게 가는지는 견적서 승인 절차에서 지금 단계의 승인자로 지정된 사람이 정하고, 지정된 사람이 자리를 비워도 결재가 멈추지 않도록 최고관리자도 받습니다. 견적서 승인 절차가 없으면 결재를 올릴 수 없으므로 이 알림도 뜨지 않습니다(그때는 결재 없이 발행합니다). 여기 역할 설정은 그 위에 덧씌우는 필터입니다.",
    // 내가 할 일.
    toneClassName: "text-violet-700 dark:text-violet-400",
    toneIndex: 13,
  },
  REPAIR_CASE_DUE_DATE_NEAR: {
    label: "납기 임박",
    description:
      `고객 요청 납기일이 오늘부터 ${REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS}일 안으로 다가온 수리 건입니다. ` +
      `수리 건에 날짜가 적혀 있지 않아도 연결된 내자 정리의 납기요청일이 있으면 그 가장 이른 하루로 봅니다 — ` +
      `상세정보 화면에 보이는 날짜 그대로입니다. 양쪽 어디에도 날짜가 없으면 뜨지 않고, 이미 지난 납기와 ` +
      `출하가 끝난 건도 뜨지 않습니다. 처리할 사람이 정해져 있는 알림이 아니라서 모든 역할이 받습니다.`,
    // 급한 경고 — 가장 센 색. 다섯 중 유일하게 날짜가 지나면 손쓸 수 없는 일이다.
    toneClassName: "text-red-700 dark:text-red-400",
    toneIndex: 0,
  },
  REPAIR_CASE_TARGET_SHIPMENT_MISSING: {
    label: "사내 목표 출하일 미등록",
    description:
      `PO발행일은 적혔는데 사내 목표 출하일이 아직 비어 있는 수리 건입니다. ` +
      `수리 건 상세의 [인수 정보]에서 날짜를 등록하면 다음 조회에서 저절로 사라집니다 — ` +
      `눌러서 확인하는 알림이 아니라서, 등록하기 전에는 눌러도 남아 있습니다(2026-10-29 사용자 결정). ` +
      `출하가 끝난 건과 휴지통에 든 건은 뜨지 않습니다. 날짜를 적는 사람에게 가는 알림이라 ` +
      `기본값은 A/S 엔지니어만 받습니다 — 최고관리자는 모든 종류를 받으므로 이 줄도 함께 받습니다.`,
    // 🔴 **붉은 계열이다 — 2026-10-30 사용자 요청**(「알림 제목 색을 붉은 계열로」).
    // 갈래로는 「내가 할 일」이라 파랑 계열이어야 했지만(위 머리말의 셋째 갈래),
    // 사용자가 색을 직접 정했다. 그 계열 안에서 **주황**을 고른 까닭은 이미 붉은
    // 쪽을 쓰는 둘과 한 패널에서 갈라져야 하기 때문이다 — 빨강 0은 납기 임박(급한
    // 경고), 장미 9는 반려됨(결과·안 됐다)이다. 분홍 2는 장미와 이웃이라 반려됨과
    // 섞여 보이고, 주황 7이 셋 중 가장 멀다.
    toneClassName: "text-orange-700 dark:text-orange-400",
    toneIndex: 7,
  },
  APPROVAL_GRANTED: {
    label: "승인 완료",
    description: `내가 요청한 결재(수리 검수 승인·최종 출하 승인·견적서 승인)가 마지막 단계까지 승인된 것입니다. 요청한 사람 본인에게만 가고, 결정된 지 ${APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS}일이 지난 것은 뜨지 않습니다. 할 일이 아니라 알려 드리는 것이라 눌러서 확인하면 사라집니다(다른 기기에서도).`,
    // 결과 — 초록이 「됐다」다.
    toneClassName: "text-green-700 dark:text-green-400",
    toneIndex: 12,
  },
  APPROVAL_REJECTED: {
    label: "반려됨",
    description: `내가 요청한 결재가 어느 단계에서든 반려된 것입니다. 요청한 사람 본인에게만 가고, 결정된 지 ${APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS}일이 지난 것과 내가 스스로 결정한 것은 뜨지 않습니다. 눌러서 확인하면 사라집니다(다른 기기에서도).`,
    // 결과 — 붉은 쪽이 「안 됐다」다. 빨강은 급한 경고(납기 임박)가 쓰므로
    // 한 칸 비켜선 장미다.
    toneClassName: "text-rose-700 dark:text-rose-400",
    toneIndex: 9,
  },
};

/** 화면·서버가 나눠 갖지 않도록, 종류 순서는 언제나 NOTIFICATION_KINDS 그대로다. */
export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/**
 * 최고관리자가 받는 것은 이 화면에서 끌 수 없다.
 *
 * 역할별 접근 권한 설정이 최고관리자 줄을 잠가 두는 것과 같은 이유다
 * (permission-areas.ts의 isRoleEditableInPermissionSettings). 모두를 끄면
 * 되돌릴 사람이 남지 않듯, 알림을 전부 꺼 버리면 밀린 일을 아무도 모르게 된다.
 * 결재를 기다리는 건도 납기가 다가온 건도 조용히 쌓이기만 하고, 그
 * 상태는 화면 어디에도 표시되지 않아 고장과 구별되지 않는다. 최고관리자 한
 * 줄만은 언제나 남겨 둔다.
 *
 * 종류 스위치(사용 여부)는 이 잠금의 대상이 아니다 — 그쪽은 "이 알림을 당분간
 * 아무에게도 보내지 않는다"는 한시적이고 한눈에 보이는 조치이고, 같은 자리에서
 * 바로 되돌릴 수 있으며, 되돌리면 역할 설정이 그대로 살아 있다.
 */
export function isRoleEditableInNotificationSettings(role: Role): boolean {
  return role !== "SUPER_ADMIN";
}

/** 종류 자체의 기본값. 등록된 종류는 켜져 있는 것이 기본이다. */
export function defaultNotificationKindEnabled(kind: NotificationKind): boolean {
  switch (kind) {
    case "REPAIR_CASE_APPROVAL":
    case "QUOTE_APPROVAL_PENDING":
    case "REPAIR_CASE_DUE_DATE_NEAR":
    case "REPAIR_CASE_TARGET_SHIPMENT_MISSING":
    case "APPROVAL_GRANTED":
    case "APPROVAL_REJECTED":
      // 종류를 등록하는 일 자체가 "이 알림을 보낸다"는 결정이다(레지스트리에
      // 넣는 순간부터 계산이 돌기 시작한다). 꺼진 채로 태어나는 종류가 있으면,
      // 등록해 두고 아무 일도 일어나지 않는 상태를 화면에서 설명할 수 없다.
      return true;

    default:
      // 아래 defaultRoleReceivesNotification의 default와 같은 판단이다 —
      // 목록에만 추가하고 여기를 빠뜨렸을 때 조용히 켜지는 것보다 꺼지는 편이
      // 낫다. 빠뜨림 자체는 notification-settings.test.ts가 곧바로 잡는다.
      return false;
  }
}

/**
 * 이 역할이 이 종류를 받는가 — 저장된 설정이 없을 때의 답.
 *
 * 여기가 "지금과 같음"을 지키는 자리다. 종류마다 흩어져 있던 지금 규칙을 이 함수
 * 하나로 모은다. 🔵 여섯 중 다섯은 **전부 참**이고, 사내 목표 출하일 미등록만
 * 역할로 갈린다(2026-10-30 — 이 파일 머리말). switch 를 if 로 접지 않는 것은 다음에
 * 붙는 종류가 참이라는 보장이 없어서다.
 */
export function defaultRoleReceivesNotification(kind: NotificationKind, role: Role): boolean {
  // 🔵 2026-10-30 전까지 이 함수는 `role` 을 한 번도 읽지 않았다(그때는 다섯 종류가
  //    전부 「전원 받음」이라 `void role` 한 줄이 린트를 달래고 있었다). 사내 목표
  //    출하일 미등록이 **역할로 갈리는 첫 종류**가 되면서 그 줄이 사라졌다.
  switch (kind) {
    case "REPAIR_CASE_APPROVAL":
      // 지금 이 알림을 역할로 막고 있는 코드가 한 줄도 없다 — 누가 받는지는
      // 전적으로 "그 건의 결재자인가"가 정한다. 그러므로 다섯 역할 모두 받음이
      // 곧 "지금과 같음"이다. 여기서 어느 역할을 빼면 그 순간 지금 동작이
      // 달라진다(결재자인데 알림을 못 받는 사람이 생긴다).
      return true;

    case "QUOTE_APPROVAL_PENDING":
      // 결재 대기와 같은 까닭으로 다섯 역할 전부 받음이다 —
      // 누가 받는지는 역할이 아니라 결재선 지정(과 최고관리자 비상구)이 정하고,
      // 그 판정은 조회 안의 지정 관문(queries/quote-approvals-pending.ts)이 한다.
      // 견적서 결재선에도 역할 제한이 없고(listSelectableApproverCandidates),
      // 결재를 막는 decideQuoteApproval 은 아예 권한 영역을 묻지 않는다 — 여기서
      // 어느 역할을 빼면 관리자가 「지정은 됐는데 알림은 못 받는」 결재자를 만들 수
      // 있게 되고, 그 실패는 화면에 아무 표시도 남기지 않는다.
      return true;

    case "REPAIR_CASE_DUE_DATE_NEAR":
      // 🔴 2026-10-19 사용자 결정 — **모두에게 보인다.** 역할로 좁히지 않는다.
      // 새로 태어나는 종류라 재현할 옛 동작은 없고, 결재 대기 둘과 같은 모양의
      // 답이다. 까닭은 조금 다르다: 저쪽은 「누가 받는지를 결재선이 정하기」
      // 때문이고, 이쪽은 **애초에 받을 사람을 정하는 축이 없기** 때문이다 —
      // 납기가 다가온 건을 챙기는 일은 엔지니어(수리)·관리자(일정)·영업(고객
      // 응대)·재고 담당자(부품 수급)에게 각자 다른 모양으로 걸린다. 여기서
      // 어느 역할을 빼면 그 사람은 자기 몫이 다가오는 것을 모른 채 지나가고,
      // 그 실패는 화면에 아무 표시도 남기지 않는다. 좁히는 것은 관리자가
      // 나중에 이 화면에서 할 수 있다.
      return true;

    case "REPAIR_CASE_TARGET_SHIPMENT_MISSING":
      // 🔴 2026-10-29 사용자 결정 — **A/S 엔지니어에게 간다.** 지금 등록된 종류 가운데
      // **역할로 갈리는 유일한 종류**다(2026-10-27 에 재고 알림 둘이 빠진 뒤로 비어
      // 있던 자리다 — 이 파일 머리말).
      //
      // 새로 태어나는 종류라 재현할 옛 동작이 없고, 그래서 머리말의 두 규칙 가운데
      // **「명단을 여기 적는다」** 쪽이다. 가리킬 「지금」이 없고, 이 질문(「사내 목표
      // 출하일을 적을 사람이 누구인가」)에 답하는 함수가 이 저장소에 따로 없다.
      // 명단이 짧아 한 줄로 적지만, 그 한 줄이 곧 결정이다.
      //
      // 🔴 **좁히는 자리를 여기로 고른 까닭**(조회 안에서 역할을 보지 않는다):
      //  1. 이 알림이 싣는 것은 인수번호와 날짜뿐이다 — 모든 역할이 이미 목록 화면에서
      //     보는 자료라 **인가 경계가 아니다.** 「납기 임박」이 전원에게 가는 것과 같은
      //     자료이고, 그래서 조회 앞에 관문을 둘 이유가 없다.
      //  2. 조회에 역할을 박으면 관리자가 이 화면에서 영업을 켜도 **아무 일도 일어나지
      //     않는 죽은 스위치**가 된다. 설정은 윗단 필터라는 이 파일 머리말의 규칙이
      //     그 자리에서 거짓말이 된다.
      //  3. 최고관리자 잠금(isRoleEditableInNotificationSettings)은 「최고관리자는
      //     언제나 받는다」를 약속한다. 조회가 역할로 막으면 화면은 「받음(잠김)」이라
      //     적어 놓고 실제로는 한 줄도 안 가는, 화면이 거짓말하는 상태가 된다.
      // 🔴 **최고관리자를 명단에 함께 적는다.** 사용자 결정은 「엔지니어」였지만,
      // 이 저장소에는 종류를 가리지 않는 잠금이 따로 있다 — 최고관리자가 받는 것은
      // 이 화면에서 끌 수 없다(roleReceivesNotification 의
      // isRoleEditableInNotificationSettings). 그 답을 여기 적지 않으면 **화면이
      // 아무도 만지지 않은 칸에 「기본값에서 바뀜」 표시를 붙인다** — 화면은 지금
      // 값(잠금이 정한 참)과 기본값(여기)을 나란히 받아 다른 칸을 표시하기 때문이다
      // (buildNotificationSettingsScreenData). 그러니까 이 한 줄은 명단을 넓히는
      // 결정이 아니라 **이미 참인 것을 같은 말로 적는 것**이다.
      // 🔵 관리자·영업·재고 담당자는 기본 꺼짐이고, 필요하면 이 화면에서 켤 수 있다.
      return role === "AS_ENGINEER" || role === "SUPER_ADMIN";

    case "APPROVAL_GRANTED":
    case "APPROVAL_REJECTED":
      // 새로 태어나는 종류라 재현할 옛 동작은 없고, 답은 다섯 역할 전부 받음이다.
      // 이 알림은 **요청자 본인에게만** 가는 사람 단위 알림이다 — 누가 받는지는
      // 조회가 `requested_by_user_id = 나` 로 정하고(queries/approval-outcome-
      // notifications.ts), 남의 결재 결과가 보일 길이 애초에 없다. 결재를 요청하는
      // 쪽은 역할이 여럿이라(검수·출하는 엔지니어·관리자, 견적서는 영업·관리자)
      // 여기서 역할을 빼면 자기가 올린 결재의 결과를 모르는 사람이 생길 뿐 막아
      // 주는 것이 없다.
      return true;

    default:
      // 종류를 NOTIFICATION_KINDS에만 추가하고 여기를 빠뜨리면, 조용히 전원
      // 허용되는 것보다 아무도 못 받는 편이 낫다. 알림이 안 오는 것은 곧
      // 눈에 띄지만, 받으면 안 되는 사람에게 남의 일이 새는 것은 눈에 띄지
      // 않는다. (타입상 여기 닿을 수 없다 — switch가 종류를 남김없이 덮는다.)
      return false;
  }
}

/**
 * 저장된 설정. **저장된 것만 담는다** — 행이 없는 종류·역할은 여기 나오지
 * 않고(= 기본값 그대로), 그래서 빈 객체가 "설정을 아무도 만지지 않은 상태"를
 * 그대로 뜻한다.
 */
export type NotificationSettingsOverrides = {
  /** 종류 키 → 켜짐 여부. */
  kindEnabled: Partial<Record<NotificationKind, boolean>>;
  /** 종류 키 → 역할 → 받음 여부. */
  roleReceives: Partial<Record<NotificationKind, Partial<Record<Role, boolean>>>>;
};

/** 설정이 하나도 없는 상태. 표가 아직 없는 DB에서도 이 값으로 답한다. */
export const NO_NOTIFICATION_SETTINGS: NotificationSettingsOverrides = {
  kindEnabled: {},
  roleReceives: {},
};

/** 이 종류가 켜져 있는가. 저장된 값이 없으면 기본값이 답한다. */
export function isNotificationKindEnabled(
  kind: NotificationKind,
  overrides: NotificationSettingsOverrides
): boolean {
  return overrides.kindEnabled[kind] ?? defaultNotificationKindEnabled(kind);
}

/**
 * 이 역할이 이 종류를 받는가. 저장된 값이 없으면 기본값이 답한다.
 *
 * 최고관리자는 저장된 값과 무관하게 언제나 참이다. 저장 쪽(mutations)이 이미
 * false를 거절하지만, 판정에서도 한 번 더 막는다 — 옛 행이나 DB를 직접 고친
 * 값 하나로 "밀린 일을 아무도 모르는" 상태가 만들어지면 안 된다.
 */
export function roleReceivesNotification(
  kind: NotificationKind,
  role: Role,
  overrides: NotificationSettingsOverrides
): boolean {
  if (!isRoleEditableInNotificationSettings(role)) return true;
  return overrides.roleReceives[kind]?.[role] ?? defaultRoleReceivesNotification(kind, role);
}

/**
 * 이 역할에게 이 종류의 알림을 **계산해 볼 가치가 있는가**.
 *
 * 종류 스위치와 역할 스위치가 둘 다 참이어야 한다. 참이어도 그 종류의 원래
 * 판정이 다시 걸러 낸다(이 파일 머리말) — 그래서 이름이 "간다"가 아니라
 * "거르지 않는다"에 가깝다.
 */
export function deliversNotification(
  kind: NotificationKind,
  role: Role,
  overrides: NotificationSettingsOverrides
): boolean {
  return isNotificationKindEnabled(kind, overrides) && roleReceivesNotification(kind, role, overrides);
}

// ───────────────────────────────────────────────────────── 화면이 그릴 자료

export type NotificationRoleCell = {
  receives: boolean;
  /** 코드가 정한 기본값. 화면이 "기본값에서 바뀐 칸"을 표시하는 데 쓴다. */
  defaultReceives: boolean;
};

export type NotificationKindRow = {
  kind: NotificationKind;
  label: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
  roles: Record<Role, NotificationRoleCell>;
};

export type NotificationSettingsScreenData = {
  kinds: NotificationKindRow[];
};

/**
 * 화면이 그대로 그릴 표. 저장된 설정과 기본값을 합쳐 칸마다 "지금 값"과
 * "기본값" 두 가지를 함께 내려보낸다.
 *
 * 기본값을 서버에서 계산해 내려보내는 이유는 role-permission-views.ts와 같다 —
 * 화면에서 다시 계산하면 저장할 때 쓰는 값과 두 벌이 되고, 어긋나는 순간
 * "화면에는 기본값이라고 적혀 있는데 저장하면 행이 남는" 상태가 된다.
 *
 * 순수 함수라 DB 없이 그대로 시험할 수 있다.
 */
export function buildNotificationSettingsScreenData(
  overrides: NotificationSettingsOverrides
): NotificationSettingsScreenData {
  return {
    kinds: NOTIFICATION_KINDS.map((kind) => ({
      kind,
      label: NOTIFICATION_KIND_META[kind].label,
      description: NOTIFICATION_KIND_META[kind].description,
      enabled: isNotificationKindEnabled(kind, overrides),
      defaultEnabled: defaultNotificationKindEnabled(kind),
      roles: Object.fromEntries(
        ROLE_CODES.map((role) => [
          role,
          {
            receives: roleReceivesNotification(kind, role, overrides),
            defaultReceives: defaultRoleReceivesNotification(kind, role),
          },
        ])
      ) as Record<Role, NotificationRoleCell>,
    })),
  };
}
