"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { uploadExcelImportPreviewAction } from "@/lib/server/actions/excel-import-preview";
import { excelImportIssueDisplay } from "@/lib/domain/excel-import-issue-messages";
import {
  buildExcelImportPreviewHref,
  excelImportPreviewClassificationReason,
  EXCEL_IMPORT_PREVIEW_FILTER_LABELS,
  type ExcelImportPreviewFilter,
} from "@/lib/domain/excel-import-preview-filter";
import type { ExcelImportPreviewPage } from "@/lib/db/queries/excel-import-preview";
import ExcelImportExecutionPanel from "./ExcelImportExecutionPanel";
import { ExcelImportPreviewFilterCards } from "./ExcelImportPreviewFilterCards";
import {
  completeExcelImportPreviewNavigation,
  EXCEL_IMPORT_ACTION_ERROR_MESSAGES,
  submitExcelImportPreview,
  type ExcelImportSubmitMode,
} from "./repair-case-excel-import-submit";

const STATUS_LABELS: Record<string, string> = {
  WAITING_INTAKE_INSPECTION: "인수검사 대기",
  WAITING_PO: "P.O 대기",
  WAITING_PARTS_SUPPLY: "부품 수급 대기",
  IN_REPAIR: "수리 중",
  WAITING_SHIPMENT: "출하 대기",
  SHIPMENT_COMPLETED: "출하 완료",
};

const RAW_COLUMN_LABELS: Record<string, string> = {
  A: "보고서번호", B: "인수번호", C: "인수일", D: "고객사", E: "End-User", F: "제품 종류", G: "Model", H: "L/N", I: "동일 L/N 과거 입고 횟수(이관 제외)", J: "S/N", K: "견적번호", L: "유·무상", M: "선적", N: "납입", O: "수리보고서", P: "세금계산서", Q: "기재자", R: "장소", S: "고장 증상", T: "교산출하일", U: "현재 상태·비고", V: "점검 완료일", W: "수리 완료일", X: "담당자", Y: "수리소 출하확인",
};

function compactText(value: string | null | undefined, maximum = 80): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return !text ? "—" : text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function businessColorLabel(value: string | undefined): string {
  if (value === "BUSINESS_WHITE") return "출하 완료";
  if (value === "BUSINESS_YELLOW") return "진행 중";
  return "색상 확인 필요";
}

function display(value: string | null): string {
  return value ?? "—";
}

function ClassificationBadge({ value }: { value: "EXECUTABLE" | "AUTO_EXCLUDED" | "CONFLICT" | "IMPORTED" | "FAILED" }) {
  const className =
    value === "EXECUTABLE" || value === "IMPORTED"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : value === "AUTO_EXCLUDED"
        ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      : value === "CONFLICT"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  const label = value === "EXECUTABLE" ? "접수 가능" : value === "AUTO_EXCLUDED" ? "자동 제외" : value === "CONFLICT" ? "충돌" : value === "IMPORTED" ? "이관 완료" : "실패";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>;
}

export default function RepairCaseExcelImportScreen({
  preview,
  notice,
  previewError,
}: {
  preview: ExcelImportPreviewPage | null;
  notice?: "created" | "reused" | "reset" | "refresh";
  previewError?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issueCodes, setIssueCodes] = useState<string[]>([]);
  const [expired, setExpired] = useState<{ batchId: string; version: number } | null>(null);
  const [parserRefresh, setParserRefresh] = useState<{ batchId: string; version: number } | null>(null);
  const [completionMessage, setCompletionMessage] = useState<string | null>(null);
  const [existingBatch, setExistingBatch] = useState<{ batchId: string; status: string; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function selectPreviewFilter(filter: ExcelImportPreviewFilter) {
    if (!preview || pending || filter === preview.filter) return;
    router.push(buildExcelImportPreviewHref({ batchId: preview.batch.id, filter }));
  }

  function submit(mode: ExcelImportSubmitMode = "normal") {
    if (submittingRef.current) return;
    if (!formRef.current || !selectedFile) {
      setError(EXCEL_IMPORT_ACTION_ERROR_MESSAGES.FILE_REQUIRED);
      return;
    }
    if (selectedFile.size > 20 * 1024 * 1024) {
      setError(EXCEL_IMPORT_ACTION_ERROR_MESSAGES.FILE_TOO_LARGE);
      return;
    }
    const formData = new FormData(formRef.current);
    submittingRef.current = true;
    setError(null);
    setIssueCodes([]);
    setCompletionMessage(null);
    setExistingBatch(null);
    startTransition(async () => {
      try {
        const outcome = await submitExcelImportPreview({
          formData,
          mode,
          expired,
          parserRefresh,
          action: uploadExcelImportPreviewAction,
        });
        setIssueCodes(outcome.kind === "ERROR" || outcome.kind === "EXPIRED_CONFIRMATION" || outcome.kind === "PARSER_REFRESH_CONFIRMATION" ? outcome.issueCodes : []);
        if (outcome.kind === "EXISTING_BATCH") {
          setExpired(null);
          setParserRefresh(null);
          setExistingBatch({ batchId: outcome.batchId, status: outcome.status, message: outcome.message });
          return;
        }
        if (outcome.kind === "EXPIRED_CONFIRMATION") {
          setExpired({ batchId: outcome.batchId, version: outcome.version });
          setParserRefresh(null);
          setError(outcome.message);
          return;
        }
        if (outcome.kind === "PARSER_REFRESH_CONFIRMATION") {
          setParserRefresh({ batchId: outcome.batchId, version: outcome.version });
          setExpired(null);
          setError(outcome.message);
          return;
        }
        if (outcome.kind === "ERROR") {
          setExpired(null);
          setParserRefresh(null);
          setError(outcome.message);
          return;
        }

        setExpired(null);
        setParserRefresh(null);
        setCompletionMessage(outcome.message);
        const navigation = await completeExcelImportPreviewNavigation({
          batchId: outcome.batchId,
          notice: outcome.notice,
          push: (href) => router.push(href),
          refresh: () => router.refresh(),
        });
        if (!navigation.ok) setError(navigation.message);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">수리품 목록 Excel 이관</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Excel의 ‘목록’ 시트를 안전하게 분석하고 이관 전 검토 목록을 만듭니다.</p>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <form ref={formRef} className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Excel 파일
            <input
              name="file"
              type="file"
              required
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setExpired(null);
                setParserRefresh(null);
                setError(null);
                setIssueCodes([]);
                setCompletionMessage(null);
                setExistingBatch(null);
              }}
              className="max-w-xl rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:font-medium dark:border-zinc-700 dark:bg-zinc-950 dark:file:bg-zinc-800"
            />
          </label>
          <p className="text-xs text-zinc-500">.xlsx만 가능 · 최대 20 MiB · 원본 파일은 저장하지 않습니다.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending || !selectedFile} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
              {pending ? "분석 중…" : "업로드하고 분석"}
            </button>
            {expired && (
              <button type="button" disabled={pending} onClick={() => submit("expired")} className="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 disabled:opacity-50 dark:bg-amber-950 dark:text-amber-200">
                만료된 Preview 다시 분석
              </button>
            )}
            {parserRefresh && (
              <>
                <button type="button" disabled={pending} onClick={() => submit("refresh")} className="rounded-md border border-blue-400 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-900 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-200">
                  새 검토 정책으로 다시 분석
                </button>
                <p className="basis-full text-xs text-blue-700 dark:text-blue-300">다시 분석하면 기존 수동 매핑과 검토 선택은 폐기되고 Parser v6 원문·업무 색상 기준으로 재계산됩니다.</p>
              </>
            )}
          </div>
        </form>

        {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
        {completionMessage && <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{completionMessage}</p>}
        {existingBatch && (
          <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
            <span>{existingBatch.message}</span>
            <button type="button" onClick={() => router.push(`/excel-imports/repair-cases?batch=${encodeURIComponent(existingBatch.batchId)}&notice=reused`)} className="rounded border border-blue-400 px-3 py-1.5 font-medium hover:bg-blue-100 dark:hover:bg-blue-900">기존 이관 기록 열기</button>
          </div>
        )}
        {issueCodes.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
            {[...new Set(issueCodes)].map((code) => { const item = excelImportIssueDisplay(code); return <li key={code}><strong>{item.title}</strong> — {item.reason}<details><summary className="cursor-pointer text-xs">개발 정보</summary><code>{code}</code></details></li>; })}
          </ul>
        )}
      </section>

      {notice === "reused" && <p role="status" className="rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">동일한 파일의 기존 Preview를 재사용했습니다.</p>}
      {notice === "created" && <p role="status" className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">새 Preview를 저장했습니다.</p>}
      {notice === "reset" && <p role="status" className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">확인 후 만료된 Preview를 다시 분석했습니다.</p>}
      {notice === "refresh" && <p role="status" className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">확인 후 새 검토 정책으로 Preview를 다시 분석했습니다.</p>}
      {previewError && <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{previewError}</p>}

      {preview && (
        <section className="flex flex-col gap-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{preview.batch.fileName}</h2>
                <p className="text-sm text-zinc-500">시트: {preview.batch.sourceSheet}</p>
              </div>
              <ExcelImportPreviewFilterCards selected={preview.filter} counts={preview.batch.counts} onSelect={selectPreviewFilter} />
            </div>
            <p className="mt-3 text-xs text-zinc-500">파일 내 중복 인수번호 {preview.batch.counts.intakeDuplicateInBatch}행 · 기존 DB 중복 {preview.batch.counts.intakeDuplicateInDatabase}행 · 과거 상태 자동 적용 {preview.batch.counts.legacyStatusApplied}행 · 상태 미적용 {preview.batch.counts.legacyStatusNotApplied}행</p>
          </div>

          <ExcelImportExecutionPanel batch={preview.batch} />

          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">{EXCEL_IMPORT_PREVIEW_FILTER_LABELS[preview.filter]}</h2>
            <span className="text-sm text-zinc-500">총 {preview.pagination.totalItems}건</span>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            {preview.rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-zinc-500">해당하는 항목이 없습니다</p>
            ) : preview.rows.map((row) => {
              const billingLabel = row.candidate.billingType ? { PAID: "유상", PARTIAL_PAID: "일부유상", WARRANTY: "무상", PENDING_DECISION: "추후결정" }[row.candidate.billingType] : "—";
              const stateApplication = row.legacyState.apply ? "자동 적용" : row.candidate.legacyDisposition ? "최초 단계 유지" : "—";
              return (
                <article key={row.sourceRowNumber} className="border-b border-zinc-200 px-4 py-3 last:border-0 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-mono text-xs text-zinc-500">Excel {row.sourceRowNumber}행</span>
                    <ClassificationBadge value={row.classification} />
                    <span><span className="text-xs text-zinc-500">보고서번호</span> {display(row.candidate.legacyReportNumber ?? null)}</span>
                    <strong>{display(row.candidate.intakeNumber)}</strong>
                    <span>{display(row.candidate.customerName)} / {display(row.candidate.endUserName)}</span>
                    <span>{display(row.candidate.productName)} / {display(row.candidate.modelName)} / {billingLabel}</span>
                    <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">{businessColorLabel(row.candidate.legacyBusinessColor)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                    <span>인수일 {display(row.candidate.receivedDate)}</span>
                    <span>L/N {display(row.candidate.lotNumber)} · S/N {display(row.candidate.serialNumber)}</span>
                    <span>담당자 {display(row.rawValues.X ?? null)}</span>
                    <span>출하일 {display(row.candidate.actualShipmentDate ?? null)}</span>
                    <span>상태 적용 {stateApplication}</span>
                    <span>고장 증상 {compactText(row.rawValues.S)}</span>
                    <span>비고 {compactText(row.candidate.legacyNotes)}</span>
                  </div>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">상세 보기</summary>
                    <div className="mt-3 space-y-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div><dt className="text-xs text-zinc-500">고장 증상 전체</dt><dd className="whitespace-pre-wrap break-words">{display(row.rawValues.S ?? null)}</dd></div>
                        <div><dt className="text-xs text-zinc-500">U열 비고 전체</dt><dd className="whitespace-pre-wrap break-words">{display(row.candidate.legacyNotes ?? null)}</dd></div>
                        <div><dt className="text-xs text-zinc-500">상태 후보</dt><dd>{row.candidate.status ? STATUS_LABELS[row.candidate.status] : "—"}</dd></div>
                        <div><dt className="text-xs text-zinc-500">적용 단계·출하일</dt><dd>{row.legacyState.targetStepKey ?? "최초 단계"} / {display(row.candidate.actualShipmentDate ?? null)}</dd></div>
                        <div><dt className="text-xs text-zinc-500">Customer 계획</dt><dd>{row.plan.customer ?? "—"}</dd></div>
                        <div><dt className="text-xs text-zinc-500">End-User 계획</dt><dd>{row.plan.endUser ?? "—"}</dd></div>
                        <div><dt className="text-xs text-zinc-500">Product Model 계획</dt><dd>{row.plan.productModel ?? "—"}</dd></div>
                        <div><dt className="text-xs text-zinc-500">Product 계획</dt><dd>{row.plan.product ?? "—"}</dd></div>
                      </dl>
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">원본 A:Y</h3>
                        <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                          {Object.keys(RAW_COLUMN_LABELS).map((column) => <div key={column}><dt className="inline text-xs font-medium text-zinc-500">{column} · {RAW_COLUMN_LABELS[column]}: </dt><dd className="inline whitespace-pre-wrap break-all text-xs">{display(row.rawValues[column] ?? null)}</dd></div>)}
                        </dl>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">검토·안내</h3>
                        {row.reviewItems.length === 0 ? <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{excelImportPreviewClassificationReason(row.classification)}</p> : <ul className="mt-2 space-y-3">{row.reviewItems.map((item) => <li key={`${item.kind}-${item.code}`} className="rounded border border-zinc-200 p-2 dark:border-zinc-700"><div className="flex items-center gap-2"><strong>{item.title}</strong><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800">{item.kind}</span></div>{item.sources.length > 0 && <dl className="mt-1 space-y-1 text-xs">{item.sources.map((source) => <div key={source.cellAddress}><dt className="inline font-medium">원본 {source.label} ({source.cellAddress}): </dt><dd className="inline break-all">{display(source.value)}</dd></div>)}</dl>}<p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400"><strong>이유:</strong> {item.reason}</p><p className="text-xs text-zinc-600 dark:text-zinc-400"><strong>다음 조치:</strong> {item.action}</p><details className="mt-1 text-xs text-zinc-500"><summary className="cursor-pointer">개발 정보</summary><code>{item.code}</code></details></li>)}</ul>}
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>

          <nav aria-label="Preview 페이지" className="flex items-center justify-center gap-3 text-sm">
            {preview.pagination.page > 1 ? <Link className="rounded border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" href={buildExcelImportPreviewHref({ batchId: preview.batch.id, filter: preview.filter, page: preview.pagination.page - 1 })}>이전</Link> : <span className="rounded border border-zinc-200 px-3 py-1.5 text-zinc-400 dark:border-zinc-800">이전</span>}
            <span>{preview.pagination.page} / {preview.pagination.totalPages}</span>
            {preview.pagination.page < preview.pagination.totalPages ? <Link className="rounded border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" href={buildExcelImportPreviewHref({ batchId: preview.batch.id, filter: preview.filter, page: preview.pagination.page + 1 })}>다음</Link> : <span className="rounded border border-zinc-200 px-3 py-1.5 text-zinc-400 dark:border-zinc-800">다음</span>}
          </nav>
        </section>
      )}

      <aside className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
        <strong>{preview && ["IMPORTING", "PARTIAL_SUCCESS", "COMPLETED"].includes(preview.batch.status) ? "과거 상태 적용 결과를 각 행에서 확인하세요." : "실행 버튼을 누르기 전에는 실제 수리 건이나 마스터가 생성되지 않습니다."}</strong> Excel의 A:Y 원문과 색상 근거는 추적을 위해 Preview에 보존됩니다.
      </aside>
    </div>
  );
}
