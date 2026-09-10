import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalFollowsRoute,
  mayDecideAssignedApproval,
  standsInForAssignedApprover,
} from "./approval-assignment";
import type { Role } from "@/lib/domain/types";

const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES", "INVENTORY_MANAGER"];

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

function actor(overrides: Partial<{ id: string; role: Role; isDeveloper: boolean }> = {}) {
  return { id: ME, role: "AS_ENGINEER" as Role, isDeveloper: false, ...overrides };
}

describe("mayDecideAssignedApproval — 네 갈래", () => {
  test("🔴 지정이 없으면(NULL) 누구에게나 참 — 이 칸이 생기기 전과 같은 동작이다", () => {
    for (const role of ALL_ROLES) {
      assert.equal(mayDecideAssignedApproval(null, actor({ role })), true, `${role} 이 막히면 안 된다`);
    }
  });

  test("지정된 사람 본인은 참", () => {
    assert.equal(mayDecideAssignedApproval(ME, actor()), true);
  });

  test("지정이 남에게 되어 있으면 거짓", () => {
    assert.equal(mayDecideAssignedApproval(SOMEONE_ELSE, actor()), false);
  });

  test("최고관리자는 지정이 남에게 되어 있어도 참 — 자리를 비워 영영 막히는 것을 막는 비상구", () => {
    assert.equal(mayDecideAssignedApproval(SOMEONE_ELSE, actor({ role: "SUPER_ADMIN" })), true);
  });
});

describe("mayDecideAssignedApproval — 개발자 표시", () => {
  test("개발자 표시가 켜진 계정은 역할이 최고관리자가 아니어도 통과한다", () => {
    // 역할 문자열을 직접 비교하면 여기서 조용히 막힌다 — 승격 규칙은
    // developer-promotion.ts 안에만 있고, 그래서 그 함수로만 판정한다.
    assert.equal(
      mayDecideAssignedApproval(SOMEONE_ELSE, actor({ role: "AS_ENGINEER", isDeveloper: true })),
      true
    );
  });

  test("개발자 표시가 꺼져 있으면 같은 계정이 막힌다 — 대조가 성립한다", () => {
    assert.equal(
      mayDecideAssignedApproval(SOMEONE_ELSE, actor({ role: "AS_ENGINEER", isDeveloper: false })),
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
    assert.equal(mayDecideAssignedApproval(SOMEONE_ELSE, sales), true);
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
    assert.equal(mayDecideAssignedApproval(ME, superAdmin), true);
    assert.equal(standsInForAssignedApprover(ME, superAdmin.id), false);

    // 남에게 지정된 요청이면 둘 다 참이다 — 그것이 비상구로 넘어간 건이다.
    assert.equal(mayDecideAssignedApproval(SOMEONE_ELSE, superAdmin), true);
    assert.equal(standsInForAssignedApprover(SOMEONE_ELSE, superAdmin.id), true);
  });
});
