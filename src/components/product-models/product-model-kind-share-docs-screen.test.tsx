import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
import KindShareFolderPicker, {
  KIND_SHARE_FOLDER_ADD_FILE_TEXT,
  KIND_SHARE_FOLDER_ADD_FOLDER_TEXT,
  KIND_SHARE_FOLDER_EMPTY_TEXT,
  KIND_SHARE_FOLDER_FAILED_TEXT,
  KIND_SHARE_FOLDER_LOADING_TEXT,
  KindShareFolderPickerView,
  canOpenKindShareFolderEntry,
  kindShareFolderEntriesUrl,
  kindShareFolderEntryPath,
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
    withAdd = true,
    withNavigate = true,
  }: { insidePath?: string; withAdd?: boolean; withNavigate?: boolean } = {}
): string {
  return renderToStaticMarkup(
    createElement(KindShareFolderPickerView, {
      state,
      insidePath,
      ...(withNavigate ? { onNavigate: () => undefined } : {}),
      ...(withAdd ? { onAdd: () => undefined } : {}),
    })
  );
}

const doc = (overrides: Partial<KindShareDocRow> = {}): KindShareDocRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  entryKind: "FILE",
  relativePath: `${INSIDE}/MB 인수시 체크시트.xlsx`,
  label: null,
  ...overrides,
});

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
    const helper = renderToStaticMarkup(createElement(KindShareDocsHelperNoticeControl, {}));
    assert.ok(helper.includes("print:hidden"), helper);
  });
});

describe("⑧ 도우미 안내 — 예전 도우미는 새 루트도 파일 열기도 모른다", () => {
  test("[설치 명령 복사]와 「열리지 않으면 다시 설치」가 함께 선다", () => {
    const html = renderToStaticMarkup(createElement(KindShareDocsHelperNoticeControl, {}));
    assert.ok(html.includes("설치 명령 복사"), html);
    assert.ok(html.includes("다시 설치해 주세요"), html);
    assert.ok(html.includes("data-kind-share-docs-helper-install-command"), html);
  });

  test("🔴 복사 구현도 문장도 새로 만들지 않는다 — 공용 모듈과 상수를 그대로 쓴다", () => {
    assert.ok(sectionSource.includes("runQuoteFolderHelperInstallCommandCopy"));
    assert.ok(sectionSource.includes("CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT"));
    for (const forbidden of ["execCommand", "navigator.clipboard.writeText", "console."]) {
      assert.equal(sectionSource.includes(forbidden), false, forbidden);
    }
  });

  test("🔴 Windows 가 아니면(서버 렌더) 안내가 아예 안 그려진다 — 도우미는 Windows 것이다", () => {
    assert.equal(renderToStaticMarkup(createElement(KindShareDocsHelperNotice, {})), "");
    assert.ok(sectionSource.includes("const hiddenOnServer = () => false;"));
    assert.ok(
      sectionSource.includes("useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer)")
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
