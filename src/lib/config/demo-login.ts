import "server-only";
import { getLoginMode } from "./login-mode";

/**
 * 데모 로그인(계정을 라디오 버튼으로 골라 들어가는 길)이 실제로 열려 있는가.
 *
 * `DEMO_LOGIN_ENABLED === "true"` 를 그대로 쓰지 않고 한 겹 덮는 이유:
 *
 * 통합 로그인을 켠 뒤에도 그 값이 `.env.local`에 true로 남아 있었다. 지금은
 * 로그인 라우트가 SSO 모드에서 먼저 403을 돌려주므로 실제로 뚫리지는
 * 않지만, 그 방어는 **그 라우트 하나에만** 있다. 나중에 누군가 이 값을 읽는
 * 세 번째 자리를 만들면 그 자리에는 방어가 없다.
 *
 * 값을 읽는 지점을 하나로 모으고 여기서 판정을 끝내면, 앞으로 어디서 읽든
 * 같은 답이 나온다. 설정 파일을 고치는 것을 잊어도 코드가 이미 닫혀 있다.
 *
 * 두 값이 모순일 때 SSO를 이기게 두지 않는다: 통합 로그인을 켰다는 것은
 * "이 시스템은 포털을 거쳐야만 들어온다"는 선언이고, 데모 스위치는 그보다
 * 약한 편의 설정이다.
 */
export function isDemoLoginEnabled(): boolean {
  return resolveDemoLoginEnabled(process.env.DEMO_LOGIN_ENABLED, getLoginMode());
}

/**
 * 판정만 따로 둔다 — 환경변수를 건드리지 않고 규칙을 테스트할 수 있도록.
 * (이 저장소의 test는 --conditions=react-server 로 돌아 server-only 모듈도
 * 부를 수 있지만, 순수 함수 쪽이 테스트에서 다루기 쉽다.)
 */
export function resolveDemoLoginEnabled(
  flag: string | undefined,
  loginMode: ReturnType<typeof getLoginMode>
): boolean {
  if (loginMode === "sso") return false;
  // 정확히 "true"만 인정한다. "1"이나 "yes"를 받아 주면 오타 하나로 열린다.
  return flag === "true";
}
