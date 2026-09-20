import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { quoteApprovalStatusEnum } from "@/lib/db/schema";
import {
  QUOTE_APPROVAL_ROUTE_SCOPE,
  QUOTE_APPROVAL_STATUSES,
  isApprovalForCurrentQuote,
  isQuoteApprovalRouteInForce,
  resolveQuoteApprovalState,
  type QuoteApprovalStatus,
} from "./quote-approval-rules";
import {
  SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES,
  SHIPMENT_APPROVAL_ROUTE_SCOPES,
} from "./shipment-approval-route";

/**
 * ============================================================================
 * 견적서 결재의 순수 규칙 — 그리고 🔴 「발행을 막지 않는다」
 * ============================================================================
 * 앞의 두 묶음은 값으로 본다(상태 판정 · 용도 상수). 마지막 묶음은 **원본을
 * 글자로 읽는다** — 지키려는 것이 「어떤 코드가 **없다**」이기 때문이고, 없는
 * 것은 값으로 확인할 방법이 없다.
 *
 * 🔴 마지막 묶음이 이 파일에서 가장 중요하다. 결재 표가 생긴 다음부터는
 * 「승인 안 된 견적서를 발행하게 두면 안 되지 않나」가 누구에게나 자연스러운
 * 생각이 된다. 그것은 **정해진 것**이다(2026-09-18 사용자 결정) — 결재는 기록이고
 * 발행은 막지 않는다. 막아야 할 필요가 생기면 코드를 고치기 전에 사용자에게
 * 먼저 묻는다. 그 결정을 리뷰가 아니라 시험으로 지킨다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

function latest(
  status: QuoteApprovalStatus,
  quoteVersionAtRequest: number
): { status: QuoteApprovalStatus; quoteVersionAtRequest: number } {
  return { status, quoteVersionAtRequest };
}

describe("견적서 결재선의 용도", () => {
  test("QUOTE 하나를 가리키고, 용도 목록 안의 값이다", () => {
    assert.equal(QUOTE_APPROVAL_ROUTE_SCOPE, "QUOTE");
    assert.ok(SHIPMENT_APPROVAL_ROUTE_SCOPES.includes(QUOTE_APPROVAL_ROUTE_SCOPE));
  });

  test("🔴 상태 셋은 표의 enum 과 글자 그대로 같다", () => {
    // 도메인 층은 스키마를 가져오지 않는 것이 이 저장소의 관례라 값이 두 벌이
    // 된다. 갈라지면 화면·조회가 표에 없는 상태를 다루기 시작한다.
    assert.deepEqual([...QUOTE_APPROVAL_STATUSES], [...quoteApprovalStatusEnum.enumValues]);
  });
});

describe("판이 쓰이고 있는가", () => {
  test("판이 없으면 거짓", () => {
    assert.equal(isQuoteApprovalRouteInForce(null), false);
  });

  test("🔴 단계 0개인 판은 판이 없는 것과 같다 — 「절차를 쓰지 않겠다」는 뜻이다", () => {
    assert.equal(isQuoteApprovalRouteInForce({ steps: [] }), false);
  });

  test("단계가 하나라도 있으면 참", () => {
    assert.equal(isQuoteApprovalRouteInForce({ steps: [{ stepOrder: 1 }] }), true);
  });

  test("🔴 빈 절차의 안내 문장이 「승인 기록도 남지 않는다」고 말한다", () => {
    // 요청 자체를 거절하기로 한 근거다(mutations/quote-approvals.ts 의
    // ROUTE_NOT_CONFIGURED). 지정 없는 요청 행을 하나 두면 이 문장이 거짓이 된다.
    assert.match(SHIPMENT_APPROVAL_ROUTE_EMPTY_NOTICES.QUOTE, /승인 기록도 남지 않습니다/);
  });
});

describe("이 승인이 지금 내용에 대한 것인가", () => {
  test("판 번호가 같으면 참, 다르면 거짓", () => {
    assert.equal(isApprovalForCurrentQuote(3, 3), true);
    assert.equal(isApprovalForCurrentQuote(3, 4), false);
    // 올라갈 일은 없지만 「같지 않다」가 규칙이지 「작다」가 규칙이 아니다.
    assert.equal(isApprovalForCurrentQuote(5, 4), false);
  });
});

describe("지금 어디까지 왔나", () => {
  test("행이 없으면 NOT_REQUESTED — 표에 저장하는 값이 아니다", () => {
    assert.equal(resolveQuoteApprovalState(null, 1), "NOT_REQUESTED");
  });

  test("가장 최근 행이 REQUESTED 면 PENDING — 판 번호와 무관하다", () => {
    assert.equal(resolveQuoteApprovalState(latest("REQUESTED", 1), 1), "PENDING");
    assert.equal(resolveQuoteApprovalState(latest("REQUESTED", 1), 2), "PENDING");
  });

  test("판 번호가 같은 APPROVED 는 APPROVED", () => {
    assert.equal(resolveQuoteApprovalState(latest("APPROVED", 2), 2), "APPROVED");
  });

  test("🔴 승인 뒤 견적서가 바뀌면 APPROVED_OUTDATED 다 — 낡은 승인을 재사용하지 않는다", () => {
    assert.equal(resolveQuoteApprovalState(latest("APPROVED", 2), 3), "APPROVED_OUTDATED");
  });

  test("반려는 낡았는지 따지지 않는다 — 그때 물린 사실은 그대로다", () => {
    assert.equal(resolveQuoteApprovalState(latest("REJECTED", 2), 2), "REJECTED");
    assert.equal(resolveQuoteApprovalState(latest("REJECTED", 2), 9), "REJECTED");
  });
});

describe("🔴 발행을 막지 않는다 — 발행 통로는 결재 표를 읽지 않는다", () => {
  /**
   * 견적서 파일이 실제로 나가는 길 전부. 여기 있는 어느 파일이든 결재 표를
   * 읽기 시작하면, 그 순간 「결재 전에는 발행 못 함」이 조용히 생긴다.
   */
  const ISSUE_PATH_SOURCES = [
    "src/lib/server/services/quote-issue.ts",
    "src/app/api/quotes/[id]/issue/route.ts",
    "src/app/api/quotes/[id]/xlsx/route.ts",
    "src/app/api/quotes/[id]/xlsx/download-source.ts",
    "src/lib/db/mutations/quote-exports.ts",
  ] as const;

  for (const relativePath of ISSUE_PATH_SOURCES) {
    test(`${relativePath} 는 결재를 한 번도 보지 않는다`, () => {
      const source = read(relativePath);
      for (const forbidden of [
        "quoteApprovals",
        "quote_approvals",
        "quote-approvals",
        "resolveQuoteApprovalState",
        "getQuoteApprovalProgress",
      ]) {
        assert.ok(
          !source.includes(forbidden),
          `발행 통로가 결재를 보기 시작했다(${forbidden}). 발행은 결재를 기다리지 않는다는 것이 2026-09-18 사용자 결정이다 — 막아야 한다면 코드를 고치기 전에 먼저 물을 것.`
        );
      }
    });
  }
});
