/**
 * 절차를 **고르는 창**의 판정 — 어떤 노드가 검색에 걸리고, 그 가운데 무엇을
 * 「여기서부터」의 출발점으로 삼을 수 있는가. 순수 함수만 — DOM 도 React 도 DB 도
 * 건드리지 않는다(procedure-execution-order.ts · procedure-execution-focus.ts 와
 * 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가
 * ──────────────────────────────────────────────────────────────────────
 * 「기술 절차 불러오기」가 드롭다운 하나뿐이었다. 절차를 고르면 **언제나 처음부터**
 * 시작했고, 노드 이름으로 찾을 길이 없었다. 현장에서는 「MCU 쪽만 보면 된다」처럼
 * **중간 어디를 할지 이미 알고 있는** 경우가 흔한데, 그때마다 27장을 처음부터
 * 훑어 내려가야 했다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이름만으로는 못 가린다 — 같은 이름이 실제로 여럿이다
 * ──────────────────────────────────────────────────────────────────────
 * 개발 DB 의 게시된 절차 둘을 실제로 세어 봤다(2026-11-02):
 *
 *   - 절차를 **가로질러** 겹치는 이름: 「MCU 기판 교환」(원복 20번 · 기본 통전
 *     22번), 「일본 교산에 연락」(원복 10번 · 기본 통전 19번).
 *   - **한 절차 안에서도** 겹친다: 원복의 「FH-SEQ 신호 점검」·「FH-SEQ 기판
 *     교환」·「FH-CONT 신호 점검」·「FH-CONT 기판 교환」·「조정 작업 실시」가
 *     각각 두 번씩, 기본 통전의 「… 탈거 상태로 다음 진행」이 두 번씩.
 *
 * 그래서 검색 결과 한 줄에 **절차 이름**과 **절차상 번호**를 함께 싣는다. 둘 중
 * 하나만 있으면 가려지지 않는 짝이 남는다.
 *
 * 🔵 절차 이름은 formatProcedureTemplateTitle 로 만든다. 🔴 2026-11-05 부터 그
 * 함수는 **이름만** 돌려준다(코드를 화면에서 걷기로 한 사용자 결정 — 그쪽 머리말).
 * 여기서 직접 이어 붙이지 않는 까닭은 그대로다: 보일 모양을 한 곳에서만 정해야,
 * 다음에 또 바뀌는 날 네 화면이 따로 놀지 않는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 고를 수 **없는** 노드도 결과에 싣고, 까닭을 적는다
 * ──────────────────────────────────────────────────────────────────────
 * 시작(START)과 참고 문서(DOCUMENT_REFERENCE)는 출발점이 될 수 없다 — START 는
 * 실행을 만드는 순간 시스템이 완료로 적는 표식이고(isSystemEntryNodeType),
 * 참고 문서는 실행 행 자체가 안 생긴다(isExecutableNodeType). 그렇다고 검색에서
 * **통째로 빼면** 이름을 정확히 쳐도 「일치하는 노드가 없습니다」가 떠서, 사람은
 * 자기가 이름을 잘못 쳤다고 읽는다. 걸리게 하되 **왜 못 고르는지**를 함께 돌려준다
 * (참·거짓이 아니라 까닭을 돌려주는 이 묶음의 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 번호는 실행 화면과 **같은 자**로 매긴다
 * ──────────────────────────────────────────────────────────────────────
 * getExecutionDetail 이 카드에 적는 번호는 START·참고 문서를 뺀 뒤의 1-based
 * 차례이고, 차례는 sortByProcedureExecutionOrder 가 정한다. 여기서도 **같은 함수**로
 * 같은 열쇠(sort_order → node_code)를 써서 매긴다. 자를 따로 두면 창에서 7번을
 * 골랐는데 시작하고 보니 8번이 서 있는 날이 온다.
 *
 * 다만 마지막 흔들림 방지 열쇠만 다르다 — 실행 쪽은 procedure_case_execution_nodes.id,
 * 여기는 아직 실행이 없으므로 procedure_template_nodes.id 다. 이 열쇠는 sort_order 와
 * node_code 가 **둘 다 같을 때만** 쓰이는데, 실측 두 절차는 sort_order 가 0부터
 * 빈틈없이 매겨져 있어 그 자리까지 내려가지 않는다.
 */

import { sortByProcedureExecutionOrder } from "./procedure-execution-order";
import { isSystemEntryNodeType, isUserFacingExecutionNodeType } from "./procedure-execution-topology";
import { formatProcedureTemplateTitle } from "./procedure-template-title";
import type { ProcedureNodeType } from "./procedure-template-types";

/** 검색 결과로 한 번에 그리는 최대 줄 수. 맞는 수 자체는 따로 센다 — 「맞는 노드 N개」는 잘라내기 전의 수다. */
export const START_PICKER_RESULT_LIMIT = 30;

export type StartPickerNode = {
  /** procedure_template_nodes.id */
  id: string;
  title: string;
  nodeType: ProcedureNodeType;
  /** 차례의 보조 열쇠. 손으로 만든 절차는 `manual-<uuid>` 라 사람에게는 뜻이 없다. */
  nodeCode: string;
  /** procedure_template_nodes.sort_order — 절차를 만든 사람이 매긴 차례. */
  sortOrder: number;
};

export type StartPickerTemplate<T extends StartPickerNode> = {
  /** procedure_templates.id */
  id: string;
  code: string;
  name: string;
  nodes: T[];
};

// ---- 출발점이 될 수 있는가 ----

/**
 * 못 고르는 까닭. 화면이 할 말도, 서버가 돌려줄 코드도 각각 다르다.
 *
 *  - NOT_IN_TEMPLATE  — 그 절차의 노드가 아니다(화면이 보낸 값을 서버가 다시 볼 때).
 *  - SYSTEM_ENTRY     — 시작(START) 표식이다.
 *  - NO_EXECUTION_ROW — 실행 행이 안 생기는 노드다(참고 문서).
 */
export type StartNodeRejectionReason = "NOT_IN_TEMPLATE" | "SYSTEM_ENTRY" | "NO_EXECUTION_ROW";

export type StartNodeEligibility = { ok: true } | { ok: false; reason: StartNodeRejectionReason; message: string };

/**
 * `nodeType` 이 null 이면 **그 절차에서 못 찾았다**는 뜻이다. 서버가 화면이 보낸
 * 노드 id 를 템플릿에서 되찾아 본 결과를 그대로 넣을 수 있게 한 모양 — 「못 찾음」을
 * 부르는 쪽마다 따로 적으면 화면과 서버의 말이 갈린다.
 */
export function classifyStartNode(nodeType: ProcedureNodeType | null): StartNodeEligibility {
  if (nodeType === null) {
    return { ok: false, reason: "NOT_IN_TEMPLATE", message: "선택한 시작 지점이 이 절차의 작업이 아닙니다." };
  }
  if (isSystemEntryNodeType(nodeType)) {
    return { ok: false, reason: "SYSTEM_ENTRY", message: "시작(START) 지점은 시스템이 자동으로 관리하므로 시작 위치로 고를 수 없습니다." };
  }
  if (!isUserFacingExecutionNodeType(nodeType)) {
    return { ok: false, reason: "NO_EXECUTION_ROW", message: "참고 문서는 실행할 작업이 아니므로 시작 위치로 고를 수 없습니다." };
  }
  return { ok: true };
}

// ---- 절차상 번호 ----

/**
 * 고를 수 있는 노드에만 1부터 번호를 매긴다. 고를 수 없는 노드(START·참고 문서)는
 * 지도에 아예 안 들어간다 — 실행 화면의 「전체 N」 분모와 같은 잣대라야 한다.
 */
export function indexStartPickerNodes<T extends StartPickerNode>(nodes: readonly T[]): Map<string, number> {
  const ordered = sortByProcedureExecutionOrder(
    nodes
      .filter((n) => classifyStartNode(n.nodeType).ok)
      .map((n) => ({ id: n.id, procedureSortOrder: n.sortOrder, insertionDepth: 0, nodeCode: n.nodeCode, addedAt: null }))
  );
  const byId = new Map<string, number>();
  ordered.forEach((entry, index) => byId.set(entry.id, index + 1));
  return byId;
}

// ---- 검색 ----

/**
 * 제목의 줄바꿈·연속 공백을 한 칸으로 접는다. 실측 제목에 줄바꿈이 박혀 있다
 * (예: 「FH-CONT VCC 입력 케이블 탈거 후 ⏎ 전원 기동 및 MCU VCC 공급 확인」) —
 * 접지 않으면 한 줄짜리 결과 목록이 세로로 벌어지고, 검색도 「탈거 후 전원」처럼
 * 사람이 읽은 대로 친 말이 안 걸린다.
 */
export function flattenNodeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

export type StartNodeHit<T extends StartPickerNode> = {
  /** procedure_templates.id — 결과를 누르면 드롭다운이 이것으로 바뀐다. */
  templateId: string;
  /** formatProcedureTemplateTitle 로 만든 한 줄 이름. */
  templateTitle: string;
  node: T;
  /** 접어 둔 제목 — 화면이 다시 접지 않게 여기서 한 번만 접는다. */
  title: string;
  /** 고를 수 있는 노드에만 있다. START·참고 문서는 null. */
  orderIndex: number | null;
  eligibility: StartNodeEligibility;
};

export type StartNodeSearchResult<T extends StartPickerNode> = {
  /** 잘라내기 **전**의 맞는 수. 화면의 「맞는 노드 N개」가 이 값이다. */
  matchCount: number;
  hits: StartNodeHit<T>[];
  /** matchCount 가 limit 을 넘어 잘렸는가. */
  truncated: boolean;
};

/**
 * 노드 이름으로 찾는다.
 *
 * 🔴 **제목만 본다.** ProcedureFlowGraph 의 searchNodes 는 node_code 와
 * source shape# 까지 보는데, 손으로 만든 절차의 node_code 는
 * `manual-<uuid>` 라서 「a」 한 글자만 쳐도 거의 전부가 걸린다 — 고르는 창에서는
 * 그 잡음이 곧 오답이다. 사람이 아는 것은 이름뿐이라는 사용자 요구와도 같다.
 *
 * `scopeTemplateId` 가 null 이면 **게시된 절차 전부**에서 찾는다(드롭다운의
 * 기본값 「모든 절차」). 값이 있으면 그 절차 안에서만.
 *
 * 차례는 **절차 차례 그대로**다 — 맞은 정도로 다시 줄 세우지 않는다. 같은 이름이
 * 둘이면 번호가 작은 쪽이 위에 와야 사람이 「앞의 것/뒤의 것」으로 집는다.
 */
export function searchStartNodes<T extends StartPickerNode>(
  templates: readonly StartPickerTemplate<T>[],
  query: string,
  scopeTemplateId: string | null,
  limit: number = START_PICKER_RESULT_LIMIT
): StartNodeSearchResult<T> {
  const needle = flattenNodeTitle(query).toLowerCase();
  if (needle === "") return { matchCount: 0, hits: [], truncated: false };

  const hits: StartNodeHit<T>[] = [];
  for (const template of templates) {
    if (scopeTemplateId !== null && template.id !== scopeTemplateId) continue;
    const orderIndexById = indexStartPickerNodes(template.nodes);
    const templateTitle = formatProcedureTemplateTitle(template.name, template.code);
    // 결과 안의 차례는 절차 차례 그대로. 고를 수 없는 노드는 번호가 없으므로
    // 정렬 열쇠에는 제 sort_order 를 그대로 쓴다 — 번호 유무와 상관없이 그린
    // 차례대로 늘어선다.
    const orderedNodes = sortByProcedureExecutionOrder(
      template.nodes.map((n) => ({ id: n.id, procedureSortOrder: n.sortOrder, insertionDepth: 0, nodeCode: n.nodeCode, addedAt: null }))
    );
    const nodeById = new Map(template.nodes.map((n) => [n.id, n]));
    for (const entry of orderedNodes) {
      const node = nodeById.get(entry.id);
      if (!node) continue;
      const title = flattenNodeTitle(node.title);
      if (!title.toLowerCase().includes(needle)) continue;
      hits.push({
        templateId: template.id,
        templateTitle,
        node,
        title,
        orderIndex: orderIndexById.get(node.id) ?? null,
        eligibility: classifyStartNode(node.nodeType),
      });
    }
  }

  return { matchCount: hits.length, hits: hits.slice(0, limit), truncated: hits.length > limit };
}

/**
 * 고른 노드 하나를 결과 줄과 **같은 모양**으로 되찾는다 — 창 아래의 「고른 것:」
 * 줄과 서버로 보내기 전의 마지막 확인이 같은 글자를 쓰게 한다.
 *
 * 못 찾으면 null 이다. 「이 절차의 노드가 아니다」와 「절차 자체가 목록에 없다」를
 * 여기서 가르지 않는다 — 어느 쪽이든 화면이 할 일은 고른 것을 비우는 것 하나다.
 * 진짜 판정은 서버가 제 손으로 다시 한다(startProcedureExecution).
 */
export function findStartNode<T extends StartPickerNode>(
  templates: readonly StartPickerTemplate<T>[],
  templateId: string | null,
  nodeId: string | null
): StartNodeHit<T> | null {
  if (templateId === null || nodeId === null) return null;
  const template = templates.find((t) => t.id === templateId);
  if (!template) return null;
  const node = template.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return {
    templateId: template.id,
    templateTitle: formatProcedureTemplateTitle(template.name, template.code),
    node,
    title: flattenNodeTitle(node.title),
    orderIndex: indexStartPickerNodes(template.nodes).get(node.id) ?? null,
    eligibility: classifyStartNode(node.nodeType),
  };
}

// ---- 시작 단추 ----

export type StartButtonState = {
  label: string;
  disabled: boolean;
  /** 단추가 왜 안 눌리는지. 눌리는 상태에서는 null. */
  hint: string | null;
};

/**
 * 시작 단추의 **글자가 바뀐다**. 「여기서부터 시작」이라고 적어 놓고 처음부터
 * 시작해 버리면, 사람은 자기가 고른 자리가 무시된 줄도 모른다 — 반대도 마찬가지다.
 *
 * 🔴 드롭다운 기본값이 「모든 절차」라서 **창을 열자마자는 아무것도 못 시작한다.**
 * 전에는 첫 절차가 미리 골라져 있어 단추가 바로 눌렸는데, 「모든 절차에서 검색」을
 * 기본으로 둔 이상 그 상태에서 시작할 절차가 정해지지 않는다. 단추를 그냥 흐리게만
 * 두면 「왜 안 눌리지」가 되므로 한 줄로 까닭을 적는다.
 */
export function resolveStartButtonState(input: {
  scopeTemplateId: string | null;
  chosenNodeId: string | null;
  isSubmitting: boolean;
}): StartButtonState {
  if (input.isSubmitting) return { label: "시작하는 중...", disabled: true, hint: null };
  if (input.scopeTemplateId === null) {
    return { label: "처음부터 시작", disabled: true, hint: "먼저 절차를 고르세요. 검색 결과를 눌러도 절차가 정해집니다." };
  }
  if (input.chosenNodeId === null) return { label: "처음부터 시작", disabled: false, hint: null };
  return { label: "여기서부터 시작", disabled: false, hint: null };
}
