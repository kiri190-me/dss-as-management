import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ============================================================================
 * 결재권 위임은 **제 표에서 읽는다** — 어디서도 포털에 묻지 않는다
 * ============================================================================
 * 2026-11-16 하루에 방식이 두 번 정해졌다(설계 — dss-approvals/DELEGATION_DESIGN.md):
 *
 *   · 낮(B-3 · 조각 3a·3b): 결재·목록·종이 **그때그때 포털에 물었다**(pull). 묻는
 *     자리가 다섯이었고 전부 `server/acting-approvers.ts` 한 입구를 거쳤다.
 *   · 저녁(B-12 · 이 조각): 포털이 **지정·철회할 때 전파하고**, 각 시스템은 **제 표만
 *     읽는다**(push). A/S 쪽 그 표가 `portal_approval_delegations` 다.
 *
 * 🔴 **그래서 이 시험의 뜻이 뒤집혔다.** 전에는 「보여 주는 쪽도 **묻는가**」와 「포털이
 * 되묻는 통로에서는 **안 묻는가**」를 갈라 셌다. 지금은 **아무도 안 묻는다** — 그 둘을
 * 가르는 뜻 자체가 없어졌으므로, 여기서는 **「어디서도 묻지 않는다」를 저장소 전체에**
 * 걸어 둔다. 좁게 두면 되돌아가도 안 깨진다.
 *
 * 🟢 **덤으로 메워진 구멍 하나**: 포털이 되묻는 통로 둘(`/api/integration/approvals` ·
 * 같은 폴더의 `notifications`)은 전에 **일부러 안 물었다**(거기서 포털에 물으면 포털이
 * A/S 를 기다리는 동안 A/S 가 포털을 기다린다). 그 탓에 통합 승인함과 남의 시스템 종에
 * **대신 결재할 건이 빠져** 있었다(설계 D-8 ②). 이제 대기 목록 조회가 제 표를 읽으므로
 * 그 통로도 **같은 답**을 받는다 — 아래 마지막 시험이 그 사실을 못 박는다.
 *
 * ── 🔴 왜 글자로 재나 ───────────────────────────────────────────────────
 * 여기 나오는 파일들은 `server-only` 와 DB 사슬을 물고 있어 값으로 부를 수 없다.
 * **합치는 규칙**은 domain/approval-route-delegation.test.ts 가, **결재가 실제로
 * 통과하는가**는 db/mutations/approval-route-delegation-decide.integration.test.ts 가
 * 값으로 잰다. 여기가 재는 것은 그 사이 — **어디서 읽고, 어디서도 묻지 않는가**다.
 *
 * ── 여기서 못 박는 것 여섯 ──────────────────────────────────────────────
 *  1. 🔴 **걷어낸 파일 넷이 정말 없다**(묻는 왕복 · 입구 · 「못 물었다」 그릇 · 안내 조각).
 *  2. 🔴 **소스 어디에도 묻는 이름이 없다** — 저장소 전체를 훑는다. 되살아나면 결재
 *     길목에 망 호출이 돌아온 것이다.
 *  3. 결재 **화면 셋**이 판정 조회를 부른다 — 그리고 「못 물었다」를 더 이상 내려보내지
 *     않는다.
 *  4. 🔴 **판정 조회가 표 둘을 읽는다.** 포털 표를 빼면 승인함에서 맡긴 위임이 A/S 에서
 *     **아무 일도 안 일으킨다** — 오류 한 줄 없이.
 *  5. 🔴 **거꾸로 방향도 표 둘을 읽는다**(2026-11-17, 설계 D-8 ①). 4번만 세고 있던
 *     동안 「나를 누가 대신하나」는 제 표만 읽었고, 그래서 승인함에서 맡긴 위임의
 *     대리인은 **결재가 생길 때 나가는 메일만** 못 받았다 — 누를 수는 있었다.
 *  6. 🟢 **포털이 되묻는 통로 둘도 같은 답을 받는다**(D-8 ② — 설계상 저절로 메워진 자리).
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
 * 주석을 걷어낸 **코드만**. 🔴 이 파일들의 주석에는 걷어낸 함수 이름이 **까닭과 함께**
 * 적혀 있어서(되살리지 말라는 경고다), 주석을 둔 채 세면 「안 부른다」 쪽 단언이
 * **주석 때문에 틀린다.** 실제로 이 저장소에서 겪은 일이다.
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

/**
 * 🔴 **걷어낸 길의 이름들.** 하나라도 소스에 돌아오면 「결재할 때마다 포털에 묻는」
 * 방식이 되살아났다는 뜻이다.
 *
 * 🔴 **살아 있는 이름과 글자가 겹치지 않게** 골랐다. `portal_approval_delegations`
 * (받는 표)와 `portal-delegation-push`(받는 쪽 판단)는 **지금 도는 코드**이므로,
 * 모듈 경로는 **닫는 따옴표까지** 적어 그 둘에 걸리지 않게 한다.
 * 🔵 `getSsoSubjectForUser` 는 금지하지 않는다 — 결재가 끝난 뒤 포털에 **메일을
 * 찌르는** 자리가 그 조회를 쓰고, 그것은 결재 길목이 아니다.
 */
const 묻던이름 = [
  "resolvePortalRouteDelegations",
  "readPortalRouteDelegations",
  "resolveActingApproversForScreen",
  "NO_ACTING_APPROVERS",
  "NO_PORTAL_DELEGATIONS",
  "NO_PORTAL_DELEGATION_USER_IDS",
  "PortalRouteDelegations",
  "notePortalDelegationOutage",
  "appendPortalDelegationOutage",
  "portalDelegationUnavailable",
  "PortalDelegationUnavailableNotice",
  '@/lib/server/acting-approvers"',
  '@/lib/server/integration/portal-delegations"',
  '@/lib/domain/portal-approval-delegation"',
] as const;

/** 2026-11-16 저녁에 **지운** 파일들. 되살아나면 그 자체가 되돌아간 증거다. */
const 지운파일 = [
  ["포털에 묻는 왕복", path.join(srcDir, "lib", "server", "integration", "portal-delegations.ts")],
  ["읽는 쪽 입구", path.join(srcDir, "lib", "server", "acting-approvers.ts")],
  ["「못 물었다」 그릇", path.join(srcDir, "lib", "domain", "portal-approval-delegation.ts")],
  [
    "「못 물었다」 안내 조각",
    path.join(srcDir, "components", "approvals", "PortalDelegationUnavailableNotice.tsx"),
  ],
] as const;

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

/** 🟢 포털이 **되묻는** 통로 둘. 전에는 여기만 위임을 못 봤다(설계 D-8 ②). */
const 포털이되묻는통로 = [
  {
    이름: "통합 승인함이 결재할 건을 물어 가는 통로",
    파일: appFile("api", "integration", "approvals", "route.ts"),
    // 🔵 통로는 조회를 **직접 부르지 않고 넘긴다**(판단은 그 아래 모듈이 한다). 그래서
    //    찾는 글자가 호출 괄호가 아니라 **꽂는 자리**다.
    꽂는자리: "listRepairCaseApprovals: listRepairCasesPendingMyApproval,",
  },
  {
    이름: "포털이 알림을 물어 가는 통로",
    파일: appFile("api", "integration", "notifications", "route.ts"),
    꽂는자리: "listNotifications: listMyNotifications,",
  },
] as const;

/**
 * `src` 아래 **시험이 아닌** 소스 전부. 🔴 시험 파일을 빼는 까닭은 이 파일 자신이
 * 위 금지 이름을 **글자로 들고 있기** 때문이다(그리고 뒤집힌 다른 시험들도 「옛 이름이
 * 안 보인다」를 재느라 같은 글자를 쓴다). 재려는 것은 **도는 코드**다.
 */
function 소스파일들(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...소스파일들(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

test("🔴 걷어낸 파일 넷이 **정말 없다** — 되살아나면 묻는 길이 돌아온 것이다", () => {
  assert.equal(지운파일.length, 4, "재는 파일이 넷이 아니다");
  for (const [이름, 파일] of 지운파일) {
    assert.ok(!existsSync(파일), `🔴 ${이름}: 걷어낸 파일이 되살아났다 — ${파일}`);
  }
});

test("🔴 **소스 어디에도** 포털에 위임을 묻는 이름이 없다", () => {
  const files = 소스파일들(srcDir);
  // 🔵 표본이 비어서 공짜로 통과하지 않게 — 몇 개를 읽었는지와, **반드시 들어 있어야
  //    할 파일**이 표본에 있는지를 먼저 못 박는다.
  assert.ok(files.length > 300, `소스를 ${files.length}개만 읽었다 — 훑는 뿌리가 틀렸다`);
  const 판정조회 = path.join(srcDir, "lib", "db", "queries", "approval-route-delegations.ts");
  assert.ok(files.includes(판정조회), "판정 조회가 표본에 없다 — 이 시험이 아무것도 안 본다");

  // 🔴 **주석을 먼저 걷는다.** 걷어낸 자리마다 「한때 여기 `portalDelegationUnavailable`
  //    칸이 있었다 — 되살리지 마라」가 주석으로 적혀 있고(이 집의 문체다), 날것으로
  //    세면 그 경고문 자체가 위반으로 잡힌다. 재려는 것은 **도는 코드**다.
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const 금지 of 묻던이름) {
      if (source.includes(금지)) offenders.push(`${path.relative(srcDir, file)} :: ${금지}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "🔴 걷어낸 포털 왕복이 되살아났다 — 결재 길목에 망 호출이 돌아온다(설계 B-12)"
  );
});

test("🔴 결재 화면 셋이 **판정 조회**를 부른다 — 안 부르면 단추가 아예 안 그려진다", () => {
  assert.equal(결재화면셋.length, 3, "재는 화면이 셋이 아니다");
  for (const 화면 of 결재화면셋) {
    const 코드 = 한줄로(코드만(화면.페이지));
    assert.ok(
      코드.includes("resolveActingApproverUserIds("),
      `🔴 ${화면.이름}: 대신 누를 수 있는 자리를 아예 안 읽는다`
    );
    assert.ok(
      코드.includes('from "@/lib/db/queries/approval-route-delegations"'),
      `🔴 ${화면.이름}: 판정 조회를 엉뚱한 곳에서 끌어온다`
    );
    // 🔴 조각까지 **넘긴다**. 읽어 놓고 안 넘기면 단추는 그대로 안 그려지고, 그 결함은
    //    아무 오류도 내지 않는다.
    assert.ok(
      코드.includes("actingApproverUserIds={actingApproverUserIds}"),
      `🔴 ${화면.이름}: 읽어 놓고 화면 조각에 안 넘긴다`
    );
    // 🔵 조각 쪽은 **프롭을 받아 쓰는지**만 본다(그리는 모양은 그 화면의 시험 몫이다).
    assert.ok(
      코드만(화면.조각).includes("actingApproverUserIds"),
      `🔴 ${화면.이름}: 조각이 그 목록을 안 쓴다`
    );
  }
});

/**
 * 공개 함수 하나의 토막. 🔴 파일 전체로 세면 **옆 함수의 글자**가 섞인다 — 이 파일에는
 * 두 방향 조회가 나란히 있고, 한쪽만 고친 날 다른 쪽 글자로 통과할 수 있다.
 */
function 함수토막(코드: string, 이름: string): string {
  const 시작 = 코드.indexOf(`export async function ${이름}(`);
  assert.ok(시작 >= 0, `${이름} 을 못 찾았다 — 이름이 바뀌었거나 파일이 옮겨졌다`);
  const 다음 = 코드.indexOf("export ", 시작 + `export async function ${이름}(`.length);
  const 토막 = 다음 > 시작 ? 코드.slice(시작, 다음) : 코드.slice(시작);
  assert.ok(토막.length > 50, `${이름} 토막이 비었다 — 이 시험이 아무것도 안 본다`);
  return 토막;
}

test("🔴 판정 조회가 **표 둘**을 읽는다 — 포털 표를 빼면 승인함 위임이 아무 데서도 안 듣는다", () => {
  const 판정조회 = path.join(srcDir, "lib", "db", "queries", "approval-route-delegations.ts");
  const 코드 = 한줄로(코드만(판정조회));

  // 🔴 **두 표를 읽는 글자는 2026-11-17 에 한 자리로 모였다**(설계 D-8 ①). 그 전에는 이
  //    함수 안에 질의가 두 벌 적혀 있었고 여기서 `.from(…)` 두 줄을 세었는데, **거꾸로
  //    방향**(「나를 누가 대신하나」)이 제 표만 읽는 것을 그 셈으로는 알 수 없었다 —
  //    그래서 승인함에서 맡긴 위임의 대리인이 결재 메일만 못 받고 있었다. 지금은 두
  //    방향이 **같은 읽기 함수**를 쓰므로, 그 함수가 두 표를 읽는지를 한 번 세고 방향
  //    둘이 각각 그것을 부르는지를 잰다.
  assert.ok(
    코드.includes("readLiveDelegationPeriods(approvalRouteDelegations,"),
    "🔴 A/S 제 표를 안 읽는다"
  );
  assert.ok(
    코드.includes("readLiveDelegationPeriods(portalApprovalDelegations,"),
    "🔴 포털이 전파해 준 표를 안 읽는다"
  );

  const 정방향 = 함수토막(코드, "resolveActingApproverUserIds");
  assert.ok(
    정방향.includes("readLiveDelegationPeriodsFromBothSources("),
    "🔴 판정이 두 고지를 읽는 자리를 안 쓴다 — 제 질의를 따로 들고 있다"
  );
  // 🔴 좁히는 칸이 방향의 전부다. 바꿔 넣어도 오류 없이 **빈 목록**이 돌아온다.
  assert.ok(정방향.includes('"delegateUserId"'), "🔴 판정이 거꾸로 방향으로 좁힌다");
  // 🔴 **읽어 놓고 안 합치면** 아무 일도 안 일어난다 — 합치는 자리는 순수 함수 하나다.
  assert.ok(
    정방향.includes("actingApproverUserIds(own, actorUserId, now, portal)"),
    "🔴 두 표를 읽어 놓고 판정에 둘 다 넘기지 않는다"
  );

  // 🔴 저장 계층은 망을 타지 않는다 — 이 조회에 fetch 가 들어오면 트랜잭션이 열린 채
  //    망을 기다린다.
  assert.ok(!코드.includes("@/lib/server/"), "🔴 저장 계층이 server 묶음을 끌어왔다");
});

test("🔴 **거꾸로 방향도** 같은 자리를 쓴다 — 안 그러면 대리인이 결재 메일만 못 받는다", () => {
  // 2026-11-17(설계 D-8 ①). 「나를 누가 대신하나」는 결재가 생겼을 때 **즉시 메일**을
  // 받을 사람을 넓히는 조회다(server/integration/approval-created-notice.ts). 그 조회가
  // A/S 제 표만 읽던 동안, 승인함에서 맡긴 위임의 대리인은 결재를 **누를 수는 있고**
  // (정방향이 두 표를 읽는다) 종·승인함 대기 목록에도 떴다 — 🔵 모자란 것이 **메일
  // 하나뿐**이라 화면에도 로그에도 아무 표시가 안 남았다.
  const 판정조회 = path.join(srcDir, "lib", "db", "queries", "approval-route-delegations.ts");
  const 코드 = 한줄로(코드만(판정조회));
  const 거꾸로 = 함수토막(코드, "resolveActingDelegateUserIds");

  assert.ok(
    거꾸로.includes("readLiveDelegationPeriodsFromBothSources("),
    "🔴 거꾸로 방향이 제 질의를 따로 들고 있다 — 두 고지를 읽는 자리를 안 쓴다"
  );
  assert.ok(거꾸로.includes('"delegatorUserId"'), "🔴 거꾸로 방향이 정방향 칸으로 좁힌다");
  assert.ok(
    거꾸로.includes("actingDelegateUserIdsFor(own, delegatorUserId, now, portal)"),
    "🔴 두 표를 읽어 놓고 둘 다 넘기지 않는다 — 승인함 쪽 대리인이 메일을 못 받는다"
  );
});

test("🟢 포털이 되묻는 통로 둘도 **같은 답**을 받는다 — 전에 빠져 있던 자리다(설계 D-8 ②)", () => {
  assert.equal(포털이되묻는통로.length, 2, "재는 통로가 둘이 아니다");
  for (const 통로 of 포털이되묻는통로) {
    const 코드 = 한줄로(코드만(통로.파일));
    // 🔴 **그 통로가 A/S 의 같은 조회를 쓴다.** 전에는 이 통로만 포털 위임을 못 봐서
    //    통합 승인함에 대신 결재할 건이 안 떴다(D-8 ②). 조회가 제 표를 읽게 된 지금은
    //    **같은 함수를 꽂아 두는 것만으로** 그 구멍이 메워진다 — 통로 쪽에 고칠 것이
    //    없었다는 사실을 여기 적어 둔다.
    assert.ok(
      코드.includes(통로.꽂는자리),
      `🔴 ${통로.이름}: A/S 의 대기 목록 조회를 안 꽂는다 — 승인함에 대신 결재할 건이 빠진다`
    );
  }
  // 🔴 그 통로들이 부르는 **조회 셋**이 포털 모듈을 모른다 — 알면 포털이 A/S 를
  //    기다리는 동안 A/S 가 포털을 기다린다(그 모양으로 되돌아가는 것을 막는 자리다).
  for (const [이름, 파일] of 대기목록조회셋) {
    const 코드 = 코드만(파일);
    // 🔵 엉뚱한 파일을 읽고 통과하지 않게, 그 조회가 맞는지 먼저 못 박는다.
    assert.ok(코드.includes("mayDecideAssignedApproval("), `${이름} 대기 목록 조회가 아니다 — 경로가 바뀌었다`);
    assert.ok(
      !코드.includes("@/lib/server/"),
      `🔴 ${이름}: 저장 계층이 server 묶음을 끌어왔다 — 망 호출이 조회 안으로 들어간다`
    );
    assert.ok(
      한줄로(코드).includes("resolveActingApproverUserIds(actor.id, new Date())"),
      `🔴 ${이름}: 판정 조회를 부르지 않는다 — 위임받은 건이 목록에서 빠진다`
    );
  }
});
