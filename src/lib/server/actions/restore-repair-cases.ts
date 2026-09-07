"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isValidExpectedVersion, isValidRepairCaseId } from "@/lib/validation/repair-case-update-input";
import { restoreRepairCase } from "@/lib/db/mutations/repair-cases";

const MAX_BULK_RESTORE_ITEMS = 200;

export type RestoreRepairCasesItem = { id: string; expectedVersion: number };

export type RestoreRepairCasesItemResult = {
  id: string;
  ok: boolean;
  code?: "NOT_FOUND" | "CONFLICT" | "DATABASE_UNAVAILABLE";
  message?: string;
};

export type RestoreRepairCasesActionResultCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "DATABASE_UNAVAILABLE";

export type RestoreRepairCasesActionResult =
  | { ok: true; results: RestoreRepairCasesItemResult[] }
  | { ok: false; code: RestoreRepairCasesActionResultCode; message: string };

/**
 * Server Action: restore (un-delete) for /repair-cases' 휴지통 tab,
 * SUPER_ADMIN/ADMIN only — same loop-sequentially, one-transaction-per-case,
 * every-item-reports-its-own-outcome shape as bulk-delete-repair-cases.ts,
 * for the same reasons (a large selection never opens many concurrent
 * transactions at once; one stale/conflicting case never rolls back the
 * rest of the batch; nothing is ever silently dropped). Single-item restore
 * is simply a 1-item call to this same action — no separate code path.
 *
 * Every gate below is independent of what the UI happened to render — same
 * ordering discipline as bulk-delete-repair-cases.ts.
 */
export async function restoreRepairCasesAction(input: {
  items: RestoreRepairCasesItem[];
}): Promise<RestoreRepairCasesActionResult> {
  const writeSource = getRepairCaseWriteSource();
  if (writeSource !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  if (getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "서버 설정 오류로 복원할 수 없습니다. 관리자에게 문의해 주세요.",
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
    return { ok: false, code: "FORBIDDEN", message: "A/S 접수 건 복원 권한이 없습니다." };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "복원할 접수 건을 선택해 주세요." };
  }
  if (input.items.length > MAX_BULK_RESTORE_ITEMS) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `한 번에 최대 ${MAX_BULK_RESTORE_ITEMS}건까지 복원할 수 있습니다.`,
    };
  }
  for (const item of input.items) {
    if (!isValidRepairCaseId(item.id) || !isValidExpectedVersion(item.expectedVersion)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "선택한 접수 건 정보를 확인할 수 없습니다." };
    }
  }

  const results: RestoreRepairCasesItemResult[] = [];
  for (const item of input.items) {
    try {
      const result = await restoreRepairCase({
        id: item.id,
        expectedVersion: item.expectedVersion,
        actorUserId: actingUser.id,
      });
      results.push(
        result.ok
          ? { id: item.id, ok: true }
          : { id: item.id, ok: false, code: result.code, message: result.message }
      );
    } catch (err) {
      // Never forward the raw error (may reference Postgres internals) to
      // the browser — same discipline as bulk-delete-repair-cases.ts. One
      // case's unexpected failure must not abort the rest of the batch.
      const code = isPgErrorLike(err) ? err.code : undefined;
      console.error("restoreRepairCasesAction: unexpected DB error", { id: item.id, code });
      results.push({
        id: item.id,
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "일시적으로 복원할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
  }

  return { ok: true, results };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
