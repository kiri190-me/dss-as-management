import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ExecutionNodeShareDocRow, { EXECUTION_NODE_SHARE_DOC_LABEL } from "./ExecutionNodeShareDocRow";
import {
  CASE_NODE_SHARE_DOC_OPEN_TEXT,
  CASE_NODE_SHARE_DOC_PICK_TEXT,
  canOpenCaseFlowchartNodeShareDoc,
} from "@/components/repair-cases/flowchart/CaseFlowchartNodeShareDocPicker";
import { PROCEDURE_NODE_SHARE_DOC_CLEAR_TEXT } from "@/components/procedures/editor/NodePropertyPanel";

/**
 * ============================================================================
 * [작업내용]에서 **그 단계에 매달린 파일을 연다** — 화면 쪽 (2026-11-25)
 * ============================================================================
 * 조회가 경로를 실어 오는가는 DB 시험이 본다
 * (mutations/procedure-case-execution.integration.test.ts 의 27번). 여기서는 **화면이
 * 그것으로 무엇을 하는가**만 본다.
 *
 * ⚠️ 🔴 **이 저장소의 화면 시험에는 DOM 이 없다**(renderToStaticMarkup 뿐이고 jsdom 이
 * 없다) — 누를 수가 없다. 게다가 [열기] 단추(ContactFolderEntryOpenButton)는 Windows
 * 데스크톱이 아닌 환경에서 **스스로 아무것도 그리지 않으므로**, 아래 시험들은
 * 「[열기]가 떴는가」가 아니라 **「경로가 보이는가」**와 **원본 글자**로 가른다.
 * 🔵 그 사실 자체를 ③ 에서 한 번 못 박아 둔다 — 안 그러면 「단추가 없다」를 재는 아래
 * 단언들이 **무엇을 재든 늘 통과하는** 것으로 오해된다.
 *
 * ── 🔴 가장 중요하게 지키는 것: **읽기 전용** ────────────────────────────
 * 2026-11-25 에 사용자가 명시적으로 뺐다 — 「[수리건 상세]쪽에서 파일을 고르는 기능은
 * 하지 말자」. 가리킴을 정하는 자리는 절차 편집기 하나다. 나중에 누군가 「진단
 * Flowchart 쪽과 맞추자」며 고르기·지우기를 붙이는 것을 막는 자리가 ② 다 —
 * 그러려면 프롭 타입부터 고쳐야 한다는 것을 **값으로** 못 박는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const rowSource = read("src/components/procedures/execution/ExecutionNodeShareDocRow.tsx");
const currentCardSource = read("src/components/procedures/execution/CurrentTaskCard.tsx");
const nodeCardSource = read("src/components/procedures/execution/ExecutionNodeCard.tsx");
const screenSource = read("src/components/procedures/execution/ProcedureExecutionScreen.tsx");

const INSIDE = "1. 수리 관련";
const FILE_PATH = `${INSIDE}/점검 절차.pdf`;
/** 🔴 실제로 깨졌던 그 이름 — 길고 한글이고 마디가 섞여 있다(2026-11-25 신고). */
const LONG_NAME = "(삭제예정) 7. 디에스에스 수리품 목록 및 현황_20220707.xlsx";
/** 맨 위 칸에 바로 놓인 파일 — 앞에 붙일 폴더가 없어 도우미 주소를 만들 수 없다. */
const ROOT_LEVEL_PATH = "점검.pdf";
/** 허용 목록 밖 확장자. */
const FORBIDDEN_EXT_PATH = `${INSIDE}/설치.exe`;

const markup = (relativePath: string | null, size?: "SM" | "MD") =>
  renderToStaticMarkup(
    createElement(ExecutionNodeShareDocRow, { relativePath, ...(size === undefined ? {} : { size }) })
  );

/** 🔴 고르는 창이 화면에 딸려 왔다는 것을 알리는 조각들 — 한 조각도 있으면 안 된다. */
const PICKER_MARKERS = [
  "data-case-node-share-doc-open",
  "data-case-node-share-doc-picker",
  "data-case-node-share-doc-dialog",
  "data-case-node-share-doc-entry",
  "data-case-node-share-doc-pick",
  "data-procedure-node-share-doc-clear",
];

describe("① 🔴 매달린 파일 한 줄 — 무엇이 보이고 무엇이 안 보이는가", () => {
  test("🔵 먼저 표본 확인 — 조각이 실제로 그려졌고 원본 넷을 다 읽었다", () => {
    const html = markup(FILE_PATH);
    assert.ok(html.includes("data-execution-node-share-doc"), html);
    assert.ok(html.length > 120, `줄이 안 그려졌다 — 아래 단언이 공짜로 통과한다: ${html}`);
    for (const [name, source] of [
      ["ExecutionNodeShareDocRow", rowSource],
      ["CurrentTaskCard", currentCardSource],
      ["ExecutionNodeCard", nodeCardSource],
      ["ProcedureExecutionScreen", screenSource],
    ] as const) {
      assert.ok(source.length > 1000, `${name} 원본이 비었다`);
    }
  });

  test("🔵 주석 걷어내기가 실제로 듣는다 — 아래 「없어야 한다」가 주석만 보고 깨지지 않게", () => {
    assert.ok(rowSource.includes("🔴"), "표본이 어긋났다 — 원본에 주석이 없다");
    assert.ok(!code(rowSource).includes("🔴"), "주석이 남으면 ② 의 금지 단언이 뜻을 잃는다");
  });

  test("🔴 가리킨 것이 없으면 **아무것도 그리지 않는다** — 빈 줄도 「없음」 글자도 두지 않는다", () => {
    assert.equal(markup(null), "");
    assert.equal(markup(""), "", "빈 글자도 「안 가리킴」으로 읽는다");
    // 🔵 이것이 곧 **이 건에서 더한 작업**의 모습이다 — 짝지을 템플릿 행이 없어
    //    조회가 늘 null 을 준다(ExecutionNodeDetail.shareDocRelativePath 의 주석).
  });

  test("🔴 가리키고 있으면 **경로가 글자 그대로** 보인다 — 숨기지 않는다", () => {
    const html = markup(FILE_PATH);
    assert.ok(html.includes(FILE_PATH), html);
    assert.ok(html.includes(EXECUTION_NODE_SHARE_DOC_LABEL), "무슨 줄인지 말해 주는 말이 없다");
  });

  test("🔴 **열 수 없는 모양이어도 경로는 보인다** — 단추만 없다", () => {
    // 🔵 먼저 표본 — 이 둘이 정말로 「못 여는」 값인지 공용 판정으로 확인한다.
    //    (여기서 참이면 아래가 아무것도 안 재는 시험이 된다.)
    assert.equal(canOpenCaseFlowchartNodeShareDoc(ROOT_LEVEL_PATH), false, "맨 위 칸 파일 표본이 어긋났다");
    assert.equal(canOpenCaseFlowchartNodeShareDoc(FORBIDDEN_EXT_PATH), false, "허용 목록 밖 확장자 표본이 어긋났다");
    assert.equal(canOpenCaseFlowchartNodeShareDoc(FILE_PATH), true, "열 수 있는 쪽 표본이 어긋났다");

    for (const path of [ROOT_LEVEL_PATH, FORBIDDEN_EXT_PATH]) {
      const html = markup(path);
      assert.ok(html.includes(path), `못 여는 값이라고 줄을 통째로 감췄다: ${path}`);
      assert.ok(html.includes("data-execution-node-share-doc"), html);
    }
  });

  test("🔴 [열기] 단추는 **판정을 통과한 값에서만** 그려진다 — 원본의 관문 한 줄", () => {
    const body = code(rowSource);
    assert.match(body, /const openable = canOpenCaseFlowchartNodeShareDoc\(relativePath\);/);
    assert.match(body, /\{openable && \(\s*<ContactFolderEntryOpenButton/);
  });

  test("🔴 긴 한글 경로가 **한 글자씩 세로로 떨어지지 않는다**", () => {
    const html = markup(`${INSIDE}/${LONG_NAME}`);
    assert.ok(html.includes(LONG_NAME), "표본이 비었다 — 긴 이름이 안 그려졌다");
    assert.ok(html.includes("break-keep wrap-anywhere"), html);
    assert.equal(code(rowSource).includes("break-all"), false, "경로 줄이 break-all 이다");
  });

  test("🔵 글자 크기는 부르는 쪽이 고른다 — 큰 카드의 본문(text-sm)과 작은 카드(text-xs)", () => {
    assert.ok(markup(FILE_PATH, "MD").includes("text-sm"), "MD 가 본문 크기가 아니다");
    assert.ok(markup(FILE_PATH, "SM").includes("text-xs"), "SM 이 작은 글자가 아니다");
    assert.equal(markup(FILE_PATH).includes("text-xs"), true, "기본값이 SM 이 아니다");
  });

  test("🔴 인쇄에서 **경로는 남는다** — 사라지는 것은 누를 수 없는 단추뿐이다", () => {
    assert.equal(markup(FILE_PATH).includes("print:hidden"), false, "경로 줄까지 인쇄에서 사라진다");
  });
});

describe("② 🔴 읽기 전용이다 — 고르기도 지우기도 **없다**", () => {
  test("🔵 먼저 표본 — 금지 글자들이 실제로 쓰이는 말이다(지어낸 글자로 재지 않는다)", () => {
    // 🔴 이 셋은 절차 편집기·고르는 창이 **실제로 내보내는 말**이다. 지어낸 글자로
    //    「없다」를 재면 그쪽 문구가 바뀌는 날 이 시험이 조용히 뜻을 잃는다.
    for (const text of [CASE_NODE_SHARE_DOC_OPEN_TEXT, CASE_NODE_SHARE_DOC_PICK_TEXT, PROCEDURE_NODE_SHARE_DOC_CLEAR_TEXT]) {
      assert.ok(typeof text === "string" && text.length > 0, "금지 문구 표본이 비었다");
    }
  });

  test("🔴 그려진 줄에 고르기·지우기 조각이 **하나도 없다**", () => {
    const html = markup(FILE_PATH);
    for (const marker of [...PICKER_MARKERS, CASE_NODE_SHARE_DOC_OPEN_TEXT, CASE_NODE_SHARE_DOC_PICK_TEXT, PROCEDURE_NODE_SHARE_DOC_CLEAR_TEXT]) {
      assert.equal(html.includes(marker), false, `읽기 전용 줄에 고치는 길이 생겼다: ${marker}`);
    }
  });

  test("🔴 **프롭 자체가 없다** — 붙이려면 타입부터 고쳐야 한다(그래야 사람 눈에 띈다)", () => {
    const body = code(rowSource);
    for (const forbidden of ["onPick", "onClear", "onChange", "CaseFlowchartNodeShareDocPicker,", "useState"]) {
      assert.equal(body.includes(forbidden), false, `읽기 전용이 아니게 됐다: ${forbidden}`);
    }
    // 🔵 받는 것은 둘뿐이다 — 경로와 글자 크기.
    assert.match(body, /relativePath: string \| null;/);
    assert.match(body, /size\?: "SM" \| "MD";/);
  });

  test("🔴 세 화면도 **고르는 창을 품지 않는다** — 줄만 세운다", () => {
    for (const [name, source] of [
      ["CurrentTaskCard", currentCardSource],
      ["ExecutionNodeCard", nodeCardSource],
      ["ProcedureExecutionScreen", screenSource],
    ] as const) {
      const body = code(source);
      assert.ok(body.includes("<ExecutionNodeShareDocRow"), `${name} 이 줄을 안 세운다`);
      for (const marker of PICKER_MARKERS) {
        assert.equal(body.includes(marker), false, `${name} 에 고치는 길이 생겼다: ${marker}`);
      }
      assert.equal(body.includes("CaseFlowchartNodeShareDocPicker"), false, `${name} 이 고르는 창을 물었다`);
    }
  });
});

describe("③ 🔴 도우미 주소도 확장자 목록도 **제 손으로 짓지 않는다**", () => {
  test("🔵 먼저 — [열기] 단추는 이 환경에서 **그려지지 않는다**(Windows 가 아니다)", () => {
    // 🔴 이 사실을 못 박아 둔다. 위 ② 의 「단추가 없다」가 **언제나 참**인 것은
    //    아니고(고르기 단추는 Windows 여부와 무관하게 그려진다 — 절차 편집기 쪽
    //    시험이 그것을 실제로 잡는다), [열기] 쪽만 이 환경에서 스스로 사라진다.
    assert.equal(markup(FILE_PATH).includes("data-contact-folder-entry-open"), false);
    // 그래서 **원본 글자로** 가른다 — 가져다 쓰는가.
    assert.ok(
      rowSource.includes('import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";'),
      "여는 단추를 가져다 쓰지 않는다"
    );
  });

  test("🔴 `dss-folder://` 를 **직접 짓지 않는다**", () => {
    const body = code(rowSource);
    assert.equal(body.includes("dss-folder://"), false, "도우미 주소를 직접 짓는다");
    assert.equal(body.includes("buildQuoteFolderFileLink"), false, "주소 만들기를 베꼈다");
    for (const forbidden of ["xlsm", "isOpenableQuoteFolderFileName", "split(\"/\")", "shareFolderEntryMeta"]) {
      assert.equal(body.includes(forbidden), false, `쪼개는 셈·확장자 목록을 베꼈다: ${forbidden}`);
    }
  });

  test("🔴 경로를 쪼개는 셈은 **고르는 쪽과 같은 한 벌**이다", () => {
    assert.ok(
      rowSource.includes('} from "@/components/repair-cases/flowchart/CaseFlowchartNodeShareDocPicker";'),
      "쪼개는 함수를 공용 한 벌에서 안 가져온다"
    );
    for (const fn of [
      "canOpenCaseFlowchartNodeShareDoc",
      "caseFlowchartNodeShareDocFileName",
      "caseFlowchartNodeShareDocParentPath",
    ]) {
      assert.ok(rowSource.includes(fn), `${fn} 을 안 쓴다 — 제 손으로 쪼개면 열 때만 어긋난다`);
    }
    const body = code(rowSource);
    assert.match(body, /folderName=\{caseFlowchartNodeShareDocParentPath\(relativePath\)\}/);
    assert.match(body, /fileName=\{caseFlowchartNodeShareDocFileName\(relativePath\)\}/);
  });
});

describe("④ 🔴 어느 자리에 섰는가 — 세 화면이 **같은 한 벌**을 쓴다", () => {
  test("「지금 할 일」 큰 카드 — 그 노드의 경로를 넘기고, 지시문 **바로 아래**다", () => {
    const body = code(currentCardSource).replace(/\s+/g, " ");
    assert.ok(body.includes("<ExecutionNodeShareDocRow relativePath={node.shareDocRelativePath} size=\"MD\" />"), body.slice(0, 200));
    const instructionsAt = body.indexOf("{node.instructions ?");
    const rowAt = body.indexOf("<ExecutionNodeShareDocRow");
    const metaAt = body.indexOf("{node.effectiveAssigneeName &&");
    assert.ok(instructionsAt > 0 && rowAt > 0 && metaAt > 0, "셋을 못 찾으면 자리 판정이 뜻을 잃는다");
    assert.ok(instructionsAt < rowAt, "지시문보다 위로 올라가면 「무엇을 하는지」보다 먼저 읽힌다");
    assert.ok(rowAt < metaAt, "담당·시각 줄 아래로 내려가면 곁다리로 읽힌다");
  });

  test("작은 노드 카드 — 같은 노드가 「차단됨」에 설 때도 보인다", () => {
    const body = code(nodeCardSource).replace(/\s+/g, " ");
    assert.ok(body.includes("<ExecutionNodeShareDocRow relativePath={node.shareDocRelativePath} />"), body.slice(0, 200));
  });

  test("🔴 「참고 문서」 구역 — 실행 행이 없는 노드가 매단 파일이 **여기서만** 열린다", () => {
    const body = code(screenSource).replace(/\s+/g, " ");
    // 🔵 먼저 표본 — 구역이 실제로 화면에 적혀 있다.
    assert.ok(body.includes("executionDetail.referenceNodes.map((ref)"), "참고 문서 구역을 못 찾았다");
    assert.ok(body.includes("<ExecutionNodeShareDocRow relativePath={ref.shareDocRelativePath} />"), body.slice(0, 200));
    // 🔴 노드 목록 쪽이 아니다 — 참고 문서는 nodes 에 한 줄도 없다(isExecutableNodeType).
    assert.equal(body.includes("relativePath={node.shareDocRelativePath}"), false, "실행 화면이 노드 줄을 직접 그리고 있다");
  });

  test("🔴 실행 화면은 **서버 컴포넌트로 남는다** — 줄 하나 때문에 트리가 통째로 내려가지 않는다", () => {
    assert.equal(/"use client"/.test(code(screenSource)), false, "실행 화면이 클라이언트가 됐다");
    // 🔵 누르는 일은 전부 줄 조각 안에 있다 — 그쪽은 클라이언트가 맞다.
    assert.match(code(rowSource), /^\s*"use client";/);
  });
});
