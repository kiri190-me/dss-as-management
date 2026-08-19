import type { ReactNode } from "react";
import Link from "next/link";

/**
 * ============================================================================
 * 목록 카드 — 좁은 자리에서 표 한 줄을 대신하는 모양
 * ============================================================================
 * 표가 들어가지 않는 폭에서 목록은 카드로 내려간다(responsive-list.tsx). 그때
 * 화면마다 카드를 따로 그리면, 같은 서비스인데 목록마다 카드 모양이 달라진다.
 * 그래서 카드도 한 종류만 둔다.
 *
 * ── 모양 ────────────────────────────────────────────────────────────────
 *   제목(누르면 상세로)                    [상태 배지]
 *   라벨   값
 *   라벨   값
 *   ─────────────────────────────────────
 *   [작업 버튼들]
 *
 * 라벨을 폭 고정 열에 세우는 것이 요점이다. 값만 늘어놓으면 카드마다 값이
 * 다른 자리에서 시작해 세로로 훑을 수 없고, 값이 길어 접혔을 때 그 줄이 어느
 * 항목의 연속인지도 알 수 없다.
 *
 * ── 비어 있는 값 ────────────────────────────────────────────────────────
 * 값이 없으면 그 줄을 통째로 뺀다. 표에서는 빈 칸이 열을 맞추는 데 필요하지만
 * 카드에는 열이 없어서, "라벨 -"만 남은 줄은 자리만 차지한다.
 * ============================================================================
 */

export type ListCardField = {
  label: string;
  /** null/undefined/빈 문자열이면 그 줄을 그리지 않는다. */
  value: ReactNode;
};

export function ListCard({
  title,
  href,
  badge,
  fields,
  actions,
}: {
  title: ReactNode;
  /** 있으면 제목이 링크가 된다. */
  href?: string;
  badge?: ReactNode;
  fields: ListCardField[];
  actions?: ReactNode;
}) {
  const shown = fields.filter(
    (field) => field.value !== null && field.value !== undefined && field.value !== ""
  );

  return (
    <li className="flex flex-col rounded-lg border border-zinc-200 bg-white focus-within:ring-2 focus-within:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          {href ? (
            <Link
              href={href}
              className="break-all font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              {title}
            </Link>
          ) : (
            <span className="break-all font-medium text-zinc-900 dark:text-zinc-50">{title}</span>
          )}
          {badge}
        </div>

        {shown.length > 0 && (
          <dl className="flex flex-col gap-0.5 text-[11px]">
            {shown.map((field) => (
              <div key={field.label} className="flex gap-2">
                <dt className="w-16 shrink-0 text-zinc-400 dark:text-zinc-500">{field.label}</dt>
                <dd className="break-all text-zinc-700 dark:text-zinc-200">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {actions && (
        <div className="mt-auto border-t border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex flex-wrap gap-1.5">{actions}</div>
        </div>
      )}
    </li>
  );
}
