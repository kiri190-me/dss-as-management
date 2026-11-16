import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { users } from "../schema";
import { insertAuditLog } from "../mutations/audit-logs";
import type { AccountApprovalStatus, Role } from "@/lib/domain/types";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  approvalStatus: AccountApprovalStatus;
  isActive: boolean;
  lockedAt: Date | null;
  /** 이 시각보다 먼저 발급된 세션은 무효다. null이면 끊긴 적이 없다. */
  sessionsValidFrom: Date | null;
  /**
   * 개발자 표시. 역할이 아니라 별도 칸이다(users.is_developer) — 권한 판정에서만
   * 최고관리자로 해석되고, role 자체는 건드리지 않는다.
   */
  isDeveloper: boolean;
};

const SELECT_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  approvalStatus: users.approvalStatus,
  isActive: users.isActive,
  lockedAt: users.lockedAt,
  sessionsValidFrom: users.sessionsValidFrom,
  isDeveloper: users.isDeveloper,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Used by acting-user.ts to resolve a session's userId (a real users.id
 * UUID in database mode) back to display/role information on every
 * request. Excludes soft-deleted, deactivated, and locked rows — any of
 * those resolves to null, same as a nonexistent one, so a session survives
 * only as long as the account behind it stays deleted-free, active, and
 * unlocked (re-checked on every request, not just at login).
 *
 * A non-UUID-shaped id resolves to null before ever reaching the DB,
 * instead of letting Postgres throw "invalid input syntax for type uuid" —
 * a stale/forged/pre-migration session cookie could still carry a
 * mock-data-style id (e.g. "u-001"), and this must fail closed, not throw,
 * the same way parseSessionToken treats any malformed token as null.
 */
export async function getUserById(id: string): Promise<UserRow | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }
  const [row] = await db
    .select(SELECT_COLUMNS)
    .from(users)
    .where(and(eq(users.id, id), eq(users.isDeleted, false), eq(users.isActive, true), isNull(users.lockedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Used only by db-login.ts at login time. Case-insensitive (company email
 * addresses are conventionally treated as such) — compares lower(email) on
 * both sides rather than relying on the caller having already normalized
 * case, so this stays correct even if a future caller forgets to.
 * Excludes soft-deleted rows — a deleted account behaves like a
 * nonexistent one at login (never distinguished, to avoid revealing it
 * once existed).
 */
export async function getUserForLoginByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db
    .select(SELECT_COLUMNS)
    .from(users)
    .where(and(sql`lower(${users.email}) = lower(${email})`, eq(users.isDeleted, false)))
    .limit(1);
  return row ?? null;
}

export type LoginPickerUserRow = Pick<UserRow, "id" | "email" | "name" | "role" | "approvalStatus">;

/**
 * Used only by the demo login page in AUTH_SOURCE=database mode, to render
 * a picker of real accounts in place of the hardcoded mock-data list — same
 * no-password trust model as the existing mock demo login, just backed by
 * real rows. Excludes soft-deleted, deactivated, and locked accounts (those
 * should never be selectable, not merely rejected after the fact by
 * resolveDbLogin).
 */
export async function listUsersForLoginPicker(): Promise<LoginPickerUserRow[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      approvalStatus: users.approvalStatus,
    })
    .from(users)
    .where(and(eq(users.isDeleted, false), eq(users.isActive, true), isNull(users.lockedAt)))
    .orderBy(users.name);
}


/**
 * Used only by sso-login.ts. Resolves a DSS subject (the ID token's `sub`,
 * which is dss-auth's own users.id) back to a local account.
 *
 * Deliberately keyed on sso_subject and never on email: a Kakao account
 * holder can change their email at any time, so it cannot anchor an
 * identity. Excludes soft-deleted rows — a deleted account behaves like a
 * nonexistent one at login, exactly as getUserForLoginByEmail does.
 */
export async function getUserBySsoSubject(subject: string): Promise<UserRow | null> {
  if (!subject) {
    return null;
  }
  const [row] = await db
    .select(SELECT_COLUMNS)
    .from(users)
    .where(and(eq(users.ssoSubject, subject), eq(users.isDeleted, false)))
    .limit(1);
  return row ?? null;
}

/**
 * 이 사람의 **포털 쪽 id**(`users.sso_subject`). 머리말의 종이 포털에 「다른
 * 시스템들의 알림」을 물을 때 `sub` 으로 보내는 값이고, 그 통로는 사람을 이
 * 값으로만 가리킨다(dss-auth/docs/사이트-알림-통로.md).
 *
 * 🔴 **없는 것이 정상이다.** A/S 는 포털 계정 없이 만든 로컬 계정을 허용하고
 * (설계서 F-3) 그 사람은 포털에 물을 수 없다 — 자기 알림만 보게 된다. 그래서
 * null 은 오류가 아니라 「묻지 않는다」는 답이다.
 *
 * ── 🔴 왜 UserRow 에 칸을 더하지 않는가 ─────────────────────────────────
 * 그 타입은 거의 모든 요청의 인가 판정이 지나는 자리이고, 삭제 · 감사 기록은
 * 포털 쪽 식별자를 **일부러 싣지 않는다**(mutations/user-deletion.ts 와 그
 * 시험: 「감사 기록에 sso_subject 가 실렸다」). 거기에 칸을 더하면 그 값이
 * 로그와 미리보기에 딸려 나갈 길이 열린다. 읽는 곳은 머리말 하나뿐이라 그 한
 * 곳만 따로 읽는다.
 *
 * 걸러 내는 조건은 getUserBySsoSubject 와 같은 줄이다(소프트 삭제 제외).
 * 비활성 · 잠금을 여기서 다시 보지 않는 이유는 부르는 쪽이 이미 살아 있는
 * 계정을 확인했기 때문이다((app)/layout.tsx 의 resolveActingUserForSession).
 */
export async function getSsoSubjectForUser(id: string): Promise<string | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }
  const [row] = await db
    .select({ ssoSubject: users.ssoSubject })
    .from(users)
    .where(and(eq(users.id, id), eq(users.isDeleted, false)))
    .limit(1);
  return row?.ssoSubject ?? null;
}

/**
 * 바로 위와 **방향이 반대**다 — 포털 번호 여럿을 받아 **A/S 의 `users.id`** 로 바꾼다.
 * 2026-11-16, 포털에 모은 결재권 위임이 A/S 로 넘어오면서 생겼다
 * (dss-approvals/DELEGATION_DESIGN.md 의 C-3: 「포털이 준 `sub` 를 A/S 의 `users.id`
 * 로 바꿔야 한다」). 포털은 사람을 `sub` 로만 가리키는데 A/S 의 결재 판정은 제
 * `users.id` 로 돌기 때문이다(domain/approval-route-delegation.ts 의 「열쇠는
 * `users.id`(uuid) 다」).
 *
 * ── 🔴 쓰는 자리가 **하나**다. 받는 통로다 ──────────────────────────────
 * `app/api/integration/delegations/route.ts` — 포털이 위임을 **전파해 올 때** 두
 * 사람의 번호를 A/S 계정으로 바꾼다(설계 B-12 의 4번). 그 뒤로는 표에 A/S `users.id`
 * 로 앉아 있어, 결재 판정은 이 조회를 거치지 않는다.
 * 🔵 그날 낮에는 **결재할 때마다** 포털에 물어 받은 번호를 여기서 바꿨다(설계 B-3).
 * 저녁에 방식이 뒤집히면서 그 길은 걷어냈다.
 *
 * ── 🔴 못 찾은 번호는 **버려진다. 그리고 그것이 답이다** ─────────────────
 * 이 함수는 찾은 것만 돌려주고, 「둘 중 하나라도 못 바꿨다」를 판정하는 일은 **부르는
 * 쪽**이 한다(server/integration/portal-delegation-push.ts 가 `not_applicable` 로
 * 답한다 — 오류가 아니다). A/S 계정이 없는 사람에게는 여기서 결재할 일이 없으니
 * 위임도 뜻이 없고, 실패로 돌려주면 포털이 **지정 자체를 거절한다**(설계 B-13).
 *
 * 🔵 2026-11-16 운영 실측으로는 살아 있는 계정 8명·결재선에 오른 5명 모두
 * `sso_subject` 가 차 있어 못 바꾸는 사람이 **지금은 0명**이다. 손으로 만든 로컬
 * 계정이 다시 생기면 그 사람에게 맡긴 위임만 `not_applicable` 로 조용히 지나간다
 * (설계 D-3 의 마지막 문단).
 *
 * ── 거르는 조건 ─────────────────────────────────────────────────────────
 * 소프트삭제된 계정만 뺀다 — `getUserBySsoSubject` 와 **같은 줄**이다. 비활성·잠금은
 * 보지 않는다: 이 값이 들어가는 판정(`resolveActingApproverUserIds`)이 **맡긴 사람의
 * 계정 상태를 일부러 보지 않기** 때문이다(그 함수의 🔴 주석 — 자리를 비운 바로 그
 * 상황에서 위임이 함께 죽으면 안 된다). 여기서만 좁히면 두 길의 답이 갈린다.
 *
 * 🔵 돌려주는 차례는 **받은 번호의 차례**다. 질의가 주는 차례를 그대로 쓰면 실행마다
 * 달라질 수 있고, 이 값은 결재자 목록의 뒷자리로 들어가 기록(`delegated_from_user_id`)을
 * 고르는 데까지 쓰인다 — 값이 흔들릴 자리를 남기지 않는다.
 */
export async function listUserIdsBySsoSubjects(
  subjects: readonly string[]
): Promise<{ id: string; ssoSubject: string }[]> {
  const wanted = Array.from(
    new Set(subjects.filter((one): one is string => typeof one === "string" && one !== ""))
  );
  // 🔴 빈 목록이면 **질의를 던지지 않는다.** drizzle 은 `inArray(…, [])` 를 `false`
  //    로 굽기 때문에 결과는 같지만, 아무것도 못 찾을 질의를 왕복시킬 까닭이 없다.
  if (wanted.length === 0) return [];

  const rows = await db
    .select({ id: users.id, ssoSubject: users.ssoSubject })
    .from(users)
    .where(and(inArray(users.ssoSubject, wanted), eq(users.isDeleted, false)));

  const bySubject = new Map(
    rows
      .filter((row): row is { id: string; ssoSubject: string } => row.ssoSubject !== null)
      .map((row) => [row.ssoSubject, row])
  );
  return wanted.flatMap((subject) => {
    const row = bySubject.get(subject);
    return row ? [row] : [];
  });
}

/**
 * One-time link of an existing local account to a DSS subject, used on a
 * user's first SSO login when their account predates SSO.
 *
 * The `sso_subject IS NULL` guard is the security-relevant part, not an
 * optimization: without it, anyone whose DSS profile carried a matching
 * email could re-point an account that is already linked to someone else,
 * taking it over. Conditional UPDATE makes that impossible at the database
 * level rather than relying on the caller to check first (which would race).
 *
 * Returns true only when this call performed the link.
 */
export async function linkUserToSsoSubject(userId: string, subject: string): Promise<boolean> {
  if (!UUID_PATTERN.test(userId) || !subject) {
    return false;
  }
  const linked = await db
    .update(users)
    .set({ ssoSubject: subject, ssoLinkedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(users.id, userId),
        isNull(users.ssoSubject),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .returning({ id: users.id });
  return linked.length > 0;
}

/**
 * Writes what the login portal decided onto a linked account — 역할, 실명,
 * 이메일 — in one statement.
 *
 * Guarded on `sso_subject = :subject` rather than on the id alone: this only
 * ever touches an account the portal actually owns, so a bug elsewhere that
 * passed the wrong id cannot rewrite an unlinked account.
 *
 * Returns true only when a row actually changed, so the caller never reports
 * a value the database does not hold.
 */
export async function applySsoIdentity(
  subject: string,
  userId: string,
  patch: { role?: Role; email?: string; name?: string }
): Promise<boolean> {
  if (!UUID_PATTERN.test(userId) || !subject) {
    return false;
  }
  if (patch.role === undefined && patch.email === undefined && patch.name === undefined) {
    return false;
  }
  const updated = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(users.id, userId),
        eq(users.ssoSubject, subject),
        eq(users.isDeleted, false)
      )
    )
    .returning({ id: users.id });
  return updated.length > 0;
}

/**
 * Cuts every session this person currently holds, by raising the line that
 * sessions must have been issued after.
 *
 * Keyed on sso_subject, not the local id: the login portal knows people by
 * its own user id and has no idea what this system calls them. The guard is
 * also the security-relevant part — only an account the portal actually owns
 * can be cut this way.
 *
 * Returns false when nothing matched. That is not an error: the portal may
 * report a logout for someone who was never linked here, and "no session to
 * cut" is already the state the caller wanted.
 */
export async function invalidateSessionsForSsoSubject(subject: string): Promise<boolean> {
  if (!subject) {
    return false;
  }
  const updated = await db
    .update(users)
    .set({ sessionsValidFrom: new Date(), updatedAt: new Date() })
    .where(and(eq(users.ssoSubject, subject), eq(users.isDeleted, false)))
    .returning({ id: users.id });
  return updated.length > 0;
}

/**
 * 포털이 보내온 사람의 계정을 처음 만든다 (자동 프로비저닝).
 *
 * 만들 값의 판정은 auth/sso-provision.ts가 한다. 여기는 그 결과를 쓰기만
 * 하되, **주워가지 않는다**는 규칙만은 데이터베이스 앞에서 한 번 더 지킨다.
 *
 * 이메일이 이미 쓰이고 있으면 만들지 않고 EMAIL_TAKEN을 돌려준다. 삭제된
 * 행까지 함께 보는 이유는 users_email_unique 에 조건이 없어서다 — 소프트
 * 삭제된 행도 그 이메일 자리를 계속 차지한다. 못 본 척하면 insert가
 * 색인 충돌로 터진다.
 *
 * approval_status를 APPROVED로 두는 것은 scripts/link-sso-subject.ts의
 * --create와 같은 판단이다: 포털에서 이미 승인받은 사람을 여기서 또
 * 기다리게 하면 승인이 두 겹이 된다.
 */
export type SsoProvisionResult =
  | { outcome: "CREATED"; user: UserRow }
  /** 그 이메일을 쓰는 계정이 이미 있다. 사람이 sso:link로 명시적으로 이어야 한다. */
  | { outcome: "EMAIL_TAKEN" }
  /** 유일 색인 충돌 — 같은 사람이 동시에 처음 로그인한 경우다. 다시 읽으면 된다. */
  | { outcome: "CONFLICT" };

export async function provisionSsoUser(params: {
  subject: string;
  email: string;
  name: string;
  role: Role;
}): Promise<SsoProvisionResult> {
  const email = params.email.trim().toLowerCase();

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (taken) {
    return { outcome: "EMAIL_TAKEN" };
  }

  try {
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: params.name,
        role: params.role,
        ssoSubject: params.subject,
        ssoLinkedAt: new Date(),
        approvalStatus: "APPROVED",
        isActive: true,
      })
      .returning(SELECT_COLUMNS);
    return created
      ? { outcome: "CREATED", user: created }
      : { outcome: "CONFLICT" };
  } catch {
    // 위 사전 확인과 insert 사이에 다른 요청이 끼어든 경우다. 부르는 쪽이
    // subject로 다시 읽으면 그 행을 찾는다.
    return { outcome: "CONFLICT" };
  }
}

/**
 * 삭제 여부를 가리지 않고 subject로 찾는다.
 *
 * getUserBySsoSubject는 삭제된 행을 걸러내므로, 그것만 보고 "없으니 만들자"로
 * 가면 users_sso_subject_unique(부분 유일, sso_subject is not null)에 걸려
 * 터진다. 더 나쁜 것은 내보낸 사람이 새 계정으로 조용히 돌아오는 것이다.
 */
export async function ssoSubjectIsTaken(subject: string): Promise<boolean> {
  if (!subject) return false;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.ssoSubject, subject))
    .limit(1);
  return row !== undefined;
}

/**
 * 삭제된 계정을 포털 로그인으로 되살린다 — auth/sso-login.ts 만 부른다.
 *
 * 사용자 결정(2026-09-13): 이 시스템의 삭제는 「목록에서 치우고 일을 넘기는 것」이고,
 * 진짜 차단은 포털 권한 회수다. 그래서 포털이 본인임을 확인한 사람(같은 sso_subject)이
 * 다시 들어오면 **같은 계정**이 되살아난다. 이메일 로그인(getUserForLoginByEmail)으로는
 * 되살리지 않는다.
 *
 * 되살리는 것은 삭제 네 칸뿐이다(updated_at · version 은 올린다).
 * 🔴 이메일과 sso_subject 는 건드리지 않는다 — users_email_unique 와
 * users_sso_subject_unique 는 삭제된 행까지 포함하므로, 여기서 바꾸거나 비우면 다음
 * 포털 로그인이 이 행을 찾지 못하고 새 계정을 조용히 만들 수 있다. 대표 · 위임 ·
 * 개발자 표시도 건드리지 않는다(삭제할 때 끄는 것은 삭제 쪽의 몫이다).
 *
 * 한 트랜잭션에서 행 잠금 → 조건부 갱신 → 감사 순서다(mutations/customers-trash.ts 와
 * 같은 규율). 같은 사람이 두 탭에서 동시에 로그인하면 둘째는 첫째의 커밋을 기다렸다가
 * `is_deleted = true` 조건에서 빠져 null 을 받는다 — RESTORE 감사는 한 번만 남는다.
 * 부르는 쪽은 null 이면 getUserBySsoSubject 로 다시 읽는다.
 *
 * 감사 로그의 행위자는 되살아난 본인이다(포털 로그인이 곧 그 사람의 행동이다).
 * 이메일 · 전화 · 이름은 싣지 않는다 — 개인정보다(customers-trash.ts 헤더와 같은 규칙).
 *
 * 되살릴 행이 없으면 null.
 */
export async function restoreDeletedSsoUser(subject: string): Promise<UserRow | null> {
  if (!subject) {
    return null;
  }
  return db.transaction(async (tx): Promise<UserRow | null> => {
    const [current] = await tx
      .select({
        id: users.id,
        deletedAt: users.deletedAt,
        deletedBy: users.deletedBy,
        deleteReason: users.deleteReason,
      })
      .from(users)
      .where(and(eq(users.ssoSubject, subject), eq(users.isDeleted, true)))
      .for("update");
    if (!current) {
      return null;
    }

    const [restored] = await tx
      .update(users)
      .set({
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
        updatedAt: new Date(),
        version: sql`${users.version} + 1`,
      })
      .where(and(eq(users.id, current.id), eq(users.isDeleted, true)))
      .returning(SELECT_COLUMNS);
    if (!restored) {
      // 행을 잠그고 있어 실제로는 닿지 않는 가지다. 0행 쓰기를 성공으로 넘기지 않는다.
      return null;
    }

    await insertAuditLog(tx, {
      actorUserId: restored.id,
      actionType: "RESTORE",
      targetEntity: "users",
      targetRecordId: restored.id,
      previousValue: {
        isDeleted: true,
        deletedAt: current.deletedAt ? current.deletedAt.toISOString() : null,
        deletedBy: current.deletedBy,
        deleteReason: current.deleteReason,
      },
      newValue: { isDeleted: false, via: "SSO_LOGIN" },
    });

    return restored;
  });
}
