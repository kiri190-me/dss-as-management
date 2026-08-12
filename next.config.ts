import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DEVELOPMENT ONLY — allows the current LAN dev machine's address to
  // reach Next.js's own dev resources (HMR/webpack-hmr, RSC dev assets).
  // Unrelated to src/lib/auth/request-guards.ts's isTrustedOrigin (a
  // separate, custom Route Handler CSRF guard) and unrelated to
  // serverActions.allowedOrigins (this login endpoint is a Route Handler,
  // not a Server Action). Has no effect in production builds.
  allowedDevOrigins: ["192.168.1.132"],
};

export default nextConfig;
