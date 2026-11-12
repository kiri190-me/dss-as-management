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
 * "inventory.requests"처럼 점으로 잇는다. role_permissions.area_key가 자유
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
   * 목록에서 빼지 않고 잠가서 보여 주는 이유는, 안 보이면 "왜 이 역할은 권한
   * 화면에 들어가지나"를 화면 어디에서도 알 수 없기 때문이다.
   *
   * 🔴 **고정이면 levelHints 가 화면에 안 뜬다**(RolePermissionSettings.tsx 의
   * `{!isFixed && …}`). 그래서 고정 노드에서 할 말은 **전부 description 과 아래
   * notice 에** 담아야 한다 — levelHints 에 적어 두면 아무도 못 읽는다.
   */
  fixed?: PermissionFixedNode;
};

/**
 * '고정'의 사정. boolean 이 아닌 까닭은 **고정인 까닭이 둘**이고, 그 둘이 화면
 * 문구와 메뉴 전환 판정 양쪽에서 갈리기 때문이다(2026-11-12 넷째).
 *
 *  · `users.rolePermissions` — 설정이 **표현할 수는 있는데 일부러 밖에 둔** 칸이다.
 *    이 화면의 접근을 설정으로 막을 수 있게 하면 잘못 저장한 순간 아무도 되돌릴 수
 *    없다(role-permission-authorization.ts).
 *  · `repairCases.edit` — 설정이 **애초에 표현할 수 없는** 칸이다. 역할마다 고칠 수
 *    있는 칸이 달라 4단계 사다리에 접히지 않는다(EDITABLE_FIELDS_BY_ROLE).
 *
 * 🔴 두 까닭을 한 문장으로 덮으면 **둘 다 안 읽힌다.** 2026-11-12 까지 화면에는
 * 「되돌릴 사람이 아무도 남지 않습니다」 한 문장이 모든 고정 칸에 공통으로 붙어
 * 있었는데, 그것은 위 첫째의 까닭이라 둘째 칸에 붙으면 **사실이 아니다.**
 */
export type PermissionFixedNode = {
  /**
   * 화면의 '고정' 안내 상자에 그대로 나가는 한 문단. 생략하면
   * DEFAULT_FIXED_NOTICE 를 쓴다 — 새 고정 노드를 만들면서 까닭을 안 적어도
   * 빈 상자가 뜨지는 않게 한다.
   */
  notice?: string;
  /**
   * 이 잎을 메뉴의 '하위가 전부 전환됐는가' 셈(isSettingsEnforced)에서 **뺄 것인가.**
   *
   * 🔵 기본값은 false(= 빼지 않고 센다)다. 고정이면서 전환도 안 된 잎이 하나라도
   * 있으면 그 메뉴는 「아직 코드가 최종 판정」으로 남는 쪽이 사실에 가깝다 —
   * 설정이 건드릴 수 없는 판정이 그 메뉴 안에 **실제로 살아 있다**는 뜻이기
   * 때문이다. 담을 수 없을 때는 넓게 말하지 않는 쪽이 맞다(아래
   * SETTINGS_ENFORCED_LEAVES 의 주간보고 문단과 같은 판단).
   *
   * 🔴 그래서 `users.rolePermissions` 만 true 다. 그 잎은 설정 밖에 **일부러** 둔
   * 칸이라, 그것 때문에 '사용자 관리'가 영원히 전환 중으로 보이면 화면이 거짓말을
   * 하는 셈이 된다. 반대로 `repairCases.edit` 는 지금도 코드가 최종 판정이라
   * 세어야 한다 — '전체 A/S 현황'이 전환 완료로 보이면 안 된다.
   *
   * 🔵 아래 `doesNotRaiseAreaLevel` 과 **다른 물음**이다. 이쪽은 화면이 고를 말
   * (「설정이 최종 판정인가」)을 정하고, 저쪽은 **실제 메뉴 수준**을 정한다. 한 잎에
   * 둘이 함께 붙을 수도 있어서 칸을 따로 둔다.
   */
  excludedFromAreaTransition?: boolean;
  /**
   * 이 잎이 **메뉴 수준을 올리지 않는다**(areaLevelFromLeaves 의 최대값 셈에서 빠진다).
   *
   * 🔴 **장식 잎에만 붙인다.** `repairCases.edit` 이 그것이다 — 코드가 칸 단위로 실제
   * 판정을 들고 있어서(EDITABLE_FIELDS_BY_ROLE) 이 잎의 설정값은 **아무 뜻도 없다.**
   * 그런 잎이 메뉴 수준을 떠받치면 「접수 건 수정」 하나가 '전체 A/S 현황' 메뉴를
   * 혼자 열린 채로 붙잡는다 — 고정이라 닫을 수도 없으니 **관리자가 그 메뉴를 영영 못
   * 닫는다.** 실제로 그 상태를 한 번 만들어 보고 되돌린 자리다(2026-11-12 넷째):
   * '하위 기능 전부 닫기'를 눌러도 메뉴 수준이 접근 불가로 안 내려갔고, 「갈 곳이
   * 하나도 안 남는 저장」을 막는 관문이 영업에게는 닿을 수 없는 것이 되어 있었다.
   *
   * 🔴 **`users.rolePermissions` 에는 붙이지 않는다.** 그 잎은 장식이 아니다 —
   * 설정으로 못 바꿀 뿐 「권한 설정 화면에 들어갈 수 있는가」라는 실제 판정을 담고
   * 있고(role-permission-authorization.ts), '사용자 관리' 메뉴를 떠받치는 것이 맞다.
   *
   * 🔵 **빼도 지금 열린 문은 한 짝도 안 닫힌다**: 실측으로 다섯 역할 × 메뉴 21개의
   * 수준이 빼기 전과 **한 칸도 다르지 않다**(permission-settings-truth.test.ts 의 표).
   * `repairCases.files` 가 다섯 역할 전부 읽기+쓰기라 최대값을 그쪽이 들고 있다.
   */
  doesNotRaiseAreaLevel?: boolean;
};

/**
 * 까닭을 따로 적지 않은 고정 노드에 붙는 안내. 2026-11-12 까지 **모든** 고정 칸에
 * 붙던 그 문장 그대로다 — 기본값을 바꾸면 새 고정 노드가 생기는 날 조용히 다른
 * 말을 하게 된다.
 */
const DEFAULT_FIXED_NOTICE =
  "이 기능은 설정으로 여닫을 수 없습니다. 여기를 잠글 수 있게 하면, 잘못 저장한 순간 권한을 되돌릴 사람이 아무도 남지 않습니다.";

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
      // ── 🔴 2026-11-12(넷째): **고정으로 잠갔다** ───────────────────────────────
      // 이 칸은 **양방향 다 장식이었다.** 저장 경로(server/actions/update-repair-case.ts)가
      // 부르는 것은 `authorizeSubmittedFields` → `EDITABLE_FIELDS_BY_ROLE` 하드코딩 표이고,
      // 화면도 `editableFieldsForRoleInSection` 을 직접 부른다. 🔴 `hasPermission(…
      // "repairCases.edit" …)` 호출은 **저장소 전체에 0건**이다 — 넓혀도 안 열리고
      // **좁혀도 안 막힌다.** 만질 수 있는데 아무 효과가 없는 칸은 고른 사람에게
      // 「무언가 했다」고 믿게 하므로, 이 파일이 minMeaningfulLevel 을 두는 그 까닭으로
      // 아예 만질 수 없게 했다(2026-11-12 사용자 결정).
      //
      // 🔴 **이것은 버그가 아니라 의도다.** 역할마다 고칠 수 있는 **칸**이 달라
      // (예: 영업은 인수·고장 정보는 고치지만 제품 정보는 못 고친다) 4단계 사다리
      // 한 칸으로 접히지 않는다 — 접으면 영업에게 제품 정보가 통째로 열린다.
      // 아래 SETTINGS_ENFORCED_LEAVES 머리말이 그 결정의 원본이다.
      //
      // 🔴 **기본값(permission-baseline.ts 의 같은 case)은 건드리지 않았다.** 화면의
      // 「기본 정책」 칸으로 계속 보여야 하고, 그 값이 메뉴 수준(= 잎들의 최대값)
      // 계산에 들어간다 — 지우면 '전체 A/S 현황' 메뉴 수준이 통째로 내려앉는다.
      //
      // 🔴 **levelHints 를 걷어냈다.** 고정 노드에서는 화면이 그것을 아예 안 그리므로
      // (RolePermissionSettings.tsx 의 `{!isFixed && …}`), 거기 적힌 「내용을 고칠 수
      // 있습니다」는 **누구에게도 안 보이면서 아래 설명과 정반대인** 글이 된다.
      // 역할별 실제 규칙은 전부 description 으로 옮겼다.
      label: "접수 건 수정",
      minMeaningfulLevel: "WRITE",
      description:
        "지금 이 항목은 아무것도 여닫지 않습니다 — [읽기+쓰기]로 넓혀도 열리지 않고, [접근 불가]로 좁혀도 막히지 않습니다. 접수 건 상세 「기본 정보」 탭의 세 카드(인수 정보 · 제품 정보 · 고장 및 서비스 정보)는 역할마다 고칠 수 있는 칸이 서로 달라서, [접근 불가]와 [읽기+쓰기] 두 단으로 접히지 않습니다 — 접으면 지금 못 고치는 칸이 함께 열립니다. 그래서 칸 단위 목록을 코드가 그대로 들고 있고, 이 줄은 그 규칙을 보여 주기만 합니다. 실제 규칙은 이렇습니다. 최고관리자와 관리자는 세 카드의 모든 칸을 고칩니다. A/S 엔지니어는 인수 정보의 담당자 성함·연락처(전화)·연락처(이메일) 세 칸과 제품 정보의 「새 모델로 등록」만 빼고 전부 고칩니다. 영업 담당자는 인수 정보에서 유상/무상 · 우선순위 · 사내 목표 검수 완료일 · 사내 목표 완료일 · 실제 출하일 · 보고서번호를 고칠 수 없고, 고장 및 서비스 정보는 비고 한 칸만 고치며, 제품 정보는 [수정] 단추 자체가 뜨지 않습니다. 재고 담당자는 세 카드 모두 [수정] 단추가 없습니다 — 읽기 전용입니다. 이 규칙을 바꾸는 일은 설정이 아니라 코드(역할별 편집 가능 칸 목록)에서 합니다.",
      maxMeaningfulLevel: "WRITE",
      fixed: {
        notice:
          "이 항목은 설정으로 여닫을 수 없습니다. 역할마다 고칠 수 있는 칸이 서로 달라 [접근 불가]와 [읽기+쓰기] 두 단으로 접히지 않아서, 어느 쪽을 골라도 실제로 달라지는 것이 없기 때문입니다. 지금 누가 무엇을 고치는지는 위 설명에 적어 두었습니다.",
        // 🔴 **메뉴 수준을 떠받치지 않는다.** 아무것도 여닫지 않는 잎이 '전체 A/S 현황'
        // 메뉴를 혼자 열린 채로 붙잡으면, 고정이라 닫을 수도 없어 관리자가 그 메뉴를
        // 영영 못 닫는다 — 잠그고 나서 실제로 그렇게 됐다가 되돌린 자리다(그 칸 주석).
        doesNotRaiseAreaLevel: true,
      },
    },
    workRecords: {
      // 🔴 2026-11-12 에 이름표가 「작업 기록」에서 **「작업내용」**으로 바뀌었다.
      // 🔴 **키(`workRecords`)는 한 글자도 바뀌지 않았다** — 운영 role_permissions 에
      // 그 글자로 저장돼 있어서, 키를 바꾸면 저장된 행이 가리킬 곳을 잃고 **오류 없이
      // 조용히** 기본값으로 되돌아간다(inventory.requests 에 적어 둔 그 함정).
      //
      // 이름을 바꾼 까닭: 이 잎이 같은 날부터 수리 건 상세의 **[작업내용] 탭**을 여는
      // 열쇠 가운데 하나가 됐다(auth/repair-case-detail-tab-permissions.ts). 권한을
      // 정하는 사람이 보는 것은 화면의 탭 이름이지 코드의 개념이 아닌데, 이웃 잎 넷
      // (파일 관리 · 작업 이력 · 보고서 · 검수/승인)이 전부 탭 이름이라 이것만 다른
      // 글자면 어느 탭인지 알 수 없다.
      //
      // 🔴 **이것 하나로는 탭이 안 닫힌다.** 그 탭에는 기능이 셋 산다 — 작업 기록 작성 ·
      // 워크플로 단계 변경 · 「작업 절차 수행」(app/(app)/repair-cases/[id]/execution/page.tsx).
      // 그래서 탭은 이 잎 **또는** `repairCases.procedureExecution` 중 하나라도 읽기
      // 이상이면 열린다(OR). 여기만 닫으면 **탭은 그대로 보이고** 작업 기록을 적는
      // 자리만 막힌다. 한 기능의 권한으로 탭 전체를 닫으면 나머지 둘이 길을 잃는다 —
      // 절차 수행으로 가는 입구는 저장소에 그 탭 하나뿐이다.
      //
      // 🔴 **아래 설명의 가운데 토막은 장식이 아니다.** 워크플로 단계 변경에는 여닫을
      // 잎이 아예 없는데(2026-11-12 결정 — repair-case-detail-tab-permissions.ts 의
      // 그 문단) 둘을 다 닫으면 그 조작까지 길을 잃는다. 그 사실을 적어 두지 않으면
      // **닫은 사람이 자기가 무엇을 껐는지 모른다** — 이 조각에서 가장 걱정한 자리다.
      // 이 글은 역할별 접근 권한 화면의 오른쪽 머리 문단에 그대로 나간다
      // (components/users/RolePermissionSettings.tsx 의 selectedFeature?.description).
      label: "작업내용",
      description:
        "「작업내용」 탭의 작업 기록입니다. 그 탭에는 워크플로 단계 변경과 작업 절차 수행도 함께 있어서, 여기만 [접근 불가]로 두어도 탭은 그대로 보입니다. 다만 이 메뉴의 「작업 절차 수행」 항목까지 함께 [접근 불가]면 「작업내용」 탭이 숨고, 그 탭에서만 할 수 있는 워크플로 단계 변경도 같이 막힙니다 — 단계 변경은 여기서 여닫을 수 있는 항목이 따로 없고, 워크플로 편집기에서 정한 단계별 허용 역할이 가립니다. 「작업 이력」 탭의 수정·무효 처리도 이 값이 정합니다.",
      levelHints: {
        READ: "남의 기록까지 보기만 합니다",
        WRITE: "기록을 남기고 자기가 쓴 기록을 고칩니다",
        MANAGE: "잘못된 기록을 무효화합니다",
      },
      maxMeaningfulLevel: "MANAGE",
    },
    usedParts: {
      // 「무엇을 갈았나」를 손으로 적는 칸이다(schema/repair-case-used-parts.ts).
      // 부품 요청서를 낸 건은 반출 이력이 이미 통계에 잡히므로 이 칸이 잠기는데,
      // 그것은 **권한이 아니라 건의 사정**이라 여기서 다루지 않는다 — 출하 잠금도
      // 마찬가지다(auth/repair-case-used-parts-authorization.ts 의 규칙 1·2).
      // 이 트리는 그중 역할 부분만 대신한다(이 파일 맨 위 '여기서 정하지 않는 것').
      //
      // 🔴 쓰기 하나만 둔다. 보는 일은 같은 메뉴의 '접수 건 조회'가 맡고(칸은 늘
      // 보인다), 지우는 조작이 따로 없다 — 저장이 줄 목록을 통째로 다시 적는
      // 방식이라 '줄을 지운다'가 곧 쓰기다. 읽기·관리를 만들어 두면 고른 사람은
      // 무언가 달라졌다고 믿지만 실제로는 아무것도 달라지지 않는다.
      label: "사용 부품",
      minMeaningfulLevel: "WRITE",
      description: "그 건에서 갈아 끼운 부품을 손으로 적습니다.",
      levelHints: { WRITE: "사용 부품 줄을 적고, 고치고, 지웁니다" },
      maxMeaningfulLevel: "WRITE",
    },
    lifecycle: {
      label: "삭제·복원",
      minMeaningfulLevel: "MANAGE",
      description: "접수 건 자체를 지우거나 되살립니다.",
      levelHints: { MANAGE: "일괄 삭제, 휴지통 복원, 영구 삭제" },
      maxMeaningfulLevel: "MANAGE",
    },
    files: {
      // 접수 건에 붙는 사진·문서다. 분류(인수 사진 / 회로도 / 펌웨어 …)에 따라
      // 열람을 나누지 않는다 — 분류별로 가르면 "회로도는 못 보는데 그 회로도가
      // 들어 있는 검사 보고서는 보는" 조합이 만들어지고, 그 경계를 사람이
      // 설명할 수도 지킬 수도 없다.
      //
      // 🔴 2026-11-12 부터 이 값이 **[파일 관리] 탭 자체**도 여닫는다([접근 불가]면 탭이
      // 안 보이고 주소를 직접 쳐도 막힌다). 이름표는 이미 탭 이름과 같아서 글자를 건드릴
      // 것이 없었다 — 바뀐 것은 아래 '읽기' 설명뿐이다.
      label: "파일 관리",
      description: "「파일 관리」 탭입니다. 접수 건에 붙은 사진·문서를 봅니다. 쓰기는 올리고 지우는 쪽입니다.",
      levelHints: {
        READ: "「파일 관리」 탭이 보이고, 목록을 보고 내려받습니다",
        WRITE: "올리고, 설명을 고치고, 휴지통으로 보내고 되살립니다",
      },
      maxMeaningfulLevel: "WRITE",
    },
    procedureExecution: {
      // 절차 '문서'를 고치는 것은 기술 작업 절차 메뉴지만, 절차를 실제로 밟는
      // 일은 접수 건 화면에서 일어난다. 문서 쪽에 달아 두면 절차를 볼 수 없는
      // 역할에게 그 메뉴가 열려 버린다.
      //
      // 🔴 이 잎도 **[작업내용] 탭을 여는 열쇠 가운데 하나**다(2026-11-12) — 위
      // `workRecords` 와 **OR** 로 묶인다. 절차 수행 화면으로 가는 입구는 저장소에 그 탭
      // 하나뿐이라, 작업 기록 쪽만 닫혔다고 탭이 사라지면 **이 기능이 길을 잃는다.**
      // 둘 다 [접근 불가]일 때만 탭이 숨는다(auth/repair-case-detail-tab-permissions.ts).
      //
      // 🔵 여기만 닫으면 탭은 그대로 보이고 절차를 진행하는 조작만 막힌다
      // (mutations/procedure-case-execution.ts 가 최종 관문이다).
      //
      // 🔴 아래 설명의 가운데 토막은 위 `workRecords` 의 것과 **짝**이다 — 어느 쪽을
      // 먼저 고르든 같은 경고를 읽어야 한다. 한쪽에만 적어 두면 다른 쪽을 고른 사람은
      // 영영 못 본다(이 화면은 고른 항목의 설명 한 문단만 보여 준다).
      label: "작업 절차 수행",
      description:
        "「작업내용」 탭 안에서 정해진 작업 절차를 밟습니다. 작업 기록과 함께 그 탭을 여는 열쇠여서, 여기만 [접근 불가]로 두어도 탭은 그대로 보입니다. 다만 이 메뉴의 「작업내용」 항목까지 함께 [접근 불가]면 「작업내용」 탭이 숨고, 그 탭에서만 할 수 있는 워크플로 단계 변경도 같이 막힙니다 — 단계 변경은 여기서 여닫을 수 있는 항목이 따로 없고, 워크플로 편집기에서 정한 단계별 허용 역할이 가립니다.",
      levelHints: {
        READ: "진행 상황을 보기만 합니다",
        WRITE: "단계를 진행하고 완료 처리합니다",
        MANAGE: "이미 끝난 단계를 되돌립니다",
      },
      maxMeaningfulLevel: "MANAGE",
    },

    /**
     * ── 🔴 탭 하나를 통째로 여닫는 잎 셋 (2026-11-12) ──────────────────────────
     * 수리 건 상세의 탭 아홉 가운데 **셋은 대응하는 잎이 없었다** — 화면에도 서버에도
     * 탭 단위 검사가 0건이라 로그인한 사람이면 누구나 보았다. 나머지 여섯은 이미
     * 어딘가가 답하고 있다: [기본 정보]는 `repairCases.view`, [작업내용]은
     * `repairCases.workRecords` **또는** `repairCases.procedureExecution`(한 탭에 기능이
     * 둘이라 OR 다), [진단 Flowchart]는 `diagnosisFlowcharts.view`, [파일 관리]는
     * `repairCases.files`, [견적서]는 `quotes`, [발주서]는 `domesticOrders.view`
     * (🔴 그날 오후까지는 `domesticOrders` 메뉴 키였다 — 그 메뉴가 잎 넷으로 쪼개지면서
     * 조회 잎으로 내려왔다. **열쇠가 가리키는 사람 집합은 그대로다**: 쪼개기 전 메뉴
     * READ 를 넘던 네 역할이 그대로 `view` READ 를 넘는다).
     * 짝은 auth/repair-case-detail-tab-permissions.ts 한 곳에 있다.
     *
     * 🔴 **「탭 보기」 전용 항목을 따로 만들지 않는다**(2026-11-12 사용자 결정). 이미 잎이
     * 있는 탭은 그 잎이 탭까지 가린다 — 못 쓰는 사람에게 탭만 보여 줄 까닭이 없고 설정
     * 개수도 늘지 않는다. 그래서 새로 만드는 것은 이 셋뿐이다.
     *
     * 🔴 **셋 중 둘(작업 이력 · 보고서)은 읽기 하나뿐이다.** 그 둘이 답하는 것은 「그 탭에
     * 들어갈 수 있는가」 하나다. 탭 안에서 무엇을 저장할 수 있는가는 각자 제 판정을 이미
     * 가지고 있다(보고서는 auth/service-report-authorization.ts 가 `repairCases` 메뉴
     * 수준으로). 거기에 쓰기·관리를 만들면 고른 사람은 무언가 열었다고 믿지만 실제로는
     * 아무것도 달라지지 않는다 — 이 파일이 minMeaningfulLevel 을 두는 그 까닭이다.
     *
     * 🔴 **[검수/승인]만 2026-11-12(셋째)에 쓰기가 생겼다.** 「승인 요청을 올릴 수 있는가」가
     * 실제로 그 값에 달리게 됐기 때문이다 — 고르면 **정말로 달라진다**(아래 그 잎의 주석).
     * 읽기와 쓰기가 가리키는 일이 서로 달라서 levelHints 도 셋 중 그 잎에만 있다.
     *
     * 🔴 **기본값은 「지금처럼 보이게」다**(permission-baseline.ts 의 같은 셋). 닫아 두고
     * 시작하면 배포 즉시 아무도 그 탭을 못 본다. 닫는 것은 관리자가 하는 일이다.
     */
    workHistory: {
      // 🔴 `workRecords`(= [작업내용] 탭)와 **다른 잎**이다. 두 탭이 같은 작업 기록을
      // 다루지만 하는 일이 다르다 — 저쪽은 적는 자리, 이쪽은 지나간 것을 보는 자리다.
      // 그래서 [작업내용]을 닫아도 이 탭의 **목록은 그대로 보인다**(고치기·무효 처리
      // 단추만 사라진다 — 그 둘은 여전히 `workRecords` 가 정한다).
      label: "작업 이력",
      description: "「작업 이력」 탭입니다. 지나간 작업 기록과 워크플로·상태 변경 이력을 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    serviceReports: {
      // 🔴 이 잎이 생기기 전에도 이 탭이 완전히 열려 있던 것은 아니다 — 탭 **안의**
      // 목록·공유폴더 구역은 `repairCases` **메뉴 수준**이 READ 이상인지를 보고 있었다
      // (auth/service-report-authorization.ts 의 SERVICE_REPORT_PERMISSION_AREA).
      // 메뉴 수준은 잎들의 최대값이라 사실상 전원에게 열려 있었고, 탭 자체는 아무도
      // 안 가렸다. 🔴 **그 판정은 그대로 둔다** — 여기서 하는 일은 「탭에 들어갈 수
      // 있는가」 하나이고, 만들기·고치기(WRITE)·지우기(MANAGE)의 문턱을 이 조각에서
      // 좁히지 않는다(좁히는 것은 별개의 결정이다).
      label: "보고서",
      description: "「보고서」 탭입니다. 이 건의 검사·수리 보고서를 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    approval: {
      // ── 🔴 **읽기와 쓰기가 가리키는 일이 다르다** (2026-11-12 셋째) ─────────────
      //  · 읽기      = 「검수/승인」 탭에 들어갈 수 있다(그날까지의 뜻 그대로).
      //  · 읽기+쓰기 = **승인 요청을 올릴 수 있다**(수리 검수 · 최종 출하 둘 다).
      //
      // 🔴 **결재권은 둘 중 어느 쪽도 아니다.** 누가 승인·반려를 **누를** 수 있는가는
      // 결재선과 출하 대표·위임이 정하고(queries/shipment-delegations.ts ·
      // approval-route-delegations.ts), 이 값을 [읽기+쓰기]로 올려 줘도 그 사람은
      // **올리는 쪽**만 열릴 뿐 결재자가 되지 않는다. 결재권을 주고 싶으면 결재선 판이나
      // 출하 대표 지정을 손봐야 한다 — 이 화면에서 할 수 있는 일이 아니다.
      //
      // 🔴 **쓰기가 생기기 전에는 요청 자격이 코드에 박혀 있었다.** 역할 셋
      // (최고관리자 · 관리자 · A/S 엔지니어)이 서버 관문과 승인 카드 둘에 **같은 리터럴로
      // 세 벌** 베껴져 있었고 설정으로는 한 칸도 못 건드렸다. 이제 그 세 자리가 전부
      // 이 값 하나를 본다(mutations/repair-case-approvals.ts ·
      // repair-cases/[id]/approval/page.tsx 가 계산해 카드에 내려준다).
      //
      // 🔴 **탭에 들어가는 문턱은 읽기 그대로다**(repair-case-detail-tab-permissions.ts 의
      // `approval` — level: "READ"). 요청은 못 해도 탭은 보여야 한다: 결재 알림 종이
      // 가리키는 곳이 이 탭이라, 읽기를 닫으면 그 사람의 종 링크가 막힌 화면으로 간다.
      // 그래서 기본값은 다섯 역할 전부 읽기이고, 그 위에 셋만 쓰기다 — 쓰기를 가진 셋은
      // 2026-11-12 이전에 요청할 수 있던 바로 그 셋이라 아무것도 달라지지 않는다
      // (auth/permission-baseline.ts 의 requestsRepairCaseApprovalByDefault).
      //
      // 🔵 **기타건 쪽과 일부러 다르다.** 저쪽은 요청 문턱이 `domesticOrders.edit` 다
      // (줄을 쥔 사람이 올린다). 수리 건에서 같은 자리에 설 법한 `repairCases.edit` 는
      // **구간별 편집 가능 필드**를 뜻하고(EDITABLE_FIELDS_BY_ROLE) 설정이 최종 판정도
      // 아니라서(SETTINGS_ENFORCED_LEAVES 에 일부러 없다) 쓸 수 없었다. 「왜 다르지」에서
      // 멈추지 않도록 적어 둔다 — 두 화면의 모양이 아니라 **그 잎이 뜻하는 것**이 다르다.
      label: "검수/승인",
      description:
        "「검수/승인」 탭입니다. 읽기는 이 건의 승인 요청과 결재 이력을 보는 것이고, 읽기+쓰기는 수리 검수·최종 출하 승인을 올릴 수 있다는 뜻입니다. 승인·반려를 누르는 결재권은 이 값이 정하지 않습니다 — 결재선과 출하 대표·위임이 정합니다. 결재 알림 종이 이 탭을 가리키므로 [접근 불가]로 두면 그 사람의 종 링크가 막힌 화면으로 갑니다.",
      levelHints: {
        READ: "탭이 보이고, 승인 요청과 결재 이력을 봅니다",
        WRITE: "승인을 올립니다 — 승인·반려를 누르는 결재권은 아닙니다",
      },
      maxMeaningfulLevel: "WRITE",
    },
  }),

  diagnosisFlowcharts: features("diagnosisFlowcharts", {
    view: {
      // 🔴 2026-11-12 부터 이 값이 수리 건 상세의 **[진단 Flowchart] 탭 자체**도 여닫는다
      // ([접근 불가]면 탭이 안 보이고, 흐름도 편집기 주소를 직접 쳐도 막힌다 —
      // auth/repair-case-detail-tab-permissions.ts). 이름표는 바꾸지 않았다: 이 잎이 선
      // 자리는 메뉴 「진단 Flowchart 관리」 아래라, 둘을 이어 읽으면 어느 탭인지 드러난다.
      label: "흐름도 조회",
      description: "접수 건 상세의 「진단 Flowchart」 탭입니다. 그 건에 붙은 진단 흐름도를 봅니다.",
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
      // 🔵 안내 문구를 적지 않는다 — 이 잎이 바로 DEFAULT_FIXED_NOTICE 의 주인이다
      //    (「잘못 저장한 순간 되돌릴 사람이 아무도 남지 않습니다」). 2026-11-12(넷째)에
      //    고정 노드가 둘이 되면서 문구를 잎마다 가를 수 있게 했지만, 이 칸의 문구는
      //    **한 글자도 바뀌지 않았다.**
      // 🔴 `excludedFromAreaTransition` 은 이 잎에만 true 다 — 자세한 까닭은
      //    PermissionFixedNode 의 그 칸 주석.
      fixed: { excludedFromAreaTransition: true },
    },
  }),

  customers: features("customers", {
    view: {
      label: "고객사 조회",
      description: "고객사와 End-User 목록을 봅니다.",
      maxMeaningfulLevel: "READ",
    },
    create: {
      // 수정(아래 edit)과 일부러 갈라 둔다 — edit은 관리자 전용이라 영업·엔지니어
      // 에게 추가를 열어 주려고 그것을 넓히면 남의 고객사 이름까지 함께 열린다.
      // End-User의 등록/이름 변경이 갈리는 것과 같은 판단이다. 조작이 하나뿐이라
      // 쓰기 하나만 둔다(보는 것은 위 '고객사 조회'가 맡는다).
      label: "고객사 추가",
      minMeaningfulLevel: "WRITE",
      description: "새 고객사를 등록합니다.",
      levelHints: { WRITE: "고객사 관리 화면에서 새 고객사를 등록합니다" },
      maxMeaningfulLevel: "WRITE",
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
      description: "고객사와 End-User 쪽 연락 담당자입니다.",
      levelHints: {
        WRITE: "담당자를 추가하고 수정합니다",
        MANAGE: "담당자를 삭제합니다",
      },
      maxMeaningfulLevel: "MANAGE",
    },
    lifecycle: {
      // 접수 건 쪽 repairCases.lifecycle과 같은 모양이다 — 조작 하나뿐이라
      // 읽기·쓰기를 골라도 달라지는 것이 없으므로 '접근 불가 아니면 관리'만 둔다.
      label: "삭제·복원",
      minMeaningfulLevel: "MANAGE",
      description: "고객사 자체를 지우거나 되살립니다. 아래 End-User·담당자도 함께 딸려 갑니다.",
      levelHints: { MANAGE: "휴지통으로 보내기, 복원, 완전 삭제" },
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
    files: {
      // 제품 모델 수정(위 edit)과 일부러 갈라 둔다 — edit은 관리자 전용이라
      // 엔지니어에게 파일을 열어 주려고 그것을 넓히면 모델명·제조사까지 함께
      // 열린다. 접수 건 쪽 repairCases.files와 같은 모양으로, 올리기·지우기·
      // 되살리기를 쓰기 한 칸에 담는다(나누면 잘못 올린 파일을 못 지우는
      // 역할이 생긴다).
      label: "사진·도면",
      minMeaningfulLevel: "WRITE",
      description: "제품 모델의 외형 사진과 회로도를 올리고, 지우고, 되살립니다.",
      // 보는 것은 위 '제품 모델 조회'가 이미 맡는다 — 여기에 읽기를 두면 조회
      // 노드와 구분되지 않으므로 쓰기 하나만 남긴다.
      levelHints: { WRITE: "사진·도면을 올리고, 휴지통으로 보내고, 되살립니다" },
      maxMeaningfulLevel: "WRITE",
    },
    lifecycle: {
      // 고객사 쪽 customers.lifecycle과 같은 모양 — 조작 하나뿐이라
      // '접근 불가 아니면 관리'만 둔다.
      label: "삭제·복원",
      minMeaningfulLevel: "MANAGE",
      description: "제품 모델 자체를 지우거나 되살립니다. 그 모델로 등록된 장비도 함께 딸려 갑니다.",
      levelHints: { MANAGE: "휴지통으로 보내기, 복원, 완전 삭제" },
      maxMeaningfulLevel: "MANAGE",
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
    lifecycle: {
      // 보관(publish 노드)과 다른 일이다 — 보관은 발행된 절차를 내리는 것이고,
      // 삭제는 쓰인 적 없는 절차를 치우는 것이다. 권한 계층도 달라서(보관은
      // 전체 서비스 분류에서 최고관리자 전용) 한 칸에 접을 수 없다.
      label: "삭제·복원",
      minMeaningfulLevel: "MANAGE",
      description: "기술 작업 절차를 지우거나 되살립니다. 접수 건에서 수행된 적 있는 절차는 지울 수 없습니다.",
      levelHints: { MANAGE: "휴지통으로 보내기, 복원, 완전 삭제" },
      maxMeaningfulLevel: "MANAGE",
    },
  }),

  /**
   * ── 🔴 2026-10-28(조각 13-D): 이 메뉴에 남은 하위 기능은 **하나뿐**이다 ──────
   * 옛 재고 기능이 A/S 에서 통째로 걷히면서(화면·경로 13-A → 서버 액션 13-B →
   * mutation·조회·도메인 13-C5) 잎 여섯(`view` · `parts` · `stock` · `history` ·
   * `requestProcessing` · `lifecycle`)이 **가리킬 조작을 잃었다.** 고를 수는 있는데
   * 아무것도 달라지지 않는 칸을 남겨 두면, 고른 사람은 무언가 열었다고 믿는다 —
   * 이 파일이 minMeaningfulLevel 을 두는 바로 그 까닭이라 여기서도 같게 판단했다.
   *
   * 🔴 **`requests` 의 키 글자를 바꾸거나 다른 메뉴로 옮기지 마라.** 이 잎은 죽지
   *    않았다 — 수리 건 상세의 [부품 반출 신청] 칸이 지금도 이 키를 최종 관문으로
   *    쓴다(`hasPermission(… "inventory.requests", "WRITE")` 가 페이지 가드 한 곳과
   *    서버 액션 세 곳에 있다). 키 글자가 바뀌면 운영에 저장된 `role_permissions`
   *    행이 가리킬 곳을 잃고, **오류 없이 조용히** 기본값으로 되돌아간다.
   *
   * 🔵 빠진 여섯의 저장된 행은 운영에 그대로 남지만 아무 일도 하지 않는다 —
   *    읽기·화면·판정·쓰기 네 구간이 모두 `PERMISSION_LEAF_KEYS` 에 없는 키를
   *    걸러낸다(DATABASE_DESIGN.md 18-4).
   */
  inventory: features("inventory", {
    requests: {
      label: "부품 요청",
      description: "엔지니어가 수리에 필요한 부품을 달라고 올리는 요청입니다.",
      levelHints: { READ: "요청 목록을 봅니다", WRITE: "요청을 올리고 자기 요청을 취소합니다" },
      maxMeaningfulLevel: "WRITE",
    },
  }),

  /**
   * ── 🔴 2026-11-12(같은 날 둘째): 이 메뉴가 **잎 넷으로 쪼개졌다** ──────────
   * 그전까지 `domesticOrders` 는 하위 기능이 없어서 **메뉴 키 자체가 저장되는
   * 잎**이었다. 쪼갠 까닭은 하나다 — 기타건 상세의 [승인] 탭을 가리려면 그 탭만
   * 가리키는 잎이 필요한데, **잎을 하나만 더하는 길이 없다.** 하위 기능이 하나라도
   * 생기는 순간 메뉴 키가 잎 목록에서 빠지고(아래 PERMISSION_LEAF_KEYS), 메뉴 수준은
   * **잎들의 최대값**이 된다. 그러면 읽기짜리 잎 하나만 둔 상태에서 메뉴 수준이
   * READ 에 묶여 **내자 정리의 쓰기·삭제가 전원에게 막힌다.** 실측으로 확인했다
   * (2026-11-12: 잎 하나만 넣었더니 다섯 역할 전부 NONE, 상한 case 를 더해도 전부
   * READ — 최고관리자까지 휴지통을 잃고 자재 담당자에게는 거꾸로 열렸다).
   *
   * 🔴 **그래서 넷을 한꺼번에 만든다.** 넷이 함께 있어야 메뉴 수준(= 최대값)이
   * 쪼개기 전과 같아진다:
   *   조회 READ · 수정 WRITE · 삭제·복원 MANAGE · 승인 READ
   *   → 최대값이 최고관리자/관리자 MANAGE · 영업/엔지니어 WRITE · 자재 담당자 NONE
   *   이고, 이것이 쪼개기 **전** 값과 한 칸도 다르지 않다(시험이 다섯 역할을 훑는다).
   *
   * 🔴 **기본값은 전부 *-authorization.ts 를 불러서 구한다**(permission-baseline.ts).
   * 손으로 역할 목록을 옮겨 적으면 2026-09-29 처럼 정책이 바뀌는 날 한쪽만 따라온다.
   *
   * 🔴 **저장된 행은 마이그레이션이 옮긴다**(drizzle/0127). 옛 `area_key='domesticOrders'`
   * 행은 이 트리에서 더 이상 잎이 아니라, 그냥 두면 `isPermissionLeafKey` 가 걸러
   * **오류 없이 조용히** 기본값으로 되돌아간다(`inventory.stock` 이 그 실물이다).
   */
  domesticOrders: features("domesticOrders", {
    view: {
      // 이웃 메뉴들의 `view` 와 같은 자리다(repairCases.view · customers.view).
      //
      // 🔴 2026-11-12 부터 이 값이 **[발주서] 탭 둘**도 여닫는다 — 수리 건 상세와
      // 기타건 상세 양쪽이다. 고객사가 우리에게 낸 발주서라 내자 영역이 답하고,
      // 폴더 이름에 발주 금액이 들어 있다. 🔵 **기타건 상세에서도 뜻을 갖는다**:
      // 그 화면의 입장권은 메뉴 수준(= 잎 넷의 최대값)이라, 이 잎 하나만 닫아도
      // 「승인」이 열려 있으면 사람은 들어오고 [발주서] 탭만 사라진다.
      label: "내자 정리 조회",
      description:
        "내자 정리 목록과 기타건 상세를 봅니다. 수리 건 상세와 기타건 상세의 「발주서」 탭도 이 값이 엽니다.",
      maxMeaningfulLevel: "READ",
    },
    edit: {
      // 🔴 **승인을 올리는 것도 이 값이다.** 「기타건 최종 출하 승인」을 올리는 일은
      // 그 내자 줄을 고치는 일과 같은 문턱으로 본다(mutations/domestic-order-approvals.ts
      // 의 「내자 줄을 고칠 수 있는 사람이 올린다」). 아래 `approval` 은 **탭을 보는**
      // 열쇠일 뿐 결재권이 아니다 — 둘을 한 칸에 접으면 「승인 탭은 보는데 올리지는
      // 못하는」 지금 상태를 표현할 수 없다.
      //
      // 🔴 읽기를 두지 않는다 — 보는 일은 위 `view` 가 맡는다(customers.edit 와 같은
      // 모양). 여기에 읽기를 두면 조회 노드와 구분되지 않는다.
      label: "내자 정리 수정",
      minMeaningfulLevel: "WRITE",
      description:
        "내자 줄을 추가하고 고칩니다. 완료 처리·발행일·머리말 수정과 기타건 승인 요청도 이 값이 정합니다.",
      levelHints: { WRITE: "줄을 추가하고, 고치고, 완료 처리하고, 승인을 올립니다" },
      maxMeaningfulLevel: "WRITE",
    },
    lifecycle: {
      // 이웃들과 같은 모양이다(repairCases.lifecycle · customers.lifecycle) — 조작
      // 하나뿐이라 읽기·쓰기를 골라도 달라지는 것이 없으므로 '접근 불가 아니면 관리'
      // 만 둔다. 셋(휴지통·복원·완전 삭제)이 한 함수다 — 나누면 「지울 수는 있는데
      // 되살릴 수 없는」 역할이 만들어진다(domestic-order-authorization.ts).
      label: "삭제·복원",
      minMeaningfulLevel: "MANAGE",
      description: "내자 줄을 휴지통으로 보내고, 되살리고, 완전히 지웁니다.",
      levelHints: { MANAGE: "휴지통으로 보내기, 복원, 완전 삭제" },
      maxMeaningfulLevel: "MANAGE",
    },
    approval: {
      // 🔴 **결재권이 아니다.** 누가 승인·반려를 누를 수 있는가는 결재선과 그 단계
      // 위임이 정하고(queries/approval-route-delegations.ts), 이 값은 **그 탭에 들어갈
      // 수 있는가**만 답한다. 수리 건 쪽 `repairCases.approval` 과 같은 결이다.
      // 승인을 **올리는** 문턱은 위 `edit` 이다(그쪽 주석).
      //
      // 🔴 **기본값은 「지금처럼 보이게」다** — 지금 이 탭을 볼 수 있는 역할 전부에게
      // READ 다(= 내자를 볼 수 있는 사람 그대로). 닫아 두고 시작하면 배포 즉시 아무도
      // 그 탭을 못 본다. 닫는 것은 관리자가 설정 화면에서 할 일이다.
      //
      // 🔴 읽기 하나뿐이다. 탭 안에서 무엇을 할 수 있는가는 결재선이 이미 정한다 —
      // 여기에 쓰기·관리를 만들면 고른 사람은 무언가 열었다고 믿지만 아무것도
      // 달라지지 않는다(이 파일이 minMeaningfulLevel 을 두는 그 까닭).
      label: "승인",
      description: "기타건 상세의 「승인」 탭입니다. 그 줄의 최종 출하 승인 요청과 결재 이력을 봅니다.",
      maxMeaningfulLevel: "READ",
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
  /**
   * 🔴 2026-11-12(둘째): 아래 SETTINGS_ENFORCED_LEAVES 에 있던 `"domesticOrders"` 가
   * **이리로 올라왔다.** 메뉴가 잎 넷으로 쪼개지면서 그 키는 더 이상 잎이 아니고,
   * 잎 목록에 적힌 키만 보는 `isSettingsEnforced` 가 메뉴를 「전환 안 됨」으로 읽게
   * 되기 때문이다.
   *
   * 🔵 **말의 참·거짓은 그대로다.** 2026-08-31 에 「액션·페이지가 설정만 본다」가
   * 참이 됐고(그 전에는 canEditDomesticOrders 와 AND 였다), 쪼갠 뒤에도 네 잎 전부가
   * 그렇다 — 관문이 전부 hasPermission 한 줄이고 뒤에 남은 역할 함수가 없다. 새로
   * 생긴 `approval` 도 마찬가지다(탭을 그릴지 정하는 레이아웃과 주소를 직접 쳤을 때
   * 막는 페이지가 둘 다 그 한 줄만 본다 — auth/detail-tab-access.ts).
   */
  "domesticOrders",
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
  // 사용 부품(2026-09-17 전환). 조회 · 저장이 모두 hasPermission("repairCases.
  // usedParts", "WRITE") 하나를 보고, 역할 이름 목록은 코드에서 **걷어냈다** —
  // 아래 ⚠️ 주간보고 문단이 말하는 「역할 함수 AND 설정」 상태로 두지 않았다는
  // 뜻이다. 그래서 여기 올려도 화면이 거짓말을 하지 않는다: 넓히면 실제로 열린다.
  //
  // 반출 이력 · 출하 잠금은 이 집합과 겹치지 않는다 — 역할이 아니라 건 하나의
  // 사정이라 4단계 사다리가 애초에 말할 수 없는 것이다(작업 기록의 「담당인가」와
  // 같은 자리). 설정으로 쓰기를 주면 「적을 수 있는 건」에는 실제로 열린다.
  "repairCases.usedParts",
  "repairCases.lifecycle",
  "repairCases.procedureExecution",
  // 첨부는 처음부터 설정만 봤다 — 올리기·내려받기·미리보기·지우기 라우트가
  // 전부 hasPermission("repairCases.files") 하나를 쓴다. 목록에 올리지 않아
  // 화면이 괜히 "아직 코드가 최종 판정"이라고 말하고 있었다(2026-08-31 확인).
  "repairCases.files",
  /**
   * 🔴 탭 하나를 통째로 여닫는 잎 셋(2026-11-12). 이 셋은 **처음부터 설정만 본다** —
   * 탭을 그릴지 정하는 레이아웃과, 주소를 직접 쳤을 때 막는 각 페이지가 둘 다
   * hasPermission 하나만 부른다(auth/repair-case-detail-tab-access.ts). 뒤에 남은 역할
   * 함수가 없으므로 여기 올려도 화면이 거짓말을 하지 않는다: 넓히면 실제로 열린다.
   *
   * 🔵 같은 날 이 집합에 **이미 들어 있던** 잎 셋(`repairCases.files` ·
   * `repairCases.workRecords` · `repairCases.procedureExecution`)과
   * `diagnosisFlowcharts.view`(메뉴째 전환돼 있다)의 뜻이 넓어졌다 — 전에는 「탭 안의
   * 단추」를 가렸는데 이제 **탭 전체**(작업내용 쪽 둘은 **함께** OR 로)를 가린다.
   * 넓어지는 방향이라 목록에서 뺄 까닭이 없다: 설정이 최종 판정이라는 말은 그대로
   * 참이고, 오히려 전보다 더 참이다.
   *
   * 🔴 `repairCases.serviceReports` 가 「보고서 탭에 들어갈 수 있는가」만 답한다는 점에
   * 주의할 것. 그 탭 **안**의 만들기·고치기·지우기 문턱은 여전히
   * auth/service-report-authorization.ts 가 `repairCases` 메뉴 수준으로 판정한다.
   */
  "repairCases.workHistory",
  "repairCases.serviceReports",
  "repairCases.approval",
  "users.view",
  "users.shipmentRepresentatives",
  // 하위 기능이 없는 메뉴들. 대시보드·A/S 접수·Excel 생성·시스템 설정은 원래
  // 역할 검사가 없어 페이지 가드(= 설정)가 이미 유일한 관문이었고, 나머지
  // 하나('내 담당 제품')는 이번에 옮겼다.
  //
  // ⚠️ **주간보고는 여기 있다가 빠졌다.** 넣어 둘 때의 근거는 "역할 검사가
  // 하나도 없고 페이지 가드가 유일한 관문"이라는 것이었는데, `금주 목표`가
  // 생기면서 그 말이 더 이상 사실이 아니다 — 목표를 적는 서버 액션은
  // canEditWeeklyReportGoals(역할)와 이 설정을 **둘 다** 본다
  // (server/actions/weekly-report-goals.ts). 역할 함수가 최종 관문으로 남아
  // 있는 한 설정을 넓혀도 그 조작이 열리지 않을 수 있고, 여기 남겨 두면 권한
  // 설정 화면이 "넓히면 실제로 열립니다"라고 **거짓말을 한다**. 내자 정리가
  // 같은 모양(역할 함수 AND 설정)이면서 이 목록에 없는 것과 같은 이유다.
  //
  // 보는 쪽만 놓고 보면 지금도 페이지 가드가 유일한 관문이지만, 이 집합은
  // 노드 하나를 통째로 판정하므로 '보기는 설정이 최종, 쓰기는 아니다'를 담을
  // 수 없다. 담을 수 없을 때는 **넓게 말하지 않는 쪽**이 맞다 — 관리자가
  // 열어 줬다고 믿는데 막혀 있는 상태가 그 반대보다 나쁘다.
  "dashboard",
  "myActiveWork",
  "repairCaseNew",
  "excelKyosanIntakeList",
  "settings",
  /**
   * 🔴 기타건 현황(2026-11-12 넷째에 **뒤늦게** 넣었다). 2026-11-06 에 메뉴가 생길 때
   * 함께 들어왔어야 하는 줄인데 빠져 있었고, **왜 빠졌는지 적어 둔 주석이 없다** —
   * 일부러 뺀 흔적이 아무 데도 없으니 그냥 빠뜨린 것으로 본다(같은 모양의 「하위
   * 기능 없는 메뉴」 열한 개는 전부 위아래에 적혀 있다).
   *
   * 빠져 있는 동안 화면은 이 칸에 대고 「넓혀도 실제로는 열리지 않을 수 있습니다」라는
   * **거짓 경고**를 띄우고 있었다. 실제 관문은 app/(app)/misc-cases/page.tsx 의
   * `requireAreaAccessForCurrentUser("miscCases")` 한 줄뿐이고, 그것은 설정만 본다
   * (area-guard → permission-resolver). 뒤에 남은 역할 함수가 없으므로 넓히면 정말로
   * 열리고 좁히면 정말로 막힌다.
   *
   * 🔵 **이 목록에 넣는 것은 화면의 말만 바꾼다.** `isSettingsEnforced` 를 부르는 자리는
   * 저장소에 권한 설정 화면 한 곳뿐이고(components/users/RolePermissionSettings.tsx 의
   * 그 문장), 판정 경로(permission-resolver)는 이 집합을 쳐다보지 않는다.
   *
   * 🔴 기타건 **상세**는 `domesticOrders` 가 지킨다 — 이 줄은 목록 화면 하나에 대한
   * 말이다(misc-cases/page.tsx 머리말의 그 문단).
   */
  "miscCases",
  // 액션·페이지가 모두 이 설정만 본다(2026-08-31 전환). 예전에는 역할 함수와
  // AND 였다 — 자세한 경위는 actions/repair-labor.ts 주석에 있다.
  "repairLabor",
  // 세 단계(보기·안내문구·주소관리)를 모두 설정으로 옮겼다(2026-08-31).
  // 주소 발급·회수까지 설정이 정한다 — permission-areas.ts 의 경고 참조.
  "customerPortal",
  // 🔴 `"domesticOrders"` 는 2026-11-12(둘째)에 **위 SETTINGS_ENFORCED_AREAS 로
  // 옮겼다** — 그날 메뉴가 잎 넷으로 쪼개져 그 키가 더 이상 잎이 아니다. 「액션·
  // 페이지가 설정만 본다」(2026-08-31 전환, 예전에는 canEditDomesticOrders 와 AND
  // 였다)는 말은 네 잎 전부에 그대로 참이다. 🔴 여기 다시 적지 말 것 — 잎이 아닌
  // 키를 이 집합에 두면 그 키가 메뉴 경로로도 잎 경로로도 답하게 되어, 두 답이
  // 갈릴 자리가 생긴다.
  //
  // 목표·납품 액션과 화면이 설정만 본다(2026-08-31 전환). 예전에는
  // canEditWeeklyReportGoals 와 AND 였다. 상세표의 `비고` 는 수리 건의
  // 컬럼이라 여전히 수리 건 상세의 판정을 따른다 — 이 영역의 값이 아니다.
  "weeklyReport",
  // 액션·페이지·xlsx 라우트가 모두 설정만 본다(2026-08-31 전환). 세 단계가
  // 조작과 짝이 맞는다 — 읽기(보기·내려받기) · 쓰기(만들기·고치기) ·
  // 관리(지우기·되살리기).
  "quotes",
  // 페이지 가드·서버 액션·이미지 라우트가 모두 이 설정을 본다(2026-08-31).
  // 역할 함수(canManageIntakeMailSettings)는 이제 permission-baseline 의
  // 기본값을 계산할 때만 쓰인다 — 최종 관문이 아니다.
  "mailSettings",
  // 과거 인수품 가져오기(2026-09-15, 처음부터). 서버 액션 둘(미리보기 · 실행)이 이 설정의
  // 관리 수준만 본다. 역할 함수(kyosan-intake-import-authorization.ts)는 기본값을 계산할 때만
  // 쓰인다. 새 모델을 만드는 줄만 따로 canEditProductModels 를 보는데, 그것은 A/S 접수와 같은
  // 제품 모델 마스터 규칙이라 이 영역의 판정이 아니다(미리보기가 그 줄을 확인 필요로 알린다).
  "kyosanIntakeImport",
]);

/** 이 노드의 설정이 실제 판정을 지배하는가. */
export function isSettingsEnforced(key: string): boolean {
  if (key.includes(".")) {
    return SETTINGS_ENFORCED_AREAS.has(key.split(".")[0]) || SETTINGS_ENFORCED_LEAVES.has(key);
  }
  // 메뉴는 하위가 **전부** 전환됐을 때만 전환된 것으로 본다. 하나라도 남아
  // 있으면 "이 메뉴는 설정이 최종 판정"이라고 말할 수 없다.
  if (SETTINGS_ENFORCED_AREAS.has(key)) return true;
  // 하위 기능이 없는 메뉴는 그 메뉴 자체가 잎이다.
  if (!hasFeatures(key)) return SETTINGS_ENFORCED_LEAVES.has(key);
  // 고정 노드 가운데 **설정 밖에 일부러 둔 것만** '전부 전환됐는가' 판정에서 뺀다 —
  // 넣어 두면 '사용자 관리'는 영원히 전환 중으로 보인다.
  //
  // 🔴 2026-11-12(넷째)에 `!feature.fixed` 에서 이 모양으로 바뀌었다. 그날 고정 노드가
  // 둘이 됐는데, 둘째(`repairCases.edit`)는 **지금도 코드가 최종 판정**이라 빼면 안 된다
  // — 빼는 순간 '전체 A/S 현황'이 전환 완료로 보이고, 그러면 칸 단위 편집 권한이
  // 설정으로 넘어온 것처럼 읽힌다(PermissionFixedNode 의 그 칸 주석).
  const children = featuresOfArea(key).filter(
    (feature) => !feature.fixed?.excludedFromAreaTransition
  );
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
 *
 * 🔴 **장식 잎은 최대값 셈에서 뺀다**(2026-11-12 넷째 — 위 `doesNotRaiseAreaLevel`).
 * 아무것도 여닫지 않는 잎이 메뉴를 혼자 열린 채로 떠받치면, 그 잎이 고정이라 닫을
 * 수도 없어 **관리자가 그 메뉴를 영영 못 닫는다.** 지금 그런 잎은 `repairCases.edit`
 * 하나뿐이고, 빼도 다섯 역할 × 메뉴 21개의 수준이 **한 칸도 달라지지 않는다**(실측 —
 * permission-settings-truth.test.ts 의 표가 그것을 지킨다). 🔵 최대값에서 하나를 빼는
 * 일이라 방향은 언제나 **닫히는 쪽**이다 — 이 함수가 없던 권한을 만들어 낼 수는 없다.
 *
 * 🔵 하위 기능이 없는 메뉴(메뉴 자체가 잎)는 걸러낼 것이 없다 — 그 한 잎을 빼면
 * 메뉴가 언제나 접근 불가가 되므로, 그런 잎에는 이 표시를 붙이지 않는다.
 */
export function areaLevelFromLeaves(
  areaKey: string,
  levelOf: (leafKey: string) => PermissionLevel
): PermissionLevel {
  if (!hasFeatures(areaKey)) return levelOf(areaKey);
  return featuresOfArea(areaKey)
    .filter((feature) => !feature.fixed?.doesNotRaiseAreaLevel)
    .reduce<PermissionLevel>((acc, feature) => {
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

/**
 * 이 잎이 '고정'이면 화면의 안내 상자에 띄울 한 문단. 고정이 아니면 undefined 다.
 *
 * 🔴 **까닭이 다른 고정 칸에 같은 문장을 붙이면 둘 다 안 읽힌다.** 그래서 문구를
 * 화면이 아니라 잎이 들고 있다(PermissionFixedNode 의 머리말). 화면은 이 함수가
 * 돌려주는 글을 그대로 그리기만 한다 — 거기에 문장을 적어 두면 고정 칸이 늘어날
 * 때마다 한 문장이 전부를 덮게 된다.
 */
export function fixedNoticeOf(leafKey: string): string | undefined {
  const fixed = FEATURE_BY_KEY.get(leafKey)?.fixed;
  if (!fixed) return undefined;
  return fixed.notice ?? DEFAULT_FIXED_NOTICE;
}
