"use client";

import { useState, type FormEvent } from "react";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
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
 * Renders every INTAKE-section field that view mode shows (receivedAt,
 * customer, End-User, customerRequestedDueDate, plus the three contact
 * fields, which view mode currently displays under FaultServiceSection —
 * see the final report's "UI behavior" note on why edit-section ownership
 * follows the authorization matrix rather than the current display layout)
 * — as an input when `editableFields` grants this role that field, as
 * read-only text otherwise, so context is never lost mid-edit.
 */
export default function IntakeInfoEditForm({
  resolved,
  editableFields,
  referenceData,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  editableFields: readonly string[];
  referenceData: IntakeReferenceData | null;
  onDone: () => void;
}) {
  const canEdit = (field: string) => editableFields.includes(field);

  const [customerId, setCustomerId] = useState(resolved.customerId);
  const [endUserId, setEndUserId] = useState<string | null>(resolved.endUserId);
  const [receivedAt, setReceivedAt] = useState(resolved.receivedAt);
  const [customerRequestedDueDate, setCustomerRequestedDueDate] = useState(
    resolved.customerRequestedDueDate ?? ""
  );
  const [contactName, setContactName] = useState(resolved.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(resolved.contactPhone ?? "");
  const [contactEmail, setContactEmail] = useState(resolved.contactEmail ?? "");

  const { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict } =
    useSectionEditSubmit({
      repairCaseId: resolved.id,
      version: resolved.version,
      section: "INTAKE",
      onDone,
    });

  const disabled = isSubmitting || isConflict;
  const allEndUsers = referenceData?.endUsers ?? [];
  const availableEndUsers = allEndUsers.filter((e) => e.customerId === customerId);

  function handleCustomerChange(next: string) {
    setCustomerId(next);
    const stillValid = allEndUsers.some((e) => e.id === endUserId && e.customerId === next);
    if (!stillValid) setEndUserId(null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const fields: Record<string, unknown> = {};
    if (canEdit("customerId")) fields.customerId = customerId;
    if (canEdit("endUserId")) fields.endUserId = endUserId;
    if (canEdit("receivedAt")) fields.receivedAt = receivedAt;
    if (canEdit("customerRequestedDueDate")) fields.customerRequestedDueDate = customerRequestedDueDate || null;
    if (canEdit("contactName")) fields.contactName = contactName || null;
    if (canEdit("contactPhone")) fields.contactPhone = contactPhone || null;
    if (canEdit("contactEmail")) fields.contactEmail = contactEmail || null;
    void submit(fields);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {canEdit("receivedAt") ? (
          <div>
            <label className={editLabelClass}>인수일</label>
            <input
              type="date"
              className={editInputClass}
              value={receivedAt}
              disabled={disabled}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
            {fieldErrors.receivedAt && <p className={editErrorClass}>{fieldErrors.receivedAt}</p>}
          </div>
        ) : (
          <ReadOnlyField label="인수일" value={resolved.receivedAt} />
        )}

        <ReadOnlyField label="유상/무상" value={resolved.paidOrWarranty} />

        {canEdit("customerId") ? (
          <div>
            <label className={editLabelClass}>고객사</label>
            <select
              className={editInputClass}
              value={customerId}
              disabled={disabled}
              onChange={(e) => handleCustomerChange(e.target.value)}
            >
              {(referenceData?.customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldErrors.customerId && <p className={editErrorClass}>{fieldErrors.customerId}</p>}
          </div>
        ) : (
          <ReadOnlyField label="고객사" value={resolved.customerName} />
        )}

        {canEdit("endUserId") ? (
          <div>
            <label className={editLabelClass}>End-User</label>
            <select
              className={editInputClass}
              value={endUserId ?? ""}
              disabled={disabled}
              onChange={(e) => setEndUserId(e.target.value || null)}
            >
              <option value="">선택 안 함</option>
              {availableEndUsers.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            {fieldErrors.endUserId && <p className={editErrorClass}>{fieldErrors.endUserId}</p>}
          </div>
        ) : (
          <ReadOnlyField label="End-User" value={resolved.endUserName ?? "-"} />
        )}

        {canEdit("customerRequestedDueDate") ? (
          <div>
            <label className={editLabelClass}>고객 요청 납기일</label>
            <input
              type="date"
              className={editInputClass}
              value={customerRequestedDueDate}
              disabled={disabled}
              onChange={(e) => setCustomerRequestedDueDate(e.target.value)}
            />
            {fieldErrors.customerRequestedDueDate && (
              <p className={editErrorClass}>{fieldErrors.customerRequestedDueDate}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField label="고객 요청 납기일" value={resolved.customerRequestedDueDate ?? "-"} />
        )}

        <ReadOnlyField label="사내 목표 출하일" value={resolved.internalTargetShipmentDate ?? "-"} />
        <ReadOnlyField label="실제 출하일" value={resolved.actualShipmentDate ?? "-"} />

        {canEdit("contactName") && (
          <div>
            <label className={editLabelClass}>담당자 성함</label>
            <input
              className={editInputClass}
              value={contactName}
              disabled={disabled}
              onChange={(e) => setContactName(e.target.value)}
            />
            {fieldErrors.contactName && <p className={editErrorClass}>{fieldErrors.contactName}</p>}
          </div>
        )}
        {canEdit("contactPhone") && (
          <div>
            <label className={editLabelClass}>연락처(전화)</label>
            <input
              className={editInputClass}
              value={contactPhone}
              disabled={disabled}
              onChange={(e) => setContactPhone(e.target.value)}
            />
            {fieldErrors.contactPhone && <p className={editErrorClass}>{fieldErrors.contactPhone}</p>}
          </div>
        )}
        {canEdit("contactEmail") && (
          <div>
            <label className={editLabelClass}>연락처(이메일)</label>
            <input
              type="email"
              className={editInputClass}
              value={contactEmail}
              disabled={disabled}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            {fieldErrors.contactEmail && <p className={editErrorClass}>{fieldErrors.contactEmail}</p>}
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
