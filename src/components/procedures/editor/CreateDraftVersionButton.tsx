"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createNewDraftVersionAction } from "@/lib/server/actions/procedure-templates";

/**
 * "새 DRAFT 버전 만들기" — 게시된(PUBLISHED) 절차에서, 상세 화면이나 /edit 에
 * 바로 들어왔을 때. 성공하면 새 초안의 편집기로 곧장 간다.
 *
 * ── 확인 창을 두지 않는다 (2026-11-04, 줄기 B-⑥) ────────────────────────
 * 이 편집기 계열의 기준은 "되돌릴 수 있는가" 하나다
 * (procedure-editor-confirm-dialogs.test.ts ③절: 게시는 다시 초안으로 못
 * 돌리니 창을 남기고, 추가·수정은 되돌릴 수 있으니 뺐다).
 *
 * 이웃 PublishTemplateButton 은 그 기준의 반대쪽이라 <dialog> 확인 창을 띄운다.
 * 새 초안 만들기는 **되돌릴 수 있는 쪽**이다:
 *  - 부모(게시된 판)는 한 글자도 바뀌지 않는다. 새 행이 하나 생길 뿐이다.
 *  - 잘못 눌렀으면 그 초안을 치울 수 있다.
 *
 * ── 🔴 안내 글을 걷었다 (2026-11-04, 사용자 요청) ───────────────────────
 * 단추 아래에 회색 안내가 한 줄 있었다 — "게시된 판은 그대로 두고 새 초안을
 * 하나 만듭니다. 잘못 눌렀으면 편집기의 [초안 버리기]로 치울 수 있습니다."
 * 사용자가 "[새 DRAFT 버전 만들기] 아래에 있는 설명들을 없애줘" 라고 해서 걷었다.
 *
 * 🔴 **확인 창을 안 두는 근거는 그대로다.** 그 글이 근거의 전부였던 때가 있었다
 * ("되돌리는 길을 누르기 전에 말해 준다"). 지금은 글이 없어도 성립한다 —
 * 되돌리는 길이 **화면에 둘**이다:
 *   ① 편집기의 [초안 버리기](떨어지는 바로 그 화면에 있다)
 *   ② [절차 상세] > [버전 목록]의 [삭제](2026-11-04에 생겼다)
 * 🔴 그러니 **확인 창을 도로 넣지 마라.** "설명도 창도 없네"로 읽고 창을 더하면
 * 이 계열의 기준("되돌릴 수 있으면 묻지 않는다")이 한 자리에서만 깨진다.
 *
 * 🟢 **함께 걷지 않은 둘**: 막혔을 때의 빨간 까닭과 파란 링크다. 그 둘은 설명이
 * 아니라 **왜 안 됐는지**와 **그때 갈 곳**이고, 평소에는 아예 안 뜬다. 함께
 * 걷으면 눌러도 아무 일이 없는 화면이 된다.
 *
 * 🔵 되돌릴 수 있다고 해서 흔적이 없는 것은 아니다 — 버린 판 번호는 돌아오지
 * 않고 휴지통에 15일 남는다. 그 둘은 [초안 버리기]·[삭제] 창이 적는다.
 */
export default function CreateDraftVersionButton({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /**
   * 🔴 막혔을 때 **갈 곳**. 서버가 "이미 진행 중인 초안 버전이 있습니다"로
   * 막으면서 그 초안의 id 를 함께 준다. 까닭만 적고 길을 안 주면, 사람은 같은
   * 이름의 판이 여럿인 목록에서 그 초안을 손으로 찾아야 한다.
   */
  const [existingDraftId, setExistingDraftId] = useState<string | null>(null);

  async function handleCreate() {
    setIsCreating(true);
    setErrorMessage(null);
    setExistingDraftId(null);
    const result = await createNewDraftVersionAction({ templateId });
    setIsCreating(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      setExistingDraftId(result.existingDraftId ?? null);
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
        className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900"
      >
        {isCreating ? "생성 중..." : "새 DRAFT 버전 만들기"}
      </button>
      {/* 🟢 아래 둘은 **상황이 생겼을 때만** 뜬다 — 걷어낸 안내 글과 다르다
          (파일 머리말). 빨간 줄이 없으면 막힌 것이 "아무 일도 안 일어남"으로
          보이고, 파란 링크가 없으면 같은 이름의 판이 여럿인 목록에서 그 초안을
          손으로 찾아야 한다. */}
      {errorMessage && (
        <p className="max-w-[16rem] text-right text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
      )}
      {existingDraftId && (
        <Link
          href={`/procedures/${existingDraftId}/edit`}
          className="text-xs font-medium text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
        >
          진행 중인 초안 편집기로 이동 →
        </Link>
      )}
    </div>
  );
}
