"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import type { SavePopupRequest } from "@/lib/domain/save-popup";
import { buildDraftText } from "@/lib/domain/edit-draft-text";
import { updateRepairCaseAction } from "@/lib/server/actions/update-repair-case";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";

/**
 * 충돌일 때의 오류 모양 — 메시지에 더해 **사용자가 방금 적어 둔 글**을 함께
 * 나른다. 평상시 오류는 지금까지처럼 메시지 문자열 하나다.
 *
 * 이 값을 EditSectionActions까지 전달하는 통로가 submitError인 이유: 편집 폼
 * 셋(과 상단 카드의 두 셀)은 submitError를 받아서 EditSectionActions에 그대로
 * 넘기기만 한다. 그래서 이 모양만 넓히면 폼을 하나도 고치지 않고 화면까지
 * 닿는다.
 */
export type SectionEditConflictError = {
  message: string;
  /** 보여 줄 자유 입력 내용. 보여 줄 것이 없으면 빈 문자열이다. */
  draftText: string;
};

/**
 * Shared submit/error/conflict state machine for all three section edit
 * forms (Intake/Product/FaultService) — each form only supplies its own
 * field inputs and calls `submit(fields)` with the subset of fields the
 * user actually changed (partial submission; see repair-case-update-
 * input.ts's module comment).
 *
 * On success or on a user-triggered post-CONFLICT reload, this calls
 * router.refresh() (re-fetches the server-rendered detail page, including
 * the new `version`) and `onDone()` (the parent's signal to exit edit
 * mode) — the edit form's own local input state is never explicitly
 * "reset": switching back to view mode simply unmounts it.
 *
 * 그 "언마운트되면 입력값이 사라진다"가 충돌 때는 손실이 된다. 그래서 얼리기
 * 직전에 저장하려던 fields에서 자유 입력 글만 뽑아 붙잡아 둔다(아래 CONFLICT
 * 분기) — 폼이 사라진 뒤에도 사용자가 그 글을 볼 수 있다.
 */
/**
 * 접수 건 상세에서 고친 뒤의 팝업 — 팝업만 띄우고 **그 상세 화면에 머문다**.
 *
 * 결정이 두 번 있었다. 지우지 말 것:
 * - 2026-09-15 사용자 요청: 저장하면 전체 A/S 현황(/repair-cases)으로 넘어가게 했다.
 * - 2026-10-06 사용자 요청: 「확인 팝업만 뜨고 현재 화면에 그대로 남도록」으로 되돌렸다.
 *   한 건을 열어 담당 엔지니어·접수 정보 따위를 잇달아 고치는데, 한 칸 저장할 때마다
 *   목록으로 튕겨 다시 찾아 들어가야 했기 때문이다.
 *
 * 머물러도 고친 값이 보이는 까닭: 성공 경로에서 router.refresh() 가 먼저 돌아
 * 서버가 그린 상세를 다시 받는다(값과 version 둘 다). 그 호출을 빼면 저장했는데
 * 옛 값이 보여 「저장이 안 됐나」가 되고, version 이 묵어 다음 저장이 충돌한다.
 */
export const REPAIR_CASE_SAVED_POPUP: SavePopupRequest = {
  message: "A/S 정보를 저장했습니다.",
  redirectTo: null,
};

export function useSectionEditSubmit(params: {
  repairCaseId: string;
  version: number;
  section: RepairCaseEditSection;
  onDone: () => void;
  /**
   * 저장 뒤 띄울 팝업(common/SavePopup.tsx). 부르는 곳마다 문구와 넘어갈 곳이
   * 달라서 받는다 — 접수 건 상세는 REPAIR_CASE_SAVED_POPUP(2026-10-06부터 그
   * 상세에 머문다), 주간보고의 비고 칸은 그 표에 머문다. null 이면 띄우지 않는다.
   * 필수로 둔 것은 새로 부르는 곳이 정하고 가게 하려는 것이다 — 빠뜨리면 타입이 막는다.
   */
  savedPopup: SavePopupRequest | null;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | SectionEditConflictError | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  async function submit(fields: Record<string, unknown>) {
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const result = await updateRepairCaseAction({
        repairCaseId: params.repairCaseId,
        expectedVersion: params.version,
        section: params.section,
        fields,
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // Freeze — do not allow further edits/saves from this stale form.
          // 얼리는 규칙은 그대로다. 다만 얼리기 전에 방금 저장하려던 자유 입력
          // 글을 붙잡아 둔다 — 곧 "최신 정보 다시 불러오기"로 폼이 언마운트되면
          // 입력값이 통째로 사라지기 때문이다. 무엇을 보여 줄지는
          // domain/edit-draft-text.ts가 혼자 정한다(id·날짜·고르는 값 제외).
          setIsConflict(true);
          setSubmitError({ message: result.message, draftText: buildDraftText(fields) });
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      router.refresh();
      params.onDone();
      if (params.savedPopup) showSavePopup(params.savedPopup);
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    params.onDone();
  }

  return { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict };
}
