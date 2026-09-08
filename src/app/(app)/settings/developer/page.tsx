import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ThemeTokenEditor from "@/components/settings/ThemeTokenEditor";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { buildUiThemeView } from "@/lib/db/queries/ui-theme-tokens";
import {
  isUiThemeBypassed,
  serializeUiThemeLifeboatCss,
  UI_THEME_BYPASS_COOKIE,
  UI_THEME_LIFEBOAT_ID,
} from "@/lib/domain/ui-theme-tokens";

export const metadata: Metadata = {
  title: "개발자 모드 | DSS A/S 관리 시스템",
};

// 개발자 표시는 살아 있는 계정 행에서 매 요청 읽는다(acting-user.ts). 캐시된
// 페이지를 내보내면 표시를 끈 뒤에도 이 화면이 남는다.
export const dynamic = "force-dynamic";

/**
 * 🔴 구조선(lifeboat) CSS. 등록부의 기본값만으로 만들어지므로 상수 한 번이면
 * 되고, 요청마다 다시 찍을 이유가 없다(도메인 함수가 결정적이다).
 */
const UI_THEME_LIFEBOAT_CSS = serializeUiThemeLifeboatCss();

/**
 * ============================================================================
 * 개발자 모드
 * ============================================================================
 * 🔴 **이 화면은 역할별 접근 권한 설정으로 열 수 없다.** 다른 메뉴 페이지들이
 * `requireAreaAccessForCurrentUser("...")` 를 부르는 그 자리에서, 이 페이지는
 * `mayEnterDeveloperMode` 를 쓴다 — 개발자 모드가 PERMISSION_AREAS 에 없으므로
 * 영역 가드가 답할 수 있는 질문이 아니다(auth/developer-mode-gate.ts).
 *
 * 막힐 때의 처리는 다른 페이지와 **같은 방식**이다: /no-access 로 보낸다.
 * 조용히 대시보드로 튕기면 사용자는 고장으로 여기고, 관리자는 무엇을 풀어
 * 줘야 하는지 알 수 없다(area-guard.ts 의 같은 판단). 다만 `?area=` 는 붙이지
 * 않는다 — 그 값은 findPermissionArea 로 이름표를 찾는 데 쓰이고,
 * 개발자 모드는 그 목록에 없어서 붙여도 이름이 나오지 않는다. 붙이지 않으면
 * /no-access 가 「요청하신 화면은…」 문구로 떨어져 그대로 읽힌다.
 *
 * ⚠️ 메뉴에서 감추는 것은 관문이 아니다. 사이드바가 이 항목을 그릴지는
 * (app)/layout.tsx 가 같은 함수로 정하지만, 주소를 직접 쳐서 들어오는 길을
 * 막는 것은 아래 이 검사 하나다.
 *
 * ── 🔴 이 화면만은 항상 기본색이다 (구조선) ────────────────────────────
 * 화면 토큰 편집기가 여기 있으므로, 저장한 값 때문에 화면이 읽히지 않게 됐을 때
 * **되돌리러 오는 화면이 바로 이 화면**이다. 그 화면이 같은 오버라이드를
 * 뒤집어쓰고 있으면 고칠 수 있는 사람이 고칠 화면에 닿지 못한다. 그래서 페이지
 * 전체를 `#ui-theme-lifeboat` 로 감싸고, 등록부의 기본값을 그 컨테이너에 직접
 * 선언한다 — 커스텀 프로퍼티는 상속되므로, 컨테이너 자신에게 걸린 선언이
 * `:root` 에서 물려받는 값을 언제나 이긴다(domain/ui-theme-tokens.ts 의
 * serializeUiThemeLifeboatCss 주석). 서버에서 렌더되고 JS 가 필요 없어서,
 * 자바스크립트가 죽어 있어도 이 화면은 읽힌다.
 *
 * 컨테이너에 바탕색과 글자색을 함께 거는 이유: globals.css 의
 * `body { background: var(--background) }` 는 **루트에서** 값을 읽으므로 저장된
 * 값을 그대로 쓴다. 컨테이너가 자기 바탕을 칠하지 않으면 기본색 글자가 바뀐
 * 바탕 위에 놓인다.
 * ============================================================================
 */
export default async function DeveloperModePage() {
  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");
  if (!mayEnterDeveloperMode(actingUser)) redirect("/no-access");

  // 데모(로컬) 모드에는 이 표가 없을 수 있다. 저장 경로도 같은 이유로 거절하므로
  // (server/actions/ui-theme-tokens.ts), 편집기를 그려 놓고 누르면 거절당하는
  // 화면이 되지 않게 여기서 갈라 둔다. settings/page.tsx 와 같은 판단이다.
  const isDatabaseMode = getAuthSource() === "database";
  const savedThemeTokens = isDatabaseMode ? await buildUiThemeView() : [];

  const cookieStore = await cookies();
  const isBypassed = isUiThemeBypassed(cookieStore.get(UI_THEME_BYPASS_COOKIE)?.value);

  return (
    <div
      id={UI_THEME_LIFEBOAT_ID}
      className="flex flex-col gap-6 bg-[var(--background)] text-[var(--foreground)]"
    >
      <style dangerouslySetInnerHTML={{ __html: UI_THEME_LIFEBOAT_CSS }} />

      <header>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">개발자 모드</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          최고관리자와 개발자로 표시된 계정만 들어올 수 있는 화면입니다. 역할별 접근 권한 설정에는 이
          메뉴가 없으므로, 다른 역할에게 열어 줄 수 없습니다.
        </p>
      </header>

      {isBypassed && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <strong>이 브라우저는 지금 화면 토큰을 우회하고 있습니다.</strong> 저장된 값이 이 브라우저
          에서만 적용되지 않는 상태입니다 — 다른 사람 화면에는 그대로 적용되고 있으니, 여기서 본
          모습으로 판단하지 마세요. 주소창에 <code className="font-mono">/api/theme/bypass?off=1</code>{" "}
          을 치면 다시 적용됩니다. 우회는 24시간 뒤 저절로 풀립니다.
        </p>
      )}

      <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <strong>이 화면만은 항상 기본색으로 그려집니다.</strong> 아래에서 무엇을 저장하든 개발자 모드
        화면 자체는 바뀌지 않습니다 — 화면이 읽히지 않게 됐을 때 되돌리러 오는 곳이 여기이기
        때문입니다. 저장한 값은 <strong>다른 화면</strong>에서 확인하세요.
      </p>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {isDatabaseMode ? (
          <ThemeTokenEditor saved={savedThemeTokens} />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            화면 토큰 편집은 데이터베이스 저장 모드에서만 사용할 수 있습니다.
          </p>
        )}
      </section>

      {/*
        🔴 단추를 하나도 두지 않는다. 누르면 아무 일도 안 나는 단추는 「고장난
        화면」으로 읽히고, 특히 이 화면에서는 「배포한 줄 알았는데 안 됐다」가
        된다. 각 기능은 실제로 동작하는 조각이 붙는 순서대로 여기 자리를 잡는다.
        위의 화면 토큰 편집기가 그 첫 사례다 — 저장 경로(인가·검증·감사·대비
        하한)가 먼저 끝났고, 그 위에 화면을 붙였다.
      */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">앞으로 여기에 들어올 것</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          화면에 박혀 있는 고정 문구를 코드를 고치지 않고 편집하는 자리, 그리고 실제 자료를 건드리지
          않고 더미 데이터로 기능을 시험해 보는 자리가 차례로 들어옵니다. 여기서 다루는 것은{" "}
          <strong>설정을 적용하는 쪽</strong>까지입니다 — 앱이 자기 다음 버전을 자기 안에서 배포할 수는
          없으므로, 버전 적용이나 운영 배포는 이 화면의 일이 아닙니다.
        </p>
      </section>
    </div>
  );
}
