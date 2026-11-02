"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import ReasonPromptDialog from "./ReasonPromptDialog";
import { abandonProcedureExecutionAction } from "@/lib/server/actions/procedure-case-execution";

/**
 * 실행 하나를 **치우는** 단추 — [실행 그만두기] 하나와 그 사유 창.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 따로 떼어 냈는가 (2026-11-02, 조각 8 보완)
 * ──────────────────────────────────────────────────────────────────────
 * 사용자가 눈으로 보고 말했다 — 「[실행 그만두기]가 [중단 마침]인 해당 건에 대한
 * [실행 그만두기]인지 모든 [중단 마침]에 대한 그만두기인지 모르겠어. [중단 마침]
 * 건별로 [실행 그만두기]가 있도록 해주고.」
 *
 * 그래서 「이 건의 다른 절차」의 **줄마다** 이 단추가 붙는다. 그 자리에 필요한
 * 것은 **그만두기 하나뿐**이다 — 끝내기는 화면 위에 선 실행(지금 보고 있는 것)
 * 에만 뜻이 있고, 줄에까지 [절차 끝내기]를 달면 보고 있지도 않은 절차를 끝내는
 * 길이 생긴다. 그래서 [절차 끝내기]와 한 몸이던 것을 갈라
 * ExecutionLifecycleActions 는 **끝내기 + 이 단추**를, 줄은 **이 단추만** 쓴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **사유를 받는다** — 누르자마자 치우지 않는다
 * ──────────────────────────────────────────────────────────────────────
 * 나중에 「잘못 불러와서 치운 것」과 「수리가 취소돼 멈춘 것」을 가를 수단이 그
 * 글자뿐이다(abandonProcedureExecution 의 같은 주석). 창은 건너뛰기·차단·재개가
 * 이미 쓰는 그것이다.
 *
 * 🔴 **expectedVersion 은 줄마다 제 것**이어야 한다. 실행 행 자신의 version 이고
 * (노드의 version 과 다른 값), 한 값을 여러 줄이 돌려 쓰면 남의 version 으로 남의
 * 실행을 치우려 드는 호출이 된다. 조회가 줄마다 실어 온다
 * (getOtherExecutionsForCase 의 version).
 *
 * 🔵 **누가 누를 수 있는가는 여기서 안 가른다.** 받는 쪽(상자 · 줄)이 그 판정을
 * 쥐고 있고, 안 되는 사람에게는 **단추 대신 까닭 한 줄**을 그린다 — 자리마다
 * 적는 말이 달라서(상자는 끝내기까지 함께 말한다) 여기로 끌고 오면 한쪽이
 * 거짓말을 하게 된다. 서버는 어느 쪽이든 독립으로 다시 판정한다
 * (assertOrdinaryMutationAuthorized).
 */

/**
 * 단추에 **마우스를 올려 두면 뜨는 글자**. 평소에는 화면에 안 보인다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 글자가 필요한가 · 왜 title 인가
 * ──────────────────────────────────────────────────────────────────────
 * 단추 이름만 있으면 [절차 끝내기]와 **어떻게 다른지** 알 수 없다(2026-11-02 눈
 * 확인). 「끝내기」는 남기는 것이고 「그만두기」는 치우는 것인데, 글자가 없으면 둘
 * 다 「이 절차를 더 안 한다」로만 읽혀서 되돌릴 수 없는 쪽을 잘못 누르게 된다.
 *
 * 처음에는 단추 아래에 **늘 보이는 한 줄**로 달았는데, 사용자가 「포인터를 갖다
 * 댔을 때만」으로 바꿔 달라고 했다(같은 날). 글자는 그대로 두고 **보이는 때**만
 * 바꾼다.
 *
 * 🔵 `title` 속성을 고른 까닭 — 이 저장소가 **이미 쓰는 방식**이다. 「눌러서
 * 고치는 칸」의 단서 넷 가운데 하나가 「올려 두면 뜨는 title」이라고
 * inline-edit-cell-button.ts 에 못 박혀 있고, 화면 수십 곳이 그렇게 쓴다.
 *
 * 🔴 떠 있는 동안 아무것도 안 가린다 — 브라우저가 알아서 자리를 잡고, 클릭을
 * 먹지 않는다. 직접 만든 말풍선(absolute)이었다면 바로 아래 줄을 덮었을 자리다.
 *
 * 🔴 **`sr-only` 조각은 안 쓴다.** 이 저장소의 sr-only 는 `position: absolute`
 * 라, 기준이 되는 위치 지정 조상이 없으면 문서 바닥에 1px 자리를 주장해 창
 * 스크롤을 하나 더 만든다 — 실제로 겪은 고장이고 눈으로도 진단으로도 안 걸린다.
 *
 * ⚠️ **폰에는 「올려 두기」가 없다.** 그래서 사유 창 안의 설명은 **그대로 둔다** —
 * 폰에서는 그것이 [절차 끝내기]와의 차이를 알 유일한 길이다.
 */
const ABANDON_HINT = "잘못 불러왔거나 이 절차를 안 쓰게 됐을 때 — 이 건에서 치웁니다.";

export default function ExecutionAbandonButton({
  executionId,
  executionVersion,
  templateName,
}: {
  executionId: string;
  /**
   * 🔴 **이 실행 행 자신의** version — 노드의 version 과 다른 값이고, 줄이 여럿일
   * 때 돌려 쓰면 안 된다.
   */
  executionVersion: number;
  /**
   * 창 제목에 그대로 들어간다(「실행 그만두기: …」). 🔵 줄에 붙을 때는 줄에 적힌
   * 것과 **같은 글자**를 받는다 — 어느 절차를 치우는지 창에서 다시 말해 주는 것이
   * 「이 줄의 단추인가」를 가리는 마지막 방벽이다.
   */
  templateName: string;
}) {
  const router = useRouter();
  const [isAbandoning, setIsAbandoning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  return (
    <>
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

      {errorMessage && <p className="w-full text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}

      {/* 🔵 창은 **이 단추의 것**이다 — 여는 것도 닫는 것도 이 컴포넌트의 상태
          하나라, 줄이 여럿이어도 누른 줄의 창만 열린다. 제목에 절차 이름이
          들어가므로 열리고 나서도 어느 것을 치우는지 다시 보인다. */}
      <ReasonPromptDialog
        isOpen={isAbandoning}
        title={`실행 그만두기: ${templateName}`}
        warningNote="이 접수 건에서 이 절차 실행을 치웁니다. 지나온 기록은 지워지지 않지만 화면에서는 더 보이지 않고, 되돌릴 수 없습니다. 다 한 절차를 마무리하려는 것이라면 [절차 끝내기]입니다."
        isSubmitting={isSubmitting}
        onConfirm={handleAbandonConfirm}
        onCancel={() => setIsAbandoning(false)}
      />
    </>
  );
}
