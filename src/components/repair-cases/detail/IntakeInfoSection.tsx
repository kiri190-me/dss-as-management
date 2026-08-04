import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

export default function IntakeInfoSection({ resolved }: { resolved: ResolvedRepairCase }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">인수 정보</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="인수일" value={resolved.receivedAt} />
        <Field label="유상/무상" value={resolved.paidOrWarranty} />
        <Field label="고객사" value={resolved.customerName} />
        <Field label="End-User" value={resolved.endUserName ?? "-"} />
        <Field
          label="고객 요청 납기일"
          value={resolved.customerRequestedDueDate ?? "-"}
        />
        <Field
          label="사내 목표 출하일"
          value={resolved.internalTargetShipmentDate ?? "-"}
        />
        <Field label="실제 출하일" value={resolved.actualShipmentDate ?? "-"} />
      </dl>
    </section>
  );
}
