import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import QuoteEditForm from "@/components/quotes/QuoteEditForm";
import { listRepairLabor } from "@/lib/db/queries/repair-labor";
import {
  readAllQuoteTemplateHeaders,
  readAllQuoteWorkSectionDefaults,
} from "@/lib/storage/quote-template";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { isValidQuoteId } from "@/lib/validation/quote-input";
import { toKstDateOnly } from "@/lib/domain/date-only";

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
 */
export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
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
  const [repairLabor, printHeaders, workScopeDefaults] = await Promise.all([
    listRepairLabor(),
    readAllQuoteTemplateHeaders(),
    readAllQuoteWorkSectionDefaults(),
  ]);

  return (
    <QuoteEditForm
      quote={quote}
      defaultQuoteDate={toKstDateOnly(new Date())}
      repairLabor={repairLabor}
      printHeaders={printHeaders}
      workScopeDefaults={workScopeDefaults}
    />
  );
}
