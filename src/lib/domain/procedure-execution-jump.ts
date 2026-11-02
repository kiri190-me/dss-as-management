/**
 * 「지금 할 일」을 **사람이 고른 노드로 옮기는** 판정(2026-11-02, 조각 10). 순수
 * 함수만 — DOM 도 React 도 DB 도 건드리지 않는다(procedure-execution-focus.ts ·
 * procedure-start-picker.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가 (사용자 말 그대로, 2026-11-02)
 * ──────────────────────────────────────────────────────────────────────
 * 「[전체 단계 보기]는 지금같은 형태 말고, 누르면 팝업으로 플로우차드로 보여지도록
 *  해주고, 노드를 선택하면 [지금 할 일]이 해당 노드의 작업으로 뛰어넘기 되도록
 *  해줘.」
 *
 * 전에는 자리를 옮기는 길이 큰 카드의 [시작]·[완료]·갈래 단추뿐이었다. 절차가
 * 그리다 만 상태면(실측 「원복 검사」는 노드 22개에 선이 7개) 자동 전진이 거의 안
 * 걸려서, 하고 싶은 작업까지 **한 장씩 완료를 눌러 내려가야** 했다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 옮기면 **진행 중은 고른 하나뿐**이 된다
 * ──────────────────────────────────────────────────────────────────────
 * 고른 노드를 진행 중으로 세우고, 같은 실행의 **다른 진행 중 노드는 대기로
 * 되돌린다.** 까닭은 「그래야 실제로 옮겨지기 때문」이다 — pickCurrentTask 는
 * 진행 중 가운데 **절차 차례가 앞선 것**을 고른다(procedure-execution-focus.ts).
 * 앞의 진행 중을 그대로 두면, 차례가 뒤인 노드로 옮겼을 때 「지금 할 일」이 그대로
 * 앞 노드에 남는다 — 사람 눈에는 **눌렀는데 아무 일도 안 일어난** 것이 된다.
 * 오류가 안 나는 종류라 더 나쁘다.
 *
 * 🔵 「하던 일이 없던 일」이 되지는 않는다. 되돌리는 것은 **status 한 칸**이고
 * started_at · started_by · 작업 메모는 그대로 남는다(쓰기 쪽의 backfill 규약 —
 * 비어 있을 때만 채운다). 다시 그 노드로 옮기면 하던 자리로 돌아온다.
 *
 * 🔵 조각 2 의 자동 전진이 「진행 중이 둘이어도 괜찮다」고 적어 둔 것과 어긋나지
 * 않는다. 그쪽은 **저절로 서는** 쪽이라 남의 진행 중을 건드릴 근거가 없고, 이쪽은
 * 사람이 「이제 이것을 한다」고 **직접 고른** 것이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔵 2026-11-02(조각 11)에 **자리가 상태를 정한다**
 * ──────────────────────────────────────────────────────────────────────
 * 옮기면 **시작점 → 고른 노드 최단 경로** 위는 완료가 되고, **그 길에 없는
 * 완료는 대기로 되돌아간다.** 어느 줄이 그 길 위인지는 이 파일이 안 정한다 —
 * 절차 그림을 걷는 일은 procedure-execution-path.ts 의 몫이고, 여기는 그 답을
 * 받아 **무엇을 건드리고 무엇을 그냥 두는지**만 정한다(아래 planNodeJump).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 완료 · 건너뜀 · 차단됨으로는 **못 옮긴다**
 * ──────────────────────────────────────────────────────────────────────
 * 셋 다 되살리는 길이 이미 따로 있고 — [재개(되돌림)] — 그 길이 요구하는 것을 이
 * 길이 건너뛰게 되기 때문이다:
 *
 *  - 완료 · 건너뜀을 되살리는 것은 **관리 수준(MANAGE)** 이다(reopenExecutionNode).
 *    옮기기를 허용하면 WRITE 만 가진 담당 엔지니어가 팝업에서 완료를 되돌릴 수
 *    있게 된다 — 화면 하나가 권한 한 칸을 조용히 넓히는 꼴이다.
 *  - 차단됨은 사람이 **사유를 적어** 막아 둔 것이다. 사유 없이 푸는 길을 내면
 *    막아 둔 뜻이 기록에서 사라진다.
 *
 * 그래서 걸리게는 하되(그림에도 뜨고 검색에도 걸린다) **왜 못 옮기는지**를 함께
 * 돌려준다 — 참·거짓이 아니라 까닭을 돌려주는 이 묶음의 규약(classifyStartNode 와
 * 같은 모양). 통째로 빼면 「내가 이름을 잘못 쳤나」가 된다.
 */

import {
  procedureCaseExecutionNodeStatusLabels,
  type ProcedureCaseExecutionNodeStatus,
} from "./procedure-case-execution-types";
import { flattenNodeTitle } from "./procedure-start-picker";

/** 검색 결과로 한 번에 그리는 최대 줄 수 — 고르는 창과 같은 값, 같은 까닭이다. */
export const JUMP_RESULT_LIMIT = 30;

/**
 * 옮길 수 있는지 가리는 데 쓰는 **한 노드**. ExecutionNodeDetail 을 그대로 받지
 * 않고 좁혀 적는 까닭은 흐름 띠(FlowStripNode)와 같다 — 조회 타입을 들이면
 * server-only 사슬이 따라 들어와, 이 판정을 쓰는 창을 그려 보는 시험이 import
 * 에서 바로 던진다. 넓은 것이 좁은 자리에 들어가는 것은 그대로 되므로 화면 쪽은
 * 아무것도 달라지지 않는다.
 */
export type JumpCandidateNode = {
  /** procedure_case_execution_nodes.id — 서버로 보내는 것이 이 값이다. */
  id: string;
  /** 절차 그림의 노드 id. 사례별 추가 작업은 null(그림에 자리가 없다). */
  procedureTemplateNodeId: string | null;
  /** 1 부터 매긴 절차상 번호. 0 이면 번호가 없는 줄이다. */
  orderIndex: number;
  title: string;
  status: ProcedureCaseExecutionNodeStatus;
  /**
   * 그 줄 **자신의** 낙관적 동시성 토큰. 🔴 창이 옮길 때 이것을 실어 보낸다 —
   * 한 벌을 돌려 쓰면 남의 version 으로 남의 줄을 건드리는 호출이 된다(「이 건의
   * 다른 절차」가 줄마다 제 version 을 싣게 된 것과 같은 까닭).
   */
  version: number;
};

// ---- 옮길 수 있는가 ----

/**
 * 못 옮기는 까닭. 화면이 할 말도, 서버가 돌려줄 코드도 각각 다르다.
 *
 *  - NOT_IN_EXECUTION  — 이 실행의 작업이 아니다(START · 참고 문서 · 남의 절차 노드).
 *  - ALREADY_FINISHED  — 완료 또는 건너뜀.
 *  - BLOCKED           — 사람이 사유를 적어 막아 둔 것.
 */
export type JumpRejectionReason = "NOT_IN_EXECUTION" | "ALREADY_FINISHED" | "BLOCKED";

export type JumpEligibility = { ok: true } | { ok: false; reason: JumpRejectionReason; message: string };

/**
 * `status` 가 null 이면 **그 실행에서 못 찾았다**는 뜻이다. 서버가 화면이 보낸
 * 실행 노드 id 를 되찾아 본 결과를 그대로 넣을 수 있게 한 모양 — 「못 찾음」을
 * 부르는 쪽마다 따로 적으면 화면과 서버의 말이 갈린다(classifyStartNode 와 같은
 * 규약).
 */
export function classifyJumpTarget(status: ProcedureCaseExecutionNodeStatus | null): JumpEligibility {
  if (status === null) {
    return { ok: false, reason: "NOT_IN_EXECUTION", message: "이 절차 그림의 칸 가운데 실행 항목이 없는 것입니다(시작 지점·참고 문서)." };
  }
  if (status === "COMPLETED" || status === "SKIPPED") {
    return {
      ok: false,
      reason: "ALREADY_FINISHED",
      message: "이미 끝난 작업입니다. 다시 하려면 「실행 이력」에서 그 작업의 [재개(되돌림)]를 쓰세요.",
    };
  }
  if (status === "BLOCKED") {
    return {
      ok: false,
      reason: "BLOCKED",
      message: "차단된 작업입니다. 「차단됨」에서 [재개(되돌림)]로 사유와 함께 풀어야 합니다.",
    };
  }
  return { ok: true };
}

// ---- 옮기면 무엇이 바뀌는가 ----

/** 옮길 때 실제로 건드릴 행을 정하는 데 필요한 것 전부. */
export type JumpPlanNode = {
  id: string;
  status: ProcedureCaseExecutionNodeStatus;
  /**
   * 🔴 시작(START) 표식인가(2026-11-02, 조각 11). 기본값은 거짓 — 사람이 할 일이다.
   *
   * 빠뜨리면 안 되는 까닭: START 에도 **실행 행이 있고**, 만들 때 바로 완료로
   * 찬다(startProcedureExecution). 그런데 경로 계산에서는 사람이 할 일이 아니라
   * 빠지므로, 안 가리면 **「경로 밖의 완료」로 읽혀 대기로 되돌아간다** — 절차가
   * 시작도 안 한 꼴이 되고, 그 줄은 화면에 안 보이므로 사람이 고칠 길도 없다.
   */
  isSystemEntry?: boolean;
};

/**
 * 「시작점 → 고른 노드」 최단 경로를 찾은 결과(procedure-execution-path.ts 의
 * resolveJumpPath 가 돌려주는 것 그대로).
 *
 * 🔴 **`found` 를 반드시 함께 받는다.** 빈 배열 하나로는 「길이 없다」와 「길은
 * 있는데 지날 줄이 없다(바로 첫 작업으로 옮겼다)」가 안 갈리는데, 둘이 하는 일이
 * 정반대다 — 앞은 **아무것도 안 건드리고**, 뒤는 **경로 밖의 완료를 전부**
 * 되돌린다. 섞으면 그리다 만 절차에서 끝낸 작업이 통째로 대기가 된다.
 */
export type JumpPathInput = { found: boolean; executionNodeIds: readonly string[] };

export type JumpPlan =
  | { kind: "REJECTED"; reason: JumpRejectionReason; message: string }
  /** 이미 그 노드 **하나만** 진행 중이고 지나온 길에도 바꿀 줄이 없다 — 바꿀 것이 없다. */
  | { kind: "NO_CHANGE" }
  | {
      kind: "MOVE";
      /** 고른 노드가 **이미** 진행 중이었나. 이력의 beforeState 가 이것으로 적힌다. */
      targetWasInProgress: boolean;
      /** 대기로 되돌릴 다른 진행 중 노드들(procedure_case_execution_nodes.id). */
      standDownExecutionNodeIds: string[];
      /**
       * **지나온 길**에서 함께 완료할 줄들(2026-11-02, 조각 11). 경로 차례 그대로다.
       *
       * 🔴 고른 줄 자신은 안 들어 있다 — 그 줄은 진행 중이 된다.
       */
      completeOnPathExecutionNodeIds: string[];
      /**
       * **그 길에 없는데 완료로 남아 있던** 줄들 — 대기로 되돌린다(2026-11-02,
       * 조각 11). 받은 nodes 배열 차례 그대로다.
       *
       * 🔴 길을 못 찾았으면 **언제나 비어 있다**(JumpPathInput.found 주석).
       */
      reopenOffPathExecutionNodeIds: string[];
    };

/**
 * 옮기면 어느 행이 어떻게 되는가를 **한 곳에서** 정한다.
 *
 * 쓰는 자리가 둘이다 — 쓰기 쪽(db/mutations/procedure-case-execution.ts)이 행을
 * 잠근 뒤에 이것으로 정하고, 시험이 같은 함수로 기대값을 만든다. 쓰기 쪽에서만
 * if 로 적으면 「무엇이 바뀌는가」를 시험이 **쓰기 코드를 베껴서** 재게 된다.
 *
 * 🔴 **아무것도 안 바뀌는 경우를 따로 돌려준다**(NO_CHANGE). 그때 행을 건드리면
 * 값은 그대로인데 version 만 올라서, 같은 화면을 보던 다른 사람의 단추가 전부
 * CONFLICT 로 죽는다 — updateExecutionNodeMemo 가 같은 까닭으로 같은 길을 쓴다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **자리가 상태를 정한다**(2026-11-02, 조각 11)
 * ──────────────────────────────────────────────────────────────────────
 * 사용자 결정 둘을 한 규칙으로 합친 것이다:
 *
 *   「현재 진행 단계보다 뒤에 있는 노드로 옮겨가면 그 노드 이전의 노드들은
 *    [완료]처리되도록 해줘 … 시작점 부터 그 노드까지의 경로에 있는 노드들**만**
 *    [완료]처리 되도록 해줘.」
 *   「노드의 연결선에 따라서 이전 단계의 노드로 돌아갈 수도 있으니까, 이전
 *    노드로 옮겨가면 옮겨가는 노드 뒷부분에 배치되어 있는 노드들은 다시
 *    [대기]상태가 되도록 해줘.」
 *
 *   ⇒ **「시작점 → 고른 노드」 최단 경로 위는 완료, 그 길에 없는 완료는 대기.**
 *
 * 🔵 앞으로 가든 뒤로 가든 **같은 한 규칙**이다. 「앞/뒤」를 따로 가리지 않는
 * 까닭은 고리가 있으면 「뒤」라는 말이 성립하지 않기 때문이다 — A → B → C → A
 * 에서 A 는 A 의 뒤이기도 하다. 자리(= 경로)만 보면 그 물음이 아예 안 생긴다.
 *
 * 🔴 **되돌리는 것은 완료뿐이다.** 길 밖에 있어도 그냥 두는 것이 둘:
 *  - **건너뜀**. 사람이 **사유를 적어 「안 한다」고 고른** 것이다. 옮기기는
 *    건너뜀을 **만들지 않으므로**(조각 7·10 이 일부러 안 만들었다) 되돌릴 것도
 *    아니다 — 되돌리면 사람의 판단과 그 사유가 말없이 지워진다.
 *  - **차단됨**. 사람이 **사유를 적어 막아 둔** 것이다. 사유 없이 푸는 길을 내면
 *    막아 둔 뜻이 기록에서 사라진다 — 조각 10 이 「차단됨으로는 못 옮긴다」고
 *    정한 것과 같은 까닭이고, 길 위든 밖이든 달라질 이유가 없다. 길 위의
 *    차단됨도 완료로 안 바꾼다.
 *
 * 🔴 **이미 완료·건너뜀인 줄은 길 위에 있어도 다시 안 쓴다.** 다시 쓰면 완료한
 * 사람·시각이 옮긴 사람·지금으로 덮여, 실제로 그 작업을 한 사람의 이름이
 * 기록에서 사라진다.
 *
 * 🔵 **진행 중**인 줄은 경로 위에 있으면 완료가 된다. 조각 10 의 「하던 노드를
 * 대기로 내린다」와 어긋나지 않는다 — 그 규칙은 **경로 밖**의 진행 중에 그대로
 * 남아 있고(아래 standDown), 경로 위의 진행 중은 「지나온 길」이라 대기로 내릴
 * 자리가 아니다. 둘을 같게 다루면 완료된 줄 사이에 대기 한 줄이 끼어 남는다.
 */
export function planNodeJump(input: {
  /** 같은 실행의 실행 노드 **전부**(고른 것 자신이 섞여 있어야 한다). */
  nodes: readonly JumpPlanNode[];
  targetExecutionNodeId: string;
  /**
   * 시작점 → 고른 노드 **최단 경로**를 찾은 결과. 안 주면 「못 찾았다」로 읽어
   * 조각 10 그대로 자리만 옮긴다 — 완료도 되돌림도 하지 않는다.
   */
  path?: JumpPathInput;
}): JumpPlan {
  const target = input.nodes.find((n) => n.id === input.targetExecutionNodeId) ?? null;
  const eligibility = classifyJumpTarget(target?.status ?? null);
  if (!eligibility.ok) return { kind: "REJECTED", reason: eligibility.reason, message: eligibility.message };

  const path = input.path ?? { found: false, executionNodeIds: [] };
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]));
  const onPath = new Set(path.executionNodeIds);

  const completeOnPathExecutionNodeIds = !path.found
    ? []
    : path.executionNodeIds.filter((id) => {
        if (id === input.targetExecutionNodeId) return false;
        const node = nodeById.get(id);
        if (!node || node.isSystemEntry === true) return false;
        return node.status === "PENDING" || node.status === "IN_PROGRESS";
      });

  const reopenOffPathExecutionNodeIds = !path.found
    ? []
    : input.nodes
        .filter(
          (n) =>
            n.status === "COMPLETED" &&
            n.isSystemEntry !== true &&
            n.id !== input.targetExecutionNodeId &&
            !onPath.has(n.id)
        )
        .map((n) => n.id);

  // 🔴 경로 밖의 진행 중을 대기로 내리는 것은 **담당을 안 가린다**(조각 10 그대로).
  // 거기서 안 내리면 pickCurrentTask 가 차례가 앞선 그 줄을 그대로 「지금 할
  // 일」로 골라, 눌렀는데 아무 일도 안 일어난 화면이 된다.
  const completing = new Set(completeOnPathExecutionNodeIds);
  const standDownExecutionNodeIds = input.nodes
    .filter(
      (n) =>
        n.status === "IN_PROGRESS" &&
        n.isSystemEntry !== true &&
        n.id !== input.targetExecutionNodeId &&
        !completing.has(n.id)
    )
    .map((n) => n.id);

  const targetWasInProgress = target !== null && target.status === "IN_PROGRESS";
  if (
    targetWasInProgress &&
    standDownExecutionNodeIds.length === 0 &&
    completeOnPathExecutionNodeIds.length === 0 &&
    reopenOffPathExecutionNodeIds.length === 0
  ) {
    return { kind: "NO_CHANGE" };
  }

  return {
    kind: "MOVE",
    targetWasInProgress,
    standDownExecutionNodeIds,
    completeOnPathExecutionNodeIds,
    reopenOffPathExecutionNodeIds,
  };
}

// ---- 되돌리면서 비운 기록 ----

/**
 * 옮기기가 **경로 밖의 완료를 되돌리면서 비운 작업 메모**를 이력 줄에서 꺼낸다.
 * 그런 줄이 아니면 null.
 *
 * 🔴 왜 필요한가(2026-11-02, 조각 11): 되돌린 줄은 작업 메모를 비운다 — 사용자
 * 결정이 「그 노드를 **새로 밟는 것처럼**」이기 때문이다. 그런데 같은 말의 앞부분이
 * 「이전 기록(메모 등)은 **실행 이력에 남겠지만**」이다. 쓰기 쪽이 비우기 전 값을
 * beforeState 에 옮겨 적어도, **이력 화면이 그것을 안 그리면 남았다는 말이
 * 거짓**이 된다 — 사람이 쓴 글이 통째로 사라진 것과 같다.
 *
 * 🔵 `clearedOnJump` 표시를 함께 본다. 작업 메모라는 이름만 보고 꺼내면, 나중에
 * 다른 자리가 같은 이름을 beforeState 에 적는 날 엉뚱한 줄에 「지운 작업 메모」가
 * 뜬다.
 *
 * 🔵 `unknown` 을 받는 까닭은 이력의 beforeState 가 JSON 칸이라 타입이 없기
 * 때문이다. 화면에서 as 로 단언하지 않게 **여기서 한 번만** 좁힌다.
 */
export function readJumpResetWorkMemo(beforeState: unknown): string | null {
  if (typeof beforeState !== "object" || beforeState === null) return null;
  const state = beforeState as { clearedOnJump?: unknown; workMemo?: unknown };
  if (state.clearedOnJump !== true) return null;
  if (typeof state.workMemo !== "string") return null;
  const memo = state.workMemo.trim();
  return memo === "" ? null : state.workMemo;
}

// ---- 그림에 붙는 상태 딱지 ----

/**
 * 노드 칸에 붙는 상태 딱지의 **세기**. 이름 넷은 흐름 띠(ExecutionFlowStrip 의
 * CHIP_TONE_CLASS)와 **같은 것**이다 — 한 화면에서 띠와 팝업이 나란히 서므로
 * 같은 상태가 다른 색으로 보이면 안 된다.
 *
 * 🔵 색 이름을 여기 적지 않는 까닭은 이 파일이 화면을 모르기 때문이다
 * (procedure-execution-list-fold.ts 의 ExecutionFoldNote 와 같은 규약).
 */
export type JumpStatusTone = "CURRENT" | "DONE" | "BLOCKED" | "AHEAD";

export type JumpStatusMark = { label: string; tone: JumpStatusTone };

export function toJumpStatusMark(status: ProcedureCaseExecutionNodeStatus): JumpStatusMark {
  const label = procedureCaseExecutionNodeStatusLabels[status];
  if (status === "IN_PROGRESS") return { label, tone: "CURRENT" };
  if (status === "COMPLETED" || status === "SKIPPED") return { label, tone: "DONE" };
  if (status === "BLOCKED") return { label, tone: "BLOCKED" };
  return { label, tone: "AHEAD" };
}

/**
 * 절차 그림에 얹을 딱지 지도 — **절차 노드 id** → 그 노드의 상태 딱지.
 *
 * 🔴 사례별 추가 작업(procedureTemplateNodeId 가 null)은 지도에 안 들어간다.
 * 그림에 자리가 없는 줄이라 얹을 칸이 없다 — 대신 검색 목록에는 그대로 걸린다
 * (아래 searchJumpTargets). 둘을 같은 규칙으로 묶으면 추가 작업으로는 영영 못
 * 옮기게 된다.
 */
export function buildJumpStatusMarks(nodes: readonly JumpCandidateNode[]): Map<string, JumpStatusMark> {
  const marks = new Map<string, JumpStatusMark>();
  for (const node of nodes) {
    if (node.procedureTemplateNodeId === null) continue;
    marks.set(node.procedureTemplateNodeId, toJumpStatusMark(node.status));
  }
  return marks;
}

// ---- 검색 ----

export type JumpNodeHit = {
  node: JumpCandidateNode;
  /** 접어 둔 제목 — 화면이 다시 접지 않게 여기서 한 번만 접는다. */
  title: string;
  mark: JumpStatusMark;
  eligibility: JumpEligibility;
};

export type JumpNodeSearchResult = {
  /** 잘라내기 **전**의 맞는 수. 화면의 「맞는 작업 N개」가 이 값이다. */
  matchCount: number;
  hits: JumpNodeHit[];
  truncated: boolean;
};

/**
 * 작업 이름으로 찾는다.
 *
 * 🔴 **제목만 본다** — 고르는 창(searchStartNodes)과 같은 까닭이다. 손으로 만든
 * 절차의 node_code 는 `manual-<uuid>` 라서 글자 하나만 쳐도 거의 전부가 걸린다.
 *
 * 차례는 **받은 그대로**다. getExecutionDetail 이 절차 차례로 정렬해서 내려주므로
 * (sortByProcedureExecutionOrder), 여기서 다시 줄 세우면 창과 화면의 차례가
 * 갈린다 — 이 저장소가 실제로 겪은 종류의 결함이다.
 *
 * 🔵 **못 옮기는 줄도 싣는다.** 왜 못 옮기는지가 그 줄에 적힌다 — 빼 버리면
 * 이름을 정확히 쳐도 「일치하는 작업이 없습니다」가 떠서, 사람은 자기가 이름을
 * 잘못 쳤다고 읽는다.
 */
export function searchJumpTargets(
  nodes: readonly JumpCandidateNode[],
  query: string,
  limit: number = JUMP_RESULT_LIMIT
): JumpNodeSearchResult {
  const needle = flattenNodeTitle(query).toLowerCase();
  if (needle === "") return { matchCount: 0, hits: [], truncated: false };

  const hits: JumpNodeHit[] = [];
  for (const node of nodes) {
    const title = flattenNodeTitle(node.title);
    if (!title.toLowerCase().includes(needle)) continue;
    hits.push({ node, title, mark: toJumpStatusMark(node.status), eligibility: classifyJumpTarget(node.status) });
  }

  return { matchCount: hits.length, hits: hits.slice(0, limit), truncated: hits.length > limit };
}

/**
 * 고른 노드 하나를 결과 줄과 **같은 모양**으로 되찾는다 — 창 아래의 「고른 것:」
 * 줄과 서버로 보내기 전의 마지막 확인이 같은 글자를 쓰게 한다. 못 찾으면 null
 * (findStartNode 와 같은 규약 — 진짜 판정은 서버가 제 손으로 다시 한다).
 */
export function findJumpTarget(nodes: readonly JumpCandidateNode[], executionNodeId: string | null): JumpNodeHit | null {
  if (executionNodeId === null) return null;
  const node = nodes.find((n) => n.id === executionNodeId);
  if (!node) return null;
  return {
    node,
    title: flattenNodeTitle(node.title),
    mark: toJumpStatusMark(node.status),
    eligibility: classifyJumpTarget(node.status),
  };
}

/**
 * 그림에서 누른 **절차 노드**가 어느 실행 줄인지 되찾는다. 없으면 null —
 * 시작(START) 지점과 참고 문서가 그렇다(실행 행 자체가 안 생긴다).
 */
export function findJumpTargetByTemplateNodeId(
  nodes: readonly JumpCandidateNode[],
  procedureTemplateNodeId: string | null
): JumpCandidateNode | null {
  if (procedureTemplateNodeId === null) return null;
  return nodes.find((n) => n.procedureTemplateNodeId === procedureTemplateNodeId) ?? null;
}

// ---- 옮기기 단추 ----

export type JumpButtonState = {
  label: string;
  disabled: boolean;
  /** 단추가 왜 안 눌리는지. 눌리는 상태에서는 null. */
  hint: string | null;
};

/** 단추에 적히는 글자 — 한 곳에서만 정한다(시험도 이것을 본다). */
export const JUMP_BUTTON_LABEL = "여기로 옮기기";

/**
 * 옮기기 단추의 글자와 **왜 안 눌리는지**.
 *
 * 🔴 흐리게만 두지 않는다. 고른 노드가 완료·차단이면 사람은 자기가 무엇을 잘못
 * 눌렀는지 알 길이 없다 — 까닭을 그대로 적는다(resolveStartButtonState 와 같은
 * 규약).
 *
 * 🔵 「이미 지금 할 일이다」를 여기서 가리지 않는다. 그 판정은 pickCurrentTask 의
 * 몫이고, 그 답을 받아 `isAlreadyCurrent` 로 넘긴다 — 화면이 진행 중을 세어
 * 직접 고르면 큰 카드와 창의 답이 갈린다.
 */
export function resolveJumpButtonState(input: {
  chosen: JumpNodeHit | null;
  isAlreadyCurrent: boolean;
  isSubmitting: boolean;
  /**
   * 🔴 마친 실행인가(procedure_case_executions.completed_at 이 찼는가). 마친
   * 실행에서는 **창은 열리되 옮길 수는 없다** — 그려 놓은 절차를 되짚어 보는
   * 것은 마친 뒤에도 쓸모가 있지만, 자리를 옮기면 「마쳤다」는 사람의 판단을
   * 화면이 뒤집는 꼴이다. 서버도 같은 것을 거절한다(ALREADY_FINISHED) — 여기서
   * 안 가리면 **눌리는데 반드시 실패하는 단추**가 된다.
   */
  isExecutionFinished: boolean;
  /** 옮길 수 있는 사람인가(서버도 같은 문턱으로 다시 판정한다). */
  eligible: boolean;
}): JumpButtonState {
  if (input.isSubmitting) return { label: "옮기는 중...", disabled: true, hint: null };
  if (input.isExecutionFinished) {
    return {
      label: JUMP_BUTTON_LABEL,
      disabled: true,
      hint: "이미 마친 절차입니다. 「이 건의 다른 절차」에서 [절차 다시 잇기]로 다시 이은 뒤에 옮길 수 있습니다.",
    };
  }
  if (!input.eligible) {
    return { label: JUMP_BUTTON_LABEL, disabled: true, hint: "담당 엔지니어 또는 관리자만 지금 할 일을 옮길 수 있습니다." };
  }
  if (input.chosen === null) {
    return { label: JUMP_BUTTON_LABEL, disabled: true, hint: "그림에서 작업을 누르거나 검색 결과를 고르세요." };
  }
  if (!input.chosen.eligibility.ok) {
    return { label: JUMP_BUTTON_LABEL, disabled: true, hint: input.chosen.eligibility.message };
  }
  if (input.isAlreadyCurrent) {
    return { label: JUMP_BUTTON_LABEL, disabled: true, hint: "이미 「지금 할 일」로 서 있는 작업입니다." };
  }
  return { label: JUMP_BUTTON_LABEL, disabled: false, hint: null };
}
