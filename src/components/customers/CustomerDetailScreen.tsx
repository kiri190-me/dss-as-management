"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerDetail, CustomerEndUserRow, EndUserContactRow } from "@/lib/db/queries/customers";
import type { CustomerProductModelRow } from "@/lib/db/queries/product-model-customers";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import {
  NO_CUSTOMER_ROW_COLOR_LABEL,
  resolveCustomerRowColor,
} from "@/lib/domain/customer-row-color";
import CustomerEditForm from "./CustomerEditForm";
import { CustomerRowColorSwatch } from "./CustomerRowColorField";
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
 * 제품 종류 표기. ProductModelDetailScreen / ProductModelListScreen 이 각자
 * 들고 있는 kindLabel 과 **같은 말**을 돌려준다 — 미지정(kind === null)을 이
 * 화면만 다르게 부르면 같은 모델이 화면마다 달라 보인다. (세 화면이 각자 한 줄씩
 * 들고 있는 것이 이 저장소의 모양이다. 두 형제 화면의 주석이 그 판단을 적어 뒀다.)
 */
const KIND_LABELS: Record<string, string> = {
  GENERATOR: "Generator",
  MATCHER: "Matcher",
  TOTAL_CONTROLLER: "Total Controller (T/C)",
};

function kindLabel(kind: string | null): string {
  return kind ? (KIND_LABELS[kind] ?? kind) : "미지정";
}

/**
 * Customer Management detail screen. Four sections, in the approved
 * order: 고객사 정보 (view/edit toggle, canEdit-gated — CustomerEditForm only
 * ever mounts for SUPER_ADMIN/ADMIN, re-verified server-side by
 * updateCustomerAction regardless), 관련 End-User 목록 (EndUserManagementSection
 * — create/rename End-Users and add/edit/remove their contacts, each
 * capability flag its own server-derived UX hint re-verified independently
 * by end-users.ts's Server Actions), 연결된 제품 모델 (읽기 전용 목록 + 모델
 * 상세 링크), A/S 이력 (CustomerRepairCaseHistory, reusing the existing
 * repair-case list components).
 *
 * 🔴 그 차례인 까닭: 화면이 "고객사 정보 → 누가 쓰는가(End-User) → 무엇을
 * 쓰는가(제품 모델) → 무슨 일이 있었나(A/S 이력)" 로 읽히기 때문이다. 그래서
 * 제품 모델 구역은 End-User 구역과 A/S 이력 구역 **사이**에 놓는다.
 */
export default function CustomerDetailScreen({
  customer,
  endUsers,
  endUserContacts,
  productModels,
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
  productModels: CustomerProductModelRow[];
  repairCases: ResolvedRepairCase[];
  canEdit: boolean;
  canCreateEndUser: boolean;
  canRenameEndUser: boolean;
  canAddEndUserContact: boolean;
  canEditEndUserContact: boolean;
  canRemoveEndUserContact: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  // 접수 건 목록은 기본으로 접혀 있다 — 형제 화면(제품 모델 상세)의
  // ProductModelHistoryBreakdown 과 같은 이름·같은 초기값이다. 건수는 단추 글자에
  // 들어 있어서 접힌 채로도 몇 건인지 보인다.
  const [isListOpen, setIsListOpen] = useState(false);

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
              {/* 수정 폼에서 고른 색을 읽기 화면에서도 그대로 볼 수 있어야 한다 —
                  안 그러면 색을 확인하려고 매번 수정 버튼을 눌러야 한다. */}
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">목록 배경색</dt>
                <dd className="flex items-center gap-1.5 text-sm text-zinc-900 dark:text-zinc-50">
                  <CustomerRowColorSwatch colorKey={customer.rowColor} />
                  <span>
                    {resolveCustomerRowColor(customer.rowColor)?.label ??
                      NO_CUSTOMER_ROW_COLOR_LABEL}
                  </span>
                </dd>
              </div>
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

      {/* 🔴 이 구역은 **보기 전용**이다. 연결을 만들고 지우는 자리는 제품 모델
          상세의 `모델 기본정보` 한 곳뿐이다 — 양쪽에서 고칠 수 있게 하면 같은
          사실을 고치는 자리가 둘이 되고, 그 둘의 권한·검증·동시성 판정을 각각
          맞춰 두어야 한다. 여기에 편집을 더하지 말 것.

          구역 껍데기는 위 `관련 End-User 목록` 과 같은 `rounded-lg border ... p-4`
          짜임을 쓴다. 한 화면에서 구역 모양이 두 가지가 되면 안 된다. */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">연결된 제품 모델</h2>
        {productModels.length === 0 ? (
          // A/S 이력이 0건일 때 CustomerRepairCaseHistory 가 쓰는 안내와 같은 모양.
          // 연결을 어디서 만드는지 덧붙인다 — 이 화면이 아니라 제품 모델 상세다.
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            이 고객사와 연결된 제품 모델이 없습니다. 연결은 제품 모델 상세의 모델 기본정보에서
            만듭니다.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {productModels.map((model) => (
              <li
                key={model.id}
                className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <Link
                  href={`/product-models/${model.id}`}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                >
                  {model.modelName}
                  <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    {kindLabel(model.kind)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {/* 제목과 단추가 한 줄에서 마주 본다 — 위 `고객사 정보` 구역의 제목+수정
            단추 줄과 같은 짜임이다. 형제 화면의 `ml-auto` 는 그쪽에서 그래프 선택
            단추들과 한 줄에 놓이기 때문이라 여기에는 맞지 않는다. */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">A/S 이력</h2>
          <button
            type="button"
            aria-expanded={isListOpen}
            onClick={() => setIsListOpen((prev) => !prev)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {isListOpen ? "접수 건 목록 숨기기" : `접수 건 목록 보기 (${repairCases.length}건)`}
          </button>
        </div>
        {isListOpen && <CustomerRepairCaseHistory resolved={repairCases} />}
      </section>
    </div>
  );
}
