"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReasonPromptDialog from "./ReasonPromptDialog";
import { reopenExecutionNodeAction } from "@/lib/server/actions/procedure-case-execution";

/**
 * **[재개(되돌림)]** 단추 한 벌(2026-11-03, 조각 12). 끝난 작업(완료·건너뜀)과
 * 막힌 작업(차단됨)을 **사유와 함께** 다시 진행 중으로 되돌리는 유일한 길이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 제 파일로 갈랐나 — 단추가 설 자리가 둘이 됐다
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 이 단추가 노드 카드(ExecutionNodeCard) 안에만 있었다. 조각 12 에서
 * 「실행 이력」이 **이력 표를 시간순으로 그리는 목록**이 되면서 완료·건너뜀 카드가
 * 없어졌고(사용자 결정 — 「[실행 이력]이 시간순서대로 누적될 수 있도록」), 그
 * 단추는 **그 작업의 가장 최근 이력 줄**로 옮겨 갔다. 「차단됨」 구역의 카드는
 * 그대로 남아 있으므로(막힌 절차를 푸는 유일한 집), 한 벌을 둘이 나눠 쓴다.
 *
 * 🔴 **사유를 반드시 받는다.** 창을 거치지 않는 길을 만들면 「되돌렸는데 왜
 * 되돌렸는지가 아무 데도 없는」 기록이 생긴다 — 서버도 사유 없는 요청을 거절한다.
 *
 * 🔵 경고 한 줄은 전과 같은 글자다 — 되돌려도 **이후 완료된 다른 작업은 따라
 * 돌아가지 않는다**(옮기기와 다른 점이다. 옮기기는 경로 밖의 완료를 되돌린다).
 */
export default function ExecutionNodeReopenButton({
  executionNodeId,
  executionNodeVersion,
  nodeTitle,
  size = "SM",
}: {
  executionNodeId: string;
  /** 🔴 그 줄 **자신의** 낙관적 동시성 토큰. */
  executionNodeVersion: number;
  nodeTitle: string;
  size?: "SM" | "MD";
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submitReopen(reason: string) {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await reopenExecutionNodeAction({
      executionNodeId,
      expectedVersion: executionNodeVersion,
      reason,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    setIsOpen(false);
    router.refresh();
  }

  const buttonClass = size === "MD" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-execution-reopen
        onClick={() => setIsOpen(true)}
        disabled={isSubmitting}
        className={`w-fit rounded-md border border-zinc-300 ${buttonClass} text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
      >
        재개(되돌림)
      </button>
      {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <ReasonPromptDialog
        isOpen={isOpen}
        title={`재개(되돌림): ${nodeTitle}`}
        warningNote="이후 완료된 다른 작업들은 자동으로 되돌아가지 않습니다."
        isSubmitting={isSubmitting}
        onConfirm={(reason) => void submitReopen(reason)}
        onCancel={() => setIsOpen(false)}
      />
    </div>
  );
}
