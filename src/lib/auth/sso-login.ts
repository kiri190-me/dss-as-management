import "server-only";
import {
  applySsoIdentity,
  getUserBySsoSubject,
  provisionSsoUser,
  ssoSubjectIsTaken,
  type UserRow,
} from "@/lib/db/queries/users";
import type { Role } from "@/lib/domain/types";
import type { DbLoginResult } from "./db-login";
import { decideSsoProfile } from "./sso-profile";
import { planSsoProvision } from "./sso-provision";
import { decideSsoRole } from "./sso-role";

export type SsoLoginResultCode =
  | "NOT_PROVISIONED"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "DATABASE_UNAVAILABLE"
  /** The portal sent a role this system does not recognize — see sso-role.ts. */
  | "UNKNOWN_ROLE"
  /** New account, but the portal grant carries no role. See sso-provision.ts. */
  | "PORTAL_ROLE_MISSING"
  /** New account, but the portal sent no usable email. See sso-provision.ts. */
  | "PORTAL_EMAIL_MISSING"
  /** A local account already holds that email. Never adopted — linked by hand. */
  | "EMAIL_TAKEN";

/**
 * Reuses db-login.ts's SESSION shape verbatim so the login route can hand
 * either result to the same downstream code (createSessionToken, cookie,
 * destination). Only the rejection codes differ.
 */
export type SsoLoginResult =
  | Extract<DbLoginResult, { outcome: "SESSION" }>
  | { outcome: "REJECTED"; code: SsoLoginResultCode };

/**
 * SSO login resolution: a verified DSS subject to a local account and a
 * session, or a rejection.
 *
 * **Creates an account when this system has never seen the person, and
 * still never adopts an existing one by email.** That distinction is the
 * whole design, and sso-provision.ts carries the long form:
 *
 *  - Creating is safe. The link key is the portal's own `sub`, so a
 *    brand-new row cannot be somebody else's account.
 *  - Adopting by email is not. The email in the ID token is typed in by a
 *    dss-auth portal admin, is unverified, and Kakao never supplied it.
 *    Honouring it would let a portal admin set someone's email to this
 *    system's SUPER_ADMIN address and inherit that account on first login.
 *    So an email already in use here refuses the login (EMAIL_TAKEN) and
 *    waits for a human to link it, via scripts/link-sso-subject.ts.
 *
 * Roles were already the portal's to decide: sso-role.ts applies its claim
 * over the stored role on every login. Provisioning does not widen that. It
 * only removes the step where a person had to be created here first.
 *
 * A caller must have verified the ID token's signature, issuer, audience,
 * expiry, and nonce before calling this. The subject is trusted here.
 */
export async function resolveSsoLogin(
  subject: string,
  /**
   * The ID token's claims, verbatim and unvalidated. Typed unknown on
   * purpose: they arrive from a JWT payload, and the only places allowed to
   * decide what they mean are decideSsoRole, decideSsoProfile and
   * planSsoProvision.
   */
  claims: { role?: unknown; email?: unknown; name?: unknown } = {}
): Promise<SsoLoginResult> {
  if (!subject) {
    return { outcome: "REJECTED", code: "NOT_PROVISIONED" };
  }

  let row: UserRow | null;
  try {
    row = await getUserBySsoSubject(subject);
  } catch {
    return { outcome: "REJECTED", code: "DATABASE_UNAVAILABLE" };
  }

  if (!row) {
    // 처음 보는 사람이다. 만들 수 있으면 만들고, 만든 행을 아래 흐름에
    // **그대로 합류**시킨다 — 잠금·비활성 검사와 역할 반영을 새 계정만
    // 건너뛰는 일이 있어서는 안 된다.
    const provisioned = await provisionNewAccount(subject, claims);
    if (provisioned.kind === "REJECTED") {
      return provisioned.result;
    }
    row = provisioned.row;
  }

  if (row.lockedAt !== null) {
    return { outcome: "REJECTED", code: "ACCOUNT_LOCKED" };
  }
  if (!row.isActive) {
    return { outcome: "REJECTED", code: "ACCOUNT_DISABLED" };
  }

  // ── What the portal decided ──
  //
  // Applied before the session is built, because the session token carries
  // the role and the name: resolving them afterwards would hand out a session
  // stamped with the previous values and only take effect one login later.
  const roleDecision = decideSsoRole(claims.role);

  if (roleDecision.kind === "REJECT") {
    console.error(
      `[sso] 알 수 없는 역할이 왔습니다: ${JSON.stringify(roleDecision.received)} (subject ${subject})`
    );
    return { outcome: "REJECTED", code: "UNKNOWN_ROLE" };
  }

  const profile = decideSsoProfile(claims, { email: row.email, name: row.name });
  const patch: { role?: Role; email?: string; name?: string } = { ...profile };
  if (roleDecision.kind === "APPLY" && roleDecision.role !== row.role) {
    patch.role = roleDecision.role;
  }

  let applied = { role: row.role, name: row.name };
  if (patch.role !== undefined || patch.email !== undefined || patch.name !== undefined) {
    try {
      if (await applySsoIdentity(subject, row.id, patch)) {
        // Deliberately visible. A role change grants real permissions here,
        // and a name/email change is what the user management screen shows.
        console.info(`[sso] 포털 값을 반영합니다: ${row.name} ${JSON.stringify(patch)}`);
        applied = {
          role: patch.role ?? row.role,
          name: patch.name ?? row.name,
        };
      }
      // false means the row stopped matching between the read and the write
      // (deleted or unlinked mid-login). Falling through with what we read is
      // right: never report values the database does not hold.
    } catch (error) {
      // The likely cause is the unique index on email — the portal handed us
      // an address another local account already uses. That is a
      // configuration mistake, not a reason to lock someone out of the
      // system, so the login continues with the values already stored.
      console.error(
        `[sso] 포털 값을 반영하지 못했습니다(기존 값으로 계속합니다): ${JSON.stringify(patch)}`,
        error
      );
      if (patch.role !== undefined) {
        // Role is the half that matters for permissions — retry it alone, in
        // case only the email collided.
        try {
          if (await applySsoIdentity(subject, row.id, { role: patch.role })) {
            applied = { role: patch.role, name: row.name };
          }
        } catch {
          return { outcome: "REJECTED", code: "DATABASE_UNAVAILABLE" };
        }
      }
    }
  }

  // ACCOUNT_PENDING is deliberately not a rejection, matching db-login.ts: a
  // pending account still gets a session and is routed to /pending-approval
  // by the caller based on approvalStatus.
  return {
    outcome: "SESSION",
    user: {
      id: row.id,
      role: applied.role,
      approvalStatus: row.approvalStatus,
      name: applied.name,
    },
  };
}

type ProvisionOutcome =
  | { kind: "ROW"; row: UserRow }
  | { kind: "REJECTED"; result: SsoLoginResult };

/**
 * 이 시스템이 처음 보는 사람의 계정을 만든다.
 *
 * 무엇으로 만들지는 sso-provision.ts가 정하고(순수 판정이라 테스트로
 * 고정했다), "이미 있는 것을 주워가지 않는다"는 규칙은 queries/users.ts가
 * 데이터베이스 앞에서 한 번 더 지킨다. 여기는 그 둘을 잇고, 거절 사유를
 * 사람이 읽을 수 있게 로그에 남긴다.
 */
async function provisionNewAccount(
  subject: string,
  claims: { role?: unknown; email?: unknown; name?: unknown }
): Promise<ProvisionOutcome> {
  const reject = (code: SsoLoginResultCode): ProvisionOutcome => ({
    kind: "REJECTED",
    result: { outcome: "REJECTED", code },
  });

  // 삭제되었거나 비활성인 계정이 이미 이 subject를 들고 있을 수 있다.
  // getUserBySsoSubject는 삭제된 행을 걸러내므로 여기서 따로 본다. 못 본 척
  // 만들면 부분 유일 색인에 걸려 터지고, 더 나쁘게는 내보낸 사람이 새
  // 계정으로 조용히 돌아온다.
  try {
    if (await ssoSubjectIsTaken(subject)) {
      console.warn(`[sso] 이미 이 subject를 쓰는 계정이 있습니다(삭제·비활성): ${subject}`);
      return reject("ACCOUNT_DISABLED");
    }
  } catch {
    return reject("DATABASE_UNAVAILABLE");
  }

  const plan = planSsoProvision(claims);
  if (plan.kind === "REFUSE") {
    if (plan.code === "ROLE_UNKNOWN") {
      console.error(
        `[sso] 알 수 없는 역할이 왔습니다: ${JSON.stringify(plan.received)} (subject ${subject})`
      );
      return reject("UNKNOWN_ROLE");
    }
    if (plan.code === "ROLE_MISSING") {
      console.warn(
        `[sso] 포털이 역할을 지정하지 않아 계정을 만들지 않았습니다 (subject ${subject}). ` +
          "포털에서: npm run client:grant -- --client rf-service-system --user <이메일> --role <역할> --by <관리자>"
      );
      return reject("PORTAL_ROLE_MISSING");
    }
    console.warn(
      `[sso] 포털이 쓸 수 있는 이메일을 보내지 않아 계정을 만들지 않았습니다 (subject ${subject}).`
    );
    return reject("PORTAL_EMAIL_MISSING");
  }

  let result;
  try {
    result = await provisionSsoUser({
      subject,
      email: plan.email,
      name: plan.name,
      role: plan.role,
    });
  } catch {
    return reject("DATABASE_UNAVAILABLE");
  }

  if (result.outcome === "EMAIL_TAKEN") {
    // 예전 설계가 지키려던 바로 그 자리다. 주워가지 않고 멈춘다.
    console.warn(
      `[sso] "${plan.email}" 을(를) 쓰는 계정이 이미 있어 자동으로 잇지 않았습니다. ` +
        `사람이 확인한 뒤 이으세요: npm run sso:link -- --email ${plan.email} --subject ${subject}`
    );
    return reject("EMAIL_TAKEN");
  }

  if (result.outcome === "CONFLICT") {
    // 같은 사람이 두 탭에서 동시에 처음 로그인한 경우다. 이제는 행이 있다.
    try {
      const row = await getUserBySsoSubject(subject);
      if (row) return { kind: "ROW", row };
    } catch {
      return reject("DATABASE_UNAVAILABLE");
    }
    return reject("NOT_PROVISIONED");
  }

  console.info(
    `[sso] 계정을 자동으로 만들었습니다: ${result.user.name} <${result.user.email}> · ${result.user.role}`
  );
  return { kind: "ROW", row: result.user };
}
