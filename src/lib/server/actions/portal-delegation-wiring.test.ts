import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 결재를 집는 쪽은 **포털에 묻지 않는다** — 제 표를 트랜잭션 안에서 읽는다
 * ============================================================================
 * 2026-11-13 결정으로 결재권 위임이 포털(dss-auth) 한 곳에 모였다(설계 B-1 —
 * dss-approvals/DELEGATION_DESIGN.md). **읽는 방식**은 같은 해 11-16 에 두 번 정해졌다:
 *
 *   · 낮(B-3 · 조각 3a): 결재할 때마다 **각 시스템이 포털에 물었다**(pull). 서버 액션
 *     셋이 트랜잭션을 열기 전에 묻고, 그 답을 저장 함수에 인자로 들고 들어갔다.
 *   · 저녁(B-12 · 이 조각): **포털이 지정·철회할 때 전파하고**(push), 각 시스템은
 *     **제 표만 읽는다.** A/S 쪽 그 표가 `portal_approval_delegations` 다.
 *
 * 🔴 **그래서 이 시험의 뜻이 뒤집혔다.** 전에는 「셋이 **다** 묻는가」를 셌고, 지금은
 * 「**어디서도 안 묻는가** · 그 대신 제 표를 **트랜잭션 안에서** 읽는가」를 센다.
 * 되돌아가면 결재 길목에 망 호출이 다시 생기고, 포털이 느린 날 [승인] 단추가 그만큼
 * 붙들린다(설계 C-3 — 트랜잭션이 망 지연만큼 열려 있게 된다).
 *
 * ── 🔴 왜 글자로 재나 ───────────────────────────────────────────────────
 * 이 파일들은 `"use server"` 에 세션·DB 사슬을 물고 있어 값으로 부를 수 없다.
 * **합치는 규칙**은 domain/approval-route-delegation.test.ts 가, **결재가 실제로
 * 통과하는가**는 db/mutations/approval-route-delegation-decide.integration.test.ts 가
 * 값으로 잰다. 여기가 재는 것은 그 사이 — **어디서 읽고 어디서 안 묻는가**다.
 *
 * ── 여기서 못 박는 것 다섯 ──────────────────────────────────────────────
 *  1. 🔴 **서버 액션 셋이 포털에 묻지 않는다.** 걷어낸 이름이 하나도 안 보인다.
 *  2. 🔴 **「못 물었다」라는 상태가 없다** — 그 개념에 딸린 칸·함수가 셋 어디에도 없다.
 *     남겨 두면 아무도 안 읽는 죽은 값이 되고, 다음 사람이 그것을 근거로 묻는 길을
 *     되살린다.
 *  3. 🔴 **저장 셋이 판정 조회에 트랜잭션을 넘긴다.** 안 넘기면 읽은 직후 되돌려진
 *     위임으로 결재가 통과하고, 그 어긋남은 오류를 한 줄도 내지 않는다.
 *  4. 🔴 **저장 셋이 `server/` 묶음을 끌어오지 않는다.** 끌어오는 순간 망 호출이
 *     트랜잭션 안으로 들어갈 길이 열린다(이 집의 층 가르기는 `server/` → `db/` 한 방향).
 *  5. 🔵 **결재선을 타는 행에만 묻는 갈래가 살아 있다.** 전에는 서버 액션이 갈랐고
 *     (수리 검수 승인에 2초를 안 쓰려고), 지금은 망 호출이 없어 **저장 함수 안의
 *     `followsRoute` 갈래**가 그 자리다 — 질의 하나를 아끼는 뜻은 그대로다.
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

/**
 * 🔴 **걷어낸 길의 이름들.** 하나라도 소스에 돌아오면 그것은 「결재할 때마다 포털에
 * 묻는」 방식이 되살아났다는 뜻이다(설계 B-3 → B-12 로 뒤집은 그 길).
 *
 * 🔵 `getSsoSubjectForUser` 는 **금지 목록에 없다.** 같은 파일들이 결재가 생겼을 때
 * 포털에 **메일을 찌르는** 자리에서 그 조회를 쓰고 있고, 그것은 결재 길목이 아니라
 * 결재가 끝난 뒤의 알림이다 — 넓게 금지하면 멀쩡한 쓰임이 함께 막힌다.
 */
const 걷어낸이름 = [
  "resolvePortalRouteDelegations",
  "readPortalRouteDelegations",
  "resolveActingApproversForScreen",
  "portal-delegations",
  "acting-approvers",
  "portal-approval-delegation",
  "NO_PORTAL_DELEGATIONS",
  "notePortalDelegationOutage",
  "appendPortalDelegationOutage",
  "portalDelegationUnavailable",
] as const;

/**
 * 주석을 걷어낸 **코드만**. 🔴 이 파일들의 주석에는 걷어낸 함수 이름이 **까닭과 함께**
 * 적혀 있어서(일부러 그렇게 적었다 — 되살리지 말라는 경고다), 주석을 둔 채 세면
 * 「안 부른다」 쪽 단언이 **주석 때문에 틀린다.** 실제로 이 저장소에서 겪은 일이다.
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

/** 결재를 실제로 집는 저장 셋. */
function 저장세자리() {
  return [
    ["접수 건 저장", 접수건저장, "resolveActingApproverUserIds(actorUserId, new Date(), tx)"],
    ["견적서 저장", 견적서저장, "resolveActingApproverUserIds(actor.id, new Date(), tx)"],
    ["기타건 저장", 기타건저장, "resolveActingApproverUserIds(actor.id, new Date(), tx)"],
  ] as const;
}

test("🔴 결재 셋이 **아무도 포털에 묻지 않는다** — 묻는 길이 돌아오면 결재가 포털에 묶인다", () => {
  const 자리들 = 결재세자리();
  assert.equal(자리들.length, 3, "재는 자리가 셋이 아니다");
  for (const 자리 of 자리들) {
    // 🔵 토막이 진짜 그 액션인지 먼저 못 박는다 — 아니면 금지 단언이 공짜로 통과한다.
    assert.ok(자리.몸통.includes(자리.저장), `🔴 ${자리.이름}: 저장 함수를 부르는 줄이 없다`);
    for (const 금지 of 걷어낸이름) {
      assert.ok(
        !자리.몸통.includes(금지),
        `🔴 ${자리.이름}: 걷어낸 포털 왕복이 되살아났다(${금지}) — 사람이 [승인]을 누르고 기다리는 길목이다`
      );
    }
  }
});

test("🔴 저장 셋에도 「못 물었다」가 남아 있지 않다 — 아무도 안 읽는 죽은 값을 두지 않는다", () => {
  for (const [이름, url] of 저장세자리().map(([이름, url]) => [이름, url] as const)) {
    const source = 코드만(url);
    assert.ok(source.length > 100, `${이름} 소스를 못 읽었다`);
    for (const 금지 of 걷어낸이름) {
      assert.ok(
        !source.includes(금지),
        `🔴 ${이름}: 걷어낸 이름이 남아 있다(${금지}) — 다음 사람이 그것을 근거로 묻는 길을 되살린다`
      );
    }
  }
});

test("🔴 저장 셋이 판정 조회에 **트랜잭션을 넘긴다** — 밖에서 읽으면 되돌린 위임으로 통과한다", () => {
  for (const [이름, url, 기대] of 저장세자리()) {
    const source = 코드만(url).replace(/\s+/g, " ");
    assert.ok(
      source.includes(기대),
      `🔴 ${이름}: 판정 조회를 트랜잭션 없이(또는 다른 모양으로) 부른다 — 기대한 글자: ${기대}`
    );
  }
});

test("🔴 저장 셋은 `server/` 묶음을 끌어오지 않는다 — 층 가르기가 망 호출을 막는 울타리다", () => {
  for (const [이름, url] of 저장세자리().map(([이름, url]) => [이름, url] as const)) {
    const source = 코드만(url);
    assert.ok(
      !source.includes("@/lib/server/"),
      `🔴 ${이름}: 저장 계층이 server 묶음을 끌어왔다 — 망 호출이 트랜잭션 안으로 들어갈 길이 열린다`
    );
  }
});

test("🔵 결재선을 타는 행에만 위임을 읽는다 — 갈래가 저장 함수 안에 살아 있다", () => {
  // 전에는 **서버 액션**이 갈랐다(수리 검수 승인에 포털 왕복 2초를 안 쓰려고). 망
  // 호출이 없어진 지금은 저장 함수 안의 `followsRoute` 갈래가 그 자리이고, 아끼는
  // 것이 2초에서 질의 하나로 바뀌었을 뿐 뜻은 같다 — 결재선을 안 타는 행에는 대신할
  // 「단계」가 애초에 없다.
  const 접수건 = 코드만(접수건저장).replace(/\s+/g, " ");
  assert.ok(
    접수건.includes("const actingApproverUserIds = followsRoute ?"),
    "🔴 접수 건 저장이 결재선 갈래를 잃었다 — 검수 승인 행에도 위임 질의가 돈다"
  );
  assert.ok(접수건.includes(": NO_ROUTE_DELEGATIONS;"), "🔴 안 타는 쪽에 빈 목록을 글자로 안 적었다");
  for (const [이름, url] of [
    ["견적서 저장", 견적서저장],
    ["기타건 저장", 기타건저장],
  ] as const) {
    const source = 코드만(url).replace(/\s+/g, " ");
    assert.ok(
      source.includes("approvalFollowsRoute(latest) ?"),
      `🔴 ${이름}: 결재선 갈래가 사라졌다`
    );
  }
});
