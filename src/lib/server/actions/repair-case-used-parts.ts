"use server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { saveRepairCaseUsedParts } from "@/lib/db/mutations/repair-case-used-parts";
import {
  isValidExpectedVersion,
  isValidRepairCaseId,
  validateUsedPartLines,
  type SaveRepairCaseUsedPartsResult,
} from "@/lib/validation/repair-case-used-parts-input";

/**
 * ============================================================================
 * 「사용 부품」 저장 — 서버 액션 (B-2)
 * ============================================================================
 * 층 셋 중 가운데다: 검사(validation/repair-case-used-parts-input.ts) → **여기**
 * → 저장(db/mutations/repair-case-used-parts.ts).
 *
 * ── 앞부분은 update-repair-case.ts 를 그대로 따른다 (사용자 확정) ────────────
 * 기본 인가는 수리 건 자료 편집과 같다 — 쓰기 소스가 database · 로그인 · **살아
 * 있는 계정 다시 읽기** · approvalStatus === "APPROVED" · 유효한 건 id ·
 * expectedVersion. 차례도 그대로다: 값싸고 일반적인 검사가 먼저라서, 로그인하지
 * 않은 요청은 DB 질의에 닿지 않는다.
 *
 * 계정을 토큰이 아니라 DB 에서 다시 읽는 까닭도 그 파일과 같다 — 세션 토큰은
 * 서명만 맞으면 최대 8시간 스스로 유효하므로, 삭제 · 사용 중지 · 잠김 · 세션
 * 끊김인 사람이 열어 둔 화면에서 저장할 수 있으면 안 된다.
 *
 * ── 🔴 이 칸만의 두 규칙은 여기가 아니라 mutation 이 본다 ────────────────────
 * 반출 이력과 출하 잠금은 **트랜잭션 안에서** 판정해야 한다 — 여기서 미리 봐도
 * 그 사이에 바뀔 수 있고, 무엇보다 판정이 두 벌이 된다. mutation 이 조회와 같은
 * 함수로 본다(auth/repair-case-used-parts-authorization.ts).
 *
 * ── 🔴 역할 표를 따로 두지 않았다 ───────────────────────────────────────────
 * 접수 건 필드 편집에는 역할별 칸 표(authorizeSubmittedFields)가 있지만, 사용
 * 부품에는 사용자가 그런 표를 정하지 않았다 — 「수리건 자료 편집과 같은 앞부분」
 * 까지가 확정된 범위다. 임의로 역할을 좁히면 이 칸을 쓰라고 만든 사람이 막히므로
 * 좁히지 않았고, 대신 보고서에 적어 두었다. 좁혀야 한다면 고칠 곳은 이 파일 하나다.
 * ============================================================================
 */
export type SaveRepairCaseUsedPartsActionInput = {
  repairCaseId: string;
  expectedVersion: number;
  /** 날것 — 줄마다의 모양은 validateUsedPartLines 가 본다. */
  lines: unknown;
};

export async function saveRepairCaseUsedPartsAction(
  input: SaveRepairCaseUsedPartsActionInput
): Promise<SaveRepairCaseUsedPartsResult> {
  if (getRepairCaseWriteSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  if (getRepairCaseReadSource() !== "database") {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "서버 설정 오류로 저장할 수 없습니다. 관리자에게 문의해 주세요.",
    };
  }

  const session = await readSession();
  if (!session) {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." };
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, code: "UNAUTHORIZED", message: "사용자 정보를 확인할 수 없습니다." };
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { repairCaseId: "접수 건을 확인할 수 없습니다." },
      message: "입력값을 확인해 주세요.",
    };
  }
  if (!isValidExpectedVersion(input.expectedVersion)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { expectedVersion: "버전 정보를 확인할 수 없습니다." },
      message: "입력값을 확인해 주세요.",
    };
  }

  const validation = validateUsedPartLines(input.lines);
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: validation.fieldErrors,
      message: validation.message,
    };
  }

  try {
    const result = await saveRepairCaseUsedParts({
      repairCaseId: input.repairCaseId,
      expectedVersion: input.expectedVersion,
      actorUserId: actingUser.id,
      lines: validation.lines,
    });
    return result;
  } catch (err) {
    // 날 오류를 그대로 브라우저로 보내지 않는다(Postgres 내부 · SQL 문장 · 스키마가
    // 새어 나간다) — create-repair-case.ts · update-repair-case.ts 와 같은 규율.
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("saveRepairCaseUsedPartsAction: unexpected DB error", { code });
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
