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
 * 그 뒤 「상세를 열어 칸을 잇달아 고치는」 화면들은 사용자 요청으로 머무는 쪽으로
 * 옮겨 왔다 — 부품 상세(2026-09-17) · A/S 건 상세(2026-10-06). 문구는 그대로 두고
 * 넘어갈 곳만 null 로 바꾸되, 머무는 화면은 저장 뒤 router.refresh() 로 값을 다시
 * 읽어야 한다(목록으로 넘어갈 때 공짜로 얻던 갱신이 사라지기 때문이다).
 *
 * 브라우저 없이 볼 수 있는 것은 소스뿐이라 부르는 모양을 읽는다 — 읽는 방법과
 * 그 방법을 쓰는 까닭은 아래 popupCalls() 머리말에 있다.
 */
/**
 * 문자열(`"` `'` `` ` ``)과 주석(`//` `/* *\/`)을 통째로 건너뛴다. 그 안의 중괄호·쉼표는
 * 코드가 아니므로 세면 안 된다. 건너뛴 뒤 자리를 돌려주고, 건너뛸 것이 아니면 null.
 * 템플릿 문자열의 `${ … }` 안은 다시 코드라 중괄호 짝을 맞춰 끝을 찾는다.
 */
function skipAtomic(text: string, i: number): number | null {
  const ch = text[i];
  if (ch === '"' || ch === "'") {
    for (let j = i + 1; j < text.length; j += 1) {
      if (text[j] === "\\") {
        j += 1;
        continue;
      }
      if (text[j] === ch) return j + 1;
    }
    return text.length;
  }
  if (ch === "`") {
    for (let j = i + 1; j < text.length; j += 1) {
      if (text[j] === "\\") {
        j += 1;
        continue;
      }
      if (text[j] === "`") return j + 1;
      if (text[j] === "$" && text[j + 1] === "{") {
        let depth = 1;
        let k = j + 2;
        while (k < text.length && depth > 0) {
          const next = skipAtomic(text, k);
          if (next !== null) {
            k = next;
            continue;
          }
          if (text[k] === "{") depth += 1;
          else if (text[k] === "}") depth -= 1;
          k += 1;
        }
        j = k - 1;
      }
    }
    return text.length;
  }
  if (ch === "/" && text[i + 1] === "/") {
    const nl = text.indexOf("\n", i);
    return nl < 0 ? text.length : nl;
  }
  if (ch === "/" && text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return null;
}

/** 여는 `{` 바로 뒤에서 시작해 짝이 맞는 `}` 자리를 돌려준다. 못 찾으면 -1. */
function objectEnd(text: string, start: number): number {
  let depth = 1;
  for (let i = start; i < text.length; i += 1) {
    const next = skipAtomic(text, i);
    if (next !== null) {
      i = next - 1;
      continue;
    }
    const ch = text[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 객체 속을 **깊이 0 의 쉼표로만** 나눈다 — 문구 안의 쉼표(`"완료로 표시하고, …"`)와
 * 중첩된 호출·객체 안의 쉼표는 칸 경계가 아니다. 몇 줄에 걸친 식은 줄바꿈만 한 칸으로
 * 접는다(한 줄짜리는 글자 그대로 남는다).
 */
function topLevelFields(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i += 1) {
    const next = skipAtomic(body, i);
    if (next !== null) {
      i = next - 1;
      continue;
    }
    const ch = body[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(body.slice(from));
  return parts.map((part) => part.replace(/\s*\n\s*/g, " ").trim()).filter((part) => part.length > 0);
}

/**
 * 화면 소스에서 `showSavePopup({ … })` 호출을 뽑는다. 각 항목은 [문구 식, 넘어갈 곳 식]
 * 이고 파일에 적힌 순서다. 문구를 앞에서 변수로 만들어 `{ message, … }` 로 넘긴 곳은
 * 문구 식이 "message" 로 읽힌다.
 *
 * 🔴 2026-10-18 이전에는 정규식 한 줄로 읽었다:
 *   `showSavePopup\(\{\s*message(?::\s*([^,]+?))?,\s*redirectTo:\s*([^}]+?),?\s*\}\)`
 * 이 방식은 두 자리에서 깨진다. 문구에 쉼표가 들어가거나 삼항으로 갈리면
 * (`result.x ? "완료로 표시하고, 연결된 수리 건도 …" : "완료로 표시했습니다."`)
 * `[^,]+?` 가 문구를 가로지르지 못하고, 넘어갈 곳이 템플릿 문자열이면
 * (`` `/workflows/${templateCode}/draft` ``) `[^}]+?` 가 `${…}` 의 `}` 에 걸려 멈춘다.
 * 둘 중 하나만 걸려도 **그 호출은 통째로 안 잡힌다.**
 *
 * 🔵 가장 나쁜 점은 터지지 않는다는 것이다 — 시험은 그대로 통과하면서 **검사 범위만
 * 조용히 줄어든다.** 실제로 그랬다: 진단 Flowchart·초안 화면 넷은 넘어갈 곳이 템플릿이라
 * 오래전부터 0개로 읽히고 있었고, DomesticOrderListScreen 의 호출 셋 중 둘은 2026-10-18 에
 * 문구가 쉼표 든 삼항으로 바뀌면서 세어지지 않게 됐다(기대값과 어긋나 터져서야 드러났다).
 *
 * 그래서 정규식으로 속을 가르지 않는다. `showSavePopup({` 를 찾은 뒤 **괄호 짝을 세어**
 * 객체 덩어리를 통째로 잘라내고, 그 안에서 깊이 0 의 쉼표로 칸을 나눠 집는다.
 * 짝이 안 맞거나 `redirectTo` 가 없으면 조용히 빠지지 않도록 **던진다** — 이 시험이
 * 재려는 것이 바로 그 `redirectTo` 값(머무는가 · 넘어가는가)이기 때문이다.
 * 문구는 거드는 값이라 글자를 기대값에 박지 않는다.
 */
function popupCalls(path: string): [string, string][] {
  const source = readFileSync(path, "utf8");
  const opener = /showSavePopup\(\s*\{/g;
  const calls: [string, string][] = [];
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = objectEnd(source, bodyStart);
    assert.ok(bodyEnd >= 0, `${path}: showSavePopup({ 의 짝이 맞는 } 를 못 찾았다`);
    opener.lastIndex = bodyEnd;
    const fields = new Map<string, string>();
    for (const field of topLevelFields(source.slice(bodyStart, bodyEnd))) {
      const colon = field.indexOf(":");
      if (colon < 0) fields.set(field, field);
      else fields.set(field.slice(0, colon).trim(), field.slice(colon + 1).trim());
    }
    const redirectTo = fields.get("redirectTo");
    assert.ok(redirectTo !== undefined, `${path}: redirectTo 가 없는 showSavePopup 호출이 있다`);
    calls.push([fields.get("message") ?? "message", redirectTo]);
  }
  return calls;
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

test("A/S 상세의 섹션·칸 저장은 팝업만 띄우고 그 상세에 머문다 — 훅 한 곳에서", () => {
  const hook = readFileSync("src/components/repair-cases/detail/edit/useSectionEditSubmit.ts", "utf8");
  // 2026-09-15 에는 저장하면 전체 A/S 현황(/repair-cases)으로 넘어갔다.
  // 2026-10-06 사용자 요청으로 「확인 팝업만 뜨고 현재 화면에 그대로」로 되돌렸다 —
  // 한 건을 열어 담당 엔지니어 따위를 잇달아 고치는데 한 칸마다 목록으로 튕겼기
  // 때문이다. 바꾼 것은 넘어갈 곳뿐이고 문구는 그대로다.
  assert.match(
    hook,
    /REPAIR_CASE_SAVED_POPUP: SavePopupRequest = \{\s*message: "A\/S 정보를 저장했습니다\.",\s*redirectTo: null,\s*\}/
  );
  assert.doesNotMatch(hook, /redirectTo: "\/repair-cases"/);
  // 🔴 넘어가면 서버가 목록을 다시 그려 값이 갱신됐다. 그 자리에 남으면 그 갱신이
  // 사라지므로, **저장이 성공한 경로에서**(실패·충돌은 그 위에서 return 한다) 화면을
  // 다시 읽어야 한다 — 안 그러면 고친 값이 안 보여 저장이 안 된 것처럼 보이고,
  // 묵은 version 이 그대로라 이어지는 저장이 충돌로 막힌다.
  assert.match(
    hook,
    /if \(!result\.ok\) \{[\s\S]*?\}\s*router\.refresh\(\);\s*params\.onDone\(\);\s*if \(params\.savedPopup\) showSavePopup\(params\.savedPopup\);/
  );
  // 빠뜨리면 타입이 막도록 필수다 — 새로 부르는 곳이 정하고 가야 한다.
  assert.match(hook, /savedPopup: SavePopupRequest \| null;/);
  // 다섯 곳(접수 정보 · 제품 정보 · 고장/서비스 · 담당 엔지니어 · 보고서 번호)이
  // 자기 모양을 적지 않고 **같은 상수**를 쓴다 — 그래서 위 한 줄만 고치면 다섯이 다
  // 따라온다. 한 곳이라도 제 모양을 적으면 그 칸만 동작이 어긋난다.
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

test("서비스 보고서는 저장해도 휴지통에 보내도 「보고서」 탭으로 넘어간다", () => {
  const form = readFileSync("src/components/repair-cases/report/service-report/ServiceReportForm.tsx", "utf8");
  // 🔴 **차례까지 못 박는다** — 저장이 먼저, 지우기가 뒤다. 둘 다 같은 곳으로
  //    넘기지만 하는 말이 달라야 한다. 한쪽 문구를 다른 쪽에 베껴 넣으면 여기서 걸린다.
  assert.deepEqual(popupCalls("src/components/repair-cases/report/service-report/ServiceReportForm.tsx"), [
    ['saved ? "보고서를 저장했습니다." : "새 보고서를 저장했습니다."', "reportHref"],
    // 🔵 2026-10-28 에 생겼다. 전에는 말없이 목록으로 갔다 — 창이 닫히고 화면만 바뀌어서
    //    지운 것이 맞는지 확인할 자리가 없었다(사용자 요청).
    ['"휴지통으로 이동되었습니다."', "reportHref"],
  ]);
  // 떠날 화면에서 주소를 바꾸면 이동과 다툰다.
  assert.doesNotMatch(form, /router\.replace\(`\$\{pathname\}\?id=/);
  // 🔴 지우기가 성공한 뒤에도 그렇다 — 팝업이 넘기는데 여기서 또 밀면 둘이 다툰다.
  //    `confirmDelete` 안에 replace·refresh 가 **다시 들어오면** 이 줄이 잡는다.
  //    (NOT_FOUND 갈래의 replace 는 그대로 산다 — 거기는 팝업을 안 띄운다.)
  const afterDelete = form.slice(form.indexOf("async function confirmDelete"));
  const deleteBody = afterDelete.slice(0, afterDelete.indexOf("\n  }"));
  assert.ok(deleteBody.length > 0, "confirmDelete 를 못 찾았다 — 이름이 바뀌었나");
  assert.equal(
    (deleteBody.match(/router\.refresh\(\)/g) ?? []).length,
    1,
    "confirmDelete 의 router.refresh 는 NOT_FOUND 갈래 하나뿐이어야 한다"
  );
});

test("A/S 건 안에 딸린 것·실행 동작은 팝업만 띄우고 머문다", () => {
  const stayOnly: [string, number][] = [
    // 부품 요청은 **올리기**와 **거두기**와 **고객사 품명 채우기** 셋이라 팝업도 셋이다
    // (2026-10-16 에 「요청 취소」와 「고객사 품명 채우기」가 차례로 더해졌다). 셋 다 성공한
    // 경로에서만 뜬다 — 거절(ok 아님)은 그 창·칸에 저쪽 문구를 그대로 적고, 「이미 올라가
    // 있었다 · 이미 거둬져 있었다 · 이미 적혀 있었다」는 **오류가 아니라 읽어야 하는 알림**이라
    // NoticePopup 으로 간다(저절로 닫히는 저장 팝업으로 보내면 못 읽고 지나간다).
    // 🔵 2026-10-27 에 `components/inventory/` 에서 수리 건 상세 폴더로 옮겼다 — 이 칸은 옛
    //    재고 표가 아니라 재고 관리 시스템의 통로를 쓰고, 그리는 자리도 수리 건 상세 하나다.
    ["src/components/repair-cases/detail/PartRequestSection.tsx", 3],
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

test("고객 안내 현황은 목록 화면이라 팝업만 띄우고 머문다", () => {
  // 「고객이 보낸 수리 의뢰」 화면은 2026-10-04 에 전용 주소 기능과 함께
  // 걷혔다(고객이 의뢰를 넣을 길이 없어졌다) — 그 화면의 단언도 함께 사라졌다.
  const portal = readFileSync("src/components/customer-portal/CustomerPortalScreen.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/customer-portal/CustomerPortalScreen.tsx"), [["result.message", "null"]]);
  // 🔴 거절은 **사람이 닫는 팝업**으로 간다(2026-10-07, 한 번에 저장으로 바뀌면서).
  // 저장이 여러 줄을 한꺼번에 다루게 되어 거절 글이 「어느 줄이 왜 막혔는가」로
  // 길어졌다 — 0.5초 뒤 사라지는 저장 팝업으로는 읽을 수 없다(NoticePopup.tsx 머리말).
  assert.match(
    portal,
    /if \(!result\.ok\) \{[\s\S]{0,400}?setFailure\(\{[\s\S]{0,200}?lines: buildFailureLines\(result, editedRows\),[\s\S]{0,40}?\}\);\s*return;\s*\}/
  );
  assert.match(portal, /<NoticePopup/);
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
  // 폐기는 여전히 글자 그대로의 주소다.
  assert.match(editor, /navigateTo: `\/workflows\/\$\{templateCode\}\?done=discarded`/);
  // 🔴 발행만 주소를 함수가 만든다 — 옮긴 건수·남은 건수를 실어야 하기 때문이다.
  //    주소를 짓는 규칙(`?done=published` 포함)은 그 함수 하나가 가진다:
  //    src/lib/domain/workflow-publish-counts-param.test.ts 가 값으로 본다.
  assert.match(editor, /navigateTo: \(result\) =>\s*workflowPublishDoneHref\(templateCode, \{/);
  assert.doesNotMatch(editor, /showSavePopup/);
  const page = readFileSync("src/app/(app)/workflows/[code]/page.tsx", "utf8");
  assert.match(page, /DONE_MESSAGES\[done\]/);
});

/**
 * 🔴 2026-10-27 — **옛 재고 화면 열둘의 절이 여기서 사라졌다.**
 *
 * 「부품 상세에서 부품·재고를 바꿔도 …」 한 절(부품 수정·입고·사용·반환·한계수량 다섯)과
 * 「불출 승인 화면은 … 팝업을 더하지 않는다」 한 절이 통째로 빠졌고, 아래 절에서는 일곱 줄
 * (부품 등록·불출·보류·반려·부분 마감·요청 관리·O/H 템플릿)이 빠졌다.
 *
 * **단언을 약하게 만든 것이 아니라 잴 대상이 없어졌다** — 재고 기능은 재고 관리 시스템
 * (dss-inventory)으로 옮겨 갔고, 그날 `src/components/inventory/` 의 옛 화면과
 * `src/app/(app)/inventory/` 의 경로 다섯이 지워졌다. 되살릴 일이 생기면 그 커밋에서
 * 꺼내고, 이 절들도 함께 돌아와야 한다.
 *
 * 🔵 **부품 요청 칸만은 남았다** — 위 「A/S 건 안에 딸린 것」 절의
 * `repair-cases/detail/PartRequestSection.tsx` 가 그것이다. 옛 재고 표가 아니라 재고 관리의
 * 통로를 쓰는 **새 코드**라 지우지 않고 수리 건 상세 폴더로 옮겼다.
 */
test("내자·주간보고·작업 비용은 팝업만 띄우고 머문다", () => {
  const stayOnly: [string, number][] = [
    ["src/components/domestic-orders/DomesticOrderEditForm.tsx", 1],
    ["src/components/domestic-orders/DomesticOrderTextCell.tsx", 1],
    ["src/components/domestic-orders/DomesticOrderDueDatesCell.tsx", 1],
    // 머리말 저장 · 완료 표시 · 완료 표시 풀기 셋이다(2026-10-18 에 뒤의 둘이 「연결된
    // 수리 건도 함께 처리했는가」로 문구가 갈리면서 쉼표가 들어왔다 — 그 둘을 옛 읽개가
    // 못 읽어 이 시험이 터졌다. 자세한 것은 popupCalls() 머리말).
    ["src/components/domestic-orders/DomesticOrderListScreen.tsx", 3],
    ["src/components/dashboard/WeeklyReportGoalsPanel.tsx", 3],
    ["src/components/dashboard/WeeklyReportDeliveriesPanel.tsx", 2],
    ["src/components/repair-labor/RepairLaborScreen.tsx", 1],
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

test("주간보고 가져오기 — 건너뛴 건수는 팝업으로 지나치기 쉬워 화면에도 남는다", () => {
  const goals = readFileSync("src/components/dashboard/WeeklyReportGoalsPanel.tsx", "utf8");
  assert.match(goals, /setCopyMessage\(result\.skipped > 0 \? \{ ok: true, text: copiedText \} : null\);/);
});

test("설정 화면은 성공 문구를 팝업으로 옮기고 그 자리에 머문다", () => {
  const stayOnly: [string, number][] = [
    ["src/components/settings/IntakeMailSettingsScreen.tsx", 2],
    ["src/components/settings/MainColorPicker.tsx", 1],
    ["src/components/settings/ThemeTemplatePicker.tsx", 1],
    ["src/components/settings/ThemeTokenEditor.tsx", 1],
    ["src/components/settings/UiTextEditor.tsx", 1],
    // 알림 설정 화면은 2026-09-22 에 통합 로그인 포털로 떠나 이 저장소에서
    // 사라졌다(자료와 저장 통로는 그대로 남아 있다).
    ["src/components/users/RolePermissionSettings.tsx", 1],
    ["src/components/users/DeveloperFlagSection.tsx", 1],
    ["src/components/users/RepresentativeListSection.tsx", 1],
    ["src/components/users/DelegationSection.tsx", 1],
    // 2026-10-26 에 들어온 「결재권 위임」 탭도 같은 규칙이다 — 성공만 팝업으로
    // 알리고 그 자리에 머문다(router.refresh() 로 목록을 다시 읽는다). 거절 사유와
    // 되돌리기 결과는 **읽어야 하는 글**이라 화면에 남는다(아래 시험).
    ["src/components/users/ApprovalRouteDelegationSection.tsx", 1],
    ["src/components/users/ShipmentApprovalRouteSection.tsx", 1],
    ["src/components/customer-portal/CustomerStatusOptionSettings.tsx", 1],
  ];
  for (const [path, count] of stayOnly) {
    const calls = popupCalls(path);
    assert.equal(calls.length, count, path);
    assert.ok(
      calls.every(([, redirectTo]) => redirectTo === "null"),
      path
    );
  }
  // 성공 문구를 화면 칸에 적던 줄은 팝업으로 옮겨 갔다 — 실패만 화면에 적는다.
  for (const path of [
    "src/components/settings/ThemeTokenEditor.tsx",
    "src/components/settings/UiTextEditor.tsx",
    "src/components/settings/MainColorPicker.tsx",
    "src/components/settings/ThemeTemplatePicker.tsx",
    "src/components/users/RolePermissionSettings.tsx",
  ]) {
    // 상태 타입 선언(`{ type: "success" | "error"; … }`)은 남는다 — 보는 것은 **적는 호출**뿐이다.
    assert.doesNotMatch(readFileSync(path, "utf8"), /setMessage\(\{\s*type: "success"/, path);
  }
});

test("메일 시험 발송 결과 · 계정 삭제 안내 · 위임 철회는 화면에 남는다", () => {
  const mail = readFileSync("src/components/settings/IntakeMailSettingsScreen.tsx", "utf8");
  // 시험 발송은 저장이 아니다 — 받았는지 못 받았는지를 읽어야 하므로 화면에 둔다.
  assert.match(mail, /await sendTestIntakeMailAction\(\{[\s\S]*?\}\);\s*setMessage\(\{ ok: result\.ok, text: result\.message \}\);/);
  const list = readFileSync("src/components/users/RepresentativeListSection.tsx", "utf8");
  assert.match(list, /setMessage\(userDeletionSuccessMessage\(deletedName\)\)/);
  const delegation = readFileSync("src/components/users/DelegationSection.tsx", "utf8");
  assert.match(delegation, /setListMessage\("위임을 철회했습니다\."\);/);
  // 결재권 위임(2026-10-26)도 같다 — 되돌린 결과는 화면에 남는다. 낱말만 그 탭의
  // 단추([되돌리기])와 맞춰 적는다.
  const routeDelegation = readFileSync(
    "src/components/users/ApprovalRouteDelegationSection.tsx",
    "utf8"
  );
  assert.match(routeDelegation, /setListMessage\("결재권 위임을 되돌렸습니다\."\);/);
});

test("승인 카드는 성공 문구를 팝업으로 옮기고, 거절 이유만 카드에 남긴다", () => {
  for (const name of ["DatabaseRepairInspectionCard.tsx", "DatabaseFinalShipmentCard.tsx"]) {
    const source = readFileSync(`src/components/repair-cases/approval/${name}`, "utf8");
    assert.doesNotMatch(source, /setStatusMessage\(dialogState === "REQUEST"/, name);
    assert.match(source, /setStatusMessage\(null\);\s*showSavePopup\(/, name);
  }
});
