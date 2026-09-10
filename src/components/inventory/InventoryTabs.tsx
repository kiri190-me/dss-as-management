import Link from "next/link";

/**
 * Sub-navigation within the existing 재고 관리 area — deliberately not a new
 * top-level sidebar item.
 *
 * 🔴 [승인 요청건] 은 **판이 있든 없든 언제나 보인다.** 판 여부로 감추면,
 * 관리자가 절차를 지운 순간 이미 결재를 받아 둔 신청을 실행할 자리가 사라진다 —
 * 그 신청들은 여전히 살아 있고 누군가 내보내야 한다. 판이 없으면 그 탭은
 * 「지금 처리할 건이 없습니다」라고 말할 뿐이다.
 */
export default function InventoryTabs({
  active,
}: {
  active: "LIST" | "REQUESTS" | "APPROVALS" | "OH_TEMPLATES";
}) {
  const tabClass = (isActive: boolean) =>
    isActive
      ? "rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-primary-50 dark:text-zinc-900"
      : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="flex gap-2">
      <Link href="/inventory" className={tabClass(active === "LIST")}>
        재고 목록
      </Link>
      <Link href="/inventory/requests" className={tabClass(active === "REQUESTS")}>
        부품 요청 관리
      </Link>
      <Link href="/inventory/approvals" className={tabClass(active === "APPROVALS")}>
        승인 요청건
      </Link>
      <Link href="/inventory/oh-templates" className={tabClass(active === "OH_TEMPLATES")}>
        O/H 부품 템플릿
      </Link>
    </div>
  );
}
