"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ProductModelDetail } from "@/lib/db/queries/product-models";
import { updateProductModelAction } from "@/lib/server/actions/update-product-model";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";

const KIND_OPTIONS = [
  { value: "", label: "미지정" },
  { value: "GENERATOR", label: "Generator" },
  { value: "MATCHER", label: "Matcher" },
  { value: "TOTAL_CONTROLLER", label: "Total Controller (T/C)" },
];

/**
 * Product model master edit (SUPER_ADMIN/ADMIN only — canEditProductModels
 * already gates whether this component is ever rendered at all, in
 * ProductModelDetailScreen). Single section, always-full submission — same
 * shape as CustomerEditForm, reusing EditSectionActions/editInputClass for
 * visual consistency without duplicating that markup.
 *
 * "미지정" submits kind as an explicit empty string, normalized to `null`
 * by the Server Action's validator — kind is never inferred/defaulted here,
 * matching the "do not derive kind from workflowType" requirement.
 *
 * Renaming model_name only ever updates product_models.model_name —
 * products.model_name (each unit's own historical intake string) is never
 * touched by this form or its Server Action.
 */
export default function ProductModelEditForm({
  productModel,
  onDone,
}: {
  productModel: ProductModelDetail;
  onDone: () => void;
}) {
  const router = useRouter();
  const [modelName, setModelName] = useState(productModel.modelName);
  const [kind, setKind] = useState(productModel.kind ?? "");
  const [manufacturer, setManufacturer] = useState(productModel.manufacturer ?? "");
  const [description, setDescription] = useState(productModel.description ?? "");

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
      const result = await updateProductModelAction({
        id: productModel.id,
        expectedUpdatedAt: productModel.updatedAt,
        fields: {
          modelName,
          kind: kind || null,
          manufacturer: manufacturer || null,
          description: description || null,
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
          <label className={editLabelClass}>모델명</label>
          <input
            className={editInputClass}
            value={modelName}
            disabled={disabled}
            onChange={(e) => setModelName(e.target.value)}
          />
          {fieldErrors.modelName && <p className={editErrorClass}>{fieldErrors.modelName}</p>}
        </div>

        <div>
          <label className={editLabelClass}>제품 종류</label>
          <select
            className={editInputClass}
            value={kind}
            disabled={disabled}
            onChange={(e) => setKind(e.target.value)}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {fieldErrors.kind && <p className={editErrorClass}>{fieldErrors.kind}</p>}
        </div>

        <div>
          <label className={editLabelClass}>제조사</label>
          <input
            className={editInputClass}
            value={manufacturer}
            disabled={disabled}
            onChange={(e) => setManufacturer(e.target.value)}
          />
          {fieldErrors.manufacturer && <p className={editErrorClass}>{fieldErrors.manufacturer}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className={editLabelClass}>설명</label>
          <textarea
            className={editInputClass}
            rows={3}
            value={description}
            disabled={disabled}
            onChange={(e) => setDescription(e.target.value)}
          />
          {fieldErrors.description && <p className={editErrorClass}>{fieldErrors.description}</p>}
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
