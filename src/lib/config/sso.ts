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
