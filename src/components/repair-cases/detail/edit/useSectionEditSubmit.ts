"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateRepairCaseAction } from "@/lib/server/actions/update-repair-case";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";

/**
 * Shared submit/error/conflict state machine for all three section edit
 * forms (Intake/Product/FaultService) — each form only supplies its own
 * field inputs and calls `submit(fields)` with the subset of fields the
 * user actually changed (partial submission; see repair-case-update-
 * input.ts's module comment).
 *
 * On success or on a user-triggered post-CONFLICT reload, this calls
 * router.refresh() (re-fetches the server-rendered detail page, including
 * the new `version`) and `onDone()` (the parent's signal to exit edit
 * mode) — the edit form's own local input state is never explicitly
 * "reset": switching back to view mode simply unmounts it.
 */
export function useSectionEditSubmit(params: {
  repairCaseId: string;
  version: number;
  section: RepairCaseEditSection;
  onDone: () => void;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  async function submit(fields: Record<string, unknown>) {
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const result = await updateRepairCaseAction({
        repairCaseId: params.repairCaseId,
        expectedVersion: params.version,
        section: params.section,
        fields,
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // Freeze — do not allow further edits/saves from this stale form.
          setIsConflict(true);
          setSubmitError(result.message);
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      router.refresh();
      params.onDone();
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    params.onDone();
  }

  return { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict };
}
