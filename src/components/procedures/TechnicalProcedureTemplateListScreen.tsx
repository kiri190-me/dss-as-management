"use client";

import { useState } from "react";
import Link from "next/link";
import { procedureEquipmentTypeLabels, procedureTemplateStatusLabels } from "@/lib/domain/procedure-template-types";
import type { TechnicalProcedureTemplateListRow } from "@/lib/db/queries/procedure-templates";
import CreateTechnicalTemplateForm from "./editor/CreateTechnicalTemplateForm";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { dateStyle: "medium" });
}

/**
 * Phase 5C-5B — the TECHNICAL_TASK library, deliberately a separate screen
 * from ProcedureTemplateListScreen (which lists every category together,
 * unchanged) rather than a category filter bolted onto it: this list's
 * permission model (ADMIN/SUPER_ADMIN manage, AS_ENGINEER published-only,
 * SALES/INVENTORY_MANAGER no access) and its own create-DRAFT entry point
 * are specific to this category and must never affect the existing
 * FULL_SERVICE/REFERENCE list's behavior.
 */
export default function TechnicalProcedureTemplateListScreen({
  templates,
  canCreate,
}: {
  templates: TechnicalProcedureTemplateListRow[];
  canCreate: boolean;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">기술 작업 절차</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            증상/작업 단위의 개별 기술 절차입니다. 종합 수리 절차(기술 절차 템플릿)와는 별개의 목록입니다.
          </p>
        </div>
        {canCreate && !showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
          >
            새 기술 절차 만들기
          </button>
        )}
      </div>

      {canCreate && showCreateForm && <CreateTechnicalTemplateForm onClose={() => setShowCreateForm(false)} />}

      {templates.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          표시할 기술 절차가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">이름</th>
                <th className="px-3 py-2 font-medium">설비 유형</th>
                <th className="px-3 py-2 font-medium">버전</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">노드 / 분기 수</th>
                <th className="px-3 py-2 font-medium">생성 / 게시일</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                  <td className="px-3 py-2">
                    <Link href={`/procedures/${t.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
                      {t.name}
                    </Link>
                    <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{t.code}</div>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{procedureEquipmentTypeLabels[t.equipmentType]}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">v{t.version}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status]}`}>{procedureTemplateStatusLabels[t.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {t.nodeCount} / {t.edgeCount}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-500">
                    {formatDate(t.createdAt)} / {formatDate(t.publishedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
