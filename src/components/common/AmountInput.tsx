"use client";

import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { caretAfterReformat, formatAmountInput, parseAmountInput } from "@/lib/domain/amount-input";

type AmountInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "inputMode" | "type"
> & {
  /** 콤마 없는 값(`"3500000"`). 칸에는 콤마를 붙여 보여 준다. */
  value: string;
  /** 사람이 고친 값 — **콤마 없이** 돌려준다. 합계·저장은 이 값을 그대로 쓴다. */
  onValueChange: (raw: string) => void;
};

/**
 * 금액 입력 칸 — 세 자리마다 콤마를 붙여 보여 준다(2026-09-15 개선 요청).
 *
 * 규칙(무엇을 받고 어떻게 끊는지, 커서를 어디 둘지)은 전부 domain/amount-input.ts
 * 에 있고, 이 부품은 그 결과를 칸에 옮기기만 한다.
 *
 * ── 커서 ────────────────────────────────────────────────────────────────
 * 값을 다시 그리면 브라우저가 커서를 끝으로 보낸다. 그래서 바꾼 뒤 그림이 끝나는
 * 자리(useLayoutEffect)에서 셈해 둔 자리로 되돌린다. 🔴 친 글자가 버려져 **값이
 * 그대로면** React 가 다시 그리지 않아 그 자리가 오지 않는다 — 그때는 다음 프레임에
 * 직접 놓는다(React 가 칸의 글자를 원래 값으로 되돌린 뒤다).
 */
export default function AmountInput({ value, onValueChange, ...rest }: AmountInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const input = inputRef.current;
    if (caret === null || !input) return;
    pendingCaret.current = null;
    if (document.activeElement === input) input.setSelectionRange(caret, caret);
  });

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={formatAmountInput(value)}
      onChange={(event) => {
        const input = event.target;
        const typed = input.value;
        const raw = parseAmountInput(typed);
        const caret = caretAfterReformat(typed, input.selectionStart ?? typed.length, formatAmountInput(raw));
        if (raw === value) {
          requestAnimationFrame(() => {
            if (document.activeElement === input) input.setSelectionRange(caret, caret);
          });
          return;
        }
        pendingCaret.current = caret;
        onValueChange(raw);
      }}
    />
  );
}
