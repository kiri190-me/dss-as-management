"use client";

import { useState, type FormEvent } from "react";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import { useSectionEditSubmit } from "./useSectionEditSubmit";
import EditSectionActions, { editErrorClass, editInputClass, editLabelClass } from "./EditSectionActions";

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={editLabelClass}>{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

/**
 * Editing the (model, lot, serial, part) triple never mutates the existing
 * `products` row in place — the Server Action resolves (or creates) a
 * product row for the *new* triple and repoints repair_cases.product_id to
 * it, exactly like intake creation does (resolveProduct() is reused
 * verbatim). A product row shared by another repair case is therefore
 * never changed by this form; the old row may become an orphan (see the
 * final report's "remaining risks").
 */
export default function ProductInfoEditForm({
  resolved,
  editableFields,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  editableFields: readonly string[];
  onDone: () => void;
}) {
  const canEdit = (field: string) => editableFields.includes(field);

  const [modelName, setModelName] = useState(resolved.modelName);
  const [lotNumber, setLotNumber] = useState(resolved.lotNumber);
  const [serialNumber, setSerialNumber] = useState(resolved.serialNumber);
  const [partNumber, setPartNumber] = useState(resolved.partNumber ?? "");

  const { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict } =
    useSectionEditSubmit({
      repairCaseId: resolved.id,
      version: resolved.version,
      section: "PRODUCT",
      onDone,
    });

  const disabled = isSubmitting || isConflict;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const fields: Record<string, unknown> = {};
    if (canEdit("modelName")) fields.modelName = modelName;
    if (canEdit("lotNumber")) fields.lotNumber = lotNumber;
    if (canEdit("serialNumber")) fields.serialNumber = serialNumber;
    if (canEdit("partNumber")) fields.partNumber = partNumber || null;
    void submit(fields);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <ReadOnlyField label="제품 구분" value={resolved.productCategory} />

        {canEdit("modelName") ? (
          <div>
            <label className={editLabelClass}>Model</label>
            <input
              className={editInputClass}
              value={modelName}
              disabled={disabled}
              onChange={(e) => setModelName(e.target.value)}
            />
            {fieldErrors.modelName && <p className={editErrorClass}>{fieldErrors.modelName}</p>}
          </div>
        ) : (
          <ReadOnlyField label="Model" value={resolved.modelName} />
        )}

        {canEdit("lotNumber") ? (
          <div>
            <label className={editLabelClass}>L/N</label>
            <input
              className={editInputClass}
              value={lotNumber}
              disabled={disabled}
              onChange={(e) => setLotNumber(e.target.value)}
            />
            {fieldErrors.lotNumber && <p className={editErrorClass}>{fieldErrors.lotNumber}</p>}
          </div>
        ) : (
          <ReadOnlyField label="L/N" value={resolved.lotNumber} />
        )}

        {canEdit("serialNumber") ? (
          <div>
            <label className={editLabelClass}>S/N</label>
            <input
              className={editInputClass}
              value={serialNumber}
              disabled={disabled}
              onChange={(e) => setSerialNumber(e.target.value)}
            />
            {fieldErrors.serialNumber && <p className={editErrorClass}>{fieldErrors.serialNumber}</p>}
          </div>
        ) : (
          <ReadOnlyField label="S/N" value={resolved.serialNumber} />
        )}

        {canEdit("partNumber") && (
          <div>
            <label className={editLabelClass}>Part Number</label>
            <input
              className={editInputClass}
              value={partNumber}
              disabled={disabled}
              onChange={(e) => setPartNumber(e.target.value)}
            />
            {fieldErrors.partNumber && <p className={editErrorClass}>{fieldErrors.partNumber}</p>}
          </div>
        )}
      </dl>

      <EditSectionActions
        isSubmitting={isSubmitting}
        isConflict={isConflict}
        submitError={submitError}
        onCancel={onDone}
        onReloadAfterConflict={reloadAfterConflict}
      />
    </form>
  );
}
