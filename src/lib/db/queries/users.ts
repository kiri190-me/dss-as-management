import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { users } from "../schema";
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
