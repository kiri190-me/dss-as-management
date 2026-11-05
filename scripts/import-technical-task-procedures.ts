import "./load-env";

import type { LoadedSheet, LoadedWorkbook } from "./lib/xlsx/workbook-loader";
import { EMU_PER_PIXEL } from "./lib/xlsx/drawing-geometry";
import type { TechnicalTaskGraphResult } from "./lib/xlsx/extract-technical-task-graph";
import {
  sheetExclusionCategoryLabels,
  type TechnicalTaskProcedurePlan,
} from "./lib/xlsx/technical-task-sheet-plan";
import {
  buildProceduresForSheets,
  drawingCountsOf,
  planWorkbook,
  type BuiltProcedure,
  type SheetDrawing,
} from "./lib/xlsx/technical-task-workbook";
import {
  formatBlockingReferences,
  planNextProcedureUnlinks,
} from "./lib/xlsx/technical-task-next-procedure-plan";
import {
  checkDevelopmentWriteTarget,
  formatDatabaseTarget,
  formatWriteGuardBlockMessage,
} from "./lib/dev-database-write-guard";
import { validateProcedureGraphStructure } from "@/lib/domain/procedure-graph-structural-validation";
import {
  computeNodeDimensions,
  getNodeChipVisual,
  NODE_VISUAL_CONFIG,
} from "@/lib/domain/procedure-visual-language";
import {
  procedureBranchTypeLabels,
  procedureEquipmentTypeLabels,
  procedureNodeTypeLabels,
} from "@/lib/domain/procedure-template-types";

/**
 * ============================================================================
 * 엑셀 도형 흐름도 → **기술 작업 절차**(category = TECHNICAL_TASK) 들여오기
 * ============================================================================
 * 기존 `import-procedure-templates.ts` 와 **다른 길**이다. 그쪽은 RFG 시트 열 장을
 * 하나로 합쳐 FULL_SERVICE 절차 한 개를 만들고, 이쪽은 **시트 한 장이 절차 한 개**다.
 * 그쪽 코드는 한 글자도 안 건드린다 — 이미 들여온 결과가 DB 에 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 기본은 **드라이런**이다 — DB 를 한 글자도 안 바꾼다
 * ──────────────────────────────────────────────────────────────────────
 *   npx tsx scripts/import-technical-task-procedures.ts --file "<xlsx 경로>"
 *
 * 읽은 결과를 사람이 눈으로 대조할 수 있게 전부 찍는다: 노드와 그 유형(그리고
 * **어느 규칙이 그 유형을 정했는지**), 분기, 분기 이름이 어느 선에 얼마만큼
 * 떨어져 붙었는지, 그리고 🔴 **버린 도형과 버린 까닭**. 지난 들여오기가 못 쓰게 된
 * 가장 큰 까닭이 「무엇이 사라졌는지 아무도 모른다」였다.
 *
 * DB 쪽 모듈은 이 길에서 **아예 안 불러온다**(아래 dynamic import). 드라이런이
 * DATABASE_URL 하나 없이도 도는 것이 그 자체로 「DB 에 안 닿는다」의 증거다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 쓰기는 `APPLY=1` 일 때만, 그것도 개발/시험 DB 에서만
 * ──────────────────────────────────────────────────────────────────────
 *   APPLY=1 node --conditions=react-server --import tsx \
 *     scripts/import-technical-task-procedures.ts --file "<xlsx 경로>"
 *
 * `--conditions=react-server` 가 필요한 까닭은 쓰기 경로가 `server-only` 를 들여오는
 * 모듈이기 때문이다(드라이런에는 필요 없다). 안전 게이트는
 * `migrate-workflow-rules-to-db.ts` 와 같은 모양이다 — `current_database()` 가
 * dss_as_dev/dss_as_test 가 아니면 그 자리에서 멈춘다.
 *
 * 만드는 절차는 **언제나 DRAFT** 다. 게시하지 않는다. 기존 행은 지우지도 고치지도
 * 않는다 — 새 행을 더하는 것만 한다.
 */

const APPLY = process.env.APPLY === "1";

/**
 * `--sheet` 를 안 주면 만드는 **이번 묶음**.
 *
 * 🔴 **끊어서 간다**(2026-11-05 사용자 결정). 규칙이 틀린 채로 열넷을 한꺼번에
 * 만들면 열넷이 전부 못 쓸 물건이 된다. 묶음마다 사람이 화면에서 눈으로 가린 뒤
 * 다음으로 넘어간다 — 이 목록을 갈아 끼우거나 `--sheet` 로 지정한다.
 *
 * ── 지나온 묶음 ────────────────────────────────────────────────────────
 * **1·2차 아홉 장**(끝남 · 사용자 눈 확인 「플로우차트에는 문제 없다」):
 * `(1)` `(3)` `(6)` `(2)` `(8)` `(11)` `(12)` `(MB) 고장 접수 확인` `(MB) 통전검사`.
 * 🔴 **다시 만들지 않는다** — 이미 DB 에 있고 사람이 확인했다(그래서 `--replace`
 * 도 이번엔 필요 없다).
 *
 * ── 지금 묶음(3차) — **처음으로 큰 시트 둘** ───────────────────────────
 * `(4)` 는 도형 118·선 112, `(5)` 는 143·132 다. 노드가 78·88개라 드라이런이
 * 매우 길어진다 — 그래서 노드 목록은 **유형별 집계로 줄여** 찍는다
 * (`NODE_LIST_PRINT_LIMIT`). 사람이 볼 알맹이는 버린 것·이어 붙인 선·메모·구조
 * 문제 쪽이고, 그것들은 **전부** 그대로 찍는다.
 *
 * 🔵 둘 다 **참조 노드가 하나씩** 있다: `(4)` → `(5)` · `(5)` → `(6)`.
 * `(6)` 은 이미 DB 에 있으므로 만든 직후 잇기를 돌리면 그 자리에서 이어진다.
 */
const CURRENT_BATCH_SHEET_NAMES = [
  "(RFG) (4)기본 정전 검사",
  "(RFG) (5)통전검사(3상입력)",
];

function parseArgs(): { file: string; sheetNames: string[]; includeExcluded: boolean; replace: boolean } {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  if (!file) {
    console.error(
      'Usage: npx tsx scripts/import-technical-task-procedures.ts --file <xlsx> [--sheet "<시트 이름>" ...] [--include-excluded]'
    );
    process.exit(1);
  }
  const sheetNames: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sheet" && args[i + 1]) sheetNames.push(args[i + 1]);
  }
  return {
    file,
    sheetNames: sheetNames.length > 0 ? sheetNames : CURRENT_BATCH_SHEET_NAMES,
    // 제외된 시트를 **드라이런으로 들여다보기만** 하는 깃발. 만들지는 못한다.
    includeExcluded: args.includes("--include-excluded"),
    /**
     * 🔴 **이미 만든 것을 지우고 다시 만든다.** 규칙이 바뀌면 옛 절차는 옛 규칙의
     * 결과라 그대로 두면 안 된다(2026-11-05 에 노드 제목 규칙이 바뀌었다).
     *
     * 🔴 **기본값이 아니다 — 명시적으로 켜야 한다.** 실수로 돌렸을 때 남의 작업이
     * 사라지면 안 되고, 깃발을 손으로 치는 것은 실수로 되는 일이 아니다.
     *
     * 🔴 지우는 범위는 아래 applyToDatabase 가 **이름 · 원본 파일 해시 · 분류 ·
     * 상태(DRAFT)** 넷으로 좁힌다. 사람이 손으로 만든 절차나 게시본은 애초에 안 걸린다.
     */
    replace: args.includes("--replace"),
  };
}

/**
 * 노드가 이보다 많으면 목록을 줄여 찍는다. 🔵 이 값 자체에 뜻이 있지는 않다 —
 * 「한 화면에 들어오는가」가 기준이고, 1·2차에서 가장 컸던 시트가 15개였다.
 */
const NODE_LIST_PRINT_LIMIT = 25;

function px(emu: number): string {
  return `${Math.round(emu / EMU_PER_PIXEL)}px`;
}

function emu(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

const DROPPED_SHAPE_REASON_LABELS: Record<string, string> = {
  BRANCH_LABEL: "분기 이름",
  EMPTY_BOX: "빈 상자",
  NOT_IN_FLOW: "흐름에 안 닿음",
  ANNOTATION_REGION: "주석 영역",
  DUPLICATE_SHAPE_ID: "도형 번호 중복",
};

const DROPPED_CONNECTOR_REASON_LABELS: Record<string, string> = {
  UNRESOLVED_ENDPOINT: "끝이 안 묶임",
  POINTS_AT_DROPPED_SHAPE: "노드가 아닌 도형을 가리킴",
  SELF_EDGE: "자기 자신",
  ABANDONED_FOR_NEXT_PROCEDURE: "🔴 이어가기 때문에 포기한 분기",
};

function printSheetResult(
  sheet: LoadedSheet,
  drawing: SheetDrawing,
  plan: TechnicalTaskProcedurePlan,
  result: TechnicalTaskGraphResult,
  stageIndex: Map<string, TechnicalTaskProcedurePlan>
): void {
  console.log(`\n${"=".repeat(74)}`);
  console.log(`[시트] ${sheet.name}`);
  console.log("=".repeat(74));
  console.log(
    `  절차 이름 : ${plan.name}` +
      (plan.duplicateOfStageNumber ? `   (단계 ${plan.duplicateOfStageNumber} 시트의 복제본)` : "")
  );
  console.log(
    `  장비 유형 : ${plan.equipmentType} (${procedureEquipmentTypeLabels[plan.equipmentType]})` +
      `   단계 번호: ${plan.stageNumber ?? "없음"}   노드코드 앞가지: ${plan.nodeCodePrefix}`
  );
  console.log(
    `  그림층    : 도형 ${drawing.shapes.length} · 연결선 ${drawing.connectors.length} · ` +
      `그림 ${drawing.pictureCount} · 묶음 ${drawing.groupCount}` +
      (drawing.missingGeometryIds.length > 0
        ? `   🔴 좌표 미확보 ${drawing.missingGeometryIds.length}개: ${drawing.missingGeometryIds.join(", ")}`
        : "   (좌표 미확보 0)")
  );
  console.log(
    `  본문/주석 : ${result.annotationBoundaryX === null ? "경계 없음" : `경계 x=${px(result.annotationBoundaryX)}`} — ${result.annotationBoundaryReason}`
  );
  // 🔴 규칙을 **껐다면** 머리에 바로 찍는다. 끈 사실이 조용하면, 그 시트에 진짜
  //    사진 캡션이 섞여 들어와도 사람이 그 까닭을 찾을 자리가 없다.
  if (result.isolationRuleSkippedReason) {
    console.log(`  🔴 고립 규칙 : 껐습니다 — ${result.isolationRuleSkippedReason}`);
  }

  console.log(`\n  ── 노드 ${result.nodes.length}개 ${"─".repeat(40)}`);
  /**
   * 🔴 큰 시트는 **노드를 전부 찍지 않는다.** `(7)원복 검사` 는 155개라 목록만
   * 수백 줄이 되고, 그 더미에 파묻혀 **정작 봐야 할 것**(버린 도형·이어 붙인 선·
   * 구조 문제)을 아무도 안 읽는다 — 실패 메시지가 그렇게 파묻혀 한 번 놓쳤다.
   *
   * 🔵 줄여 찍어도 **유형별 집계**와 **참조 노드**는 반드시 남긴다. 집계는
   * 「이 절차가 무엇으로 이루어졌나」를 한 줄로 말해 주고, 참조 노드는 다른 절차와
   * 이어지는 자리라 수가 적고 뜻이 크다.
   */
  const nodeTally = new Map<string, number>();
  for (const node of result.nodes) nodeTally.set(node.nodeType, (nodeTally.get(node.nodeType) ?? 0) + 1);
  console.log(
    `   유형별: ${[...nodeTally]
      .map(([type, count]) => `${procedureNodeTypeLabels[type as keyof typeof procedureNodeTypeLabels]} ${count}`)
      .join(" · ")}`
  );
  const condensed = result.nodes.length > NODE_LIST_PRINT_LIMIT;
  const listedNodes = condensed
    ? result.nodes.filter((n) => n.origin === "AUTO_START" || n.nextProcedureStageNumber !== null)
    : result.nodes;
  if (condensed) {
    console.log(
      `   🔵 노드가 ${result.nodes.length}개라 목록을 줄입니다 — 시작 노드와 다른 절차를 ` +
        `가리키는 노드 ${listedNodes.length}개만 찍습니다(나머지는 화면에서 보세요).`
    );
  }
  for (const node of listedNodes) {
    console.log(
      `   #${node.sortOrder} ${node.nodeCode.padEnd(10)} [${procedureNodeTypeLabels[node.nodeType]}] ` +
        `(${node.nodeType})  "${node.title}"`
    );
    // 🔵 제목이 **도형 글자 전문**이 되면서(2026-11-05) 상자가 커졌다. 자동 배치가
    //    폭·높이를 제목에서 계산하므로 그림이 달라진다 — 얼마나 커지는지 값으로 보인다.
    const { semanticType } = getNodeChipVisual(node.nodeType);
    const dims = computeNodeDimensions({ title: node.title, shape: NODE_VISUAL_CONFIG[semanticType].shape });
    console.log(
      `        자리=(${node.positionX},${node.positionY})  상자=${dims.width}×${dims.height}px` +
        `(${dims.visibleLines}줄${dims.isTruncated ? " · 🔴 잘림" : ""})  유형 근거: ${node.nodeTypeReason}`
    );
    if (node.safetyCaution) console.log(`        주의: ${node.safetyCaution}`);
    if (node.nextProcedureStageNumber) {
      const target = stageIndex.get(node.nextProcedureStageNumber);
      console.log(
        `        🔗 다음 절차: (${node.nextProcedureStageNumber}) → ` +
          (target ? `${target.name}  [${target.sourceWorksheet}]` : "🔴 그 번호의 절차가 없다")
      );
    }
  }

  console.log(`\n  ── 분기 ${result.edges.length}개 ${"─".repeat(40)}`);
  // 분기도 같은 까닭으로 줄인다 — 113줄짜리 목록이 뒤의 알맹이를 덮는다.
  // 🔵 **이름이 붙은 분기**(NG·YES·NO·정상)는 줄여도 남긴다. 기본 분기는 흐름을
  //    따라가는 줄이고, 이름이 붙은 쪽이 사람이 눈으로 맞대어 볼 자리다.
  const edgeTally = new Map<string, number>();
  for (const edge of result.edges) edgeTally.set(edge.branchType, (edgeTally.get(edge.branchType) ?? 0) + 1);
  console.log(
    `   갈래별: ${[...edgeTally]
      .map(([type, count]) => `${procedureBranchTypeLabels[type as keyof typeof procedureBranchTypeLabels]} ${count}`)
      .join(" · ")}`
  );
  const condensedEdges = result.edges.length > NODE_LIST_PRINT_LIMIT;
  const listedEdges = condensedEdges ? result.edges.filter((e) => e.branchLabel !== null) : result.edges;
  if (condensedEdges) {
    console.log(
      `   🔵 분기가 ${result.edges.length}개라 목록을 줄입니다 — 이름이 붙은 ${listedEdges.length}개만 찍습니다.`
    );
  }
  for (const edge of listedEdges) {
    const label = edge.branchLabel ? `"${edge.branchLabel}"` : "(이름 없음)";
    console.log(
      `   ${edge.fromNodeCode} --[${procedureBranchTypeLabels[edge.branchType]} ${label}]--> ` +
        // 자동으로 더한 시작 분기는 엑셀의 연결선에서 온 것이 아니다 — 섞어 찍지 않는다.
        `${edge.toNodeCode}   ${edge.sourceConnectorId ? `(connector#${edge.sourceConnectorId})` : "(자동으로 더한 분기)"}`
    );
  }

  console.log(`\n  ── 분기 이름 붙이기 ${result.labelBindings.length}건 ${"─".repeat(28)}`);
  for (const binding of result.labelBindings) {
    // 거리가 0(라벨이 선 위에 그대로 얹힌 경우)이면 배수가 Infinity 가 된다 —
    // 숫자 대신 말로 적는다. 사람이 읽고 가리는 자리라 「∞배」는 읽히지 않는다.
    const ratio =
      binding.runnerUpDistance === null
        ? "차점 없음"
        : binding.distance === 0
          ? "선 위에 얹힘"
          : `${(binding.runnerUpDistance / binding.distance).toFixed(2)}배`;
    console.log(
      `   "${binding.labelText}" (shape#${binding.labelShapeId}) → connector#${binding.connectorId}  ` +
        `거리 ${emu(binding.distance)} EMU / 차점 ${binding.runnerUpDistance === null ? "-" : emu(binding.runnerUpDistance)} (${ratio})  ` +
        `${binding.confident ? "확실" : "🔴 거의 비김"}`
    );
  }

  // 🔴 엑셀에 **안 적혀 있던** 연결이다. 적혀 있던 것과 믿음의 정도가 달라서
  //    따로 보여 준다 — 사람이 이 목록만 훑어 검산할 수 있어야 한다.
  console.log(`\n  ── 🔴 좌표로 이어 붙인 선 끝 ${result.reboundEndpoints.length}건 ${"─".repeat(20)}`);
  for (const rebound of result.reboundEndpoints) {
    console.log(
      `   connector#${rebound.connectorId} 의 ${rebound.side === "START" ? "시작" : "끝"} → ` +
        `shape#${rebound.shapeId} "${rebound.shapeText}"  거리 ${emu(rebound.distance)} EMU / ` +
        `차점 ${rebound.runnerUpDistance === null ? "-" : emu(rebound.runnerUpDistance)}  ` +
        `${rebound.confident ? "확실" : "🔴 거의 비김"}`
    );
  }

  console.log(`\n  ── 버린 도형 ${result.droppedShapes.length}개 ${"─".repeat(36)}`);
  for (const dropped of result.droppedShapes) {
    console.log(
      `   shape#${dropped.shapeId.padEnd(4)} "${dropped.text}"  ` +
        `[${DROPPED_SHAPE_REASON_LABELS[dropped.reason] ?? dropped.reason}] ${dropped.detail}`
    );
  }

  console.log(`\n  ── 버린 연결선 ${result.droppedConnectors.length}개 ${"─".repeat(34)}`);
  for (const dropped of result.droppedConnectors) {
    console.log(
      `   connector#${dropped.connectorId} (${dropped.fromShapeId ?? "?"}→${dropped.toShapeId ?? "?"})  ` +
        `[${DROPPED_CONNECTOR_REASON_LABELS[dropped.reason] ?? dropped.reason}] ${dropped.detail}`
    );
  }

  console.log(`\n  ── 들여오기가 남긴 메모 ${result.issues.length}건 ${"─".repeat(28)}`);
  for (const issue of result.issues) {
    console.log(`   [${issue.severity}] ${issue.issueType}: ${issue.message}`);
  }

  // 편집기의 [검증]·게시 관문이 쓰는 바로 그 함수로 미리 재 본다. 들여온 직후의
  // 그래프가 편집기에서 무엇으로 보일지를 여기서 먼저 알려 준다.
  const structural = validateProcedureGraphStructure(
    result.nodes.map((n) => ({ id: n.nodeCode, nodeType: n.nodeType })),
    result.edges.map((e, i) => ({
      id: `e${i}`,
      fromNodeId: e.fromNodeCode,
      toNodeId: e.toNodeCode,
      branchType: e.branchType,
    }))
  );
  console.log(`\n  ── 편집기 [검증]이 볼 구조 문제 ${structural.length}건 ${"─".repeat(20)}`);
  for (const issue of structural) {
    // 🔴 **어느 노드인지 글자로** 보여 준다. 노드 코드만 찍으면 큰 시트에서는
    //    그 코드를 찾으러 다시 화면을 열어야 한다 — 사람이 그 자리에서 판단해야 한다.
    const node = issue.nodeId ? result.nodes.find((n) => n.nodeCode === issue.nodeId) : undefined;
    console.log(
      `   [${issue.severity}] ${issue.issueType}: ${issue.message} ` +
        `${issue.nodeId ?? issue.edgeId ?? ""}${node ? ` "${node.title.split("\n")[0]}"` : ""}`
    );
    if (node) {
      const outgoing = result.edges.filter((e) => e.fromNodeCode === node.nodeCode);
      console.log(
        `        나가는 분기 ${outgoing.length}개: ` +
          (outgoing.length === 0
            ? "(없음)"
            : outgoing
                .map(
                  (e) =>
                    `${procedureBranchTypeLabels[e.branchType]}→"${(result.nodes.find((n) => n.nodeCode === e.toNodeCode)?.title ?? e.toNodeCode).split("\n")[0]}"`
                )
                .join(" · "))
      );
    }
  }
}

/**
 * 쓰기가 실제로 무엇을 했는가. 🔴 **맨 끝에 한 줄로 요약해 찍는다** — 2026-11-05 에
 * 실패 메시지가 수백 줄짜리 드라이런 뒤에 한 줄로 섞여 **사용자가 못 봤다.** 화면을
 * 보고 나서야 「아직 옛 모양이다」로 알아챘다.
 */
type ApplySummary = {
  unlinked: number;
  deleted: number;
  created: number;
  /** 이미 있어서 안 만든 것. */
  skipped: number;
  /** 만들기가 거절당한 것(권한·충돌 등). */
  failed: number;
};

async function applyToDatabase(
  wb: LoadedWorkbook,
  built: readonly BuiltProcedure[],
  replace: boolean,
  summary: ApplySummary
): Promise<void> {
  // 🔴 1차 — **붙기 전에** 가린다. 접속 URL 만 보는 순수 검사라 여기서 막히면
  //    운영 DB 에 TCP 연결조차 열리지 않는다. 2차(서버가 말한 이름 대조)는 아래에.
  const preflight = checkDevelopmentWriteTarget({ databaseUrl: process.env.DATABASE_URL });
  if (!preflight.allowed) throw new Error(formatWriteGuardBlockMessage(preflight));

  // 🔴 쓰기 경로의 모듈은 여기서 **처음** 불러온다. 드라이런에서는 이 줄에 닿지
  //    않으므로 DB 연결도 server-only 조건도 필요 없다.
  const { sql, and, eq, inArray } = await import("drizzle-orm");
  const { alias } = await import("drizzle-orm/pg-core");
  const { db, pgClient } = await import("../src/lib/db/connection");
  const { procedureTemplates, procedureTemplateNodes, users } = await import("../src/lib/db/schema");
  const { createDraftProcedureTemplateFromImport } = await import(
    "../src/lib/db/mutations/procedure-templates"
  );
  const { generateProcedureTemplateCode } = await import("@/lib/domain/procedure-template-code");

  try {
    // 2차 — 서버가 스스로 말한 이름까지 맞대어 본다. 적힌 곳과 실제로 붙은 곳이
    // 다른 경우(환경변수 뒤바뀜·프록시)는 1차 검사로는 안 잡힌다.
    const identity = await db.execute(sql`select current_database() as name`);
    const actualDatabaseName = (identity[0] as { name?: string } | undefined)?.name ?? null;
    const confirmed = checkDevelopmentWriteTarget({
      databaseUrl: process.env.DATABASE_URL,
      actualDatabaseName,
    });
    if (!confirmed.allowed) throw new Error(formatWriteGuardBlockMessage(confirmed));
    console.log(
      `\n대상 DB: ${formatDatabaseTarget(confirmed.identity)} (${confirmed.reason}) / 모드: APPLY (쓰기)`
    );

    const [actor] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.role, "SUPER_ADMIN"),
          eq(users.approvalStatus, "APPROVED"),
          eq(users.isActive, true),
          eq(users.isDeleted, false)
        )
      )
      .limit(1);
    if (!actor) throw new Error("승인된 활성 SUPER_ADMIN 계정이 없어 들여올 수 없습니다.");

    // ── `--replace` — 이번에 만들 것과 **같은 자리**의 옛 초안을 먼저 치운다 ──
    //
    // 🔴 규칙이 바뀌면 옛 절차는 옛 규칙의 결과다. 그런데 아래의 「이미 있으면
    //    건너뜀」 때문에 그냥 다시 돌리면 **아무 일도 안 일어난다** — 다시 만들 길이
    //    필요하다. 명시적으로 켜야만 돈다(기본값 아님).
    //
    // 🔴 **좁히는 잣대 넷**: 이번에 만들 이름 · 같은 원본 파일 해시 · TECHNICAL_TASK ·
    //    아직 안 지워짐. 그래서 사람이 손으로 만든 절차(파일 해시가 없다)나 다른
    //    워크북에서 온 절차는 애초에 안 걸린다. 🔵 치우는 함수 자체도 `requireStatus:
    //    "DRAFT"` 로 한 번 더 막는다 — 게시본은 그 트랜잭션 안에서 거절된다.
    if (replace) {
      const names = built.map((b) => b.plan.name);
      const victims = await db
        .select({ id: procedureTemplates.id, code: procedureTemplates.code, name: procedureTemplates.name })
        .from(procedureTemplates)
        .where(
          and(
            inArray(procedureTemplates.name, names),
            eq(procedureTemplates.category, "TECHNICAL_TASK"),
            eq(procedureTemplates.sourceFileHash, wb.sourceFileHash),
            eq(procedureTemplates.status, "DRAFT"),
            eq(procedureTemplates.isDeleted, false)
          )
        );
      console.log(`\n--replace — 같은 자리의 옛 초안 ${victims.length}개를 치웁니다.`);
      for (const victim of victims) console.log(`  지울 것: "${victim.name}" (code=${victim.code})`);
      if (victims.length > 0) {
        /**
         * 🔴 **지우기 전에 이어가기를 끊는다.** `next_procedure_template_id` 는
         * `onDelete: "restrict"` 라, 가리켜지는 절차는 삭제가 **거부된다**(실측으로
         * 여기서 한 번 멈췄다). 그 막음은 결함이 아니라 의도된 보호다 — 조용히
         * 지워졌다면 그 참조가 깨진 채 남는다.
         *
         * 🔴 **끊어도 되는 것만** 끊는다 — 가리키는 노드가 이번에 함께 지울 절차
         * 안에 있을 때만이다. 밖에서 가리키면 **지우지 않고 멈춘다**(아래 함수).
         */
        const victimIds = victims.map((v) => v.id);
        const owner = alias(procedureTemplates, "owner");
        const target = alias(procedureTemplates, "target");
        const referenceRows = await db
          .select({
            nodeId: procedureTemplateNodes.id,
            nodeCode: procedureTemplateNodes.nodeCode,
            ownerTemplateId: owner.id,
            ownerTemplateName: owner.name,
            targetTemplateId: target.id,
            targetTemplateName: target.name,
          })
          .from(procedureTemplateNodes)
          .innerJoin(owner, eq(owner.id, procedureTemplateNodes.procedureTemplateId))
          .innerJoin(target, eq(target.id, procedureTemplateNodes.nextProcedureTemplateId))
          .where(inArray(procedureTemplateNodes.nextProcedureTemplateId, victimIds));

        const { toUnlink, blocking } = planNextProcedureUnlinks({
          references: referenceRows,
          victimTemplateIds: victimIds,
        });
        // 🔴 하나라도 밖에서 가리키면 **아무것도 안 지우고** 멈춘다.
        if (blocking.length > 0) throw new Error(formatBlockingReferences(blocking));

        if (toUnlink.length > 0) {
          console.log(`  이어가기 ${toUnlink.length}건을 먼저 끊습니다(전부 이번에 함께 지울 절차 안입니다).`);
          const { updateProcedureTemplateNode } = await import(
            "../src/lib/db/mutations/procedure-template-editor"
          );
          for (const reference of toUnlink) {
            // 🔴 한 건마다 `updatedAt` 을 다시 읽는다 — 앞 건이 그 절차의 값을 바꾼다.
            const [fresh] = await db
              .select({ updatedAt: procedureTemplates.updatedAt })
              .from(procedureTemplates)
              .where(eq(procedureTemplates.id, reference.ownerTemplateId))
              .limit(1);
            if (!fresh) throw new Error(`"${reference.ownerTemplateName}" 를 다시 찾지 못했습니다.`);
            const unlinked = await updateProcedureTemplateNode(
              reference.nodeId,
              actor.id,
              { nextProcedureTemplateId: null },
              fresh.updatedAt.toISOString(),
              "--replace 로 다시 만들기 전에 이어가기를 끊음"
            );
            if (!unlinked.ok) {
              throw new Error(
                `이어가기를 끊지 못했습니다: "${reference.ownerTemplateName}" / ${reference.nodeCode} ` +
                  `[${unlinked.code}] ${unlinked.message}`
              );
            }
            summary.unlinked += 1;
            console.log(`    끊음: "${reference.ownerTemplateName}" / ${reference.nodeCode} → "${reference.targetTemplateName}"`);
          }
        }

        /**
         * 🔴 **진짜 삭제가 아니라 휴지통으로 보낸다** — 화면의 [초안 버리기]와
         * **같은 길**이다(`softDeleteProcedureTemplate`, `requireStatus: "DRAFT"`).
         *
         * ── 왜 `replaceDraftProcedureTemplates` 를 안 쓰는가 (2026-11-05 실측) ──
         * 그 함수는 행을 **물리적으로 지우는데**, `procedure_templates` 를 가리키는
         * 외래키 가운데 **편집 이력(`procedure_template_edit_history`)을 안 지운다.**
         * 그래서 편집 이력이 한 줄이라도 있는 초안은 그 함수로 **영영 못 지운다.**
         *
         * 🔵 그것은 **의도된 차이였다** — `purgeProcedureTemplateContent` 의 주석이
         * 적고 있다: 「그쪽은 갓 가져온 초안만 지우므로 그 두 표에 행이 있을 수
         * 없었다」. 🔴 **그 전제를 우리가 깨뜨렸다.** 잇기 단계와 바로 위의 끊기
         * 단계가 `updateProcedureTemplateNode` 로 편집 이력을 남기기 때문이다.
         *
         * ── 휴지통이 더 나은 까닭 ───────────────────────────────────────
         * ① 아무것도 물리적으로 안 지우므로 **어떤 외래키도 막지 않는다.**
         * ② **되돌릴 수 있다** — 다시 만든 결과가 잘못돼도 15일 안에는 옛 아홉이
         *    휴지통에 남아 있다. 다시 만들기에 딱 맞는 성질이다.
         * ③ 사람이 화면에서 손으로 할 때와 **같은 일**이 된다.
         *
         * 🔵 그래도 바로 위의 **끊기 단계는 여전히 필요하다** —
         * `softDeleteProcedureTemplate` 도 `countProcedureTemplateReferences` 로
         * 이어가기를 세어 막는다(실측: 그 함수의 `pointedByEnd`).
         */
        const { softDeleteProcedureTemplate } = await import("../src/lib/db/mutations/procedure-templates");
        for (const victim of victims) {
          const outcome = await softDeleteProcedureTemplate({
            templateId: victim.id,
            actorUserId: actor.id,
            reason: "--replace 로 같은 시트를 다시 들여오면서 옛 초안을 치움",
            requireStatus: "DRAFT",
          });
          if (!outcome.ok) {
            throw new Error(`옛 초안을 치우지 못했습니다: "${victim.name}" [${outcome.code}] ${outcome.message}`);
          }
          summary.deleted += 1;
          console.log(`  -> 휴지통으로 보냈습니다: "${victim.name}" (code=${victim.code})`);
        }
      }
    }

    for (const { plan, sheet, result } of built) {
      /**
       * 🔴 참조 노드가 있어도 **이제는 만든다**(2026-11-05, 2단계 설계).
       *
       * 전에는 「반쪽을 만드느니 멈춘다」며 건너뛰었다. 그 규칙을 그대로 두면 참조가
       * 있는 절차는 **영원히 못 만든다** — 가리키는 관계가 순환해서 「가리켜지는 것부터」
       * 라는 차례가 존재하지 않기 때문이다(technical-task-workbook.ts 머리말).
       *
       * 대신 이어가기를 **비운 채** 만들고, 비웠다는 사실을 `procedure_template_
       * validation_issues` 한 줄로 남긴다(extract-technical-task-graph.ts). 다 만든 뒤
       * `link-technical-task-next-procedures.ts` 가 그 줄들을 채운다.
       */
      const refs = result.nodes.filter((n) => n.nextProcedureStageNumber !== null);

      // 같은 원본 파일에서 같은 이름의 기술 절차를 이미 만들었으면 또 만들지 않는다.
      // 🔴 코드를 서버가 짓기 때문에(2026-11-05) 원래의 (code, 파일 해시) 멱등 검사가
      //    여기서는 안 걸린다 — 다시 돌릴 때마다 똑같은 DRAFT 가 하나씩 더 생긴다.
      const [existing] = await db
        .select({ id: procedureTemplates.id, code: procedureTemplates.code })
        .from(procedureTemplates)
        .where(
          and(
            eq(procedureTemplates.name, plan.name),
            eq(procedureTemplates.category, "TECHNICAL_TASK"),
            eq(procedureTemplates.sourceFileHash, wb.sourceFileHash),
            eq(procedureTemplates.isDeleted, false)
          )
        )
        .limit(1);
      if (existing) {
        summary.skipped += 1;
        console.log(`  -> 이미 있음: "${plan.name}" (code=${existing.code}, id=${existing.id}) — 건너뜁니다.`);
        continue;
      }

      const outcome = await createDraftProcedureTemplateFromImport(
        {
          // 🔴 코드는 **서버가 짓는다**(procedure-template-code.ts). 사람이 적던 칸은
          //    2026-11-05 에 없어졌고, 들여오기도 같은 규칙을 따른다.
          code: generateProcedureTemplateCode(),
          name: plan.name,
          equipmentType: plan.equipmentType,
          category: "TECHNICAL_TASK",
          description:
            `수리소 업무 정리 워크북의 도형 흐름도 시트 「${sheet.name}」에서 들여온 기술 작업 절차. ` +
            `노드 ${result.nodes.length} · 분기 ${result.edges.length} · 노드로 만들지 않은 도형 ${result.droppedShapes.length}.` +
            (plan.duplicateOfStageNumber
              ? ` 단계 ${plan.duplicateOfStageNumber} 시트가 겸하는 단계 ${plan.stageNumber} 의 복제본이다.`
              : ""),
          sourceWorksheets: [sheet.name],
          isReferenceOnly: false,
          nodes: result.nodes,
          edges: result.edges,
          checklistSections: [],
          troubleshootingEntries: [],
          referenceItems: [],
          issues: result.issues,
        },
        actor.id,
        { sourceFileName: wb.sourceFileName, sourceFileHash: wb.sourceFileHash }
      );
      if (outcome.ok) summary.created += 1;
      else summary.failed += 1;
      console.log(
        outcome.ok
          ? `  -> DRAFT 로 만들었습니다: "${plan.name}" id=${outcome.id}` +
              (refs.length > 0
                ? `   🔴 이어가기 ${refs.length}건은 비워 뒀습니다 — 잇기 단계를 돌리세요.`
                : "")
          : `  -> 실패: [${outcome.code}] ${outcome.message}`
      );
    }
    console.log("\n만든 절차는 전부 DRAFT 입니다 — 이 스크립트는 게시하지 않습니다.");
  } finally {
    await pgClient.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const { file, sheetNames, includeExcluded, replace } = parseArgs();
  const workbookPlan = planWorkbook(file);
  const wb = workbookPlan.workbook;

  console.log("=".repeat(74));
  console.log("엑셀 도형 흐름도 → 기술 작업 절차 (TECHNICAL_TASK)");
  console.log("=".repeat(74));
  console.log(`원본 파일 : ${wb.sourceFileName}`);
  console.log(`sha256    : ${wb.sourceFileHash}`);
  console.log(`시트      : ${wb.sheets.length}개 중 대상 ${sheetNames.length}개 — ${sheetNames.join(" / ")}`);
  console.log(`모드      : ${APPLY ? "APPLY (DB 에 쓴다)" : "DRY RUN (DB 를 한 글자도 안 바꾼다)"}`);

  const { plans, plansBySheetName: bySheetName, stageIndex: byStageNumber } = workbookPlan;
  const conflicts = workbookPlan.stageNumberConflicts;
  console.log(`\n${"=".repeat(74)}`);
  console.log(`워크북 전체 절차 계획 ${plans.length}개 (이번에 만드는 것은 아래 「대상」뿐)`);
  console.log("=".repeat(74));
  for (const [sheetName, sheetPlans] of bySheetName) {
    // 🔵 이름만 보고 세운 계획이다. 그 시트에 **도형 흐름도가 실제로 있는지**를 함께
    //    찍는다 — 제외 판정의 「흐름도가 없다」 갈래가 바로 이 숫자를 보고 정해진다.
    const sheet = wb.sheets.find((s) => s.name === sheetName);
    const { shapeCount, connectorCount } = sheet
      ? drawingCountsOf(workbookPlan.zip, sheet)
      : { shapeCount: 0, connectorCount: 0 };
    for (const plan of sheetPlans) {
      console.log(
        `  ${plan.excluded ? "✗" : "✓"} ${(plan.stageNumber ?? "-").padStart(3)} | ${plan.name.padEnd(26)} | ` +
          `도형 ${String(shapeCount).padStart(3)}·선 ${String(connectorCount).padStart(3)} | ${plan.sourceWorksheet}` +
          (plan.duplicateOfStageNumber ? `  ← 겸임 복제본 (원문 "${plan.rawCoNumberedLabel}")` : "")
      );
      // 🔴 줄을 지우지 않고 **까닭 갈래와 함께** 남긴다. 조용히 빠지면 「왜 저 시트는
      //    절차가 없지?」에 아무도 답을 못 하고, 특히 「아직 안 한 것」은 영영 안 찾는다.
      if (plan.excluded) {
        console.log(
          `        └ 만들지 않음 [${sheetExclusionCategoryLabels[plan.excluded.category]}] ${plan.excluded.detail}`
        );
      }
    }
  }
  const excludedPlans = plans.filter((p) => p.excluded);
  const deferred = excludedPlans.filter((p) => p.excluded!.category === "DEFERRED_CELL_BASED");
  console.log(
    `  ── 만들 것 ${plans.length - excludedPlans.length}개 / 만들지 않을 것 ${excludedPlans.length}개` +
      (deferred.length > 0
        ? `  🔵 그중 ${deferred.length}개는 **아직 안 한 것**이다(3단계): ${deferred.map((p) => p.sourceWorksheet).join(", ")}`
        : "")
  );
  if (conflicts.length > 0) {
    console.log(`  🔴 같은 단계 번호가 둘 이상인 것: ${conflicts.join(", ")} — 참조를 풀 수 없어 표에서 뺐습니다.`);
  }

  const { built: candidates, missingSheetNames, unplannedSheetNames } = buildProceduresForSheets(
    workbookPlan,
    sheetNames
  );
  for (const sheetName of missingSheetNames) {
    console.log(`\n🔴 시트를 찾을 수 없습니다: "${sheetName}"`);
    process.exitCode = 1;
  }
  for (const sheetName of unplannedSheetNames) {
    console.log(`\n🔴 "${sheetName}" 은(는) 장비 머리말이 없어 절차 계획을 세울 수 없습니다.`);
    process.exitCode = 1;
  }

  const built: BuiltProcedure[] = [];
  for (const candidate of candidates) {
    const { plan, sheet, drawing, result } = candidate;
    // 🔴 제외된 시트는 **만들지 않는다.** `--include-excluded` 를 주면 들여다볼
    //    수는 있지만(드라이런 전용), APPLY 에서는 그 깃발도 안 듣는다 —
    //    「보려고 켠 깃발」이 「쓰기」로 넘어가면 결정이 깃발 하나로 뒤집힌다.
    if (plan.excluded && !(includeExcluded && !APPLY)) {
      console.log(
        `\n✗ "${plan.name}" (${sheet.name}) — 만들지 않습니다 ` +
          `[${sheetExclusionCategoryLabels[plan.excluded.category]}] ${plan.excluded.detail}` +
          (APPLY ? "" : `\n   들여다보려면 --include-excluded 를 주세요(드라이런 전용).`)
      );
      continue;
    }
    printSheetResult(sheet, drawing, plan, result, byStageNumber);
    built.push(candidate);
  }

  // 🔴 이어가기를 **비워 두고** 만드는 것들을 한곳에 모아 보여 준다. 절차마다 흩어진
  //    메모만으로는 「다 만든 뒤에 잇기를 돌려야 한다」가 눈에 안 들어온다.
  const pendingLinks = built.flatMap(({ plan, result }) =>
    result.nodes
      .filter((n) => n.nextProcedureStageNumber !== null)
      .map((n) => ({ plan, node: n }))
  );
  console.log(`\n${"=".repeat(74)}`);
  console.log(`이어가기를 비워 두고 만드는 노드 ${pendingLinks.length}개`);
  console.log("=".repeat(74));
  if (pendingLinks.length === 0) {
    console.log("  없습니다 — 이번 대상에는 다른 절차를 가리키는 노드가 하나도 없습니다.");
  } else {
    for (const { plan, node } of pendingLinks) {
      const target = byStageNumber.get(node.nextProcedureStageNumber!);
      // 🔵 제목이 **여러 줄**이 될 수 있다(2026-11-05) — 요약 줄에는 첫 줄만 넣는다.
      //    전문은 바로 위의 노드 목록에 줄바꿈까지 그대로 찍혀 있다.
      const oneLine = node.title.split("\n")[0];
      console.log(
        `  ${plan.name} / ${node.nodeCode} "${oneLine}${node.title.includes("\n") ? " …" : ""}" ` +
          `→ (${node.nextProcedureStageNumber}) ` +
          (target ? `"${target.name}"` : "🔴 그 번호의 절차가 계획에 없다")
      );
    }
    console.log(
      `  🔴 절차끼리 가리키는 관계가 **순환**해서 만들면서 동시에 이을 수 없습니다.\n` +
        `     다 만든 뒤 잇기 단계를 돌리세요: scripts/link-technical-task-next-procedures.ts\n` +
        `     비워 뒀다는 사실은 절차마다 [검증 결과] 한 줄(sourceReference = node:<노드코드>)로 DB 에 남습니다.`
    );
  }

  if (!APPLY) {
    console.log(`\n${"=".repeat(74)}`);
    console.log("드라이런입니다 — DB 에 아무것도 쓰지 않았습니다.");
    console.log("쓰려면: APPLY=1 node --conditions=react-server --import tsx " + process.argv[1]);
    console.log("=".repeat(74));
    return;
  }
  /**
   * 🔴 **결과를 맨 끝에 한 줄로.** 2026-11-05 에 실패 메시지가 수백 줄짜리 드라이런
   * 뒤에 섞여 사용자가 못 봤고, 화면을 보고 나서야 「아직 옛 모양이다」로 알아챘다.
   * 성공이든 실패든 **마지막 줄이 결과를 말해야** 한다(`tail` 로 잘라 봐도 드러나게).
   */
  const summary: ApplySummary = { unlinked: 0, deleted: 0, created: 0, skipped: 0, failed: 0 };
  try {
    await applyToDatabase(wb, built, replace, summary);
  } catch (error) {
    printApplySummary(summary, error);
    process.exitCode = 1;
    return;
  }
  printApplySummary(summary, null);
  if (summary.failed > 0) process.exitCode = 1;
}

function printApplySummary(summary: ApplySummary, error: unknown): void {
  console.log(`\n${"=".repeat(74)}`);
  if (error) {
    console.log("🔴 쓰기 실패 — DB 가 **반만** 바뀌었을 수 있습니다.");
    console.log("=".repeat(74));
    console.log(error instanceof Error ? (error.stack ?? error.message) : String(error));
    console.log("-".repeat(74));
  }
  console.log(
    `결과: 만듦 ${summary.created} · 지움 ${summary.deleted} · 건너뜀 ${summary.skipped} · ` +
      `실패 ${summary.failed} · 끊은 이어가기 ${summary.unlinked}`
  );
  if (error && summary.unlinked > 0) {
    // 🔴 끊어 놓고 중간에 멈추면 **끊긴 채로 남는다.** 다시 만들면 복원되지만,
    //    여기서 멈췄으면 사람이 잇기 단계를 손수 돌려야 한다.
    console.log(
      `🔴 이어가기 ${summary.unlinked}건을 끊은 뒤 멈췄습니다 — 그 참조는 **지금 비어 있습니다.**\n` +
        "   다시 만든 뒤 잇기 단계(link-technical-task-next-procedures.ts)를 꼭 돌리세요."
    );
  }
  console.log(error ? "🔴 실패했습니다." : "✅ 끝났습니다.");
  console.log("=".repeat(74));
}

main().catch((error) => {
  console.error("실패:", error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
