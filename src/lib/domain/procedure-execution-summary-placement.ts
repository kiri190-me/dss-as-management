/**
 * 실행 화면의 **진행 요약 상자가 어디에 서는가**. 순수 함수만 — DOM 도 React 도
 * DB 도 건드리지 않는다(procedure-execution-focus.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 자리를 고르는 함수가 따로 필요한가
 * ──────────────────────────────────────────────────────────────────────
 * 2026-11-02(조각 8) 에 사용자가 「절차가 마쳐진 경우 진행바 상자가 [이 건의 다른
 * 절차]에 속하게 해줘」라고 정했다. 마친 실행은 더 이상 화면 맨 위를 차지하지
 * 않고, 「이 건의 다른 절차」 묶음의 **한 줄**로 내려간다.
 *
 * 그런데 그 한 줄은 아무 데서나 만들어지는 것이 아니라 **조회가 실어 온 후보**로
 * 만들어지고(getOtherExecutionsForCase), 그 조회는 「화면이 이미 그리고 있는
 * 실행」을 하나 빼고 읽는다(excludeExecutionId). 그래서 자리를 옮기는 결정과
 * 빼기 결정은 **반드시 같은 답**이어야 한다:
 *
 *   - 위에 선다   → 아래 줄에서는 뺀다(같은 것이 두 번 뜨면 안 된다)
 *   - 아래로 내려간다 → 빼지 않는다(안 그러면 화면 어디에도 안 뜬다)
 *
 * 둘을 각자 if 로 적으면 한쪽만 고치는 날이 오고, 그 결과는 「같은 절차가 두 번」
 * 아니면 「마친 절차가 통째로 사라짐」이다. 둘 다 오류 없이 화면에서만 드러난다.
 * 그래서 **답 하나에 둘을 함께 담아** 돌려준다 — 화면도 페이지도 이 값을 따를 뿐
 * 「마쳤는가」로 다시 갈라지지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 참·거짓이 아니라 **까닭**을 돌려준다
 * ──────────────────────────────────────────────────────────────────────
 * pickCurrentTask · buildExecutionListFold 와 같은 규약이다. 「위에 안 선다」만
 * 돌려주면 시험이 그 사실까지만 재고 **왜 안 서는지**(마쳐서인지, 실행이 아예
 * 없어서인지)는 못 잰다. 둘은 화면이 그려야 하는 것이 전혀 다르다 — 마친 실행은
 * 아래 묶음에 줄이 생기고, 실행이 없으면 생길 줄도 없다.
 */

export type ExecutionSummarySlot =
  /** 화면 맨 위(불러오기 카드 아래). 아직 도는 실행이 여기 선다. */
  | "TOP"
  /** 「이 건의 다른 절차」 묶음 안의 한 줄. 마친 실행이 여기로 내려간다. */
  | "OTHER_RUNS"
  /** 그릴 상자가 없다 — 이 건에 화면에 세울 실행이 아예 없다. */
  | "NONE";

export type ExecutionSummaryPlacementReason = "RUNNING" | "FINISHED" | "NO_EXECUTION";

export type ExecutionSummaryPlacement = {
  slot: ExecutionSummarySlot;
  reason: ExecutionSummaryPlacementReason;
  /**
   * 「이 건의 다른 절차」를 읽을 때 **빼야 하는 실행 id**. 뺄 것이 없으면 null.
   *
   * 🔴 이 칸과 slot 은 한 몸이다 — `slot === "TOP"` 일 때만, 그리고 그때는 반드시
   * 값이 찬다. 상자가 위에 서 있으면 아래 줄에서 빼야 두 번 안 뜨고, 안 서 있으면
   * 빼지 말아야 화면에 한 번은 뜬다.
   */
  excludedFromOtherRuns: string | null;
};

/**
 * 진행 요약 상자의 자리와, 그에 맞물린 **빼기 대상**을 한 번에 정한다.
 *
 * `execution` 에는 화면에 세울 실행 하나를 준다(getActiveExecutionForCase 가 고른
 * 그것). 없으면 null — 그만둔 뒤의 화면이 그 모습이다.
 *
 * 🔴 「마쳤는가」를 여기서 다시 판정하지 않는다. 큰 카드(pickCurrentTask)·아래
 * 목록(buildExecutionListFold)과 **같은 사실 한 줄**(isExecutionFinished)을 받아야
 * 넷이 함께 움직인다. completedAt 을 직접 받으면 호출하는 쪽마다 `!== null` 을 또
 * 적게 되고, 그것이 「사실 한 줄」 규약을 깨는 첫걸음이다.
 */
export function placeExecutionSummary(
  execution: { executionId: string; isExecutionFinished: boolean } | null
): ExecutionSummaryPlacement {
  if (execution === null) {
    // 뺄 것이 없다. 이 건의 실행이 **전부** 아래 묶음의 재료가 된다 — 그만둔
    // 실행만 남은 화면에서 그 줄들이 유일한 자국이다.
    return { slot: "NONE", reason: "NO_EXECUTION", excludedFromOtherRuns: null };
  }
  if (execution.isExecutionFinished) {
    // 마친 실행은 위에 안 선다. 대신 아래 묶음이 배지(완주 · 중단 마침)와 진행도,
    // 마친 시각을 한 줄로 적는다 — 상자가 말하던 것과 같은 내용이다.
    return { slot: "OTHER_RUNS", reason: "FINISHED", excludedFromOtherRuns: null };
  }
  return { slot: "TOP", reason: "RUNNING", excludedFromOtherRuns: execution.executionId };
}
