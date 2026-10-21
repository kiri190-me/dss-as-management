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
 *  3. 이 파일 — **나가는 왕복 셋**. 위를 향해 묻는 쪽
 *     (fetchPortalNotificationInbox)과, 「그만 보겠다」를 적는 쪽
 *     (dismissPortalNotifications — 파일 가운데)과, 「확인했다」를 적는 쪽
 *     (acknowledgePortalNotification — 파일 맨 아래, 2026-10-22). 셋은 같은
 *     자격증명 · 같은 상한 · 같은 거절을 쓴다. 🔴 **뒤의 둘은 뜻이 다르다** —
 *     지움은 재로그인하면 돌아오고 확인은 안 돌아온다(그 둘의 머리말).
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

/**
 * 왕복 상한. 묻는 쪽에서 이 시간을 넘기면 빈 목록이고, 적는 쪽에서 넘기면
 * 「못 적었다」다. 🔴 **두 방향이 같은 값을 쓴다** — 같은 포털의 같은 종류의
 * 왕복이라, 한쪽만 늘리면 어느 쪽이 느린지 알 수 없게 된다.
 */
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

/* ========================================================================== */
/* 「이 알림은 그만 보겠다」를 포털에 적는다 — **쓰는 쪽**                      */
/*                                                                            */
/* 2026-10-20 까지 지움은 **각 사이트의 브라우저**(localStorage)에 적혔다.      */
/* 브라우저 저장소는 주소(포트)별로 갈려서 같은 사람이 시스템마다 다른 목록을   */
/* 봤다 — A/S(3000)에서 지운 줄이 계측기·PO 의 종에는 그대로 떴다. 그래서      */
/* 지움을 포털 한 곳에 모았고, 여기가 그 **쓰는 쪽**이다. 돌아오는 길은 이미   */
/* 열려 있다(위 `dismissed` — domain/portal-notification-inbox.ts).            */
/*                                                                            */
/* 🔴 **읽는 쪽과 같은 자격증명 · 같은 상한 · 같은 거절이다.** 그래서 같은     */
/*    파일에 나란히 둔다 — 둘이 어긋나면 「알림은 오는데 지움은 안 먹히는」     */
/*    상태가 되고, 그 어긋남은 신고로만 드러난다.                              */
/*                                                                            */
/* 🔴 이 사이트에서 지우는 줄에는 **제 알림도 섞여 있다.** 제 줄의 열쇠도      */
/*    모양이 같아(`rf-service-system:{id}` — domain/notification-bell-items.ts */
/*    의 notificationBellKey) 포털이 그대로 받아 적고, 다음 왕복에서           */
/*    `dismissed` 로 돌려준다. 거르는 일은 NotificationBell.tsx 의             */
/*    selectVisibleNotifications 가 한다.                                      */
/* ========================================================================== */

/**
 * 한 번에 보낼 수 있는 열쇠 수.
 *
 * 🔴 **넘으면 포털이 400 으로 통째로 거절한다 — 앞의 200개만 받아 주지 않는다.**
 * 그래서 나누는 일을 보내는 쪽이 한다. 값의 근거는 포털 쪽에 있다
 * (dss-auth/docs/사이트-알림-통로.md, 2026-10-20). 🔴 여기 값을 올려도 저쪽이 안
 * 올라가면 소용이 없다 — **저쪽을 따라가는 값**이지 우리가 정하는 값이 아니다.
 *
 * 🔴 A/S 에만 「보이는 알림 지우기 n건」이 있어서, 사내 일곱 가운데 이 상한에
 * 실제로 닿을 수 있는 곳은 여기뿐이다.
 */
const DISMISSALS_PER_REQUEST = 200;

/**
 * 열쇠 한 묶음을 포털에 적는다. 🔴 **던지지 않는다** — 돌려주는 것은 「적혔는가」
 * 하나뿐이고, 까닭은 서버 로그에만 남는다.
 */
async function recordDismissalChunk(
  subject: string,
  dismissalKeys: readonly string[],
  deps: PortalInboxDeps
): Promise<boolean> {
  const send = deps.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    // 🔴 자격증명을 읽는 자리가 **try 안**인 것은 묻는 쪽과 같은 까닭이다 —
    //    config 의 getter 는 값이 없으면 던지고, 설정이 빠진 것 때문에 ✕ 한 번이
    //    화면을 깨면 안 된다.
    const { issuer, clientId, clientSecret } = (deps.readCredentials ?? readCredentialsFromEnv)();
    // 규격서: base64(urlencode(client_id) + ":" + urlencode(client_secret)).
    const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;

    response = await send(`${issuer}/api/integration/notification-dismissals`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ sub: subject, keys: dismissalKeys.join(",") }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(NOTIFICATIONS_TIMEOUT_MS),
    });
  } catch (error) {
    // 🔴 남기는 것은 오류의 **종류**뿐이다. 열쇠에는 수리 건 번호 같은 업무
    //    식별자가 들어 있어서 로그에 쌓을 까닭이 없다(묻는 쪽과 같은 규약).
    console.error(
      "[sso] 알림 지움을 적지 못했습니다:",
      error instanceof Error ? error.name : "unknown"
    );
    return false;
  }

  if (!response?.ok) {
    // 거절 본문은 포털의 내부 설정을 설명할 수 있다. 상태만 남긴다.
    console.error("[sso] 알림 지움 통로 거절:", response?.status);
    return false;
  }

  return true;
}

/**
 * 「이 알림들은 그만 보겠다」를 포털에 적는다. 🔴 **어떤 일이 있어도 던지지
 * 않는다** — 묻는 쪽과 같은 약속이다. 못 적으면 그 줄이 새로고침한 뒤 다시 뜰
 * 뿐이고, 그것이 화면이 깨지는 것보다 훨씬 낫다.
 *
 * @param subject 포털의 `users.id`(= ID 토큰의 `sub`). A/S 는 `users.sso_subject`
 *                로 들고 있다. 🔴 **서버가 제 세션에서 읽은 값**이어야 한다 —
 *                브라우저가 보낸 값을 그대로 넘기면 남의 알림을 지우는 통로가 된다.
 * @param dismissalKeys `{client_id}:{id}` 모양. 모양이 틀리거나 모르는 시스템의
 *                것은 포털이 **조용히 버린다** — 한 줄 때문에 묶음이 통째로
 *                실패하지 않는다.
 * @returns 보낸 묶음이 **전부** 적혔는가. 하나라도 거절되면 false 다.
 *
 * 🔵 몇 번을 다시 보내도 안전하다 — 같은 열쇠를 두 번 지우는 것은 한 번 지우는
 *    것과 같다(포털이 이미 있는 열쇠를 조용히 넘긴다). 그래서 실패를 되돌리는
 *    장치가 없다: 다음에 또 누르면 그대로 적힌다.
 */
export async function dismissPortalNotifications(
  subject: string,
  dismissalKeys: readonly string[],
  deps: PortalInboxDeps = {}
): Promise<boolean> {
  // 🔴 포털 계정에 이어지지 않은 로컬 계정은 적을 곳이 없다(묻는 쪽과 같은 갈래).
  if (!subject) return false;

  // 같은 열쇠가 두 번 실려 와도 한 번만 보낸다. 포털은 어느 쪽이든 같은 답을
  // 주지만, 겹친 값이 200 칸을 차지해 묶음이 괜히 늘어나지 않게 한다.
  const wanted = Array.from(
    new Set(dismissalKeys.filter((key): key is string => typeof key === "string" && key !== ""))
  );

  // 🔴 보낼 것이 없으면 **아예 부르지 않는다.** 빈 목록은 포털이 400(`no_keys`)으로
  //    거절하므로, 부르는 것은 거절 한 줄을 로그에 쌓는 일뿐이다.
  if (wanted.length === 0) return false;

  // 🔴 묶음을 **차례로** 보낸다(한꺼번에 던지지 않는다). 「보이는 알림 지우기」
  //    한 번에 포털로 여러 연결이 동시에 열리면, 인증 실패를 세는 포털의 DB 에
  //    쓸데없는 봉우리를 만든다.
  let recorded = true;
  for (let at = 0; at < wanted.length; at += DISMISSALS_PER_REQUEST) {
    const chunk = wanted.slice(at, at + DISMISSALS_PER_REQUEST);
    if (!(await recordDismissalChunk(subject, chunk, deps))) recorded = false;
  }

  return recorded;
}

/* ========================================================================== */
/* 「이 알림은 확인했다」를 포털에 적는다 — **쓰는 쪽 둘째** (2026-10-22)       */
/*                                                                            */
/* 🔴 바로 위 지움과 **뜻이 다르다. 한 뭉치로 만들지 마라.** ✕ 지움은 「지금은 */
/*    그만 보겠다」라 재로그인하면 **돌아오고**, 줄을 **누르는 것**은          */
/*    「확인했다」라 **안 돌아온다**. 포털의 표가 그래서 둘이고 돌아오는 칸도  */
/*    둘이다(`dismissed` · `acknowledged` — dss-auth/docs/사이트-알림-통로.md  */
/*    의 「acknowledged」절). 확인을 지움으로 읽으면 안 돌아와야 할 줄이       */
/*    로그아웃 뒤에 돌아오고, 지움을 확인으로 읽으면 영영 사라진다.            */
/*                                                                            */
/* 🔴 **무엇을 없앨지 이 사이트가 판단하지 않는다.** 나가는 것은 열쇠뿐이고,   */
/*    「그때 본 내용」의 지문은 포털이 제 목록에서 직접 계산한다. 종에서        */
/*    빠지는 것은 (기록이 있고 · 지문이 지금 내용과 같고 · 그 종류가 「정보    */
/*    확인용」) 셋이 다 맞을 때뿐이다 — 그래서 **결재 승인·부품 요청처럼       */
/*    동작이 필요한 줄은 확인을 적어도 종에 그대로 남는다**(2026-10-22 요구).  */
/*    🔴 같은 판정을 여기 베껴 적지 마라: 한 사이트만 어긋나도 그 시스템에서만 */
/*    확인이 영영 안 먹히고 오류는 한 줄도 안 난다(규격서).                    */
/*                                                                            */
/* 🔴 여기로 나가는 것은 **남의 시스템 줄뿐이다.** A/S 자신의 알림 확인은      */
/*    예전 그대로 A/S 의 표(notification_acknowledgements)에 적힌다 —          */
/*    server/actions/notification-acknowledgements.ts 의                       */
/*    acknowledgeNotificationAction. 둘을 가르는 자리는 종 한 곳이다           */
/*    (components/layout/NotificationBell.tsx 의 handlePortalRowPicked).       */
/*                                                                            */
/* 🔴 **읽는 쪽·지움 쪽과 같은 자격증명 · 같은 상한 · 같은 거절이다.** 그래서  */
/*    같은 파일에 나란히 둔다 — 셋이 어긋나면 「알림은 오는데 확인만 안        */
/*    먹히는」 상태가 되고, 그 어긋남은 신고로만 드러난다.                     */
/* ========================================================================== */

/**
 * 「이 알림은 확인했다」를 포털에 적는다. 🔴 **어떤 일이 있어도 던지지 않는다**
 * — 묻는 쪽·지움 쪽과 같은 약속이다. 못 적으면 그 줄이 종에 남을 뿐이고, 그것이
 * 화면이 깨지는 것보다 훨씬 낫다.
 *
 * @param subject 포털의 `users.id`(= ID 토큰의 `sub`). A/S 는 `users.sso_subject`
 *                로 들고 있다. 🔴 **서버가 제 세션에서 읽은 값**이어야 한다 —
 *                브라우저가 보낸 값을 그대로 넘기면 남의 알림을 확인 처리하는
 *                통로가 된다(지움 쪽과 같은 규약).
 * @param acknowledgementKey `{client_id}:{id}` 모양 **하나**. 모양이 틀리거나
 *                모르는 시스템의 것은 포털이 조용히 버린다(`dropped`·`skipped`).
 *
 * 🔴 지움과 달리 **열쇠를 하나만 받는다.** 확인은 줄을 하나 누르는 일이라 열쇠가
 *    언제나 하나다 — 「확인 전부」 같은 단추가 생기는 날 나눠 보내는 고리를
 *    그때 더한다(포털의 상한은 지움과 **같은 값**이라 그대로 쓸 수 있다).
 *    미리 두면 아무도 안 도는 고리가 된다.
 *
 * @returns 적혔는가. 🔵 몇 번을 다시 보내도 안전하다 — 같은 열쇠를 두 번 확인하는
 *          것은 한 번 확인하는 것과 같다. 그래서 실패를 되돌리는 장치가 없다.
 */
export async function acknowledgePortalNotification(
  subject: string,
  acknowledgementKey: string,
  deps: PortalInboxDeps = {}
): Promise<boolean> {
  // 🔴 포털 계정에 이어지지 않은 로컬 계정은 적을 곳이 없다(묻는 쪽·지움 쪽과
  //    같은 갈래).
  if (!subject) return false;
  // 빈 열쇠는 포털이 400(`no_keys`)으로 거절한다 — 아예 보내지 않는다.
  if (!acknowledgementKey) return false;

  const send = deps.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    // 🔴 자격증명을 읽는 자리가 **try 안**인 것은 묻는 쪽·지움 쪽과 같은 까닭이다
    //    — config 의 getter 는 값이 없으면 던지고, 설정이 빠진 것 때문에 줄 한 번
    //    누르기가 화면을 깨면 안 된다.
    const { issuer, clientId, clientSecret } = (deps.readCredentials ?? readCredentialsFromEnv)();
    // 규격서: base64(urlencode(client_id) + ":" + urlencode(client_secret)).
    const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;

    response = await send(`${issuer}/api/integration/notification-acknowledgements`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      // 🔴 칸 이름은 하나여도 `keys` 다 — 지움 통로와 **같은 몸통 모양**이고
      //    포털도 같은 파서를 쓴다(규격서).
      body: new URLSearchParams({ sub: subject, keys: acknowledgementKey }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(NOTIFICATIONS_TIMEOUT_MS),
    });
  } catch (error) {
    // 🔴 남기는 것은 오류의 **종류**뿐이다. 열쇠에는 수리 건 번호 같은 업무
    //    식별자가 들어 있어서 그것도 찍지 않는다(묻는 쪽·지움 쪽과 같은 규약).
    console.error(
      "[sso] 알림 확인을 적지 못했습니다:",
      error instanceof Error ? error.name : "unknown"
    );
    return false;
  }

  if (!response?.ok) {
    // 거절 본문은 포털의 내부 설정을 설명할 수 있다. 상태만 남긴다.
    console.error("[sso] 알림 확인 통로 거절:", response?.status);
    return false;
  }

  return true;
}
