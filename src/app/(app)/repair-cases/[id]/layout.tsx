import { notFound } from "next/navigation";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
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

  return (
    <div className="flex flex-col gap-4">
      <DetailTabs id={id} canViewQuotes={canViewQuotes} />
      {children}
    </div>
  );
}
