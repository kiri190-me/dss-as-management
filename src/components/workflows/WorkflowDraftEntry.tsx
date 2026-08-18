"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createWorkflowDraftAction } from "@/lib/server/actions/workflow-drafts";

/**
 * 워크플로 상세 화면의 편집 진입점. 초안이 이미 있으면 "이어서 편집" 링크만
 * 보여 준다 — 템플릿당 초안은 하나이며, 두 번째 만들기를 눌러 봐야 서버가
 * 거부하기 때문이다(누를 수 있게 두면 실패 메시지로만 알게 된다).
 */
export default function WorkflowDraftEntry({
  templateCode,
  hasDraft,
  draftVersionNumber,
  canCreate,
}: {
  templateCode: string;
  hasDraft: boolean;
  draftVersionNumber: number | null;
  /** 복제할 현재 발행본이 있는가. 없으면 초안을 만들 수 없다(빈 초안은 발행 불가). */
  canCreate: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (hasDraft) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href={`/workflows/${templateCode}/draft`}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          초안 이어서 편집 (v{draftVersionNumber})
        </Link>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">발행 전까지 접수 건에 영향이 없습니다.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending || !canCreate}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await createWorkflowDraftAction(templateCode);
              if (!result.ok) {
                setError(result.message);
                return;
              }
              router.push(`/workflows/${templateCode}/draft`);
            });
          }}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          {isPending ? "만드는 중..." : "새 초안 만들기"}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {canCreate
            ? "현재 발행본을 복제해 시작합니다."
            : "복제할 현재 발행본이 없어 초안을 만들 수 없습니다."}
        </span>
      </div>
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
