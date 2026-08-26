"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WeeklyReportGoalDeleteDialog from "./WeeklyReportGoalDeleteDialog";
import type { RepairCaseLinkOption } from "@/lib/db/queries/domestic-orders";
import type { WeeklyReportGoalRow } from "@/lib/db/queries/weekly-report-goals";
import { addCalendarDays } from "@/lib/domain/date-only";
import {
  filterRepairCaseLinkOptions,
  keepSelectedRepairCaseOption,
} from "@/lib/domain/repair-case-link-search";
import { WEEKLY_REPORT_KINDS, type WeeklyReportKind } from "@/lib/domain/weekly-report";
import { buildGoalPrefix, formatGoalLine, weekLabel } from "@/lib/domain/weekly-report-goal";
import {
  copyWeeklyReportGoalsAction,
  createWeeklyReportGoalAction,
  deleteWeeklyReportGoalAction,
  updateWeeklyReportGoalAction,
} from "@/lib/server/actions/weekly-report-goals";

/**
 * ============================================================================
 * 주간보고 — `RFG 금주 목표` · `MB 금주 목표` 상자
 * ============================================================================
 * 원본 엑셀 위쪽에 있던 상자다. 한 줄이 수리 건 하나와 그 건에 대한 목표 한
 * 마디로 되어 있다:
 *
 *     [INVENIA] D260706_RFK300FH-AD1_2111171_WT7351: 견적서 발행
 *
 * 이 화면에서 **유일하게 누를 것이 있는 자리**라 클라이언트 컴포넌트다.
 * WeeklyReportScreen 은 서버 컴포넌트 그대로 남고, 이 상자를 놓을 자리만 준다.
 *
 * ── 앞부분은 그리기만 하고 저장하지 않는다 ──────────────────────────────
 * 콜론 왼쪽(`[INVENIA] D260706_..._WT7351`)은 저장된 값이 아니다. 조회가 수리
 * 건에서 재료를 실어 오고, 이어 붙이는 일은 **domain 의 buildGoalPrefix 하나가**
 * 한다(schema/weekly-report-goals.ts 헤더). 여기서 다시 이어 붙이면 나중에
 * 수리 건의 형식이나 S/N 이 고쳐졌을 때 목표 줄만 옛 값으로 남는다.
 *
 * 인수번호만 링크로 만드는 일도 그래서 **문자열을 다시 조립하지 않는다** —
 * buildGoalPrefix 가 만든 한 줄에서 인수번호가 있는 자리를 찾아 셋으로 자를 뿐이다
 * (GoalPrefix). 여기서 `[고객사] 번호_형식_L/N_S/N` 를 다시 적으면 빈 조각을
 * 건너뛰는 규칙이 두 곳에 생기고, 한쪽만 고쳐지는 날이 온다.
 *
 * ── 주는 주소로 오간다. 클라이언트 상태가 아니다 ────────────────────────
 * `?week=2026-08-24` 다. 서버 컴포넌트가 그 주의 목표를 다시 조회해야 하므로,
 * 여기서 useState 로 주를 바꾸면 화면은 바뀌는데 자료는 그대로다. 이상한 값이
 * 와도 page.tsx 의 normalizeWeekStart 가 월요일로 접거나 이번 주로 떨어뜨린다.
 *
 * ── '지금 이 순간'을 말해 준다 ──────────────────────────────────────────
 * 집계(고객사 블록·총합)는 **언제나 지금의 진행 상황**이다. 과거를 남기지
 * 않는다. 그런데 목표 상자만 지난주를 보고 있으면, 사람은 집계도 그 주의
 * 상태라고 읽는다. 그래서 이번 주가 아닐 때는 그 사실을 상자 안에 한 줄 적는다.
 *
 * ⚠️ **그 안내문에 `아래`·`위` 를 붙이지 말 것.** 한때 "아래 집계는…"이라고 적혀
 * 있었는데, 이 상자가 화면 맨 아래로 내려가면서 집계가 위로 올라가 그 문장이
 * 거짓이 됐다. 자리를 정하는 것은 이 파일이 아니라 WeeklyReportScreen 이고 또
 * 바뀔 수 있다 — 자리를 말하지 않고 뜻만 남기면 어디로 옮겨도 맞는 문장이 된다.
 *
 * ── 적을 수 있는 사람에게만 입력칸이 보인다 ─────────────────────────────
 * canEdit 은 **그리기 위한 값일 뿐 관문이 아니다.** 저장은 서버 액션이 세션부터
 * 다시 확인하고 역할·설정 두 관문을 매번 다시 본다
 * (server/actions/weekly-report-goals.ts 헤더).
 *
 * ── 줄을 고치는 것은 목표 글뿐이다 ──────────────────────────────────────
 * 수리 건을 잘못 골랐으면 지우고 다시 넣는다. 삭제가 즉시라 부담이 없고, 고르개를
 * 줄마다 하나씩 두면 상자가 폼 목록이 된다. 다만 저장할 때는 주·수리 건·차례를
 * **원래 값 그대로 다시 실어 보낸다** — 검증이 네 칸을 한 벌로 받기 때문이고
 * (validation/weekly-report-goal-input.ts), 빠뜨리면 차례가 조용히 지워진다.
 * ============================================================================
 */

/** 주 이동 링크가 가리키는 곳. 상대 주소를 쓰지 않는 이유는 아래 weekHref 주석. */
const WEEKLY_REPORT_PATH = "/dashboard/weekly-report";

/**
 * 그 주를 보여 주는 주소.
 *
 * `?week=...` 만 적는 상대 주소도 동작하지만, 전체 경로를 적어 두면 이 상자가
 * 다른 화면에 놓이더라도 링크가 엉뚱한 곳을 가리키지 않는다.
 */
function weekHref(weekStart: string): string {
  return `${WEEKLY_REPORT_PATH}?week=${weekStart}`;
}

/**
 * 상자 소제목의 색. `PO 발행 현황`(자홍)·총합(연두)과 마찬가지로 **고객사가
 * 아니라 자리에 붙은 색**이라 팔레트가 아니라 화면 코드에 둔다. 짙기는 이 화면의
 * 다른 자리 색과 같다(밝은 쪽 -100, 어두운 쪽 -950/50).
 */
const GOAL_HEADING_TONE = "bg-sky-100 dark:bg-sky-950/50";

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "text-[11px] text-zinc-500 dark:text-zinc-400";
const errorClass = "mt-1 text-[11px] text-red-600 dark:text-red-400";
const smallButtonClass =
  "rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const primaryButtonClass =
  "rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";

/**
 * 줄 앞부분 — 흐린 글씨, 그중 인수번호만 링크.
 *
 * **문자열은 buildGoalPrefix 가 만든 것 하나뿐이다**(파일 헤더). 그 안에서
 * 인수번호가 놓인 자리를 찾아 앞·번호·뒤 셋으로 자른다. 못 찾으면(있을 수 없지만
 * 인수번호가 빈 줄이면 그렇다) 그냥 통째로 그린다 — 링크 하나 때문에 줄이
 * 사라지는 것보다 낫다.
 */
function GoalPrefix({ row, prefix }: { row: WeeklyReportGoalRow; prefix: string }) {
  const intakeNumber = row.intakeNumber.trim();
  const at = intakeNumber === "" ? -1 : prefix.indexOf(intakeNumber);

  if (at < 0) {
    return <span className="text-zinc-500 dark:text-zinc-400">{prefix}</span>;
  }

  return (
    <span className="text-zinc-500 dark:text-zinc-400">
      {prefix.slice(0, at)}
      {/* 내자 정리의 인수번호 칸과 같은 경로·같은 모양이다
          (DomesticOrderListScreen 의 IntakeNumberLink).

          ⚠️ relative 를 떼지 말 것 — 바로 아래 sr-only 는 position:absolute 다
          (Tailwind 의 sr-only 가 그렇다). 기준이 되는 조상이 없으면 그 span 이
          AppShell <main> 의 자르기를 빠져나가 문서 바닥에 자리를 주장하고,
          세로 스크롤바가 둘로 보인다 — 이 저장소가 실제로 겪은 고장이다
          (WeeklyReportScreen 의 고객사 줄 주석). */}
      <Link
        href={`/repair-cases/${row.repairCaseId}`}
        className="relative text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
      >
        {intakeNumber}
        <span className="sr-only"> 수리 건 상세로 이동</span>
      </Link>
      {prefix.slice(at + intakeNumber.length)}
    </span>
  );
}

/**
 * 목표 줄 하나. 고칠 수 없는 사람에게는 글자만 보인다.
 *
 * 수정은 **제자리에서** 목표 글만 바꾼다. 폼을 따로 띄우지 않는 이유는 고칠 값이
 * 하나뿐이어서고, 그래서 이 상태(열림·입력값·오류·충돌)는 전부 줄 안에 산다 —
 * 위로 올리면 상자 하나가 모든 줄의 편집 상태를 들고 있게 된다.
 */
function GoalLine({
  row,
  canEdit,
  onRequestDelete,
}: {
  row: WeeklyReportGoalRow;
  canEdit: boolean;
  onRequestDelete: (row: WeeklyReportGoalRow) => void;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [goalText, setGoalText] = useState(row.goalText);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  // 한 번만 만든다 — 아래 두 자리(앞부분, 콜론을 붙일지)가 **같은 문자열**을
  // 봐야 한다. 따로 부르면 언젠가 한쪽만 다른 규칙을 보게 된다.
  const prefix = buildGoalPrefix(row);

  function openEditor() {
    // 열 때마다 지금 저장돼 있는 값에서 시작한다 — 남이 고친 뒤 새로 그려진
    // 줄을 열었는데 예전 입력이 남아 있으면, 저장하는 순간 그 값이 되살아난다.
    setGoalText(row.goalText);
    setErrorMessage(null);
    setIsConflict(false);
    setIsEditing(true);
  }

  async function save() {
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await updateWeeklyReportGoalAction({
        id: row.id,
        expectedVersion: row.version,
        // 주·수리 건·차례는 원래 값 그대로다(파일 헤더) — 여기서 바꾸는 것은
        // 목표 글 하나뿐이다.
        fields: {
          weekStartDate: row.weekStartDate,
          repairCaseId: row.repairCaseId,
          goalText,
          displayOrder: row.displayOrder,
        },
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 낡은 폼에서 다시 저장이 나가는 길을 막는다 — 덮어쓰지 않고
          // 다시 불러오게 한다(EditSectionActions 와 같은 규칙).
          setIsConflict(true);
          setErrorMessage(result.message);
          return;
        }
        setErrorMessage(result.fieldErrors?.goalText ?? result.message);
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
  }

  return (
    <li className="border-b border-zinc-100 px-2 py-1 text-xs leading-relaxed last:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="min-w-0 break-all">
          <GoalPrefix row={row} prefix={prefix} />
          {/* 앞부분이 통째로 비어 있으면 콜론을 붙이지 않는다 — 그 판단도
              domain 의 formatGoalLine 이 이미 하고 있으므로 같은 조건을 본다. */}
          {prefix !== "" && <span className="text-zinc-500 dark:text-zinc-400">: </span>}
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.goalText}</span>
        </p>
        {canEdit && !isEditing && (
          <span className="flex shrink-0 gap-1">
            <button type="button" className={smallButtonClass} onClick={openEditor}>
              수정
            </button>
            <button
              type="button"
              className={smallButtonClass}
              onClick={() => onRequestDelete(row)}
            >
              삭제
            </button>
          </span>
        )}
      </div>

      {canEdit && isEditing && (
        <div className="mt-1 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1">
            <input
              type="text"
              className={`${inputClass} min-w-40 flex-1`}
              value={goalText}
              disabled={isSubmitting || isConflict}
              aria-label="목표"
              autoComplete="off"
              onChange={(event) => setGoalText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            {isConflict ? (
              <button type="button" className={smallButtonClass} onClick={reloadAfterConflict}>
                최신 정보 다시 불러오기
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={smallButtonClass}
                  disabled={isSubmitting}
                  onClick={() => {
                    setIsEditing(false);
                    setErrorMessage(null);
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                  onClick={() => void save()}
                >
                  {isSubmitting ? "저장 중..." : "저장"}
                </button>
              </>
            )}
          </div>
          {errorMessage && (
            <p role="alert" className={errorClass}>
              {errorMessage}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * 상자 하나 — `RFG 금주 목표` 또는 `MB 금주 목표`.
 *
 * 어느 상자로 갈지는 **수리 건의 종류가 정한다**(조회가 접어 준 kind). 사람이
 * 고르는 값이 아니라서 상자마다 '줄 추가'를 두지 않는다 — 그러면 RFG 상자에서
 * MB 건을 고를 수 있게 되고, 추가한 줄이 옆 상자에 나타난다. 추가는 상자 위에
 * 하나뿐이다.
 */
function GoalBox({
  kind,
  rows,
  canEdit,
  onRequestDelete,
}: {
  kind: WeeklyReportKind;
  rows: WeeklyReportGoalRow[];
  canEdit: boolean;
  onRequestDelete: (row: WeeklyReportGoalRow) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* 이 줄은 접지 않는다 — 집계 화면의 블록 소제목과 같은 규칙이다(사용자
          결정: 창을 줄여도 줄바꿈하지 않는다). 폭은 이미 맞다: 이 줄과 아래 표
          상자가 둘 다 부모 폭을 그대로 쓴다. */}
      <div
        className={`flex items-baseline justify-between gap-x-3 gap-y-0.5 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-800 ${GOAL_HEADING_TONE}`}
      >
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{kind} 금주 목표</h3>
        <p className="text-[11px] whitespace-nowrap text-zinc-600 dark:text-zinc-400">
          <span className="text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {rows.length}
          </span>
          줄
        </p>
      </div>
      {/* 한쪽이 비어도 상자는 자리를 지킨다 — 지우면 좌우가 어긋나 RFG 와 MB 를
          견줄 수 없다(이 화면의 다른 줄과 같은 규칙). */}
      <div className="min-h-16 rounded border border-zinc-200 dark:border-zinc-800">
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
            적어 둔 목표가 없습니다.
          </p>
        ) : (
          <ul>
            {rows.map((row) => (
              <GoalLine
                key={row.id}
                row={row}
                canEdit={canEdit}
                onRequestDelete={onRequestDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * 줄 추가 — 인수번호로 수리 건을 찾고 목표를 타이핑한다.
 *
 * 고르개의 방식은 내자 정리 수정 폼과 **같다**(DomesticOrderEditForm): 검색 칸이
 * 먼저 있고 그 아래 `<select>` 에 걸린 것만 남는다. 거르는 규칙 자체는 화면에
 * 적지 않고 domain 의 filterRepairCaseLinkOptions 를 부른다 — 같은 글자가
 * 화면마다 다르게 걸리면 안 된다. 건수가 200을 넘어서 드롭다운 하나로는 원하는
 * 건을 찾을 수 없다는 사정도 그쪽과 같다.
 *
 * 차례(display_order)는 칸을 두지 않는다. 적지 않으면 null 이고 그 줄은 뒤로
 * 가는데(domain 의 sortWeeklyReportGoals), 매주 새로 적는 메모라 적은 차례가 곧
 * 사람이 뜻한 차례다.
 *
 * ── 평소에는 접혀 있다 ─────────────────────────────────────────────────
 * 이 화면은 매주 넘겨 보는 **문서**라 평소에는 표만 보이면 된다. 여닫는 것은
 * 부르는 쪽이고(이 폼은 열려 있을 때만 그려진다), 여기서는 접는 버튼 하나를
 * 더 그릴 뿐이다 — 상태를 이 안에 두면 부르는 쪽의 토글 버튼이 자기가 여는 것이
 * 지금 열려 있는지 알 수 없다(aria-expanded 를 적을 수가 없다).
 *
 * **추가에 성공해도 닫지 않는다.** 한 번에 여러 줄을 넣는 일이 흔해서, 성공할
 * 때마다 접히면 매번 다시 열어야 한다. 성공하면 입력만 비운다(아래 submit).
 */
function GoalAddForm({
  formId,
  weekStart,
  repairCaseOptions,
  onClose,
}: {
  /** 여는 버튼의 aria-controls 가 가리키는 id. useId 로 만든 값이다(부르는 쪽). */
  formId: string;
  weekStart: string;
  repairCaseOptions: RepairCaseLinkOption[];
  /** 접기. 사람이 `취소` 를 누를 때만 불린다 — 저장에 성공해도 부르지 않는다. */
  onClose: () => void;
}) {
  const router = useRouter();
  const [repairCaseId, setRepairCaseId] = useState("");
  /** 검색어. **저장되는 값이 아니다** — 아래 목록에 무엇이 남는지만 정한다. */
  const [query, setQuery] = useState("");
  const [goalText, setGoalText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const matched = useMemo(
    () => filterRepairCaseLinkOptions(repairCaseOptions, query),
    [repairCaseOptions, query]
  );
  // 지금 고른 건은 검색어에 걸리지 않아도 목록에 남아야 한다 — 안 남기면
  // select 가 첫 항목을 보여 주면서 state 에는 그 건이 남아 화면이 거짓말을
  // 한다(domain/repair-case-link-search.ts 의 keepSelectedRepairCaseOption).
  const visible = useMemo(
    () => keepSelectedRepairCaseOption(repairCaseOptions, matched, repairCaseId),
    [repairCaseOptions, matched, repairCaseId]
  );

  async function submit() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setFieldErrors({});
    setErrorMessage(null);
    try {
      const result = await createWeeklyReportGoalAction({
        fields: { weekStartDate: weekStart, repairCaseId, goalText, displayOrder: null },
      });

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setErrorMessage(result.message);
        return;
      }

      // 다음 줄을 이어 적는 자리다 — 검색어까지 지우면 같은 고객사의 다음 건을
      // 찾으려고 매번 다시 쳐야 한다. 고른 건과 목표 글만 비운다.
      setRepairCaseId("");
      setGoalText("");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      id={formId}
      className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="weekly-report-goal-repairCaseId">
            수리 건
          </label>
          {/* 검색 칸이 먼저다. 여기서 무엇을 치든 저장되는 값은 아니다. */}
          <input
            type="search"
            className={`${inputClass} mb-1`}
            value={query}
            disabled={isSubmitting}
            placeholder="인수번호로 검색 (고객사 · 형식도 됩니다)"
            aria-label="수리 건 검색"
            aria-controls="weekly-report-goal-repairCaseId"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            id="weekly-report-goal-repairCaseId"
            className={inputClass}
            value={repairCaseId}
            disabled={isSubmitting}
            onChange={(event) => setRepairCaseId(event.target.value)}
          >
            <option value="">수리 건 선택</option>
            {visible.map((option) => (
              <option key={option.id} value={option.id}>
                {[option.intakeNumber, option.customerName, option.modelName]
                  .filter((part): part is string => Boolean(part))
                  .join(" · ")}
              </option>
            ))}
          </select>
          {/* 아무것도 안 걸렸다는 사실을 말해 준다 — 이 말이 없으면 빈 목록이
              "고를 수 있는 건이 없다"로 읽힌다. */}
          {matched.length === 0 && (
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              검색어에 맞는 수리 건이 없습니다.
            </p>
          )}
          {fieldErrors.repairCaseId && <p className={errorClass}>{fieldErrors.repairCaseId}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="weekly-report-goal-goalText">
            목표
          </label>
          <input
            id="weekly-report-goal-goalText"
            type="text"
            className={inputClass}
            value={goalText}
            disabled={isSubmitting}
            placeholder="예: 견적서 발행"
            autoComplete="off"
            onChange={(event) => setGoalText(event.target.value)}
          />
          {fieldErrors.goalText && <p className={errorClass}>{fieldErrors.goalText}</p>}
        </div>
      </div>

      {/* 어느 상자로 갈지는 사람이 고르지 않는다는 사실을 적어 둔다 — 안 적으면
          "RFG 인데 왜 MB 에 생겼나"로 읽힌다. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          RFG · MB 는 고르지 않습니다 — 고른 수리 건의 종류가 정합니다.
        </p>
        <span className="flex flex-wrap items-center gap-1">
          {/* 여는 버튼을 다시 누르는 것과 같은 일을 한다 — 폼 안에서도 닫을 수
              있어야 한다. 폼은 접히면서 사라지므로 입력하던 값도 함께 없어진다
              (다시 열면 빈 폼이다). 사람이 누를 때만 일어나는 일이다. */}
          <button
            type="button"
            className={smallButtonClass}
            disabled={isSubmitting}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "추가 중..." : "줄 추가"}
          </button>
        </span>
      </div>

      {errorMessage && (
        <p role="alert" className={errorClass}>
          {errorMessage}
        </p>
      )}
    </form>
  );
}

export default function WeeklyReportGoalsPanel({
  weekStart,
  currentWeekStart,
  goals,
  canEdit,
  repairCaseOptions,
  gridClass,
}: {
  /** 지금 보고 있는 주의 월요일 — 주소의 `?week=` 이 이미 접힌 값이다. */
  weekStart: string;
  /**
   * **서버가 한국 표준시로 정한** 이번 주 월요일. 클라이언트에서
   * weekStartOfKst() 를 부르면 서버가 그린 것과 달라져 hydration 이 어긋나고,
   * 한국 표준시 대신 브라우저의 시간대로 주가 정해진다(월요일 오전 0시대에
   * 실제로 다른 값이 나온다).
   */
  currentWeekStart: string;
  /** 그 주의 목표 줄 전부. 차례는 조회가 이미 정했다(display_order, created_at). */
  goals: WeeklyReportGoalRow[];
  /** 적을 수 있는가. 거짓이면 입력칸도 버튼도 그리지 않는다(파일 헤더). */
  canEdit: boolean;
  /** '줄 추가'의 수리 건 고르개 목록. 못 고치는 사람에게는 빈 배열이다. */
  repairCaseOptions: RepairCaseLinkOption[];
  /**
   * 좌우 배치(왼쪽 RFG · 오른쪽 MB). WeeklyReportScreen 의 SIDE_BY_SIDE_GRID 를
   * 그대로 받는다 — 이 화면의 모든 줄이 **같은 폭에서 같이** 갈려야 하므로 값을
   * 한 곳에 둔다(그 상수 주석). 여기 따로 적으면 한쪽만 고쳐진다.
   */
  gridClass: string;
}) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<WeeklyReportGoalRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleteConflict, setIsDeleteConflict] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /**
   * 줄 추가 폼이 펼쳐져 있는가. 기본은 접힘 — 이 화면은 매주 넘겨 보는 문서라
   * 평소에는 표만 보이는 편이 낫다(GoalAddForm 헤더).
   *
   * ⚠️ <details>/<summary> 를 쓰지 않는다. 이 저장소가 그것을 못 쓰는 자리에서
   * 왜 평범한 상태 하나로 푸는지는 FilterDisclosure 헤더에 적혀 있다.
   */
  const [isAddOpen, setIsAddOpen] = useState(false);
  /**
   * 여는 버튼이 aria-controls 로 가리킬 id. **고정 문자열을 쓰면 안 된다** —
   * 이 화면에는 같은 모양의 접기가 납입 예정 건 쪽에도 하나 있어, 박아 두면 한
   * 문서에 같은 id 가 둘 생긴다.
   */
  const addFormId = useId();

  const isCurrentWeek = weekStart === currentWeekStart;
  const previousWeekStart = addCalendarDays(weekStart, -7);
  const nextWeekStart = addCalendarDays(weekStart, 7);

  // 종류별로 가른다. 어느 상자로 갈지는 조회가 이미 접어 준 kind 가 정한다 —
  // 여기서 워크플로 종류를 다시 접지 않는다(queries 헤더).
  const rowsByKind = useMemo(() => {
    const buckets = new Map<WeeklyReportKind, WeeklyReportGoalRow[]>(
      WEEKLY_REPORT_KINDS.map((kind) => [kind, [] as WeeklyReportGoalRow[]])
    );
    for (const row of goals) buckets.get(row.kind)?.push(row);
    return buckets;
  }, [goals]);

  function requestDelete(row: WeeklyReportGoalRow) {
    setDeleteTarget(row);
    setDeleteError(null);
    setIsDeleteConflict(false);
  }

  function closeDeleteDialog() {
    if (isDeleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
    setIsDeleteConflict(false);
  }

  async function confirmDelete() {
    if (deleteTarget === null || isDeleting || isDeleteConflict) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteWeeklyReportGoalAction({
        id: deleteTarget.id,
        expectedVersion: deleteTarget.version,
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          setIsDeleteConflict(true);
          setDeleteError(result.message);
          return;
        }
        setDeleteError(result.message);
        return;
      }

      setDeleteTarget(null);
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  }

  async function copyFromPreviousWeek() {
    if (isCopying) return;
    setIsCopying(true);
    setCopyMessage(null);
    try {
      const result = await copyWeeklyReportGoalsAction({
        fromWeekStart: previousWeekStart,
        toWeekStart: weekStart,
      });

      if (!result.ok) {
        setCopyMessage({ ok: false, text: result.message });
        return;
      }

      // ⚠️ 두 숫자를 그대로 알려 준다. 건너뛴 건수를 감추면 "왜 5건만 왔는가"를
      // 알 길이 없다 — 대상 주에 이미 있는 수리 건은 덮지 않고 건너뛴다
      // (mutations/weekly-report-goals.ts).
      const skippedText =
        result.skipped > 0 ? ` ${result.skipped}건은 이미 있어 건너뛰었습니다.` : "";
      setCopyMessage({ ok: true, text: `${result.copied}건 가져왔습니다.${skippedText}` });
      router.refresh();
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 주 이동은 링크다 — 서버 컴포넌트가 그 주의 목표를 다시 조회해야
            한다(파일 헤더). 버튼으로 두면 화면만 바뀌고 자료는 그대로다. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={weekHref(previousWeekStart)} className={smallButtonClass}>
            ◀ 지난주
          </Link>
          {/* 이 구역의 제목이다 — 화면의 다른 구역(종류별 총합 · PO 발행 현황)과
              같은 h2 자리다. 상자 둘의 소제목이 그 아래 h3 로 이어진다. */}
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {weekLabel(weekStart)}
          </h2>
          <Link href={weekHref(nextWeekStart)} className={smallButtonClass}>
            다음주 ▶
          </Link>
        </div>

        {canEdit && (
          <button
            type="button"
            className={smallButtonClass}
            disabled={isCopying}
            aria-busy={isCopying}
            onClick={() => void copyFromPreviousWeek()}
          >
            {isCopying ? "가져오는 중..." : "지난주에서 가져오기"}
          </button>
        )}
      </div>

      {/* ⚠️ 집계는 언제나 '지금'이다(파일 헤더). 이번 주가 아닐 때 이 한 줄이
          없으면, 사람은 집계도 그 주의 상태라고 읽는다.

          이 문장에 `아래`·`위` 를 다시 붙이지 말 것 — 자리는 WeeklyReportScreen 이
          정하고 한 번 바뀌어 이 말이 거짓이 된 적이 있다(파일 헤더). */}
      {!isCurrentWeek && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          이번 주가 아닌 {weekLabel(weekStart)}를 보고 있습니다. 목표만 그 주의 것이고,{" "}
          <strong className="font-semibold">집계는 지금 이 순간의 상태입니다</strong> — 그 주의
          진행 상황이 아닙니다.{" "}
          <Link
            href={weekHref(currentWeekStart)}
            className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
          >
            이번 주로
          </Link>
        </p>
      )}

      {copyMessage && (
        <p
          role="status"
          className={
            copyMessage.ok
              ? "rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
              : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
          }
        >
          {copyMessage.text}
        </p>
      )}

      {/* 줄 추가는 접혀 있다 — 못 고치는 사람에게는 여는 버튼도 보이지 않는다
          (폼이 안 보이던 것과 같은 조건). 주 이동 줄은 이 접기에 들어가지 않는다:
          그 줄은 보기만 하는 사람에게도 필요하다. */}
      {canEdit && (
        <div className="flex flex-col gap-2">
          <div>
            <button
              type="button"
              className={smallButtonClass}
              aria-expanded={isAddOpen}
              aria-controls={addFormId}
              onClick={() => setIsAddOpen((prev) => !prev)}
            >
              {isAddOpen ? "－ 줄 추가 닫기" : "＋ 줄 추가"}
            </button>
          </div>
          {isAddOpen && (
            <GoalAddForm
              formId={addFormId}
              weekStart={weekStart}
              repairCaseOptions={repairCaseOptions}
              onClose={() => setIsAddOpen(false)}
            />
          )}
        </div>
      )}

      <div className={gridClass}>
        {WEEKLY_REPORT_KINDS.map((kind) => (
          <GoalBox
            key={kind}
            kind={kind}
            rows={rowsByKind.get(kind) ?? []}
            canEdit={canEdit}
            onRequestDelete={requestDelete}
          />
        ))}
      </div>

      {/* 확인창은 상자마다가 아니라 여기 하나다 — 줄마다 두면 상자 하나에
          <dialog> 가 줄 수만큼 생긴다. */}
      <WeeklyReportGoalDeleteDialog
        isOpen={deleteTarget !== null}
        line={
          deleteTarget === null
            ? ""
            : formatGoalLine(buildGoalPrefix(deleteTarget), deleteTarget.goalText)
        }
        isSubmitting={isDeleting}
        errorMessage={deleteError}
        isConflict={isDeleteConflict}
        onConfirm={() => void confirmDelete()}
        onCancel={closeDeleteDialog}
        onReloadAfterConflict={() => {
          setDeleteTarget(null);
          setDeleteError(null);
          setIsDeleteConflict(false);
          router.refresh();
        }}
      />
    </section>
  );
}
