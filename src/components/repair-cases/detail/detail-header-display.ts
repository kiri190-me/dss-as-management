/**
 * ============================================================================
 * 머리 카드가 **무엇을 그릴지** 정하는 순수 판정 둘 (2026-10-06)
 * ============================================================================
 * DetailHeader 는 "use client" 조각이라 그 안에서 바로 판정해도 되지만, 두 판정은
 * 모두 「이런 경우에 빠진다」는 규칙이라 글로만 적어 두면 다음 사람이 모른다.
 * 순수 함수로 꺼내 두면 시험이 경우를 하나하나 못 박을 수 있다.
 * ============================================================================
 */

/**
 * 인쇄 전용 주소인가 — **마지막 조각이 `print`** 면 그렇다.
 *
 * 머리 카드는 레이아웃(`[id]/layout.tsx`)이 그리므로 그 아래 모든 주소에 따라
 * 붙는다. 서비스 보고서 인쇄 미리보기는 **고객사로 나가는 문서를 그대로 그리는
 * 자리**라, 거기에 카드가 얹히면 양식 위에 사내 화면이 찍힌다.
 *
 * 🔴 카드 자체에 인쇄 숨김 클래스를 걸지 않는다. 「기본 정보」 탭을 종이로 뽑으면
 * 이 카드가 그 종이의 **유일한 제목**(인수번호)이다 — IntakeInfoSection 에는
 * 인수번호가 없다. 그래서 「인쇄할 때 감춘다」가 아니라 「인쇄 전용 주소에서는
 * 아예 안 그린다」로 가른다.
 *
 * 조각으로 나눠 보는 까닭은 `startsWith`/`includes` 가 `/sprint` 나
 * `/print-settings` 같은 이웃 이름에도 걸리기 때문이다. 끝의 빗금은 무시한다
 * (`.../print/` 도 같은 주소다).
 *
 * 받는 값은 `usePathname()` 이 주는 **경로뿐**이다 — 질의문자열(`?id=…`)과
 * 조각(`#`)은 거기 들어 있지 않다.
 */
export function isPrintOnlyPathname(pathname: string): boolean {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 && segments[segments.length - 1] === "print";
}

/**
 * 머리 카드 한 줄에 올릴 값인가 — 빈 값이면 `null` 이고, 부르는 쪽은 그 조각을
 * **통째로** 뺀다.
 *
 * 🔴 `-` 를 그대로 그리지 않는다. 자리표시 하나가 가운뎃점과 함께 자리를 먹어,
 * 「세로를 한 줄로 줄인다」는 이 카드의 목적을 그만큼 깎는다. mock 자료는 모르는
 * 값을 `-` 로 적어 두고(resolved-repair-case.ts 의 `?? "-"`), 사람이 손으로 적은
 * 칸에는 유니코드 대시가 섞여 들어온다.
 */
export function headerFactText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (text === "") return null;
  // 하이픈 · 엔 대시 · 엠 대시 — 셋 다 「없음」으로 쓰인 적이 있다.
  if (text === "-" || text === "–" || text === "—") return null;
  return text;
}
