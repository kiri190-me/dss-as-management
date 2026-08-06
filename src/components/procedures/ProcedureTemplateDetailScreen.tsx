"use client";

import Link from "next/link";
import ProcedureFlowGraph from "./ProcedureFlowGraph";
import ProcedureChecklistViewer from "./ProcedureChecklistViewer";
import ProcedureTroubleshootingViewer from "./ProcedureTroubleshootingViewer";
import ProcedureReferenceItemsViewer from "./ProcedureReferenceItemsViewer";
import ProcedureValidationIssuePanel from "./ProcedureValidationIssuePanel";
import {
  procedureEquipmentTypeLabels,
  procedureTemplateSourceTypeLabels,
  procedureTemplateStatusLabels,
} from "@/lib/domain/procedure-template-types";
import type { ProcedureTemplateDetail } from "@/lib/db/queries/procedure-templates";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Read-only template detail — no editing anywhere on this screen (Phase 2
 * scope). Renders whichever of the three imported content shapes the
 * template actually has: a shape-graph (edges present), a checklist
 * (checklistSections present), and/or a troubleshooting matrix
 * (troubleshootingEntries present) — a future combined template could in
 * principle carry more than one, so these are independent, not
 * mutually-exclusive branches.
 */
export default function ProcedureTemplateDetailScreen({
  template,
  canManageValidation,
}: {
  template: ProcedureTemplateDetail;
  canManageValidation: boolean;
}) {
  const hasGraph = template.edges.length > 0 || template.nodes.some((n) => n.nodeType !== "CHECKLIST" && n.nodeType !== "TROUBLESHOOTING");
  const hasChecklist = template.checklistSections.length > 0;
  const hasTroubleshooting = template.troubleshootingEntries.length > 0;
  const hasReferenceItems = template.referenceItems.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{template.name}</h1>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[template.status]}`}>
            {procedureTemplateStatusLabels[template.status]}
          </span>
          <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            v{template.version}
          </span>
          {template.isReferenceOnly && (
            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              참고용 — 실행 불가
            </span>
          )}
          </div>
          {canManageValidation && !template.isReferenceOnly && (
            <Link
              href={`/procedures/${template.id}/validation`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              검증 문제 검토
            </Link>
          )}
        </div>
        <p className="mt-1 font-mono text-xs text-zinc-400 dark:text-zinc-600">{template.code}</p>
        {template.description && (
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{template.description}</p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">설비 유형</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{procedureEquipmentTypeLabels[template.equipmentType]}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">원본 유형</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{procedureTemplateSourceTypeLabels[template.sourceType]}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">원본 파일</dt>
            <dd className="mt-0.5 truncate text-zinc-700 dark:text-zinc-300" title={template.sourceFileName ?? undefined}>
              {template.sourceFileName ?? "-"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">작성자</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{template.createdByName}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">생성일</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{formatDate(template.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-zinc-400 dark:text-zinc-600">게시자 / 게시일</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
              {template.publishedByName ? `${template.publishedByName} · ${formatDate(template.publishedAt)}` : "-"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-zinc-400 dark:text-zinc-600">노드 / 분기 수</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
              노드 {template.nodes.length}개 · 분기 {template.edges.length}개 · 체크리스트 항목{" "}
              {template.checklistSections.reduce((sum, s) => sum + s.items.length, 0)}개 · 고장 진단 항목{" "}
              {template.troubleshootingEntries.length}개 · 참고 항목 {template.referenceItems.length}개
            </dd>
          </div>
        </dl>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">검증 이슈</h2>
        <ProcedureValidationIssuePanel issues={template.validationIssues} />
      </section>

      {hasGraph && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">플로우차트</h2>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            읽기 전용 — 마우스 휠로 확대/축소, 드래그로 이동할 수 있습니다. 화살표 색상은 분기 유형을 나타냅니다
            (빨강=NG, 파랑=YES, 초록=정상, 보라 점선=재진행).
          </p>
          <ProcedureFlowGraph nodes={template.nodes} edges={template.edges} />
        </section>
      )}

      {hasChecklist && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">체크리스트</h2>
          <ProcedureChecklistViewer sections={template.checklistSections} />
        </section>
      )}

      {hasTroubleshooting && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">고장 증상별 진단표</h2>
          <ProcedureTroubleshootingViewer entries={template.troubleshootingEntries} />
        </section>
      )}

      {hasReferenceItems && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">참고 항목</h2>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            이 템플릿은 참고용 인덱스로, 실행 가능한 절차 노드를 포함하지 않습니다. 원본 워크북의 이동 링크·외부
            파일 경로·교차 참조 번호를 그대로 보존한 목록입니다.
          </p>
          <ProcedureReferenceItemsViewer items={template.referenceItems} />
        </section>
      )}
    </div>
  );
}
