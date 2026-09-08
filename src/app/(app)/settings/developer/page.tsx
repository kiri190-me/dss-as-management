import type { Metadata } from "next";
import { redirect } from "next/navigation";
import DeveloperMenuCard from "@/components/settings/DeveloperMenuCard";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { buildUiThemeView } from "@/lib/db/queries/ui-theme-tokens";
import { buildUiTextView } from "@/lib/db/queries/ui-text-overrides";
import {
  normalizeUiThemeValue,
  UI_THEME_TOKENS,
  type UiThemeOverrideRow,
  type UiThemeToken,
} from "@/lib/domain/ui-theme-tokens";
import { detectUiThemeTemplate } from "@/lib/domain/ui-theme-templates";
import { detectUiThemeMainColor } from "@/lib/domain/ui-theme-primary-ramp";
import {
  findUiTextItem,
  normalizeUiTextValue,
  type UiTextOverrideRow,
} from "@/lib/domain/ui-text-overrides";
import { DEFAULT_UI_TEXT } from "@/lib/domain/ui-text";
import {
  scopeFitsUiThemeToken,
  uiThemeDefaultFor,
} from "@/lib/validation/ui-theme-token-input";

export const metadata: Metadata = {
  title: "개발자 모드 | DSS A/S 관리 시스템",
};

// 개발자 표시는 살아 있는 계정 행에서 매 요청 읽는다(acting-user.ts). 캐시된
// 페이지를 내보내면 표시를 끈 뒤에도 이 화면이 남는다.
export const dynamic = "force-dynamic";

const TOKEN_BY_KEY: ReadonlyMap<string, UiThemeToken> = new Map(
  UI_THEME_TOKENS.map((token) => [token.key, token])
);

/**
 * ============================================================================
 * 개발자 모드 — 목차
 * ============================================================================
 * 관문·구조선 래퍼·우회 배너는 이 세그먼트의 layout.tsx 에 있다. 그래야 목차와
 * 하위 화면이 **함께** 구조선 안에 들어간다(그 파일 머리말).
 *
 * 🔴 그럼에도 이 페이지가 관문을 한 번 더 건다. 레이아웃 하나에만 기대면 주소를
 * 직접 치는 길이 한 겹 얇아진다 — 이 저장소는 화면·서버 액션·mutation 이 각자
 * 독립적으로 다시 검사하는 것을 관례로 삼는다.
 *
 * 🔴 카드는 **실제로 동작하는 화면**에만 붙인다. 다음 단계에 들어올 디자인
 * 템플릿·버튼·팝업은 자리를 비워 두지도 않는다 — 아래 「앞으로 여기에 들어올 것」
 * 문단이 그 안내를 맡는다.
 * ============================================================================
 */
export default async function DeveloperModePage() {
  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");
  if (!mayEnterDeveloperMode(actingUser)) redirect("/no-access");

  // 데모(로컬) 모드에는 이 표가 없을 수 있다. 저장 경로도 같은 이유로 거절하므로
  // (server/actions/ui-theme-tokens.ts), 메뉴를 그려 놓고 눌러 들어가면 못 쓰는
  // 화면이 나오는 대신 여기서 갈라 둔다. settings/page.tsx 와 같은 판단이다.
  const isDatabaseMode = getAuthSource() === "database";
  const savedThemeTokens = isDatabaseMode ? await buildUiThemeView() : [];
  const savedUiText = isDatabaseMode ? await buildUiTextView() : [];

  const colorCount = countOverriddenSlots(savedThemeTokens, (token) => token.kind === "color");
  const shapeCount = countOverriddenSlots(savedThemeTokens, (token) => token.kind !== "color");
  const uiTextCount = countOverriddenUiTextItems(savedUiText);

  // 「지금 무슨 톤을 쓰는가」는 따로 저장하지 않는다 — 저장된 값을 대조해
  // 알아낸다(domain/ui-theme-templates.ts). 색 화면에서 한 칸만 손으로 고쳐도
  // 이 이름이 곧바로 「직접 고친 값」으로 바뀐다.
  const currentTemplate = detectUiThemeTemplate(savedThemeTokens);

  // 「지금 무슨 메인 컬러를 쓰는가」도 같은 방식이다 — 저장하지 않고 강조 램프
  // 22칸을 대조해 알아낸다(domain/ui-theme-primary-ramp.ts).
  const currentMainColor = detectUiThemeMainColor(savedThemeTokens);

  return (
    <>
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">화면 토큰</h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            코드를 고치지 않고 앱 전체의 색과 모서리, 글자 크기를 바꿉니다.{" "}
            <strong>저장하면 전 직원 화면에 적용됩니다.</strong>
          </p>
        </div>

        {isDatabaseMode ? (
          <div className="flex flex-col gap-3">
            {/*
              🔴 톤을 먼저 고르고 세부를 손보는 순서가 자연스럽다. 그래서 이
              카드가 목차의 맨 위에 있고, 한 줄을 통째로 쓴다.
            */}
            <DeveloperMenuCard
              href="/settings/developer/theme/templates"
              title="색상 톤 템플릿"
              description="미리 맞춰 둔 중립·경고색 한 벌을 골라 앱 전체의 인상을 한 번에 바꿉니다. 목록은 지금 고른 메인 컬러의 색조로 만들어지고, 강조색과 모서리·글자 크기는 바뀌지 않습니다."
              badge={`지금 쓰는 톤 · ${currentTemplate ? currentTemplate.name : "직접 고친 값"}`}
              changedCount={0}
            />
            {/*
              🔴 톤(중립) 다음이 강조색이다. 톤이 화면 전체의 인상을 정하고 그
              위에 강조색 하나가 얹히는 순서라, 두 카드가 붙어 있어야 「무엇을
              먼저 고르는가」가 목차만 보고도 읽힌다.
            */}
            <DeveloperMenuCard
              href="/settings/developer/theme/main-color"
              title="메인 컬러"
              description="색 하나를 고르면 강조색 11단을 자동으로 만들어 주 버튼과 선택된 메뉴에 적용합니다. 중립색과 모서리·글자 크기는 바뀌지 않습니다."
              badge={`지금 쓰는 색 · ${currentMainColor ? currentMainColor.name : "직접 고른 색"}`}
              changedCount={0}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <DeveloperMenuCard
                href="/settings/developer/theme/colors"
                title="색"
                description="글자·바탕·테두리와 경고색을 라이트/다크 각각 정합니다. 저장 전에 대비를 재서 읽을 수 없는 조합을 막습니다."
                changedCount={colorCount}
              />
              <DeveloperMenuCard
                href="/settings/developer/theme/shapes"
                title="모서리 · 글자 크기"
                description="상자의 둥근 정도와 본문·제목 글자 크기를 정합니다. 라이트와 다크가 같은 값을 씁니다."
                changedCount={shapeCount}
              />
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            화면 토큰 편집은 데이터베이스 저장 모드에서만 사용할 수 있습니다.
          </p>
        )}
      </section>

      {/*
        🔴 문구는 색과 **다른 축**이라 구역을 따로 둔다. 위의 네 카드에 섞어 넣으면
        「화면 토큰」이라는 머리글이 색이 아닌 것까지 덮게 되고, 목차만 보고
        무엇을 바꾸는 자리인지 가려낼 수 없다. 색을 다 고른 다음에 말을 고르는
        순서이기도 해서 색 넷 **뒤**에 온다.
      */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">화면 문구</h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            코드를 고치지 않고 앱 곳곳에 박혀 있는 이름표를 바꿉니다.{" "}
            <strong>저장하면 전 직원 화면의 이름표가 바뀝니다.</strong>
          </p>
        </div>

        {isDatabaseMode ? (
          <DeveloperMenuCard
            href="/settings/developer/text"
            title="화면 문구"
            description="역할 이름·상태 배지·작업 이력 구분처럼 화면에 박혀 있는 이름표를 바꿉니다. 제품 구분과 유·무상 구분, 예외 상태는 여기서 바꿀 수 없고 그 까닭을 화면에 적어 두었습니다."
            changedCount={uiTextCount}
          />
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            화면 문구 편집은 데이터베이스 저장 모드에서만 사용할 수 있습니다.
          </p>
        )}
      </section>

      {/*
        🔴 단추를 하나도 두지 않는다. 누르면 아무 일도 안 나는 단추는 「고장난
        화면」으로 읽히고, 특히 이 화면에서는 「배포한 줄 알았는데 안 됐다」가
        된다. 각 기능은 실제로 동작하는 조각이 붙는 순서대로 위의 목차에 자리를
        잡는다. 화면 토큰 편집이 그 첫 사례다 — 저장 경로(인가·검증·감사·대비
        하한)가 먼저 끝났고, 그 위에 화면을 붙였다.
      */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">앞으로 여기에 들어올 것</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          위의 화면 토큰(색 · 모서리 · 글자 크기)이 첫 항목이었고, 색 한 벌을 한 번에 갈아 끼우는 색상
          톤 템플릿이 그 위에 얹혔습니다. 화면에 박혀 있는 고정 문구를 코드를 고치지 않고 바꾸는 자리도
          들어왔습니다 — 위의 <strong>화면 문구</strong>입니다. 앞으로는 버튼과 팝업·알림의 모양, 예외
          상태처럼 아직 데이터베이스에서만 고칠 수 있는 문구를 화면에서 다루는 자리, 그리고 실제 자료를
          건드리지 않고 더미 데이터로 기능을 시험해 보는 자리가 차례로 들어옵니다. 여기서 다루는 것은{" "}
          <strong>설정을 적용하는 쪽</strong>까지입니다 — 앱이 자기 다음 버전을 자기 안에서 배포할 수는
          없으므로, 버전 적용이나 운영 배포는 이 화면의 일이 아닙니다.
        </p>
      </section>
    </>
  );
}

/**
 * 이 화면이 맡는 칸 가운데 **지금 기본값에서 벗어나 저장돼 있는 칸**의 수.
 *
 * 편집기의 savedValuesOf 와 같은 규칙으로 행을 거른다 — 등록부에 없는 키·형식이
 * 틀린 값·토큰의 성격과 맞지 않는 스코프는 조회(resolveUiTheme)와 편집기가
 * 똑같이 버리므로, 목차에서만 세어 주면 "3칸 바뀜"이라 적힌 카드를 눌렀는데
 * 바뀐 칸이 하나도 없는 화면이 나온다.
 *
 * 기본값과 같은 값이 저장돼 있는 행도 세지 않는다. 저장 경로가 그런 행을 남기지
 * 않지만(값이 기본값으로 돌아오면 행을 지운다), 손으로 넣은 행이나 기본 팔레트를
 * 손본 뒤에는 있을 수 있고, 그 칸은 편집기에서 「기본값」으로 보인다.
 */
function countOverriddenSlots(
  rows: readonly UiThemeOverrideRow[],
  belongsToScreen: (token: UiThemeToken) => boolean
): number {
  let count = 0;
  for (const row of rows) {
    const token = TOKEN_BY_KEY.get(row.tokenKey);
    if (!token || !belongsToScreen(token)) continue;
    if (!scopeFitsUiThemeToken(token, row.scope)) continue;
    const value = normalizeUiThemeValue(token, row.value);
    if (value === null) continue;
    if (value === uiThemeDefaultFor(token, row.scope)) continue;
    count += 1;
  }
  return count;
}

/**
 * 문구 편집 화면이 맡는 칸 가운데 **지금 기본 문구에서 벗어나 저장돼 있는 칸**의 수.
 *
 * 위의 countOverriddenSlots 와 같은 판단이다 — 편집기가 버리는 행은 여기서도 세지
 * 않는다. 등록부에 없는 키, 형식이 틀린 값, 기본 문구와 같은 값, 그리고
 * **화면이 읽지 않는 묶음**(유·무상 구분)이 그렇다. 마지막 것을 빼지 않으면
 * 「기본값과 다른 칸 N개」라 적힌 카드를 눌렀는데 그 칸이 없는 화면이 나온다 —
 * 편집기가 편집칸을 만드는 기준(DEFAULT_UI_TEXT 에 그 묶음이 있는가)과 같은
 * 기준을 여기서도 쓴다.
 */
function countOverriddenUiTextItems(rows: readonly UiTextOverrideRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (!(row.groupKey in DEFAULT_UI_TEXT)) continue;
    const item = findUiTextItem(row.groupKey, row.itemKey);
    if (!item) continue;
    const value = normalizeUiTextValue(row.value);
    if (value === null) continue;
    if (value === item.defaultText) continue;
    count += 1;
  }
  return count;
}
