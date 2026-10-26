"use client";

import { useState } from "react";
import RepresentativeListSection from "./RepresentativeListSection";
import DelegationSection from "./DelegationSection";
import RolePermissionSettings, { type RolePermissionScreenData } from "./RolePermissionSettings";
import DeveloperFlagSection from "./DeveloperFlagSection";
import ShipmentApprovalRouteSection, {
  type ShipmentApprovalRoutesByScope,
} from "./ShipmentApprovalRouteSection";
import ApprovalRouteDelegationSection from "./ApprovalRouteDelegationSection";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { RepresentativeManagementUserRow, ShipmentDelegationRow } from "@/lib/db/queries/shipment-delegations";
import type {
  AllApprovalRouteDelegationsView,
  ApprovalRouteDelegateCandidate,
  ApprovalRouteDelegationRow,
} from "@/lib/db/queries/approval-route-delegations";
import {
  initialUsersTab,
  visibleUsersTabKeys,
  type UsersTabKey,
} from "./users-tab-access";
import type { SelectableApproverCandidate } from "@/lib/db/queries/shipment-approval-routes";

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
 * 2026-08-27 ~ 2026-09-22: 알림 설정이 세 번째 탭으로 들어왔다가 **통합 로그인
 * 포털(dss-auth)의 /admin/notifications 로 떠났다.** 까닭은 알림 설정이 A/S 만의
 * 일이 아니게 된 것이다 — 여섯 시스템이 각자 「누가 무엇을 받는가」를 따로 갖고
 * 있으면 관리자가 여섯 화면을 돌아야 하고, 어디를 안 고쳤는지도 알 수 없다.
 * 🔴 **자료는 여전히 A/S 가 갖는다**(알림 종류 8가지도 역할 5가지도 A/S 고유의
 * 것이다). 포털은 통로(api/integration/notification-settings)로 읽고 쓴다.
 * 이 화면에는 그 대신 **맨 아래 이사 안내 한 줄**이 남았다 — 탭이 조용히
 * 사라지면 관리자는 어디서 고치는지 모른다. 안내를 탭으로 만들지 않은 이유는
 * 탭을 눌러야 보이는 안내가 탭을 남기는 것과 같기 때문이다.
 *
 * 2026-09-07: 「개발자 표시」가 네 번째 탭으로 들어왔다. 자료가 아니라 판정 하나
 * (canManageDeveloperFlag)로 여닫는다 — 목록 자체는 대표 탭과 같은 `users` 를
 * 쓰기 때문이다. 거짓이면 탭을 아예 그리지 않는다(권한 탭과 같은 방식).
 *
 * 2026-09-10: 그 탭이 「승인 절차」가 됐다 — 부품 불출도 같은 결재선 제도를 타게
 * 되면서, 이름에 「출하」가 붙어 있으면 재고 담당자의 절차를 여기서 정한다는 것을
 * 아무도 알 수 없다. 어떤 절차인지는 탭 **안에서** 고른다(용도가 늘어도 탭은
 * 하나다 — 탭으로 쪼개면 다섯 개이던 탭 줄이 계속 길어지고, 두 절차가 같은 표·
 * 같은 규칙을 쓴다는 사실도 화면에서 사라진다).
 *
 * 2026-09-09: 「출하 승인 절차」(결재선)가 다섯 번째 탭으로 들어왔고, 자리는
 * 첫 탭 바로 다음이다 — 「누가 출하를 승인하는가」라는 같은 물음을 다루고,
 * 절차가 「출하 대표」를 대신하게 될 것이므로 둘을 떨어뜨려 두면 관리자가 두
 * 설정이 서로 무관하다고 오해한다. 🔴 **이 탭만은 자료로 여닫지 않고 항상
 * 보인다** — 위의 여닫는 탭들은 자료가 null 이면 「감추는 것이 아니라 없는 것」
 * 이지만, 절차는 판이 하나도 없는 상태(=지금 대표 방식으로 돈다)를 화면이
 * **말해 줘야** 하는 종류의 자료라 비어 있어도 그릴 것이 있다. 고치는 단추만
 * canManageRepresentatives 로 가른다. 그래서 탭 줄 자체도 이제 늘 그려진다
 * (탭이 언제나 둘 이상이다) — 나머지 탭의 노출 조건은 그대로다.
 *
 * 2026-10-26: 「결재권 위임」이 세 번째 탭으로 들어왔다. 자리는 「승인 절차」
 * 바로 다음이다 — 그 절차의 **단계를 대신 누르게 맡기는** 일이라 절차와 붙여
 * 두어야 둘이 한 이야기인 것이 보인다. 🔴 **조건 없이 늘 보인다**: 누구나 자기
 * 결재권은 맡길 수 있고(본인 위임은 권한과 무관하게 열려 있다 —
 * mutations/approval-route-delegations.ts), 권한이 가르는 것은 탭 안의 「누구의
 * 결재권인가」 고르개 하나뿐이다. 조건으로 감싸면 자리를 비우는 사람이 관리자에게
 * 부탁해야만 하게 된다.
 * 🔴 첫 탭의 「출하 승인 위임」과 **다른 표·다른 때**다 — 옛것은 승인 절차를 아직
 * 짜지 않았을 때 쓰는 「출하 대표」 대리다. 둘이 같은 화면 안에 있어 헷갈리므로 두
 * 묶음 맨 위에 서로를 가르는 한 줄씩을 적어 두었다.
 */
export default function RepresentativeManagementScreen({
  actingUser,
  users,
  delegations,
  rolePermissions,
  notificationSettingsPortalUrl,
  shipmentApprovalRoutes,
  approverCandidates,
  routeDelegations,
  allRouteDelegations,
  delegateCandidates,
  canViewUsersAdminTabs,
  canManageRepresentatives,
  canManageDeveloperFlag,
  canDeleteUserAccounts,
}: {
  actingUser: ActingUser;
  users: RepresentativeManagementUserRow[];
  delegations: ShipmentDelegationRow[];
  /** 관리자 이상일 때만 내려온다. null이면 권한 설정 탭이 없다. */
  rolePermissions: RolePermissionScreenData | null;
  /**
   * 포털의 알림 설정 화면 주소. null 이면 맨 아래 이사 안내를 그리지 않는다.
   *
   * 🔴 판정을 화면에서 하지 않는다 — 서버 페이지가 **탭이 보이던 것과 같은
   * 조건**(관리자 이상, canManageNotificationSettings)으로 계산해 내려보내고,
   * 통합 로그인 모드가 아니면 갈 곳이 없으므로 그때도 null 이다. 권한 없는
   * 사람에게 갈 수 없는 곳을 알려 주지 않는다. 주소를 글자로 박지 않는 것도
   * 같은 자리의 판단이다(포털 주소는 환경마다 다르다 — config/sso.ts).
   */
  notificationSettingsPortalUrl: string | null;
  /**
   * **용도별** 현재 승인 절차(그 용도 안에서 version 이 가장 큰 판). 값이 전부
   * null 이어도 탭은 있다 — 「아직 절차가 없어 예전 방식으로 돈다」가 화면이
   * 말해야 할 상태이기 때문이다.
   */
  shipmentApprovalRoutes: ShipmentApprovalRoutesByScope;
  /** 승인 단계에 올릴 수 있는 사용자. 「출하 대표」로 지정할 수 있는 조건과 같다. */
  approverCandidates: SelectableApproverCandidate[];
  /**
   * 🔴 **보는 사람의 것만** 내려온다 — 「내가 맡긴 것」과 「내가 대신하고 있는 것」
   * (queries/approval-route-delegations.ts). 위의 `delegations`(옛 출하 대표 위임)가
   * 모두의 줄을 한 표에 담는 것과 다르다. 이 탭은 조건 없이 늘 보이므로 자료도 늘
   * 내려오고, 비어 있는 것은 정상이다.
   */
  routeDelegations: {
    given: ApprovalRouteDelegationRow[];
    received: ApprovalRouteDelegationRow[];
  };
  /**
   * 🔴 **모두의 결재권 위임. 관리 권한이 없으면 `null`** 이고, 그러면 탭 안에 그
   * 묶음이 아예 없다 — 감추는 것이 아니라 없는 것이다(권한 탭과 같은 방식).
   *
   * 🔴 판정은 **조회 함수 자신**이 한다(listAllApprovalRouteDelegations). 서버
   * 페이지는 그 거절을 null 로 옮겨 적을 뿐이고, 화면은 받은 값만 본다. 위의
   * canManageRepresentatives 와 **섞지 않는다** — 그 값은 「누구의 결재권인가」
   * 고르개를 여는 열쇠이고, 이 값은 **남의 줄이 내려왔는가** 그 자체다.
   */
  allRouteDelegations: AllApprovalRouteDelegationsView | null;
  /**
   * 「대리 결재자」 고르개가 쓰는 사람 목록 — **이름과 id 까지만**이다.
   *
   * 🔴 위 `users`(대표·개발자 표시 탭이 쓰는 전체 계정 목록)를 **돌려쓰지 않는다.**
   * 이 탭은 `users.view` 권한 없이 들어온 사람에게도 열리는데, 그 목록에는 사내
   * 전원의 이메일·역할·잠김 여부가 들어 있다. 클라이언트 컴포넌트에 넘긴 값은
   * 그리지 않아도 HTML 에 실려 나가므로 **넘기지 않는 것**만이 막는 길이다.
   *
   * 🔵 이메일은 관리 권한이 있을 때만 채워져 온다(서버 페이지가 `null` 로 바꾼다) —
   * 이름이 같은 사람을 가려야 하는 것은 관리자다.
   */
  delegateCandidates: ApprovalRouteDelegateCandidate[];
  /**
   * 🔴 **`users.view` 권한으로 들어왔는가.** 거짓이면 **결재선에 올라 있어 열린
   * 사람**이고(auth/users-area-access.ts), 그에게는 탭이 「결재권 위임」 하나뿐이다.
   *
   * 🔴 위 `canManageRepresentatives` 와 **섞지 않는다.** 그 값은 「남의 결재권까지
   * 맡길 수 있는가」(MANAGE)이고 이 값은 「이 화면의 관리 탭을 볼 수 있는가」(READ)다 —
   * 보기만 되고 못 고치는 사람이 실제로 있다.
   *
   * 🔵 이 값이 거짓인 사람에게는 서버 페이지가 관리 탭의 자료를 **읽지도 않는다.**
   * 탭을 안 그리는 것만으로는 아무것도 못 막는다(위 delegateCandidates 주석).
   */
  canViewUsersAdminTabs: boolean;
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
  /**
   * 🔴 「개발자 표시를 켜고 끌 수 있는가」 — **진짜 최고관리자만**이다. 위의
   * canManageRepresentatives 와 달리 이 값은 승격되지 않는다: 개발자 표시가
   * 권한을 최고관리자급으로 올리는 스위치 그 자체라서, 승격된 개발자가 통과하면
   * 개발자가 개발자를 만든다. 「동급」 규칙의 유일하고 의도된 예외다.
   *
   * 서버 페이지가 mayManageDeveloperFlag(actingUser) 로 계산해 내려보내고, 서버
   * mutation(db/mutations/developer-flag.ts)이 **같은 함수**로 판정한다
   * (auth/developer-flag-authorization.ts). 이 값이 거짓이면 「개발자 표시」 탭을
   * 아예 그리지 않는다 — 권한·알림 탭이 자료가 null 이면 없는 것과 같은 방식이다.
   */
  canManageDeveloperFlag: boolean;
  /**
   * 🔴 「사용자 계정을 삭제할 수 있는가」 — 진짜 최고관리자에게만 참이다(개발자 승격
   * 제외, 사용자 결정 2026-09-13). 서버 페이지가 개발자 표시와 같은 판정 함수로 계산해
   * 내려보내고, 서버 액션 · mutation 이 같은 함수로 다시 판정한다. 이 화면은 받은 값을
   * 대표 목록에 넘기기만 한다 — 위의 canManageRepresentatives 와 섞지 않는다(그 값은
   * 개발자에게 승격된다).
   */
  canDeleteUserAccounts: boolean;
}) {
  const representatives = users.filter((u) => u.isShipmentRepresentative);
  // 🔴 탭 노출 규칙은 **순수 모듈 하나**가 가진다(users-tab-access.ts). 조건을
  // JSX 에 흩어 두면 단추와 내용과 「첫 탭」이 각자 따지게 되고, 그때 생기는
  // 어긋남이 「단추는 없는데 그 내용이 그려진다」다.
  const tabFlags = {
    canViewUsersAdminTabs,
    hasRolePermissions: rolePermissions !== null,
    canManageDeveloperFlag,
  };
  const visibleTabs = visibleUsersTabKeys(tabFlags);
  // 🔴 처음 보여 줄 탭은 **보이는 것 가운데 첫째**다. 「언제나 representatives」로
  // 두면 관리 탭이 없는 사람이 빈 화면을 보고, 옮겨 갈 단추조차 없다.
  const [activeTab, setActiveTab] = useState<UsersTabKey>(() => initialUsersTab(tabFlags));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">사용자 관리</h1>
        {/* 🔴 결재선에 올라 있어 들어온 사람에게는 「대표 지정」이 거짓말이다 —
            그 사람에게 열린 것은 자기 결재권을 맡기는 일 하나뿐이다. */}
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {canViewUsersAdminTabs
            ? "최종 출하 승인 대표 지정과 대리 승인(위임)을 관리합니다."
            : "자리를 비우는 동안 내 결재 단계를 대신 처리할 사람을 지정합니다."}
        </p>
      </div>

      {/* 🔴 탭 줄은 **둘 이상일 때만** 그린다(2026-10-26). 결재선에 올라 있어 들어온
          사람에게는 탭이 하나뿐인데, 그때 한 칸짜리 탭 줄은 「나머지가 안 그려졌다」로
          읽힌다 — 묶음 자신이 제 제목(<h2>결재권 위임)을 들고 있어 잃는 것도 없다.
          가로로 넘칠 수 있어(탭이 다섯까지 된다) 이 줄 안에서만 밀리게 한다. */}
      {visibleTabs.length > 1 && (
      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {visibleTabs.includes("representatives") && (
        <button
          type="button"
          onClick={() => setActiveTab("representatives")}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
            activeTab === "representatives"
              ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          출하 대표자 / 위임
        </button>
        )}
        {visibleTabs.includes("approvalRoute") && (
        <button
          type="button"
          onClick={() => setActiveTab("approvalRoute")}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
            activeTab === "approvalRoute"
              ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          승인 절차
        </button>
        )}
        {/* 🔴 조건으로 감싸지 않는다 — 누구나 자기 결재권은 맡길 수 있다(머리말).
            위의 「승인 절차」와 마찬가지로 자료가 비어 있어도 그릴 것이 있다. */}
        <button
          type="button"
          onClick={() => setActiveTab("routeDelegation")}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
            activeTab === "routeDelegation"
              ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          결재권 위임
        </button>
        {rolePermissions && (
          <button
            type="button"
            onClick={() => setActiveTab("permissions")}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === "permissions"
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            역할별 접근 권한
          </button>
        )}
        {canManageDeveloperFlag && (
          <button
            type="button"
            onClick={() => setActiveTab("developer")}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === "developer"
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            개발자 표시
          </button>
        )}
      </div>
      )}

      {/* 🔴 **마지막 갈래가 「결재권 위임」이다**(2026-10-26). 그 전에는 「출하
          대표자 / 위임」이 마지막이었는데, 그러면 관리 탭이 없는 사람이 어떤 까닭으로든
          그 갈래에 닿는 순간 **읽지도 않은 자료로** 대표 목록을 그리게 된다. 모두가
          가진 탭을 바닥에 두면 그런 자리가 생길 수 없다 — 위의 네 갈래가 전부 제
          조건을 들고 있고, 하나도 안 맞으면 이 탭으로 떨어진다. */}
      {rolePermissions && activeTab === "permissions" ? (
        <RolePermissionSettings actingRole={actingUser.role} data={rolePermissions} />
      ) : canManageDeveloperFlag && activeTab === "developer" ? (
        <DeveloperFlagSection users={users} canManageDeveloperFlag={canManageDeveloperFlag} />
      ) : canViewUsersAdminTabs && activeTab === "approvalRoute" ? (
        // 자료를 앞에 두고 여닫지 않는다 — 판이 없는 것(=지금 예전 방식으로 돈다)도
        // 화면이 말해 줘야 하는 상태라 그릴 것이 늘 있다. 가르는 것은 **권한**이다.
        <ShipmentApprovalRouteSection
          routes={shipmentApprovalRoutes}
          candidates={approverCandidates}
          canManageRepresentatives={canManageRepresentatives}
        />
      ) : canViewUsersAdminTabs && activeTab === "representatives" ? (
        <>
          {/* 아래 두 화면의 prop 이름도 이제 값이 뜻하는 바와 같다
              (2026-09-07). 예전에는 `isSuperAdmin` 이었는데, 넘기는 값은
              「대표 지정·위임을 관리해도 되는가」이고 개발자 표시가 생기면서
              최고관리자 여부와 갈렸다 — 이름이 거짓말을 하고 있었다. */}
          {/* [계정 삭제]는 따로 받은 값으로 여닫는다. 자기 자신의 줄을 가리려고 행위자
              id 를 함께 넘긴다. */}
          <RepresentativeListSection
            users={users}
            canManageRepresentatives={canManageRepresentatives}
            canDeleteUserAccounts={canDeleteUserAccounts}
            actingUserId={actingUser.id}
          />

          <DelegationSection
            actingUser={actingUser}
            canManageRepresentatives={canManageRepresentatives}
            representatives={representatives}
            allUsers={users}
            delegations={delegations}
          />
        </>
      ) : (
        // 🔴 조건이 없다. 누구나 자기 결재권은 맡길 수 있고, 이 탭은 **모두가 가진
        // 유일한 탭**이라 떨어질 바닥으로도 맞다.
        <ApprovalRouteDelegationSection
          actingUser={actingUser}
          canManageRepresentatives={canManageRepresentatives}
          allUsers={delegateCandidates}
          routeDelegations={routeDelegations}
          allRouteDelegations={allRouteDelegations}
        />
      )}

      {/* 🔴 이사 안내 — 탭 **밖**이라 어느 탭을 보고 있어도 늘 보인다.
          탭으로 만들면 눌러야 보이는 안내가 되어 탭을 남기는 것과 같다.
          새 탭으로 열지 않는다 — 이 저장소의 포털 링크 관행이다
          (layout/SidebarFooter.tsx 의 「통합 로그인으로」도 같은 창에서 연다). */}
      {notificationSettingsPortalUrl && (
        <p className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          알림 설정은 통합 로그인 포털로 이사했습니다 — 여섯 시스템을 한 곳에서 고칩니다.{" "}
          <a
            href={notificationSettingsPortalUrl}
            className="font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            알림 설정 열기
          </a>
        </p>
      )}
    </div>
  );
}
