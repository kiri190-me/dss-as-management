import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { customers, endUsers, products, repairCases } from "../schema";
import type { ExternalIntakeRow } from "@/lib/api/intake-lookup";

/**
 * ============================================================================
 * 인수번호 한 건 — 다른 사내 시스템이 읽어 가는 통로용 (`GET /api/v1/intakes/{번호}`)
 * ============================================================================
 * 🔴 **`kyosan-intake-import.ts` 의 `loadExistingCasesByIntakeNumber` 를 쓰지
 * 않는다.** 그 함수는 **휴지통에 든 건을 일부러 포함한다**(그 파일의 주석). 거기서는
 * 그래야 한다 — 가져오기가 "이미 있는 번호인가"를 묻는 것이고, 휴지통에 있어도
 * 번호는 이미 쓰인 것이기 때문이다(`repair_cases_intake_number_unique` 는 삭제
 * 여부를 보지 않는다).
 *
 * 이 통로는 묻는 것이 다르다 — "지금 살아 있는 그 인수품이 무엇인가"다. 지운 건의
 * 고객사·모델을 다른 시스템에 내주면, 그쪽 원장에는 A/S 에서 이미 사라진 건이
 * 남는다. 그래서 `is_deleted = false` 를 건 **새 질의**를 둔다. 기존 함수에 조건을
 * 더하면 가져오기 쪽이 조용히 달라진다.
 *
 * 조인 모양은 그 함수에서 가져왔고(고객사·모델·S/N), **End-User 와 L/N** 을 더했다.
 * 전부 `leftJoin` 인 것은 `end_user_id` 가 nullable 이고 고객사·제품도 지워질 수
 * 있어서다 — 조인이 안 붙으면 그 칸만 null 로 오고, 응답에서는 빈 글자가 된다.
 *
 * 조인 상대(고객사·End-User·제품)의 삭제 여부는 보지 않는다. 건이 살아 있는 한
 * 그 건이 가리키는 이름이 맞는 답이고, 여기서 걸러 내면 "고객사 없는 인수품"이
 * 되어 받는 쪽이 사용처 글자를 못 만든다.
 *
 * 인수번호는 표 전체에서 하나뿐이라(unique index) `limit(1)` 이 "그 건"이다.
 *
 * 🔵 2026-10-22: **`receivedAt`(인수일)을 더했다.** 재고 관리의 [부품 요청]·
 * [승인요청건] 화면이 model · L/N · S/N · 인수일 · 고객사를 보여 주려는데 인수일만
 * 못 받고 있었다. 다른 다섯 칸과 달리 **조인 없이 `repair_cases` 자신의 칸**이라
 * (`received_at`, `date`, `NOT NULL`) 건이 있으면 항상 값이 있다 — 그래서
 * `ExternalIntakeRow.receivedAt` 은 `string | null` 이 아니라 `string` 이다.
 * ============================================================================
 */
export async function findIntakeForExternalLookup(
  intakeNumber: string
): Promise<ExternalIntakeRow | null> {
  const [row] = await db
    .select({
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      endUser: endUsers.name,
      productModel: products.modelName,
      productSerial: products.serialNumber,
      productLot: products.lotNumber,
      receivedAt: repairCases.receivedAt,
    })
    .from(repairCases)
    .leftJoin(customers, eq(customers.id, repairCases.customerId))
    .leftJoin(endUsers, eq(endUsers.id, repairCases.endUserId))
    .leftJoin(products, eq(products.id, repairCases.productId))
    .where(and(eq(repairCases.intakeNumber, intakeNumber), eq(repairCases.isDeleted, false)))
    .limit(1);

  return row ?? null;
}
