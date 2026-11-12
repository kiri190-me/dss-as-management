import { notFound } from "next/navigation";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { isFieldEditable } from "@/lib/auth/repair-case-edit-authorization";
import { resolveRepairCaseDetailTabVisibility } from "@/lib/auth/repair-case-detail-tab-access";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { getIntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { loadRepairCaseFinalShipmentApprovalStates } from "@/lib/db/queries/repair-case-approvals";
import { listDomesticOrderDueDatesForRepairCase } from "@/lib/db/queries/domestic-orders";
import { isFinalShipmentApproved } from "@/lib/domain/final-shipment-approval-badge";
import { isRepairCaseDueDateNear } from "@/lib/domain/notifications";
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
   * 어느 탭을 그릴지 정한다(2026-11-12 — 그 전에는 「견적서」 · 「발주서」 둘뿐이었다).
   *
   * 판정 방법은 각 탭의 화면이 쓰는 것과 **똑같다** — 살아 있는 계정을 다시 읽고
   * (강등된 계정이 옛 토큰으로 다니지 못하게), 탭마다 정해진 열쇠의 READ 를 묻는다.
   * 🔴 **열쇠를 여기 적지 않는다** — 어느 탭이 어느 잎을 보는지는
   * `auth/repair-case-detail-tab-permissions.ts` 한 곳에만 있다. 탭 줄과 각 페이지가
   * 서로 다른 열쇠를 보게 되는 날 증상은 「탭은 없는데 주소로는 들어와진다」이고,
   * 그것은 아무 오류도 내지 않는다.
   *
   * 🔴 이것은 **탭을 그릴지 말지**일 뿐 관문이 아니다. 주소를 직접 치면 그대로
   * 들어와지므로 탭마다 제 page.tsx 가 같은 판정을 한 번 더 한다.
   *
   * 🔴 [기본 정보] 탭은 이 꾸러미에 없다 — 가리지 않기로 한 탭이고, 여덟을 전부
   * 닫아도 그 하나는 남는다(그래서 「탭이 하나도 없는 사람」이 생기지 않는다).
   *
   * 세션이 없으면 상위 (app) 레이아웃이 이미 로그인으로 보냈다 — 여기서는 못
   * 보는 것으로만 취급한다(형제 탭들과 같은 방어적 처리).
   *
   * 🔵 열쇠가 여덟이어도 **질의는 요청당 한 번**이다(permission-resolver 의 cache()).
   */
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const tabVisibility = await resolveRepairCaseDetailTabVisibility(actingUser);

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

  /**
   * 머리 카드의 「납기 임박」 배지(2026-10-19 사용자 요구).
   *
   * 🔴 **여기서 읽어야 한다.** 이 건의 `고객 요청 납기일` 칸이 비어 있으면 화면에
   * 보이는 날짜는 연결된 내자 정리에서 빌려 온 것인데(domain/requested-due-date-link.ts),
   * 그 날짜를 읽는 곳은 「기본 정보」 탭([id]/page.tsx)뿐이었다. 레이아웃이 그걸
   * 모르면 **상세정보에는 날짜가 보이는데 머리 줄에만 배지가 없는** 건이 생긴다 —
   * 종 알림이 그 빌려 온 날짜로 뜨고 있으므로 정확히 「종과 화면이 다른 말을 하는」
   * 모양이다. 한 건에 대한 작은 인덱스 조회 하나다.
   *
   * 🔴 판정은 새로 적지 않는다 — 종 알림이 쓰는 세 함수를 그대로 묶은
   * isRepairCaseDueDateNear 하나를 부른다(domain/notifications.ts). "오늘"도
   * 서버가 정한다: 화면에서 new Date() 로 만들면 서버가 그린 것과 어긋난다.
   *
   * mock/로컬 소스에는 내자 정리가 없으므로 빈 배열이다 — [id]/page.tsx 가 같은
   * 조회를 같은 조건으로 거르는 것과 한 줄도 다르지 않다.
   */
  const headerDomesticOrderDueDates =
    resolved.source === "DATABASE" ? await listDomesticOrderDueDatesForRepairCase(resolved.id) : [];
  const isDueDateNear = isRepairCaseDueDateNear(
    {
      customerRequestedDueDate: resolved.customerRequestedDueDate,
      domesticOrderDueDates: headerDomesticOrderDueDates,
      status: resolved.status,
      actualShipmentDate: resolved.actualShipmentDate,
    },
    new Date()
  );

  /**
   * 🔴 머리 카드의 「[최종 출하 승인 완료]」 배지(2026-11-08 사용자 요구 —
   * 「현황판과 **상세페이지 헤드**, 내자정리의 [완료 처리]버튼의 오른쪽」).
   *
   * 🔴 **여기서 읽어야 한다** — 바로 위 「납기 임박」과 같은 사정이다. 이 카드는
   * 탭 줄보다 위에서 그려지므로 어느 탭에서도 같은 배지가 보여야 하는데, 승인
   * 자료를 읽는 곳은 [승인] 탭뿐이었다. 레이아웃이 모르면 **탭을 옮기면 배지가
   * 사라지는** 건이 생긴다.
   *
   * 🔵 **전체 A/S 현황과 같은 함수**를 부른다 — 건 하나짜리 묶음이다. 목록 쪽과
   * 판정이 갈릴 자리를 아예 없애려는 것이고(같은 건이 목록에서는 붙고 상세에서는
   * 안 붙는 날이 오지 않게), 질의는 작은 인덱스 조회 하나다.
   *
   * mock/로컬 소스에는 결재 표 자체가 없다 — 위 내자 납기요청일과 같은 조건으로
   * 거른다.
   */
  const finalShipmentApprovalStates =
    resolved.source === "DATABASE"
      ? await loadRepairCaseFinalShipmentApprovalStates([resolved.id])
      : null;
  const headerFinalShipmentApproved = isFinalShipmentApproved(
    finalShipmentApprovalStates?.get(resolved.id) ?? null
  );

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
        isDueDateNear={isDueDateNear}
        isFinalShipmentApproved={headerFinalShipmentApproved}
      />
      <DetailTabs id={id} visibility={tabVisibility} />
      {children}
    </div>
  );
}
