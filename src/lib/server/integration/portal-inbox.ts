import "server-only";
import { getSsoClientId, getSsoClientSecret, getSsoIssuer } from "@/lib/config/sso";
import {
  EMPTY_PORTAL_INBOX,
  normalizePortalNotificationFeed,
  type PortalNotificationInbox,
} from "@/lib/domain/portal-notification-inbox";

/**
 * ============================================================================
 * 포털에 「이 사람의 **다른 시스템** 알림」을 묻는다 — 나가는 쪽
 * ============================================================================
 * 사내 시스템이 다섯이 되면서(A/S · 개선요청 · 계측기 · PO/내자 · 휴가) 「어느
 * 시스템에 있든 종 하나를 열면 다 보인다」로 가기로 했고, 합치는 일은 포털
 * (dss-auth)이 한다. 부르는 법·응답 모양·거절 코드는 그쪽 규격서에 있다:
 * `dss-auth/docs/사이트-알림-통로.md`.
 *
 * ── 🔴 이 저장소에 포털 알림 파일이 셋이다. 헷갈리지 말 것 ────────────────
 *  1. `server/integration/portal-notifications.ts` — **들어오는 쪽**. 포털이
 *     A/S 에 물어 갈 때 내주는 판단(PortalNotificationFeed).
 *  2. `domain/portal-notification-inbox.ts` — **받은 것의 모양과 검사**(순수).
 *  3. 이 파일 — **나가서 묻는 왕복** 하나. 위 둘을 잇는 자리다.
 *
 * ── 🔴 왜 서버에서만 부르나 ─────────────────────────────────────────────
 * 자격은 이 사이트의 `client_secret` 이다(포털 세션 쿠키가 없는 곳에서 부르기
 * 때문이다 — 규격서 첫 절). 브라우저에서 부르려면 이 사이트 안에 중계 통로를
 * 하나 더 두고 거기서 세션을 다시 검증해야 한다: **시크릿을 다루는 자리를 하나
 * 더 만드는** 일이다. 그래서 `server-only` 를 물고, 값은 어떤 로그에도 찍지
 * 않는다(거절은 **상태 코드만** 남긴다 — 거절 본문은 포털의 내부 설정을 설명할
 * 수 있다).
 *
 * 🔴 자격증명은 **머리말(Authorization: Basic)** 로만 보낸다. 주소에 실으면
 *    포털이 400 으로 거절하고, 그 값은 이미 접근 로그에 남아 **다시 발급**해야
 *    한다(규격서).
 *
 * ── 🔴 어떤 일이 있어도 던지지 않는다 ───────────────────────────────────
 * 포털이 죽었든(503), 우리를 거절했든(401·403·429), 주소가 틀렸든, 설정이
 * 빠졌든, 이상한 JSON 을 보냈든 **빈 목록**이 나간다. 이 값은 모든 화면에 딸려
 * 오는 머리말에 실리므로, 여기서 던지면 알림 하나 때문에 사이트 전체가 빈
 * 화면이 된다. 그래서 부르는 쪽(app)/layout.tsx 에 error boundary 가 없다.
 *
 * ── 왕복에 상한을 건다 ─────────────────────────────────────────────────
 * 부르는 쪽은 이 약속을 **기다리지 않는다**(값이 아니라 Promise 를 내려보내고,
 * 종이 도착한 뒤에 이어 붙인다 — NotificationBell.tsx 의 그 주석). 그래도
 * 상한을 두는 이유는 서버 쪽 일감이다: 포털이 대답하지 않으면 그 요청의 렌더가
 * 끝나지 않고 붙잡혀 있다. 2초는 계측기 사이트가 쓰는 값과 같게 맞췄다
 * (njlee 의 oidc.ts).
 *
 * ── 다시 묻는 주기를 두지 않는다 ────────────────────────────────────────
 * 포털이 이미 30초 캐시를 들고 있어 그보다 자주 물으면 **같은 답**을 받는다
 * (규격서). 그래서 여기에도, 종에도 되풀이 장치가 없다 — 화면을 새로 열 때
 * 갱신된다. `cache: "no-store"` 는 그 반대가 아니다: 답이 사람마다 다르고
 * 방금 처리한 일이 바로 빠져야 하므로, **이쪽에서 또** 담아 두지 않는다.
 * ============================================================================
 */

/** 왕복 상한. 이 시간을 넘기면 빈 목록이다. */
const NOTIFICATIONS_TIMEOUT_MS = 2000;

export type PortalInboxCredentials = {
  issuer: string;
  clientId: string;
  clientSecret: string;
};

export type PortalInboxDeps = {
  /**
   * 기본값은 전역 `fetch`. 시험은 여기로 가짜를 넣어 **진짜 망을 타지 않고**
   * 거절·시간 초과·이상한 JSON 을 그대로 재현한다.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * 기본값은 환경변수를 읽는 config 함수들. 🔴 그 함수들은 값이 없으면
   * **던지므로** 아래에서 try 안에서 부른다 — 설정이 빠진 것 때문에 머리말이
   * 깨지면 안 된다.
   */
  readCredentials?: () => PortalInboxCredentials;
};

/**
 * 🔴 새 환경변수를 만들지 않는다. 포털 주소·client_id·client_secret 은 통합
 * 로그인이 이미 쓰고 있는 그 값이다(규격서: 「로그인(토큰 교환)에 쓰는 값과
 * **같은 값**이다. 새로 받을 것이 없다」).
 */
function readCredentialsFromEnv(): PortalInboxCredentials {
  return {
    issuer: getSsoIssuer(),
    clientId: getSsoClientId(),
    clientSecret: getSsoClientSecret(),
  };
}

/**
 * 포털에 묻는다.
 *
 * @param subject 포털의 `users.id`(= ID 토큰의 `sub`). A/S 는 `users.sso_subject`
 *                로 들고 있다 — 읽는 자리는 `db/queries/users.ts` 의
 *                `getSsoSubjectForUser` 다. 🔴 **빈 값이면 묻지 않는다**: 포털
 *                계정과 이어지지 않은 로컬 계정이 있고(설계서 F-3) 그 사람은
 *                자기 알림만 본다. 정상이며 오류가 아니다.
 */
export async function fetchPortalNotificationInbox(
  subject: string,
  deps: PortalInboxDeps = {}
): Promise<PortalNotificationInbox> {
  if (!subject) return EMPTY_PORTAL_INBOX;

  const send = deps.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    const { issuer, clientId, clientSecret } = (deps.readCredentials ?? readCredentialsFromEnv)();
    // 규격서: base64(urlencode(client_id) + ":" + urlencode(client_secret)).
    const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;

    response = await send(`${issuer}/api/integration/notifications`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ sub: subject }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(NOTIFICATIONS_TIMEOUT_MS),
    });
  } catch (error) {
    // 🔴 찍는 것은 오류의 **종류**뿐이다(TimeoutError · TypeError …). 주소도
    //    자격증명도 남기지 않는다.
    console.error(
      "[sso] 알림을 물어보지 못했습니다:",
      error instanceof Error ? error.name : "unknown"
    );
    return EMPTY_PORTAL_INBOX;
  }

  if (!response?.ok) {
    console.error("[sso] 알림 통로 거절:", response?.status);
    return EMPTY_PORTAL_INBOX;
  }

  try {
    return normalizePortalNotificationFeed(await response.json());
  } catch {
    console.error("[sso] 알림 응답을 읽지 못했습니다.");
    return EMPTY_PORTAL_INBOX;
  }
}
