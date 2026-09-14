import { SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS } from "@/lib/domain/shipment-approval-route";
import { USER_DELETION_REASON_MAX_LENGTH } from "@/lib/validation/user-deletion-input";
import type {
  UserDeletionBlocker,
  UserDeletionPreview,
  UserDeletionPreviewImpact,
} from "@/lib/db/queries/user-deletion-impact";
import type { DeleteUserAccountActionInput } from "@/lib/server/actions/user-deletion";

/**
 * ============================================================================
 * 계정 삭제 확인 창 — 문장 만들기 · [삭제] 켜짐 판정 (순수 함수)
 * ============================================================================
 * 확인 창(UserDeletionDialog.tsx)은 서버 액션을 부르므로 test:components 에서 그려 볼
 * 수 없다(사슬 끝의 `server-only`). 그래서 「무엇을 어떻게 말하는가」와 「언제 누를 수
 * 있는가」를 여기로 떼어 값으로 시험한다(user-deletion-dialog-text.test.ts).
 *
 * 🔴 여기의 판정은 편의다 — 막는 것은 서버다. 누가 지울 수 있는가 · 이어받을 사람이
 * 맞는가 · 사유가 있는가는 서버 액션과 mutation 이 다시 본다.
 *
 * 🔴 서버 모듈에서는 **타입만** 가져온다(`import type`). 값을 가져오면 이 파일을 부르는
 * 클라이언트 화면과 시험이 `server-only` 사슬에 걸린다.
 * ============================================================================
 */

export type ReadyUserDeletionPreview = Extract<UserDeletionPreview, { ok: true }>;

/** 확인 창의 고정 안내 — 사용자 결정(2026-09-13) 그대로. */
export const USER_DELETION_PORTAL_NOTICE =
  "이 시스템에서 목록을 치우고 일을 넘기는 것입니다. 로그인을 실제로 막으려면 통합 로그인 포털에서 권한을 회수하세요. 포털로 다시 로그인하면 계정이 되살아나지만, 대표 · 위임 · 개발자 표시 · 접수 메일 수신은 되살아나지 않습니다.";

/** 삭제가 CONFLICT 로 돌아와 미리보기를 다시 부를 때의 안내. */
export const USER_DELETION_CONFLICT_NOTICE = "그 사이 바뀐 것이 있어 다시 불러왔습니다. 내용을 확인한 뒤 다시 눌러 주세요.";

/** 서버가 결과를 돌려주지 못했을 때(연결 끊김 등) — 서버 문구가 없으니 여기서 말한다. */
export const USER_DELETION_UNEXPECTED_FAILURE = "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";

export function userDeletionSuccessMessage(targetName: string): string {
  return `${targetName} 님의 계정을 삭제했습니다.`;
}

/**
 * [계정 삭제]를 이 줄에 보일까 — 서버 페이지가 계산해 준 값이 참이고, 자기 자신의 줄이
 * 아닐 때만. uuid 는 DB 에서 대소문자를 가리지 않으므로 여기서도 가리지 않는다.
 */
export function mayShowUserDeletionButton(params: {
  canDeleteUserAccounts: boolean;
  actingUserId: string;
  rowUserId: string;
}): boolean {
  if (!params.canDeleteUserAccounts) return false;
  return params.rowUserId.toLowerCase() !== params.actingUserId.toLowerCase();
}

/**
 * 목적격 조사 — 마지막 글자에 받침이 있으면 「을」, 없으면 「를」. 끝에 붙은 괄호
 * 설명은 건너뛰고 본다(「2곳(최종 출하 승인 1번째 단계)」 → 「곳」).
 */
export function objectParticle(text: string): "을" | "를" {
  const head = text.replace(/\([^()]*\)\s*$/, "").trimEnd();
  const code = head.charCodeAt(head.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? "를" : "을";
  return "을";
}

function withObjectParticle(items: readonly string[]): string {
  const joined = items.join(" · ");
  return `${joined}${objectParticle(items[items.length - 1] ?? "")}`;
}

export type UserDeletionImpactText = {
  /** 삭제가 바꾸는 것 — 넘기거나 옮기거나 철회하거나 해제하거나 되돌린다. */
  changes: string[];
  /** 그대로 두는 것 — 안내용. */
  keeps: string[];
};

/**
 * 영향 건수를 사람이 읽는 문장으로. **0 인 항목은 문장에 넣지 않는다** — 「위임 0건을
 * 철회합니다」는 읽는 사람에게 무언가 있다고 말한다.
 */
export function describeUserDeletionImpact(impact: UserDeletionPreviewImpact): UserDeletionImpactText {
  const changes: string[] = [];
  const keeps: string[] = [];

  // 1. 결재 이어받을 사람에게 넘기는 것.
  const approvalItems: string[] = [];
  if (impact.routeSlots.length > 0) {
    const where = impact.routeSlots
      .map((slot) => `${SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[slot.scope]} ${slot.stepOrder}번째 단계`)
      .join(", ");
    approvalItems.push(`결재선 자리 ${impact.routeSlots.length}곳(${where})`);
  }
  const pending = impact.pendingApprovals;
  const pendingTotal = pending.finalShipment + pending.repairInspection + pending.partIssue;
  if (pendingTotal > 0) {
    const parts = [
      pending.finalShipment > 0 ? `${SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.FINAL_SHIPMENT} ${pending.finalShipment}건` : null,
      pending.repairInspection > 0 ? `수리 검수 승인 ${pending.repairInspection}건` : null,
      pending.partIssue > 0 ? `${SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.PART_ISSUE} ${pending.partIssue}건` : null,
    ].filter((part): part is string => part !== null);
    approvalItems.push(`대기 결재 ${pendingTotal}건(${parts.join(", ")})`);
  }
  if (approvalItems.length > 0) {
    changes.push(`결재 이어받을 사람에게 ${withObjectParticle(approvalItems)} 넘깁니다.`);
  }
  if (impact.isLastRepresentative) {
    changes.push("마지막 출하 대표라서 결재 이어받을 사람이 출하 대표가 됩니다.");
  }

  // 2. 담당 이어받을 사람에게 넘기는 것.
  if (impact.openAssignedCases > 0) {
    changes.push(`담당 이어받을 사람에게 담당 중인 접수 건 ${impact.openAssignedCases}건을 넘깁니다.`);
  }

  // 3. 현재 판의 뒤 단계에 있어 새 판으로 옮기는 진행 중 결재.
  if (impact.chainsToRepin > 0) {
    changes.push(`진행 중인 결재 ${impact.chainsToRepin}건은 새 승인 절차로 옮겨 이어 갑니다.`);
  }

  // 4. 위임 — 대표로서든 위임받은 사람으로서든.
  const delegations = impact.activeDelegations;
  const delegationTotal = delegations.asRepresentative + delegations.asDelegate;
  if (delegationTotal > 0) {
    const parts = [
      delegations.asRepresentative > 0 ? `대표로서 맡긴 것 ${delegations.asRepresentative}건` : null,
      delegations.asDelegate > 0 ? `위임받은 것 ${delegations.asDelegate}건` : null,
    ].filter((part): part is string => part !== null);
    changes.push(`위임 ${delegationTotal}건(${parts.join(", ")})을 철회합니다.`);
  }

  // 5. 표시 — 되살려도 돌아오지 않는 것들.
  const flags = [
    impact.isRepresentative ? "출하 대표 지정" : null,
    impact.isDeveloper ? "개발자 표시" : null,
    impact.isIntakeMailRecipient ? "접수 메일 수신" : null,
  ].filter((flag): flag is string => flag !== null);
  if (flags.length > 0) {
    changes.push(`${withObjectParticle(flags)} 해제합니다.`);
  }

  // 6. 열린 절차 노드 — 담당을 비워 접수 건 담당을 따르게 한다.
  if (impact.openClaimedNodes > 0) {
    changes.push(`맡고 있던 열린 절차 노드 ${impact.openClaimedNodes}개는 접수 건 담당을 따르도록 되돌립니다.`);
  }

  // 그대로 두는 것.
  if (impact.untouchedAssignedCases > 0) {
    keeps.push(`휴지통에 있거나 출하 완료로 잠긴 담당 접수 건 ${impact.untouchedAssignedCases}건은 그대로 둡니다.`);
  }
  const ownItems = [
    impact.ownOpenPartRequests > 0 ? `부품 요청 ${impact.ownOpenPartRequests}건` : null,
    impact.ownOpenPartIssueRequests > 0 ? `부품 불출 신청 ${impact.ownOpenPartIssueRequests}건` : null,
  ].filter((item): item is string => item !== null);
  if (ownItems.length > 0) {
    keeps.push(`(참고) 직접 올린 열린 ${ownItems.join(" · ")}은 그대로 둡니다. 재고 담당자가 처리할 수 있습니다.`);
  }

  return { changes, keeps };
}

/** 막는 사유 한 줄 — 무엇이(접수번호 · 단계) 막는지와 서버가 준 문장. */
export function describeUserDeletionBlocker(blocker: UserDeletionBlocker): { subject: string; message: string } {
  if (blocker.code === "IN_FLIGHT_ON_OLD_ROUTE") {
    // label 에 접수번호나 불출 신청 식별자가 들어 있다(queries/user-deletion-impact.ts).
    return { subject: blocker.label, message: blocker.message };
  }
  return {
    subject: `${SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS[blocker.scope]} 절차 ${blocker.stepOrder}번째 단계 · ${blocker.approverName} 님`,
    message: blocker.message,
  };
}

export type UserDeletionFormState = {
  approvalSuccessorId: string;
  engineerSuccessorId: string;
  reason: string;
};

export const EMPTY_USER_DELETION_FORM: UserDeletionFormState = {
  approvalSuccessorId: "",
  engineerSuccessorId: "",
  reason: "",
};

function isChosen(id: string, candidates: readonly { id: string }[]): boolean {
  return id !== "" && candidates.some((candidate) => candidate.id === id);
}

export type UserDeletionSubmitCheck = { enabled: true } | { enabled: false; reason: string };

/**
 * [삭제]를 누를 수 있는가 — 막는 사유가 없고, 필요한 이어받을 사람을 골랐고, 사유가
 * 1~2000자일 때. 보내는 중인가는 부르는 쪽이 따로 본다.
 */
export function checkUserDeletionSubmit(
  preview: ReadyUserDeletionPreview,
  form: UserDeletionFormState
): UserDeletionSubmitCheck {
  if (preview.blockers.length > 0) {
    return { enabled: false, reason: "아래 사유 때문에 지금은 삭제할 수 없습니다." };
  }
  const { approvalSuccessors, engineerSuccessors } = preview.candidates;
  if (preview.requires.approvalSuccessor && !isChosen(form.approvalSuccessorId, approvalSuccessors)) {
    return {
      enabled: false,
      reason:
        approvalSuccessors.length === 0
          ? "결재를 이어받을 수 있는 사람이 없습니다."
          : "결재 이어받을 사람을 골라 주세요.",
    };
  }
  if (preview.requires.engineerSuccessor && !isChosen(form.engineerSuccessorId, engineerSuccessors)) {
    return {
      enabled: false,
      reason:
        engineerSuccessors.length === 0
          ? "담당을 이어받을 수 있는 사람이 없습니다."
          : "담당 이어받을 사람을 골라 주세요.",
    };
  }
  const reason = form.reason.trim();
  if (reason.length === 0) return { enabled: false, reason: "삭제 사유를 입력해 주세요." };
  if (reason.length > USER_DELETION_REASON_MAX_LENGTH) {
    return { enabled: false, reason: `삭제 사유는 ${USER_DELETION_REASON_MAX_LENGTH}자까지 적을 수 있습니다.` };
  }
  return { enabled: true };
}

/** 미리보기를 다시 불렀을 때 고른 값을 지킨다 — 새 후보 목록에 없으면 비운다. */
export function retainSuccessorSelection(previousId: string, candidates: readonly { id: string }[]): string {
  return isChosen(previousId, candidates) ? previousId : "";
}

/**
 * 삭제 요청 — expectedVersion 은 미리보기가 준 대상 계정의 version 이다. 필요 없는 쪽의
 * 이어받을 사람은 보내지 않는다(서버도 받으면 쓰지 않는다).
 */
export function buildUserDeletionActionInput(
  preview: ReadyUserDeletionPreview,
  form: UserDeletionFormState
): DeleteUserAccountActionInput {
  return {
    targetUserId: preview.target.id,
    expectedVersion: preview.target.version,
    reason: form.reason.trim(),
    approvalSuccessorUserId: preview.requires.approvalSuccessor ? form.approvalSuccessorId || null : null,
    engineerSuccessorUserId: preview.requires.engineerSuccessor ? form.engineerSuccessorId || null : null,
  };
}
