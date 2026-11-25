import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import CaseFlowchartNodePropertyPanel, {
  CASE_NODE_SHARE_DOC_CLEAR_TEXT,
  CASE_NODE_SHARE_DOC_EMPTY_TEXT,
  CASE_NODE_SHARE_DOC_HINT,
  CASE_NODE_SHARE_DOC_TITLE,
  CaseFlowchartNodeShareDocRow,
  type CaseFlowchartNodeDraft,
} from "./CaseFlowchartNodePropertyPanel";
import CaseFlowchartNodeShareDocPicker, {
  CASE_NODE_SHARE_DOC_CLOSE_TEXT,
  CASE_NODE_SHARE_DOC_EMPTY_TEXT as PICKER_EMPTY_TEXT,
  CASE_NODE_SHARE_DOC_FAILED_TEXT,
  CASE_NODE_SHARE_DOC_LOADING_TEXT,
  CASE_NODE_SHARE_DOC_OPEN_TEXT,
  CASE_NODE_SHARE_DOC_PICK_TEXT,
  CASE_NODE_SHARE_DOC_PICKER_TITLE,
  CASE_NODE_SHARE_DOC_REPLACE_HINT,
  CASE_NODE_SHARE_DOC_ROOT_HINT,
  CaseFlowchartNodeShareDocPickerDialog,
  CaseFlowchartNodeShareDocPickerView,
  canOpenCaseFlowchartNodeShareDoc,
  canPickCaseFlowchartNodeShareDocEntry,
  caseFlowchartNodeShareDocEntriesUrl,
  caseFlowchartNodeShareDocEntryPath,
  caseFlowchartNodeShareDocFileName,
  caseFlowchartNodeShareDocParentPath,
  readCaseFlowchartNodeShareDocEntriesAnswer,
  type CaseFlowchartNodeShareDocEntryView,
  type CaseFlowchartNodeShareDocPickerState,
} from "./CaseFlowchartNodeShareDocPicker";
import type { CaseFlowchartGraphNode } from "./CaseFlowchartGraph";

/**
 * ============================================================================
 * 진단 Flowchart 노드의 「관련 파일」 — 화면 쪽 (2026-11-25)
 * ============================================================================
 * 서버 쪽 규율은 이웃 시험들이 본다(목록 통로 원본 · 검사와 저장 배선). 여기서는 **화면이
 * 무엇을 내는가**만 본다.
 *
 * ── 🔴 2026-11-25 **화면이 깨져서 구조가 바뀌었다** ──────────────────────
 * 고르는 창이 속성 패널 **안에** 통째로 들어가 있었고, 패널이 좁아 긴 한글 이름이 「(삭 /
 * 제 / 예 / 정) / 7. / 디 …」처럼 **한 글자에 한 줄씩** 세로로 떨어졌다(사용자 신고).
 * 이제 패널에는 [파일 고르기] 단추만 남고 목록은 **팝업** 안에 있다. 그래서 이 파일이
 * 재는 것이 하나 늘었다 — 🔴 **패널에 목록 markup 이 한 조각도 없는가**(⑦). 「없다」만
 * 재면 표시 이름이 바뀌는 날 조용히 통과하므로 **같은 조각들이 팝업에는 있는지**를 바로
 * 옆에서 함께 센다.
 *
 * ── 🔴 개발 PC 에 설정이 **있다**(2026-11-25 실측) ───────────────────────
 * 전에 이 자리에 「`REPAIR_DOCS_ARCHIVE_DIR` 가 비어 있어 이 PC 에서는 창이 안 뜬다」고
 * 적혀 있었는데 **사실이 아니었다** — 사용자 화면에 폴더 목록이 실제로 뜬다. 그래도
 * `disabled` 쪽 규율은 그대로 잰다(①): 설정이 없는 환경이 **운영에도 있을 수 있고**,
 * 그때 단추가 서면 눌러도 빈 창이 뜬다.
 *
 * ── 왜 글자 매칭이 아니라 그려 보는가 ────────────────────────────────────
 * 「단추가 있는가 · 없는가」는 상태를 넣어 실제로 그려 보는 쪽이 정확하다. 🔴 두 조각은
 * 서버 액션을 한 줄도 물지 않으므로(고르기는 `onPick`, 저장은 화면의 [저장]) 이 틀에서
 * 그대로 그려진다.
 *
 * ⚠️ 🔴 **이 저장소의 화면 시험에는 DOM 이 없다**(renderToStaticMarkup 뿐이고 jsdom 이
 * 없다) — **누를 수가 없다.** 그래서 「눌렀을 때 무엇이 일어나는가」(고르면 닫힌다 · 그냥
 * 닫으면 초안이 그대로다)는 그려진 결과와 **원본 글자**로 가른다. 이웃
 * share-doc-folder-picker-dialog.test.tsx 가 같은 까닭으로 같은 길을 쓴다.
 *
 * ── 🔵 [열기] 단추는 **여기서 안 그려진다** ──────────────────────────────
 * ContactFolderEntryOpenButton 은 Windows 데스크톱이 아닌 환경(서버 렌더 · 이 시험)에서
 * 스스로 아무것도 그리지 않는다. 그래서 아래 시험들은 「[열기]가 떴는가」가 아니라
 * **「열 수 있는 줄인가」를 정하는 순수 함수**와 「경로가 보이는가」를 잰다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const pickerSource = read("src/components/repair-cases/flowchart/CaseFlowchartNodeShareDocPicker.tsx");
const panelSource = read("src/components/repair-cases/flowchart/CaseFlowchartNodePropertyPanel.tsx");
const screenSource = read("src/components/repair-cases/flowchart/CaseFlowchartEditorScreen.tsx");

const CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INSIDE = "1. 수리 관련";
const FILE_PATH = `${INSIDE}/점검 절차.pdf`;
/** 🔴 실제로 깨졌던 그 이름 — 길고 한글이고 마디가 섞여 있다(사용자 화면 2026-11-25). */
const LONG_NAME = "(삭제예정) 7. 디에스에스 수리품 목록 및 현황_20220707.xlsx";

/**
 * 🔴 **목록이 있다는 것을 알리는 조각들.** 패널에는 하나도 없어야 하고(⑦-2) 팝업에는
 * 전부 있어야 한다(⑦-3). 마지막 것은 **패널을 깨뜨린 바로 그 grid** 다 — 고정 칸이
 * 24rem 이라 좁은 상자 안에서 이름 칸이 0 으로 눌린다.
 */
const LIST_MARKERS = [
  "data-case-node-share-doc-picker",
  "data-case-node-share-doc-trail",
  "data-case-node-share-doc-entry",
  "data-share-folder-entry-filter",
  "sm:grid-cols-[minmax(0,1fr)",
];

const entry = (
  name: string,
  isDirectory = false,
  extra: Partial<CaseFlowchartNodeShareDocEntryView> = {}
): CaseFlowchartNodeShareDocEntryView => ({ name, isDirectory, sizeBytes: 1, ...extra });

const listed = (
  entries: CaseFlowchartNodeShareDocEntryView[],
  overrides: Partial<Extract<CaseFlowchartNodeShareDocPickerState, { kind: "listed" }>> = {}
): CaseFlowchartNodeShareDocPickerState => ({
  kind: "listed",
  entries,
  totalCount: entries.length,
  truncated: false,
  ...overrides,
});

/** 팝업의 **속**만 — 목록을 그리는 조각 하나다. */
function pickerMarkup(
  state: CaseFlowchartNodeShareDocPickerState,
  { insidePath = INSIDE, withPick = true }: { insidePath?: string; withPick?: boolean } = {}
): string {
  return renderToStaticMarkup(
    createElement(CaseFlowchartNodeShareDocPickerView, {
      state,
      insidePath,
      onNavigate: () => undefined,
      onFilterQueryChange: () => undefined,
      ...(withPick ? { onPick: () => undefined } : {}),
    })
  );
}

/** 팝업 **전체** — 틀(닫는 길 · 폭 · 물려받는 글자 끊기)까지 함께 본다. */
function dialogMarkup(
  state: CaseFlowchartNodeShareDocPickerState,
  { insidePath = INSIDE, withPick = true }: { insidePath?: string; withPick?: boolean } = {}
): string {
  return renderToStaticMarkup(
    createElement(CaseFlowchartNodeShareDocPickerDialog, {
      state,
      insidePath,
      filterQuery: "",
      onNavigate: () => undefined,
      onFilterQueryChange: () => undefined,
      onClose: () => undefined,
      ...(withPick ? { onPick: () => undefined } : {}),
    })
  );
}

/**
 * 🔴 **아직 안 누른** 상태의 고르기 조각. 효과가 돌지 않으므로 통로도 안 부르고 `isOpen`
 * 은 첫 값(false) 그대로다 — 「누르기 전에는 팝업이 없다」를 그대로 잰다.
 */
function closedPickerMarkup(): string {
  return renderToStaticMarkup(
    createElement(CaseFlowchartNodeShareDocPicker, { repairCaseId: CASE_ID, onPick: () => undefined })
  );
}

const node: CaseFlowchartGraphNode = {
  id: "11111111-1111-4111-8111-111111111111",
  nodeType: "TASK",
  title: "노드 하나",
  description: null,
  instructions: null,
  shareDocRelativePath: null,
  positionX: 0,
  positionY: 0,
};

const draftOf = (shareDocRelativePath: string | null): CaseFlowchartNodeDraft => ({
  title: node.title,
  description: "",
  instructions: "",
  nodeType: node.nodeType,
  shareDocRelativePath,
});

function panelMarkup(shareDocRelativePath: string | null, canEdit: boolean): string {
  return renderToStaticMarkup(
    createElement(CaseFlowchartNodePropertyPanel, {
      repairCaseId: CASE_ID,
      node: { ...node, shareDocRelativePath },
      allNodes: [{ ...node, shareDocRelativePath }],
      canEdit,
      draft: draftOf(shareDocRelativePath),
      onDraftChange: () => undefined,
      onPositionDraftChange: () => undefined,
      onDelete: () => undefined,
      resolveNodeDimensions: () => ({ width: 100, height: 50 }),
    })
  );
}

describe("① 🔴 설정이 비면(disabled) 고르는 창을 **아예 안 그린다**", () => {
  test("🔵 먼저 표본 확인 — 원본 셋을 실제로 읽었다", () => {
    for (const [name, source] of Object.entries({ pickerSource, panelSource, screenSource })) {
      assert.ok(source.length > 2000, `${name} 이 비어 있거나 너무 짧다 — 아래 단언이 공짜로 통과한다`);
    }
  });

  test("상태가 disabled 면 빈 글자다 — 설정이 없는 환경에서 빈 상자가 늘지 않게", () => {
    assert.equal(pickerMarkup({ kind: "disabled" }), "");
    assert.deepEqual(readCaseFlowchartNodeShareDocEntriesAnswer({ status: "disabled" }), { kind: "disabled" });
  });

  test("🔴 설정이 비어도 **가리킨 줄과 [가리킴 지우기]는 그대로** 선다 — 그쪽은 DB 다", () => {
    const html = panelMarkup(FILE_PATH, true);
    assert.ok(html.includes(CASE_NODE_SHARE_DOC_TITLE), html);
    assert.ok(html.includes(FILE_PATH), "가리킨 경로가 안 보인다");
    assert.ok(html.includes("data-case-node-share-doc-clear"), "지우는 길이 사라졌다");
  });

  test("다른 상태는 그려진다 — 불러오는 중 · 비었음 · 읽지 못함", () => {
    assert.ok(pickerMarkup({ kind: "loading" }).includes(CASE_NODE_SHARE_DOC_LOADING_TEXT));
    assert.ok(pickerMarkup(listed([])).includes(PICKER_EMPTY_TEXT));
    const failed = pickerMarkup({ kind: "failed", reason: "공유폴더에 연결할 수 없습니다" });
    assert.ok(failed.includes(CASE_NODE_SHARE_DOC_FAILED_TEXT), failed);
    assert.ok(failed.includes("공유폴더에 연결할 수 없습니다"), failed);
  });

  test("🔴 설정이 비면 **[파일 고르기] 단추도 안 선다** — 눌렀는데 빈 창이면 「고장났나」가 된다", () => {
    const body = code(pickerSource);
    // 🔵 표본 먼저 — 단추를 그리는 자리가 실제로 있다(없으면 아래 차례 단언이 공짜다).
    const openAt = body.indexOf("data-case-node-share-doc-open=");
    assert.ok(openAt > 0, "[파일 고르기] 단추를 그리는 자리를 못 찾았다");
    // 🔴 단추를 쥔 조각 **안에서** disabled 를 가른다 — 창(View)의 같은 문장이 아니다.
    const pickerAt = body.indexOf("export default function CaseFlowchartNodeShareDocPicker");
    assert.ok(pickerAt > 0 && pickerAt < openAt, "단추를 쥔 조각을 못 찾았다");
    const guardAt = body.indexOf('if (state.kind === "disabled") return null;', pickerAt);
    assert.ok(guardAt > 0, "단추를 쥔 조각에 disabled 갈래가 없다 — 설정이 비어도 단추가 선다");
    assert.ok(guardAt < openAt, "disabled 갈래가 단추보다 아래에 있다 — 그러면 단추가 먼저 그려진다");
  });
});

describe("② 🔴 고를 수 있는 줄은 **파일, 그것도 열 수 있는 파일뿐**이다", () => {
  test("파일 줄에만 [지정]이 선다 — 폴더 줄에는 없다", () => {
    const html = pickerMarkup(listed([entry("2026", true), entry("점검 절차.pdf")]));
    // 🔵 `="` 까지 붙여 센다 — 창 자체의 표시(`…-picker`)가 같은 글자로 시작한다.
    assert.equal(html.match(/data-case-node-share-doc-pick="/g)?.length, 1, html);
    assert.ok(html.includes(`>${CASE_NODE_SHARE_DOC_PICK_TEXT}</button>`), html);
    // 폴더 줄은 **들어가는 길**로 산다.
    assert.equal(html.match(/data-case-node-share-doc-enter/g)?.length, 1, html);
  });

  test("🔴 허용 목록 밖 · 확장자 없는 이름에는 [지정]이 없다 — 확장자를 제 손으로 세지 않는다", () => {
    for (const name of ["설치.exe", "실행.BAT", "문서", "보고서.pdf.", "보고서.pdf "]) {
      assert.equal(canPickCaseFlowchartNodeShareDocEntry(entry(name), INSIDE), false, name);
    }
    for (const name of ["점검 절차.pdf", "체크시트.xlsx", "사진.JPG"]) {
      assert.equal(canPickCaseFlowchartNodeShareDocEntry(entry(name), INSIDE), true, name);
    }
    const html = pickerMarkup(listed([entry("사진", true), entry("설치.exe"), entry("문서"), entry("점검 절차.pdf")]));
    assert.equal(html.match(/data-case-node-share-doc-entry-pickable/g)?.length, 1, html);
  });

  test("🔴 맨 위 칸에서는 **아무 줄도** 못 고른다 — 열 수 없는 자리를 가리키게 두지 않는다", () => {
    assert.equal(canPickCaseFlowchartNodeShareDocEntry(entry("점검 절차.pdf"), ""), false);
    const html = pickerMarkup(listed([entry("점검 절차.pdf")]), { insidePath: "" });
    assert.equal(html.includes('data-case-node-share-doc-pick="'), false, html);
    // 이름은 그대로 보이고, **왜 못 고르는지**를 글로 말한다.
    assert.ok(html.includes("점검 절차.pdf"), html);
    assert.ok(html.includes(CASE_NODE_SHARE_DOC_ROOT_HINT), html);
  });

  test("고를 길(onPick)을 안 주면 단추가 한 줄에도 없다 — 권한 판정은 부르는 쪽이 한다", () => {
    const html = pickerMarkup(listed([entry("점검 절차.pdf")]), { withPick: false });
    assert.equal(html.includes('data-case-node-share-doc-pick="'), false, html);
    // 🔴 팝업 틀을 거쳐도 마찬가지다 — 틀이 제 손으로 단추를 만들지 않는다.
    assert.equal(
      dialogMarkup(listed([entry("점검 절차.pdf")]), { withPick: false }).includes('data-case-node-share-doc-pick="'),
      false
    );
  });

  test("지정할 때 보내는 경로는 **지금 자리에 이름을 이은 것**이다", () => {
    assert.equal(caseFlowchartNodeShareDocEntryPath("", "점검 절차.pdf"), "점검 절차.pdf");
    assert.equal(caseFlowchartNodeShareDocEntryPath(INSIDE, "점검 절차.pdf"), FILE_PATH);
    assert.equal(caseFlowchartNodeShareDocEntryPath("a//b/", "c.pdf"), "a/b/c.pdf");
  });

  test("🔴 통로 주소는 **수리 건** id 로 간다(노드 id 가 아니다) · 자리는 `?path=` 로", () => {
    assert.equal(
      caseFlowchartNodeShareDocEntriesUrl(CASE_ID),
      `/api/repair-cases/${CASE_ID}/flowchart/share-folder/entries`
    );
    assert.equal(
      caseFlowchartNodeShareDocEntriesUrl(CASE_ID, INSIDE),
      `/api/repair-cases/${CASE_ID}/flowchart/share-folder/entries?path=${encodeURIComponent(INSIDE)}`
    );
    // 🔴 링크가 아니다 — 눌러도 페이지를 떠나지 않는다(통로가 출처를 본다).
    assert.equal(pickerMarkup(listed([entry("점검 절차.pdf")])).includes("href="), false);
  });
});

describe("③ 🔴 담긴 경로를 **다시 쪼개는 셈**이 고를 때와 같다", () => {
  test("앞 폴더 · 파일 이름 · 열 수 있는가", () => {
    assert.equal(caseFlowchartNodeShareDocParentPath(FILE_PATH), INSIDE);
    assert.equal(caseFlowchartNodeShareDocFileName(FILE_PATH), "점검 절차.pdf");
    assert.equal(canOpenCaseFlowchartNodeShareDoc(FILE_PATH), true);
    assert.equal(caseFlowchartNodeShareDocParentPath(`${INSIDE}/2026/점검.pdf`), `${INSIDE}/2026`);
  });

  test("🔴 앞 폴더가 없거나 허용 목록 밖이면 못 연다 — 그래도 **경로는 보인다**", () => {
    assert.equal(canOpenCaseFlowchartNodeShareDoc("점검.pdf"), false);
    assert.equal(canOpenCaseFlowchartNodeShareDoc(`${INSIDE}/설치.exe`), false);
    const html = renderToStaticMarkup(createElement(CaseFlowchartNodeShareDocRow, { relativePath: "점검.pdf" }));
    assert.ok(html.includes("점검.pdf"), html);
  });
});

describe("④ 🔴 속성 패널 — 「관련 파일」 구역", () => {
  test("가리킨 것이 없으면 그 사실을 말한다(빈 줄을 두지 않는다)", () => {
    const html = panelMarkup(null, true);
    assert.ok(html.includes(CASE_NODE_SHARE_DOC_EMPTY_TEXT), html);
    assert.equal(html.includes("data-case-node-share-doc-row"), false, html);
  });

  test("🔴 읽기 전용이면 지우기 단추도 [파일 고르기] 단추도 없다 — 경로는 그대로 보인다", () => {
    const html = panelMarkup(FILE_PATH, false);
    assert.ok(html.includes(FILE_PATH), html);
    assert.equal(html.includes("data-case-node-share-doc-clear"), false, html);
    assert.equal(html.includes(CASE_NODE_SHARE_DOC_CLEAR_TEXT), false, html);
    // 🔴 고칠 수 없는 사람에게 고르는 길을 열어 두지 않는다.
    assert.equal(html.includes("data-case-node-share-doc-open="), false, html);
    assert.equal(html.includes(CASE_NODE_SHARE_DOC_OPEN_TEXT), false, html);
  });

  test("🔴 가리킨 것도 없고 고칠 수도 없으면 **구역 자체를 안 세운다**", () => {
    const html = panelMarkup(null, false);
    assert.equal(html.includes("data-case-node-share-doc-section"), false, html);
    assert.equal(html.includes(CASE_NODE_SHARE_DOC_TITLE), false, html);
  });

  test("🔴 고칠 수 있으면 **[파일 고르기] 단추**가 선다 — 목록이 아니다(2026-11-25)", () => {
    const html = panelMarkup(null, true);
    assert.ok(html.includes("data-case-node-share-doc-section"), html);
    assert.ok(html.includes("data-case-node-share-doc-open="), html);
    assert.ok(html.includes(`>${CASE_NODE_SHARE_DOC_OPEN_TEXT}</button>`), html);
    // 🔴 **여는 일**을 하는 단추라는 사실이 보조기기에도 드러난다.
    assert.ok(html.includes('aria-haspopup="dialog"'), html);
  });

  test("🔴 지우기는 초안을 **null 로** 바꾼다 — 빈 글자로 바꾸면 검사에서 거절당한다", () => {
    assert.ok(
      code(panelSource).includes("onDraftChange({ shareDocRelativePath: null })"),
      "지우기가 null 을 넣지 않는다"
    );
    assert.ok(
      code(panelSource).includes("onDraftChange({ shareDocRelativePath: relativePath })"),
      "고른 경로를 초안에 안 넣는다"
    );
  });

  test("🔴 [저장]을 눌러야 나간다는 것을 **안내 한 줄 안에서** 말한다", () => {
    const html = panelMarkup(FILE_PATH, true);
    assert.ok(html.includes("[저장]"));
    assert.ok(html.includes(CASE_NODE_SHARE_DOC_HINT), html);
    // 🔵 구역의 안내는 **한 줄**이다 — 좁은 패널에서 셋이 아홉 줄을 먹었다(2026-11-25).
    const sectionAt = html.indexOf("data-case-node-share-doc-section");
    assert.ok(sectionAt > 0, html);
    const section = html.slice(sectionAt, html.indexOf("노드 삭제", sectionAt));
    assert.equal(section.match(/<p /g)?.length, 1, section);
  });

  test("🔴 패널의 가리킨 경로 줄도 **글자 단위로 쪼개지지 않는다**", () => {
    const html = panelMarkup(`${INSIDE}/${LONG_NAME}`, true);
    assert.ok(html.includes(LONG_NAME), "표본이 비었다 — 긴 이름이 안 그려졌다");
    assert.ok(html.includes("break-keep wrap-anywhere text-[11px]"), html);
    assert.equal(html.includes("break-all text-[11px]"), false, "경로 줄이 아직 break-all 이다");
  });
});

describe("⑤ 🔴 도우미 주소를 직접 짓지 않는다 — 단추를 **그대로 가져다 쓴다**", () => {
  test("여는 단추를 import 로 쓴다 · 주소를 만드는 글자가 한 자도 없다", () => {
    for (const source of [pickerSource, panelSource]) {
      assert.ok(
        source.includes(
          'import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";'
        ),
        "여는 단추를 가져다 쓰지 않는다"
      );
      assert.equal(code(source).includes("dss-folder://"), false, "도우미 주소를 직접 짓는다");
      assert.equal(code(source).includes("buildQuoteFolderFileLink"), false, "주소 만들기를 베꼈다");
    }
  });

  test("🔴 확장자 목록도 제 손으로 적지 않는다", () => {
    for (const source of [pickerSource, panelSource]) {
      for (const forbidden of ["xlsm", "\\.exe", 'endsWith\\("\\.', "lastIndexOf"]) {
        assert.equal(new RegExp(forbidden).test(code(source)), false, `확장자를 직접 센다: ${forbidden}`);
      }
    }
    assert.ok(pickerSource.includes("isOpenableQuoteFolderFileName"), "순수 판정을 쓰지 않는다");
  });

  test("🔴 거르기 칸 · 줄의 열 생김새는 **공용 한 벌**을 쓴다 — 창마다 달라 보이지 않게", () => {
    for (const shared of [
      'from "@/components/common/ShareFolderEntryFilterInput"',
      'from "@/lib/domain/share-folder-entry-filter"',
      'from "@/lib/domain/share-folder-entry-meta"',
    ]) {
      assert.ok(pickerSource.includes(shared), `공용 조각을 안 쓴다: ${shared}`);
    }
  });
});

describe("⑥ 🔴 편집기 화면이 패널에 **수리 건 id** 를 넘긴다", () => {
  test("안 넘기면 고르는 창이 주소를 만들지 못한다", () => {
    const screen = code(screenSource);
    const panelAt = screen.indexOf("<CaseFlowchartNodePropertyPanel");
    assert.ok(panelAt > 0, "패널을 세우는 자리를 못 찾았다");
    const props = screen.slice(panelAt, screen.indexOf("/>", panelAt));
    assert.ok(props.includes("repairCaseId={repairCaseId}"), props);
    // 🔴 노드 id 를 넘기는 실수를 막는다 — 둘 다 UUID 라 겉으로는 똑같이 보인다.
    assert.equal(props.includes("repairCaseId={selectedNode"), false, props);
  });
});

describe("⑦ 🔴 목록은 **팝업 안에서** 산다 (2026-11-25 — 화면이 깨져서 고친 것)", () => {
  test("🔵 먼저 표본 확인 — 세 그림이 다 비어 있지 않다", () => {
    assert.ok(panelMarkup(null, true).length > 500, "패널이 안 그려졌다");
    assert.ok(closedPickerMarkup().length > 50, "고르기 조각이 안 그려졌다");
    assert.ok(dialogMarkup(listed([entry("점검 절차.pdf")])).length > 500, "팝업이 안 그려졌다");
  });

  test("🔴 **속성 패널에 목록이 하나도 없다** — 이번 수정의 알맹이", () => {
    const html = panelMarkup(null, true);
    // 🔵 표본 — 구역과 단추는 그대로 선다(구역이 통째로 빠져서 통과하는 것이 아니다).
    assert.ok(html.includes("data-case-node-share-doc-section"), html);
    assert.ok(html.includes("data-case-node-share-doc-open="), html);
    for (const marker of LIST_MARKERS) {
      assert.equal(html.includes(marker), false, `패널에 목록 조각이 남아 있다: ${marker}`);
    }
  });

  test("🔵 같은 조각들이 **팝업에는 다 있다** — 「없다」만 재면 표시가 바뀌는 날 조용히 통과한다", () => {
    const html = dialogMarkup(listed([entry("2026", true), entry("점검 절차.pdf")]));
    for (const marker of LIST_MARKERS) {
      assert.ok(html.includes(marker), `팝업에서 목록 조각이 사라졌다: ${marker}`);
    }
    // 경로 이동([위로])과 거르기 칸도 팝업 쪽에 있다.
    assert.ok(html.includes("data-case-node-share-doc-up"), html);
    assert.ok(html.includes("data-share-folder-entry-filter-input"), html);
  });

  test("🔴 [파일 고르기]를 **누르기 전에는 팝업이 안 보인다**", () => {
    const html = closedPickerMarkup();
    // 🔵 표본 — 단추는 떠 있다. 조각이 통째로 null 이라 통과하는 것이 아니다.
    assert.ok(html.includes(`>${CASE_NODE_SHARE_DOC_OPEN_TEXT}</button>`), html);
    assert.equal(html.includes("<dialog"), false, html);
    assert.equal(html.includes("data-case-node-share-doc-dialog"), false, html);
    for (const marker of LIST_MARKERS) {
      assert.equal(html.includes(marker), false, `누르기 전인데 목록이 있다: ${marker}`);
    }
  });

  test("팝업의 틀 — `<dialog>` · role · aria-modal · 이름표 · 인쇄에 안 찍힌다", () => {
    const html = dialogMarkup(listed([entry("점검 절차.pdf")]));
    assert.ok(html.startsWith("<dialog"), html.slice(0, 120));
    assert.ok(html.includes('role="dialog"'), html);
    assert.ok(html.includes('aria-modal="true"'), html);
    assert.ok(html.includes(`aria-label="${CASE_NODE_SHARE_DOC_PICKER_TITLE}"`), html);
    assert.ok(html.includes("print:hidden"), html);
    // 🔴 제목은 **한 번만** 적힌다 — 틀과 속이 둘 다 적으면 두 줄이 된다.
    assert.equal(html.match(new RegExp(`>${CASE_NODE_SHARE_DOC_PICKER_TITLE}<`, "g"))?.length, 1, html);
  });

  test("🔴 닫는 길이 **셋**이다 — [×] · [닫기] · Esc", () => {
    const html = dialogMarkup(listed([entry("점검 절차.pdf")]));
    assert.equal(html.match(/data-case-node-share-doc-dialog-close="/g)?.length, 2, html);
    assert.ok(html.includes(`>${CASE_NODE_SHARE_DOC_CLOSE_TEXT}</button>`), html);
    assert.ok(html.includes(`aria-label="${CASE_NODE_SHARE_DOC_CLOSE_TEXT}"`), html);
    // Esc 는 그려진 결과에 안 남는다 — 원본으로 가른다(이 파일 머리말 ⚠️).
    const body = code(pickerSource);
    assert.equal(body.match(/onClick=\{onClose\}/g)?.length, 2, "닫는 단추가 둘이 아니다");
    const cancelAt = body.indexOf("onCancel={(event) => {");
    assert.ok(cancelAt > 0, "Esc 를 받는 자리가 없다");
    const cancel = body.slice(cancelAt, body.indexOf("}}", cancelAt));
    assert.ok(cancel.includes("event.preventDefault();"), cancel);
    assert.ok(cancel.includes("onClose();"), cancel);
  });

  test("🔴 [이 파일 지정]을 누르면 **팝업이 닫히고** 초안에 담긴다", () => {
    const body = code(pickerSource);
    // 🔵 고른 값을 위로 올려보내는 자리가 **하나**다 — 거기에 닫는 일이 붙어 있는지만 보면 된다.
    assert.equal(body.match(/onPick\(relativePath\)/g)?.length, 1, "올려보내는 자리가 하나가 아니다");
    const at = body.indexOf("onPick: (relativePath: string) =>");
    assert.ok(at > 0, "고른 것을 받아 넘기는 자리를 못 찾았다");
    const handler = body.slice(at, body.indexOf("},", at));
    assert.ok(handler.includes("onPick(relativePath);"), handler);
    assert.ok(handler.includes("setIsOpen(false);"), handler);
    // 🔴 받은 경로는 **초안에만** 들어간다 — 여기서 서버를 부르지 않는다(④의 같은 한 줄).
    assert.ok(code(panelSource).includes("onDraftChange({ shareDocRelativePath: relativePath })"), panelSource);
  });

  test("🔴 팝업을 **그냥 닫으면 초안이 안 바뀐다** — 닫는 길에 고르는 일이 없다", () => {
    const body = code(pickerSource);
    const close = body.match(/onClose=\{[^}]*\}/)?.[0];
    assert.equal(close, "onClose={() => setIsOpen(false)}");
    assert.equal(close.includes("onPick"), false, close);
    assert.equal(close.includes("onDraftChange"), false, close);
    // 🔴 열고 닫는 자리는 **셋뿐**이다(열기 · 고르고 닫기 · 그냥 닫기) — 네 번째가 생기면
    //    그것이 무엇인지 사람이 보고 정해야 한다.
    assert.equal(body.match(/setIsOpen\(/g)?.length, 3, body);
    // 🔴 팝업 **틀**은 제 손으로 고르지 않는다 — 받은 onPick 을 속으로 흘려보낼 뿐이다.
    const start = body.indexOf("export function CaseFlowchartNodeShareDocPickerDialog");
    const end = body.indexOf("export default function", start);
    assert.ok(start > 0 && end > start, "팝업 틀을 못 찾았다");
    const dialogBody = body.slice(start, end);
    for (const forbidden of ["fetch(", "loadCaseFlowchartNodeShareDocEntries", "/api/", "useState"]) {
      assert.equal(dialogBody.includes(forbidden), false, `팝업 틀이 제 일을 넘어선다: ${forbidden}`);
    }
  });

  test("🔴 「새로 고르면 바뀐다」를 **고르기 전에** 말한다 — 노드당 하나이기 때문이다", () => {
    const html = dialogMarkup(listed([entry("점검 절차.pdf")]));
    const hintAt = html.indexOf(CASE_NODE_SHARE_DOC_REPLACE_HINT);
    const firstEntryAt = html.indexOf("data-case-node-share-doc-entry=");
    assert.ok(hintAt > 0, html);
    assert.ok(firstEntryAt > 0, html);
    assert.ok(hintAt < firstEntryAt, "안내가 목록 아래에 있다 — 고른 뒤에야 읽게 된다");
    // 🔵 **패널에는 없다** — 좁은 패널의 안내는 한 줄로 줄였다(④의 `<p>` 세기와 짝이다).
    assert.equal(panelMarkup(FILE_PATH, true).includes(CASE_NODE_SHARE_DOC_REPLACE_HINT), false);
  });

  test("🔴 팝업은 **화면 기준으로 넓다** — 좁은 패널의 폭을 따라가지 않는다", () => {
    const html = dialogMarkup(listed([entry(LONG_NAME)]));
    const after = html.slice(html.indexOf('class="') + 7);
    const dialogClass = after.slice(0, after.indexOf('"'));
    assert.ok(dialogClass.includes("w-[min(56rem,95vw)]"), dialogClass);
    // 🔵 길면 **창 안에서만** 스크롤한다 — 페이지가 통째로 늘어나지 않는다.
    assert.ok(dialogClass.includes("max-h-[85vh]"), dialogClass);
    assert.ok(dialogClass.includes("overflow-y-auto"), dialogClass);
    // 🔴 물려받는 글자 모양을 창 안에서 끊는다 — 속성 패널은 `text-xs` 다.
    for (const cut of ["text-sm", "text-left", "whitespace-normal", "break-keep"]) {
      assert.ok(dialogClass.includes(cut), `${cut} 가 없다: ${dialogClass}`);
    }
  });

  test("🔴 긴 이름이 **글자 단위로 쪼개지지 않는다** — `break-all` 을 걷어냈다", () => {
    const html = dialogMarkup(listed([entry(LONG_NAME)]));
    assert.ok(html.includes(LONG_NAME), "표본이 비었다 — 긴 이름이 안 그려졌다");
    assert.ok(html.includes("break-keep wrap-anywhere text-left text-sm"), "이름 칸의 줄바꿈 규칙이 바뀌었다");
    assert.equal(html.includes("break-all text-left text-sm"), false, "이름 칸이 아직 break-all 이다");
    // 길 표시(빵부스러기)도 같은 한 벌이다 — 거기도 폴더 이름이 그대로 선다.
    const trail = dialogMarkup(listed([]), { insidePath: `${INSIDE}/2026` });
    assert.ok(trail.includes("break-keep wrap-anywhere font-medium"), trail);
    assert.equal(trail.includes("break-all font-medium"), false, "길 표시가 아직 break-all 이다");
  });
});
