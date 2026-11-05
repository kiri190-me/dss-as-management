import "./load-env";

import { ZipArchive } from "./lib/xlsx/zip-reader";
import { loadWorkbook, type LoadedSheet, type LoadedWorkbook } from "./lib/xlsx/workbook-loader";
import type { DrawingConnector, DrawingShape } from "./lib/xlsx/ooxml-parser";
import { EMU_PER_PIXEL, parseDrawingGeometry } from "./lib/xlsx/drawing-geometry";
import {
  extractTechnicalTaskGraph,
  type TechnicalTaskConnectorInput,
  type TechnicalTaskGraphResult,
  type TechnicalTaskShapeInput,
} from "./lib/xlsx/extract-technical-task-graph";
import {
  buildStageNumberIndex,
  planProceduresForSheet,
  sheetExclusionCategoryLabels,
  type TechnicalTaskProcedurePlan,
} from "./lib/xlsx/technical-task-sheet-plan";
import {
  checkDevelopmentWriteTarget,
  formatDatabaseTarget,
  formatWriteGuardBlockMessage,
} from "./lib/dev-database-write-guard";
import { validateProcedureGraphStructure } from "@/lib/domain/procedure-graph-structural-validation";
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
 * 1단계(2026-11-05)의 대상 시트 **하나**. 가장 단순해서 규칙이 맞는지 사람이 눈으로
 * 가릴 수 있다. 나머지 시트는 이 결과를 사람이 확인한 뒤 2단계에서 한다 —
 * 규칙이 틀린 채로 스물몇 개를 만들면 스물몇 개가 전부 못 쓸 물건이 된다.
 */
const PHASE_1_SHEET_NAME = "(RFG) (1)고장 접수 확인";

function parseArgs(): { file: string; sheetNames: string[]; includeExcluded: boolean } {
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
    sheetNames: sheetNames.length > 0 ? sheetNames : [PHASE_1_SHEET_NAME],
    // 제외된 시트를 **드라이런으로 들여다보기만** 하는 깃발. 만들지는 못한다.
    includeExcluded: args.includes("--include-excluded"),
  };
}

/** 시트 머리글 칸 — 겸임 번호 표기가 여기에만 있다(technical-task-sheet-plan.ts). */
function titleTextOf(sheet: LoadedSheet): string | null {
  return sheet.worksheet.cells["A1"] ?? null;
}

type SheetDrawing = {
  shapes: TechnicalTaskShapeInput[];
  connectors: TechnicalTaskConnectorInput[];
  pictureCount: number;
  groupCount: number;
  /** 절대 좌표(`<a:xfrm>`)를 못 읽어 그래프에 못 올린 도형/연결선 번호. */
  missingGeometryIds: string[];
};

/**
 * `parseDrawing`(칸 좌표 · 글자 · 연결 정보)과 `parseDrawingGeometry`(절대 좌표)를
 * 도형 번호로 맞붙인다. 둘을 나눠 둔 까닭은 drawing-geometry.ts 머리말에 있다 —
 * 기존 파서를 안 건드리려고 좌표만 따로 읽는다.
 */
function readSheetDrawing(zip: ZipArchive, sheet: LoadedSheet): SheetDrawing {
  const anchors = sheet.drawing ?? [];
  const geometry = parseDrawingGeometry(sheet.drawingPath ? zip.readTextOrNull(sheet.drawingPath) : null);
  const missingGeometryIds: string[] = [];

  const shapes: TechnicalTaskShapeInput[] = [];
  for (const anchor of anchors.filter((a): a is DrawingShape => a.kind === "shape")) {
    const g = anchor.id ? geometry.get(anchor.id) : undefined;
    if (!anchor.id || !g) {
      missingGeometryIds.push(anchor.id ? `shape#${anchor.id}` : "shape#(번호 없음)");
      continue;
    }
    shapes.push({ ...g, text: anchor.text });
  }

  const connectors: TechnicalTaskConnectorInput[] = [];
  for (const anchor of anchors.filter((a): a is DrawingConnector => a.kind === "connector")) {
    const g = anchor.id ? geometry.get(anchor.id) : undefined;
    if (!anchor.id || !g) {
      missingGeometryIds.push(anchor.id ? `connector#${anchor.id}` : "connector#(번호 없음)");
      continue;
    }
    connectors.push({
      ...g,
      fromShapeId: anchor.stCxnId,
      toShapeId: anchor.endCxnId,
      isStraight: /^(straightConnector\d*|line)$/i.test(anchor.geom ?? ""),
    });
  }

  return {
    shapes,
    connectors,
    pictureCount: anchors.filter((a) => a.kind === "picture").length,
    groupCount: anchors.filter((a) => a.kind === "group").length,
    missingGeometryIds,
  };
}

function px(emu: number): string {
  return `${Math.round(emu / EMU_PER_PIXEL)}px`;
}

function emu(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

const DROPPED_SHAPE_REASON_LABELS: Record<string, string> = {
  BRANCH_LABEL: "분기 이름",
  EMPTY_BOX: "빈 상자",
  ANNOTATION_REGION: "주석 영역",
  DUPLICATE_SHAPE_ID: "도형 번호 중복",
};

const DROPPED_CONNECTOR_REASON_LABELS: Record<string, string> = {
  UNRESOLVED_ENDPOINT: "끝이 안 묶임",
  POINTS_AT_DROPPED_SHAPE: "노드가 아닌 도형을 가리킴",
  SELF_EDGE: "자기 자신",
  ABANDONED_FOR_NEXT_PROCEDURE: "🔴 이어가기 때문에 포기한 분기",
};

/** 그림층의 도형·연결선 수 — 「흐름도인가」를 재는 자다(제외 판정에 쓴다). */
function drawingCountsOf(sheet: LoadedSheet): { shapeCount: number; connectorCount: number } {
  const anchors = sheet.drawing ?? [];
  return {
    shapeCount: anchors.filter((a) => a.kind === "shape").length,
    connectorCount: anchors.filter((a) => a.kind === "connector").length,
  };
}

/** 워크북 전체의 단계 번호 표 — 노드의 `(번호)` 참조를 풀 때 쓴다. */
function planWholeWorkbook(wb: LoadedWorkbook): {
  plans: TechnicalTaskProcedurePlan[];
  bySheetName: Map<string, TechnicalTaskProcedurePlan[]>;
} {
  const plans: TechnicalTaskProcedurePlan[] = [];
  const bySheetName = new Map<string, TechnicalTaskProcedurePlan[]>();
  for (const sheet of wb.sheets) {
    const sheetPlans = planProceduresForSheet(sheet.name, titleTextOf(sheet), drawingCountsOf(sheet));
    if (sheetPlans.length === 0) continue;
    bySheetName.set(sheet.name, sheetPlans);
    plans.push(...sheetPlans);
  }
  return { plans, bySheetName };
}

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

  console.log(`\n  ── 노드 ${result.nodes.length}개 ${"─".repeat(40)}`);
  for (const node of result.nodes) {
    console.log(
      `   #${node.sortOrder} ${node.nodeCode.padEnd(10)} [${procedureNodeTypeLabels[node.nodeType]}] ` +
        `(${node.nodeType})  "${node.title}"`
    );
    console.log(`        자리=(${node.positionX},${node.positionY})  유형 근거: ${node.nodeTypeReason}`);
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
  for (const edge of result.edges) {
    const label = edge.branchLabel ? `"${edge.branchLabel}"` : "(이름 없음)";
    console.log(
      `   ${edge.fromNodeCode} --[${procedureBranchTypeLabels[edge.branchType]} ${label}]--> ` +
        `${edge.toNodeCode}   (connector#${edge.sourceConnectorId})`
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
    console.log(`   [${issue.severity}] ${issue.issueType}: ${issue.message} ${issue.nodeId ?? issue.edgeId ?? ""}`);
  }
}

async function applyToDatabase(
  wb: LoadedWorkbook,
  built: { plan: TechnicalTaskProcedurePlan; sheet: LoadedSheet; result: TechnicalTaskGraphResult }[]
): Promise<void> {
  // 🔴 1차 — **붙기 전에** 가린다. 접속 URL 만 보는 순수 검사라 여기서 막히면
  //    운영 DB 에 TCP 연결조차 열리지 않는다. 2차(서버가 말한 이름 대조)는 아래에.
  const preflight = checkDevelopmentWriteTarget({ databaseUrl: process.env.DATABASE_URL });
  if (!preflight.allowed) throw new Error(formatWriteGuardBlockMessage(preflight));

  // 🔴 쓰기 경로의 모듈은 여기서 **처음** 불러온다. 드라이런에서는 이 줄에 닿지
  //    않으므로 DB 연결도 server-only 조건도 필요 없다.
  const { sql, and, eq } = await import("drizzle-orm");
  const { db, pgClient } = await import("../src/lib/db/connection");
  const { procedureTemplates, users } = await import("../src/lib/db/schema");
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

    for (const { plan, sheet, result } of built) {
      // 🔴 이어가기(`(번호)` 참조)는 **2단계 일**이다. 지금 쓰기 경로
      //    (createDraftProcedureTemplateFromImport → insertTemplateContent)는
      //    next_procedure_template_id 칸을 아예 안 쓴다 — 그대로 밀어 넣으면 참조가
      //    조용히 사라진 반쪽 절차가 남는다. 반쪽을 만드느니 멈춘다.
      const refs = result.nodes.filter((n) => n.nextProcedureStageNumber !== null);
      if (refs.length > 0) {
        console.log(
          `  -> 건너뜀: "${plan.name}" 에 다른 절차를 가리키는 노드가 ${refs.length}개 있습니다 ` +
            `(이어가기 연결은 2단계에서 붙인다).`
        );
        continue;
      }

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
      console.log(
        outcome.ok
          ? `  -> DRAFT 로 만들었습니다: "${plan.name}" id=${outcome.id}`
          : `  -> 실패: [${outcome.code}] ${outcome.message}`
      );
    }
    console.log("\n만든 절차는 전부 DRAFT 입니다 — 이 스크립트는 게시하지 않습니다.");
  } finally {
    await pgClient.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const { file, sheetNames, includeExcluded } = parseArgs();
  const wb = loadWorkbook(file);
  const zip = ZipArchive.fromFile(file);

  console.log("=".repeat(74));
  console.log("엑셀 도형 흐름도 → 기술 작업 절차 (TECHNICAL_TASK)");
  console.log("=".repeat(74));
  console.log(`원본 파일 : ${wb.sourceFileName}`);
  console.log(`sha256    : ${wb.sourceFileHash}`);
  console.log(`시트      : ${wb.sheets.length}개 중 대상 ${sheetNames.length}개 — ${sheetNames.join(" / ")}`);
  console.log(`모드      : ${APPLY ? "APPLY (DB 에 쓴다)" : "DRY RUN (DB 를 한 글자도 안 바꾼다)"}`);

  const { plans, bySheetName } = planWholeWorkbook(wb);
  const { byStageNumber, conflicts } = buildStageNumberIndex(plans);
  console.log(`\n${"=".repeat(74)}`);
  console.log(`워크북 전체 절차 계획 ${plans.length}개 (이번에 만드는 것은 아래 「대상」뿐)`);
  console.log("=".repeat(74));
  for (const [sheetName, sheetPlans] of bySheetName) {
    // 🔵 이름만 보고 세운 계획이다. 그 시트에 **도형 흐름도가 실제로 있는지**를 함께
    //    찍는다 — 제외 판정의 「흐름도가 없다」 갈래가 바로 이 숫자를 보고 정해진다.
    const sheet = wb.sheets.find((s) => s.name === sheetName);
    const { shapeCount, connectorCount } = sheet
      ? drawingCountsOf(sheet)
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

  const built: { plan: TechnicalTaskProcedurePlan; sheet: LoadedSheet; result: TechnicalTaskGraphResult }[] = [];
  for (const sheetName of sheetNames) {
    const sheet = wb.sheets.find((s) => s.name === sheetName);
    if (!sheet) {
      console.log(`\n🔴 시트를 찾을 수 없습니다: "${sheetName}"`);
      process.exitCode = 1;
      continue;
    }
    const sheetPlans = bySheetName.get(sheet.name);
    if (!sheetPlans || sheetPlans.length === 0) {
      console.log(`\n🔴 "${sheet.name}" 은(는) 장비 머리말이 없어 절차 계획을 세울 수 없습니다.`);
      process.exitCode = 1;
      continue;
    }
    const drawing = readSheetDrawing(zip, sheet);
    for (const plan of sheetPlans) {
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
      const result = extractTechnicalTaskGraph({
        sheetName: sheet.name,
        nodeCodePrefix: plan.nodeCodePrefix,
        shapes: drawing.shapes,
        connectors: drawing.connectors,
      });
      printSheetResult(sheet, drawing, plan, result, byStageNumber);
      built.push({ plan, sheet, result });
    }
  }

  if (!APPLY) {
    console.log(`\n${"=".repeat(74)}`);
    console.log("드라이런입니다 — DB 에 아무것도 쓰지 않았습니다.");
    console.log("쓰려면: APPLY=1 node --conditions=react-server --import tsx " + process.argv[1]);
    console.log("=".repeat(74));
    return;
  }
  await applyToDatabase(wb, built);
}

main().catch((error) => {
  console.error("실패:", error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
