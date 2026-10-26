import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actingDelegateUserIdsFor,
  type ApprovalRouteDelegationPeriod,
} from "@/lib/domain/approval-route-delegation";
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
 *     지정이 있으면 그 사람 **과 그 사람의 대리인들**, 없으면 자격 있는 사람들.
 *     🔴 대리인은 2026-10-26 에 더했다. 그 전에는 지정된 한 사람에게만 가서
 *     **자리를 비운 사람이 메일을 받고 대신 눌러야 할 사람은 못 받았다.**
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
    /** 🔴 **누구의 대리인을 물었나.** 지정이 없을 때는 비어 있어야 한다. */
    routeDelegatesAskedFor: [] as string[],
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
    listRouteDelegatesFor: async (approverUserId) => {
      calls.routeDelegatesAskedFor.push(approverUserId);
      return [];
    },
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

test("🔴 지정이 있으면 **그 사람과 대리인들**뿐이다 — 지정 없는 길의 자격자 목록은 묻지도 않는다", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("REPAIR_INSPECTION", {
      status: "REQUESTED",
      assignedApproverUserId: "user-assigned",
    }),
  });

  // 기본 묶음은 「대리인 없음」이라, 여기서 나가는 것은 지정된 한 사람뿐이다.
  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  assert.deepEqual(calls.notified, [["portal-user-assigned"]]);
  // 🔴 묻는 것은 **그 사람의 대리인**뿐이다. 「자격 있는 사람 전원」을 묻는 길은
  //    지정이 없을 때의 것이고, 지정이 있는데 그 길로 가면 결재가 생길 때마다
  //    관계없는 사람들에게 메일이 간다.
  assert.deepEqual(calls.routeDelegatesAskedFor, ["user-assigned"]);
  assert.equal(calls.inspectionAsked, 0, "지정이 있는데 자격자 목록을 물었다");
  assert.equal(calls.representativesAsked, 0, "지정이 있는데 대표 목록을 물었다");
});

/* -------------------------------------------------------------------------- */
/* 결재선 단계 위임 — 지정된 사람 **과 그 대리인들** (2026-10-26)                */
/* -------------------------------------------------------------------------- */

/**
 * 🔴 **가짜 대답을 손으로 적지 않고 진짜 규칙을 통과시킨다.** 위임 줄을 그대로 주고
 * domain/approval-route-delegation.ts 의 `actingDelegateUserIdsFor` 를 꽂는다 —
 * 운영에서 꽂히는 조회(queries/approval-route-delegations.ts 의
 * `resolveActingDelegateUserIds`)가 하는 일이 정확히 그것이기 때문이다. 여기에
 * `async () => ["user-delegate"]` 를 적어 두면 「기간이 지나면 안 간다」 같은 시험이
 * 규칙이 아니라 **그 손글씨**를 재게 되고, 규칙이 뒤집혀도 초록으로 통과한다.
 *
 * 🔵 DB 쪽이 `revoked_at IS NULL AND ends_at > now` 로 한 번 더 좁히는 것은 흉내 내지
 *    않는다. 그 좁히기가 지우는 줄은 순수 함수가 어차피 버리는 줄뿐이라 답이 같고(그
 *    함수 주석), 흉내 내면 같은 조건이 시험에 두 벌 적힌다.
 */
const 지금 = new Date("2026-03-15T00:00:00.000Z");

/** 가짜 위임 한 줄. 기본은 **지금 살아 있는** 「지정자 → 대리인」이다. */
function 위임(
  overrides: Partial<ApprovalRouteDelegationPeriod> = {}
): ApprovalRouteDelegationPeriod {
  return {
    delegatorUserId: "user-assigned",
    delegateUserId: "user-delegate",
    startsAt: new Date("2026-03-10T00:00:00.000Z"),
    endsAt: new Date("2026-03-20T00:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  };
}

/** 그 줄들을 **진짜 규칙으로** 걸러 돌려주는 조회. */
function 위임조회(rows: readonly ApprovalRouteDelegationPeriod[]) {
  return async (approverUserId: string) => actingDelegateUserIdsFor(rows, approverUserId, 지금);
}

/** 지정이 있는 검수 결재 하나 — 아래 시험들이 공통으로 쓰는 자리. */
function 지정된결재(rows: readonly ApprovalRouteDelegationPeriod[]) {
  return deps({
    readCurrentApprovals: current("REPAIR_INSPECTION", {
      status: "REQUESTED",
      assignedApproverUserId: "user-assigned",
    }),
    listRouteDelegatesFor: 위임조회(rows),
  });
}

test("🔴 지정된 사람의 **대리인에게도** 간다 — 지정된 사람은 그대로 남는다", async () => {
  const { deps: d, calls } = 지정된결재([위임()]);

  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  assert.equal(calls.notified.length, 1, "사람마다 따로 포털을 불렀다");
  assert.deepEqual(
    calls.notified[0],
    ["portal-user-assigned", "portal-user-delegate"],
    "🔴 지정된 사람이 빠졌거나 대리인이 안 실렸다"
  );
});

test("🔴 대리인이 둘이면 둘 다 — 두 사람이 동시에 대신할 수 있다", async () => {
  const { deps: d, calls } = 지정된결재([
    위임({ delegateUserId: "user-delegate-1" }),
    위임({ delegateUserId: "user-delegate-2" }),
  ]);

  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  assert.deepEqual(calls.notified[0].sort(), [
    "portal-user-assigned",
    "portal-user-delegate-1",
    "portal-user-delegate-2",
  ]);
});

test("🔴 기간이 지난 위임의 대리인에게는 안 간다 — 살아 있었다면 갔을 줄이다", async () => {
  const 끝난줄 = 위임({
    startsAt: new Date("2026-02-01T00:00:00.000Z"),
    endsAt: new Date("2026-02-10T00:00:00.000Z"),
  });
  // 🔵 표본이 비어서 공짜로 통과하지 않게 — **기간만 달랐다면** 갔다는 것을 먼저 본다.
  const { deps: 살아있을때, calls: 살아있을때기록 } = 지정된결재([위임()]);
  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", 살아있을때);
  assert.ok(
    살아있을때기록.notified[0].includes("portal-user-delegate"),
    "표본이 틀렸다 — 살아 있는 줄인데도 대리인에게 안 갔다"
  );

  const { deps: d, calls } = 지정된결재([끝난줄]);
  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  assert.deepEqual(calls.notified, [["portal-user-assigned"]], "🔴 끝난 위임의 대리인에게 갔다");
});

test("🔴 되돌린 위임의 대리인에게는 안 간다 — 되돌림만 없었다면 갔을 줄이다", async () => {
  const 되돌린줄 = 위임({ revokedAt: new Date("2026-03-12T00:00:00.000Z") });
  // 표본 확인 — 같은 줄에서 되돌림만 지우면 대리인이 나온다.
  assert.deepEqual(actingDelegateUserIdsFor([{ ...되돌린줄, revokedAt: null }], "user-assigned", 지금), [
    "user-delegate",
  ]);

  const { deps: d, calls } = 지정된결재([되돌린줄]);
  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  assert.deepEqual(calls.notified, [["portal-user-assigned"]], "🔴 되돌린 위임의 대리인에게 갔다");
});

test("🔴 이어 붙지 않는다 — A→B · B→C 일 때 C 에게는 안 간다", async () => {
  const rows = [
    위임({ delegatorUserId: "user-assigned", delegateUserId: "user-b" }),
    위임({ delegatorUserId: "user-b", delegateUserId: "user-c" }),
  ];
  // 🔵 두 겹이 **둘 다 살아 있는** 표본인지 먼저 — 하나라도 죽어 있으면 이 시험은
  //    아무것도 지키지 못한다.
  assert.deepEqual(actingDelegateUserIdsFor(rows, "user-assigned", 지금), ["user-b"]);
  assert.deepEqual(actingDelegateUserIdsFor(rows, "user-b", 지금), ["user-c"]);

  const { deps: d, calls } = 지정된결재(rows);
  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  // 여기가 본론 — C 는 그 단계를 누를 수 없는데 메일만 받는 꼴이 되면 안 된다.
  assert.deepEqual(calls.notified, [["portal-user-assigned", "portal-user-b"]]);
});

test("🔴 대리인이 이미 목록에 있어도 **중복이 안 생긴다**", async () => {
  // 🔴 조회가 같은 번호를 두 번 주거나 지정된 사람 본인을 섞어 줘도, 나가는 목록은
  //    한 사람당 한 번이다. 중복이 실리면 포털이 같은 사람에게 두 번 묻는다.
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("REPAIR_INSPECTION", {
      status: "REQUESTED",
      assignedApproverUserId: "user-assigned",
    }),
    listRouteDelegatesFor: async () => ["user-delegate", "user-delegate", "user-assigned"],
  });

  await notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d);

  assert.deepEqual(calls.askedSubjectsFor, ["user-assigned", "user-delegate"]);
  assert.deepEqual(calls.notified, [["portal-user-assigned", "portal-user-delegate"]]);
});

test("🔴 지정이 **없으면** 위임을 묻지도 않는다 — 대표 + 옛 위임 그대로다", async () => {
  // 🔴 결재선을 타지 않는 길의 동작은 이 조각에서 한 글자도 안 바뀐다. 옛 출하 대표
  //    위임(shipment_approval_delegations)과 결재선 단계 위임은 **다른 표**이고,
  //    여기서 새 조회를 끼우면 두 기능이 섞인다.
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("FINAL_SHIPMENT", {
      status: "REQUESTED",
      assignedApproverUserId: null,
    }),
    listRepresentativeCandidates: async () => [{ id: "rep-ok", isShipmentRepresentative: true }],
    listDelegations: async () => [{ delegateUserId: "old-delegate", status: "ACTIVE" }],
    resolveShipmentDecide: async () => ({ allowed: true }),
  });

  await notifyRepairCaseApprovalCreated("case-1", "FINAL_SHIPMENT", d);

  assert.deepEqual(calls.routeDelegatesAskedFor, [], "🔴 지정이 없는데 결재선 위임을 물었다");
  assert.equal(calls.notified.length, 1);
  assert.deepEqual(calls.notified[0].sort(), ["portal-old-delegate", "portal-rep-ok"]);
});

test("🔴 위임 조회가 터져도 **지정된 사람에게는 간다** — 넓히려다 되던 일을 가져가지 않는다", async () => {
  const { deps: d, calls } = deps({
    readCurrentApprovals: current("REPAIR_INSPECTION", {
      status: "REQUESTED",
      assignedApproverUserId: "user-assigned",
    }),
    listRouteDelegatesFor: async () => {
      throw new Error("DB 가 죽었다");
    },
  });

  const { logged } = await captureLogs(() =>
    notifyRepairCaseApprovalCreated("case-1", "REPAIR_INSPECTION", d)
  );

  // 🔴 2026-10-26 이전과 똑같이 지정된 한 사람에게 간다. 바깥 try 에 맡겼다면
  //    이 자리에서 **아무에게도** 안 갔을 것이다.
  assert.deepEqual(calls.notified, [["portal-user-assigned"]]);
  // 조용히 삼키지 않는다 — 대리인이 「메일이 안 와요」 했을 때 쫓아갈 한 줄.
  assert.match(logged, /결재권 위임을 읽지 못해/);
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
  const calls = { notified: [] as string[][], routeDelegatesAskedFor: [] as string[] };
  const base: QuoteApprovalNoticeDeps = {
    readQuoteProgress: async () => null,
    listRouteDelegatesFor: async (approverUserId) => {
      calls.routeDelegatesAskedFor.push(approverUserId);
      return [];
    },
    readPortalSubject: async (userId) => `portal-${userId}`,
    notifyPortal: async (subjects) => {
      calls.notified.push([...subjects]);
      return true;
    },
  };
  return { deps: { ...base, ...overrides }, calls };
}

test("견적서 결재 — 지정된 그 사람에게 간다(대리인이 없을 때)", async () => {
  const { deps: d, calls } = quoteDeps({
    readQuoteProgress: async () => ({
      latest: { status: "REQUESTED", assignedApproverUserId: "user-step-2" },
    }),
  });

  await notifyQuoteApprovalCreated("quote-1", d);

  assert.deepEqual(calls.notified, [["portal-user-step-2"]]);
  assert.deepEqual(calls.routeDelegatesAskedFor, ["user-step-2"]);
});

test("🔴 견적서 결재도 **대리인에게 간다** — 전부 결재선을 타므로 오히려 이 길이 확실하다", async () => {
  // 🔴 견적서 결재는 절차가 없으면 요청 자체가 거절되므로 **언제나 지정이 있다.**
  //    곧 전부 결재선을 탄다는 뜻이고, 그 단계를 대신 누르라고 세운 사람이 바로
  //    결재선 단계 위임의 대리인이다. 여기 조회를 안 꽂으면 그 사람은 결재가 생긴
  //    줄도 모른 채 종을 눌러 봐야 알게 된다.
  const { deps: d, calls } = quoteDeps({
    readQuoteProgress: async () => ({
      latest: { status: "REQUESTED", assignedApproverUserId: "user-step-2" },
    }),
    listRouteDelegatesFor: 위임조회([
      위임({ delegatorUserId: "user-step-2", delegateUserId: "user-stand-in" }),
      // 남의 줄 — 섞여 있어도 안 실린다.
      위임({ delegatorUserId: "user-step-1", delegateUserId: "user-other" }),
    ]),
  });

  await notifyQuoteApprovalCreated("quote-1", d);

  assert.deepEqual(calls.notified, [["portal-user-step-2", "portal-user-stand-in"]]);
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
