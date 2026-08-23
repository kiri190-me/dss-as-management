"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  permanentlyDeletePart,
  restorePart,
  softDeletePart,
  type PartTrashResult,
} from "@/lib/db/mutations/inventory";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";

const MAX_BULK_ITEMS = 200;
const MAX_REASON_LENGTH = 2000;

/**
 * 부품 한 건. 다른 마스터 화면은 updated_at으로 낙관적 동시성을 보지만
 * parts에는 version 컬럼이 있어 그것을 쓴다 — 재고 mutation 전체가 이미
 * version 규약이다(updatePart/receiveStock/…).
 */
export type PartTrashItem = { id: string; expectedVersion: number };

export type PartTrashItemResult = {
  id: string;
  ok: boolean;
  code?: string;
  message?: string;
};

export type PartTrashActionResult =
  | { ok: true; results: PartTrashItemResult[] }
  | { ok: false; code: "FORBIDDEN" | "VALIDATION_ERROR"; message: string };

/**
 * ============================================================================
 * 부품 삭제·복원·완전삭제 서버 액션
 * ============================================================================
 * 한 건씩 순서대로, 건마다 자기 트랜잭션, 건마다 자기 결과 — 고객사·제품
 * 모델 쪽 액션과 같은 모양이라 화면은 같은 훅(useMasterDataTrash)을 그대로
 * 쓴다.
 *
 * 다만 **권한은 여기서 보지 않는다.** 재고 모듈은 mutation이 트랜잭션 안에서
 * 행위자를 다시 읽고 hasPermission으로 판정한다(inventory.ts). 이 파일은
 * 다른 재고 액션들과 똑같이 "승인된 세션이 있는가"만 확인하고 넘긴다 —
 * 여기서 한 번 더 검사하면 판정이 두 곳에 생기고, 정책이 바뀔 때 한쪽만
 * 고쳐지는 그 익숙한 어긋남이 만들어진다.
 * ============================================================================
 */
async function resolveActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: PartTrashActionResult }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function validateItems(
  items: PartTrashItem[] | undefined,
  emptyMessage: string
): { ok: true } | { ok: false; result: PartTrashActionResult } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, result: { ok: false, code: "VALIDATION_ERROR", message: emptyMessage } };
  }
  if (items.length > MAX_BULK_ITEMS) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `한 번에 최대 ${MAX_BULK_ITEMS}건까지 처리할 수 있습니다.`,
      },
    };
  }
  for (const item of items) {
    if (!isValidUuid(item?.id) || !Number.isInteger(item?.expectedVersion)) {
      return { ok: false, result: { ok: false, code: "VALIDATION_ERROR", message: "선택한 부품 정보를 확인할 수 없습니다." } };
    }
  }
  return { ok: true };
}

/**
 * 건마다 실행하고 건마다 결과를 담는다. 예기치 못한 오류는 그대로 브라우저로
 * 넘기지 않고(Postgres 내부를 드러낼 수 있다) 그 한 건만 실패로 적는다.
 */
async function runEach(
  items: PartTrashItem[],
  label: string,
  run: (item: PartTrashItem) => Promise<PartTrashResult>
): Promise<PartTrashItemResult[]> {
  const results: PartTrashItemResult[] = [];
  for (const item of items) {
    try {
      const result = await run(item);
      results.push(result.ok ? { id: item.id, ok: true } : { id: item.id, ok: false, code: result.code, message: result.message });
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

/** 부품을 휴지통으로 보낸다. 되돌릴 수 있는 조작이므로 사유는 선택 입력이다. */
export async function deletePartsAction(input: {
  items: PartTrashItem[];
  reason: string | null;
}): Promise<PartTrashActionResult> {
  const actor = await resolveActorId();
  if (!actor.ok) return actor.result;

  const validated = validateItems(input.items, "삭제할 부품을 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "삭제 사유가 너무 깁니다." };
  }

  const results = await runEach(input.items, "deletePartsAction", (item) =>
    softDeletePart({
      partId: item.id,
      expectedVersion: item.expectedVersion,
      actorUserId: actor.userId,
      reason: reason || null,
    })
  );

  return { ok: true, results };
}

/** 휴지통의 부품을 되살린다. */
export async function restorePartsAction(input: { items: PartTrashItem[] }): Promise<PartTrashActionResult> {
  const actor = await resolveActorId();
  if (!actor.ok) return actor.result;

  const validated = validateItems(input.items, "복원할 부품을 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const results = await runEach(input.items, "restorePartsAction", (item) =>
    restorePart({ partId: item.id, expectedVersion: item.expectedVersion, actorUserId: actor.userId })
  );

  return { ok: true, results };
}

/** 15일을 기다리지 않고 즉시 완전삭제한다. 되돌릴 수 없으므로 사유가 필수다. */
export async function permanentlyDeletePartsAction(input: {
  items: PartTrashItem[];
  reason: string;
}): Promise<PartTrashActionResult> {
  const actor = await resolveActorId();
  if (!actor.ok) return actor.result;

  const validated = validateItems(input.items, "완전 삭제할 부품을 선택해 주세요.");
  if (!validated.ok) return validated.result;

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유를 입력해 주세요." };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "완전 삭제 사유가 너무 깁니다." };
  }

  const results = await runEach(input.items, "permanentlyDeletePartsAction", (item) =>
    permanentlyDeletePart({
      partId: item.id,
      expectedVersion: item.expectedVersion,
      actorUserId: actor.userId,
      reason,
    })
  );

  return { ok: true, results };
}
