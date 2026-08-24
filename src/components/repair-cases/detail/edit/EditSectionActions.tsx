"use client";

import { useState, useSyncExternalStore } from "react";
import type { SectionEditConflictError } from "./useSectionEditSubmit";

export const editInputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
export const editLabelClass = "text-xs text-zinc-500 dark:text-zinc-400";
export const editErrorClass = "mt-1 text-xs text-red-600 dark:text-red-400";

/**
 * 이 브라우저에 복사 기능이 있는가 — 서버 렌더와 어긋나지 않게 알아내는 방법.
 *
 * 렌더 중에 navigator를 직접 만지면 서버에서 터진다(이 파일은 클라이언트
 * 컴포넌트지만 서버에서 한 번 그려진다). useSyncExternalStore에 서버용
 * 스냅샷("없다")과 브라우저용 스냅샷을 따로 주면, 서버·하이드레이션 때는
 * 없는 것으로 그리고 그 뒤에 실제 값으로 한 번 맞춰진다.
 *
 * 값이 도중에 바뀌지 않으므로 구독할 것은 없다(subscribe는 아무것도 하지 않는
 * 해지 함수만 돌려준다). 세 함수 모두 모듈 수준에 두어 렌더마다 새로 만들지
 * 않는다.
 */
const subscribeToNothing = () => () => {};
const hasClipboard = () =>
  typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
const hasNoClipboardOnServer = () => false;

/**
 * 충돌 뒤 "지금 적어 두신 내용" 상자.
 *
 * ── 주 경로는 손으로 선택하는 것이다 ─────────────────────────────────────
 * 이 시스템은 사내망에서 http://192.168.35.215:3000 같은 주소로 접속한다.
 * navigator.clipboard는 **보안 컨텍스트(HTTPS/localhost)에서만 존재한다** —
 * 즉 실제 사용 환경의 폰에서는 아예 undefined다. 복사 버튼 하나만 두면 폰에서
 * 눌러도 아무 일이 일어나지 않고, 막으려던 "내용을 잃는 일"이 그대로 일어난다.
 *
 * 그래서 읽기 전용 textarea가 **항상** 있고(길게 눌러 전체 선택할 수 있다),
 * 복사 버튼은 실제로 쓸 수 있을 때만 덧붙는다(위 hasClipboard 참고).
 *
 * 상자 높이는 rows로 묶어 둔다. 내용이 길어도 상자 안에서 스크롤될 뿐,
 * "최신 정보 다시 불러오기" 버튼이 화면 밖으로 밀려나지 않는다.
 */
function ConflictDraftBox({ text }: { text: string }) {
  const canCopy = useSyncExternalStore(subscribeToNothing, hasClipboard, hasNoClipboardOnServer);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // 복사가 막혀도 따로 알릴 것이 없다 — 아래 상자에서 직접 선택하면 된다.
      setCopied(false);
    }
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
          지금 적어 두신 내용 — 다시 불러오면 사라집니다. 먼저 챙겨 두세요.
        </p>
        {canCopy && (
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900"
          >
            {copied ? "복사됨" : "복사"}
          </button>
        )}
      </div>
      <textarea
        readOnly
        value={text}
        rows={6}
        aria-label="지금 적어 두신 내용"
        onFocus={(e) => e.currentTarget.select()}
        className="mt-2 max-h-48 w-full resize-y overflow-y-auto rounded-md border border-amber-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-amber-900 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
        상자를 눌러(폰에서는 길게 눌러) 전체 선택한 뒤 복사하실 수 있습니다.
      </p>
    </div>
  );
}

/**
 * Shared Save/Cancel row + error/conflict display for all three section
 * edit forms. On CONFLICT (isConflict=true), the Save/Cancel pair is
 * replaced entirely by a single "최신 정보 다시 불러오기" action — the form
 * is frozen, matching the requirement that a stale form never allows a
 * further save attempt.
 *
 * 그 위에 "지금 적어 두신 내용" 상자만 얹었다(ConflictDraftBox). 얼리는 규칙도,
 * 저장·취소가 하나의 버튼으로 바뀌는 것도 그대로다 — 낡은 폼에서 다시 저장이
 * 나가는 길은 여전히 없다.
 */
export default function EditSectionActions({
  isSubmitting,
  isConflict,
  submitError,
  onCancel,
  onReloadAfterConflict,
}: {
  isSubmitting: boolean;
  isConflict: boolean;
  /**
   * 평상시 오류는 메시지 문자열 하나다(고객사·제품모델 편집 폼도 이 모양으로
   * 넘긴다). 수리 건 구간 편집에서 충돌이 났을 때만 useSectionEditSubmit이
   * 메시지와 함께 "사용자가 방금 적어 둔 글"을 실어 보낸다.
   */
  submitError: string | SectionEditConflictError | null;
  onCancel: () => void;
  onReloadAfterConflict: () => void;
}) {
  const message = typeof submitError === "string" ? submitError : (submitError?.message ?? null);
  // 보여 줄 글이 없으면 빈 문자열이다 — 그때는 상자를 아예 그리지 않는다
  // (자유 입력을 하나도 건드리지 않은 저장이었다면 잃을 것이 없고, 빈 상자는
  // 무언가 잘못된 것처럼 보인다).
  const draftText = submitError && typeof submitError !== "string" ? submitError.draftText : "";

  return (
    <div className="mt-3 flex flex-col gap-2">
      {message && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {message}
        </p>
      )}
      {isConflict ? (
        <>
          {draftText !== "" && <ConflictDraftBox text={draftText} />}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onReloadAfterConflict}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              최신 정보 다시 불러오기
            </button>
          </div>
        </>
      ) : (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSubmitting ? "저장 중..." : "저장"}
          </button>
        </div>
      )}
    </div>
  );
}
