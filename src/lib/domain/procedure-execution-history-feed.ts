/**
 * 「실행 이력」 묶음에 그리는 **시간순 목록**(2026-11-03, 조각 12). 순수 함수만 —
 * DOM 도 React 도 DB 도 건드리지 않는다(procedure-execution-jump.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가 (사용자 말 그대로, 2026-11-03)
 * ──────────────────────────────────────────────────────────────────────
 * 「[실행 이력]이 시간순서대로 누적될 수 있도록 해줘. 지금은 노드 번호대로
 *  정렬되어 있어.(이미 [완료]했던 노드에 다시 돌아오더라도 [실행 이력]이 남을 수
 *  있도록)」 · 「[시각 기록]을 없애줘.」
 *
 * 전에는 그 묶음 안에 둘이 있었다(조각 8):
 *   ① 「완료 / 건너뜀 (N)」 … **노드 행 하나당 카드 하나**라 노드 번호 차례였다.
 *   ② 「시각 기록 (N)」 … 이력 표를 시간순으로.
 *
 * 🔴 ①로는 「다시 돌아온 기록」을 **적을 자리가 없다.** 행이 하나뿐이라 두 번째
 * 방문이 첫 번째를 덮어쓴다. 그래서 묶음 전체를 **이력 표 한 벌**로 다시 세웠다 —
 * 줄마다 그때의 일을 적고, 같은 노드가 여러 줄로 나온다. 그것이 요구의 핵심이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 ①이 가지고 있던 것을 **하나도 안 버린다**
 * ──────────────────────────────────────────────────────────────────────
 * 끝난 노드 카드에는 넷이 있었다 — 작업 메모 · 최근 사유 · 시작/완료한 사람과
 * 시각 · [재개(되돌림)] 단추. 넷 다 **그 작업의 가장 최근 줄**에 붙여 둔다
 * (아래 footerNode). 줄마다 붙이지 않는 까닭은 한 노드에 줄이 여럿이기 때문이다 —
 * 실측(2026-11-03, 개발 DB)에서 한 노드에 11줄까지 붙어 있었다. 줄마다 단추를
 * 그리면 같은 작업을 되돌리는 단추가 열한 개 뜬다.
 *
 * 🔴 **끝났는데 이력 줄이 하나도 없는 노드**에는 줄을 **만들어 넣는다**(아래
 * SYNTHETIC). 그런 줄이 없으면 그 작업에는 [재개(되돌림)] 단추가 설 자리가
 * 아예 없어져, 되돌릴 길이 화면에서 사라진다. 실측으로는 START 표식 10개뿐이고
 * 그 줄은 애초에 화면에 안 나오지만(getExecutionDetail 이 뺀다), 「없을 리 없다」에
 * 기대어 단추를 지우지는 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 차례는 **최신이 위**다
 * ──────────────────────────────────────────────────────────────────────
 * getExecutionHistory 가 이미 그렇게 내려주고(desc(created_at)), 이 앱의 다른
 * 이력 화면(DatabaseWorkflowHistoryList · 절차 편집 이력)도 전부 최신이 위다.
 * 한 화면 안에서 이력의 차례가 자리마다 다르면 읽는 사람이 매번 다시 확인해야
 * 한다. 🔴 그래도 **여기서 한 번 더 정렬한다** — 만들어 넣은 줄(SYNTHETIC)이
 * 섞이므로 받은 차례를 그대로 믿을 수 없다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 길이 — 실측(2026-11-03, 개발 DB)
 * ──────────────────────────────────────────────────────────────────────
 * 가장 긴 실행이 **90줄**(노드 28개, 아직 도는 중)이고, 그 안에서 이력이 붙은
 * 노드 20개에 89줄이라 **노드당 평균 4.5줄**이다. 마친 실행 하나는 28노드에
 * 49줄. 옮기기 한 번이 1 + N 줄을 적으므로(조각 11) 길이는 앞으로도 는다.
 *
 * 그래서 **최근 50줄만 펼쳐 두고 나머지는 한 겹 더 접는다**(아래 RECENT_LIMIT).
 * 버리지 않는다 — 접기 한 번이면 전부 보인다. 묶음 자체도 접힌 채가 기본이라
 * (buildExecutionHistoryFold), 평소 화면이 이 목록 때문에 길어지지 않는다.
 */

import {
  procedureCaseExecutionActionTypeLabels,
  type ProcedureCaseExecutionActionType,
  type ProcedureCaseExecutionNodeStatus,
} from "./procedure-case-execution-types";
import { readJumpResetWorkMemo } from "./procedure-execution-jump";

/** 한 번에 펼쳐 두는 최근 줄 수. 나머지는 목록 안에서 한 겹 더 접힌다. */
export const HISTORY_FEED_RECENT_LIMIT = 50;

/**
 * 이력 한 줄(getExecutionHistory 가 돌려주는 모양). 조회 타입을 그대로 받지 않고
 * 좁혀 적는 까닭은 JumpCandidateNode 와 같다 — 조회 타입을 들이면 server-only
 * 사슬이 따라 들어와, 이 목록을 그려 보는 시험이 import 에서 바로 던진다.
 */
export type HistoryFeedHistoryRow = {
  id: string;
  executionNodeId: string | null;
  actionType: ProcedureCaseExecutionActionType;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  actorName: string;
  createdAt: string;
};

/**
 * 실행 노드 한 줄 — 줄에 **어느 작업인지**를 적고, 끝난 작업의 마지막 줄에
 * 카드가 가지고 있던 것을 붙이는 데 쓴다. ExecutionNodeDetail 이 이 모양을
 * 그대로 품고 있으므로 화면은 넘기기만 한다.
 */
export type HistoryFeedNode = {
  id: string;
  /** 1 부터 매긴 절차상 번호. 0 이면 번호가 없는 줄이다. */
  orderIndex: number;
  title: string;
  status: ProcedureCaseExecutionNodeStatus;
  /** 🔴 그 줄 **자신의** 낙관적 동시성 토큰 — 단추가 이것을 실어 보낸다. */
  version: number;
  workMemo: string | null;
  lastActionReason: string | null;
  effectiveAssigneeId: string | null;
  effectiveAssigneeName: string | null;
  startedByName: string | null;
  startedAt: string | null;
  completedByName: string | null;
  completedAt: string | null;
};

/**
 * 줄에 덧붙는 글. 🔴 **label 을 값에 담는** 까닭은 같은 종류의 글이 자리마다 다른
 * 이름으로 불리면 안 되기 때문이다 — 「되돌리면서 지운 작업 메모」는 조각 11 이
 * 정한 그 글자 그대로여야 한다.
 */
export type ExecutionHistoryFeedNote = {
  kind: "REASON" | "MEMO" | "CLEARED_MEMO";
  label: string;
  text: string;
};

export type ExecutionHistoryFeedRow = {
  /** 이력 줄 id. 만들어 넣은 줄은 `synthetic:<실행 노드 id>`. */
  id: string;
  /** 어느 작업인가. **실행 전체**에 대한 줄(실행 시작 등)이면 null. */
  task: { orderIndex: number; title: string } | null;
  /** 「작업 완료」 같은 행위 이름 — procedureCaseExecutionActionTypeLabels 그대로다. */
  actionLabel: string;
  /**
   * 같은 행위라도 **어떻게** 일어났는지가 다르면 한 마디를 적는다(옮기면서 함께
   * 완료 · 저절로 섬 · 다시 이음 …). 쓰기 쪽이 이미 afterState 에 표시를 남겨
   * 두었는데(조각 2·7·9·10·11), 읽는 쪽이 안 그리면 「작업 시작」이 까닭도 없이
   * 세 줄 뜬 것처럼 보인다. 없으면 null.
   */
  via: string | null;
  actorName: string;
  /** ISO 시각. 🔴 만들어 넣은 줄은 **시각을 모를 수 있다** — 그때는 null. */
  createdAt: string | null;
  notes: ExecutionHistoryFeedNote[];
  /**
   * 🔴 **끝난 작업(완료·건너뜀)의 가장 최근 줄에만** 실린다. 전에 끝난 노드
   * 카드가 가지고 있던 것 — 작업 메모 칸 · 담당/시작/완료/최근 사유 · [재개
   * (되돌림)] — 이 자리에 선다. 나머지 줄은 null 이다.
   */
  footerNode: HistoryFeedNode | null;
};

export type ExecutionHistoryFeed = {
  /** 🔴 그리는 줄 **전부**의 수 — 묶음 제목의 괄호 안이 이 수다. */
  totalCount: number;
  /** 바로 펼쳐 두는 최근 줄. */
  recent: ExecutionHistoryFeedRow[];
  /** 한 겹 더 접어 두는 나머지(더 오래된 것). 없으면 빈 배열. */
  older: ExecutionHistoryFeedRow[];
};

// ---- JSON 칸 읽기 ----

function readFlag(state: unknown, key: string): boolean {
  if (typeof state !== "object" || state === null) return false;
  return (state as Record<string, unknown>)[key] === true;
}

/**
 * 메모 칸(`{ memo }`)에서 글자를 꺼낸다. 비었거나 없으면 null — 빈 줄을 화면에
 * 세우지 않는다(readJumpResetWorkMemo 와 같은 규약).
 */
function readMemo(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const memo = (state as { memo?: unknown }).memo;
  if (typeof memo !== "string") return null;
  return memo.trim() === "" ? null : memo;
}

/**
 * 「어떻게 일어났는가」 한 마디. 🔴 쓰기 쪽이 적어 둔 **그 표시만** 본다 —
 * 이름만 보고 꺼내면 나중에 다른 자리가 같은 이름을 적는 날 엉뚱한 줄에 뜬다
 * (readJumpResetWorkMemo 의 같은 판단).
 */
function describeHistoryVia(row: HistoryFeedHistoryRow): string | null {
  if (row.actionType === "EXECUTION_STARTED" && readFlag(row.afterState, "resumed")) {
    return "마친 절차를 다시 이었습니다.";
  }
  if (row.actionType === "NODE_STARTED") {
    if (readFlag(row.afterState, "jumpedTo")) return "「전체 단계 보기」에서 이 작업으로 옮겨 왔습니다.";
    if (readFlag(row.afterState, "autoAdvanced")) return "앞 작업을 끝내서 저절로 섰습니다.";
    if (readFlag(row.afterState, "startedMidProcedure")) return "절차 중간부터 시작한 자리입니다.";
    return null;
  }
  if (row.actionType === "NODE_COMPLETED" && readFlag(row.afterState, "completedByJump")) {
    return "옮기면서 지나온 길이라 함께 완료됐습니다.";
  }
  if (row.actionType === "NODE_REOPENED" && readFlag(row.afterState, "reopenedByJump")) {
    return "옮기면서 경로 밖이 되어 대기로 되돌아갔습니다.";
  }
  // 🔵 메모를 **비운** 저장은 적을 글이 없어 줄이 통째로 비어 보인다. 무슨 일이
  //    있었는지를 한 마디로 적는다 — 「작업 메모 수정」만 뜨고 아무것도 없으면
  //    사람은 화면이 깨진 줄 안다.
  if (row.actionType === "NODE_MEMO_UPDATED" && readMemo(row.afterState) === null) {
    return "작업 메모를 비웠습니다.";
  }
  return null;
}

function notesOf(row: HistoryFeedHistoryRow): ExecutionHistoryFeedNote[] {
  const notes: ExecutionHistoryFeedNote[] = [];
  if (row.reason && row.reason.trim() !== "") {
    notes.push({ kind: "REASON", label: "사유", text: row.reason });
  }
  // 🔵 **그때 적은 글**이다(afterState). 고치기 전 값은 그 값을 적어 둔 **앞
  //    줄**에 이미 있으므로 여기서 또 적지 않는다 — 같은 글이 두 줄에 뜨면
  //    어느 것이 그때의 메모인지 안 갈린다.
  if (row.actionType === "NODE_MEMO_UPDATED") {
    const memo = readMemo(row.afterState);
    if (memo !== null) notes.push({ kind: "MEMO", label: "작업 메모", text: memo });
  }
  // 🔴 조각 11 이 더한 줄 — 되돌리면서 비운 작업 메모. 이 자리가 그 글의
  //    **마지막 집**이다(쓰기 쪽이 칸을 비우기 전에 옮겨 적는다).
  const cleared = readJumpResetWorkMemo(row.beforeState);
  if (cleared !== null) notes.push({ kind: "CLEARED_MEMO", label: "되돌리면서 지운 작업 메모", text: cleared });
  return notes;
}

// ---- 목록 만들기 ----

function isFinished(status: ProcedureCaseExecutionNodeStatus): boolean {
  return status === "COMPLETED" || status === "SKIPPED";
}

/**
 * 끝난 작업인데 이력 줄이 하나도 없을 때 **만들어 넣는** 줄. 실제로 일어난 일은
 * 그 줄의 지금 상태이고, 적을 수 있는 것은 노드 행에 남은 값뿐이다.
 *
 * 🔴 시각을 **지어내지 않는다** — 완료 시각이 없으면(건너뜀은 completed_at 을 안
 * 채운다) createdAt 은 null 이고 화면은 「시각 모름」이라고 적는다. 지금 시각을
 * 넣으면 방금 일어난 일처럼 목록 맨 위에 선다.
 */
function syntheticRow(node: HistoryFeedNode): ExecutionHistoryFeedRow {
  return {
    id: `synthetic:${node.id}`,
    task: { orderIndex: node.orderIndex, title: node.title },
    actionLabel:
      procedureCaseExecutionActionTypeLabels[node.status === "SKIPPED" ? "NODE_SKIPPED" : "NODE_COMPLETED"],
    via: "이 작업에는 이력 줄이 없어, 지금 남아 있는 값으로 그린 줄입니다.",
    actorName: node.completedByName ?? node.startedByName ?? "-",
    createdAt: node.completedAt,
    notes:
      node.lastActionReason && node.lastActionReason.trim() !== ""
        ? [{ kind: "REASON", label: "사유", text: node.lastActionReason }]
        : [],
    // 🔵 단추를 여기서 붙이지 않는다 — 「어느 줄에 붙는가」는 아래 한 곳이 정한다.
    footerNode: null,
  };
}

/**
 * 「실행 이력」 목록을 만든다 — **시간순(최신이 위)**, 같은 노드가 여러 줄.
 *
 * 🔴 `nodes` 는 화면이 쓰는 **그 배열 그대로**(executionDetail.nodes) 준다. 걸러서
 * 주면 줄에 적을 번호·제목을 못 찾고(「작업 이름 모름」이 된다), 끝난 작업의
 * 단추가 사라진다.
 */
export function buildExecutionHistoryFeed(input: {
  history: readonly HistoryFeedHistoryRow[];
  nodes: readonly HistoryFeedNode[];
  /** 바로 펼쳐 두는 줄 수. 시험이 작은 수로 바꿔 가며 잰다. */
  recentLimit?: number;
}): ExecutionHistoryFeed {
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]));

  // 🔵 줄과 **그 줄의 노드**를 짝으로 들고 다닌다. 아래에서 「이 작업의 가장 최근
  //    줄인가」를 가려야 하는데, 다 만든 뒤에 줄 id 로 노드를 다시 찾으면 이력이
  //    길어질수록 느려지고(실측 90줄) 찾는 규칙이 두 벌이 된다.
  const entries: { row: ExecutionHistoryFeedRow; node: HistoryFeedNode | null }[] = input.history.map((row) => {
    const node = row.executionNodeId === null ? null : (nodeById.get(row.executionNodeId) ?? null);
    return {
      node,
      row: {
        id: row.id,
        // 🔵 실행 노드 id 가 있는데 그 줄을 못 찾는 경우가 있다 — START 표식과
        //    참고 문서는 실행 행이 있어도 화면 목록에서 빠진다. 그때는 「이 실행」
        //    줄로 그린다(없는 번호를 지어내지 않는다).
        task: node === null ? null : { orderIndex: node.orderIndex, title: node.title },
        actionLabel: procedureCaseExecutionActionTypeLabels[row.actionType],
        via: describeHistoryVia(row),
        actorName: row.actorName,
        createdAt: row.createdAt,
        notes: notesOf(row),
        footerNode: null,
      },
    };
  });

  // 끝났는데 이력 줄이 한 줄도 없는 작업 — 단추가 설 자리를 만들어 준다(머리말).
  const nodeIdsWithRow = new Set(
    input.history.map((row) => row.executionNodeId).filter((id): id is string => id !== null)
  );
  for (const node of input.nodes) {
    if (!isFinished(node.status) || nodeIdsWithRow.has(node.id)) continue;
    entries.push({ node, row: syntheticRow(node) });
  }

  // 🔴 최신이 위. 시각을 모르는 줄은 **맨 아래**로 — 「모른다」를 「방금」으로
  //    읽으면 목록의 뜻이 통째로 바뀐다. 같은 시각은 받은 차례를 지킨다(정렬이
  //    안정적이라 조회가 정한 차례가 그대로 남는다).
  entries.sort((a, b) => {
    if (a.row.createdAt === b.row.createdAt) return 0;
    if (a.row.createdAt === null) return 1;
    if (b.row.createdAt === null) return -1;
    return a.row.createdAt < b.row.createdAt ? 1 : -1;
  });

  // 끝난 작업의 **가장 최근 줄**에 카드가 가지고 있던 것을 붙인다. 위에서부터
  // 훑으므로 먼저 만나는 줄이 곧 그 작업의 가장 최근 줄이다.
  const footerDone = new Set<string>();
  for (const entry of entries) {
    if (entry.node === null || !isFinished(entry.node.status) || footerDone.has(entry.node.id)) continue;
    entry.row.footerNode = entry.node;
    footerDone.add(entry.node.id);
  }

  const rows = entries.map((entry) => entry.row);
  const limit = Math.max(input.recentLimit ?? HISTORY_FEED_RECENT_LIMIT, 1);
  return { totalCount: rows.length, recent: rows.slice(0, limit), older: rows.slice(limit) };
}
