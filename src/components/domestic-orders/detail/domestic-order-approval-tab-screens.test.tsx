import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import DomesticOrderApprovalHistory, {
  domesticOrderDecidedByLabel,
} from "./DomesticOrderApprovalHistory";
import {
  DOMESTIC_ORDER_APPROVAL_BLOCKS_COMPLETION_NOTICE,
  DOMESTIC_ORDER_APPROVAL_EMPTY_HISTORY_TEXT,
  DOMESTIC_ORDER_APPROVAL_STALE_NOTICE,
} from "./domestic-order-approval-texts";
import ApprovalRouteDiagram, {
  DONE_MARK,
  SKIPPED_MARK,
  UPCOMING_MARK,
  markForRouteStep,
} from "@/components/approvals/ApprovalRouteDiagram";
import DatabaseApprovalCard from "@/components/repair-cases/approval/DatabaseApprovalCard";
import type { DomesticOrderApprovalRecordRow } from "@/lib/db/queries/domestic-order-approvals";
import {
  DOMESTIC_ORDER_APPROVAL_LABEL,
  DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE,
  isDomesticOrderApprovalRequestable,
  isDomesticOrderApprovalRouteInForce,
} from "@/lib/domain/domestic-order-approval-rules";
import { SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS } from "@/lib/domain/shipment-approval-route";

/**
 * ============================================================================
 * 기타건 상세 [승인] 탭 — 수리 건 승인 카드와 **같은 모양**인가 (2026-11-06)
 * ============================================================================
 * 🔴 사용자가 스크린샷으로 모양을 지정했다(「이런 형태의 승인탭이 되었으면 좋겠어.
 * 결재선이 그림으로 나타나고」). 그래서 여기서 재는 것의 절반은 **「새로 그리지
 * 않았는가」**다 — 껍데기와 결재선 그림을 수리 건 카드와 **같은 조각**으로 쓰는가.
 *
 * 🔴 **패널 자체는 그려 볼 수 없다.** 서버 액션을 물고 그 사슬 끝에 `server-only` 가
 * 있다(견적서 결재 패널과 같은 사정). 그래서 둘로 나눠 잰다:
 *  · 서버 액션을 물지 않는 조각(결재선 그림 · 껍데기 · 이력 · 문구)은 **그려 본다.**
 *  · 패널과 페이지는 **원본을 글자로 읽는다.** 🔴 **주석을 걷어낸 뒤에 센다** — 이
 *    저장소의 파일들은 「왜 그렇게 했는가」를 길게 적어 두고 그 글에 함수 이름이
 *    그대로 들어 있다. 걷어내지 않으면 「판정을 공용 함수로 한다」가 **주석만으로
 *    통과한다.**
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");

const flat = (source: string) => source.replace(/\s+/g, " ");

const panel = flat(
  stripComments(read("src/components/domestic-orders/detail/DomesticOrderApprovalPanel.tsx"))
);
const shipmentCard = flat(
  stripComments(read("src/components/repair-cases/approval/DatabaseFinalShipmentCard.tsx"))
);
const approvalPage = flat(
  stripComments(read("src/app/(app)/domestic-orders/[id]/approval/page.tsx"))
);
const mutationSource = stripComments(read("src/lib/db/mutations/domestic-order-approvals.ts"));
const actionSource = stripComments(read("src/lib/server/actions/domestic-order-approvals.ts"));

function record(
  overrides: Partial<DomesticOrderApprovalRecordRow> = {}
): DomesticOrderApprovalRecordRow {
  return {
    id: "approval-1",
    status: "REQUESTED",
    requestedByUserId: "user-requester",
    // 🔴 가짜 이름만 쓴다 — 이 저장소는 공개이고, 스크린샷의 이름들은 운영 계정이다.
    requestedByName: "요청한사람",
    requestedAt: "2096-03-10T01:00:00.000Z",
    requestReason: null,
    assignedApproverUserId: "user-step-a",
    assignedApproverName: "일단계",
    routeId: "route-1",
    routeStepOrder: 1,
    decidedByUserId: null,
    decidedByName: null,
    decidedAt: null,
    decisionReason: null,
    delegatedFromUserId: null,
    delegatedFromName: null,
    versionAtRequest: 3,
    // 🔴 2026-11-08 — 승인이 가리키는 회차. 기본 표본은 1차다.
    dueDateRowOrder: 1,
    ...overrides,
  };
}

describe("🔴 결재선 그림 — 수리 건 카드와 **같은 조각**이다", () => {
  test("두 화면이 같은 모듈을 가져다 쓴다 — 베껴 두 벌을 만들지 않았다", () => {
    for (const [name, source] of [
      ["기타건 승인 패널", panel],
      ["수리 건 최종 출하 승인 카드", shipmentCard],
    ] as const) {
      assert.match(
        source,
        /import ApprovalRouteDiagram, \{ markForRouteStep \} from "@\/components\/approvals\/ApprovalRouteDiagram"/,
        `${name}: 공용 결재선 그림을 쓰지 않는다`
      );
      assert.ok(
        source.includes("<ApprovalRouteDiagram steps={previewSteps} />"),
        `${name}: 그림을 그리지 않는다`
      );
      assert.ok(
        source.includes("{previewSteps.length > 0 &&"),
        `${name}: 단계가 0개일 때도 빈 칸을 그린다`
      );
    }
    // 🔴 색·글자 짝이 두 벌로 갈라지지 않았는지 — 화면 어느 쪽에도 남아 있으면 안 된다.
    for (const [name, source] of [
      ["기타건 승인 패널", panel],
      ["수리 건 최종 출하 승인 카드", shipmentCard],
    ] as const) {
      assert.ok(!source.includes("const DONE_MARK"), `${name}: 색·글자 짝을 또 적었다`);
      assert.ok(!source.includes("function markForRouteStep("), `${name}: 판정을 또 적었다`);
    }
  });

  test("🔴 상자 · ▶ · 「n단계 · 상태」가 실제로 그려진다", () => {
    const html = renderToStaticMarkup(
      <ApprovalRouteDiagram
        steps={[
          { stepOrder: 1, approverName: "일단계", ...SKIPPED_MARK },
          { stepOrder: 2, approverName: "이단계", ...DONE_MARK },
          { stepOrder: 3, approverName: "삼단계", ...UPCOMING_MARK },
        ]}
      />
    );
    assert.ok(html.includes("결재선"), html);
    for (const name of ["일단계", "이단계", "삼단계"]) assert.ok(html.includes(name), html);
    // ▶ 는 상자 **사이**에만 — 셋이면 둘이다.
    assert.equal(html.split("▶").length - 1, 2, html);
    assert.ok(html.includes("1단계 · 건너뜀 · 요청자 본인"), html);
    assert.ok(html.includes("2단계 · 완료"), html);
    assert.ok(html.includes("3단계 · 대기"), html);
    // 가로로 길어져도 그 상자 안에서만 밀린다.
    assert.ok(html.includes("overflow-x-auto"), html);
  });

  test("🔴 색만으로 상태를 구분하지 않는다 — 칸마다 글자가 함께 붙는다", () => {
    for (const mark of [
      markForRouteStep(1, 1, "REQUESTED", false),
      markForRouteStep(1, 2, "REQUESTED", false),
      markForRouteStep(2, 1, "REQUESTED", false),
      markForRouteStep(1, 1, "REJECTED", false),
      markForRouteStep(1, 1, "STALE", false),
      markForRouteStep(1, 2, "REQUESTED", true),
    ]) {
      assert.ok(mark.stateLabel.trim().length > 0, JSON.stringify(mark));
      assert.ok(mark.toneClass.trim().length > 0, JSON.stringify(mark));
    }
    // 건너뛴 칸이 「완료」로 보이면 거짓말이다 — 아무도 승인하지 않았다.
    assert.equal(markForRouteStep(1, 2, "REQUESTED", true), SKIPPED_MARK);
    // 지금 단계 자신은 건너뜀으로 칠하지 않는다.
    assert.notEqual(markForRouteStep(2, 2, "REQUESTED", true), SKIPPED_MARK);
  });
});

describe("🔴 회색 상자 — 「사내 목표 완료일」은 수리 건에만 있다", () => {
  /**
   * 🔴 **두 쪽을 다 잰다.** 한쪽만 재면 틀을 잘못 뽑았을 때 조용히 통과한다 —
   * 기타건에서만 보면 「원래 안 그리는 코드」와 구별되지 않고, 수리 건에서만 보면
   * 기타건에 빈 줄이 남아도 모른다.
   */
  test("기타건 카드에는 그 줄이 **없다**", () => {
    assert.ok(
      !panel.includes("사내 목표 완료일"),
      "기타건에는 대응하는 값이 없다(2026-11-06 사용자 확인) — 빈 값으로 두지 말고 줄을 뺀다"
    );
    assert.ok(
      !panel.includes("UNSET_TARGET_SHIPMENT_DATE_TEXT"),
      "기타건이 접수 건의 빈 값 문구를 끌어다 쓴다"
    );
    assert.ok(
      !panel.includes("internalTargetShipmentDate"),
      "쓰지 않을 프롭이 남아 있다 — 언젠가 그 자리를 억지로 채우는 코드가 생긴다"
    );
  });

  test("수리 건 카드에는 그 줄이 **그대로 있다**", () => {
    assert.ok(
      shipmentCard.includes('<dt className="text-xs text-zinc-500 dark:text-zinc-400">사내 목표 완료일</dt>'),
      "공용으로 뽑아내면서 수리 건의 줄을 함께 지웠다"
    );
    assert.ok(
      shipmentCard.includes("{internalTargetShipmentDate ?? UNSET_TARGET_SHIPMENT_DATE_TEXT}"),
      "수리 건의 빈 값 문구가 사라졌다"
    );
  });

  test("🔵 상자 자체는 둘 다 있다 — 결재선 진행 줄은 양쪽에 산다", () => {
    for (const [name, source] of [
      ["기타건 승인 패널", panel],
      ["수리 건 최종 출하 승인 카드", shipmentCard],
    ] as const) {
      assert.match(
        source,
        /<dl className="grid grid-cols-1 gap-x-4 gap-y-2 break-keep rounded-md bg-zinc-50/,
        `${name}: 회색 상자가 사라졌다`
      );
      assert.ok(source.includes("결재선 진행"), `${name}: 진행 줄이 사라졌다`);
    }
  });
});

describe("🔴 껍데기 — 수리 건 승인 카드를 그대로 쓴다", () => {
  test("패널이 DatabaseApprovalCard 에 머리·상태·단추·노란 띠를 넘긴다", () => {
    assert.match(
      panel,
      /import DatabaseApprovalCard, \{ type DatabaseApprovalActionButton, \} from "@\/components\/repair-cases\/approval\/DatabaseApprovalCard"/,
      "껍데기를 베껴 두 벌을 만들었다"
    );
    for (const prop of [
      "title={DOMESTIC_ORDER_APPROVAL_LABEL}",
      "record={latest}",
      "displayStatus={displayStatus}",
      "extra={extra}",
      "blockedNotice={blockedNotice}",
      "actions={actions}",
      "disabledReason={disabledReason}",
    ]) {
      assert.ok(panel.includes(prop), `껍데기에 ${prop} 를 넘기지 않는다`);
    }
  });

  test("🔴 껍데기가 기타건 줄도 그대로 받는다 — 두 칸 표와 사유 둘", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title={DOMESTIC_ORDER_APPROVAL_LABEL}
        record={record({
          status: "REJECTED",
          requestReason: "출하 승인 부탁드립니다",
          decisionReason: "금액이 맞지 않습니다",
          decidedByUserId: "user-step-a",
          decidedByName: "일단계",
          decidedAt: "2096-03-11T01:00:00.000Z",
        })}
        displayStatus="REJECTED"
        actions={[]}
      />
    );
    assert.ok(html.includes(DOMESTIC_ORDER_APPROVAL_LABEL), html);
    for (const label of ["요청자", "승인자", "지정 승인자", "요청 시각", "결정 시각", "요청 사유", "결정 사유"]) {
      assert.ok(html.includes(label), `${label} 칸이 없다 — ${html}`);
    }
    assert.ok(html.includes("요청한사람"), html);
    assert.ok(html.includes("금액이 맞지 않습니다"), html);
    // 상태 배지도 같은 것을 쓴다 — 「반려」 글자가 그대로 나온다.
    assert.ok(html.includes("반려"), html);
  });

  test("🔴 노란 띠(비상구 안내)가 카드 **안**에 그려진다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title={DOMESTIC_ORDER_APPROVAL_LABEL}
        record={null}
        displayStatus="REQUESTED"
        blockedNotice="지금 차례는 일단계 님입니다. 최고관리자 권한으로 대신 처리합니다."
        actions={[]}
      />
    );
    const notice = html.indexOf("최고관리자 권한으로 대신 처리합니다.");
    assert.ok(notice >= 0, html);
    assert.ok(notice < html.indexOf("</section>"), "카드 밖으로 나갔다");
    assert.ok(html.includes("bg-amber-50"), "주의 계열 색이 아니다");
  });

  test("🔴 패널이 두 안내를 **까닭에 따라** 갈라 적는다 — 위임과 비상구", () => {
    assert.ok(panel.includes("위임받은 결재권으로 대신 처리합니다."), panel);
    assert.ok(panel.includes("최고관리자 권한으로 대신 처리합니다."), panel);
    assert.match(panel, /delegatedFromUserId \? `지금 차례는/, "까닭을 가르지 않고 한 말만 한다");
  });
});

describe("승인 이력", () => {
  test("한 줄도 없으면 까닭을 적는다 — 조용한 빈 상자가 아니다", () => {
    const html = renderToStaticMarkup(<DomesticOrderApprovalHistory records={[]} />);
    assert.ok(html.includes(DOMESTIC_ORDER_APPROVAL_EMPTY_HISTORY_TEXT), html);
  });

  test("🔴 「n/m단계」는 **그 줄에 적힌 판**으로 센다", () => {
    const html = renderToStaticMarkup(
      <DomesticOrderApprovalHistory
        records={[record({ routeId: "route-old", routeStepOrder: 2 })]}
        routeSteps={[
          {
            routeId: "route-old",
            steps: [
              { stepOrder: 1, approverUserId: "a", approverName: "가단계" },
              { stepOrder: 2, approverUserId: "b", approverName: "나단계" },
            ],
          },
          // 지금 판은 넷이지만 그 줄은 옛 판을 끝까지 따라간다.
          {
            routeId: "route-new",
            steps: [
              { stepOrder: 1, approverUserId: "a", approverName: "가단계" },
              { stepOrder: 2, approverUserId: "b", approverName: "나단계" },
              { stepOrder: 3, approverUserId: "c", approverName: "다단계" },
              { stepOrder: 4, approverUserId: "d", approverName: "라단계" },
            ],
          },
        ]}
      />
    );
    assert.ok(html.includes("결재선 2/2단계"), html);
    assert.ok(!html.includes("2/4단계"), `현재 판으로 셌다 — ${html}`);
  });

  test("🔴 위임으로 대신 누른 줄과 최고관리자 비상구가 **글자로 갈라진다**", () => {
    assert.equal(
      domesticOrderDecidedByLabel({ decidedByName: "대리인", delegatedFromName: "결재권자" }),
      "대리인 (결재권자 님 자리를 위임받아 처리)"
    );
    // 비상구 — 괄호가 없다. 그 없음이 유일한 구분이다.
    assert.equal(
      domesticOrderDecidedByLabel({ decidedByName: "최고관리자", delegatedFromName: null }),
      "최고관리자"
    );
    assert.equal(domesticOrderDecidedByLabel({ decidedByName: null, delegatedFromName: null }), null);

    const html = renderToStaticMarkup(
      <DomesticOrderApprovalHistory
        records={[
          record({
            status: "APPROVED",
            decidedByUserId: "user-admin",
            decidedByName: "최고관리자",
            decidedAt: "2096-03-11T01:00:00.000Z",
          }),
        ]}
      />
    );
    assert.ok(html.includes("지정자 대신 처리"), html);
    assert.ok(html.includes("최고관리자"), html);
  });
});

describe("🔴 결재선 판이 0개일 때 — 조용한 빈 카드가 아니다", () => {
  test("판 없음 · 단계 0개를 같게 본다", () => {
    assert.equal(isDomesticOrderApprovalRouteInForce(null), false);
    assert.equal(isDomesticOrderApprovalRouteInForce({ steps: [] }), false);
    assert.equal(isDomesticOrderApprovalRouteInForce({ steps: [{}] }), true);
  });

  test("🔴 안내문이 **무엇이 없고 어디서 만드는지**를 말한다", () => {
    const notice = DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE;
    assert.ok(notice.includes(DOMESTIC_ORDER_APPROVAL_LABEL), notice);
    assert.ok(notice.includes("사용자 관리"), notice);
    assert.ok(notice.includes("승인 절차"), notice);
  });

  test("🔴 카드가 그 안내를 노란 띠로 내밀고 올리기 단추를 그리지 않는다", () => {
    assert.match(
      panel,
      /if \(!isRouteConfigured\) \{ blockedNotice = DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE;/,
      "결재선이 없을 때의 갈래가 사라졌다"
    );
    // 🔴 그 갈래에서는 actions 를 채우지 않는다 — else if 로 갈라져 있어야 한다.
    assert.match(
      panel,
      /blockedNotice = DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE; \} else if \(canRequestApproval\) \{ actions\.push\(/,
      "결재선이 없는데도 올리기 단추를 만든다"
    );
  });

  test("🔴 서버가 거절할 때도 **같은 한 줄**을 쓴다 — 두 곳이 갈라지지 않는다", () => {
    assert.match(
      mutationSource,
      /fail\(\s*"ROUTE_NOT_CONFIGURED",\s*DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE\s*\)/,
      "저장 경로가 제 글자를 따로 적었다"
    );
  });
});

describe("올릴 수 있는 상태 · 그릴 말", () => {
  test("🔴 APPROVED 에서는 막고 STALE 에서는 다시 열린다", () => {
    assert.equal(isDomesticOrderApprovalRequestable("NOT_REQUESTED"), true);
    assert.equal(isDomesticOrderApprovalRequestable("REJECTED"), true);
    assert.equal(isDomesticOrderApprovalRequestable("STALE"), true);
    // 🔴 지금 내용 그대로 승인이 살아 있는데 또 올리면 방금 받은 승인을 스스로 지운다.
    assert.equal(isDomesticOrderApprovalRequestable("APPROVED"), false);
    // 진행 중이면 서버가 ALREADY_REQUESTED 로 거절한다.
    assert.equal(isDomesticOrderApprovalRequestable("PENDING"), false);
  });

  test("🔴 STALE 이면 「왜 다시 받아야 하는가」를 적는다", () => {
    assert.ok(panel.includes("blockedNotice = DOMESTIC_ORDER_APPROVAL_STALE_NOTICE;"), panel);
    assert.match(DOMESTIC_ORDER_APPROVAL_STALE_NOTICE, /수정되어/);
  });

  test("🔴 이름표는 [사용자 관리] 고르개와 **같은 한 곳**에서 온다", () => {
    assert.equal(
      DOMESTIC_ORDER_APPROVAL_LABEL,
      SHIPMENT_APPROVAL_ROUTE_SCOPE_LABELS.DOMESTIC_ORDER_FINAL_SHIPMENT
    );
    assert.ok(
      !panel.includes('"기타건 최종 출하 승인"'),
      "이름표가 화면에 글자로 적혔다 — 한 곳에서만 와야 한다"
    );
  });

  /**
   * 🔴 2026-11-07 에 **뜻이 뒤집힌** 한 줄이다. 어제까지는 「승인 상태와 상관없이
   * 완료 처리·납품은 그대로 진행할 수 있습니다」였고, 사용자 결정으로 승인이 [완료]를
   * 막게 되면서 그 문장이 거짓이 됐다.
   *
   * 🔴 그래서 「무엇이 적혀 있는가」만 재지 않는다 — **옛 말이 돌아오지 않는가**도
   * 함께 잰다. 뜻이 반대인 두 문장은 둘 다 「완료 처리」라는 낱말을 품고 있어서,
   * 낱말만 재는 시험은 어느 쪽이 서 있어도 초록이다.
   */
  test("🔴 「이 승인이 완료 처리를 막는다」를 카드 위에 적는다", () => {
    assert.ok(panel.includes("{DOMESTIC_ORDER_APPROVAL_BLOCKS_COMPLETION_NOTICE}"), panel);
    assert.match(DOMESTIC_ORDER_APPROVAL_BLOCKS_COMPLETION_NOTICE, /\[완료\] 처리할 수 있습니다/);
    assert.doesNotMatch(
      DOMESTIC_ORDER_APPROVAL_BLOCKS_COMPLETION_NOTICE,
      /상관없이|그대로 진행할 수 있습니다/,
      "승인과 상관없이 완료된다는 옛 말이 돌아왔다 — 2026-11-07 부터 거짓이다"
    );
  });

  /**
   * 🔵 뒤집히지 않은 쪽. 막는 방향은 **한쪽뿐**이다 — 승인이 완료를 막지, 완료가
   * 승인을 막지 않는다(2026-11-06 결정이 그대로 유효하다). 이 한 줄이 그 사실을
   * 사람에게 전하지 않으면, 완료된 옛 줄의 승인을 올리러 온 사람이 되돌아간다.
   */
  test("🔵 「완료된 줄에서도 승인은 올릴 수 있다」가 그 한 줄에 함께 있다", () => {
    assert.match(DOMESTIC_ORDER_APPROVAL_BLOCKS_COMPLETION_NOTICE, /이미 완료된 줄에서도/);
  });
});

describe("🔴 판정을 화면에서 새로 적지 않는다", () => {
  test("지정 관문 · 위임 · 결재선 여부 · 건너뜀이 전부 공용 함수다", () => {
    for (const fn of [
      "mayDecideAssignedApproval(",
      "approvalFollowsRoute(",
      "delegatedFromUserIdFor(",
      "standsInForAssignedApprover(",
      "isRouteStepSkippedForRequester(",
    ]) {
      assert.ok(panel.includes(fn), `화면이 ${fn} 를 부르지 않는다 — 판정을 새로 적었다`);
    }
    // 🔴 서버도 **같은 함수**를 부른다. 두 곳이 갈라지면 「단추는 보이는데 누르면
    //    거절」이나 그 반대가 된다.
    for (const fn of [
      "mayDecideAssignedApproval(",
      "delegatedFromUserIdFor(",
      "findNextRouteStepToApprove(",
    ]) {
      assert.ok(mutationSource.includes(fn), `저장 경로가 ${fn} 를 부르지 않는다`);
    }
  });

  test("🔴 승인 흐름을 새로 짜지 않았다 — 기존 결재선 조회를 그대로 쓴다", () => {
    assert.ok(mutationSource.includes("getCurrentShipmentApprovalRouteChain("), mutationSource);
    assert.ok(mutationSource.includes("getShipmentApprovalRouteSteps("), mutationSource);
    assert.ok(mutationSource.includes("acquireShipmentApprovalRouteSharedLock("), mutationSource);
    assert.ok(mutationSource.includes("resolveActingApproverUserIds("), mutationSource);
  });

  test("🔴 기타건에는 워크플로 자동 전환이 없다", () => {
    assert.ok(
      !mutationSource.includes("autoAdvanceToShipmentWaitingInTx"),
      "옮길 단계가 없는데 워크플로 전환을 부른다"
    );
  });

  test("🔴 접수 건 결재 경로를 건드리지 않는다", () => {
    assert.ok(
      !mutationSource.includes("repairCaseId:"),
      "기타건 저장 경로가 접수 건 칸을 쓴다 — 표의 CHECK 가 막는 바로 그 모양이다"
    );
  });
});

describe("🔴 인가 — 화면이 감춘 것은 관문이 아니다", () => {
  test("페이지가 영역 가드와 쓰기 열쇠를 **제자리에서** 다시 본다", () => {
    assert.ok(
      approvalPage.includes('requireAreaAccessForCurrentUser("domesticOrders")'),
      "탭 페이지가 영역 가드를 부르지 않는다"
    );
    assert.ok(
      approvalPage.includes('hasPermission(actingUser, "domesticOrders", "WRITE")'),
      "올릴 수 있는가를 페이지가 묻지 않는다"
    );
    assert.ok(
      approvalPage.includes("resolveActingUserForSession(session)"),
      "살아 있는 계정을 다시 읽지 않는다 — 강등된 계정이 옛 토큰으로 다닌다"
    );
  });

  test("🔴 올리기는 `domesticOrders` WRITE, 결재는 영역을 묻지 않는다", () => {
    assert.match(actionSource, /requestDomesticOrderApprovalAction[\s\S]*?resolveActor\(true\)/);
    assert.match(actionSource, /decideDomesticOrderApprovalAction[\s\S]*?resolveActor\(false\)/);
    // 저장 경로도 올리기에서만 영역을 본다.
    assert.equal(
      (mutationSource.match(/hasPermission\(/g) ?? []).length,
      1,
      "결재 쪽에도 영역 열쇠가 걸렸다 — 결재선에 올린 사람이 못 누르게 된다"
    );
    assert.match(mutationSource, /hasPermission\(actor, "domesticOrders", "WRITE"\)/);
  });
});
