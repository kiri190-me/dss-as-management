"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProductModelDetail } from "@/lib/db/queries/product-models";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import ProductModelEditForm from "./ProductModelEditForm";
import ProductModelRepairCaseHistory from "./ProductModelRepairCaseHistory";

const KIND_LABELS: Record<string, string> = {
  GENERATOR: "Generator",
  MATCHER: "Matcher",
  TOTAL_CONTROLLER: "Total Controller (T/C)",
};

function kindLabel(kind: string | null): string {
  return kind ? (KIND_LABELS[kind] ?? kind) : "미지정";
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
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
 * linkage — see product-models.ts), 등록 장비 (per-unit S/N/L/N/repair
 * count/latest intake), A/S 이력 (ProductModelRepairCaseHistory, reusing the
 * existing repair-case list components).
 *
 * Product kind (Generator/Matcher) IS now a real model-master field
 * (product_models.kind), shown in 모델 기본정보 — but it is never derived
 * from workflowType; it stays whatever an authorized user explicitly set
 * (NULL/"미지정" until someone does). Each A/S 이력 row's own 제품 cell still
 * separately shows that case's own workflow-derived productCategory — a
 * distinct, case-scoped fact that intentionally may or may not agree with
 * this model's assigned kind (see the canonicalization audit: some real
 * models here already have cases spanning both kinds).
 */
export default function ProductModelDetailScreen({
  detail,
  repairCases,
  canEdit,
}: {
  detail: ProductModelDetail;
  repairCases: ResolvedRepairCase[];
  canEdit: boolean;
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
            <ProductModelEditForm productModel={detail} onDone={() => setIsEditing(false)} />
          ) : (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <InfoField label="모델명" value={detail.modelName} />
              <InfoField label="제품 종류" value={kindLabel(detail.kind)} />
              <InfoField label="제조사" value={detail.manufacturer ?? "-"} />
              <InfoField label="설명" value={detail.description ?? "-"} />
            </dl>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">모델 통계</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <InfoField label="등록 장비 수" value={String(detail.unitCount)} />
          <InfoField label="A/S 접수 건수" value={String(detail.repairCaseCount)} />
          <InfoField label="재입고(반복 수리) 장비 수" value={String(detail.repeatRepairUnitCount)} />
          <InfoField label="현재 수리 중 건수" value={String(detail.currentlyInRepairCount)} />
          <InfoField
            label="평균 수리 기간"
            value={detail.averageRepairDurationDays === null ? "-" : `${detail.averageRepairDurationDays.toFixed(1)}일`}
          />
        </dl>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">등록 장비</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">S/N</th>
                <th className="px-3 py-2 font-medium">L/N</th>
                <th className="px-3 py-2 font-medium">관련 A/S 접수 건수</th>
                <th className="px-3 py-2 font-medium">최신 입고일</th>
              </tr>
            </thead>
            <tbody>
              {detail.units.map((unit) => (
                <tr key={unit.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2 whitespace-nowrap">{unit.serialNumber ?? "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{unit.lotNumber ?? "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{unit.repairCaseCount}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(unit.latestReceivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">A/S 이력</h2>
        <ProductModelRepairCaseHistory resolved={repairCases} />
      </section>
    </div>
  );
}
