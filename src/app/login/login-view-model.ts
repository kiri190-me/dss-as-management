import type { AuthSource } from "@/lib/config/auth-source";
import type { LoginMode } from "@/lib/config/login-mode";

/**
 * Pure derivation of /login's mode-dependent copy — split out from the page
 * itself (a Server Component using next/headers cookies(), which can't be
 * unit-tested outside a real Next.js request) so the actual text/labels
 * driving "is this database mode or mock mode" visibility can be tested
 * directly. The page only interpolates these values; it owns no branching
 * logic of its own beyond this.
 */
export type LoginViewModel = {
  heading: string;
  description: string;
  sourceBadgeLabel: string;
};

const DATABASE_VIEW_MODEL: LoginViewModel = {
  heading: "로그인 (DB)",
  description:
    "PostgreSQL 데이터베이스에 저장된 실제 계정 목록에서 로그인할 사용자를 선택합니다. " +
    "비밀번호 인증(카카오 로그인, 회사 이메일 인증)이 도입되기 전까지 임시로 제공되는 절차입니다.",
  sourceBadgeLabel: "DB 사용자",
};

const MOCK_VIEW_MODEL: LoginViewModel = {
  heading: "로그인 (데모)",
  description: "실제 인증(카카오 로그인, 회사 이메일 인증)이 도입되기 전까지 임시로 제공되는 데모 로그인입니다.",
  sourceBadgeLabel: "데모 사용자",
};

const SSO_VIEW_MODEL: LoginViewModel = {
  heading: "로그인",
  description:
    "DSS 통합 로그인으로 접속합니다. 이 시스템은 계정과 비밀번호를 따로 두지 않습니다.",
  sourceBadgeLabel: "통합 로그인",
};

/**
 * `loginMode` is optional and defaults to "demo" so every existing caller
 * and test keeps its exact behavior — SSO is opt-in, and nothing changes
 * until LOGIN_MODE is set.
 *
 * SSO takes precedence over authSource because in SSO mode the account
 * source is no longer visible to the user: they never pick an account, so
 * a "DB 사용자" / "데모 사용자" badge would describe an interaction that is
 * not on screen.
 */
export function getLoginViewModel(
  authSource: AuthSource,
  loginMode: LoginMode = "demo"
): LoginViewModel {
  if (loginMode === "sso") {
    return SSO_VIEW_MODEL;
  }
  return authSource === "database" ? DATABASE_VIEW_MODEL : MOCK_VIEW_MODEL;
}
