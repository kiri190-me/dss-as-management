import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStageNumberIndex,
  DECIDED_SHEET_EXCLUSIONS,
  planProceduresForSheet,
  resolveSheetExclusion,
  SHEET_EXCLUSION_CATEGORY_CODES,
  sheetExclusionCategoryLabels,
  trimCoNumberedLabel,
} from "./technical-task-sheet-plan";

/**
 * 🔴 **지어낸 값만 쓴다.** 베끼는 것은 시트 이름과 머리글 칸의 **모양**뿐이고,
 * 안의 낱말은 전부 가짜다(이 저장소는 공개이고 원본은 사내 업무 자료다).
 */

test("🔴 시트 이름에서 장비 머리말 · 단계 번호 · 이름을 가른다", () => {
  const plans = planProceduresForSheet("(RFG) (1)가나다 접수 확인", null);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].stageNumber, "1");
  assert.equal(plans[0].name, "[RFG] 가나다 접수 확인");
  assert.equal(plans[0].equipmentType, "RFG");
  assert.equal(plans[0].nodeCodePrefix, "rfg1");
  assert.equal(plans[0].duplicateOfStageNumber, null);
});

test("이름 안의 괄호는 이름의 일부다 — 단계 번호만 떼어 낸다", () => {
  const plans = planProceduresForSheet("(RFG) (5)라마바검사(3상입력)", null);
  assert.equal(plans[0].stageNumber, "5");
  assert.equal(plans[0].name, "[RFG] 라마바검사(3상입력)");
});

test("번호가 없는 시트 — 번호는 null 이고 노드 코드 앞가지는 이름으로 짓는다", () => {
  const plans = planProceduresForSheet("(MB) 사아자 검사", null);
  assert.equal(plans[0].stageNumber, null);
  assert.equal(plans[0].name, "[MB] 사아자 검사");
  assert.equal(plans[0].equipmentType, "MB");
  // 번호가 없는 시트가 여럿이라, 앞가지가 전부 같으면 로그에서 못 가린다.
  assert.equal(plans[0].nodeCodePrefix, "mb사아자검사");
});

test("장비 머리말이 없는 시트는 계획을 못 세운다 — 빈 배열", () => {
  assert.deepEqual(planProceduresForSheet("Main page", null), []);
  assert.deepEqual(planProceduresForSheet("QC", "(1) 가나다"), []);
});

test("🔴 머리글 칸의 겸임 표기가 **별도 절차**를 만든다 (2026-11-05 사용자 결정)", () => {
  // 한 시트가 여러 단계를 겸하는 꼴. 겸임 번호는 원본을 **가리키는** 것이 아니라
  // 같은 내용의 **제 절차**를 가진다.
  // 🔴 「겸임 번호 → 원본 시트를 가리킨다」로 잡았던 중간 설계는 폐기됐다.
  const plans = planProceduresForSheet(
    "(RFG) (7)가나다 검사 및 개선 작업",
    "(7) 가나다 검사 및 개선 작업 [(9) 라마바 작업, (10) 사아자 검사시 에도 동일 작업 재실시] (조건)"
  );

  assert.equal(plans.length, 3);
  assert.deepEqual(
    plans.map((p) => [p.stageNumber, p.name]),
    [
      ["7", "[RFG] 가나다 검사 및 개선 작업"],
      ["9", "[RFG] 라마바 작업"],
      ["10", "[RFG] 사아자 검사"],
    ]
  );
  // 복제본은 어느 시트에서 왔는지를 들고 있어야 한다 — 내용이 같다는 사실의 근거다.
  assert.equal(plans[1].duplicateOfStageNumber, "7");
  assert.equal(plans[2].duplicateOfStageNumber, "7");
  assert.equal(plans[0].duplicateOfStageNumber, null);
  // 셋 다 같은 시트를 읽는다.
  assert.equal(new Set(plans.map((p) => p.sourceWorksheet)).size, 1);
  // 노드 코드 앞가지는 셋이 다 달라야 한다.
  assert.equal(new Set(plans.map((p) => p.nodeCodePrefix)).size, 3);
  // 줄이기 전 원문도 남는다 — 줄이는 규칙이 틀렸는지 사람이 볼 수 있어야 한다.
  assert.equal(plans[2].rawCoNumberedLabel, "사아자 검사시 에도 동일 작업 재실시");
});

test("🔴 대괄호 **밖**의 번호는 겸임이 아니다", () => {
  // 머리글 칸에는 그 시트 자신의 번호가 맨 앞에 있고, 대괄호 뒤에 조건이 또 붙는다.
  // 대괄호 안만 세지 않으면 꼬리의 번호까지 복제본이 되어 없는 절차가 생긴다.
  const plans = planProceduresForSheet(
    "(RFG) (3)가나다 검사",
    "(3) 가나다 검사 [(6) 라마바 작업] (9) 사아자 조건"
  );
  assert.deepEqual(plans.map((p) => p.stageNumber), ["3", "6"]);
});

test("자기 번호가 대괄호 안에 또 적혀 있어도 복제본을 만들지 않는다", () => {
  const plans = planProceduresForSheet("(RFG) (3)가나다 검사", "(3) 가나다 검사 [(3) 가나다 검사, (6) 라마바 작업]");
  assert.deepEqual(plans.map((p) => p.stageNumber), ["3", "6"]);
});

test("겸임 이름 줄이기 — 설명 꼬리말을 뗀다, 뗀 뒤 비면 원문을 쓴다", () => {
  assert.equal(trimCoNumberedLabel("사아자 검사시 에도 동일 작업 재실시"), "사아자 검사");
  assert.equal(trimCoNumberedLabel("라마바 작업"), "라마바 작업");
  // 꼬리말이 통째로 이름인 꼴 — 잘라서 빈 글자가 되면 원문을 그대로 쓴다.
  assert.equal(trimCoNumberedLabel("시 에도 동일 작업 재실시"), "시 에도 동일 작업 재실시");
});

test("🔴 단계 번호 표 — 같은 번호가 둘이면 담지 않고 충돌로 돌려준다", () => {
  const plans = [
    ...planProceduresForSheet("(RFG) (1)가나다", null),
    ...planProceduresForSheet("(RFG) (2)라마바", null),
    // 두 시트가 같은 번호를 든 경우. 먼저 온 것을 쓰면 「모르는데 하나를 골랐다」가 된다.
    ...planProceduresForSheet("(RFG) (2)사아자", null),
  ];
  const { byStageNumber, conflicts } = buildStageNumberIndex(plans);

  assert.deepEqual([...byStageNumber.keys()], ["1"]);
  assert.deepEqual(conflicts, ["2"]);
});

// ── 시트 제외 ────────────────────────────────────────────────────────────

/** 도형 흐름도가 멀쩡히 있는 시트. 제외 갈래가 안 걸려야 한다. */
const HEALTHY_DRAWING = { shapeCount: 8, connectorCount: 5 };

test("🔴 제외 까닭 갈래 셋이 **서로 다른 말**로 적힌다 — 한 낱말로 뭉치면 안 된다", () => {
  // 뭉치면 「아직 안 한 것」이 「뺀 것」으로 읽혀 다음 단계에서 아무도 안 찾는다.
  assert.equal(SHEET_EXCLUSION_CATEGORY_CODES.length, 3);
  const labels = SHEET_EXCLUSION_CATEGORY_CODES.map((c) => sheetExclusionCategoryLabels[c]);
  assert.equal(new Set(labels).size, 3, `갈래 글이 겹친다: ${labels.join(" / ")}`);
  // 「아직 안 했다」 쪽은 **되돌릴 일이 아니라 할 일**이라는 것이 글에 드러나야 한다.
  assert.ok(sheetExclusionCategoryLabels.DEFERRED_CELL_BASED.includes("아직 안 했다"));
});

test("🔴 사람이 뺀 시트는 「사용자가 뺐다」다 — 도형이 있어도 「흐름도가 없다」가 아니다", () => {
  // (MB) 출하완료 는 도형도 연결선도 있다. 데이터가 모자라서가 아니라 결정이다.
  const verdict = resolveSheetExclusion("(MB) 출하완료", { shapeCount: 6, connectorCount: 2 });
  assert.equal(verdict?.category, "USER_EXCLUDED");

  // 연결선이 0인 시트도 **사람이 뺀 것**으로 적혀 있으면 그쪽이 이긴다.
  assert.equal(
    resolveSheetExclusion("(MB) 외관 및 내부 검사", { shapeCount: 11, connectorCount: 0 })?.category,
    "USER_EXCLUDED"
  );
});

test("🔴 셀 방식 시트는 도형이 0이어도 **「아직 안 했다」**로 남는다 — 「흐름도가 없다」로 묻히면 안 된다", () => {
  const verdict = resolveSheetExclusion("(MB) 수리", { shapeCount: 0, connectorCount: 0 });
  assert.equal(verdict?.category, "DEFERRED_CELL_BASED");
  assert.ok(verdict?.detail.includes("3단계"), "언제 할 것인지가 까닭에 없다");
});

test("표에 없는 시트는 **측정**으로 가린다 — 도형 0 이나 선 0 이면 흐름도가 아니다", () => {
  assert.equal(
    resolveSheetExclusion("(MB) 가나다", { shapeCount: 0, connectorCount: 0 })?.category,
    "NO_FLOWCHART"
  );
  assert.equal(
    resolveSheetExclusion("(MB) 라마바", { shapeCount: 9, connectorCount: 0 })?.category,
    "NO_FLOWCHART"
  );
  assert.equal(resolveSheetExclusion("(MB) 사아자", HEALTHY_DRAWING), null);
});

test("🔵 그림층을 안 넘기면 측정 갈래를 **안 본다**(「문제 없음」이 아니다)", () => {
  assert.equal(resolveSheetExclusion("(MB) 가나다"), null);
  // 사람이 정한 것은 그림층 없이도 그대로 걸린다.
  assert.equal(resolveSheetExclusion("(MB) 수리")?.category, "DEFERRED_CELL_BASED");
});

test("🔴 제외된 시트는 계획에서 **「만들 것」으로 안 잡힌다** — 다만 줄은 남는다", () => {
  const plans = planProceduresForSheet("(MB) 출하완료", null, { shapeCount: 6, connectorCount: 2 });

  assert.equal(plans.length, 1, "줄이 통째로 사라졌다 — 그러면 왜 없는지 아무도 모른다");
  assert.equal(plans[0].excluded?.category, "USER_EXCLUDED");
  assert.equal(plans.filter((p) => p.excluded === null).length, 0, "만들 것으로 잡혔다");
});

test("제외는 시트 단위다 — 겸임 복제본도 함께 빠진다", () => {
  // 지어낸 시트 이름이라 표에는 없다. 측정(선 0)으로 걸리게 한다.
  const plans = planProceduresForSheet(
    "(RFG) (7)가나다 작업",
    "(7) 가나다 작업 [(9) 라마바 작업]",
    { shapeCount: 12, connectorCount: 0 }
  );
  assert.equal(plans.length, 2);
  assert.equal(plans.every((p) => p.excluded?.category === "NO_FLOWCHART"), true);
});

test("멀쩡한 흐름도 시트는 제외되지 않는다", () => {
  const plans = planProceduresForSheet("(RFG) (1)가나다 접수 확인", null, HEALTHY_DRAWING);
  assert.equal(plans[0].excluded, null);
});

test("🔴 결정 표에 적힌 시트가 셋이고, 갈래가 적힌 그대로다", () => {
  // 표가 손으로 비워지거나 갈래가 뒤바뀌면 여기서 걸린다.
  assert.deepEqual(
    [...DECIDED_SHEET_EXCLUSIONS].map(([sheet, exclusion]) => [sheet, exclusion.category]),
    [
      ["(MB) 외관 및 내부 검사", "USER_EXCLUDED"],
      ["(MB) 출하완료", "USER_EXCLUDED"],
      ["(MB) 수리", "DEFERRED_CELL_BASED"],
    ]
  );
});

test("단계 번호 표 — 겸임 복제본도 제 번호로 찾힌다", () => {
  const plans = planProceduresForSheet(
    "(RFG) (7)가나다 작업",
    "(7) 가나다 작업 [(9) 라마바 작업]"
  );
  const { byStageNumber, conflicts } = buildStageNumberIndex(plans);

  assert.deepEqual(conflicts, []);
  assert.equal(byStageNumber.get("9")?.name, "[RFG] 라마바 작업");
  assert.equal(byStageNumber.get("7")?.name, "[RFG] 가나다 작업");
});
