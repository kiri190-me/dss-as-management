import { test } from "node:test";
import assert from "node:assert/strict";

import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import {
  checkManualStepSetEligibility,
  checkTransitionEligibility,
} from "@/lib/domain/local/workflow/permissions";
import { TRANSITION_DEFINITIONS } from "@/lib/domain/local/workflow/transition-definitions";
import { RELEASED_HOLD_STATE, type HoldState } from "@/lib/domain/local/workflow/workflow-types";
import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * "현재 단계 직접 변경"(STEP_SET_MANUALLY)의 자격 판정 — 2026-10-04 완화
 * ============================================================================
 * 사용자 결정으로 두 가지가 풀렸다:
 *   1. 담당 엔지니어 제약 — 이제 승인된 AS_ENGINEER 전원이 어느 접수 건에서든
 *      단계를 직접 바꿀 수 있다(전에는 자기 담당 건만).
 *   2. 변경 사유 필수 — 선택 입력이 되었다(그쪽은 서버/DB 층의 일이라
 *      set-workflow-step.ts와 workflow-transitions.integration.test.ts가 본다).
 *
 * 이 파일은 1번과, **함께 풀리면 안 되는 것들**을 값으로 고정한다. 권한을
 * 넓히는 변경은 「막히던 사람이 안 막힌다」만 보면 반쪽이다 — 같이 열려 버린
 * 문은 아무 시험도 실패하지 않아 조용히 지나간다.
 * ============================================================================
 */

function actor(role: Role, overrides: Partial<ActingUser> = {}): ActingUser {
  return {
    id: "u-eng",
    name: "엔지니어",
    role,
    approvalStatus: "APPROVED",
    isDeveloper: false,
    ...overrides,
  };
}

const OTHER_ENGINEER_ID = "u-other-eng";

const ON_HOLD_STATE: HoldState = {
  isOnHold: true,
  reason: "부품 대기",
  startedByUserId: "u-eng",
  startedByNameSnapshot: "엔지니어",
  startedAt: "2026-10-01T00:00:00Z",
};

test("🔴 담당이 아닌 엔지니어도 단계를 직접 변경할 수 있다 (2026-10-04 완화)", () => {
  // 전에는 이 둘이 각각 「담당 엔지니어가 배정되어 있지 않습니다」와
  // 「담당 엔지니어만 단계를 직접 변경할 수 있습니다」로 막히던 표본이다.
  // 이제 판정 함수는 배정을 아예 인자로 받지 않는다 — 배정이 어떤 상태든
  // 답이 같다는 것을 타입이 보장한다.
  assert.deepEqual(checkManualStepSetEligibility(actor("AS_ENGINEER"), RELEASED_HOLD_STATE), {
    allowed: true,
  });

  // 관리자·최고관리자는 전과 같이 통과한다.
  assert.deepEqual(checkManualStepSetEligibility(actor("ADMIN"), RELEASED_HOLD_STATE), {
    allowed: true,
  });
  assert.deepEqual(checkManualStepSetEligibility(actor("SUPER_ADMIN"), RELEASED_HOLD_STATE), {
    allowed: true,
  });
});

test("🔴 역할 허용 목록은 넓어지지 않았다 — 영업·재고 담당자는 여전히 막힌다", () => {
  // 사용자가 말한 「모든 엔지니어」는 AS_ENGINEER 전원이라는 뜻이지
  // 모든 사람이 아니다. 이 단언이 깨지면 우회 경로가 전 직원에게 열린 것이다.
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    const result = checkManualStepSetEligibility(actor(role), RELEASED_HOLD_STATE);
    assert.equal(result.allowed, false, `${role}에게 단계 직접 변경이 열렸다`);
    if (!result.allowed) {
      assert.equal(result.reason, "현재 역할로는 단계를 직접 변경할 수 없습니다.");
    }
  }
});

test("🔴 승인되지 않은 계정은 통과하지 못한다 — 검사 순서도 그대로 맨 앞이다", () => {
  const pending = checkManualStepSetEligibility(
    actor("AS_ENGINEER", { approvalStatus: "PENDING" }),
    RELEASED_HOLD_STATE
  );
  assert.equal(pending.allowed, false, "승인 대기 계정이 통과했다");
  // 역할 메시지가 아니라 승인 메시지가 나와야 한다 — 승인 검사가 먼저다.
  if (!pending.allowed) {
    assert.equal(pending.reason, "승인되지 않은 계정은 이 작업을 수행할 수 없습니다.");
  }

  // 허용 목록 밖의 역할이면서 승인도 안 된 계정도 승인 메시지가 먼저 나온다.
  const pendingSales = checkManualStepSetEligibility(
    actor("SALES", { approvalStatus: "PENDING" }),
    RELEASED_HOLD_STATE
  );
  assert.equal(pendingSales.allowed, false);
  if (!pendingSales.allowed) {
    assert.equal(pendingSales.reason, "승인되지 않은 계정은 이 작업을 수행할 수 없습니다.");
  }
});

test("🔴 보류 중에는 여전히 거부된다 — 승인된 세 역할 전부", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const) {
    const result = checkManualStepSetEligibility(actor(role), ON_HOLD_STATE);
    assert.equal(result.allowed, false, `${role}이 보류 중인 건의 단계를 옮겼다`);
    if (!result.allowed) {
      assert.equal(
        result.reason,
        "보류 중에는 다른 작업을 수행할 수 없습니다. 먼저 보류를 해제하세요."
      );
    }
  }
});

/**
 * ----------------------------------------------------------------------------
 * 🔴 회귀 방지 — 이번 완화가 정규 전이 쪽으로 새지 않았다
 * ----------------------------------------------------------------------------
 * 푼 것은 "단계 직접 변경" 한 곳뿐이다. 정규 전이(되돌리기 포함)의 담당 제약과
 * 사유 규칙은 transition-definitions.ts의 플래그가 정하며, 이번에 건드리지
 * 않았다.
 *
 * ⚠️ 되돌리기(STEP_RETURNED)의 **사유**는 2026-08-18에 이미 선택으로 완화되어
 * 있었다(requiresReason=false). 그래서 여기서 고정하는 되돌리기 쪽 불변식은
 * 「사유가 필수다」가 아니라 「2026-08-18에 정해진 값 그대로다」이며, 함께
 * 풀리면 안 되는 담당 제약(requiresAssignedEngineer=true)을 따로 고정한다.
 * ----------------------------------------------------------------------------
 */

test("🔴 되돌리기의 담당 엔지니어 제약은 그대로다 — 남의 건은 못 되돌린다", () => {
  const returns = TRANSITION_DEFINITIONS.filter((t) => t.actionCode === "STEP_RETURNED");
  assert.ok(returns.length > 0, "되돌리기 전이가 하나도 없다 — 이 시험의 전제가 사라졌다");

  for (const transition of returns) {
    assert.equal(
      transition.requiresAssignedEngineer,
      true,
      `${transition.id}: 되돌리기의 담당 제약이 풀렸다(단계 직접 변경 완화가 샜다)`
    );
    assert.equal(
      transition.requiresReason,
      false,
      `${transition.id}: 되돌리기 사유 플래그가 2026-08-18 값(false)에서 달라졌다`
    );
  }

  // 플래그만이 아니라 판정 결과로도 확인한다 — 담당이 아닌 엔지니어는
  // 되돌리기에서 여전히 막힌다.
  const sample = returns[0];
  assert.equal(
    checkTransitionEligibility(sample, actor("AS_ENGINEER"), OTHER_ENGINEER_ID, RELEASED_HOLD_STATE)
      .allowed,
    false,
    "담당이 아닌 엔지니어가 되돌리기를 통과했다"
  );
  assert.equal(
    checkTransitionEligibility(sample, actor("AS_ENGINEER"), null, RELEASED_HOLD_STATE).allowed,
    false,
    "담당 엔지니어가 없는 건을 엔지니어가 되돌렸다"
  );
  assert.deepEqual(
    checkTransitionEligibility(sample, actor("AS_ENGINEER"), "u-eng", RELEASED_HOLD_STATE),
    { allowed: true }
  );
});

test("🔴 출하 완료 메모는 여전히 필수다 — requiresReason 플래그가 살아 있다", () => {
  const shipments = TRANSITION_DEFINITIONS.filter((t) => t.actionCode === "SHIPMENT_COMPLETED");
  assert.ok(shipments.length > 0, "출하 완료 전이가 하나도 없다 — 이 시험의 전제가 사라졌다");
  for (const transition of shipments) {
    assert.equal(
      transition.requiresReason,
      true,
      `${transition.id}: 출하 완료 메모가 선택으로 바뀌었다`
    );
  }
});
