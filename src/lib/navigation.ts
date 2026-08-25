import type { Role } from "@/lib/domain/types";
import { canViewPublishedTechnicalTemplates } from "@/lib/auth/technical-procedure-template-authorization";
import { canViewInventory } from "@/lib/auth/inventory-authorization";
import { canViewMyActiveWork } from "@/lib/auth/my-active-work-authorization";
import { canViewRepairCaseFlowcharts } from "@/lib/auth/repair-case-flowchart-authorization";
import { canViewCustomers } from "@/lib/auth/customer-authorization";
import { canViewDomesticOrders } from "@/lib/auth/domestic-order-authorization";
import { canViewProductModels } from "@/lib/auth/product-model-authorization";
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
  /**
   * 이 항목이 어느 항목의 **하위메뉴**인가(2026-08-25, 주간보고).
   *
   * navGroups(아래)와 다른 개념이다. 그쪽은 여러 메뉴를 접었다 펴는 **구획**이고,
   * 이쪽은 "부모 화면에 딸린 화면"이다 — 주간보고는 대시보드의 다른 표현이지
   * '현황' 같은 새 구획이 필요한 화면이 아니다.
   *
   * 지금 이 필드를 가진 항목은 대시보드 아래 주간보고 하나뿐이고, Sidebar 는
   * 부모 링크 바로 아래에 한 단 들여써서 그린다. 하위 항목은 어느 그룹에도
   * 들어가지 않는다 — 그룹에도 넣으면 사이드바에 같은 링크가 두 번 나온다
   * (navigation.test.ts 가 그것을 막는다).
   */
  parentKey?: string;
};

export const navItems: NavItem[] = [
  { key: "dashboard", href: "/dashboard", label: "대시보드" },
  // 대시보드의 하위메뉴. 카드 10개가 "지금 이 순간"을 보여 준다면 이쪽은
  // 고객사에 보내는 **주간 현황판**이라, 같은 대시보드 아래에 둔다.
  { key: "weeklyReport", href: "/dashboard/weekly-report", label: "주간보고", parentKey: "dashboard" },
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
  { key: "technicalProcedures", href: "/procedures/technical", label: "기술 작업 절차", isVisibleForRole: canViewPublishedTechnicalTemplates },
  { key: "inventory", href: "/inventory", label: "재고 관리", isVisibleForRole: canViewInventory },
  { key: "domesticOrders", href: "/domestic-orders", label: "내자 정리", isVisibleForRole: canViewDomesticOrders },
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

/** 이 항목의 하위메뉴들 — 차례는 navItems 에 적힌 그대로다. */
export function childNavItems(items: NavItem[], parentKey: string): NavItem[] {
  return items.filter((item) => item.parentKey === parentKey);
}

/**
 * Checkpoint 2A — purely a presentation grouping over navItems (Sidebar's
 * collapsible sections); "dashboard" is deliberately excluded here and
 * rendered standalone by Sidebar instead, per this checkpoint's approved
 * IA. **대시보드는 여전히 단독이다** — 2026-08-25 에 그 아래로 주간보고가
 * 붙었지만, 그것은 그룹이 아니라 하위메뉴(NavItem.parentKey)라서 대시보드는
 * 예전과 같은 자리에 같은 모양으로 남았고 Sidebar 가 그 바로 아래에 들여쓴
 * 링크를 하나 더 그릴 뿐이다.
 *
 * 그래서 그룹에 들어가지 않는 키가 이제 둘이다 — 단독인 "dashboard" 와, 그
 * 하위메뉴들. 그 둘을 뺀 **나머지 모든 키는 정확히 한 그룹에** 있어야 한다.
 * navigation.test.ts 가 그것을 단언하므로, 새 메뉴가 어느 그룹에도 못 들어간
 * 채(또는 두 그룹에 걸친 채) 조용히 나가는 일은 없다. Grouping never changes
 * per-item role visibility: Sidebar still runs filterNavItemsForRole on the
 * flat navItems list first, then partitions the *visible* result into these
 * groups — a group with zero visible children simply renders nothing.
 */
export const navGroups: NavGroup[] = [
  { key: "asOperations", label: "A/S 업무", itemKeys: ["repairCases", "myActiveWork", "repairCaseNew", "diagnosisFlowcharts", "workflows", "excelKyosanIntakeList"] },
  { key: "techResources", label: "기술 / 자원", itemKeys: ["technicalProcedures", "inventory"] },
  // 수주·정산 쪽 화면들이 모이는 자리. 지금은 '내자 정리' 하나뿐이지만 A/S
  // 업무 그룹에 얹지 않았다 — 그 그룹은 장비가 들어와서 나가기까지의 흐름이고,
  // 이쪽은 발주에서 입금까지의 흐름이라 같이 놓으면 두 흐름이 한 목록에서
  // 섞여 읽힌다.
  { key: "poDomestic", label: "PO / 내자", itemKeys: ["domesticOrders"] },
  { key: "admin", label: "관리", itemKeys: ["users", "customers", "productModels", "settings"] },
];
