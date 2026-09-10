"use client";

import { useState } from "react";
import RepresentativeListSection from "./RepresentativeListSection";
import DelegationSection from "./DelegationSection";
import RolePermissionSettings, { type RolePermissionScreenData } from "./RolePermissionSettings";
import NotificationSettings from "./NotificationSettings";
import DeveloperFlagSection from "./DeveloperFlagSection";
import ShipmentApprovalRouteSection, {
  type ShipmentApprovalRoutesByScope,
} from "./ShipmentApprovalRouteSection";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { NotificationSettingsScreenData } from "@/lib/domain/notification-settings";
import type { RepresentativeManagementUserRow, ShipmentDelegationRow } from "@/lib/db/queries/shipment-delegations";
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
 * 2026-08-27: 알림 설정이 세 번째 탭으로 들어왔다. 같은 방식이다 —
 * notificationSettings가 null이면 그 탭을 아예 그리지 않는다. 두 자료를 따로
 * 받는 이유는, 지금은 두 탭의 권한이 같지만 갈라지는 날에 화면이 한쪽만 감출
 * 수 있어야 하기 때문이다(각자 자기 자료가 있으면 보이고, 없으면 없다).
 *
 * 2026-09-07: 「개발자 표시」가 네 번째 탭으로 들어왔다. 자료가 아니라 판정 하나
 * (canManageDeveloperFlag)로 여닫는다 — 목록 자체는 대표 탭과 같은 `users` 를
 * 쓰기 때문이다. 거짓이면 탭을 아예 그리지 않는다(위 두 탭과 같은 방식).
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
 * 보인다** — 위 세 탭은 자료가 null 이면 「감추는 것이 아니라 없는 것」이지만,
 * 절차는 판이 하나도 없는 상태(=지금 대표 방식으로 돈다)를 화면이 **말해 줘야**
 * 하는 종류의 자료라 비어 있어도 그릴 것이 있다. 고치는 단추만
 * canManageRepresentatives 로 가른다. 그래서 탭 줄 자체도 이제 늘 그려진다
 * (탭이 언제나 둘 이상이다) — 기존 세 탭의 노출 조건은 그대로다.
 */
export default function RepresentativeManagementScreen({
  actingUser,
  users,
  delegations,
  rolePermissions,
  notificationSettings,
  shipmentApprovalRoutes,
  approverCandidates,
  canManageRepresentatives,
  canManageDeveloperFlag,
}: {
  actingUser: ActingUser;
  users: RepresentativeManagementUserRow[];
  delegations: ShipmentDelegationRow[];
  /** 관리자 이상일 때만 내려온다. null이면 권한 설정 탭이 없다. */
  rolePermissions: RolePermissionScreenData | null;
  /** 관리자 이상일 때만 내려온다. null이면 알림 설정 탭이 없다. */
  notificationSettings: NotificationSettingsScreenData | null;
  /**
   * **용도별** 현재 승인 절차(그 용도 안에서 version 이 가장 큰 판). 값이 전부
   * null 이어도 탭은 있다 — 「아직 절차가 없어 예전 방식으로 돈다」가 화면이
   * 말해야 할 상태이기 때문이다.
   */
  shipmentApprovalRoutes: ShipmentApprovalRoutesByScope;
  /** 승인 단계에 올릴 수 있는 사용자. 「출하 대표」로 지정할 수 있는 조건과 같다. */
  approverCandidates: SelectableApproverCandidate[];
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
}) {
  const representatives = users.filter((u) => u.isShipmentRepresentative);
  const [activeTab, setActiveTab] = useState<
    "representatives" | "approvalRoute" | "permissions" | "notifications" | "developer"
  >("representatives");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">사용자 관리</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          최종 출하 승인 대표 지정과 대리 승인(위임)을 관리합니다.
        </p>
      </div>

      {/* 🔴 탭 줄은 이제 조건 없이 그린다 — 「출하 승인 절차」가 자료와 무관하게
          늘 있으므로 탭이 언제나 둘 이상이다. 안쪽 세 탭의 노출 조건은 그대로다.
          가로로 넘칠 수 있어(탭 다섯) 이 줄 안에서만 밀리게 한다. */}
      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
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
        {notificationSettings && (
          <button
            type="button"
            onClick={() => setActiveTab("notifications")}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === "notifications"
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            알림 설정
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

      {rolePermissions && activeTab === "permissions" ? (
        <RolePermissionSettings actingRole={actingUser.role} data={rolePermissions} />
      ) : notificationSettings && activeTab === "notifications" ? (
        <NotificationSettings data={notificationSettings} />
      ) : canManageDeveloperFlag && activeTab === "developer" ? (
        <DeveloperFlagSection users={users} canManageDeveloperFlag={canManageDeveloperFlag} />
      ) : activeTab === "approvalRoute" ? (
        // 위 셋과 달리 자료를 앞에 두고 여닫지 않는다 — 판이 없는 것(=지금 예전
        // 방식으로 돈다)도 화면이 말해 줘야 하는 상태라 그릴 것이 늘 있다.
        <ShipmentApprovalRouteSection
          routes={shipmentApprovalRoutes}
          candidates={approverCandidates}
          canManageRepresentatives={canManageRepresentatives}
        />
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
