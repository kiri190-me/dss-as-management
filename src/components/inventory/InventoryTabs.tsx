import Link from "next/link";

/** Sub-navigation within the existing 재고 관리 area — deliberately not a new top-level sidebar item. */
export default function InventoryTabs({ active }: { active: "LIST" | "REQUESTS" | "OH_TEMPLATES" }) {
  const tabClass = (isActive: boolean) =>
    isActive
      ? "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
      : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="flex gap-2">
      <Link href="/inventory" className={tabClass(active === "LIST")}>
        재고 목록
      </Link>
      <Link href="/inventory/requests" className={tabClass(active === "REQUESTS")}>
        부품 요청 관리
      </Link>
      <Link href="/inventory/oh-templates" className={tabClass(active === "OH_TEMPLATES")}>
        O/H 부품 템플릿
      </Link>
    </div>
  );
}
