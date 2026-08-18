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
  allowedDevOrigins: ["192.168.1.132", "192.168.35.215"],
  experimental: {
    // The application still rejects workbook bytes above 20 MiB. This
    // slightly larger transport ceiling leaves room for multipart metadata.
    serverActions: { bodySizeLimit: "21mb" },
  },
};

export default nextConfig;
