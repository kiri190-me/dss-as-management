"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
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
  domesticOrderDueDateBorrowHint,
  domesticOrderDueDateEditDraft,
  domesticOrderDueDatesDraftText,
  type DomesticOrderDueDateDraft,
} from "@/lib/domain/domestic-order-cell-edit";
import { DUE_DATE_FROM_REPAIR_CASE_LABEL } from "@/lib/domain/requested-due-date-link";
import type { DomesticOrderListItem } from "@/lib/db/queries/domestic-orders";
import { updateDomesticOrderAction } from "@/lib/server/actions/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 — `납기요청일` 칸을 **그 자리에서** 고치는 칸 (2026-09-11)
 * ============================================================================
 * 한 줄에 날짜가 여럿(분할 납품)이고 날짜마다 메모가 붙는다. 칸을 누르면 그
 * 자리에 **날짜 목록 편집**이 열린다 — 날짜 추가 · 삭제 · 고치기, 저장 · 취소.
 * `줄 수정` 폼의 납기요청일 묶음과 같은 모양(날짜 + 메모 + 삭제, 아래 `추가`)이고
 * 같은 저장 길을 탄다.
 *
 * ── 왜 DomesticOrderTextCell 에 넣지 않았는가 ───────────────────────────
 * 그 파일의 열두 칸은 값이 **문자열 하나**라 편집칸 하나 · 상태 하나로 끝난다.
 * 이 칸은 값이 **목록**이라 줄마다 key · 추가한 줄로 포커스 옮기기 · 줄 번호가
 * 붙은 오류(`dueDates.N`)가 따로 있다. 한 파일에 섞으면 열두 칸의 가장 위험한
 * 규칙(① 줄 전체를 싣는다 ② 계산된 값을 만지지 않는다 ③ 위로 퍼지지 않게
 * 막는다)이 목록 분기 사이에 묻힌다. 그 셋은 이 파일에도 **똑같이** 걸려 있다:
 *
 *  ① 줄 전체를 싣고 dueDates 하나만 갈아 끼운다 — 무엇을 싣는지는 도메인이
 *    정한다(buildDomesticOrderDueDatesUpdateFields — 칸 편집과 **같은 목록**을
 *    쓴다). expectedVersion 에 이 줄의 version 을 싣는다.
 *  ② 🔴 **빌려 온 날짜로 편집 목록을 채우지 않는다.** 이 줄에 날짜가 없으면
 *    표에는 연결된 수리 건의 고객 요청 납기일이 `수리 건 요청일` 표시와 함께
 *    보이는데, 그 날짜를 목록에 미리 넣으면 저장만 눌러도 수리 건의 값이 이 줄의
 *    납기요청일로 굳는다(HANDOFF V-3 · V-5). 목록은 도메인의
 *    domesticOrderDueDateEditDraft 로만 채운다 — 그 함수가 받는 타입에 수리 건의
 *    날짜가 없다. 대신 빈 목록으로 열리는 순간이 생기므로 편집칸 아래에 무엇이
 *    보이게 되는지 한 줄로 적는다(아래 BorrowHint).
 *  ③ 줄 전체가 `줄 수정` 폼을 여는 클릭 대상이라, 여는 버튼과 편집 중의 폼
 *    전체에 stopPropagation 을 건다(DomesticOrderTextCell 헤더 ③과 같다).
 *
 * ── 검증은 다시 하지 않는다 ─────────────────────────────────────────────
 * 빈 줄 빼기 · 메모만 적은 줄 거절 · 없는 날짜 거절 · 스무 개 상한은 검증 한
 * 곳이 한다(validation/domestic-order-input.ts 의 normalizeDueDates) — `줄 수정`
 * 폼과 같은 관문이다. 이 파일은 편집 중인 목록을 **차례 그대로, 빈 줄까지**
 * 보내고, 돌아온 `dueDates.N` 오류를 N 번째 줄 밑에 붙인다. 빈 줄을 미리 걸러
 * 내면 N 이 화면의 줄 번호와 어긋나 오류가 엉뚱한 줄에 붙는다.
 *
 * ── 표를 흔들지 않는다 ──────────────────────────────────────────────────
 * 안 고칠 때 보이는 것은 지금까지와 한 글자도 다르지 않다(부르는 쪽이 넘기는
 * displayText 그대로 — 표는 날짜 한 줄에 하나와 `수리 건 요청일` 표시, 카드는
 * 글자). 칸이 커지는 것은 **편집하는 동안뿐**이고, 폭은 폼의 w-96 이 정한다.
 * `<tr>` 의 whitespace-nowrap 을 폼에서 끊는 것(whitespace-normal)은
 * DomesticOrderTextCell 과 같은 이유다 — 오류 문구가 한 줄로 뻗어 표를 옆으로
 * 밀지 않게.
 *
 * ⚠️ **삭제 버튼의 relative 를 떼지 말 것.** 버튼 안 sr-only 는 position:absolute
 * 라, 기준이 되는 조상이 없으면 문서 바닥에 자리를 주장해 창 스크롤이 하나 더
 * 생긴다(HANDOFF V-6 — 이 화면이 405px 을 굴렸던 바로 그 고장). 여는 버튼은
 * 공용 값(inline-edit-cell-button.ts)에 relative 가 들어 있다.
 * ============================================================================
 */

const LABEL = "납기요청일";

/**
 * 충돌 상자의 이름표. 담는 것은 **납기요청일 한 덩어리뿐**이다 — 서버로 보내는
 * fields 는 줄 전체라 그대로 담으면 스물네 칸이 쏟아진다(DomesticOrderTextCell 의
 * '그 칸 하나만'과 같은 이유). 키 이름은 `줄 수정` 폼의 것과 같다.
 */
const DRAFT_LABELS: Readonly<Record<string, string>> = { dueDatesText: LABEL };

/** 편집칸 아래 회색 안내 — DomesticOrderTextCell 의 cellHintClass 와 같은 모양. */
const cellHintClass = "text-xs text-zinc-500 dark:text-zinc-400";

/** `삭제` · `추가` 버튼의 모양. `줄 수정` 폼의 같은 두 버튼과 같다. */
const smallButtonClass =
  "rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-700";

/**
 * 편집 중인 한 줄. `key` 는 React key 일 뿐 저장에 실리지 않는다 — 배열 index 를
 * key 로 쓰면 가운데 줄을 지웠을 때 남은 입력칸에 엉뚱한 값이 남는다(`줄 수정`
 * 폼의 DueDateDraft 와 같은 이유).
 */
type Line = DomesticOrderDueDateDraft & { key: string };

/**
 * 편집을 열 때의 목록. **이 줄에 적힌 날짜만**이다(파일 헤더 ② — 도메인
 * 함수가 받는 타입에 수리 건의 날짜가 없다).
 */
function linesOf(row: DomesticOrderListItem): Line[] {
  // LAN 평문 HTTP 에서도 만들어져야 해서 crypto.randomUUID 를 직접 부르지
  // 않는다(client-uuid.ts — `줄 수정` 폼과 같다).
  return domesticOrderDueDateEditDraft(row).map((entry) => ({ ...entry, key: generateClientUuid() }));
}

/**
 * 목록을 비워 두면 무엇이 보이게 되는지. 연결된 수리 건에 고객 요청 납기일이 없으면
 * 그리지 않는다 — 비워 두어도 보일 것이 없는데 "보입니다"라고 하면 거짓말이다.
 * 판정은 도메인이 목록과 같은 규칙으로 한다(domesticOrderDueDateBorrowHint).
 */
function BorrowHint({ row }: { row: DomesticOrderListItem }) {
  const borrowed = domesticOrderDueDateBorrowHint(row);
  if (borrowed === null) return null;
  return (
    <p className={cellHintClass}>
      연결된 수리 건의 고객 요청 납기일: {borrowed}
      <br />
      목록을 비워 두면 이 날짜가 ‘{DUE_DATE_FROM_REPAIR_CASE_LABEL}’ 표시와 함께 보입니다.
    </p>
  );
}

export default function DomesticOrderDueDatesCell({
  row,
  displayText,
  wrapping,
  numeric,
}: {
  /** 고칠 줄 **통째로**. 줄 전체를 실어 보내야 하고(파일 헤더 ①) version 도 여기서 나온다. */
  row: DomesticOrderListItem;
  /**
   * 안 고칠 때 보여 줄 것 — 부르는 쪽이 지금까지 그 자리에 그리던 것 그대로다.
   * 표는 날짜 줄들과 `수리 건 요청일` 표시(마디), 카드는 줄바꿈이 섞인 글자다.
   */
  displayText: ReactNode;
  /** 접는 방식. 표와 카드가 다르게 고른다(DomesticOrderTextCell 의 같은 인자). */
  wrapping: InlineEditCellWrapping;
  /** 표에서만 넘긴다 — 그 `<td>` 의 tabular-nums 가 버튼 안까지 안 내려온다. */
  numeric?: InlineEditCellNumeric;
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

  /**
   * 방금 추가한 줄로 포커스를 옮길 자리 — 키보드만으로 쓸 수 있어야 해서다. ref 인
   * 것은 그리는 데 쓰이지 않는 값이라서다(`줄 수정` 폼의 pendingDueDateFocusRef 와
   * 같다).
   */
  const pendingFocusRef = useRef<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const key = pendingFocusRef.current;
    if (key === null) return;
    pendingFocusRef.current = null;
    document.getElementById(`${idPrefix}-${key}`)?.focus();
  }, [lines, idPrefix]);

  function openEditor(event: MouseEvent<HTMLButtonElement>) {
    // ③ 줄 전체가 `줄 수정` 폼을 여는 클릭 대상이다(파일 헤더).
    event.stopPropagation();
    // 열 때마다 서버가 방금 그려 준 목록에서 다시 시작한다 — 취소하고 다시 여는
    // 사이에 목록이 새로 그려졌을 수 있다. ② 빌려 온 날짜는 여기 들어오지 않는다.
    setLines(linesOf(row));
    setErrorMessage(null);
    setLineErrors({});
    setIsConflict(false);
    setIsEditing(true);
  }

  function addLine() {
    const key = generateClientUuid();
    pendingFocusRef.current = key;
    setLines((previous) => [...previous, { key, dueDate: "", note: "" }]);
  }

  function updateLine(key: string, patch: Partial<DomesticOrderDueDateDraft>) {
    setLines((previous) => previous.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setLines((previous) => previous.filter((line) => line.key !== key));
    // 지운 줄과 함께 포커스가 사라지면 키보드 사용자는 갈 곳을 잃는다 — 늘 있는
    // `추가` 버튼으로 돌려보낸다(`줄 수정` 폼과 같다).
    addButtonRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setLineErrors({});
    // 차례 그대로, 빈 줄까지 보낸다(파일 헤더 '검증은 다시 하지 않는다').
    const drafts: DomesticOrderDueDateDraft[] = lines.map(({ dueDate, note }) => ({ dueDate, note }));
    try {
      const result = await updateDomesticOrderAction({
        id: row.id,
        // ① 줄 전체를 덮어쓰는 저장이라 이 값이 유일한 안전장치다.
        expectedVersion: row.version,
        // ①② 무엇을 싣는지는 도메인 함수가 정한다.
        fields: buildDomesticOrderDueDatesUpdateFields(row, drafts),
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 얼리기 **전에** 방금 적은 목록을 붙잡는다 — `최신 정보 다시 불러오기`
          // 를 누르면 사라진다. 담는 것은 납기요청일 한 덩어리뿐이다.
          setIsConflict(true);
          setErrorMessage({
            message: result.message,
            draftText: buildDraftText(
              { dueDatesText: domesticOrderDueDatesDraftText(drafts) },
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
    // 뿐이다. 겉모습과 title 은 다른 열두 칸과 같은 공용 값이다.
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
        // 빈 목록이 정상이라는 사실을 적는다(`줄 수정` 폼과 같은 문장).
        <p className={cellHintClass}>납기요청일이 없습니다. 필요하면 아래에서 추가하세요.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lines.map((line, index) => {
            const errorKey = `dueDates.${index}`;
            return (
              <li key={line.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* 폭은 감싸는 상자가 정한다 — editInputClass 에 w-full 이 이미
                      있어 같은 문자열에 폭을 덧붙이면 어느 쪽이 이길지 CSS 차례에
                      달린다(`줄 수정` 폼과 같은 이유). */}
                  <div className="w-40 max-w-full flex-none">
                    <input
                      id={`${idPrefix}-${line.key}`}
                      type="date"
                      className={editInputClass}
                      value={line.dueDate}
                      disabled={disabled}
                      aria-label={`${LABEL} ${index + 1}`}
                      onChange={(event) => updateLine(line.key, { dueDate: event.target.value })}
                    />
                  </div>
                  <div className="min-w-24 flex-1">
                    <input
                      type="text"
                      className={editInputClass}
                      value={line.note}
                      disabled={disabled}
                      placeholder="메모 (예: 1차분)"
                      aria-label={`${LABEL} ${index + 1} 메모`}
                      autoComplete="off"
                      onChange={(event) => updateLine(line.key, { note: event.target.value })}
                    />
                  </div>
                  {/* ⚠️ relative 를 떼지 말 것 — 아래 sr-only 가 문서 바닥으로
                      새어 창 스크롤이 하나 더 생긴다(파일 헤더, HANDOFF V-6). */}
                  <button
                    type="button"
                    className={`relative flex-none ${smallButtonClass}`}
                    disabled={disabled}
                    onClick={() => removeLine(line.key)}
                  >
                    삭제
                    <span className="sr-only">{` — ${LABEL} ${index + 1}`}</span>
                  </button>
                </div>
                {lineErrors[errorKey] && <p className={editErrorClass}>{lineErrors[errorKey]}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        ref={addButtonRef}
        className={`self-start ${smallButtonClass}`}
        disabled={disabled}
        onClick={addLine}
      >
        {LABEL} 추가
      </button>
      {/* 목록 전체가 잘못된 경우(개수 상한 초과 등)의 자리. */}
      {lineErrors.dueDates && <p className={editErrorClass}>{lineErrors.dueDates}</p>}
      {/* ② 빈 목록으로 열리는 순간을 설명한다 — 표에 보이던 날짜가 편집 목록에
          없는 까닭이다. */}
      <BorrowHint row={row} />
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
