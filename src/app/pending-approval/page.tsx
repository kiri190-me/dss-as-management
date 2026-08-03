import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { mockUsers } from "@/lib/domain/mock-data";

export const metadata: Metadata = {
  title: "승인 대기 | DSS A/S 관리 시스템",
};

export default async function PendingApprovalPage() {
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }
  if (session.approvalStatus === "APPROVED") {
    redirect("/dashboard");
  }

  const user = mockUsers.find((candidate) => candidate.id === session.userId);
  const name = user?.name ?? "사용자";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        승인 대기 중입니다
      </h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {name}님, 계정이 아직 관리자 승인 대기 중입니다. 승인이 완료되면 다시
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
