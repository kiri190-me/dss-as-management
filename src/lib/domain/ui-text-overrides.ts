import {
  accountApprovalStatusLabels,
  priorityLabels,
  repairStatusLabels,
  roleLabels,
  workHistoryTypeLabels,
  workRecordKindLabels,
  workflowTypeLabels,
} from "./types";

/**
 * ============================================================================
 * 화면 문구 오버라이드 — 등록부·검증기·병합
 * ============================================================================
 * 관리자가 코드를 고치지 않고 화면에 박힌 **고정 문구(라벨)** 를 바꿀 수 있게 하는
 * 축의 맨 아래 조각이다. DB 도 server-only 도 여기 들어오지 않는다 —
 * ui-theme-tokens.ts 가 색 쪽에서 차지한 자리와 같다. 화면(나중에 붙을 편집기)과
 * 서버(저장·조회)가 **같은 규칙**을 쓰게 하려고 가운데에 두었고, 그래서 Node 단위
 * 테스트로 그대로 돈다.
 *
 * ── 🔴 색과 결정적으로 다른 점 ──────────────────────────────────────────
 * 색은 Tailwind 가 CSS 변수로 모아 두어, 변수 하나를 덮으면 앱 전체가 저절로
 * 따라왔다. **문구에는 그런 통로가 없다** — 화면이 `roleLabels[user.role]` 처럼
 * 코드 표를 직접 읽는다. 그래서 이 등록부에 값을 쌓아도 **화면은 아직 바뀌지
 * 않는다.** 읽는 쪽(클라이언트 16 · 서버 21, 모두 37개 파일)을 이 등록부를 거치게
 * 갈아 끼우는 것은 다음 판의 일이고, 이 파일은 그 앞의 **그릇**이다.
 *
 * ── 기본값을 여기 손으로 다시 적지 않는다 ───────────────────────────────
 * 항목의 `defaultText` 는 전부 types.ts 의 `*Labels` 표에서 **가져온다.** 문구를
 * 두 벌로 적으면 types.ts 를 손보는 날 "기본값으로 되돌렸는데 옛 문구가 나온다"가
 * 된다 — 되돌림은 행을 지우는 것이고, 그때 화면에 남는 값은 코드의 기본값이기
 * 때문이다. 색 축의 톤 템플릿이 등록부에서 값을 가져오는 것과 같은 근거다.
 *
 * ── 🔴 일부러 뺀 표 셋 ──────────────────────────────────────────────────
 * types.ts 에는 `*Labels` 표가 10개 있지만 여기 담은 것은 7개다. 아래 셋은
 * **빠뜨린 것이 아니라 뺀 것**이므로, 「빠졌네」 하며 넣지 말 것.
 *
 *   ① `productCategoryLabels` — **문구 값이 곧 비교값이다.**
 *      types.ts 의 `PRODUCT_CATEGORY_OPTIONS` 가 그 표의 **값들로**
 *      만들어지고(`[...new Set(Object.values(productCategoryLabels))]`),
 *      내 담당 제품 화면의 제품 구분 필터(my-active-work-filter.ts)도 코드가
 *      아니라 그 문구로 비교한다. 문구를 바꾸는 순간 **기존 필터가 아무것도 못
 *      찾는데 오류는 나지 않는다** — 눈으로는 절대 못 찾는 고장이다. 이 표를
 *      바꿀 수 있게 하려면 먼저 코드 목록(PRODUCT_CATEGORY_CODES)을 만들어
 *      비교를 코드로 옮기는 별도의 판이 필요하다.
 *
 *   ② `exceptionStatusLabels` — **DB 에 이미 표가 있다.**
 *      `exception_statuses` 표에 `code`·`label` 칸이 있고 9개 문구가 이미 들어
 *      있다(ON_HOLD→보류 · PARTS_WAITING→부품 대기 · DISPOSED→폐기 …). 그런데
 *      화면 셋(ExceptionStatusNotice · ExceptionStatusBadge · MyWorkFilters)이
 *      아직 코드 표를 읽어서 **이중 진실이 이미 하나 있다.** 여기에 또 담으면
 *      진실이 셋이 된다. 이 표는 「화면이 exception_statuses.label 을 읽게」
 *      해서 닫을 몫이지, 이 등록부가 맡을 몫이 아니다.
 *
 *   ③ `billingTypeLabels` — **화면에만 나오는 문구가 아니다.**
 *      유상 · 일부유상 · 무상 · 추후결정 이 넷은 접수 알림 **메일 본문에도 그대로
 *      나간다**(domain/intake-mail-body.ts). 화면만 바꿀 수 있게 열어 두면 화면과
 *      메일이 서로 다른 말을 하게 되고, 그 어긋남은 우리보다 **고객에게 먼저
 *      보인다.** 그래서 이 문구는 코드 표(types.ts 의 billingTypeLabels)를 그대로
 *      읽는다 — 2026-09-08 **사용자 결정**이다. 그 결정 덕에 순수 함수 셋
 *      (intake-mail-body.ts · db/mappers/repair-case.ts ·
 *      domain/product-model-breakdown.ts)이 DB 를 모르는 채로 남았다: 이 표를
 *      여기 담는 순간 저 셋이 저장된 문구를 읽어야 하고, 그러면 메일 본문을 만드는
 *      함수가 DB 를 알게 된다. 이 표를 열려면 화면과 메일이 **같은 한 벌**을 읽는
 *      길을 먼저 내야 한다.
 *
 * ── 🔴 줄바꿈·탭·제어문자를 막는 이유 ───────────────────────────────────
 * 여기 담긴 문구들은 표 머리·배지·필터 단추 같은 **한 줄 자리**에 들어간다.
 * 줄바꿈이 하나 섞이면 표의 행 높이가 어긋나고 배지가 두 줄이 되어 그 줄만
 * 무너진다. 제어문자는 더 나쁘다 — **눈에 보이지 않는 채로 문자열 비교만**
 * 어긋나게 만들어서, 화면에는 기본값과 똑같이 보이는데 "되돌려도 행이 안
 * 지워지는" 상태가 된다. 그래서 값을 받는 첫 자리에서 막는다.
 *
 * ── 연속 공백을 하나로 줄이는 이유 ──────────────────────────────────────
 * 색의 소문자 정규화와 같다. "승인  대기"(공백 둘)는 사람 눈에 "승인 대기"와
 * 구별되지 않는데 문자열은 다르다. 그대로 저장하면 기본값과 같은 문구인데 행이
 * 남고, 저장된 행 수가 편집 화면의 "바꾼 것" 표시와 어긋나기 시작한다.
 * ============================================================================
 */

/** 등록부의 항목 하나 — 코드 하나에 붙는 문구 하나. */
export type UiTextItem = {
  /** 표 안에서의 코드 키. DB 의 item_key 에 그대로 들어간다. 예: "SUPER_ADMIN" */
  key: string;
  /** 코드의 기본 문구. **반드시 types.ts 의 표에서 가져온다** — 손으로 적지 않는다. */
  defaultText: string;
  /** 이 항목만 따로 설명할 것이 있을 때. 없으면 묶음의 usage 로 충분하다는 뜻이다. */
  usage?: string;
};

/** 등록부의 묶음 하나 — types.ts 의 `*Labels` 표 하나에 대응한다. */
export type UiTextGroup = {
  /** DB 의 group_key 에 그대로 들어간다. types.ts 의 표 이름에서 Labels 를 뗀 것이다. */
  key: string;
  /** 관리자가 읽을 한글 이름. */
  label: string;
  /** **어느 화면에서 보게 되는 문구인지**를 적는다 — "역할"만 적으면 무엇을 바꾸는지 모른다. */
  usage: string;
  items: readonly UiTextItem[];
};

/**
 * 관리자가 바꿀 수 있는 문구 전부 — 7묶음 42문구.
 *
 * 항목을 여기 손으로 늘어놓는 이유는, 코드 목록(`ROLE_CODES` 등)에서 자동으로
 * 펼치면 types.ts 에 코드가 하나 늘 때 **아무도 모르는 사이에** 이 등록부와
 * 편집 화면이 함께 늘어나기 때문이다. 늘리는 것은 사람의 판단이어야 하고,
 * 빠뜨린 항목은 단위 시험(ui-text-overrides.test.ts)이 잡는다 — 그 시험이
 * 묶음마다 types.ts 의 표와 **키가 정확히 같은지**를 단언한다.
 */
export const UI_TEXT_GROUPS: readonly UiTextGroup[] = [
  {
    key: "role",
    label: "역할 이름",
    usage: "사용자 관리 목록·담당자 배정 드롭다운·감사 기록·사이드바 프로필에 나오는 역할 이름",
    items: [
      { key: "SUPER_ADMIN", defaultText: roleLabels.SUPER_ADMIN },
      { key: "ADMIN", defaultText: roleLabels.ADMIN },
      { key: "AS_ENGINEER", defaultText: roleLabels.AS_ENGINEER },
      { key: "SALES", defaultText: roleLabels.SALES },
      { key: "INVENTORY_MANAGER", defaultText: roleLabels.INVENTORY_MANAGER },
    ],
  },
  {
    key: "accountApprovalStatus",
    label: "계정 승인 상태",
    usage: "사용자 관리 화면의 승인 상태 배지와 승인 대기 안내 문구",
    items: [
      { key: "PENDING", defaultText: accountApprovalStatusLabels.PENDING },
      { key: "APPROVED", defaultText: accountApprovalStatusLabels.APPROVED },
    ],
  },
  {
    key: "workflowType",
    label: "워크플로 종류",
    usage: "A/S 접수·수리 목록·상세 화면에서 제품 종류와 유·무상을 함께 나타내는 문구",
    items: [
      { key: "PAID_MATCHER", defaultText: workflowTypeLabels.PAID_MATCHER },
      { key: "WARRANTY_MATCHER", defaultText: workflowTypeLabels.WARRANTY_MATCHER },
      { key: "PAID_GENERATOR", defaultText: workflowTypeLabels.PAID_GENERATOR },
      { key: "WARRANTY_GENERATOR", defaultText: workflowTypeLabels.WARRANTY_GENERATOR },
      { key: "PAID_TOTAL_CONTROLLER", defaultText: workflowTypeLabels.PAID_TOTAL_CONTROLLER },
      {
        key: "WARRANTY_TOTAL_CONTROLLER",
        defaultText: workflowTypeLabels.WARRANTY_TOTAL_CONTROLLER,
        // 지금 등록부에서 가장 긴 문구다(23자). 길이 상한의 근거가 이 항목이다.
        usage: "지금 등록부에서 가장 긴 문구 — 길이 상한(UI_TEXT_MAX_LENGTH)의 기준이 된다",
      },
      { key: "PENDING_MATCHER", defaultText: workflowTypeLabels.PENDING_MATCHER },
      { key: "PENDING_GENERATOR", defaultText: workflowTypeLabels.PENDING_GENERATOR },
      {
        key: "PENDING_TOTAL_CONTROLLER",
        defaultText: workflowTypeLabels.PENDING_TOTAL_CONTROLLER,
      },
    ],
  },
  {
    key: "repairStatus",
    label: "수리 진행 상태",
    usage: "수리 목록의 상태 배지·상태 필터 단추·대시보드 집계 이름",
    items: [
      { key: "WAITING_INTAKE_INSPECTION", defaultText: repairStatusLabels.WAITING_INTAKE_INSPECTION },
      {
        key: "INTAKE_INSPECTION_IN_PROGRESS",
        defaultText: repairStatusLabels.INTAKE_INSPECTION_IN_PROGRESS,
      },
      {
        key: "INTAKE_INSPECTION_COMPLETED",
        defaultText: repairStatusLabels.INTAKE_INSPECTION_COMPLETED,
      },
      { key: "WAITING_KYOSAN_REPLY", defaultText: repairStatusLabels.WAITING_KYOSAN_REPLY },
      { key: "WAITING_PO", defaultText: repairStatusLabels.WAITING_PO },
      { key: "WAITING_PARTS_SUPPLY", defaultText: repairStatusLabels.WAITING_PARTS_SUPPLY },
      { key: "WAITING_REPAIR", defaultText: repairStatusLabels.WAITING_REPAIR },
      { key: "IN_REPAIR", defaultText: repairStatusLabels.IN_REPAIR },
      {
        key: "WAITING_SHIPMENT_APPROVAL",
        defaultText: repairStatusLabels.WAITING_SHIPMENT_APPROVAL,
      },
      { key: "WAITING_SHIPMENT", defaultText: repairStatusLabels.WAITING_SHIPMENT },
      { key: "SHIPMENT_COMPLETED", defaultText: repairStatusLabels.SHIPMENT_COMPLETED },
    ],
  },
  {
    key: "priority",
    label: "우선순위",
    usage: "수리 목록·내 담당 작업의 우선순위 배지와 정렬 안내",
    items: [
      { key: "LOW", defaultText: priorityLabels.LOW },
      { key: "NORMAL", defaultText: priorityLabels.NORMAL },
      { key: "HIGH", defaultText: priorityLabels.HIGH },
      { key: "URGENT", defaultText: priorityLabels.URGENT },
    ],
  },
  {
    key: "workHistoryType",
    label: "작업 이력 구분",
    usage: "수리 상세의 작업 이력 탭에서 이력 한 줄의 종류를 나타내는 문구",
    items: [
      { key: "INSPECTION", defaultText: workHistoryTypeLabels.INSPECTION },
      { key: "DIAGNOSIS", defaultText: workHistoryTypeLabels.DIAGNOSIS },
      { key: "REPAIR", defaultText: workHistoryTypeLabels.REPAIR },
      { key: "TEST", defaultText: workHistoryTypeLabels.TEST },
      { key: "COMMUNICATION", defaultText: workHistoryTypeLabels.COMMUNICATION },
      { key: "STATUS_CHANGE", defaultText: workHistoryTypeLabels.STATUS_CHANGE },
      { key: "OTHER", defaultText: workHistoryTypeLabels.OTHER },
    ],
  },
  {
    key: "workRecordKind",
    label: "작업 기록 종류",
    usage: "작업 기록 작성 화면의 종류 선택과 기록 목록의 종류 배지",
    items: [
      { key: "GENERAL", defaultText: workRecordKindLabels.GENERAL },
      {
        key: "INTAKE_INSPECTION_RESULT",
        defaultText: workRecordKindLabels.INTAKE_INSPECTION_RESULT,
      },
      {
        key: "DIAGNOSIS_REPAIR_SUMMARY",
        defaultText: workRecordKindLabels.DIAGNOSIS_REPAIR_SUMMARY,
      },
      { key: "NEXT_PLANNED_ACTION", defaultText: workRecordKindLabels.NEXT_PLANNED_ACTION },
    ],
  },
];

/** (묶음 키, 항목 키)로 항목을 찾는 표. 등록부에 없는 키는 어디서도 통과하지 못한다. */
const UI_TEXT_GROUP_BY_KEY: ReadonlyMap<string, UiTextGroup> = new Map(
  UI_TEXT_GROUPS.map((group) => [group.key, group])
);

const UI_TEXT_ITEM_BY_KEY: ReadonlyMap<string, ReadonlyMap<string, UiTextItem>> = new Map(
  UI_TEXT_GROUPS.map((group) => [
    group.key,
    new Map(group.items.map((item) => [item.key, item])),
  ])
);

/** 등록부에서 묶음을 찾는다. 없으면 undefined. */
export function findUiTextGroup(groupKey: string): UiTextGroup | undefined {
  return UI_TEXT_GROUP_BY_KEY.get(groupKey);
}

/** 등록부에서 항목을 찾는다. 묶음이나 항목이 없으면 undefined. */
export function findUiTextItem(groupKey: string, itemKey: string): UiTextItem | undefined {
  return UI_TEXT_ITEM_BY_KEY.get(groupKey)?.get(itemKey);
}

// ─────────────────────────────────────────────────────────────── 검증기

/**
 * 문구 길이 상한(문자 수).
 *
 * 숫자를 지어내지 않았다. 지금 등록부에서 가장 긴 문구는 워크플로 종류의
 * **"무상(보증) Total Controller" 23자**이고(단위 시험이 그 사실을 단언한다),
 * 그 두 배 반쯤을 상한으로 잡았다. 아래로 좁히면 지금 있는 문구조차 못 바꾸게
 * 되고, 위로 열면 배지와 필터 단추가 옆 칸을 밀어내 표가 무너진다 — 이 문구들이
 * 들어가는 자리는 전부 폭이 정해진 **한 줄짜리 칸**이다.
 *
 * 세는 단위는 코드 유닛이 아니라 **문자**다(Array.from 으로 센다). 한글은
 * 코드 유닛 하나지만 이모지·일부 기호는 둘이라, `.length` 로 재면 같은 길이의
 * 문구가 어떤 글자를 썼느냐에 따라 통과와 거절로 갈린다.
 */
export const UI_TEXT_MAX_LENGTH = 60;

/**
 * 문구에 들어올 수 없는 문자.
 *
 * 세 부류다 — C0 제어문자(U+0000~U+001F, **줄바꿈과 탭이 여기 있다**) · DEL 과
 * C1 제어문자(U+007F~U+009F) · 유니코드 줄 구분자(U+2028 LINE SEPARATOR,
 * U+2029 PARAGRAPH SEPARATOR). 앞의 둘은 눈에 보이지 않는 채로 문자열 비교만
 * 어긋나게 만들고, 뒤의 둘은 브라우저가 실제로 줄을 바꾼다 — 셋 모두
 * "한 줄 자리"라는 이 문구들의 전제를 깬다.
 */
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * 이 문구에 들어오면 안 되는 문자가 섞여 있는가.
 *
 * 검증기와 오류 문장(validation/ui-text-override-input.ts)이 **같은 판정**을
 * 써야 한다. 정규식을 두 곳에 적으면 한쪽만 고쳐지는 날 "거절은 되는데 이유가
 * 다른 것으로 나오는" 상태가 되고, 관리자는 무엇을 고쳐야 하는지 모른 채 같은
 * 값을 다시 보낸다.
 */
export function hasForbiddenUiTextCharacter(value: string): boolean {
  return CONTROL_CHARACTER_PATTERN.test(value);
}
/**
 * 값이 유효하면 정규화된 문구를, 아니면 null 을 돌려준다.
 *
 * 저장 경로와 읽기 경로가 **둘 다** 이 함수를 부른다. 저장 쪽이 언젠가 뚫리거나
 * DB 를 손으로 고친 행이 들어와도, 병합이 한 번 더 이 문을 통과시킨다
 * (normalizeUiThemeValue 가 색 쪽에서 하는 일과 같다).
 *
 * 순서가 뜻을 가진다:
 *  1) 문자열이 아니면 거절.
 *  2) 🔴 **제어문자 검사를 다듬기보다 먼저** 한다. `trim()` 은 줄바꿈과 탭까지
 *     지워 버리므로, 나중에 검사하면 "역할\n" 같은 값이 조용히 통과한다 —
 *     막기로 한 것을 몰래 고쳐 주는 셈이고, 보낸 쪽은 자기 값이 바뀐 줄 모른다.
 *  3) 앞뒤를 다듬고 문자열 안의 연속 공백을 하나로 줄인다.
 *  4) 빈 문자열은 거절. 빈 이름표는 화면에서 **그 칸이 사라진 것**으로 보이고,
 *     관리자에게 그것은 고장과 구별되지 않는다.
 *  5) 길이 상한을 넘으면 거절.
 */
export function normalizeUiTextValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (CONTROL_CHARACTER_PATTERN.test(raw)) return null;

  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0) return null;
  if (Array.from(value).length > UI_TEXT_MAX_LENGTH) return null;

  return value;
}

// ─────────────────────────────────────────────── 저장된 값과 기본값의 병합

/**
 * 저장된 오버라이드 한 줄. **기본값과 다른 것만** 행으로 남는다 — 기본 문구와
 * 같은 값을 굳이 저장하면, 나중에 types.ts 의 기본 문구를 손볼 때 옛 문구가
 * 오버라이드로 굳어 아무 화면도 따라 바뀌지 않는다.
 */
export type UiTextOverrideRow = { groupKey: string; itemKey: string; value: string };

/** 묶음 키 → 항목 키 → 최종 문구. */
export type ResolvedUiText = Record<string, Record<string, string>>;

/** 오버라이드가 하나도 없는 상태. 표가 아직 없는 DB 에서도 이 값으로 답한다. */
export const NO_UI_TEXT_OVERRIDES: readonly UiTextOverrideRow[] = [];

/**
 * 저장된 행을 기본 문구 위에 얹는다.
 *
 * 🔴 등록부에 없는 키는 **무시한다(거절이 아니라).** 언젠가 어떤 문구를 등록부에서
 * 빼는 날이 오면 그 키의 옛 행이 DB 에 남아 있을 텐데, 그때 이 함수가 통째로
 * 실패하면 그 문구를 쓰는 **모든 화면**이 안 뜬다. 모르는 키 하나 때문에 앱이
 * 멈추는 것보다 그 한 줄을 흘려보내는 편이 언제나 낫다 — 검증을 통과하지 못하는
 * 값도 같은 이유로 버린다.
 *
 * 들어오는 값을 좁게 받고(validation/ui-text-override-input.ts) 이미 저장된 값은
 * 너그럽게 흘려보내는 이 비대칭은 색 축과 같은 판단이다.
 */
export function resolveUiText(rows: readonly UiTextOverrideRow[]): ResolvedUiText {
  const resolved: ResolvedUiText = {};
  for (const group of UI_TEXT_GROUPS) {
    const texts: Record<string, string> = {};
    for (const item of group.items) texts[item.key] = item.defaultText;
    resolved[group.key] = texts;
  }

  for (const row of rows) {
    const item = findUiTextItem(row.groupKey, row.itemKey);
    if (!item) continue;

    const value = normalizeUiTextValue(row.value);
    if (value === null) continue;

    resolved[row.groupKey][row.itemKey] = value;
  }

  return resolved;
}
