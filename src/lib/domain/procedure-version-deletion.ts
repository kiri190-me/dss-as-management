import {
  procedureTemplateStatusLabels,
  type ProcedureTemplateStatus,
} from "./procedure-template-types";

/**
 * ============================================================================
 * [버전 목록]의 [삭제] — 어떤 판을 지울 수 있는가 (2026-11-04)
 * ============================================================================
 * 사용자가 말한 것: "[버전 목록]에 [삭제]버튼도 만들어줘."
 *
 * 그 목록에는 **초안 · 게시본 · 만료본**이 함께 선다. 셋이 같은 것이 아니다.
 *
 * ── 🔴 지울 수 있는 것: 초안과 만료본 ───────────────────────────────────
 *  · 초안(DRAFT) — 잘못 만든 판이다. 편집기의 [초안 버리기]가 이미 하던 일이고,
 *    여기서는 편집기에 들어가지 않고도 치울 수 있게 됐을 뿐이다.
 *  · 만료본(ARCHIVED) — 더 이상 쓰이지 않는 판이다.
 *
 * ── 🔴 못 지우는 것: 게시본 ─────────────────────────────────────────────
 * **지금 현장에서 쓰이는 절차**다. 지우면 A/S 접수 건의 [+ 기술 절차 불러오기]
 * 목록에서 사라진다. 먼저 다른 판을 게시해 이 판을 [만료됨]으로 내린 뒤에 지우는
 * 것이 올바른 차례이고, 막는 글에 그 길을 함께 적는다.
 *
 * ── 🔴 상태와 「쓰이고 있다」는 **다른 까닭**이다 ───────────────────────
 * 만료본이라도 붙잡고 있는 것이 있으면 못 지운다. 지금 **셋**이다:
 *  · 수행 기록(procedure_case_executions) — 지난 수리의 근거다.
 *  · 다음 판이 supersedes_template_id 로 이어받음.
 *  · 🔴 다른 절차의 END 가 next_procedure_template_id 로 가리킴(2026-11-04, 줄기 B ④).
 * 셋 다 FK 가 RESTRICT 라, 안 세면 15일 뒤 완전삭제가 DB 에서 거부되어 휴지통에서
 * 영영 안 사라진다.
 *
 * 🔴 **짧은 글에 셋을 나열하지 않는다.** 까닭이 늘 때마다 줄에 적히는 글이 길어지면
 * 목록 한 줄이 밀려 찌그러진다. 짧은 글은 「다른 곳에서 쓰이고 있다」로 묶고,
 * 무엇이 붙잡고 있는지는 **긴 글(마우스 올림)**이 센다. 가르지 않는 까닭은 아래
 * resolveProcedureVersionDeleteBlock 의 주석에 있다 — 서버가 셋을 합쳐 세기 때문이다.
 *
 * 🔵 **실측(2026-11-04)**: 게시 → 새 초안 → 게시 로 내려간 만료본은 **거의 언제나**
 * 다음 판이 이어받고 있다(createNewDraftVersion 이 supersedes_template_id 를
 * 채운다). 그래서 "만료본은 지울 수 있다"는 규칙은 맞지만, 실제 화면에서는
 * 대부분 「다른 곳에서 쓰이고 있다」 까닭으로 막힌다. 손으로 보관한 판(후속 없음)이나
 * 한 번도 안 쓰인 판만 실제로 지워진다. 이 사실을 막는 글이 그대로 말한다.
 *
 * ── 🔴 까닭이 두 가지로 **달라 보여야** 한다 ────────────────────────────
 * 흐린 단추만 두면 사람은 고장으로 읽는다. 「지금 게시 중이라」와 「다른 곳에서
 * 쓰이고 있어서」는 할 일이 다르다 — 앞은 다른 판을 게시하면 풀린다.
 * 뒤는 무엇이 붙잡고 있느냐에 따라 갈린다: 수행 기록은 영영 안 풀리고(지난 수리의
 * 근거다), 이어가기는 **그 절차의 END 에서 지정을 지우면 풀린다.** 그래서 긴 글이
 * 셋을 함께 적는다 — 「영영 안 됨」으로만 적으면 풀 수 있는 사람이 포기한다.
 *
 * ── 🔴 차례가 서버와 같아야 한다 ────────────────────────────────────────
 * 서버(softDeleteProcedureTemplate)는 **상태를 먼저** 보고 그 다음에 참조 수를
 * 센다. 여기서 차례를 뒤집으면, 게시본이면서 수행 기록도 있는 판에서 화면은
 * 「수행 기록」이라 적고 서버는 「게시 중」이라 답한다.
 * ============================================================================
 */

/** 이 길(버전 목록의 [삭제])로 지울 수 있는 상태. 🔴 PUBLISHED 가 없는 것이 알맹이다. */
export const PROCEDURE_DELETABLE_VERSION_STATUSES = [
  "DRAFT",
  "ARCHIVED",
] as const satisfies readonly ProcedureTemplateStatus[];

export function canDeleteProcedureVersionStatus(status: ProcedureTemplateStatus): boolean {
  return (PROCEDURE_DELETABLE_VERSION_STATUSES as readonly ProcedureTemplateStatus[]).includes(status);
}

export type ProcedureVersionDeleteBlock = {
  /** 줄에 그대로 적히는 짧은 글. */
  reason: string;
  /** 마우스를 올렸을 때 나오는 긴 글 — 무엇을 하면 풀리는지까지 적는다. */
  detail: string;
};

/**
 * 이 판을 지울 수 없는 까닭. 지울 수 있으면 null.
 *
 * `isReferenced` 는 수행 기록이 있거나 다음 판이 이어받았다는 뜻이다 — 둘을
 * 가르지 않는 까닭은 서버의 거절 메시지가 이미 둘을 함께 세기 때문이다
 * (countProcedureTemplateReferences). 가르려면 세는 쪽부터 둘로 나눠야 하고,
 * 그러면 화면과 서버가 서로 다른 수를 말하게 된다.
 */
export function resolveProcedureVersionDeleteBlock(input: {
  status: ProcedureTemplateStatus;
  isReferenced: boolean;
}): ProcedureVersionDeleteBlock | null {
  // 🔴 상태가 먼저다(머리말) — 서버와 같은 차례.
  if (!canDeleteProcedureVersionStatus(input.status)) {
    return {
      reason: `${procedureTemplateStatusLabels[input.status]} 상태라 삭제할 수 없습니다`,
      detail:
        "지금 현장에서 쓰이는 판입니다. 다른 판을 게시하면 이 판이 [만료됨]으로 내려가고, 그때 삭제할 수 있습니다.",
    };
  }
  if (input.isReferenced) {
    return {
      reason: "다른 곳에서 쓰이고 있어 삭제할 수 없습니다",
      detail:
        "이 판으로 진행한 수리 기록이 있거나, 다음 판이 이 판을 이어받았거나, 다른 절차의 [종료]가 이 절차로 이어가도록 지정되어 있습니다. 수리 기록은 지난 수리의 근거라 풀 수 없고, 이어가기는 그 절차의 [종료] 노드에서 지정을 지우면 풀립니다.",
    };
  }
  return null;
}
