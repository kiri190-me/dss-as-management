export type NavItem = {
  key: string;
  href: string;
  label: string;
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
  { key: "settings", href: "/settings", label: "시스템 설정" },
];
