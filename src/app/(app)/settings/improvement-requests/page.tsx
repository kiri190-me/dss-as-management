import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ImprovementRequestsScreen from "@/components/settings/ImprovementRequestsScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listImprovementRequests } from "@/lib/db/queries/improvement-requests";

export const metadata: Metadata = {
  title: "개선 요청 | DSS A/S 관리 시스템",
};

// 방금 누가 적었거나 상태를 옮겼을 수 있다 — 캐시된 목록을 보여 주면 같은
// 요청이 두 번 올라오고, 버전이 낡아 저장이 충돌한다.
export const dynamic = "force-dynamic";

/**
 * 설정 › 개선 요청.
 *
 * 권한을 두 곳에서 본다 — 여기(영역 가드 + 등록칸·단추 표시)와 서버 액션
 * (server/actions/improvement-requests.ts). 두 곳이 **같은 영역 · 같은 수준**을
 * 본다: 보기 READ(가드), 적기·고치기·지우기 WRITE, 상태 옮기기·남의 글 지우기
 * MANAGE. 화면이 단추를 감추는 것은 편의이고, 막는 것은 액션이다.
 *
 * 글 한 건에 대한 판정(접수 상태인 자기 글인가)은 여기서 하지 않는다 — 화면이
 * 도메인 함수(domain/improvement-request.ts)를 줄마다 부르고, 저장은 mutation 이
 * 잠근 행으로 같은 함수를 다시 부른다.
 */
export default async function ImprovementRequestsPage() {
  // 역할별 접근 권한에서 이 메뉴가 꺼져 있으면 주소를 직접 입력해도 못 들어온다.
  await requireAreaAccessForCurrentUser("improvementRequests");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="개선 요청"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const [canWrite, canManage, items] = await Promise.all([
    hasPermission(actingUser, "improvementRequests", "WRITE"),
    hasPermission(actingUser, "improvementRequests", "MANAGE"),
    listImprovementRequests(),
  ]);

  return (
    <div className="p-6">
      <ImprovementRequestsScreen
        items={items}
        actingUserId={actingUser.id}
        canWrite={canWrite}
        canManage={canManage}
      />
    </div>
  );
}
