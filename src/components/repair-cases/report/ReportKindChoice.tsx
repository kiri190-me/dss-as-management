import Link from "next/link";

/**
 * ============================================================================
 * 「보고서」 탭의 갈림길 — 검사냐 수리냐
 * ============================================================================
 * 이 탭이 하는 일은 하나다: **어느 보고서를 만들지 고르게 하고 곧바로 그 작성
 * 화면으로 보낸다.** 고른 종류는 주소에 실려 간다(`?kind=`) — 작성 화면은
 * 그것을 **시작값으로만** 쓰고, 사람은 거기서 다시 바꿀 수 있다.
 *
 * ── ⚠️ "use client" 가 없다(서버 컴포넌트다) ────────────────────────────
 * 링크 둘뿐이라 브라우저에서 할 일이 없다. 그리고 클라이언트로 넘기면 이 구조가
 * 무너진다 — 두 이름은 채우개의 `SERVICE_REPORT_TITLES` 에서 오는데, 그 모듈은
 * `node:fs`·`node:zlib` 를 끌고 오므로 클라이언트 번들에 들어갈 수 없다. 그래서
 * 이 조각은 **다 만들어진 글자만 받아서** 그린다(`options`).
 * ============================================================================
 */

export type ReportKindChoiceOption = {
  /** `?kind=` 에 실릴 값. 목록의 열쇠로도 쓴다. */
  kind: string;
  /** 화면에 보일 이름. 양식의 제목에서 온다 — 페이지가 만들어 넘긴다. */
  title: string;
  /** 이 종류가 무엇인지 한 줄. 두 양식의 실제 차이를 적는다. */
  description: string;
  href: string;
};

export default function ReportKindChoice({
  options,
}: {
  options: readonly ReportKindChoiceOption[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">보고서 만들기</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          종류를 고르면 작성 화면으로 넘어갑니다. 원본 양식 그대로 채워 Excel 파일로 내려받습니다.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <Link
            key={option.kind}
            href={option.href}
            className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {option.title}
            </span>
            <span className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {option.description}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
