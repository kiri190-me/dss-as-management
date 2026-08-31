import type { Metadata } from "next";
import RepairLaborScreen from "@/components/repair-labor/RepairLaborScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { canDeleteQuotes } from "@/lib/auth/quote-authorization";
import { getAuthSource } from "@/lib/config/auth-source";
import { listRepairLabor } from "@/lib/db/queries/repair-labor";

export const metadata: Metadata = {
  title: "수리 작업 비용 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 수리 작업 비용 — 견적서 작업비의 근거가 되는 표.
 *
 * 가드가 사이드바보다 먼저 온다 — 메뉴에서 감추는 것은 막은 것이 아니고, 주소를
 * 직접 치거나 예전 링크를 누르면 그대로 들어와진다(견적서 화면의 같은 순서).
 * 여기 있는 것은 **우리가 부르는 값의 근거**라 견적서와 같은 영역으로 묶는다.
 *
 * canEdit 은 **화면을 그리기 위한 값일 뿐 관문이 아니다.** 실제 저장은 서버
 * 액션이 세션부터 다시 확인한다 — 단추를 감추는 것으로 막았다고 여기면, 액션을
 * 직접 부르는 요청 앞에서 아무것도 막지 못한다.
 */
export default async function RepairLaborPage() {
  await requireAreaAccessForCurrentUser("repairLabor");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="수리 작업 비용"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  // 고치는 권한이 견적서를 고치는 것보다 좁다 — 여기 값을 바꾸면 앞으로 나갈
  // 모든 견적서의 금액이 바뀐다(actions/repair-labor.ts 의 같은 판단).
  const canEdit =
    actingUser !== null &&
    canDeleteQuotes(actingUser.role) &&
    (await hasPermission(actingUser.role, "repairLabor", "MANAGE"));

  const kinds = await listRepairLabor();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">수리 작업 비용</h1>
      <RepairLaborScreen kinds={kinds} canEdit={canEdit} />
    </div>
  );
}
