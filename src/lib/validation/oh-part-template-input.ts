/**
 * ============================================================================
 * O/H 부품 템플릿 입력 검증 — 형식만 본다
 * ============================================================================
 * quote-input.ts 와 같은 자리, 같은 규칙이다. DB 도 세션도 여기서 만지지 않는다.
 *
 * ── 부품 줄 수의 상한이 양식에서 온다 ───────────────────────────────────
 * OH 견적서 양식의 `2) OH 부품 비용` 칸은 34~46행 **13줄**이다. 그보다 많이
 * 담아 두면 견적서를 만들 때 넘치는 줄이 갈 곳이 없다 — 그때 조용히 자르면
 * 청구해야 할 부품이 문서에서 사라지므로, **여기서 미리 막는다.**
 * (xlsx/oh-quote-template.ts 도 넘치면 던진다. 두 곳이 같은 수를 본다.)
 * ============================================================================
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidOhTemplateId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** OH 견적서 양식의 OH 부품 칸(34~46행). 위 '상한이 양식에서 온다' 참조. */
export const MAX_OH_TEMPLATE_ITEMS = 13;

const MAX_CODE = 40;
const MAX_NAME = 100;
const MAX_PART_NAME = 200;
const MAX_NOTE = 1000;
const MAX_QUANTITY = 2_147_483_647;

export type OhTemplateItemInput = {
  partId: string | null;
  partNameText: string;
  quantity: number;
};

export type OhTemplateFields = {
  code: string;
  name: string;
  note: string | null;
  items: OhTemplateItemInput[];
};

export type ValidateOhTemplateResult =
  | { ok: true; data: OhTemplateFields }
  | { ok: false; fieldErrors: Record<string, string> };

export function validateOhTemplateFields(raw: Record<string, unknown>): ValidateOhTemplateResult {
  const fieldErrors: Record<string, string> = {};

  function required(key: string, label: string, max: number): string {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") {
      fieldErrors[key] = `${label}을(를) 입력해 주세요.`;
      return "";
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
      fieldErrors[key] = `${label}은(는) ${max}자를 넘을 수 없습니다.`;
      return "";
    }
    return trimmed;
  }

  const code = required("code", "기종 코드", MAX_CODE);
  const name = required("name", "이름", MAX_NAME);

  let note: string | null = null;
  const rawNote = raw.note;
  if (typeof rawNote === "string" && rawNote.trim() !== "") {
    if (rawNote.trim().length > MAX_NOTE) fieldErrors.note = `비고는 ${MAX_NOTE}자를 넘을 수 없습니다.`;
    else note = rawNote.trim();
  }

  const items: OhTemplateItemInput[] = [];
  const rawItems = raw.items;
  if (rawItems !== null && rawItems !== undefined) {
    if (!Array.isArray(rawItems)) {
      fieldErrors.items = "부품 목록을 확인할 수 없습니다.";
    } else if (rawItems.length > MAX_OH_TEMPLATE_ITEMS) {
      // 양식의 칸이 13줄이다. 넘치면 견적서에서 갈 곳이 없다(파일 머리말).
      fieldErrors.items = `OH 견적서 양식의 부품 칸이 ${MAX_OH_TEMPLATE_ITEMS}줄이라 그보다 많이 담을 수 없습니다.`;
    } else {
      rawItems.forEach((entry, index) => {
        const at = (field: string) => `items.${index}.${field}`;
        const line = index + 1;
        if (typeof entry !== "object" || entry === null) {
          fieldErrors[`items.${index}`] = `${line}번째 줄을 확인할 수 없습니다.`;
          return;
        }
        const row = entry as Record<string, unknown>;

        const partNameText = typeof row.partNameText === "string" ? row.partNameText.trim() : "";
        if (partNameText === "") fieldErrors[at("partNameText")] = `${line}번째 부품의 품명을 입력해 주세요.`;
        else if (partNameText.length > MAX_PART_NAME) {
          fieldErrors[at("partNameText")] = `${line}번째 부품의 품명은 ${MAX_PART_NAME}자를 넘을 수 없습니다.`;
        }

        const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
          fieldErrors[at("quantity")] = `${line}번째 부품의 수량은 1 이상의 정수여야 합니다.`;
        }

        let partId: string | null = null;
        if (row.partId !== null && row.partId !== undefined && row.partId !== "") {
          if (!isValidOhTemplateId(row.partId)) {
            fieldErrors[at("partId")] = `${line}번째 부품의 재고 연결을 확인할 수 없습니다.`;
          } else partId = row.partId as string;
        }

        items.push({ partId, partNameText, quantity });
      });
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { code, name, note, items } };
}
