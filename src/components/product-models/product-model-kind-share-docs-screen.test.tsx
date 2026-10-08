import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { QuoteFolderHelperStorage } from "@/components/quotes/quote-folder-open";
import {
  CONTACT_FOLDER_FILE_HELPER_DISMISS_TEXT,
  rememberContactFolderFileHelper,
  shouldOfferContactFolderFileHelperInstall,
} from "@/components/repair-cases/files/contact-folder-file-open";
import KindShareDocsSection, {
  KIND_SHARE_DOCS_EMPTY_TEXT,
  KIND_SHARE_DOCS_TITLE,
  KIND_SHARE_DOC_REMOVE_IRREVERSIBLE_TEXT,
  KIND_SHARE_DOC_REMOVE_KEEPS_FILE_TEXT,
  KindShareDocList,
  KindShareDocRemoveDialog,
  KindShareDocsHelperNotice,
  KindShareDocsHelperNoticeControl,
  canOpenKindShareDoc,
  kindShareDocDisplayName,
  kindShareDocFileName,
  kindShareDocParentPath,
  type KindShareDocRow,
} from "./KindShareDocsSection";
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
import KindShareFolderPicker, {
  KIND_SHARE_FOLDER_ADD_FILE_TEXT,
  KIND_SHARE_FOLDER_ADD_FOLDER_TEXT,
  KIND_SHARE_FOLDER_EMPTY_TEXT,
  KIND_SHARE_FOLDER_FAILED_TEXT,
  KIND_SHARE_FOLDER_FOLDER_LABEL,
  KIND_SHARE_FOLDER_LOADING_TEXT,
  KindShareFolderPickerView,
  canOpenKindShareFolderEntry,
  kindShareFolderEntriesUrl,
  kindShareFolderEntryMeta,
  kindShareFolderEntryPath,
  kindShareFolderTruncatedText,
  loadKindShareFolderEntries,
  readKindShareFolderEntriesAnswer,
  type KindShareFolderEntryView,
  type KindShareFolderPickerState,
} from "./KindShareFolderPicker";

/**
 * ============================================================================
 * 종류별 공통 서류 — **공유폴더를 가리켜 두는** 구역 (화면 쪽, 2026-10-07)
 * ============================================================================
 * 서버 쪽 규율은 이미 다른 시험들이 본다: 목록 통로는
 * app/api/product-model-kinds/*\/share-folder/entries/route-source.test.ts, 담기·지우기는
 * lib/server/actions/product-model-kind-share-docs-source.test.ts, 표와 감사는 db 목록의
 * 통합 시험. 여기서는 **화면이 무엇을 내는가**만 본다.
 *
 * ── 왜 이번에는 그려 보는가 ─────────────────────────────────────────────
 * 이웃 product-model-kind-files-screen.test.ts 는 **원본을 글자로** 읽는다 — 그 화면이
 * 서버 액션을 직접 import 해서, 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는
 * test:components 에서 import 자체가 던지기 때문이다. 🔴 **이번에 만든 두 조각은 일부러
 * 그렇게 만들지 않았다**: 서버 액션을 `onAdd` · `onRemove` 로 **받는다.** 그래서
 * ContactFolderSection.test.tsx 와 같은 방식으로 **상태를 직접 넣어 그려 본다** — 「단추가
 * 있는가 · 없는가」를 글자 매칭이 아니라 실제 결과로 본다. 화면을 묶는 쪽
 * (ProductModelKindFilesScreen · page.tsx)만 글자로 읽는다(그쪽은 여전히 서버 액션을 문다).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const screen = read("src/components/product-models/ProductModelKindFilesScreen.tsx");
const kindPage = read("src/app/(app)/product-models/kinds/[kind]/page.tsx");
const pickerSource = read("src/components/product-models/KindShareFolderPicker.tsx");
const sectionSource = read("src/components/product-models/KindShareDocsSection.tsx");

const KIND = "GENERATOR" as const;
const INSIDE = "2. 인수시 서류";

const entry = (
  name: string,
  isDirectory = false,
  extra: Partial<KindShareFolderEntryView> = {}
): KindShareFolderEntryView => ({ name, isDirectory, sizeBytes: 1, ...extra });

const listed = (
  entries: KindShareFolderEntryView[],
  overrides: Partial<Extract<KindShareFolderPickerState, { kind: "listed" }>> = {}
): KindShareFolderPickerState => ({
  kind: "listed",
  entries,
  totalCount: entries.length,
  truncated: false,
  ...overrides,
});

function pickerMarkup(
  state: KindShareFolderPickerState,
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
    createElement(KindShareFolderPickerView, {
      state,
      insidePath,
      filterQuery,
      ...(withNavigate ? { onNavigate: () => undefined } : {}),
      ...(withFilter ? { onFilterQueryChange: () => undefined } : {}),
      ...(withAdd ? { onAdd: () => undefined } : {}),
    })
  );
}

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

/** 그려진 거르기 칸에 **실제로 들어 있는 값**. 칸 자체가 없으면 null. */
function filterInputValue(html: string): string | null {
  const at = html.indexOf("<input");
  if (at < 0) return null;
  const tag = html.slice(at, html.indexOf(">", at) + 1);
  if (!tag.includes("data-share-folder-entry-filter-input")) return null;
  return /value="([^"]*)"/.exec(tag)?.[1] ?? "";
}

const doc = (overrides: Partial<KindShareDocRow> = {}): KindShareDocRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  entryKind: "FILE",
  relativePath: `${INSIDE}/MB 인수시 체크시트.xlsx`,
  label: null,
  ...overrides,
});

/** 도우미 안내 조각만 그려 본다 — 끄는 길은 받아서 쓰는 조각이라 넣어 준다. */
function helperMarkup(): string {
  return renderToStaticMarkup(
    createElement(KindShareDocsHelperNoticeControl, { onDismiss: () => undefined })
  );
}

/** Map 하나를 localStorage 처럼 보이게 한다 — 「표시가 있으면」을 값으로 잴 때 쓴다. */
function fakeStorage(store: Map<string, string>): QuoteFolderHelperStorage {
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

function sectionMarkup(docs: KindShareDocRow[], canManageFiles: boolean): string {
  return renderToStaticMarkup(
    createElement(KindShareDocsSection, {
      kind: KIND,
      docs,
      canManageFiles,
      onAdd: () => Promise.resolve({ ok: true as const }),
      onRemove: () => Promise.resolve({ ok: true as const }),
    })
  );
}

describe("① 🔴 disabled 면 고르는 창을 **아예 안 그린다**", () => {
  test("상태가 disabled 면 빈 글자다 — 설정이 없는 환경(개발 PC)에서 빈 상자가 늘지 않게", () => {
    assert.equal(pickerMarkup({ kind: "disabled" }), "");
    assert.deepEqual(readKindShareFolderEntriesAnswer({ status: "disabled" }), { kind: "disabled" });
  });

  test("가리킴 목록 구역은 그대로 선다 — 그쪽은 DB 라 공유폴더가 꺼져도 보인다", () => {
    const html = sectionMarkup([doc()], true);
    assert.ok(html.includes(KIND_SHARE_DOCS_TITLE), html);
    assert.ok(html.includes("data-kind-share-doc-row"), html);
  });

  test("다른 상태는 그려진다 — 불러오는 중 · 비었음 · 읽지 못함", () => {
    assert.ok(pickerMarkup({ kind: "loading" }).includes(KIND_SHARE_FOLDER_LOADING_TEXT));
    assert.ok(pickerMarkup(listed([])).includes(KIND_SHARE_FOLDER_EMPTY_TEXT));
    const failed = pickerMarkup({ kind: "failed", reason: "공유폴더에 연결할 수 없습니다" });
    assert.ok(failed.includes(KIND_SHARE_FOLDER_FAILED_TEXT), failed);
    assert.ok(failed.includes("공유폴더에 연결할 수 없습니다"), failed);
    assert.ok(failed.includes("text-amber-700"), failed);
  });
});

describe("② 🔴 폴더 줄에도 담기 단추가 있다 — 사용자가 「파일 뿐 아니라 폴더도」라고 했다", () => {
  test("폴더 줄 · 파일 줄 **둘 다** 담기 단추를 받는다", () => {
    const html = pickerMarkup(listed([entry("1. 수리 관련", true), entry("체크시트.xlsx")]));
    assert.equal(html.match(/data-kind-share-folder-add/g)?.length, 2, html);
    assert.ok(html.includes(`>${KIND_SHARE_FOLDER_ADD_FOLDER_TEXT}</button>`), html);
    assert.ok(html.includes(`>${KIND_SHARE_FOLDER_ADD_FILE_TEXT}</button>`), html);
  });

  test("🔴 확장자 없는 이름 · 허용 목록 밖 파일도 **담을 수는** 있다(폴더면) — 거절은 서버가 한다", () => {
    // 폴더는 확장자를 보지 않는다. 파일의 확장자 울타리는 서버 액션이 쥔다.
    const html = pickerMarkup(listed([entry("OLD", true)]));
    assert.ok(html.includes("data-kind-share-folder-add"), html);
  });

  test("담을 때 보내는 경로는 **지금 자리에 이름을 이은 것**이다", () => {
    assert.equal(kindShareFolderEntryPath("", "1. 수리 관련"), "1. 수리 관련");
    assert.equal(kindShareFolderEntryPath(INSIDE, "MB"), `${INSIDE}/MB`);
    assert.equal(kindShareFolderEntryPath("a//b/", "c"), "a/b/c");
  });

  test("폴더 줄은 눌러 **그 안으로** 들어간다 · 길 표시와 [위로]가 선다", () => {
    const html = pickerMarkup(listed([entry("MB", true), entry("체크시트.xlsx")]));
    assert.equal(html.match(/data-kind-share-folder-enter/g)?.length, 1, html);
    assert.ok(html.includes("data-kind-share-folder-trail"), html);
    assert.ok(html.includes("data-kind-share-folder-up"), html);
    // 🔴 링크가 아니다 — 눌러도 페이지를 떠나지 않는다(통로가 출처를 본다).
    assert.equal(html.includes("href="), false, html);
  });

  test("맨 위 칸에서는 [위로]가 없다 — 올라갈 곳이 없다", () => {
    const html = pickerMarkup(listed([entry("1. 수리 관련", true)]), { insidePath: "" });
    assert.equal(html.includes("data-kind-share-folder-up"), false, html);
    assert.ok(html.includes("data-kind-share-folder-trail"), html);
  });
});

describe("③ 🔴 [열기]는 열 수 있는 확장자의 **파일 줄**에만", () => {
  test("폴더 줄 · 확장자 없는 이름 · 허용 목록 밖에는 단추 자리가 없다", () => {
    for (const name of ["설치.exe", "실행.BAT", "문서", "보고서.pdf.", "보고서.pdf "]) {
      assert.equal(canOpenKindShareFolderEntry(entry(name), INSIDE), false, name);
    }
    for (const name of ["사진", "자료.zip"]) {
      assert.equal(canOpenKindShareFolderEntry(entry(name, true), INSIDE), false, name);
    }
    const html = pickerMarkup(
      listed([entry("사진", true), entry("설치.exe"), entry("문서"), entry("체크시트.xlsx")])
    );
    assert.equal(html.match(/data-kind-share-folder-entry-openable/g)?.length, 1, html);
    // 이름은 그대로 보인다 — 숨기는 것이 아니라 누를 단추만 없다.
    assert.ok(html.includes("설치.exe"), html);
  });

  test("허용 목록에 든 파일은 단추 자리를 갖는다", () => {
    for (const name of ["체크시트.xlsm", "보고서.pdf", "사진.JPG", "목록.csv", "도면.zip"]) {
      assert.ok(canOpenKindShareFolderEntry(entry(name), INSIDE), name);
    }
  });

  test("🔴 맨 위 칸에서는 **아무 줄에도** 단추를 두지 않는다 — 앞에 붙일 폴더가 없다", () => {
    assert.equal(canOpenKindShareFolderEntry(entry("체크시트.xlsx"), ""), false);
    const html = pickerMarkup(listed([entry("체크시트.xlsx")]), { insidePath: "" });
    assert.equal(html.includes("data-kind-share-folder-entry-openable"), false, html);
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

  test("가리킴 목록에서도 같은 규칙 — 폴더는 늘, 파일은 앞 폴더가 있고 열 수 있을 때만", () => {
    assert.equal(canOpenKindShareDoc(doc()), true);
    assert.equal(canOpenKindShareDoc(doc({ entryKind: "FOLDER", relativePath: "1. 수리 관련" })), true);
    // 🔴 맨 위 칸에 바로 놓인 **파일**은 앞에 붙일 폴더가 없어 주소를 만들 수 없다.
    assert.equal(canOpenKindShareDoc(doc({ relativePath: "체크시트.xlsx" })), false);
    assert.equal(canOpenKindShareDoc(doc({ relativePath: `${INSIDE}/설치.exe` })), false);
    assert.equal(kindShareDocParentPath(`${INSIDE}/MB/체크시트.xlsx`), `${INSIDE}/MB`);
    assert.equal(kindShareDocFileName(`${INSIDE}/MB/체크시트.xlsx`), "체크시트.xlsx");
    assert.equal(kindShareDocParentPath("체크시트.xlsx"), "");
  });
});

describe("④ 🔴 가리킴 목록에 내려받기·미리보기가 없다 — 바이트가 없다", () => {
  test("그려진 줄에 그 말이 하나도 없다", () => {
    const html = renderToStaticMarkup(
      createElement(KindShareDocList, {
        docs: [doc(), doc({ id: "22222222-2222-4222-8222-222222222222", entryKind: "FOLDER", relativePath: "1. 수리 관련" })],
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
        assert.equal(body.includes(forbidden), false, `${source === pickerSource ? "고르는 창" : "구역"}: ${forbidden}`);
      }
    }
    // 고르는 창이 부르는 통로는 목록 하나뿐이다.
    assert.equal(code(pickerSource).match(/\/share-folder\/entries/g)?.length, 1);
  });

  test("이름이 비면 **경로의 마지막 마디**를 쓴다 — 조회가 NULL 을 그대로 내보내는 까닭", () => {
    assert.equal(kindShareDocDisplayName(doc()), "MB 인수시 체크시트.xlsx");
    assert.equal(kindShareDocDisplayName(doc({ label: "  " })), "MB 인수시 체크시트.xlsx");
    assert.equal(kindShareDocDisplayName(doc({ label: "인수점검 양식" })), "인수점검 양식");
    // 경로는 숨기지 않는다 — 「어느 자리인가」가 이 줄의 전부다.
    const html = renderToStaticMarkup(createElement(KindShareDocList, { docs: [doc()] }));
    assert.ok(html.includes(`${INSIDE}/MB 인수시 체크시트.xlsx`), html);
  });

  test("한 줄도 없으면 빈 목록 안내가 선다", () => {
    const html = sectionMarkup([], true);
    assert.ok(html.includes(KIND_SHARE_DOCS_EMPTY_TEXT), html);
    assert.equal(html.includes("data-kind-share-doc-row"), false, html);
  });
});

describe("⑤ 🔴 지우기 확인 창이 **되돌릴 수 없다**고 말한다", () => {
  const dialog = (isOpen = true) =>
    renderToStaticMarkup(
      createElement(KindShareDocRemoveDialog, {
        isOpen,
        displayName: "MB 인수시 체크시트.xlsx",
        relativePath: `${INSIDE}/MB 인수시 체크시트.xlsx`,
        isSubmitting: false,
        submitError: null,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      })
    );

  test("되돌릴 수 없다는 말 · 실물은 남는다는 말 · 지울 경로가 함께 선다", () => {
    const html = dialog();
    assert.ok(html.includes(KIND_SHARE_DOC_REMOVE_IRREVERSIBLE_TEXT), html);
    assert.ok(html.includes("되돌릴 수 없습니다"), html);
    assert.ok(html.includes(KIND_SHARE_DOC_REMOVE_KEEPS_FILE_TEXT), html);
    assert.ok(html.includes(`${INSIDE}/MB 인수시 체크시트.xlsx`), html);
    assert.ok(html.includes("MB 인수시 체크시트.xlsx"), html);
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
    assert.ok(html.includes("data-kind-share-doc-remove-confirm"), html);
    assert.ok(sectionSource.includes("event.preventDefault();"), "ESC 를 가로채지 않는다");
    assert.ok(sectionSource.includes("dialog.showModal();"), "native dialog 가 아니다");
  });

  test("🔴 거절 사유는 서버 말을 그대로 — 창 안에 적는다", () => {
    const html = renderToStaticMarkup(
      createElement(KindShareDocRemoveDialog, {
        isOpen: true,
        displayName: "x",
        relativePath: "x",
        isSubmitting: false,
        submitError: "해당 가리킴을 찾을 수 없습니다.",
        onConfirm: () => undefined,
        onCancel: () => undefined,
      })
    );
    assert.ok(html.includes("해당 가리킴을 찾을 수 없습니다."), html);
    assert.ok(flat(sectionSource).includes("setRemoveError(result.message);"), "서버 문장을 그대로 쓰지 않는다");
    assert.ok(
      flat(pickerSource).includes(": { text: result.message, tone: \"warning\" }"),
      "담기 거절 문장을 그대로 쓰지 않는다"
    );
  });
});

describe("⑥ 🔴 canManageFiles 가 거짓이면 담기·지우기 단추가 없다", () => {
  test("고르는 창도 지우기 단추도 확인 창도 그려지지 않는다", () => {
    const html = sectionMarkup([doc()], false);
    assert.equal(html.includes("data-kind-share-folder-picker"), false, html);
    assert.equal(html.includes("data-kind-share-folder-add"), false, html);
    assert.equal(html.includes("data-kind-share-doc-remove"), false, html);
    assert.equal(html.includes("data-kind-share-doc-remove-dialog"), false, html);
    // 🔴 보는 것은 막지 않는다 — 가리킴 줄 자체는 그대로 보인다.
    assert.ok(html.includes("data-kind-share-doc-row"), html);
    assert.ok(html.includes("MB 인수시 체크시트.xlsx"), html);
  });

  test("참이면 셋 다 선다", () => {
    const html = sectionMarkup([doc()], true);
    assert.ok(html.includes("data-kind-share-folder-picker"), html);
    assert.ok(html.includes("data-kind-share-doc-remove"), html);
    assert.ok(html.includes("data-kind-share-doc-remove-dialog"), html);
  });

  test("🔴 길(onAdd · onRemove)을 주지 않으면 단추가 한 줄에도 생기지 않는다", () => {
    assert.equal(
      pickerMarkup(listed([entry("체크시트.xlsx"), entry("MB", true)]), { withAdd: false }).includes(
        "data-kind-share-folder-add"
      ),
      false
    );
    assert.equal(
      renderToStaticMarkup(createElement(KindShareDocList, { docs: [doc()] })).includes("data-kind-share-doc-remove"),
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
      assert.equal(/"productModelKinds?\./.test(code(source)), false);
    }
  });
});

describe("⑦ 🔴 인쇄에 안 찍힌다", () => {
  test("고르는 창은 그려지는 모든 상태에 print:hidden 이 있다", () => {
    assert.ok(pickerSource.includes("print:hidden"), "print:hidden 이 없다");
    const states: KindShareFolderPickerState[] = [
      { kind: "loading" },
      { kind: "failed", reason: "까닭" },
      listed([]),
      listed([entry("체크시트.xlsx"), entry("MB", true)]),
    ];
    for (const state of states) {
      assert.ok(pickerMarkup(state).includes("print:hidden"), state.kind);
    }
  });

  test("가리킴 줄의 조작 단추와 도우미 안내도 종이에 남지 않는다", () => {
    const html = renderToStaticMarkup(
      createElement(KindShareDocList, { docs: [doc()], onRemove: () => undefined })
    );
    assert.ok(html.includes("print:hidden"), html);
    assert.ok(helperMarkup().includes("print:hidden"), helperMarkup());
  });
});

/*
 * ============================================================================
 * ⑧ 도우미 안내 — **모르는 PC 에만** (2026-10-07 사용자 요구)
 * ============================================================================
 * 「파일 열기가 되는 도우미가 이미 깔린 PC 에서는 안내를 안 그린다. 사람이 끌 수도 있다.」
 * 예전에는 이 구역이 **조건 없이 늘** 안내를 그렸고, 아래 단언도 「선다」만 재고 있었다.
 * 지우지 않고 **둘 다 재는 모양**으로 바꾼다 — 표시가 없으면 서고, 있으면 안 선다.
 *
 * 🔴 표시는 `localStorage` 라 **마운트 뒤에** 읽는다. 여기(renderToStaticMarkup)에는 효과가
 * 돌지 않으므로 「그려진 것」으로는 끝까지 잴 수 없다 — 그래서 **판정 자체를 값으로** 재고
 * (shouldOfferContactFolderFileHelperInstall), 그려지는 몫은 안내 조각을 직접 그려서 잰다.
 * ============================================================================
 */
describe("⑧ 도우미 안내 — 표시가 없으면 서고, 있으면 줄도 단추도 없다", () => {
  test("[설치 명령 복사] · 「열리지 않으면 다시 설치」 · [그만 보기]가 함께 선다", () => {
    const html = helperMarkup();
    assert.ok(html.includes("설치 명령 복사"), html);
    assert.ok(html.includes("다시 설치해 주세요"), html);
    assert.ok(html.includes("data-kind-share-docs-helper-install-command"), html);
    // 🔴 사람이 직접 끌 수 있는 길 — 감지가 틀릴 수도 있다.
    assert.ok(html.includes("data-kind-share-docs-helper-dismiss"), html);
    assert.ok(html.includes(CONTACT_FOLDER_FILE_HELPER_DISMISS_TEXT), html);
  });

  test("🔴 복사 구현도 문장도 새로 만들지 않는다 — 공용 모듈과 상수를 그대로 쓴다", () => {
    assert.ok(sectionSource.includes("runQuoteFolderHelperInstallCommandCopy"));
    assert.ok(sectionSource.includes("CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT"));
    // 끄기 글자도 판정도 연락서 쪽 한 자리에서 가져온다 — 말이 갈라지지 않게.
    assert.ok(sectionSource.includes("CONTACT_FOLDER_FILE_HELPER_DISMISS_TEXT"));
    assert.ok(sectionSource.includes("shouldOfferContactFolderFileHelperInstall"));
    for (const forbidden of ["execCommand", "navigator.clipboard.writeText", "console."]) {
      assert.equal(sectionSource.includes(forbidden), false, forbidden);
    }
    // 🔴 열쇠 이름을 베껴 적지 않았다 — 세대 번호가 바뀌면 한 자리만 고치면 된다.
    assert.equal(code(sectionSource).includes("dss.helper"), false, "열쇠를 직접 적는다");
    assert.equal(code(sectionSource).includes("localStorage"), false, "저장소를 직접 만진다");
  });

  test("🔴 Windows 가 아니면(서버 렌더) 안내가 아예 안 그려진다 — 도우미는 Windows 것이다", () => {
    assert.equal(renderToStaticMarkup(createElement(KindShareDocsHelperNotice, {})), "");
    assert.ok(sectionSource.includes("const hiddenOnServer = () => false;"));
    assert.ok(
      sectionSource.includes("useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer)")
    );
  });

  test("🔴 표시가 없으면 「그린다」, 있으면 「안 그린다」 — 판정을 값으로 잰다", () => {
    const store = new Map<string, string>();
    const storage = () => fakeStorage(store);
    assert.equal(shouldOfferContactFolderFileHelperInstall(storage), true);
    rememberContactFolderFileHelper(storage);
    assert.equal(shouldOfferContactFolderFileHelperInstall(storage), false);
  });

  test("🔴 [그만 보기]를 누르면 표시를 적고 그 자리에서 감춘다", () => {
    // 그려 보는 것으로는 「눌렀다」를 잴 수 없다(효과도 이벤트도 없다) — 누르는 자리가
    // 무엇을 하는지는 원본 한 줄로 못 박는다. 적힌 뒤의 결과는 위 시험이 값으로 잰다.
    const body = flat(code(sectionSource));
    assert.ok(body.includes("onDismiss={() => { rememberContactFolderFileHelper(); setDismissed(true); }}"), body);
    assert.ok(body.includes("const [dismissed, setDismissed] = useState(false);"), body);
    // 안내 조각은 스스로 끄지 않는다 — 받은 길을 부를 뿐이다(그려 볼 수 있게).
    assert.ok(sectionSource.includes("onDismiss }: { onDismiss: () => void }"), sectionSource);
  });

  test("🔴 표시는 **마운트 뒤에** 읽는다 — 서버 렌더에 없는 값이라 hydration 이 어긋난다", () => {
    const body = flat(code(sectionSource));
    // 🔴 Windows 판단과 **같은 방법**이다 — 서버용 스냅샷은 「안 그림」(hiddenOnServer).
    assert.ok(body.includes("const shouldOfferHelperInstallNow = () => shouldOfferContactFolderFileHelperInstall();"), body);
    assert.ok(
      body.includes(
        "useSyncExternalStore(subscribeToNothing, shouldOfferHelperInstallNow, hiddenOnServer)"
      ),
      body
    );
    assert.ok(body.includes("if (!isWindows || !offerInstall || dismissed) return null;"), body);
    // 🔴 렌더 중에 저장소를 직접 읽지 않는다 — 읽는 자리는 위 스냅샷 하나뿐이다.
    assert.equal(
      body.split("shouldOfferContactFolderFileHelperInstall()").length - 1,
      1,
      "표시를 읽는 자리가 둘 이상이다"
    );
  });

  test("가리킴이 하나도 없으면 안내도 세우지 않는다 — 열 것이 없다", () => {
    assert.ok(flat(sectionSource).includes("{docs.length > 0 && <KindShareDocsHelperNotice />}"));
  });
});

describe("⑨ 통로 부르기 — 던지지 않는다 · fetch 로만 부른다", () => {
  const ok = (payload: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(payload) });

  test("주소 — 맨 위는 ?path 가 붙지 않고, 자리가 있을 때만 붙는다", () => {
    assert.equal(
      kindShareFolderEntriesUrl(KIND),
      "/api/product-model-kinds/GENERATOR/share-folder/entries"
    );
    assert.equal(
      kindShareFolderEntriesUrl(KIND, "2. 인수시 서류/MB"),
      "/api/product-model-kinds/GENERATOR/share-folder/entries?path=2.%20%EC%9D%B8%EC%88%98%EC%8B%9C%20%EC%84%9C%EB%A5%98%2FMB"
    );
    // 🔴 수상한 값도 그대로 싣지 않는다 — 감싸서 보내고 거절은 서버가 한다.
    assert.ok(kindShareFolderEntriesUrl(KIND, "../비밀").includes("..%2F"));
  });

  test("🔴 `<a href>` 나 새 탭이 아니라 fetch 다 — 그 통로는 출처를 본다", () => {
    const body = code(pickerSource);
    assert.ok(body.includes("fetchImpl(kindShareFolderEntriesUrl("));
    assert.equal(/href=\{/.test(body), false, "링크로 연다");
    assert.equal(body.includes('target="_blank"'), false, "새 탭으로 연다");
  });

  test("정상 · 네트워크 끊김 · 거절 · 모양이 다른 본문 — 전부 상태 하나로 끝난다", async () => {
    const urls: string[] = [];
    const normal = await loadKindShareFolderEntries(KIND, (url) => {
      urls.push(url);
      return Promise.resolve(ok({ status: "listed", entries: [{ name: "a", isDirectory: true }], totalCount: 1 }));
    });
    assert.equal(normal.kind, "listed");
    assert.deepEqual(urls, ["/api/product-model-kinds/GENERATOR/share-folder/entries"]);

    const broken = await loadKindShareFolderEntries(KIND, () => Promise.reject(new Error("끊김")));
    assert.equal(broken.kind, "failed");
    if (broken.kind !== "failed") throw new Error("unreachable");
    assert.match(broken.reason, /네트워크/);

    const forbidden = await loadKindShareFolderEntries(KIND, () =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "요청 출처를 확인할 수 없습니다." }) })
    );
    assert.deepEqual(forbidden, { kind: "failed", reason: "요청 출처를 확인할 수 없습니다." });

    const odd = await loadKindShareFolderEntries(KIND, () => Promise.resolve(ok({ status: "무언가" })));
    assert.equal(odd.kind, "failed");
  });

  test("알려진 칸만 옮긴다 — 이름 없는 줄은 그 줄만 버린다", () => {
    const state = readKindShareFolderEntriesAnswer({
      status: "listed",
      entries: [
        { name: "체크시트.xlsx", isDirectory: false, sizeBytes: 10, modifiedAt: "2026-10-07T01:00:00.000Z", 전체경로: "\\\\NAS01" },
        { isDirectory: false, sizeBytes: 1 },
        { name: "MB", isDirectory: true, sizeBytes: 0 },
      ],
      totalCount: 3,
      truncated: false,
    });
    assert.equal(state?.kind, "listed");
    if (state?.kind !== "listed") throw new Error("unreachable");
    assert.deepEqual(state.entries.map((item) => item.name), ["체크시트.xlsx", "MB"]);
    assert.deepEqual(Object.keys(state.entries[0]).sort(), ["isDirectory", "modifiedAt", "name", "sizeBytes"]);
  });

  test("🔴 줄 수 상한에 걸리면 「더 있습니다」가 선다", () => {
    const html = pickerMarkup(listed([entry("a.pdf"), entry("b.pdf")], { totalCount: 240, truncated: true }));
    assert.ok(html.includes("더 있습니다"), html);
    assert.ok(html.includes("240"), html);
  });

  test("기본 내보내기 — 효과가 돌기 전에는 「불러오는 중…」", () => {
    const html = renderToStaticMarkup(createElement(KindShareFolderPicker, { kind: KIND }));
    assert.ok(html.includes(KIND_SHARE_FOLDER_LOADING_TEXT), html);
    assert.ok(html.includes("print:hidden"), html);
    assert.ok(pickerSource.startsWith('"use client";'), "클라이언트 조각이 아니다");
    assert.ok(pickerSource.includes("useEffect("), "화면이 뜬 뒤에 부르지 않는다");
  });
});

describe("⑩ 화면과 입구를 묶는 쪽 — 올린 파일 쪽을 건드리지 않았다", () => {
  test("🔴 구역이 올린 파일 **구역 밖**에 정확히 하나 선다", () => {
    assert.equal(screen.split("<KindShareDocsSection").length - 1, 1, "구역이 둘 이상이다");
    assert.equal(screen.includes("</KindShareDocsSection>"), false, "무언가를 감싸고 있다");
    // 🔴 올린 파일 구역(`<section>`)이 **닫힌 뒤**에 선다 — 그 안에 들어가면 섞인 목록이 된다.
    const closeAt = screen.lastIndexOf("</section>");
    const sectionAt = screen.indexOf("<KindShareDocsSection");
    assert.ok(closeAt > 0 && sectionAt > closeAt, "구역이 올린 파일 구역 안에 들어갔다");
    assert.ok(screen.indexOf("<RestoreAttachmentDialog") < closeAt, "올린 파일 쪽 창이 구역 밖으로 나갔다");
    const flatScreen = flat(screen);
    assert.ok(
      flatScreen.includes(
        "<KindShareDocsSection kind={kind} docs={shareDocs} canManageFiles={canManageFiles} onAdd={handleAddShareDoc} onRemove={handleRemoveShareDoc} />"
      ),
      "건네는 값이 다르다"
    );
  });

  test("🔴 올린 파일 쪽 장치가 그대로 있다 — 올리기 · 내려받기 · 미리보기 · 휴지통", () => {
    for (const fragment of [
      "FileDropZone",
      "handleUpload",
      "softDeleteAttachmentAction",
      "restoreAttachmentAction",
      "AttachmentViewer",
      "휴지통 {trashedAttachments.length}건",
      "내려받기",
      "미리보기",
    ]) {
      assert.ok(screen.includes(fragment), `올린 파일 쪽에서 사라졌다: ${fragment}`);
    }
  });

  test("🔴 담기 · 지우기는 **이미 있는 서버 액션**을 쓴다 — 새로 만들지 않았다", () => {
    assert.ok(screen.includes('from "@/lib/server/actions/product-model-kind-share-docs"'));
    assert.ok(screen.includes("addProductModelKindShareDocAction({ kind, ...request })"));
    assert.ok(screen.includes("removeProductModelKindShareDocAction({ kind, id })"));
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
    assert.ok(kindPage.includes('from "@/lib/db/queries/product-model-kind-share-docs"'));
    assert.ok(flat(kindPage).includes("listShareDocsForProductModelKind(kind),"));
    assert.ok(flat(kindPage).includes("shareDocs={shareDocs}"));
    // 🔴 **코드만** 본다 — 머리말이 「여기서 읽지 않는다」고 적으며 이름을 들기 때문이다.
    const body = code(kindPage);
    for (const forbidden of [
      "resolveRepairDocsArchiveRoot",
      "listRepairDocsEntries",
      "findRepairDocsEntry",
      "readdir",
      "REPAIR_DOCS_ARCHIVE_DIR",
      "KindShareFolderPicker",
    ]) {
      assert.equal(body.includes(forbidden), false, `서버 컴포넌트가 공유폴더를 읽는다: ${forbidden}`);
    }
  });

  test("🔴 권한을 새로 만들거나 넓히지 않았다 — page 의 네 줄 그대로다", () => {
    for (const fragment of [
      'requireAreaAccessForCurrentUser("productModels")',
      'hasPermission(actingUser, "productModels.view", "READ")',
      'hasPermission(actingUser, "productModels.files", "WRITE")',
    ]) {
      assert.ok(kindPage.includes(fragment), `사라졌다: ${fragment}`);
    }
    assert.equal(code(kindPage).includes("shareDoc") && code(kindPage).includes("hasPermission(actingUser, \"productModels.files\", \"READ\")"), false);
  });
});

/*
 * ============================================================================
 * ⑪ 이름으로 거르기 — 「[공유폴더에서 고르기]창을 가진 모든 곳에 동일하게」 (2026-10-08)
 * ============================================================================
 * 🔴 **지금 보고 있는 칸만** 거른다(사용자 결정) — 하위 폴더 안까지 뒤지지 않는다.
 * 그래서 서버도 통로도 상한 셋도 건드리지 않았다: 이미 받아 둔 줄을 화면에서 걸러 낸다.
 * 거르는 규칙 자체는 unit 목록의 share-folder-entry-filter.test.ts 가 본다 —
 * 여기서는 **이 창이 그것을 어떻게 쓰는가**를 상태를 넣어 그려 보고 결과로 잰다.
 * ============================================================================
 */
describe("⑪ 🔴 이름으로 거르기 — 두 창이 같은 조각을 쓴다", () => {
  const rows = [
    entry("2. 인수시 서류", true),
    entry("MB 인수시 체크시트.xlsx"),
    entry("1. 수리 관련", true),
    entry("회로도.pdf"),
  ];
  const shownEntries = (html: string) => html.match(/data-kind-share-folder-entry=""/g)?.length ?? 0;

  test("거르기 칸은 **길 표시 아래 · 목록 위**에 선다", () => {
    const html = pickerMarkup(listed(rows));
    const trailAt = html.indexOf("data-kind-share-folder-trail");
    const filterAt = html.indexOf("data-share-folder-entry-filter");
    const firstEntryAt = html.indexOf('data-kind-share-folder-entry=""');
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
    assert.equal(html.match(/data-kind-share-folder-enter/g)?.length, 1, html);
    assert.equal(html.match(/data-kind-share-folder-add/g)?.length, 2, html);
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
    assert.equal(html.includes(KIND_SHARE_FOLDER_EMPTY_TEXT), false, html);
    // 칸은 그대로 서 있다 — 지우거나 고칠 길이 사라지면 갇힌다.
    assert.equal(filterInputValue(html), "없는이름", html);
  });

  test("🔴 **잘린 목록을 거를 때도** 「더 있습니다」가 계속 보인다 — 없애지 않고 말만 바꾼다", () => {
    const truncated = listed(rows, { totalCount: 240, truncated: true });

    const plain = pickerMarkup(truncated);
    assert.ok(plain.includes(kindShareFolderTruncatedText(rows.length, 240)), plain);

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
    // 친 글자는 그대로 그려진다.
    assert.equal(filterInputValue(pickerMarkup(listed(rows), { filterQuery: "인수" })), "인수");
    // 🔴 자리를 옮기는 길은 이 함수 하나뿐이고, 그 결과의 칸은 늘 비어 있다.
    const moved = shareFolderEntryPlaceAt(`${INSIDE}/MB`);
    assert.equal(moved.filterQuery, "");
    assert.equal(
      filterInputValue(pickerMarkup(listed(rows), { insidePath: moved.insidePath, filterQuery: moved.filterQuery })),
      ""
    );
    // 옮긴 자리에서는 지난 글자가 아무것도 안 가린다 — 네 줄이 다 보인다.
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
    const otherPicker = read("src/components/product-models/ModelShareFolderPicker.tsx");
    for (const [label, body] of [
      ["종류별", pickerSource],
      ["제품 상세", otherPicker],
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
    const html = pickerMarkup(listed([entry("MB 체크시트.xlsx", false, { sizeBytes: 2048, modifiedAt: META_ISO })]));
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), ["2.0 KB"]);
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [META_LOCAL_TIME]);
    assert.equal(html.includes(`2.0 KB · ${META_LOCAL_TIME}`), false, html);
  });

  test("🔴 열 차례가 **이름 → 수정날짜 → 크기 → 동작**이다(윈도우 탐색기와 같게)", () => {
    const html = pickerMarkup(listed([entry("MB 체크시트.xlsx", false, { sizeBytes: 2048, modifiedAt: META_ISO })]));
    const nameAt = html.indexOf("MB 체크시트.xlsx");
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
      entry("MB 체크시트.xlsx", false, { sizeBytes: 2048, modifiedAt: META_ISO }),
    ]);
    const withAdd = pickerMarkup(rows);
    const withoutAdd = pickerMarkup(rows, { withAdd: false });
    assert.ok(withAdd.includes(KIND_SHARE_FOLDER_ADD_FILE_TEXT), withAdd);
    assert.equal(withoutAdd.includes(KIND_SHARE_FOLDER_ADD_FILE_TEXT), false, withoutAdd);
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
        entry("MB 체크시트.xlsx", false, { sizeBytes: 2048, modifiedAt: META_ISO }),
      ])
    );
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), ["폴더", "512 B", "2.0 KB"]);
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [META_LOCAL_TIME, "", META_LOCAL_TIME]);
  });

  test("🔴 폴더 줄의 크기 자리는 **이 창의 제 글자**다 — 낱말을 공용으로 모으지 않았다", () => {
    const html = pickerMarkup(listed([entry("2. 인수시 서류", true, { sizeBytes: 0 })]));
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), [KIND_SHARE_FOLDER_FOLDER_LABEL]);
    assert.equal(kindShareFolderEntryMeta(entry("2. 인수시 서류", true)).sizeText, "폴더");
  });

  test("🔴 좁은 화면 배치가 남아 있다 — 표는 sm 이상에서만 선다", () => {
    const row = liClasses(pickerMarkup(listed([entry("MB 체크시트.xlsx")])))[0] ?? "";
    assert.ok(row.includes("flex flex-wrap"), row);
    assert.ok(row.includes("sm:grid"), row);
    assert.equal(/(^|\s)grid(\s|$)/.test(row), false, row);
  });

  test("🔴 네 창이 같은 조각을 쓴다 — 이 창도 공용 생김새를 그대로 쓴다", () => {
    const html = pickerMarkup(listed([entry("MB 체크시트.xlsx")]));
    assert.ok(html.includes(`class="${SHARE_FOLDER_ENTRY_ACTIONS_CLASS}"`), html);
    assert.ok(pickerSource.includes('from "@/lib/domain/share-folder-entry-meta"'), "공용 조각을 안 쓴다");
    assert.equal(code(pickerSource).includes("toLocaleString"), false, "날짜를 제 손으로 꾸민다");
    assert.equal(code(pickerSource).includes("grid-cols-"), false, "열 길이를 제 손으로 적는다");
  });

  test("🔴 날짜 글자 모양이 **안 바뀌었다** · 못 읽는 값은 **원본 그대로**", () => {
    const good = pickerMarkup(listed([entry("MB 체크시트.xlsx", false, { modifiedAt: META_ISO })]));
    assert.deepEqual(metaCells(good, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [
      new Date(META_ISO).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }),
    ]);
    assert.equal(good.includes(META_ISO), false, good);

    const bad = pickerMarkup(listed([entry("MB 체크시트.xlsx", false, { modifiedAt: "날짜아님" })]));
    assert.deepEqual(metaCells(bad, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), ["날짜아님"]);
  });

  test("🔴 거르고 난 뒤에도 표가 그대로 선다 — 남은 줄만 센다", () => {
    const html = pickerMarkup(
      listed([
        entry("2. 인수시 서류", true, { sizeBytes: 0, modifiedAt: META_ISO }),
        entry("MB 체크시트.xlsx", false, { sizeBytes: 2048 }),
      ]),
      { filterQuery: "체크" }
    );
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_SIZE_CLASS), ["2.0 KB"]);
    assert.deepEqual(metaCells(html, SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS), [""]);
    assert.equal(cellCount(html, SHARE_FOLDER_ENTRY_ACTIONS_CLASS), 1, html);
  });
});
