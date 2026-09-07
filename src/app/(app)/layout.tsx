import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import BrowserNotifications from "@/components/layout/BrowserNotifications";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { roleLabels } from "@/lib/domain/types";
import { listAccessibleAreaKeys } from "@/lib/auth/permission-resolver";
import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
import { getLoginMode } from "@/lib/config/login-mode";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getSsoPortalUrl } from "@/lib/config/sso";
import { listMyNotifications } from "@/lib/db/queries/notifications";
import { countNotificationTargetsByKind } from "@/lib/domain/notifications";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  // Resolve the live account before trusting anything else about this
  // session. A structurally valid (correctly signed, unexpired) token can
  // still point at an account that no longer exists or is no longer usable
  // (deleted/deactivated/locked, or AUTH_SOURCE changed since the cookie
  // was issued) — that must be treated as "not authenticated", not as a
  // session that silently renders the app shell with no user info and no
  // way to log out or switch accounts.
  const user = await resolveActingUserForSession(session);
  if (!user) {
    redirect("/login");
  }

  // approvalStatus is read from the live resolved user, not the session
  // token's embedded (possibly stale) field — an account demoted from
  // APPROVED to PENDING after the token was issued must lose access
  // immediately, not just once the 8-hour token expires.
  if (user.approvalStatus !== "APPROVED") {
    redirect("/pending-approval");
  }

  // 사이드바에서 감출 항목을 정하기 위한 것이다. 차단 자체는 각 페이지가
  // requireAreaAccess로 따로 하므로, 여기서 열려 있다고 들어가지지는 않는다.
  const accessibleAreaKeys = await listAccessibleAreaKeys(user);

  // 개발자 모드는 위 목록에 **담길 수 없다** — PERMISSION_AREAS 에 없기 때문이고,
  // 없는 이유는 역할별 접근 권한 설정이 「접근을 넓히는 화면」이라서다
  // (auth/developer-mode-gate.ts). 그래서 노출 여부를 여기서 따로 계산해
  // 내려보낸다. 차단 자체는 여전히 그 페이지가 같은 함수로 다시 한다 —
  // 여기서 감춘다고 막히는 것이 아니다.
  const canEnterDeveloperMode = mayEnterDeveloperMode(user);

  // 헤더 종 알림 + 사이드바 "내게 온 결재 요청" 배지 — 여기서 넘기는 사용자
  // id와 역할은 **둘 다 위에서 살아 있는 계정을 다시 읽어 푼 것**이다
  // (resolveActingUserForSession) — 토큰에 박힌 옛 역할이 아니고, 다른 사람
  // 것을 요구할 수 있는 인자도 없다. 결재 권한 판정은 조회 함수가 서버에서
  // 스스로 하고, 실제 승인/반려는 여전히 서버 액션이 다시 확인한다. mock 읽기
  // 모드에는 DB가 없으므로 빈 목록으로 둔다(종·배지 없음).
  //
  // 조회는 여기 한 번뿐이다 — 배지 숫자는 그 결과에서 뽑는다. 배지가 따로 count
  // 조회를 부르면 모든 페이지 로드마다 같은 조회가 두 번 돈다.
  const notifications = getRepairCaseReadSource() === "database" ? await listMyNotifications(user.id, user.role) : [];
  const myPendingApprovalCount = countNotificationTargetsByKind(notifications).REPAIR_CASE_APPROVAL;

  // 통합 로그인으로 들어온 경우에만 포털로 돌아가는 길을 보여준다. 데모
  // 모드에는 갈 곳이 없고, 그 상태에서 링크만 떠 있으면 눌러도 아무 일이
  // 없거나 설정이 없다며 터진다.
  const portalUrl = getLoginMode() === "sso" ? getSsoPortalUrl() : null;

  return (
    <>
      <AppShell
        user={{ name: user.name, roleLabel: roleLabels[user.role], role: user.role }}
        accessibleAreaKeys={accessibleAreaKeys}
        canEnterDeveloperMode={canEnterDeveloperMode}
        myPendingApprovalCount={myPendingApprovalCount}
        notifications={notifications}
        portalUrl={portalUrl}
      >
        {children}
      </AppShell>
      {/*
        화면을 하나도 그리지 않는다(return null) — 위 종에 뜬 것과 **같은 목록**을
        받아, 새로 생긴 것만 컴퓨터·폰 알림창에 띄우는 일만 한다. 조회는 여전히
        위의 한 번뿐이다.

        AppShell 안이 아니라 여기 있는 이유는 사용자 id 때문이다: 이미 띄운
        알림은 사람마다 갈라 적어 둬야 하는데(공용 PC), 종까지 내려보내려면
        AppShell과 TopBar가 쓰지도 않을 값을 날라야 한다.
      */}
      <BrowserNotifications userKey={user.id} items={notifications} />
    </>
  );
}
