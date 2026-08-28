import { canReceivePartRequestNotifications } from "@/lib/auth/inventory-authorization";
import { canReceiveCustomerRepairRequestNotifications } from "@/lib/auth/customer-portal-authorization";
import { NOTIFICATION_KINDS, type NotificationKind } from "./notifications";
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
 * 건이 보이지 않고, 부품 요청 알림도 canReceivePartRequestNotifications가
 * queries/notifications.ts 안에서 한 번 더 확인한다.
 *
 * ── 기본값은 "지금과 같음"이다 ──────────────────────────────────────────
 * 저장된 행이 없을 때 이 파일의 답이 그대로 통한다. 그 답은 이 화면을 만들기
 * 전의 동작과 **한 줄도 다르지 않아야 한다** — 표를 만들었다는 이유로 알림이
 * 하나라도 달라지면 그것이 이 작업의 가장 나쁜 결과다.
 *
 * 그래서 부품 요청 알림의 기본값은 여기에 역할 명단을 옮겨 적지 않고
 * auth/inventory-authorization.ts의 canReceivePartRequestNotifications를
 * **호출해서** 구한다(permission-baseline.ts 머리말의 그 규칙이다). 저쪽
 * 명단이 바뀌면 기본값도 저절로 따라 바뀐다.
 *
 * ── 그런데 새로 태어나는 종류는 가리킬 "지금"이 없다 ────────────────────
 * 3단계에서 붙인 PART_STOCK_BELOW_MINIMUM은 반대로 **명단을 여기 적는다**
 * (canReceiveLowStockNotifications). 지금 명단이 부품 요청 알림과 우연히 같은
 * 셋인데도 그 함수를 부르지 않는 이유는 두 가지다.
 *
 *  1) **재현할 옛 동작이 없다.** 위의 규칙("기본값은 지금과 같음")은 이미
 *     돌고 있던 알림을 옮겨 담을 때의 규칙이다. 새 종류에는 지금 통하는 동작이
 *     없으므로 가리킬 대상 자체가 없다 — 대상을 정하는 결정이 바로 여기서 처음
 *     내려진다.
 *  2) **두 질문이 다르다.** 저쪽은 "밀린 **요청**을 처리할 사람이 누구인가"이고
 *     이쪽은 "**재고를 채울** 사람이 누구인가"다. 엔지니어에게 요청 알림을 열어
 *     주기로 하는 날이 와도, 그 결정이 재고 부족 알림까지 조용히 함께 열어서는
 *     안 된다. auth/inventory-authorization.ts가 canProcessPartRequests와
 *     canReceivePartRequestNotifications를 명단이 같은데도 일부러 따로 둔 것과
 *     같은 판단이다.
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
 * ── 왜 이 셋인가 ────────────────────────────────────────────────────────
 * 앞의 둘은 **사람이 눌러 처리하면 없어지는 대기 줄**이다. 그래서 이 저장소가
 * 이미 "밀린 일"에 쓰는 amber(종 배지 bg-amber-500)를 결재에 주고, 부품 요청은
 * 색상환에서 멀찍이 떨어진 sky로 갈라 놓는다. 재고 부족만 red다 — 그것은
 * 사람이 밀린 것이 아니라 **물건이 모자란 것**이고, 눌러서 처리할 대상이 아예
 * 없다(입고가 되어야 사라진다). 저장소가 위험에 red를 쓰는 결과 그대로다.
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
  }
> = {
  REPAIR_CASE_APPROVAL: {
    label: "결재 대기",
    description:
      "내가 결재해야 할 검수·출하 승인 요청입니다. 실제로 누구에게 가는지는 그 건의 결재자(대표 자격·위임)가 정하고, 여기 역할 설정은 그 위에 덧씌우는 필터입니다.",
    toneClassName: "text-amber-700 dark:text-amber-400",
  },
  PART_REQUEST_PENDING: {
    label: "부품 요청 대기",
    description: "엔지니어가 올린 부품 요청 중 아직 처리되지 않은 것입니다. 처리하는 쪽이 받습니다.",
    toneClassName: "text-sky-700 dark:text-sky-400",
  },
  PART_STOCK_BELOW_MINIMUM: {
    label: "재고 부족",
    description:
      "품목 상세에서 소유 구분마다 정해 둔 한계수량보다 재고가 적어진 것입니다. 한계수량을 정하지 않은 품목은 이 알림에 잡히지 않습니다.",
    toneClassName: "text-red-700 dark:text-red-400",
  },
  CUSTOMER_REPAIR_REQUEST_NEW: {
    label: "새 수리 의뢰",
    description:
      "고객사가 전용 주소에서 보낸 수리 의뢰 중 아직 접수로 만들지도, 반려하지도 않은 것입니다. 접수를 만들 수 있는 쪽이 받습니다.",
    toneClassName: "text-emerald-700 dark:text-emerald-400",
  },
};

/**
 * 재고가 한계수량 아래로 떨어졌을 때 종 알림을 받는 역할.
 *
 * 왜 이 셋인가 — 부품을 실제로 채워 넣는 사람(INVENTORY_MANAGER)과, 그것이 밀려
 * 있을 때 나서야 하는 사람(ADMIN·SUPER_ADMIN)이다. AS_ENGINEER는 부품을 쓰는
 * 쪽이고 필요한 것은 부품 요청으로 올린다 — 재고를 채우는 일에 손댈 수단이 없는
 * 사람에게 보내는 알림은 끌 수도 없는 소음이 된다. SALES는 재고를 읽기만 한다
 * (canViewInventory).
 *
 * **명단으로 적는 이유**는 이 시스템의 역할에 순서가 없기 때문이다 —
 * canReceivePartRequestNotifications가 같은 이유로 명단을 쓴다. 그 함수를 부르지
 * 않고 따로 두는 이유는 이 파일 머리말에 있다.
 */
export function canReceiveLowStockNotifications(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

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
 * 결재를 기다리는 건도 처리되지 않은 부품 요청도 조용히 쌓이기만 하고, 그
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
    case "PART_REQUEST_PENDING":
    case "PART_STOCK_BELOW_MINIMUM":
    case "CUSTOMER_REPAIR_REQUEST_NEW":
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
 * 여기가 "지금과 같음"을 지키는 자리다. 두 종류의 지금 규칙이 서로 다른 곳에
 * 흩어져 있던 것을 이 함수 하나로 모은다.
 */
export function defaultRoleReceivesNotification(kind: NotificationKind, role: Role): boolean {
  switch (kind) {
    case "REPAIR_CASE_APPROVAL":
      // 지금 이 알림을 역할로 막고 있는 코드가 한 줄도 없다 — 누가 받는지는
      // 전적으로 "그 건의 결재자인가"가 정한다. 그러므로 다섯 역할 모두 받음이
      // 곧 "지금과 같음"이다. 여기서 어느 역할을 빼면 그 순간 지금 동작이
      // 달라진다(결재자인데 알림을 못 받는 사람이 생긴다).
      return true;

    case "PART_REQUEST_PENDING":
      // 명단을 옮겨 적지 않고 저쪽 함수를 부른다 — 이 파일 머리말 참조.
      return canReceivePartRequestNotifications(role);

    case "PART_STOCK_BELOW_MINIMUM":
      // 반대로 이쪽은 명단을 이 파일에 적었다 — 재현할 옛 동작이 없고, 부품
      // 요청과는 다른 질문이기 때문이다(이 파일 머리말).
      return canReceiveLowStockNotifications(role);

    case "CUSTOMER_REPAIR_REQUEST_NEW":
      // 명단을 옮겨 적지 않고 저쪽 함수를 부른다 — 고객 안내 창구를 볼 수
      // 있는 사람이 곧 그 의뢰를 접수로 만들 사람이다.
      return canReceiveCustomerRepairRequestNotifications(role);

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
