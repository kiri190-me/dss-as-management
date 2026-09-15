import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 화면마다 저장 뒤 어떤 팝업을 띄우고 어디로 넘기는지 붙잡는다(2026-09-15 사용자 요청).
 *
 * 규칙: 목록에 올라가는 건 자체를 등록·수정하면 팝업 뒤 **그 목록으로** 넘긴다.
 * 이미 목록 위이거나(창) 한 건 안에 딸린 것을 붙이는 곳은 **팝업만** 띄우고 머문다 —
 * 담당자를 셋 붙이려고 매번 목록에서 다시 찾아 들어가게 하지 않으려는 것이다.
 *
 * 브라우저 없이 볼 수 있는 것은 소스뿐이라 부르는 모양을 읽는다. 각 항목은
 * [문구 식, 넘어갈 곳 식] 이고 파일 안에 적힌 순서다. 문구를 앞에서 변수로
 * 만들어 `{ message, … }` 로 넘긴 곳은 문구 식이 "message" 로 읽힌다.
 */
function popupCalls(path: string): [string, string][] {
  const source = readFileSync(path, "utf8");
  return [
    ...source.matchAll(/showSavePopup\(\{\s*message(?::\s*([^,]+?))?,\s*redirectTo:\s*([^}]+?),?\s*\}\)/g),
  ].map((match) => [match[1] ?? "message", match[2]]);
}

test("고객사 — 정보 수정은 목록으로 넘기고, 추가 창은 목록 위라 머문다", () => {
  assert.deepEqual(popupCalls("src/components/customers/CustomerEditForm.tsx"), [
    ['"고객사 정보를 저장했습니다."', '"/customers"'],
  ]);
  const create = readFileSync("src/components/customers/CustomerCreateForm.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/customers/CustomerCreateForm.tsx"), [
    ["`고객사를 등록했습니다 (${name.trim()})`", "null"],
  ]);
  // 그 전에는 새 고객사의 상세 화면으로 갔다.
  assert.doesNotMatch(create, /router\.push\(/);
  assert.match(create, /onClose\(\);\s*router\.refresh\(\);\s*showSavePopup\(/);
});

test("고객사 안의 End-User·담당자는 팝업만 띄우고 머문다", () => {
  assert.deepEqual(popupCalls("src/components/customers/EndUserManagementSection.tsx"), [
    ['"End-User를 추가했습니다."', "null"],
    ['"End-User 이름을 바꿨습니다."', "null"],
  ]);
  for (const path of [
    "src/components/customers/CustomerContactList.tsx",
    "src/components/customers/EndUserContactList.tsx",
  ]) {
    assert.deepEqual(
      popupCalls(path),
      [
        ['"담당자 정보를 저장했습니다."', "null"],
        ['"담당자를 추가했습니다."', "null"],
      ],
      path
    );
  }
});

test("제품 모델 — 정보 수정은 목록으로, 파일 올리기는 머문다", () => {
  assert.deepEqual(popupCalls("src/components/product-models/ProductModelEditForm.tsx"), [
    ['"제품 모델 정보를 저장했습니다."', '"/product-models"'],
  ]);
  const files = readFileSync("src/components/product-models/ProductModelFilesSection.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/product-models/ProductModelFilesSection.tsx"), [
    ["`${uploaded}건을 올렸습니다.`", "null"],
  ]);
  // 몇 건이 빠진 경우는 무엇이 빠졌는지 읽어야 하므로 화면에 남는다.
  assert.match(files, /건은 빠졌습니다 — /);
});

test("견적서 — 만들기도 고치기도 왔던 목록으로 넘어간다", () => {
  const form = readFileSync("src/components/quotes/QuoteEditForm.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/quotes/QuoteEditForm.tsx"), [
    ['"견적서를 저장했습니다."', 'returnHref ?? "/quotes"'],
    ['"견적서를 등록했습니다."', 'returnHref ?? "/quotes"'],
  ]);
  // 그 전에는 새 장의 수정 화면으로 갔다.
  assert.doesNotMatch(form, /router\.push\(returnHref \?\? `\/quotes\/\$\{result\.id\}`\)/);
  // 🔴 넘기기 전에 단추를 되살리면 두 번 눌러 견적서가 두 장 생긴다.
  assert.equal(form.match(/leaving = true;\s*showSavePopup\(/g)?.length, 2);
});

test("A/S 상세의 섹션·칸 저장은 전체 A/S 현황으로 넘어간다 — 훅 한 곳에서", () => {
  const hook = readFileSync("src/components/repair-cases/detail/edit/useSectionEditSubmit.ts", "utf8");
  assert.match(
    hook,
    /REPAIR_CASE_SAVED_POPUP: SavePopupRequest = \{\s*message: "A\/S 정보를 저장했습니다\.",\s*redirectTo: "\/repair-cases",\s*\}/
  );
  assert.match(hook, /params\.onDone\(\);\s*if \(params\.savedPopup\) showSavePopup\(params\.savedPopup\);/);
  // 빠뜨리면 타입이 막도록 필수다 — 새로 부르는 곳이 정하고 가야 한다.
  assert.match(hook, /savedPopup: SavePopupRequest \| null;/);
  for (const name of [
    "IntakeInfoEditForm.tsx",
    "ProductInfoEditForm.tsx",
    "FaultServiceEditForm.tsx",
    "EngineerEditCell.tsx",
    "ReportNumberEditCell.tsx",
  ]) {
    const source = readFileSync(`src/components/repair-cases/detail/edit/${name}`, "utf8");
    assert.match(source, /savedPopup: REPAIR_CASE_SAVED_POPUP,/, name);
  }
});

test("같은 훅을 쓰는 주간보고 비고 칸은 표에 머문다", () => {
  const cell = readFileSync("src/components/dashboard/WeeklyReportNotesCell.tsx", "utf8");
  assert.match(cell, /savedPopup: \{ message: "비고를 저장했습니다\.", redirectTo: null \},/);
});

test("서비스 보고서는 저장하면 「보고서」 탭으로 넘어간다", () => {
  const form = readFileSync("src/components/repair-cases/report/service-report/ServiceReportForm.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/repair-cases/report/service-report/ServiceReportForm.tsx"), [
    ['saved ? "보고서를 저장했습니다." : "새 보고서를 저장했습니다."', "reportHref"],
  ]);
  // 떠날 화면에서 주소를 바꾸면 이동과 다툰다.
  assert.doesNotMatch(form, /router\.replace\(`\$\{pathname\}\?id=/);
});

test("A/S 건 안에 딸린 것·실행 동작은 팝업만 띄우고 머문다", () => {
  const stayOnly: [string, number][] = [
    ["src/components/inventory/PartRequestSection.tsx", 1],
    ["src/components/repair-cases/detail/PendingBillingDecisionCard.tsx", 1],
    ["src/components/repair-cases/workflow/ManualStepSetPanel.tsx", 1],
    ["src/components/repair-cases/workflow/DatabaseWorkflowControlPanel.tsx", 2],
    ["src/components/repair-cases/work-records/WorkRecordForm.tsx", 1],
    ["src/components/procedures/execution/ExecutionExtraTaskForm.tsx", 1],
    ["src/components/procedures/execution/ExecutionNodeCard.tsx", 1],
    ["src/components/repair-cases/files/FilesScreen.tsx", 4],
    ["src/components/repair-cases/approval/DatabaseRepairInspectionCard.tsx", 1],
    ["src/components/repair-cases/approval/DatabaseFinalShipmentCard.tsx", 1],
  ];
  for (const [path, count] of stayOnly) {
    const calls = popupCalls(path);
    assert.equal(calls.length, count, path);
    assert.ok(
      calls.every(([, redirectTo]) => redirectTo === "null"),
      path
    );
  }
});

test("고객 안내 현황·수리 의뢰는 목록 화면이라 팝업만 띄우고 머문다", () => {
  const portal = readFileSync("src/components/customer-portal/CustomerPortalScreen.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/customer-portal/CustomerPortalScreen.tsx"), [["result.message", "null"]]);
  // 거절 이유만 화면에 남는다.
  assert.match(portal, /if \(!result\.ok\) \{\s*setMessage\(\{ ok: false, text: result\.message \}\);\s*return;\s*\}/);
  const requests = readFileSync("src/components/customer-portal/CustomerRequestListScreen.tsx", "utf8");
  assert.match(requests, /onDone=\{\(text\) => showSavePopup\(\{ message: text, redirectTo: null \}\)\}/);
});

test("진단 Flowchart·초안을 만들면 그릴 차례라 편집 화면으로 넘어간다 — 팝업이 넘긴다", () => {
  const cases: [string, RegExp][] = [
    [
      "src/components/repair-cases/flowchart/CaseFlowchartListScreen.tsx",
      /message: "진단 Flowchart를 만들었습니다\.",\s*redirectTo: `\/repair-cases\/\$\{repairCaseId\}\/diagnosis\/\$\{result\.id\}`,/,
    ],
    [
      "src/components/diagnosis-flowcharts/DiagnosisFlowchartManagementScreen.tsx",
      /message: "진단 Flowchart를 만들었습니다\.",\s*redirectTo: `\/repair-cases\/\$\{repairCaseId\}\/diagnosis\/\$\{result\.id\}`,/,
    ],
    [
      "src/components/repair-cases/flowchart/SaveWorkRecordFlowchartButton.tsx",
      /message: "작업 기록 흐름도를 저장했습니다\.",\s*redirectTo: `\/repair-cases\/\$\{repairCaseId\}\/diagnosis\/\$\{result\.flowchartId\}`,/,
    ],
    [
      "src/components/workflows/WorkflowDraftEntry.tsx",
      /message: "새 초안을 만들었습니다\.",\s*redirectTo: `\/workflows\/\$\{templateCode\}\/draft`,/,
    ],
  ];
  for (const [path, pattern] of cases) {
    const source = readFileSync(path, "utf8");
    assert.match(source, pattern, path);
  }
  for (const path of [
    "src/components/repair-cases/flowchart/CaseFlowchartListScreen.tsx",
    "src/components/repair-cases/flowchart/SaveWorkRecordFlowchartButton.tsx",
    "src/components/workflows/WorkflowDraftEntry.tsx",
  ]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /router\.push\(/, path);
  }
});

test("워크플로 발행·폐기는 도착 화면이 이미 알리므로 팝업을 더하지 않는다", () => {
  const editor = readFileSync("src/components/workflows/WorkflowDraftEditor.tsx", "utf8");
  assert.match(editor, /navigateTo: `\/workflows\/\$\{templateCode\}\?done=published`/);
  assert.doesNotMatch(editor, /showSavePopup/);
  const page = readFileSync("src/app/(app)/workflows/[code]/page.tsx", "utf8");
  assert.match(page, /DONE_MESSAGES\[done\]/);
});

test("승인 카드는 성공 문구를 팝업으로 옮기고, 거절 이유만 카드에 남긴다", () => {
  for (const name of ["DatabaseRepairInspectionCard.tsx", "DatabaseFinalShipmentCard.tsx"]) {
    const source = readFileSync(`src/components/repair-cases/approval/${name}`, "utf8");
    assert.doesNotMatch(source, /setStatusMessage\(dialogState === "REQUEST"/, name);
    assert.match(source, /setStatusMessage\(null\);\s*showSavePopup\(/, name);
  }
});
