import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import CaseFlowchartNodePropertyPanel, {
  CASE_NODE_SHARE_DOC_CLEAR_TEXT,
  CASE_NODE_SHARE_DOC_EMPTY_TEXT,
  CASE_NODE_SHARE_DOC_TITLE,
  CaseFlowchartNodeShareDocRow,
  type CaseFlowchartNodeDraft,
} from "./CaseFlowchartNodePropertyPanel";
import {
  CASE_NODE_SHARE_DOC_EMPTY_TEXT as PICKER_EMPTY_TEXT,
  CASE_NODE_SHARE_DOC_FAILED_TEXT,
  CASE_NODE_SHARE_DOC_LOADING_TEXT,
  CASE_NODE_SHARE_DOC_PICK_TEXT,
  CASE_NODE_SHARE_DOC_ROOT_HINT,
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
 * ── 🔴 눈 확인이 개발 PC 에서 안 되는 자리라 더 촘촘히 잰다 ───────────────
 * `REPAIR_DOCS_ARCHIVE_DIR` 가 비어 있어 이 PC 에서는 고르는 창이 **뜨지 않는다.** 그
 * 「안 뜨는 것」이 올바른 동작인지를 사람 눈 대신 여기서 잰다(①). 또 그 상태에서도
 * **가리킨 줄과 [가리킴 지우기]는 그대로 서야** 한다 — 그 둘은 DB 값이지 공유폴더가
 * 아니다.
 *
 * ── 왜 글자 매칭이 아니라 그려 보는가 ────────────────────────────────────
 * 「단추가 있는가 · 없는가」는 상태를 넣어 실제로 그려 보는 쪽이 정확하다. 🔴 두 조각은
 * 서버 액션을 한 줄도 물지 않으므로(고르기는 `onPick`, 저장은 화면의 [저장]) 이 틀에서
 * 그대로 그려진다.
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

  test("상태가 disabled 면 빈 글자다 — 설정이 없는 환경(지금 개발 PC)에서 빈 상자가 늘지 않게", () => {
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

  test("🔴 읽기 전용이면 지우기 단추가 없다 — 경로는 그대로 보인다", () => {
    const html = panelMarkup(FILE_PATH, false);
    assert.ok(html.includes(FILE_PATH), html);
    assert.equal(html.includes("data-case-node-share-doc-clear"), false, html);
    assert.equal(html.includes(CASE_NODE_SHARE_DOC_CLEAR_TEXT), false, html);
  });

  test("🔴 가리킨 것도 없고 고칠 수도 없으면 **구역 자체를 안 세운다**", () => {
    const html = panelMarkup(null, false);
    assert.equal(html.includes("data-case-node-share-doc-section"), false, html);
    assert.equal(html.includes(CASE_NODE_SHARE_DOC_TITLE), false, html);
  });

  test("🔴 고칠 수 있으면 고르는 창 자리가 선다 — 그 창은 설정이 비면 스스로 꺼진다", () => {
    const html = panelMarkup(null, true);
    assert.ok(html.includes("data-case-node-share-doc-section"), html);
    // 🔵 이 틀에서는 창이 제 상태(loading)로 뜬다 — 통로를 부르는 일은 브라우저에서만 돈다.
    assert.ok(html.includes("data-case-node-share-doc-picker"), html);
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

  test("🔴 「새로 고르면 바뀐다」를 **고르기 전에** 말한다 — 노드당 하나이기 때문이다", () => {
    const html = panelMarkup(FILE_PATH, true);
    const hintAt = html.indexOf("새로 고르면");
    const pickerAt = html.indexOf("data-case-node-share-doc-picker");
    assert.ok(hintAt > 0, html);
    assert.ok(hintAt < pickerAt, "안내가 창 아래에 있다 — 고른 뒤에야 읽게 된다");
  });

  test("🔴 [저장]을 눌러야 나간다는 것도 말한다", () => {
    assert.ok(panelMarkup(FILE_PATH, true).includes("[저장]"));
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
