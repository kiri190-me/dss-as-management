"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteProcedureTemplateVersionAction } from "@/lib/server/actions/procedure-template-trash";
import { procedureTemplateStatusLabels, type ProcedureTemplateStatus } from "@/lib/domain/procedure-template-types";

/**
 * [절차 상세] > [버전 목록]의 **[삭제]** (2026-11-04 사용자 요청).
 *
 * ── 이웃 [초안 버리기]와 무엇이 같고 무엇이 다른가 ──────────────────────
 * 같은 것: 확인 창을 둔다는 것, 그 까닭, 창에 적는 내용(소프트 삭제·15일·
 * 되살리는 자리가 다른 화면), 서버 실패 이유를 그 자리에 보인다는 것.
 * DiscardDraftButton 의 머리말이 그 까닭을 다 적고 있다.
 *
 * 다른 것 둘:
 *  1. **만료본도 받는다.** 초안만이 아니다(어느 상태가 지워지는지는
 *     domain/procedure-version-deletion.ts 한 곳이 정하고, 서버 액션이 그 상수를
 *     그대로 mutation 에 넘긴다).
 *  2. 🔴 **지운 뒤 갈 곳이 두 갈래다.** [초안 버리기]는 언제나 지금 편집 중인
 *     초안을 지우므로 늘 화면이 없어졌다. 여기서는 **남의 판**도 지울 수 있다 —
 *     그때는 이 화면이 그대로 있으므로 목록만 다시 읽으면 된다. 지금 보는 판을
 *     지웠을 때만 목록으로 보낸다(그 화면은 더 이상 열리지 않는다 — 상세 조회가
 *     is_deleted 로 막는다).
 *
 * 🔴 **왜 단추를 따로 만들지 않고 이 조각을 ProcedureVersionList 에 끼워 넣는가**
 * — 거꾸로다. ProcedureVersionList 는 이 조각을 **import 하지 않는다.** 그
 * 목록은 서버 액션을 안 물어야 렌더해서 잴 수 있고(그 파일 머리말), 서버 액션을
 * import 하는 순간 사슬 끝의 `server-only` 때문에 시험에서 import 자체가 던진다.
 * 그래서 부모(ProcedureTemplateDetailScreen)가 이 조각을 **슬롯으로 넘긴다.**
 */
export default function DeleteProcedureVersionButton({
  templateId,
  templateName,
  templateVersion,
  templateStatus,
  isCurrentlyViewing,
  listHref,
}: {
  templateId: string;
  templateName: string;
  /** 같은 이름의 판이 여럿이라, 이름만으로는 어느 것을 지우는지 알 수 없다. */
  templateVersion: number;
  /** 창이 "무엇을 지우는지"를 상태까지 말한다 — 초안과 만료본은 무게가 다르다. */
  templateStatus: ProcedureTemplateStatus;
  /**
   * 🔴 지금 이 상세 화면이 보고 있는 판인가. 지운 뒤 갈 곳이 이 값으로 갈린다
   * (머리말 2번). 화면이 아니라 **부르는 쪽**이 아는 사실이라 프롭으로 받는다.
   */
  isCurrentlyViewing: boolean;
  /** 지금 보는 판을 지웠을 때 갈 목록. [목록으로] 단추와 **같은 주소**다. */
  listHref: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
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
    // 🔴 [취소]는 **아무 일도 안 한다.** 지우는 길로 가는 것은 아래 단추 하나뿐이다.
    if (isDeleting) return;
    setIsOpen(false);
  }

  async function handleDelete() {
    if (isDeleting) return;
    setIsDeleting(true);
    setErrorMessage(null);
    const result = await deleteProcedureTemplateVersionAction({ templateId });
    if (!result.ok) {
      // 서버가 준 이유를 그대로 보인다 — 권한인지, 상태(게시본)인지, 수행
      // 기록·후속 버전이 붙었는지가 사람에게 그대로 전해져야 한다. 창을 닫지
      // 않는다: 닫으면 "아무 일도 안 일어남"으로 보인다.
      setIsDeleting(false);
      setErrorMessage(result.message);
      return;
    }
    if (isCurrentlyViewing) {
      // 🔴 이 화면이 없어졌다. 같은 주소에 남아 refresh 를 부르면 조회가 빈손으로
      //    돌아와 notFound 가 뜨고, 사람에게는 고장으로 보인다. replace 라
      //    [뒤로]가 죽은 화면으로 돌아가지 않는다. isDeleting 은 풀지 않는다 —
      //    떠나는 동안 단추가 다시 눌리면 안 된다.
      router.replace(listHref);
      return;
    }
    // 남의 판을 지웠으면 이 화면은 그대로 있다 — 버전 목록만 다시 읽는다.
    setIsDeleting(false);
    setIsOpen(false);
    router.refresh();
  }

  const statusLabel = procedureTemplateStatusLabels[templateStatus];

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label={`${templateName} v${templateVersion} 삭제`}
        className="rounded-md border border-red-300 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        삭제
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="delete-procedure-version-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="delete-procedure-version-dialog-title" className="text-sm font-semibold">
          버전 삭제
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          &ldquo;{templateName}&rdquo; v{templateVersion} ({statusLabel}) 판을 삭제합니다.
        </p>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          노드·분기·체크리스트·참고자료·검증 기록이 이 판과 함께 휴지통으로 갑니다. 15일 안에는{" "}
          <span className="font-medium">[기술 작업 절차] → [휴지통]</span>에서 되살릴 수 있고, 그 뒤에는 자동으로
          완전히 삭제됩니다. <span className="font-medium">다른 판은 그대로 남습니다.</span>
        </p>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          삭제한 판 번호(v{templateVersion})는 돌아오지 않습니다 — 다시 새 초안을 만들면 다음 번호가 붙습니다.
        </p>
        {isCurrentlyViewing && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            지금 보고 있는 판입니다 — 삭제하면 이 화면이 닫히고 목록으로 돌아갑니다.
          </p>
        )}

        {errorMessage && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            disabled={isDeleting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={isDeleting}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? "삭제하는 중..." : "삭제"}
          </button>
        </div>
      </dialog>
    </>
  );
}
