import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import NodePropertyPanel, {
  PROCEDURE_NODE_SHARE_DOC_CLEAR_TEXT,
  PROCEDURE_NODE_SHARE_DOC_EMPTY_TEXT,
  PROCEDURE_NODE_SHARE_DOC_HINT,
  PROCEDURE_NODE_SHARE_DOC_TITLE,
  ProcedureNodeShareDocRow,
  procedureNodeShareDocEntriesBaseUrl,
} from "./NodePropertyPanel";
import { CASE_NODE_SHARE_DOC_OPEN_TEXT } from "@/components/repair-cases/flowchart/CaseFlowchartNodeShareDocPicker";
import type { EditorNodeRow } from "@/lib/db/queries/procedure-template-editor";
import type { ProcedureNodeFieldDraft } from "@/lib/domain/procedure-editor-save-state";

/**
 * ============================================================================
 * 기술 작업 절차 노드의 「관련 파일」 — 화면 쪽 (2026-11-25, 조각 E2)
 * ============================================================================
 * 서버 쪽 규율은 이웃 시험들이 본다(검사와 저장 배선 · DB 까지). 여기서는 **속성 패널이
 * 무엇을 내는가**만 본다.
 *
 * ── 🔴 고르는 창은 **진단 Flowchart 와 한 벌**이다 ───────────────────────
 * 그래서 창 자체의 규율(파일만 고를 수 있다 · 맨 위 칸에서는 못 고른다 · 설정이 비면
 * 단추도 안 선다 · 팝업의 폭과 줄바꿈)은 **그쪽 시험이 이미 잰다**
 * (repair-cases/flowchart/case-flowchart-node-share-doc.test.tsx, 35건). 여기서 다시
 * 재면 같은 것을 두 번 세는 셈이고, 그 창이 바뀌는 날 두 곳을 고쳐야 한다. 이 파일은
 * **절차 쪽에만 있는 것**을 잰다: 구역이 서는 조건 · 주소가 절차 템플릿 id 로 가는가 ·
 * 패널에 목록이 없는가 · 창을 베끼지 않았는가.
 *
 * ⚠️ 🔴 **이 저장소의 화면 시험에는 DOM 이 없다**(renderToStaticMarkup 뿐이고 jsdom 이
 * 없다) — **누를 수가 없다.** 그래서 「눌렀을 때 무엇이 일어나는가」는 그려진 결과와
 * **원본 글자**로 가른다.
 *
 * ── 🔵 [열기] 단추는 **여기서 안 그려진다** ──────────────────────────────
 * ContactFolderEntryOpenButton 은 Windows 데스크톱이 아닌 환경(서버 렌더 · 이 시험)에서
 * 스스로 아무것도 그리지 않는다. 그래서 아래 시험들은 「[열기]가 떴는가」가 아니라
 * **「경로가 보이는가」**를 잰다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const panelSource = read("src/components/procedures/editor/NodePropertyPanel.tsx");

const TEMPLATE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NODE_ID = "11111111-1111-4111-8111-111111111111";
const INSIDE = "1. 수리 관련";
const FILE_PATH = `${INSIDE}/점검 절차.pdf`;
/** 🔴 실제로 깨졌던 그 이름 — 길고 한글이고 마디가 섞여 있다(진단 쪽 2026-11-25 신고). */
const LONG_NAME = "(삭제예정) 7. 디에스에스 수리품 목록 및 현황_20220707.xlsx";

/**
 * 🔴 **목록이 있다는 것을 알리는 조각들.** 좁은 패널에는 하나도 없어야 한다 — 공용 격자의
 * 고정 칸이 24rem 이라 이름 칸이 0 에 가깝게 눌리고, 한글 이름이 한 글자씩 세로로 떨어진다.
 */
const LIST_MARKERS = [
  "data-case-node-share-doc-picker",
  "data-case-node-share-doc-trail",
  "data-case-node-share-doc-entry",
  "data-share-folder-entry-filter",
  "sm:grid-cols-[minmax(0,1fr)",
];

const node: EditorNodeRow = {
  id: NODE_ID,
  nodeCode: "manual-1",
  nodeType: "TASK",
  title: "노드 하나",
  description: null,
  instructions: null,
  objective: null,
  preparation: null,
  toolsAndEquipment: null,
  safetyCaution: null,
  expectedNormalResult: null,
  ngSymptoms: null,
  recommendedCorrectiveAction: null,
  acceptanceCriteria: null,
  workerMayAddNextTask: false,
  nextProcedureTemplateId: null,
  shareDocRelativePath: null,
  positionX: 0,
  positionY: 0,
  userPositionX: null,
  userPositionY: null,
  sortOrder: 0,
  sourceWorksheet: null,
  sourceShapeId: null,
  sourceCellRange: null,
  isActive: true,
  hasChecklistContent: false,
  hasTroubleshootingContent: false,
};

const draftOf = (shareDocRelativePath: string | null): ProcedureNodeFieldDraft => ({
  title: node.title,
  description: "",
  instructions: "",
  sortOrder: node.sortOrder,
  isActive: node.isActive,
  nextProcedureTemplateId: null,
  shareDocRelativePath,
});

function panelMarkup(shareDocRelativePath: string | null, canEdit: boolean): string {
  return renderToStaticMarkup(
    createElement(NodePropertyPanel, {
      procedureTemplateId: TEMPLATE_ID,
      node: { ...node, shareDocRelativePath },
      allNodes: [{ ...node, shareDocRelativePath }],
      canEdit,
      draft: draftOf(shareDocRelativePath),
      onDraftChange: () => undefined,
      onPositionDraftChange: () => undefined,
      resolveNodeDimensions: () => ({ width: 100, height: 50 }),
      onQueueChangeType: () => undefined,
      canDelete: false,
      onQueueDelete: () => undefined,
      // 🔴 자리 옮기기 구역을 **안 세운다** — 아래 「안내는 한 줄」이 구역 뒤를 잘라 세기
      //    때문이다(자리 옮기기 구역이 서면 그 안의 글까지 세게 된다).
      canPosition: false,
      isTechnical: true,
    })
  );
}

describe("① 🔴 구역이 서는 조건", () => {
  test("🔵 먼저 표본 확인 — 패널이 실제로 그려졌고 원본도 읽었다", () => {
    assert.ok(panelMarkup(null, true).length > 500, "패널이 안 그려졌다 — 아래 단언이 공짜로 통과한다");
    assert.ok(panelSource.length > 2000, "원본이 비었다");
  });

  test("🔴 가리킨 것도 없고 고칠 수도 없으면 **구역 자체를 안 세운다**", () => {
    const html = panelMarkup(null, false);
    assert.equal(html.includes("data-procedure-node-share-doc-section"), false, html);
    assert.equal(html.includes(PROCEDURE_NODE_SHARE_DOC_TITLE), false, html);
  });

  test("가리킨 것이 없으면 그 사실을 말한다(빈 줄을 두지 않는다)", () => {
    const html = panelMarkup(null, true);
    assert.ok(html.includes("data-procedure-node-share-doc-section"), html);
    assert.ok(html.includes(PROCEDURE_NODE_SHARE_DOC_EMPTY_TEXT), html);
    assert.equal(html.includes("data-procedure-node-share-doc-row"), false, html);
  });

  test("🔴 읽기 전용이면 지우기 단추도 [파일 고르기] 단추도 없다 — 경로는 그대로 보인다", () => {
    const html = panelMarkup(FILE_PATH, false);
    assert.ok(html.includes(PROCEDURE_NODE_SHARE_DOC_TITLE), html);
    assert.ok(html.includes(FILE_PATH), "가리킨 경로가 안 보인다");
    assert.equal(html.includes("data-procedure-node-share-doc-clear"), false, html);
    assert.equal(html.includes(PROCEDURE_NODE_SHARE_DOC_CLEAR_TEXT), false, html);
    // 🔴 고칠 수 없는 사람에게 고르는 길을 열어 두지 않는다.
    assert.equal(html.includes("data-case-node-share-doc-open="), false, html);
    assert.equal(html.includes(CASE_NODE_SHARE_DOC_OPEN_TEXT), false, html);
  });

  test("🔴 고칠 수 있으면 **[파일 고르기] 단추**가 선다 — 목록이 아니다", () => {
    const html = panelMarkup(null, true);
    assert.ok(html.includes("data-case-node-share-doc-open="), html);
    assert.ok(html.includes(`>${CASE_NODE_SHARE_DOC_OPEN_TEXT}</button>`), html);
    // 🔴 **여는 일**을 하는 단추라는 사실이 보조기기에도 드러난다.
    assert.ok(html.includes('aria-haspopup="dialog"'), html);
  });

  test("🔴 가리키고 있으면 경로 줄과 [지우기]가 함께 선다", () => {
    const html = panelMarkup(FILE_PATH, true);
    assert.ok(html.includes("data-procedure-node-share-doc-row"), html);
    assert.ok(html.includes(FILE_PATH), html);
    assert.ok(html.includes("data-procedure-node-share-doc-clear"), html);
    assert.ok(html.includes(`>${PROCEDURE_NODE_SHARE_DOC_CLEAR_TEXT}</button>`), html);
  });

  test("🔴 지우기는 초안을 **null 로** 바꾼다 — 빈 글자로 바꾸면 검사에서 거절당한다", () => {
    const body = code(panelSource);
    assert.ok(body.includes("onDraftChange({ shareDocRelativePath: null })"), "지우기가 null 을 넣지 않는다");
    assert.ok(body.includes("onDraftChange({ shareDocRelativePath: relativePath })"), "고른 경로를 초안에 안 넣는다");
  });

  test("🔴 [저장]을 눌러야 나간다는 것을 **안내 한 줄 안에서** 말한다", () => {
    const html = panelMarkup(FILE_PATH, true);
    assert.ok(html.includes(PROCEDURE_NODE_SHARE_DOC_HINT), html);
    assert.ok(PROCEDURE_NODE_SHARE_DOC_HINT.includes("[저장]"));
    // 🔵 구역의 안내는 **한 줄**이다 — 좁은 패널에서 여러 줄이 되면 화면을 먹는다.
    const sectionAt = html.indexOf("data-procedure-node-share-doc-section");
    assert.ok(sectionAt > 0, html);
    const dialogAt = html.indexOf("<dialog", sectionAt);
    assert.ok(dialogAt > sectionAt, "구역 뒤를 자를 자리를 못 찾았다 — 표본이 어긋났다");
    const section = html.slice(sectionAt, dialogAt);
    assert.equal(section.match(/<p /g)?.length, 1, section);
  });

  test("🔴 패널의 가리킨 경로 줄이 **글자 단위로 쪼개지지 않는다**", () => {
    const html = panelMarkup(`${INSIDE}/${LONG_NAME}`, true);
    assert.ok(html.includes(LONG_NAME), "표본이 비었다 — 긴 이름이 안 그려졌다");
    assert.ok(html.includes("break-keep wrap-anywhere text-[11px]"), html);
    assert.equal(html.includes("break-all text-[11px]"), false, "경로 줄이 아직 break-all 이다");
  });
});

describe("② 🔴 통로 주소는 **절차 템플릿** id 로 간다", () => {
  test("주소 한 줄", () => {
    assert.equal(
      procedureNodeShareDocEntriesBaseUrl(TEMPLATE_ID),
      `/api/procedure-templates/${TEMPLATE_ID}/share-folder/entries`
    );
  });

  test("🔴 패널이 **그 주소를** 창에 넘긴다(노드 id 가 아니다 — 둘 다 UUID 라 겉은 같다)", () => {
    const body = code(panelSource);
    assert.ok(body.includes("entriesBaseUrl={procedureNodeShareDocEntriesBaseUrl(procedureTemplateId)}"), body.slice(0, 200));
    assert.equal(body.includes("procedureNodeShareDocEntriesBaseUrl(node.id)"), false, "노드 id 로 주소를 짓는다");
    // 🔴 링크가 아니다 — 통로가 출처를 본다(fetch 로만 부른다).
    assert.equal(panelMarkup(null, true).includes("/api/procedure-templates/"), false, "주소가 화면에 그대로 박혔다");
  });
});

describe("③ 🔴 패널에 목록이 없다 · 창을 베끼지 않았다", () => {
  test("🔴 **속성 패널에 목록 조각이 하나도 없다** — 좁은 상자에서 한글이 한 글자씩 떨어진다", () => {
    const html = panelMarkup(FILE_PATH, true);
    // 🔵 표본 — 구역과 단추는 그대로 선다(구역이 통째로 빠져서 통과하는 것이 아니다).
    assert.ok(html.includes("data-procedure-node-share-doc-section"), html);
    assert.ok(html.includes("data-case-node-share-doc-open="), html);
    for (const marker of LIST_MARKERS) {
      assert.equal(html.includes(marker), false, `패널에 목록 조각이 남아 있다: ${marker}`);
    }
  });

  test("🔴 고르는 창을 **가져다 쓴다** — 절차용으로 한 벌 더 만들지 않았다", () => {
    assert.ok(
      panelSource.includes(
        'import CaseFlowchartNodeShareDocPicker, {'
      ),
      "공용 창을 안 쓴다 — 두 벌이 되면 한쪽만 고쳐지는 날이 온다"
    );
    assert.ok(panelSource.includes('} from "@/components/repair-cases/flowchart/CaseFlowchartNodeShareDocPicker";'), panelSource.slice(0, 400));
    const body = code(panelSource);
    // 🔴 도우미 주소도 확장자 목록도 제 손으로 짓지 않는다.
    assert.equal(body.includes("dss-folder://"), false, "도우미 주소를 직접 짓는다");
    assert.equal(body.includes("buildQuoteFolderFileLink"), false, "주소 만들기를 베꼈다");
    for (const forbidden of ["xlsm", "isOpenableQuoteFolderFileName", "shareFolderEntryMeta"]) {
      assert.equal(body.includes(forbidden), false, `창의 속을 베꼈다: ${forbidden}`);
    }
    // 🔴 여는 단추는 **그대로 가져다 쓴다**.
    assert.ok(
      panelSource.includes('import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";'),
      "여는 단추를 가져다 쓰지 않는다"
    );
  });

  test("가리킨 자리 한 줄은 **따로 그려 볼 수 있다** — 열 수 없는 모양이면 단추만 없고 경로는 보인다", () => {
    const html = renderToStaticMarkup(createElement(ProcedureNodeShareDocRow, { relativePath: "점검.pdf" }));
    assert.ok(html.includes("점검.pdf"), html);
    assert.equal(html.includes("data-procedure-node-share-doc-clear"), false, "지울 길을 안 줬는데 단추가 생겼다");
  });
});
