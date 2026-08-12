/**
 * Phase 5C-5C — pure event-fold over a template's ordered edit-history
 * groups (one entry per change_group_id), reconstructing the Undo/Redo
 * appliedStack/redoStack by replay. Never a client/DB-persisted mutable
 * cursor — see HANDOFF.md's "Approved state model". Never touches the DB
 * itself (see procedure-template-undo-redo.ts for the caller that loads
 * grouped history and calls this).
 *
 * Ordering: callers MUST supply events already ordered ascending by
 * MIN(sequence_number) per group — sequence_number (IDENTITY-allocated) is
 * the sole ordering key; created_at is display-only and never used here.
 *
 * appliedStack holds only USER_EDIT/RESTORE change_group_ids (the forward
 * operations currently "in effect"). redoStack and a REDO push both carry
 * the ORIGINAL forward group's id (via source_group_id), never the
 * UNDO/REDO event's own change_group_id — an UNDO/REDO event is never
 * itself a target of a further fold push.
 */

export type ProcedureTemplateEditHistoryOrigin = "USER_EDIT" | "UNDO" | "REDO" | "RESTORE";

export type HistoryGroupEvent = {
  changeGroupId: string;
  origin: ProcedureTemplateEditHistoryOrigin;
  sourceGroupId: string | null;
  restoreTargetGroupId: string | null;
  sequenceNumber: number;
};

export type EventFoldResult = {
  appliedStack: string[];
  redoStack: string[];
};

export class EventFoldError extends Error {}

/**
 * Invalid/inconsistent streams fail explicitly (EventFoldError) rather than
 * silently self-repairing — e.g. an UNDO whose source_group_id doesn't
 * match top(appliedStack) signals either a data-integrity bug or a caller
 * ordering mistake, never something to paper over.
 */
export function foldProcedureTemplateEditHistory(events: HistoryGroupEvent[]): EventFoldResult {
  const appliedStack: string[] = [];
  const redoStack: string[] = [];
  let lastSequenceNumber = -Infinity;

  for (const event of events) {
    if (event.sequenceNumber < lastSequenceNumber) {
      throw new EventFoldError(
        `events must be supplied in ascending sequence_number order — got ${event.sequenceNumber} after ${lastSequenceNumber}`
      );
    }
    lastSequenceNumber = event.sequenceNumber;

    switch (event.origin) {
      case "USER_EDIT":
      case "RESTORE": {
        appliedStack.push(event.changeGroupId);
        redoStack.length = 0;
        break;
      }
      case "UNDO": {
        if (event.sourceGroupId === null) {
          throw new EventFoldError(`UNDO event ${event.changeGroupId} has no source_group_id`);
        }
        const top = appliedStack[appliedStack.length - 1];
        if (top !== event.sourceGroupId) {
          throw new EventFoldError(
            `UNDO event ${event.changeGroupId} expected top(appliedStack)=${event.sourceGroupId} but found ${top ?? "<empty>"}`
          );
        }
        appliedStack.pop();
        redoStack.push(event.sourceGroupId);
        break;
      }
      case "REDO": {
        if (event.sourceGroupId === null) {
          throw new EventFoldError(`REDO event ${event.changeGroupId} has no source_group_id`);
        }
        const top = redoStack[redoStack.length - 1];
        if (top !== event.sourceGroupId) {
          throw new EventFoldError(
            `REDO event ${event.changeGroupId} expected top(redoStack)=${event.sourceGroupId} but found ${top ?? "<empty>"}`
          );
        }
        redoStack.pop();
        appliedStack.push(event.sourceGroupId);
        break;
      }
      default: {
        const exhaustive: never = event.origin;
        throw new EventFoldError(`unknown origin: ${String(exhaustive)}`);
      }
    }
  }

  return { appliedStack, redoStack };
}
