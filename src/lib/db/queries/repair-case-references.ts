import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { customers, endUsers, users } from "../schema";

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

export type IntakeReferenceData = {
  customers: IntakeCustomerOption[];
  endUsers: IntakeEndUserOption[];
  engineers: IntakeEngineerOption[];
};

export async function getIntakeReferenceData(): Promise<IntakeReferenceData> {
  const [customerRows, endUserRows, engineerRows] = await Promise.all([
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
  ]);

  return { customers: customerRows, endUsers: endUserRows, engineers: engineerRows };
}
