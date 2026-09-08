import Link from "next/link";

/**
 * ============================================================================
 * 개발자 모드 목차의 메뉴 카드 한 장
 * ============================================================================
 * 카드 한 장이 **실제로 동작하는 하위 화면 하나**를 가리킨다. 아직 만들지 않은
 * 자리를 회색 카드로 미리 깔아 두지 않는다 — 누르면 아무 일도 안 나는 자리는
 * 「고장난 화면」으로 읽히고, 이 화면에서는 특히 「배포한 줄 알았는데 안 됐다」가
 * 된다(개발자 모드 목차 page.tsx 의 같은 판단).
 *
 * `changedCount` 는 **지금 기본값에서 벗어나 저장돼 있는 칸 수**다. 목차만 보고도
 * 어디를 건드려 놨는지 알 수 있어야 해서 카드에 싣는다 — 0이면 배지를 그리지
 * 않는다. 「손댄 곳이 없다」를 굳이 배지로 말하면, 배지가 있다는 사실 자체가
 * 신호가 되지 못한다.
 *
 * `badge` 는 「칸 수」로는 말할 수 없는 지금 상태를 한 마디로 적는 자리다 —
 * 색상 톤 템플릿 카드가 「지금 쓰는 톤」의 이름을 여기 싣는다. 셈이 아니라
 * 상태이므로 0과 같은 「없음」이 없고, 그래서 값이 있으면 언제나 그린다.
 * ============================================================================
 */
export default function DeveloperMenuCard({
  href,
  title,
  description,
  changedCount,
  badge,
}: {
  href: string;
  title: string;
  description: string;
  changedCount: number;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</span>
        {badge && (
          <span className="rounded-sm bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            {badge}
          </span>
        )}
        {changedCount > 0 && (
          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            기본값과 다른 칸 {changedCount}개
          </span>
        )}
      </span>
      <span className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</span>
    </Link>
  );
}
