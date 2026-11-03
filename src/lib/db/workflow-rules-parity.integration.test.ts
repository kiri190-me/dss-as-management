import "../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pgClient } from "./connection";
import { workflowSteps, workflowTemplates, workflowTransitions, workflowVersions } from "./schema";
import { TRANSITION_DEFINITIONS } from "@/lib/domain/local/workflow/transition-definitions";
import { getStepCategory, STEP_CATEGORY_CODES } from "@/lib/domain/local/workflow/step-category";
import { getStepStatus } from "@/lib/domain/local/workflow/step-status-map";
import { WORKFLOW_TYPE_CODES, type WorkflowType } from "@/lib/domain/types";

/**
 * ============================================================================
 * Phase 1 안전망 — DB의 워크플로 규칙이 TypeScript 표와 1:1인지 지킨다
 * ============================================================================
 * Phase 1에서 규칙을 DB로 옮겼지만 런타임은 아직 TS 표를 읽는다. 즉 같은
 * 규칙이 두 곳에 존재하며, 한쪽만 고치면 아무 에러 없이 조용히 갈라진다.
 * 그 상태로 Phase 2(런타임을 DB로 전환)에 들어가면 "왜 갑자기 이 전이가
 * 막히지"를 런타임에서 디버깅하게 된다.
 *
 * 이 파일이 그 갈라짐을 커밋 시점에 잡는다. 읽기 전용이며 아무것도 쓰지
 * 않는다 — 실패하면 둘 중 하나를 고쳐야 한다는 뜻이다:
 *   - TS 표를 고쳤다면 scripts/migrate-workflow-rules-to-db.ts를 다시 실행
 *   - DB를 직접 고쳤다면 그 변경이 의도된 것인지 재확인
 *
 * Phase 2에서 런타임이 DB만 보게 되면 TS 표는 로컬 데모 전용 기본값으로
 * 역할이 바뀌고, 그때 이 테스트의 의미도 함께 재정의해야 한다.
 *
 * 🔴 **분류(category)는 그 재정의가 2026-11-03 에 일어났다.** 런타임이 분류를
 * DB 에서만 읽게 됐고([워크플로 관리]로 사람이 고칠 수 있다), 그래서 아래
 * category 대조는 「운영 DB 가 표와 같아야 한다」가 아니라 「시드가 세우는
 * 초기값이 표와 같아야 한다」로 뜻이 바뀌었다 — 그 시험의 주석에 적어 두었다.
 * 상태(repair_status)와 전이는 아직 그 재정의를 하지 않았다(= 여전히 1:1을
 * 요구한다).
 * ============================================================================
 */

type StepRow = {
  id: string;
  key: string;
  workflowType: string;
  versionId: string;
  repairStatus: string | null;
  category: string | null;
};

let currentSteps: StepRow[] = [];
let allSteps: StepRow[] = [];
let currentTypes = new Set<string>();

before(async () => {
  allSteps = (await db
    .select({
      id: workflowSteps.id,
      key: workflowSteps.key,
      workflowType: workflowTemplates.code,
      versionId: workflowVersions.id,
      repairStatus: workflowSteps.repairStatus,
      category: workflowSteps.category,
      isCurrent: workflowVersions.isCurrent,
    })
    .from(workflowSteps)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowSteps.workflowVersionId))
    .innerJoin(
      workflowTemplates,
      eq(workflowTemplates.id, workflowVersions.workflowTemplateId)
    )) as (StepRow & { isCurrent: boolean })[];

  // 이 서비스가 더 이상 모르는 워크플로는 비교 대상이 아니다.
  //
  // 지금 걸리는 것은 레거시 "MATCHER"(Matcher (기존 이력)) 하나다. 2026-08-19에
  // 도메인 표(transition-definitions.ts 등)에서 없앴지만 DB 행은 지울 수 없다
  // — 그 단계를 가리키는 감사 이력이 남아 있다(db/schema/workflow.ts 주석).
  // 그러니 "DB에는 있는데 표에는 없다"가 여기서는 갈라짐이 아니라 의도된 상태다.
  // 앱의 조회 경로도 같은 기준으로 거른다(queries/workflow-templates.ts).
  allSteps = allSteps.filter((s) => (WORKFLOW_TYPE_CODES as readonly string[]).includes(s.workflowType));

  currentSteps = allSteps.filter((s) => (s as StepRow & { isCurrent: boolean }).isCurrent);
  currentTypes = new Set(currentSteps.map((s) => s.workflowType));
  assert.ok(allSteps.length > 0, "workflow_steps가 비어 있으면 이 테스트는 의미가 없다");
});

after(async () => {
  await pgClient.end({ timeout: 5 });
});

describe("workflow rules parity (DB ↔ transition-definitions.ts)", () => {
  test("모든 단계의 repair_status가 step-status-map.ts와 일치한다", () => {
    const wrong: string[] = [];
    for (const step of allSteps) {
      const expected = getStepStatus(step.workflowType as WorkflowType, step.key) ?? null;
      if (step.repairStatus !== expected) {
        wrong.push(`${step.workflowType}/${step.key}: DB=${step.repairStatus} 표=${expected}`);
      }
    }
    assert.deepEqual(wrong, [], "이관 스크립트를 다시 실행해야 할 수 있다");
  });

  test("repair_status가 비어 있는 단계가 없다", () => {
    // 비어 있으면 그 단계에 놓인 접수 건은 목록·대시보드를 읽을 때마다
    // UnmappedWorkflowStepError로 실패한다 — 화면 하나가 아니라 전체가 깨진다.
    const empty = allSteps.filter((s) => s.repairStatus === null);
    assert.deepEqual(
      empty.map((s) => `${s.workflowType}/${s.key}`),
      []
    );
  });

  /**
   * 🔴 **분류(category)의 정본은 이제 DB 다**(2026-11-03). [워크플로 관리]
   * 화면이 단계마다 담당 분류를 고쳐 새 판으로 게시할 수 있고
   * (mutations/workflow-draft-steps.ts), 런타임은 단추 판정도 서버 거절도
   * 화면의 안내 배너도 전부 DB 값을 읽는다
   * (domain/local/workflow/workflow-action-availability.ts).
   * 개발 DB 의 현행 판 98단계 중 35개가 이미 표와 다르다 — 그러니
   * 「DB 와 표가 언제나 같다」는 **운영에서는 거짓**이고, 이 시험의 이름도
   * 그렇게 읽히면 안 된다.
   *
   * 그래도 대조 자체를 지우지 않는 까닭: 이 파일은 시드로만 세워지는 시험
   * DB 에서 돌고, 거기서 잡아 주던 것은 사람의 편집이 아니라
   * **「step-category.ts 를 고쳐 놓고 시드·이관을 안 돌린 실수」**다. 그 실수는
   * 지금도 그대로 실수다 — 새로 세운 DB 의 **초기값**이 코드와 다르면 신규
   * 접수부터 어긋난 담당으로 돈다. 그래서 단언은 한 글자도 약하게 하지 않고
   * 이름과 까닭만 다시 적는다.
   *
   * 🔴 **여기가 빨개져도 운영 DB 에 이관 스크립트를 돌려서 고치지 마라.**
   * scripts/migrate-workflow-rules-to-db.ts 는 ARCHIVED 를 포함한 **모든 판**의
   * 단계 컬럼을 표 값으로 덮어쓴다(그 파일 머리말) — 사람이 [워크플로 관리]에서
   * 고친 분류가 통째로 사라진다. 고칠 곳은 표나 시드 쪽이다.
   */
  test("시드로 세운 DB 의 category 가 step-category.ts 와 같다 — 표는 **초기값**이고 운영의 정본은 DB 다", () => {
    // 🔵 표본이 비어 공짜로 통과하지 않게 — 분류가 실제로 들어 있는 단계를 센다.
    // 전부 null 인 DB 에서는 `null === null` 만 쌓이고 아무것도 재지 못한다.
    const categorized = allSteps.filter((s) => s.category !== null);
    assert.ok(categorized.length > 0, "분류가 들어 있는 단계가 하나도 없으면 이 대조는 아무것도 재지 않는다");

    const wrong: string[] = [];
    for (const step of allSteps) {
      const expected = getStepCategory(step.workflowType as WorkflowType, step.key) ?? null;
      if (step.category !== expected) {
        wrong.push(`${step.workflowType}/${step.key}: DB=${step.category} 표=${expected}`);
      }
    }
    assert.deepEqual(wrong, [], "시드·이관이 뒤처졌다는 뜻이다 — 운영 DB 를 덮어쓰는 쪽으로 고치지 마라");
  });

  /**
   * 🔵 위의 대조가 시험 DB 안의 이야기라면, 이것은 **어느 DB 에서도** 깨지면 안
   * 되는 약속이다: DB 가 돌려줄 수 있는 분류 값은 TS 가 이름을 아는 값이어야 한다.
   *
   * 화면은 DB 의 분류를 그대로 받아 roleForCategory 로 담당 역할을 뽑고 그 이름을
   * 글자로 찍는다 — DatabaseWorkflowControlPanel 의 「담당: 관리자 또는 …」과,
   * 2026-11-03 부터는 그 밑의 안내 배너까지. 둘 다 더 이상 TS 표를 거치지 않으므로
   * DB 에만 있는 네 번째 분류가 생기면 오류가 나는 것이 아니라 화면에
   * 「관리자 또는 undefined」가 찍힌다. pg enum 과 STEP_CATEGORY_CODES 는 서로 다른
   * 저장소의 파일에서 따로 자라니(enum 은 vendor/dss-core) 맞대어 볼 곳이 여기뿐이다.
   */
  test("DB 의 분류 enum 값 집합이 STEP_CATEGORY_CODES 와 정확히 같다", async () => {
    const labels = await pgClient<{ label: string }[]>`
      select e.enumlabel as label
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'workflow_step_category'
    `;
    // enum 이름을 잘못 적으면 0행이 돌아오고, 빈 배열끼리는 아무것도 재지 못한다.
    assert.ok(labels.length > 0, "workflow_step_category enum 을 읽지 못했다");
    assert.deepEqual(
      labels.map((row) => row.label).sort(),
      [...STEP_CATEGORY_CODES].sort()
    );
  });

  test("current 버전의 전이가 표와 개수·내용 모두 1:1이다", async () => {
    const allDbRows = await db
      .select({
        workflowType: workflowTemplates.code,
        actionCode: workflowTransitions.actionCode,
        fromStepId: workflowTransitions.fromStepId,
        toStepId: workflowTransitions.toStepId,
        allowedRoles: workflowTransitions.allowedRoles,
        requiresAssignedEngineer: workflowTransitions.requiresAssignedEngineer,
        requiresReason: workflowTransitions.requiresReason,
        requiredApprovalType: workflowTransitions.requiredApprovalType,
      })
      .from(workflowTransitions)
      .innerJoin(workflowVersions, eq(workflowVersions.id, workflowTransitions.workflowVersionId))
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId));

    // 단계와 같은 기준으로 거른다(위 before 블록 주석) — 서비스가 더 이상
    // 모르는 워크플로의 전이는 표에도 없는 것이 맞다.
    const dbRows = allDbRows.filter((r) => (WORKFLOW_TYPE_CODES as readonly string[]).includes(r.workflowType));

    // current 버전이 없는 워크플로의 표 행은
    // 애초에 이관 대상이 아니다 — 그쪽에는 신규 접수가 배정되지 않는다.
    const expected = TRANSITION_DEFINITIONS.filter((d) => currentTypes.has(d.workflowType));
    assert.equal(dbRows.length, expected.length, "행 수가 다르면 이관이 뒤처졌거나 DB에 군더더기가 있다");

    const stepIdToKey = new Map(allSteps.map((s) => [s.id, s.key]));
    const dbByKey = new Map(
      dbRows.map((r) => [`${r.workflowType}::${r.actionCode}::${stepIdToKey.get(r.fromStepId)}`, r])
    );

    const problems: string[] = [];
    for (const d of expected) {
      const key = `${d.workflowType}::${d.actionCode}::${d.fromStepKey}`;
      const row = dbByKey.get(key);
      if (!row) {
        problems.push(`${key} — DB에 없음`);
        continue;
      }
      if (stepIdToKey.get(row.toStepId) !== d.toStepKey) {
        problems.push(`${key} — 도착 단계 DB=${stepIdToKey.get(row.toStepId)} 표=${d.toStepKey}`);
      }
      const dbRoles = [...row.allowedRoles].sort().join(",");
      const tsRoles = [...d.allowedRoles].sort().join(",");
      if (dbRoles !== tsRoles) problems.push(`${key} — 허용 역할 DB=[${dbRoles}] 표=[${tsRoles}]`);
      if (row.requiresAssignedEngineer !== d.requiresAssignedEngineer) {
        problems.push(`${key} — 담당자 필수 DB=${row.requiresAssignedEngineer} 표=${d.requiresAssignedEngineer}`);
      }
      if (row.requiresReason !== d.requiresReason) {
        problems.push(`${key} — 사유 필수 DB=${row.requiresReason} 표=${d.requiresReason}`);
      }
      if ((row.requiredApprovalType ?? null) !== (d.requiredApprovalType ?? null)) {
        problems.push(`${key} — 승인 종류 DB=${row.requiredApprovalType} 표=${d.requiredApprovalType}`);
      }
    }
    assert.deepEqual(problems.slice(0, 20), [], `불일치 ${problems.length}건`);
  });

  /**
   * 0117(2026-10-18) — 출하 완료를 누를 수 있는 역할에 담당 엔지니어와 영업을
   * 더했다. 위의 1:1 대조는 **표에 있는 워크플로의 current 판**만 본다. 반면
   * 마이그레이션은 판의 상태와 무관하게 모든 줄을 고치는데, 진행 중인 수리건이
   * 접수 당시의 옛 판을 끝까지 쓰기 때문이다. 그래서 그쪽 범위는 여기서 따로
   * 못 박는다 — 워크플로 종류도 판 상태도 가리지 않고 action_code 로만 고른다.
   */
  test("출하 완료 전이는 판의 상태와 무관하게 전부 담당 엔지니어·영업을 포함한다", async () => {
    const rows = await db
      .select({
        id: workflowTransitions.id,
        allowedRoles: workflowTransitions.allowedRoles,
      })
      .from(workflowTransitions)
      .where(eq(workflowTransitions.actionCode, "SHIPMENT_COMPLETED"));

    assert.ok(rows.length > 0, "출하 완료 전이가 하나도 없으면 이 시험은 의미가 없다");

    const missing = rows
      .filter(
        (row) => !row.allowedRoles.includes("AS_ENGINEER") || !row.allowedRoles.includes("SALES")
      )
      .map((row) => `${row.id}: [${row.allowedRoles.join(", ")}]`);
    assert.deepEqual(missing, [], "0117 마이그레이션이 적용되지 않았거나 일부 줄을 건너뛰었다");

    // 더하기만 했는지 — 관리자 셋과 재고 담당이 사라지지 않았다.
    const lost = rows
      .filter(
        (row) => !row.allowedRoles.includes("SUPER_ADMIN") || !row.allowedRoles.includes("ADMIN")
      )
      .map((row) => `${row.id}: [${row.allowedRoles.join(", ")}]`);
    assert.deepEqual(lost, []);

    // 같은 역할이 두 번 들어가면 역할 검사는 통과하지만 화면의 역할 목록에
    // 같은 이름이 두 번 뜬다.
    const duplicated = rows
      .filter((row) => new Set(row.allowedRoles).size !== row.allowedRoles.length)
      .map((row) => `${row.id}: [${row.allowedRoles.join(", ")}]`);
    assert.deepEqual(duplicated, []);
  });

  test("전이의 출발·도착 단계가 모두 같은 워크플로 버전에 속한다", async () => {
    // FK만으로는 "다른 버전의 단계를 가리키는 전이"를 막지 못한다. 그런 행이
    // 생기면 접수 건이 자기 워크플로 밖의 단계로 이동해 버린다.
    const crossVersion = await db
      .select({ id: workflowTransitions.id })
      .from(workflowTransitions)
      .innerJoin(workflowSteps, eq(workflowSteps.id, workflowTransitions.fromStepId))
      .where(eq(workflowSteps.workflowVersionId, workflowTransitions.workflowVersionId));
    const total = await db.select({ id: workflowTransitions.id }).from(workflowTransitions);
    assert.equal(crossVersion.length, total.length, "from_step이 다른 버전에 속한 전이가 있다");
  });
});
