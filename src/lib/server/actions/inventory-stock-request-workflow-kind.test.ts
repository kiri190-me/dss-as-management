import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORKFLOW_KIND_CODES, workflowKindOf } from "@/lib/domain/workflow-kind";

/**
 * ============================================================================
 * 🔴 부품을 요청할 때 **그 수리 건의 종류**가 함께 나가는가 (2026-10-22)
 * ============================================================================
 * 재고 관리가 승인 절차를 **매쳐용·제너레이터용**으로 갈랐다. 어느 쪽을 붙일지는 A/S
 * **수리 건의 종류**가 정하므로, 올릴 때 그 값을 함께 싣는다.
 *
 * 이 파일이 재는 것 넷 —
 *  ㉠ **종류를 어디서 읽는가.** `repair_cases` 에는 칸이 없다. `workflow_versions` →
 *     `workflow_templates.code` 를 지나야 나오고, 셋으로 접는 일은 도메인의
 *     `workflowKindOf` 하나가 한다. 🔴 그 규칙을 여기저기 다시 적으면 언젠가 갈린다.
 *  ㉡ 🔴 **왕복이 늘지 않았는가.** 조인을 더하는 대신 조회를 하나 더 두면 신청 한 번에
 *     질의가 둘이 된다. 그래서 그 함수 안의 질의를 **세어 본다.**
 *  ㉢ **서버가 제 손으로 읽은 값인가.** 화면이 적어 보낸 종류를 실어 주면 제 건의 승인
 *     절차를 골라 올릴 수 있다 — 인수번호를 믿지 않는 것과 같은 까닭이다.
 *  ㉣ 🔴 **수리 건을 못 읽었으면 보내지 않는다.** 그 길에서는 올리는 통로를 아예 부르지
 *     않는다(「모르는데 보내는」 길이 없다).
 *
 * 🔴 이 파일은 **원본 글자**를 읽는다 — `"use server"` 액션과 DB 조회는 이 환경에서 불러
 * 볼 수 없다(이웃 `inventory-stock-requests-source.test.ts` 와 같은 사정). 본문에 실제로
 * 무엇이 담기는지는 `lib/server/inventory-gateway.test.ts` 가 **진짜로 불러** 잰다.
 * ============================================================================
 */

const QUERY_PATH = "src/lib/db/queries/repair-cases.ts";
const ACTION_PATH = "src/lib/server/actions/inventory-stock-requests.ts";
const querySource = readFileSync(QUERY_PATH, "utf8");
const actionSource = readFileSync(ACTION_PATH, "utf8");

/**
 * 🔴 **잘라 낸 토막이 비어 있으면 아래 단언이 전부 거짓말을 한다**(없는 글자를 안 찾았다고
 * 통과한다). 그래서 자르는 자리마다 길이를 함께 잰다.
 */
function sliceBetween(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `시작 표식을 못 찾았다: ${from}`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `끝 표식을 못 찾았다: ${to}`);
  const cut = source.slice(start, end);
  assert.ok(cut.length > 0, "잘라 낸 토막이 비어 있다");
  return cut;
}

/** 인수번호·종류를 한 번에 읽는 조회 하나. */
const query = sliceBetween(
  querySource,
  "export async function getIntakeAndWorkflowKindForRepairCase",
  "export type RepairCaseEditGuard"
);
/** 올리는 액션만 떼어 본다 — 거두는 액션의 같은 모양과 섞이지 않게. */
const createAction = sliceBetween(
  actionSource,
  "export async function createInventoryStockRequestAction",
  "export type CancelStockRequestActionResult"
);

describe("㉠ 종류는 이미 있는 조인·이미 있는 함수로 읽는다", () => {
  test("`workflow_versions` → `workflow_templates` 조인 둘을 **그 질의에** 붙였다", () => {
    assert.match(
      query,
      /\.innerJoin\(workflowVersions, eq\(repairCases\.workflowVersionId, workflowVersions\.id\)\)/
    );
    assert.match(
      query,
      /\.innerJoin\(workflowTemplates, eq\(workflowVersions\.workflowTemplateId, workflowTemplates\.id\)\)/
    );
  });

  test("템플릿 코드는 **공용 도우미**로 읽는다 — 새로 짓지 않았다", () => {
    assert.match(query, /workflowTypeCode: workflowTypeCodeColumn\(\)/);
  });

  test("🔴 셋으로 접는 규칙을 **다시 적지 않았다** — 도메인의 그 함수를 부른다", () => {
    assert.match(query, /workflowKind: workflowKindOf\(row\.workflowTypeCode\)/);
    assert.doesNotMatch(query, /endsWith|_MATCHER|_TOTAL_CONTROLLER|PART_ISSUE/);
  });

  test("지워진 건은 그대로 `null` 이다 — 휴지통 건으로 신청을 세우지 않는다", () => {
    assert.match(query, /eq\(repairCases\.isDeleted, false\)/);
    assert.match(query, /if \(!row\) return null;/);
  });

  test("🔴 보내는 글자는 **종류 셋** 그대로다 — 저쪽 절차 이름이 아니다", () => {
    assert.deepEqual([...WORKFLOW_KIND_CODES], ["MATCHER", "GENERATOR", "TOTAL_CONTROLLER"]);
    // 🔵 실제 템플릿 코드가 그 셋으로 접힌다(유·무상이 앞에 붙어도 꼬리가 정한다).
    assert.equal(workflowKindOf("PAID_MATCHER"), "MATCHER");
    assert.equal(workflowKindOf("WARRANTY_GENERATOR"), "GENERATOR");
    assert.equal(workflowKindOf("PENDING_TOTAL_CONTROLLER"), "TOTAL_CONTROLLER");
  });
});

describe("㉡ 🔴 왕복이 늘지 않았다", () => {
  test("그 조회 안의 질의는 **하나**다 — 조인을 더했지 조회를 더하지 않았다", () => {
    assert.equal((query.match(/await db/g) ?? []).length, 1, "질의가 둘 이상이다");
    assert.equal((query.match(/\.select\(/g) ?? []).length, 1, "select 가 둘 이상이다");
  });

  test("올리는 액션이 수리 건을 읽는 자리도 **하나**다", () => {
    assert.equal(
      (createAction.match(/getIntakeAndWorkflowKindForRepairCase\(/g) ?? []).length,
      1,
      "같은 건을 두 번 읽고 있다"
    );
    // 🔴 종류만 따로 묻는 조회를 새로 끌어다 쓰지 않았다.
    assert.doesNotMatch(actionSource, /getWorkflowKind|getRepairCaseById|workflow-kind"/);
  });
});

describe("㉢ 종류는 **서버가 읽은 값**이다 — 화면 값을 믿지 않는다", () => {
  test("읽어 온 건에서 꺼내 그대로 통로에 싣는다", () => {
    assert.match(
      createAction,
      /const repairCase = await getIntakeAndWorkflowKindForRepairCase\(input\.repairCaseId\);/
    );
    assert.match(createAction, /workflowKind: repairCase\.workflowKind,/);
    assert.match(createAction, /intakeNumber: repairCase\.intakeNumber,/);
  });

  test("🔴 화면이 보낸 종류를 싣는 길이 없다 — 받는 칸 자체가 없다", () => {
    const signature = createAction.slice(0, createAction.indexOf("): Promise<"));
    assert.ok(signature.length > 0);
    assert.doesNotMatch(signature, /workflowKind|workflowType|kind/i, "화면이 보낸 종류를 받고 있다");
    assert.doesNotMatch(createAction, /workflowKind: input\./);
  });
});

describe("㉣ 🔴 수리 건을 못 읽었으면 보내지 않는다", () => {
  test("건이 없으면 **올리는 통로를 부르기 전에** 돌아간다", () => {
    const guard = createAction.indexOf("if (!repairCase) {");
    const call = createAction.indexOf("return createInventoryStockRequest({");
    assert.ok(guard >= 0, "건을 못 읽은 길을 가리는 자리가 없다");
    assert.ok(call > guard, "건을 확인하기 전에 올리러 간다");
    assert.match(createAction.slice(guard, call), /message: CASE_NOT_FOUND/);
  });

  test("🔴 「모름」을 `null` 이나 빈 글자로 **지어내지 않는다**", () => {
    // 모르는 길에서는 아예 돌아가므로(위 시험) 보낼 값을 꾸밀 자리가 없어야 한다.
    assert.doesNotMatch(createAction, /workflowKind: null|workflowKind: ""|workflowKind: undefined/);
  });
});
