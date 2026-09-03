import { decideSsoRole } from "./sso-role";
import type { Role } from "@/lib/domain/types";

/**
 * 포털이 보내온 사람의 계정을 이 시스템에 **자동으로 만들어도 되는가**,
 * 만든다면 어떤 값으로.
 *
 * ── 왜 생겼나 ────────────────────────────────────────────────────────
 * 예전에는 포털에서 권한을 주어도 이 시스템에 계정이 없으면
 * `not_provisioned`로 막혔고, 관리자가 `npm run sso:link`를 손으로 돌려야
 * 했다. 사람이 늘 때마다 두 곳을 맞춰야 하고, 한쪽을 잊으면 그 사람은
 * "로그인은 되는데 못 들어가는" 상태가 된다.
 *
 * ── 그런데 왜 예전에는 막아 두었나 ──────────────────────────────────
 * sso-login.ts에 적힌 그대로다. 위험한 것은 **이메일로 기존 계정을 주워가는
 * 것**이었다. 포털의 이메일은 포털 관리자가 손으로 적는 값이고 검증되지
 * 않는다. 이메일이 같으면 잇는 방식이었다면, 포털 관리자가 누군가의
 * 이메일을 이 시스템 최고관리자의 주소로 적어 넣는 것만으로 그 계정을
 * 차지할 수 있었다.
 *
 * ── 그래서 둘을 갈랐다 ──────────────────────────────────────────────
 * **새로 만드는 것**과 **있는 것을 주워가는 것**은 다른 일이다.
 *
 *   - 잇는 열쇠는 여전히 sso_subject 하나뿐이다. 이메일로는 절대 잇지
 *     않는다 — 위 공격은 그대로 막혀 있다.
 *   - 그 이메일을 이미 쓰는 계정이 있으면 **만들지 않고 거절**한다.
 *     주워가지 않는다. 그 경우는 사람이 sso:link로 명시적으로 잇는다.
 *   - 즉 자동 생성은 "이 시스템이 전혀 모르는 사람"에게만 일어난다.
 *
 * 늘어난 권한은 하나뿐이다: 포털 관리자가 이 시스템에 **없던 사람의**
 * 계정을 만들 수 있게 되었다. 역할을 정하는 권한은 원래부터 포털에 있었다
 * (sso-role.ts — 포털이 보낸 역할이 매 로그인마다 기존 역할을 덮어쓴다).
 *
 * ── 역할이 없으면 만들지 않는다 ─────────────────────────────────────
 * 기존 계정에서 역할 클레임이 없는 것은 KEEP(그대로 두기)이지만, 새
 * 계정에는 지킬 값이 없다. 이 시스템의 역할은 전부 실질적인 쓰기 권한을
 * 가지므로 "가장 낮은 역할"로 임의 생성하지 않는다. 포털에서 역할을
 * 지정하게 하고, 그때까지는 거절한다 — 막히는 쪽으로 실패한다.
 *
 * server-only를 붙이지 않는다: 순수 판정이라 테스트가 직접 부른다.
 */
export type SsoProvisionPlan =
  /** 만들어도 된다. 이 값으로 만든다. */
  | { kind: "CREATE"; email: string; name: string; role: Role }
  /** 만들 수 없다. 사람이 손을 대야 한다. */
  | {
      kind: "REFUSE";
      code: "ROLE_MISSING" | "ROLE_UNKNOWN" | "EMAIL_MISSING";
      received?: string;
    };

/** 저장은 소문자로 통일한다(link-sso-subject.ts·sso-profile.ts와 같은 규칙). */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 이름이 안 왔을 때 이메일 앞부분을 쓴다.
 *
 * 빈 이름으로 만들면 사용자 관리 화면에 이름 없는 줄이 생기고, 그게 누구인지
 * 아무도 모른다. 이메일 앞부분은 완벽하진 않아도 사람이 알아볼 단서는 된다.
 * 포털에서 이름을 채우면 다음 로그인에 그 값으로 덮어써진다(sso-profile.ts).
 */
function fallbackName(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local === "" ? email : local;
}

export function planSsoProvision(claims: {
  role?: unknown;
  email?: unknown;
  name?: unknown;
}): SsoProvisionPlan {
  const roleDecision = decideSsoRole(claims.role);

  if (roleDecision.kind === "REJECT") {
    return { kind: "REFUSE", code: "ROLE_UNKNOWN", received: roleDecision.received };
  }
  if (roleDecision.kind === "KEEP") {
    // 클레임이 아예 없다. 기존 계정이면 그대로 두면 되지만, 새 계정에는
    // 지킬 값이 없다.
    return { kind: "REFUSE", code: "ROLE_MISSING" };
  }

  if (typeof claims.email !== "string") {
    return { kind: "REFUSE", code: "EMAIL_MISSING" };
  }
  const email = normalizeEmail(claims.email);
  // email 열은 NOT NULL이고 유일 색인이 걸려 있다. 형태만이라도 걸러 둔다 —
  // 공백이나 @ 없는 값이 들어가면 나중에 사람이 고치기 어려운 행이 남는다.
  if (email === "" || !email.includes("@") || /\s/.test(email)) {
    return { kind: "REFUSE", code: "EMAIL_MISSING" };
  }

  const claimedName = typeof claims.name === "string" ? claims.name.trim() : "";
  const name = claimedName === "" ? fallbackName(email) : claimedName;

  return { kind: "CREATE", email, name, role: roleDecision.role };
}
