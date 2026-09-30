import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * "기존 건을 현재 버전으로 적용" 단추의 화면 쪽(2026-09-30).
 *
 * 🔴 되돌리기가 없는 단추다 — 수십 건의 접수 건이 한 번에 다른 판으로 옮겨간다.
 * 그래서 못박는 것이 "눌리는가"가 아니라 **눌리면 안 될 때 안 눌리는가**다:
 * 권한이 없으면 아예 안 그려지는가 · 옮길 것이 0건이면 못 누르는가 · 확인 창을
 * 반드시 거치는가 · 화면이 제 손으로 건수를 세지 않는가.
 *
 * 화면을 통째로 그려 볼 수 없어(서버 컴포넌트 + server-only + 서버 액션) 원본을
 * 글자로 읽는다 — 그런 시험이 모여 있는 목록이 components 다.
 *
 * 서버 쪽 같은 판정(권한·이관 조건·감사 로그)은
 * db/mutations/workflow-drafts.integration.test.ts 가 DB 를 상대로 본다.
 */

const BUTTON = readFileSync(
  join(process.cwd(), "src/components/workflows/WorkflowApplyCurrentVersion.tsx"),
  "utf8"
);
const PAGE = readFileSync(join(process.cwd(), "src/app/(app)/workflows/[code]/page.tsx"), "utf8");
const MUTATION = readFileSync(join(process.cwd(), "src/lib/db/mutations/workflow-drafts.ts"), "utf8");
const QUERY = readFileSync(join(process.cwd(), "src/lib/db/queries/workflow-templates.ts"), "utf8");

test("🔴 권한이 없으면 단추가 아예 안 그려진다 — 그리고 서버가 같은 권한을 다시 묻는다", () => {
  assert.match(
    PAGE,
    /const mayPublish = await hasPermission\(actingUser, "workflows\.publish", "MANAGE"\)/,
    "화면은 발행과 같은 권한으로 판정한다"
  );
  assert.match(
    PAGE,
    /\{mayPublish && currentVersion && detail\.inFlightCases && \(/,
    "권한·현재 버전·미리 보기 수가 모두 있을 때만 그린다"
  );
  // 🔴 화면에서 감추는 것만으로는 막은 것이 아니다. 액션을 직접 불러도 막혀야 한다.
  assert.match(
    MUTATION,
    /hasPermission\(actor, "workflows\.publish", "MANAGE"\)[\s\S]{0,400}?워크플로를 발행할 권한이 없습니다[\s\S]{0,4000}?applyCurrentWorkflowVersionToCases|applyCurrentWorkflowVersionToCases[\s\S]{0,600}?hasPermission\(actor, "workflows\.publish", "MANAGE"\)/,
    "적용 mutation 도 workflows.publish MANAGE 를 스스로 판정해야 한다"
  );
});

test("🔴 현재 발행 버전이 없으면 단추 자리가 없다 — 옮길 목적지가 없다", () => {
  // 조회가 null 을 돌려주는 자리와, 화면이 그 null 을 그대로 쓰는 자리 둘 다 본다.
  assert.match(QUERY, /const inFlightCases = current\s*\?\s*await countInFlightCasesForVersion\(/);
  assert.match(QUERY, /:\s*null;/);
  assert.match(PAGE, /detail\.inFlightCases &&/);
});

test("단추에 건수가 적힌다 — 누르기 전에 규모를 안다", () => {
  assert.match(BUTTON, /진행 중인 \$\{migratableCaseCount\}건을 현재 버전으로 적용/);
});

test("🔴 옮길 것이 0건이면 못 누르고, 까닭을 한 줄로 말한다", () => {
  assert.match(BUTTON, /const hasCasesToMove = migratableCaseCount > 0;/);
  assert.match(BUTTON, /disabled=\{isPending \|\| !hasCasesToMove\}/);
  assert.match(BUTTON, /옮길 건이 없습니다/);
});

test("갈 곳 없는 건이 있으면 그 수도 보인다", () => {
  assert.match(BUTTON, /\{strandedCaseCount > 0 && \(/);
  assert.match(BUTTON, /\{strandedCaseCount\}건은 옮기지 못하고 이전 버전에 남습니다/);
});

test("🔴 누르면 곧바로 옮기지 않는다 — 확인 창을 거친다", () => {
  // 단추는 창을 열 뿐이고, 실제 실행은 창 안의 "적용"이 한다.
  assert.match(BUTTON, /onClick=\{\(\) => setIsConfirming\(true\)\}/);
  assert.doesNotMatch(
    BUTTON,
    /onClick=\{apply\}[\s\S]{0,200}적용 중\.\.\." : "적용"\}[\s\S]*?onClick=\{\(\) => setIsConfirming\(true\)\}/,
    "단추가 확인 창을 건너뛰면 안 된다"
  );
  // 이 앱의 다른 확인 창과 같은 네이티브 dialog 방식(WorkflowDraftConfirmDialog).
  assert.match(BUTTON, /dialog\.showModal\(\)/);
  assert.match(BUTTON, /onClick=\{apply\}/);
});

test("🔴 화면이 건수를 제 손으로 세지 않는다 — 옮기기와 같은 함수가 센다", () => {
  // 조회는 조건을 베껴 적지 않고 mutation 쪽 함수를 부른다.
  assert.match(QUERY, /import \{ countInFlightCasesForVersion \} from "\.\.\/mutations\/workflow-drafts";/);
  // 🔴 이관 조건은 저장소 전체에서 이 한 줄뿐이어야 한다.
  assert.equal(
    (MUTATION.match(/ne\(workflowSteps\.repairStatus, "SHIPMENT_COMPLETED"\)/g) ?? []).length,
    1,
    "출하 완료 제외 조건이 두 곳에 있으면 언젠가 하나만 고쳐진다"
  );
  assert.equal(
    (QUERY.match(/ne\(workflowSteps\.repairStatus, "SHIPMENT_COMPLETED"\)/g) ?? []).length,
    0,
    "조회가 조건을 베껴 적으면 미리 보기 수와 실제 옮긴 수가 갈라진다"
  );
  // 세는 쪽과 옮기는 쪽이 같은 계획 함수를 지난다.
  assert.match(
    MUTATION,
    /countInFlightCasesForVersion[\s\S]{0,600}?planInFlightCaseMigration\(db, \{ \.\.\.params, lockForUpdate: false \}\)/
  );
  assert.match(
    MUTATION,
    /migrateInFlightCasesToVersion[\s\S]{0,600}?planInFlightCaseMigration\(tx, \{/
  );
});
