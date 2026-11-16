/**
 * ============================================================================
 * 포털이 써 주는 결재권 위임을 받아 적는다 — **들어오는 쪽**의 판단 전부
 * ============================================================================
 * 2026-11-16 저녁에 방식이 뒤집혔다(설계 B-12). 그 전에는 결재할 때마다 A/S 가
 * 포털에 물었고(이 폴더의 `portal-delegations.ts` — **나가는 쪽**, 아직 살아 있다),
 * 이제는 **포털이 지정·철회할 때 각 시스템에 전파한다.** 이 파일은 그 전파를 받아
 * `portal_approval_delegations` 한 줄로 바꾸는 자리다.
 *
 * 🔴 **이름이 닮은 두 파일을 섞지 마라.**
 *   · `portal-delegations.ts` — A/S 가 포털에 **묻는다**(나간다). 걷어내는 것은
 *     조각 8 이고, 지금 걷어내면 결재 셋에서 포털 위임이 조용히 안 듣는다.
 *   · `portal-delegation-push.ts`(이 파일) — 포털이 A/S 에 **써 준다**(들어온다).
 *
 * ── 🔴 왜 라우트에 안 적고 여기 뺐나 ────────────────────────────────────
 * 라우트는 DB 를 끌어오므로(`@/lib/db/...` → `DATABASE_URL` 없으면 불러오는 순간
 * 던진다) **단위 시험이 불러올 수 없다.** 그래서 이 집의 통합 통로들은 판단을 전부
 * 이 폴더의 모듈로 빼고 라우트에는 「토큰 꺼내 검증하고 이 함수 부르기」만 남긴다
 * (portal-approvals.ts · portal-notifications.ts 와 같은 규약). 저장 함수도 **인자로
 * 받는다** — 그래야 멱등·`not_applicable` 을 DB 없이 그대로 돌려 볼 수 있다.
 *
 * ── 🔴 통로 규약(세 시스템이 글자 그대로 같아야 한다) ───────────────────
 *
 *     POST /api/integration/delegations
 *     Authorization: Bearer <포털이 서명한 서비스 토큰>
 *     {
 *       "action": "upsert" | "revoke",
 *       "id": "<포털이 정한 uuid>",
 *       "delegatorSub": "<포털 users.id>",
 *       "delegateSub": "<포털 users.id>",
 *       "startsAt": "<ISO 8601>",
 *       "endsAt": "<ISO 8601>",
 *       "reason": "<글, 없으면 빈 문자열>",
 *       "revokedAt": "<ISO 8601>"
 *     }
 *
 *     200 { "outcome": "stored" }          — 저장했다
 *     200 { "outcome": "not_applicable" }  — 이 시스템에는 해당 없다
 *     4xx/5xx { "error", "error_description" } — 🔴 포털이 **전파 실패**로 보고
 *                                               지정 자체를 거절한다(설계 B-13)
 *
 * ── 🔴 규약에서 **글자까지 맞춰 둔 것 셋**(2026-11-16, 세 시스템 공통) ──────
 *  1. 토큰 쓰임새는 **`dss.delegations.write`** 다(auth/portal-service-token.ts 의
 *     `delegationsWrite`). 알림 쓰임새를 돌려쓰지 않는다 — 종을 읽는 토큰은 사람이
 *     화면을 열 때마다 오가는 가장 흔한 값이라, 그것으로 남의 결재권을 넘기는 줄을
 *     쓸 수 있으면 쓰임새를 나눈 까닭이 통로 하나로 무너진다.
 *     🔵 **포털은 아직 이 쓰임새를 굽지 않는다**(조각 7 에서 더한다).
 *  2. `upsert` 의 **`revokedAt` 은 널로 실려 올 수 있다.** 없음과 널을 **같게** 본다
 *     (살아 있는 줄). 🔴 **값이 실려 오면 400 이 아니라 그대로 적는다** — 버리면
 *     「거둔 줄 알았는데 안 거둬진」 상태가 생기고, 설계 B-13 이 그쪽을 더 위험하게
 *     본다. 🔴 널을 400 으로 거절하면 **멀쩡한 지정이 전부 막힌다.**
 *  3. 🔴 **시간대 없는 ISO 는 거절한다.** `"2026-11-16T00:00:00"` 은 서버의 지역
 *     시각으로 읽혀 개발 PC(KST)와 NAS(UTC)에서 **아홉 시간 다른 순간**이 되는데
 *     **오류가 한 번도 안 난다.** `Z` 또는 `±HH:MM` 이 붙어 있어야 받는다.
 *
 * ── 🔵 토큰의 `sub` 는 **쓰지 않는다** ──────────────────────────────────
 * 누구에 대한 줄인지는 **몸통**에 있다. 검증기가 `sub` 없는 토큰을 거절하므로 포털이
 * 아무나 한 사람을 싣겠지만, 🔴 **그 값으로 줄을 쓰면 안 된다** — 그러면 포털이 어느
 * 계정으로 토큰을 구웠느냐에 따라 **엉뚱한 사람의 결재권**이 넘어간다.
 *
 * 🔴 **`not_applicable` 이 핵심이다.** 위임자나 대리인이 A/S 에 계정이 없으면 줄을
 * 만들 수 없는데, **그것은 오류가 아니다** — 그 사람은 여기서 결재할 일이 없으니
 * 위임도 뜻이 없다. 오류로 답하면 포털이 B-13 대로 지정을 거절해서 「A/S 계정이
 * 없는 사람에게는 위임을 아예 못 맡기는」 일이 된다. 승인함은 일곱 사이트의 사람을
 * 전부 보므로 그런 사람이 **흔하다**.
 *
 * ── 🔴 멱등 ─────────────────────────────────────────────────────────────
 * 포털은 전파가 실패하면 **재시도한다.** 같은 `id` 로 두 번 와도 한 줄이어야 하고,
 * 그것을 지키는 것은 `portal_approval_delegations.id` 기본키 + `ON CONFLICT (id)
 * DO UPDATE` 다(mutations/portal-approval-delegations.ts). 번호를 여기서 만들지
 * 않는 까닭이기도 하다 — 만들면 재시도마다 줄이 하나씩 늘어난다.
 * ============================================================================
 */

/** 통로가 돌려주는 두 가지. 🔴 **둘 다 성공(200)이다.** */
export type PortalDelegationOutcome = "stored" | "not_applicable";

export type PortalDelegationUpsertCommand = {
  action: "upsert";
  /** 🔴 포털이 정한 번호. 여기서 만들지 않는다. */
  id: string;
  /** 포털 `users.id`. A/S 열쇠로 바꾸는 것은 아래 apply 함수가 한다. */
  delegatorSub: string;
  delegateSub: string;
  startsAt: Date;
  /** 🔴 이 순간은 포함하지 않는다(반열린 구간) — 표 주석과 같은 규칙. */
  endsAt: Date;
  /** 안 보냈으면 빈 글자. 널로 두지 않는다(표의 칸이 NOT NULL). */
  reason: string;
  /**
   * 🔴 **`upsert` 에도 실려 올 수 있다.** 없거나 널이면 **살아 있는 줄**이고(둘을
   * 같게 본다), 값이 있으면 **그대로 적는다** — 버리면 포털은 거뒀다고 믿는데 여기서는
   * 살아 있는 줄이 남는다(설계 B-13). 🔵 거절하지 않는 까닭은 포털이 객체를 통째로
   * 보내면 이 칸이 늘 실리기 때문이다 — 400 으로 막으면 멀쩡한 지정이 전부 막힌다.
   */
  revokedAt: Date | null;
};

export type PortalDelegationRevokeCommand = {
  action: "revoke";
  id: string;
  revokedAt: Date;
};

export type PortalDelegationCommand =
  | PortalDelegationUpsertCommand
  | PortalDelegationRevokeCommand;

export type PortalDelegationParseResult =
  | { ok: true; command: PortalDelegationCommand }
  | { ok: false; message: string };

/**
 * uuid 모양. 🔴 **포털이 보낸 번호를 그대로 기본키에 넣으므로** 여기서 걸러야 한다 —
 * 안 걸러면 Postgres 의 날것 오류(`invalid input syntax for type uuid`)가 500 으로
 * 나가고, 포털은 「A/S 가 고장났다」로 읽는다(실제로는 보낸 값이 틀린 것이다).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

/**
 * 🔴 **시간대가 붙은 ISO 8601 글만 받는다.**
 *
 * ── 왜 이렇게 깐깐한가 ──────────────────────────────────────────────────
 *  1. 🔴 **오프셋이 없으면 읽는 서버의 지역 시각이 된다.** `"2026-11-16T00:00:00"`
 *     은 개발 PC(KST)와 NAS(UTC)에서 **아홉 시간 다른 순간**이 되는데 **오류가 한
 *     번도 안 난다.** 위임 기간이 아홉 시간 어긋나면 그 틈에 누른 결재만 조용히
 *     막히거나 조용히 통과한다. 그래서 `Z` 또는 `±HH:MM` 을 **요구한다.**
 *  2. 🔴 **넘어가는 날짜를 막는다.** `new Date("2026-02-30T00:00:00Z")` 는 던지지
 *     않고 **3월 2일**이 된다. 받아 적으면 아무도 모르는 채로 이틀이 밀린다.
 *     그래서 달력을 **직접** 센다(윤년 포함).
 *  3. 숫자(epoch)를 받지 않는다 — `new Date(0)` 과 `new Date("0")` 이 다른 값이라,
 *     받아 주기 시작하면 세 시스템이 같은 값을 다르게 읽는 날이 온다.
 *
 * 🔵 포털이 `toISOString()` 을 쓰면 셋 다 저절로 지켜진다. 이 검사는 **그러지 않는
 * 날**을 위한 것이다.
 */
const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const lastDay = [
    31,
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  return day <= lastDay;
}

function readInstant(source: Record<string, unknown>, key: string): Date | null {
  const raw = readString(source, key);
  if (raw === null || raw === "") return null;

  const match = ISO_INSTANT_PATTERN.exec(raw);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  if (!isRealCalendarDate(Number(year), Number(month), Number(day))) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return null;

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** 「안 보냈다」로 볼 값들 — 없음 · 널 · 빈 글자. */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * 요청 몸통을 읽는다. **모양이 틀리면 400 이다**(부르는 쪽이 고쳐야 하는 것이고,
 * 조용히 넘기면 위임이 없는 채로 「저장했다」가 나간다).
 *
 * 🔴 사람이 읽는 까닭(`message`)을 함께 돌려준다. 받는 쪽이 포털 **서버**라 사람이
 * 맞혀 가며 두드릴 실마리가 되지 않고, 전파가 거절된 날 포털 로그에서 **무엇이
 * 틀렸는지**를 바로 읽을 수 있어야 한다(토큰 거절과 다른 판단 — 그쪽은 까닭을
 * 숨긴다).
 */
export function parsePortalDelegationPush(body: unknown): PortalDelegationParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "요청 본문이 객체가 아닙니다." };
  }
  const source = body as Record<string, unknown>;

  const action = readString(source, "action");
  if (action !== "upsert" && action !== "revoke") {
    return { ok: false, message: 'action 은 "upsert" 또는 "revoke" 여야 합니다.' };
  }

  const id = readString(source, "id");
  if (id === null || !UUID_PATTERN.test(id)) {
    return { ok: false, message: "id 가 uuid 가 아닙니다." };
  }

  if (action === "revoke") {
    const revokedAt = readInstant(source, "revokedAt");
    if (revokedAt === null) {
      return { ok: false, message: "revokedAt 이 ISO 8601 시각이 아닙니다." };
    }
    // 🔵 `delegatorSub` 같은 칸이 함께 와도 **읽지 않는다.** 철회는 `id` 로만 한다
    //    (규약) — 사람을 다시 맞춰 보면 그 사이에 바뀐 번호 때문에 못 거두는 줄이
    //    생길 수 있고, 「거둔 줄 알았는데 안 거둬진」 쪽이 더 위험하다(설계 B-13).
    return { ok: true, command: { action, id, revokedAt } };
  }

  const delegatorSub = readString(source, "delegatorSub");
  const delegateSub = readString(source, "delegateSub");
  if (delegatorSub === null || delegatorSub === "") {
    return { ok: false, message: "delegatorSub 이 없습니다." };
  }
  if (delegateSub === null || delegateSub === "") {
    return { ok: false, message: "delegateSub 이 없습니다." };
  }
  if (delegatorSub === delegateSub) {
    // 「A 가 A 를 대신한다」는 뜻이 없는 줄이다. 표의 CHECK 도 같은 것을 막지만,
    // 여기서 걸러야 날것의 제약 위반이 500 으로 나가지 않는다.
    return { ok: false, message: "위임자와 대리인이 같은 사람입니다." };
  }

  const startsAt = readInstant(source, "startsAt");
  if (startsAt === null) {
    return { ok: false, message: "startsAt 이 ISO 8601 시각이 아닙니다." };
  }
  const endsAt = readInstant(source, "endsAt");
  if (endsAt === null) {
    return { ok: false, message: "endsAt 이 ISO 8601 시각이 아닙니다." };
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    // 끝을 포함하지 않으므로 같아도 안 된다 — **단 한순간도 살아 있지 않은** 위임이
    // 되고, 맡긴 사람은 승인함에서 「맡겨 뒀다」고 믿는다.
    return { ok: false, message: "endsAt 은 startsAt 보다 뒤여야 합니다." };
  }

  // 🔴 `upsert` 에 실려 온 `revokedAt` — **없음과 널은 같다**(살아 있는 줄). 포털이
  //    객체를 통째로 보내면 이 칸이 늘 실리므로, 널을 거절하면 **멀쩡한 지정이 전부
  //    막힌다.** 값이 있으면 **그대로 적는다** — 버리면 포털은 거뒀다고 믿는데 여기서는
  //    살아 있는 줄이 남고, 설계 B-13 이 그쪽을 더 위험하게 본다.
  //    🔵 값이 있는데 **모양이 틀리면** 그때는 거절한다(위 시각 규칙 — 시간대 없는
  //    글자를 받아 적으면 아홉 시간 어긋난 철회 시각이 조용히 남는다).
  let revokedAt: Date | null = null;
  if (!isAbsent(source.revokedAt)) {
    revokedAt = readInstant(source, "revokedAt");
    if (revokedAt === null) {
      return { ok: false, message: "revokedAt 이 시간대가 붙은 ISO 8601 시각이 아닙니다." };
    }
  }

  const reason = source.reason;
  if (!isAbsent(reason) && typeof reason !== "string") {
    return { ok: false, message: "reason 이 글이 아닙니다." };
  }

  return {
    ok: true,
    command: {
      action,
      id,
      delegatorSub,
      delegateSub,
      startsAt,
      endsAt,
      reason: typeof reason === "string" ? reason : "",
      revokedAt,
    },
  };
}

/**
 * 🔴 **열쇠 변환**. 포털 번호 둘을 A/S `users.id` 둘로 바꾼다.
 *
 * 조회는 `queries/users.ts` 의 `listUserIdsBySsoSubjects` 를 **그대로** 쓴다(조각
 * 3a 에서 만든 것 — 새로 만들지 않는다). 그 조회는 **지워진 계정을 빼고** 찾으므로,
 * 여기서 「없다」가 되는 길은 셋이다:
 *   ① A/S 에 그 사람 계정이 아예 없다(다른 시스템만 쓰는 사람)
 *   ② 계정은 있는데 `sso_subject` 가 비어 있다(SSO 이전의 옛 로컬 계정 —
 *      2026-11-16 운영 실측으로 살아 있는 계정 중에는 0명이지만 「영원히 0」이
 *      아니다, 설계 D-3)
 *   ③ 지워진 계정이다
 * 🔴 **셋 다 `not_applicable` 이다 — 오류가 아니다**(파일 머리말).
 */
export type PortalDelegationTargets =
  | { applicable: true; delegatorUserId: string; delegateUserId: string }
  | { applicable: false };

export function decidePortalDelegationTargets(
  rows: readonly { id: string; ssoSubject: string }[],
  command: PortalDelegationUpsertCommand
): PortalDelegationTargets {
  const bySubject = new Map(rows.map((row) => [row.ssoSubject, row.id]));
  const delegatorUserId = bySubject.get(command.delegatorSub);
  const delegateUserId = bySubject.get(command.delegateSub);
  if (delegatorUserId === undefined || delegateUserId === undefined) {
    return { applicable: false };
  }
  // 🔴 서로 다른 포털 번호가 한 A/S 계정으로 모일 수는 없다
  //    (`users_sso_subject_unique` 가 한 번호에 한 계정만 허락한다). 그래도 한 번
  //    보는 것은, 그 전제가 깨진 날 표의 CHECK 위반이 **500** 으로 나가 포털이
  //    「A/S 가 고장났다」로 읽기 때문이다. 여기서는 「해당 없음」이 사실에 가깝다.
  if (delegatorUserId === delegateUserId) return { applicable: false };
  return { applicable: true, delegatorUserId, delegateUserId };
}

export type PortalDelegationPushDeps = {
  /** 포털 번호들 → A/S `users.id`. `queries/users.ts` 의 `listUserIdsBySsoSubjects`. */
  lookupUserIdsBySubjects: (
    subjects: readonly string[]
  ) => Promise<{ id: string; ssoSubject: string }[]>;
  /** 한 줄을 넣거나 덮어쓴다. `mutations/portal-approval-delegations.ts`. */
  storeDelegation: (row: {
    id: string;
    delegatorUserId: string;
    delegateUserId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
    /** 🔴 포털이 실어 보냈으면 그 값. 없거나 널이면 **살아 있는 줄**이다. */
    revokedAt: Date | null;
  }) => Promise<PortalDelegationOutcome>;
  /** 그 `id` 의 줄을 거둔다. 없는 줄이면 `not_applicable`. */
  revokeDelegation: (params: { id: string; revokedAt: Date }) => Promise<PortalDelegationOutcome>;
};

/**
 * 🔴 **이 조각의 입구.** 읽어 둔 명령 하나를 실제로 반영한다.
 *
 * 던지는 것은 저장 함수가 던졌을 때뿐이고(그때는 라우트가 500 으로 답해 포털이
 * 재시도한다), 판단으로 거절하는 길은 여기 없다 — 모양 검사는 위 parse 가 이미 했고,
 * 「해당 없음」은 거절이 아니라 **성공**이다.
 */
export async function applyPortalDelegationPush(
  command: PortalDelegationCommand,
  deps: PortalDelegationPushDeps
): Promise<PortalDelegationOutcome> {
  if (command.action === "revoke") {
    // 🔵 **없는 줄에 와도 오류가 아니다.** 애초에 `not_applicable` 로 저장하지
    //    않았던 위임일 수 있다(두 사람 중 하나가 A/S 계정이 없었다). 그 줄을 거두는
    //    전파는 여기서는 할 일이 없는 것이고, 오류로 답하면 포털이 **철회 자체를
    //    거절한다** — 거두려는 사람이 영영 못 거둔다.
    return deps.revokeDelegation({ id: command.id, revokedAt: command.revokedAt });
  }

  const rows = await deps.lookupUserIdsBySubjects([command.delegatorSub, command.delegateSub]);
  const targets = decidePortalDelegationTargets(rows, command);
  if (!targets.applicable) return "not_applicable";

  return deps.storeDelegation({
    id: command.id,
    delegatorUserId: targets.delegatorUserId,
    delegateUserId: targets.delegateUserId,
    startsAt: command.startsAt,
    endsAt: command.endsAt,
    reason: command.reason,
    // 🔴 **버리지 않는다.** 포털이 거둔 줄을 `upsert` 로 실어 보낼 수 있고, 그것을
    //    흘리면 포털은 거뒀다고 믿는데 여기서는 살아 있다(설계 B-13).
    revokedAt: command.revokedAt,
  });
}
