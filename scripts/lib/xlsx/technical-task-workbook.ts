import { ZipArchive } from "./zip-reader";
import { loadWorkbook, type LoadedSheet, type LoadedWorkbook } from "./workbook-loader";
import type { DrawingConnector, DrawingShape } from "./ooxml-parser";
import { parseDrawingGeometry } from "./drawing-geometry";
import {
  extractTechnicalTaskGraph,
  type TechnicalTaskConnectorInput,
  type TechnicalTaskGraphResult,
  type TechnicalTaskShapeInput,
} from "./extract-technical-task-graph";
import {
  buildStageNumberIndex,
  planProceduresForSheet,
  type TechnicalTaskProcedurePlan,
} from "./technical-task-sheet-plan";

/**
 * ============================================================================
 * 워크북 한 권 → **만들 절차들**. 두 스크립트가 **같은 길로** 읽게 하는 자리
 * ============================================================================
 * 2026-11-05 에 들여오기가 두 단계로 갈렸다:
 *   ㉠ `import-technical-task-procedures.ts` — 절차를 만든다(이어가기는 비워 둔다)
 *   ㉡ `link-technical-task-next-procedures.ts` — 다 만든 뒤 이어가기만 잇는다
 *
 * 🔴 **왜 두 단계인가** — 절차끼리 가리키는 관계가 **순환한다.** (8)이 (9)를
 * 가리키고, (9)는 (7)의 복제본이며 (7)이 다시 (8)을 가리킨다. 그래서
 * 「가리켜지는 것부터 만든다」는 차례가 **존재하지 않는다.** 한 번에 하려면
 * 어느 하나는 아직 없는 절차를 가리켜야 하고, FK 가 그것을 막는다.
 *
 * 🔴 **두 단계가 같은 결과를 봐야 한다.** ㉡ 이 ㉠ 과 조금이라도 다르게 읽으면
 * 노드 코드가 어긋나 「이을 노드를 못 찾았다」가 되는데, 그 증상은 **엑셀이
 * 바뀐 것과 구별되지 않는다.** 그래서 읽는 코드를 한 벌만 둔다 — 베껴 두면
 * 둘이 어긋나도 아무 검사도 안 운다.
 */

export type SheetDrawing = {
  shapes: TechnicalTaskShapeInput[];
  connectors: TechnicalTaskConnectorInput[];
  pictureCount: number;
  groupCount: number;
  /** 절대 좌표(`<a:xfrm>`)를 못 읽어 그래프에 못 올린 도형/연결선 번호. */
  missingGeometryIds: string[];
};

/** 시트 머리글 칸 — 겸임 번호 표기가 여기에만 있다(technical-task-sheet-plan.ts). */
export function titleTextOf(sheet: LoadedSheet): string | null {
  return sheet.worksheet.cells["A1"] ?? null;
}

/** 그림층의 도형·연결선 수 — 「흐름도인가」를 재는 자다(제외 판정에 쓴다). */
export function drawingCountsOf(sheet: LoadedSheet): { shapeCount: number; connectorCount: number } {
  const anchors = sheet.drawing ?? [];
  return {
    shapeCount: anchors.filter((a) => a.kind === "shape").length,
    connectorCount: anchors.filter((a) => a.kind === "connector").length,
  };
}

/**
 * `parseDrawing`(칸 좌표 · 글자 · 연결 정보)과 `parseDrawingGeometry`(절대 좌표)를
 * 도형 번호로 맞붙인다. 둘을 나눠 둔 까닭은 drawing-geometry.ts 머리말에 있다 —
 * 기존 파서를 안 건드리려고 좌표만 따로 읽는다.
 */
export function readSheetDrawing(zip: ZipArchive, sheet: LoadedSheet): SheetDrawing {
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

export type BuiltProcedure = {
  plan: TechnicalTaskProcedurePlan;
  sheet: LoadedSheet;
  drawing: SheetDrawing;
  result: TechnicalTaskGraphResult;
};

export type WorkbookPlan = {
  workbook: LoadedWorkbook;
  zip: ZipArchive;
  /** 머리말이 붙은 모든 시트의 계획. 제외된 것도 **줄째로** 들어 있다. */
  plans: TechnicalTaskProcedurePlan[];
  plansBySheetName: Map<string, TechnicalTaskProcedurePlan[]>;
  /** 단계 번호 → 절차. `(번호)` 참조를 풀 때 쓴다. */
  stageIndex: Map<string, TechnicalTaskProcedurePlan>;
  stageNumberConflicts: string[];
};

export function planWorkbook(filePath: string): WorkbookPlan {
  const workbook = loadWorkbook(filePath);
  const zip = ZipArchive.fromFile(filePath);

  const plans: TechnicalTaskProcedurePlan[] = [];
  const plansBySheetName = new Map<string, TechnicalTaskProcedurePlan[]>();
  for (const sheet of workbook.sheets) {
    const sheetPlans = planProceduresForSheet(sheet.name, titleTextOf(sheet), drawingCountsOf(sheet));
    if (sheetPlans.length === 0) continue;
    plansBySheetName.set(sheet.name, sheetPlans);
    plans.push(...sheetPlans);
  }
  const { byStageNumber, conflicts } = buildStageNumberIndex(plans);
  return {
    workbook,
    zip,
    plans,
    plansBySheetName,
    stageIndex: byStageNumber,
    stageNumberConflicts: conflicts,
  };
}

/**
 * 시트 이름 몇 개를 받아 **만들 절차들**을 세운다.
 *
 * 🔴 제외된 시트(`plan.excluded`)는 여기서 **안 거른다** — 거르는 잣대가 두 곳에
 * 있으면 한쪽만 고쳐지는 날이 온다. 부르는 쪽이 `plan.excluded` 를 보고 제 화면에
 * 맞게 처리한다(만들기는 막고, 들여다보기는 깃발로 연다).
 */
export function buildProceduresForSheets(
  workbookPlan: WorkbookPlan,
  sheetNames: readonly string[]
): { built: BuiltProcedure[]; missingSheetNames: string[]; unplannedSheetNames: string[] } {
  const built: BuiltProcedure[] = [];
  const missingSheetNames: string[] = [];
  const unplannedSheetNames: string[] = [];

  for (const sheetName of sheetNames) {
    const sheet = workbookPlan.workbook.sheets.find((s) => s.name === sheetName);
    if (!sheet) {
      missingSheetNames.push(sheetName);
      continue;
    }
    const sheetPlans = workbookPlan.plansBySheetName.get(sheet.name);
    if (!sheetPlans || sheetPlans.length === 0) {
      unplannedSheetNames.push(sheetName);
      continue;
    }
    const drawing = readSheetDrawing(workbookPlan.zip, sheet);
    for (const plan of sheetPlans) {
      built.push({
        plan,
        sheet,
        drawing,
        result: extractTechnicalTaskGraph({
          sheetName: sheet.name,
          nodeCodePrefix: plan.nodeCodePrefix,
          // 자동으로 더하는 시작 노드의 제목 — 머리말을 뗀 절차 이름이다.
          startNodeTitle: plan.label,
          shapes: drawing.shapes,
          connectors: drawing.connectors,
        }),
      });
    }
  }
  return { built, missingSheetNames, unplannedSheetNames };
}
