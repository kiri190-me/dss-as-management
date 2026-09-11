import type { QuoteWorkScopeSection } from "@/lib/validation/quote-input";

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
 * 함수를 거기서 부르게 바꾸지 않았다.
 * ============================================================================
 */

export type WorkScopeSuppressionInput = {
  /** 견적서의 「통전작업 제외」 체크. */
  powerTestExcluded: boolean;
};

/**
 * 그 묶음이 이 견적서의 문서에서 빠지는가.
 *
 * `Record` 로 적는 이유는 xlsx 쪽 `WorkScopeExclusions` 와 같다 — 묶음이 하나 더
 * 생기는 날 **컴파일러가 여기를 채우라고 짚어 준다.** 지금 켤 수 있는 것은
 * 통전작업뿐이고, 조사·수리는 늘 문서에 나간다.
 */
export function isWorkScopeSectionSuppressed(
  section: QuoteWorkScopeSection,
  { powerTestExcluded }: WorkScopeSuppressionInput
): boolean {
  const suppressed: Record<QuoteWorkScopeSection, boolean> = {
    INVESTIGATION: false,
    REPAIR: false,
    POWER_TEST: powerTestExcluded === true,
  };
  return suppressed[section];
}
