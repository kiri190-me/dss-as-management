import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { customers, endUserContacts, endUsers, repairCases } from "../schema";

// Deliberately permissive UUID matcher (any RFC-4122-shaped hex string, not
// version-pinned) — same convention/reasoning as repair-cases.ts's own
// UUID_PATTERN (duplicated per query file, not shared).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomerListRow = {
  id: string;
  name: string;
  endUserCount: number;
  repairCaseCount: number;
  createdAt: string;
};

/**
 * List every active customer with its End-User/repair-case counts, for the
 * /customers list screen. Counts are computed in plain JS over two small
 * id-only SELECTs rather than a grouped SQL aggregate — same "small
 * dataset, no join-fanout risk" precedent as
 * listRepairCasesForFlowchartCreateSelector's own doc comment (customers/
 * end_users/repair_cases are all small tables at this system's scale).
 */
export async function listCustomersWithCounts(): Promise<CustomerListRow[]> {
  const [customerRows, endUserRows, repairCaseRows] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name, createdAt: customers.createdAt })
      .from(customers)
      .where(eq(customers.isDeleted, false))
      .orderBy(customers.name),
    db
      .select({ customerId: endUsers.customerId })
      .from(endUsers)
      .where(eq(endUsers.isDeleted, false)),
    db
      .select({ customerId: repairCases.customerId })
      .from(repairCases)
      .where(eq(repairCases.isDeleted, false)),
  ]);

  const endUserCounts = new Map<string, number>();
  for (const row of endUserRows) {
    endUserCounts.set(row.customerId, (endUserCounts.get(row.customerId) ?? 0) + 1);
  }
  const repairCaseCounts = new Map<string, number>();
  for (const row of repairCaseRows) {
    repairCaseCounts.set(row.customerId, (repairCaseCounts.get(row.customerId) ?? 0) + 1);
  }

  return customerRows.map((c) => ({
    id: c.id,
    name: c.name,
    endUserCount: endUserCounts.get(c.id) ?? 0,
    repairCaseCount: repairCaseCounts.get(c.id) ?? 0,
    createdAt: c.createdAt.toISOString(),
  }));
}

export type CustomerDetail = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getCustomerDetailById(id: string): Promise<CustomerDetail | null> {
  if (!UUID_PATTERN.test(id)) return null;

  const [row] = await db
    .select({
      id: customers.id,
      name: customers.name,
      contactName: customers.contactName,
      contactEmail: customers.contactEmail,
      contactPhone: customers.contactPhone,
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,
    })
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.isDeleted, false)))
    .limit(1);

  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CustomerEndUserRow = {
  id: string;
  name: string;
  updatedAt: string;
};

/**
 * `updatedAt` is needed for renameEndUserAction's optimistic-concurrency
 * check (expectedUpdatedAt) — added for the End-User + multi-contact
 * management checkpoint. contactName/contactEmail are not here — that
 * information now lives in end_user_contacts (1:N), read separately by
 * listEndUserContactsByCustomerId below.
 */
export async function listEndUsersByCustomerId(customerId: string): Promise<CustomerEndUserRow[]> {
  const rows = await db
    .select({
      id: endUsers.id,
      name: endUsers.name,
      updatedAt: endUsers.updatedAt,
    })
    .from(endUsers)
    .where(and(eq(endUsers.customerId, customerId), eq(endUsers.isDeleted, false)))
    .orderBy(endUsers.name);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export type EndUserContactRow = {
  id: string;
  endUserId: string;
  contactName: string;
  contactEmail: string | null;
  updatedAt: string;
};

/**
 * Every active contact for every active End-User of this customer, in one
 * query — fetched up front by the detail page (same "small dataset, fetch
 * everything" precedent as listEndUsersByCustomerId itself) rather than
 * lazily per accordion-expand, so expanding an End-User row is a pure
 * client-side reveal with no extra round trip. Soft-deleted contacts (and
 * contacts of a soft-deleted End-User) are excluded — this is the "normal
 * display" list, never a trash/restore view (none exists yet).
 */
export async function listEndUserContactsByCustomerId(customerId: string): Promise<EndUserContactRow[]> {
  const rows = await db
    .select({
      id: endUserContacts.id,
      endUserId: endUserContacts.endUserId,
      contactName: endUserContacts.contactName,
      contactEmail: endUserContacts.contactEmail,
      updatedAt: endUserContacts.updatedAt,
    })
    .from(endUserContacts)
    .innerJoin(endUsers, eq(endUserContacts.endUserId, endUsers.id))
    .where(
      and(
        eq(endUsers.customerId, customerId),
        eq(endUsers.isDeleted, false),
        eq(endUserContacts.isDeleted, false)
      )
    )
    .orderBy(endUserContacts.contactName);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}
