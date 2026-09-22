"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { generateClientUuid } from "@/lib/client-uuid";
import {
  PartSuggestionList,
  filterPartOptions,
  partPickPatch,
} from "@dss/core/ui/inventory/part-picker";
import type { PartPickerRow } from "@/lib/db/queries/inventory";
import type { RepairCaseUsedPartRow } from "@/lib/db/queries/repair-case-used-parts";
import { saveRepairCaseUsedPartsAction } from "@/lib/server/actions/repair-case-used-parts";
import { MAX_USED_PART_LINES } from "@/lib/validation/repair-case-used-parts-input";
import EditSectionActions, { editErrorClass, editInputClass, editLabelClass } from "./EditSectionActions";
import type { SectionEditConflictError } from "./useSectionEditSubmit";

/**
 * ============================================================================
 * 「사용 부품」 줄을 더하고 · 지우고 · 저장한다 (B-2)
 * ============================================================================
 * 이 폼이 열리는 조건은 화면이 정하지 않는다 — 서버가 내린 판정
 * (usedParts.writeGate)이 ok 일 때만 UsedPartsSection 이 이것을 그린다. 그래서
 * 여기에는 「적을 수 있는 건인가」를 따지는 줄이 하나도 없다.
 *
 * ── 🔴 고르면 붙고, 고쳐 쓰면 풀린다 ────────────────────────────────────────
 * 이 칸의 목적이 통계라 **같은 부품이 같은 것으로 묶여야** 한다(`RF 모듈` ·
 * `RF모듈` 이 서로 다른 조각이 되면 원이 부스러진다). 그래서 견적서가 쓰는 그
 * 부품 고르개(@dss/core/ui/inventory/part-picker.tsx)를 그대로 재사용하고, 고르면 partId 가
 * 붙는다.
 *
 * 다만 **마스터에 없는 부품은 손으로 적을 수 있어야 한다** — 옛 건에는 지금
 * 마스터에 없는 부품이 실제로 나오고, 그것을 적을 길이 없으면 이 표를 만든 까닭이
 * 사라진다(schema/repair-case-used-parts.ts 머리말). 그 줄은 partId 없이
 * 저장된다. 글자를 고치면 붙어 있던 연결도 풀린다 — 화면의 글자와 통계가 세는
 * 부품이 서로 다른 것을 가리키면 안 되기 때문이다.
 *
 * ── 줄 번호는 여기서 만들지 않는다 ──────────────────────────────────────────
 * 화면의 `key` 는 React 가 줄을 구분하는 데만 쓰는 값이고, 저장 요청에 실리지
 * 않는다. `line_no` 는 서버가 배열 차례로 매긴다.
 *
 * ── 수량은 글자로 들고 있다 ─────────────────────────────────────────────────
 * 숫자 상태로 들고 있으면 사람이 칸을 비우는 순간(지우고 다시 치는 흔한 동작)
 * 0 이나 NaN 으로 튀어 화면이 제멋대로 바뀐다. 글자로 두고 보낼 때만 숫자로
 * 바꾼다 — 빈 칸은 그대로 검사에 걸려 「1 이상의 정수」 안내를 받는다.
 * ============================================================================
 */

type LineDraft = {
  /** React 가 줄을 구분하는 값. 서버로 가지 않는다. */
  key: string;
  partId: string | null;
  partNameText: string;
  /** 위 머리말 '수량은 글자로 들고 있다'. */
  quantity: string;
};

function toDraft(row: RepairCaseUsedPartRow): LineDraft {
  return {
    key: generateClientUuid(),
    partId: row.partId,
    partNameText: row.partNameText,
    quantity: String(row.quantity),
  };
}

function emptyDraft(): LineDraft {
  return { key: generateClientUuid(), partId: null, partNameText: "", quantity: "1" };
}

/** 충돌로 폼이 얼기 직전에 붙잡아 두는 글 — 적어 둔 줄을 잃지 않게. */
function buildDraftText(lines: readonly LineDraft[]): string {
  return lines
    .filter((line) => line.partNameText.trim() !== "")
    .map((line) => `${line.partNameText.trim()} — ${line.quantity}개`)
    .join("\n");
}

export default function UsedPartsEditForm({
  repairCaseId,
  version,
  rows,
  partOptions,
  onDone,
}: {
  repairCaseId: string;
  /** 접수 건의 version — 사용 부품도 그 건의 자료라 같은 번호로 다툰다. */
  version: number;
  rows: readonly RepairCaseUsedPartRow[];
  /** 부품 마스터(queries/inventory.ts 의 getPartPickerList). 거르기는 브라우저에서 한다. */
  partOptions: readonly PartPickerRow[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<LineDraft[]>(() =>
    rows.length > 0 ? rows.map(toDraft) : [emptyDraft()]
  );
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | SectionEditConflictError | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  const disabled = isSubmitting || isConflict;

  function updateLine(key: string, patch: Partial<Omit<LineDraft, "key">>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    // 🔴 마지막 줄까지 지울 수 있어야 한다 — 잘못 적어 둔 것을 전부 걷어내는 길이
    //    「빈 목록 저장」뿐이기 때문이다(검사기도 빈 목록을 통과시킨다).
    setLines((prev) => prev.filter((line) => line.key !== key));
    setPickerKey((prev) => (prev === key ? null : prev));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;

    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const result = await saveRepairCaseUsedPartsAction({
        repairCaseId,
        expectedVersion: version,
        lines: lines.map((line) => ({
          partId: line.partId,
          partNameText: line.partNameText,
          quantity: Number(line.quantity),
        })),
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 낡은 폼에서 다시 저장이 나가는 길을 없앤다 — 세 구간 편집 폼과 같은 규칙.
          setIsConflict(true);
          setSubmitError({ message: result.message, draftText: buildDraftText(lines) });
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      router.refresh();
      onDone();
      // 🔴 이 팝업은 넘기지 않는다(redirectTo: null) — 사용 부품은 상세 화면을 보며
      //    이어서 적는 칸이라, 저장할 때마다 목록으로 튀면 쓸 수 없다.
      showSavePopup({ message: "사용 부품을 저장했습니다.", redirectTo: null });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-3">
      {fieldErrors.lines && <p className={editErrorClass}>{fieldErrors.lines}</p>}

      {lines.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          줄이 하나도 없습니다. 이대로 저장하면 적어 둔 부품이 모두 지워집니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <li key={line.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_6rem_auto]">
              {/* 🔴 `relative` — 부품 후보 목록이 이 칸 **바로 밑에** 떠야 한다.
                  흐름 안에 두면 목록이 뜰 때마다 밑의 줄들이 밀려 내려가, 고르려던
                  자리가 눈앞에서 움직인다(견적서 품명 칸과 같은 까닭). */}
              <div className="relative">
                <label className={editLabelClass} htmlFor={`used-part-name-${line.key}`}>
                  {index + 1}번째 품명
                </label>
                <input
                  id={`used-part-name-${line.key}`}
                  value={line.partNameText}
                  /**
                   * 🔴 글자를 치면 재고 연결을 **푼다**(partId: null). 고른 뒤 이름만
                   * 고쳤는데 part_id 가 남아 있으면 화면의 글자와 통계가 세는 부품이
                   * 서로 다른 것을 가리킨다.
                   */
                  onChange={(e) => {
                    updateLine(line.key, { partNameText: e.target.value, partId: null });
                    setPickerKey(line.key);
                  }}
                  onFocus={() => setPickerKey(line.key)}
                  /* 다른 줄을 펴 두었으면 그것을 닫지 않는다 — 닫는 것은 제 줄뿐이다. */
                  onBlur={() => setPickerKey((prev) => (prev === line.key ? null : prev))}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setPickerKey(null);
                  }}
                  placeholder="부품 품명 (마스터에 없으면 그냥 적으세요)"
                  className={editInputClass}
                  disabled={disabled}
                  /* 브라우저가 제 기억으로 만든 목록이 부품 후보 위에 겹쳐 뜨지 않게. */
                  autoComplete="off"
                />
                {pickerKey === line.key && !disabled && (
                  <PartSuggestionList
                    options={filterPartOptions(partOptions, line.partNameText)}
                    listLabel={`${index + 1}번째 부품 후보`}
                    onPick={(option) => {
                      updateLine(line.key, partPickPatch(option));
                      setPickerKey(null);
                    }}
                  />
                )}
                {fieldErrors[`lines.${index}.partNameText`] && (
                  <p className={editErrorClass}>{fieldErrors[`lines.${index}.partNameText`]}</p>
                )}
                {fieldErrors[`lines.${index}.partId`] && (
                  <p className={editErrorClass}>{fieldErrors[`lines.${index}.partId`]}</p>
                )}
              </div>

              <div>
                <label className={editLabelClass} htmlFor={`used-part-qty-${line.key}`}>
                  수량
                </label>
                <input
                  id={`used-part-qty-${line.key}`}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  className={editInputClass}
                  disabled={disabled}
                />
                {fieldErrors[`lines.${index}.quantity`] && (
                  <p className={editErrorClass}>{fieldErrors[`lines.${index}.quantity`]}</p>
                )}
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  disabled={disabled}
                  aria-label={`${index + 1}번째 줄 삭제`}
                  className="rounded-md border border-red-200 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2">
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, emptyDraft()])}
          disabled={disabled || lines.length >= MAX_USED_PART_LINES}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          줄 추가
        </button>
        {lines.length >= MAX_USED_PART_LINES && (
          <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
            {MAX_USED_PART_LINES}줄까지 적을 수 있습니다.
          </span>
        )}
      </div>

      <EditSectionActions
        isSubmitting={isSubmitting}
        isConflict={isConflict}
        submitError={submitError}
        onCancel={onDone}
        onReloadAfterConflict={() => {
          router.refresh();
          onDone();
        }}
      />
    </form>
  );
}
