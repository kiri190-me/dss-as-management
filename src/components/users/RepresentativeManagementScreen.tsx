"use client";

import RepresentativeListSection from "./RepresentativeListSection";
import DelegationSection from "./DelegationSection";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { RepresentativeManagementUserRow, ShipmentDelegationRow } from "@/lib/db/queries/shipment-delegations";

/**
 * Top-level orchestrator for the database-mode /users page — shipment
 * representative flagging plus time-bounded delegation management. Both
 * sub-sections independently call router.refresh() after a successful
 * action, which re-runs page.tsx's server-side queries and flows fresh
 * `users`/`delegations` props back down here.
 */
export default function RepresentativeManagementScreen({
  actingUser,
  users,
  delegations,
}: {
  actingUser: ActingUser;
  users: RepresentativeManagementUserRow[];
  delegations: ShipmentDelegationRow[];
}) {
  const isSuperAdmin = actingUser.role === "SUPER_ADMIN";
  const representatives = users.filter((u) => u.isShipmentRepresentative);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">사용자 관리</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          최종 출하 승인 대표 지정과 대리 승인(위임)을 관리합니다.
        </p>
      </div>

      <RepresentativeListSection users={users} isSuperAdmin={isSuperAdmin} />

      <DelegationSection
        actingUser={actingUser}
        isSuperAdmin={isSuperAdmin}
        representatives={representatives}
        allUsers={users}
        delegations={delegations}
      />
    </div>
  );
}
