import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../client";
import {
  procedureTemplates,
  procedureTemplateNodes,
  procedureTemplateEdges,
  procedureChecklistSections,
  procedureChecklistItems,
  procedureTroubleshootingEntries,
  procedureTemplateValidationIssues,
  procedureReferenceItems,
  procedureTemplateEditHistory,
  procedureValidationResolutionHistory,
  procedureCaseExecutions,
  users,
} from "../schema";
import { canImportProcedureTemplates, canArchiveProcedureTemplates } from "@/lib/auth/procedure-template-authorization";
import {
  canManageTechnicalTemplates,
  canActorPublishTemplateOfCategory,
  canActorCreateDraftVersionOfCategory,
  canActorManageTechnicalTemplateGraph,
  canDeleteTechnicalTemplates,
} from "@/lib/auth/technical-procedure-template-authorization";
import { actorMay } from "@/lib/auth/developer-promotion";
import { insertAuditLog } from "./audit-logs";
import { validateProcedureGraphStructure } from "@/lib/domain/procedure-graph-structural-validation";
import {
  PROCEDURE_EQUIPMENT_TYPE_CODES,
  procedureTemplateStatusLabels,
  type ProcedureEquipmentType,
  type ProcedureTemplateStatus,
} from "@/lib/domain/procedure-template-types";
import {
  canPublishFromProcedureStatus,
  pickPublishedSiblingsToExpire,
} from "@/lib/domain/procedure-template-publish-policy";
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
  | "HAS_UNRESOLVED_ERRORS"
  | "HAS_STRUCTURAL_ERRORS"
  // Phase 5C-5B-1 — createManualTechnicalProcedureTemplate's own input
  // validation (blank code/name, unsupported equipmentType). No existing
  // caller of this file's other functions returns this code.
  | "INVALID_INPUT";

export type ProcedureTemplateResult =
  | { ok: true; id: string; alreadyImported?: boolean }
  | {
      ok: false;
      code: ProcedureTemplateResultCode;
      message: string;
      /**
       * 2026-11-04(줄기 B-⑥) — createNewDraftVersion 이 "이미 진행 중인 초안
       * 버전이 있습니다"로 막을 때 **그 초안의 id**. 막는 자리에 까닭만 적고
       * 갈 곳을 안 주면, 사람은 그 초안이 어디 있는지 목록을 뒤져야 한다
       * (같은 code 의 다른 판이라 이름까지 같다). 이 저장소는 막을 때 늘 그
       * 자리에 갈 길을 함께 낸다 — 편집기의 [저장] 단추가 "저장할 변경 없음"
       * 으로 바뀌는 것과 같은 규약이다.
       *
       * 🔵 이 한 갈래에서만 찬다. 다른 실패(권한·상태·없음)에는 보낼 곳이
       * 없으므로 undefined 로 남고, 화면은 값이 있을 때만 링크를 그린다.
       */
      existingDraftId?: string;
    };

class ProcedureTemplateMutationError extends Error {
  result: ProcedureTemplateResult & { ok: false };
  constructor(result: ProcedureTemplateResult & { ok: false }) {
    super(result.message);
    this.result = result;
  }
}

function fail(
  code: ProcedureTemplateResultCode,
  message: string,
  extra?: { existingDraftId?: string }
): never {
  throw new ProcedureTemplateMutationError({ ok: false, code, message, ...extra });
}

type EligibleActor = { id: string; role: Role; isDeveloper: boolean };
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Exported for reuse by procedure-template-editor.ts — every Phase 4A editor mutation re-checks the same live actor eligibility this file's own mutations always have, never a second/looser copy of the check. */
export async function resolveEligibleActor(
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
      isDeveloper: users.isDeveloper,
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

function hasPgCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

// Phase 5C-5B-1 fix: drizzle-orm's postgres-js driver wraps the real
// PostgresError under `.cause` (the outer DrizzleQueryError's own `.code` is
// always undefined) — same convention as procedure-case-execution.ts's
// isUniqueViolation. The original single-line check here (err.code only)
// never actually matched a real driver error; checking both is what makes
// this catchable at all, for both this function's existing caller
// (createDraftProcedureTemplateFromImport) and createManualTechnicalProcedureTemplate below.
function isPgUniqueViolation(err: unknown): boolean {
  if (hasPgCode(err, "23505")) return true;
  const cause = err instanceof Error ? err.cause : undefined;
  return hasPgCode(cause, "23505");
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
      if (!actorMay(actor, canImportProcedureTemplates)) {
        fail("FORBIDDEN", "가져오기 권한이 없습니다 (SUPER_ADMIN 전용).");
      }

      const [existing] = await tx
        .select({ id: procedureTemplates.id })
        .from(procedureTemplates)
        .where(
          and(
            eq(procedureTemplates.code, extracted.code),
            eq(procedureTemplates.isDeleted, false),
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
          // Phase 5C-5A — explicit, hardcoded per builder function in
          // scripts/import-procedure-templates.ts (mirroring how
          // isReferenceOnly is already hardcoded there), never inferred
          // here from code/name/equipmentType.
          category: extracted.category,
          description: extracted.description,
          status: "DRAFT",
          version: 1,
          sourceType: "EXCEL_IMPORT",
          sourceFileName: source.sourceFileName,
          sourceFileHash: source.sourceFileHash,
          isReferenceOnly: extracted.isReferenceOnly,
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

export type CreateManualTechnicalTemplateInput = {
  code: string;
  name: string;
  equipmentType: ProcedureEquipmentType;
  description?: string | null;
};

/**
 * Phase 5C-5B-1 — the first template-creation path that does not go
 * through the Excel importer: an ADMIN/SUPER_ADMIN authoring a
 * TECHNICAL_TASK procedure entirely by hand, starting from an empty graph
 * (procedure-template-editor.ts's createProcedureTemplateNode fills it in
 * afterward, one node at a time). category/isReferenceOnly/status/version/
 * sourceType are all fixed here — there is no parameter through which a
 * caller could request anything other than a TECHNICAL_TASK DRAFT, so
 * category can never be spoofed by client input. Deliberately mirrors
 * createDraftProcedureTemplateFromImport's own coarse-actor-check +
 * unique-violation-translation shape rather than introducing a third
 * pattern.
 */
export async function createManualTechnicalProcedureTemplate(
  input: CreateManualTechnicalTemplateInput,
  actorUserId: string
): Promise<ProcedureTemplateResult> {
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : null;

  if (code.length === 0) return { ok: false, code: "INVALID_INPUT", message: "코드를 입력해야 합니다." };
  if (name.length === 0) return { ok: false, code: "INVALID_INPUT", message: "이름을 입력해야 합니다." };
  if (!(PROCEDURE_EQUIPMENT_TYPE_CODES as readonly string[]).includes(input.equipmentType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 장비 유형입니다." };
  }

  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!actorMay(actor, canManageTechnicalTemplates)) {
        fail("FORBIDDEN", "기술 절차 템플릿 생성 권한이 없습니다.");
      }

      const [template] = await tx
        .insert(procedureTemplates)
        .values({
          code,
          name,
          equipmentType: input.equipmentType,
          category: "TECHNICAL_TASK",
          description: description && description.length > 0 ? description : null,
          status: "DRAFT",
          version: 1,
          sourceType: "MANUAL",
          isReferenceOnly: false,
          createdByUserId: actor.id,
        })
        .returning({ id: procedureTemplates.id });

      return { ok: true, id: template.id };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    if (isPgUniqueViolation(err)) {
      // Deliberately generic — must never disclose the category (or any
      // other detail) of whichever existing template already holds this
      // (code, version=1) pair.
      return { ok: false, code: "CONFLICT", message: "이미 사용 중인 코드입니다." };
    }
    throw err;
  }
}

export type RenameTechnicalTemplateResult =
  | { ok: true; id: string; name: string; updatedAt: string }
  | { ok: false; code: ProcedureTemplateResultCode; message: string };

/**
 * Phase 5C-5B usability item 5 — rename a TECHNICAL_TASK DRAFT's name only
 * (code stays the stable identity and is never editable here). Uses
 * canActorManageTechnicalTemplateGraph, the same hard TECHNICAL_TASK-only
 * gate (no SUPER_ADMIN carve-out for FULL_SERVICE) already established for
 * the structural node/edge CRUD in procedure-template-editor.ts, since this
 * is the same kind of brand-new capability no category had before.
 *
 * Deliberately does not insert a procedure_template_edit_history row: every
 * existing action_type enum value is either node/edge-scoped or means
 * something else entirely (CREATE_DRAFT_VERSION, SAVE_LAYOUT,
 * VALIDATE_TEMPLATE, DISCARD_DRAFT_CHANGES) — none represent "template
 * metadata changed", and adding a new enum value requires an ALTER TYPE
 * migration this task explicitly does not authorize. updated_at is still
 * bumped (and returned) so optimistic concurrency and the editor's existing
 * refresh convention both keep working.
 */
export async function renameTechnicalProcedureTemplate(
  templateId: string,
  actorUserId: string,
  newName: string,
  expectedTemplateUpdatedAt: string
): Promise<RenameTechnicalTemplateResult> {
  const name = typeof newName === "string" ? newName.trim() : "";
  if (name.length === 0) return { ok: false, code: "INVALID_INPUT", message: "이름을 입력해야 합니다." };

  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      // Coarse pre-gate before any template row is looked up — same
      // non-disclosure rationale as every other mutation in this file.
      if (!actorMay(actor, canManageTechnicalTemplates)) {
        fail("FORBIDDEN", "이름 변경 권한이 없습니다.");
      }

      const [template] = await tx
        .select({
          id: procedureTemplates.id,
          category: procedureTemplates.category,
          status: procedureTemplates.status,
          updatedAt: procedureTemplates.updatedAt,
          name: procedureTemplates.name,
        })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.isDeleted, false)))
        .for("update");
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      if (!actorMay(actor, (role) => canActorManageTechnicalTemplateGraph(role, template.category))) {
        fail("FORBIDDEN", "이 템플릿의 이름을 변경할 권한이 없습니다.");
      }
      if (template.status !== "DRAFT") {
        fail("CONFLICT", "초안(DRAFT) 상태의 템플릿만 이름을 변경할 수 있습니다.");
      }
      if (template.updatedAt.toISOString() !== expectedTemplateUpdatedAt) {
        fail("CONFLICT", "다른 사용자가 이 초안을 수정했습니다. 새로고침 후 다시 시도하세요.");
      }

      const [updated] = await tx
        .update(procedureTemplates)
        .set({ name, updatedAt: new Date() })
        .where(eq(procedureTemplates.id, templateId))
        .returning({ updatedAt: procedureTemplates.updatedAt });

      // Phase 5C-5C — template-level (node_id/edge_id both null), same
      // convention as VALIDATE_TEMPLATE/CREATE_DRAFT_VERSION; before/after
      // carry only {name}, since code stays immutable and this action can
      // only ever change name.
      await tx.insert(procedureTemplateEditHistory).values({
        procedureTemplateId: templateId,
        actionType: "UPDATE_TEMPLATE_METADATA",
        beforeState: { name: template.name },
        afterState: { name },
        actorUserId: actor.id,
        changeGroupId: randomUUID(),
      });

      return { ok: true, id: templateId, name, updatedAt: updated.updatedAt.toISOString() };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}

/** Shared by createDraftProcedureTemplateFromImport and createNewDraftVersion. */
async function insertTemplateContent(
  tx: Tx,
  templateId: string,
  extracted: Pick<
    ExtractedTemplate,
    "nodes" | "edges" | "checklistSections" | "troubleshootingEntries" | "referenceItems" | "issues"
  >
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

  if (extracted.referenceItems.length > 0) {
    await tx.insert(procedureReferenceItems).values(
      extracted.referenceItems.map((item) => ({
        procedureTemplateId: templateId,
        itemType: item.itemType,
        label: item.label,
        sourceWorksheet: item.sourceWorksheet,
        sourceCellRange: item.sourceCellRange ?? null,
        hyperlinkTarget: item.hyperlinkTarget ?? null,
        crossReferenceNumber: item.crossReferenceNumber ?? null,
        sortOrder: item.sortOrder,
      }))
    );
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
        rawEvidence: issue.rawEvidence ?? null,
      }))
    );
  }
}

/**
 * 이력에 붙는 표시 — 🔴 이력을 읽는 쪽이 **사람이 누른 보관과 가르는 열쇠**다.
 *
 * action_type 은 **새 값을 만들지 않고** STATUS_CHANGE 를 쓴다. 그 칸은 enum 이라
 * 값을 늘리려면 마이그레이션이 필요하고, 뜻이 맞는 값이 이미 있다. 평범한 상태
 * 변경과 가르는 열쇠는 new_value 에 붙이는 이 표시이며, 이것은 출하 대기 자동
 * 전환이 쓰는 방식과 **같은 관례**다
 * (shipment-waiting-auto-advance.ts 의 SHIPMENT_WAITING_AUTO_ADVANCE_METADATA).
 *
 * 🔴 actor_user_id 에는 **게시를 누른 사람**이 들어간다. 그 사람이 이 판을 손으로
 * 내린 것처럼 읽히면 안 되므로 아래 사유 문장을 함께 남기고, 새로 게시된 판이
 * 무엇인지(publishedTemplateId · publishedVersion)도 같은 줄에 적는다 — "무엇에
 * 딸려 내려갔는가"가 없으면 표시만으로는 까닭을 복원할 수 없다.
 */
export const PROCEDURE_EXPIRED_BY_PUBLISH_MARKER = { expiredByPublish: true } as const;

/** 위 표시와 함께 이력에 남는 사유 문장. */
export const PROCEDURE_EXPIRED_BY_PUBLISH_REASON =
  "같은 절차의 다른 판이 게시되어 시스템이 [만료됨]으로 내렸습니다.";

/**
 * 초안을 게시한다. 🔴 2026-11-04 — **같은 계열(code)의 옛 게시본을 같은
 * 트랜잭션 안에서 [만료됨](ARCHIVED)으로 내린다.**
 *
 * ── 🔴 왜 계열 전체를 한 문장으로 잠그는가 ──────────────────────────────
 * 전에는 `WHERE id = ? FOR UPDATE` 로 **내 행 하나만** 잠갔다. 그 모양으로
 * 형제를 내리면 두 사람이 같은 순간에 서로 다른 판을 게시할 때 막히지 않는다:
 * 둘 다 "지금 게시본은 v2" 로 읽고, 한쪽이 v2 를 내리고 v3 를 올린 뒤에도 다른
 * 쪽은 **제 스냅샷에 보이던 v2** 만 내리고 v4 를 올린다 → 게시본이 둘이 된다.
 * READ COMMITTED 의 FOR UPDATE 재평가는 **잠근 행**에만 일어나므로, 상대가
 * 새로 올린 v3 는 끝내 보이지 않는다.
 *
 * 그래서 `WHERE code = ? AND is_deleted = false ORDER BY version FOR UPDATE` 로
 * **계열의 모든 판을 한 번에** 잠근다. 두 번째 트랜잭션은 첫째가 끝날 때까지
 * 여기서 멈추고, 풀린 뒤 같은 행들을 다시 읽어 상대가 올린 판을 본다. 차례를
 * version 으로 고정하는 것은 두 트랜잭션이 같은 차례로 잠가 교착(deadlock)을
 * 만들지 않기 위해서다.
 *
 * 🔵 code 는 **잠그기 전에** 따로 읽는다. 이 칸은 행이 만들어진 뒤 어떤
 * mutation 도 바꾸지 않으므로(이름 변경은 name 만 건드린다) 잠금 없이 읽어도
 * 낡을 수 없다.
 *
 * ── 🔴 검증은 만료본에서 다시 게시할 때도 똑같이 거친다 ────────────────
 * 미해결 ERROR 검사와 그래프 구조 검사는 **상태와 무관하게** 아래에서 한 번씩
 * 돈다. 재게시에만 통하는 샛길이 생기면, 한 번 게시됐던 판이라는 이유로 지금은
 * 깨진 그래프가 현장에 다시 나간다.
 */
export async function publishProcedureTemplate(
  templateId: string,
  actorUserId: string
): Promise<ProcedureTemplateResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      // Phase 5C-5B — coarse pre-gate (SUPER_ADMIN or ADMIN) before any
      // template row is looked up, same non-disclosure rationale as
      // procedure-template-editor.ts's requireEditor.
      if (!actorMay(actor, canManageTechnicalTemplates)) {
        fail("FORBIDDEN", "게시 권한이 없습니다.");
      }

      // 계열을 고를 열쇠부터 읽는다(위 머리말 — code 는 바뀌지 않는 칸이다).
      const [lineage] = await tx
        .select({ code: procedureTemplates.code })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.isDeleted, false)));
      if (!lineage) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");

      const series = await tx
        .select({
          id: procedureTemplates.id,
          version: procedureTemplates.version,
          status: procedureTemplates.status,
          category: procedureTemplates.category,
        })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.code, lineage.code), eq(procedureTemplates.isDeleted, false)))
        .orderBy(procedureTemplates.version)
        .for("update");

      // 잠근 뒤 **다시 찾는다** — 잠기기를 기다리는 사이 이 판이 휴지통으로
      // 갔다면 여기서 사라진다.
      const template = series.find((row) => row.id === templateId);
      if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      // Fine-grained, category-specific boundary — FULL_SERVICE/REFERENCE
      // fall through to canPublishProcedureTemplates unchanged (SUPER_ADMIN
      // only); only TECHNICAL_TASK evaluates the broader technical policy.
      if (!actorMay(actor, (role) => canActorPublishTemplateOfCategory(role, template.category))) {
        fail("FORBIDDEN", "게시 권한이 없습니다.");
      }
      if (!canPublishFromProcedureStatus(template.status)) {
        fail("CONFLICT", "초안(DRAFT) 또는 만료된 절차만 게시할 수 있습니다.");
      }

      // Phase 3A: resolution_status, not resolved_at nullity, is the
      // publish-blocking signal — DEFERRED still has resolved_at/by/note
      // set (a human did look at it) but must continue blocking, while
      // RESOLVED_WITH_GRAPH_CHANGE/RESOLVED_NO_CHANGE both clear it.
      const [unresolvedError] = await tx
        .select({ id: procedureTemplateValidationIssues.id })
        .from(procedureTemplateValidationIssues)
        .where(
          and(
            eq(procedureTemplateValidationIssues.procedureTemplateId, templateId),
            eq(procedureTemplateValidationIssues.severity, "ERROR"),
            inArray(procedureTemplateValidationIssues.resolutionStatus, ["UNRESOLVED", "DEFERRED"])
          )
        )
        .limit(1);
      if (unresolvedError) {
        fail("HAS_UNRESOLVED_ERRORS", "해결되지 않은 오류(ERROR)가 있어 게시할 수 없습니다.");
      }

      // Phase 4A — independent of the stored-issue check above: an editor
      // mutation (retarget, type change, new edge) can introduce a
      // structural problem that was never an imported issue row at all.
      // Re-running the deterministic structural validator here, live, at
      // the moment of publish is what makes "ERROR severity must continue
      // blocking publication" hold for editor-introduced problems too,
      // without needing to persist/dedupe validator findings into
      // procedure_template_validation_issues.
      const templateNodes = await tx
        .select({ id: procedureTemplateNodes.id, nodeType: procedureTemplateNodes.nodeType })
        .from(procedureTemplateNodes)
        .where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
      const templateEdges = await tx
        .select({ id: procedureTemplateEdges.id, fromNodeId: procedureTemplateEdges.fromNodeId, toNodeId: procedureTemplateEdges.toNodeId, branchType: procedureTemplateEdges.branchType })
        .from(procedureTemplateEdges)
        .where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
      const structuralIssues = validateProcedureGraphStructure(templateNodes, templateEdges);
      if (structuralIssues.some((i) => i.severity === "ERROR")) {
        fail("HAS_STRUCTURAL_ERRORS", "그래프 구조 오류(ERROR)가 있어 게시할 수 없습니다. 편집기에서 검증을 확인하세요.");
      }

      const now = new Date();

      // ── 🔴 옛 게시본을 먼저 내린다 ────────────────────────────────────
      // 올리기 **전에** 내린다. 순서가 반대면 그 사이(같은 트랜잭션 안이라
      // 밖에서는 안 보이지만) 게시본이 둘인 상태를 거치게 되고, 나중에 이
      // 블록에 부분 유니크 인덱스가 걸리면 그 순간 DB 가 거절한다.
      for (const sibling of pickPublishedSiblingsToExpire(series, templateId)) {
        const expired = await tx
          .update(procedureTemplates)
          .set({ status: "ARCHIVED", archivedByUserId: actor.id, archivedAt: now, updatedAt: now })
          .where(and(eq(procedureTemplates.id, sibling.id), eq(procedureTemplates.status, "PUBLISHED")))
          .returning({ id: procedureTemplates.id });
        // 계열을 통째로 잠근 뒤라 정상적으로는 0행이 나올 수 없다. 그래도
        // 조용히 지나가면 "게시본 둘"이 그대로 남으므로 트랜잭션을 되돌린다 —
        // 🔴 이 fail 은 throw 라서 아래 게시 UPDATE 도 함께 사라진다.
        if (expired.length === 0) {
          fail("CONFLICT", "같은 절차의 게시 상태가 방금 바뀌었습니다. 다시 시도해 주세요.");
        }
        await insertAuditLog(tx, {
          actorUserId: actor.id,
          actionType: "STATUS_CHANGE",
          targetEntity: "procedure_templates",
          targetRecordId: sibling.id,
          previousValue: { code: lineage.code, version: sibling.version, status: "PUBLISHED" },
          newValue: {
            code: lineage.code,
            version: sibling.version,
            status: "ARCHIVED",
            reason: PROCEDURE_EXPIRED_BY_PUBLISH_REASON,
            publishedTemplateId: templateId,
            publishedVersion: template.version,
            ...PROCEDURE_EXPIRED_BY_PUBLISH_MARKER,
          },
        });
      }

      const published = await tx
        .update(procedureTemplates)
        .set({
          status: "PUBLISHED",
          publishedByUserId: actor.id,
          publishedAt: now,
          updatedAt: now,
          // 🔴 만료본을 다시 게시하는 길에서 지난번에 내려갈 때 찍힌 보관 자국을
          //    지운다. 안 지우면 "게시됐는데 만료 시각이 있는" 행이 되어, 그 칸을
          //    읽는 화면이 생기는 날 거짓을 그린다. 초안을 처음 게시할 때는 둘 다
          //    이미 null 이라 아무 일도 아니다.
          archivedAt: null,
          archivedByUserId: null,
        })
        .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.status, template.status)))
        .returning({ id: procedureTemplates.id });
      if (published.length === 0) {
        fail("CONFLICT", "같은 절차의 게시 상태가 방금 바뀌었습니다. 다시 시도해 주세요.");
      }

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
      if (!actorMay(actor, canArchiveProcedureTemplates)) {
        fail("FORBIDDEN", "보관 권한이 없습니다 (SUPER_ADMIN 전용).");
      }

      const [template] = await tx
        .select({ id: procedureTemplates.id, status: procedureTemplates.status })
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.isDeleted, false)))
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
 *
 * 🔴 2026-11-03(줄기 B-⑤) — **배치도 전부 포함이다.** 노드의 사용자 자리
 * (user_position_x/y)와 연결선의 수동 경로(user_route_points)까지 복제한다.
 * 그 전까지 이 셋만 빠져 있어서 새 초안이 「처음 가져왔을 때의 모양」으로
 * 되돌아갔다. 이제 **내용** 쪽에서 일부러 안 옮기는 것은 검증 이슈 하나뿐이다
 * (위 문단). 이력 두 표(procedure_template_edit_history ·
 * procedure_validation_resolution_history)는 애초에 내용이 아니라 그 판에
 * 무슨 일이 있었는지의 기록이라 여기 대상이 아니다.
 *
 * 칸을 새로 더할 때 복제 목록에 적는 것을 잊으면 그 칸은 판이 올라갈 때마다
 * 조용히 사라진다 — procedure-template-clone-columns.test.ts 가 스키마의 칸
 * 목록과 이 목록을 맞대어 그것을 막는다.
 */
export async function createNewDraftVersion(
  publishedTemplateId: string,
  actorUserId: string
): Promise<ProcedureTemplateResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      // Phase 5C-5B — coarse pre-gate before any template row is looked up.
      if (!actorMay(actor, canManageTechnicalTemplates)) {
        fail("FORBIDDEN", "새 버전 작성 권한이 없습니다.");
      }

      const [published] = await tx
        .select()
        .from(procedureTemplates)
        .where(and(eq(procedureTemplates.id, publishedTemplateId), eq(procedureTemplates.isDeleted, false)))
        .for("update");
      if (!published) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
      // Fine-grained, category-specific boundary — FULL_SERVICE/REFERENCE
      // fall through to canCreateProcedureTemplateDraft unchanged
      // (SUPER_ADMIN only); only TECHNICAL_TASK evaluates the broader
      // technical policy.
      if (!actorMay(actor, (role) => canActorCreateDraftVersionOfCategory(role, published.category))) {
        fail("FORBIDDEN", "새 버전 작성 권한이 없습니다.");
      }
      if (published.status !== "PUBLISHED") {
        fail("CONFLICT", "게시(PUBLISHED) 상태의 템플릿만 새 버전을 만들 수 있습니다.");
      }

      const [existingDraft] = await tx
        .select({ id: procedureTemplates.id })
        .from(procedureTemplates)
        .where(
          and(
            eq(procedureTemplates.code, published.code),
            eq(procedureTemplates.status, "DRAFT"),
            // 휴지통에 있는 초안은 "이미 초안이 있다"로 세지 않는다 —
            // 목록에 보이지 않는 행 때문에 새 초안 만들기가 막히면 안 된다.
            eq(procedureTemplates.isDeleted, false)
          )
        )
        .limit(1);
      if (existingDraft) {
        // 🔴 2026-11-04(줄기 B-⑥) — 막으면서 **그 초안의 id 를 함께 돌려준다.**
        //    그 전에는 "이미 진행 중인 초안 버전이 있습니다" 한 줄뿐이라, 사람은
        //    어느 초안인지도 어디 있는지도 모른 채 목록으로 돌아가야 했다(같은
        //    code 의 다른 판이라 이름까지 똑같다).
        fail("CONFLICT", "이미 진행 중인 초안 버전이 있습니다.", { existingDraftId: existingDraft.id });
      }

      /**
       * 🔴 2026-11-04(줄기 B-⑥) — 판 번호는 **부모 + 1 이 아니라 이 줄기에서
       * 아직 쓰지 않은 다음 번호**다. 바뀐 까닭은 초안을 버릴 수 있게 되었기
       * 때문이다:
       *
       *   v1 게시 → v2 초안 → v2 를 휴지통에 버림 → 다시 새 초안
       *
       * 이때 부모(v1) + 1 로 세면 다시 v2 가 나오는데, 휴지통의 v2 행이
       * (code, version) 자리를 **계속 차지하고 있다** —
       * procedure_templates_code_version_unique 는 부분 인덱스가 아니다(그
       * 칸의 주석에 왜 일부러 그렇게 두었는지가 적혀 있다: 복원이 이름 충돌로
       * 막히지 않게 하려고). 그래서 그대로 두면 새 초안 만들기가 23505 로
       * 터지고, 액션은 그것을 "일시적으로 처리할 수 없습니다"로 바꿔 보여 준다
       * — 15일(자동 완전삭제)이 지나기 전에는 영영 풀리지 않는 거짓말이다.
       *
       * 🔵 그래서 삭제된 행도 **함께 센다**. 버린 번호는 돌아오지 않고 줄기에
       * 구멍이 남는다(v1 → v3). 일부러 그렇게 둔다 — 그 구멍이 "여기서 초안
       * 하나를 버렸다"는 기록이고, 번호를 다시 쓰면 휴지통의 v2 와 새 v2 가
       * 같은 이름으로 나란히 서게 된다.
       */
      const [versionCeiling] = await tx
        .select({ highest: sql<number>`max(${procedureTemplates.version})::int` })
        .from(procedureTemplates)
        .where(eq(procedureTemplates.code, published.code));
      const nextVersion = Math.max(published.version, versionCeiling?.highest ?? published.version) + 1;

      const [newDraft] = await tx
        .insert(procedureTemplates)
        .values({
          code: published.code,
          name: published.name,
          equipmentType: published.equipmentType,
          // Phase 5C-5A — a new DRAFT version always preserves its parent's
          // category exactly; no conversion/switching path exists or is
          // planned (see procedureTemplateCategoryEnum's own doc comment).
          category: published.category,
          description: published.description,
          status: "DRAFT",
          version: nextVersion,
          sourceType: published.sourceType,
          sourceFileName: published.sourceFileName,
          sourceFileHash: published.sourceFileHash,
          isReferenceOnly: published.isReferenceOnly,
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
              // 2026-11-03(줄기 B-⑤) — **사람이 끌어 놓은 자리도 함께 복제한다.**
              // 그 전까지 이 두 칸만 복제 목록에서 빠져 있어서, 게시된 절차로
              // 새 초안을 만들면 **배치가 통째로 사라졌다**(실측: 「기본 통전
              // 검사」 v1 은 28/28 노드에 자리 값이 있는데 거기서 나온 v2 초안은
              // 0/28 이었다). 원본 좌표(position_x/y)는 Excel 에서 읽은 값이거나
              // 손으로 만든 절차에서는 만든 차례대로 쌓은 값이라, 자리 값이
              // 떨어져 나가면 사람이 그려 둔 그림이 아니라 **처음 가져왔을 때의
              // 모양**으로 되돌아간다.
              //
              // 🔵 null 은 null 그대로 온다 — 한 번도 안 옮긴 노드에 자리를
              // 만들어 주지 않는다. 자리 값이 없는 노드는 전과 똑같이
              // position_x/y(또는 기술 절차의 자동 배치)로 떨어진다.
              //
              // 🔴 곁다리로 **초안↔부모 비교**(compareDraftAndParentGraphs)도
              // 바로잡힌다. 그 비교는 양쪽의 **유효 좌표**(자리 값 우선)를 맞대
              // 므로, 자리 값을 안 싣던 때에는 새 초안을 만든 **직후** 손도 안 댄
              // 노드 전부가 「이동함」으로 올라왔다.
              userPositionX: n.userPositionX,
              userPositionY: n.userPositionY,
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
            // Phase 4A — the exact parent-version edge this row was cloned
            // from, so the editor's DRAFT-vs-parent comparison can tell a
            // retargeted edge apart from a newly-added one (edges get a
            // fresh id on every clone; unlike nodes there is no other
            // stable cross-version identity to rely on).
            clonedFromEdgeId: e.id,
            // 2026-11-03(줄기 B-⑤) — 연결선의 **손으로 꺾은 경로**도 함께
            // 복제한다. 노드 자리와 **짝**이라 따로 갈 수 없다: 경로점은 노드
            // 자리를 기준으로 찍은 절대 좌표라서, 자리는 따라오는데 경로만
            // 떨어지면 사람이 펴 둔 선이 자동 경로로 되돌아간다.
            //
            // 🔴 바로 이 짝 때문에 **전에는 안 싣는 쪽이 맞았다** — 자리 값을
            // 안 싣던 때에 경로만 실으면, 원본 좌표로 떨어진 노드 옆을 엉뚱한
            // 경로가 지나갔다. 그 시절의 판단이 procedure-template-editor
            // .integration.test.ts 32번에 「절대 물려받지 않는다」로 적혀 있었고,
            // 자리 값을 싣는 지금은 그 시험도 함께 뒤집었다.
            userRoutePoints: e.userRoutePoints,
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

      const oldReferenceItems = await tx
        .select()
        .from(procedureReferenceItems)
        .where(eq(procedureReferenceItems.procedureTemplateId, published.id));
      if (oldReferenceItems.length > 0) {
        await tx.insert(procedureReferenceItems).values(
          oldReferenceItems.map((item) => ({
            procedureTemplateId: newDraft.id,
            itemType: item.itemType,
            label: item.label,
            sourceWorksheet: item.sourceWorksheet,
            sourceCellRange: item.sourceCellRange,
            hyperlinkTarget: item.hyperlinkTarget,
            crossReferenceNumber: item.crossReferenceNumber,
            sortOrder: item.sortOrder,
          }))
        );
      }

      return { ok: true, id: newDraft.id };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}

export type ReplaceDraftTemplatesResult =
  | {
      ok: true;
      deleted: {
        code: string;
        id: string;
        nodeCount: number;
        edgeCount: number;
        checklistSectionCount: number;
        checklistItemCount: number;
        troubleshootingEntryCount: number;
        referenceItemCount: number;
        issueCount: number;
      }[];
    }
  | { ok: false; code: ProcedureTemplateResultCode; message: string };

/**
 * Explicit, disclosed replace mode for the Phase 2.5 template
 * reorganization (task brief: "implement an explicit safe replace/reimport
 * mode... do not manually delete existing reviewed templates without
 * disclosure"). Only ever touches rows whose `code` is in the given list
 * AND whose `status` is still 'DRAFT' — a template that was ever published
 * (even if since archived) is never matched here regardless of code, so
 * this can never destroy version-chain history. Deletes child rows first
 * (respecting the existing onDelete:"restrict" FKs), all inside one
 * transaction together with the template-row deletes, and returns exactly
 * what was removed so the caller can print it for disclosure.
 */
export async function replaceDraftProcedureTemplates(
  codes: string[],
  actorUserId: string
): Promise<ReplaceDraftTemplatesResult> {
  try {
    return await db.transaction(async (tx) => {
      const actor = await resolveEligibleActor(tx, actorUserId);
      if (!actorMay(actor, canImportProcedureTemplates)) {
        fail("FORBIDDEN", "가져오기 권한이 없습니다 (SUPER_ADMIN 전용).");
      }

      if (codes.length === 0) return { ok: true, deleted: [] };

      const targets = await tx
        .select({ id: procedureTemplates.id, code: procedureTemplates.code })
        .from(procedureTemplates)
        .where(
          and(
            inArray(procedureTemplates.code, codes),
            eq(procedureTemplates.status, "DRAFT"),
            eq(procedureTemplates.isDeleted, false)
          )
        );

      const deleted: (ReplaceDraftTemplatesResult & { ok: true })["deleted"] = [];

      for (const target of targets) {
        const nodes = await tx
          .select({ id: procedureTemplateNodes.id })
          .from(procedureTemplateNodes)
          .where(eq(procedureTemplateNodes.procedureTemplateId, target.id));
        const nodeIds = nodes.map((n) => n.id);

        const deletedIssues = await tx
          .delete(procedureTemplateValidationIssues)
          .where(eq(procedureTemplateValidationIssues.procedureTemplateId, target.id))
          .returning({ id: procedureTemplateValidationIssues.id });

        const deletedReferenceItems = await tx
          .delete(procedureReferenceItems)
          .where(eq(procedureReferenceItems.procedureTemplateId, target.id))
          .returning({ id: procedureReferenceItems.id });

        let deletedChecklistItemCount = 0;
        let deletedSectionCount = 0;
        let deletedTroubleshootingCount = 0;
        if (nodeIds.length > 0) {
          const sections = await tx
            .select({ id: procedureChecklistSections.id })
            .from(procedureChecklistSections)
            .where(inArray(procedureChecklistSections.nodeId, nodeIds));
          const sectionIds = sections.map((s) => s.id);
          if (sectionIds.length > 0) {
            const deletedItems = await tx
              .delete(procedureChecklistItems)
              .where(inArray(procedureChecklistItems.sectionId, sectionIds))
              .returning({ id: procedureChecklistItems.id });
            deletedChecklistItemCount = deletedItems.length;
          }
          const deletedSections = await tx
            .delete(procedureChecklistSections)
            .where(inArray(procedureChecklistSections.nodeId, nodeIds))
            .returning({ id: procedureChecklistSections.id });
          deletedSectionCount = deletedSections.length;

          const deletedTroubleshooting = await tx
            .delete(procedureTroubleshootingEntries)
            .where(inArray(procedureTroubleshootingEntries.nodeId, nodeIds))
            .returning({ id: procedureTroubleshootingEntries.id });
          deletedTroubleshootingCount = deletedTroubleshooting.length;
        }

        const deletedEdges = await tx
          .delete(procedureTemplateEdges)
          .where(eq(procedureTemplateEdges.procedureTemplateId, target.id))
          .returning({ id: procedureTemplateEdges.id });

        const deletedNodes = await tx
          .delete(procedureTemplateNodes)
          .where(eq(procedureTemplateNodes.procedureTemplateId, target.id))
          .returning({ id: procedureTemplateNodes.id });

        await tx.delete(procedureTemplates).where(eq(procedureTemplates.id, target.id));

        deleted.push({
          code: target.code,
          id: target.id,
          nodeCount: deletedNodes.length,
          edgeCount: deletedEdges.length,
          checklistSectionCount: deletedSectionCount,
          checklistItemCount: deletedChecklistItemCount,
          troubleshootingEntryCount: deletedTroubleshootingCount,
          referenceItemCount: deletedReferenceItems.length,
          issueCount: deletedIssues.length,
        });
      }

      return { ok: true, deleted };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}

// ---- 기술 절차 삭제 · 복원 · 완전삭제 (휴지통 → 15일 → 완전삭제) ----

/**
 * ============================================================================
 * 기술 절차 휴지통
 * ============================================================================
 * 고객사·제품 모델·부품과 같은 3단계이고, 코드 모양은 이 파일의 규약을
 * 따른다(resolveEligibleActor + fail + 행 잠금 + 상태 재검사).
 *
 * ── 보관과 겹치지 않는다 ────────────────────────────────────────────────
 * archiveProcedureTemplate은 **발행된** 절차를 "이제 안 씀"으로 내린다.
 * 여기 삭제는 **쓰인 적 없는** 절차를 목록에서 치운다. 대상이 겹치지 않으므로
 * 두 기능은 서로를 대체하지 않는다 — 지금 이 시스템의 절차가 전부 DRAFT라
 * 보관 대상이 0개이고, 그래서 잘못 만든 초안을 치울 방법이 없었다는 것이
 * 이 기능을 넣은 이유다.
 *
 * ── 낙관적 동시성 토큰이 없다 ───────────────────────────────────────────
 * archiveProcedureTemplate과 같다 — 행을 잠그고 상태를 다시 보는 것으로
 * 충분하다. 두 사람이 동시에 지우면 나중 사람은 "찾을 수 없음"을 받는다.
 * procedure_templates.version은 **발행 횟수**이지 행 버전이 아니라서
 * 동시성 토큰으로 쓸 수 없다(발행하지 않으면 영원히 1이다).
 *
 * ── 지울 수 없는 절차 ───────────────────────────────────────────────────
 * ① procedure_case_executions가 가리키는 절차 — 실제 수리 작업의 기록이다.
 * ② 다른 버전이 supersedes_template_id로 이어받은 절차.
 * 둘 다 RESTRICT라, 남겨 두면 15일 뒤 완전삭제가 DB에서 거부되고 그 절차는
 * 휴지통에서 영영 사라지지 않는다. 그래서 휴지통에도 넣지 않는다.
 *
 * ── 분류로 먼저 막는다 ──────────────────────────────────────────────────
 * canDeleteTechnicalTemplates는 TECHNICAL_TASK 전용이다. 전체 서비스·참고자료
 * 절차는 어떤 역할로도 이 함수들을 통과하지 못한다.
 *
 * ── 들어오는 문이 둘이다(2026-11-04, 줄기 B-⑥) ──────────────────────────
 * ① 목록 화면(/procedures/technical)의 [삭제 모드] — 여러 건을 한꺼번에,
 *    **상태를 묻지 않는다**. 휴지통의 「삭제 당시 상태」 칸이 그 전제 위에 있다.
 * ② 편집기의 [초안 버리기] — 한 건을, requireStatus="DRAFT" 로.
 * ②는 ①을 좁힌 길이지 ①을 대신하는 길이 아니다. ①의 동작은 한 글자도 바뀌지
 * 않았다.
 * ============================================================================
 */

export type ProcedureTemplateTrashResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: ProcedureTemplateResultCode;
      message: string;
      /**
       * 2026-11-04(줄기 B-⑥) — restoreProcedureTemplate 이 "같은 줄기에 이미
       * 살아 있는 초안이 있다"로 막을 때 **그 초안의 id**. createNewDraftVersion
       * 이 같은 상황에서 쓰는 칸과 **일부러 같은 이름·같은 뜻**이다(이 파일 위쪽
       * ProcedureTemplateResult 의 주석 참고) — 두 길이 막는 까닭이 같으니
       * 돌려주는 모양도 같아야, 받는 쪽이 한 가지 규칙만 알면 된다.
       *
       * 🔵 이 한 갈래에서만 찬다. 다른 실패(권한·없음·참조)에는 보낼 곳이 없다.
       */
      existingDraftId?: string;
    };

/** 이 절차를 붙잡고 있는 것의 수 — 수행 기록과 이어받은 버전을 합쳐 센다. */
async function countProcedureTemplateReferences(tx: Tx, templateId: string): Promise<number> {
  const [executions] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(procedureCaseExecutions)
    .where(eq(procedureCaseExecutions.procedureTemplateId, templateId));

  const [successors] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(procedureTemplates)
    .where(eq(procedureTemplates.supersedesTemplateId, templateId));

  return executions.total + successors.total;
}

function templateReferencedMessage(count: number): string {
  return `이 절차를 참조하는 수행 기록·후속 버전이 ${count}건 있어 삭제할 수 없습니다.`;
}

/** 삭제·복원·완전삭제가 공통으로 통과하는 관문. 분류까지 보고 판정한다. */
async function requireDeletableTemplate(
  tx: Tx,
  templateId: string,
  actorUserId: string,
  expectDeleted: boolean
) {
  const actor = await resolveEligibleActor(tx, actorUserId);

  const [template] = await tx
    .select({
      id: procedureTemplates.id,
      code: procedureTemplates.code,
      name: procedureTemplates.name,
      category: procedureTemplates.category,
      status: procedureTemplates.status,
      version: procedureTemplates.version,
      isDeleted: procedureTemplates.isDeleted,
      deletedAt: procedureTemplates.deletedAt,
      deletedBy: procedureTemplates.deletedBy,
      deleteReason: procedureTemplates.deleteReason,
    })
    .from(procedureTemplates)
    .where(and(eq(procedureTemplates.id, templateId), eq(procedureTemplates.isDeleted, expectDeleted)))
    .for("update");

  if (!template) fail("NOT_FOUND", "해당 템플릿을 찾을 수 없습니다.");
  if (!actorMay(actor, (role) => canDeleteTechnicalTemplates(role, template.category))) {
    fail("FORBIDDEN", "이 절차를 삭제하거나 복원할 권한이 없습니다.");
  }

  return { actor, template };
}

/** 절차를 휴지통으로 보낸다. 수행 기록이나 후속 버전이 있으면 아무것도 바꾸지 않는다. */
export async function softDeleteProcedureTemplate(input: {
  templateId: string;
  actorUserId: string;
  reason: string | null;
  /**
   * 2026-11-04(줄기 B-⑥) — 이 상태일 때만 지운다. 넘기지 않으면 상태를 보지
   * 않는다(목록 화면의 일괄 삭제가 쓰던 그대로다 — 그쪽은 수행 기록·후속
   * 버전만 보고 상태는 묻지 않았고, 휴지통의 「삭제 당시 상태」 칸이 그 사실을
   * 전제로 서 있다).
   *
   * 🔴 **편집기의 [초안 버리기]만 "DRAFT" 를 넘긴다.** 그 단추는 잘못 만든
   * 초안 하나를 그 자리에서 치우는 길이라, 게시된 판이 그 길로 사라지는 일은
   * 없어야 한다. 화면도 DRAFT 일 때만 단추를 내지만, 화면에서 감추는 것은
   * 편의일 뿐 경계가 아니다 — 경계는 여기, 행을 잠근 트랜잭션 안이다.
   *
   * 🔴 2026-11-04 — **여럿도 받는다.** [버전 목록]의 [삭제]가 초안과 만료본
   * 둘을 허용하기 때문이다(게시본은 여전히 안 된다 —
   * domain/procedure-version-deletion.ts). 한 값만 받던 때의 호출부는 한 글자도
   * 안 바뀌었다: 글자 하나를 넘기면 전과 똑같이 그 한 상태만 통과한다.
   * 🔵 "안 넘기면 상태를 안 본다"도 그대로다 — 빈 배열을 넘기는 것과는 다르다
   *    (빈 배열이면 어떤 상태도 통과하지 못한다).
   */
  requireStatus?: ProcedureTemplateStatus | readonly ProcedureTemplateStatus[];
}): Promise<ProcedureTemplateTrashResult> {
  try {
    return await db.transaction(async (tx) => {
      const { template } = await requireDeletableTemplate(tx, input.templateId, input.actorUserId, false);

      // 상태를 먼저 본다 — 게시본을 참조 수로 거절하면 "지금은 참조가 없으니
      // 지울 수 있다"로 읽힌다. 거절하는 까닭이 상태라면 상태를 말해야 한다.
      // 🔵 화면(domain/procedure-version-deletion.ts)도 **같은 차례**로 까닭을
      //    고른다. 뒤집히면 "화면은 수행 기록이라는데 서버는 게시 중이라 한다".
      if (input.requireStatus !== undefined) {
        const allowed = typeof input.requireStatus === "string" ? [input.requireStatus] : input.requireStatus;
        if (!allowed.includes(template.status)) {
          fail(
            "CONFLICT",
            `${allowed.map((s) => procedureTemplateStatusLabels[s]).join(" · ")} 상태의 절차만 이 길로 지울 수 있습니다 — 이 절차는 ${procedureTemplateStatusLabels[template.status]} 상태입니다.`
          );
        }
      }

      const references = await countProcedureTemplateReferences(tx, input.templateId);
      if (references > 0) fail("CONFLICT", templateReferencedMessage(references));

      const deletedAt = new Date();
      await tx
        .update(procedureTemplates)
        .set({
          isDeleted: true,
          deletedAt,
          deletedBy: input.actorUserId,
          deleteReason: input.reason,
          updatedAt: deletedAt,
        })
        .where(and(eq(procedureTemplates.id, input.templateId), eq(procedureTemplates.isDeleted, false)));

      await insertAuditLog(tx, {
        actorUserId: input.actorUserId,
        actionType: "SOFT_DELETE",
        targetEntity: "procedure_templates",
        targetRecordId: input.templateId,
        previousValue: {
          id: template.id,
          code: template.code,
          name: template.name,
          category: template.category,
          status: template.status,
          version: template.version,
        },
        newValue: { isDeleted: true, deletedAt: deletedAt.toISOString(), deleteReason: input.reason },
      });

      return { ok: true, id: input.templateId };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}

/**
 * 휴지통의 절차를 되살린다.
 *
 * ── 이름(code, version) 충돌은 보지 않는다 ──────────────────────────────
 * procedure_templates_code_version_unique는 부분 인덱스가 아니라서 삭제된
 * 행도 (code, version) 자리를 계속 지킨다. 즉 휴지통에 있는 동안 같은
 * code+version이 새로 생길 수 없고, 복원이 **그 이름 때문에** 막힐 일도 없다
 * (고객사·제품 모델은 부분 인덱스라 그 검사가 필요했다).
 *
 * ── 🔴 그러나 「살아 있는 초안」은 본다(2026-11-04, 줄기 B-⑥) ────────────
 * 이름이 안 부딪힌다는 것과 **줄기에 초안이 하나뿐이라는 것**은 다른 약속이다.
 * 그 둘을 한 문장으로 묶어 읽은 탓에 여기엔 DRAFT 를 세는 줄이 하나도 없었고,
 * 다음 길이 조용히 열려 있었다:
 *
 *   v1 게시 → 새 초안 v2 → v2 를 [초안 버리기] → 다시 새 초안 v3
 *   → 휴지통에서 v2 를 [복원]  ⇒ 🔴 v2·v3 가 **둘 다 살아 있다**
 *
 * 개발 DB 에서 실제로 그렇게 됐다(한 줄기에 살아 있는 DRAFT 가 둘, 78초 차이).
 * createNewDraftVersion 은 "이미 진행 중인 초안이 있다"로 막지만 **버린 초안은
 * 일부러 안 센다**(목록에 안 보이는 행이 새 초안 만들기를 막으면 안 된다) —
 * 그 판단은 그대로 옳고, 구멍은 되살아나는 쪽에 있었다. 그래서 막는 자리를
 * 여기 하나 더 둔다.
 *
 * 🔴 줄기 B-⑥ 의 앞 조각이 이 구멍을 **넓혔다**. 판 번호를 "아직 안 쓴 다음
 * 번호"로 바꾸면서 「버리고 다시 만들기」가 자연스러운 길이 됐기 때문이다 —
 * 그 전에는 같은 번호를 다시 쓰려다 유니크 위반으로 터져, 위 경로의 셋째
 * 걸음이 애초에 성립하지 않았다.
 *
 * 🔴 **초안에만 건다.** 게시본·보관본을 되살리는 것은 이 약속과 무관하다
 * (한 줄기에 게시본이 여럿인 것은 판 이력 그 자체다) — 거기까지 막으면 멀쩡한
 * 복원이 죽는다.
 *
 * 🔵 일괄 복원(restoreProcedureTemplatesAction)은 건마다 **제 트랜잭션을
 * 순서대로** 돌린다. 그래서 한 번에 같은 줄기의 초안 둘을 골라도 둘째가 첫째의
 * 결과를 보고 막히고, 막힌 건이 나머지를 멈추지 않는다(runEach).
 */
export async function restoreProcedureTemplate(input: {
  templateId: string;
  actorUserId: string;
}): Promise<ProcedureTemplateTrashResult> {
  try {
    return await db.transaction(async (tx) => {
      const { template } = await requireDeletableTemplate(tx, input.templateId, input.actorUserId, true);

      if (template.status === "DRAFT") {
        // 되살릴 행은 아직 is_deleted = true 라 자기 자신은 여기 안 걸린다.
        const [liveDraft] = await tx
          .select({ id: procedureTemplates.id, version: procedureTemplates.version })
          .from(procedureTemplates)
          .where(
            and(
              eq(procedureTemplates.code, template.code),
              eq(procedureTemplates.status, "DRAFT"),
              eq(procedureTemplates.isDeleted, false)
            )
          )
          .limit(1);
        if (liveDraft) {
          // 막는 자리에 **갈 곳을 함께 낸다** — 같은 code 의 다른 판이라 이름까지
          // 똑같아서, 까닭만 적으면 "그 초안"이 어느 줄인지 사람이 목록에서
          // 손으로 찾아야 한다. 휴지통 창은 message 만 그리므로 판 번호도 글에
          // 싣는다(id 는 화면이 링크를 낼 때 쓴다).
          fail(
            "CONFLICT",
            `같은 절차에 이미 진행 중인 초안(v${liveDraft.version})이 있어 이 초안은 복원할 수 없습니다. 그 초안을 게시하거나 버린 뒤에 다시 복원해 주세요.`,
            { existingDraftId: liveDraft.id }
          );
        }
      }

      await tx
        .update(procedureTemplates)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
          updatedAt: new Date(),
        })
        .where(and(eq(procedureTemplates.id, input.templateId), eq(procedureTemplates.isDeleted, true)));

      await insertAuditLog(tx, {
        actorUserId: input.actorUserId,
        actionType: "RESTORE",
        targetEntity: "procedure_templates",
        targetRecordId: input.templateId,
        previousValue: null,
        newValue: { id: template.id, code: template.code, name: template.name, isDeleted: false },
      });

      return { ok: true, id: input.templateId };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}

/**
 * 절차와 그 부속물을 실제로 지운다. FK가 강제하는 순서다:
 *
 *   검증 해소 이력 → 검증 이슈 → 편집 이력 → 참고자료
 *   → 체크리스트 항목 → 체크리스트 구역 → 문제 해결 항목
 *   → 분기 → 노드 → 절차
 *
 * replaceDraftTemplates(가져오기 경로)의 순서와 대체로 같지만 **두 가지가
 * 더 있다**: 검증 해소 이력과 편집 이력. 그쪽은 갓 가져온 초안만 지우므로
 * 그 두 표에 행이 있을 수 없었지만, 사람이 손으로 만든 절차에는 있다.
 * 여기서 빠뜨리면 완전삭제가 FK에서 막힌다.
 *
 * 자동 정리(master-data-purge.ts)와 이 함수가 같은 순서를 각자 적고 있다 —
 * 그쪽은 "server-only" 밖에서 도는 CLI라 이 파일을 부를 수 없다(그 파일의
 * 상단 주석 참조).
 */
export async function purgeProcedureTemplateContent(tx: Tx, templateId: string): Promise<void> {
  const nodes = await tx
    .select({ id: procedureTemplateNodes.id })
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  const nodeIds = nodes.map((node) => node.id);

  await tx
    .delete(procedureValidationResolutionHistory)
    .where(eq(procedureValidationResolutionHistory.procedureTemplateId, templateId));
  await tx
    .delete(procedureTemplateValidationIssues)
    .where(eq(procedureTemplateValidationIssues.procedureTemplateId, templateId));
  await tx
    .delete(procedureTemplateEditHistory)
    .where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId));
  await tx.delete(procedureReferenceItems).where(eq(procedureReferenceItems.procedureTemplateId, templateId));

  if (nodeIds.length > 0) {
    const sections = await tx
      .select({ id: procedureChecklistSections.id })
      .from(procedureChecklistSections)
      .where(inArray(procedureChecklistSections.nodeId, nodeIds));
    const sectionIds = sections.map((section) => section.id);
    if (sectionIds.length > 0) {
      await tx.delete(procedureChecklistItems).where(inArray(procedureChecklistItems.sectionId, sectionIds));
    }
    await tx.delete(procedureChecklistSections).where(inArray(procedureChecklistSections.nodeId, nodeIds));
    await tx.delete(procedureTroubleshootingEntries).where(inArray(procedureTroubleshootingEntries.nodeId, nodeIds));
  }

  await tx.delete(procedureTemplateEdges).where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
  await tx.delete(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, templateId));
  await tx.delete(procedureTemplates).where(eq(procedureTemplates.id, templateId));
}

/** 15일을 기다리지 않고 즉시 완전삭제한다. 사람이 행위자라는 점만 자동 정리와 다르다. */
export async function permanentlyDeleteProcedureTemplate(input: {
  templateId: string;
  actorUserId: string;
  reason: string;
}): Promise<ProcedureTemplateTrashResult> {
  try {
    return await db.transaction(async (tx) => {
      const { template } = await requireDeletableTemplate(tx, input.templateId, input.actorUserId, true);
      if (input.reason.trim().length === 0) fail("INVALID_INPUT", "완전 삭제 사유를 입력해 주세요.");

      // 휴지통에 넣을 때 이미 막았지만 여기서 다시 센다 — 그 사이에 수행
      // 기록이 생겼다면 DB 오류로 터지는 대신 이유를 말해야 한다.
      const references = await countProcedureTemplateReferences(tx, input.templateId);
      if (references > 0) fail("CONFLICT", templateReferencedMessage(references));

      await purgeProcedureTemplateContent(tx, input.templateId);

      await insertAuditLog(tx, {
        actorUserId: input.actorUserId,
        actionType: "PURGE",
        targetEntity: "procedure_templates",
        targetRecordId: input.templateId,
        previousValue: {
          id: template.id,
          code: template.code,
          name: template.name,
          category: template.category,
          status: template.status,
          version: template.version,
          deletedAt: template.deletedAt ? template.deletedAt.toISOString() : null,
          deletedBy: template.deletedBy,
          deleteReason: template.deleteReason,
          purgeReason: input.reason.trim(),
        },
        newValue: null,
      });

      return { ok: true, id: input.templateId };
    });
  } catch (err) {
    if (err instanceof ProcedureTemplateMutationError) return err.result;
    throw err;
  }
}
