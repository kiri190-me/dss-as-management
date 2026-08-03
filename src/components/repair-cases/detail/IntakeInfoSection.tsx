import { paidOrWarrantyLabels } from "@/lib/domain/types";
import type { RepairCaseDetail } from "@/lib/domain/repair-case-detail";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

export default function IntakeInfoSection({ detail }: { detail: RepairCaseDetail }) {
  const { repairCase, customerName, endUserName } = detail;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">인수 정보</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="인수일" value={repairCase.receivedAt} />
        <Field label="유상/무상" value={paidOrWarrantyLabels[repairCase.workflowType]} />
        <Field label="고객사" value={customerName} />
        <Field label="End-User" value={endUserName ?? "-"} />
        <Field
          label="고객 요청 납기일"
          value={repairCase.customerRequestedDueDate ?? "-"}
        />
        <Field
          label="사내 목표 출하일"
          value={repairCase.internalTargetShipmentDate ?? "-"}
        />
        <Field label="실제 출하일" value={repairCase.actualShipmentDate ?? "-"} />
      </dl>
    </section>
  );
}
