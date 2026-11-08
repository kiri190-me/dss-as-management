import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { domesticOrderDueDates, domesticOrders } from "../schema";
import {
  resolveDomesticOrderDeliveredWriteThrough,
  type DeliveredDateLinkOutcome,
  type DeliveredDateLinkPlan,
} from "@/lib/domain/delivered-date-link";

/**
 * ============================================================================
 * 🔴 수리 건 → 내자 — 실제 출하일이 적히거나 바뀌면 **납품일도 함께** (2026-11-08)
 * ============================================================================
 * 이 방향을 타는 통로가 **둘**이다:
 *
 *   ① 출하 완료 전이              — mutations/workflow-transitions.ts  (자동으로 찍는다)
 *   ② 인수정보의 실제 출하일 수정 — mutations/repair-cases.ts          (사람이 고친다)
 *
 * 🔴 **그래서 이 파일이 따로 있다.** 둘이 각자 같은 일을 적으면 언젠가 한쪽만
 * 고쳐지고, 그날 「출하 완료로 찍힌 날짜는 따라가는데 고친 날짜는 안 따라간다」
 * (혹은 그 반대의) 상태가 된다. 규칙 자체는 여기에도 없다 —
 * domain/delivered-date-link.ts 의 resolveDomesticOrderDeliveredWriteThrough
 * 하나가 갖고, 이 파일은 **그 판정에 줄 재료를 읽어 오고 결과를 쓰는 일**만 한다.
 *
 * ── 🔴 잠그는 차례 — **내자 줄 먼저, 수리 건 나중** ────────────────────
 * 거울 방향(mutations/domestic-orders.ts)은 내자 줄을 `FOR UPDATE` 로 먼저 잡고
 * 그다음에 repair_cases 를 고친다. 이쪽이 repair_cases 를 먼저 고치고 내자 줄을
 * 나중에 잡으면 **차례가 정반대**가 되어, 두 사람이 같은 건을 동시에 고칠 때
 * 교착이 난다. 그래서 아래 plan… 은 repair_cases UPDATE **전에** 불리고, 실제로
 * 쓰는 일만 UPDATE 가 성공한 뒤로 미룬다(write… — 부르는 쪽이 그 차례를 지킨다).
 *
 * ── 🔴 왜 **쓰기를 plan 안에서 하지 않는가** ───────────────────────────
 * 두 통로 다 version 이 어긋나면 **그 트랜잭션이 아무것도 안 바꾼 채 끝난다.**
 * 그 길에서 납품일을 이미 바꿔 놓았으면 「수리 건은 그대로인데 내자 줄만 바뀐」
 * 상태가 남는다. 그래서 쓰기는 **UPDATE 가 1행을 돌려준 뒤에만** 한다.
 *
 * ── 🔴 **행을 지우지도 만들지도 않는다** ───────────────────────────────
 * 쓰는 것은 날짜 한 칸뿐이다. 그 행에는 사람이 적은 비고와 **납품자**가 함께
 * 달려 있고(schema/domestic-order-due-dates.ts), 행을 다시 만드는 방식은 그 둘을
 * 말없이 지운다. 행이 하나도 없는 줄에 행을 만들지도 않는다 — 지어낼 납기일이
 * 없고(그 표의 due_date 는 NOT NULL), 그 줄은 지금도 이 건의 출하일을 빌려
 * 그리는 중이라 **화면에 보이는 날짜가 이미 같다.**
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DomesticOrderDeliveredLinkWork = {
  plan: DeliveredDateLinkPlan;
  /** 고칠 **납기요청일 행**의 id. WRITE 일 때만 있다. */
  dueDateRowId: string | null;
  /** 그 행이 달려 있는 **내자 줄**의 id. 그 줄의 version 도 함께 올려야 한다. */
  domesticOrderId: string | null;
};

/**
 * 무엇을 할지 정한다 — **읽고 잠그기만 한다.** 🔴 부르는 쪽의 repair_cases UPDATE
 * **전에** 불러야 한다(머리말의 잠금 차례).
 *
 * 🔴 **행마다 지금 적힌 납품일까지 읽어 온다.** 판정이 「이미 적혀 있는가」를 보기
 * 때문이다(그 도메인 함수의 `trigger` 갈림 — 자동으로 찍는 자리는 빈 행에만 쓴다).
 * 수만 세어 넘기면 그 갈림을 여기서 다시 하게 되고, 그 순간 규칙이 두 벌이 된다.
 */
export async function planDomesticOrderDeliveredLink(
  tx: Tx,
  params: {
    repairCaseId: string;
    previous: string | null;
    next: string | null;
    trigger: "SHIPMENT_COMPLETED" | "MANUAL_EDIT";
  }
): Promise<DomesticOrderDeliveredLinkWork> {
  // 지워진 줄은 세지 않는다 — 화면 어디에도 없는 줄이 「여럿이라 못 묶는다」를
  // 만들면 안 된다(납기요청일 묶기와 같은 판단).
  const lines = await tx
    .select({ id: domesticOrders.id })
    .from(domesticOrders)
    .where(
      and(eq(domesticOrders.repairCaseId, params.repairCaseId), eq(domesticOrders.isDeleted, false))
    )
    .for("update");

  const rows =
    lines.length === 0
      ? []
      : await tx
          .select({
            id: domesticOrderDueDates.id,
            domesticOrderId: domesticOrderDueDates.domesticOrderId,
            deliveredDate: domesticOrderDueDates.deliveredDate,
          })
          .from(domesticOrderDueDates)
          .where(
            inArray(
              domesticOrderDueDates.domesticOrderId,
              lines.map((line) => line.id)
            )
          );

  const plan = resolveDomesticOrderDeliveredWriteThrough({
    previousActualShipmentDate: params.previous,
    nextActualShipmentDate: params.next,
    trigger: params.trigger,
    lines: lines.map((line) => ({
      dueDateRows: rows
        .filter((row) => row.domesticOrderId === line.id)
        .map((row) => ({ deliveredDate: row.deliveredDate })),
    })),
  });

  if (plan.kind !== "WRITE") return { plan, dueDateRowId: null, domesticOrderId: null };

  // WRITE 는 「줄 하나 · 행 하나」라는 뜻이라 rows 가 꼭 하나다(같은 수로 판정했다).
  // 그래도 한 번 더 보는 것은, 여기서 틀리면 **엉뚱한 줄의 날짜**가 바뀌기 때문이다.
  // 🔴 걸리면 **아무 일도 없었던 것으로** 돌려준다 — 결과는 「맞췄다」고 말하는데
  // 실제로는 아무 행도 안 바뀐 상태가 제일 나쁘다(사람이 확인할 길이 없다).
  if (rows.length !== 1) {
    return { plan: { kind: "NONE" }, dueDateRowId: null, domesticOrderId: null };
  }
  return { plan, dueDateRowId: rows[0].id, domesticOrderId: rows[0].domesticOrderId };
}

/**
 * 정해진 날짜를 **내자 정리에 실제로 쓴다.** 쓸 것이 없으면 아무 일도 하지 않는다.
 * 🔴 **부르는 쪽의 UPDATE 가 1행을 돌려준 뒤에만** 부른다(머리말).
 *
 * 🔴 **그 줄의 version 도 올린다.** 안 올리면 열려 있던 내자 정리 화면이 낡은
 * version 으로 저장해도 통과하고, 그 저장이 방금 맞춘 날짜를 제 옛 목록으로
 * 되돌린다(그 화면은 칸 하나를 고쳐도 줄 전체를 다시 보낸다).
 */
export async function writeDomesticOrderDeliveredLink(
  tx: Tx,
  work: DomesticOrderDeliveredLinkWork | null,
  actorUserId?: string
): Promise<void> {
  if (!work || work.plan.kind !== "WRITE" || !work.dueDateRowId) return;
  await tx
    .update(domesticOrderDueDates)
    .set({ deliveredDate: work.plan.date, updatedAt: new Date() })
    .where(eq(domesticOrderDueDates.id, work.dueDateRowId));
  if (!work.domesticOrderId) return;
  await tx
    .update(domesticOrders)
    .set({
      version: sql`${domesticOrders.version} + 1`,
      updatedAt: new Date(),
      // 통합 테스트의 옛 호출부는 행위자를 넘기지 않는다(납기요청일 묶기와 같다).
      // 그때는 마지막으로 고친 사람을 **지우지 않고** 그대로 둔다.
      ...(actorUserId ? { updatedBy: actorUserId } : {}),
    })
    .where(eq(domesticOrders.id, work.domesticOrderId));
}

/** 묶기 결과를 성공 응답에 실을 모양으로. 할 일이 없었으면 아무것도 싣지 않는다. */
export function deliveredLinkOutcomeOf(
  work: DomesticOrderDeliveredLinkWork | null
): DeliveredDateLinkOutcome | null {
  if (!work || work.plan.kind === "NONE") return null;
  return work.plan.kind === "WRITE" ? { linked: true } : work.plan.outcome;
}
