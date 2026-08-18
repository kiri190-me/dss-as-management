"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CustomerDetail } from "@/lib/db/queries/customers";
import { updateCustomerAction } from "@/lib/server/actions/update-customer";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";

/**
 * Customer master edit (SUPER_ADMIN/ADMIN only — canEditCustomers already
 * gates whether this component is ever rendered at all, in
 * CustomerDetailScreen). Single section, always-full submission (no
 * per-field role gating like the repair-case section forms) — reuses
 * EditSectionActions/editInputClass etc. for visual consistency with the
 * repair-case detail edit forms without duplicating that markup.
 *
 * On success, calls router.refresh() (re-fetches the server-rendered detail
 * page, including the new updatedAt) and onDone() — same division of labor
 * as useSectionEditSubmit, just inlined here since this screen has only one
 * form and doesn't need a shared hook extracted for a single caller.
 */
export default function CustomerEditForm({
  customer,
  onDone,
}: {
  customer: CustomerDetail;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(customer.name);
  const [contactName, setContactName] = useState(customer.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(customer.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(customer.contactPhone ?? "");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  const disabled = isSubmitting || isConflict;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const result = await updateCustomerAction({
        customerId: customer.id,
        expectedUpdatedAt: customer.updatedAt,
        fields: {
          name,
          contactName: contactName || null,
          contactEmail: contactEmail || null,
          contactPhone: contactPhone || null,
        },
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          setIsConflict(true);
          setSubmitError(result.message);
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      router.refresh();
      onDone();
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <div>
          <label className={editLabelClass}>고객사명</label>
          <input
            className={editInputClass}
            value={name}
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
          />
          {fieldErrors.name && <p className={editErrorClass}>{fieldErrors.name}</p>}
        </div>

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
