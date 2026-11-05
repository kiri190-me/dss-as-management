import { ZipArchive } from "./zip-reader";
import { loadWorkbook, type LoadedSheet, type LoadedWorkbook } from "./workbook-loader";
import { connectorPath, parseDrawingObjects } from "./drawing-geometry";
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

/**
 * 그림판 한 장을 **우리 길로** 읽는다.
 *
 * 🔴 `ooxml-parser.ts` 의 `parseDrawing` 을 **안 쓴다**(기존 들여오기 경로는 그대로
 * 그것을 쓴다). 까닭 둘: ① 그쪽은 칸(col/row) 좌표만 주는데 우리는 EMU 가 필요하고,
 * ② **묶음(`<xdr:grpSp>`)을 풀지 못해** 그 안의 도형·연결선을 통째로 잃는다
 * (drawing-geometry.ts 머리말 — 실측으로 흐름이 틀어졌다).
 */
export function readSheetDrawing(zip: ZipArchive, sheet: LoadedSheet): SheetDrawing {
  const { objects, missingGeometryIds, groupCount } = parseDrawingObjects(
    sheet.drawingPath ? zip.readTextOrNull(sheet.drawingPath) : null
  );

  const shapes: TechnicalTaskShapeInput[] = objects
    .filter((o) => o.kind === "shape")
    .map((o) => ({ id: o.id, x: o.x, y: o.y, cx: o.cx, cy: o.cy, flipH: o.flipH, flipV: o.flipV, text: o.text }));

  const connectors: TechnicalTaskConnectorInput[] = objects
    .filter((o) => o.kind === "connector")
    .map((o) => ({
      id: o.id,
      fromShapeId: o.stCxnId,
      toShapeId: o.endCxnId,
      // 🔴 **상자가 아니라 경로를 넘긴다**(2026-11-05). 그래프 쪽은 선의 바깥 상자를
      //    한 번도 안 본다 — 꺾인 선의 상자는 시트 절반을 덮고, 돌아간 선의 상자는
      //    가로·세로가 뒤바뀌어 있다(drawing-geometry.ts 의 `connectorPath` 머리말).
      path: connectorPath(o),
    }));

  return {
    shapes,
    connectors,
    pictureCount: objects.filter((o) => o.kind === "picture").length,
    groupCount,
    missingGeometryIds,
  };
}

/**
 * 그림층의 도형·연결선 수 — 「흐름도인가」를 재는 자다(제외 판정에 쓴다).
 * 🔵 위와 **같은 파서**로 센다 — 묶음을 푸는 쪽과 세는 쪽이 다르면 「도형 0」 판정이
 * 어긋난다.
 */
export function drawingCountsOf(
  zip: ZipArchive,
  sheet: LoadedSheet
): { shapeCount: number; connectorCount: number } {
  const drawing = readSheetDrawing(zip, sheet);
  return { shapeCount: drawing.shapes.length, connectorCount: drawing.connectors.length };
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
    const sheetPlans = planProceduresForSheet(sheet.name, titleTextOf(sheet), drawingCountsOf(zip, sheet));
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
