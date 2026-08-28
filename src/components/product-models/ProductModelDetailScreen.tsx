"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  ProductModelAttachmentListItem,
  TrashedProductModelAttachmentListItem,
} from "@/lib/db/queries/attachments";
import type { ProductModelCustomerOption } from "@/lib/db/queries/product-model-customers";
import type { ProductModelDetail } from "@/lib/db/queries/product-models";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { RequestedPartRow } from "@/lib/domain/product-model-breakdown";
import ProductModelEditForm from "./ProductModelEditForm";
import ProductModelFilesSection from "./ProductModelFilesSection";
import ProductModelHistoryBreakdown from "./ProductModelHistoryBreakdown";

const KIND_LABELS: Record<string, string> = {
  GENERATOR: "Generator",
  MATCHER: "Matcher",
  TOTAL_CONTROLLER: "Total Controller (T/C)",
};

function kindLabel(kind: string | null): string {
  return kind ? (KIND_LABELS[kind] ?? kind) : "미지정";
}

/**
 * 이 모델에 붙은 고객사를 한 줄로. 하나도 없으면 `-` — 다른 칸들과 같은 규칙이다
 * (없는 것과 빈 것을 다르게 보이게 할 이유가 없다).
 */
function customerNames(list: readonly ProductModelCustomerOption[]): string {
  return list.length === 0 ? "-" : list.map((c) => c.name).join(", ");
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
 * Product Model Master detail screen. Four sections: 모델 기본정보
 * (view/edit toggle, canEdit-gated — ProductModelEditForm only ever mounts
 * for SUPER_ADMIN/ADMIN, re-verified server-side by updateProductModelAction
 * regardless), 모델 통계 (aggregate figures, all derived via product_model_id
 * linkage — see product-models.ts), 사진·도면 (ProductModelFilesSection —
 * 실제 파일이 올라가고 내려오는 자리), A/S 이력
 * (ProductModelHistoryBreakdown — 골라 켜는 원형 그래프 네 종과, 기본으로
 * 접혀 있는 접수 건 목록. 목록 자체는 그대로 ProductModelRepairCaseHistory 가
 * 그린다).
 *
 * ── `등록 장비` 구역과 `등록 장비 수` 카드를 없앴다 (사용자 결정) ────────
 * 장비 한 대씩의 S/N·L/N 표가 있던 자리다. 없앤 근거는 **같은 값이 아래
 * `A/S 이력` 의 접수 건 목록에 줄마다 이미 나온다**는 것이다(RepairCaseTable).
 *
 * ⚠️ 알고 없앴다: 접수 건이 하나도 없는 장비(실측 188대 중 73대)는 이 화면
 * 어디에도 나오지 않게 된다. 그 사실을 사용자에게 알렸고 그래도 없애기로
 * 정했다 — 되살릴 일이 생기면 여기가 그 자리다.
 *
 * `모델 통계` 의 `재입고(반복 수리) 장비 수` 는 그대로 둔다. 그 값은 접수 건
 * 수로 세는 것이라 표가 사라지는 것과 무관하다(조회가 계속 계산한다).
 *
 * ── detail 에 units 가 없다 ──────────────────────────────────────────────
 * 위 표가 사라지면서 units 배열을 읽는 화면이 없어졌다. 이 컴포넌트는
 * "use client" 라 받은 값이 그대로 브라우저까지 실려 가므로, 페이지가 넘기기
 * 전에 덜어 낸다(queries/product-models.ts 의 ProductModelDetail 주석).
 *
 * Product kind (Generator/Matcher) IS now a real model-master field
 * (product_models.kind), shown in 모델 기본정보 — but it is never derived
 * from workflowType; it stays whatever an authorized user explicitly set
 * (NULL/"미지정" until someone does). Each A/S 이력 row's own 제품 cell still
 * separately shows that case's own workflow-derived productCategory — a
 * distinct, case-scoped fact that intentionally may or may not agree with
 * this model's assigned kind (see the canonicalization audit: some real
 * models here already have cases spanning both kinds).
 *
 * ── `모델 기본정보` 의 셋째 칸은 `고객사` 다 (예전 `제조사` 자리) ────────
 * 제조사 칸은 실제로 쓰인 적이 없었고(104개 중 25개, 전부 데모 자료), 그 자리를
 * 고객사로 바꾸기로 했다 — 한 모델에 **여러 곳**이 붙는다(실측 TG-100 은 4곳).
 * 값은 detail.customers 에서 오고, 그 목록은 조회가 휴지통에 든 고객사를 이미
 * 걸러 낸 것이다(queries/product-model-customers.ts).
 *
 * ⚠️ `product_models.manufacturer` 칼럼과 detail.manufacturer 필드는 **그대로
 * 살아 있다.** 화면에서만 뺐고, 수정 폼이 그 값을 손대지 않은 채 다시 저장한다
 * (ProductModelEditForm 헤더) — 되돌릴 수 있게 남겨 둔 것이라 값이 지워지면 안
 * 된다. 이 화면에 제조사를 다시 그리지 말 것(사용자 결정).
 */
export default function ProductModelDetailScreen({
  detail,
  repairCases,
  requestedParts,
  canEdit,
  customerOptions,
  attachments,
  trashedAttachments,
  canManageFiles,
}: {
  detail: ProductModelDetail;
  repairCases: ResolvedRepairCase[];
  /** 고장 부품 그래프의 재료. 접수 건마다 한 줄이 아니다 — 여러 줄이거나 없다. */
  requestedParts: RequestedPartRow[];
  canEdit: boolean;
  /** 수정 폼의 고객사 콤보박스가 고를 수 있는 목록. canEdit 이 아닌 세션에는
   * 서버가 빈 배열을 넘긴다 — 폼 자체가 뜨지 않는 자리라 실어 보낼 이유가 없다. */
  customerOptions: ProductModelCustomerOption[];
  attachments: ProductModelAttachmentListItem[];
  trashedAttachments: TrashedProductModelAttachmentListItem[];
  /** productModels.files WRITE. 서버 컴포넌트가 판정해 내려보낸 값이다. */
  canManageFiles: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/product-models"
          className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          ← 제품 모델 관리
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{detail.modelName}</h1>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">모델 기본정보</h2>
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
            <ProductModelEditForm
              productModel={detail}
              customerOptions={customerOptions}
              onDone={() => setIsEditing(false)}
            />
          ) : (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <InfoField label="모델명" value={detail.modelName} />
              <InfoField label="제품 종류" value={kindLabel(detail.kind)} />
              <InfoField label="고객사" value={customerNames(detail.customers)} />
              <InfoField label="설명" value={detail.description ?? "-"} />
            </dl>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">모델 통계</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <InfoField label="A/S 접수 건수" value={String(detail.repairCaseCount)} />
          <InfoField label="재입고(반복 수리) 장비 수" value={String(detail.repeatRepairUnitCount)} />
          <InfoField label="현재 수리 중 건수" value={String(detail.currentlyInRepairCount)} />
          <InfoField
            label="평균 수리 기간"
            value={detail.averageRepairDurationDays === null ? "-" : `${detail.averageRepairDurationDays.toFixed(1)}일`}
          />
        </dl>
      </section>

      <ProductModelFilesSection
        productModelId={detail.id}
        attachments={attachments}
        trashedAttachments={trashedAttachments}
        canManageFiles={canManageFiles}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">A/S 이력</h2>
        <ProductModelHistoryBreakdown resolved={repairCases} requestedParts={requestedParts} />
      </section>
    </div>
  );
}
