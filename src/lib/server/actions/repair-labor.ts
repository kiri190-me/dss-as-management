"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { canDeleteQuotes } from "@/lib/auth/quote-authorization";
import { validateRepairLaborFields } from "@/lib/validation/repair-task-input";
import { saveRepairLabor, type SaveRepairLaborResult } from "@/lib/db/mutations/repair-labor";

/**
 * ============================================================================
 * 수리 작업 비용 — 서버 액션 (정책 계층)
 * ============================================================================
 * 세션 확인 → 인가 확인 → 입력 검증 → mutation. 순서가 곧 규칙이다.
 *
 * ── 🔴 고치는 권한이 견적서를 고치는 권한보다 **좁다** ──────────────────
 * 개별 견적서를 고치는 것은 그 한 장의 일이지만, 여기서 시간당 단가나 공수시간을
 * 바꾸면 **앞으로 나갈 모든 견적서의 금액이 바뀐다.** 회사가 부르는 값을 정하는
 * 자리라 영업 담당자 각자에게 맡기지 않는다 — 견적서를 지울 수 있는 사람과 같은
 * 집합(관리자 이상)으로 둔다.
 *
 * 보는 것은 견적서를 보는 사람과 같다. 견적을 내려면 어떤 작업이 얼마인지 알아야
 * 하고, 그걸 못 보게 하면 사람은 다시 Excel 을 연다.
 * ============================================================================
 */

type Forbidden = { ok: false; code: "FORBIDDEN"; message: string };

const DB_UNAVAILABLE = "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";

export type SaveRepairLaborActionResult =
  | SaveRepairLaborResult
  | Forbidden
  | { ok: false; code: "VALIDATION_ERROR"; message: string; fieldErrors: Record<string, string> };

async function resolveActor(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  const deny = (message: string) => ({
    ok: false as const,
    result: { ok: false as const, code: "FORBIDDEN" as const, message },
  });

  if (getAuthSource() !== "database") return deny("데이터베이스 저장 모드가 아닙니다.");
  const session = await readSession();
  if (!session) return deny("로그인이 필요합니다.");
  if (session.approvalStatus !== "APPROVED") return deny("계정이 아직 승인되지 않았습니다.");

  // 세션의 role 이 아니라 살아 있는 계정을 다시 읽는다 — 강등된 계정이 토큰
  // 만료 전까지 예전 권한으로 저장하는 구멍을 막는다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return deny("로그인이 필요합니다.");

  // 두 관문을 다 통과해야 한다 — 역할 정책과 관리자가 설정한 수준.
  if (!canDeleteQuotes(actingUser.role)) {
    return deny("수리 작업 비용을 고칠 권한이 없습니다. 관리자에게 문의해 주세요.");
  }
  if (!(await hasPermission(actingUser.role, "repairLabor", "MANAGE"))) {
    return deny("수리 작업 비용을 고칠 권한이 없습니다. 관리자에게 문의해 주세요.");
  }
  return { ok: true, userId: actingUser.id };
}

export async function saveRepairLaborAction(input: {
  fields: Record<string, unknown>;
}): Promise<SaveRepairLaborActionResult> {
  const actor = await resolveActor();
  if (!actor.ok) return actor.result;

  const validation = validateRepairLaborFields(input.fields ?? {});
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "입력값을 확인해 주세요.",
      fieldErrors: validation.fieldErrors,
    };
  }

  try {
    return await saveRepairLabor({ fields: validation.data, actorUserId: actor.userId });
  } catch (err) {
    console.error("saveRepairLaborAction: unexpected DB error", err);
    return { ok: false, code: "FORBIDDEN", message: DB_UNAVAILABLE };
  }
}
