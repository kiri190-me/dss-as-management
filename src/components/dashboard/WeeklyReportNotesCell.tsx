"use client";

import { useState, type FormEvent } from "react";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { useSectionEditSubmit } from "@/components/repair-cases/detail/edit/useSectionEditSubmit";

/**
 * ============================================================================
 * 주간보고 상세표의 `비고` 한 칸 — 화면에서 바로 고치는 자리
 * ============================================================================
 * 상단 카드의 보고서번호 칸(ReportNumberEditCell)과 담당 엔지니어 칸
 * (EngineerEditCell)이 본보기다. 저장은 **그 둘과 같은 길**을 그대로 탄다 —
 * useSectionEditSubmit → updateRepairCaseAction, 구간은 FAULT_SERVICE. 그래서
 * 권한(isFieldEditable "notes")·버전 충돌·형식 검증이 하나도 새로 생기지 않는다.
 * 주간보고 전용 서버 액션을 만들면 같은 컬럼에 규칙이 둘 생기고, 수리 건 상세의
 * 비고와 이 칸이 언젠가 다른 뜻으로 갈린다.
 *
 * ── `fields` 에는 notes 하나만 담는다 ───────────────────────────────────
 * FAULT_SERVICE 구간에는 reportedSymptom · assignedEngineerId 도 들어 있지만,
 * 여기서는 **보내지 않는다.** mutation 이 `key in fields` 로만 SET 절을 만들기
 * 때문에(mutations/repair-cases.ts), 안 보낸 칸은 손대지 않은 채로 남는다.
 * 같이 보내면 이 화면이 읽지도 않은 값을 덮어쓰게 된다.
 *
 * ── 빈 값은 null 이다 ──────────────────────────────────────────────────
 * `value || null` — FaultServiceEditForm 과 **같은 규칙**이어야 두 화면이 같은
 * 뜻이 된다. 빈 문자열로 보내면 "지웠다"가 아니라 "빈 글자를 적었다"가 되어,
 * 한쪽에서 지운 비고가 다른 쪽에서는 지워지지 않은 것처럼 보인다.
 *
 * ── input 이 아니라 textarea 인 이유 ────────────────────────────────────
 * 이 값에는 실제로 여러 줄이 들어 있다(표의 `<td>` 가 whitespace-pre-line 인
 * 까닭이 그것이고, 상세화면의 비고도 textarea 다). `<input type="text">` 로 열면
 * 기존 값의 **줄바꿈이 조용히 사라진 채** 저장된다. 표 안이라 좁으므로 rows 는
 * 상세화면과 같은 2 로 둔다.
 *
 * ── canEdit 을 받지 않는다 ─────────────────────────────────────────────
 * 본보기인 두 칸과 다른 점이 이것 하나다. 저 둘은 화면에 한 번씩만 나오지만 이
 * 칸은 **줄마다** 나오고, 이 표는 250줄이 넘는다. 못 고치는 사람에게까지 줄마다
 * 클라이언트 컴포넌트를 붙이면 접수 건의 id 와 version 이 통째로 브라우저로
 * 실려 간다. 그래서 "고칠 수 있는가"는 부르는 쪽(WeeklyReportScreen)이 정하고,
 * 못 고치는 사람에게는 이 칸을 **아예 그리지 않는다** — 쓰지 않을 값을
 * 클라이언트로 내려보내지 않는 것은 이 화면의 고르개 목록도 지키는 규칙이다
 * (page.tsx 의 repairCaseOptions 주석).
 *
 * 그 판정은 **화면을 그리기 위한 값일 뿐 관문이 아니다** — 실제 관문은 서버
 * 액션이고, 이 칸을 억지로 띄워 저장을 보내도 거기서 다시 막힌다.
 *
 * ── `수정` 버튼 없이 칸을 눌러 연다 ────────────────────────────────────
 * 본보기인 두 칸은 글자 옆에 `수정` 을 하나 달아 두지만 이 칸은 그러지 않는다.
 * 이유는 바로 위와 같다 — 저 둘은 상세화면에 한 번씩만 나오고 이 칸은 **줄마다**
 * 나오는데, 이 표가 250줄이 넘는다. 같은 버튼을 달면 표의 오른쪽 끝이 `수정`
 * 250개로 뒤덮여 정작 읽어야 할 비고가 묻힌다. 그래서 **안 고칠 때 보여 주는
 * 글자 자체를 `<button>` 으로** 만들고, 칸을 누르면 곧바로 편집으로 들어간다.
 *
 * 글자에 onClick 만 얹지 않은 것은 그것이 **키보드로 닿지 않고** 낭독기가 누를
 * 수 있는 것으로 읽지도 않기 때문이다. 진짜 `<button>` 이면 Enter·Space·포커스
 * 이동이 전부 브라우저 기본으로 딸려 온다 — role="button" + tabIndex + 키 처리를
 * 손으로 짜는 것보다 이쪽이 틀릴 자리가 없다. 대신 겉모습은 **평범한 글자 그대로**
 * 둔다(테두리도 배경도 없다). 버튼처럼 보이게 하면 버튼을 없앤 뜻이 사라진다.
 *
 * `w-full` + `text-left` 인 것은 비고가 비면 화면에 `-` **한 글자뿐**이라,
 * 글자에만 걸면 누를 곳이 점 하나가 되기 때문이다. 칸의 폭은 채우되 글자는 표의
 * 다른 칸과 같은 자리에서 시작해야 한다. whitespace-pre-line 을 버튼에 다시 적는
 * 것은 `<td>` 의 그것이 폼 컨트롤 안까지 내려온다는 보장이 없어서다 — 여러 줄
 * 비고의 줄바꿈이 이 칸에서만 사라지면 안 된다.
 *
 * ── hover·title·focus 는 장식이 아니다 ────────────────────────────────
 * `수정` 이라는 글자가 사라졌으므로, 단서가 없으면 **여기를 고칠 수 있다는 사실을
 * 아무도 모른다.** 그것이 이 방식의 유일한 실질적 손실이고, 아래 셋이 그 자리를
 * 메운다. 하나라도 장식으로 오해해 걷어내면 그만큼 못 찾는 사람이 생긴다.
 *   - hover 배경(이 화면이 이미 쓰는 zinc 톤, 밝은 화면·어두운 화면 각각) 과
 *     손가락 커서 — 마우스로 쓰는 사람의 단서다
 *   - focus-visible 테두리 — 키보드로 훑는 사람에게는 **이것이 유일한 단서다**
 *   - title — 올려 두면 무엇을 할 수 있는 칸인지 글자로 알려 준다
 *
 * 낭독기용 이름은 **내용 + 용도**로 합성한다 — 버튼 안에 sr-only 조각을 하나
 * 더 두는 방식이고, 인수번호 링크가 이미 같은 모양이다(WeeklyReportGoalsPanel 의
 * GoalPrefix). aria-label 로 `비고 수정` 을 주면 **그것이 자식 내용을 덮어써서**
 * 정작 비고 값이 낭독기에서 사라진다 — 표를 읽어 내려가는 사람에게는 그 칸의
 * 값이 먼저 와야 하므로 순서도 내용이 앞이다. 이름을 내용에만 맡기지 않는 것은
 * 비고가 비면 이름이 `-` 한 글자가 되어 무엇을 하는 버튼인지 알 길이 없어서다.
 *
 * ⚠️ 그 sr-only 를 담는 버튼에는 **relative 가 반드시 함께 붙는다.** 까닭은 그
 * 자리의 주석에 적어 두었다 — 떼면 표 전체가 창 스크롤을 하나 더 만든다.
 * ============================================================================
 */
export default function WeeklyReportNotesCell({
  repairCaseId,
  version,
  notes,
  displayText,
}: {
  repairCaseId: string;
  /** repair_cases.version — 낙관적 잠금 값(조회가 줄마다 실어 온다). */
  version: number;
  /** 편집칸에 채울 원본 값. 빈칸은 null 이다. */
  notes: string | null;
  /**
   * 안 고칠 때 보여 줄 글자. 빈 값을 무엇으로 적을지는 이 화면 전체가 한 함수로
   * 정하므로(WeeklyReportScreen 의 dash), 여기서 다시 정하지 않고 받아 쓴다 —
   * 따로 적으면 이 칸만 다른 글자로 비어 보이는 날이 온다.
   */
  displayText: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(notes ?? "");

  const { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict } =
    useSectionEditSubmit({
      repairCaseId,
      version,
      section: "FAULT_SERVICE",
      onDone: () => setIsEditing(false),
    });

  if (!isEditing) {
    // 안 고칠 때 보이는 글자는 지금까지와 한 글자도 다르지 않다 — 다만 그 글자
    // 자체가 누를 수 있는 것이 되었을 뿐이다(파일 헤더).
    return (
      <button
        type="button"
        onClick={() => {
          // 열 때마다 서버가 방금 그려 준 값에서 다시 시작한다 — 취소하고
          // 다시 여는 사이에 화면이 새로 그려졌을 수 있다.
          setValue(notes ?? "");
          setIsEditing(true);
        }}
        // `수정` 글자가 사라진 자리를 메우는 단서 셋 중 하나다 — 지우지 말 것.
        title="클릭하면 비고를 고칠 수 있습니다"
        // -mx-1 px-1 은 짝이다: hover 배경만 글자 밖으로 조금 넓히고 글자가
        // 서는 자리는 그대로 둔다(넓히기만 하면 이 칸의 글자만 오른쪽으로
        // 밀려 표의 세로줄이 어긋난다).
        //
        // ⚠️ relative 를 떼지 말 것 — 아래 sr-only 는 position:absolute 다
        // (Tailwind 의 sr-only 가 그렇다). 기준이 되는 조상이 없으면 그 span 이
        // AppShell <main> 의 자르기를 빠져나가 문서 바닥에 자리를 주장하고,
        // 세로 스크롤바가 둘로 보인다 — 이 저장소가 실제로 겪은 고장이다
        // (WeeklyReportGoalsPanel 의 GoalPrefix 주석). 이 표는 250줄이 넘으니
        // 같은 고장을 250배로 되살릴 수 있는 자리다. relative 는 좌표를 주지
        // 않으면 아무것도 옮기지 않고 z-index:auto 라 쌓임 맥락도 만들지 않는다.
        className="relative -mx-1 block w-full cursor-pointer rounded px-1 text-left whitespace-pre-line hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-500"
      >
        {displayText}
        {/* 낭독기가 읽을 이름을 **내용 + 용도**로 합성한다(파일 헤더). 순서가
            내용 먼저인 것은 표를 읽어 내려가는 사람에게 그 칸의 값이 먼저
            와야 해서다 — 인수번호 링크와 같은 방식이다(GoalPrefix). */}
        <span className="sr-only"> 비고 수정</span>
      </button>
    );
  }

  const disabled = isSubmitting || isConflict;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit({ notes: value || null });
  }

  return (
    // 폭은 편집하는 동안에만 늘어난다. whitespace-normal 은 장식이 아니다 —
    // 이 표의 `<tr>` 이 whitespace-nowrap 이라, 이것이 없으면 오류 문구와 충돌
    // 안내가 한 줄로 뻗어 표를 옆으로 밀어 버린다.
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex w-64 max-w-full flex-col gap-1 whitespace-normal"
    >
      <textarea
        rows={2}
        className={editInputClass}
        value={value}
        disabled={disabled}
        aria-label="비고"
        onChange={(e) => setValue(e.target.value)}
      />
      {fieldErrors.notes && <p className={editErrorClass}>{fieldErrors.notes}</p>}
      {/* 충돌이 나면 이 상자가 저장·취소를 지우고 `최신 정보 다시 불러오기` 하나만
          남긴다(그 파일 헤더) — 낡은 화면에서 누른 저장이 방금 바뀐 값을 덮어쓰는
          길이 여기에도 없다. */}
      <EditSectionActions
        isSubmitting={isSubmitting}
        isConflict={isConflict}
        submitError={submitError}
        onCancel={() => setIsEditing(false)}
        onReloadAfterConflict={reloadAfterConflict}
      />
    </form>
  );
}
