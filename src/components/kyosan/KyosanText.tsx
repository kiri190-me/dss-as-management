import { Fragment } from "react";

import {
  viewKyosanMemoLines,
  viewKyosanText,
  type KyosanMemoLine,
  type KyosanTextView,
} from "@/lib/kyosan/report-terms";

/**
 * ============================================================================
 * 연락서에서 온 글자를 그리는 **공용 조각** (2026-09-22)
 * ============================================================================
 * 원래 `excel-imports/KyosanReportImportParts.tsx` 안에만 있던 `KyosanText` 를
 * 여기로 **옮겼다**(베낀 것이 아니다 — 두 벌이 되면 한쪽만 고쳐지는 날이 온다).
 * 쓰는 곳은 셋이다:
 *
 *   · 연락서 넣기 **미리보기**  — 넣기 전에 눈으로 읽는 자리
 *   · 수리 건 상세 > **작업 기록** — 이미 넣은 덩어리를 읽는 자리
 *   · 수리 건 상세 > **고장 및 서비스 정보** — 같은 덩어리가 요약으로 비치는 자리
 *
 * ── 🔴 저장된 글자는 한 글자도 바뀌지 않는다 ────────────────────────
 * 번역은 **보여 주는 층에서만** 한다(사용자 결정 2026-09-22). DB 에 들어간 글자는
 * 연락서 원문 그대로이고(`lib/kyosan/report-detail-values.ts` 의 「원문을 고치지
 * 않는다」), 이 조각은 그 위에 한글을 곁들일 뿐이다. 그래서 원문을 **언제나 함께
 * 보여 준다** — 번역이 틀렸을 때 되짚을 수 있어야 한다.
 *
 * ── 🔴 사람이 고치는 자리에는 쓰지 않는다 ───────────────────────────
 * 편집 폼(`detail/edit/FaultServiceEditForm.tsx`)에는 걸지 않는다. 고칠 글자가
 * 화면에 보이는 것과 달라지면 사람이 무엇을 고치는지 모르게 된다.
 *
 * ── 그리는 규칙 ─────────────────────────────────────────────────────
 *   · 양식의 고정 보기(原因 열 · 処置 넷 · `交換無し`) → 한글을 보이고 원문을 옆에 작게
 *   · 사람이 손으로 적은 일본어                        → 원문 그대로 + 「일본어 원문」 표시
 *   · 그 밖(한글 · 영문 · 숫자)                        → 그대로
 * ============================================================================
 */

/**
 * 미리보기 표가 예전부터 쓰던 글자 색. 🔴 **기본값을 바꾸지 마라** — 미리보기의
 * 마크업이 조각을 옮기기 전과 같아야 한다.
 */
const DEFAULT_TONE_CLASS = "text-zinc-800 dark:text-zinc-200";

const ORIGINAL_CLASS = "ml-1.5 text-xs text-zinc-400 dark:text-zinc-500";
const JAPANESE_BADGE_CLASS =
  "ml-1.5 whitespace-nowrap rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";

/**
 * 글자 색을 입히는 자리. `null` 이면 **감싸는 곳의 색을 그대로 물려받는다** —
 * 무효 처리된 작업 기록의 회색·취소선처럼 바깥이 정한 모양을 덮으면 안 되는
 * 자리가 있다(`WorkRecordItem`).
 */
function Tone({ className, children }: { className: string | null; children: string }) {
  if (className === null) return <>{children}</>;
  return <span className={className}>{children}</span>;
}

/** 이미 계산이 끝난 한 줄을 그린다. 계산은 `lib/kyosan/report-terms.ts` 가 한다. */
function KyosanViewedText({
  view,
  toneClassName,
}: {
  view: KyosanTextView;
  toneClassName: string | null;
}) {
  if (view.korean !== null) {
    return (
      <span data-role="kyosan-text" data-translated="true">
        <Tone className={toneClassName}>{view.korean}</Tone>
        <span data-role="kyosan-text-original" className={ORIGINAL_CLASS}>
          {`(${view.original})`}
        </span>
      </span>
    );
  }

  return (
    <span data-role="kyosan-text" data-japanese={view.isJapaneseOriginal ? "true" : undefined}>
      <Tone className={toneClassName}>{view.original}</Tone>
      {view.isJapaneseOriginal ? (
        <span data-role="kyosan-text-japanese-badge" className={JAPANESE_BADGE_CLASS}>
          일본어 원문
        </span>
      ) : null}
    </span>
  );
}

/**
 * 연락서에서 온 글자 **한 줄**. 미리보기 표의 칸 하나가 이것이다.
 *
 * `toneClassName` 을 `null` 로 주면 글자 색을 감싸는 곳에 맡긴다.
 */
export function KyosanText({
  value,
  toneClassName = DEFAULT_TONE_CLASS,
}: {
  value: string;
  toneClassName?: string | null;
}) {
  return <KyosanViewedText view={viewKyosanText(value)} toneClassName={toneClassName} />;
}

function KyosanMemoLineText({ line }: { line: KyosanMemoLine }) {
  // 빈 줄은 줄바꿈만으로 그려진다(아래 `KyosanMemoText` 가 줄 사이에 끼운다).
  if (line.kind === "blank") return null;
  // 🔴 머리글은 **우리가 붙인 한글 이름**이다 — 번역하지도 표시를 붙이지도 않는다.
  if (line.kind === "heading") return <span data-role="kyosan-memo-heading">{line.text}</span>;
  // 🔴 색은 감싸는 곳(무효 처리된 기록의 회색·취소선 등)을 따른다.
  return <KyosanViewedText view={line.view} toneClassName={null} />;
}

/**
 * 연락서에서 온 **여러 줄 덩어리**. 작업 기록 `memo` 한 칸에 여러 항목이 한
 * 덩어리로 들어가므로, 통째로 사전에 태우면 아무것도 한글이 되지 않는다 —
 * 줄로 갈라 줄마다 태운다(`viewKyosanMemoLines`).
 *
 * 🔴 **감싸는 쪽에 `whitespace-pre-wrap` 이 있어야 한다.** 줄바꿈과 앞뒤 공백을
 * 글자 그대로 흘려보내므로, 없으면 여러 줄이 한 줄로 뭉개진다.
 *
 * 🔴 바깥 요소를 만들지 않는다 — 쓰는 쪽이 이미 `<p>` · `<dd>` 를 갖고 있고,
 * 그쪽 글자 크기·색·취소선을 그대로 물려받아야 한다.
 */
export function KyosanMemoText({ value }: { value: string }) {
  const lines = viewKyosanMemoLines(value);
  return (
    <>
      {lines.map((line, index) => (
        // 같은 글자가 여러 줄에 나올 수 있어 차례가 유일한 열쇠다. 이 목록은
        // 다시 늘어서지 않으므로(한 번 그리고 끝) 차례를 써도 안전하다.
        <Fragment key={index}>
          {index === 0 ? null : "\n"}
          <KyosanMemoLineText line={line} />
        </Fragment>
      ))}
    </>
  );
}
