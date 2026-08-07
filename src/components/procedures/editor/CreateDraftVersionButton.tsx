"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createNewDraftVersionAction } from "@/lib/server/actions/procedure-templates";

/** "새 DRAFT 버전 만들기" — from a PUBLISHED template, either on its detail page or landing on /edit directly; redirects straight into the new draft's editor on success. */
export default function CreateDraftVersionButton({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCreate() {
    setIsCreating(true);
    setErrorMessage(null);
    const result = await createNewDraftVersionAction({ templateId });
    setIsCreating(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    router.push(`/procedures/${result.id}/edit`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isCreating}
        onClick={() => void handleCreate()}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isCreating ? "생성 중..." : "새 DRAFT 버전 만들기"}
      </button>
      {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
