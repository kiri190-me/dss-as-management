"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import EditSectionActions, {
  editInputClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import {
  inlineEditCellButtonClass,
  inlineEditCellButtonTitle,
} from "@/components/common/inline-edit-cell-button";
import {
  DOMESTIC_ORDER_INLINE_EDIT_LABELS,
  buildDomesticOrderCellUpdateFields,
  type DomesticOrderInlineEditableField,
} from "@/lib/domain/domestic-order-cell-edit";
import type { DomesticOrderListItem } from "@/lib/db/queries/domestic-orders";
import { updateDomesticOrderAction } from "@/lib/server/actions/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 — 한 줄짜리 글자 칸 하나를 **그 자리에서** 고치는 칸
 * ============================================================================
 * 주간보고의 `비고` 칸(WeeklyReportNotesCell · WeeklyReportDeliveriesPanel 의
 * DeliveryLine)이 본보기다. `수정` 버튼 없이 **안 고칠 때 보이는 글자 자체가
 * `<button>`** 이고, 누르면 곧바로 편집으로 들어간다. 겉모습과 title 은 그 둘과
 * 같은 값을 나눠 쓴다(components/common/inline-edit-cell-button.ts — ⚠️
 * relative 를 빼면 창 스크롤이 하나 더 생기는 이유도 거기 적혀 있다).
 *
 * 여는 방식만 같고, **저장하는 길은 정반대다.** 아래 세 문단이 그 차이다.
 *
 * ── ⚠️ ① 이 저장은 보낸 칸만 고치지 않는다 ─────────────────────────────
 * 주간보고 비고는 `{ notes }` 하나만 보내면 나머지 칸이 손대지 않은 채로 남는다
 * (그쪽 mutation 이 `key in fields` 로만 SET 절을 만든다). 내자 정리는
 * **검증이 키 없음을 null 로 접고**(validation/domestic-order-input.ts),
 * **mutation 이 모든 칼럼을 SET 한다**(mutations/domestic-orders.ts). 칸 하나만
 * 보내면 그 줄의 나머지가 전부 지워진다.
 *
 * 그래서 이 칸은 고치는 값 하나만이 아니라 **그 줄의 값 전체**를 실어 보낸다.
 * 무엇을 어떤 차례로 싣는지는 화면이 아니라
 * domain/domestic-order-cell-edit.ts 가 정한다 — 틀리면 자료가 조용히
 * 지워지는 규칙이라, 브라우저를 띄우지 않고 시험할 수 있어야 한다.
 *
 * 줄 전체를 덮어쓰는 저장이므로 **낙관적 잠금이 유일한 안전장치다.**
 * expectedVersion 에 이 줄의 version 을 그대로 실어, 그 사이 누가 무엇이든
 * 고쳤으면 CONFLICT 로 막히게 한다(아래 handleSubmit).
 *
 * ── ⚠️ ② 계산된 값은 보내지 않는다 ─────────────────────────────────────
 * 목록 한 줄에는 원본 칸(modelNameText …)과 계산된 값(modelName …)이 두 벌 들어
 * 있고, 계산된 값을 보내면 수리 건에서 빌려 쓰던 값이 이 줄에 복사되어 굳는다.
 * 이 파일은 `row` 를 통째로 위 도메인 함수에 넘기기만 하고 **어떤 칸도 직접
 * 고르지 않는다** — 그 함수가 받는 타입에는 계산된 값이 아예 없다.
 *
 * ── ⚠️ ③ 줄 전체가 `줄 수정` 폼을 여는 클릭 대상이다 ────────────────────
 * 표의 `<tr>` 과 카드에 `onClick={() => openRow(row.id)}` 가 걸려 있다. 그대로
 * 두면 이 칸을 누르는 순간 **칸 편집과 `줄 수정` 폼이 함께 열린다** — 게다가 그
 * 폼은 방금 열린 칸 편집을 모르므로, 두 곳에서 같은 줄을 서로 다른 값으로
 * 저장하게 된다.
 *
 * 그래서 이 칸의 조작은 위로 퍼지지 않게 막는다: 여는 버튼과, 편집 중의 폼
 * 전체(입력칸 · 저장 · 취소 · 충돌 안내가 전부 그 안에 있다)에 각각
 * stopPropagation 을 건다. 같은 표의 인수번호 링크와 수정·완료 버튼이 이미 같은
 * 방식이다(DomesticOrderListScreen). **줄의 나머지 부분을 눌렀을 때 `줄 수정`
 * 이 열리는 동작은 그대로다.**
 *
 * ── 못 고치는 사람에게는 아예 그리지 않는다 ─────────────────────────────
 * canEdit 을 받아 안에서 막지 않고, **부르는 쪽이 이 칸을 그릴지 말지 정한다**
 * (WeeklyReportNotesCell 과 같은 방식). 버튼을 그려 놓고 누르면 거절하는 것은
 * 고칠 수 있는 것처럼 보이게 해 놓고 아니라고 말하는 셈이다. 그 판정은 화면을
 * 그리기 위한 값일 뿐 관문이 아니다 — 실제 관문은 서버 액션이고, 이 칸을 억지로
 * 띄워 저장을 보내도 거기서 다시 막힌다.
 * ============================================================================
 */
export default function DomesticOrderTextCell({
  row,
  field,
  displayText,
}: {
  /**
   * 고칠 줄 **통째로**. 칸 하나를 고쳐도 줄 전체를 실어 보내야 하므로(위 ①)
   * 값 몇 개만 골라 받을 수 없다. version 도 여기서 나온다.
   */
  row: DomesticOrderListItem;
  field: DomesticOrderInlineEditableField;
  /**
   * 안 고칠 때 보여 줄 글자. 빈 값을 무엇으로 적을지는 이 화면 전체가 한 함수로
   * 정하므로(DomesticOrderListScreen 의 dash), 여기서 다시 정하지 않고 받아
   * 쓴다 — 따로 적으면 이 칸만 다른 글자로 비어 보이는 날이 온다. 표와 카드가
   * 같은 글자를 넘기므로 화면 폭이 달라져도 같은 값으로 보인다.
   */
  displayText: string;
}) {
  const router = useRouter();
  const label = DOMESTIC_ORDER_INLINE_EDIT_LABELS[field];

  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(row[field] ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  const disabled = isSubmitting || isConflict;

  function openEditor(event: MouseEvent<HTMLButtonElement>) {
    // ③ 줄 전체가 `줄 수정` 폼을 여는 클릭 대상이다(파일 헤더).
    event.stopPropagation();
    // 열 때마다 서버가 방금 그려 준 값에서 다시 시작한다 — 취소하고 다시 여는
    // 사이에 목록이 새로 그려졌을 수 있고, 그때 예전 입력이 남아 있으면
    // 저장하는 순간 그 값이 되살아난다.
    setValue(row[field] ?? "");
    setErrorMessage(null);
    setIsConflict(false);
    setIsEditing(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await updateDomesticOrderAction({
        id: row.id,
        // ① 줄 전체를 덮어쓰는 저장이라, 이 값이 이 기능의 유일한 안전장치다
        // (파일 헤더). 그 사이 누가 이 줄을 고쳤으면 CONFLICT 로 막힌다.
        expectedVersion: row.version,
        // ①② 무엇을 어떤 차례로 싣는지는 도메인 함수가 정한다.
        fields: buildDomesticOrderCellUpdateFields(row, field, value),
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 낡은 화면에서 다시 저장이 나가는 길을 막는다 — 덮어쓰지 않고 다시
          // 불러오게 한다. 아래 EditSectionActions 가 저장·취소를 지우고
          // `최신 정보 다시 불러오기` 하나만 남긴다(이 저장소의 충돌은 늘 같은
          // 모양이어야 한다).
          setIsConflict(true);
          setErrorMessage(result.message);
          return;
        }
        // 이 칸의 오류가 있으면 그것을 먼저 보여 준다(길이 초과 등). 없으면
        // 액션이 준 문장을 그대로 쓴다 — 납입 예정 건 비고와 같은 규칙이다.
        setErrorMessage(result.fieldErrors?.[field] ?? result.message);
        return;
      }

      // 저장에 성공하면 목록을 새 값으로 다시 그린다 — 이 화면의 완료 버튼과
      // `줄 수정` 폼이 이미 쓰는 방식이다(router.refresh).
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
  }

  if (!isEditing) {
    // 안 고칠 때 보이는 글자는 지금까지와 한 글자도 다르지 않다 — 다만 그 글자
    // 자체가 누를 수 있는 것이 되었을 뿐이다(파일 헤더).
    return (
      <button
        type="button"
        onClick={openEditor}
        // 겉모습과 title 은 이 파일에 적지 않는다 — 주간보고의 두 비고 칸도
        // **똑같이** 눌러서 열리므로, 여러 곳에 각각 적으면 언젠가 한쪽만
        // 고쳐진다. 값과 그 까닭은 inline-edit-cell-button.ts 한 곳에 있다.
        // title 이 칸 이름을 받는 것은 한 줄에 누를 수 있는 칸이 다섯이라,
        // "고칠 수 있습니다"만으로는 어느 칸인지 말할 수 없어서다.
        //
        // 줄바꿈 처리만은 **여기서 고른다.** 이 다섯은 한 줄짜리 값이라
        // nowrap 이다 — 표의 다른 칸과 같이 굴어야 한다(`<tr>` 이 이미
        // whitespace-nowrap 이다). 버튼이 자기 것을 선언하지 않으면 그 상속을
        // 받으면 될 것 같지만, 반대로 **자기 선언이 상속을 이기므로** 공용 값에
        // 여러 줄용 pre-line 이 박혀 있던 동안 이 다섯 칸만 칸 너비에 갇혀
        // 접혔다. 여러 줄이 실제로 들어 있는 주간보고 비고는 pre-line 을
        // 고른다(그 파일 주석).
        title={inlineEditCellButtonTitle(label)}
        className={inlineEditCellButtonClass("whitespace-nowrap")}
      >
        {displayText}
        {/* 낭독기가 읽을 이름을 **내용 + 용도**로 합성한다. aria-label 로
            `발주서번호 수정` 을 주면 그것이 자식 내용을 덮어써서 정작 그 칸의
            값이 낭독기에서 사라진다 — 표를 읽어 내려가는 사람에게는 그 칸의
            값이 먼저 와야 하므로 순서도 내용이 앞이다. 이름을 내용에만 맡기지
            않는 것은 값이 비면 이름이 `-` 한 글자가 되어 무엇을 하는 버튼인지
            알 길이 없어서다(같은 표의 인수번호 링크와 수정 버튼도 같은 방식). */}
        <span className="sr-only">{` ${label} 수정`}</span>
      </button>
    );
  }

  return (
    // ③ 편집 중의 조작이 전부 이 안에 있으므로, 여기서 한 번 막으면 입력칸 ·
    // 저장 · 취소 · 충돌 안내가 모두 `줄 수정` 폼을 열지 않는다(파일 헤더).
    //
    // 폭은 편집하는 동안에만 늘어난다. whitespace-normal 은 장식이 아니다 —
    // 표의 `<tr>` 이 whitespace-nowrap 이라, 이것이 없으면 오류 문구와 충돌
    // 안내가 한 줄로 뻗어 표를 옆으로 밀어 버린다.
    <form
      onSubmit={handleSubmit}
      onClick={(event) => event.stopPropagation()}
      noValidate
      className="flex w-64 max-w-full flex-col gap-1 whitespace-normal"
    >
      {/* 다섯 칸 모두 한 줄짜리 글자라 input 이다 — 여러 줄이 들어 있는
          주간보고 비고가 textarea 인 것과 다른 점이 이것 하나다. 자동완성을
          끄는 것은 발주서번호·견적서번호처럼 브라우저가 엉뚱하게 기억해 둘
          값이라서다. */}
      <input
        type="text"
        className={editInputClass}
        value={value}
        disabled={disabled}
        aria-label={label}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
      />
      {/* 오류 문구도 충돌 안내도 이 상자가 그린다 — 충돌이면 저장·취소를 지우고
          `최신 정보 다시 불러오기` 하나만 남긴다(그 파일 헤더). 낡은 화면에서
          누른 저장이 방금 바뀐 값을 덮어쓰는 길이 여기에도 없다. */}
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
