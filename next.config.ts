import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DEVELOPMENT ONLY — allows the current LAN dev machine's address to
  // reach Next.js's own dev resources (HMR/webpack-hmr, RSC dev assets).
  // Unrelated to src/lib/auth/request-guards.ts's isTrustedOrigin (a
  // separate, custom Route Handler CSRF guard) and unrelated to
  // serverActions.allowedOrigins (this login endpoint is a Route Handler,
  // not a Server Action). Has no effect in production builds.
  //
  // 192.168.35.215 added (regression fix): the dev machine's Wi-Fi LAN IP
  // changed since 192.168.1.132 was set (confirmed via `Get-NetIPAddress`
  // — 192.168.1.132 is no longer bound to any interface on this machine).
  // With only the stale IP allow-listed, Next.js was silently blocking the
  // HMR WebSocket (/_next/webpack-hmr) for the browser's actual origin —
  // "Blocked cross-origin request to Next.js dev resource" in the dev
  // server log — so live-reload never reached the browser during this
  // session's edits, leaving it on an increasingly stale client bundle.
  // That stale-vs-current-server mismatch is what produced this
  // checkpoint's regression symptoms (unresponsive 휴지통 tab, blank
  // dashboard content on the next client-side navigation) — not a defect
  // in DiagnosisFlowchartManagementScreen.tsx itself, which SSRs and
  // builds cleanly on a fresh server process. Keeping the old IP too
  // (harmless) in case that network is reconnected later.
  //
  // 192.168.0.12 added (같은 사유의 재발): `Get-NetIPAddress` 확인 결과 이
  // PC의 현재 LAN IPv4는 192.168.0.12 하나뿐이고, 위 두 주소는 어느
  // 인터페이스에도 바인딩되어 있지 않다(172.23.224.1은 Hyper-V/WSL 가상
  // 어댑터라 폰에서 닿지 않는다). 즉 목록에 살아 있는 주소가 하나도 없는
  // 상태였고, 그대로 두면 폰에서 접속할 때 위에 적힌 stale-bundle 증상이
  // 그대로 재현된다 — 모바일 레이아웃/PWA 검증 자체가 불가능해진다.
  // 앞의 두 주소는 위 주석의 판단대로 그대로 남겨 둔다.
  //
  // 10.150.71.135 added: PC가 폰 핫스팟("... S25")에 접속하면서 IP 대역 자체가
  // 사설 192.168.x가 아닌 10.150.71.x로 바뀌었다. 이 목록에 살아 있는 주소가
  // 없으면 위에 기록된 stale-bundle 사고가 그대로 재발한다.
  //
  // 이 목록이 오늘 하루에만 세 번 늘어난 데서 보이듯, 접속 네트워크가 바뀔
  // 때마다 여기를 고쳐야 한다. 근본 해결은 공유기 DHCP 예약(고정 IP)이며,
  // 핫스팟처럼 고정할 수 없는 환경이라면 접속 전에 `Get-NetIPAddress`로
  // 현재 IP를 확인하고 이 배열과 폰 쪽 설정을 함께 갱신해야 한다.
  allowedDevOrigins: ["192.168.1.132", "192.168.35.215", "192.168.0.12", "10.150.71.135"],
  experimental: {
    // The application still rejects workbook bytes above 20 MiB. This
    // slightly larger transport ceiling leaves room for multipart metadata.
    serverActions: { bodySizeLimit: "21mb" },
  },
};

export default nextConfig;
