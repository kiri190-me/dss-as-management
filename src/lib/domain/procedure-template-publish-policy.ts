import type { ProcedureTemplateStatus } from "./procedure-template-types";

/**
 * ============================================================================
 * 한 계열(code)에 게시본은 하나 — 게시하면 옛 게시본이 [만료됨]이 된다
 * ============================================================================
 * 사용자가 말한 것(2026-11-04):
 *   "지금 게시된 것이 있다면 그 다른 버전은 [만료됨]이 되고, 만료됨 에도
 *    [게시]를 둬서 다시 게시할 수 있도록 해줘. 한 제목 안에서 한개의 버전만
 *    게시상태로 있도록 되야 해."
 *
 * 그 전까지 게시는 **내 행 하나만** DRAFT → PUBLISHED 로 바꾸고 끝났다. 내리는
 * 일(archiveProcedureTemplate)은 최고관리자가 따로 눌러야 하는 별개 조작이었고,
 * 그 단추는 화면 어디에도 없었다. 그래서 한 계열에 게시본이 둘인 상태가
 * **정상적으로 만들어졌다** — 개발 DB 의 code "7" 이 v1·v2 둘 다 PUBLISHED 다
 * (2026-11-04 실측).
 *
 * ── 🔴 [만료됨]은 새 상태가 아니다 — 기존 ARCHIVED 다 ────────────────────
 * procedure_template_status 는 DRAFT/PUBLISHED/ARCHIVED 셋뿐이고, ARCHIVED 의
 * 뜻은 스키마 주석이 이미 "발행된 절차를 '이제 안 씀'으로 내리는 수명주기의
 * 다음 단계"라고 적고 있다(vendor/dss-core/src/schema/procedure-templates.ts).
 * 사용자가 말한 [만료됨]과 같은 뜻이다. 그래서 **enum 은 한 글자도 안 바꾸고
 * 화면 글자만** "보관됨" → "만료됨" 으로 옮겼다(procedure-template-types.ts).
 * 값을 늘리면 마이그레이션이 필요한데다, 뜻이 겹치는 상태가 둘이 되어 "보관과
 * 만료가 어떻게 다른가"를 영영 설명해야 한다.
 *
 * 🔵 글자를 옮겨도 기존 행의 뜻이 뒤바뀌지 않는다는 것을 **값으로** 확인하고
 * 정했다: 개발 DB 에 ARCHIVED 행이 **0개**다(2026-11-04). 보관 mutation 을
 * 부르는 화면이 지금껏 없었으므로, 사람이 그 상태를 만든 적이 한 번도 없다.
 *
 * ── 게시할 수 있는 상태가 둘이 되었다 ───────────────────────────────────
 * DRAFT(처음 올림)와 ARCHIVED(내려갔던 판을 다시 올림). 🔴 PUBLISHED 는
 * 아니다 — 이미 올라가 있는 것을 또 올리면 아무 일도 안 일어나는데, 사람은
 * 눌린 것이 안 먹혔다고 읽는다. 그리고 그 길을 열면 "자기 자신을 만료시키는"
 * 경우를 아래 pickPublishedSiblingsToExpire 가 매번 따로 피해야 한다.
 *
 * ── 🔴 왜 순수 함수로 떼어 두는가 ───────────────────────────────────────
 * 이 규칙을 쓰는 곳이 **둘**이다 — 서버(publishProcedureTemplate 이 트랜잭션
 * 안에서 실제로 판정)와 화면(절차 상세의 [게시] 단추 노출). 두 벌로 적으면
 * 어긋나는 날이 오고, 어긋나는 방향은 둘 다 나쁘다: 화면이 느슨하면 누를 때마다
 * 실패하는 단추가 생기고, 빡빡하면 서버는 되는데 길이 없는 기능이 된다.
 * 이 파일은 `server-only` 를 물지 않는다("use client" 화면이 직접 가져다 쓴다).
 * ============================================================================
 */

/**
 * 여기서 게시로 올라갈 수 있는 상태. 🔴 PUBLISHED 가 없는 것이 알맹이다
 * (위 머리말의 까닭).
 */
export const PROCEDURE_PUBLISHABLE_STATUSES = [
  "DRAFT",
  "ARCHIVED",
] as const satisfies readonly ProcedureTemplateStatus[];

export function canPublishFromProcedureStatus(status: ProcedureTemplateStatus): boolean {
  return (PROCEDURE_PUBLISHABLE_STATUSES as readonly ProcedureTemplateStatus[]).includes(status);
}

/** 계열 안의 한 판 — 이 규칙이 보는 것은 이 셋뿐이다. */
export type ProcedureSeriesMemberForPublish = {
  id: string;
  version: number;
  status: ProcedureTemplateStatus;
};

/**
 * 지금 올리는 판 때문에 [만료됨]으로 내려갈 판들.
 *
 * 🔴 **같은 계열의 행만** 넘어온다는 전제 위에 선다 — 계열을 고르는 일은 SQL 이
 * `code` 로 한다(publishProcedureTemplate). 여기서 code 를 다시 보지 않는 까닭은
 * 거르는 곳이 둘이 되면 어긋나기 때문이고, 어긋나면 **남의 계열이 내려가는**
 * 가장 비싼 쪽으로 틀린다.
 *
 * 🔴 **자기 자신은 뺀다.** 만료본을 다시 게시하는 길에서는 올리는 판 자신이
 * PUBLISHED 가 아니라 상관없어 보이지만, 조건을 id 로 적어 두어야 나중에
 * PUBLISHED 에서의 재게시를 허용하는 날 조용히 자기를 내리지 않는다.
 *
 * 차례는 받은 그대로다 — 부르는 쪽이 판 번호 오름차순으로 잠가서 넘긴다.
 */
export function pickPublishedSiblingsToExpire<T extends ProcedureSeriesMemberForPublish>(
  seriesMembers: readonly T[],
  publishingTemplateId: string
): T[] {
  return seriesMembers.filter(
    (member) => member.id !== publishingTemplateId && member.status === "PUBLISHED"
  );
}
