"use client";

import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import {
  canOpenCaseFlowchartNodeShareDoc,
  caseFlowchartNodeShareDocFileName,
  caseFlowchartNodeShareDocParentPath,
} from "@/components/repair-cases/flowchart/CaseFlowchartNodeShareDocPicker";

/**
 * ============================================================================
 * 실행 화면에서 **그 단계에 매달린 파일 한 줄** (2026-11-25)
 * ============================================================================
 * 「[기술작업절차]에서 노드에 연결해 둔 파일은 [수리건 상세]의 [작업내용]에서
 * [기술 절차 불러오기]로 사용할 때, 해당 노드의 단계에서 연결된 파일을 열어볼 수
 * 있도록 할꺼야」(사용자 요구 2026-11-25).
 *
 * ── 🔴 **읽기 전용이다. 여기에는 고르기도 지우기도 없다** ────────────────
 * 사용자가 그날 명시적으로 뺐다 — 「[수리건 상세]쪽에서 파일을 고르는 기능은 하지
 * 말자」. 가리킴을 **정하는 자리는 절차 편집기 하나**이고(절차가 바뀌면 그 절차를
 * 쓰는 모든 건에 같이 비쳐야 한다), 여기는 **쓰는 자리**다. 그래서 이 조각에는
 * `onPick` 도 `onClear` 도 **프롭 자체가 없다** — 나중에 「진단 Flowchart 쪽과
 * 맞추자」며 붙이려면 타입부터 고쳐야 하고, 그러면 사람 눈에 띈다.
 * 🔵 이 사실은 시험이 값으로도 지킨다(execution-node-share-doc.test.tsx).
 *
 * ── 🔴 도우미 주소를 **여기서 짓지 않는다** ──────────────────────────────
 * 여는 일은 연락서 쪽 단추를 **그대로 가져다 쓴다**(ContactFolderEntryOpenButton) —
 * `dss-folder://` 주소를 만드는 셈도, Windows 가 아닌 PC 에서 스스로 사라지는 것도
 * 그 안에 있다. 경로를 폴더/이름으로 쪼개는 셈도 **고르는 쪽과 같은 한 벌**을 쓴다
 * (CaseFlowchartNodeShareDocPicker) — 제 손으로 쪼개면 「절차 편집에서 고를 때는
 * 됐는데 작업할 때는 안 열리는」 경로가 생기고, 그 어긋남은 오류를 한 번도 안 낸다.
 *
 * ── 🔴 열 수 없는 모양이면 **단추만 없고 경로는 그대로 보인다** ──────────
 * 절차 편집기·진단 Flowchart 와 같은 규율이다. 손으로 고친 DB · 규칙이 바뀌기 전에
 * 담긴 옛 줄은 못 열 수 있는데, 그때 줄을 통째로 감추면 사람은 「매단 적이 없다」로
 * 읽고 절차 편집에서 고칠 자리를 영영 못 찾는다.
 *
 * ── 🔵 세 자리가 **이 한 벌**을 쓴다 ─────────────────────────────────────
 * 「지금 할 일」 큰 카드(CurrentTaskCard) · 작은 노드 카드(ExecutionNodeCard) ·
 * 화면의 「참고 문서」 구역(ProcedureExecutionScreen). 마지막이 필요한 까닭은
 * 참고 문서 노드에 **실행 행이 아예 안 생기기** 때문이다(isExecutableNodeType 에서
 * 빠져 있다) — 카드에만 세우면 「파일 매달기에 가장 자연스러운 노드」에 매단 것이
 * 작업할 때 한 번도 안 보인다.
 *
 * 🔴 화면 글자 크기만 부르는 쪽이 고를 수 있게 뒀다(`size`). 큰 카드의 본문은
 * `text-sm` 이고 작은 카드·참고 문서 줄은 `text-xs` 라, 한 크기로 못 박으면 한쪽에서
 * 이 줄만 혼자 커지거나 작아진다.
 *
 * 서버 액션을 부르지 않는다 — `server-only` 사슬 없이 그려 볼 수 있다.
 * ============================================================================
 */

/** 이 줄이 무엇인지 — 🔴 절차 편집기의 구역 이름과 **같은 말**이다(「관련 파일」). */
export const EXECUTION_NODE_SHARE_DOC_LABEL = "관련 파일";

/**
 * 🔴 **인쇄에는 경로가 남는다.** 바깥 틀에 `print:hidden` 을 걸지 않는다 — 종이로
 * 들고 다니는 사람에게 「어느 파일을 보라」는 글자는 그대로 쓸모가 있다. 사라지는 것은
 * 누를 수 없는 [열기] 단추뿐이고, 그것은 그 단추가 제 안에서 숨는다.
 */
export default function ExecutionNodeShareDocRow({
  relativePath,
  size = "SM",
}: {
  /** 🔴 null 이면 **아무것도 그리지 않는다** — 빈 줄도 「없음」 글자도 두지 않는다. */
  relativePath: string | null;
  /** 글자 크기만 고른다. 큰 카드는 MD, 작은 카드·참고 문서 줄은 SM. */
  size?: "SM" | "MD";
}) {
  if (relativePath === null || relativePath === "") return null;
  const openable = canOpenCaseFlowchartNodeShareDoc(relativePath);
  const textClass = size === "MD" ? "text-sm" : "text-xs";
  return (
    <div
      data-execution-node-share-doc=""
      className="mt-2 flex flex-wrap items-start gap-x-2 gap-y-1"
    >
      <span className={`shrink-0 font-medium text-zinc-500 dark:text-zinc-400 ${textClass}`}>
        {EXECUTION_NODE_SHARE_DOC_LABEL}
      </span>
      {/*
        🔴 **`break-all` 이 아니다.** `break-all` 은 한글을 어절 가운데서 늘 끊어
        「디 / 에 / 스」처럼 한 글자씩 세로로 떨어뜨린다(2026-11-25 에 속성 패널이
        실제로 그렇게 깨졌다). `break-keep` 이 어절을 지키고, `wrap-anywhere` 가
        한 덩어리가 줄보다 길 때만 끊어 칸 밖으로 삐져나가는 것을 막는다 —
        고르는 창의 이름 칸·속성 패널의 경로 줄과 **같은 한 벌**이다.
      */}
      <span className={`min-w-0 flex-1 break-keep wrap-anywhere text-zinc-600 dark:text-zinc-400 ${textClass}`}>
        {relativePath}
      </span>
      {openable && (
        <ContactFolderEntryOpenButton
          folderName={caseFlowchartNodeShareDocParentPath(relativePath)}
          fileName={caseFlowchartNodeShareDocFileName(relativePath)}
        />
      )}
    </div>
  );
}
