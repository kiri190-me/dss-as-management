import "server-only";
import { getSsoClientId, getSsoClientSecret, getSsoIssuer } from "@/lib/config/sso";
import {
  NO_PORTAL_DELEGATIONS,
  type PortalRouteDelegations,
} from "@/lib/domain/portal-approval-delegation";

/**
 * ============================================================================
 * 포털에 「이 사람이 지금 누구를 대신할 수 있나」를 묻는다 — 나가는 쪽
 * ============================================================================
 * 결재권 위임을 포털(dss-auth) 한 곳에 모으기로 한 결정(2026-11-13, 설계 B-1)의
 * A/S 쪽 읽는 자리다. 지정·되돌리기는 통합 승인함이 하고 저장은 포털이 하며,
 * 여기서는 **묻기만** 한다. 통로 규격은 설계서 C-2 에 있다:
 *
 *     POST {포털}/api/integration/delegations
 *     Authorization: Basic base64(client_id:client_secret)
 *     본문: sub=<포털 users.id>&action=acting
 *     답(200): { "subs": ["…"], "count": N }
 *
 * 🔴 **`subs[0]` 은 언제나 부른 사람 자신이다.** 뒤에 「이 사람이 대신할 수 있는
 * 결재권자들」의 포털 번호가 붙는다. 🔴 **이어 붙지 않는다** — A→B, B→C 라도 C 는
 * A 를 못 얻고, 그 판정은 **포털이 이미** 한다. 여기서 한 번 더 이어 붙이면 안 된다.
 *
 * ── 🔴 왜 portal-inbox.ts 에 같이 두지 않았나 ───────────────────────────
 * 그 파일은 **알림 하나의 왕복 넷**이고 머리말이 통째로 그 이야기다(종 · 지움 ·
 * 확인 · 결재 생성 신호). 이것은 **결재 길목의 인가 판정**에 쓰이는 전혀 다른
 * 물음이고, 못 물었을 때의 처신도 다르다 — 알림은 빈 목록이면 그만이지만 여기는
 * **사람이 결재를 못 누르는 결과**로 이어져 안내까지 띄워야 한다(설계 B-7).
 * 🔵 다만 **자격증명을 읽는 법과 보내는 머리말은 그 파일과 글자 그대로 같다** —
 * 같은 포털의 같은 인증이라 두 벌로 갈리면 한쪽만 조용히 거절당한다.
 *
 * ── 🔴 상한은 2초다. 설계서의 3초가 아니다 ──────────────────────────────
 * 설계서 B-6 은 「시간 제한 3초」라고 적었는데, **그것은 통합 승인함이 각 결재함을
 * 부를 때의 값**이다. A/S 가 포털을 부르는 왕복은 이 집에서 네 자리가 이미
 * **2초**로 맞춰져 있고(server/integration/portal-inbox.ts 의
 * NOTIFICATIONS_TIMEOUT_MS), 그 값은 다시 계측기 사이트(njlee 의 oidc.ts)와 같은
 * 값이다. 🔴 **같은 집에서 같은 포털을 부르는 상한이 둘이면, 느릴 때 어느 쪽이
 * 느린지 알 수 없게 된다.** 게다가 여기는 **사람이 [승인] 단추를 누르고 기다리는
 * 결재 길목**이라 짧은 쪽이 안전하다 — 넘치면 위임이 안 걸릴 뿐 결재 자체는 그대로
 * 진행되므로(설계 B-6), 1초를 더 기다려서 얻는 것보다 1초를 덜 기다려서 잃는 것이
 * 적다. 🔴 **이 문단을 지우지 마라**: 설계서만 읽은 사람이 「3초인데 왜 2초냐」로
 * 되돌리는 것을 막는 자리다.
 *
 * ── 🔴 어떤 일이 있어도 던지지 않는다 ───────────────────────────────────
 * 포털이 죽었든(503), 우리를 거절했든(401·403·429), 주소가 틀렸든, 설정이
 * 빠졌든, 이상한 JSON 을 보냈든 **「못 물었다」가 값으로 나간다**(설계 B-6 —
 * 못 물었을 때는 「위임 없음」으로 보고 결재를 그대로 진행한다). 던지면 포털 한
 * 곳이 멈춘 날 세 시스템의 결재가 전부 멈춘다.
 *
 * 🔴 **빈 목록과 「못 물었다」를 같은 값으로 뭉개지 않는다.** 그릇과 까닭은
 * domain/portal-approval-delegation.ts 머리말에 적어 두었다.
 * ============================================================================
 */

/**
 * 왕복 상한. 🔴 **2초인 까닭은 파일 머리말에 있다 — 설계서의 3초와 다르다.**
 */
const DELEGATIONS_TIMEOUT_MS = 2000;

export type PortalDelegationCredentials = {
  issuer: string;
  clientId: string;
  clientSecret: string;
};

/** 망으로 나가는 부분만. 둘 다 기본값이 있다. */
export type PortalDelegationTransportDeps = {
  /**
   * 기본값은 전역 `fetch`. 시험은 여기로 가짜를 넣어 **진짜 망을 타지 않고**
   * 거절·시간 초과·이상한 JSON 을 그대로 재현한다(portal-inbox.ts 와 같은 규약).
   */
  fetch?: typeof globalThis.fetch;
  /**
   * 기본값은 환경변수를 읽는 config 함수들. 🔴 그 함수들은 값이 없으면 **던지므로**
   * 아래에서 try 안에서 부른다 — 설정이 빠진 것 때문에 결재가 깨지면 안 된다.
   */
  readCredentials?: () => PortalDelegationCredentials;
};

/**
 * 🔴 **열쇠를 바꾸는 조회 둘. 기본값이 없다 — 부르는 쪽이 꽂는다.**
 *
 * 이 파일이 `@/lib/db/...` 를 **직접 끌어오지 않는 까닭**이 둘이다:
 *  1. server/integration/approval-created-notice.ts 가 정한 이 폴더의 규약이다 —
 *     「조회를 전부 인자로 받으면 판단을 DB 없이 그대로 시험할 수 있고, 실제 함수를
 *     꽂는 자리가 한눈에 보인다」.
 *  2. 🔴 **그렇게 안 하면 단위 시험이 통째로 못 돈다.** `npm test` 는 설정 파일을
 *     읽지 않아 `DATABASE_URL` 이 없는데(scripts/load-template-env.ts 의 🔴 주석 —
 *     단위 시험이 개발 DB 를 건드리지 못하게 막는 마지막 벽이다), `db/connection.ts`
 *     는 그 값이 없으면 **불러오는 순간 던진다.**
 */
export type PortalDelegationQueries = {
  /** A/S `users.id` → 포털 번호. queries/users.ts 의 `getSsoSubjectForUser`. */
  readPortalSubject: (userId: string) => Promise<string | null>;
  /** 포털 번호들 → A/S `users.id`. queries/users.ts 의 `listUserIdsBySsoSubjects`. */
  readUserIdsBySubjects: (
    subjects: readonly string[]
  ) => Promise<{ id: string; ssoSubject: string }[]>;
};

export type PortalDelegationDeps = PortalDelegationTransportDeps & PortalDelegationQueries;

/**
 * 🔴 새 환경변수를 만들지 않는다. 포털 주소·client_id·client_secret 은 통합 로그인이
 * 이미 쓰고 있는 그 값이다(portal-inbox.ts 와 같은 근거).
 */
function readCredentialsFromEnv(): PortalDelegationCredentials {
  return {
    issuer: getSsoIssuer(),
    clientId: getSsoClientId(),
    clientSecret: getSsoClientSecret(),
  };
}

/**
 * 포털이 돌려준 몸통에서 `subs` 만 꺼낸다. 🔴 **모르는 모양은 빈 목록이 아니라
 * 「못 읽었다」(null)** 다 — 포털이 통로를 고치다 칸 이름이 바뀐 날 「위임이 하나도
 * 없다」로 조용히 읽히면 안 된다.
 */
function readSubjects(payload: unknown): string[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const subs = (payload as { subs?: unknown }).subs;
  if (!Array.isArray(subs)) return null;
  return subs.filter((one): one is string => typeof one === "string" && one !== "");
}

/**
 * 포털에 묻는다 — **포털 번호 그대로** 돌려준다(열쇠 변환은 아래 함수가 한다).
 *
 * @param subject 포털의 `users.id`(= ID 토큰의 `sub`). A/S 는 `users.sso_subject` 로
 *                들고 있다. 🔴 **빈 값이면 묻지 않는다** — 포털 계정과 이어지지 않은
 *                로컬 계정이고, 그 사람에게는 포털 위임이 걸릴 수조차 없다.
 * @returns 물었으면 `{ asked: true, subs }`, 못 물었으면 `{ asked: false }`.
 *          🔴 빈 `subs` 와 `asked: false` 는 **다른 답**이다.
 */
export async function fetchPortalActingSubjects(
  subject: string,
  deps: PortalDelegationTransportDeps = {}
): Promise<{ asked: true; subs: string[] } | { asked: false }> {
  // 🔴 번호가 없는 사람은 「못 물었다」가 아니라 **「물을 것이 없다」**다. 빈 목록을
  //    물어본 것처럼 돌려준다 — 안내를 띄우면 영영 오지 않을 때를 기다리게 한다
  //    (domain/portal-approval-delegation.ts 머리말).
  if (!subject) return { asked: true, subs: [] };

  const send = deps.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    const { issuer, clientId, clientSecret } = (deps.readCredentials ?? readCredentialsFromEnv)();
    // 규격: base64(urlencode(client_id) + ":" + urlencode(client_secret)).
    const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;

    response = await send(`${issuer}/api/integration/delegations`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      // 🔴 `action=acting` — 「이 사람이 **대신할 수 있는** 사람들」을 묻는 방향이다.
      //    반대 방향(「나를 누가 대신하나」)은 같은 통로의 다른 action 이고, 그것을
      //    여기 꽂으면 오류 없이 아무도 못 누른다.
      body: new URLSearchParams({ sub: subject, action: "acting" }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(DELEGATIONS_TIMEOUT_MS),
    });
  } catch (error) {
    // 🔴 찍는 것은 오류의 **종류**뿐이다(TimeoutError · TypeError …). 주소도
    //    자격증명도 포털 번호도 남기지 않는다(portal-inbox.ts 의 로그 규약).
    console.error(
      "[sso] 결재권 위임을 물어보지 못했습니다:",
      error instanceof Error ? error.name : "unknown"
    );
    return { asked: false };
  }

  if (!response?.ok) {
    // 거절 본문은 포털의 내부 설정을 설명할 수 있다. 상태만 남긴다.
    console.error("[sso] 결재권 위임 통로 거절:", response?.status);
    return { asked: false };
  }

  let subs: string[] | null;
  try {
    subs = readSubjects(await response.json());
  } catch {
    subs = null;
  }
  if (subs === null) {
    console.error("[sso] 결재권 위임 응답을 읽지 못했습니다.");
    return { asked: false };
  }
  return { asked: true, subs };
}

/**
 * 🔴 **이 조각의 입구.** A/S 사용자 한 명에 대해 「포털에 맡겨 둔 위임으로 지금 누구를
 * 대신할 수 있나」를 **A/S `users.id` 목록**으로 돌려준다.
 *
 * ── 🔴 **트랜잭션을 열기 전에** 부를 것 ─────────────────────────────────
 * 설계 C-3 이 정한 길이다. 결재 판정은 제 DB 트랜잭션 **안에서** 하는데, 망 호출을
 * 그 안에 넣으면 트랜잭션이 망 지연만큼 열려 있게 된다(포털이 느린 날 결재 행
 * 잠금이 2초씩 붙들린다). 그래서 **먼저 묻고, 결과를 트랜잭션 안으로 들고 들어간다.**
 * 부르는 자리는 서버 액션 셋이다(server/actions/{repair-case,quote,domestic-order}-approvals.ts).
 *
 * ── 🔴 결재 mutation 이 이 함수를 **직접 부를 수 없다** ─────────────────
 * 이 집의 층 가르기는 `server/` → `db/` 한 방향이다(`src/lib/db` 안에서
 * `@/lib/server/...` 를 끌어오는 파일이 하나도 없다). 그래서 포털에 묻는 일은 **결재
 * mutation 안에서 할 수 없고**, 서버 액션이 물어 인자로 넘긴다. 🔵 그 모양이 위의
 * C-3 과 저절로 맞아떨어진다.
 *
 * ── 🔴 열쇠를 바꾸는 조회 둘은 **인자로 받는다** ────────────────────────
 * 까닭은 `PortalDelegationQueries` 주석에 있다(둘째 까닭이 중요하다 — 안 그러면
 * 단위 시험이 통째로 못 돈다). 꽂는 자리는 서버 액션 셋이고, 셋이 다 꽂았는지는
 * server/actions/portal-delegation-wiring.test.ts 가 소스로 센다.
 *
 * ── 🔴 변환에 실패한 번호를 **세어 남긴다** ─────────────────────────────
 * 포털이 준 번호 가운데 A/S 계정으로 바뀌지 않는 것이 있으면 **그 사람만** 오류 없이
 * 조용히 위임이 안 듣는다. 2026-11-16 운영 실측으로는 0명이지만 「오늘은 0」이지
 * 「영원히 0」이 아니다(설계 D-3). 🔴 **번호 자체는 찍지 않는다** — 사람을 가리키는
 * 값이라 로그에 쌓지 않는 것이 이 묶음의 규약이다(portal-inbox.ts). 그래서 **개수만**
 * 남긴다.
 *
 * @returns 🔴 던지지 않는다. 못 물었으면 `unavailable: true` 인 빈 목록이다.
 */
export async function resolvePortalRouteDelegations(
  actorUserId: string,
  deps: PortalDelegationDeps
): Promise<PortalRouteDelegations> {
  const { readPortalSubject, readUserIdsBySubjects } = deps;

  let subject: string | null;
  try {
    subject = await readPortalSubject(actorUserId);
  } catch (error) {
    // DB 를 못 읽은 것이다. 🔴 결재를 막지 않는다 — 그래도 **못 물은 것**이므로
    //    안내는 뜨게 한다(설계 B-6 의 대가를 갚는 자리 — B-7).
    console.error(
      "[sso] 포털 번호를 읽지 못해 결재권 위임을 묻지 못했습니다:",
      error instanceof Error ? error.name : "unknown"
    );
    return { delegatorUserIds: [], unavailable: true };
  }
  // 🔴 포털 계정이 없는 사람 — **장애가 아니다.** 그에게는 포털 위임이 걸릴 수조차
  //    없으므로 「위임 없음」이 사실이고, 안내를 띄우면 안 된다.
  if (!subject) return NO_PORTAL_DELEGATIONS;

  const answer = await fetchPortalActingSubjects(subject, deps);
  if (!answer.asked) return { delegatorUserIds: [], unavailable: true };

  // 🔴 **본인 번호를 여기서 빼지 않는다.** 포털은 맨 앞에 부른 사람 자신을 넣어
  //    주는데, 합치는 함수(domain/approval-route-delegation.ts 의
  //    actingApproverUserIds)가 본인을 맨 앞에 두고 중복을 걷는다. 여기서 또 빼면
  //    「누가 본인을 넣는가」가 두 곳이 된다.
  if (answer.subs.length === 0) return NO_PORTAL_DELEGATIONS;

  let rows: { id: string; ssoSubject: string }[];
  try {
    rows = await readUserIdsBySubjects(answer.subs);
  } catch (error) {
    // 물어는 봤는데 **바꾸지 못했다.** 결과는 「못 물었다」와 같다 — 위임이 안 걸린다.
    console.error(
      "[sso] 포털이 준 번호를 A/S 계정으로 바꾸지 못했습니다:",
      error instanceof Error ? error.name : "unknown"
    );
    return { delegatorUserIds: [], unavailable: true };
  }

  const missing = answer.subs.length - rows.length;
  if (missing > 0) {
    // 🔴 **개수만** 남긴다(위 머리말). 포털 계정과 이어지지 않았거나 지워진 계정이다.
    console.warn(
      `[sso] 포털이 준 결재권 위임 ${answer.subs.length}건 가운데 ${missing}건을 A/S 계정으로 바꾸지 못했습니다.`
    );
  }

  return { delegatorUserIds: rows.map((row) => row.id), unavailable: false };
}
