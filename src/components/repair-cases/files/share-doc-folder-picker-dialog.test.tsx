import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { attachmentCategoryLabels } from "@/lib/domain/attachment-category";
import {
  CONTACT_FOLDER_SAVE_TARGET_CATEGORIES,
  CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE,
} from "@/lib/domain/contact-folder-save-targets";
import ShareDocContactFolderButton from "./ShareDocContactFolderButton";
import ShareDocFolderPickerDialog, {
  SHARE_DOC_FOLDER_PICKER_CANCEL_TEXT,
  SHARE_DOC_FOLDER_PICKER_SAVE_TEXT,
  SHARE_DOC_FOLDER_PICKER_TITLE,
} from "./ShareDocFolderPickerDialog";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — **어느 폴더에 넣을까요** 창 (2026-11-18)
 * ============================================================================
 * 2026-10-08 부터 이 단추는 누르면 **곧바로** `공통` 에 꽂았다. 이제 창이 하나 서고, 거기서
 * 고른 뒤 [저장]을 눌러야 요청이 나간다. 못 박는 것:
 *
 *  · 🔴 **그리자마자 떠 있지 않다** — 단추를 눌러야 뜬다(그려진 결과로 잰다)
 *  · 🔴 열셋이 서고 **기본 선택이 `공통`** 이다(라디오가 하나만 켜져 있다)
 *  · 🔴 보일 글자는 **이름표 표**에서 온다 — 사진 분류 다섯은 한 칸도 없다
 *  · 🔴 창은 **제 손으로 아무것도 보내지 않는다**(fetch 도 통로 주소도 없다)
 *  · 🔴 [취소]는 **닫기만** 한다 — 요청이 한 번도 나가지 않는다
 *  · 🔴 줄에서 물려받는 글자 모양(`text-right`·`text-xs`)을 창 안에서 끊는다
 *
 * ⚠️ 이 저장소의 화면 시험에는 DOM 이 없다(renderToStaticMarkup 뿐이고 jsdom 이 없다) —
 * **누를 수가 없다.** 그래서 「눌렀을 때 무엇이 일어나는가」는 그려진 결과와 **원본 글자**로
 * 가른다(이웃 StoredAttachmentList.test.tsx 가 같은 까닭으로 같은 길을 쓴다). 고른 값이
 * 주소에 실리는 일은 값으로 잰다(share-doc-contact-folder-save.test.ts).
 * ============================================================================
 */

const dialogSource = readFileSync(new URL("./ShareDocFolderPickerDialog.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const buttonSource = readFileSync(new URL("./ShareDocContactFolderButton.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CASE_ID = "99999999-9999-4999-8999-999999999999";
const SOURCE_PATH = "2. 인수시 서류/MB 인수시 체크시트.xlsx";

function dialogMarkup(): string {
  return renderToStaticMarkup(
    createElement(ShareDocFolderPickerDialog, {
      relativePath: SOURCE_PATH,
      onSave: () => {},
      onCancel: () => {},
    })
  );
}

function buttonMarkup(): string {
  return renderToStaticMarkup(
    createElement(ShareDocContactFolderButton, { repairCaseId: CASE_ID, relativePath: SOURCE_PATH })
  );
}

describe("① 🔴 창은 **눌러야** 뜬다 — 그리자마자 떠 있지 않다", () => {
  test("단추만 있고 창은 없다 — 줄마다 창이 하나씩 서 있지 않다", () => {
    const html = buttonMarkup();
    // 표본이 비어 공짜로 통과하지 않게, 단추가 그려졌다는 사실을 먼저 잰다.
    assert.ok(html.includes("data-share-doc-contact-folder-save"), html);
    assert.equal(html.includes("data-share-doc-folder-picker"), false, "창이 처음부터 떠 있다");
    assert.equal(html.includes('role="dialog"'), false, html);
    // 🔴 단추가 **여는 일**을 한다는 사실이 보조기기에도 드러난다.
    assert.ok(html.includes('aria-haspopup="dialog"'), html);
  });

  test("🔴 단추를 누르는 자리가 **창 열기**다 — 거기서 보내지 않는다", () => {
    const body = code(buttonSource);
    assert.ok(body.includes("onClick={() => setPicking(true)}"), "단추가 창을 열지 않는다");
    // 보내는 자리는 하나뿐이고, 그것은 창의 [저장]이 부르는 handleSave 안이다.
    assert.equal(body.match(/saveShareDocToContactFolder\(/g)?.length, 1, "보내는 자리가 하나가 아니다");
    assert.equal(body.match(/handleSave\(/g)?.length, 2, "handleSave 를 부르는 자리가 하나가 아니다");
    assert.ok(body.includes("void handleSave(category);"), "창의 [저장]이 보내지 않는다");
    // 🔴 [취소]는 **닫기만** 한다 — 이 줄에 보내는 일이 한 글자도 없다.
    const cancel = body.match(/onCancel=\{[^}]*\}/)?.[0];
    assert.ok(cancel !== undefined, "[취소]를 잇지 않았다");
    assert.equal(cancel, "onCancel={() => setPicking(false)}");
  });
});

describe("② 🔴 열셋이 서고 **기본 선택은 `공통`**", () => {
  test("라디오가 열셋이고 켜져 있는 것은 하나 — 그 하나가 `공통` 이다", () => {
    const html = dialogMarkup();
    assert.equal(html.match(/type="radio"/g)?.length, 13, html);

    // 🔴 켜진 칸을 **칸마다 쪼개어** 찾는다 — 속성 차례(checked 가 value 앞이다)에 기대면
    //    React 가 차례를 바꾸는 날 조용히 틀린다.
    const blocks = html.split('data-share-doc-folder-option="').slice(1);
    assert.equal(blocks.length, 13, html);
    const checked = blocks
      .filter((block) => block.slice(0, block.indexOf("</label>")).includes('checked=""'))
      .map((block) => block.slice(0, block.indexOf('"')));
    // 🔴 켜져 있는 칸이 **하나**이고 그것이 `공통` 이다 — 아무것도 안 켜져 있으면 [저장]이
    //    무엇을 보낼지 알 수 없고, 다른 칸이 켜져 있으면 예전 동작이 바뀐 것이다.
    assert.deepEqual(checked, [CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE], html);
    assert.equal(blocks[0].slice(0, blocks[0].indexOf('"')), CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE, "맨 위가 아니다");
  });

  test("🔴 고를 거리의 글자가 **이름표 표 그대로**다 — 열둘이 다 있다", () => {
    const html = dialogMarkup();
    assert.equal(CONTACT_FOLDER_SAVE_TARGET_CATEGORIES.length, 12);
    for (const category of CONTACT_FOLDER_SAVE_TARGET_CATEGORIES) {
      assert.ok(html.includes(`value="${category}"`), `${category} 칸이 없다`);
      assert.ok(html.includes(`>${attachmentCategoryLabels[category]}</span>`), `${category} 의 글자가 다르다`);
    }
    assert.ok(html.includes(">공통</span>"), html);
  });

  test("🔴 사진 분류 · 데이터류는 **한 칸도 없다** — 서류만 고른다(2026-11-18)", () => {
    const html = dialogMarkup();
    for (const category of ["INTAKE_PHOTO", "SHIPMENT_PHOTO", "OSCILLOSCOPE_DATA", "PARAMETER", "SCREENSHOT"] as const) {
      assert.equal(html.includes(`value="${category}"`), false, `${category} 가 들어왔다`);
      assert.equal(html.includes(attachmentCategoryLabels[category]), false, `${attachmentCategoryLabels[category]}`);
    }
  });
});

describe("③ 창의 생김새와 **보내지 않는다**는 사실", () => {
  test("팝업의 틀 — role · aria-modal · 바탕 가림막(이웃 창과 같은 모양)", () => {
    const html = dialogMarkup();
    assert.ok(html.includes('role="dialog"'), html);
    assert.ok(html.includes('aria-modal="true"'), html);
    assert.ok(html.includes("fixed inset-0"), html);
    assert.ok(html.includes("bg-black/50"), html);
    assert.ok(html.includes(SHARE_DOC_FOLDER_PICKER_TITLE), html);
    assert.ok(html.includes(`>${SHARE_DOC_FOLDER_PICKER_SAVE_TEXT}</button>`), html);
    assert.ok(html.includes(`>${SHARE_DOC_FOLDER_PICKER_CANCEL_TEXT}</button>`), html);
    // 🔴 가리킨 자리를 적는다 — 창이 어느 줄의 것인지 사람이 알아야 한다.
    assert.ok(html.includes(SOURCE_PATH), html);
    // 🔴 종이에는 안 찍힌다(두 구역과 같은 선).
    assert.ok(html.includes("print:hidden"), html);
  });

  test("🔴 줄에서 물려받는 글자 모양을 **끊는다** — 오른쪽으로 쏠리지 않는다", () => {
    // 이 창은 `text-right`·`text-xs` 인 줄 안에서 태어난다. `fixed` 로 띄워도 글자 크기와
    // 정렬은 DOM 부모를 따라 내려오므로 안쪽 상자에서 다시 적어야 한다.
    const html = dialogMarkup();
    assert.ok(html.includes("text-left"), html);
    assert.ok(/text-left[^"]*text-sm|text-sm[^"]*text-left/.test(html), "글자 크기를 다시 적지 않았다");
  });

  test("🔴 창은 **제 손으로 아무것도 보내지 않는다** — fetch 도 통로 주소도 없다", () => {
    const body = code(dialogSource);
    for (const forbidden of ["fetch(", "/api/", 'method: "POST"', "saveShareDocToContactFolder", "useEffect"]) {
      assert.equal(body.includes(forbidden), false, `창이 보내는 일을 들고 있다: ${forbidden}`);
    }
    // 🔴 고를 거리를 창이 정하지 않는다 — 목록도 이름표도 domain 한 자리에서 온다.
    assert.ok(dialogSource.includes("CONTACT_FOLDER_SAVE_TARGET_OPTIONS"), dialogSource);
    for (const forbidden of ["INSPECTION_REPORT", "검사 보고서", "견적서", "attachmentCategoryLabels"]) {
      assert.equal(body.includes(forbidden), false, `창이 목록 · 이름표를 베꼈다: ${forbidden}`);
    }
  });
});
