"use client";

import type { ReactNode } from "react";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";

/**
 * 검사·수리 보고서 폼의 입력 칸 조각들.
 *
 * 견적서 폼(`quotes/QuoteEditForm.tsx`)의 `Field` 와 **같은 모양·같은 색**이다 —
 * 라벨은 칸 위, 필수는 `*`, 오류는 칸 밑(UI_GUIDELINE 4). 색은 저장소가 이미
 * 쓰는 `editInputClass`·`editLabelClass`·`editErrorClass` 를 그대로 쓴다.
 * 새로 적으면 다크 모드에서 이 화면만 다른 회색이 된다.
 *
 * 여기 조각을 따로 둔 이유는 폼이 네 구역(머리 / 조치·원인 / 본문 / 비고)으로
 * 나뉘어 있어서다. 구역마다 같은 칸을 다시 적으면 한쪽만 고쳐지는 날이 온다.
 */

export { editErrorClass, editInputClass, editLabelClass };

export function ServiceReportSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{title}</h2>
      {description && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={editLabelClass}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </span>
      {children}
      {error && <p className={editErrorClass}>{error}</p>}
    </label>
  );
}

/**
 * 라벨 하나에 입력이 여럿인 칸(문서번호 세 조각, 발생 년월일의 날짜/글자,
 * 원인 체크박스 열 개). `<label>` 로 감싸면 클릭이 첫 입력으로만 가므로
 * `<fieldset>` 을 쓴다.
 */
export function FieldGroup({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={`mb-1 ${editLabelClass}`}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </legend>
      {children}
      {error && <p className={editErrorClass}>{error}</p>}
    </fieldset>
  );
}

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  disabled,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  inputMode?: "numeric";
}) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
        className={editInputClass}
      />
    </Field>
  );
}

export function DateField({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={editInputClass}
      />
    </Field>
  );
}

/**
 * 양식의 드롭다운을 그대로 옮긴 칸.
 *
 * 🔴 `options` 는 **양식에서 읽은 값**이다(`xlsx/service-report-choices.ts`).
 * 화면에 목록을 베껴 두면 사람이 Excel 에서 항목을 더한 날 화면만 뒤처지고,
 * 그 어긋남은 아무 오류도 내지 않는다 — 아무도 못 고르는 항목이 될 뿐이다.
 *
 * 값에 붙은 앞 공백(` ・ 수리의뢰`)은 양식의 글머리표다. 다듬지 않고 그대로
 * 보낸다.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  error,
  hint,
  disabled,
  emptyLabel = "선택 안 함",
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  error?: string | null;
  hint?: ReactNode;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  /**
   * 고른 값이 목록에 없을 수 있다 — 양식이 바뀌기 전에 채워 둔 값이거나,
   * 목록을 못 읽어 빈 상태다. 그때도 값이 조용히 사라지지 않게 한 줄 얹는다.
   */
  const missing = value !== "" && !options.includes(value);

  return (
    <Field label={label} error={error} hint={hint}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={editInputClass}
      >
        <option value="">{emptyLabel}</option>
        {missing && <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 4,
  error,
  hint,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  error?: string | null;
  hint?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        className={`${editInputClass} resize-y`}
      />
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
      />
      {label}
    </label>
  );
}

/**
 * 남은 줄 수. **넘고 나서 알면 늦다** — 적는 동안 늘 보인다.
 * 넘긴 뒤에는 색이 바뀌고, 그때는 [Excel 내려받기] 도 함께 잠긴다.
 */
export function RowCounter({ used, limit }: { used: number; limit: number }) {
  const remaining = limit - used;
  const over = remaining < 0;
  return (
    <p
      className={`mt-1 text-xs tabular-nums ${
        over ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
      }`}
    >
      {over
        ? `${limit}줄을 ${-remaining}줄 넘었습니다 (지금 ${used}줄)`
        : `${used}/${limit}줄 — ${remaining}줄 남았습니다`}
    </p>
  );
}
