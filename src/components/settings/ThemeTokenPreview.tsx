"use client";

import { useEffect, useState } from "react";
import { UI_THEME_TOKENS } from "@/lib/domain/ui-theme-tokens";

/**
 * ============================================================================
 * 화면 토큰 미리보기 — 저장하기 전에 눈으로 보는 견본
 * ============================================================================
 * 편집 중인 값(draft)을 **인라인 style 의 CSS 변수**로 컨테이너에 걸고, 그 안에
 * 앱이 실제로 쓰는 유틸리티 클래스로 작은 화면 한 조각을 그린다. 변수는
 * 상속되므로 컨테이너 안의 `text-zinc-900` · `rounded-md` · `text-sm` 이 전부
 * 편집 중인 값을 따라 움직인다. ProcedureNodeChip.tsx 가 이미 완주한 길이다.
 *
 * 견본의 클래스를 일부러 앱의 것과 똑같이 적었다 — `bg-white` 나 `text-white`
 * 처럼 **이번 판에 열지 않은 색**은 견본에서도 안 바뀐다. 견본만 예쁘게 그리려고
 * 다른 클래스를 쓰면, 저장한 뒤에야 "화면은 이렇게 안 바뀌네"를 알게 된다.
 *
 * ── 🔴 다크 모드에서는 라이트 견본을 그릴 수 없다 ───────────────────────
 * globals.css 의 `@custom-variant dark (&:where(.dark, .dark *))` 와, `.dark` 가
 * `<html>` 에 붙는다는 사실(ThemeToggle.tsx)이 겹쳐서 — 다크 모드인 문서 안에서는
 * **모든 자손**이 `.dark *` 에 걸린다. 어떤 컨테이너로 감싸도 그 안을 "라이트인
 * 척"하게 만들 수 없다. 반대 방향은 된다: 라이트 모드 문서 안의 컨테이너에
 * `dark` 클래스를 걸면 그 안이 `.dark *` 에 걸린다.
 *
 * 그래서 이 컴포넌트는 **지금 테마의 견본만 정확히 그리고**, 라이트 모드일 때만
 * 다크 견본을 덤으로 붙인다. 다크 모드에서 라이트 견본을 억지로 그리면
 * 「라이트도 확인했다」는 잘못된 확신을 준다 — 이 기능에서 가장 위험한 오해이고,
 * 그 결과는 전 직원이 다음 날 아침에 본다. 그래서 그리지 않고, 왜 없는지를
 * 화면에 적는다.
 *
 * ── 지금 테마는 마운트 뒤에 읽는다 ──────────────────────────────────────
 * 서버는 `.dark` 가 붙을지 알 수 없다(브라우저 localStorage 가 정한다). 서버에서
 * 한쪽으로 찍어 두면 hydration 이 어긋나므로, 읽기 전에는 자리만 잡아 둔다.
 * MutationObserver 를 거는 것은 사용자가 이 화면에 머문 채 좌하단 테마 단추를
 * 누를 수 있기 때문이다 — 그때 견본이 옛 테마 그대로면 그것이 곧 오해가 된다.
 * ============================================================================
 */

/** 논리 키 → 값. 편집기가 **정규화된 값만** 담아 넘긴다. */
export type ThemeTokenPreviewValues = Readonly<Record<string, string>>;

export default function ThemeTokenPreview({
  light,
  dark,
}: {
  light: ThemeTokenPreviewValues;
  dark: ThemeTokenPreviewValues;
}) {
  const theme = useDocumentTheme();

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">미리보기</h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          저장하지 않은 값이 그대로 보입니다. 이 견본은 편집기 안에서만 바뀌며, 실제 화면은 저장해야
          바뀝니다.
        </p>
      </div>

      {theme === null ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          미리보기를 준비하는 중입니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <PreviewFrame
            title={theme === "dark" ? "지금 보고 있는 화면 — 다크" : "지금 보고 있는 화면 — 라이트"}
            values={theme === "dark" ? dark : light}
            forceDark={false}
          />

          {theme === "light" ? (
            <PreviewFrame title="다크 화면 견본" values={dark} forceDark />
          ) : (
            <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <strong>라이트 견본은 여기에 그릴 수 없습니다.</strong> 다크 모드에서는 화면 안의 모든
              요소가 다크 규칙에 걸리기 때문에, 이 자리에 라이트 견본을 그리면 실제와 다른 색이
              보입니다. 라이트 쪽 값을 눈으로 확인하려면 <strong>테마를 라이트로 바꿔</strong> 주세요 —
              편집 중인 값은 그대로 남아 있습니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 견본 한 장. `forceDark` 는 라이트 모드 문서 안에서 다크 견본을 그릴 때만
 * 쓴다(위 머리말의 "되는 방향").
 */
function PreviewFrame({
  title,
  values,
  forceDark,
}: {
  title: string;
  values: ThemeTokenPreviewValues;
  forceDark: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <p className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {title}
      </p>
      <div className={forceDark ? "dark" : undefined} style={cssVariableStyle(values)}>
        <PreviewBody />
      </div>
    </div>
  );
}

/**
 * 견본의 내용. 대비 짝이 실제로 눈에 보이도록 — 제목·본문·보조 설명 글자,
 * 카드 바탕과 페이지 바탕, 단추, 경고 상자, 표 구분선을 한 자리에 모았다.
 * 모서리(rounded-*)와 글자 크기(text-*)도 같이 드러난다.
 *
 * 단추를 `<button>` 이 아니라 `<span>` 으로 그린다 — 눌러도 아무 일이 없는
 * 단추는 「고장난 화면」으로 읽힌다(개발자 모드 페이지의 규율과 같은 이유).
 */
function PreviewBody() {
  return (
    <div className="bg-[var(--background)] p-4 text-[var(--foreground)]">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">인수번호 D260801</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          본문 글자입니다. 목록과 표의 내용이 이 크기·색으로 보입니다.
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          보조 설명 글자입니다. 안내 문구와 꼬리말이 여기에 해당합니다.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
            주 단추
          </span>
          <span className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
            보조 단추
          </span>
          <span className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white dark:bg-red-900 dark:text-red-50">
            위험 단추
          </span>
          <span className="rounded-sm bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            배지
          </span>
        </div>

        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          경고 상자입니다. 삭제·반려·기한 초과 안내가 이 색으로 나옵니다.
        </p>

        <table className="mt-3 w-full border-collapse text-sm">
          <thead className="text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th scope="col" className="py-1 pr-3 text-left font-medium">
                고객사
              </th>
              <th scope="col" className="py-1 text-left font-medium">
                상태
              </th>
            </tr>
          </thead>
          <tbody className="text-zinc-900 dark:text-zinc-50">
            <tr className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-1.5 pr-3">교산전기</td>
              <td className="py-1.5">인수점검</td>
            </tr>
            <tr className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-1.5 pr-3">대성산업</td>
              <td className="py-1.5">수리 진행</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 편집 중인 값을 인라인 style 의 CSS 변수로 바꾼다.
 *
 * 변수 이름은 **등록부의 cssVar 상수**를 쓴다 — 넘어온 키로 이름을 조립하지
 * 않으므로, 등록부에 없는 키는 여기서 조용히 사라진다(serializeUiThemeCss 와
 * 같은 방어). 값 자체는 React 가 element.style.setProperty 로 넣으므로 문자열이
 * 규칙을 탈출할 자리가 애초에 없다.
 */
function cssVariableStyle(values: ThemeTokenPreviewValues): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const token of UI_THEME_TOKENS) {
    const value = values[token.key];
    if (typeof value !== "string" || value.length === 0) continue;
    style[token.cssVar] = value;
  }
  return style as React.CSSProperties;
}

/** 지금 문서가 라이트인지 다크인지. 마운트 전에는 null(아직 모른다). */
function useDocumentTheme(): "light" | "dark" | null {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();

    // 이 화면에 머문 채로 테마를 바꿀 수 있다. 그때 견본이 옛 테마 그대로면
    // 「확인했다」가 곧 오해가 된다.
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
