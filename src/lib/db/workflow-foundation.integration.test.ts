import "../../../scripts/load-env";

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db, pgClient } from "./connection";
import { workflowSteps, workflowTemplates, workflowVersions } from "./schema";
import type { WorkflowType } from "@/lib/domain/types";

const expectedSteps: Record<WorkflowType, number> = {
  PAID_MATCHER: 19,
  WARRANTY_MATCHER: 19,
  PAID_GENERATOR: 16,
  WARRANTY_GENERATOR: 10,
  PAID_TOTAL_CONTROLLER: 16,
  WARRANTY_TOTAL_CONTROLLER: 10,
  PENDING_MATCHER: 2,
  PENDING_GENERATOR: 2,
  PENDING_TOTAL_CONTROLLER: 2,
};

// 서식 개수는 위 표에서 세어 온다 — 종류를 지웠는데 숫자만 남아
// 테스트가 깨진 적이 있다 (레거시 MATCHER 철거, db90ac3).
const expectedTemplateCount = Object.keys(expectedSteps).length;

after(async () => {
  await pgClient.end({ timeout: 5 });
});

describe("partial-paid and pending workflow database foundation", () => {
  test("keeps one persisted template per workflow type with an independent current published version", async () => {
    const rows = await db
      .select({ code: workflowTemplates.code, templateId: workflowTemplates.id, versionId: workflowVersions.id })
      .from(workflowTemplates)
      .innerJoin(
        workflowVersions,
        and(
          eq(workflowVersions.workflowTemplateId, workflowTemplates.id),
          eq(workflowVersions.status, "PUBLISHED"),
          eq(workflowVersions.isCurrent, true)
        )
      );
    assert.equal(rows.length, expectedTemplateCount);
    assert.equal(new Set(rows.map((row) => row.templateId)).size, expectedTemplateCount);
    assert.equal(new Set(rows.map((row) => row.versionId)).size, expectedTemplateCount);
  });

  test("materializes the approved independent step snapshots", async () => {
    for (const [code, count] of Object.entries(expectedSteps) as [WorkflowType, number][]) {
      const rows = await db
        .select({ id: workflowSteps.id, key: workflowSteps.key })
        .from(workflowSteps)
        .innerJoin(workflowVersions, eq(workflowSteps.workflowVersionId, workflowVersions.id))
        .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
        .where(
          and(
            eq(workflowTemplates.code, code),
            eq(workflowVersions.status, "PUBLISHED"),
            eq(workflowVersions.isCurrent, true)
          )
        );
      assert.equal(rows.length, count, code);
      assert.equal(new Set(rows.map((row) => row.id)).size, count, `${code} step IDs`);
      assert.ok(rows.some((row) => row.key === "intake_inspection"), `${code} initial step`);
    }
  });
});
