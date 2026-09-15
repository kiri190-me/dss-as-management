import type { QuoteWorkScopeSection } from "@/lib/validation/quote-input";
import type { WorkflowKind } from "./workflow-kind";

/**
 * ============================================================================
 * 작업 내역의 어느 묶음이 **문서에서 빠지는가** — 화면과 문서가 같은 답을 본다
 * ============================================================================
 * 「통전작업 제외」를 켜면 xlsx 생성기 셋이 「③ 통전검사」 구역을 머리글까지
 * 지운다(xlsx/quote-template.ts · matcher-quote-template.ts · oh-quote-template.ts
 * 의 `POWER_TEST: input.powerTestExcluded === true`). 그런데 수정 화면의 입력 칸이
 * 그대로 떠 있으면 사람은 그 줄들이 견적서에 나가는 줄로 읽는다(2026-09-11
 * 사용자 — 「오해가 없도록」).
 *
 * 그래서 화면도 **같은 규칙으로** 그 칸을 감춘다. 규칙을 화면에 따로 적으면
 * 한쪽만 고쳐지는 날이 오고, 그때 증상은 "화면에서는 사라졌는데 문서에는 찍혀
 * 나가는" 칸이다. 시험이 xlsx 쪽 판정과 같은 답인지를 맞춰 본다 — 시험은
 * quote-labor-cost.test.ts 에 함께 있다(그 파일 머리의 import 주석이 까닭을 적는다).
 *
 * ── 🔴 감출 뿐 지우지 않는다 ────────────────────────────────────────────
 * 이 판정은 **그리기만** 가른다. 줄 목록은 그대로 두어야 체크를 풀었을 때 손으로
 * 고쳐 둔 줄이 그대로 돌아온다. 저장되는 값도 그대로다 — 문서에서 빼는 일은
 * xlsx 생성기가 이미 한다(quote-sheet-layout.ts 의 dropExcludedWorkScopeLines).
 *
 * xlsx 층은 앱 층을 모르는 채로 남아야 해서(quote-sheet-layout.ts 머리말) 이
 * 함수를 거기서 부르게 바꾸지 않았다. 대신 xlsx 라우트가 isRepairSectionDropped 의
 * 답을 생성기에 넘긴다 — 판정은 여기 한 곳이다.
 *
 * ── 빠지는 묶음은 셋이다 ────────────────────────────────────────────────
 *   · ① 조사작업 — 「조사작업 제외」를 켰을 때(2026-09-15). 조사 칸의 마지막 줄을
 *     지우면 저절로 켜진다(수정 화면 — 아래 isInvestigationScopeEmptied). 켜면 기본
 *     작업비 중 조사작업 몫(기본 작업비 − 통전작업 몫)이 작업비 계산에서 빠진다
 *     (quote-labor-cost.ts — 문서 쪽 일은 아니다).
 *   · ② 수리 작업 — 제너레이터 견적서에서 수리 작업을 하나도 고르지 않았을 때
 *     (2026-09-15, 아래 isRepairSectionDropped).
 *   · ③ 통전작업 — 「통전작업 제외」를 켰을 때. 통전 칸의 마지막 줄을 지우면
 *     저절로 켜진다(수정 화면).
 * ============================================================================
 */

export type WorkScopeSuppressionInput = {
  /**
   * 「① 조사작업」을 뺄 것인가 — 견적서의 「조사작업 제외」 체크다. 저장된 결정
   * (quotes.investigation_excluded)이고, 수정 화면은 체크 상자 상태를 그대로 넘긴다
   * (조사 칸의 마지막 줄을 지우면 isInvestigationScopeEmptied 로 저절로 켠다).
   */
  investigationExcluded: boolean;
  /** 견적서의 「통전작업 제외」 체크. */
  powerTestExcluded: boolean;
  /**
   * 「② 수리 작업」을 뺄 것인가 — isRepairSectionDropped 의 답을 그대로 넘긴다.
   * 필수로 둔 것은 부르는 곳마다 정하고 가게 하려는 것이다(빠뜨리면 타입이 막는다).
   */
  repairSectionDropped: boolean;
};

/**
 * 그 묶음이 이 견적서의 문서에서 빠지는가.
 *
 * `Record` 로 적는 이유는 xlsx 쪽 `WorkScopeExclusions` 와 같다 — 묶음이 하나 더
 * 생기는 날 **컴파일러가 여기를 채우라고 짚어 준다.**
 */
export function isWorkScopeSectionSuppressed(
  section: QuoteWorkScopeSection,
  { investigationExcluded, powerTestExcluded, repairSectionDropped }: WorkScopeSuppressionInput
): boolean {
  const suppressed: Record<QuoteWorkScopeSection, boolean> = {
    INVESTIGATION: investigationExcluded === true,
    REPAIR: repairSectionDropped === true,
    POWER_TEST: powerTestExcluded === true,
  };
  return suppressed[section];
}

/**
 * 조사 칸이 **손대서 비었는가** — 수정 화면이 조사 칸의 줄을 지운 순간 이것으로 「조사작업
 * 제외」를 저절로 켤지 정한다(2026-09-15 사용자: 「[1) 조사작업]도 줄을 모두 삭제하면 머리글도
 * 없어지도록」). 켜진 뒤로는 체크 상자가 그 결정이고, 그 결정을 견적서에 저장한다
 * (quotes.investigation_excluded). 문서 쪽은 저장된 그 칸을 읽을 뿐 다시 셈하지 않는다.
 *
 * 🔴 **비어 있다만으로는 빼지 않는다.** 이 기능이 생기기 전의 옛 견적서, 그리고
 * 장비 종류를 아직 안 고른 새 견적서도 조사 칸이 비어 있다 — 그 장들은 지금처럼
 * 양식의 기본 목록이 나가야 한다. 그래서 "손댔는가"를 함께 본다.
 *
 * 공백뿐인 줄은 저장할 때 걸러지므로(validation/quote-input.ts 의
 * normalizeWorkScopeLines) 없는 줄로 본다.
 *
 * 예전에는 수정 화면이 렌더마다 이것으로 뺄지를 셈했다. 체크 상자가 생긴 뒤로는 줄을 지운
 * 순간에만 부른다 — 글자를 고쳐 쓰느라 칸을 잠깐 비웠다고 칸이 감춰지면 안 된다.
 */
export function isInvestigationScopeEmptied({
  touched,
  texts,
}: {
  /** 사람이 이 견적서의 조사 칸을 손댔는가. 줄을 지운 순간에 부르므로 수정 화면은 늘 true 다. */
  touched: boolean;
  /** 지금 조사 칸에 적힌 줄들. */
  texts: readonly string[];
}): boolean {
  return touched && texts.every((text) => text.trim() === "");
}

/**
 * 「② 수리 작업」을 문서에서 빼는가 — **제너레이터** 견적서에서 수리 작업을 하나도
 * 고르지 않았을 때다.
 *
 * 2026-09-15 사용자: 「견적서 편집에서 정말로 수리작업 목록에서 아무것도 체크하지
 * 않으면 2 수리작업도 없애길 원한다. 체크돼 있으면 출력물에 2 수리작업만 있어도
 * 된다.」 제너레이터 양식 둘은 그 묶음의 기본 목록이 비어 있어(양식 실측 0줄), 고른
 * 작업이 없으면 줄 없는 머리글만 찍혀 나갔다.
 *
 * 🔴 기준은 **고른 작업 수**다 — 작업 내역 줄 수가 아니다. 작업을 골라 두고 줄만
 * 지웠으면 머리글은 남는다(「체크돼 있으면 머리글만 있어도 된다」).
 *
 * 매쳐는 해당하지 않는다 — 양식에 수리작업 기본 목록(2~3줄)이 있어 비어도 머리글만
 * 남는 일이 없다. 장비 종류가 없으면 제너레이터 양식이 쓰인다(quoteTemplateKey 와
 * 같은 판단 — 매쳐만 매쳐 양식이다).
 */
export function isRepairSectionDropped({
  equipmentKind,
  chosenRepairTaskCount,
}: {
  equipmentKind: WorkflowKind | null;
  chosenRepairTaskCount: number;
}): boolean {
  return equipmentKind !== "MATCHER" && chosenRepairTaskCount === 0;
}
