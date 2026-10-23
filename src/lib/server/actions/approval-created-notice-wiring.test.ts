import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 결재가 생기는 **자리 전부**에서 포털을 찌르는가 · 그것이 트랜잭션 **밖**인가
 * ============================================================================
 * 2026-10-24. 결재 알림 메일을 「생기자마자」 보내려면 결재가 새로 생기는 자리를
 * 하나도 빠뜨리면 안 된다. 이 집에서 그 자리는 **넷**이고, 그중 둘은 쉽게
 * 빠뜨린다:
 *
 *  ① requestRepairCaseApprovalAction  — 접수 건 결재 요청 (**재요청도 여기**다)
 *  ② decideRepairCaseApprovalAction   — 🔴 승인하면 결재선의 **다음 단계 행이
 *                                        새로 생긴다**(다음 사람의 차례다)
 *  ③ requestQuoteApprovalAction       — 견적서 결재 요청 (재요청도 여기)
 *  ④ decideQuoteApprovalAction        — 🔴 ②와 같은 까닭
 *
 * ── 🔴 왜 글자로 재나 ───────────────────────────────────────────────────
 * 이 두 파일은 `"use server"` 에 세션·DB 사슬을 물고 있어 값으로 부를 수 없다
 * (부르는 순간 DB 가 필요해진다). **고르는 규칙**은 값으로
 * server/integration/approval-created-notice.test.ts 가 재고, **나가는 몸통**은
 * server/integration/portal-inbox.test.ts 가 잰다. 여기가 재는 것은 그 둘 사이 —
 * **어디서 불리는가, 그리고 그 자리가 안전한가**다.
 *
 * ── 🔴 트랜잭션 밖이어야 하는 까닭 ──────────────────────────────────────
 * 결재 저장은 통째로 트랜잭션 하나다(mutations/*-approvals.ts). 그 안에서 포털을
 * 부르면 ① 포털이 느릴 때 결재 저장이 함께 느려지고 ② **포털이 죽으면 결재
 * 자체가 실패한다.** 그래서 저장 계층이 알림 모듈을 아는 순간 선이 무너진다 —
 * 아래에서 그 모르는 상태를 못 박는다.
 *
 * 🔴 토막을 잘라 보는 시험이므로, 자른 자리가 **빈 문자열이 아닌 것**을 단언
 * 마다 먼저 확인한다. 안 하면 이름이 바뀐 날 아무것도 안 보면서 초록으로
 * 통과한다(옆 notification-acknowledgements-source.test.ts 의 같은 규약).
 * ============================================================================
 */

const 접수건액션 = new URL("./repair-case-approvals.ts", import.meta.url);
const 견적서액션 = new URL("./quote-approvals.ts", import.meta.url);
const 접수건저장 = new URL("../../db/mutations/repair-case-approvals.ts", import.meta.url);
const 견적서저장 = new URL("../../db/mutations/quote-approvals.ts", import.meta.url);

/**
 * 주석을 걷어낸 **코드만**. 🔴 이 파일들의 주석에는 함수 이름이 설명으로 적혀
 * 있어서(일부러 그렇게 적었다 — 왜 그 자리인지가 적혀 있다) 주석을 둔 채 세면
 * 「불린다」 쪽 단언이 **주석만으로 통과**한다.
 */
function 코드만(url: URL): string {
  return readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 한 액션 함수의 몸통을 잘라 준다. 🔴 비어 있지 않은 것을 여기서 확인한다. */
function 액션몸통(url: URL, 이름: string, 다음이름: string | null): string {
  const source = 코드만(url);
  const 시작 = source.indexOf(`export async function ${이름}`);
  assert.ok(시작 > 0, `🔴 ${이름} 이 사라졌다`);
  const 끝 = 다음이름 ? source.indexOf(`export async function ${다음이름}`) : source.length;
  assert.ok(끝 > 시작, `🔴 ${이름} 뒤를 자를 자리를 못 찾았다`);
  const 몸통 = source.slice(시작, 끝);
  assert.ok(몸통.trim().length > 0, `${이름} 토막이 비었다 — 이 시험이 아무것도 안 본다`);
  return 몸통;
}

/** 네 자리를 (이름, 몸통, 저장 함수 이름, 알림 도우미 이름)으로 돌려준다. */
function 네자리() {
  return [
    {
      이름: "requestRepairCaseApprovalAction",
      몸통: 액션몸통(접수건액션, "requestRepairCaseApprovalAction", "decideRepairCaseApprovalAction"),
      저장: "requestRepairCaseApproval(",
      알림: "notifyPortalOfApprovalTurn(",
    },
    {
      이름: "decideRepairCaseApprovalAction",
      몸통: 액션몸통(접수건액션, "decideRepairCaseApprovalAction", null),
      저장: "decideRepairCaseApproval(",
      알림: "notifyPortalOfApprovalTurn(",
    },
    {
      이름: "requestQuoteApprovalAction",
      몸통: 액션몸통(견적서액션, "requestQuoteApprovalAction", "decideQuoteApprovalAction"),
      저장: "requestQuoteApproval(",
      알림: "notifyPortalOfQuoteApprovalTurn(",
    },
    {
      이름: "decideQuoteApprovalAction",
      몸통: 액션몸통(견적서액션, "decideQuoteApprovalAction", null),
      저장: "decideQuoteApproval(",
      알림: "notifyPortalOfQuoteApprovalTurn(",
    },
  ];
}

test("🔴 결재가 생기는 **네 자리 전부**에서 포털을 찌른다", () => {
  const 자리들 = 네자리();
  // 🔴 표본이 비어서 공짜로 통과하지 않게 — 네 자리를 다 잘라 냈는지 먼저 센다.
  assert.equal(자리들.length, 4, "자리 목록이 줄었다");

  for (const { 이름, 몸통, 알림 } of 자리들) {
    assert.ok(몸통.includes(알림), `🔴 ${이름} 에서 포털을 안 찌른다 — 그 사람은 밤까지 메일을 못 받는다`);
  }
});

test("🔴 찌르는 자리가 저장이 **끝난 뒤**다 — 트랜잭션 안이 아니다", () => {
  for (const { 이름, 몸통, 저장, 알림 } of 네자리()) {
    const 저장자리 = 몸통.indexOf(`await ${저장}`);
    const 알림자리 = 몸통.indexOf(알림);
    assert.ok(저장자리 > 0, `${이름}: 저장 호출을 못 찾았다 — 이 시험이 아무것도 안 본다`);
    assert.ok(알림자리 > 0, `${이름}: 알림 호출을 못 찾았다`);
    assert.ok(
      알림자리 > 저장자리,
      `🔴 ${이름}: 저장보다 **먼저** 포털을 찌른다 — 포털이 느리면 결재가 느려지고 죽으면 결재가 실패한다`
    );
    // 성사됐을 때만 — 실패한 요청에는 아무 결재도 생기지 않았다.
    assert.match(몸통, /if \(result\.ok\) \{/, `${이름}: 성공 여부를 안 보고 찌른다`);
  }
});

test("🔴 액션 두 파일에 **트랜잭션이 없다** — 포털 왕복이 트랜잭션에 갇힐 자리가 없다", () => {
  for (const [이름, url] of [
    ["접수 건 액션", 접수건액션],
    ["견적서 액션", 견적서액션],
  ] as const) {
    const 코드 = 코드만(url);
    assert.ok(코드.trim().length > 0, `${이름}: 파일이 비었다 — 이 시험이 아무것도 안 본다`);
    assert.ok(!코드.includes("db.transaction"), `🔴 ${이름}: 액션이 트랜잭션을 열었다`);
    assert.ok(!/\btx\b/.test(코드), `🔴 ${이름}: 액션이 트랜잭션 손잡이를 들고 있다`);
  }
});

test("🔴 **저장 계층은 알림 모듈을 모른다** — 그래야 트랜잭션 안으로 들어갈 길이 없다", () => {
  for (const [이름, url] of [
    ["접수 건 저장", 접수건저장],
    ["견적서 저장", 견적서저장],
  ] as const) {
    const 코드 = 코드만(url);
    // 🔴 자른 자리가 진짜 저장 계층인지 먼저 — 트랜잭션을 여는 파일이어야 한다.
    assert.ok(코드.includes("db.transaction("), `${이름}: 엉뚱한 파일을 읽었다`);

    assert.ok(!코드.includes("approval-created-notice"), `🔴 ${이름}: 트랜잭션 안에서 알림을 부를 길이 열렸다`);
    assert.ok(!코드.includes("portal-inbox"), `🔴 ${이름}: 트랜잭션 안에서 포털을 부를 길이 열렸다`);
    assert.ok(!/notifyPortal/.test(코드), `🔴 ${이름}: 저장 계층이 포털을 부른다`);
  }
});

test("🔴 알림에 꽂는 조회가 **이미 있는 판정 그대로**다 — 새로 지은 것이 없다", () => {
  // 잘못 좁히면 그 사람은 그냥 메일을 못 받고 아무도 신고하지 않는다. 그래서
  // 「누가 결재자인가」를 아는 함수들을 **그대로** 꽂는다(approval-created-notice.ts
  // 머리말). 이름이 바뀌면 여기서 걸린다.
  const 접수건 = 코드만(접수건액션);
  for (const 꽂은것 of [
    "readCurrentApprovals: getCurrentApprovalsForCase,",
    "listInspectionApprovers: listInspectionApproverCandidates,",
    "listRepresentativeCandidates: listUsersForRepresentativeManagement,",
    "listDelegations: listShipmentDelegations,",
    "resolveShipmentDecide: resolveShipmentDecideAuthorization,",
    "readPortalSubject: getSsoSubjectForUser,",
    "notifyPortal: notifyPortalApprovalCreated,",
  ]) {
    assert.ok(접수건.includes(꽂은것), `🔴 접수 건 액션이 ${꽂은것} 을 안 꽂는다`);
  }

  const 견적서 = 코드만(견적서액션);
  for (const 꽂은것 of [
    "readQuoteProgress: getQuoteApprovalProgress,",
    "readPortalSubject: getSsoSubjectForUser,",
    "notifyPortal: notifyPortalApprovalCreated,",
  ]) {
    assert.ok(견적서.includes(꽂은것), `🔴 견적서 액션이 ${꽂은것} 을 안 꽂는다`);
  }
});

test("🔴 포털로 넘기는 값에 **결재의 내용이 없다** — 건 번호도 사유도 안 간다", () => {
  // 나가는 몸통 자체는 portal-inbox.test.ts 가 글자까지 잰다. 여기서는 그 앞,
  // **액션이 알림 쪽에 무엇을 건네는가**를 본다 — 사유(reason)나 결정 종류가
  // 여기서 새어 나가면 포털이 「내용을 안 받는다」는 약속이 깨진다.
  const 접수건알림 = 코드만(접수건액션);
  const 도우미시작 = 접수건알림.indexOf("async function notifyPortalOfApprovalTurn");
  assert.ok(도우미시작 > 0, "도우미를 못 찾았다 — 이 시험이 아무것도 안 본다");
  const 도우미 = 접수건알림.slice(도우미시작, 접수건알림.indexOf("export async function", 도우미시작));
  assert.ok(도우미.includes("notifyRepairCaseApprovalCreated("), "자른 토막이 엉뚱한 자리다");
  assert.ok(!/reason/i.test(도우미), "🔴 사유가 알림 쪽으로 넘어간다");
  assert.ok(!/decision/i.test(도우미), "🔴 결정 종류가 알림 쪽으로 넘어간다");

  for (const { 이름, 몸통, 알림 } of 네자리()) {
    const 호출 = 몸통.slice(몸통.indexOf(알림));
    const 끝 = 호출.indexOf(";");
    assert.ok(끝 > 0, `${이름}: 호출 한 줄을 못 잘랐다`);
    const 한줄 = 호출.slice(0, 끝);
    assert.ok(!/reason/i.test(한줄), `🔴 ${이름}: 사유를 함께 넘긴다`);
    assert.ok(!/result\./.test(한줄), `🔴 ${이름}: 저장 결과를 그대로 넘긴다`);
  }
});
