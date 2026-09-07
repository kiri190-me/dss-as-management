import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getWorkRecordHistoryForCase } from "@/lib/db/queries/repair-case-work-records";
import { getRepairCaseFlowchartPageContext } from "@/lib/db/queries/repair-case-flowcharts";
import { hasPermission, roleOnlyActor } from "@/lib/auth/permission-resolver";
import {
  buildWorkRecordFlowchart,
  listWorkRecordIdsInFlowchart,
  WORK_RECORD_FLOWCHART_MAX_RECORDS,
} from "@/lib/domain/work-record-flowchart";
import CaseFlowchartGraph from "@/components/repair-cases/flowchart/CaseFlowchartGraph";
import SaveWorkRecordFlowchartButton from "@/components/repair-cases/flowchart/SaveWorkRecordFlowchartButton";

export const metadata: Metadata = {
  title: "작업 기록 흐름도 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * 「작업 이력」의 작업 기록을 시간 순으로 그려 보여 주는 **보기 전용** 화면.
 * 편집·저장·드래그가 없고, repair_case_flowcharts/…_nodes/…_edges 에는
 * 아무것도 쓰지 않는다 — 열 때마다 그 시점의 기록으로 다시 그린다. 왜 저장하지
 * 않는지는 work-record-flowchart.ts 머리말 참조(요약: 저장해 두면 기록이 하나
 * 붙는 순간 낡은 것이 되고, 다시 만들 때 엔지니어가 손으로 고쳐 둔 흐름도를
 * 덮어쓴다).
 *
 * 확인 순서는 형제 페이지인 흐름도 목록(../page.tsx)과 같다: 저장 모드 →
 * 접수 건 → (없으면 notFound). **보기 문턱을 새로 만들지 않았다** — 목록
 * 페이지의 보기 문턱도 이 둘뿐이다. 흐름도 목록을 볼 수 있는 사람이면 이
 * 화면도 볼 수 있고, 그것이 목록의 「작업 기록 흐름도」 줄이 보이는 조건과
 * 정확히 같다.
 *
 * 「이대로 흐름도로 저장」 단추만은 만들 권한이 있는 사람에게만 보인다. 그
 * 판정(canEdit)은 목록 페이지가 "새 Flowchart 만들기" 폼을 여닫을 때 쓰는
 * 식을 **그대로** 가져다 쓴다 — readSession + 계정 승인 +
 * getRepairCaseFlowchartPageContext + diagnosisFlowcharts.edit(WRITE). 새
 * 문턱을 만들지 않는 이유는 간단하다: 이 단추가 하는 일은 결국 흐름도 한 장을
 * 만드는 것이고, 그것은 목록에서 손으로 만드는 것과 같은 일이다. 이것은 UX
 * 힌트일 뿐이고 진짜 판정은 mutation 이 접수 건 행을 잠근 채 다시 한다.
 *
 * 새 조회를 만들지 않고 작업 이력 탭이 쓰는 getWorkRecordHistoryForCase 를
 * 그대로 부른다. 그 조회는 최신순이라 상한(WORK_RECORD_FLOWCHART_MAX_RECORDS)
 * 에 걸리면 오래된 기록부터 빠지므로, 그런 건에서는 화면이 잘렸다고 밝힌다 —
 * 흐름도가 처음부터 시작하는 것처럼 보이면 안 된다.
 */
export default async function WorkRecordFlowchartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (getAuthSource() !== "database") {
    return <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">진단 Flowchart는 데이터베이스 저장 모드에서만 사용할 수 있습니다.</p>;
  }

  const resolved = await resolveRepairCaseForServer(id);
  if (!resolved) notFound();

  const { rows, total } = await getWorkRecordHistoryForCase(id, { limit: WORK_RECORD_FLOWCHART_MAX_RECORDS, offset: 0 });
  const { nodes, edges } = buildWorkRecordFlowchart(rows);
  const isTruncated = total > WORK_RECORD_FLOWCHART_MAX_RECORDS;

  const session = await readSession();
  const pageContext = await getRepairCaseFlowchartPageContext(id);
  const canEdit =
    !!session &&
    session.approvalStatus === "APPROVED" &&
    !!pageContext &&
    // 이 화면은 살아 있는 행위자(ActingUser)를 손에 들고 있지 않다 — 세션 토큰의
    // role/approvalStatus만 본다. 그래서 개발자 승격이 여기까지 닿지 않는다
    // (roleOnlyActor = 승격 없음). 닫히는 쪽으로 실패하는 선택이다: 개발자가
    // 이 단추를 못 볼 뿐, 남에게 권한이 새지는 않는다. 고치려면 세 화면을
    // resolveActingUserForSession 으로 옮겨야 하고, 그것은 이 조각의 범위가 아니다.
    (await hasPermission(roleOnlyActor(session.role), "diagnosisFlowcharts.edit", "WRITE"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">작업 기록 흐름도</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">자동</span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          작업 이력의 작업 기록을 시간 순으로 그린 것입니다. 저장되지 않으며, 기록이 늘면 다시 열 때 함께 반영됩니다. 무효 처리된 기록은 그리지 않습니다.
        </p>
        <Link href={`/repair-cases/${id}/diagnosis`} className="self-start text-xs text-blue-700 hover:underline dark:text-blue-400">
          ← 진단 Flowchart 목록으로
        </Link>
      </div>

      {isTruncated && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          작업 기록이 {total}건이라 최근 {WORK_RECORD_FLOWCHART_MAX_RECORDS}건만 그렸습니다. 그보다 오래된 기록은 이 그림에 없습니다.
        </p>
      )}

      {nodes.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          그릴 작업 기록이 없습니다. 작업 이력 탭에 기록을 남기면 여기에 자동으로 그려집니다. (무효 처리된 기록만 있는 경우에도 그릴 것이 없습니다.){" "}
          <Link href={`/repair-cases/${id}/work-history`} className="text-blue-700 hover:underline dark:text-blue-400">
            작업 이력으로 가기
          </Link>
        </p>
      ) : (
        <>
          {/* 그릴 것이 없으면 단추도 없다 — 빈 흐름도를 저장할 이유가 없다. */}
          {canEdit && <SaveWorkRecordFlowchartButton repairCaseId={id} workRecordIds={listWorkRecordIdsInFlowchart(nodes)} />}
          <CaseFlowchartGraph nodes={nodes} edges={edges} editable={false} />
        </>
      )}
    </div>
  );
}
