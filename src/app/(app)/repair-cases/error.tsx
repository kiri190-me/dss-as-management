"use client";

/**
 * Next.js error boundary for the repair-cases route segment. Covers DB
 * connection/query failures from the Stage G-2 database read path (and any
 * other render-time error in this segment). Deliberately renders only a
 * fixed, generic Korean message — never `error.message`/`error.stack` —
 * since a DB failure's error text can contain connection details. No
 * database import here, no automatic redirect.
 */
export default function RepairCasesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        A/S 데이터를 불러오지 못했습니다.
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        잠시 후 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        다시 시도
      </button>
    </div>
  );
}
