"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { repairCaseDetailHrefs, resolveActiveTabHref } from "@/lib/domain/repair-case-detail-tabs";

type DetailTabsProps = {
  id: string;
  /**
   * 「견적서」 탭을 그릴까. **판정은 여기서 하지 않는다** — 이 조각은 클라이언트
   * 컴포넌트라 권한을 물어볼 수 없고, 물어볼 수 있더라도 화면이 내린 판정은
   * 관문이 아니다. 상위 레이아웃(서버)이 `quotes` 영역의 READ 를 보고 넘겨준다.
   *
   * 🔴 **감추는 것은 막은 것이 아니다.** 주소를 직접 치면 그대로 들어와지므로
   * `/repair-cases/{id}/quotes` 페이지가 스스로 다시 확인한다. 여기서 감추는
   * 까닭은 눌러도 "권한이 없습니다"만 나오는 탭을 내밀지 않기 위해서다.
   *
   * 기본값을 두지 않는다 — 넘기는 것을 잊으면 tsc 가 잡는다. 기본 false 로
   * 두면 조용히 안 보이고, 기본 true 로 두면 조용히 새어 나간다.
   */
  canViewQuotes: boolean;
};

export default function DetailTabs({ id, canViewQuotes }: DetailTabsProps) {
  const pathname = usePathname();

  // 주소는 도메인 헬퍼가 만들고, 라벨과 순서만 여기(화면)에서 정한다.
  const hrefs = repairCaseDetailHrefs(id);
  const tabs = [
    { label: "기본 정보", href: hrefs.root },
    { label: "작업내용", href: hrefs.execution },
    { label: "진단 Flowchart", href: hrefs.diagnosis },
    { label: "작업 이력", href: hrefs.workHistory },
    { label: "파일 관리", href: hrefs.files },
    { label: "보고서", href: hrefs.report },
    // 견적서 · 검수/승인이 뒤에 온다(2026-09-04 사용자 지정 차례). 견적서만
    // 조건부다 — 나머지 일곱은 예전 그대로 언제나 그린다.
    ...(canViewQuotes ? [{ label: "견적서", href: hrefs.quotes }] : []),
    { label: "검수/승인", href: hrefs.approval },
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
