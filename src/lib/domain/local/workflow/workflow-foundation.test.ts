import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { workflowSteps } from "../../mock-data";
import type { WorkflowType } from "../../types";
import { TRANSITION_DEFINITIONS } from "./transition-definitions";

// 2026-08-19: 원래 기준(source)은 레거시 "MATCHER"였고 유상/무상 Matcher가 그
// 스냅샷과 같은지를 봤다. 그 워크플로가 없어지면서 기준을 PAID_MATCHER로 옮겼다
// — 짝이 하나 줄었을 뿐, "둘은 같은 구성이되 서로 다른 행"이라는 검사 내용은
// 그대로다.
const pairs = [
  ["PAID_MATCHER", "WARRANTY_MATCHER"],
  ["PAID_GENERATOR", "PAID_TOTAL_CONTROLLER"],
  ["WARRANTY_GENERATOR", "WARRANTY_TOTAL_CONTROLLER"],
] as const satisfies readonly (readonly [WorkflowType, WorkflowType])[];

function comparable<T extends { workflowType: WorkflowType }>(rows: readonly T[], type: WorkflowType) {
  return rows.filter((row) => row.workflowType === type).map((row) => {
    const copy: Partial<T> = { ...row };
    delete copy.workflowType;
    return copy;
  });
}

describe("independent workflow foundation snapshots", () => {
  for (const [source, target] of pairs) {
    test(`${target} steps equal the approved ${source} snapshot`, () => {
      assert.deepEqual(comparable(workflowSteps, target), comparable(workflowSteps, source));
      const sourceRows = workflowSteps.filter((row) => row.workflowType === source);
      const targetRows = workflowSteps.filter((row) => row.workflowType === target);
      assert.notStrictEqual(sourceRows, targetRows);
      assert.ok(sourceRows.every((row, index) => row !== targetRows[index]));
    });

    test(`${target} transitions and approval gates equal ${source} with independent IDs`, () => {
      const stripIdentity = (type: WorkflowType) => TRANSITION_DEFINITIONS
        .filter((row) => row.workflowType === type)
        .map((row) => {
          const copy: Partial<typeof row> = { ...row };
          delete copy.id;
          delete copy.workflowType;
          return copy;
        });
      assert.deepEqual(stripIdentity(target), stripIdentity(source));
      const sourceRows = TRANSITION_DEFINITIONS.filter((row) => row.workflowType === source);
      const targetRows = TRANSITION_DEFINITIONS.filter((row) => row.workflowType === target);
      assert.equal(new Set([...sourceRows, ...targetRows].map((row) => row.id)).size, sourceRows.length + targetRows.length);
      assert.ok(sourceRows.every((row, index) => row !== targetRows[index]));
    });
  }

  /**
   * --------------------------------------------------------------------------
   * 🔴 출하 완료를 누를 수 있는 역할 — 2026-10-18 결정
   * --------------------------------------------------------------------------
   * 담당 엔지니어(AS_ENGINEER)와 영업(SALES)을 더했다. 내자 정리의 완료 처리가
   * 수리건을 출하 완료로 넘기는데 그 화면을 쓰는 사람이 이 둘이기 때문이고,
   * 같은 규칙을 수리건 화면의 [출하 완료] 단추도 읽으므로 그 단추도 함께
   * 열린다(의도된 부수 효과).
   *
   * 여기서 못 박는 것은 셋이다 — 둘이 들어 있다 · 원래 있던 INVENTORY_MANAGER가
   * 사라지지 않았다 · 같은 역할이 두 번 들어가지 않았다. 셋째가 필요한 까닭은
   * 역할 검사 자체는 중복을 통과시키지만 화면의 역할 목록에 같은 이름이 두 번
   * 뜨기 때문이다. DB 쪽 같은 불변식은
   * src/lib/db/workflow-rules-parity.integration.test.ts 가 지킨다.
   * --------------------------------------------------------------------------
   */
  describe("출하 완료 전이의 허용 역할", () => {
    const shipments = TRANSITION_DEFINITIONS.filter(
      (row) => row.actionCode === "SHIPMENT_COMPLETED"
    );

    test("출하 완료 전이는 워크플로 6종에 하나씩 있다", () => {
      assert.equal(shipments.length, 6, "출하 완료 전이 수가 달라졌다 — 아래 시험의 전제가 흔들린다");
      assert.deepEqual(
        [...new Set(shipments.map((row) => row.workflowType))].sort(),
        [
          "PAID_GENERATOR",
          "PAID_MATCHER",
          "PAID_TOTAL_CONTROLLER",
          "WARRANTY_GENERATOR",
          "WARRANTY_MATCHER",
          "WARRANTY_TOTAL_CONTROLLER",
        ]
      );
    });

    test("전부 담당 엔지니어와 영업을 포함한다", () => {
      const missing = shipments
        .filter(
          (row) =>
            !row.allowedRoles.includes("AS_ENGINEER") || !row.allowedRoles.includes("SALES")
        )
        .map((row) => `${row.id}: [${row.allowedRoles.join(", ")}]`);
      assert.deepEqual(missing, []);
    });

    test("원래 있던 역할은 하나도 사라지지 않았다 — INVENTORY_MANAGER 포함", () => {
      const lost = shipments
        .filter(
          (row) =>
            !row.allowedRoles.includes("SUPER_ADMIN") ||
            !row.allowedRoles.includes("ADMIN") ||
            !row.allowedRoles.includes("INVENTORY_MANAGER")
        )
        .map((row) => `${row.id}: [${row.allowedRoles.join(", ")}]`);
      assert.deepEqual(lost, []);
    });

    test("같은 역할이 두 번 들어간 행이 없다", () => {
      const duplicated = shipments
        .filter((row) => new Set(row.allowedRoles).size !== row.allowedRoles.length)
        .map((row) => `${row.id}: [${row.allowedRoles.join(", ")}]`);
      assert.deepEqual(duplicated, []);
    });
  });

  test("pending workflows expose only the two intake steps and no progress transitions", () => {
    for (const workflowType of ["PENDING_MATCHER", "PENDING_GENERATOR", "PENDING_TOTAL_CONTROLLER"] as const) {
      assert.deepEqual(
        workflowSteps.filter((row) => row.workflowType === workflowType).map((row) => row.key),
        ["product_intake", "intake_inspection"]
      );
      assert.deepEqual(
        TRANSITION_DEFINITIONS.filter((row) => row.workflowType === workflowType),
        []
      );
    }
  });
});
