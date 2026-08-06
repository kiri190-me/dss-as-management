import Link from "next/link";
import {
  procedureEquipmentTypeLabels,
  procedureTemplateStatusLabels,
} from "@/lib/domain/procedure-template-types";
import type { ProcedureTemplateListRow } from "@/lib/db/queries/procedure-templates";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { dateStyle: "medium" });
}

export default function ProcedureTemplateListScreen({ templates }: { templates: ProcedureTemplateListRow[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">기술 절차 템플릿</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Excel 수리소 업무 절차서로부터 가져온 상세 기술 절차 템플릿입니다. 읽기 전용 미리보기이며, 기존 A/S 접수 건
          워크플로우와는 별개의 계층입니다.
        </p>
      </div>

      {templates.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          표시할 템플릿이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">이름</th>
                <th className="px-3 py-2 font-medium">설비 유형</th>
                <th className="px-3 py-2 font-medium">버전</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">원본 워크시트</th>
                <th className="px-3 py-2 font-medium">노드 수</th>
                <th className="px-3 py-2 font-medium">체크리스트 항목</th>
                <th className="px-3 py-2 font-medium">검증 이슈</th>
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
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status]}`}>
                      {procedureTemplateStatusLabels[t.status]}
                    </span>
                    {t.isReferenceOnly && (
                      <span className="ml-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                        참고용
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 truncate max-w-[160px] text-zinc-600 dark:text-zinc-400" title={t.sourceFileName ?? undefined}>
                    {t.sourceWorksheetCount}개 시트
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{t.nodeCount}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{t.checklistItemCount}</td>
                  <td className="px-3 py-2">
                    {t.validationErrorCount > 0 && (
                      <span className="mr-1 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                        오류 {t.validationErrorCount}
                      </span>
                    )}
                    {t.validationWarningCount > 0 && (
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                        경고 {t.validationWarningCount}
                      </span>
                    )}
                    {t.validationErrorCount === 0 && t.validationWarningCount === 0 && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-600">-</span>
                    )}
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
