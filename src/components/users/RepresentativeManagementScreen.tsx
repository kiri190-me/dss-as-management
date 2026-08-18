"use client";

import { useState } from "react";
import RepresentativeListSection from "./RepresentativeListSection";
import DelegationSection from "./DelegationSection";
import RolePermissionSettings, { type RolePermissionView } from "./RolePermissionSettings";
import type { Role } from "@/lib/domain/types";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
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
 */
export default function RepresentativeManagementScreen({
  actingUser,
  users,
  delegations,
  rolePermissions,
}: {
  actingUser: ActingUser;
  users: RepresentativeManagementUserRow[];
  delegations: ShipmentDelegationRow[];
  /** 관리자 이상일 때만 내려온다. null이면 권한 설정 탭이 없다. */
  rolePermissions: Record<Role, RolePermissionView> | null;
}) {
  const isSuperAdmin = actingUser.role === "SUPER_ADMIN";
  const representatives = users.filter((u) => u.isShipmentRepresentative);
  const [activeTab, setActiveTab] = useState<"representatives" | "permissions">("representatives");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">사용자 관리</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          최종 출하 승인 대표 지정과 대리 승인(위임)을 관리합니다.
        </p>
      </div>

      {rolePermissions && (
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
        </div>
      )}

      {rolePermissions && activeTab === "permissions" ? (
        <RolePermissionSettings actingRole={actingUser.role} initial={rolePermissions} />
      ) : (
        <>
          <RepresentativeListSection users={users} isSuperAdmin={isSuperAdmin} />

          <DelegationSection
            actingUser={actingUser}
            isSuperAdmin={isSuperAdmin}
            representatives={representatives}
            allUsers={users}
            delegations={delegations}
          />
        </>
      )}
    </div>
  );
}
