import type { Metadata } from "next";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
