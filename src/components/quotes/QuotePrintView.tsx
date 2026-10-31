"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PrintFitFrame from "@/components/common/print-fit-frame";
import {
  PX_PER_MM,
  SheetPrintGridView,
  planPaper,
  type PaperPlan,
} from "@/components/print-grid/SheetPrintGridView";
import {
  QUOTE_EXCEL_PREVIEW_TEXT,
  excelOnlyPreviewLayout,
  fetchQuoteExcelPreview,
  quoteExcelPreviewStateOf,
  shouldFetchQuoteExcelPreview,
  type ExcelOnlyPreviewView,
  type QuoteExcelPreviewGrid,
  type QuoteExcelPreviewOutcome,
  type QuoteExcelPreviewState,
} from "@/components/quotes/quote-print-excel-preview";
import { quoteSupplyAmountOf } from "@/lib/domain/quote-list";
/* 🔴 **어느 양식으로 나가는 장인가**를 서버와 **같은 함수**로 고른다 — 금액 칸의 구성이
   양식마다 다르기 때문이다(아래 buildCostGroups 머리말의 실측). 여기서 따로 셈하면
   「장비 종류가 매쳐면…」 같은 규칙이 두 벌이 되고, 한쪽만 고쳐지는 날 화면과 받아 본
   문서의 칸이 갈린다(server/services/quote-workbook.ts 도 이 함수로 고른다). */
import { quoteTemplateKey, type QuoteTemplateKey } from "@/lib/domain/quote-template-variant";
import {
  EXCEL_ONLY_NO_SIGNED_PDF_TEXT,
  quoteAttachmentDownloadUrl,
  quoteAttachmentViewUrl,
  type QuotePrintSignedPdf,
} from "@/components/quotes/quote-attachment-files";
import type { QuoteEditData, QuotePrintableItemLine } from "@/lib/db/queries/quotes";
import type { QuoteTemplateHeader } from "@/lib/storage/quote-template";

/**
 * ============================================================================
 * 견적서 미리보기 · PDF — 실제 발행본과 같은 모양
 * ============================================================================
 * **JS PDF 라이브러리를 쓰지 않는다.** `window.print()` 와 `@media print` 로
 * 만든다 — 브라우저의 "PDF 로 저장"이 곧 내려받기다.
 *
 * ── 사용자가 준 실제 발행본을 보고 맞췄다 ───────────────────────────────
 * 앞선 두 판은 비슷하게 생긴 표를 새로 그린 것이었다. 실제로 나가는 PDF 는
 * 이렇게 생겼다:
 *
 *   · 제목 `견 적 서` 는 **왼쪽**, 로고는 **오른쪽 위**.
 *   · 회사 정보 블록 아래에 **굵은 가로선**, 그 위에도 한 줄.
 *   · 상단 정보는 `1.` ~ `9.` 번호 + 라벨 + 값. **9번이 은행계좌**다.
 *   · 품목 표 머리(번호/품명/수량/단가/합계)는 위아래 굵은 선 사이.
 *   · 아래 합계 셋은 상자가 아니라 **굵은 선 사이 오른쪽**에 라벨과 값.
 *   · 본문 글꼴은 명조 계열.
 *
 * ── 치수는 원본 xlsx 실측이다 ───────────────────────────────────────────
 *   · 열 A~I: 4.25 / 8.25 / 1.5 / 15.125 / 8.25 / 17.875 / 7.125 / 13.75 / 15.25
 *     (Excel 문자 단위 → px = width×7+5 → pt). 합 513.5pt = 181.1mm.
 *   · 인쇄 배율 92%, A4 세로, 여백 좌우 10mm · 위아래 15mm (pageSetup/pageMargins).
 *
 * 배율은 CSS transform 이 아니라 **수치에 미리 곱해 둔다**(SCALE) — transform 은
 * 인쇄에서 브라우저마다 다르게 처리돼 자리가 틀어진다.
 *
 * 행 높이는 고정하지 않는다. 원본은 55행짜리 격자에 맞춰 두었지만, 부품 품명이
 * 길면 줄바꿈돼야 하고 그때 칸을 고정해 두면 글자가 잘린다. 세로 자리는 각
 * 구역의 여백으로 맞춘다.
 *
 * ── 회사 정보와 계좌는 양식에서 읽어 온다 ───────────────────────────────
 * 코드에 베껴 적지 않는다. **계좌번호를 코드에도 DB 에도 두지 않는다는 규칙을
 * 지키면서** 정본과 같은 값을 보여 주는 유일한 방법이고, 상호·주소가 바뀌면
 * 양식만 고치면 따라온다(storage/quote-template.ts 의 readQuoteTemplateHeader).
 *
 * 로고와 직인도 같은 이유로 양식에서 꺼낸다(api/quotes/template-image).
 *
 * ── 작업 내역도 코드에 박지 않는다 ──────────────────────────────────────
 * 예전에는 ①②③④ 의 문구가 이 파일의 상수 하나에 박혀 있었고, **양식 넷 모두에
 * 똑같이** 그려졌다(매쳐 견적서 미리보기에도 제너레이터 문구가 나갔다). 이제
 * 실제 작업 내역을 받아 그린다 — 빈 묶음이면 그 양식의 기본 목록이다. 파일이
 * 정확히 그 규칙으로 나가고, 둘이 다르면 받아 본 쪽이 다른 문서라고 여긴다.
 * ============================================================================
 */

const SCALE = 0.92;

/** Excel 문자 단위 → pt. px = width×7+5, pt = px×0.75. */
function colPt(chars: number): number {
  return (chars * 7 + 5) * 0.75 * SCALE;
}

const COLUMNS = [4.25, 8.25, 1.5, 15.125, 8.25, 17.875, 7.125, 13.75, 15.25];
const SHEET_WIDTH_PT = COLUMNS.reduce((sum, chars) => sum + colPt(chars), 0);

/**
 * `.qp-page` 의 실물 폭(px) — 좁은 화면에서 얼마나 줄일지 재는 데만 쓴다
 * (`components/common/print-fit-frame.tsx`).
 *
 * 종이 = 시트 + 좌우 안쪽 여백 10pt 씩 + 테두리 1px 씩. 아래 STYLES 의
 * `.qp-page { padding: 15pt 10pt; border: 1px … }` 와 **짝이다** — 그 값을 고치면
 * 여기도 같이 고쳐야 한다. CSS 의 1in = 96px, 1pt = 96/72px.
 */
const PAGE_NATURAL_WIDTH_PX = (SHEET_WIDTH_PT + 20) * (96 / 72) + 2;

const AMOUNT = new Intl.NumberFormat("ko-KR");
const VAT_RATE = 0.1;

function won(value: number): string {
  return `₩${AMOUNT.format(Math.round(value))}`;
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

/**
 * 미리보기가 실제로 읽는 값만.
 *
 * 🔴 **`id` 와 `version` 을 요구하지 않는다.** 아직 저장하지 않은 견적서도 이
 * 화면으로 그려야 하기 때문이다 — 저장하기 전에 어떻게 나갈지 보고 싶은 것이
 * 미리보기의 본래 쓸모다. id 가 있어야만 볼 수 있게 두면, 새로 만드는 사람은
 * 일단 저장해 놓고 열어 본 뒤 다시 고치는 길밖에 없다.
 */
export type QuotePrintData = Pick<
  QuoteEditData,
  | "quoteNumber"
  | "quoteDate"
  | "customerNameText"
  | "subject"
  | "validity"
  | "delivery"
  | "payment"
  | "modelNameText"
  | "serialNumberText"
  | "lotNumberText"
  | "workCost"
  | "items"
> & {
  /**
   * ==========================================================================
   * 🔴 어느 양식으로 나가는 장인가 — **장비 종류** (2026-10-31)
   * ==========================================================================
   * 양식은 장비 종류 × 견적서 종류로 갈린다(domain/quote-template-variant.ts 의
   * `quoteTemplateKey`). 미리보기가 이 값을 알아야 하는 까닭은 **양식마다 금액 칸의
   * 구성이 다르기** 때문이다 — `2) OH 부품 비용` 칸은 제너레이터 O/H 양식에만 있고,
   * 매쳐 양식 둘은 O/H 장도 부품이 한 목록이다(아래 buildCostGroups 머리말의 실측).
   *
   * 🔴 **선택 칸이 아니다.** 아래 `kind`·`powerTestExcluded` 처럼 「안 주면 예전
   * 그대로」로 두면 넘기는 자리를 하나 빠뜨린 날 **매쳐 견적서가 조용히 제너레이터
   * 모양으로** 그려진다 — 오류가 나지 않고 화면에만 있는 칸이 하나 생길 뿐이라 그
   * 양식을 쓰는 사람이 말해 주기 전에는 아무도 모른다. 넘기는 자리는 둘뿐이고
   * (`/quotes/{id}/print` 페이지 · QuoteEditForm 의 겹친 미리보기) 둘 다 이 값을 이미
   * 들고 있다 — 빠뜨리면 컴파일이 막는 쪽이 싸다.
   *
   * 🔵 `null` 은 「장비 종류를 아직 안 골랐다」는 실제 값이고 제너레이터로 읽힌다
   * (그 함수의 머리말). 모른다는 뜻으로 지어내 넣는 값이 아니다.
   */
  laborEquipmentKind: QuoteEditData["laborEquipmentKind"];
  /**
   * 통전작업을 빼고 청구하는 장인가. 켜면 **「③ 통전검사」 묶음을 그리지
   * 않고, 그 아래 서류작업이 ③ 이 된다** — 실제로 나가는 xlsx 가 그 구역을
   * 머리글까지 지우고 번호를 함께 당기기 때문이다(xlsx/quote-template.ts 의
   * `powerTestExcluded`). 둘이 다르면 미리보기와 받아 본 문서가 서로 다른
   * 종이가 된다.
   *
   * 🔴 **없으면 예전 그대로 그린다.** 이 기능이 생기기 전에 저장된 견적서는
   * 전부 꺼짐이고, 그 장들은 한 줄도 달라지지 않아야 한다.
   */
  powerTestExcluded?: boolean;
  /**
   * 「② 수리 작업」을 그리지 않는가 — 제너레이터에서 수리 작업을 하나도 고르지
   * 않은 장이다(domain/quote-work-scope-suppression.ts 의 isRepairSectionDropped,
   * 2026-09-15). 켜면 그 아래 통전검사가 ②, 서류작업이 ③ 이 된다 — xlsx 가 같은
   * 규칙으로 구역을 지우고 번호를 당긴다.
   *
   * 🔴 **없으면 예전 그대로 그린다.**
   */
  repairSectionDropped?: boolean;
  /**
   * 「① 인수 조사」를 그리지 않는가 — 사람이 조사 칸을 손대서 비운 채 저장한 장이다
   * (quotes.investigation_excluded, 2026-09-15). 켜면 그 아래 번호가 전부 하나씩
   * 당겨진다 — xlsx 가 같은 규칙으로 구역을 지우고 번호를 당긴다.
   *
   * 🔴 **없으면 예전 그대로 그린다.** 빈 조사 칸만으로는 빠지지 않는다(옛 견적서).
   */
  investigationExcluded?: boolean;
  /**
   * 엑셀 전용 견적서인가 · 손으로 적은 공급가액(2026-09-15 Q3). 켜져 있으면 **앱 양식을
   * 그리지 않고 붙인 수기 엑셀의 인쇄 모양을 보인다**(아래 ExcelOnlyQuotePreview — 2026-09-16
   * 견적서 ②b, 결재 PDF 는 [결재 PDF 보기]로) — 그 장의 문서는 손으로 만든 엑셀이고, 앱
   * 양식으로 그리면 품목 없는 빈 견적서가 된다.
   *
   * 🔴 **없으면 예전 그대로 그린다**(일반 견적서).
   */
  isExcelOnly?: boolean;
  manualSupplyAmount?: string | null;
  /**
   * ==========================================================================
   * 🔴 케이블 견적서를 그리는 데 쓰는 셋 (2026-09-17 케이블 ④)
   * ==========================================================================
   * 견적서 종류가 `CABLE` 이면 **앱 양식을 그리지 않고 케이블 양식의 모양**을 그린다
   * (아래 CableQuotePreview) — 그 종이에는 작업 범위 · 작업비 구역이 아예 없고, 대신
   * 규격 칸 · 설명 줄 · 특이사항이 있다(xlsx/cable-quote-template.ts 머리말).
   *
   * 🔴 **셋 다 없어도 된다** — 안 주면 지금까지와 똑같이 내자 · OH 모양을 그린다.
   * 필수로 두면 이 타입으로 값을 짓는 자리(편집 폼 · 형제 시험들)가 전부 함께 고쳐져야
   * 하고, 그 자리들은 케이블과 아무 상관이 없다.
   *
   * 🔴 `items` 가 아니라 `itemLines` 다. `items` 에는 **설명 줄이 빠져 있고 규격도
   * 없다**(queries/quotes.ts 의 두 목록) — 그것으로 그리면 미리보기에서 설명 줄이 사라져
   * 받아 본 문서와 다른 종이가 된다.
   */
  kind?: QuoteEditData["kind"];
  /** 특이사항 — 케이블 양식 머리말 10번(quotes.remarks). 다른 두 양식에는 이 칸이 없다. */
  remarks?: string | null;
  /**
   * 품목 표 **전체** — 설명 줄까지, 적힌 차례 그대로.
   *
   * 🔴 **조회가 고치는 화면에 주는 줄보다 좁은 형이다**(2026-10-16). 그 줄에는 작성자만
   * 보는 칸이 하나 더 붙어 있는데(db/queries/quotes.ts 의 QuoteEditItemLine), 이 종이는
   * 고객사로 나간다 — 받는 형에서 아예 빼 두면 **여기서 읽을 수가 없어** 옮겨 적는 실수가
   * 컴파일에서 막힌다. 넘기는 쪽이 그 칸을 들고 와도 그릴 자리가 없다.
   */
  itemLines?: QuotePrintableItemLine[];
};

function productLine(quote: QuotePrintData): string {
  const pieces: string[] = [];
  if (quote.modelNameText?.trim()) pieces.push(`MODEL: ${quote.modelNameText.trim()}`);
  if (quote.serialNumberText?.trim()) pieces.push(`S/N:${quote.serialNumberText.trim()}`);
  if (quote.lotNumberText?.trim()) pieces.push(`L/N:${quote.lotNumberText.trim()}`);
  return pieces.join(", ");
}

export default function QuotePrintView({
  quote,
  header,
  workSections,
  quoteId,
  onClose,
  backHref,
  signedPdf = null,
  hasExcel,
}: {
  quote: QuotePrintData;
  /** 양식에서 읽어 온 회사 정보·기본 문구·계좌. 못 읽은 칸은 null 이고 그 줄은 비운다. */
  header: QuoteTemplateHeader;
  /**
   * 작업 내역 세 묶음 — 머리글과 그 아래 줄들.
   *
   * 🔴 **부르는 쪽이 이미 정리해서 준다**: 견적서에 적어 둔 줄이 있으면 그것,
   * 빈 묶음이면 **양식의 기본 목록**(storage/quote-template.ts 의
   * readQuoteWorkSections). 파일이 정확히 그 규칙으로 나가기 때문이다 — 둘이
   * 다르면 받아 본 쪽이 다른 문서라고 여긴다.
   *
   * 안 주면 제너레이터 내자 양식의 문구를 그린다(예전 그대로).
   */
  workSections?: QuoteWorkSections;
  /**
   * 저장된 견적서면 그 id, **아직 저장하지 않았으면 null**.
   *
   * 🔴 **받기가 없어진 뒤로 앱 양식 갈래에서는 돌아가는 주소에만 쓰인다**(2026-10-06).
   * 엑셀 전용 갈래는 이 값으로 붙인 엑셀의 격자를 받아 온다(저장된 장에만 있다).
   *
   * 🔴 **돌아가는 길은 이 값으로 갈리지 않는다**(아래 onClose). 저장된 견적서를
   * 고치는 중에도 미리보기는 폼 위에 겹쳐 뜨므로, 저장 여부로 가르면 지금 있는
   * 자리로 가라는 링크가 그려져 단추가 죽는다.
   */
  quoteId: string | null;
  /**
   * 겹쳐 뜬 미리보기를 닫고 폼으로 돌아간다 — **이 값을 받았는가가 곧 "어떻게
   * 열렸는가"**다. QuoteEditForm 은 주고(저장 여부와 무관하게), 독립 페이지
   * `/quotes/{id}/print` 는 주지 않는다.
   */
  onClose?: () => void;
  /**
   * 독립 페이지의 「← 견적서로 돌아가기」가 갈 주소. **`onClose` 가 없을 때만 쓰인다**
   * — 겹쳐 뜬 미리보기는 닫기 단추라 주소가 없다.
   *
   * 인쇄 페이지가 주소의 건 id 를 그 견적서의 건과 맞춰 본 뒤 정해 준다
   * (domain/quote-new-link.ts 의 returnHrefForQuotePrint): 「견적서」 탭에서 왔으면
   * 그 건을 실은 수정 화면, 아니면 `/quotes/{id}`. 안 주면 `/quotes/{quoteId}`
   * (예전 그대로).
   */
  backHref?: string;
  /**
   * 엑셀 전용 견적서의 결재 PDF — 올라가 있는 것, 또는 새 견적서가 들고 있는 것. 없으면 null.
   * **일반 견적서는 쓰지 않는다.**
   */
  signedPdf?: QuotePrintSignedPdf | null;
  /**
   * 엑셀 전용 견적서에 수기 엑셀이 붙어 있는가. 안 주면 따로 알리지 않는다. **거짓이면** 엑셀
   * 모양을 받으러 가지 않고 곧바로 「엑셀 없음」을 보인다(2026-09-16 견적서 ②b).
   */
  hasExcel?: boolean;
}) {
  // 엑셀 전용 장은 앱 양식 대신 결재 PDF 를 보인다. 일반 견적서는 아래 그대로다.
  if (quote.isExcelOnly === true) {
    return (
      <ExcelOnlyQuotePreview
        quote={quote}
        quoteId={quoteId}
        onClose={onClose}
        backHref={backHref}
        signedPdf={signedPdf}
        hasExcel={hasExcel}
      />
    );
  }

  /**
   * ==========================================================================
   * 도구모음과 인쇄 안내 — **종이가 무엇이든 하나다** (2026-09-17 케이블 ④)
   * ==========================================================================
   * 요소로 한 번 만들어 두 갈래(내자 · OH 종이, 케이블 종이)가 나눠 끼운다. 🔴 **컴포넌트로
   * 빼지 않은 것은 일부러다** — 베껴 두면 그리는 자리가 하나 더 생기는 날 한쪽만 고치게 된다
   * (받기 링크가 있던 시절에 저장 전 · 후 갈래가 어긋나던 그 까닭이다).
   *
   * 값이 아니라 **요소**라 요소 나무의 모양이 예전과 같다 — 시험이 나무를 걸어 단추를
   * 찾는다(QuotePrintView.test.tsx).
   */
  const toolbar = (
    <div className="qp-toolbar">
      {onClose ? (
        // 🔴 갈리는 기준은 **저장 여부가 아니라 어떻게 열렸나**다. `onClose` 를
        // 받았다는 것은 폼 위에 겹쳐 뜬 미리보기라는 뜻이고, 그때 주소는
        // `/quotes/{id}`(또는 `/quotes/new`) **그대로**다. 저장됐다는 이유로
        // `/quotes/{id}` 링크를 그리면 지금 있는 자리로 가라는 말이라, 눌러도
        // 주소가 안 바뀌고 미리보기가 그대로 떠 있다 — 죽은 단추가 된다.
        // 닫아서 폼으로 돌아가면 적어 둔 값도 그대로 살아 있다.
        <button type="button" onClick={onClose} className="qp-btn">
          ← 편집으로 돌아가기
        </button>
      ) : (
        // 독립된 미리보기 페이지(`/quotes/{id}/print`)다. 닫을 폼이 없으므로
        // 돌아갈 곳은 주소로만 있다 — 페이지가 정해 준 `backHref`(「견적서」
        // 탭에서 왔으면 그 건을 실은 수정 화면), 없으면 `/quotes/{id}`.
        <Link href={backHref ?? `/quotes/${quoteId}`} className="qp-btn">
          ← 견적서로 돌아가기
        </Link>
      )}
      {/* 🔴 [Excel 받기]는 2026-10-06 에 없앴다 — 브라우저로 내려받는 길을 화면에서 모두
          걷어냈다(사용자 결정). 견적서 엑셀은 [저장]이 사내 공유폴더에 넣는다(server/actions/
          quotes.ts). 남은 것은 인쇄뿐이고, 저장 여부로 갈릴 일도 없어졌다. */}
      <div className="qp-toolbar-actions">
        <button type="button" onClick={() => window.print()} className="qp-btn qp-btn-primary">
          인쇄 · PDF로 저장
        </button>
      </div>
    </div>
  );

  const printNote = (
    <p className="qp-note">
      인쇄 창에서 대상 <b>&ldquo;PDF로 저장&rdquo;</b>, 용지 <b>A4</b>, 배율 <b>기본(100%)</b>,
      여백 <b>기본</b>으로 두세요. 배율 92%는 이미 반영되어 있으니 인쇄 창에서 또 줄이지 마세요.
      머리글·바닥글(주소·날짜)은 인쇄 창의 <b>&ldquo;머리글 및 바닥글&rdquo;</b> 체크를 해제하면
      사라집니다.
    </p>
  );

  /**
   * 🔴 케이블 견적서는 **다른 종이**다 — 작업 범위 · 작업비 구역이 없고 규격 칸 · 설명
   * 줄 · 특이사항이 있다. 아래 내자 · OH 모양으로 그리면 화면과 받아 본 문서가 서로
   * 다른 문서가 된다(xlsx/cable-quote-template.ts 머리말).
   */
  if (quote.kind === "CABLE") {
    return (
      <div className="qp-root">
        <style>{STYLES}</style>
        {toolbar}
        {printNote}
        <CableQuoteSheet quote={quote} header={header} />
      </div>
    );
  }

  /**
   * ==========================================================================
   * 🔴 이 장이 쓰는 **양식** — 어떤 묶음을 그릴지가 여기서 갈린다 (2026-10-31)
   * ==========================================================================
   * 서버가 파일을 만들 때 양식을 고르는 **그 함수 하나**로 고른다 — 「장비 종류가 매쳐면…」
   * 을 여기 다시 적으면 규칙이 두 벌이 되고, 한쪽만 고쳐지는 날 화면과 받아 본 문서가 서로
   * 다른 종이가 된다(server/services/quote-workbook.ts 의 같은 호출).
   *
   * 종류를 안 넘긴 옛 길은 내자로 읽어 지금까지와 똑같이 그린다. 케이블은 위에서 이미 갈라
   * 나갔으므로 여기 오는 것은 제너레이터 둘 · 매쳐 둘뿐이다.
   */
  const shape = quoteSheetShapeOf(quoteTemplateKey(quote.laborEquipmentKind, quote.kind ?? "DOMESTIC"));

  /**
   * 부품은 **있는 그대로** 적는다.
   *
   * 예전에는 다섯 줄이 넘으면 「부품 비용 일괄」 한 줄로 합쳤다. 양식의 부품 칸이
   * 다섯 줄로 고정이라 파일이 그렇게밖에 못 나갔기 때문이고, 미리보기도 파일과
   * 같아 보여야 해서 같은 규칙을 따랐다. 이제 파일이 담을 만큼 줄을 늘리므로
   * (xlsx/quote-sheet-layout.ts) 여기서도 합치지 않는다 — 합치면 미리보기에
   * 한 줄로 보이는데 파일에는 전부 적혀 나가서, 둘이 다른 문서가 된다.
   *
   * 🔴 **제너레이터 O/H 양식에서만 두 목록으로 갈린다.** 가르는 자도 나누는 기준도 파일
   * 쪽과 한 벌이다 — `isOverhaulPart` 가 붙은 줄은 `2) OH 부품 비용` 칸으로 가고 나머지는
   * `1) 부품 비용` 으로 간다(server/services/quote-workbook.ts 의 `parts` · `overhaulParts`).
   * 내자 · 케이블 · **매쳐 둘**은 갈리지 않아 지금까지와 한 줄도 달라지지 않는다 — 매쳐
   * 양식에는 그 칸이 없어 파일 쪽이 두 목록을 도로 합쳐 넘긴다(아래 양식 모양 표).
   */
  const printed = quote.items
    .filter((item) => !(shape.hasOverhaulPartsBox && item.isOverhaulPart))
    .map(printedPartOf);
  const printedOverhaul = shape.hasOverhaulPartsBox
    ? quote.items.filter((item) => item.isOverhaulPart).map(printedPartOf)
    : [];

  // 서버가 금액을 셈하는 그 함수 하나로(domain/quote-list.ts 의 quoteSupplyAmountOf). 엑셀
  // 전용 장은 위에서 갈라 나갔으므로 여기서는 부품 줄 합 + 작업비이고, null 은 오지 않는다.
  const supply =
    quoteSupplyAmountOf({
      isExcelOnly: false,
      manualSupplyAmount: null,
      items: quote.items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice })),
      workCost: quote.workCost,
    }) ?? 0;
  const vat = supply * VAT_RATE;
  const workCost = Number(quote.workCost);

  const infoRows: [string, string][] = [
    ["발행일자", formatDate(quote.quoteDate)],
    ["발행번호", quote.quoteNumber],
    ["공 급 처", quote.customerNameText],
    ["품     명", quote.subject],
    ["금     액", `${won(supply)}　(V.A.T. 별도)`],
    ["유효기간", quote.validity ?? header.defaultValidity ?? ""],
    ["납     기", quote.delivery ?? header.defaultDelivery ?? ""],
    ["결재조건", quote.payment ?? header.defaultPayment ?? ""],
    ["은행계좌", header.bankAccount ?? ""],
  ];

  return (
    <div className="qp-root">
      <style>{STYLES}</style>

      {toolbar}
      {printNote}

      {/* 좁은 화면에서 종이를 폭에 맞춰 줄여 «보여 주는» 상자. 인쇄에는 닿지
          않는다 — `print-fit-frame.tsx` 머리말과 아래 STYLES 의 `@media screen`. */}
      <PrintFitFrame
        naturalWidthPx={PAGE_NATURAL_WIDTH_PX}
        cssVariable="--qp-fit"
        className="qp-viewport"
      >
        <div className="qp-page">
          <div className="qp-sheet" style={{ width: `${SHEET_WIDTH_PT}pt` }}>
            <header className="qp-top">
              <h1 className="qp-title">견 적 서</h1>
              {/* next/image 를 쓰지 않는다: 인쇄 화면이라 지연 로딩이 오히려
                  방해가 되고(아직 안 뜬 그림이 빈칸으로 나간다), 인증이 걸린 API
                  라우트에서 온다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="qp-logo" src="/api/quotes/template-image/logo" alt="" />
            </header>

            <section className="qp-company">
              <p className="qp-company-name">{header.companyName ?? ""}</p>
              <p className="qp-ceo">
                <span className="qp-ceo-text">{header.ceoLine ?? ""}</span>
                {/* 직인 — drawing1.xml 앵커가 대표자 이름 끝에 겹치도록 되어 있다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qp-seal" src="/api/quotes/template-image/seal" alt="" />
              </p>
              <p>{header.address ?? ""}</p>
              <p>
                <span className="qp-col1">{header.tel ?? ""}</span>
                <span>{header.fax ?? ""}</span>
              </p>
              <p>
                <span className="qp-col1">{header.email ?? ""}</span>
                <span>{header.homepage ?? ""}</span>
              </p>
            </section>

            <div className="qp-rule-thick" />

            <dl className="qp-info">
              {infoRows.map(([label, value], index) => (
                <div className="qp-info-row" key={label}>
                  <dt>
                    <span className="qp-info-n">{index + 1}.</span>
                    <span className="qp-info-label">{label}</span>
                    <span className="qp-info-colon">:</span>
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            <table className="qp-items">
              <colgroup>
                {COLUMNS.map((chars, index) => (
                  <col key={index} style={{ width: `${colPt(chars)}pt` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th colSpan={2}>번 호</th>
                  <th colSpan={4}>품 명</th>
                  <th>수 량</th>
                  <th>단 가</th>
                  <th>합 계</th>
                </tr>
              </thead>
              <tbody>
                <tr className="qp-spacer-row">
                  <td colSpan={9} />
                </tr>
                <tr>
                  {/* 🔴 품명 줄 앞의 번호는 **제너레이터 양식에만** 있다(매쳐는 B열이 비어
                      있다 — 아래 양식 모양 표의 `subjectMark`). 칸 자체는 양쪽 다 둔다 —
                      없애면 그 아래 줄들과 열이 어긋난다. */}
                  <td className="qp-c-no" colSpan={2}>
                    {shape.subjectMark}
                  </td>
                  <td className="qp-c-title" colSpan={7}>
                    {quote.subject}
                  </td>
                </tr>
                {shape.showProductLine && productLine(quote) && (
                  <tr>
                    <td colSpan={2} />
                    <td className="qp-c-model" colSpan={7}>
                      {productLine(quote)}
                    </td>
                  </tr>
                )}

                {buildCostGroups({
                  shape,
                  parts: printed,
                  overhaulParts: printedOverhaul,
                  workCost,
                }).map((group) => (
                  <CostGroupRows key={group.mark} group={group} />
                ))}

                {buildWorkSections(
                  workSections,
                  {
                    investigation: quote.investigationExcluded === true,
                    repair: quote.repairSectionDropped === true,
                    powerTest: quote.powerTestExcluded === true,
                  },
                  shape
                ).map((section) => (
                  <SectionRows key={section.mark} section={section} />
                ))}
              </tbody>
            </table>

            <div className="qp-rule-thick qp-rule-totals" />
            <div className="qp-totals">
              <div className="qp-total-row">
                <span className="qp-total-label">공 급 가</span>
                <span className="qp-total-value">{won(supply)}</span>
              </div>
              <div className="qp-total-row">
                <span className="qp-total-label">부 가 세</span>
                <span className="qp-total-value">{won(vat)}</span>
              </div>
              <div className="qp-total-row qp-total-grand">
                <span className="qp-total-label">합　　계</span>
                <span className="qp-total-value">{won(supply + vat)}</span>
              </div>
            </div>
            <div className="qp-rule-thick" />
          </div>
        </div>
      </PrintFitFrame>
    </div>
  );
}

/**
 * ============================================================================
 * 케이블 견적서의 미리보기 — 품목 표 하나와 특이사항 (2026-09-17 케이블 ④)
 * ============================================================================
 * 케이블 견적서는 **수리품과 이어지지 않는 별도 견적서**라 위 내자 · OH 모양과 갈리는
 * 곳이 넷이다(xlsx/cable-quote-template.ts 머리말):
 *
 *   · 🔴 **작업 범위 · 작업비 구역이 없다.** 「① 인수 조사 … ④ 서류작업」도, 「2) 작업비」
 *     줄도 그리지 않는다 — 그 양식에 그 자리가 아예 없다. 여기에 그리면 화면에는 있는데
 *     받아 본 문서에는 없는, 서로 다른 종이가 된다.
 *   · **규격 칸**이 있다(표의 셋째 칸).
 *   · **설명 줄**이 품목 사이에 낀다 — 번호 · 수량 · 단가 없이 글만 앉고, **차례가 곧
 *     뜻**이라 품목과 섞인 그 자리에 그린다.
 *   · **특이사항**이 머리말 맨 아래(10번)에 붙는다. 양식에서도 C21 — 품목 표 **위**다.
 *
 * ── 🔴 엑셀 격자를 그리지 않는다 ────────────────────────────────────────────
 * 저장된 값으로 직접 셈해 그린다 — 위 내자 · OH 와 같은 길이다(사용자 결정). 양식 파일을
 * 열지 않으므로 수식 칸의 낡은 캐시값(C16 · H44~H46)이 화면에 새어 나올 일이 없다.
 *
 * ── 로고 · 직인은 그리지 않는다 ─────────────────────────────────────────────
 * 그림을 내주는 통로(/api/quotes/template-image)가 **내자 양식**에서 꺼낸다. 케이블 양식은
 * 다른 파일이라, 그대로 붙이면 이 종이에 없을 수도 있는 그림을 지어내는 셈이다. 회사
 * 정보 글자는 케이블 양식에서 읽은 것이라 그대로 그린다(storage/quote-template.ts 의
 * CABLE_HEADER_CELLS).
 *
 * 🔴 **종이만 그린다** — 도구모음과 인쇄 안내는 위 QuotePrintView 가 만들어 둔 것을 그대로
 * 쓴다(그 자리의 머리말). 여기에 베껴 두면 권한 갈래를 한쪽만 고치는 날이 온다.
 * ============================================================================
 */
function CableQuoteSheet({ quote, header }: { quote: QuotePrintData; header: QuoteTemplateHeader }) {
  const lines = quote.itemLines ?? [];

  /**
   * 🔴 합계는 **서버가 금액을 셈하는 그 함수 하나**로 낸다(domain/quote-list.ts 의
   * quoteSupplyAmountOf — 목록 · 내자 정리 · 스냅숏이 모두 그것을 부른다). 설명 줄을 빼는
   * 일은 그 함수가 일반 견적서의 셈을 맡기는 안쪽 한 곳에서 일어난다. 여기서 따로 더하면
   * 설명 줄이 「0원짜리 품목」으로 섞이는 날 목록 · 편집 화면과 이 종이의 금액이 갈린다.
   *
   * 엑셀 전용 장은 위에서 갈라 나갔으므로 여기서는 품목 줄 합 + 작업비이고(케이블 장의
   * 작업비는 늘 0 이다), null 은 오지 않는다 — 내자 · OH 갈래와 같은 모양이다.
   */
  const supply =
    quoteSupplyAmountOf({
      isExcelOnly: false,
      manualSupplyAmount: null,
      items: lines,
      workCost: quote.workCost,
    }) ?? 0;
  const vat = supply * VAT_RATE;

  /**
   * 머리말 열 줄 — 양식에 박힌 이름 그대로다(실측). 🔴 열째가 **특이사항**이고, 양식에서도
   * 품목 표 위(C21)에 있다. 유효기간 · 납기 · 결재조건 · 은행계좌는 케이블 양식에서 읽은
   * 기본 문구로 채운다(print 페이지가 `quoteTemplateKey` 로 골라 넘긴다).
   */
  const infoRows: { label: string; value: string; pre?: boolean }[] = [
    { label: "발행일자", value: formatDate(quote.quoteDate) },
    { label: "발행번호", value: quote.quoteNumber },
    { label: "공 급 처", value: quote.customerNameText },
    { label: "품     명", value: quote.subject },
    { label: "금     액", value: `${won(supply)}　(V.A.T. 별도)` },
    { label: "유효기간", value: quote.validity ?? header.defaultValidity ?? "" },
    { label: "납     기", value: quote.delivery ?? header.defaultDelivery ?? "" },
    { label: "결재조건", value: quote.payment ?? header.defaultPayment ?? "" },
    { label: "은행계좌", value: header.bankAccount ?? "" },
    // 여러 줄로 적을 수 있는 칸이다 — 적은 줄바꿈 그대로 그린다(.qp-info-pre).
    { label: "특이사항", value: quote.remarks ?? "", pre: true },
  ];

  // 번호는 **품목 줄만** 센다 — 설명 줄이 사이에 껴도 `1) 2) 3)` 으로 이어진다
  // (케이블 채우개가 매기는 방식 그대로).
  let itemNumber = 0;

  return (
    <PrintFitFrame
        naturalWidthPx={PAGE_NATURAL_WIDTH_PX}
        cssVariable="--qp-fit"
        className="qp-viewport"
      >
        <div className="qp-page">
          <div className="qp-sheet" style={{ width: `${SHEET_WIDTH_PT}pt` }}>
            <header className="qp-top">
              <h1 className="qp-title">견 적 서</h1>
            </header>

            <section className="qp-company">
              <p className="qp-company-name">{header.companyName ?? ""}</p>
              <p>{header.ceoLine ?? ""}</p>
              <p>{header.address ?? ""}</p>
              <p>
                <span className="qp-col1">{header.tel ?? ""}</span>
                <span>{header.fax ?? ""}</span>
              </p>
              <p>
                <span className="qp-col1">{header.email ?? ""}</span>
                <span>{header.homepage ?? ""}</span>
              </p>
            </section>

            <div className="qp-rule-thick" />

            <dl className="qp-info">
              {infoRows.map((row, index) => (
                <div className="qp-info-row" key={row.label}>
                  <dt>
                    <span className="qp-info-n">{index + 1}.</span>
                    <span className="qp-info-label">{row.label}</span>
                    <span className="qp-info-colon">:</span>
                  </dt>
                  <dd className={row.pre ? "qp-info-pre" : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>

            <table className="qp-cable-items">
              <colgroup>
                {CABLE_COLUMN_RATIOS.map((ratio, index) => (
                  <col key={index} style={{ width: `${SHEET_WIDTH_PT * ratio}pt` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th>번 호</th>
                  <th>품 명</th>
                  <th>규 격</th>
                  <th>수 량</th>
                  <th>단 가</th>
                  <th>합 계</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td />
                    <td className="qp-muted" colSpan={5}>
                      (품목 없음)
                    </td>
                  </tr>
                ) : (
                  lines.map((line, index) => {
                    if (line.kind === "NOTE") {
                      /**
                       * 설명 줄 — 품명 칸에 글자만. 🔴 번호 · 수량 · 단가 · 합계는 **비운다**
                       * (그 줄에는 값이 없고, DB 도 NULL 을 보증한다). 규격 칸까지 함께 쓰는
                       * 것은 양식에서도 옆 칸이 비어 글자가 그리로 흘러 보이기 때문이다.
                       */
                      return (
                        <tr key={`note-${index}`} className="qp-cable-note">
                          <td />
                          <td colSpan={2}>{line.partNameText}</td>
                          <td />
                          <td />
                          <td />
                        </tr>
                      );
                    }

                    itemNumber += 1;
                    const quantity = line.quantity ?? 0;
                    const unitPrice = Number(line.unitPrice ?? 0);
                    return (
                      <tr key={`item-${index}`}>
                        <td className="qp-cable-mark">{itemNumber})</td>
                        <td>{line.partNameText}</td>
                        {/* 규격이 없으면 양식과 같은 글자를 적는다 — 빈 칸은 「안 적었다」로 읽힌다. */}
                        <td>{line.partSpecText?.trim() ? line.partSpecText : "-"}</td>
                        <td className="qp-c-qty">{quantity}</td>
                        <td className="qp-c-money">{won(unitPrice)}</td>
                        <td className="qp-c-money">{won(quantity * unitPrice)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            <div className="qp-rule-thick qp-rule-totals" />
            <div className="qp-totals">
              <div className="qp-total-row">
                <span className="qp-total-label">공 급 가</span>
                <span className="qp-total-value">{won(supply)}</span>
              </div>
              <div className="qp-total-row">
                <span className="qp-total-label">부 가 세</span>
                <span className="qp-total-value">{won(vat)}</span>
              </div>
              <div className="qp-total-row qp-total-grand">
                <span className="qp-total-label">합　　계</span>
                <span className="qp-total-value">{won(supply + vat)}</span>
              </div>
            </div>
            <div className="qp-rule-thick" />
          </div>
        </div>
    </PrintFitFrame>
  );
}

/**
 * 케이블 표의 여섯 칸이 차지하는 몫 — 번호 · 품명 · 규격 · 수량 · 단가 · 합계.
 *
 * 종이 폭(SHEET_WIDTH_PT)은 앞선 셋과 같게 두고 그 안에서 나눈다. 🔴 실측한 pt 값을
 * 적지 않은 것은 케이블 양식의 열 너비를 재어 두지 않았기 때문이다 — 지어낸 숫자를
 * 「실측」처럼 적어 두면 다음 사람이 그것을 근거로 삼는다.
 */
const CABLE_COLUMN_RATIOS = [0.072, 0.377, 0.19, 0.08, 0.135, 0.146];

const EXCEL_ONLY_BUTTON_CLASS =
  "inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const EXCEL_ONLY_PRIMARY_BUTTON_CLASS =
  "inline-block rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-100 dark:text-zinc-900 dark:hover:bg-primary-300";

/**
 * ============================================================================
 * 엑셀 전용 견적서의 미리보기 — 붙인 수기 엑셀의 인쇄 모양 (2026-09-15 Q3 · 2026-09-16 ②b)
 * ============================================================================
 * 엑셀 전용 장의 문서는 사람이 손으로 만든 엑셀이다. 앱 양식으로 그리면 품목 없는 빈
 * 견적서가 나오므로 그리지 않는다.
 *
 * ── 붙인 엑셀을 PDF 로 만들었을 때의 모습 (2026-09-16 견적서 ②b) ──────────────
 * 견적서 id 로 GET /api/quotes/{id}/excel-preview 를 불러(quote-print-excel-preview.ts) 붙인
 * 수기 엑셀(.xlsx)의 격자를 받고, 보고서 미리보기와 **같은 그리기**
 * (components/print-grid/SheetPrintGridView.tsx)로 그린다. 용지 · 방향 · 배율 · 여백은 그
 * 엑셀의 인쇄 설정에서 오고, [인쇄 · PDF로 저장]이 그 모양 그대로 PDF 를 만든다.
 *   · 🔴 편집 폼은 격자를 넘기지 않는다 — 미리보기가 id 로 **스스로** 받아 온다. 저장 전
 *     새 견적서(id 없음)는 「저장한 뒤 엑셀 모양으로 미리 볼 수 있습니다」.
 *   · .xls 는 그리지 않는다(사용자 결정 1) — 까닭과 붙인 엑셀이 어디 있는지를 알린다.
 *
 * ── 결재 PDF 와의 관계 (2026-09-16 사용자 결정 2) ───────────────────────────
 * **엑셀 모양이 먼저다.** 결재 PDF 가 올라가 있으면 도구모음의 [결재 PDF 보기]로 아래의
 * 결재 PDF 칸으로 바꿔 보고, 거기서 [엑셀 모양 보기]로 돌아온다. 없으면 단추가 없다. 엑셀을
 * 못 그리면 실패 문장과 함께 결재 PDF 칸을 보인다 — 볼 것이 하나라도 있게. 가르는 표는
 * quote-print-excel-preview.ts 의 excelOnlyPreviewLayout 하나다.
 *
 * 돌아가는 자리는 위 QuotePrintView 의 도구모음과 **같은 기준**이다 — `onClose` 를 받았으면
 * 겹쳐 뜬 미리보기라 닫기 단추, 아니면 독립 페이지라 `backHref` 링크(그 까닭은 위 주석).
 *
 * ── 🔴 결재 PDF 는 페이지 안에 끼워 보이지 않고 새 탭에서 연다 ─────────────────
 * next.config.ts 가 **모든 주소**에 `X-Frame-Options: DENY` 와 `frame-ancestors 'none'` 을
 * 건다 — 받기 통로(/api/attachments/{id}/download)도 예외가 아니라, iframe · object · embed
 * 로 끼우면 브라우저가 빈 칸을 그린다. 이 화면 하나 때문에 그 규칙(클릭 가로채기 방어)을
 * 풀지 않는다. 대신 받기 통로의 `view=full`(PDF 를 inline 으로 내준다 — inline-view.ts)을
 * 새 탭으로 연다. 브라우저 내장 뷰어가 PDF 를 페이지 안에서 보인다.
 *
 * 올리기 · 지우기 단추는 없다 — 이 화면은 보기 권한만 있어도 열린다(print/page.tsx).
 * ============================================================================
 */
function ExcelOnlyQuotePreview({
  quote,
  quoteId,
  onClose,
  backHref,
  signedPdf,
  hasExcel,
}: ExcelOnlyQuotePreviewProps) {
  const excel = useQuoteExcelPreview(quoteId, hasExcel);
  const [view, setView] = useState<ExcelOnlyPreviewView>("excel");

  return (
    <ExcelOnlyQuotePreviewScreen
      quote={quote}
      quoteId={quoteId}
      onClose={onClose}
      backHref={backHref}
      signedPdf={signedPdf}
      hasExcel={hasExcel}
      excel={excel}
      view={view}
      onViewChange={setView}
    />
  );
}

type ExcelOnlyQuotePreviewProps = {
  quote: QuotePrintData;
  quoteId: string | null;
  onClose?: () => void;
  backHref?: string;
  signedPdf: QuotePrintSignedPdf | null;
  hasExcel?: boolean;
};

/**
 * 붙인 엑셀의 격자를 받아 온다 — 저장된 장이고 엑셀이 없다고 이미 알고 있지 않을 때만 부른다.
 *
 * 🔴 효과 본문에서 상태를 곧바로 바꾸지 않는다(react-hooks/set-state-in-effect) — 결과는
 * 응답이 온 뒤의 콜백에서만 넣고, 「읽는 중」은 «이 요청의 결과가 아직 없음»에서 셈한다.
 * 화면이 닫히거나 id 가 바뀌면 부르던 것을 끊고(AbortController) 늦게 온 답을 버린다.
 */
function useQuoteExcelPreview(quoteId: string | null, hasExcel: boolean | undefined): QuoteExcelPreviewState {
  const requestKey = shouldFetchQuoteExcelPreview({ quoteId, hasExcel }) ? quoteId : null;
  const [loaded, setLoaded] = useState<{ key: string; outcome: QuoteExcelPreviewOutcome } | null>(null);

  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    void fetchQuoteExcelPreview(requestKey, undefined, controller.signal).then((outcome) => {
      if (!controller.signal.aborted) setLoaded({ key: requestKey, outcome });
    });
    return () => controller.abort();
  }, [requestKey]);

  return quoteExcelPreviewStateOf({
    quoteId,
    hasExcel,
    outcome: loaded !== null && loaded.key === requestKey ? loaded.outcome : null,
  });
}

/**
 * 엑셀 전용 미리보기의 그림 — **훅이 없다**(상태는 위 ExcelOnlyQuotePreview 가 든다). 시험이
 * 함수로 불러 요소 나무를 걷고, 엑셀 쪽 상태 · 보기(엑셀 · 결재 PDF)를 골라 그려 본다.
 */
export function ExcelOnlyQuotePreviewScreen({
  quote,
  quoteId,
  onClose,
  backHref,
  signedPdf,
  hasExcel,
  excel,
  view,
  onViewChange,
}: ExcelOnlyQuotePreviewProps & {
  excel: QuoteExcelPreviewState;
  view: ExcelOnlyPreviewView;
  onViewChange: (view: ExcelOnlyPreviewView) => void;
}) {
  const layout = excelOnlyPreviewLayout({ state: excel, view, signedPdf });
  const supply = quoteSupplyAmountOf({
    isExcelOnly: true,
    manualSupplyAmount: quote.manualSupplyAmount ?? null,
    items: quote.items,
    workCost: quote.workCost,
  });
  const rows: [string, string][] = [
    ["발행일자", formatDate(quote.quoteDate)],
    ["발행번호", quote.quoteNumber],
    ["공급처", quote.customerNameText],
    ["품명", quote.subject],
    // 금액을 알 수 없으면 「—」 — 0 으로 접지 않는다(0 은 무상 견적이라는 실제 값이다).
    ["공급가액", supply === null ? "— (아직 적지 않았습니다)" : `${won(supply)} (V.A.T. 별도)`],
  ];
  // 결재 PDF 칸이 안 보이는 동안에는 한 줄로 그 사정을 적는다 — 없으면 사용자 결정(2026-09-15) 문장.
  if (!layout.showPdfPanel) {
    rows.push([
      "결재 PDF",
      signedPdf?.kind === "saved"
        ? `${signedPdf.originalFileName} — [결재 PDF 보기]로 볼 수 있습니다`
        : signedPdf?.kind === "pending"
          ? `골라 둔 결재 PDF(${signedPdf.fileName})는 [저장]하면 올라갑니다`
          : EXCEL_ONLY_NO_SIGNED_PDF_TEXT,
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {onClose ? (
          <button type="button" onClick={onClose} className={EXCEL_ONLY_BUTTON_CLASS}>
            ← 편집으로 돌아가기
          </button>
        ) : (
          <Link href={backHref ?? `/quotes/${quoteId}`} className={EXCEL_ONLY_BUTTON_CLASS}>
            ← 견적서로 돌아가기
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {/* 사용자 결정 2 — 엑셀 모양이 먼저, 결재 PDF 가 올라가 있을 때만 바꿔 보는 단추. */}
          {layout.toggle === "SHOW_PDF" ? (
            <button type="button" onClick={() => onViewChange("pdf")} className={EXCEL_ONLY_BUTTON_CLASS}>
              결재 PDF 보기
            </button>
          ) : null}
          {layout.toggle === "SHOW_EXCEL" ? (
            <button type="button" onClick={() => onViewChange("excel")} className={EXCEL_ONLY_BUTTON_CLASS}>
              엑셀 모양 보기
            </button>
          ) : null}
          {/* 🔴 [견적서 받기]는 2026-10-06 에 없앴다 — 앱 양식 갈래의 도구모음과 같다(위 주석).
              엑셀 전용 장의 문서는 「수기 견적서 엑셀」 칸에 붙인 그 파일이다. */}
          {layout.canPrint ? (
            <button
              type="button"
              // 🔴 `window.print()` 는 사람이 누른 클릭 핸들러 안에서만 부른다(보고서 미리보기와 같다).
              onClick={() => window.print()}
              className={EXCEL_ONLY_PRIMARY_BUTTON_CLASS}
            >
              인쇄 · PDF로 저장
            </button>
          ) : null}
        </div>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">엑셀 전용 견적서</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          앱 양식이 아니라 손으로 만든 엑셀로 발행한 견적서입니다 — 「수기 견적서 엑셀」 칸에 붙인 그 파일이 곧 보낸
          견적서입니다.
        </p>
        <dl className="mt-3 flex flex-col gap-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-3">
              <dt className="w-16 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
              <dd className="min-w-0 break-all text-zinc-900 dark:text-zinc-50">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {layout.showExcel ? <ExcelOnlyExcelArea state={excel} /> : null}

      {layout.showPdfPanel ? (
      <section
        aria-label="결재 견적서 PDF"
        className="rounded-lg border border-zinc-200 bg-white p-4 print:hidden dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">결재 견적서 PDF</h2>
        {signedPdf?.kind === "saved" ? (
          <>
            <p className="mt-2 break-all text-sm text-zinc-800 dark:text-zinc-200">{signedPdf.originalFileName}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={quoteAttachmentViewUrl(signedPdf.id)}
                target="_blank"
                rel="noopener noreferrer"
                className={EXCEL_ONLY_PRIMARY_BUTTON_CLASS}
              >
                결재 PDF 보기 (새 탭)
              </a>
              <a href={quoteAttachmentDownloadUrl(signedPdf.id)} className={EXCEL_ONLY_BUTTON_CLASS}>
                내려받기
              </a>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              보안 설정상 이 화면 안에 끼워 보일 수 없어 새 탭에서 엽니다 — 그 화면에서 인쇄 · 저장할 수 있습니다.
            </p>
          </>
        ) : signedPdf?.kind === "pending" ? (
          <p className="mt-2 break-all text-sm text-zinc-700 dark:text-zinc-300">
            골라 둔 결재 PDF({signedPdf.fileName})는 [저장]하면 올라갑니다 — 올린 뒤에 여기서 볼 수 있습니다.
          </p>
        ) : (
          <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{EXCEL_ONLY_NO_SIGNED_PDF_TEXT}</p>
        )}
        {hasExcel === false ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            수기 견적서 엑셀도 아직 붙지 않았습니다 — 견적서 수정 화면의 「수기 견적서 엑셀」 칸에 붙여야 이 장에
            견적서 파일이 생깁니다.
          </p>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}

/** 엑셀 쪽 — 읽는 중 · 격자 · 저장 전 · 실패 문장. 격자 말고는 인쇄에 나가지 않는다. */
function ExcelOnlyExcelArea({ state }: { state: QuoteExcelPreviewState }) {
  if (state.kind === "ready") return <ExcelOnlyQuoteSheet grid={state.grid} warnings={state.warnings} />;
  if (state.kind === "loading") {
    return (
      <p
        role="status"
        className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 print:hidden dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {QUOTE_EXCEL_PREVIEW_TEXT.LOADING}
      </p>
    );
  }
  if (state.kind === "unsaved") {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 print:hidden dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        {QUOTE_EXCEL_PREVIEW_TEXT.UNSAVED}
      </p>
    );
  }
  return (
    <p
      role="alert"
      data-excel-preview-failure={state.reason}
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 print:hidden dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      {state.message}
    </p>
  );
}

/**
 * 붙인 엑셀의 인쇄 모양 한 장. 종이 셈(`planPaper`)과 칸 그리기(`SheetPrintGridView`)는 보고서
 * 미리보기와 **같은 조각**이다 — 용지 · 방향 · 배율 · 여백은 그 엑셀의 인쇄 설정에서 오고, 넘치면
 * 한 장에 들어가도록 더 줄인다(보고서와 같은 판단).
 */
function ExcelOnlyQuoteSheet({ grid, warnings }: { grid: QuoteExcelPreviewGrid; warnings: readonly string[] }) {
  const plan = planPaper(grid);
  const scale = plan.scale;
  // 엑셀의 배율보다 1% 넘게 줄었으면 알린다 — 여러 장짜리 엑셀도 한 장에 앉히기 때문이다.
  const shrunk = plan.scale < grid.page.scale * 0.99;

  return (
    <section aria-label="붙인 수기 견적서 엑셀의 인쇄 모양" className="flex flex-col gap-3">
      <style>{excelOnlySheetStyles(plan, grid.widthPt * scale, grid.page.horizontallyCentered)}</style>

      <p className="text-xs leading-relaxed text-zinc-500 print:hidden dark:text-zinc-400">
        붙인 수기 견적서 엑셀을 <b>PDF 로 만들었을 때의 모양</b>으로 그린 것입니다 — 용지 · 방향 · 배율은 그 엑셀의
        인쇄 설정을 따릅니다. 인쇄 창에서 대상 <b>&ldquo;PDF로 저장&rdquo;</b>, 배율 <b>기본(100%)</b>, 여백{" "}
        <b>기본</b>으로 두세요. 머리글·바닥글(주소·날짜)은 인쇄 창의 <b>&ldquo;머리글 및 바닥글&rdquo;</b> 체크를
        해제하면 사라집니다. 칸의 글꼴 · 테마 색 · 조건부 서식은 그리지 않습니다 — 정본은 「수기 견적서 엑셀」 칸에
        붙인 엑셀입니다.
        {shrunk ? (
          <>
            {" "}
            종이 한 장에 들어가도록 엑셀의 배율({Math.round(grid.page.scale * 100)}%)보다 줄여{" "}
            {Math.round(plan.scale * 100)}%로 그렸습니다.
          </>
        ) : null}
      </p>

      {warnings.length > 0 ? (
        <ul
          role="note"
          className="flex list-disc flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 py-2 pr-3 pl-6 text-xs text-amber-900 print:hidden dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {/* 좁은 화면에서 종이를 폭에 맞춰 줄여 «보여 주는» 상자. 인쇄에는 닿지 않는다. */}
      <PrintFitFrame naturalWidthPx={plan.paperWidthMm * PX_PER_MM} cssVariable="--qxp-fit" className="qxp-viewport">
        <div className="qxp-page">
          <SheetPrintGridView grid={grid} scale={scale} classPrefix="qxp" pictureSrc={(picture) => picture.src} />
        </div>
      </PrintFitFrame>
    </section>
  );
}

/**
 * 엑셀 모양 한 장의 CSS — 보고서 미리보기(`ServiceReportPrintView` 의 styleSheet)와 같은 틀이고
 * 앞말만 `qxp` 다. **`@page` 의 크기 · 여백까지 그 엑셀의 인쇄 설정에서 온다.** 격자가 있을 때만
 * 그려지므로 앱 양식 갈래(`.qp-*` · 92% · 15mm 10mm)와 부딪히지 않는다.
 *
 * 격자 말고는 전부 `print:hidden` 이다(도구모음 · 요약 · 안내 · 결재 PDF 칸). 칸 배경은 인쇄에서도
 * 보이게 `print-color-adjust: exact` 를 건다 — 기본값이면 브라우저가 배경색을 빼고 인쇄한다.
 * ⚠️ 이 글은 템플릿 리터럴 안이다 — 백틱을 쓰면 문자열이 거기서 끊긴다.
 */
function excelOnlySheetStyles(plan: PaperPlan, sheetWidthPt: number, horizontallyCentered: boolean): string {
  const margins = `${plan.marginsMm.top.toFixed(2)}mm ${plan.marginsMm.right.toFixed(2)}mm ${plan.marginsMm.bottom.toFixed(
    2
  )}mm ${plan.marginsMm.left.toFixed(2)}mm`;

  return `
.qxp-page {
  background: #fff; color: #000; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08);
  width: ${plan.paperWidthMm.toFixed(2)}mm; min-height: ${plan.paperHeightMm.toFixed(2)}mm;
  padding: ${margins}; margin: 0 auto; box-sizing: border-box; overflow: hidden;
}
.qxp-sheet {
  position: relative;
  /* 엑셀의 printOptions horizontalCentered 를 따른다. */
  margin: ${horizontallyCentered ? "0 auto" : "0"};
  /* 칸마다의 글꼴은 읽지 않는다. 앱 양식 견적서의 본문 글꼴(명조 계열)로 물려 둔다. */
  font-family: "Batang", "바탕", "BatangChe", "Apple SD Gothic Neo", serif;
  color: #000;
  line-height: 1.15;
}
.qxp-table { width: ${sheetWidthPt.toFixed(3)}pt; table-layout: fixed; border-collapse: collapse; }
.qxp-table td { padding: 0 1px; overflow: visible; word-break: keep-all; }
.qxp-picture { position: absolute; object-fit: contain; }

@media screen {
  .qxp-viewport { overflow-x: auto; }
  .qxp-page { zoom: var(--qxp-fit, 1); }
}

@media print {
  @page { size: ${plan.paperWidthMm.toFixed(2)}mm ${plan.paperHeightMm.toFixed(2)}mm; margin: ${margins}; }
  .qxp-page { box-shadow: none; padding: 0; margin: 0; width: auto; min-height: 0; overflow: visible; }
  .qxp-sheet { break-inside: avoid; page-break-inside: avoid; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
}

/**
 * ============================================================================
 * 금액 묶음 — `1) 부품 비용` · `2) OH 부품 비용` · `3) 작업비 …` (2026-10-31)
 * ============================================================================
 * 품목 표 안의 돈이 적히는 묶음들이다. 아래 작업 내역 묶음(①②③④)과 **같은 규칙**으로
 * 다룬다 — 그리는 것만 모아 두고 번호는 자리에서 뽑는다.
 *
 * ── 🔴 제너레이터 O/H 견적서는 부품 칸이 둘이다 ─────────────────────────────
 * 양식에 `1) 부품 비용` 과 `2) OH 부품 비용` 이 따로 있고, 재고 관리의 O/H 템플릿에서
 * 담아 온 줄(`isOverhaulPart`)이 뒤쪽 칸으로 간다(xlsx/oh-quote-template.ts). 파일은
 * 처음부터 그렇게 나갔는데 **이 화면만 한 칸으로 그리고 있었다**(2026-10-31 사용자
 * 지적) — 같은 견적서인데 화면과 받아 본 문서의 칸이 달랐다.
 *
 * ── 🔴 매쳐 양식에는 그 칸이 없다 — 종류만 보고 가르면 틀린다 (2026-10-31) ──
 * 양식 넷을 열어 B · C · D열을 실측했다. 매쳐는 내자 · O/H 둘 다 부품 칸이 **하나**이고
 * (`1. 부품 비용`), 그래서 파일을 만드는 쪽이 갈라 둔 두 목록을 매쳐 갈래에서 **도로 합쳐**
 * 넘긴다(server/services/quote-workbook.ts 의 `templateKey.startsWith("MATCHER:")`). 가르는
 * 기준을 「O/H 견적서인가」로 두면 **매쳐 O/H 견적서에 화면에만 있는 칸**이 생긴다 — 그래서
 * 양식을 고르는 함수 하나로 가른다(위 `hasOverhaulPartsBox`).
 *
 * 🔴 **줄에 붙은 표시로 가르지도 않는다.** 파일을 만드는 쪽이 종류와 양식으로 가르므로,
 * 내자 장에 OH 표시가 남은 줄이 있어도 — 종류를 OH 로 적다가 내자로 바꾼 장이 그렇다 —
 * 그 문서에는 「2) OH 부품 비용」 칸 자체가 없다. 표시만 보고 가르면 화면에만 있는 칸이
 * 생긴다.
 *
 * ── 🔴 매쳐는 **종이 모양이 통째로 다르다** (2026-10-31 사용자: 「다 고쳐」) ──
 * 양식 넷을 열어 재고 그대로 맞췄다. 갈리는 것 전부를 **아래 양식 모양 표 한 자리**에
 * 모아 둔 까닭이 이것이다 — 여섯 군데에 `if (매쳐)` 가 흩어지면 양식이 하나 더 생기는 날
 * 다섯 군데만 고친다.
 *
 *                     제너레이터(실측)                     매쳐(실측)
 *   품명 줄 앞       `1.`                                 없음(B열이 비어 있다)
 *   제품 줄          `MODEL: …, S/N:…, L/N:…`             없음
 *   금액 묶음 번호   `1)` `2)` `3)`                       `1.` `2.`
 *   부품 칸          `부품 비용` (+O/H 는 `OH 부품 비용`)  `부품 비용` 하나
 *   작업비 머리글    `작업비 (조사,수리,개조,통전,출하검사)` `작업 비용`
 *   작업비 안내(`*`) 인건비·유지관리비·소모품… 긴 문장      「인건비 및 부대비용」 한 문장
 *   작업 내역 번호   `①` `②` `③` (+`④ 서류작업`)          `1)` `2)` `3)` (서류작업 없음)
 *
 * 🔵 **작업 내역의 머리글 글자**(`인수 조사` ↔ `조사작업`)는 여기서 정하지 않는다 — 서버가
 * 그 양식 파일에서 읽어 `workSections` 로 건네준다(storage/quote-template.ts). 번호만 갈린다.
 *
 * ── 🔴 OH 부품이 한 줄도 없어도 그 칸은 남는다 ─────────────────────────────
 * 파일 쪽을 재어 맞춘 것이다: 줄 수를 맞추는 자리가 **머리글 바로 아래부터** 지운다 —
 * oh-quote-template.ts 가 `resizeRowBlock` 에 `firstRow: overhaul.firstRow` 와
 * `targetCount: input.overhaulParts.length` 를 주고, 그 `firstRow` 는 `headerRow + 1` 이다
 * (quote-sheet-layout.ts 의 findItemBlock). 그래서 부품이 0개면 항목 줄만 사라지고 머리글
 * `2) OH 부품 비용` 은 그대로 나간다. 부품 없이 작업비만 받는 O/H 견적이 실제로 있다(OhQuoteInput 의
 * `overhaulParts`). 화면에서 칸을 숨기면 그 장에서 미리보기와 문서의 번호가 어긋난다 —
 * 작업비가 화면에선 2), 문서에선 3) 이 된다.
 *
 * 🔵 대신 **「(부품 없음)」을 적지 않는다** — 그 글자는 `1) 부품 비용` 칸에만 있던 화면
 * 쪽 표시이고 파일에는 안 적힌다. 새 칸에 베껴 두면 문서에 없는 글자가 하나 더 는다.
 *
 * ── 🔴 번호를 손으로 적지 않고 자리 순서에서 뽑는다 ─────────────────────────
 * 아래 buildWorkSections 와 같은 까닭이다. 실제로 이 자리에서 당했다: OH 칸을 넣지 않은
 * 채 작업비에 `2)` 가 글자로 박혀 있어서, 칸이 셋인데 번호는 둘까지밖에 없었다. 두 벌로
 * 적어 두면 칸이 하나 늘거나 주는 날 또 어긋난다.
 *
 * 🔵 **양식 쪽도 같은 날 맞췄다**(2026-10-31). 제너레이터 O/H 양식은 그날 아침까지 B열에
 * `2)` 가 두 번 적혀 있어서(`1) 부품 비용` · `2) OH 부품 비용` · `2) 작업비 …`) 파일만 번호가
 * 겹쳐 나갔고, 사용자가 양식 파일을 고쳐 `3)` 이 되었다 — 채우개는 그 칸을 건드리지 않으므로
 * (xlsx/oh-quote-template.ts 는 작업 내역 묶음과 서류작업의 번호만 당긴다) 양식에 적힌 값이
 * 그대로 나간다. **지금은 화면과 파일이 둘 다 `3)` 이다**(양식을 채워 보고 확인).
 * ============================================================================
 */

/** 품목 표에 적히는 한 줄. numeric 은 문자열로 오므로 여기서 한 번만 숫자로 바꾼다. */
type PrintedPart = { name: string; quantity: number; unitPrice: number };

function printedPartOf(item: {
  partNameText: string;
  quantity: number;
  unitPrice: string;
}): PrintedPart {
  return { name: item.partNameText, quantity: item.quantity, unitPrice: Number(item.unitPrice) };
}

/** 부품 칸 — 머리글 한 줄과 그 아래 부품 줄들. */
type PartsCostGroup = {
  mark: string;
  body: "PARTS";
  label: string;
  parts: readonly PrintedPart[];
  /**
   * 줄이 하나도 없을 때 적을 글. **null 이면 머리글만 그리고 아무것도 적지 않는다** —
   * 파일이 그 모양이다(위 머리말의 「OH 부품이 한 줄도 없어도」).
   */
  emptyText: string | null;
};

/** 작업비 줄 — 수량 1 에 금액이 붙고, 바로 아래 작은 글씨 안내가 따라온다. */
type LaborCostGroup = {
  mark: string;
  body: "LABOR";
  label: string;
  /** 바로 아래 `*` 줄. **양식마다 문장이 다르다**(아래 양식 모양 표). */
  note: string;
  workCost: number;
};

type CostGroup = PartsCostGroup | LaborCostGroup;

/** 부품 줄이 하나도 없는 `1) 부품 비용` 칸에만 적는 화면 쪽 표시(위 머리말). */
const NO_PARTS_TEXT = "(부품 없음)";

/**
 * 양식에 적힌 머리글 그대로다 — 번호만 빼고(번호는 자리에서 뽑는다).
 *
 * 🔵 **넷이 같은 글자라 여기 한 번만 적는다**(실측: 제너레이터 D26 · 매쳐 D27 둘 다
 * `부품 비용`). 양식마다 갈리는 글자는 아래 양식 모양 표에 있다.
 */
const COST_GROUP_LABELS = {
  parts: "부품 비용",
  overhaulParts: "OH 부품 비용",
} as const;

/**
 * ============================================================================
 * 🔴 양식마다 갈리는 것 — **한 자리에 모아 둔다** (2026-10-31)
 * ============================================================================
 * 번호 모양 · 머리글 글자 · 있고 없는 줄까지 여섯 가지가 갈린다(위 머리말의 표). 그리는
 * 자리마다 `if (매쳐)` 를 흩어 두면 **양식이 하나 더 생기는 날 다섯 군데만 고친다** — 그
 * 누락은 오류가 아니라 「그 양식만 종이가 섞인다」로 나타나서, 그 양식을 쓰는 사람이
 * 말해 주기 전에는 아무도 모른다.
 *
 * 🔴 **값은 전부 양식 파일 실측이다**(2026-10-31, 넷을 열어 A~D열을 훑었다). 지어낸 글자가
 * 하나도 없어야 한다 — 받아 본 문서와 글자가 다르면 그것이 곧 다른 종이다.
 */
type QuoteSheetShape = {
  /** 품명 줄 앞에 적는 번호. **null 이면 그 칸을 비운다**(매쳐 양식의 B25 가 비어 있다). */
  subjectMark: string | null;
  /** `MODEL: …, S/N:…, L/N:…` 줄을 그리는가. 매쳐 양식에는 그 줄이 없다. */
  showProductLine: boolean;
  /** 금액 묶음 번호. 자리 순서대로 쓴다 — 어느 묶음이 몇 번인지 따로 적지 않는다. */
  costGroupMarks: readonly string[];
  /** `OH 부품 비용` 칸이 있는가 — 제너레이터 O/H 하나뿐이다. */
  hasOverhaulPartsBox: boolean;
  /** 작업비 묶음의 머리글. */
  laborLabel: string;
  /** 작업비 바로 아래 `*` 줄. */
  laborNote: string;
  /** 작업 내역 묶음 번호. 역시 자리 순서대로 쓴다. */
  sectionMarks: readonly string[];
  /** 맨 아래 「서류작업」 묶음이 있는가 — 제너레이터 둘뿐이다. */
  hasPaperworkSection: boolean;
};

/** 제너레이터 내자 · O/H 가 함께 쓰는 값(O/H 부품 칸만 갈린다). */
const GENERATOR_SHEET_SHAPE: Omit<QuoteSheetShape, "hasOverhaulPartsBox"> = {
  subjectMark: "1.",
  showProductLine: true,
  costGroupMarks: ["1)", "2)", "3)"],
  laborLabel: "작업비 (조사,수리,개조,통전,출하검사)",
  laborNote:
    "수리에 필요한 인건비, 유지관리비(계측기 유지관리, 전기 및 수도세등), 소모품등이 포함되어 책정된 가격입니다.",
  sectionMarks: ["①", "②", "③", "④"],
  hasPaperworkSection: true,
};

/**
 * 매쳐 내자 · O/H. **둘은 같은 판이고 줄 수만 다르다**(xlsx/matcher-quote-template.ts 머리말),
 * 그래서 모양 값이 하나도 갈리지 않는다 — O/H 부품 칸도 둘 다 없다.
 */
const MATCHER_SHEET_SHAPE: Omit<QuoteSheetShape, "hasOverhaulPartsBox"> = {
  subjectMark: null,
  showProductLine: false,
  costGroupMarks: ["1.", "2."],
  laborLabel: "작업 비용",
  laborNote: "수리에 필요한 인건비 및 부대비용이 포함되어 책정된 가격입니다.",
  sectionMarks: ["1)", "2)", "3)"],
  hasPaperworkSection: false,
};

/**
 * 🔴 **표를 다 적어 둔다 — 새 양식이 생기면 컴파일러가 여기를 짚어 준다.** 「매쳐가 아니면
 * 제너레이터」로 적어 두면 새 양식이 조용히 제너레이터 모양으로 흘러가고, 그런 종류의
 * 누락은 그 양식의 문서가 나간 뒤에야 드러난다(xlsx/quote-sheet-layout.ts 의
 * `WorkScopeExclusions` 가 집합 대신 Record 인 것과 같은 까닭).
 */
const SHEET_SHAPES: Record<Exclude<QuoteTemplateKey, "CABLE">, QuoteSheetShape> = {
  "GENERATOR:DOMESTIC": { ...GENERATOR_SHEET_SHAPE, hasOverhaulPartsBox: false },
  "GENERATOR:OVERHAUL": { ...GENERATOR_SHEET_SHAPE, hasOverhaulPartsBox: true },
  "MATCHER:DOMESTIC": { ...MATCHER_SHEET_SHAPE, hasOverhaulPartsBox: false },
  "MATCHER:OVERHAUL": { ...MATCHER_SHEET_SHAPE, hasOverhaulPartsBox: false },
};

function quoteSheetShapeOf(templateKey: QuoteTemplateKey): QuoteSheetShape {
  /**
   * 🔴 **케이블은 여기 오지 않는다** — 그 종이는 위에서 갈라져 CableQuoteSheet 가 그린다
   * (금액 묶음도 작업 내역도 없는 다른 판이다). 표에 넣어 두면 쓰이지도 않는 값이 「그
   * 양식의 모양」처럼 읽힌다. 만에 하나 흘러들면 지금까지와 같은 제너레이터 모양이다.
   */
  if (templateKey === "CABLE") return SHEET_SHAPES["GENERATOR:DOMESTIC"];
  return SHEET_SHAPES[templateKey];
}

function buildCostGroups(input: {
  shape: QuoteSheetShape;
  parts: readonly PrintedPart[];
  overhaulParts: readonly PrintedPart[];
  workCost: number;
}): CostGroup[] {
  const drawn: (Omit<PartsCostGroup, "mark"> | Omit<LaborCostGroup, "mark">)[] = [
    {
      body: "PARTS",
      label: COST_GROUP_LABELS.parts,
      parts: input.parts,
      emptyText: NO_PARTS_TEXT,
    },
    // 제너레이터 O/H 양식에만 있는 칸. 비어 있어도 머리글은 남는다(위 머리말).
    ...(input.shape.hasOverhaulPartsBox
      ? [
          {
            body: "PARTS" as const,
            label: COST_GROUP_LABELS.overhaulParts,
            parts: input.overhaulParts,
            emptyText: null,
          },
        ]
      : []),
    {
      body: "LABOR",
      label: input.shape.laborLabel,
      note: input.shape.laborNote,
      workCost: input.workCost,
    },
  ];
  return drawn.map((group, index) => ({ ...group, mark: input.shape.costGroupMarks[index] }));
}

function CostGroupRows({ group }: { group: CostGroup }) {
  if (group.body === "LABOR") {
    return (
      <>
        <tr className="qp-group-row">
          <td colSpan={2} />
          <td className="qp-c-group" colSpan={4}>
            {group.mark}　{group.label}
          </td>
          <td className="qp-c-qty">1</td>
          <td className="qp-c-money">{won(group.workCost)}</td>
          <td className="qp-c-money">{won(group.workCost)}</td>
        </tr>
        <tr>
          <td colSpan={2} />
          <td className="qp-c-dash">*</td>
          <td className="qp-c-fine" colSpan={6}>
            {group.note}
          </td>
        </tr>
      </>
    );
  }

  return (
    <>
      <tr className="qp-group-row">
        <td colSpan={2} />
        <td className="qp-c-group" colSpan={7}>
          {group.mark}　{group.label}
        </td>
      </tr>
      {group.parts.length === 0
        ? group.emptyText !== null && (
            <tr>
              <td colSpan={2} />
              <td className="qp-c-item qp-muted" colSpan={7}>
                {group.emptyText}
              </td>
            </tr>
          )
        : group.parts.map((part, index) => (
            <tr key={`${part.name}-${index}`}>
              <td colSpan={2} />
              <td className="qp-c-dash">-</td>
              <td className="qp-c-item" colSpan={3}>
                {part.name}
              </td>
              <td className="qp-c-qty">{part.quantity}</td>
              <td className="qp-c-money">{won(part.unitPrice)}</td>
              <td className="qp-c-money">{won(part.quantity * part.unitPrice)}</td>
            </tr>
          ))}
    </>
  );
}

type WorkSection = { mark: string; label: string; items: readonly string[] };

/**
 * 작업 내역 세 묶음. 키는 저장 쪽 구분과 같다(validation/quote-input.ts 의
 * `QUOTE_WORK_SCOPE_SECTIONS`). `label` 은 양식에 적힌 머리글 그대로다 —
 * 제너레이터 O/H 의 ② 는 `OH 및 수리 작업`, 매쳐는 `조사작업`… 으로 갈린다.
 */
export type QuoteWorkSections = {
  INVESTIGATION: { label: string; items: readonly string[] };
  REPAIR: { label: string; items: readonly string[] };
  POWER_TEST: { label: string; items: readonly string[] };
};

function SectionRows({ section }: { section: WorkSection }) {
  return (
    <>
      <tr className="qp-group-row">
        <td colSpan={2} />
        <td className="qp-c-group" colSpan={7}>
          {section.mark}　{section.label}
        </td>
      </tr>
      {section.items.map((line, index) => (
        <tr key={`${line}-${index}`}>
          <td colSpan={2} />
          <td className="qp-c-dash">-</td>
          <td className="qp-c-item" colSpan={6}>
            {line}
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * 그려야 하는 묶음들.
 *
 * ①②③ 은 실제 작업 내역이고, **서류작업만 고정 문구**다 — 양식에도 그 아래
 * 줄이 없고 견적서마다 달라지는 값이 아니다.
 *
 * ── 🔴 서류작업은 **제너레이터 양식에만 있다** (2026-10-31 사용자 요구) ────
 * 「매쳐 oh 엑셀에는 [④　서류작업]가 없는데 미리보기에는 있어」. 양식 넷의 시트를
 * 통째로 훑어 확인했다 — 「서류」가 든 줄이 제너레이터 내자 52행 · 제너레이터 O/H
 * 69행에 하나씩 있고 **매쳐 둘에는 0개**다. 그래서 매쳐 채우개만 번호를 당기는
 * `renumberPaperworkBlock` 을 부르지 않는다(xlsx/matcher-quote-template.ts).
 *
 * 🔴 **빼면 번호가 저절로 맞는다.** 아래에서 번호를 자리 순서로 뽑으므로, 묶음이
 * 하나 빠져도 남은 셋이 `1) 2) 3)` 그대로다 — 손으로 적어 두었다면 매쳐에서만 넷째
 * 번호가 남아 틀어졌을 것이다. 이 패턴이 바로 그러라고 있는 것이다.
 *
 * ── 🔴 번호 **모양**도 양식마다 다르다 ─────────────────────────────────
 * 제너레이터는 `① ② ③ ④`, 매쳐는 `1) 2) 3)` 이다(실측). 파일 쪽도 같은 두 벌을 들고
 * 번호를 당긴다(xlsx/quote-sheet-layout.ts 의 `renumberWorkScopeSectionMarks` 가 `marks`
 * 를 받는 그 까닭 — 매쳐 채우개는 `MATCHER_SECTION_MARKS` 를 건넨다).
 *
 * ── 통전작업을 뺀 장은 ③ 을 아예 그리지 않는다 ──────────────────────────
 * 하지 않은 시험을 했다고 적어 보내지 않기 위해서다. 🔴 **그러면 서류작업이
 * ③ 이 된다** — 양식에서도 ③ 의 줄을 지우면서 서류작업의 번호를 함께 당긴다
 * (xlsx/quote-sheet-layout.ts 의 `renumberPaperworkBlock`). 여기만 ④ 로 두면
 * 미리보기와 받아 본 문서의 번호가 어긋나고, 문서에는 `① ② ④` 로 번호가
 * 하나 건너뛴 견적서가 나간다.
 *
 * ── 수리 작업을 하나도 안 고른 제너레이터 장은 ② 를 그리지 않는다 ─────────
 * 양식의 그 묶음은 기본 줄이 0개라, 두면 줄 없는 머리글만 남는다(2026-09-15
 * 사용자). 그러면 통전검사가 ②, 서류작업이 ③ 이 된다 — 파일 쪽도 같은 자리에서
 * 번호를 당긴다(renumberWorkScopeSectionMarks).
 *
 * 🔴 **번호를 손으로 적지 않고 자리 순서에서 뽑는다.** 두 벌로 적어 두면 묶음이
 * 하나 더 생기거나 빠지는 날 또 어긋난다 — 파일 쪽도 같은 방식으로 셈한다.
 */
function buildWorkSections(
  sections: QuoteWorkSections | undefined,
  dropped: { investigation: boolean; repair: boolean; powerTest: boolean },
  /**
   * 번호 모양과 서류작업 유무 — 양식이 정한다(위 양식 모양 표).
   *
   * 🔴 **선택이 아니라 받아야 하는 값이다.** 「안 주면 제너레이터」로 두면 부르는 자리를
   * 하나 빠뜨린 날 매쳐 종이에 그 양식에 없는 묶음과 동그라미 번호가 다시 뜬다 —
   * 오류가 나지 않는다.
   */
  shape: Pick<QuoteSheetShape, "sectionMarks" | "hasPaperworkSection">
): WorkSection[] {
  const resolved = sections ?? FALLBACK_WORK_SECTIONS;
  const drawn = [
    ...(dropped.investigation ? [] : [resolved.INVESTIGATION]),
    ...(dropped.repair ? [] : [resolved.REPAIR]),
    ...(dropped.powerTest ? [] : [resolved.POWER_TEST]),
    ...(shape.hasPaperworkSection ? [{ label: "서류작업", items: [] as readonly string[] }] : []),
  ];
  return drawn.map((section, index) => ({ mark: shape.sectionMarks[index], ...section }));
}

/**
 * 작업 내역을 못 받았을 때 그리는 것 — 제너레이터 내자 양식의 문구다.
 *
 * ⚠️ 여기 적힌 글자는 **최후의 되돌림 값**이다. 실제로 나가는 문서의 근거는
 * 양식 파일이고, 그 값은 서버가 읽어 `workSections` 로 건네준다
 * (storage/quote-template.ts 의 readQuoteWorkSections).
 */
const FALLBACK_WORK_SECTIONS: QuoteWorkSections = {
  INVESTIGATION: {
    label: "인수 조사",
    items: ["외관검사", "파라메타 체크", "내부확인(각 보드 별 상태 확인 및 기타)"],
  },
  REPAIR: { label: "수리 작업", items: [] },
  POWER_TEST: {
    label: "통전검사[출하검사]",
    items: [
      "절연저항치・내압시험",
      "각 AMP기판의 전압・전류치 확인",
      "정격출력시험",
      "스크리닝시험",
      "오픈・쇼트시험",
      "출력의 직선성 확인",
      "에이징 시험 (정격연속출력:1시간)",
    ],
  },
};

const STYLES = `
.qp-root { background: #fff; color: #000; }
.qp-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .5rem; }
/* 단추를 위로 붙이고, 좁으면 줄바꿈한다. 지금 안에 있는 것은 [인쇄 · PDF로 저장] 하나다. */
.qp-toolbar-actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: .5rem; }
.qp-btn { border: 1px solid #d4d4d8; border-radius: .375rem; padding: .375rem .75rem; font-size: .875rem; text-decoration: none; color: #3f3f46; background: #fff; cursor: pointer; }
.qp-btn-primary { border-color: #18181b; background: #18181b; color: #fff; }
.qp-note { margin-bottom: 1rem; font-size: .75rem; line-height: 1.7; color: #71717a; }

.qp-page { background: #fff; border: 1px solid #e4e4e7; padding: 15pt 10pt; width: fit-content; margin: 0 auto; }
.qp-sheet {
  font-family: "Batang", "바탕", "BatangChe", "Apple SD Gothic Neo", serif;
  font-size: 9.5pt; line-height: 1.5; color: #000;
}

/* 제목은 왼쪽, 로고는 오른쪽 위 — 실제 발행본 그대로. */
.qp-top { display: flex; align-items: flex-start; justify-content: space-between; }
.qp-title { margin: 0; font-size: 26pt; font-weight: 700; letter-spacing: .3em; line-height: 1.1; }
.qp-logo { max-height: 42pt; max-width: 160pt; object-fit: contain; }

.qp-company { margin-top: 6pt; padding-left: 8pt; }
.qp-company p { margin: 0; }
.qp-company-name { font-size: 13pt; font-weight: 700; }
.qp-ceo { position: relative; }
.qp-ceo-text { letter-spacing: .05em; }
.qp-seal { position: absolute; left: 74pt; top: -9pt; width: 37pt; height: 35pt; }
.qp-col1 { display: inline-block; min-width: 132pt; }

.qp-rule-thick { border-top: 2pt solid #000; margin-top: 4pt; }
.qp-rule-totals { margin-top: 10pt; }

.qp-info { margin: 6pt 0 8pt; padding-left: 8pt; }
.qp-info-row { display: flex; align-items: baseline; }
.qp-info-row dt { display: flex; flex: none; }
.qp-info-n { display: inline-block; width: 18pt; }
.qp-info-label { display: inline-block; width: 56pt; white-space: pre; }
.qp-info-colon { display: inline-block; width: 12pt; }
.qp-info-row dd { margin: 0; }
/* 케이블의 특이사항 — 적은 줄바꿈 그대로(여러 줄 칸이다). */
.qp-info-pre { white-space: pre-wrap; }

.qp-items { width: 100%; border-collapse: collapse; table-layout: fixed; }
.qp-items th { border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; padding: 2pt 3pt; font-weight: 400; text-align: center; }
.qp-items td { padding: 1pt 3pt; vertical-align: top; }
.qp-spacer-row td { height: 6pt; }
.qp-group-row td { padding-top: 5pt; }

.qp-c-no { text-align: right; padding-right: 8pt; }
.qp-c-title { font-weight: 400; }
.qp-c-model { padding-left: 12pt; }
.qp-c-group { padding-left: 10pt; }
.qp-c-dash { text-align: right; padding-right: 2pt; }
.qp-c-item { }
.qp-c-fine { font-size: 8pt; white-space: normal; }
.qp-c-qty { text-align: center; }
.qp-c-money { text-align: right; font-variant-numeric: tabular-nums; }
.qp-muted { color: #71717a; }

/* ── 케이블 견적서의 품목 표 (2026-09-17) ───────────────────────────────────
   🔴 이 글은 그려진 종이에 그대로 실려 나간다(style 태그 안이다) — 작업 내역 묶음에
   쓰는 동그라미 숫자를 여기 적지 말 것. 그 번호가 종이에 남지 않았는지 보는 시험이
   글자만 훑으므로, 주석 한 줄 때문에 「번호가 남았다」로 읽힌다(실제로 겪었다).
   위 .qp-items 와 같은 틀이지만 칸이 여섯이고 규격이 하나 더 있다. 줄과 줄 사이를
   벌려 두는 것은 양식이 **한 줄씩 띄운 모양**이기 때문이다(그 양식의 품목 자리는
   27 · 29 · 31 … 43 이다). 위 갈래는 이 규칙을 하나도 쓰지 않는다 — 이름이 갈린다. */
.qp-cable-items { width: 100%; border-collapse: collapse; table-layout: fixed; }
.qp-cable-items th { border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; padding: 2pt 3pt; font-weight: 400; text-align: center; }
.qp-cable-items td { padding: 3.5pt 3pt; vertical-align: top; word-break: break-all; }
.qp-cable-mark { text-align: center; }
/* 설명 줄은 앞 품목에 붙는 글이다 — 위 여백을 줄여 그 묶음으로 보이게 둔다. */
.qp-cable-note td { padding-top: 1pt; }

.qp-totals { padding: 3pt 0; }
.qp-total-row { display: flex; justify-content: flex-end; align-items: baseline; }
.qp-total-label { width: 70pt; text-align: center; letter-spacing: .1em; }
.qp-total-value { width: 110pt; text-align: right; font-variant-numeric: tabular-nums; }
.qp-total-grand .qp-total-label, .qp-total-grand .qp-total-value { font-weight: 700; }

/* ── 좁은 화면: 종이를 폭에 맞춰 줄여 «보여 준다» ──────────────────────────
   🔴 이 블록은 통째로 @media screen 안에 있다 — 인쇄에는 규칙 자체가 적용되지
   않으므로 나가는 문서는 한 픽셀도 달라지지 않는다. 까닭과 원리는
   components/common/print-fit-frame.tsx 머리말에 있다.
   ⚠️ 이 글은 템플릿 리터럴 안이다 — 백틱을 쓰면 문자열이 거기서 끊긴다. */
@media screen {
  /* 스크롤 상자의 최소 너비는 0 이라, 713px 짜리 종이가 앱 껍데기를 옆으로
     밀어내지 못한다. 배율이 1 로 남더라도 문서는 «이 상자 안에서만» 밀린다. */
  .qp-viewport { overflow-x: auto; }
  /* 배율은 상자가 재어 변수로 내려 준다. 다 들어가는 화면에서는 1 이다. */
  .qp-page { zoom: var(--qp-fit, 1); }
}

@media print {
  @page { size: A4 portrait; margin: 15mm 10mm; }
  .qp-toolbar, .qp-note { display: none !important; }
  .qp-page { border: 0; padding: 0; margin: 0; width: auto; }
  .qp-items tr { break-inside: avoid; }
  .qp-cable-items tr { break-inside: avoid; }
}
`;
