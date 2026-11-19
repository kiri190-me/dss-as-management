import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { repairCaseFlowcharts, repairCases, users, customers, endUsers, products } from "../schema";

const updatedByUser = alias(users, "flowchart_updated_by_user");

export type RepairCaseFlowchartPageContext = { id: string; isLocked: boolean; assignedEngineerId: string | null };

/**
 * UI-hint context for the case-flowchart editor page's canEdit derivation
 * (5C-6D) — same convention as getWorkRecordCaseContext
 * (repair-case-work-records.ts): the mutation layer independently re-reads
 * and re-locks this same row, never trusting this. Deliberately not
 * resolveRepairCaseForServer (repair-case-resolver.ts) — that resolver is
 * mock/database read-source-aware and its ResolvedRepairCase shape doesn't
 * carry isLocked, while case-flowchart mutations are database-mode-only
 * (every server action gates on getAuthSource() === "database").
 */
export async function getRepairCaseFlowchartPageContext(repairCaseId: string): Promise<RepairCaseFlowchartPageContext | null> {
  const [row] = await db
    .select({ id: repairCases.id, isLocked: repairCases.isLocked, assignedEngineerId: repairCases.assignedEngineerId })
    .from(repairCases)
    .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
  return row ?? null;
}

export type RepairCaseFlowchartRow = {
  id: string;
  repairCaseId: string;
  title: string;
  description: string | null;
  createdByUserId: string;
  createdByName: string;
  updatedByUserId: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

function selectFlowchartColumns() {
  return {
    id: repairCaseFlowcharts.id,
    repairCaseId: repairCaseFlowcharts.repairCaseId,
    title: repairCaseFlowcharts.title,
    description: repairCaseFlowcharts.description,
    createdByUserId: repairCaseFlowcharts.createdBy,
    createdByName: users.name,
    updatedByUserId: repairCaseFlowcharts.updatedBy,
    updatedByName: updatedByUser.name,
    createdAt: repairCaseFlowcharts.createdAt,
    updatedAt: repairCaseFlowcharts.updatedAt,
  };
}

function baseFlowchartQuery() {
  return db
    .select(selectFlowchartColumns())
    .from(repairCaseFlowcharts)
    .innerJoin(users, eq(repairCaseFlowcharts.createdBy, users.id))
    .innerJoin(updatedByUser, eq(repairCaseFlowcharts.updatedBy, updatedByUser.id));
}

function toFlowchartRow(row: {
  id: string;
  repairCaseId: string;
  title: string;
  description: string | null;
  createdByUserId: string;
  createdByName: string;
  updatedByUserId: string;
  updatedByName: string;
  createdAt: Date;
  updatedAt: Date;
}): RepairCaseFlowchartRow {
  return {
    id: row.id,
    repairCaseId: row.repairCaseId,
    title: row.title,
    description: row.description,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    updatedByUserId: row.updatedByUserId,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 진단 Flowchart list for one repair case — excludes soft-deleted rows by
 * default (no "include deleted" option exists yet; nothing in 6B's scope
 * needs one). Newest-first, deterministic tie-break, same convention as
 * getRecentWorkRecordsForCase.
 */
export async function listRepairCaseFlowcharts(repairCaseId: string): Promise<RepairCaseFlowchartRow[]> {
  const rows = await baseFlowchartQuery()
    .where(and(eq(repairCaseFlowcharts.repairCaseId, repairCaseId), eq(repairCaseFlowcharts.isDeleted, false)))
    .orderBy(desc(repairCaseFlowcharts.createdAt), desc(repairCaseFlowcharts.id));
  return rows.map(toFlowchartRow);
}

/**
 * Single-flowchart lookup, scoped by BOTH repairCaseId and flowchartId in
 * the same WHERE clause — never fetched by flowchartId alone and checked
 * afterward. A flowchart that exists but belongs to a different repair case
 * returns null, identical to "doesn't exist at all" — this is the IDOR
 * defense for the get-one path (5C-6B plan §8): the query itself can never
 * return a cross-case row, so there is no separate "belongs to another
 * case" branch to accidentally leak information through. Soft-deleted rows
 * are also excluded — same default as the list query.
 */
export async function getRepairCaseFlowchart(
  repairCaseId: string,
  flowchartId: string
): Promise<RepairCaseFlowchartRow | null> {
  const [row] = await baseFlowchartQuery().where(
    and(
      eq(repairCaseFlowcharts.id, flowchartId),
      eq(repairCaseFlowcharts.repairCaseId, repairCaseId),
      eq(repairCaseFlowcharts.isDeleted, false)
    )
  );
  return row ? toFlowchartRow(row) : null;
}

export type RepairCaseFlowchartManagementRow = {
  id: string;
  repairCaseId: string;
  title: string;
  /**
   * 고장 개소 태그 — **늘 배열**이다. DB 의 NULL(칸이 생기기 전에 만들어진 줄)을
   * 이 조회가 []로 맞춰 내보낸다(getRepairCaseFlowchartGraph 와 같은 약속). 화면
   * 마다 `?? []` 를 적게 두면 한 군데만 빠뜨려도 그 화면에서 터지는데, 여기서는
   * 목록·휴지통·표·카드 넷이 같은 값을 읽으므로 빠뜨릴 자리가 그만큼 많다.
   */
  faultTags: string[];
  isDeleted: boolean;
  updatedAt: string;
  intakeNumber: string;
  customerName: string;
  endUserName: string | null;
  modelName: string;
  serialNumber: string | null;
};

/**
 * 진단 Flowchart 관리 (Checkpoint 2) — the smallest cross-case read model
 * needed for the new central list: no new storage, joins
 * repair_case_flowcharts straight into the same repair_cases/customers/
 * end_users/products chain selectRepairCaseJoin (repair-cases.ts) already
 * uses, with the same join-nullability shape (customerId/productId
 * NOT NULL -> innerJoin, endUserId nullable -> leftJoin). Excludes
 * soft-deleted repair cases (same convention as listRepairCases) in
 * addition to soft-deleted flowcharts — a flowchart belonging to a deleted
 * case is never shown here, regardless of its own isDeleted value.
 *
 * Checkpoint 2 is read-only and active-only: callers get non-deleted
 * flowcharts (`isDeleted = false`) exclusively — the future trash view is a
 * separate, later query, not a parameter bolted onto this one yet.
 *
 * 2026-11-19 — 고장 개소 태그를 함께 싣는다. 관리 화면이 그 값으로 **찾고**
 * (matchesSearch) 줄마다 **알약으로 그린다**. 🔴 행 타입에만 더하고 select 에
 * 안 더하면 타입은 맞는데 값이 안 와서 「태그로 찾으면 한 줄도 안 나오고 알약도
 * 안 선다」가 된다 — 오류는 한 줄도 안 난다.
 */
export async function listRepairCaseFlowchartsForManagement(): Promise<RepairCaseFlowchartManagementRow[]> {
  const rows = await db
    .select({
      id: repairCaseFlowcharts.id,
      repairCaseId: repairCaseFlowcharts.repairCaseId,
      title: repairCaseFlowcharts.title,
      faultTags: repairCaseFlowcharts.faultTags,
      isDeleted: repairCaseFlowcharts.isDeleted,
      updatedAt: repairCaseFlowcharts.updatedAt,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      endUserName: endUsers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
    })
    .from(repairCaseFlowcharts)
    .innerJoin(repairCases, eq(repairCaseFlowcharts.repairCaseId, repairCases.id))
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .where(and(eq(repairCaseFlowcharts.isDeleted, false), eq(repairCases.isDeleted, false)))
    .orderBy(desc(repairCaseFlowcharts.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    repairCaseId: row.repairCaseId,
    title: row.title,
    // NULL -> [] 는 여기서 한 번만 한다(행 타입 주석 참조).
    faultTags: row.faultTags ?? [],
    isDeleted: row.isDeleted,
    updatedAt: row.updatedAt.toISOString(),
    intakeNumber: row.intakeNumber,
    customerName: row.customerName,
    endUserName: row.endUserName,
    modelName: row.modelName,
    serialNumber: row.serialNumber,
  }));
}

export type RepairCaseFaultTagUsage = { tag: string; useCount: number };

/**
 * 지금까지 **어느 Flowchart 에든 달린** 고장 개소 태그를 모은다 — 편집기의
 * 태그 칸 드롭다운이 이것으로 선다(2026-11-19).
 *
 * 🔴 **태그 전용 표를 만들지 않는다**(같은 날 결정). 태그는 적는 대로 생기는
 * 값이라 마스터 표를 두면 「목록에 없는 값」을 막는 문이 하나 더 생기고, 그 문은
 * 사용자가 말한 「선택, 혹은 작성으로 선택」과 정면으로 어긋난다. 그래서 고를
 * 목록은 **이미 쓰인 값**에서 뽑는다 — 새 태그는 한 번 저장되는 순간 다음
 * 사람의 드롭다운에 선다.
 *
 * 🔴 **휴지통(is_deleted = true)은 뺀다** — 지운 Flowchart 의 태그를 계속 권하면
 * 지운 것이 목록에서 되살아난 것처럼 보인다. 🔵 접수 건 쪽 삭제까지 보려면
 * repair_cases 를 한 번 더 이어야 하는데, 그러지 않았다: 고장 개소는 부품·개소
 * 이름이라 가릴 값이 아니고, 고를 거리를 넓게 두는 편이 이 칸의 목적에 맞다.
 *
 * 차례는 **많이 쓰인 순**, 같으면 가나다순 — 자주 쓰는 개소가 위에 선다.
 *
 * 🔵 jsonb 배열을 펼쳐 세는 자리라 질의 생성기 대신 **글로 적은 SQL** 을 쓴다.
 * 집합을 돌려주는 함수(jsonb_array_elements_text)는 select 목록에 두면 group by
 * 와 어긋나므로 lateral 로 펼친다. 🔴 값을 끼워 넣는 자리가 **하나도 없다** —
 * 끼워 넣은 상수가 바인딩 자리($1)로 구워지는 drizzle 템플릿의 함정이 이
 * 질의에는 아예 생기지 않는다(표·칸 이름만 끼운다). 생성되는 SQL 을 찍어
 * 확인했다(2026-11-19).
 *
 * 🔵 jsonb_typeof 울타리: 칸은 NULL 을 허용하고(스키마 주석) NULL 은 strict 인
 * 이 함수에서 줄 0개로 조용히 빠진다. 배열이 아닌 jsonb 가 들어가는 일은 지금
 * 코드에 없지만, 들어가면 함수가 **그 자리에서 던져** 드롭다운이 통째로 죽는다.
 * 울타리가 있으면 그 줄만 빠진다.
 */
export async function listUsedRepairCaseFaultTags(): Promise<RepairCaseFaultTagUsage[]> {
  const rows = await db.execute<{ tag: string; use_count: number }>(sql`
    select fault_tag.value as tag, count(*)::int as use_count
    from ${repairCaseFlowcharts}
    cross join lateral jsonb_array_elements_text(${repairCaseFlowcharts.faultTags}) as fault_tag(value)
    where ${repairCaseFlowcharts.isDeleted} = false
      and jsonb_typeof(${repairCaseFlowcharts.faultTags}) = 'array'
    group by fault_tag.value
    order by count(*) desc, fault_tag.value asc
  `);
  // postgres.js 가 돌려주는 것은 배열 그 자체가 아니라 RowList 다 — map 으로
  // 평범한 배열을 만들어 내보낸다(부르는 쪽이 드라이버 모양을 알 까닭이 없다).
  return [...rows].map((row) => ({ tag: row.tag, useCount: row.use_count }));
}

export type RepairCaseFlowchartTrashRow = {
  id: string;
  repairCaseId: string;
  title: string;
  /** 사용중 행과 **같은 약속** — 늘 배열이다(RepairCaseFlowchartManagementRow.faultTags 주석). */
  faultTags: string[];
  updatedAt: string;
  deletedAt: string;
  intakeNumber: string;
  customerName: string;
  endUserName: string | null;
  modelName: string;
  serialNumber: string | null;
};

/**
 * Checkpoint 3B — the 휴지통 counterpart of listRepairCaseFlowchartsForManagement:
 * same join shape, same real-data-only scoping (soft-deleted repair cases
 * excluded even if one of their flowcharts is itself soft-deleted), but
 * flips the flowchart filter to `isDeleted = true` and additionally selects
 * `deletedAt` (never selected by the active-list query, since it's always
 * null there). Restore eligibility/retention-window display both derive
 * from this deletedAt value client-side
 * (getFlowchartRetentionStatus) — this query never computes or filters on
 * the 15-day window itself, it only supplies the raw timestamp.
 *
 * 2026-11-19 — 사용중 조회와 **똑같이** 고장 개소 태그를 싣는다. 🔴 한쪽만
 * 실으면 「목록에선 태그로 찾아지는데 휴지통에선 안 되는」 반쪽이 된다. 고르는
 * 목록(listUsedRepairCaseFaultTags)이 휴지통을 빼는 것과는 **다른 일**이다 —
 * 권하지 않을 뿐, 이미 달린 태그는 휴지통에서도 보이고 찾아져야 한다(복원할
 * 것을 찾는 자리다).
 */
export async function listDeletedRepairCaseFlowchartsForManagement(): Promise<RepairCaseFlowchartTrashRow[]> {
  const rows = await db
    .select({
      id: repairCaseFlowcharts.id,
      repairCaseId: repairCaseFlowcharts.repairCaseId,
      title: repairCaseFlowcharts.title,
      faultTags: repairCaseFlowcharts.faultTags,
      updatedAt: repairCaseFlowcharts.updatedAt,
      deletedAt: repairCaseFlowcharts.deletedAt,
      intakeNumber: repairCases.intakeNumber,
      customerName: customers.name,
      endUserName: endUsers.name,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
    })
    .from(repairCaseFlowcharts)
    .innerJoin(repairCases, eq(repairCaseFlowcharts.repairCaseId, repairCases.id))
    .innerJoin(customers, eq(repairCases.customerId, customers.id))
    .leftJoin(endUsers, eq(repairCases.endUserId, endUsers.id))
    .innerJoin(products, eq(repairCases.productId, products.id))
    .where(and(eq(repairCaseFlowcharts.isDeleted, true), eq(repairCases.isDeleted, false)))
    .orderBy(desc(repairCaseFlowcharts.deletedAt));

  return rows.map((row) => ({
    id: row.id,
    repairCaseId: row.repairCaseId,
    title: row.title,
    // NULL -> [] 는 여기서 한 번만 한다(행 타입 주석 참조).
    faultTags: row.faultTags ?? [],
    updatedAt: row.updatedAt.toISOString(),
    // Non-null by construction: the WHERE clause requires isDeleted = true,
    // and softDeleteRepairCaseFlowchart always sets deletedAt in the same
    // transaction it sets isDeleted = true.
    deletedAt: row.deletedAt!.toISOString(),
    intakeNumber: row.intakeNumber,
    customerName: row.customerName,
    endUserName: row.endUserName,
    modelName: row.modelName,
    serialNumber: row.serialNumber,
  }));
}
