import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  checkShipmentApprovalChainCompleted,
  decideShipmentWaitingAutoAdvance,
  findShipmentWaitingAdvanceTransition,
  FINAL_SHIPMENT_APPROVAL_TYPE,
  SHIPMENT_WAITING_APPROVAL_TYPES,
  SHIPMENT_WAITING_AUTO_ONLY_MESSAGE,
  SHIPMENT_WAITING_REPAIR_STATUS,
  type ShipmentWaitingTransition,
} from "./shipment-waiting-auto-advance";
import { REPAIR_CASE_APPROVAL_TYPES } from "../validation/repair-case-approval-input";
import { REPAIR_STATUS_CODES } from "./types";
// 🔴 도메인 시험이 db 층을 하나 가져오는 유일한 줄이다. 이력에 남는 **표시와
// 문장**은 그것을 쓰는 INSERT 바로 옆에 있어야 해서 mutation 쪽에 두었고
// (출하 완료 되돌리기의 SHIPMENT_COMPLETION_REVERT_METADATA 와 같은 관례),
// 그 값이 곧 「시스템이 옮겼다」를 사람과 코드에 알리는 열쇠라 여기서 함께 잰다.
// 그 모듈은 `server-only` 라 unit 목록(--conditions=react-server)에서만 불린다.
import {
  SHIPMENT_WAITING_AUTO_ADVANCE_METADATA,
  SHIPMENT_WAITING_AUTO_ADVANCE_REASON,
} from "../db/mutations/shipment-waiting-auto-advance";

/**
 * ============================================================================
 * 출하 승인이 모두 끝나면 [출하 대기]로 — 「옮기는가 · 왜 안 옮기는가」 (2026-11-03)
 * ============================================================================
 * 사용자 요구: 「출하 승인이 모두 끝나면 단계가 자동적으로 [출하 대기]로 바뀌도록
 * 해줘. (출하대기는 자동으로만 넘어가도록 해줘.)」
 *
 * 🔴 이 판정이 **참·거짓이 아니라 까닭**을 돌려주는 것이 규약이라, 시험도 「안
 * 움직였다」가 아니라 **어느 까닭으로 안 움직였는가**를 하나씩 못 박는다. 까닭이
 * 뭉개지면 「승인이 반려됐는데 사슬이 안 이어졌으니 끝난 것」 같은 조용한 오독이
 * 생긴다.
 *
 * 🔴 **못 박는 것**
 *  ① 결재선을 타지 않는 건 — 승인 한 번이 곧 마지막이다.
 *  ② 결재선을 타는 건 — 다음 단계가 열렸으면 **아직** 끝난 것이 아니다.
 *  ③ 🔴 **한 단계라도 반려되면 안 넘어간다** — 사슬이 안 이어진 것과 가른다.
 *  ④ 수리 검수 승인은 이 전환과 무관하다.
 *  ⑤ 🔴 **이 워크플로에 출하 대기가 없으면 아무 일도 없다** — 실측으로 제너레이터·
 *     토탈컨트롤러 넷이 그렇다.
 *  ⑥ 🔴 **이미 출하 대기인 건은 건드리지 않는다**(사용자 지시).
 *  ⑦ 먼 단계에 서 있으면 뛰지 않는다.
 *  ⑧ 보류 중·출하 완료 잠금이면 안 옮긴다.
 *  ⑨ 갈 단계를 **글자로 박지 않는다** — 전이표를 갈아끼우면 도착지가 따라간다.
 * ============================================================================
 */

/**
 * 실측(2026-11-03, transition-definitions.ts)의 PAID_MATCHER 꼬리를 그대로 옮긴
 * 표본. 🔴 출하 대기로 들어가는 **정규 진행**은 한 줄뿐이고, 되돌리기와 출하 완료가
 * 그 옆에 있다 — 셋을 섞어 두어야 「진행 전이만 본다」가 실제로 재진다.
 */
const MATCHER_TRANSITIONS: readonly ShipmentWaitingTransition[] = [
  {
    actionCode: "STEP_ADVANCED",
    fromStepKey: "waiting_kyosan_shipment_approval",
    toStepKey: "shipment_approved",
    toStatus: "WAITING_SHIPMENT_APPROVAL",
  },
  {
    actionCode: "STEP_ADVANCED",
    fromStepKey: "shipment_approved",
    toStepKey: "waiting_shipment",
    toStatus: "WAITING_SHIPMENT",
  },
  {
    actionCode: "STEP_RETURNED",
    fromStepKey: "waiting_shipment",
    toStepKey: "shipment_approved",
    toStatus: "WAITING_SHIPMENT_APPROVAL",
  },
  {
    actionCode: "SHIPMENT_COMPLETED",
    fromStepKey: "waiting_shipment",
    toStepKey: "shipment_completed",
    toStatus: "SHIPMENT_COMPLETED",
  },
];

/** 제너레이터 꼬리 — 출하 승인 다음이 바로 출하 완료다. 출하 대기 단계가 없다. */
const GENERATOR_TRANSITIONS: readonly ShipmentWaitingTransition[] = [
  {
    actionCode: "STEP_ADVANCED",
    fromStepKey: "waiting_kyosan_shipment_approval",
    toStepKey: "shipment_approved",
    toStatus: "WAITING_SHIPMENT_APPROVAL",
  },
  {
    actionCode: "SHIPMENT_COMPLETED",
    fromStepKey: "shipment_approved",
    toStepKey: "shipment_completed",
    toStatus: "SHIPMENT_COMPLETED",
  },
];

function decide(overrides: {
  approvalType?: string;
  decision?: "APPROVED" | "REJECTED";
  hasNextRouteStep?: boolean;
  isCaseLocked?: boolean;
  isOnHold?: boolean;
  currentStepKey?: string;
  transitions?: readonly ShipmentWaitingTransition[];
} = {}) {
  return decideShipmentWaitingAutoAdvance({
    approvalType: "FINAL_SHIPMENT",
    decision: "APPROVED",
    hasNextRouteStep: false,
    isCaseLocked: false,
    isOnHold: false,
    currentStepKey: "shipment_approved",
    transitions: MATCHER_TRANSITIONS,
    ...overrides,
  });
}

describe("표본 점검 — 무엇을 재고 있는지 먼저 못 박는다", () => {
  test("표본의 매쳐 꼬리에 출하 대기로 들어가는 진행 전이가 실제로 한 줄 있다", () => {
    const found = findShipmentWaitingAdvanceTransition(MATCHER_TRANSITIONS);
    assert.ok(found, "표본에 그 전이가 없다 — 아래 시험들이 빈 표본을 재게 된다");
    assert.equal(found.fromStepKey, "shipment_approved");
    assert.equal(found.toStepKey, "waiting_shipment");
  });

  test("제너레이터 표본에는 그 전이가 없다", () => {
    assert.equal(findShipmentWaitingAdvanceTransition(GENERATOR_TRANSITIONS), null);
  });

  test("기본 입력은 「옮긴다」다 — 아래 시험들이 조건 하나씩만 뒤집는다", () => {
    assert.deepEqual(decide(), {
      move: true,
      fromStepKey: "shipment_approved",
      toStepKey: "waiting_shipment",
    });
  });
});

describe("값이 갈라지지 않는다 — 여기 적어 둔 한 벌이 원본과 같은가", () => {
  test("승인 종류 목록이 검증 층의 것과 글자까지 같다", () => {
    assert.deepEqual(
      [...SHIPMENT_WAITING_APPROVAL_TYPES],
      [...REPAIR_CASE_APPROVAL_TYPES],
      "도메인에 베껴 둔 승인 종류가 검증 층과 갈라졌다"
    );
    assert.ok(SHIPMENT_WAITING_APPROVAL_TYPES.includes(FINAL_SHIPMENT_APPROVAL_TYPE));
  });

  test("「출하 대기」 상태 이름이 실제 상태 목록에 있는 값이다", () => {
    assert.ok(
      (REPAIR_STATUS_CODES as readonly string[]).includes(SHIPMENT_WAITING_REPAIR_STATUS),
      "없는 상태를 가리키면 그 전이를 영영 못 찾는다 — 오류 없이 조용히 안 돈다"
    );
  });
});

describe("「모두 끝났는가」 — 결재 쪽만 보는 1차 관문", () => {
  test("① 결재선을 타지 않는 건은 승인 한 번이 곧 마지막이다", () => {
    assert.deepEqual(
      checkShipmentApprovalChainCompleted({
        approvalType: "FINAL_SHIPMENT",
        decision: "APPROVED",
        hasNextRouteStep: false,
      }),
      { completed: true }
    );
  });

  test("② 다음 단계가 열렸으면 아직 끝난 것이 아니다", () => {
    assert.deepEqual(
      checkShipmentApprovalChainCompleted({
        approvalType: "FINAL_SHIPMENT",
        decision: "APPROVED",
        hasNextRouteStep: true,
      }),
      { completed: false, reason: "ROUTE_HAS_NEXT_STEP" }
    );
  });

  test("③ 🔴 반려는 「안 끝남」이 아니라 **반려**다 — 사슬이 안 이어진 것과 가른다", () => {
    const rejected = checkShipmentApprovalChainCompleted({
      approvalType: "FINAL_SHIPMENT",
      decision: "REJECTED",
      hasNextRouteStep: false,
    });
    assert.deepEqual(rejected, { completed: false, reason: "NOT_APPROVED" });
  });

  test("④ 수리 검수 승인은 이 전환과 무관하다", () => {
    assert.deepEqual(
      checkShipmentApprovalChainCompleted({
        approvalType: "REPAIR_INSPECTION",
        decision: "APPROVED",
        hasNextRouteStep: false,
      }),
      { completed: false, reason: "NOT_FINAL_SHIPMENT" }
    );
  });
});

describe("옮기는가 — 전체 판정", () => {
  test("🔴 한 단계라도 반려되면 안 넘어간다", () => {
    assert.deepEqual(decide({ decision: "REJECTED" }), { move: false, reason: "NOT_APPROVED" });
  });

  test("🔴 결재선 중간 승인에서는 안 넘어간다", () => {
    assert.deepEqual(decide({ hasNextRouteStep: true }), {
      move: false,
      reason: "ROUTE_HAS_NEXT_STEP",
    });
  });

  test("수리 검수 승인에서는 안 넘어간다", () => {
    assert.deepEqual(decide({ approvalType: "REPAIR_INSPECTION" }), {
      move: false,
      reason: "NOT_FINAL_SHIPMENT",
    });
  });

  test("🔴 이 워크플로에 출하 대기가 없으면 아무 일도 없다 — 제너레이터·토탈컨트롤러", () => {
    assert.deepEqual(decide({ transitions: GENERATOR_TRANSITIONS }), {
      move: false,
      reason: "NO_SHIPMENT_WAITING_STEP",
    });
  });

  test("🔴 이미 출하 대기인 건은 건드리지 않는다", () => {
    assert.deepEqual(decide({ currentStepKey: "waiting_shipment" }), {
      move: false,
      reason: "ALREADY_SHIPMENT_WAITING",
    });
  });

  test("🔴 먼 단계에 서 있으면 뛰지 않는다 — 승인 기록만으로 단계를 건너뛰지 않는다", () => {
    assert.deepEqual(decide({ currentStepKey: "intake_inspection" }), {
      move: false,
      reason: "NOT_AT_PRECEDING_STEP",
    });
    assert.deepEqual(decide({ currentStepKey: "waiting_kyosan_shipment_approval" }), {
      move: false,
      reason: "NOT_AT_PRECEDING_STEP",
    });
  });

  test("🔴 출하 완료로 잠긴 건은 안 옮긴다", () => {
    assert.deepEqual(decide({ isCaseLocked: true, currentStepKey: "shipment_completed" }), {
      move: false,
      reason: "CASE_LOCKED",
    });
  });

  test("🔴 보류 중이면 안 옮긴다 — 사람이 못 옮기는 자리를 시스템이 몰래 옮기지 않는다", () => {
    assert.deepEqual(decide({ isOnHold: true }), { move: false, reason: "ON_HOLD" });
  });

  test("잠금·보류가 전이표보다 먼저 답한다 — 막은 까닭이 가려지지 않는다", () => {
    assert.deepEqual(decide({ isCaseLocked: true, transitions: GENERATOR_TRANSITIONS }), {
      move: false,
      reason: "CASE_LOCKED",
    });
    assert.deepEqual(decide({ isOnHold: true, transitions: GENERATOR_TRANSITIONS }), {
      move: false,
      reason: "ON_HOLD",
    });
  });

  test("🔴 갈 단계를 글자로 박지 않는다 — 전이표를 바꾸면 도착지도 따라간다", () => {
    const renamed: ShipmentWaitingTransition[] = [
      {
        actionCode: "STEP_ADVANCED",
        fromStepKey: "step_17",
        toStepKey: "step_18",
        toStatus: "WAITING_SHIPMENT",
      },
    ];
    assert.deepEqual(decide({ currentStepKey: "step_17", transitions: renamed }), {
      move: true,
      fromStepKey: "step_17",
      toStepKey: "step_18",
    });
  });

  test("🔴 되돌리기·출하 완료 전이를 도착지로 집지 않는다", () => {
    // 진행 전이만 뺀 표본 — 출하 대기를 가리키는 줄이 남아 있지만 진행이 아니다.
    const noAdvance = MATCHER_TRANSITIONS.filter(
      (transition) => transition.toStepKey !== "waiting_shipment"
    );
    assert.ok(
      noAdvance.some((transition) => transition.fromStepKey === "waiting_shipment"),
      "표본 점검: 출하 대기를 건드리는 다른 전이가 남아 있어야 이 시험이 뜻이 있다"
    );
    assert.deepEqual(decide({ transitions: noAdvance }), {
      move: false,
      reason: "NO_SHIPMENT_WAITING_STEP",
    });
  });
});

/**
 * ============================================================================
 * 🔴 사람이 고르는 길은 **둘 다** 닫혔는가 — 그리고 시스템 길은 열려 있는가
 * ============================================================================
 * 2026-11-03 사용자 요구가 둘로 왔다:
 *  ① 「[단계 직접 변경]에서 [출하대기]는 보이지 않도록」 → 그 못은
 *     db/queries/workflow-rules-manual-steps.test.ts 가 값으로 박는다.
 *  ② 「[실행 가능한 작업]에서도 [다음 단계로 진행]을 통해서 출하대기로 넘어가지
 *     못하도록」 → 화면 쪽 못은 local/workflow/workflow-action-availability.test.ts
 *     가 값으로 박고, **서버 쪽 못이 여기**다.
 *
 * 🔴 **왜 글자로 재는가.** 서버 쪽 문(transitionWorkflow)은 DB 를 물고 있어
 * db 목록(test:db)에서만 값으로 잴 수 있다. 그 목록은 이 조각에서 돌릴 수 없으므로
 * (두 세션이 같은 DB 를 쓴다), 적어도 **문이 거기 달려 있는지**는 원본 글자로 본다 —
 * 화면만 가리고 서버를 열어 둔 적이 이 저장소에 실제로 있었다.
 * 🔵 db 목록에 값으로 재는 시험을 더할 때 이 글자 검사를 지우지 말 것: 「같은 문장을
 * 쓰는가」와 「검사 차례가 맞는가」는 그쪽에서 재기 어렵다.
 *
 * 🔴 **주석을 걷어 낸 코드만 센다.** 이 파일들은 주석에 규칙을 글자로 적어 두므로,
 * 날것으로 찾으면 코드에서 사라져도 주석에 걸려 통과한다.
 * ============================================================================
 */
const repoUrl = new URL("../../../", import.meta.url);

function codeOf(path: string): string {
  const raw = readFileSync(new URL(path, repoUrl), "utf8").replace(/\r\n/g, "\n");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("이력에 남는 표시 — 시스템이 옮겼음이 드러난다", () => {
  test("🔴 사람이 누른 진행과 가르는 열쇠가 metadata 에 있다", () => {
    assert.deepEqual(SHIPMENT_WAITING_AUTO_ADVANCE_METADATA, {
      autoAdvancedOnShipmentApproval: true,
    });
  });

  test("🔴 사유 문장이 「시스템이 옮겼다」라고 말한다 — 처리자 칸에는 결재자 이름이 선다", () => {
    assert.match(SHIPMENT_WAITING_AUTO_ADVANCE_REASON, /시스템/);
    assert.match(SHIPMENT_WAITING_AUTO_ADVANCE_REASON, /출하 대기/);
    assert.ok(
      SHIPMENT_WAITING_AUTO_ADVANCE_REASON.length > 0,
      "빈 사유면 이력 화면에 아무 줄도 안 그려진다"
    );
  });
});

describe("🔴 서버도 사람 요청을 거절한다 — 화면만 가린 것이 아니다", () => {
  const mutationCode = codeOf("src/lib/db/mutations/workflow-transitions.ts");
  const uiCode = codeOf("src/lib/domain/local/workflow/workflow-action-availability.ts");

  test("표본 점검 — 주석을 걷어 낸 두 원본에서 전이 처리와 판정이 실제로 잡힌다", () => {
    assert.ok(mutationCode.includes("checkTransitionEligibility("), "서버 쪽 전이 처리를 못 찾았다");
    assert.ok(uiCode.includes("evaluateTransitionAvailability"), "화면 쪽 판정을 못 찾았다");
  });

  test("🔴 서버가 들어가는 길을 막는다", () => {
    assert.ok(
      mutationCode.includes("isAdvanceIntoShipmentWaiting(actionCode, transition.toStatus)"),
      "서버 쪽 전이 처리에 [출하 대기] 관문이 없다 — 낡은 탭이나 손으로 만든 요청이 그대로 통과한다"
    );
    assert.ok(
      mutationCode.includes("SHIPMENT_WAITING_AUTO_ONLY_MESSAGE"),
      "거절 문구를 공용 상수에서 가져오지 않는다"
    );
  });

  test("🔴 화면과 서버가 **같은 함수·같은 문장**을 쓴다", () => {
    for (const [name, code] of [
      ["서버", mutationCode],
      ["화면", uiCode],
    ] as const) {
      assert.ok(
        code.includes("isAdvanceIntoShipmentWaiting("),
        `${name} 쪽이 판정을 제 손으로 다시 짠다`
      );
      assert.ok(
        !code.includes(SHIPMENT_WAITING_AUTO_ONLY_MESSAGE),
        `${name} 쪽에 문장이 글자로 박혔다 — 한쪽만 고쳐지는 날이 온다`
      );
    }
  });

  test("🔴 관문이 역할 검사보다 **먼저** 온다 — 「담당자만」이 먼저 나오면 까닭을 끝내 모른다", () => {
    // 🔴 **부르는 자리**를 찾는다 — 맨 위 import 줄의 이름에 걸리면 관문을 통째로
    //    걷어내도 차례 검사가 그대로 통과한다(일부러 깨뜨려 보고 고쳤다).
    const gate = mutationCode.indexOf("isAdvanceIntoShipmentWaiting(actionCode");
    const eligibility = mutationCode.indexOf("checkTransitionEligibility(transition");
    assert.ok(gate > 0 && eligibility > 0, "둘 중 하나를 못 찾았다");
    assert.ok(gate < eligibility, "역할 검사가 먼저 걸려 엉뚱한 까닭이 나온다");
  });

  test("🔴 시스템 길은 그 문을 지나지 않는다 — 막았다고 자동 전환까지 막히면 안 된다", () => {
    const autoAdvanceCode = codeOf("src/lib/db/mutations/shipment-waiting-auto-advance.ts");
    assert.ok(
      !autoAdvanceCode.includes("transitionWorkflow"),
      "자동 전환이 사람 길을 타고 있다 — 사람을 막는 순간 시스템도 함께 막힌다"
    );
    assert.ok(
      autoAdvanceCode.includes("update(repairCases)") &&
        autoAdvanceCode.includes("insert(statusChangeHistories)"),
      "자동 전환이 단계를 옮기고 이력을 남기는 자리를 못 찾았다 — 표본이 비었다"
    );
  });
});

describe("🔴 「이 건에만 단계 추가」로도 출하 대기 단계를 만들 수 없다", () => {
  /*
   * 길을 세다 하나 더 나왔다(2026-11-03). 그 창은 진행 상태를 **전부** 고르게
   * 했고, 새 단계는 현재 단계 **바로 뒤**에 끼워지면서 정방향 전이가 그리로 다시
   * 걸린다(db/mutations/case-workflow-steps.ts 의 「전이 재배선」). 그래서 [출하 대기]
   * 상태로 하나 만들면 **그 수리 건이 거기서 멈춘다** — 진행은 거절되고
   * (위 관문), 단계 직접 변경 목록에도 그 상태는 없다. 들어갈 길이 하나도 없다.
   */
  const dialogCode = codeOf("src/components/repair-cases/workflow/CaseWorkflowStepDialog.tsx");
  const actionCode = codeOf("src/lib/server/actions/case-workflow-steps.ts");

  test("표본 점검 — 창과 서버 액션에서 진행 상태를 다루는 자리가 실제로 잡힌다", () => {
    assert.ok(dialogCode.includes("REPAIR_STATUS_CODES"), "창에서 상태 목록을 못 찾았다");
    assert.ok(actionCode.includes("REPAIR_STATUS_CODES"), "서버 액션에서 상태 검사를 못 찾았다");
  });

  test("🔴 창의 고르개에서 그 상태가 빠진다", () => {
    assert.ok(
      dialogCode.includes("code !== SHIPMENT_WAITING_REPAIR_STATUS"),
      "창이 아직 [출하 대기]를 고르게 한다"
    );
  });

  test("🔴 서버 액션도 거절한다 — 화면에서만 빼지 않았다", () => {
    assert.ok(
      actionCode.includes("input.status === SHIPMENT_WAITING_REPAIR_STATUS"),
      "서버 액션이 손으로 만든 요청을 그대로 받는다"
    );
    assert.ok(
      actionCode.includes("SHIPMENT_WAITING_AUTO_ONLY_MESSAGE"),
      "거절 문구를 공용 상수에서 가져오지 않는다"
    );
  });
});
