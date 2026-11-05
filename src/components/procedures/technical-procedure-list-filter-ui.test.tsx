import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import TechnicalProcedureListFilterBar, {
  TECHNICAL_PROCEDURE_FILTER_EMPTY_TEXT,
} from "./TechnicalProcedureListFilterBar";
import TechnicalProcedureSeriesList, { type TechnicalProcedureSeriesRow } from "./TechnicalProcedureSeriesList";
import { groupProcedureTemplatesByCode } from "@/lib/domain/procedure-template-series";
import {
  PROCEDURE_EQUIPMENT_TYPE_CODES,
  procedureEquipmentTypeLabels,
} from "@/lib/domain/procedure-template-types";
import {
  TECHNICAL_PROCEDURE_LIST_FILTER_NONE,
  filterTechnicalProcedureRows,
  filterTechnicalProcedureSeries,
  type TechnicalProcedureListFilter,
} from "@/lib/domain/technical-procedure-list-filter";

/**
 * ============================================================================
 * [기술 작업 절차] 목록 — 거르개가 **화면에 서고, 화면이 그 규칙을 문다** (2026-11-05)
 * ============================================================================
 * 거르기 **규칙**은 unit 목록의 lib/domain/technical-procedure-list-filter.test.ts
 * 가 값으로 잰다(삭제 사고 셋 포함). 여기서 재는 것은 둘이다.
 *
 *  ① 거르개 줄이 **실제로 그려지는가** — 이름 칸 · 설비 유형 고르개 넷(전체 + 셋) ·
 *    세는 글. 🔴 이름표는 `procedureEquipmentTypeLabels` 한 벌에서 와야 한다
 *    (손으로 다시 적으면 이름이 바뀌는 날 거르개만 옛 글자로 남는다).
 *
 *  ② 🔴 목록 화면이 그 규칙을 **빠짐없이 물고 있는가** — 거르기는 맞게 짜 두고
 *    화면이 거르기 전 목록을 그리면 아무 오류 없이 전과 똑같이 돈다. 특히
 *    **표와 카드 둘 다**여야 한다: ResponsiveList 가 폭을 재서 하나를 고르므로,
 *    한쪽만 거르면 창 크기에 따라 거르개가 듣다 안 듣다 한다.
 *
 * ── 🔴 왜 목록 화면을 렌더하지 않는가 ───────────────────────────────────
 * TechnicalProcedureTemplateListScreen 은 휴지통 서버 액션을 직접 import 해서
 * 사슬 끝에 `server-only` 가 있다 — 시험에서 import 자체가 던진다. 그래서
 * 이웃(procedure-series-and-version-list.test.tsx · shift-range-selection-
 * screens.test.ts)과 같은 방법으로 **원본을 글자로** 읽는다.
 *
 * 🔴 **주석을 걷어낸 뒤에 센다.** 이 화면의 머리말은 거르기를 왜 이렇게 했는지를
 * 길게 적고 있고, 그 안에 `visibleTemplates` · `selectableVisibleIds` 같은 글자가
 * 그대로 들어 있다. 안 걷으면 **고쳐 놓고도** 셈이 틀어지고, 반대로 "있어야
 * 한다" 쪽은 주석만으로 영영 통과한다. 걷어내기가 일한다는 증거는 ②절 첫 시험.
 * ============================================================================
 */

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

const flat = (source: string) => source.replace(/\s+/g, " ");
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

const SCREEN_PATH = "src/components/procedures/TechnicalProcedureTemplateListScreen.tsx";
const BAR_PATH = "src/components/procedures/TechnicalProcedureListFilterBar.tsx";

const rawScreen = read(SCREEN_PATH);
const screen = stripComments(rawScreen);
const flatScreen = flat(screen);
const bar = stripComments(read(BAR_PATH));

const noopRouter = {
  refresh: () => {},
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
} as unknown as AppRouterInstance;

function renderBar(
  filter: TechnicalProcedureListFilter,
  counts: { totalCount: number; visibleCount: number; unitLabel: string } = {
    totalCount: 12,
    visibleCount: 3,
    unitLabel: "절차",
  }
): string {
  return renderToStaticMarkup(
    <TechnicalProcedureListFilterBar filter={filter} onFilterChange={() => {}} {...counts} />
  );
}

function listRow(
  code: string,
  version: number,
  status: TechnicalProcedureSeriesRow["status"],
  name: string,
  equipmentType: TechnicalProcedureSeriesRow["equipmentType"]
): TechnicalProcedureSeriesRow {
  return {
    id: `${code}-v${version}`,
    code,
    version,
    status,
    name,
    equipmentType,
    nodeCount: 5,
    edgeCount: 6,
    createdAt: "2026-10-01T00:00:00.000Z",
    publishedAt: status === "PUBLISHED" ? "2026-10-02T00:00:00.000Z" : null,
  };
}

/** 🔴 전부 가짜 이름이다 — 실제 고객사·제품 이름을 시험에 넣지 않는다. */
const ROWS: TechnicalProcedureSeriesRow[] = [
  listRow("tp-a", 1, "PUBLISHED", "기본 통전 검사", "RFG"),
  listRow("tp-b", 1, "PUBLISHED", "매칭 박스 커패시터 교체", "MB"),
  listRow("tp-c", 1, "PUBLISHED", "외관 세척 및 포장", "COMMON"),
];

function renderSeriesList(filter: TechnicalProcedureListFilter): string {
  const series = filterTechnicalProcedureSeries(groupProcedureTemplatesByCode(ROWS), filter);
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={noopRouter}>
      <TechnicalProcedureSeriesList series={series} />
    </AppRouterContext.Provider>
  );
}

// ════════════════════════════════════════════ ① 거르개 줄이 실제로 그려진다

describe("거르개 줄 — ① 그려지는 것", () => {
  test("🔵 먼저 표본 — 렌더가 비어 있지 않고 칸 둘이 실제로 선다", () => {
    const html = renderBar(TECHNICAL_PROCEDURE_LIST_FILTER_NONE);
    assert.ok(html.length > 200, "렌더가 비면 아래가 전부 공짜로 통과한다");
    assert.ok(html.includes("이름 검색"), "이름 칸의 이름표");
    assert.ok(html.includes("설비 유형"), "설비 유형 고르개의 이름표");
    assert.ok(html.includes('type="search"'), "이름 칸이 실제로 입력 칸이다");
  });

  test("🔴 설비 유형 고르개는 「전체」 + 셋이고, 글자는 **공용 표**에서 온다", () => {
    const html = renderBar(TECHNICAL_PROCEDURE_LIST_FILTER_NONE);
    assert.equal((html.match(/<option/g) ?? []).length, 4, "전체 + 설비 유형 셋");
    assert.ok(html.includes(">전체</option>"));
    for (const code of PROCEDURE_EQUIPMENT_TYPE_CODES) {
      assert.ok(html.includes(`value="${code}"`), `값이 enum 글자여야 한다: ${code}`);
      assert.ok(html.includes(`>${procedureEquipmentTypeLabels[code]}</option>`), `이름표가 없다: ${code}`);
    }
    // 🔴 글자를 손으로 다시 적으면 공용 표가 바뀌는 날 여기만 옛 이름으로 남는다.
    //    "RF Generator" 같은 글자가 조각 안에 **박혀 있지 않은지** 본다.
    for (const code of PROCEDURE_EQUIPMENT_TYPE_CODES) {
      assert.ok(
        !bar.includes(procedureEquipmentTypeLabels[code]),
        `${code} 의 이름표가 조각에 박혀 있다 — procedureEquipmentTypeLabels 를 쓸 것`
      );
    }
    assert.ok(bar.includes("procedureEquipmentTypeLabels[code]"), "공용 표에서 꺼내 그려야 한다");
  });

  test("🔴 고른 값이 칸에 실려 그려진다 — 안 실리면 고르개가 늘 [전체]로 보인다", () => {
    const html = renderBar({ nameQuery: "통전", equipmentType: "MB" });
    assert.ok(html.includes('value="통전"'), "친 글자가 칸에 남아야 한다");
    assert.ok(/<select[^>]*>[\s\S]*?<option value="MB" selected/.test(html), "고른 설비 유형이 선택돼 있어야 한다");
  });

  test("🔴 세는 글 — 거르는 중에만 「N개 중 M개」가 되고, 단위 낱말이 함께 선다", () => {
    const idle = renderBar(TECHNICAL_PROCEDURE_LIST_FILTER_NONE);
    assert.ok(idle.includes("절차 12개"), "안 거를 때는 전체 수만 말한다");
    assert.ok(!idle.includes("중 3개"), "거르지 않는데 '중 M개'가 뜨면 거른 줄 안다");

    const active = renderBar({ nameQuery: "통전", equipmentType: "ALL" });
    assert.ok(active.includes("절차 12개 중 3개"), "거르는 중에는 둘 다 말한다");

    // 삭제 모드는 묶음을 풀어 **판**마다 한 줄이라 단위가 다르다.
    const inDeleteMode = renderBar(
      { nameQuery: "통전", equipmentType: "ALL" },
      { totalCount: 28, visibleCount: 5, unitLabel: "판" }
    );
    assert.ok(inDeleteMode.includes("판 28개 중 5개"));
  });

  test("🔴 [거르기 지우기]는 거르는 중에만 선다 — 켜 둔 것을 잊은 사람의 되돌리는 길", () => {
    assert.ok(!renderBar(TECHNICAL_PROCEDURE_LIST_FILTER_NONE).includes("거르기 지우기"), "안 거를 때는 없다");
    assert.ok(renderBar({ nameQuery: "통전", equipmentType: "ALL" }).includes("거르기 지우기"));
    assert.ok(renderBar({ nameQuery: "", equipmentType: "RFG" }).includes("거르기 지우기"), "설비만 걸어도 선다");
  });

  test("🔴 조각은 제 안에 값을 쥐지 않는다 — 고르기를 푸는 일이 부르는 쪽에 있어야 한다", () => {
    assert.ok(!bar.includes("useState"), "거르개가 제 상태를 쥐면 화면이 선택을 추릴 기회를 잃는다");
    assert.ok(!bar.includes("pruneSelectionToVisible"), "추리기는 목록 화면의 일이다");
  });
});

// ════════════════════════════════════ ② 목록 화면이 그 규칙을 물고 있다

describe("목록 화면 — ② 거르기가 실제로 배선돼 있다", () => {
  test("🔴 주석 걷어내기가 일을 한다 — 날것에만 있는 글자로 잰다", () => {
    // 머리말이 "거르는 자리가 둘이다" 하고 적는다. 그 글자가 주석에서 사라지면
    // 아래 단언들이 주석을 안 걷어도 통과하게 되어, 시험이 조용히 무력해진다.
    assert.ok(rawScreen.includes("거르는 자리가 둘이다"), "머리말에 그 말이 적혀 있어야 한다");
    assert.ok(!screen.includes("거르는 자리가 둘이다"), "걷어낸 쪽에는 주석이 없어야 한다");
    assert.ok(screen.length > 500, "걷어내기가 파일을 통째로 먹지 않았다");
  });

  test("🔴 거르기 규칙을 **공용 모듈에서** 가져온다 — 화면이 따로 적으면 두 벌이 된다", () => {
    assert.ok(screen.includes('from "@/lib/domain/technical-procedure-list-filter"'));
    for (const name of [
      "filterTechnicalProcedureRows",
      "filterTechnicalProcedureSeries",
      "pruneSelectionToVisible",
      "TECHNICAL_PROCEDURE_LIST_FILTER_NONE",
    ]) {
      assert.ok(screen.includes(name), `안 쓰고 있다: ${name}`);
    }
  });

  test("🔴 거르는 자리가 둘이다 — 계열 줄과 판 줄, 그리고 접기는 거르기 **전**에 한다", () => {
    assert.ok(
      flatScreen.includes("const series = useMemo(() => groupProcedureTemplatesByCode(templates), [templates]);"),
      "거른 뒤에 접으면 검색어에 따라 계열의 대표가 바뀐다"
    );
    assert.ok(
      flatScreen.includes("const visibleSeries = useMemo(() => filterTechnicalProcedureSeries(series, filter), [series, filter]);")
    );
    assert.ok(
      flatScreen.includes("const visibleTemplates = useMemo(() => filterTechnicalProcedureRows(templates, filter), [templates, filter]);")
    );
  });

  test("🔴 **표와 카드 둘 다** 거른 목록을 그린다 — 한쪽만이면 창 크기에 따라 듣다 안 듣다 한다", () => {
    assert.equal(countOf(screen, "visibleTemplates.map((t) => {"), 2, "삭제 모드의 표와 카드 둘");
    // 하나는 table 슬롯 안, 하나는 cards 슬롯 안이어야 한다 — 자리로 못 박는다.
    const tableAt = screen.indexOf("table={");
    const cardsAt = screen.indexOf("cards={", tableAt);
    const firstMap = screen.indexOf("visibleTemplates.map((t) => {");
    const secondMap = screen.indexOf("visibleTemplates.map((t) => {", firstMap + 1);
    assert.ok(tableAt > 0 && cardsAt > tableAt && firstMap > 0 && secondMap > 0, "네 자리를 다 찾아야 한다");
    assert.ok(tableAt < firstMap && firstMap < cardsAt, "첫 번째는 표 슬롯 안이어야 한다");
    assert.ok(cardsAt < secondMap, "두 번째는 카드 슬롯 안이어야 한다");
    // 평소 목록(계열)은 조각 하나가 표와 카드를 함께 그린다 — 거른 계열을 넘기면 둘 다 걸린다.
    assert.ok(flatScreen.includes("<TechnicalProcedureSeriesList series={visibleSeries} />"));
  });

  test("🔴 거르기 전 목록을 그리는 자리가 **하나도 남아 있지 않다**", () => {
    // `visibleTemplates.map(` 가 `templates.map(` 를 품으므로 앞 글자까지 본다.
    assert.equal(screen.match(/(?<![A-Za-z])templates\.map\(/), null, "거르기 전 판 목록을 그리거나 범위로 쓰고 있다");
    assert.equal(
      flatScreen.match(/<TechnicalProcedureSeriesList series=\{series\}/),
      null,
      "거르기 전 계열을 그리고 있다"
    );
  });

  test("🔴 [전체 선택]의 대상은 **보이는 것**이다 — 표 머리글과 삭제 모드 바 둘 다", () => {
    assert.equal(
      countOf(flatScreen, "selectableCount={selectableVisibleIds.length}"),
      2,
      "표 머리글과 삭제 모드 바, 두 자리 모두"
    );
    assert.ok(
      flatScreen.includes("const selectableVisibleIds = useMemo( () => visibleTemplates.filter((t) => !undeletable.has(t.id)).map((t) => t.id),"),
      "고를 수 있는 것은 **보이는 판** 중 막히지 않은 것이다"
    );
    assert.ok(
      flatScreen.includes("setSelectedIds((previous) => setIdsChecked(previous, selectableVisibleIds, nextChecked));"),
      "담을 때도 풀 때도 보이는 것만 — 공용 규칙(select-all-checkbox 머리말)과 같은 말이다"
    );
    assert.ok(
      !flatScreen.includes("new Set(selectableIds)"),
      "거르기 전 전체를 담는 옛 모양이 남아 있다"
    );
  });

  test("🔴 거르개가 바뀌면 **가려진 판의 고르기를 그 자리에서 푼다**", () => {
    assert.ok(flatScreen.includes("function changeFilter(next: TechnicalProcedureListFilter) {"));
    assert.ok(
      flatScreen.includes("setSelectedIds((previous) => pruneSelectionToVisible(previous, visibleIds));"),
      "추리기를 안 하면 사람이 보지도 못한 판이 [선택 삭제]에 딸려 간다"
    );
    // 🔴 거르개를 바꾸는 길이 **하나뿐**이어야 한다. 거르개 줄을 setFilter 에 바로
    //    꽂으면 추리기를 건너뛰는 길이 생기고, 그 길은 오류 없이 조용하다.
    assert.equal(countOf(screen, "setFilter("), 1, "setFilter 를 부르는 곳은 changeFilter 하나여야 한다");
    assert.ok(flatScreen.includes("onFilterChange={changeFilter}"));
    assert.ok(!flatScreen.includes("onFilterChange={setFilter}"));
    // 🔵 효과(useEffect)로 미루면 "화면에 없는데 골라진" 순간이 생긴다.
    assert.ok(!screen.includes("useEffect"), "추리기를 효과로 미루지 않았다");
  });

  test("🔴 삭제로 넘기는 것은 고른 그 판들이다 — 거르개가 그 길을 바꾸지 않았다", () => {
    assert.ok(flatScreen.includes('trash.open("DELETE", targetsFrom(selectedIds, templates))'));
    assert.ok(!flatScreen.includes("targetsFrom(selectedIds, series)"));
  });

  test("🔴 비어 있는 까닭 둘을 **다른 말로** 말한다", () => {
    assert.ok(flatScreen.includes("표시할 기술 절차가 없습니다."), "한 줄도 없을 때");
    assert.ok(flatScreen.includes("{TECHNICAL_PROCEDURE_FILTER_EMPTY_TEXT}"), "거른 결과가 0건일 때");
    // 🔴 보이는 판이 0판이면 삭제 모드 안내 두 글을 **둘 다 안 그린다** —
    //    "보이는 0판 모두 수행 기록이 있습니다"는 세어 본 적 없는 것을 단정하는
    //    거짓말이 된다(까닭은 바로 아래 빈 목록 글이 말한다).
    assert.ok(
      flatScreen.includes("{visibleTemplates.length === 0 ? null : selectableVisibleIds.length === 0 ? ("),
      "0판일 때 삭제 모드 안내가 거짓을 말하지 않게 막는 가지"
    );
    assert.ok(flatScreen.includes("보이는 {visibleTemplates.length}판 모두"), "1판 이상일 때는 보이는 수로 말한다");
    assert.notEqual(
      TECHNICAL_PROCEDURE_FILTER_EMPTY_TEXT,
      "표시할 기술 절차가 없습니다.",
      "두 글이 같으면 거르개를 켜 둔 것을 잊은 사람이 '다 사라졌다'고 읽는다"
    );
    assert.ok(TECHNICAL_PROCEDURE_FILTER_EMPTY_TEXT.includes("조건에 맞는"));
  });

  test("🔵 거르개는 **사용중 탭에만** 선다 — 휴지통은 이번 범위가 아니다", () => {
    const barAt = flatScreen.indexOf("<TechnicalProcedureListFilterBar");
    const trashTabAt = flatScreen.indexOf("<ProcedureTrashTab");
    assert.ok(barAt > 0 && trashTabAt > 0, "두 자리를 다 찾아야 한다");
    assert.ok(trashTabAt < barAt, "휴지통 가지가 먼저 닫히고 그 다음 가지에 거르개가 선다");
    // 휴지통 쪽 고르기는 한 글자도 안 바뀌었다.
    assert.ok(
      flatScreen.includes("setTrashSelectedIds(nextChecked ? new Set(trashTemplates.map((t) => t.id)) : new Set())")
    );
  });

  test("🔴 탭의 수는 **거르개와 무관한 전체**다 — 따라 움직이면 몇 개가 숨겨졌는지 모른다", () => {
    assert.ok(flatScreen.includes("사용중 ({series.length})"), "거른 수로 바꾸면 안 된다");
    assert.ok(flatScreen.includes("휴지통 ({trashTemplates.length})"));
    assert.ok(
      flatScreen.includes("totalCount={isDeleteMode ? templates.length : series.length}"),
      "거르개 줄이 말하는 전체 수도 같은 것을 센다"
    );
    assert.ok(flatScreen.includes("visibleCount={isDeleteMode ? visibleTemplates.length : visibleSeries.length}"));
    assert.ok(flatScreen.includes('unitLabel={isDeleteMode ? "판" : "절차"}'), "세는 단위가 가지마다 다르다");
  });
});

// ═══════════════════════════════ ③ 평소 목록이 거른 결과를 실제로 그린다

describe("평소 목록 — ③ 거른 계열만 줄로 선다", () => {
  test("🔵 먼저 표본 — 안 거르면 세 줄이 다 나온다", () => {
    const html = renderSeriesList(TECHNICAL_PROCEDURE_LIST_FILTER_NONE);
    assert.ok(html.includes("<table"), "ResponsiveList 는 정적 렌더에서 표를 그린다");
    for (const name of ["기본 통전 검사", "매칭 박스 커패시터 교체", "외관 세척 및 포장"]) {
      assert.ok(html.includes(name), `${name} 줄이 없다`);
    }
  });

  test("🔴 이름으로 거르면 안 걸린 줄이 **화면에서 사라진다**", () => {
    const html = renderSeriesList({ nameQuery: "통전", equipmentType: "ALL" });
    assert.ok(html.includes("기본 통전 검사"));
    assert.ok(!html.includes("매칭 박스 커패시터 교체"), "안 걸린 줄이 남아 있다");
    assert.ok(!html.includes("외관 세척 및 포장"));
  });

  test("🔴 설비 유형으로 거르면 그 유형만 남는다", () => {
    const html = renderSeriesList({ nameQuery: "", equipmentType: "MB" });
    assert.ok(html.includes("매칭 박스 커패시터 교체"));
    assert.ok(!html.includes("기본 통전 검사"));
    // 🔵 설비 유형 칸의 글자도 함께 확인 — 거른 결과가 정말 MB 줄이다.
    assert.ok(html.includes(procedureEquipmentTypeLabels.MB));
    assert.ok(!html.includes(procedureEquipmentTypeLabels.COMMON));
  });

  test("🔴 삭제 모드가 쓰는 판 줄도 같은 규칙으로 걸린다", () => {
    const rows = filterTechnicalProcedureRows(ROWS, { nameQuery: "", equipmentType: "RFG" });
    assert.deepEqual(rows.map((r) => r.name), ["기본 통전 검사"]);
  });
});
