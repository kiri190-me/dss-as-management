import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
import { readSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "개발자 모드 | DSS A/S 관리 시스템",
};

// 개발자 표시는 살아 있는 계정 행에서 매 요청 읽는다(acting-user.ts). 캐시된
// 페이지를 내보내면 표시를 끈 뒤에도 이 화면이 남는다.
export const dynamic = "force-dynamic";

/**
 * ============================================================================
 * 개발자 모드 — 아직 빈 자리다
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
 * ============================================================================
 */
export default async function DeveloperModePage() {
  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");
  if (!mayEnterDeveloperMode(actingUser)) redirect("/no-access");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">개발자 모드</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          최고관리자와 개발자로 표시된 계정만 들어올 수 있는 화면입니다. 역할별 접근 권한 설정에는 이
          메뉴가 없으므로, 다른 역할에게 열어 줄 수 없습니다.
        </p>
      </header>

      {/*
        🔴 단추를 하나도 두지 않는다. 누르면 아무 일도 안 나는 단추는 「고장난
        화면」으로 읽히고, 특히 이 화면에서는 「배포한 줄 알았는데 안 됐다」가
        된다. 각 기능은 실제로 동작하는 조각이 붙는 순서대로 여기 자리를 잡는다.
      */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">앞으로 여기에 들어올 것</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          화면에 박혀 있는 고정 문구를 코드를 고치지 않고 편집하는 자리, 색·여백 같은 화면 토큰을
          편집하는 자리(토큰을 먼저 한곳에 모으는 작업이 앞서야 합니다), 그리고 실제 자료를 건드리지
          않고 더미 데이터로 기능을 시험해 보는 자리가 차례로 들어옵니다. 여기서 다루는 것은{" "}
          <strong>설정을 적용하는 쪽</strong>까지입니다 — 앱이 자기 다음 버전을 자기 안에서 배포할 수는
          없으므로, 버전 적용이나 운영 배포는 이 화면의 일이 아닙니다.
        </p>
      </section>
    </div>
  );
}
