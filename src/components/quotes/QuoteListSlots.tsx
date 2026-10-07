"use client";

import { useState, type ComponentProps } from "react";
import Link from "next/link";

import QuoteListScreen from "@dss/core/ui/quotes/QuoteListScreen";
import type { QuoteListItem } from "@dss/core/ui/quotes/quote-list-rows";
import {
  QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE,
  canRenderQuoteDocument,
} from "@/lib/domain/quote-document-support";
import { quoteEditHref, quotePrintHref } from "@/lib/domain/quote-new-link";
import NewQuoteDialog from "./NewQuoteDialog";
import QuoteArchiveExcelOpenButton from "./QuoteArchiveExcelOpenButton";
import { QuoteFileBadges } from "./QuoteAttachmentParts";

/**
 * ============================================================================
 * 🔴 목록 화면의 **함수 슬롯**은 여기서 건다 — 서버에서는 못 건넨다
 * ============================================================================
 * 견적서 목록 화면은 2026-10-07 부터 **공용 묶음의 것**이다
 * (`@dss/core/ui/quotes/QuoteListScreen` — `vendor/dss-core` 서브모듈). 이 저장소에
 * 있던 868줄짜리 복사본은 지웠다. 까닭은 설계서 F절 5번이다 — 같은 견적서를 **두
 * 화면**(이 저장소의 목록 · 수리 건 상세 [견적서] 탭과, PO/내자 사이트의 [견적서]
 * 목록)이 그리는데, 복사본을 두면 「금액 · 요약 줄이 갈라지는 날」이 오고 그날 사람은
 * 같은 견적서의 **다른 금액**을 두 화면에서 보게 된다. 그 차이는 한참 뒤에 드러난다.
 *
 * ── 🔴 왜 두 단인가 (page.tsx → 이 조각 → 공용 화면) ────────────────────
 * PO 가 먼저 이 길을 갔고, 그쪽 조각 3b-1 에서 `rowHref`(줄을 눌러 여는 곳)를 채우려고
 * `page.tsx` 에서 곧바로 넘겼더니 화면이 이 오류로 통째로 죽었다(2026-09-21 눈 확인):
 *
 *     Functions cannot be passed directly to Client Components unless you
 *     explicitly expose it by marking it with "use server".
 *
 * `page.tsx` 는 **서버 컴포넌트**이고 목록 화면은 `"use client"` 다. 그 경계를 넘는 값은
 * 직렬화되어야 하는데 **평범한 함수는 직렬화되지 않는다.** 휴지통 액션 셋이 그대로
 * 넘어가는 것은 그것이 **서버 액션**(`"use server"`)이라서다 — 같은 「함수」처럼 보이지만
 * 전혀 다른 물건이다.
 *
 * 🔴 **`tsc` 도 `lint` 도 이것을 잡지 못한다.** 타입으로는 맞고, 브라우저에서 화면을
 * 열어야 드러난다. 그래서 이 파일이 있다(PO 의 같은 이름 파일과 같은 까닭이다).
 *
 * 화면의 슬롯 일곱 가운데 **함수 넷이 전부 이 경계에 걸린다** — 그래서 여기서 건다:
 *
 *     rowHref           줄을 눌러 여는 곳(수정 화면)
 *     intakeHref        인수번호를 눌러 가는 곳(수리 건 상세)
 *     renderFileBadges  줄의 파일 딱지(엑셀 전용 · 결재 PDF · 엑셀 없음)
 *     renderRowActions  줄의 [미리보기 · PDF] · [Excel 보기] · 곁말
 *
 * 나머지 셋은 **서버에서 넘겨도 된다**: `trashActions`(서버 액션) ·
 * `newQuoteControl`(ReactNode) · `notice`(ReactNode). 지금 쓰는 둘은 page.tsx 에 있다.
 * `emptyMessage` 는 글자라 그대로 넘어간다.
 *
 * ── 🔴 이 조각은 자료를 모른다 ──────────────────────────────────────────
 * 받은 프롭을 그대로 흘려보내고 **함수 슬롯만 얹는다.** 조회도 권한 판정도 page.tsx 가
 * 하고(서버), 저장·삭제는 서버 액션이 세션부터 다시 본다.
 *
 * 🔴 **서브모듈(vendor/dss-core)은 손대지 않는다.** 그 화면은 PO/내자 사이트와 함께 쓰는
 * 한 벌이고, 사이트마다 다른 주소 · 조각을 그 안에 적으면 「한 벌」이 깨진다.
 * ============================================================================
 */

/**
 * ============================================================================
 * 🔴 공용 화면과 **값이 다른 자리 셋** — 공용 것을 따랐다 (2026-10-07)
 * ============================================================================
 * 이 저장소의 868줄 복사본과 공용 화면은 세 자리에서 값이 달랐고, 공용을 고치지 않는 것이
 * 이 작업의 원칙이라 **공용 값을 따랐다.** 셋 다 **화면에 보이는 차이**이므로 적어 둔다:
 *
 *  ① `ResponsiveList` 의 `measureKey` — 옛것 `[filtered.length, canDelete]`,
 *     공용 `[filtered.length, canEdit]`. 표/카드를 **다시 재는 시점**이 달라진다.
 *  ② 줄 단추 상자 className — 옛것 `flex items-start gap-1`, 공용 `flex gap-1`.
 *     [Excel 보기]가 여러 줄짜리 결과를 뱉을 때 그 칸의 세로 정렬이 달라진다.
 *  ③ 요약 줄 — 옛것은 **언제나 `<Link>`**, 공용은 `rowHref` 가 null 이면 글자.
 *     🔴 아래 `rowHref` 는 **null 을 돌려주지 않으므로** 이 저장소에서는 지금까지와
 *     같이 언제나 링크다(PO 는 `canEdit` 으로 가른다 — 그쪽을 베끼지 않았다).
 * ============================================================================
 */

/**
 * 앱 양식이 아직 없는 종류의 곁말 — 🔴 **내려받기 링크는 없앴다**(2026-10-06).
 *
 * 이 자리에는 받기가 있었다 — 2026-09-15 에는 권한으로 갈리는 발행 단추(POST …/issue),
 * 그 뒤에는 누구에게나 같은 링크(GET …/xlsx). 사용자 결정으로 **브라우저로 내려받는 길을
 * 화면에서 모두 걷어냈다.** 견적서 엑셀은 [저장]이 사내 공유폴더에 넣는다(server/actions/
 * quotes.ts 의 archiveDocumentAfterSave) — 받는 길은 그 폴더 하나다.
 *
 * 🔴 **곁말만 남는다.** 앱 양식이 없는 종류는 [미리보기 · PDF]도 그리지 않으므로(아래
 * PreviewLink) 이 칸이 통째로 비어 「왜 이 줄만 아무것도 없지」가 된다. 문장은 통로 ·
 * 미리보기 화면 · 편집 화면과 **같은 하나**다(domain/quote-document-support.ts).
 */
function DocumentUnsupportedNote({ row }: { row: QuoteListItem }) {
  if (canRenderQuoteDocument(row)) return null;
  return (
    <span
      title={QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE}
      className="text-xs text-zinc-400 dark:text-zinc-500"
    >
      —
    </span>
  );
}

/**
 * 미리보기 · PDF. 브라우저 인쇄에서 "PDF로 저장"을 고르면 파일이 된다.
 *
 * `repairCaseId` 는 줄 링크와 같은 값이다(아래 `quoteLinkRepairCaseId`). 인쇄 화면이
 * 그것을 받아 「돌아가기」를 그 건을 실은 수정 화면으로 보낸다.
 *
 * 🔴 앱 양식이 아직 없는 종류(케이블)에는 **내밀지 않는다** — 그 화면도 서버에서 거절한다
 * (위 DocumentUnsupportedNote · domain/quote-document-support.ts). 까닭은 그 곁말이 말한다.
 */
function PreviewLink({ row, repairCaseId }: { row: QuoteListItem; repairCaseId: string | null }) {
  if (!canRenderQuoteDocument(row)) return null;
  return (
    <Link
      href={quotePrintHref({ quoteId: row.id, repairCaseId })}
      className="inline-block rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      미리보기 · PDF
    </Link>
  );
}

/**
 * ============================================================================
 * 목록 머리의 [새 견적서] — 누르면 **팝업**이 뜬다 (견적서 ⑤)
 * ============================================================================
 * 단추는 곧바로 작성 화면으로 가지 않고 창을 띄운다 — 견적서 종류 · 엑셀 전용을 먼저
 * 고르면 [만들기]가 그 두 값을 `baseHref` 에 덧붙여 간다. 수리 건 탭이 실어 둔 인수번호 ·
 * 건 id 는 그대로 남는다(NewQuoteDialog.tsx · domain/quote-new-link.ts).
 *
 * 🔴 **`page.tsx`(서버)가 아니라 여기(클라이언트)에 둔다.** 창을 여닫는 것은 상태이고,
 * 서버 컴포넌트는 상태를 들 수 없다. 슬롯(`newQuoteControl`) 자체는 ReactNode 라 서버
 * 경계를 넘으므로 **page.tsx 가 이 조각을 그려 넘긴다** — 주소를 아는 곳은 그대로
 * page.tsx 둘(목록은 `/quotes/new`, 수리 건 탭은 그 건을 실은 주소)이다.
 *
 * 🔴 **`key` 를 빠뜨리지 마라.** 서버 컴포넌트가 프롭으로 건네는 요소는 브라우저에
 * `react.lazy` 껍데기에 싸인 채 도착하고, React 의 dev 검사는 껍데기 속 요소의 key 를
 * 본다 — 없으면 목록을 열 때마다 개발 오버레이에 「Each child in a list should have a
 * unique "key" prop.」 가 뜬다(PO 가 2026-09-28 에 실측으로 겪었다). 화면은 달라지지
 * 않는다 — 이 자리에 오는 요소는 언제나 하나뿐이다.
 * ============================================================================
 */
export function NewQuoteControl({ baseHref }: { baseHref: string }) {
  const [isNewQuoteDialogOpen, setIsNewQuoteDialogOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setIsNewQuoteDialogOpen(true)}
        aria-haspopup="dialog"
        className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-100 dark:text-zinc-900 dark:hover:bg-primary-300"
      >
        새 견적서
      </button>
      {/* 열려 있는 동안만 그린다 — 열 때마다 기본 선택(내자 · 엑셀 전용 아님)으로 돌아온다.
          모달 창은 화면 맨 위 층에 뜨므로 이 자리의 배치에 끼어들지 않는다. */}
      {isNewQuoteDialogOpen && (
        <NewQuoteDialog baseHref={baseHref} onCancel={() => setIsNewQuoteDialogOpen(false)} />
      )}
    </>
  );
}

/**
 * 화면이 받는 프롭에서 **이 조각이 채우는 함수 슬롯**만 뺀 나머지.
 *
 * 🔴 이 타입이 곧 자물쇠다 — `page.tsx` 는 함수 슬롯 넷을 **타입상 넘길 수 없다.**
 * 넘기면 화면이 죽는데 tsc 도 lint 도 그것을 잡지 못하므로(위 머리말), 잡을 수 있는
 * 자리에서 미리 막는다.
 */
type PassThroughProps = Omit<
  ComponentProps<typeof QuoteListScreen>,
  "rowHref" | "intakeHref" | "renderFileBadges" | "renderRowActions"
>;

/**
 * 🔴 화면이 받지 않는 값 하나를 **이 조각이** 받는다.
 *
 * 줄을 눌러 여는 수정 화면과 [미리보기 · PDF] 에 **실어 보낼 접수 건 id**. 기본값 null
 * 이면 지금까지의 `/quotes/{id}` · `/quotes/{id}/print` 그대로다(견적서 목록).
 *
 * 수리 건 상세의 「견적서」 탭이 그 건의 id 를 넘긴다 — 수정 화면의 [취소]와 인쇄 화면의
 * 「돌아가기」가 `/quotes` 가 아니라 **그 탭으로** 돌아오게(domain/quote-new-link.ts).
 * 🔴 함수가 아니라 **id(글자)** 를 받는 까닭: 부르는 쪽이 서버 컴포넌트라 함수는 그
 * 경계를 건너오지 못한다. 글자는 건너온다 — 주소를 **짓는 함수**가 여기 있다.
 */
type QuoteListSlotsProps = PassThroughProps & { quoteLinkRepairCaseId?: string | null };

export default function QuoteListSlots({
  quoteLinkRepairCaseId = null,
  ...props
}: QuoteListSlotsProps) {
  return (
    <QuoteListScreen
      {...props}
      /**
       * 🔴 **줄을 누르면 수정 화면이 열린다** — 지금까지와 같다.
       *
       * null 을 돌려주지 않으므로 요약 줄은 **언제나 링크**다(공용 화면의 `SummaryLine`
       * 은 null 이면 글자로 그린다). PO 는 여기서 `canEdit` 으로 가르지만 이 저장소는
       * 가르지 않았고, 그 동작을 그대로 지킨다 — 바꾸면 눈에 보이는 변경이 된다.
       *
       * ⚠️ 표와 카드 **두 곳 모두** 이 함수로 주소를 만든다(공용 화면이 한 슬롯을 두
       * 곳에 건다) — 한쪽만 바뀌는 고장이 애초에 생기지 않는다.
       */
      rowHref={(row) => quoteEditHref({ quoteId: row.id, repairCaseId: quoteLinkRepairCaseId })}
      /**
       * 🔴 **인수번호를 누르면 그 수리 건 상세로 간다** — 🔴 **같은 사이트 안이라 상대
       * 주소**다. PO 는 설정으로 받은 기준 주소로 **절대 주소**를 짓는다(저쪽
       * `AS_APP_BASE_URL` · `buildRepairCaseUrl`) — 그 화면이 여기 있기 때문이고,
       * 그래서 **그쪽을 베끼지 않는다.**
       *
       * 🔴 `row.repairCaseId` 가 없는 줄에는 화면이 이 함수를 부르지도 않는다 — 공용
       * 화면의 `IntakeLink` 가 먼저 「연결된 접수 건이 없습니다」로 그린다.
       */
      intakeHref={(row) => `/repair-cases/${row.repairCaseId}`}
      /**
       * 🔴 줄마다의 단추 — 차례는 **[미리보기 · PDF] → [Excel 보기] → 곁말** 이고,
       * [삭제]는 공용 화면이 이 슬롯 **다음 줄**에 붙인다(표 · 카드 두 곳 모두).
       * 차례는 사용자가 화면을 보고 지시한 것이라(2026-10-06) 바꾸지 않는다.
       *
       * 🔴 조각 셋이 나란히 서야 해서 조각(fragment)을 돌려준다.
       */
      renderRowActions={(row) => (
        <>
          <PreviewLink row={row} repairCaseId={quoteLinkRepairCaseId} />
          <QuoteArchiveExcelOpenButton row={row} />
          <DocumentUnsupportedNote row={row} />
        </>
      )}
      /**
       * 왼쪽 「견적서」 칸의 파일 딱지 셋 — 「엑셀 전용」 · 「결재 PDF」 · 「엑셀 없음」.
       * 규칙은 quote-attachment-files.ts 의 `quoteListFileBadges`, 그리는 조각은
       * QuoteAttachmentParts.tsx 다(PO 와 같은 이름 · 같은 자리).
       *
       * 🔴 받기를 걷어낸 2026-10-06 부터 「붙은 엑셀이 없다」를 말하는 곳은 **이 딱지
       * 하나**다 — 눌러서 알 길(팝업)이 그때 함께 사라졌다.
       */
      renderFileBadges={(row) => <QuoteFileBadges row={row} />}
    />
  );
}
