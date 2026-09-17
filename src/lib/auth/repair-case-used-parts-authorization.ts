/**
 * ============================================================================
 * 「사용 부품」 칸에 적을 수 있는가 — 이 칸만의 규칙 셋
 * ============================================================================
 * 이 칸이 왜 있는지는 schema/repair-case-used-parts.ts 머리말에 있다. 여기에는
 * **누가 적을 수 있는가**만 적는다.
 *
 * 기본 인가(쓰기 소스가 database · 로그인 · 살아 있는 계정 · 승인된 계정 · 유효한
 * 건 id · expectedVersion)는 수리 건 자료 편집과 똑같고, 그것은 서버 액션
 * (actions/repair-case-used-parts.ts)이 update-repair-case.ts 와 같은 차례로
 * 본다. 이 파일이 정하는 것은 그 위에 얹히는 **이 칸만의 규칙 셋**이다.
 *
 * ── 🔴 규칙 0 — 역할 셋만 적을 수 있다 (2026-09-17 사용자 확정) ─────────────
 *   · SUPER_ADMIN · ADMIN · AS_ENGINEER → 쓰기
 *   · SALES · INVENTORY_MANAGER        → 못 씀
 *
 * 까닭: 「무엇을 갈았나」는 수리 내용이라 AS_ENGINEER 가 신고증상 · 외관 상태를
 * 적는 자리와 같다. SALES 는 고객 · 날짜 · 연락처 담당이고, INVENTORY_MANAGER 는
 * 수리건에서 읽기 전용이다(부품 반출 이력 쪽으로 이미 기록에 참여한다).
 *
 * 🔴 왜 repair-case-edit-authorization.ts 의 역할 표에 넣지 않았는가 —
 * 그 표(EDITABLE_FIELDS_BY_ROLE)는 **SECTION_FIELD_NAMES 의 칸 이름**을 역할에
 * 이어 붙인다. 사용 부품은 그 세 구역의 칸이 아니라 **자식 줄 목록**이라 그 표에
 * 넣을 이름 자체가 없다. 대신 이 칸의 규칙이 이미 이 파일 하나에 모여 있으므로
 * 역할도 여기에 얹었다 — 화면 · 조회 · 저장이 지금도 이 파일의 함수 하나만 본다.
 *
 * 🔴 역할 목록은 아래 USED_PARTS_WRITE_ROLES **한 곳에만** 있다. 조회 · 저장 ·
 * 화면 어디에도 역할 이름을 다시 적지 않는다(시험이 글자로 못 박는다).
 *
 * 🔴 `isDeveloper` 승격은 보지 않는다 — 접수 건 칸 편집(authorizeSubmittedFields)
 * 과 똑같이 **날 role** 로만 판정한다. 개발자 표시로 권한이 넓어지는 곳은 설정이
 * 최종 판정인 메뉴(permission-resolver.ts)뿐이고, 이 칸은 그 가족이 아니다.
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

import type { Role } from "@/lib/domain/types";

/** 적을 수 없는 까닭. 서버 액션이 그대로 결과 코드로 쓴다. */
export type UsedPartsWriteBlockCode =
  | "ROLE_NOT_ALLOWED"
  | "PART_REQUEST_HISTORY_EXISTS"
  | "CASE_LOCKED";

export type UsedPartsWriteGate =
  | { ok: true }
  | { ok: false; code: UsedPartsWriteBlockCode; message: string };

/**
 * 🔴 **사용 부품을 적을 수 있는 역할 — 이 목록의 유일한 자리.**
 *
 * transitions.ts 의 REQUEST_ELIGIBLE_ROLES 가 지금 우연히 같은 셋이지만 **가져다
 * 쓰지 않는다** — 그쪽은 「부품 요청을 낼 자격」이고 이쪽은 「수리 내용을 적을
 * 자격」이다. 한쪽 정책이 바뀔 때 다른 쪽이 조용히 따라 움직이면 안 된다.
 */
export const USED_PARTS_WRITE_ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"];

/** role 이 null 이면 **막는다** — 계정을 읽지 못한 요청은 닫히는 쪽으로 떨어진다. */
export function canRoleWriteUsedParts(role: Role | null): boolean {
  return role !== null && USED_PARTS_WRITE_ROLES.includes(role);
}

/**
 * 판정의 재료. 넷 다 **서버가 읽은 사실**이다 — 화면이 보낸 값이 하나도 없다
 * (화면이 스스로 판정하면 판정이 두 벌이 된다).
 */
export type UsedPartsWriteGateFacts = {
  /**
   * 지금 이 요청을 낸 사람의 역할. **살아 있는 계정에서 읽은 값**이어야 한다
   * (세션 토큰의 역할이 아니다 — auth/acting-user.ts 머리말). 읽지 못했으면 null.
   */
  actorRole: Role | null;
  /** 이 건에 살아 있는 부품 요청(반출) 줄이 있는가. REJECTED · CANCELLED 는 치지 않는다. */
  hasPartRequestHistory: boolean;
  /** repair_cases.is_locked — 출하 완료로 잠겼는가. */
  isShipmentLocked: boolean;
  /** 「과거 인수품 가져오기」(KYOSAN_INTAKE_LIST)로 들어온 건인가. */
  isLegacyImportedCase: boolean;
};

/**
 * 🔴 셋은 서로 **다른 안내**다 — 사람이 무엇을 해야 하는지가 다르기 때문이다.
 *   · 권한 없음   → 내가 할 수 있는 일이 없다. 담당 엔지니어에게 부탁한다.
 *   · 반출 이력   → 이미 요청서에 잡혔다. 여기에 적을 일이 아니다.
 *   · 잠긴 건     → 이 건이 아니라 「가져온 건」에서만 열린다.
 */
export const USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE =
  "사용 부품은 A/S 엔지니어와 관리자만 적을 수 있습니다. 담당 엔지니어에게 요청해 주세요.";

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
 * 세 규칙을 한 번에. **조회(화면에 입력 칸을 그릴지)와 저장(mutation)이 같은 이
 * 함수를 부른다** — 화면이 여는 조건과 서버가 받아 주는 조건이 어긋날 길을 두지
 * 않는다.
 *
 * ── 차례 ────────────────────────────────────────────────────────────────────
 * 🔴 역할이 **맨 앞**이다. 역할은 건이 아니라 사람의 성질이라, 적을 수 없는
 * 사람에게 「반출 이력 때문」이라고 말하면 거짓 안내가 된다 — 요청서를 지워도
 * 그 사람은 여전히 적을 수 없다. 자기가 할 수 있는 일이 무엇인지 알려면 「내
 * 권한이 아니다」가 먼저 나와야 한다.
 *
 * 그다음은 반출 이력이다. 둘 다 걸린 건에게는 「요청서가 이미 있다」가 더 쓸모
 * 있는 안내다(잠금은 풀 길이 있지만 반출 이력은 이 칸의 존재 이유 자체를 없앤다).
 */
export function resolveUsedPartsWriteGate(facts: UsedPartsWriteGateFacts): UsedPartsWriteGate {
  if (!canRoleWriteUsedParts(facts.actorRole)) {
    return {
      ok: false,
      code: "ROLE_NOT_ALLOWED",
      message: USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE,
    };
  }
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
