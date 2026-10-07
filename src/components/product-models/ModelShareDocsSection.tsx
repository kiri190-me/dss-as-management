"use client";

import { useEffect, useId, useRef, useState } from "react";

import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import ContactFolderPlaceOpenButton from "@/components/repair-cases/files/ContactFolderPlaceOpenButton";
import { isOpenableQuoteFolderFileName } from "@/lib/domain/quote-folder-file-link";
import { KindShareDocsHelperNotice } from "./KindShareDocsSection";
import ModelShareFolderPicker, { type ModelShareFolderAdd } from "./ModelShareFolderPicker";

/**
 * ============================================================================
 * 제품 **모델별** — 「공유폴더에서 가리킨 서류」 구역 (2026-10-07)
 * ============================================================================
 * 「제품 모델 하나하나도 같은 것을 갖게 해 달라」(사용자 요구 2026-10-07). 이 구역의 한
 * 줄은 「이 모델(예: MBK200-JS2)의 서류는 사내 공유폴더의 **저기** 있다」는 가리킴 하나다.
 * 종류별 구역(KindShareDocsSection.tsx)을 **본떴고**, 🔴 그 파일은 한 글자도 건드리지
 * 않았다. 다른 것은 **주인 하나**(enum 코드 → 모델의 id)뿐이다.
 *
 * ── 🔴 사진·도면 구역과 **섞지 않는다** ──────────────────────────────────
 * 둘은 성질이 다르다:
 *  · 올린 것   = 우리 창고에 **바이트가 있다**. 내려받기 · 미리보기 · 휴지통이 있다.
 *  · 가리킨 것 = **바이트가 없다**. 내려받기도 미리보기도 **없고**, 지우면 바로 사라진다.
 * 섞으면 사람이 「이건 왜 내려받기가 없지」에서 멈춘다. 그래서 ProductModelFilesSection
 * **바로 뒤에 따로 선 형제**다. 🔴 이 파일에는 `/api/attachments/…/download` 를 부르는
 * 길이 한 줄도 없다.
 *
 * ── 🔴 지우면 되돌릴 수 없다 ─────────────────────────────────────────────
 * 이 표에는 휴지통이 없다(db/mutations/product-model-share-docs.ts 머리말). 그래서 확인
 * 창이 **그 사실을 말한다**. 🔴 마스터 데이터 휴지통 창들의 「15일 뒤 자동 삭제」 문구는
 * 여기에 맞지 않는다 — 가리킴은 **즉시** 사라진다.
 *
 * ── 🔴 여는 단추는 그대로 가져다 쓴다 ────────────────────────────────────
 *  · 폴더 → ContactFolderPlaceOpenButton (탐색기로 그 자리를 연다)
 *  · 파일 → ContactFolderEntryOpenButton (연결 프로그램으로 연다)
 * 베끼지 않았다. 🔴 두 단추 다 **Windows 가 아니면 스스로 아무것도 그리지 않는다.**
 * 🔴 파일 단추가 받는 모양이 `폴더/파일` 이라, 공유폴더 **맨 위 칸에 바로 놓인 파일**
 * (경로에 `/` 가 없는 줄)에는 단추를 그리지 않는다 — 앞에 붙일 폴더가 없어 도우미 주소를
 * 만들 수 없다.
 *
 * ── 🔴 도우미 안내는 **베끼지 않고 가져다 쓴다** ─────────────────────────
 * `KindShareDocsHelperNotice` 를 그대로 `import` 한다. 2026-10-07 에 세대별 표시를 넣은
 * 공용 조각이고, 두 벌이 되면 한쪽만 고쳐진다. 🔴 그 안의 Windows 판정 · 표시 읽기 ·
 * [그만 보기]는 전부 그쪽 한 자리에 있다 — 이 파일은 그것을 **다시 적지 않는다.**
 *
 * ── 권한 ────────────────────────────────────────────────────────────────
 * `canManageFiles`(= `productModels.files` WRITE)가 거짓이면 **고르는 창도 지우기 단추도
 * 아예 그리지 않는다**. 🔴 화면이 권한을 **직접 판정하지 않는다** — 서버 컴포넌트가
 * 구해 둔 boolean 하나를 받는다. 실제 차단은 서버 액션이 다시 한다.
 *
 * ── 🔴 서버 액션을 직접 물지 않는다 ──────────────────────────────────────
 * `onAdd` · `onRemove` 로 받는다. 직접 import 하면 사슬 끝의 `server-only` 때문에
 * test:components 에서 이 조각을 **그려 볼 수조차 없다**.
 *
 * ── 🔴 인쇄에서 뺀다 ─────────────────────────────────────────────────────
 * 구역 전체에 `print:hidden` 이다. 적히는 것은 **경로**지 이 모델의 사실이 아니다.
 * ============================================================================
 */

// ── 문장 ─────────────────────────────────────────────────────────────────

export const MODEL_SHARE_DOCS_TITLE = "공유폴더에서 가리킨 서류";
export const MODEL_SHARE_DOCS_HINT =
  "이 줄들은 사내 공유폴더의 자리를 가리킬 뿐입니다 — 파일이 이 시스템에 올라와 있지 않아 내려받기·미리보기가 없습니다.";
export const MODEL_SHARE_DOCS_FILE_LABEL = "파일";
export const MODEL_SHARE_DOCS_FOLDER_LABEL = "폴더";
export const MODEL_SHARE_DOCS_REMOVE_TEXT = "지우기";

/** 🔴 확인 창이 **반드시** 말해야 하는 것 — 이 표에는 휴지통이 없다. */
export const MODEL_SHARE_DOC_REMOVE_IRREVERSIBLE_TEXT =
  "이 작업은 되돌릴 수 없습니다. 가리킴은 휴지통 없이 바로 사라집니다.";
/** 공유폴더의 실물은 그대로 있다 — 지우는 것은 가리킴 한 줄뿐이라는 것도 함께 말한다. */
export const MODEL_SHARE_DOC_REMOVE_KEEPS_FILE_TEXT =
  "공유폴더의 실제 파일·폴더는 지워지지 않습니다 — 이 목록의 줄 하나만 사라집니다.";
export const MODEL_SHARE_DOC_REMOVE_CONFIRM_TEXT = "가리킴 지우기";

export function modelShareDocRemoveTitle(displayName: string): string {
  return `「${displayName}」 가리킴을 지우시겠습니까?`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

/**
 * 한 줄. 🔴 `db/queries/product-model-share-docs.ts` 가 돌려주는 모양의 **부분집합**을
 * 구조로 적는다 — 그 모듈은 `server-only` 라 값으로 끌어오면 이 조각을 그려 볼 수 없다.
 */
export type ModelShareDocRow = {
  id: string;
  entryKind: "FILE" | "FOLDER";
  /** 🔴 공유폴더 루트 **기준 상대 경로**. 마디 구분은 `/` 다. */
  relativePath: string;
  /** 사람이 붙인 이름. 🔴 **비면 화면이 경로의 마지막 마디를 쓴다.** */
  label: string | null;
};

export type ModelShareDocRemoveAnswer = { ok: true } | { ok: false; message: string };

/** 경로의 마디들 — 빈 마디는 버린다. */
function pathSegments(relativePath: string): string[] {
  return relativePath.split("/").filter((segment) => segment !== "");
}

/** 🔴 이름이 비면 **경로의 마지막 마디**다(조회가 NULL 을 그대로 내보내는 까닭). */
export function modelShareDocDisplayName(doc: ModelShareDocRow): string {
  const label = (doc.label ?? "").trim();
  if (label !== "") return label;
  const segments = pathSegments(doc.relativePath);
  return segments.length === 0 ? doc.relativePath : segments[segments.length - 1];
}

/** 파일 줄의 앞 폴더 경로. 맨 위 칸에 바로 놓인 파일이면 **빈 글자**다. */
export function modelShareDocParentPath(relativePath: string): string {
  return pathSegments(relativePath).slice(0, -1).join("/");
}

/** 파일 줄의 이름 — 마디 하나다. */
export function modelShareDocFileName(relativePath: string): string {
  const segments = pathSegments(relativePath);
  return segments.length === 0 ? relativePath : segments[segments.length - 1];
}

/**
 * 🔴 이 줄에 [열기]를 그릴 것인가.
 *  · 폴더 → 경로가 있으면 늘 그린다(탐색기는 깊이를 가리지 않는다).
 *  · 파일 → 앞 폴더가 있어야 하고(파일 머리말), 이름이 허용 목록에 든 확장자여야 한다.
 */
export function canOpenModelShareDoc(doc: ModelShareDocRow): boolean {
  if (doc.entryKind === "FOLDER") return pathSegments(doc.relativePath).length > 0;
  return (
    modelShareDocParentPath(doc.relativePath) !== "" &&
    isOpenableQuoteFolderFileName(modelShareDocFileName(doc.relativePath))
  );
}

// ── 🔴 되돌릴 수 없다고 말하는 확인 창 ───────────────────────────────────

const DIALOG_BUTTON_CANCEL =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const DIALOG_BUTTON_DANGER =
  "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 🔴 마스터 데이터 휴지통 창들과 **같은 방식**(native `<dialog>` · `showModal()` · ESC 도
 * 취소 콜백을 거친다)이되, 문장만 이 표의 사실에 맞춘다. 자기 상태를 갖지 않는다.
 */
export function ModelShareDocRemoveDialog({
  isOpen,
  displayName,
  relativePath,
  isSubmitting,
  submitError,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  displayName: string;
  relativePath: string;
  isSubmitting: boolean;
  submitError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      data-model-share-doc-remove-dialog=""
      onCancel={(event) => {
        // ESC 로 닫는 것도 취소 콜백을 거치게 한다 — 전송 중에는 아무 일도 일어나지 않아야 한다.
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-red-300 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-red-900 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id={titleId} className="text-sm font-semibold text-red-700 dark:text-red-400">
        {modelShareDocRemoveTitle(displayName)}
      </h2>
      {/* 🔴 되돌릴 수 없다는 사실을 가장 먼저, 경고 색으로 말한다. */}
      <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-400">
        {MODEL_SHARE_DOC_REMOVE_IRREVERSIBLE_TEXT}
      </p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{MODEL_SHARE_DOC_REMOVE_KEEPS_FILE_TEXT}</p>
      <p className="mt-3 break-all rounded-md border border-zinc-100 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {relativePath}
      </p>

      {submitError && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {submitError}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={isSubmitting} className={DIALOG_BUTTON_CANCEL}>
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          data-model-share-doc-remove-confirm=""
          className={DIALOG_BUTTON_DANGER}
        >
          {isSubmitting ? "지우는 중…" : MODEL_SHARE_DOC_REMOVE_CONFIRM_TEXT}
        </button>
      </div>
    </dialog>
  );
}

// ── 구역 ─────────────────────────────────────────────────────────────────

/** 파일인가 폴더인가 — 줄에 붙는 작은 표시. */
function EntryKindBadge({ entryKind }: { entryKind: ModelShareDocRow["entryKind"] }) {
  return (
    <span
      className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
        entryKind === "FOLDER"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {entryKind === "FOLDER" ? MODEL_SHARE_DOCS_FOLDER_LABEL : MODEL_SHARE_DOCS_FILE_LABEL}
    </span>
  );
}

/**
 * 가리킴 목록만 그린다 — 자기 상태를 갖지 않는다. 🔴 `onRemove` 를 주지 않으면 지우기
 * 단추가 **한 줄에도** 그려지지 않는다.
 */
export function ModelShareDocList({
  docs,
  isBusy = false,
  onRemove,
}: {
  docs: readonly ModelShareDocRow[];
  isBusy?: boolean;
  onRemove?: (doc: ModelShareDocRow) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
      {docs.map((doc) => {
        const displayName = modelShareDocDisplayName(doc);
        const openable = canOpenModelShareDoc(doc);
        return (
          <li
            key={doc.id}
            data-model-share-doc-row=""
            className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <EntryKindBadge entryKind={doc.entryKind} />
                <span className="min-w-0 break-all text-sm text-zinc-900 dark:text-zinc-50">{displayName}</span>
              </span>
              {/* 경로를 숨기지 않는다 — 「어느 자리인가」가 이 줄의 전부다. */}
              <span className="min-w-0 break-all text-[11px] text-zinc-500 dark:text-zinc-400">
                {doc.relativePath}
              </span>
            </div>
            <span className="flex shrink-0 items-start gap-2">
              {/* 🔴 두 단추를 그대로 가져다 쓴다 — 베끼지 않는다. */}
              {openable &&
                (doc.entryKind === "FOLDER" ? (
                  <ContactFolderPlaceOpenButton relativePath={doc.relativePath} />
                ) : (
                  <ContactFolderEntryOpenButton
                    folderName={modelShareDocParentPath(doc.relativePath)}
                    fileName={modelShareDocFileName(doc.relativePath)}
                  />
                ))}
              {onRemove !== undefined && (
                <button
                  type="button"
                  onClick={() => onRemove(doc)}
                  disabled={isBusy}
                  aria-label={`${displayName} 가리킴 지우기`}
                  data-model-share-doc-remove=""
                  className="text-xs font-medium text-red-700 underline disabled:opacity-50 dark:text-red-400"
                >
                  {MODEL_SHARE_DOCS_REMOVE_TEXT}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 🔴 **아무것도 그리지 않는 자리가 있다.** 가리킴이 0건이고 담을 수도 없는 사람에게는
 * 빈 상자가 하나 느는 것뿐이라 구역 자체를 세우지 않는다(이웃들과 같은 규율).
 */
export default function ModelShareDocsSection({
  productModelId,
  docs,
  canManageFiles,
  onAdd,
  onRemove,
}: {
  /** 🔴 모델의 id(UUID)다. 고르는 창의 통로 주소에 그대로 간다. */
  productModelId: string;
  docs: readonly ModelShareDocRow[];
  /** `productModels.files` WRITE. 담기 · 지우기를 보일지 정한다. */
  canManageFiles: boolean;
  onAdd: ModelShareFolderAdd;
  onRemove: (id: string) => Promise<ModelShareDocRemoveAnswer>;
}) {
  const [pendingRemove, setPendingRemove] = useState<ModelShareDocRow | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleRemoveConfirm() {
    const target = pendingRemove;
    if (!target || isRemoving) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      const result = await onRemove(target.id);
      if (!result.ok) {
        // 🔴 거절 문장을 지어내지 않는다 — 서버가 준 말을 창 안에 그대로 적는다.
        setRemoveError(result.message);
        return;
      }
      setPendingRemove(null);
    } finally {
      setIsRemoving(false);
    }
  }

  // 🔴 0건이면 **지정 목록을 안 그린다**(설계 i). 담을 수 있는 사람에게는 고르는 창만
  //    남으므로 구역은 서고, 담을 수 없는 사람에게는 보여 줄 것이 없어 통째로 비운다.
  if (docs.length === 0 && !canManageFiles) return null;

  return (
    <section
      aria-labelledby="model-share-docs-title"
      data-model-share-docs-section=""
      // 🔴 인쇄에서 뺀다 — 적히는 것은 경로지 이 모델의 사실이 아니다(설계 h).
      className="print:hidden flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="model-share-docs-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {MODEL_SHARE_DOCS_TITLE}
        </h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{MODEL_SHARE_DOCS_HINT}</span>
      </div>

      {/*
        🔴 고르는 창은 **권한이 있을 때만** 선다. 설정이 비어 있으면(지금 개발 PC) 창이
        스스로 `disabled` 를 받아 아무것도 그리지 않는다 — 빈 상자가 늘지 않게.
      */}
      {canManageFiles && <ModelShareFolderPicker productModelId={productModelId} onAdd={onAdd} />}

      {/* 🔴 0건이면 지정 목록을 **아예 안 그린다** — 빈 안내 줄도 두지 않는다(설계 i). */}
      {docs.length > 0 && (
        <ModelShareDocList
          docs={docs}
          isBusy={isRemoving}
          {...(canManageFiles ? { onRemove: setPendingRemove } : {})}
        />
      )}

      {/* 🔴 줄의 [열기]가 제 결과에 내는 안내와 **별개로** 세워 둔다 — 공용 조각 그대로다. */}
      {docs.length > 0 && <KindShareDocsHelperNotice />}

      {canManageFiles && (
        <ModelShareDocRemoveDialog
          isOpen={pendingRemove !== null}
          displayName={pendingRemove === null ? "" : modelShareDocDisplayName(pendingRemove)}
          relativePath={pendingRemove?.relativePath ?? ""}
          isSubmitting={isRemoving}
          submitError={removeError}
          onConfirm={() => void handleRemoveConfirm()}
          onCancel={() => {
            setPendingRemove(null);
            setRemoveError(null);
          }}
        />
      )}
    </section>
  );
}
