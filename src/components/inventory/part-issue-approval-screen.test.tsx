import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import InventoryTabs from "./InventoryTabs";
import PartIssueApprovalTrail, { approvalOutcomeLabel } from "./PartIssueApprovalTrail";
/**
 * 🔴 이 import 자체가 시험이다 — 문구를 모아 둔 파일이 무언가를 물기 시작하면
 * (`server-only` 사슬, React, "use client") 이 시험 파일이 **여기서** 죽는다.
 */
import {
  PART_ISSUE_CANCELLED_BY_REQUESTER_LABEL,
  PART_ISSUE_EXECUTION_BLOCKED_NOTICE,
  PART_ISSUE_REJECTED_BY_APPROVER_LABEL,
  PART_ISSUE_REQUEST_BUTTON_LABEL,
} from "./part-issue-approval-texts";
import {
  isPartIssueApprovalClosedByRequester,
  isPartIssueApprovalRouteInForce,
} from "@/lib/domain/inventory-part-issue-rules";
import type { PartIssueApprovalView } from "@/lib/db/queries/inventory-part-issue-requests";
import type { ShipmentApprovalRouteStepLabel } from "@/lib/db/queries/shipment-approval-routes";

/**
 * ============================================================================
 * 부품 불출 승인 — 재고 화면
 * ============================================================================
 * 서버는 이미 다 되어 있다(mutations/inventory-part-issue-requests.integration
 * .test.ts 가 실제 DB 로 못 박는다). 여기서 지키는 것은 **화면이 서버와 같은
 * 규칙으로 단추를 그리는가**, 그리고 **승인받은 것과 다른 것이 나갈 길을 화면이
 * 열지 않는가**다.
 *
 * ── 왜 한쪽은 렌더하고 한쪽은 원본을 읽는가 ────────────────────────────────
 * PartIssueApprovalScreen · 두 창 · 두 목록 화면은 **서버 액션을 직접 import 하는
 * 클라이언트 컴포넌트**라, 그 사슬 끝의 `server-only` 때문에 react-server 조건
 * 없이 도는 test:components 에서는 import 자체가 던진다. 그래서 이웃 시험
 * (repair-cases/approval/approval-screen-layout.test.tsx)과 같은 방법으로 원본을
 * 글자로 읽어 확인하고, 순수한 부품(PartIssueApprovalTrail · InventoryTabs)만
 * 실제로 렌더한다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/** 원본에서 **한 갈래만** 잘라낸다 — 파일 전체에 정규식을 걸면 이웃 갈래에 걸린다. */
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const approvalScreenSource = read("src/components/inventory/PartIssueApprovalScreen.tsx");
const managerScreenSource = read("src/components/inventory/PartRequestManagerScreen.tsx");
const balanceGridSource = read("src/components/inventory/PartBalanceGrid.tsx");
const issueDialogSource = read("src/components/inventory/IssuePartRequestDialog.tsx");
const consumeDialogSource = read("src/components/inventory/ConsumeStockDialog.tsx");
const trailSource = read("src/components/inventory/PartIssueApprovalTrail.tsx");
const requestsPageSource = read("src/app/(app)/inventory/requests/page.tsx");
const partDetailPageSource = read("src/app/(app)/inventory/[id]/page.tsx");
const approvalsPageSource = read("src/app/(app)/inventory/approvals/page.tsx");
const inventoryMutationSource = read("src/lib/db/mutations/inventory.ts");
const issueActionSource = read("src/lib/server/actions/inventory-part-issue-requests.ts");

/** 서버 액션을 무는 화면들 — 판정을 새로 적어서는 안 되는 자리 전부. */
const CLIENT_SCREENS: Array<[string, string]> = [
  ["부품 요청 관리", managerScreenSource],
  ["부품 상세 잔량 표", balanceGridSource],
  ["불출 창", issueDialogSource],
  ["사용 창", consumeDialogSource],
  ["승인 요청건 화면", approvalScreenSource],
];

/**
 * ============================================================================
 * 🔴 문 판정은 한 벌뿐이다
 * ============================================================================
 * 서버가 [불출]·[사용]을 막을지 정하는 판정과, 화면이 단추 이름을 바꿀지 정하는
 * 판정이 **같은 함수 하나**여야 한다. 두 벌이 되면 「단추는 보이는데 누르면
 * 거절」이나 그 반대가 되고, 후자는 화면에 아무 표시도 남기지 않아 더 나쁘다.
 * ============================================================================
 */
describe("🔴 문 판정 — 서버와 화면이 같은 함수를 본다", () => {
  test("판정 자체는 순수 자리에 있고 서버(mutations)는 그것을 가져다 쓴다", () => {
    assert.match(
      flat(inventoryMutationSource),
      /import \{[^}]*\bisPartIssueApprovalRouteInForce\b[^}]*\} from "@\/lib\/domain\/inventory-part-issue-rules"/,
      "서버가 판정을 스스로 들고 있으면 화면은 그것을 부를 수 없다(server-only 사슬)"
    );
    assert.ok(
      !/route\.steps\.length > 0/.test(inventoryMutationSource),
      "판정 본문이 서버에 되살아났다 — 언젠가 한쪽만 고쳐진다"
    );
  });

  test("🔴 화면 쪽은 서버 컴포넌트가 **그 함수**로 계산해 내려보낸다", () => {
    for (const [name, source] of [
      ["부품 요청 관리 페이지", requestsPageSource],
      ["부품 상세 페이지", partDetailPageSource],
    ] as const) {
      assert.match(
        flat(source),
        /import \{[^}]*\bisPartIssueApprovalRouteInForce\b[^}]*\} from "@\/lib\/domain\/inventory-part-issue-rules"/,
        `${name}: 서버가 보는 것과 같은 함수를 봐야 한다`
      );
      assert.match(
        flat(source),
        /isPartIssueApprovalRouteInForce\(\s*(await )?getCurrentShipmentApprovalRoute\(\s*PART_ISSUE_APPROVAL_ROUTE_SCOPE\s*\)|isPartIssueApprovalRouteInForce\(partIssueRoute\)/,
        `${name}: 「현재 판」을 읽어 그 함수에 넘기는 자리가 사라졌다`
      );
      assert.ok(
        !/"PART_ISSUE"/.test(source),
        `${name}: 용도를 글자로 적었다 — 오타 하나가 「판이 없다」로 조용히 보인다`
      );
    }
  });

  test("🔴 화면 부품은 판정도 조회도 스스로 하지 않는다", () => {
    for (const [name, source] of CLIENT_SCREENS) {
      assert.ok(
        !/steps\.length > 0/.test(source),
        `${name}: 판정을 한 벌 더 적었다`
      );
      assert.ok(
        !/getCurrentShipmentApprovalRoute\(/.test(source),
        `${name}: 클라이언트가 DB 를 읽으려 한다 — 판정은 서버에서 계산해 내려보낸다`
      );
    }
  });

  test("🔴 그 함수가 정하는 갈림 — 판이 없거나 단계가 0개면 거짓이다", () => {
    // 안전장치의 본체다: 관리자가 절차를 만들기 전까지 재고가 잠기지 않는다.
    assert.equal(isPartIssueApprovalRouteInForce(null), false);
    assert.equal(isPartIssueApprovalRouteInForce({ steps: [] }), false);
    assert.equal(
      isPartIssueApprovalRouteInForce({ steps: [{ stepOrder: 1, approverUserId: "u-1" }] }),
      true
    );
  });
});

/**
 * ============================================================================
 * 단추 갈리기 — 판이 없으면 한 글자도 다르지 않다
 * ============================================================================
 */
describe("🔴 단추 문구", () => {
  test("판이 있으면 [불출]·[사용] 자리가 [불출 승인 요청]이 된다", () => {
    assert.equal(PART_ISSUE_REQUEST_BUTTON_LABEL, "불출 승인 요청");
    assert.match(
      flat(managerScreenSource),
      /action === "ISSUE" && partIssueApprovalRequired \? PART_ISSUE_REQUEST_BUTTON_LABEL/,
      "부품 요청 관리의 [불출] 이름이 갈리지 않는다"
    );
    assert.match(
      flat(balanceGridSource),
      /\{partIssueApprovalRequired \? PART_ISSUE_REQUEST_BUTTON_LABEL : "사용"\}/,
      "부품 상세의 [사용] 이름이 갈리지 않는다"
    );
  });

  test("🔴 판이 없으면 옛 문구가 그대로 남는다", () => {
    // 「판이 없으면 지금 그대로」가 이 기능의 안전장치다 — 갈림의 다른 쪽이
    // 사라지면 절차를 만들지 않은 회사의 화면이 바뀐다.
    assert.match(flat(managerScreenSource), /: actionLabels\[action\];/);
    assert.match(flat(balanceGridSource), /: "사용"\}/);
    assert.match(flat(issueDialogSource), /: "불출 확정"\}/);
    assert.match(flat(consumeDialogSource), /: "사용"\}/);
  });

  test("두 화면이 **같은 상수 하나**에서 이름을 가져온다", () => {
    for (const [name, source] of [
      ["부품 요청 관리", managerScreenSource],
      ["부품 상세 잔량 표", balanceGridSource],
    ] as const) {
      assert.match(
        flat(source),
        /import \{[^}]*\bPART_ISSUE_REQUEST_BUTTON_LABEL\b[^}]*\} from "\.\/part-issue-approval-texts"/,
        `${name}: 이름을 글자로 적으면 화면마다 다른 단추가 된다`
      );
    }
  });

  test("🔴 판이 있으면 창도 신청서가 된다 — 같은 액션을 부른다", () => {
    for (const [name, source] of [
      ["불출 창", issueDialogSource],
      ["사용 창", consumeDialogSource],
    ] as const) {
      assert.match(
        flat(source),
        /const result = approvalRequired \? await createPartIssueRequestAction\(\{/,
        `${name}: 판이 있어도 그 자리에서 재고를 뺀다`
      );
    }
    // 갈래의 다른 쪽(예전 길)이 살아 있어야 판이 없을 때 지금과 같다.
    assert.match(flat(issueDialogSource), /: await issuePartRequestAction\(\{/);
    assert.match(flat(consumeDialogSource), /: await consumeStockAction\(\{/);
  });
});

/**
 * ============================================================================
 * 🔴 실행 단추 — 신청 id 만 보낸다
 * ============================================================================
 * 무엇을 얼마나 빼는지는 신청 항목에 이미 적혀 있다. 화면이 수량이나 잔량 행을
 * 함께 보내면 「승인받은 것과 다른 것이 나갔다」가 가능해진다.
 * ============================================================================
 */
describe("🔴 실행은 신청 id 하나만 보낸다", () => {
  const executeCall = sliceBetween(
    flat(approvalScreenSource),
    "await executePartIssueRequestAction(",
    ";"
  );

  test("payload 가 신청 id 하나다", () => {
    assert.match(executeCall, /^await executePartIssueRequestAction\(\{ issueRequestId \}\)$/);
  });

  test("🔴 수량·잔량 행·항목이 payload 에 실리지 않는다", () => {
    for (const forbidden of ["quantity", "partStockBalanceId", "allocations", "items", "expectedVersion"]) {
      assert.ok(
        !executeCall.includes(forbidden),
        `실행 payload 에 ${forbidden} 이 실렸다 — 승인받은 것과 다른 것이 나갈 길이 열린다`
      );
    }
  });

  test("🔴 서버 액션에도 그것을 받을 자리가 없다", () => {
    // 화면만 지켜도 소용없다 — 받는 쪽에 칸이 생기면 언젠가 채워진다.
    const inputType = sliceBetween(
      flat(issueActionSource),
      "export type ExecutePartIssueRequestActionInput = {",
      "};"
    );
    assert.match(inputType, /^export type ExecutePartIssueRequestActionInput = \{ issueRequestId: string; $/);
  });
});

/**
 * ============================================================================
 * 실패 이유 — 뭉개지 않는다
 * ============================================================================
 */
describe("🔴 서버가 거절한 이유가 그대로 나온다", () => {
  test("세 화면 다 서버 문구를 그대로 싣는다", () => {
    for (const [name, source] of [
      ["승인 요청건 화면", approvalScreenSource],
      ["불출 창", issueDialogSource],
      ["사용 창", consumeDialogSource],
    ] as const) {
      assert.match(
        flat(source),
        /result\.message/,
        `${name}: 서버가 준 이유를 버렸다`
      );
      assert.ok(
        !/"처리할 수 없습니다/.test(source),
        `${name}: 실패를 한 문장으로 뭉갰다 — 사람이 무엇을 해야 할지 알 수 없다`
      );
    }
  });

  test("🔴 재고가 모자라 막히면 「신청은 살아 있다」를 함께 말한다", () => {
    assert.match(
      flat(approvalScreenSource),
      /result\.code === "INSUFFICIENT_STOCK" \? `\$\{result\.message\} \$\{PART_ISSUE_EXECUTION_BLOCKED_NOTICE\}`/,
      "실패만 보여 주면 신청이 사라진 줄 알고 처음부터 다시 올리게 된다"
    );
    assert.match(PART_ISSUE_EXECUTION_BLOCKED_NOTICE, /입고 뒤 다시 실행/);
  });

  test("같은 부품 요청에 결재 중인 신청이 또 있으면 그 사실을 보여 준다", () => {
    assert.match(flat(approvalScreenSource), /view\.siblingPendingCount > 0 &&/);
    assert.match(
      flat(approvalsPageSource),
      /listPartIssueRequestsForPartRequest\(detail\.partRequestId\)/,
      "형제 신청을 세는 조회가 사라졌다"
    );
    assert.match(
      flat(approvalsPageSource),
      /isPartIssueRequestAwaitingApproval\(sibling\.status\)/,
      "「결재 중인가」를 페이지가 새로 적었다 — 순수 규칙 하나를 봐야 한다"
    );
  });
});

/**
 * ============================================================================
 * 묶음을 감추는 자리 — 서버가 정한다
 * ============================================================================
 */
describe("🔴 [승인 요청건] 탭이 보여 주는 범위", () => {
  test("내 차례인 것만 온다 — 좁히는 것은 조회의 몫이다", () => {
    assert.match(
      flat(approvalsPageSource),
      /listPartIssueRequestsPendingMyApproval\(actingUser\.id\)/,
      "「내가 결재할 건」을 페이지가 스스로 좁히려 한다"
    );
    assert.ok(
      !/from "@\/lib\/auth\/approval-assignment"/.test(approvalScreenSource),
      "화면이 지정 관문을 스스로 부른다 — 좁히기는 조회 안에 한 곳뿐이다"
    );
  });

  test("🔴 처리할 건이 0건이어도 묶음을 감추지 않는다", () => {
    assert.match(flat(approvalScreenSource), /pending\.length === 0 \?/);
    assert.match(flat(approvalScreenSource), /executable\.length === 0 \?/);
    assert.match(flat(approvalScreenSource), /PART_ISSUE_NOTHING_TO_DECIDE/);
    assert.match(flat(approvalScreenSource), /PART_ISSUE_NOTHING_TO_EXECUTE/);
  });

  test("애초에 결재자도 재고 담당자도 아닌 세션에만 묶음을 감춘다 — 판정은 서버가 한다", () => {
    assert.match(flat(approvalScreenSource), /showApprovalSection && \(/);
    assert.match(flat(approvalScreenSource), /showExecutionSection && \(/);
    assert.match(
      flat(approvalsPageSource),
      /pendingRows\.length > 0 \|\| standsOnCurrentRoute \|\| actorHasAllowedRole\(actingUser, \["SUPER_ADMIN"\]\)/,
      "내 앞에 놓인 건이 있는데도 묶음이 감춰지면 아무도 결재하지 못한다"
    );
    assert.match(
      flat(approvalsPageSource),
      /capabilities\.requestProcessing \|\| capabilities\.stock/,
      "실행 묶음의 자격을 화면이 역할로 판단하게 두면 설정으로 연 권한이 닿지 않는다"
    );
  });
});

/**
 * ============================================================================
 * 결재선 진행 — 승인 카드와 같은 모양
 * ============================================================================
 * 아래는 순수 부품이라 **실제로 렌더해서** 확인한다.
 * ============================================================================
 */
function approval(overrides: Partial<PartIssueApprovalView> = {}): PartIssueApprovalView {
  return {
    id: "approval-1",
    status: "REQUESTED",
    routeId: "route-a",
    routeStepOrder: 2,
    assignedApproverUserId: "approver-2",
    assignedApproverName: "김도윤",
    requestedByUserId: "user-1",
    requestedByName: "홍길동",
    requestedAt: "2026-09-01T01:00:00.000Z",
    requestReason: "부품 교체",
    decidedByUserId: null,
    decidedByName: null,
    decidedAt: null,
    decisionReason: null,
    ...overrides,
  };
}

function routeSteps(names: string[]): ShipmentApprovalRouteStepLabel[] {
  return names.map((approverName, index) => ({
    stepOrder: index + 1,
    approverUserId: `approver-${index + 1}`,
    approverName,
  }));
}

describe("🔴 결재선 진행 — 「n/m단계 · 지금 차례: ○○○」", () => {
  test("앞자리는 이 신청의 단계, 뒷자리는 이 신청이 타는 판의 단계 수다", () => {
    const html = renderToStaticMarkup(
      <PartIssueApprovalTrail approvals={[approval()]} routeSteps={routeSteps(["박서준", "김도윤", "이서연"])} />
    );
    assert.match(flat(html), /결재선 2\/3단계 · 지금 차례: 김도윤/);
  });

  test("판을 못 찾으면 앞자리만 적는다 — 「2/」 같은 반쪽짜리를 보여 주지 않는다", () => {
    const html = renderToStaticMarkup(<PartIssueApprovalTrail approvals={[approval()]} routeSteps={null} />);
    assert.match(flat(html), /결재선 2단계/);
    assert.ok(!/2\//.test(html), "뒷자리를 모르는데 빗금이 남았다");
  });

  test("🔴 이미 처리된 단계는 「지금 차례」라고 말하지 않는다", () => {
    const html = renderToStaticMarkup(
      <PartIssueApprovalTrail
        approvals={[approval({ status: "APPROVED", decidedByUserId: "approver-2", decidedByName: "김도윤" })]}
        routeSteps={routeSteps(["박서준", "김도윤"])}
      />
    );
    assert.ok(!/지금 차례/.test(html));
  });

  test("상자 + ▶ + 상자 아래 「n단계 · 상태」 — 출하 승인 카드와 같은 모양", () => {
    const html = renderToStaticMarkup(
      <PartIssueApprovalTrail approvals={[approval()]} routeSteps={routeSteps(["박서준", "김도윤", "이서연"])} />
    );
    assert.match(flat(html), /▶/);
    assert.match(flat(html), /1단계 · 완료/);
    assert.match(flat(html), /2단계 · 지금 차례/);
    assert.match(flat(html), /3단계 · 대기/);
    assert.match(flat(html), /박서준/);
  });

  test("🔴 색만으로 상태를 구분하지 않는다 — 칸마다 글자가 함께 붙는다", () => {
    // UI_GUIDELINE 7절(색약 사용자). 상태 이름은 판정 함수 한 곳에서 색과 함께 나온다.
    for (const label of ["완료", "대기", "지금 차례", "반려", "취소", "건너뜀 · 신청자 본인"]) {
      assert.ok(trailSource.includes(`stateLabel: "${label}"`), `상태 글자가 없다: ${label}`);
    }
  });

  test("🔴 가로로 길어져도 그 상자 안에서만 밀린다", () => {
    const html = renderToStaticMarkup(
      <PartIssueApprovalTrail approvals={[approval()]} routeSteps={routeSteps(["가", "나", "다"])} />
    );
    assert.match(html, /overflow-x-auto/);
    assert.match(html, /min-w-max/);
  });

  test("🔴 건너뛴 단계는 「완료」로 칠하지 않는다 — 서버와 같은 함수로 가른다", () => {
    assert.match(
      flat(trailSource),
      /import \{[^}]*\bisRouteStepSkippedForRequester\b[^}]*\} from "@\/lib\/domain\/shipment-approval-route"/,
      "서버가 사슬을 이을 때 보는 것과 같은 함수를 봐야 한다"
    );
    const html = renderToStaticMarkup(
      // 1단계 승인자가 신청자 본인이라 결재를 받지 않고 지나간 신청.
      <PartIssueApprovalTrail
        approvals={[approval({ requestedByUserId: "approver-1" })]}
        routeSteps={routeSteps(["홍길동", "김도윤"])}
      />
    );
    assert.match(flat(html), /1단계 · 건너뜀 · 신청자 본인/);
    assert.ok(!/1단계 · 완료/.test(flat(html)), "아무도 승인하지 않은 칸이 「완료」로 보인다");
  });

  test("🔴 화면이 「현재 판」을 읽지 않는다 — 진행 중인 신청은 옛 판을 따라간다", () => {
    assert.ok(!/getCurrentShipmentApprovalRoute/.test(trailSource));
    assert.match(
      flat(approvalsPageSource),
      /detail\.approvals\[detail\.approvals\.length - 1\]\.routeId/,
      "판 id 를 결재 행에서 읽지 않으면 「2/2단계」가 「2/4단계」로 보인다"
    );
  });
});

/**
 * ============================================================================
 * 🔴 「신청자가 취소함」과 「결재자가 반려함」
 * ============================================================================
 * 취소로 닫힌 결재 행은 표에 `REJECTED` 로 남는다(결재 상태에 닫는 값이 그것
 * 뿐이다). 화면이 갈라 주지 않으면 신청자가 스스로 물린 건이 「결재자가 반려함」
 * 으로 보인다 — 결재 기록을 되짚을 때 가장 헷갈리는 자리다.
 * ============================================================================
 */
describe("🔴 취소와 반려를 가른다", () => {
  const cancelled = approval({
    status: "REJECTED",
    decidedByUserId: "user-1",
    decidedByName: "홍길동",
    decidedAt: "2026-09-02T01:00:00.000Z",
    decisionReason: "신청자가 불출 신청을 취소했습니다.",
  });
  const rejected = approval({
    status: "REJECTED",
    decidedByUserId: "approver-2",
    decidedByName: "김도윤",
    decidedAt: "2026-09-02T01:00:00.000Z",
    decisionReason: "재고를 다른 건에 먼저 씁니다.",
  });

  test("가르는 것은 「결정자가 신청자 자신인가」 하나다 — 순수 규칙이 답한다", () => {
    assert.equal(isPartIssueApprovalClosedByRequester(cancelled), true);
    assert.equal(isPartIssueApprovalClosedByRequester(rejected), false);
    // 아직 열려 있는 행·승인된 행은 어느 쪽도 아니다.
    assert.equal(isPartIssueApprovalClosedByRequester(approval()), false);
    assert.equal(
      isPartIssueApprovalClosedByRequester(
        approval({ status: "APPROVED", decidedByUserId: "user-1" })
      ),
      false
    );
  });

  test("이름이 갈린다", () => {
    assert.equal(approvalOutcomeLabel(cancelled), PART_ISSUE_CANCELLED_BY_REQUESTER_LABEL);
    assert.equal(approvalOutcomeLabel(rejected), PART_ISSUE_REJECTED_BY_APPROVER_LABEL);
    assert.equal(approvalOutcomeLabel(approval()), "결재 대기");
    assert.equal(approvalOutcomeLabel(approval({ status: "APPROVED" })), "승인");
  });

  test("🔴 이력에 그렇게 그려진다", () => {
    const cancelledHtml = renderToStaticMarkup(
      <PartIssueApprovalTrail approvals={[cancelled]} routeSteps={routeSteps(["박서준", "김도윤"])} />
    );
    assert.match(flat(cancelledHtml), new RegExp(PART_ISSUE_CANCELLED_BY_REQUESTER_LABEL));
    assert.ok(
      !new RegExp(PART_ISSUE_REJECTED_BY_APPROVER_LABEL).test(cancelledHtml),
      "신청자가 물린 건이 「결재자가 반려함」으로 보인다"
    );

    const rejectedHtml = renderToStaticMarkup(
      <PartIssueApprovalTrail approvals={[rejected]} routeSteps={routeSteps(["박서준", "김도윤"])} />
    );
    assert.match(flat(rejectedHtml), new RegExp(PART_ISSUE_REJECTED_BY_APPROVER_LABEL));
    assert.ok(!new RegExp(PART_ISSUE_CANCELLED_BY_REQUESTER_LABEL).test(rejectedHtml));
  });

  test("🔴 진행 칸도 갈린다 — 취소를 반려와 같은 붉은 칸으로 그리지 않는다", () => {
    const cancelledHtml = renderToStaticMarkup(
      <PartIssueApprovalTrail approvals={[cancelled]} routeSteps={routeSteps(["박서준", "김도윤"])} />
    );
    assert.match(flat(cancelledHtml), /2단계 · 취소/);
    const rejectedHtml = renderToStaticMarkup(
      <PartIssueApprovalTrail approvals={[rejected]} routeSteps={routeSteps(["박서준", "김도윤"])} />
    );
    assert.match(flat(rejectedHtml), /2단계 · 반려/);
  });
});

describe("재고 관리 탭", () => {
  test("🔴 [승인 요청건] 이 늘고, 있던 셋은 그대로다", () => {
    const html = renderToStaticMarkup(<InventoryTabs active="APPROVALS" />);
    assert.match(flat(html), /href="\/inventory"[^>]*>재고 목록/);
    assert.match(flat(html), /href="\/inventory\/requests"[^>]*>부품 요청 관리/);
    assert.match(flat(html), /href="\/inventory\/approvals"[^>]*>승인 요청건/);
    assert.match(flat(html), /href="\/inventory\/oh-templates"[^>]*>O\/H 부품 템플릿/);
  });

  test("지금 보고 있는 탭만 강조된다", () => {
    const html = flat(renderToStaticMarkup(<InventoryTabs active="APPROVALS" />));
    // 렌더된 <a> 는 class 가 href 앞에 온다 — 그 짝을 그대로 집는다.
    const classOf = (href: string) => {
      const matched = html.match(new RegExp(`class="([^"]*)" href="${href.replace("/", "\\/")}"`));
      assert.ok(matched, `탭을 찾지 못했다: ${href}`);
      return matched[1];
    };
    assert.match(classOf("/inventory/approvals"), /bg-primary-900/, "고른 탭이 강조되지 않는다");
    assert.ok(!/bg-primary-900/.test(classOf("/inventory/requests")), "고르지 않은 탭까지 강조됐다");
  });
});
