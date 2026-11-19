const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Own standalone copy of the UUID format check, matching this codebase's
 * existing convention (repair-case-work-record-input.ts, workflow-
 * transition-input.ts each keep their own copy rather than cross-importing
 * between validation modules).
 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidRepairCaseId(value: unknown): value is string {
  return isValidUuid(value);
}

export function isValidFlowchartId(value: unknown): value is string {
  return isValidUuid(value);
}

/** Same convention as repair-case-input.ts's private MAX_LONG_TEXT — own local copy, not cross-imported. */
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4000;

export type FlowchartTitleValidationResult = { ok: true; title: string } | { ok: false; error: string };

/** Required, non-blank after trim, capped — never silently truncated. */
export function validateFlowchartTitle(value: unknown): FlowchartTitleValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "Flowchart 제목을 입력해 주세요." };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `Flowchart 제목은 ${MAX_TITLE_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, title: trimmed };
}

export type FlowchartDescriptionValidationResult = { ok: true; description: string | null } | { ok: false; error: string };

/** Optional — null/undefined/blank-after-trim all normalize to null, matching this codebase's established "not yet entered stays distinguishable from entered as empty" convention. */
export function validateFlowchartDescription(value: unknown): FlowchartDescriptionValidationResult {
  if (value === null || value === undefined) return { ok: true, description: null };
  if (typeof value !== "string") return { ok: false, error: "Flowchart 설명 형식이 올바르지 않습니다." };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, description: null };
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `Flowchart 설명은 ${MAX_DESCRIPTION_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, description: trimmed };
}

// ── 고장 개소 태그(2026-11-19) ────────────────────────────────────────────
// 🔴 **적는 방식이 같은 날 뒤집혔다.** 처음에는 한 칸에 길게 적고 쉼표·줄바꿈·
// 대괄호로 쪼갰지만, 사용자가 **고르거나 적어서 하나씩 더하는** 방식으로 바꿨다:
// 「그 방식으로 태그를 선택, 혹은 작성으로 선택해서 태그를 만들도록 하자」.
// 이어서 고르는 **모양**까지 못 박았다 — 「태그 목록은 **부품요청에서 부품을
// 검색할 때 처럼** 만들어줘」(후보를 칸 밑에 직접 그린다. 화면 쪽은
// components/repair-cases/flowchart/FaultTagSuggestionList.tsx 머리말).
//
// 🔴 그래서 **쉼표·줄바꿈·대괄호는 아무 경계도 아니다** — 적은 글자가 통째로 한
// 태그다. 「코일, 변색」을 그냥 적으면 되고, 앞 방식이 대괄호로 풀려던 문제가
// 여기서는 아예 생기지 않는다. 쪼개는 함수(parseFlowchartFaultTags)와 적는 칸으로
// 되돌리는 함수(formatFlowchartFaultTags)는 이 결정과 함께 들어냈다.
//
// 🔴 그래도 **태그 하나를 다듬는 규칙**은 그대로 필요하고, 화면(더하는 자리)과
// 서버(저장하는 자리)가 **같은 함수**를 봐야 하는 것도 그대로다 — 둘이 갈리면
// 화면에 선 알약과 저장된 값이 달라지고, 그 어긋남은 오류 없이 조용하다.
// 미리 정해 둔 목록이 아니라 적는 대로 생기는 값이라, enum 도 마스터 표도 두지
// 않는 것 역시 그대로다(고를 목록은 **이미 쓰인 태그**에서 뽑는다 —
// db/queries/repair-case-flowcharts.ts 의 listUsedRepairCaseFaultTags).
const FAULT_TAG_MAX_LENGTH = 30;
const FAULT_TAG_MAX_COUNT = 20;

/**
 * 태그 **하나**를 저장할 모양으로 다듬는다 — 사람이 적어 넣는 자리와 서버가
 * 받아 적는 자리가 이 함수 하나를 함께 본다.
 *
 * 앞뒤 공백을 걷고 → 맨 앞의 `#` 를 떼고 → 다시 걷는다(`# 우내` 처럼 `#` 뒤에
 * 띄어 적는 사람이 있다) → 가운데 공백은 한 칸으로 줄인다.
 *
 * 🔵 `#` 를 떼는 까닭: 태그라고 하면 `#` 를 먼저 치는 손버릇이 있다. 막을 일이
 * 아니라 받아 주고 떼면 된다 — `##우내` 처럼 겹쳐 친 것도 같은 태그가 된다.
 * 🔴 가운데 공백을 한 칸으로 줄이는 까닭: `우측  내부` 와 `우측 내부` 는 눈으로
 * 구분되지 않는다. 안 줄이면 같은 개소가 알약 둘로 서고, 다음 사람이 고를 목록
 * 에도 두 줄로 쌓인다.
 *
 * 🔵 다듬은 결과가 **빈 글자일 수 있다**(`#` 만 쳤거나 공백뿐). 그것은 오류가
 * 아니라 「더할 것이 없음」이고, 부르는 쪽이 그렇게 받는다.
 */
export function normalizeFlowchartFaultTag(value: string): string {
  return value
    .trim()
    .replace(/^#+/, "")
    .trim()
    .replace(/\s+/g, " ");
}

export type FlowchartFaultTagsValidationResult = { ok: true; tags: string[] } | { ok: false; error: string };

/**
 * 저장 통로가 받은 **태그 묶음**을 검증한다 — 화면이 이미 하나씩 다듬어 쌓은
 * 배열이 들어온다. 비어 있으면 태그 0개이고 **오류가 아니다**(선택 칸이다 —
 * validateFlowchartDescription 과 같은 결).
 *
 * 🔴 **글자 하나(`"우내, 우외"`)는 받지 않는다.** 쪼개는 규칙이 사라진 지금
 * 글자를 받으면 그 글자가 통째로 태그 하나가 되는데, 보낸 쪽은 둘로 쪼개질 것을
 * 기대했을 수 있다 — 조용히 엉뚱한 값이 저장되느니 소리 나게 거절한다.
 * (null·undefined 는 「태그 없음」으로 받는다.)
 *
 * 화면이 같은 규칙으로 다듬어 보내지만 여기서 **다시** 다듬는다. 서버 액션은
 * 화면을 거치지 않고도 불릴 수 있어서, 상한·중복을 화면이 정하게 두면 울타리가
 * 화면에만 있는 셈이 된다.
 *
 *  - 빈 것은 버린다(오류가 아니다).
 *  - 🔵 중복은 **조용히 하나로 합친다** — 화면에서는 나올 수 없는 모양이라,
 *    거절해 봐야 사람이 고칠 자리가 없다. 반대로 사람이 방금 적어 넣는
 *    자리(addFlowchartFaultTag)에서는 **까닭을 말한다**: 거기서는 왜 안
 *    더해졌는지 알아야 한다.
 *  - 남는 차례는 **먼저 온 것**이다 — 알약이 그 차례로 서므로, 뒤엣것을 남기면
 *    사람이 만들지 않은 차례로 다시 선다.
 *  - 상한을 넘으면 **조용히 자르지 않고 거절한다**(제목·설명과 같은 방식 —
 *    말없이 잘린 값은 저장된 뒤에야 들통난다).
 *  - 개수 상한은 **중복을 합친 뒤에** 센다.
 */
export function validateFlowchartFaultTags(value: unknown): FlowchartFaultTagsValidationResult {
  if (value === null || value === undefined) return { ok: true, tags: [] };
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return { ok: false, error: "고장 개소 형식이 올바르지 않습니다." };
  }

  const tags: string[] = [];
  for (const item of value as string[]) {
    const tag = normalizeFlowchartFaultTag(item);
    if (tag.length === 0) continue;
    if (tag.length > FAULT_TAG_MAX_LENGTH) {
      return { ok: false, error: `고장 개소 태그는 ${FAULT_TAG_MAX_LENGTH}자를 초과할 수 없습니다.` };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > FAULT_TAG_MAX_COUNT) {
    return { ok: false, error: `고장 개소 태그는 ${FAULT_TAG_MAX_COUNT}개를 초과할 수 없습니다.` };
  }
  return { ok: true, tags };
}

export type FlowchartFaultTagAddResult = { ok: true; tags: string[] } | { ok: false; error: string };

/**
 * 적거나 고른 태그 **하나**를 묶음에 더한다 — [추가] 단추와 Enter 가 이 함수
 * 하나를 부른다(둘이 갈리면 「단추로는 되는데 Enter 로는 안 되는」 규칙이 생기고,
 * 그런 결함은 눌러 보기 전에는 안 보인다).
 *
 * 🔴 더해지지 않는 경우를 **두 갈래로 나눈다**:
 *  - 빈 글자(공백뿐이거나 `#` 만) → **아무 말 없이 안 더한다.** 빈 칸에서 Enter
 *    를 눌렀을 뿐인데 빨간 글이 뜨면 고장으로 보인다.
 *  - 이미 있는 태그 · 30자 초과 · 20개 초과 → **까닭을 말한다.** 적어 넣었는데
 *    아무 일도 안 일어나면 왜 안 되는지 알 길이 없다.
 *
 * 돌려주는 것은 늘 **새 배열**이다 — 쥐고 있던 배열을 고쳐 돌려주면 React 가
 * 바뀐 줄 모른다(화면이 그대로여서 「안 더해졌다」로 보인다).
 */
export function addFlowchartFaultTag(tags: readonly string[], typed: string): FlowchartFaultTagAddResult {
  const tag = normalizeFlowchartFaultTag(typed);
  if (tag.length === 0) return { ok: true, tags: [...tags] };
  if (tag.length > FAULT_TAG_MAX_LENGTH) {
    return { ok: false, error: `고장 개소 태그는 ${FAULT_TAG_MAX_LENGTH}자를 초과할 수 없습니다.` };
  }
  if (tags.includes(tag)) {
    return { ok: false, error: `「${tag}」 는 이미 추가한 고장 개소입니다.` };
  }
  if (tags.length >= FAULT_TAG_MAX_COUNT) {
    return { ok: false, error: `고장 개소 태그는 ${FAULT_TAG_MAX_COUNT}개까지 추가할 수 있습니다.` };
  }
  return { ok: true, tags: [...tags, tag] };
}

/**
 * 고를 목록에서 **이미 단 태그를 뺀다** — 후보에 남아 있는데 골라도 안 더해지면
 * 고장으로 보인다(까닭은 뜨지만, 고를 수 없는 것은 애초에 안 보이는 편이 낫다).
 *
 * 🔴 목록 쪽 값도 **같은 규칙으로 다듬어** 견준다. 목록은 이미 저장된 값에서
 * 오므로 보통은 다듬을 것이 없지만, 다듬는 규칙이 바뀌는 날 「눈에는 같은데 안
 * 빠지는」 줄이 생긴다. 같은 자리에서 중복도 걷는다 — 후보 줄의 React key 가
 * 태그 글자라 겹치면 경고가 나고, 같은 글자가 두 줄로 보이면 고른 쪽이 다른
 * 것처럼 읽힌다.
 *
 * 🔵 차례는 **받은 그대로** 둔다. 조회가 「많이 쓰인 순」으로 정렬해 오므로
 * 여기서 다시 섞으면 그 차례가 뜻을 잃는다.
 */
export function availableFaultTagSuggestions(suggestions: readonly string[], selected: readonly string[]): string[] {
  const taken = new Set(selected.map((tag) => normalizeFlowchartFaultTag(tag)));
  const seen = new Set<string>();
  const available: string[] = [];
  for (const raw of suggestions) {
    const tag = normalizeFlowchartFaultTag(raw);
    if (tag.length === 0 || taken.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    available.push(tag);
  }
  return available;
}

/**
 * 한 번에 보여 줄 후보의 수 — 부품 고르개(vendor/dss-core 의 MAX_PART_SUGGESTIONS)와
 * 같은 여덟이다. 목록을 다 뿌리면 칸 밑의 것들을 가려 오히려 고르기 어렵다.
 */
export const MAX_FAULT_TAG_SUGGESTIONS = 8;

/**
 * **적는 대로 후보를 좁힌다** — 사용자가 말한 「그 창에 적고 있는 내용으로 태그
 * 목록에서 바로바로 검색」이 이 함수다. 부품 고르개의 `filterPartOptions` 와 같은
 * 자리에 있는 같은 일이고, 거르기를 **브라우저에서** 하는 것도 같다(태그 수가 적어
 * 페이지가 목록을 통째로 내려보낸다 — 글자마다 서버를 부르면 느리고, 지운 글자만큼
 * 응답이 엇갈려 도착한다).
 *
 * 🔴 찾는 글도 **같은 규칙으로 다듬어** 견준다 — `#우` 라고 쳐도 `우내` 가 나와야
 * 한다(`#` 는 적는 습관일 뿐이라 떼고 저장한다. 안 다듬으면 「분명히 있는데 안
 * 나오는」 칸이 된다).
 * 🔵 대소문자는 가리지 않는다 — 영문 약어로 적은 개소(`RF출력`)를 소문자로 찾는다.
 *
 * 🔴 **빈 글자면 받은 것을 그대로(여덟까지) 보여 준다** — 부품 고르개는 반대로 빈
 * 글자에 아무것도 안 돌려주는데, 그쪽은 후보가 수백~수천 줄이라 「칸을 누르자마자
 * 통째로 펼쳐지는」 것을 막아야 하기 때문이다. 고장 개소는 지금껏 쓰인 몇 개뿐이고
 * **많이 쓰인 순으로 와서**(listUsedRepairCaseFaultTags), 치기 전에 보이는 그 몇 줄이
 * 바로 이 칸이 노리는 「골라 넣기」다. 안 보여 주면 글자를 아는 사람만 쓸 수 있는 칸이
 * 되고, 많이 쓰인 순으로 정렬한 일이 아무 쓸모가 없어진다.
 */
export function filterFaultTagOptions(options: readonly string[], query: string): string[] {
  const term = normalizeFlowchartFaultTag(query).toLowerCase();
  const matched = term === "" ? [...options] : options.filter((tag) => tag.toLowerCase().includes(term));
  return matched.slice(0, MAX_FAULT_TAG_SUGGESTIONS);
}

/**
 * 두 태그 묶음이 같은가. 🔴 **차례까지 같아야 같은 것**으로 본다 — 알약이 적은
 * 차례대로 서므로 차례를 바꾼 것도 사람 눈에는 바뀐 것이고, 차례를 무시하면
 * 「바꿨는데 저장 안 됨 · 단추가 안 켜짐」이 된다(둘 다 오류 없이 조용하다).
 * 저장 통로의 「바뀐 게 없다」 판정과 화면의 저장 단추가 **이 함수 하나**를
 * 본다.
 */
export function faultTagsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tag, index) => tag === b[index]);
}

export type FlowchartDeleteReasonValidationResult = { ok: true; reason: string | null } | { ok: false; error: string };

/** Optional per the 5C-6B plan (unlike work-record invalidation, which is mandatory) — same null-normalizing convention as description. */
export function validateFlowchartDeleteReason(value: unknown): FlowchartDeleteReasonValidationResult {
  if (value === null || value === undefined) return { ok: true, reason: null };
  if (typeof value !== "string") return { ok: false, error: "삭제 사유 형식이 올바르지 않습니다." };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, reason: null };
  const MAX_REASON_LENGTH = 2000;
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `삭제 사유는 ${MAX_REASON_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, reason: trimmed };
}

export type PermanentDeleteReasonValidationResult = { ok: true; reason: string } | { ok: false; error: string };

/** Mandatory — unlike validateFlowchartDeleteReason (soft-delete's reason stays optional): permanent deletion is irreversible, so a reason is always required, never null-normalized. */
export function validatePermanentDeleteReason(value: unknown): PermanentDeleteReasonValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "영구 삭제 사유를 입력해 주세요." };
  }
  const trimmed = value.trim();
  const MAX_REASON_LENGTH = 2000;
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `영구 삭제 사유는 ${MAX_REASON_LENGTH}자를 초과할 수 없습니다.` };
  }
  return { ok: true, reason: trimmed };
}

export function isValidExpectedUpdatedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

export type CreateRepairCaseFlowchartActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "INVALID_INPUT"
  | "BILLING_DECISION_REQUIRED"
  | "DATABASE_UNAVAILABLE";

export type CreateRepairCaseFlowchartActionResult =
  | { ok: true; id: string; createdAt: string; updatedAt: string }
  | { ok: false; code: CreateRepairCaseFlowchartActionResultCode; message: string };

export type UpdateRepairCaseFlowchartMetadataActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "INVALID_INPUT"
  | "STALE_REVISION"
  | "BILLING_DECISION_REQUIRED"
  | "DATABASE_UNAVAILABLE";

export type UpdateRepairCaseFlowchartMetadataActionResult =
  | { ok: true; id: string; updatedAt: string; changed: boolean }
  | { ok: false; code: UpdateRepairCaseFlowchartMetadataActionResultCode; message: string };

export type SoftDeleteRepairCaseFlowchartActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "STALE_REVISION"
  | "DATABASE_UNAVAILABLE";

export type SoftDeleteRepairCaseFlowchartActionResult =
  | { ok: true; id: string; deletedAt: string }
  | { ok: false; code: SoftDeleteRepairCaseFlowchartActionResultCode; message: string };

export type RestoreRepairCaseFlowchartActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CASE_LOCKED"
  | "STALE_REVISION"
  | "DATABASE_UNAVAILABLE";

export type RestoreRepairCaseFlowchartActionResult =
  | { ok: true; id: string; updatedAt: string }
  | { ok: false; code: RestoreRepairCaseFlowchartActionResultCode; message: string };

export type PermanentlyDeleteRepairCaseFlowchartActionResultCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_REVISION"
  | "DATABASE_UNAVAILABLE";

export type PermanentlyDeleteRepairCaseFlowchartActionResult =
  | { ok: true; id: string }
  | { ok: false; code: PermanentlyDeleteRepairCaseFlowchartActionResultCode; message: string };
