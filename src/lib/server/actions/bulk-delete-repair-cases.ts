"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isValidExpectedVersion, isValidRepairCaseId } from "@/lib/validation/repair-case-update-input";
import { softDeleteRepairCase } from "@/lib/db/mutations/repair-cases";

const MAX_BULK_DELETE_ITEMS = 200;
const MAX_REASON_LENGTH = 500;

export type BulkDeleteRepairCasesItem = { id: string; expectedVersion: number };

export type BulkDeleteRepairCasesItemResult = {
  id: string;
  ok: boolean;
  code?: "NOT_FOUND" | "CONFLICT" | "DATABASE_UNAVAILABLE";
  message?: string;
};

export type BulkDeleteRepairCasesActionResultCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "DATABASE_UNAVAILABLE";

export type BulkDeleteRepairCasesActionResult =
  | { ok: true; results: BulkDeleteRepairCasesItemResult[] }
  | { ok: false; code: BulkDeleteRepairCasesActionResultCode; message: string };

/**
 * Server Action: bulk soft-delete for /repair-cases (전체 A/S 현황),
 * SUPER_ADMIN/ADMIN only. Deliberately loops softDeleteRepairCase()
 * sequentially — one repair case per DB transaction (see that function's own
 * doc comment) — rather than Promise.all, so a large selection doesn't open
 * many concurrent transactions against the pool at once, and rather than one
 * shared transaction, so a single stale/conflicting case can never roll back
 * every other valid deletion in the same batch. Every item's outcome
 * (success or a specific failure code/message) is reported back — never
 * silently dropped — so the caller can tell the user exactly which intake
 * numbers were not deleted and why.
 *
 * Every gate below is independent of what the UI happened to render — same
 * ordering discipline as create-repair-case.ts/update-repair-case.ts.
 */
export async function bulkDeleteRepairCasesAction(input: {
  items: BulkDeleteRepairCasesItem[];
  reason: string | null;
}): Promise<BulkDeleteRepairCasesActionResult> {
  const writeSource = getRepairCaseWriteSource();
  if (writeSource !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  if (getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "서버 설정 오류로 삭제할 수 없습니다. 관리자에게 문의해 주세요.",
    };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  if (!(await hasPermission(actingUser, "repairCases.lifecycle", "MANAGE"))) {
    return { ok: false, code: "FORBIDDEN", message: "A/S 접수 건 삭제 권한이 없습니다." };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "삭제할 접수 건을 선택해 주세요." };
  }
  if (input.items.length > MAX_BULK_DELETE_ITEMS) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `한 번에 최대 ${MAX_BULK_DELETE_ITEMS}건까지 삭제할 수 있습니다.`,
    };
  }
  for (const item of input.items) {
    if (!isValidRepairCaseId(item.id) || !isValidExpectedVersion(item.expectedVersion)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "선택한 접수 건 정보를 확인할 수 없습니다." };
    }
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "삭제 사유가 너무 깁니다." };
  }

  const results: BulkDeleteRepairCasesItemResult[] = [];
  for (const item of input.items) {
    try {
      const result = await softDeleteRepairCase({
        id: item.id,
        expectedVersion: item.expectedVersion,
        actorUserId: actingUser.id,
        reason: reason || null,
      });
      results.push(
        result.ok
          ? { id: item.id, ok: true }
          : { id: item.id, ok: false, code: result.code, message: result.message }
      );
    } catch (err) {
      // Never forward the raw error (may reference Postgres internals) to
      // the browser — same discipline as create-repair-case.ts/update-
      // repair-case.ts. One case's unexpected failure must not abort the
      // rest of the batch.
      const code = isPgErrorLike(err) ? err.code : undefined;
      console.error("bulkDeleteRepairCasesAction: unexpected DB error", { id: item.id, code });
      results.push({
        id: item.id,
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "일시적으로 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
  }

  return { ok: true, results };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
