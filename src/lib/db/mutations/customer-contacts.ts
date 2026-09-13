import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { customerContacts, customers } from "../schema";
import type { CustomerContactFields } from "@/lib/validation/customer-contact-input";

/**
 * ============================================================================
 * 고객사 담당자(customer_contacts) — 추가 · 수정 · 삭제
 * ============================================================================
 * End-User 담당자(end-users.ts 의 createEndUserContact · updateEndUserContact ·
 * removeEndUserContact)와 같은 모양이다: 수정·삭제는 행을 잠그고 updated_at 으로
 * 낙관적 동시성을 보고, 삭제는 소프트 삭제(is_deleted · deleted_at · deleted_by)다.
 * 권한은 부르는 쪽(server/actions/customer-contacts.ts)이 보고, 여기는 자료 규칙만
 * 안다.
 *
 * ── 이름이 같아도 막지 않는다 ───────────────────────────────────────────
 * End-User 담당자와 같은 판단이다 — 흔한 이름의 두 사람이 한 고객사에 있을 수
 * 있고, 담당자는 고객사·End-User 처럼 "같은 주체가 둘"을 막아야 하는 대상이 아니다.
 *
 * ── 감사 로그 · 개인정보 ────────────────────────────────────────────────
 * 이름·직급·전화·이메일·메모는 개인정보다(schema/customers.ts 의 customerContacts
 * 머리 주석). End-User 담당자 쪽과 같게 **행별 감사 로그를 남기지 않는다** — 남길
 * 수 있는 것이 id 뿐이라 기록으로서 뜻이 없다. 반환값도 화면이 이미 가진 값의
 * 되돌림일 뿐 어디에도 적지 않는다. 고객사를 휴지통에 넣고 되살리고 지울 때 함께
 * 움직인 담당자는 고객사 쪽 감사 로그에 id 로만 남는다(customers-trash.ts ·
 * master-data-purge.ts).
 *
 * ── 휴지통 고객사에는 붙이지 않는다 ─────────────────────────────────────
 * 추가는 고객사 행을 FOR SHARE 로 잡은 채 활성인지 본다. softDeleteCustomer 는 같은
 * 행을 FOR UPDATE 로 잡은 뒤 이 표의 활성 줄을 함께 휴지통에 넣으므로, 둘이 겹쳐도
 *   · 추가가 먼저 잡으면 → 휴지통 넣기가 기다렸다가 새 줄까지 함께 넣는다.
 *   · 휴지통 넣기가 먼저 잡으면 → 추가는 기다렸다가 다시 읽고 NOT_FOUND 다.
 * 어느 쪽이든 "휴지통 고객사 아래 살아 있는 담당자"가 남지 않는다.
 * ============================================================================
 */

const NOT_FOUND_CUSTOMER_MESSAGE = "해당 고객사를 찾을 수 없습니다.";
const NOT_FOUND_CONTACT_MESSAGE = "해당 담당자를 찾을 수 없습니다.";
const CONFLICT_MESSAGE = "다른 사용자가 이 담당자 정보를 수정했습니다. 새로고침 후 다시 시도하세요.";

export type CustomerContactSaved = {
  id: string;
  contactName: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  updatedAt: string;
};

const savedColumns = {
  id: customerContacts.id,
  contactName: customerContacts.contactName,
  title: customerContacts.title,
  phone: customerContacts.phone,
  email: customerContacts.email,
  memo: customerContacts.memo,
  updatedAt: customerContacts.updatedAt,
};

function toSaved(row: Omit<CustomerContactSaved, "updatedAt"> & { updatedAt: Date }): CustomerContactSaved {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

export type CreateCustomerContactResult =
  | ({ ok: true } & CustomerContactSaved)
  | { ok: false; code: "NOT_FOUND"; message: string };

/** 활성 고객사에 담당자 한 줄을 붙인다. 고객사가 없거나 휴지통에 있으면 NOT_FOUND. */
export async function createCustomerContact(
  params: { customerId: string } & CustomerContactFields
): Promise<CreateCustomerContactResult> {
  return db.transaction(async (tx): Promise<CreateCustomerContactResult> => {
    // FOR SHARE — 휴지통 넣기와 겹칠 때의 순서를 정한다(파일 머리 주석).
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, params.customerId), eq(customers.isDeleted, false)))
      .for("share");
    if (!customer) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_CUSTOMER_MESSAGE };
    }

    const [created] = await tx
      .insert(customerContacts)
      .values({
        customerId: params.customerId,
        contactName: params.contactName,
        title: params.title,
        phone: params.phone,
        email: params.email,
        memo: params.memo,
      })
      .returning(savedColumns);
    return { ok: true, ...toSaved(created) };
  });
}

export type UpdateCustomerContactResult =
  | ({ ok: true } & CustomerContactSaved)
  | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string };

/**
 * 활성 담당자 한 줄의 다섯 칸을 통째로 바꾼다(부분 수정 없음 — 폼이 늘 다섯 칸을
 * 다 보낸다). 고객사와 함께 휴지통에 든 줄은 is_deleted 라 NOT_FOUND 다.
 */
export async function updateCustomerContact(
  params: { contactId: string; expectedUpdatedAt: string } & CustomerContactFields
): Promise<UpdateCustomerContactResult> {
  return db.transaction(async (tx): Promise<UpdateCustomerContactResult> => {
    const [current] = await tx
      .select({ id: customerContacts.id, updatedAt: customerContacts.updatedAt })
      .from(customerContacts)
      .where(and(eq(customerContacts.id, params.contactId), eq(customerContacts.isDeleted, false)))
      .for("update");
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_CONTACT_MESSAGE };
    }
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const [updated] = await tx
      .update(customerContacts)
      .set({
        contactName: params.contactName,
        title: params.title,
        phone: params.phone,
        email: params.email,
        memo: params.memo,
        updatedAt: new Date(),
      })
      .where(eq(customerContacts.id, params.contactId))
      .returning(savedColumns);
    return { ok: true, ...toSaved(updated) };
  });
}

export type RemoveCustomerContactResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string };

/**
 * 소프트 삭제만 한다. 따로 지운 줄은 deleted_at 이 고객사 휴지통 넣기의 순간과
 * 달라서, 나중에 고객사를 휴지통에 넣었다 되살려도 돌아오지 않는다
 * (customers-trash.ts 머리 주석 「복원은 '이번 삭제로 딸려 간 것'만」).
 * 줄 자체는 고객사가 완전 삭제될 때 함께 사라진다.
 */
export async function removeCustomerContact(params: {
  contactId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
}): Promise<RemoveCustomerContactResult> {
  return db.transaction(async (tx): Promise<RemoveCustomerContactResult> => {
    const [current] = await tx
      .select({ id: customerContacts.id, updatedAt: customerContacts.updatedAt })
      .from(customerContacts)
      .where(and(eq(customerContacts.id, params.contactId), eq(customerContacts.isDeleted, false)))
      .for("update");
    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_CONTACT_MESSAGE };
    }
    if (current.updatedAt.toISOString() !== params.expectedUpdatedAt) {
      return { ok: false, code: "CONFLICT", message: CONFLICT_MESSAGE };
    }

    const now = new Date();
    await tx
      .update(customerContacts)
      .set({ isDeleted: true, deletedAt: now, deletedBy: params.actorUserId, updatedAt: now })
      .where(eq(customerContacts.id, params.contactId));
    return { ok: true };
  });
}
