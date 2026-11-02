/**
 * 실행 하나를 **끝내거나 그만둘** 때의 판정. 순수 함수만 — DOM 도 React 도 DB 도
 * 건드리지 않는다(procedure-execution-focus.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가 — 들어온 절차를 **내보낼 길이 없었다**
 * ──────────────────────────────────────────────────────────────────────
 * 실행 화면의 단추는 노드마다 [시작][완료][건너뛰기][차단] 넷뿐이었다. 그래서
 *
 *  - 잘못 불러온 절차를 **치울 수 없었다.** 한 접수 건에 FULL_SERVICE 실행은
 *    하나뿐이라, 한 번 잘못 고르면 그 건에서는 바꿀 길이 아예 없었다. 그래서
 *    사람이 시험 삼아 눌러 보기를 무서워했다 — 화면을 못 믿게 만드는 종류의
 *    결핍이다.
 *  - 다 해도 **끝나지 않았다.** 노드를 전부 완료하면 100% 가 될 뿐, 「끝났다」는
 *    신호도 단추도 없이 화면이 영원히 그대로였다. procedure_case_executions 의
 *    completed_at 칸은 만들어 두고 한 번도 채운 적이 없었다(스키마 주석에
 *    「5A 에는 완료 기능이 없다」고 적혀 있다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 「남은 것이 있는데 끝낸다」를 **참·거짓 하나로 돌려주지 않는다**
 * ──────────────────────────────────────────────────────────────────────
 * 끝내기는 남은 노드가 있어도 할 수 있어야 한다 — 실측한 절차는 판단이 8할이라
 * 길이 갈리고, 안 가는 길의 노드는 **영원히 대기로 남는다**(22장 중 열 몇 장이
 * 그렇다). 그것들을 다 처리해야만 끝낼 수 있게 하면 아무도 못 끝낸다.
 *
 * 그래서 남은 것이 있으면 **묻고** 끝낸다. 그런데 「물었는가」를 화면만 알고
 * 있으면, 화면을 거치지 않는 호출(오래된 탭 · 직접 호출)이 아무것도 안 묻고
 * 끝내 버린다. 그래서 세는 자리를 여기 하나로 두고 **화면과 서버가 같은 함수를
 * 본다** — 화면은 이 글자를 그대로 확인 창에 띄우고, 서버는 「확인했다」를 받지
 * 못하면 같은 판정으로 거절한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇을 「남은 것」으로 세는가
 * ──────────────────────────────────────────────────────────────────────
 * 대기 · 진행 중 · 차단됨 — **아래 목록의 「전체 단계 보기」와 똑같은 셈**이다
 * (procedure-execution-list-fold.ts). 두 자리가 다른 잣대로 세면 「전체 단계
 * 보기 (17)」을 보면서 확인 창에서는 「15개 남았습니다」를 읽게 된다.
 *
 * 차단됨 수를 따로 적는 까닭: 차단은 사람이 사유를 적어 막아 둔 것이라 「아직
 * 안 한 일」과 뜻이 다르다. 끝내기 직전은 막아 둔 것이 아직 막혀 있다는 사실을
 * 마지막으로 알릴 자리다.
 */

import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

export type ExecutionFinishCandidate = { status: ProcedureCaseExecutionNodeStatus };

export type ExecutionFinishAssessment = {
  /** 아직 안 끝난 것 = 대기 + 진행 중 + 차단됨. */
  remainingCount: number;
  /** 그중 사람이 사유를 적어 막아 둔 것. 0 이면 확인 문구에 안 적는다. */
  blockedCount: number;
  /**
   * 끝내기 전에 사람에게 **물어야 하는가**. 남은 것이 하나라도 있으면 묻는다.
   *
   * 🔴 서버도 이 값을 본다 — 화면만 보면 묻지 않고 끝내는 길이 남는다.
   */
  needsConfirmation: boolean;
  /**
   * 확인 창에 **그대로** 뜨는 글자. 물을 것이 없으면 null —
   * 받는 쪽이 「이 경우를 처리하라」고 타입이 강제한다.
   */
  confirmationMessage: string | null;
};

/**
 * 지금 이 실행을 끝내면 무엇이 남는가.
 *
 * `nodes` 에는 화면이 네 구역을 만들 때 쓰는 **그 배열을 그대로** 준다
 * (executionDetail.nodes). 걸러서 주면 확인 창의 수가 화면과 어긋난다.
 */
export function assessExecutionFinish(nodes: readonly ExecutionFinishCandidate[]): ExecutionFinishAssessment {
  const countOf = (status: ProcedureCaseExecutionNodeStatus) => nodes.filter((n) => n.status === status).length;

  const blockedCount = countOf("BLOCKED");
  const remainingCount = countOf("PENDING") + countOf("IN_PROGRESS") + blockedCount;

  return {
    remainingCount,
    blockedCount,
    needsConfirmation: remainingCount > 0,
    confirmationMessage:
      remainingCount === 0
        ? null
        : `아직 끝내지 않은 작업이 ${remainingCount}개 있습니다` +
          (blockedCount > 0 ? `(그중 차단됨 ${blockedCount}개)` : "") +
          ". 그래도 이 절차를 끝낼까요?",
  };
}
