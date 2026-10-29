"use server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { saveRepairCaseUsedParts } from "@/lib/db/mutations/repair-case-used-parts";
import { getRepairCaseContactFolderKeyById } from "@/lib/db/queries/repair-cases";
import { probeInventoryIssuedPartsTrace } from "@/lib/server/inventory-gateway";
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
 * ── 🔴 이 칸만의 규칙 셋은 여기가 아니라 mutation 이 본다 ────────────────────
 * 권한 · 반출 이력 · 출하 잠금은 **트랜잭션 안에서** 판정해야 한다 — 여기서 미리
 * 봐도 그 사이에 바뀔 수 있고, 무엇보다 판정이 두 벌이 된다. mutation 이 조회와
 * 같은 함수로 본다(auth/repair-case-used-parts-authorization.ts).
 *
 * ── 🔴 사람은 여기서 **나르기만** 한다 ──────────────────────────────────────
 * 이 파일이 하는 일은 살아 있는 계정을 읽어 그 사람을 mutation 에 건네주는 것
 * 뿐이다. 「누가 적을 수 있는가」는 [역할별 접근 권한]의 `repairCases.usedParts`
 * 한 곳이 정한다 — 여기에 역할 이름을 적으면 그 순간 판정이 두 벌이 된다.
 *
 * 사람을 세션 토큰이 아니라 resolveActingUserForSession 이 읽은 행에서 가져오는
 * 까닭은 위 문단과 같다 — 강등된 사람이 열어 둔 화면에서 저장할 수 있으면 안 된다.
 *
 * ── 🔴 **딱 하나, 재고 관리에 묻는 일만 여기서 한다** (2026-10-29) ──────────
 * 반출 흔적의 절반이 재고 관리에 있다(2026-10-16 부터 새 신청은 전부 그쪽으로
 * 올라간다 — auth/repair-case-used-parts-authorization.ts 머리말). 묻는 것은
 * 「신청이 있나」가 아니라 **「실제로 나간 것이 있나」**이고(`probeInventoryIssuedPartsTrace`),
 * 🔴 그 자는 **화면 쪽([id]/page.tsx)이 쓰는 것과 같은 함수**다 — 화면이 여는 조건과
 * 서버가 받아 주는 조건을 두 벌로 재면 언젠가 갈린다. 그런데 묻는 일은
 * **HTTP 왕복**이고, mutation 은 첫 줄부터 **트랜잭션 안**이다. 거기서 두드리면 그
 * 수리 건의 행 잠금이 **재고 관리의 응답만큼**(읽기 제한 5초) 길어진다.
 *
 * 🔴 그래서 **트랜잭션을 열기 전인 여기서 묻고, 답을 들고 들어간다.** 연락서 이식도
 *    같은 모양이다(`server/services/kyosan-report-import.ts`). 🔵 이 파일이 `lib/server`
 *    아래에 있는 것도 그 까닭이다 — 바깥 통로를 부를 수 있는 층이다(`db/mutations` 는
 *    아니다).
 * 🔴 **판정은 여전히 여기서 하지 않는다.** 받아 온 답을 **그대로** 넘기기만 하고,
 *    「있으면 막는다 · 못 물어봤으면 막는다」는 mutation 이 조회와 같은 함수로 정한다.
 *    여기서 한 줄이라도 가리면 판정이 두 벌이 된다.
 *
 * 🔴 **묻는 열쇠는 인수번호**다 — 재고 관리에는 A/S 의 건 id 가 없고, 우리는 저쪽
 *    요청 번호를 저장하지 않는다(`lib/server/inventory-gateway.ts` 머리말). 화면은 건
 *    id 만 보내므로 **여기서 한 번 더 읽는다**(지워진 건은 그때 걸러진다).
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
    /**
     * 🔴 **트랜잭션을 열기 전에** 재고 관리에 묻는다(위 머리말). 묻는 열쇠인 인수번호를
     * 여기서 읽는다 — 이 조회는 **휴지통에 들어갔거나 없는 건이면 `null`** 이다. 그때는
     * mutation 도 어차피 NOT_FOUND 라 **같은 문구**로 여기서 끝낸다(사람에게는 같은
     * 일이고, 저쪽도 차례가 같다 — 권한보다 「건이 있는가」가 먼저다).
     */
    const caseKey = await getRepairCaseContactFolderKeyById(input.repairCaseId);
    if (!caseKey) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }
    /** 🔴 셋을 그대로 나른다 — 「모른다」를 여기서 「없다」로 눕히지 않는다. */
    const issuedPartsTrace = await probeInventoryIssuedPartsTrace(caseKey.intakeNumber);

    const result = await saveRepairCaseUsedParts({
      repairCaseId: input.repairCaseId,
      expectedVersion: input.expectedVersion,
      actorUserId: actingUser.id,
      actor: actingUser,
      issuedPartsTrace,
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
