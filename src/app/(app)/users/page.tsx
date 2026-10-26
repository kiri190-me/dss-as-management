import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import RepresentativeManagementScreen from "@/components/users/RepresentativeManagementScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import { getLoginMode } from "@/lib/config/login-mode";
import { getSsoIssuer } from "@/lib/config/sso";
import { listUsersForRepresentativeManagement, listShipmentDelegations } from "@/lib/db/queries/shipment-delegations";
import {
  listAllApprovalRouteDelegations,
  listApprovalRouteDelegateCandidates,
  listApprovalRouteDelegationsForUser,
} from "@/lib/db/queries/approval-route-delegations";
import { resolveUsersAreaAccess, USERS_AREA_KEY } from "@/lib/auth/users-area-access";
import {
  getCurrentShipmentApprovalRoute,
  listSelectableApproverCandidates,
} from "@/lib/db/queries/shipment-approval-routes";
import { EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES } from "@/lib/domain/shipment-approval-route";
import type { ShipmentApprovalRoutesByScope } from "@/components/users/ShipmentApprovalRouteSection";
import { canManageRolePermissions } from "@/lib/auth/role-permission-authorization";
import { canManageNotificationSettings } from "@/lib/auth/notification-settings-authorization";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { actorMay } from "@/lib/auth/developer-promotion";
import { mayManageDeveloperFlag } from "@/lib/auth/developer-flag-authorization";
import { buildRolePermissionViews } from "@/lib/auth/role-permission-views";

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

  // 🔴 **메뉴와 정확히 같은 판정**이다(auth/users-area-access.ts). 둘이 갈리면
  // 「메뉴에는 뜨는데 눌러도 쫓겨난다」(또는 그 반대)가 되고, 그 어긋남은 오류를
  // 내지 않아 사람이 포기할 때까지 조용하다 — 그래서 규칙이 적힌 곳이 하나다.
  //
  // 🔴 requireAreaAccess("users", …) 를 **대신한다.** 그 함수만 부르면 운영 DB 에
  // users.view 가 NONE 으로 저장된 역할(엔지니어·영업·재고담당)은 결재선에 올라
  // 있어도 자기 결재권을 맡길 길이 없다 — 그 자리가 2026-10-26 눈 확인에서 잡힌
  // 결함이다. 보낼 곳은 그 함수와 **같은 안내 화면**이어야 한다(막힌 까닭을 사람이
  // 읽는 자리다).
  const usersAreaAccess = await resolveUsersAreaAccess(actingUser);
  if (!usersAreaAccess.mayEnterUsersArea) {
    redirect(`/no-access?area=${encodeURIComponent(USERS_AREA_KEY)}`);
  }
  // 🔴 「관리자인가」가 여기서 갈린다. 거짓이면 **「결재권 위임」 탭 하나**만 열리고,
  // 아래에서 **다른 탭이 쓰는 자료를 아예 읽지 않는다** — 클라이언트 컴포넌트에
  // 넘긴 값은 그리지 않아도 HTML 에 실려 나가므로, 탭을 안 그리는 것만으로는
  // 사용자 목록·남의 위임·결재선이 새는 것을 하나도 못 막는다.
  const canViewUsersAdminTabs = usersAreaAccess.hasUsersPermission;

  // 승인 절차(결재선)도 여기서 함께 읽어 내려보낸다. 편집 화면이 클라이언트
  // 컴포넌트라 이 조회들을 스스로 부를 수 없다(db 조회는 서버 전용이고 await 가
  // 필요하다) — 대표·위임 목록과 같은 이유, 같은 자리다.
  // 🔴 「현재 절차」는 그 용도 안에서 version 이 가장 큰 판 하나이고, 그 정의가
  // 적힌 곳은 queries/shipment-approval-routes.ts 하나여야 한다 — 여기서 다시
  // 고르지 않는다.
  // 후보 목록은 화면이 고를 것일 뿐 최종 판정이 아니다: 저장은 mutation 이 자기
  // 트랜잭션 안에서 같은 자격 조건을 다시 확인한다(고르는 사이에 계정이 잠길 수 있다).
  // 🔴 결재선 단계 위임만은 **보는 사람의 것만** 읽는다(`actingUser.id` —
  // users.id 다. 포털 번호(sub)를 넘기면 오류 없이 영원히 0건이 된다). 위의
  // listShipmentDelegations() 가 모두의 줄을 읽어 내려보내는 것과 다른 까닭은,
  // 이 탭이 **조건 없이 누구에게나 보이기** 때문이다 — 모두의 줄을 내려보내면
  // 권한 없는 사람의 HTML 에 남의 위임이 그대로 실려 나간다.
  // 🔴 「모두의 결재권 위임」만은 **조회 자신이 인가를 본다** — 돌려주는 것이 남의
  // 줄이기 때문이다(그 함수 머리말). 그래서 여기서 권한을 앞질러 묻고 부를지 말지
  // 가르지 않는다: 그렇게 하면 같은 판정이 두 곳에 적히고, 한쪽만 고쳐지는 날
  // 「화면은 비었는데 통로는 내준다」(또는 그 반대)가 된다. 이 페이지가 하는 일은
  // 거절을 **null 로 옮겨 적는 것**뿐이고, null 은 화면에서 「묶음이 없다」가 된다.
  // 🔴 **관리 탭의 자료는 그 권한이 있을 때만 읽는다**(2026-10-26). 아래 넷은 전부
  // 다른 사람들의 것이다 — 계정 목록(이메일·역할·잠김 여부) · 모두의 출하 대표 위임 ·
  // 결재선 판(승인자 이름) · 결재선 후보(이메일 + 포털 번호). 「결재권 위임」 탭만
  // 쓰는 사람에게는 **읽지도 내려보내지도 않는다.**
  const [users, delegations, routeDelegations, allRouteDelegationsResult, approvalRouteEntries, approverCandidates, delegateCandidateRows] = await Promise.all([
    canViewUsersAdminTabs ? listUsersForRepresentativeManagement() : Promise.resolve([]),
    canViewUsersAdminTabs ? listShipmentDelegations() : Promise.resolve([]),
    listApprovalRouteDelegationsForUser(actingUser.id),
    listAllApprovalRouteDelegations(actingUser),
    // 🔴 **고칠 수 있는 용도를 돌며 전부 읽는다.** 화면이 탭 안에서 용도를
    // 고르는데 그 판정은 클라이언트에서 일어나므로, 고를 수 있는 용도의 현재 판이
    // 처음부터 다 내려와 있어야 한다. 목록에서 파생시키는 이유는 용도를 하나
    // 더할 때 여기를 고치는 것을 잊어도 새 용도가 조용히 빠지지 않게 하기
    // 위해서다 — 글자로 적어 두면 그 용도만 「판이 없다」로 보이고, 그것은
    // 「절차를 쓰지 않는다」와 구별되지 않는다.
    // 🔴 **표의 용도 전부가 아니라 EDITABLE_… 다**(2026-10-18). 「부품 불출」은
    // 이 탭에서 고칠 수 없게 됐으므로 그 판을 읽지도, 내려보내지도 않는다 —
    // 저장된 판은 표에 그대로 있다. 까닭은 그 상수 머리말에 있다.
    // 🔴 판이 없는 것(null)과 **안 읽은 것**이 같은 값이 된다. 그래도 괜찮은 것은
    // 이 자료를 보는 탭이 `canViewUsersAdminTabs` 일 때만 그려지기 때문이다 —
    // 읽지 않은 값을 그리는 자리가 없다.
    canViewUsersAdminTabs
      ? Promise.all(
          EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES.map(
            async (scope) => [scope, await getCurrentShipmentApprovalRoute(scope)] as const
          )
        )
      : Promise.resolve(EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES.map((scope) => [scope, null] as const)),
    canViewUsersAdminTabs ? listSelectableApproverCandidates() : Promise.resolve([]),
    // 🔴 「대리 결재자」 고르개는 **누구에게나** 필요하다 — 없으면 결재권 위임 기능
    // 자체가 없는 것과 같다. 그래서 이 조회만은 권한으로 가르지 않고, 대신 **이름과
    // id 까지만** 싣는 좁은 조회를 쓴다(queries/approval-route-delegations.ts).
    listApprovalRouteDelegateCandidates(),
  ]);
  const shipmentApprovalRoutes = Object.fromEntries(
    approvalRouteEntries
  ) as ShipmentApprovalRoutesByScope;
  const allRouteDelegations = allRouteDelegationsResult.ok ? allRouteDelegationsResult.view : null;

  // 🔴 **이메일은 관리 권한이 있을 때만 내린다.** 고르개에 이름이 같은 사람이 둘일
  // 때 가려야 하는 것은 관리자이고, 권한 없이 들어온 사람에게 사내 전원의 메일
  // 주소를 실어 보낼 까닭은 없다. 조회가 아니라 **여기서** 가리는 까닭은 그 함수
  // 머리말에 있다(조회가 세션을 몰래 보면 「왜 어떤 때는 없나」를 설명할 자리가 없다).
  const delegateCandidates = delegateCandidateRows.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    email: canViewUsersAdminTabs ? candidate.email : null,
  }));

  // 관리자 미만에게는 아예 내려보내지 않는다. 화면에서 탭을 감추는 것만으로는
  // 다른 역할의 권한 구성이 HTML에 실려 나가는 것을 막지 못한다.
  // 대표 지정·위임 판정은 화면에서 계산할 수 없다 — hasPermission 은 서버 전용이고
  // await 가 필요한데 저 화면은 클라이언트 컴포넌트다. 그래서 여기서 계산해
  // 내려보낸다. 🔴 서버 mutation 세 곳(shipment-representatives.ts,
  // shipment-delegations.ts 의 생성·철회)이 **같은 영역 열쇠·같은 수준**으로
  // 판정한다 — 다르게 적으면 개발자에게만 화면과 서버의 답이 갈린다.
  const [rolePermissions, canManageRepresentatives] = await Promise.all([
    actorMay(actingUser, canManageRolePermissions)
      ? buildRolePermissionViews({ actorRole: actingUser.role, actorIsDeveloper: actingUser.isDeveloper })
      : Promise.resolve(null),
    hasPermission(actingUser, "users.shipmentRepresentatives", "MANAGE"),
  ]);

  // 알림 설정은 2026-09-22 에 통합 로그인 포털로 떠났다(그 화면의 머리말에 경위가
  // 적혀 있다). 자료는 여전히 A/S 가 갖고, 포털이 통로로 읽고 쓴다
  // (api/integration/notification-settings). 여기 남은 것은 **어디서 고치는지
  // 알려 주는 한 줄**뿐이다 — 탭이 조용히 사라지면 관리자는 찾을 길이 없다.
  //
  // 🔴 보이는 조건은 **탭이 보였던 조건과 같다**(관리자 이상). 권한 없는 사람에게
  // 갈 수 없는 곳을 알려 주지 않는다. 그리고 통합 로그인 모드가 아니면 애초에 갈
  // 곳이 없다 — 데모 모드에서 링크만 떠 있으면 눌러도 아무 일이 없거나 설정이
  // 없다며 터진다((app)/layout.tsx 가 포털 링크에 같은 줄을 긋는다).
  // 🔴 주소를 글자로 박지 않는다 — 포털 주소는 환경마다 다르고(개발 PC · NAS),
  // 그 값을 아는 곳은 config/sso.ts 하나다.
  const notificationSettingsPortalUrl =
    getLoginMode() === "sso" && actorMay(actingUser, canManageNotificationSettings)
      ? `${getSsoIssuer()}/admin/notifications`
      : null;

  // 🔴 개발자 표시 판정만은 actorMay / hasPermission 을 쓰지 않는다 — **진짜
  // 최고관리자만**이다. 이 값이 권한을 최고관리자급으로 올리는 스위치 그 자체라서,
  // 승격된 개발자가 통과하면 개발자가 개발자를 만든다(「동급」 규칙의 유일하고
  // 의도된 예외, 2026-09-07). 서버 mutation(db/mutations/developer-flag.ts)이
  // **같은 함수**로 판정한다 — 식을 여기 다시 적지 않는다
  // (auth/developer-flag-authorization.ts). 승인 상태는 (app)/layout.tsx 가 이미
  // 확인했지만 함수가 한 번 더 본다 — 공짜고, 서버와 정확히 같은 식이 된다.
  const canManageDeveloperFlag = mayManageDeveloperFlag(actingUser);

  // 🔴 사용자 계정 삭제도 **같은 판정 함수**다 — 진짜 최고관리자만, 개발자 승격 제외
  // (사용자 결정 2026-09-13). 서버 액션 · mutation(server/actions/user-deletion.ts ·
  // db/mutations/user-deletion.ts)이 같은 함수로 다시 판정하므로 이 값은 [계정 삭제]
  // 단추를 보일지만 정한다. 지금은 개발자 표시와 답이 같지만 두 일이 갈라지는 날에
  // 한쪽만 바꿀 수 있도록 값을 따로 둔다.
  const canDeleteUserAccounts = mayManageDeveloperFlag(actingUser);

  return (
    <RepresentativeManagementScreen
      actingUser={actingUser}
      users={users}
      delegations={delegations}
      rolePermissions={rolePermissions}
      notificationSettingsPortalUrl={notificationSettingsPortalUrl}
      shipmentApprovalRoutes={shipmentApprovalRoutes}
      approverCandidates={approverCandidates}
      routeDelegations={routeDelegations}
      allRouteDelegations={allRouteDelegations}
      delegateCandidates={delegateCandidates}
      canViewUsersAdminTabs={canViewUsersAdminTabs}
      canManageRepresentatives={canManageRepresentatives}
      canManageDeveloperFlag={canManageDeveloperFlag}
      canDeleteUserAccounts={canDeleteUserAccounts}
    />
  );
}
