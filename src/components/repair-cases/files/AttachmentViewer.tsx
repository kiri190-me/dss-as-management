"use client";

import { useEffect, useRef, useState } from "react";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";

/**
 * ============================================================================
 * 사진 크게 보기 — 목록에서 누르면 열리는 화면
 * ============================================================================
 * 썸네일로는 파형의 눈금도, 외관의 흠집도 확인할 수 없다. 확인하려고 찍은
 * 사진이므로 **크게 볼 수 있어야 찍은 뜻이 산다.**
 *
 * ── 받아 보지 않고 화면에서 본다. 다만 **원본**이다 ──────────────────────
 * 주소는 `?view=full`이다. 목록의 썸네일이 쓰는 `?view=thumb`과 갈라 둔 이유가
 * 실제로 겪은 사고다 — 미리보기를 도입하자 크게 보기까지 480px 썸네일을 보여
 * 주게 되었다. 파형의 눈금을 확인하려고 여는 화면인데 확인할 수 없는 해상도가
 * 된 것이다.
 *
 * 두 주소 모두 **감사 로그를 남기지 않는다** — 화면에서 보는 것과 파일을
 * 가져가는 것은 다른 일이고, 기록해야 하는 것은 뒤쪽이다(라우트 주석 참조).
 *
 * ── 앞뒤로 넘긴다 ────────────────────────────────────────────────────────
 * 사진은 한 장만 보는 일이 드물다. 한 건에 여러 장을 찍어 두고 비교하므로,
 * 열고 닫기를 반복하지 않게 좌우로 넘길 수 있어야 한다. 폰에서는 손가락으로
 * 밀어서, PC에서는 방향키와 화살표 버튼으로 넘긴다.
 *
 * 넘길 수 있는 것은 **화면에서 볼 수 있는 형식뿐**이다. 압축 파일 사이를
 * 지나가게 두면 넘기다 빈 화면을 만난다 — 부르는 쪽이 사진만 걸러 넘긴다.
 * ============================================================================
 */

type AttachmentViewerProps = {
  /** 화면에서 볼 수 있는 것들만. 이 사이를 좌우로 오간다. */
  items: RepairCaseAttachmentListItem[];
  /** 처음 보여 줄 항목의 자리. */
  initialIndex: number;
  onClose: () => void;
  /** 지금 보고 있는 사진을 줄여서 받는다. 부모가 창을 띄운다. */
  onShrinkDownload?: (item: RepairCaseAttachmentListItem) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AttachmentViewer({
  items,
  initialIndex,
  onClose,
  onShrinkDownload,
}: AttachmentViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  /** 손가락이 닿기 시작한 가로 위치. 밀어서 넘기는 것을 재려고 들고 있다. */
  const touchStartX = useRef<number | null>(null);

  const current = items[index];

  // 키보드로 넘기고 닫는다. PC에서 여러 장을 훑을 때 마우스를 옮기지 않아도
  // 되고, Escape는 겹쳐 뜬 화면을 닫는 일반적인 약속이다.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") setIndex((value) => Math.min(value + 1, items.length - 1));
      else if (event.key === "ArrowLeft") setIndex((value) => Math.max(value - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items.length, onClose]);

  // 뒤 페이지가 스크롤되지 않게 한다 — 사진을 보며 손가락을 끌면 뒤 목록이
  // 밀려, 닫았을 때 엉뚱한 자리에 가 있다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!current) return null;

  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;

  function onTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? start) - start;
    // 60px은 "밀었다"와 "누르다 손이 조금 움직였다"를 가르는 선이다. 더 작게
    // 잡으면 사진을 보려고 누른 것이 넘김으로 읽힌다.
    if (delta > 60) setIndex((value) => Math.max(value - 1, 0));
    else if (delta < -60) setIndex((value) => Math.min(value + 1, items.length - 1));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${current.originalFileName} 크게 보기`}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* 위쪽 — 이름과 자리, 닫기 */}
      <div className="flex shrink-0 items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-6 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{current.originalFileName}</p>
          <p className="text-xs text-white/70 tabular-nums">
            {index + 1} / {items.length} · {formatBytes(current.fileSize)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white"
        >
          ×
        </button>
      </div>

      {/* 사진 — 남는 공간을 전부 쓴다. object-contain이라 잘리지 않는다. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          // key를 주어 넘길 때마다 새로 그리게 한다 — 안 그러면 앞 사진이
          // 남아 있다가 바뀌어 무엇을 보고 있는지 잠깐 헷갈린다.
          key={current.id}
          src={`/api/attachments/${encodeURIComponent(current.id)}/download?view=full`}
          alt={current.originalFileName}
          className="max-h-full max-w-full object-contain"
        />

        {hasPrevious && (
          <button
            type="button"
            onClick={() => setIndex((value) => Math.max(value - 1, 0))}
            aria-label="이전 사진"
            className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white"
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={() => setIndex((value) => Math.min(value + 1, items.length - 1))}
            aria-label="다음 사진"
            className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white"
          >
            ›
          </button>
        )}
      </div>

      {/* 아래쪽 — 분류·설명과 내려받기 */}
      <div className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-6">
        <p className="min-w-0 truncate text-xs text-white/80">
          {current.description ?? ""}
        </p>
        {/*
          평범한 링크다(view 값이 없다). 이쪽이 실제로 파일을 가져가는
          행위이고, 그래서 이 경로만 감사 로그를 남긴다.
        */}
        <div className="flex shrink-0 items-center gap-2">
          {onShrinkDownload && (
            <button
              type="button"
              onClick={() => onShrinkDownload(current)}
              className="rounded-md bg-white/15 px-3 py-2 text-sm font-medium text-white"
            >
              줄여서 받기
            </button>
          )}
          <a
            href={`/api/attachments/${encodeURIComponent(current.id)}/download`}
            className="rounded-md bg-white/15 px-3 py-2 text-sm font-medium text-white"
          >
            내려받기
          </a>
        </div>
      </div>

      {items.length > 1 && (
        <p className="pb-[env(safe-area-inset-bottom)] text-center text-[11px] text-white/40">
          좌우로 밀거나 방향키로 넘길 수 있습니다
        </p>
      )}
    </div>
  );
}
