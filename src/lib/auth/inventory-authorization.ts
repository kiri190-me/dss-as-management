import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 🔴 **여기 남은 셋은 「막는 함수」가 아니라 「기본값」이다**
 * ============================================================================
 * 옛 재고 기능은 A/S 에서 통째로 걷혔다(화면·경로 13-A · 서버 액션 13-B ·
 * mutation·조회·도메인·검증 13-C5 · **권한 키 13-D, 2026-10-28**). 그래서 이
 * 파일에 있던 `can*()` 열여섯 중 **열셋과 맥락 헬퍼 일곱을 13-D 에서 지웠다** —
 * 가리킬 조작이 하나도 없어진 것들이다(입고·반품·직접 사용·출고·거부·부분 마감·
 * 부품 등록·부품 삭제·입출고 이력·요청 알림 …).
 *
 * 🔴 **남은 셋이 답하는 것은 「막는가」가 아니다.** A/S 에서 실제로 막는 자리는
 * `hasPermission(… "inventory.requests", …)` 하나뿐이고(수리 건 상세의 페이지
 * 가드와 서버 액션 셋), 그 값은 운영 DB 의 `role_permissions` 가 정한다
 * (`permission-features.ts` 의 SETTINGS_ENFORCED_AREAS — 재고 메뉴는 설정이 최종
 * 판정인 메뉴다). 아래 셋은 **그 설정이 비어 있을 때의 기본값**을 만드는 데만
 * 쓰인다(`auth/permission-baseline.ts` 의 `inventory` 와 `inventory.requests`).
 *
 * 🔴 그래서 여기 적힌 역할을 고치면 **설정을 한 번도 건드리지 않은 역할의 실효
 *    권한이 조용히 바뀐다.** 개발 PC 에는 저장된 행이 없어 바로 드러나지만,
 *    운영에는 저장된 행이 있어 「일부만 바뀌는」 모양이 된다.
 * 🔵 반대로 **새 역할에게 부품 요청을 열어 주는 일은 여기서 하지 않는다** —
 *    사용자 관리 > 역할별 접근 권한 > 재고 관리 > 부품 요청에서 한다.
 *    예외가 최고관리자 하나뿐인 까닭은 canCreatePartRequest 주석에 있다.
 * ============================================================================
 *
 * 아래는 그 기본값이 정해진 2026-08 당시(Phase 5B-3 Parts Request & Issue
 * Workflow)의 정책 기록이다. 그때 이 함수들을 부르던 mutation 이름이 주석에
 * 나오면 **지금은 없는 파일**이다.
 *
 *  - 부품 요청을 올리고 무르는 쪽: AS_ENGINEER, 그리고 SUPER_ADMIN(2026-08-28).
 *  - 남이 올린 요청까지 보고 처리하는 쪽: SUPER_ADMIN / ADMIN /
 *    INVENTORY_MANAGER. AS_ENGINEER 는 자기 요청만 본다.
 *  - SALES 는 요청 화면·액션에 접근하지 않는다 — 빠뜨린 것이 아니라 확인된
 *    결정이다. 그래서 지금도 `inventory` 메뉴 기본값이 이 역할만 접근 불가다.
 *  - 출하 잠금(`ctx.isCaseLocked`)은 **아무도 읽지 않는다.** 부르는 쪽이 여전히
 *    진짜 `repair_cases.is_locked` 값을 넘기고 있어서 인자를 그대로 받아 둔다 —
 *    출하된 건도 부품 요청을 막지 않는다는 정책이고, 까닭의 전문은
 *    repair-case-edit-authorization.ts 의 isBlockedByShipmentLock 에 있다.
 */

/**
 * AS_ENGINEER, 그리고 최고관리자. 수리 건이 반드시 있어야 하고(목적지만 적는
 * 요청은 없다), 그 건의 담당자일 필요는 없다(Parts Request permission
 * checkpoint — 출하된 건도 막지 않는다: shipment-lock removal policy).
 * **대리 작성은 여전히 없다** — 최고관리자가 올려도 자기 이름으로 올라간다.
 *
 * ── 🔴 최고관리자가 왜 코드에 적혀 있는가 ──────────────────────────────
 * inventory 는 설정이 최종 판정인 메뉴다(permission-features.ts 의
 * SETTINGS_ENFORCED_AREAS). 그래서 다른 역할에게 부품 요청을 열어 주는 일은
 * 코드를 고치지 않고 사용자 관리 > 역할별 접근 권한 > 재고 관리 > 부품 요청
 * 에서 한다 — 여기에 역할을 더 적지 말 것.
 *
 * **최고관리자 줄은 설정 화면에서 고칠 수 없다**(permission-areas.ts 의
 * isRoleEditableInPermissionSettings, 저장 액션도 거절한다 — 모두를 잠그면
 * 되돌릴 사람이 남지 않기 때문이다). 최고관리자에게는 이 기본 정책이 곧
 * 실효 권한이라, 열어 줄 자리가 여기밖에 없다(2026-08-28 사용자 요청).
 */
export function canCreatePartRequest(role: Role, ctx: { isCaseLocked: boolean }): boolean {
  void ctx.isCaseLocked;
  return role === "AS_ENGINEER" || role === "SUPER_ADMIN";
}

/**
 * 남이 올린 요청까지 보고 처리하는 쪽. SALES 는 일부러 빠져 있다.
 *
 * 🔵 **처리하는 화면은 2026-10 에 재고 관리로 넘어갔다** — A/S 에는 출고·거부·
 * 부분 마감이 더 이상 없다. 그래도 이 함수가 남아 있는 까닭은 아래
 * canViewPartRequests 가 「누가 남의 요청까지 보는가」를 여기서 구하기 때문이다.
 * 두 답은 같아야 하고, 같아야 하는 값을 두 곳에 적으면 한쪽만 고쳐지는 날이 온다.
 */
export function canProcessPartRequests(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

/** AS_ENGINEER 는 자기 요청만, 위 세 역할은 전부 본다. SALES 는 아무것도 못 본다. */
export function canViewPartRequests(role: Role): boolean {
  return canProcessPartRequests(role) || role === "AS_ENGINEER";
}
