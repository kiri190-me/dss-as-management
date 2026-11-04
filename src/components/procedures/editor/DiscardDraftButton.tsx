"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { discardProcedureTemplateDraftAction } from "@/lib/server/actions/procedure-template-trash";

/**
 * "초안 버리기" — 잘못 만든 DRAFT 를 **그 자리에서** 치운다(2026-11-04, 줄기 B-⑥).
 *
 * ── 왜 이 단추가 생겼는가 ───────────────────────────────────────────────
 * 버리는 길 자체는 전부터 있었다(/procedures/technical 의 [삭제 모드] → 휴지통).
 * 없었던 것은 **잘못 눌러서 초안이 생긴 그 자리에서** 되돌리는 길이다. [새
 * DRAFT 버전 만들기]를 누르면 바로 이 편집기로 떨어지는데, 여기서 나가 목록
 * 화면으로 가 삭제 모드에 들어가 같은 이름의 여러 판 중 하나를 골라야 했다.
 *
 * ── 확인 창을 둔다 ──────────────────────────────────────────────────────
 * 편집기의 추가·수정에서 확인 창을 걷어낸 기준은 "되돌릴 수 있는가"였고
 * (procedure-editor-confirm-dialogs.test.ts), 버리기는 그 기준에서 반대쪽이다.
 * 소프트 삭제라 15일 안에는 복원할 수 있지만, 복원하는 자리가 **여기가 아니라
 * 다른 화면**이고 누르는 순간 편집기에서 쫓겨난다 — 되돌리기 한 걸음으로
 * 제자리에 오는 일이 아니다. 목록 화면의 일괄 삭제도 같은 이유로 창을 띄운다
 * (MasterDataDeleteDialog).
 *
 * window.confirm 이 아니라 <dialog> 인 까닭은 이웃 PublishTemplateButton 과 같다
 * — 브라우저 기본 창에는 "무엇이 함께 가고 어디서 되살리는지"를 적을 자리가 없다.
 */
export default function DiscardDraftButton({
  templateId,
  templateName,
  templateVersion,
}: {
  templateId: string;
  templateName: string;
  /** 창에 적는다 — 같은 이름의 판이 여럿이라, 이름만으로는 어느 것을 버리는지 알 수 없다. */
  templateVersion: number;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
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
    if (isDiscarding) return;
    setIsOpen(false);
  }

  async function handleDiscard() {
    if (isDiscarding) return;
    setIsDiscarding(true);
    setErrorMessage(null);
    const result = await discardProcedureTemplateDraftAction({ templateId });
    if (!result.ok) {
      // 서버가 준 이유를 그대로 보인다 — 권한인지, 상태(게시본)인지, 수행
      // 기록·후속 버전이 붙었는지가 사람에게 그대로 전해져야 한다. 창을 닫지
      // 않는다: 닫으면 "아무 일도 안 일어남"으로 보인다.
      setIsDiscarding(false);
      setErrorMessage(result.message);
      return;
    }
    // 🔴 성공하면 **이 화면이 없어진다**(편집하던 초안이 휴지통으로 갔다).
    //    같은 주소에 남아 router.refresh() 를 부르면 조회가 빈손으로 돌아와
    //    notFound 가 뜬다 — 사람에게는 고장으로 보인다. 그래서 목록으로
    //    보내고, replace 라 [뒤로]가 죽은 편집기로 돌아가지 않는다.
    //    isDiscarding 은 풀지 않는다 — 떠나는 동안 단추가 다시 눌리면 안 된다.
    router.replace("/procedures/technical");
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        초안 버리기
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="discard-draft-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="discard-draft-dialog-title" className="text-sm font-semibold">
          초안 버리기
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          &ldquo;{templateName}&rdquo; v{templateVersion} 초안을 버립니다.
        </p>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          노드·분기·체크리스트·참고자료·검증 기록이 초안과 함께 휴지통으로 갑니다. 15일 안에는{" "}
          <span className="font-medium">[기술 작업 절차] → [휴지통]</span>에서 되살릴 수 있고, 그 뒤에는 자동으로
          완전히 삭제됩니다. <span className="font-medium">게시된 판은 그대로 남습니다.</span>
        </p>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          버린 판 번호(v{templateVersion})는 돌아오지 않습니다 — 다시 새 초안을 만들면 다음 번호가 붙습니다.
        </p>

        {errorMessage && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            disabled={isDiscarding}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleDiscard()}
            disabled={isDiscarding}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isDiscarding ? "버리는 중..." : "초안 버리기"}
          </button>
        </div>
      </dialog>
    </>
  );
}
