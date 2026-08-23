import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { customers, endUserContacts, endUsers, repairCases, users } from "../schema";

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
  /** 삭제 시 낙관적 동시성 검사에 쓴다(customers에는 version 컬럼이 없다). */
  updatedAt: string;
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
      .select({ id: customers.id, name: customers.name, createdAt: customers.createdAt, updatedAt: customers.updatedAt })
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
    updatedAt: c.updatedAt.toISOString(),
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

export type DeletedCustomerRow = {
  id: string;
  name: string;
  /**
   * 복원·완전삭제의 낙관적 동시성 검사값. customers에는 version 컬럼이 없어
   * updateCustomer와 같은 updated_at 비교 방식을 그대로 쓴다.
   */
  updatedAt: string;
  deletedAt: string;
  deletedByUserName: string | null;
  deleteReason: string | null;
  /** 이 고객사와 함께 딸려 간 End-User 수. 복원하면 이만큼이 같이 돌아온다. */
  endUserCount: number;
};

/**
 * 고객사 관리 휴지통 목록. 삭제 권한(canDeleteCustomers)이 있는 세션에서만
 * 호출된다 — 페이지가 그것을 판정하고, 이 함수 자체는 권한을 보지 않는다
 * (listDeletedRepairCases와 같은 역할 분담).
 *
 * endUserCount는 "이 고객사에 딸린, 삭제된 End-User 수"다. 삭제는 활성
 * End-User를 고객사와 같은 순간에 함께 잠그므로(softDeleteCustomer), 이
 * 숫자가 곧 복원했을 때 같이 돌아올 수를 말한다. 삭제 이전에 따로 지워져
 * 있던 End-User도 여기 함께 세어지지만 — 복원은 그런 행을 되살리지 않는다
 * (deleted_at이 다르다) — 그 차이를 화면에서 구분해 보여 줄 만한 근거가
 * 아직 없어 한 숫자로 둔다. 완전삭제 시에는 어느 쪽이든 함께 사라진다.
 */
export async function listDeletedCustomers(): Promise<DeletedCustomerRow[]> {
  const [customerRows, deletedEndUserRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        updatedAt: customers.updatedAt,
        deletedAt: customers.deletedAt,
        deleteReason: customers.deleteReason,
        deletedByUserName: users.name,
      })
      .from(customers)
      // leftJoin이어야 한다 — deleted_by는 nullable이고, inner join이면
      // 삭제자를 알 수 없는 행이 휴지통에서 통째로 사라진다.
      .leftJoin(users, eq(customers.deletedBy, users.id))
      .where(eq(customers.isDeleted, true))
      .orderBy(desc(customers.deletedAt)),
    db
      .select({ customerId: endUsers.customerId })
      .from(endUsers)
      .where(eq(endUsers.isDeleted, true)),
  ]);

  const endUserCounts = new Map<string, number>();
  for (const row of deletedEndUserRows) {
    endUserCounts.set(row.customerId, (endUserCounts.get(row.customerId) ?? 0) + 1);
  }

  return customerRows.map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
    // is_deleted = true인 행만 여기 온다. softDeleteCustomer는 같은 UPDATE에서
    // deleted_at을 반드시 채우므로 이 단정은 안전하다 — mapRepairCaseTrashRow가
    // 같은 근거로 같은 단정을 쓴다.
    deletedAt: row.deletedAt!.toISOString(),
    deletedByUserName: row.deletedByUserName,
    deleteReason: row.deleteReason,
    endUserCount: endUserCounts.get(row.id) ?? 0,
  }));
}
