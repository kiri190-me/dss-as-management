"use client";

import { useEffect, useRef, useState } from "react";
import {
  getAllowedMimeTypesForExtension,
  isExtensionAllowedForCategory,
  isExtensionMimeCompatible,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/domain/local/attachments/allowlist";
import {
  ATTACHMENT_CATEGORY_CODES,
  attachmentCategoryLabels,
  type AttachmentCategory,
} from "@/lib/domain/local/attachments/attachment-types";
import { bytesToMegabytes, megabytesToBytes } from "@/lib/domain/local/attachments/format";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_FILE_NAME_LENGTH,
  deriveExtensionFromFileName,
  hasExecutableExtension,
  isSafeFileNameString,
} from "@/lib/domain/local/attachments/filename";

const MAX_SIZE_MB = MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024);

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";
const errorClass = "text-xs text-red-600 dark:text-red-400";

export type AttachmentFormSubmitInput = {
  originalFileName: string;
  displayName: string;
  fileSizeBytes: number;
  category: AttachmentCategory;
  mimeType: string;
  description: string | null;
};

type FieldKey = "originalFileName" | "displayName" | "category" | "mimeType" | "sizeMb" | "description";

type AttachmentFormDialogProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  onSubmit: (input: AttachmentFormSubmitInput) => void;
  onCancel: () => void;
};

export default function AttachmentFormDialog({
  isOpen,
  isSubmitting,
  onSubmit,
  onCancel,
}: AttachmentFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldRefs = useRef<Record<FieldKey, HTMLElement | null>>({
    originalFileName: null,
    displayName: null,
    category: null,
    mimeType: null,
    sizeMb: null,
    description: null,
  });

  const [originalFileName, setOriginalFileName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState<AttachmentCategory | "">("");
  const [mimeType, setMimeType] = useState("");
  const [sizeMb, setSizeMb] = useState("");
  const [description, setDescription] = useState("");
  const [pickerNotice, setPickerNotice] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setOriginalFileName("");
      setDisplayName("");
      setCategory("");
      setMimeType("");
      setSizeMb("");
      setDescription("");
      setPickerNotice(false);
      setErrors({});
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const extension = deriveExtensionFromFileName(originalFileName.trim());
  const allowedMimeOptions = extension ? getAllowedMimeTypesForExtension(extension) : [];

  function handleFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // 메타데이터(name/size/type)만 읽는다 — FileReader/arrayBuffer 등 바이트를
    // 읽는 API는 절대 호출하지 않고, File 객체 자체도 상태에 보관하지 않는다.
    setOriginalFileName(file.name);
    if (!displayName.trim()) setDisplayName(file.name);
    setSizeMb(String(Math.min(MAX_SIZE_MB, Math.round(bytesToMegabytes(file.size) * 100) / 100)));

    const pickedExtension = deriveExtensionFromFileName(file.name);
    if (pickedExtension && file.type && isExtensionMimeCompatible(pickedExtension, file.type)) {
      setMimeType(file.type);
    } else {
      // 브라우저가 보고한 MIME을 실제 내용의 증거로 신뢰하지 않는다 — 비어있거나
      // 허용 목록과 맞지 않으면 사용자가 직접 선택하도록 비워둔다.
      setMimeType("");
    }
    setPickerNotice(true);
    setErrors({});

    // 메타데이터를 복사한 뒤에는 입력을 비워 파일 참조를 남기지 않는다.
    event.target.value = "";
  }

  function focusField(key: FieldKey) {
    const el = fieldRefs.current[key];
    el?.focus();
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function validate(): { errors: Partial<Record<FieldKey, string>>; firstInvalid: FieldKey | null } {
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    const trimmedOriginal = originalFileName.trim();
    const trimmedDisplay = displayName.trim();
    const trimmedDescription = description.trim();

    if (!isSafeFileNameString(trimmedOriginal, MAX_FILE_NAME_LENGTH)) {
      nextErrors.originalFileName = "원본 파일명을 올바르게 입력해 주세요(경로 구분자·제어 문자 불가).";
    } else {
      const ext = deriveExtensionFromFileName(trimmedOriginal);
      if (!ext) {
        nextErrors.originalFileName = "확장자를 확인할 수 없는 파일명입니다.";
      } else if (hasExecutableExtension(ext)) {
        nextErrors.originalFileName = "실행 파일은 첨부할 수 없습니다.";
      } else if (getAllowedMimeTypesForExtension(ext).length === 0) {
        nextErrors.originalFileName = "허용되지 않는 확장자입니다.";
      }
    }

    if (!isSafeFileNameString(trimmedDisplay, MAX_DISPLAY_NAME_LENGTH)) {
      nextErrors.displayName = "표시 이름을 입력해 주세요.";
    }

    if (!category) {
      nextErrors.category = "분류를 선택해 주세요.";
    } else if (extension && !isExtensionAllowedForCategory(extension, category)) {
      nextErrors.category = "선택한 분류에는 이 확장자를 사용할 수 없습니다.";
    }

    if (!mimeType) {
      nextErrors.mimeType = "MIME 유형을 선택해 주세요.";
    } else if (extension && !isExtensionMimeCompatible(extension, mimeType)) {
      nextErrors.mimeType = "확장자와 MIME 유형 조합이 허용되지 않습니다.";
    }

    const parsedSize = Number(sizeMb);
    if (!sizeMb || Number.isNaN(parsedSize) || parsedSize <= 0) {
      nextErrors.sizeMb = "파일 크기를 0보다 크게 입력해 주세요.";
    } else if (parsedSize > MAX_SIZE_MB) {
      nextErrors.sizeMb = `파일 크기는 최대 ${MAX_SIZE_MB}MB까지 입력할 수 있습니다.`;
    }

    if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
      nextErrors.description = `설명은 ${MAX_DESCRIPTION_LENGTH}자 이하로 입력해 주세요.`;
    }

    const order: FieldKey[] = ["originalFileName", "displayName", "category", "mimeType", "sizeMb", "description"];
    const firstInvalid = order.find((key) => nextErrors[key]) ?? null;
    return { errors: nextErrors, firstInvalid };
  }

  function handleSubmit() {
    const { errors: nextErrors, firstInvalid } = validate();
    setErrors(nextErrors);
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }
    onSubmit({
      originalFileName: originalFileName.trim(),
      displayName: displayName.trim(),
      fileSizeBytes: megabytesToBytes(Number(sizeMb)),
      category: category as AttachmentCategory,
      mimeType,
      description: description.trim() || null,
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="attachment-form-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="attachment-form-dialog-title" className="text-sm font-semibold">
        메타데이터 추가
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        실제 파일을 업로드하지 않습니다. 파일명·크기 등 정보만 입력합니다.
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="attachment-file-picker" className={labelClass}>
          파일 선택으로 자동 입력(선택 사항)
        </label>
        <input
          id="attachment-file-picker"
          ref={fileInputRef}
          type="file"
          onChange={handleFilePick}
          className="w-full text-sm text-zinc-700 dark:text-zinc-300"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          파일 내용은 읽거나 전송하지 않습니다. 이름·크기·형식 정보만 복사합니다.
        </p>
        {pickerNotice && !mimeType && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            브라우저가 MIME 유형을 알려주지 않아 아래에서 직접 선택해야 합니다.
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="attachment-original-name" className={labelClass}>
            원본 파일명 *
          </label>
          <input
            id="attachment-original-name"
            ref={(el) => {
              fieldRefs.current.originalFileName = el;
            }}
            type="text"
            value={originalFileName}
            onChange={(event) => setOriginalFileName(event.target.value)}
            aria-invalid={Boolean(errors.originalFileName)}
            aria-describedby={errors.originalFileName ? "attachment-original-name-error" : undefined}
            className={inputClass}
          />
          {extension && <p className="text-xs text-zinc-500 dark:text-zinc-400">확장자: .{extension}</p>}
          {errors.originalFileName && (
            <p id="attachment-original-name-error" className={errorClass}>
              {errors.originalFileName}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="attachment-display-name" className={labelClass}>
            표시 이름 *
          </label>
          <input
            id="attachment-display-name"
            ref={(el) => {
              fieldRefs.current.displayName = el;
            }}
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={Boolean(errors.displayName)}
            aria-describedby={errors.displayName ? "attachment-display-name-error" : undefined}
            className={inputClass}
          />
          {errors.displayName && (
            <p id="attachment-display-name-error" className={errorClass}>
              {errors.displayName}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="attachment-form-category" className={labelClass}>
            분류 *
          </label>
          <select
            id="attachment-form-category"
            ref={(el) => {
              fieldRefs.current.category = el;
            }}
            value={category}
            onChange={(event) => setCategory(event.target.value as AttachmentCategory)}
            aria-invalid={Boolean(errors.category)}
            aria-describedby={errors.category ? "attachment-form-category-error" : undefined}
            className={inputClass}
          >
            <option value="">선택하세요</option>
            {ATTACHMENT_CATEGORY_CODES.map((code) => (
              <option key={code} value={code}>
                {attachmentCategoryLabels[code]}
              </option>
            ))}
          </select>
          {errors.category && (
            <p id="attachment-form-category-error" className={errorClass}>
              {errors.category}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="attachment-mime-type" className={labelClass}>
            MIME 유형 *
          </label>
          <select
            id="attachment-mime-type"
            ref={(el) => {
              fieldRefs.current.mimeType = el;
            }}
            value={mimeType}
            onChange={(event) => setMimeType(event.target.value)}
            disabled={allowedMimeOptions.length === 0}
            aria-invalid={Boolean(errors.mimeType)}
            aria-describedby={errors.mimeType ? "attachment-mime-type-error" : undefined}
            className={inputClass}
          >
            <option value="">
              {allowedMimeOptions.length === 0 ? "먼저 올바른 파일명을 입력하세요" : "선택하세요"}
            </option>
            {allowedMimeOptions.map((mime) => (
              <option key={mime} value={mime}>
                {mime}
              </option>
            ))}
          </select>
          {errors.mimeType && (
            <p id="attachment-mime-type-error" className={errorClass}>
              {errors.mimeType}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="attachment-size" className={labelClass}>
            파일 크기(MB) *
          </label>
          <input
            id="attachment-size"
            ref={(el) => {
              fieldRefs.current.sizeMb = el;
            }}
            type="number"
            min={0.01}
            max={MAX_SIZE_MB}
            step={0.01}
            value={sizeMb}
            onChange={(event) => setSizeMb(event.target.value)}
            aria-invalid={Boolean(errors.sizeMb)}
            aria-describedby={errors.sizeMb ? "attachment-size-error" : undefined}
            className={inputClass}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">최대 300MB. 실제 바이트 업로드 용량이 아닙니다.</p>
          {errors.sizeMb && (
            <p id="attachment-size-error" className={errorClass}>
              {errors.sizeMb}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="attachment-description" className={labelClass}>
          설명
        </label>
        <textarea
          id="attachment-description"
          ref={(el) => {
            fieldRefs.current.description = el;
          }}
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? "attachment-description-error" : undefined}
          className={inputClass}
        />
        {errors.description && (
          <p id="attachment-description-error" className={errorClass}>
            {errors.description}
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "등록 중..." : "등록"}
        </button>
      </div>
    </dialog>
  );
}
