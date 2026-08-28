import Link from "next/link";
import { StatusBadge, SourceBadge } from "@/components/repair-cases/badges";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { RelatedMatch } from "@/lib/domain/local/product-history-match";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { workflowKindLabels, workflowKindOf } from "@/lib/domain/workflow-kind";
import ProductInfoEditForm from "./edit/ProductInfoEditForm";
import OverhaulBadge from "@/components/common/OverhaulBadge";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

export default function ProductInfoSection({
  resolved,
  related,
  editableFields,
  editingSection,
  referenceData,
  onStartEdit,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  related: RelatedMatch[];
  editableFields: readonly string[] | null;
  editingSection: RepairCaseEditSection | null;
  referenceData: IntakeReferenceData | null;
  onStartEdit: () => void;
  onDone: () => void;
}) {
  const isEditing = editingSection === "PRODUCT";
  const canShowEditButton = editableFields !== null && editingSection === null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">제품 정보</h2>
        {canShowEditButton && (
          <button
            type="button"
            onClick={onStartEdit}
            className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
          >
            수정
          </button>
        )}
      </div>

      {isEditing && editableFields ? (
        <div className="mt-3">
          <ProductInfoEditForm
            resolved={resolved}
            editableFields={editableFields}
            referenceData={referenceData}
            onDone={onDone}
          />
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="종류" value={workflowKindLabels[workflowKindOf(resolved.workflowType)]} />
          <Field label="Model" value={resolved.modelName} />
          <Field label="L/N" value={resolved.lotNumber} />
          <Field label="S/N" value={resolved.serialNumber} />
          {/* O/H 대상 표시. S/N 에 생산 연월이 들어 있어 4년 기준을 볼 수 있다
              (domain/overhaul.ts). **알려 주기만 한다** — O/H 대상이어도 일반
              견적서와 OH 견적서를 모두 발행하므로, 이 표시로 무엇이 갈라지지
              않는다. 형식이 다른 S/N 이면 아무것도 그리지 않는다. */}
          <div className="col-span-2">
            <OverhaulBadge serialNumber={resolved.serialNumber} referenceDate={new Date()} />
          </div>
          <Field label="동봉 액세서리" value={resolved.accessoryList} />
          <Field label="외관 상태 요약" value={resolved.externalConditionSummary} />
          <Field label="탈거 사유" value={resolved.reasonForRemoval} />
        </dl>
      )}

      <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {related.length > 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            이 제품의 과거 A/S 이력: {related.length}건
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            동일 장비의 이전 A/S 이력이 없습니다.
          </p>
        )}
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          데모 매칭 기준: 모의 데이터끼리는 동일 제품 ID로, 로컬 데모 데이터가
          포함된 비교는 정규화된 Model + L/N + S/N 일치로 매칭합니다. 실제
          운영 매칭 로직이 아닙니다.
        </p>
        {related.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {related.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/repair-cases/${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-100 p-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <span className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-50">
                    {item.intakeNumber}
                    <SourceBadge source={item.source} />
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    접수일 {item.receivedAt}
                  </span>
                  {item.status === "SHIPMENT_COMPLETED" && item.actualShipmentDate ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      출하 완료 {item.actualShipmentDate}
                    </span>
                  ) : (
                    <StatusBadge status={item.status} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
