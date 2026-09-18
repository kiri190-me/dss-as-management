import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import QuoteEditForm from "@/components/quotes/QuoteEditForm";
import QuoteEditTabs from "@/components/quotes/QuoteEditTabs";
import QuoteApprovalPanel from "@/components/quotes/QuoteApprovalPanel";
import { listRepairLabor } from "@/lib/db/queries/repair-labor";
import { getPartPickerList, getPartPickerUnitPrices } from "@/lib/db/queries/inventory";
import {
  readAllQuoteTemplateHeaders,
  readAllQuoteWorkSectionDefaults,
} from "@/lib/storage/quote-template";
import { CABLE_QUOTE_MAX_LINES } from "@/lib/xlsx/cable-quote-template";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { listQuoteAttachmentSlots } from "@/lib/db/queries/attachments";
import {
  getQuoteApprovalHistory,
  getQuoteApprovalProgress,
} from "@/lib/db/queries/quote-approvals";
import {
  getCurrentShipmentApprovalRoute,
  listShipmentApprovalRouteSteps,
} from "@/lib/db/queries/shipment-approval-routes";
import {
  QUOTE_APPROVAL_ROUTE_SCOPE,
  isQuoteApprovalRouteInForce,
} from "@/lib/domain/quote-approval-rules";
import { isValidQuoteId } from "@/lib/validation/quote-input";
import { toKstDateOnly } from "@/lib/domain/date-only";
import { returnHrefForEditQuote, type SearchParamsInput } from "@/lib/domain/quote-new-link";

export const metadata: Metadata = {
  title: "견적서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 견적서 한 장 — 수정.
 *
 * 3단계까지는 자리표시자였다. 이제 실제 값을 읽어 폼을 연다.
 *
 * ── 못 찾는 것과 못 보는 것을 갈라 답하지 않는다 ────────────────────────
 * 지워진 장, 없는 id, 형식이 틀린 id 는 전부 404 다. "그 id 는 실재하지만
 * 지워졌다"처럼 갈라 답하면, 볼 자격이 없는 사람이 어떤 견적서가 존재하는지
 * 알아낼 수 있게 된다(attachments 다운로드 라우트의 같은 판단).
 *
 * 볼 수는 있지만 고칠 수 없는 사람은 목록으로 돌려보낸다. 3단계 목록은 조회
 * 권한만으로 열리므로 그 사람도 여기까지 올 수 있고, 읽기 전용 상세 화면은
 * 아직 없다 — 저장할 수 없는 폼을 그려 주고 마지막에 거절하는 것보다 낫다.
 *
 * ── 탭이 둘이다 ────────────────────────────────────────────────────────
 * [견적서 수정] · [견적서 결재]. 이 페이지는 서버 컴포넌트라 탭 상태를 쥘 수
 * 없으므로, 두 화면을 **여기서 그려** 클라이언트 껍데기(QuoteEditTabs)에
 * 넘긴다. 껍데기가 둘을 함께 그리고 안 보이는 쪽만 감춘다 — 🔴 탭을 바꿨다고
 * 편집 폼을 떼어내면 적던 품목·금액이 통째로 사라진다(그 파일의 머리말).
 *
 * 🔴 **결재는 발행을 막지 않는다**(2026-09-18 사용자 결정). 아래에서 읽는 결재
 * 값은 전부 **표시용**이고, [견적서 받기]·미리보기·엑셀 통로 어디에도 닿지
 * 않는다 — 그것은 빠뜨린 것이 아니라 정해진 것이다.
 *
 * 🔴 **새 견적서(`/quotes/new`)에는 결재 탭이 없다.** 그 페이지는 이 껍데기를
 * 쓰지 않고 편집 폼을 그대로 그린다 — 아직 저장되지 않아 결재를 걸 대상이 없다.
 *
 * ── 접수 건의 「견적서」 탭에서 들어온 경우 ──────────────────────────────
 * 주소에 그 건의 id 가 실려 온다(domain/quote-new-link.ts 의 quoteEditHref).
 * 그 id 가 **이 견적서가 붙은 건과 같을 때만** [취소]가 그 탭으로 돌아간다 —
 * 아니면 지금까지와 같이 `/quotes` 다(returnHrefForEditQuote 머리말). 저장은
 * 이 주소에 머물러 다시 읽기만 하므로 돌아갈 곳과 무관하다.
 */
export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
}) {
  await requireAreaAccessForCurrentUser("quotes");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="견적서"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const { id } = await params;
  // 형식이 틀린 id 로 DB 를 때리지 않는다 — uuid 가 아닌 값은 조회 자체가 오류다.
  if (!isValidQuoteId(id)) notFound();

  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canEdit =
    actingUser !== null &&
    (await hasPermission(actingUser, "quotes", "WRITE"));

  if (!canEdit) redirect("/quotes");

  const quote = await getQuoteForEdit(id);
  if (!quote) notFound();

  // 장비 종류별 수리 작업 목록과 단가 — 견적서의 작업비가 여기서 나온다.
  // 양식 머리말은 미리보기가 쓴다 — **지금 폼에 적힌 값으로** 그리므로, 아직
  // 저장하지 않은 수정분도 그대로 보인다.
  // 작업 내역 기본값은 **머리글까지** 받는다 — 미리보기가 그 양식의 머리글로
  // 작업 내역을 그려야 저장 전과 후가 같은 문서로 보인다.
  // 결재 PDF · 수기 엑셀 두 칸 — 칸마다 지금 붙어 있는 파일(휴지통 것은 빼고). 내부 경로는
  // 싣지 않는 조회다(queries/attachments.ts 의 listQuoteAttachmentSlots).
  // 부품 마스터 — 품명 칸에서 찾아 고르는 데 쓴다. 새 견적서 페이지의 같은 항목이고,
  // 재고 · 소유구분이 없는 가벼운 조회다(getPartPickerList 머리말).
  // 단가는 고를 때 단가 칸까지 채우는 데 쓴다 — 새 견적서 페이지의 같은 항목이고, 단가가
  // 적힌 부품만 열몇 줄이라 같은 묶음에 태운다(getPartPickerUnitPrices 머리말).
  // 결재 탭이 그릴 것 셋 — 지금 상태(+ 그 근거인 판 번호 비교), 이력, 그리고
  // 지금 쓰이는 「견적서 승인」 결재선. 🔴 상태 판정은 여기서 하지 않는다.
  // getQuoteApprovalProgress 가 도메인 함수 하나(resolveQuoteApprovalState)로
  // 정해 주고, 화면은 그 답을 그대로 그린다 — 두 곳에서 계산하면 화면은
  // 「승인 완료」라는데 기록은 「낡았다」고 답하는 날이 온다.
  const [
    repairLabor,
    printHeaders,
    workScopeDefaults,
    attachmentSlots,
    partOptions,
    partPrices,
    approvalProgress,
    approvalHistory,
    currentApprovalRoute,
  ] = await Promise.all([
    listRepairLabor(),
    readAllQuoteTemplateHeaders(),
    readAllQuoteWorkSectionDefaults(),
    listQuoteAttachmentSlots(quote.id),
    getPartPickerList(),
    getPartPickerUnitPrices(),
    getQuoteApprovalProgress(quote.id),
    getQuoteApprovalHistory(quote.id),
    getCurrentShipmentApprovalRoute(QUOTE_APPROVAL_ROUTE_SCOPE),
  ]);

  // 🔴 이력의 줄들이 가리키는 **판들**을 한 번에 읽는다. 「n/m단계」의 m 은 그
  // 줄에 적힌 판으로 세야 한다 — 관리자가 절차를 바꾸면 새 판이 얹히고 진행
  // 중이던 건은 옛 판을 끝까지 따라가므로, 현재 판으로 세면 다 끝난 옛 줄이
  // 아직 사람이 더 남은 것처럼 보인다(listShipmentApprovalRouteSteps 머리말).
  // 가장 최근 줄은 이력의 첫 줄이므로 따로 더할 것이 없다.
  const approvalRouteSteps = await listShipmentApprovalRouteSteps(
    approvalHistory.flatMap((row) => (row.routeId ? [row.routeId] : []))
  );

  // 돌아갈 곳은 **읽어 온 견적서의 건과 맞춰 본 뒤에** 정한다 — 주소만 보고
  // 정하면 손으로 바꾼 링크가 사람을 남의 건으로 보낸다.
  const returnHref = returnHrefForEditQuote(searchParams ? await searchParams : undefined, quote);

  return (
    <QuoteEditTabs
      /* 🔴 지금까지의 편집 폼 그대로다 — 탭이 생겼다고 이 조각이 달라지지 않는다.
         탭을 바꿔도 이 폼은 떼어지지 않는다(QuoteEditTabs 머리말). */
      editForm={
        <QuoteEditForm
          quote={quote}
          defaultQuoteDate={toKstDateOnly(new Date())}
          repairLabor={repairLabor}
          partOptions={partOptions}
          partPrices={partPrices}
          /* 케이블 견적서의 줄 수 상한 — 채우개의 상수를 그대로 내려보낸다(새 견적서 페이지의 같은 항목). */
          cableMaxLines={CABLE_QUOTE_MAX_LINES}
          printHeaders={printHeaders}
          workScopeDefaults={workScopeDefaults}
          returnHref={returnHref}
          attachmentSlots={attachmentSlots}
        />
      }
      approvalPanel={
        <QuoteApprovalPanel
          quoteId={quote.id}
          /* 견적서를 이미 읽어 왔으므로 progress 가 null 일 수 없다(그 조회는
             없는 장·휴지통에만 null 이다). 그래도 상태 하나를 기본값으로 둔다 —
             경계를 넘는 값에 `!` 를 붙이지 않는 것이 이 저장소의 관례다. */
          state={approvalProgress?.state ?? "NOT_REQUESTED"}
          latest={approvalProgress?.latest ?? null}
          history={approvalHistory}
          routeSteps={approvalRouteSteps}
          /* 🔴 판이 없거나 단계가 0개면 서버가 요청을 ROUTE_NOT_CONFIGURED 로
             거절한다. 판정을 여기 새로 적지 않고 도메인 함수를 그대로 부른다. */
          isRouteConfigured={isQuoteApprovalRouteInForce(currentApprovalRoute)}
          /* 그릴 것만 골라 넘긴다 — 결재선 편집 화면이 쓰는 계정 상태(잠김 시각
             같은)는 이 화면이 보여 줄 것이 아니다. */
          currentRouteSteps={(currentApprovalRoute?.steps ?? []).map((step) => ({
            stepOrder: step.stepOrder,
            approverName: step.approverName,
          }))}
          /* 지정 관문을 판정하는 데 필요한 만큼만. `actingUser` 가 여기서 null 이
             아닌 것은 위 canEdit 가 그것을 포함해 참일 때만 지나왔기 때문이다. */
          actingUser={{
            id: actingUser.id,
            role: actingUser.role,
            isDeveloper: actingUser.isDeveloper,
          }}
        />
      }
    />
  );
}
