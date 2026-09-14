import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  USER_DELETION_PORTAL_NOTICE,
  buildUserDeletionActionInput,
  checkUserDeletionSubmit,
  describeUserDeletionBlocker,
  describeUserDeletionImpact,
  mayShowUserDeletionButton,
  objectParticle,
  retainSuccessorSelection,
  userDeletionSuccessMessage,
  type ReadyUserDeletionPreview,
  type UserDeletionFormState,
} from "./user-deletion-dialog-text";
import type { UserDeletionPreviewImpact } from "@/lib/db/queries/user-deletion-impact";

/**
 * ============================================================================
 * 계정 삭제 확인 창 — 문장 · [삭제] 켜짐 판정 (순수 함수)
 * ============================================================================
 * 확인 창은 서버 액션을 부르므로 이 시험 환경에서 통째로 그릴 수 없다. 무엇을 말하고
 * 언제 누를 수 있는가를 여기서 값으로 본다. 그려진 모양은 UserDeletionParts.test.tsx.
 * ============================================================================
 */

const TARGET = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const APPROVER = "33333333-3333-4333-8333-333333333333";
const ENGINEER = "44444444-4444-4444-8444-444444444444";

function zeroImpact(overrides: Partial<UserDeletionPreviewImpact> = {}): UserDeletionPreviewImpact {
  return {
    routeSlots: [],
    pendingApprovals: { finalShipment: 0, repairInspection: 0, partIssue: 0 },
    chainsToRepin: 0,
    isRepresentative: false,
    isLastRepresentative: false,
    activeDelegations: { asRepresentative: 0, asDelegate: 0 },
    openAssignedCases: 0,
    untouchedAssignedCases: 0,
    openClaimedNodes: 0,
    ownOpenPartRequests: 0,
    ownOpenPartIssueRequests: 0,
    isDeveloper: false,
    isIntakeMailRecipient: false,
    ...overrides,
  };
}

function preview(overrides: Partial<ReadyUserDeletionPreview> = {}): ReadyUserDeletionPreview {
  return {
    ok: true,
    target: {
      id: TARGET,
      name: "김지움",
      role: "AS_ENGINEER",
      version: 7,
      isShipmentRepresentative: false,
      isDeveloper: false,
      isSsoManaged: true,
    },
    impact: zeroImpact(),
    requires: { approvalSuccessor: false, engineerSuccessor: false, approvalSuccessorMustInspect: false },
    candidates: {
      approvalSuccessors: [{ id: APPROVER, name: "이결재", role: "SUPER_ADMIN" }],
      engineerSuccessors: [{ id: ENGINEER, name: "박담당" }],
    },
    blockers: [],
    ...overrides,
  };
}

function form(overrides: Partial<UserDeletionFormState> = {}): UserDeletionFormState {
  return { approvalSuccessorId: "", engineerSuccessorId: "", reason: "퇴사", ...overrides };
}

describe("[계정 삭제]를 보일까", () => {
  test("🔴 권한이 없으면 보이지 않는다", () => {
    assert.equal(mayShowUserDeletionButton({ canDeleteUserAccounts: false, actingUserId: ACTOR, rowUserId: TARGET }), false);
  });

  test("🔴 자기 자신의 줄에는 보이지 않는다 — 대소문자가 달라도", () => {
    assert.equal(mayShowUserDeletionButton({ canDeleteUserAccounts: true, actingUserId: ACTOR, rowUserId: ACTOR }), false);
    assert.equal(
      mayShowUserDeletionButton({ canDeleteUserAccounts: true, actingUserId: ACTOR, rowUserId: ACTOR.toUpperCase() }),
      false
    );
  });

  test("권한이 있고 다른 사람의 줄이면 보인다", () => {
    assert.equal(mayShowUserDeletionButton({ canDeleteUserAccounts: true, actingUserId: ACTOR, rowUserId: TARGET }), true);
  });
});

describe("영향 건수 문장", () => {
  test("🔴 전부 0 이면 아무 문장도 없다", () => {
    assert.deepEqual(describeUserDeletionImpact(zeroImpact()), { changes: [], keeps: [] });
  });

  test("결재선 자리 · 대기 결재 · 담당 중인 접수 건을 넘긴다 — 0 인 항목은 빠진다", () => {
    const text = describeUserDeletionImpact(
      zeroImpact({
        routeSlots: [
          { scope: "FINAL_SHIPMENT", routeVersion: 3, stepOrder: 2 },
          { scope: "PART_ISSUE", routeVersion: 1, stepOrder: 1 },
        ],
        pendingApprovals: { finalShipment: 2, repairInspection: 0, partIssue: 1 },
        openAssignedCases: 4,
      })
    );
    assert.deepEqual(text.changes, [
      "결재 이어받을 사람에게 결재선 자리 2곳(최종 출하 승인 2번째 단계, 부품 불출 1번째 단계) · 대기 결재 3건(최종 출하 승인 2건, 부품 불출 1건)을 넘깁니다.",
      "담당 이어받을 사람에게 담당 중인 접수 건 4건을 넘깁니다.",
    ]);
    assert.deepEqual(text.keeps, []);
    const all = text.changes.join("\n");
    for (const absent of ["수리 검수", "위임", "개발자", "메일", "노드", "대표", "0건", "0곳"]) {
      assert.ok(!all.includes(absent), `0 인 항목 「${absent}」이 문장에 들어갔다: ${all}`);
    }
  });

  test("대표 · 위임 · 개발자 표시 · 메일 수신 · 절차 노드 · 옮기는 결재", () => {
    const text = describeUserDeletionImpact(
      zeroImpact({
        pendingApprovals: { finalShipment: 0, repairInspection: 1, partIssue: 0 },
        isRepresentative: true,
        isLastRepresentative: true,
        chainsToRepin: 2,
        activeDelegations: { asRepresentative: 1, asDelegate: 0 },
        isDeveloper: true,
        isIntakeMailRecipient: true,
        openClaimedNodes: 3,
      })
    );
    assert.deepEqual(text.changes, [
      "결재 이어받을 사람에게 대기 결재 1건(수리 검수 승인 1건)을 넘깁니다.",
      "마지막 출하 대표라서 결재 이어받을 사람이 출하 대표가 됩니다.",
      "진행 중인 결재 2건은 새 승인 절차로 옮겨 이어 갑니다.",
      "위임 1건(대표로서 맡긴 것 1건)을 철회합니다.",
      "출하 대표 지정 · 개발자 표시 · 접수 메일 수신을 해제합니다.",
      "맡고 있던 열린 절차 노드 3개는 접수 건 담당을 따르도록 되돌립니다.",
    ]);
  });

  test("해제 문장의 조사는 마지막 항목을 따른다", () => {
    assert.deepEqual(describeUserDeletionImpact(zeroImpact({ isRepresentative: true, isDeveloper: true })).changes, [
      "출하 대표 지정 · 개발자 표시를 해제합니다.",
    ]);
    assert.deepEqual(describeUserDeletionImpact(zeroImpact({ activeDelegations: { asRepresentative: 0, asDelegate: 2 } })).changes, [
      "위임 2건(위임받은 것 2건)을 철회합니다.",
    ]);
  });

  test("🔴 그대로 두는 것은 「그대로 둡니다」로 따로 적는다 — 넘기는 문장과 섞지 않는다", () => {
    const text = describeUserDeletionImpact(
      zeroImpact({ untouchedAssignedCases: 2, ownOpenPartRequests: 1, ownOpenPartIssueRequests: 0 })
    );
    assert.deepEqual(text.changes, []);
    assert.deepEqual(text.keeps, [
      "휴지통에 있거나 출하 완료로 잠긴 담당 접수 건 2건은 그대로 둡니다.",
      "(참고) 직접 올린 열린 부품 요청 1건은 그대로 둡니다. 재고 담당자가 처리할 수 있습니다.",
    ]);
    const both = describeUserDeletionImpact(zeroImpact({ ownOpenPartRequests: 1, ownOpenPartIssueRequests: 3 }));
    assert.deepEqual(both.keeps, [
      "(참고) 직접 올린 열린 부품 요청 1건 · 부품 불출 신청 3건은 그대로 둡니다. 재고 담당자가 처리할 수 있습니다.",
    ]);
  });

  test("목적격 조사 — 받침 · 괄호 설명", () => {
    assert.equal(objectParticle("개발자 표시"), "를");
    assert.equal(objectParticle("접수 메일 수신"), "을");
    assert.equal(objectParticle("결재선 자리 2곳(최종 출하 승인 1번째 단계)"), "을");
  });
});

describe("[삭제]를 누를 수 있는가", () => {
  const needsBoth = preview({
    requires: { approvalSuccessor: true, engineerSuccessor: true, approvalSuccessorMustInspect: false },
  });

  test("필요한 이어받을 사람을 모두 고르고 사유가 있으면 켜진다", () => {
    assert.deepEqual(
      checkUserDeletionSubmit(needsBoth, form({ approvalSuccessorId: APPROVER, engineerSuccessorId: ENGINEER })),
      { enabled: true }
    );
  });

  test("🔴 결재 이어받을 사람을 고르지 않았으면 꺼진다", () => {
    assert.deepEqual(checkUserDeletionSubmit(needsBoth, form({ engineerSuccessorId: ENGINEER })), {
      enabled: false,
      reason: "결재 이어받을 사람을 골라 주세요.",
    });
    // 후보에 없는 값은 고르지 않은 것과 같다.
    assert.equal(
      checkUserDeletionSubmit(needsBoth, form({ approvalSuccessorId: ACTOR, engineerSuccessorId: ENGINEER })).enabled,
      false
    );
  });

  test("🔴 담당 이어받을 사람을 고르지 않았으면 꺼진다", () => {
    assert.deepEqual(checkUserDeletionSubmit(needsBoth, form({ approvalSuccessorId: APPROVER })), {
      enabled: false,
      reason: "담당 이어받을 사람을 골라 주세요.",
    });
  });

  test("후보가 하나도 없으면 그렇다고 말한다", () => {
    const noCandidates = preview({
      requires: { approvalSuccessor: true, engineerSuccessor: false, approvalSuccessorMustInspect: true },
      candidates: { approvalSuccessors: [], engineerSuccessors: [] },
    });
    assert.deepEqual(checkUserDeletionSubmit(noCandidates, form()), {
      enabled: false,
      reason: "결재를 이어받을 수 있는 사람이 없습니다.",
    });
  });

  test("필요 없는 쪽은 고르지 않아도 된다", () => {
    assert.deepEqual(checkUserDeletionSubmit(preview(), form()), { enabled: true });
  });

  test("🔴 사유가 비었거나 공백뿐이면 꺼진다 · 2000자까지", () => {
    for (const reason of ["", "   \n "]) {
      assert.deepEqual(checkUserDeletionSubmit(preview(), form({ reason })), {
        enabled: false,
        reason: "삭제 사유를 입력해 주세요.",
      });
    }
    assert.equal(checkUserDeletionSubmit(preview(), form({ reason: "가".repeat(2000) })).enabled, true);
    assert.deepEqual(checkUserDeletionSubmit(preview(), form({ reason: "가".repeat(2001) })), {
      enabled: false,
      reason: "삭제 사유는 2000자까지 적을 수 있습니다.",
    });
  });

  test("🔴 막는 사유가 있으면 다 골라도 꺼진다", () => {
    const blocked = preview({
      blockers: [
        {
          code: "IN_FLIGHT_ON_OLD_ROUTE",
          message: "막힘",
          kind: "FINAL_SHIPMENT",
          label: "D260901 최종 출하 승인",
          intakeNumber: "D260901",
          issueRequestId: null,
        },
      ],
    });
    assert.deepEqual(checkUserDeletionSubmit(blocked, form()), {
      enabled: false,
      reason: "아래 사유 때문에 지금은 삭제할 수 없습니다.",
    });
  });
});

describe("막는 사유 · 요청 · 안내", () => {
  test("🔴 옛 판 사유는 접수번호가 든 이름을 앞세운다", () => {
    const line = describeUserDeletionBlocker({
      code: "IN_FLIGHT_ON_OLD_ROUTE",
      message: "바뀌기 전 승인 절차를 따라가는 진행 중 결재에 …",
      kind: "FINAL_SHIPMENT",
      label: "D260901 최종 출하 승인",
      intakeNumber: "D260901",
      issueRequestId: null,
    });
    assert.equal(line.subject, "D260901 최종 출하 승인");
    assert.equal(line.message, "바뀌기 전 승인 절차를 따라가는 진행 중 결재에 …");
  });

  test("새 판 저장이 거절할 사람은 절차 · 단계 · 이름으로 적는다", () => {
    const line = describeUserDeletionBlocker({
      code: "ROUTE_UPDATE_REJECTED",
      message: "잠긴 계정입니다.",
      scope: "PART_ISSUE",
      stepOrder: 2,
      approverName: "최잠김",
    });
    assert.equal(line.subject, "부품 불출 절차 2번째 단계 · 최잠김 님");
  });

  test("🔴 삭제 요청의 expectedVersion 은 미리보기의 target.version — 필요 없는 쪽은 보내지 않는다", () => {
    const onlyEngineer = preview({
      requires: { approvalSuccessor: false, engineerSuccessor: true, approvalSuccessorMustInspect: false },
    });
    assert.deepEqual(
      buildUserDeletionActionInput(
        onlyEngineer,
        form({ approvalSuccessorId: APPROVER, engineerSuccessorId: ENGINEER, reason: "  퇴사  " })
      ),
      {
        targetUserId: TARGET,
        expectedVersion: 7,
        reason: "퇴사",
        approvalSuccessorUserId: null,
        engineerSuccessorUserId: ENGINEER,
      }
    );
  });

  test("다시 불러온 뒤 고른 값은 새 후보에 있을 때만 지킨다", () => {
    const candidates = [{ id: APPROVER }];
    assert.equal(retainSuccessorSelection(APPROVER, candidates), APPROVER);
    assert.equal(retainSuccessorSelection(ENGINEER, candidates), "");
    assert.equal(retainSuccessorSelection("", candidates), "");
  });

  test("성공 안내 · 포털 안내 문구", () => {
    assert.equal(userDeletionSuccessMessage("김지움"), "김지움 님의 계정을 삭제했습니다.");
    assert.equal(
      USER_DELETION_PORTAL_NOTICE,
      "이 시스템에서 목록을 치우고 일을 넘기는 것입니다. 로그인을 실제로 막으려면 통합 로그인 포털에서 권한을 회수하세요. 포털로 다시 로그인하면 계정이 되살아나지만, 대표 · 위임 · 개발자 표시 · 접수 메일 수신은 되살아나지 않습니다."
    );
  });
});
