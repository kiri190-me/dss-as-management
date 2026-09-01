"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { publishProcedureTemplateAction } from "@/lib/server/actions/procedure-templates";

/**
 * "게시" — 초안(DRAFT) 절차를 게시해서 A/S 접수 건의 "기술 절차 불러오기"
 * 목록에 올린다. CreateDraftVersionButton 과 같은 모양의 얇은 단추다: 판정도
 * 트랜잭션도 서버가 하고, 여기서는 부르고 결과를 보여 준다.
 *
 * 되돌리기 어려운 조작이라 확인 창을 하나 둔다. window.confirm 이 아니라
 * <dialog> 인 이유는 이 저장소의 다른 확인 창(InvalidateWorkRecordDialog)과
 * 같다 — 브라우저 기본 창은 화면 언어·모양을 맞출 수 없고, 무엇이 왜
 * 되돌릴 수 없는지 설명할 자리도 없다.
 */
export default function PublishTemplateButton({
  templateId,
  templateName,
  isReferenceOnly = false,
}: {
  templateId: string;
  templateName: string;
  /**
   * 참고용 절차는 게시해도 "기술 절차 불러오기" 목록에 오르지 않는다
   * (getExecutableTemplateOptions 가 is_reference_only 를 거른다). 게시가
   * 무의미한 것은 아니다 — 게시해야 엔지니어에게 보인다 — 그래서 단추를
   * 막는 대신 확인 창에서 무엇이 달라지는지 다르게 말해 준다.
   */
  isReferenceOnly?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  function openDialog() {
    setErrorMessage(null);
    setIsOpen(true);
  }

  function closeDialog() {
    if (isPublishing) return;
    setIsOpen(false);
  }

  async function handlePublish() {
    if (isPublishing) return;
    setIsPublishing(true);
    setErrorMessage(null);
    const result = await publishProcedureTemplateAction({ templateId });
    setIsPublishing(false);
    if (!result.ok) {
      // 서버가 준 이유를 그대로 보인다 — 권한(FORBIDDEN)인지, 해결되지 않은
      // 오류인지, 그래프 구조 오류인지가 사람에게 그대로 전해져야 한다.
      setErrorMessage(result.message);
      return;
    }
    setIsOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        게시
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="publish-template-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="publish-template-dialog-title" className="text-sm font-semibold">
          기술 절차 게시
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          &ldquo;{templateName}&rdquo; 을(를) 게시합니다.
        </p>
        {isReferenceOnly ? (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            이 절차는 <span className="font-medium">참고용</span>이라, 게시해도 A/S 접수 건의{" "}
            <span className="font-medium">[+ 기술 절차 불러오기]</span> 목록에는 나타나지 않습니다. 게시하면
            엔지니어가 이 문서를 열람할 수 있게 됩니다. 게시된 절차는 다시 초안으로 되돌릴 수 없고, 내용을 고치려면
            새 DRAFT 버전을 만들어야 합니다.
          </p>
        ) : (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            게시하면 이 절차가 A/S 접수 건의 <span className="font-medium">[+ 기술 절차 불러오기]</span> 목록에 나타나
            실제 작업에 쓰이게 됩니다. 게시된 절차는 다시 초안으로 되돌릴 수 없고, 내용을 고치려면 새 DRAFT 버전을
            만들어야 합니다.
          </p>
        )}

        {errorMessage && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            disabled={isPublishing}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handlePublish()}
            disabled={isPublishing}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {isPublishing ? "게시하는 중..." : "게시하기"}
          </button>
        </div>
      </dialog>
    </>
  );
}
