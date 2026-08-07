"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updatePartAction } from "@/lib/server/actions/inventory";
import type { PartDetail } from "@/lib/db/queries/inventory";

export default function PartEditDialog({
  isOpen,
  onClose,
  part,
  categorySuggestions,
  itemTypeSuggestions,
}: {
  isOpen: boolean;
  onClose: () => void;
  part: PartDetail;
  categorySuggestions: string[];
  itemTypeSuggestions: string[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [partName, setPartName] = useState(part.partName);
  const [partSpec, setPartSpec] = useState(part.partSpec ?? "");
  const [kyosanPartNo, setKyosanPartNo] = useState(part.kyosanPartNo ?? "");
  const [drawingNo, setDrawingNo] = useState(part.drawingNo ?? "");
  const [category, setCategory] = useState(part.category ?? "");
  const [itemType, setItemType] = useState(part.itemType ?? "");
  const [notes, setNotes] = useState(part.notes ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setPartName(part.partName);
      setPartSpec(part.partSpec ?? "");
      setKyosanPartNo(part.kyosanPartNo ?? "");
      setDrawingNo(part.drawingNo ?? "");
      setCategory(part.category ?? "");
      setItemType(part.itemType ?? "");
      setNotes(part.notes ?? "");
      setErrorMessage(null);
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, part]);

  async function handleSubmit() {
    if (!partName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await updatePartAction({
      partId: part.id,
      expectedVersion: part.version,
      patch: {
        partName,
        partSpec: partSpec || null,
        kyosanPartNo: kyosanPartNo || null,
        drawingNo: drawingNo || null,
        category: category || null,
        itemType: itemType || null,
        notes: notes || null,
      },
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="part-edit-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="part-edit-dialog-title" className="text-sm font-semibold">
        부품 정보 수정
      </h2>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          품명 *
          <input
            type="text"
            value={partName}
            onChange={(event) => setPartName(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          품명2
          <input
            type="text"
            value={partSpec}
            onChange={(event) => setPartSpec(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          교산 품번
          <input
            type="text"
            value={kyosanPartNo}
            onChange={(event) => setKyosanPartNo(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          도번
          <input
            type="text"
            value={drawingNo}
            onChange={(event) => setDrawingNo(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          분류
          <input
            type="text"
            list="part-edit-category-options"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <datalist id="part-edit-category-options">
            {categorySuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          항목
          <input
            type="text"
            list="part-edit-item-type-options"
            value={itemType}
            onChange={(event) => setItemType(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <datalist id="part-edit-item-type-options">
            {itemTypeSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="col-span-full flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          비고
          <textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
      </div>

      {errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || !partName.trim()}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "저장 중..." : "저장"}
        </button>
      </div>
    </dialog>
  );
}
