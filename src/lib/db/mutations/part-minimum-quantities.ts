import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { partMinimumQuantities, parts } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { resolveEligibleActor, type Tx } from "./procedure-templates";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  validatePartMinimumQuantityEntries,
  type PartMinimumQuantityEntry,
} from "@/lib/validation/part-minimum-quantity-input";
import {
  UNIT_PRICE_FIELD_ERROR_PREFIX,
  validatePartUnitPriceEntries,
  type PartUnitPriceEntry,
} from "@/lib/validation/part-unit-price-input";
import { applyOneUnitPrice } from "./part-unit-prices";
import { stockOwnerLabels } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 한계수량 저장 — 소유자 넷을 한 번에
 * ============================================================================
 * mutations/inventory.ts 의 updatePart 와 mutations/notification-settings.ts 의
 * saveNotificationSettings 를 본보기로 삼았고, 거기서 이미 내려진 판단들을 그대로
 * 가져왔다.
 *
 *  1) **한 트랜잭션.** 화면이 소유자 넷을 한 번에 편집하므로, 셋째에서 막혔는데
 *     앞의 둘만 저장되는 일은 없어야 한다. 기준이 반쯤 적용된 상태는 어느 소유자에
 *     알림이 걸려 있는지 화면과 DB 가 서로 다른 말을 하게 만든다.
 *  2) **트랜잭션 안에서 행위자를 다시 읽는다.** 세션이 만들어진 뒤 역할이
 *     내려갔거나 계정이 잠겼을 수 있다(resolveEligibleActor — 재고 mutation 들이
 *     쓰는 바로 그 함수).
 *  3) **권한은 부품 정보를 고치는 것과 같다** — `inventory.parts` WRITE.
 *     한계수량은 그 부품을 어떻게 관리할지 정하는 값이라, 품명·도번을 고칠 수
 *     있는 사람과 같은 판정이 맞다. 화면에서도 같은 능력(capabilities.parts)으로
 *     입력칸을 감추지만, 감추는 것은 안내이지 차단이 아니다.
 *  4) **화면이 보낸 값을 그대로 믿지 않는다.** 화면을 거치지 않고 이 mutation 을
 *     부를 수 있으므로 validation 을 여기서 한 번 더 태운다 — 화면과 같은 순수
 *     함수를 부르므로 규칙이 두 벌이 되지 않는다.
 *  5) **🔴 빈 값은 0 으로 저장하지 않고 행을 지운다.** "정하지 않음"과 "0" 은
 *     다른 뜻이다(schema/part-minimum-quantities.ts 머리말). 0 으로 바꿔 저장하면
 *     "정하지 않음"을 다시 표현할 방법이 사라진다.
 *  6) **바뀌지 않은 칸은 쓰지 않는다.** 저장을 눌렀다는 이유만으로 updated_by /
 *     updated_at 이 갈아엎어지면, "누가 이 기준을 정했나"를 물었을 때 실제로 정한
 *     사람이 아니라 마지막으로 저장 단추를 누른 사람이 나온다.
 *
 * ── 왜 version(낙관적 잠금)을 받지 않는가 ───────────────────────────────
 * saveNotificationSettings 와 같다. 이 표는 부품의 상태가 아니라 **설정**이고,
 * 한 화면에서 넷을 함께 편집한다. 부품 자체의 version 을 쓰면 한계수량을 저장할
 * 때마다 부품 수정 대화창의 토큰이 늙어 엉뚱한 CONFLICT 가 난다(그쪽은 품명을
 * 고치는 일이고 이쪽은 기준을 고치는 일이라 서로를 막을 이유가 없다). 대신 부품
 * 행을 FOR UPDATE 로 잡아, 저장하는 동안 그 부품이 휴지통으로 넘어가지 않는 것만
 * 보장한다.
 * ============================================================================
 */

export type SavePartMinimumQuantitiesResult =
  | { ok: true; changedCount: number }
  | {
      ok: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT";
      message: string;
      /** 소유자 코드 → 그 칸에 붙일 문장. 형식 오류일 때만 실린다. */
      fieldErrors?: Record<string, string>;
    };

/**
 * 거절을 트랜잭션 밖으로 던지기 위한 신호. 콜백에서 그냥 반환하면 트랜잭션이
 * **커밋된다**(saveNotificationSettings 의 SaveRejected 와 같은 이유).
 */
class SaveRejected extends Error {
  constructor(readonly result: Extract<SavePartMinimumQuantitiesResult, { ok: false }>) {
    super(result.message);
    this.name = "SaveRejected";
  }
}

/**
 * 재고 mutation 들이 쓰는 그 함수를 그대로 부른다 — 계정이 지워졌는지·잠겼는지·
 * 승인됐는지를 한 곳에서만 판정하기 위한 것이다. 실패는 이 파일의 거절 신호로
 * 바꿔 던진다(저쪽 오류 종류가 이 파일 밖으로 새지 않게).
 */
async function requireActor(tx: Tx, actorUserId: string) {
  try {
    return await resolveEligibleActor(tx, actorUserId);
  } catch {
    throw new SaveRejected({ ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." });
  }
}

export type SavePartMinimumQuantitiesInput = {
  partId: string;
  /** 보내지 않은 소유자는 건드리지 않는다(= 지금 값 그대로). */
  entries: unknown;
  actorUserId: string;
};

export async function savePartMinimumQuantities(
  input: SavePartMinimumQuantitiesInput
): Promise<SavePartMinimumQuantitiesResult> {
  // 단가를 함께 받지 않는 옛 진입점. 아래 savePartOwnerSettings 를 그대로 부른다 —
  // 규칙을 두 벌로 두지 않기 위해서다.
  return savePartOwnerSettings({
    partId: input.partId,
    entries: input.entries,
    unitPriceEntries: undefined,
    actorUserId: input.actorUserId,
  });
}

function prefixPriceFieldErrors(fieldErrors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([key, message]) => [
      `${UNIT_PRICE_FIELD_ERROR_PREFIX}${key}`,
      message,
    ])
  );
}

export type SavePartOwnerSettingsInput = {
  partId: string;
  /** 한계수량. 보내지 않은 소유자는 건드리지 않는다(= 지금 값 그대로). */
  entries: unknown;
  /**
   * 소유구분별 단가. **undefined 면 단가를 아예 건드리지 않는다** — 빈 배열과
   * 다른 뜻이다(빈 배열도 "고칠 칸이 없다"이긴 하지만, undefined 는 "이 저장은
   * 단가와 무관하다"는 신호다). 옛 진입점이 이 값을 주지 않는다.
   */
  unitPriceEntries?: unknown;
  actorUserId: string;
};

/**
 * ============================================================================
 * 한계수량과 단가를 **한 트랜잭션에** 저장한다
 * ============================================================================
 * 화면(부품 상세의 소유구분 표)이 둘을 한 표에서 편집하고 저장 단추도 하나다.
 * 트랜잭션을 따로 열면 "한계수량은 저장됐는데 단가는 안 된" 반쪽 상태가
 * 만들어지고, 그때 화면과 DB 는 서로 다른 말을 한다 — 이 파일 머리말의 1번이
 * 소유자 넷에 대해 말한 것과 같은 이유다.
 *
 * 행위자 판정 · 권한(`inventory.parts` WRITE) · 부품 잠금은 여기서 **한 번만**
 * 한다. 단가에 다른 권한을 두지 않는 이유는 한계수량과 같다 — 둘 다 그 부품을
 * 어떻게 다룰지 정하는 값이라, 품명·도번을 고칠 수 있는 사람과 같은 판정이 맞다.
 *
 * 검증은 **쓰기 전에 둘 다** 끝낸다. 한계수량을 저장하다가 단가에서 형식 오류를
 * 만나면 트랜잭션이 되돌려지긴 하지만, 그 전에 감사 로그까지 썼다가 되돌리는
 * 것보다 아예 시작하지 않는 편이 낫다.
 * ============================================================================
 */
export async function savePartOwnerSettings(
  input: SavePartOwnerSettingsInput
): Promise<SavePartMinimumQuantitiesResult> {
  const validated = validatePartMinimumQuantityEntries(input.entries);
  if (!validated.ok) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "한계수량 입력을 확인해 주세요.",
      fieldErrors: validated.fieldErrors,
    };
  }

  let priceEntries: PartUnitPriceEntry[] = [];
  if (input.unitPriceEntries !== undefined) {
    const validatedPrices = validatePartUnitPriceEntries(input.unitPriceEntries);
    if (!validatedPrices.ok) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "단가 입력을 확인해 주세요.",
        // 🔴 키에 접두사를 붙인다. 두 검증 모두 **소유자 코드**를 키로 쓰기
        // 때문에(한 표에서 편집하기 전에는 겹칠 일이 없었다), 그대로 두면 단가가
        // 틀렸는데 빨간 글씨가 한계수량 칸 밑에 붙는다. 화면은 이 접두사로
        // 어느 칸인지 가른다.
        fieldErrors: prefixPriceFieldErrors(validatedPrices.fieldErrors),
      };
    }
    priceEntries = validatedPrices.data;
  }

  if (validated.data.length === 0 && priceEntries.length === 0) {
    return { ok: true, changedCount: 0 };
  }

  try {
    return await db.transaction(async (tx): Promise<SavePartMinimumQuantitiesResult> => {
      const actor = await requireActor(tx, input.actorUserId);

      if (!(await hasPermission(actor, "inventory.parts", "WRITE"))) {
        throw new SaveRejected({ ok: false, code: "FORBIDDEN", message: "수정 권한이 없습니다." });
      }

      // 부품 행을 잡아 둔다 — 저장하는 동안 휴지통으로 넘어가지 않게(softDeletePart
      // 도 같은 행을 FOR UPDATE 로 잡는다). version 은 읽지도 올리지도 않는다.
      const [part] = await tx
        .select({ id: parts.id, partName: parts.partName })
        .from(parts)
        .where(and(eq(parts.id, input.partId), eq(parts.isDeleted, false)))
        .for("update");
      if (!part) {
        throw new SaveRejected({ ok: false, code: "NOT_FOUND", message: "해당 부품을 찾을 수 없습니다." });
      }

      let changedCount = 0;
      for (const entry of validated.data) {
        changedCount += await applyOneOwner(tx, {
          partId: part.id,
          partName: part.partName,
          entry,
          actorUserId: actor.id,
        });
      }
      for (const entry of priceEntries) {
        changedCount += await applyOneUnitPrice(tx, {
          partId: part.id,
          partName: part.partName,
          entry,
          actorUserId: actor.id,
        });
      }

      return { ok: true, changedCount };
    });
  } catch (err) {
    if (err instanceof SaveRejected) return err.result;
    throw err;
  }
}

/** 소유자 한 칸분의 저장. 지우기·넣기·그대로 두기 셋 중 하나다. */
async function applyOneOwner(
  tx: Tx,
  params: { partId: string; partName: string; entry: PartMinimumQuantityEntry; actorUserId: string }
): Promise<number> {
  const { owner, minimumQuantity } = params.entry;

  const [previous] = await tx
    .select({ id: partMinimumQuantities.id, minimumQuantity: partMinimumQuantities.minimumQuantity })
    .from(partMinimumQuantities)
    .where(and(eq(partMinimumQuantities.partId, params.partId), eq(partMinimumQuantities.owner, owner)));

  // ── 비운 칸 = 한계 없음 → 행을 지운다(0 으로 저장하지 않는다) ──────────
  if (minimumQuantity === null) {
    if (!previous) return 0;

    await tx.delete(partMinimumQuantities).where(eq(partMinimumQuantities.id, previous.id));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      // 행은 지우지만 업무 자료가 사라진 것이 아니라 기준을 없앤 것이므로
      // UPDATE 로 남긴다 — SOFT_DELETE/PURGE 는 "자료가 없어졌다"는 뜻이라
      // 여기서는 오해를 만든다(notification-settings 와 같은 판단).
      actionType: "UPDATE",
      targetEntity: "part_minimum_quantities",
      targetRecordId: previous.id,
      previousValue: {
        partId: params.partId,
        partName: params.partName,
        owner,
        ownerLabel: stockOwnerLabels[owner],
        minimumQuantity: previous.minimumQuantity,
      },
      newValue: {
        partId: params.partId,
        owner,
        minimumQuantity: null,
        cleared: true,
      },
    });
    return 1;
  }

  // ── 바뀌지 않았으면 쓰지 않는다 ────────────────────────────────────────
  if (previous?.minimumQuantity === minimumQuantity) return 0;

  const [saved] = await tx
    .insert(partMinimumQuantities)
    .values({
      partId: params.partId,
      owner,
      minimumQuantity,
      updatedBy: params.actorUserId,
    })
    .onConflictDoUpdate({
      target: [partMinimumQuantities.partId, partMinimumQuantities.owner],
      set: { minimumQuantity, updatedBy: params.actorUserId, updatedAt: new Date() },
    })
    .returning({ id: partMinimumQuantities.id });

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: previous ? "UPDATE" : "CREATE",
    targetEntity: "part_minimum_quantities",
    targetRecordId: saved.id,
    // 행이 없던 상태의 "이전 값"은 null 이다 — 기본값이 따로 없고, 정하지
    // 않았다는 것이 그때 실제로 통하던 상태다.
    previousValue: {
      partId: params.partId,
      partName: params.partName,
      owner,
      ownerLabel: stockOwnerLabels[owner],
      minimumQuantity: previous?.minimumQuantity ?? null,
    },
    newValue: { partId: params.partId, owner, minimumQuantity },
  });
  return 1;
}
