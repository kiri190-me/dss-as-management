"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import ExecutionAbandonButton from "./ExecutionAbandonButton";
import { finishProcedureExecutionAction } from "@/lib/server/actions/procedure-case-execution";
import type { ExecutionFinishAssessment } from "@/lib/domain/procedure-execution-lifecycle";

/**
 * **화면 위에 선 실행**을 통째로 다루는 단추 묶음 — [절차 끝내기]와, 그 옆에
 * 같이 서는 [실행 그만두기](ExecutionAbandonButton).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **제 상자가 없다** — 남의 상자 안에 들어가 산다(2026-11-02, 조각 8)
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 테두리를 두른 상자 하나로 혼자 서서, 바로 위 진행 요약 상자와 **절차
 * 이름을 두 번** 적고 있었다. 사용자가 눈으로 보고 정했다 — 「이 두 내용이 서로
 * 다른 박스로 있을 필요 없을 것 같은데? [절차 끝내기], [실행 그만두기]도 진행바가
 * 있는 박스 안에 포함시켜줘.」
 *
 * 그래서 뿌리를 **테두리 없는 한 줄**로 바꿨다(위에 구분선만 긋는다). 이름도 안
 * 적는다 — 담는 상자가 이미 맨 위에 적고 있다. 🔴 진행바와 수치가 먼저, 단추가
 * 나중이다 — 단추가 위에 있으면 눌러야 할 것처럼 보인다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이 묶음은 **도는 실행에서만** 선다 — 그래서 completedAt 을 안 받는다
 * ──────────────────────────────────────────────────────────────────────
 * 마친 실행은 요약 상자째로 「이 건의 다른 절차」의 한 줄로 내려가고
 * (placeExecutionSummary), 그 줄에는 **[실행 그만두기] 하나만** 붙는다
 * (ExecutionAbandonButton). 그러니 이 묶음이 「마쳤을 때」를 그릴 일이 영영 없다 —
 * 닿지 않는 가지를 남겨 두면 다음 사람이 그것을 근거로 뭔가를 되살린다. 그래서
 * **prop 에서 아예 뺐다**(NoCurrentTaskCard 가 EXECUTION_FINISHED 를 타입에서
 * 뺀 것과 같은 규약).
 *
 * 🔵 그래서 [절차 끝내기]도 조건 없이 그린다 — 여기 섰다는 것 자체가 「아직 안
 * 마친 실행」이라는 뜻이다.
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
 *    차단·재개가 이미 같은 창을 쓴다. 🔵 그 단추와 창은 2026-11-02(조각 8 보완)에
 *    **제 파일로 갈라졌다**(ExecutionAbandonButton) — 「이 건의 다른 절차」의
 *    줄마다 같은 단추가 붙어야 해서다. 여기서는 그것을 가져다 쓴다.
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
 * 끝낸 뒤에도 그만두기는 남겨 둔다 — 잘못 끝냈을 때 되돌릴 길이 그것뿐이다
 * (「다시 열기」는 없다).
 */

/**
 * [절차 끝내기]에 **마우스를 올려 두면 뜨는 글자**. 평소에는 화면에 안 보인다.
 * (짝인 [실행 그만두기] 쪽 글자는 ExecutionAbandonButton 에 같은 까닭으로 있다.)
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
// 🔵 글자 하나가 2026-11-02(조각 8)에 바뀌었다 — 전에는 「지나온 길이
// 남습니다」였다. 그 이름의 묶음이 「실행 이력」 안으로 들어가 화면에서 사라졌으므로,
// 사람이 찾아갈 수 있는 **지금 있는 이름**으로 적는다.
const FINISH_HINT = "이 절차를 다 했다고 기록합니다 — 지나온 기록은 [실행 이력]에 남습니다.";
export default function ExecutionLifecycleActions({
  executionId,
  executionVersion,
  templateName,
  finish,
  eligible,
}: {
  executionId: string;
  /** 실행 행 자신의 version — 노드의 version 과 다른 값이다. */
  executionVersion: number;
  templateName: string;
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

  return (
    <div
      data-execution-lifecycle
      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {finish.needsConfirmation
          ? `아직 끝내지 않은 작업 ${finish.remainingCount}개` +
            (finish.blockedCount > 0 ? ` (차단됨 ${finish.blockedCount}개)` : "")
          : "모든 작업이 끝났습니다. 절차를 끝내 주세요."}
      </p>

      {eligible ? (
        <div className="flex flex-wrap gap-2">
          {/* 🔴 다 끝났을 때는 이 단추가 화면에서 **할 일**이 된다(그 자리에는
              「지금 할 일」 큰 카드가 안 선다). 그래서 남은 것이 없으면 꽉 찬
              단추로, 남아 있으면 평범한 테두리 단추로 그린다. */}
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
          {/* 🔵 그만두기는 **제 컴포넌트**가 쥔다(ExecutionAbandonButton) — 「이
              건의 다른 절차」의 줄마다 같은 단추가 붙어야 해서 갈랐다. 여기서는
              그 줄과 **같은 단추**를 쓴다(한쪽만 고치는 날이 안 오게). */}
          <ExecutionAbandonButton
            executionId={executionId}
            executionVersion={executionVersion}
            templateName={templateName}
          />
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
          남은 작업은 그대로 둡니다 — 끝냈다고 표시하지 않습니다. 끝낸 뒤에도 [실행 이력]에 지나온 기록이 그대로 남고,
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
    </div>
  );
}
