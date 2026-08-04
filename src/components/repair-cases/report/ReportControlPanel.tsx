"use client";

import { useMemo, useState } from "react";
import { validateActivityDateRange } from "@/lib/domain/local/activity/filters";
import {
  ACTIVITY_LIMIT_CODES,
  activityLimitLabels,
  ENABLED_REPORT_TYPES,
  REDACTION_MODE_CODES,
  redactionModeLabels,
  REPORT_SECTION_CODES,
  REPORT_TYPE_CODES,
  REPORT_TYPE_COMING_SOON_NOTICE,
  REQUIRED_REPORT_SECTIONS,
  reportSectionLabels,
  reportTypeLabels,
  type ActivityLimit,
  type RedactionMode,
  type ReportSection,
  type ReportSelection,
} from "@/lib/domain/local/report/report-types";
import type { ReportMalformedSource } from "@/lib/domain/local/report/use-report-data";

/**
 * Stage F-1 전용 순수 제어 컴포넌트다. ReportSelection을 소유하지 않는다 —
 * 모든 값과 변경 핸들러를 props로만 받고, 변경은 항상 onSelectionChange에
 * "다음 ReportSelection 전체 객체"를 넘기는 방식으로만 알린다. 이 컴포넌트가
 * 직접 보고서 데이터를 만들거나, localStorage/세션을 읽거나, 접수 건을
 * 조회하거나, window.print()를 호출하지 않는다.
 *
 * 유일한 예외는 시작일/종료일 입력의 로컬 draft 상태다(요구사항 7) —
 * ReportSelection.activityDateFrom/activityDateTo를 그대로 매 키 입력마다
 * onSelectionChange로 올리면 잘못된 범위(예: 시작일이 종료일보다 늦음)가
 * 그대로 부모 상태에 반영될 수 있으므로, 검증을 통과했을 때만 커밋한다.
 * ReportSelection 자체를 통째로 복제해 별도 상태로 만들지는 않는다.
 */

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";
const errorClass = "text-xs text-red-600 dark:text-red-400";
const cardClass = "flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500";

const REDACTION_MODE_DESCRIPTIONS: Record<RedactionMode, string> = {
  NONE: "고객사·장비 식별정보를 그대로 표시합니다.",
  PARTIAL: "고객명·일련번호·LOT 번호 등 일부 식별정보만 부분적으로 가립니다.",
  DEMO_SAFE: "고객사·장비 식별정보를 전부 숨기고 데모 공유에 안전한 형태로 표시합니다.",
};

const MALFORMED_SOURCE_LABELS: Record<ReportMalformedSource, string> = {
  WORKFLOW: "워크플로 데이터",
  APPROVAL: "승인 데이터",
  DELEGATION: "승인 위임 데이터",
  ATTACHMENT: "첨부파일 데이터",
};

export type ReportControlPanelProps = {
  selection: ReportSelection;
  onSelectionChange: (next: ReportSelection) => void;
  malformedSources: readonly ReportMalformedSource[];
  hasDataWarnings: boolean;
  isReportReady: boolean;
  onReset: () => void;
  onRefreshGeneratedAt: () => void;
};

export default function ReportControlPanel({
  selection,
  onSelectionChange,
  malformedSources,
  hasDataWarnings,
  isReportReady,
  onReset,
  onRefreshGeneratedAt,
}: ReportControlPanelProps) {
  // 시작일/종료일 로컬 draft — 상세 설계는 파일 상단 주석 참고.
  const [draftDateFrom, setDraftDateFrom] = useState(selection.activityDateFrom);
  const [draftDateTo, setDraftDateTo] = useState(selection.activityDateTo);

  // 부모가 committed 값을 바꾸면(예: onReset) draft도 그 값으로 재동기화해야
  // 한다. useEffect+setState로 하면 불필요한 추가 렌더가 생기므로, React가
  // 권장하는 "렌더 중 상태 조정" 패턴을 쓴다 — committed 값의 거울(mirror)을
  // 함께 들고 있다가 그 거울이 실제 committed 값과 달라진 시점(=부모가 값을
  // 바꾼 시점)에만 조건부로 setState한다. 우리가 스스로 커밋한 경우에도 이
  // 값들은 우리가 막 커밋한 값과 같으므로 이 재동기화는 사실상 no-op이다.
  const [committedDateFromMirror, setCommittedDateFromMirror] = useState(selection.activityDateFrom);
  if (selection.activityDateFrom !== committedDateFromMirror) {
    setCommittedDateFromMirror(selection.activityDateFrom);
    setDraftDateFrom(selection.activityDateFrom);
  }
  const [committedDateToMirror, setCommittedDateToMirror] = useState(selection.activityDateTo);
  if (selection.activityDateTo !== committedDateToMirror) {
    setCommittedDateToMirror(selection.activityDateTo);
    setDraftDateTo(selection.activityDateTo);
  }

  const dateValidation = useMemo(
    () => validateActivityDateRange(draftDateFrom, draftDateTo),
    [draftDateFrom, draftDateTo]
  );

  function commitDateRangeIfValid(nextFrom: string, nextTo: string) {
    const validation = validateActivityDateRange(nextFrom, nextTo);
    if (validation.fromError || validation.toError || validation.rangeError) return;
    onSelectionChange({ ...selection, activityDateFrom: nextFrom, activityDateTo: nextTo });
  }

  function handleDateFromChange(value: string) {
    setDraftDateFrom(value);
    commitDateRangeIfValid(value, draftDateTo);
  }

  function handleDateToChange(value: string) {
    setDraftDateTo(value);
    commitDateRangeIfValid(draftDateFrom, value);
  }

  /** BASIC_INFO/CURRENT_STATUS/LIMITATIONS는 절대 false가 될 수 없다 — UI에서
   * disabled로도 막지만, 여기서도 한 번 더 막는다(단일 진입점). DATA_WARNINGS는
   * "포함할 항목" 목록의 체크박스와 아래 "데이터 경고" 영역의 전용 체크박스
   * 두 곳에서 조작할 수 있으므로, 항상 sections.DATA_WARNINGS와
   * includeWarningsInDocument 두 필드를 함께 갱신해 두 UI가 어긋나지 않게 한다. */
  function setSectionChecked(section: ReportSection, checked: boolean) {
    if (REQUIRED_REPORT_SECTIONS.has(section)) return;
    if (section === "DATA_WARNINGS") {
      onSelectionChange({
        ...selection,
        includeWarningsInDocument: checked,
        sections: { ...selection.sections, DATA_WARNINGS: checked },
      });
      return;
    }
    onSelectionChange({ ...selection, sections: { ...selection.sections, [section]: checked } });
  }

  const activityTimelineSelected = selection.sections.ACTIVITY_TIMELINE;

  return (
    <div className="flex flex-col gap-4 print:hidden">
      <fieldset className={cardClass}>
        <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">보고서 종류</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {REPORT_TYPE_CODES.map((code) => {
            const enabled = ENABLED_REPORT_TYPES.has(code);
            return (
              <label
                key={code}
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  enabled
                    ? "border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                    : "border-zinc-100 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
                }`}
              >
                <input
                  type="radio"
                  name="report-type"
                  value={code}
                  checked={selection.reportType === code}
                  disabled={!enabled}
                  onChange={() => {
                    if (!enabled) return;
                    onSelectionChange({ ...selection, reportType: code });
                  }}
                  className={`mt-0.5 ${focusRingClass}`}
                />
                <span>{reportTypeLabels[code]}</span>
              </label>
            );
          })}
        </div>
        <p className={labelClass}>{REPORT_TYPE_COMING_SOON_NOTICE}</p>
      </fieldset>

      <fieldset className={cardClass}>
        <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">포함할 항목</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {REPORT_SECTION_CODES.map((section) => {
            const required = REQUIRED_REPORT_SECTIONS.has(section);
            return (
              <label key={section} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={selection.sections[section]}
                  disabled={required}
                  onChange={(event) => setSectionChecked(section, event.target.checked)}
                  className={`mt-0.5 ${focusRingClass}`}
                />
                <span>
                  {reportSectionLabels[section]}
                  {required && <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">(항상 포함)</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={cardClass}>
        <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">마스킹(리댁션) 방식</legend>
        <div className="flex flex-col gap-2">
          {REDACTION_MODE_CODES.map((mode) => (
            <label
              key={mode}
              className="flex items-start gap-2 rounded-md border border-zinc-200 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              <input
                type="radio"
                name="redaction-mode"
                value={mode}
                checked={selection.redactionMode === mode}
                onChange={() => onSelectionChange({ ...selection, redactionMode: mode })}
                className={`mt-0.5 ${focusRingClass}`}
              />
              <span>
                <span className="block font-medium text-zinc-900 dark:text-zinc-50">{redactionModeLabels[mode]}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{REDACTION_MODE_DESCRIPTIONS[mode]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={cardClass}>
        <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">첨부파일 옵션</legend>
        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={selection.includeDeletedAttachments}
            onChange={(event) => onSelectionChange({ ...selection, includeDeletedAttachments: event.target.checked })}
            className={`mt-0.5 ${focusRingClass}`}
          />
          <span>삭제된 첨부파일 포함</span>
        </label>
        <p className={labelClass}>현재 메타데이터 기준이며, 실제 파일 내용은 포함되지 않습니다.</p>
      </fieldset>

      <fieldset className={cardClass}>
        <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">통합 활동 이력 범위</legend>
        {!activityTimelineSelected && (
          <p className={labelClass}>&quot;포함할 항목&quot;에서 통합 활동 이력을 선택해야 아래 범위 설정이 적용됩니다.</p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="report-activity-limit" className={labelClass}>
              표시 범위
            </label>
            <select
              id="report-activity-limit"
              className={selectClass}
              value={selection.activityLimit}
              disabled={!activityTimelineSelected}
              onChange={(event) => onSelectionChange({ ...selection, activityLimit: event.target.value as ActivityLimit })}
            >
              {ACTIVITY_LIMIT_CODES.map((code) => (
                <option key={code} value={code}>
                  {activityLimitLabels[code]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="report-activity-date-from" className={labelClass}>
              시작일
            </label>
            <input
              id="report-activity-date-from"
              type="date"
              className={inputClass}
              value={draftDateFrom}
              disabled={!activityTimelineSelected}
              onChange={(event) => handleDateFromChange(event.target.value)}
              aria-invalid={Boolean(dateValidation.fromError)}
              aria-describedby={dateValidation.fromError ? "report-activity-date-from-error" : undefined}
            />
            {dateValidation.fromError && (
              <p id="report-activity-date-from-error" className={errorClass}>
                {dateValidation.fromError}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="report-activity-date-to" className={labelClass}>
              종료일
            </label>
            <input
              id="report-activity-date-to"
              type="date"
              className={inputClass}
              value={draftDateTo}
              disabled={!activityTimelineSelected}
              onChange={(event) => handleDateToChange(event.target.value)}
              aria-invalid={Boolean(dateValidation.toError)}
              aria-describedby={dateValidation.toError ? "report-activity-date-to-error" : undefined}
            />
            {dateValidation.toError && (
              <p id="report-activity-date-to-error" className={errorClass}>
                {dateValidation.toError}
              </p>
            )}
          </div>
        </div>
        {dateValidation.rangeError && (
          <p role="alert" className={errorClass}>
            {dateValidation.rangeError}
          </p>
        )}
      </fieldset>

      <fieldset className={cardClass}>
        <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">데이터 경고</legend>

        {malformedSources.length > 0 && (
          <div role="alert" className="flex flex-col gap-1">
            {malformedSources.map((source) => (
              <p
                key={source}
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
              >
                {MALFORMED_SOURCE_LABELS[source]}를 확인할 수 없어 이번 세션에서는 빈 상태로 표시합니다.
              </p>
            ))}
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={selection.includeWarningsInDocument}
            disabled={!hasDataWarnings}
            onChange={(event) => setSectionChecked("DATA_WARNINGS", event.target.checked)}
            className={`mt-0.5 ${focusRingClass}`}
          />
          <span>보고서 문서에 데이터 경고 포함</span>
        </label>
        <p className={labelClass}>
          {hasDataWarnings
            ? "이 체크박스를 꺼도 위 화면 경고 배너는 계속 표시됩니다 — 인쇄되는 문서에만 영향을 줍니다."
            : "현재 이 접수 건에는 표시할 데이터 품질 경고가 없습니다."}
        </p>
      </fieldset>

      <div className={`${cardClass} sm:flex-row sm:items-center sm:justify-end`}>
        <button
          type="button"
          onClick={onReset}
          className={`w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 sm:w-auto dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${focusRingClass}`}
        >
          기본값으로 초기화
        </button>
        <button
          type="button"
          onClick={onRefreshGeneratedAt}
          disabled={!isReportReady}
          className={`w-full rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 ${focusRingClass}`}
        >
          생성 시각 갱신
        </button>
      </div>
    </div>
  );
}
