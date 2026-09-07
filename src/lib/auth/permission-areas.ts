import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 역할별 접근 권한 설정 — 영역과 수준 (2026-08-19 승인)
 * ============================================================================
 * 관리자가 "어느 역할이 어느 메뉴에 들어가고 거기서 무엇을 할 수 있는지"를
 * 화면에서 정할 수 있게 하기 위한 어휘다. NAS의 공유폴더 권한창을 본떴다 —
 * 왼쪽에 대상이 쭉 나열되고, 각 줄마다 접근 여부와 수준을 정한다.
 *
 * ── 이 파일이 정하지 않는 것 ────────────────────────────────────────────
 * **실제 정책은 여전히 src/lib/auth/*-authorization.ts의 64개 함수다.**
 * 여기서 정한 수준은 그 위에 덧씌우는 상한일 뿐이고, 최종 판정은 언제나
 *
 *     실효 권한 = min(기존 코드가 허용하는 것, 화면에서 정한 수준)
 *
 * 이다(permission-baseline.ts, permission-resolver.ts). 이 방향을 고른 이유:
 * 4단계 드롭다운은 지금 정책만큼 잘게 표현할 수 없다. 예를 들어 고객사
 * 영역에는 "새 End-User는 영업도 만들 수 있지만 이름 수정은 관리자만"이라는
 * 구분이 있는데, 이걸 "고객사 = 읽기+쓰기" 한 칸에 접으면 영업이 이름을 고칠
 * 수 있게 된다 — 화면을 만들다가 권한이 넓어지는 것은 있어서는 안 된다.
 * 그래서 설정은 **좁히는 방향으로만** 작동한다. 잘못 만져도 없던 권한이
 * 생기지 않는다.
 *
 * ── 체크박스와 드롭다운의 관계 ──────────────────────────────────────────
 * 화면에는 둘 다 있지만 저장되는 값은 하나(수준)다. 체크 해제 = 접근 불가
 * (NONE)이고, 체크 = 읽기 이상이다. 둘을 따로 저장하면 "메뉴에 못 들어가는데
 * 쓰기 권한은 있다" 같은 앞뒤 안 맞는 상태가 만들어진다.
 * ============================================================================
 */

export const PERMISSION_LEVELS = ["NONE", "READ", "WRITE", "MANAGE"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const permissionLevelLabels: Record<PermissionLevel, string> = {
  NONE: "접근 불가",
  READ: "읽기",
  WRITE: "읽기+쓰기",
  MANAGE: "관리",
};

/** 화면에서 각 수준이 무엇을 뜻하는지 — 고르는 사람이 짐작하지 않아도 되게 한다. */
export const permissionLevelDescriptions: Record<PermissionLevel, string> = {
  NONE: "메뉴가 보이지 않고, 주소를 직접 입력해도 들어갈 수 없습니다.",
  READ: "보기만 가능합니다. 만들기·고치기·지우기는 할 수 없습니다.",
  WRITE: "보고, 만들고, 고칠 수 있습니다.",
  MANAGE: "쓰기에 더해 지우기·발행·설정 같은 되돌리기 어려운 조작까지 가능합니다.",
};

const LEVEL_RANK: Record<PermissionLevel, number> = { NONE: 0, READ: 1, WRITE: 2, MANAGE: 3 };

export function permissionLevelRank(level: PermissionLevel): number {
  return LEVEL_RANK[level];
}

/** 둘 중 낮은 수준. 실효 권한을 구할 때 쓴다(기존 정책 ∧ 설정값). */
export function lowerPermissionLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

/**
 * 둘 중 높은 수준. 개발자 승격이 **더하기**라서 필요하다 — 진짜 역할의 수준과
 * 최고관리자의 수준 중 높은 쪽이 답이다(developer-promotion.ts).
 *
 * 상한을 구할 때는 쓰지 않는다. 상한은 여전히 낮은 쪽으로만 접힌다.
 */
export function higherPermissionLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/** actual이 required 이상인가. NONE은 어떤 요구도 만족하지 못한다. */
export function meetsPermissionLevel(actual: PermissionLevel, required: PermissionLevel): boolean {
  if (required === "NONE") return true;
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

/** NONE부터 상한까지 — 드롭다운이 내놓을 선택지. 상한보다 높은 수준은 아예 만들지 않는다. */
export function selectablePermissionLevels(ceiling: PermissionLevel): PermissionLevel[] {
  return PERMISSION_LEVELS.filter((level) => LEVEL_RANK[level] <= LEVEL_RANK[ceiling]);
}

export type PermissionArea = {
  /** navigation.ts의 NavItem.key와 같은 값이다 — 영역과 메뉴가 1:1이어야 체크박스가 곧 메뉴 접근이 된다. */
  key: string;
  label: string;
  /** 이 영역이 무엇을 덮는지. 화면에 그대로 보여 준다. */
  description: string;
  /**
   * 이 영역에서 의미가 있는 가장 높은 수준. 여기서 잘라 두는 이유는, 대시보드처럼
   * 볼 것밖에 없는 화면에 "관리"를 내밀면 고른 사람이 무언가 달라졌다고
   * 믿게 되기 때문이다(실제로는 아무것도 달라지지 않는다).
   */
  maxMeaningfulLevel: PermissionLevel;
};

export const PERMISSION_AREAS: readonly PermissionArea[] = [
  {
    key: "dashboard",
    label: "대시보드",
    description: "전체 현황 요약 화면",
    maxMeaningfulLevel: "READ",
  },
  {
    key: "weeklyReport",
    label: "주간보고",
    // 대시보드의 하위메뉴다(navigation.ts 의 parentKey). 상한은 **대시보드와
    // 갈린다** — 이 화면에는 `금주 목표` 상자가 있고, 사람이 거기에 한 줄씩
    // 적는다(weekly_report_goals). 실제로 저장되는 조작이 생겼으므로 상한을
    // 쓰기까지 올린다. 읽기에 머물러 두면 "화면에서는 저장되는데 설정으로는
    // 줄 수 없는 권한"이 된다.
    //
    // 관리는 올리지 않는다. 줄 삭제는 있지만 휴지통도 복원도 없이 바로 지우고,
    // 지워지는 것은 사람이 한 문장 적은 메모라 되돌릴 수 없는 자료가 사라지는
    // 조작이 아니다(weekly-report-authorization.ts 의 '삭제도 같은 집합이다').
    // 쓰기와 갈릴 것이 없는데 '관리'를 내밀면 고른 사람은 무언가 달라졌다고
    // 믿지만 실제로는 아무것도 달라지지 않는다.
    description: "고객사에 보내는 주간 현황판(상태 집계·상세, 그리고 금주 목표)",
    maxMeaningfulLevel: "WRITE",
  },
  {
    key: "repairCases",
    label: "전체 A/S 현황",
    description: "접수 건 목록·상세. 쓰기는 내용 수정, 관리는 삭제·복원",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "myActiveWork",
    label: "내 담당 제품",
    description: "본인에게 배정된 미출하 건 목록",
    maxMeaningfulLevel: "READ",
  },
  {
    key: "repairCaseNew",
    label: "A/S 접수",
    description: "새 접수 건 등록",
    maxMeaningfulLevel: "WRITE",
  },
  {
    key: "customerPortal",
    label: "고객 안내 현황",
    description: "고객사 전용 화면에 나갈 상태·비고와 전용 주소 관리. 관리는 주소 발급·회수 포함",
    /*
     * 관리까지 연다(2026-08-31 전환, 사용자 결정).
     *
     * 예전에는 쓰기까지만 두고 주소 발급·회수는 역할로만 판정했다. 그때의
     * 근거는 "수준을 하나 더 두면 설정에서 표현되는 것처럼 보이지만 실제
     * 판정은 역할이 하므로 고른 사람이 속는다"였다 — 이제 그 판정 자체를
     * 설정으로 옮겼으므로 속일 일이 없다. 세 단계가 실제 조작과 짝이 맞는다:
     *
     *   읽기  고객이 보는 목록을 본다
     *   쓰기  고객에게 나갈 상태·비고를 정하고 내보낸다
     *   관리  전용 주소를 발급·회수하고, 고객 안내 상태 목록을 바꾼다
     *
     * ⚠️ 관리는 가볍지 않다. 전용 주소는 **아는 사람이면 누구나 그 고객사의
     * A/S 현황 전체를 보는 열쇠**이고, 한번 나가면 누구에게 전달됐는지 우리가
     * 알 수 없다. 기본값은 종전대로 관리자 이상이며(permission-baseline.ts),
     * 넓히는 것은 최고관리자가 명시적으로 고를 때만 일어난다.
     */
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "diagnosisFlowcharts",
    label: "진단 Flowchart 관리",
    description: "접수 건별 진단 흐름도. 관리는 영구 삭제 포함",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "workflows",
    label: "워크플로 관리",
    description: "워크플로 템플릿. 쓰기는 초안 편집, 관리는 발행",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "excelKyosanIntakeList",
    label: "일본 본사 Excel 생성",
    description: "본사 제출용 Excel 내려받기",
    maxMeaningfulLevel: "READ",
  },
  {
    key: "users",
    label: "사용자 관리",
    description: "계정 목록·출하 대표자. 관리는 이 권한 설정 화면 포함",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "customers",
    label: "고객사 관리",
    // 관리 수준이 있는 이유: End-User 이름 변경과 담당자 삭제가 관리자 전용이라
    // 쓰기와 갈린다(permission-features.ts의 customers.endUsers / .contacts).
    description: "고객사·End-User·담당자 정보. 관리는 이름 변경·담당자 삭제",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "productModels",
    label: "제품 모델 관리",
    // 관리 수준이 생긴 이유: 모델 삭제·복원이 수정과 갈린다
    // (permission-features.ts의 productModels.lifecycle). 고객사 쪽이
    // End-User 이름 변경 때문에 관리를 갖게 된 것과 같은 구조다.
    description: "제품 모델 마스터. 관리는 모델 삭제·복원",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "technicalProcedures",
    label: "기술 작업 절차",
    description: "작업 절차 문서. 쓰기는 초안 편집, 관리는 발행·보관",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "inventory",
    label: "재고 관리",
    description: "부품 재고·입출고. 관리는 부품 요청 처리 포함",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "domesticOrders",
    label: "내자 정리",
    // 2단계에서 행 추가·수정이 생겨 상한을 쓰기까지 올렸다(1단계 주석이 예고한
    // 그 시점이다). 관리는 아직 올리지 않는다 — 삭제·휴지통이 없는데 '관리'를
    // 내밀면 고른 사람은 무언가 달라졌다고 믿지만 실제로는 아무것도 달라지지
    // 않는다. 삭제를 붙이는 다음 단계에서 함께 올린다.
    description: "국내 수주 진행 상황표(발주·견적·납품·입금). 금액과 입금 정보가 있습니다",
    maxMeaningfulLevel: "WRITE",
  },
  {
    key: "quotes",
    label: "견적서",
    // 삭제·휴지통이 생기면서 상한을 관리까지 올렸다 — 위 주석이 예고했던 그
    // 시점이다. 쓰기와 갈리는 조작이 실제로 생겼다: 만들기·고치기는 영업까지고,
    // 지우고 되살리는 것은 관리자 이상이다(quote-authorization.ts).
    description: "고객사에 보내는 견적서(부품비·작업비·합계). 관리는 삭제·복원",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "repairLabor",
    // 🔴 열쇠(`repairLabor`)는 그대로다. 이름표만 넓혔다(2026-09-04) — 열쇠를
    // 바꾸면 관리자가 역할마다 저장해 둔 접근 수준이 통째로 초기화된다.
    label: "작업 비용",
    // 🔴 **쓰기 수준이 뜻을 갖지 않는다.** 이 화면에는 "내 것 하나를 고친다"가
    // 없다 — 시간당 단가나 공수시간을 바꾸면 앞으로 나갈 **모든 견적서의 금액이**
    // 바뀐다. 그래서 보는 것과 고치는 것 사이에 중간 단계를 두지 않고, 고치는
    // 것은 관리로만 연다(actions/repair-labor.ts 의 같은 판단).
    description:
      "수리 작업별 공수시간·통전작업 공수시간과 시간당·기본 작업비. 관리는 값 수정(모든 견적 금액에 영향)",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "mailSettings",
    label: "메일 설정",
    // 여기서 정한 문구가 전사원 메일로 그대로 나가고, 수신자 목록이 곧 "누가
    // 고객사·S/N·증상을 받아 보는가"다. 보기만 해서 할 일이 없는 화면이라
    // 중간 단계를 두지 않고 관리로만 연다(intake-mail-authorization.ts).
    description: "A/S 접수 알림 메일 — 자동 발송 여부, 수신자, 문구",
    maxMeaningfulLevel: "MANAGE",
  },
  {
    key: "settings",
    label: "시스템 설정",
    description: "시스템 전반 설정",
    maxMeaningfulLevel: "READ",
  },
] as const;

export type PermissionAreaKey = (typeof PERMISSION_AREAS)[number]["key"];

const AREA_BY_KEY = new Map(PERMISSION_AREAS.map((area) => [area.key, area]));

export function findPermissionArea(key: string): PermissionArea | undefined {
  return AREA_BY_KEY.get(key);
}

export function isPermissionAreaKey(key: string): boolean {
  return AREA_BY_KEY.has(key);
}

export function isPermissionLevel(value: string): value is PermissionLevel {
  return (PERMISSION_LEVELS as readonly string[]).includes(value);
}

/** 역할 하나의 전체 설정 — 영역 키 → 수준. */
export type RolePermissionMap = Record<string, PermissionLevel>;

/**
 * 최고관리자는 이 화면에서 편집할 수 없다.
 *
 * 스스로를 잠글 수 있는 설정 화면은 만들면 안 된다 — 모든 역할의 사용자 관리
 * 권한을 꺼 버리면 되돌릴 사람이 아무도 남지 않고, 그 상태는 DB를 직접 고치는
 * 것 말고는 풀 방법이 없다. NAS의 admin 계정을 권한 목록에서 건드릴 수 없게
 * 해 둔 것과 같은 이유다.
 */
export function isRoleEditableInPermissionSettings(role: Role): boolean {
  return role !== "SUPER_ADMIN";
}
