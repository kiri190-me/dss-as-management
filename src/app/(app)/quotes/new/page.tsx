import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
import { toKstDateOnly } from "@/lib/domain/date-only";
import {
  parseNewQuoteLink,
  returnHrefForNewQuote,
  type SearchParamsInput,
} from "@/lib/domain/quote-new-link";

export const metadata: Metadata = {
  title: "새 견적서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 새 견적서 작성.
 *
 * 목록 화면은 고칠 수 없는 사람에게 `새 견적서` 단추를 그리지 않지만, **그것은
 * 막은 것이 아니다** — 주소를 직접 입력하면 그대로 들어와진다. 그래서 여기서
 * 영역 가드에 더해 쓰기 권한까지 확인하고, 없으면 목록으로 돌려보낸다. 저장
 * 자체는 서버 액션이 또 한 번 처음부터 검사한다(관문이 셋이 아니라, 화면이
 * 감춘 것은 애초에 관문이 아니라는 뜻이다).
 *
 * ── 접수 건에서 들어온 경우 ─────────────────────────────────────────────
 * 수리 건 상세의 「견적서」 탭에서 오면 주소에 **인수번호와 그 건의 id** 가
 * 실려 온다(domain/quote-new-link.ts). 인수번호는 폼이 기존 「불러오기」 길을
 * 그대로 태우는 데 쓰고, 건의 id 는 저장·취소 뒤에 **돌아갈 곳**을 만드는 데
 * 쓴다. 아무것도 실려 오지 않으면 지금까지와 완전히 같은 화면이다.
 */
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsInput>;
}) {
  await requireAreaAccessForCurrentUser("quotes");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="새 견적서"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canEdit =
    actingUser !== null &&
    (await hasPermission(actingUser.role, "quotes", "WRITE"));

  if (!canEdit) redirect("/quotes");

  // 발행일자의 기본값이 되는 "오늘". 서버가 정한다 — 클라이언트에서 만들면
  // 서버가 그린 것과 달라져 hydration 이 어긋나고, 한국 표준시 대신 브라우저
  // 시간대로 날짜가 정해진다(자정 전후 하루가 실제로 다르게 나온다).
  // 장비 종류별 수리 작업 목록과 단가 — 견적서의 작업비가 여기서 나온다.
  // 양식 머리말은 **저장 전 미리보기**가 쓴다(회사 정보·기본 문구·계좌).
  // 작업 내역 기본값은 **머리글까지** 받는다 — 폼이 칸을 채우는 데는 줄 목록이면
  // 되지만, 저장 전 미리보기가 그 양식의 머리글로 작업 내역을 그려야 한다.
  const [repairLabor, printHeaders, workScopeDefaults] = await Promise.all([
    listRepairLabor(),
    readAllQuoteTemplateHeaders(),
    readAllQuoteWorkSectionDefaults(),
  ]);

  const link = parseNewQuoteLink(searchParams ? await searchParams : undefined);

  return (
    <QuoteEditForm
      quote={null}
      defaultQuoteDate={toKstDateOnly(new Date())}
      repairLabor={repairLabor}
      printHeaders={printHeaders}
      workScopeDefaults={workScopeDefaults}
      initialIntakeNumber={link.intakeNumber}
      returnHref={returnHrefForNewQuote(link)}
    />
  );
}
