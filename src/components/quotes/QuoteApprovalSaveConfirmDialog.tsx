"use client";

import { useEffect, useId, useRef } from "react";

/**
 * ============================================================================
 * 🔴 **결재가 올라가 있는 견적서를 고쳐 저장할 때 먼저 묻는 창** (2026-11-19)
 * ============================================================================
 * 사용자 요구: 「[견적서] 이미 승인이 끝난 건에 들어가서 내용을 고친 다음에 [저장]을
 * 누르면 팝업이 뜨고 그 아래에는 [저장]/[취소]가 뜨게 해주고, [취소]를 누르면 저장이
 * 안된 채로 팝업이 꺼지도록 해줘.」
 *
 * ── 🔴 무엇을 **막는** 창이 아니다 ──────────────────────────────────────
 * 저장은 지금까지와 똑같이 된다. 달라지는 것은 **누르기 전에 한 번 더 묻는 것**뿐이다.
 * 2026-10-31 부터 견적서를 고쳐 저장하면 올라가 있던 결재가 자동으로 반려되는데
 * (mutations/quote-approval-auto-reject.ts), 지금까지 그 사실은 **저장이 끝난 뒤에야**
 * 알 수 있었다. 이 창은 그것을 **미리** 알린다. 그러니 「결재가 발행·수정을 막지
 * 않는다」(2026-09-18 사용자 결정)는 그대로다 — 여기서 닫히는 문은 없다.
 *
 * 🔴 **저장 뒤의 알림은 그대로 남는다**(사용자 결정 2026-11-19). 이 창은 「될 수
 * 있다」는 **예고**이고 그쪽은 「됐다」는 **결과**다 — 내용이 한 글자도 안 바뀌면 저장
 * 자체가 일어나지 않아 반려도 없는데, 그때 「바뀐 내용이 없습니다」로 알려 주는 것이
 * 그쪽이다(quote-save-texts.ts).
 *
 * ── 🔴 공용 창(common/UnsavedLeaveConfirmDialog)과 왜 따로인가 ───────────
 * 이 저장소의 관례는 「확인 창은 화면마다 제 것을 만든다」이고(그 파일 15~23줄),
 * 저쪽이 공용인 것이 **예외**다 — 견적서와 보고서 두 화면이 한 글자도 다르지 않게
 * 물어야 했기 때문이다. 이 창이 할 말은 견적서에만 있다(보고서에는 결재가 없다).
 * 모양 · 색 · 초점 규칙은 저 창을 그대로 따른다.
 *
 * ── 🔴 빠뜨리면 바로 터지는 셋 ──────────────────────────────────────────
 *  1. **모든 단추가 `type="button"`** — 이 창은 편집 폼의 `<form>` **안**에 그려진다.
 *     빠뜨리면 [취소]가 submit 이 되어, 저장을 그만두려고 누른 손이 그대로 저장한다.
 *  2. **처음 초점은 [취소]** — `showModal()` 은 첫 초점 가능한 것을 잡으므로 그냥 두면
 *     [저장]에 초점이 간다. [저장]을 눌러 이 창을 띄운 손이 Enter 를 한 번 더 치면
 *     읽지도 않고 저장된다(저 공용 창이 같은 까닭으로 같은 자리에 둔다).
 *  3. **Esc 는 [취소]와 같다** — `onCancel` 에서 `preventDefault()` 한 뒤 같은 길로
 *     보낸다. 그래야 부모가 쥔 열림 상태와 창의 열림 여부가 갈라지지 않는다.
 *
 * ── 🔴 문장이 **한 줄로 서야 한다** (2026-11-19 눈 확인) ────────────────
 * 처음엔 공용 창과 같은 `max-w-md` 였는데, 사용자 화면에서 「저장하시겠습니**까?**」의
 * 마지막 한 글자가 둘째 줄로 떨어졌다. 🔴 **문구는 못 줄이므로 창을 넓혀** 푼다.
 *
 * 숫자로 맞춰 둔다(Tailwind 4 의 기본값 — node_modules/tailwindcss/theme.css):
 *
 *   · 글: 한글 **30자** + 공백 7 + `.` `?` 2. `text-sm`(0.875rem = **14px**)에서
 *     한글은 전각이라 30×14 = 420px, 공백·반각을 더해 **≈ 457px**.
 *   · 창: `max-w-xl`(--container-xl = 36rem = **576px**) − `p-4` 좌우(16+16 = 32px)
 *     = 속 **544px**. 457 < 544 라 한 줄로 선다(남는 폭 ≈ 87px).
 *   · 예전 `max-w-md`(28rem = 448px)는 속이 **416px** 이라 41px 가 모자랐다 —
 *     그래서 한 글자가 넘어갔던 것이다. 🔴 좁히지 말 것.
 *
 * 🔴 **`whitespace-nowrap` 을 맨바닥에 두지 않는다.** 폰 폭(360px)에서는 속이
 * 328px 뿐이라 457px 짜리 한 줄이 **화면 밖으로 나간다**(가로 스크롤 · 단추 잘림).
 * 그래서 한 줄은 `sm:` 부터다 — 그 분기점이 40rem(**640px**)이고, 그때 창은 이미
 * 576px 로 자라 있어 속 544px ≥ 457px 다. **켜지는 첫 픽셀부터 안전하다.**
 *
 * 🔵 `max-sm:` 이 아니라 `sm:` 으로 적은 까닭: 접히는 쪽이 **기본값**(아무 클래스도
 * 없음)이라 같은 성질의 클래스가 둘이 되지 않는다 — 둘이면 생성된 CSS 차례가 이겨
 * 어느 쪽이 설지 눈으로 봐야 안다.
 *
 * 🔵 접힐 때는 `break-keep`(word-break: keep-all)이 **낱말 가운데를 자르지 않게**
 * 한다. 눈 확인에서 본 「…습니 / 까?」가 바로 그 기본 동작이었다 — 폰에서도 띄어쓰기
 * 자리에서만 접힌다.
 *
 * 창은 자기 상태를 갖지 않는다 — 열림 여부는 부모가 소유한다.
 * ============================================================================
 */

/**
 * 🔴 **사용자가 글자 그대로 준 문구다**(2026-11-19). 한 글자도 다듬지 말 것 —
 * 「반려된다」가 아니라 **「필요할 수 있습니다」**인 것이 이 기능의 전부다:
 *
 *  · 아직 아무도 안 누른 요청(REQUESTED)도 저장과 함께 반려되지만, 그때는 「다시
 *    승인」이 아니라 「다시 요청」이다.
 *  · 🔵 **내용이 한 글자도 안 바뀌었으면 아무 일도 일어나지 않는다**(서버가
 *    `UNCHANGED` 로 끝낸다). 화면은 저장 전에 그것을 알 길이 없고 — 폼이 쥔
 *    「고쳤는가」는 «화면을 연 때 ↔ 지금»이지 «DB ↔ 지금» 이 아니다
 *    (domain/quote-form-changed.ts 12~18줄) — 그래서 안 바뀐 저장에도 이 창이 뜬다.
 *    「수 있습니다」가 그 경우까지 참으로 만든다.
 */
export const QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE =
  "승인요청이 반려되며 다시 승인이 필요할 수 있습니다. 저장하시겠습니까?";

export default function QuoteApprovalSaveConfirmDialog({
  isOpen,
  onSave,
  onCancel,
}: {
  isOpen: boolean;
  /**
   * [저장] — 🔴 **원래 가던 저장 길을 그대로** 탄다. 이 창은 저장을 따로 짓지 않는다
   * (공용 창의 [저장]이 `requestSubmit()` 하나인 것과 같은 규율).
   */
  onSave: () => void;
  /**
   * [취소] — 🔴 **아무것도 저장하지 않고 창만 닫는다.** 고쳐 둔 값은 한 글자도 건드리지
   * 않는다(폼은 적던 그대로 남는다).
   */
  onCancel: () => void;
}) {
  const messageId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={messageId}
      onCancel={(event) => {
        // Esc 로 닫는 것도 같은 길을 지난다 — 그래야 부모의 상태와 창의 열림 여부가
        // 갈라지지 않는다(공용 창 · 휴지통 창들과 같은 규칙). Esc 는 **그만두기**다.
        event.preventDefault();
        onCancel();
      }}
      /* 🔴 `max-w-xl` 은 **문장 한 줄이 설 폭**이다(위 머리말의 셈 — 속 544px ≥ 457px).
         좁히면 마지막 한 글자가 둘째 줄로 떨어진다. 🔴 `w-full` 이 함께 있어야 폰에서
         창이 화면을 넘지 않는다 — 폭은 `min(100%, 576px)` 이고 `box-sizing: border-box`
         라 안쪽 여백(p-4)이 폭 안에 든다. */
      className="w-full max-w-xl rounded-lg border border-amber-300 bg-white p-4 text-left text-zinc-900 backdrop:bg-black/40 dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      {/* 🔴 머리글을 따로 짓지 않는다 — 사용자가 준 것은 이 한 줄과 단추 둘뿐이고,
          없는 말을 지어 얹으면 고칠 때마다 두 글이 서로 다른 말을 하게 된다.
          그래서 창의 이름표(`aria-labelledby`)도 이 줄을 가리킨다. */}
      {/* 🔴 넓은 화면에서는 **한 줄**(`sm:whitespace-nowrap` — 640px 부터), 폰에서는
          접힌다(맨바닥에는 아무 클래스도 없다 = 기본값 normal). 접힐 때 `break-keep` 이
          낱말 가운데를 자르지 않는다. 셈과 까닭은 전부 위 머리말에 있다. */}
      <p
        id={messageId}
        className="text-sm font-medium break-keep text-amber-700 sm:whitespace-nowrap dark:text-amber-400"
      >
        {QUOTE_APPROVAL_SAVE_CONFIRM_MESSAGE}
      </p>

      {/* 🔴 차례는 사용자가 적은 그대로다 — [저장] · [취소]. */}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onSave}
          className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 dark:bg-primary-100 dark:text-zinc-900"
        >
          저장
        </button>
        {/* 🔴 autoFocus 는 **가장 안전한 쪽**에 둔다(위 머리말 2번). */}
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
      </div>
    </dialog>
  );
}
