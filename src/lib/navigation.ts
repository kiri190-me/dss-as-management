
export type NavItem = {
  key: string;
  href: string;
  label: string;
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
  { key: "myActiveWork", href: "/repair-cases/mine", label: "내 담당 제품" },
  { key: "repairCaseNew", href: "/repair-cases/new", label: "A/S 접수" },
  { key: "customerPortal", href: "/customer-portal", label: "고객 안내 현황" },
  { key: "diagnosisFlowcharts", href: "/diagnosis-flowcharts", label: "진단 Flowchart 관리" },
  { key: "workflows", href: "/workflows", label: "워크플로 관리" },
  {
    key: "excelKyosanIntakeList",
    href: "/excel-reports/kyosan-intake-list",
    label: "일본 본사 Excel 생성",
  },
  { key: "users", href: "/users", label: "사용자 관리" },
  { key: "customers", href: "/customers", label: "고객사 관리" },
  { key: "productModels", href: "/product-models", label: "제품 모델 관리" },
  { key: "technicalProcedures", href: "/procedures/technical", label: "기술 작업 절차" },
  { key: "inventory", href: "/inventory", label: "재고 관리" },
  { key: "domesticOrders", href: "/domestic-orders", label: "내자 정리" },
  { key: "quotes", href: "/quotes", label: "견적서" },
  // 견적서의 **작업비가 나오는 근거**다. 견적서 바로 옆에 두는 것은 견적을 내다가
  // "이 작업이 몇 시간이었지"를 확인하러 가는 일이 잦기 때문이다. 보는 권한은
  // 견적서와 같고, 고치는 권한만 더 좁다(actions/repair-labor.ts).
  { key: "repairLabor", href: "/repair-labor", label: "수리 작업 비용" },
  { key: "settings", href: "/settings", label: "시스템 설정" },
  // A/S 접수 알림 메일의 자동 발송 여부·수신자·문구. 「설정」 그룹에 두는 것은
  // 사용자 관리와 나란히 "누가 무엇을 받는가"를 정하는 자리이기 때문이다.
  { key: "mailSettings", href: "/settings/mail", label: "메일 설정" },
];


/**
 * ============================================================================
 * 관리자가 설정한 접근 권한으로 거른다 — **이제 이것 하나뿐이다**
 * ============================================================================
 * 예전에는 역할 기반 필터(isVisibleForRole)를 먼저 걸고 그 위에 설정을 겹쳤다.
 * 그래서 **넓혀도 메뉴가 뜨지 않았다** — 설정이 열어 줘도 역할 함수가 막았고,
 * 권한 화면은 "넓히면 열립니다"라고 말하는데 실제로는 주소를 직접 쳐야
 * 들어가지는 상태였다(2026-08-31).
 *
 * 역할 필터를 뗄 수 있었던 근거: `permission-baseline.ts` 가 **바로 그 역할
 * 함수들을 불러서** 기본값을 만든다. 두 판정은 같은 곳에서 나오므로, 설정을
 * 건드리지 않은 상태에서는 결과가 한 칸도 다르지 않다(navigation.test.ts 가
 * 모든 메뉴 × 모든 역할로 그것을 대조한다). 달라지는 것은 **넓혔을 때**뿐이고,
 * 그때 열리는 것이 원래 의도였다.
 *
 * ── 🔴 accessibleAreaKeys 는 이제 필수다 ────────────────────────────────
 * 예전에는 null 이면 역할 필터 결과를 그대로 썼다. 역할 필터가 사라진 지금
 * 같은 자리를 남겨 두면 **null 하나로 전 메뉴가 열린다.** 실제로 모바일
 * 드로어가 이 값을 안 넘기고 있었고(AppShell), 그동안 폰에서는 설정이 통째로
 * 무시됐다. 인자를 필수로 만들어 빠뜨리면 컴파일이 실패하게 한다.
 *
 * 차단 자체는 여전히 각 페이지의 requireAreaAccess 가 한다 — 여기서 보인다고
 * 들어가지는 것이 아니고, 여기서 감춘다고 막히는 것도 아니다.
 * ============================================================================
 */
export function filterNavItemsForAccess(
  items: NavItem[],
  accessibleAreaKeys: readonly string[]
): NavItem[] {
  const allowed = new Set(accessibleAreaKeys);
  return items.filter((item) => allowed.has(item.key));
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
 * 채(또는 두 그룹에 걸친 채) 조용히 나가는 일은 없다. 그룹 나누기는 노출을
 * 바꾸지 않는다 — Sidebar 는 접근 권한으로 거른 결과를 이 그룹들로 나눌 뿐이고,
 * 보이는 항목이 하나도 없는 그룹은 아무것도 그리지 않는다.

 */
export const navGroups: NavGroup[] = [
  { key: "asOperations", label: "A/S 업무", itemKeys: ["repairCases", "myActiveWork", "repairCaseNew", "customerPortal", "diagnosisFlowcharts", "workflows", "excelKyosanIntakeList"] },
  { key: "techResources", label: "기술 / 자원", itemKeys: ["technicalProcedures", "inventory"] },
  // 수주·정산 쪽 화면들이 모이는 자리. 지금은 '내자 정리' 하나뿐이지만 A/S
  // 업무 그룹에 얹지 않았다 — 그 그룹은 장비가 들어와서 나가기까지의 흐름이고,
  // 이쪽은 발주에서 입금까지의 흐름이라 같이 놓으면 두 흐름이 한 목록에서
  // 섞여 읽힌다.
  // 견적서가 이 그룹의 둘째 항목이다(2026-08-28). 발주에서 입금까지의 흐름
  // 안에서 견적은 내자 진행 상황표 바로 앞에 오는 일이고, 두 화면을 오가는
  // 사람이 같다. `내자 정리`의 하위메뉴로 두지 않은 것은 딸린 화면이 아니라
  // 나란한 화면이기 때문이다 — 내자 줄 없이 견적서만 내는 경우가 있다.
  { key: "poDomestic", label: "PO / 내자", itemKeys: ["domesticOrders", "quotes", "repairLabor"] },
  { key: "admin", label: "관리", itemKeys: ["customers", "productModels"] },
  // 사용자 관리와 시스템 설정이 '관리'에서 여기로 내려왔다(2026-08-28, 사용자 요청).
  // '관리'는 업무를 하면서 들여다보는 **마스터 자료**(고객사·제품 모델)를 다루는
  // 자리이고, 이쪽은 **시스템을 운영하는 자리**다 — 누가 쓰는가(사용자 관리)와
  // 시스템이 어떻게 도는가(시스템 설정)라서 성격이 다르다. 한 그룹에 같이 두면
  // 접수 건을 처리하다 고객사를 고치러 들어간 사람과 권한을 손보러 들어간 사람이
  // 같은 목록을 읽게 된다. 차례상 맨 끝인 것도 그 때문이다 — 매일 쓰는 메뉴가 아니다.
  //
  // 🔴 그룹 key 를 "settings" 가 아니라 "systemSettings" 로 둔 이유: 항목 쪽에 이미
  // key "settings"(시스템 설정)가 있다. 두 이름 공간은 서로 다르고(navGroups 의
  // key 는 Sidebar 의 펼침 상태와 React key 로만 쓰이며, itemKeys 하고만 대조되는
  // navItems 의 key 와 섞이는 자리가 없다) 그대로 둬도 동작은 같지만, 한 파일 안에서
  // key: "settings" 가 뜻이 다르게 두 번 나오면 읽는 사람이 매번 그 사실을 다시
  // 확인해야 한다. 이름을 갈라 두는 편이 공짜다. 라벨은 요청대로 "설정" 이다.
  { key: "systemSettings", label: "설정", itemKeys: ["users", "settings", "mailSettings"] },
];
