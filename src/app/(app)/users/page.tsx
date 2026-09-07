import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import RepresentativeManagementScreen from "@/components/users/RepresentativeManagementScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { listUsersForRepresentativeManagement, listShipmentDelegations } from "@/lib/db/queries/shipment-delegations";
import { canManageRolePermissions } from "@/lib/auth/role-permission-authorization";
import { canManageNotificationSettings } from "@/lib/auth/notification-settings-authorization";
import { requireAreaAccess } from "@/lib/auth/area-guard";
import { buildRolePermissionViews } from "@/lib/auth/role-permission-views";
import { buildNotificationSettingsView } from "@/lib/db/queries/notification-settings";

export const metadata: Metadata = {
  title: "사용자 관리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Local/mock mode keeps the original placeholder verbatim — this page's
 * content is entirely a database-mode feature (shipment representative
 * flagging + delegation), same "no meaning outside database mode" pattern
 * as the rest of this task's server actions.
 */
export default async function UsersPage() {
  const authSource = getAuthSource();
  if (authSource !== "database") {
    return (
      <PlaceholderPage
        title="사용자 관리"
        description="추후 이 화면에서 사용자 계정을 관리할 수 있습니다."
      />
    );
  }

  // (app)/layout.tsx already guarantees a valid, resolved, APPROVED session
  // by the time any page under it renders — this is defensive only.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    redirect("/login");
  }

  await requireAreaAccess("users", actingUser);

  const [users, delegations] = await Promise.all([
    listUsersForRepresentativeManagement(),
    listShipmentDelegations(),
  ]);

  // 관리자 미만에게는 아예 내려보내지 않는다. 화면에서 탭을 감추는 것만으로는
  // 다른 역할의 권한 구성이 HTML에 실려 나가는 것을 막지 못한다. 알림 설정도
  // 같다 — 어느 역할이 무엇을 받는지는 그 자체가 조직 구성 정보다.
  const [rolePermissions, notificationSettings] = await Promise.all([
    canManageRolePermissions(actingUser.role)
      ? buildRolePermissionViews({ actorRole: actingUser.role })
      : Promise.resolve(null),
    canManageNotificationSettings(actingUser.role)
      ? buildNotificationSettingsView()
      : Promise.resolve(null),
  ]);

  return (
    <RepresentativeManagementScreen
      actingUser={actingUser}
      users={users}
      delegations={delegations}
      rolePermissions={rolePermissions}
      notificationSettings={notificationSettings}
    />
  );
}
