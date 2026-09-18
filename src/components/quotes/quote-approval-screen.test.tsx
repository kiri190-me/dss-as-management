import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  test("[견적서 받기] 단추의 조건이 그대로다 — 저장 여부와 문서 종류 둘뿐", () => {
    assert.ok(
      flat(editFormSource).includes("{savedQuote && canGetDocument && ( <QuoteIssueButton"),
      "발행 단추의 조건이 바뀌었다 — 결재 상태가 끼어들지 않았는지 확인할 것"
    );
  });

  test("발행 단추 자체도 결재를 보지 않는다", () => {
    assert.doesNotMatch(issueButtonSource, /approval/i);
  });

  test("페이지가 편집 폼에 결재 값을 넘기지 않는다", () => {
    const editFormProps = flat(editPageSource).slice(
      flat(editPageSource).indexOf("<QuoteEditForm"),
      flat(editPageSource).indexOf("/> } approvalPanel=")
    );
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
});
