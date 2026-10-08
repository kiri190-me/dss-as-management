import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import QuoteListScreen, {
  QUOTE_APPROVED_CHECK_LABEL,
} from "@dss/core/ui/quotes/QuoteListScreen";
import type { QuoteListItem } from "@dss/core/ui/quotes/quote-list-rows";
import {
  approvedQuoteIdsForCurrentContent,
  type QuoteApprovalRowForList,
} from "@/lib/domain/quote-list";
import {
  QUOTE_APPROVAL_STATES,
  resolveQuoteApprovalState,
  type QuoteApprovalState,
} from "@/lib/domain/quote-approval-rules";

/**
 * ============================================================================
 * 견적서 목록의 **결재 승인 체크(✔️)** — 2026-10-08 사용자 요구
 * ============================================================================
 * 「지금 내용으로 결재 승인된 견적서에 체크 표시가 보이게 해 달라.」
 *
 * 🔴 이 시험의 핵심은 **`APPROVED_OUTDATED` 에는 그려지지 않는다** 이다(사용자 결정).
 * 승인을 받은 **뒤에 견적서를 고친** 장이고, 거기에 체크가 남으면 화면이 「승인 완료」
 * 라고 거짓말을 한다 — 그 상태가 존재하는 이유가 그것이다
 * (domain/quote-approval-rules.ts 의 resolveQuoteApprovalState).
 *
 * ── 🔴 글자를 맞춰 보는 시험이 아니다 ───────────────────────────────────
 * 결재 상태 다섯을 **실제 결재 줄로 만들어** 판정에 넣고, 그 답을 그대로 공용 목록
 * 화면에 실어 **렌더한 HTML 로 잰다.** 가운데 어느 한 칸이 끊어지면(판정이 틀리거나,
 * 화면이 칸을 안 보거나, 칸 이름이 어긋나거나) 여기서 드러난다.
 *
 * ⚠️ 정적 렌더로 그려지는 것은 **표**다 — ResponsiveList 의 첫 스냅샷이 「표가
 * 들어간다」이기 때문이다(그 파일의 useTableFitsWithoutOverflow 는 true 로 시작한다).
 * 카드 쪽은 같은 조각을 같은 자리에 걸었는지를 원본에서 함께 본다(맨 아래 묶음) —
 * 이웃 시험(quote-list-screen-source.test.ts)이 슬롯 넷에 대해 하는 것과 같은 방식이다.
 *
 * 🔴 **PO/내자는 지금 그대로여야 한다.** 그 사이트는 이 칸을 아직 싣지 않는다 —
 * 칸을 통째로 빼고 그려서 체크가 **하나도 없는지**를 함께 잰다.
 * ============================================================================
 */

const noopRouter = {
  refresh: () => {},
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
} as unknown as AppRouterInstance;

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const CURRENT_VERSION = 3;
const SUMMARY_LINE = "DSS 2026-077 ICD CFK300FH-IC2 WU8042 1612027 Bias Fwd Drop 발생";

/** 🔴 체크 칸을 **뺀** 한 줄 — PO/내자가 지금 넘기는 모양 그대로다. */
function rowWithoutApprovalField(): QuoteListItem {
  return {
    id: QUOTE_ID,
    kind: "DOMESTIC",
    version: CURRENT_VERSION,
    quoteNumber: "DSS 2026-077",
    quoteDate: "2026-10-08",
    customerName: "ICD",
    modelName: "CFK300FH-IC2",
    lotNumber: "WU8042",
    serialNumber: "1612027",
    faultDescription: "Bias Fwd Drop 발생",
    subject: "RF Generator 수리",
    repairCaseId: null,
    intakeNumber: null,
    summaryLine: SUMMARY_LINE,
    supplyAmount: 1_300_000,
    itemCount: 2,
    isExcelOnly: false,
    hasSignedPdf: false,
    hasExcel: false,
  };
}

/**
 * 그 상태가 **실제로 나오는** 결재 줄. 지어낸 불리언이 아니라 표에 들어 있을 모양
 * 그대로를 만든다 — 아래에서 resolveQuoteApprovalState 로 그 상태가 맞는지 먼저
 * 확인하고 나서 화면에 넘긴다.
 */
function approvalRowsFor(state: QuoteApprovalState): QuoteApprovalRowForList[] {
  const base = {
    quoteId: QUOTE_ID,
    requestedAt: new Date("2026-10-08T01:00:00.000Z"),
  };
  switch (state) {
    case "NOT_REQUESTED":
      return [];
    case "PENDING":
      return [{ ...base, status: "REQUESTED", quoteVersionAtRequest: CURRENT_VERSION }];
    case "APPROVED":
      return [{ ...base, status: "APPROVED", quoteVersionAtRequest: CURRENT_VERSION }];
    case "APPROVED_OUTDATED":
      // 승인은 받았지만 그 뒤에 견적서를 고쳤다 — 요청 시점의 판이 지금 판보다 낮다.
      return [{ ...base, status: "APPROVED", quoteVersionAtRequest: CURRENT_VERSION - 1 }];
    case "REJECTED":
      return [{ ...base, status: "REJECTED", quoteVersionAtRequest: CURRENT_VERSION }];
  }
}

/** 🔴 서버가 하는 일을 그대로 — 결재 줄 → 판정 → 줄에 실리는 값 하나. */
function rowFor(state: QuoteApprovalState): QuoteListItem {
  const approvals = approvalRowsFor(state);
  const latest = approvals[0] ?? null;
  assert.equal(
    resolveQuoteApprovalState(latest, CURRENT_VERSION),
    state,
    `시험이 만든 결재 줄이 ${state} 가 아니다 — 시험 쪽이 틀렸다`
  );
  const approvedIds = approvedQuoteIdsForCurrentContent(approvals, [
    { id: QUOTE_ID, version: CURRENT_VERSION },
  ]);
  return { ...rowWithoutApprovalField(), isApprovedForCurrentContent: approvedIds.has(QUOTE_ID) };
}

function render(row: QuoteListItem): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={noopRouter}>
      <QuoteListScreen
        rows={[row]}
        trashRows={[]}
        canEdit={false}
        canDelete={false}
        trashActions={{
          deleteQuote: async () => ({ ok: true as const }),
          restoreQuote: async () => ({ ok: true as const }),
          permanentlyDeleteQuote: async () => ({ ok: true as const }),
        }}
      />
    </AppRouterContext.Provider>
  );
}

/** 그려진 체크의 개수. 🔴 **뜻이 붙은 것만 센다** — 맨 글자는 체크로 치지 않는다. */
function checkCount(html: string): number {
  return html.split(`aria-label="${QUOTE_APPROVED_CHECK_LABEL}"`).length - 1;
}

describe("🔴 지금 내용 그대로 승인된 견적서에만 체크(✔️)가 그려진다", () => {
  test("체크를 그린 줄도 안 그린 줄도 **줄 자체는 온전히** 그려진다 — 빈 화면으로 통과하지 않게", () => {
    for (const state of QUOTE_APPROVAL_STATES) {
      const html = render(rowFor(state));
      assert.ok(html.includes(SUMMARY_LINE), `${state} — 목록 줄이 아예 그려지지 않았다`);
    }
  });

  test("🔴 APPROVED 에만 체크가 그려진다", () => {
    const html = render(rowFor("APPROVED"));
    assert.equal(checkCount(html), 1, "승인된 장에 체크가 하나 그려져야 한다");
    assert.ok(html.includes("✔️"), "체크 글자가 그려지지 않았다");
  });

  test("🔴 APPROVED_OUTDATED 에는 그려지지 않는다 — 승인 뒤 견적서가 바뀐 장이다", () => {
    const html = render(rowFor("APPROVED_OUTDATED"));
    assert.equal(checkCount(html), 0, "낡은 승인에 체크가 그려졌다 — 화면이 「승인 완료」라고 거짓말을 한다");
    assert.equal(html.includes("✔️"), false, "낡은 승인 줄에 체크 글자가 남아 있다");
  });

  test("🔴 PENDING · REJECTED · NOT_REQUESTED 에도 그려지지 않는다", () => {
    for (const state of ["PENDING", "REJECTED", "NOT_REQUESTED"] as const) {
      const html = render(rowFor(state));
      assert.equal(checkCount(html), 0, `${state} 인 줄에 체크가 그려졌다`);
      assert.equal(html.includes("✔️"), false, `${state} 인 줄에 체크 글자가 그려졌다`);
    }
  });

  test("🔴 값을 안 넘기면 그려지지 않는다 — PO/내자 목록은 지금 그대로다", () => {
    const row = rowWithoutApprovalField();
    assert.equal(
      Object.hasOwn(row, "isApprovedForCurrentContent"),
      false,
      "시험이 쓰는 줄에 이미 칸이 들어 있다 — 「안 넘긴다」를 재지 못한다"
    );
    const html = render(row);
    assert.ok(html.includes(SUMMARY_LINE), "줄이 그려지지 않았다");
    assert.equal(checkCount(html), 0, "값을 안 넘겼는데 체크가 그려졌다");
    assert.equal(html.includes("✔️"), false, "값을 안 넘겼는데 체크 글자가 그려졌다");
  });

  test("🔴 체크에 **뜻**이 붙어 있다 — 눈(title)과 귀(aria-label) 두 곳 모두", () => {
    const html = render(rowFor("APPROVED"));
    assert.ok(html.includes(`title="${QUOTE_APPROVED_CHECK_LABEL}"`), "마우스를 올렸을 때의 설명이 없다");
    assert.ok(html.includes(`aria-label="${QUOTE_APPROVED_CHECK_LABEL}"`), "화면낭독기가 읽을 설명이 없다");
    assert.ok(html.includes('role="img"'), "체크 글자 하나가 그림이라는 표시가 없다");
    // 🔴 「승인된 적이 있다」가 아니라 **「지금 이 내용 그대로」** 라고 말한다.
    assert.ok(QUOTE_APPROVED_CHECK_LABEL.includes("지금 이 내용 그대로"), QUOTE_APPROVED_CHECK_LABEL);
  });
});

/**
 * ============================================================================
 * 자리 — 🔴 **표와 카드 두 곳 모두**, 그리고 파일 딱지 자리를 빌리지 않는다
 * ============================================================================
 * 정적 렌더로는 표만 그려지므로(파일 머리말), 카드 쪽은 이웃 시험과 같은 방식으로
 * 원본을 읽어 본다. 🔴 **읽기만 한다** — 서브모듈의 파일이다.
 * ============================================================================
 */
describe("체크가 서는 자리", () => {
  const repoUrl = new URL("../../../", import.meta.url);
  const screenSource = readFileSync(
    new URL("vendor/dss-core/src/ui/quotes/QuoteListScreen.tsx", repoUrl),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const flat = (source: string) => source.replace(/\s+/g, " ");

  const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
    const start = source.indexOf(startMarker);
    assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
    return source.slice(start, end);
  };

  const tableSource = flat(sliceBetween(screenSource, "function QuoteTable(", "function QuoteCardList("));
  const cardSource = flat(sliceBetween(screenSource, "function QuoteCardList(", "function SummaryLine("));

  test("🔴 표와 카드가 **같은 조각**을 건다 — 창 폭에 따라 체크가 있다 없다 하지 않게", () => {
    for (const [name, source] of [["표", tableSource], ["카드", cardSource]] as const) {
      assert.ok(source.includes("<QuoteApprovedCheck row={row} />"), `${name} 에 체크 조각이 없다`);
    }
    assert.equal(
      flat(screenSource).split("<QuoteApprovedCheck row={row} />").length - 1,
      2,
      "체크를 그리는 곳이 표 · 카드 둘이 아니다"
    );
  });

  test("🔴 파일 딱지 슬롯(renderFileBadges)을 빌려 쓰지 않는다 — 뜻이 다른 자리다", () => {
    // 이 파일의 렌더 시험은 renderFileBadges 를 **한 번도 넘기지 않고** 체크를 본다 —
    // 그 자리를 빌렸다면 위 「APPROVED 에만 체크」가 애초에 통과하지 못한다. 여기서는
    // 조각이 그 슬롯과 **별개의 자리**에 서 있는지만 못 박는다.
    for (const [name, source] of [["표", tableSource], ["카드", cardSource]] as const) {
      assert.ok(source.includes("{renderFileBadges?.(row)}"), `${name} 에서 파일 딱지 슬롯이 사라졌다`);
      assert.ok(
        source.indexOf("<QuoteApprovedCheck row={row} />") < source.indexOf("{renderFileBadges?.(row)}"),
        `${name} 에서 체크가 파일 딱지 자리에 섞였다`
      );
    }
  });

  test("🔴 판정 규칙을 공용 묶음으로 옮기지 않았다 — 넘어가는 것은 답 하나다", () => {
    const code = flat(screenSource);
    for (const forbidden of [
      "APPROVED_OUTDATED",
      "resolveQuoteApprovalState",
      "quoteVersionAtRequest",
      "quote_approvals",
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `공용 화면이 A/S 의 결재 구조를 알기 시작했다: ${forbidden}`
      );
    }
  });
});
