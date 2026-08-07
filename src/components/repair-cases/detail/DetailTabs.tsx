"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type DetailTabsProps = {
  id: string;
};

export default function DetailTabs({ id }: DetailTabsProps) {
  const pathname = usePathname();

  const tabs = [
    { label: "기본 정보", href: `/repair-cases/${id}` },
    { label: "표준 절차 실행", href: `/repair-cases/${id}/execution` },
    { label: "작업 이력", href: `/repair-cases/${id}/work-history` },
    { label: "파일 관리", href: `/repair-cases/${id}/files` },
    { label: "검수/승인", href: `/repair-cases/${id}/approval` },
    { label: "보고서", href: `/repair-cases/${id}/report` },
  ];

  return (
    <nav
      aria-label="A/S 상세 탐색"
      className="flex gap-1 overflow-x-auto border-b border-zinc-200 print:hidden dark:border-zinc-800"
    >
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "whitespace-nowrap border-b-2 border-zinc-900 px-3 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
