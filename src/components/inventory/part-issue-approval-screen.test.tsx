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
  PART_ISSUE_CANCEL_BACK_LABEL,
  PART_ISSUE_CANCEL_BUTTON_LABEL,
  PART_ISSUE_CANCEL_CONFIRM_LABEL,
  PART_ISSUE_CANCEL_DONE_MESSAGE,
  PART_ISSUE_CANCEL_REASON_LABEL,
  PART_ISSUE_CANCELLED_BY_REQUESTER_LABEL,
  PART_ISSUE_EXECUTION_BLOCKED_NOTICE,
  PART_ISSUE_LOCKED_AWAITING_APPROVAL_LABEL,
  PART_ISSUE_LOCKED_AWAITING_APPROVAL_TITLE,
  PART_ISSUE_LOCKED_AWAITING_EXECUTION_LABEL,
  PART_ISSUE_LOCKED_AWAITING_EXECUTION_TITLE,
  PART_ISSUE_MINE_LABEL,
  PART_ISSUE_NOTHING_AWAITING_APPROVAL,
  PART_ISSUE_NOTHING_IN_PROGRESS,
  PART_ISSUE_PROGRESS_AWAITING_APPROVAL_LABEL,
  PART_ISSUE_PROGRESS_AWAITING_EXECUTION_LABEL,
  PART_ISSUE_REJECTED_BY_APPROVER_LABEL,
  PART_ISSUE_REQUEST_BUTTON_LABEL,
} from "./part-issue-approval-texts";
import {
  INVENTORY_PART_ISSUE_REQUEST_STATUSES,
  isPartIssueApprovalClosedByRequester,
  isPartIssueApprovalRouteInForce,
  isPartIssueRequestAwaitingApproval,
  isPartIssueRequestCancellable,
  isPartIssueRequestExecutable,
  type InventoryPartIssueRequestStatus,
} from "@/lib/domain/inventory-part-issue-rules";
import type {
  PartIssueApprovalView,
  PartRequestIssueLock,
} from "@/lib/db/queries/inventory-part-issue-requests";
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
const issueQuerySource = read("src/lib/db/queries/inventory-part-issue-requests.ts");

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
 * 🔴 「진행 중인 신청」 — 누가 올렸든, 재고를 볼 수 있는 사람 전원에게, 결재·실행 없이
 * ============================================================================
 * (내 신청에만 [신청 취소]가 붙는다 — 아래 「🔴 [신청 취소]」 묶음.)
 * 신청을 올린 사람에게는 「내가 결재할 건」·「실행할 건」이 비어 보이는 것이
 * 정상이다. 그래서 올린 신청이 사라진 것처럼 보였다(2026-09-11 신고). 이 묶음이
 * 그 자리다. 보는 사람은 재고 목록(/inventory)에 들어올 수 있는 사람 전원이고
 * (사용자 결정 2026-09-11), 그 판정은 서버가 한다.
 * ============================================================================
 */
describe("🔴 [승인 요청건] 탭 — 진행 중인 신청", () => {
  const screen = flat(approvalScreenSource);
  const page = flat(approvalsPageSource);

  test("보이는 조건은 재고 목록 화면의 입구와 같다 — 서버가 판정한다", () => {
    assert.match(
      page,
      /import \{ hasAreaAccess \} from "@\/lib\/auth\/area-guard"/,
      "메뉴 권한을 가드와 다른 길로 물으면 두 기준이 갈라진다"
    );
    assert.match(
      page,
      /const showProgressSection = actingUser\.approvalStatus === "APPROVED" && \(await hasAreaAccess\("inventory", actingUser\)\);/,
      "「진행 중인 신청」을 보는 기준이 재고 목록(/inventory) 입구와 달라졌다"
    );
    assert.match(screen, /\{showProgressSection && \(/, "묶음을 서버 판정으로 감추는 자리가 사라졌다");
    assert.match(page, /showProgressSection=\{showProgressSection\}/);
  });

  test("🔴 볼 수 없는 세션에는 조회 자체를 부르지 않는다", () => {
    assert.match(
      page,
      /showProgressSection \? listPartIssueRequestsInProgress\(\) : Promise\.resolve\(\[\]\)/,
      "화면에서 감추기만 하면 목록은 이미 읽혀 내려간다"
    );
  });

  test("🔴 페이지 입구에 메뉴 권한 문을 달지 않는다 — 재고 권한이 없는 승인자도 결재하러 들어온다", () => {
    assert.ok(
      !/requireAreaAccess/.test(approvalsPageSource),
      "입구를 막으면 재고 메뉴 권한이 없는 결재선 승인자(예: 영업)가 자기 차례를 처리하지 못한다"
    );
    assert.ok(!/requirePermission|notFound\(/.test(approvalsPageSource), "다른 이름의 입구 문이 생겼다");
    // 남는 리다이렉트는 로그인뿐이다.
    const targets = [...approvalsPageSource.matchAll(/redirect\(([^)]*)\)/g)].map((matched) => matched[1]);
    assert.ok(targets.length > 0, "리다이렉트 호출을 하나도 찾지 못했다 — 검사가 헛돈다");
    for (const target of targets) {
      assert.equal(target, '"/login"', `로그인이 아닌 곳으로 튕기는 입구가 생겼다: ${target}`);
    }
  });

  test("「이 화면에서 처리할 수 있는 권한이 없습니다」는 세 묶음이 모두 감춰질 때만 나온다", () => {
    const noAccessBlock = sliceBetween(screen, "{!showApprovalSection", "이 화면에서 처리할 수 있는 권한이 없습니다.");
    assert.match(
      noAccessBlock,
      /^\{!showApprovalSection && !showExecutionSection && !showProgressSection && \( <p [^>]*>\s*$/,
      "묶음 하나라도 보이는 세션에 「권한 없음」이 함께 뜬다"
    );
    assert.equal(
      approvalScreenSource.split("이 화면에서 처리할 수 있는 권한이 없습니다.").length - 1,
      1,
      "「권한 없음」 문구가 다른 조건 아래 한 번 더 생겼다"
    );
  });

  test("기존 두 묶음 **아래**에, 같은 모양의 제목 · 0건이면 빈 상태 문구", () => {
    const approvalAt = screen.indexOf("{showApprovalSection && (");
    const executionAt = screen.indexOf("{showExecutionSection && (");
    const progressAt = screen.indexOf("{showProgressSection && (");
    assert.ok(approvalAt >= 0 && executionAt > approvalAt && progressAt > executionAt, "묶음 순서가 달라졌다");

    assert.match(
      screen,
      /<h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"> 진행 중인 신청\{" "\} <span className="tabular-nums text-zinc-500 dark:text-zinc-400">\{inProgress\.length\}건<\/span> <\/h2>/
    );
    assert.match(screen, /inProgress\.length === 0 \?/, "0건일 때 묶음을 감추면 「할 일 없음」과 「상관없음」이 구분되지 않는다");
    assert.match(screen, /\bPART_ISSUE_NOTHING_IN_PROGRESS\b\}/);
    assert.ok(PART_ISSUE_NOTHING_IN_PROGRESS.length > 0);
  });

  test("🔴 결재·실행을 싣지 않는다 — 이 묶음이 단추를 직접 그리지도, 서버 액션을 부르지도 않는다", () => {
    // 예외는 내 신청의 [신청 취소] 하나이고, 그것은 (나)와 함께 쓰는 도움 함수가
    // 그린다 — 무엇을 어디에 싣는지는 아래 「🔴 [신청 취소]」 묶음이 못 박는다.
    const progressSection = sliceBetween(screen, "{showProgressSection && (", 'role="status"');
    for (const forbidden of ["<button", "onClick", "execute(", "submitDecision", "setDraft", "Action("]) {
      assert.ok(!progressSection.includes(forbidden), `진행 중인 신청 묶음에 ${forbidden} 이 생겼다`);
    }
    assert.match(
      progressSection,
      /<RequestCard key=\{view\.detail\.id\} view=\{view\} actions=\{null\} message=\{null\} showProgress \/>/,
      "카드는 기존 RequestCard 를 단추 없이 그대로 쓴다"
    );
  });

  test("🔴 기존 두 묶음의 카드는 모양이 그대로다 — 상태 이름표·「내 신청」을 켜지 않는다", () => {
    const approvalSection = sliceBetween(screen, "{showApprovalSection && (", "{showExecutionSection && (");
    const executionSection = sliceBetween(screen, "{showExecutionSection && (", "{showProgressSection && (");
    for (const [name, section] of [
      ["내가 결재할 건", approvalSection],
      ["실행할 건", executionSection],
    ] as const) {
      assert.ok(section.includes("<RequestCard"), `${name}: 검사할 카드를 찾지 못했다 — 자르는 경계가 틀렸다`);
      assert.ok(!/\bshowProgress\b/.test(section), `${name}: 카드에 진행 표시가 켜졌다`);
    }
    // 이름표 둘 다 그 켜짐 하나에 매여 있다.
    assert.match(screen, /showProgress = false,/, "진행 표시는 기본으로 꺼져 있어야 한다");
    assert.match(screen, /const statusLabel = showProgress \? progressStatusLabel\(detail\.status\) : null;/);
    assert.match(screen, /\{showProgress && view\.isMine && \(/);
  });

  test("상태 이름표 — 결재 중 / 승인 완료 · 실행 대기, 순수 규칙 두 개로 가른다", () => {
    assert.equal(PART_ISSUE_PROGRESS_AWAITING_APPROVAL_LABEL, "결재 중");
    assert.equal(PART_ISSUE_PROGRESS_AWAITING_EXECUTION_LABEL, "승인 완료 · 실행 대기");
    assert.match(
      screen,
      /if \(isPartIssueRequestAwaitingApproval\(status\)\) return PART_ISSUE_PROGRESS_AWAITING_APPROVAL_LABEL;/
    );
    assert.match(
      screen,
      /if \(isPartIssueRequestExecutable\(status\)\) return PART_ISSUE_PROGRESS_AWAITING_EXECUTION_LABEL;/
    );
    // 🔴 신청 상태를 화면이 글자로 비교하지 않는다 — 조회가 상태를 고르는 규칙과
    // 같은 함수여야 한다. (결재 결정 값 "APPROVED"·"REJECTED" 는 다른 것이다.)
    assert.ok(!/"PENDING_APPROVAL"/.test(approvalScreenSource), "신청 상태를 화면이 글자로 적었다");
    assert.ok(!/status === "/.test(approvalScreenSource), "신청 상태를 화면이 글자로 비교한다");
  });

  test("🔴 「내 신청」 판정은 서버가 한다 — 화면은 세션을 추측하지 않는다", () => {
    assert.equal(PART_ISSUE_MINE_LABEL, "내 신청");
    assert.match(
      page,
      /isMine: detail\.requestedByUserId === actingUser\.id,/,
      "「내 신청」을 서버가 판정해 싣는 자리가 사라졌다"
    );
    assert.match(screen, /isMine: boolean;/);
    assert.match(screen, /\{PART_ISSUE_MINE_LABEL\}/);
    assert.ok(!/requestedByUserId ===|readSession|useSession/.test(approvalScreenSource), "화면이 세션을 스스로 짐작한다");
  });

  test("🔴 상세는 신청마다 한 번만 읽는다 — 세 묶음에 겹쳐도", () => {
    assert.match(
      page,
      /new Set\(\[\.\.\.pendingRows, \.\.\.executableRows, \.\.\.progressRows\]\.map\(\(row\) => row\.issueRequestId\)\)/,
      "id 를 중복 제거하지 않으면 같은 신청의 상세·형제 수 조회가 여러 번 돈다"
    );
    assert.equal(
      approvalsPageSource.split("getPartIssueRequestDetail(").length - 1,
      1,
      "상세 조회를 부르는 자리가 둘이 됐다"
    );
    // 판 단계 이름 · 형제 신청 수는 세 묶음 카드에 똑같이 붙는다 — 한 지도(viewById)에서 나온다.
    assert.match(page, /inProgress=\{toViews\(visibleProgressRows\)\}/);
  });
});

/**
 * ============================================================================
 * 🔴 「진행 중인 신청」과 [실행할 건]이 겹칠 때 (사용자 요청 2026-09-11)
 * ============================================================================
 * 실행 묶음이 **보이는** 세션에서는 거기 이미 떠 있는 신청을 진행 목록에서 뺀다.
 * **안 보이는** 세션에서는 빼지 않는다 — 빼면 그 사람에게서 승인 완료 건이
 * 사라져 보이고, 그것이 이 묶음이 고치려던 문제다.
 *
 * 빼는 식은 서버 컴포넌트 안에 있어 import 해 부를 수 없다(페이지 파일은 다른
 * 이름을 내보낼 수 없다). 그래서 **원본의 그 식 두 줄을 잘라 실제로 돌려 본다** —
 * 정규식만 걸면 식의 모양은 지켜도 뜻이 뒤집힌 것(`!` 하나)을 놓친다. 식에 타입
 * 표기가 끼면 여기서 문법 오류로 **시끄럽게** 깨진다(조용히 통과하지 않는다).
 * ============================================================================
 */
describe("🔴 진행 중인 신청 — [실행할 건]과 겹치는 신청은 실행 묶음이 보일 때만 뺀다", () => {
  const page = flat(approvalsPageSource);
  const screen = flat(approvalScreenSource);

  const expressionAfter = (marker: string) => sliceBetween(approvalsPageSource, marker, ";").slice(marker.length);
  const executableIdsExpression = expressionAfter("const executableIds = ");
  const visibleRowsExpression = expressionAfter("const visibleProgressRows = ");

  type Row = { issueRequestId: string };
  const visibleProgressIds = new Function(
    "progressExcludesExecutable",
    "progressRows",
    "executableRows",
    `const executableIds = ${executableIdsExpression}; return ${visibleRowsExpression};`
  ) as (progressExcludesExecutable: boolean, progressRows: Row[], executableRows: Row[]) => Row[];

  const rows = (...ids: string[]): Row[] => ids.map((issueRequestId) => ({ issueRequestId }));
  // 진행 목록: 결재 중 p-1 · p-2, 승인 완료 a-1 · a-2. 실행할 건에는 a-1 · a-2 가 떠 있다.
  const progress = rows("p-1", "a-1", "p-2", "a-2");
  const executable = rows("a-1", "a-2");

  test("판정은 「실행할 건이 보이는가」 하나다 — 서버가 한다", () => {
    assert.match(page, /const progressExcludesExecutable = showExecutionSection;/);
    assert.match(page, /progressExcludesExecutable=\{progressExcludesExecutable\}/);
  });

  test("🔴 (가) 실행 묶음이 보이는 세션 — 실행할 건과 겹치는 id 가 빠진다, 순서는 그대로", () => {
    assert.deepEqual(
      visibleProgressIds(true, progress, executable).map((row) => row.issueRequestId),
      ["p-1", "p-2"]
    );
  });

  test("🔴 (나) 실행 묶음이 안 보이는 세션 — 하나도 빠지지 않는다", () => {
    // 실행 권한이 없으면 실행할 건 목록은 애초에 비어 오지만, 그 사실에 기대지
    // 않는다 — 갈림 자체가 「빼지 않는다」여야 한다.
    assert.deepEqual(
      visibleProgressIds(false, progress, executable).map((row) => row.issueRequestId),
      ["p-1", "a-1", "p-2", "a-2"]
    );
    assert.deepEqual(
      visibleProgressIds(false, progress, []).map((row) => row.issueRequestId),
      ["p-1", "a-1", "p-2", "a-2"]
    );
  });

  test("🔴 빼는 기준은 실행할 건 목록에 **실제로 든 id** 다 — 상태 글자를 다시 적지 않는다", () => {
    // 두 목록을 읽는 사이에 승인이 난 건(a-3)은 실행할 건에 없으므로 진행 쪽에 남는다.
    assert.deepEqual(
      visibleProgressIds(true, rows("p-1", "a-3"), executable).map((row) => row.issueRequestId),
      ["p-1", "a-3"]
    );
    for (const expression of [executableIdsExpression, visibleRowsExpression]) {
      assert.ok(!/APPROVED|PENDING_APPROVAL|status/.test(expression), `상태로 거르는 식이 됐다: ${expression}`);
    }
    assert.match(executableIdsExpression, /^new Set\(executableRows\.map\(\(row\) => row\.issueRequestId\)\)$/);
  });

  test("🔴 조회는 그대로 사람·권한을 모른다 — 거르는 것은 페이지의 몫이다", () => {
    assert.match(page, /showProgressSection \? listPartIssueRequestsInProgress\(\) : Promise\.resolve\(\[\]\)/);
    assert.match(page, /inProgress=\{toViews\(visibleProgressRows\)\}/, "걸러 낸 목록이 아니라 원래 목록이 화면에 간다");
  });

  test("🔴 (다) 빈 상태 문구가 두 경우에 맞게 갈린다", () => {
    assert.match(
      screen,
      /inProgress\.length === 0 \? \( <p [^>]*> \{progressExcludesExecutable \? PART_ISSUE_NOTHING_AWAITING_APPROVAL : PART_ISSUE_NOTHING_IN_PROGRESS\} <\/p>/,
      "뺀 세션에서 「실행을 기다리는 신청이 없다」고 말하면 틀린다 — 위 [실행할 건]에 있을 수 있다"
    );
    assert.equal(PART_ISSUE_NOTHING_AWAITING_APPROVAL, "결재 중인 신청이 없습니다.");
    assert.ok(!/실행/.test(PART_ISSUE_NOTHING_AWAITING_APPROVAL), "뺀 세션의 문구가 실행 대기 건까지 없다고 말한다");
    assert.match(PART_ISSUE_NOTHING_IN_PROGRESS, /결재 중이거나 실행을 기다리는/);
  });

  test("「승인 완료 · 실행 대기」 이름표는 남는다 — 실행 권한 없는 세션에서 여전히 쓰인다", () => {
    assert.match(screen, /\bPART_ISSUE_PROGRESS_AWAITING_EXECUTION_LABEL\b/);
  });
});

/**
 * ============================================================================
 * 🔴 살아 있는 불출 신청이 있으면 [불출] 자리가 잠긴다 (사용자 요청 2026-09-11)
 * ============================================================================
 * [불출 승인 요청]을 올린 뒤에도 단추가 그대로라 같은 요청을 또 올릴 수 있었다.
 * 이제 그 요청에 결재 중인 신청이 있으면 「불출 승인 대기」, 결재 중은 없고 실행
 * 대기만 있으면 「불출 실행 대기」로 **누를 수 없게** 그린다.
 *
 * ── 왜 렌더하지 않는가 ──────────────────────────────────────────────────────
 * 단추를 그리는 ActionButtons 는 PartRequestManagerScreen.tsx 안에 있고, 그 파일은
 * 서버 액션을 물어 test:components 에서 import 자체가 던진다(이 파일 머리말). 판정
 * 함수가 사는 조회 파일도 `server-only` 라 마찬가지다. 그래서 위 「진행 중인 신청」
 * 시험과 같은 방법을 쓴다 — **타입 표기가 없는 식은 원본을 잘라 실제로 돌려 보고**,
 * JSX 는 잘라 낸 갈래 하나에만 정규식을 건다. 판정 함수는 조회 통합 시험
 * (queries/inventory-part-issue-requests.integration.test.ts)이 진짜 import 로도
 * 한 번 더 부른다.
 * ============================================================================
 */
describe("🔴 부품 요청 관리 — 살아 있는 불출 신청이 있으면 [불출]이 잠긴다", () => {
  const actionButtons = sliceBetween(flat(managerScreenSource), "function ActionButtons(", "function RequestCard(");
  const lockedBranch = sliceBetween(actionButtons, 'action === "ISSUE" && issueLock !== null ? (', ") : (");
  const availableActionsSource = sliceBetween(
    flat(managerScreenSource),
    "function availableActions(",
    "function formatRequestedAt("
  );

  /**
   * 판정 함수 — 원본의 몸통을 잘라 순수 규칙 두 개를 넣고 돌린다. 몸통에 타입
   * 표기나 줄 주석이 끼면 여기서 **시끄럽게** 깨진다(조용히 통과하지 않는다).
   */
  const lockFunctionSource = sliceBetween(
    flat(issueQuerySource),
    "export function partRequestIssueLockFor(",
    "return null; }"
  );
  const lockBodyMarker = "): PartRequestIssueLock | null {";
  const lockBody = `${lockFunctionSource.slice(lockFunctionSource.indexOf(lockBodyMarker) + lockBodyMarker.length)} return null;`;
  const lockForCompiled = new Function(
    "isPartIssueRequestAwaitingApproval",
    "isPartIssueRequestExecutable",
    "statuses",
    lockBody
  ) as (
    awaiting: typeof isPartIssueRequestAwaitingApproval,
    executable: typeof isPartIssueRequestExecutable,
    statuses: readonly InventoryPartIssueRequestStatus[]
  ) => PartRequestIssueLock | null;
  const lockFor = (statuses: readonly InventoryPartIssueRequestStatus[]) =>
    lockForCompiled(isPartIssueRequestAwaitingApproval, isPartIssueRequestExecutable, statuses);

  /** 페이지가 조회 결과를 잠금 지도로 바꾸는 반복문 — 역시 원본을 잘라 돌린다. */
  const pageSource = flat(requestsPageSource);
  const pageLoop = sliceBetween(
    pageSource,
    "for (const [partRequestId, statuses] of inProgressIssueStatuses) {",
    "return ("
  );
  const buildLocks = new Function(
    "partRequestIssueLockFor",
    "inProgressIssueStatuses",
    `const partIssueLocksByRequestId = {}; ${pageLoop} return partIssueLocksByRequestId;`
  ) as (
    decide: typeof lockFor,
    inProgressIssueStatuses: Map<string, InventoryPartIssueRequestStatus[]>
  ) => Record<string, PartRequestIssueLock>;

  test("🔴 (가) 결재 중이 하나라도 섞이면 「승인 대기」가 이긴다 — 순서와 무관하게", () => {
    assert.ok(lockFunctionSource.includes(lockBodyMarker), "판정 함수의 모양을 찾지 못했다 — 자르는 경계가 틀렸다");
    assert.equal(lockFor(["PENDING_APPROVAL"]), "AWAITING_APPROVAL");
    assert.equal(lockFor(["APPROVED", "PENDING_APPROVAL"]), "AWAITING_APPROVAL");
    assert.equal(lockFor(["PENDING_APPROVAL", "APPROVED"]), "AWAITING_APPROVAL");
    assert.equal(lockFor(["APPROVED", "APPROVED", "PENDING_APPROVAL"]), "AWAITING_APPROVAL");
    assert.equal(lockFor(INVENTORY_PART_ISSUE_REQUEST_STATUSES), "AWAITING_APPROVAL");
  });

  test("결재 중은 없고 실행 대기만 있으면 「실행 대기」, 살아 있는 것이 없으면 잠그지 않는다", () => {
    assert.equal(lockFor(["APPROVED"]), "AWAITING_EXECUTION");
    assert.equal(lockFor(["APPROVED", "APPROVED"]), "AWAITING_EXECUTION");
    assert.equal(lockFor([]), null);
    // 조회가 끝난 신청을 거르지만, 판정도 그것에 기대지 않는다.
    assert.equal(lockFor(["EXECUTED", "REJECTED", "CANCELLED"]), null);
    assert.equal(lockFor(["EXECUTED", "APPROVED"]), "AWAITING_EXECUTION");
  });

  test("🔴 판정은 순수 규칙 두 개로 가른다 — 상태를 글자로 다시 적지 않는다", () => {
    assert.match(lockBody, /\bisPartIssueRequestAwaitingApproval\b/);
    assert.match(lockBody, /\bisPartIssueRequestExecutable\b/);
    assert.ok(
      !/"PENDING_APPROVAL"|"APPROVED"|"EXECUTED"|"REJECTED"|"CANCELLED"/.test(lockBody),
      "판정 함수가 신청 상태를 글자로 적었다"
    );
    // 화면은 판정하지 않는다 — 서버가 계산한 잠금을 받아 문구만 고른다.
    assert.ok(!/partRequestIssueLockFor\(/.test(managerScreenSource), "화면이 판정 함수를 스스로 부른다");
    assert.ok(!/"PENDING_APPROVAL"|"APPROVED"/.test(managerScreenSource), "화면이 신청 상태를 글자로 적었다");
  });

  test("🔴 페이지는 조회를 **한 번** 부르고, 잠긴 요청만 지도에 담는다", () => {
    assert.match(
      pageSource,
      /const inProgressIssueStatuses = await listInProgressPartIssueStatusesByPartRequest\( requests\.map\(\(request\) => request\.id\) \);/,
      "요청 전부의 id 를 한 번에 넘기는 자리가 사라졌다"
    );
    assert.equal(
      requestsPageSource.split("listInProgressPartIssueStatusesByPartRequest(").length - 1,
      1,
      "조회를 부르는 자리가 둘이 됐다 — 요청마다 부르면 N+1 이다"
    );
    assert.match(pageSource, /partIssueLocksByRequestId=\{partIssueLocksByRequestId\}/);

    const locks = buildLocks(
      lockFor,
      new Map<string, InventoryPartIssueRequestStatus[]>([
        ["request-a", ["APPROVED", "PENDING_APPROVAL"]],
        ["request-b", ["APPROVED"]],
        ["request-c", []],
      ])
    );
    assert.deepEqual(locks, { "request-a": "AWAITING_APPROVAL", "request-b": "AWAITING_EXECUTION" });
    assert.deepEqual(buildLocks(lockFor, new Map()), {});
  });

  test("🔴 (다) 잠금은 승인 절차가 켜져 있는지와 무관하다", () => {
    // 절차를 꺼도 이미 올라간 신청은 살아 있다 — 그 사이 [불출]로 또 내보내면
    // 같은 부품이 두 번 나간다.
    const pageLockBlock = sliceBetween(pageSource, "const inProgressIssueStatuses = ", "return (");
    assert.ok(!/partIssueApprovalRequired/.test(pageLockBlock), "페이지가 잠금을 절차 켜짐에 매었다");
    assert.ok(!/partIssueApprovalRequired/.test(lockFunctionSource), "판정 함수가 절차 켜짐을 본다");
    assert.match(actionButtons, /const issueLock = partIssueLocksByRequestId\[request\.id\] \?\? null;/);
    assert.match(
      actionButtons,
      /\{actions\.map\(\(action\) => action === "ISSUE" && issueLock !== null \? \(/,
      "잠긴 [불출]을 그리는 갈림의 조건이 달라졌다"
    );
    assert.ok(!/partIssueApprovalRequired/.test(lockedBranch), "잠긴 단추가 절차 켜짐에 따라 달라진다");
  });

  test("🔴 (나) 잠긴 단추는 disabled 이고, 조작 창을 여는 길이 없다", () => {
    assert.match(lockedBranch, /<button key=\{action\} type="button" disabled title=\{issueLockTitles\[issueLock\]\}/);
    for (const forbidden of ["onClick", "onAction", "openDialog", "setDialog", "actionLabel("]) {
      assert.ok(!lockedBranch.includes(forbidden), `잠긴 단추에 ${forbidden} 이 생겼다`);
    }
    assert.match(lockedBranch, /\{issueLockLabels\[issueLock\]\} <\/button>/);
    // 비활성 모양은 이 파일의 [보류 해제]와 같은 관례, 다크 모드도 함께.
    assert.match(lockedBranch, /disabled:cursor-not-allowed disabled:opacity-50/);
    assert.match(lockedBranch, /dark:bg-primary-50 dark:text-zinc-900/);
  });

  test("잠금 두 갈래가 각자의 이름과 풀이로 이어진다 — 문구는 한곳의 상수다", () => {
    assert.equal(PART_ISSUE_LOCKED_AWAITING_APPROVAL_LABEL, "불출 승인 대기");
    assert.equal(PART_ISSUE_LOCKED_AWAITING_EXECUTION_LABEL, "불출 실행 대기");
    assert.match(PART_ISSUE_LOCKED_AWAITING_APPROVAL_TITLE, /\[승인 요청건\] 탭/);
    assert.match(PART_ISSUE_LOCKED_AWAITING_EXECUTION_TITLE, /\[승인 요청건\] 탭/);
    const screen = flat(managerScreenSource);
    assert.match(
      screen,
      /const issueLockLabels: Record<PartRequestIssueLock, string> = \{ AWAITING_APPROVAL: PART_ISSUE_LOCKED_AWAITING_APPROVAL_LABEL, AWAITING_EXECUTION: PART_ISSUE_LOCKED_AWAITING_EXECUTION_LABEL, \};/
    );
    assert.match(
      screen,
      /const issueLockTitles: Record<PartRequestIssueLock, string> = \{ AWAITING_APPROVAL: PART_ISSUE_LOCKED_AWAITING_APPROVAL_TITLE, AWAITING_EXECUTION: PART_ISSUE_LOCKED_AWAITING_EXECUTION_TITLE, \};/
    );
    assert.ok(!/"불출 승인 대기"|"불출 실행 대기"/.test(managerScreenSource), "이름을 화면에 글자로 적었다");
  });

  test("🔴 (라) 잠금이 없으면 [불출]·[불출 승인 요청] 단추가 한 글자도 다르지 않다", () => {
    const unlockedButton = [
      "<button",
      "key={action}",
      'type="button"',
      "onClick={() => onAction(request.id, action)}",
      "className={`rounded-md ${base} ${",
      'action === "ISSUE"',
      '? "bg-primary-900 font-medium text-white hover:bg-primary-800 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"',
      ': action === "REJECT"',
      '? "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"',
      ': action === "HOLD"',
      '? "border border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950"',
      ': "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"',
      "}`}",
      ">",
      "{actionLabel(action, partIssueApprovalRequired)}",
      "</button>",
    ].join(" ");
    // 잠금 갈림의 「아니면」 쪽이 옛 단추 그대로이고, 거기서 map 이 끝난다.
    assert.ok(
      actionButtons.includes(`) : ( ${unlockedButton} ) )}`),
      "잠기지 않은 요청의 단추가 예전과 달라졌다"
    );
  });

  test("🔴 (마) 다른 단추·조작 목록은 그대로다 — 잠금은 그리는 단계에서만", () => {
    assert.ok(!/issueLock|partIssueLocks/.test(availableActionsSource), "조작 목록(availableActions)이 잠금을 안다");
    assert.match(
      flat(managerScreenSource),
      /const actionLabels: Record<DialogAction, string> = \{ ISSUE: "불출", REJECT: "거절", PARTIALLY_CLOSE: "부분 불출 종료", HOLD: "보류", \};/
    );
    // [보류 해제]는 잠금 갈림보다 앞에서 그대로 돌아간다.
    assert.ok(
      actionButtons.includes(
        '<button type="button" disabled={releasing} onClick={() => onReleaseHold(request.id)} className="rounded-md border border-violet-300 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950" > {releasing ? "처리 중..." : "보류 해제"} </button>'
      ),
      "[보류 해제] 단추가 달라졌다"
    );
    assert.ok(
      actionButtons.indexOf("isRequestHoldReleasable(") < actionButtons.indexOf("issueLock !== null ?"),
      "보류 중인 요청의 [보류 해제]보다 잠금 갈림이 먼저 온다"
    );
    // 잠긴 갈래는 ISSUE 하나에만 걸린다 — 거절·보류·부분 불출 종료는 언제나 원래 단추다.
    assert.equal(actionButtons.split("issueLock !== null").length - 1, 1, "잠금 갈림이 둘이 됐다");
  });

  test("🔴 표와 카드가 같은 자리(ActionButtons 하나)에서 잠금을 받는다", () => {
    const screen = flat(managerScreenSource);
    const calls = [...screen.matchAll(/<ActionButtons [^/]*\/>/g)].map((matched) => matched[0]);
    assert.equal(calls.length, 2, "ActionButtons 를 부르는 자리가 표·카드 둘이 아니다");
    for (const call of calls) {
      assert.match(call, /partIssueLocksByRequestId=\{partIssueLocksByRequestId\}/, `잠금을 넘기지 않는다: ${call}`);
    }
    assert.match(screen, /<ActionButtons [^/]*size="card"/);
    assert.match(screen, /<ActionButtons [^/]*size="table"/);
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

/**
 * ============================================================================
 * 🔴 [신청 취소] — 내 신청을 내가 무른다 (사용자 요청 2026-09-11)
 * ============================================================================
 * 서버 쪽(액션 · mutation)은 이미 있고 통합 시험이 실제 DB 로 못 박는다 — 신청자
 * 본인만, 최고관리자 비상구 없음, 열린 결재 행은 지우지 않고 닫는다. 여기서
 * 지키는 것은 화면이 (1) 서버와 같은 규칙으로 단추를 그리는가, (2) 붙는 자리가
 * (나)·(다)뿐인가, (3) 확정이 신청 id 와 사유만 보내는가, (4) 실패를 뭉개지
 * 않는가, (5) 입력 칸이 결재 칸과 동시에 열리지 않는가다.
 *
 * 화면 부품은 import 할 수 없으므로(이 파일 머리말) 위 시험들과 같은 방법을
 * 쓴다 — **타입 표기 없는 몸통은 원본을 잘라 실제로 돌려 보고**, JSX 는 잘라 낸
 * 갈래 하나에만 정규식을 건다. 몸통에 타입 표기가 끼면 여기서 문법 오류로
 * **시끄럽게** 깨진다.
 * ============================================================================
 */
describe("🔴 [신청 취소] — 내 신청의 (나)·(다) 카드에만", () => {
  const screen = flat(approvalScreenSource);
  const approvalSection = sliceBetween(screen, "{showApprovalSection && (", "{showExecutionSection && (");
  const executionSection = sliceBetween(screen, "{showExecutionSection && (", "{showProgressSection && (");
  const progressSection = sliceBetween(screen, "{showProgressSection && (", 'role="status"');

  /** 원본(접지 않은 것)에서 함수 몸통을 잘라 낸다 — `indent` 만큼 들여쓴 닫는 괄호까지. */
  const bodyAfter = (signature: string, indent: string) => {
    const start = approvalScreenSource.indexOf(signature);
    assert.ok(start >= 0, `원본에서 '${signature}' 를 찾지 못했다`);
    const rest = approvalScreenSource.slice(start + signature.length);
    const end = rest.search(new RegExp(`\\r?\\n${indent}\\}\\r?\\n`));
    assert.ok(end > 0, `'${signature}' 의 끝을 찾지 못했다`);
    return rest.slice(0, end);
  };
  const countOf = (source: string, needle: string) => source.split(needle).length - 1;

  const ISSUE_REQUEST_ID = "7d4c2a0e-6a55-4f3e-9f55-0a4b4a6f1a01";
  const OTHER_REQUEST_ID = "7d4c2a0e-6a55-4f3e-9f55-0a4b4a6f1a02";

  // ── 붙는 조건 — 원본의 offersCancel 몸통을 진짜 순수 규칙과 함께 돌린다 ──
  const offersCancelCompiled = new Function(
    "isPartIssueRequestCancellable",
    "view",
    bodyAfter("function offersCancel(view: PartIssueApprovalRequestView): boolean {", "")
  ) as (
    rule: typeof isPartIssueRequestCancellable,
    view: { isMine: boolean; detail: { status: InventoryPartIssueRequestStatus } }
  ) => boolean;
  const offersCancel = (isMine: boolean, status: InventoryPartIssueRequestStatus) =>
    offersCancelCompiled(isPartIssueRequestCancellable, { isMine, detail: { status } });

  test("🔴 (가) 붙는 조건은 「내 신청 && 지금 무를 수 있음」 하나다 — 상태 다섯 × 내 것/남의 것", () => {
    for (const status of INVENTORY_PART_ISSUE_REQUEST_STATUSES) {
      assert.equal(offersCancel(true, status), isPartIssueRequestCancellable(status), `내 신청 · ${status}`);
      assert.equal(offersCancel(false, status), false, `🔴 남의 신청에 [신청 취소]가 붙었다 · ${status}`);
    }
    // 규칙이 참인 상태가 정확히 둘인 것도 한 번 더 — 결재 중 · 승인 완료(실행 전).
    assert.equal(offersCancel(true, "PENDING_APPROVAL"), true);
    assert.equal(offersCancel(true, "APPROVED"), true);
    assert.equal(offersCancel(true, "EXECUTED"), false, "이미 재고가 나간 신청에 단추가 붙는다");
  });

  test("🔴 판정은 서버가 보는 것과 같은 순수 규칙이다 — 상태 글자도, 세션 짐작도, 관리자 예외도 없다", () => {
    assert.match(
      screen,
      /import \{[^}]*\bisPartIssueRequestCancellable\b[^}]*\} from "@\/lib\/domain\/inventory-part-issue-rules"/
    );
    assert.match(screen, /function offersCancel\(view: PartIssueApprovalRequestView\): boolean \{ return view\.isMine && isPartIssueRequestCancellable\(view\.detail\.status\); \}/);
    // 최고관리자도 남의 신청은 무를 수 없다(mutation 머리말) — 화면이 그 문을 따로 열지 않는다.
    assert.ok(!/SUPER_ADMIN|isSuperAdmin/.test(approvalScreenSource), "화면이 관리자 예외를 만들었다");
    assert.ok(!/isMine \|\|/.test(approvalScreenSource), "「내 신청」 조건이 다른 조건과 OR 로 풀렸다");
  });

  test("🔴 (가) 내가 결재할 건에는 붙지 않는다", () => {
    assert.ok(approvalSection.includes("<RequestCard"), "검사할 카드를 찾지 못했다 — 자르는 경계가 틀렸다");
    for (const forbidden of [
      "offersCancel",
      "renderCancelButton",
      "renderCancelDraft",
      "cancelDraftOpenOn",
      "submitCancel",
      "PART_ISSUE_CANCEL_",
      "cancelPartIssueRequestAction",
    ]) {
      assert.ok(!approvalSection.includes(forbidden), `내가 결재할 건에 ${forbidden} 이 생겼다`);
    }
  });

  test("(나) 실행할 건 — [불출 실행] 옆에, 조건이 참일 때만. 칸이 펼쳐지면 단추 자리를 대신한다", () => {
    assert.ok(
      executionSection.includes(
        "offersCancel(view) && cancelDraftOpenOn(view) ? ( renderCancelDraft() ) : ( <> <button"
      ),
      "(나)의 취소 칸이 조건 없이 펼쳐지거나, 단추 묶음의 모양이 달라졌다"
    );
    assert.ok(
      executionSection.includes('{busyId === view.detail.id ? "처리 중..." : "불출 실행"} </button> {offersCancel(view) && renderCancelButton(view)} </> )'),
      "[신청 취소]가 [불출 실행] 옆에 조건과 함께 놓이지 않는다"
    );
    // [불출 실행] 자체는 그대로다 — 부르는 것도, 비활성 조건도.
    assert.ok(executionSection.includes("onClick={() => void execute(view.detail.id)}"));
    assert.ok(executionSection.includes("disabled={busyId !== null}"));
  });

  test("(다) 진행 중인 신청 — 조건이 참인 카드에만, 그 밖의 카드는 예전 그대로", () => {
    assert.ok(
      progressSection.includes(
        "offersCancel(view) ? ( <RequestCard key={view.detail.id} view={view} actions={cancelDraftOpenOn(view) ? renderCancelDraft() : renderCancelButton(view)} message={resultLineFor(view.detail.id, true)} showProgress /> ) : ( <RequestCard key={view.detail.id} view={view} actions={null} message={null} showProgress /> )"
      ),
      "(다)의 갈림이 달라졌다 — 취소 카드에 다른 것이 실리거나, 나머지 카드에 단추·결과 줄이 생겼다"
    );
    // 이 묶음의 카드에 실리는 actions 는 딱 두 가지다.
    const actionProps = [...progressSection.matchAll(/actions=\{/g)].length;
    assert.equal(actionProps, 2, "(다)의 카드에 다른 단추 자리가 생겼다");
  });

  test("🔴 취소 단추·칸을 그리는 곳은 도움 함수 둘뿐이고, 부르는 곳은 (나)·(다) 한 번씩이다", () => {
    for (const helper of ["renderCancelButton(", "renderCancelDraft("]) {
      assert.equal(countOf(screen, helper), 3, `${helper} 정의 1 + (나) 1 + (다) 1 이 아니다`);
      assert.equal(countOf(executionSection, helper), 1, `(나)에서 ${helper} 를 부르는 수`);
      assert.equal(countOf(progressSection, helper), 1, `(다)에서 ${helper} 를 부르는 수`);
    }
    assert.equal(countOf(screen, "{PART_ISSUE_CANCEL_BUTTON_LABEL}"), 1, "[신청 취소] 단추가 도움 함수 밖에서도 그려진다");
    assert.equal(countOf(screen, "void submitCancel()"), 1, "취소를 확정하는 자리가 둘이 됐다");
    // 도움 함수 안에는 결재·실행이 없다 — 취소 칸이 다른 일을 하지 않는다.
    const helpers =
      bodyAfter("function renderCancelButton(view: PartIssueApprovalRequestView): React.ReactNode {", "  ") +
      bodyAfter("function renderCancelDraft(): React.ReactNode {", "  ");
    for (const forbidden of ["execute(", "submitDecision", "decidePartIssueRequestApprovalAction", '"DECISION"']) {
      assert.ok(!helpers.includes(forbidden), `취소 도움 함수에 ${forbidden} 이 들어갔다`);
    }
  });

  test("🔴 (나) 브라우저 확인 창을 쓰지 않는다 — 결재 칸처럼 카드 안에 펼친다", () => {
    assert.ok(!/\bconfirm\s*\(/.test(approvalScreenSource), "confirm 창을 쓴다");
    assert.ok(!/window\.(confirm|prompt|alert)/.test(approvalScreenSource), "브라우저 창을 쓴다");
    const draftForm = flat(bodyAfter("function renderCancelDraft(): React.ReactNode {", "  "));
    assert.match(draftForm, /\{PART_ISSUE_CANCEL_REASON_LABEL\} <textarea rows=\{2\} value=\{reason\}/);
    assert.match(draftForm, /onClick=\{\(\) => void submitCancel\(\)\}/);
    assert.match(draftForm, /\{busyId !== null \? "처리 중\.\.\." : PART_ISSUE_CANCEL_CONFIRM_LABEL\}/);
    assert.match(draftForm, /onClick=\{\(\) => \{ setDraft\(null\); setReason\(""\); \}\}[^>]*> \{PART_ISSUE_CANCEL_BACK_LABEL\}/);
    // 처리 중에는 이 화면의 관례대로 칸의 두 단추도 막힌다.
    assert.equal(countOf(draftForm, "disabled={busyId !== null}"), 2);
  });

  // ── 확정 — 원본의 submitCancel 몸통을 가짜 액션과 함께 실제로 돌린다 ──
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor;
  const submitCancelBody = bodyAfter("async function submitCancel() {", "  ");
  const submitCancelCompiled = new AsyncFunction(
    "draft",
    "busyId",
    "reason",
    "setBusyId",
    "cancelPartIssueRequestAction",
    "setMessage",
    "setDraft",
    "setReason",
    "router",
    "PART_ISSUE_CANCEL_DONE_MESSAGE",
    submitCancelBody
  ) as (...args: unknown[]) => Promise<void>;

  type CancelDraftValue =
    | { kind: "DECISION"; issueRequestId: string; decision: "APPROVED" | "REJECTED" }
    | { kind: "CANCEL"; issueRequestId: string }
    | null;
  type ActionResult = { ok: true; issueRequestId: string } | { ok: false; code: string; message: string };

  async function runSubmitCancel({
    draft,
    busyId = null,
    reason = "",
    result = { ok: true, issueRequestId: ISSUE_REQUEST_ID },
  }: {
    draft: CancelDraftValue;
    busyId?: string | null;
    reason?: string;
    result?: ActionResult;
  }) {
    const events: string[] = [];
    const sent: unknown[] = [];
    const messages: Array<[string, string, unknown]> = [];
    await submitCancelCompiled(
      draft,
      busyId,
      reason,
      (id: string | null) => events.push(`busy:${id}`),
      async (input: unknown) => {
        sent.push(input);
        events.push("action");
        return result;
      },
      (id: string, message: string, fromCancel: unknown) => {
        messages.push([id, message, fromCancel]);
        events.push("message");
      },
      (value: unknown) => events.push(`draft:${JSON.stringify(value)}`),
      (value: string) => events.push(`reason:${value}`),
      { refresh: () => events.push("refresh") },
      PART_ISSUE_CANCEL_DONE_MESSAGE
    );
    return { events, sent, messages };
  }

  const cancelDraft = { kind: "CANCEL", issueRequestId: ISSUE_REQUEST_ID } as const;

  test("🔴 (다) 확정은 신청 id 와 사유만 보낸다 — 빈 사유는 null", async () => {
    assert.match(
      flat(submitCancelBody),
      /await cancelPartIssueRequestAction\(\{ issueRequestId, reason: reason\.trim\(\) \? reason : null, \}\);/,
      "보내는 모양이 달라졌다"
    );
    for (const [reason, expected] of [
      ["", null],
      ["   ", null],
      ["다른 건에 먼저 씁니다", "다른 건에 먼저 씁니다"],
    ] as const) {
      const { sent } = await runSubmitCancel({ draft: cancelDraft, reason });
      assert.deepEqual(sent, [{ issueRequestId: ISSUE_REQUEST_ID, reason: expected }], `사유 '${reason}'`);
      assert.deepEqual(Object.keys(sent[0] as object).sort(), ["issueRequestId", "reason"], "payload 에 다른 것이 실렸다");
    }
    // 서버 액션에도 그 둘 말고 받을 자리가 없다.
    const inputType = sliceBetween(flat(issueActionSource), "export type CancelPartIssueRequestActionInput = {", "};");
    assert.match(inputType, /^export type CancelPartIssueRequestActionInput = \{ issueRequestId: string; reason\?: string \| null; $/);
    assert.match(
      flat(approvalScreenSource),
      /import \{[^}]*\bcancelPartIssueRequestAction\b[^}]*\} from "@\/lib\/server\/actions\/inventory-part-issue-requests"/
    );
  });

  test("🔴 (라) 실패하면 서버 문구를 **그대로** 그 신청의 결과 줄에 싣고, 칸은 열어 둔다", async () => {
    for (const failure of [
      { ok: false, code: "FORBIDDEN", message: "신청한 사람만 불출 신청을 취소할 수 있습니다." },
      { ok: false, code: "NOT_CANCELLABLE", message: "이미 재고가 나간 신청은 취소할 수 없습니다. 되돌리려면 반품으로 처리해 주세요." },
      { ok: false, code: "CONFLICT", message: "결재가 방금 처리되었습니다. 최신 정보를 다시 불러와 주세요." },
      { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." },
    ] as const) {
      const { events, messages } = await runSubmitCancel({ draft: cancelDraft, result: failure });
      assert.deepEqual(messages, [[ISSUE_REQUEST_ID, failure.message, true]], `${failure.code}: 서버 문구가 바뀌었다`);
      assert.deepEqual(events, [`busy:${ISSUE_REQUEST_ID}`, "action", "busy:null", "message"], `${failure.code}: 실패인데 칸을 닫거나 새로 고친다`);
    }
  });

  test("🔴 (마) 성공하면 결과 한 줄 → 칸 닫기 → 새로 고침", async () => {
    assert.equal(PART_ISSUE_CANCEL_DONE_MESSAGE, "신청을 취소했습니다.");
    const { events, messages } = await runSubmitCancel({ draft: cancelDraft, reason: "사유" });
    assert.deepEqual(messages, [[ISSUE_REQUEST_ID, PART_ISSUE_CANCEL_DONE_MESSAGE, true]]);
    assert.deepEqual(events, [
      `busy:${ISSUE_REQUEST_ID}`,
      "action",
      "busy:null",
      "message",
      "draft:null",
      "reason:",
      "refresh",
    ]);
  });

  test("🔴 처리 중이거나 취소 칸이 아니면 아무것도 보내지 않는다", async () => {
    for (const [name, input] of [
      ["다른 건 처리 중", { draft: cancelDraft, busyId: OTHER_REQUEST_ID }],
      ["열린 칸 없음", { draft: null }],
      ["결재 칸이 열려 있음", { draft: { kind: "DECISION", issueRequestId: ISSUE_REQUEST_ID, decision: "REJECTED" } }],
    ] as const) {
      const { events, sent } = await runSubmitCancel(input);
      assert.deepEqual(sent, [], `${name}: 액션을 불렀다`);
      assert.deepEqual(events, [], `${name}: 상태를 건드렸다`);
    }
  });

  // ── 칸은 하나뿐 — (가)의 조건식과 취소 쪽 몸통을 잘라 같은 draft 로 돌린다 ──
  const decisionOpenExpression = sliceBetween(approvalSection, "actions={ ", " ? (").slice("actions={ ".length);
  const decisionOpenOn = new Function("draft", "view", `return ${decisionOpenExpression};`) as (
    draft: CancelDraftValue,
    view: { detail: { id: string } }
  ) => boolean;
  const cancelOpenOn = new Function(
    "draft",
    "view",
    bodyAfter("function cancelDraftOpenOn(view: PartIssueApprovalRequestView): boolean {", "  ")
  ) as (draft: CancelDraftValue, view: { detail: { id: string } }) => boolean;

  test("🔴 (바) 결재 칸과 취소 칸은 한 상태다 — 어느 값이든 화면 전체에 열리는 칸은 많아야 하나", () => {
    assert.equal(decisionOpenExpression, 'draft?.kind === "DECISION" && draft.issueRequestId === view.detail.id');
    assert.equal(
      (approvalScreenSource.match(/useState<[^>]*Draft[^>]*>/g) ?? []).length,
      1,
      "입력 칸 상태가 둘로 갈라졌다 — 두 칸이 동시에 열릴 수 있다"
    );
    assert.match(screen, /const \[draft, setDraft\] = useState<CardDraft \| null>\(null\);/);
    assert.match(
      screen,
      /type CardDraft = \| \{ kind: "DECISION"; issueRequestId: string; decision: "APPROVED" \| "REJECTED" \} \| \{ kind: "CANCEL"; issueRequestId: string \};/
    );
    // 여는 길 셋(승인 · 반려 · 신청 취소)이 모두 같은 setter 하나로 연다.
    assert.equal(countOf(screen, 'setDraft({ kind: "DECISION", issueRequestId: view.detail.id, decision: '), 2);
    assert.equal(countOf(screen, 'setDraft({ kind: "CANCEL", issueRequestId: view.detail.id })'), 1);

    const cards = [ISSUE_REQUEST_ID, OTHER_REQUEST_ID].map((id) => ({ detail: { id } }));
    const drafts: CancelDraftValue[] = [
      null,
      { kind: "DECISION", issueRequestId: ISSUE_REQUEST_ID, decision: "APPROVED" },
      { kind: "DECISION", issueRequestId: ISSUE_REQUEST_ID, decision: "REJECTED" },
      { kind: "CANCEL", issueRequestId: ISSUE_REQUEST_ID },
      { kind: "CANCEL", issueRequestId: OTHER_REQUEST_ID },
    ];
    for (const draft of drafts) {
      // 같은 신청이 (가)와 (다)에 함께 떠도 두 칸이 동시에 열리지 않는다.
      const open = cards.flatMap((card) => [decisionOpenOn(draft, card), cancelOpenOn(draft, card)]).filter(Boolean);
      assert.equal(open.length, draft === null ? 0 : 1, `draft ${JSON.stringify(draft)}`);
    }
    assert.equal(cancelOpenOn({ kind: "CANCEL", issueRequestId: ISSUE_REQUEST_ID }, cards[0]), true);
    assert.equal(decisionOpenOn({ kind: "CANCEL", issueRequestId: ISSUE_REQUEST_ID }, cards[0]), false, "취소 칸을 열었는데 결재 칸이 펼쳐진다");
  });

  // ── 결과 한 줄 — 누른 카드에만 ──
  const resultLineCompiled = new Function(
    "messages",
    "cancelResultIds",
    "issueRequestId",
    "fromCancel",
    bodyAfter("function resultLineFor(issueRequestId: string, fromCancel: boolean): string | null {", "  ")
  ) as (
    messages: Record<string, string>,
    cancelResultIds: Record<string, boolean>,
    issueRequestId: string,
    fromCancel: boolean
  ) => string | null;

  test("🔴 (사) 결과 한 줄은 누른 카드에만 — 같은 신청이 (가)와 (다)에 함께 떠도 한 번", () => {
    const serverMessage = "결재가 방금 처리되었습니다. 최신 정보를 다시 불러와 주세요.";
    // 취소에서 나온 결과: (다)의 취소 카드에만.
    const afterCancel = [{ [ISSUE_REQUEST_ID]: serverMessage }, { [ISSUE_REQUEST_ID]: true }] as const;
    assert.equal(resultLineCompiled(...afterCancel, ISSUE_REQUEST_ID, true), serverMessage);
    assert.equal(resultLineCompiled(...afterCancel, ISSUE_REQUEST_ID, false), null, "취소 결과가 (가) 카드에도 찍힌다");
    // 결재에서 나온 결과: (가) 카드에만.
    const afterDecision = [{ [ISSUE_REQUEST_ID]: "승인했습니다." }, { [ISSUE_REQUEST_ID]: false }] as const;
    assert.equal(resultLineCompiled(...afterDecision, ISSUE_REQUEST_ID, false), "승인했습니다.");
    assert.equal(resultLineCompiled(...afterDecision, ISSUE_REQUEST_ID, true), null, "결재 결과가 (다) 카드에도 찍힌다");
    // 결과가 없으면 어느 쪽도 비어 있다.
    assert.equal(resultLineCompiled({}, {}, ISSUE_REQUEST_ID, true), null);
    assert.equal(resultLineCompiled({}, {}, ISSUE_REQUEST_ID, false), null);

    // 어느 카드가 어느 쪽을 싣는지.
    assert.ok(approvalSection.includes("message={resultLineFor(view.detail.id, false)}"), "(가) 카드가 결재 결과만 싣지 않는다");
    assert.ok(executionSection.includes("message={messages[view.detail.id] ?? null}"), "(나) 카드의 결과 줄이 달라졌다");
    // 결재·실행은 표시 없이(= 취소 아님), 취소는 표시와 함께 결과를 남긴다.
    assert.match(screen, /function setMessage\(issueRequestId: string, message: string, fromCancel = false\) \{/);
    assert.equal(countOf(screen, ", true);"), 2, "취소 결과를 남기는 자리가 성공 · 실패 둘이 아니다");
    // 읽어 주기 통로는 그대로 — 어느 쪽 결과든 읽힌다.
    assert.match(screen, /<p role="status" aria-live="polite" className="sr-only"> \{Object\.values\(messages\)\.join\(" "\)\} <\/p>/);
  });

  test("단추 모양 — 되돌리는 동작이라 회색 테두리, 반려(빨강)와 섞이지 않는다", () => {
    const cancelButton = flat(bodyAfter("function renderCancelButton(view: PartIssueApprovalRequestView): React.ReactNode {", "  "));
    assert.match(
      cancelButton,
      /className="rounded-md border border-zinc-300 px-3 py-1\.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"/
    );
    assert.match(cancelButton, /disabled=\{busyId !== null\}/, "처리 중에 [신청 취소]가 눌린다");
    const draftForm = bodyAfter("function renderCancelDraft(): React.ReactNode {", "  ");
    for (const [name, source] of [
      ["[신청 취소] 단추", cancelButton],
      ["취소 칸", draftForm],
    ] as const) {
      assert.ok(!/red-|bg-primary/.test(source), `${name}: 반려·승인 색을 썼다`);
    }
  });

  test("문구는 한곳의 상수다 — 화면에 글자로 적지 않는다", () => {
    assert.equal(PART_ISSUE_CANCEL_BUTTON_LABEL, "신청 취소");
    assert.equal(PART_ISSUE_CANCEL_REASON_LABEL, "취소 사유 (선택)");
    assert.equal(PART_ISSUE_CANCEL_CONFIRM_LABEL, "취소 확정");
    assert.equal(PART_ISSUE_CANCEL_BACK_LABEL, "돌아가기");
    assert.ok(
      !/"신청 취소"|"취소 사유|"취소 확정"|"돌아가기"|"신청을 취소했습니다|>\s*(신청 취소|취소 확정|돌아가기)\s*</.test(approvalScreenSource),
      "문구를 화면에 글자로 적었다"
    );
    assert.match(read("src/components/inventory/part-issue-approval-texts.ts"), /\[신청 취소\]와 그 입력 칸 — 승인 요청건 탭/);
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
