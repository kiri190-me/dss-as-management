import "server-only";
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

export async function getIntakeReferenceData(): Promise<IntakeReferenceData> {
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
}
