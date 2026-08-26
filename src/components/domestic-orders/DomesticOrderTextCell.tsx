"use client";

import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import EditSectionActions, {
  editInputClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import {
  inlineEditCellButtonClass,
  inlineEditCellButtonTitle,
  type InlineEditCellNumeric,
  type InlineEditCellWrapping,
} from "@/components/common/inline-edit-cell-button";
import {
  DOMESTIC_ORDER_INLINE_EDIT_LABELS,
  buildDomesticOrderCellUpdateFields,
  domesticOrderFaultDescriptionHint,
  domesticOrderInlineEditControl,
  domesticOrderInlineEditYearNotice,
  type DomesticOrderInlineEditableField,
} from "@/lib/domain/domestic-order-cell-edit";
import type { DomesticOrderListItem } from "@/lib/db/queries/domestic-orders";
import { updateDomesticOrderAction } from "@/lib/server/actions/domestic-orders";

/**
 * ============================================================================
 * 내자 정리 — 칸 하나를 **그 자리에서** 고치는 칸
 * ============================================================================
 * ⚠️ 파일 이름에 `Text` 가 남아 있지만 이제 **날짜 칸 셋도 이 파일이 맡는다**
 * (아래 '한 컴포넌트가 맡는다'). 이름을 그대로 둔 것은 이 파일이 하는 일이
 * 글자냐 날짜냐가 아니라 **"칸을 눌러 그 자리에서 고친다"** 이기 때문이고, 실을
 * 값을 정하는 도메인 파일도 처음부터 `domestic-order-cell-edit.ts` 다.
 *
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
 * ── 글자 칸 아홉과 날짜 칸 셋을 **한 컴포넌트가** 맡는다 ────────────────
 * 열두 칸 중 넷(고장내역 · 현황 · 이력 · 기타)은 사람이 줄바꿈을 섞어 적는
 * 칸이고, 셋(발주발행일 · 견적발행일 · 세금계산서발행일)은 달력으로 고르는
 * 날짜다. 그 갈래마다 파일을 만들지 않은 것은 **다른 것이 편집칸의 생김새
 * 하나뿐**이기 때문이다 — 위 ①②③ 은 열두 칸에 똑같이 걸리고, 그것들이 이
 * 파일에서 가장 위험한 부분이다. 나누면 "줄 전체를 실어 보낸다 ·
 * expectedVersion 을 건다 · 계산된 값을 만지지 않는다 · 위로 퍼지지 않게
 * 막는다"가 **여러 벌**이 되고, 언젠가 한쪽만 고쳐진다. 그때 조용히 지워지는
 * 것은 사람이 제일 길게 적어 둔 칸(현황·이력)이거나, 화면에 보이지도 않는
 * 납품일이다.
 *
 * 날짜가 늦게 합류하면서 "날짜는 따로 만들자"가 한 번 더 자연스러워 보였는데,
 * 이 파일에서 날짜만의 것은 **`<input type="date">` 한 줄과 그 아래 안내 한
 * 줄뿐**이다. 나머지는 전부 위 ①②③ 이라, 나누면 위험한 쪽이 복사된다.
 *
 * 어느 칸을 무엇으로 여는지는 화면이 정하지 않는다(도메인의
 * domesticOrderInlineEditControl) — 표와 카드가 각각 고르면 한쪽만 틀릴 수
 * 있고, 틀리면 `<input type="text">` 가 값의 줄바꿈을 말없이 지우거나
 * `<input type="date">` 가 아닌 칸으로 열려 `2026.5.11` 같은 값이 저장을 시도한다.
 * 그 파일에 까닭이 있다.
 *
 * **여러 줄 칸은 `Enter` 로 저장하지 않는다.** 한 줄짜리 다섯과 날짜 셋은 입력칸
 * 하나뿐인 폼이라 브라우저가 Enter 를 저장으로 받아 주고(묵시적 제출) 그것이
 * 자연스럽다. 여러 줄 칸에서 그러면 줄바꿈을 칠 수가 없다 — `<textarea>` 는
 * Enter 를 묵시적 제출로 삼지 않으므로, 이 성질은 손으로 막을 것 없이 편집칸을
 * 고르는 것만으로 갈린다. 저장은 아래 EditSectionActions 의 버튼 몫이다.
 *
 * ── ⚠️ 날짜를 화면에서 다시 검사하지 않는다 ─────────────────────────────
 * `2026-02-31` 처럼 형식은 맞지만 없는 날짜, 빈 값을 null 로 접는 일은 **검증 한
 * 곳**이 이미 한다(validation/domestic-order-input.ts 의 normalizeDate). 여기서
 * 한 번 더 보면 규칙이 두 벌이 되고, 언젠가 둘이 어긋나 화면이 받아 준 값이
 * 서버에서 거절된다(혹은 그 반대). 그래서 이 파일은 편집칸이 준 문자열을 그대로
 * 실어 보내고, 거절당하면 그 문장을 이 칸 아래에 그대로 보여 준다.
 *
 * **세 칸 다 비우는 것이 정상이다.** 발주가 아직 안 난 줄, 견적만 나간 줄이
 * 실제로 있다. `<input type="date">` 를 비우면 빈 문자열이 오고 검증이 그것을
 * null 로 접는다 — `줄 수정` 폼으로 지웠을 때와 결과가 한 글자도 다르지 않다.
 *
 * ── ⚠️ 고장내역은 편집칸을 **원본 칸으로** 채운다 ───────────────────────
 * 이 열둘 중 고장내역만은 화면에 보이는 글자(계산된 reportedSymptom)와 저장되는
 * 칸(원본 faultDescriptionText)이 다르다. 편집칸에는 **원본 칸**을 채운다 —
 * 보이던 글자를 채우면 아무것도 안 고치고 저장만 눌러도 수리 건의 증상이 이 줄에
 * 굳는다. 그 대신 비어 있는 채로 열리는 순간이 생기므로, 무엇이 보이게 되는지를
 * 편집칸 아래 한 줄로 적는다(domesticOrderFaultDescriptionHint). 규칙도 문구도
 * `줄 수정` 폼의 faultDescriptionHint 와 같다.
 *
 * ── ⚠️ 발주발행일을 고치면 그 줄이 목록에서 사라질 수 있다 ──────────────
 * 이 화면은 **발주발행일의 년도**로 줄을 가른다. 그래서 이 칸을 다른 해로 고쳐
 * 저장하면 그 줄이 지금 보고 있는 해에서 없어진다 — 규칙대로 움직인 결과이지만,
 * 사람에게는 "저장했더니 줄이 사라졌다"로 보이고 어느 해로 가야 다시 만나는지도
 * 화면 어디에 없다. 그래서 **저장하기 전에** 편집칸 아래에 두 줄로 적어 둔다
 * (domesticOrderInlineEditYearNotice). 무엇을 어느 칸에 적을지는 도메인이
 * 정한다 — 표와 카드가 각각 적으면 한쪽에만 붙거나, 년도와 상관없는 날짜 칸에도
 * 붙어 있지도 않은 규칙을 설명하게 된다.
 *
 * ── 못 고치는 사람에게는 아예 그리지 않는다 ─────────────────────────────
 * canEdit 을 받아 안에서 막지 않고, **부르는 쪽이 이 칸을 그릴지 말지 정한다**
 * (WeeklyReportNotesCell 과 같은 방식). 버튼을 그려 놓고 누르면 거절하는 것은
 * 고칠 수 있는 것처럼 보이게 해 놓고 아니라고 말하는 셈이다. 그 판정은 화면을
 * 그리기 위한 값일 뿐 관문이 아니다 — 실제 관문은 서버 액션이고, 이 칸을 억지로
 * 띄워 저장을 보내도 거기서 다시 막힌다.
 * ============================================================================
 */

/**
 * 편집칸 아래에 붙는 회색 안내 한 줄의 모양. 지금 이 자리에 붙는 안내는 둘이고
 * (고장내역의 빌려 쓰는 값 · 발주발행일의 년도 거르기) **둘이 같은 자리에 같은
 * 모양으로** 서야 한다 — 안내마다 글자 크기나 색이 다르면, 사람은 그 차이를
 * "이건 경고, 저건 그냥 설명"처럼 뜻으로 읽는다.
 */
const cellHintClass = "text-xs text-zinc-500 dark:text-zinc-400";

/**
 * 고장내역 편집칸 아래 한 줄. 다른 열한 칸에는 붙지 않는다 — 계산된 짝이 있는
 * 칸이 이 하나뿐이라, 다른 칸에 같은 말을 적으면 있지도 않은 규칙을 설명하는
 * 문장이 된다.
 *
 * 무엇을 적을지·언제 적을지는 도메인이 정한다
 * (domesticOrderFaultDescriptionHint) — `줄 수정` 폼과 **같은 조건, 같은 문구**여야
 * 하고, 그 규칙은 브라우저를 띄우지 않고 시험할 수 있어야 한다.
 *
 * `줄 수정` 폼의 hintClass 에 있는 `mt-1` 은 뺐다. 이 폼은 `flex flex-col gap-1`
 * 이라 간격을 이미 gap 이 만들고 있어서, 그대로 가져오면 이 한 줄만 아래로 더
 * 떨어져 어느 칸의 안내인지 흐려진다.
 */
function FaultDescriptionHint({
  row,
  field,
}: {
  row: DomesticOrderListItem;
  field: DomesticOrderInlineEditableField;
}) {
  if (field !== "faultDescriptionText") return null;
  const hint = domesticOrderFaultDescriptionHint(row);
  if (hint === null) return null;
  return (
    <p className={cellHintClass}>
      연결된 수리 건{hint.intakeNumber === null ? "" : ` ${hint.intakeNumber}`}: {hint.symptom}
      <br />
      비워 두면 이 값이 그대로 보입니다.
    </p>
  );
}

/**
 * 발주발행일 편집칸 아래 두 줄. **저장하면 이 줄이 목록에서 사라질 수 있다**는
 * 사실을 미리 말해 준다(파일 헤더).
 *
 * 저장한 **뒤**에 알리지 않는 것은, 그때는 이미 그 줄이 화면에서 사라진 뒤라
 * 알림이 어느 줄의 이야기인지 가리킬 자리가 없어서다. 고치기 전에 읽어야
 * "다른 해로 바꾸면 여기서는 안 보이게 된다"를 알고 누를 수 있다.
 *
 * 무엇을 적을지·어느 칸에 적을지는 도메인이 정한다
 * (domesticOrderInlineEditYearNotice) — 년도 거르기 규칙이 있는 칸은 하나뿐이고,
 * 그 판정은 브라우저를 띄우지 않고 시험할 수 있어야 한다.
 *
 * 두 줄을 `<br>` 로 잇는 것은 위 고장내역 안내와 같은 방식이다. 목록으로 만들면
 * 같은 자리의 안내 둘이 서로 다른 모양이 된다.
 */
function YearFilterNotice({ field }: { field: DomesticOrderInlineEditableField }) {
  const lines = domesticOrderInlineEditYearNotice(field);
  if (lines === null) return null;
  return (
    <p className={cellHintClass}>
      {lines.map((line, index) => (
        // 줄 차례가 곧 신원이다 — 이 목록은 다시 정렬되지 않는다(같은 화면의
        // 납기요청일 줄들과 같은 이유).
        <span key={index}>
          {index === 0 ? null : <br />}
          {line}
        </span>
      ))}
    </p>
  );
}

export default function DomesticOrderTextCell({
  row,
  field,
  displayText,
  wrapping,
  numeric,
}: {
  /**
   * 고칠 줄 **통째로**. 칸 하나를 고쳐도 줄 전체를 실어 보내야 하므로(위 ①)
   * 값 몇 개만 골라 받을 수 없다. version 도 여기서 나온다.
   */
  row: DomesticOrderListItem;
  field: DomesticOrderInlineEditableField;
  /**
   * 안 고칠 때 보여 줄 것. 빈 값을 무엇으로 적을지는 이 화면 전체가 한 함수로
   * 정하므로(DomesticOrderListScreen 의 dash), 여기서 다시 정하지 않고 받아
   * 쓴다 — 따로 적으면 이 칸만 다른 글자로 비어 보이는 날이 온다. 표와 카드가
   * 같은 글자를 넘기므로 화면 폭이 달라져도 같은 값으로 보인다.
   *
   * ⚠️ 글자만이 아니라 **마디(ReactNode)**를 받는다. 발주발행일 칸은 값이 없을
   * 때 `-` 가 아니라 `발주일 미정` 배지를 그리는데(그 줄이 어느 년도를 골라도
   * 함께 보이는 근거가 그 칸이다), 글자만 받으면 눌러서 고칠 수 있게 된 순간
   * 그 배지가 사라진다. **안 고칠 때 보이는 것이 지금까지와 똑같아야 한다**는
   * 규칙이 이 칸에서는 배지까지 포함한다.
   */
  displayText: ReactNode;
  /**
   * 그 글자를 **어떻게 접을 것인가.** 여기서 정하지 않고 받는 것은, 같은 칸이라도
   * 표와 카드가 서로 다르게 골라야 하기 때문이다 — 표의 현황·이력·기타는 폭이
   * 모자라도 접지 않고(whitespace-pre), 카드에서는 접는다. 폰에서 좌우 스크롤은
   * 사실상 못 쓰는 조작이라 접지 않으면 글자가 화면 밖으로 나간다. 그 갈림은
   * **일부러**이고 까닭은 DomesticOrderListScreen 의 noteCellContentClass 에 있다.
   *
   * ⚠️ **안 고칠 때 보이는 글자가 지금까지와 똑같아야 한다.** 부르는 쪽은 그
   * 자리의 `<td>`·`<dd>` 가 쓰던 것과 결과가 같은 값을 넘긴다 — 눌러서 고칠 수
   * 있게 되었다는 이유로 표의 생김새가 함께 바뀌면 안 된다.
   */
  wrapping: InlineEditCellWrapping;
  /**
   * 숫자의 자릿수 폭을 맞출 칸인가. 표의 날짜 칸 셋만 넘긴다 — 그 `<td>` 들이
   * tabular-nums 를 쓰고 있는데 그 성질은 **버튼 안까지 안 내려온다**
   * (inline-edit-cell-button.ts 의 InlineEditCellNumeric — `font: inherit` 가
   * 되돌린다). 안 넘기면 눌러 고칠 수 있게 된 날짜 칼럼만 옆 칼럼과 자릿수가
   * 어긋난다.
   *
   * 카드 쪽은 넘기지 않는다. 카드의 `<dd>` 에는 원래 tabular-nums 가 없어서,
   * 여기서 켜면 **없던 생김새가 생긴다** — 표와 카드가 일부러 다른 자리이고,
   * 양쪽 다 "지금 보이는 그대로"가 기준이다.
   */
  numeric?: InlineEditCellNumeric;
}) {
  const router = useRouter();
  const label = DOMESTIC_ORDER_INLINE_EDIT_LABELS[field];
  // 무엇으로 열지는 값의 성질이 정한다(도메인) — 날짜가 먼저, 그다음 여러 줄.
  const control = domesticOrderInlineEditControl(field);

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
        // title 이 칸 이름을 받는 것은 한 줄에 누를 수 있는 칸이 열둘이라,
        // "고칠 수 있습니다"만으로는 어느 칸인지 말할 수 없어서다.
        //
        // 줄바꿈 처리는 **부르는 쪽이 넘긴 것을 그대로 쓴다**(위 wrapping).
        // 같은 칸이라도 표와 카드가 다르게 골라야 해서 이 파일이 정할 수 없다.
        // 버튼이 자기 것을 선언하지 않으면 바깥 것을 물려받으면 될 것 같지만,
        // 반대로 **자기 선언이 상속을 이기므로** 공용 값에 여러 줄용 pre-line 이
        // 박혀 있던 동안 한 줄짜리 다섯 칸이 칸 너비에 갇혀 접혔다.
        title={inlineEditCellButtonTitle(label)}
        className={inlineEditCellButtonClass(wrapping, numeric)}
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
      {/* 편집칸의 생김새는 **값의 성질이 정한다**(도메인의
          domesticOrderInlineEditControl — 셋 중 하나를 돌려준다). 여러 줄이
          들어 있는 칸을 input 으로 열면 브라우저가 값의 줄바꿈을 말없이 지운 채
          넘겨주고, 아무것도 고치지 않고 저장만 눌러도 그 메모가 한 줄로 뭉개진다.
          날짜를 글자 칸으로 열면 반대로 사람이 친 값이 매번 검증에 걸린다.
          여기서 갈리는 것이 하나 더 있다 — textarea 는 Enter 를 묵시적 제출로
          삼지 않으므로, 저장이 버튼 몫이 되고 Enter 는 줄바꿈이 된다(파일 헤더).

          resize-y 로 세로만 늘릴 수 있게 둔다. 가로로도 늘릴 수 있으면 표 안에서
          이 칸 하나가 22칼럼을 옆으로 밀어낸다. rows 가 3 인 것은 표 안이라 좁아서다
          — `줄 수정` 폼의 min-h-20 과 비슷한 높이에서 시작해 필요하면 늘린다. */}
      {control === "textarea" ? (
        <textarea
          rows={3}
          className={`${editInputClass} resize-y`}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : control === "date" ? (
        // 날짜는 **달력으로 고른다.** 글자로 받으면 사람이 늘 쓰던 대로
        // `2026.5.11` 을 쳐서 저장할 때마다 검증에 걸린다(도메인의
        // …_INLINE_EDIT_DATE). `줄 수정` 폼도 이 셋을 type="date" 로 받는다 —
        // 같은 값을 여는 길에 따라 다르게 받으면 규칙이 두 벌이 된다.
        //
        // 비우면 빈 문자열이 오고, 그것을 null 로 접는 것은 검증이다. 세 칸 다
        // 비어 있는 것이 정상이라 그 길이 반드시 살아 있어야 한다(파일 헤더).
        //
        // autoComplete 를 끄지 않는 것은 `줄 수정` 폼의 날짜 칸들과 맞춘 것이다 —
        // 브라우저는 달력 입력에 엉뚱한 값을 채워 넣지 않는다.
        <input
          type="date"
          className={editInputClass}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : (
        // 자동완성을 끄는 것은 발주서번호·견적서번호처럼 브라우저가 엉뚱하게
        // 기억해 둘 값이라서다.
        <input
          type="text"
          className={editInputClass}
          value={value}
          disabled={disabled}
          aria-label={label}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
        />
      )}
      {/* ⚠️ 고장내역만 편집칸이 **비어 있는 채로 열릴 수 있다** — 화면에 보이던
          글이 이 줄 자신의 값이 아니라 연결된 수리 건에서 빌려 온 것일 때다.
          그것을 설명하지 않으면 값이 사라진 것으로 읽힌다(파일 헤더). */}
      <FaultDescriptionHint row={row} field={field} />
      {/* ⚠️ 발주발행일만은 **저장이 성공해도** 그 줄이 화면에서 사라질 수 있다 —
          이 목록은 그 칸의 년도로 줄을 가른다. 고장이 아니라 규칙대로 움직인
          결과지만, 미리 말해 두지 않으면 "저장했더니 줄이 없어졌다"로 읽힌다
          (파일 헤더). */}
      <YearFilterNotice field={field} />
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
