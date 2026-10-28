import { test } from "node:test";
import assert from "node:assert/strict";
import * as inventoryAuthorization from "./inventory-authorization";
import { canCreatePartRequest, canProcessPartRequests, canViewPartRequests } from "./inventory-authorization";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"];
const PRIVILEGED_ROLES = ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"] as const;

/**
 * ============================================================================
 * 🔴 2026-10-28(조각 13-D) — 이 파일의 시험 스물셋 중 **열여덟을 지웠다**
 * ============================================================================
 * 지운 것은 전부 **A/S 에 더 이상 그 조작이 없는** 함수의 시험이다: 입고·반품·
 * 직접 사용(`canReceiveStock` · `canReturnStock` · `canUseStock` ·
 * `canSeeUseStockButton`) · 출고·거부·부분 마감·취소(`canIssuePartRequest` ·
 * `canRejectPartRequest` · `canPartiallyCloseRequest` · `canCancelOwnRequest`) ·
 * 부품 마스터(`canCreateOrEditPart` · `canDeleteParts`) · 재고 조회와 이력
 * (`canViewInventory` · `canViewTransactionHistory`) · 보류 흐름 헬퍼 다섯 ·
 * 요청 종 알림(`canReceivePartRequestNotifications`, 그 알림 종류는 13-C4 에서
 * 이미 사라졌다). 함수 자체가 같은 조각에서 지워졌으므로 **단언을 약하게 고친
 * 것이 아니라 잴 대상이 없어진 것**이다.
 *
 * 🔴 **남은 셋은 인가 관문이 아니라 기본값**이다 — 실제로 막는 자리는
 * `hasPermission(… "inventory.requests", …)` 하나이고, 그 값은 운영 DB 의
 * `role_permissions` 가 정한다. 아래 단언이 지키는 것은 「설정을 한 번도 건드리지
 * 않은 역할의 답이 2026-08-28 결정 그대로인가」다.
 * ============================================================================
 */

test("🔴 이 파일이 내놓는 것은 셋뿐이다 — 가리킬 조작이 없어진 함수가 되살아나면 깨진다", () => {
  // 🔴 13-D 에서 지운 열셋이 되돌아오거나, A/S 에 없는 조작의 정책 함수가 새로
  // 들어오면 여기서 먼저 걸린다. 「아무도 안 부르는데 인가 함수처럼 생긴 것」이
  // 이 파일에 쌓이던 것이 조각 13 내내 가장 자주 헷갈린 자리였다.
  //
  // 🔵 정말로 더해야 할 함수가 생겼다면 이 목록도 함께 고쳐라 — 다만 그 전에
  //    A/S 안에 그 조작이 실제로 **있는지** 확인해라. 재고 관리(dss-inventory)
  //    쪽 조작이면 이 파일이 아니라 그 저장소의 일이다.
  assert.deepEqual(Object.keys(inventoryAuthorization).sort(), [
    "canCreatePartRequest",
    "canProcessPartRequests",
    "canViewPartRequests",
  ]);
});

test("canCreatePartRequest: AS_ENGINEER 와 최고관리자, 담당자가 아니어도 된다; 출하된 건도 막지 않는다", () => {
  assert.equal(canCreatePartRequest("AS_ENGINEER", { isCaseLocked: false }), true, "any AS_ENGINEER may request, not only the assigned one");
  assert.equal(canCreatePartRequest("AS_ENGINEER", { isCaseLocked: true }), true, "a shipped case no longer blocks an AS_ENGINEER");

  // 최고관리자도 올릴 수 있다 — 역할별 접근 권한 화면이 최고관리자 줄을 고칠
  // 수 없어서, 이 기본 정책이 그 역할의 실효 권한이다(2026-08-28).
  assert.equal(canCreatePartRequest("SUPER_ADMIN", { isCaseLocked: false }), true);
  assert.equal(canCreatePartRequest("SUPER_ADMIN", { isCaseLocked: true }), true);

  // 나머지는 기본값으로 못 한다. 필요하면 코드가 아니라 설정에서 연다.
  for (const role of ["ADMIN", "INVENTORY_MANAGER", "SALES"] as const) {
    assert.equal(canCreatePartRequest(role, { isCaseLocked: false }), false, `${role} 은 기본값으로는 요청을 올리지 못한다`);
  }
});

test("canProcessPartRequests / canViewPartRequests: SALES has zero access, AS_ENGINEER may view (own) but not process", () => {
  assert.deepEqual(ALL_ROLES.filter(canProcessPartRequests).sort(), ["ADMIN", "INVENTORY_MANAGER", "SUPER_ADMIN"]);
  assert.equal(canProcessPartRequests("SALES"), false);
  assert.equal(canProcessPartRequests("AS_ENGINEER"), false);

  assert.equal(canViewPartRequests("AS_ENGINEER"), true, "AS_ENGINEER can view (their own) requests");
  assert.equal(canViewPartRequests("SALES"), false, "SALES has no request-screen access at all");
  for (const role of PRIVILEGED_ROLES) assert.equal(canViewPartRequests(role), true, role);
});

test("🔵 보는 쪽은 처리하는 쪽에서 구한다 — 두 곳에 명단을 적어 두지 않는다", () => {
  // 같아야 하는 값을 두 벌로 적으면 한쪽만 고쳐지는 날이 온다(이 저장소가 여러
  // 번 겪은 어긋남). 엔지니어 한 줄만 더 열리고 나머지는 그대로여야 한다.
  for (const role of ALL_ROLES) {
    assert.equal(
      canViewPartRequests(role),
      canProcessPartRequests(role) || role === "AS_ENGINEER",
      role
    );
  }
  // 🔴 「처리」가 넓어지면 「보기」도 저절로 넓어진다는 사실 자체를 못 박는다 —
  //    SALES 는 둘 다 닫혀 있고, 그래서 `inventory` 메뉴 기본값도 이 역할만
  //    접근 불가다(permission-areas.test.ts 가 그 짝을 잰다).
  assert.equal(canProcessPartRequests("SALES"), false);
  assert.equal(canViewPartRequests("SALES"), false);
});
