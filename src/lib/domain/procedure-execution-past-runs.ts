/**
 * 한 수리 건에서 **큰 카드에 못 선 다른 절차 실행들**을 한 줄씩 적는다. 순수
 * 함수만 — DOM 도 React 도 DB 도 건드리지 않는다(procedure-execution-focus.ts 와
 * 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가 — 돌린 절차가 화면 어디에도 안 남았다
 * ──────────────────────────────────────────────────────────────────────
 * 2026-11-02 에 끝내기·그만두기 두 단추가 생겼는데(조각 5), 누른 뒤에 그 실행을
 * 다시 볼 자리가 없었다.
 *
 *  - **그만둔 실행은 통째로 사라진다.** 소프트 삭제 네 칸을 채우고
 *    getActiveExecutionForCase 가 is_deleted 로 거르므로, 화면에는 「+ 기술 절차
 *    불러오기」만 다시 설 뿐 「아까 그 절차를 어디까지 했는지」는 아무 데도 안
 *    적힌다.
 *  - **마친 실행도 가려진다.** 끝낸 뒤 다른 절차를 불러오면 조회가 **하나만**
 *    돌려주므로(안 끝난 것 먼저) 아까 마친 절차가 화면에서 밀려난다.
 *  - 🔴 **아직 도는 실행도 가려진다.** 기술 작업(TECHNICAL_TASK) 절차는 한 건에
 *    여럿을 나란히 돌릴 수 있는데(유니크 색인은 FULL_SERVICE 에만 걸린다),
 *    큰 카드는 하나뿐이라 둘째부터는 **「불러왔는데 사라졌다」**로 보인다.
 *    절차를 둘 불러오는 순간 바로 드러나는 종류다.
 *
 * 그래서 사용자의 말 그대로 — 「어떤 기술절차를 어디까지 진행했고, 끝까지
 * 진행하고 마친 건지 임의로 마친 건지, 실행을 그만둔 건지」를 배지로 적고,
 * 거기에 「아직 돌고 있는데 화면에 못 선 것」을 한 갈래 더 둔다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 배지 넷 — 참·거짓이 아니라 **까닭**을 돌려준다
 * ──────────────────────────────────────────────────────────────────────
 *   완주      … 마쳤고(completed_at) 남은 노드가 0
 *   중단 마침 … 마쳤는데 남은 노드가 있다
 *   그만둠    … is_deleted
 *   진행 중   … 마치지도 그만두지도 않았다(위 셋 어디에도 안 걸린 나머지)
 *
 * 🔵 **「중단 마침」은 나무람이 아니다.** 실측한 절차는 판단이 8할이라 길이
 * 갈리고, 안 가는 길의 노드는 영원히 대기로 남는다(22장 중 열몇 장이 그렇다).
 * 사람이 「여기까지가 이 건에 필요한 전부」라고 판단해서 끝낸 것이므로 경고색
 * (빨강)을 쓰지 않는다 — 색 이름은 여기 안 적고 tone 만 정한다(아래).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **마친 것과 그만둔 것이 둘 다 찬 행**은 「그만둠」으로 읽는다
 * ──────────────────────────────────────────────────────────────────────
 * 그만두기는 completed_at 을 안 건드리므로 「그만두면서 마치는」 길은 없다.
 * 그런데 **마친 뒤에 그만두는** 길은 **일부러 열어 뒀다** —
 * abandonProcedureExecution 의 주석 그대로 「잘못 끝냈을 때 되돌릴 길이 그것뿐」
 * 이라(「다시 열기」는 없다), 끝낸 실행도 그만둘 수 있다. 그러니 둘 다 찬 행은
 * 드문 자료가 아니라 **되돌린 자국**이다.
 *
 * 그래서 그만둠이 이긴다 — 사람이 **나중에** 내린 판단이 그것이고(시각으로도
 * deleted_at 이 completed_at 보다 뒤다), 그 행은 지금 「도는 것」에서 빠져 있다는
 * 사실이 「마쳤다」보다 중요하다. 아래 if 의 순서가 이 결정을 담고 있어서 누가
 * 뒤집어도 조용히 안 달라지도록 시험이 못 박는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 「남은 노드」를 **여기서 다시 세지 않는다**
 * ──────────────────────────────────────────────────────────────────────
 * assessExecutionFinish(조각 5)를 그대로 부른다. 같은 잣대를 베껴 적으면 —
 * 대기 + 진행 중 + 차단됨 — 한쪽만 고치는 날이 오고, 「전체 단계 보기 (17)」을
 * 보면서 배지는 「완주」인 화면이 된다. 부르면 어긋날 길이 아예 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 여기 **안 담는 것은 하나뿐** — 큰 카드에 선 실행
 * ──────────────────────────────────────────────────────────────────────
 * 그 한 줄은 조회가 뺀다(getOtherExecutionsForCase 의 excludeExecutionId). 그래서
 * 같은 실행이 큰 카드와 아래 줄에 두 번 뜨는 일이 없고, **이 건의 나머지 실행은
 * 상태가 무엇이든 한 줄씩 다 뜬다.**
 *
 * 처음 판(2026-11-02 오전)은 「마쳤거나 그만둔 것」만 담고 도는 실행은 뺐다 —
 * 사용자의 말이 「[절차 마치기]든가 [실행 그만두기]를 했던」이었기 때문이다.
 * 같은 날 되돌렸다: 그러면 둘째로 불러온 기술 작업 절차가 **화면 어디에도 안
 * 떠서**, 고치려던 「사라졌다」가 그대로 남는다.
 */

import { assessExecutionFinish } from "./procedure-execution-lifecycle";
import { formatProcedureTemplateTitle } from "./procedure-template-title";
import type { ExecutionFoldGroup, ExecutionFoldNote } from "./procedure-execution-list-fold";
import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

export type PastExecutionOutcome = "COMPLETED_ALL" | "FINISHED_WITH_REMAINING" | "ABANDONED" | "STILL_RUNNING";

export type PastExecutionBadge = {
  outcome: PastExecutionOutcome;
  /** 배지에 그대로 뜨는 글자. */
  label: string;
  /**
   * SUCCESS 는 「끝까지 갔다」, INFO 는 「사람이 판단해서 끊었다」, MUTED 는
   * 「치운 것」, ACTIVE 는 「아직 살아 있다」. 🔴 색 이름을 여기 적지 않는 까닭은
   * 이 파일이 화면을 모르기 때문이다 — ExecutionFoldNote.tone 과 같은 규약이다.
   * 어떤 색인지는 컴포넌트가 정하고, **넷 중 어느 것도 경고색(빨강·호박)이
   * 아니다.**
   */
  tone: "SUCCESS" | "INFO" | "MUTED" | "ACTIVE";
};

/**
 * 실행 한 건의 **날것**. 어느 배지로 그릴지는 이 파일이 정하므로(후보) 조회는
 * 상태로 거르지 않고 그대로 실어 보낸다 — 판정을 조회와 도메인 두 곳에서 하면
 * 한쪽만 고치는 날이 온다.
 */
export type PastExecutionCandidate = {
  executionId: string;
  templateName: string;
  templateCode: string;
  /**
   * 🔴 **사람이 할 일 노드만** 담는다 — START 는 빼고 준다(참고 문서는 애초에
   * 실행 행이 생기지 않는다). getExecutionDetail 이 목록·번호·요약에 쓰는 것과
   * 같은 잣대라야 진행도의 분모가 화면의 「전체 N」과 같아진다.
   */
  nodes: readonly { status: ProcedureCaseExecutionNodeStatus }[];
  startedAt: string;
  startedByName: string | null;
  completedAt: string | null;
  /**
   * 실행 **행 자신의** 낙관적 동시성 토큰(노드마다 따로 있는 version 과 다른 값).
   * 줄에 붙는 [실행 그만두기]가 expectedVersion 으로 그대로 넘긴다 — 🔴 줄마다
   * 제 것이어야 한다(2026-11-02, 조각 8 보완).
   */
  version: number;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedByName: string | null;
  deleteReason: string | null;
};

/**
 * 이 줄을 **그만둘 수 없는** 까닭. 그만둘 수 있으면 null.
 *
 * 🔴 참·거짓이 아니라 까닭이다 — 「왜 이 줄에만 단추가 없지」를 화면도 시험도
 * 물을 수 있어야 한다. 둘이 서로 다른 까닭이라 한 값으로 뭉치지 않는다.
 */
export type PastExecutionAbandonBlockedReason =
  /** 이미 그만둔 실행이다. 서버도 그 실행의 노드 수정을 아예 거절한다. */
  | "ALREADY_ABANDONED"
  /**
   * 끝까지 다 한 기록이다(완주). 🔵 **치울 이유가 없다** — 그만두기는 「잘못
   * 불러왔거나 이 절차를 안 쓰게 됐을 때 치우는」 길인데(단추의 title 그대로),
   * 완주한 절차는 그 어느 쪽도 아니다. 2026-11-02 사용자 결정.
   */
  | "COMPLETED_ALL";

export type PastExecutionRow = {
  executionId: string;
  badge: PastExecutionBadge;
  /** 절차 이름. 코드가 이름과 **다를 때만** 괄호로 덧붙는다(formatProcedureTemplateTitle). */
  title: string;
  /** 「진행 3 / 22」 — 분모는 사람이 할 일 수다. */
  progressLabel: string;
  doneCount: number;
  remainingCount: number;
  totalCount: number;
  /**
   * 이 줄이 적는 **한 시각**(ISO). 끝난 것이면 끝난 때(마친 때 또는 그만둔 때),
   * 아직 도는 것이면 **시작한 때**다 — 끝난 때가 없으니 적을 것이 그것뿐이다.
   * 무엇의 시각인지는 바로 아래 whenNote 가 말한다. 날짜 모양은 화면이 정한다.
   */
  whenAt: string;
  /** 위 시각 뒤에 그대로 붙는 글자. 아는 만큼만 적는다(아래 까닭). */
  whenNote: string;
  /**
   * 「최희만님이 시작」. 이름을 모르면 null — 그때는 아무것도 안 그린다.
   * 🔵 **도는 줄에서는 언제나 null** 이다 — 그쪽은 whenNote 가 이미 시작한
   * 사람을 적고 있어서, 두면 같은 말이 한 줄에 두 번 뜬다.
   */
  startedNote: string | null;
  /** 그만둔 사유. 그만둔 것이 아니면 null. */
  abandonReason: string | null;
  /** 이 줄의 실행 행 version — [실행 그만두기]가 그대로 넘긴다. */
  version: number;
  /**
   * 🔴 이 줄에 [실행 그만두기]를 붙일 수 있는가 — 못 붙이면 **까닭**(위 타입).
   * 가르는 규칙은 아래 resolveAbandonBlockedReason 한 곳에 있다.
   */
  abandonBlockedReason: PastExecutionAbandonBlockedReason | null;
};

export type PastExecutionPanel = {
  /** 아래 목록과 **같은 그릇**(ExecutionFoldSection)에 담긴다. */
  fold: ExecutionFoldGroup;
  rows: PastExecutionRow[];
};

/**
 * 이 실행을 어느 배지로 그리는가.
 *
 * 🔴 if 의 **순서가 결정**이다 — 그만둠(is_deleted) → 마침(completed_at) →
 * 그 밖은 진행 중. 첫 줄의 까닭은 위 머리말의 「둘 다 찬 자료」 절에 있다.
 *
 * 🔵 **거르는 답이 없다.** 네 갈래가 실행의 모든 상태를 덮으므로 「담을까 말까」를
 * 여기서 가르지 않는다 — 큰 카드에 선 한 줄만 조회가 빼고, 나머지는 전부 뜬다.
 */
export function classifyPastExecution(
  candidate: Pick<PastExecutionCandidate, "nodes" | "completedAt" | "isDeleted">
): PastExecutionBadge {
  if (candidate.isDeleted) {
    return { outcome: "ABANDONED", label: "그만둠", tone: "MUTED" };
  }
  if (candidate.completedAt === null) {
    // 마치지도 그만두지도 않았다 — 아직 살아 있는데 큰 카드에 못 선 실행이다.
    return { outcome: "STILL_RUNNING", label: "진행 중", tone: "ACTIVE" };
  }
  // 🔴 세는 자리는 조각 4·5 와 **같은 함수** 하나다. 대기 + 진행 중 + 차단됨.
  const { remainingCount } = assessExecutionFinish(candidate.nodes);
  return remainingCount === 0
    ? { outcome: "COMPLETED_ALL", label: "완주", tone: "SUCCESS" }
    : { outcome: "FINISHED_WITH_REMAINING", label: "중단 마침", tone: "INFO" };
}

/**
 * 이 줄에 [실행 그만두기]를 붙일 수 있는가 — 못 붙이면 **까닭**을 돌려준다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 줄마다 붙는가 · 왜 **배지로** 가르는가
 * ──────────────────────────────────────────────────────────────────────
 * 사용자가 눈으로 보고 정했다(2026-11-02) — 「[실행 그만두기]가 [중단 마침]인
 * 해당 건에 대한 [실행 그만두기]인지 모든 [중단 마침]에 대한 그만두기인지
 * 모르겠어. [중단 마침] 건별로 [실행 그만두기]가 있도록 해주고.」 그래서 단추가
 * **줄마다** 붙고, 어느 줄에 붙일지는 화면이 다시 가르지 않고 여기서 정한다.
 *
 * 🔴 **붙는 것은 둘뿐이다 — 중단 마침 · 진행 중**(2026-11-02 사용자 결정):
 *
 *   완주      … 🔴 **안 붙는다.** 끝까지 다 한 기록이라 치울 이유가 없다.
 *                그만두기는 「잘못 불러왔거나 이 절차를 안 쓰게 됐을 때 치우는」
 *                길인데(단추의 title 그대로), 완주한 절차는 그 어느 쪽도 아니다.
 *   중단 마침 … ✅ 붙는다. 「여기까지가 이 건에 필요한 전부」로 끊은 것이라,
 *                애초에 잘못 불러온 것이었을 수 있다.
 *   진행 중   … ✅ 붙는다. 큰 카드에 못 선 둘째 절차가 여기 있고, 잘못 불러온
 *                것을 치울 길이 이 줄뿐이다.
 *   그만둠    … 🔴 안 붙는다. 이미 치운 것이다.
 *
 * `isDeleted`·`completedAt` 을 직접 보지 않고 **배지의 갈래**로 가르는 까닭:
 * 「마친 뒤에 그만둔 행」처럼 두 칸이 다 찬 자료에서 배지와 단추가 따로 놀면
 * 안 된다(그 행은 그만둠이 이긴다 — 위 머리말). 배지 하나를 따르면 어긋날 길이
 * 없다.
 *
 * 🔵 **서버가 막는 것이 아니다.** 완주한 실행도 서버는 그만둘 수 있게 열어 두고
 * 있다(loadExecutionNodeOrFail 의 「끝낸 실행은 막지 않는다」). 여기서 안 그리는
 * 것은 **화면에 쓸모없는 단추를 안 두려는** 것이고, 되돌려야 하는 날이 오면
 * 이 함수 한 줄이 그 결정 자리다.
 */
export function resolveAbandonBlockedReason(badge: PastExecutionBadge): PastExecutionAbandonBlockedReason | null {
  if (badge.outcome === "ABANDONED") return "ALREADY_ABANDONED";
  if (badge.outcome === "COMPLETED_ALL") return "COMPLETED_ALL";
  // 남는 둘 — 중단 마침(FINISHED_WITH_REMAINING) · 진행 중(STILL_RUNNING).
  return null;
}

/**
 * 시각 옆에 적을 한 마디. **아는 만큼만** 적는다.
 *
 * 🔴 마친 사람은 **적을 수가 없다.** procedure_case_executions 에 completed_by
 * 칸이 없고 이력표에도 실행 완료에 해당하는 action 값이 없다(Phase 5A 에서 일부러
 * 뺐다 — finishProcedureExecution 의 ⚠️ 주석). 그래서 시작한 사람을 빌려 적지
 * 않는다. 빌려 적으면 「이 사람이 마쳤다」로 읽히는데 그것은 사실이 아니다.
 * 시작한 사람은 startedNote 로 따로, 「시작」이라고 밝혀서 적는다.
 *
 * 🔵 도는 줄은 반대다 — 그 줄이 적는 시각이 **시작한 때**라, 여기에 바로
 * 「…님이 시작」을 적고 startedNote 를 비운다.
 */
function buildWhenNote(badge: PastExecutionBadge, candidate: PastExecutionCandidate): string {
  const withName = (name: string | null, word: string) => (name ? `${name}님이 ${word}` : word);
  if (badge.outcome === "ABANDONED") return withName(candidate.deletedByName, "그만둠");
  if (badge.outcome === "STILL_RUNNING") return withName(candidate.startedByName, "시작");
  return "마침";
}

/**
 * 접힌 줄에 적는 **갈래별 수**. 「완주 1 · 중단 마침 1 · 그만둠 2」.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 전부 적는가
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 「진행 중 N」 하나만 적었다. 사용자가 눈으로 보고 정했다(2026-11-02) —
 * 「[이 건의 다른 절차]가 접혀 있을 때 완주 몇 중단 마침 몇, 그만둠 몇을 적어줘.」
 * 묶음이 **접힌 채가 기본**이라, 펼치지 않고도 이 건에서 무엇이 어떻게 끝났는지
 * 알 수 있어야 한다.
 *
 * 🔵 **한 딱지에 묶어** 적는다 — 「실행 이력」의 「완료 4 · 건너뜀 1」과 **똑같은
 * 모양**(같은 가름표 ` · `, 같은 tone). 두 묶음이 다른 모양이면 읽는 사람이 둘을
 * 다른 것으로 본다.
 *
 * 🔵 「진행 중」만 따로 떼어 눈에 띄게 둘 수도 있었는데(성격이 다르다 — 지금 손댈
 * 수 있는 것이다), **같은 딱지 안에 두되 맨 앞에** 적는 것으로 갈음했다. 위
 * 「같은 모양으로」가 더 센 요구이고, 맨 앞 자리는 **줄 차례와도 같다**(도는 것이
 * 맨 위에 온다) — 딱지를 읽은 차례대로 줄이 서 있는 셈이라 둘이 서로를 설명한다.
 *
 * 🔴 **0 은 안 적는다**(「전체 단계 보기」의 차단됨 · 「실행 이력」의 건너뜀과 같은
 * 규약) — 「완주 0」은 읽을 가치가 없다.
 *
 * 🔴 **딱지 수의 합은 괄호 안 수와 같아야 한다.** 그래서 세는 자리가 rows 하나다 —
 * 줄에서 세지 않고 후보에서 따로 세면 갈래 하나를 빠뜨렸을 때 조용히 어긋난다.
 * 갈래가 늘어나는 날에는 아래 Record 가 **컴파일 오류**로 알려 준다.
 *
 * 🔵 딱지에 적는 낱말은 **그 줄의 배지에서 그대로** 가져온다(badge.label) — 여기
 * 다시 적으면 배지는 「중단 마침」인데 딱지는 옛 낱말인 날이 온다.
 */
const NOTE_OUTCOME_ORDER: Record<PastExecutionOutcome, number> = {
  // 지금 손댈 수 있는 것이 맨 앞. 줄 차례(도는 것이 맨 위)와 같은 잣대다.
  STILL_RUNNING: 0,
  COMPLETED_ALL: 1,
  FINISHED_WITH_REMAINING: 2,
  ABANDONED: 3,
};

function buildOutcomeNote(rows: readonly PastExecutionRow[]): ExecutionFoldNote | null {
  const countByOutcome = new Map<PastExecutionOutcome, { label: string; count: number }>();
  for (const row of rows) {
    const seen = countByOutcome.get(row.badge.outcome);
    if (seen) seen.count += 1;
    else countByOutcome.set(row.badge.outcome, { label: row.badge.label, count: 1 });
  }
  if (countByOutcome.size === 0) return null;

  const text = [...countByOutcome.entries()]
    .sort(([a], [b]) => NOTE_OUTCOME_ORDER[a] - NOTE_OUTCOME_ORDER[b])
    .map(([, { label, count }]) => `${label} ${count}`)
    .join(" · ");
  return { text, tone: "MUTED" };
}

/**
 * 「이 건의 다른 절차」 묶음 한 덩이를 통째로 만든다 — 담을 줄이 **한 줄도 없으면
 * null**.
 *
 * 🔴 null 로 돌려주는 까닭은 조각 4 와 같다 — 「이 건의 다른 절차 (0)」이라는 틀린
 * 글자가 값 안에 남으면 그것을 안 본 사람이 그대로 그린다. 화면이 머릿수를 다시
 * 세지 않도록 판정은 여기서 끝낸다.
 */
export function buildPastExecutionPanel(candidates: readonly PastExecutionCandidate[]): PastExecutionPanel | null {
  const rows: PastExecutionRow[] = [];

  for (const candidate of candidates) {
    const badge = classifyPastExecution(candidate);

    const { remainingCount } = assessExecutionFinish(candidate.nodes);
    const totalCount = candidate.nodes.length;
    // 끝낸 수 = 전체 - 남은 것. 🔵 완료와 건너뜀을 따로 세지 않는다 — 요약 카드의
    // 퍼센트(= (완료+건너뜀)/전체)와 **같은 자**여야 같은 실행에서 두 수가 안
    // 엇갈린다. 건너뜀은 「안 한 일」이지만 **지나온 것**은 맞다.
    const doneCount = totalCount - remainingCount;

    // 이 줄이 적는 한 시각. 도는 줄은 시작한 때다 — 끝난 때가 없다.
    //
    // 🔵 그만둔 행에 deleted_at 이 비어 있으면(소프트 삭제 네 칸을 반만 채운 옛
    // 자료) 적을 시각이 없다. 그때는 마친 때, 그것도 없으면 시작한 때로 내려간다
    // — 차례를 정하는 열쇠이기도 해서 비워 둘 수 없다. 마친 줄의 `?? startedAt`
    // 은 닿지 않는 가지다(completed_at 이 비면 위에서 진행 중으로 갈렸다) —
    // 타입이 string | null 이라 적어 둘 뿐이다.
    const whenAt =
      badge.outcome === "ABANDONED"
        ? (candidate.deletedAt ?? candidate.completedAt ?? candidate.startedAt)
        : badge.outcome === "STILL_RUNNING"
          ? candidate.startedAt
          : (candidate.completedAt ?? candidate.startedAt);

    rows.push({
      executionId: candidate.executionId,
      badge,
      title: formatProcedureTemplateTitle(candidate.templateName, candidate.templateCode),
      progressLabel: `진행 ${doneCount} / ${totalCount}`,
      doneCount,
      remainingCount,
      totalCount,
      whenAt,
      whenNote: buildWhenNote(badge, candidate),
      // 🔵 도는 줄은 위 whenNote 가 이미 「…님이 시작」을 적었다 — 여기 또 적으면
      // 같은 말이 한 줄에 두 번 뜬다.
      startedNote:
        badge.outcome !== "STILL_RUNNING" && candidate.startedByName ? `${candidate.startedByName}님이 시작` : null,
      // 사유는 그만둔 줄에만 싣는다. 마친 줄에 delete_reason 이 남아 있을 리
      // 없지만, 「그만둠이 이긴다」로 갈린 행(둘 다 찬 자료)에서는 사유가 있는
      // 것이 정상이다.
      abandonReason: badge.outcome === "ABANDONED" ? candidate.deleteReason : null,
      version: candidate.version,
      // 🔴 붙는 줄은 둘뿐이다 — 중단 마침 · 진행 중. 가르는 규칙은 위 함수 하나에
      // 있고, 여기서는 배지를 그대로 넘길 뿐이다.
      abandonBlockedReason: resolveAbandonBlockedReason(badge),
    });
  }

  if (rows.length === 0) return null;

  // 🔴 **아직 도는 것이 맨 위**다. 이 줄들이 생긴 까닭의 절반이 「불러왔는데
  // 사라졌다」를 막는 것인데, 그것이 끝난 줄들 아래로 내려가면 목적이 반감된다.
  // getActiveExecutionForCase 의 차례 규칙(안 끝난 것 먼저)과도 같은 잣대다.
  //
  // 🔵 그다음은 최근 것이 위로. 열쇠는 각 줄이 적는 시각(whenAt)이다 — 시작한
  // 차례로 늘어놓으면 오래전에 시작해서 방금 마친 절차가 맨 아래로 내려간다.
  // 같은 시각이면 id 로 가른다(DB 가 주는 차례에 기대지 않는다 — 그러면
  // 새로고침마다 줄이 자리를 바꾼다).
  const isRunning = (row: PastExecutionRow) => Number(row.badge.outcome === "STILL_RUNNING");
  rows.sort(
    (a, b) => isRunning(b) - isRunning(a) || b.whenAt.localeCompare(a.whenAt) || a.executionId.localeCompare(b.executionId)
  );

  return {
    fold: {
      // 🔵 「지나간 절차」가 아니다 — 아직 도는 줄이 섞이기 때문이다. 담는 것은
      // 「이 건의 실행 가운데 큰 카드에 못 선 것 전부」라, 제목도 그렇게 적는다.
      // 「지나간」으로 두면 [진행 중] 줄을 보는 사람이 「이게 왜 지나간 거지」를
      // 묻게 된다.
      summary: `이 건의 다른 절차 (${rows.length})`,
      count: rows.length,
      // 🔴 **펼치지 않는다.** 도는 줄이 섞여 있어도 그렇다 — 2026-11-02 에
      // 사용자가 「항상 닫혀 있는 상태를 기본으로」로 정했고(조각 4), 묶음마다
      // 예외를 두기 시작하면 접기가 다시 거의 안 듣는다.
      open: false,
      openReason: null,
      // 🔵 대신 **제목 줄에 적는다** — 접어 둔 채로도 알아야 할 사실은 펼치는
      // 것이 아니라 줄 머리에 적는 것으로 지킨다(ExecutionFoldSection 머리말).
      //
      // 🔵 tone 은 MUTED 다 — ATTENTION(호박색)은 「사람이 막아 둔 것」을 뜻하고,
      // 이 조각의 글자에는 경고색을 안 쓰기로 했다. 도는 실행은 고장이 아니다.
      note: buildOutcomeNote(rows),
    },
    rows,
  };
}
