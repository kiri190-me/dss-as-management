import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ModelShareDocsSection, {
  MODEL_SHARE_DOCS_TITLE,
  MODEL_SHARE_DOC_REMOVE_IRREVERSIBLE_TEXT,
  MODEL_SHARE_DOC_REMOVE_KEEPS_FILE_TEXT,
  ModelShareDocList,
  ModelShareDocRemoveDialog,
  canOpenModelShareDoc,
  modelShareDocDisplayName,
  modelShareDocFileName,
  modelShareDocParentPath,
  type ModelShareDocRow,
} from "./ModelShareDocsSection";
import ModelShareFolderPicker, {
  MODEL_SHARE_FOLDER_ADD_FILE_TEXT,
  MODEL_SHARE_FOLDER_ADD_FOLDER_TEXT,
  MODEL_SHARE_FOLDER_EMPTY_TEXT,
  MODEL_SHARE_FOLDER_FAILED_TEXT,
  MODEL_SHARE_FOLDER_LOADING_TEXT,
  ModelShareFolderPickerView,
  canOpenModelShareFolderEntry,
  loadModelShareFolderEntries,
  modelShareFolderEntriesUrl,
  modelShareFolderEntryPath,
  readModelShareFolderEntriesAnswer,
  type ModelShareFolderEntryView,
  type ModelShareFolderPickerState,
} from "./ModelShareFolderPicker";

/**
 * ============================================================================
 * 제품 **모델별** 공유폴더 가리킴 — 화면 쪽 (2026-10-07)
 * ============================================================================
 * 서버 쪽 규율은 이미 다른 시험들이 본다(목록 통로 · 담기·지우기 액션 · 표와 감사).
 * 여기서는 **화면이 무엇을 내는가**만 본다.
 *
 * ── 왜 그려 보는가 ──────────────────────────────────────────────────────
 * 🔴 두 조각은 서버 액션을 `onAdd` · `onRemove` 로 **받도록** 만들어 두었다 — 직접
 * import 하면 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는
 * test:components 에서 import 자체가 던진다. 그래서 「단추가 있는가 · 없는가」를 글자
 * 매칭이 아니라 **상태를 넣어 실제로 그려** 본다. 화면을 묶는 쪽
 * (ProductModelDetailScreen · [id]/page.tsx)만 원본을 글자로 읽는다(그쪽은 서버 액션을 문다).
 *
 * 🔴 본보기 두 벌(KindShareDocsSection · KindShareFolderPicker)은 **한 글자도 고치지
 * 않았다.** 이쪽이 그쪽에서 **가져다 쓰는** 것은 도우미 안내 하나뿐이고, 그것도 아래
 * ⑧에서 「베끼지 않았는가」로 못 박는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const screen = read("src/components/product-models/ProductModelDetailScreen.tsx");
const modelPage = read("src/app/(app)/product-models/[id]/page.tsx");
const pickerSource = read("src/components/product-models/ModelShareFolderPicker.tsx");
const sectionSource = read("src/components/product-models/ModelShareDocsSection.tsx");

const MODEL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSIDE = "2. 인수시 서류";

const entry = (
  name: string,
  isDirectory = false,
  extra: Partial<ModelShareFolderEntryView> = {}
): ModelShareFolderEntryView => ({ name, isDirectory, sizeBytes: 1, ...extra });

const listed = (
  entries: ModelShareFolderEntryView[],
  overrides: Partial<Extract<ModelShareFolderPickerState, { kind: "listed" }>> = {}
): ModelShareFolderPickerState => ({
  kind: "listed",
  entries,
  totalCount: entries.length,
  truncated: false,
  ...overrides,
});

function pickerMarkup(
  state: ModelShareFolderPickerState,
  {
    insidePath = INSIDE,
    withAdd = true,
    withNavigate = true,
  }: { insidePath?: string; withAdd?: boolean; withNavigate?: boolean } = {}
): string {
  return renderToStaticMarkup(
    createElement(ModelShareFolderPickerView, {
      state,
      insidePath,
      ...(withNavigate ? { onNavigate: () => undefined } : {}),
      ...(withAdd ? { onAdd: () => undefined } : {}),
    })
  );
}

const doc = (overrides: Partial<ModelShareDocRow> = {}): ModelShareDocRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  entryKind: "FILE",
  relativePath: `${INSIDE}/MB 인수시 체크시트.xlsx`,
  label: null,
  ...overrides,
});

function sectionMarkup(docs: ModelShareDocRow[], canManageFiles: boolean): string {
  return renderToStaticMarkup(
    createElement(ModelShareDocsSection, {
      productModelId: MODEL_ID,
      docs,
      canManageFiles,
      onAdd: () => Promise.resolve({ ok: true as const }),
      onRemove: () => Promise.resolve({ ok: true as const }),
    })
  );
}

describe("① 🔴 설정이 비면(disabled) 고르는 창을 **아예 안 그린다**", () => {
  test("상태가 disabled 면 빈 글자다 — 설정이 없는 환경(개발 PC)에서 빈 상자가 늘지 않게", () => {
    assert.equal(pickerMarkup({ kind: "disabled" }), "");
    assert.deepEqual(readModelShareFolderEntriesAnswer({ status: "disabled" }), { kind: "disabled" });
  });

  test("🔴 설정이 비어도 **가리킴 목록 구역은 그대로** 선다 — 그쪽은 DB 다", () => {
    // 고르는 창은 제 상태로 스스로 꺼지지만, 담아 둔 줄은 공유폴더와 무관하게 보인다.
    const html = sectionMarkup([doc()], true);
    assert.ok(html.includes(MODEL_SHARE_DOCS_TITLE), html);
    assert.ok(html.includes("data-model-share-doc-row"), html);
  });

  test("다른 상태는 그려진다 — 불러오는 중 · 비었음 · 읽지 못함", () => {
    assert.ok(pickerMarkup({ kind: "loading" }).includes(MODEL_SHARE_FOLDER_LOADING_TEXT));
    assert.ok(pickerMarkup(listed([])).includes(MODEL_SHARE_FOLDER_EMPTY_TEXT));
    const failed = pickerMarkup({ kind: "failed", reason: "공유폴더에 연결할 수 없습니다" });
    assert.ok(failed.includes(MODEL_SHARE_FOLDER_FAILED_TEXT), failed);
    assert.ok(failed.includes("공유폴더에 연결할 수 없습니다"), failed);
    assert.ok(failed.includes("text-amber-700"), failed);
  });
});

describe("② 🔴 폴더 줄에도 담기 단추가 있다", () => {
  test("폴더 줄 · 파일 줄 **둘 다** 담기 단추를 받는다", () => {
    const html = pickerMarkup(listed([entry("1. 수리 관련", true), entry("체크시트.xlsx")]));
    assert.equal(html.match(/data-model-share-folder-add/g)?.length, 2, html);
    assert.ok(html.includes(`>${MODEL_SHARE_FOLDER_ADD_FOLDER_TEXT}</button>`), html);
    assert.ok(html.includes(`>${MODEL_SHARE_FOLDER_ADD_FILE_TEXT}</button>`), html);
  });

  test("담을 때 보내는 경로는 **지금 자리에 이름을 이은 것**이다", () => {
    assert.equal(modelShareFolderEntryPath("", "1. 수리 관련"), "1. 수리 관련");
    assert.equal(modelShareFolderEntryPath(INSIDE, "MB"), `${INSIDE}/MB`);
    assert.equal(modelShareFolderEntryPath("a//b/", "c"), "a/b/c");
  });

  test("폴더 줄은 눌러 **그 안으로** 들어간다 · 길 표시와 [위로]가 선다", () => {
    const html = pickerMarkup(listed([entry("MB", true), entry("체크시트.xlsx")]));
    assert.equal(html.match(/data-model-share-folder-enter/g)?.length, 1, html);
    assert.ok(html.includes("data-model-share-folder-trail"), html);
    assert.ok(html.includes("data-model-share-folder-up"), html);
    // 🔴 링크가 아니다 — 눌러도 페이지를 떠나지 않는다(통로가 출처를 본다).
    assert.equal(html.includes("href="), false, html);
  });

  test("맨 위 칸에서는 [위로]가 없다 — 올라갈 곳이 없다", () => {
    const html = pickerMarkup(listed([entry("1. 수리 관련", true)]), { insidePath: "" });
    assert.equal(html.includes("data-model-share-folder-up"), false, html);
    assert.ok(html.includes("data-model-share-folder-trail"), html);
  });
});

describe("③ 🔴 맨 위 칸에 바로 놓인 파일에는 [열기]가 없다", () => {
  test("고르는 창 — 맨 위 칸에서는 **아무 줄에도** 단추를 두지 않는다", () => {
    assert.equal(canOpenModelShareFolderEntry(entry("체크시트.xlsx"), ""), false);
    const html = pickerMarkup(listed([entry("체크시트.xlsx")]), { insidePath: "" });
    assert.equal(html.includes("data-model-share-folder-entry-openable"), false, html);
    // 이름은 그대로 보인다 — 숨기는 것이 아니라 누를 단추만 없다.
    assert.ok(html.includes("체크시트.xlsx"), html);
  });

  test("🔴 가리킴 목록 — 경로에 앞 폴더가 없는 **파일** 줄에는 [열기]가 없다", () => {
    assert.equal(canOpenModelShareDoc(doc({ relativePath: "체크시트.xlsx" })), false);
    assert.equal(modelShareDocParentPath("체크시트.xlsx"), "");
    // 폴더는 깊이를 가리지 않는다 — 맨 위 칸의 폴더도 탐색기로 열린다.
    assert.equal(canOpenModelShareDoc(doc({ entryKind: "FOLDER", relativePath: "1. 수리 관련" })), true);
    assert.equal(canOpenModelShareDoc(doc()), true);
    assert.equal(canOpenModelShareDoc(doc({ relativePath: `${INSIDE}/설치.exe` })), false);
    assert.equal(modelShareDocParentPath(`${INSIDE}/MB/체크시트.xlsx`), `${INSIDE}/MB`);
    assert.equal(modelShareDocFileName(`${INSIDE}/MB/체크시트.xlsx`), "체크시트.xlsx");
  });

  test("폴더 줄 · 확장자 없는 이름 · 허용 목록 밖에는 단추 자리가 없다", () => {
    for (const name of ["설치.exe", "실행.BAT", "문서", "보고서.pdf.", "보고서.pdf "]) {
      assert.equal(canOpenModelShareFolderEntry(entry(name), INSIDE), false, name);
    }
    for (const name of ["사진", "자료.zip"]) {
      assert.equal(canOpenModelShareFolderEntry(entry(name, true), INSIDE), false, name);
    }
    const html = pickerMarkup(
      listed([entry("사진", true), entry("설치.exe"), entry("문서"), entry("체크시트.xlsx")])
    );
    assert.equal(html.match(/data-model-share-folder-entry-openable/g)?.length, 1, html);
  });

  test("🔴 확장자를 세는 자리는 하나다 — 화면이 제 손으로 목록을 적지 않는다", () => {
    for (const source of [pickerSource, sectionSource]) {
      assert.ok(source.includes("isOpenableQuoteFolderFileName"), "순수 판정을 쓰지 않는다");
      for (const forbidden of ["xlsm", "\\.exe", 'endsWith\\("\\.', "lastIndexOf"]) {
        assert.equal(new RegExp(forbidden).test(code(source)), false, `확장자를 직접 센다: ${forbidden}`);
      }
    }
  });

  test("🔴 여는 단추 둘을 **그대로 가져다 쓴다** — 베끼지 않았다", () => {
    assert.ok(
      sectionSource.includes(
        'import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";'
      )
    );
    assert.ok(
      sectionSource.includes(
        'import ContactFolderPlaceOpenButton from "@/components/repair-cases/files/ContactFolderPlaceOpenButton";'
      )
    );
    assert.ok(
      pickerSource.includes(
        'import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";'
      )
    );
    // 도우미 주소를 여기서 만들지 않는다 — 단추 안쪽의 일이다.
    for (const source of [pickerSource, sectionSource]) {
      assert.equal(code(source).includes("dss-folder://"), false, "도우미 주소를 직접 짓는다");
      assert.equal(code(source).includes("buildQuoteFolderFileLink"), false, "주소 만들기를 베꼈다");
    }
  });
});

describe("④ 🔴 가리킴 목록에 내려받기·미리보기가 없다 — 바이트가 없다", () => {
  test("그려진 줄에 그 말이 하나도 없다", () => {
    const html = renderToStaticMarkup(
      createElement(ModelShareDocList, {
        docs: [
          doc(),
          doc({
            id: "22222222-2222-4222-8222-222222222222",
            entryKind: "FOLDER",
            relativePath: "1. 수리 관련",
          }),
        ],
        onRemove: () => undefined,
      })
    );
    for (const forbidden of ["내려받기", "미리보기", "휴지통", "되살리기"]) {
      assert.equal(html.includes(forbidden), false, `${forbidden} 가 있다`);
    }
    // 🔴 파일 바이트가 우리 출처로 흐르는 주소가 없다.
    assert.equal(html.includes("href="), false, html);
  });

  test("🔴 원본에도 첨부 통로를 부르는 길이 없다", () => {
    for (const source of [pickerSource, sectionSource]) {
      const body = code(source);
      for (const forbidden of [
        "/api/attachments",
        "download",
        ".blob(",
        "FormData",
        'method: "POST"',
        'method: "PUT"',
        'method: "DELETE"',
        "window.open(",
        '"server-only"',
        "@/lib/server/actions/",
        "node:fs",
      ]) {
        assert.equal(
          body.includes(forbidden),
          false,
          `${source === pickerSource ? "고르는 창" : "구역"}: ${forbidden}`
        );
      }
    }
    // 고르는 창이 부르는 통로는 목록 하나뿐이다.
    assert.equal(code(pickerSource).match(/\/share-folder\/entries/g)?.length, 1);
  });

  test("이름이 비면 **경로의 마지막 마디**를 쓴다 — 조회가 NULL 을 그대로 내보내는 까닭", () => {
    assert.equal(modelShareDocDisplayName(doc()), "MB 인수시 체크시트.xlsx");
    assert.equal(modelShareDocDisplayName(doc({ label: "  " })), "MB 인수시 체크시트.xlsx");
    assert.equal(modelShareDocDisplayName(doc({ label: "인수점검 양식" })), "인수점검 양식");
    // 경로는 숨기지 않는다 — 「어느 자리인가」가 이 줄의 전부다.
    const html = renderToStaticMarkup(createElement(ModelShareDocList, { docs: [doc()] }));
    assert.ok(html.includes(`${INSIDE}/MB 인수시 체크시트.xlsx`), html);
  });
});

describe("⑤ 🔴 0건이면 지정 목록이 안 그려진다", () => {
  test("담을 수 있는 사람 — 구역은 서지만 줄도 빈 안내도 없다", () => {
    const html = sectionMarkup([], true);
    assert.equal(html.includes("data-model-share-doc-row"), false, html);
    // 고르는 창은 그대로 선다 — 담을 자리가 없으면 담을 길이 사라진다.
    assert.ok(html.includes("data-model-share-folder-picker"), html);
  });

  test("🔴 담을 수도 없는 사람에게는 **구역 자체가** 없다 — 빈 상자가 늘지 않게", () => {
    assert.equal(sectionMarkup([], false), "");
  });

  test("한 줄이라도 있으면 줄이 그려진다", () => {
    const html = sectionMarkup([doc()], false);
    assert.ok(html.includes("data-model-share-doc-row"), html);
    assert.ok(html.includes("MB 인수시 체크시트.xlsx"), html);
  });
});

describe("⑥ 🔴 지우기 확인 창이 **되돌릴 수 없다**고 말한다", () => {
  const dialog = (submitError: string | null = null) =>
    renderToStaticMarkup(
      createElement(ModelShareDocRemoveDialog, {
        isOpen: true,
        displayName: "MB 인수시 체크시트.xlsx",
        relativePath: `${INSIDE}/MB 인수시 체크시트.xlsx`,
        isSubmitting: false,
        submitError,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      })
    );

  test("되돌릴 수 없다는 말 · 실물은 남는다는 말 · 지울 경로가 함께 선다", () => {
    const html = dialog();
    assert.ok(html.includes(MODEL_SHARE_DOC_REMOVE_IRREVERSIBLE_TEXT), html);
    assert.ok(html.includes("되돌릴 수 없습니다"), html);
    assert.ok(html.includes(MODEL_SHARE_DOC_REMOVE_KEEPS_FILE_TEXT), html);
    assert.ok(html.includes(`${INSIDE}/MB 인수시 체크시트.xlsx`), html);
    // 경고 색이다 — 되돌릴 수 없는 조작이다.
    assert.ok(html.includes("text-red-700"), html);
  });

  test("🔴 「15일 뒤 자동 삭제」를 말하지 않는다 — 이 표에는 휴지통이 없다", () => {
    const html = dialog();
    for (const forbidden of ["15일", "휴지통으로", "복원", "되살", "언제든"]) {
      assert.equal(html.includes(forbidden), false, `사실이 아닌 말: ${forbidden}`);
    }
    // 휴지통이라는 낱말은 **없다는 사실을 말할 때만** 나온다.
    assert.ok(html.includes("휴지통 없이"), html);
    assert.equal(code(sectionSource).includes("15일"), false);
  });

  test("취소와 지우기 두 단추 · ESC 도 취소를 거친다", () => {
    const html = dialog();
    assert.ok(html.includes(">취소</button>"), html);
    assert.ok(html.includes("data-model-share-doc-remove-confirm"), html);
    assert.ok(sectionSource.includes("event.preventDefault();"), "ESC 를 가로채지 않는다");
    assert.ok(sectionSource.includes("dialog.showModal();"), "native dialog 가 아니다");
  });

  test("🔴 거절 사유는 서버 말을 그대로 — 창 안에 적는다", () => {
    const html = dialog("해당 가리킴을 찾을 수 없습니다.");
    assert.ok(html.includes("해당 가리킴을 찾을 수 없습니다."), html);
    assert.ok(flat(sectionSource).includes("setRemoveError(result.message);"), "서버 문장을 그대로 쓰지 않는다");
    assert.ok(
      flat(pickerSource).includes(': { text: result.message, tone: "warning" }'),
      "담기 거절 문장을 그대로 쓰지 않는다"
    );
  });
});

describe("⑦ 🔴 담을 수 있는 사람에게만 고르는 창이 선다", () => {
  test("canManageFiles 가 거짓이면 고르는 창도 지우기 단추도 확인 창도 없다", () => {
    const html = sectionMarkup([doc()], false);
    assert.equal(html.includes("data-model-share-folder-picker"), false, html);
    assert.equal(html.includes("data-model-share-folder-add"), false, html);
    assert.equal(html.includes("data-model-share-doc-remove"), false, html);
    assert.equal(html.includes("data-model-share-doc-remove-dialog"), false, html);
    // 🔴 보는 것은 막지 않는다 — 가리킴 줄 자체는 그대로 보인다.
    assert.ok(html.includes("data-model-share-doc-row"), html);
  });

  test("참이면 셋 다 선다", () => {
    const html = sectionMarkup([doc()], true);
    assert.ok(html.includes("data-model-share-folder-picker"), html);
    assert.ok(html.includes("data-model-share-doc-remove"), html);
    assert.ok(html.includes("data-model-share-doc-remove-dialog"), html);
  });

  test("🔴 길(onAdd · onRemove)을 주지 않으면 단추가 한 줄에도 생기지 않는다", () => {
    assert.equal(
      pickerMarkup(listed([entry("체크시트.xlsx"), entry("MB", true)]), { withAdd: false }).includes(
        "data-model-share-folder-add"
      ),
      false
    );
    assert.equal(
      renderToStaticMarkup(createElement(ModelShareDocList, { docs: [doc()] })).includes(
        "data-model-share-doc-remove"
      ),
      false
    );
  });

  test("🔴 화면이 역할을 스스로 보지 않는다 — boolean 하나만 받는다", () => {
    assert.ok(sectionSource.includes("canManageFiles: boolean"));
    for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"]) {
      for (const source of [pickerSource, sectionSource]) {
        assert.equal(code(source).includes(role), false, `역할을 직접 본다: ${role}`);
      }
    }
    // 새 권한 영역을 지어내지 않았다.
    for (const source of [pickerSource, sectionSource]) {
      assert.equal(/"productModels?\./.test(code(source)), false);
    }
  });
});

describe("⑧ 🔴 인쇄에 안 찍힌다 · 도우미 안내는 베끼지 않았다", () => {
  test("구역 전체에 print:hidden 이 있다 — 적히는 것은 경로지 이 모델의 사실이 아니다", () => {
    for (const docs of [[], [doc()]]) {
      const html = sectionMarkup(docs, true);
      assert.ok(html.includes("print:hidden"), `print:hidden 이 없다(${docs.length}건)`);
    }
    assert.ok(sectionMarkup([doc()], false).includes("print:hidden"));
  });

  test("고르는 창은 그려지는 모든 상태에 print:hidden 이 있다", () => {
    assert.ok(pickerSource.includes("print:hidden"), "print:hidden 이 없다");
    const states: ModelShareFolderPickerState[] = [
      { kind: "loading" },
      { kind: "failed", reason: "까닭" },
      listed([]),
      listed([entry("체크시트.xlsx"), entry("MB", true)]),
    ];
    for (const state of states) {
      assert.ok(pickerMarkup(state).includes("print:hidden"), state.kind);
    }
  });

  test("🔴 도우미 안내를 **베끼지 않고 가져다 쓴다** — 두 벌이 되면 한쪽만 고쳐진다", () => {
    assert.ok(
      sectionSource.includes('import { KindShareDocsHelperNotice } from "./KindShareDocsSection";'),
      "공용 조각을 가져오지 않는다"
    );
    assert.ok(flat(sectionSource).includes("{docs.length > 0 && <KindShareDocsHelperNotice />}"));
    // 🔴 안내 안쪽의 장치를 이 파일에 다시 적지 않았다.
    for (const forbidden of [
      "runQuoteFolderHelperInstallCommandCopy",
      "shouldOfferContactFolderFileHelperInstall",
      "rememberContactFolderFileHelper",
      "useSyncExternalStore",
      "localStorage",
      "dss.helper",
      "execCommand",
      "navigator.clipboard.writeText",
    ]) {
      assert.equal(code(sectionSource).includes(forbidden), false, `베껴 적었다: ${forbidden}`);
    }
  });
});

describe("⑨ 통로 부르기 — 던지지 않는다 · fetch 로만 부른다", () => {
  const ok = (payload: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(payload) });

  test("주소 — 🔴 **모델 id** 가 마디다. 맨 위는 ?path 가 붙지 않는다", () => {
    assert.equal(
      modelShareFolderEntriesUrl(MODEL_ID),
      `/api/product-models/${MODEL_ID}/share-folder/entries`
    );
    assert.equal(
      modelShareFolderEntriesUrl(MODEL_ID, "2. 인수시 서류/MB"),
      `/api/product-models/${MODEL_ID}/share-folder/entries?path=2.%20%EC%9D%B8%EC%88%98%EC%8B%9C%20%EC%84%9C%EB%A5%98%2FMB`
    );
    // 🔴 수상한 값도 그대로 싣지 않는다 — 감싸서 보내고 거절은 서버가 한다.
    assert.ok(modelShareFolderEntriesUrl(MODEL_ID, "../비밀").includes("..%2F"));
  });

  test("🔴 `<a href>` 나 새 탭이 아니라 fetch 다 — 그 통로는 출처를 본다", () => {
    const body = code(pickerSource);
    assert.ok(body.includes("fetchImpl(modelShareFolderEntriesUrl("));
    assert.equal(/href=\{/.test(body), false, "링크로 연다");
    assert.equal(body.includes('target="_blank"'), false, "새 탭으로 연다");
  });

  test("정상 · 네트워크 끊김 · 거절 · 모양이 다른 본문 — 전부 상태 하나로 끝난다", async () => {
    const urls: string[] = [];
    const normal = await loadModelShareFolderEntries(MODEL_ID, (url) => {
      urls.push(url);
      return Promise.resolve(
        ok({ status: "listed", entries: [{ name: "a", isDirectory: true }], totalCount: 1 })
      );
    });
    assert.equal(normal.kind, "listed");
    assert.deepEqual(urls, [`/api/product-models/${MODEL_ID}/share-folder/entries`]);

    const broken = await loadModelShareFolderEntries(MODEL_ID, () => Promise.reject(new Error("끊김")));
    assert.equal(broken.kind, "failed");
    if (broken.kind !== "failed") throw new Error("unreachable");
    assert.match(broken.reason, /네트워크/);

    // 🔴 모델이 휴지통에 들어가 있으면 404 다 — 서버 문장을 그대로 보인다.
    const gone = await loadModelShareFolderEntries(MODEL_ID, () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "해당 제품 모델을 찾을 수 없습니다." }),
      })
    );
    assert.deepEqual(gone, { kind: "failed", reason: "해당 제품 모델을 찾을 수 없습니다." });

    const odd = await loadModelShareFolderEntries(MODEL_ID, () => Promise.resolve(ok({ status: "무언가" })));
    assert.equal(odd.kind, "failed");
  });

  test("알려진 칸만 옮긴다 — 이름 없는 줄은 그 줄만 버린다", () => {
    const state = readModelShareFolderEntriesAnswer({
      status: "listed",
      entries: [
        {
          name: "체크시트.xlsx",
          isDirectory: false,
          sizeBytes: 10,
          modifiedAt: "2026-10-07T01:00:00.000Z",
          전체경로: "\\\\NAS01",
        },
        { isDirectory: false, sizeBytes: 1 },
        { name: "MB", isDirectory: true, sizeBytes: 0 },
      ],
      totalCount: 3,
      truncated: false,
    });
    assert.equal(state?.kind, "listed");
    if (state?.kind !== "listed") throw new Error("unreachable");
    assert.deepEqual(
      state.entries.map((item) => item.name),
      ["체크시트.xlsx", "MB"]
    );
    assert.deepEqual(Object.keys(state.entries[0]).sort(), [
      "isDirectory",
      "modifiedAt",
      "name",
      "sizeBytes",
    ]);
  });

  test("🔴 줄 수 상한에 걸리면 「더 있습니다」가 선다", () => {
    const html = pickerMarkup(listed([entry("a.pdf"), entry("b.pdf")], { totalCount: 240, truncated: true }));
    assert.ok(html.includes("더 있습니다"), html);
    assert.ok(html.includes("240"), html);
  });

  test("기본 내보내기 — 효과가 돌기 전에는 「불러오는 중…」", () => {
    const html = renderToStaticMarkup(
      createElement(ModelShareFolderPicker, { productModelId: MODEL_ID })
    );
    assert.ok(html.includes(MODEL_SHARE_FOLDER_LOADING_TEXT), html);
    assert.ok(html.includes("print:hidden"), html);
    assert.ok(pickerSource.startsWith('"use client";'), "클라이언트 조각이 아니다");
    assert.ok(pickerSource.includes("useEffect("), "화면이 뜬 뒤에 부르지 않는다");
  });
});

describe("⑩ 화면과 page 를 묶는 쪽 — 사진·도면 쪽을 건드리지 않았다", () => {
  test("🔴 구역이 사진·도면 구역 **뒤**에 정확히 하나 선다", () => {
    assert.equal(screen.split("<ModelShareDocsSection").length - 1, 1, "구역이 둘 이상이다");
    assert.equal(screen.includes("</ModelShareDocsSection>"), false, "무언가를 감싸고 있다");
    const filesAt = screen.indexOf("<ProductModelFilesSection");
    const sectionAt = screen.indexOf("<ModelShareDocsSection");
    const historyAt = screen.indexOf("<ProductModelHistoryBreakdown");
    assert.ok(filesAt > 0 && sectionAt > filesAt, "구역이 사진·도면 구역보다 앞에 있다");
    assert.ok(historyAt > sectionAt, "구역이 A/S 이력 뒤로 밀렸다");
    assert.ok(
      flat(screen).includes(
        "<ModelShareDocsSection productModelId={detail.id} docs={shareDocs} canManageFiles={canManageFiles} onAdd={handleAddShareDoc} onRemove={handleRemoveShareDoc} />"
      ),
      "건네는 값이 다르다"
    );
  });

  test("🔴 사진·도면 쪽 장치가 그대로 있다", () => {
    for (const fragment of [
      "<ProductModelFilesSection",
      "attachments={attachments}",
      "trashedAttachments={trashedAttachments}",
      "<ProductModelEditForm",
      "<ProductModelHistoryBreakdown",
    ]) {
      assert.ok(screen.includes(fragment), `상세 화면에서 사라졌다: ${fragment}`);
    }
  });

  test("🔴 담기 · 지우기는 **이미 있는 서버 액션**을 쓴다 — 새로 만들지 않았다", () => {
    assert.ok(screen.includes('from "@/lib/server/actions/product-model-share-docs"'));
    assert.ok(
      screen.includes("addProductModelShareDocAction({ productModelId: detail.id, ...request })")
    );
    assert.ok(screen.includes("removeProductModelShareDocAction({ productModelId: detail.id, id })"));
    // 🔴 두 조각 자신은 서버 액션을 물지 않는다 — 그래야 그려 볼 수 있다.
    for (const source of [pickerSource, sectionSource]) {
      assert.equal(source.includes("@/lib/server/actions/"), false, "조각이 서버 액션을 직접 문다");
    }
  });

  test("🔴 담은 뒤 그 줄이 바로 보인다 — 서버가 다시 만든 목록을 받는다", () => {
    const add = screen.slice(
      screen.indexOf("async function handleAddShareDoc"),
      screen.indexOf("async function handleRemoveShareDoc")
    );
    assert.ok(add.length > 0, "담기 처리를 찾지 못했다");
    assert.ok(add.includes("router.refresh();"), "담은 뒤 다시 받지 않는다");
    // 🔴 화면이 목록을 제 손으로 늘리지 않는다 — 차례도 이름도 서버가 정한다.
    assert.equal(code(screen).includes("setShareDocs"), false, "화면이 목록을 제 손으로 고친다");
  });

  test("🔴 page 가 가리킴 목록을 **DB 에서** 함께 읽는다 — 공유폴더(디스크)는 안 읽는다", () => {
    assert.ok(modelPage.includes('from "@/lib/db/queries/product-model-share-docs"'));
    assert.ok(flat(modelPage).includes("listShareDocsForProductModel(detail.id),"));
    assert.ok(flat(modelPage).includes("shareDocs={shareDocs}"));
    // 🔴 **코드만** 본다 — 머리말이 「여기서 읽지 않는다」고 적으며 이름을 들기 때문이다.
    const body = code(modelPage);
    for (const forbidden of [
      "resolveRepairDocsArchiveRoot",
      "listRepairDocsEntries",
      "findRepairDocsEntry",
      "readdir",
      "REPAIR_DOCS_ARCHIVE_DIR",
      "ModelShareFolderPicker",
    ]) {
      assert.equal(body.includes(forbidden), false, `서버 컴포넌트가 공유폴더를 읽는다: ${forbidden}`);
    }
  });

  test("🔴 권한을 새로 만들거나 넓히지 않았다 — page 의 두 줄 그대로다", () => {
    for (const fragment of [
      'hasPermission(actingUser, "productModels.view", "READ")',
      'hasPermission(actingUser, "productModels.files", "WRITE")',
    ]) {
      assert.ok(modelPage.includes(fragment), `사라졌다: ${fragment}`);
    }
    // 🔴 화면이 제 손으로 판정하지 않는다 — page 가 이미 구한 값을 그대로 넘긴다.
    assert.equal(code(screen).includes("hasPermission("), false, "화면이 권한을 직접 판정한다");
  });

  test("🔴 본보기 두 벌을 고치지 않았다 — 종류별 구역은 제 이름 그대로다", () => {
    const kindSection = read("src/components/product-models/KindShareDocsSection.tsx");
    const kindPicker = read("src/components/product-models/KindShareFolderPicker.tsx");
    assert.ok(kindSection.includes("export default function KindShareDocsSection({"));
    assert.ok(kindSection.includes("kind: ProductModelKind;"));
    assert.ok(kindPicker.includes("export default function KindShareFolderPicker({"));
    assert.ok(kindPicker.includes("/api/product-model-kinds/"));
    // 🔴 모델 쪽 낱말이 그 두 파일에 흘러 들어가지 않았다.
    for (const source of [kindSection, kindPicker]) {
      assert.equal(source.includes("productModelId"), false, "본보기가 모델 쪽으로 번졌다");
      assert.equal(source.includes("ModelShareDocsSection"), false);
      assert.equal(source.includes("ModelShareFolderPicker"), false);
    }
  });
});
