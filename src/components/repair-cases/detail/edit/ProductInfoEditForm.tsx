"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import {
  WORKFLOW_REASSIGNMENT_KIND_CODES,
  workflowKindLabels,
  workflowKindOf,
  type WorkflowKind,
} from "@/lib/domain/workflow-kind";
import { normalizeEntityName, rankSimilarNames } from "@/lib/domain/entity-name-match";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { useSectionEditSubmit } from "./useSectionEditSubmit";
import EditSectionActions, { editErrorClass, editInputClass, editLabelClass } from "./EditSectionActions";

const MAX_SUGGESTIONS = 8;

function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className={editLabelClass}>{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

/**
 * Editing the (model, lot, serial) triple never mutates the existing
 * `products` row in place — the Server Action resolves (or creates) a
 * product row for the *new* triple and repoints repair_cases.product_id to
 * it, exactly like intake creation does (resolveProduct() is reused
 * verbatim). A product row shared by another repair case is therefore
 * never changed by this form; the old row may become an orphan (see the
 * final report's "remaining risks"). Part Number is intentionally not
 * exposed here (UI IA cleanup checkpoint) — the underlying column is
 * preserved untouched via resolveProduct(), just never editable from the UI.
 *
 * Product Model Master 연결 체크포인트 — Model은 더 이상 자유 입력이 아니라
 * customerId/newCustomerName과 같은 콤보박스 패턴이다(IntakeInfoEditForm의
 * 고객사 필드 참고): 기존 product_models와 정규화 일치하면 productModelId가
 * 채워지고, 그 외에는 canEdit("newProductModelName")(=SUPER_ADMIN/ADMIN)일
 * 때만 "새 모델로 등록" 버튼이 노출된다. lot/serial과 달리 Model 필드는
 * 사용자가 실제로 건드렸을 때만 제출된다(dirty 체크) — 정확히 일치하는
 * 마스터가 없는 레거시/미연결 Model을 그대로 둔 채 다른 필드만 저장하는
 * 흔한 편집이 "Model을 확인할 수 없습니다" 오류로 막히지 않게 하기 위함이다.
 *
 * 종류(매쳐/제너레이터)는 intake_inspection 단계(=createRepairCase가 실제로
 * 새 접수를 배치하는 첫 단계)에 아직 머물러 있을 때만(=워크플로 전이가 한
 * 번도 일어난 적 없을 때만) 재배정을 허용한다 — 그 이후에는 템플릿마다 단계
 * 구성이 달라 안전하게 대응시킬 방법이 없어 읽기 전용으로 표시한다(서버가
 * status_change_histories 이력까지 별도로 재확인하는 최종 권한자다 — 여기 UX
 * 게이트는 그 판단을 미리 보여주는 것일 뿐). 실제로 값이 바뀌었을 때만
 * workflowKind 필드를 제출한다 — 항상 제출하면 아무것도 바꾸지 않았는데도
 * 매번 재배정 로직(버전 재조회 등)이 실행되어 버린다.
 *
 * 유상/무상은 더 이상 여기서 편집하지 않는다(UI IA 정리 체크포인트) — 인수
 * 정보 섹션의 단독 소관이다. GENERATOR로 재배정하는데 저장된 billing_type이
 * 아직 없으면(레거시 NULL 등) 서버가 거부하며, 사용자는 인수정보에서 먼저
 * 유상/무상을 선택해야 한다 — submitError 배너로 안내된다.
 */
export default function ProductInfoEditForm({
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
  const canRegisterProductModel = canEdit("newProductModelName");

  const productModelOptions = useMemo(() => referenceData?.productModels ?? [], [referenceData]);
  // resolved.modelName은 이 케이스가 연결된 products 행의 스냅샷 텍스트일
  // 뿐 productModelId 자체를 담고 있지 않다 — 현재 등록된 마스터 중 정규화
  // 기준으로 정확히 일치하는 것이 있으면 그것을 "현재 선택된 Model"로
  // 간주한다. 레거시/미연결 제품(정확히 일치하는 마스터가 없음)이면 null로
  // 남는다 — 사용자가 Model을 직접 건드리지 않는 한 이 필드는 그대로
  // 제출되지 않는다(아래 handleSubmit의 dirty 체크 참고).
  const initialProductModelId = useMemo(() => {
    const match = productModelOptions.find((m) => normalizeEntityName(m.name) === normalizeEntityName(resolved.modelName));
    return match?.id ?? null;
  }, [productModelOptions, resolved.modelName]);

  const [modelName, setModelName] = useState(resolved.modelName);
  const [productModelId, setProductModelId] = useState<string | null>(initialProductModelId);
  const [productModelCreateNew, setProductModelCreateNew] = useState(false);
  const productModelSuggestions = useMemo(
    () => rankSimilarNames(modelName, productModelOptions).slice(0, MAX_SUGGESTIONS),
    [modelName, productModelOptions]
  );

  function handleModelNameChange(text: string) {
    const match = productModelOptions.find((m) => normalizeEntityName(m.name) === normalizeEntityName(text));
    setModelName(text);
    setProductModelId(match?.id ?? null);
    setProductModelCreateNew(false);
  }

  function handleCreateNewProductModel() {
    setProductModelCreateNew(true);
  }

  const [lotNumber, setLotNumber] = useState(resolved.lotNumber);
  const [serialNumber, setSerialNumber] = useState(resolved.serialNumber);
  const [accessoryList, setAccessoryList] = useState(resolved.accessoryList ?? "");
  const [externalConditionSummary, setExternalConditionSummary] = useState(
    resolved.externalConditionSummary ?? ""
  );
  const [reasonForRemoval, setReasonForRemoval] = useState(resolved.reasonForRemoval ?? "");

  const initialWorkflowKind = workflowKindOf(resolved.workflowType);
  const [workflowKind, setWorkflowKind] = useState<WorkflowKind>(initialWorkflowKind);

  const { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict } =
    useSectionEditSubmit({
      repairCaseId: resolved.id,
      version: resolved.version,
      section: "PRODUCT",
      onDone,
    });

  const disabled = isSubmitting || isConflict;
  // 종류를 바꿀 수 있는 현재 워크플로 — 서버(repair-cases.ts의 REASSIGNABLE_FROM)와
  // 같은 넷이다. 2026-08-19에 레거시 "MATCHER"가 없어지면서 그 자리를 유상/무상
  // Matcher가 대신한다. 여기만 좁혀 두면 서버는 받아 주는데 버튼이 안 보이고,
  // 여기만 넓히면 눌렀을 때 거절당한다 — 둘은 같이 움직여야 한다.
  const REASSIGNABLE_FROM = ["PAID_MATCHER", "WARRANTY_MATCHER", "PAID_GENERATOR", "WARRANTY_GENERATOR"] as const;
  const canReassignKind =
    canEdit("workflowKind") &&
    resolved.currentWorkflowStepKey === "intake_inspection" &&
    (REASSIGNABLE_FROM as readonly string[]).includes(resolved.workflowType);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const fields: Record<string, unknown> = {};
    // Model은 lot/serial과 달리 무조건 재전송하지 않는다 — 사용자가 실제로
    // 건드리지 않았다면(선택된 productModelId가 처음 계산된 값과 동일하고
    // "새로 등록"도 누르지 않았다면) 아예 제출하지 않아, 정확히 일치하는
    // 마스터가 없는 레거시/미연결 Model을 그대로 둔 채 다른 필드(예:
    // accessoryList)만 저장하는 흔한 경우에도 "Model을 확인할 수 없습니다"
    // 오류가 나지 않는다.
    if (canEdit("productModelId")) {
      const modelSelectionChanged = productModelId !== initialProductModelId || productModelCreateNew;
      if (modelSelectionChanged) {
        if (productModelCreateNew) {
          fields.newProductModelName = modelName.trim();
        } else if (productModelId) {
          fields.productModelId = productModelId;
        }
      }
    }
    if (canEdit("lotNumber")) fields.lotNumber = lotNumber;
    if (canEdit("serialNumber")) fields.serialNumber = serialNumber;
    if (canEdit("accessoryList")) fields.accessoryList = accessoryList || null;
    if (canEdit("externalConditionSummary")) fields.externalConditionSummary = externalConditionSummary || null;
    if (canEdit("reasonForRemoval")) fields.reasonForRemoval = reasonForRemoval || null;

    if (canReassignKind && workflowKind !== initialWorkflowKind) {
      fields.workflowKind = workflowKind;
    }

    void submit(fields);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {canReassignKind ? (
          <div>
            <label className={editLabelClass}>종류</label>
            <select
              className={editInputClass}
              value={workflowKind}
              disabled={disabled}
              onChange={(e) => setWorkflowKind(e.target.value as WorkflowKind)}
            >
              {WORKFLOW_REASSIGNMENT_KIND_CODES.map((code) => (
                <option key={code} value={code}>
                  {workflowKindLabels[code]}
                </option>
              ))}
            </select>
            {fieldErrors.workflowKind && <p className={editErrorClass}>{fieldErrors.workflowKind}</p>}
          </div>
        ) : (
          <ReadOnlyField label="종류" value={workflowKindLabels[initialWorkflowKind]} />
        )}

        {canEdit("productModelId") ? (
          <div>
            <label htmlFor="edit-modelName" className={editLabelClass}>Model</label>
            <input
              id="edit-modelName"
              list="edit-modelName-suggestions"
              autoComplete="off"
              className={editInputClass}
              value={modelName}
              disabled={disabled}
              onChange={(e) => handleModelNameChange(e.target.value)}
              aria-describedby={fieldErrors.productModelId || fieldErrors.newProductModelName ? undefined : "edit-modelName-help"}
            />
            <datalist id="edit-modelName-suggestions">
              {productModelSuggestions.map((m) => (
                <option key={m.id} value={m.name} />
              ))}
            </datalist>
            {fieldErrors.productModelId && <p className={editErrorClass}>{fieldErrors.productModelId}</p>}
            {fieldErrors.newProductModelName && <p className={editErrorClass}>{fieldErrors.newProductModelName}</p>}
            {!productModelId && modelName.trim() && (
              productModelCreateNew ? (
                <p id="edit-modelName-help" className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ 새 Model &apos;{modelName.trim()}&apos;로 등록됩니다.{" "}
                  <button type="button" onClick={() => setProductModelCreateNew(false)} className="underline">
                    취소
                  </button>
                </p>
              ) : canRegisterProductModel ? (
                <button
                  type="button"
                  id="edit-modelName-help"
                  onClick={handleCreateNewProductModel}
                  className="mt-1 text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  새 모델로 등록: &apos;{modelName.trim()}&apos;
                </button>
              ) : (
                <p id="edit-modelName-help" className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  등록된 Model 중에서 선택해 주세요. 목록에 없다면 관리자에게 등록을 요청해 주세요.
                </p>
              )
            )}
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

        {canEdit("accessoryList") ? (
          <div>
            <label className={editLabelClass}>동봉 액세서리</label>
            <input
              className={editInputClass}
              value={accessoryList}
              disabled={disabled}
              onChange={(e) => setAccessoryList(e.target.value)}
            />
            {fieldErrors.accessoryList && <p className={editErrorClass}>{fieldErrors.accessoryList}</p>}
          </div>
        ) : (
          <ReadOnlyField label="동봉 액세서리" value={resolved.accessoryList} />
        )}

        {canEdit("externalConditionSummary") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>외관 상태 요약</label>
            <textarea
              rows={2}
              className={editInputClass}
              value={externalConditionSummary}
              disabled={disabled}
              onChange={(e) => setExternalConditionSummary(e.target.value)}
            />
            {fieldErrors.externalConditionSummary && (
              <p className={editErrorClass}>{fieldErrors.externalConditionSummary}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField label="외관 상태 요약" value={resolved.externalConditionSummary} />
        )}

        {canEdit("reasonForRemoval") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>탈거 사유</label>
            <input
              className={editInputClass}
              value={reasonForRemoval}
              disabled={disabled}
              onChange={(e) => setReasonForRemoval(e.target.value)}
            />
            {fieldErrors.reasonForRemoval && <p className={editErrorClass}>{fieldErrors.reasonForRemoval}</p>}
          </div>
        ) : (
          <ReadOnlyField label="탈거 사유" value={resolved.reasonForRemoval} />
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
