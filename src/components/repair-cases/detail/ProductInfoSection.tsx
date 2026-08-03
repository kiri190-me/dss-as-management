import Link from "next/link";
import { StatusBadge } from "@/components/repair-cases/badges";
import { productCategoryLabels } from "@/lib/domain/types";
import type { RepairCaseDetail } from "@/lib/domain/repair-case-detail";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

export default function ProductInfoSection({ detail }: { detail: RepairCaseDetail }) {
  const { repairCase, modelName, lotNumber, serialNumber, relatedCases } = detail;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">제품 정보</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="제품 구분" value={productCategoryLabels[repairCase.workflowType]} />
        <Field label="Model" value={modelName} />
        <Field label="L/N" value={lotNumber} />
        <Field label="S/N" value={serialNumber} />
      </dl>

      <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {relatedCases.length > 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            이 제품의 과거 A/S 이력: {relatedCases.length}건
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            동일 장비의 이전 A/S 이력이 없습니다.
          </p>
        )}
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          데모에서는 동일한 모의 제품 ID(productId)를 가지면서 접수일이 더
          이른 접수 건만 단순 매칭한 것이며, 실제 운영 매칭 로직이 아닙니다.
        </p>
        {relatedCases.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {relatedCases.map((related) => (
              <li key={related.id}>
                <Link
                  href={`/repair-cases/${related.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-100 p-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {related.intakeNumber}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    접수일 {related.receivedAt}
                  </span>
                  {related.status === "SHIPMENT_COMPLETED" && related.actualShipmentDate ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      출하 완료 {related.actualShipmentDate}
                    </span>
                  ) : (
                    <StatusBadge status={related.status} />
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
