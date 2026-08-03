import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { mockUsers } from "@/lib/domain/mock-data";
import { roleLabels } from "@/lib/domain/types";

export const metadata: Metadata = {
  title: "로그인 | DSS A/S 관리 시스템",
};

export default async function LoginPage() {
  const session = await readSession();
  if (session) {
    redirect(session.approvalStatus === "APPROVED" ? "/dashboard" : "/pending-approval");
  }

  const demoLoginEnabled = process.env.DEMO_LOGIN_ENABLED === "true";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        로그인 (데모)
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        실제 인증(카카오 로그인, 회사 이메일 인증)이 도입되기 전까지 임시로
        제공되는 데모 로그인입니다.
      </p>

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
          {mockUsers.map((user) => (
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
