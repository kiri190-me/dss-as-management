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
import {
  SHARE_FOLDER_ENTRY_FILTER_EMPTY_TEXT,
  SHARE_FOLDER_ENTRY_FILTER_LABEL,
  shareFolderEntryFilteredTruncatedText,
} from "@/components/common/ShareFolderEntryFilterInput";
import { shareFolderEntryPlaceAt } from "@/lib/domain/share-folder-entry-filter";
import {
  SHARE_FOLDER_ENTRY_ACTIONS_CLASS,
  SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS,
  SHARE_FOLDER_ENTRY_META_SIZE_CLASS,
} from "@/lib/domain/share-folder-entry-meta";
import ModelShareFolderPicker, {
  MODEL_SHARE_FOLDER_ADD_FILE_TEXT,
  MODEL_SHARE_FOLDER_ADD_FOLDER_TEXT,
  MODEL_SHARE_FOLDER_EMPTY_TEXT,
  MODEL_SHARE_FOLDER_FAILED_TEXT,
  MODEL_SHARE_FOLDER_FOLDER_LABEL,
  MODEL_SHARE_FOLDER_LOADING_TEXT,
  ModelShareFolderPickerView,
  canOpenModelShareFolderEntry,
  loadModelShareFolderEntries,
  modelShareFolderEntriesUrl,
  modelShareFolderEntryMeta,
  modelShareFolderEntryPath,
  modelShareFolderTruncatedText,
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
 * 🔴 본보기 두 벌(KindShareDocsSection · KindShareFolderPicker)은 **제 주인 그대로**다 —
 * 아래 ⑩의 마지막 시험이 그것을 지킨다. 이쪽이 그쪽에서 **가져다 쓰는** 것은 도우미
 * 안내 하나뿐이고, 그것도 ⑧에서 「베끼지 않았는가」로 못 박는다.
 * 🔴 다만 2026-10-08 「이름으로 거르기」만은 사용자가 「[공유폴더에서 고르기]창을 가진
 * 모든 곳에 동일하게」를 요구해 **두 창을 함께** 고쳤다 — 공용 조각 둘을 뽑아 둘이
 * 가져다 쓴다(⑪). Picker 자체는 합치지 않았다.
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

/** 수정시각 한 자리 — 꾸민 글자는 돌리는 PC 의 시간대를 따르므로 **같은 식으로 계산해** 견준다. */
const META_ISO = "2026-09-08T02:00:00.000Z";
const META_LOCAL_TIME = new Date(META_ISO).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

/**
 * 🔴 그려진 결과에서 **그 칸에 실제로 들어 있는 글자**를 줄 차례대로 뽑는다. 글자 매칭이
 * 아니라 「칸이 섰는가 · 그 안이 비었는가」를 재려고 칸을 열쇠로 쓴다 — 빈 칸은 `""` 로
 * 잡힌다(칸이 아예 없으면 배열 길이가 줄어 바로 드러난다).
 */
function metaCells(html: string, className: string): string[] {
  const pattern = new RegExp(`<span class="${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">([^<]*)</span>`, "g");
  return [...html.matchAll(pattern)].map((match) => match[1] ?? "");
}

/** 그려진 줄들의 **틀**(li 의 class). 줄마다 다르면 열이 어긋난다. */
function liClasses(html: string): string[] {
  return [...html.matchAll(/<li[^>]*\sclass="([^"]*)"/g)].map((match) => match[1] ?? "");
}

/** 그 칸이 **몇 번** 그려졌는가 — 비어 있어도 센다(동작 칸이 줄마다 서는지 본다). */
function cellCount(html: string, className: string): number {
  return html.split(`class="${className}"`).length - 1;
}

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
    filterQuery = "",
    withAdd = true,
    withNavigate = true,
    withFilter = true,
  }: {
    insidePath?: string;
    filterQuery?: string;
    withAdd?: boolean;
    withNavigate?: boolean;
    withFilter?: boolean;
  } = {}
): string {
  return renderToStaticMarkup(
    createElement(ModelShareFolderPickerView, {
      state,
      insidePath,
      filterQuery,
      ...(withNavigate ? { onNavigate: () => undefined } : {}),
      ...(withFilter ? { onFilterQueryChange: () => undefined } : {}),
      ...(withAdd ? { onAdd: () => undefined } : {}),
    })
  );
}

/** 그려진 거르기 칸에 **실제로 들어 있는 값**. 칸 자체가 없으면 null. */
function filterInputValue(html: string): string | null {
  const at = html.indexOf("<input");
  if (at < 0) return null;
  const tag = html.slice(at, html.indexOf(">", at) + 1);
  if (!tag.includes("data-share-folder-entry-filter-input")) return null;
  return /value="([^"]*)"/.exec(tag)?.[1] ?? "";
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

  // 🔴 2026-10-08 「이름으로 거르기」로 종류별 창도 함께 고쳤지만(⑪), **주인은 그대로**다 —
  // 모델 쪽 낱말이 저 두 파일로 번지지 않았는가를 여기서 계속 지킨다.
  test("🔴 본보기 두 벌이 제 주인 그대로다 — 모델 쪽 낱말이 번지지 않았다", () => {
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

/*
 * ============================================================================
 * ⑪ 이름으로 거르기 — 「[공유폴더에서 고르기]창을 가진 모든 곳에 동일하게」 (2026-10-08)
 * ============================================================================
 * 🔴 이번 요구는 **두 창 모두**다. 그래서 이 조각만은 종류별 창도 함께 고쳤다 —
 * 지금까지의 「본보기를 건드리지 마라」와 다른 점이고, 사용자가 그렇게 지시했다.
 * 거르는 **함수**와 **입력 칸**을 공용으로 뽑아 둘이 가져다 쓴다(Picker 자체는 합치지
 * 않는다 — 통로도 권한도 주인도 다르다).
 *
 * 🔴 **지금 보고 있는 칸만** 거른다 — 하위 폴더 안까지 뒤지지 않는다. 그래서 서버도
 * 통로도 상한 셋도 건드리지 않았다. 거르는 규칙 자체는 unit 목록의
 * share-folder-entry-filter.test.ts 가 보고, 여기서는 **이 창이 그것을 어떻게 쓰는가**를
 * 상태를 넣어 그려 보고 결과로 잰다.
 * ============================================================================
 */
describe("⑪ 🔴 이름으로 거르기 — 두 창이 같은 조각을 쓴다", () => {
  const rows = [
    entry("2. 인수시 서류", true),
    entry("MB 인수시 체크시트.xlsx"),
    entry("1. 수리 관련", true),
    entry("회로도.pdf"),
  ];
  const shownEntries = (html: string) => html.match(/data-model-share-folder-entry=""/g)?.length ?? 0;

  test("거르기 칸은 **길 표시 아래 · 목록 위**에 선다", () => {
    const html = pickerMarkup(listed(rows));
    const trailAt = html.indexOf("data-model-share-folder-trail");
    const filterAt = html.indexOf("data-share-folder-entry-filter");
    const firstEntryAt = html.indexOf('data-model-share-folder-entry=""');
    assert.ok(trailAt >= 0, html);
    assert.ok(filterAt > trailAt, "거르기 칸이 길 표시보다 위에 있다");
    assert.ok(firstEntryAt > filterAt, "거르기 칸이 목록보다 아래에 있다");
    assert.ok(html.includes(SHARE_FOLDER_ENTRY_FILTER_LABEL), html);
  });

  test("🔴 폴더와 파일이 **둘 다** 걸린다 — 거른 결과만 그려진다", () => {
    const html = pickerMarkup(listed(rows), { filterQuery: "인수" });
    assert.equal(shownEntries(html), 2, html);
    assert.ok(html.includes("2. 인수시 서류"), "폴더가 안 걸렸다");
    assert.ok(html.includes("MB 인수시 체크시트.xlsx"), "파일이 안 걸렸다");
    assert.equal(html.includes("1. 수리 관련"), false, "안 걸려야 할 폴더가 남았다");
    assert.equal(html.includes("회로도.pdf"), false, "안 걸려야 할 파일이 남았다");
    // 걸린 폴더 줄은 여전히 눌러 들어갈 수 있고, 두 줄 다 담을 수 있다.
    assert.equal(html.match(/data-model-share-folder-enter/g)?.length, 1, html);
    assert.equal(html.match(/data-model-share-folder-add/g)?.length, 2, html);
  });

  test("대소문자가 달라도 · 연속 공백이 달라도 걸린다", () => {
    for (const query of ["mb", "MB", "mB"]) {
      const html = pickerMarkup(listed(rows), { filterQuery: query });
      assert.equal(shownEntries(html), 1, `${query}: ${html}`);
      assert.ok(html.includes("MB 인수시 체크시트.xlsx"), query);
    }
    const spaced = pickerMarkup(listed([entry("2.  인수시   서류", true), entry("회로도.pdf")]), {
      filterQuery: "  인수시 서류 ",
    });
    assert.equal(shownEntries(spaced), 1, spaced);
  });

  test("🔴 거른 결과가 0건이면 **말이 나온다** — 목록을 그냥 비워 두지 않는다", () => {
    const html = pickerMarkup(listed(rows), { filterQuery: "없는이름" });
    assert.equal(shownEntries(html), 0, html);
    assert.ok(html.includes(SHARE_FOLDER_ENTRY_FILTER_EMPTY_TEXT), html);
    // 🔴 「이 폴더가 비어 있습니다」와 다른 말이다 — 폴더가 빈 것이 아니다.
    assert.equal(html.includes(MODEL_SHARE_FOLDER_EMPTY_TEXT), false, html);
    // 칸은 그대로 서 있다 — 지우거나 고칠 길이 사라지면 갇힌다.
    assert.equal(filterInputValue(html), "없는이름", html);
  });

  test("🔴 **잘린 목록을 거를 때도** 「더 있습니다」가 계속 보인다 — 없애지 않고 말만 바꾼다", () => {
    const truncated = listed(rows, { totalCount: 240, truncated: true });

    const plain = pickerMarkup(truncated);
    assert.ok(plain.includes(modelShareFolderTruncatedText(rows.length, 240)), plain);

    const filtered = pickerMarkup(truncated, { filterQuery: "인수" });
    assert.ok(filtered.includes("더 있습니다"), filtered);
    assert.ok(filtered.includes("240"), filtered);
    assert.ok(filtered.includes(shareFolderEntryFilteredTruncatedText(rows.length, 240)), filtered);
    // 🔴 세는 N 은 **받아 둔 줄 수**다 — 거른 뒤의 2 가 아니다.
    assert.ok(filtered.includes(`앞의 ${rows.length}개`), filtered);

    // 🔴 한 줄도 안 걸려도 경고는 그대로다 — 「없네」로 잘못 결론 내지 않게.
    const none = pickerMarkup(truncated, { filterQuery: "없는이름" });
    assert.ok(none.includes("더 있습니다"), none);
    assert.ok(none.includes(SHARE_FOLDER_ENTRY_FILTER_EMPTY_TEXT), none);

    // 잘리지 않았으면 전처럼 아무 경고도 없다.
    assert.equal(pickerMarkup(listed(rows), { filterQuery: "인수" }).includes("더 있습니다"), false);
  });

  test("🔴 폴더로 들어가거나 [위로] 하면 칸이 **비워진다** — 값으로 재고 그려 본다", () => {
    assert.equal(filterInputValue(pickerMarkup(listed(rows), { filterQuery: "인수" })), "인수");
    // 🔴 자리를 옮기는 길은 이 함수 하나뿐이고, 그 결과의 칸은 늘 비어 있다.
    const moved = shareFolderEntryPlaceAt(`${INSIDE}/MB`);
    assert.equal(moved.filterQuery, "");
    assert.equal(
      filterInputValue(pickerMarkup(listed(rows), { insidePath: moved.insidePath, filterQuery: moved.filterQuery })),
      ""
    );
    assert.equal(shownEntries(pickerMarkup(listed(rows), { filterQuery: moved.filterQuery })), rows.length);

    // 🔴 들어가기 · [위로] · 길 표시가 **모두** 그 한 길(onNavigate)을 지난다.
    const body = flat(code(pickerSource));
    assert.ok(body.includes("setPlace(shareFolderEntryPlaceAt(next));"), body);
    assert.equal(body.includes("setInsidePath("), false, "자리를 거르기 칸과 따로 바꾼다");
    assert.ok(body.includes("onEnter: (name: string) => onNavigate("), body);
    assert.ok(body.includes("onClick={() => onNavigate(contactFolderParentPath(insidePath))}"), body);
  });

  test("🔴 길(onFilterQueryChange)을 주지 않으면 칸이 아예 안 그려진다", () => {
    const html = pickerMarkup(listed(rows), { withFilter: false });
    assert.equal(html.includes("data-share-folder-entry-filter"), false, html);
    assert.equal(filterInputValue(html), null, html);
    // 빈 폴더에도 거를 것이 없어 칸을 두지 않는다.
    assert.equal(pickerMarkup(listed([])).includes("data-share-folder-entry-filter"), false);
  });

  test("🔴 **두 창이 같은 조각을 쓴다** — 한쪽에만 있지 않다", () => {
    const otherPicker = read("src/components/product-models/KindShareFolderPicker.tsx");
    for (const [label, body] of [
      ["제품 상세", pickerSource],
      ["종류별", otherPicker],
    ] as const) {
      assert.ok(
        body.includes('from "@/components/common/ShareFolderEntryFilterInput"'),
        `${label}: 공용 거르기 칸을 가져오지 않는다`
      );
      assert.ok(
        body.includes('from "@/lib/domain/share-folder-entry-filter"'),
        `${label}: 공용 거르기 함수를 가져오지 않는다`
      );
      assert.ok(body.includes("<ShareFolderEntryFilterInput"), `${label}: 공용 칸을 안 그린다`);
      assert.ok(body.includes("filterShareFolderEntriesByQuery("), `${label}: 제 손으로 거른다`);
      assert.ok(body.includes("shareFolderEntryPlaceAt("), `${label}: 자리를 제 손으로 옮긴다`);
      assert.ok(
        body.includes("shareFolderEntryFilteredTruncatedText("),
        `${label}: 거를 때의 곁말을 제 손으로 짓는다`
      );
      assert.ok(
        body.includes("SHARE_FOLDER_ENTRY_FILTER_EMPTY_TEXT"),
        `${label}: 0건 안내를 제 손으로 짓는다`
      );
      // 🔴 견주기를 베껴 적지 않았다 — 다듬기는 domain 한 자리뿐이다.
      for (const forbidden of [
        "normalizeShareFolderNameForCompare",
        "toLocaleUpperCase",
        "toLowerCase()",
        'normalize("NFC")',
      ]) {
        assert.equal(code(body).includes(forbidden), false, `${label}: 견주기를 베꼈다 — ${forbidden}`);
      }
    }
  });

  test("🔴 거르기가 서버를 다시 부르지 않는다 — 상한 셋에 손대지 않았다", () => {
    const body = code(pickerSource);
    // 통로를 부르는 자리는 전과 같이 하나뿐이다.
    assert.equal(body.match(/\/share-folder\/entries/g)?.length, 1, body);
    assert.equal(body.includes("filterQuery"), true);
    // 🔴 친 글자가 주소에 실리지 않는다 — 서버는 거르기를 모른다.
    assert.equal(/fetchImpl\([^)]*filterQuery/.test(flat(body)), false, "거르는 글자를 서버로 보낸다");
    for (const forbidden of ["REPAIR_DOCS_ENTRIES_LIMIT", "@/lib/storage/", "repair-docs-entries"]) {
      assert.equal(body.includes(forbidden), false, `상한에 손을 댄다: ${forbidden}`);
    }
  });
});

/*
 * ============================================================================
 * ⑫ 🔴 줄은 **표**다 — [이름] [수정날짜] [크기] [동작] (2026-10-08)
 * ============================================================================
 * 「공유폴더 창에서 수정 날짜가 … **별도의 열**로」 → 화면을 보고 다시 「**표 중앙에
 * 수정날짜 열을 따로** 만들어줘」(사용자 요구 2026-10-08).
 * 🔴 1fr 은 이름 하나뿐이고 수정날짜·크기·동작은 고정 길이라 **줄에 단추가 있든 없든
 * 세 칸의 자리가 같다**(예전에는 단추가 있는 줄만 왼쪽으로 밀렸다).
 * 🔴 **공유폴더를 보여 주는 네 창이 같은 한 벌을 쓴다**
 * (lib/domain/share-folder-entry-meta.ts) — 그 한 벌의 규칙과 「넷이 다 쓰는가」는 unit
 * 목록의 share-folder-entry-meta.test.ts 가 본다. 여기서는 **이 창이 실제로 그렇게
 * 그리는가**를 상태를 넣어 그려 보고 잰다.
 * ============================================================================
 */
describe("⑫ 🔴 표 네 칸 — 이름 · 수정날짜 · 크기 · 동작", () => {
  test("수정날짜와 크기가 **따로** 나온다 — 한 글자로 이어 붙지 않는다", () => {
    const html = pickerMarkup(listed([entry("회로도.pdf", false, { sizeBytes: 2048, modifiedAt: META_ISO })]));
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), ["2.0 KB"]);
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [META_LOCAL_TIME]);
    assert.equal(html.includes(`2.0 KB · ${META_LOCAL_TIME}`), false, html);
  });

  test("🔴 열 차례가 **이름 → 수정날짜 → 크기 → 동작**이다(윈도우 탐색기와 같게)", () => {
    const html = pickerMarkup(listed([entry("회로도.pdf", false, { sizeBytes: 2048, modifiedAt: META_ISO })]));
    const nameAt = html.indexOf("회로도.pdf");
    const modifiedAt = html.indexOf(`class="${SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS}"`);
    const sizeAt = html.indexOf(`class="${SHARE_FOLDER_ENTRY_META_SIZE_CLASS}"`);
    const actionsAt = html.indexOf(`class="${SHARE_FOLDER_ENTRY_ACTIONS_CLASS}"`);
    assert.ok(nameAt > 0 && modifiedAt > 0 && sizeAt > 0 && actionsAt > 0, html);
    assert.ok(nameAt < modifiedAt, "이름이 수정날짜보다 뒤에 있다");
    assert.ok(modifiedAt < sizeAt, "수정날짜가 크기보다 뒤에 있다");
    assert.ok(sizeAt < actionsAt, "크기가 동작보다 뒤에 있다");
  });

  /**
   * 🔴 **이번 요구의 알맹이.** 이 창은 담을 수 있는 사람에게만 [담기]가 보인다 — 그래서
   * **단추가 있는 줄과 하나도 없는 줄을 실제로 그려** 견줄 수 있다. 둘의 줄 틀과 칸이
   * 같으면 날짜·크기의 자리도 같다(1fr 이 이름 하나뿐이므로).
   */
  test("🔴 단추가 있을 때와 없을 때가 **같은 표 틀**이다 — 동작 칸은 비어도 남는다", () => {
    const rows = listed([
      entry("2. 인수시 서류", true, { sizeBytes: 0, modifiedAt: META_ISO }),
      entry("회로도.pdf", false, { sizeBytes: 2048, modifiedAt: META_ISO }),
    ]);
    const withAdd = pickerMarkup(rows);
    const withoutAdd = pickerMarkup(rows, { withAdd: false });
    assert.ok(withAdd.includes(MODEL_SHARE_FOLDER_ADD_FILE_TEXT), withAdd);
    assert.equal(withoutAdd.includes(MODEL_SHARE_FOLDER_ADD_FILE_TEXT), false, withoutAdd);
    for (const html of [withAdd, withoutAdd]) {
      const lines = liClasses(html);
      assert.equal(lines.length, 2, html);
      assert.equal(new Set(lines).size, 1, lines.join(" | "));
      assert.ok(lines[0]?.includes("sm:grid-cols-[minmax(0,1fr)_10rem_5rem_9rem]"), lines[0]);
      assert.equal(cellCount(html, SHARE_FOLDER_ENTRY_ACTIONS_CLASS), 2, html);
      assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), ["폴더", "2.0 KB"]);
      assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [META_LOCAL_TIME, META_LOCAL_TIME]);
    }
  });

  test("🔴 수정날짜가 없는 줄도 **칸은 남고 글자만 빈다**", () => {
    const html = pickerMarkup(
      listed([
        entry("2. 인수시 서류", true, { sizeBytes: 0, modifiedAt: META_ISO }),
        entry("시각없음.pdf", false, { sizeBytes: 512 }),
        entry("회로도.pdf", false, { sizeBytes: 2048, modifiedAt: META_ISO }),
      ])
    );
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), ["폴더", "512 B", "2.0 KB"]);
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [META_LOCAL_TIME, "", META_LOCAL_TIME]);
  });

  test("🔴 폴더 줄의 크기 자리는 **이 창의 제 글자**다 — 낱말을 공용으로 모으지 않았다", () => {
    const html = pickerMarkup(listed([entry("2. 인수시 서류", true, { sizeBytes: 0 })]));
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), [MODEL_SHARE_FOLDER_FOLDER_LABEL]);
    assert.equal(modelShareFolderEntryMeta(entry("2. 인수시 서류", true)).sizeText, "폴더");
  });

  test("🔴 좁은 화면 배치가 남아 있다 — 표는 sm 이상에서만 선다", () => {
    const row = liClasses(pickerMarkup(listed([entry("회로도.pdf")])))[0] ?? "";
    assert.ok(row.includes("flex flex-wrap"), row);
    assert.ok(row.includes("sm:grid"), row);
    assert.equal(/(^|\s)grid(\s|$)/.test(row), false, row);
  });

  test("🔴 네 창이 같은 조각을 쓴다 — 이 창도 공용 생김새를 그대로 쓴다", () => {
    const html = pickerMarkup(listed([entry("회로도.pdf")]));
    assert.ok(html.includes(`class="${SHARE_FOLDER_ENTRY_ACTIONS_CLASS}"`), html);
    assert.ok(pickerSource.includes('from "@/lib/domain/share-folder-entry-meta"'), "공용 조각을 안 쓴다");
    assert.equal(code(pickerSource).includes("toLocaleString"), false, "날짜를 제 손으로 꾸민다");
    assert.equal(code(pickerSource).includes("grid-cols-"), false, "열 길이를 제 손으로 적는다");
  });

  test("🔴 날짜 글자 모양이 **안 바뀌었다** · 못 읽는 값은 **원본 그대로**", () => {
    const good = pickerMarkup(listed([entry("회로도.pdf", false, { modifiedAt: META_ISO })]));
    assert.deepEqual(metaCells(good, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [
      new Date(META_ISO).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }),
    ]);
    assert.equal(good.includes(META_ISO), false, good);

    const bad = pickerMarkup(listed([entry("회로도.pdf", false, { modifiedAt: "날짜아님" })]));
    assert.deepEqual(metaCells(bad, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), ["날짜아님"]);
  });

  test("🔴 거르고 난 뒤에도 표가 그대로 선다 — 남은 줄만 센다", () => {
    const html = pickerMarkup(
      listed([
        entry("2. 인수시 서류", true, { sizeBytes: 0, modifiedAt: META_ISO }),
        entry("회로도.pdf", false, { sizeBytes: 2048 }),
      ]),
      { filterQuery: "회로" }
    );
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), ["2.0 KB"]);
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [""]);
    assert.equal(cellCount(html, SHARE_FOLDER_ENTRY_ACTIONS_CLASS), 1, html);
  });
});
