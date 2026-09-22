"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { FileDropZone } from "@/components/common/FileDropZone";
import { KyosanText } from "@/components/kyosan/KyosanText";
import {
  KYOSAN_AGREEMENT_LABEL,
  KYOSAN_AMBIGUOUS_TEXT,
  KYOSAN_CHOICE_CAUTION,
  KYOSAN_DESTINATION_LABEL,
  KYOSAN_DESTINATION_NOTE,
  KYOSAN_PART_KIND_LABEL,
  KYOSAN_REPORT_UPLOAD_MAX_BYTES,
  KYOSAN_UNMATCHED_TEXT,
  kyosanReportLineDestination,
  kyosanReportPartDestination,
  kyosanRepairCaseHref,
  type KyosanReportPreviewReady,
  type KyosanReportSaveOffer,
  type KyosanReportTarget,
} from "@/lib/domain/kyosan-report-import/preview-view";
import type { KyosanAgreement } from "@/lib/kyosan/report-match";
import type { KyosanReportImportResult } from "@/lib/server/services/kyosan-report-import";

/**
 * ============================================================================
 * 연락서 한 장 넣기 — 그리기만 하는 조각 (조각 S4)
 * ============================================================================
 * 상태와 서버 호출은 `KyosanReportImportScreen.tsx` 가 갖는다. 여기는 받은 값을
 * 그리고 누름을 위로 올릴 뿐이다(`KyosanReportImportParts.test.tsx` 가 그려 본다).
 *
 * 🔴 이 파일에는 「넣을 수 있는가」를 정하는 줄이 하나도 없다 — 그 판단은
 * `domain/kyosan-report-import/preview-view.ts` 의 순수 함수에 있다. 단추를
 * 그릴지 말지는 `saveOffer` 와 `canImport` 를 **받아서** 따를 뿐이다.
 * ============================================================================
 */

const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";
const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const LINK_CLASS =
  "font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300";

export const REPORT_SECTION_CLASS =
  "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const TH_CLASS =
  "border-b border-zinc-200 px-2 py-1.5 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400";
const TD_CLASS = "border-b border-zinc-100 px-2 py-1.5 align-top dark:border-zinc-800";

const MAX_MB = Math.floor(KYOSAN_REPORT_UPLOAD_MAX_BYTES / (1024 * 1024));

const AGREEMENT_CLASS: Readonly<Record<KyosanAgreement, string>> = {
  agree: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  differ: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  unknown: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function blank(value: string | null): string {
  return value === null || value.trim() === "" ? "—" : value;
}

/**
 * 🔴 연락서에서 온 글자 한 줄을 그리던 `KyosanText` 는
 * **`@/components/kyosan/KyosanText` 로 옮겼다**(2026-09-22). 상세 화면의 작업
 * 기록·요약 칸도 같은 규칙으로 그려야 해서, 두 벌이 되지 않도록 공용 자리에 뒀다.
 * 여기서 그리는 모양은 옮기기 전과 한 글자도 다르지 않다.
 */
function AgreementBadge({ value }: { value: KyosanAgreement }) {
  return (
    <span
      data-role="kyosan-agreement"
      data-agreement={value}
      className={`ml-1 inline-block rounded px-1 text-[11px] leading-4 ${AGREEMENT_CLASS[value]}`}
    >
      {KYOSAN_AGREEMENT_LABEL[value]}
    </span>
  );
}

// ── 1. 올리기 ─────────────────────────────────────────────────────────────

export function KyosanReportUploadPanel({
  hasFile,
  fileError,
  busy,
  disabled,
  onFileChange,
  onPreview,
}: {
  hasFile: boolean;
  fileError: string | null;
  busy: boolean;
  disabled: boolean;
  onFileChange: (file: File | null) => void;
  onPreview: () => void;
}) {
  const canPreview = hasFile && fileError === null && !busy && !disabled;
  return (
    <section className={REPORT_SECTION_CLASS}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">1. 연락서 올리기</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {`연락서 한 장(.xlsm · .xlsx, ${MAX_MB}MB 이하)을 골라 [미리보기]를 누르세요. 미리보기는 아무것도 저장하지 않습니다.`}
      </p>
      <FileDropZone
        name="kyosan-report-upload"
        multiple={false}
        disabled={busy || disabled}
        hint="여기에 연락서 파일 하나를 놓으세요"
        onFiles={(files) => onFileChange(files[0])}
        className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
      >
        <label htmlFor="kyosan-report-file" className="sr-only">
          교산 연락서 파일
        </label>
        <input
          id="kyosan-report-file"
          type="file"
          accept=".xlsm,.xlsx"
          disabled={busy || disabled}
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          className="block w-full max-w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-zinc-700 hover:file:bg-zinc-100 disabled:opacity-50 sm:w-auto dark:text-zinc-300 dark:file:border-zinc-700 dark:file:bg-zinc-900 dark:file:text-zinc-300"
        />
        <button
          type="button"
          data-role="kyosan-report-preview"
          disabled={!canPreview}
          aria-busy={busy}
          onClick={onPreview}
          className={PRIMARY_BUTTON_CLASS}
        >
          {busy ? "읽는 중..." : "미리보기"}
        </button>
      </FileDropZone>
      {fileError ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {fileError}
        </p>
      ) : null}
    </section>
  );
}

// ── 2. 어느 수리 건에 붙는가 ──────────────────────────────────────────────

/**
 * 🔴 이 화면의 핵심. 후보를 보여 주고 **무엇이 어긋나는지**(모델 · S/N · L/N ·
 * 고객사) 항목마다 표시한다. 짝이 없으면 고를 것도 없다 — 표 대신 까닭만 적고,
 * **수리 건을 새로 만드는 길은 그리지 않는다**(사용자 정책 2026-09-21).
 */
export function KyosanReportMatchPanel({
  preview,
  saveOffer,
  selectedRepairCaseId,
  disabled,
  onSelect,
}: {
  preview: KyosanReportPreviewReady;
  saveOffer: KyosanReportSaveOffer;
  selectedRepairCaseId: string | null;
  disabled: boolean;
  onSelect: (repairCaseId: string) => void;
}) {
  const { match, reportIdentity, targets } = preview;
  return (
    <section data-role="kyosan-report-match" data-match={match.kind} className={REPORT_SECTION_CLASS}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">2. 어느 수리 건에 붙는가</h2>

      {match.kind === "unmatched" ? (
        <div data-role="kyosan-report-unmatched" className="mt-2 space-y-1">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            {`짝이 없습니다 — ${KYOSAN_UNMATCHED_TEXT[match.reason]}`}
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            넣지 않습니다. 🔴 이 화면은 수리 건을 새로 만들지 않습니다 — 수리 건을 먼저 등록한 뒤 다시
            올려 주세요.
          </p>
        </div>
      ) : null}

      {match.kind === "ambiguous" ? (
        <div data-role="kyosan-report-ambiguous" className="mt-2 space-y-1">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {`후보가 ${targets.length}건입니다 — 사람이 골라야 합니다.`}
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{KYOSAN_AMBIGUOUS_TEXT[match.reason]}</p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {KYOSAN_CHOICE_CAUTION[match.reason]}
          </p>
        </div>
      ) : null}

      {match.kind === "matched" ? (
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          접수번호로 짝이 하나로 정해졌습니다. 아래 내용이 맞는지 확인해 주세요.
        </p>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[46rem] table-auto text-sm">
          <thead>
            <tr>
              <th className={TH_CLASS}>{saveOffer === "choose" ? "고르기" : ""}</th>
              <th className={TH_CLASS}>접수번호</th>
              <th className={TH_CLASS}>고객사</th>
              <th className={TH_CLASS}>모델</th>
              <th className={TH_CLASS}>S/N</th>
              <th className={TH_CLASS}>L/N</th>
              <th className={TH_CLASS}>비고</th>
            </tr>
          </thead>
          <tbody>
            <tr data-role="kyosan-report-identity-row" className="bg-zinc-50 dark:bg-zinc-800/40">
              <td className={`${TD_CLASS} text-xs font-semibold text-zinc-600 dark:text-zinc-400`}>연락서</td>
              <td className={TD_CLASS}>{blank(reportIdentity.rawIntakeNumber)}</td>
              <td className={TD_CLASS}>{blank(reportIdentity.customer)}</td>
              <td className={TD_CLASS}>{blank(reportIdentity.model)}</td>
              <td className={TD_CLASS}>{blank(reportIdentity.serialNumber)}</td>
              <td className={TD_CLASS}>{blank(reportIdentity.lotNumber)}</td>
              <td className={`${TD_CLASS} text-xs text-zinc-500 dark:text-zinc-400`}>올린 파일에 적힌 값</td>
            </tr>
            {targets.map((target) => (
              <KyosanReportTargetRow
                key={target.repairCaseId}
                target={target}
                selectable={saveOffer === "choose"}
                checked={selectedRepairCaseId === target.repairCaseId}
                disabled={disabled}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KyosanReportTargetRow({
  target,
  selectable,
  checked,
  disabled,
  onSelect,
}: {
  target: KyosanReportTarget;
  selectable: boolean;
  checked: boolean;
  disabled: boolean;
  onSelect: (repairCaseId: string) => void;
}) {
  // 휴지통의 건 · 이미 넣은 연락서는 고를 수 없다(순수 함수의 판단과 같은 규칙).
  const pickable = !target.isDeleted && !target.alreadyImported;
  const notes: string[] = [];
  if (target.isDeleted) notes.push("휴지통");
  if (target.alreadyImported) notes.push("이 연락서를 이미 넣음");
  // 🔴 이식이 실제로 건드리는 단일 값 칸 하나 — 「덮지 않는다」를 미리 말한다.
  if (target.hasReportedSymptom) notes.push("신고 증상 있음(덮지 않음)");
  if (target.serviceReportCount > 0) notes.push(`보고서 ${target.serviceReportCount}장 있음`);

  return (
    <tr data-role="kyosan-report-target" data-repair-case-id={target.repairCaseId} data-checked={checked}>
      <td className={TD_CLASS}>
        {selectable ? (
          <label className="flex items-center gap-1 text-xs">
            <input
              type="radio"
              name="kyosan-report-target"
              data-role="kyosan-report-target-radio"
              value={target.repairCaseId}
              checked={checked}
              disabled={disabled || !pickable}
              onChange={() => onSelect(target.repairCaseId)}
            />
            <span className="sr-only">{`${target.intakeNumber} 고르기`}</span>
          </label>
        ) : (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{checked ? "확정" : ""}</span>
        )}
      </td>
      <td className={TD_CLASS}>
        <Link href={kyosanRepairCaseHref(target.repairCaseId)} className={LINK_CLASS} target="_blank">
          {target.intakeNumber}
        </Link>
      </td>
      <td className={TD_CLASS}>
        {blank(target.customerName)}
        <AgreementBadge value={target.identity.customer} />
      </td>
      <td className={TD_CLASS}>
        {blank(target.modelName)}
        <AgreementBadge value={target.identity.model} />
      </td>
      <td className={TD_CLASS}>
        {blank(target.serialNumber)}
        <AgreementBadge value={target.identity.serialNumber} />
      </td>
      <td className={TD_CLASS}>
        {blank(target.lotNumber)}
        <AgreementBadge value={target.identity.lotNumber} />
      </td>
      <td className={`${TD_CLASS} text-xs text-zinc-500 dark:text-zinc-400`}>
        {notes.length === 0 ? "—" : notes.join(" · ")}
      </td>
    </tr>
  );
}

// ── 3. 무엇이 들어가는가 ──────────────────────────────────────────────────

/**
 * 🔴 **무엇이 「어디에」 들어가는지**를 보여 준다. 사람이 이 표를 보고 [이식]을
 * 누르므로, 자리 이름이 틀리면 화면이 거짓말을 한 것이 된다. 자리는 저장이 쓰는
 * 그 순수 함수(`kyosanReportLineDestination`)가 그대로 정한다.
 */
export function KyosanReportContentPanel({ preview }: { preview: KyosanReportPreviewReady }) {
  const { content } = preview;
  const partDestination = kyosanReportPartDestination();
  return (
    <section data-role="kyosan-report-content" className={REPORT_SECTION_CLASS}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">3. 무엇이 어디에 들어가는가</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {`내용 줄 ${content.lines.length}개 · 교체 부품 ${content.parts.length}건 · 원인 ○ ${content.causeMarks.length}개 · 처치 ○ ${content.actionMarks.length}개 · 사진 ${content.photoCount}장` +
          (content.formAssetCount > 0 ? ` (양식 그림 ${content.formAssetCount}장은 걸러 냈습니다)` : "")}
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        🔴 보고서를 만들지 않습니다 — 아래 「들어갈 자리」의 수리 건 상세 칸에 그대로 넣습니다.
      </p>

      {content.lines.length === 0 && content.parts.length === 0 && content.photoCount === 0 ? (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          이 연락서에서 넣을 내용을 하나도 뽑지 못했습니다.
        </p>
      ) : null}

      {content.lines.length > 0 ? (
        <table className="mt-3 w-full table-auto text-sm">
          <thead>
            <tr>
              <th className={TH_CLASS}>들어갈 자리</th>
              <th className={TH_CLASS}>연락서 항목</th>
              <th className={TH_CLASS}>들어갈 글자</th>
            </tr>
          </thead>
          <tbody>
            {content.lines.map((line) => {
              const destination = kyosanReportLineDestination(line);
              const note = KYOSAN_DESTINATION_NOTE[destination];
              return (
                <tr
                  key={`${line.section}-${line.origin}-${line.text}`}
                  data-role="kyosan-report-line"
                  data-destination={destination}
                >
                  <td className={`${TD_CLASS} text-xs`}>
                    <span
                      className={
                        destination === "NOT_IMPORTED"
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-zinc-700 dark:text-zinc-300"
                      }
                    >
                      {KYOSAN_DESTINATION_LABEL[destination]}
                    </span>
                    {note === null ? null : (
                      <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">{note}</span>
                    )}
                  </td>
                  <td className={`${TD_CLASS} whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400`}>
                    {line.origin}
                  </td>
                  <td className={`${TD_CLASS} whitespace-pre-wrap text-zinc-800 dark:text-zinc-200`}>
                    <KyosanText value={line.text} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {content.parts.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {`교체 부품 — 사용 부품 칸 + ${KYOSAN_DESTINATION_LABEL[partDestination]}`}
          </h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
            {content.parts.map((part) => (
              <li key={`${part.kind}-${part.text}`} data-role="kyosan-report-part">
                {`[${KYOSAN_PART_KIND_LABEL[part.kind]}] `}
                <KyosanText value={part.text} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ── 4. 알림 ───────────────────────────────────────────────────────────────

export function KyosanReportNotices({ preview }: { preview: KyosanReportPreviewReady }) {
  const groups: { role: string; title: string; items: readonly string[]; tone: string }[] = [
    {
      role: "kyosan-report-blockers",
      title: "막는 것",
      items: preview.blockers,
      tone: "text-red-700 dark:text-red-300",
    },
    {
      role: "kyosan-report-warnings",
      title: "알리는 것",
      items: preview.warnings,
      tone: "text-amber-700 dark:text-amber-300",
    },
    {
      role: "kyosan-report-problems",
      title: "읽다가 만난 문제",
      items: preview.problems,
      tone: "text-zinc-600 dark:text-zinc-400",
    },
  ].filter((group) => group.items.length > 0);

  if (groups.length === 0) return null;
  return (
    <section className={REPORT_SECTION_CLASS}>
      {groups.map((group) => (
        <div key={group.role} data-role={group.role} className="mt-2 first:mt-0">
          <h3 className={`text-xs font-semibold ${group.tone}`}>{`${group.title} (${group.items.length})`}</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ── 5. 이식 단추 ──────────────────────────────────────────────────────────

/**
 * 🔴 `saveOffer === "none"` 이면 **단추를 그리지 않는다.** 짝이 없을 때 눌러
 * 볼 단추가 없어야 「넣을 수 없다」가 분명해진다.
 */
export function KyosanReportImportBar({
  saveOffer,
  canImport,
  busy,
  onImport,
}: {
  saveOffer: KyosanReportSaveOffer;
  canImport: boolean;
  busy: boolean;
  onImport: () => void;
}) {
  if (saveOffer === "none") {
    return (
      <section data-role="kyosan-report-import-bar" data-offer="none" className={REPORT_SECTION_CLASS}>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          이 연락서는 넣을 수 없습니다 — 위의 까닭을 확인해 주세요.
        </p>
      </section>
    );
  }

  return (
    <section
      data-role="kyosan-report-import-bar"
      data-offer={saveOffer}
      className={`${REPORT_SECTION_CLASS} flex flex-wrap items-center justify-between gap-2`}
    >
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {saveOffer === "choose" && !canImport
          ? "넣을 수리 건을 먼저 골라 주세요."
          : "확인했으면 [이식]을 누르세요. 이 단추를 눌러야 저장됩니다."}
      </p>
      <button
        type="button"
        data-role="kyosan-report-import"
        disabled={!canImport || busy}
        aria-busy={busy}
        onClick={onImport}
        className={PRIMARY_BUTTON_CLASS}
      >
        {busy ? "넣는 중..." : "이식"}
      </button>
    </section>
  );
}

function useShowModalOnMount() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return dialogRef;
}

export function KyosanReportConfirmDialogView({
  target,
  preview,
  onConfirm,
  onCancel,
}: {
  target: KyosanReportTarget;
  preview: KyosanReportPreviewReady;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useShowModalOnMount();
  const { content } = preview;
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="kyosan-report-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="kyosan-report-confirm-title" className="text-sm font-semibold">
        {`수리 건 ${target.intakeNumber} 에 연락서를 넣습니다`}
      </h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
        <li>{`내용 줄 ${content.lines.length}개 · 교체 부품 ${content.parts.length}건 · 사진 ${content.photoCount}장`}</li>
        <li data-role="kyosan-report-confirm-destination">
          🔴 보고서는 만들지 않습니다 — 신고 증상(비어 있을 때만)과 작업 기록으로 들어갑니다.
        </li>
        <li>
          {target.hasReportedSymptom
            ? "이 건의 신고 증상에는 이미 값이 있어 덮지 않고 작업 기록으로 넣습니다."
            : "이 건의 신고 증상 칸이 비어 있어 고객 고장 상황을 그 칸에 넣습니다."}
        </li>
        <li>연락서 원본 파일도 이 수리 건의 첨부로 남습니다.</li>
        <li>넣은 뒤에는 이 화면에서 되돌릴 수 없습니다.</li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>
          취소
        </button>
        <button
          type="button"
          data-role="kyosan-report-confirm"
          onClick={onConfirm}
          className={PRIMARY_BUTTON_CLASS}
        >
          넣습니다
        </button>
      </div>
    </dialog>
  );
}

// ── 6. 결과 ───────────────────────────────────────────────────────────────

export function KyosanReportResultPanel({
  result,
  failureText,
}: {
  result: KyosanReportImportResult;
  /** 실패 코드의 첫 문장(순수 함수가 준다). 성공이면 쓰이지 않는다. */
  failureText: string;
}) {
  if (!result.ok) {
    return (
      <section data-role="kyosan-report-result" data-ok="false" className={REPORT_SECTION_CLASS}>
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">{failureText}</h2>
        <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">{result.message}</p>
        {result.blockers && result.blockers.length > 0 ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {result.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  return (
    <section data-role="kyosan-report-result" data-ok="true" className={REPORT_SECTION_CLASS}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {`수리 건 ${result.intakeNumber} 에 넣었습니다`}
      </h2>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
        {`내용 줄 ${result.lineCount}개 · 작업 기록 ${result.workRecordIds.length}건 · ` +
          `신고 증상 ${result.reportedSymptomFilled ? "채움" : "그대로 둠"} · ` +
          `사용 부품 ${result.usedPartCount}줄 · 첨부 ${result.attachmentIds.length}개(사진 ${result.photoCount}장)`}
      </p>
      <p className="mt-2 text-sm">
        <Link href={kyosanRepairCaseHref(result.repairCaseId)} className={LINK_CLASS}>
          수리 건 열기
        </Link>
      </p>
      {result.warnings.length > 0 ? (
        <ul
          data-role="kyosan-report-result-warnings"
          className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-700 dark:text-amber-300"
        >
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** 액션이 문 앞에서 막았을 때(권한 · 파일 · 일시 장애). */
export function KyosanReportFailureNotice({ message }: { message: string }) {
  return (
    <section data-role="kyosan-report-failure" className={REPORT_SECTION_CLASS}>
      <p role="alert" className="text-sm text-red-700 dark:text-red-300">
        {message}
      </p>
    </section>
  );
}
