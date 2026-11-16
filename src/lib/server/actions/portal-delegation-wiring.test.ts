import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 포털에 맡긴 결재권 위임을 **결재 셋이 다 읽는가** · 그 자리가 안전한가
 * ============================================================================
 * 2026-11-13 결정으로 결재권 위임이 포털(dss-auth) 한 곳에 모였다(설계 B-1 —
 * dss-approvals/DELEGATION_DESIGN.md). 승인함에서 맡긴 위임이 A/S 에서 **실제로
 * 듣게** 하는 것이 이 조각이고, 묻는 자리는 **서버 액션 셋**이다:
 *
 *  ① decideRepairCaseApprovalAction    — 접수 건 최종 출하
 *  ② decideQuoteApprovalAction         — 견적서
 *  ③ decideDomesticOrderApprovalAction — 기타건 최종 출하
 *
 * 🔴 **하나라도 빠지면 「어떤 결재는 위임이 듣고 어떤 것은 안 듣는」 상태**가 되고,
 * 그것은 아무도 설명할 수 없는 모양이다. 더 나쁜 것은 빠진 쪽이 **오류를 한 줄도
 * 내지 않는다**는 점이다 — 대리인이 「권한이 없습니다」를 받을 뿐이다.
 *
 * ── 🔴 왜 글자로 재나 ───────────────────────────────────────────────────
 * 이 세 파일은 `"use server"` 에 세션·DB 사슬을 물고 있어 값으로 부를 수 없다.
 * **묻는 함수의 판단**은 값으로 server/integration/portal-delegations.test.ts 가
 * 재고, **합치는 규칙**은 domain/approval-route-delegation.test.ts 가, **결재가
 * 실제로 통과하는가**는 db/mutations/approval-route-delegation-decide.integration
 * .test.ts 가 잰다. 여기가 재는 것은 그 사이 — **어디서 불리는가, 그리고 그 자리가
 * 안전한가**다(옆 approval-created-notice-wiring.test.ts 와 같은 규약).
 *
 * ── 여기서 못 박는 것 여섯 ──────────────────────────────────────────────
 *  1. 결재 셋이 **다** 포털에 묻는다.
 *  2. **열쇠를 바꾸는 조회 둘**을 셋이 다 꽂는다 — 하나만 꽂으면 타입이 막지만,
 *     엉뚱한 함수를 꽂으면 안 막는다.
 *  3. 🔴 묻는 자리가 **저장 함수를 부르기 전**이다(설계 C-3 — 망 호출이 트랜잭션
 *     안으로 들어가면 결재 행 잠금이 포털 지연만큼 붙들린다).
 *  4. 🔴 **저장 계층이 포털 모듈을 모른다.** 아는 순간 3번의 선이 무너지고, 이 집의
 *     층 가르기(`server/` → `db/` 한 방향)도 깨진다.
 *  5. 🔴 **「못 물었다」가 화면까지 나갈 길이 살아 있다**(설계 B-7). 중간에서
 *     떨어뜨리면 안내를 띄울 수 없고, 그 안내가 B-6 의 대가를 갚는 유일한 자리다.
 *  6. 🔴 **포털이 되묻는 통로에서는 묻지 않는다.** `/api/integration/approvals` 는
 *     **포털이 부르는** 길이라, 거기서 또 포털에 물으면 서로를 기다린다.
 *
 * 🔴 토막을 잘라 보는 시험이므로, 자른 자리가 **빈 문자열이 아닌 것**을 먼저
 * 확인한다. 안 하면 이름이 바뀐 날 아무것도 안 보면서 초록으로 통과한다.
 * ============================================================================
 */

const 접수건액션 = new URL("./repair-case-approvals.ts", import.meta.url);
const 견적서액션 = new URL("./quote-approvals.ts", import.meta.url);
const 기타건액션 = new URL("./domestic-order-approvals.ts", import.meta.url);
const 접수건저장 = new URL("../../db/mutations/repair-case-approvals.ts", import.meta.url);
const 견적서저장 = new URL("../../db/mutations/quote-approvals.ts", import.meta.url);
const 기타건저장 = new URL("../../db/mutations/domestic-order-approvals.ts", import.meta.url);
const 포털통로 = new URL("../../../app/api/integration/approvals/route.ts", import.meta.url);

/**
 * 주석을 걷어낸 **코드만**. 🔴 이 파일들의 주석에는 함수 이름이 설명으로 적혀
 * 있어서(일부러 그렇게 적었다 — 왜 그 자리인지가 적혀 있다) 주석을 둔 채 세면
 * 「불린다」 쪽 단언이 **주석만으로 통과**한다. 실제로 이 저장소에서 겪은 일이다.
 */
function 코드만(url: URL): string {
  return readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 한 액션 함수의 몸통을 잘라 준다. 🔴 비어 있지 않은 것을 여기서 확인한다. */
function 액션몸통(url: URL, 이름: string): string {
  const source = 코드만(url);
  const 시작 = source.indexOf(`export async function ${이름}`);
  assert.ok(시작 > 0, `🔴 ${이름} 이 사라졌다`);
  // 다음 최상위 선언까지. 없으면 파일 끝까지.
  const 뒤 = source.slice(시작 + 1);
  const 다음 = 뒤.search(/\nexport (async )?function |\nfunction /);
  const 몸통 = 다음 >= 0 ? 뒤.slice(0, 다음) : 뒤;
  assert.ok(몸통.trim().length > 50, `${이름} 토막이 비었다 — 이 시험이 아무것도 안 본다`);
  return 몸통;
}

/** 결재를 집는 세 자리 — (이름, 액션 몸통, 저장 함수 이름). */
function 결재세자리() {
  return [
    {
      이름: "접수 건 최종 출하",
      몸통: 액션몸통(접수건액션, "decideRepairCaseApprovalAction"),
      저장: "decideRepairCaseApproval(",
    },
    {
      이름: "견적서",
      몸통: 액션몸통(견적서액션, "decideQuoteApprovalAction"),
      저장: "decideQuoteApproval(",
    },
    {
      이름: "기타건 최종 출하",
      몸통: 액션몸통(기타건액션, "decideDomesticOrderApprovalAction"),
      저장: "decideDomesticOrderApproval(",
    },
  ] as const;
}

test("🔴 결재 셋이 **다** 포털에 결재권 위임을 묻는다 — 하나만 빠져도 그 결재에서만 위임이 죽는다", () => {
  const 자리들 = 결재세자리();
  assert.equal(자리들.length, 3, "재는 자리가 셋이 아니다");
  for (const 자리 of 자리들) {
    assert.ok(
      자리.몸통.includes("resolvePortalRouteDelegations("),
      `🔴 ${자리.이름}: 포털에 위임을 묻지 않는다 — 승인함에서 맡긴 위임이 여기서만 조용히 안 듣는다`
    );
  }
});

test("🔴 열쇠를 바꾸는 조회 **둘**을 셋이 다 꽂는다 — 포털 번호 그대로는 영영 아무도 못 누른다", () => {
  for (const 자리 of 결재세자리()) {
    assert.ok(
      자리.몸통.includes("readPortalSubject: getSsoSubjectForUser,"),
      `🔴 ${자리.이름}: A/S id → 포털 번호 조회가 안 꽂혔다`
    );
    assert.ok(
      자리.몸통.includes("readUserIdsBySubjects: listUserIdsBySsoSubjects,"),
      `🔴 ${자리.이름}: 포털 번호 → A/S id 조회가 안 꽂혔다`
    );
  }
});

test("🔴 묻는 자리가 저장 함수를 부르기 **전**이다 — 망 호출이 트랜잭션 안으로 들어가면 안 된다", () => {
  for (const 자리 of 결재세자리()) {
    const 묻는자리 = 자리.몸통.indexOf("resolvePortalRouteDelegations(");
    const 저장자리 = 자리.몸통.indexOf(자리.저장);
    // 🔵 둘 다 실제로 있는지 먼저 못 박는다 — 하나가 -1 이면 비교가 공짜로 통과한다.
    assert.ok(묻는자리 > 0, `🔴 ${자리.이름}: 포털에 묻는 줄이 없다`);
    assert.ok(저장자리 > 0, `🔴 ${자리.이름}: 저장 함수를 부르는 줄이 없다`);
    assert.ok(
      묻는자리 < 저장자리,
      `🔴 ${자리.이름}: 포털을 저장 뒤에 묻는다 — 트랜잭션 안으로 들어갔을 수 있다`
    );
  }
});

test("🔴 저장 계층은 포털 모듈을 **모른다** — 알면 망 호출이 트랜잭션 안에 생긴다", () => {
  for (const [이름, url] of [
    ["접수 건 저장", 접수건저장],
    ["견적서 저장", 견적서저장],
    ["기타건 저장", 기타건저장],
  ] as const) {
    const source = 코드만(url);
    assert.ok(source.length > 100, `${이름} 소스를 못 읽었다`);
    assert.ok(
      !source.includes("@/lib/server/integration/portal-delegations"),
      `🔴 ${이름}: 저장 계층이 포털 모듈을 끌어왔다 — 망 호출이 트랜잭션 안으로 들어간다`
    );
    // 🔵 그 대신 **들고 들어온 목록**을 넘기는지는 여기서 함께 본다. 안 넘기면
    //    포털에 묻기는 하는데 판정에는 한 글자도 안 쓰이는, 가장 조용한 결함이 된다.
    assert.ok(
      source.includes("portalDelegations.delegatorUserIds"),
      `🔴 ${이름}: 물어 온 목록을 판정에 넘기지 않는다`
    );
  }
});

test("🔴 「못 물었다」가 화면까지 나갈 길이 살아 있다 — 중간에서 떨어뜨리지 않는다", () => {
  for (const [이름, url] of [
    ["접수 건 저장", 접수건저장],
    ["견적서 저장", 견적서저장],
    ["기타건 저장", 기타건저장],
  ] as const) {
    assert.ok(
      코드만(url).includes("notePortalDelegationOutage("),
      `🔴 ${이름}: 결과에 「포털에 못 물었다」를 얹지 않는다`
    );
  }
  // 🔴 견적서·기타건 액션은 성공 쪽에서 **칸을 골라 담는다**(nextApprovalId 를 화면에
  //    내보내지 않으려고). 그 자리에서 포털 안내까지 같이 사라지기 쉽다.
  for (const [이름, 몸통] of [
    ["견적서 액션", 액션몸통(견적서액션, "decideQuoteApprovalAction")],
    ["기타건 액션", 액션몸통(기타건액션, "decideDomesticOrderApprovalAction")],
  ] as const) {
    assert.ok(
      몸통.includes("portalDelegationUnavailable"),
      `🔴 ${이름}: 성공 쪽에서 포털 안내를 떨어뜨린다`
    );
  }
});

test("🔴 포털이 되묻는 통로에서는 포털에 묻지 않는다 — 서로를 기다리게 된다", () => {
  const source = 코드만(포털통로);
  // 🔵 엉뚱한 파일을 읽고 통과하지 않게, 그 통로가 맞는지 먼저 못 박는다.
  assert.ok(
    source.includes("listRepairCasesPendingMyApproval"),
    "포털이 결재할 건을 물어 가는 그 통로가 아니다 — 경로가 바뀌었다"
  );
  assert.ok(
    !source.includes("resolvePortalRouteDelegations"),
    "🔴 포털이 부르는 통로에서 또 포털을 부른다 — 결재함 한 번 여는 데 왕복이 사람 수만큼 는다"
  );
});

test("🔵 수리 검수 승인에는 묻지 않는다 — 결재선을 탈 수 없어 대신할 단계가 없다", () => {
  const 몸통 = 액션몸통(접수건액션, "decideRepairCaseApprovalAction");
  assert.ok(
    몸통.includes('input.approvalType === "FINAL_SHIPMENT"'),
    "🔴 접수 건 액션이 결재 갈래를 가르지 않는다 — 검수 승인에도 2초를 기다리게 된다"
  );
  assert.ok(
    몸통.includes("NO_PORTAL_DELEGATIONS"),
    "🔴 묻지 않는 쪽에 「묻지 않았다」를 글자로 적지 않았다"
  );
});
