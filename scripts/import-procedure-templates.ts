import "./load-env";

import { and, eq } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { users } from "../src/lib/db/schema";
import {
  createDraftProcedureTemplateFromImport,
  replaceDraftProcedureTemplates,
} from "../src/lib/db/mutations/procedure-templates";
import { loadWorkbook, type LoadedSheet, type LoadedWorkbook } from "./lib/xlsx/workbook-loader";
import { combineShapeGraphSheets } from "./lib/xlsx/combine-shape-graph-sheets";
import { extractChecklistForm } from "./lib/xlsx/extract-checklist-form";
import { extractTroubleshootingMatrix } from "./lib/xlsx/extract-troubleshooting-matrix";
import { extractPlainInstruction } from "./lib/xlsx/extract-plain-instruction";
import { extractReferenceIndex } from "./lib/xlsx/extract-reference-index";
import type { ExtractedTemplate } from "./lib/xlsx/types";

/**
 * Deterministic workbook → DRAFT procedure_templates importer (Phase 2.5).
 * No AI interpretation or translation anywhere in this file or the
 * scripts/lib/xlsx/* modules it calls — every node/edge/section/item/
 * reference-item is either copied verbatim from a cell/shape or
 * mechanically derived from a fixed, documented rule.
 *
 * Always produces DRAFT templates; never publishes.
 *
 * All 18 worksheets in the real workbook are accounted for by exactly one
 * of the four templates built below — see the Phase 2.5 report for the
 * full sheet inventory and the reasoning behind this specific grouping
 * (in short: a real cross-sheet LOOP_BACK edge only exists when both ends
 * are nodes of the *same* template — see procedure_template_edges' schema
 * comment — so every RFG shape-graph sheet is combined into one lifecycle
 * template, and likewise for MB).
 */

const RFG_LIFECYCLE_SHEET_NAMES = [
  "(RFG) (1)고장 접수 확인",
  "(RFG) (2)외관 검사",
  "(RFG) (3)안전검사",
  "(RFG) (4)기본 정전 검사",
  "(RFG) (5)통전검사(3상입력)",
  "(RFG) (6)개선 사항 확인",
  "(RFG) (7)원복 검사 및 개선 작업",
  "(RFG) (8)고객 연락",
  "(RFG) (11)출하 준비",
  "(RFG) (12)출하 완료",
];

const MB_SHAPE_GRAPH_SHEET_NAMES = ["(MB) 고장 접수 확인", "(MB) 통전검사", "(MB) 출하완료"];
const MB_CHECKLIST_SHEET_NAME = "(MB) 외관 및 내부 검사";
const MB_TROUBLESHOOTING_SHEET_NAME = "(MB) 수리";
const MB_PLAIN_INSTRUCTION_SHEET_NAME = "(MB) 고객 연락";

/** The 4 narrow Phase 2 sample templates this phase's reorganization supersedes. */
const OLD_SAMPLE_TEMPLATE_CODES = [
  "rfg-safety-deenergized-shipprep",
  "mb-power-on-test",
  "mb-visual-internal-inspection",
  "mb-symptom-troubleshooting",
];

/**
 * The 4 templates this importer currently produces. Phase 3A's
 * --replace-current flag targets exactly these — used once, deliberately,
 * to backfill the new raw_evidence validation-issue column onto templates
 * imported before that column existed (the plain idempotent path is a
 * no-op for an unchanged source_file_hash, so backfilling requires an
 * explicit, disclosed delete+reimport, same guarded pattern as
 * --replace-old-samples: only DRAFT rows matching these exact codes are
 * ever touched, and every deleted row's contents are printed before
 * commit).
 */
const CURRENT_TEMPLATE_CODES = ["rfg-full-lifecycle", "mb-full-lifecycle", "main-page-index", "qc-common-operations"];

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

function parseArgs(): { file: string; replaceOldSamples: boolean; replaceCurrent: boolean } {
  const args = process.argv.slice(2);
  const fileFlagIndex = args.indexOf("--file");
  const file = fileFlagIndex >= 0 ? args[fileFlagIndex + 1] : undefined;
  if (!file) {
    console.error(
      "Usage: tsx scripts/import-procedure-templates.ts --file <path-to-xlsx> [--replace-old-samples] [--replace-current]"
    );
    process.exit(1);
  }
  return {
    file,
    replaceOldSamples: args.includes("--replace-old-samples"),
    replaceCurrent: args.includes("--replace-current"),
  };
}

function buildRfgLifecycleTemplate(wb: LoadedWorkbook): ExtractedTemplate {
  const sheets = RFG_LIFECYCLE_SHEET_NAMES.map((n) => findSheet(wb, n));
  return combineShapeGraphSheets(sheets, {
    code: "rfg-full-lifecycle",
    name: "RF Generator 전체 표준 절차 (1~12단계)",
    equipmentType: "RFG",
    description:
      "RFG 전체 10개 시트(고장 접수 확인 ~ 출하 완료)를 결합한 전체 수명주기 절차 — (7)원복 검사 및 개선 작업 시트가 " +
      "9단계(수리 작업)·10단계(출하 검사)를 구조적으로 포함한다(별도 시트 없음, Main page 하이퍼링크로 확인). " +
      "검증된 재진행(LOOP_BACK) 분기 2건을 모두 포함한다: (11)출하 준비 → (4)기본 정전 검사, (7)원복 검사 및 개선 작업 → " +
      "(4)기본 정전 검사(에이징 테스트 실패 시).",
  });
}

function buildMbLifecycleTemplate(wb: LoadedWorkbook): ExtractedTemplate {
  const graphSheets = MB_SHAPE_GRAPH_SHEET_NAMES.map((n) => findSheet(wb, n));
  const template = combineShapeGraphSheets(graphSheets, {
    code: "mb-full-lifecycle",
    name: "Matching Box 전체 표준 절차",
    equipmentType: "MB",
    description:
      "MB 도형 기반 흐름도 3개 시트(고장 접수 확인, 통전검사, 출하완료) + 외관 및 내부 검사 체크리스트 + 고장 증상별 " +
      "진단표 + 고객 연락 지침을 하나의 절차로 결합했다. 출하 준비(MB)는 별도 시트가 아니라 외관 및 내부 검사 시트의 " +
      "마지막 섹션(C1396 행, Main page의 '7. 출하 준비' 링크가 가리키는 위치)으로 이미 포함되어 있다.",
  });

  const checklistSheet = findSheet(wb, MB_CHECKLIST_SHEET_NAME);
  const checklist = extractChecklistForm(checklistSheet);
  const troubleshootingSheet = findSheet(wb, MB_TROUBLESHOOTING_SHEET_NAME);
  const troubleshooting = extractTroubleshootingMatrix(troubleshootingSheet);
  const plainInstructionSheet = findSheet(wb, MB_PLAIN_INSTRUCTION_SHEET_NAME);
  const plainInstruction = extractPlainInstruction(plainInstructionSheet);

  template.sourceWorksheets.push(
    checklistSheet.name,
    troubleshootingSheet.name,
    plainInstructionSheet.name
  );
  template.nodes.push(checklist.node, troubleshooting.node, plainInstruction.node);
  template.checklistSections.push(...checklist.sections);
  template.troubleshootingEntries.push(...troubleshooting.entries);
  template.issues.push(...checklist.issues, ...troubleshooting.issues, ...plainInstruction.issues);

  return template;
}

function buildReferenceOnlyTemplate(
  wb: LoadedWorkbook,
  sheetName: string,
  opts: { code: string; name: string; description: string }
): ExtractedTemplate {
  const sheet = findSheet(wb, sheetName);
  const { referenceItems, issues } = extractReferenceIndex(sheet);
  return {
    code: opts.code,
    name: opts.name,
    equipmentType: "COMMON",
    description: opts.description,
    sourceWorksheets: [sheet.name],
    isReferenceOnly: true,
    nodes: [],
    edges: [],
    checklistSections: [],
    troubleshootingEntries: [],
    referenceItems,
    issues,
  };
}

async function main() {
  const { file, replaceOldSamples, replaceCurrent } = parseArgs();
  console.log(`Loading workbook: ${file}`);
  const wb = loadWorkbook(file);
  console.log(`  source_file_hash: ${wb.sourceFileHash}`);
  console.log(`  sheets found: ${wb.sheets.length}`);

  const actorId = await resolveSuperAdminActorId();
  console.log(`Acting as SUPER_ADMIN user: ${actorId}\n`);

  if (replaceOldSamples) {
    console.log("=".repeat(72));
    console.log("REPLACE MODE — deleting the 4 Phase 2 sample templates (only if still DRAFT)");
    console.log("=".repeat(72));
    const result = await replaceDraftProcedureTemplates(OLD_SAMPLE_TEMPLATE_CODES, actorId);
    if (!result.ok) {
      console.error(`  -> FAILED: [${result.code}] ${result.message}`);
      process.exit(1);
    }
    if (result.deleted.length === 0) {
      console.log("  -> no matching DRAFT templates found (already replaced, or never imported).");
    }
    for (const d of result.deleted) {
      console.log(
        `  -> deleted "${d.code}" (id=${d.id}): nodes=${d.nodeCount} edges=${d.edgeCount} ` +
          `checklistSections=${d.checklistSectionCount} checklistItems=${d.checklistItemCount} ` +
          `troubleshootingEntries=${d.troubleshootingEntryCount} referenceItems=${d.referenceItemCount} ` +
          `issues=${d.issueCount}`
      );
    }
    console.log("");
  }

  if (replaceCurrent) {
    console.log("=".repeat(72));
    console.log("REPLACE-CURRENT MODE — deleting the 4 current templates (only if still DRAFT)");
    console.log("=".repeat(72));
    const result = await replaceDraftProcedureTemplates(CURRENT_TEMPLATE_CODES, actorId);
    if (!result.ok) {
      console.error(`  -> FAILED: [${result.code}] ${result.message}`);
      process.exit(1);
    }
    if (result.deleted.length === 0) {
      console.log("  -> no matching DRAFT templates found.");
    }
    for (const d of result.deleted) {
      console.log(
        `  -> deleted "${d.code}" (id=${d.id}): nodes=${d.nodeCount} edges=${d.edgeCount} ` +
          `checklistSections=${d.checklistSectionCount} checklistItems=${d.checklistItemCount} ` +
          `troubleshootingEntries=${d.troubleshootingEntryCount} referenceItems=${d.referenceItemCount} ` +
          `issues=${d.issueCount}`
      );
    }
    console.log("");
  }

  const templates: ExtractedTemplate[] = [
    buildRfgLifecycleTemplate(wb),
    buildMbLifecycleTemplate(wb),
    buildReferenceOnlyTemplate(wb, "Main page", {
      code: "main-page-index",
      name: "Main Page (탐색 인덱스)",
      description:
        "수리소 업무 정리 워크북의 메인 탐색 페이지 — RFG 1~12단계, MB 1~8단계 각 상세 시트로의 이동 링크와 " +
        "미해결 교차 참조 번호로 구성된 순수 참고용 인덱스. 실행 가능한 절차 노드를 포함하지 않는다.",
    }),
    buildReferenceOnlyTemplate(wb, "QC", {
      code: "qc-common-operations",
      name: "QC (수리소 운영 공통 사항)",
      description:
        "계측기/설비/지그 관리, 5M+1E, 수리품 리스트 관리 등 수리소 운영 공통 업무 인덱스 — 외부 네트워크 파일 " +
        "경로와 미해결 교차 참조 번호로 구성된 순수 참고용 인덱스. 실행 가능한 절차 노드를 포함하지 않는다.",
    }),
  ];

  console.log("=".repeat(72));
  console.log("IMPORT SUMMARY");
  console.log("=".repeat(72));

  for (const template of templates) {
    const errorCount = template.issues.filter((i) => i.severity === "ERROR").length;
    const warningCount = template.issues.filter((i) => i.severity === "WARNING").length;
    const infoCount = template.issues.filter((i) => i.severity === "INFO").length;

    console.log(`\n[${template.code}] ${template.name}${template.isReferenceOnly ? " (참고용 — 실행 불가)" : ""}`);
    console.log(
      `  sheets=${template.sourceWorksheets.length} nodes=${template.nodes.length} edges=${template.edges.length} ` +
        `checklistSections=${template.checklistSections.length} troubleshootingEntries=${template.troubleshootingEntries.length} ` +
        `referenceItems=${template.referenceItems.length}`
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
