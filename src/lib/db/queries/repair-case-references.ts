import "server-only";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { customers, endUsers, productModels, users } from "../schema";

/**
 * Read-only reference data for the database-backed new-intake form's
 * dropdowns (customer / End-User / assigned engineer). SELECT-only.
 *
 * Required because the form's mock-data-sourced dropdowns (mockCustomers/
 * mockEndUsers/mockUsers, string IDs like "c-001") do not correspond to any
 * row in the real database (real rows use UUID primary keys seeded
 * deterministically from those same mock IDs, but the UUID itself is not
 * derivable client-side) — the database-mode form must offer real,
 * selectable database rows instead.
 */
export type IntakeCustomerOption = { id: string; name: string };
export type IntakeEndUserOption = { id: string; customerId: string; name: string };
export type IntakeEngineerOption = { id: string; name: string };
/** `name` here is product_models.model_name — renamed for consistency with
 * the other option types above (rankSimilarNames/normalizeEntityName both
 * expect a plain `name` field). */
export type IntakeProductModelOption = { id: string; name: string };

export type IntakeReferenceData = {
  customers: IntakeCustomerOption[];
  endUsers: IntakeEndUserOption[];
  engineers: IntakeEngineerOption[];
  /** Product Model Master 연결 체크포인트 — intake/제품 정보 편집의 Model
   * 콤보박스가 선택 가능한 기존 product_models 목록. */
  productModels: IntakeProductModelOption[];
};

/**
 * 🔴 요청 안에서 캐시된다(2026-10-06). 수리 건 상세는 이것을 **두 자리**에서
 * 부른다 — [id]/layout.tsx 의 머리 카드(담당 엔지니어 콤보박스)와 [id]/page.tsx 의
 * 인수/제품 정보 편집 폼이다. React 의 cache() 는 요청 하나에만 걸리는 메모라
 * (repair-case-resolver.ts 의 resolveRepairCaseForServer 와 같은 방법), 네 개의
 * SELECT 는 요청당 한 번만 돈다. ISR 도 unstable_cache 도 아니고 요청 사이로
 * 값이 새지 않는다.
 */
export const getIntakeReferenceData = cache(async function getIntakeReferenceData(): Promise<IntakeReferenceData> {
  const [customerRows, endUserRows, engineerRows, productModelRows] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.isDeleted, false)),
    db
      .select({ id: endUsers.id, customerId: endUsers.customerId, name: endUsers.name })
      .from(endUsers)
      .where(eq(endUsers.isDeleted, false)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.isDeleted, false),
          eq(users.role, "AS_ENGINEER"),
          eq(users.approvalStatus, "APPROVED")
        )
      ),
    db
      .select({ id: productModels.id, name: productModels.modelName })
      .from(productModels)
      .where(eq(productModels.isDeleted, false)),
  ]);

  return {
    customers: customerRows,
    endUsers: endUserRows,
    engineers: engineerRows,
    productModels: productModelRows,
  };
});
