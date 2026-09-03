import type { NextConfig } from "next";
import { detectLanAddresses } from "./src/lib/config/lan-address";

/**
 * 모든 응답에 붙는 보안 헤더. dss-auth의 같은 목록과 맞춰 둔다 — 두 시스템이
 * 한 브라우저 안에서 오가므로 한쪽만 잠그면 의미가 반으로 준다.
 *
 * 리버스 프록시가 아니라 여기 두는 이유: 프록시 설정은 저장소 밖에 있어
 * 배포마다 다시 맞춰야 하고, 개발 서버에는 아예 없어서 개발 중에 확인할 수
 * 없다. 프록시에서 한 번 더 붙어도 해롭지 않다.
 *
 * CSP는 frame-ancestors 하나만 둔다. 전체 CSP는 Next의 인라인 스크립트·
 * 스타일과 부딪혀 화면이 조용히 깨지기 쉬운데, 검증 없이 넣는 것은
 * 안전장치가 아니라 시한폭탄이다.
 */
const SECURITY_HEADERS = [
  // 이 시스템의 화면이 남의 페이지 안에 실려 클릭을 가로채이는 것을 막는다.
  // 결재·출하 승인처럼 되돌리기 어려운 버튼이 있는 화면이 특히 그렇다.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 통합 로그인으로 나갈 때 우리 주소를 넘기지 않는다.
  { key: "Referrer-Policy", value: "same-origin" },
  // ⚠️ camera=(self) — 닫으면 안 된다. InAppCamera.tsx가 getUserMedia로 이
  // 화면 안에서 직접 촬영한다(수리 사진). ()로 두면 촬영이 통째로 막히고,
  // 증상은 "카메라가 안 켜진다"뿐이라 헤더를 의심하기까지 오래 걸린다.
  // 마이크와 위치는 쓰지 않으므로 닫아 둔다 — 쓰게 되면 여기서 막히고,
  // 그때 왜 열어야 하는지 한 번 생각하게 된다.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=()",
  },
  // http 응답에서는 브라우저가 무시하므로 지금 붙여도 해롭지 않고, HTTPS로
  // 옮기는 날 따로 기억해 낼 필요가 없어진다. preload는 넣지 않는다 —
  // 사내망 도메인을 브라우저 내장 목록에 올리면 되돌리는 데 몇 달이 걸린다.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  /**
   * 배포용 빌드가 `.next/standalone` 아래에 자립 실행 가능한 형태로 나온다.
   * 실제로 쓰이는 파일만 추려 담고 `server.js`를 함께 만들어 주므로,
   * 컨테이너에 `node_modules` 전체를 실을 필요가 없다 — 이미지가 몇 배 작아진다.
   *
   * **`next dev`에는 아무 영향이 없다.** `next build`만 이 값을 본다.
   *
   * ⚠️ standalone은 `public`과 `.next/static`을 자동으로 담지 않는다.
   *    Dockerfile에서 손으로 복사해야 하고, 빠뜨리면 화면은 뜨는데 이미지와
   *    CSS가 전부 깨져 보인다. 이 저장소는 특히 `src/app/layout.tsx`가 런타임에
   *    `public/theme-init.js`를 읽으므로 public이 없으면 첫 화면부터 죽는다.
   *
   * 나머지 세 저장소(dss-auth·njlee·dss-home)에는 이미 들어가 있다.
   * 자세한 것은 ../dss-deploy/runbook/02-이미지-빌드.md
   */
  output: "standalone",

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },

  // DEVELOPMENT ONLY — allows the current LAN dev machine's address to
  // reach Next.js's own dev resources (HMR/webpack-hmr, RSC dev assets).
  // Unrelated to src/lib/auth/request-guards.ts's isTrustedOrigin (a
  // separate, custom Route Handler CSRF guard) and unrelated to
  // serverActions.allowedOrigins (this login endpoint is a Route Handler,
  // not a Server Action). Has no effect in production builds.
  //
  // 왜 비워두면 안 되는가 (실측 기록): 목록에 살아 있는 주소가 하나도 없으면
  // Next가 브라우저의 실제 출처에 대해 HMR 웹소켓(/_next/webpack-hmr)을 조용히
  // 막는다 — 개발 서버 로그에 "Blocked cross-origin request to Next.js dev
  // resource"만 남고 화면은 아무 말이 없다. 그대로 편집을 이어가면 브라우저가
  // 점점 낡은 번들에 머물고, 그 불일치가 "휴지통 탭이 안 눌린다", "대시보드가
  // 빈 화면으로 뜬다" 같은 엉뚱한 증상으로 나타난다. 원인이 증상과 전혀 무관한
  // 곳에 있어 찾는 데 가장 오래 걸린 종류의 사고였다.
  //
  // 예전에는 여기에 IP를 손으로 적었다. 하루에만 세 번 늘었고(192.168.1.132 →
  // 192.168.35.215 → 192.168.0.12 → 폰 핫스팟 10.150.71.135), 갱신을 잊을
  // 때마다 위 사고가 그대로 재발했다. 이제 이 기계가 실제로 가진 주소를 실행
  // 시점에 읽는다 — 망을 옮겨도 목록이 저절로 맞고, 손댈 곳이 없다.
  allowedDevOrigins: detectLanAddresses(),
  experimental: {
    // The application still rejects workbook bytes above 20 MiB. This
    // slightly larger transport ceiling leaves room for multipart metadata.
    serverActions: { bodySizeLimit: "21mb" },
  },
};

export default nextConfig;
