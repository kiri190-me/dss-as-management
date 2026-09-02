"use client";

import {
  countServiceReportBodyRows,
  countServiceReportRemarkRows,
  serviceReportFieldError,
  type ServiceReportFormLimits,
  type ServiceReportFormValues,
} from "@/lib/domain/service-report-form";
import { RowCounter, ServiceReportSection, TextAreaField } from "./ServiceReportField";

/**
 * 본문 세 구역과 비고.
 *
 * ── 줄 수를 늘 보여 준다 ────────────────────────────────────────────────
 * 🔴 본문 상한과 비고 상한은 **서버 페이지가 상수에서 읽어 넘긴 값**이다
 * (`limits`). 화면에 숫자를 적어 두면 양식이 늘어난 날 화면만 뒤처진다.
 *
 * 본문 줄 수에는 눈에 안 보이는 두 줄이 든다 — 정형 문구 한 줄과 문서 끝의
 * 맺음 표시(`～이　상～`) 한 줄. 그래서 세어 놓은 수가 적은 줄 수보다 크다.
 * 그것을 감춰 두면 "298줄밖에 안 적었는데 왜 넘었다고 하나"가 된다.
 *
 * ── 정형 문구 칸 ────────────────────────────────────────────────────────
 * 🔴 기본 문구가 미리 채워져 있고 **지울 수 있다.** 지우면 문서의 확인내용
 * 첫 줄이 비고, 되살리려면 다시 적으면 된다. 지운 것과 안 적은 것을 화면이
 * 구별할 필요는 없다 — 보이는 대로 나간다.
 */
export default function ServiceReportBodyFields({
  values,
  onChange,
  fieldErrors,
  limits,
  rowLimitErrors,
  disabled,
}: {
  values: ServiceReportFormValues;
  onChange: (patch: Partial<ServiceReportFormValues>) => void;
  fieldErrors: Record<string, string> | null;
  limits: ServiceReportFormLimits;
  rowLimitErrors: { body?: string; remark?: string };
  disabled: boolean;
}) {
  const error = (key: string) => serviceReportFieldError(fieldErrors, key);
  const bodyRows = countServiceReportBodyRows(values);
  const remarkRows = countServiceReportRemarkRows(values);

  return (
    <>
      <ServiceReportSection
        title="본문"
        description="한 줄이 문서의 한 줄입니다. 줄 사이를 띄우려면 빈 줄을 넣으세요 — 그대로 문서에 반영됩니다."
      >
        <div className="flex flex-col gap-4">
          <TextAreaField
            label="확인내용 머리글 (정형 문구)"
            value={values.findingsIntro}
            onChange={(findingsIntro) => onChange({ findingsIntro })}
            error={error("body.findingsIntro")}
            rows={2}
            hint="비우면 문서에 안 들어갑니다"
            disabled={disabled}
          />
          <TextAreaField
            label="확인내용"
            value={values.findings}
            onChange={(findings) => onChange({ findings })}
            error={error("body.findings")}
            rows={8}
            disabled={disabled}
          />
          <TextAreaField
            label="조치"
            value={values.actions}
            onChange={(actions) => onChange({ actions })}
            error={error("body.actions")}
            rows={8}
            disabled={disabled}
          />
          {/* 🔴 「정리」는 수리 보고서에만 있다. 검사로 고르면 사라지고 보내지도 않는다. */}
          {values.kind === "REPAIR" && (
            <TextAreaField
              label="정리"
              value={values.summary}
              onChange={(summary) => onChange({ summary })}
              error={error("body.summary")}
              rows={5}
              disabled={disabled}
            />
          )}
        </div>

        <RowCounter used={bodyRows} limit={limits.maxBodyRows} />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          정형 문구 한 줄과 문서 끝의 「～이　상～」 한 줄이 함께 셈에 듭니다. 칸의 가로폭을 넘는 긴
          줄은 문서에서 다시 나뉘므로 실제 줄 수는 조금 더 늘 수 있습니다.
        </p>
        {rowLimitErrors.body && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {rowLimitErrors.body}
          </p>
        )}
        {error("body") && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error("body")}
          </p>
        )}
      </ServiceReportSection>

      <ServiceReportSection title="비고">
        <TextAreaField
          label="비고"
          value={values.remark}
          onChange={(remark) => onChange({ remark })}
          error={error("remark")}
          rows={4}
          disabled={disabled}
        />
        <RowCounter used={remarkRows} limit={limits.maxRemarkRows} />
        {rowLimitErrors.remark && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {rowLimitErrors.remark}
          </p>
        )}
      </ServiceReportSection>
    </>
  );
}
