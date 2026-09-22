/**
 * ============================================================================
 * 포털이 물어 올 때의 판단 — 라우트가 아니라 여기에 둔다
 * ============================================================================
 * 세 가지를 정한다:
 *  1. 토큰이 실어 온 **포털 쪽 사람**을 A/S 쪽 사람으로 되짚는 규칙.
 *  2. 되짚지 못했을 때의 답(🔴 오류가 아니라 **빈 목록**).
 *  3. 설정을 읽고 쓸 자격이 있는가(기존 판정 재사용).
 *
 * DB 를 여기서 부르지 않고 **인자로 받는다.** 그래서 이 파일의 판단은 DB 없이
 * 그대로 시험할 수 있고, 라우트에는 「머리말에서 토큰 꺼내 검증하고 이 함수
 * 부르기」만 남는다.
 * ============================================================================
 */

import type { NotificationItem } from "@/lib/domain/notifications";
import {
  externalNotificationCount,
  toExternalNotificationItems,
  type ExternalNotificationItem,
} from "@/lib/domain/notification-links";
import {
  isRoleEditableInNotificationSettings,
  type NotificationSettingsScreenData,
} from "@/lib/domain/notification-settings";
import { ROLE_CODES, roleLabels, type AccountApprovalStatus, type Role } from "@/lib/domain/types";
import { actorMay } from "@/lib/auth/developer-promotion";
import { canManageNotificationSettings } from "@/lib/auth/notification-settings-authorization";
import type {
  NotificationSettingsChange,
  SaveNotificationSettingsResult,
} from "@/lib/db/mutations/notification-settings";

/**
 * 되짚어 낸 A/S 쪽 사람 — 판정에 필요한 만큼만. `UserRow` 가 구조적으로 그대로
 * 들어맞는다(칸이 더 많은 것은 상관없다).
 */
export type PortalActor = {
  id: string;
  role: Role;
  isDeveloper: boolean;
  approvalStatus: AccountApprovalStatus;
  isActive: boolean;
  lockedAt: Date | null;
};

/** 포털 쪽 sub 로 A/S 계정을 찾는다. 없으면 null(= 이 시스템에 계정이 없다). */
export type FindActorBySsoSubject = (subject: string) => Promise<PortalActor | null>;

/**
 * 지금 이 계정으로 일할 수 있는가 — 승인됨 · 활성 · 잠기지 않음.
 *
 * getUserBySsoSubject 는 소프트 삭제만 걸러 낸다(로그인 경로에서는 그 뒤의
 * 판정을 sso-login.ts 가 따로 한다). 이 통로에는 그 뒤가 없으므로 여기서 본다 —
 * 정지된 사람의 밀린 일이 포털의 종에 계속 뜨면 안 된다. 화면 쪽 기준
 * (queries/users.ts 의 getUserById — 삭제·비활성·잠금 제외)과 같은 줄을 긋는다.
 */
export function portalActorCanWork(actor: PortalActor): boolean {
  return actor.approvalStatus === "APPROVED" && actor.isActive && actor.lockedAt === null;
}

/**
 * 토큰의 sub 로 A/S 사람을 찾는다. 🔴 **못 찾는 것은 정상이다** — A/S 는 포털
 * 계정 없이 만든 로컬 계정을 허용하고(users.sso_subject 가 비어 있을 수 있다),
 * 그 사람은 포털에서 로그인한 사람과 애초에 다른 사람이다. 설계서 F-3.
 */
async function resolveActor(
  subject: string,
  findActor: FindActorBySsoSubject
): Promise<PortalActor | null> {
  const actor = await findActor(subject);
  if (!actor) return null;
  return portalActorCanWork(actor) ? actor : null;
}

// ─────────────────────────────────────────────────────────── 알림 목록

export type PortalNotificationFeed = {
  items: ExternalNotificationItem[];
  /** 배지에 찍을 숫자. 같은 대상은 한 번만 센다(A/S 의 종과 같은 규칙). */
  count: number;
};

/** 계정을 못 찾았을 때의 답. 🔴 오류가 아니다. */
const EMPTY_FEED: PortalNotificationFeed = { items: [], count: 0 };

/**
 * 「이 사람의 지금 알림」.
 *
 * 🔴 계산은 **listMyNotifications 그대로**다 — 복제하지 않는다. 알림이 업무
 * 자료에서 매번 파생된다는 성질(domain/notifications.ts 머리말)이 통합의 근거라,
 * 여기에 한 줄이라도 다시 적으면 「처리하면 사라진다」가 두 곳에서 따로 놀게
 * 된다.
 *
 * 역할은 A/S 화면과 **같은 것**을 넘긴다 — 승격하지 않은 진짜 역할이다
 * ((app)/layout.tsx 가 user.role 을 그대로 넘기는 것과 같다).
 */
export async function buildPortalNotificationFeed(params: {
  subject: string;
  baseUrl: string;
  findActor: FindActorBySsoSubject;
  listNotifications: (userId: string, role: Role) => Promise<NotificationItem[]>;
}): Promise<PortalNotificationFeed> {
  const actor = await resolveActor(params.subject, params.findActor);
  if (!actor) return EMPTY_FEED;

  const items = toExternalNotificationItems(
    await params.listNotifications(actor.id, actor.role),
    params.baseUrl
  );
  return { items, count: externalNotificationCount(items) };
}

// ─────────────────────────────────────────────────────── 알림 설정 통로

/**
 * 🔴 역할 목록도 함께 내준다 — 포털은 A/S 의 역할이 무엇인지 모른다(설계서
 * F-4: 「역할 어휘가 시스템마다 다르다」). 코드만 보내면 포털 화면에
 * `INVENTORY_MANAGER` 가 그대로 찍히고, 포털이 번역표를 갖는 순간 A/S 가 역할을
 * 하나 늘릴 때마다 포털을 고쳐 배포해야 한다.
 *
 * `editable` 은 최고관리자 줄 잠금이다 — 화면이 그 줄을 잠그는 규칙
 * (isRoleEditableInNotificationSettings)을 포털도 알아야 같은 모양으로 그린다.
 * 잠금 자체는 저장 쪽(saveNotificationSettings)이 다시 막는다.
 */
export type PortalNotificationRole = {
  code: Role;
  label: string;
  editable: boolean;
};

/**
 * 🔴 역할 이름을 **사용자 지정 문구로** 읽어 오는 통로.
 *
 * 왜 인자로 받는가: 이 파일은 DB 를 모른다(머리말). 그리고 A/S 화면은 이 문구를
 * 「시스템 설정 › 문구」에서 바꾼 것으로 보여 주는데(uiText.role[role]), 창구가
 * 코드 기본값(roleLabels)을 보내면 **「관리자」를 「매니저」로 바꿔 둔 회사에서
 * 포털의 알림 설정만 「관리자」로 보인다.** 2026-09-22 에 A/S 의 알림 설정 탭을
 * 걷어내면서 그 어긋남이 가려 줄 화면조차 없어졌다 — 그래서 창구가 같은 문구를
 * 거쳐 내준다(서버가 읽는 자리는 server/ui-text.ts 의 getUiText 하나다).
 */
export type LoadPortalRoleText = () => Promise<Readonly<Record<Role, string>>>;

/**
 * 🔴 문구를 읽지 못하면 **던지지 않고 코드 기본값으로 떨어진다.**
 *
 * 이 창구는 포털이 요청마다 부르는 자리다. 문구 표가 아직 없는 DB(마이그레이션
 * 전, 다른 개발자 PC)나 DB 가 잠깐 흔들리는 사이에 500 을 내면 포털의 알림 설정
 * 화면 전체가 죽는다 — 바꿔 놓은 이름이 안 보이는 것보다 훨씬 나쁘고, 무엇보다
 * **이 기능을 넣기 전의 동작이 정확히 코드 기본값**이다. 잃는 것이 없다.
 * (queries/ui-text-overrides.ts 의 loadUiTextOverrides 가 「표 없음」을 삼키는
 * 것과 같은 판단이고, 여기서는 그 위의 실패까지 한 번 더 받는다.)
 */
async function resolvePortalRoleText(
  loadRoleText: LoadPortalRoleText
): Promise<Readonly<Record<Role, string>>> {
  try {
    return await loadRoleText();
  } catch (error) {
    console.error("[integration] 역할 이름 문구를 읽지 못해 코드 기본값으로 답합니다:", error);
    return roleLabels;
  }
}

export type PortalNotificationSettings = {
  roles: PortalNotificationRole[];
  kinds: NotificationSettingsScreenData["kinds"];
};

export type PortalSettingsResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 403 | 400; message: string };

/**
 * 포털이 그릴 역할 목록. 순서는 언제나 ROLE_CODES 그대로다.
 *
 * 🔴 이름표는 **받은 문구**에서 나온다 — 코드 표(roleLabels)를 여기서 직접 읽지
 * 않는다. 인자를 선택으로 두지 않은 것이 그 규칙을 지키는 장치다: 빠뜨리면
 * 컴파일이 통과하지 않는다(실제로 한 번 빠뜨려서 포털에만 옛 이름이 나갔다).
 * 넘어온 표에 그 역할이 없을 때만 코드 기본값으로 떨어진다.
 */
export function portalNotificationRoles(
  roleText: Readonly<Record<Role, string>>
): PortalNotificationRole[] {
  return ROLE_CODES.map((code) => ({
    code,
    label: roleText[code] ?? roleLabels[code],
    editable: isRoleEditableInNotificationSettings(code),
  }));
}

/**
 * 설정을 **읽는** 것도 자격을 본다.
 *
 * 화면 쪽이 같은 줄을 긋고 있다 — `사용자 관리` 페이지는 관리자 미만에게는 이
 * 자료를 아예 내려보내지 않는다(app/(app)/users/page.tsx 의 그 주석: 「어느
 * 역할이 무엇을 받는지는 그 자체가 조직 구성 정보다」). 통로만 느슨하면 화면을
 * 잠근 의미가 없다.
 */
export async function readPortalNotificationSettings(params: {
  subject: string;
  findActor: FindActorBySsoSubject;
  loadView: () => Promise<NotificationSettingsScreenData>;
  /** 역할 이름 문구(위 LoadPortalRoleText 의 주석이 까닭이다). */
  loadRoleText: LoadPortalRoleText;
}): Promise<PortalSettingsResult<PortalNotificationSettings>> {
  const actor = await resolveActor(params.subject, params.findActor);
  if (!actor) {
    return { ok: false, status: 403, message: "이 시스템에 쓸 수 있는 계정이 없습니다." };
  }
  if (!actorMay(actor, canManageNotificationSettings)) {
    return { ok: false, status: 403, message: "관리자 이상만 알림 설정을 볼 수 있습니다." };
  }
  // 자격을 본 **뒤에** 읽는다 — 거절할 사람 때문에 표를 두 번 읽을 이유가 없다.
  // 서로를 모르는 두 읽기라 나란히 보낸다(server/ui-text.ts 가 같은 판단을 한다).
  const [view, roleText] = await Promise.all([
    params.loadView(),
    resolvePortalRoleText(params.loadRoleText),
  ]);
  return { ok: true, value: { roles: portalNotificationRoles(roleText), kinds: view.kinds } };
}

/**
 * 설정을 **쓴다.**
 *
 * 🔴 권한 판정을 새로 쓰지 않는다 — 화면이 쓰는 canManageNotificationSettings 를
 * 개발자 승격까지 포함해 그대로 부른다(actorMay). 저장 함수도 트랜잭션 안에서
 * 같은 판정을 다시 한다(mutations/notification-settings.ts 의 3·4번) — 겹치는
 * 것이 맞다. 한쪽이 무너져도 다른 쪽이 남는다.
 *
 * 판정의 대상은 **토큰이 실어 온 사람**이다. 포털이 「내가 관리자다」라고 말하는
 * 것이 아니라, 그 sub 로 되짚은 A/S 계정의 역할이 정한다.
 */
export async function writePortalNotificationSettings(params: {
  subject: string;
  changes: NotificationSettingsChange[];
  findActor: FindActorBySsoSubject;
  save: (input: {
    changes: NotificationSettingsChange[];
    actorUserId: string;
  }) => Promise<SaveNotificationSettingsResult>;
}): Promise<PortalSettingsResult<{ changedCount: number }>> {
  const actor = await resolveActor(params.subject, params.findActor);
  if (!actor) {
    return { ok: false, status: 403, message: "이 시스템에 쓸 수 있는 계정이 없습니다." };
  }
  if (!actorMay(actor, canManageNotificationSettings)) {
    return { ok: false, status: 403, message: "관리자 이상만 알림 설정을 바꿀 수 있습니다." };
  }

  const result = await params.save({ changes: params.changes, actorUserId: actor.id });
  if (!result.ok) {
    return { ok: false, status: result.code === "FORBIDDEN" ? 403 : 400, message: result.message };
  }
  return { ok: true, value: { changedCount: result.changedCount } };
}

/**
 * 포털이 보낸 저장 요청의 모양 확인. 서버 액션이 화면에서 온 값을 확인하는 것과
 * 같은 층위다(server/actions/role-permissions.ts 가 그 본보기다 — 알림 설정의
 * 서버 액션은 2026-09-22 에 화면과 함께 사라졌고, 이제 이 창구가 그 자리다).
 * 모르는 종류·역할을 걸러 내는 것은 그 뒤 저장 함수의 몫이고, 여기서는 모양만 본다.
 */
export function parseNotificationSettingsChanges(
  body: unknown
): { ok: true; changes: NotificationSettingsChange[] } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "요청 본문을 읽을 수 없습니다." };
  }
  const changes = (body as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) {
    return { ok: false, message: "알림 설정 값을 확인할 수 없습니다." };
  }
  for (const change of changes) {
    if (typeof change !== "object" || change === null) {
      return { ok: false, message: "알림 설정 값을 확인할 수 없습니다." };
    }
    const one = change as { kind?: unknown; enabled?: unknown; roles?: unknown };
    if (typeof one.kind !== "string") {
      return { ok: false, message: "알림 종류를 확인할 수 없습니다." };
    }
    if (typeof one.enabled !== "boolean") {
      return { ok: false, message: "알림 사용 여부를 확인할 수 없습니다." };
    }
    if (typeof one.roles !== "object" || one.roles === null || Array.isArray(one.roles)) {
      return { ok: false, message: "알림 대상 값을 확인할 수 없습니다." };
    }
    for (const value of Object.values(one.roles as Record<string, unknown>)) {
      if (typeof value !== "boolean") {
        return { ok: false, message: "알림 대상 값을 확인할 수 없습니다." };
      }
    }
  }
  return { ok: true, changes: changes as NotificationSettingsChange[] };
}
