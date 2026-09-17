import "server-only";
import { eq } from "drizzle-orm";
import { partUnitPrices } from "../schema";
import { insertAuditLog } from "./audit-logs";
import type { Tx } from "./procedure-templates";

/**
 * ============================================================================
 * 단가 저장 — 부품 하나분
 * ============================================================================
 * 🔴 **부품 하나에 단가 하나다**(schema/part-unit-prices.ts 머리말, 2026-09-17
 * 사용자 정정). 예전에는 소유구분마다 한 칸씩 네 번 불렀는데, 이제 한 부품에
 * 한 번이다. 🔴 **한계수량은 그대로 소유구분별**이라 그쪽(applyOneOwner)은
 * 여전히 소유자마다 불린다 — 이 함수와 짝이 맞지 않는 것이 정상이다.
 *
 * mutations/part-minimum-quantities.ts 의 applyOneOwner 에 적힌 판단들은 그대로
 * 적용된다:
 *
 *  · **🔴 빈 값은 0 으로 저장하지 않고 행을 지운다.** "정하지 않음"과 "0원(무상)"은
 *    다른 뜻이다(schema/part-unit-prices.ts 머리말). 0 으로 바꿔 저장하면
 *    견적서가 정하지 않은 부품을 0원으로 청구하게 된다.
 *  · **바뀌지 않았으면 쓰지 않는다.** 저장을 눌렀다는 이유만으로 updated_by /
 *    updated_at 이 갈아엎어지면, "누가 이 단가를 정했나"를 물었을 때 실제로 정한
 *    사람이 아니라 마지막으로 저장 단추를 누른 사람이 나온다.
 *  · 행을 지울 때도 감사는 **UPDATE** 로 남긴다 — SOFT_DELETE/PURGE 는 "자료가
 *    없어졌다"는 뜻이라 여기서는 오해를 만든다.
 *
 * ── 이 파일에는 트랜잭션도 권한 검사도 없다 ─────────────────────────────
 * 일부러다. 한계수량과 **같은 저장 단추**에서 함께 저장되므로
 * (components/inventory 의 부품 상세 설정 구역), 트랜잭션을 따로 열면
 * "한계수량은 저장됐는데 단가는 안 된" 반쪽 상태가 만들어진다. 부르는 쪽
 * (mutations/part-minimum-quantities.ts 의 savePartOwnerSettings)이 트랜잭션과
 * 행위자 판정, 권한(`inventory.parts` WRITE), 부품 잠금을 이미 마친 뒤 이 함수를
 * 부른다 — 그 자리에서 하는 검사를 여기서 두 번 하지 않는다.
 * ============================================================================
 */

/**
 * 부품 하나분의 단가 저장. 지우기·넣기·그대로 두기 셋 중 하나이고, 실제로 쓴
 * 칸의 수(0 또는 1)를 돌려준다.
 *
 * `unitPrice: null` 은 "정하지 않음"이고, 그 뜻은 **행을 지우는 것**이다.
 */
export async function applyPartUnitPrice(
  tx: Tx,
  params: { partId: string; partName: string; unitPrice: string | null; actorUserId: string }
): Promise<number> {
  const { unitPrice } = params;

  const [previous] = await tx
    .select({ id: partUnitPrices.id, unitPrice: partUnitPrices.unitPrice })
    .from(partUnitPrices)
    .where(eq(partUnitPrices.partId, params.partId));

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
        unitPrice: previous.unitPrice,
      },
      newValue: { partId: params.partId, unitPrice: null, cleared: true },
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
    .values({ partId: params.partId, unitPrice, updatedBy: params.actorUserId })
    .onConflictDoUpdate({
      target: partUnitPrices.partId,
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
      unitPrice: previous?.unitPrice ?? null,
    },
    newValue: { partId: params.partId, unitPrice },
  });
  return 1;
}
