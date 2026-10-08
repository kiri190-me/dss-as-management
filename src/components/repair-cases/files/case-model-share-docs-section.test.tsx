import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ModelShareDocList,
  canOpenModelShareDoc,
  modelShareDocDisplayName,
  type ModelShareDocRow,
} from "@/components/product-models/ModelShareDocsSection";
import CaseKindShareDocsSection, { caseKindShareDocsSectionTitle } from "./CaseKindShareDocsSection";
import CaseModelShareDocsSection, {
  CASE_MODEL_SHARE_DOCS_MANAGE_HINT,
  caseModelShareDocsSectionTitle,
} from "./CaseModelShareDocsSection";

/**
 * ============================================================================
 * 수리 건 상세 **파일 관리 탭**의 「이 제품 모델 전용 서류(공유폴더 가리킴)」 (2026-10-08)
 * ============================================================================
 * 「제품 상세에도 … **해당 제품으로 등록된 수리건 상세에서 파일을 열어볼 수 있도록** 해줘」
 * (사용자 요구 2026-10-07). 담기 · 지우기 · 통로 · 표의 규율은 이미 다른 시험들이 본다
 * (제품 모델 쪽 product-model-share-docs-screen.test.tsx · actions · 통합 시험). 여기서는
 * **이 탭이 무엇을 내는가**와 **묶는 쪽이 모델을 어떻게 얻는가**만 본다.
 *
 * 못 박는 것:
 *  · 🔴 한 줄도 없으면 **구역이 아예 안 그려진다**(모델을 못 찾은 건도 그 길로 들어온다)
 *  · 🔴 **담기 · 지우기가 여기엔 없다** — 보고 여는 자리다(고치는 곳은 제품 모델 상세)
 *  · 🔴 공유폴더 **맨 위 칸에 바로 놓인 파일**에는 [열기]가 없다(앞에 붙일 폴더가 없다)
 *  · 🔴 **그 판정을 베껴 적지 않았다** — 줄을 그리는 조각을 그대로 가져다 쓴다
 *  · 🔴 `print:hidden` — 위 두 공유폴더 구역과 같은 선
 *  · 🔴 **종류 구역과 제목이 다르다** — 나란히 선 셋을 사람이 구별할 수 있어야 한다
 *  · 🔴 서버는 **두 단계**로 묻되(모델 id → 가리킴) 못 찾으면 **DB 를 더 안 읽는다**
 *
 * 🔴 묶는 쪽(FilesScreen · files/page.tsx)은 **원본을 글자로 읽는다** — 둘 다 서버 액션 ·
 * `server-only` 사슬을 물고 있어 test:components 에서 그려 볼 수 없다. 구역 자체는 그런 것을
 * 물지 않으므로 **상태를 직접 넣어 그려 본다**(본보기 case-kind-share-docs-section.test.tsx
 * 와 같은 방식).
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

const sectionSource = read("CaseModelShareDocsSection.tsx");
const kindSectionSource = read("CaseKindShareDocsSection.tsx");
const filesScreen = read("FilesScreen.tsx");
const filesPage = read("..", "..", "..", "app", "(app)", "repair-cases", "[id]", "files", "page.tsx");
const sharedListSource = read("..", "..", "product-models", "ModelShareDocsSection.tsx");

const INSIDE = "2. 인수시 서류";

const doc = (overrides: Partial<ModelShareDocRow> = {}): ModelShareDocRow => ({
  id: "33333333-3333-4333-8333-333333333333",
  entryKind: "FILE",
  relativePath: `${INSIDE}/MBK200 회로도.pdf`,
  label: null,
  ...overrides,
});

const folderDoc = doc({
  id: "44444444-4444-4444-8444-444444444444",
  entryKind: "FOLDER",
  relativePath: "1. 수리 관련/MBK200-JS2",
  label: "MBK200 수리 자료",
});

function markup(docs: ModelShareDocRow[]): string {
  return renderToStaticMarkup(createElement(CaseModelShareDocsSection, { docs }));
}

const CASE_ID = "99999999-9999-4999-8999-999999999999";

/** 🔴 「가져올 수 있는」 상태를 **넣어 그려 본다** — 글자를 찾지 않고 결과로 잰다. */
function markupWithCopy(docs: ModelShareDocRow[], overrides: { repairCaseId?: string } = {}): string {
  return renderToStaticMarkup(
    createElement(CaseModelShareDocsSection, {
      docs,
      repairCaseId: CASE_ID,
      canCopyToContactFolder: true,
      ...overrides,
    })
  );
}

/** 그려진 [연락서 폴더에 저장] 단추의 수. */
function copyButtonCount(html: string): number {
  return html.match(/data-share-doc-contact-folder-save/g)?.length ?? 0;
}

describe("① 🔴 한 줄도 없으면 구역을 **아예 그리지 않는다**", () => {
  test("빈 목록이면 빈 글자다 — 「없습니다」 상자도 「모델이 없습니다」도 세우지 않는다", () => {
    assert.equal(markup([]), "");
  });

  test("한 줄이라도 있으면 머리와 줄이 선다", () => {
    const html = markup([doc()]);
    assert.ok(html.includes(caseModelShareDocsSectionTitle(1)), html);
    assert.ok(html.includes("data-case-model-share-docs-section"), html);
    assert.ok(html.includes("data-model-share-doc-row"), html);
    // 경로를 숨기지 않는다 — 「어느 자리인가」가 이 줄의 전부다.
    assert.ok(html.includes(`${INSIDE}/MBK200 회로도.pdf`), html);
  });

  test("머리에 줄 수가 적힌다 — 줄 수는 받은 목록 그대로다", () => {
    assert.ok(markup([doc(), folderDoc]).includes(caseModelShareDocsSectionTitle(2)));
    assert.equal(markup([doc(), folderDoc]).match(/data-model-share-doc-row/g)?.length, 2);
  });

  test("🔴 빈 판정은 구역 **안**에 있다 — 부르는 쪽이 조건을 또 적지 않는다", () => {
    assert.ok(flat(sectionSource).includes("if (docs.length === 0) return null;"), sectionSource);
    assert.equal(flat(filesScreen).includes("modelShareDocs.length > 0 &&"), false, "탭이 조건을 또 적는다");
  });
});

describe("② 🔴 종류 구역과 **제목이 다르다** — 나란히 선 셋을 구별할 수 있다", () => {
  test("같은 줄 수에서도 두 머리가 서로 다른 글자다", () => {
    for (const count of [1, 2, 7]) {
      assert.notEqual(caseModelShareDocsSectionTitle(count), caseKindShareDocsSectionTitle("GENERATOR", count));
      assert.notEqual(
        caseModelShareDocsSectionTitle(count),
        caseKindShareDocsSectionTitle("TOTAL_CONTROLLER", count)
      );
    }
  });

  test("🔴 **그려 보고 잰다** — 두 구역을 함께 세워 머리 글자와 표식이 겹치지 않는다", () => {
    const modelHtml = markup([doc()]);
    const kindHtml = renderToStaticMarkup(
      createElement(CaseKindShareDocsSection, {
        kind: "GENERATOR",
        docs: [{ id: doc().id, entryKind: "FILE", relativePath: doc().relativePath, label: null }],
      })
    );
    // 한쪽 머리가 다른 쪽 화면에 나타나지 않는다 — 사람이 둘을 섞어 읽을 수 없다.
    assert.equal(kindHtml.includes(caseModelShareDocsSectionTitle(1)), false, kindHtml);
    assert.equal(modelHtml.includes(caseKindShareDocsSectionTitle("GENERATOR", 1)), false, modelHtml);
    // 구역을 가리키는 표식도 각자다.
    assert.ok(modelHtml.includes("data-case-model-share-docs-section"), modelHtml);
    assert.equal(modelHtml.includes("data-case-kind-share-docs-section"), false, modelHtml);
    assert.ok(kindHtml.includes("data-case-kind-share-docs-section"), kindHtml);
    assert.equal(kindHtml.includes("data-case-model-share-docs-section"), false, kindHtml);
  });

  test("🔴 머리가 **모델의 것**이라고 말한다 — 「종류」가 아니다", () => {
    assert.ok(caseModelShareDocsSectionTitle(1).includes("제품 모델"), caseModelShareDocsSectionTitle(1));
    // 종류 이름표를 이 조각이 들고 있지 않다(그 축은 이 구역의 일이 아니다).
    const body = code(sectionSource);
    assert.equal(body.includes("PRODUCT_MODEL_KIND_LABELS"), false, "종류 이름표를 끌어왔다");
    assert.equal(body.includes("productModelKindOfWorkflowKind"), false, "종류 축을 끌어왔다");
  });
});

describe("③ 🔴 [열기]는 열 수 있는 확장자의 파일 줄에만 · 폴더 줄은 폴더 열기 단추", () => {
  test("판정은 **이미 있는 순수 함수**다 — 이 조각이 다시 적지 않았다", () => {
    assert.equal(canOpenModelShareDoc(doc()), true);
    assert.equal(canOpenModelShareDoc(folderDoc), true);
    assert.equal(canOpenModelShareDoc(doc({ relativePath: `${INSIDE}/설치.exe` })), false);
    assert.equal(canOpenModelShareDoc(doc({ relativePath: `${INSIDE}/문서` })), false);
    // 🔴 확장자 목록도 경로 규칙도 이 파일에 한 글자도 없다.
    const body = code(sectionSource);
    for (const forbidden of ["xlsm", "\\.exe", 'endsWith\\("\\.', "lastIndexOf", "split\\(\"/\"\\)"]) {
      assert.equal(new RegExp(forbidden).test(body), false, `규칙을 베껴 적었다: ${forbidden}`);
    }
    assert.equal(body.includes("dss-folder://"), false, "도우미 주소를 직접 짓는다");
  });

  test("🔴 여는 단추 둘을 **그대로 가져다 쓴다** — 줄을 그리는 조각째로 쓴다", () => {
    assert.ok(
      sectionSource.includes('from "@/components/product-models/ModelShareDocsSection"'),
      "줄 그리는 조각을 베꼈다"
    );
    assert.ok(sectionSource.includes("ModelShareDocList"), "목록 조각을 쓰지 않는다");
    // 그 조각 안에서 폴더 줄 · 파일 줄이 각각 어떤 단추를 받는지 — 여기서 갈라지면 안 된다.
    assert.ok(flat(sharedListSource).includes("<ContactFolderPlaceOpenButton relativePath={doc.relativePath} />"));
    assert.ok(flat(sharedListSource).includes("<ContactFolderEntryOpenButton folderName={modelShareDocParentPath("));
    // 🔴 이 조각은 여는 단추를 **직접 import 하지 않는다** — 그러면 두 벌이 된다.
    assert.equal(code(sectionSource).includes("ContactFolderEntryOpenButton"), false);
    assert.equal(code(sectionSource).includes("ContactFolderPlaceOpenButton"), false);
  });

  test("🔴 도우미 안내도 **공용 조각 그대로**다 — 두 벌을 만들지 않았다", () => {
    assert.ok(sectionSource.includes("KindShareDocsHelperNotice"), sectionSource);
    const body = code(sectionSource);
    // 그 안의 Windows 판정 · 표시 읽기 · 설치 명령은 전부 저쪽 한 자리에 있다.
    for (const forbidden of ["navigator", "localStorage", "useSyncExternalStore", "설치 명령"]) {
      assert.equal(body.includes(forbidden), false, `도우미 판정을 베껴 적었다: ${forbidden}`);
    }
  });

  test("🔴 도우미는 Windows 것이다 — 서버 렌더에는 단추가 한 개도 안 찍힌다", () => {
    const html = markup([doc(), folderDoc]);
    assert.equal(html.includes("data-contact-folder-entry-open"), false, html);
    assert.equal(html.includes("data-contact-folder-place-open"), false, html);
    // 줄 자체는 그대로 보인다 — 이름도 경로도 숨기지 않는다.
    assert.equal(html.match(/data-model-share-doc-row/g)?.length, 2, html);
    assert.ok(html.includes(modelShareDocDisplayName(folderDoc)), html);
  });
});

describe("④ 🔴 공유폴더 맨 위 칸에 바로 놓인 파일에는 [열기]가 없다", () => {
  test("앞에 붙일 폴더가 없으면 주소를 만들 수 없다 — 앞 조각들과 **같은 규칙**이다", () => {
    assert.equal(canOpenModelShareDoc(doc({ relativePath: "회로도.pdf" })), false);
    // 폴더는 깊이를 가리지 않는다 — 맨 위 칸의 폴더도 열린다.
    assert.equal(canOpenModelShareDoc(doc({ entryKind: "FOLDER", relativePath: "1. 수리 관련" })), true);
  });

  test("그 줄도 목록에서 빠지지 않는다 — 경로는 보인다", () => {
    const html = markup([doc({ relativePath: "회로도.pdf" })]);
    assert.ok(html.includes("회로도.pdf"), html);
    assert.ok(html.includes("data-model-share-doc-row"), html);
  });
});

describe("⑤ 🔴 담기 · 지우기 단추가 여기엔 없다 — 보고 여는 자리다", () => {
  test("그려진 것에 담기 · 지우기 · 확인 창이 하나도 없다", () => {
    const html = markup([doc(), folderDoc]);
    for (const forbidden of [
      "data-model-share-doc-remove",
      "data-model-share-doc-remove-dialog",
      "data-model-share-folder-add",
      "data-model-share-folder-picker",
      "data-kind-share-doc-remove",
    ]) {
      assert.equal(html.includes(forbidden), false, `${forbidden} 가 있다`);
    }
    assert.equal(html.includes("지우기"), false, html);
    assert.equal(html.includes("<dialog"), false, html);
    assert.equal(html.includes("<button"), false, html);
  });

  test("🔴 원본에도 길이 없다 — 서버 액션도 고르는 창도 물지 않는다", () => {
    const body = code(sectionSource);
    for (const forbidden of [
      "onRemove",
      "onAdd",
      "ModelShareFolderPicker",
      "ModelShareDocRemoveDialog",
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

  test("고치는 자리를 글로 알려 준다 — 종류 쪽 안내와 **다른 자리**를 가리킨다", () => {
    const html = markup([doc()]);
    assert.ok(html.includes(CASE_MODEL_SHARE_DOCS_MANAGE_HINT), html);
    assert.ok(CASE_MODEL_SHARE_DOCS_MANAGE_HINT.includes("모델 상세"), CASE_MODEL_SHARE_DOCS_MANAGE_HINT);
  });
});

describe("⑥ 🔴 인쇄에 안 찍힌다", () => {
  test("바깥 틀에 print:hidden 이 걸려 있다 — 위 두 공유폴더 구역과 같은 선", () => {
    const html = markup([doc(), folderDoc]);
    const openingTag = html.slice(0, html.indexOf(">"));
    assert.ok(openingTag.includes("print:hidden"), openingTag);
  });
});

describe("⑦ 🔴 서버가 모델을 어떻게 얻는가 — **두 단계**이고 못 찾으면 거기서 멈춘다", () => {
  test("수리 건 → 모델 마스터를 잇는 **이미 있는 함수**를 부른다", () => {
    assert.ok(filesPage.includes('from "@/lib/db/queries/repair-cases"'), filesPage);
    assert.ok(flat(filesPage).includes("getProductModelIdForProduct(resolved.productId)"), "잇는 규칙을 베껴 적는다");
    // 🔴 FK 를 직접 묻지 않는다 — 그 조건은 저 함수 한 자리에 있다.
    const body = code(filesPage);
    for (const forbidden of ["product_model_id", "productModels", "isDeleted", "innerJoin"]) {
      assert.equal(body.includes(forbidden), false, `잇는 조건을 베껴 적었다: ${forbidden}`);
    }
  });

  test("🔴 모델 id 를 **먼저** 알아야 가리킴을 조회할 수 있다 — 차례가 지켜진다", () => {
    assert.ok(filesPage.includes('from "@/lib/db/queries/product-model-share-docs"'), filesPage);
    assert.ok(flat(filesPage).includes("listShareDocsForProductModel(productModelId)"), filesPage);
    const idAt = filesPage.indexOf("getProductModelIdForProduct(");
    const docsAt = filesPage.indexOf("listShareDocsForProductModel(productModelId)");
    assert.ok(idAt > 0 && docsAt > idAt, "가리킴 조회가 모델 id 보다 앞에 섰다");
  });

  test("🔴 모델이 없으면 **DB 를 더 읽지 않는다** — 두 갈래 다 빈 목록으로 끝난다", () => {
    const body = flat(code(filesPage));
    // 장비가 없는 건(productId 가 NULL)에서는 첫 조회조차 하지 않는다.
    assert.ok(body.includes("if (!resolved.productId) return [];"), filesPage);
    // 모델을 못 찾으면(마스터에 안 묶였거나 휴지통) 가리킴 조회로 가지 않는다.
    assert.ok(body.includes("if (!productModelId) return [];"), filesPage);
  });

  test("🔴 묶음이 하나다 — 기존 세 조회의 병렬성을 무너뜨리지 않았다", () => {
    assert.equal(filesPage.split("await Promise.all([").length - 1, 1, "Promise.all 이 둘로 갈라졌다");
    assert.ok(
      flat(filesPage).includes(
        "const [attachments, trashedAttachments, kindShareDocs, modelShareDocs] = await Promise.all(["
      ),
      filesPage
    );
    // 먼저 있던 세 조회가 그 묶음에 그대로 있다.
    assert.ok(filesPage.includes("listAttachmentsForRepairCase(resolved.id)"), filesPage);
    assert.ok(filesPage.includes("listTrashedAttachmentsForRepairCase(resolved.id)"), filesPage);
    assert.ok(flat(filesPage).includes("listShareDocsForProductModelKind(productModelKind),"), filesPage);
    assert.ok(filesPage.includes("modelShareDocs={modelShareDocs}"), "목록을 안 내려 준다");
  });

  test("🔴 서버 컴포넌트가 **공유폴더(디스크)를 읽지 않는다** · 새 권한도 안 만들었다", () => {
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
    // 이 탭이 쓰던 판정 그대로다 — 다른 메뉴의 권한을 끌어오지 않았다.
    assert.ok(filesPage.includes('hasPermission(actingUser, "repairCases.files", "WRITE")'), filesPage);
    assert.equal(/"productModels\./.test(body), false, "다른 메뉴의 권한을 끌어왔다");
  });
});

describe("⑧ 구역이 서는 자리 — 이웃들은 한 글자도 안 바뀌었다", () => {
  test("🔴 **종류 구역 바로 뒤**에 하나 선다 — 아무것도 감싸지 않는다", () => {
    assert.equal(filesScreen.split("<CaseModelShareDocsSection").length - 1, 1, "구역이 둘 이상이다");
    assert.equal(filesScreen.includes("</CaseModelShareDocsSection>"), false, "무언가를 감싸고 있다");
    const contactAt = filesScreen.indexOf("<ContactFolderSection repairCaseId=");
    const kindAt = filesScreen.indexOf("<CaseKindShareDocsSection");
    const modelAt = filesScreen.indexOf("<CaseModelShareDocsSection");
    assert.ok(contactAt > 0 && kindAt > contactAt, "공유폴더 구역보다 앞에 섰다");
    assert.ok(modelAt > kindAt, "종류 구역보다 앞에 섰다");
    // 🔴 2026-10-08 에 [연락서 폴더에 저장]이 붙으며 칸이 둘 늘었다 — **줄들은 그대로** 건넨다.
    assert.ok(flat(filesScreen).includes("<CaseModelShareDocsSection docs={modelShareDocs}"), "줄들을 안 건넨다");
    assert.ok(flat(filesScreen).includes("<CaseModelShareDocsSection docs={modelShareDocs} repairCaseId={resolved.id} canCopyToContactFolder={shareDocCopyEnabled} />"), filesScreen);
  });

  test("🔴 본보기(종류 구역)를 고치지 않았다 — 제 자리의 글자가 그대로다", () => {
    assert.ok(flat(kindSectionSource).includes("if (docs.length === 0) return null;"), kindSectionSource);
    assert.ok(kindSectionSource.includes("data-case-kind-share-docs-section"), kindSectionSource);
    assert.ok(kindSectionSource.includes("KindShareDocList"), kindSectionSource);
    assert.ok(kindSectionSource.includes("PRODUCT_MODEL_KIND_LABELS"), kindSectionSource);
    // 그 구역도 여전히 담기 · 지우기를 들고 있지 않다.
    assert.equal(code(kindSectionSource).includes("onRemove"), false, kindSectionSource);
    // 탭에서 그 구역이 받던 것도 그대로다.
    assert.ok(flat(filesScreen).includes("docs={kindShareDocs}"), filesScreen);
    assert.ok(
      filesScreen.includes("productModelKindOfWorkflowKind(workflowKindOf(resolved.workflowType))"),
      filesScreen
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
  });

  test("🔴 데모 화면은 이 구역을 받지 않는다 — DB 건에서만 선다", () => {
    assert.ok(flat(filesScreen).includes("<DemoFilesScreen resolved={props.resolved} actingUser={props.actingUser} />"));
    assert.ok(flat(filesScreen).includes("modelShareDocs={props.modelShareDocs ?? []}"));
  });
});

describe("⑨ 🔴 더한 것 하나 — [연락서 폴더에 저장] (2026-10-08)", () => {
  test("🔴 설정 · 권한이 거짓이면 단추가 **아예 안 그려진다** — 기본값이 거짓이다", () => {
    assert.equal(copyButtonCount(markup([doc(), folderDoc])), 0);
    // 참이라도 **어느 건인지 모르면** 그리지 않는다 — 보낼 자리가 없다.
    assert.equal(copyButtonCount(markupWithCopy([doc()], { repairCaseId: "" })), 0);
  });

  test("🔴 **파일 줄에만** 그린다 — 폴더 줄에는 없다", () => {
    const html = markupWithCopy([doc(), folderDoc]);
    assert.equal(html.match(/data-model-share-doc-row/g)?.length, 2, html);
    assert.equal(copyButtonCount(html), 1, html);

    const three = markupWithCopy([
      doc({ id: "a" }),
      doc({ id: "b", relativePath: `${INSIDE}/MBK200 파라미터.xlsx` }),
      doc({ id: "c", relativePath: `${INSIDE}/MBK200 점검표.xlsm` }),
    ]);
    assert.equal(copyButtonCount(three), 3, three);
    assert.equal(copyButtonCount(markupWithCopy([folderDoc, doc({ id: "d", entryKind: "FOLDER" })])), 0);
  });

  test("🔴 [열기]를 못 그리는 줄에도 단추는 선다 — 두 판정은 다른 물건이다", () => {
    const top = doc({ relativePath: "회로도.pdf" });
    assert.equal(canOpenModelShareDoc(top), false);
    assert.equal(copyButtonCount(markupWithCopy([top])), 1);
  });

  test("🔴 담기 · 지우기는 여전히 없다 — 더한 것은 가져오기 하나뿐이다", () => {
    const html = markupWithCopy([doc(), folderDoc]);
    for (const forbidden of [
      "data-model-share-doc-remove",
      "data-model-share-doc-remove-dialog",
      "data-model-share-folder-add",
      "data-model-share-folder-picker",
      "<dialog",
      ">내려받기<",
      ">미리보기<",
      "href=",
      "/api/attachments",
    ]) {
      assert.equal(html.includes(forbidden), false, `${forbidden} 가 있다`);
    }
    assert.equal(html.includes("지우기"), false, html);
  });

  test("🔴 실행 파일 줄에는 단추를 그리지 않는다 — 그리고 `.xlsm` 은 그린다", () => {
    for (const name of ["설치.exe", "명령.bat", "모듈.dll", "매크로.docm", "쉘.sh"]) {
      assert.equal(copyButtonCount(markupWithCopy([doc({ relativePath: `${INSIDE}/${name}` })])), 0, name);
    }
    // 🔵 매크로 엑셀은 2026-10-08 부터 실행 파일 목록 밖이다 — 단추가 **선다**.
    for (const name of ["점검표.xlsm", "회로도.pdf", "파라미터.xlsx", "읽어주세요"]) {
      assert.equal(copyButtonCount(markupWithCopy([doc({ relativePath: `${INSIDE}/${name}` })])), 1, name);
    }
    // 🔴 화면이 확장자를 **따로 세지 않는다** — 목록을 베낀 자리가 없다.
    for (const forbidden of ["xlsm", "\\.exe", "EXECUTABLE_EXTENSIONS"]) {
      assert.equal(new RegExp(forbidden).test(code(sectionSource)), false, `목록을 베꼈다: ${forbidden}`);
    }
  });

  test("🔴 줄을 그리는 공용 조각이 **여전히 줄을 그린다** — 목록을 쪼개지 않았다", () => {
    // 🔴 구역에 `<ul` 은 **하나**다(형제 구역과 같은 규율).
    const many = markupWithCopy([
      doc({ id: "a" }),
      folderDoc,
      doc({ id: "c", relativePath: `${INSIDE}/MBK200 파라미터.xlsx` }),
    ]);
    assert.equal(many.match(/<ul/g)?.length, 1, many);
    assert.equal(many.match(/data-model-share-doc-row/g)?.length, 3, many);
    assert.equal(markup([doc(), folderDoc]).match(/<ul/g)?.length, 1);

    assert.ok(sectionSource.includes("ModelShareDocList"), sectionSource);
    assert.equal(sharedListSource.includes("ShareDocContactFolderButton"), false, "공용 조각에 단추를 넣었다");
    assert.ok(
      sectionSource.includes(
        'import ShareDocContactFolderButton, { canSaveShareDocToContactFolder } from "./ShareDocContactFolderButton"'
      )
    );
    const body = code(sectionSource);
    for (const forbidden of ["useState", "/api/", "fetch(", 'method: "POST"', "saveShareDocToContactFolder"]) {
      assert.equal(body.includes(forbidden), false, `구역이 누르는 흐름을 들고 있다: ${forbidden}`);
    }
  });

  test("🔴 줄 조각에 **자리 하나를 열었을 뿐**이다 — 안 넘기면 한 글자도 다르지 않다", () => {
    const rows = [doc(), folderDoc];
    const before = renderToStaticMarkup(createElement(ModelShareDocList, { docs: rows }));
    assert.equal(renderToStaticMarkup(createElement(ModelShareDocList, { docs: rows, rowAction: () => null })), before);
    const withAction = renderToStaticMarkup(
      createElement(ModelShareDocList, { docs: rows, rowAction: () => createElement("i", { "data-here": "" }) })
    );
    assert.equal(withAction.match(/<ul/g)?.length, 1, withAction);
    assert.equal(withAction.match(/data-here/g)?.length, 2, withAction);
  });

  test("🔴 형제 구역과 **같은 칸 · 같은 판정**을 쓴다 — 둘이 갈라지지 않는다", () => {
    for (const source of [sectionSource, kindSectionSource]) {
      assert.ok(source.includes("canCopyToContactFolder = false"), "기본값이 거짓이 아니다");
      // 🔴 어느 줄에 그릴지를 두 구역이 **같은 함수 하나**로 묻는다(둘에 따로 적지 않았다).
      assert.ok(source.includes("canSaveShareDocToContactFolder("), "줄 판정이 공용 함수가 아니다");
      assert.ok(source.includes("rowAction={"), "줄 조각이 열어 둔 자리를 안 쓴다");
    }
    assert.ok(flat(filesScreen).includes("canCopyToContactFolder={shareDocCopyEnabled}"), filesScreen);
  });
});
