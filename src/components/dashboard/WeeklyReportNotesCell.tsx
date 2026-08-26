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
    // 안 고칠 때는 지금까지와 똑같이 보인다 — 글자 옆에 `수정` 이 하나 붙을 뿐이다.
    // items-start 인 것은 비고가 여러 줄일 수 있어서다: 가운데 정렬이면 버튼이
    // 문단 한가운데로 내려간다.
    return (
      <span className="inline-flex items-start gap-2">
        <span>{displayText}</span>
        <button
          type="button"
          onClick={() => {
            // 열 때마다 서버가 방금 그려 준 값에서 다시 시작한다 — 취소하고
            // 다시 여는 사이에 화면이 새로 그려졌을 수 있다.
            setValue(notes ?? "");
            setIsEditing(true);
          }}
          className="text-xs font-medium whitespace-nowrap text-zinc-600 hover:underline dark:text-zinc-400"
        >
          수정
        </button>
      </span>
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
