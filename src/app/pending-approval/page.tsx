import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";

export const metadata: Metadata = {
  title: "승인 대기 | DSS A/S 관리 시스템",
};

export default async function PendingApprovalPage() {
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  // Same fail-closed rule as (app)/layout.tsx and /login: a signed token
  // alone doesn't mean the account behind it is still usable.
  const user = await resolveActingUserForSession(session);
  if (!user) {
    redirect("/login");
  }
  if (user.approvalStatus === "APPROVED") {
    redirect("/dashboard");
  }

  return (
    // AppShell 밖의 독립 화면이라 하단 여백 보정을 여기서 따로 해준다.
    // min-h-screen(=100vh)은 모바일 하단 툴바가 펼쳐지면 그만큼 화면 밖으로
    // 넘치므로 min-h-dvh로 바꾸고, 세로 패딩에 안전 영역 인셋을 더한다.
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] text-center">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        승인 대기 중입니다
      </h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {user.name}님, 계정이 아직 관리자 승인 대기 중입니다. 승인이 완료되면 다시
        로그인해 주세요.
      </p>
      <form method="post" action="/api/auth/logout" className="mt-6">
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
