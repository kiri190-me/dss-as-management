import Link from "next/link";

/**
 * ============================================================================
 * 「보고서」 탭 — 이 접수 건으로 저장해 둔 보고서들
 * ============================================================================
 * 한 줄을 누르면 그 보고서를 **다시 열어 고친다.** 갈림길(ReportKindChoice)은 이
 * 목록 아래에 그대로 남는다 — 한 접수 건에 여러 장이 붙는다(검사 한 장 + 수리 한
 * 장이 실제로 있다).
 *
 * ── ⚠️ "use client" 가 없다(서버 컴포넌트다) ────────────────────────────
 * 링크 목록뿐이라 브라우저에서 할 일이 없다. 그리고 종류 이름은 채우개의
 * `SERVICE_REPORT_TITLES` 에서 오는데 그 모듈이 `node:fs`·`node:zlib` 를 끌고
 * 오므로 클라이언트 번들에 들어갈 수 없다 — 그래서 이 조각도 `ReportKindChoice`
 * 와 똑같이 **다 만들어진 글자만 받아서** 그린다.
 *
 * ── 🔴 본문도 고객사명도 여기 오지 않는다 ──────────────────────────────
 * 조회(`queries/service-reports.ts`)가 일부러 담지 않는 값들이다 — 목록을 그리는
 * 데 필요하지 않고, 담으면 로그와 오류 보고에 딸려 나갈 자리가 는다. 이 조각의
 * props 에 그 칸을 더하고 싶어지면 **먼저 그 조회의 PII 항목을 읽을 것.**
 *
 * ── 빈 목록은 그리지 않는다 ────────────────────────────────────────────
 * 한 장도 없으면 페이지가 이 조각을 아예 부르지 않는다. "저장된 보고서가
 * 없습니다"라는 빈 상자는, 바로 아래에 만들기 갈림길이 있는 화면에서 아무것도
 * 알려 주지 않는다.
 * ============================================================================
 */

export type ServiceReportListRow = {
  id: string;
  /** 이 장을 여는 주소. 페이지가 만든다(`…/service-report?id=…`). */
  href: string;
  /** 「검사보고서」·「수리보고서」 — 양식의 제목에서 온다. */
  kindLabel: string;
  /** `No. [앞]-[중간]-[뒤]` 를 이은 것. 세 칸을 다 비워 두고 저장할 수 있어 빈 글자일 수 있다. */
  reportNumber: string;
  /** "YYYY-MM-DD" */
  issuedOn: string;
  /** 마지막으로 고친 때(`2026-09-02 14:33`). 읽을 수 없으면 null. */
  updatedAtLabel: string | null;
};

export default function ServiceReportList({ rows }: { rows: readonly ServiceReportListRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">저장된 보고서</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          누르면 그 보고서를 다시 열어 고칩니다.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={row.href}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                {row.kindLabel}
              </span>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {/* 번호 세 칸을 다 비운 채로도 저장된다 — 그때 빈자리를 그대로 두면
                    누를 곳이 이름 없는 줄이 된다. */}
                {row.reportNumber === "" ? "문서번호 없음" : row.reportNumber}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                발행일 {row.issuedOn}
              </span>
              {row.updatedAtLabel !== null && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  마지막 수정 {row.updatedAtLabel}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
