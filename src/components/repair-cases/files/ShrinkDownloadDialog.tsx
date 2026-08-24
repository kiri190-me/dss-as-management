"use client";

import { useMemo, useState } from "react";
import {
  SHRINK_RATIO_PRESETS,
  estimateTotalBytes,
  formatBytes,
  parseTargetBytes,
  ratioLabel,
  resolveTargetBytes,
  shrunkFileName,
  type ShrinkTarget,
} from "@/lib/domain/image-shrink";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";
import { fetchAttachmentBlob, saveBlobAs, shrinkImageBlob } from "./shrink-image";
import { createStoredZip, uniqueEntryNames } from "./zip-store";

/**
 * ============================================================================
 * 줄여서 내려받기
 * ============================================================================
 * 원본은 손대지 않는다. 서버에 있는 파일은 그대로이고, **내려받는 순간에만**
 * 브라우저가 줄여서 저장한다. 그래서 몇 번을 줄여 받아도 원본이 상하지 않는다.
 *
 * ── 예상 용량은 예상이다 ─────────────────────────────────────────────────
 * 고르자마자 보여 주는 값은 계산값이고, 실제로 인코딩해 보기 전이다. JPEG는
 * 품질과 크기의 관계가 사진마다 달라서(하늘 사진은 잘 안 줄고 회로 기판은 급히
 * 준다) 정확한 예측이 불가능하다. 대신 목표를 **넘지 않도록** 맞추므로 실제
 * 결과는 예상보다 작거나 같다. 끝나면 실제 크기를 다시 알려 준다.
 * ============================================================================
 */

type ShrinkDownloadDialogProps = {
  /** 줄일 수 있는 사진들만 온다(JPG·PNG). 부르는 쪽이 걸러 넘긴다. */
  items: RepairCaseAttachmentListItem[];
  onClose: () => void;
};

type Progress = { current: number; total: number };
type Outcome = { savedCount: number; totalBytes: number; missedTarget: number };

export default function ShrinkDownloadDialog({ items, onClose }: ShrinkDownloadDialogProps) {
  const [mode, setMode] = useState<"ratio" | "bytes">("ratio");
  const [ratio, setRatio] = useState(0.5);
  const [amount, setAmount] = useState("500");
  const [unit, setUnit] = useState<"KB" | "MB">("KB");

  const [progress, setProgress] = useState<Progress | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const originalSizes = useMemo(() => items.map((item) => item.fileSize), [items]);
  const originalTotal = useMemo(
    () => originalSizes.reduce((sum, size) => sum + size, 0),
    [originalSizes]
  );

  const parsedBytes = parseTargetBytes(amount, unit);
  const target: ShrinkTarget | null =
    mode === "ratio" ? { kind: "ratio", ratio } : parsedBytes === null ? null : { kind: "bytes", bytes: parsedBytes };

  const estimated = target ? estimateTotalBytes(target, originalSizes) : null;
  const isBusy = progress !== null;

  async function run() {
    if (!target) return;
    setError(null);
    setOutcome(null);

    const label = target.kind === "ratio" ? ratioLabel(target.ratio) : `${amount}${unit}`;
    let savedCount = 0;
    let totalBytes = 0;
    let missedTarget = 0;

    try {
      // 줄인 것들을 모아 두었다가 한 번에 내보낸다. 한 장씩 내려받게 하면
      // 브라우저가 연속 내려받기를 막아 **첫 장만 받아지고 나머지는 조용히
      // 사라진다.** 여러 장이면 ZIP 하나로 묶어 한 번만 내려받는다.
      const shrunk: { name: string; blob: Blob }[] = [];

      for (const [index, item] of items.entries()) {
        setProgress({ current: index + 1, total: items.length });

        const source = await fetchAttachmentBlob(item.id);
        const targetBytes = resolveTargetBytes(target, item.fileSize);
        const result = await shrinkImageBlob(source, targetBytes);

        shrunk.push({ name: shrunkFileName(item.originalFileName, label), blob: result.blob });
        savedCount += 1;
        totalBytes += result.blob.size;
        if (!result.reachedTarget) missedTarget += 1;

        // 한 장을 마칠 때마다 화면에 숨 쉴 틈을 준다 — 안 그러면 진행 표시가
        // 멈춘 것처럼 보이고, 폰에서는 화면이 굳은 것으로 읽힌다.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }

      if (shrunk.length === 1) {
        saveBlobAs(shrunk[0].blob, shrunk[0].name);
      } else if (shrunk.length > 1) {
        const names = uniqueEntryNames(shrunk.map((entry) => entry.name));
        const entries = await Promise.all(
          shrunk.map(async (entry, index) => ({
            name: names[index],
            data: new Uint8Array(await entry.blob.arrayBuffer()),
          }))
        );
        saveBlobAs(createStoredZip(entries), `줄인사진_${entries.length}건.zip`);
      }

      setOutcome({ savedCount, totalBytes, missedTarget });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "사진을 줄이지 못했습니다.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="줄여서 내려받기"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-2xl sm:pb-5 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">줄여서 내려받기</h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              사진 {items.length}장 · 원본 합계 {formatBytes(originalTotal)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-zinc-500 disabled:opacity-50 dark:text-zinc-400"
          >
            ×
          </button>
        </div>

        <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          서버의 원본은 그대로 두고 <strong>내려받는 것만</strong> 줄입니다. 몇 번을 받아도 원본은 상하지 않습니다.
        </p>

        {/* 기준 고르기 */}
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {(["ratio", "bytes"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setMode(kind)}
              disabled={isBusy}
              aria-pressed={mode === kind}
              className={`flex-1 px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                mode === kind
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {kind === "ratio" ? "비율로" : "목표 용량으로"}
            </button>
          ))}
        </div>

        {mode === "ratio" ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-4 gap-2">
              {SHRINK_RATIO_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRatio(preset)}
                  disabled={isBusy}
                  aria-pressed={ratio === preset}
                  className={`rounded-md border px-2 py-2 text-sm font-medium disabled:opacity-50 ${
                    ratio === preset
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {Math.round(preset * 100)}%
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">직접 입력</span>
              <input
                type="range"
                min={10}
                max={95}
                step={5}
                value={Math.round(ratio * 100)}
                disabled={isBusy}
                onChange={(event) => setRatio(Number(event.target.value) / 100)}
                className="flex-1"
              />
              <span className="w-12 shrink-0 text-right tabular-nums">{Math.round(ratio * 100)}%</span>
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">한 장당</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              value={amount}
              disabled={isBusy}
              onChange={(event) => setAmount(event.target.value)}
              className="w-28 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
              {(["KB", "MB"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setUnit(value)}
                  disabled={isBusy}
                  aria-pressed={unit === value}
                  className={`px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                    unit === value
                      ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">이하</span>
          </div>
        )}

        {/* 예상 용량 */}
        <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {target === null ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              1보다 큰 숫자를 적어 주세요.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-900 dark:text-zinc-50">
                예상 용량 <strong>{formatBytes(estimated ?? 0)}</strong>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {" "}
                  (원본 {formatBytes(originalTotal)})
                </span>
              </p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                목표를 넘지 않게 맞추므로 실제 결과는 이보다 작거나 같습니다.
              </p>
            </>
          )}
        </div>

        {progress && (
          <p aria-live="polite" className="text-sm text-zinc-700 dark:text-zinc-300">
            줄이는 중… {progress.total}장 중 {progress.current}장째
          </p>
        )}

        {outcome && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
            <p>
              {outcome.savedCount}장을 받았습니다 · 실제 합계{" "}
              <strong>{formatBytes(outcome.totalBytes)}</strong>
            </p>
            {outcome.missedTarget > 0 && (
              <p className="mt-1 text-xs">
                그중 {outcome.missedTarget}장은 목표까지 줄지 않아 줄일 수 있는 만큼만 줄였습니다.
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            {outcome ? "닫기" : "취소"}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={isBusy || target === null || items.length === 0}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {isBusy ? "줄이는 중…" : "줄여서 내려받기"}
          </button>
        </div>
      </div>
    </div>
  );
}
