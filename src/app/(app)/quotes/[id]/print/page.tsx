import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QuotePrintView from "@/components/quotes/QuotePrintView";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getAuthSource } from "@/lib/config/auth-source";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { isValidQuoteId } from "@/lib/validation/quote-input";
import { readAllQuoteTemplateHeaders, readQuoteWorkSections } from "@/lib/storage/quote-template";
import { quoteTemplateKey } from "@/lib/domain/quote-template-variant";
import { returnHrefForQuotePrint, type SearchParamsInput } from "@/lib/domain/quote-new-link";

export const metadata: Metadata = {
  title: "견적서 미리보기 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 견적서 미리보기 · PDF.
 *
 * ── 읽기 권한이면 된다 ──────────────────────────────────────────────────
 * 아무것도 바꾸지 않고 이미 저장된 값을 보여 줄 뿐이라, 목록에서 그 견적서를 볼
 * 수 있는 사람이면 미리보기도 열 수 있는 것이 맞다 — xlsx 라우트와 같은 판단이다.
 * 수정 화면(`/quotes/{id}`)이 쓰기 권한을 요구하는 것과 여기가 갈리는 이유이기도
 * 하다: 그쪽은 저장할 수 없는 폼을 그려 주지 않으려는 것이고, 이쪽은 볼 수 있는
 * 것을 보여 주는 일이다.
 *
 * 지워진 장은 없는 것이다(getQuoteForEdit 이 is_deleted 로 좁힌다) — 휴지통에
 * 넣은 견적서를 주소만으로 계속 뽑을 수 있으면 휴지통이 뜻을 잃는다.
 *
 * ── 접수 건의 「견적서」 탭에서 들어온 경우 ──────────────────────────────
 * 주소에 그 건의 id 가 실려 온다(domain/quote-new-link.ts 의 quotePrintHref).
 * 그 id 가 **이 견적서가 붙은 건과 같을 때만** 「돌아가기」가 그 건을 실은 수정
 * 화면으로 간다 — 그래야 거기서 [취소]가 그 탭으로 돌아온다. 아니면 지금까지와
 * 같이 `/quotes/{id}` 다(판정은 수정 화면과 한 벌 — returnHrefForQuotePrint).
 */
export default async function QuotePrintPage({
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
        title="견적서 미리보기"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const { id } = await params;
  if (!isValidQuoteId(id)) notFound();

  const quote = await getQuoteForEdit(id);
  if (!quote) notFound();

  // 회사 정보·기본 문구·계좌는 **양식에서** 읽는다(코드에 두지 않는다).
  // 양식을 못 읽어도 미리보기는 떠야 한다 — 값만 빈 채로 그린다. 정본이
  // 필요하면 Excel 을 받으면 되고, 그쪽은 자기 오류를 따로 알려 준다.
  //
  // 🔴 **이 견적서에 맞는 양식**의 문구를 쓴다(장비 종류 × 견적서 종류).
  // 넷의 기본 문구가 다르고, 특히 납기가 전부 갈린다
  // (domain/quote-template-variant.ts).
  const templateKey = quoteTemplateKey(quote.laborEquipmentKind, quote.kind);

  /**
   * 작업 내역 세 묶음. **빈 묶음은 양식의 기본 목록으로 그린다** — 파일도 정확히
   * 그 규칙으로 나간다(xlsx/quote-sheet-layout.ts 의 '빈 묶음은 양식 그대로
   * 둔다'). 이 기능이 생기기 전에 저장된 견적서는 작업 내역이 전부 비어 있어서,
   * 규칙을 안 맞추면 화면에는 아무것도 없고 파일에는 표준 7줄이 적힌 서로 다른
   * 문서가 된다.
   */
  const [headers, workSections] = await Promise.all([
    readAllQuoteTemplateHeaders(),
    readQuoteWorkSections(templateKey, quote.workScopeLines),
  ]);
  const header = headers[templateKey];

  // 돌아갈 곳은 **읽어 온 견적서의 건과 맞춰 본 뒤에** 정한다 — 주소만 보고
  // 정하면 손으로 바꾼 링크가 사람을 남의 건으로 보낸다(수정 화면과 같은 판단).
  const backHref = returnHrefForQuotePrint(searchParams ? await searchParams : undefined, quote);

  return (
    <QuotePrintView
      quote={quote}
      header={header}
      workSections={workSections}
      quoteId={quote.id}
      backHref={backHref}
    />
  );
}
