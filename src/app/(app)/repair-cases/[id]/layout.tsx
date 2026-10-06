import { notFound } from "next/navigation";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isFieldEditable } from "@/lib/auth/repair-case-edit-authorization";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { getIntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import DetailHeader from "@/components/repair-cases/detail/DetailHeader";
import DetailTabs from "@/components/repair-cases/detail/DetailTabs";

// This segment resolves session-independent, read-source-dependent data
// (mock lookup or a live DB query) on every request — never statically
// cached.
export const dynamic = "force-dynamic";

export default async function RepairCaseDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Read-source-aware: resolves against mock-data.ts in mock mode, or
  // queries PostgreSQL in database mode (request-deduplicated via
  // resolveRepairCaseForServer's cache() — [id]/page.tsx and the other
  // tabs resolving the same id in this request reuse this same result
  // rather than re-querying). A genuine DB failure is not caught here —
  // it propagates to repair-cases/error.tsx, never becomes notFound().
  const resolved = await resolveRepairCaseForServer(id);

  if (!resolved) {
    notFound();
  }

  /**
   * 「견적서」 탭을 그릴지 정한다. 견적서에는 우리가 고객사에 부른 값이 통째로
   * 있어서, PO/내자 메뉴에서 못 보는 사람이 이 탭으로 금액을 들여다볼 수 있으면
   * 그것은 인가 구멍이다.
   *
   * 판정 방법은 `/quotes` 화면이 쓰는 것과 **똑같다** — 살아 있는 계정을 다시
   * 읽고(강등된 계정이 옛 토큰으로 다니지 못하게), `quotes` 영역의 READ 를
   * 묻는다. 새 영역 열쇠를 만들지 않는다: 견적서를 볼 수 있는가는 이미
   * `quotes` 하나가 답하고 있다.
   *
   * 🔴 이것은 **탭을 그릴지 말지**일 뿐 관문이 아니다. 주소를 직접 치면 그대로
   * 들어와지므로 `[id]/quotes/page.tsx` 가 같은 판정을 한 번 더 한다.
   *
   * 세션이 없으면 상위 (app) 레이아웃이 이미 로그인으로 보냈다 — 여기서는 못
   * 보는 것으로만 취급한다(형제 탭들과 같은 방어적 처리).
   */
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canViewQuotes =
    actingUser !== null && (await hasPermission(actingUser, "quotes", "READ"));

  /**
   * 머리 카드(DetailHeader)의 재료 — 2026-10-06 이전에는 「기본 정보」 탭의
   * RepairCaseDetailView 가 구했다. 카드가 탭 위로 올라오면서 **같은 함수 · 같은
   * 열쇠**를 이 자리로 옮겨 왔을 뿐, 판정을 새로 만들거나 넓히지 않았다.
   *
   *  · referenceData — [id]/page.tsx 와 똑같은 조건(DATABASE 소스 + 쓰기 소스가
   *    database)일 때만 구한다. 담당 엔지니어 콤보박스의 후보 목록이다.
   *    🔴 같은 요청 안에서 page.tsx 도 이것을 부르지만 getIntakeReferenceData 가
   *    cache() 로 감싸여 있어 **질의는 요청당 한 번**이다.
   *  · canEditEngineer / canEditReportNumber — RepairCaseDetailView 가 쓰던
   *    isFieldEditable 그대로다(auth/repair-case-edit-authorization.ts). 화면이
   *    단추를 감추는 것은 UX 편의일 뿐 관문이 아니다 — 저장은 서버 액션이 같은
   *    표를 보고 처음부터 다시 확인한다.
   */
  const isDatabaseBacked =
    resolved.source === "DATABASE" && getRepairCaseWriteSource() === "database";
  const referenceData = isDatabaseBacked ? await getIntakeReferenceData() : null;
  const canEditAtAll = resolved.source === "DATABASE" && actingUser !== null;
  const canEditEngineer =
    canEditAtAll && actingUser !== null && isFieldEditable(actingUser.role, "assignedEngineerId");
  const canEditReportNumber =
    canEditAtAll && actingUser !== null && isFieldEditable(actingUser.role, "legacyReportNumber");

  return (
    <div className="flex flex-col gap-4">
      {/* 🔴 탭 줄보다 **위**다 — 어느 탭을 눌러도 같은 카드가 그대로 남는다
          (2026-10-06 사용자 지정). 「견적서」 탭처럼 조건부로 사라지는 것이 아니라
          늘 그려진다. */}
      <DetailHeader
        resolved={resolved}
        canEditEngineer={canEditEngineer}
        canEditReportNumber={canEditReportNumber}
        referenceData={referenceData}
      />
      <DetailTabs id={id} canViewQuotes={canViewQuotes} />
      {children}
    </div>
  );
}
