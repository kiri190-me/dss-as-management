import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { UserDeletionDialogView, UserDeletionRowButton, type UserDeletionDialogPhase } from "./UserDeletionParts";
import {
  USER_DELETION_PORTAL_NOTICE,
  type ReadyUserDeletionPreview,
  type UserDeletionFormState,
} from "./user-deletion-dialog-text";
import type { UserDeletionPreviewImpact } from "@/lib/db/queries/user-deletion-impact";

/**
 * ============================================================================
 * 계정 삭제 — 누구에게 무엇이 그려지는가
 * ============================================================================
 * RepresentativeListSection 과 UserDeletionDialog 는 서버 액션 모듈을 부르고, 그 사슬
 * 끝에 `server-only` 가 있어 이 시험 환경에서 통째로 그릴 수 없다. 그래서 그리기만
 * 하는 조각(UserDeletionParts.tsx)을 따로 그려 보고, 화면들이 조각에 무엇을 넘기는지는
 * 원본을 읽어 확인한다(ImprovementRequestScreenshots.test.tsx 와 같은 방식).
 * ============================================================================
 */

const TARGET = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const APPROVER = "33333333-3333-4333-8333-333333333333";
const ENGINEER = "44444444-4444-4444-8444-444444444444";

const noop = () => {};

function renderButton(canDeleteUserAccounts: boolean, rowUserId: string): string {
  return renderToStaticMarkup(
    <UserDeletionRowButton
      canDeleteUserAccounts={canDeleteUserAccounts}
      actingUserId={ACTOR}
      userId={rowUserId}
      disabled={false}
      onRequestDelete={noop}
    />
  );
}

function impact(overrides: Partial<UserDeletionPreviewImpact> = {}): UserDeletionPreviewImpact {
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
    impact: impact(),
    requires: { approvalSuccessor: false, engineerSuccessor: false, approvalSuccessorMustInspect: false },
    candidates: {
      approvalSuccessors: [{ id: APPROVER, name: "이결재", role: "SUPER_ADMIN" }],
      engineerSuccessors: [{ id: ENGINEER, name: "박담당" }],
    },
    blockers: [],
    ...overrides,
  };
}

function renderView(
  phase: UserDeletionDialogPhase,
  form: Partial<UserDeletionFormState> = {},
  extra: { isSubmitting?: boolean; errorMessage?: string | null; noticeMessage?: string | null } = {}
): string {
  return renderToStaticMarkup(
    <UserDeletionDialogView
      targetName="김지움(목록)"
      phase={phase}
      form={{ approvalSuccessorId: "", engineerSuccessorId: "", reason: "퇴사", ...form }}
      isSubmitting={extra.isSubmitting ?? false}
      errorMessage={extra.errorMessage ?? null}
      noticeMessage={extra.noticeMessage ?? null}
      onApprovalSuccessorChange={noop}
      onEngineerSuccessorChange={noop}
      onReasonChange={noop}
      onConfirm={noop}
      onCancel={noop}
    />
  );
}

/** [삭제] 단추의 여는 태그. */
function confirmButtonTag(html: string): string {
  const tag = html.match(/<button[^>]*data-role="user-deletion-confirm"[^>]*>/)?.[0];
  assert.ok(tag, `[삭제] 단추가 없다: ${html}`);
  return tag;
}

function isConfirmDisabled(html: string): boolean {
  return /\sdisabled=""/.test(confirmButtonTag(html));
}

// ───────────────────────────── 목록 줄의 단추

describe("[계정 삭제] 단추", () => {
  test("🔴 권한이 없으면 그리지 않는다", () => {
    assert.equal(renderButton(false, TARGET), "");
  });

  test("🔴 자기 자신의 줄에는 그리지 않는다", () => {
    assert.equal(renderButton(true, ACTOR), "");
  });

  test("권한이 있고 다른 사람의 줄이면 위험 색 단추가 그려진다", () => {
    const html = renderButton(true, TARGET);
    assert.ok(html.includes(">계정 삭제<"), html);
    assert.ok(html.includes("text-red-700"), "위험 색이 아니다");
  });
});

// ───────────────────────────── 확인 창

describe("확인 창", () => {
  test("불러오는 동안 「불러오는 중」 — 제목은 목록의 이름, [삭제]는 꺼짐, 안내 문구", () => {
    const html = renderView({ kind: "loading" });
    assert.ok(html.includes("불러오는 중"), html);
    assert.ok(html.includes("김지움(목록) 님의 계정을 삭제합니다"), html);
    assert.ok(html.includes(USER_DELETION_PORTAL_NOTICE), "안내 문구가 없다");
    assert.equal(isConfirmDisabled(html), true);
  });

  test("🔴 미리보기 실패는 서버 문구를 창 안에 보이고 [삭제]를 끈다", () => {
    const html = renderView({ kind: "failed", message: "사용자 계정을 삭제할 권한이 없습니다." });
    assert.ok(html.includes("사용자 계정을 삭제할 권한이 없습니다."), html);
    assert.equal(isConfirmDisabled(html), true);
  });

  test("미리보기가 오면 제목에 대상 이름 · 건수 문장 · 그대로 두는 것", () => {
    const html = renderView({
      kind: "ready",
      preview: preview({
        impact: impact({ openAssignedCases: 4, untouchedAssignedCases: 1, activeDelegations: { asRepresentative: 0, asDelegate: 0 } }),
        requires: { approvalSuccessor: false, engineerSuccessor: true, approvalSuccessorMustInspect: false },
      }),
    }, { engineerSuccessorId: ENGINEER });
    assert.ok(html.includes("김지움 님의 계정을 삭제합니다"), html);
    assert.ok(html.includes("담당 이어받을 사람에게 담당 중인 접수 건 4건을 넘깁니다."), html);
    assert.ok(html.includes("휴지통에 있거나 출하 완료로 잠긴 담당 접수 건 1건은 그대로 둡니다."), html);
    // 0 인 항목은 빠진다.
    assert.ok(!html.includes("위임 0건"), html);
    assert.ok(!html.includes("철회합니다"), html);
    assert.ok(html.includes(USER_DELETION_PORTAL_NOTICE), "안내 문구가 없다");
    assert.equal(isConfirmDisabled(html), false);
  });

  test("넘길 것이 없으면 그렇다고 말한다", () => {
    const html = renderView({ kind: "ready", preview: preview() });
    assert.ok(html.includes("넘기거나 바꿀 일이 없습니다."), html);
  });

  test("🔴 필요한 드롭다운만 그린다", () => {
    const onlyEngineer = renderView({
      kind: "ready",
      preview: preview({ requires: { approvalSuccessor: false, engineerSuccessor: true, approvalSuccessorMustInspect: false } }),
    });
    assert.ok(onlyEngineer.includes('id="user-deletion-engineer-successor"'), onlyEngineer);
    assert.ok(onlyEngineer.includes(">담당 이어받을 사람<"), onlyEngineer);
    assert.ok(!onlyEngineer.includes('id="user-deletion-approval-successor"'), "필요 없는 결재 드롭다운이 있다");

    const onlyApproval = renderView({
      kind: "ready",
      preview: preview({ requires: { approvalSuccessor: true, engineerSuccessor: false, approvalSuccessorMustInspect: false } }),
    });
    assert.ok(onlyApproval.includes('id="user-deletion-approval-successor"'), onlyApproval);
    assert.ok(onlyApproval.includes(">결재 이어받을 사람<"), onlyApproval);
    assert.ok(!onlyApproval.includes('id="user-deletion-engineer-successor"'), "필요 없는 담당 드롭다운이 있다");
    // 후보는 서버가 준 목록 그대로 — 역할 이름표를 곁들인다.
    assert.ok(onlyApproval.includes(`value="${APPROVER}"`), onlyApproval);
    assert.ok(onlyApproval.includes("이결재 ("), onlyApproval);

    const neither = renderView({ kind: "ready", preview: preview() });
    assert.ok(!neither.includes("<select"), "필요 없는데 드롭다운이 있다");
  });

  test("🔴 이어받을 사람을 고르지 않았으면 [삭제]가 꺼진다", () => {
    const needsBoth = preview({
      requires: { approvalSuccessor: true, engineerSuccessor: true, approvalSuccessorMustInspect: false },
    });
    assert.equal(isConfirmDisabled(renderView({ kind: "ready", preview: needsBoth }, { engineerSuccessorId: ENGINEER })), true);
    assert.equal(isConfirmDisabled(renderView({ kind: "ready", preview: needsBoth }, { approvalSuccessorId: APPROVER })), true);
    assert.equal(
      isConfirmDisabled(
        renderView({ kind: "ready", preview: needsBoth }, { approvalSuccessorId: APPROVER, engineerSuccessorId: ENGINEER })
      ),
      false
    );
  });

  test("🔴 사유가 비면 [삭제]가 꺼진다 — 글자 수가 보인다", () => {
    const empty = renderView({ kind: "ready", preview: preview() }, { reason: "" });
    assert.equal(isConfirmDisabled(empty), true);
    assert.ok(empty.includes("0 / 2000"), empty);
    assert.ok(empty.includes('maxLength="2000"') || empty.includes('maxlength="2000"'), "사유 칸에 상한이 없다");
    assert.equal(isConfirmDisabled(renderView({ kind: "ready", preview: preview() }, { reason: "   " })), true);
    const filled = renderView({ kind: "ready", preview: preview() }, { reason: "퇴사" });
    assert.ok(filled.includes("2 / 2000"), filled);
  });

  test("🔴 막는 사유가 있으면 접수번호와 사유를 목록으로 보이고 [삭제]를 끈다", () => {
    const html = renderView({
      kind: "ready",
      preview: preview({
        blockers: [
          {
            code: "IN_FLIGHT_ON_OLD_ROUTE",
            message: "바뀌기 전 승인 절차를 따라가는 진행 중 결재에 김지움 님의 단계가 아직 남아 있어 삭제할 수 없습니다.",
            kind: "FINAL_SHIPMENT",
            label: "D260901 최종 출하 승인",
            intakeNumber: "D260901",
            issueRequestId: null,
          },
          {
            code: "ROUTE_UPDATE_REJECTED",
            message: "잠긴 계정입니다.",
            scope: "FINAL_SHIPMENT",
            stepOrder: 2,
            approverName: "최잠김",
          },
        ],
      }),
    });
    assert.ok(html.includes("지금은 삭제할 수 없습니다."), html);
    assert.ok(html.includes("D260901 최종 출하 승인"), "접수번호가 보이지 않는다");
    assert.ok(html.includes("김지움 님의 단계가 아직 남아 있어"), "사유가 보이지 않는다");
    assert.ok(html.includes("최종 출하 승인 절차 2번째 단계 · 최잠김 님"), html);
    assert.equal((html.match(/<li>/g) ?? []).length >= 2, true, "막는 사유가 목록이 아니다");
    assert.equal(isConfirmDisabled(html), true);
  });

  test("보내는 동안 단추를 끈다 · 실패 문구 · 다시 불러온 안내", () => {
    const html = renderView(
      { kind: "ready", preview: preview() },
      {},
      { isSubmitting: true, errorMessage: "결재 이어받을 사람을 찾을 수 없습니다.", noticeMessage: "그 사이 바뀐 것이 있어 다시 불러왔습니다." }
    );
    assert.ok(html.includes("삭제하는 중..."), html);
    assert.equal(isConfirmDisabled(html), true);
    assert.ok(/<button type="button" disabled="">취소<\/button>|<button[^>]*disabled=""[^>]*>취소<\/button>/.test(html), "[취소]가 켜져 있다");
    assert.ok(html.includes("결재 이어받을 사람을 찾을 수 없습니다."), html);
    assert.ok(html.includes("그 사이 바뀐 것이 있어 다시 불러왔습니다."), html);
  });

  test("🔴 이메일을 싣지 않는다", () => {
    const html = renderView({
      kind: "ready",
      preview: preview({ requires: { approvalSuccessor: true, engineerSuccessor: true, approvalSuccessorMustInspect: false } }),
    });
    assert.ok(!html.includes("@"), "확인 창에 이메일처럼 보이는 값이 있다");
  });
});

// ───────────────────────────── 화면이 조각에 무엇을 넘기는가 (원본)

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("연결 — 원본", () => {
  const list = read("src/components/users/RepresentativeListSection.tsx");
  const screen = read("src/components/users/RepresentativeManagementScreen.tsx");
  const page = read("src/app/(app)/users/page.tsx");
  const dialog = read("src/components/users/UserDeletionDialog.tsx");
  const parts = read("src/components/users/UserDeletionParts.tsx");
  const text = read("src/components/users/user-deletion-dialog-text.ts");

  test("🔴 페이지가 같은 판정 함수로 계산해 새 prop 으로 넘긴다", () => {
    assert.ok(/const canDeleteUserAccounts = mayManageDeveloperFlag\(actingUser\)/.test(page), "판정 함수로 계산하지 않는다");
    assert.ok(/canDeleteUserAccounts=\{canDeleteUserAccounts\}/.test(page), "화면에 넘기지 않는다");
  });

  test("🔴 화면은 받은 값을 필수 prop 으로 받아 목록에 넘기기만 한다 — 행위자 id 도", () => {
    assert.ok(/canDeleteUserAccounts:\s*boolean/.test(screen), "필수 prop 이 아니다");
    assert.ok(!/canDeleteUserAccounts\?:/.test(screen), "선택 prop 이다");
    assert.ok(/canDeleteUserAccounts=\{canDeleteUserAccounts\}/.test(screen), "목록에 넘기지 않는다");
    assert.ok(/actingUserId=\{actingUser\.id\}/.test(screen), "행위자 id 를 넘기지 않는다");
  });

  test("🔴 목록은 renderActions 한 곳에서 단추를 그린다 — 대표 지정 값을 쓰지 않는다", () => {
    assert.ok(/canDeleteUserAccounts:\s*boolean/.test(list), "목록의 prop 이 필수가 아니다");
    assert.ok(/actingUserId:\s*string/.test(list), "목록이 행위자 id 를 받지 않는다");
    const start = list.indexOf("function renderActions(");
    const end = list.indexOf("\n  return (", start);
    assert.ok(start >= 0 && end > start, "renderActions 를 찾지 못했다");
    const renderActions = list.slice(start, end);
    const button = renderActions.match(/<UserDeletionRowButton[\s\S]*?\/>/)?.[0];
    assert.ok(button, "renderActions 에 [계정 삭제]가 없다");
    assert.ok(/canDeleteUserAccounts=\{canDeleteUserAccounts\}/.test(button), button);
    assert.ok(/actingUserId=\{actingUserId\}/.test(button), button);
    assert.ok(!/canManageRepresentatives/.test(button), "삭제 단추가 대표 지정 값으로 여닫힌다");
    // 표와 카드가 같은 renderActions 를 쓴다.
    assert.equal((list.match(/renderActions\(user\)/g) ?? []).length, 2, "표와 카드가 같은 단추를 쓰지 않는다");
    // 성공 뒤 안내하고 다시 읽는다.
    assert.ok(/setMessage\(userDeletionSuccessMessage\(deletedName\)\)/.test(list), list);
    assert.ok(/onDeleted=\{[\s\S]*?router\.refresh\(\)/.test(list), "성공 뒤 router.refresh() 를 부르지 않는다");
  });

  test("🔴 확인 창이 미리보기 · 삭제 액션을 부르고 CONFLICT 에서 다시 불러온다", () => {
    assert.ok(/getUserDeletionPreviewAction\(\{ targetUserId \}\)/.test(dialog), "미리보기를 부르지 않는다");
    assert.ok(/deleteUserAccountAction\(buildUserDeletionActionInput\(preview, form\)\)/.test(dialog), "삭제를 부르지 않는다");
    const conflict = dialog.slice(dialog.indexOf('result.code === "CONFLICT"'));
    assert.ok(/setNoticeMessage\(USER_DELETION_CONFLICT_NOTICE\)/.test(conflict), "다시 불러왔다는 안내가 없다");
    assert.ok(/setLoadKey\(/.test(conflict), "미리보기를 다시 부르지 않는다");
    assert.ok(/setErrorMessage\(result\.message\)/.test(dialog), "그 밖의 실패에 서버 문구를 보이지 않는다");
  });

  test("🔴 새 파일은 console 에 싣지 않고 · 이메일을 다루지 않고 · 스스로 판정하지 않는다", () => {
    for (const [label, source] of [["확인 창", dialog], ["조각", parts], ["문장", text]] as const) {
      const code = withoutComments(source);
      assert.ok(!/\bconsole\./.test(code), `${label}: console 을 쓴다`);
      assert.ok(!/\bemail\b/i.test(code), `${label}: 이메일을 다룬다`);
      assert.ok(!/\bactorMay\(|\bhasPermission\(|\bmayManageDeveloperFlag\(|role === "SUPER_ADMIN"/.test(code), `${label}: 판정을 스스로 한다`);
    }
  });
});
