import {
  cellGridPosition,
  cellGridStartPosition,
  type CellGridBlock,
  type CellGridBox,
  type CellGridGeometry,
  type CellGridLink,
  type CellGridWarning,
  type CellGridWarningCode,
} from "./cell-grid-flowchart";
import {
  classifyTechnicalNodeType,
  matchNextProcedureStageNumber,
  splitInstructionsAndCaution,
  PENDING_NEXT_PROCEDURE_MEMO_MARKER,
  type TechnicalTaskGraphResult,
  type TechnicalTaskNode,
} from "./extract-technical-task-graph";
import type { ExtractedEdge, ExtractedValidationIssue } from "./types";
import type { ProcedureBranchType, ProcedureValidationIssueType } from "@/lib/domain/procedure-template-types";

/**
 * ============================================================================
 * 셀 격자 **블록 한 덩어리 → 기술 작업 절차 하나**
 * ============================================================================
 * `cell-grid-flowchart.ts` 가 읽어 놓은 상자·이음을 **절차의 노드와 분기**로 옮긴다.
 * 격자를 읽는 일은 저쪽이 끝냈고, 여기는 「그것이 절차로서 무엇인가」만 정한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **도형 쪽과 똑같은 함수로 정한다** — 규칙을 베끼지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *   · 노드 유형 : `classifyTechnicalNodeType` (extract-technical-task-graph.ts)
 *   · 분기 갈래 : `classifyUnifiedBranchLabel` (cell-grid-flowchart.ts 가 이미 부른다)
 *   · 본문/주의 : `splitInstructionsAndCaution`
 *   · 시작 노드 : 아래 6절 — 도형 쪽 6-2 절과 **같은 방식**
 * 규칙을 베껴 두면 한쪽만 고쳐지는 날이 오고, 그 어긋남은 오류가 아니라 **화면에서만**
 * 드러난다(상자 모양·색과 실행 목록에 뜨는지 여부가 달라진다).
 *
 * 🔵 **도형 쪽에만 있고 여기 없는 것**과 그 까닭:
 *   · 「NG 와 짝지어 나가는 **이름 없는 선**을 정상으로 올린다」 — 이 격자는 가로
 *     이음에 「정상」이 **이미 적혀 있다.** 이름 없는 분기가 0개라 그 규칙의 조건
 *     ②(이름 없는 것이 정확히 하나)가 영영 안 맞는다. 적용해도 결과가 같다
 *     (시험 「이름 없는 분기가 하나도 없다」가 그것을 못으로 박는다).
 *   · 주석 영역 가르기 · 이음목 건너뛰기 · 끊어진 선 끝 이어 붙이기 — 전부 **좌표와
 *     연결선**이 있어야 뜻이 서는 일이다. 격자에는 둘 다 없다.
 */

export type CellGridTaskGraphInput = {
  sheetName: string;
  /** 노드 코드의 앞가지 — technical-task-sheet-plan.ts 가 정한다. */
  nodeCodePrefix: string;
  /** **자동으로 더하는 시작 노드의 제목** — 그 절차의 이름(머리말을 뗀 것). */
  startNodeTitle: string;
  block: CellGridBlock;
  geometry: CellGridGeometry;
  /** 격자를 읽으며 쌓인 경고 가운데 **이 블록 것**만. */
  warnings: readonly CellGridWarning[];
};

/** 블록 하나의 셈 — 🔴 드라이런이 합계를 검산하는 자리다. */
export type CellGridCounts = {
  boxes: number;
  /** 엑셀에 적혀 있던 이음(정상 + NG). */
  links: number;
  normalLinks: number;
  ngLinks: number;
  /** 자동으로 더한 시작 분기(= 들어오는 선이 없던 상자 수). */
  startEdges: number;
  nodes: number;
  edges: number;
};

export type CellGridTaskGraph = {
  /**
   * 🔵 **도형 길과 같은 모양**으로 돌려준다. 그래야 들여오기 스크립트와 잇기
   * 스크립트가 두 길을 한 코드로 다룬다 — 도형에만 있는 칸
   * (`droppedShapes`·`labelBindings`·`reboundEndpoints`…)은 비어 있고,
   * 그것이 곧 「이 절차는 도형에서 온 것이 아니다」의 증거다.
   */
  result: TechnicalTaskGraphResult;
  counts: CellGridCounts;
};

/**
 * 격자 경고를 절차의 [검증 결과] 한 줄로 옮길 때 쓰는 갈래.
 *
 * 🔵 `UNSUPPORTED_OBJECT` 가 많은 것은 도형 쪽이 「노드로 안 만든 도형」에 쓰는 갈래와
 * 같은 결로 맞춘 것이다 — 사람이 [검증 결과] 화면에서 두 길을 같은 눈으로 본다.
 */
const WARNING_ISSUE_TYPE: Record<CellGridWarningCode, ProcedureValidationIssueType> = {
  IRREGULAR_GRID: "UNSUPPORTED_OBJECT",
  IRREGULAR_BLOCK_ROWS: "UNSUPPORTED_OBJECT",
  MISSING_TARGET_BOX: "DANGLING_CONNECTOR",
  MISSING_ARROW: "DANGLING_CONNECTOR",
  ORPHAN_ARROW: "DANGLING_CONNECTOR",
  UNKNOWN_LABEL_WORD: "AMBIGUOUS_LABEL_EDGE_MATCH",
  UNEXPECTED_DIRECTION: "AMBIGUOUS_LABEL_EDGE_MATCH",
  BOX_OUTSIDE_BLOCK: "UNSUPPORTED_OBJECT",
  ISOLATED_BOX: "UNSUPPORTED_OBJECT",
  UNREAD_CELL: "UNSUPPORTED_OBJECT",
};

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 0 ? line : text.trim();
}

export function extractCellGridTaskGraph(input: CellGridTaskGraphInput): CellGridTaskGraph {
  const { sheetName, nodeCodePrefix, startNodeTitle, block, geometry } = input;
  const issues: ExtractedValidationIssue[] = [];

  // ── 0. 격자 읽개가 남긴 경고를 **그대로** 절차의 메모로 옮긴다 ──────────
  for (const warning of input.warnings) {
    issues.push({
      severity: warning.severity,
      issueType: WARNING_ISSUE_TYPE[warning.code],
      message: warning.message,
      sourceWorksheet: sheetName,
      sourceReference: warning.ref ? `cell:${warning.ref}` : null,
    });
  }

  // ── 1. 노드 차례 ───────────────────────────────────────────────────────
  // 읽기 순서 = 위에서 아래로, 같은 줄이면 왼쪽부터. 도형 쪽(`ac.y - bc.y || ac.x -
  // bc.x`)과 같은 차례이고, 사람이 격자를 훑는 차례와도 같다.
  const orderedBoxes = [...block.boxes].sort((a, b) => a.row - b.row || a.col - b.col);
  const nodeCodeByRef = new Map<string, string>();
  for (const box of orderedBoxes) nodeCodeByRef.set(box.ref, `${nodeCodePrefix}-${box.ref}`);

  // ── 2. 🔴 다른 절차를 가리키는 상자에서 **나가던** 이음을 버린다 ────────
  //
  // 도형 쪽 5-2 절과 같은 규칙이다(2026-11-05 사용자 결정): `(번호)` 참조 노드는
  // 언제나 「다른 절차로 이어가는 종료」가 되고, 종료는 나가는 분기를 가질 수 없다.
  // 🔵 실측으로 `(MB) 수리` 에는 그런 상자가 **0개**다. 그래도 적어 두는 까닭은,
  //    없을 때 아무 일도 안 하는 것과 **있을 때 조용히 깨지는 것**이 다르기 때문이다
  //    (없으면 END 에 나가는 분기가 달려 구조 검증이 ERROR 를 낸다).
  const nextProcedureByRef = new Map<string, string>();
  for (const box of orderedBoxes) {
    const stageNumber = matchNextProcedureStageNumber(box.text.trim());
    if (stageNumber !== null) nextProcedureByRef.set(box.ref, stageNumber);
  }

  const abandoned: CellGridLink[] = [];
  const graphLinks: CellGridLink[] = [];
  for (const link of block.links) {
    if (nextProcedureByRef.has(link.fromRef)) abandoned.push(link);
    else graphLinks.push(link);
  }
  for (const link of abandoned) {
    const from = orderedBoxes.find((b) => b.ref === link.fromRef);
    const to = orderedBoxes.find((b) => b.ref === link.toRef);
    issues.push({
      severity: "WARNING",
      issueType: "INVALID_NEXT_PROCEDURE_LINK",
      message:
        `"${firstLine(from?.text ?? link.fromRef)}"을(를) (${nextProcedureByRef.get(link.fromRef)})번 절차로 ` +
        `이어가는 종료 노드로 만들면서, 원본 격자에 있던 "${link.labelText}" 이음` +
        `(→ "${firstLine(to?.text ?? link.toRef)}")을 버렸습니다 — 종료 노드는 나가는 분기를 가질 수 없습니다.`,
      sourceWorksheet: sheetName,
      sourceReference: `cell:${link.labelRef}`,
    });
  }

  // ── 3. 상자마다 나가는 갈래 ────────────────────────────────────────────
  const outgoingByRef = new Map<string, ProcedureBranchType[]>();
  for (const link of graphLinks) {
    const list = outgoingByRef.get(link.fromRef) ?? [];
    list.push(link.branchType);
    outgoingByRef.set(link.fromRef, list);
  }

  // ── 4. 노드 ────────────────────────────────────────────────────────────
  const nodes: TechnicalTaskNode[] = [];
  let sortOrder = 0;
  for (const box of orderedBoxes) {
    const text = box.text.trim();
    const nextProcedureStageNumber = nextProcedureByRef.get(box.ref) ?? null;
    const { nodeType, reason } = classifyTechnicalNodeType({
      text,
      outgoingBranchTypes: outgoingByRef.get(box.ref) ?? [],
      nextProcedureStageNumber,
    });
    const nodeCode = nodeCodeByRef.get(box.ref)!;
    if (nextProcedureStageNumber !== null) {
      // 🔴 도형 쪽과 같다 — 이어가기는 여기서 안 걸고 **비운 채** 만든 뒤 잇기
      //    단계가 채운다(절차끼리 가리키는 관계가 순환한다). 비웠다는 사실이
      //    [검증 결과] 한 줄로 남아야 사람이 그것을 찾아 잇는다.
      issues.push({
        severity: "WARNING",
        issueType: "INVALID_NEXT_PROCEDURE_LINK",
        message:
          `종료 노드 "${firstLine(box.text)}"의 이어갈 절차((${nextProcedureStageNumber})번)를 ` +
          `${PENDING_NEXT_PROCEDURE_MEMO_MARKER} — 절차들을 다 만든 뒤 잇기 단계에서 채웁니다.`,
        sourceWorksheet: sheetName,
        sourceReference: `node:${nodeCode}`,
      });
    }

    const { instructions, caution } = splitInstructionsAndCaution(box.text);
    const position = cellGridPosition(box);
    nodes.push({
      nodeCode,
      nodeType,
      nodeTypeReason: reason,
      nextProcedureStageNumber,
      origin: "EXCEL_SHAPE",
      // 🔴 **칸 글자 그대로**다(2026-11-05 사용자: 「원본 엑셀에서의 내용과 노드의
      //    제목의 내용이 같도록」). 앞의 `1.` 도 안 뗀다.
      title: text,
      description: text || null,
      instructions,
      safetyCaution: caution,
      positionX: position.positionX,
      positionY: position.positionY,
      sortOrder: sortOrder++,
      sourceWorksheet: sheetName,
      // 🔵 도형이 아니므로 도형 번호는 없고, 대신 **병합 범위**가 출처다.
      sourceShapeId: null,
      sourceCellRange: box.mergeRange,
    });
  }

  // ── 5. 🔴 시작 노드를 자동으로 더한다 — 도형 쪽 6-2 절과 같은 방식 ──────
  //
  // 엑셀에 없는 것을 더하는 일이다. 안 더하면 시작점이 없어 편집기의 [검증]이
  // **모든 노드를 도달 불가**로 표시한다(2026-11-05 사용자 결정으로 더하게 됐다).
  // 들어오는 이음이 없는 상자 **전부**에 기본 분기로 잇는다 — 하나만 이으면 나머지
  // 뿌리가 그대로 남는다. 🔵 분기 이름은 안 붙인다(엑셀에 없는 이름이다).
  const incomingRefs = new Set(graphLinks.map((l) => l.toRef));
  const rootBoxes: CellGridBox[] = orderedBoxes.filter((b) => !incomingRefs.has(b.ref));
  const startNodeCode = `${nodeCodePrefix}-start`;
  const startEdges: ExtractedEdge[] = [];

  if (nodes.length > 0 && rootBoxes.length > 0) {
    const position = cellGridStartPosition(rootBoxes, geometry);
    nodes.unshift({
      nodeCode: startNodeCode,
      nodeType: "START",
      nodeTypeReason: "엑셀에 없는 시작 노드를 자동으로 더했다 (2026-11-05 결정)",
      nextProcedureStageNumber: null,
      origin: "AUTO_START",
      title: startNodeTitle,
      description: null,
      instructions: null,
      safetyCaution: null,
      positionX: position.positionX,
      positionY: position.positionY,
      sortOrder: 0,
      sourceWorksheet: sheetName,
      sourceShapeId: null,
      // 🔵 블록의 **머리글 칸**이 출처다 — 이 노드의 제목이 거기서 왔다.
      sourceCellRange: block.headerRef,
    });
    for (const [index, node] of nodes.entries()) node.sortOrder = index;

    for (const root of rootBoxes) {
      startEdges.push({
        fromNodeCode: startNodeCode,
        toNodeCode: nodeCodeByRef.get(root.ref)!,
        branchType: "DEFAULT",
        branchLabel: null,
        sortOrder: 0,
        sourceConnectorId: null,
      });
    }

    issues.push({
      severity: "INFO",
      issueType: "INVALID_START_STRUCTURE",
      message:
        `시작(START) 노드 "${startNodeTitle}"을(를) **자동으로 더했습니다** — 엑셀 격자에는 시작 표식이 ` +
        `없습니다. 들어오는 이음이 없던 상자 ${rootBoxes.length}개에 기본 분기로 이었습니다.`,
      sourceWorksheet: sheetName,
      sourceReference: `node:${startNodeCode}`,
    });
  } else if (nodes.length > 0) {
    // 🔴 뿌리가 없다 = 모든 상자가 어딘가에서 이음을 받는다(순환). 시작 노드를
    //    만들면 나가는 분기가 없어 구조 검증이 ERROR 를 낸다 — 안 만들고 알린다.
    issues.push({
      severity: "WARNING",
      issueType: "INVALID_START_STRUCTURE",
      message:
        "들어오는 이음이 없는 상자가 하나도 없어(모두 순환 안에 있음) 시작 노드를 더하지 못했습니다 — " +
        "편집기에서 시작점을 직접 정해야 합니다.",
      sourceWorksheet: sheetName,
      sourceReference: null,
    });
  }

  // ── 6. 분기 ────────────────────────────────────────────────────────────
  // 차례는 **노드의 읽기 순서**를 따른다(도형 쪽 7절과 같다).
  const sortOrderByNodeCode = new Map(nodes.map((n) => [n.nodeCode, n.sortOrder]));
  const edges: ExtractedEdge[] = [
    ...startEdges,
    ...graphLinks
      .map((link) => ({
        fromNodeCode: nodeCodeByRef.get(link.fromRef)!,
        toNodeCode: nodeCodeByRef.get(link.toRef)!,
        branchType: link.branchType,
        branchLabel: link.branchLabel,
        sortOrder: 0,
        // 🔵 연결선 번호가 없으므로 **이름표 칸 주소**를 출처로 남긴다. 사람이
        //    엑셀에서 그 칸을 바로 찾아갈 수 있어야 검산이 된다.
        sourceConnectorId: `cell:${link.labelRef}`,
      }))
      .sort(
        (a, b) =>
          (sortOrderByNodeCode.get(a.fromNodeCode) ?? 0) - (sortOrderByNodeCode.get(b.fromNodeCode) ?? 0) ||
          (sortOrderByNodeCode.get(a.toNodeCode) ?? 0) - (sortOrderByNodeCode.get(b.toNodeCode) ?? 0)
      ),
  ].map((edge, index) => ({ ...edge, sortOrder: index }));

  return {
    result: {
      nodes,
      edges,
      // 🔵 아래 다섯은 **도형 길에만 있는 것**이다. 비어 있는 것이 곧 「이 절차는
      //    도형에서 온 것이 아니다」의 증거라, 억지로 채우지 않는다.
      droppedShapes: [],
      droppedConnectors: [],
      labelBindings: [],
      reboundEndpoints: [],
      isolationRuleSkippedReason: null,
      annotationBoundaryX: null,
      annotationBoundaryReason: "셀 격자 흐름도다 — 도형이 없어 본문/주석 경계를 잴 것이 없다.",
      issues,
    },
    counts: {
      boxes: block.boxes.length,
      links: graphLinks.length,
      normalLinks: graphLinks.filter((l) => l.branchType === "NORMAL").length,
      ngLinks: graphLinks.filter((l) => l.branchType === "NG").length,
      startEdges: startEdges.length,
      nodes: nodes.length,
      edges: edges.length,
    },
  };
}
