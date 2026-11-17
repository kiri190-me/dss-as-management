import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * [결재권 위임] 네 번째 묶음 — 통합 승인함에서 맡긴 줄 (2026-11-17)
 * ============================================================================
 * 그 전에는 **승인함에서 맡긴 위임이 이 화면 어디에도 안 보였다.** 전파도 됐고
 * (`portal_approval_delegations` 에 줄이 살아 있었다) 결재 판정도 2026-11-16 부터
 * 두 표를 함께 읽어 **대신 누를 수도 있었는데**, 그리는 코드가 없었다. 사용자는
 * 승인함에서 맡기고 A/S 를 열어 「위임되었다는 내용이 안 뜬다」를 봤다.
 *
 * 여기서 지키는 것:
 *
 *   ㉠ 묶음이 **따로** 있다 — 세 묶음(전부 A/S 자신의 표) 뒤에 네 번째로 붙고,
 *      자료로도 주소로도 여닫지 않는다(아직 승인함을 안 쓰는 사람에게도 보인다).
 *   ㉡ 🔴 **승인함에서 온 줄에는 [되돌리기]가 없다.** 여기서 거두면 포털은 모르고
 *      다음 전파 한 번에 되살아난다 — 사람은 **거뒀다고 믿는데 안 거둬진** 상태가
 *      된다(설계 B-12 의 3번). 🔵 같은 잣대로 **A/S 쪽 줄에는 그대로 붙는지**도
 *      함께 잰다. 안 그러면 탐지기가 망가졌을 때 ㉡ 이 공짜로 통과한다.
 *   ㉢ 🔴 **출처가 줄마다 보인다.** 묶음 머리글만으로는 모자란다 — 표는 가로로
 *      스크롤되고 좁은 폭에서는 카드로 내려가, 줄 하나를 볼 때 머리글이 화면 밖인
 *      일이 흔하다. 출처를 못 읽으면 단추가 없는 것이 **고장인지 규칙인지**
 *      구별되지 않는다(설계 D-2 의 「되돌리려 할 때 찾지 못한다」).
 *   ㉣ 🔴 **주소가 없어도 화면이 선다** — 링크만 없고 안내 글자는 그대로다.
 *      환경변수가 없는 기계가 있고, 거기서 묶음이 통째로 깨지면 링크 하나 때문에
 *      위임 목록 전부를 잃는다. (값의 판정은 config/approvals-delegation-url.test.ts)
 *   ㉤ 🔴 **「끝났다」의 자가 옆 조회와 글자 그대로 같다** — 두 출처의 줄이 한
 *      화면에 나란히 서는데 자가 갈리면 같은 날짜가 묶음마다 다르게 보인다.
 *   ㉥ 🔴 **이 화면은 포털 표를 읽기만 한다** — 조회에도 쓰는 문장이 없다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * `ApprovalRouteDelegationSection` 은 **서버 액션을 직접 가져오는 클라이언트
 * 컴포넌트**라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는
 * `test:components` 에서는 import 자체가 던진다(옆
 * approval-route-delegation-section.test.ts 머리말에 같은 경위가 있다).
 * ============================================================================
 */

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

/**
 * 주석은 경위를 적는 자리다 — 지키는 것은 **코드**뿐이다. 이 파일의 단언 여럿이
 * 「…가 없다」 꼴이라, 주석에 적힌 낱말이 섞이면 멀쩡한 코드가 걸린다. 🔴 그리고
 * 거꾸로 「있어야 한다」 쪽은 **주석만으로 영영 통과**한다 — 이 묶음의 머리말이
 * 바로 그 낱말들을 길게 적어 두어서 더 그렇다.
 *
 * 🔴 앞이 `:` 인 `//` 는 건드리지 않는다(`http://…`) — 옆 시험과 같은 규칙이다.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

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
const PORTAL_QUERIES = "src/lib/db/queries/portal-approval-delegations.ts";
const AS_QUERIES = "src/lib/db/queries/approval-route-delegations.ts";

const sectionCode = withoutComments(read(SECTION));
const screenCode = withoutComments(read(SCREEN));
const pageCode = withoutComments(read(PAGE));
const portalQueriesCode = withoutComments(read(PORTAL_QUERIES));
const asQueriesCode = withoutComments(read(AS_QUERIES));

/** 네 번째 묶음의 머리글. 🔴 주석을 걷어낸 원본에는 **한 번만** 나와야 한다. */
const PORTAL_HEADING = "통합 승인함에서 맡긴 결재권 위임";

/** 네 번째 묶음부터 파일 끝까지. 위의 세 묶음은 여기 안 들어온다. */
const portalBlock = sectionCode.slice(sectionCode.indexOf(PORTAL_HEADING));
/** 그 앞 — A/S 자신의 표를 그리던 세 묶음과 공용 부품들. */
const beforePortalBlock = sectionCode.slice(0, sectionCode.indexOf(PORTAL_HEADING));

/* ------------------------------------------------------------------ */
/* ㉠ 묶음이 따로 있고, 늘 보인다                                        */
/* ------------------------------------------------------------------ */

describe("㉠ 네 번째 묶음", () => {
  test("🔴 자르는 자리가 실제로 하나다 — 머리글이 둘이면 아래 단언이 엉뚱한 데를 잰다", () => {
    assert.equal(
      [...sectionCode.matchAll(new RegExp(PORTAL_HEADING, "g"))].length,
      1,
      "묶음 머리글이 코드에 두 번 이상 나온다 — 조각 나누기가 못 믿을 것이 된다"
    );
    assert.ok(portalBlock.length > 500, "네 번째 묶음이 거의 비어 있다");
    assert.ok(beforePortalBlock.includes("모두의 결재권 위임"), "세 번째 묶음보다 앞에 끼어들었다");
  });

  test("머리글과 세 목록이 서 있다", () => {
    // 🔵 조각이 머리글 **글자에서** 시작하므로 여는 태그는 앞쪽에 남는다. 닫는
    //    쪽으로 「제목이다」를 잰다 — `<h2>`(묶음 전체 제목)와 갈리는 자리다.
    assert.ok(
      flat(portalBlock).startsWith("통합 승인함에서 맡긴 결재권 위임 </h3>"),
      "머리글이 h3 제목이 아니다"
    );
    assert.ok(portalBlock.includes("승인함에서 내가 맡긴 것"), "맡긴 목록이 없다");
    assert.ok(portalBlock.includes("승인함에서 내가 대신하고 있는 것"), "맡은 목록이 없다");
    for (const listId of [
      "portal-approval-delegations-given",
      "portal-approval-delegations-received",
      "portal-approval-delegations-finished",
    ]) {
      assert.ok(portalBlock.includes(`listId="${listId}"`), `목록 열쇠 ${listId} 가 없다`);
    }
  });

  test("🔴 자료로 여닫지 않는다 — 아직 승인함을 안 쓰는 사람에게도 묶음이 보인다", () => {
    // 「모두의 결재권 위임」은 자료가 null 이면 묶음이 **없다**(남의 줄이라 권한이
    // 가른다). 이쪽은 보는 사람 자신의 줄뿐이라 가릴 것이 없고, 묶음이 사라지면
    // 「승인함에서 맡기면 여기 뜬다」를 알 길이 없어진다.
    assert.ok(
      !/\{portalDelegations && /.test(sectionCode),
      "자료로 묶음을 여닫는다 — 빈 사람에게 묶음이 통째로 사라진다"
    );
    assert.match(
      flat(sectionCode),
      /portalDelegations: PortalApprovalDelegationsView;/,
      "자료 prop 이 null 을 받는 꼴로 바뀌었다"
    );
    // 세 목록이 각자 **빈 상태의 글자**를 갖는다. 빈 목록을 그냥 안 그리면 화면에
    // 아무 흔적이 없어 「자료가 안 왔다」와 구별되지 않는다.
    assert.ok(portalBlock.includes("통합 승인함에서 맡긴 결재권이 없습니다."));
    assert.ok(portalBlock.includes("통합 승인함에서 맡은 결재권이 없습니다."));
    assert.ok(portalBlock.includes("끝나거나 거둔 위임이 없습니다."));
  });

  test("끝난 줄 접기가 「모두의」 묶음과 **따로** 기억된다", () => {
    // 한 상태를 둘이 나눠 쓰면 한쪽을 펴려다 다른 쪽까지 펴진다. 두 묶음이 같은
    // 글자(「끝난 위임 보기」)를 써서 더 헷갈린다.
    assert.match(
      flat(sectionCode),
      /const \[showPortalFinished, setShowPortalFinished\] = useState\(false\);/,
      "승인함 묶음의 접기 상태가 따로 없다"
    );
    assert.match(flat(portalBlock), /\{showPortalFinished && \(/, "펼침 상태가 목록을 여닫지 않는다");
    assert.ok(
      !portalBlock.includes("setShowFinished"),
      "「모두의」 묶음의 접기 상태를 함께 쓴다 — 한쪽을 펴면 다른 쪽도 펴진다"
    );
  });

  test("🔴 상한에 잘린 것을 말해 주고, 그 숫자를 화면이 글자로 박지 않는다", () => {
    assert.match(flat(portalBlock), /\{portalDelegations\.finishedTruncated && \(/);
    assert.match(flat(portalBlock), /최근 \{portalDelegations\.finishedLimit\}건만 보여 줍니다/);
    assert.ok(
      !/최근 50건|50건만/.test(sectionCode),
      "상한을 화면에 글자로 박았다 — 조회에서 바꾸면 화면이 거짓말을 한다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉡ 되돌리기 — 묶음 단위로 갈린다                                      */
/* ------------------------------------------------------------------ */

/** [되돌리기] 단추를 그리는 자리에만 나오는 낱말들. */
const REVOKE_MARKERS = ["renderRevokeAction", "handleRevoke", "되돌리기"] as const;

describe("㉡ [되돌리기]가 붙는 묶음", () => {
  test("🔴 이 시험의 탐지기가 실제로 문다 — A/S 쪽 묶음에서는 셋 다 걸린다", () => {
    // 아래 「승인함 묶음에는 없다」는 **없음**을 재는 단언이라, 탐지기가 망가지면
    // 코드를 어떻게 바꿔도 공짜로 통과한다. 같은 낱말들이 A/S 쪽에서는 실제로
    // 잡히는지를 먼저 확인한다.
    const givenBlock = sliceBetween(sectionCode, "내가 맡긴 것", "내가 대신하고 있는 것");
    for (const marker of REVOKE_MARKERS) {
      assert.ok(
        beforePortalBlock.includes(marker),
        `탐지기가 더 이상 맞지 않는다 — A/S 쪽에서도 ${marker} 를 못 찾는다`
      );
    }
    // 🔴 「여기서 맡긴 줄에는 그대로 그려진다」 — 표와 카드 **둘 다**. 한쪽에만
    //    붙으면 좁은 폭에서만 단추가 사라지고, 넓은 창에서는 보이지 않는다.
    assert.equal(
      [...givenBlock.matchAll(/renderRevokeAction\(delegation\)/g)].length,
      2,
      "A/S 쪽 「내가 맡긴 것」에서 되돌리기가 사라졌다"
    );
  });

  test("🔴 승인함에서 온 줄에는 [되돌리기]를 그리지 않는다", () => {
    for (const marker of REVOKE_MARKERS) {
      assert.ok(
        !portalBlock.includes(marker),
        `승인함 묶음에 ${marker} 가 들어갔다 — 여기서 거두면 포털은 모르고 다음 전파에 되살아난다`
      );
    }
  });

  test("🔴 판정이 **묶음 단위**다 — 줄마다 갈리는 가지를 만들지 않았다", () => {
    // 한 표에 두 출처를 섞었다면 줄마다 단추가 붙었다 말았다 하고, 그 판정은
    // 어딘가에 또 한 벌 적혀야 한다. 섞지 않았으므로 단추를 부르는 자리는
    // **A/S 쪽 네 곳 그대로**이고 승인함 쪽은 아예 부르지 않는다.
    assert.equal(
      [...sectionCode.matchAll(/renderRevokeAction\(delegation\)/g)].length,
      4,
      "되돌리기를 부르는 자리 수가 달라졌다(A/S 맡긴 것 둘 + 모두의 살아 있는 줄 둘)"
    );
    assert.ok(
      !/portalDelegations[\s\S]{0,200}renderRevokeAction/.test(flat(sectionCode)),
      "승인함 자료를 도는 자리에서 되돌리기를 부른다"
    );
  });

  test("🔴 되돌릴 수 없는 까닭과 **갈 곳**을 글자로 말해 준다", () => {
    const notice = flat(sliceBetween(portalBlock, "위의 목록은 이 화면에서 맡긴 것이고", "</p>"));
    assert.match(notice, /아래 줄은 여기서 되돌릴 수 없습니다/, "못 거두는 사실을 안 적었다");
    assert.match(notice, /통합 승인함에서 거둘 수 있습니다/, "어디서 거둬야 하는지를 안 적었다");
  });
});

/* ------------------------------------------------------------------ */
/* ㉢ 출처가 줄마다 보인다                                               */
/* ------------------------------------------------------------------ */

describe("㉢ 출처 표시", () => {
  test("🔴 줄마다 「출처」 칸이 있고, 글자가 「통합 승인함」이다", () => {
    const badge = sliceBetween(sectionCode, "function renderPortalSource()", "}\n");
    assert.match(flat(badge), /> 통합 승인함 <\/span>/, "출처 딱지의 글자가 달라졌다");
    // 다크 모드 짝을 빼지 않는다 — 이 저장소는 둘 다 쓴다.
    assert.ok(badge.includes("dark:"), "출처 딱지에 다크 모드 짝이 없다");

    // 표 머리에도 칸이 있어야 한다. 값만 그리면 그 칸이 무엇인지 알 수 없다.
    assert.equal(
      [...portalBlock.matchAll(/>출처<\/th>/g)].length,
      3,
      "표 셋 모두에 「출처」 칸 머리가 있지 않다"
    );
    assert.equal(
      [...portalBlock.matchAll(/\{ label: "출처", value: renderPortalSource\(\) \}/g)].length,
      3,
      "카드 셋 모두에 「출처」 줄이 있지 않다"
    );
  });

  test("🔴 목록 여섯(표 셋 + 카드 셋)이 모두 같은 딱지를 쓴다", () => {
    assert.equal(
      [...portalBlock.matchAll(/renderPortalSource\(\)/g)].length,
      6,
      "출처를 그리지 않는 목록이 있다 — 줄만 떼어 보면 어디서 온 줄인지 모른다"
    );
  });

  test("🔴 A/S 쪽 묶음에는 이 딱지를 붙이지 않는다 — 붙이면 거짓말이 된다", () => {
    // 앞쪽에 남는 `renderPortalSource` 는 **함수 선언 하나**뿐이어야 한다.
    assert.equal(
      [...beforePortalBlock.matchAll(/renderPortalSource/g)].length,
      1,
      "A/S 쪽 묶음에서도 승인함 딱지를 그린다"
    );
    assert.ok(beforePortalBlock.includes("function renderPortalSource()"));
  });

  test("🔴 승인함 줄에는 「지정자」 칸을 그리지 않는다 — 그 칸이 표에 **없다**", () => {
    // 빈 칸을 만들어 두면 「비어 있다」가 「본인이 했다」로 읽히는 날이 온다
    // (표 머리말). 누가 지정했는지는 포털이 쥐고 있다.
    assert.ok(
      !portalBlock.includes("approvalRouteDelegationCreatorLabel"),
      "승인함 줄에 A/S 의 「지정자」 글자를 갖다 붙였다"
    );
    assert.ok(
      !/createdByUserId|revokedByName/.test(portalQueriesCode),
      "조회가 이 표에 없는 칸을 읽으려 한다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉣ 주소가 없어도 화면이 선다                                          */
/* ------------------------------------------------------------------ */

describe("㉣ 통합 승인함 주소", () => {
  test("🔴 주소가 없으면 **링크만** 없다 — 안내 글자는 그대로 남는다", () => {
    const notice = flat(sliceBetween(portalBlock, "위의 목록은 이 화면에서 맡긴 것이고", "</p>"));
    assert.match(
      notice,
      /\{approvalsDelegationUrl \? \( <a/,
      "주소가 있을 때 링크를 그리는 갈래가 없다"
    );
    assert.match(
      notice,
      /\) : \( <span>통합 승인함에서 거둘 수 있습니다<\/span> \)\}/,
      "🔴 주소가 없을 때의 갈래가 없다 — 환경변수가 빠진 기계에서 갈 곳을 못 읽는다"
    );
  });

  test("🔴 `&&` 로 여닫지 않는다 — 그 꼴이면 값이 없을 때 안내가 통째로 사라진다", () => {
    assert.ok(
      !/approvalsDelegationUrl && /.test(sectionCode),
      "주소로 안내를 여닫는다 — 못 거두는 사실만 남고 갈 곳이 사라진다"
    );
    // 묶음·목록 자체는 주소와 아무 상관이 없다. 주소를 읽는 자리는 **안내 한 줄
    // 안의 둘**뿐이다 — 갈래를 가르는 삼항과 그 갈래 안의 `href`.
    assert.equal(
      [...portalBlock.matchAll(/approvalsDelegationUrl/g)].length,
      2,
      "주소를 안내 한 줄 말고 다른 데서도 본다"
    );
    const notice = sliceBetween(portalBlock, "위의 목록은 이 화면에서 맡긴 것이고", "</p>");
    assert.equal(
      [...notice.matchAll(/approvalsDelegationUrl/g)].length,
      2,
      "주소를 읽는 자리가 안내 바깥으로 나갔다"
    );
  });

  test("🔴 주소를 화면에도 페이지에도 글자로 박지 않는다", () => {
    for (const code of [sectionCode, screenCode, pageCode]) {
      assert.ok(!/3900/.test(code), "승인함 포트를 코드에 박았다");
      assert.ok(!/\/delegations/.test(code), "승인함 경로를 코드에 박았다");
    }
    assert.match(
      flat(pageCode),
      /const approvalsDelegationUrl = getApprovalsDelegationUrlOrNull\(\);/,
      "주소를 설정 함수에서 읽지 않는다"
    );
    assert.ok(
      !/getLoginMode\(\)[\s\S]{0,80}approvalsDelegationUrl|approvalsDelegationUrl[\s\S]{0,80}getLoginMode\(\)/.test(
        flat(pageCode)
      ),
      "승인함 안내를 로그인 방식으로 가른다 — 알림 설정 안내와 섞였다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉤ 「끝났다」의 자가 옆 조회와 같다                                     */
/* ------------------------------------------------------------------ */

/**
 * 두 조회에서 같은 이름의 조건절을 꺼내, **표 이름만 지우고** 맞댄다. 표가 다르니
 * 글자가 통째로 같을 수는 없고, 다른 곳이 표 이름 **하나뿐**이어야 「같은 자」다.
 */
function conditionText(code: string, name: string): string {
  const matched = flat(code).match(new RegExp(`const ${name} = (?:and|or)\\([^;]*\\);`));
  assert.ok(matched, `${name} 조건을 찾지 못했다`);
  return matched[0].replace(/approvalRouteDelegations|portalApprovalDelegations/g, "DELEGATIONS");
}

describe("㉤ 끝난 줄을 가르는 자", () => {
  test("🔴 재려는 것이 비어 있지 않다 — 꺼낸 조건이 실제로 내용이 있다", () => {
    for (const name of ["isLive", "isFinished"]) {
      for (const [label, code] of [
        ["승인함 조회", portalQueriesCode],
        ["A/S 조회", asQueriesCode],
      ] as const) {
        const text = conditionText(code, name);
        assert.ok(text.includes("revokedAt"), `${label}의 ${name} 에 revokedAt 이 없다`);
        assert.ok(text.includes("endsAt"), `${label}의 ${name} 에 endsAt 이 없다`);
        assert.ok(text.length > 40, `${label}의 ${name} 이 너무 짧다 — 잘못 꺼냈다`);
      }
    }
  });

  test("🔴 살아 있는 줄의 조건이 **글자 그대로** 같다", () => {
    assert.equal(
      conditionText(portalQueriesCode, "isLive"),
      conditionText(asQueriesCode, "isLive"),
      "두 출처의 「살아 있다」가 갈렸다 — 같은 날짜가 묶음마다 다른 딱지로 보인다"
    );
  });

  test("🔴 끝난 줄의 조건도 같고, 살아 있는 줄의 **정확한 여집합**이다", () => {
    assert.equal(
      conditionText(portalQueriesCode, "isFinished"),
      conditionText(asQueriesCode, "isFinished"),
      "두 출처의 「끝났다」가 갈렸다"
    );
    assert.match(
      conditionText(portalQueriesCode, "isFinished"),
      /or\( isNotNull\(DELEGATIONS\.revokedAt\), lte\(DELEGATIONS\.endsAt, now\) \);/,
      "끝난 줄이 살아 있는 줄의 여집합이 아니다 — 한 줄이 양쪽에서 빠질 수 있다"
    );
  });

  test("🔴 상한을 **빌려 쓴다** — 숫자를 다시 적지 않는다", () => {
    assert.match(
      flat(asQueriesCode),
      /export const FINISHED_DELEGATION_LIMIT = \d+;/,
      "상한이 더 이상 한 곳에 있지 않다"
    );
    assert.match(
      flat(portalQueriesCode),
      /import \{ FINISHED_DELEGATION_LIMIT \} from "\.\/approval-route-delegations";/,
      "승인함 조회가 상한을 빌려 오지 않는다"
    );
    assert.ok(
      !/FINISHED_DELEGATION_LIMIT\s*=/.test(portalQueriesCode),
      "상한을 승인함 조회에 다시 적었다 — 한쪽만 고쳐지는 날이 온다"
    );
    assert.match(
      flat(portalQueriesCode),
      /\.limit\(FINISHED_DELEGATION_LIMIT \+ 1\)/,
      "끝난 줄을 한 건 더 받아 「더 있다」를 세는 자리가 없다"
    );
  });

  test("🔴 「지금」을 한 번 만들어 두 질의에 같은 값으로 넘긴다", () => {
    // 각자 now() 를 쓰면 두 질의 사이에 끝난 줄이 양쪽에서 빠지거나 양쪽에 들어간다.
    assert.match(
      flat(portalQueriesCode),
      /now: Date = new Date\(\)/,
      "「지금」이 조회 바깥에서 한 번 정해지지 않는다"
    );
    assert.equal(
      [...portalQueriesCode.matchAll(/new Date\(\)/g)].length,
      1,
      "조회 안에서 「지금」을 두 번 이상 읽는다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉥ 읽기만 한다 · 보는 사람의 것만                                      */
/* ------------------------------------------------------------------ */

describe("㉥ 포털 표는 읽기 전용이다", () => {
  test("🔴 조회에 쓰는 문장이 하나도 없다", () => {
    for (const forbidden of [".insert(", ".update(", ".delete(", "onConflictDoUpdate"]) {
      assert.ok(
        !portalQueriesCode.includes(forbidden),
        `조회가 포털 표에 쓴다: ${forbidden} — 여기서 적어도 포털은 모른다`
      );
    }
  });

  test("🔴 화면이 포털 표 모듈을 **타입으로만** 가져온다", () => {
    // 값으로 가져오면 `server-only` 사슬이 브라우저 번들에 딸려 간다. 옆 시험의
    // 같은 단언이 `@/lib/db/` 전체를 보지만, 여기서는 이 경로 하나를 글자로 못 박아
    // 「쓰는 함수를 하나 더 가져왔다」가 조용히 지나가지 않게 한다.
    assert.match(
      flat(sectionCode),
      /import type \{ PortalApprovalDelegationsView \} from "@\/lib\/db\/queries\/portal-approval-delegations";/,
      "포털 조회 모듈을 타입으로 가져오는 자리가 달라졌다"
    );
    assert.equal(
      [...sectionCode.matchAll(/queries\/portal-approval-delegations/g)].length,
      1,
      "포털 조회 모듈을 가져오는 자리가 둘 이상이다"
    );
    assert.ok(
      !sectionCode.includes("mutations/portal-approval-delegations"),
      "화면이 포털 표의 쓰기 통로를 가져온다 — 여기서 적어도 포털은 모른다"
    );
    // 쓰는 통로는 A/S 자신의 서버 액션 둘 그대로다.
    assert.match(
      flat(sectionCode),
      /import \{ createApprovalRouteDelegationAction, revokeApprovalRouteDelegationAction, \} from "@\/lib\/server\/actions\/approval-route-delegations";/,
      "서버 액션을 가져오는 자리가 달라졌다"
    );
  });

  test("🔴 보는 사람의 것만 읽는다 — users.id 로 묻는다", () => {
    assert.match(
      flat(pageCode),
      /listPortalApprovalDelegationsForUser\(actingUser\.id\)/,
      "보는 사람의 users.id 로 묻지 않는다 — 포털 번호를 넘기면 오류 없이 영원히 0건이 된다"
    );
    // 🔴 조회가 제 손으로 인가를 보지 않는다. 볼 까닭이 없다 — 내주는 것이 남의
    //    줄이 아니다. 거꾸로 **권한을 묻기 시작하면** 자기 위임이 안 보이는 사람이
    //    생긴다(이 탭은 users.view 없이도 열린다).
    assert.ok(
      !portalQueriesCode.includes("hasPermission("),
      "보는 사람 자신의 줄에 권한을 묻는다 — 자기 위임을 못 보는 사람이 생긴다"
    );
  });

  test("🔴 승인함 조회가 A/S 자신의 표를 건드리지 않는다 — 둘은 다른 표다", () => {
    assert.ok(
      !/from\(approvalRouteDelegations\)/.test(portalQueriesCode),
      "승인함 조회가 A/S 표를 읽는다 — 설계 B-4 는 둘을 따로 둔다"
    );
    assert.match(
      flat(portalQueriesCode),
      /\.from\(portalApprovalDelegations\)/,
      "승인함 조회가 포털 표를 읽지 않는다"
    );
  });

  test("화면으로 나르기만 한다 — 가운데 화면이 값을 고치지 않는다", () => {
    assert.match(
      flat(screenCode),
      /portalDelegations=\{portalDelegations\} approvalsDelegationUrl=\{approvalsDelegationUrl\}/,
      "가운데 화면이 받은 값을 그대로 넘기지 않는다"
    );
  });
});
