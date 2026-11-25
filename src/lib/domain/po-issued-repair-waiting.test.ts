import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  checkPoIssuedDateRecorded,
  decidePoIssuedRepairWaiting,
  pickPoIssuedRepairWaitingStep,
  PO_ISSUED_REPAIR_WAITING_METADATA,
  PO_ISSUED_REPAIR_WAITING_REASON,
  PO_ISSUED_TARGET_REPAIR_STATUS,
  type PoIssuedRepairWaitingStep,
} from "./po-issued-repair-waiting";
import { REPAIR_STATUS_CODES, repairStatusLabels } from "./types";

/**
 * ============================================================================
 * PO발행일이 적히면 단계가 [수리 대기]로 — 순수 규칙 (2026-11-26)
 * ============================================================================
 * 표에 실제로 무슨 일이 일어나는지는 db 목록의
 * mutations/po-issued-repair-waiting.integration.test.ts 가 잰다. 여기서 재는
 * 것은 **「옮기는가, 아니면 왜 안 옮기는가」** 하나뿐이고, 까닭 아홉을 전부
 * 값으로 못 박는다.
 *
 * ── 🔴 왜 까닭까지 재는가 ───────────────────────────────────────────────
 * 이 기능은 **안 움직이는 것이 정상인 갈래가 여덟**이다(무상 워크플로 · 이미
 * 지나온 건 · 보류 · 잠금 · 날짜 안 바뀜 …). `move === false` 만 재면 그 여덟이
 * 전부 같은 모양이라, 엉뚱한 까닭으로 막힌 날에도 시험은 초록이다. 특히
 * **NO_WAITING_REPAIR_STEP 과 ALREADY_PAST 를 가르는 것**이 중요하다 — 둘을
 * 뭉개면 「무상 건에서 조용히 안 도는」 자리와 「되돌리지 않는」 자리가 구분되지
 * 않는다.
 * ============================================================================
 */

/**
 * 실측을 본뜬 단계 목록(2026-11-26 운영 DB 조회, 유상 Matcher 계열).
 *
 * 🔴 **12번이 이 시험의 표본이다** — `repair_status = 'WAITING_REPAIR'`. 운영에서
 * 그 단계의 키가 `po_received` 이고 이름표가 워크플로마다 「수리 대기」/「PO 접수
 * 완료」로 갈려 있다는 사실까지 그대로 본떴다. 🔵 판정은 그 둘을 보지 않는다 —
 * 아래 「이름도 키도 안 본다」가 값으로 확인한다.
 */
const STEPS: readonly PoIssuedRepairWaitingStep[] = [
  { key: "intake_inspection", order: 2, status: "WAITING_INTAKE_INSPECTION" },
  { key: "waiting_kyosan_reply", order: 4, status: "WAITING_KYOSAN_REPLY" },
  { key: "customer_quote_sent", order: 10, status: "WAITING_KYOSAN_REPLY" },
  { key: "waiting_po", order: 11, status: "WAITING_PO" },
  { key: "po_received", order: 12, status: "WAITING_REPAIR" },
  { key: "parts_supply", order: 13, status: "WAITING_PARTS_SUPPLY" },
  { key: "repair_in_progress", order: 15, status: "IN_REPAIR" },
  { key: "waiting_shipment", order: 18, status: "WAITING_SHIPMENT" },
];

/** 무상 계열 — 그 상태의 단계가 **하나도 없다**(실측). 같은 자리가 부품 수급이다. */
const STEPS_WITHOUT_TARGET: readonly PoIssuedRepairWaitingStep[] = [
  { key: "intake_inspection", order: 2, status: "WAITING_INTAKE_INSPECTION" },
  { key: "parts_supply", order: 3, status: "WAITING_PARTS_SUPPLY" },
  { key: "repair_or_defective_parts_replacement", order: 6, status: "IN_REPAIR" },
  { key: "shipment_completed", order: 10, status: "SHIPMENT_COMPLETED" },
];

/** 판정에 넘길 재료 한 벌. 시험마다 필요한 칸만 덮어쓴다. */
function state(overrides: Partial<Parameters<typeof decidePoIssuedRepairWaiting>[0]> = {}) {
  return {
    previousOrderIssuedDate: null as string | null,
    nextOrderIssuedDate: "2099-03-02" as string | null,
    isCaseLocked: false,
    isOnHold: false,
    currentStepOrder: 11,
    currentStepStatus: "WAITING_PO" as (typeof REPAIR_STATUS_CODES)[number] | null,
    steps: STEPS,
    ...overrides,
  };
}

// ─────────────────────────────────────────── 0. 표본 점검
describe("0. 표본 점검 — 무엇을 재고 있는지 먼저 못 박는다", () => {
  test("🔴 목표 상태는 REPAIR_STATUS_CODES 안의 값이고, 그 이름표가 「수리 대기」다", () => {
    // 이 상수가 오타거나 없는 코드면 아래 시험 전부가 「못 찾음」으로 공짜 통과한다.
    assert.ok(
      (REPAIR_STATUS_CODES as readonly string[]).includes(PO_ISSUED_TARGET_REPAIR_STATUS),
      "목표 상태가 접수 건 상태 목록에 없다"
    );
    // 🔴 사용자가 화면에서 가리킨 글자다(배지가 이 표를 그린다). 이름표가 바뀌면
    //    여기서 먼저 걸려야 한다 — 기능이 조용히 다른 칸으로 가는 것보다 낫다.
    assert.equal(repairStatusLabels[PO_ISSUED_TARGET_REPAIR_STATUS], "수리 대기");
  });

  test("🔴 표본에 그 상태의 단계가 **있고**, 없는 표본에는 **없다**", () => {
    // 🔵 양쪽을 같은 줄에서 센다. 「없다」만 재면 표본이 통째로 비어도 통과한다.
    const withTarget = STEPS.filter((s) => s.status === PO_ISSUED_TARGET_REPAIR_STATUS);
    assert.equal(withTarget.length, 1, "표본에 목표 단계가 하나 있어야 한다");
    assert.equal(withTarget[0].order, 12);
    assert.equal(
      STEPS_WITHOUT_TARGET.filter((s) => s.status === PO_ISSUED_TARGET_REPAIR_STATUS).length,
      0,
      "무상 표본에는 목표 단계가 없어야 한다"
    );
  });

  test("이력에 남길 글자 둘이 비어 있지 않다", () => {
    // 🔴 reason 이 빈 문자열이면 「누가 옮겼나」가 화면에서 사라지고, 날짜를 적은
    //    사람이 단계를 옮긴 것으로 읽힌다.
    assert.ok(PO_ISSUED_REPAIR_WAITING_REASON.includes("시스템"));
    assert.equal(PO_ISSUED_REPAIR_WAITING_METADATA.autoAdvancedOnPoIssuedDate, true);
  });
});

// ─────────────────────────────────────────── 1. 날짜 관문
describe("1. 「이번 저장이 PO발행일을 적었는가」", () => {
  test("빈 칸에 처음 적으면 적힌 것이다", () => {
    assert.deepEqual(
      checkPoIssuedDateRecorded({
        previousOrderIssuedDate: null,
        nextOrderIssuedDate: "2099-03-02",
      }),
      { recorded: true }
    );
  });

  test("🔴 값을 다른 값으로 고쳐도 적힌 것이다 — PO 쪽에서 적힌 건이 걸리는 길", () => {
    assert.deepEqual(
      checkPoIssuedDateRecorded({
        previousOrderIssuedDate: "2099-03-02",
        nextOrderIssuedDate: "2099-04-09",
      }),
      { recorded: true }
    );
  });

  test("🔴 안 바뀌면 아니다 — 금액만 고친 저장이 단계를 흔들면 안 된다", () => {
    assert.deepEqual(
      checkPoIssuedDateRecorded({
        previousOrderIssuedDate: "2099-03-02",
        nextOrderIssuedDate: "2099-03-02",
      }),
      { recorded: false, reason: "DATE_UNCHANGED" }
    );
  });

  test("🔴 지우면 아니다 — 그리고 까닭이 DATE_UNCHANGED 가 아니라 DATE_CLEARED 다", () => {
    const result = checkPoIssuedDateRecorded({
      previousOrderIssuedDate: "2099-03-02",
      nextOrderIssuedDate: null,
    });
    assert.deepEqual(result, { recorded: false, reason: "DATE_CLEARED" });
  });

  test("둘 다 비면 안 바뀐 것이다", () => {
    assert.deepEqual(
      checkPoIssuedDateRecorded({ previousOrderIssuedDate: null, nextOrderIssuedDate: null }),
      { recorded: false, reason: "DATE_UNCHANGED" }
    );
  });

  test("🔴 공백은 접은 뒤 견준다 — 빈 글자 → null 은 「바뀜」이 아니다", () => {
    assert.deepEqual(
      checkPoIssuedDateRecorded({ previousOrderIssuedDate: "   ", nextOrderIssuedDate: null }),
      { recorded: false, reason: "DATE_UNCHANGED" }
    );
    // 거꾸로도 같다.
    assert.deepEqual(
      checkPoIssuedDateRecorded({ previousOrderIssuedDate: null, nextOrderIssuedDate: "" }),
      { recorded: false, reason: "DATE_UNCHANGED" }
    );
  });
});

// ─────────────────────────────────────────── 2. 갈 단계 고르기
describe("2. 갈 단계 — 앞에 있는 것 중 가장 가까운 것", () => {
  test("PO 대기(11)에 서 있으면 12번으로 간다", () => {
    const picked = pickPoIssuedRepairWaitingStep(STEPS, 11);
    assert.equal(picked?.order, 12);
    assert.equal(picked?.key, "po_received");
  });

  test("🔴 뒤에 있는 것은 고르지 않는다 — 수리 중(15)에서는 null 이다", () => {
    // 이 한 줄이 「되돌리지 않는다」의 전부다. 빠지면 수리 중인 건이 PO발행일
    // 한 번에 수리 대기로 끌려 내려간다.
    assert.equal(pickPoIssuedRepairWaitingStep(STEPS, 15), null);
  });

  test("🔴 지금 자리와 같은 order 도 고르지 않는다", () => {
    assert.equal(pickPoIssuedRepairWaitingStep(STEPS, 12), null, "같은 단계로 옮기는 일은 없다");
  });

  test("🔴 앞에 둘이면 **가까운 쪽**이다 — 목록 차례에 휘둘리지 않는다", () => {
    const two: PoIssuedRepairWaitingStep[] = [
      { key: "far", order: 20, status: "WAITING_REPAIR" },
      { key: "near", order: 12, status: "WAITING_REPAIR" },
    ];
    assert.equal(pickPoIssuedRepairWaitingStep(two, 11)?.key, "near");
    // 뒤집어 넣어도 같은 답이다.
    assert.equal(pickPoIssuedRepairWaitingStep([...two].reverse(), 11)?.key, "near");
  });

  test("🔴 그 상태의 단계가 없으면 null — 다른 상태를 주워 오지 않는다", () => {
    // 부품 수급(WAITING_PARTS_SUPPLY)이 바로 앞에 있어도 고르면 안 된다.
    assert.equal(pickPoIssuedRepairWaitingStep(STEPS_WITHOUT_TARGET, 2), null);
  });

  test("🔴 이름도 키도 보지 않는다 — 상태 칸 하나로만 고른다", () => {
    // 이름표가 워크플로마다 갈려 있고(「수리 대기」/「PO 접수 완료」) 키도 사람이
    // 바꿀 수 있다. 둘 다 엉뚱하게 둬도 상태가 맞으면 골라야 한다.
    const renamed: PoIssuedRepairWaitingStep[] = [
      { key: "zzz_renamed_by_editor", order: 12, status: "WAITING_REPAIR" },
    ];
    assert.equal(pickPoIssuedRepairWaitingStep(renamed, 11)?.key, "zzz_renamed_by_editor");
    // 거꾸로 — 키가 po_received 라도 상태가 다르면 **고르지 않는다**.
    const wrongStatus: PoIssuedRepairWaitingStep[] = [
      { key: "po_received", order: 12, status: "WAITING_PO" },
    ];
    assert.equal(pickPoIssuedRepairWaitingStep(wrongStatus, 11), null);
  });
});

// ─────────────────────────────────────────── 3. 전체 판정
describe("3. 옮기는가 — 까닭 아홉을 값으로", () => {
  test("🔴 PO발행일을 적으면 [수리 대기]로 옮긴다", () => {
    assert.deepEqual(decidePoIssuedRepairWaiting(state()), {
      move: true,
      toStepKey: "po_received",
      toStepOrder: 12,
    });
  });

  test("🔴 이미 그 뒤 단계면 안 되돌아간다 — ALREADY_PAST", () => {
    // 🔵 바로 위 시험과 **짝**이다. 이것이 없으면 「언제나 덮는」 구현도 통과한다.
    assert.deepEqual(
      decidePoIssuedRepairWaiting(
        state({ currentStepOrder: 15, currentStepStatus: "IN_REPAIR" })
      ),
      { move: false, reason: "ALREADY_PAST" }
    );
  });

  test("🔴 출하 대기까지 간 건도 안 되돌아간다", () => {
    assert.deepEqual(
      decidePoIssuedRepairWaiting(
        state({ currentStepOrder: 18, currentStepStatus: "WAITING_SHIPMENT" })
      ),
      { move: false, reason: "ALREADY_PAST" }
    );
  });

  test("🔴 이미 [수리 대기]면 아무 일도 안 난다 — ALREADY_WAITING_REPAIR", () => {
    const result = decidePoIssuedRepairWaiting(
      state({ currentStepOrder: 12, currentStepStatus: "WAITING_REPAIR" })
    );
    assert.deepEqual(result, { move: false, reason: "ALREADY_WAITING_REPAIR" });
    // 🔴 까닭이 ALREADY_PAST 로 나오면 거짓말이다 — 지나온 적이 없다.
    assert.notDeepEqual(result, { move: false, reason: "ALREADY_PAST" });
  });

  test("🔴 이미 [수리 대기]인데 앞에 같은 상태가 또 있어도 안 움직인다", () => {
    // 이 갈래가 「이미 그 단계」를 pick 보다 먼저 묻는 까닭이다. 뒤로 돌리면
    // 사용자 요구(「이미 [수리 대기]면 아무 일도」)가 그 자리에서 깨진다.
    const twoTargets: PoIssuedRepairWaitingStep[] = [
      { key: "po_received", order: 12, status: "WAITING_REPAIR" },
      { key: "po_received_again", order: 14, status: "WAITING_REPAIR" },
    ];
    assert.deepEqual(
      decidePoIssuedRepairWaiting(
        state({ currentStepOrder: 12, currentStepStatus: "WAITING_REPAIR", steps: twoTargets })
      ),
      { move: false, reason: "ALREADY_WAITING_REPAIR" }
    );
  });

  test("🔴 그 상태의 단계가 없는 워크플로(무상)에서는 아무 일도 안 난다 — 오류가 아니다", () => {
    // 🔴 이것이 없으면 「무상 건에서 조용히 터지는」 자리가 된다. 까닭이
    //    ALREADY_PAST 가 아니라 NO_WAITING_REPAIR_STEP 이어야 둘이 구분된다.
    const result = decidePoIssuedRepairWaiting(
      state({
        steps: STEPS_WITHOUT_TARGET,
        currentStepOrder: 2,
        currentStepStatus: "WAITING_INTAKE_INSPECTION",
      })
    );
    assert.deepEqual(result, { move: false, reason: "NO_WAITING_REPAIR_STEP" });
  });

  test("🔴 날짜를 지워도 단계는 그대로다 — DATE_CLEARED", () => {
    assert.deepEqual(
      decidePoIssuedRepairWaiting(
        state({ previousOrderIssuedDate: "2099-03-02", nextOrderIssuedDate: null })
      ),
      { move: false, reason: "DATE_CLEARED" }
    );
  });

  test("🔴 날짜가 안 바뀐 저장은 단계를 흔들지 않는다 — DATE_UNCHANGED", () => {
    assert.deepEqual(
      decidePoIssuedRepairWaiting(
        state({ previousOrderIssuedDate: "2099-03-02", nextOrderIssuedDate: "2099-03-02" })
      ),
      { move: false, reason: "DATE_UNCHANGED" }
    );
  });

  test("🔴 보류 중이면 안 옮긴다", () => {
    assert.deepEqual(decidePoIssuedRepairWaiting(state({ isOnHold: true })), {
      move: false,
      reason: "ON_HOLD",
    });
  });

  test("🔴 출하 완료로 잠긴 건은 안 옮긴다", () => {
    assert.deepEqual(decidePoIssuedRepairWaiting(state({ isCaseLocked: true })), {
      move: false,
      reason: "CASE_LOCKED",
    });
  });

  test("🔴 잠금·보류가 「단계 없음」보다 **먼저** 보고된다", () => {
    // 뒤로 돌리면 무상 워크플로의 잠긴 건이 NO_WAITING_REPAIR_STEP 으로 보고되어,
    // 정작 막은 까닭이 잠금이었다는 사실이 가려진다.
    assert.deepEqual(
      decidePoIssuedRepairWaiting(state({ isCaseLocked: true, steps: STEPS_WITHOUT_TARGET })),
      { move: false, reason: "CASE_LOCKED" }
    );
    assert.deepEqual(
      decidePoIssuedRepairWaiting(state({ isOnHold: true, steps: STEPS_WITHOUT_TARGET })),
      { move: false, reason: "ON_HOLD" }
    );
  });

  test("🔴 날짜 관문이 **모든 것보다 먼저**다 — 잠긴 건의 평범한 저장도 조용하다", () => {
    // 날짜가 안 바뀐 저장은 잠금/보류를 보기도 전에 끝나야 한다. 그래야 내자
    // 정리의 평범한 저장이 수리 건을 읽는 질의를 일으키지 않는다.
    assert.deepEqual(
      decidePoIssuedRepairWaiting(
        state({
          previousOrderIssuedDate: "2099-03-02",
          nextOrderIssuedDate: "2099-03-02",
          isCaseLocked: true,
          isOnHold: true,
        })
      ),
      { move: false, reason: "DATE_UNCHANGED" }
    );
  });

  test("상태가 비어 분류 안 된 단계에 선 건도 앞으로는 간다", () => {
    // repair_status 가 비어 있는 단계는 steps 목록에 못 들어오므로 제 자신을
    // 못 찾는다. 그래도 앞에 목표 단계가 있으면 가야 한다 — 오히려 고쳐야 할 줄이다.
    assert.deepEqual(
      decidePoIssuedRepairWaiting(state({ currentStepOrder: 11, currentStepStatus: null })),
      { move: true, toStepKey: "po_received", toStepOrder: 12 }
    );
  });
});
