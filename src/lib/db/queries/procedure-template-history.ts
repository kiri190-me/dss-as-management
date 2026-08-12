import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { procedureTemplateEditHistory, users } from "../schema";
import { foldProcedureTemplateEditHistory, type HistoryGroupEvent, type ProcedureTemplateEditHistoryOrigin } from "@/lib/domain/procedure-template-edit-history-fold";
import { isEligibleRestoreTargetOrigin } from "@/lib/db/mutations/procedure-template-restore";

/**
 * Phase 5C-5C UI — read-only, grouped view of one template's edit history
 * for the editor's history tab and the Undo/Redo/Restore controls. Groups
 * by change_group_id (never one flat row per DB write), orders by
 * sequence_number (never created_at, which is display-only), and derives
 * canUndo/canRedo/eligibility from the exact same pure fold and restore-
 * eligibility rule the server mutations use — the UI never invents its own
 * copy of this logic, only reads it.
 */

export type HistoryEntryRow = {
  id: string;
  actionType: string;
  nodeId: string | null;
  edgeId: string | null;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  actorName: string;
  sequenceNumber: number;
  /** Display-only — never used for ordering or grouping. */
  createdAt: string;
};

export type HistoryGroupView = {
  changeGroupId: string;
  origin: ProcedureTemplateEditHistoryOrigin;
  sourceGroupId: string | null;
  restoreTargetGroupId: string | null;
  /** MIN(sequence_number) across the group's rows — the group's own ordering key. */
  sequenceNumber: number;
  /** Of the group's first-written row — display-only. */
  createdAt: string;
  rows: HistoryEntryRow[];
  /** Server-authoritative rule (isEligibleRestoreTargetOrigin) — a restore button must never render/enable for a group this is false for. The actual restore mutation re-validates regardless. */
  isRestoreEligible: boolean;
  /** True only for the single group at top(appliedStack) — the one further Undo would target, i.e. the model's own definition of "current". Never inferred from timestamps. */
  isCurrentTop: boolean;
};

export type TemplateHistoryView = {
  /** Newest first (by sequence_number) — the natural reading order for a history tab. */
  groups: HistoryGroupView[];
  canUndo: boolean;
  canRedo: boolean;
};

export async function getProcedureTemplateHistoryView(templateId: string): Promise<TemplateHistoryView> {
  const rows = await db
    .select({
      id: procedureTemplateEditHistory.id,
      actionType: procedureTemplateEditHistory.actionType,
      nodeId: procedureTemplateEditHistory.nodeId,
      edgeId: procedureTemplateEditHistory.edgeId,
      beforeState: procedureTemplateEditHistory.beforeState,
      afterState: procedureTemplateEditHistory.afterState,
      reason: procedureTemplateEditHistory.reason,
      createdAt: procedureTemplateEditHistory.createdAt,
      changeGroupId: procedureTemplateEditHistory.changeGroupId,
      origin: procedureTemplateEditHistory.origin,
      sourceGroupId: procedureTemplateEditHistory.sourceGroupId,
      restoreTargetGroupId: procedureTemplateEditHistory.restoreTargetGroupId,
      sequenceNumber: procedureTemplateEditHistory.sequenceNumber,
      actorName: users.name,
    })
    .from(procedureTemplateEditHistory)
    .innerJoin(users, eq(procedureTemplateEditHistory.actorUserId, users.id))
    .where(eq(procedureTemplateEditHistory.procedureTemplateId, templateId))
    .orderBy(procedureTemplateEditHistory.sequenceNumber);

  const groupMap = new Map<string, HistoryGroupView>();
  for (const r of rows) {
    let group = groupMap.get(r.changeGroupId);
    if (!group) {
      group = {
        changeGroupId: r.changeGroupId,
        origin: r.origin,
        sourceGroupId: r.sourceGroupId,
        restoreTargetGroupId: r.restoreTargetGroupId,
        sequenceNumber: r.sequenceNumber,
        createdAt: r.createdAt.toISOString(),
        rows: [],
        isRestoreEligible: isEligibleRestoreTargetOrigin(r.origin),
        isCurrentTop: false,
      };
      groupMap.set(r.changeGroupId, group);
    }
    group.rows.push({
      id: r.id,
      actionType: r.actionType,
      nodeId: r.nodeId,
      edgeId: r.edgeId,
      beforeState: r.beforeState,
      afterState: r.afterState,
      reason: r.reason,
      actorName: r.actorName,
      sequenceNumber: r.sequenceNumber,
      createdAt: r.createdAt.toISOString(),
    });
  }

  // rows were already fetched ordered by sequence_number ascending, so
  // Map insertion order already matches ascending order by each group's
  // own (first-seen = minimum) sequenceNumber — sorted explicitly anyway,
  // defensively, rather than relying on Map iteration order semantics.
  const groupsAsc = [...groupMap.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const events: HistoryGroupEvent[] = groupsAsc.map((g) => ({
    changeGroupId: g.changeGroupId,
    origin: g.origin,
    sourceGroupId: g.sourceGroupId,
    restoreTargetGroupId: g.restoreTargetGroupId,
    sequenceNumber: g.sequenceNumber,
  }));

  // An inconsistent fold (EventFoldError) is a data-integrity signal the
  // mutation layer would also refuse to act on — the read path degrades to
  // "no undo/redo available" rather than crashing the editor screen; it
  // never fabricates a plausible-looking stack.
  let appliedStack: string[] = [];
  let redoStack: string[] = [];
  try {
    const fold = foldProcedureTemplateEditHistory(events);
    appliedStack = fold.appliedStack;
    redoStack = fold.redoStack;
  } catch {
    appliedStack = [];
    redoStack = [];
  }

  const currentTopId = appliedStack.length > 0 ? appliedStack[appliedStack.length - 1] : null;
  if (currentTopId) {
    const topGroup = groupMap.get(currentTopId);
    if (topGroup) topGroup.isCurrentTop = true;
  }

  return {
    groups: [...groupsAsc].reverse(),
    canUndo: appliedStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
