import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import ThemeTokenEditor from "@/components/settings/ThemeTokenEditor";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { buildUiThemeView } from "@/lib/db/queries/ui-theme-tokens";

export const metadata: Metadata = {
  title: "모서리 · 글자 크기 | 개발자 모드 | DSS A/S 관리 시스템",
};

// 개발자 표시는 살아 있는 계정 행에서 매 요청 읽는다(acting-user.ts). 캐시된
// 페이지를 내보내면 표시를 끈 뒤에도 이 화면이 남는다.
export const dynamic = "force-dynamic";

/**
 * ============================================================================
 * 개발자 모드 · 화면 토큰 — 모서리 · 글자 크기
 * ============================================================================
 * 색 화면(theme/colors)과 **같은 편집기**를 쓰고, 그리는 칸만 다르다. 대비 표는
 * 여기서 감춘다 — 이 화면에서 바꾸는 값은 대비를 한 칸도 움직이지 않는다. 재는
 * 것을 줄인 것이 아니라 그리지 않을 뿐이고, 저장을 막는 판정은 그대로다
 * (ThemeTokenEditor.tsx 의 같은 자리 주석).
 *
 * 🔴 관문을 레이아웃과 **따로** 한 번 더 건다 — 상위 layout.tsx 머리말과 같은
 * 이유다.
 * ============================================================================
 */
export default async function DeveloperThemeShapesPage() {
  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");
  if (!mayEnterDeveloperMode(actingUser)) redirect("/no-access");

  // 데모(로컬) 모드에는 이 표가 없을 수 있다. 저장 경로도 같은 이유로 거절하므로
  // (server/actions/ui-theme-tokens.ts), 편집기를 그려 놓고 누르면 거절당하는
  // 화면이 되지 않게 여기서 갈라 둔다.
  const isDatabaseMode = getAuthSource() === "database";
  const savedThemeTokens = isDatabaseMode ? await buildUiThemeView() : [];

  return (
    <>
      {/*
        사이드바에는 「개발자 모드」 하나뿐이라 목차로 돌아가는 길이 여기 없으면
        뒤로가기 말고는 돌아갈 방법이 없다.
      */}
      <div>
        <Link
          href="/settings/developer"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← 개발자 모드 목차
        </Link>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {isDatabaseMode ? (
          <ThemeTokenEditor saved={savedThemeTokens} group="shapes" />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            화면 토큰 편집은 데이터베이스 저장 모드에서만 사용할 수 있습니다.
          </p>
        )}
      </section>
    </>
  );
}
