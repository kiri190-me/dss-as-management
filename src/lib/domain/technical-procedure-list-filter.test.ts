import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL,
  TECHNICAL_PROCEDURE_LIST_FILTER_NONE,
  filterTechnicalProcedureRows,
  filterTechnicalProcedureSeries,
  isTechnicalProcedureListFilterActive,
  matchesTechnicalProcedureListFilter,
  normalizeProcedureNameQuery,
  parseProcedureEquipmentTypeFilter,
  pruneSelectionToVisible,
  type TechnicalProcedureListFilter,
} from "./technical-procedure-list-filter";
import { planRangeToggle, setIdsChecked } from "./range-selection";
import { groupProcedureTemplatesByCode } from "./procedure-template-series";
import {
  procedureEquipmentTypeLabels,
  type ProcedureEquipmentType,
  type ProcedureTemplateStatus,
} from "./procedure-template-types";

/**
 * ============================================================================
 * [기술 작업 절차] 목록의 이름 검색 · 설비 유형 거르기 (2026-11-05)
 * ============================================================================
 * 거르기 자체보다 **거른 뒤에 무엇을 고를 수 있는가**가 알맹이다. 이 화면에는
 * 삭제 모드가 있고, 거르기가 생기기 전의 고르기 로직은 "보이는 것 = templates
 * 전부"를 전제로 짜여 있었다. 그 전제가 깨지면 사람이 **보지도 못한 판**이
 * [선택 삭제]에 딸려 간다.
 *
 * 그래서 ⑦⑧⑨ 세 절은 거르기 시험이 아니라 **삭제 사고 시험**이다:
 *   ⑦ 거른 채 [전체 선택] — 보이는 것만 담기는가
 *   ⑧ 거르개를 바꿔 사라진 판 — 고르기가 풀리는가
 *   ⑨ Shift 범위 — 화면에 보이는 차례로 도는가(가려진 판이 섞이지 않는가)
 *
 * ── 🔴 왜 화면을 렌더하지 않는가 ────────────────────────────────────────
 * 거르기가 붙는 화면(TechnicalProcedureTemplateListScreen)은 휴지통 서버 액션을
 * 직접 import 해서 사슬 끝에 `server-only` 가 있다 — 시험에서 import 자체가
 * 던진다. 그래서 규칙은 여기서 **값으로** 재고, 화면이 그 규칙을 실제로 물고
 * 있는지는 components 목록의 technical-procedure-list-filter-ui.test.tsx 가
 * 원본 글자로 본다. 둘 중 하나만 있으면 "맞는 규칙이 안 쓰이는" 상태가 조용히
 * 통과한다.
 *
 * 🔴 이름·설비는 전부 **가짜**다. 실제 고객사·제품 이름을 시험에 넣지 않는다.
 * ============================================================================
 */

type Row = {
  id: string;
  code: string;
  version: number;
  status: ProcedureTemplateStatus;
  name: string;
  equipmentType: ProcedureEquipmentType;
};

function row(
  id: string,
  code: string,
  name: string,
  equipmentType: ProcedureEquipmentType,
  status: ProcedureTemplateStatus = "PUBLISHED",
  version = 1
): Row {
  return { id, code, version, status, name, equipmentType };
}

/**
 * 서버가 주는 차례 그대로(생성일 내림차순). 🔴 **가운데에 안 걸리는 줄이 끼어
 * 있어야** 한다 — ⑨절의 "보이는 차례로 돈다"가 그 틈으로만 드러난다.
 */
const ROWS: Row[] = [
  row("t1", "TP-20261105-AAAA", "기본 통전 검사", "RFG"),
  row("t2", "TP-20261105-BBBB", "매칭 박스 커패시터 교체", "MB"),
  row("t3", "TP-20261105-CCCC", "외관 세척 및 포장", "COMMON"),
  row("t4", "TP-20261105-DDDD", "RF 출력 측정", "RFG", "DRAFT", 2),
  row("t5", "TP-20261105-EEEE", "통전 검사 후 재조립", "MB"),
];

/** 수행 기록·후속 버전·이어가기가 붙어 **지울 수 없는** 판. 화면의 undeletable 과 같은 뜻이다. */
const UNDELETABLE = new Set(["t4"]);

const filterOf = (part: Partial<TechnicalProcedureListFilter>): TechnicalProcedureListFilter => ({
  ...TECHNICAL_PROCEDURE_LIST_FILTER_NONE,
  ...part,
});

const idsOf = (rows: readonly Row[]) => rows.map((r) => r.id);
const visibleIds = (filter: TechnicalProcedureListFilter) => idsOf(filterTechnicalProcedureRows(ROWS, filter));

/**
 * 화면이 쓰는 그 식 그대로 — 거른 뒤 목록에서 막히지 않은 판.
 * (화면: `visibleTemplates.filter((t) => !undeletable.has(t.id)).map((t) => t.id)`)
 */
function selectableVisibleIds(filter: TechnicalProcedureListFilter): string[] {
  return filterTechnicalProcedureRows(ROWS, filter)
    .filter((r) => !UNDELETABLE.has(r.id))
    .map((r) => r.id);
}

// ══════════════════════════════════════════════════ ① 먼저 표본 확인

describe("절차 거르기 — ① 먼저 표본 확인", () => {
  test("🔵 표본이 비지 않았고, 설비 유형 셋이 모두 들어 있다", () => {
    assert.equal(ROWS.length, 5);
    assert.deepEqual(
      [...new Set(ROWS.map((r) => r.equipmentType))].sort(),
      ["COMMON", "MB", "RFG"],
      "한 유형뿐이면 ③절이 공짜로 통과한다"
    );
  });

  test("🔵 막힌 판이 **하나만** 있다 — 전부 막혔거나 하나도 안 막혔으면 ⑦⑨절이 공짜다", () => {
    assert.deepEqual([...UNDELETABLE], ["t4"]);
    assert.ok(ROWS.some((r) => UNDELETABLE.has(r.id)), "막힌 판이 표본 안에 실제로 있어야 한다");
    assert.ok(ROWS.some((r) => !UNDELETABLE.has(r.id)));
  });

  test("🔵 거르지 않으면 다섯 줄이 **차례 그대로** 나온다", () => {
    assert.deepEqual(visibleIds(TECHNICAL_PROCEDURE_LIST_FILTER_NONE), ["t1", "t2", "t3", "t4", "t5"]);
    assert.equal(isTechnicalProcedureListFilterActive(TECHNICAL_PROCEDURE_LIST_FILTER_NONE), false);
  });
});

// ══════════════════════════════════════════════════ ② 이름으로 찾기

describe("절차 거르기 — ② 이름 검색", () => {
  test("부분 일치다 — 이름 한가운데 글자로도 걸린다", () => {
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "통전" })), ["t1", "t5"]);
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "커패시터" })), ["t2"]);
  });

  test("대소문자·앞뒤 공백·연속 공백을 무시한다", () => {
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "rf" })), ["t4"], "소문자로 쳐도 'RF 출력 측정'이 걸린다");
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "  통전  " })), ["t1", "t5"]);
    assert.deepEqual(
      visibleIds(filterOf({ nameQuery: "기본   통전" })),
      ["t1"],
      "친 글자의 연속 공백도 하나로 접는다 — 안 접으면 한 줄도 안 걸린다"
    );
    assert.equal(normalizeProcedureNameQuery("  Rf  출력 "), "RF 출력");
    assert.equal(normalizeProcedureNameQuery("기본\t통전\n검사"), "기본 통전 검사", "탭·줄바꿈도 공백이다");
  });

  test("한글 NFD(풀어쓴) 입력도 같은 줄에 걸린다", () => {
    const decomposed = "통전".normalize("NFD");
    assert.notEqual(decomposed, "통전", "표본 확인 — 실제로 다른 글자열이어야 한다");
    assert.deepEqual(visibleIds(filterOf({ nameQuery: decomposed })), ["t1", "t5"]);
  });

  test("🔴 **코드로는 안 찾는다** — 화면에 없는 값으로 줄이 걸리면 안 된다", () => {
    // 2026-11-05 에 절차 코드를 사람 눈에서 걷어냈다(procedure-code-hidden-screens).
    // 🔵 먼저 표본 — 그 글자가 실제로 코드 칸에 **있다**(없으면 아래가 공짜다).
    assert.ok(ROWS.some((r) => r.code.includes("BBBB")));
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "BBBB" })), [], "코드로 걸렸다");
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "TP-2026" })), [], "코드의 앞머리로도 걸리면 안 된다");
  });

  test("🔵 설비 유형의 **이름표로도 안 찾는다** — 그쪽은 거르개가 따로 있다", () => {
    assert.equal(procedureEquipmentTypeLabels.MB, "Matching Box", "표본 확인 — 이름표가 그 글자다");
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "Matching Box" })), [], "이름 칸에 없는 글자다");
  });

  test("안 걸리면 0건이다 — 빈 배열이지 전체가 아니다", () => {
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "없는절차" })), []);
  });

  test("공백뿐인 칸은 거르지 않는 것으로 본다", () => {
    assert.equal(isTechnicalProcedureListFilterActive(filterOf({ nameQuery: "   " })), false);
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "   " })), ["t1", "t2", "t3", "t4", "t5"]);
    assert.equal(isTechnicalProcedureListFilterActive(filterOf({ nameQuery: "통전" })), true);
  });
});

// ══════════════════════════════════════════════════ ③ 설비 유형으로 거르기

describe("절차 거르기 — ③ 설비 유형", () => {
  test("유형 셋이 각각 제 줄만 남긴다", () => {
    assert.deepEqual(visibleIds(filterOf({ equipmentType: "RFG" })), ["t1", "t4"]);
    assert.deepEqual(visibleIds(filterOf({ equipmentType: "MB" })), ["t2", "t5"]);
    assert.deepEqual(visibleIds(filterOf({ equipmentType: "COMMON" })), ["t3"]);
  });

  test("「전체」는 안 거른다 — 그리고 거르는 중으로 세지 않는다", () => {
    assert.deepEqual(visibleIds(filterOf({ equipmentType: PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL })), [
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
    ]);
    assert.equal(isTechnicalProcedureListFilterActive(filterOf({ equipmentType: "ALL" })), false);
    assert.equal(isTechnicalProcedureListFilterActive(filterOf({ equipmentType: "MB" })), true);
  });

  test("모르는 값은 「전체」로 읽는다 — 거르개가 굳어 목록이 통째로 비면 안 된다", () => {
    assert.equal(parseProcedureEquipmentTypeFilter("RFG"), "RFG");
    assert.equal(parseProcedureEquipmentTypeFilter("ALL"), "ALL");
    assert.equal(parseProcedureEquipmentTypeFilter(""), "ALL");
    assert.equal(parseProcedureEquipmentTypeFilter("rfg"), "ALL", "값은 enum 글자 그대로여야 한다");
    assert.equal(parseProcedureEquipmentTypeFilter("GENERATOR"), "ALL");
  });
});

// ══════════════════════════════════════════════════ ④ 둘을 함께 걸면 둘 다 만족

describe("절차 거르기 — ④ 이름과 설비를 함께", () => {
  test("둘 다 만족하는 줄만 남는다(AND)", () => {
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "통전", equipmentType: "MB" })), ["t5"]);
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "통전", equipmentType: "RFG" })), ["t1"]);
    assert.deepEqual(
      visibleIds(filterOf({ nameQuery: "통전", equipmentType: "COMMON" })),
      [],
      "이름만 맞고 설비가 다르면 안 걸린다"
    );
  });

  test("한 줄을 직접 견줘도 같은 답이다", () => {
    const mbOnly = filterOf({ equipmentType: "MB" });
    assert.equal(matchesTechnicalProcedureListFilter(ROWS[1], mbOnly), true);
    assert.equal(matchesTechnicalProcedureListFilter(ROWS[0], mbOnly), false);
  });

  test("차례를 흔들지 않는다 — 서버가 준 차례 그대로다", () => {
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "검사" })), ["t1", "t5"], "t5 가 t1 앞으로 오면 안 된다");
  });
});

// ══════════════════════════════════════════════════ ⑤ 계열 줄 거르기

describe("절차 거르기 — ⑤ 평소 목록(계열당 한 줄)", () => {
  /** 같은 줄기의 옛 판이 **다른 이름**을 가진 경우 — 실제로 있는 모양이다. */
  const RENAMED: Row[] = [
    row("s2", "TP-RENAME", "새 이름 통전 검사", "RFG", "PUBLISHED", 2),
    row("s1", "TP-RENAME", "옛 이름 절연 점검", "RFG", "ARCHIVED", 1),
    row("s3", "TP-OTHER", "매칭 박스 점검", "MB"),
  ];
  const series = groupProcedureTemplatesByCode(RENAMED);

  test("🔵 먼저 표본 — 두 줄기이고, 한 줄기의 대표는 새 이름 판이다", () => {
    assert.equal(series.length, 2);
    assert.equal(series[0].representative.name, "새 이름 통전 검사");
  });

  test("🔴 **대표의 이름**으로 걸린다 — 줄에 적힌 글자가 곧 걸리는 글자다", () => {
    const hit = filterTechnicalProcedureSeries(series, filterOf({ nameQuery: "새 이름" }));
    assert.deepEqual(hit.map((s) => s.code), ["TP-RENAME"]);
  });

  test("🔴 안 보이는 옛 판의 이름으로는 **안 걸린다** — '쳤는데 왜 이 줄이?'를 막는다", () => {
    // 🔵 먼저 표본 — 그 이름이 실제로 그 줄기의 판에 들어 있다.
    assert.ok(series[0].members.some((m) => m.name === "옛 이름 절연 점검"));
    assert.deepEqual(filterTechnicalProcedureSeries(series, filterOf({ nameQuery: "절연" })), []);
  });

  test("설비 유형도 대표로 본다", () => {
    const mb = filterTechnicalProcedureSeries(series, filterOf({ equipmentType: "MB" }));
    assert.deepEqual(mb.map((s) => s.code), ["TP-OTHER"]);
  });
});

// ═══════════════════════════ ⑥ 🔴 거른 채 [전체 선택] — 보이는 것만 담긴다

describe("절차 거르기 — ⑥ 🔴 [전체 선택]은 보이는 것만 담는다", () => {
  /** 화면의 toggleSelectAll(true) 와 같은 합성 — 빈 선택에 보이는 고를 수 있는 판을 켠다. */
  const selectAll = (filter: TechnicalProcedureListFilter) =>
    setIdsChecked(new Set<string>(), selectableVisibleIds(filter), true);

  test("🔵 먼저 견줄 쪽 — 안 거르면 막힌 판만 빼고 전부 담긴다", () => {
    const all = selectAll(TECHNICAL_PROCEDURE_LIST_FILTER_NONE);
    assert.deepEqual([...all].sort(), ["t1", "t2", "t3", "t5"]);
    assert.equal(all.has("t4"), false, "막힌 판은 거르기와 상관없이 안 담긴다");
  });

  test("🔴 설비 유형을 걸면 **다른 유형의 판이 안 담긴다**", () => {
    const picked = selectAll(filterOf({ equipmentType: "MB" }));
    assert.deepEqual([...picked].sort(), ["t2", "t5"]);
    for (const hidden of ["t1", "t3", "t4"]) {
      assert.equal(picked.has(hidden), false, `가려진 판 ${hidden} 이 [전체 선택]에 딸려 왔다`);
    }
  });

  test("🔴 이름으로 걸러도 같다 — 그리고 보이는 중 막힌 판은 여전히 빠진다", () => {
    // "RF" 로 거르면 보이는 것은 t4 하나인데, 그 t4 가 막힌 판이다.
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "RF" })), ["t4"], "표본 확인");
    const picked = selectAll(filterOf({ nameQuery: "RF" }));
    assert.equal(picked.size, 0, "보이는 판이 전부 막혔으면 담을 것이 없다");
  });

  test("🔴 거른 뒤 [전체 선택]을 풀면 **보이는 것만** 풀린다", () => {
    // 전부 고른 상태에서 MB 로 좁히고 전체 선택을 풀면, MB 두 판만 풀린다.
    const everything = new Set(["t1", "t2", "t3", "t5"]);
    const afterUncheck = setIdsChecked(everything, selectableVisibleIds(filterOf({ equipmentType: "MB" })), false);
    assert.deepEqual([...afterUncheck].sort(), ["t1", "t3"]);
    assert.deepEqual([...everything].sort(), ["t1", "t2", "t3", "t5"], "받은 Set 은 안 건드린다");
  });
});

// ═════════════════════ ⑦ 🔴 화면에서 사라진 판은 고르기가 풀린다

describe("절차 거르기 — ⑦ 🔴 사라진 판의 고르기를 푼다", () => {
  test("🔴 검색어를 바꿔 가려진 판이 선택에서 빠진다", () => {
    const selected = new Set(["t1", "t2", "t3"]);
    const next = pruneSelectionToVisible(selected, visibleIds(filterOf({ equipmentType: "MB" })));
    assert.deepEqual([...next], ["t2"], "MB 가 아닌 t1·t3 는 화면에 없으므로 풀려야 한다");
  });

  test("🔴 보이는 판의 고르기는 그대로다 — 추리기가 전부를 비우는 것이 아니다", () => {
    const selected = new Set(["t2", "t5"]);
    const next = pruneSelectionToVisible(selected, visibleIds(filterOf({ equipmentType: "MB" })));
    assert.deepEqual([...next].sort(), ["t2", "t5"]);
  });

  test("거르기를 지우면(=전부 보임) 아무것도 안 풀린다", () => {
    const selected = new Set(["t1", "t5"]);
    const next = pruneSelectionToVisible(selected, visibleIds(TECHNICAL_PROCEDURE_LIST_FILTER_NONE));
    assert.deepEqual([...next].sort(), ["t1", "t5"]);
  });

  test("🔴 **한 번 풀린 것은 되돌아오지 않는다** — 거르기를 지워도 다시 안 골라진다", () => {
    // 이것이 "조용히 고른 채로 두기"와 갈리는 지점이다. 풀고 나면 상태에서 사라지므로,
    // 거르개를 되돌려도 체크는 꺼진 채다 — 사람이 본 적 없는 판이 되살아나지 않는다.
    const afterNarrow = pruneSelectionToVisible(new Set(["t1", "t2"]), visibleIds(filterOf({ equipmentType: "MB" })));
    const afterWiden = pruneSelectionToVisible(afterNarrow, visibleIds(TECHNICAL_PROCEDURE_LIST_FILTER_NONE));
    assert.deepEqual([...afterWiden], ["t2"]);
  });

  test("받은 Set 은 건드리지 않는다", () => {
    const selected = new Set(["t1", "t2"]);
    pruneSelectionToVisible(selected, visibleIds(filterOf({ equipmentType: "MB" })));
    assert.deepEqual([...selected].sort(), ["t1", "t2"]);
  });

  test("🔵 읽개가 무는가 — 보이는 목록이 비면 전부 풀린다", () => {
    const next = pruneSelectionToVisible(new Set(["t1", "t2"]), visibleIds(filterOf({ nameQuery: "없는절차" })));
    assert.equal(next.size, 0);
  });
});

// ═══════════════ ⑧ 🔴 Shift 범위는 **화면에 보이는 차례**로 돈다

describe("절차 거르기 — ⑧ 🔴 Shift 범위는 보이는 차례로", () => {
  function rangePlan(filter: TechnicalProcedureListFilter, anchorId: string, targetId: string) {
    return planRangeToggle({
      orderedIds: visibleIds(filter),
      isSelectable: (id) => !UNDELETABLE.has(id),
      isSelected: () => false,
      anchorId,
      targetId,
      shiftKey: true,
    });
  }

  test("🔵 먼저 견줄 쪽 — 안 거르면 t1~t5 사이가 전부 들어온다(막힌 t4 만 빼고)", () => {
    const plan = rangePlan(TECHNICAL_PROCEDURE_LIST_FILTER_NONE, "t1", "t5");
    assert.deepEqual(plan?.ids, ["t1", "t2", "t3", "t5"]);
    assert.equal(plan?.isRange, true);
  });

  test("🔴 거른 뒤 같은 두 끝을 잡으면 **가려진 판이 안 섞인다**", () => {
    // "검사"로 거르면 화면에는 t1·t5 두 줄뿐이다. 원본 차례로는 그 사이에
    // t2·t3·t4 가 있지만, 화면에 없으므로 범위에 들어올 수 없다.
    assert.deepEqual(visibleIds(filterOf({ nameQuery: "검사" })), ["t1", "t5"], "표본 확인");
    const plan = rangePlan(filterOf({ nameQuery: "검사" }), "t1", "t5");
    assert.deepEqual(plan?.ids, ["t1", "t5"]);
    for (const hidden of ["t2", "t3", "t4"]) {
      assert.ok(!plan?.ids.includes(hidden), `가려진 판 ${hidden} 이 Shift 범위에 섞였다`);
    }
  });

  test("🔴 거꾸로 잡아도 **화면 차례**로 돌려준다", () => {
    const plan = rangePlan(filterOf({ equipmentType: "RFG" }), "t4", "t1");
    assert.deepEqual(plan?.ids, ["t1"], "t4 는 막힌 판이라 범위 안에서도 건너뛴다");
    const mb = rangePlan(filterOf({ equipmentType: "MB" }), "t5", "t2");
    assert.deepEqual(mb?.ids, ["t2", "t5"], "아래에서 위로 잡아도 화면 차례로 선다");
  });

  test("🔴 기준점이 거르기로 가려졌으면 **보통 누르기**가 된다 — 안 보이는 자리를 기준으로 안 잡는다", () => {
    // 화면(TechnicalProcedureTemplateListScreen)이 resetAnchor 를 부르지 않는
    // 까닭이 여기에 있다 — 규칙 쪽이 이미 이 경우를 보통 누르기로 되돌린다.
    const plan = rangePlan(filterOf({ equipmentType: "MB" }), "t1", "t5");
    assert.deepEqual(plan?.ids, ["t5"], "t1 은 MB 가 아니라 화면에 없다");
    assert.equal(plan?.isRange, false);
  });
});
