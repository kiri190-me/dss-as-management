import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canEditWorkflowTemplates,
  canPublishWorkflowTemplates,
  canViewWorkflowTemplates,
} from "./workflow-template-authorization";
import { ROLE_CODES } from "@/lib/domain/types";

const ALLOWED = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

test("조회·편집·발행 모두 엔지니어 이상만 허용한다", () => {
  for (const role of ROLE_CODES) {
    const expected = (ALLOWED as readonly string[]).includes(role);
    assert.equal(canViewWorkflowTemplates(role), expected, `view/${role}`);
    assert.equal(canEditWorkflowTemplates(role), expected, `edit/${role}`);
    assert.equal(canPublishWorkflowTemplates(role), expected, `publish/${role}`);
  }
});

test("영업·재고 담당자는 어떤 경로로도 접근할 수 없다", () => {
  // 규칙 자체를 바꾸는 화면이라 담당 구간 진행 권한과는 별개로 막는다.
  for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
    assert.equal(canViewWorkflowTemplates(role), false);
    assert.equal(canEditWorkflowTemplates(role), false);
    assert.equal(canPublishWorkflowTemplates(role), false);
  }
});

test("세 술어가 모두 같은 역할 집합을 쓴다 (현재 정책)", () => {
  // 편집과 발행을 나누자는 제안은 검토했으나 사용자가 엔지니어도 발행 가능하게
  // 결정했다. 나중에 정책이 갈리면 이 테스트가 먼저 실패하므로, 그때
  // 의도적인 변경인지 확인하고 함께 고치게 된다.
  for (const role of ROLE_CODES) {
    assert.equal(canViewWorkflowTemplates(role), canEditWorkflowTemplates(role), role);
    assert.equal(canEditWorkflowTemplates(role), canPublishWorkflowTemplates(role), role);
  }
});
