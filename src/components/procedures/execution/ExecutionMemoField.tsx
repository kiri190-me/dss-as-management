"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import { updateExecutionNodeMemoAction } from "@/lib/server/actions/procedure-case-execution";
import {
  beginMemoEdit,
  cancelMemoEdit,
  memoFieldForNode,
  memoSavePayload,
  nextMemoFieldState,
  typeMemoDraft,
} from "@/lib/domain/procedure-execution-memo-field";
import ExecutionMemoFieldView, { type ExecutionMemoFieldSize } from "./ExecutionMemoFieldView";

/**
 * 작업 메모 칸 **한 벌**(2026-11-03, 조각 12). 쓰는 자리가 셋이다 — 「지금 할 일」
 * 큰 카드 · 「차단됨」의 작은 카드 · 「실행 이력」에서 끝난 작업의 마지막 줄.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 제 파일로 갈랐나
 * ──────────────────────────────────────────────────────────────────────
 * 전에는 두 카드가 **각자** 칸을 가지고 있었다(같은 모양의 useState 두 벌). 그
 * 두 벌이 이번 조각의 결함 둘을 함께 낳았다:
 *
 *  ① 노드를 옮겨도 앞 노드에 적던 글이 남았다 — 상태를 **처음 값으로만** 세워서다.
 *  ② 칸이 늘 열려 있어 아무 때나 고쳐졌다.
 *
 * 한 벌로 묶고, 둘을 고치는 규칙을 **값으로** 옮겼다
 * (procedure-execution-memo-field.ts) — 세 자리가 같은 함수를 쓰고, 시험이 그
 * 함수를 직접 잰다. 그리는 모습은 다시 ExecutionMemoFieldView 가 맡는다(그려서
 * 재려고 — 그쪽 머리말).
 *
 * 🔴 서버 통로는 **전과 같은 하나**다(updateExecutionNodeMemoAction). 통로가
 * 둘이면 권한·동시성 검사도 둘이 된다.
 */
export default function ExecutionMemoField({
  executionNodeId,
  executionNodeVersion,
  savedMemo,
  eligible,
  size,
}: {
  executionNodeId: string;
  /** 🔴 그 줄 **자신의** 낙관적 동시성 토큰. 한 벌을 돌려 쓰면 남의 줄을 건드린다. */
  executionNodeVersion: number;
  savedMemo: string | null;
  eligible: boolean;
  size?: ExecutionMemoFieldSize;
}) {
  const router = useRouter();
  const [field, setField] = useState(() => memoFieldForNode({ executionNodeId, savedMemo }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 🔴 **노드가 바뀌면 칸이 다시 선다.** React 는 같은 자리의 같은 부품을 다시
  // 쓰므로(새로 안 태어난다) useState 의 처음 값이 다시 읽히지 않는다 — 그래서
  // 앞 노드에 적던 글이 다음 노드의 칸에 남아 있었다(사용자 지적). 그리는 중에
  // 상태를 고치는 것은 React 가 권하는 「props 가 바뀌면 state 를 맞춘다」 그대로다
  // (효과로 미루면 한 번은 **옛 글자가 그려진 뒤** 바뀐다).
  const reconciled = nextMemoFieldState(field, { executionNodeId, savedMemo });
  if (reconciled !== field) {
    setField(reconciled);
    setErrorMessage(null);
  }

  async function handleSave() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await updateExecutionNodeMemoAction({
      executionNodeId,
      expectedVersion: executionNodeVersion,
      memo: memoSavePayload(reconciled),
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    // 저장하면 **보기로 돌아간다** — 고치는 칸을 열어 둔 채로 두면 다음에 다른
    // 노드가 와도 칸이 열려 있어 ①이 다시 열린다.
    setField({ ...reconciled, isEditing: false });
    router.refresh();
    showSavePopup({ message: "메모를 저장했습니다.", redirectTo: null });
  }

  return (
    <ExecutionMemoFieldView
      fieldId={`execution-node-memo-${executionNodeId}`}
      field={reconciled}
      savedMemo={savedMemo}
      eligible={eligible}
      isSubmitting={isSubmitting}
      errorMessage={errorMessage}
      size={size}
      onEdit={() => setField(beginMemoEdit(reconciled, { executionNodeId, savedMemo }))}
      onDraftChange={(draft) => setField(typeMemoDraft(reconciled, draft))}
      onSave={() => void handleSave()}
      onCancel={() => {
        setErrorMessage(null);
        setField(cancelMemoEdit(reconciled, { executionNodeId, savedMemo }));
      }}
    />
  );
}
