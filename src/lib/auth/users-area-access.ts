import "server-only";

import { cache } from "react";
import { getAuthSource } from "@/lib/config/auth-source";
import { isOnCurrentShipmentApprovalRoute } from "@/lib/db/queries/shipment-approval-routes";
import { hasAreaAccess } from "./area-guard";
import type { PermissionActor } from "./permission-resolver";

/**
 * ============================================================================
 * [사용자 관리]에 들어갈 수 있는가 — **두 길을 한 곳에서 판정한다**
 * ============================================================================
 * 2026-10-26: 「결재권 위임」 탭을 만들고 「누구나 자기 결재권은 맡길 수 있다」로
 * 정했는데, **정작 엔지니어는 그 화면에 들어갈 수가 없었다.** 운영·개발 DB 의
 * `role_permissions` 에 이렇게 저장돼 있기 때문이다(2026-08-19 에 일부러 끈 설정):
 *
 *     AS_ENGINEER        users.view   NONE
 *     SALES              users.view   NONE
 *     INVENTORY_MANAGER  users.view   NONE
 *
 * 코드의 기본 정책(`permission-baseline.ts`)은 「로그인한 누구나 read」지만
 * **저장값이 기본을 이긴다**(permission-resolver.ts). 그래서 메뉴에 항목이 아예
 * 안 뜨고, 결재선에 박힌 사람이 자리를 비울 때 **관리자에게 부탁하는 수밖에**
 * 없었다 — 그 결정과 정면으로 어긋난다.
 *
 * 🔴 **고치는 자리는 저장값이 아니라 코드다.** 설정은 일부러 끈 것이라 되돌리면
 * 엔지니어에게 사용자 목록·역할 설정이 통째로 열린다. 그래서 여기서 **문 하나만**
 * 연다: 「지금 쓰이는 결재선에 이름이 올라 있는 사람」.
 *
 * ── 🔴 메뉴와 페이지가 **같은 함수**를 본다 ──────────────────────────────
 * 이 판정이 두 벌로 적히면 「메뉴에는 뜨는데 눌러도 쫓겨난다」(또는 그 반대)가 되고,
 * 그 어긋남은 오류를 내지 않아 사람이 포기할 때까지 조용하다. 그래서 규칙을 적는
 * 곳이 이 파일 하나다:
 *
 *   · 사이드바 · 「지금 이용할 수 있는 메뉴」 → `mayEnterUsersArea` 로 거른다
 *     (app/(app)/layout.tsx · no-access/page.tsx → navigation.ts)
 *   · /users 페이지의 관문                    → `requireUsersAreaAccess`
 *   · 탭 노출 · 내려보낼 자료                 → `hasUsersPermission`
 *
 * ── 🔴 열리는 것은 **탭 하나뿐**이다 ───────────────────────────────────
 * `hasUsersPermission` 이 거짓인 사람에게 보이는 것은 「결재권 위임」 탭 하나이고,
 * 서버 페이지는 **다른 탭이 쓰는 자료를 아예 읽지 않는다**(사용자 목록 · 출하
 * 대표 위임 · 결재선 판 · 결재선 후보). 클라이언트 컴포넌트에 넘긴 값은 그리지
 * 않아도 HTML 에 실려 나가므로, 「탭을 안 그린다」만으로는 아무것도 못 막는다.
 * ============================================================================
 */

/** 영역 열쇠. 🔴 메뉴 항목 열쇠(`navItems` 의 `users`)와 **같은 글자**여야 한다. */
export const USERS_AREA_KEY = "users";

export type UsersAreaAccess = {
  /**
   * 역할별 접근 권한 설정이 열어 준 쪽. 🔴 **이 값이 「관리자인가」다** — 탭 넷과
   * 그 자료가 전부 이 값에 달려 있다.
   */
  hasUsersPermission: boolean;
  /**
   * 지금 쓰이는 결재선(어느 용도든)에 이름이 올라 있는가. 🔴 **옛 판은 안 센다**
   * (queries/shipment-approval-routes.ts 의 isOnCurrentShipmentApprovalRoute).
   */
  isOnCurrentApprovalRoute: boolean;
  /** 둘 중 하나라도 참이면 들어갈 수 있다. 🔴 **메뉴와 관문이 둘 다 이 값을 본다.** */
  mayEnterUsersArea: boolean;
};

/**
 * 결재선 조회만 요청 단위로 묶는다 — 한 요청 안에서 레이아웃과 페이지가 각각 묻기
 * 때문이다(권한 쪽은 `permission-resolver` 가 이미 요청 단위로 묶고 있다).
 *
 * 🔴 열쇠가 **글자 하나**라 캐시가 실제로 맞는다. 사람 객체를 통째로 넘기면
 * 레이아웃과 페이지가 서로 다른 객체를 만들어 캐시가 한 번도 맞지 않는다(React 의
 * `cache` 는 인자를 같음(===)으로 본다) — 조용히 질의가 두 배가 된다.
 *
 * 🔴 데이터베이스 모드가 아니면 **묻지 않는다.** 데모 모드에는 결재선 표가 없을 수
 * 있고, 그때 던지면 이 판정을 부르는 레이아웃이, 곧 모든 화면이 깨진다. 닫히는
 * 쪽으로 물러선다 — 잃는 것은 데모 모드에서 이 문이 안 열리는 것 하나뿐이고,
 * 데모 모드의 /users 는 어차피 안내 화면이다.
 */
const onCurrentApprovalRoute = cache(async (userId: string): Promise<boolean> => {
  if (getAuthSource() !== "database") return false;
  return isOnCurrentShipmentApprovalRoute(userId);
});

/**
 * 🔴 **이 판정이 적힌 유일한 곳.** 두 조회를 한 묶음으로 던져 왕복이 늘지 않게 한다 —
 * 레이아웃에 붙는 판정이라 **모든 화면**이 이 비용을 치른다.
 *
 * 🔵 권한이 있으면 결재선 조회를 건너뛸 수도 있지만(그때 답은 이미 정해진다) 그렇게
 * 하지 않는다. 건너뛰면 `isOnCurrentApprovalRoute` 가 **관리자에게만 거짓말**을 하게
 * 되고, 그 값을 다른 데 쓰기 시작하는 날 까닭 없이 틀린다.
 */
export async function resolveUsersAreaAccess(
  actor: PermissionActor & { id: string }
): Promise<UsersAreaAccess> {
  const [hasUsersPermission, isOnCurrentApprovalRoute] = await Promise.all([
    hasAreaAccess(USERS_AREA_KEY, actor),
    onCurrentApprovalRoute(actor.id),
  ]);
  return {
    hasUsersPermission,
    isOnCurrentApprovalRoute,
    mayEnterUsersArea: hasUsersPermission || isOnCurrentApprovalRoute,
  };
}
