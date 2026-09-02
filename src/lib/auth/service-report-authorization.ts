import { meetsPermissionLevel, type PermissionLevel } from "./permission-areas";

/**
 * ============================================================================
 * 검사·수리 보고서의 인가 — 누가 보고, 만들고, 지울 수 있나
 * ============================================================================
 * `quote-authorization.ts` 와 같은 자리의 파일이다. 고객사로 나가는 문서를
 * 다루는 규칙이라 판단도 그쪽을 그대로 따른다. 다른 것은 **무엇을 인자로 받는가**
 * 하나뿐이다: 견적서는 `Role` 을 보지만 보고서는 **실효 권한 수준**을 본다.
 *
 * ── 왜 역할이 아니라 수준인가 ───────────────────────────────────────────
 * 보고서에는 자기 메뉴가 없다. 접수 건 상세 안의 한 탭이고, 그래서 권한 영역이
 * 접수 건(`repairCases`)이다. 그 영역의 판정은 이미 설정으로 넘어가 있어서
 * (`permission-resolver.ts` — 실효 권한 = 관리자가 설정한 수준), 여기서 역할
 * 목록을 다시 적으면 **설정 화면에서 정한 것과 다른 답을 내놓는 두 번째 정책**이
 * 생긴다. 그런 어긋남은 조용히 뚫리는 쪽으로 기운다.
 *
 * 그 대신 이 파일은 **순수하다** — DB 도 세션도 만지지 않으므로 단위 시험이
 * 붙는다. 부르는 쪽은 이렇게 쓴다:
 *
 *     const level = await getPermissionLevel(role, SERVICE_REPORT_PERMISSION_AREA);
 *     if (!canEditServiceReports(level)) …
 *
 * 또는 그냥 `hasPermission(role, SERVICE_REPORT_PERMISSION_AREA, 수준)` 이다 —
 * 내려받기 라우트가 이미 그렇게 하고 있고, 아래 상수가 그 수준의 원본이다.
 *
 * ── 🔴 만들기·고치기가 WRITE 인 근거 ────────────────────────────────────
 * **내려받기 창구가 이미 WRITE 를 요구한다**
 * (`api/repair-cases/[id]/service-report/xlsx/route.ts` 의 '왜 READ 가 아니라
 * WRITE 인가'). 그 까닭은 보내는 사람이 문서 내용을 그 자리에서 짓고, 그것이
 * **법인 직인이 찍힌 채 고객사로 나가는 문서**가 되기 때문이다. 저장은 그 문서를
 * 다시 뽑을 수 있게 남겨 두는 일이므로 **그보다 약할 수 없다.** 저장만 READ 로
 * 두면 보기 권한만 가진 사람이 우리 회사 이름으로 "이 장비를 점검했고 원인은
 * 부품불량이었다"고 적어 둘 수 있고, 그 글은 다음 사람이 뽑아 갈 때 그대로
 * 문서가 된다.
 *
 * ── 지우기·되살리기는 MANAGE ────────────────────────────────────────────
 * 보기·고치기보다 좁다. 견적서와 같은 판단이다 — 이미 고객사에 나간 문서라,
 * 지우면 "무엇을 확인했고 원인이 무엇이었다고 알렸는가"의 기록이 목록에서
 * 사라진다. 되살릴 수 있긴 하지만 그 판단을 각자에게 맡기지 않는다. 접수 건의
 * 삭제·복원(`repairCases.lifecycle`)이 MANAGE 인 것과 같은 자리다.
 *
 * 영구 삭제는 없다. 보고서는 접수 건이 영구 삭제될 때 함께 사라진다
 * (`schema/service-reports.ts` 의 «판단 1» — CASCADE). 그래서
 * `canPermanentlyDelete…` 류의 함수도 만들지 않는다.
 * ============================================================================
 */

/**
 * 보고서가 딸린 권한 영역. **자기 영역을 새로 만들지 않는다** — 보고서는 접수
 * 건 상세 안의 탭이고, 접수 건을 볼 수 없는 사람에게 그 건의 보고서만 열어 줄
 * 이유가 없다. 영역을 하나 더 만들면 설정 화면에 "접수 건은 못 보는데 보고서는
 * 보는" 조합이 생기고, 그 경계를 사람이 설명할 수도 지킬 수도 없다.
 */
export const SERVICE_REPORT_PERMISSION_AREA = "repairCases";

/**
 * 조작마다 요구하는 수준. **여기가 원본이다** — 라우트·서버 액션·화면이 각자
 * `"WRITE"` 를 적어 두면 한 곳만 고쳐지는 날이 온다.
 */
export const SERVICE_REPORT_REQUIRED_LEVELS = {
  view: "READ",
  edit: "WRITE",
  delete: "MANAGE",
} as const satisfies Record<string, PermissionLevel>;

/** 보고서 목록과 한 장을 볼 수 있는가. */
export function canViewServiceReports(level: PermissionLevel): boolean {
  return meetsPermissionLevel(level, SERVICE_REPORT_REQUIRED_LEVELS.view);
}

/**
 * 보고서를 만들거나 고칠 수 있는가. 🔴 내려받기와 같은 수준이다 — 위 '만들기·
 * 고치기가 WRITE 인 근거' 참조.
 */
export function canEditServiceReports(level: PermissionLevel): boolean {
  return meetsPermissionLevel(level, SERVICE_REPORT_REQUIRED_LEVELS.edit);
}

/** 휴지통으로 보내고 되살릴 수 있는가. 둘을 나누지 않는 것은 "지울 수는 있는데 되돌릴 수는 없는" 역할을 만들지 않기 위해서다. */
export function canDeleteServiceReports(level: PermissionLevel): boolean {
  return meetsPermissionLevel(level, SERVICE_REPORT_REQUIRED_LEVELS.delete);
}
