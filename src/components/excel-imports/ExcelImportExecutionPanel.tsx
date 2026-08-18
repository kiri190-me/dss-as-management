"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExcelImportPreviewPage } from "@/lib/db/queries/excel-import-preview";
import { confirmExcelImportExecutionAction, runExcelImportChunkAction } from "@/lib/server/actions/excel-import-preview";

const ERRORS: Record<string, string> = {
  FORBIDDEN: "Excel 이관 권한이 없습니다.", NOT_FOUND: "Preview를 찾을 수 없습니다.",
  STALE_BATCH_VERSION: "다른 요청이 먼저 처리되었습니다. 최신 상태를 다시 불러옵니다.",
  BATCH_NOT_CONFIRMABLE: "현재 상태에서는 이관을 시작할 수 없습니다.", BATCH_NOT_RESUMABLE: "현재 상태에서는 이관을 이어서 실행할 수 없습니다.",
  PARSER_VERSION_NOT_SUPPORTED: "최신 정책으로 다시 분석한 Preview만 이관할 수 있습니다.",
  CONCURRENT_EXECUTION: "같은 파일의 이관이 이미 실행 중입니다.", NO_EXECUTABLE_ROWS: "접수 가능한 행이 없습니다.",
  EXECUTION_DATABASE_NOT_READY: "필수 데이터베이스 변경이 적용되지 않아 재시도할 수 없습니다. 관리자에게 문의해 주세요.",
  RETRY_CONDITION_UNRESOLVED: "실패 원인이 아직 해결되지 않았습니다. 행별 오류를 확인한 뒤 다시 시도해 주세요.",
  DATABASE_UNAVAILABLE: "일시적으로 처리할 수 없습니다. 다시 시도해 주세요.",
};

export default function ExcelImportExecutionPanel({ batch }: { batch: ExcelImportPreviewPage["batch"] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function runChunks(version: number, retryFailed = false) {
    try {
      let currentVersion = version;
      let totalSucceeded = 0;
      let totalFailed = 0;
      for (;;) {
        const result = await runExcelImportChunkAction({ batchId: batch.id, expectedBatchVersion: currentVersion, retryFailed });
        if (!result.ok) { setError(ERRORS[result.code] ?? "이관을 계속할 수 없습니다."); break; }
        currentVersion = result.version; totalSucceeded += result.succeeded; totalFailed += result.failed;
        setProgress(`이번 실행 성공 ${totalSucceeded}건 · 실패 ${totalFailed}건 · 남은 행 ${result.remaining}건`);
        if (result.completed || result.processed === 0) break;
        retryFailed = false;
      }
    } catch {
      setError("서버와 통신하지 못했습니다. 처리 상태를 새로고침한 뒤 다시 확인해 주세요.");
    } finally {
      router.refresh();
    }
  }

  function confirmAndRun() {
    setError(null); setProgress("이관을 준비하고 있습니다.");
    startTransition(async () => {
      const result = await confirmExcelImportExecutionAction({ batchId: batch.id, expectedBatchVersion: batch.version });
      if (!result.ok) { setError(ERRORS[result.code] ?? "이관을 시작할 수 없습니다."); router.refresh(); return; }
      await runChunks(result.version);
    });
  }

  function resume(retryFailed = false) {
    setError(null); setProgress(retryFailed ? "실패한 행을 다시 처리하고 있습니다." : "미완료 행부터 이어서 처리하고 있습니다.");
    startTransition(() => runChunks(batch.version, retryFailed));
  }

  const canConfirm = ["PREVIEWED", "REVIEW_REQUIRED", "READY"].includes(batch.status) && batch.counts.executable > 0;
  return <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 className="font-semibold">최종 이관 확인</h2>
    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">개별 마스터 연결 없이 기존 신규 접수 규칙으로 각 행을 독립 처리합니다.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {(["customer", "endUser", "productModel", "product"] as const).map((type) => <div key={type} className="rounded bg-zinc-50 p-3 text-sm dark:bg-zinc-950"><strong>{type === "customer" ? "고객사" : type === "endUser" ? "End-User" : type === "productModel" ? "Product Model" : "Product"}</strong><p className="mt-1 text-xs text-zinc-500">기존 재사용 {batch.entities[type].reuse} · 신규 생성 {batch.entities[type].create}</p></div>)}
    </div>
    <p className="mt-3 text-sm">담당자 자동 연결 {batch.counts.assigneeLinked}건 · 미배정 {batch.counts.assigneeUnassigned}건</p>
    <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"><strong>과거 상태 자동 적용 대상 행은 해당 단계로 생성됩니다.</strong> 적용 대상이 아닌 행은 현재 workflow의 최초 접수 단계로 생성되며, M:Y 원문은 후속 상태 확인을 위해 Preview에 남습니다.</div>
    {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {progress && <p role="status" className="mt-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">{progress}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      {canConfirm && <button type="button" disabled={pending} onClick={confirmAndRun} className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "처리 중…" : `접수 ${batch.counts.executable}건 이관 실행`}</button>}
      {batch.status === "IMPORTING" && <button type="button" disabled={pending} onClick={() => resume(false)} className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">미완료 행부터 계속</button>}
      {(batch.status === "PARTIAL_SUCCESS" || batch.status === "FAILED") && batch.counts.failed > 0 && <button type="button" disabled={pending} onClick={() => resume(true)} className="rounded border border-blue-500 px-4 py-2 text-sm font-medium text-blue-700 disabled:opacity-50 dark:text-blue-300">실패 행 재시도</button>}
    </div>
    {(batch.status === "COMPLETED" || batch.status === "PARTIAL_SUCCESS") && <p className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-200">접수 처리가 끝났습니다. 과거 상태 자동 적용 결과는 각 행에서 확인할 수 있습니다.</p>}
  </section>;
}
