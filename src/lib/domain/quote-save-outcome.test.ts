import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  QUOTE_SAVE_OUTCOMES,
  quoteSaveOutcomeNeedsNotice,
  type QuoteSaveOutcome,
} from "./quote-save-outcome";
import {
  QUOTE_APPROVAL_AUTO_REJECT_REASON,
  QUOTE_APPROVAL_STATUSES,
  isQuoteApprovalAutoRejectedOnEdit,
} from "./quote-approval-rules";
import {
  QUOTE_SAVE_NOTICE_LINES,
  QUOTE_SAVE_NOTICE_TITLES,
} from "@/components/quotes/quote-save-texts";

/**
 * ============================================================================
 * 견적서 [저장]의 결과 낱말과 거기 붙는 말 (2026-10-31)
 * ============================================================================
 * 🔴 여기서 못 박는 것 넷:
 *  1. 갈래는 셋이고, 저절로 닫히는 저장 팝업으로 끝나는 것은 `SAVED` 하나뿐이다.
 *  2. 🔴 **팝업 글자는 사용자가 준 그대로**다 — 「견적서가 수정되었습니다.
 *     승인요청이 반려되었습니다.」
 *  3. 🔴 **이력에 남는 자동 반려 사유와 팝업 글이 다른 글자**다. 같아지면 종
 *     알림의 「사유: …」가 사람이 적은 말처럼 보이고, 받는 쪽에는 「고친 그 사람이
 *     직접 반려했다」로 읽힌다(반려자 칸에 그 사람이 적히기 때문이다).
 *  4. 🔴 **어떤 결재 상태가 자동 반려 대상인가** — 대기 중과 승인됨 둘.
 *     이미 반려된 줄은 건드리지 않는다.
 *
 * 🔵 이 파일은 화면 조각을 그리지 않는다 — 문구 파일은 글자만 들고 있고
 * `import type` 밖에 물지 않는다(그 파일 머리말).
 * ============================================================================
 */

describe("저장 결과 낱말 셋", () => {
  test("🔵 무엇을 재는지 — 갈래가 셋이다", () => {
    assert.deepEqual([...QUOTE_SAVE_OUTCOMES], ["SAVED", "UNCHANGED", "APPROVAL_AUTO_REJECTED"]);
  });

  test("읽고 닫아야 하는 알림이 붙는 것은 `SAVED` 를 뺀 둘이다", () => {
    const needing = QUOTE_SAVE_OUTCOMES.filter((outcome) => quoteSaveOutcomeNeedsNotice(outcome));
    assert.deepEqual([...needing], ["UNCHANGED", "APPROVAL_AUTO_REJECTED"]);
    assert.equal(quoteSaveOutcomeNeedsNotice("SAVED"), false);
  });

  test("🔴 갈래마다 제목과 본문이 **빠짐없이** 있다", () => {
    for (const outcome of QUOTE_SAVE_OUTCOMES) {
      if (!quoteSaveOutcomeNeedsNotice(outcome)) continue;
      assert.ok(QUOTE_SAVE_NOTICE_TITLES[outcome].length > 0, `${outcome} 제목이 비었다`);
      assert.ok(QUOTE_SAVE_NOTICE_LINES[outcome].length > 0, `${outcome} 본문이 비었다`);
    }
  });
});

describe("팝업 글자", () => {
  test("🔴 자동 반려 팝업은 **사용자가 준 글자 그대로**다", () => {
    assert.equal(
      QUOTE_SAVE_NOTICE_LINES.APPROVAL_AUTO_REJECTED,
      "견적서가 수정되었습니다. 승인요청이 반려되었습니다."
    );
  });

  test("안 바뀐 저장의 팝업은 **저장하지 않았다**고 말한다", () => {
    // 🔴 저장 경로가 그때 정말로 한 글자도 쓰지 않는다 — 통합 시험이 값으로 잰다
    //    (mutations/quote-auto-reject-approval.integration.test.ts).
    assert.match(QUOTE_SAVE_NOTICE_LINES.UNCHANGED, /저장하지 않았습니다/);
  });

  test("🔴 이력에 남는 **사유**와 화면 **팝업**은 다른 글자다", () => {
    assert.notEqual(QUOTE_APPROVAL_AUTO_REJECT_REASON, QUOTE_SAVE_NOTICE_LINES.APPROVAL_AUTO_REJECTED);
    assert.notEqual(QUOTE_APPROVAL_AUTO_REJECT_REASON, QUOTE_SAVE_NOTICE_TITLES.APPROVAL_AUTO_REJECTED);
    // 🔵 무엇을 재는지 — 둘 다 비어 있지 않다(빈 글자끼리 견주면 공짜로 통과한다).
    assert.ok(QUOTE_APPROVAL_AUTO_REJECT_REASON.length > 0);
    assert.ok(QUOTE_SAVE_NOTICE_LINES.APPROVAL_AUTO_REJECTED.length > 0);
  });

  test("사유 글자는 **자동**이라는 사실을 적는다 — 사람이 적은 사유와 갈라지는 표시", () => {
    assert.match(QUOTE_APPROVAL_AUTO_REJECT_REASON, /자동/);
  });
});

describe("🔴 어떤 결재가 자동 반려되는가", () => {
  test("대기 중(REQUESTED)과 승인됨(APPROVED) 둘", () => {
    assert.equal(isQuoteApprovalAutoRejectedOnEdit("REQUESTED"), true);
    assert.equal(
      isQuoteApprovalAutoRejectedOnEdit("APPROVED"),
      true,
      "🔴 이미 승인된 건도 반려한다(2026-10-31 사용자 결정)"
    );
  });

  test("이미 반려된 줄은 건드리지 않는다", () => {
    assert.equal(isQuoteApprovalAutoRejectedOnEdit("REJECTED"), false);
  });

  test("🔵 상태 셋을 전부 물었다 — 새 상태가 생기면 이 시험이 먼저 깨진다", () => {
    const answered = QUOTE_APPROVAL_STATUSES.map((status: QuoteApprovalStatusForTest) => [
      status,
      isQuoteApprovalAutoRejectedOnEdit(status),
    ]);
    assert.deepEqual(answered, [
      ["REQUESTED", true],
      ["APPROVED", true],
      ["REJECTED", false],
    ]);
  });
});

/** 위 한 줄의 매개변수 형 — 목록의 원소 형 그대로다. */
type QuoteApprovalStatusForTest = (typeof QUOTE_APPROVAL_STATUSES)[number];

/** 낱말 형이 실제로 좁혀져 있는지 — 컴파일로 확인한다(돌지 않는 코드다). */
const _compileTimeOnly: QuoteSaveOutcome = "UNCHANGED";
void _compileTimeOnly;
