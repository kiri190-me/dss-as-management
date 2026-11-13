/**
 * ============================================================================
 * 배지 표시 설정 — 등록부(배지 15 · 자리 6 · 쌍 29)와 판정
 * ============================================================================
 * 화면에 뜨는 작은 알약 모양 표식(배지)을 관리자가 **자리별로** 끌 수 있게 하는
 * 축의 맨 아래 조각이다. DB 도 server-only 도 여기 들어오지 않는다 —
 * ui-theme-tokens.ts 가 색 쪽에서, notification-settings.ts 가 알림 쪽에서
 * 차지한 자리와 같다. 설정 화면(조각 2)과 서버(조회·저장)와 배지를 실제로 그리는
 * 화면들(조각 3)이 **같은 규칙**을 쓰게 하려고 가운데에 두었고, 그래서 Node 단위
 * 시험으로 그대로 돈다.
 *
 * 🔵 2026-11-13 현재 **쌍 29개가 전부 화면에 붙었다.** 조각 3이 수리건 쪽 자리 셋을
 * (전체 A/S 현황 목록 · 상세 머리말 · 기본 정보 탭 — 20쌍), 조각 4가 나머지 셋을
 * (내자 정리 목록 · 기타건 현황 목록 · 기타건 상세 머리말 — 9쌍) 이었다. 🔴 **체크를
 * 풀면 29자리 전부 실제로 화면이 바뀐다** — 「꺼도 아무 일이 안 일어나는 스위치」는
 * 이제 하나도 없다(아래 두 문단이 그것을 지키려고 적어 둔 규율이다).
 *
 * ── 왜 (배지, 자리) 쌍인가 ──────────────────────────────────────────────
 * 같은 배지가 자리마다 사정이 다르다. 「DB」 배지는 목록에서 줄마다 되풀이돼 눈에
 * 거슬리지만 상세 머리말에서는 이 자료가 어디서 왔는지 알려 주는 유일한 표시다.
 * 배지를 통째로 끄는 스위치만 두면 그 둘을 나눠 정할 수 없다.
 *
 * ── 🔴 쌍을 손으로 적는다 — 배지 × 자리를 곱하지 않는다 ─────────────────
 * 15 × 6 = 90 이 아니라 **29**다. 「수리 건 요청일」은 내자 정리 목록에서만,
 * 「(내자)」는 전체 A/S 현황에서만 뜬다. 곱으로 펼치면 설정 화면에 **어디에도 안
 * 뜨는 배지의 스위치**가 61개 생기고, 관리자가 그 중 하나를 꺼도 아무 일이
 * 일어나지 않는다 — 끈 사람은 기능이 고장 난 것으로 읽는다. 그래서 배지마다
 * 「실제로 그려지는 자리」만 적고, 그 합이 29인지를 시험이 센다.
 *
 * ── 🔴 2026-11-13: 「수리건 상세 — 작업 이력 탭」 자리를 걷어냈다 ─────────
 * 같은 날 **자리 일곱 · 쌍 33**에서 지금의 수로 줄었다. 걷어낸 까닭은 위 문단과
 * 똑같다 — **그 자리를 그리는 화면이 없었다.** 「작업 이력」 탭이 실제로 그리는
 * 것은 DatabaseWorkHistoryScreen 하나이고 거기엔 배지가 한 개도 없다(탭 줄 **위**의
 * 머리 카드가 상태 배지를 맡고 있고, 그 자리는 repairCaseDetailHeader 로 따로 잡혀
 * 있다). 설정 화면에는 체크상자가 넷 서 있었는데 꺼도 화면이 하나도 안 바뀌었다.
 *
 * 🔴 **나중에 「작업 이력 탭에도 배지를 달자」는 생각이 들거든, 자리를 여기 먼저
 * 적지 마라 — 그릴 화면을 먼저 만들어라.** 등록부에 자리를 더하는 순간 설정 화면에
 * 스위치가 생기고, 그리는 쪽이 없으면 그 스위치는 거짓말이 된다. 순서는 ① 배지를
 * 실제로 그리는 화면 → ② 그 화면이 자리 키를 받아 판정을 타게 → ③ 여기에 자리 등록
 * 이다(그 역순이 이번에 되돌린 바로 그 모양이다).
 *
 * ── 🔴 모르는 키는 거절이 아니라 「보임」이다 ────────────────────────────
 * 판정(isBadgeVisible)은 어떤 문자열이 들어와도 던지지 않는다. 배지를 하나
 * 걷어내거나 뜨는 자리를 옮기는 날 DB 에는 옛 키의 행이 남아 있는데, 그때 이
 * 함수가 터지면 **그 배지를 쓰는 화면이 통째로 안 뜬다.** 틀리는 쪽을 고를 수
 * 있다면 「배지가 그대로 보인다」쪽이다 — 지금과 같은 화면이기 때문이다.
 * resolveUiText 가 등록부에 없는 키를 무시하는 것과 같은 판단이다.
 * ============================================================================
 */

/** 끄고 켤 수 있는 배지의 키. DB 의 badge_key 에 그대로 들어간다. */
export type BadgeKey =
  | "repairStatus"
  | "priority"
  | "source"
  | "overdue"
  | "dueDateNear"
  | "hold"
  | "workflowOverride"
  | "finalShipmentApproved"
  | "dueDateFromDomesticOrder"
  | "dueDateFromDomesticOrderShort"
  | "dueDateFromRepairCase"
  | "domesticOrderCompleted"
  | "dueDateRowCompleted"
  | "orderIssuedDateMissing"
  | "miscCaseStatus";

/** 배지가 그려지는 자리의 키. DB 의 place_key 에 그대로 들어간다. */
export type BadgePlaceKey =
  | "repairCaseList"
  | "repairCaseDetailHeader"
  | "repairCaseDetailBasicInfo"
  | "domesticOrderList"
  | "miscCaseList"
  | "miscCaseDetailHeader";

export type BadgePlace = {
  key: BadgePlaceKey;
  /** 설정 화면에 보일 한글 이름. 화면 이름 — 구역 꼴로 적는다. */
  label: string;
};

export type BadgeDefinition = {
  key: BadgeKey;
  /** 설정 화면에 보일 한글 이름. 되도록 **배지에 실제로 찍히는 글자** 그대로다. */
  label: string;
  /**
   * 🔴 「언제 뜨는 배지인가」를 적는다 — 이름만으로는 무엇을 끄는지 모른다.
   * 설정 화면에서 스위치 옆에 그대로 나갈 문장이라, 끄기 전에 읽고 판단할 수
   * 있어야 한다(ui-text-overrides.ts 의 usage 와 같은 자리).
   */
  description: string;
  /**
   * 이 배지가 **실제로 그려지는** 자리. 여기 적힌 자리만 설정 대상이 된다.
   * 차례는 아래 BADGE_PLACES 의 차례를 따른다 — 설정 화면이 자리를 그 차례로
   * 늘어놓기 때문에, 여기서 뒤섞으면 화면마다 순서가 달라 보인다.
   */
  places: readonly BadgePlaceKey[];
};

/**
 * 자리 여섯. 차례가 곧 설정 화면의 차례다(화면을 보는 사람이 메뉴를 훑는 순서).
 *
 * 🔴 **여기 적은 자리는 전부 「그 자리에 배지를 그리는 화면」이 있어야 한다.** 없는
 * 자리를 적으면 설정 화면에 꺼도 아무 일이 안 일어나는 스위치가 선다 — 2026-11-13 에
 * 「수리건 상세 — 작업 이력 탭」을 그 까닭으로 걷어냈다(머리말 참조).
 */
export const BADGE_PLACES: readonly BadgePlace[] = [
  { key: "repairCaseList", label: "전체 A/S 현황 — 목록" },
  { key: "repairCaseDetailHeader", label: "수리건 상세 — 머리말" },
  { key: "repairCaseDetailBasicInfo", label: "수리건 상세 — 기본 정보 탭" },
  { key: "domesticOrderList", label: "내자 정리 — 목록" },
  { key: "miscCaseList", label: "기타건 현황 — 목록" },
  { key: "miscCaseDetailHeader", label: "기타건 상세 — 머리말" },
];

/**
 * 배지 열다섯.
 *
 * 항목을 손으로 늘어놓는 이유는 ui-text-overrides.ts 의 등록부와 같다 — 배지
 * 컴포넌트를 훑어 자동으로 펼치면, 배지를 하나 더 그리는 날 **아무도 모르는
 * 사이에** 설정 화면이 함께 늘어난다. 늘리는 것은 사람의 판단이어야 하고, 그때
 * 「뜨는 자리」와 「설명 문구」를 같이 정하게 된다.
 */
export const BADGES: readonly BadgeDefinition[] = [
  {
    key: "repairStatus",
    label: "상태",
    description:
      "그 건이 지금 어느 단계인지. 접수·수리 중·출하 완료 등 12가지 중 하나가 항상 뜹니다",
    places: ["repairCaseList", "repairCaseDetailHeader", "repairCaseDetailBasicInfo"],
  },
  {
    key: "priority",
    label: "우선순위",
    description: "긴급·높음으로 접수된 건에만. 보통 건에는 안 뜹니다",
    places: ["repairCaseList", "repairCaseDetailHeader"],
  },
  {
    key: "source",
    label: "DB",
    description:
      "이 자료가 실제 데이터베이스에서 온 것이라는 표시. 개발용 가짜 자료와 구분하려고 만들었습니다",
    places: ["repairCaseList", "repairCaseDetailHeader", "repairCaseDetailBasicInfo"],
  },
  {
    key: "overdue",
    label: "납기 지연 / 정상",
    description: "고객 요청 납기일이 지났는데 아직 출하 전이면 「납기 지연」",
    places: ["repairCaseList", "repairCaseDetailHeader"],
  },
  {
    key: "dueDateNear",
    label: "납기 임박",
    description: "고객 요청 납기일이 오늘부터 7일 안에 들어왔을 때",
    places: ["repairCaseList", "repairCaseDetailHeader"],
  },
  {
    key: "hold",
    label: "보류 중",
    description: "그 건이 보류 상태일 때",
    places: ["repairCaseList", "repairCaseDetailHeader"],
  },
  {
    key: "workflowOverride",
    label: "로컬 워크플로 재정의",
    description: "그 건만 기본 작업 흐름과 다르게 바꿔 놓았을 때",
    places: ["repairCaseList", "repairCaseDetailHeader"],
  },
  {
    key: "finalShipmentApproved",
    label: "최종 출하 승인 완료",
    description: "최종 출하 승인이 끝난 건. 재승인이 필요해지면 사라집니다",
    places: [
      "repairCaseList",
      "repairCaseDetailHeader",
      "domesticOrderList",
      "miscCaseList",
      "miscCaseDetailHeader",
    ],
  },
  {
    key: "dueDateFromDomesticOrder",
    label: "내자 정리에서 작성됨",
    description:
      "고객 요청 납기일을 이 건이 직접 적은 게 아니라, 연결된 내자 정리 줄에서 가져왔다는 표시",
    places: ["repairCaseDetailBasicInfo"],
  },
  {
    key: "dueDateFromDomesticOrderShort",
    label: "(내자)",
    description: "바로 위와 같은 뜻을 목록에서 짧게 줄인 것",
    places: ["repairCaseList"],
  },
  {
    key: "dueDateFromRepairCase",
    label: "수리 건 요청일",
    description: "거꾸로, 내자 정리 쪽 날짜를 연결된 수리건에서 가져왔다는 표시",
    places: ["domesticOrderList"],
  },
  {
    key: "domesticOrderCompleted",
    label: "완료",
    description: "그 내자 정리 줄이 완료 처리됐을 때",
    places: ["domesticOrderList"],
  },
  {
    key: "dueDateRowCompleted",
    label: "회차별 완료",
    description: "납기요청일 줄 하나가 완료됐을 때",
    places: ["domesticOrderList"],
  },
  {
    key: "orderIssuedDateMissing",
    label: "발주일 미정",
    description: "발주일이 아직 안 정해졌을 때",
    places: ["domesticOrderList"],
  },
  {
    key: "miscCaseStatus",
    label: "기타건 상태",
    description: "기타건이 지금 어느 단계인지",
    places: ["miscCaseList", "miscCaseDetailHeader"],
  },
];

/** 배지 키만 차례대로. 설정 화면이 줄을 그리는 차례이기도 하다. */
export const BADGE_KEYS: readonly BadgeKey[] = BADGES.map((badge) => badge.key);

/** 자리 키만 차례대로. */
export const BADGE_PLACE_KEYS: readonly BadgePlaceKey[] = BADGE_PLACES.map((place) => place.key);

/** 설정 대상이 되는 (배지, 자리) 한 쌍. */
export type BadgePlacement = { badgeKey: BadgeKey; placeKey: BadgePlaceKey };

/**
 * 설정 대상이 되는 쌍 전부 — **29개**.
 *
 * 손으로 다시 적지 않고 등록부에서 펼친다. 두 벌로 적으면 배지의 places 를
 * 고치는 날 한쪽만 바뀌고, 둘 다 타입이 같아 tsc 가 침묵한다.
 */
export const BADGE_PLACEMENTS: readonly BadgePlacement[] = BADGES.flatMap((badge) =>
  badge.places.map((placeKey) => ({ badgeKey: badge.key, placeKey }))
);

const BADGE_BY_KEY: ReadonlyMap<string, BadgeDefinition> = new Map(
  BADGES.map((badge) => [badge.key as string, badge])
);

const BADGE_PLACE_BY_KEY: ReadonlyMap<string, BadgePlace> = new Map(
  BADGE_PLACES.map((place) => [place.key as string, place])
);

/**
 * 허용 쌍을 한 번에 찾기 위한 열쇠 집합. `badgeKey + " " + placeKey` 로
 * 잇는다 — 배지 키도 자리 키도 공백 없는 영문 식별자(camelCase)라, 이어 붙인
 * 글자가 다른 쌍의 것과 겹칠 수 없다. 두 쌍이 한 열쇠로 접히면 엉뚱한 자리의
 * 설정이 적용되는데, 그것은 오류 없이 화면에서만 드러난다.
 */
const ALLOWED_PLACEMENT_KEYS: ReadonlySet<string> = new Set(
  BADGE_PLACEMENTS.map((placement) => placementKey(placement.badgeKey, placement.placeKey))
);

function placementKey(badgeKey: string, placeKey: string): string {
  return `${badgeKey} ${placeKey}`;
}

/** 등록부에서 배지를 찾는다. 없으면 undefined — 던지지 않는다. */
export function findBadge(badgeKey: string): BadgeDefinition | undefined {
  return BADGE_BY_KEY.get(badgeKey);
}

/** 등록부에서 자리를 찾는다. 없으면 undefined — 던지지 않는다. */
export function findBadgePlace(placeKey: string): BadgePlace | undefined {
  return BADGE_PLACE_BY_KEY.get(placeKey);
}

/**
 * 이 배지가 이 자리에 실제로 그려지는가 — 곧 「설정할 수 있는 쌍인가」.
 *
 * 설정 화면(조각 2)이 스위치를 그릴지 정하는 데 쓰고, 저장 쪽이 들어온 쌍을
 * 거절하는 데 쓴다. 모르는 문자열에는 그냥 false 를 돌려준다.
 */
export function isBadgePlacementAllowed(badgeKey: string, placeKey: string): boolean {
  return ALLOWED_PLACEMENT_KEYS.has(placementKey(badgeKey, placeKey));
}

/**
 * 저장된 설정 한 줄. **끈 것만 행이 된다** — 다시 켜는 것은 행을 지우는 일이다.
 *
 * 칸이 `string` 인 이유는 DB 가 text 이기 때문이다(enum 을 쓰지 않은 까닭은
 * 스키마 주석에 있다). 등록부에서 사라진 옛 키의 행이 그대로 실려 올 수 있고,
 * 그것을 거르는 일은 읽는 쪽이 아니라 아래 판정이 한다.
 */
export type BadgeVisibilityRow = { badgeKey: string; placeKey: string; isVisible: boolean };

/** 설정이 하나도 없는 상태. 표가 아직 없는 DB 에서도 이 값으로 답한다. */
export const NO_BADGE_VISIBILITY_SETTINGS: readonly BadgeVisibilityRow[] = [];

/**
 * 이 자리에서 이 배지를 보일 것인가.
 *
 * 규칙은 셋뿐이다:
 *  1) 🔴 **허용되지 않는 쌍은 언제나 보임**이다. 코드가 잘못 물어도 배지가
 *     사라지지 않게 하려는 것이다 — 「숨김」으로 틀리면 화면에서 표식이 조용히
 *     없어지고 아무도 오류를 보지 못하지만, 「보임」으로 틀리면 지금과 똑같은
 *     화면일 뿐이다. 되돌릴 수 있는 쪽으로 틀린다.
 *  2) 그 쌍의 행이 없으면 보임. **빈 표 = 전부 보임**이 이 기능의 초기 상태다.
 *  3) 행이 있으면 그 행이 답한다.
 *
 * 🔴 어떤 문자열이 들어와도 던지지 않는다. 배지를 걷어내거나 자리를 옮긴 뒤 DB
 * 에 남은 옛 행이 화면을 통째로 죽이는 길을 만들지 않는다.
 *
 * ⚠️ 인자 타입이 `BadgeKey` 가 아니라 `string` 인 것은 위 1)·3)의 성질 때문이다
 * (옛 키를 그대로 물어볼 수 있어야 한다). 그래서 **부르는 쪽의 오타는 컴파일러가
 * 잡아 주지 못하고, 그 자리는 영영 「보임」으로 떨어진다** — 관리자가 스위치를
 * 꺼도 아무 일이 일어나지 않는 모양이다. 화면에 붙일 때(조각 3)는 이 파일의
 * 키 상수를 가져다 쓰는 편이 안전하다.
 */
export function isBadgeVisible(
  settings: readonly BadgeVisibilityRow[],
  badgeKey: string,
  placeKey: string
): boolean {
  if (!isBadgePlacementAllowed(badgeKey, placeKey)) return true;

  for (const row of settings) {
    if (row.badgeKey === badgeKey && row.placeKey === placeKey) return row.isVisible;
  }

  return true;
}
