import { ROLE_CODES, type Role } from "@/lib/domain/types";

/**
 * 개선 요청(설정 › 「개선 요청」) 권한의 **역할 기본값** — 다른 *-authorization.ts
 * 와 같은 관례를 따른다: Role 만 보는 순수 함수다. 권한 영역 `improvementRequests`
 * 의 역할별 기본 수준을 permission-baseline.ts 가 이 함수들로 정한다(다음 조각에서
 * 연결한다 — 지금은 아무 데서도 부르지 않는다).
 *
 * 막는 곳은 여기가 아니다. 페이지와 서버 액션이 관리자 설정(role_permissions)까지
 * 함께 본 실효 권한으로 각자 다시 검사한다.
 *
 * 정책(승인된 설계, 2026-09-13):
 *
 *  - **보기·적기는 모든 역할이다.** 개선 요청은 「이 시스템을 쓰다가 불편한 점」을
 *    적는 곳이라, 쓰는 사람 누구나 적을 수 있어야 뜻이 있다. 목록도 모두가 본다 —
 *    같은 요청이 두 번 올라오지 않게, 그리고 내 요청이 어디까지 왔는지 보게.
 *    아무도 막지 않는 함수를 굳이 두는 것은 권한 영역의 기본 수준을 역할마다
 *    정해야 하기 때문이다(permission-baseline.ts 가 모든 영역에 대해 묻는다).
 *    알 수 없는 역할 값에는 거짓을 답한다 — 세션이 망가졌을 때 열어 주지 않는다.
 *
 *  - **관리(상태 바꾸기 · 남의 글 지우기)는 최고관리자 · 관리자다.** 상태는 「이
 *    요청을 받아 움직이고 있다」는 약속이라, 그 약속을 할 수 있는 자리만 바꾼다.
 *    남의 글 **내용을 고치는 것은 관리자도 못 한다** — 그 판정은 역할이 아니라 글
 *    한 건의 문제라 domain/improvement-request.ts 의 canEditImprovementRequestBody 가
 *    답한다.
 *
 *  - **개발자는 여기서 따로 다루지 않는다.** 개발자 표시가 켜진 사람은 권한 판정이
 *    진짜 역할에 최고관리자를 더해 읽으므로(permission-resolver.ts 의
 *    permissionRoles) 관리 권한이 저절로 따라온다. 여기에 개발자 분기를 또 적으면
 *    같은 규칙이 두 벌이 된다.
 */

function isKnownRole(role: Role): boolean {
  return (ROLE_CODES as readonly string[]).includes(role);
}

/** 목록 보기 — 모든 역할. */
export function canViewImprovementRequests(role: Role): boolean {
  return isKnownRole(role);
}

/** 글 적기 — 모든 역할. 자기 글을 고치고 지우는 것은 도메인이 글 한 건마다 답한다. */
export function canWriteImprovementRequests(role: Role): boolean {
  return isKnownRole(role);
}

/** 관리(상태 바꾸기 · 남의 글 지우기) — 최고관리자 · 관리자. */
export function canManageImprovementRequests(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
