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
 * ── 🔴 규칙 0 — 「역할별 접근 권한」 설정이 정한다 (2026-09-17 사용자 확정) ──
 * 누가 적을 수 있는지는 **설정 노드 `repairCases.usedParts` 가 쓰기(WRITE)인가**
 * 하나로 정해진다. 최고관리자가 [사용자 관리] → [역할별 접근 권한] 에서 바꾼다.
 *
 * 기본값은 종전 목록 그대로다(permission-baseline.ts 의 같은 키):
 *   · SUPER_ADMIN · ADMIN · AS_ENGINEER → 쓰기
 *   · SALES · INVENTORY_MANAGER        → 없음
 *
 * 그 기본값의 까닭: 「무엇을 갈았나」는 수리 내용이라 AS_ENGINEER 가 신고증상 ·
 * 외관 상태를 적는 자리와 같다. SALES 는 고객 · 날짜 · 연락처 담당이고,
 * INVENTORY_MANAGER 는 수리건에서 읽기 전용이다(부품 반출 이력 쪽으로 이미 기록에
 * 참여한다). **달라진 것은 그 목록을 바꿀 수 있는 사람이다** — 개발자가 코드를
 * 고치지 않아도 된다.
 *
 * 🔴 왜 이 칸은 설정으로 옮길 수 있고 접수 건 수정은 못 옮기는가 —
 * 그쪽 정책(EDITABLE_FIELDS_BY_ROLE)은 **칸 이름 단위**라 NONE·READ·WRITE·MANAGE
 * 네 단계에 접히지 않는다(영업은 접수 정보는 고치는데 제품 정보는 못 고친다).
 * 사용 부품은 「쓴다 / 못 쓴다」 하나뿐이라 그 사다리에 그대로 들어간다.
 *
 * 🔴 **이 파일에 「적을 수 있는 역할」 목록이 한 줄도 없다.** (거절 문구가 요청을
 * 받을 곳으로 「관리자」를 부르는 것은 판정이 아니다 — 그 상수의 주석을 보라.)
 * 코드 목록과 설정을 둘 다 보게 두면
 * 권한 설정 화면이 「넓히면 실제로 열립니다」라고 **거짓말을 한다**
 * (permission-features.ts 의 SETTINGS_ENFORCED_LEAVES 주석에 적힌 그 함정 —
 * 주간보고 · 내자 정리가 그래서 그 집합에서 빠져 있었다). 그래서 아래 판정 함수는
 * **이미 판정된 불리언 하나**(`canWriteUsedParts`)만 받는다.
 *
 * 🔴 이 파일 안에서 hasPermission 을 부르지 않는다 — 비동기 · DB 라서 순수 함수가
 * 깨진다. 부르는 쪽(조회 · 저장)이 부르고 그 답만 넘긴다.
 *
 * 🔴 `isDeveloper` 승격은 이제 **닿는다.** 이 칸이 설정이 최종 판정인 가족에
 * 들어왔기 때문이다 — 승격은 permission-resolver.ts 한 곳에서만 일어나고, 부르는
 * 쪽이 역할이 아니라 **사람**(PermissionActor)을 넘기므로 저절로 따라온다.
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

/**
 * 적을 수 없는 까닭. 서버 액션이 그대로 결과 코드로 쓴다.
 *
 * 🔴 `ROLE_NOT_ALLOWED` 라는 이름은 판정이 설정으로 옮겨 온 뒤에도 그대로 둔다 —
 * 뜻은 처음부터 「이 사람에게는 이 칸의 권한이 없다」였고, 그 뜻이 달라지지 않았다.
 * 이름만 바꾸면 화면 · 액션 · 시험 세 곳의 결과 코드가 함께 흔들릴 뿐이다.
 */
export type UsedPartsWriteBlockCode =
  | "ROLE_NOT_ALLOWED"
  | "PART_REQUEST_HISTORY_EXISTS"
  | "CASE_LOCKED";

export type UsedPartsWriteGate =
  | { ok: true }
  | { ok: false; code: UsedPartsWriteBlockCode; message: string };

/**
 * 판정의 재료. 넷 다 **서버가 읽은 사실**이다 — 화면이 보낸 값이 하나도 없다
 * (화면이 스스로 판정하면 판정이 두 벌이 된다).
 */
export type UsedPartsWriteGateFacts = {
  /**
   * 🔴 이 사람이 `repairCases.usedParts` 를 쓰기 이상으로 갖고 있는가 —
   * **이미 내려진 판정**이다(hasPermission 의 답). 이 파일은 그 답을 받기만 한다.
   *
   * 부르는 쪽은 살아 있는 계정에서 읽은 사람으로 물어야 한다(세션 토큰의 역할이
   * 아니다 — auth/acting-user.ts 머리말). 계정을 읽지 못했으면 false 를 넘긴다 —
   * 닫히는 쪽으로 떨어뜨리는 것이 그 자리의 규칙이다.
   */
  canWriteUsedParts: boolean;
  /** 이 건에 살아 있는 부품 요청(반출) 줄이 있는가. REJECTED · CANCELLED 는 치지 않는다. */
  hasPartRequestHistory: boolean;
  /** repair_cases.is_locked — 출하 완료로 잠겼는가. */
  isShipmentLocked: boolean;
  /** 「과거 인수품 가져오기」(KYOSAN_INTAKE_LIST)로 들어온 건인가. */
  isLegacyImportedCase: boolean;
};

/**
 * 🔴 셋은 서로 **다른 안내**다 — 사람이 무엇을 해야 하는지가 다르기 때문이다.
 *   · 권한 없음   → 내가 할 수 있는 일이 없다. 권한을 쥔 관리자에게 부탁한다.
 *   · 반출 이력   → 이미 요청서에 잡혔다. 여기에 적을 일이 아니다.
 *   · 잠긴 건     → 이 건이 아니라 「가져온 건」에서만 열린다.
 */

/**
 * 🔴 **이 문구에 역할 이름을 적지 않는다** (2026-09-17 사용자 확정).
 *
 * 예전 문구는 「사용 부품은 A/S 엔지니어와 관리자만 적을 수 있습니다. 담당
 * 엔지니어에게 요청해 주세요.」였다. 그 목록이 코드에 박혀 있던 동안에는 맞는
 * 말이었지만, 이 칸의 판정이 [사용자 관리] → [역할별 접근 권한] 설정으로 옮겨 온
 * 뒤로는 **최고관리자가 영업에게 열어 주는 순간 그 문장이 거짓말이 된다.**
 * 화면은 이 상수 하나를 그대로 보여 주므로, 설정을 바꾼 사람이 아니라 거절당한
 * 사람이 그 거짓말을 읽는다.
 *
 * 요청할 곳도 달라진다 — 열어 줄 수 있는 사람은 「담당 엔지니어」가 아니라
 * **권한 설정을 쥔 관리자**다. 그래서 문장 뒤쪽의 「관리자」는 *적을 수 있는 역할*이
 * 아니라 **요청을 받을 사람**을 가리킨다. 앞쪽(누가 적을 수 있는가를 말하는 자리)에는
 * 역할 이름이 하나도 없어야 하고, 그것을 시험이 roleLabels 전체로 못 박는다
 * (repair-case-used-parts-authorization.test.ts — 선례는
 *  domain/quote-document-support.test.ts 의 「거절 문장에 종류 이름을 적지 않는다」).
 */
export const USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE =
  "권한이 없습니다. 관리자에게 요청해 주세요.";

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
 * 🔴 권한이 **맨 앞**이다. 권한은 건이 아니라 사람의 성질이라, 적을 수 없는
 * 사람에게 「반출 이력 때문」이라고 말하면 거짓 안내가 된다 — 요청서를 지워도
 * 그 사람은 여전히 적을 수 없다. 자기가 할 수 있는 일이 무엇인지 알려면 「내
 * 권한이 아니다」가 먼저 나와야 한다.
 *
 * 그다음은 반출 이력이다. 둘 다 걸린 건에게는 「요청서가 이미 있다」가 더 쓸모
 * 있는 안내다(잠금은 풀 길이 있지만 반출 이력은 이 칸의 존재 이유 자체를 없앤다).
 */
export function resolveUsedPartsWriteGate(facts: UsedPartsWriteGateFacts): UsedPartsWriteGate {
  if (!facts.canWriteUsedParts) {
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
