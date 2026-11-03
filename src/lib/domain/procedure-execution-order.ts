/**
 * 절차 실행 화면의 **차례**와 **지금 자리**. 순수 함수만 — DOM 도 React 도 DB 도
 * 건드리지 않는다(procedure-execution-topology.ts 와 같은 규약).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 이 파일이 생겼는가
 * ──────────────────────────────────────────────────────────────────────
 * getExecutionDetail 이 노드를 돌려줄 때 **차례가 아예 없었다**(ORDER BY 가 한
 * 줄도 없었다). 그래서 수리하는 사람 화면에 카드 22장이 DB 가 주는 대로 —
 * 사실상 아무 차례로 — 깔렸고, 「지금 몇 번째인지」라는 말 자체가 성립하지
 * 않았다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무엇으로 정렬하는가 — 개발 DB 를 실제로 세어 보고 골랐다(2026-11-02)
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **node_code 로는 못 한다.** 528줄을 세어 보니 번호 꼴
 * (`^[A-Za-z]*-?[0-9]+$`)인 것이 **0개**다. 손으로 만든 절차는
 * `manual-ce0f082a-7fb9-4354-af26-3a0cbb1fa802`(UUID), 엑셀에서 들여온 절차는
 * `s11-14`(시트-도형 번호)다. 둘 다 **그린 차례도 흐르는 차례도 아니다** —
 * 들여올 때의 도형 식별자이거나 그냥 난수다.
 *
 * 🔴 **위상 레벨(START 로부터의 거리)로도 못 한다.** 실제로 실행되는 절차
 * (「원복 검사 및 개선 작업 (3상 입력)」, 노드 23개)의 간선은 **8개뿐**이다.
 * 나머지 노드는 START 에서 아예 닿지 않아 레벨이 없다. 판단 노드가 8할이라
 * 사람이 그리다 만 가지가 많은 탓인데, 이 상태로 위상 레벨을 쓰면 22장 중
 * 열다섯 장이 「레벨 없음」 한 덩어리가 된다.
 *
 * 🔵 **그래서 procedure_template_nodes.sort_order 로 정한다.** 지시서에는 없던
 * 칸이지만 이미 있고, 템플릿마다 0부터 빈틈없이 매겨져 있으며(실측: 「7」 23개
 * → 0~22, 「기본 통전 검사」 28개 → 0~27), **절차 상세 화면이 이미 이 칸으로
 * 정렬한다**(queries/procedure-templates.ts). 실제 값으로 늘어놓아 보면
 * 「점검 → 교환」 짝이 그대로 이어지는, 사람이 적은 차례가 나온다.
 *
 * 좌표(position_y, position_x)도 재 봤지만 **더 나빴다.** 그림이 세로 한 줄이
 * 아니라 여러 칸으로 벌어져 있어서, y 로 줄을 세우면 「정류 다이오드 전압 점검」
 * 다음에 엉뚱한 「FH-SEQ 신호 점검」이 끼어들고 짝이 흩어진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 번호가 겹칠 때 — 자릿수를 숫자로 읽는다
 * ──────────────────────────────────────────────────────────────────────
 * sort_order 에는 유니크 제약이 없다(기본값 0). 전부 0 인 절차가 들어오면
 * node_code 가 차례를 정하게 되는데, 글자 그대로 비교하면 `s11-9` 가 `s11-42`
 * 뒤로 간다. 실측에 그런 코드가 그대로 있다. 그래서 숫자 덩이는 숫자로 읽는다.
 */

import type { ProcedureCaseExecutionNodeStatus } from "./procedure-case-execution-types";

/** 숫자 덩이와 글자 덩이를 번갈아 끊는다. */
const CODE_CHUNKS = /\d+|\D+/g;

function splitCodeChunks(value: string): string[] {
  return value.match(CODE_CHUNKS) ?? [];
}

/**
 * 「N-2」가 「N-10」 앞에 오도록 — 숫자 덩이는 숫자로, 글자 덩이는 글자로 센다.
 *
 * 숫자를 Number 로 바꾸지 않는다: 코드에 아주 긴 숫자 덩이가 섞이면 정밀도가
 * 날아가 차례가 조용히 흐트러진다. 앞의 0 을 떼고 **자릿수 → 글자** 차례로
 * 비교하면 길이에 상관없이 정확하다.
 */
export function compareHumanNumberedCode(a: string, b: string): number {
  const left = splitCodeChunks(a);
  const right = splitCodeChunks(b);
  const shared = Math.min(left.length, right.length);

  for (let i = 0; i < shared; i += 1) {
    const x = left[i];
    const y = right[i];
    const xIsNumber = x.charCodeAt(0) >= 48 && x.charCodeAt(0) <= 57;
    const yIsNumber = y.charCodeAt(0) >= 48 && y.charCodeAt(0) <= 57;

    if (xIsNumber !== yIsNumber) {
      // 같은 자리에서 한쪽만 숫자면 숫자를 앞에 — "A-1" 이 "A-x" 앞.
      return xIsNumber ? -1 : 1;
    }

    if (xIsNumber && yIsNumber) {
      const xDigits = x.replace(/^0+(?=\d)/, "");
      const yDigits = y.replace(/^0+(?=\d)/, "");
      if (xDigits.length !== yDigits.length) return xDigits.length - yDigits.length;
      if (xDigits !== yDigits) return xDigits < yDigits ? -1 : 1;
      // 값이 같고 앞의 0 개수만 다르다("007" vs "7") — 짧은 쪽을 앞에 둬서
      // 차례만 고정한다. 어느 쪽이 앞이냐는 뜻이 없고, 흔들리지 않는 것이 뜻이다.
      if (x !== y) return x.length - y.length;
      continue;
    }

    if (x !== y) return x < y ? -1 : 1;
  }

  return left.length - right.length;
}

export type ProcedureExecutionOrderKey = {
  /** procedure_case_execution_nodes.id — 마지막 흔들림 방지용. */
  id: string;
  /**
   * 이 줄이 **절차 차례의 어디**인가(procedure_template_nodes.sort_order).
   *
   * 🔵 2026-11-03(조각 13)에 **뜻이 한 겹 넓어졌다.** 전에는 「템플릿 노드의
   * sort_order, 추가 작업은 null」이었는데, 이제 추가 작업도 **이어 붙은 자리**가
   * 있으면 그 앞 작업의 값을 물려받는다(resolveAddedTaskAnchors). 여전히 null 인
   * 것은 **아무 선에도 안 닿은 추가 작업**뿐이고, 그것은 전처럼 맨 뒤로 간다.
   */
  procedureSortOrder: number | null;
  /**
   * 같은 `procedureSortOrder` 안에서 **몇 걸음 뒤에 끼워 넣은 줄인가**
   * (2026-11-03, 조각 13). 템플릿에서 온 줄은 언제나 0 이고, 그 줄 뒤에 이어 붙인
   * 추가 작업이 1, 그 뒤에 또 이어 붙인 것이 2 … 이다.
   *
   * 🔴 이 칸이 없으면 「3번 작업 뒤에 끼운 추가 작업」이 3번 **앞**에 설 수 있다 —
   * 둘의 sort_order 가 같아서 그다음 열쇠(번호·id)가 차례를 정해 버리기 때문이다.
   */
  insertionDepth: number;
  /** 겹칠 때만 쓰는 보조 열쇠. 추가 작업은 null, 빈 글자일 수도 있다. */
  nodeCode: string | null;
  /** 추가 작업끼리의 차례 — 더해진 때(ISO 문자열). */
  addedAt: string | null;
};

/**
 * 절차 차례 비교. 다섯 단계로 내려간다:
 *
 *   1. 절차 차례(sort_order). **아무 선에도 안 닿은 추가 작업은 언제나 뒤**다 —
 *      끼워 넣을 자리가 그림에 없으니 「절차 다음에 더 한 일」로 읽히는 쪽이 맞다.
 *   2. 같은 자리 안에서는 **끼워 넣은 깊이**(insertionDepth). 템플릿에서 온 줄(0)이
 *      언제나 먼저이고, 그 뒤에 이어 붙인 추가 작업이 1 · 2 … 로 따라붙는다.
 *   3. 깊이까지 같은 추가 작업끼리는 더해진 차례(addedAt).
 *   4. 번호(node_code). 자릿수가 들쭉날쭉해도 사람이 읽는 차례로.
 *      번호가 없는 쪽(null·빈 글자)은 뒤로 보낸다.
 *   5. id. 여기까지 와도 갈리지 않으면 **입력이 같으면 결과도 같게** 한다 —
 *      새로고침할 때마다 카드 차례가 바뀌는 일이 없어야 한다.
 */
export function compareProcedureExecutionOrder(a: ProcedureExecutionOrderKey, b: ProcedureExecutionOrderKey): number {
  const aPlaced = a.procedureSortOrder !== null;
  const bPlaced = b.procedureSortOrder !== null;
  if (aPlaced !== bPlaced) return aPlaced ? -1 : 1;

  if (aPlaced && bPlaced && a.procedureSortOrder !== b.procedureSortOrder) {
    return (a.procedureSortOrder as number) - (b.procedureSortOrder as number);
  }

  if (a.insertionDepth !== b.insertionDepth) return a.insertionDepth - b.insertionDepth;

  // 🔵 깊이가 같으면서 **둘 다 끼워 넣은 줄**일 때만 더해진 차례를 본다. 템플릿
  //    줄끼리는 깊이가 둘 다 0 이고 addedAt 도 전부 차 있어서, 여기서 재면
  //    sort_order 가 겹칠 때 **만든 날짜**가 번호를 이겨 버린다.
  if (a.insertionDepth > 0 && b.insertionDepth > 0) {
    const aAdded = a.addedAt ?? "";
    const bAdded = b.addedAt ?? "";
    if (aAdded !== bAdded) return aAdded < bAdded ? -1 : 1;
  }

  if (!aPlaced && !bPlaced) {
    const aAdded = a.addedAt ?? "";
    const bAdded = b.addedAt ?? "";
    if (aAdded !== bAdded) return aAdded < bAdded ? -1 : 1;
  }

  const aCode = a.nodeCode ?? "";
  const bCode = b.nodeCode ?? "";
  if (aCode !== bCode) {
    if (aCode === "") return 1;
    if (bCode === "") return -1;
    const byCode = compareHumanNumberedCode(aCode, bCode);
    if (byCode !== 0) return byCode;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---- 이어 붙인 추가 작업이 **어디에** 끼는가 ----

/**
 * 「이 건에서 더한 작업」이 목록의 **어느 자리**에 서는지 정한다(2026-11-03,
 * 조각 13).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 필요한가 — 사용자 결정(2026-11-02)
 * ──────────────────────────────────────────────────────────────────────
 * 조각 12 까지 추가 작업은 **언제나 맨 뒤**였다. 끼워 넣을 자리가 그림에 없었기
 * 때문이다. 조각 13 에서 선을 그을 수 있게 되면서 자리가 생겼다 — 「3번 작업
 * 다음에 이것도 한다」고 이었으면 목록에서도 3번 바로 뒤에 서야, 큰 카드가
 * 고르는 「지금 할 일」(절차 차례가 앞선 대기)이 사람이 그린 그림과 맞는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 어떻게 정하는가
 * ──────────────────────────────────────────────────────────────────────
 * 템플릿에서 온 칸을 **출발점**으로 삼아 선을 따라 나아가면서, 처음 닿는
 * 추가 작업에 그 출발점의 sort_order 와 걸음 수를 적어 준다. 추가 작업에서 또
 * 이어진 추가 작업은 같은 sort_order 에 걸음 수만 하나 더 깊다.
 *
 * 🔴 **본 칸을 기억한다.** 되돌아가는 선이 실제로 있고(실측 42개 중 14개),
 * 기억하지 않으면 이 걷기가 영영 안 끝난다 — 실패가 아니라 「화면이 안
 * 돌아온다」로 나타나서 나중에 아무도 못 찾는다(procedure-execution-path.ts ·
 * minimap 의 walk 가 같은 문제를 같은 방법으로 푼다).
 *
 * 🔴 **차례를 못 박는다.** 출발점은 (sort_order, 칸 id) 오름차순, 선은
 * (sort_order, 선 id) 오름차순으로 따라간다. 추가 작업에 들어오는 선이 둘이면
 * **먼저 닿은 쪽**이 자리를 정하는데, 그 「먼저」가 흔들리면 같은 화면을 두 번
 * 열 때 목록 차례가 달라진다 — 오류를 안 내고 아무도 신고하지 않는 종류다.
 *
 * 🔵 들어오는 선이 **추가 작업에서만** 오고 그 추가 작업도 자리가 없으면, 끝내
 * 자리를 못 얻어 맨 뒤로 간다. 그것이 전과 같은 동작이다.
 */
export type AddedTaskAnchorEdge = {
  /** 간선 id — 차례를 못 박는 마지막 열쇠. */
  id: string;
  /** 그림 위 자리 id(템플릿 노드 id 또는 추가 작업의 실행 노드 id). */
  fromNodeId: string;
  toNodeId: string;
  sortOrder: number;
};

export type AddedTaskAnchor = {
  procedureSortOrder: number;
  insertionDepth: number;
  /**
   * **바로 앞 칸**의 그림 위 자리 id. 목록 차례에는 안 쓰이고, 그림이 이 칸을
   * 어디에 그릴지 정하는 데 쓴다(추가 작업에는 저장된 좌표가 없다 — 앞 칸 옆에
   * 세운다). 차례를 정하는 값과 같은 걷기에서 나와야 **목록과 그림이 같은 앞
   * 칸을 가리킨다.**
   */
  anchorGraphNodeId: string;
};

export function resolveAddedTaskAnchors(input: {
  /** 템플릿에서 온 칸 — 그림 위 자리 id 와 그 칸의 sort_order. */
  templateNodes: readonly { graphNodeId: string; sortOrder: number }[];
  /** 이 건에서 더한 작업의 **그림 위 자리 id**(= 실행 노드 id). */
  addedGraphNodeIds: readonly string[];
  /** 템플릿 간선과 추가 간선을 **합친** 목록. */
  edges: readonly AddedTaskAnchorEdge[];
}): Map<string, AddedTaskAnchor> {
  const added = new Set(input.addedGraphNodeIds);
  if (added.size === 0) return new Map();

  const outgoing = new Map<string, AddedTaskAnchorEdge[]>();
  const orderedEdges = [...input.edges].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  for (const edge of orderedEdges) {
    const list = outgoing.get(edge.fromNodeId);
    if (list) list.push(edge);
    else outgoing.set(edge.fromNodeId, [edge]);
  }

  const anchors = new Map<string, AddedTaskAnchor>();
  const seen = new Set<string>();
  const queue: { graphNodeId: string; procedureSortOrder: number; insertionDepth: number }[] = [];

  const sources = [...input.templateNodes].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.graphNodeId < b.graphNodeId ? -1 : a.graphNodeId > b.graphNodeId ? 1 : 0)
  );
  for (const node of sources) {
    if (seen.has(node.graphNodeId)) continue;
    seen.add(node.graphNodeId);
    queue.push({ graphNodeId: node.graphNodeId, procedureSortOrder: node.sortOrder, insertionDepth: 0 });
  }

  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i];
    for (const edge of outgoing.get(current.graphNodeId) ?? []) {
      const next = edge.toNodeId;
      // 🔴 템플릿 칸은 제 sort_order 를 이미 가지고 있다 — 선을 타고 왔다고 해서
      //    덮어쓰지 않는다. 덮어쓰면 되돌아가는 선 하나가 절차 전체의 차례를
      //    뒤집는다.
      if (!added.has(next) || seen.has(next)) continue;
      seen.add(next);
      const anchor: AddedTaskAnchor = {
        procedureSortOrder: current.procedureSortOrder,
        insertionDepth: current.insertionDepth + 1,
        anchorGraphNodeId: current.graphNodeId,
      };
      anchors.set(next, anchor);
      queue.push({ graphNodeId: next, ...anchor });
    }
  }

  return anchors;
}

/** 원본 배열을 건드리지 않고 절차 차례로 늘어놓는다. */
export function sortByProcedureExecutionOrder<T extends ProcedureExecutionOrderKey>(nodes: readonly T[]): T[] {
  return [...nodes].sort(compareProcedureExecutionOrder);
}

export type ExecutionPosition = {
  /** 사람이 할 일로 보이는 노드 수(START·참고 문서는 이미 빠져 있다). */
  total: number;
  /** 끝난 수 = 완료 + 건너뜀. */
  finished: number;
  /**
   * 지금 몇 번째인가 = 끝난 수 + 1.
   *
   * 🔴 다 끝났으면(또는 아예 노드가 없으면) **null** 이다. 1 을 더해 버리면
   * 「24번째 / 23」이 되어 버린다.
   */
  current: number | null;
};

/**
 * 「지금 몇 번째인가」를 **끝난 수 + 1** 로 정한다.
 *
 * 그래프상 몇 번째인지로 정하지 않는 까닭: 이 절차들은 판단(DECISION) 노드가
 * 8할이고 길이 갈린다. 같은 노드가 어떤 길에서는 셋째, 어떤 길에서는 아홉째라
 * 「그래프상 몇 번째」는 정의 자체가 안 선다. 「여섯 개 끝냈고 지금 일곱
 * 번째」는 어느 길로 가든 참이다.
 *
 * 진행 중(IN_PROGRESS)·차단됨(BLOCKED)은 **끝난 것이 아니다** — 끝난 수에
 * 넣지 않는다. 진행 중인 노드가 바로 「지금 그 번째」다.
 */
export function computeExecutionPosition(nodes: readonly { status: ProcedureCaseExecutionNodeStatus }[]): ExecutionPosition {
  const total = nodes.length;
  const finished = nodes.filter((n) => n.status === "COMPLETED" || n.status === "SKIPPED").length;
  return {
    total,
    finished,
    current: total === 0 || finished >= total ? null : finished + 1,
  };
}

/**
 * 요약 카드에 적을 한 줄. 노드가 하나도 없으면 null — 호출하는 쪽이 아무것도
 * 그리지 않는다(「0번째 / 전체 0」 같은 글자를 만들어 내지 않는다).
 */
export function formatExecutionPositionLabel(position: ExecutionPosition): string | null {
  if (position.total === 0) return null;
  if (position.current === null) return `${position.finished} / ${position.total} · 끝`;
  return `${position.current}번째 / 전체 ${position.total}`;
}
