"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ProductModelDetail } from "@/lib/db/queries/product-models";
import type { ProductModelCustomerOption } from "@/lib/db/queries/product-model-customers";
import { isExactNormalizedMatch, rankSimilarNames } from "@/lib/domain/entity-name-match";
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

/** IntakeInfoEditForm 의 고객사 콤보박스와 같은 수. 같은 부품이라 같게 둔다. */
const MAX_SUGGESTIONS = 8;

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
 *
 * ── 🔴 제조사 입력칸은 없지만 값은 그대로 다시 보낸다 ────────────────────
 * `제조사` 자리는 화면에서 `고객사` 로 바뀌었다. 그런데 이 폼은 **"항상 전체
 * 제출"** 규약이다(validateProductModelUpdateFields 의 머리말) — `manufacturer`
 * 를 빼고 보내면 검증이 그것을 `null` 로 정규화하고, 누가 그 모델을 한 번이라도
 * 수정하는 순간 **DB 의 제조사 값이 조용히 지워진다.** 칼럼을 지우지 않고 남겨 둔
 * 뜻이 "나중에 되돌릴 수 있게" 인데, 값이 지워지면 그 뜻이 성립하지 않는다.
 *
 * 그래서 `manufacturer` 는 입력칸 없이 **상태로만** 살아 있고 제출 묶음에 원래
 * 값 그대로 실려 나간다. 아래 useState 가 화면 어디에서도 쓰이지 않는 것은
 * 빠뜨린 것이 아니라 이 이유다 — 지우지 말 것.
 * (충돌 상자에는 나오지 않는다. 사람이 친 글이 아니라서 PRODUCT_MODEL_DRAFT_LABELS
 * 에서 뺐다 — 그 파일의 주석 참조.)
 *
 * ── 고객사 고르기 ────────────────────────────────────────────────────────
 * 접수 건 인수 정보의 고객사 칸(IntakeInfoEditForm)과 같은 부품·같은 규칙이다:
 * `<input list>` + `<datalist>`, 순위는 rankSimilarNames, 일치 판정은
 * isExactNormalizedMatch. 다른 점은 셋이다.
 *  1. **여러 곳을 고른다.** 고른 것은 칩으로 쌓이고 각 칩의 ✕ 로 뺀다.
 *  2. **이미 고른 곳은 후보에서 빠진다.** 같은 고객사를 두 번 고르는 길 자체를
 *     없앤다(표의 유니크 인덱스가 최후에 막지만, 거기까지 갈 이유가 없다).
 *  3. 🔴 **여기서는 새 고객사를 만들 수 없다** (사용자 결정). IntakeInfoEditForm
 *     에 있는 `새 고객사로 등록` 을 일부러 두지 않았다 — 고객사를 만드는 문을
 *     접수 화면 하나로 좁혀야 오타로 생긴 고객사가 늘지 않는다. 목록에 없는
 *     이름을 치면 아무것도 고를 수 없고, 그 사실을 입력칸 아래 한 줄이 말한다.
 */
export default function ProductModelEditForm({
  productModel,
  customerOptions,
  onDone,
}: {
  productModel: ProductModelDetail;
  /** 고를 수 있는 고객사 전부(휴지통에 든 것은 서버가 이미 뺐다 —
   * queries/customers.ts 의 listCustomerOptions). 페이지가 수정 권한이 있는
   * 세션에만 채워 넘긴다. */
  customerOptions: ProductModelCustomerOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [modelName, setModelName] = useState(productModel.modelName);
  const [kind, setKind] = useState(productModel.kind ?? "");
  // 🔴 화면에 입력칸이 없다. 값을 잃지 않으려고 들고 있는 것이다(위 헤더 주석).
  const [manufacturer] = useState(productModel.manufacturer ?? "");
  const [description, setDescription] = useState(productModel.description ?? "");
  const [selectedCustomers, setSelectedCustomers] = useState<ProductModelCustomerOption[]>(
    productModel.customers
  );
  /** 콤보박스에 지금 쳐 넣은 글자. 저장되는 값이 아니라 **고르기 위한** 글자다. */
  const [customerQuery, setCustomerQuery] = useState("");

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

  // 이미 고른 고객사는 후보에서 뺀다(헤더 2). 고른 목록이 바뀔 때만 다시 만든다.
  const selectableCustomers = useMemo(() => {
    const chosen = new Set(selectedCustomers.map((c) => c.id));
    return customerOptions.filter((c) => !chosen.has(c.id));
  }, [customerOptions, selectedCustomers]);

  const customerSuggestions = useMemo(
    () => rankSimilarNames(customerQuery, selectableCustomers).slice(0, MAX_SUGGESTIONS),
    [customerQuery, selectableCustomers]
  );

  const trimmedCustomerQuery = customerQuery.trim();
  // 이미 고른 곳의 이름을 다시 쳤을 때. 후보에서 뺐으므로 "없는 이름"과 구분되지
  // 않는데, 사람에게는 전혀 다른 상황이라 따로 말해 준다.
  const queryIsAlreadyChosen =
    trimmedCustomerQuery !== "" &&
    selectedCustomers.some((c) => isExactNormalizedMatch(c.name, trimmedCustomerQuery));
  // 목록에 없는 이름. 여기서는 새로 만들 수 없으므로(헤더 3) 그 사실을 말한다.
  const queryHasNoMatch =
    trimmedCustomerQuery !== "" && !queryIsAlreadyChosen && customerSuggestions.length === 0;

  /**
   * 콤보박스는 고르는 순간에도 타이핑할 때와 똑같이 onChange 로 온다(값이
   * 통째로 들어온다). 그래서 **정확히 일치하는 이름이 오면 고른 것으로 본다** —
   * IntakeInfoEditForm 이 customerId 를 정하는 방식과 같은 판정(isExactNormalizedMatch)
   * 이고, 다른 점은 그 결과를 한 칸에 덮어쓰는 대신 목록에 더한다는 것뿐이다.
   */
  function handleCustomerQueryChange(text: string) {
    const match = selectableCustomers.find((c) => isExactNormalizedMatch(c.name, text));
    if (match) {
      setSelectedCustomers((prev) => [...prev, match]);
      // 골랐으면 칸을 비운다 — 다음 곳을 바로 이어 칠 수 있어야 한다.
      setCustomerQuery("");
      return;
    }
    setCustomerQuery(text);
  }

  function removeCustomer(id: string) {
    setSelectedCustomers((prev) => prev.filter((c) => c.id !== id));
  }

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
      // 🔴 화면에 입력칸이 없는데도 보낸다. 빼면 검증이 null 로 접어 DB 값을
      // 지운다("항상 전체 제출" 규약) — 헤더의 '제조사 입력칸은 없지만' 참조.
      manufacturer: manufacturer || null,
      description: description || null,
      // 고른 **전체 목록**을 보낸다. 서버는 이 배열을 그대로 연결의 최종 상태로
      // 삼는다(빠진 것은 끊고 새로 온 것은 잇는다) — 빈 배열도 정상값이다.
      customerIds: selectedCustomers.map((c) => c.id),
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

        {/* 제조사 입력칸이 있던 자리다. 칸만 없앴고 값은 그대로 다시 보낸다
            (handleSubmit 의 fields.manufacturer) — 헤더 주석 참조. */}
        <div>
          <label htmlFor="product-model-customers" className={editLabelClass}>
            고객사
          </label>
          <input
            id="product-model-customers"
            list="product-model-customer-suggestions"
            autoComplete="off"
            className={editInputClass}
            placeholder="고객사명을 입력해 검색"
            value={customerQuery}
            disabled={disabled}
            onChange={(e) => handleCustomerQueryChange(e.target.value)}
            aria-describedby="product-model-customers-help"
          />
          <datalist id="product-model-customer-suggestions">
            {customerSuggestions.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>

          {selectedCustomers.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {selectedCustomers.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-50 py-0.5 pr-1 pl-2.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <span className="break-all">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => removeCustomer(c.id)}
                    disabled={disabled}
                    // 칩이 여럿 쌓이므로 ✕ 하나하나가 무엇을 빼는지 말해야 한다.
                    aria-label={`고객사 ${c.name} 선택 해제`}
                    className="rounded-full px-1 leading-none text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-50"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {fieldErrors.customerIds && <p className={editErrorClass}>{fieldErrors.customerIds}</p>}

          <p id="product-model-customers-help" className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {queryHasNoMatch ? (
              // 🔴 여기에는 `새 고객사로 등록` 을 두지 않는다(헤더 3). 그러면
              // 사람은 왜 아무것도 안 골라지는지 알 수 없으므로, 어디로 가야
              // 하는지까지 적는다.
              <span className="text-amber-700 dark:text-amber-500">
                &apos;{trimmedCustomerQuery}&apos; 은(는) 등록된 고객사가 아닙니다. 새 고객사는 A/S 접수
                화면에서만 등록할 수 있습니다.
              </span>
            ) : queryIsAlreadyChosen ? (
              <span>이미 선택한 고객사입니다.</span>
            ) : selectedCustomers.length === 0 ? (
              <span>선택한 고객사가 없습니다. 목록에서 골라 여러 곳을 더할 수 있습니다.</span>
            ) : (
              <span>{selectedCustomers.length}곳 선택됨. 목록에서 골라 더할 수 있습니다.</span>
            )}
          </p>
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
