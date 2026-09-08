import {
  findUiTextGroup,
  findUiTextItem,
  hasForbiddenUiTextCharacter,
  normalizeUiTextValue,
  UI_TEXT_MAX_LENGTH,
  type UiTextGroup,
  type UiTextItem,
} from "@/lib/domain/ui-text-overrides";

/**
 * ============================================================================
 * 화면 문구 입력 검증 — 형식만 본다
 * ============================================================================
 * ui-theme-token-input.ts · part-minimum-quantity-input.ts 와 같은 자리다.
 * **DB 도 세션도 여기서 만지지 않는다** — 순수 함수만 두어야 단위 테스트가 붙고,
 * 그래야 "어떤 문구를 받아들이는가"라는 규칙이 실제로 검증된다. 누가 적을 수
 * 있는가(인가)는 자료를 봐야 알 수 있으므로 mutation 이 맡는다.
 *
 * ── 🔴 모르는 것은 무시하지 않고 거절한다 ───────────────────────────────
 * notification-settings.ts 는 등록되지 않은 알림 종류를 조용히 무시한다. 여기서는
 * **반대로 간다.** 까닭은 화면이 보내는 것의 성격이 다르기 때문이다 — 알림 설정
 * 화면은 목록을 통째로 되보내므로, 그중 한 줄이 등록부에서 사라졌다고 저장 전체가
 * 실패하면 화면을 쓸 수 없다. 반면 문구 편집기는 **사람이 만진 것만** 보낸다.
 * 그 몇 줄 중 하나를 여기서 조용히 버리면 "저장했는데 화면이 안 바뀐다"가 되고,
 * 관리자에게 그것은 고장과 구별되지 않는다 — 되돌리려고 같은 값을 몇 번 더
 * 저장하게 되고, 그래도 아무 일도 일어나지 않는다.
 *
 * 읽기 쪽 resolveUiText 가 모르는 키를 **무시하는** 것은 이와 모순이 아니다.
 * 저쪽의 요구는 다르다 — "등록부에서 문구를 뺀 날, DB 에 남은 옛 행 하나 때문에
 * 그 문구를 쓰는 모든 화면이 멈추면 안 된다". 들어오는 값(여기)은 좁게 받고,
 * 이미 저장된 값(저쪽)은 너그럽게 흘려보낸다.
 *
 * ── 받아들이는 값 ───────────────────────────────────────────────────────
 *   · groupKey — 등록부(UI_TEXT_GROUPS)에 있는 묶음 키만
 *   · itemKey  — **그 묶음 안에** 있는 항목 키만
 *   · value    — normalizeUiTextValue 를 지나는 문자열, 또는 null(기본값 복귀)
 *
 * value 가 `undefined` 인 것은 받지 않는다. 되돌리려는 뜻이면 `null` 을 명시해야
 * 한다 — 칸을 빠뜨린 요청과 되돌리려는 요청이 같은 모양이면, 화면의 버그 하나가
 * 조용히 오버라이드를 지우는 조작이 된다(ui-theme-token-input.ts 와 같은 판단).
 * ============================================================================
 */

/** 서버 액션과 mutation 이 주고받는 입력 한 줄. */
export type UiTextOverrideChange = {
  groupKey: string;
  itemKey: string;
  /** null 이면 코드의 기본 문구로 되돌린다(= 저장된 행을 지운다). */
  value: string | null;
};

/** 검증을 지난 한 줄. 값은 이미 정규화돼 있다. */
export type CheckedUiTextOverrideChange = {
  group: UiTextGroup;
  item: UiTextItem;
  /** 정규화된 문구. null 이면 기본값 복귀. */
  value: string | null;
};

export type CheckUiTextOverrideChangeResult =
  | { ok: true; change: CheckedUiTextOverrideChange }
  | { ok: false; message: string };

export type ValidateUiTextOverrideChangesResult =
  | { ok: true; data: CheckedUiTextOverrideChange[] }
  | { ok: false; message: string };

/**
 * 오류 문장에 되싣는 값의 길이 한계. 화면이 보낸 것이 아니라 손으로 만든 요청일
 * 때 여기 들어오는 문자열은 얼마든지 길 수 있고, 그것을 통째로 되돌려주면 오류
 * 상자가 화면을 밀어낸다.
 */
const ECHO_LIMIT = 40;

function echo(raw: unknown): string {
  const text = typeof raw === "string" ? raw : String(raw);
  return text.length > ECHO_LIMIT ? `${text.slice(0, ECHO_LIMIT)}…` : text;
}

/**
 * 한 줄분의 검증.
 *
 * mutation 이 트랜잭션 안에서 **한 줄씩** 부른다(그래서 앞줄이 이미 저장된 뒤에
 * 뒷줄이 막히는 길이 실제로 열리고, 그때 트랜잭션째 되돌아가는 것이 통합 시험의
 * 확인 대상이다). 서버 액션은 아래의 배열 단위 함수로 같은 규칙을 한 번 먼저
 * 본다 — 규칙 자체는 이 함수 하나에만 있다.
 */
export function checkUiTextOverrideChange(raw: unknown): CheckUiTextOverrideChangeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "화면 문구 입력을 확인할 수 없습니다." };
  }

  const { groupKey, itemKey, value } = raw as {
    groupKey?: unknown;
    itemKey?: unknown;
    value?: unknown;
  };

  if (typeof groupKey !== "string" || groupKey.length === 0) {
    return { ok: false, message: "문구 묶음 이름을 확인할 수 없습니다." };
  }
  const group = findUiTextGroup(groupKey);
  if (!group) {
    return { ok: false, message: `등록되지 않은 문구 묶음입니다: ${echo(groupKey)}` };
  }

  if (typeof itemKey !== "string" || itemKey.length === 0) {
    return { ok: false, message: `${group.label}의 항목 이름을 확인할 수 없습니다.` };
  }
  // 묶음 안에서 찾는다 — 다른 묶음에 같은 이름의 항목이 있어도 통과하면 안 된다.
  const item = findUiTextItem(groupKey, itemKey);
  if (!item) {
    return {
      ok: false,
      message: `${group.label}에 등록되지 않은 항목입니다: ${echo(itemKey)}`,
    };
  }

  // 기본값 복귀. 이 한 값만 문자열이 아닌 채로 통과한다.
  if (value === null) return { ok: true, change: { group, item, value: null } };

  if (typeof value !== "string") {
    return { ok: false, message: `${group.label}의 문구를 확인할 수 없습니다.` };
  }

  const normalized = normalizeUiTextValue(value);
  if (normalized === null) {
    // 어느 규칙에 걸렸는지 알려 준다 — "안 됩니다"만 돌려주면 관리자는 공백을
    // 지워야 하는지 길이를 줄여야 하는지 모른 채 같은 값을 다시 보낸다.
    return { ok: false, message: `${group.label}에 넣을 수 없는 문구입니다: ${describeRejection(value)}` };
  }

  return { ok: true, change: { group, item, value: normalized } };
}

/** 왜 거절됐는지 한 줄. normalizeUiTextValue 가 null 을 준 값에만 부른다. */
function describeRejection(value: string): string {
  if (hasForbiddenUiTextCharacter(value)) {
    // 이 문구들은 표 머리·배지·필터 단추 같은 한 줄 자리에 들어간다.
    return "줄바꿈·탭·보이지 않는 문자는 넣을 수 없습니다.";
  }
  if (value.trim().length === 0) {
    return "빈 문구는 넣을 수 없습니다.";
  }
  return `${UI_TEXT_MAX_LENGTH}자를 넘을 수 없습니다 (${echo(value)})`;
}

/**
 * 같은 (묶음, 항목)이 두 번 들어왔는가. 있으면 그 사실을 알리는 문장을, 없으면
 * null 을 돌려준다.
 *
 * 어느 쪽이 뜻인지 알 수 없고, 뒤엣것으로 덮어쓰면 화면에서 본 것과 다른 문구가
 * 저장될 수 있다(saveNotificationSettings · saveUiThemeTokens 가 같은 판단을
 * 한다). 이 검사는 값이 유효한지와 무관하므로 배열 전체를 한 번 훑는 자리에
 * 따로 둔다.
 */
export function findDuplicateUiTextChange(
  changes: readonly UiTextOverrideChange[]
): string | null {
  const seen = new Set<string>();
  for (const change of changes) {
    const key = `${String(change?.groupKey)}:${String(change?.itemKey)}`;
    if (seen.has(key)) {
      return `같은 문구가 두 번 들어왔습니다: ${echo(change?.groupKey)} (${echo(change?.itemKey)})`;
    }
    seen.add(key);
  }
  return null;
}

/**
 * 서버 액션이 부르는 배열 단위 검증. 하나라도 막히면 전부 거절한다 — 반쯤
 * 저장되면 어느 문구가 살아 있는지 화면과 DB 가 달라진다.
 */
export function validateUiTextOverrideChanges(raw: unknown): ValidateUiTextOverrideChangesResult {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "화면 문구 입력을 확인할 수 없습니다." };
  }

  const data: CheckedUiTextOverrideChange[] = [];
  for (const item of raw) {
    const checked = checkUiTextOverrideChange(item);
    if (!checked.ok) return { ok: false, message: checked.message };
    data.push(checked.change);
  }

  const duplicate = findDuplicateUiTextChange(raw as UiTextOverrideChange[]);
  if (duplicate) return { ok: false, message: duplicate };

  return { ok: true, data };
}
