"use client";

import { useState } from "react";
import RepresentativeListSection from "./RepresentativeListSection";
import DelegationSection from "./DelegationSection";
import RolePermissionSettings, { type RolePermissionScreenData } from "./RolePermissionSettings";
import NotificationSettings from "./NotificationSettings";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { NotificationSettingsScreenData } from "@/lib/domain/notification-settings";
import type { RepresentativeManagementUserRow, ShipmentDelegationRow } from "@/lib/db/queries/shipment-delegations";

/**
 * Top-level orchestrator for the database-mode /users page — shipment
 * representative flagging plus time-bounded delegation management. Both
 * sub-sections independently call router.refresh() after a successful
 * action, which re-runs page.tsx's server-side queries and flows fresh
 * `users`/`delegations` props back down here.
 *
 * 2026-08-19: 역할별 접근 권한 설정이 두 번째 탭으로 들어왔다. 별도 메뉴가 아니라
 * 탭인 이유는 요구가 "사용자 관리에서" 였고, 실제로도 계정을 보다가 "이 역할은
 * 어디까지 되지?"를 확인하는 흐름이라 같은 화면에 있는 편이 맞다.
 * rolePermissions가 null이면 탭 자체를 그리지 않는다 — 관리자 미만에게는
 * 서버가 아예 자료를 내려주지 않으므로, 화면에 감추는 것이 아니라 없는 것이다.
 *
 * 2026-08-27: 알림 설정이 세 번째 탭으로 들어왔다. 같은 방식이다 —
 * notificationSettings가 null이면 그 탭을 아예 그리지 않는다. 두 자료를 따로
 * 받는 이유는, 지금은 두 탭의 권한이 같지만 갈라지는 날에 화면이 한쪽만 감출
 * 수 있어야 하기 때문이다(각자 자기 자료가 있으면 보이고, 없으면 없다).
 */
export default function RepresentativeManagementScreen({
  actingUser,
  users,
  delegations,
  rolePermissions,
  notificationSettings,
  canManageRepresentatives,
}: {
  actingUser: ActingUser;
  users: RepresentativeManagementUserRow[];
  delegations: ShipmentDelegationRow[];
  /** 관리자 이상일 때만 내려온다. null이면 권한 설정 탭이 없다. */
  rolePermissions: RolePermissionScreenData | null;
  /** 관리자 이상일 때만 내려온다. null이면 알림 설정 탭이 없다. */
  notificationSettings: NotificationSettingsScreenData | null;
  /**
   * 🔴 「최고관리자인가」가 아니라 **「대표 지정·위임을 관리해도 되는가」**다.
   *
   * 예전에는 여기서 `actingUser.role === "SUPER_ADMIN"` 을 직접 계산했다. 서버
   * mutation 세 곳(shipment-representatives.ts, shipment-delegations.ts 의
   * 생성·철회)은 그때도 이미 `hasPermission(actor,
   * "users.shipmentRepresentatives", "MANAGE")` 으로 판정했고, 기본 정책이
   * `MANAGE = 최고관리자` 라서 다섯 역할에서는 두 답이 같았다. 개발자 표시가
   * 생기면서 갈렸다 — 서버는 허용하는데 단추가 잠겼다.
   *
   * 그래서 판정을 화면에서 하지 않는다. 서버 페이지(app/(app)/users/page.tsx)가
   * 서버와 **같은 영역 열쇠·같은 수준**으로 계산해 내려보낸다. 이 화면은
   * 클라이언트 컴포넌트라 hasPermission 을 await 할 수 없다.
   */
  canManageRepresentatives: boolean;
}) {
  const representatives = users.filter((u) => u.isShipmentRepresentative);
  const [activeTab, setActiveTab] = useState<"representatives" | "permissions" | "notifications">(
    "representatives"
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">사용자 관리</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          최종 출하 승인 대표 지정과 대리 승인(위임)을 관리합니다.
        </p>
      </div>

      {(rolePermissions || notificationSettings) && (
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab("representatives")}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === "representatives"
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            출하 대표자 / 위임
          </button>
          {rolePermissions && (
            <button
              type="button"
              onClick={() => setActiveTab("permissions")}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                activeTab === "permissions"
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              역할별 접근 권한
            </button>
          )}
          {notificationSettings && (
            <button
              type="button"
              onClick={() => setActiveTab("notifications")}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                activeTab === "notifications"
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              알림 설정
            </button>
          )}
        </div>
      )}

      {rolePermissions && activeTab === "permissions" ? (
        <RolePermissionSettings actingRole={actingUser.role} data={rolePermissions} />
      ) : notificationSettings && activeTab === "notifications" ? (
        <NotificationSettings data={notificationSettings} />
      ) : (
        <>
          {/* 아래 두 화면의 prop 이름도 이제 값이 뜻하는 바와 같다
              (2026-09-07). 예전에는 `isSuperAdmin` 이었는데, 넘기는 값은
              「대표 지정·위임을 관리해도 되는가」이고 개발자 표시가 생기면서
              최고관리자 여부와 갈렸다 — 이름이 거짓말을 하고 있었다. */}
          <RepresentativeListSection users={users} canManageRepresentatives={canManageRepresentatives} />

          <DelegationSection
            actingUser={actingUser}
            canManageRepresentatives={canManageRepresentatives}
            representatives={representatives}
            allUsers={users}
            delegations={delegations}
          />
        </>
      )}
    </div>
  );
}
