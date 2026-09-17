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

/**
 * 이력 한 줄 안의 보조 줄(신고증상 · 조치 내용). 값이 없으면 "-" 를 그린다.
 * 🔴 긴 글이 칸을 무너뜨리지 않게 두 줄에서 자른다 — 작업기록 메모는 길이
 * 제한이 느슨해서 그대로 풀면 이력 한 줄이 화면을 다 먹는다.
 */
function HistoryLine({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex gap-1.5 text-xs">
      <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{label}</span>
      <span className="line-clamp-2 min-w-0 text-zinc-600 dark:text-zinc-300">{value ?? "-"}</span>
    </span>
  );
}

export default function ProductInfoSection({
  resolved,
  related,
  relatedActionSummaries,
  editableFields,
  editingSection,
  referenceData,
  onStartEdit,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  related: RelatedMatch[];
  /** 건 id → 이력 줄에 그릴 `조치 내용`(작업기록에서 도출, 없으면 null) — see RepairCaseDetailView. */
  relatedActionSummaries: Record<string, string | null>;
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
        {/* 매칭 기준 안내. DATABASE 건은 제품 개체 FK(product_id)로 맞추므로
            예전의 "실제 운영 매칭 로직이 아닙니다" 문구는 더 이상 사실이
            아니다 — 데모 자료(MOCK/LOCAL_DEMO)일 때만 그 문구를 보인다. */}
        {resolved.source === "DATABASE" ? (
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            매칭 기준: 등록된 같은 제품으로 접수된 건을 찾습니다. Model·L/N·S/N
            표기가 달라도 같은 제품이면 나오고, 세 값이 같아도 다른 제품이면
            나오지 않습니다.
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            데모 매칭 기준: 모의 데이터끼리는 동일 제품 ID로, 로컬 데모 데이터가
            포함된 비교는 정규화된 Model + L/N + S/N 일치로 매칭합니다. 실제
            운영 매칭 로직이 아닙니다.
          </p>
        )}
        {related.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {related.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/repair-cases/${item.id}`}
                  className="flex flex-col gap-1 rounded-md border border-zinc-100 p-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
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
                  </span>
                  <HistoryLine label="신고증상" value={item.reportedSymptom} />
                  <HistoryLine label="조치 내용" value={relatedActionSummaries[item.id] ?? null} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
