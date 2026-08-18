import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "./globals.css";

/**
 * Read once at module load (server-only) rather than duplicating the logic
 * inline here — public/theme-init.js stays the single source of truth for
 * the pre-hydration theme script, ThemeToggle.tsx's own client-side logic
 * mirrors the same localStorage key/values.
 *
 * Rendered as a literal inline <script> in <head> (dangerouslySetInnerHTML)
 * instead of next/script's beforeInteractive strategy: on Next.js 16 +
 * React 19, beforeInteractive's internal head-injection mechanism collides
 * with React's own automatic <script>/<style> hoisting during hydration,
 * producing a spurious "Encountered a script tag while rendering React
 * component" console warning. An inline <head> script still runs
 * synchronously during HTML parsing (before hydration, before paint —
 * the same guarantee beforeInteractive existed to provide, needed here to
 * avoid a flash of the wrong theme), without going through next/script at
 * all, sidestepping the incompatibility entirely. No CSP/nonce is
 * configured in this project, so an inline script is safe to use.
 */
const themeInitScript = readFileSync(
  join(process.cwd(), "public", "theme-init.js"),
  "utf8"
);

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DSS A/S 관리 시스템 (데모)",
  description: "DSS A/S 관리 시스템 Phase 1 데모 프로젝트",
  // 홈 화면 설치용(app/manifest.ts가 생성하는 경로). 안드로이드/데스크톱
  // Chrome은 이 manifest의 display 값을 보고 주소창 없는 창으로 띄운다.
  manifest: "/manifest.webmanifest",
  // iOS Safari는 manifest의 display를 보지 않는다 — 아래 apple-mobile-web-
  // app-capable 메타 태그만 본다. 두 경로를 같이 유지해야 플랫폼별로 동작이
  // 갈리지 않는다(app/manifest.ts 주석 참조). statusBarStyle은 기본값
  // "default"를 명시해 둔 것으로, black-translucent와 달리 상태 표시줄이
  // 콘텐츠 위를 덮지 않아 별도 상단 보정이 필요 없다.
  appleWebApp: {
    capable: true,
    title: "DSS A/S",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

/**
 * `viewportFit: "cover"`가 이 프로젝트의 모바일 하단 여백 보정 전체의
 * 전제 조건이다. 이 값이 없으면(브라우저 기본값 `auto`) 뷰포트가 애초에
 * 안전 영역 안쪽으로만 잡히고, 그 결과 CSS의 `env(safe-area-inset-*)`가
 * 어디서든 항상 0으로 계산된다 — AppShell/로그인 화면에 넣은 하단 인셋
 * 패딩이 조용히 무효가 된다는 뜻이다. `cover`로 화면 전체를 쓰게 한 다음,
 * 홈 인디케이터/노치에 겹치면 안 되는 요소에만 인셋을 되돌려 준다.
 *
 * themeColor는 홈 화면에 설치했을 때(standalone) 상태 표시줄 색이다.
 * prefers-color-scheme 기준이라 앱의 수동 라이트/다크 토글(localStorage
 * 기반, public/theme-init.js)과는 별개로 OS 설정을 따른다 — 시스템 설정과
 * 반대로 수동 전환한 경우에만 상태 표시줄 색이 본문과 어긋나는데, 색상값
 * 자체가 본문 배경(--background)과 같은 값이라 어긋나도 이질감이 없다.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/*
        Sidebar-footer layout fix — this was `min-h-full`, which lets body
        grow TALLER than the viewport to fit long page content (e.g. the
        A/S 접수 form). Once body inflates, every flex descendant down to
        AppShell's own row (sidebar + main) inflates with it via normal
        flex stretch sizing, dragging the sidebar's footer below the fold
        along with everything else. Capping body at exactly the viewport
        height — combined with `min-h-0` on the flex containers between
        here and <main>/<nav> (see AppShell.tsx/Sidebar.tsx) — is what lets
        `<main>`'s and the sidebar nav's own `overflow-y-auto` finally
        engage as REAL internal scroll instead of the whole page growing.
        Standalone pages outside AppShell (e.g. /login) are unaffected:
        without an inner `overflow-hidden`, taller-than-viewport content
        there still scrolls the document normally exactly as before.

        그 "캡"을 거는 높이 선언 자체는 이제 여기 Tailwind `h-full`이 아니라
        globals.css의 `html, body { height: 100%; height: 100dvh; }`에 있다
        — 모바일 브라우저 하단 툴바까지 반영하는 dvh로 바꾸면서 폴백 선언이
        필요해졌기 때문이다(이유는 해당 규칙의 주석 참조). 여기서 `h-full`을
        다시 붙이면 안 된다: Tailwind v4의 유틸리티는 레이어 안에 있고
        globals.css의 그 규칙은 레이어 밖이라, 레이어 밖 선언이 이기긴 하지만
        높이 기준이 두 곳에 흩어지는 것 자체가 혼란스럽다.
      */}
      <body className="flex flex-col">{children}</body>
    </html>
  );
}
