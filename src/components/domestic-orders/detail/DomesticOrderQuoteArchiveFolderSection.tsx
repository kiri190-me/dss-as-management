"use client";

import { useEffect, useState } from "react";

import {
  QuoteArchiveFolderSectionView,
  quoteArchiveFolderSectionTitle,
  readQuoteArchiveFolderEntriesAnswer,
  type QuoteArchiveFolderSectionState,
} from "@/components/quotes/QuoteArchiveFolderSection";
import {
  DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT,
  domesticOrderQuoteArchiveNoDateText,
} from "@/lib/domain/domestic-order-quote-archive";

/**
 * ============================================================================
 * 기타건 「견적서」 탭의 **공유폴더 구역** — 시스템 견적서가 없는 줄 (2026-11-06)
 * ============================================================================
 * 기타건(내자 정리 한 줄)에 시스템 견적서가 없으면 **내자 정리에 적힌 견적서번호**로
 * 공유폴더를 찾아 그 안을 보여 준다(사용자 결정 2026-11-06 — 「내자정리에 적힌 견적서
 * 번호로 [견적서]탭의 공유폴더를 찾아서 띄워줘」). 시스템 견적서가 있는 줄은 이 구역을
 * 쓰지 않는다 — 그 줄은 수리 건 탭과 **똑같이** 견적서 id 로 부르는 구역
 * (components/quotes/QuoteArchiveFolderSection)이 선다.
 *
 * ── 🔴 **그리는 일은 한 벌이다** — 베끼지 않았다 ──────────────────────────
 * 상자 · 표 · 상태별 문장 · 줄의 [열기] · 맨 아래 [폴더 열기]는 전부 견적서 쪽 구역의
 * `QuoteArchiveFolderSectionView` 를 **그대로 그린다.** 두 벌을 만들면 「폴더가 비어
 * 있습니다」와 「맞는 폴더가 여럿입니다」가 두 화면에서 갈라지는 날이 온다. 여기 있는 것은
 * **다른 통로를 부르는 일**과 그 통로에만 있는 **상태 둘**뿐이다.
 *
 * ── 🔴 통로가 받는 것은 **내자 줄의 id** 다 ───────────────────────────────
 * 견적서번호를 화면에서 실어 보내지 않는다 — 그러면 내자 정리를 볼 수 있는 사람이 아무
 * 번호나 넣어 **남의 폴더**를 들여다볼 수 있다. 번호는 서버가 그 줄에서 꺼낸다
 * (api/domestic-orders/[id]/quote-archive-folder/entries · domain/domestic-order-quote-archive.ts).
 * 🔴 아래 `label` 은 **머리에 적는 글자일 뿐** 찾기에 쓰이지 않는다(바꿔도 다른 폴더가
 * 열리지 않는다).
 *
 * ── 🔴 **번호로 거르지 않는다** ───────────────────────────────────────────
 * 폴더 전체가 보인다 — 수리 건 「견적서」 탭과 같은 결이다(그쪽도 본 번호 단위 구역이라
 * 거르지 않는다). 기타건은 그 번호 하나가 곧 그 폴더이고, 사람이 손으로 넣어 둔 서류
 * (`참고자료.pdf`)가 숨으면 「파일이 없어졌다」로 읽힌다. 거르는 길은 결재 탭의 것이다.
 *
 * ── 🔴 이 구역에만 있는 상태 둘 ───────────────────────────────────────────
 *  · `no-quote-number` — 줄에 견적서번호가 없다
 *  · `no-quote-date`   — 번호는 있는데 연도 폴더를 정할 수 없다(견적발행일이 비었고 번호에도
 *                        연도가 없다)
 * 둘 다 **공유폴더를 보지 않았다**는 뜻이라 「없습니다」가 아니라 **차분한 한 줄**이다
 * (이웃 발주서 구역의 `no-order-date` 와 같은 결). 🔴 글자는 탭 페이지가 쓰는 것과 **같은
 * 한 벌**이다(domain/domestic-order-quote-archive.ts) — 같은 상황에서 두 자리가 다른 말을
 * 하지 않게.
 *
 * 🔴 **정상 경로에서는 이 둘이 오지 않는다** — 탭 페이지가 같은 순수 함수로 미리 가려
 * 그때는 구역 대신 안내 상자를 세운다. 그래도 받는 까닭은 통로가 그 상태를 낼 수 있기
 * 때문이다(화면이 뜬 뒤 그 줄의 번호가 지워지면 실제로 온다). 모르는 상태를 「읽지
 * 못했습니다」로 바꿔 말하지 않는다.
 *
 * ── 🔴 서버 컴포넌트에서 읽지 않는다 ─────────────────────────────────────
 * 탭이 뜰 때 공유폴더를 읽으면 **NAS 가 느리거나 꺼진 날 탭 자체가 안 뜬다.** 화면이 뜬 뒤
 * 여기서 따로 통로를 부른다 — 이 구역만 「불러오는 중…」 → 「읽지 못했습니다」가 된다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ──────────────────────────────────────
 * fetch 를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다
 * (domestic-order-quote-tab-screens.test.tsx). 🔴 통로를 한 번 부르는 얇은 함수는 이
 * 저장소의 공유폴더 구역들이 각자 제 것을 두는 그 모양 그대로다(견적서 · 지난 견적서 ·
 * 발주서 구역) — 주소와 상태가 구역마다 다르기 때문이다.
 * ============================================================================
 */

/** 목록 통로의 주소. 🔴 **번호를 싣는 칸이 없다** — 받는 것은 내자 줄의 id 하나다. */
export function domesticOrderQuoteArchiveFolderEntriesUrl(domesticOrderId: string): string {
  return `/api/domestic-orders/${encodeURIComponent(domesticOrderId)}/quote-archive-folder/entries`;
}

// ── 값 ───────────────────────────────────────────────────────────────────

export type DomesticOrderQuoteArchiveFolderSectionState =
  | QuoteArchiveFolderSectionState
  /** 🔴 줄에 견적서번호가 없다 — 공유폴더를 **보지 않았다**. */
  | { kind: "no-quote-number" }
  /** 🔴 번호는 있는데 연도 폴더를 정할 수 없다 — 역시 **보지 않았다**. */
  | { kind: "no-quote-date" };

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 🔴 **이 통로에만 있는 상태 둘을 먼저 보고**, 나머지는 견적서 쪽 읽기에 그대로 맡긴다 —
 * 줄 · 경로 · 잘림을 읽는 규칙을 두 벌로 두지 않는다. 모양이 다르면 null 이다.
 */
export function readDomesticOrderQuoteArchiveFolderAnswer(
  payload: unknown
): DomesticOrderQuoteArchiveFolderSectionState | null {
  if (isRecord(payload)) {
    if (payload.status === "no-quote-number") return { kind: "no-quote-number" };
    if (payload.status === "no-quote-date") return { kind: "no-quote-date" };
  }
  return readQuoteArchiveFolderEntriesAnswer(payload);
}

type EntriesResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type DomesticOrderQuoteArchiveFolderEntriesFetch = (url: string) => Promise<EntriesResponse>;

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: EntriesResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

/**
 * 통로를 한 번 부른다. **던지지 않는다** — 무슨 일이 나도 `failed` 한 상태로 끝난다.
 * 이 구역이 실패해도 같은 화면의 다른 것은 아무 영향을 받지 않는다.
 */
export async function loadDomesticOrderQuoteArchiveFolderEntries(
  domesticOrderId: string,
  fetchImpl: DomesticOrderQuoteArchiveFolderEntriesFetch = (url) => fetch(url)
): Promise<DomesticOrderQuoteArchiveFolderSectionState> {
  let response: EntriesResponse;
  try {
    response = await fetchImpl(domesticOrderQuoteArchiveFolderEntriesUrl(domesticOrderId));
  } catch {
    return { kind: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { kind: "failed", reason: await failureReason(response) };
  const answer = readDomesticOrderQuoteArchiveFolderAnswer(await response.json().catch(() => null));
  return answer ?? { kind: "failed", reason: UNREADABLE_RESPONSE_REASON };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

/** 견적서 쪽 구역이 차분한 줄에 쓰는 것과 같은 모양이다(경고색이 아니다). */
const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";

/**
 * 상태 하나를 그린다. 🔴 이 파일이 **스스로 그리는 것은 상태 둘뿐**이고, 나머지는 견적서 쪽
 * 구역이 그대로 그린다(`disabled` 면 그쪽이 아무것도 그리지 않는다).
 * 상태를 직접 넣어 그려 볼 수 있게 따로 두었다(통로 · 네트워크 없이 시험한다).
 */
export function DomesticOrderQuoteArchiveFolderSectionView({
  state,
  label = "",
}: {
  state: DomesticOrderQuoteArchiveFolderSectionState;
  /** 🔴 머리에 적는 **내자 정리의 견적서번호**. 찾기에는 쓰이지 않는다(머리말). */
  label?: string;
}) {
  if (state.kind === "no-quote-number" || state.kind === "no-quote-date") {
    const title = quoteArchiveFolderSectionTitle(label);
    return (
      <section
        // 🔴 `aria-labelledby` 가 아니라 `aria-label` 이다 — 견적서 쪽 구역과 같은 규율
        //    (한 화면에 구역이 여럿 설 수 있어 같은 id 를 여러 번 내지 않는다).
        aria-label={title}
        data-domestic-order-quote-archive-folder-section=""
        className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {/* 🔴 「없습니다」가 아니라 **아직 보지 않았다**는 차분한 한 줄이다. */}
        <p className={MUTED_CLASS}>
          {state.kind === "no-quote-number"
            ? DOMESTIC_ORDER_QUOTE_ARCHIVE_NO_NUMBER_TEXT
            : domesticOrderQuoteArchiveNoDateText(label)}
        </p>
      </section>
    );
  }

  // 🔴 번호 칸을 주지 않는다 — 폴더 전체가 보인다(머리말 「번호로 거르지 않는다」).
  return <QuoteArchiveFolderSectionView state={state} label={label} />;
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 *
 * 받은 답은 **어느 줄의 것인지와 함께** 든다 — 그래야 다른 줄로 넘어갔을 때 지난 폴더의
 * 목록이 잠깐 비치지 않는다(견적서 쪽 구역과 같은 모양이다).
 */
export default function DomesticOrderQuoteArchiveFolderSection({
  domesticOrderId,
  label = "",
}: {
  domesticOrderId: string;
  label?: string;
}) {
  const [answer, setAnswer] = useState<{
    domesticOrderId: string;
    state: DomesticOrderQuoteArchiveFolderSectionState;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDomesticOrderQuoteArchiveFolderEntries(domesticOrderId).then((state) => {
      if (!cancelled) setAnswer({ domesticOrderId, state });
    });
    return () => {
      cancelled = true;
    };
  }, [domesticOrderId]);

  const state: DomesticOrderQuoteArchiveFolderSectionState =
    answer !== null && answer.domesticOrderId === domesticOrderId ? answer.state : { kind: "loading" };

  return <DomesticOrderQuoteArchiveFolderSectionView state={state} label={label} />;
}
