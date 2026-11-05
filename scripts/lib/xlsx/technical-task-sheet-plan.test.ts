import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStageNumberIndex,
  DECIDED_SHEET_EXCLUSIONS,
  planProceduresForSheet,
  resolveSheetExclusion,
  SHEET_EXCLUSION_CATEGORY_CODES,
  sheetExclusionCategoryLabels,
  splitBlockHeading,
  trimCoNumberedLabel,
  type ProcedurePlanCellBlock,
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

test("🔴 **셀 격자 흐름도가 있으면 도형이 0이어도 제외가 아니다** (2026-11-05 — 읽개가 생겼다)", () => {
  // 전에는 `(MB) 수리` 가 결정 표에 `DEFERRED_CELL_BASED` 로 적혀 있었다. 셀 격자
  // 읽개(cell-grid-flowchart.ts)가 생기면서 그 줄이 빠졌고, 이제는 **재서** 가린다.
  assert.equal(
    resolveSheetExclusion("(MB) 가나다", { shapeCount: 0, connectorCount: 0 }, { blockCount: 11 }),
    null
  );
  // 🔴 블록이 0개면 셀 격자 흐름도가 아니다 — 그때는 도형 측정이 제 일을 한다.
  const verdict = resolveSheetExclusion("(MB) 가나다", { shapeCount: 0, connectorCount: 0 }, { blockCount: 0 });
  assert.equal(verdict?.category, "NO_FLOWCHART");
  assert.ok(verdict?.detail.includes("셀 격자 블록 0개"), "셀 격자도 재 봤다는 사실이 까닭에 없다");
});

test("🔴 **사람이 정한 제외가 셀 격자보다 앞선다** — 측정으로 사람의 결정을 뒤집지 않는다", () => {
  assert.equal(
    resolveSheetExclusion("(MB) 출하완료", { shapeCount: 6, connectorCount: 2 }, { blockCount: 11 })?.category,
    "USER_EXCLUDED"
  );
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
  assert.equal(resolveSheetExclusion("(MB) 외관 및 내부 검사")?.category, "USER_EXCLUDED");
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

test("🔴 결정 표에 적힌 시트가 **둘**이고, 갈래가 적힌 그대로다", () => {
  // 표가 손으로 비워지거나 갈래가 뒤바뀌면 여기서 걸린다.
  // 🔴 2026-11-05 에 `(MB) 수리`(DEFERRED_CELL_BASED)가 빠졌다 — 셀 격자 읽개가
  //    생겨서 「아직 안 한 것」이 아니게 됐고, 이제 측정으로 가린다.
  assert.deepEqual(
    [...DECIDED_SHEET_EXCLUSIONS].map(([sheet, exclusion]) => [sheet, exclusion.category]),
    [
      ["(MB) 외관 및 내부 검사", "USER_EXCLUDED"],
      ["(MB) 출하완료", "USER_EXCLUDED"],
    ]
  );
  // 🔵 갈래 자체는 살아 있다 — 다음에 또 다른 꼴의 시트가 나오면 여기 적어야 하고,
  //    갈래가 없으면 그 시트가 「흐름도가 없다」로 묻힌다.
  assert.ok(SHEET_EXCLUSION_CATEGORY_CODES.includes("DEFERRED_CELL_BASED"));
});

// ── 셀 격자 시트 — 블록마다 절차 하나 ────────────────────────────────────

/** 지어낸 블록 둘. `(MB) 수리` 에서 베낀 것은 머리글의 **모양**(`숫자. 이름`)뿐이다. */
const CELL_BLOCKS: ProcedurePlanCellBlock[] = [
  { headerRef: "A3", headerRow: 3, endRow: 10, rawHeaderText: "1. 가나다 알람 발생", blockNumber: "1" },
  { headerRef: "A11", headerRow: 11, endRow: 21, rawHeaderText: "2. 라마바(Sample) 알람", blockNumber: "2" },
];

test("블록 머리글 가르기 — 앞의 `숫자.` 를 떼고 다듬는다", () => {
  assert.deepEqual(splitBlockHeading("1. 가나다 알람 발생"), { blockNumber: "1", label: "가나다 알람 발생" });
  assert.deepEqual(splitBlockHeading("11.  라마바 "), { blockNumber: "11", label: "라마바" });
  // 번호가 없거나 이름이 없으면 머리글이 아니다 — 이름 없는 절차는 만들 수 없다.
  assert.equal(splitBlockHeading("Main page"), null);
  assert.equal(splitBlockHeading("3."), null);
  assert.equal(splitBlockHeading(null), null);
});

test("🔴 셀 격자 시트 한 장이 **블록마다 절차 하나**를 만든다", () => {
  const plans = planProceduresForSheet("(MB) 수리", "Main page", { shapeCount: 0, connectorCount: 0 }, CELL_BLOCKS);

  assert.equal(plans.length, 2, "블록 수만큼 안 나왔다");
  assert.deepEqual(
    plans.map((p) => [p.name, p.label, p.nodeCodePrefix]),
    [
      ["[MB] 가나다 알람 발생", "가나다 알람 발생", "mb수리1"],
      ["[MB] 라마바(Sample) 알람", "라마바(Sample) 알람", "mb수리2"],
    ]
  );
  // 계획이 **제 블록**을 들고 다녀야 만드는 쪽이 대응을 다시 추측하지 않는다.
  assert.deepEqual(plans.map((p) => p.cellBlock?.headerRef), ["A3", "A11"]);
  assert.equal(plans.every((p) => p.excluded === null), true);
  // 시트 단위 계획(`[MB] 수리`)은 **안 생긴다** — 생기면 절차가 하나 더 늘어난다.
  assert.equal(plans.some((p) => p.name === "[MB] 수리"), false);
});

test("🔴 블록 번호를 `stageNumber` 로 **쓰지 않는다** — 쓰면 기존 절차의 단계 번호와 부딪친다", () => {
  const cellPlans = planProceduresForSheet(
    "(MB) 수리",
    null,
    { shapeCount: 0, connectorCount: 0 },
    CELL_BLOCKS
  );
  assert.deepEqual(cellPlans.map((p) => p.stageNumber), [null, null]);

  // 🔴 이것이 알맹이다: 워크북의 단계 1·2 와 **같은 표**에 들어가므로, 블록 번호를
  //    그대로 쓰면 둘 다 충돌로 빠져 기존 절차의 이어가기가 통째로 끊긴다.
  const { byStageNumber, conflicts } = buildStageNumberIndex([
    ...planProceduresForSheet("(RFG) (1)가나다", null),
    ...planProceduresForSheet("(RFG) (2)라마바", null),
    ...cellPlans,
  ]);
  assert.deepEqual(conflicts, [], "셀 격자 블록이 단계 번호를 먹었다");
  assert.deepEqual([...byStageNumber.keys()], ["1", "2"]);
  assert.equal(byStageNumber.get("1")?.name, "[RFG] 가나다");
});

test("🔵 도형 시트의 계획은 `cellBlock` 이 null 이다 — 그 값이 곧 읽개를 고르는 잣대다", () => {
  const plans = planProceduresForSheet("(RFG) (1)가나다 접수 확인", null, HEALTHY_DRAWING);
  assert.equal(plans[0].cellBlock, null);
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
