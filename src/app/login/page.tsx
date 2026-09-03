import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mockUsers } from "@/lib/domain/mock-data";
import { roleLabels } from "@/lib/domain/types";
import { getAuthSource } from "@/lib/config/auth-source";
import { isDemoLoginEnabled } from "@/lib/config/demo-login";
import { getLoginMode } from "@/lib/config/login-mode";
import { listUsersForLoginPicker } from "@/lib/db/queries/users";
import { getLoginViewModel } from "./login-view-model";

export const metadata: Metadata = {
  title: "로그인 | DSS A/S 관리 시스템",
};

/**
 * SSO 실패 사유별 안내. 내부 사정은 담지 않는다 — 어느 쪽이 잘못됐는지를
 * 자세히 알려주면 이 화면이 "누가 이 시스템 사용자인지"를 확인해 주는
 * 조회 도구가 된다. 예외는 사용자에게 "관리자에게 문의"라는 **다음 행동이
 * 실제로 있는** 사유들뿐이고, 아래 다섯이 그것이다.
 *
 * 계정은 이제 첫 로그인에 자동으로 만들어진다(auth/sso-provision.ts).
 * 그래서 not_provisioned는 거의 뜨지 않고, 대신 자동 생성이 막힌 이유가
 * 따로 나온다 — 셋 다 포털 설정을 고치면 풀린다.
 */
const SSO_ERROR_MESSAGES: Record<string, string> = {
  sso: "통합 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  state: "로그인 요청을 확인할 수 없습니다. 다시 시도해 주세요.",
  expired: "로그인 시간이 초과되었습니다. 다시 시도해 주세요.",
  not_provisioned:
    "통합 로그인은 되었지만 이 시스템에 사용할 계정이 연결되어 있지 않습니다. 관리자에게 문의하세요.",
  unknown_role:
    "통합 로그인에 지정된 역할을 이 시스템이 알지 못합니다. 관리자에게 문의하세요.",
  portal_role_missing:
    "통합 로그인에 이 시스템에서 쓸 역할이 지정되어 있지 않아 계정을 만들지 못했습니다. 관리자에게 문의하세요.",
  portal_email_missing:
    "통합 로그인에 이메일이 없어 이 시스템의 계정을 만들지 못했습니다. 관리자에게 문의하세요.",
  email_taken:
    "이 이메일로 만들어진 계정이 이미 있어 자동으로 연결하지 않았습니다. 관리자에게 문의하세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await readSession();
  if (session) {
    // A structurally valid token alone must not hide the login screen — it
    // must still resolve to a real, currently-usable account (same check
    // (app)/layout.tsx applies) before treating this browser as logged in.
    // Otherwise a stale cookie (deleted/deactivated/locked account, or an
    // AUTH_SOURCE switch since the cookie was issued) would permanently
    // block access to /login with no way to sign in as anyone else.
    const user = await resolveActingUserForSession(session);
    if (user) {
      redirect(user.approvalStatus === "APPROVED" ? "/dashboard" : "/pending-approval");
    }
  }

  const loginMode = getLoginMode();
  const ssoMode = loginMode === "sso";
  const { error } = await searchParams;

  // SSO 모드에서 이 화면이 할 수 있는 일은 버튼 하나뿐이다 — 그 버튼을
  // 사람이 누르게 하는 대신 곧바로 통합 로그인으로 보낸다. 포털에 이미
  // 로그인해 있다면 아무 화면도 보이지 않고 바로 들어오고, 아니면 포털의
  // 로그인 화면이 뜬다. 어느 쪽이든 "통합 로그인으로 계속"이라고 적힌 문을
  // 한 번 더 여는 일은 없다.
  //
  // ⚠️ 오류가 실려 왔을 때는 절대 자동으로 보내지 않는다. 연결되지 않은
  // 계정(not_provisioned)처럼 다시 시도해도 같은 결과인 오류가 대부분이라,
  // 자동 전송은 사람이 이유를 읽을 기회를 빼앗고 왕복만 반복시킨다.
  if (ssoMode && !error) {
    redirect("/api/auth/sso/start");
  }

  const demoLoginEnabled = isDemoLoginEnabled();
  const authSource = getAuthSource();
  // In SSO mode nobody picks an account, so the picker query is skipped
  // entirely rather than fetched and hidden.
  const dbUsers =
    !ssoMode && demoLoginEnabled && authSource === "database"
      ? await listUsersForLoginPicker()
      : null;
  const viewModel = getLoginViewModel(authSource, loginMode);
  const ssoError = ssoMode && error ? (SSO_ERROR_MESSAGES[error] ?? SSO_ERROR_MESSAGES.sso) : null;

  return (
    // AppShell 밖의 독립 화면이라 하단 여백 보정을 여기서 따로 해준다.
    // min-h-screen(=100vh)은 모바일 하단 툴바가 펼쳐지면 그만큼 화면 밖으로
    // 넘치므로 min-h-dvh로 바꾸고, 세로 패딩에 안전 영역 인셋을 더한다.
    // 계정 목록이 길어 화면보다 커지는 폰에서는 기존과 동일하게 문서 전체가
    // 스크롤된다(justify-center는 그대로 두었다).
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {viewModel.heading}
        </h1>
        <span
          className={
            authSource === "database"
              ? "inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              : "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }
        >
          {viewModel.sourceBadgeLabel}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{viewModel.description}</p>

      {ssoError ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {ssoError}
        </p>
      ) : null}

      {ssoMode ? (
        // 평범한 링크(GET)다. 로그인 시작은 아무것도 바꾸지 않으므로 폼이
        // 필요 없고, 폼이 없으면 CSRF 토큰도 필요 없다. 실제 방어는 왕복에
        // 실리는 state가 한다.
        <a
          href="/api/auth/sso/start"
          className="mt-6 flex items-center justify-center rounded-md bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          DSS 통합 로그인으로 계속
        </a>
      ) : !demoLoginEnabled ? (
        <p className="mt-6 rounded-md border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          데모 로그인이 비활성화되어 있습니다. 관리자에게 문의하세요.
        </p>
      ) : (
        <form
          method="post"
          action="/api/auth/login"
          className="mt-6 flex flex-col gap-2"
        >
          {dbUsers
            ? dbUsers.map((user) => (
                <label
                  key={user.email}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  <input type="radio" name="email" value={user.email} required />
                  <span className="flex flex-col">
                    <span>
                      {user.name} ({roleLabels[user.role]})
                      {user.approvalStatus === "PENDING" ? " · 승인 대기" : ""}
                    </span>
                    {/* Email only — user.id (a real users.id UUID) is deliberately
                        never used anywhere on this page, not even as a React key:
                        Next.js's RSC hydration payload serializes key values into
                        the page's HTML, so a UUID key would leak into the response
                        even though it's never rendered as visible text. email is
                        already unique (users_email_unique) and already the radio's
                        value, so it's a safe, already-public key. No session/token
                        data reaches this page either way. */}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{user.email}</span>
                  </span>
                </label>
              ))
            : mockUsers.map((user) => (
                <label
                  key={user.id}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  <input type="radio" name="userId" value={user.id} required />
                  <span>
                    {user.name} ({roleLabels[user.role]})
                    {user.approvalStatus === "PENDING" ? " · 승인 대기" : ""}
                  </span>
                </label>
              ))}
          <button
            type="submit"
            className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            로그인
          </button>
        </form>
      )}
    </div>
  );
}
