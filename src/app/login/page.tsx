import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mockUsers } from "@/lib/domain/mock-data";
import { roleLabels } from "@/lib/domain/types";
import { getAuthSource } from "@/lib/config/auth-source";
import { listUsersForLoginPicker } from "@/lib/db/queries/users";
import { getLoginViewModel } from "./login-view-model";

export const metadata: Metadata = {
  title: "로그인 | DSS A/S 관리 시스템",
};

export default async function LoginPage() {
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

  const demoLoginEnabled = process.env.DEMO_LOGIN_ENABLED === "true";
  const authSource = getAuthSource();
  const dbUsers =
    demoLoginEnabled && authSource === "database" ? await listUsersForLoginPicker() : null;
  const viewModel = getLoginViewModel(authSource);

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

      {!demoLoginEnabled ? (
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
