import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  canOpenKindShareDoc,
  kindShareDocDisplayName,
  type KindShareDocRow,
} from "@/components/product-models/KindShareDocsSection";
import CaseKindShareDocsSection, {
  CASE_KIND_SHARE_DOCS_MANAGE_HINT,
  caseKindShareDocsSectionTitle,
} from "./CaseKindShareDocsSection";

/**
 * ============================================================================
 * 수리 건 상세 **파일 관리 탭**의 「이 종류 공통 서류(공유폴더 가리킴)」 (2026-10-07)
 * ============================================================================
 * 「수리건 상세에서도 **바로 파일을 열 수 있도록** 할꺼야」(사용자 요구 2026-10-07).
 * 담기 · 지우기 · 통로 · 표의 규율은 이미 다른 시험들이 본다(제품 모델 쪽
 * product-model-kind-share-docs-screen.test.tsx · actions · 통합 시험). 여기서는 **이 탭이
 * 무엇을 내는가**와 **묶는 쪽이 종류를 어떻게 얻는가**만 본다.
 *
 * 못 박는 것:
 *  · 🔴 한 줄도 없으면 **구역이 아예 안 그려진다**(빈 상자를 세우지 않는다)
 *  · 🔴 **담기 · 지우기가 여기엔 없다** — 보고 여는 자리다(고치는 곳은 제품 모델 관리)
 *  · 🔴 [열기]는 **열 수 있는 확장자의 파일 줄**에만 · 폴더 줄은 폴더 열기 단추 ·
 *       공유폴더 **맨 위 칸에 바로 놓인 파일**에는 없다(앞에 붙일 폴더가 없다)
 *  · 🔴 **그 판정을 베껴 적지 않았다** — 줄을 그리는 조각을 그대로 가져다 쓴다
 *  · 🔴 `print:hidden` — 바로 위 공유폴더 구역과 같은 선
 *  · 🔴 **종류를 지어내지 않는다** — productModelKindOfWorkflowKind 를 부른다
 *  · 🔴 서버는 **DB 한 번**만 더 때린다(공유폴더 디스크를 읽지 않는다)
 *
 * 🔴 묶는 쪽(FilesScreen · files/page.tsx)은 **원본을 글자로 읽는다** — 둘 다 서버 액션 ·
 * `server-only` 사슬을 물고 있어 test:components 에서 그려 볼 수 없다. 구역 자체는 그런 것을
 * 물지 않으므로 **상태를 직접 넣어 그려 본다**(이웃 ContactFolderSection.test.tsx 와 같은 방식).
 * ============================================================================
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function read(...pieces: string[]): string {
  return readFileSync(path.join(here, ...pieces), "utf8").replace(/\r\n/g, "\n");
}

/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const flat = (source: string) => source.replace(/\s+/g, " ");

const sectionSource = read("CaseKindShareDocsSection.tsx");
const filesScreen = read("FilesScreen.tsx");
const filesPage = read("..", "..", "..", "app", "(app)", "repair-cases", "[id]", "files", "page.tsx");
const sharedListSource = read("..", "..", "product-models", "KindShareDocsSection.tsx");

const INSIDE = "2. 인수시 서류";
const KIND = "GENERATOR" as const;

const doc = (overrides: Partial<KindShareDocRow> = {}): KindShareDocRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  entryKind: "FILE",
  relativePath: `${INSIDE}/MB 인수시 체크시트.xlsx`,
  label: null,
  ...overrides,
});

const folderDoc = doc({
  id: "22222222-2222-4222-8222-222222222222",
  entryKind: "FOLDER",
  relativePath: "1. 수리 관련/MB",
  label: "MB 수리 자료",
});

function markup(docs: KindShareDocRow[]): string {
  return renderToStaticMarkup(createElement(CaseKindShareDocsSection, { kind: KIND, docs }));
}

describe("① 🔴 한 줄도 없으면 구역을 **아예 그리지 않는다**", () => {
  test("빈 목록이면 빈 글자다 — 「없습니다」 상자를 세우지 않는다", () => {
    assert.equal(markup([]), "");
  });

  test("한 줄이라도 있으면 머리와 줄이 선다", () => {
    const html = markup([doc()]);
    assert.ok(html.includes(caseKindShareDocsSectionTitle(KIND, 1)), html);
    assert.ok(html.includes("data-case-kind-share-docs-section"), html);
    assert.ok(html.includes("data-kind-share-doc-row"), html);
    // 경로를 숨기지 않는다 — 「어느 자리인가」가 이 줄의 전부다.
    assert.ok(html.includes(`${INSIDE}/MB 인수시 체크시트.xlsx`), html);
  });

  test("머리에 종류 이름과 줄 수가 함께 적힌다 — 이름표를 지어내지 않는다", () => {
    assert.equal(caseKindShareDocsSectionTitle("GENERATOR", 2), "Generator 공통 서류 (2건)");
    assert.equal(caseKindShareDocsSectionTitle("TOTAL_CONTROLLER", 1), "Total Controller (T/C) 공통 서류 (1건)");
    assert.ok(sectionSource.includes("PRODUCT_MODEL_KIND_LABELS"), "이름표를 직접 적는다");
    for (const forbidden of ['"Generator"', '"Matcher"', '"제너레이터"', '"매쳐"']) {
      assert.equal(code(sectionSource).includes(forbidden), false, `이름표를 베꼈다: ${forbidden}`);
    }
  });

  test("🔴 빈 판정은 구역 **안**에 있다 — 부르는 쪽이 조건을 또 적지 않는다", () => {
    assert.ok(flat(sectionSource).includes("if (docs.length === 0) return null;"), sectionSource);
    assert.equal(flat(filesScreen).includes("kindShareDocs.length > 0 &&"), false, "탭이 조건을 또 적는다");
  });
});

describe("② 🔴 [열기]는 열 수 있는 확장자의 파일 줄에만 · 폴더 줄은 폴더 열기 단추", () => {
  test("판정은 **이미 있는 순수 함수**다 — 이 조각이 다시 적지 않았다", () => {
    assert.equal(canOpenKindShareDoc(doc()), true);
    assert.equal(canOpenKindShareDoc(folderDoc), true);
    assert.equal(canOpenKindShareDoc(doc({ relativePath: `${INSIDE}/설치.exe` })), false);
    assert.equal(canOpenKindShareDoc(doc({ relativePath: `${INSIDE}/문서` })), false);
    // 🔴 확장자 목록도 경로 규칙도 이 파일에 한 글자도 없다.
    const body = code(sectionSource);
    for (const forbidden of ["xlsm", "\\.exe", 'endsWith\\("\\.', "lastIndexOf", "split\\(\"/\"\\)"]) {
      assert.equal(new RegExp(forbidden).test(body), false, `규칙을 베껴 적었다: ${forbidden}`);
    }
    assert.equal(body.includes("dss-folder://"), false, "도우미 주소를 직접 짓는다");
  });

  test("🔴 여는 단추 둘을 **그대로 가져다 쓴다** — 줄을 그리는 조각째로 쓴다", () => {
    assert.ok(
      sectionSource.includes('from "@/components/product-models/KindShareDocsSection"'),
      "줄 그리는 조각을 베꼈다"
    );
    assert.ok(sectionSource.includes("KindShareDocList"), "목록 조각을 쓰지 않는다");
    // 그 조각 안에서 폴더 줄 · 파일 줄이 각각 어떤 단추를 받는지 — 여기서 갈라지면 안 된다.
    assert.ok(flat(sharedListSource).includes("<ContactFolderPlaceOpenButton relativePath={doc.relativePath} />"));
    assert.ok(flat(sharedListSource).includes("<ContactFolderEntryOpenButton folderName={kindShareDocParentPath("));
    // 🔴 이 조각은 여는 단추를 **직접 import 하지 않는다** — 그러면 두 벌이 된다.
    assert.equal(code(sectionSource).includes("ContactFolderEntryOpenButton"), false);
    assert.equal(code(sectionSource).includes("ContactFolderPlaceOpenButton"), false);
  });

  test("🔴 도우미는 Windows 것이다 — 서버 렌더에는 단추가 한 개도 안 찍힌다", () => {
    const html = markup([doc(), folderDoc]);
    assert.equal(html.includes("data-contact-folder-entry-open"), false, html);
    assert.equal(html.includes("data-contact-folder-place-open"), false, html);
    // 줄 자체는 그대로 보인다 — 이름도 경로도 숨기지 않는다.
    assert.equal(html.match(/data-kind-share-doc-row/g)?.length, 2, html);
    assert.ok(html.includes(kindShareDocDisplayName(folderDoc)), html);
  });
});

describe("③ 🔴 공유폴더 맨 위 칸에 바로 놓인 파일에는 [열기]가 없다", () => {
  test("앞에 붙일 폴더가 없으면 주소를 만들 수 없다 — 앞 조각과 **같은 규칙**이다", () => {
    assert.equal(canOpenKindShareDoc(doc({ relativePath: "체크시트.xlsx" })), false);
    // 폴더는 깊이를 가리지 않는다 — 맨 위 칸의 폴더도 열린다.
    assert.equal(canOpenKindShareDoc(doc({ entryKind: "FOLDER", relativePath: "1. 수리 관련" })), true);
  });

  test("그 줄도 목록에서 빠지지 않는다 — 경로는 보인다", () => {
    const html = markup([doc({ relativePath: "체크시트.xlsx" })]);
    assert.ok(html.includes("체크시트.xlsx"), html);
    assert.ok(html.includes("data-kind-share-doc-row"), html);
  });
});

describe("④ 🔴 담기 · 지우기 단추가 여기엔 없다 — 보고 여는 자리다", () => {
  test("그려진 것에 담기 · 지우기 · 확인 창이 하나도 없다", () => {
    const html = markup([doc(), folderDoc]);
    for (const forbidden of [
      "data-kind-share-doc-remove",
      "data-kind-share-doc-remove-dialog",
      "data-kind-share-folder-add",
      "data-kind-share-folder-picker",
      "data-kind-share-folder-enter",
    ]) {
      assert.equal(html.includes(forbidden), false, `${forbidden} 가 있다`);
    }
    assert.equal(html.includes("지우기"), false, html);
  });

  test("🔴 원본에도 길이 없다 — 서버 액션도 고르는 창도 물지 않는다", () => {
    const body = code(sectionSource);
    for (const forbidden of [
      "onRemove",
      "onAdd",
      "KindShareFolderPicker",
      "@/lib/server/actions/",
      '"server-only"',
      "/api/",
      'method: "POST"',
      'method: "DELETE"',
      "router.refresh",
      "useState",
    ]) {
      assert.equal(body.includes(forbidden), false, `구역이 고치는 길을 들고 있다: ${forbidden}`);
    }
  });

  test("🔴 내려받기 · 미리보기 단추도 없다 — 가리킴에는 바이트가 없다", () => {
    const html = markup([doc(), folderDoc]);
    // 곁말이 **없다는 사실을 말한다** — 그 문장 밖에서는 그 낱말이 단추로 서지 않는다.
    assert.ok(html.includes("내려받기·미리보기가 없습니다"), html);
    for (const forbidden of [">내려받기<", ">미리보기<", ">휴지통<", "되살리기", "href=", "/api/attachments"]) {
      assert.equal(html.includes(forbidden), false, `${forbidden} 가 있다`);
    }
  });

  test("고치는 자리를 글로 알려 준다", () => {
    const html = markup([doc()]);
    assert.ok(html.includes(CASE_KIND_SHARE_DOCS_MANAGE_HINT), html);
    assert.ok(CASE_KIND_SHARE_DOCS_MANAGE_HINT.includes("제품 모델 관리"), CASE_KIND_SHARE_DOCS_MANAGE_HINT);
  });
});

describe("⑤ 🔴 인쇄에 안 찍힌다", () => {
  test("바깥 틀에 print:hidden 이 걸려 있다 — 바로 위 공유폴더 구역과 같은 선", () => {
    const html = markup([doc(), folderDoc]);
    const openingTag = html.slice(0, html.indexOf(">"));
    assert.ok(openingTag.includes("print:hidden"), openingTag);
  });
});

describe("⑥ 🔴 종류를 어떻게 얻는가 — 규칙을 베껴 적지 않고 있는 함수를 부른다", () => {
  test("워크플로 종류 → 제품 종류 를 옮기는 함수를 **그대로** 부른다", () => {
    assert.ok(
      filesScreen.includes("productModelKindOfWorkflowKind(workflowKindOf(resolved.workflowType))"),
      "탭이 종류를 제 손으로 짓는다"
    );
    assert.ok(filesPage.includes("productModelKindOfWorkflowKind(workflowKindOf(resolved.workflowType))"));
    assert.ok(filesPage.includes('from "@/lib/domain/product-model-kind"'));
    // 🔴 짝지음 표를 베껴 적은 자리가 없다.
    for (const source of [code(filesScreen), code(filesPage), code(sectionSource)]) {
      assert.equal(/"GENERATOR"/.test(source), false, "종류 코드를 직접 적는다");
      assert.equal(/"TOTAL_CONTROLLER"/.test(source), false, "종류 코드를 직접 적는다");
      assert.equal(source.includes("product_model_kind"), false, "수리 건에 없는 칸을 읽는다");
    }
  });

  test("🔴 서버가 **DB 에서** 읽어 내려 준다 — 공유폴더(디스크)는 안 읽는다", () => {
    assert.ok(filesPage.includes('from "@/lib/db/queries/product-model-kind-share-docs"'));
    assert.ok(flat(filesPage).includes("listShareDocsForProductModelKind(productModelKind),"));
    assert.ok(filesPage.includes("kindShareDocs={kindShareDocs}"), "목록을 안 내려 준다");
    // 🔴 **코드만** 본다 — 머리말이 「여기서 읽지 않는다」고 적으며 이름을 들기 때문이다.
    const body = code(filesPage);
    for (const forbidden of [
      "readdir",
      "listContactFolderEntries",
      "listRepairDocsEntries",
      "REPAIR_DOCS_ARCHIVE_DIR",
      "CONTACT_FOLDER_ARCHIVE_DIR",
    ]) {
      assert.equal(body.includes(forbidden), false, `서버 컴포넌트가 공유폴더를 읽는다: ${forbidden}`);
    }
    // 새 권한을 만들지 않았다 — 이 탭이 쓰던 판정 그대로다.
    assert.ok(filesPage.includes('hasPermission(actingUser, "repairCases.files", "WRITE")'));
    assert.equal(/"productModels\./.test(body), false, "다른 메뉴의 권한을 끌어왔다");
  });
});

describe("⑦ 구역이 서는 자리 — 첨부 목록 쪽은 한 글자도 안 바뀌었다", () => {
  test("🔴 공유폴더 구역 **바로 뒤**에 하나 선다 — 첨부 목록을 감싸지 않는다", () => {
    assert.equal(filesScreen.split("<CaseKindShareDocsSection").length - 1, 1, "구역이 둘 이상이다");
    assert.equal(filesScreen.includes("</CaseKindShareDocsSection>"), false, "무언가를 감싸고 있다");
    const contactAt = filesScreen.indexOf("<ContactFolderSection repairCaseId=");
    const sectionAt = filesScreen.indexOf("<CaseKindShareDocsSection");
    assert.ok(contactAt > 0 && sectionAt > contactAt, "공유폴더 구역보다 앞에 섰다");
    assert.ok(
      flat(filesScreen).includes("docs={kindShareDocs}"),
      "줄들을 안 건넨다"
    );
  });

  test("🔴 올린 파일 쪽 장치가 그대로 있다 — 올리기 · 내려받기 · [DATA에 저장] · 휴지통", () => {
    for (const fragment of [
      "FileDropZone",
      "handleUpload",
      "softDeleteAttachmentAction",
      "restoreAttachmentAction",
      "contactFolderEnabled={contactFolderEnabled}",
      "onSavedToContactFolder={() => setContactFolderReloadToken((token) => token + 1)}",
      "휴지통 <span",
    ]) {
      assert.ok(filesScreen.includes(fragment), `올린 파일 쪽에서 사라졌다: ${fragment}`);
    }
    // 🔴 서버가 하던 두 조회도 그대로다.
    assert.ok(filesPage.includes("listAttachmentsForRepairCase(resolved.id)"));
    assert.ok(filesPage.includes("listTrashedAttachmentsForRepairCase(resolved.id)"));
  });

  test("🔴 데모 화면은 이 구역을 받지 않는다 — DB 건에서만 선다", () => {
    assert.ok(flat(filesScreen).includes("<DemoFilesScreen resolved={props.resolved} actingUser={props.actingUser} />"));
    assert.ok(flat(filesScreen).includes("kindShareDocs={props.kindShareDocs ?? []}"));
  });
});
