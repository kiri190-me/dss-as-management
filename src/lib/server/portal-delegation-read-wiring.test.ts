import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ============================================================================
 * 포털에 맡긴 결재권 위임을 **보여 주는 쪽도 읽는가** · 통로에서는 안 묻는가
 * ============================================================================
 * 조각 3a(커밋 4285c277)가 **결재를 실행하는 쪽** 셋을 포털 위임에 이어 두었다. 그런데
 * **보여 주는 쪽**이 안 물어서 반쪽이었다 — 승인함에만 위임을 맡은 사람은 대기 목록·
 * 종에 그 건이 안 뜨고 결재 화면에 단추도 안 그려졌다. 🔴 **서버는 받아 주는데 누를
 * 자리가 없는** 상태이고, 그 사람에게는 기능이 통째로 없는 것과 같다. 이 시험은 그
 * 길이 다시 끊기는 것을 막는다(설계 B-4·B-7 — dss-approvals/DELEGATION_DESIGN.md).
 *
 * ── 🔴 왜 글자로 재나 ───────────────────────────────────────────────────
 * 여기 나오는 파일들은 `server-only` 와 DB 사슬을 물고 있어 값으로 부를 수 없다. 묻는
 * 함수의 **판단**은 server/integration/portal-delegations.test.ts 가, **합치는 규칙**은
 * domain/approval-route-delegation.test.ts 가, **결재가 실제로 통과하는가**는
 * db/mutations/approval-route-delegation-decide.integration.test.ts 가 값으로 잰다.
 * 여기가 재는 것은 그 사이 — **어디서 묻고 어디서 안 묻는가**다(옆
 * actions/portal-delegation-wiring.test.ts 와 같은 규약).
 *
 * ── 여기서 못 박는 것 여섯 ──────────────────────────────────────────────
 *  1. 결재 **화면 셋**이 포털까지 묻는 입구를 부른다 — 그리고 DB 조회를 **직접** 부르지
 *     않는다(직접 부르면 포털 위임이 조용히 빠진다).
 *  2. 그 셋이 「못 물었다」를 **화면 조각까지** 내려보내고, 조각이 그것을 그린다.
 *  3. 🔴 **열쇠를 바꾸는 조회 둘**이 입구 한 곳에 꽂혀 있다 — 포털 번호 그대로는 오류
 *     없이 영원히 아무도 못 누른다.
 *  4. 🔴 **대기 목록 조회 셋은 포털 모듈을 모른다.** 알면 망 호출이 저장 계층으로
 *     내려가고, 이 집의 층 가르기(`server/` → `db/` 한 방향)가 깨진다.
 *  5. 🔴 **포털이 되묻는 통로 둘에서는 안 묻는다** — `/api/integration/approvals` 와
 *     같은 폴더의 `notifications`. 그 통로를 부르는 쪽이 포털 자신이라, 거기서 또
 *     포털에 물으면 서로를 기다린다.
 *  6. 🔴 **A/S 자신의 두 화면은 묻는다** — 종·배지를 세우는 `(app)/layout.tsx` 와
 *     「내게 온 결재 요청」 필터를 만드는 `(app)/repair-cases/page.tsx`. 안 물으면
 *     대리인은 **대신 눌러야 할 건이 있다는 사실 자체를** 모른다.
 *
 * 🔴 토막·파일을 잘라 보는 시험이므로, 읽은 글자가 **비어 있지 않은 것**을 먼저
 * 확인한다. 안 하면 파일이 옮겨진 날 아무것도 안 보면서 초록으로 통과한다.
 * ============================================================================
 */

const srcDir = fileURLToPath(new URL("../../", import.meta.url));

/** 🔴 `[id]`·`(app)` 이 든 경로는 **path.join 으로** 짓는다(URL 이 괄호를 손댄다). */
function appFile(...segments: string[]): string {
  return path.join(srcDir, "app", ...segments);
}

/**
 * 주석을 걷어낸 **코드만**. 🔴 이 파일들의 주석에는 함수 이름이 까닭과 함께 적혀
 * 있어서(일부러 그렇게 적었다), 주석을 둔 채 세면 「부른다」 쪽 단언이 **주석만으로
 * 통과**한다. 실제로 이 저장소에서 겪은 일이다.
 */
function 코드만(file: string): string {
  const raw = readFileSync(file, "utf8");
  assert.ok(raw.length > 200, `소스를 못 읽었다: ${file}`);
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 🔵 줄바꿈·들여쓰기를 공백 하나로 — 여러 줄로 접힌 호출을 한 모양으로 본다. */
function 한줄로(source: string): string {
  return source.replace(/\s+/g, " ");
}

const 입구 = path.join(srcDir, "lib", "server", "acting-approvers.ts");

/** 결재 **화면** 셋 — (이름, 페이지 파일, 화면 조각 파일). */
const 결재화면셋 = [
  {
    이름: "접수 건 검수/승인",
    페이지: appFile("(app)", "repair-cases", "[id]", "approval", "page.tsx"),
    조각: path.join(srcDir, "components", "repair-cases", "approval", "DatabaseApprovalScreen.tsx"),
  },
  {
    이름: "견적서 결재",
    페이지: appFile("(app)", "quotes", "[id]", "page.tsx"),
    조각: path.join(srcDir, "components", "quotes", "QuoteApprovalPanel.tsx"),
  },
  {
    이름: "기타건 승인",
    페이지: appFile("(app)", "domestic-orders", "[id]", "approval", "page.tsx"),
    조각: path.join(srcDir, "components", "domestic-orders", "detail", "DomesticOrderApprovalPanel.tsx"),
  },
] as const;

/** 대기 목록 조회 셋 — 종·목록·통합 승인함이 **함께** 쓰는 자리다. */
const 대기목록조회셋 = [
  ["접수 건", path.join(srcDir, "lib", "db", "queries", "repair-case-approvals-pending.ts")],
  ["견적서", path.join(srcDir, "lib", "db", "queries", "quote-approvals-pending.ts")],
  ["기타건", path.join(srcDir, "lib", "db", "queries", "domestic-order-approvals-pending.ts")],
] as const;

/** 🔴 포털이 **되묻는** 통로 둘. 여기서 포털을 부르면 서로를 기다린다. */
const 포털이되묻는통로 = [
  {
    이름: "통합 승인함이 결재할 건을 물어 가는 통로",
    파일: appFile("api", "integration", "approvals", "route.ts"),
    맞는파일인가: "listRepairCasesPendingMyApproval",
  },
  {
    이름: "포털이 알림을 물어 가는 통로",
    파일: appFile("api", "integration", "notifications", "route.ts"),
    맞는파일인가: "listMyNotifications",
  },
] as const;

test("🔴 결재 화면 셋이 **포털까지 묻는 입구**를 부른다 — DB 조회를 직접 부르면 포털 위임이 조용히 빠진다", () => {
  assert.equal(결재화면셋.length, 3, "재는 화면이 셋이 아니다");
  for (const 화면 of 결재화면셋) {
    const 코드 = 한줄로(코드만(화면.페이지));
    assert.ok(
      코드.includes("resolveActingApproversForScreen("),
      `🔴 ${화면.이름}: 포털에 위임을 묻지 않는다 — 승인함에서 맡긴 위임이 이 화면에서만 안 듣는다`
    );
    assert.ok(
      !코드.includes("resolveActingApproverUserIds("),
      `🔴 ${화면.이름}: DB 조회를 직접 부른다 — 포털 위임이 판정에서 빠지고 오류는 한 줄도 안 난다`
    );
  }
});

test("🔴 「못 물었다」가 화면 조각까지 간다 — 중간에서 떨어뜨리면 안내를 띄울 길이 없다", () => {
  for (const 화면 of 결재화면셋) {
    assert.ok(
      한줄로(코드만(화면.페이지)).includes("portalDelegationUnavailable="),
      `🔴 ${화면.이름}: 페이지가 「못 물었다」를 안 내려보낸다(설계 B-7)`
    );
    const 조각 = 한줄로(코드만(화면.조각));
    assert.ok(
      조각.includes("<PortalDelegationUnavailableNotice unavailable={portalDelegationUnavailable} />"),
      `🔴 ${화면.이름}: 받아 놓고 안내를 안 그린다 — 받기만 하는 프롭이 가장 조용한 결함이다`
    );
  }
});

test("🔴 눌렀다가 거절당한 사람에게도 같은 말을 한다 — 3a 가 결과에 실은 칸을 읽는 자리", () => {
  // 🔴 화면 위의 상자는 **그릴 때** 물어본 결과로 뜬다. 포털이 그 **뒤에** 넘어지면
  //    상자는 안 떠 있고 사람은 「권한이 없습니다」만 받는다 — 그 순간이 안내가 가장
  //    필요한 때다. 읽지 않으면 3a 가 만든 길이 통째로 죽은 코드가 된다.
  const 누르는조각 = [
    ["접수 건 출하 카드", path.join(srcDir, "components", "repair-cases", "approval", "DatabaseFinalShipmentCard.tsx")],
    ["견적서 결재 패널", path.join(srcDir, "components", "quotes", "QuoteApprovalPanel.tsx")],
    ["기타건 승인 패널", path.join(srcDir, "components", "domestic-orders", "detail", "DomesticOrderApprovalPanel.tsx")],
  ] as const;
  for (const [이름, 파일] of 누르는조각) {
    const 코드 = 한줄로(코드만(파일));
    assert.ok(
      코드.includes("appendPortalDelegationOutage(result.message, result)"),
      `🔴 ${이름}: 거절당한 결과의 「못 물었다」를 읽지 않는다`
    );
  }
});

test("🔴 열쇠를 바꾸는 조회 **둘**을 입구 한 곳이 꽂는다 — 포털 번호 그대로는 영영 아무도 못 누른다", () => {
  const 코드 = 코드만(입구);
  assert.ok(
    코드.includes("readPortalSubject: getSsoSubjectForUser,"),
    "🔴 A/S id → 포털 번호 조회가 안 꽂혔다"
  );
  assert.ok(
    코드.includes("readUserIdsBySubjects: listUserIdsBySsoSubjects,"),
    "🔴 포털 번호 → A/S id 조회가 안 꽂혔다"
  );
  // 🔴 **묻는 것이 조회보다 먼저다.** 뒤집으면 포털 목록이 판정에 못 들어가고, 그
  //    어긋남은 「단추가 안 보인다」로만 드러난다.
  const 묻는자리 = 코드.indexOf("readPortalRouteDelegations(actorUserId)");
  const 판정자리 = 코드.indexOf("resolveActingApproverUserIds(");
  assert.ok(묻는자리 > 0, "🔴 입구가 포털에 묻지 않는다");
  assert.ok(판정자리 > 0, "🔴 입구가 판정 조회를 부르지 않는다");
  assert.ok(묻는자리 < 판정자리, "🔴 포털을 판정 뒤에 묻는다 — 그 답이 판정에 못 들어간다");
});

test("🔴 대기 목록 조회 셋은 **포털 모듈을 모른다** — 알면 망 호출이 저장 계층으로 내려간다", () => {
  for (const [이름, 파일] of 대기목록조회셋) {
    const 코드 = 코드만(파일);
    // 🔵 엉뚱한 파일을 읽고 통과하지 않게, 그 조회가 맞는지 먼저 못 박는다.
    assert.ok(코드.includes("mayDecideAssignedApproval("), `${이름} 대기 목록 조회가 아니다 — 경로가 바뀌었다`);
    assert.ok(
      !코드.includes("@/lib/server/"),
      `🔴 ${이름}: 저장 계층이 server 묶음을 끌어왔다 — 층 가르기가 깨지고 망 호출이 조회 안으로 들어간다`
    );
    // 🔴 그 대신 **받아서 넘긴다**. 받기만 하고 안 넘기면 묻기는 하는데 판정에는 한
    //    글자도 안 쓰이는, 가장 조용한 결함이 된다.
    assert.ok(
      한줄로(코드).includes("undefined, portalDelegatorUserIds )"),
      `🔴 ${이름}: 받은 포털 위임을 판정 조회에 넘기지 않는다`
    );
  }
});

test("🔴 포털이 **되묻는 통로 둘**에서는 포털에 묻지 않는다 — 서로를 기다리게 된다", () => {
  assert.equal(포털이되묻는통로.length, 2, "재는 통로가 둘이 아니다");
  for (const 통로 of 포털이되묻는통로) {
    const 코드 = 코드만(통로.파일);
    // 🔵 엉뚱한 파일을 읽고 통과하지 않게, 그 통로가 맞는지 먼저 못 박는다.
    assert.ok(코드.includes(통로.맞는파일인가), `${통로.이름}이 아니다 — 경로가 바뀌었다`);
    for (const 금지 of [
      "resolvePortalRouteDelegations",
      "readPortalRouteDelegations",
      "resolveActingApproversForScreen",
    ]) {
      assert.ok(
        !코드.includes(금지),
        `🔴 ${통로.이름}: 포털이 부르는 통로에서 또 포털을 부른다(${금지}) — 왕복이 사람 수만큼 는다`
      );
    }
  }
});

test("🔴 A/S 자신의 두 화면은 **묻는다** — 안 물으면 대리인은 결재할 것이 있다는 사실을 모른다", () => {
  const 묻는화면 = [
    ["종·배지를 세우는 레이아웃", appFile("(app)", "layout.tsx"), "listMyNotifications("],
    ["「내게 온 결재 요청」 필터", appFile("(app)", "repair-cases", "page.tsx"), "listRepairCasesPendingMyApproval("],
  ] as const;
  for (const [이름, 파일, 맞는파일인가] of 묻는화면) {
    const 코드 = 한줄로(코드만(파일));
    assert.ok(코드.includes(맞는파일인가), `${이름}이 아니다 — 경로가 바뀌었다`);
    assert.ok(
      코드.includes("readPortalRouteDelegations("),
      `🔴 ${이름}: 포털에 위임을 묻지 않는다 — 승인함에만 맡긴 사람에게 그 건이 안 뜬다`
    );
    assert.ok(
      코드.includes("delegatorUserIds"),
      `🔴 ${이름}: 물어 놓고 그 목록을 조회에 안 넘긴다`
    );
  }
});
