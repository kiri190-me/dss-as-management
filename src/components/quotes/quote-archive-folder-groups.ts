import { quoteArchiveBaseNumber } from "@/lib/domain/quote-archive-naming";

/**
 * ============================================================================
 * 한 수리 건의 견적서들을 **공유폴더 하나씩**으로 묶는다 (순수 — 파일시스템 없음)
 * ============================================================================
 * 수리 건 하나에 견적서가 여러 장 달린다. 그런데 공유폴더의 폴더를 가르는 것은 견적서
 * 번호 전체가 아니라 **본 번호**다(domain/quote-archive-naming.ts 의
 * quoteArchiveBaseNumber — 가지 번호 한 겹만 뗀다). 실제 화면의 예:
 *
 *   DSS 2026-078-3 …
 *   DSS 2026-078-1 …
 *   DSS 2026-078   …     ← 세 장이지만 본 번호는 하나다 → **폴더도 하나다**
 *
 * 그래서 「견적서」 탭이 공유폴더 구역을 그릴 때 장 수만큼 그리면 **같은 폴더를 세 번**
 * 보여 주고 NAS 도 세 번 때린다. 이 함수가 본 번호로 묶어 **폴더 수만큼**만 남긴다.
 *
 * 🔴 **본 번호를 새로 짓지 않는다** — 폴더를 찾는 쪽(storage/quote-archive.ts)이 쓰는 그
 * 함수를 그대로 쓴다. 두 벌이 되면 화면이 묶은 단위와 서버가 찾는 폴더가 갈라진다.
 *
 * ── 대표를 어떻게 고르는가 ───────────────────────────────────────────────
 * 통로는 견적서 id 하나로 부른다(그 견적서의 **발행일자**가 연도 폴더를 정한다). 그래서
 * 본 번호마다 한 장을 대표로 골라야 하는데, **발행일자가 가장 이른 장**을 쓴다 — 폴더는
 * 보통 원본 견적서를 처음 받을 때 그 해 연도 폴더 아래에 서기 때문이다. 날짜가 같으면
 * 받은 차례(목록 순서)의 앞쪽이다.
 *  · 남는 구멍: 원본은 한 번도 받지 않고 **해를 넘겨** 가지 번호만 받은 경우, 폴더는 가지
 *    쪽 연도에 있는데 여기서는 원본의 연도를 본다 — 그때는 `not-found` 가 된다. 폴더가
 *    서는 자리를 바꾸지 않고는 어느 쪽을 골라도 반대쪽이 틀리므로, **흔한 쪽**으로 둔다.
 *
 * ── 묶음의 차례 ─────────────────────────────────────────────────────────
 * **목록에 처음 나온 차례 그대로**다. 목록이 발행일자 내림차순(최근이 위)이므로 구역도
 * 최근 본 번호가 위에 선다 — 바로 위의 견적서 목록과 같은 차례로 읽힌다.
 *
 * ── 🔴 번호가 비면 묶음에서 뺀다 ────────────────────────────────────────
 * 본 번호가 빈 글자면 어느 폴더와도 맞지 않는다(찾기가 `failed` 를 낸다). 「읽지
 * 못했습니다」 상자를 괜히 하나 세우는 대신 **구역을 그리지 않는다.**
 * ============================================================================
 */

/** 묶음 하나 = 공유폴더 하나. */
export type QuoteArchiveFolderGroup = {
  /** 폴더를 가르는 **본 번호**. 🔴 구역의 머리에 적어 어느 폴더인지 알 수 있게 한다. */
  baseNumber: string;
  /** 그 본 번호를 대표하는 견적서 id — 통로를 이 id 로 한 번만 부른다. */
  quoteId: string;
};

/** 묶는 데 필요한 칸만. 목록 줄(QuoteListItem)이 이 모양을 이미 갖고 있다. */
export type QuoteArchiveFolderGroupInput = {
  id: string;
  quoteNumber: string;
  /** 발행일자 `"YYYY-MM-DD"` — 대표를 고르는 데 쓴다(글자 그대로 견주면 날짜 차례다). */
  quoteDate: string;
};

/**
 * 견적서 줄들을 **본 번호마다 하나씩**으로 묶는다. 던지지 않는다.
 * 견적서가 없거나 번호가 전부 비어 있으면 빈 배열이다 — 부르는 쪽은 구역을 안 그린다.
 */
export function groupQuotesByArchiveBaseNumber(
  rows: ReadonlyArray<QuoteArchiveFolderGroupInput>
): QuoteArchiveFolderGroup[] {
  /** 본 번호 → 대표. 넣은 차례가 곧 구역의 차례다(Map 은 넣은 차례를 지킨다). */
  const picked = new Map<string, { quoteId: string; quoteDate: string }>();

  for (const row of rows) {
    if (typeof row?.quoteNumber !== "string" || typeof row.id !== "string" || row.id === "") continue;
    const baseNumber = quoteArchiveBaseNumber(row.quoteNumber);
    // 🔴 번호가 비면 어느 폴더와도 맞지 않는다 — 묶음에서 뺀다.
    if (baseNumber.length === 0) continue;

    const quoteDate = typeof row.quoteDate === "string" ? row.quoteDate : "";
    const before = picked.get(baseNumber);
    // 같은 본 번호면 **발행일자가 더 이른 쪽**이 대표다(머리말 「대표를 어떻게 고르는가」).
    if (before !== undefined && !(quoteDate !== "" && (before.quoteDate === "" || quoteDate < before.quoteDate))) {
      continue;
    }
    picked.set(baseNumber, { quoteId: row.id, quoteDate });
  }

  return [...picked].map(([baseNumber, { quoteId }]) => ({ baseNumber, quoteId }));
}
