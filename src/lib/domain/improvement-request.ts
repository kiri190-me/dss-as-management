import { childNavItems, navGroups, navItems } from "@/lib/navigation";

/**
 * ============================================================================
 * 개선 요청 — 순수 규칙 (상태 옮기기 · 누가 무엇을 · 어느 메뉴의 일인가)
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. 화면·서버 액션·mutation 이 **같은 함수**를
 * 보게 하려고 따로 뺀 자리다 — 규칙을 두 곳에 적으면 화면은 단추를 열어 주는데
 * 저장이 거절하거나, 반대로 화면만 막고 저장은 열려 있는 상태가 된다.
 *
 * 표 구조와 설계의 이유는 db/schema/improvement-requests.ts 머리말에 있다.
 *
 * ── 🔴 상태 칸 규칙은 DB CHECK 와 같다 ──────────────────────────────────
 * planImprovementRequestStatusChange 가 돌려주는 네 칸은 스키마의
 * `improvement_requests_*_pair` · `improvement_requests_status_columns` CHECK 를
 * 언제나 지킨다. 여기를 고치면 그 CHECK 도 함께 고칠 것(마이그레이션이 필요하다).
 *
 * ── 권한은 여기서 계산하지 않는다 ──────────────────────────────────────
 * 「상태를 바꿀 수 있는가」·「남의 글을 지울 수 있는가」(관리 권한)는 역할과
 * 관리자 설정(role_permissions)을 함께 봐야 하는 질문이라 서버가 답한다. 이 파일은
 * 그 답을 **인자로 받아** 글 한 건에 대해서만 판정한다.
 * ============================================================================
 */

/** 값 목록. 🔴 스키마의 improvement_request_status 와 글자 그대로 같아야 한다(시험이 맞춰 본다). */
export const IMPROVEMENT_REQUEST_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

export type ImprovementRequestStatus = (typeof IMPROVEMENT_REQUEST_STATUSES)[number];

export const IMPROVEMENT_REQUEST_STATUS_LABELS: Record<ImprovementRequestStatus, string> = {
  OPEN: "접수",
  IN_PROGRESS: "진행중",
  RESOLVED: "해결",
};

export function isImprovementRequestStatus(value: unknown): value is ImprovementRequestStatus {
  return (
    typeof value === "string" &&
    (IMPROVEMENT_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * 본문 상한(글자 = 코드 포인트). 🔴 스키마의 `improvement_requests_body_length`
 * CHECK 와 같은 수다 — 검증 시험이 스키마 파일의 글자를 읽어 대조한다.
 */
export const IMPROVEMENT_REQUEST_BODY_MAX_CHARS = 2000;

/**
 * 본문 글자 수. Postgres 의 char_length 와 같게 **코드 포인트**로 센다 —
 * `string.length`(UTF-16 단위)로 세면 이모지 하나가 둘로 세어져, 검증은 거절하는데
 * DB 는 받는 값(또는 그 반대)이 생긴다.
 */
export function countImprovementRequestBodyChars(text: string): number {
  return Array.from(text).length;
}

// ────────────────────────────────────────────────── 상태 옮기기

/** 상태에 딸린 네 칸 — 누가 언제 진행중으로, 누가 언제 해결로 옮겼는가. */
export type ImprovementRequestProgressFields = {
  inProgressBy: string | null;
  inProgressAt: Date | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
};

export type ImprovementRequestStatusChangePlan =
  /** 같은 상태로의 변경. 저장도 감사 로그도 만들지 않는다. */
  | { kind: "unchanged" }
  | {
      kind: "changed";
      status: ImprovementRequestStatus;
      /** 저장할 네 칸 전부. 부분이 아니다 — 그대로 SET 에 넣으면 된다. */
      fields: ImprovementRequestProgressFields;
    };

/**
 * 상태를 `from` 에서 `to` 로 옮길 때 네 칸을 어떻게 채우고 비울지 계산한다.
 *
 *  · 접수(OPEN)로 가면 네 칸을 **모두 비운다** — 되돌린 글은 처음 접수된 글과
 *    구별되지 않는다. 누가 되돌렸는지는 감사 로그가 남긴다.
 *  · 진행중(IN_PROGRESS)으로 가면 in_progress 쌍 = (행위자, 지금), resolved 쌍은
 *    비운다. 해결에서 되돌려 온 경우에도 in_progress 쌍은 **지금 옮긴 사람으로
 *    새로 적힌다** — 이 칸은 「지금 이 글을 맡은 사람」이다.
 *  · 해결(RESOLVED)로 가면 resolved 쌍 = (행위자, 지금), in_progress 쌍은 **그대로
 *    둔다** — 진행중을 거쳐 왔으면 그 기록이 남고, 접수에서 곧바로 왔으면 비어
 *    있는 채다(스키마 헤더의 '상태와 네 칸은 같은 말이어야 한다').
 *  · 같은 상태로의 변경은 `unchanged` 다. 진행중을 다시 진행중으로 누른다고 맡은
 *    사람이 바뀌지 않는다.
 *
 * 「지금」은 인자로 받는다 — 시험이 시계에 매이지 않게, 그리고 mutation 이 한
 * 트랜잭션 안에서 updated_at 과 같은 시각을 쓰게.
 *
 * `current` 는 DB 에서 읽은 지금 값이다. DB CHECK 를 지키는 행이라고 가정한다.
 */
export function planImprovementRequestStatusChange(input: {
  from: ImprovementRequestStatus;
  to: ImprovementRequestStatus;
  current: ImprovementRequestProgressFields;
  actorUserId: string;
  now: Date;
}): ImprovementRequestStatusChangePlan {
  const { from, to, current, actorUserId, now } = input;
  if (from === to) return { kind: "unchanged" };

  switch (to) {
    case "OPEN":
      return {
        kind: "changed",
        status: to,
        fields: { inProgressBy: null, inProgressAt: null, resolvedBy: null, resolvedAt: null },
      };
    case "IN_PROGRESS":
      return {
        kind: "changed",
        status: to,
        fields: { inProgressBy: actorUserId, inProgressAt: now, resolvedBy: null, resolvedAt: null },
      };
    case "RESOLVED":
      return {
        kind: "changed",
        status: to,
        fields: {
          inProgressBy: current.inProgressBy,
          inProgressAt: current.inProgressAt,
          resolvedBy: actorUserId,
          resolvedAt: now,
        },
      };
  }
}

// ────────────────────────────────────────────────── 누가 무엇을

/**
 * 이 사람이 이 글의 **내용을** 고칠 수 있는가 — 접수 상태인 자기 글일 때만.
 *
 * 관리 권한이 있어도 남의 글 내용은 못 고친다(승인된 설계). 글은 적은 사람의
 * 말이고, 관리자가 고치면 「누가 무엇을 요청했는가」가 흐려진다. 진행중·해결이
 * 되면 작성자도 못 고친다 — 맡은 사람이 읽고 움직이기 시작한 글이 발밑에서
 * 바뀌면 안 된다.
 */
export function canEditImprovementRequestBody(input: {
  status: ImprovementRequestStatus;
  createdBy: string;
  actorUserId: string;
}): boolean {
  return input.status === "OPEN" && input.createdBy === input.actorUserId;
}

/**
 * 이 사람이 이 글을 지울 수 있는가 — 관리 권한이 있으면 어느 글이든, 없으면
 * 접수 상태인 자기 글만.
 *
 * `canManage` 는 서버가 역할과 관리자 설정으로 계산해 넘긴다(파일 헤더의 '권한은
 * 여기서 계산하지 않는다').
 */
export function canDeleteImprovementRequest(input: {
  status: ImprovementRequestStatus;
  createdBy: string;
  actorUserId: string;
  canManage: boolean;
}): boolean {
  if (input.canManage) return true;
  return input.status === "OPEN" && input.createdBy === input.actorUserId;
}

// ────────────────────────────────────────────────── 목록 차례

/**
 * 목록에 놓는 상태의 차례 — 진행중 → 접수 → 해결.
 *
 * 진행중이 맨 위인 것은 「지금 누가 무엇을 하고 있는가」가 이 화면에서 가장 먼저
 * 궁금한 것이라서다. 접수는 그다음 — 아직 아무도 맡지 않은 글이 거기 쌓인다.
 * 해결은 끝난 일이라 맨 아래이고, 화면은 기본으로 감춘다.
 */
export const IMPROVEMENT_REQUEST_LIST_STATUS_ORDER: readonly ImprovementRequestStatus[] = [
  "IN_PROGRESS",
  "OPEN",
  "RESOLVED",
];

/** 차례를 정하는 데 필요한 칸만. 조회 결과(ImprovementRequestListItem)가 그대로 맞는다. */
export type ImprovementRequestListEntry = {
  id: string;
  status: ImprovementRequestStatus;
  /** ISO 문자열 — 서버가 클라이언트로 넘기는 모양 그대로다. */
  createdAt: string;
};

export type ArrangedImprovementRequestList<T> = {
  /** 화면에 그릴 줄, 그릴 차례대로. */
  rows: T[];
  /** 해결된 글 전부의 수 — 감췄든 안 감췄든. */
  resolvedCount: number;
  /** 이번에 감춘 해결 글의 수. 해결된 것도 보기가 켜져 있으면 0 이다. */
  hiddenResolvedCount: number;
};

/**
 * 목록을 화면에 놓을 차례로 세우고, 해결된 글을 감출지 정한다.
 *
 *  · 상태는 IMPROVEMENT_REQUEST_LIST_STATUS_ORDER 차례다.
 *  · 같은 상태 안에서는 **최근에 적힌 글부터**(createdAt 내림차순). 상태를 옮긴
 *    시각이 아니라 적힌 시각이다 — 누가 상태를 누를 때마다 줄이 뛰면 읽던 자리를
 *    잃는다.
 *  · 같은 시각이면 id 내림차순 — 조회(listImprovementRequests)의 동점 규칙과 같아,
 *    새로 고칠 때마다 두 줄이 자리를 바꾸지 않는다.
 *
 * 받은 배열은 건드리지 않는다(새 배열을 돌려준다) — 서버가 넘긴 props 다.
 */
export function arrangeImprovementRequestList<T extends ImprovementRequestListEntry>(
  items: readonly T[],
  options: { showResolved: boolean }
): ArrangedImprovementRequestList<T> {
  const rank = (status: ImprovementRequestStatus) => IMPROVEMENT_REQUEST_LIST_STATUS_ORDER.indexOf(status);
  const sorted = [...items].sort((a, b) => {
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    const byCreatedAt = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });

  const resolvedCount = sorted.filter((item) => item.status === "RESOLVED").length;
  if (options.showResolved) {
    return { rows: sorted, resolvedCount, hiddenResolvedCount: 0 };
  }
  return {
    rows: sorted.filter((item) => item.status !== "RESOLVED"),
    resolvedCount,
    hiddenResolvedCount: resolvedCount,
  };
}

// ────────────────────────────────────────────────── 어느 메뉴의 일인가

/*
 * 개선 요청이 **어느 메뉴 아래의 일인가**(2026-09-13, 사용자 요청).
 *
 * ── 🔴 이름이 아니라 열쇠를 저장한다 ────────────────────────────────────
 * 표의 menu_key 칸에는 navItems 의 `key`("repairCases" 같은)가 들어간다. 이름표
 * ("전체 A/S 현황")를 담아 두면 사이드바 이름을 고치는 날 옛 글이 가리키는 메뉴를
 * 잃는다. 열쇠는 역할별 접근 권한도 쓰는 값이라 함부로 바뀌지 않는다
 * (navigation.ts 의 repairLabor 주석).
 *
 * ── 🔴 메뉴 이름을 여기에 따로 적지 않는다 ──────────────────────────────
 * 목록도 이름도 전부 navigation.ts 의 navItems · navGroups 에서 만든다. 여기에
 * 이름을 한 벌 더 적으면 사이드바 이름이 바뀔 때 이 화면만 옛 이름으로 남는다.
 * navigation.ts 는 DB·서버를 가져오지 않는 순수 모듈이라(가져오는 것은
 * auth/developer-mode-gate.ts 의 상수 하나이고, 그 파일은 타입만 가져온다) 이 파일이
 * import 해도 머리말의 「DB 도 서버도 만지지 않는다」가 깨지지 않는다.
 *
 * ── 차례는 사이드바 그대로다 ────────────────────────────────────────────
 * 대시보드 → 그 하위메뉴(주간보고) → navGroups 차례대로 각 구획의 itemKeys 차례
 * → 맨 끝에 「기타 · 메뉴 밖」. components/layout/Sidebar.tsx 가 그리는 차례와
 * 같다 — 사람이 늘 보는 차례라 목록에서 찾기 쉽다. 모든 navItems 가 정확히 한 번
 * 들어가는지는 시험이 단언한다.
 *
 * ── 열쇠 → 이름은 세 경우가 더 있다 ────────────────────────────────────
 *  · NULL → 「메뉴 지정 안 함」 — menu_key 칸이 생기기 전에 적힌 글이다.
 *  · 기타 → 「기타 · 메뉴 밖」 — 어느 메뉴에도 속하지 않는 요청(로그인, 인쇄 등).
 *  · 모르는 열쇠 → 「(없어진 메뉴)」 — 메뉴가 사이드바에서 빠진 뒤의 옛 글이다.
 *    DB 에 CHECK 가 없으므로(스키마 헤더) 그런 행은 남아 있을 수 있다.
 */

/** 「기타 · 메뉴 밖」의 열쇠. 🔴 navItems 의 어떤 key 와도 겹치지 않아야 한다(시험이 단언). */
export const IMPROVEMENT_REQUEST_OTHER_MENU_KEY = "other";
export const IMPROVEMENT_REQUEST_OTHER_MENU_LABEL = "기타 · 메뉴 밖";
/** menu_key 가 NULL 인 글 — 메뉴 칸이 생기기 전에 적힌 글. */
export const IMPROVEMENT_REQUEST_NO_MENU_LABEL = "메뉴 지정 안 함";
/** 사이드바에서 빠진 메뉴를 가리키는 옛 글. */
export const IMPROVEMENT_REQUEST_UNKNOWN_MENU_LABEL = "(없어진 메뉴)";

/** 사이드바가 단독으로 그리고 그 아래에 하위메뉴를 들여 그리는 항목(Sidebar.tsx 의 DASHBOARD_KEY). */
const DASHBOARD_MENU_KEY = "dashboard";

export type ImprovementRequestMenuOption = {
  /** 저장할 값 — navItems 의 key, 또는 IMPROVEMENT_REQUEST_OTHER_MENU_KEY. */
  key: string;
  /** 사이드바 이름표 그대로(기타는 「기타 · 메뉴 밖」). */
  label: string;
  /**
   * 사이드바 구획 이름(「A/S 업무」 등) — 화면이 `<optgroup>` 으로 묶는 데 쓴다.
   * 대시보드 · 그 하위메뉴 · 기타는 구획이 없어 null 이다.
   */
  groupLabel: string | null;
};

/**
 * 고를 수 있는 메뉴 전부, 사이드바 차례대로, 맨 끝에 기타.
 *
 * 접근 권한으로 거르지 않은 **전체 목록**이다 — 검증(isImprovementRequestMenuKey)이
 * 이 목록으로 판정한다.
 */
export function listImprovementRequestMenuOptions(): ImprovementRequestMenuOption[] {
  const byKey = new Map(navItems.map((item) => [item.key, item]));
  const options: ImprovementRequestMenuOption[] = [];

  const dashboard = byKey.get(DASHBOARD_MENU_KEY);
  if (dashboard) {
    options.push({ key: dashboard.key, label: dashboard.label, groupLabel: null });
    for (const child of childNavItems(navItems, DASHBOARD_MENU_KEY)) {
      options.push({ key: child.key, label: child.label, groupLabel: null });
    }
  }

  for (const group of navGroups) {
    for (const key of group.itemKeys) {
      const item = byKey.get(key);
      if (item) options.push({ key: item.key, label: item.label, groupLabel: group.label });
    }
  }

  options.push({
    key: IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    label: IMPROVEMENT_REQUEST_OTHER_MENU_LABEL,
    groupLabel: null,
  });
  return options;
}

/** 이 값이 고를 수 있는 메뉴 열쇠인가(사이드바의 항목이거나 기타). */
export function isImprovementRequestMenuKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    listImprovementRequestMenuOptions().some((option) => option.key === value)
  );
}

/**
 * 열쇠 → 화면에 보일 이름. NULL · 기타 · 모르는 열쇠의 세 경우는 위 구획 주석의
 * '열쇠 → 이름은 세 경우가 더 있다'.
 */
export function improvementRequestMenuLabel(menuKey: string | null): string {
  if (menuKey === null) return IMPROVEMENT_REQUEST_NO_MENU_LABEL;
  const option = listImprovementRequestMenuOptions().find((o) => o.key === menuKey);
  return option ? option.label : IMPROVEMENT_REQUEST_UNKNOWN_MENU_LABEL;
}
