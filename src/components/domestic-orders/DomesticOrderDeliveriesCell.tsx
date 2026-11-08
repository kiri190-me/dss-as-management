"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { DATE_INPUT_MAX } from "@/components/common/date-input-limits";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import type { SectionEditConflictError } from "@/components/repair-cases/detail/edit/useSectionEditSubmit";
import {
  inlineEditCellButtonClass,
  inlineEditCellButtonTitle,
  type InlineEditCellNumeric,
  type InlineEditCellWrapping,
} from "@/components/common/inline-edit-cell-button";
import { buildDraftText } from "@/lib/domain/edit-draft-text";
import { generateClientUuid } from "@/lib/client-uuid";
import {
  buildDomesticOrderDueDatesUpdateFields,
  domesticOrderDeliveriesDraftText,
  domesticOrderDueDateEditDraft,
  type DomesticOrderDueDateDraft,
} from "@/lib/domain/domestic-order-cell-edit";
import { DOMESTIC_ORDER_DELIVERED_DATE_NOTE } from "@/lib/domain/delivered-date-link";
import { domesticOrderDueDateRowLabel } from "@/lib/domain/domestic-order-due-date-label";
import { domesticOrderDueDateRowEditBlockReason } from "@/lib/domain/domestic-order-completion-lock";
import type { DomesticOrderListItem } from "@/lib/db/queries/domestic-orders";
import { updateDomesticOrderAction } from "@/lib/server/actions/domestic-orders";
import {
  domesticOrderLinkNotices,
  domesticOrderLinkNoticeText,
} from "./domestic-order-link-notices";

/**
 * ============================================================================
 * 내자 정리 — `납품일`·`납품자` 를 **그 자리에서** 고치는 칸 (2026-11-08)
 * ============================================================================
 * 사용자 요구 원문: 「납기 요청일을 여러줄로 두면, 납품일, 납품자도 그 수에 맞게
 * 설정할 수 있도록 해주고, **납품일을 표에서 직접 바꿀 수 있도록** 해주고」.
 *
 * 칸을 누르면 그 자리에 **회차별 납품 편집**이 열린다 — 회차마다 납기요청일을
 * 이름표로 세우고, 그 옆에 납품일(달력)과 납품자(글자) 입력칸이 선다. 표의 `납품일`
 * 칸과 `납품자` 칸이 **같은 이 부품**을 연다: 둘은 같은 행의 두 값이라 따로 열면
 * 한쪽을 저장하는 동안 다른 쪽이 낡은 값을 들고 있게 된다.
 *
 * ── 🔴 왜 DomesticOrderTextCell 에 넣지 않았는가 ────────────────────────
 * 그 파일의 열한 칸은 값이 **문자열 하나**라 편집칸 하나 · 상태 하나로 끝난다. 이
 * 칸은 값이 **행마다 둘인 목록**이다 — 납기요청일 칸이 2026-09-11 에 같은 까닭으로
 * 따로 선 것과 같다(DomesticOrderDueDatesCell 헤더).
 *
 * ── 🔴 **행을 더하지도 지우지도 않는다** ────────────────────────────────
 * `추가`·`삭제` 단추가 없다. 행은 납기요청일이 만든다 — 그 표의 `due_date` 가 NOT
 * NULL 이라(schema/domestic-order-due-dates.ts) 납기일 없이 납품일만 있는 행은
 * 들어갈 자리가 아예 없고, 여기서 행을 만들려면 **지어낸 납기일**을 함께 넣어야
 * 하는데 그 날짜는 「발주서에 이렇게 적혀 있다」는 그 줄의 기록을 거짓으로 만든다.
 * 🔵 그래서 행이 하나도 없는 줄에서는 입력칸 대신 **먼저 납기요청일을 적으라는
 * 안내**가 선다. 그것이 이 설계에서 사람이 유일하게 걸리는 자리이고, 까닭을 안
 * 적으면 「납품일을 못 적는 고장」으로 읽힌다.
 *
 * ── 납기요청일 칸과 **같은 저장 길** ────────────────────────────────────
 *  ① 줄 전체를 싣고 dueDates 하나만 갈아 끼운다(buildDomesticOrderDueDatesUpdateFields
 *    — 저쪽과 **같은 함수**다). expectedVersion 에 이 줄의 version 을 싣는다.
 *  ② 🔴 **날짜·메모를 보이지 않게 들고 다닌다.** 이 칸은 그 둘을 그리지 않지만,
 *    저장은 받은 목록으로 행을 통째로 다시 만들므로 빼면 그 저장 한 번에 납기요청일과
 *    비고가 사라진다(거울 함정 — 저쪽이 납품 둘을 들고 다니는 것과 같다).
 *  ③ 이 칸의 조작은 위로 퍼지지 않는다 — stopPropagation(저쪽 ③과 같다).
 *
 * ── 🔴 저장은 **수리 건의 실제 출하일까지 바꾼다** ──────────────────────
 * 사용자 결정 2(연동은 양방향). 이 칸은 그 일을 하지 않는다 — 보내는 값은 그대로이고
 * 묶는 일은 저장 통로가 한다(db/mutations/domestic-orders.ts). 이 칸이 하는 일은
 * **못 맞췄다는 답을 받으면 저장 팝업 대신 알림을 띄우게 올려 보내는 것** 하나다.
 * 묶기가 둘이므로(납기요청일 · 납품일) 둘을 **모아서** 올린다
 * (domestic-order-link-notices.ts — 하나만 보면 나머지가 조용히 사라진다).
 *
 * ⚠️ **삭제 단추가 없어도 relative 규율은 그대로다** — sr-only 는 position:absolute
 * 라, 기준이 되는 조상이 없으면 문서 바닥에 자리를 주장해 창 스크롤이 하나 더
 * 생긴다(HANDOFF V-6). 여는 버튼은 공용 값에 relative 가 들어 있다.
 * ============================================================================
 */

const LABEL = "납품";

/**
 * 충돌 상자의 이름표. 담는 것은 **납품 한 덩어리뿐**이다 — 서버로 보내는 fields 는
 * 줄 전체라 그대로 담으면 스물네 칸이 쏟아진다(DomesticOrderTextCell 의 '그 칸
 * 하나만'과 같은 이유).
 */
const DRAFT_LABELS: Readonly<Record<string, string>> = { deliveriesText: "납품일 · 납품자" };

/** 편집칸 아래 회색 안내 — 납기요청일 칸의 같은 상수와 같은 모양이다. */
const cellHintClass = "text-xs text-zinc-500 dark:text-zinc-400";

/** 회차 이름표(「1차 · 납기 2026-01-20 (1차분)」)의 모양. 입력칸보다 약하게 둔다. */
const rowLabelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-300";

/**
 * 편집 중인 한 줄. `key` 는 React key 일 뿐 저장에 실리지 않는다 — 배열 index 를
 * key 로 쓰면 가운데 줄이 바뀌었을 때 남은 입력칸에 엉뚱한 값이 남는다.
 */
type Line = DomesticOrderDueDateDraft & { key: string };

function linesOf(row: DomesticOrderListItem): Line[] {
  // LAN 평문 HTTP 에서도 만들어져야 해서 crypto.randomUUID 를 직접 부르지 않는다
  // (client-uuid.ts — 납기요청일 칸과 같다).
  return domesticOrderDueDateEditDraft(row).map((entry) => ({
    ...entry,
    key: generateClientUuid(),
  }));
}

/**
 * 회차 이름표에 적을 글자 — 「1차 · 납기 2026-01-20 (1차분)」.
 *
 * 🔴 **글자를 여기서 만들지 않는다**(2026-11-08). 이 말이 태어난 자리는 이 파일이지만,
 * 2026-11-08 부터 **같은 회차를 부르는 자리가 넷**이 되었다(승인 요청 창의 드롭다운 ·
 * [승인] 탭의 회차 카드 · 회차별 [완료 처리] 단추 · 이 편집칸). 두 화면이 같은 줄을
 * 다른 말로 부르면 사람은 그것이 같은 회차인지 알 수 없어서, 만드는 자리를
 * domain/domestic-order-due-date-label.ts 하나로 옮겼다 — 글자도 규칙도 그대로다.
 */
function rowLabelOf(line: DomesticOrderDueDateDraft, index: number): string {
  return domesticOrderDueDateRowLabel(index + 1, line);
}

export default function DomesticOrderDeliveriesCell({
  row,
  displayText,
  wrapping,
  numeric,
  onLinkNotice,
}: {
  /** 고칠 줄 **통째로**. 줄 전체를 실어 보내야 하고(헤더 ①) version 도 여기서 나온다. */
  row: DomesticOrderListItem;
  /** 안 고칠 때 보여 줄 것 — 부르는 쪽이 지금까지 그 자리에 그리던 것 그대로다. */
  displayText: ReactNode;
  /** 접는 방식. 표와 카드가 다르게 고른다(DomesticOrderTextCell 의 같은 인자). */
  wrapping: InlineEditCellWrapping;
  /** 표에서만 넘긴다 — 그 `<td>` 의 tabular-nums 가 버튼 안까지 안 내려온다. */
  numeric?: InlineEditCellNumeric;
  /**
   * 🔴 이 줄은 저장됐는데 **수리 건이 못 따라갔을 때**. 띄우는 일은 화면 위쪽이 한다
   * — 이 칸은 표의 `<td>` 안에 살아서, 팝업이 여기서 태어나면 칸의 CSS(가운데·오른쪽
   * 정렬, 줄바꿈 금지)를 그대로 물려받아 글이 한쪽으로 쏠린다(납기요청일 칸과 같은 길).
   */
  onLinkNotice: (message: string) => void;
}) {
  const router = useRouter();
  // 입력칸 id 의 앞머리. 카드 보기에서는 재기 위한 표가 함께 그려져 같은 줄의 이
  // 칸이 둘이 되므로(responsive-list), 인스턴스마다 다른 값이어야 한다.
  const idPrefix = useId();

  const [isEditing, setIsEditing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | SectionEditConflictError | null>(null);
  const [isConflict, setIsConflict] = useState(false);
  /** 검증이 돌려준 납기요청일 오류 — `dueDates`(목록 전체)와 `dueDates.N`(N 번째 줄). */
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});

  const disabled = isSubmitting || isConflict;

  /** 열자마자 첫 회차의 납품일로 간다 — 키보드만으로 쓸 수 있어야 한다. */
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => {
    const key = pendingFocusRef.current;
    if (key === null) return;
    pendingFocusRef.current = null;
    document.getElementById(`${idPrefix}-${key}`)?.focus();
  }, [lines, idPrefix]);

  function openEditor(event: MouseEvent<HTMLButtonElement>) {
    // ③ 위로 퍼지지 않게 막는다(헤더 — 줄 누르기는 없어졌고 그래도 남겨 둔다).
    event.stopPropagation();
    // 열 때마다 서버가 방금 그려 준 행에서 다시 시작한다 — 취소하고 다시 여는
    // 사이에 목록이 새로 그려졌을 수 있다.
    const next = linesOf(row);
    setLines(next);
    pendingFocusRef.current = next[0]?.key ?? null;
    setErrorMessage(null);
    setLineErrors({});
    setIsConflict(false);
    setIsEditing(true);
  }

  function updateLine(key: string, patch: Partial<DomesticOrderDueDateDraft>) {
    setLines((previous) => previous.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setLineErrors({});
    // ② 네 칸을 전부, 차례 그대로 보낸다 — 날짜·메모를 빼면 그 저장이 납기요청일을
    // 지운다(헤더 ②).
    // 🔴 `isCompleted` 는 **서버로 나가지 않는다**(2026-11-08) —
    //    buildDomesticOrderDueDatesUpdateFields 가 네 칸만 옮긴다. 그래도 모양을 맞춰
    //    들고 가는 것은, 여기서 지어낸 값(false 따위)을 넣으면 나중에 이 자리를 보는
    //    사람이 「완료를 보내고 있다」고 읽기 때문이다.
    const drafts: DomesticOrderDueDateDraft[] = lines.map(
      ({ dueDate, note, deliveredDate, deliveredBy, isCompleted }) => ({
        dueDate,
        note,
        deliveredDate,
        deliveredBy,
        isCompleted,
      })
    );
    try {
      const result = await updateDomesticOrderAction({
        id: row.id,
        // ① 줄 전체를 덮어쓰는 저장이라 이 값이 유일한 안전장치다.
        expectedVersion: row.version,
        fields: buildDomesticOrderDueDatesUpdateFields(row, drafts),
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 얼리기 **전에** 방금 적은 값을 붙잡는다 — `최신 정보 다시 불러오기` 를
          // 누르면 사라진다. 담는 것은 납품 한 덩어리뿐이다.
          setIsConflict(true);
          setErrorMessage({
            message: result.message,
            draftText: buildDraftText(
              { deliveriesText: domesticOrderDeliveriesDraftText(drafts) },
              DRAFT_LABELS
            ),
          });
          return;
        }
        // 납기요청일 오류는 그 줄 밑에 붙이고, 위에는 액션이 준 문장을 그대로 쓴다.
        const errors: Record<string, string> = {};
        for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
          if (key === "dueDates" || key.startsWith("dueDates.")) errors[key] = message;
        }
        setLineErrors(errors);
        setErrorMessage(result.message);
        return;
      }

      router.refresh();
      setIsEditing(false);
      // 🔴 「이 줄은 저장됐는데 수리 건이 못 따라갔다」는 **읽어야 하는 글**이다 —
      // 0.5초 저장 팝업으로 띄우면 읽기 전에 사라지고, 그러면 두 화면이 다른 날짜를
      // 보이는 채로 남는다(common/NoticePopup.tsx 머리말).
      const noticeText = domesticOrderLinkNoticeText(domesticOrderLinkNotices(result));
      if (noticeText !== null) {
        onLinkNotice(noticeText);
        return;
      }
      showSavePopup({ message: "납품일·납품자를 저장했습니다.", redirectTo: null });
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    setIsConflict(false);
    setIsEditing(false);
    setErrorMessage(null);
    setLineErrors({});
  }

  if (!isEditing) {
    // 안 고칠 때 보이는 것은 지금까지와 같다 — 그것이 누를 수 있는 것이 되었을
    // 뿐이다. 겉모습과 title 은 다른 칸들과 같은 공용 값이다.
    return (
      <button
        type="button"
        onClick={openEditor}
        title={inlineEditCellButtonTitle(LABEL)}
        className={inlineEditCellButtonClass(wrapping, numeric)}
      >
        {displayText}
        {/* 낭독기 이름은 내용 + 용도(DomesticOrderTextCell 과 같은 방식). */}
        <span className="sr-only">{` ${LABEL} 수정`}</span>
      </button>
    );
  }

  return (
    // ③ 편집 중의 조작이 전부 이 안에 있어 여기서 한 번 막으면 된다.
    <form
      onSubmit={handleSubmit}
      onClick={(event) => event.stopPropagation()}
      noValidate
      className="flex w-96 max-w-full flex-col gap-1.5 whitespace-normal"
    >
      {lines.length === 0 ? (
        // 🔴 행이 없으면 적을 자리가 없다(헤더의 '행을 더하지도 지우지도 않는다').
        //    까닭과 **어디로 가야 하는지**를 함께 적는다 — 까닭 없이 안 열리는 칸은
        //    고장으로 읽힌다.
        <p className={cellHintClass}>
          납기요청일이 없어 납품일을 적을 자리가 없습니다. 먼저 `납기요청일` 칸에서 날짜를
          추가해 주세요. 납품일·납품자는 그 줄마다 하나씩 적습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((line, index) => {
            const errorKey = `dueDates.${index}`;
            // 🔴 **완료 처리된 회차는 납품일·납품자도 못 고친다**(2026-11-08 사용자
            //    결정 — 「1차가 완료되면 1차와 관련된 내용들만 잠기도록」). 판정은
            //    납기요청일 칸과 **같은 함수**이고, 그 함수는 서버의 울타리가 쓰는 바로
            //    그것이다 — 세 곳이 따로 정하면 어딘가 한 곳만 어긋난다.
            // 🔵 **다른 회차는 그대로 고쳐진다.**
            const rowLocked = domesticOrderDueDateRowEditBlockReason({
              rowOrder: index + 1,
              row: line,
            });
            return (
              <li key={line.key} className="flex flex-col gap-1">
                {/* 🔴 어느 회차인지 — 이 칸에서 고치지 않는 값이라 **읽기 전용 글자**다.
                    입력칸으로 열면 한 줄을 두 칸이 고치게 되어, 어느 쪽 저장이 이기는지
                    답할 수 없게 된다. */}
                <span className={rowLabelClass}>{rowLabelOf(line, index)}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* 폭은 감싸는 상자가 정한다 — editInputClass 에 w-full 이 이미
                      있어 같은 문자열에 폭을 덧붙이면 어느 쪽이 이길지 CSS 차례에
                      달린다(납기요청일 칸과 같은 이유). */}
                  <div className="w-40 max-w-full flex-none">
                    <input
                      id={`${idPrefix}-${line.key}`}
                      type="date"
                      // 연도를 네 자리로 묶는다(date-input-limits.ts) — 없으면
                      // 연도 칸이 여섯 자리를 받아 월로 넘어가지 않는다.
                      max={DATE_INPUT_MAX}
                      className={editInputClass}
                      value={line.deliveredDate}
                      // 🔴 완료된 회차는 잠긴다 — 까닭은 title 과 줄 밑 안내로 **글로
                      // 보인다**(납기요청일 칸과 같은 모양·같은 까닭).
                      disabled={disabled || rowLocked !== null}
                      title={rowLocked ?? undefined}
                      aria-label={`납품일 ${index + 1}`}
                      onChange={(event) =>
                        updateLine(line.key, { deliveredDate: event.target.value })
                      }
                    />
                  </div>
                  <div className="min-w-24 flex-1">
                    <input
                      type="text"
                      className={editInputClass}
                      value={line.deliveredBy}
                      disabled={disabled || rowLocked !== null}
                      title={rowLocked ?? undefined}
                      placeholder="납품자"
                      aria-label={`납품자 ${index + 1}`}
                      autoComplete="off"
                      onChange={(event) =>
                        updateLine(line.key, { deliveredBy: event.target.value })
                      }
                    />
                  </div>
                </div>
                {/* 🔴 **왜 안 열리는지**를 늘 보이는 한 줄로 적는다(2026-11-08).
                    title 은 마우스를 올려야 보이고, 키보드만 쓰는 사람에게는 이 줄이
                    유일한 설명이다(납기요청일 칸과 같은 모양). */}
                {rowLocked !== null && <p className={cellHintClass}>{rowLocked}</p>}
                {lineErrors[errorKey] && <p className={editErrorClass}>{lineErrors[errorKey]}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {/* 목록 전체가 잘못된 경우(울타리에 걸린 저장 등)의 자리. */}
      {lineErrors.dueDates && <p className={editErrorClass}>{lineErrors.dueDates}</p>}
      {/* 이 칸이 수리 건과 어떻게 묶이는지 — 저장하고 나서 알게 되면 늦다. */}
      <p className={cellHintClass}>{DOMESTIC_ORDER_DELIVERED_DATE_NOTE}</p>
      <EditSectionActions
        isSubmitting={isSubmitting}
        isConflict={isConflict}
        submitError={errorMessage}
        onCancel={() => setIsEditing(false)}
        onReloadAfterConflict={reloadAfterConflict}
      />
    </form>
  );
}
