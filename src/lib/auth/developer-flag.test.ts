import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE_CODES, roleLabels, type Role } from "@/lib/domain/types";
import { PERMISSION_LEAF_KEYS } from "./permission-features";
import { PERMISSION_AREAS } from "./permission-areas";
import {
  REQUEST_ELIGIBLE_ROLES,
  INSPECTION_DECIDE_ELIGIBLE_ROLES,
  isRequestEligible,
  isInspectionDecideEligible,
  resolveShipmentAuthorization,
  type ActingUser,
} from "@/lib/domain/local/approval/transitions";

/**
 * ============================================================================
 * 「A/S 엔지니어인데 개발자」 — 역할은 그대로다
 * ============================================================================
 * users.is_developer 가 켜지면 **권한 판정만** 최고관리자와 같아진다
 * (permission-resolver.ts). 역할 자체는 손대지 않는다 — 역할을 갈아치우는
 * 방식으로 구현하면 그 사람이 엔지니어 명단에서 사라지고 배정에서 빠진다.
 *
 * 여기 있는 시험들은 DB 를 타지 않는 쪽만 지킨다. 실효 권한이 실제로
 * 최고관리자와 같아지는지는 developer-permissions.integration.test.ts 가 본다
 * (해석기가 role_permissions 표를 읽으므로 DB 가 필요하다).
 * ============================================================================
 */

function engineer(overrides: Partial<ActingUser> = {}): ActingUser {
  return {
    id: "u-eng",
    name: "엔지니어 개발자",
    role: "AS_ENGINEER",
    approvalStatus: "APPROVED",
    isDeveloper: false,
    ...overrides,
  };
}

test("개발자여도 진짜 역할은 A/S 엔지니어 그대로다 — 이름표까지", () => {
  const dev = engineer({ isDeveloper: true });

  assert.equal(dev.role, "AS_ENGINEER");
  assert.equal(roleLabels[dev.role], "A/S 엔지니어");
});

test("개발자 표시는 배정·자격 판정을 하나도 바꾸지 않는다", () => {
  const plain = engineer();
  const dev = engineer({ isDeveloper: true });

  // 부품 요청·검수 자격은 역할 목록으로만 갈린다.
  assert.equal(isRequestEligible(dev), isRequestEligible(plain));
  assert.equal(isInspectionDecideEligible(dev), isInspectionDecideEligible(plain));

  // 자격 목록 자체가 역할 코드만 담는다 — 개발자라는 항목이 끼어들 자리가 없다.
  for (const role of [...REQUEST_ELIGIBLE_ROLES, ...INSPECTION_DECIDE_ELIGIBLE_ROLES]) {
    assert.ok((ROLE_CODES as readonly string[]).includes(role), `${role} 은 역할 코드가 아니다`);
  }
});

test("개발자여도 출하 대리인이 되지는 않는다 — 대표는 ID 로만 정해진다", () => {
  // 출하 승인은 역할이 아니라 명시적 대표 ID/위임으로만 열린다. 권한 승격이
  // 여기까지 번지면 「최고관리자와 동급」이 대표 제도를 통째로 무력화한다.
  const dev = engineer({ isDeveloper: true });
  assert.deepEqual(resolveShipmentAuthorization(dev, [], "2026-09-07T00:00:00Z"), { allowed: false });
});

test("개발자는 역할이 아니다 — ROLE_CODES 에 없다", () => {
  assert.ok(!(ROLE_CODES as readonly string[]).includes("DEVELOPER"));
  assert.equal(ROLE_CODES.length, 5);

  // 역할 이름표에도 없다(화면에 「개발자」라는 역할이 뜨면 안 된다).
  for (const role of ROLE_CODES) {
    assert.equal(typeof roleLabels[role as Role], "string");
  }
  assert.equal(Object.keys(roleLabels).length, 5);
});

test("개발자 표시는 역할별 권한 설정으로 켤 수 없다 — 설정 단위에 존재하지 않는다", () => {
  // 설정 화면이 다루는 단위는 영역 키와 잎 키뿐이다. 사람 단위 칸인
  // is_developer 는 어느 쪽으로도 표현되지 않으므로, 관리자가 권한 설정에서
  // 자기 자신을 개발자로 만들 방법이 없다.
  for (const key of PERMISSION_LEAF_KEYS) {
    assert.ok(!/developer/i.test(key), `잎 키에 개발자 항목이 생겼다: ${key}`);
  }
  for (const area of PERMISSION_AREAS) {
    assert.ok(!/developer/i.test(area.key), `영역 키에 개발자 항목이 생겼다: ${area.key}`);
  }
});
