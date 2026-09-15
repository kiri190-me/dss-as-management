"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { newQuoteHrefWithStart } from "@/lib/domain/quote-new-link";
import { QUOTE_KINDS, quoteKindLabels, type QuoteKind } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * [새 견적서] 팝업 — 견적서 종류 · 엑셀 전용 여부를 먼저 고른다 (견적서 ⑤)
 * ============================================================================
 * 목록의 [새 견적서]가 곧바로 작성 화면으로 가지 않고 이 창을 띄운다. 고른 두 값은
 * [만들기]가 가는 주소에 덧붙고(domain/quote-new-link.ts 의 newQuoteHrefWithStart), 작성
 * 화면은 그 값으로 **처음부터** 채워진 채 열린다(quote-new-start.ts). 폼에서도 두 값은 그대로
 * 바꿀 수 있다 — 이 창은 처음 값만 정한다.
 *
 * 기본 선택은 **내자 견적서 · 엑셀 전용 아님** — 지금까지 [새 견적서]가 열던 그 폼이다. 창은
 * 열려 있는 동안만 그려지므로 열 때마다 이 기본으로 돌아온다.
 *
 * `baseHref` 는 부르는 쪽이 넘긴 주소 그대로다 — 수리 건의 「견적서」 탭이면 인수번호 · 건 id 가
 * 이미 실려 있고, [만들기]는 그 둘을 건드리지 않고 두 값만 덧붙인다.
 *
 * ── 창의 방식은 이 저장소의 확인창과 같다 ────────────────────────────────
 * native `<dialog>` + `showModal()` (QuoteAttachmentParts · ApprovalActionDialog 와 같다):
 *  · Esc — 브라우저의 cancel 을 막고 [취소]와 같은 길(onCancel)로 닫는다. 부모가 창을 치운다.
 *    브라우저가 cancel 없이 창을 닫는 경우(연달아 누른 Esc 등)에도 close 로 같은 길을 탄다 —
 *    안 그러면 창은 닫혔는데 부모는 열린 줄 알아 [새 견적서]를 다시 눌러도 안 뜬다.
 *  · 바깥(어두운 배경) 누름 — [취소]. 안쪽 칸이 창을 꽉 채워서, 창 자신이 받은 누름은 배경뿐이다.
 *  · 포커스 — showModal 이 창 안에 가두고, 연 뒤 골라 둔 종류(라디오)로 옮긴다. 닫히면 브라우저가
 *    누른 [새 견적서] 단추로 돌려준다.
 *  · 폭 — `w-full max-w-md` 에 브라우저 기본 여백이 붙어, 폭 400px 에서도 양옆이 남는다.
 *
 * ── [만들기]는 링크다 ───────────────────────────────────────────────────
 * 하는 일이 「고른 값을 실은 주소로 가기」 하나라, 원래의 [새 견적서]처럼 Link 로 둔다.
 * `/quotes/new` 는 매번 서버가 그리는 화면이라 미리 받아 두지 않는다(prefetch 끔).
 * ============================================================================
 */

export const NEW_QUOTE_DIALOG_TITLE_ID = "new-quote-dialog-title";
export const NEW_QUOTE_EXCEL_ONLY_NOTE_ID = "new-quote-excel-only-note";
/** 종류 라디오 묶음의 이름 — 창이 한 번에 하나뿐이라 고정이다. 열 때 포커스도 이것으로 찾는다. */
const KIND_RADIO_NAME = "new-quote-kind";

/**
 * 엑셀 전용 설명 한 줄. 폼의 스위치(QuoteAttachmentParts 의 ExcelOnlySwitch)와 뜻이 같다 — 손으로
 * 만든 엑셀로 발행하고, 부품 · 작업비 구역을 쓰지 않고, 공급가액을 직접 적는다.
 */
export const NEW_QUOTE_EXCEL_ONLY_NOTE =
  "손으로 만든 엑셀로 발행합니다 — 부품 · 작업비를 쓰지 않고 공급가액을 직접 적습니다.";

/** 창을 연 사람에게 기본으로 골라 두는 종류. */
export const NEW_QUOTE_DEFAULT_KIND: QuoteKind = "DOMESTIC";

export default function NewQuoteDialog({
  baseHref,
  onCancel,
}: {
  /** [만들기]가 두 값을 덧붙일 주소 — 목록의 `newQuoteHref` 그대로. */
  baseHref: string;
  /** [취소] · Esc · 바깥 누름. 부모가 창을 치운다(여러 번 불려도 괜찮아야 한다). */
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<QuoteKind>(NEW_QUOTE_DEFAULT_KIND);
  const [excelOnly, setExcelOnly] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 그려지는 순간 모달로 연다. 닫기는 부모가 이 창을 치우는 것이고, 치울 때 닫는다.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLInputElement>(`input[name="${KIND_RADIO_NAME}"]:checked`)?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <NewQuoteDialogView
      dialogRef={dialogRef}
      baseHref={baseHref}
      kind={kind}
      excelOnly={excelOnly}
      onKindChange={setKind}
      onExcelOnlyChange={setExcelOnly}
      onCancel={onCancel}
    />
  );
}

export type NewQuoteDialogViewProps = {
  dialogRef?: RefObject<HTMLDialogElement | null>;
  baseHref: string;
  kind: QuoteKind;
  excelOnly: boolean;
  onKindChange: (kind: QuoteKind) => void;
  onExcelOnlyChange: (excelOnly: boolean) => void;
  onCancel: () => void;
};

/**
 * 창의 그림 — 상태를 갖지 않는다(훅이 없다). 고른 값과 콜백을 받아 그리기만 해서, 무엇을 누르면
 * 무엇이 불리는지를 시험이 그대로 따라가 볼 수 있다(NewQuoteDialog.test.tsx).
 */
export function NewQuoteDialogView({
  dialogRef,
  baseHref,
  kind,
  excelOnly,
  onKindChange,
  onExcelOnlyChange,
  onCancel,
}: NewQuoteDialogViewProps) {
  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={NEW_QUOTE_DIALOG_TITLE_ID}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <div className="flex flex-col gap-4 p-4">
        <div>
          <h2 id={NEW_QUOTE_DIALOG_TITLE_ID} className="text-base font-semibold">
            새 견적서
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            고른 값으로 채워진 작성 화면이 열립니다. 작성 화면에서도 바꿀 수 있습니다.
          </p>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">견적서 종류</legend>
          <div className="grid grid-cols-2 gap-2">
            {QUOTE_KINDS.map((value) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  kind === value
                    ? "border-primary-900 font-medium dark:border-primary-100"
                    : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                <input
                  type="radio"
                  name={KIND_RADIO_NAME}
                  value={value}
                  checked={kind === value}
                  onChange={() => onKindChange(value)}
                  className="h-4 w-4 shrink-0"
                />
                {quoteKindLabels[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={excelOnly}
            onChange={(event) => onExcelOnlyChange(event.target.checked)}
            aria-describedby={NEW_QUOTE_EXCEL_ONLY_NOTE_ID}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="min-w-0">
            <span className="font-medium">엑셀 전용 견적서</span>
            <span id={NEW_QUOTE_EXCEL_ONLY_NOTE_ID} className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
              {NEW_QUOTE_EXCEL_ONLY_NOTE}
            </span>
          </span>
        </label>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <Link
            href={newQuoteHrefWithStart(baseHref, { kind, excelOnly })}
            prefetch={false}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-100 dark:text-zinc-900 dark:hover:bg-primary-300"
          >
            만들기
          </Link>
        </div>
      </div>
    </dialog>
  );
}
