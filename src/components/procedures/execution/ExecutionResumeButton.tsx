"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { resumeProcedureExecutionAction } from "@/lib/server/actions/procedure-case-execution";

/**
 * 마친 실행을 **다시 잇는** 단추 — [절차 다시 잇기] 하나(2026-11-02, 조각 9).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇이 막혀 있었는가 (사용자 말 그대로)
 * ──────────────────────────────────────────────────────────────────────
 * 「절차를 다 진행하지 않고 절차를 마친 경우는 마쳐진 노드부터 절차를 재개할 수
 * 있도록 해주고.」
 *
 * 조각 8 부터 마친 실행은 큰 카드에서 내려와 「이 건의 다른 절차」의 한 줄이
 * 된다. 그래서 **남은 작업이 있는데 마친 실행**은 다시 손댈 길이 화면에서 통째로
 * 사라졌다 — 그 자리에 남은 단추가 [실행 그만두기] 하나였는데, 그것은 **치우는
 * 것**이지 잇는 것이 아니다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **확인 창이 없다** — 짝인 [실행 그만두기]와 다른 점이 그것이다
 * ──────────────────────────────────────────────────────────────────────
 * 그만두기는 되돌릴 수 없어서 사유 창을 거치지만, 다시 잇기는 **되돌릴 수 있다** —
 * 그 자리에서 [절차 끝내기]를 다시 누르면 누르기 전과 같아진다(노드를 한 줄도 안
 * 건드리므로 진행 상태도 그대로다). 되돌릴 수 있는 일에 창을 세우면 매번 두 번
 * 누르게 될 뿐이다. 사유도 같은 까닭으로 안 받는다(서버 쪽 같은 주석).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **expectedVersion 은 줄마다 제 것**이다
 * ──────────────────────────────────────────────────────────────────────
 * 실행 행 자신의 version 이고(노드의 version 과 다른 값), 한 값을 여러 줄이 돌려
 * 쓰면 남의 version 으로 남의 실행을 이으려 드는 호출이 된다. 조회가 줄마다
 * 실어 온다(getOtherExecutionsForCase 의 version) — [실행 그만두기]와 같은 규약.
 *
 * 🔵 **누가 누를 수 있는가는 여기서 안 가른다.** 받는 쪽(줄)이 그 판정을 쥐고
 * 있고, 서버는 어느 쪽이든 독립으로 다시 판정한다
 * (assertOrdinaryMutationAuthorized — 끝내기·그만두기와 같은 문턱).
 */

/**
 * 단추에 **마우스를 올려 두면 뜨는 글자**. 평소에는 화면에 안 보인다.
 * (짝인 [실행 그만두기] 쪽 글자는 ExecutionAbandonButton 에 같은 까닭으로 있다.)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 글자가 필요한가 · 왜 title 인가
 * ──────────────────────────────────────────────────────────────────────
 * 단추 이름만 있으면 옆의 [실행 그만두기]와 **어떻게 다른지** 알 수 없다. 둘 다
 * 「마친 절차를 어떻게 한다」로만 읽히는데, 하나는 치우는 것이고 하나는 다시
 * 돌리는 것이라 결과가 정반대다. 특히 사람이 궁금해하는 것은 「다시 이으면 지금까지
 * 한 것이 날아가나」인데, 그 답(그대로 남는다)이 이 글자에 있다.
 *
 * 🔵 `title` 속성을 고른 까닭 — 이 저장소가 **이미 쓰는 방식**이다(조각 5 가 두
 * 단추에 붙인 그 방식 그대로). 「눌러서 고치는 칸」의 단서 넷 가운데 하나가
 * 「올려 두면 뜨는 title」이라고 inline-edit-cell-button.ts 에 못 박혀 있다.
 *
 * 🔴 **`sr-only` 조각은 안 쓴다.** 이 저장소의 sr-only 는 `position: absolute`
 * 라, 기준이 되는 위치 지정 조상이 없으면 문서 바닥에 1px 자리를 주장해 창
 * 스크롤을 하나 더 만든다 — 실제로 겪은 고장이고 눈으로도 진단으로도 안 걸린다.
 *
 * ⚠️ **폰에는 「올려 두기」가 없다.** 그래서 누른 **뒤**에 뜨는 저장 팝업이 같은
 * 사실을 한 번 더 말한다(아래 showSavePopup) — 폰에서는 그것이 「무슨 일이
 * 일어났는지」를 알 유일한 길이다.
 */
const RESUME_HINT = "마쳤다는 표시만 지웁니다 — 지나온 기록과 남은 작업은 그대로라, 마칠 때 하던 작업부터 다시 이어집니다.";

export default function ExecutionResumeButton({
  executionId,
  executionVersion,
}: {
  executionId: string;
  /**
   * 🔴 **이 실행 행 자신의** version — 노드의 version 과 다른 값이고, 줄이 여럿일
   * 때 돌려 쓰면 안 된다.
   */
  executionVersion: number;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleResume() {
    // 🔴 두 번 누르기 막기. 첫 호출이 성공하면 version 이 올라가므로 둘째는 서버가
    // CONFLICT 로 거절하는데, 그 글자(「다른 사용자가 먼저 변경했습니다」)는 혼자
    // 두 번 누른 사람에게 거짓말이 된다.
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await resumeProcedureExecutionAction({ executionId, expectedVersion: executionVersion });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    router.refresh();
    // 🔵 저장 팝업은 성공 전용이다(0.5초 뒤 저절로 닫힌다 — 이 저장소의 규약).
    //    🔴 **큰 카드에 선다고 단정하지 않는다** — 같은 건에 더 나중에 시작한
    //    다른 실행이 돌고 있으면 큰 카드는 그쪽이 차지하고(getActiveExecutionForCase
    //    가 안 끝난 것 가운데 **나중에 시작한 것**을 고른다), 이 실행은 「진행 중」
    //    배지 줄로 남는다. 그때 「위에서 이어서 하세요」라고 적으면 거짓이 된다.
    showSavePopup({ message: "절차를 다시 이었습니다. 마칠 때 하던 작업부터 이어서 하면 됩니다.", redirectTo: null });
  }

  return (
    <>
      <button
        type="button"
        data-execution-resume
        title={RESUME_HINT}
        onClick={() => void handleResume()}
        disabled={isSubmitting}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {isSubmitting ? "처리 중..." : "절차 다시 잇기"}
      </button>

      {errorMessage && <p className="w-full text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
    </>
  );
}
