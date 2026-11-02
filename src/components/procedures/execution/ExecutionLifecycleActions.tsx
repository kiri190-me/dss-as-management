"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import ReasonPromptDialog from "./ReasonPromptDialog";
import {
  finishProcedureExecutionAction,
  abandonProcedureExecutionAction,
} from "@/lib/server/actions/procedure-case-execution";
import type { ExecutionFinishAssessment } from "@/lib/domain/procedure-execution-lifecycle";

/**
 * 불러온 절차를 **끝내는** 단추와 **그만두는** 단추. 실행 하나를 통째로 다루는
 * 유일한 자리다(노드 단추들은 카드 안에 있다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 막혀 있었는가 (사용자가 실제로 겪은 것, 2026-11-02)
 * ──────────────────────────────────────────────────────────────────────
 *  1. 실행을 **그만둘 길이 없었다.** 단추는 노드마다 [시작][완료][건너뛰기]
 *     [차단] 넷뿐. 한 접수 건에 실행이 하나라서 잘못 불러오면 바꿀 수도 없었고,
 *     그래서 시험 삼아 눌러 보기가 무서운 화면이었다.
 *  2. 실행을 **끝내는 길이 없었다.** 전부 완료해도 100% 가 될 뿐 「끝났다」는
 *     신호가 없어 화면이 영원히 그대로였다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 두 단추가 서로 다른 창을 쓰는 까닭
 * ──────────────────────────────────────────────────────────────────────
 *  - 그만두기 — **사유를 받는다**(ReasonPromptDialog). 나중에 「잘못 불러와서
 *    치운 것」과 「수리가 취소돼 멈춘 것」을 가를 수단이 그 글자뿐이다. 건너뛰기·
 *    차단·재개가 이미 같은 창을 쓴다.
 *  - 끝내기 — **사유를 안 받는다.** 절차를 마치는 것은 예외 상황이 아니라
 *    정상적인 마지막 걸음이다. 사유를 요구하면 매번 「완료」 같은 빈말을 적게
 *    된다. 대신 **남은 것이 있을 때만** 「그래도 끝낼까요?」를 묻는다 —
 *    확인 창 모양은 PublishTemplateButton 과 같다(브라우저 기본 confirm 이
 *    아니라 <dialog>: 기본 창은 무엇이 왜 되돌리기 어려운지 적을 자리가 없다).
 *
 * 🔴 남은 수를 **여기서 세지 않는다.** assessExecutionFinish(도메인)가 세어 준
 * 것을 그대로 쓰고, 서버도 잠근 뒤 같은 함수로 다시 센다. 두 벌로 두면 창에는
 * 「3개 남았습니다」가 뜨는데 서버는 다른 수를 보는 날이 온다.
 *
 * 끝낸 뒤 이 자리에 서는 것은 「절차를 마쳤습니다」 한 줄이다. 그때도 그만두기는
 * 남겨 둔다 — 잘못 끝냈을 때 되돌릴 길이 그것뿐이다(「다시 열기」는 없다).
 */

/**
 * 단추에 **마우스를 올려 두면 뜨는 글자**. 평소에는 화면에 안 보인다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 글자가 필요한가 · 왜 title 인가
 * ──────────────────────────────────────────────────────────────────────
 * 단추 이름만 있으면 둘이 **어떻게 다른지** 알 수 없다(2026-11-02 눈 확인).
 * 「끝내기」는 남기는 것이고 「그만두기」는 치우는 것인데, 글자가 없으면 둘 다
 * 「이 절차를 더 안 한다」로만 읽혀서 되돌릴 수 없는 쪽을 잘못 누르게 된다.
 *
 * 처음에는 단추 아래에 **늘 보이는 한 줄**로 달았는데, 사용자가 「포인터를 갖다
 * 댔을 때만」으로 바꿔 달라고 했다(같은 날). 글자는 그대로 두고 **보이는 때**만
 * 바꾼다.
 *
 * 🔵 `title` 속성을 고른 까닭 — 이 저장소가 **이미 쓰는 방식**이다. 「눌러서
 * 고치는 칸」의 단서 넷 가운데 하나가 「올려 두면 뜨는 title」이라고
 * inline-edit-cell-button.ts 에 못 박혀 있고, 화면 수십 곳이 그렇게 쓴다. 뜨기까지
 * 0.5~1초 걸리고 모양을 못 고치는 것은 사실이지만, 이 글자는 **처음 한 번 알면
 * 되는 것**이라 급하지 않다.
 *
 * 🔴 떠 있는 동안 아무것도 안 가린다 — 브라우저가 알아서 자리를 잡고, 클릭을
 * 먹지 않는다. 직접 만든 말풍선(absolute)이었다면 바로 아래 「지금 할 일」 큰
 * 카드를 덮었을 자리다.
 *
 * 🔴 **`sr-only` 조각은 안 쓴다.** 이 저장소의 sr-only 는 `position: absolute`
 * 라, 기준이 되는 위치 지정 조상이 없으면 문서 바닥에 1px 자리를 주장해 창
 * 스크롤을 하나 더 만든다 — 실제로 겪은 고장이고 눈으로도 진단으로도 안 걸린다
 * (inline-edit-cell-button.ts · WeeklyReportBlockStatusEdit 의 같은 주석).
 * 낭독기에는 다른 설명이 없으면 title 이 그대로 읽히므로 잃는 것도 없다.
 *
 * ⚠️ **폰에는 「올려 두기」가 없다.** 그래서 두 확인 창 안의 설명은 **그대로
 * 둔다** — 폰에서는 그것이 둘의 차이를 알 유일한 길이다.
 */
const FINISH_HINT = "이 절차를 다 했다고 기록합니다 — 지나온 길이 남습니다.";
const ABANDON_HINT = "잘못 불러왔거나 이 절차를 안 쓰게 됐을 때 — 이 건에서 치웁니다.";
export default function ExecutionLifecycleActions({
  executionId,
  executionVersion,
  templateName,
  completedAt,
  finish,
  eligible,
}: {
  executionId: string;
  /** 실행 행 자신의 version — 노드의 version 과 다른 값이다. */
  executionVersion: number;
  templateName: string;
  /** 끝낸 실행이면 그 시각(ISO). 아직 돌고 있으면 null. */
  completedAt: string | null;
  /** 도메인이 정한 「끝내면 무엇이 남는가」. 화면은 다시 세지 않는다. */
  finish: ExecutionFinishAssessment;
  eligible: boolean;
}) {
  const router = useRouter();
  const confirmFinishRef = useRef<HTMLDialogElement>(null);
  const [isConfirmingFinish, setIsConfirmingFinish] = useState(false);
  /**
   * 확인 창에 띄울 글자. 두 곳에서 들어오는데 **둘 다 같은 도메인 함수가 만든
   * 글자**다 — 누를 때는 화면이 받아 둔 것(finish.confirmationMessage), 서버가
   * 「아직 남았다」로 돌려보낼 때는 **잠근 뒤 다시 센** 것. 뒤엣것이 더 새것이라
   * 그대로 덮어쓴다.
   */
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [isAbandoning, setIsAbandoning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = confirmFinishRef.current;
    if (!dialog) return;
    if (isConfirmingFinish && !dialog.open) dialog.showModal();
    else if (!isConfirmingFinish && dialog.open) dialog.close();
  }, [isConfirmingFinish]);

  async function runFinish(confirmedRemaining: boolean) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await finishProcedureExecutionAction({
      executionId,
      expectedVersion: executionVersion,
      confirmedRemaining,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      // 🔴 「아직 남았습니다」는 거절이 아니라 **물어보라는 신호**다. 서버가 잠근
      // 뒤 다시 세어 보냈으므로, 화면이 세어 둔 수가 옛말이어도 여기서 바로잡힌다.
      if (result.code === "UNFINISHED_NODES_REMAIN") {
        setConfirmMessage(result.message);
        setIsConfirmingFinish(true);
        return;
      }
      setErrorMessage(result.message);
      return;
    }
    setIsConfirmingFinish(false);
    router.refresh();
    showSavePopup({ message: "절차를 마쳤습니다.", redirectTo: null });
  }

  function handleFinishClick() {
    // 남은 것이 있으면 부르기 전에 묻는다. 없으면 바로 끝낸다 — 그때 서버는
    // 확인을 요구하지 않는다(assessExecutionFinish 가 양쪽에서 같은 답을 준다).
    if (finish.needsConfirmation) {
      setErrorMessage(null);
      setConfirmMessage(finish.confirmationMessage);
      setIsConfirmingFinish(true);
      return;
    }
    void runFinish(false);
  }

  async function handleAbandonConfirm(reason: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await abandonProcedureExecutionAction({
      executionId,
      expectedVersion: executionVersion,
      reason,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setIsAbandoning(false);
    router.refresh();
    showSavePopup({ message: "실행을 그만뒀습니다. 다른 절차를 다시 불러올 수 있습니다.", redirectTo: null });
  }

  const abandonButton = (
    <button
      type="button"
      data-execution-abandon
      title={ABANDON_HINT}
      onClick={() => {
        setErrorMessage(null);
        setIsAbandoning(true);
      }}
      disabled={isSubmitting}
      className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      실행 그만두기
    </button>
  );

  return (
    <section
      data-execution-lifecycle
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {completedAt ? (
        <div>
          <p data-execution-finished className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            절차를 마쳤습니다
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {new Date(completedAt).toLocaleString("ko-KR")} · 아래 기록은 그대로 남습니다. 다른 절차가 필요하면 위의
            [+ 기술 절차 불러오기]를 누르세요.
          </p>
        </div>
      ) : (
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{templateName}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {finish.needsConfirmation
              ? `아직 끝내지 않은 작업 ${finish.remainingCount}개` +
                (finish.blockedCount > 0 ? ` (차단됨 ${finish.blockedCount}개)` : "")
              : "모든 작업이 끝났습니다. 절차를 끝내 주세요."}
          </p>
        </div>
      )}

      {eligible ? (
        <div className="flex flex-wrap gap-2">
          {/* 🔴 다 끝났을 때는 이 단추가 화면에서 **할 일**이 된다(그 자리에는
              「지금 할 일」 큰 카드가 안 선다). 그래서 남은 것이 없으면 꽉 찬
              단추로, 남아 있으면 평범한 테두리 단추로 그린다. */}
          {completedAt === null && (
            <button
              type="button"
              data-execution-finish
              title={FINISH_HINT}
              onClick={handleFinishClick}
              disabled={isSubmitting}
              className={
                finish.needsConfirmation
                  ? "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  : "rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              }
            >
              {isSubmitting ? "처리 중..." : "절차 끝내기"}
            </button>
          )}
          {abandonButton}
        </div>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          담당 엔지니어 또는 관리자만 절차를 끝내거나 그만둘 수 있습니다.
        </p>
      )}

      {errorMessage && <p className="w-full text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}

      <dialog
        ref={confirmFinishRef}
        aria-labelledby="execution-finish-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!isSubmitting) setIsConfirmingFinish(false);
        }}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <h2 id="execution-finish-dialog-title" className="text-sm font-semibold">
          절차 끝내기
        </h2>
        {/* 🔴 도메인이 만든 글자를 **그대로** 띄운다 — 화면에서 다시 쓰면 서버가
            보는 수와 사람이 읽는 수가 갈린다. */}
        <p data-execution-finish-confirm className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          {confirmMessage}
        </p>
        {/* 🔴 「끝내기」와 「그만두기」의 차이를 **창에서도** 한 번 더 말한다 —
            되돌리기 어려운 두 단추가 나란히 있어서, 누르기 직전이 마지막으로
            바로잡을 자리다. */}
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          남은 작업은 그대로 둡니다 — 끝냈다고 표시하지 않습니다. 끝낸 뒤에도 지나온 길과 실행 이력은 그대로 보이고,
          다른 절차를 다시 불러올 수 있습니다. 잘못 불러온 절차를 <span className="font-medium">치우려는</span> 것이라면
          [실행 그만두기]입니다.
        </p>

        {errorMessage && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              if (!isSubmitting) setIsConfirmingFinish(false);
            }}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void runFinish(true)}
            disabled={isSubmitting}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {isSubmitting ? "끝내는 중..." : "그래도 끝내기"}
          </button>
        </div>
      </dialog>

      <ReasonPromptDialog
        isOpen={isAbandoning}
        title={`실행 그만두기: ${templateName}`}
        warningNote="이 접수 건에서 이 절차 실행을 치웁니다. 지나온 기록은 지워지지 않지만 화면에서는 더 보이지 않고, 되돌릴 수 없습니다. 다 한 절차를 마무리하려는 것이라면 [절차 끝내기]입니다."
        isSubmitting={isSubmitting}
        onConfirm={handleAbandonConfirm}
        onCancel={() => setIsAbandoning(false)}
      />
    </section>
  );
}
