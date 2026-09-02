"use client";

import {
  serviceReportCauseOptions,
  serviceReportFieldError,
  type ServiceReportCauseLabels,
  type ServiceReportFormValues,
} from "@/lib/domain/service-report-form";
import {
  CheckboxField,
  DateField,
  Field,
  FieldGroup,
  ServiceReportSection,
  TextField,
  editInputClass,
} from "./ServiceReportField";

/**
 * 「조　치」와 「원  인」 — 양식의 27~30행.
 *
 * 🔴 원인 열 가지의 코드도 이름도 화면에서 새로 적지 않는다. 이름은 채우개의
 * `SERVICE_REPORT_CAUSE_LABELS`(그것도 `CAUSE_CELLS` 에서 뽑아낸 것이다) 하나뿐
 * 이고, **서버 페이지가 읽어 props 로** 넘겨준다 — 채우개는 `node:fs` 를 끌고
 * 와서 브라우저 번들에 들어갈 수 없다. 그것이 채우개가 아는 코드 열 가지와 딱
 * 맞는다는 것은 시험이 못 박는다.
 *
 * ⚠️ 「조치 완료」는 **수리 보고서에만 있다.** 검사로 고르면 이 칸이 사라지고,
 * 요청에서도 빠진다(서버가 검사에 그것을 보내면 거절한다). 적어 둔 값은 화면
 * 상태에 그대로 남는다 — 종류를 잘못 골랐다가 되돌리는 일이 실제로 있다.
 */
export default function ServiceReportDispositionFields({
  values,
  onChange,
  fieldErrors,
  causeLabels,
  disabled,
}: {
  values: ServiceReportFormValues;
  onChange: (patch: Partial<ServiceReportFormValues>) => void;
  fieldErrors: Record<string, string> | null;
  /** 🔴 채우개의 표에서 온다 — 화면에 사본을 두지 않는다. */
  causeLabels: ServiceReportCauseLabels;
  disabled: boolean;
}) {
  const error = (key: string) => serviceReportFieldError(fieldErrors, key);
  const isRepair = values.kind === "REPAIR";

  function toggleCause(cause: ServiceReportFormValues["causes"][number], checked: boolean) {
    const next = checked
      ? [...values.causes, cause]
      : values.causes.filter((candidate) => candidate !== cause);
    onChange({ causes: next });
  }

  return (
    <ServiceReportSection
      title="조치 · 원인"
      description="체크한 칸에만 표시가 찍힙니다. 「현품 인수」와 「조치 완료」는 날짜를 몰라도 체크만으로 표시됩니다."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup label="조치" error={error("disposition")}>
          <div className="flex flex-col gap-2">
            <CheckboxField
              label="현지수리"
              checked={values.onSiteRepair}
              onChange={(onSiteRepair) => onChange({ onSiteRepair })}
              disabled={disabled}
            />
            <CheckboxField
              label="대품납입"
              checked={values.replacementDelivery}
              onChange={(replacementDelivery) => onChange({ replacementDelivery })}
              disabled={disabled}
            />
            <CheckboxField
              label="현품 인수"
              checked={values.goodsReceiptChecked}
              onChange={(goodsReceiptChecked) => onChange({ goodsReceiptChecked })}
              disabled={disabled}
            />
            {values.goodsReceiptChecked && (
              <div className="ml-6 grid gap-2 sm:grid-cols-2">
                <DateField
                  label="현품 인수 날짜"
                  value={values.goodsReceiptOn}
                  onChange={(goodsReceiptOn) => onChange({ goodsReceiptOn })}
                  error={error("disposition.goodsReceipt.on")}
                  disabled={disabled}
                />
                <TextField
                  label="현품 인수 번호"
                  value={values.goodsReceiptNumber}
                  onChange={(goodsReceiptNumber) => onChange({ goodsReceiptNumber })}
                  error={error("disposition.goodsReceipt.number")}
                  disabled={disabled}
                />
              </div>
            )}
            {isRepair && (
              <>
                <CheckboxField
                  label="조치 완료"
                  checked={values.completionChecked}
                  onChange={(completionChecked) => onChange({ completionChecked })}
                  disabled={disabled}
                />
                {values.completionChecked && (
                  <div className="ml-6">
                    <DateField
                      label="조치 완료 날짜"
                      value={values.completionOn}
                      onChange={(completionOn) => onChange({ completionOn })}
                      error={error("disposition.completion.on")}
                      disabled={disabled}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </FieldGroup>

        <Field label="수리 번호" error={error("repairNumber")} hint="조치 완료 줄의 No.">
          <input
            value={values.repairNumber}
            onChange={(event) => onChange({ repairNumber: event.target.value })}
            disabled={disabled}
            className={editInputClass}
          />
        </Field>
      </div>

      <div className="mt-4">
        <FieldGroup label="원인" error={error("causes")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {serviceReportCauseOptions(causeLabels).map((option) => (
              <CheckboxField
                key={option.value}
                label={option.label}
                checked={values.causes.includes(option.value)}
                onChange={(checked) => toggleCause(option.value, checked)}
                disabled={disabled}
              />
            ))}
          </div>
        </FieldGroup>
      </div>
    </ServiceReportSection>
  );
}
