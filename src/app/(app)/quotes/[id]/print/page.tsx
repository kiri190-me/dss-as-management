import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QuotePrintView from "@/components/quotes/QuotePrintView";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { getAuthSource } from "@/lib/config/auth-source";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { listQuoteAttachmentSlots } from "@/lib/db/queries/attachments";
import { excelOnlyPrintAttachments } from "@/components/quotes/quote-attachment-files";
import { isValidQuoteId } from "@/lib/validation/quote-input";
import { readAllQuoteTemplateHeaders, readQuoteWorkSections } from "@/lib/storage/quote-template";
import {
  QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE,
  canRenderQuoteDocument,
} from "@/lib/domain/quote-document-support";
import { quoteTemplateKey } from "@/lib/domain/quote-template-variant";
import { isRepairSectionDropped } from "@/lib/domain/quote-work-scope-suppression";
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
 * 단 [받기] 단추만은 권한으로 갈린다(2026-09-15 견적서 B1c) — 수정 권한자의 받기는 공유폴더에
 * 저장하고 엑셀 칸을 바꾸는 부작용이 있어 발행 통로(POST)이고, 보기 권한자는 지금까지의
 * 링크다(아래 canIssue).
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

  /**
   * 🔴 **앱 양식이 아직 없는 종류는 그리지 않는다** (2026-09-16 케이블 ③).
   *
   * 이 화면은 내자 · OH 양식의 모양을 그린다. 케이블 견적서를 그대로 그리면 **다른 종류의
   * 문서**가 화면에 뜨고, 그대로 인쇄 · PDF 로 나간다 — 편집 화면에서 단추를 감춰도 이 주소를
   * 직접 여는 길이 남아 여기서 막는다(받기 통로 둘과 **같은 판정**,
   * domain/quote-document-support.ts).
   *
   * 🔴 `notFound()` 로 보내지 않는다 — 그 장은 목록에 멀쩡히 있고 수정 화면도 열린다.
   * 「없다」고 하면 사람은 자기가 지운 줄 안다. 까닭과 다음 차례를 글자로 말한다.
   * (엑셀 전용 장은 앱 양식 대신 결재 PDF 를 보이므로 종류와 무관하게 지나간다.)
   */
  if (!canRenderQuoteDocument(quote)) {
    return <PlaceholderPage title="견적서 미리보기" description={QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE} />;
  }

  /**
   * [견적서 받기]는 두 갈래다(2026-09-15 견적서 B1c). 🔴 이 화면은 보기 권한만 있어도 열리므로
   * 여기서 가른다 — 수정 권한자(quotes WRITE)에게만 발행 단추(POST /api/quotes/{id}/issue:
   * 공유폴더 저장 · 엑셀 칸 교체)를 주고, 나머지는 지금까지의 링크(GET …/xlsx)다. 목록
   * 화면(quotes/page.tsx)의 canEdit 과 같은 계산이다. 화면을 그리기 위한 값일 뿐 관문이
   * 아니다 — 발행 통로가 세션 · 권한을 스스로 다시 본다.
   */
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canIssue = actingUser !== null && (await hasPermission(actingUser, "quotes", "WRITE"));

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
  const [headers, workSections, excelOnlySlots] = await Promise.all([
    readAllQuoteTemplateHeaders(),
    readQuoteWorkSections(templateKey, quote.workScopeLines),
    // 엑셀 전용 장만 파일 칸을 읽는다 — 앱 양식 대신 결재 PDF 를 보이기 때문이다
    // (QuotePrintView 의 엑셀 전용 갈래). 일반 견적서는 조회 하나 늘지 않고 지금 그대로다.
    quote.isExcelOnly ? listQuoteAttachmentSlots(quote.id) : Promise.resolve(null),
  ]);
  const header = headers[templateKey];
  const excelOnly = excelOnlySlots ? excelOnlyPrintAttachments(excelOnlySlots) : null;

  // 돌아갈 곳은 **읽어 온 견적서의 건과 맞춰 본 뒤에** 정한다 — 주소만 보고
  // 정하면 손으로 바꾼 링크가 사람을 남의 건으로 보낸다(수정 화면과 같은 판단).
  const backHref = returnHrefForQuotePrint(searchParams ? await searchParams : undefined, quote);

  // 제너레이터에서 수리 작업을 하나도 고르지 않았으면 「② 수리 작업」을 그리지
  // 않는다 — xlsx 라우트가 같은 함수로 그 구역을 지운다(둘이 같은 종이여야 한다).
  const repairSectionDropped = isRepairSectionDropped({
    equipmentKind: quote.laborEquipmentKind,
    chosenRepairTaskCount: quote.repairTasks.length,
  });

  /**
   * 🔴 `...quote` 가 **종류 · 특이사항 · 품목 표 전체(itemLines)** 까지 함께 싣는다 —
   * 케이블 견적서를 케이블 양식의 모양으로 그리는 데 쓰이는 셋이다(QuotePrintData 의 그
   * 항목, 2026-09-17 케이블 ④). 넘기는 값을 손으로 골라 적기 시작하면 그날 그 셋이 빠진다.
   */
  return (
    <QuotePrintView
      quote={{ ...quote, repairSectionDropped }}
      header={header}
      workSections={workSections}
      quoteId={quote.id}
      backHref={backHref}
      signedPdf={excelOnly?.signedPdf ?? null}
      hasExcel={excelOnly?.hasExcel}
      canIssue={canIssue}
    />
  );
}
