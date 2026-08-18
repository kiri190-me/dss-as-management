import type { Role } from "@/lib/domain/types";
import { canViewPublishedTechnicalTemplates } from "@/lib/auth/technical-procedure-template-authorization";
import { canViewInventory } from "@/lib/auth/inventory-authorization";
import { canViewMyActiveWork } from "@/lib/auth/my-active-work-authorization";
import { canViewRepairCaseFlowcharts } from "@/lib/auth/repair-case-flowchart-authorization";
import { canViewCustomers } from "@/lib/auth/customer-authorization";
import { canViewProductModels } from "@/lib/auth/product-model-authorization";
import { canManageExcelImports } from "@/lib/auth/excel-import-authorization";
import { canViewWorkflowTemplates } from "@/lib/auth/workflow-template-authorization";

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
  { key: "workflows", href: "/workflows", label: "워크플로 관리", isVisibleForRole: canViewWorkflowTemplates },
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

/**
 * 관리자가 설정한 접근 권한으로 거른다(2026-08-19).
 *
 * 역할 기반 필터(위)를 대체하지 않고 **뒤에 겹친다**. 설정은 좁히는 방향으로만
 * 작동하므로, 역할이 원래 못 보던 항목이 설정 때문에 나타나는 일은 없어야 한다.
 * accessibleAreaKeys가 null이면(권한을 아직 못 읽은 경우, mock 모드 등) 역할
 * 필터 결과를 그대로 쓴다 — 못 읽었다고 메뉴를 전부 감추면 화면이 통째로
 * 비어 고장처럼 보인다. 어차피 각 페이지가 서버에서 다시 막으므로 여기서
 * 열려 있다고 들어가지지는 않는다.
 */
export function filterNavItemsForAccess(
  items: NavItem[],
  role: Role,
  accessibleAreaKeys: readonly string[] | null
): NavItem[] {
  const byRole = filterNavItemsForRole(items, role);
  if (!accessibleAreaKeys) return byRole;
  const allowed = new Set(accessibleAreaKeys);
  return byRole.filter((item) => allowed.has(item.key));
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
  { key: "asOperations", label: "A/S 업무", itemKeys: ["repairCases", "myActiveWork", "repairCaseNew", "diagnosisFlowcharts", "workflows", "excelKyosanIntakeList"] },
  { key: "techResources", label: "기술 / 자원", itemKeys: ["technicalProcedures", "inventory"] },
  { key: "admin", label: "관리", itemKeys: ["users", "customers", "productModels", "repairCaseExcelImport", "settings"] },
];
