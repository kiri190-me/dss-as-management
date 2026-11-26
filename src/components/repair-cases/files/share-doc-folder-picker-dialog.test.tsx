import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { attachmentCategoryLabels } from "@/lib/domain/attachment-category";
import { contactFolderCopyFileName } from "@/lib/domain/contact-folder-naming";
import {
  CONTACT_FOLDER_SAVE_FILE_NAME_HIDDEN_REASON,
  CONTACT_FOLDER_SAVE_FILE_NAME_PATH_REASON,
  contactFolderSaveFileNameDefault,
} from "@/lib/domain/contact-folder-save-file-name";
import {
  CONTACT_FOLDER_SAVE_TARGET_CATEGORIES,
  CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE,
} from "@/lib/domain/contact-folder-save-targets";
import ShareDocContactFolderButton from "./ShareDocContactFolderButton";
import ShareDocFolderPickerDialog, {
  SHARE_DOC_FOLDER_PICKER_CANCEL_TEXT,
  SHARE_DOC_FOLDER_PICKER_FILE_NAME_HINT,
  SHARE_DOC_FOLDER_PICKER_FILE_NAME_LABEL,
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
 *  · 🔴 열넷이 서고 **기본 선택이 `공통`** 이다(라디오가 하나만 켜져 있다 — 2026-11-18
 *    에는 열셋이었고 2026-11-26 에 `DATA` 가 들어와 하나 늘었다)
 *  · 🔴 보일 글자는 **이름표 표**에서 온다 — 사진 분류 다섯은 한 칸도 없다
 *  · 🔴 창은 **제 손으로 아무것도 보내지 않는다**(fetch 도 통로 주소도 없다)
 *  · 🔴 [취소]는 **닫기만** 한다 — 요청이 한 번도 나가지 않는다
 *  · 🔴 줄에서 물려받는 글자 모양(`text-right`·`text-xs`)을 창 안에서 끊는다
 *  · 🔴 **파일 이름 칸**(2026-11-26)이 라디오 아래에 서고, 거기 적힌 기본값이 **지금
 *    저장될 이름**이다 · 규칙도 까닭 글귀도 창이 들고 있지 않다 · 쓸 수 없는 이름이면
 *    **창이 안 닫힌다**(요청이 나가지 않는다)
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
    // 🔴 2026-11-26 에 넘기는 값이 **둘**이 됐다(고른 폴더 · 적은 이름). 이름을 안 받아
    //    가면 사람이 적은 글자가 조용히 버려지고 늘 원본 이름으로 저장된다.
    assert.ok(body.includes("void handleSave(category, fileName);"), "창의 [저장]이 보내지 않는다");
    // 🔴 [취소]는 **닫기만** 한다 — 이 줄에 보내는 일이 한 글자도 없다.
    const cancel = body.match(/onCancel=\{[^}]*\}/)?.[0];
    assert.ok(cancel !== undefined, "[취소]를 잇지 않았다");
    assert.equal(cancel, "onCancel={() => setPicking(false)}");
  });
});

describe("② 🔴 열넷이 서고 **기본 선택은 `공통`**", () => {
  test("라디오가 열넷이고 켜져 있는 것은 하나 — 그 하나가 `공통` 이다", () => {
    // 🔴 2026-11-18 에는 열셋(공통 + 서류 열둘)이었다. 2026-11-26 에 분류 `DATA` 가
    //    고를 거리 열셋째로 들어와 **열넷**이 됐다(domain/contact-folder-save-targets.ts).
    const html = dialogMarkup();
    assert.equal(html.match(/type="radio"/g)?.length, 14, html);

    // 🔴 켜진 칸을 **칸마다 쪼개어** 찾는다 — 속성 차례(checked 가 value 앞이다)에 기대면
    //    React 가 차례를 바꾸는 날 조용히 틀린다.
    const blocks = html.split('data-share-doc-folder-option="').slice(1);
    assert.equal(blocks.length, 14, html);
    const checked = blocks
      .filter((block) => block.slice(0, block.indexOf("</label>")).includes('checked=""'))
      .map((block) => block.slice(0, block.indexOf('"')));
    // 🔴 켜져 있는 칸이 **하나**이고 그것이 `공통` 이다 — 아무것도 안 켜져 있으면 [저장]이
    //    무엇을 보낼지 알 수 없고, 다른 칸이 켜져 있으면 예전 동작이 바뀐 것이다.
    assert.deepEqual(checked, [CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE], html);
    assert.equal(blocks[0].slice(0, blocks[0].indexOf('"')), CONTACT_FOLDER_SAVE_TARGET_COMMON_VALUE, "맨 위가 아니다");
  });

  test("🔴 고를 거리의 글자가 **이름표 표 그대로**다 — 열셋이 다 있다", () => {
    const html = dialogMarkup();
    assert.equal(CONTACT_FOLDER_SAVE_TARGET_CATEGORIES.length, 13);
    for (const category of CONTACT_FOLDER_SAVE_TARGET_CATEGORIES) {
      assert.ok(html.includes(`value="${category}"`), `${category} 칸이 없다`);
      assert.ok(html.includes(`>${attachmentCategoryLabels[category]}</span>`), `${category} 의 글자가 다르다`);
    }
    assert.ok(html.includes(">공통</span>"), html);
    // 🔴 열셋째 `DATA` 는 **영문 그대로** 뜬다(2026-11-26). 위 되풀이가 이름표 표를
    //    그대로 쓰므로 표가 통째로 한글로 바뀌어도 거기서는 안 걸린다 — 사람이 볼
    //    글자를 여기 한 줄 박아 둔다. 이 글자가 곧 탐색기의 폴더 이름이다.
    assert.ok(html.includes('value="DATA"'), "DATA 칸이 없다");
    assert.ok(html.includes(">DATA</span>"), html);
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

describe("④ 🔴 **파일 이름 칸** — 기본값이 지금 저장될 이름이다 (2026-11-26)", () => {
  test("칸이 **라디오 아래**에 서고, 적혀 있는 글자가 지금 저장될 이름이다", () => {
    const html = dialogMarkup();
    const field = html.indexOf("data-share-doc-folder-picker-file-name=");
    assert.ok(field >= 0, "파일 이름 칸이 없다");
    // 🔴 사용자가 적은 차례다 — 「저장될 폴더를 선택한 **다음에** 파일 이름을」.
    assert.ok(field > html.lastIndexOf("data-share-doc-folder-option="), "칸이 라디오보다 위에 있다");
    assert.ok(field < html.indexOf("data-share-doc-folder-picker-save="), "칸이 [저장]보다 아래에 있다");
    assert.ok(html.includes(`>${SHARE_DOC_FOLDER_PICKER_FILE_NAME_LABEL}</span>`), html);

    // 🔵 무엇을 재는지 먼저 — 이 창이 가리키는 줄의 마지막 마디가 원본 이름이다.
    const source = SOURCE_PATH.split("/").at(-1) ?? "";
    assert.equal(source, "MB 인수시 체크시트.xlsx");
    // 🔴 적혀 있는 글자 = **아무것도 안 건드리고 [저장]했을 때 디스크에 설 이름**이다.
    //    창이 제 손으로 짓지 않고 domain 이 지은 그 값이어야 한다.
    assert.equal(contactFolderSaveFileNameDefault(SOURCE_PATH), contactFolderCopyFileName(source));
    assert.ok(html.includes(`value="${contactFolderSaveFileNameDefault(SOURCE_PATH)}"`), html);
  });

  test("🔴 **다듬기 전 원본 글자가 아니다** — 둘이 갈리는 이름으로 잰다", () => {
    // 🔵 위 시험의 표본은 다듬어도 글자가 안 바뀌는 이름이라, 기본값을 원본으로 되돌려도
    //    조용히 통과한다. 둘이 **갈리는** 이름을 하나 더 세워 그 구멍을 막는다.
    const raw = "점검표:2026.xlsx";
    const dirtyPath = `2. 인수시 서류/${raw}`;
    assert.notEqual(contactFolderCopyFileName(raw), raw, "표본이 틀렸다 — 다듬기가 글자를 안 바꾼다");

    const html = renderToStaticMarkup(
      createElement(ShareDocFolderPickerDialog, { relativePath: dirtyPath, onSave: () => {}, onCancel: () => {} })
    );
    assert.ok(html.includes(`value="${contactFolderSaveFileNameDefault(dirtyPath)}"`), html);
    // 🔴 창이 말한 이름과 공유폴더에 설 이름이 달라지면 사람이 그 차이를 설명할 길이 없다.
    assert.equal(html.includes(`value="${raw}"`), false, "다듬기 전 원본 글자를 내밀었다");
  });

  test("🔴 처음에는 꾸지람이 없다 — 열자마자 빨간 줄이 서 있지 않다", () => {
    const html = dialogMarkup();
    assert.equal(html.includes("data-share-doc-folder-picker-file-name-error"), false, html);
    // 대신 미리 알려 둘 두 가지는 늘 보인다(확장자가 유지된다 · 비우면 원본 이름).
    assert.ok(html.includes(SHARE_DOC_FOLDER_PICKER_FILE_NAME_HINT), html);
  });

  test("🔴 규칙도 **까닭 글귀도** 창이 들고 있지 않다 — domain 에서 온다", () => {
    const body = code(dialogSource);
    for (const used of [
      "contactFolderSaveFileNameDefault(",
      "checkContactFolderSaveFileName(",
      "contactFolderSaveFileNameToSend(",
    ]) {
      assert.ok(body.includes(used), `창이 ${used} 를 안 쓴다 — 규칙을 제 손으로 들었다`);
    }
    // 🔴 거절 까닭을 베껴 적지 않았다 — 베끼면 화면이 말하는 것과 서버가 말하는 것이 갈라진다.
    for (const reason of [CONTACT_FOLDER_SAVE_FILE_NAME_PATH_REASON, CONTACT_FOLDER_SAVE_FILE_NAME_HIDDEN_REASON]) {
      assert.equal(body.includes(reason), false, `창이 까닭을 베꼈다: ${reason}`);
    }
    // 다듬기 · 금지 글자 표도 창에 없다(통로와 꽂는 함수의 몫이다).
    for (const forbidden of ["sanitizeShareFolderNamePiece", "contactFolderCopyFileName", "normalize(", "replace("]) {
      assert.equal(body.includes(forbidden), false, `창이 이름을 제 손으로 다듬는다: ${forbidden}`);
    }
  });

  test("🔴 쓸 수 없는 이름이면 **창이 안 닫힌다** — 요청이 나가지 않는다", () => {
    const body = code(dialogSource);
    // [저장]은 곧바로 넘기지 않고 handleSave 를 지난다.
    assert.ok(body.includes("onClick={handleSave}"), "[저장]이 검사를 건너뛴다");
    const check = body.indexOf("checkContactFolderSaveFileName(");
    const hand = body.indexOf("onSave(picked,");
    assert.ok(check >= 0 && hand >= 0, body);
    // 🔴 검사가 **먼저**이고, 걸리면 `return;` 으로 돌아선다 — 그 사이에 onSave 가 없다.
    assert.ok(check < hand, "검사보다 넘기기가 앞이다");
    assert.ok(/setFileNameError\(reason\);\s*return;/.test(body), "걸렸을 때 돌아서지 않는다");
    // 🔴 넘기는 자리가 **하나**뿐이다 — 검사를 비켜 가는 두 번째 길이 없다.
    assert.equal(body.match(/onSave\(/g)?.length, 1, body);
  });
});
