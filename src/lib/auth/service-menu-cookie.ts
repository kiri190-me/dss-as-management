import { cookies } from "next/headers";
import { normalizeServiceMenu, type ServiceMenuEntry } from "@dss/ui";
import { SESSION_MAX_AGE_SECONDS } from "./session";
import { signPayload, verifyToken } from "./token";

/**
 * 서비스 메뉴바가 그릴 목록을 나르는 **별도 서명 쿠키**.
 *
 * ── 왜 세션 쿠키에 넣지 않나 ─────────────────────────────────────────────
 * 세션 쿠키(dss_session)에 담긴 값은 인가 판정에 쓰이는 보안 자료다
 * (session.ts 의 SessionPayload — userId · role · approvalStatus). 메뉴
 * 목록은 **그리는 데만 쓰는 값**이라 성격이 다르고, 길이도 서비스 수에 따라
 * 늘어난다. 섞어 두면 「세션에 무엇이 들었나」를 읽는 사람이 매번 둘을 갈라
 * 봐야 하고, 촘촘히 붙은 세션 시험이 화면 장식 때문에 흔들린다.
 *
 * ── 왜 서명하나 ──────────────────────────────────────────────────────────
 * 안 하면 사용자가 자기 브라우저에서 값을 바꿔 가짜 링크를 띄울 수 있다.
 * 자기만 속는 일이지만(이 값으로 열리는 권한이 없다) 막는 값이 두 줄이라
 * 막는 편이 낫다. 서명 방식 · 비밀값 · 수명은 세션 쿠키와 **같은 것**을
 * 쓴다 — token.ts 의 HMAC, AUTH_SESSION_SECRET, SESSION_MAX_AGE_SECONDS.
 *
 * ── 권한을 판정하지 않는다 ───────────────────────────────────────────────
 * 이 목록은 포털(dss-auth)이 ID 토큰의 `dss_services` 클레임으로 알려 준
 * 「이 사람이 들어갈 수 있는 시스템」이다. 이 시스템은 그것을 **그대로**
 * 나를 뿐, 무엇을 더하거나 빼지 않는다(@dss/ui 의 normalizeServiceMenu 도
 * 그릴 수 없는 칸만 버린다). 판정이 두 벌이 되면 포털 타일과 메뉴바가 서로
 * 다른 말을 하게 된다.
 */
export const SERVICE_MENU_COOKIE_NAME = "dss_service_menu";

type ServiceMenuPayload = {
  services: ServiceMenuEntry[];
  issuedAt: number;
  expiresAt: number;
};

/** session.ts 와 같은 비밀값 · 같은 실패 문구. */
function getAuthSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SESSION_SECRET이 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return secret;
}

/**
 * ID 토큰에서 꺼낸 `dss_services` 클레임을 쿠키에 담을 토큰으로 만든다.
 *
 * 🔴 **그릴 것이 없으면 null 이다 — 쿠키를 굽지 않는다.** 포털의 그 기능은
 * 아직 배포되지 않았으므로 지금 로그인하면 클레임이 아예 없을 수 있고,
 * 그때 로그인은 예전과 똑같이 되어야 한다(띠도, 빈 띠도 그리지 않는다).
 * 클레임이 없는 것과 값이 이상한 것을 구분하지 않는 이유도 같다 — 어느
 * 쪽이든 그릴 수 있는 칸이 없으면 띠는 없는 것이 맞다.
 */
export function createServiceMenuToken(claim: unknown): string | null {
  const services = normalizeServiceMenu(claim);
  if (services.length === 0) {
    return null;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: ServiceMenuPayload = {
    services,
    issuedAt,
    expiresAt: issuedAt + SESSION_MAX_AGE_SECONDS,
  };
  return signPayload(payload, getAuthSecret());
}

/**
 * 위조 · 변조 · 만료된 토큰은 모두 **빈 목록**이다(예외를 던지지 않는다).
 *
 * 메뉴바는 곁다리인데 여기서 터지면 본문까지 못 보게 된다. 서명이 맞아도
 * 안에 든 값은 다시 거른다 — 옛 토큰이나 포털이 먼저 바뀐 경우가 있다.
 */
export function parseServiceMenuToken(token: string): ServiceMenuEntry[] {
  let decoded: unknown;
  try {
    decoded = verifyToken(token, getAuthSecret());
  } catch {
    return [];
  }
  if (typeof decoded !== "object" || decoded === null) {
    return [];
  }

  const candidate = decoded as Record<string, unknown>;
  if (typeof candidate.expiresAt !== "number") {
    return [];
  }
  if (candidate.expiresAt <= Math.floor(Date.now() / 1000)) {
    return [];
  }

  return normalizeServiceMenu(candidate.services);
}

/** 쿠키가 없거나 못 믿을 것이면 빈 목록 — 그때 띠는 그려지지 않는다. */
export async function readServiceMenu(): Promise<ServiceMenuEntry[]> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SERVICE_MENU_COOKIE_NAME)?.value;
  if (!token) {
    return [];
  }
  return parseServiceMenuToken(token);
}
