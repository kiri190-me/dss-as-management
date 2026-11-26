import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { KindShareDocRow } from "@/components/product-models/KindShareDocsSection";
import type { ModelShareDocRow } from "@/components/product-models/ModelShareDocsSection";
import CaseKindShareDocsSection from "./CaseKindShareDocsSection";
import CaseModelShareDocsSection from "./CaseModelShareDocsSection";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — 넣은 뒤 **「공유폴더」 구역을 다시 읽는다** (2026-11-18)
 * ============================================================================
 * 「팝업에서 폴더를 정하고 저장을 누르면 **[공유폴더]창에 그 폴더가 바로 보이도록** 해줘」
 * (사용자 요구 2026-11-18). 폴더는 실제로 생기는데 화면에는 새로 고치기 전까지 안 나타났다.
 *
 * 길은 이미 깔려 있었다 — 올리기 · [DATA에 저장]이 쓰는 `reloadToken` 신호가 그대로 있고
 * (ContactFolderSection 은 숫자가 바뀌면 **보고 있던 자리 그대로** 다시 읽는다), 빠진 것은
 * 새 단추가 그 신호를 **안 올린다**는 한 가지뿐이었다. 그래서 여기서 재는 것은 **선이
 * 이어졌는가**다:
 *
 *  · 🔴 단추가 넣기를 마치면 신호를 **한 번** 올린다 — `finally` 라 성공 · 실패를 가리지
 *    않는다(🔴 [DATA에 저장]의 규율 그대로다 — 같은 구역을 다시 읽는 일이 둘로 갈라지면
 *    나중에 한쪽만 고쳐진다)
 *  · 🔴 [취소]는 **한 번도** 올리지 않는다 — 요청 자체가 안 나간다
 *  · 🔴 **두 구역이 다** 나른다(종류 공통 · 이 제품 모델) — 한쪽만 이으면 그쪽에서 넣었을
 *    때만 화면이 따라온다
 *  · 🔴 **콜백을 안 주면** 저장은 그대로 되고 아무 일도 안 난다(그려 보고 잰다)
 *  · 🔴 **FilesScreen 이 두 구역에 실제로 그 칸을 넘긴다** — 선이 끊기면 아래 시험이 전부
 *    통과하는데 화면에서만 안 된다
 *
 * ⚠️ 이 저장소의 화면 시험에는 DOM 이 없다(renderToStaticMarkup 뿐이고 jsdom 이 없다) —
 * **누를 수가 없다.** 그래서 「눌렀을 때 무엇이 일어나는가」는 그려진 결과와 **원본 글자**로
 * 가른다(이웃 share-doc-folder-picker-dialog.test.tsx · contact-folder-data-save.test.ts 가
 * 같은 까닭으로 같은 길을 쓴다). 묶는 쪽(FilesScreen)은 서버 액션 사슬을 물고 있어 아예
 * 그려 볼 수 없으므로 **원본을 글자로** 읽는다.
 * ============================================================================
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function read(...pieces: string[]): string {
  return readFileSync(path.join(here, ...pieces), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 뺀 코드 — 머리말이 까닭을 적으며 드는 낱말에 걸리지 않게. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const flat = (source: string) => source.replace(/\s+/g, " ");

const buttonSource = read("ShareDocContactFolderButton.tsx");
const kindSectionSource = read("CaseKindShareDocsSection.tsx");
const modelSectionSource = read("CaseModelShareDocsSection.tsx");
const filesScreen = read("FilesScreen.tsx");
const storedListSource = read("StoredAttachmentList.tsx");
const shrinkDialogSource = read("ShrinkDownloadDialog.tsx");
const contactSectionSource = read("ContactFolderSection.tsx");

/** 🔴 올리는 그 한 줄. 세 자리(두 [DATA에 저장]과 이 단추)가 **같은 글자**를 쓴다. */
const SIGNAL_CALL = "onSavedToContactFolder?.();";
/** 🔴 파일 관리 화면이 세 자리에 꽂는 **같은 신호**. 글자가 갈라지면 규율도 갈라진다. */
const SIGNAL_WIRE = "onSavedToContactFolder={() => setContactFolderReloadToken((token) => token + 1)}";

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** `async function handleSave(...) { … }` 의 몸통을 중괄호를 세어 떼어 낸다. */
function handleSaveBody(source: string): string {
  const at = source.indexOf("async function handleSave(");
  assert.notEqual(at, -1, "handleSave 가 없다");
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error("handleSave 의 끝을 못 찾았다");
}

/** 그 몸통을 `try` 쪽과 `finally` 쪽으로 가른다 — 「성공에만」인지 「끝나면 무조건」인지. */
function tryAndFinally(body: string): { tryPart: string; finallyPart: string } {
  const tryAt = body.indexOf("try {");
  const splitAt = body.indexOf("} finally {");
  assert.ok(tryAt >= 0 && splitAt > tryAt, "try/finally 가 아니다");
  return {
    tryPart: body.slice(tryAt + "try {".length, splitAt),
    finallyPart: body.slice(splitAt + "} finally {".length, body.lastIndexOf("}")),
  };
}

const KIND_DOC: KindShareDocRow = {
  id: "11111111-1111-4111-8111-111111111111",
  entryKind: "FILE",
  relativePath: "2. 인수시 서류/MB 인수시 체크시트.xlsx",
  label: null,
};

const MODEL_DOC: ModelShareDocRow = {
  id: "22222222-2222-4222-8222-222222222222",
  entryKind: "FILE",
  relativePath: "2. 인수시 서류/MBK200 회로도.pdf",
  label: null,
};

const CASE_ID = "99999999-9999-4999-8999-999999999999";

function kindMarkup(onSavedToContactFolder?: () => void): string {
  return renderToStaticMarkup(
    createElement(CaseKindShareDocsSection, {
      kind: "GENERATOR",
      docs: [KIND_DOC],
      repairCaseId: CASE_ID,
      canCopyToContactFolder: true,
      onSavedToContactFolder,
    })
  );
}

function modelMarkup(onSavedToContactFolder?: () => void): string {
  return renderToStaticMarkup(
    createElement(CaseModelShareDocsSection, {
      docs: [MODEL_DOC],
      repairCaseId: CASE_ID,
      canCopyToContactFolder: true,
      onSavedToContactFolder,
    })
  );
}

const copyButtonCount = (html: string) => html.match(/data-share-doc-contact-folder-save/g)?.length ?? 0;

describe("① 🔴 넣기가 끝나면 신호를 올린다 — [DATA에 저장]과 **같은 규율**", () => {
  test("🔴 `finally` 안이다 — 성공 자리(try)에는 한 글자도 없다", () => {
    const { tryPart, finallyPart } = tryAndFinally(handleSaveBody(code(buttonSource)));
    // 표본이 비어 공짜로 통과하지 않게, 보내는 일이 try 쪽에 있다는 사실을 먼저 잰다.
    assert.ok(tryPart.includes("saveShareDocToContactFolder("), tryPart);

    // 🔴 성공만 가려 부르지 않는다 — 못 넣었어도 부른다([DATA에 저장]이 하는 그대로다).
    assert.equal(tryPart.includes("onSavedToContactFolder"), false, "성공 자리에서 부른다");
    assert.equal(count(finallyPart, SIGNAL_CALL), 1, finallyPart);
  });

  test("🔴 올리는 자리가 **하나뿐**이다 — 한 번 넣으면 한 번 간다", () => {
    // 파일 전체에 한 번. 창을 열 때도 · [취소]에도 · 결과를 그릴 때도 없다.
    assert.equal(count(code(buttonSource), SIGNAL_CALL), 1, buttonSource);
    assert.equal(count(code(buttonSource), "onSavedToContactFolder?."), 1, buttonSource);
    // 그 하나가 handleSave 안이다 — 바깥에 또 있지 않다.
    assert.equal(count(handleSaveBody(code(buttonSource)), SIGNAL_CALL), 1);

    // 🔴 두 번 누르기도 한 번이다 — 넣는 중이면 요청도 신호도 없이 돌아선다.
    assert.ok(handleSaveBody(code(buttonSource)).trimStart().startsWith("if (busy) return;"), buttonSource);
  });

  test("🔴 [DATA에 저장] 두 자리와 **같은 글자 · 같은 자리**다 — 규율이 갈라지지 않았다", () => {
    for (const [name, source] of [
      ["StoredAttachmentList.tsx", storedListSource],
      ["ShrinkDownloadDialog.tsx", shrinkDialogSource],
      ["ShareDocContactFolderButton.tsx", buttonSource],
    ] as const) {
      const body = code(source);
      const at = body.indexOf(SIGNAL_CALL);
      assert.notEqual(at, -1, `${name}: 신호를 안 올린다`);
      // 그 호출 바로 앞에 `} finally {` 가 있다 — 세 자리가 모두 「끝나면 무조건」이다.
      assert.ok(body.slice(Math.max(0, at - 400), at).includes("} finally {"), `${name}: finally 가 아니다`);
    }
  });

  test("🔴 단추가 제 손으로 다시 읽지 않는다 — 신호만 올린다", () => {
    const body = code(buttonSource);
    // 다시 읽는 일은 공유폴더 구역의 것이다(그 구역의 useEffect). 단추가 목록을 읽으면
    // 같은 일을 두 곳이 하게 되고, 보고 있던 자리를 누가 들고 있는지도 흐려진다.
    for (const forbidden of ["loadContactFolderEntries", "useEffect", "reloadToken", "router.refresh"]) {
      assert.equal(body.includes(forbidden), false, `단추가 다시 읽는 일을 들고 있다: ${forbidden}`);
    }
  });
});

describe("② 🔴 [취소]면 신호가 **한 번도** 안 간다 — 요청 자체가 안 나간다", () => {
  test("닫기만 하는 줄이다 — 거기에 신호도 보내는 일도 없다", () => {
    const body = code(buttonSource);
    const cancel = body.match(/onCancel=\{[^}]*\}/)?.[0];
    assert.equal(cancel, "onCancel={() => setPicking(false)}", body);

    // 신호가 가는 길은 handleSave 하나뿐이고, 그것을 부르는 것은 **창의 [저장]**이다.
    // 🔴 2026-11-26 에 넘기는 값이 **둘**이 됐다(고른 폴더 · 적은 이름) — 창이 이름 칸을
    //    받으면서다. [취소]가 아무 일도 안 한다는 이 시험의 뜻은 한 글자도 안 바뀌었다.
    assert.ok(body.includes("void handleSave(category, fileName);"), "창의 [저장]이 보내지 않는다");
    assert.equal(body.match(/handleSave\(/g)?.length, 2, "handleSave 를 부르는 자리가 하나가 아니다");
    // 단추를 누르는 일은 **창 열기**다 — 거기서 보내지도 알리지도 않는다.
    assert.ok(body.includes("onClick={() => setPicking(true)}"), body);
  });
});

describe("③ 🔴 **두 구역이 다** 나른다 — 한쪽만 이으면 다른 쪽이 조용히 빠진다", () => {
  for (const [name, source] of [
    ["CaseKindShareDocsSection", kindSectionSource],
    ["CaseModelShareDocsSection", modelSectionSource],
  ] as const) {
    test(`${name} — 받은 칸을 단추에 **그대로** 건넨다`, () => {
      const body = code(source);
      // 받는다(선택이다) · 단추에 건넨다. 중간에서 이름을 바꾸거나 가공하지 않는다.
      assert.ok(body.includes("onSavedToContactFolder?: () => void;"), `${name}: 칸을 안 받는다`);
      assert.ok(flat(body).includes("onSavedToContactFolder={onSavedToContactFolder}"), `${name}: 안 건넨다`);
      assert.equal(count(flat(body), "onSavedToContactFolder={"), 1, `${name}: 건네는 자리가 둘이다`);
    });

    test(`${name} — 🔴 제 손으로 다시 읽지 않는다(지나 보내기만 한다)`, () => {
      const body = code(source);
      for (const forbidden of ["useState", "useEffect", "fetch(", "reloadToken", "loadContactFolderEntries"]) {
        assert.equal(body.includes(forbidden), false, `${name}: 다시 읽는 일을 들고 있다: ${forbidden}`);
      }
    });
  }
});

describe("④ 🔴 콜백을 안 주면 — 저장은 그대로 되고 **아무 일도 안 난다**", () => {
  test("종류 구역 — 안 줘도 단추가 서고, 줘도 화면이 한 글자도 안 달라진다", () => {
    const without = kindMarkup();
    assert.equal(copyButtonCount(without), 1, without);
    assert.equal(kindMarkup(() => {}), without);
  });

  test("모델 구역 — 안 줘도 단추가 서고, 줘도 화면이 한 글자도 안 달라진다", () => {
    const without = modelMarkup();
    assert.equal(copyButtonCount(without), 1, without);
    assert.equal(modelMarkup(() => {}), without);
  });

  test("🔴 그려 보는 동안 콜백이 **불리지 않는다** — 넣지도 않았는데 다시 읽게 하면 안 된다", () => {
    let calls = 0;
    kindMarkup(() => {
      calls += 1;
    });
    modelMarkup(() => {
      calls += 1;
    });
    assert.equal(calls, 0);
  });
});

describe("⑤ 🔴 파일 관리 화면이 **실제로 선을 잇는다** — 끊기면 여기 말고는 아무 데서도 안 보인다", () => {
  test("두 구역 태그 **안**에 신호가 들어 있다 — 옆에 적어 둔 것이 아니다", () => {
    for (const tag of ["<CaseKindShareDocsSection", "<CaseModelShareDocsSection"]) {
      assert.equal(count(filesScreen, tag), 1, `${tag} 가 하나가 아니다`);
      const element = flat(filesScreen).slice(flat(filesScreen).indexOf(tag));
      const self = element.slice(0, element.indexOf("/>") + 2);
      assert.ok(self.includes(SIGNAL_WIRE), `${tag} 가 신호를 안 받는다: ${self}`);
      // 단추가 서는 조건(설정 · 권한 · 어느 건인가)도 그대로 간다 — 칸을 바꿔치지 않았다.
      assert.ok(self.includes("repairCaseId={resolved.id}"), self);
      assert.ok(self.includes("canCopyToContactFolder={shareDocCopyEnabled}"), self);
    }
  });

  test("🔴 [DATA에 저장]과 **같은 글자 · 같은 칸**이다 — 세 자리가 한 숫자를 올린다", () => {
    // 올린 파일 쪽 하나 + 공유폴더 구역 둘.
    assert.equal(count(filesScreen, SIGNAL_WIRE), 3, filesScreen);
    assert.ok(filesScreen.includes("const [contactFolderReloadToken, setContactFolderReloadToken] = useState(0);"));
  });

  test("🔴 받는 쪽이 그대로다 — 숫자가 오르면 **보고 있던 자리 그대로** 다시 읽는다", () => {
    assert.ok(
      filesScreen.includes("<ContactFolderSection repairCaseId={resolved.id} reloadToken={contactFolderReloadToken} />"),
      "공유폴더 구역이 신호를 안 받는다"
    );
    // 그 구역은 이 조각에서 한 글자도 안 고쳤다 — 숫자를 의존성에 들고 있고, 자리(insidePath)는
    // 그대로 둔 채 다시 읽는다. 🔴 자리를 루트로 되돌리는 코드를 넣지 않았다.
    assert.ok(flat(contactSectionSource).includes("}, [repairCaseId, insidePath, reloadToken]);"), contactSectionSource);
    assert.ok(contactSectionSource.includes("reloadToken = 0,"), contactSectionSource);
  });
});
