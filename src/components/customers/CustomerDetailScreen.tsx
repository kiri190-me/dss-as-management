"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  CustomerContactRow,
  CustomerDetail,
  CustomerEndUserRow,
  EndUserContactRow,
} from "@/lib/db/queries/customers";
import type { CustomerProductModelRow } from "@/lib/db/queries/product-model-customers";
import type { ProductModelCustomerSource } from "@/lib/domain/product-model-customer-merge";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import {
  NO_CUSTOMER_ROW_COLOR_LABEL,
  resolveCustomerRowColor,
} from "@/lib/domain/customer-row-color";
import { productModelKindLabel } from "@/lib/domain/product-model-kind";
import {
  CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS,
  DEFAULT_PRODUCT_MODEL_SORT,
  PRODUCT_MODEL_SORT_LABELS,
  sortProductModels,
  type ProductModelSortKey,
} from "@/lib/domain/product-model-sort";
import CustomerContactList from "./CustomerContactList";
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
 * 제품 종류 표기. ProductModelDetailScreen / ProductModelListScreen /
 * ProductModelEditForm 과 **같은 말**을 돌려준다 — 미지정(kind === null)을 이
 * 화면만 다르게 부르면 같은 모델이 화면마다 달라 보인다.
 *
 * 2026-10-06: 「각 화면이 한 줄씩 들고 있는 것이 이 저장소의 모양」이던 것을
 * domain 한 자리로 모았다(lib/domain/product-model-kind.ts). 서로를 가리키는
 * 주석이 있어도 한 곳만 고쳐지는 날을 막지는 못했고, 그때 아무 오류도 나지
 * 않는다. **보이는 글자는 한 글자도 바뀌지 않았다.**
 */
const kindLabel = productModelKindLabel;

/**
 * 「연결된 제품 모델」 한 줄이 **어디에서 이어졌는지** 알려 주는 딱지 (2026-10-08).
 *
 * 🔴 생김새도 말도 **반대 방향 화면에 이미 있는 것**을 그대로 쓴다 — 제품 모델
 * 상세의 `고객사` 칸이 접수 기록에서 나온 고객사에 붙이는 하늘색 알약과 같은 꼴·같은
 * 글자다(ProductModelDetailScreen 의 CustomerField). 같은 사실을 두 화면이 다르게
 * 보이면, 보는 사람은 그것이 다른 사실이라고 읽는다.
 *
 * 🔴 색만으로 구분하지 않고 **글자를 함께 적는다** — UI_GUIDELINE 7.
 *
 * 수기 쪽에도 딱지를 붙이는 것은 이 화면에서는 **둘 다 섞여 나오기** 때문이다.
 * 모델 상세의 고객사 칸은 수기가 기본이라 기록 쪽에만 딱지가 필요했지만, 여기서는
 * 딱지가 없는 줄이 "무엇인지 모르는 줄"이 된다.
 */
const PRODUCT_MODEL_SOURCE_BADGES: Record<
  ProductModelCustomerSource,
  { label: string; title: string; className: string }
> = {
  MANUAL: {
    label: "직접 연결",
    title: "제품 모델 상세의 모델 기본정보에서 직접 걸어 둔 연결입니다.",
    className:
      "rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] leading-none text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  REPAIR_CASE: {
    label: "접수 기록",
    title: "A/S 접수 기록에서 자동으로 나온 모델입니다. 수정 화면에서 지울 수 없습니다.",
    className:
      "rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] leading-none text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  },
};

function ProductModelSourceBadge({ source }: { source: ProductModelCustomerSource }) {
  const badge = PRODUCT_MODEL_SOURCE_BADGES[source];
  return (
    <span title={badge.title} className={badge.className}>
      {badge.label}
    </span>
  );
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
 *
 * 「고객사 담당자」 구역(2026-09-13)은 고객사 정보 바로 아래다 — 고객사 자체에 딸린
 * 사람들이라 End-User 보다 앞에 읽힌다. 고객사 정보의 대표 담당자 칸들과는 따로
 * 있는 목록이다(CustomerContactList 머리말). 추가·수정·삭제는 각자 서버가 정한
 * 참/거짓을 받고, customer-contacts.ts 의 서버 액션이 다시 검사한다.
 */
export default function CustomerDetailScreen({
  customer,
  customerContacts,
  endUsers,
  endUserContacts,
  productModels,
  repairCases,
  canEdit,
  canAddCustomerContact,
  canEditCustomerContact,
  canRemoveCustomerContact,
  canCreateEndUser,
  canRenameEndUser,
  canAddEndUserContact,
  canEditEndUserContact,
  canRemoveEndUserContact,
}: {
  customer: CustomerDetail;
  customerContacts: CustomerContactRow[];
  endUsers: CustomerEndUserRow[];
  endUserContacts: EndUserContactRow[];
  productModels: CustomerProductModelRow[];
  repairCases: ResolvedRepairCase[];
  canEdit: boolean;
  canAddCustomerContact: boolean;
  canEditCustomerContact: boolean;
  canRemoveCustomerContact: boolean;
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
  /**
   * [연결된 제품 모델] 의 차례. 🔴 기본값은 **지금까지와 같은 모델명 오름차순**
   * 이고(조회가 그 차례로 준다 — queries/product-model-customers.ts 의
   * listProductModelsForCustomer), 고를 수 있는 값·이름표·비교 규칙은
   * [제품 모델 관리] 목록과 **같은 자리**에서 온다(domain/product-model-sort.ts).
   * 두 화면이 같은 기능을 다른 말로 부르면 안 된다.
   */
  const [modelSortKey, setModelSortKey] = useState<ProductModelSortKey>(DEFAULT_PRODUCT_MODEL_SORT);
  const sortedProductModels = useMemo(
    () => sortProductModels(productModels, modelSortKey),
    [productModels, modelSortKey]
  );

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
              <InfoField label="대표 담당자 성함" value={customer.contactName ?? "-"} />
              <InfoField label="대표 담당자 직급" value={customer.contactTitle ?? "-"} />
              <InfoField label="대표 연락처(이메일)" value={customer.contactEmail ?? "-"} />
              <InfoField label="대표 연락처(전화)" value={customer.contactPhone ?? "-"} />
              {/* 메모는 여러 줄로 적는 칸이다 — 두 칸을 가로지르고 줄바꿈을 그대로 보인다. */}
              <div className="sm:col-span-2">
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">대표 담당자 메모</dt>
                <dd className="whitespace-pre-wrap break-words text-sm text-zinc-900 dark:text-zinc-50">
                  {customer.contactMemo ?? "-"}
                </dd>
              </div>
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
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">고객사 담당자</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          위 대표 담당자와 따로 관리하는 목록입니다.
        </p>
        <div className="mt-3">
          <CustomerContactList
            customerId={customer.id}
            contacts={customerContacts}
            canAdd={canAddCustomerContact}
            canEdit={canEditCustomerContact}
            canRemove={canRemoveCustomerContact}
          />
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

          🔴 **두 갈래가 섞여 나온다**(2026-10-08) — 위의 수기 연결과, 이 고객사의
          A/S 접수 건에서 유도한 모델이다. 뒤쪽은 표에 저장되는 값이 아니라 조회가
          읽을 때 계산한 것이라(queries/product-model-customers.ts) 수정 화면에서
          지울 수 없다. 그 사실을 줄마다 딱지로 알린다.

          구역 껍데기는 위 `관련 End-User 목록` 과 같은 `rounded-lg border ... p-4`
          짜임을 쓴다. 한 화면에서 구역 모양이 두 가지가 되면 안 된다. */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {/* 제목과 차례 고르개가 한 줄에서 마주 본다 — 아래 `A/S 이력` 구역의
            제목+단추 줄과 같은 짜임이다. 고르개는 **모델이 있을 때만** 그린다:
            빈 구역에 줄 세우기를 내놓으면 고를 것이 없는 조작이 하나 보인다. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">연결된 제품 모델</h2>
          {productModels.length > 0 && (
            // 🔴 보이는 글자를 여기 적지 말 것 — [제품 모델 관리] 목록과 같은
            // 한 벌을 쓴다(domain/product-model-sort.ts).
            //
            // 🔴 **고를 수 있는 값은 그 목록과 다르다** — 여기 모델은 전부 같은
            // 고객사의 것이라 「고객사」로 줄을 세울 뜻이 없다. 그 사실을 이 화면이
            // 손으로 거르지 않고 도메인이 내준 제 몫의 목록을 쓴다
            // (CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS) — 걸러내기가 화면에 적히면
            // 키가 하나 더 늘 때 한쪽만 고쳐지고, 그때 아무 오류도 나지 않는다.
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              정렬
              <select
                value={modelSortKey}
                onChange={(e) => setModelSortKey(e.target.value as ProductModelSortKey)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                {CUSTOMER_DETAIL_PRODUCT_MODEL_SORT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {PRODUCT_MODEL_SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {productModels.length === 0 ? (
          // A/S 이력이 0건일 때 CustomerRepairCaseHistory 가 쓰는 안내와 같은 모양.
          // 🔴 이 목록은 2026-10-08 부터 **접수 기록으로도** 채워진다 — 예전 문구는
          // 「연결은 제품 모델 상세에서 만듭니다」 한 길만 알려 주어, 접수 건이 한 건도
          // 없다는 사실(여기까지 비어 있으려면 그래야 한다)을 숨기고 있었다.
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            이 고객사와 연결된 제품 모델이 없습니다. A/S 접수 건이 생기면 그 제품의 모델이
            여기에 저절로 나타나고, 접수 건과 상관없이 직접 걸어 두려면 제품 모델 상세의 모델
            기본정보에서 만듭니다.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {sortedProductModels.map((model) => (
              <li
                key={model.id}
                // 🔴 딱지는 링크 **밖**이다 — 딱지까지 눌리면 "접수 기록"이라는 설명이
                // 누를 수 있는 것처럼 보이고, 거기 달린 title 설명도 링크의 것으로
                // 읽힌다(제품 모델 상세의 고객사 칸과 같은 규칙).
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
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
                {/* 🔴 양쪽에서 이어진 모델은 **한 줄**이고 딱지가 둘이다 — 조회가
                    이미 한 줄로 접어 두 갈래를 모두 담아 준다. */}
                {model.sources.map((source) => (
                  <ProductModelSourceBadge key={source} source={source} />
                ))}
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
