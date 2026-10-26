import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalFollowsRoute,
  delegatedFromUserIdFor,
  mayDecideAssignedApproval,
  NO_ROUTE_DELEGATIONS,
  standsInForAssignedApprover,
} from "./approval-assignment";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"];

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";
const THIRD_PARTY = "44444444-4444-4444-8444-444444444444";

function actor(overrides: Partial<{ id: string; role: Role; isDeveloper: boolean }> = {}) {
  return { id: ME, role: "AS_ENGINEER" as Role, isDeveloper: false, ...overrides };
}

/**
 * 🔴 아래 갈래 시험들은 **위임이 없는 상태**를 재는 것이다. 그래서 빈 목록을
 * 그대로 쓰지 않고 뜻이 적힌 상수를 넘긴다 — 위임이 걸리는 자리에서 실수로
 * 빈 목록이 넘어가는 일과 구별되게 하려는 것이고, 그 구별이 곧 이 조각의
 * 주제다(부품 불출은 일부러 비운다).
 */
const NO_DELEGATION = NO_ROUTE_DELEGATIONS;

/** 「SOMEONE_ELSE 의 결재권을 내가 지금 위임받고 있다」는 목록(맨 앞은 언제나 본인). */
const DELEGATED_FROM_SOMEONE_ELSE: readonly string[] = [ME, SOMEONE_ELSE];

describe("mayDecideAssignedApproval — 다섯 갈래", () => {
  test("🔴 지정이 없으면(NULL) 누구에게나 참 — 이 칸이 생기기 전과 같은 동작이다", () => {
    for (const role of ALL_ROLES) {
      assert.equal(
        mayDecideAssignedApproval(null, actor({ role }), NO_DELEGATION),
        true,
        `${role} 이 막히면 안 된다`
      );
    }
  });

  test("지정된 사람 본인은 참", () => {
    assert.equal(mayDecideAssignedApproval(ME, actor(), NO_DELEGATION), true);
  });

  test("지정이 남에게 되어 있으면 거짓", () => {
    assert.equal(mayDecideAssignedApproval(SOMEONE_ELSE, actor(), NO_DELEGATION), false);
  });

  test("최고관리자는 지정이 남에게 되어 있어도 참 — 자리를 비워 영영 막히는 것을 막는 비상구", () => {
    assert.equal(
      mayDecideAssignedApproval(SOMEONE_ELSE, actor({ role: "SUPER_ADMIN" }), NO_DELEGATION),
      true
    );
  });

  test("🔴 그 자리를 위임받고 있으면 참 — 최고관리자가 아니어도 된다", () => {
    // 바로 위 「지정이 남에게 되어 있으면 거짓」과 **같은 인자**에 목록만 다르다.
    // 둘을 나란히 두는 것이 이 조각의 전부다: 넓어진 것은 위임 하나뿐이다.
    assert.equal(
      mayDecideAssignedApproval(SOMEONE_ELSE, actor(), DELEGATED_FROM_SOMEONE_ELSE),
      true
    );
  });

  test("🔴 목록에 없는 남은 여전히 거짓 — 위임이 아무 문이나 열지 않는다", () => {
    // 위임을 하나 받아 두었다고 해서 **다른 사람의** 단계까지 열리면 안 된다.
    assert.equal(
      mayDecideAssignedApproval(THIRD_PARTY, actor(), DELEGATED_FROM_SOMEONE_ELSE),
      false
    );
  });
});

describe("🔴 mayDecideAssignedApproval — 위임 목록은 **필수 인자**다", () => {
  test("인자가 셋이다 — 선택 인자로 되돌리면 여기서 걸린다", () => {
    // 기본값을 두면 빠뜨린 호출부에서만 위임이 조용히 안 걸린다. 오류가 나지
    // 않고 「어떤 화면에서만 대리 결재가 안 된다」가 되며, 그 화면에는 아무
    // 표시도 남지 않는다 — 그래서 선택 인자로 만들지 못하게 길이로 못 박는다
    // (선택 인자는 Function.length 에 세어지지 않는다).
    assert.equal(mayDecideAssignedApproval.length, 3);
  });

  test("🔴 빈 목록은 「위임이 걸리지 않는다」는 뜻이고, 그 이름이 상수에 있다", () => {
    // 부품 불출·검수 승인이 넘기는 값이다. 값이 비어 있다는 것과 **일부러**
    // 비웠다는 것을 코드에서 구별하려고 이름을 붙여 두었다.
    assert.deepEqual([...NO_ROUTE_DELEGATIONS], []);
    assert.equal(mayDecideAssignedApproval(SOMEONE_ELSE, actor(), NO_ROUTE_DELEGATIONS), false);
  });
});

describe("mayDecideAssignedApproval — 개발자 표시", () => {
  test("개발자 표시가 켜진 계정은 역할이 최고관리자가 아니어도 통과한다", () => {
    // 역할 문자열을 직접 비교하면 여기서 조용히 막힌다 — 승격 규칙은
    // developer-promotion.ts 안에만 있고, 그래서 그 함수로만 판정한다.
    assert.equal(
      mayDecideAssignedApproval(
        SOMEONE_ELSE,
        actor({ role: "AS_ENGINEER", isDeveloper: true }),
        NO_DELEGATION
      ),
      true
    );
  });

  test("개발자 표시가 꺼져 있으면 같은 계정이 막힌다 — 대조가 성립한다", () => {
    assert.equal(
      mayDecideAssignedApproval(
        SOMEONE_ELSE,
        actor({ role: "AS_ENGINEER", isDeveloper: false }),
        NO_DELEGATION
      ),
      false
    );
  });
});

describe("mayDecideAssignedApproval — 지정은 권한을 만들지 않는다", () => {
  test("🔴 자격 없는 역할에게 지정돼 있어도 이 함수는 참을 낸다 — 자격은 앞 관문이 본다", () => {
    // 이 함수는 「자격이 있는가」를 보지 않는다(파일 머리말 참조). 영업
    // 담당자에게 지정된 요청은 여기서 참이지만, 그 앞의 자격 검사가 막는다.
    // 이 시험은 그 역할 분담이 뒤집히지 않았다는 것을 못 박는다 — 여기에
    // 자격을 끌어들이는 순간 「지정 = 권한 부여」가 된다.
    const sales = actor({ id: SOMEONE_ELSE, role: "SALES" });
    assert.equal(mayDecideAssignedApproval(SOMEONE_ELSE, sales, NO_DELEGATION), true);
  });

  test("🔴 위임도 자격을 만들지 않는다 — 인자에 역할이 들어오지만 보는 것은 id 뿐이다", () => {
    // 위임받은 사람이 그 결재의 역할·계정 자격까지 얻는 것은 아니다. 그 검사는
    // 여전히 이 함수 **앞**에 있고(mutation 의 requireActor · 역할 목록), 여기서
    // 참이 나온다고 결재가 통과한다는 뜻이 아니다.
    const sales = actor({ role: "SALES" });
    assert.equal(
      mayDecideAssignedApproval(SOMEONE_ELSE, sales, DELEGATED_FROM_SOMEONE_ELSE),
      true
    );
  });
});

describe("delegatedFromUserIdFor — 「누구 자리를 대신 누른 것인가」", () => {
  test("위임으로 눌렀으면 **맡긴 사람**의 id 가 나온다 — 기록의 그 칸에 그대로 들어간다", () => {
    assert.equal(
      delegatedFromUserIdFor(SOMEONE_ELSE, ME, DELEGATED_FROM_SOMEONE_ELSE),
      SOMEONE_ELSE
    );
  });

  test("🔴 내 차례를 내가 누른 것은 위임이 아니다 — null", () => {
    // 위임을 받아 둔 사람이 자기 차례를 누를 때도 목록에는 자기 id 가 들어 있다
    // (맨 앞은 언제나 본인). 여기서 그 id 를 적으면 모든 결재에 「대신 눌렀다」가
    // 붙는다.
    assert.equal(delegatedFromUserIdFor(ME, ME, DELEGATED_FROM_SOMEONE_ELSE), null);
  });

  test("🔴 최고관리자 비상구로 누른 것은 위임이 아니다 — null", () => {
    // 비상구는 위임이 **없을 때** 통하는 길이라 목록에 그 id 가 없다. 둘을 한
    // 칸에 섞으면 「위임받아 눌렀다」와 「막혀 있어 최고관리자가 풀었다」가
    // 기록에서 구별되지 않는다.
    assert.equal(delegatedFromUserIdFor(SOMEONE_ELSE, ME, NO_DELEGATION), null);
  });

  test("지정이 없으면 null — 대신할 자리가 애초에 없다", () => {
    assert.equal(delegatedFromUserIdFor(null, ME, DELEGATED_FROM_SOMEONE_ELSE), null);
  });

  test("🔴 관문이 열리는 길과 **같은 목록**을 본다 — 둘이 갈리면 기록이 비거나 거짓이 된다", () => {
    // 「누를 수 있다」와 「누구 자리였다」가 서로 다른 규칙을 보면, 위임으로
    // 눌렀는데 기록이 비거나(설명 불가) 직접 눌렀는데 남의 이름이 남는다.
    for (const delegations of [NO_DELEGATION, DELEGATED_FROM_SOMEONE_ELSE]) {
      const opened = mayDecideAssignedApproval(SOMEONE_ELSE, actor(), delegations);
      const recorded = delegatedFromUserIdFor(SOMEONE_ELSE, ME, delegations);
      assert.equal(opened, recorded !== null, "관문과 기록이 서로 다른 답을 냈다");
    }
  });
});

const ROUTE = "33333333-3333-4333-8333-333333333333";

describe("approvalFollowsRoute — 판과 지정이 **둘 다** 있어야 결재선이다", () => {
  test("판 + 지정이 함께 있으면 결재선을 탄다", () => {
    assert.equal(approvalFollowsRoute({ routeId: ROUTE, assignedApproverUserId: SOMEONE_ELSE }), true);
  });

  test("🔴 둘 다 없으면 결재선이 아니다 — 이 기능이 생기기 전의 모든 행이 여기다", () => {
    assert.equal(approvalFollowsRoute({ routeId: null, assignedApproverUserId: null }), false);
  });

  test("🔴 판만 적히고 지정이 빈 행은 결재선으로 보지 않는다 — 좁아지는 쪽으로 실패한다", () => {
    // 결재선으로 보면 대표 검사(대표·위임)도 지정 검사도 없어져 자격 있는
    // 사람 아무나 결재하게 된다. 그래서 지금까지의 대표·위임 판정으로 되돌아간다.
    assert.equal(approvalFollowsRoute({ routeId: ROUTE, assignedApproverUserId: null }), false);
  });

  test("지정만 있고 판이 없으면 결재선이 아니다 — 검수 승인의 지정이 그 모양이다", () => {
    // 검수 승인은 요청할 때 「누구에게 보낼까」를 고를 수 있지만 결재선은 아니다
    // (스키마 CHECK 도 route_id 를 최종 출하 승인에만 허용한다).
    assert.equal(approvalFollowsRoute({ routeId: null, assignedApproverUserId: SOMEONE_ELSE }), false);
  });

  test("🔴 행위자를 보지 않는다 — 「누가 결재하는가」는 지정 관문이 따로 본다", () => {
    // 이 함수는 행 모양 하나만 받는다. 사람이 인자에 없다는 것 자체가, 여기에
    // 권한 판정이 섞여 들어갈 자리가 없다는 뜻이다.
    assert.equal(approvalFollowsRoute.length, 1);
  });
});

describe("standsInForAssignedApprover — 지정된 사람 자리에 다른 사람이 서 있는가", () => {
  test("지정된 사람 본인이면 거짓 — 자기 차례에 자기가 처리한 것이다", () => {
    assert.equal(standsInForAssignedApprover(ME, ME), false);
  });

  test("지정이 남에게 되어 있는데 내가 서 있으면 참", () => {
    assert.equal(standsInForAssignedApprover(SOMEONE_ELSE, ME), true);
  });

  test("🔴 지정이 없으면(NULL) 언제나 거짓 — 대신할 자리가 애초에 없다", () => {
    // 이 칸이 생기기 전의 모든 행이 여기다. 여기서 참을 내면 지난 승인 전부에
    // 「지정자 대신 처리」 배지가 붙는다.
    assert.equal(standsInForAssignedApprover(null, ME), false);
    assert.equal(standsInForAssignedApprover(null, null), false);
  });

  test("🔴 아직 처리되지 않은 행도 거짓 — 비교할 사람이 없다", () => {
    // 승인 대기 중인 행은 decidedByUserId 가 NULL 이다. 그때 참을 내면 요청만
    // 해 둔 줄에 「대신 처리」 배지가 뜬다.
    assert.equal(standsInForAssignedApprover(SOMEONE_ELSE, null), false);
  });

  test("🔴 「그래도 되는가」는 보지 않는다 — 역할이 인자에 없다", () => {
    // 대신 설 수 있는지는 mayDecideAssignedApproval 이 따로 판정한다. 이 함수는
    // 사람 둘의 id 만 받는다 — 권한 판정이 섞여 들어갈 자리가 구조적으로 없다.
    assert.equal(standsInForAssignedApprover.length, 2);
  });

  test("🔴 두 판정은 서로를 대신하지 않는다 — 최고관리자가 자기 차례일 때가 갈린다", () => {
    // 최고관리자가 **자기에게 지정된** 요청을 처리하는 흔한 경우. 지정 관문은
    // 참(처리할 수 있다)이지만 대신 서는 것은 아니므로 배지도 안내도 나오면 안
    // 된다. 한쪽 판정으로 두 물음을 답하려 하면 여기서 어긋난다.
    const superAdmin = actor({ role: "SUPER_ADMIN" });
    assert.equal(mayDecideAssignedApproval(ME, superAdmin, NO_DELEGATION), true);
    assert.equal(standsInForAssignedApprover(ME, superAdmin.id), false);

    // 남에게 지정된 요청이면 둘 다 참이다 — 그것이 비상구로 넘어간 건이다.
    assert.equal(mayDecideAssignedApproval(SOMEONE_ELSE, superAdmin, NO_DELEGATION), true);
    assert.equal(standsInForAssignedApprover(SOMEONE_ELSE, superAdmin.id), true);
  });
});
