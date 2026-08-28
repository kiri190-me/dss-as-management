import "server-only";
import { and, eq } from "drizzle-orm";
import { partUnitPrices } from "../schema";
import { insertAuditLog } from "./audit-logs";
import type { Tx } from "./procedure-templates";
import type { PartUnitPriceEntry } from "@/lib/validation/part-unit-price-input";
import { stockOwnerLabels } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 단가 저장 — 소유자 한 칸분
 * ============================================================================
 * mutations/part-minimum-quantities.ts 의 applyOneOwner 와 **같은 모양**이고, 그
 * 파일에 적힌 판단들이 그대로 적용된다:
 *
 *  · **🔴 빈 값은 0 으로 저장하지 않고 행을 지운다.** "정하지 않음"과 "0원(무상)"은
 *    다른 뜻이다(schema/part-unit-prices.ts 머리말). 0 으로 바꿔 저장하면
 *    견적서가 정하지 않은 부품을 0원으로 청구하게 된다.
 *  · **바뀌지 않은 칸은 쓰지 않는다.** 저장을 눌렀다는 이유만으로 updated_by /
 *    updated_at 이 갈아엎어지면, "누가 이 단가를 정했나"를 물었을 때 실제로 정한
 *    사람이 아니라 마지막으로 저장 단추를 누른 사람이 나온다.
 *  · 행을 지울 때도 감사는 **UPDATE** 로 남긴다 — SOFT_DELETE/PURGE 는 "자료가
 *    없어졌다"는 뜻이라 여기서는 오해를 만든다.
 *
 * ── 이 파일에는 트랜잭션도 권한 검사도 없다 ─────────────────────────────
 * 일부러다. 한계수량과 **같은 저장 단추**에서 함께 저장되므로
 * (components/inventory 의 소유구분 표), 트랜잭션을 따로 열면 "한계수량은
 * 저장됐는데 단가는 안 된" 반쪽 상태가 만들어진다. 부르는 쪽
 * (mutations/part-minimum-quantities.ts 의 savePartOwnerSettings)이 트랜잭션과
 * 행위자 판정, 권한(`inventory.parts` WRITE), 부품 잠금을 이미 마친 뒤 이 함수를
 * 부른다 — 그 자리에서 하는 검사를 여기서 두 번 하지 않는다.
 * ============================================================================
 */

/**
 * 소유자 한 칸분의 저장. 지우기·넣기·그대로 두기 셋 중 하나이고, 실제로 쓴
 * 칸의 수(0 또는 1)를 돌려준다.
 */
export async function applyOneUnitPrice(
  tx: Tx,
  params: { partId: string; partName: string; entry: PartUnitPriceEntry; actorUserId: string }
): Promise<number> {
  const { owner, unitPrice } = params.entry;

  const [previous] = await tx
    .select({ id: partUnitPrices.id, unitPrice: partUnitPrices.unitPrice })
    .from(partUnitPrices)
    .where(and(eq(partUnitPrices.partId, params.partId), eq(partUnitPrices.owner, owner)));

  // ── 비운 칸 = 정하지 않음 → 행을 지운다(0 으로 저장하지 않는다) ────────
  if (unitPrice === null) {
    if (!previous) return 0;

    await tx.delete(partUnitPrices).where(eq(partUnitPrices.id, previous.id));
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "part_unit_prices",
      targetRecordId: previous.id,
      previousValue: {
        partId: params.partId,
        partName: params.partName,
        owner,
        ownerLabel: stockOwnerLabels[owner],
        unitPrice: previous.unitPrice,
      },
      newValue: { partId: params.partId, owner, unitPrice: null, cleared: true },
    });
    return 1;
  }

  // ── 바뀌지 않았으면 쓰지 않는다 ────────────────────────────────────────
  //
  // ⚠️ 문자열끼리 비교하지 않는다. DB 는 numeric(15,2) 를 "125000.00" 으로
  // 돌려주는데 사람은 "125000" 이라고 친다 — 글자로 대면 늘 다르다고 나와서,
  // 저장할 때마다 updated_by 가 갈아엎어지고 감사 로그에 값이 같은 UPDATE 가
  // 쌓인다. 원화 금액 범위에서 Number 비교는 안전하다(2^53 보다 한참 작다).
  if (previous && Number(previous.unitPrice) === Number(unitPrice)) return 0;

  const [saved] = await tx
    .insert(partUnitPrices)
    .values({ partId: params.partId, owner, unitPrice, updatedBy: params.actorUserId })
    .onConflictDoUpdate({
      target: [partUnitPrices.partId, partUnitPrices.owner],
      set: { unitPrice, updatedBy: params.actorUserId, updatedAt: new Date() },
    })
    .returning({ id: partUnitPrices.id });

  await insertAuditLog(tx, {
    actorUserId: params.actorUserId,
    actionType: previous ? "UPDATE" : "CREATE",
    targetEntity: "part_unit_prices",
    targetRecordId: saved.id,
    // 행이 없던 상태의 "이전 값"은 null 이다 — 기본값이 따로 없고, 정하지
    // 않았다는 것이 그때 실제로 통하던 상태다.
    previousValue: {
      partId: params.partId,
      partName: params.partName,
      owner,
      ownerLabel: stockOwnerLabels[owner],
      unitPrice: previous?.unitPrice ?? null,
    },
    newValue: { partId: params.partId, owner, unitPrice },
  });
  return 1;
}
