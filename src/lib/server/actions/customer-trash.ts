"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isValidCustomerId, isValidExpectedUpdatedAt } from "@/lib/validation/customer-update-input";
import {
  permanentlyDeleteCustomer,
  restoreCustomer,
  softDeleteCustomer,
  type CustomerTrashResult,
} from "@/lib/db/mutations/customers-trash";

const MAX_BULK_ITEMS = 200;
const MAX_REASON_LENGTH = 2000;

export type CustomerTrashItem = { id: string; expectedUpdatedAt: string };

export type CustomerTrashItemResult = {
  id: string;
  ok: boolean;
  code?: "NOT_FOUND" | "CONFLICT" | "REFERENCED" | "NAME_TAKEN" | "DATABASE_UNAVAILABLE";
  message?: string;
  /** 이 건과 함께 움직인 End-User 수. 성공했을 때만 채워진다. */
  endUserCount?: number;
};

export type CustomerTrashActionResultCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "DATABASE_UNAVAILABLE";

export type CustomerTrashActionResult =
  | { ok: true; results: CustomerTrashItemResult[] }
  | { ok: false; code: CustomerTrashActionResultCode; message: string };

/**
 * ============================================================================
 * 고객사 삭제·복원·완전삭제 서버 액션
 * ============================================================================
 * 접수 건 쪽 bulk-delete/restore/permanently-delete 세 액션과 같은 모양이다:
 * 한 건씩 순서대로, 건마다 자기 트랜잭션, 건마다 자기 결과. 여러 건을 골라도
 * 동시에 트랜잭션을 잔뜩 열지 않고, 한 건이 어긋나도 나머지가 통째로 되돌려
 * 지지 않으며, 조용히 빠지는 건이 없다. 한 건만 지우는 것은 1건짜리 호출일
 * 뿐 별도 경로가 아니다.
 *
 * 아래 모든 관문은 화면이 무엇을 그렸는지와 무관하게 여기서 다시 본다 —
 * 버튼을 감추는 것은 편의이지 경계가 아니다.
 * ============================================================================
 */

type Gate =
  | { ok: true; actorUserId: string }
  | { ok: false; code: CustomerTrashActionResultCode; message: string };

/** 세 액션이 똑같이 통과해야 하는 관문. 한 곳에 적어야 한 곳만 느슨해지지 않는다. */
async function passGate(): Promise<Gate> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }

  const session = await readSession();
  if (!session) return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };

  if (!(await hasPermission(actingUser, "customers.lifecycle", "MANAGE"))) {
    return { ok: false, code: "FORBIDDEN", message: "고객사를 삭제하거나 복원할 권한이 없습니다." };
  }

  return { ok: true, actorUserId: actingUser.id };
}

function validateItems(
  items: CustomerTrashItem[] | undefined,
  emptyMessage: string
): { ok: true } | { ok: false; code: "VALIDATION_ERROR"; message: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: emptyMessage };
  }
  if (items.length > MAX_BULK_ITEMS) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `한 번에 최대 ${MAX_BULK_ITEMS}건까지 처리할 수 있습니다.`,
    };
  }
  for (const item of items) {
    if (!isValidCustomerId(item?.id) || !isValidExpectedUpdatedAt(item?.expectedUpdatedAt)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "선택한 고객사 정보를 확인할 수 없습니다." };
    }
  }
  return { ok: true };
}

/**
 * 건마다 실행하고 건마다 결과를 담는다. 예기치 못한 DB 오류는 절대 그대로
 * 브라우저로 넘기지 않고(Postgres 내부를 드러낼 수 있다), 그 한 건만
 * 실패로 적은 뒤 나머지를 계속 처리한다.
 */
async function runEach(
  items: CustomerTrashItem[],
  label: string,
  run: (item: CustomerTrashItem) => Promise<CustomerTrashResult>
): Promise<CustomerTrashItemResult[]> {
  const results: CustomerTrashItemResult[] = [];
  for (const item of items) {
    try {
      const result = await run(item);
      results.push(
        result.ok
          ? { id: item.id, ok: true, endUserCount: result.endUserCount }
          : { id: item.id, ok: false, code: result.code, message: result.message }
      );
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
      console.error(`${label}: unexpected DB error`, { id: item.id, code });
      results.push({
        id: item.id,
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
  }
  return results;
}

/**
 * 고객사를 휴지통으로 보낸다. 삭제 사유는 선택 입력이다 — 되돌릴 수 있는
 * 조작이므로, 접수 건 일괄 삭제와 같은 기준을 쓴다.
 */
export async function deleteCustomersAction(input: {
  items: CustomerTrashItem[];
  reason?: string | null;
}): Promise<CustomerTrashActionResult> {
  const gate = await passGate();
  if (!gate.ok) return gate;

  const validated = validateItems(input.items, "삭제할 고객사를 선택해 주세요.");
  if (!validated.ok) return validated;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "삭제 사유가 너무 깁니다." };
  }

  const results = await runEach(input.items, "deleteCustomersAction", (item) =>
    softDeleteCustomer({
      customerId: item.id,
      expectedUpdatedAt: item.expectedUpdatedAt,
      actorUserId: gate.actorUserId,
      reason: reason || null,
    })
  );

  return { ok: true, results };
}

/** 휴지통의 고객사를 되살린다. 딸려 갔던 End-User·담당자도 함께 돌아온다. */
export async function restoreCustomersAction(input: {
  items: CustomerTrashItem[];
}): Promise<CustomerTrashActionResult> {
  const gate = await passGate();
  if (!gate.ok) return gate;

  const validated = validateItems(input.items, "복원할 고객사를 선택해 주세요.");
  if (!validated.ok) return validated;

  const results = await runEach(input.items, "restoreCustomersAction", (item) =>
    restoreCustomer({
      customerId: item.id,
      expectedUpdatedAt: item.expectedUpdatedAt,
      actorUserId: gate.actorUserId,
    })
  );

  return { ok: true, results };
}

/**
 * 15일을 기다리지 않고 즉시 완전삭제한다.
 *
 * 삭제 사유가 **필수**다 — 되돌릴 수 없는 조작에는 이유가 남아야 한다는
 * 규칙을 접수 건·흐름도 영구 삭제가 이미 같은 방식으로 지키고 있다.
 */
export async function permanentlyDeleteCustomersAction(input: {
  items: CustomerTrashItem[];
  reason: string;
}): Promise<CustomerTrashActionResult> {
  const gate = await passGate();
  if (!gate.ok) return gate;

  const validated = validateItems(input.items, "완전 삭제할 고객사를 선택해 주세요.");
  if (!validated.ok) return validated;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유를 입력해 주세요." };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유가 너무 깁니다." };
  }

  const results = await runEach(input.items, "permanentlyDeleteCustomersAction", (item) =>
    permanentlyDeleteCustomer({
      customerId: item.id,
      expectedUpdatedAt: item.expectedUpdatedAt,
      actorUserId: gate.actorUserId,
      reason,
    })
  );

  return { ok: true, results };
}
