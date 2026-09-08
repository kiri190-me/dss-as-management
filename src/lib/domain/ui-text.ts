import {
  exceptionStatusLabels,
  EXCEPTION_STATUS_CODES,
  priorityLabels,
  repairStatusLabels,
  roleLabels,
  workHistoryTypeLabels,
  workRecordKindLabels,
  workflowTypeLabels,
  accountApprovalStatusLabels,
  type AccountApprovalStatus,
  type ExceptionStatus,
  type Priority,
  type RepairStatus,
  type Role,
  type WorkHistoryType,
  type WorkRecordKind,
  type WorkflowType,
} from "./types";
import {
  normalizeUiTextValue,
  resolveUiText,
  type ResolvedUiText,
  type UiTextOverrideRow,
} from "./ui-text-overrides";

/**
 * ============================================================================
 * 화면이 실제로 읽는 문구 한 벌
 * ============================================================================
 * 등록부(ui-text-overrides.ts)는 "바꿀 수 있는 문구가 무엇인지"를 적어 둔
 * 목록이고, 이 파일은 **화면이 그리는 순간 읽는 값**이다. 둘을 나눈 이유는
 * 모양이 다르기 때문이다 — 등록부는 사람이 편집기에서 훑을 목록(배열)이고,
 * 화면이 원하는 것은 `uiText.role[user.role]` 처럼 **코드 하나를 문구 하나로
 * 바꾸는 표**다. 등록부를 그대로 화면에 내려보내면 읽는 자리마다 find 를
 * 돌리게 되고, 그러면 이름표 하나 그리는 데 목록 전체를 훑는다.
 *
 * ── 🔴 저장된 문구가 없으면 코드의 기본값과 **글자 하나까지 같다** ──────
 * 이 축의 첫 배포는 "아무것도 안 바뀐 것"이 정답이다. 표가 아직 없거나(마이
 * 그레이션 전) 행이 0이면 DEFAULT_UI_TEXT 와 완전히 같은 값이 나와야 하고,
 * 그 사실을 ui-text.test.ts 가 42문구를 **값으로** 단언해 지킨다. 그 시험이
 * 깨진다면 화면 문구가 조용히 바뀌었다는 뜻이다.
 *
 * ── 🔴 유·무상 구분(billingType)은 여기 없다 ────────────────────────────
 * 등록부에는 8묶음이 담겨 있는데 이 표에는 7묶음(+예외 상태)뿐이다.
 * billingTypeLabels 는 **접수 알림 메일 본문에도 나가기 때문**이다
 * (domain/intake-mail-body.ts). 화면만 바꿀 수 있게 열어 두면 화면과 메일이
 * 서로 다른 말을 하게 되고, 그 어긋남은 고객에게 먼저 보인다 — 2026-09-08
 * 사용자 결정으로 이 문구는 **코드 표를 그대로 읽는다.** 타입에 넣지 않은
 * 것이 그 결정을 지키는 장치다: 여기 없으면 실수로 읽을 수도 없다.
 *
 * ── 제품 구분(productCategory)도 여기 없다 ──────────────────────────────
 * 그 표는 문구 값이 곧 비교값이라 바꾸면 필터가 조용히 깨진다
 * (types.ts 의 PRODUCT_CATEGORY_OPTIONS 주석 참조).
 *
 * ── 예외 상태만 출처가 다르다 ───────────────────────────────────────────
 * exceptionStatus 는 ui_text_overrides 가 아니라 **DB 의 exception_statuses
 * 표(code·label)** 에서 온다. 그 표가 이미 있고 9행이 들어 있는데 화면 셋이
 * 여전히 코드 표를 읽고 있어 진실이 둘이었다 — 그 이중 진실을 여기서 닫는다.
 * 코드 표(exceptionStatusLabels)는 지우지 않고 **기본값·되돌림용**으로 남는다:
 * DB 에 그 코드의 행이 없거나(다른 개발자 PC, 마이그레이션 전) 값이 비어 있을
 * 때 이름표가 사라지면 안 된다.
 * ============================================================================
 */

/** exception_statuses 표에서 읽어 온 한 줄. 이 축이 쓰는 두 칸만 담는다. */
export type ExceptionStatusLabelRow = { code: string; label: string };

/**
 * 화면이 읽는 문구 한 벌.
 *
 * 묶음 키는 등록부의 group_key 와 같고, 안쪽 키는 types.ts 의 코드다 — 그래서
 * `roleLabels[x]` 였던 자리가 `uiText.role[x]` 가 된다. 코드 표를 그대로 두고
 * **읽는 통로만** 바꾸는 것이 이 축의 전부다.
 */
export type UiText = {
  role: Record<Role, string>;
  accountApprovalStatus: Record<AccountApprovalStatus, string>;
  workflowType: Record<WorkflowType, string>;
  repairStatus: Record<RepairStatus, string>;
  priority: Record<Priority, string>;
  workHistoryType: Record<WorkHistoryType, string>;
  workRecordKind: Record<WorkRecordKind, string>;
  /** 출처가 DB 의 exception_statuses.label 이다(위 주석 참조). */
  exceptionStatus: Record<ExceptionStatus, string>;
};

/**
 * 저장된 것이 하나도 없을 때의 값 — types.ts 의 표를 그대로 복사한 것이다.
 *
 * 🔴 문구를 여기 손으로 다시 적지 않는다. 등록부가 기본값을 types.ts 에서
 * 가져오는 것과 같은 근거다: 두 벌로 적으면 types.ts 를 손보는 날 "되돌렸는데
 * 옛 문구가 나온다"가 된다.
 *
 * 얕은 복사(전개)를 하는 이유는 이 객체가 클라이언트로 내려가 여러 화면이
 * 공유하기 때문이다 — types.ts 의 표 자체를 그대로 넘기면 누군가 이 객체를
 * 건드렸을 때 코드의 기본값까지 함께 바뀐다.
 */
export const DEFAULT_UI_TEXT: UiText = {
  role: { ...roleLabels },
  accountApprovalStatus: { ...accountApprovalStatusLabels },
  workflowType: { ...workflowTypeLabels },
  repairStatus: { ...repairStatusLabels },
  priority: { ...priorityLabels },
  workHistoryType: { ...workHistoryTypeLabels },
  workRecordKind: { ...workRecordKindLabels },
  exceptionStatus: { ...exceptionStatusLabels },
};

const EXCEPTION_STATUS_CODE_SET: ReadonlySet<string> = new Set(EXCEPTION_STATUS_CODES);

/**
 * 등록부의 묶음 하나를 그 묶음의 코드 타입으로 좁힌다.
 *
 * resolveUiText 는 등록부에 있는 묶음을 **언제나** 채워서 돌려주므로(그 사실은
 * ui-text-overrides.test.ts 가 단언한다) 여기서 빈 자리를 만날 일이 없다.
 * 단언(as)을 이 한 자리에만 모아 둔 이유는, 어긋나는 날 ui-text.test.ts 의
 * 42문구 단언이 값으로 잡게 하려는 것이다 — 단언을 읽는 자리마다 흩어 놓으면
 * 어느 자리가 거짓말을 했는지 알 수 없다.
 */
function textsOf<Code extends string>(resolved: ResolvedUiText, groupKey: string): Record<Code, string> {
  return resolved[groupKey] as Record<Code, string>;
}

/**
 * DB 의 예외 상태 문구를 코드 표 위에 얹는다.
 *
 * 🔴 모르는 코드는 **무시한다(거절이 아니라).** 관리자가 exception_statuses 에
 * 새 행을 넣어도 types.ts 의 ExceptionStatus 에 없으면 이 앱은 그 상태를 화면에
 * 띄울 길이 자체가 없다 — 그 한 줄 때문에 나머지 아홉 개까지 못 그리면 손해가
 * 훨씬 크다. 값 검증(normalizeUiTextValue)을 한 번 더 통과시키는 것도 같은
 * 이유다: 손으로 고친 행에 줄바꿈이 섞이면 배지가 두 줄이 되어 그 줄만 무너진다.
 *
 * is_active 는 보지 않는다. 꺼 둔 예외 상태라도 **이미 그 값을 가진 접수 건**은
 * 화면에 남아 있고, 그때 이름표가 사라지면 "-" 만 보인다.
 */
function resolveExceptionStatusText(
  rows: readonly ExceptionStatusLabelRow[]
): Record<ExceptionStatus, string> {
  const texts: Record<ExceptionStatus, string> = { ...exceptionStatusLabels };

  for (const row of rows) {
    if (!EXCEPTION_STATUS_CODE_SET.has(row.code)) continue;

    const value = normalizeUiTextValue(row.label);
    if (value === null) continue;

    texts[row.code as ExceptionStatus] = value;
  }

  return texts;
}

/**
 * 저장된 것들을 코드의 기본값 위에 얹어 화면이 읽을 한 벌을 만든다.
 *
 * 돌려주는 것은 **평범한 객체**다 — 함수도 Map 도 Symbol 도 들어 있지 않다.
 * 서버가 만든 이 값이 그대로 Provider 를 통해 클라이언트로 내려가야 하므로
 * 직렬화 가능해야 한다.
 *
 * 두 인자를 모두 비워 부르면 DEFAULT_UI_TEXT 와 같은 값이 나온다 — 마이그레이션
 * 전 DB, 로컬 데모 모드, 표가 비어 있는 첫 배포가 전부 그 경로다.
 */
export function buildUiText(
  overrides: readonly UiTextOverrideRow[],
  exceptionStatusRows: readonly ExceptionStatusLabelRow[]
): UiText {
  const resolved = resolveUiText(overrides);

  return {
    role: textsOf<Role>(resolved, "role"),
    accountApprovalStatus: textsOf<AccountApprovalStatus>(resolved, "accountApprovalStatus"),
    workflowType: textsOf<WorkflowType>(resolved, "workflowType"),
    repairStatus: textsOf<RepairStatus>(resolved, "repairStatus"),
    priority: textsOf<Priority>(resolved, "priority"),
    workHistoryType: textsOf<WorkHistoryType>(resolved, "workHistoryType"),
    workRecordKind: textsOf<WorkRecordKind>(resolved, "workRecordKind"),
    exceptionStatus: resolveExceptionStatusText(exceptionStatusRows),
  };
}
