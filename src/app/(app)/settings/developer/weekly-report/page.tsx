import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import WeeklyReportScreen from "@/components/dashboard/WeeklyReportScreen";
import ThemeTokenEditor from "@/components/settings/ThemeTokenEditor";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { buildUiThemeView } from "@/lib/db/queries/ui-theme-tokens";
import { buildWeeklyReportPreviewSample } from "@/lib/domain/weekly-report-preview-sample";

export const metadata: Metadata = {
  title: "주간보고 | 개발자 모드 | DSS A/S 관리 시스템",
};

// 개발자 표시는 살아 있는 계정 행에서 매 요청 읽는다(acting-user.ts). 캐시된
// 페이지를 내보내면 표시를 끈 뒤에도 이 화면이 남는다.
export const dynamic = "force-dynamic";

/**
 * ============================================================================
 * 개발자 모드 · 주간보고 — 글자 크기 8 · 상자 크기 7
 * ============================================================================
 * 색·모서리 화면과 **같은 편집기**(ThemeTokenEditor, group="weeklyReport")다. 저장
 * 경로도 같다 — ui_theme_tokens 에 들어가 루트 레이아웃이 :root 에 심는다.
 *
 * ── 미리보기는 실제 주간보고 컴포넌트 + 표본(가짜) 자료 ──────────────────
 * 여기서 WeeklyReportScreen 을 그려 편집기에 넘기고, 편집기가 그것을 inert 래퍼로
 * 감싸 편집 중인 크기를 CSS 변수로 건다(편집기 머리말). 자료는
 * domain/weekly-report-preview-sample.ts 의 **지어낸 값**이다 — 실제 접수 건을 읽지
 * 않는다. 읽으면 이 화면이 주간보고 권한 없이 고객사 자료를 보여 주는 두 번째 문이
 * 된다.
 *
 * 🔴 권한 값은 전부 끈다(비고 수정 · 목표 적기 · 수리 건 고르개 목록). 미리보기는
 * 크기를 보는 자리라 입력칸·단추가 나오면 실제 모양과 달라지고, 표본 id 로 저장이
 * 나가는 길도 막아 둔다(래퍼가 inert 라 애초에 눌리지 않지만 두 겹으로 둔다).
 *
 * ── 흰 카드로 감싸지 않는다 ─────────────────────────────────────────────
 * 다른 하위 화면은 편집기를 안쪽 여백이 있는 카드에 넣지만, 여기서 그러면
 * 미리보기가 실제 주간보고보다 좁아져 좌우 두 칸이 갈리는 폭이 달라진다. 카드가
 * 필요한 안내·조절 칸은 편집기가 스스로 그린다(WeeklyReportEditorLayout 주석).
 *
 * 🔴 관문을 레이아웃과 **따로** 한 번 더 건다 — 상위 layout.tsx 머리말과 같은
 * 이유다.
 * ============================================================================
 */
export default async function DeveloperWeeklyReportPage() {
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

  const sample = buildWeeklyReportPreviewSample();

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

      {isDatabaseMode ? (
        <ThemeTokenEditor
          saved={savedThemeTokens}
          group="weeklyReport"
          preview={
            <WeeklyReportScreen
              report={sample.report}
              asOfDate={sample.asOfDate}
              canEditNotes={false}
              goals={{
                weekStart: sample.weekStart,
                currentWeekStart: sample.weekStart,
                rows: sample.goals,
                canEdit: false,
                repairCaseOptions: [],
              }}
              deliveries={sample.deliveries}
            />
          }
        />
      ) : (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            화면 토큰 편집은 데이터베이스 저장 모드에서만 사용할 수 있습니다.
          </p>
        </section>
      )}
    </>
  );
}
