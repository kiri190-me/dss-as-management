"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { repairCaseDetailHrefs, resolveActiveTabHref } from "@/lib/domain/repair-case-detail-tabs";

type DetailTabsProps = {
  id: string;
};

export default function DetailTabs({ id }: DetailTabsProps) {
  const pathname = usePathname();

  // 주소는 도메인 헬퍼가 만들고, 라벨과 순서만 여기(화면)에서 정한다.
  const hrefs = repairCaseDetailHrefs(id);
  const tabs = [
    { label: "기본 정보", href: hrefs.root },
    { label: "작업내용", href: hrefs.execution },
    { label: "진단 Flowchart", href: hrefs.diagnosis },
    { label: "작업 이력", href: hrefs.workHistory },
    { label: "파일 관리", href: hrefs.files },
    { label: "검수/승인", href: hrefs.approval },
    { label: "보고서", href: hrefs.report },
  ];

  const activeHref = resolveActiveTabHref(pathname, tabs.map((t) => t.href));

  return (
    <nav
      aria-label="A/S 상세 탐색"
      className="flex gap-1 overflow-x-auto border-b border-zinc-200 print:hidden dark:border-zinc-800"
    >
      {tabs.map((tab) => {
        const isActive = tab.href === activeHref;
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
