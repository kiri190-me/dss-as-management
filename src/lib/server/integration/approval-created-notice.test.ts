import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notifyQuoteApprovalCreated,
  notifyRepairCaseApprovalCreated,
  type QuoteApprovalNoticeDeps,
  type RepairCaseApprovalNoticeDeps,
} from "./approval-created-notice";

/**
 * ============================================================================
 * 결재가 생긴 뒤 포털을 찌르는 자리 — **누구에게 가는가**와 **안 터지는가**
 * ============================================================================
 * 2026-10-24. 여기서 재는 것은 둘이다:
 *  ① 「지금 차례인 사람」을 **새로 판정하지 않고** 이미 있는 조회로 고르는가 —
 *     지정이 있으면 한 사람, 없으면 자격 있는 사람들.
 *  ② 무슨 일이 있어도 **던지지 않는가.** 부르는 자리는 결재가 이미 저장된
 *     뒤이고, 여기서 던지면 저장된 결재가 사람에게 실패로 보인다.
 *
 * 조회를 전부 인자로 받는 구조라 DB 도 망도 타지 않는다. 포털로 **실제로 무엇이
 * 나가는가**(몸통에 결재 내용이 없는가 · 404 에도 안 터지는가)는 바로 옆
 * portal-inbox.test.ts 가 같은 목록에서 잰다.
 *
 * 🔴 실제 고객사·사람 이름·L/N·S/N 을 넣지 않는다 — 전부 가짜 식별자다.
 * ============================================================================
 */

/** 부른 기록을 남기는 가짜 묶음. 기본은 「아무도 없음」이라 일부러 채워야 한다. */
function deps(overrides: Partial<RepairCaseApprovalNoticeDeps> = {}) {
  const calls = {
    notified: [] as string[][],
    askedSubjectsFor: [] as string[],
    inspectionAsked: 0,
    representativesAsked: 0,
    shipmentDecideAsked: [] as string[],
  };
  const base: RepairCaseApprovalNoticeDeps = {
    readCurrentApprovals: async () => [],
    listInspectionApprovers: async () => {
      calls.inspectionAsked += 1;
      return [];
    },
    listRepresentativeCandidates: async () => {
      calls.representativesAsked += 1;
      return [];
    },
    listDelegations: async () => [],
    resolveShipmentDecide: async (userId) => {
      calls.shipmentDecideAsked.push(userId);
      return { allowed: false };
    },
    readPortalSubject: async (userId) => {
      calls.askedSubjectsFor.push(userId);
      return `portal-${userId}`;
    },
    notifyPortal: async (subjects) => {
      calls.notified.push([...subjects]);
      return true;
    },
  };
  return { deps: { ...base, ...overrides }, calls };
}

/** (건, 종류)별 가장 최근 행을 흉내 낸다 — getCurrentApprovalsForCase 의 모양. */
function current(
  approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT",
  latest: { status: string; assignedApproverUserId: string | null } | null
) {
  return async () => [{ approvalType, latest }];
}

/** 이 안에서 나간 console 출력을 삼켜 모은다 — 무엇이 로그에 남는지도 여기서 본다. */
async function captureLogs<T>(run: () => Promise<T>): Promise<{ value: T; logged: string }> {
  const originalError = console.error;
  const originalWarn = console.warn;
  const lines: string[] = [];
  const collect = (...args: unknown[]) => {
    lines.push(args.map((one) => String(one)).join(" "));
  };
  console.error = collect;
  console.warn = collect;
  try {
    return { value: await run(), logged: lines.join("\n") };
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

test("🔴 지정이 있으면 **그 한 사람**뿐이다 — 자격자 목록을 묻지도 않는다", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("REPAIR_INSPECTION", {
      status: "REQUESTED",
      assignedApproverUserId: "user-assigned",
    }),
  });

  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  assert.deepEqual(calls.notified, [["portal-user-assigned"]]);
  // 🔴 지정이 있는데도 자격자 전원을 묻는다면, 결재가 생길 때마다 관계없는
  //    사람들에게 메일이 간다.
  assert.equal(calls.inspectionAsked, 0, "지정이 있는데 자격자 목록을 물었다");
  assert.equal(calls.representativesAsked, 0, "지정이 있는데 대표 목록을 물었다");
});

test("🔴 가장 최근 행이 REQUESTED 가 아니면 아무것도 안 나간다 — 아무의 차례도 아니다", async () => {
  for (const status of ["APPROVED", "REJECTED"]) {
    const { deps: d, calls } = deps({
      readCurrentApprovals: current("FINAL_SHIPMENT", {
        status,
        assignedApproverUserId: "user-1",
      }),
    });

    await notifyRepairCaseApprovalCreated("case-1", "FINAL_SHIPMENT", d);

    assert.deepEqual(calls.notified, [], `${status} 인데 포털을 불렀다`);
    assert.deepEqual(calls.askedSubjectsFor, [], `${status} 인데 사람을 읽었다`);
  }
});

test("요청 기록이 아예 없거나 다른 종류뿐이면 부르지 않는다", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: async () => [
      { approvalType: "REPAIR_INSPECTION" as const, latest: null },
      {
        approvalType: "FINAL_SHIPMENT" as const,
        latest: { status: "REQUESTED", assignedApproverUserId: "user-1" },
      },
    ],
  });

  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  assert.deepEqual(calls.notified, [], "다른 종류의 요청을 보고 메일을 띄웠다");
});

test("🔴 지정 없는 검수 결재 — **요청 창의 후보 목록 그대로** 자격자 모두에게 간다", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("REPAIR_INSPECTION", {
      status: "REQUESTED",
      assignedApproverUserId: null,
    }),
    listInspectionApprovers: async () => [{ id: "user-a" }, { id: "user-b" }],
  });

  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  // 🔴 한 번의 왕복에 둘 다 실린다 — 사람마다 따로 부르면 상한이 곱해진다.
  assert.equal(calls.notified.length, 1, "사람 수만큼 포털을 불렀다");
  assert.deepEqual(calls.notified[0].sort(), ["portal-user-a", "portal-user-b"]);
});

test("🔴 지정 없는 최종 출하 결재 — 후보는 넓게 모으고 **거르는 일은 기존 판정**이 한다", async () => {
  // 🔴 물어본 후보를 여기서 따로 적는다 — 아래에서 resolveShipmentDecide 를
  //    갈아 끼우므로 deps() 가 들고 있는 기록은 안 쌓인다.
  const 물어본후보: string[] = [];
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("FINAL_SHIPMENT", {
      status: "REQUESTED",
      assignedApproverUserId: null,
    }),
    listRepresentativeCandidates: async () => [
      { id: "rep-ok", isShipmentRepresentative: true },
      { id: "rep-unflagged", isShipmentRepresentative: false },
    ],
    listDelegations: async () => [
      { delegateUserId: "delegate-ok", status: "ACTIVE" },
      { delegateUserId: "delegate-revoked", status: "REVOKED" },
    ],
    // 대표 표시가 켜진 사람과 살아 있는 위임의 대리인만 물어야 한다. 그중에서도
    // 자격이 없다고 답한 사람은 빠진다 — 그 판정은 이 파일이 하지 않는다.
    resolveShipmentDecide: async (userId) => {
      물어본후보.push(userId);
      return { allowed: userId !== "rep-ok" };
    },
  });

  await notifyRepairCaseApprovalCreated("case-1", "FINAL_SHIPMENT", d);

  assert.ok(물어본후보.length > 0, "아무도 안 물었다 — 이 시험이 아무것도 안 본다");
  assert.deepEqual(
    물어본후보.sort(),
    ["delegate-ok", "rep-ok"],
    "🔴 물어본 후보가 다르다 — 대표 표시가 꺼진 사람이나 철회된 위임이 섞였다"
  );
  assert.equal(calls.notified.length, 1);
  assert.deepEqual(calls.notified[0], ["portal-delegate-ok"], "자격 없다고 답한 사람에게 갔다");
});

test("대표도 살아 있는 위임도 없으면 아무도 묻지 않고 끝난다", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("FINAL_SHIPMENT", {
      status: "REQUESTED",
      assignedApproverUserId: null,
    }),
  });

  await notifyRepairCaseApprovalCreated("case-1", "FINAL_SHIPMENT", d);

  assert.deepEqual(calls.shipmentDecideAsked, []);
  assert.deepEqual(calls.notified, []);
});

test("🔴 포털 번호가 없는 사람은 **부르지 않고 로그에 남는다** — 통합 메일을 못 받는다", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("REPAIR_INSPECTION", {
      status: "REQUESTED",
      assignedApproverUserId: null,
    }),
    listInspectionApprovers: async () => [{ id: "user-linked" }, { id: "user-local-only" }],
    readPortalSubject: async (userId) => (userId === "user-linked" ? "portal-linked" : null),
  });

  const { logged } = await captureLogs(() =>
    notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d)
  );

  assert.deepEqual(calls.notified, [["portal-linked"]], "포털 번호 없는 사람이 섞여 나갔다");
  assert.match(logged, /user-local-only/, "🔴 빠진 사람이 로그에 한 줄도 안 남았다");
  // 🔵 남기는 것은 A/S 의 사용자 번호뿐이다 — 포털 번호는 사람을 가리키는 값이라
  //    이 묶음의 로그 규약상 찍지 않는다.
  assert.ok(!logged.includes("portal-linked"), "🔴 로그에 포털 번호를 실었다");
});

test("아무도 포털과 이어져 있지 않으면 포털을 **아예 부르지 않는다**", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("REPAIR_INSPECTION", {
      status: "REQUESTED",
      assignedApproverUserId: "user-local-only",
    }),
    readPortalSubject: async () => null,
  });

  await captureLogs(() => notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d));

  assert.deepEqual(calls.notified, [], "빈 몸통으로 포털을 불렀다");
});

test("같은 사람이 두 번 걸려도 한 번만 묻고 한 번만 싣는다", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("FINAL_SHIPMENT", {
      status: "REQUESTED",
      assignedApproverUserId: null,
    }),
    // 대표이면서 동시에 다른 대표의 대리인인 사람.
    listRepresentativeCandidates: async () => [{ id: "user-both", isShipmentRepresentative: true }],
    listDelegations: async () => [{ delegateUserId: "user-both", status: "ACTIVE" }],
    resolveShipmentDecide: async () => ({ allowed: true }),
  });

  await notifyRepairCaseApprovalCreated("case-1", "FINAL_SHIPMENT", d);

  assert.deepEqual(calls.askedSubjectsFor, ["user-both"]);
  assert.deepEqual(calls.notified, [["portal-user-both"]]);
});

test("🔴 무슨 일이 있어도 던지지 않는다 — 조회가 터져도 결재는 이미 저장됐다", async () => {
  const 터지는조회: Partial<RepairCaseApprovalNoticeDeps>[] = [
    {
      readCurrentApprovals: async () => {
        throw new Error("DB 가 죽었다");
      },
    },
    {
      readCurrentApprovals: current("REPAIR_INSPECTION", {
        status: "REQUESTED",
        assignedApproverUserId: null,
      }),
      listInspectionApprovers: async () => {
        throw new Error("DB 가 죽었다");
      },
    },
    {
      readCurrentApprovals: current("REPAIR_INSPECTION", {
        status: "REQUESTED",
        assignedApproverUserId: "user-1",
      }),
      readPortalSubject: async () => {
        throw new Error("DB 가 죽었다");
      },
    },
    {
      readCurrentApprovals: current("REPAIR_INSPECTION", {
        status: "REQUESTED",
        assignedApproverUserId: "user-1",
      }),
      notifyPortal: async () => {
        throw new Error("포털이 죽었다");
      },
    },
  ];

  for (const [at, override] of 터지는조회.entries()) {
    const { deps: d } = deps(override);
    const { logged } = await captureLogs(() =>
      notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d)
    );
    // 🔴 조용히 삼키지 않는다 — 한 줄은 남아야 「메일이 안 와요」를 쫓아갈 수 있다.
    assert.match(logged, /알림을 준비하지 못했습니다/, `${at} 번째: 로그 한 줄도 안 남았다`);
  }
});

/* -------------------------------------------------------------------------- */
/* 견적서 결재 — 언제나 지정이 있다                                            */
/* -------------------------------------------------------------------------- */

function quoteDeps(overrides: Partial<QuoteApprovalNoticeDeps> = {}) {
  const calls = { notified: [] as string[][] };
  const base: QuoteApprovalNoticeDeps = {
    readQuoteProgress: async () => null,
    readPortalSubject: async (userId) => `portal-${userId}`,
    notifyPortal: async (subjects) => {
      calls.notified.push([...subjects]);
      return true;
    },
  };
  return { deps: { ...base, ...overrides }, calls };
}

test("견적서 결재 — 지정된 그 한 사람에게 간다", async () => {
  const { deps: d, calls } = quoteDeps({
    readQuoteProgress: async () => ({
      latest: { status: "REQUESTED", assignedApproverUserId: "user-step-2" },
    }),
  });

  await notifyQuoteApprovalCreated("quote-1", d);

  assert.deepEqual(calls.notified, [["portal-user-step-2"]]);
});

test("견적서 결재 — 사슬이 끝났거나(승인) 끊겼으면(반려) 아무것도 안 나간다", async () => {
  for (const status of ["APPROVED", "REJECTED"]) {
    const { deps: d, calls } = quoteDeps({
      readQuoteProgress: async () => ({
        latest: { status, assignedApproverUserId: "user-1" },
      }),
    });

    await notifyQuoteApprovalCreated("quote-1", d);

    assert.deepEqual(calls.notified, [], `${status} 인데 포털을 불렀다`);
  }
});

test("견적서가 없거나 한 번도 올린 적이 없으면 부르지 않는다", async () => {
  for (const progress of [null, { latest: null }]) {
    const { deps: d, calls } = quoteDeps({ readQuoteProgress: async () => progress });
    await notifyQuoteApprovalCreated("quote-1", d);
    assert.deepEqual(calls.notified, []);
  }
});

test("🔴 지정 없는 견적서 결재 행은 생길 수 없다 — 생겼다면 **조용히 넘기지 않고 적는다**", async () => {
  const { deps: d, calls } = quoteDeps({
    readQuoteProgress: async () => ({
      latest: { status: "REQUESTED", assignedApproverUserId: null },
    }),
  });

  const { logged } = await captureLogs(() => notifyQuoteApprovalCreated("quote-1", d));

  assert.deepEqual(calls.notified, [], "누구에게 보낼지 모르는데 포털을 불렀다");
  assert.match(logged, /지정이 없는 견적서 결재/);
});

test("🔴 견적서 쪽도 던지지 않는다", async () => {
  const { deps: d } = quoteDeps({
    readQuoteProgress: async () => {
      throw new Error("DB 가 죽었다");
    },
  });

  const { logged } = await captureLogs(() => notifyQuoteApprovalCreated("quote-1", d));

  assert.match(logged, /견적서 결재 생성 알림을 준비하지 못했습니다/);
});
