import type { Role } from "@/lib/domain/types";
import { canViewPublishedTechnicalTemplates } from "@/lib/auth/technical-procedure-template-authorization";
import { canViewInventory } from "@/lib/auth/inventory-authorization";
import { canViewMyActiveWork } from "@/lib/auth/my-active-work-authorization";
import { canViewRepairCaseFlowcharts } from "@/lib/auth/repair-case-flowchart-authorization";
import { canViewCustomers } from "@/lib/auth/customer-authorization";
import { canViewProductModels } from "@/lib/auth/product-model-authorization";
import { canManageExcelImports } from "@/lib/auth/excel-import-authorization";

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
  { key: "myActiveWork", href: "/repair-cases/mine", label: "내 담당 제품", isVisibleForRole: canViewMyActiveWork },
  { key: "repairCaseNew", href: "/repair-cases/new", label: "A/S 접수" },
  { key: "diagnosisFlowcharts", href: "/diagnosis-flowcharts", label: "진단 Flowchart 관리", isVisibleForRole: canViewRepairCaseFlowcharts },
  {
    key: "excelKyosanIntakeList",
    href: "/excel-reports/kyosan-intake-list",
    label: "일본 본사 Excel 생성",
  },
  { key: "users", href: "/users", label: "사용자 관리" },
  { key: "customers", href: "/customers", label: "고객사 관리", isVisibleForRole: canViewCustomers },
  { key: "productModels", href: "/product-models", label: "제품 모델 관리", isVisibleForRole: canViewProductModels },
  { key: "repairCaseExcelImport", href: "/excel-imports/repair-cases", label: "수리품 목록 Excel 이관", isVisibleForRole: canManageExcelImports },
  { key: "technicalProcedures", href: "/procedures/technical", label: "기술 작업 절차", isVisibleForRole: canViewPublishedTechnicalTemplates },
  { key: "inventory", href: "/inventory", label: "재고 관리", isVisibleForRole: canViewInventory },
  { key: "settings", href: "/settings", label: "시스템 설정" },
];

export function filterNavItemsForRole(items: NavItem[], role: Role): NavItem[] {
  return items.filter((item) => !item.isVisibleForRole || item.isVisibleForRole(role));
}

export type NavGroup = {
  key: string;
  label: string;
  itemKeys: string[];
};

/**
 * Checkpoint 2A — purely a presentation grouping over navItems (Sidebar's
 * collapsible sections); "dashboard" is deliberately excluded here and
 * rendered standalone by Sidebar instead, per this checkpoint's approved
 * IA. Every other navItems key must appear in exactly one group below —
 * navigation.test.ts asserts this so a future new nav item can't silently
 * end up ungrouped or double-grouped. Grouping never changes per-item
 * role visibility: Sidebar still runs filterNavItemsForRole on the flat
 * navItems list first, then partitions the *visible* result into these
 * groups — a group with zero visible children simply renders nothing.
 */
export const navGroups: NavGroup[] = [
  { key: "asOperations", label: "A/S 업무", itemKeys: ["repairCases", "myActiveWork", "repairCaseNew", "diagnosisFlowcharts", "excelKyosanIntakeList"] },
  { key: "techResources", label: "기술 / 자원", itemKeys: ["technicalProcedures", "inventory"] },
  { key: "admin", label: "관리", itemKeys: ["users", "customers", "productModels", "repairCaseExcelImport", "settings"] },
];
