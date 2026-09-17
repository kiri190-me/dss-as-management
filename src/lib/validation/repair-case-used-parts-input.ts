/**
 * ============================================================================
 * 「사용 부품」 칸에 들어오는 값 검사 (B-2)
 * ============================================================================
 * 층을 셋으로 나눈 그 첫 층이다 — 검사(이 파일) → 서버 액션
 * (server/actions/repair-case-used-parts.ts) → 저장
 * (db/mutations/repair-case-used-parts.ts). repair-case-work-record-input.ts 가
 * 같은 모양의 선례다.
 *
 * 여기서는 **모양만** 본다. 「이 건에 적을 수 있는가」(반출 이력 · 출하 잠금)는
 * DB 를 봐야 알 수 있으므로 auth/repair-case-used-parts-authorization.ts 와
 * mutation 이 맡는다.
 *
 * ── 🔴 line_no 를 아예 읽지 않는다 ──────────────────────────────────────────
 * 줄 번호는 **서버가 매긴다** — 화면이 늘어놓은 차례가 곧 번호이고, 그 번호는
 * mutation 이 배열 index + 1 로 붙인다(quote_items 와 같은 방식). 그래서 이
 * 검사기는 들어온 줄에 `lineNo` 가 있어도 쳐다보지 않고, 돌려주는 줄에도 그
 * 칸이 없다. 화면이 보낸 번호를 믿을 길 자체를 두지 않는 것이 뜻이다.
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 이 모듈만의 UUID 검사 사본 — 이 저장소의 관례다
 * (repair-case-work-record-input.ts · workflow-transition-input.ts 도 각자 한
 * 벌씩 갖고 있고 서로 가져다 쓰지 않는다).
 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidRepairCaseId(value: unknown): value is string {
  return isValidUuid(value);
}

/** repair-case-update-input.ts 의 같은 이름 검사와 같은 규칙(양의 정수). */
export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * 한 건에 넣을 수 있는 줄 수. quote-input.ts 의 MAX_QUOTE_ITEMS 와 같은 값이지만
 * 각 검사 모듈이 자기 한도를 갖는 이 저장소의 관례대로 따로 적는다.
 */
export const MAX_USED_PART_LINES = 50;

/** 품명 길이 — quote-input.ts 의 MAX_SHORT_TEXT 와 같은 값이다. */
const MAX_PART_NAME_LENGTH = 200;

/** integer 칼럼의 상한. 넘으면 DB 가 22003 으로 터지므로 여기서 먼저 세운다. */
const MAX_QUANTITY = 2_147_483_647;

/**
 * 검사를 통과한 한 줄. **줄 번호가 없다**(위 머리말) — 차례는 이 배열의 차례다.
 */
export type UsedPartLineInput = {
  /**
   * 부품 마스터에서 고른 것. **null 이 정상이다** — 마스터에 없는 부품은 글자로만
   * 적는다(schema/repair-case-used-parts.ts 머리말).
   */
  partId: string | null;
  partNameText: string;
  quantity: number;
};

export type UsedPartLinesValidationResult =
  | { ok: true; lines: UsedPartLineInput[] }
  | { ok: false; fieldErrors: Record<string, string>; message: string };

/**
 * 줄 목록을 통째로 본다.
 *
 * 🔴 **빈 목록은 정상이다** — 잘못 적은 줄을 모두 지우는 것이 곧 「빈 목록 저장」
 * 이기 때문이다. 「변경할 내용이 없다」로 막으면 마지막 줄을 지울 길이 없어진다.
 *
 * 오류는 줄마다 모아서 한 번에 돌려준다(quote-input.ts 의 normalizeItems 와 같은
 * 모양) — 첫 오류에서 멈추면 세 줄이 잘못됐을 때 세 번 저장해 봐야 한다.
 */
export function validateUsedPartLines(value: unknown): UsedPartLinesValidationResult {
  if (!Array.isArray(value)) {
    return { ok: false, fieldErrors: { lines: "사용 부품 목록을 확인할 수 없습니다." }, message: "입력값을 확인해 주세요." };
  }
  if (value.length > MAX_USED_PART_LINES) {
    return {
      ok: false,
      fieldErrors: { lines: `사용 부품은 ${MAX_USED_PART_LINES}줄까지 적을 수 있습니다.` },
      message: "입력값을 확인해 주세요.",
    };
  }

  const fieldErrors: Record<string, string> = {};
  const lines: UsedPartLineInput[] = [];

  value.forEach((entry, index) => {
    const at = (field: string) => `lines.${index}.${field}`;
    const ordinal = index + 1;

    if (typeof entry !== "object" || entry === null) {
      fieldErrors[`lines.${index}`] = `${ordinal}번째 줄을 확인할 수 없습니다.`;
      return;
    }
    const row = entry as Record<string, unknown>;

    const name = typeof row.partNameText === "string" ? row.partNameText.trim() : "";
    if (name === "") {
      fieldErrors[at("partNameText")] = `${ordinal}번째 줄의 품명을 입력해 주세요.`;
    } else if (name.length > MAX_PART_NAME_LENGTH) {
      fieldErrors[at("partNameText")] = `${ordinal}번째 줄의 품명은 ${MAX_PART_NAME_LENGTH}자를 넘을 수 없습니다.`;
    }

    // DB CHECK 가 quantity > 0 이다. 여기서 걸러야 사람이 까닭을 안다.
    const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      fieldErrors[at("quantity")] = `${ordinal}번째 줄의 수량은 1 이상의 정수여야 합니다.`;
    }

    // 고르면 붙고, 손으로 적으면 null 이다. ""·undefined 도 「안 골랐다」로 읽는다.
    let partId: string | null = null;
    if (row.partId !== null && row.partId !== undefined && row.partId !== "") {
      if (!isValidUuid(row.partId)) {
        fieldErrors[at("partId")] = `${ordinal}번째 줄의 부품 연결을 확인할 수 없습니다.`;
      } else {
        partId = row.partId;
      }
    }

    // 🔴 row.lineNo 는 읽지 않는다 — 번호는 서버가 매긴다(머리말).
    lines.push({ partId, partNameText: name, quantity });
  });

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors, message: "입력값을 확인해 주세요." };
  }
  return { ok: true, lines };
}

export type SaveRepairCaseUsedPartsResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  /** 🔴 이 역할은 사용 부품을 적을 수 없다(auth/repair-case-used-parts-authorization.ts). */
  | "ROLE_NOT_ALLOWED"
  | "PART_REQUEST_HISTORY_EXISTS"
  | "CASE_LOCKED"
  | "INVALID_PART"
  | "DATABASE_UNAVAILABLE";

/** 저장이 끝나면 새 버전과 저장된 줄을 그대로 돌려준다 — 화면이 다시 물어보지 않아도 되게. */
export type SaveRepairCaseUsedPartsResult =
  | { ok: true; version: number; lines: { lineNo: number; partId: string | null; partNameText: string; quantity: number }[] }
  | {
      ok: false;
      code: SaveRepairCaseUsedPartsResultCode;
      message: string;
      fieldErrors?: Record<string, string>;
    };
