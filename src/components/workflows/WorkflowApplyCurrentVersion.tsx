"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyCurrentWorkflowVersionAction } from "@/lib/server/actions/workflow-drafts";
import { workflowPublishDoneHref } from "@/lib/domain/workflow-publish-counts-param";

/**
 * ============================================================================
 * "기존 건을 현재 버전으로 적용" 단추 (2026-09-30 사용자 요청)
 * ============================================================================
 * 발행하면 그 종류의 진행 중인 접수 건이 새 버전으로 함께 옮겨진다. 그런데 그
 * 이관이 **발행할 때만** 일어나서, 워크플로를 고치지 않았는데 이미 옛 판에 건이
 * 남아 있으면 옮길 길이 없었다("초안을 새로 만들어 발행"하는 것 말고는).
 * 이 단추가 그 길이다 — 구성은 그대로 두고 건만 지금 판으로 끌어온다.
 *
 * ── 세 가지 판단 ─────────────────────────────────────────────────────────
 *   · **단추에 건수를 적는다.** 수십 건이 한 번에 움직이므로 누르기 전에 규모를
 *     알아야 한다. 그 수는 서버가 이관과 **같은 함수**로 센 값이다
 *     (db/mutations/workflow-drafts.ts의 planInFlightCaseMigration) — 안내용
 *     어림이 아니라 실제로 옮겨질 수다.
 *   · **확인 창을 거친다.** 한 번에 되돌리는 길이 없다. 창은 이 앱의 다른 확인
 *     창과 같은 네이티브 dialog/showModal 방식이다(WorkflowDraftConfirmDialog).
 *     그 컴포넌트를 늘리지 않고 여기 둔 이유는 문구에 건수가 들어가기 때문이다 —
 *     "발행/폐기"는 판 번호 하나면 되지만 이쪽은 수 둘이 더 필요하다.
 *   · **결과는 도착 화면이 말한다.** 누르면 곧바로 화면을 떠나므로(router.push)
 *     여기서 띄운 메시지는 사람이 읽기 전에 사라진다. 옮긴 수·남은 수를 주소에
 *     실어 보내는 일은 발행이 이미 쓰는 모듈이 한다(workflowPublishDoneHref).
 *
 * 🔴 이 단추를 그릴지 말지는 화면이 정하지 않는다 — 페이지가 workflows.publish
 * MANAGE 를 물어 보고 그럴 때만 이 컴포넌트를 그린다. 서버(mutation)도 같은
 * 권한을 다시 판정하므로, 화면을 건너뛰고 액션을 직접 불러도 막힌다.
 * ============================================================================
 */
export default function WorkflowApplyCurrentVersion({
  templateCode,
  versionNumber,
  migratableCaseCount,
  strandedCaseCount,
}: {
  templateCode: string;
  /** 현재 발행 버전의 번호. 어느 판으로 끌어오는지 문구에 적는다. */
  versionNumber: number;
  /** 지금 누르면 실제로 옮겨질 건 수. 0이면 누를 수 없다. */
  migratableCaseCount: number;
  /** 현재 단계가 지금 판에 없어 옮겨지지 않을 건 수. */
  strandedCaseCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isConfirming && !dialog.open) {
      dialog.showModal();
    } else if (!isConfirming && dialog.open) {
      dialog.close();
    }
  }, [isConfirming]);

  const hasCasesToMove = migratableCaseCount > 0;

  function apply() {
    setIsConfirming(false);
    setError(null);
    startTransition(async () => {
      const result = await applyCurrentWorkflowVersionAction(templateCode);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(
        workflowPublishDoneHref(
          templateCode,
          { migrated: result.migratedCaseCount, stranded: result.strandedCaseCount },
          "applied"
        )
      );
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending || !hasCasesToMove}
          onClick={() => setIsConfirming(true)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          {isPending
            ? "적용 중..."
            : hasCasesToMove
              ? `진행 중인 ${migratableCaseCount}건을 현재 버전으로 적용`
              : "기존 건을 현재 버전으로 적용"}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {hasCasesToMove
            ? `옛 버전에 묶여 있는 접수 건을 v${versionNumber}의 같은 단계로 끌어옵니다. 워크플로 구성은 바뀌지 않습니다.`
            : "옮길 건이 없습니다. 진행 중인 접수 건이 모두 현재 버전에 있습니다."}
        </span>
      </div>

      {strandedCaseCount > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          현재 단계가 v{versionNumber}에 없는 {strandedCaseCount}건은 옮기지 못하고 이전 버전에 남습니다.
        </p>
      )}

      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}

      <dialog
        ref={dialogRef}
        aria-labelledby="workflow-apply-confirm-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!isPending) setIsConfirming(false);
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="workflow-apply-confirm-title" className="text-sm font-semibold">
          진행 중인 {migratableCaseCount}건을 v{versionNumber}(으)로 적용하시겠습니까?
        </h2>

        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          옛 버전에 묶여 있던 접수 건이 <strong>현재 버전의 같은 단계</strong>로 옮겨집니다. 워크플로 구성과
          단계 이력은 바뀌지 않습니다.
        </p>
        {strandedCaseCount > 0 && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            현재 단계가 v{versionNumber}에 없는 {strandedCaseCount}건은 옮기지 못하고 이전 버전에 남습니다.
          </p>
        )}
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          한 번에 되돌리는 기능은 없습니다 — 되돌리려면 접수 건마다 손으로 옮겨야 합니다.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            disabled={isPending}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={isPending}
            aria-busy={isPending}
            className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "적용 중..." : "적용"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
