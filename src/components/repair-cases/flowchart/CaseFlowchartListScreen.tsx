"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createRepairCaseFlowchartAction } from "@/lib/server/actions/repair-case-flowcharts";
import type { RepairCaseFlowchartRow } from "@/lib/db/queries/repair-case-flowcharts";

/**
 * Minimal case-flowchart list/create screen (Phase 5C-6D) — the smallest
 * access point needed to manually create and open a flowchart for testing
 * the 6D graph editor. Deliberately NOT the polished "진단 Flowchart"
 * Repair Case tab described for a later checkpoint (no DetailTabs nav
 * entry added here) — this is a direct, unlinked route for development/
 * manual verification, per the 6D plan's own §12.
 *
 * 목록 맨 위의 「작업 기록 흐름도」 줄은 저장된 흐름도가 아니다 — 작업 기록에서
 * 열 때마다 그려지는 보기 전용 화면으로 가는 링크일 뿐이다(만드는 단추가 없고,
 * 사용자가 아무것도 누르지 않아도 그릴 것이 있으면 거기 있다). 지어낸 것을 진짜
 * 흐름도처럼 보이게 하지 않으려고 「자동」 표와 점선 테두리로 구분하고, 저장되지
 * 않는다는 사실을 그 자리에서 적어 둔다. 그릴 것이 있는지(hasWorkRecordFlowchart)
 * 는 이 조각이 판단하지 않는다 — "use client" 라 DB 를 읽을 수 없으므로 서버
 * 페이지가 정해 내려보낸다.
 */
export default function CaseFlowchartListScreen({
  repairCaseId,
  flowcharts,
  canEdit,
  hasWorkRecordFlowchart,
}: {
  repairCaseId: string;
  flowcharts: RepairCaseFlowchartRow[];
  canEdit: boolean;
  /** 무효 처리되지 않은 작업 기록이 하나라도 있어 실제로 그릴 것이 있는가 — 서버 페이지가 계산한다. */
  hasWorkRecordFlowchart: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCreate() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createRepairCaseFlowchartAction({ repairCaseId, title, description: description.trim() || null });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    router.push(`/repair-cases/${repairCaseId}/diagnosis/${result.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">진단 Flowchart</h2>

      {(hasWorkRecordFlowchart || flowcharts.length > 0) && (
        <ul className="flex flex-col gap-2">
          {hasWorkRecordFlowchart && (
            <li className="rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/repair-cases/${repairCaseId}/diagnosis/work-records`}
                  className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-400"
                >
                  작업 기록 흐름도
                </Link>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">자동</span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">작업 기록에서 자동으로 그립니다. 저장되지 않고, 고칠 수 없습니다.</p>
            </li>
          )}
          {flowcharts.map((f) => (
            <li key={f.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <Link href={`/repair-cases/${repairCaseId}/diagnosis/${f.id}`} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-400">
                {f.title}
              </Link>
              {f.description && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{f.description}</p>}
              <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-600">
                {f.updatedByName} · {new Date(f.updatedAt).toLocaleString("ko-KR")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {/* 「자동」 줄은 저장된 흐름도가 아니므로, 그 줄이 보이는 중에도 이 문장은 그대로 사실이다. */}
      {flowcharts.length === 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">아직 등록된 Flowchart가 없습니다.</p>}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">새 Flowchart 만들기</h3>
          <label className="flex flex-col gap-1">
            제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="flex flex-col gap-1">
            설명 (선택)
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <button
            type="button"
            disabled={title.trim().length === 0 || isSubmitting}
            onClick={() => void handleCreate()}
            className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {isSubmitting ? "생성 중..." : "Flowchart 생성"}
          </button>
          {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
        </div>
      )}
    </div>
  );
}
