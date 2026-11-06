import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MISC_CASE_STATUS_LABELS,
  MISC_CASE_STATUS_ORDER,
  resolveMiscCaseStatus,
  type MiscCaseStatus,
} from "./misc-case-status";
import type { ShipmentApprovalState } from "./local/workflow/shipment-approval-checklist";

/**
 * ============================================================================
 * 기타건의 상태 배지 — **무엇이 무엇으로 보이는가** (2026-11-06)
 * ============================================================================
 * 사용자가 글자 둘을 지정했다: 요청을 누르면 **「출하 승인 대기」**, 승인이 모두
 * 완료되면 **「출하 대기」**. 그 둘이 실제로 그 상태에서 나오는지를 **값으로** 잰다 —
 * 화면 글자를 눈으로 확인하는 것 말고 이 규칙을 지킬 자리가 없다.
 *
 * 🔵 이 함수는 **기타건 상세의 머리 카드와 기타건 현황 목록이 함께** 부른다. 그래서
 * 「상세와 목록이 같은 말을 한다」는 이 파일이 통과하는 것으로 지켜진다 — 두 화면이
 * 각자 판정했다면 여기서 재도 소용이 없고, 그 사실은 화면 시험이 따로 본다.
 * ============================================================================
 */

const APPROVAL_STATES: readonly ShipmentApprovalState[] = [
  "NOT_REQUESTED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "STALE",
];

describe("🔴 사용자가 지정한 두 글자", () => {
  test("요청을 올리면 「출하 승인 대기」", () => {
    const status = resolveMiscCaseStatus({ completedAt: null, approvalState: "PENDING" });
    assert.equal(status, "SHIPMENT_APPROVAL_PENDING");
    assert.equal(MISC_CASE_STATUS_LABELS[status], "출하 승인 대기");
  });

  test("승인이 끝나면 「출하 대기」", () => {
    const status = resolveMiscCaseStatus({ completedAt: null, approvalState: "APPROVED" });
    assert.equal(status, "SHIPMENT_READY");
    assert.equal(MISC_CASE_STATUS_LABELS[status], "출하 대기");
  });

  test("두 말이 서로 다르다 — 배지가 바뀌는 것이 요구의 전부다", () => {
    assert.notEqual(
      MISC_CASE_STATUS_LABELS.SHIPMENT_APPROVAL_PENDING,
      MISC_CASE_STATUS_LABELS.SHIPMENT_READY
    );
  });
});

describe("🔴 나머지 상태", () => {
  test("한 번도 안 올렸으면 「진행 중」", () => {
    assert.equal(
      resolveMiscCaseStatus({ completedAt: null, approvalState: "NOT_REQUESTED" }),
      "IN_PROGRESS"
    );
    // 결재 기록이 아예 없는 줄은 지도에 없어서 null 로 온다 — 같은 뜻이다.
    assert.equal(resolveMiscCaseStatus({ completedAt: null, approvalState: null }), "IN_PROGRESS");
  });

  test("반려·낡은 승인은 각각 다른 상태다 — 「진행 중」으로 뭉개지 않는다", () => {
    assert.equal(
      resolveMiscCaseStatus({ completedAt: null, approvalState: "REJECTED" }),
      "SHIPMENT_APPROVAL_REJECTED"
    );
    assert.equal(
      resolveMiscCaseStatus({ completedAt: null, approvalState: "STALE" }),
      "SHIPMENT_APPROVAL_STALE"
    );
  });
});

describe("🔴 완료가 **먼저**다", () => {
  test("완료 처리된 줄은 승인이 어느 상태든 「완료」", () => {
    // 🔵 못 — 다섯 상태를 전부 돈다. 하나만 재면 「승인이 없을 때만 완료」가 통과한다.
    assert.equal(APPROVAL_STATES.length, 5, "승인 상태 목록이 다섯이 아니다");
    for (const approvalState of APPROVAL_STATES) {
      assert.equal(
        resolveMiscCaseStatus({ completedAt: "2026-10-21T00:00:00.000Z", approvalState }),
        "COMPLETED",
        `${approvalState} 에서 완료가 가려졌다`
      );
    }
  });

  test("완료 전에는 승인 상태가 그대로 드러난다", () => {
    assert.notEqual(
      resolveMiscCaseStatus({ completedAt: null, approvalState: "PENDING" }),
      "COMPLETED"
    );
  });
});

test("🔴 다섯 승인 상태가 모두 **다른** 기타건 상태로 간다 — 뭉개지는 칸이 없다", () => {
  const mapped = APPROVAL_STATES.map((approvalState) =>
    resolveMiscCaseStatus({ completedAt: null, approvalState })
  );
  assert.equal(new Set(mapped).size, APPROVAL_STATES.length, mapped.join());
});

test("🔴 거르개의 차례에 여섯이 **빠짐없이 한 번씩** 들어 있다", () => {
  const all = Object.keys(MISC_CASE_STATUS_LABELS) as MiscCaseStatus[];
  assert.equal(new Set(MISC_CASE_STATUS_ORDER).size, MISC_CASE_STATUS_ORDER.length, "차례에 중복이 있다");
  assert.deepEqual([...MISC_CASE_STATUS_ORDER].sort(), [...all].sort());
  // 흐름의 순서다 — 아직 안 올림 → 올림 → 승인됨 → 끝남이 앞 넷이다.
  assert.deepEqual(MISC_CASE_STATUS_ORDER.slice(0, 4), [
    "IN_PROGRESS",
    "SHIPMENT_APPROVAL_PENDING",
    "SHIPMENT_READY",
    "COMPLETED",
  ]);
});

test("🔴 여섯 글자가 전부 다르다 — 두 상태가 같은 말로 보이면 배지가 거짓말을 한다", () => {
  const labels = Object.values(MISC_CASE_STATUS_LABELS);
  assert.equal(new Set(labels).size, labels.length, labels.join());
  for (const label of labels) assert.notEqual(label.trim(), "");
});
