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
/** 접수 건 상세에서 고친 뒤의 팝업 — 저장하면 전체 A/S 현황으로 넘어간다(2026-09-15 사용자 요청). */
export const REPAIR_CASE_SAVED_POPUP: SavePopupRequest = {
  message: "A/S 정보를 저장했습니다.",
  redirectTo: "/repair-cases",
};

export function useSectionEditSubmit(params: {
  repairCaseId: string;
  version: number;
  section: RepairCaseEditSection;
  onDone: () => void;
  /**
   * 저장 뒤 띄울 팝업(common/SavePopup.tsx). 부르는 곳마다 넘어갈 곳이 달라서
   * 받는다 — 접수 건 상세는 A/S 목록으로(REPAIR_CASE_SAVED_POPUP), 주간보고의
   * 비고 칸은 그 표에 머문다. null 이면 띄우지 않는다. 필수로 둔 것은 새로 부르는
   * 곳이 정하고 가게 하려는 것이다 — 빠뜨리면 타입이 막는다.
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
