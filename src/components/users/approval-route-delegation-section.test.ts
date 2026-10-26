import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES,
  deriveApprovalRouteDelegationDisplayStatus,
  type ApprovalRouteDelegationDisplayStatus,
} from "@/lib/domain/approval-route-delegation";
import {
  APPROVAL_ROUTE_DELEGATION_STATUS_LABELS,
  APPROVAL_ROUTE_DELEGATION_STATUS_TONE,
  approvalRouteDelegationCreatorLabel,
  mayRevokeApprovalRouteDelegation,
} from "./approval-route-delegation-view";
// 🔵 탭 노출 전체(처음 탭 · 조합별 목록)는 users-area-gate.test.ts 가 본다. 여기서
//    쓰는 것은 「어느 조합에서도 결재권 위임 탭은 빠지지 않는다」 하나뿐이다.
import { visibleUsersTabKeys } from "./users-tab-access";

/**
 * ============================================================================
 * 「결재권 위임」 탭 — 다섯째 탭과 그 안의 묶음 셋
 * ============================================================================
 * 표·판정·통로는 앞 조각에서 이미 섰고(표 0119 · actions · queries · mutations),
 * 그쪽은 제 시험이 실제 DB 로 지킨다. 여기서 지키는 것은 **화면이 그 통로를
 * 올바로 부르는가**뿐이다:
 *
 *   ㉠ 탭이 **조건 없이 늘 보인다**. 누구나 자기 결재권은 맡길 수 있다.
 *   ㉡ 「누구의 결재권인가」 고르개만 권한으로 갈린다 — 권한이 없으면 고르개를
 *      **아예 그리지 않고** 본인으로 고정한다.
 *   ㉢ 상태 딱지 넷이 다 나오고, 되돌린 줄·끝난 줄에는 [되돌리기]가 안 붙는다.
 *   ㉣ 「내가 대신하고 있는 것」에는 [되돌리기]가 **없다** — 대리인은 제가 맡은
 *      위임을 거둘 수 없어서, 그려 두면 눌러도 거절당하는 단추가 된다.
 *   ㉤ 옛 「출하 승인 위임」과 **설명 문구가 서로 다르다**. 둘이 한 화면 안에 탭으로
 *      나란히 있고 하는 일이 갈리므로, 차이가 글자로 적혀 있지 않으면 쓰는 사람은
 *      어느 쪽을 써야 할지 알 수 없다(결재선을 켜면 옛 위임은 판정에서 통째로
 *      건너뛰어진다 — 그 자리가 이 조각의 출발점이었다).
 *   ㉥ 서버 페이지가 **보는 사람의 것만** 읽어 내려보낸다.
 *   ㉦ 세 번째 묶음 「모두의 결재권 위임」(2026-10-26, 같은 날 뒤에 들어왔다) —
 *      🔴 **인가가 조회 함수 안에 있다**(화면·페이지가 아니다) · 권한이 없으면 자료가
 *      아예 안 내려오고 묶음도 없다 · **누가 만들었나**가 보인다 · 관리자가 남의
 *      위임을 되돌릴 수 있다 · 끝난 줄은 접혀 있고 상한에 잘린 것을 말해 준다.
 *
 * 🔵 ㉦ 의 「서버에서 막힌다」가 **실제로 막히는지**는 원본 글자로 잴 수 없다 —
 * 그 단언은 실제 DB 로 도는
 * `db/mutations/approval-route-delegations.integration.test.ts` 가 가진다(권한 없는
 * 사람이 부르면 `ok: false`, 관리 권한자가 부르면 남의 줄까지). 여기서는 **그 판정이
 * 조회 안에 있고 읽기보다 앞선다**는 구조만 지킨다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * `ApprovalRouteDelegationSection` 은 **서버 액션을 직접 가져오는 클라이언트
 * 컴포넌트**라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는
 * `test:components` 에서는 import 자체가 던진다(옆의 승인 절차 탭이 같은 이유로
 * 같은 방법을 쓴다 — approval-route-section.test.ts 머리말).
 *
 * 🔵 그래서 **값으로 재야 하는 것**은 화면에서 떼어 둔 모듈
 * (approval-route-delegation-view.ts)로 실제로 돌려 본다. 원본을 글자로만 읽으면
 * 「Record 가 거기 적혀 있다」까지만 알고, 그 안에 딱지가 넷 다 들어 있는지도
 * 그 값이 실제로 쓰이는지도 모른다.
 * ============================================================================
 */

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

/**
 * 주석은 경위를 적는 자리다 — 지키는 것은 **코드**뿐이다. 이 파일의 단언 여럿이
 * 「…가 없다」 꼴이라, 주석에 적힌 낱말이 섞이면 멀쩡한 코드가 걸린다.
 *
 * 🔴 앞이 `:` 인 `//` 는 건드리지 않는다(`http://…`). 지금 이 화면에 주소는 없지만,
 * 이웃 시험이 그 규칙을 빠뜨렸다가 단언이 조용히 무력해진 적이 있어 같은 모양을 쓴다
 * (notification-settings-moved-notice.test.ts 의 같은 자리).
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/** 원본에서 **한 토막만** 잘라낸다 — 파일 전체에 정규식을 걸면 이웃 토막에 걸린다. */
function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
}

const SECTION = "src/components/users/ApprovalRouteDelegationSection.tsx";
const SCREEN = "src/components/users/RepresentativeManagementScreen.tsx";
const PAGE = "src/app/(app)/users/page.tsx";
const OLD_SECTION = "src/components/users/DelegationSection.tsx";
const QUERIES = "src/lib/db/queries/approval-route-delegations.ts";

const sectionCode = withoutComments(read(SECTION));
const screenCode = withoutComments(read(SCREEN));
const pageCode = withoutComments(read(PAGE));
const oldSectionCode = withoutComments(read(OLD_SECTION));
const queriesCode = withoutComments(read(QUERIES));

/* ------------------------------------------------------------------ */
/* ㉠ 탭 — 조건 없이 늘 보인다                                          */
/* ------------------------------------------------------------------ */

/**
 * 탭 줄 하나를 통째로 잘라낸다. 이 `div` 안에는 `<button>` 만 들어 있어
 * (여닫는 탭도 `{조건 && (<button …>)}` 꼴이다) 첫 `</div>` 가 곧 줄의 끝이다.
 */
const tabBar = sliceBetween(screenCode, '<div className="flex gap-1 overflow-x-auto', "</div>");

/**
 * 탭 줄 안에서 이 자리가 **몇 겹의 조건 안에** 들어 있는가.
 *
 * 🔴 2026-10-26 에 「출하 대표자 / 위임」·「승인 절차」가 조건을 갖게 되면서, 「이
 * 단추 앞에 `&& (` 가 하나도 없다」로 재던 옛 잣대가 못 쓰게 됐다 — 앞선 조건들이
 * **닫힌** 것까지 세어 버리기 때문이다. 여는 것과 닫는 것(`)}`)을 함께 세면 지금
 * 자리의 겹 수가 나온다: 0 이면 어떤 조건에도 안 감싸여 있다.
 */
function guardDepthAt(tabKey: string): number {
  // 🔴 단추를 다는 줄 자체가 `onClick={() => setActiveTab("x")}` 라 **`)}` 로
  //    끝난다.** 그대로 세면 단추마다 닫는 괄호가 하나씩 가짜로 늘어 겹 수가
  //    0 으로 눌리고, 그러면 이 잣대는 무엇을 넣어도 「조건이 없다」고 답한다.
  //    그래서 그 줄들을 먼저 표시로 바꿔 괄호를 치운다.
  const marked = tabBar.replace(
    /onClick=\{\(\) => setActiveTab\("(\w+)"\)\}/g,
    (_match, key: string) => `@@TAB:${key}@@`
  );
  const at = marked.indexOf(`@@TAB:${tabKey}@@`);
  assert.ok(at > 0, `탭 줄에서 '${tabKey}' 단추를 찾지 못했다`);
  const head = marked.slice(0, at);
  return (head.match(/&& \(/g)?.length ?? 0) - (head.match(/\)\}/g)?.length ?? 0);
}

describe("㉠ 「결재권 위임」 탭", () => {
  test("탭 단추가 있고 이름과 키가 정해진 그대로다", () => {
    assert.ok(
      tabBar.includes('setActiveTab("routeDelegation")'),
      "탭 줄에 결재권 위임 단추가 없다"
    );
    const button = sliceBetween(tabBar, 'onClick={() => setActiveTab("routeDelegation")}', "</button>");
    assert.match(flat(button), /> 결재권 위임 $/, "탭 이름이 「결재권 위임」이 아니다");
  });

  test("🔴 이 시험의 탐지기가 실제로 문다 — 조건부 탭은 걸린다", () => {
    // 아래 단언은 「그 자리의 조건 겹 수가 0 이다」로 「늘 보인다」를 잰다. 그
    // 잣대가 조건부 탭을 정말 집어내는지 **같은 줄의 다른 탭들로** 먼저 확인한다 —
    // 안 그러면 잣대가 망가졌을 때 아래가 공짜로 통과한다.
    for (const guarded of ["representatives", "approvalRoute", "permissions", "developer"]) {
      assert.equal(
        guardDepthAt(guarded),
        1,
        `${guarded} 탭이 조건 안에 있지 않다 — 잣대가 더 이상 맞지 않는다`
      );
    }
  });

  test("🔴 조건으로 감싸지 않는다 — 누구나 자기 결재권은 맡길 수 있다", () => {
    assert.equal(
      guardDepthAt("routeDelegation"),
      0,
      "결재권 위임 탭이 조건 안에 들어갔다 — 자리를 비우는 사람이 관리자에게 부탁해야만 하게 된다"
    );
    // 값으로도 본다: 어떤 조합에서도 이 탭은 빠지지 않는다.
    for (const canViewUsersAdminTabs of [false, true]) {
      for (const hasRolePermissions of [false, true]) {
        for (const canManageDeveloperFlag of [false, true]) {
          const visible = visibleUsersTabKeys({
            canViewUsersAdminTabs,
            hasRolePermissions,
            canManageDeveloperFlag,
          });
          assert.ok(
            visible.includes("routeDelegation"),
            `결재권 위임 탭이 빠지는 조합이 있다: ${JSON.stringify({ canViewUsersAdminTabs, hasRolePermissions, canManageDeveloperFlag })}`
          );
        }
      }
    }
  });

  test("🔴 탭 안쪽은 **마지막 갈래**다 — 조건이 하나도 안 붙는다", () => {
    // 2026-10-26: 그 전에는 「출하 대표자 / 위임」이 마지막 갈래였는데, 그러면
    // 관리 탭이 없는 사람이 그 갈래에 닿는 순간 **읽지도 않은 자료로** 대표 목록을
    // 그린다. 모두가 가진 탭을 바닥에 두면 그런 자리가 생길 수 없다.
    // 🔴 탭 줄 **뒤**만 본다. 단추의 밑줄 색을 고르는 삼항
    // (`activeTab === "routeDelegation" ? … : …`)은 갈래가 아니라 생김새라,
    // 줄 안까지 세면 「조건이 붙었다」로 잘못 걸린다.
    const contentArea = flat(screenCode.slice(screenCode.indexOf(tabBar) + tabBar.length));
    assert.match(
      contentArea,
      /\) : \( <ApprovalRouteDelegationSection/,
      "결재권 위임 묶음이 마지막 갈래가 아니다"
    );
    assert.ok(
      !/activeTab === "routeDelegation"/.test(contentArea),
      "결재권 위임에 조건이 다시 붙었다 — 아무 갈래에도 안 맞을 때 그릴 것이 없어진다"
    );
    // 관리 탭 둘은 **권한을 함께** 본다. 탭 단추만 가리고 내용을 열어 두면,
    // 상태만 바뀌어도 읽지 않은 자료로 그 화면이 그려진다.
    for (const adminTab of ["approvalRoute", "representatives"]) {
      assert.ok(
        contentArea.includes(`canViewUsersAdminTabs && activeTab === "${adminTab}"`),
        `${adminTab} 갈래가 권한을 안 본다`
      );
    }
    // 받은 값을 그대로 넘긴다. 권한 판정은 서버 쪽이 하고 화면은 나르기만 한다.
    assert.match(
      flat(screenCode),
      /<ApprovalRouteDelegationSection actingUser=\{actingUser\} canManageRepresentatives=\{canManageRepresentatives\} allUsers=\{delegateCandidates\} routeDelegations=\{routeDelegations\} allRouteDelegations=\{allRouteDelegations\} \/>/,
      "새 묶음에 넘기는 값이 달라졌다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉡ 새 위임 만들기 — 고르개만 권한으로 갈린다                          */
/* ------------------------------------------------------------------ */

const whoseField = sliceBetween(sectionCode, "누구의 결재권", "</label>");
const [pickerBranch, fixedBranch] = (() => {
  const at = whoseField.indexOf(") : (");
  assert.ok(at > 0, "「누구의 결재권」 칸이 두 갈래로 갈려 있지 않다");
  return [whoseField.slice(0, at), whoseField.slice(at)] as const;
})();

describe("㉡ 「누구의 결재권인가」", () => {
  test("관리 권한이 있으면 사람 고르개가 뜬다", () => {
    assert.match(
      flat(whoseField),
      /\{canManageRepresentatives \? \( <select/,
      "권한으로 가르는 자리가 사라졌다"
    );
    assert.ok(pickerBranch.includes("allUsers.map("), "고르개가 사람 목록을 돌지 않는다");
  });

  test("🔴 관리 권한이 없으면 고르개가 아예 없고 본인으로 고정된다", () => {
    assert.ok(
      !fixedBranch.includes("<select"),
      "권한 없는 쪽에도 고르개가 있다 — 잠긴 고르개는 남의 이름을 HTML 에 실어 보낸다"
    );
    assert.match(flat(fixedBranch), /\{actingUser\.name\} \(본인\)/, "본인 이름을 보여 주지 않는다");
    // 상태의 첫 값도 본인이다 — 권한이 있어도 남의 이름이 먼저 떠 있으면 그대로
    // 저장해 엉뚱한 사람의 결재권이 넘어간다.
    assert.match(
      flat(sectionCode),
      /useState\(actingUser\.id\)/,
      "처음 고른 결재권자가 본인이 아니다"
    );
  });

  test("🔴 만드는 칸 자체는 권한으로 여닫지 않는다 — 본인 위임은 늘 열려 있다", () => {
    assert.ok(
      !/canAssign/.test(sectionCode),
      "옛 화면의 canAssign 울타리를 베껴 왔다 — 본인 위임까지 막힌다"
    );
    assert.ok(
      !/\{canManageRepresentatives && \(/.test(sectionCode),
      "입력칸 전체가 권한 뒤로 숨었다"
    );
    // 권한으로 갈리는 자리는 고르개 **하나**다.
    assert.equal(
      [...sectionCode.matchAll(/canManageRepresentatives/g)].length,
      3,
      "권한 값을 쓰는 자리 수가 달라졌다(프롭 선언 · 인자 · 고르개 갈래)"
    );
  });

  test("🔴 자기 자신을 대리인으로 세우는 것을 화면도 막지 않는다 (2026-10-26 결정)", () => {
    // 거르는 조건은 표의 CHECK 와 같은 하나뿐이다. 보는 사람 자신을 빼면 관리자가
    // 남의 결재권을 자기에게 맡기는 길이 화면에서만 사라지고, 서버는 허용하므로
    // 「왜 안 되지」의 까닭이 어디에도 안 남는다.
    assert.match(
      flat(sectionCode),
      /const delegateOptions = allUsers\.filter\(\(user\) => user\.id !== delegatorUserId\);/,
      "대리 결재자 후보를 거르는 조건이 달라졌다"
    );
    assert.ok(
      !/user\.id !== actingUser\.id/.test(sectionCode),
      "보는 사람 자신을 후보에서 뺐다 — 2026-10-26 결정과 어긋난다"
    );
  });

  test("날짜·시각 칸의 모양이 옛 위임과 같다", () => {
    assert.equal(
      [...sectionCode.matchAll(/type="datetime-local"/g)].length,
      2,
      "시작·종료가 datetime-local 둘이 아니다"
    );
    assert.equal([...oldSectionCode.matchAll(/type="datetime-local"/g)].length, 2);
  });

  test("🔴 성공만 저장 팝업으로, 거절 사유는 화면에 남는다", () => {
    // 저장 팝업은 0.5초 뒤 저절로 닫힌다(common/SavePopup.tsx). 읽어야 하는 글을
    // 거기 실으면 못 읽고 지나간다.
    assert.equal([...sectionCode.matchAll(/showSavePopup\(/g)].length, 1, "저장 팝업을 쓰는 자리가 하나가 아니다");
    assert.match(
      flat(sectionCode),
      /if \(!result\.ok\) \{ setFormMessage\(result\.message\); return; \} setDelegateUserId\(""\);/,
      "거절 사유를 화면에 남기지 않거나, 거절한 뒤에도 입력칸을 비운다"
    );
    assert.match(
      flat(sectionCode),
      /if \(!result\.ok\) \{ setListMessage\(result\.message\); return; \}/,
      "되돌리기 거절 사유를 화면에 남기지 않는다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉢ 상태 딱지 넷 · [되돌리기]가 붙는 줄                                */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-10-26T12:00:00.000Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

const STATUS_SAMPLES: ReadonlyArray<
  [ApprovalRouteDelegationDisplayStatus, { startsAt: Date; endsAt: Date; revokedAt: Date | null }]
> = [
  ["ACTIVE", { startsAt: hours(-1), endsAt: hours(1), revokedAt: null }],
  ["SCHEDULED", { startsAt: hours(1), endsAt: hours(2), revokedAt: null }],
  ["EXPIRED", { startsAt: hours(-2), endsAt: hours(-1), revokedAt: null }],
  ["REVOKED", { startsAt: hours(-1), endsAt: hours(1), revokedAt: hours(-0.5) }],
];

describe("㉢ 상태 딱지 네 갈래", () => {
  test("🔴 재려는 것이 비어 있지 않다 — 표본이 네 상태를 전부 만든다", () => {
    assert.equal(STATUS_SAMPLES.length, 4);
    assert.equal(APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES.length, 4);
    assert.deepEqual(
      STATUS_SAMPLES.map(([status]) => status),
      [...APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES],
      "도메인이 아는 상태와 이 시험의 표본이 어긋났다"
    );
  });

  test("네 표본이 실제로 네 딱지로 풀린다 — 글자도 서로 다르다", () => {
    const labels: string[] = [];
    for (const [expected, row] of STATUS_SAMPLES) {
      assert.equal(
        deriveApprovalRouteDelegationDisplayStatus(row, NOW),
        expected,
        `${expected}: 표본이 다른 상태로 풀린다`
      );
      const label = APPROVAL_ROUTE_DELEGATION_STATUS_LABELS[expected];
      assert.ok(label.trim().length > 0, `${expected}: 딱지 글자가 비었다`);
      labels.push(label);
    }
    assert.equal(new Set(labels).size, 4, "두 상태가 같은 글자로 보인다");
  });

  test("🔴 딱지 낱말이 옛 위임 화면과 한 글자도 다르지 않다", () => {
    // 같은 것을 두 탭이 다른 말로 부르면 쓰는 사람은 서로 다른 것을 재고 있다고
    // 읽는다. 옛 화면은 이번에 손대지 않기로 한 범위라 Record 를 합치지 않고,
    // 대신 두 파일의 글자를 여기서 맞댄다.
    const oldLabels = sliceBetween(oldSectionCode, "const STATUS_LABELS", "};");
    for (const status of APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES) {
      const label = APPROVAL_ROUTE_DELEGATION_STATUS_LABELS[status];
      assert.match(
        oldLabels,
        new RegExp(`${status}: "${label}"`),
        `${status}: 옛 화면의 딱지(${label})와 갈렸다`
      );
    }
  });

  test("색에 다크 모드 짝이 빠지지 않았다 — 이 저장소는 둘 다 쓴다", () => {
    for (const status of APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES) {
      const tone = APPROVAL_ROUTE_DELEGATION_STATUS_TONE[status];
      assert.ok(tone.includes("dark:bg-"), `${status}: 다크 모드 배경이 없다`);
      assert.ok(tone.includes("dark:text-"), `${status}: 다크 모드 글자색이 없다`);
    }
  });
});

describe("㉢ [되돌리기]가 붙는 줄", () => {
  test("🔴 되돌린 것·끝난 것에는 안 붙는다", () => {
    assert.equal(mayRevokeApprovalRouteDelegation("REVOKED"), false);
    assert.equal(mayRevokeApprovalRouteDelegation("EXPIRED"), false);
  });

  test("살아 있는 것·아직 시작 안 한 것에는 붙는다", () => {
    assert.equal(mayRevokeApprovalRouteDelegation("ACTIVE"), true);
    assert.equal(mayRevokeApprovalRouteDelegation("SCHEDULED"), true);
  });

  test("🔴 화면이 그 판정을 제 손으로 다시 적지 않는다", () => {
    assert.match(
      flat(sectionCode),
      /if \(!mayRevokeApprovalRouteDelegation\(displayStatus\)\) \{/,
      "단추를 가리는 자리가 떼어 둔 판정을 쓰지 않는다"
    );
    assert.ok(
      !/displayStatus === "(ACTIVE|SCHEDULED|EXPIRED|REVOKED)"/.test(sectionCode),
      "화면이 상태를 직접 비교한다 — 판정이 두 벌이 되면 한쪽만 고쳐지는 날이 온다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉣ 묶음 둘 — 맡긴 것에만 단추가 있다                                  */
/* ------------------------------------------------------------------ */

/**
 * 묶음 셋을 머리글로 잘라 나눈다.
 *
 * 🔴 마지막 묶음이 들어오면서 `receivedBlock` 을 「두 번째 머리글부터 **끝까지**」로
 * 두던 방식이 깨졌다 — 아래 「모두의」 묶음의 [되돌리기]가 그 조각에 딸려 들어와
 * 「대신하고 있는 것은 읽기 전용이다」가 거짓으로 걸렸다. 조각은 **다음 머리글까지**로
 * 끊는다. 묶음이 또 늘면 여기도 함께 끊어야 한다.
 */
const givenBlock = sliceBetween(sectionCode, "내가 맡긴 것", "내가 대신하고 있는 것");
const receivedBlock = sliceBetween(sectionCode, "내가 대신하고 있는 것", "모두의 결재권 위임");
const allBlock = sectionCode.slice(sectionCode.indexOf("모두의 결재권 위임"));

describe("㉣ 「내가 맡긴 것」 · 「내가 대신하고 있는 것」", () => {
  test("두 묶음이 각자의 목록을 그린다", () => {
    assert.ok(givenBlock.includes("routeDelegations.given"), "맡긴 것 묶음이 given 을 안 쓴다");
    assert.ok(!givenBlock.includes("routeDelegations.received"), "맡긴 것 묶음에 받은 목록이 섞였다");
    assert.ok(receivedBlock.includes("routeDelegations.received"), "대신하는 것 묶음이 received 를 안 쓴다");
    assert.ok(!receivedBlock.includes("routeDelegations.given"), "대신하는 것 묶음에 맡긴 목록이 섞였다");
  });

  test("맡긴 것에는 표·카드 둘 다 [되돌리기]가 붙는다", () => {
    // 한쪽에만 붙으면 좁은 폭에서만 단추가 사라지고, 그 상태는 넓은 창에서
    // 들여다봐서는 보이지 않는다.
    assert.equal(
      [...givenBlock.matchAll(/renderRevokeAction\(delegation\)/g)].length,
      2,
      "표와 카드 가운데 한쪽에만 되돌리기가 붙었다"
    );
    // 단추 글자는 두 자리가 함께 쓰는 renderRevokeAction 안에 있다(묶음 바깥).
    assert.match(
      flat(sectionCode),
      /\{revokingId === delegation\.id \? "처리 중\.\.\." : "되돌리기"\}/,
      "단추 글자가 없다"
    );
  });

  test("🔴 대신하고 있는 것은 읽기 전용이다 — 눌러도 거절당하는 단추를 그리지 않는다", () => {
    for (const forbidden of ["renderRevokeAction", "handleRevoke", "되돌리기", "actions="]) {
      assert.ok(
        !receivedBlock.includes(forbidden),
        `「내가 대신하고 있는 것」에 ${forbidden} 가 들어갔다 — 대리인은 제가 맡은 위임을 거둘 수 없다`
      );
    }
    // 왜 못 거두는지는 화면이 말해 준다. 단추가 없는 까닭을 적어 두지 않으면
    // 사람은 빠진 것으로 읽는다.
    assert.match(flat(receivedBlock), /맡은 위임은 스스로 되돌릴 수 없습니다/);
  });

  test("목록 열쇠가 서로 다르다 — 같으면 한쪽 보기 설정이 다른 쪽을 덮는다", () => {
    assert.ok(sectionCode.includes('listId="approval-route-delegations-given"'));
    assert.ok(sectionCode.includes('listId="approval-route-delegations-received"'));
  });
});

/* ------------------------------------------------------------------ */
/* ㉤ 옛 위임과 가르는 안내 두 줄                                        */
/* ------------------------------------------------------------------ */

/** 묶음 제목 바로 아래, 입력칸(`<form`) 앞에 적힌 안내 문단들. */
function noticesUnderHeading(code: string, heading: string): string[] {
  const start = code.indexOf(`>${heading}</h2>`);
  assert.ok(start >= 0, `'${heading}' 제목을 찾지 못했다`);
  const rest = code.slice(start);
  const stop = rest.indexOf("<form");
  assert.ok(stop > 0, `'${heading}' 묶음에서 입력칸을 찾지 못했다`);
  return [...rest.slice(0, stop).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(([, text]) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0);
}

const newNotices = noticesUnderHeading(sectionCode, "결재권 위임");
const oldNotices = noticesUnderHeading(oldSectionCode, "출하 승인 위임");

describe("㉤ 두 위임을 가르는 안내", () => {
  test("🔴 둘 다 실제로 글자가 있다 — 비어 있으면 아래 「서로 다르다」가 공짜로 통과한다", () => {
    assert.ok(newNotices.length >= 1, "새 탭에 안내가 한 줄도 없다");
    assert.ok(oldNotices.length >= 2, "옛 탭에 가르는 한 줄이 더해지지 않았다");
    for (const text of [...newNotices, ...oldNotices]) {
      assert.ok(text.length > 10, `안내가 너무 짧다: ${text}`);
    }
  });

  test("새 탭은 결재선 단계를 맡긴다고 말한다", () => {
    assert.equal(
      newNotices[0],
      "승인 절차(결재선)를 쓰는 결재에서, 내 단계를 다른 사람이 대신 처리하도록 맡깁니다."
    );
  });

  test("🔴 옛 탭은 「절차를 아직 짜지 않았을 때」라고 말하고 새 탭을 가리킨다", () => {
    const joined = oldNotices.join(" ");
    assert.match(joined, /승인 절차\(결재선\)를 아직 짜지 않았을 때/);
    assert.match(joined, /「결재권 위임」 탭/);
  });

  test("🔴 두 안내가 서로 다른 말을 한다", () => {
    for (const text of newNotices) {
      assert.ok(
        !oldNotices.includes(text),
        `두 탭이 같은 안내를 쓴다 — 어느 쪽을 써야 할지 알 수 없다: ${text}`
      );
    }
  });

  test("옛 화면은 안내 말고는 손대지 않았다", () => {
    // 이번 조각에서 허락된 변경은 설명 한 줄뿐이다. 동작이 함께 바뀌면 결재선을
    // 안 쓰는 지금의 출하 승인이 조용히 달라진다.
    assert.match(flat(oldSectionCode), /createShipmentDelegationAction\(\{/);
    assert.match(flat(oldSectionCode), /revokeShipmentDelegationAction\(\{ delegationId \}\)/);
    assert.ok(
      !/approval-route-delegations/.test(oldSectionCode),
      "옛 화면이 새 통로를 부르기 시작했다 — 둘은 다른 표다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉥ 서버 페이지 · 통로를 베껴 적지 않는다                              */
/* ------------------------------------------------------------------ */

describe("㉥ 서버 페이지", () => {
  test("🔴 보는 사람의 것만 읽는다 — users.id 로 묻는다", () => {
    assert.match(pageCode, /from "@\/lib\/db\/queries\/approval-route-delegations"/);
    assert.match(
      flat(pageCode),
      /listApprovalRouteDelegationsForUser\(actingUser\.id\)/,
      "보는 사람의 users.id 로 묻지 않는다 — 포털 번호를 넘기면 오류 없이 영원히 0건이 된다"
    );
  });

  test("이미 있던 Promise.all 에 함께 탄다 — 조회를 줄 세우지 않는다", () => {
    assert.match(
      flat(pageCode),
      /const \[users, delegations, routeDelegations, allRouteDelegationsResult, approvalRouteEntries, approverCandidates, delegateCandidateRows\] = await Promise\.all\(\[/,
      "새 조회가 기존 묶음 밖으로 나갔다"
    );
    assert.match(flat(pageCode), /routeDelegations=\{routeDelegations\}/, "화면에 내려보내지 않는다");
  });
});

describe("㉥ 화면은 통로를 베껴 적지 않는다", () => {
  test("🔴 인가를 스스로 판정하지 않는다", () => {
    for (const forbidden of [
      "hasPermission(",
      "actorMay(",
      'role === "ADMIN"',
      'role === "SUPER_ADMIN"',
      "isDeveloper",
    ]) {
      assert.ok(!sectionCode.includes(forbidden), `화면이 판정을 스스로 한다: ${forbidden}`);
    }
    assert.match(sectionCode, /canManageRepresentatives: boolean;/, "판정 prop 을 받지 않는다");
  });

  test("🔴 db 모듈은 **타입만** 가져온다 — 값으로 가져오면 브라우저 번들에 딸려 간다", () => {
    const valueImports = [...sectionCode.matchAll(/^import (?!type )[\s\S]*?from "([^"]+)";$/gm)].map(
      ([, from]) => from
    );
    for (const from of valueImports) {
      assert.ok(!from.startsWith("@/lib/db/"), `db 모듈을 값으로 가져온다: ${from}`);
    }
    // 쓰는 통로는 서버 액션 둘뿐이다.
    assert.match(
      flat(sectionCode),
      /import \{ createApprovalRouteDelegationAction, revokeApprovalRouteDelegationAction, \} from "@\/lib\/server\/actions\/approval-route-delegations";/,
      "서버 액션을 가져오는 자리가 달라졌다"
    );
  });

  test("🔴 값 검사를 한 벌 더 적지 않는다 — 서버가 본다", () => {
    for (const forbidden of ["OVERLAPPING", "UUID", "겹치"]) {
      assert.ok(
        !sectionCode.includes(forbidden),
        `화면이 서버의 규칙을 베껴 적었다: ${forbidden}`
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* ㉦ 모두의 결재권 위임 — 인가는 조회 안에 있다                         */
/* ------------------------------------------------------------------ */

/** 조회 파일에서 「모두의」 함수 몸통만. 이웃 조회에 단언이 걸리지 않게 끊는다. */
const listAllFn = queriesCode.slice(queriesCode.indexOf("export async function listAllApprovalRouteDelegations"));

describe("㉦ 인가는 조회 함수 안에 있다", () => {
  test("🔴 조회가 제 손으로 쓰기와 **같은 열쇠·같은 수준**을 묻는다", () => {
    assert.match(
      flat(listAllFn),
      /if \(!\(await hasPermission\(actor, "users\.shipmentRepresentatives", "MANAGE"\)\)\) \{ return \{ ok: false, reason: "FORBIDDEN" \}; \}/,
      "조회가 인가를 보지 않거나, 열쇠·수준이 쓰기와 갈렸다"
    );
  });

  test("🔴 판정이 **읽기보다 앞선다** — 거절하면서 줄을 이미 읽어 오지 않는다", () => {
    const guardAt = listAllFn.indexOf("hasPermission(");
    const firstReadAt = listAllFn.indexOf("delegationRowsBase()");
    assert.ok(guardAt >= 0, "인가 판정을 찾지 못했다");
    assert.ok(firstReadAt > 0, "줄을 읽는 자리를 찾지 못했다");
    assert.ok(
      guardAt < firstReadAt,
      "줄을 먼저 읽고 나중에 막는다 — 거절해도 DB 는 이미 남의 줄을 꺼냈다"
    );
  });

  test("🔴 거절은 빈 목록이 아니다 — `view` 칸 자체가 없다", () => {
    // 빈 목록으로 돌려주면 「권한이 없다」와 「아직 아무도 안 맡겼다」가 같은 값이 되고,
    // 화면은 둘을 구별해 말할 수 없다. 칸이 없으면 `ok` 를 안 보고 꺼내는 쪽에서
    // tsc 가 멈춘다.
    assert.match(
      flat(queriesCode),
      /export type AllApprovalRouteDelegationsResult = \| \{ ok: true; view: AllApprovalRouteDelegationsView \} \| \{ ok: false; reason: "FORBIDDEN" \};/,
      "거절 값의 모양이 달라졌다"
    );
  });

  test("🔴 서버 페이지가 판정을 **다시** 하지 않는다 — 거절을 null 로 옮겨 적을 뿐", () => {
    assert.match(
      flat(pageCode),
      /listAllApprovalRouteDelegations\(actingUser\)/,
      "행위자를 넘겨 부르지 않는다"
    );
    assert.match(
      flat(pageCode),
      /const allRouteDelegations = allRouteDelegationsResult\.ok \? allRouteDelegationsResult\.view : null;/,
      "거절을 null 로 옮겨 적는 자리가 사라졌다"
    );
    // 🔴 페이지가 「부를지 말지」를 제 권한 값으로 가르면 같은 판정이 두 곳에 적힌다.
    assert.ok(
      !/canManageRepresentatives \? listAllApprovalRouteDelegations|canManageRepresentatives &&\s*listAllApprovalRouteDelegations/.test(
        flat(pageCode)
      ),
      "페이지가 권한으로 조회를 앞질러 가른다 — 판정이 두 벌이 된다"
    );
  });

  test("🔴 화면은 판정하지 않는다 — 자료가 null 이면 묶음이 **없다**", () => {
    assert.match(
      flat(sectionCode),
      /allRouteDelegations: AllApprovalRouteDelegationsView \| null;/,
      "모두의 목록 prop 이 null 을 받지 않는다"
    );
    assert.match(flat(sectionCode), /\{allRouteDelegations && \( <>/, "묶음이 자료로 여닫히지 않는다");
    // 🔴 권한 값으로 여닫으면 「자료는 내려왔는데 안 보인다」 또는 그 반대가 생긴다.
    assert.ok(
      !/canManageRepresentatives && allRouteDelegations|allRouteDelegations && canManageRepresentatives/.test(
        flat(sectionCode)
      ),
      "묶음을 권한 값으로도 가른다 — 여는 열쇠는 자료 하나여야 한다"
    );
  });
});

describe("㉦ 누가 만들었나", () => {
  test("본인이 맡긴 것과 관리자가 세운 것이 **글자로** 갈린다", () => {
    const base = { delegatorUserId: "u1", createdByName: "홍길동" };
    assert.equal(
      approvalRouteDelegationCreatorLabel({ ...base, createdByUserId: "u1" }),
      "홍길동 (본인)"
    );
    assert.equal(
      approvalRouteDelegationCreatorLabel({ ...base, createdByUserId: "u2" }),
      "홍길동 (관리자 지정)"
    );
  });

  test("🔴 두 말이 서로 다르다 — 같으면 이 칸을 둔 까닭이 사라진다", () => {
    const self = approvalRouteDelegationCreatorLabel({
      delegatorUserId: "u1",
      createdByUserId: "u1",
      createdByName: "같은이름",
    });
    const byManager = approvalRouteDelegationCreatorLabel({
      delegatorUserId: "u1",
      createdByUserId: "u2",
      createdByName: "같은이름",
    });
    assert.notEqual(self, byManager, "만든 사람 이름이 같으면 구별이 사라진다");
  });

  test("목록 넷이 모두 같은 말로 적는다 — 같은 줄이 묶음마다 다르게 보이면 안 된다", () => {
    // 「모두의」에는 위 두 묶음에 뜬 줄이 그대로 다시 들어온다. 한쪽만 이름을
    // 날것으로 적으면 같은 줄이 두 가지로 보인다.
    // 🔵 묶음은 셋이지만 목록은 **넷**이다 — 「모두의」가 살아 있는 줄과 끝난 줄로
    // 갈려 있다. 넷 × (표 + 카드) = 여덟.
    assert.equal(
      [...sectionCode.matchAll(/approvalRouteDelegationCreatorLabel\(delegation\)/g)].length,
      8,
      "지정자 칸 여덟(목록 넷 × 표·카드)이 모두 같은 함수를 쓰지 않는다"
    );
    assert.ok(
      !/delegation\.createdByName/.test(sectionCode),
      "만든 사람 이름을 날것으로 적는 자리가 남아 있다"
    );
  });
});

describe("㉦ 되돌리기와 끝난 줄", () => {
  test("🔴 관리자가 남의 위임을 되돌릴 수 있다 — 살아 있는 줄에 단추가 있다", () => {
    const liveList = sliceBetween(allBlock, "allRouteDelegations.live.length === 0", "끝난 위임");
    assert.equal(
      [...liveList.matchAll(/renderRevokeAction\(delegation\)/g)].length,
      2,
      "표와 카드 가운데 한쪽에만 되돌리기가 붙었다"
    );
  });

  test("🔴 살아 있는 줄의 집합이 서버가 되돌려 주는 집합과 같다", () => {
    // 조회의 `live` 조건이 되돌리기 mutation 의 조건절과 같은 둘이어야, 이 목록의
    // 모든 줄에 단추가 뜨면서 **눌러도 거절당하는 줄이 하나도 없다.**
    assert.match(
      flat(listAllFn),
      /const isLive = and\( isNull\(approvalRouteDelegations\.revokedAt\), gt\(approvalRouteDelegations\.endsAt, now\) \);/,
      "살아 있는 줄의 조건이 달라졌다"
    );
    // 끝난 쪽은 그 **정확한 여집합**이다 — 한 줄이 두 목록에 함께 들어가거나 양쪽에서
    // 빠지면 사람은 그 줄을 영영 못 찾는다.
    assert.match(
      flat(listAllFn),
      /const isFinished = or\( isNotNull\(approvalRouteDelegations\.revokedAt\), lte\(approvalRouteDelegations\.endsAt, now\) \);/,
      "끝난 줄의 조건이 살아 있는 줄의 여집합이 아니다"
    );
    // 🔴 두 질의가 각자 지금을 읽으면 그 사이에 끝난 줄이 양쪽에서 빠진다.
    assert.match(
      flat(queriesCode),
      /now: Date = new Date\(\)/,
      "「지금」을 한 번 만들어 두 질의에 같은 값으로 넘기지 않는다"
    );
  });

  test("끝난 줄에는 되돌리기가 없다", () => {
    const finishedList = allBlock.slice(allBlock.indexOf("allRouteDelegations.finished.length === 0"));
    assert.ok(finishedList.length > 0, "끝난 줄 목록을 찾지 못했다");
    assert.ok(
      !finishedList.includes("renderRevokeAction"),
      "이미 끝난 줄에 단추가 붙었다 — 서버가 DELEGATION_EXPIRED 로 거절한다"
    );
  });

  test("끝난 줄은 접혀 있고, 펼치는 단추가 있다", () => {
    assert.match(flat(sectionCode), /const \[showFinished, setShowFinished\] = useState\(false\);/, "기본이 펼친 상태다");
    assert.match(flat(allBlock), /setShowFinished\(\(previous\) => !previous\)/, "펼치는 단추가 없다");
    assert.match(flat(allBlock), /\{showFinished && \(/, "펼침 상태가 목록을 여닫지 않는다");
  });

  test("🔴 상한에 잘린 것을 말해 주고, 그 숫자를 화면이 글자로 박지 않는다", () => {
    assert.match(
      flat(allBlock),
      /\{allRouteDelegations\.finishedTruncated && \(/,
      "잘렸다는 것을 말해 주지 않는다 — 「이게 전부」로 읽힌다"
    );
    assert.match(flat(allBlock), /최근 \{allRouteDelegations\.finishedLimit\}건만 보여 줍니다/);
    assert.ok(
      !/최근 50건|50건만/.test(sectionCode),
      "상한을 화면에 글자로 박았다 — 조회에서 바꾸면 화면이 거짓말을 한다"
    );
    // 상한이 어디서 오는지는 조회 하나다.
    assert.match(flat(queriesCode), /const FINISHED_DELEGATION_LIMIT = \d+;/);
    assert.match(
      flat(queriesCode),
      /finishedLimit: FINISHED_DELEGATION_LIMIT,/,
      "상한을 화면에 함께 내려보내지 않는다"
    );
  });

  test("🔴 살아 있는 줄에는 상한을 걸지 않는다 — 밀려나면 되돌릴 줄이 안 보인다", () => {
    const liveQuery = sliceBetween(listAllFn, "delegationRowsBase().where(isLive)", "delegationRowsBase()");
    assert.ok(
      !liveQuery.includes(".limit("),
      "살아 있는 줄에 상한이 걸렸다 — 되돌려야 할 줄이 목록 밖으로 밀려날 수 있다"
    );
    assert.match(
      flat(listAllFn),
      /\.limit\(FINISHED_DELEGATION_LIMIT \+ 1\)/,
      "끝난 줄을 한 건 더 받아 「더 있다」를 세는 자리가 사라졌다"
    );
  });
});

describe("㉦ 겹치는 줄을 사람에게 알려 준다", () => {
  test("🔴 위 두 묶음과 같은 줄이 다시 보인다는 것을 묶음 머리가 말해 준다", () => {
    const notice = flat(allBlock);
    assert.match(notice, /관리 권한이 있어 모든 사람의 결재권 위임을 봅니다/);
    assert.match(notice, /위의 두 묶음에 뜬 줄도 여기에 다시 보입니다/);
  });

  test("🔴 화면이 겹치는 줄을 걸러 내지 않는다 — 「전부 보인다」가 거짓이 되면 안 된다", () => {
    assert.ok(
      !/allRouteDelegations\.live\.filter|allRouteDelegations\.finished\.filter/.test(sectionCode),
      "모두의 목록에서 줄을 걸러 낸다 — 빠진 줄을 찾느라 헤매게 된다"
    );
  });

  test("목록 열쇠가 다른 묶음과 겹치지 않는다", () => {
    const listIds = [...sectionCode.matchAll(/listId="([^"]+)"/g)].map(([, id]) => id);
    assert.deepEqual(listIds, [
      "approval-route-delegations-given",
      "approval-route-delegations-received",
      "approval-route-delegations-all",
      "approval-route-delegations-all-finished",
    ]);
    assert.equal(new Set(listIds).size, listIds.length, "목록 열쇠가 겹친다 — 보기 설정이 서로를 덮는다");
  });
});
