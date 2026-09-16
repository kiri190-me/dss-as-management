/**
 * ============================================================================
 * 글자를 클립보드로 — **두 갈래** (공용)
 * ============================================================================
 * `navigator.clipboard` 는 **보안 컨텍스트(https · localhost)에서만** 있다. 이 시스템의 운영
 * 서버는 사내 NAS 에 **http 로** 올라간다 — 거기서는 그 API 가 아예 없다(권한 거절이 아니라
 * `navigator.clipboard` 자체가 undefined 다). 그래서 옛 방식(숨긴 textarea 를 골라
 * `document.execCommand("copy")`)을 **둘째 갈래**로 둔다.
 *
 * ── 왜 공용 모듈인가 ────────────────────────────────────────────────────
 * 같은 두 갈래가 이미 화면 셋(CustomerLinkAddress · ImprovementRequestsScreen ·
 * EditSectionActions)에 따로 적혀 있다. 네 번째를 또 적으면 언젠가 한쪽만 고쳐진다 — 새 코드는
 * 이 파일을 쓴다. (도는 화면 셋을 여기로 모으는 일은 회귀 위험이 있어 별도 조각으로 남겼다.)
 *
 * ── 둘 다 실패할 수 있다 ─────────────────────────────────────────────────
 * 권한 정책 · execCommand 를 뗀 브라우저에서는 두 갈래 다 막힌다. 그때는 `false` 를 돌려주고
 * **부르는 쪽이** 다음 길을 낸다(「직접 긁어 복사해 주세요」 · 다른 방법 안내) — 이 파일은
 * 화면을 모른다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ───────────────────────────────────────
 * 두 갈래 다 바꿔 끼울 수 있어 DOM 없이 시험한다(copy-text.test.ts). 브라우저 기본값은 **부를
 * 때** 만든다 — 이 파일을 읽는 것만으로 `navigator` · `document` 를 만지지 않는다(서버 렌더에서도
 * 안전하다).
 *
 * 🔴 복사할 글자를 로그에 찍지 않는다 — 고객 전용 주소 · 사내 공유폴더 주소가 들어온다.
 * ============================================================================
 */

export type CopyTextEnvironment = {
  /** 첫째 갈래 — 보안 컨텍스트에서만 있다. 없으면 null(http 로 연 NAS). */
  clipboardWrite: ((text: string) => Promise<void>) | null;
  /** 둘째 갈래 — 숨긴 textarea 를 골라 복사한다. 됐으면 true. */
  selectionCopy: (text: string) => boolean;
};

/**
 * 화면 밖에 둔 textarea 를 골라 복사한다. `display:none` 은 쓸 수 없다 — 고르려면 초점이
 * 가야 한다. 성공하든 실패하든 틀은 반드시 치운다.
 */
function copyWithHiddenTextarea(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand("copy");
  } finally {
    area.remove();
  }
}

/** 브라우저 기본값 — 부를 때 만든다. `navigator` 가 없는 곳(서버 렌더)에서도 던지지 않는다. */
export function browserCopyTextEnvironment(): CopyTextEnvironment {
  const write = typeof navigator === "undefined" ? undefined : navigator.clipboard?.writeText;
  return {
    clipboardWrite: typeof write === "function" ? (text) => navigator.clipboard.writeText(text) : null,
    selectionCopy: copyWithHiddenTextarea,
  };
}

/**
 * 글자를 클립보드에 넣는다. 성공하면 true. **던지지 않는다.**
 * 첫째 갈래가 없거나 실패하면 둘째 갈래로 넘어가고, 둘 다 안 되면 false 다.
 */
export async function copyText(text: string, overrides: Partial<CopyTextEnvironment> = {}): Promise<boolean> {
  const env: CopyTextEnvironment = { ...browserCopyTextEnvironment(), ...overrides };

  if (env.clipboardWrite !== null) {
    try {
      await env.clipboardWrite(text);
      return true;
    } catch {
      // https 가 아니거나 권한이 막혔다 — 아래 옛 방식으로 넘어간다.
    }
  }

  try {
    return env.selectionCopy(text) === true;
  } catch {
    return false;
  }
}
