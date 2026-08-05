import "./load-env";

import { and, eq } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { users } from "../src/lib/db/schema";
import { createDraftProcedureTemplateFromImport } from "../src/lib/db/mutations/procedure-templates";
import { loadWorkbook, type LoadedSheet, type LoadedWorkbook } from "./lib/xlsx/workbook-loader";
import { extractSheetGraph } from "./lib/xlsx/extract-shape-graph";
import { combineShapeGraphSheets } from "./lib/xlsx/combine-shape-graph-sheets";
import { extractChecklistForm } from "./lib/xlsx/extract-checklist-form";
import { extractTroubleshootingMatrix } from "./lib/xlsx/extract-troubleshooting-matrix";
import type { ExtractedTemplate } from "./lib/xlsx/types";

/**
 * Deterministic workbook → DRAFT procedure_templates importer (Phase 2).
 * No AI interpretation or translation anywhere in this file or the
 * scripts/lib/xlsx/* modules it calls — every node/edge/section/item is
 * either copied verbatim from a cell/shape or mechanically derived from a
 * fixed, documented rule (branch-classification.ts, node-classification.ts).
 *
 * Always produces DRAFT templates; never publishes (that is a separate,
 * later, human-triggered action — see publishProcedureTemplate). Never
 * imports an edge whose endpoint can't be resolved — those are recorded as
 * validation issues instead (see extract-shape-graph.ts).
 *
 * Scope (Phase 2 report "Templates imported" / "Content deferred"): this
 * run imports the recommended representative sequence from the task
 * brief — one RFG shape-graph workflow (combined across the 3 sheets
 * needed to demonstrate a real cross-stage LOOP_BACK edge), one MB
 * shape-graph workflow, the MB cell-anchored checklist form, and the MB
 * symptom-troubleshooting matrix — not all 18 worksheets. See the Phase 2
 * report for exactly what was deferred and why.
 */

function findSheet(wb: LoadedWorkbook, name: string): LoadedSheet {
  const sheet = wb.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`Sheet not found in workbook: "${name}"`);
  return sheet;
}

async function resolveSuperAdminActorId(): Promise<string> {
  const [row] = await db
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
  if (!row) {
    throw new Error(
      "No approved, active SUPER_ADMIN account found in the dev DB — the importer requires one to act as."
    );
  }
  return row.id;
}

function parseArgs(): { file: string } {
  const args = process.argv.slice(2);
  const fileFlagIndex = args.indexOf("--file");
  const file = fileFlagIndex >= 0 ? args[fileFlagIndex + 1] : undefined;
  if (!file) {
    console.error("Usage: tsx scripts/import-procedure-templates.ts --file <path-to-xlsx>");
    process.exit(1);
  }
  return { file };
}

async function main() {
  const { file } = parseArgs();
  console.log(`Loading workbook: ${file}`);
  const wb = loadWorkbook(file);
  console.log(`  source_file_hash: ${wb.sourceFileHash}`);
  console.log(`  sheets found: ${wb.sheets.length}`);

  const actorId = await resolveSuperAdminActorId();
  console.log(`Acting as SUPER_ADMIN user: ${actorId}\n`);

  const templates: ExtractedTemplate[] = [];

  // ---- 1. RFG shape-graph workflow (combined, demonstrates a real cross-stage LOOP_BACK) ----
  const rfgSheetNames = ["(RFG) (3)안전검사", "(RFG) (4)기본 정전 검사", "(RFG) (11)출하 준비"];
  const rfgSheets = rfgSheetNames.map((n) => findSheet(wb, n));
  templates.push(
    combineShapeGraphSheets(rfgSheets, {
      code: "rfg-safety-deenergized-shipprep",
      name: "RF Generator 표준 절차 (안전검사 · 기본 정전 검사 · 출하 준비)",
      equipmentType: "RFG",
      description:
        "RFG 안전검사, 기본 정전 검사, 출하 준비 3개 시트를 결합한 대표 절차 — 출하 준비 단계의 노후화 점검 실패 시 " +
        "기본 정전 검사(4단계)로 되돌아가는 실제 검증된 재진행(LOOP_BACK) 분기를 포함한다 (Phase 1 보고서 §2).",
    })
  );

  // ---- 2. MB shape-graph workflow ----
  const mbGraphSheet = findSheet(wb, "(MB) 통전검사");
  const mbGraphResult = extractSheetGraph(mbGraphSheet);
  templates.push({
    code: "mb-power-on-test",
    name: "Matching Box 통전검사",
    equipmentType: "MB",
    description: "MB 통전검사 절차 — 댕글링 커넥터 및 텍스트 포함 화살표 도형 등 실제 원본의 모호한 참조 사례를 포함한다.",
    sourceWorksheets: [mbGraphSheet.name],
    nodes: mbGraphResult.nodes,
    edges: mbGraphResult.edges,
    checklistSections: [],
    troubleshootingEntries: [],
    issues: mbGraphResult.issues,
  });

  // ---- 3. MB cell-anchored checklist form ----
  const mbChecklistSheet = findSheet(wb, "(MB) 외관 및 내부 검사");
  const checklist = extractChecklistForm(mbChecklistSheet);
  templates.push({
    code: "mb-visual-internal-inspection",
    name: "Matching Box 외관 및 내부 검사",
    equipmentType: "MB",
    description: "16개 섹션으로 구성된 대형 인수 검사 체크리스트 (Phase 1 보고서 §3) — 측정 기준값과 #VALUE! 수식 오류를 포함한다.",
    sourceWorksheets: [mbChecklistSheet.name],
    nodes: [checklist.node],
    edges: [],
    checklistSections: checklist.sections,
    troubleshootingEntries: [],
    issues: checklist.issues,
  });

  // ---- 4. MB symptom-troubleshooting matrix ----
  const mbTroubleshootingSheet = findSheet(wb, "(MB) 수리");
  const troubleshooting = extractTroubleshootingMatrix(mbTroubleshootingSheet);
  templates.push({
    code: "mb-symptom-troubleshooting",
    name: "Matching Box 고장 증상별 수리",
    equipmentType: "MB",
    description: "11개 고장 증상별 점검·조치 표 — 도형이 아닌 셀 텍스트(↓, N.G.)로 표현된 분기를 포함한다 (Phase 1 보고서 §3).",
    sourceWorksheets: [mbTroubleshootingSheet.name],
    nodes: [troubleshooting.node],
    edges: [],
    checklistSections: [],
    troubleshootingEntries: troubleshooting.entries,
    issues: troubleshooting.issues,
  });

  console.log("=".repeat(72));
  console.log("IMPORT SUMMARY");
  console.log("=".repeat(72));

  for (const template of templates) {
    const errorCount = template.issues.filter((i) => i.severity === "ERROR").length;
    const warningCount = template.issues.filter((i) => i.severity === "WARNING").length;
    const infoCount = template.issues.filter((i) => i.severity === "INFO").length;

    console.log(`\n[${template.code}] ${template.name}`);
    console.log(
      `  sheets=${template.sourceWorksheets.length} nodes=${template.nodes.length} edges=${template.edges.length} ` +
        `checklistSections=${template.checklistSections.length} troubleshootingEntries=${template.troubleshootingEntries.length}`
    );
    console.log(`  validation issues: ERROR=${errorCount} WARNING=${warningCount} INFO=${infoCount}`);

    const result = await createDraftProcedureTemplateFromImport(template, actorId, {
      sourceFileName: wb.sourceFileName,
      sourceFileHash: wb.sourceFileHash,
    });

    if (result.ok) {
      console.log(
        result.alreadyImported
          ? `  -> already imported previously (same source file hash) — id=${result.id}`
          : `  -> imported as DRAFT — id=${result.id}`
      );
    } else {
      console.log(`  -> FAILED: [${result.code}] ${result.message}`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("Every template above is DRAFT — nothing was published by this script.");
  console.log("=".repeat(72));
}

main()
  .then(async () => {
    await pgClient.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Import failed:", err instanceof Error ? err.stack ?? err.message : String(err));
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
