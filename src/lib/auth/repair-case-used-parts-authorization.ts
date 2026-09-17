/**
 * ============================================================================
 * 「사용 부품」 칸에 적을 수 있는가 — 이 칸만의 규칙 둘
 * ============================================================================
 * 이 칸이 왜 있는지는 schema/repair-case-used-parts.ts 머리말에 있다. 여기에는
 * **누가 적을 수 있는가**만 적는다.
 *
 * 기본 인가(쓰기 소스가 database · 로그인 · 살아 있는 계정 · 승인된 계정 · 유효한
 * 건 id · expectedVersion)는 수리 건 자료 편집과 똑같고, 그것은 서버 액션
 * (actions/repair-case-used-parts.ts)이 update-repair-case.ts 와 같은 차례로
 * 본다. 이 파일이 정하는 것은 그 위에 얹히는 **이 칸만의 규칙 둘**이다.
 *
 * ── 🔴 규칙 1 — 반출 이력이 있으면 적을 수 없다 ─────────────────────────────
 * 화면만 감추면 주소로 불러 저장할 수 있고, 그러면 같은 부품을 통계가 두 번
 * 센다(요청서 한 번, 손글씨 한 번). 그래서 **서버가 거절한다.**
 *
 * 무엇을 「반출 이력」으로 치는지는 여기서 다시 정하지 않는다 — B-1 이 만든
 * queries/repair-case-used-parts.ts 의 `livePartRequestCondition` 하나가 그 판정을
 * 갖고, 화면(조회)과 저장(mutation)이 **같은 그 조건**을 쓴다. 두 벌로 적으면
 * 한쪽만 고쳐지는 날이 오고, 그날 통계가 조용히 어긋난다.
 *
 * ── 🔴 규칙 2 — 출하 잠금은 「과거 인수품 가져오기」로 들어온 건에만 푼다 ───
 * 사용 부품은 **이미 출하된 옛 건에 적으려고** 만든 칸이다. 출하 잠금을 그대로
 * 두면 주 용도가 통째로 막히고, 반대로 모든 건에서 풀면 잠금이 뜻을 잃는다.
 * 사용자가 그 사이를 이렇게 갈랐다(2026-09-17):
 *
 *   · 잠기지 않은 건            → 평소대로 적는다
 *   · 잠긴 건 + 가져온 건        → 적는다  (이 칸을 만든 까닭)
 *   · 잠긴 건 + 그 밖의 건       → 막는다
 *
 * 「가져온 건」의 판정(status_change_histories 의 LEGACY_IMPORT_STATE_SET +
 * metadata->>'source' = KYOSAN_INTAKE_LIST)도 조회 모듈이 한 벌만 갖고 있다
 * (queries/repair-case-used-parts.ts 의 `importedFromKyosanIntakeCondition`).
 *
 * ── 🔴 왜 repair-case-edit-authorization.ts 의 isBlockedByShipmentLock 을
 *      그대로 부르지 않는가 (직접 확인한 것, 사용자 확인 필요) ───────────────
 * 그 함수는 **지금 언제나 false 를 돌려준다** — 「shipment-lock removal
 * checkpoint」에서 수리 건 *필드 편집*의 잠금이 통째로 걷혔기 때문이다(그 파일의
 * 머리말). 그것을 그대로 부르면 위 규칙 2 가 아무 일도 하지 않는 글자가 된다.
 *
 * 한편 repair_cases.is_locked 자체는 살아 있다 — workflow-transitions.ts 가
 * 출하 완료에서 true 로 세우고(같은 파일 258행), workflow-transitions ·
 * repair-case-approvals · case-workflow-steps 세 쓰기 경로가 지금도 그 값을
 * 그대로 보고 막는다. 이 칸은 **그 쪽 가족**을 따르되 가져온 건만 예외로 둔다.
 *
 * 나중에 잠금 정책이 다시 하나로 모이면 고칠 곳은 아래 함수 하나다.
 * ============================================================================
 */

/** 적을 수 없는 까닭. 서버 액션이 그대로 결과 코드로 쓴다. */
export type UsedPartsWriteBlockCode = "PART_REQUEST_HISTORY_EXISTS" | "CASE_LOCKED";

export type UsedPartsWriteGate =
  | { ok: true }
  | { ok: false; code: UsedPartsWriteBlockCode; message: string };

/**
 * 판정의 재료. 셋 다 **서버가 읽은 사실**이다 — 화면이 보낸 값이 하나도 없다
 * (화면이 스스로 판정하면 판정이 두 벌이 된다).
 */
export type UsedPartsWriteGateFacts = {
  /** 이 건에 살아 있는 부품 요청(반출) 줄이 있는가. REJECTED · CANCELLED 는 치지 않는다. */
  hasPartRequestHistory: boolean;
  /** repair_cases.is_locked — 출하 완료로 잠겼는가. */
  isShipmentLocked: boolean;
  /** 「과거 인수품 가져오기」(KYOSAN_INTAKE_LIST)로 들어온 건인가. */
  isLegacyImportedCase: boolean;
};

export const USED_PARTS_PART_REQUEST_HISTORY_MESSAGE =
  "이 건의 부품은 부품 요청(반출) 이력에서 잡힙니다. 같은 부품이 두 번 세어지지 않도록 사용 부품에는 따로 적을 수 없습니다.";

export const USED_PARTS_CASE_LOCKED_MESSAGE =
  "출하 완료로 잠긴 접수 건입니다. 과거 인수품 가져오기로 들어온 건에만 사용 부품을 적을 수 있습니다.";

/**
 * 규칙 2 만 따로 떼어 둔 것 — 「모든 건에서 푸는 것」과 「가져온 건에만 푸는 것」의
 * 차이가 이 한 줄이라, 나중에 읽는 사람이 여기만 보면 된다.
 */
export function isUsedPartsBlockedByShipmentLock(
  isShipmentLocked: boolean,
  isLegacyImportedCase: boolean
): boolean {
  return isShipmentLocked && !isLegacyImportedCase;
}

/**
 * 두 규칙을 한 번에. **조회(화면에 입력 칸을 그릴지)와 저장(mutation)이 같은 이
 * 함수를 부른다** — 화면이 여는 조건과 서버가 받아 주는 조건이 어긋날 길을 두지
 * 않는다.
 *
 * 차례는 반출 이력 먼저다. 둘 다 걸린 건에게는 「요청서가 이미 있다」가 더 쓸모
 * 있는 안내다(잠금은 풀 길이 있지만 반출 이력은 이 칸의 존재 이유 자체를 없앤다).
 */
export function resolveUsedPartsWriteGate(facts: UsedPartsWriteGateFacts): UsedPartsWriteGate {
  if (facts.hasPartRequestHistory) {
    return {
      ok: false,
      code: "PART_REQUEST_HISTORY_EXISTS",
      message: USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
    };
  }
  if (isUsedPartsBlockedByShipmentLock(facts.isShipmentLocked, facts.isLegacyImportedCase)) {
    return { ok: false, code: "CASE_LOCKED", message: USED_PARTS_CASE_LOCKED_MESSAGE };
  }
  return { ok: true };
}
