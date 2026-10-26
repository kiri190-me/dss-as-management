/**
 * ============================================================================
 * 결재선 단계 위임 — 들어온 값의 **모양**만 본다
 * ============================================================================
 * DB 도 세션도 여기서 보지 않는다. 「형식이 맞나」까지가 이 층이고, 「그 사람이
 * 지금 쓸 수 있는 계정인가」·「겹치는 위임이 있나」처럼 **표를 읽어야 답할 수 있는
 * 것**은 mutation 층이 제 트랜잭션 안에서 본다(옆의 shipment-delegation-input.ts 가
 * 같은 경계로 갈라져 있다).
 *
 * 🔴 **옛 `shipment-delegation-input.ts` 를 가져다 쓰지 않고 한 벌 더 적는다.**
 * 이 저장소의 validation 묶음은 서로를 import 하지 않는 것이 관례이고(그 파일의
 * validateReasonFormat 주석), 더 중요한 것은 **두 표의 규칙이 실제로 다르다**는
 * 점이다. 아래 두 함수가 옛 쪽과 글자 하나씩 다르고, 그 차이가 전부 의도다:
 *
 *   · 사유 — 옛 쪽은 빈 값을 `null` 로 준다. 이 표의 `reason` 은 **NOT NULL
 *     DEFAULT ''** 이라(표 쪽 주석: 「안 적었다」와 「모른다」를 가를 일이 없다)
 *     여기서는 빈 글자를 준다. 옛 함수를 그대로 끌어 쓰면 `null` 이 들어가
 *     NOT NULL 위반이 되고, 그것은 사람에게 깨끗한 결과가 아니라 날것의
 *     PostgresError 로 나간다.
 *   · 기간 — 두 쪽 다 「끝이 시작보다 뒤」를 요구하지만, 이 표는 **끝을 포함하지
 *     않는다**(반열린 구간 `[starts_at, ends_at)`). 그 뜻은 판정 함수에 적혀 있고
 *     (domain/approval-route-delegation.ts) 여기서는 **받은 시각을 그대로 믿는다** —
 *     「9월 30일까지」를 10월 1일 0시로 바꾸는 일은 화면의 몫이다.
 *
 * 🔵 이름도 일부러 다르게 뒀다(`validateDelegationReason` · `validateDelegationPeriod`).
 * 돌려주는 모양이 다른 함수에 같은 이름을 붙이면, 옮겨 적는 사람이 import 줄만
 * 바꾸고 넘어가도 `tsc` 가 한동안 침묵한다.
 * ============================================================================
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 사람·위임 줄을 가리키는 열쇠는 둘 다 uuid 다. 🔴 **포털 번호(`sub`)가 아니다** —
 * 포털 번호를 넘기면 모양 검사부터 걸린다(그것이 이 함수가 여기 있는 값어치다.
 * 걸러 내지 않으면 조회는 오류 없이 영원히 0건이 된다).
 */
export function isValidUserId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

const MAX_REASON_LENGTH = 2000;

export type DelegationReasonValidationResult =
  | { ok: true; reason: string }
  | { ok: false; error: string };

/**
 * 사유. **빈 글자가 정상값**이다(선택 입력) — 널을 주지 않는다. 앞뒤 공백은 떼고,
 * 길이 상한은 이 저장소의 다른 사유 칸과 같은 2000자다.
 */
export function validateDelegationReason(value: unknown): DelegationReasonValidationResult {
  if (value === null || value === undefined) return { ok: true, reason: "" };
  if (typeof value !== "string") {
    return { ok: false, error: "사유 값을 확인할 수 없습니다." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { ok: false, error: "사유 내용이 너무 깁니다." };
  }
  return { ok: true, reason: trimmed };
}

export type DelegationPeriodValidationResult =
  | { ok: true; startsAt: Date; endsAt: Date }
  | { ok: false; error: string };

/**
 * 시작·끝을 읽어 `Date` 둘로 만든다. 🔴 **끝이 시작과 같으면 거절한다** — 끝을
 * 포함하지 않는 구간이라 `ends_at = starts_at` 인 줄은 **단 한순간도 살아 있지 않은**
 * 위임이 되고, 적은 사람은 맡겨 뒀다고 믿는다(표의 `…_valid_range` CHECK 와 같은
 * 경계다. 여기서 먼저 걸러야 CHECK 위반이 아니라 읽을 수 있는 문구로 나간다).
 *
 * 🔵 「지난 날짜를 적었나」는 보지 않는다. 이미 지나간 기간의 위임은 판정에서
 * 저절로 죽은 줄이 될 뿐이고, 사람이 지난 일을 뒤늦게 기록해 두는 것을 막을 근거가
 * 없다 — 막으려면 「지금」이 언제인지를 이 순수 층이 알아야 하는데, 그러면 같은
 * 입력이 부르는 때에 따라 다른 답을 준다.
 */
export function validateDelegationPeriod(
  startsAtInput: unknown,
  endsAtInput: unknown
): DelegationPeriodValidationResult {
  if (typeof startsAtInput !== "string" || typeof endsAtInput !== "string") {
    return { ok: false, error: "시작/종료 일시를 확인할 수 없습니다." };
  }
  const startsAt = new Date(startsAtInput);
  const endsAt = new Date(endsAtInput);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: "시작/종료 일시 형식이 올바르지 않습니다." };
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "종료 일시는 시작 일시보다 이후여야 합니다." };
  }
  return { ok: true, startsAt, endsAt };
}

/**
 * 🔴 **`OVERLAPPING_DELEGATION` 이 없다. 더하지 마라.** 옛 표는 같은 (대표, 대리인)
 * 짝의 기간이 겹치면 거절하지만, 이 표는 **겹침을 정상으로 본다**(표 머리말: 두
 * 사람이 동시에 자리를 비울 수 있고, 한 사람에게 기간을 나눠 두 번 맡길 수도 있다).
 * 겹친 줄에서 결재권자가 두 번 나오는 일은 판정 함수가 거른다. 여기에 코드를 더하고
 * mutation 에 검사를 붙이면 **정상 입력이 거절되기 시작하고**, 그 거절은 겹침을 막는
 * 제약이 표에 없으므로 코드를 읽기 전에는 까닭을 알 수 없다.
 *
 * `DELEGATION_EXPIRED` 는 **되돌리기 쪽**이다 — 이미 끝난 기간의 위임은 되돌릴 것이
 * 남아 있지 않다(mutation 쪽 주석).
 */
export type ApprovalRouteDelegationResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE"
  | "INVALID_USER"
  | "INVALID_TIME_RANGE"
  | "DELEGATION_EXPIRED";

export type ApprovalRouteDelegationResult =
  | { ok: true; id: string }
  | { ok: false; code: ApprovalRouteDelegationResultCode; message: string };
