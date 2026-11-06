import { domesticOrderDetailHrefs } from "./domestic-order-detail-tabs";
import { dash } from "./domestic-order-display";
import { foldBlankToNull } from "./domestic-order-list";

/**
 * ============================================================================
 * 내자 정리의 **[형식] 칸을 누르면 기타건 상세로** — 그 판정 (2026-11-06)
 * ============================================================================
 * 사용자 요구 그대로: 「수리건을 연결하지 않은 채 줄 추가를 한 건 포함, 그렇게
 * 만들어진 행에서는 [형식]의 내용을 누르면 [수리건 상세]처럼 그 건의 상세 창으로
 * 넘어가도록 해줘」.
 *
 * 규칙만 여기 둔다 — 그리는 일은 화면(DomesticOrderListScreen 의 ModelNameLink)이
 * 한다. 나누는 까닭은 이 저장소의 관례 그대로다: 「어떤 줄에 링크가 서는가」는
 * 규칙이지 그리기가 아니라서, 화면 안에 두면 시험할 방법이 브라우저를 띄우는 것
 * 밖에 남지 않는다(domain/domestic-order-list.ts 파일 머리말).
 *
 * ── 🔴 **수리 건이 붙은 줄에는 링크가 서지 않는다** ──────────────────────
 * 그 줄은 이미 **인수번호**가 수리 건 상세로 가는 링크다(IntakeNumberLink). 한 줄에
 * 서로 다른 곳으로 가는 링크가 둘이면 사람은 어느 쪽이 「이 줄」인지 알 수 없다.
 * 가르는 기준은 `repairCaseId` 하나다 — 인수번호 글자(`intakeNumberText`)가 아니다.
 * 그 글자는 **연결을 못 찾은 줄에도 남아 있어서**, 그것으로 가르면 수리 건과
 * 이어지지 않은 줄의 링크가 조용히 사라진다.
 *
 * ── 🔴 형식이 비어 있어도 누를 것이 있어야 한다 ─────────────────────────
 * 손으로 [행 추가] 한 줄은 형식이 비어 있을 수 있다(기타 견적서가 만든 줄은
 * 품명이 적혀 오지만 — domain/quote-domestic-order-line.ts — 사람이 만든 줄은
 * 아무것도 안 적어도 저장된다). 빈 칸에는 누를 글자가 없고, 그러면 **그 줄은
 * 상세로 갈 길이 아예 없다.**
 *
 * 그래서 그때만 `(형식 없음)` 을 링크 글자로 세운다. 괄호 글자는 이 화면이 이미
 * 쓰고 있는 모양이다(목록의 `(고객사 미지정)` 묶음). "-" 를 링크로 만들지 않는
 * 까닭: 이 저장소에서 "-" 는 **모든 화면이 빈 값에 쓰는 글자**라, 그것만 밑줄이
 * 그어져 있으면 「빈 칸을 누를 수 있다」는 규칙이 생긴 것으로 읽힌다.
 *
 * ⚠️ 그래서 **수리 건이 붙지 않은 줄에서만** 글자가 "-" 에서 `(형식 없음)` 으로
 * 바뀐다. 붙은 줄은 예전 그대로 "-" 다 — 거기는 누를 것이 필요 없다.
 *
 * ── 🔵 휴지통은 이 함수를 부르지 않는다 ─────────────────────────────────
 * 휴지통 줄은 `is_deleted = true` 이고 상세 조회는 살아 있는 줄만 읽으므로
 * (queries 의 getDomesticOrderDetail), 링크를 세우면 전부 404 로 간다. 게다가
 * 휴지통이 받는 행(DeletedDomesticOrderRow)에는 `repairCaseId` 가 아예 없어
 * 위 ① 을 판정할 재료가 없다 — 억지로 세우면 수리 건이 붙은 줄까지 링크가 된다.
 * 복원하면 목록에서 링크가 다시 선다.
 * ============================================================================
 */

/** 형식이 비어 있는 줄의 링크 글자. 화면과 시험이 같은 글자를 쓴다. */
export const DOMESTIC_ORDER_NO_MODEL_LINK_LABEL = "(형식 없음)";

export type DomesticOrderModelLink =
  /** 누를 수 있다 — `href` 로 간다. */
  | { kind: "LINK"; href: string; label: string }
  /** 글자만 그린다. 수리 건이 붙은 줄이다. */
  | { kind: "TEXT"; label: string };

/**
 * 이 줄의 [형식] 칸을 무엇으로 그릴 것인가.
 *
 * 보는 차례가 곧 뜻이다:
 *  ① 수리 건이 붙어 있으면 **글자만**이다(위 머리말 ①). 빈 값은 "-".
 *  ② 붙어 있지 않으면 링크다. 형식이 있으면 그 글자, 없으면 `(형식 없음)`.
 *
 * 공백만 적힌 형식은 없는 것으로 접는다 — 목록의 다른 칸들과 같은 규칙이고
 * (foldBlankToNull), 접지 않으면 **보이지 않는 한 칸짜리 링크**가 생긴다.
 */
export function resolveDomesticOrderModelLink(row: {
  id: string;
  repairCaseId: string | null;
  /** 이미 정해진 값이다 — 이 줄의 형식, 없으면 연결된 수리 건의 형식(매퍼의 modelName). */
  modelName: string | null;
}): DomesticOrderModelLink {
  const modelName = foldBlankToNull(row.modelName);
  // 🔵 빈 값의 글자는 이 저장소가 한 곳에서만 정한다 — 여기서 "-" 를 직접 적으면
  //    그 글자가 두 벌이 된다(domestic-order-display.ts 의 dash).
  if (row.repairCaseId !== null) return { kind: "TEXT", label: dash(modelName) };
  return {
    kind: "LINK",
    href: domesticOrderDetailHrefs(row.id).root,
    label: modelName ?? DOMESTIC_ORDER_NO_MODEL_LINK_LABEL,
  };
}
