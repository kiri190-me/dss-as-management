import {
  PERMISSION_AREAS,
  PERMISSION_LEVELS,
  permissionLevelRank,
  type PermissionLevel,
} from "./permission-areas";

/**
 * ============================================================================
 * 하위 기능 트리 — 메뉴 아래 단계의 권한 대상 (2026-08-19 승인)
 * ============================================================================
 * 메뉴 단위 권한만으로는 지금 정책을 표현할 수 없다. 예를 들어 고객사 영역에는
 * "End-User는 영업도 만들 수 있지만 이름 변경은 관리자만"이라는 구분이 있는데,
 * 이걸 "고객사 = 읽기+쓰기" 한 칸에 접으면 영업이 이름까지 고칠 수 있게 된다.
 * 그래서 실제 정책이 갈라지는 지점마다 노드를 하나씩 둔다.
 *
 * ── 저장되는 값은 잎(leaf)에만 있다 ─────────────────────────────────────
 * 하위 기능이 있는 메뉴는 **자기 자신의 값을 저장하지 않는다.** 메뉴의 수준은
 * 하위 기능들의 최대값으로 계산된다. 메뉴와 하위 기능을 따로 저장하면 "메뉴는
 * 읽기인데 하위 기능은 쓰기" 같은 앞뒤 안 맞는 상태가 만들어지고, 그때 무엇이
 * 이기는지를 화면에서 설명할 방법이 없다.
 *
 * 하위 기능이 없는 메뉴(대시보드처럼 갈라질 것이 없는 곳)는 메뉴 자체가 잎이고,
 * 그 키가 그대로 저장된다.
 *
 * ── 키는 경로다 ─────────────────────────────────────────────────────────
 * "inventory.parts"처럼 점으로 잇는다. role_permissions.area_key가 자유
 * 텍스트라서 저장 구조를 바꾸지 않고 그대로 들어간다 — 마이그레이션이 필요
 * 없다는 뜻이다.
 *
 * ── 설명은 화면에 그대로 나간다 ─────────────────────────────────────────
 * description은 "이 기능이 무엇인가"를 한 줄로, levelHints는 "이 수준을 고르면
 * 무엇이 되는가"를 수준마다 한 조각으로 적는다. 권한을 정하는 사람은 코드를
 * 읽지 않으므로, 여기 적힌 말이 그 사람이 가진 정보의 전부다. 수준이 하나뿐인
 * 노드는 levelHints를 생략한다 — 고를 것이 없는데 설명을 붙이면 오히려 무언가
 * 달라진다고 믿게 된다.
 *
 * ── 여기서 정하지 않는 것 ───────────────────────────────────────────────
 * 맥락 조건(내가 담당자인가, 접수 건이 잠겨 있는가, 요청이 PENDING인가)은
 * 권한 수준으로 표현하지 않는다. 4단계 사다리는 "누가"를 말할 뿐 "언제"를
 * 말하지 못한다. 그런 조건은 지금처럼 *-authorization.ts의 맥락 인자가 계속
 * 판정한다 — 이 트리는 그중 **역할 부분만** 대신한다.
 * ============================================================================
 */

export type PermissionFeature = {
  /** 저장되는 키. "<areaKey>.<featureKey>" 형태의 경로다. */
  key: string;
  areaKey: string;
  label: string;
  /** 이 기능이 무엇인지 한 줄. 화면에 그대로 보여 준다. */
  description: string;
  /**
   * 수준을 고르면 무엇이 되는지. 화면에서 드롭다운 옆에 붙는다.
   * 수준이 하나뿐인 노드(조회 전용 등)는 생략한다.
   */
  levelHints?: Partial<Record<PermissionLevel, string>>;
  /** 이 기능에서 의미가 있는 가장 높은 수준. 그 위는 드롭다운에 만들지 않는다. */
  maxMeaningfulLevel: PermissionLevel;
  /**
   * 이 기능에서 의미가 있는 가장 낮은 수준(접근 불가 제외). 기본값은 읽기다.
   *
   * '삭제·복원'이나 '발행'처럼 조작 하나만 있는 노드에서는 읽기·쓰기를 골라도
   * 아무것도 달라지지 않는다. 그런 칸을 선택지로 내밀면 고른 사람이 무언가
   * 달라졌다고 믿게 되므로, 아예 만들지 않고 '접근 불가 아니면 관리'만 남긴다.
   *
   * '편집' 노드에 읽기가 없는 것도 같은 이유다 — 보는 것은 같은 메뉴의 '조회'
   * 노드가 이미 맡고 있어서, 편집 노드의 읽기는 조회 노드와 구분되지 않는다.
   */
  minMeaningfulLevel?: PermissionLevel;
  /**
   * 설정으로 건드릴 수 없는 노드. 화면에는 보이되 '고정'으로 잠긴다.
   *
   * 지금은 '역할별 접근 권한 설정' 하나뿐이다. 이 화면의 접근을 설정으로 막을 수
   * 있게 하면 잘못 저장한 순간 아무도 되돌릴 수 없다 — 권한 설정 화면만은
   * 설정보다 위에 있어야 한다(role-permission-authorization.ts). 목록에서 빼지
   * 않고 잠가서 보여 주는 이유는, 안 보이면 "왜 이 역할은 권한 화면에 들어가지나"를
   * 화면 어디에서도 알 수 없기 때문이다.
   */
  fixed?: boolean;
};

type FeatureSeed = Omit<PermissionFeature, "key" | "areaKey">;

function features(areaKey: string, seeds: Record<string, FeatureSeed>): PermissionFeature[] {
  return Object.entries(seeds).map(([suffix, seed]) => ({
    key: `${areaKey}.${suffix}`,
    areaKey,
    ...seed,
  }));
}

/**
 * 메뉴 → 하위 기능. 여기에 없는 메뉴는 하위 기능이 없다는 뜻이고, 그 메뉴 자체가
 * 잎이 된다.
 */
const FEATURES_BY_AREA: Record<string, PermissionFeature[]> = {
  repairCases: features("repairCases", {
    view: {
      label: "접수 건 조회",
      description: "접수 건 목록과 상세 화면을 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    edit: {
      label: "접수 건 수정",
      minMeaningfulLevel: "WRITE",
      description: "접수·제품·고장 정보를 고칩니다.",
      levelHints: { WRITE: "내용을 고칠 수 있습니다" },
      maxMeaningfulLevel: "WRITE",
    },
    workRecords: {
      label: "작업 기록",
      description: "무슨 작업을 했는지 남기는 기록입니다.",
      levelHints: {
        READ: "남의 기록까지 보기만 합니다",
        WRITE: "기록을 남깁니다",
        MANAGE: "잘못된 기록을 무효화합니다",
      },
      maxMeaningfulLevel: "MANAGE",
    },
    lifecycle: {
      label: "삭제·복원",
      minMeaningfulLevel: "MANAGE",
      description: "접수 건 자체를 지우거나 되살립니다.",
      levelHints: { MANAGE: "일괄 삭제, 휴지통 복원, 영구 삭제" },
      maxMeaningfulLevel: "MANAGE",
    },
    procedureExecution: {
      // 절차 '문서'를 고치는 것은 기술 작업 절차 메뉴지만, 절차를 실제로 밟는
      // 일은 접수 건 화면에서 일어난다. 문서 쪽에 달아 두면 절차를 볼 수 없는
      // 역할에게 그 메뉴가 열려 버린다.
      label: "작업 절차 수행",
      description: "접수 건에서 정해진 작업 절차를 밟습니다.",
      levelHints: {
        READ: "진행 상황을 보기만 합니다",
        WRITE: "단계를 진행하고 완료 처리합니다",
        MANAGE: "이미 끝난 단계를 되돌립니다",
      },
      maxMeaningfulLevel: "MANAGE",
    },
  }),

  diagnosisFlowcharts: features("diagnosisFlowcharts", {
    view: {
      label: "흐름도 조회",
      description: "접수 건에 붙은 진단 흐름도를 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    edit: {
      // '담당이 아닌 건까지'를 따로 두지 않는 이유: 지금 코드가 그 구분을 하지
      // 않는다(canManageRepairCaseFlowchartsGlobally는 canMutateRepairCaseFlowchart를
      // 그대로 부른다). 코드에 없는 구분을 노드로 만들면 화면이 정책을 지어내게 된다.
      label: "흐름도 편집",
      minMeaningfulLevel: "WRITE",
      description: "흐름도를 만들고 고칩니다. 담당이 아닌 건도 포함합니다.",
      levelHints: { WRITE: "만들고, 고치고, 되살립니다" },
      maxMeaningfulLevel: "WRITE",
    },
    permanentDelete: {
      // 편집보다 좁다 — 편집은 엔지니어까지 되지만 영구 삭제는 관리자 이상만이다.
      // 이 둘을 한 칸에 접었다가 엔지니어에게 영구 삭제가 열리는 사고가 났고,
      // 통합 테스트가 잡았다. 하위 기능 트리를 만든 이유가 정확히 이것이다.
      label: "영구 삭제",
      minMeaningfulLevel: "MANAGE",
      description: "휴지통의 흐름도를 되돌릴 수 없게 지웁니다.",
      levelHints: { MANAGE: "영구 삭제합니다 — 되돌릴 수 없습니다" },
      maxMeaningfulLevel: "MANAGE",
    },
  }),

  workflows: features("workflows", {
    view: {
      label: "워크플로 조회",
      description: "워크플로 템플릿과 버전 목록을 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    editDraft: {
      label: "초안 편집",
      description: "아직 발행하지 않은 초안의 단계와 전이를 고칩니다.",
      minMeaningfulLevel: "WRITE",
      levelHints: { WRITE: "초안을 고칩니다 (진행 중인 건에는 영향 없음)" },
      maxMeaningfulLevel: "WRITE",
    },
    publish: {
      label: "발행",
      minMeaningfulLevel: "MANAGE",
      description: "초안을 실제로 쓰이는 버전으로 올립니다.",
      levelHints: { MANAGE: "발행합니다 — 진행 중인 접수 건에 바로 반영됩니다" },
      maxMeaningfulLevel: "MANAGE",
    },
  }),

  users: features("users", {
    view: {
      label: "계정 목록 조회",
      description: "사용자 목록과 각자의 역할을 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    shipmentRepresentatives: {
      label: "출하 대표자 지정",
      minMeaningfulLevel: "MANAGE",
      description: "출하 승인을 대신할 사람을 정합니다.",
      levelHints: { MANAGE: "대표자를 지정하고 위임을 관리합니다" },
      maxMeaningfulLevel: "MANAGE",
    },
    rolePermissions: {
      label: "역할별 접근 권한 설정",
      description: "지금 보고 있는 이 화면입니다. 관리자 이상에게 고정되어 있어 여기서 여닫을 수 없습니다.",
      // 고를 수 없는 노드이므로 중간 수준을 만들지 않는다 — 잠긴 드롭다운에
      // 선택지가 여러 개 보이면 잠긴 이유를 오해하게 된다.
      minMeaningfulLevel: "MANAGE",
      maxMeaningfulLevel: "MANAGE",
      fixed: true,
    },
  }),

  customers: features("customers", {
    view: {
      label: "고객사 조회",
      description: "고객사와 End-User 목록을 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    edit: {
      label: "고객사 정보 수정",
      minMeaningfulLevel: "WRITE",
      description: "고객사 자체의 정보를 고칩니다.",
      levelHints: { WRITE: "고객사 정보를 고칩니다" },
      maxMeaningfulLevel: "WRITE",
    },
    endUsers: {
      label: "End-User",
      minMeaningfulLevel: "WRITE",
      description: "고객사 아래의 실사용처를 관리합니다.",
      levelHints: {
        WRITE: "새 End-User를 등록합니다",
        MANAGE: "기존 End-User의 이름까지 고칩니다",
      },
      maxMeaningfulLevel: "MANAGE",
    },
    contacts: {
      label: "담당자 정보",
      minMeaningfulLevel: "WRITE",
      description: "End-User 쪽 연락 담당자입니다.",
      levelHints: {
        WRITE: "담당자를 추가하고 수정합니다",
        MANAGE: "담당자를 삭제합니다",
      },
      maxMeaningfulLevel: "MANAGE",
    },
  }),

  productModels: features("productModels", {
    view: {
      label: "제품 모델 조회",
      description: "제품 모델 마스터를 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    edit: {
      label: "제품 모델 수정",
      minMeaningfulLevel: "WRITE",
      description: "제품 모델을 만들고 고칩니다.",
      levelHints: { WRITE: "모델을 만들고 고칩니다" },
      maxMeaningfulLevel: "WRITE",
    },
  }),

  technicalProcedures: features("technicalProcedures", {
    view: {
      label: "절차 조회",
      description: "발행된 작업 절차 문서를 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    editDraft: {
      label: "초안 편집",
      description: "절차 초안의 단계·체크리스트·참고자료를 고칩니다.",
      minMeaningfulLevel: "WRITE",
      levelHints: { WRITE: "초안을 고칩니다" },
      maxMeaningfulLevel: "WRITE",
    },
    publish: {
      label: "발행·보관",
      minMeaningfulLevel: "MANAGE",
      description: "절차를 실제로 쓰이게 하거나 쓰지 않게 합니다.",
      levelHints: { MANAGE: "발행하고, 오래된 절차를 보관 처리합니다" },
      maxMeaningfulLevel: "MANAGE",
    },
    validation: {
      label: "검증 이슈 처리",
      description: "절차 검증에서 걸린 항목을 다룹니다.",
      levelHints: { READ: "걸린 항목을 보기만 합니다", WRITE: "해소 처리합니다" },
      maxMeaningfulLevel: "WRITE",
    },
  }),

  inventory: features("inventory", {
    view: {
      label: "재고 조회",
      description: "부품 목록과 현재 수량을 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    parts: {
      label: "부품 등록·수정",
      minMeaningfulLevel: "WRITE",
      description: "부품 마스터를 만들고 고칩니다.",
      levelHints: { WRITE: "부품을 만들고 고칩니다" },
      maxMeaningfulLevel: "WRITE",
    },
    stock: {
      label: "입출고 처리",
      minMeaningfulLevel: "WRITE",
      description: "실제 재고 수량을 움직입니다.",
      levelHints: { WRITE: "입고·반품·사용을 기록합니다" },
      maxMeaningfulLevel: "WRITE",
    },
    history: {
      label: "입출고 이력 조회",
      description: "부품이 언제 얼마나 드나들었는지 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    requests: {
      label: "부품 요청",
      description: "엔지니어가 수리에 필요한 부품을 달라고 올리는 요청입니다.",
      levelHints: { READ: "요청 목록을 봅니다", WRITE: "요청을 올리고 자기 요청을 취소합니다" },
      maxMeaningfulLevel: "WRITE",
    },
    requestProcessing: {
      label: "부품 요청 처리",
      minMeaningfulLevel: "MANAGE",
      description: "올라온 요청에 답하는 쪽입니다.",
      levelHints: { MANAGE: "요청을 출고·거부·부분 마감합니다" },
      maxMeaningfulLevel: "MANAGE",
    },
  }),
};

/**
 * ============================================================================
 * 설정이 실제 판정을 지배하는 메뉴 — 전환이 끝난 곳
 * ============================================================================
 * 권한 판정을 *-authorization.ts의 함수에서 이 설정으로 옮기는 작업은 메뉴
 * 단위로 진행한다. 한 번에 다 바꾸면 어디서 회귀가 났는지 짚을 수 없기 때문이다.
 *
 * 여기 있는 메뉴는 mutation·페이지·화면이 모두 설정을 보므로, 넓힌 값이 실제로
 * 그 조작을 연다. 여기 없는 메뉴는 아직 기존 함수가 최종 관문이라 **넓혀도
 * 열리지 않을 수 있다** — 화면이 그 사실을 그대로 말해야 한다. 말하지 않으면
 * 관리자는 열어 줬다고 믿고, 사용자는 여전히 막힌 채로 서로 다른 화면을 본다.
 * ============================================================================
 */
const SETTINGS_ENFORCED_AREAS = new Set<string>([
  "inventory",
  "customers",
  "productModels",
  "workflows",
  "technicalProcedures",
  "diagnosisFlowcharts",
]);

/**
 * 메뉴 전체가 아니라 노드 하나만 전환된 경우.
 *
 * '전체 A/S 현황'이 그렇다 — 조회·작업 기록·삭제복원·절차 수행은 설정이
 * 판정하지만, **접수 건 수정은 그럴 수 없다.** 그 정책은 역할별 편집 가능
 * 필드 목록(EDITABLE_FIELDS_BY_ROLE)이라 4단계 사다리보다 잘다. 예를 들어
 * 영업은 접수 정보와 고장·서비스는 고치지만 제품 정보는 못 고치는데, 이 구분은
 * 수준 하나로 접히지 않는다. 접으면 영업에게 제품 정보가 열린다.
 *
 * 그래서 그 노드만 남겨 두고, 화면이 노드별로 사실대로 말한다.
 */
const SETTINGS_ENFORCED_LEAVES = new Set<string>([
  "repairCases.view",
  "repairCases.workRecords",
  "repairCases.lifecycle",
  "repairCases.procedureExecution",
]);

/** 이 노드의 설정이 실제 판정을 지배하는가. */
export function isSettingsEnforced(key: string): boolean {
  if (key.includes(".")) {
    return SETTINGS_ENFORCED_AREAS.has(key.split(".")[0]) || SETTINGS_ENFORCED_LEAVES.has(key);
  }
  // 메뉴는 하위가 **전부** 전환됐을 때만 전환된 것으로 본다. 하나라도 남아
  // 있으면 "이 메뉴는 설정이 최종 판정"이라고 말할 수 없다.
  if (SETTINGS_ENFORCED_AREAS.has(key)) return true;
  const children = featuresOfArea(key);
  return children.length > 0 && children.every((feature) => SETTINGS_ENFORCED_LEAVES.has(feature.key));
}

/** 이 메뉴의 하위 기능. 없으면 빈 배열이고, 그때는 메뉴 자체가 잎이다. */
export function featuresOfArea(areaKey: string): readonly PermissionFeature[] {
  return FEATURES_BY_AREA[areaKey] ?? [];
}

export function hasFeatures(areaKey: string): boolean {
  return featuresOfArea(areaKey).length > 0;
}

/**
 * 값이 저장되는 노드 전부. 하위 기능이 있는 메뉴는 자기 키가 여기 없다 —
 * 그 메뉴의 수준은 하위 기능에서 계산되기 때문이다.
 */
export const PERMISSION_LEAF_KEYS: readonly string[] = PERMISSION_AREAS.flatMap((area) =>
  hasFeatures(area.key) ? featuresOfArea(area.key).map((feature) => feature.key) : [area.key]
);

const LEAF_KEY_SET = new Set(PERMISSION_LEAF_KEYS);
const FEATURE_BY_KEY = new Map(
  Object.values(FEATURES_BY_AREA)
    .flat()
    .map((feature) => [feature.key, feature])
);

export function isPermissionLeafKey(key: string): boolean {
  return LEAF_KEY_SET.has(key);
}

export function findPermissionFeature(key: string): PermissionFeature | undefined {
  return FEATURE_BY_KEY.get(key);
}

/** 이 잎이 속한 메뉴. 잎이 메뉴 자체이면 그 메뉴 키를 그대로 돌려준다. */
export function areaKeyOfLeaf(leafKey: string): string {
  return FEATURE_BY_KEY.get(leafKey)?.areaKey ?? leafKey;
}

/** 이 잎에서 의미가 있는 가장 높은 수준. */
export function maxMeaningfulLevelOfLeaf(leafKey: string): PermissionLevel {
  const feature = FEATURE_BY_KEY.get(leafKey);
  if (feature) return feature.maxMeaningfulLevel;
  const area = PERMISSION_AREAS.find((candidate) => candidate.key === leafKey);
  return area?.maxMeaningfulLevel ?? "NONE";
}

/**
 * 메뉴의 수준 = 하위 기능 중 가장 높은 값. 하위 기능이 없으면 메뉴 자신의 값.
 *
 * 이 계산은 세 곳에서 필요하다 — 실효 권한을 구하는 resolver, 저장 전에 잠금을
 * 검사하는 mutation, 그리고 저장 전 초안을 보여 주는 화면. 세 곳에 각자 적어
 * 두면 한 곳만 고쳐지는 날이 오고, 그러면 "화면에는 열려 보이는데 실제로는
 * 막히는"(또는 그 반대의) 어긋남이 생긴다. 그래서 값을 인자로 받는 순수 함수로
 * 한 번만 적는다 — 부르는 쪽이 저장된 값이든 초안이든 넘기면 된다.
 */
export function areaLevelFromLeaves(
  areaKey: string,
  levelOf: (leafKey: string) => PermissionLevel
): PermissionLevel {
  if (!hasFeatures(areaKey)) return levelOf(areaKey);
  return featuresOfArea(areaKey).reduce<PermissionLevel>((acc, feature) => {
    const level = levelOf(feature.key);
    return permissionLevelRank(level) > permissionLevelRank(acc) ? level : acc;
  }, "NONE");
}

/** 이 잎에서 의미가 있는 가장 낮은 수준(접근 불가 제외). 기본은 읽기다. */
export function minMeaningfulLevelOfLeaf(leafKey: string): PermissionLevel {
  return FEATURE_BY_KEY.get(leafKey)?.minMeaningfulLevel ?? "READ";
}

/**
 * 이 잎에서 실제로 고를 수 있는 수준 — 접근 불가 + [최소, 최대] 구간.
 *
 * 화면의 드롭다운은 이 목록만 내놓는다. 골라도 아무것도 달라지지 않는 칸을
 * 내밀지 않는 것이, 고른 사람이 무언가 했다고 착각하지 않게 하는 유일한 방법이다.
 */
export function selectableLevelsOfLeaf(leafKey: string): PermissionLevel[] {
  const min = permissionLevelRank(minMeaningfulLevelOfLeaf(leafKey));
  const max = permissionLevelRank(maxMeaningfulLevelOfLeaf(leafKey));
  return PERMISSION_LEVELS.filter((level) => {
    if (level === "NONE") return true;
    const rank = permissionLevelRank(level);
    return rank >= min && rank <= max;
  });
}

/**
 * 이 잎에서 그 수준을 고르면 무엇이 되는지 한 조각.
 *
 * 하위 기능에는 각자 적어 둔 문구를, 하위 기능이 없는 메뉴에는 수준의 일반
 * 설명(permission-areas.ts)을 쓰도록 화면이 갈라 쓴다. 여기서 undefined가
 * 나오면 "이 노드에서 그 수준은 따로 설명할 것이 없다"는 뜻이다.
 */
export function levelHintOfLeaf(leafKey: string, level: PermissionLevel): string | undefined {
  return FEATURE_BY_KEY.get(leafKey)?.levelHints?.[level];
}
