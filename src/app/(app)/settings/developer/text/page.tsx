import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import UiTextEditor from "@/components/settings/UiTextEditor";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { buildUiTextView } from "@/lib/db/queries/ui-text-overrides";

export const metadata: Metadata = {
  title: "화면 문구 | 개발자 모드 | DSS A/S 관리 시스템",
};

// 개발자 표시는 살아 있는 계정 행에서 매 요청 읽는다(acting-user.ts). 캐시된
// 페이지를 내보내면 표시를 끈 뒤에도 이 화면이 남는다.
export const dynamic = "force-dynamic";

/**
 * ============================================================================
 * 개발자 모드 · 화면 문구
 * ============================================================================
 * 색 화면들과 같은 모양이다 — 구조선 래퍼와 우회 배너는 상위 layout.tsx 에 있고,
 * 여기서는 관문을 한 번 더 걸고 편집기에 저장된 행을 넘긴다.
 *
 * 🔴 관문을 레이아웃과 **따로** 한 번 더 건다. 이 저장소는 화면·서버 액션·
 * mutation 이 각자 독립적으로 다시 검사하는 것을 관례로 삼고, 껍데기 한 겹만
 * 믿으면 주소를 직접 치는 길이 한 겹 얇아진다.
 *
 * 🔴 색과 달리 이 화면에는 구조선이 필요 없다. 문구를 아무리 이상하게 바꿔도 이
 * 화면 자체는 읽히기 때문이다 — 이 편집기가 그리는 이름표는 저장된 문구가 아니라
 * 등록부의 기본 문구와 사람이 편집 중인 값이고, 화면의 뼈대(제목·단추·안내)는
 * 편집 대상에 아예 들어 있지 않다.
 * ============================================================================
 */
export default async function DeveloperUiTextPage() {
  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");
  if (!mayEnterDeveloperMode(actingUser)) redirect("/no-access");

  // 데모(로컬) 모드에는 이 표가 없을 수 있다. 저장 경로도 같은 이유로 거절하므로
  // (server/actions/ui-text-overrides.ts), 편집기를 그려 놓고 누르면 거절당하는
  // 화면이 되지 않게 여기서 갈라 둔다.
  const isDatabaseMode = getAuthSource() === "database";
  const savedUiText = isDatabaseMode ? await buildUiTextView() : [];

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
          <UiTextEditor saved={savedUiText} />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            화면 문구 편집은 데이터베이스 저장 모드에서만 사용할 수 있습니다.
          </p>
        )}
      </section>
    </>
  );
}
