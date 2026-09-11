/**
 * ============================================================================
 * 내자 정리 — 견적서 연결 드롭다운에 무엇을 남길지 정하는 계산
 * ============================================================================
 * 내자 정리 수정 폼의 [견적서 연결]은 원래 살아 있는 견적서 **전부**를 후보로
 * 늘어놓았다. 한 줄이 가리키는 수리 건은 하나인데 후보는 수백 장이라, 같은
 * 모델의 다른 건 견적서를 잘못 고르기 쉬웠다(2026-09-11 사용자 요청).
 *
 * 그래서 후보는 **폼에서 지금 고른 수리 건의 견적서만**이다. React 도 DB 도
 * 들어오지 않는다(repair-case-link-search.ts 와 같은 자리, 같은 이유) — 화면
 * 안에 두면 "지금 연결된 견적서가 사라지지 않는가"를 시험할 길이 브라우저를
 * 띄우는 것밖에 없다.
 *
 * ── 수리 건을 안 골랐으면 후보가 없다 ───────────────────────────────────
 * "어느 건의 견적서인가"를 물을 기준이 없으니 아무것도 남기지 않는다. 전부를
 * 보여 주는 쪽으로 물러나면 이 계산이 막으려던 잘못 고르기가 그대로 돌아온다.
 * 수리 건이 붙지 않은 견적서(repairCaseId NULL — 수리 건이 지워져 SET NULL 된
 * 것 포함)는 **어느 건을 골라도** 후보에 뜨지 않는다.
 *
 * ── 🔴 지금 연결된 견적서는 조건과 상관없이 남긴다 ─────────────────────
 * 옛 줄에는 다른 건의 견적서가 연결돼 있을 수 있고, 폼에서 수리 건을 바꾸면
 * 고른 견적서가 새 건의 것이 아니게 된다. 그 항목을 목록에서 빼면 `<select>` 의
 * value 가 어느 `<option>` 과도 맞지 않아 브라우저가 첫 항목('연결 없음')을
 * 보여 준다 — 화면은 "연결 없음"인데 상태에는 연결이 남는 거짓말이 되고,
 * 그 모습을 믿고 다른 칸만 고쳐 저장한 사람은 무엇이 저장됐는지 모른다
 * (keepSelectedRepairCaseOption 과 같은 고장). 그래서 남기되, 남긴 것이 이
 * 건의 것이 아니라는 사실은 selectedOutsideRepairCase 로 알려 준다 — 화면이
 * 그 표시와 경고를 그린다. **조용히 연결을 푸는 일은 이 계산에 없다.**
 * ============================================================================
 */

/** 거를 때 실제로 보는 칸만 요구한다 — 조회의 전체 옵션 타입을 끌어오지 않는다. */
export type QuoteLinkSelectable = {
  id: string;
  repairCaseId: string | null;
};

export type QuoteLinkChoices<T> = {
  /**
   * 고른 수리 건의 견적서. 원본 순서 그대로다(부르는 쪽이 최근 발행순으로
   * 넘긴다). 지금 연결된 견적서를 붙잡아 둔 것은 **세지 않는다** — 그래야
   * "이 수리 건에 만든 견적서가 없습니다"를 낼 수 있다.
   */
  sameRepairCase: T[];
  /**
   * 실제로 `<select>` 에 그릴 목록 — sameRepairCase 에, 지금 연결된 견적서가
   * 거기 없으면 그것 하나를 더한 것. 더한 것도 원본 순서 자리에 들어간다.
   */
  visible: T[];
  /**
   * 지금 연결된 견적서가 목록에 있는데 **고른 수리 건의 것이 아니다**.
   * 수리 건을 안 골랐는데 견적서가 연결돼 있는 경우도 여기에 든다.
   * 연결된 견적서가 목록에 아예 없으면(지워진 견적서) false 다 — 없는 항목을
   * 지어내지 않는다.
   */
  selectedOutsideRepairCase: boolean;
};

/**
 * 견적서 드롭다운의 후보를 정한다.
 *
 * @param options          살아 있는 견적서 전부(조회 순서 그대로)
 * @param repairCaseId     폼에서 지금 고른 수리 건. 빈 문자열·null = 안 골랐음
 * @param selectedQuoteId  폼에서 지금 연결된 견적서. 빈 문자열·null = 연결 없음
 */
export function selectQuoteLinkChoices<T extends QuoteLinkSelectable>(
  options: readonly T[],
  repairCaseId: string | null | undefined,
  selectedQuoteId: string | null | undefined
): QuoteLinkChoices<T> {
  const sameRepairCase = repairCaseId
    ? options.filter((option) => option.repairCaseId === repairCaseId)
    : [];

  const selectedInSame =
    !!selectedQuoteId && sameRepairCase.some((option) => option.id === selectedQuoteId);
  const selectedExists =
    !!selectedQuoteId && options.some((option) => option.id === selectedQuoteId);
  const selectedOutsideRepairCase = selectedExists && !selectedInSame;

  if (!selectedOutsideRepairCase) {
    return { sameRepairCase, visible: [...sameRepairCase], selectedOutsideRepairCase };
  }

  const kept = new Set(sameRepairCase.map((option) => option.id));
  const visible = options.filter(
    (option) => kept.has(option.id) || option.id === selectedQuoteId
  );
  return { sameRepairCase, visible, selectedOutsideRepairCase };
}
