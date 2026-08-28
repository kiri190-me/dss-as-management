"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  savePartOwnerSettings,
  type SavePartMinimumQuantitiesResult,
} from "@/lib/db/mutations/part-minimum-quantities";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";

/**
 * 한계수량 저장 Server Action. actions/inventory.ts 와 같은 층위다 — 세션을 풀고,
 * 입력의 **모양**만 확인하고, 넘기고, 예상 못 한 DB 오류를 가린다.
 *
 * 역할 판정(누가 고칠 수 있는가)과 값 검증(0 이상 정수인가)은 여기서 하지 않는다.
 * 둘 다 mutation 안에서 트랜잭션과 함께 다시 이뤄진다 — 이 파일은 "승인된 세션이
 * 실제로 있는가"까지만 본다.
 */

type Forbidden = { ok: false; code: "FORBIDDEN"; message: string };

async function resolveAuthorizedActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

async function withErrorRedaction<T extends { ok: boolean }>(label: string, run: () => Promise<T>): Promise<T | Forbidden> {
  try {
    return await run();
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error(`${label}: unexpected DB error`, { code });
    return { ok: false, code: "FORBIDDEN", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * 소유자 넷(또는 그 일부)을 **한 번에** 저장한다. 한 트랜잭션이라 반쯤 저장되는
 * 일이 없다.
 *
 * `minimumQuantity` 가 빈 문자열이거나 null 이면 "한계 없음"이고, 그 줄은 저장되지
 * 않고 지워진다 — 0 으로 바뀌지 않는다(validation/part-minimum-quantity-input.ts).
 */
export async function savePartMinimumQuantitiesAction(input: {
  partId: string;
  entries: unknown;
  /**
   * 소유구분별 단가. 화면이 한계수량과 **한 표에서** 편집하고 저장 단추도 하나라
   * 같은 요청에 실어 보낸다 — 따로 보내면 한쪽만 저장되는 상태가 만들어진다
   * (mutations/part-minimum-quantities.ts 의 savePartOwnerSettings).
   *
   * 넘기지 않으면 단가는 건드리지 않는다. 이 인자가 생기기 전에 이 액션을 부르던
   * 코드가 그대로 동작한다.
   */
  unitPriceEntries?: unknown;
}): Promise<SavePartMinimumQuantitiesResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.partId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("savePartMinimumQuantitiesAction", () =>
    savePartOwnerSettings({
      partId: input.partId,
      entries: input.entries,
      unitPriceEntries: input.unitPriceEntries,
      actorUserId: actorCheck.userId,
    })
  );
}
