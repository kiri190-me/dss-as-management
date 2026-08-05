import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureChecklistItems,
  procedureTroubleshootingEntries,
  procedureTemplateValidationIssues,
  users,
} from "../schema";
import { canImportProcedureTemplates, canPublishProcedureTemplates, canArchiveProcedureTemplates, canCreateProcedureTemplateDraft } from "@/lib/auth/procedure-template-authorization";
import type { Role } from "@/lib/domain/types";
import type { ExtractedTemplate } from "../../../../scripts/lib/xlsx/types";

/**
 * procedure_templates create/publish/archive/new-version — versioning
 * rules per the Phase 2 task brief (§ Versioning Rules), enforced here,
 * not just documented: a PUBLISHED or ARCHIVED template's nodes/edges are
 * never written to by any function in this file; publishing is blocked
 * while any unresolved ERROR-severity validation issue exists; every
 * write re-verifies the actor's role and account state against the live
 * DB, exactly like every other server-re-checks-what-the-UI-hid mutation
 * in this codebase.
 */

export type ProcedureTemplateResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "HAS_UNRESOLVED_ERRORS";

export type ProcedureTemplateResult =
  | { ok: true; id: string; alreadyImported?: boolean }
  | { ok: false; code: ProcedureTemplateResultCode; message: string };

class ProcedureTemplateMutationError extends Error {
  result: ProcedureTemplateResult & { ok: false };
  constructor(result: ProcedureTemplateResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(code: ProcedureTemplateResultCode, message: string): never {
  throw new ProcedureTemplateMutationError({ ok: false, code, message });
}

type EligibleActor = { id: string; role: Role };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function resolveEligibleActor(
  tx: Tx,
  actorUserId: string
): Promise<EligibleActor> {
  const [actor] = await tx
    .select({
      id: users.id,
      role: users.role,
      approvalStatus: users.approvalStatus,
      isActive: users.isActive,
      lockedAt: users.lockedAt,
      isDeleted: users.isDeleted,
    })
    .from(users)
    .where(eq(users.id, actorUserId));
  if (
    !actor ||
    actor.isDeleted ||
    actor.approvalStatus !== "APPROVED" ||
    !actor.isActive ||
    actor.lockedAt !== null
  ) {
    fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
  }
  return actor;
}

function isPgUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

/**
 * Idempotent for the same (code, source_file_hash) pair — re-running the
 * importer against the same workbook file for a template code that was
 * already imported returns the existing row instead of creating a
 * duplicate DRAFT (this task's explicit importer requirement).
 */
export async function createDraftProcedureTemplateFromImport(
  extracted: ExtractedTemplate,
  actorUserId: string,
  source: { sourceFileName: string; sourceFileHash: string }
): Promise<ProcedureTemplateResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!canImportProcedureTemplates(actor.role)) {
        fail("FORBIDDEN", "가져오기 권한이 없습니다 (SUPER_ADMIN 전용).");
      }

      const [existing] = await tx
        .select({ id: procedureTemplates.id })
        .from(procedureTemplates)
        .where(
          and(
            eq(procedureTemplates.code, extracted.code),
            eq(procedureTemplates.sourceFileHash, source.sourceFileHash)
          )
        )
        .limit(1);
      if (existing) {
        return { ok: true, id: existing.id, alreadyImported: true };
      }

      const [template] = await tx
        .insert(procedureTemplates)
        .values({
          code: extracted.code,
          name: extracted.name,
          equipmentType: extracted.equipmentType,
          description: extracted.description,
          status: "DRAFT",
          version: 1,
          sourceType: "EXCEL_IMPORT",
          sourceFileName: source.sourceFileName,
          sourceFileHash: source.sourceFileHash,
          createdByUserId: actor.id,
        })
        .returning({ id: procedureTemplates.id });

      await insertTemplateContent(tx, template.id, extracted);

      return { ok: true, id: template.id };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    if (isPgUniqueViolation(err)) {
      return { ok: false, code: "CONFLICT", message: "동일한 코드의 템플릿이 이미 존재합니다 (다른 원본 파일 기준)." };
    }
    throw err;
  }
}

/** Shared by createDraftProcedureTemplateFromImport and createNewDraftVersion. */
async function insertTemplateContent(
  tx: Tx,
  templateId: string,
  extracted: Pick<ExtractedTemplate, "nodes" | "edges" | "checklistSections" | "troubleshootingEntries" | "issues">
): Promise<void> {
  const nodeIdByCode = new Map<string, string>();
  if (extracted.nodes.length > 0) {
    const insertedNodes = await tx
      .insert(procedureTemplateNodes)
      .values(
        extracted.nodes.map((n) => ({
          procedureTemplateId: templateId,
          nodeCode: n.nodeCode,
          nodeType: n.nodeType,
          title: n.title,
          description: n.description ?? null,
          objective: n.objective ?? null,
          preparation: n.preparation ?? null,
          toolsAndEquipment: n.toolsAndEquipment ?? null,
          safetyCaution: n.safetyCaution ?? null,
          instructions: n.instructions ?? null,
          expectedNormalResult: n.expectedNormalResult ?? null,
          ngSymptoms: n.ngSymptoms ?? null,
          recommendedCorrectiveAction: n.recommendedCorrectiveAction ?? null,
          acceptanceCriteria: n.acceptanceCriteria ?? null,
          positionX: n.positionX,
          positionY: n.positionY,
          sortOrder: n.sortOrder,
          sourceWorksheet: n.sourceWorksheet,
          sourceShapeId: n.sourceShapeId ?? null,
          sourceCellRange: n.sourceCellRange ?? null,
        }))
      )
      .returning({ id: procedureTemplateNodes.id, nodeCode: procedureTemplateNodes.nodeCode });
    for (const row of insertedNodes) nodeIdByCode.set(row.nodeCode, row.id);
  }

  if (extracted.edges.length > 0) {
    const edgeRows = extracted.edges
      .map((e) => {
        const fromNodeId = nodeIdByCode.get(e.fromNodeCode);
        const toNodeId = nodeIdByCode.get(e.toNodeCode);
        if (!fromNodeId || !toNodeId) return null;
        return {
          procedureTemplateId: templateId,
          fromNodeId,
          toNodeId,
          branchType: e.branchType,
          branchLabel: e.branchLabel ?? null,
          sortOrder: e.sortOrder,
          sourceConnectorId: e.sourceConnectorId ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (edgeRows.length > 0) await tx.insert(procedureTemplateEdges).values(edgeRows);
  }

  const sectionIdByCode = new Map<string, string>();
  for (const section of extracted.checklistSections) {
    const nodeId = nodeIdByCode.get(section.nodeCode);
    if (!nodeId) continue;
    const [inserted] = await tx
      .insert(procedureChecklistSections)
      .values({
        nodeId,
        title: section.title,
        sortOrder: section.sortOrder,
        sourceWorksheet: section.sourceWorksheet,
        sourceCellRange: section.sourceCellRange ?? null,
      })
      .returning({ id: procedureChecklistSections.id });
    sectionIdByCode.set(section.sectionCode, inserted.id);

    if (section.items.length > 0) {
      await tx.insert(procedureChecklistItems).values(
        section.items.map((item) => ({
          sectionId: inserted.id,
          itemCode: item.itemCode,
          title: item.title,
          instructions: item.instructions ?? null,
          measurementType: item.measurementType ?? null,
          measurementUnit: item.measurementUnit ?? null,
          minValue: item.minValue ?? null,
          maxValue: item.maxValue ?? null,
          expectedText: item.expectedText ?? null,
          acceptanceRule: item.acceptanceRule ?? null,
          required: item.required,
          sortOrder: item.sortOrder,
          sourceCellRange: item.sourceCellRange ?? null,
        }))
      );
    }
  }

  for (const entry of extracted.troubleshootingEntries) {
    const nodeId = nodeIdByCode.get(entry.nodeCode);
    if (!nodeId) continue;
    await tx.insert(procedureTroubleshootingEntries).values({
      nodeId,
      symptom: entry.symptom,
      inspectionAction: entry.inspectionAction ?? null,
      normalNextAction: entry.normalNextAction ?? null,
      ngAction: entry.ngAction ?? null,
      retryInstruction: entry.retryInstruction ?? null,
      sortOrder: entry.sortOrder,
      sourceCellRange: entry.sourceCellRange ?? null,
    });
  }

  if (extracted.issues.length > 0) {
    await tx.insert(procedureTemplateValidationIssues).values(
      extracted.issues.map((issue) => ({
        procedureTemplateId: templateId,
        severity: issue.severity,
        issueType: issue.issueType,
        message: issue.message,
        sourceWorksheet: issue.sourceWorksheet ?? null,
        sourceReference: issue.sourceReference ?? null,
      }))
    );
  }
}

export async function publishProcedureTemplate(
  templateId: string,
  actorUserId: string
): Promise<ProcedureTemplateResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!canPublishProcedureTemplates(actor.role)) {
        fail("FORBIDDEN", "게시 권한이 없습니다 (SUPER_ADMIN 전용).");
      }

      const [template] = await tx
        .select({ id: procedureTemplates.id, status: procedureTemplates.status })
        .from(procedureTemplates)
        .where(eq(procedureTemplates.id, templateId))
        .for("update");
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      if (template.status !== "DRAFT") {
        fail("CONFLICT", "초안(DRAFT) 상태의 템플릿만 게시할 수 있습니다.");
      }

      const [unresolvedError] = await tx
        .select({ id: procedureTemplateValidationIssues.id })
        .from(procedureTemplateValidationIssues)
        .where(
          and(
            eq(procedureTemplateValidationIssues.procedureTemplateId, templateId),
            eq(procedureTemplateValidationIssues.severity, "ERROR"),
            isNull(procedureTemplateValidationIssues.resolvedAt)
          )
        )
        .limit(1);
      if (unresolvedError) {
        fail("HAS_UNRESOLVED_ERRORS", "해결되지 않은 오류(ERROR)가 있어 게시할 수 없습니다.");
      }

      await tx
        .update(procedureTemplates)
        .set({ status: "PUBLISHED", publishedByUserId: actor.id, publishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.status, "DRAFT")));

      return { ok: true, id: templateId };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}

export async function archiveProcedureTemplate(
  templateId: string,
  actorUserId: string
): Promise<ProcedureTemplateResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!canArchiveProcedureTemplates(actor.role)) {
        fail("FORBIDDEN", "보관 권한이 없습니다 (SUPER_ADMIN 전용).");
      }

      const [template] = await tx
        .select({ id: procedureTemplates.id, status: procedureTemplates.status })
        .from(procedureTemplates)
        .where(eq(procedureTemplates.id, templateId))
        .for("update");
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      if (template.status !== "PUBLISHED") {
        fail("CONFLICT", "게시(PUBLISHED) 상태의 템플릿만 보관할 수 있습니다.");
      }

      await tx
        .update(procedureTemplates)
        .set({ status: "ARCHIVED", archivedByUserId: actor.id, archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.status, "PUBLISHED")));

      return { ok: true, id: templateId };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}

/**
 * Editing a PUBLISHED template creates a new DRAFT version — a full copy
 * of the published row's nodes/edges/checklist/troubleshooting content
 * under a brand-new template row (never an in-place edit of the published
 * row, which stays exactly as it was). Validation issues are
 * deliberately not copied — a new draft starts with a clean validation
 * slate, matching the (out-of-Phase-2-scope) editor's expectation that a
 * draft gets re-validated as it's edited, not pre-seeded with its
 * predecessor's already-resolved findings.
 */
export async function createNewDraftVersion(
  publishedTemplateId: string,
  actorUserId: string
): Promise<ProcedureTemplateResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!canCreateProcedureTemplateDraft(actor.role)) {
        fail("FORBIDDEN", "새 버전 작성 권한이 없습니다 (SUPER_ADMIN 전용).");
      }

      const [published] = await tx
        .select()
        .from(procedureTemplates)
        .where(eq(procedureTemplates.id, publishedTemplateId))
        .for("update");
      if (!published) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      if (published.status !== "PUBLISHED") {
        fail("CONFLICT", "게시(PUBLISHED) 상태의 템플릿만 새 버전을 만들 수 있습니다.");
      }

      const [existingDraft] = await tx
        .select({ id: procedureTemplates.id })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.code, published.code), eq(procedureTemplates.status, "DRAFT")))
        .limit(1);
      if (existingDraft) {
        fail("CONFLICT", "이미 진행 중인 초안 버전이 있습니다.");
      }

      const [newDraft] = await tx
        .insert(procedureTemplates)
        .values({
          code: published.code,
          name: published.name,
          equipmentType: published.equipmentType,
          description: published.description,
          status: "DRAFT",
          version: published.version + 1,
          sourceType: published.sourceType,
          sourceFileName: published.sourceFileName,
          sourceFileHash: published.sourceFileHash,
          supersedesTemplateId: published.id,
          createdByUserId: actor.id,
        })
        .returning({ id: procedureTemplates.id });

      const oldNodes = await tx
        .select()
        .from(procedureTemplateNodes)
        .where(eq(procedureTemplateNodes.procedureTemplateId, published.id));
      const oldEdges = await tx
        .select()
        .from(procedureTemplateEdges)
        .where(eq(procedureTemplateEdges.procedureTemplateId, published.id));
      const oldNodeIds = oldNodes.map((n) => n.id);
      const allOldSections =
        oldNodeIds.length > 0
          ? await tx.select().from(procedureChecklistSections).where(inArray(procedureChecklistSections.nodeId, oldNodeIds))
          : [];
      const oldSectionIds = allOldSections.map((s) => s.id);
      const oldItems =
        oldSectionIds.length > 0
          ? await tx.select().from(procedureChecklistItems).where(inArray(procedureChecklistItems.sectionId, oldSectionIds))
          : [];
      const oldTroubleshooting =
        oldNodeIds.length > 0
          ? await tx.select().from(procedureTroubleshootingEntries).where(inArray(procedureTroubleshootingEntries.nodeId, oldNodeIds))
          : [];

      const newNodeIdByOldId = new Map<string, string>();
      if (oldNodes.length > 0) {
        const inserted = await tx
          .insert(procedureTemplateNodes)
          .values(
            oldNodes.map((n) => ({
              procedureTemplateId: newDraft.id,
              nodeCode: n.nodeCode,
              nodeType: n.nodeType,
              title: n.title,
              description: n.description,
              objective: n.objective,
              preparation: n.preparation,
              toolsAndEquipment: n.toolsAndEquipment,
              safetyCaution: n.safetyCaution,
              instructions: n.instructions,
              expectedNormalResult: n.expectedNormalResult,
              ngSymptoms: n.ngSymptoms,
              recommendedCorrectiveAction: n.recommendedCorrectiveAction,
              acceptanceCriteria: n.acceptanceCriteria,
              workerMayAddNextTask: n.workerMayAddNextTask,
              positionX: n.positionX,
              positionY: n.positionY,
              sortOrder: n.sortOrder,
              sourceWorksheet: n.sourceWorksheet,
              sourceShapeId: n.sourceShapeId,
              sourceCellRange: n.sourceCellRange,
              isActive: n.isActive,
            }))
          )
          .returning({ id: procedureTemplateNodes.id, nodeCode: procedureTemplateNodes.nodeCode });
        // nodeCode is unique per template, so old.id -> new.id via nodeCode
        const newIdByCode = new Map(inserted.map((r) => [r.nodeCode, r.id]));
        for (const old of oldNodes) {
          const newId = newIdByCode.get(old.nodeCode);
          if (newId) newNodeIdByOldId.set(old.id, newId);
        }
      }

      if (oldEdges.length > 0) {
        await tx.insert(procedureTemplateEdges).values(
          oldEdges.map((e) => ({
            procedureTemplateId: newDraft.id,
            fromNodeId: newNodeIdByOldId.get(e.fromNodeId)!,
            toNodeId: newNodeIdByOldId.get(e.toNodeId)!,
            branchType: e.branchType,
            branchLabel: e.branchLabel,
            conditionDefinition: e.conditionDefinition,
            sortOrder: e.sortOrder,
            sourceConnectorId: e.sourceConnectorId,
          }))
        );
      }

      const newSectionIdByOldId = new Map<string, string>();
      for (const s of allOldSections) {
        const newNodeId = newNodeIdByOldId.get(s.nodeId);
        if (!newNodeId) continue;
        const [inserted] = await tx
          .insert(procedureChecklistSections)
          .values({
            nodeId: newNodeId,
            title: s.title,
            sortOrder: s.sortOrder,
            sourceWorksheet: s.sourceWorksheet,
            sourceCellRange: s.sourceCellRange,
          })
          .returning({ id: procedureChecklistSections.id });
        newSectionIdByOldId.set(s.id, inserted.id);
      }

      if (oldItems.length > 0) {
        const rows = oldItems
          .map((it) => {
            const newSectionId = newSectionIdByOldId.get(it.sectionId);
            if (!newSectionId) return null;
            return {
              sectionId: newSectionId,
              itemCode: it.itemCode,
              title: it.title,
              instructions: it.instructions,
              measurementType: it.measurementType,
              measurementUnit: it.measurementUnit,
              minValue: it.minValue,
              maxValue: it.maxValue,
              expectedText: it.expectedText,
              acceptanceRule: it.acceptanceRule,
              required: it.required,
              sortOrder: it.sortOrder,
              sourceCellRange: it.sourceCellRange,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        if (rows.length > 0) await tx.insert(procedureChecklistItems).values(rows);
      }

      if (oldTroubleshooting.length > 0) {
        const rows = oldTroubleshooting
          .map((t) => {
            const newNodeId = newNodeIdByOldId.get(t.nodeId);
            if (!newNodeId) return null;
            return {
              nodeId: newNodeId,
              symptom: t.symptom,
              inspectionAction: t.inspectionAction,
              normalNextAction: t.normalNextAction,
              ngAction: t.ngAction,
              retryInstruction: t.retryInstruction,
              sortOrder: t.sortOrder,
              sourceCellRange: t.sourceCellRange,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        if (rows.length > 0) await tx.insert(procedureTroubleshootingEntries).values(rows);
      }

      return { ok: true, id: newDraft.id };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}
