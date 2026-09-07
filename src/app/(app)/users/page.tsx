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
import { hasPermission } from "@/lib/auth/permission-resolver";
import { actorMay } from "@/lib/auth/developer-promotion";
import { mayManageDeveloperFlag } from "@/lib/auth/developer-flag-authorization";
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
  // 대표 지정·위임 판정은 화면에서 계산할 수 없다 — hasPermission 은 서버 전용이고
  // await 가 필요한데 저 화면은 클라이언트 컴포넌트다. 그래서 여기서 계산해
  // 내려보낸다. 🔴 서버 mutation 세 곳(shipment-representatives.ts,
  // shipment-delegations.ts 의 생성·철회)이 **같은 영역 열쇠·같은 수준**으로
  // 판정한다 — 다르게 적으면 개발자에게만 화면과 서버의 답이 갈린다.
  const [rolePermissions, notificationSettings, canManageRepresentatives] = await Promise.all([
    actorMay(actingUser, canManageRolePermissions)
      ? buildRolePermissionViews({ actorRole: actingUser.role, actorIsDeveloper: actingUser.isDeveloper })
      : Promise.resolve(null),
    actorMay(actingUser, canManageNotificationSettings)
      ? buildNotificationSettingsView()
      : Promise.resolve(null),
    hasPermission(actingUser, "users.shipmentRepresentatives", "MANAGE"),
  ]);

  // 🔴 개발자 표시 판정만은 actorMay / hasPermission 을 쓰지 않는다 — **진짜
  // 최고관리자만**이다. 이 값이 권한을 최고관리자급으로 올리는 스위치 그 자체라서,
  // 승격된 개발자가 통과하면 개발자가 개발자를 만든다(「동급」 규칙의 유일하고
  // 의도된 예외, 2026-09-07). 서버 mutation(db/mutations/developer-flag.ts)이
  // **같은 함수**로 판정한다 — 식을 여기 다시 적지 않는다
  // (auth/developer-flag-authorization.ts). 승인 상태는 (app)/layout.tsx 가 이미
  // 확인했지만 함수가 한 번 더 본다 — 공짜고, 서버와 정확히 같은 식이 된다.
  const canManageDeveloperFlag = mayManageDeveloperFlag(actingUser);

  return (
    <RepresentativeManagementScreen
      actingUser={actingUser}
      users={users}
      delegations={delegations}
      rolePermissions={rolePermissions}
      notificationSettings={notificationSettings}
      canManageRepresentatives={canManageRepresentatives}
      canManageDeveloperFlag={canManageDeveloperFlag}
    />
  );
}
