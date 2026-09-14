import { isValidUuid } from "./procedure-validation-resolution-input";

/**
 * ============================================================================
 * 사용자 계정 삭제 입력 검증 — 형식만 본다
 * ============================================================================
 * shipment-approval-route-input.ts · shipment-delegation-input.ts 와 같은 자리다.
 * **DB 도 세션도 여기서 만지지 않는다.** 누가 지울 수 있는가(진짜 최고관리자)와
 * 이어받을 사람이 그 자리에 맞는가(자격)는 자료를 봐야 알 수 있으므로 mutation 이
 * 자기 트랜잭션 안에서 맡는다. 여기가 막는 것은 **바깥에서 들어온 값의 모양**이다.
 *
 * ── 사유는 필수다 ────────────────────────────────────────────────────────
 * 계정 삭제는 대표 이력 · 감사 기록에 영구히 남고, 이어받은 사람이 「왜 이 일이
 * 나에게 왔나」를 되짚을 때 읽는 유일한 글이다(메인 판단, 2026-09-14 승인). 다른
 * 삭제(고객사 휴지통 등)는 사유가 선택이지만 여기는 되돌리는 길이 화면에 없다.
 *
 * ── 이어받을 사람은 비워 둘 수 있다 ──────────────────────────────────────
 * 필요한 쪽만 요구한다 — 필요한지는 자료를 봐야 알고, 그 판정은 mutation 이 한다.
 * 빈 문자열은 「고르지 않음」으로 읽는다(화면의 빈 드롭다운이 그 값을 보낸다).
 * 🔴 지울 사람 자신을 이어받을 사람으로 보내면 여기서 막는다 — 자료 없이 답할 수
 * 있는 유일한 자격 판정이라서다.
 * ============================================================================
 */

/** 사유의 상한 — 다른 사유 칸들과 같다(shipment-delegation-input.ts). */
export const USER_DELETION_REASON_MAX_LENGTH = 2000;

export type ValidatedUserDeletionInput = {
  targetUserId: string;
  expectedVersion: number;
  reason: string;
  approvalSuccessorUserId: string | null;
  engineerSuccessorUserId: string | null;
};

export type UserDeletionInputFailure = { ok: false; code: "VALIDATION_ERROR"; message: string };

export type ValidateUserDeletionInputResult = { ok: true; value: ValidatedUserDeletionInput } | UserDeletionInputFailure;

function fail(message: string): UserDeletionInputFailure {
  return { ok: false, code: "VALIDATION_ERROR", message };
}

/** 이어받을 사람 칸 하나. undefined · null · 빈 문자열은 「고르지 않음」. */
function readSuccessor(value: unknown, label: string): { ok: true; id: string | null } | UserDeletionInputFailure {
  if (value === undefined || value === null) return { ok: true, id: null };
  if (typeof value !== "string") return fail(`${label}을 확인할 수 없습니다.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, id: null };
  if (!isValidUuid(trimmed)) return fail(`${label}을 확인할 수 없습니다.`);
  return { ok: true, id: trimmed };
}

/**
 * 삭제 요청의 모양. 받는 것은 `{ targetUserId, expectedVersion, reason,
 * approvalSuccessorUserId?, engineerSuccessorUserId? }` 다.
 */
export function validateUserDeletionInput(input: unknown): ValidateUserDeletionInputResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("삭제 요청을 확인할 수 없습니다.");
  }
  const raw = input as {
    targetUserId?: unknown;
    expectedVersion?: unknown;
    reason?: unknown;
    approvalSuccessorUserId?: unknown;
    engineerSuccessorUserId?: unknown;
  };

  if (!isValidUuid(raw.targetUserId)) return fail("삭제할 사용자를 확인할 수 없습니다.");
  const targetUserId = raw.targetUserId;

  // 화면이 미리보기에서 받아 간 계정 행의 판 번호다. 1부터 올라가는 정수만 받는다.
  if (
    typeof raw.expectedVersion !== "number" ||
    !Number.isSafeInteger(raw.expectedVersion) ||
    raw.expectedVersion < 1
  ) {
    return fail("사용자 정보의 버전을 확인할 수 없습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.");
  }

  if (raw.reason !== undefined && raw.reason !== null && typeof raw.reason !== "string") {
    return fail("삭제 사유를 확인할 수 없습니다.");
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (reason.length === 0) return fail("삭제 사유를 입력해 주세요.");
  if (reason.length > USER_DELETION_REASON_MAX_LENGTH) {
    return fail(`삭제 사유는 ${USER_DELETION_REASON_MAX_LENGTH}자까지 적을 수 있습니다.`);
  }

  const approval = readSuccessor(raw.approvalSuccessorUserId, "결재 이어받을 사람");
  if (!approval.ok) return approval;
  const engineer = readSuccessor(raw.engineerSuccessorUserId, "담당 이어받을 사람");
  if (!engineer.ok) return engineer;

  // uuid 는 DB 에서 대소문자를 가리지 않는다 — 여기서도 가리지 않고 견준다. 가리면
  // 대문자로 보낸 같은 id 가 이 검사를 빠져나간다.
  const targetKey = targetUserId.toLowerCase();
  if (approval.id?.toLowerCase() === targetKey || engineer.id?.toLowerCase() === targetKey) {
    return fail("삭제할 사용자 자신을 이어받을 사람으로 고를 수 없습니다.");
  }

  return {
    ok: true,
    value: {
      targetUserId,
      expectedVersion: raw.expectedVersion,
      reason,
      approvalSuccessorUserId: approval.id,
      engineerSuccessorUserId: engineer.id,
    },
  };
}

export type ValidateUserDeletionPreviewInputResult =
  | { ok: true; targetUserId: string }
  | UserDeletionInputFailure;

/** 영향 미리보기 요청의 모양 — `{ targetUserId }`. */
export function validateUserDeletionPreviewInput(input: unknown): ValidateUserDeletionPreviewInputResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("미리보기 요청을 확인할 수 없습니다.");
  }
  const { targetUserId } = input as { targetUserId?: unknown };
  if (!isValidUuid(targetUserId)) return fail("삭제할 사용자를 확인할 수 없습니다.");
  return { ok: true, targetUserId };
}
