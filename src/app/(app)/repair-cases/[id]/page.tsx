import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { findOhTemplateForRepairCase } from "@/lib/db/queries/oh-part-templates";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { resolveAllRepairCases } from "@/lib/domain/local/resolved-repair-case";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { findProductHistoryMatches } from "@/lib/domain/local/product-history-match";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { getIntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { getPartList, getPartOwnerAvailability, groupPartOwnerAvailability } from "@/lib/db/queries/inventory";
import { getRequestCaseContext, getOwnPartRequestsForCase } from "@/lib/db/queries/inventory-part-requests";
import { getDerivedServiceSummaryForCase } from "@/lib/db/queries/repair-case-work-records";
import { listDomesticOrderDueDatesForRepairCase } from "@/lib/db/queries/domestic-orders";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import RepairCaseDetailView from "@/components/repair-cases/detail/RepairCaseDetailView";

export const metadata: Metadata = {
  title: "A/S 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Section editing과 PartRequestSection이 처리 주체(actingUser)를 필요로
  // 하므로 approval/files 페이지와 동일한 기존 readSession 패턴을 그대로
  // 재사용한다(워크플로 제어 액션 자체는 Phase 5C-1부터 execution/page.tsx로
  // 이동했다).
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const actingUser: ActingUser | null = await resolveActingUserForSession(session);

  const resolved = await resolveRepairCaseForServer(id);

  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다(같은 요청 내에서는 cache()로 동일한 결과를 재사용한다).
  // 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  // 서버 컴포넌트이므로 로컬 데이터에 접근할 수 없다 — mock 전용 병합 목록으로
  // 과거 이력을 조회한다(mock-to-mock은 productId로 매칭되므로 결과는 기존과
  // 동일하다). DATABASE 소스 건은 정규화 3필드(Model+L/N+S/N) 비교로 대체
  // 매칭된다(product-history-match.ts의 기존 폴백 경로, 이 배치에서 변경하지
  // 않음).
  const related = findProductHistoryMatches(resolveAllRepairCases([]), resolved);

  // Section editing only ever targets a DATABASE-sourced row (the update
  // Server Action itself independently re-checks both this and the write-
  // source flag) — only fetch the real customer/End-User/engineer option
  // lists when both conditions actually hold, same gating IntakeForm's
  // create path already uses.
  const writeSource = getRepairCaseWriteSource();
  const isDatabaseBacked = resolved.source === "DATABASE" && writeSource === "database";
  const referenceData = isDatabaseBacked ? await getIntakeReferenceData() : null;

  // 부품 요청 칸 — DATABASE 소스 건에만 뜬다(요청 표에는 mock 대응물이 없다).
  // 조회를 칸 안이 아니라 여기서 하는 이유는, 권한 없는 역할이 결과를 아예
  // 받지 못하게 하기 위해서다. 그래도 편의일 뿐이고 저장은 mutation 이 다시
  // 처음부터 확인한다.
  //
  // ── 🔴 역할 이름이 아니라 설정을 본다 ────────────────────────────────
  // 예전에는 역할 이름을 그대로 비교했다. inventory 는 설정이 최종 판정인
  // 메뉴인데(permission-features.ts 의 SETTINGS_ENFORCED_AREAS) 이 한 줄만
  // 그 약속에서 빠져 있었다 — 저장하는 쪽은 이미 hasPermission 을 보고
  // 있어서, 역할별 접근 권한에서 '부품 요청'을 쓰기로 올려도 **칸 자체가
  // 그려지지 않아** 올릴 방법이 없었다(2026-08-28).
  const partRequestData =
    isDatabaseBacked &&
    actingUser !== null &&
    (await hasPermission(actingUser.role, "inventory.requests", "WRITE"))
      ? {
          caseContext: await getRequestCaseContext(resolved.id),
          availableParts: await getPartList(),
          // 이 장비 모델에 이어진 O/H 템플릿. 없으면 null 이고, 그때는 화면이
          // 일괄 담기 단추를 그리지 않는다.
          ohTemplate: await findOhTemplateForRepairCase(id),
          // 소유구분-scoped 가용 수량 checkpoint — grouped by (part, owner);
          // a missing (partId, owner) entry means 0, never "unknown" (see
          // getPartOwnerAvailability's doc comment).
          ownerAvailabilityByPartId: groupPartOwnerAvailability(await getPartOwnerAvailability()),
          ownRequests: await getOwnPartRequestsForCase(resolved.id, actingUser.id),
        }
      : null;

  // 고장 및 서비스 정보의 3개 요약 필드(인수점검 결과/현재 진단·조치 요약/
  // 다음 예정 작업)의 정상 소스 — DATABASE 소스 건에만 존재하는
  // repair_case_work_records.record_kind에서 결정론적으로 도출한다
  // (record_kind 분류 체크포인트). MOCK/LOCAL_DEMO는 이 테이블 자체가
  // 없으므로 조회하지 않는다.
  //
  // 내자 정리 납기요청일 — 인수 정보의 `고객 요청 납기일`이 비어 있을 때 대신
  // 그릴 날짜의 재료다(domain/requested-due-date-link.ts). domestic_orders는
  // DATABASE 소스에만 존재하므로 위 요약과 같은 조건으로 가져오고, **왕복을
  // 하나 더 만들지 않도록 Promise.all로 나란히 태운다** — 둘 다 이 건 하나만
  // 보는 작은 인덱스 조회다.
  //
  // 여기서 "가장 이른 하루"로 접지 않고 날짜를 그대로 넘기는 이유: 고르는
  // 규칙은 주간보고 `입고 요청일`과 **같은 도메인 함수**가 가져야 하고
  // (pickEarliestDueDate), 그래야 두 화면이 같은 자료를 다른 날짜로 보여 줄 수
  // 없다.
  const [derivedServiceSummary, domesticOrderDueDates] = await Promise.all([
    resolved.source === "DATABASE" ? getDerivedServiceSummaryForCase(resolved.id) : null,
    resolved.source === "DATABASE" ? listDomesticOrderDueDatesForRepairCase(resolved.id) : [],
  ]);

  return (
    <RepairCaseDetailView
      resolved={resolved}
      related={related}
      actingUser={actingUser}
      referenceData={referenceData}
      partRequestData={partRequestData}
      derivedServiceSummary={derivedServiceSummary}
      domesticOrderDueDates={domesticOrderDueDates}
    />
  );
}
