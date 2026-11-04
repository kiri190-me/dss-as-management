import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import TechnicalProcedureSeriesList, {
  type TechnicalProcedureSeriesRow,
} from "./TechnicalProcedureSeriesList";
import ProcedureVersionList, { type ProcedureVersionListRow } from "./ProcedureVersionList";
import { groupProcedureTemplatesByCode } from "@/lib/domain/procedure-template-series";

/**
 * ============================================================================
 * 절차 목록은 계열당 한 줄 · 상세에는 버전 목록 (2026-11-04)
 * ============================================================================
 * 사용자가 말한 것:
 *   "내가 말한 목록이라는 건 [절차 상세] 안에 버전별로 목록을 만든다는 거였어.
 *    지금처럼 [기술 작업 절차]의 목록에 같은 이름의 절차들이 버전만 다르게
 *    있으면 오히려 버전 관리가 어려워지는 거야."
 *
 * ── 무엇을 어디서 재는가 ────────────────────────────────────────────────
 *  · 접는 **규칙**(대표 고르기·세 경우)은 unit 목록의
 *    lib/domain/procedure-template-series.test.ts 가 값으로 잰다.
 *  · 여기서는 그 결과가 **화면 글자로 나오는지**를 렌더해서 잰다. 그래서 그리는
 *    조각 둘(TechnicalProcedureSeriesList · ProcedureVersionList)을 부모에서
 *    떼어 두었다 — 부모(TechnicalProcedureTemplateListScreen ·
 *    ProcedureTemplateDetailScreen)는 서버 액션을 직접 import 해서 사슬 끝에
 *    `server-only` 가 있고, 시험에서는 import 자체가 던진다.
 *  · 떼어 낸 조각을 **어디에 어떻게 꽂았는지**와 권한 배선은 원본 글자로 읽는다
 *    (🔴 주석을 걷어낸 뒤에 — 이 저장소는 주석의 낱말 때문에 셈이 틀린 적이
 *    여러 번 있다. ①절의 마지막 단언이 걷어내기가 일하고 있다는 증거다).
 *
 * ── 🔴 초안이 새는지를 어떻게 재는가 ────────────────────────────────────
 * "초안"이라는 글자를 세면 안 된다 — 표 머리글에 [진행 중 초안] 이라는 칸
 * 이름이 늘 있어서, 초안이 하나도 없어도 그 글자는 화면에 있다. 그래서 **그
 * 초안 행의 id(링크 주소)와 판 번호**로 잰다. 그리고 같은 조각에 초안을 주면
 * 그 둘이 실제로 나타나는지도 함께 잰다 — 안 그러면 "없다" 쪽이 공짜로 통과한다.
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

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

const PATHS = {
  listScreen: "src/components/procedures/TechnicalProcedureTemplateListScreen.tsx",
  seriesList: "src/components/procedures/TechnicalProcedureSeriesList.tsx",
  detailScreen: "src/components/procedures/ProcedureTemplateDetailScreen.tsx",
  detailPage: "src/app/(app)/procedures/[id]/page.tsx",
  queries: "src/lib/db/queries/procedure-templates.ts",
} as const;

const listScreen = stripComments(read(PATHS.listScreen));
const seriesList = stripComments(read(PATHS.seriesList));
const detailScreen = stripComments(read(PATHS.detailScreen));
const detailPage = stripComments(read(PATHS.detailPage));
const queries = stripComments(read(PATHS.queries));

const noopRouter = {
  refresh: () => {},
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
} as unknown as AppRouterInstance;

function listRow(
  code: string,
  version: number,
  status: TechnicalProcedureSeriesRow["status"],
  name: string
): TechnicalProcedureSeriesRow {
  return {
    id: `${code}-v${version}`,
    code,
    version,
    status,
    name,
    equipmentType: "RFG",
    nodeCount: 7,
    edgeCount: 8,
    createdAt: "2026-10-01T00:00:00.000Z",
    publishedAt: status === "PUBLISHED" ? "2026-10-02T00:00:00.000Z" : null,
  };
}

/** 개발 DB 에서 본 세 모양 그대로 — 게시 1·초안 1 / 게시 2·초안 1 / 초안만. */
const ROWS: TechnicalProcedureSeriesRow[] = [
  listRow("tech-power-check", 4, "DRAFT", "기본 통전 검사"),
  listRow("tech-restore-check", 3, "DRAFT", "원복 검사 및 개선"),
  listRow("tech-power-check", 1, "PUBLISHED", "기본 통전 검사"),
  listRow("tech-restore-check", 2, "PUBLISHED", "원복 검사 및 개선"),
  listRow("tech-draft-only", 1, "DRAFT", "아직 게시 안 한 절차"),
  listRow("tech-restore-check", 1, "PUBLISHED", "원복 검사 및 개선"),
];

function renderSeriesList(rows: TechnicalProcedureSeriesRow[]): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={noopRouter}>
      <TechnicalProcedureSeriesList series={groupProcedureTemplatesByCode(rows)} />
    </AppRouterContext.Provider>
  );
}

function renderVersionList(versions: ProcedureVersionListRow[], currentTemplateId: string): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={noopRouter}>
      <ProcedureVersionList versions={versions} currentTemplateId={currentTemplateId} />
    </AppRouterContext.Provider>
  );
}

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const trCount = (html: string) => (html.match(/<tr\b/g) ?? []).length;

// ════════════════════════════════════════════════════════ ① 먼저 표본 확인

describe("계열 목록 — ① 먼저 표본 확인", () => {
  test("🔵 다섯 파일이 전부 읽혔고, 재려는 손잡이가 실제로 거기 있다", () => {
    for (const [name, source] of Object.entries({ listScreen, seriesList, detailScreen, detailPage, queries })) {
      assert.ok(source.length > 500, `${name} 이 비어 있거나 너무 짧다 — 경로가 틀리면 아래가 전부 공짜로 통과한다`);
    }
    assert.ok(listScreen.includes("groupProcedureTemplatesByCode(templates)"));
    assert.ok(queries.includes("export async function listProcedureTemplateVersions("));
  });

  test("🔴 주석 걷어내기가 실제로 일을 한다 — 날것에만 있는 글자로 잰다", () => {
    // 목록 화면 머리말이 "접어 놓고 체크박스를 하나 두면 … 전부? 대표만?" 하고
    // 묻는다. 그 글자가 주석에서 사라지면 아래 '삭제 모드' 단언들이 주석을 안
    // 걷어도 통과하게 되어, 시험이 아무것도 안 재는 상태로 조용히 바뀐다.
    assert.ok(read(PATHS.listScreen).includes("전부? 대표만?"), "머리말에 그 물음이 적혀 있어야 한다");
    assert.ok(!listScreen.includes("전부? 대표만?"), "걷어낸 쪽에는 주석이 없어야 한다");
  });

  test("🔵 렌더가 실제로 표를 그린다 — 아래 HTML 단언들이 빈손을 세지 않는다", () => {
    const html = renderSeriesList(ROWS);
    assert.ok(html.includes("<table"), "ResponsiveList 는 정적 렌더에서 표를 그린다(카드는 안 그린다)");
    assert.ok(html.includes("지금 게시"), "머리글이 그려져 있다");
  });
});

// ════════════════════════════════════════════════════ ② 가: 계열당 한 줄

describe("계열 목록 — ② 같은 계열이 한 줄", () => {
  const html = renderSeriesList(ROWS);

  test("🔴 여섯 판이 세 줄로 선다 — 같은 이름이 여러 줄로 반복되지 않는다", () => {
    assert.equal(trCount(html), 4, "머리글 한 줄 + 계열 세 줄");
    // 🔵 글자 그대로 세면 안 된다 — 초안 링크의 aria-label 에도 이름이 들어
    //    있어서 보이지 않는 자리가 함께 세어진다. 눈에 보이는 것만 세려고
    //    **열린 태그 바로 뒤**의 글자로 잰다.
    assert.equal(countOf(html, ">원복 검사 및 개선<"), 1, "판이 셋인 계열도 이름은 한 번만 나온다");
    assert.equal(countOf(html, ">기본 통전 검사<"), 1);
  });

  test("🔴 줄의 **이름 링크**가 가리키는 곳이 대표 판이다", () => {
    // 게시본이 있는 계열의 대표는 게시본이다 — 목록에서 이름을 누른 사람이
    // 초안을 보고 "이게 지금 쓰이는 절차"라고 읽으면 안 된다.
    //
    // 🔵 "그 주소가 화면 어딘가에 있다"로 재면 안 된다 — [지금 게시] 칸도
    //    같은 게시본으로 가는 링크라, 대표가 초안으로 바뀌어도 그 주소는
    //    여전히 화면에 있다(일부러 깨뜨려 보고 확인했다). **이름을 감싼
    //    링크**의 href 를 집어서 잰다.
    const nameHref = (name: string) =>
      html.match(new RegExp(`href="/procedures/([^"]+)"[^>]*>${name}<`))?.[1] ?? null;
    assert.equal(nameHref("기본 통전 검사"), "tech-power-check-v1", "대표(게시본 v1)로 가야 한다");
    assert.equal(nameHref("원복 검사 및 개선"), "tech-restore-check-v2", "게시본 둘이면 판 번호가 큰 쪽");
    assert.equal(nameHref("아직 게시 안 한 절차"), "tech-draft-only-v1", "게시본이 없으면 초안이 대표다");
  });

  test("초안이 있는 계열은 **그 초안으로 가는 길**을 한 줄 안에 함께 준다", () => {
    assert.ok(html.includes('href="/procedures/tech-power-check-v4"'));
    assert.ok(html.includes("v4 초안"));
  });
});

describe("계열 목록 — ③ 게시본이 둘인 계열 · 없는 계열", () => {
  const html = renderSeriesList(ROWS);

  test("🔴 게시본이 둘이면 접어 놓고 **감추지 않는다** — 개수와 판 번호를 적는다", () => {
    assert.ok(html.includes("게시본 2개"), "접기가 문제를 덮는 일이 되면 안 된다");
    // 차례는 **판 번호 내림차순**이다 — 이 화면의 다른 자리(상세의 [버전
    // 목록])와 같은 차례여야 둘을 나란히 읽을 수 있다.
    assert.ok(html.includes("v2 · v1"), "어느 판들이 함께 떠 있는지가 알맹이다");
  });

  test("🔵 견줄 쪽 — 게시본이 하나뿐인 계열에는 그 표시가 안 붙는다", () => {
    const single = renderSeriesList([
      listRow("tech-power-check", 1, "PUBLISHED", "기본 통전 검사"),
      listRow("tech-power-check", 4, "DRAFT", "기본 통전 검사"),
    ]);
    assert.ok(!single.includes("게시본 2개"));
    assert.ok(!single.includes("게시본 1개"), "늘 붙는 표시였다면 위 단언이 아무것도 못 잡는다");
  });

  test("🔴 게시본이 하나도 없는 계열 — 줄이 사라지지 않고 '게시 없음'이라고 적는다", () => {
    assert.ok(html.includes("아직 게시 안 한 절차"), "초안만 있는 계열이 목록에서 사라지면 안 된다");
    assert.ok(html.includes("게시 없음"), "빈 칸은 '모른다'로 읽힌다 — 분명한 사실을 적는다");
    assert.ok(html.includes('href="/procedures/tech-draft-only-v1"'), "대표는 그 초안이다");
  });

  test("판 수를 적는다 — 한 줄로 접었으니 몇 판인지는 그 줄이 말해야 한다", () => {
    assert.ok(html.includes("3판"), "원복 검사 계열은 세 판이다");
    assert.ok(html.includes("2판"), "통전 검사 계열은 두 판이다");
  });

  test("보관본이 있을 때만 그 수를 덧붙인다", () => {
    const withArchived = renderSeriesList([
      listRow("tech-old", 2, "ARCHIVED", "옛 절차"),
      listRow("tech-old", 1, "ARCHIVED", "옛 절차"),
    ]);
    assert.ok(withArchived.includes("보관됨 2"));
    assert.ok(!html.includes("보관됨"), "보관본이 없는 표본에는 안 나와야 한다");
  });
});

// ═══════════════════════════════════ ④ 가: 초안을 못 보는 역할에게 안 샌다

describe("계열 목록 — ④ 🔴 초안을 못 보는 역할에게 초안이 안 샌다", () => {
  /** 서버가 includeAllStatuses=false 로 읽었을 때의 모습 — 게시본만 온다. */
  const PUBLISHED_ONLY = ROWS.filter((r) => r.status === "PUBLISHED");

  test("🔵 먼저 표본 — 거른 쪽에는 초안이 한 줄도 없다", () => {
    assert.equal(PUBLISHED_ONLY.length, 3);
    assert.equal(PUBLISHED_ONLY.filter((r) => r.status === "DRAFT").length, 0);
  });

  test("🔴 초안의 주소도 판 번호도 화면에 없다", () => {
    const html = renderSeriesList(PUBLISHED_ONLY);
    assert.ok(!html.includes("tech-power-check-v4"), "초안으로 가는 길이 새어 나왔다");
    assert.ok(!html.includes("tech-restore-check-v3"));
    assert.ok(!html.includes("v4 초안"), "초안이 있다는 사실 자체가 보이면 안 된다");
    assert.ok(!html.includes("아직 게시 안 한 절차"), "초안만 있던 계열은 줄 자체가 없어야 한다");
    assert.equal(trCount(html), 3, "머리글 한 줄 + 계열 두 줄");
  });

  test("🔵 견줄 쪽 — 같은 조각이 초안을 받으면 그 둘이 실제로 나타난다", () => {
    const html = renderSeriesList(ROWS);
    assert.ok(html.includes("tech-power-check-v4"));
    assert.ok(html.includes("v4 초안"));
    assert.ok(html.includes("아직 게시 안 한 절차"));
  });

  test("🔴 거르는 곳은 **서버 한 곳**이다 — 조각도 화면도 권한을 다시 보지 않는다", () => {
    // 거르는 곳이 둘이 되면 어긋나는 날이 오고, 어긋나는 방향은 조용히 새는
    // 쪽이다. 이 조각들에는 권한 인자가 아예 없다는 것으로 못 박는다.
    for (const [name, source] of Object.entries({ seriesList })) {
      assert.ok(!source.includes("canView"), `${name} 이 권한을 직접 보고 있다`);
      assert.ok(!source.includes("hasPermission"), `${name} 이 권한을 직접 보고 있다`);
    }
    assert.ok(
      listScreen.includes("const series = useMemo(() => groupProcedureTemplatesByCode(templates), [templates]);"),
      "서버가 걸러 준 templates 를 그대로 접어야 한다"
    );
  });
});

// ══════════════════════════════════════ ⑤ 가: 삭제 모드는 판 단위로 그대로

describe("계열 목록 — ⑤ 삭제 모드는 여전히 판 단위로 돈다", () => {
  test("🔴 삭제 모드에서는 묶음을 풀고 평소에는 계열 목록을 그린다", () => {
    const painted = flat(listScreen);
    assert.ok(painted.includes(") : isDeleteMode ? ("), "삭제 모드가 제 가지를 가진다");
    assert.ok(
      painted.includes(") : ( <TechnicalProcedureSeriesList series={series} /> )}"),
      "계열 목록은 삭제 모드가 **아닐 때** 그려야 한다"
    );
  });

  test("🔴 고르는 손이 한 글자도 안 바뀌었다 — 네 자리 모두 Shift 를 넘긴다", () => {
    // 같은 잣대를 common/shift-range-selection-screens.test.ts 가 이미 들고
    // 있다(사이트 4곳). 여기서 다시 세는 까닭은 이 조각이 그 목록을 건드린
    // 당사자라, 깨지면 **여기서** 먼저 알아야 하기 때문이다.
    assert.equal(countOf(listScreen, "shiftKeyOf(event)"), 4);
    assert.equal(countOf(listScreen, "onMouseDown={preventShiftClickTextSelection}"), 4);
  });

  test("🔴 고르는 단위는 계열이 아니라 **판**이다", () => {
    const painted = flat(listScreen);
    assert.ok(painted.includes("orderedIds: templates.map((t) => t.id),"), "범위 고르기는 판 목록 차례를 쓴다");
    assert.ok(painted.includes("isSelectable: (id) => !undeletable.has(id),"), "막히는 조건도 판마다다");
    assert.ok(
      painted.includes("trash.open(\"DELETE\", targetsFrom(selectedIds, templates))"),
      "지우라고 넘기는 것도 판 행이다 — series 를 넘기면 어느 판인지가 사라진다"
    );
    assert.ok(!painted.includes("targetsFrom(selectedIds, series)"));
  });

  test("삭제 모드 안내가 '판 단위'라고 말한다 — 묶음이 풀린 까닭을 그 자리에 적는다", () => {
    assert.ok(flat(listScreen).includes("판(버전) 단위"));
  });

  test("🔴 휴지통 탭은 손대지 않았다 — 원래부터 판 단위다", () => {
    const painted = flat(listScreen);
    assert.ok(painted.includes("{row.code} · v{row.version}"), "휴지통 표가 판 번호를 적는 자리");
    assert.ok(painted.includes("휴지통 ({trashTemplates.length})"), "휴지통 수는 계열이 아니라 판 수 그대로");
    assert.ok(painted.includes("function ProcedureTrashTab("));
  });
});

// ══════════════════════════════════════════════ ⑥ 나: 상세의 버전 목록

describe("버전 목록 — ⑥ 그 계열의 모든 판이 나온다", () => {
  const VERSIONS: ProcedureVersionListRow[] = [
    { id: "v4", name: "기본 통전 검사", version: 4, status: "DRAFT", createdAt: "2026-11-01T00:00:00.000Z", publishedAt: null },
    { id: "v3", name: "기본 통전 검사", version: 3, status: "PUBLISHED", createdAt: "2026-10-01T00:00:00.000Z", publishedAt: "2026-10-05T00:00:00.000Z" },
    { id: "v2", name: "옛 이름 통전 검사", version: 2, status: "ARCHIVED", createdAt: "2026-09-01T00:00:00.000Z", publishedAt: "2026-09-05T00:00:00.000Z" },
  ];

  test("🔴 게시본·초안·보관본이 전부 한 줄씩 나온다", () => {
    const html = renderVersionList(VERSIONS, "v3");
    assert.equal((html.match(/<li\b/g) ?? []).length, 3);
    for (const label of ["초안", "게시됨", "보관됨"]) {
      assert.ok(html.includes(label), `${label} 줄이 없다`);
    }
    assert.ok(html.includes("(3판)"), "몇 판인지 머리글이 말한다");
  });

  test("🔴 누르면 **그 판의 상세**로 간다 — 새 라우트를 만들지 않았다", () => {
    const html = renderVersionList(VERSIONS, "v3");
    assert.ok(html.includes('href="/procedures/v4"'), "초안 줄은 그 초안의 상세로");
    assert.ok(html.includes('href="/procedures/v2"'));
  });

  test("🔴 지금 보는 판은 표시되고, **링크가 아니다**", () => {
    const html = renderVersionList(VERSIONS, "v3");
    assert.ok(html.includes("지금 보는 판"));
    assert.ok(html.includes('aria-current="page"'), "눈으로도 읽어 주는 장치로도 같은 말이 나와야 한다");
    assert.ok(!html.includes('href="/procedures/v3"'), "제자리로 가는 링크는 눌러도 아무 일이 없다");
    // 🔵 견줄 쪽 — 다른 판을 보고 있으면 v3 가 링크가 된다(위 단언이 공짜가 아니다).
    const fromDraft = renderVersionList(VERSIONS, "v4");
    assert.ok(fromDraft.includes('href="/procedures/v3"'));
    assert.ok(!fromDraft.includes('href="/procedures/v4"'));
  });

  test("이름이 바뀐 판만 그 이름을 함께 적는다", () => {
    const html = renderVersionList(VERSIONS, "v3");
    assert.ok(html.includes("옛 이름 통전 검사"), "개정하며 이름을 바꾼 판은 가려낼 수 있어야 한다");
    assert.equal(countOf(html, "기본 통전 검사"), 0, "지금 보는 판과 같은 이름은 세로로 반복하지 않는다");
  });

  test("🔴 게시본이 둘이면 그 사실을 적는다", () => {
    const html = renderVersionList(
      [
        { id: "v2", name: "원복 검사", version: 2, status: "PUBLISHED", createdAt: "2026-10-01T00:00:00.000Z", publishedAt: "2026-10-02T00:00:00.000Z" },
        { id: "v1", name: "원복 검사", version: 1, status: "PUBLISHED", createdAt: "2026-09-01T00:00:00.000Z", publishedAt: "2026-09-02T00:00:00.000Z" },
      ],
      "v2"
    );
    assert.ok(html.includes("게시본이 2개입니다"));
  });

  test("🔴 넘어오지 않은 판은 그릴 수 없다 — 권한 거르기는 서버가 한다", () => {
    // 초안을 못 보는 역할에게는 그 줄이 애초에 안 넘어온다(페이지가 거른다).
    const publishedOnly = VERSIONS.filter((v) => v.status === "PUBLISHED");
    const html = renderVersionList(publishedOnly, "v3");
    assert.ok(!html.includes('href="/procedures/v4"'), "초안으로 가는 길이 새어 나왔다");
    assert.ok(!html.includes("초안"));
    assert.ok(html.includes("(1판)"));
  });

  test("빈 배열이면 빈 상자를 남기지 않는다", () => {
    assert.equal(renderVersionList([], "v3"), "");
  });
});

// ═══════════════════════════════════════════ ⑦ 나: 서버에서 화면까지의 배선

describe("버전 목록 — ⑦ 서버가 거르고 화면까지 내려준다", () => {
  test("🔴 상세를 여는 관문과 버전 목록의 잣대가 **같은 변수**다", () => {
    const painted = flat(detailPage);
    assert.ok(
      painted.includes("const mayViewEveryStatus = actorMay(actingUser, canViewAllProcedureTemplateStatuses);"),
      "이 화면에서 '초안을 볼 수 있는가'의 답은 하나여야 한다"
    );
    assert.ok(painted.includes('if (template.status !== "PUBLISHED" && !mayViewEveryStatus) { notFound(); }'));
    assert.ok(
      painted.includes(
        "await listProcedureTemplateVersions(template.code, template.category, mayViewEveryStatus)"
      ),
      "다른 식을 쓰면 못 여는 판이 목록에 뜨거나(404), 보고 있는 판이 제 목록에서 사라진다"
    );
    assert.equal(countOf(detailPage, "mayViewEveryStatus"), 3, "그 답을 쓰는 자리는 셋뿐이다");
  });

  test("🔴 화면이 그것을 받아 그린다 — 플로우차트보다 위에", () => {
    const painted = flat(detailPage);
    assert.ok(painted.includes("versions={versions}"), "계산해 놓고 안 넘기면 목록이 영영 안 보인다");
    const painted2 = flat(detailScreen);
    assert.ok(painted2.includes("<ProcedureVersionList versions={versions} currentTemplateId={template.id} />"));
    assert.ok(
      painted2.indexOf("<ProcedureVersionList") < painted2.indexOf("플로우차트"),
      "어느 판을 보고 있는지는 그림을 읽기 전에 알아야 한다"
    );
    assert.ok(painted2.includes("versions = [],"), "넘기는 것을 잊은 호출부는 목록이 없다(fail-closed)");
  });

  test("🔴 조회가 줄기·분류·휴지통·상태를 전부 본다", () => {
    const body = flat(queries.slice(queries.indexOf("export async function listProcedureTemplateVersions(")));
    assert.ok(body.includes("eq(procedureTemplates.code, code)"), "줄기는 code 다");
    assert.ok(body.includes("eq(procedureTemplates.category, category)"), "같은 code 의 다른 분류가 섞이면 안 된다");
    assert.ok(body.includes("eq(procedureTemplates.isDeleted, false)"), "휴지통의 판은 눌러도 안 열린다");
    assert.ok(
      body.includes('includeAllStatuses ? undefined : eq(procedureTemplates.status, "PUBLISHED")'),
      "이웃 조회들과 같은 규약 — 부르는 쪽이 판정해서 넘긴다"
    );
    assert.ok(body.includes("orderBy(desc(procedureTemplates.version))"), "최신 판이 위에 온다");
  });

  test("🔴 목록 조회(계열 쪽)는 안 건드렸다 — 접기는 화면이 한다", () => {
    assert.ok(
      queries.includes("export async function listTechnicalProcedureTemplates(includeAllStatuses: boolean)"),
      "조회가 판 행을 그대로 내보내야 삭제 모드가 판 단위로 돌 수 있다"
    );
    assert.ok(!queries.includes("groupProcedureTemplatesByCode"), "접기를 조회로 옮기면 삭제 모드가 쓸 행이 없어진다");
  });
});
