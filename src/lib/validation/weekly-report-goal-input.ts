import { isValidDateString } from "@/lib/domain/local/validation";
import { mondayOfDateOnly } from "@/lib/domain/weekly-report-goal";

/**
 * ============================================================================
 * 주간보고 금주 목표 입력 검증 — 형식만 본다
 * ============================================================================
 * domestic-order-input.ts 와 같은 자리의 파일이다. **DB 도 세션도 여기서 만지지
 * 않는다** — 순수 함수만 두어야 단위 테스트가 붙고, 그래야 "어떤 값을 받아들이는가"
 * 라는 규칙이 실제로 검증된다. 존재 여부(그 수리 건이 있는가)와 동시 수정(version)은
 * 자료의 문제라 mutation 이, 누가 적을 수 있는가는 정책이라 서버 액션이 맡는다.
 *
 * ── 주는 여기서 월요일로 접힌다 ─────────────────────────────────────────
 * week_start_date 에는 언제나 그 주 월요일이 들어가야 한다
 * (schema/weekly-report-goals.ts 헤더). 화면이 늘 월요일을 보낸다고 믿고 그냥
 * 넘기면, 언젠가 다른 요일이 들어와 같은 주가 두 값으로 갈리고 지난주 목록이
 * 두 벌이 된다. 그래서 **받아 들인 날짜를 거절하지 않고 접는다** — 사람이
 * 수요일을 골랐다면 뜻은 "그 주"이지 "틀렸다"가 아니다. 접는 규칙 자체는 여기
 * 적지 않고 domain 의 mondayOfDateOnly 를 부른다(두 곳에 적으면 한쪽만 고쳐진다).
 *
 * ── 목표 문장은 비울 수 없다 ────────────────────────────────────────────
 * goal_text 는 이 표에서 사람이 치는 **유일한** 값이다. 비어 있으면 그 줄은
 * `[INVENIA] D260706_...:` 로 끝나는, 아무 말도 하지 않는 줄이 된다 —
 * 비우고 싶다면 그 줄을 지우는 것이 맞다(삭제는 휴지통 없이 바로 지운다).
 *
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키는 필드명 그대로이고, 화면은 그 키로 입력칸 밑에 문장을
 * 붙인다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidWeeklyReportGoalId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * 낙관적 잠금 토큰. domestic-order-input.ts 의 같은 이름 함수와 같은 규칙이다 —
 * version 은 1부터 시작하는 정수라서 0 이하는 애초에 존재할 수 없는 값이다.
 */
export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * 목표 문장의 길이 상한.
 *
 * 원본 엑셀의 줄은 `견적서 발행`, `견적서 발행 (교산의 부품견적 대기 중)` 처럼
 * 짧다. 그래도 200자로 자르지 않는 것은, 이 칸이 이번 주에 무엇을 왜 하는지
 * 적는 유일한 자리라서 사정을 덧붙이는 줄이 실제로 생기기 때문이다. 상한이
 * 아예 없으면 잘못 만들어진 요청 하나가 상자 하나를 통째로 밀어낸다.
 */
const MAX_GOAL_TEXT = 500;

/**
 * display_order 는 integer 컬럼이다. 자바스크립트에서 통과시켜 놓고 DB 에서
 * 터지면 사용자에게는 "저장할 수 없습니다"만 보이므로 여기서 잘라 준다.
 */
const MAX_DISPLAY_ORDER = 2_147_483_647;

export type WeeklyReportGoalFields = {
  /** "YYYY-MM-DD" — **월요일로 접힌 값**이다(파일 헤더). */
  weekStartDate: string;
  /** 어느 수리 건의 목표인가. NOT NULL 이라 비울 수 없다. */
  repairCaseId: string;
  /** 사람이 치는 유일한 값. 비어 있을 수 없다. */
  goalText: string;
  /** 상자 안에서의 차례. 정하지 않으면 null 이고, 그 줄은 뒤로 간다. */
  displayOrder: number | null;
};

export type ValidateWeeklyReportGoalResult =
  | { ok: true; data: WeeklyReportGoalFields }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * "YYYY-MM-DD" 를 그 주 월요일로 접는다. 형식이 아니거나 실제로 없는 날짜면
 * null 이다 — 2026-02-31 은 형식은 맞지만 존재하지 않는 날이고, 그대로 넘기면
 * Postgres 가 22008 로 거절해 사용자에게는 이유 없는 실패만 남는다.
 *
 * 조회 쪽(주 고르기)도 이 함수로 값을 다듬는다 — 저장과 조회가 서로 다른
 * 규칙으로 주를 정하면 방금 적은 줄이 보이지 않는 화면이 만들어진다.
 */
export function normalizeWeekStart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isValidDateString(trimmed)) return null;
  return mondayOfDateOnly(trimmed);
}

export function validateWeeklyReportGoalFields(
  raw: Record<string, unknown>
): ValidateWeeklyReportGoalResult {
  const fieldErrors: Record<string, string> = {};

  // ── 주 ───────────────────────────────────────────────────────────────
  const weekStartDate = normalizeWeekStart(raw.weekStartDate);
  if (weekStartDate === null) {
    fieldErrors.weekStartDate = "주간은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.";
  }

  // ── 수리 건 연결 ─────────────────────────────────────────────────────
  // 화면에서 고르는 값이라 사람이 손으로 치지 않는다. 그래도 UUID 인지 보는
  // 이유는 이 함수가 서버 액션의 유일한 형식 관문이기 때문이다 — 실제로 그
  // 건이 있는지는 mutation 이 확인한다.
  let repairCaseId: string | null = null;
  if (!isValidWeeklyReportGoalId(raw.repairCaseId)) {
    fieldErrors.repairCaseId = "수리 건을 선택해 주세요.";
  } else {
    repairCaseId = raw.repairCaseId;
  }

  // ── 목표 문장 ────────────────────────────────────────────────────────
  let goalText: string | null = null;
  const goalTextRaw = raw.goalText;
  if (typeof goalTextRaw !== "string") {
    fieldErrors.goalText = "목표 값을 확인할 수 없습니다.";
  } else {
    const trimmed = goalTextRaw.trim();
    if (trimmed === "") {
      // 비우고 싶다면 그 줄을 지우는 것이 맞다(파일 헤더).
      fieldErrors.goalText = "목표를 입력하거나 그 줄을 지워 주세요.";
    } else if (trimmed.length > MAX_GOAL_TEXT) {
      fieldErrors.goalText = `목표는 ${MAX_GOAL_TEXT}자를 넘을 수 없습니다.`;
    } else {
      goalText = trimmed;
    }
  }

  // ── 차례 ─────────────────────────────────────────────────────────────
  // 문자열로 오는 것은 <input> 에서 온 값이기 때문이고, 숫자로 오는 것은 이미
  // 파싱된 값이 다시 들어오는 경우다(내자 정리의 순번과 같은 모양).
  let displayOrder: number | null = null;
  const displayOrderRaw = raw.displayOrder;
  if (displayOrderRaw === null || displayOrderRaw === undefined || displayOrderRaw === "") {
    displayOrder = null;
  } else {
    const parsed =
      typeof displayOrderRaw === "number"
        ? displayOrderRaw
        : typeof displayOrderRaw === "string" && /^\d+$/.test(displayOrderRaw.trim())
          ? Number(displayOrderRaw.trim())
          : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DISPLAY_ORDER) {
      fieldErrors.displayOrder = "차례는 1 이상의 정수여야 합니다.";
    } else {
      displayOrder = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    data: {
      weekStartDate: weekStartDate!,
      repairCaseId: repairCaseId!,
      goalText: goalText!,
      displayOrder,
    },
  };
}

/**
 * ── 지난주 줄 복사 ───────────────────────────────────────────────────────
 * 두 주를 받는다. 둘 다 월요일로 접히고, **같은 주끼리는 복사할 수 없다** —
 * 같은 주로 복사하면 대상에 이미 같은 수리 건이 전부 있으므로 한 건도 옮겨지지
 * 않고 "0건 복사, N건 건너뜀"만 나온다. 그 결과를 보고 사람은 무엇이 잘못됐는지
 * 알 수 없으므로, 여기서 이유를 말해 주는 편이 낫다.
 */
export type WeeklyReportGoalCopyFields = {
  fromWeekStart: string;
  toWeekStart: string;
};

export type ValidateWeeklyReportGoalCopyResult =
  | { ok: true; data: WeeklyReportGoalCopyFields }
  | { ok: false; fieldErrors: Record<string, string> };

export function validateWeeklyReportGoalCopy(
  raw: Record<string, unknown>
): ValidateWeeklyReportGoalCopyResult {
  const fieldErrors: Record<string, string> = {};

  const fromWeekStart = normalizeWeekStart(raw.fromWeekStart);
  if (fromWeekStart === null) {
    fieldErrors.fromWeekStart = "가져올 주간은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.";
  }

  const toWeekStart = normalizeWeekStart(raw.toWeekStart);
  if (toWeekStart === null) {
    fieldErrors.toWeekStart = "붙여넣을 주간은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.";
  }

  if (fromWeekStart !== null && fromWeekStart === toWeekStart) {
    fieldErrors.toWeekStart = "같은 주간으로는 복사할 수 없습니다.";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return { ok: true, data: { fromWeekStart: fromWeekStart!, toWeekStart: toWeekStart! } };
}
