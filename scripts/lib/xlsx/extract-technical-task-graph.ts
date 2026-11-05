import { classifyBranchLabel, classifyUnifiedBranchLabel, unifiedBranch } from "./branch-classification";
import {
  distancePointToPolyline,
  distancePointToRect,
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

export type TechnicalTaskConnectorInput = {
  /** `<xdr:cNvPr id>`. */
  id: string;
  /** `<a:stCxn id>` — 이 선이 **나가는** 도형 번호. */
  fromShapeId: string | null;
  /** `<a:endCxn id>` — 이 선이 **닿는** 도형 번호. */
  toShapeId: string | null;
  /**
   * 🔴 선이 **실제로 그려지는 경로**(그림판 절대 좌표 · `connectorPath`).
   *
   * 2026-11-05 전에는 여기에 바깥 상자(`x`·`y`·`cx`·`cy`·뒤집기)와 「곧은 선인가」를
   * 받아, 곧은 선은 상자의 대각선으로 꺾인 선은 **상자 자체**로 쟀다. 꺾인 선과
   * 돌아간 선이 많은 시트에서 그 어림이 무너졌다 — 까닭과 실측값은
   * drawing-geometry.ts 의 `connectorPath` 머리말에 있다.
   *
   * 🔵 그 뒤로 이 모듈은 선의 상자를 **한 번도 안 본다.** 그래서 아예 안 받는다 —
   * 받아 두면 언젠가 누가 다시 상자로 재고, 그 틀림은 오류가 아니라 그림으로만 드러난다.
   */
  path: readonly Point[];
};

export type TechnicalTaskGraphInput = {
  sheetName: string;
  /** 노드 코드의 앞가지 — technical-task-sheet-plan.ts 가 정한다. */
  nodeCodePrefix: string;
  /**
   * **자동으로 더하는 시작 노드의 제목**(2026-11-05 사용자 결정 — 절차 이름을 쓴다).
   * 🔵 머리말을 뗀 이름을 받는다(`technical-task-sheet-plan.ts` 의 `label`).
   */
  startNodeTitle: string;
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
  /**
   * 🔴 연결선이 **하나도 닿지 않는** 도형 (2026-11-05 사용자 지적).
   * 「(2)외관검사에서 사진이 들어가 있는 박스는 첨부파일일 뿐이고 노드가 아니야.」
   * 그 시트의 고립 도형 15개 가운데 13개가 사진 캡션이었다.
   */
  | "NOT_IN_FLOW"
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
  | "ABANDONED_FOR_NEXT_PROCEDURE"
  /**
   * 🔴 글자 없는 **이음목**(지나가는 점)과 얽힌 선 (2026-11-05). 두 경우가 한 갈래에
   * 들어 있고, 어느 쪽인지는 `detail` 이 가른다:
   *   ① **소비된 선** — 이음목에서 **나가던** 선. 들어오던 선들의 도착지를 이 선
   *      너머로 옮겨 붙였으므로, 이 선까지 분기로 만들면 같은 흐름이 두 번 그려진다.
   *   ② **못 이은 선** — 이음목을 향해 들어왔지만 건너편을 못 정한 선(이음목끼리
   *      고리를 이루거나, 건너간 끝이 노드가 아니거나, 제자리로 돌아오는 경우).
   * 🔴 ②는 **흐름이 실제로 사라지는 쪽**이라 경고도 함께 올린다 — 조용히 버리면
   * 지금 고치고 있는 바로 그 결함(NG 가지 넷이 통째로 사라진 일)이 되풀이된다.
   */
  | "PASS_THROUGH_JUNCTION";

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
  /**
   * 🔴 **엑셀 도형에 적힌 글자 그대로**다(`O.K.`·`N.G.`·`YES`). 분기에 실제로
   * 실리는 이름은 「정상」·「NG」로 통일되므로(2026-11-05) 이 값과 **다를 수 있다** —
   * 사람이 드라이런에서 「엑셀의 이 글자가 이 선에 붙었다」를 맞대어 보는 자리라
   * 여기서는 원본을 그대로 보여 준다.
   */
  labelText: string;
  /** 🔵 이쪽은 **통일된** 갈래다(`classifyUnifiedBranchLabel`) — 분기에 실리는 값과 같다. */
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
  /**
   * 🔴 **엑셀에서 읽은 노드인가, 우리가 더한 노드인가.**
   *
   * 시작 노드는 엑셀에 없는 것을 더하는 것이다(2026-11-05 사용자 결정). 그 사실이
   * 값으로 남아 있어야 ① 드라이런이 섞어 찍지 않고 ② 「노드 수 + 버린 도형 수 =
   * 입력 도형 수」라는 셈이 어긋나지 않는다.
   */
  origin: "EXCEL_SHAPE" | "AUTO_START";
};

export type TechnicalTaskGraphResult = {
  nodes: TechnicalTaskNode[];
  edges: ExtractedEdge[];
  droppedShapes: DroppedShape[];
  droppedConnectors: DroppedConnector[];
  labelBindings: BranchLabelBinding[];
  /**
   * 🔴 엑셀에 **안 적혀 있던** 연결 — 끊어진 선 끝을 좌표로 이어 붙인 것들.
   * 적혀 있던 연결과 **믿음의 정도가 다르므로** 드라이런이 따로 보여 준다.
   */
  reboundEndpoints: ReboundEndpoint[];
  /**
   * 「흐름에 닿지 않는 도형은 노드가 아니다」 규칙을 **껐다면** 그 까닭. 안 껐으면 null.
   * 🔴 끈 사실이 조용하면, 그 시트에 진짜 사진 캡션이 생겨도 아무도 모른다.
   */
  isolationRuleSkippedReason: string | null;
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

/**
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 다른 절차를 가리키는 글자 — **두 꼴**만 인정한다
 * ──────────────────────────────────────────────────────────────────────
 * ① `(12) 출하 완료` — 글자 **맨 앞**이 번호인 꼴
 * ② `…확인후[(7) 원복 작업 및 개선 작업] 실시` — 번호를 **대괄호로 감싼** 꼴
 *
 * 🔴 **「글자 아무 데나 `(숫자)`」로 넓히면 안 된다.** 2026-11-05 에 워크북 전수
 * 조사를 했고, 번호가 글자 가운데 있는 도형은 셋뿐인데 그중 **둘이 항목 번호**였다
 * (「… 확인(1)…」 꼴로 한 상자 안에서 소항목을 세는 표기). 넓게 잡으면 그 둘이
 * 참조로 둔갑해 **엉뚱한 절차로 이어진다** — 오류는 안 나고 화면에서만 틀린다.
 * 대괄호를 요구하면 셋 중 진짜 하나만 걸린다.
 *
 * 🔵 **시트 머리글 칸의 겸임 표기**(`[(9) …, (10) …]`)와 모양이 겹치지만, 읽는
 * 자리가 다르다 — 그쪽은 **셀** 글자를 technical-task-sheet-plan.ts 가 읽고,
 * 이쪽은 **도형** 글자를 여기서 읽는다. 같은 문자열을 둘이 보는 일이 없다.
 * 그래도 한 도형 안에 번호가 둘 이상 묶인 대괄호가 있으면 어느 쪽인지 못 가리므로
 * 아래에서 **첫 번째를 쓰고 그 사실을 경고로 올린다**(실측 0건).
 */
const NEXT_PROCEDURE_REF_LEADING_RE = /^\s*\(\s*(\d+)\s*\)/;
const NEXT_PROCEDURE_REF_BRACKETED_RE = /\[\s*\(\s*(\d+)\s*\)/;
/**
 * 문서를 **내거나 보관하는** 일이라고 읽히는 글자.
 *
 * 🔵 상수로 뺀 까닭은 `classifyTechnicalNodeType` 안에서 쓰는 자리가 「나가는 선이
 * 없을 때」 하나로 옮겨 갔기 때문이다 — 규칙 본문과 그 조건을 한눈에 맞대어 보게.
 */
const DOCUMENT_REFERENCE_TEXT_RE =
  /(보고서|리포트|report)[^\n]{0,12}(제출|업로드|송부)|업로드|클라우드\s*BOX|파일철에\s*보관/i;

/**
 * 「이어갈 절차를 **아직 비워 뒀다**」는 메모를 **알아보는 표식**.
 *
 * 🔴 잇기 단계가 그 참조를 채우면 이 메모는 **거짓이 된다.** 그래서 잇는 쪽이 같은
 * 노드의 이 메모를 함께 지운다 — 안 지우면 「초록 ✔ 옆의 글이 거짓」인 상태가 되고,
 * 묶음을 거듭할수록 거짓 메모만 쌓인다(2026-11-05 사용자가 [검증 이슈] 화면에서
 * 발견했다).
 *
 * 🔴 **같은 노드·같은 갈래(`INVALID_NEXT_PROCEDURE_LINK`)의 다른 메모는 남겨야 한다** —
 * 「대괄호 안에 번호가 둘이라 첫 번째를 썼다」 같은 것은 **영구히 참**이다. 그래서
 * 갈래와 노드 코드만으로는 못 가르고 이 표식이 필요하다.
 *
 * 🔵 글자를 **두 벌로 적지 않으려고** 상수로 뺐다 — 메모를 만드는 쪽과 지울 것을
 * 고르는 쪽이 이 한 값을 함께 본다.
 */
export const PENDING_NEXT_PROCEDURE_MEMO_MARKER = "아직 비워 두었습니다";

/** 한 대괄호 덩어리 안의 번호를 모두 센다 — 둘 이상이면 모호하다. */
const BRACKET_GROUP_RE = /\[([^\]]*)\]/g;
const BRACKET_NUMBER_RE = /\(\s*(\d+)\s*\)/g;

/** 이 글자가 가리키는 절차의 단계 번호. 둘 다 아니면 null. */
export function matchNextProcedureStageNumber(text: string): string | null {
  return (
    text.match(NEXT_PROCEDURE_REF_LEADING_RE)?.[1] ??
    text.match(NEXT_PROCEDURE_REF_BRACKETED_RE)?.[1] ??
    null
  );
}

/** 한 대괄호 덩어리 안에 번호가 둘 이상 들어 있는가(모호한 참조). */
function bracketedStageNumbers(text: string): string[] {
  const numbers: string[] = [];
  for (const group of text.matchAll(BRACKET_GROUP_RE)) {
    for (const item of group[1].matchAll(BRACKET_NUMBER_RE)) numbers.push(item[1]);
  }
  return numbers;
}

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
  const title = text.trim();
  return title.length > 0 ? title : `(제목 없음 · shape#${shapeId})`;
}

/**
 * 메모·까닭 글에 끼워 넣을 **짧은 이름**.
 *
 * 🔴 제목이 아니다. 2026-11-05 부터 노드 제목은 도형 글자 **전문**(여러 줄)이라,
 * 그대로 문장에 끼우면 메모 한 줄이 통째로 무너진다. 사람이 읽는 산문에는 첫 줄만
 * 넣고, 전문은 노드의 제목·설명에 그대로 들어 있다.
 */
function shortLabel(text: string): string {
  const line = firstLine(text);
  return line.length > 0 ? line : "(글자 없음)";
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
    // 🔵 「시작한다」고 적으면 안 된다 — 2026-11-05 에 대괄호 꼴
    //    (`…확인후[(7) …] 실시`)까지 넓혔으므로 글자 가운데 있는 경우가 생겼다.
    return {
      nodeType: "END",
      reason: `글자가 (${nextProcedureStageNumber})번 절차를 가리킨다 — 다른 절차로 이어가는 종료`,
    };
  }
  /**
   * ──────────────────────────────────────────────────────────────────────
   * 🔴 문서 제출/보관은 **흐름이 거기서 끝날 때만** 「문서 참조」다 (2026-11-05)
   * ──────────────────────────────────────────────────────────────────────
   * 글자에 「업로드」·「파일철에 보관」이 있어도, **다음 단계로 이어지는** 노드라면
   * 그것은 작업자가 **해야 하는 일**이다. 낱말이 아니라 자리가 정한다.
   *
   * 🔴 왜 이 구분이 가벼운 문제가 아닌가: `DOCUMENT_REFERENCE` 는
   * `procedure-execution-topology.ts` 의 `EXECUTABLE_NODE_TYPES` 에서 **빠져 있는
   * 유일한 유형**이다("always informational/satellite"). 그래서 그 유형이 된 노드는
   * **기사의 실행 목록에 아예 안 뜬다.** 흐름 한가운데의 진짜 작업이 그리로 가면
   * 그 작업은 조용히 사라진다 — 실측으로 `(12)출하 완료` 의 「…업로드」·「…보관」
   * 두 단계가 그렇게 되고 있었다(편집기 [검증]이 그 둘을 경고로 잡아 드러났다).
   *
   * 🔴 **차례가 알맹이다.** 이 검사는 바로 아래 「나가는 선이 없으면 종료」보다
   * **먼저** 와야 한다. 뒤에 두면 나가는 선이 없는 노드는 이미 종료로 빠져 나가서
   * 이 가지가 **영영 안 걸린다**(조건만 덧붙이면 죽은 코드가 된다).
   *
   * 🔵 실측: 이 글자 규칙에 걸리는 도형은 워크북 전체에 셋뿐이고, 그중 둘이 위의
   * `(12)` 노드(나가는 선 있음)다. 나머지 하나는 주석 영역으로 이미 걸러진다.
   */
  if (outgoingBranchTypes.length === 0 && DOCUMENT_REFERENCE_TEXT_RE.test(text)) {
    return {
      nodeType: "DOCUMENT_REFERENCE",
      reason: "글자에 문서 제출/보관 표현이 있고 나가는 선이 없다 — 흐름이 여기서 끝난다",
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

  // 🔵 문서 제출/보관 글자는 **위에서** 이미 봤다(나가는 선이 없을 때만 걸린다).
  //    여기까지 온 노드는 나가는 선이 있으므로 아래 규칙들이 제 일을 한다.
  if (/교환|교체|조정\s*작업|재\s*측정|재\s*확인\s*후|부품\s*교환|재\s*진행|재\s*실시/.test(text)) {
    return { nodeType: "CORRECTIVE_ACTION", reason: "글자에 조치/재작업 표현이 있다" };
  }
  if (/확인|점검|검사|측정/.test(text)) {
    return { nodeType: "INSPECTION", reason: "글자에 확인/점검/검사/측정이 있다" };
  }
  return { nodeType: "TASK", reason: "위 규칙에 걸리지 않는다" };
}

/** 끊어져 있던 선 끝을 좌표로 이어 붙인 결과 한 건. 드라이런이 따로 보여 준다. */
export type ReboundEndpoint = {
  connectorId: string;
  /** 어느 쪽 끝이 비어 있었나. */
  side: "START" | "END";
  shapeId: string;
  shapeText: string;
  /** 그 끝점에서 붙인 도형까지의 거리(EMU). 상자 안이면 0. */
  distance: number;
  runnerUpDistance: number | null;
  confident: boolean;
};

/**
 * 끊어진 선 끝을 **제 끝점에서 가장 가까운 도형**에 이어 붙일 때 쓰는 여유.
 * 레이블 붙이기와 같은 자(상자의 반 둘레)를 쓴다 — 시트마다 글꼴·배율이 달라
 * 고정 EMU 값은 한쪽에서 반드시 틀린다.
 */
function maxRebindDistance(shape: TechnicalTaskShapeInput): number {
  return shape.cx + shape.cy;
}

/**
 * ============================================================================
 * 🔴 끊어진 선 끝을 **좌표로** 이어 붙인다 (2026-11-05)
 * ============================================================================
 * 엑셀에서 선을 그릴 때 **끝만 도형에 붙이고 시작은 허공에 두는** 일이 있다. 그러면
 * `<a:stCxn>`(또는 `<a:endCxn>`)이 통째로 비고, 그 선은 「어디서 오는지 모르는 선」이
 * 된다. 실측으로 `(MB) 통전검사` 는 연결선 6개 중 **넷**이 그랬고, 그 탓에 받는 쪽
 * 노드들이 전부 뿌리가 되어 **시작에서 다섯 갈래로 흩어진** 그림이 나왔다(사용자가
 * 엑셀과 나란히 놓고 잡아냈다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 **가까우면 무엇이든 붙이지 않는다**
 * ──────────────────────────────────────────────────────────────────────
 * 잘못 이으면 흐름이 **조용히** 엉뚱해진다. 그래서 분기 이름 붙이기와 같은 조심성을
 * 쓴다 — ① 거리 상한(상자의 반 둘레) ② 차점과의 배수 ③ 반대쪽 끝의 도형은 제외
 * (자기 자신으로 가는 선을 만들지 않는다). 못 미더우면 **안 붙이고** 그대로 둔다.
 *
 * 🔵 붙일 후보는 **글자가 있고 분기 어휘가 아닌 도형**이다. 「노드인가」로 고르면
 * 그 판정이 연결선에 기대고 있어 서로 물고 도는 순환이 된다 — 글자만 보면 안 돈다.
 */
function rebindDanglingEndpoints(
  shapes: readonly TechnicalTaskShapeInput[],
  rawConnectors: readonly TechnicalTaskConnectorInput[],
  sheetName: string
): {
  connectors: TechnicalTaskConnectorInput[];
  reboundEndpoints: ReboundEndpoint[];
  reboundIssues: ExtractedValidationIssue[];
} {
  const candidates = shapes.filter((s) => !EMPTY_BOX_TEXT_RE.test(s.text) && !isBranchLabelText(s.text));
  const reboundEndpoints: ReboundEndpoint[] = [];
  const reboundIssues: ExtractedValidationIssue[] = [];

  const connectors = rawConnectors.map((connector) => {
    if (connector.fromShapeId && connector.toShapeId) return connector;
    // 🔵 경로의 **첫 점·끝 점**이 곧 선의 시작과 끝이다. 전에는 바깥 상자의 마주
    //    보는 두 귀퉁이를 썼는데, 돌아간 선에서는 그 귀퉁이가 선 위에 있지도 않다.
    const start = connector.path[0];
    const end = connector.path[connector.path.length - 1];
    if (!start || !end) return connector;
    let next = connector;

    for (const side of ["START", "END"] as const) {
      const alreadyBound = side === "START" ? next.fromShapeId : next.toShapeId;
      if (alreadyBound) continue;
      const point = side === "START" ? start : end;
      const otherEnd = side === "START" ? next.toShapeId : next.fromShapeId;

      const ranked = candidates
        .filter((s) => s.id !== otherEnd)
        .map((s) => ({ shape: s, distance: distancePointToRect(point, s) }))
        .sort((a, b) => a.distance - b.distance);
      const best = ranked[0];
      if (!best || best.distance > maxRebindDistance(best.shape)) continue;

      const runnerUpDistance = ranked[1]?.distance ?? null;
      const confident =
        runnerUpDistance === null || runnerUpDistance >= best.distance * CONFIDENT_MARGIN_RATIO;
      reboundEndpoints.push({
        connectorId: connector.id,
        side,
        shapeId: best.shape.id,
        shapeText: firstLine(best.shape.text),
        distance: best.distance,
        runnerUpDistance,
        confident,
      });
      next =
        side === "START"
          ? { ...next, fromShapeId: best.shape.id }
          : { ...next, toShapeId: best.shape.id };

      reboundIssues.push({
        // 🔴 **엑셀에 적혀 있던 연결과 믿음의 정도가 다르다.** 사람이 이 목록만
        //    훑어 검산할 수 있어야 하므로 한 건도 조용히 넘기지 않는다.
        severity: confident ? "INFO" : "WARNING",
        issueType: "DANGLING_CONNECTOR",
        message:
          `연결선(connector#${connector.id})의 ${side === "START" ? "시작" : "끝"}이 어떤 도형에도 ` +
          `묶여 있지 않아 **좌표로** "${firstLine(best.shape.text)}"(shape#${best.shape.id})에 이어 붙였습니다 ` +
          `(거리 ${Math.round(best.distance)} EMU` +
          `${runnerUpDistance === null ? "" : ` / 차점 ${Math.round(runnerUpDistance)}`})` +
          `${confident ? "." : " — 🔴 차점과 거의 비겨 확신이 낮습니다."}`,
        sourceWorksheet: sheetName,
        sourceReference: `connector#${connector.id}`,
      });
    }
    return next;
  });

  return { connectors, reboundEndpoints, reboundIssues };
}

/**
 * ============================================================================
 * 🔴 글자 없는 **이음목**을 건너뛴다 — 노드로 만들지 않고 **선을 이어 붙인다** (2026-11-05)
 * ============================================================================
 * 흐름도는 선 여럿을 한 곳에 모아 한 줄로 내보낼 때, 글자 없는 작은 네모를 놓고
 * 거기로 모은 뒤 그 네모에서 한 줄을 뽑는다. 그 네모는 **그림을 정리하는 표식**이지
 * 작업이 아니다 — 노드가 되어서도 안 되고, 그렇다고 버려져서도 안 된다.
 *
 * ── 안 고치면 무슨 일이 나는가 (실측 · `(5)통전검사(3상입력)`) ──────────────
 * 글자가 없으니 그 네모는 `EMPTY_BOX` 로 버려지고, **거기 닿는 선 여섯이 전부**
 * `POINTS_AT_DROPPED_SHAPE` 로 함께 버려졌다. 그 바람에 점검 상자 넷의 **NG 가지가
 * 통째로 사라져** 넷 다 「아래로 선 하나뿐」인 `INSPECTION` 이 됐고, 갈 곳을 잃은
 * 「NG」 글자 셋은 「붙일 연결선을 못 찾았다」 경고로 남았으며, 나머지 하나는
 * **엉뚱한 선**(되돌아오는 선)에 가서 붙어 그 노드에 `MISSING_OUTGOING_PATH` 오류를
 * 달아 놓았다. 오류 한 건이 아니라 **흐름 넷이 통째로 없어진** 일이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 「빈 도형이면 전부」가 아니라 **들어오고 나가는 것만**인가
 * ──────────────────────────────────────────────────────────────────────
 * 2026-11-05 워크북 전수 조사에서 빈 도형은 여섯 시트에 있었는데, **통전검사만
 * 성격이 다르다.**
 *   · `(12)출하 완료` 12개 · `(2)외관 검사` 5개 · `(1)고장 접수` `(6)개선 사항`
 *     `(MB)고장 접수` 각 1개 → **들어오는 선만 있고 나가는 선이 없다.**
 *   · `(5)통전검사` 2개 → **들어오고 나간다.**
 *
 * 🔴 **들어오기만 하는 빈 도형은 지금처럼 그대로 버린다.** 그것은 본문에서 선을 그어
 * 캡처 그림을 짚는 **사진 꼬리표**이고(「사진이 들어가 있는 박스는 첨부파일일 뿐이고
 * 노드가 아니야」 — 2026-11-05 사용자), 나가는 선이 없으니 이어 붙일 건너편 자체가
 * 없다. 🔴 게다가 그 시트들의 **노드 수는 사용자가 이미 눈으로 확인해 준 확정값**이다 —
 * 「빈 도형이면 전부 잇는다」로 규칙을 넓히면 그 확정값이 소리 없이 깨진다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 이어 붙일 때 지키는 것 셋
 * ──────────────────────────────────────────────────────────────────────
 * ① **도착지만 바꾼다.** 선이 그려진 자리(x·y·cx·cy·flip)는 한 값도 안 건드린다.
 *    분기 이름(「NG」 글자)은 **선분까지의 거리**로 붙으므로(5절), 자리를 옮기면
 *    제자리를 찾아가던 이름이 엉뚱한 선으로 간다.
 * ② **이음목에서 나가던 선은 소비한다.** 들어오던 선들을 이미 건너편에 붙였으므로,
 *    그 선까지 분기로 만들면 같은 흐름이 두 번 그려진다.
 * ③ **연달아 있을 수 있다**(실측: 74 →  77 → 12). 진짜 도형이 나올 때까지 따라간다.
 *    🔴 다만 이음목끼리 고리를 이루면 **멈추고 버리고 경고한다** — 안 멈추면 무한히 돈다.
 */
type PassThroughWalk =
  | { status: "RESOLVED"; targetShapeId: string; via: string[] }
  | { status: "CYCLE"; via: string[] };

/**
 * 이음목을 타고 **진짜 도형**에 닿을 때까지 따라간다.
 *
 * `passThroughNextByShapeId` 의 **열쇠는 이음목뿐**이다 — 그래서 열쇠가 아닌 것에
 * 닿는 순간이 곧 「다 왔다」이고, 그 판정을 따로 할 필요가 없다.
 */
function walkPassThroughChain(
  firstJunctionShapeId: string,
  passThroughNextByShapeId: ReadonlyMap<string, string>
): PassThroughWalk {
  const via: string[] = [];
  const seen = new Set<string>();
  let current = firstJunctionShapeId;
  while (passThroughNextByShapeId.has(current)) {
    // 🔴 **들어서기 전에** 본다. 뒤에서 보면 고리의 마지막 한 바퀴가 `via` 에 두 번
    //    실려, 사람이 읽는 경고에 같은 도형이 겹쳐 찍힌다.
    if (seen.has(current)) return { status: "CYCLE", via };
    seen.add(current);
    via.push(current);
    current = passThroughNextByShapeId.get(current)!;
  }
  return { status: "RESOLVED", targetShapeId: current, via };
}

/** 한 분기가 실제로 지닐 갈래와 이름. 연결선 번호로 찾는다. */
type ResolvedBranch = { branchType: ProcedureBranchType; branchLabel: string | null };

/**
 * ============================================================================
 * 🔴 판단에서 **NG 와 짝지어 갈라지는 이름 없는 선**을 「정상」으로 올린다 (2026-11-05)
 * ============================================================================
 * 사용자 원문: 「**판단에서 분기가 되는 연결선은** [정상]혹은 [NG]를 사용하도록 해줘.」
 *
 * ── 무엇이 문제였나 (실측) ─────────────────────────────────────────────
 * 엑셀의 흐름도는 갈림길에 **NG 쪽에만 이름을 적는다.** 정상 쪽은 그냥 아래로
 * 내려가는 선이라 글자를 안 붙인다. 그 결과 들여온 그림에서 판단 마름모 90곳이
 * **빨간 NG 선 하나 + 아무 글자도 없는 회색 선 하나**로 그려졌다. 글자를 그대로만
 * 옮기면 사용자가 없애 달라고 한 그 상태가 그대로 남는다.
 *
 * ── 🔴 왜 `classifyUnifiedBranchLabel` 이 아니라 여기인가 ──────────────
 * 그 함수는 **글자 하나**만 받는다. 「이 선에 NG 형제가 있는가」는 글자로는 영영 알
 * 수 없고, **형제 분기를 다 아는 자리**는 여기뿐이다. 그래서 「이름 없는 분기에
 * 이름을 안 붙인다」는 원칙은 그 함수에 그대로 두고, 예외를 이 한 곳에 모았다.
 *
 * ── 🔴 조건 넷을 **모두** 만족할 때만 올린다 ───────────────────────────
 * ① 같은 도형에서 나가는 분기에 **NG 가 하나 이상** 있다
 * ② 같은 도형에서 나가는 분기 중 **이름 없는 것이 정확히 하나**다
 * ③ 같은 도형에서 나가는 분기에 **`NORMAL` 이 하나도 없다**
 * ④ 그 선이 바로 그 「이름 없는 하나」다
 *
 * 🔴 **넷이 다 필요하다.** 실측으로 하나라도 빠지면 엉뚱한 선이 끌려 들어간다:
 *   · ① 없이 → START·TASK·INSPECTION·CORRECTIVE_ACTION 에서 그냥 다음 단계로 가는
 *     선 113개가 통째로 「정상」이 된다. 갈림이 아닌 것에 갈래 이름이 생긴다.
 *   · ② 없이 → 이름 없는 선이 둘인 판단에서 **어느 쪽이 정상인지 우리가 못 가린다.**
 *     찍어서 하나를 고르면 흐름이 조용히 틀린다(실측 2곳).
 *   · ③ 없이 → 「정상」이 이미 따로 적혀 있는 판단에 **정상이 둘** 생긴다(실측 1곳).
 *
 * 🔵 **`node_type` 을 안 본다.** 조건 ①이 곧 판단 노드의 정의(`classifyTechnicalNodeType`
 * 의 `hasConditional`)와 같은 집합이고, 유형은 **나가는 분기로부터** 정해지므로
 * 유형을 보면 서로 물고 도는 순서 의존이 된다.
 *
 * 🔵 **이름이 생겨도 노드 유형은 안 바뀐다.** 바꾸는 선은 DEFAULT → NORMAL 뿐이고,
 * 그 도형은 조건 ①에 따라 이미 NG 를 내보내 `hasConditional` 이 참이다 — 판단이던
 * 것은 판단 그대로다.
 */
function resolveBranchesWithDecisionPairs(
  graphConnectors: readonly TechnicalTaskConnectorInput[],
  labelByConnectorId: ReadonlyMap<string, BranchLabelBinding>
): Map<string, ResolvedBranch> {
  const resolved = new Map<string, ResolvedBranch>();
  const siblingsByFromShapeId = new Map<string, TechnicalTaskConnectorInput[]>();
  for (const connector of graphConnectors) {
    // 🔴 여기서 **통일**한다 — 엑셀의 `YES`·`O.K.` 는 「정상」으로, `NO`·`N.G.` 는
    //    「NG」로. 사람이 적은 이름(CUSTOM)은 그대로 둔다.
    resolved.set(
      connector.id,
      classifyUnifiedBranchLabel(labelByConnectorId.get(connector.id)?.labelText ?? null)
    );
    const siblings = siblingsByFromShapeId.get(connector.fromShapeId!) ?? [];
    siblings.push(connector);
    siblingsByFromShapeId.set(connector.fromShapeId!, siblings);
  }

  for (const siblings of siblingsByFromShapeId.values()) {
    const branchTypes = siblings.map((c) => resolved.get(c.id)!.branchType);
    const unnamed = siblings.filter((c) => resolved.get(c.id)!.branchType === "DEFAULT");
    if (!branchTypes.includes("NG")) continue; // ①
    if (unnamed.length !== 1) continue; // ②
    if (branchTypes.includes("NORMAL")) continue; // ③
    resolved.set(unnamed[0].id, unifiedBranch("NORMAL")); // ④
  }
  return resolved;
}

/**
 * 레이블 가운데에서 연결선까지의 거리 — **실제로 그려지는 꺾은선**까지로 잰다.
 *
 * 🔴 전에는 곧은 선과 꺾인 선에 **다른 자**를 댔다(선분 vs 바깥 상자). 자가 둘이면
 * 「0 으로 나오는 쪽」이 언제나 이기는데, 그 0 은 가깝다는 뜻이 아니라 **잴 줄 모른다**는
 * 뜻이었다. 이제 자가 하나다 — drawing-geometry.ts 의 `connectorPath` 머리말 참고.
 */
function distanceToConnector(labelCenter: Point, connector: TechnicalTaskConnectorInput): number {
  return distancePointToPolyline(labelCenter, connector.path);
}

export function extractTechnicalTaskGraph(input: TechnicalTaskGraphInput): TechnicalTaskGraphResult {
  const { sheetName, nodeCodePrefix, startNodeTitle } = input;
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

  // ── 0-2. 🔴 **끊어진 선 끝을 좌표로 이어 붙인다** (2026-11-05) ──────────
  const { connectors, reboundEndpoints, reboundIssues } = rebindDanglingEndpoints(shapes, input.connectors, sheetName);
  issues.push(...reboundIssues);

  const endpointIds = new Set<string>();
  for (const c of connectors) {
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

  // ── 2-2. 🔴 빈 상자 가운데 **이음목**을 가려낸다 (2026-11-05) ────────────
  //
  // 까닭과 「왜 들어오기만 하는 빈 도형은 그대로 버리는가」는 `walkPassThroughChain`
  // 머리말에 적었다. 여기서는 **고르기만** 하고, 실제로 잇는 일은 4절(연결선 → 분기)
  // 에서 한다 — 거기서야 「무엇이 진짜 노드인가」(`nodeShapeIds`)가 정해진다.
  //
  // 🔴 **세는 바탕은 0-2 절까지의 연결선 그대로**다. 아래 3·4 절(고립 도형 · 주석
  //    영역)은 「엑셀에 적힌 선이 어느 도형에 닿는가」로 판정하는데, 이음목을 먼저
  //    지워 버리면 그 셈이 달라져 **다른 시트의 노드 수가 흔들린다.** 이 절은 세기만
  //    하고 `connectors` 를 한 줄도 바꾸지 않는다.
  const allOutgoingByShapeId = new Map<string, TechnicalTaskConnectorInput[]>();
  const incomingCountByShapeId = new Map<string, number>();
  for (const connector of connectors) {
    // 🔵 끝이 안 묶인 선과 자기 자신으로 가는 선은 애초에 분기가 못 되므로(4절)
    //    이음목의 들어오고/나감을 셀 때도 빼 둔다 — 넣으면 「나가는 선이 둘」로
    //    잘못 읽혀 이을 수 있는 이음목을 못 잇는다.
    if (!connector.fromShapeId || !connector.toShapeId) continue;
    if (connector.fromShapeId === connector.toShapeId) continue;
    const outgoing = allOutgoingByShapeId.get(connector.fromShapeId) ?? [];
    outgoing.push(connector);
    allOutgoingByShapeId.set(connector.fromShapeId, outgoing);
    incomingCountByShapeId.set(
      connector.toShapeId,
      (incomingCountByShapeId.get(connector.toShapeId) ?? 0) + 1
    );
  }

  /** 이음목 → 그 **하나뿐인** 나가는 선이 닿는 도형. 이음목이 아닌 것은 열쇠가 아니다. */
  const passThroughNextByShapeId = new Map<string, string>();
  /** 이음목에서 **나가던** 선 — 이어 붙이면서 소비된다(따로 분기가 되지 않는다). */
  const consumedConnectorIds = new Set<string>();
  for (const shapeId of emptyShapeIds) {
    const incomingCount = incomingCountByShapeId.get(shapeId) ?? 0;
    const outgoing = allOutgoingByShapeId.get(shapeId) ?? [];
    // 🔴 들어오기만 하는 빈 도형(사진 꼬리표)과 흐름 밖의 빈 도형은 **그대로 둔다.**
    if (incomingCount === 0 || outgoing.length === 0) continue;
    if (outgoing.length > 1) {
      // 🔴 **어느 쪽으로 이을지 우리가 못 정한다.** 찍어서 하나를 고르면 흐름이
      //    조용히 틀린다 — 지금처럼 버리되, 버렸다는 사실을 사람에게 올린다.
      //    (실측 0건이다. 통전검사의 둘은 나가는 선이 각각 하나뿐이다.)
      issues.push({
        severity: "WARNING",
        issueType: "UNSUPPORTED_OBJECT",
        message:
          `글자 없는 도형(shape#${shapeId})에 선이 ${incomingCount}개 들어오고 ${outgoing.length}개 나갑니다 — ` +
          `이음목으로 보이지만 **어느 쪽으로 이을지 정할 수 없어** 그대로 버렸습니다. ` +
          `들어오던 선 ${incomingCount}개의 흐름이 이 절차에서는 사라집니다.`,
        sourceWorksheet: sheetName,
        sourceReference: `shape#${shapeId}`,
      });
      continue;
    }
    passThroughNextByShapeId.set(shapeId, outgoing[0].toShapeId!);
    consumedConnectorIds.add(outgoing[0].id);
  }

  // ── 3. 흐름에 닿지 않는 도형 ───────────────────────────────────────────
  //
  // 🔴 **연결선이 하나도 닿지 않는 도형은 노드가 아니다**(2026-11-05 사용자 지적:
  //    「사진이 들어가 있는 박스는 첨부파일일 뿐이고 노드가 아니야」). 실측으로
  //    (2)외관 검사의 고립 도형 15개 가운데 13개가 **사진 캡션**이었다.
  //
  // 🔴 「닿는다」는 **엑셀에 적힌 연결선 전부**를 기준으로 본다 — 우리가 나중에
  //    버릴 선(주석선·포기한 분기)도 닿은 것으로 센다. 까닭은 둘이다:
  //    ① 선을 버리는 판정이 「어떤 도형이 노드인가」에 **기대고 있어서**, 남은
  //       선으로 다시 재면 서로 물고 도는 순환이 된다.
  //    ② 주석선이 가리키는 상자는 사람이 **일부러 흐름에 붙인** 것이라 캡션과
  //       성격이 다르다 — 그 상자는 아래 빈 상자/주석 영역 규칙이 제 까닭으로 가린다.
  //
  // 🔵 분기 레이블은 **위 1번에서 이미 갈라져** 여기 안 들어온다(레이블의 조건
  //    자체가 「연결선이 안 닿는 것」이라 그냥 두면 전부 이 갈래로 샌다).
  const isolatedShapeIds = new Set(
    shapes.filter((s) => !labelShapeIds.has(s.id) && !endpointIds.has(s.id)).map((s) => s.id)
  );

  /**
   * ──────────────────────────────────────────────────────────────────────
   * 🔴 이 규칙을 **끄는 자리 둘** — 끄는 까닭이 서로 다르다
   * ──────────────────────────────────────────────────────────────────────
   * ① **이어 붙이지도 못하고 끝이 남은 연결선이 있는 시트** (2026-11-05 사용자 결정)
   *
   *    「끝이 안 묶인 선」은 그 흐름도가 **손으로 그려져 연결 정보가 불완전하다**는
   *    신호다. 엑셀의 연결선은 도형에 붙여 그리면 `stCxn`/`endCxn` 에 상대 도형
   *    번호가 적히는데, 그 칸이 비어 있다는 것은 **선을 도형에 안 붙이고 그 옆에
   *    그려 놓았다**는 뜻이다. 그런 시트에서는 「이 도형에 선이 안 닿는다」를
   *    믿을 수 없다 — 사람 눈에는 닿아 있는데 파일에 기록이 없을 뿐일 수 있다.
   *
   *    🔴 **여기서 세는 것은 위 0-2 에서 이어 붙이고도 남은 끝**이다. 좌표로 이어
   *    붙일 수 있었던 끝은 이미 묶였으므로 이 조건에 안 걸린다 — 그만큼 이 안전장치가
   *    발동하는 일이 드물어졌다.
   *    🔵 실제로 `(MB) 통전검사` 가 그 예다. 전에는 안 묶인 선 넷 때문에 이 규칙이
   *    꺼졌고(그 덕에 「내부 검사 이행」·「출하 준비」가 살아남았다), 지금은 그 넷이
   *    **전부 제 도형에 이어 붙어** 규칙이 그대로 돌면서도 일곱이 유지된다.
   *    사용자가 정답을 확인해 준 `(2)외관 검사` 는 애초에 안 묶인 선이 0개다.
   *
   * ② **어떤 도형에도 연결선이 닿지 않는 시트**
   *    그대로 쓰면 도형이 전부 버려져 **빈 절차**가 된다. 애초에 흐름도가 아니다.
   *
   * 🔵 둘을 한 갈래로 뭉치지 않는다. ①은 「읽을 수는 있는데 이 판정만 못 믿는다」
   * (INFO)이고, ②는 「이 시트가 흐름도가 맞나」(WARNING)다 — 사람이 할 일이 다르다.
   *
   * 🔴 **끈 사실을 반드시 남긴다.** 끈 시트에 나중에 진짜 사진 캡션이 생기면 안
   * 걸리는데, 그것이 조용하면 아무도 모른다.
   */
  const unboundConnectorCount = connectors.filter((c) => !c.fromShapeId || !c.toShapeId).length;
  const everyShapeIsolated = shapes.length > 0 && isolatedShapeIds.size + labelShapeIds.size === shapes.length;

  let isolationRuleSkippedReason: string | null = null;
  if (isolatedShapeIds.size > 0 && unboundConnectorCount > 0) {
    isolationRuleSkippedReason =
      `끝이 안 묶인 연결선이 ${unboundConnectorCount}개 있습니다 — 이 흐름도는 연결 정보가 불완전해서 ` +
      `「선이 안 닿는다」를 믿을 수 없습니다. 「흐름에 닿지 않는 도형은 노드가 아니다」 규칙을 껐고, ` +
      `고립된 도형 ${isolatedShapeIds.size}개를 노드로 남겼습니다(사진 캡션이 섞여 있을 수 있습니다).`;
    issues.push({
      severity: "INFO",
      issueType: "UNSUPPORTED_OBJECT",
      message: isolationRuleSkippedReason,
      sourceWorksheet: sheetName,
      sourceReference: null,
    });
  } else if (everyShapeIsolated) {
    isolationRuleSkippedReason =
      `어떤 도형에도 연결선이 닿지 않습니다(도형 ${shapes.length} · 연결선 ${connectors.length}) — ` +
      "「흐름에 닿지 않는 도형은 노드가 아니다」 규칙을 적용하지 않았습니다. 적용하면 빈 절차가 됩니다.";
    issues.push({
      severity: "WARNING",
      issueType: "UNSUPPORTED_OBJECT",
      message: isolationRuleSkippedReason,
      sourceWorksheet: sheetName,
      sourceReference: null,
    });
  }
  if (isolationRuleSkippedReason) isolatedShapeIds.clear();

  // ── 4. 주석 영역 ───────────────────────────────────────────────────────
  const { boundaryX, reason: annotationBoundaryReason } = findAnnotationBoundary(shapes, connectors);
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
        // 🔴 같은 「빈 상자」라도 **사라지는 것과 이어지는 것**은 사람이 할 일이 다르다.
        //    이음목은 버려졌지만 그 자리의 흐름은 살아 있다 — 그 사실을 여기 적는다.
        detail: passThroughNextByShapeId.has(shape.id)
          ? `글자가 없는데 선이 들어왔다 나간다 — 노드가 아니라 **지나가는 이음목**으로 보고, ` +
            `들어오던 선의 도착지를 이 도형 건너편(shape#${passThroughNextByShapeId.get(shape.id)})으로 이어 붙였다.`
          : "글자가 없거나 주의 기호뿐이다 — 노드의 제목이 될 글자가 없다.",
      });
      continue;
    }
    if (isolatedShapeIds.has(shape.id)) {
      droppedShapes.push({
        shapeId: shape.id,
        text: firstLine(shape.text),
        reason: "NOT_IN_FLOW",
        detail: "연결선이 하나도 닿지 않는다 — 사진 캡션이나 설명 상자로 본다.",
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
    (s) =>
      !labelShapeIds.has(s.id) &&
      !emptyShapeIds.has(s.id) &&
      !isolatedShapeIds.has(s.id) &&
      !annotationShapeIds.has(s.id)
  );
  const nodeShapeIds = new Set(nodeShapes.map((s) => s.id));

  /**
   * 글자가 `(번호)` 로 시작하는 노드 — **다른 절차로 이어가는 종료**가 된다.
   * 아래에서 이 노드들에서 나가던 분기를 버린다(2026-11-05 사용자 결정).
   */
  const nextProcedureRefShapeIds = new Set(
    nodeShapes.filter((s) => matchNextProcedureStageNumber(s.text.trim()) !== null).map((s) => s.id)
  );

  // ── 4. 연결선 → 분기 ───────────────────────────────────────────────────
  const keptConnectors: TechnicalTaskConnectorInput[] = [];
  for (const connector of connectors) {
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
    // ── 4-1. 🔴 **이음목을 건너뛴다** (2026-11-05 · walkPassThroughChain 머리말) ──
    if (consumedConnectorIds.has(connector.id)) {
      droppedConnectors.push({
        connectorId: connector.id,
        fromShapeId: connector.fromShapeId,
        toShapeId: connector.toShapeId,
        reason: "PASS_THROUGH_JUNCTION",
        detail:
          `글자 없는 이음목(shape#${connector.fromShapeId})에서 **나가던** 선이다. 거기로 들어오던 선들의 ` +
          `도착지를 이 선 건너편으로 이미 옮겨 붙였으므로, 이 선까지 분기로 만들면 같은 흐름이 두 번 그려진다.`,
      });
      continue;
    }
    if (passThroughNextByShapeId.has(connector.toShapeId)) {
      const walk = walkPassThroughChain(connector.toShapeId, passThroughNextByShapeId);
      const chain = walk.via.map((id) => `shape#${id}`).join(" → ");
      const target = walk.status === "RESOLVED" ? walk.targetShapeId : null;
      // 🔴 **건너간 끝이 노드일 때만** 잇는다. 이음목 너머가 주석 상자거나(노드가
      //    아니다) 제자리로 돌아오면(자기 자신으로 가는 분기가 된다) 이을 수 없다.
      if (target !== null && nodeShapeIds.has(target) && target !== connector.fromShapeId) {
        // 🔴 **도착지만 바꾼다** — 선이 그려진 자리는 한 값도 안 건드린다. 분기 이름은
        //    선분까지의 거리로 붙으므로(5절), 자리를 옮기면 이름이 엉뚱한 선에 간다.
        keptConnectors.push({ ...connector, toShapeId: target });
        issues.push({
          // 🔵 엑셀에 적혀 있던 연결을 **우리가 고쳐 읽은** 자리다 — 끊어진 끝을 좌표로
          //    이어 붙인 일(0-2절)과 같은 갈래로 올려, 사람이 한 목록에서 검산한다.
          severity: "INFO",
          issueType: "DANGLING_CONNECTOR",
          message:
            `연결선(connector#${connector.id})이 글자 없는 이음목(${chain})을 지나갑니다 — 이음목은 노드로 ` +
            `만들지 않고, 도착지를 건너편 "${shortLabel(shapes.find((s) => s.id === target)?.text ?? "")}"` +
            `(shape#${target})(으)로 이어 붙였습니다(선이 그려진 자리는 그대로).`,
          sourceWorksheet: sheetName,
          sourceReference: `connector#${connector.id}`,
        });
        continue;
      }
      const why =
        walk.status === "CYCLE"
          ? `이음목끼리 고리를 이룬다(${chain})`
          : target === connector.fromShapeId
            ? `건너간 끝이 이 선의 출발 도형(shape#${target})이라 자기 자신으로 가는 분기가 된다`
            : `건너간 끝(shape#${target})이 노드가 아니다`;
      droppedConnectors.push({
        connectorId: connector.id,
        fromShapeId: connector.fromShapeId,
        toShapeId: connector.toShapeId,
        reason: "PASS_THROUGH_JUNCTION",
        detail: `글자 없는 이음목(shape#${connector.toShapeId})으로 들어가는 선인데 ${why} — 이어 붙이지 못하고 버렸다.`,
      });
      issues.push({
        severity: "WARNING",
        issueType: "DANGLING_CONNECTOR",
        message:
          `연결선(connector#${connector.id})이 글자 없는 이음목(shape#${connector.toShapeId})으로 들어가는데 ` +
          `${why} — 이어 붙이지 못했습니다. 원본 흐름도에 있던 이 흐름이 절차에서는 사라집니다.`,
        sourceWorksheet: sheetName,
        sourceReference: `connector#${connector.id}`,
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
      branchType: classifyUnifiedBranchLabel(pair.label.text.replace(/\n/g, " ").trim()).branchType,
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

  // ── 5-3. 🔴 분기의 갈래·이름을 여기서 **한 번에** 정한다 ────────────────
  // 엑셀 글자 통일(YES·O.K.→정상 / NO·N.G.→NG)과, 판단에서 NG 와 짝지어 나가는
  // 이름 없는 선을 「정상」으로 올리는 일(조건 넷)이 **같은 한 자리**에서 끝난다.
  //
  // 🔴 **아래 두 곳이 이 한 값을 함께 본다** — 노드 유형을 정하는 `outgoingByShapeId`
  //    와 실제로 만드는 분기(7절). 두 벌로 재면 「유형 근거는 DEFAULT 라는데 그림에는
  //    정상이라 적힌」 어긋남이 생기고, 그 어긋남은 오류가 아니라 **글자로만** 드러난다.
  const resolvedBranchByConnectorId = resolveBranchesWithDecisionPairs(
    graphConnectors,
    labelByConnectorId
  );

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
    // 🔵 5-3 절이 정한 값을 그대로 쓴다 — 유형 근거에 찍히는 갈래 이름이 실제로
    //    만들어지는 분기와 같아야 한다. 🔴 이 바꿈으로 **유형이 달라지지는 않는다**:
    //    올라가는 선은 DEFAULT → NORMAL 뿐이고, 그 도형은 조건 ①에 따라 이미 NG 를
    //    내보내 `hasConditional` 이 참이다(판단이던 것은 판단 그대로).
    const branchType = resolvedBranchByConnectorId.get(connector.id)!.branchType;
    const list = outgoingByShapeId.get(connector.fromShapeId!) ?? [];
    list.push(branchType);
    outgoingByShapeId.set(connector.fromShapeId!, list);
  }

  // 버린 분기를 **까닭과 함께** 보고한다. 노드 코드가 필요해서 여기까지 미뤘다.
  for (const connector of keptConnectors) {
    if (!abandonedConnectorIds.has(connector.id)) continue;
    const fromShape = nodeShapes.find((s) => s.id === connector.fromShapeId)!;
    const stageNumber = matchNextProcedureStageNumber(fromShape.text.trim()) ?? "?";
    const toTitle = shortLabel(nodeShapes.find((s) => s.id === connector.toShapeId)?.text ?? "");
    const labelText = labelByConnectorId.get(connector.id)?.labelText;
    const branchName = labelText ? `"${labelText}" 분기` : "이름 없는 분기";
    droppedConnectors.push({
      connectorId: connector.id,
      fromShapeId: connector.fromShapeId,
      toShapeId: connector.toShapeId,
      reason: "ABANDONED_FOR_NEXT_PROCEDURE",
      detail:
        `"${shortLabel(fromShape.text)}"은(는) (${stageNumber})번 절차로 이어가는 종료 노드가 되므로 ` +
        `나가는 분기를 가질 수 없다. 🔴 원본 흐름도에 있던 ${branchName}(→ "${toTitle}")가 이 절차에서는 사라진다.`,
    });
    issues.push({
      severity: "WARNING",
      issueType: "INVALID_NEXT_PROCEDURE_LINK",
      message:
        `"${shortLabel(fromShape.text)}"을(를) (${stageNumber})번 절차로 이어가는 종료 노드로 만들면서, ` +
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
    const nextProcedureStageNumber = matchNextProcedureStageNumber(text);
    const outgoingBranchTypes = outgoingByShapeId.get(shape.id) ?? [];
    const { nodeType, reason } = classifyTechnicalNodeType({
      text,
      outgoingBranchTypes,
      nextProcedureStageNumber,
    });
    const nodeCode = nodeCodeByShapeId.get(shape.id)!;
    if (nextProcedureStageNumber !== null) {
      // 🔴 한 대괄호 안에 번호가 둘 이상이면 **어느 절차인지 못 가린다.** 칸은 하나라
      //    하나만 담을 수 있다 — 첫 번째를 쓰되 그 사실을 사람에게 올린다.
      //    (실측 0건이다. 머리글 칸의 겸임 표기가 그 모양인데, 그것은 셀이라 여기 안 온다.)
      const bracketed = bracketedStageNumbers(text);
      if (bracketed.length > 1) {
        issues.push({
          severity: "WARNING",
          issueType: "INVALID_NEXT_PROCEDURE_LINK",
          message:
            `"${shortLabel(shape.text)}"의 대괄호 안에 절차 번호가 ${bracketed.length}개 있습니다 ` +
            `(${bracketed.join(", ")}) — 이어갈 절차는 하나만 담을 수 있어 첫 번째((${nextProcedureStageNumber})번)를 썼습니다.`,
          sourceWorksheet: sheetName,
          sourceReference: `node:${nodeCode}`,
        });
      }
      /**
       * 🔴 **이어가기는 여기서 안 건다 — 빈 채로 만들고 나중에 잇는다.**
       *
       * 절차끼리 가리키는 관계가 **순환해서**(technical-task-workbook.ts 머리말)
       * 「가리켜지는 것부터 만든다」는 차례가 아예 없다. 그래서 만들기 단계는
       * `next_procedure_template_id` 를 **비운 채** 두고, 다 만든 뒤 잇기 단계가
       * 채운다(`link-technical-task-next-procedures.ts`).
       *
       * 🔴 **비워 뒀다는 사실이 DB 에 남아야 한다.** 이 메모는
       * `procedure_template_validation_issues` 한 행이 되고, 사람은 절차 화면의
       * [검증 결과]에서 그대로 본다 — 안 남기면 「원래 안 이어지는 절차」와
       * 구별되지 않고, 그러면 아무도 안 잇는다.
       *
       * 🔵 `sourceReference` 는 **노드 코드**다(`shape#`·`connector#` 와 다른 앞가지).
       * 잇기 단계가 노드를 되찾는 열쇠가 바로 그 값이기 때문이다 —
       * `procedure_template_nodes` 의 유일키가 (템플릿, 노드코드)다.
       */
      issues.push({
        severity: "WARNING",
        issueType: "INVALID_NEXT_PROCEDURE_LINK",
        message:
          `종료 노드 "${shortLabel(shape.text)}"의 이어갈 절차((${nextProcedureStageNumber})번)를 ` +
          `${PENDING_NEXT_PROCEDURE_MEMO_MARKER} — 절차들을 다 만든 뒤 잇기 단계에서 채웁니다.`,
        sourceWorksheet: sheetName,
        sourceReference: `node:${nodeCode}`,
      });
    }

    const { instructions, caution } = splitInstructionsAndCaution(shape.text);
    nodes.push({
      nodeCode,
      nodeType,
      nodeTypeReason: reason,
      // 🔵 참조 노드는 나가는 분기가 이미 버려져 있으므로(위 5-2) 여기서 또 따지지 않는다.
      nextProcedureStageNumber,
      origin: "EXCEL_SHAPE",
      title: nodeTitle(shape.text, shape.id),
      description: text || null,
      instructions,
      safetyCaution: caution,
      /**
       * EMU → 픽셀. 엑셀에서 보던 자리를 그대로 옮긴다.
       *
       * 🔴 **다만 화면이 이 값으로 그리지는 않는다**(2026-11-05 실측).
       * `ProcedureFlowGraph.resolveBaselinePosition` 의 차례는 ① `user_position_x/y`
       * 둘 다 있으면 그것 ② 기술 작업 절차는 **자동 배치**(computeProcedureAutoLayout)
       * ③ 그것도 없을 때만 이 칸이다. 우리는 ①을 안 쓰므로 실제 배치는 ②가 정한다.
       * 그래도 채워 두는 까닭: ③이 받침이고, 편집 이력·판본 비교가 이 값을 읽는다.
       */
      positionX: Math.round(shape.x / EMU_PER_PIXEL),
      positionY: Math.round(shape.y / EMU_PER_PIXEL),
      sortOrder: sortOrder++,
      sourceWorksheet: sheetName,
      sourceShapeId: shape.id,
      sourceCellRange: null,
    });
  }

  // ── 6-2. 🔴 **시작 노드를 자동으로 더한다** (2026-11-05 사용자 결정) ─────
  //
  // 🔴 **엑셀에 없는 것을 더하는 일이다.** 1단계에서는 그래서 안 만들었고, 대신
  //    「시작 노드가 없다」를 알렸다. 그 판단 자체는 옳았지만 결과가 못 쓸 물건이었다 —
  //    시작점이 없으니 편집기의 [검증]이 **모든 노드를 도달 불가**로 표시했다.
  //    사용자가 「절차 제목을 시작 노드의 내용으로 해서 자동으로 붙여」로 정했다.
  //
  // 🔴 **만들기만 해서는 아무것도 안 바뀐다.** 도달 불가의 까닭은 시작점이 없어서이므로
  //    시작 노드에서 **실제로 선이 나가야** 한다. 들어오는 선이 하나도 없는 노드
  //    (= 뿌리) **전부**에 잇는다 — 하나만 이으면 나머지 뿌리가 그대로 남는다.
  //
  // 🔵 분기 이름은 **안 붙인다**(기본 분기). 엑셀에 없는 이름을 지어내는 일이다.
  const incomingNodeCodes = new Set(
    graphConnectors.map((c) => nodeCodeByShapeId.get(c.toShapeId!)!).filter(Boolean)
  );
  const rootNodes = nodes.filter((n) => !incomingNodeCodes.has(n.nodeCode));
  const startNodeCode = `${nodeCodePrefix}-start`;
  const startEdges: ExtractedEdge[] = [];

  if (nodes.length > 0 && rootNodes.length > 0) {
    // 자리는 뿌리들의 **가로 중심**에 맞춰 그 위에 세운다. 왼쪽 모서리를 맞추면
    // 폭이 다를 때 삐뚤어진다(2026-11-05 에 이 저장소의 배치가 중심점 기준이 됐다).
    // 🔵 다만 위 positionX 주석대로 화면은 자동 배치를 쓴다 — 이 값은 받침이다.
    const rootShapes = rootNodes
      .map((n) => shapes.find((s) => s.id === n.sourceShapeId))
      .filter((s): s is TechnicalTaskShapeInput => s !== undefined);
    const averageOf = (values: number[]): number =>
      values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    const rootCenterX = averageOf(rootShapes.map((s) => s.x + s.cx / 2));
    const startWidth = averageOf(rootShapes.map((s) => s.cx));
    const startHeight = averageOf(rootShapes.map((s) => s.cy));
    const topY = Math.min(...nodeShapes.map((s) => s.y));

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
      positionX: Math.round((rootCenterX - startWidth / 2) / EMU_PER_PIXEL),
      // 한 상자 높이만큼 띄워 그 위에 세운다 — 고정 픽셀 대신 그 시트의 상자 크기로 잰다.
      positionY: Math.round((topY - startHeight * 2) / EMU_PER_PIXEL),
      sortOrder: 0,
      sourceWorksheet: sheetName,
      sourceShapeId: null,
      sourceCellRange: null,
    });
    // 시작 노드가 맨 앞에 섰으므로 나머지 차례를 한 칸씩 민다.
    for (const [index, n] of nodes.entries()) n.sortOrder = index;

    for (const root of rootNodes) {
      startEdges.push({
        fromNodeCode: startNodeCode,
        toNodeCode: root.nodeCode,
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
        `시작(START) 노드 "${startNodeTitle}"을(를) **자동으로 더했습니다** — 엑셀에는 시작 표식이 없습니다. ` +
        `들어오는 분기가 없던 노드 ${rootNodes.length}개에 기본 분기로 이었습니다. ` +
        `(2026-11-05 사용자 결정. 그전에는 더하지 않았고, 그 탓에 [검증]이 모든 노드를 도달 불가로 표시했습니다.)`,
      sourceWorksheet: sheetName,
      sourceReference: `node:${startNodeCode}`,
    });
  } else if (nodes.length > 0) {
    // 🔴 뿌리가 하나도 없다 = 모든 노드가 어딘가에서 들어오는 선을 받는다(순환).
    //    시작 노드를 만들면 나가는 분기가 없어 구조 검증이 ERROR 를 낸다 — 안 만들고 알린다.
    issues.push({
      severity: "WARNING",
      issueType: "INVALID_START_STRUCTURE",
      message:
        "들어오는 분기가 없는 노드가 하나도 없어(모두 순환 안에 있음) 시작 노드를 더하지 못했습니다 — " +
        "편집기에서 시작점을 직접 정해야 합니다.",
      sourceWorksheet: sheetName,
      sourceReference: null,
    });
  }

  // ── 7. 분기 ────────────────────────────────────────────────────────────
  // 차례는 **노드의 읽기 순서**를 따른다. 노드 코드 글자로 정렬하면 `…-14` 가
  // `…-7` 보다 앞서는(글자 비교라) 뒤죽박죽이 되고, 그 차례가 DB 의 sort_order 로
  // 그대로 굳는다.
  const sortOrderByNodeCode = new Map(nodes.map((n) => [n.nodeCode, n.sortOrder]));
  const edges: ExtractedEdge[] = [...startEdges, ...graphConnectors
    .map((connector) => {
      // 🔵 갈래와 이름은 위 5-3 절이 이미 정해 두었다 — 엑셀 글자 통일과 「NG 의 짝인
      //    이름 없는 선을 정상으로」가 거기 함께 들어 있다. 여기서 다시 가르지 않는다.
      const resolved = resolvedBranchByConnectorId.get(connector.id)!;
      return {
        fromNodeCode: nodeCodeByShapeId.get(connector.fromShapeId!)!,
        toNodeCode: nodeCodeByShapeId.get(connector.toShapeId!)!,
        branchType: resolved.branchType,
        branchLabel: resolved.branchLabel,
        sortOrder: 0,
        sourceConnectorId: connector.id,
      };
    })
    .sort(
      (a, b) =>
        (sortOrderByNodeCode.get(a.fromNodeCode) ?? 0) - (sortOrderByNodeCode.get(b.fromNodeCode) ?? 0) ||
        (sortOrderByNodeCode.get(a.toNodeCode) ?? 0) - (sortOrderByNodeCode.get(b.toNodeCode) ?? 0)
    ),
  ].map((edge, index) => ({ ...edge, sortOrder: index }));

  // 🔵 시작 노드에 대한 메모는 위 6-2 에서 올린다(더했는지 못 더했는지에 따라 글이
  //    갈린다). 2026-11-05 전에는 여기서 「없습니다」를 알렸는데, 이제 **만들므로**
  //    그 글은 거짓이 되어 옮기고 고쳤다.

  return {
    nodes,
    edges,
    droppedShapes,
    droppedConnectors,
    labelBindings,
    reboundEndpoints,
    isolationRuleSkippedReason,
    annotationBoundaryX: boundaryX,
    annotationBoundaryReason,
    issues,
  };
}
