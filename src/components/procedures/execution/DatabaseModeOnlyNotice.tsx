/** featureLabel defaults to "기술 절차" (this component's original single purpose) — Phase 5C-2 reuses it with "작업 기록" for the same DB-only limitation, rather than duplicating this notice. */
export default function DatabaseModeOnlyNotice({ featureLabel = "기술 절차" }: { featureLabel?: string }) {
  return (
    <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      {featureLabel}는 데이터베이스 저장 모드의 접수 건에서만 사용할 수 있습니다.
    </p>
  );
}
