import { normalizeWeekStart } from "./weekly-report-goal-input";

/**
 * ============================================================================
 * 주간보고 납입 예정 건 입력 검증 — 형식만 본다
 * ============================================================================
 * weekly-report-goal-input.ts 와 같은 자리·같은 방식의 파일이다. **DB 도 세션도
 * 여기서 만지지 않는다** — 순수 함수만 두어야 단위 테스트가 붙고, 그래야 "어떤
 * 값을 받아들이는가"라는 규칙이 실제로 검증된다. 존재 여부(그 수리 건이
 * 있는가)와 동시 수정(version)은 자료의 문제라 mutation 이, 누가 적을 수 있는가는
 * 정책이라 서버 액션이 맡는다.
 *
 * ── 주를 접는 규칙은 금주 목표와 **같은 함수**를 쓴다 ───────────────────
 * 두 표는 화면에서 **같은 주 고르개를 공유한다**(승인된 결정). 접는 규칙을 여기
 * 다시 적으면 언젠가 한쪽만 고쳐지고, 그날 사람이 고른 한 주가 위 상자에서는
 * 8월 24일 주, 아래 표에서는 8월 23일 주가 된다. 그래서 normalizeWeekStart 를
 * 그대로 부른다 — 이름에 goal 이 들어 있지 않은 것은 애초에 두 곳에서 쓰일 수
 * 있는 규칙이기 때문이다. isValidExpectedVersion 도 같은 이유로 함께 부른다
 * (version 은 1부터 시작하는 정수라는 규칙이 표마다 다를 이유가 없다).
 *
 * ── 비고는 비어 있어도 된다 ─────────────────────────────────────────────
 * 금주 목표의 goal_text 와 갈리는 지점이다. 그쪽은 그 문장이 곧 줄의 내용이라
 * 비울 수 없지만, 이 표의 줄은 **"이 건이 이번 주 납입 예정 목록에 있다"** 는
 * 사실 자체가 내용이고 비고는 덧붙이는 말이다. 실제 원본 엑셀에서도 이 칸은
 * 대부분 비어 있다.
 *
 * 그래서 **빈 문자열과 공백만 적힌 값은 거절하지 않고 null 로 접는다.** 비어
 * 있음의 표준형을 하나로 두는 것이 이 저장소의 규칙이고
 * (domain/weekly-report-goal.ts 의 present, domain/domestic-order-list.ts 의
 * resolveDomesticOrderValue), 그러지 않으면 화면에 보이지 않는 공백 한 칸이
 * '적힌 값'으로 남는다.
 *
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키는 필드명 그대로이고, 화면은 그 키로 입력칸 밑에 문장을
 * 붙인다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidWeeklyReportDeliveryId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** 금주 목표와 같은 규칙을 그대로 다시 내보낸다 — 서버 액션이 한 곳에서 부른다. */
export { isValidExpectedVersion } from "./weekly-report-goal-input";

/**
 * 비고의 길이 상한. 금주 목표의 목표 문장과 **같은 500자**다.
 *
 * 원본 엑셀의 비고는 `고객사 요청으로 연기` 처럼 짧지만, 사정을 덧붙이는 줄이
 * 실제로 생긴다. 상한이 아예 없으면 잘못 만들어진 요청 하나가 표 하나를 통째로
 * 밀어낸다.
 */
const MAX_NOTE = 500;

/**
 * display_order 는 integer 컬럼이다. 자바스크립트에서 통과시켜 놓고 DB 에서
 * 터지면 사용자에게는 "저장할 수 없습니다"만 보이므로 여기서 잘라 준다.
 */
const MAX_DISPLAY_ORDER = 2_147_483_647;

export type WeeklyReportDeliveryFields = {
  /** "YYYY-MM-DD" — **월요일로 접힌 값**이다(파일 헤더). */
  weekStartDate: string;
  /** 어느 수리 건인가. NOT NULL 이라 비울 수 없다. */
  repairCaseId: string;
  /** 사람이 치는 유일한 값. **비어 있어도 되고, 비면 null 이다**(파일 헤더). */
  note: string | null;
  /** 표 안에서의 차례. 정하지 않으면 null 이고, 그 줄은 뒤로 간다. */
  displayOrder: number | null;
};

export type ValidateWeeklyReportDeliveryResult =
  | { ok: true; data: WeeklyReportDeliveryFields }
  | { ok: false; fieldErrors: Record<string, string> };

export function validateWeeklyReportDeliveryFields(
  raw: Record<string, unknown>
): ValidateWeeklyReportDeliveryResult {
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
  if (!isValidWeeklyReportDeliveryId(raw.repairCaseId)) {
    fieldErrors.repairCaseId = "수리 건을 선택해 주세요.";
  } else {
    repairCaseId = raw.repairCaseId;
  }

  // ── 비고 ─────────────────────────────────────────────────────────────
  // 없는 값(null·undefined)과 빈 값(""·공백)은 **같은 뜻**이고, 표준형은 null 이다.
  let note: string | null = null;
  const noteRaw = raw.note;
  if (noteRaw === null || noteRaw === undefined) {
    note = null;
  } else if (typeof noteRaw !== "string") {
    fieldErrors.note = "비고 값을 확인할 수 없습니다.";
  } else {
    const trimmed = noteRaw.trim();
    if (trimmed === "") {
      note = null;
    } else if (trimmed.length > MAX_NOTE) {
      fieldErrors.note = `비고는 ${MAX_NOTE}자를 넘을 수 없습니다.`;
    } else {
      note = trimmed;
    }
  }

  // ── 차례 ─────────────────────────────────────────────────────────────
  // 문자열로 오는 것은 <input> 에서 온 값이기 때문이고, 숫자로 오는 것은 이미
  // 파싱된 값이 다시 들어오는 경우다(금주 목표의 순번과 같은 모양).
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
      note,
      displayOrder,
    },
  };
}
