import { db } from "../connection";
import { auditLogs } from "../schema";

// No "server-only" here, deliberately — this module's first (and currently
// only) caller is repair-case-flowchart-purge.ts, which runs from a
// standalone CLI script (scripts/purge-expired-flowcharts.ts) outside
// Next.js's bundler, same reasoning as db/connection.ts's own doc comment.
// It's still perfectly safe to call from ordinary "server-only"-guarded
// app-code mutation files later (the guard only needs to exist somewhere in
// the chain when loaded into a browser bundle, and those files already
// provide it) — this file just never assumes that context itself.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * General-purpose insert for the append-only audit_logs table
 * (DATABASE_DESIGN.md §9). `actorUserId: null` is how a system-initiated
 * action (no human actor — e.g. the automatic flowchart-purge sweep) is
 * represented; never a fake/placeholder user row. Takes an already-open
 * transaction — this table is always written inside the same transaction
 * as the action it's recording, never as a separate follow-up write.
 */
export async function insertAuditLog(
  tx: Tx,
  row: {
    actorUserId: string | null;
    actionType:
      | "LOGIN"
      | "CREATE"
      | "UPDATE"
      | "SOFT_DELETE"
      | "RESTORE"
      | "STATUS_CHANGE"
      | "FILE_UPLOAD"
      | "FILE_DOWNLOAD"
      | "FILE_DELETE"
      | "EXCEL_IMPORT"
      | "EXCEL_EXPORT"
      | "APPROVE"
      | "APPROVAL_CANCEL"
      | "ACCOUNT_LOCK"
      | "ACCOUNT_DEACTIVATE"
      | "PURGE";
    targetEntity: string;
    targetRecordId: string;
    previousValue?: unknown;
    newValue?: unknown;
    sessionId?: string | null;
    sourceIp?: string | null;
  }
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: row.actorUserId,
    actionType: row.actionType,
    targetEntity: row.targetEntity,
    targetRecordId: row.targetRecordId,
    previousValue: row.previousValue ?? null,
    newValue: row.newValue ?? null,
    sessionId: row.sessionId ?? null,
    sourceIp: row.sourceIp ?? null,
  });
}
