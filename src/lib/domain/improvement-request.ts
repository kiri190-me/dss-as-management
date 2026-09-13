/**
 * ============================================================================
 * 개선 요청 — 순수 규칙 (상태 옮기기 · 누가 무엇을)
 * ============================================================================
 * DB 도 서버도 여기서 만지지 않는다. 화면·서버 액션·mutation 이 **같은 함수**를
 * 보게 하려고 따로 뺀 자리다 — 규칙을 두 곳에 적으면 화면은 단추를 열어 주는데
 * 저장이 거절하거나, 반대로 화면만 막고 저장은 열려 있는 상태가 된다.
 *
 * 표 구조와 설계의 이유는 db/schema/improvement-requests.ts 머리말에 있다.
 *
 * ── 🔴 상태 칸 규칙은 DB CHECK 와 같다 ──────────────────────────────────
 * planImprovementRequestStatusChange 가 돌려주는 네 칸은 스키마의
 * `improvement_requests_*_pair` · `improvement_requests_status_columns` CHECK 를
 * 언제나 지킨다. 여기를 고치면 그 CHECK 도 함께 고칠 것(마이그레이션이 필요하다).
 *
 * ── 권한은 여기서 계산하지 않는다 ──────────────────────────────────────
 * 「상태를 바꿀 수 있는가」·「남의 글을 지울 수 있는가」(관리 권한)는 역할과
 * 관리자 설정(role_permissions)을 함께 봐야 하는 질문이라 서버가 답한다. 이 파일은
 * 그 답을 **인자로 받아** 글 한 건에 대해서만 판정한다.
 * ============================================================================
 */

/** 값 목록. 🔴 스키마의 improvement_request_status 와 글자 그대로 같아야 한다(시험이 맞춰 본다). */
export const IMPROVEMENT_REQUEST_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

export type ImprovementRequestStatus = (typeof IMPROVEMENT_REQUEST_STATUSES)[number];

export const IMPROVEMENT_REQUEST_STATUS_LABELS: Record<ImprovementRequestStatus, string> = {
  OPEN: "접수",
  IN_PROGRESS: "진행중",
  RESOLVED: "해결",
};

export function isImprovementRequestStatus(value: unknown): value is ImprovementRequestStatus {
  return (
    typeof value === "string" &&
    (IMPROVEMENT_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * 본문 상한(글자 = 코드 포인트). 🔴 스키마의 `improvement_requests_body_length`
 * CHECK 와 같은 수다 — 검증 시험이 스키마 파일의 글자를 읽어 대조한다.
 */
export const IMPROVEMENT_REQUEST_BODY_MAX_CHARS = 2000;

/**
 * 본문 글자 수. Postgres 의 char_length 와 같게 **코드 포인트**로 센다 —
 * `string.length`(UTF-16 단위)로 세면 이모지 하나가 둘로 세어져, 검증은 거절하는데
 * DB 는 받는 값(또는 그 반대)이 생긴다.
 */
export function countImprovementRequestBodyChars(text: string): number {
  return Array.from(text).length;
}

// ────────────────────────────────────────────────── 상태 옮기기

/** 상태에 딸린 네 칸 — 누가 언제 진행중으로, 누가 언제 해결로 옮겼는가. */
export type ImprovementRequestProgressFields = {
  inProgressBy: string | null;
  inProgressAt: Date | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
};

export type ImprovementRequestStatusChangePlan =
  /** 같은 상태로의 변경. 저장도 감사 로그도 만들지 않는다. */
  | { kind: "unchanged" }
  | {
      kind: "changed";
      status: ImprovementRequestStatus;
      /** 저장할 네 칸 전부. 부분이 아니다 — 그대로 SET 에 넣으면 된다. */
      fields: ImprovementRequestProgressFields;
    };

/**
 * 상태를 `from` 에서 `to` 로 옮길 때 네 칸을 어떻게 채우고 비울지 계산한다.
 *
 *  · 접수(OPEN)로 가면 네 칸을 **모두 비운다** — 되돌린 글은 처음 접수된 글과
 *    구별되지 않는다. 누가 되돌렸는지는 감사 로그가 남긴다.
 *  · 진행중(IN_PROGRESS)으로 가면 in_progress 쌍 = (행위자, 지금), resolved 쌍은
 *    비운다. 해결에서 되돌려 온 경우에도 in_progress 쌍은 **지금 옮긴 사람으로
 *    새로 적힌다** — 이 칸은 「지금 이 글을 맡은 사람」이다.
 *  · 해결(RESOLVED)로 가면 resolved 쌍 = (행위자, 지금), in_progress 쌍은 **그대로
 *    둔다** — 진행중을 거쳐 왔으면 그 기록이 남고, 접수에서 곧바로 왔으면 비어
 *    있는 채다(스키마 헤더의 '상태와 네 칸은 같은 말이어야 한다').
 *  · 같은 상태로의 변경은 `unchanged` 다. 진행중을 다시 진행중으로 누른다고 맡은
 *    사람이 바뀌지 않는다.
 *
 * 「지금」은 인자로 받는다 — 시험이 시계에 매이지 않게, 그리고 mutation 이 한
 * 트랜잭션 안에서 updated_at 과 같은 시각을 쓰게.
 *
 * `current` 는 DB 에서 읽은 지금 값이다. DB CHECK 를 지키는 행이라고 가정한다.
 */
export function planImprovementRequestStatusChange(input: {
  from: ImprovementRequestStatus;
  to: ImprovementRequestStatus;
  current: ImprovementRequestProgressFields;
  actorUserId: string;
  now: Date;
}): ImprovementRequestStatusChangePlan {
  const { from, to, current, actorUserId, now } = input;
  if (from === to) return { kind: "unchanged" };

  switch (to) {
    case "OPEN":
      return {
        kind: "changed",
        status: to,
        fields: { inProgressBy: null, inProgressAt: null, resolvedBy: null, resolvedAt: null },
      };
    case "IN_PROGRESS":
      return {
        kind: "changed",
        status: to,
        fields: { inProgressBy: actorUserId, inProgressAt: now, resolvedBy: null, resolvedAt: null },
      };
    case "RESOLVED":
      return {
        kind: "changed",
        status: to,
        fields: {
          inProgressBy: current.inProgressBy,
          inProgressAt: current.inProgressAt,
          resolvedBy: actorUserId,
          resolvedAt: now,
        },
      };
  }
}

// ────────────────────────────────────────────────── 누가 무엇을

/**
 * 이 사람이 이 글의 **내용을** 고칠 수 있는가 — 접수 상태인 자기 글일 때만.
 *
 * 관리 권한이 있어도 남의 글 내용은 못 고친다(승인된 설계). 글은 적은 사람의
 * 말이고, 관리자가 고치면 「누가 무엇을 요청했는가」가 흐려진다. 진행중·해결이
 * 되면 작성자도 못 고친다 — 맡은 사람이 읽고 움직이기 시작한 글이 발밑에서
 * 바뀌면 안 된다.
 */
export function canEditImprovementRequestBody(input: {
  status: ImprovementRequestStatus;
  createdBy: string;
  actorUserId: string;
}): boolean {
  return input.status === "OPEN" && input.createdBy === input.actorUserId;
}

/**
 * 이 사람이 이 글을 지울 수 있는가 — 관리 권한이 있으면 어느 글이든, 없으면
 * 접수 상태인 자기 글만.
 *
 * `canManage` 는 서버가 역할과 관리자 설정으로 계산해 넘긴다(파일 헤더의 '권한은
 * 여기서 계산하지 않는다').
 */
export function canDeleteImprovementRequest(input: {
  status: ImprovementRequestStatus;
  createdBy: string;
  actorUserId: string;
  canManage: boolean;
}): boolean {
  if (input.canManage) return true;
  return input.status === "OPEN" && input.createdBy === input.actorUserId;
}
