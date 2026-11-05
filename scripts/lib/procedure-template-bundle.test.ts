import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROCEDURE_BUNDLE_FORMAT,
  PROCEDURE_BUNDLE_FORMAT_VERSION,
  checkBundleInternalConsistency,
  formatBundleApplySummary,
  formatBundleBlockers,
  parseProcedureBundle,
  planProcedureBundleInsert,
  type BundleBlockerCode,
  type ExistingInTarget,
  type ProcedureBundle,
} from "./procedure-template-bundle";

/**
 * ============================================================================
 * 개발 → 운영으로 **절차를 떠서 옮기는** 길의 머리 시험
 * ============================================================================
 * 재는 것은 다섯이다 — 사용자 칸 바꿔치기 · id 충돌 멈춤 · 이름 충돌 멈춤 ·
 * 이어가기 나중 채우기 · DRAFT 유지. 전부 DB 없이 값으로 잴 수 있다.
 *
 * 🔴 **표본이 비어서 공짜로 통과하는 것부터 막는다.** 아래 `본보기 짐 자체를 먼저
 * 잰다` 절이 그 못이다 — 「노드마다 이어가기가 비워졌다」는 **이어가기가 하나도 없는
 * 짐**에서도 참이고, 「전부 DRAFT 다」는 **절차가 0개**여도 참이다. 그래서 무엇을
 * 재는지를 먼저 단언하고, 그 단언이 깨지면 아래 시험들은 뜻을 잃는다.
 *
 * 🔵 이름과 내용은 **전부 지어낸 것**이다. 실제 절차 이름·고객사·형식은 한 글자도
 * 넣지 않는다(공개 저장소로 밀려가는 날을 생각한다).
 */

/** 보기 좋은 가짜 UUID. 번호만 다르고 모양은 진짜와 같다. */
function uuid(slot: number): string {
  const tail = String(slot).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

const TEMPLATE_A = uuid(1);
const TEMPLATE_B = uuid(2);
const NODE_A1 = uuid(11);
const NODE_A2 = uuid(12);
const NODE_B1 = uuid(13);
const EDGE_A1 = uuid(21);
const EDGE_B1 = uuid(22);
const ISSUE_A1 = uuid(31);
const ACTOR = uuid(99);

/**
 * 시험이 주무를 **온전한 짐 한 벌**.
 *
 * 모양은 실제로 뜬 것과 같다 — 절차 둘, 그 가운데 하나의 끝 노드가 **다른 절차를
 * 가리킨다**(이것이 「나중에 채우기」가 필요한 까닭이고, 이 짐에 그런 줄이 없으면
 * 아래 시험들은 아무것도 안 재게 된다).
 */
function buildBundle(): ProcedureBundle {
  const templates: ProcedureBundle["templates"] = [
    {
      id: TEMPLATE_A,
      code: "TEST-20260101-AAAAAA",
      name: "[시험] 앞 절차",
      equipmentType: "RFG",
      category: "TECHNICAL_TASK",
      description: "지어낸 절차입니다.",
      status: "DRAFT",
      isReferenceOnly: false,
      version: 1,
      sourceType: "EXCEL_IMPORT",
      sourceFileName: "가짜워크북.xlsx",
      sourceFileHash: "0".repeat(64),
      supersedesTemplateId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    },
    {
      id: TEMPLATE_B,
      code: "TEST-20260101-BBBBBB",
      name: "[시험] 뒤 절차",
      equipmentType: "MB",
      category: "TECHNICAL_TASK",
      description: null,
      status: "DRAFT",
      isReferenceOnly: false,
      version: 1,
      sourceType: "EXCEL_IMPORT",
      sourceFileName: "가짜워크북.xlsx",
      sourceFileHash: "0".repeat(64),
      supersedesTemplateId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    },
  ];

  const baseNode = {
    description: null,
    objective: null,
    preparation: null,
    toolsAndEquipment: null,
    safetyCaution: null,
    instructions: null,
    expectedNormalResult: null,
    ngSymptoms: null,
    recommendedCorrectiveAction: null,
    acceptanceCriteria: null,
    workerMayAddNextTask: true,
    userPositionX: null,
    userPositionY: null,
    sourceWorksheet: "가짜시트",
    sourceShapeId: null,
    sourceCellRange: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const nodes: ProcedureBundle["nodes"] = [
    {
      ...baseNode,
      id: NODE_A1,
      procedureTemplateId: TEMPLATE_A,
      nodeCode: "t1-1",
      nodeType: "START",
      title: "시작",
      nextProcedureTemplateId: null,
      positionX: 0,
      positionY: 0,
      sortOrder: 0,
    },
    {
      ...baseNode,
      id: NODE_A2,
      procedureTemplateId: TEMPLATE_A,
      nodeCode: "t1-2",
      nodeType: "END",
      title: "끝 — 뒤 절차로 이어진다",
      // 🔴 이 한 줄이 「나중에 채우기」를 재게 해 준다.
      nextProcedureTemplateId: TEMPLATE_B,
      positionX: 0,
      positionY: 200,
      sortOrder: 1,
    },
    {
      ...baseNode,
      id: NODE_B1,
      procedureTemplateId: TEMPLATE_B,
      nodeCode: "t2-1",
      nodeType: "START",
      title: "시작",
      nextProcedureTemplateId: null,
      positionX: 0,
      positionY: 0,
      sortOrder: 0,
    },
  ];

  const edges: ProcedureBundle["edges"] = [
    {
      id: EDGE_A1,
      procedureTemplateId: TEMPLATE_A,
      fromNodeId: NODE_A1,
      toNodeId: NODE_A2,
      branchType: "DEFAULT",
      branchLabel: null,
      conditionDefinition: null,
      sortOrder: 0,
      sourceConnectorId: "connector#1",
      clonedFromEdgeId: null,
      userRoutePoints: null,
    },
    {
      id: EDGE_B1,
      procedureTemplateId: TEMPLATE_B,
      fromNodeId: NODE_B1,
      toNodeId: NODE_B1,
      branchType: "DEFAULT",
      branchLabel: null,
      conditionDefinition: null,
      sortOrder: 0,
      sourceConnectorId: null,
      clonedFromEdgeId: null,
      userRoutePoints: null,
    },
  ];

  const issues: ProcedureBundle["issues"] = [
    {
      id: ISSUE_A1,
      procedureTemplateId: TEMPLATE_A,
      severity: "WARNING",
      issueType: "INVALID_NEXT_PROCEDURE_LINK",
      message: "이어갈 절차를 아직 비워 뒀습니다.",
      sourceWorksheet: "가짜시트",
      sourceReference: "node:t1-2",
      rawEvidence: null,
      resolutionStatus: "UNRESOLVED",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  return {
    format: PROCEDURE_BUNDLE_FORMAT,
    formatVersion: PROCEDURE_BUNDLE_FORMAT_VERSION,
    exportedAt: "2026-01-03T00:00:00.000Z",
    exportedFrom: "127.0.0.1:5442/가짜db",
    selection: "지어낸 잣대",
    counts: { templates: 2, nodes: 3, edges: 2, issues: 1 },
    templates,
    nodes,
    edges,
    issues,
  };
}

/** 운영이 **텅 비어 있을 때**의 사실 — 아무것도 안 걸리는 바닥값. */
function emptyTarget(): ExistingInTarget {
  return {
    templateIds: [],
    nodeIds: [],
    edgeIds: [],
    issueIds: [],
    nameMatches: [],
    codeVersionMatches: [],
    actor: { id: ACTOR, name: "가짜 관리자" },
  };
}

function codesOf(blockers: readonly { code: BundleBlockerCode }[]): BundleBlockerCode[] {
  return blockers.map((blocker) => blocker.code);
}

describe("절차 짐 — 🔵 본보기 짐 자체를 먼저 잰다 (빈 표본으로 공짜 통과 막기)", () => {
  it("짐에 절차 둘 · 노드 셋 · 분기 둘 · 메모 하나가 실제로 들어 있다", () => {
    const bundle = buildBundle();
    assert.equal(bundle.templates.length, 2);
    assert.equal(bundle.nodes.length, 3);
    assert.equal(bundle.edges.length, 2);
    assert.equal(bundle.issues.length, 1);
  });

  it("🔴 **다른 절차를 가리키는 노드가 하나 있다** — 없으면 「나중에 채우기」 시험이 아무것도 안 잰다", () => {
    const bundle = buildBundle();
    const pointing = bundle.nodes.filter((node) => node.nextProcedureTemplateId !== null);
    assert.equal(pointing.length, 1);
    assert.equal(pointing[0].nextProcedureTemplateId, TEMPLATE_B);
  });

  it("🔴 **짐에는 사용자 칸이 한 개도 없다** — 글자로 훑어도 안 나온다", () => {
    const serialized = JSON.stringify(buildBundle());
    for (const forbidden of [
      "createdByUserId",
      "publishedByUserId",
      "archivedByUserId",
      "deletedBy",
      "resolvedByUserId",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} 가 짐에 실려 있다`);
    }
  });

  it("바닥값(운영이 텅 빔)에서는 걸리는 것이 하나도 없다 — 아래 시험들이 늘 빨간 것이 아니다", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: emptyTarget(),
    });
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.templateRows.length, 2);
    assert.equal(plan.nodeRows.length, 3);
    assert.equal(plan.edgeRows.length, 2);
    assert.equal(plan.issueRows.length, 1);
  });
});

describe("절차 짐 — 사용자 칸 바꿔치기", () => {
  it("🔴 절차마다 created_by_user_id 가 **인자로 받은 운영 사용자**가 된다", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: emptyTarget(),
    });
    assert.equal(plan.templateRows.length, 2);
    for (const row of plan.templateRows) {
      assert.equal(row.createdByUserId, ACTOR);
    }
  });

  it("🔴 운영에서 그 사용자를 못 찾으면 **멈춘다** (created_by_user_id 는 NOT NULL + 외래키)", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: { ...emptyTarget(), actor: null },
    });
    assert.ok(codesOf(plan.blockers).includes("ACTOR_MISSING"), codesOf(plan.blockers).join(","));
  });

  it("🔴 짐에 사용자 칸이 실려 있으면 **읽는 자리에서** 거절한다", () => {
    const raw = buildBundle() as unknown as { templates: Record<string, unknown>[] };
    raw.templates[0].createdByUserId = uuid(777);
    const parsed = parseProcedureBundle(raw);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.ok(
      parsed.blockers.some((blocker) => blocker.message.includes("createdByUserId")),
      parsed.blockers.map((blocker) => blocker.message).join(" / ")
    );
  });

  it("🔴 메모의 resolvedByUserId 도 같은 잣대로 거절한다", () => {
    const raw = buildBundle() as unknown as { issues: Record<string, unknown>[] };
    raw.issues[0].resolvedByUserId = uuid(778);
    const parsed = parseProcedureBundle(raw);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.ok(
      parsed.blockers.some((blocker) => blocker.message.includes("resolvedByUserId")),
      parsed.blockers.map((blocker) => blocker.message).join(" / ")
    );
  });
});

describe("절차 짐 — id 가 운영에 이미 있으면 멈춘다", () => {
  it("🔴 절차 id 가 하나라도 겹치면 멈춘다", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: { ...emptyTarget(), templateIds: [TEMPLATE_A] },
    });
    assert.ok(codesOf(plan.blockers).includes("TEMPLATE_ID_EXISTS"), codesOf(plan.blockers).join(","));
  });

  it("🔴 노드 · 분기 · 메모 id 도 각각 멈출 까닭이 된다", () => {
    for (const [key, code] of [
      ["nodeIds", "NODE_ID_EXISTS"],
      ["edgeIds", "EDGE_ID_EXISTS"],
      ["issueIds", "ISSUE_ID_EXISTS"],
    ] as const) {
      const plan = planProcedureBundleInsert({
        bundle: buildBundle(),
        actorUserId: ACTOR,
        existing: { ...emptyTarget(), [key]: [uuid(500)] },
      });
      assert.ok(codesOf(plan.blockers).includes(code), `${key}: ${codesOf(plan.blockers).join(",")}`);
    }
  });

  it("🔴 (code, 판) 이 겹쳐도 멈춘다 — DB 의 유일키라 INSERT 가 거절당한다", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: {
        ...emptyTarget(),
        codeVersionMatches: [{ id: uuid(600), code: "TEST-20260101-AAAAAA", version: 1 }],
      },
    });
    assert.ok(codesOf(plan.blockers).includes("CODE_VERSION_EXISTS"), codesOf(plan.blockers).join(","));
  });
});

describe("절차 짐 — 이름이 겹치면 멈춘다", () => {
  it("🔴 살아 있는 절차와 이름이 겹치면 멈춘다", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: {
        ...emptyTarget(),
        nameMatches: [
          { id: uuid(700), name: "[시험] 앞 절차", code: "TEST-OTHER", status: "DRAFT", isDeleted: false },
        ],
      },
    });
    assert.ok(codesOf(plan.blockers).includes("NAME_EXISTS"), codesOf(plan.blockers).join(","));
  });

  it("🔴 **휴지통에 있는** 절차와 겹쳐도 멈춘다 — 15일 안에 복원되면 똑같이 겹친다", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: {
        ...emptyTarget(),
        nameMatches: [
          { id: uuid(701), name: "[시험] 뒤 절차", code: "TEST-OTHER", status: "DRAFT", isDeleted: true },
        ],
      },
    });
    const blocker = plan.blockers.find((candidate) => candidate.code === "NAME_EXISTS");
    assert.ok(blocker, codesOf(plan.blockers).join(","));
    assert.ok(blocker.message.includes("휴지통"), blocker.message);
  });
});

describe("절차 짐 — 이어가기는 **나중에** 채운다", () => {
  it("🔴 1단계에 넣는 노드는 next_procedure_template_id 가 전부 비어 있다", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: emptyTarget(),
    });
    assert.equal(plan.nodeRows.length, 3);
    for (const row of plan.nodeRows) {
      assert.equal(row.nextProcedureTemplateId, null);
    }
  });

  it("🔴 비운 만큼이 **2단계 목록**에 그대로 남는다 — 조용히 사라지지 않는다", () => {
    const bundle = buildBundle();
    const expected = bundle.nodes.filter((node) => node.nextProcedureTemplateId !== null);
    // 🔵 표본 못: 원본에 이어가기가 하나라도 있어야 아래 비교에 뜻이 있다.
    assert.equal(expected.length, 1);

    const plan = planProcedureBundleInsert({ bundle, actorUserId: ACTOR, existing: emptyTarget() });
    assert.deepEqual(plan.deferredNodeNextProcedure, [
      { id: NODE_A2, nodeCode: "t1-2", nextProcedureTemplateId: TEMPLATE_B },
    ]);
  });

  it("🔴 상위판(supersedes)도 같은 길로 간다 — 1단계는 비우고 2단계가 채운다", () => {
    const bundle = buildBundle();
    bundle.templates[1].supersedesTemplateId = TEMPLATE_A;
    const plan = planProcedureBundleInsert({ bundle, actorUserId: ACTOR, existing: emptyTarget() });
    assert.deepEqual(plan.blockers, []);
    for (const row of plan.templateRows) {
      assert.equal(row.supersedesTemplateId, null);
    }
    assert.deepEqual(plan.deferredTemplateSupersedes, [
      { id: TEMPLATE_B, supersedesTemplateId: TEMPLATE_A },
    ]);
  });

  it("🔴 분기의 cloned_from_edge_id 도 같은 길로 간다", () => {
    const bundle = buildBundle();
    bundle.edges[1].clonedFromEdgeId = EDGE_A1;
    const plan = planProcedureBundleInsert({ bundle, actorUserId: ACTOR, existing: emptyTarget() });
    assert.deepEqual(plan.blockers, []);
    for (const row of plan.edgeRows) {
      assert.equal(row.clonedFromEdgeId, null);
    }
    assert.deepEqual(plan.deferredEdgeClonedFrom, [{ id: EDGE_B1, clonedFromEdgeId: EDGE_A1 }]);
  });

  it("🔴 이어가기가 **짐 밖**을 가리키면 멈춘다 — 운영에 그 절차가 없다", () => {
    const bundle = buildBundle();
    bundle.nodes[1].nextProcedureTemplateId = uuid(888);
    const blockers = checkBundleInternalConsistency(bundle);
    assert.ok(codesOf(blockers).includes("INTERNAL_INCONSISTENT"), codesOf(blockers).join(","));
    assert.ok(
      blockers.some((blocker) => blocker.message.includes("짐 밖")),
      blockers.map((blocker) => blocker.message).join(" / ")
    );
  });
});

describe("절차 짐 — DRAFT 로 넣는다", () => {
  it("🔴 넣는 줄은 전부 DRAFT 다", () => {
    const plan = planProcedureBundleInsert({
      bundle: buildBundle(),
      actorUserId: ACTOR,
      existing: emptyTarget(),
    });
    assert.equal(plan.templateRows.length, 2);
    for (const row of plan.templateRows) {
      assert.equal(row.status, "DRAFT");
    }
  });

  it("🔴 짐에 DRAFT 가 아닌 줄이 섞이면 **말없이 떨어뜨리지 않고 멈춘다**", () => {
    const bundle = buildBundle();
    (bundle.templates[0] as { status: string }).status = "PUBLISHED";
    const plan = planProcedureBundleInsert({ bundle, actorUserId: ACTOR, existing: emptyTarget() });
    assert.ok(codesOf(plan.blockers).includes("NOT_DRAFT"), codesOf(plan.blockers).join(","));
  });

  /**
   * 🔴 **두 겹을 따로 잰다.** 바로 위 시험은 「멈추는가」만 보고, 짐이 전부 DRAFT 인
   * 바닥값에서는 「DRAFT 로 박는가」가 **재지지 않는다**(원래 DRAFT 라 그냥 통과한다).
   * 실제로 `status: "DRAFT"` 를 `template.status` 로 바꿔 놓고 돌렸더니 31개가 전부
   * 초록이었다 — 그래서 **DRAFT 가 아닌 표본**으로 박는 쪽을 따로 잰다.
   */
  it("🔴 DRAFT 가 아닌 표본에서도 **넣는 줄은 DRAFT 로 박힌다**", () => {
    const bundle = buildBundle();
    (bundle.templates[0] as { status: string }).status = "PUBLISHED";
    // 🔵 표본 못 — 원본이 정말 PUBLISHED 여야 아래 단언에 뜻이 있다.
    assert.equal((bundle.templates[0] as { status: string }).status, "PUBLISHED");

    const plan = planProcedureBundleInsert({ bundle, actorUserId: ACTOR, existing: emptyTarget() });
    assert.equal(plan.templateRows.length, 2);
    for (const row of plan.templateRows) {
      assert.equal(row.status, "DRAFT");
    }
  });
});

describe("절차 짐 — 날짜는 Date 로 바뀌어 들어간다", () => {
  it("createdAt · updatedAt 이 원본 ISO 와 같은 순간을 가리킨다", () => {
    const bundle = buildBundle();
    const plan = planProcedureBundleInsert({ bundle, actorUserId: ACTOR, existing: emptyTarget() });
    assert.equal(plan.templateRows[0].createdAt.toISOString(), bundle.templates[0].createdAt);
    assert.equal(plan.templateRows[0].updatedAt.toISOString(), bundle.templates[0].updatedAt);
    assert.equal(plan.nodeRows[0].createdAt.toISOString(), bundle.nodes[0].createdAt);
    assert.equal(plan.issueRows[0].createdAt.toISOString(), bundle.issues[0].createdAt);
  });
});

describe("절차 짐 — 파일을 읽어 들이는 자리", () => {
  it("온전한 짐은 그대로 통과한다", () => {
    const parsed = parseProcedureBundle(buildBundle());
    assert.equal(parsed.ok, true);
  });

  it("🔴 **절차가 0개면 멈춘다** — 「넣을 것이 없으니 성공」으로 읽지 않는다", () => {
    const bundle = buildBundle();
    const empty = { ...bundle, templates: [], nodes: [], edges: [], issues: [] };
    empty.counts = { templates: 0, nodes: 0, edges: 0, issues: 0 };
    const parsed = parseProcedureBundle(empty);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.ok(codesOf(parsed.blockers).includes("EMPTY_BUNDLE"), codesOf(parsed.blockers).join(","));
  });

  it("🔴 counts 와 실제 줄 수가 다르면 멈춘다 — 파일이 잘렸을 수 있다", () => {
    const bundle = buildBundle();
    bundle.nodes.pop();
    const parsed = parseProcedureBundle(bundle);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.ok(codesOf(parsed.blockers).includes("COUNT_MISMATCH"), codesOf(parsed.blockers).join(","));
  });

  it("🔴 모르는 판(formatVersion)은 읽지 않는다", () => {
    const parsed = parseProcedureBundle({ ...buildBundle(), formatVersion: 99 });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.ok(codesOf(parsed.blockers).includes("BAD_FORMAT"), codesOf(parsed.blockers).join(","));
  });

  it("🔴 아는 값이 아닌 enum 은 거절한다 — DB 에 닿기 전에 걸린다", () => {
    const raw = buildBundle() as unknown as { nodes: Record<string, unknown>[] };
    raw.nodes[0].nodeType = "존재하지_않는_종류";
    const parsed = parseProcedureBundle(raw);
    assert.equal(parsed.ok, false);
  });
});

describe("절차 짐 — 짐이 스스로 앞뒤가 맞는가", () => {
  it("🔴 분기가 짐에 없는 노드를 가리키면 멈춘다", () => {
    const bundle = buildBundle();
    bundle.edges[0].toNodeId = uuid(901);
    const blockers = checkBundleInternalConsistency(bundle);
    assert.ok(blockers.length > 0);
    assert.ok(
      blockers.some((blocker) => blocker.message.includes("to 노드")),
      blockers.map((blocker) => blocker.message).join(" / ")
    );
  });

  it("🔴 한 절차 안에서 노드 코드가 겹치면 멈춘다 — DB 의 유일키다", () => {
    const bundle = buildBundle();
    bundle.nodes[1].nodeCode = bundle.nodes[0].nodeCode;
    const blockers = checkBundleInternalConsistency(bundle);
    assert.ok(
      blockers.some((blocker) => blocker.message.includes("노드 코드가 겹칩니다")),
      blockers.map((blocker) => blocker.message).join(" / ")
    );
  });

  it("🔴 메모가 짐에 없는 절차를 가리키면 멈춘다", () => {
    const bundle = buildBundle();
    bundle.issues[0].procedureTemplateId = uuid(902);
    const blockers = checkBundleInternalConsistency(bundle);
    assert.ok(blockers.length > 0, "메모의 주인이 짐에 없는데 통과했다");
  });
});

describe("절차 짐 — 사람에게 보여 줄 글", () => {
  it("결과 한 줄에 센 값이 그대로 들어간다", () => {
    const line = formatBundleApplySummary({
      templates: 25,
      nodes: 836,
      edges: 1095,
      issues: 58,
      linkedNextProcedure: 12,
      linkedSupersedes: 0,
      linkedClonedFrom: 0,
    });
    assert.ok(line.startsWith("결과: 절차 25 · 노드 836 · 분기 1095 · 메모 58"), line);
    assert.ok(line.includes("이어가기 12"), line);
  });

  it("멈출 때는 **몇 건이 왜** 걸렸는지가 줄마다 적힌다", () => {
    const text = formatBundleBlockers([
      { code: "NAME_EXISTS", message: "같은 이름이 있습니다." },
      { code: "NOT_DRAFT", message: "초안이 아닙니다." },
    ]);
    assert.ok(text.includes("2건"), text);
    assert.ok(text.includes("[NAME_EXISTS]"), text);
    assert.ok(text.includes("[NOT_DRAFT]"), text);
  });
});
