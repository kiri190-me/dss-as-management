import type { Role } from "@/lib/domain/types";
import { canViewPublishedProcedureTemplates } from "@/lib/auth/procedure-template-authorization";
import { canViewInventory } from "@/lib/auth/inventory-authorization";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  // Omitted = visible to every role, matching every item's behavior before
  // this field existed. Reuses the same predicate the /procedures pages
  // themselves enforce (procedure-template-authorization.ts) rather than a
  // second, hardcoded role list here — this is a UX convenience only
  // (Sidebar.filterNavItemsForRole below), never the enforcement boundary;
  // each gated page independently re-checks the same predicate server-side
  // regardless of whether the link was ever shown.
  isVisibleForRole?: (role: Role) => boolean;
};

export const navItems: NavItem[] = [
  { key: "dashboard", href: "/dashboard", label: "대시보드" },
  { key: "repairCases", href: "/repair-cases", label: "전체 A/S 현황" },
  { key: "repairCaseNew", href: "/repair-cases/new", label: "A/S 접수" },
  {
    key: "excelKyosanIntakeList",
    href: "/excel-reports/kyosan-intake-list",
    label: "일본 본사 Excel 생성",
  },
  { key: "users", href: "/users", label: "사용자 관리" },
  { key: "procedures", href: "/procedures", label: "기술 절차 템플릿", isVisibleForRole: canViewPublishedProcedureTemplates },
  { key: "inventory", href: "/inventory", label: "재고 관리", isVisibleForRole: canViewInventory },
  { key: "settings", href: "/settings", label: "시스템 설정" },
];

export function filterNavItemsForRole(items: NavItem[], role: Role): NavItem[] {
  return items.filter((item) => !item.isVisibleForRole || item.isVisibleForRole(role));
}
