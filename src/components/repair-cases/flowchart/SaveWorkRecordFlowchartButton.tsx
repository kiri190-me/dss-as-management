"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createWorkRecordFlowchartSnapshotAction } from "@/lib/server/actions/repair-case-flowcharts";

/**
 * 「작업 기록 흐름도」 화면(보기 전용 서버 컴포넌트)에 얹는 얇은 단추 하나.
 *
 * 조각이 서버로 넘기는 것은 접수 건 id 와 **화면에 그려져 있던 작업 기록 id
 * 목록뿐이다** — 칸 제목도 분류도 위치도 넘기지 않는다. 내용은 서버가 DB 에서
 * 다시 읽어 다시 그리고, 그 결과가 이 목록과 같을 때만 저장한다(까닭은
 * work-record-flowchart.ts 의 workRecordFlowchartMatchesSeenRecords 머리말).
 * 그래서 이 조각이 무엇을 보내든 저장되는 내용을 바꿀 수 없고, 어긋나면
 * 「그 사이에 작업 기록이 바뀌었습니다」라는 답이 돌아온다.
 *
 * 보일지 말지는 이 조각이 정하지 않는다 — 서버 페이지가 진단 Flowchart 목록과
 * **같은 방식으로** canEdit 을 셈해 넘겨주고, 그마저도 UX 힌트일 뿐이다(진짜
 * 판정은 mutation 이 접수 건 행을 잠근 채 다시 한다).
 *
 * 누르는 동안 잠근다. 두 번 눌리면 같은 흐름도가 두 장 만들어지고, 그것은
 * 사람이 하나를 골라 지워야 하는 뒷정리가 된다.
 */
export default function SaveWorkRecordFlowchartButton({
  repairCaseId,
  workRecordIds,
}: {
  repairCaseId: string;
  /** 화면에 그려진 작업 기록 id 목록 — 그려진 차례 그대로. */
  workRecordIds: string[];
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSave() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await createWorkRecordFlowchartSnapshotAction({ repairCaseId, seenWorkRecordIds: workRecordIds });
      if (!result.ok) {
        setErrorMessage(result.message);
        setIsSubmitting(false);
        return;
      }
      // 성공하면 곧바로 편집 화면으로 — 목록 화면이 새 흐름도를 만든 뒤 하는
      // 그대로다. 넘어가는 중에는 단추를 다시 열지 않는다(같은 저장이 한 번 더
      // 일어날 틈을 만들지 않는다).
      router.push(`/repair-cases/${repairCaseId}/diagnosis/${result.flowchartId}`);
    } catch {
      setErrorMessage("일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void handleSave()}
          className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? "저장 중..." : "이대로 흐름도로 저장"}
        </button>
        <p className="text-xs text-blue-900 dark:text-blue-300">
          지금 보이는 이 모습 그대로 흐름도 한 장을 만듭니다. 만든 뒤에는 작업 기록이 늘어도 바뀌지 않으며, 손으로 고칠 수 있습니다.
        </p>
      </div>
      {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}
