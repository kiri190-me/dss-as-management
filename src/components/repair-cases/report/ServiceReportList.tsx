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
 *
 * ── 🔴 한 줄에 링크가 둘인데 `<a>` 는 겹치지 않는다 ────────────────────
 * 줄 전체를 누르면 **고치기**로 가고, 오른쪽의 `미리보기` 는 인쇄 화면으로
 * 간다. 그런데 줄 전체를 `<Link>` 로 감싸고 그 안에 미리보기 링크를 넣으면
 * **중첩 링크**가 되어 잘못된 HTML 이다 — 브라우저마다 다르게 고쳐 그리고,
 * 보조기술은 무엇을 읽어야 할지 모른다.
 *
 * 그래서 줄(`<li>`)을 `relative` 로 두고, 고치기 링크에 `after:absolute
 * after:inset-0` 을 얹어 **가짜 요소가 줄 전체를 덮게** 한다. 미리보기 링크는
 * 그 위(`relative z-10`)에 앉는다. `<a>` 는 형제라 겹치지 않는데, 누를 수 있는
 * 넓이는 예전 그대로다.
 * ============================================================================
 */

export type ServiceReportListRow = {
  id: string;
  /** 이 장을 여는 주소. 페이지가 만든다(`…/service-report?id=…`). */
  href: string;
  /**
   * 이 장의 미리보기 주소. **페이지가 만든다**(`…/service-report/print?id=…`) —
   * 조각이 주소를 조립하면 주소가 두 곳에 살게 된다(`href` 와 같은 원칙).
   */
  printHref: string;
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
        {rows.map((row) => {
          // 번호 세 칸을 다 비운 채로도 저장된다 — 그때 빈자리를 그대로 두면
          // 누를 곳이 이름 없는 줄이 된다. 미리보기 링크의 이름에도 쓴다.
          const title = row.reportNumber === "" ? "문서번호 없음" : row.reportNumber;

          return (
            <li
              key={row.id}
              // `relative` 는 고치기 링크의 덮개(`after:inset-0`)가 기댈 자리다 —
              // 머리말의 '한 줄에 링크가 둘인데 `<a>` 는 겹치지 않는다'.
              className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <Link
                href={row.href}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 after:absolute after:inset-0 after:rounded-lg"
              >
                <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                  {row.kindLabel}
                </span>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{title}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  발행일 {row.issuedOn}
                </span>
                {row.updatedAtLabel !== null && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    마지막 수정 {row.updatedAtLabel}
                  </span>
                )}
              </Link>

              {/* 🔴 덮개 **위**에 앉아야 눌린다(`z-10`). 한 화면에 같은 글자가
                  여럿이라 무엇의 미리보기인지 이름으로 밝힌다. */}
              <Link
                href={row.printHref}
                aria-label={`${row.kindLabel} ${title} 미리보기`}
                className="relative z-10 whitespace-nowrap text-xs font-medium text-sky-700 underline dark:text-sky-400"
              >
                미리보기
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
