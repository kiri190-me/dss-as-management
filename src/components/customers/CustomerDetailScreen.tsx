"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerDetail, CustomerEndUserRow, EndUserContactRow } from "@/lib/db/queries/customers";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import CustomerEditForm from "./CustomerEditForm";
import CustomerRepairCaseHistory from "./CustomerRepairCaseHistory";
import EndUserManagementSection from "./EndUserManagementSection";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

/**
 * Customer Management detail screen. Three sections, in the approved
 * order: 고객사 정보 (view/edit toggle, canEdit-gated — CustomerEditForm only
 * ever mounts for SUPER_ADMIN/ADMIN, re-verified server-side by
 * updateCustomerAction regardless), 관련 End-User 목록 (EndUserManagementSection
 * — create/rename End-Users and add/edit/remove their contacts, each
 * capability flag its own server-derived UX hint re-verified independently
 * by end-users.ts's Server Actions), A/S 이력 (CustomerRepairCaseHistory,
 * reusing the existing repair-case list components).
 */
export default function CustomerDetailScreen({
  customer,
  endUsers,
  endUserContacts,
  repairCases,
  canEdit,
  canCreateEndUser,
  canRenameEndUser,
  canAddEndUserContact,
  canEditEndUserContact,
  canRemoveEndUserContact,
}: {
  customer: CustomerDetail;
  endUsers: CustomerEndUserRow[];
  endUserContacts: EndUserContactRow[];
  repairCases: ResolvedRepairCase[];
  canEdit: boolean;
  canCreateEndUser: boolean;
  canRenameEndUser: boolean;
  canAddEndUserContact: boolean;
  canEditEndUserContact: boolean;
  canRemoveEndUserContact: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/customers"
            className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            ← 고객사 관리
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{customer.name}</h1>
        </div>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">고객사 정보</h2>
          {canEdit && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              수정
            </button>
          )}
        </div>

        <div className="mt-3">
          {isEditing ? (
            <CustomerEditForm customer={customer} onDone={() => setIsEditing(false)} />
          ) : (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <InfoField label="고객사명" value={customer.name} />
              <InfoField label="등록일" value={formatDateTime(customer.createdAt)} />
              <InfoField label="담당자 성함" value={customer.contactName ?? "-"} />
              <InfoField label="연락처(이메일)" value={customer.contactEmail ?? "-"} />
              <InfoField label="연락처(전화)" value={customer.contactPhone ?? "-"} />
            </dl>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">관련 End-User 목록</h2>
        <EndUserManagementSection
          customerId={customer.id}
          endUsers={endUsers}
          contacts={endUserContacts}
          canCreateEndUser={canCreateEndUser}
          canRenameEndUser={canRenameEndUser}
          canAddContact={canAddEndUserContact}
          canEditContact={canEditEndUserContact}
          canRemoveContact={canRemoveEndUserContact}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">A/S 이력</h2>
        <CustomerRepairCaseHistory resolved={repairCases} />
      </section>
    </div>
  );
}
