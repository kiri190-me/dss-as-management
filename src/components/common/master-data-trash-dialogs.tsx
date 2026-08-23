"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

const MAX_LISTED_NAMES = 15;

/**
 * ============================================================================
 * 마스터 데이터 휴지통의 확인 창 — 삭제 / 복원 / 완전 삭제
 * ============================================================================
 * 고객사와 제품 모델이 같은 창을 쓴다. 접수 건 쪽 세 창
 * (RepairCaseBulkDeleteDialog / RepairCaseRestoreDialog /
 * RepairCasePermanentDeleteDialog)과 같은 native <dialog>/showModal() 방식,
 * 같은 색과 문구 규칙을 따르되 — 그쪽은 인수번호를, 이쪽은 이름을 나열한다.
 *
 * ── 왜 화면마다 베끼지 않는가 ───────────────────────────────────────────
 * 되돌릴 수 없는 조작을 확인하는 문구는 화면마다 달라지면 안 되는 종류의
 * 것이다. "정말 지울까요"가 어떤 화면에서는 15일을 말하고 어떤 화면에서는
 * 말하지 않으면, 사람은 화면마다 다른 규칙이 있다고 배우게 된다. 실제로는
 * 하나의 규칙이므로 창도 하나다. 화면마다 다른 것은 딸려 가는 것이 무엇인지
 * (End-User인지 등록 장비인지)뿐이고, 그것만 cascadeNote로 받는다.
 *
 * 세 창 모두 자기 상태를 갖지 않는다 — 열림 여부·사유 입력·전송 중·오류는
 * 전부 부모가 소유한다(접수 건 쪽 창들과 같은 원칙).
 * ============================================================================
 */

function NameList({ names }: { names: string[] }) {
  const shown = names.slice(0, MAX_LISTED_NAMES);
  const remaining = names.length - shown.length;
  return (
    <ul className="mt-3 max-h-32 overflow-y-auto rounded-md border border-zinc-100 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      {shown.map((name) => (
        <li key={name}>{name}</li>
      ))}
      {remaining > 0 && <li>외 {remaining}건</li>}
    </ul>
  );
}

function TrashDialogShell({
  isOpen,
  isSubmitting,
  onCancel,
  danger = false,
  titleId,
  children,
}: {
  isOpen: boolean;
  isSubmitting: boolean;
  onCancel: () => void;
  danger?: boolean;
  titleId: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // ESC로 닫는 것도 취소 콜백을 거치게 한다 — 전송 중에는 아무 일도
        // 일어나지 않아야 하고, 부모의 상태와 창의 열림 여부가 갈라지면 안 된다.
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className={
        danger
          ? "w-full max-w-md rounded-lg border border-red-300 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-red-900 dark:bg-zinc-900 dark:text-zinc-50"
          : "w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      }
    >
      {children}
    </dialog>
  );
}

function DialogButtons({
  isSubmitting,
  canSubmit,
  confirmLabel,
  submittingLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  isSubmitting: boolean;
  canSubmit: boolean;
  confirmLabel: string;
  submittingLabel: string;
  danger: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        취소
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!canSubmit}
        aria-busy={isSubmitting}
        className={
          danger
            ? "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            : "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {isSubmitting ? submittingLabel : confirmLabel}
      </button>
    </div>
  );
}

function SubmitError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

/**
 * 휴지통으로 보내기. 되돌릴 수 있는 조작이므로 사유는 선택 입력이다 —
 * 접수 건 일괄 삭제와 같은 기준이고, 서버도 같은 기준으로 받는다.
 */
export function MasterDataDeleteDialog({
  isOpen,
  entityLabel,
  names,
  cascadeNote,
  reason,
  isSubmitting,
  submitError,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  /** "고객사" / "제품 모델" — 문장 안에 그대로 들어간다. */
  entityLabel: string;
  names: string[];
  /** 이 삭제로 함께 딸려 가는 것에 대한 설명. 화면마다 다른 유일한 부분이다. */
  cascadeNote?: ReactNode;
  reason: string;
  isSubmitting: boolean;
  submitError: string | null;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const reasonId = useId();

  return (
    <TrashDialogShell isOpen={isOpen} isSubmitting={isSubmitting} onCancel={onCancel} titleId={titleId}>
      <h2 id={titleId} className="text-sm font-semibold">
        선택한 {names.length}개의 {entityLabel}을(를) 휴지통으로 보내시겠습니까?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        휴지통에 있는 동안에는 목록에서 보이지 않지만 언제든 복원할 수 있습니다.
        <strong className="font-medium text-zinc-800 dark:text-zinc-200"> 15일이 지나면 자동으로 완전히 삭제</strong>
        되며, 그 뒤에는 되돌릴 수 없습니다.
      </p>
      {cascadeNote && <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{cascadeNote}</div>}

      <NameList names={names} />

      <div className="mt-3">
        <label htmlFor={reasonId} className="text-xs text-zinc-500 dark:text-zinc-400">
          삭제 사유 (선택)
        </label>
        <textarea
          id={reasonId}
          rows={2}
          disabled={isSubmitting}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <SubmitError message={submitError} />

      <DialogButtons
        isSubmitting={isSubmitting}
        canSubmit={!isSubmitting}
        confirmLabel="휴지통으로 보내기"
        submittingLabel="삭제 중..."
        danger={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </TrashDialogShell>
  );
}

/** 휴지통에서 되살리기. 사유 입력이 없다 — 되돌리는 일에는 이유를 묻지 않는다. */
export function MasterDataRestoreDialog({
  isOpen,
  entityLabel,
  names,
  cascadeNote,
  isSubmitting,
  submitError,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  entityLabel: string;
  names: string[];
  cascadeNote?: ReactNode;
  isSubmitting: boolean;
  submitError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();

  return (
    <TrashDialogShell isOpen={isOpen} isSubmitting={isSubmitting} onCancel={onCancel} titleId={titleId}>
      <h2 id={titleId} className="text-sm font-semibold">
        선택한 {names.length}개의 {entityLabel}을(를) 복원하시겠습니까?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        복원하면 목록에 다시 나타나고, 접수·편집 화면에서도 다시 고를 수 있게 됩니다.
      </p>
      {cascadeNote && <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{cascadeNote}</div>}

      <NameList names={names} />

      <SubmitError message={submitError} />

      <DialogButtons
        isSubmitting={isSubmitting}
        canSubmit={!isSubmitting}
        confirmLabel="복원"
        submittingLabel="복원 중..."
        danger={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </TrashDialogShell>
  );
}

/**
 * 15일을 기다리지 않고 즉시 완전 삭제. 사유가 필수다 — 되돌릴 수 없는
 * 조작에는 이유가 남아야 한다(접수 건·흐름도 영구 삭제와 같은 규칙).
 *
 * 이름을 받아 적게 하는 확인(예: "삭제"라고 입력)은 두지 않는다. 접수 건
 * 쪽에서 같은 판단을 이미 내렸고, 필수 사유와 대상 목록이 확인 장치다.
 */
export function MasterDataPermanentDeleteDialog({
  isOpen,
  entityLabel,
  names,
  cascadeNote,
  reason,
  isSubmitting,
  submitError,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  entityLabel: string;
  names: string[];
  cascadeNote?: ReactNode;
  reason: string;
  isSubmitting: boolean;
  submitError: string | null;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const reasonId = useId();
  const canSubmit = reason.trim().length > 0 && !isSubmitting;

  return (
    <TrashDialogShell isOpen={isOpen} isSubmitting={isSubmitting} onCancel={onCancel} danger titleId={titleId}>
      <h2 id={titleId} className="text-sm font-semibold text-red-700 dark:text-red-400">
        선택한 {names.length}개의 {entityLabel}을(를) 완전 삭제하시겠습니까?
      </h2>
      <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-400">
        이 작업은 되돌릴 수 없습니다. 삭제 후에는 복원할 수 없습니다.
      </p>
      {cascadeNote && <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{cascadeNote}</div>}

      <NameList names={names} />

      <div className="mt-3">
        <label htmlFor={reasonId} className="text-xs text-zinc-500 dark:text-zinc-400">
          완전 삭제 사유 (필수)
        </label>
        <textarea
          id={reasonId}
          rows={2}
          required
          disabled={isSubmitting}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <SubmitError message={submitError} />

      <DialogButtons
        isSubmitting={isSubmitting}
        canSubmit={canSubmit}
        confirmLabel="완전 삭제"
        submittingLabel="완전 삭제 중..."
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </TrashDialogShell>
  );
}

/**
 * 선택 상태 바 — 휴지통 탭과 목록의 삭제 모드가 같이 쓴다.
 *
 * 아무것도 고르지 않았으면 아예 그리지 않는다(접수 건 휴지통의
 * RepairCaseTrashActionBar와 같은 규칙). 버튼 구성은 부모가 정한다 —
 * 휴지통에서는 복원·완전 삭제, 목록에서는 삭제 하나뿐이라 여기서
 * 고정해 두면 한쪽에 없는 버튼이 생긴다.
 */
export function MasterDataSelectionBar({
  selectedCount,
  tone,
  onClearSelection,
  children,
}: {
  selectedCount: number;
  /** 삭제 모드는 붉은색, 휴지통은 파란색 — 지금 무엇을 하는 중인지 색이 먼저 말한다. */
  tone: "danger" | "info";
  onClearSelection: () => void;
  children: ReactNode;
}) {
  if (selectedCount === 0) return null;

  const wrapper =
    tone === "danger"
      ? "flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950"
      : "flex flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950";
  const label =
    tone === "danger"
      ? "text-sm font-medium text-red-800 dark:text-red-300"
      : "text-sm font-medium text-blue-800 dark:text-blue-300";

  return (
    <div className={wrapper}>
      <span className={label}>{selectedCount}개 선택됨</span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          선택 해제
        </button>
        {children}
      </div>
    </div>
  );
}
