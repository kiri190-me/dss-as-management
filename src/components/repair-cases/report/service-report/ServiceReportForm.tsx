"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS,
  clearServiceReportDraft,
  readServiceReportDraft,
  serviceReportDraftStorageKey,
  writeServiceReportDraft,
  type ServiceReportDraft,
  type ServiceReportDraftStore,
} from "@/lib/domain/service-report-draft";
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
import ServiceReportDraftNotice from "./ServiceReportDraftNotice";
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
 *
 * ── 적던 내용을 이 브라우저에 임시로 보관한다 ───────────────────────────
 * 아직 DB 에 저장하는 표가 없어서, 예전에는 새로고침 한 번에 본문 스무 줄이
 * 통째로 날아갔다. 판단과 모양은 전부 `domain/service-report-draft.ts` 에 있고,
 * 여기 있는 것은 `window.localStorage` 를 실제로 두드리는 일과 언제 읽고 언제
 * 적을지 정하는 일뿐이다.
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

/**
 * 저장소를 집는다. 🔴 **속성을 읽는 것 자체가 던진다**(사생활 보호 창, 「사이트
 * 데이터 차단」). 그래서 꺼내 오는 것부터 감싼다 — 이 한 겹이 없으면
 * `service-report-draft.ts` 안의 try/catch 가 아무 소용이 없다. 이 저장소가 실제로
 * 겪은 사고다(커밋 8454a2a).
 */
function serviceReportDraftStore(): ServiceReportDraftStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const draftListeners = new Set<() => void>();

/**
 * 🔴 이 화면이 **처음 본** 임시보관을 열쇠마다 들고 있는 자리. 두 가지를 한꺼번에
 * 푼다:
 *
 *   1. **useSyncExternalStore 의 스냅샷은 값이 안 바뀌었으면 같은 것이어야 한다.**
 *      부를 때마다 저장소를 읽어 JSON 을 새로 풀면 매번 새 객체가 나와 React 가
 *      "계속 바뀐다"고 보고 무한히 다시 그린다(커밋 8454a2a 가 목록 26개에서 막은
 *      바로 그 함정이다).
 *   2. **되살리기는 화면에 들어온 그 순간의 사실이다.** 이 화면은 0.5초마다
 *      스스로 저장소에 적으므로, 계속 다시 읽으면 사람이 글을 치는 도중에
 *      「되살렸습니다」 안내가 튀어나온다 — 되살린 적이 없는데도.
 */
const seenDrafts = new Map<string, ServiceReportDraft | null>();

function subscribeDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
    // 이 화면을 떠나면 들고 있던 것을 놓는다. 다시 들어왔을 때 **방금 적어 둔
    // 것까지** 되살리려면 그때 저장소를 새로 읽어야 한다.
    if (draftListeners.size === 0) seenDrafts.clear();
  };
}

/**
 * 되살릴 임시보관. 저장소를 읽는 일은 `service-report-draft.ts` 가 하고(던지지
 * 않는다), 여기서는 그 결과를 **한 번만** 받아 들고 있는다 — 위 seenDrafts 참조.
 */
function draftSnapshot(
  storageKey: string,
  fallback: ServiceReportFormValues,
  causeCodes: readonly string[]
): ServiceReportDraft | null {
  const seen = seenDrafts.get(storageKey);
  if (seen !== undefined) return seen;

  const draft = readServiceReportDraft(
    serviceReportDraftStore(),
    storageKey,
    // 없거나 모양이 틀린 칸이 떨어질 자리 — 지금 화면이 만든 자동 채움 값이다.
    fallback,
    causeCodes
  );
  seenDrafts.set(storageKey, draft);
  return draft;
}

/**
 * 서버에는 저장소가 없다. **되살릴 것이 없는 사람과 같은 화면**을 준다.
 *
 * 이 한 줄이 hydration 을 맞추는 자리다 — 첫 렌더에서 그냥 읽으면 서버가 그린
 * 것과 달라지고, effect 에서 읽어 setState 하면 자동 채움 값이 한 프레임 스쳐
 * 지나간다. useSyncExternalStore 가 정확히 이 상황을 위한 것이다
 * (`common/responsive-list.tsx` 의 readServer 와 같은 판단).
 */
function draftServerSnapshot(): ServiceReportDraft | null {
  return null;
}

export default function ServiceReportForm({
  repairCaseId,
  actingUserId,
  intakeNumber,
  reportHref,
  initialValues,
  limits,
  choices,
  causeLabels,
  templateError,
}: {
  repairCaseId: string;
  /**
   * 🔴 임시보관 열쇠에 쓸 **사람 id 하나뿐**이다. 이름·역할·이메일은 받지
   * 않는다 — 화면이 안 쓰는 것을 클라이언트로 내려보내지 않는다.
   */
  actingUserId: string;
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);

  const draftKey = useMemo(
    () => serviceReportDraftStorageKey(actingUserId, repairCaseId),
    [actingUserId, repairCaseId]
  );

  /**
   * 되살릴 때 인정할 원인 코드. 🔴 **채우개의 표에서 온 것**을 그대로 쓴다
   * (`causeLabels`) — 목록을 여기 베끼면 양식에 원인이 하나 늘어난 날 체크가
   * 조용히 풀린다.
   */
  const causeCodes = useMemo(() => Object.keys(causeLabels), [causeLabels]);

  /** 들어올 때 되살린 임시보관. 없으면 null. 위 seenDrafts 주석 참조. */
  const restoredDraft = useSyncExternalStore(
    subscribeDraft,
    () => draftSnapshot(draftKey, initialValues, causeCodes),
    draftServerSnapshot
  );

  /**
   * 🔴 **사람이 이번에 고친 값.** 아직 한 칸도 안 고쳤으면 null 이다.
   *
   * 「지금 화면의 값」을 state 하나에 담지 않고 이렇게 갈라 두는 까닭이 둘이다:
   *
   *   · **hydration.** 되살린 값은 브라우저에만 있으므로 서버가 그린 첫 화면은
   *     언제나 자동 채움 값이어야 한다. 위 useSyncExternalStore 가 그 자리를
   *     맡고(서버 스냅샷은 null), 이 state 는 그 위에 얹힌다.
   *   · **열어만 보고 나간 화면은 적지 않는다.** 이 값이 null 인 동안은 적어 둘
   *     것이 없다 — 그렇지 않으면 보고서 화면을 열어 본 접수 건마다 임시보관이
   *     하나씩 쌓여 저장소가 이유 없이 찬다.
   */
  const [edited, setEdited] = useState<ServiceReportFormValues | null>(null);

  /** 지금 화면의 값 — 고친 것 > 되살린 것 > 자동 채움. 이 순서를 바꾸지 말 것. */
  const values = edited ?? restoredDraft?.values ?? initialValues;

  function update(patch: Partial<ServiceReportFormValues>) {
    setEdited((previous) => ({ ...(previous ?? values), ...patch }));
  }

  /**
   * ── 적는 대로 보관한다 — 다만 묶어서 ─────────────────────────────────
   * 글자마다 적으면 한 글자에 한 번씩 폼 전체를 JSON 으로 만들어 저장소를
   * 때린다(`localStorage` 쓰기는 동기라 그대로 입력의 끊김이 된다). 그래서
   * 0.5초 묶어서 적는다 — 그 값을 고른 까닭은
   * `SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS` 주석에 있다.
   *
   * 값이 바뀔 때마다 앞의 시계를 버리고 새로 건다(cleanup) — 글자를 치는 동안은
   * 아무것도 안 적히고, 손을 떼고 0.5초가 지나야 한 번 적힌다.
   */
  useEffect(() => {
    if (edited === null) return;

    const timer = window.setTimeout(() => {
      writeServiceReportDraft(
        serviceReportDraftStore(),
        draftKey,
        edited,
        new Date().toISOString()
      );
    }, SERVICE_REPORT_DRAFT_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [edited, draftKey]);

  /** 「새로 시작」 — 임시보관을 지우고 자동 채움된 처음 상태로 돌아간다. */
  function handleDiscardDraft() {
    clearServiceReportDraft(serviceReportDraftStore(), draftKey);
    // 들고 있던 것도 놓고 알린다 — 그래야 안내가 그 자리에서 사라진다.
    seenDrafts.set(draftKey, null);
    for (const listener of draftListeners) listener();
    setEdited(null);
    // 버린 글에 붙어 있던 지적이라 함께 지운다 — 안 그러면 없는 글에 대한
    // 오류가 칸 밑에 남는다.
    setFieldErrors(null);
    setFormError(null);
    setStatusMessage(null);
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

      // 🔴 **내려받았다고 임시보관을 지우지 않는다**(2026-09-02 사용자 결정).
      // 아직 DB 에 저장하는 표가 없어서 그 임시보관이 **유일한 사본**이다. 여기서
      // 지우면, 받은 파일을 열어 보고 고칠 것을 발견한 사람이 처음부터 다시
      // 적어야 한다 — 한 장을 두세 번 뽑는 것이 이 화면의 보통 쓰임이다.
      // ⏳ DB 저장이 생기는 날 이 판단을 다시 본다(그때는 저장이 곧 사본이라,
      //    내려받기 뒤에 임시보관을 정리하는 편이 맞을 수 있다).
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
            인수번호 {intakeNumber} — 지금은 파일로만 내려받습니다.
          </p>
        </div>
        <Link
          href={reportHref}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          보고서 탭으로
        </Link>
      </div>

      {/* 지금 적는 것이 어디에 남는지, 되살린 것이 있으면 그 사실과 버리는 길. */}
      <ServiceReportDraftNotice
        restored={restoredDraft !== null}
        savedAt={restoredDraft?.savedAt ?? null}
        onDiscard={handleDiscardDraft}
        disabled={isSubmitting}
      />

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
