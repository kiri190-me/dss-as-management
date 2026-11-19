import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import QuoteApprovalSaveConfirmDialog, {
  QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE,
} from "./QuoteApprovalSaveConfirmDialog";

/**
 * ============================================================================
 * 🔴 **결재가 올라가 있으면 저장 전에 묻는다** (2026-11-19 사용자 요청)
 * ============================================================================
 * 「[견적서] 이미 승인이 끝난 건에 들어가서 내용을 고친 다음에 [저장]을 누르면 팝업이
 * 뜨고 그 아래에는 [저장]/[취소]가 뜨게 해주고, [취소]를 누르면 저장이 안된 채로
 * 팝업이 꺼지도록 해줘.」
 *
 * 둘로 나눠 본다(이웃 시험들과 같은 방법):
 *  · **창**(QuoteApprovalSaveConfirmDialog)은 아무것도 물지 않아 그대로 그려 본다 —
 *    문구 · 단추 둘 · `type="button"` · 처음 초점.
 *  · **폼**(QuoteEditForm)은 서버 액션을 물어 이 환경에서 그릴 수 없다(`server-only`).
 *    그래서 원본을 글자로 읽어 **이음새**를 본다 — quote-save-pdf-screens.test.ts ·
 *    quote-attachment-screens.test.ts 와 같은 방법이다.
 *
 * 🔴 **판정이 제자리에 있는지**(결재 줄의 마지막 status 인지)는 수정 페이지 쪽 일이라
 * quote-approval-screen.test.tsx 가 본다 — 그 파일이 「결재는 발행·수정을 막지
 * 않는다」 울타리를 쥐고 있어, 이 기능이 그 울타리를 넘지 않았는지도 거기서 함께 잰다.
 * ============================================================================
 */

/** 단추 이름을 **차례대로**(common/UnsavedLeaveConfirmDialog.test.tsx 의 같은 읽개). */
function buttonLabels(html: string): string[] {
  return html
    .split("<button")
    .slice(1)
    .map((chunk) =>
      chunk
        .slice(chunk.indexOf(">") + 1, chunk.indexOf("</button>"))
        .replace(/<[^>]*>/g, "")
        .trim()
    );
}

/** `<button …>` 의 여는 태그들 — 속성은 글자로 본다. */
function buttonTags(html: string): string[] {
  return html.match(/<button [^>]*>/g) ?? [];
}

function render(isOpen = true): string {
  return renderToStaticMarkup(
    <QuoteApprovalSaveConfirmDialog isOpen={isOpen} onSave={() => {}} onCancel={() => {}} />
  );
}

const dialogSource = readFileSync(
  new URL("./QuoteApprovalSaveConfirmDialog.tsx", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기로 시험이 깨지지 않게 공백을 하나로 접은 것. */
const dialogFlat = dialogSource.replace(/\s+/g, " ");

const formRaw = readFileSync(new URL("./QuoteEditForm.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
/** 주석을 걷어낸 코드 — 머리말이 까닭을 적느라 쓴 낱말에 걸리지 않게. */
const formCode = formRaw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const form = formCode.replace(/\s+/g, " ");

const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};

describe("🔴 ① 창의 문구는 **사용자가 준 글자 그대로**다", () => {
  test("🔴 한 글자도 다르지 않다 — 시험에 그 글을 직접 적어 맞대어 본다", () => {
    /**
     * 🔴 상수끼리만 견주면(= `html.includes(상수)`) **상수를 고치는 날 시험이 함께
     * 따라가** 영영 통과한다. 사용자가 준 글을 여기 한 번 더 적어 둔다.
     */
    const given = "승인요청이 반려되며 다시 승인이 필요할 수 있습니다. 저장하시겠습니까?";
    assert.equal(QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE, given);
    assert.ok(render().includes(given), render());
  });

  test("🔵 「반려됩니다」로 단정하지 않는다 — 안 바뀐 저장에는 아무 일도 안 일어난다", () => {
    // 🔴 폼은 저장 전에 「DB 와 다른가」를 알 길이 없어(domain/quote-form-changed.ts)
    //    안 바뀐 저장에도 이 창이 뜬다. 그때도 참인 문장이어야 한다.
    assert.match(QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE, /있습니다/);
    assert.ok(
      !QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE.includes("반려됩니다."),
      QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE
    );
  });
});

describe("🔴 ② 단추는 둘 — [저장] · [취소]", () => {
  test("차례도 사용자가 적은 그대로다", () => {
    assert.deepEqual(buttonLabels(render()), ["저장", "취소"]);
  });

  test("🔴 **둘 다 `type=\"button\"`** — 이 창은 폼 **안**에 그려진다", () => {
    /**
     * 🔴 빠뜨리면 [취소]가 submit 이 되어, 저장을 그만두려고 누른 손이 그대로 저장한다
     * (편집 폼의 [취소] 단추가 같은 까닭으로 `type="button"` 이다).
     */
    const tags = buttonTags(render());
    assert.equal(tags.length, 2, `단추가 둘이 아니다 — ${tags.join(" ")}`);
    for (const tag of tags) {
      assert.ok(tag.includes('type="button"'), `type="button" 이 없다 — ${tag}`);
    }
    // 🔴 이 창이 실제로 폼 안에 있다는 것이 위 까닭의 전제다.
    assert.ok(form.includes("<QuoteApprovalSaveConfirmDialog"), "창이 폼에 꽂혀 있지 않다");
    assert.ok(
      indexOrFail(form, "<form ref={formRef} onSubmit={handleSubmit}") <
        indexOrFail(form, "<QuoteApprovalSaveConfirmDialog"),
      "창이 폼 바깥에 있다 — 그러면 위 전제가 거짓이 된다"
    );
  });

  test("🔴 처음 초점은 **[취소]** — Enter 한 번 더에 그대로 저장되지 않게", () => {
    /**
     * 🔴 `showModal()` 은 첫 초점 가능한 것을 잡는다. 그냥 두면 [저장]에 초점이 가고,
     * [저장]을 눌러 이 창을 띄운 손이 Enter 를 한 번 더 치면 읽지도 않고 저장된다.
     */
    const html = render();
    const at = html.indexOf("autofocus");
    assert.ok(at >= 0, "autoFocus 가 없다 — showModal 은 첫 단추([저장])를 잡는다");
    const after = html.slice(at);
    assert.equal(after.slice(0, after.indexOf("</button>")).includes("취소"), true, after.slice(0, 300));
  });
});

/**
 * ============================================================================
 * 🔴 문장이 **한 줄로 설 폭**이 창에 있다 (2026-11-19 눈 확인)
 * ============================================================================
 * 처음에는 공용 창과 같은 `max-w-md` 였는데 사용자 화면에서 「저장하시겠습니**까?**」의
 * 마지막 한 글자가 둘째 줄로 떨어졌다. 🔴 문구는 사용자가 준 글자라 못 줄이므로 **창을
 * 넓혀** 풀었다. 🔴 그러면서 폰에서 창이 화면을 넘지 않아야 한다 — 두 조건을 **값으로**
 * 잰다(브라우저가 없는 시험이라 눈으로는 못 본다).
 *
 * 쓰는 숫자는 전부 Tailwind 4 의 기본값이다(node_modules/tailwindcss/theme.css 에서 읽어
 * 맞춰 둔 것): `--text-sm: 0.875rem` · `--container-md: 28rem` · `--container-xl: 36rem` ·
 * `--breakpoint-sm: 40rem` · `--spacing: 0.25rem`(p-4 = 1rem).
 * ============================================================================
 */
describe("🔴 ③ 문장이 한 줄로 설 폭 — 그리고 폰에서는 접힌다", () => {
  const ROOT_PX = 16;
  /** `text-sm` = 0.875rem. */
  const FONT_PX = 0.875 * ROOT_PX;
  /** `p-4` 좌우 — `--spacing` 0.25rem × 4 = 1rem 씩. */
  const PADDING_PX = 2 * ROOT_PX;
  const MAX_W_MD_PX = 28 * ROOT_PX;
  const MAX_W_XL_PX = 36 * ROOT_PX;
  const BREAKPOINT_SM_PX = 40 * ROOT_PX;
  /** 좁은 폰(갤럭시 S 계열의 CSS 폭). 더 좁은 기기가 있어도 아래 결론은 같은 쪽으로 기운다. */
  const PHONE_PX = 360;

  /**
   * 🔵 글자 하나의 가로를 **보수적으로** 셈한다 — 한글은 전각(1em), 공백과 반각 문장부호는
   * 그 일부다. 실제 글꼴마다 조금씩 다르므로 **딱 맞는 폭을 고르는 데 쓰지 않고**, 「한
   * 줄이 설 만큼 넉넉한가」를 가르는 데만 쓴다(아래 남는 폭을 함께 단언한다).
   */
  function estimateWidthPx(text: string): number {
    let px = 0;
    for (const ch of text) {
      if (/[가-힣]/.test(ch)) px += FONT_PX;
      else if (ch === " ") px += FONT_PX * 0.28;
      else px += FONT_PX * 0.35;
    }
    return px;
  }

  const sentencePx = estimateWidthPx(QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE);

  test("🔵 무엇을 재는지 — 글자 수와 셈한 가로가 눈으로 본 그 폭과 맞는다", () => {
    const hangul = [...QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE].filter((ch) => /[가-힣]/.test(ch));
    assert.equal(hangul.length, 30, "문구가 바뀌었다 — 아래 셈을 다시 맞출 것");
    // 420px(한글) 을 넘고 500px 아래 — 셈이 통째로 틀어지면 여기서 잡힌다.
    assert.ok(sentencePx > 420 && sentencePx < 500, `셈한 가로가 ${sentencePx}px 다`);
  });

  test("🔴 창이 **한 줄이 설 만큼** 넓다 — `max-w-xl`", () => {
    const html = render();
    const dialogTag = html.slice(0, html.indexOf(">"));
    assert.ok(dialogTag.includes("max-w-xl"), dialogTag);
    assert.ok(
      sentencePx <= MAX_W_XL_PX - PADDING_PX,
      `속 ${MAX_W_XL_PX - PADDING_PX}px 에 ${sentencePx}px 가 안 들어간다`
    );
    // 🔵 빠듯하게 통과하지 않는지 — 글꼴이 조금 넓어도 버틸 만큼 남아야 한다.
    assert.ok(
      MAX_W_XL_PX - PADDING_PX - sentencePx > 60,
      `남는 폭이 ${MAX_W_XL_PX - PADDING_PX - sentencePx}px 뿐이다`
    );
  });

  test("🔴 **좁히면 안 된다** — 공용 창의 `max-w-md` 에서는 한 글자가 넘어갔다", () => {
    /**
     * 🔴 이것이 2026-11-19 눈 확인에서 본 그 증상의 값이다: 속 416px 에 457px 짜리 글이
     * 들어가지 못해 「까?」가 둘째 줄로 떨어졌다. 되돌리면 같은 일이 다시 난다.
     */
    assert.ok(
      sentencePx > MAX_W_MD_PX - PADDING_PX,
      `max-w-md 에서도 한 줄이면 이 시험은 더 지킬 것이 없다(${sentencePx}px)`
    );
    assert.ok(!render().slice(0, render().indexOf(">")).includes("max-w-md"), "창이 다시 좁아졌다");
  });

  test("🔴 폰에서는 **접힌다** — 한 줄 강제가 `sm:` 부터다", () => {
    const html = render();
    const messageTag = html.match(/<p [^>]*>/)?.[0] ?? "";
    assert.ok(messageTag.length > 0, "문장 칸을 찾지 못했다");
    /**
     * 🔴 폰 속(360 − 32 = 328px)에는 457px 짜리 한 줄이 **들어가지 않는다.** 그래서
     * `whitespace-nowrap` 을 맨바닥에 두면 창이 화면 밖으로 나간다(가로 스크롤 · 단추
     * 잘림). 접히는 쪽이 기본값이어야 한다.
     */
    assert.ok(sentencePx > PHONE_PX - PADDING_PX, `폰 속 ${PHONE_PX - PADDING_PX}px 에 한 줄이 들어간다면 이 시험은 뜻이 없다`);
    assert.ok(messageTag.includes("sm:whitespace-nowrap"), messageTag);
    assert.ok(
      !/(^|\s|")whitespace-nowrap/.test(messageTag),
      `한 줄 강제가 맨바닥에 있다 — 폰에서 창이 화면을 넘는다: ${messageTag}`
    );
    // 🔴 접힐 때 낱말 가운데를 자르지 않는다 — 눈 확인에서 본 「…습니 / 까?」가 그것이었다.
    assert.ok(messageTag.includes("break-keep"), messageTag);
  });

  test("🔴 한 줄이 **켜지는 첫 픽셀부터** 안전하다 — 분기점이 필요한 폭보다 넓다", () => {
    /**
     * 🔴 `sm:` 이 켜지는 640px 에서 창은 이미 `max-w-xl`(576px)까지 자라 있다. 속
     * 544px ≥ 457px 이므로 **켜지자마자 한 줄이 들어간다.** 분기점이 더 작았다면 그
     * 사이 폭에서 한 줄이 화면을 넘는 구간이 생긴다.
     */
    const widthAtBreakpoint = Math.min(BREAKPOINT_SM_PX, MAX_W_XL_PX);
    assert.ok(
      sentencePx <= widthAtBreakpoint - PADDING_PX,
      `분기점에서 속이 ${widthAtBreakpoint - PADDING_PX}px 인데 글이 ${sentencePx}px 다`
    );
  });

  test("🔴 폰에서 창이 **화면을 넘지 않는다** — 폭이 `min(100%, 576px)` 이다", () => {
    const dialogTag = render().slice(0, render().indexOf(">"));
    // 🔴 `w-full` 이 없으면 `max-w-xl` 만 남아 창이 내용만큼 자란다(폰에서 넘칠 수 있다).
    assert.ok(dialogTag.includes("w-full"), dialogTag);
    assert.ok(dialogTag.includes("max-w-xl"), dialogTag);
    // 🔵 `box-sizing: border-box` 라 안쪽 여백이 폭 안에 든다 — 여백이 폭을 늘리는
    //    자리(`mx-*` 같은 바깥 여백)를 두지 않았다.
    assert.ok(!/(^|\s|")m[xl]?-/.test(dialogTag), `바깥 여백이 폭에 더해진다 — ${dialogTag}`);
    assert.ok(Math.min(PHONE_PX, MAX_W_XL_PX) <= PHONE_PX, "폰에서 창이 화면보다 넓다");
  });
});

describe("🔴 ④ 창의 모양 — 이 저장소의 native <dialog>", () => {
  test("브라우저 기본 confirm 도 NoticePopup 도 아니다", () => {
    assert.ok(render().startsWith("<dialog"), render().slice(0, 80));
    // 🔴 `confirm()` 은 단추 글자를 못 고치고, NoticePopup 은 [닫기] 하나뿐이다.
    assert.ok(!dialogSource.includes("confirm("), "브라우저 기본 confirm 을 쓴다");
    assert.ok(!dialogSource.includes("NoticePopup"), "단추가 하나뿐인 알림을 쓴다");
  });

  test("닫혀 있어도 그려진다 — 열림 여부는 부모가 소유한다", () => {
    const html = render(false);
    assert.ok(html.startsWith("<dialog"), html.slice(0, 80));
    assert.deepEqual(buttonLabels(html), ["저장", "취소"]);
    assert.ok(
      dialogFlat.includes("if (isOpen && !dialog.open) { dialog.showModal(); } else if (!isOpen && dialog.open) { dialog.close(); }"),
      "열림 여부를 부모의 값으로 따라가지 않는다"
    );
  });

  test("🔴 Esc 로 닫히면 **[취소]와 같다** — 저장하지 않는다", () => {
    const esc = dialogSource.slice(
      indexOrFail(dialogSource, "onCancel={(event) => {"),
      indexOrFail(dialogSource, "className=\"w-full max-w-xl")
    );
    assert.ok(esc.includes("event.preventDefault();"), esc);
    assert.ok(esc.includes("onCancel();"), esc);
    assert.ok(!esc.includes("onSave"), `Esc 가 저장으로 간다 — ${esc}`);
  });
});

/**
 * ============================================================================
 * 🔴 ⑤ 폼의 저장 흐름 — 묻는 것이 **저장보다 먼저**다
 * ============================================================================
 */
describe("🔴 ⑤ 결재가 올라가 있으면 저장 액션보다 **창이 먼저**다", () => {
  const gate = form.slice(
    indexOrFail(form, "async function handleSubmit(event: FormEvent)"),
    indexOrFail(form, "async function saveQuote()")
  );

  test("🔵 무엇을 재는지 — 문이 둘(폼 submit · 창의 [저장])이고 저장 몸통은 하나다", () => {
    assert.ok(gate.length > 0, "저장을 받는 자리를 찾지 못했다");
    assert.ok(form.includes("async function saveQuote() {"), "저장 몸통이 따로 없다");
    // 저장 액션을 부르는 자리는 그 몸통 **안**에만 있다.
    assert.ok(!gate.includes("updateQuoteAction("), "묻기 전에 저장 액션이 불린다");
    assert.ok(!gate.includes("createQuoteAction("), "묻기 전에 저장 액션이 불린다");
  });

  test("🔴 결재가 올라가 있으면 **창을 띄우고 멈춘다** — 저장이 한 글자도 돌지 않는다", () => {
    assert.ok(
      gate.includes("if (hasLiveApproval) { setAskApprovalSave(true); return; }"),
      gate
    );
    // 🔴 `return` 이 없으면 창을 띄우고 **그대로 저장까지** 간다(묻는 뜻이 없어진다).
    const ask = indexOrFail(gate, "setAskApprovalSave(true);");
    const save = indexOrFail(gate, "await saveQuote();");
    assert.ok(ask < save, "묻기가 저장보다 뒤다");
    assert.ok(gate.slice(ask, save).includes("return;"), "묻고 나서 멈추지 않는다");
  });

  test("🔴 결재가 **없으면** 창 없이 그대로 저장된다 — 문을 하나 더 두지 않는다", () => {
    /**
     * 🔴 묻는 조건은 **그 불 하나**다. 다른 조건(고쳤는가 · 종류 · 새 장인가)이 섞이면
     * 「뜰 줄 알았는데 안 뜨는」 자리가 생긴다. 새 장은 그 불이 기본값 `false` 라
     * 여기서 따로 가르지 않는다(quote-approval-screen.test.tsx 가 그 기본값을 지킨다).
     */
    assert.equal(
      (gate.match(/if \(/g) ?? []).length,
      2,
      `문이 둘(저장 중·충돌 · 결재)이 아니다 — ${gate}`
    );
    assert.ok(gate.includes("if (isSubmitting || isConflict) return;"), gate);
    assert.ok(!gate.includes("dirty"), "「고쳤는가」로 창을 가린다 — 서버와 다른 것을 잰다");
  });

  test("🔴 대기 중이든 승인 완료든 **같은 창 하나**다 — 폼이 갈래를 더 나누지 않는다", () => {
    // 🔴 갈래를 나누면 판정이 두 곳이 된다. 폼이 받는 것은 불 하나이고, 그 안에
    //    REQUESTED · APPROVED 가 함께 들어 있다(domain/quote-approval-rules.ts).
    assert.equal((form.match(/hasLiveApproval/g) ?? []).length, 3, "불을 보는 자리가 늘었다");
    assert.ok(!form.includes('"REQUESTED"'), "폼이 결재 줄의 상태 글자를 적었다");
    assert.ok(!form.includes('"APPROVED"'), "폼이 결재 줄의 상태 글자를 적었다");
  });
});

describe("🔴 ⑥ 창의 [저장] · [취소]", () => {
  const wiring = form.slice(
    indexOrFail(form, "<QuoteApprovalSaveConfirmDialog"),
    indexOrFail(form, "<QuoteApprovalSaveConfirmDialog") + 400
  );

  test("🔵 무엇을 재는지 — 창이 열림 상태에 꽂혀 있다", () => {
    assert.ok(wiring.includes("isOpen={askApprovalSave}"), wiring);
    assert.ok(form.includes("const [askApprovalSave, setAskApprovalSave] = useState(false);"), "열림 상태가 없다");
  });

  test("🔴 [저장] → **원래 가던 저장 길**을 그대로 간다", () => {
    assert.ok(
      wiring.includes("onSave={() => { setAskApprovalSave(false); void saveQuote(); }}"),
      wiring
    );
    /**
     * 🔴 `requestSubmit()` 이 아니다 — 폼 submit 으로 되돌아가면 위 문이 이 창을 **또**
     * 띄워 끝나지 않는다. 「저장 안 된 내용」 창의 [저장]은 `requestSubmit()` 인데
     * (그쪽은 묻는 문을 **지나야** 한다), 이 창은 이미 그 문을 지난 뒤다.
     */
    assert.ok(!wiring.includes("requestSubmit"), `창의 [저장]이 폼 submit 으로 되돌아간다 — ${wiring}`);
  });

  test("🔴 [취소] → **창만 닫는다**. 저장도 나가기도 하지 않는다", () => {
    assert.ok(wiring.includes("onCancel={() => setAskApprovalSave(false)}"), wiring);
    const cancel = wiring.slice(indexOrFail(wiring, "onCancel={"));
    for (const forbidden of ["saveQuote", "updateQuoteAction", "createQuoteAction", "router.", "leaveGuard"]) {
      assert.ok(!cancel.includes(forbidden), `[취소]가 '${forbidden}' 를 부른다 — ${cancel}`);
    }
  });

  test("🔴 적어 둔 값에 손대지 않는다 — 폼은 고친 그대로 남는다", () => {
    /**
     * 🔵 [취소]가 하는 일은 열림 상태 하나를 내리는 것뿐이므로, 칸의 값을 되돌리는
     * 코드가 **있을 자리가 없다.** 그래도 한 번 못 박아 둔다 — 「닫으면서 폼도
     * 원래대로」가 친절해 보여 언젠가 누가 더한다(그러면 고치던 글이 사라진다).
     */
    const wholeDialog = form.slice(
      indexOrFail(form, "<QuoteApprovalSaveConfirmDialog"),
      indexOrFail(form, "<QuoteApprovalSaveConfirmDialog") + 400
    );
    for (const forbidden of ["setItems(", "setBaselineToken", "setQuoteNumber", "router.refresh"]) {
      assert.ok(!wholeDialog.includes(forbidden), `창이 폼의 값을 되돌린다 — ${forbidden}`);
    }
  });
});

describe("🔴 ⑦ 저장 뒤 알림은 **그대로 살아 있다**", () => {
  test("「승인요청이 반려되었습니다」와 「바뀐 내용이 없습니다」 둘 다 남았다", () => {
    /**
     * 🔴 사용자 결정(2026-11-19) — 새 창은 **예고**이고 그 팝업은 **결과**다. 내용이
     * 안 바뀌면 저장 자체가 일어나지 않는데, 예고만 보고 닫으면 무슨 일이 일어났는지
     * 알 수 없다.
     */
    assert.ok(form.includes("<NoticePopup"), "저장 뒤 알림이 사라졌다");
    assert.ok(form.includes("QUOTE_SAVE_NOTICE_LINES[saveNotice]"), "저장 뒤 알림의 글이 사라졌다");
    assert.ok(form.includes('result.outcome === "APPROVAL_AUTO_REJECTED"'), "반려 갈래가 사라졌다");
    assert.ok(form.includes('result.outcome === "UNCHANGED"'), "「안 바뀜」 갈래가 사라졌다");
  });

  test("🔴 예고와 결과는 **다른 창**이다 — 새 창이 저장 뒤 알림을 대신하지 않는다", () => {
    const noticeAt = indexOrFail(form, "<NoticePopup");
    const confirmAt = indexOrFail(form, "<QuoteApprovalSaveConfirmDialog");
    assert.notEqual(noticeAt, confirmAt);
    // 저장 뒤 알림은 서버가 준 낱말로만 열린다 — 폼의 불이 아니다.
    assert.ok(form.includes("{saveNotice !== null && ( <NoticePopup"), "저장 뒤 알림의 조건이 바뀌었다");
  });
});

describe("🔴 ⑧ 「저장 안 된 내용이 있습니다」 창과 겹치는 길", () => {
  test("🔴 그 창의 [저장]은 **이 문을 지난다** — 묻지 않고 저장되지 않는다", () => {
    /**
     * 그 창의 [저장]은 `formRef.current?.requestSubmit()` 이라 폼 submit 을 지나고,
     * 폼 submit 은 곧 위 `handleSubmit` 이다 — 그래서 **창에서 창으로** 이어진다.
     * 🔴 다른 길(저장 함수를 직접 부르기)로 바꾸면 그 길만 묻지 않게 된다.
     */
    assert.ok(form.includes("onSave: () => formRef.current?.requestSubmit(),"), "나가기 창의 [저장] 길이 바뀌었다");
    assert.ok(form.includes("<form ref={formRef} onSubmit={handleSubmit}"), "폼 submit 이 그 문이 아니다");
  });

  test("🔴 그 길에서 [취소]를 누르면 **나가기까지 취소된다**", () => {
    /**
     * 🔴 나가는 일은 **저장이 끝난 뒤 저장 팝업**이 한다(`redirectTo`). 저장이 아예
     * 안 돌면 아무도 주소를 밀지 않으므로, [취소]는 저절로 「나가기도 취소」가 된다.
     * 🔵 **일부러 그 쪽으로 둔다** — 사람이 저장을 그만둔 것이니 적던 자리에 남는 쪽이
     * 안전하다. 🔴 그래서 나가기 장치가 **스스로 주소를 미는 길**이 [저장]에는 없어야
     * 한다(있으면 저장은 안 하고 나가 버려 적던 글이 사라진다).
     */
    const guard = readFileSync(
      new URL("../common/useUnsavedLeaveGuard.ts", import.meta.url),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const saveAndLeave = guard.slice(
      indexOrFail(guard, "saveAndLeave() {"),
      indexOrFail(guard, "historyMode() {")
    );
    assert.ok(saveAndLeave.includes("saveAfterCloseRef.current = true;"), saveAndLeave);
    assert.ok(saveAndLeave.includes("setAsking(false);"), saveAndLeave);
    assert.ok(!saveAndLeave.includes("go()"), `[저장]이 저장과 상관없이 나간다 — ${saveAndLeave}`);
    // 🔴 그 결정을 폼의 주석이 적어 두고 있다 — 다음 사람이 「버그 아닌가」로 읽지 않게.
    assert.ok(
      formRaw.includes("**나가기까지 취소된다**"),
      "겹치는 길에서 무엇이 일어나는지 폼에 적혀 있지 않다"
    );
  });
});
