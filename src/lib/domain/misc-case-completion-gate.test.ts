import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DOMESTIC_ORDER_APPROVAL_LABEL,
  DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE,
  MISC_CASE_COMPLETION_BLOCKED_MESSAGES,
  resolveMiscCaseCompletionGate,
} from "./domestic-order-approval-rules";
import type { ShipmentApprovalState } from "./local/workflow/shipment-approval-checklist";

/**
 * ============================================================================
 * 기타건 [완료] 관문 — 승인이 끝나야 완료된다 (2026-11-07)
 * ============================================================================
 * 사용자 결정: 「기타건의 경우도 [기타건 최종 출하 승인]이 되야 [내자정리]에서
 * [완료]처리를 할 수 있도록」. 서버가 실제로 막는가는 DB 시험이 보고
 * (mutations/domestic-orders.integration.test.ts), 여기서는 **규칙 자체**를 잰다.
 *
 * 🔴 **표본이 비어 공짜로 통과하지 않게** 다섯 상태를 목록으로 세워 두고 하나씩
 * 돈다. 「승인이 없으면 막힌다」만 재면 **전부 막는 함수**도 통과하므로, 같은
 * 자리에서 **되는 경우**(APPROVED)를 함께 잰다.
 * ============================================================================
 */

/**
 * 🔴 이 다섯이 `ShipmentApprovalState` 의 전부다. 상태가 하나 늘면 이 배열에
 * 손대지 않아도 **타입이** 먼저 깨지도록 Record 로 적는다(배열 리터럴은 빠뜨려도
 * 조용하다).
 */
const ALL_STATES: Record<ShipmentApprovalState, true> = {
  NOT_REQUESTED: true,
  PENDING: true,
  APPROVED: true,
  REJECTED: true,
  STALE: true,
};
const STATES = Object.keys(ALL_STATES) as ShipmentApprovalState[];

describe("기타건 [완료] 관문 — 무엇이 통과하는가", () => {
  test("🔵 재는 표본이 비어 있지 않다 — 다섯 상태를 전부 돈다", () => {
    assert.equal(STATES.length, 5);
  });

  test("🔴 통과하는 것은 APPROVED 하나다", () => {
    const passed = STATES.filter(
      (approvalState) => resolveMiscCaseCompletionGate({ approvalState, routeInForce: true }).allowed
    );
    assert.deepEqual(passed, ["APPROVED"]);
  });

  test("🔴 APPROVED 는 **결재선 판이 지워진 뒤에도** 통과한다", () => {
    // 이미 받아 둔 승인은 관리자가 절차를 지웠다고 무효가 되지 않는다 — 그렇지
    // 않으면 판을 손대는 순간 승인받은 줄들이 한꺼번에 완료할 수 없게 된다.
    const gate = resolveMiscCaseCompletionGate({
      approvalState: "APPROVED",
      routeInForce: false,
    });
    assert.equal(gate.allowed, true);
  });

  test("🔴 STALE 은 막는다 — 승인 뒤에 줄이 바뀐 상태다", () => {
    const gate = resolveMiscCaseCompletionGate({ approvalState: "STALE", routeInForce: true });
    assert.equal(gate.allowed, false);
    if (gate.allowed) return;
    // 「승인은 났다」로 끝나면 사람은 서버가 고장 났다고 읽는다 — **왜** 다시 받아야
    // 하는지가 그 한 줄에 있어야 한다.
    assert.match(gate.message, /수정되어/);
  });

  test("🔴 막힌 넷은 저마다 다른 말을 한다 — 무엇을 해야 하는지가 갈린다", () => {
    const messages = STATES.filter((state) => state !== "APPROVED").map((approvalState) => {
      const gate = resolveMiscCaseCompletionGate({ approvalState, routeInForce: true });
      assert.equal(gate.allowed, false, `${approvalState} 가 통과했다`);
      return gate.allowed ? "" : gate.message;
    });
    assert.equal(messages.length, 4);
    assert.equal(new Set(messages).size, 4, "두 상태가 같은 말을 하면 다음 행동을 가를 수 없다");
    for (const message of messages) {
      assert.match(message, /\[완료\] 처리를 할 수 있습니다/);
      // 🔴 이름표를 글자로 베껴 적지 않았는가 — [사용자 관리] 고르개와 같은 한 곳에서 온다.
      assert.ok(message.includes(DOMESTIC_ORDER_APPROVAL_LABEL), message);
    }
  });
});

describe("🔴 결재선 판이 0개일 때 — 아무도 완료할 수 없다, 그래서 길을 알려 준다", () => {
  test("판이 없으면 **절차를 만들라**고 말한다 — 요청 경로가 거절할 때와 같은 한 줄로", () => {
    const gate = resolveMiscCaseCompletionGate({
      approvalState: "NOT_REQUESTED",
      routeInForce: false,
    });
    assert.equal(gate.allowed, false);
    if (gate.allowed) return;
    // 🔴 글자를 베껴 적지 않고 **그 상수 그대로** 들어 있어야 한다. 화면이 [승인]
    // 탭에서 미리 하는 말과 한 글자도 달라지면, 둘을 다 본 사람은 어느 쪽이 참인지
    // 모른다.
    assert.ok(gate.message.includes(DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE), gate.message);
    assert.match(gate.message, /사용자 관리/);
  });

  test("판이 있으면 **승인을 올리라**고 말한다 — 절차를 만들라고 하지 않는다", () => {
    const gate = resolveMiscCaseCompletionGate({
      approvalState: "NOT_REQUESTED",
      routeInForce: true,
    });
    assert.equal(gate.allowed, false);
    if (gate.allowed) return;
    assert.match(gate.message, /\[승인\] 탭/);
    assert.ok(
      !gate.message.includes(DOMESTIC_ORDER_APPROVAL_ROUTE_MISSING_NOTICE),
      "판이 멀쩡한데 「절차가 아직 없습니다」라고 말하고 있다"
    );
  });

  test("🔵 이미 올라간 건은 판이 지워져도 **절차 이야기를 하지 않는다**", () => {
    // 그 행은 옛 판을 붙잡고 있어 그대로 굴러간다 — 사람이 할 일은 결재를 받는
    // 것이지 절차를 다시 만드는 것이 아니다.
    for (const approvalState of ["PENDING", "REJECTED", "STALE"] as const) {
      const gate = resolveMiscCaseCompletionGate({ approvalState, routeInForce: false });
      assert.equal(gate.allowed, false);
      if (gate.allowed) continue;
      assert.equal(gate.message, MISC_CASE_COMPLETION_BLOCKED_MESSAGES[approvalState]);
    }
  });
});

/**
 * ============================================================================
 * 🔴 **완료를 누르는 자리가 전부 이 울타리를 지나는가** (2026-11-07)
 * ============================================================================
 * 관문은 저장 경로 한 곳(`setDomesticOrderCompletion`)에 있다. 그 설계가 참이려면
 * **그 함수를 부르는 곳이 셋뿐**이어야 한다 — 정의한 파일과, 화면·PO 통로가 거쳐
 * 가는 서비스 둘. 넷째가 생기는 날 이 시험이 먼저 깨진다.
 *
 * 🔴 **주석을 걷어낸 뒤에 센다.** 이 저장소의 파일들은 「왜 그렇게 했는가」를 길게
 * 적고 그 글에 함수 이름이 그대로 들어 있다 — 실제로 actions/domestic-orders.ts 의
 * 머리말이 이 함수 이름을 적고 있고, 걷어내지 않으면 **부르지 않는 파일이 부르는
 * 것으로** 세어진다.
 *
 * 원본 글자로 보는 시험이라 완전하지 않다(이름을 변수에 담아 부르면 못 본다). 그래도
 * 실제로 일어나는 모양은 막는다 — 서버 시험이 「막힌다」를 재고, 이 시험이 「그 자리를
 * 안 거치는 길이 없다」를 잰다.
 */
const srcDir = fileURLToPath(new URL("../../", import.meta.url));

function walkSources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walkSources(full, found);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** 주석을 걷어낸 본문. 블록 주석 · 줄 주석 둘 다 지운다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");
}

function sourcesCalling(token: string): string[] {
  return walkSources(srcDir)
    .filter((file) => stripComments(fs.readFileSync(file, "utf8")).includes(token))
    .map((file) => path.relative(srcDir, file).split(path.sep).join("/"))
    .sort();
}

describe("🔴 완료를 누르는 자리가 전부 울타리를 지난다", () => {
  test("setDomesticOrderCompletion 을 부르는 곳은 **서비스 둘**뿐이다", () => {
    assert.deepEqual(sourcesCalling("setDomesticOrderCompletion("), [
      // 정의한 자리 — 관문이 그 안에 있다.
      "lib/db/mutations/domestic-orders.ts",
      // [완료 처리] 가 거쳐 가는 길.
      "lib/server/services/complete-domestic-order.ts",
      // [완료 해제] 가 거쳐 가는 길 — 관문이 서지 않는 쪽이다.
      "lib/server/services/release-domestic-order.ts",
    ]);
  });

  test("🔴 화면과 PO 통로는 **그 서비스**를 부른다 — 저장 경로를 직접 부르지 않는다", () => {
    const callers = sourcesCalling("completeDomesticOrderWithShipment(");
    assert.deepEqual(callers, [
      // PO 가 부르는 통로.
      "app/api/v1/domestic-orders/[id]/completion/route.ts",
      "lib/server/actions/domestic-orders.ts",
      "lib/server/services/complete-domestic-order.ts",
    ]);
  });

  test("🔵 못 — 관문은 **완료 처리이고 기타건이고 아직 완료가 아닐 때**만 선다", () => {
    const mutation = stripComments(
      fs.readFileSync(path.join(srcDir, "lib/db/mutations/domestic-orders.ts"), "utf8")
    ).replace(/\s+/g, " ");
    // 셋 중 하나라도 빠지면 막지 말아야 할 것을 막는다: 완료 해제 · 수리 건이 붙은
    // 줄 · 이미 완료된 옛 줄.
    //
    // 🔴 **2026-11-08 에 글자가 바뀌었다 — 뜻은 그대로다.** 「기타건인가」가
    // `current.repairCaseId === null` 에서 **이름 붙은 값**(`isMiscCase`)으로 바뀌었다.
    // 회차별 완료가 생기면서 같은 판정을 **세 곳**이 쓰게 되었기 때문이다(관문을 세울지
    // · 회차 행에 완료를 찍을지 · 그 행의 완료를 거둘지). 조건 셋을 그대로 재되, 그
    // 이름이 실제로 그 비교로 정해지는지도 함께 못 박는다 — 안 그러면 `isMiscCase` 가
    // 언젠가 다른 뜻이 되어도 이 시험이 조용히 통과한다.
    assert.ok(
      mutation.includes("const isMiscCase = current.repairCaseId === null;"),
      "「기타건인가」의 정의가 바뀌었다"
    );
    assert.ok(
      mutation.includes("if (params.completed && isMiscCase && current.completedAt === null)"),
      "관문이 서는 조건 셋이 그대로가 아니다"
    );
  });

  /**
   * 🔴 **회차별 완료는 기타건에만 있다** (2026-11-08, 사용자 결정 7).
   *
   * 수리 건이 붙은 줄에 회차 행 완료를 찍으면 셋째 울타리(완료된 회차가 있으면 줄을
   * 못 지운다)가 **수리 건 줄의 납기요청일 편집까지 조용히 묶는다.** 「수리 건 붙은
   * 줄은 지금과 똑같다」가 이 조각의 완료 기준이라, 그 자리를 글자로 못 박는다.
   */
  test("🔴 회차 행에 완료를 찍는 일도 **기타건일 때만** 일어난다", () => {
    const mutation = stripComments(
      fs.readFileSync(path.join(srcDir, "lib/db/mutations/domestic-orders.ts"), "utf8")
    ).replace(/\s+/g, " ");
    // 줄 단위 완료가 회차 행을 건드리는 자리는 `isMiscCase` 안에만 있어야 한다.
    assert.ok(mutation.includes("if (isMiscCase) { if (params.completed)"), "갈림이 사라졌다");
    // 회차 단위 저장 경로는 수리 건이 붙은 줄을 **거절**한다.
    assert.ok(
      mutation.includes("if (current.repairCaseId !== null) { return { ok: false, code: \"VALIDATION_ERROR\""),
      "회차별 완료가 수리 건 줄에서 열려 있다"
    );
  });
});
