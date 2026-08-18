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
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /**
   * 개발 모드 전용 진단 표시. 위 주석의 원칙(운영에서 error.message를 절대
   * 노출하지 않는다)은 그대로다 — 이 블록은 NODE_ENV가 production이면
   * 렌더되지 않는다.
   *
   * 도입 배경: 폰에서만 재현되는 실패를 추적할 때, 화면에 고정 문구만 뜨고
   * 서버 로그에도 아무것도 남지 않으면(클라이언트 렌더 오류는 에러 경계가
   * 삼키므로) 원인을 좁힐 방법이 사실상 없다. dev에서 실기 검증을 하는 이
   * 프로젝트의 작업 방식상, 그 경우 폰 화면이 유일한 단서다.
   */
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        A/S 데이터를 불러오지 못했습니다.
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        잠시 후 다시 시도해 주세요.
      </p>

      {isDev && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-300">
            개발 모드 진단 정보 (운영에서는 표시되지 않음)
          </p>
          <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
            {error.name}: {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </div>
      )}
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
