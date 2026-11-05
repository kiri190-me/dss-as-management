import { classifyBranchLabel } from "./branch-classification";
import {
  connectorSegment,
  distancePointToRect,
  distancePointToSegment,
  geometryCenter,
  EMU_PER_PIXEL,
  type DrawingGeometry,
  type Point,
} from "./drawing-geometry";
import type { ExtractedEdge, ExtractedNode, ExtractedValidationIssue } from "./types";
import type { ProcedureBranchType, ProcedureNodeType } from "@/lib/domain/procedure-template-types";

/**
 * ============================================================================
 * 엑셀 **도형 흐름도 한 장 → 기술 작업 절차 하나**
 * ============================================================================
 * `extract-shape-graph.ts`(기존 FULL_SERVICE 들여오기)와 **나란히 서는 두 번째 길**
 * 이다. 기존 경로는 한 글자도 건드리지 않는다 — DB 에 이미 그 결과가 들어 있고,
 * 시트 여럿을 하나로 합치는 그쪽 요구는 여기 요구와 정반대다(여기는 시트 하나당
 * 절차 하나).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 기존 경로와 **일부러 다르게** 간 곳 넷
 * ──────────────────────────────────────────────────────────────────────
 * 1. **좌표를 칸(col/row)이 아니라 EMU 로 읽는다.** 까닭은 drawing-geometry.ts
 *    머리말에 있다 — 칸 중점으로 재면 분기 레이블 둘이 같은 선에 붙는다(실측).
 * 2. **레이블을 선의 중점이 아니라 선분까지의 거리로 붙인다.** 그리고 레이블·선을
 *    **1:1 로** 맞춘다(가까운 쌍부터 차례로). 한 선이 레이블 둘에 덮어써지는 일이 없다.
 * 3. **맨 위 노드를 START 로 바꾸지 않는다.** 기존 규칙은 「읽기 순서 첫 노드 +
 *    들어오는 선 없음 → START」인데, START 는 실행이 시작되는 순간 **자동으로 완료
 *    처리되는 표식**이다(procedure-execution-topology.ts). 진짜 작업이 적힌 상자를
 *    START 로 바꾸면 그 작업이 실행 목록에서 통째로 사라진다. 대신 「시작 노드가
 *    없다」를 보고해 사람이 편집기에서 더하게 한다.
 * 4. **버린 도형을 전부 까닭과 함께 돌려준다.** 조용히 버리면 무엇이 사라졌는지
 *    아무도 모른다 — 지난 들여오기가 못 쓰게 된 가장 큰 까닭이다.
 *
 * 여기에도 AI 해석은 없다. 모든 값은 도형 글자를 그대로 옮겼거나, 아래에 적힌
 * 고정 규칙으로 기계적으로 끌어낸 것이다.
 */

// ---------------------------------------------------------------------------
// 입력 — DB 도 zip 도 모른다(시험이 지어낸 값으로 그대로 세울 수 있어야 한다)
// ---------------------------------------------------------------------------

export type TechnicalTaskShapeInput = DrawingGeometry & {
  /** 도형 안의 글자. 줄바꿈은 `\n`. */
  text: string;
};

export type TechnicalTaskConnectorInput = DrawingGeometry & {
  /** `<a:stCxn id>` — 이 선이 **나가는** 도형 번호. */
  fromShapeId: string | null;
  /** `<a:endCxn id>` — 이 선이 **닿는** 도형 번호. */
  toShapeId: string | null;
  /**
   * 곧은 선인가(`straightConnector1`·`line`). 꺾인 선은 제 상자 안에서 ㄱ 자로
   * 돌기 때문에 선분 하나로 못 잰다 — drawing-geometry.ts 의 거리 함수가 갈린다.
   */
  isStraight: boolean;
};

export type TechnicalTaskGraphInput = {
  sheetName: string;
  /** 노드 코드의 앞가지 — technical-task-sheet-plan.ts 가 정한다. */
  nodeCodePrefix: string;
  shapes: TechnicalTaskShapeInput[];
  connectors: TechnicalTaskConnectorInput[];
};

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

/** 도형을 노드로 안 만든 까닭. 드라이런이 이 값을 사람 말로 풀어 찍는다. */
export type DroppedShapeReason =
  | "BRANCH_LABEL"
  | "EMPTY_BOX"
  | "ANNOTATION_REGION"
  | "DUPLICATE_SHAPE_ID";

export type DroppedShape = {
  shapeId: string;
  /** 도형의 첫 줄. 글자가 없으면 빈 문자열. */
  text: string;
  reason: DroppedShapeReason;
  detail: string;
};

/** 연결선을 분기로 안 만든 까닭. */
export type DroppedConnectorReason =
  | "UNRESOLVED_ENDPOINT"
  | "POINTS_AT_DROPPED_SHAPE"
  | "SELF_EDGE"
  /**
   * 🔴 `(번호)` 참조 노드에서 **나가던** 분기. 그 노드는 다른 절차로 이어가는
   * 종료가 되고, 종료는 나가는 분기를 가질 수 없어 버린다(2026-11-05 사용자 결정).
   * **원본 흐름도에는 있던 흐름이 절차에서는 사라진다** — 그래서 조용히 못 버린다.
   */
  | "ABANDONED_FOR_NEXT_PROCEDURE";

export type DroppedConnector = {
  connectorId: string;
  fromShapeId: string | null;
  toShapeId: string | null;
  reason: DroppedConnectorReason;
  detail: string;
};

export type BranchLabelBinding = {
  connectorId: string;
  labelShapeId: string;
  labelText: string;
  branchType: ProcedureBranchType;
  /** EMU 단위 거리 — 레이블 상자 가운데에서 선까지. */
  distance: number;
  /** 같은 레이블의 **차점** 선까지의 거리(없으면 null). */
  runnerUpDistance: number | null;
  /** 차점과 충분히 벌어졌는가. 아니면 사람이 그 한 줄만 눈으로 본다. */
  confident: boolean;
};

export type TechnicalTaskNode = ExtractedNode & {
  /** 어느 규칙이 이 유형을 정했는가 — 드라이런이 노드마다 함께 찍는다. */
  nodeTypeReason: string;
  /** 글자가 `(번호)` 로 시작하면 그 번호. 다른 절차로 이어가기 후보다. */
  nextProcedureStageNumber: string | null;
};

export type TechnicalTaskGraphResult = {
  nodes: TechnicalTaskNode[];
  edges: ExtractedEdge[];
  droppedShapes: DroppedShape[];
  droppedConnectors: DroppedConnector[];
  labelBindings: BranchLabelBinding[];
  /** 본문/주석 경계가 선 x 좌표(EMU). 경계를 못 세웠으면 null. */
  annotationBoundaryX: number | null;
  /** 경계를 그렇게 정한(또는 못 정한) 까닭 — 드라이런이 그대로 찍는다. */
  annotationBoundaryReason: string;
  issues: ExtractedValidationIssue[];
};

// ---------------------------------------------------------------------------
// 규칙 상수 — 숫자를 박을 때는 바로 옆에 까닭을 적는다
// ---------------------------------------------------------------------------

/**
 * 글자가 이것뿐이면 **상자가 비었다**고 본다. `*` 는 이 워크북에서 「주의」를 뜻하는
 * 머리 기호라, 그것만 든 상자는 본문 옆에 세워 둔 주석 틀이다(Phase 1 보고서 §2/§6).
 */
const EMPTY_BOX_TEXT_RE = /^[\s*·ㆍ・]*$/;

/** `(12) 출하 완료` 처럼 **다른 절차의 번호**로 시작하는 글자. */
const NEXT_PROCEDURE_REF_RE = /^\s*\(\s*(\d+)\s*\)/;

/**
 * 레이블이 선에서 **제 상자 크기만큼**보다 더 떨어져 있으면 그 선의 레이블이 아니다.
 * 고정 EMU 값 대신 상자 크기로 재는 까닭은 시트마다 글꼴·배율이 달라서다 —
 * 작은 「NO」 상자와 긴 설명 상자에 같은 자를 대면 한쪽은 반드시 틀린다.
 */
function maxBindDistance(label: TechnicalTaskShapeInput): number {
  return label.cx + label.cy;
}

/**
 * 차점과 이만큼은 벌어져야 「확실히 이 선」이다. 실측(기준 시트)에서 맞는 쌍의
 * 비가 1.47배·3.87배였고, 1.25 는 그 아래쪽 표본도 통과하면서 거의 비긴 경우를
 * 걸러 낸다. 못 넘으면 버리지 않고 **경고로 함께 보고**한다.
 */
const CONFIDENT_MARGIN_RATIO = 1.25;

// ---------------------------------------------------------------------------

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 0 ? line : text.trim();
}

/**
 * 노드 제목 — **첫 줄**이되, 이어지는 줄이 여는 괄호로 시작하면 **붙여 읽는다.**
 *
 * 흐름도 상자는 「무엇을 한다」를 첫 줄에, 그 보충을 괄호로 아랫줄에 적는 일이 잦다.
 * 첫 줄만 제목으로 쓰면 목록에서 그 보충이 통째로 안 보인다(전문은 `description`
 * 에 그대로 남지만, 사람이 보는 자리는 제목이다). 괄호로 **시작하는** 줄만
 * 붙이므로, 줄마다 다른 작업이 적힌 여러 줄짜리 상자는 첫 줄 그대로다.
 */
function nodeTitle(text: string, shapeId: string): string {
  const lines = text.split("\n").map((l) => l.trim());
  const parts = [lines[0] ?? ""];
  for (let i = 1; i < lines.length; i++) {
    if (!/^[(（[]/.test(lines[i])) break;
    parts.push(lines[i]);
  }
  const title = parts.join("").trim() || text.trim();
  return title.length > 0 ? title : `(제목 없음 · shape#${shapeId})`;
}

/**
 * `*` 로 시작하는 줄은 주의사항이라는 이 워크북의 표기(extract-shape-graph.ts 와 같은
 * 규칙 · Phase 1 보고서 §2/§6)를 따라 본문과 주의를 가른다.
 */
function splitInstructionsAndCaution(text: string): { instructions: string; caution: string | null } {
  const lines = text.split("\n");
  const cautionLines = lines.filter((l) => l.trim().startsWith("*"));
  const instructionLines = lines.filter((l) => !l.trim().startsWith("*"));
  return {
    instructions: instructionLines.join(" ").trim() || text.trim(),
    caution: cautionLines.length > 0 ? cautionLines.map((l) => l.trim()).join(" ") : null,
  };
}

/**
 * 글자 전체가 분기 어휘(NG·YES·NO·OK·정상)와 **정확히** 같은가.
 *
 * 어휘를 여기서 새로 적지 않고 `classifyBranchLabel` 에 물어본다 — 분기 어휘의
 * 유일한 출처가 거기이고, 두 벌로 적어 두면 한쪽만 늘어나는 날 조용히 어긋난다.
 * DEFAULT(글자 없음)와 CUSTOM(아무 글자나)은 분기 어휘가 아니다.
 */
function isBranchLabelText(text: string): boolean {
  const branchType = classifyBranchLabel(text.replace(/\n/g, " ").trim()).branchType;
  return branchType !== "DEFAULT" && branchType !== "CUSTOM";
}

/**
 * 본문 덩어리와 주석 덩어리 사이의 **빈 세로 띠**를 찾는다.
 *
 * 흐름도 시트는 진짜 절차를 왼쪽에 세우고, 설명용 큰 상자와 캡처 그림을 오른쪽에
 * 따로 둔다. 둘 사이에는 도형이 하나도 없는 가로 공백이 생긴다.
 *
 * 🔴 **열 번호를 박지 않는다.** 시트마다 열 폭이 달라서 「9열부터 주석」 같은 값은
 * 다음 시트에서 바로 틀린다. 대신 도형들의 x 구간을 합쳐 덩어리를 만들고, 그 사이
 * 틈을 후보로 삼는다.
 *
 * 🔴 틈이 있다고 바로 가르지 않는다 — 본문 한가운데에도 세로 공백은 생긴다.
 * **오른쪽의 어떤 도형도 연결선을 내보내지 않을 때만** 그 틈을 경계로 받아들인다.
 * 주석 상자는 **가리켜질 뿐 가리키지 않는다**는 성질이 본문과 주석을 가르는 진짜
 * 차이이고, 좌표는 그 후보를 좁혀 줄 뿐이다.
 *
 * 🔵 그래도 「마지막 노드가 멀찍이 오른쪽에 혼자 서 있는」 시트에서는 그 노드가
 * 주석으로 읽힐 수 있다(나가는 선이 없으니 조건을 통과한다). 그래서 이 규칙으로
 * 버린 도형은 **글자가 있으면 경고**로 따로 올린다. 조용히 사라지지 않는다.
 */
function findAnnotationBoundary(
  shapes: readonly TechnicalTaskShapeInput[],
  connectors: readonly TechnicalTaskConnectorInput[]
): { boundaryX: number | null; reason: string } {
  if (shapes.length === 0) return { boundaryX: null, reason: "도형이 없다." };

  const intervals = shapes
    .map((s) => ({ start: s.x, end: s.x + s.cx }))
    .sort((a, b) => a.start - b.start);
  const clusters: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const last = clusters[clusters.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      clusters.push({ ...interval });
    }
  }
  if (clusters.length < 2) {
    return { boundaryX: null, reason: "도형 x 구간이 한 덩어리라 가를 틈이 없다 — 시트 전체가 본문이다." };
  }

  const emitterShapeIds = new Set(
    connectors.map((c) => c.fromShapeId).filter((id): id is string => id !== null)
  );

  for (let i = 0; i < clusters.length - 1; i++) {
    const gapStart = clusters[i].end;
    const gapEnd = clusters[i + 1].start;
    const right = shapes.filter((s) => s.x >= gapEnd);
    if (right.length === 0) continue;
    const emittersOnRight = right.filter((s) => emitterShapeIds.has(s.id));
    if (emittersOnRight.length > 0) continue;
    return {
      boundaryX: gapEnd,
      reason:
        `도형이 ${clusters.length}덩어리이고, ${i + 1}번째 틈(${Math.round(gapStart / EMU_PER_PIXEL)}px ~ ` +
        `${Math.round(gapEnd / EMU_PER_PIXEL)}px) 오른쪽의 도형 ${right.length}개가 연결선을 하나도 ` +
        `내보내지 않는다 — 주석 영역으로 본다.`,
    };
  }
  return {
    boundaryX: null,
    reason: `도형이 ${clusters.length}덩어리지만 모든 틈의 오른쪽에서 연결선이 나간다 — 시트 전체가 본문이다.`,
  };
}

/**
 * 노드 유형을 정한다. 위에서부터 차례로 보고 **처음 맞는 규칙이 이긴다.**
 *
 * 🔴 **도형 모양(`prstGeom`)은 근거로 못 쓴다.** 이 워크북의 흐름도 도형은 전수
 * 조사에서 사실상 전부 `rect` 였다(판단도 작업도 같은 네모다). 마름모를 찾는
 * 규칙을 두면 영영 한 번도 안 걸린다.
 *
 * 🔴 **START 를 여기서 만들지 않는다** — 모듈 머리말 3번.
 *
 * 🔵 CHECKLIST·TROUBLESHOOTING 도 안 만든다. 그 둘은 자식 표(체크 항목 · 진단 항목)가
 * 있어야 뜻이 서는 **담는 그릇**이고, 도형 흐름도에는 그 자식이 없다. 수동 작성에
 * 열린 일곱 유형(MANUAL_TECHNICAL_NODE_TYPE_CODES)과 같은 범위다.
 */
function classifyTechnicalNodeType(params: {
  text: string;
  outgoingBranchTypes: ProcedureBranchType[];
  nextProcedureStageNumber: string | null;
}): { nodeType: ProcedureNodeType; reason: string } {
  const { text, outgoingBranchTypes, nextProcedureStageNumber } = params;

  // 🔴 참조 노드는 **언제나** 종료다. 나가는 분기는 부르는 쪽이 이 함수에 오기 전에
  //    이미 버렸다(ABANDONED_FOR_NEXT_PROCEDURE) — 그래서 여기서 또 따지지 않는다.
  if (nextProcedureStageNumber !== null) {
    return {
      nodeType: "END",
      reason: `글자가 (${nextProcedureStageNumber}) 로 시작한다 — 다른 절차로 이어가는 종료`,
    };
  }
  if (outgoingBranchTypes.length === 0) {
    return { nodeType: "END", reason: "나가는 선이 없다" };
  }

  const distinct = new Set(outgoingBranchTypes);
  const hasConditional =
    distinct.has("NG") || distinct.has("YES") || distinct.has("NO") || distinct.has("NORMAL");
  if (hasConditional || outgoingBranchTypes.length >= 2) {
    return {
      nodeType: "DECISION",
      reason: hasConditional
        ? `분기 이름이 붙은 선이 나간다 (${[...distinct].join("·")})`
        : `나가는 선이 ${outgoingBranchTypes.length}개다`,
    };
  }

  if (/(보고서|리포트|report)[^\n]{0,12}(제출|업로드|송부)|업로드|클라우드\s*BOX|파일철에\s*보관/i.test(text)) {
    return { nodeType: "DOCUMENT_REFERENCE", reason: "글자에 문서 제출/보관 표현이 있다" };
  }
  if (/교환|교체|조정\s*작업|재\s*측정|재\s*확인\s*후|부품\s*교환|재\s*진행|재\s*실시/.test(text)) {
    return { nodeType: "CORRECTIVE_ACTION", reason: "글자에 조치/재작업 표현이 있다" };
  }
  if (/확인|점검|검사|측정/.test(text)) {
    return { nodeType: "INSPECTION", reason: "글자에 확인/점검/검사/측정이 있다" };
  }
  return { nodeType: "TASK", reason: "위 규칙에 걸리지 않는다" };
}

/** 레이블 가운데에서 연결선까지의 거리. 곧은 선은 선분, 꺾인 선은 제 상자로 잰다. */
function distanceToConnector(labelCenter: Point, connector: TechnicalTaskConnectorInput): number {
  if (!connector.isStraight) return distancePointToRect(labelCenter, connector);
  const { start, end } = connectorSegment(connector);
  return distancePointToSegment(labelCenter, start, end);
}

export function extractTechnicalTaskGraph(input: TechnicalTaskGraphInput): TechnicalTaskGraphResult {
  const { sheetName, nodeCodePrefix } = input;
  const issues: ExtractedValidationIssue[] = [];
  const droppedShapes: DroppedShape[] = [];
  const droppedConnectors: DroppedConnector[] = [];

  // ── 0. 같은 번호가 두 번 나오면 뒤엣것을 버린다 ─────────────────────────
  // 연결선은 도형을 **번호로** 가리킨다. 번호가 겹치면 어느 쪽을 가리키는지
  // 영영 못 가리므로 그래프에 올리지 않는다.
  const shapes: TechnicalTaskShapeInput[] = [];
  const seenShapeIds = new Set<string>();
  for (const shape of input.shapes) {
    if (seenShapeIds.has(shape.id)) {
      droppedShapes.push({
        shapeId: shape.id,
        text: firstLine(shape.text),
        reason: "DUPLICATE_SHAPE_ID",
        detail: "같은 도형 번호가 이미 나왔다 — 연결선이 어느 쪽을 가리키는지 가릴 수 없다.",
      });
      issues.push({
        severity: "ERROR",
        issueType: "DUPLICATE_NODE_CODE",
        message: `도형 번호 ${shape.id}이(가) 두 번 나와 뒤엣것을 버렸습니다.`,
        sourceWorksheet: sheetName,
        sourceReference: `shape#${shape.id}`,
      });
      continue;
    }
    seenShapeIds.add(shape.id);
    shapes.push(shape);
  }

  const endpointIds = new Set<string>();
  for (const c of input.connectors) {
    if (c.fromShapeId) endpointIds.add(c.fromShapeId);
    if (c.toShapeId) endpointIds.add(c.toShapeId);
  }

  // ── 1. 분기 레이블 ─────────────────────────────────────────────────────
  // 글자가 분기 어휘와 정확히 같고, **연결선이 한 번도 가리키지 않는** 도형.
  // 뒤 조건이 없으면 글자가 "정상" 하나뿐인 진짜 작업 상자를 레이블로 먹는다.
  const labelShapes = shapes.filter((s) => !endpointIds.has(s.id) && isBranchLabelText(s.text));
  const labelShapeIds = new Set(labelShapes.map((s) => s.id));

  // ── 2. 빈 상자 ─────────────────────────────────────────────────────────
  // 노드에는 제목이 있어야 한다. 글자가 없거나 주의 기호뿐인 상자는 본문 옆에
  // 세워 둔 **설명 틀**이다(연결선이 가리키고 있어도 마찬가지다).
  const emptyShapeIds = new Set(
    shapes.filter((s) => !labelShapeIds.has(s.id) && EMPTY_BOX_TEXT_RE.test(s.text)).map((s) => s.id)
  );

  // ── 3. 주석 영역 ───────────────────────────────────────────────────────
  const { boundaryX, reason: annotationBoundaryReason } = findAnnotationBoundary(shapes, input.connectors);
  const annotationShapeIds = new Set(
    boundaryX === null ? [] : shapes.filter((s) => s.x >= boundaryX).map((s) => s.id)
  );

  for (const shape of shapes) {
    if (labelShapeIds.has(shape.id)) continue; // 레이블은 선에 붙인 뒤에 보고한다
    if (emptyShapeIds.has(shape.id)) {
      droppedShapes.push({
        shapeId: shape.id,
        text: firstLine(shape.text),
        reason: "EMPTY_BOX",
        detail: "글자가 없거나 주의 기호뿐이다 — 노드의 제목이 될 글자가 없다.",
      });
      continue;
    }
    if (annotationShapeIds.has(shape.id)) {
      droppedShapes.push({
        shapeId: shape.id,
        text: firstLine(shape.text),
        reason: "ANNOTATION_REGION",
        detail: `본문/주석 경계(${Math.round(boundaryX! / EMU_PER_PIXEL)}px) 오른쪽이다.`,
      });
      // 글자가 든 상자를 좌표만 보고 버리는 것은 이 규칙 가운데 **가장 약한**
      // 판단이다. 사람이 반드시 한 번 보게 경고로 올린다.
      issues.push({
        severity: "WARNING",
        issueType: "UNSUPPORTED_OBJECT",
        message: `글자가 있는 도형을 주석 영역으로 보고 제외했습니다: "${firstLine(shape.text)}"`,
        sourceWorksheet: sheetName,
        sourceReference: `shape#${shape.id}`,
      });
    }
  }

  const nodeShapes = shapes.filter(
    (s) => !labelShapeIds.has(s.id) && !emptyShapeIds.has(s.id) && !annotationShapeIds.has(s.id)
  );
  const nodeShapeIds = new Set(nodeShapes.map((s) => s.id));

  /**
   * 글자가 `(번호)` 로 시작하는 노드 — **다른 절차로 이어가는 종료**가 된다.
   * 아래에서 이 노드들에서 나가던 분기를 버린다(2026-11-05 사용자 결정).
   */
  const nextProcedureRefShapeIds = new Set(
    nodeShapes.filter((s) => NEXT_PROCEDURE_REF_RE.test(s.text.trim())).map((s) => s.id)
  );

  // ── 4. 연결선 → 분기 ───────────────────────────────────────────────────
  const keptConnectors: TechnicalTaskConnectorInput[] = [];
  for (const connector of input.connectors) {
    if (!connector.fromShapeId || !connector.toShapeId) {
      droppedConnectors.push({
        connectorId: connector.id,
        fromShapeId: connector.fromShapeId,
        toShapeId: connector.toShapeId,
        reason: "UNRESOLVED_ENDPOINT",
        detail: "선의 시작 또는 끝이 어떤 도형에도 묶여 있지 않다(손으로 그려 붙인 선).",
      });
      issues.push({
        severity: "ERROR",
        issueType: "DANGLING_CONNECTOR",
        message: `연결선(connector#${connector.id})의 시작 또는 끝 도형 참조가 없습니다.`,
        sourceWorksheet: sheetName,
        sourceReference: `connector#${connector.id}`,
      });
      continue;
    }
    if (connector.fromShapeId === connector.toShapeId) {
      droppedConnectors.push({
        connectorId: connector.id,
        fromShapeId: connector.fromShapeId,
        toShapeId: connector.toShapeId,
        reason: "SELF_EDGE",
        detail: "시작과 끝이 같은 도형이다.",
      });
      continue;
    }
    if (!nodeShapeIds.has(connector.fromShapeId) || !nodeShapeIds.has(connector.toShapeId)) {
      const missing = !nodeShapeIds.has(connector.fromShapeId)
        ? connector.fromShapeId
        : connector.toShapeId;
      const known = seenShapeIds.has(missing);
      droppedConnectors.push({
        connectorId: connector.id,
        fromShapeId: connector.fromShapeId,
        toShapeId: connector.toShapeId,
        reason: "POINTS_AT_DROPPED_SHAPE",
        detail: known
          ? `도형 ${missing}이(가) 노드가 아니다(주석 상자 또는 분기 레이블) — 주석선으로 본다.`
          : `도형 ${missing}을(를) 이 시트에서 찾을 수 없다.`,
      });
      if (!known) {
        issues.push({
          severity: "ERROR",
          issueType: "MISSING_SOURCE_NODE",
          message: `연결선(connector#${connector.id})이 가리키는 도형(shape#${missing})을 찾을 수 없습니다.`,
          sourceWorksheet: sheetName,
          sourceReference: `connector#${connector.id}`,
        });
      }
      continue;
    }
    keptConnectors.push(connector);
  }

  // ── 5. 레이블 ↔ 선 1:1 맞추기 ──────────────────────────────────────────
  // 모든 (레이블, 선) 쌍의 거리를 재서 **가까운 쌍부터** 차례로 묶는다. 양쪽 모두
  // 아직 안 쓰인 쌍만 묶으므로, 한 선이 레이블 둘에 덮어써지거나 한 레이블이 선
  // 둘에 붙는 일이 없다. 레이블 쪽에서만 최근접을 고르면(= 기존 방식) 두 레이블이
  // 같은 선을 고르고 뒤엣것이 앞엣것을 지운다.
  type Pair = { label: TechnicalTaskShapeInput; connector: TechnicalTaskConnectorInput; distance: number };
  const pairs: Pair[] = [];
  const bestByLabel = new Map<string, number[]>();
  for (const label of labelShapes) {
    const center = geometryCenter(label);
    const limit = maxBindDistance(label);
    const distances: number[] = [];
    for (const connector of keptConnectors) {
      const distance = distanceToConnector(center, connector);
      distances.push(distance);
      if (distance <= limit) pairs.push({ label, connector, distance });
    }
    bestByLabel.set(label.id, distances.sort((a, b) => a - b));
  }
  pairs.sort((a, b) => a.distance - b.distance);

  const labelBindings: BranchLabelBinding[] = [];
  const usedLabelIds = new Set<string>();
  const labelByConnectorId = new Map<string, BranchLabelBinding>();
  for (const pair of pairs) {
    if (usedLabelIds.has(pair.label.id)) continue;
    if (labelByConnectorId.has(pair.connector.id)) continue;
    // 🔴 `find(d => d > distance)` 로 차점을 고르면 **똑같이 떨어진 선 둘**이 있을 때
    //    차점이 없는 것으로 읽혀 「확실함」이 된다 — 가장 모호한 경우가 가장 확실한
    //    것으로 뒤집힌다. 고른 값의 **바로 다음 칸**을 본다(값이 같으면 그대로 비긴다).
    const sorted = bestByLabel.get(pair.label.id) ?? [];
    const runnerUpDistance = sorted[sorted.indexOf(pair.distance) + 1] ?? null;
    const binding: BranchLabelBinding = {
      connectorId: pair.connector.id,
      labelShapeId: pair.label.id,
      labelText: pair.label.text.replace(/\n/g, " ").trim(),
      branchType: classifyBranchLabel(pair.label.text.replace(/\n/g, " ").trim()).branchType,
      distance: pair.distance,
      runnerUpDistance,
      confident: runnerUpDistance === null || runnerUpDistance >= pair.distance * CONFIDENT_MARGIN_RATIO,
    };
    usedLabelIds.add(pair.label.id);
    labelByConnectorId.set(pair.connector.id, binding);
    labelBindings.push(binding);
    if (!binding.confident) {
      issues.push({
        severity: "WARNING",
        issueType: "AMBIGUOUS_LABEL_EDGE_MATCH",
        message:
          `분기 라벨 "${binding.labelText}"이(가) 연결선(connector#${pair.connector.id})과 ` +
          `차점 연결선 사이에서 거의 비깁니다 (${Math.round(binding.distance)} vs ${Math.round(runnerUpDistance!)} EMU).`,
        sourceWorksheet: sheetName,
        sourceReference: `connector#${pair.connector.id}`,
      });
    }
  }

  // ── 5-2. 참조 노드에서 **나가던** 분기를 버린다 ────────────────────────
  // 🔴 2026-11-05 사용자 결정: `(번호)` 참조 노드는 언제나 「다른 절차로 이어가는
  //    종료」가 된다. 종료 노드는 나가는 분기를 가질 수 없으므로(구조 검증의
  //    INVALID_END_STRUCTURE) 그 분기를 **포기한다.**
  //
  // 🔴 버리는 자리를 **레이블을 붙인 뒤**로 잡은 것은 일부러다. 먼저 버리면 그
  //    분기에 붙어 있던 이름이 풀려 **옆의 엉뚱한 선에 가서 붙는다.** 붙인 뒤에
  //    버리면 이름은 제 선과 함께 사라지고, 아래 보고에 그 사실이 그대로 남는다.
  const abandonedConnectorIds = new Set(
    keptConnectors.filter((c) => nextProcedureRefShapeIds.has(c.fromShapeId!)).map((c) => c.id)
  );
  const graphConnectors = keptConnectors.filter((c) => !abandonedConnectorIds.has(c.id));

  for (const label of labelShapes) {
    const bound = usedLabelIds.has(label.id);
    const boundConnectorId = labelBindings.find((b) => b.labelShapeId === label.id)?.connectorId;
    droppedShapes.push({
      shapeId: label.id,
      text: firstLine(label.text),
      reason: "BRANCH_LABEL",
      detail: !bound
        ? "분기 이름이지만 붙일 연결선을 못 찾았다 — 이 분기에는 이름이 없다."
        : abandonedConnectorIds.has(boundConnectorId!)
          ? `연결선 ${boundConnectorId} 의 분기 이름이었으나, 그 분기를 버려서 이름도 함께 사라진다(아래 「버린 연결선」 참고).`
          : `연결선 ${boundConnectorId} 의 분기 이름으로 옮겼다.`,
    });
    if (!bound) {
      issues.push({
        severity: "WARNING",
        issueType: "AMBIGUOUS_LABEL_EDGE_MATCH",
        message: `분기 라벨 "${firstLine(label.text)}"에 붙일 연결선을 찾지 못했습니다.`,
        sourceWorksheet: sheetName,
        sourceReference: `shape#${label.id}`,
      });
    }
  }

  // ── 6. 노드 ────────────────────────────────────────────────────────────
  // 읽기 순서 = 위에서 아래로, 같은 높이면 왼쪽부터. 사람이 흐름도를 훑는 차례와
  // 같아서 sortOrder 가 안정적이다.
  const orderedNodeShapes = [...nodeShapes].sort((a, b) => {
    const ac = geometryCenter(a);
    const bc = geometryCenter(b);
    return ac.y - bc.y || ac.x - bc.x;
  });
  const nodeCodeByShapeId = new Map<string, string>();
  for (const shape of orderedNodeShapes) nodeCodeByShapeId.set(shape.id, `${nodeCodePrefix}-${shape.id}`);

  const outgoingByShapeId = new Map<string, ProcedureBranchType[]>();
  for (const connector of graphConnectors) {
    const branchType = labelByConnectorId.get(connector.id)?.branchType ?? "DEFAULT";
    const list = outgoingByShapeId.get(connector.fromShapeId!) ?? [];
    list.push(branchType);
    outgoingByShapeId.set(connector.fromShapeId!, list);
  }

  // 버린 분기를 **까닭과 함께** 보고한다. 노드 코드가 필요해서 여기까지 미뤘다.
  for (const connector of keptConnectors) {
    if (!abandonedConnectorIds.has(connector.id)) continue;
    const fromShape = nodeShapes.find((s) => s.id === connector.fromShapeId)!;
    const stageNumber = fromShape.text.trim().match(NEXT_PROCEDURE_REF_RE)?.[1] ?? "?";
    const toTitle = nodeTitle(nodeShapes.find((s) => s.id === connector.toShapeId)?.text ?? "", connector.toShapeId!);
    const labelText = labelByConnectorId.get(connector.id)?.labelText;
    const branchName = labelText ? `"${labelText}" 분기` : "이름 없는 분기";
    droppedConnectors.push({
      connectorId: connector.id,
      fromShapeId: connector.fromShapeId,
      toShapeId: connector.toShapeId,
      reason: "ABANDONED_FOR_NEXT_PROCEDURE",
      detail:
        `"${nodeTitle(fromShape.text, fromShape.id)}"은(는) (${stageNumber})번 절차로 이어가는 종료 노드가 되므로 ` +
        `나가는 분기를 가질 수 없다. 🔴 원본 흐름도에 있던 ${branchName}(→ "${toTitle}")가 이 절차에서는 사라진다.`,
    });
    issues.push({
      severity: "WARNING",
      issueType: "INVALID_NEXT_PROCEDURE_LINK",
      message:
        `"${nodeTitle(fromShape.text, fromShape.id)}"을(를) (${stageNumber})번 절차로 이어가는 종료 노드로 만들면서, ` +
        `원본 흐름도에 있던 ${branchName}(→ "${toTitle}")를 버렸습니다 — 종료 노드는 나가는 분기를 가질 수 없습니다. ` +
        `이 절차에서는 그 되돌아가는 흐름이 사라집니다(2026-11-05 결정).`,
      sourceWorksheet: sheetName,
      sourceReference: `connector#${connector.id}`,
    });
  }

  const nodes: TechnicalTaskNode[] = [];
  let sortOrder = 0;
  for (const shape of orderedNodeShapes) {
    const text = shape.text.trim();
    const nextProcedureStageNumber = text.match(NEXT_PROCEDURE_REF_RE)?.[1] ?? null;
    const outgoingBranchTypes = outgoingByShapeId.get(shape.id) ?? [];
    const { nodeType, reason } = classifyTechnicalNodeType({
      text,
      outgoingBranchTypes,
      nextProcedureStageNumber,
    });
    if (nextProcedureStageNumber !== null && outgoingBranchTypes.length > 0) {
      // 이어가기는 **종료 노드만** 가질 수 있다(procedure-next-procedure-link.ts).
      // 나가는 선이 있으면 종료로 못 만들고, 그래서 이어가기도 못 건다.
      issues.push({
        severity: "ERROR",
        issueType: "INVALID_NEXT_PROCEDURE_LINK",
        message:
          `"${firstLine(text)}"은(는) (${nextProcedureStageNumber})번 절차를 가리키지만 나가는 분기가 ` +
          `${outgoingBranchTypes.length}개라 종료 노드로 만들 수 없습니다 — 이어가기를 걸지 않았습니다.`,
        sourceWorksheet: sheetName,
        sourceReference: `shape#${shape.id}`,
      });
    }

    const { instructions, caution } = splitInstructionsAndCaution(shape.text);
    nodes.push({
      nodeCode: nodeCodeByShapeId.get(shape.id)!,
      nodeType,
      nodeTypeReason: reason,
      nextProcedureStageNumber: outgoingBranchTypes.length === 0 ? nextProcedureStageNumber : null,
      title: nodeTitle(shape.text, shape.id),
      description: text || null,
      instructions,
      safetyCaution: caution,
      // EMU → 픽셀. 엑셀에서 보던 자리 그대로 편집기 화면에 선다.
      positionX: Math.round(shape.x / EMU_PER_PIXEL),
      positionY: Math.round(shape.y / EMU_PER_PIXEL),
      sortOrder: sortOrder++,
      sourceWorksheet: sheetName,
      sourceShapeId: shape.id,
      sourceCellRange: null,
    });
  }

  // ── 7. 분기 ────────────────────────────────────────────────────────────
  // 차례는 **노드의 읽기 순서**를 따른다. 노드 코드 글자로 정렬하면 `…-14` 가
  // `…-7` 보다 앞서는(글자 비교라) 뒤죽박죽이 되고, 그 차례가 DB 의 sort_order 로
  // 그대로 굳는다.
  const sortOrderByNodeCode = new Map(nodes.map((n) => [n.nodeCode, n.sortOrder]));
  const edges: ExtractedEdge[] = graphConnectors
    .map((connector) => {
      const binding = labelByConnectorId.get(connector.id);
      const classified = classifyBranchLabel(binding?.labelText ?? null);
      return {
        fromNodeCode: nodeCodeByShapeId.get(connector.fromShapeId!)!,
        toNodeCode: nodeCodeByShapeId.get(connector.toShapeId!)!,
        branchType: classified.branchType,
        branchLabel: classified.branchLabel,
        sortOrder: 0,
        sourceConnectorId: connector.id,
      };
    })
    .sort(
      (a, b) =>
        (sortOrderByNodeCode.get(a.fromNodeCode) ?? 0) - (sortOrderByNodeCode.get(b.fromNodeCode) ?? 0) ||
        (sortOrderByNodeCode.get(a.toNodeCode) ?? 0) - (sortOrderByNodeCode.get(b.toNodeCode) ?? 0)
    )
    .map((edge, index) => ({ ...edge, sortOrder: index }));

  // ── 8. 시작 노드가 없다는 사실을 보고한다 ──────────────────────────────
  // 만들지는 않는다(모듈 머리말 3번). 다만 편집기의 [검증]이 모든 노드를
  // 「도달 불가」로 잡을 것이므로, 사람이 그 까닭을 여기서 먼저 알아야 한다.
  if (nodes.length > 0) {
    issues.push({
      severity: "INFO",
      issueType: "INVALID_START_STRUCTURE",
      message:
        "이 시트에는 시작(START) 노드가 없습니다 — 엑셀에 시작 표식이 없어 만들지 않았습니다. " +
        "편집기에서 시작 노드를 더하기 전까지 [검증]은 모든 노드를 도달 불가로 표시합니다.",
      sourceWorksheet: sheetName,
      sourceReference: null,
    });
  }

  return {
    nodes,
    edges,
    droppedShapes,
    droppedConnectors,
    labelBindings,
    annotationBoundaryX: boundaryX,
    annotationBoundaryReason,
    issues,
  };
}
