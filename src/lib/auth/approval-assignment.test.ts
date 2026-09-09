import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mayDecideAssignedApproval } from "./approval-assignment";
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
