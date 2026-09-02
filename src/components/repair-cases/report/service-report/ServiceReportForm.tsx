"use client";

import Link from "next/link";
import { useState } from "react";
import {
  buildServiceReportRequestBody,
  isServiceReportBodyEmpty,
  serviceReportRowLimitErrors,
  serviceReportSerialNumberWarning,
  type ServiceReportCauseLabels,
  type ServiceReportFormLimits,
  type ServiceReportFormValues,
} from "@/lib/domain/service-report-form";
import ServiceReportBodyFields from "./ServiceReportBodyFields";
import ServiceReportDispositionFields from "./ServiceReportDispositionFields";
import ServiceReportHeaderFields from "./ServiceReportHeaderFields";
import { editInputClass, Field, ServiceReportSection } from "./ServiceReportField";

/**
 * ============================================================================
 * 검사·수리 보고서 폼 — 값을 모아 보내고 돌아온 파일을 내려받는다
 * ============================================================================
 * 서버 쪽은 이미 다 있다. 이 화면이 하는 일은 셋뿐이다:
 *
 *   1. 접수 건에서 옮겨 온 초기값을 그리고(서버 페이지가 만들어 넘긴다),
 *   2. 사람이 고친 값을 요청 본문으로 바꿔(`buildServiceReportRequestBody`),
 *   3. `POST … /service-report/xlsx` 가 돌려준 바이트를 파일로 저장한다.
 *
 * 셈은 전부 `domain/service-report-form.ts` 에 있다 — 여기 두면 시험이 붙지
 * 않고, 시험이 없으면 화면과 서버가 어긋난 것을 아무도 모른다.
 *
 * ── 🔴 만든 objectURL 을 놓아 준다 ──────────────────────────────────────
 * `URL.createObjectURL` 이 만든 주소는 문서가 살아 있는 동안 그 블롭을 붙들고
 * 있다. 보고서 하나가 수백 KB 고, 이 화면은 한 사람이 여러 장을 연달아 뽑는
 * 자리다 — 놓아 주지 않으면 탭을 닫을 때까지 계속 쌓인다
 * (`files/FilesScreen.tsx` 의 미리보기와 같은 규칙).
 *
 * ── 실패를 사람이 알아들을 말로 ─────────────────────────────────────────
 * 라우트는 실패마다 코드를 붙여 준다. 코드를 그대로 보여 주면(`RENDER_FAILED`)
 * 화면에 영어 개발자 메시지가 뜨는 것과 같다(UI_GUIDELINE 11). 코드마다 무엇을
 * 하면 되는지를 적어 준다.
 * ============================================================================
 */

const FAILURE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "로그인이 풀렸습니다. 다시 로그인한 뒤 내려받아 주세요.",
  ACCOUNT_NOT_APPROVED: "계정이 아직 승인되지 않았습니다. 관리자에게 문의해 주세요.",
  FORBIDDEN: "이 보고서를 만들 권한이 없습니다. 관리자에게 문의해 주세요.",
  NOT_FOUND: "접수 건을 찾을 수 없습니다. 목록에서 다시 열어 주세요.",
  INVALID_INPUT: "적어 주신 내용을 확인해 주세요. 문제가 있는 칸 밑에 이유를 적어 두었습니다.",
  TEMPLATE_UNAVAILABLE: "보고서 양식을 읽을 수 없습니다. 관리자에게 문의해 주세요.",
  RENDER_FAILED: "보고서를 만들지 못했습니다. 관리자에게 문의해 주세요.",
};

const FALLBACK_FAILURE_MESSAGE = "보고서를 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * 클릭이 브라우저의 내려받기로 넘어간 뒤에 주소를 놓아 준다.
 *
 * `click()` 직후에 곧바로 놓으면 브라우저가 아직 블롭을 읽기 전이라 저장이
 * 취소되는 일이 있다. 1초는 사람이 못 느끼고, 그 사이 붙들려 있는 메모리는
 * 어차피 방금 만든 파일 한 벌이다.
 */
const OBJECT_URL_RELEASE_MS = 1000;

/** `attachment; filename="..."; filename*=UTF-8''...` 에서 사람이 볼 이름을 꺼낸다. */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  // 한글 이름은 이쪽에만 온전히 들어 있다(ASCII 쪽은 `_` 로 바뀌어 있다).
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // 잘못 인코딩된 헤더 하나 때문에 내려받기를 포기하지는 않는다.
    }
  }

  const ascii = /filename="([^"]*)"/i.exec(header);
  return ascii && ascii[1] !== "" ? ascii[1] : null;
}

type FailurePayload = {
  error?: unknown;
  code?: unknown;
  fieldErrors?: unknown;
};

export default function ServiceReportForm({
  repairCaseId,
  intakeNumber,
  reportHref,
  initialValues,
  limits,
  choices,
  causeLabels,
  templateError,
}: {
  repairCaseId: string;
  intakeNumber: string;
  /** 돌아갈 자리 — 「보고서」 탭. */
  reportHref: string;
  initialValues: ServiceReportFormValues;
  limits: ServiceReportFormLimits;
  /** 🔴 양식에서 읽은 드롭다운 목록. 양식을 못 읽었으면 null 이다. */
  choices: { situationRequests: readonly string[]; productNames: readonly string[] } | null;
  /**
   * 🔴 원인 열 가지의 한글 이름. **채우개의 표에서 온다** — 화면이 사본을 들고
   * 있으면 양식의 라벨이 바뀐 날 화면과 문서가 서로 다른 이름을 부른다.
   */
  causeLabels: ServiceReportCauseLabels;
  /** 양식을 못 읽었을 때 사람에게 보여 줄 말. 경로는 담기지 않는다. */
  templateError: string | null;
}) {
  const [values, setValues] = useState<ServiceReportFormValues>(initialValues);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);

  function update(patch: Partial<ServiceReportFormValues>) {
    setValues((previous) => ({ ...previous, ...patch }));
  }

  const rowLimitErrors = serviceReportRowLimitErrors(values, limits);
  const bodyEmpty = isServiceReportBodyEmpty(values);
  // 양식을 못 읽으면 서버도 503 을 준다 — 다 채우고 나서 알게 하지 않는다.
  const blocked = templateError !== null;
  const disabled = isSubmitting || blocked;
  const canDownload =
    !disabled && !bodyEmpty && rowLimitErrors.body === undefined && rowLimitErrors.remark === undefined;

  async function handleDownload() {
    setIsSubmitting(true);
    setFormError(null);
    setStatusMessage(null);
    setFieldErrors(null);

    try {
      const response = await fetch(`/api/repair-cases/${repairCaseId}/service-report/xlsx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildServiceReportRequestBody(values)),
      });

      if (!response.ok) {
        let payload: FailurePayload = {};
        try {
          payload = (await response.json()) as FailurePayload;
        } catch {
          // 본문이 JSON 이 아닌 실패(프록시·게이트웨이)도 있다. 그때는 아래 기본 문구다.
        }

        const code = typeof payload.code === "string" ? payload.code : "";
        setFieldErrors(
          payload.fieldErrors !== null && typeof payload.fieldErrors === "object"
            ? (payload.fieldErrors as Record<string, string>)
            : null
        );
        setFormError(FAILURE_MESSAGES[code] ?? FALLBACK_FAILURE_MESSAGE);
        return;
      }

      const blob = await response.blob();
      const fileName =
        fileNameFromContentDisposition(response.headers.get("Content-Disposition")) ??
        "검사수리보고서.xlsx";

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // 🔴 놓아 준다. 위 'OBJECT_URL_RELEASE_MS' 참조.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_RELEASE_MS);

      setStatusMessage(`${fileName} 을(를) 내려받았습니다.`);
    } catch {
      setFormError("서버에 닿지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            검사 · 수리 보고서
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            인수번호 {intakeNumber} — 적은 내용은 저장되지 않습니다. 지금은 파일로만 내려받습니다.
          </p>
        </div>
        <Link
          href={reportHref}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          보고서 탭으로
        </Link>
      </div>

      {/* 🔴 경로는 담지 않는다 — 오류 메시지가 디스크 구조를 알려 주는 창구가 되면 안 된다. */}
      {templateError && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {templateError}
        </p>
      )}

      {formError && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {formError}
        </p>
      )}

      {statusMessage && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
          {statusMessage}
        </p>
      )}

      <ServiceReportSection
        title="보고서 종류"
        description="수리를 고르면 「정리」와 「조치 완료」 칸이 나타납니다. 검사에는 그 둘이 없습니다."
      >
        <div className="sm:w-64">
          <Field label="종류" required>
            <select
              value={values.kind}
              onChange={(event) =>
                update({ kind: event.target.value === "INSPECTION" ? "INSPECTION" : "REPAIR" })
              }
              disabled={disabled}
              className={editInputClass}
            >
              <option value="REPAIR">수리 보고서</option>
              <option value="INSPECTION">검사 보고서</option>
            </select>
          </Field>
        </div>
      </ServiceReportSection>

      <ServiceReportHeaderFields
        values={values}
        onChange={update}
        fieldErrors={fieldErrors}
        choices={choices ?? { situationRequests: [], productNames: [] }}
        serialNumberWarning={serviceReportSerialNumberWarning(values)}
        disabled={disabled}
      />

      <ServiceReportDispositionFields
        values={values}
        onChange={update}
        fieldErrors={fieldErrors}
        causeLabels={causeLabels}
        disabled={disabled}
      />

      <ServiceReportBodyFields
        values={values}
        onChange={update}
        fieldErrors={fieldErrors}
        limits={limits}
        rowLimitErrors={rowLimitErrors}
        disabled={disabled}
      />

      <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {bodyEmpty && !blocked && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            확인내용이나 조치를 한 줄이라도 적어야 내려받을 수 있습니다.
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={!canDownload}
          aria-busy={isSubmitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "만드는 중…" : "Excel 내려받기"}
        </button>
      </div>
    </div>
  );
}
