"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { FileDropZone } from "@/components/common/FileDropZone";
import { newQuoteHrefWithStart } from "@/lib/domain/quote-new-link";
import { QUOTE_KINDS, quoteKindLabels, type QuoteKind } from "@/lib/validation/quote-input";
import { putNewQuoteExcelHandoff, type NewQuoteExcelHandoff } from "./new-quote-excel-handoff";
import {
  quoteExcelChosenSheetLine,
  quoteExcelSheetIndexForKind,
  quoteExcelSheetLine,
  quoteExcelSheetsHeadline,
  quoteExcelSuggestedKind,
} from "./new-quote-excel-sheets";
import { QUOTE_ATTACHMENT_SLOTS, checkQuoteAttachmentFile } from "./quote-attachment-files";
import { QUOTE_EXCEL_READING_TEXT } from "./quote-excel-autofill";
import { createLatestQuoteExcelReader, type QuoteExcelSheetInfo } from "./quote-excel-parse";
import { QuoteAttachmentFilePicker } from "./QuoteAttachmentParts";

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
 * ── 엑셀 전용이면 여기서 엑셀을 올린다 (견적서 ⑤b) ────────────────────────
 * [엑셀 전용 견적서]를 켜면 **이 창 안에** 파일 자리가 나타난다(끌어다 놓기 · 고르기 둘 다).
 * 고른 엑셀은 곧바로 읽기 통로로 보내(quote-excel-parse.ts) **무엇이 들어 있는지** 알린다:
 *  · 내자 · OH 가 모두 들어 있으면 어느 것으로 저장할지 **묻는다** — 하나로 줄이지 않는다.
 *  · 한 종류만 들어 있으면 종류 라디오를 그것으로 **맞춰 준다**(잠그지 않는다 — 바꿀 수 있다).
 *  · 매쳐 양식은 종류가 정해지지 않는다 — 있는 그대로 알리고 사람이 고른다.
 *  · 알아본 시트가 없으면 통로가 준 거절 문구를 그대로 보인다.
 * 무엇이 들어 있나 · 어느 탭을 읽나의 규칙은 전부 new-quote-excel-sheets.ts 한 곳이다.
 *
 * 🔴 형식 · 크기는 폼의 「수기 견적서 엑셀」 칸과 **같은 함수**(checkQuoteAttachmentFile)로
 * 본다 — 두 길이 갈리면 팝업으로만 이상한 파일이 들어간다. 🔴 읽지 못해도 파일은 그대로
 * 나른다(붙이기와 읽기는 따로 간다 — 폼과 같은 불변식).
 *
 * ── [만들기]는 링크다. 파일은 인계 상자로 간다 ────────────────────────────
 * 하는 일이 「고른 값을 실은 주소로 가기」 하나라, 원래의 [새 견적서]처럼 Link 로 둔다.
 * `/quotes/new` 는 매번 서버가 그리는 화면이라 미리 받아 두지 않는다(prefetch 끔).
 * 🔴 **파일은 주소에 못 싣는다.** 그 이동은 앱 안에서의 이동이라 메모리가 살아남으므로,
 * 누르는 순간 파일과 고른 시트 차례를 작은 상자에 담는다(new-quote-excel-handoff.ts).
 * 담을 것이 없으면 **상자를 비우며** 간다 — 고르다 만 파일이 따라가지 않게.
 *
 * ── 창의 방식은 이 저장소의 확인창과 같다 ────────────────────────────────
 * native `<dialog>` + `showModal()` (QuoteAttachmentParts · ApprovalActionDialog 와 같다):
 *  · Esc — 브라우저의 cancel 을 막고 [취소]와 같은 길(onCancel)로 닫는다. 부모가 창을 치운다.
 *    브라우저가 cancel 없이 창을 닫는 경우(연달아 누른 Esc 등)에도 close 로 같은 길을 탄다 —
 *    안 그러면 창은 닫혔는데 부모는 열린 줄 알아 [새 견적서]를 다시 눌러도 안 뜬다.
 *    🔴 단 close 는 **그 순간 창이 정말 닫혀 있을 때만** 취소다(closeEventMeansCancel). 정리의
 *    close() 는 close 이벤트를 나중 작업으로 쌓는데, 개발 모드 StrictMode 는 effect 를 「실행 →
 *    정리 → 다시 실행」한다 — 다시 연 창에 늦은 close 가 도착한다. 그것을 취소로 받았더니 창이
 *    뜨자마자 사라져 [새 견적서]가 「안 눌린다」로 보였다(2026-09-16 사용자 신고, 프로덕션은 멀쩡).
 *  · 바깥(어두운 배경) 누름 — [취소]. 안쪽 칸이 창을 꽉 채워서, 창 자신이 받은 누름은 배경뿐이다.
 *  · 포커스 — showModal 이 창 안에 가두고, 연 뒤 골라 둔 종류(라디오)로 옮긴다. 닫히면 브라우저가
 *    누른 [새 견적서] 단추로 돌려준다.
 *  · 폭 — `w-full max-w-md` 에 브라우저 기본 여백이 붙어, 폭 400px 에서도 양옆이 남는다.
 * ============================================================================
 */

export const NEW_QUOTE_DIALOG_TITLE_ID = "new-quote-dialog-title";
export const NEW_QUOTE_EXCEL_ONLY_NOTE_ID = "new-quote-excel-only-note";
/** 종류 라디오 묶음의 이름 — 창이 한 번에 하나뿐이라 고정이다. 열 때 포커스도 이것으로 찾는다. */
const KIND_RADIO_NAME = "new-quote-kind";

/** 팝업이 받는 파일 칸 = 폼의 「수기 견적서 엑셀」 칸. 이름표 · 확장자 · accept 를 그대로 쓴다. */
const EXCEL_CATEGORY = "QUOTE_EXCEL" as const;
const EXCEL_SLOT = QUOTE_ATTACHMENT_SLOTS.find((slot) => slot.category === EXCEL_CATEGORY);
/** 아래 셋의 `??` 는 닿지 않는 자리다 — 위 분류가 칸 목록에 늘 있다(quote-attachment-files.ts). */
export const NEW_QUOTE_EXCEL_LABEL = EXCEL_SLOT?.label ?? "수기 견적서 엑셀";
const NEW_QUOTE_EXCEL_ACCEPT = EXCEL_SLOT?.accept ?? ".xlsx";
const NEW_QUOTE_EXCEL_EXTENSIONS = EXCEL_SLOT?.extensions.join(" · ") ?? "xlsx";

/** 아직 고르지 않았을 때 파일 자리에 보이는 한 줄. */
export const NEW_QUOTE_EXCEL_PICK_NOTE =
  "아직 고른 파일이 없습니다 — 올리면 어떤 견적서가 들어 있는지 알려 드립니다. 나중에 작성 화면에서 붙여도 됩니다.";

/**
 * 엑셀 전용 설명 한 줄. 폼의 스위치(QuoteAttachmentParts 의 ExcelOnlySwitch)와 뜻이 같다 —
 * 손으로 만든 엑셀로 발행하고, 부품 · 작업비 구역을 쓰지 않고, 공급가액을 직접 적는다.
 */
export const NEW_QUOTE_EXCEL_ONLY_NOTE =
  "손으로 만든 엑셀로 발행합니다 — 부품 · 작업비를 쓰지 않고 공급가액을 직접 적습니다.";

/** 창을 연 사람에게 기본으로 골라 두는 종류. */
export const NEW_QUOTE_DEFAULT_KIND: QuoteKind = "DOMESTIC";

/** 고른 엑셀을 읽는 동안 · 읽고 난 뒤의 상태. 고르기 전에는 null 이다. */
export type NewQuoteExcelReadState =
  | { status: "reading" }
  /** 알아본 시트 전부(빈 배열일 수 있다). 🔴 filled 로 줄을 빼지 않는다. */
  | { status: "read"; sheets: QuoteExcelSheetInfo[] }
  /** 못 읽은 까닭 — 통로가 준 문장, 또는 형식 · 크기 거절. */
  | { status: "failed"; reason: string };

/** 모달로 여닫는 데 쓰는 것만 — 시험이 가짜 창으로 흉내 낼 수 있게. HTMLDialogElement 가 그대로 맞는다. */
export type ModalDialogLike = { open: boolean; showModal(): void; close(): void };

/**
 * 모달로 열고, 치울 때 닫는 정리 함수를 돌려준다(아래 useEffect 가 그대로 돌려준다).
 *
 * 🔴 정리의 close() 는 close 이벤트를 **나중 작업으로** 쌓는다. 개발 모드 StrictMode(와 Fast
 * Refresh)는 effect 를 「실행 → 정리 → 다시 실행」하므로, 다시 연 **뒤에** 그 늦은 close 가
 * 도착한다 — 받는 쪽은 closeEventMeansCancel 로 거른다.
 */
export function openAsModal(dialog: ModalDialogLike): () => void {
  if (!dialog.open) dialog.showModal();
  return () => {
    if (dialog.open) dialog.close();
  };
}

/**
 * close 이벤트가 [취소]인가 — **그 순간 창이 실제로 닫혀 있을 때만**이다.
 *  · 브라우저가 cancel 없이 창을 닫았다(연달아 누른 Esc 등) → 닫혀 있다 → 취소(부모가 치운다).
 *  · 🔴 정리에서 닫은 뒤 다시 연 창에 늦게 도착한 close(개발 모드 StrictMode) → 열려 있다 → 무시.
 *    이것을 취소로 받으면 창이 뜨자마자 사라진다.
 *
 * 「정리에서 닫았음을 표시해 두고 그 한 번만 무시」보다 이쪽을 골랐다: 부모 상태가 따라야 할
 * 것은 「창이 지금 열려 있는가」 하나라 그것을 그대로 본다. 표시를 두면 몇 번 겹칠지(StrictMode ·
 * Fast Refresh) 세야 하고, 셈이 어긋나면 진짜 닫힘을 삼키거나 늦은 close 를 받는다.
 */
export function closeEventMeansCancel(dialog: Pick<ModalDialogLike, "open">): boolean {
  return !dialog.open;
}

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
  /** 엑셀 전용일 때 고른 수기 견적서 엑셀. 형식 · 크기를 지난 것만 들어온다. */
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excel, setExcel] = useState<NewQuoteExcelReadState | null>(null);
  /** 두 번 고르면 마지막 파일의 결과만 쓴다 — 늦게 온 옛 결과는 null 로 온다(quote-excel-parse.ts). */
  const [excelReader] = useState(() => createLatestQuoteExcelReader());
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 그려지는 순간 모달로 연다. 닫기는 부모가 이 창을 치우는 것이고, 치울 때 닫는다(openAsModal).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const closeOnUnmount = openAsModal(dialog);
    dialog.querySelector<HTMLInputElement>(`input[name="${KIND_RADIO_NAME}"]:checked`)?.focus();
    return closeOnUnmount;
  }, []);

  /** 엑셀 전용을 끄면 파일 자리가 사라진다 — 읽던 결과를 버리고 고른 파일도 놓는다. */
  function changeExcelOnly(next: boolean) {
    setExcelOnly(next);
    if (next) return;
    excelReader.cancel();
    setExcelFile(null);
    setExcel(null);
  }

  /** 끌어다 놓거나 골랐다 — 두 길이 이 함수 하나를 탄다. */
  function pickExcel(file: File | undefined) {
    if (!file) return;
    // 🔴 폼의 엑셀 칸과 같은 판정이다(머리말). 거절된 파일은 들지 않는다 — 나르면 폼도 거절한다.
    const rejection = checkQuoteAttachmentFile(file, EXCEL_CATEGORY);
    if (rejection !== null) {
      excelReader.cancel();
      setExcelFile(null);
      setExcel({ status: "failed", reason: `${file.name}: ${rejection}` });
      return;
    }
    setExcelFile(file);
    setExcel({ status: "reading" });
    void readPickedExcel(file);
  }

  /**
   * 고른 엑셀에 **무엇이 들어 있는지** 읽는다. 시트를 지정하지 않는 첫 읽기라, 통로는 알아본
   * 시트 전부를 `sheets` 로 준다. 🔴 못 읽어도 파일은 들고 있는다 — 붙이기는 그대로다.
   */
  async function readPickedExcel(file: File) {
    const result = await excelReader.read(file);
    if (result === null) return;
    if (!result.ok) {
      setExcel({ status: "failed", reason: result.reason });
      return;
    }
    setExcel({ status: "read", sheets: result.sheets });
    // 한 종류만 들어 있으면 라디오를 맞춰 준다. 🔴 잠그지 않는다 — 사람이 바꿀 수 있다.
    const suggested = quoteExcelSuggestedKind(result.sheets);
    if (suggested !== null) setKind(suggested);
  }

  const sheets = excel?.status === "read" ? excel.sheets : [];

  /**
   * [만들기]가 상자에 담을 것. 엑셀 전용이고 파일이 있을 때만이고, 시트 차례는 **지금 골라 둔
   * 종류**의 것이다 — 라디오를 바꾸면 따라 바뀐다. 담을 것이 없으면 null(상자를 비운다).
   */
  const handoff: NewQuoteExcelHandoff | null =
    excelOnly && excelFile !== null
      ? { file: excelFile, sheetIndex: quoteExcelSheetIndexForKind(sheets, kind) }
      : null;

  return (
    <NewQuoteDialogView
      dialogRef={dialogRef}
      baseHref={baseHref}
      kind={kind}
      excelOnly={excelOnly}
      excelFile={excelFile}
      excel={excel}
      handoff={handoff}
      onKindChange={setKind}
      onExcelOnlyChange={changeExcelOnly}
      onPickExcel={pickExcel}
      onCancel={onCancel}
    />
  );
}

export type NewQuoteDialogViewProps = {
  dialogRef?: RefObject<HTMLDialogElement | null>;
  baseHref: string;
  kind: QuoteKind;
  excelOnly: boolean;
  /** 고른 엑셀 — 이름만 보인다(시험은 흉내 낸 객체를 넘긴다). */
  excelFile: { name: string } | null;
  excel: NewQuoteExcelReadState | null;
  /** [만들기]가 인계 상자에 담을 것. null 이면 상자를 **비우고** 간다. */
  handoff: NewQuoteExcelHandoff | null;
  onKindChange: (kind: QuoteKind) => void;
  onExcelOnlyChange: (excelOnly: boolean) => void;
  onPickExcel: (file: File | undefined) => void;
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
  excelFile,
  excel,
  handoff,
  onKindChange,
  onExcelOnlyChange,
  onPickExcel,
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
      onClose={(event) => {
        // 늦게 도착한 close(정리 뒤 다시 연 창)는 취소가 아니다 — closeEventMeansCancel 머리말.
        if (closeEventMeansCancel(event.currentTarget)) onCancel();
      }}
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

        {/*
          엑셀 전용일 때만 나타나는 파일 자리. 떨군 파일은 고르기 단추와 **같은 onPickExcel** 을
          타므로 판정(checkQuoteAttachmentFile)도 같다. 파일은 하나라 multiple 은 false 다 —
          여럿을 놓으면 공통 조각이 거절하고 알린다.
        */}
        {excelOnly ? (
          <FileDropZone
            name="new-quote-excel"
            multiple={false}
            hint={`${NEW_QUOTE_EXCEL_LABEL} 하나를 여기에 놓으세요`}
            onFiles={(files) => onPickExcel(files[0])}
            className="flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{NEW_QUOTE_EXCEL_LABEL}</span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {NEW_QUOTE_EXCEL_EXTENSIONS} · 20MB 까지
              </span>
            </div>

            {excelFile ? (
              <p className="min-w-0 break-all text-sm text-zinc-800 dark:text-zinc-200">{excelFile.name}</p>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{NEW_QUOTE_EXCEL_PICK_NOTE}</p>
            )}

            <div className="flex flex-wrap gap-1.5">
              <QuoteAttachmentFilePicker
                accept={NEW_QUOTE_EXCEL_ACCEPT}
                label={excelFile ? "다른 파일로" : "파일 고르기"}
                ariaLabel={`${NEW_QUOTE_EXCEL_LABEL} ${excelFile ? "다른 파일로" : "파일 고르기"}`}
                disabled={false}
                onFile={onPickExcel}
              />
            </div>

            <NewQuoteExcelNotice excel={excel} kind={kind} />
          </FileDropZone>
        ) : null}

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
            // 🔴 파일은 주소에 못 싣는다 — 상자에 담아 건넨다(머리말). 담을 것이 없으면 비운다.
            onClick={() => putNewQuoteExcelHandoff(handoff)}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-100 dark:text-zinc-900 dark:hover:bg-primary-300"
          >
            만들기
          </Link>
        </div>
      </div>
    </dialog>
  );
}

/**
 * 고른 엑셀에 무엇이 들어 있나 — 읽는 중 한 줄 · 못 읽은 까닭 · 알아본 시트 목록.
 * 🔴 문장과 판정은 전부 new-quote-excel-sheets.ts 에 있다. 여기는 그리기만 한다.
 */
export function NewQuoteExcelNotice({
  excel,
  kind,
}: {
  excel: NewQuoteExcelReadState | null;
  kind: QuoteKind;
}) {
  if (excel === null) return null;

  if (excel.status === "reading") {
    return (
      <p role="status" className="text-xs text-zinc-700 dark:text-zinc-300">
        {QUOTE_EXCEL_READING_TEXT}
      </p>
    );
  }

  if (excel.status === "failed") {
    return (
      <p role="alert" className="break-all text-xs text-red-600 dark:text-red-400">
        {excel.reason}
      </p>
    );
  }

  const chosen = quoteExcelChosenSheetLine(excel.sheets, kind);
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100">
      <p className="text-xs font-medium">{quoteExcelSheetsHeadline(excel.sheets)}</p>
      {/* 🔴 알아본 시트는 늘 다 싣는다 — filled 로 줄을 빼지 않는다(new-quote-excel-sheets.ts). */}
      {excel.sheets.length > 0 ? (
        <ul className="mt-1 list-disc pl-4">
          {excel.sheets.map((sheet) => (
            <li key={sheet.index} className="break-all text-xs">
              {quoteExcelSheetLine(sheet)}
            </li>
          ))}
        </ul>
      ) : null}
      {chosen ? <p className="mt-1 text-xs">{chosen}</p> : null}
    </div>
  );
}
