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
import { listRepairCasesByProductId } from "@/lib/db/queries/repair-cases";
import {
  getPartList,
  getPartOwnerAvailability,
  getPartPickerList,
  groupPartOwnerAvailability,
} from "@/lib/db/queries/inventory";
import { getRequestCaseContext, getOwnPartRequestsForCase } from "@/lib/db/queries/inventory-part-requests";
import {
  getDerivedServiceSummariesForCases,
  getDerivedServiceSummaryForCase,
  type DerivedServiceSummary,
} from "@/lib/db/queries/repair-case-work-records";
import { listDomesticOrderDueDatesForRepairCase } from "@/lib/db/queries/domestic-orders";
import { getRepairCaseUsedPartsView } from "@/lib/db/queries/repair-case-used-parts";
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

  // 「이 제품의 과거 A/S 이력」 후보 목록.
  //
  // ── 🔴 DATABASE 건은 DB 에서 직접 가져온다 ──────────────────────────
  // 예전에는 소스와 무관하게 `resolveAllRepairCases([])`(= mock 전용 병합
  // 목록)를 넘겼다. 시스템이 실제 DB 로 넘어온 뒤로 DATABASE 소스 건은
  // 후보에 단 하나도 들어가지 못해 **언제나 "이력 없음"** 이었다. 같은
  // product_id 로 재접수된 건을 목록/상세와 같은 join·mapper 로 가져온다.
  //
  // MOCK/LOCAL_DEMO 는 서버 컴포넌트에서 로컬 데이터(localStorage)에 닿을 수
  // 없으므로 종전 그대로 mock 전용 병합 목록을 쓴다 — mock-to-mock 은
  // productId 로 매칭되므로 그 경로의 결과는 한 줄도 달라지지 않는다.
  const historyCandidates =
    resolved.source === "DATABASE" && resolved.productId !== null
      ? await listRepairCasesByProductId(resolved.productId)
      : resolveAllRepairCases([]);
  const related = findProductHistoryMatches(historyCandidates, resolved);

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
    (await hasPermission(actingUser, "inventory.requests", "WRITE"))
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
  //
  // 이력 줄들의 `조치 내용` — 같은 표, 같은 규칙, **한 번의 왕복**으로.
  // 줄마다 getDerivedServiceSummaryForCase 를 부르면 이력 수만큼 왕복이
  // 생기므로(N+1) 형제 함수에 id 목록을 한꺼번에 넘긴다. 이력 줄에 보이는
  // 글과 그 건을 눌러 들어갔을 때 본문에 보이는 글은 **같은 소스**여야
  // 하므로, repair_cases 의 옛 텍스트 칼럼이 아니라 위 본문 요약과 똑같이
  // 작업기록에서 도출한다.
  //
  // MOCK/LOCAL_DEMO 건은 애초에 작업기록 표에 대응물이 없으므로 목록에서
  // 빠진다(이력 매칭 규칙상 MOCK 건의 이력은 MOCK 뿐이라 이 목록이 통째로
  // 비고, 조회 자체가 일어나지 않는다).
  const relatedDatabaseCaseIds = related.filter((match) => match.source === "DATABASE").map((match) => match.id);

  // 「사용 부품」 칸 — 그 건에 손으로 적어 둔 부품 줄과, "여기에 적을 건인가"의
  // 재료(살아 있는 부품 요청 줄이 있는가). 위 둘과 같은 이유로 DATABASE 소스에만
  // 있고(repair_case_used_parts 에 mock 대응물이 없다), **같은 Promise.all 에
  // 태워 왕복을 늘리지 않는다** — 이 건 하나만 보는 작은 인덱스 조회다.
  //
  // 그 칸의 품명 입력에서 찾아 고를 부품 마스터(B-2)도 같은 묶음에 태운다 — 재고 ·
  // 소유구분 · 내부 비고가 없는 가벼운 조회이고(getPartPickerList 머리말), 백 줄
  // 안쪽이라 통째로 내려보내고 브라우저에서 거른다. 적을 수 없는 건인지는 화면이
  // 아니라 위 writeGate 가 정하므로 여기서 미리 나누지 않는다 — 나누면 판정이
  // 두 벌이 된다.
  //
  // 🔴 역할을 조회에 넘긴다 — 누가 적을 수 있는지도 그 writeGate 가 정하기
  // 때문이다(auth/repair-case-used-parts-authorization.ts). 여기서 역할 이름을
  // 비교하지 않는다. actingUser 가 null 이면(삭제 · 정지 · 세션 끊김) null 을
  // 그대로 넘겨 닫히는 쪽으로 떨어뜨린다 — 칸 자체는 읽기로 남는다.
  const [derivedServiceSummary, domesticOrderDueDates, relatedSummaryByCaseId, usedParts, usedPartOptions] =
    await Promise.all([
      resolved.source === "DATABASE" ? getDerivedServiceSummaryForCase(resolved.id) : null,
      resolved.source === "DATABASE" ? listDomesticOrderDueDatesForRepairCase(resolved.id) : [],
      relatedDatabaseCaseIds.length > 0
        ? getDerivedServiceSummariesForCases(relatedDatabaseCaseIds)
        : new Map<string, DerivedServiceSummary>(),
      resolved.source === "DATABASE"
        ? getRepairCaseUsedPartsView(resolved.id, actingUser?.role ?? null)
        : null,
      resolved.source === "DATABASE" ? getPartPickerList() : [],
    ]);

  // 화면에는 이력 줄이 실제로 그리는 한 칸(조치 내용)만 건 id 로 찾을 수 있게
  // 넘긴다 — 요약의 나머지 두 칸까지 클라이언트로 실어 보낼 이유가 없다.
  // 작업기록이 없는 건은 여기서 null 이 되고, 화면은 "-" 를 그린다.
  const relatedActionSummaries = Object.fromEntries(
    related.map((match) => [match.id, relatedSummaryByCaseId.get(match.id)?.currentDiagnosisSummary ?? null])
  );

  return (
    <RepairCaseDetailView
      resolved={resolved}
      related={related}
      relatedActionSummaries={relatedActionSummaries}
      actingUser={actingUser}
      referenceData={referenceData}
      partRequestData={partRequestData}
      derivedServiceSummary={derivedServiceSummary}
      domesticOrderDueDates={domesticOrderDueDates}
      usedParts={usedParts}
      usedPartOptions={usedPartOptions}
    />
  );
}
