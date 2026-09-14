"use client";

import { useEffect, useRef, useState } from "react";
import { uploadPreview } from "@/components/repair-cases/files/shrink-image";
import type { ImprovementRequestScreenshot } from "@/lib/db/queries/improvement-requests";
import {
  IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT,
  hasImprovementRequestScreenshotRoom,
} from "@/lib/domain/improvement-request";
import {
  SCREENSHOT_FILE_ACCEPT,
  deleteRequestScreenshotNotice,
  screenshotFullUrl,
  screenshotThumbUrl,
  screenshotUploadUrl,
  type ScreenshotRejection,
} from "./improvement-request-screenshot-files";

/**
 * ============================================================================
 * 개선 요청 스크린샷 — 썸네일 줄 · 크게 보기 · 지우기 확인 · 등록 전 미리보기
 * ============================================================================
 * ImprovementRequestsScreen 이 부르는 조각들이다. 서버 액션을 부르지 않는다 —
 * 지우기는 부르는 쪽이 넘긴 콜백이 한다. 그래서 이 파일은 서버 액션 사슬
 * (`server-only`) 없이 그려 볼 수 있다(ImprovementRequestScreenshots.test.tsx).
 *
 * ■ 누가 무엇을 하는가는 부르는 쪽이 정한다
 *
 * `canChange` 는 화면이 줄마다 canChangeImprovementRequestScreenshots 로 구해
 * 넘긴다. 여기서는 그 값으로 단추를 그릴지만 고른다. 막는 것은 서버다.
 *
 * ■ 확인창은 native `<dialog>` + `showModal()`
 *
 * 이 앱의 확인창 관례(ImprovementRequestsScreen 의 DeleteImprovementRequestDialog).
 * 크게 보기와 지우기 확인은 **열려 있는 동안만 그린다** — 줄마다 닫힌 `<dialog>` 를
 * 늘어놓지 않으려고. 그려지는 순간 showModal 을 부르고, Esc 는 브라우저에 맡기지
 * 않고 onClose 로 부모 상태를 걷는다(엇갈리면 다음에 열리지 않는다).
 *
 * 🔴 파일 이름과 이미지는 화면에 그리는 것 말고는 어디로도 내보내지 않는다 —
 * console 에도 싣지 않는다(본문과 같은 개인정보 규칙).
 * ============================================================================
 */

const SMALL_BUTTON_CLASS =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300";
const TINY_DANGER_BUTTON_CLASS =
  "w-full rounded border border-red-300 px-1 py-0.5 text-[11px] text-red-700 hover:border-red-600 disabled:opacity-50 dark:border-red-800 dark:text-red-400";
const TINY_BUTTON_CLASS =
  "w-full rounded border border-zinc-300 px-1 py-0.5 text-[11px] text-zinc-700 hover:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300";
const THUMB_BOX_CLASS =
  "block h-20 w-20 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800";
const DIALOG_CLASS =
  "rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50";

// ────────────────────────────────────────────────── 올리기

/** 이 응답이면 뒤의 장도 같은 까닭으로 막힌다 — 보내지 않고 같은 까닭을 붙인다. */
const STOP_STATUSES = new Set([401, 403, 404, 409]);

type UploadOneResult =
  | { ok: true; previewUpload: Promise<void> | null }
  | { ok: false; reason: string; status: number | null; code: string | null };

async function uploadOneScreenshot(improvementRequestId: string, file: File): Promise<UploadOneResult> {
  try {
    const response = await fetch(screenshotUploadUrl(improvementRequestId, file.name), {
      method: "POST",
      body: file,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
      return {
        ok: false,
        reason: payload?.error ?? "서버가 거절했습니다",
        status: response.status,
        code: payload?.code ?? null,
      };
    }
    // 썸네일은 이어서 보내되 기다리지 않는다 — 약속은 돌려줘 부르는 쪽이 끝을 안다
    // (FilesScreen.tsx 의 uploadOne 과 같은 까닭). uploadPreview 는 실패를 스스로 삼킨다.
    const created = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, previewUpload: created?.id ? uploadPreview(created.id, file) : null };
  } catch {
    return { ok: false, reason: "네트워크 문제", status: null, code: null };
  }
}

export type ScreenshotUploadOutcome = {
  /** 올리지 못한 장과 까닭. */
  failures: ScreenshotRejection[];
  /** 서버 거절 코드 — 부르는 쪽이 「글이 지워졌다」(IMPROVEMENT_REQUEST_NOT_FOUND)를 가를 때 쓴다. */
  failureCodes: string[];
  /** 올린 장들의 썸네일 올리기가 모두 끝나면 풀린다(거절되지 않는다). 풀린 뒤에 refresh 한다. */
  previewsSettled: Promise<void>;
};

/**
 * 한 글에 여러 장을 **한 장씩 차례로** 올린다. 동시에 보내지 않는 것은 서버가 5장을
 * 잠근 트랜잭션에서 세기 때문이다 — 순서대로 보내야 「몇 장째에서 찼는가」가 고른
 * 차례와 같다. 권한 · 없는 글 · 5장(401 · 403 · 404 · 409)에 막히면 뒤의 장은
 * 보내지 않고 같은 까닭을 붙인다.
 *
 * `onProgress(지금 보내는 장의 차례, 전체)` 로 진행을 알린다.
 */
export async function uploadImprovementRequestScreenshots(
  improvementRequestId: string,
  files: readonly File[],
  onProgress: (current: number, total: number) => void
): Promise<ScreenshotUploadOutcome> {
  const failures: ScreenshotRejection[] = [];
  const failureCodes: string[] = [];
  const previewUploads: Promise<void>[] = [];
  let stopReason: string | null = null;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (stopReason !== null) {
      failures.push({ fileName: file.name, reason: stopReason });
      continue;
    }
    onProgress(index + 1, files.length);
    const result = await uploadOneScreenshot(improvementRequestId, file);
    if (result.ok) {
      if (result.previewUpload) previewUploads.push(result.previewUpload);
      continue;
    }
    failures.push({ fileName: file.name, reason: result.reason });
    if (result.code) failureCodes.push(result.code);
    if (result.status !== null && STOP_STATUSES.has(result.status)) stopReason = result.reason;
  }

  return {
    failures,
    failureCodes,
    previewsSettled: Promise.all(previewUploads).then(() => undefined),
  };
}

// ────────────────────────────────────────────────── 파일 고르기 단추

/**
 * [스크린샷 추가] — 숨긴 파일 칸을 연다. 고른 뒤 칸을 비워 같은 파일을 다시 고를 수
 * 있게 한다(그러지 않으면 같은 파일을 두 번째 고를 때 change 가 오지 않는다).
 */
export function ScreenshotAddButton({
  onFiles,
  disabled,
  label = "스크린샷 추가",
}: {
  onFiles: (files: File[]) => void;
  disabled: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={SCREENSHOT_FILE_ACCEPT}
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={SMALL_BUTTON_CLASS}
      >
        {label}
      </button>
    </>
  );
}

// ────────────────────────────────────────────────── 목록 줄의 썸네일

/**
 * 글 한 줄의 스크린샷 줄. 썸네일을 누르면 크게 보기가 열린다.
 *
 * `canChange` 면 썸네일마다 [지우기]를, 자리가 남았으면(5장 미만) [스크린샷 추가]를
 * 더 그린다. 아니면 썸네일과 크게 보기만 — 스크린샷이 없고 바꿀 수도 없으면 아무것도
 * 그리지 않는다. 폭이 좁으면 줄바꿈한다(가로로 넘치지 않는다).
 */
export function ImprovementRequestScreenshotStrip({
  screenshots,
  canChange,
  disabled,
  progressText,
  onAddFiles,
  onRequestDelete,
}: {
  screenshots: readonly ImprovementRequestScreenshot[];
  canChange: boolean;
  disabled: boolean;
  /** 이 줄에 올리는 중이면 「스크린샷 올리는 중 1/2…」. */
  progressText: string | null;
  onAddFiles: (files: File[]) => void;
  onRequestDelete: (screenshot: ImprovementRequestScreenshot) => void;
}) {
  const [viewing, setViewing] = useState<ImprovementRequestScreenshot | null>(null);
  const hasRoom = hasImprovementRequestScreenshotRoom(screenshots.length);

  if (screenshots.length === 0 && !canChange) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {screenshots.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="스크린샷">
          {screenshots.map((shot) => (
            <li key={shot.id} className="flex w-20 flex-col gap-1">
              <button
                type="button"
                onClick={() => setViewing(shot)}
                aria-label={`${shot.originalFileName} 크게 보기`}
                title={shot.originalFileName}
                className={THUMB_BOX_CLASS}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotThumbUrl(shot.id)}
                  alt={shot.originalFileName}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </button>
              {canChange ? (
                <button
                  type="button"
                  onClick={() => onRequestDelete(shot)}
                  disabled={disabled}
                  aria-label={`${shot.originalFileName} 지우기`}
                  className={TINY_DANGER_BUTTON_CLASS}
                >
                  지우기
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canChange ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {hasRoom ? <ScreenshotAddButton onFiles={onAddFiles} disabled={disabled} /> : null}
          {screenshots.length > 0 ? (
            <span className="tabular-nums">
              스크린샷 {screenshots.length}/{IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT}
            </span>
          ) : null}
          {progressText ? (
            <span role="status" className="text-zinc-700 dark:text-zinc-300">
              {progressText}
            </span>
          ) : null}
        </div>
      ) : null}

      {viewing ? <ScreenshotViewerDialog screenshot={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

/** 그려지는 순간 모달로 연다. 닫기는 부모 상태를 걷어 이 조각을 치우는 것이다. */
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

/** 크게 보기 — 원본(`?view=full`)을 화면 안에 그린다. Esc 와 [닫기]로 닫는다. */
export function ScreenshotViewerDialog({
  screenshot,
  onClose,
}: {
  screenshot: ImprovementRequestScreenshot;
  onClose: () => void;
}) {
  const dialogRef = useShowModalOnMount();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="improvement-request-screenshot-viewer-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`w-full max-w-4xl ${DIALOG_CLASS}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="improvement-request-screenshot-viewer-title"
          className="min-w-0 truncate text-sm font-semibold"
          title={screenshot.originalFileName}
        >
          {screenshot.originalFileName}
        </h2>
        <button type="button" onClick={onClose} className={SMALL_BUTTON_CLASS}>
          닫기
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={screenshotFullUrl(screenshot.id)}
        alt={screenshot.originalFileName}
        className="mx-auto mt-3 max-h-[75vh] max-w-full object-contain"
      />
    </dialog>
  );
}

/** 스크린샷 한 장 지우기 확인. 지운 것은 첨부 휴지통으로 가며 거기서 되살릴 수 있다. */
export function ScreenshotDeleteDialog({
  screenshot,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  screenshot: ImprovementRequestScreenshot;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useShowModalOnMount();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="improvement-request-screenshot-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (isSubmitting) return;
        onCancel();
      }}
      className={`w-full max-w-md ${DIALOG_CLASS}`}
    >
      <h2 id="improvement-request-screenshot-delete-title" className="text-sm font-semibold">
        이 스크린샷을 지우시겠습니까?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">첨부 휴지통으로 옮깁니다.</p>
      <div className="mt-2 flex items-center gap-2">
        <span className={`${THUMB_BOX_CLASS} shrink-0`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotThumbUrl(screenshot.id)}
            alt={screenshot.originalFileName}
            className="h-full w-full object-cover"
          />
        </span>
        <span className="min-w-0 text-xs break-all text-zinc-700 dark:text-zinc-300">
          {screenshot.originalFileName}
        </span>
      </div>
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
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "옮기는 중..." : "지우기"}
        </button>
      </div>
    </dialog>
  );
}

/** 글 지우기 확인창에 더하는 한 줄 — 스크린샷이 없으면 아무것도 그리지 않는다. */
export function ScreenshotTrashNote({ count }: { count: number }) {
  const text = deleteRequestScreenshotNotice(count);
  if (text === null) return null;
  return <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{text}</p>;
}

// ────────────────────────────────────────────────── 등록 전 미리보기

export type StagedScreenshot = {
  /** 목록 열쇠 — 같은 이름의 파일을 두 번 골라도 갈리게 따로 둔다. */
  key: string;
  file: File;
  /** URL.createObjectURL 로 만든 주소. 빼거나 · 등록하거나 · 화면이 사라질 때 부르는 쪽이 놓는다. */
  previewUrl: string;
};

/** 새 글에 붙일 스크린샷 — 아직 올리지 않았다. 장마다 [빼기]. */
export function StagedScreenshotList({
  staged,
  disabled,
  onRemove,
}: {
  staged: readonly StagedScreenshot[];
  disabled: boolean;
  onRemove: (key: string) => void;
}) {
  if (staged.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="붙일 스크린샷">
      {staged.map((entry) => (
        <li key={entry.key} className="flex w-20 flex-col gap-1">
          <span className={THUMB_BOX_CLASS} title={entry.file.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={entry.previewUrl} alt={entry.file.name} className="h-full w-full object-cover" />
          </span>
          <button
            type="button"
            onClick={() => onRemove(entry.key)}
            disabled={disabled}
            aria-label={`${entry.file.name} 빼기`}
            className={TINY_BUTTON_CLASS}
          >
            빼기
          </button>
        </li>
      ))}
    </ul>
  );
}
