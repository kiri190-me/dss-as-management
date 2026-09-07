import { hasPermission } from "@/lib/auth/permission-resolver";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CustomerRequestListScreen, {
  type RequestListItem,
} from "@/components/customer-portal/CustomerRequestListScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listAllCustomerRepairRequests } from "@/lib/db/queries/customer-portal";

export const metadata: Metadata = {
  title: "수리 의뢰 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 고객이 보낸 수리 의뢰 목록.
 *
 * 같은 권한 구역(`customerPortal`)을 쓴다 — 고객에게 무엇이 보이는지 아는
 * 사람과 그 고객의 의뢰를 처리하는 사람이 같기 때문이다. 구역을 둘로 나누면
 * 설정 화면에 비슷한 이름 둘이 서고, 어느 것을 켜야 하는지 고르는 사람이
 * 헷갈린다.
 */
export default async function CustomerRequestsPage() {
  await requireAreaAccessForCurrentUser("customerPortal");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="수리 의뢰"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!(await hasPermission(actingUser, "customerPortal", "READ"))) {
    return (
      <PlaceholderPage
        title="수리 의뢰"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  const rows = await listAllCustomerRepairRequests();

  const requests: RequestListItem[] = rows.map((row) => ({
    ...row,
    // 화면은 날짜만 보면 된다. Date 객체를 그대로 넘기면 서버 컴포넌트에서
    // 클라이언트로 건너갈 때 직렬화 규칙에 얽매인다.
    submittedAt: row.submittedAt.toISOString().slice(0, 10),
  }));

  return (
    <CustomerRequestListScreen
      requests={requests}
      canConvert={await hasPermission(actingUser, "customerPortal", "WRITE")}
    />
  );
}
