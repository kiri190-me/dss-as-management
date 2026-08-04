import type { KyosanEvidenceSnapshot } from "@/lib/domain/local/approval/kyosan-evidence";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

/**
 * 교산 출하 승인 증빙은 내부 승인 레코드와 별개의 읽기 전용 섹션이다.
 * 여기에는 액션 버튼이 없다 — 표시 전용이다.
 */
export default function KyosanEvidenceCard({ evidence }: { evidence: KyosanEvidenceSnapshot }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">교산 출하 승인 증빙</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="증빙 상태" value={evidence.status === "RECEIVED" ? "증빙 확인됨" : "증빙 없음"} />
        <Field label="증빙 유형" value={evidence.evidenceType} />
        <Field label="참조 번호" value={evidence.referenceNumber} />
        <Field label="증빙 일자" value={evidence.evidenceDate} />
      </dl>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{evidence.note}</p>
    </section>
  );
}
