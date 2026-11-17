import { NextResponse, type NextRequest } from "next/server";
import {
  PORTAL_TOKEN_PURPOSES,
  readBearerToken,
  verifyPortalServiceToken,
} from "@/lib/auth/portal-service-token";
import { getAuthSource } from "@/lib/config/auth-source";
import { getLoginMode } from "@/lib/config/login-mode";
import { listUserIdsBySsoSubjects } from "@/lib/db/queries/users";
import { listPortalApprovalDelegationsForAudit } from "@/lib/db/queries/portal-approval-delegations";
import {
  revokePortalApprovalDelegation,
  storePortalApprovalDelegation,
} from "@/lib/db/mutations/portal-approval-delegations";
import {
  DELEGATION_LIST_LIMIT,
  buildDelegationListReply,
  isDelegationListAction,
  readDelegationAction,
} from "@/lib/server/integration/portal-delegation-list";
import {
  applyPortalDelegationPush,
  parsePortalDelegationPush,
} from "@/lib/server/integration/portal-delegation-push";

/**
 * ============================================================================
 * 통합 승인함에서 맡긴 결재권 위임을 **받아 적는** 통로 — 포털이 부른다
 * ============================================================================
 * 2026-11-16 저녁의 방식 전환(설계 B-12)에서 A/S 쪽에 생기는 자리다. 그 전에는
 * 결재할 때마다 A/S 가 포털에 물었고(server/integration/portal-delegations.ts —
 * 🔴 **아직 살아 있다. 걷어내는 것은 조각 8 이다**), 이제는 포털이 지정·철회할 때
 * 여기로 써 준다. 판단과 규약은 전부
 * `server/integration/portal-delegation-push.ts` 머리말에 있고, 이 파일에 남은 일은
 * 「토큰 꺼내 검증하고 그 함수 부르기」뿐이다.
 *
 * 🔴 **틀은 옆의 통합 통로 셋을 그대로 따른다**(notifications · notification-settings
 * · approvals). 같은 규칙을 여기서 다시 못 박는다:
 *  · 토큰은 `Authorization` 머리말로만 받는다 — 쿼리는 접근 로그에 그대로 남는다.
 *  · 검증이 **먼저**다. 실패하면 아무것도 읽지 않고 401 로 끝난다.
 *  · 응답을 캐시하지 않는다.
 *
 * ── 🔴 여기만 다른 것 둘 ────────────────────────────────────────────────
 *  1. **대상이 토큰의 `sub` 가 아니다.** 옆 셋은 「이 사람의 알림·결재」라 대상을
 *     토큰 안에서만 꺼내는 것이 그 통로의 가장 중요한 울타리였다. 여기는 **포털이
 *     남의 위임을 써 주는** 통로라 대상이 몸통에 온다 — 토큰의 `sub` 는 **부른
 *     주체**(포털이 토큰을 구울 때 실은 아무 한 사람)이고 위임 당사자가 아니다.
 *     🔴 **그 값으로 줄을 쓰면 안 된다** — 포털이 어느 계정으로 토큰을 구웠느냐에
 *     따라 엉뚱한 사람의 결재권이 넘어간다. 그래서 이 파일에 `verified.subject` 를
 *     읽는 자리가 **하나도 없다**(route-source.test.ts 가 글자로 지킨다).
 *     🔵 울타리는 대신 토큰의 **쓰임새**로 옮겨간다(아래 2번).
 *  2. **쓰기 전용 쓰임새를 요구한다** — `dss.delegations.write`. 종을 그리려고 구운
 *     읽기 토큰으로 남에게 결재권을 맡길 수 있으면 안 된다(그 상수의 주석).
 *     🔴 **포털은 아직 이 쓰임새를 굽지 않는다 — 조각 7 에서 더한다.** 그래서 배포
 *     순서가 포털 먼저이고, 이것을 먼저 올려도 오늘은 아무것도 안 깨진다(부르는
 *     쪽이 아직 없다).
 *
 * ── 🔴 답은 셋뿐이다 ────────────────────────────────────────────────────
 *     200 { outcome: "stored" }          저장했다
 *     200 { outcome: "not_applicable" }  이 시스템에는 해당 없다 — **오류가 아니다**
 *     4xx/5xx { error, error_description }
 * 포털은 4xx/5xx 를 **전파 실패**로 보고 **지정 자체를 거절한다**(설계 B-13). 그래서
 * 「A/S 계정이 없는 사람」을 오류로 답하면 그 사람에게는 위임을 아예 못 맡기게 된다 —
 * `not_applicable` 이 있는 까닭이 그것이다.
 *
 * 🔵 오류 몸통이 `{ error, error_description }` 인 것은 **통로 규약**이다(세 시스템이
 * 같아야 한다). 이 집의 다른 통로는 `{ error, message }` 를 쓰는데, 받는 쪽이 사람이
 * 아니라 포털이라 규약 쪽을 따랐다.
 *
 * 🔴 **이 표를 읽어 결재를 가르는 코드는 아직 없다**(조각 8 의 일이다). 지금 결재
 * 판정은 여전히 포털에 물어서 한다 — 이 통로는 **받아 적기만** 한다.
 *
 * ── 🔴 읽기 갈래가 생겼다 (2026-11-17, 조각 9a · 설계 B-14) ───────────────
 *     POST /api/integration/delegations
 *     Authorization: Bearer <포털이 서명한 서비스 토큰 — 🔴 **읽기 쓰임새**>
 *     { "action": "list" }
 *
 *     200 { "delegations": [ { id, startsAt, endsAt, revokedAt } ],
 *           "truncated": false }
 *
 * 🔴 **답에 사람을 싣지 않는다** — 칸은 넷뿐이고 `id` 하나로 포털과 짝이 맞는다. 까닭과
 * 상한은 `server/integration/portal-delegation-list.ts` 머리말에 있다. 전파가 다 됐는데
 * **포털 저장만 실패하는 틈**(B-13 이 못 메우는 자리)을 맞대어 보려고 연 길이다.
 *
 * ── 🔴 갈래마다 **쓰임새가 다르다** ──────────────────────────────────────
 *  · 쓰기(`upsert`·`revoke`) — `dss.delegations.write`
 *  · 읽기(`list`)            — `dss.delegations.read`
 * 🔴 **쓰기 토큰으로 읽을 수 없고, 읽기 토큰으로 쓸 수 없다.** 한 벌로 묶으면 「남에게
 * 결재권을 맡기러」 구운 토큰이 **회사 전체의 위임 장부**를 여는 열쇠가 된다. 🔵 포털이
 * 읽기 글자를 굽기 전까지 읽기 갈래는 **전부 401** 이고, 그동안 **쓰기 갈래는 한 글자도
 * 안 바뀐다.**
 *
 * 🔴 그래서 **토큰 검증보다 `action` 엿보기가 먼저다.** 어느 쓰임새를 요구할지가 갈래에
 * 달려 있어 차례를 뒤집을 수가 없다. 🔵 엿보기는 **몸통 글자에서 한 칸을 읽을 뿐** 표도
 * 토큰도 건드리지 않고, 못 읽으면 쓰기 갈래로 간다 — 그래서 자격 없는 요청이 받는 답은
 * **갈래와 무관하게 401 하나**다(모양으로 떠볼 틈이 없다).
 * 🔵 엿보는 것은 **복제본**이다. 원본 몸통은 아래 쓰기 갈래가 예전 그대로
 * `request.json()` 으로 읽는다 — 원본을 읽으면 그 자리가 **빈 몸통**을 받아 모든 쓰기가
 * 조용히 400 이 된다(휴가가 깨뜨려 보고 확인했다).
 * ============================================================================
 */

/** 전파의 답이 캐시되면 재시도가 옛 답을 받는다. */
const NO_STORE = { "cache-control": "no-store" };

function notEnabled() {
  return NextResponse.json(
    { error: "not_enabled", error_description: "이 시스템은 통합 로그인 모드가 아닙니다." },
    { status: 404, headers: NO_STORE }
  );
}

/**
 * 🔴 **읽기 갈래에서만** 쓰는 401. 아래 쓰기 갈래에는 같은 모양의 블록이 **그대로 남아
 * 있다** — 2026-11-16 에 세 집이 맞춘 자리라 이 조각에서 한 글자도 건드리지 않기로 했다.
 * 🔵 같은 글자가 두 번인 것은 그래서이고, 합치려거든 **쓰기 갈래의 답이 바이트로 같은지**를
 * 먼저 확인할 것(포털은 401 을 전파 실패로 읽고 지정 자체를 거절한다 — 설계 B-13).
 */
function invalidToken() {
  return NextResponse.json(
    { error: "invalid_token", error_description: "토큰을 받아들일 수 없습니다." },
    { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } }
  );
}

/**
 * 🔴 **읽기 갈래의 몸통.** 돌려주는 칸은 넷뿐이고 사람이 없다 —
 * `server/integration/portal-delegation-list.ts` 가 모양을 쥔다.
 *
 * 🔴 **못 읽으면 500 이다. 빈 목록으로 답하지 않는다.** 빈 목록은 「이 집에 위임이 하나도
 * 없다」는 **뜻 있는 답**이고, 점검은 그것을 「포털에만 있다 = 어긋남」으로 읽는다. 읽기에
 * 실패한 것을 그 모양으로 답하면 **DB 가 앓는 날 모든 위임이 어긋난 것으로 보고된다.**
 *
 * 🔵 오류 이름이 쓰기 갈래의 `server_error` 가 아니라 `storage_failed` 인 것은 **휴가와
 * 같은 글자**를 쓰기 위해서다(세 집이 같아야 점검 스크립트가 한 가지로 읽는다).
 */
async function listDelegations() {
  let rows;
  try {
    // 🔴 상한을 **조회와 몸통 짓는 쪽에 같은 값으로** 넘긴다. 저장 계층이 통로 규약
    //    상수를 import 할 수 없어서인데(그 상수의 주석), 둘이 어긋나면 2001 줄이 나가거나
    //    멀쩡한 날에도 `truncated` 가 참이 된다.
    rows = await listPortalApprovalDelegationsForAudit(DELEGATION_LIST_LIMIT);
  } catch (error) {
    // 🔵 안쪽 사정은 밖으로 내보내지 않는다(쓰기 갈래와 같은 처신). 🔴 포털 번호도 줄도
    //    로그에 남기지 않는다 — 남길 것은 **못 읽었다는 사실**뿐이다.
    console.error("[integration] 결재권 위임 장부 읽기 실패:", error);
    return NextResponse.json(
      { error: "storage_failed", error_description: "위임 목록을 읽지 못했습니다." },
      { status: 500, headers: NO_STORE }
    );
  }
  return NextResponse.json(buildDelegationListReply(rows, DELEGATION_LIST_LIMIT), {
    headers: NO_STORE,
  });
}

export async function POST(request: NextRequest) {
  // 데모 모드에는 포털도, 포털의 서명도 없다 — 열어 둘 까닭이 없다(옆 통로 셋과
  // 같은 판단). 🔵 운영은 언제나 sso 모드다.
  if (getLoginMode() !== "sso") return notEnabled();

  // 🔴 갈래를 **먼저** 가린다 — 요구할 쓰임새가 갈래마다 달라서 차례를 뒤집을 수 없다
  //    (머리말). 🔵 읽는 것은 **복제본**이라 아래 쓰기 갈래의 몸통은 손대지 않은 채 남고,
  //    못 읽으면 null 이 되어 예전 그대로 쓰기 갈래로 간다.
  const action = readDelegationAction(
    await request.clone().text(),
    request.headers.get("content-type")
  );

  if (isDelegationListAction(action)) {
    const verifiedReader = await verifyPortalServiceToken(
      readBearerToken(request.headers.get("authorization")),
      // 🔴 **읽기 쓰임새**다. 쓰기 토큰으로 장부를 통째로 읽을 수 있으면 안 된다.
      PORTAL_TOKEN_PURPOSES.delegationsRead
    );
    if (!verifiedReader.ok) return invalidToken();

    // 🔴 mock 계정 모드에서는 **빈 목록을 주지 않는다.** 빈 목록은 「이 집에 위임이 하나도
    //    없다」는 뜻 있는 답이라 점검이 그것을 어긋남으로 읽는다 — 읽을 자리가 없는 모드의
    //    정직한 답은 「이 통로는 지금 안 선다」(404)이다. 🔵 운영은 언제나 database 다.
    if (getAuthSource() !== "database") return notEnabled();

    return listDelegations();
  }

  // ── 아래는 2026-11-16 의 쓰기 갈래다. 🔴 차례까지 그대로 둔다 ──────────────
  const verified = await verifyPortalServiceToken(
    readBearerToken(request.headers.get("authorization")),
    PORTAL_TOKEN_PURPOSES.delegationsWrite
  );
  if (!verified.ok) {
    // 왜 거절했는지는 밖으로 내보내지 않는다 — 맞혀 가며 두드릴 실마리가 된다.
    // 까닭은 서버 로그에 남는다(portal-service-token.ts).
    return NextResponse.json(
      { error: "invalid_token", error_description: "토큰을 받아들일 수 없습니다." },
      { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } }
    );
  }

  // 🔴 저장할 자리가 없는 모드에서 200 을 주지 않는다. `not_applicable` 은 「이
  // 사람에게는 해당 없다」이지 「이 시스템이 지금 못 받는다」가 아니다 — 뭉개면
  // 포털이 전파에 성공했다고 믿고 지정을 마친다(mock 인증은 개발에서만 쓴다).
  if (getAuthSource() !== "database") return notEnabled();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "요청 본문을 읽을 수 없습니다." },
      { status: 400, headers: NO_STORE }
    );
  }

  const parsed = parsePortalDelegationPush(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_request", error_description: parsed.message },
      { status: 400, headers: NO_STORE }
    );
  }

  try {
    const outcome = await applyPortalDelegationPush(parsed.command, {
      // 🔴 **열쇠 변환을 새로 짓지 않는다** — 조각 3a 가 만들어 결재 셋이 이미 쓰고
      // 있는 조회 그대로다(지워진 계정을 빼고 `sso_subject` 로 찾는다).
      lookupUserIdsBySubjects: listUserIdsBySsoSubjects,
      storeDelegation: storePortalApprovalDelegation,
      revokeDelegation: revokePortalApprovalDelegation,
    });
    return NextResponse.json({ outcome }, { headers: NO_STORE });
  } catch (error) {
    // 🔴 안쪽 사정은 밖으로 내보내지 않는다. 500 을 받은 포털은 **전파 실패**로 보고
    // 지정을 거절한다 — 사람이 다시 누르면 같은 `id` 로 다시 온다(멱등이라 안전하다).
    console.error("[integration] 결재권 위임 전파 저장 실패:", error);
    return NextResponse.json(
      { error: "server_error", error_description: "일시적으로 처리할 수 없습니다." },
      { status: 500, headers: NO_STORE }
    );
  }
}
