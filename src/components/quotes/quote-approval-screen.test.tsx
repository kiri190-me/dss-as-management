import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import QuoteEditTabs from "./QuoteEditTabs";
import QuoteApprovalStatusBadge from "./QuoteApprovalStatusBadge";
import QuoteApprovalHistory from "./QuoteApprovalHistory";
import QuoteApprovalDialog from "./QuoteApprovalDialog";
/**
 * 🔴 이 import 자체가 시험이다 — 문구를 모아 둔 파일이 무언가를 물기 시작하면
 * (`server-only` 사슬 끝, "use client", 화면 라이브러리) 이 시험 파일이
 * **여기서** 죽는다. 그 파일 머리말이 약속한 그대로다.
 */
import {
  QUOTE_APPROVAL_DOES_NOT_BLOCK_ISSUE_NOTICE,
  QUOTE_APPROVAL_EMPTY_HISTORY_TEXT,
  QUOTE_APPROVAL_OUTDATED_NOTICE,
  QUOTE_APPROVAL_REASON_REQUIRED_MESSAGE,
  QUOTE_APPROVAL_ROUTE_MISSING_NOTICE,
  QUOTE_APPROVAL_STATE_DESCRIPTIONS,
  QUOTE_APPROVAL_STATE_LABELS,
} from "./quote-approval-texts";
import { QUOTE_APPROVAL_STATES } from "@/lib/domain/quote-approval-rules";
import type { QuoteApprovalRecordRow } from "@/lib/db/queries/quote-approvals";
import type { ShipmentApprovalRouteStepList } from "@/lib/db/queries/shipment-approval-routes";

/**
 * ============================================================================
 * [견적서 결재] 탭 — 못 박아 두는 것들
 * ============================================================================
 * 사고가 났을 때 되돌리기 가장 비싼 것부터 넷이다.
 *
 *  1) 🔴 **탭을 바꿔도 편집 폼이 떼어지지 않는다.** 떼어지면 사람이 한참 적어
 *     넣던 품목·금액이 통째로 사라진다. 눈으로는 「탭이 잘 도네」로만 보여서
 *     결함이 오래 숨는다.
 *  2) 🔴 **`APPROVED_OUTDATED` 가 「승인됨」과 다르게 보인다.** 그 상태가 있는
 *     이유가 「승인받은 뒤 금액을 바꿔도 승인이 살아 있는 것처럼 보이는 일」을
 *     막는 것이다.
 *  3) 🔴 **발행 단추가 결재 상태로 잠기지 않는다**(2026-09-18 사용자 결정).
 *  4) 결재선이 없을 때 **무엇을 해야 하는지** 말한다. 반려에는 사유가 필요하다.
 *
 * ── 왜 어떤 것은 렌더하고 어떤 것은 원본을 읽는가 ──────────────────────────
 * QuoteEditTabs·배지·이력·확인 창은 순수해서(타입 말고 실제로 물고 있는 것이
 * 없다) 그대로 렌더해 검사한다. 반대로 QuoteApprovalPanel 은 **서버 액션을 직접
 * import 하는 클라이언트 컴포넌트**라, 그 사슬 끝의 `server-only` 때문에
 * react-server 조건 없이 도는 test:components 에서는 import 자체가 던진다.
 * 그래서 이웃 시험(repair-cases/approval/approval-screen-layout.test.tsx)과 같은
 * 방법으로 원본을 글자로 읽어 확인한다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const tabsSource = read("src/components/quotes/QuoteEditTabs.tsx");
const panelSource = read("src/components/quotes/QuoteApprovalPanel.tsx");
const editFormSource = read("src/components/quotes/QuoteEditForm.tsx");
const issueButtonSource = read("src/components/quotes/QuoteIssueButton.tsx");
const editPageSource = read("src/app/(app)/quotes/[id]/page.tsx");
const newPageSource = read("src/app/(app)/quotes/new/page.tsx");

/** 화면을 그리는 마지막 return 문만 잘라낸다 — 함수 안의 이른 return 은 걸리지 않는다. */
const renderBlock = (source: string) => source.slice(source.indexOf("  return ("));

function approvalRecord(overrides: Partial<QuoteApprovalRecordRow> = {}): QuoteApprovalRecordRow {
  return {
    id: "quote-approval-1",
    status: "REQUESTED",
    requestedByUserId: "user-1",
    requestedByName: "홍길동",
    requestedAt: "2026-09-18T01:00:00.000Z",
    requestReason: "금액 확인 부탁드립니다",
    assignedApproverUserId: null,
    assignedApproverName: null,
    routeId: null,
    routeStepOrder: null,
    decidedByUserId: null,
    decidedByName: null,
    decidedAt: null,
    decisionReason: null,
    // 🔴 기본은 「직접 눌렀다」다 — NULL 이 정상값이고 뜻이 있다(표의 칸 주석).
    // 위임 줄을 재는 시험만 이 둘을 함께 덮어쓴다.
    delegatedFromUserId: null,
    delegatedFromName: null,
    quoteVersionAtRequest: 3,
    ...overrides,
  };
}

/** 판 하나 — 단계 순서는 이름 순서대로 1부터 매긴다. */
function route(routeId: string, approverNames: string[]): ShipmentApprovalRouteStepList {
  return {
    routeId,
    steps: approverNames.map((approverName, index) => ({
      stepOrder: index + 1,
      approverUserId: `approver-${index + 1}`,
      approverName,
    })),
  };
}

describe("🔴 탭을 바꿔도 편집 폼이 떼어지지 않는다", () => {
  const markup = renderToStaticMarkup(
    <QuoteEditTabs editForm={<p>편집폼이있던자리</p>} approvalPanel={<p>결재화면이있던자리</p>} />
  );

  test("첫 화면에서 두 칸이 **동시에** 그려진다 — 감춰진 쪽도 DOM 에 있다", () => {
    assert.ok(markup.includes("편집폼이있던자리"), "편집 폼이 그려지지 않았다");
    assert.ok(
      markup.includes("결재화면이있던자리"),
      "결재 화면이 DOM 에 없다 — 갈라 그리면 탭을 오갈 때 적던 내용이 날아간다"
    );
  });

  test("지금 탭만 보이고 나머지 칸은 hidden 이다", () => {
    assert.match(
      markup,
      /<div id="quote-tab-panel-approval"[^>]*hidden[^>]*>/,
      "안 보이는 칸이 감춰져 있지 않다"
    );
    assert.doesNotMatch(
      markup,
      /<div id="quote-tab-panel-edit"[^>]*hidden[^>]*>/,
      "지금 보고 있는 칸이 감춰져 있다"
    );
  });

  test("🔴 두 칸이 조건 없이 그려진다 — 삼항·&& 로 감싸면 떼어진다", () => {
    const block = renderBlock(tabsSource);
    for (const slot of ["{editForm}", "{approvalPanel}"]) {
      const line = block.split("\n").find((one) => one.includes(slot));
      assert.ok(line, `원본에서 ${slot} 를 찾지 못했다`);
      assert.equal(
        line.trim(),
        slot,
        `${slot} 가 조건 안에 들어갔다 — 탭을 바꾸면 그 컴포넌트가 떼어져 적던 내용이 사라진다`
      );
    }
  });

  test("🔴 감추는 장치가 그대로 있다 — hidden 속성과 class 둘 다", () => {
    const flattened = flat(tabsSource);
    assert.ok(flattened.includes('hidden={tab !== "edit"}'));
    assert.ok(flattened.includes('hidden={tab !== "approval"}'));
    // 브라우저 기본 스타일의 [hidden] 은 배치용 class 하나에 진다 — 실제로
    // 감추는 것은 이 class 다. 둘 중 하나만 남기지 않는다.
    assert.ok(flattened.includes('className={tab === "edit" ? undefined : "hidden"}'));
    assert.ok(flattened.includes('className={tab === "approval" ? undefined : "hidden"}'));
  });

  test("⚠️ 그렇게 만든 까닭이 파일에 적혀 있다 — 지우면 다음 사람이 이 사고를 되살린다", () => {
    assert.match(tabsSource, /언마운트/);
    assert.match(tabsSource, /안 보이는 걸 왜 그려 두지/);
  });

  test("껍데기는 편집 폼도 결재 화면도 import 하지 않는다 — 서버가 그려 넘긴다", () => {
    assert.doesNotMatch(tabsSource, /from "\.\/QuoteEditForm"/);
    assert.doesNotMatch(tabsSource, /from "\.\/QuoteApprovalPanel"/);
  });
});

describe("🔴 APPROVED_OUTDATED 는 「승인됨」과 다르게 보인다", () => {
  test("다섯 상태의 이름표가 서로 다르다", () => {
    const labels = QUOTE_APPROVAL_STATES.map((state) => QUOTE_APPROVAL_STATE_LABELS[state]);
    assert.equal(new Set(labels).size, labels.length, "같은 이름표를 쓰는 상태가 있다");
  });

  test("이름표와 설명이 승인됨과 갈라진다", () => {
    assert.notEqual(
      QUOTE_APPROVAL_STATE_LABELS.APPROVED,
      QUOTE_APPROVAL_STATE_LABELS.APPROVED_OUTDATED
    );
    assert.notEqual(
      QUOTE_APPROVAL_STATE_DESCRIPTIONS.APPROVED,
      QUOTE_APPROVAL_STATE_DESCRIPTIONS.APPROVED_OUTDATED
    );
  });

  test("배지가 「승인 완료」 글자도 그 색도 쓰지 않는다", () => {
    const approved = renderToStaticMarkup(<QuoteApprovalStatusBadge state="APPROVED" />);
    const outdated = renderToStaticMarkup(<QuoteApprovalStatusBadge state="APPROVED_OUTDATED" />);

    assert.ok(approved.includes(QUOTE_APPROVAL_STATE_LABELS.APPROVED));
    assert.ok(
      !outdated.includes(QUOTE_APPROVAL_STATE_LABELS.APPROVED),
      "낡은 승인이 「승인 완료」로 읽힌다"
    );
    // 색만으로 가르지 않지만, 색까지 같으면 한눈에 구분되지 않는다.
    assert.ok(approved.includes("green"));
    assert.ok(!outdated.includes("green"), "낡은 승인이 승인 완료와 같은 초록으로 보인다");
  });

  test("까닭까지 적어 준다 — 이력에는 「승인」 줄이 그대로 남아 있기 때문이다", () => {
    assert.match(QUOTE_APPROVAL_OUTDATED_NOTICE, /수정/);
    assert.match(QUOTE_APPROVAL_OUTDATED_NOTICE, /다시/);
    assert.ok(
      flat(panelSource).includes('{state === "APPROVED_OUTDATED" && ('),
      "결재 화면이 그 안내를 그리지 않는다"
    );
    assert.ok(flat(panelSource).includes("{QUOTE_APPROVAL_OUTDATED_NOTICE}"));
  });

  test("그 상태에서는 다시 올릴 수 있다 — 승인이 살아 있을 때만 닫힌다", () => {
    const flattened = flat(panelSource);
    assert.ok(
      flattened.includes('"NOT_REQUESTED", "REJECTED", "APPROVED_OUTDATED",'),
      "다시 올릴 수 있는 상태 목록이 바뀌었다"
    );
  });
});

describe("🔴 발행은 결재 상태에 잠기지 않는다", () => {
  test("편집 폼이 결재를 아예 모른다", () => {
    assert.doesNotMatch(editFormSource, /quote-approvals?/i);
    assert.doesNotMatch(editFormSource, /QuoteApproval/);
  });

  test("[미리보기 · PDF] 의 조건이 그대로다 — 문서 종류 하나뿐", () => {
    // 🔴 곁에 있던 [견적서 받기] 링크는 2026-10-06 에 없앴다(quote-issue-screens.test.ts).
    // 남은 단추가 결재 상태를 보기 시작하지 않았는지를 여기서 지킨다.
    assert.ok(
      flat(editFormSource).includes('{canGetDocument && ( <button type="button" onClick={() => setShowPreview(true)}'),
      "미리보기 단추의 조건이 바뀌었다 — 결재 상태가 끼어들지 않았는지 확인할 것"
    );
    assert.ok(!flat(editFormSource).includes("savedQuote.id}/xlsx"), "받기 링크가 되살아났다");
  });

  test("발행 단추 조각 자체도 결재를 보지 않는다", () => {
    assert.doesNotMatch(issueButtonSource, /approval/i);
  });

  test("페이지가 편집 폼에 결재 값을 넘기지 않는다", () => {
    const flatPage = flat(editPageSource);
    const start = flatPage.indexOf("<QuoteEditForm");
    // 🔴 끝은 **편집 폼 자리를 닫는 괄호**다. 예전에는 「다음에 오는 슬롯 이름」으로 끊었는데,
    //    2026-10-08 에 그 사이로 공유폴더 구역 슬롯이 하나 들어오면서 마디가 사라졌다 —
    //    그러면 indexOf 가 -1 이 되어 결재 슬롯까지 통째로 딸려 온다(시험이 제 자리를 잃는다).
    const end = flatPage.indexOf("/> }", start);
    assert.ok(start >= 0, "페이지에서 편집 폼 자리를 찾지 못했다");
    assert.ok(end > start, "편집 폼 자리가 어디서 끝나는지 찾지 못했다");
    const editFormProps = flatPage.slice(start, end);
    assert.ok(editFormProps.length > 0, "페이지에서 편집 폼 자리를 찾지 못했다");
    assert.doesNotMatch(editFormProps, /approval/i);
  });

  test("결재 탭 맨 위가 그 사실을 사람에게도 말한다", () => {
    assert.match(QUOTE_APPROVAL_DOES_NOT_BLOCK_ISSUE_NOTICE, /발행/);
    assert.match(QUOTE_APPROVAL_DOES_NOT_BLOCK_ISSUE_NOTICE, /기록/);
    assert.ok(flat(panelSource).includes("{QUOTE_APPROVAL_DOES_NOT_BLOCK_ISSUE_NOTICE}"));
  });
});

describe("🔴 결재선이 없으면 무엇을 해야 하는지 말한다", () => {
  test("고칠 자리와 고칠 사람이 문장에 있다", () => {
    assert.match(QUOTE_APPROVAL_ROUTE_MISSING_NOTICE, /사용자 관리/);
    assert.match(QUOTE_APPROVAL_ROUTE_MISSING_NOTICE, /승인 절차/);
    assert.match(QUOTE_APPROVAL_ROUTE_MISSING_NOTICE, /견적서 승인/);
    assert.match(QUOTE_APPROVAL_ROUTE_MISSING_NOTICE, /관리자/);
    // 🔴 그 사이에도 발행은 된다 — 이 말이 없으면 안내가 「발행이 막혔다」로 읽힌다.
    assert.match(QUOTE_APPROVAL_ROUTE_MISSING_NOTICE, /발행은 그대로/);
  });

  test("누르기 전에 그린다 — 눌러서 실패하게 두지 않는다", () => {
    const flattened = flat(panelSource);
    assert.ok(flattened.includes("{!isRouteConfigured && ("));
    assert.ok(flattened.includes("{QUOTE_APPROVAL_ROUTE_MISSING_NOTICE}"));
    assert.ok(
      flattened.includes("const canRequest = isRouteConfigured && REQUESTABLE_STATES.includes(state);"),
      "결재선이 없는데도 올리기 단추가 나온다"
    );
  });

  test("판정을 화면에 새로 적지 않는다 — 도메인 함수 하나를 페이지가 부른다", () => {
    assert.ok(flat(editPageSource).includes("isRouteConfigured={isQuoteApprovalRouteInForce("));
  });

  test("서버가 거절한 이유를 삼키지 않는다", () => {
    assert.ok(
      flat(panelSource).includes("setErrorMessage(result.message);"),
      "서버가 돌려준 안내(결재선 없음 등)가 화면에 남지 않는다"
    );
  });
});

describe("반려에는 사유가 필요하다", () => {
  const dialogProps = {
    isOpen: true,
    title: "견적서 반려",
    isSubmitting: false,
    onConfirm: () => {},
    onCancel: () => {},
  };

  test("반려 창은 사유 칸을 필수로 표시한다", () => {
    const required = renderToStaticMarkup(<QuoteApprovalDialog {...dialogProps} requireReason />);
    assert.ok(required.includes("*"), "필수 표시가 없다");
    assert.ok(!required.includes("(선택)"), "필수인데 선택으로 보인다");
  });

  test("올리기·승인 창에서는 선택이다", () => {
    const optional = renderToStaticMarkup(
      <QuoteApprovalDialog {...dialogProps} title="견적서 승인" requireReason={false} />
    );
    assert.ok(optional.includes("(선택)"));
  });

  test("필수를 켜는 자리가 반려 하나뿐이다", () => {
    assert.ok(flat(panelSource).includes('requireReason={dialogState === "REJECTED"}'));
    assert.match(QUOTE_APPROVAL_REASON_REQUIRED_MESSAGE, /사유/);
  });
});

describe("결재 이력", () => {
  test("한 줄도 없으면 그렇게 말한다", () => {
    const markup = renderToStaticMarkup(<QuoteApprovalHistory records={[]} />);
    assert.ok(markup.includes(QUOTE_APPROVAL_EMPTY_HISTORY_TEXT));
  });

  test("누가 언제 무엇을 했고 무슨 말을 남겼나가 남는다", () => {
    const markup = renderToStaticMarkup(
      <QuoteApprovalHistory
        records={[
          approvalRecord({
            id: "a2",
            status: "REJECTED",
            decidedByUserId: "user-2",
            decidedByName: "김도윤",
            decidedAt: "2026-09-18T02:00:00.000Z",
            decisionReason: "부품 단가가 다릅니다",
          }),
        ]}
      />
    );
    assert.ok(markup.includes("홍길동"));
    assert.ok(markup.includes("김도윤"));
    assert.ok(markup.includes("금액 확인 부탁드립니다"));
    assert.ok(markup.includes("부품 단가가 다릅니다"));
    assert.ok(markup.includes("반려"));
  });

  test("🔴 단계 수는 **그 줄에 적힌 판**으로 센다", () => {
    const markup = renderToStaticMarkup(
      <QuoteApprovalHistory
        records={[
          approvalRecord({
            routeId: "route-old",
            routeStepOrder: 2,
            assignedApproverUserId: "approver-2",
            assignedApproverName: "김도윤",
          }),
        ]}
        routeSteps={[
          route("route-old", ["박하늘", "김도윤"]),
          route("route-new", ["박하늘", "김도윤", "최희만", "이서준"]),
        ]}
      />
    );
    assert.ok(markup.includes("결재선 2/2단계"), "현재 판으로 세면 아직 사람이 더 남은 것처럼 보인다");
    assert.ok(!markup.includes("2/4단계"));
  });

  test("최고관리자가 남의 차례를 대신 처리하면 그 표시가 남는다", () => {
    const markup = renderToStaticMarkup(
      <QuoteApprovalHistory
        records={[
          approvalRecord({
            status: "APPROVED",
            assignedApproverUserId: "approver-2",
            assignedApproverName: "김도윤",
            decidedByUserId: "super-admin",
            decidedByName: "최희만",
            decidedAt: "2026-09-18T03:00:00.000Z",
          }),
        ]}
      />
    );
    assert.ok(markup.includes("지정자 대신 처리"));
  });

  /**
   * 🔴 2026-10-26 — 결재선 단계 위임이 실제 결재에 연결되면서 이 줄이 생겼다.
   * 그 전까지 견적서 이력은 위임을 **적기만 하고 읽지 않았다**(조회가 칸을
   * select 하지 않았다). 그때도 「지정자 대신 처리」 배지는 떴기 때문에, 화면만
   * 보면 위임으로 누른 줄과 최고관리자가 비상구로 누른 줄이 **똑같이** 보였다.
   */
  describe("🔴 위임으로 대신 누른 줄에는 누구 자리였는지 이름이 남는다", () => {
    const delegated = approvalRecord({
      status: "APPROVED",
      assignedApproverUserId: "approver-2",
      assignedApproverName: "김도윤",
      decidedByUserId: "delegate-1",
      decidedByName: "박하늘",
      decidedAt: "2026-10-26T03:00:00.000Z",
      delegatedFromUserId: "approver-2",
      delegatedFromName: "김도윤",
    });

    test("처리자 옆에 **원래 자리 사람의 이름**이 붙는다", () => {
      const markup = renderToStaticMarkup(<QuoteApprovalHistory records={[delegated]} />);
      // 🔵 「김도윤」은 지정 칸에도 나오므로 이름만 세면 공짜로 통과한다 —
      // **누른 사람과 함께 적힌 한 마디**를 본다.
      assert.ok(markup.includes("처리자: 박하늘 (김도윤 님 자리를 위임받아 처리)"), markup);
      // 누가 눌렀는지도 그대로 남는다 — 둘 중 하나만 남으면 기록이 반쪽이다.
      assert.ok(markup.includes("박하늘"));
    });

    test("🔴 직접 누른 줄에는 그 말이 없다 — 「언제나 적는다」로는 통과하지 못한다", () => {
      const direct = approvalRecord({
        status: "APPROVED",
        assignedApproverUserId: "approver-2",
        assignedApproverName: "김도윤",
        decidedByUserId: "approver-2",
        decidedByName: "김도윤",
        decidedAt: "2026-10-26T03:00:00.000Z",
      });
      const markup = renderToStaticMarkup(<QuoteApprovalHistory records={[direct]} />);
      assert.ok(markup.includes("처리자: 김도윤"));
      assert.ok(!markup.includes("위임받아 처리"), "직접 누른 줄이 위임으로 읽힌다");
    });

    test("🔴 최고관리자 비상구와 갈린다 — 배지는 둘 다, 이름은 위임 쪽에만", () => {
      // 이것이 이 조각이 고친 결함이다. 두 줄을 **함께** 그려 맞대어 본다.
      const override = approvalRecord({
        id: "a-override",
        status: "APPROVED",
        assignedApproverUserId: "approver-2",
        assignedApproverName: "김도윤",
        decidedByUserId: "super-admin",
        decidedByName: "최희만",
        decidedAt: "2026-10-26T04:00:00.000Z",
      });
      const markup = renderToStaticMarkup(
        <QuoteApprovalHistory records={[delegated, override]} />
      );
      // 배지는 둘 다 붙는다(지정≠처리자) — 그래서 배지만으로는 못 가른다.
      assert.equal(markup.split("지정자 대신 처리").length - 1, 2, markup);
      // 가르는 것은 이름 한 마디다 — 위임 줄에만 붙는다.
      assert.equal(markup.split("위임받아 처리").length - 1, 1, markup);
      assert.ok(markup.includes("처리자: 최희만"), markup);
      assert.ok(!markup.includes("최희만 ("), "비상구로 누른 줄에 위임 괄호가 붙었다");
    });
  });
});

describe("결재 탭이 놓인 자리", () => {
  test("🔴 새 견적서 화면에는 결재 탭이 없다 — 아직 걸 대상이 없다", () => {
    assert.doesNotMatch(newPageSource, /QuoteEditTabs/);
    assert.doesNotMatch(newPageSource, /QuoteApprovalPanel/);
    assert.match(newPageSource, /<QuoteEditForm/);
  });

  test("저장된 견적서 화면은 껍데기를 거쳐 두 화면을 그린다", () => {
    assert.match(editPageSource, /<QuoteEditTabs/);
    assert.match(editPageSource, /<QuoteApprovalPanel/);
  });

  test("상태 판정은 서버가 한다 — 화면이 판 번호를 다시 견주지 않는다", () => {
    assert.ok(flat(editPageSource).includes("state={approvalProgress?.state ?? \"NOT_REQUESTED\"}"));
    // 부르는 자리(괄호)만 본다 — 머리말이 그 함수를 **가리키는** 것은 오히려
    // 있어야 할 글자다(판정이 어디에 있는지 다음 사람이 찾아갈 실마리다).
    assert.doesNotMatch(panelSource, /resolveQuoteApprovalState\(/);
    assert.doesNotMatch(panelSource, /isApprovalForCurrentQuote\(/);
    // 판 번호 자체가 이 화면에 내려오지 않는다 — 없는 값으로는 견줄 수 없다.
    assert.doesNotMatch(panelSource, /currentQuoteVersion/);
  });

  test("지정 관문 판정을 화면에 새로 적지 않는다 — 서버와 같은 함수를 부른다", () => {
    assert.match(panelSource, /mayDecideAssignedApproval/);
    assert.match(panelSource, /from "@\/lib\/auth\/approval-assignment"/);
  });

  test("🔴 결재선 단계 위임도 **서버에서 받아** 같은 함수에 넘긴다 — 화면이 DB 를 읽지 않는다", () => {
    // 위임 목록은 `approval_route_delegations` 를 읽어야 나온다. 클라이언트가
    // 그것을 읽게 두지 않는 것은 actingUser 를 서버에서 만들어 내려보내는 것과
    // 같은 이유다(페이지가 읽어 프롭으로 준다).
    assert.match(flat(editPageSource), /actingApproverUserIds=\{actingApproverUserIds\}/);
    assert.match(flat(editPageSource), /resolveActingApproverUserIds\(actingUser\.id/);
    // 화면은 받은 목록을 **공용 관문에 그대로 넘기기만** 한다 — 「누가 누를 수
    // 있나」를 여기서 다시 계산하면 서버와 갈라진다.
    assert.doesNotMatch(panelSource, /actingApproverUserIds\.includes\(/);
  });

  test("🔴 「대신 처리」 안내가 **까닭에 따라 둘**이다 — 위임받은 사람에게 「최고관리자 권한으로」라고 말하지 않는다", () => {
    // 2026-10-26 전에는 비상구 하나뿐이라 문장도 하나였다. 위임이 붙은 뒤에도 그
    // 문장만 남으면, 위임받은 사람은 **자기가 왜 누를 수 있는지** 끝내 모른다.
    assert.ok(
      panelSource.includes("위임받은 결재권으로 대신 처리합니다."),
      "위임 쪽 안내가 없다"
    );
    assert.ok(
      panelSource.includes("최고관리자 권한으로 대신 처리합니다."),
      "비상구 쪽 안내가 사라졌다"
    );
    // 어느 쪽인지는 **기록에 적을 값을 정하는 그 함수**가 가른다 — 화면이 따로
    // 판정하면 안내와 기록이 서로 다른 말을 하는 날이 온다.
    assert.match(flat(panelSource), /delegatedFromUserId\s*\?\s*`지금 차례는/);
    assert.match(panelSource, /delegatedFromUserIdFor\(/);
  });

  test("🔴 상자의 「처리자」도 이력과 **같은 함수**로 글자를 만든다", () => {
    // 두 벌로 적으면 같은 줄이 위 상자에서는 이름만, 아래 이력에서는 「누구
    // 자리를 위임받아」까지 붙어 서로 다르게 보인다.
    assert.ok(
      flat(panelSource).includes('<Field label="처리자" value={quoteDecidedByLabel(latest)} />'),
      "처리자 칸이 위임 이름을 거치지 않는다"
    );
    assert.match(panelSource, /import QuoteApprovalHistory, \{ quoteDecidedByLabel \}/);
  });
});

/*
 * ============================================================================
 * 🔴 결재 칸의 두 덩이는 **key 를 갖는다** (2026-10-08)
 * ============================================================================
 * 공유폴더 구역이 붙으면서 결재 칸의 자식이 **둘**이 되었다. 둘 다 서버 컴포넌트가
 * 만들어 넘긴 요소라, 한 상자에 나란히 놓이는 순간 React 가 그 자리를 목록으로 보고
 * 「Each child in a list should have a unique "key" prop」 경고를 낸다 — 서버에서
 * 건너온 요소에는 jsx 가 「확인했다」 표시를 남기지 못하기 때문이다(껍데기 머리말).
 *
 * 🔴 **경고 자체는 여기서 잴 수 없다.** 그 경고는 브라우저 쪽 조정기가 겉껍질을 벗겨
 * 안의 요소를 볼 때 난다(react-dom 브라우저 묶음의 warnOnInvalidKey 는 lazy 를 풀어
 * 본다). 서버 렌더러(renderToStaticMarkup)는 겉껍질을 풀지 않아 같은 자리에서 아무
 * 말도 하지 않고, 이 저장소에는 브라우저도 DOM 흉내 도구도 없다.
 *
 * 그래서 **경고가 나는 조건을 그려진 결과에서 직접 잰다**: 그 칸의 자식들이 배열이
 * 되는가, 되었다면 자식마다 서로 다른 key 가 붙어 있는가. 그 조건이 깨지는 순간이 곧
 * 경고가 나는 순간이다.
 *
 * 🔴 key 는 HTML 에 찍히지 않으므로 **컴포넌트가 돌려준 요소 나무**를 본다. 같은
 * props 로 그린 HTML 도 함께 재서 감싸개가 **DOM 을 늘리지 않았는지** 확인한다 —
 * 보이는 모양이 바뀌면 안 된다.
 * ============================================================================
 */

/**
 * QuoteEditTabs 가 돌려준 요소 나무를 집는다.
 *
 * 🔴 컴포넌트를 함수로 직접 부르지만 훅 규칙을 어기지 않는다 — 부르는 자리가 진짜
 * 렌더 중(Probe 의 렌더)이라 그 안의 useState 가 Probe 의 훅 자리로 들어간다.
 */
function tabsTree(props: Parameters<typeof QuoteEditTabs>[0]): ReactNode {
  let captured: ReactNode = null;
  function Probe() {
    captured = QuoteEditTabs(props);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return captured;
}

/** 나무를 훑어 그 id 를 단 칸을 찾는다. */
function findPanel(node: ReactNode, id: string): ReactElement | null {
  if (Array.isArray(node)) {
    for (const one of node as ReactNode[]) {
      const hit = findPanel(one, id);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const elementProps = node.props as { id?: string; children?: ReactNode };
  if (elementProps.id === id) return node;
  return findPanel(elementProps.children ?? null, id);
}

describe("🔴 결재 칸의 두 덩이는 key 를 갖는다 — 경고가 나는 조건을 잰다", () => {
  const slots = {
    editForm: <p>편집폼이있던자리</p>,
    archiveFolderSection: <section>공유폴더구역이있던자리</section>,
    approvalPanel: <p>결재화면이있던자리</p>,
  };
  const tree = tabsTree(slots);

  test("두 덩이가 한 상자의 **배열**이고, 자식마다 서로 다른 key 가 붙어 있다", () => {
    const panel = findPanel(tree, "quote-tab-panel-approval");
    assert.ok(panel, "결재 칸을 찾지 못했다");
    const box = (panel.props as { children?: ReactNode }).children;
    assert.ok(isValidElement(box), "결재 칸 안의 띄우는 상자를 찾지 못했다");
    if (!isValidElement(box)) throw new Error("unreachable");
    const children = (box.props as { children?: ReactNode }).children;
    assert.ok(Array.isArray(children), "두 덩이가 한 상자에 나란히 있지 않다");
    if (!Array.isArray(children)) throw new Error("unreachable");
    assert.equal(children.length, 2, `결재 칸의 덩이가 둘이 아니다: ${children.length}`);

    const keys = (children as ReactNode[]).map((child) =>
      isValidElement(child) ? child.key : null
    );
    assert.deepEqual(
      keys.filter((key) => key === null),
      [],
      `key 가 없는 자식이 있다 — 브라우저에서 "unique key" 경고가 난다: ${JSON.stringify(keys)}`
    );
    assert.equal(new Set(keys).size, 2, `두 덩이의 key 가 같다: ${JSON.stringify(keys)}`);
  });

  test("🔴 key 를 얹느라 보이는 모양이 바뀌지 않았다 — 감싸개는 아무것도 그리지 않는다", () => {
    const markup = renderToStaticMarkup(<QuoteEditTabs {...slots} />);
    assert.ok(
      markup.includes(
        '<div id="quote-tab-panel-approval" hidden="" class="hidden">' +
          '<div class="flex flex-col gap-4">' +
          "<section>공유폴더구역이있던자리</section>" +
          "<p>결재화면이있던자리</p>" +
          "</div></div>"
      ),
      markup
    );
  });

  test("🔴 [견적서 수정] 칸은 자식이 하나다 — 목록이 아니라 key 가 필요 없다", () => {
    const panel = findPanel(tree, "quote-tab-panel-edit");
    assert.ok(panel, "편집 칸을 찾지 못했다");
    assert.equal(
      Array.isArray((panel.props as { children?: ReactNode }).children),
      false,
      "편집 칸의 자식이 둘 이상이 되었다 — 여기도 key 를 얹어야 한다(껍데기 머리말)"
    );
  });

  test("⚠️ 까닭이 껍데기에 적혀 있다 — 지우면 다음 사람이 감싸개를 걷어낸다", () => {
    assert.match(tabsSource, /unique "key" prop/);
    assert.match(tabsSource, /<Fragment key=/);
  });
});

/**
 * ============================================================================
 * 🔴 알림 → **[견적서 결재] 탭** (2026-10-31 사용자 요구)
 * ============================================================================
 * 「견적서 결재 알림을 누르면 해당 견적서의 [견적서 결재]탭이 뜨도록 해줘.」
 *
 * 🔴 여기서 가장 중요한 것은 **불변식이 그대로인가**다 — 주소로 탭을 열되,
 * 두 화면은 여전히 **언제나 함께** 그려져야 한다. 그래서 받는 것은 `useState` 의
 * **초깃값 하나**이고, 이 껍데기는 주소를 읽지도 쓰지도 않는다.
 * ============================================================================
 */
describe("🔴 주소가 첫 탭을 정한다 — 그래도 두 화면은 함께 그려진다", () => {
  const slots = {
    editForm: <p>편집폼이있던자리</p>,
    approvalPanel: <p>결재화면이있던자리</p>,
  };

  test("initialTab=\"approval\" 이면 결재 칸이 보이고 수정 칸이 감춰진다", () => {
    const markup = renderToStaticMarkup(<QuoteEditTabs {...slots} initialTab="approval" />);
    assert.match(
      markup,
      /<div id="quote-tab-panel-edit"[^>]*hidden[^>]*>/,
      "결재 탭으로 열었는데 수정 칸이 감춰지지 않았다"
    );
    assert.doesNotMatch(
      markup,
      /<div id="quote-tab-panel-approval"[^>]*hidden[^>]*>/,
      "결재 탭으로 열었는데 결재 칸이 감춰져 있다"
    );
  });

  test("🔴 그래도 **두 칸 다** DOM 에 있다 — 불변식은 그대로다", () => {
    const markup = renderToStaticMarkup(<QuoteEditTabs {...slots} initialTab="approval" />);
    assert.ok(markup.includes("편집폼이있던자리"), "결재 탭으로 열었다고 편집 폼이 떼어졌다");
    assert.ok(markup.includes("결재화면이있던자리"));
  });

  test("주지 않으면 지금까지 그대로 [견적서 수정] 이다", () => {
    const markup = renderToStaticMarkup(<QuoteEditTabs {...slots} />);
    assert.doesNotMatch(markup, /<div id="quote-tab-panel-edit"[^>]*hidden[^>]*>/);
    assert.match(markup, /<div id="quote-tab-panel-approval"[^>]*hidden[^>]*>/);
    // 글자 그대로도 못 박는다 — initialTab 을 주고 안 주고가 실제로 다른 그림이다.
    assert.notEqual(markup, renderToStaticMarkup(<QuoteEditTabs {...slots} initialTab="approval" />));
  });

  test("🔴 **초깃값으로만** 받는다 — 주소를 따라다니면 폼이 다시 그려져 적던 내용이 날아간다", () => {
    const flattened = flat(tabsSource);
    assert.ok(
      flattened.includes("useState<QuoteEditTab>(initialTab)"),
      "initialTab 이 useState 의 초깃값이 아니다"
    );
    /**
     * 🔴 주소를 읽거나 갈아 끼우는 길이 이 껍데기에 하나도 없다.
     *
     * 🔵 **부르는 자리(괄호)만 본다** — 이 파일의 머리말이 「`router.replace` 로
     * 주소를 갈아 끼우지 않는 까닭」을 적고 있어서, 낱말만 세면 **주석 때문에**
     * 영영 깨진다(이 저장소에서 실제로 겪은 일이다). import 줄은 따로 본다.
     */
    for (const forbidden of ["useSearchParams(", "router.replace(", "router.push(", "useRouter("]) {
      assert.ok(
        !flattened.includes(forbidden),
        `껍데기가 ${forbidden} 를 쓴다 — 탭을 누를 때 화면이 다시 그려질 수 있다`
      );
    }
    assert.doesNotMatch(tabsSource, /from "next\/navigation"/, "껍데기가 라우터를 가져온다");
    // 🔴 `useEffect` 로 초깃값을 따라가게 만들어도 같은 사고가 난다.
    assert.ok(!flattened.includes("useEffect("), "껍데기에 useEffect 가 생겼다");
  });

  test("까닭이 파일에 적혀 있다 — 지우면 다음 사람이 주소를 따라다니게 만든다", () => {
    assert.match(tabsSource, /첫 그림/);
    assert.match(tabsSource, /initialTab/);
  });

  test("🔴 페이지가 주소에서 탭을 읽어 내려보낸다 — 판정은 도메인 함수 하나가 한다", () => {
    const flattened = flat(editPageSource);
    assert.ok(flattened.includes("parseQuoteEditTab("), "페이지가 탭을 읽지 않는다");
    assert.ok(flattened.includes("initialTab={initialTab}"), "읽은 탭을 껍데기에 넘기지 않는다");
    // 판정을 페이지에 다시 적지 않는다 — 글자로 견주는 코드가 여기 있으면 안 된다.
    assert.doesNotMatch(editPageSource, /=== "approval"/);
  });
});

/**
 * ============================================================================
 * 🔴 [저장]의 두 갈래가 **PDF 변환보다 먼저** 갈린다 (2026-10-31)
 * ============================================================================
 * 뒤에 두면 변환의 진행 팝업이 「완료되었습니다」로 바뀐 뒤 스스로 목록으로
 * 넘겨 버려서, 「승인요청이 반려되었습니다」가 **한 번도 보이지 않는다.** 그
 * 순서가 이 기능의 전부라 원본 글자로 못 박는다.
 * ============================================================================
 */
describe("🔴 저장 결과 팝업 둘", () => {
  const unchangedAt = editFormSource.indexOf('result.outcome === "UNCHANGED"');
  const rejectedAt = editFormSource.indexOf('result.outcome === "APPROVAL_AUTO_REJECTED"');
  const pdfAt = editFormSource.indexOf("const afterPdf = await convertSavedQuoteToPdf(savedQuote.id)");

  test("🔵 무엇을 재는지 — 세 자리를 원본에서 모두 찾았다", () => {
    assert.ok(unchangedAt > 0, "「안 바뀜」 갈래를 찾지 못했다");
    assert.ok(rejectedAt > 0, "「자동 반려」 갈래를 찾지 못했다");
    assert.ok(pdfAt > 0, "PDF 변환을 부르는 자리를 찾지 못했다");
  });

  test("🔴 두 갈래가 PDF 변환보다 **먼저** 온다", () => {
    assert.ok(unchangedAt < pdfAt, "「안 바뀜」이 PDF 변환 뒤에 있다");
    assert.ok(rejectedAt < pdfAt, "「자동 반려」가 PDF 변환 뒤에 있다 — 알림이 안 보인다");
  });

  test("🔴 저절로 닫히는 저장 팝업이 아니라 **읽고 닫는** 알림이다", () => {
    const flattened = flat(editFormSource);
    assert.ok(flattened.includes("<NoticePopup"), "NoticePopup 을 쓰지 않는다");
    assert.ok(flattened.includes("QUOTE_SAVE_NOTICE_LINES[saveNotice]"));
    assert.ok(flattened.includes("QUOTE_SAVE_NOTICE_TITLES[saveNotice]"));
  });

  test("🔴 「안 바뀜」은 **머문다** — 넘어가지도, PDF 를 만들지도 않는다", () => {
    const branch = editFormSource.slice(unchangedAt, rejectedAt);
    assert.ok(!branch.includes("convertSavedQuoteToPdf"), "안 바뀐 저장이 PDF 를 만든다");
    assert.ok(!branch.includes("showSavePopup("), "안 바뀐 저장이 저장 팝업을 띄운다");
    assert.ok(!branch.includes("leaving = true"), "안 바뀐 저장이 화면을 떠난다");
  });

  test("🔴 폼은 **결재 상태를 읽지 않는다** — 서버가 돌려준 낱말 하나만 본다", () => {
    // 위 「편집 폼이 결재를 아예 모른다」와 같은 울타리다(2026-09-18 — 발행은
    // 결재에 잠기지 않는다). 2026-10-31 에 팝업이 생겼어도 폼이 보는 것은
    // `result.outcome` 한 낱말뿐이고, 결재 조회·상태·패널은 여전히 모른다.
    assert.doesNotMatch(editFormSource, /approvalProgress|QuoteApprovalState|quote-approval-rules/);
    assert.ok(flat(editFormSource).includes("result.outcome ==="), "서버가 준 낱말을 보지 않는다");
  });

  test("🔴 「자동 반려」는 닫은 **뒤** 지금까지의 마무리를 잇는다 — PDF 를 건너뛰지 않는다", () => {
    const flattened = flat(editFormSource);
    assert.ok(flattened.includes("finishSaveAfterNotice(savedQuote.id)"), "닫은 뒤 이어지는 길이 없다");
    const finishAt = editFormSource.indexOf("async function finishSaveAfterNotice");
    assert.ok(finishAt > 0, "이어지는 함수를 찾지 못했다");
    const body = editFormSource.slice(finishAt, finishAt + 1200);
    assert.ok(body.includes("convertSavedQuoteToPdf"), "🔴 내용이 바뀐 그 장의 PDF 를 안 만든다");
    assert.ok(body.includes("showSavePopup("), "저장 팝업으로 끝맺지 않는다");
  });
});
