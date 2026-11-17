import "server-only";
import {
  isAutoValue,
  primaryLanAddress,
  resolveAutoUrl,
} from "@/lib/config/lan-address";

/**
 * Server-only settings for talking to the DSS login portal (dss-auth).
 *
 * Read through functions rather than module-level constants so `next build`
 * succeeds without them present — they are only required once a request
 * actually takes the SSO path (LOGIN_MODE=sso). Missing values throw
 * clearly rather than falling back to a default: a login server that half
 * works is worse than one that refuses to start the flow.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set. Define it in .env.local (see .env.example) before using LOGIN_MODE=sso.`
    );
  }
  return value;
}

/** dss-auth's port. */
const PORTAL_PORT = 3100;
/** This app's own port (`next dev` default; `start` keeps it unless PORT says otherwise). */
const OWN_PORT = Number(process.env.PORT ?? 3000);

/** Registered with the portal as the tail of this app's redirect_uri. */
const CALLBACK_PATH = "/api/auth/sso/callback";

/**
 * dss-auth's issuer URL. Must match the `iss` claim of every ID token it
 * signs, character for character — a trailing slash here and none there is
 * a mismatch, and one of the harder failures to diagnose. Stripped for that
 * reason.
 *
 * `auto` (or `auto:3100`) resolves to this machine's own LAN address at
 * runtime, because in development the portal runs on this same machine.
 */
export function getSsoIssuer(): string {
  const raw = required("SSO_ISSUER");
  const resolved = isAutoValue(raw)
    ? resolveAutoUrl(raw, PORTAL_PORT, primaryLanAddress())
    : raw;
  return resolved.replace(/\/+$/, "");
}

export function getSsoClientId(): string {
  return required("SSO_CLIENT_ID");
}

/**
 * 🔴 같은 값을 **던지지 않고** 읽는다 — 못 읽으면 빈 문자열이다.
 *
 * 쓰는 곳은 알림 종의 **열쇠 접두사**다((app)/layout.tsx →
 * domain/notification-bell-items.ts 의 notificationBellKey). 위 getter 를 그
 * 자리에서 그냥 부르면 설정이 빠진 서버(데모 모드 · LOGIN_MODE≠sso)에서 종이,
 * 곧 **이 앱의 모든 화면에 딸려 오는 머리말**이 통째로 깨진다.
 *
 * 🔴 **물러서는 모습은 「접두사 없음」이지 「알림 없음」이 아니다.** 빈 문자열이면
 * 열쇠가 2026-10-19 이전 모양(`{id}`)이 되고, 그때 잃는 것은 **제 줄 지움이
 * 포털과 안 통하는 것** 하나뿐이다 — 종은 예전과 똑같이 그려진다.
 *
 * 🔴 다른 쓰임에는 이 함수를 쓰지 마라. 로그인 왕복(토큰 교환 · 알림 통로
 * 자격증명)에서 값이 비면 **크게 틀리는 편이 낫다** — 그래서 그쪽은 던지는
 * getter 를 그대로 쓴다.
 */
export function getSsoClientIdOrEmpty(): string {
  try {
    return getSsoClientId();
  } catch {
    return "";
  }
}

export function getSsoClientSecret(): string {
  return required("SSO_CLIENT_SECRET");
}

/**
 * Must equal the value registered with dss-auth exactly.
 *
 * Still **not** derived from the incoming request: a live `next dev`
 * diagnostic on this codebase confirmed `request.url` can report the
 * server's own bind address (`http://localhost:3000`) for a request a LAN
 * client genuinely addressed to the machine's LAN IP (see the comment in
 * api/auth/login/route.ts). redirect_uri is compared by exact string match
 * at both the authorize and token steps, so a request-derived value that is
 * right on one network and wrong on another would fail in a way that looks
 * intermittent.
 *
 * `auto` is a different thing and safe here: it reads this machine's own
 * network interfaces, not the request. The value is identical for every
 * caller — a phone, a laptop, or curl all produce the same string — so the
 * intermittency that ruled out request-derivation does not apply.
 *
 * It also does not have to agree with the portal's *first* choice of
 * address. The portal expands its registered `{lan}` entry against **every**
 * address it holds and compares each exactly, so any address this machine
 * actually has will match.
 */
export function getSsoRedirectUri(): string {
  const raw = required("SSO_REDIRECT_URI");
  if (!isAutoValue(raw)) return raw;
  return `${resolveAutoUrl(raw, OWN_PORT, primaryLanAddress())}${CALLBACK_PATH}`;
}

/**
 * 밖에서 이 앱에 닿는 주소(스킴 + 호스트 + 포트). 뒤에 슬래시를 남기지 않는다.
 *
 * ── 왜 새 환경변수를 두지 않는가 ────────────────────────────────────────
 * SSO_REDIRECT_URI 가 이미 **그 주소**다. 포털이 로그인 끝에 브라우저를 되돌려
 * 보내는 곳이므로, 정의상 「밖에서 이 앱에 닿는 주소」와 같아야 한다. 값을 하나
 * 더 두면 둘이 어긋날 수 있고, 어긋난 쪽이 알림 링크라면 증상은 「다른 사이트의
 * 종에서 누르면 엉뚱한 데로 간다」 하나뿐이라 원인을 찾기 어렵다.
 * `auto` 도 저쪽이 이미 풀어 준다.
 *
 * ── 🔴 요청의 Host 머리말에서 얻지 않는다 ───────────────────────────────
 * 그 값은 부르는 쪽이 마음대로 적는다(호스트 머리말 주입). 알림 링크는 **다른
 * 사이트의 화면에 그려져 사람이 누르는** 주소라, 부르는 쪽이 고른 호스트가
 * 거기 실리면 그대로 피싱 링크가 된다. getSsoRedirectUri 가 request.url 을 쓰지
 * 않는 것과 같은 판단이고, 여기서는 이유가 하나 더 무겁다.
 *
 * 끝의 콜백 경로를 떼어 낸다. 떼어 낼 것이 없으면 던진다 — 조용히 넘어가면
 * 알림 링크가 `…/api/auth/sso/callback/repair-cases/…` 가 된다.
 */
export function getAppBaseUrl(): string {
  const redirectUri = getSsoRedirectUri();
  if (!redirectUri.endsWith(CALLBACK_PATH)) {
    throw new Error(
      `SSO_REDIRECT_URI must end with ${CALLBACK_PATH} — it is also read as this app's own address.`
    );
  }
  return redirectUri.slice(0, -CALLBACK_PATH.length).replace(/\/+$/, "");
}

/**
 * Where to send the browser so the portal ends its own session too
 * (`end_session_endpoint` in dss-auth's discovery document).
 *
 * Built from the issuer rather than fetched from discovery, matching how the
 * callback route already builds the JWKS URL. Discovery is the right answer
 * for a team integrating from outside; inside this repo one more network
 * round trip on the logout path buys nothing, and a wrong path here fails
 * loudly and immediately rather than subtly.
 */
export function getSsoEndSessionUrl(): string {
  return `${getSsoIssuer()}/api/oidc/logout`;
}

/**
 * The portal's app launcher — where a person goes to reach the other
 * systems they have access to. Not a protocol endpoint.
 */
export function getSsoPortalUrl(): string {
  return `${getSsoIssuer()}/apps`;
}

/**
 * 통합 승인함(dss-approvals)의 **결재권 위임 화면** 주소. 값이 없으면 `null`.
 *
 * ── 🔴 왜 `SSO_ISSUER` 에서 뽑지 않는가 ─────────────────────────────────
 * 바로 위 `getSsoPortalUrl()` 은 포털(dss-auth) 자신의 한 화면이라 발행자 주소에
 * 경로만 붙이면 된다. 🔴 **승인함은 다른 앱이고 다른 포트다**(개발 3900). 포털
 * 주소에 `/delegations` 를 붙이면 포털에는 없는 경로라 404 가 나고, 그것은
 * 「위임 화면이 비었다」와 구별되지 않는다.
 *
 * ── 🔴 이름이 `APPROVALS_BASE_URL` 로 고정이다 ───────────────────────────
 * A/S·재고관리·휴가 **세 집이 같은 이름**을 쓰기로 했다. 집마다 다르게 적으면
 * 배포할 때 어느 집에 무엇을 넣었는지 아무도 못 센다.
 *
 * ── 🔴 값이 없으면 던지지 않고 `null` 이다 ───────────────────────────────
 * 위 `getSsoClientIdOrEmpty()` 와 같은 판단이다. 이 값을 쓰는 곳은 [결재권 위임]
 * 화면의 **안내 한 줄**뿐이고, 그 화면은 **누구에게나 늘 보인다**. 던지면 설정이
 * 빠진 기계(데모 모드 · 아직 승인함을 안 붙인 서버)에서 화면이 통째로 깨진다 —
 * 링크 하나 때문에 위임 목록 전부를 잃는 것은 값이 맞지 않는다.
 * 🔵 **물러서는 모습은 「링크 없음」이지 「안내 없음」이 아니다.** 화면은 글자로
 * 「통합 승인함에서 거둘 수 있습니다」를 그대로 말한다(ApprovalRouteDelegation
 * Section.tsx) — 어디로 가야 하는지는 알려 주고 누를 곳만 없다.
 *
 * 🔴 주소를 코드에 박지 않는다. 박으면 주소가 바뀌는 날 **오류 없이 엉뚱한 데로**
 * 간다 — 사람은 「승인함이 비었다」로 읽고 원인을 찾을 단서가 없다.
 */
export function getApprovalsDelegationUrlOrNull(): string | null {
  const raw = process.env.APPROVALS_BASE_URL;
  if (raw === undefined || raw.trim() === "") return null;
  // 뒤의 슬래시를 떼어 낸다 — 안 떼면 `…//delegations` 가 되고, 서버에 따라
  // 그대로 404 다. getAppBaseUrl() 이 같은 자리에서 같은 일을 한다.
  return `${raw.trim().replace(/\/+$/, "")}/delegations`;
}
