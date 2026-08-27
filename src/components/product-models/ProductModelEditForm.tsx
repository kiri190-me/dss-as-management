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
import type { SectionEditConflictError } from "@/components/repair-cases/detail/edit/useSectionEditSubmit";
import { PRODUCT_MODEL_DRAFT_LABELS, buildDraftText } from "@/lib/domain/edit-draft-text";

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
 *
 * ── 충돌하면 얼리되, 적어 둔 글은 잃지 않는다 ───────────────────────────
 * 저장이 CONFLICT 로 돌아오면 이 폼은 얼고 `최신 정보 다시 불러오기` 하나만
 * 남는다(EditSectionActions). 그것을 누르면 폼이 언마운트되어 방금 손으로 친 글이
 * 통째로 사라지므로, **얼리기 직전에** 저장하려던 값에서 자유 입력만 뽑아 붙잡아
 * 둔다(buildDraftText + PRODUCT_MODEL_DRAFT_LABELS). 설명 칸은 여러 줄로 길게
 * 적는 자리라 잃으면 그만큼 아프다.
 *
 * 무엇을 담고 무엇을 빼는지는 화면이 아니라 domain/edit-draft-text.ts 가 정한다
 * — 제품 종류는 `<select>` 라 그 맵에 없고, 그래서 상자에 `GENERATOR` 같은 내부
 * 값이 실려 나갈 자리가 없다. 얼리는 규칙 자체는 하나도 바뀌지 않았다.
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
  /**
   * 평상시 오류는 지금까지처럼 문장 하나다. 충돌일 때만 그 문장에 **방금 적어 둔
   * 글**을 얹어 보낸다 — 그 모양을 EditSectionActions 가 이미 알고 있어서, 여기서
   * 넓히는 것만으로 상자가 화면까지 닿는다(그 파일의 ConflictDraftBox).
   */
  const [submitError, setSubmitError] = useState<string | SectionEditConflictError | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  const disabled = isSubmitting || isConflict;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    // 충돌했을 때 이 값에서 자유 입력만 뽑아 붙잡는다(아래 CONFLICT 분기).
    // 서버로 가는 것은 지금까지와 똑같은 이 묶음 그대로다.
    const fields = {
      modelName,
      kind: kind || null,
      manufacturer: manufacturer || null,
      description: description || null,
    };
    try {
      const result = await updateProductModelAction({
        id: productModel.id,
        expectedUpdatedAt: productModel.updatedAt,
        fields,
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 얼리기 **전에** 붙잡는다 — 곧 폼이 사라진다(파일 헤더).
          setIsConflict(true);
          setSubmitError({
            message: result.message,
            draftText: buildDraftText(fields, PRODUCT_MODEL_DRAFT_LABELS),
          });
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
