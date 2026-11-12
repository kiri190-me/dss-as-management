import type { PermissionLevel } from "./permission-areas";
import {
  detailTabKeysOf,
  isDetailTabOpen,
  requiredKeysOfDetailTab,
  type DetailTabPermission,
  type DetailTabPermissionTable,
  type DetailTabRequirement,
  type DetailTabVisibility,
} from "./detail-tab-permissions";

/**
 * ============================================================================
 * 수리 건 상세의 탭 ↔ 권한 잎 짝 (2026-11-12)
 * ============================================================================
 * 사용자 요구: 「수리건 상세처럼 안에 탭이 있는 화면의 탭들도 세세하게 설정할 수
 * 있게」. 그 전까지 탭 단위 검사가 있던 것은 [견적서] · [발주서] 둘뿐이었고,
 * 나머지 일곱은 로그인만 하면 전부 보였다(탭 **안의 쓰기 단추**만 잎을 봤다).
 *
 * ── 🔴 이 표가 **하나**여야 하는 까닭 ───────────────────────────────────
 * 탭 하나를 막는 데에는 자리가 둘이다 — 탭 줄을 그리는 레이아웃(화면)과, 주소를
 * 직접 쳤을 때 막는 각 페이지(서버). 두 자리가 **서로 다른 열쇠**를 보게 되는 날,
 * 증상은 「탭은 보이는데 누르면 권한이 없다」 또는 그보다 나쁜 「탭은 없는데 주소로는
 * 들어와진다」이고 둘 다 오류를 내지 않는다. 그래서 열쇠는 여기 한 곳에만 적고,
 * 양쪽이 같은 상수를 읽는다(auth/repair-case-detail-tab-access.ts 가 그 창구다).
 *
 * ── 🔴 [기본 정보]는 이 표에 **없다** ───────────────────────────────────
 * 빠뜨린 것이 아니라 **가리지 않기로 한 것**이다(2026-11-12 사용자 결정). 거기에 따로
 * 검사를 붙이면 **「들어왔는데 첫 탭이 없는」** 상태가 생긴다. 키 집합
 * (RepairCaseDetailTabKey)에서 아예 빼 둔 것은 그 결정을 타입이 지키게 하려는 것이다 —
 * 나중에 누가 `root` 를 가리려 하면 코드를 쓰기 전에 tsc 가 먼저 막는다.
 *
 * 🔴 **그 탭을 지금 가릴 수 있는 잎은 없다**(2026-11-12 실측). `repairCases.view` 가
 * 그 자리처럼 보이지만 아니다 — 목록 화면의 관문은 `requireAreaAccessForCurrentUser
 * ("repairCases")` 이고, 그 **메뉴 수준은 잎들의 최대값**이라(permission-features.ts 의
 * areaLevelFromLeaves) `view` 하나만 닫아도 다른 잎이 열려 있으면 목록도 상세도 그대로
 * 열린다. 상세의 [기본 정보] 화면 자체에는 아무 검사도 없다.
 * 🔵 그래서 언젠가 [기본 정보]를 **정말로** 가리기로 하면 **새 잎이 필요하다** — 이 표에
 * `root` 를 더하는 것만으로는 안 되고, 그 전에 「그 탭을 못 보는 사람은 상세에 들어와서
 * 무엇을 보는가」를 먼저 정해야 한다.
 *
 * 🔵 덕분에 **탭이 하나도 없는 사람은 생기지 않는다.** 여덟을 전부 닫아도 [기본 정보]는
 * 남는다.
 *
 * ── 🔴 새 열쇠를 만들지 않은 탭 둘 ──────────────────────────────────────
 * [견적서] · [발주서]는 **메뉴 권한 아래 그대로 둔다**(2026-11-12 사용자 결정).
 * [견적서] 메뉴를 닫으면 이 탭도 닫힌다 — 지금 동작 그대로다. 탭 전용 키를 새로
 * 만들면 관리자가 한쪽만 풀어 둔 상태가 생긴다([id]/quotes/page.tsx 의 같은 주석).
 *
 * ── 수준은 전부 읽기다 · 🔴 그래서 **문턱이 둘인 탭이 있다** ─────────────
 * 이 표가 답하는 것은 「그 탭에 들어갈 수 있는가」 하나다. 탭 안에서 무엇을 저장할 수
 * 있는가는 각 화면이 제 판정을 따로 가지고 있고, 이 표는 그것을 건드리지 않는다.
 *
 * 🔴 [보고서] 탭이 그 모양이라 헷갈리기 쉽다 — **일부러 둘이다.** 이 표의
 * `repairCases.serviceReports` 는 탭에 들어가는 문이고, 탭 안의 목록·만들기(WRITE)·
 * 지우기(MANAGE)는 종전대로 `auth/service-report-authorization.ts` 가 **`repairCases`
 * 메뉴 수준**으로 판정한다. 2026-11-12 에 그 판정을 **한 줄도 건드리지 않았다**:
 * 문턱을 하나로 합치려면 누가 보고서를 만들고 지울 수 있는지를 다시 정해야 하는데,
 * 그것은 「탭을 가린다」와 다른 결정이다.
 * ============================================================================
 */

/**
 * 가릴 수 있는 탭. 🔴 [기본 정보](`root`)는 일부러 없다 — 위 머리말 참조.
 *
 * 이름은 `domain/repair-case-detail-tabs.ts` 의 주소 키와 **같은 글자**다. 둘이
 * 어긋나면 「막은 탭과 안 보이는 탭이 다른」 일이 생기고, 이름이 같으면 짝을
 * 사람이 눈으로 맞춰 읽을 수 있다.
 */
export type RepairCaseDetailTabKey =
  | "execution"
  | "diagnosis"
  | "workHistory"
  | "files"
  | "report"
  | "quotes"
  | "purchaseOrders"
  | "approval";

/**
 * 🔴 2026-11-12(같은 날 둘째): 요구사항의 **모양**(키 + 수준, 그리고 그것을 OR 로
 * 읽는 방법)은 이제 `detail-tab-permissions.ts` 에 산다. 기타건 상세가 같은 일을
 * 하게 되면서 같은 글이 두 벌이 됐기 때문이다. 🔵 **여기서 다시 내보내는 것**은
 * 이 이름으로 들여오던 자리를 그대로 두기 위해서다 — 뜻은 한 글자도 안 바뀌었다.
 */
export type RepairCaseDetailTabRequirement = DetailTabRequirement;

/**
 * ── 🔴 왜 열쇠 **하나**가 아니라 목록인가 (2026-11-12, 같은 날 두 번째) ────────
 * 처음에는 `{ key, level }` 하나였다. 탭 하나에 잎 하나라는 모양이 단순해서였는데,
 * **[작업내용] 탭이 그 모양에 맞지 않는다** — 한 화면에 기능이 **셋** 산다:
 * 작업 기록 작성 · 워크플로 단계 변경 · 작업 절차 수행(`execution/page.tsx`).
 * 그중 한 기능의 잎(`repairCases.workRecords`) 하나로 탭 전체를 닫으면 나머지 둘이
 * **길을 잃는다** — 절차 수행 화면으로 가는 입구는 저장소에 그 탭 하나뿐이다.
 *
 * 🔴 그것은 이 저장소가 되풀이한 실수의 모양이다: **금지를 넓게 걸어 멀쩡한 쓰임까지
 * 죽이는 것.** 관리자는 「작업 기록을 못 쓰게 하겠다」고 생각하고 닫는데 실제로는
 * 절차 수행까지 통째로 사라지고, 그 사람은 자기가 무엇을 껐는지 모른다.
 *
 * 그래서 요구사항을 **목록**으로 두고 **OR**(`anyOf`)로 읽는다 — 하나라도 READ 이상이면
 * 탭이 열리고, **전부 [접근 불가]일 때만** 숨는다. 값 하나를 목록으로 바꾸는 편이
 * 이 탭에만 예외를 파 넣는 것보다 낫다: 같은 모양의 탭이 또 나온다(실제로 [보고서]는
 * 탭 안에서 문턱을 하나 더 쓰고 있고, 앞으로 한 탭에 두 기능이 묶이는 일은 더 늘어난다).
 *
 * 🔴 **빈 목록은 만들 수 없다** — 타입이 「적어도 하나」를 요구한다. 빈 목록이면
 * `some()` 이 거짓이 되어 **아무에게도 안 열리는 탭**이 조용히 생긴다.
 *
 * 🔴 2026-11-12(둘째)에 이 타입의 **몸이 `detail-tab-permissions.ts` 로 옮겨 갔다** —
 * 기타건 상세가 같은 모양을 쓰게 됐기 때문이다. 위 문단은 **그 결정의 까닭**이라
 * 여기 남긴다(그 탭이 왜 열쇠 둘인지는 이 화면의 사정이다).
 */
export type RepairCaseDetailTabPermission = DetailTabPermission;

export const REPAIR_CASE_DETAIL_TAB_PERMISSIONS: DetailTabPermissionTable<RepairCaseDetailTabKey> = {
  /**
   * 🔴 **이 탭만 열쇠가 둘이다.** 한 화면에 기능이 셋 살기 때문이다(위 타입 주석).
   * 작업 기록을 못 쓰는 사람도 절차는 밟을 수 있고, 그 반대도 있다 — 그래서 **둘 다**
   * [접근 불가]일 때만 탭이 사라진다.
   *
   * ── 🔴 워크플로 단계 변경은 이 목록에 **없다 — 그리고 앞으로도 안 만든다** ──
   * (2026-11-12 사용자 결정. 그 전의 실측이 근거다.)
   *
   * 실측: 그 조작을 가리는 권한 **잎이 아예 없다.** 전이는 워크플로 초안에 적힌
   * `allowedRoles`(편집기에서 **사람이 정해 DB 에 저장한 값**)로, 단계 직접 변경은
   * `checkManualStepSetEligibility` 의 역할 셋으로 판정한다. 그 사슬
   * (`actions/transition-workflow.ts` · `set-workflow-step.ts` · `case-workflow-steps.ts` ·
   * `mutations/workflow-transitions.ts` · `mutations/case-workflow-steps.ts`)에
   * `hasPermission` 호출이 **한 건도 없다.**
   *
   * 안 만드는 까닭 셋:
   *  ① **문턱이 셋이 된다.** 지금도 둘(`allowedRoles` + 역할 셋)인데 잎을 더하면
   *     관리자는 「권한 화면에서 열었는데 왜 안 되지」에서 멈춘다.
   *  ② **범위 밖이다.** 요청받은 것은 **탭 접근 권한**이다. 단계 변경의 권한 체계를
   *     새로 설계하려면 🔴 **`allowedRoles` 와 새 잎 중 무엇이 이기는지부터** 정해야
   *     하고, 그것은 조각 하나에 끼워 넣을 결정이 아니다. **다시 손대려는 사람은
   *     그 질문에 먼저 답할 것.**
   *  ③ **구멍이 생기는 조건이 좁고, 그 상태가 오히려 말이 된다.** 작업 기록과 절차
   *     수행이 **둘 다** [접근 불가]인 역할이어야 하고, 기본값에서는 아무도 해당하지
   *     않는다. 관리자가 굳이 둘 다 닫았다면 「그 역할은 작업 쪽을 아예 안 한다」는
   *     뜻이라, 단계 변경도 못 하는 것이 어긋나지 않는다.
   *
   * 🔴 **대신 그 사실을 화면에 적었다.** 두 잎(`repairCases.workRecords` ·
   * `repairCases.procedureExecution`)의 `description` 이 「둘 다 닫으면 워크플로 단계
   * 변경도 함께 막힌다 · 단계 변경에는 여닫을 항목이 따로 없다」를 말한다
   * (permission-features.ts). 잎을 안 만드는 이상, 남는 구멍을 **닫는 사람이 읽게 하는
   * 것**이 그 자리를 메우는 유일한 길이다.
   */
  execution: {
    anyOf: [
      { key: "repairCases.workRecords", level: "READ" },
      { key: "repairCases.procedureExecution", level: "READ" },
    ],
  },
  /**
   * 🔴 **다른 메뉴의 잎이다** — 진단 흐름도는 접수 건이 아니라 제 메뉴를 가지고 있고
   * (`diagnosisFlowcharts`), 「볼 수 있는가」는 이미 그 메뉴의 `view` 가 답한다.
   * 여기에 `repairCases.*` 열쇠를 새로 만들면 같은 자료에 두 정책이 생긴다.
   */
  diagnosis: { anyOf: [{ key: "diagnosisFlowcharts.view", level: "READ" }] },
  workHistory: { anyOf: [{ key: "repairCases.workHistory", level: "READ" }] },
  files: { anyOf: [{ key: "repairCases.files", level: "READ" }] },
  report: { anyOf: [{ key: "repairCases.serviceReports", level: "READ" }] },
  /** 🔴 2026-11-12 이전부터 이 열쇠였다 — 바꾸지 않았다(위 머리말의 '새 열쇠를 만들지 않은 탭 둘'). */
  quotes: { anyOf: [{ key: "quotes", level: "READ" }] },
  /**
   * 🔴 견적서와 **다른 열쇠**다 — 이 탭이 보여 주는 것은 고객사가 우리에게 낸 발주서다.
   *
   * 🔴 2026-11-12(둘째)에 `domesticOrders`(메뉴 키) → `domesticOrders.view`(조회 잎)로
   * **내려왔다.** 그날 내자 정리 메뉴가 잎 넷으로 쪼개지면서 메뉴 키가 더 이상 저장되는
   * 잎이 아니게 됐기 때문이다(permission-features.ts 의 그 문단). **가리키는 사람
   * 집합은 그대로다** — 쪼개기 전 메뉴 READ 를 넘던 네 역할이 그대로 `view` READ 를
   * 넘고, 자재 담당자는 전과 같이 못 넘는다. 🔵 오히려 전보다 정확하다: 「내자 줄을
   * **볼** 수 있는가」를 묻는 자리인데, 메뉴 키는 잎 넷의 최대값이라 조회를 닫고
   * 수정만 열어 둔 역할에게도 참이 된다.
   */
  purchaseOrders: { anyOf: [{ key: "domesticOrders.view", level: "READ" }] },
  approval: { anyOf: [{ key: "repairCases.approval", level: "READ" }] },
};

/**
 * 이 탭이 열리는가 — **순수** 판정. 잎마다 이미 구한 수준을 받아 답한다.
 *
 * 🔴 **판정이 사는 자리는 하나다.** 탭 줄을 그리는 레이아웃도, 주소를 직접 친
 * 사람을 막는 각 page.tsx 도 결국 이 함수에 닿는다
 * (`auth/repair-case-detail-tab-access.ts` 가 수준을 읽어 와 넘긴다). 한쪽이 제
 * 조건을 따로 적는 날 증상은 「탭은 보이는데 들어가면 막힌다」 또는 그 반대이고,
 * 둘 다 아무 오류를 내지 않는다.
 *
 * 🔴 2026-11-12(둘째)부터 **묶는 방식 자체는 `detail-tab-permissions.ts` 가 갖는다** —
 * 기타건 상세가 같은 OR 을 쓰게 되면서 두 벌이 됐기 때문이다. 이 함수가 남아 있는
 * 것은 「이 화면의 표를 쥐고 묻는다」를 한 이름으로 두기 위해서다: 부르는 쪽이 표를
 * 손에 들고 다니면 **표를 빠뜨리거나 남의 표를 넘길 자리**가 생긴다.
 *
 * 🔵 순수 함수라 **값으로 시험할 수 있다** — 「작업 기록만 닫으면 탭이 그대로 보인다」
 * 같은 OR 동작을 DB 없이 그대로 재는 자리가 이것이다.
 */
export function isRepairCaseDetailTabOpen(
  tab: RepairCaseDetailTabKey,
  levelOf: (key: string) => PermissionLevel
): boolean {
  return isDetailTabOpen(REPAIR_CASE_DETAIL_TAB_PERMISSIONS, tab, levelOf);
}

/** 이 탭이 보는 잎들. 수준을 미리 읽어 올 때 쓴다. */
export function requiredKeysOfRepairCaseDetailTab(tab: RepairCaseDetailTabKey): readonly string[] {
  return requiredKeysOfDetailTab(REPAIR_CASE_DETAIL_TAB_PERMISSIONS, tab);
}

/** 표에 적힌 차례 그대로. 탭 줄의 차례가 아니라 **훑는 차례**다(탭 차례는 화면이 정한다). */
export const REPAIR_CASE_DETAIL_TAB_KEYS = detailTabKeysOf(REPAIR_CASE_DETAIL_TAB_PERMISSIONS);

/**
 * 어느 탭을 그릴까. 🔴 [기본 정보]가 이 꾸러미에 없는 것이 결정 그 자체다 —
 * 그 탭은 언제나 그려진다.
 */
export type RepairCaseDetailTabVisibility = DetailTabVisibility<RepairCaseDetailTabKey>;
