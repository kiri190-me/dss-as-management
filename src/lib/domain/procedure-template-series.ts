import type { ProcedureTemplateStatus } from "./procedure-template-types";

/**
 * ============================================================================
 * 절차 줄기(code) — 목록을 계열당 한 줄로 접는 규칙
 * ============================================================================
 * 사용자 신고(2026-11-04): "[기술 작업 절차]의 목록에 같은 이름의 절차들이
 * 버전만 다르게 있으면 오히려 버전 관리가 어려워진다."
 *
 * 그 말 그대로였다 — 조회는 행을 그대로 내보내고 화면은 그대로 나열했다. 같은
 * 절차의 v1·v4 가 두 줄로 서니, "지금 쓰는 판이 어느 것인가"를 목록에서 알 수
 * 없었다.
 *
 * ── 무엇이 줄기인가 ─────────────────────────────────────────────────────
 * `code` 다. 스키마가 그렇게 적고 있다 — procedure_templates 의 유니크 인덱스는
 * (code, version) 이고, 그 자리의 주석이 "code identifies a template lineage
 * across versions" 라고 말한다. 그래서 한 줄기 안에서 판 번호는 겹치지 않는다.
 *
 * ── 🔴 대표를 어떻게 고르는가 — 세 경우가 전부 실재한다 ─────────────────
 * 개발 DB 를 읽어 보고 정했다(2026-11-04, TECHNICAL_TASK 3줄기):
 *
 *   ① 게시본 하나 + 초안 하나 — 가장 흔한 모습. 대표는 그 게시본이다.
 *   ② 🔴 **게시본이 둘** — 그때(2026-11-04 오전)는 게시가 이전 게시본을 자동으로
 *      내리지 않아서 이 상태가 정상적으로 만들어졌다. 🔵 같은 날 오후에 게시가
 *      옛 게시본을 [만료됨]으로 내리게 바뀌었으므로(procedure-template-publish-
 *      policy.ts) **새로 만들어지지는 않는다.** 그래도 이 갈래는 지운 게 아니라
 *      그대로 둔다: 그 전에 만들어진 줄기가 DB 에 남아 있고(code "7" — v1·v2 둘 다
 *      PUBLISHED), 그런 줄기를 접으면서 아무 말도 안 하면 "어느 판이 쓰이는지"를
 *      목록에서 영영 알 수 없다. 대표는 판 번호가 큰 쪽이고, 화면은 그 사실을
 *      따로 표시한다.
 *   ③ 🔴 **게시본이 하나도 없다** — 아직 한 번도 게시하지 않은 줄기(초안만).
 *      대표는 초안이다. 게시본만 대표로 삼는 규칙이었다면 이 줄기는 목록에서
 *      통째로 사라졌을 것이다.
 *
 * 그래서 차례는 **게시본 → 초안 → 보관본**, 같은 무리 안에서는 판 번호가 큰
 * 쪽이다. 보관본이 맨 뒤인 까닭은 보관이 "이제 안 씀"이기 때문이다 — 그 줄기에
 * 살아 있는 다른 판이 있으면 그쪽이 사람이 찾는 것이다.
 *
 * ── 🔴 권한은 여기서 보지 않는다 ────────────────────────────────────────
 * 이 함수는 **받은 행만** 접는다. 상태로 거르는 일은 조회
 * (listTechnicalProcedureTemplates 의 includeAllStatuses)가 이미 했다. 그래서
 * 초안을 볼 수 없는 사람의 입력에는 초안 행이 애초에 없고, draftVersion 은
 * null 이 되어 "초안이 있다"는 사실조차 화면에 흘러나가지 않는다. 거르기를
 * 여기로 옮기면 거르는 곳이 둘이 되고, 둘이 어긋나는 날 조용히 새는 쪽으로
 * 기운다.
 * ============================================================================
 */

export type ProcedureTemplateSeriesMember = {
  id: string;
  code: string;
  version: number;
  status: ProcedureTemplateStatus;
};

export type ProcedureTemplateSeries<T extends ProcedureTemplateSeriesMember> = {
  code: string;
  /** 목록 한 줄이 가리키는 판 — 이름·설비·노드 수·날짜가 전부 이 행의 것이다. */
  representative: T;
  /** 이 줄기에서 **볼 수 있는** 모든 판, 판 번호 내림차순. */
  members: T[];
  publishedCount: number;
  draftCount: number;
  archivedCount: number;
  /** 지금 게시되어 있는 판(둘 이상이면 판 번호가 큰 쪽). 없으면 null. */
  publishedMember: T | null;
  /** 진행 중인 초안(둘 이상이면 판 번호가 큰 쪽). 없으면 null. */
  draftMember: T | null;
};

/** 대표를 고르는 차례. 숫자가 작을수록 먼저다 — 위 머리말의 근거를 그대로 옮긴 표다. */
const REPRESENTATIVE_ORDER: Record<ProcedureTemplateStatus, number> = {
  PUBLISHED: 0,
  DRAFT: 1,
  ARCHIVED: 2,
};

function pickRepresentative<T extends ProcedureTemplateSeriesMember>(members: readonly T[]): T {
  return members.reduce((best, candidate) => {
    const byStatus = REPRESENTATIVE_ORDER[candidate.status] - REPRESENTATIVE_ORDER[best.status];
    if (byStatus !== 0) return byStatus < 0 ? candidate : best;
    return candidate.version > best.version ? candidate : best;
  });
}

function highestOfStatus<T extends ProcedureTemplateSeriesMember>(
  members: readonly T[],
  status: ProcedureTemplateStatus
): T | null {
  let found: T | null = null;
  for (const member of members) {
    if (member.status !== status) continue;
    if (found === null || member.version > found.version) found = member;
  }
  return found;
}

/**
 * 같은 `code` 를 한 줄로 접는다.
 *
 * 줄기들의 차례는 **들어온 차례를 따른다** — 그 줄기의 행 가운데 가장 앞에 있던
 * 것의 자리다. 부르는 쪽(목록 조회)이 생성일 내림차순으로 주므로, 최근에 손댄
 * 줄기가 위에 온다. 여기서 다시 정렬하면 서버가 정한 차례가 조용히 뒤집힌다.
 * (Map 은 넣은 차례를 지킨다 — 그 성질에 기대고 있다.)
 *
 * 넘어온 배열은 손대지 않는다. 화면이 같은 배열을 삭제 모드에서 **판 단위로**
 * 다시 쓰기 때문이다.
 */
export function groupProcedureTemplatesByCode<T extends ProcedureTemplateSeriesMember>(
  rows: readonly T[]
): ProcedureTemplateSeries<T>[] {
  const byCode = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byCode.get(row.code);
    if (bucket) bucket.push(row);
    else byCode.set(row.code, [row]);
  }

  return [...byCode.entries()].map(([code, bucket]) => {
    const members = [...bucket].sort(
      (a, b) =>
        b.version - a.version ||
        REPRESENTATIVE_ORDER[a.status] - REPRESENTATIVE_ORDER[b.status]
    );
    return {
      code,
      representative: pickRepresentative(members),
      members,
      publishedCount: members.filter((m) => m.status === "PUBLISHED").length,
      draftCount: members.filter((m) => m.status === "DRAFT").length,
      archivedCount: members.filter((m) => m.status === "ARCHIVED").length,
      publishedMember: highestOfStatus(members, "PUBLISHED"),
      draftMember: highestOfStatus(members, "DRAFT"),
    };
  });
}
