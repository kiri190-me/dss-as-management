import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 종류별 공통 서류함 — 화면과 입구가 실제로 그렇게 돼 있는가
 * ============================================================================
 * 값으로 도는 부분(경로 · 분류 집합 · 주인 판정)은 unit 목록의
 * lib/domain/product-model-kind-attachment.test.ts 가 이미 본다. 여기서 못 박는
 * 것은 **화면 쪽 규율**이다:
 *
 *  1. 🔴 주소의 종류 마디가 셋 중 하나가 아니면 **notFound()** (완료 기준 ①)
 *  2. 🔴 서류함 화면의 권한이 모델 상세와 **같다** — 새로 만들지도 넓히지도 않았다
 *  3. 🔴 입구의 서류 수는 **서버가 센다** — 화면이 목록을 받아 다시 세지 않는다
 *  4. 🔴 **기존 모델 목록을 건드리지 않았다** — 검색 · 삭제 모드 · 휴지통 탭 그대로
 *  5. 🔴 분류 목록 · 종류 이름표를 화면이 베껴 적지 않는다
 *  6. 🔴 올리기는 **파일 바이트 본문**이고 주소의 종류는 enum 코드다
 *  7. 🔴 지우기 · 되살리기는 **기존 통로**를 쓴다(새 서버 액션을 만들지 않았다)
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * ProductModelKindFilesScreen 은 서버 액션(actions/attachments)을 직접 import 하는
 * 클라이언트 컴포넌트라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이
 * 도는 test:components 에서는 import 자체가 던진다. page.tsx 와 조회도 같은
 * 사정이다. 이웃(product-model-file-modified-date.test.ts ·
 * product-model-customer-source.test.ts)과 같은 방법으로 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/** "이 글자가 있으면 안 된다" 를 볼 때 쓴다 — 주석에 적힌 까닭에 걸리지 않게. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const screen = read("src/components/product-models/ProductModelKindFilesScreen.tsx");
const kindPage = read("src/app/(app)/product-models/kinds/[kind]/page.tsx");
const listScreen = read("src/components/product-models/ProductModelListScreen.tsx");
const listPage = read("src/app/(app)/product-models/page.tsx");
const modelDetailPage = read("src/app/(app)/product-models/[id]/page.tsx");
const queries = read("src/lib/db/queries/product-model-kind-attachments.ts");

describe("① 주소의 종류가 셋 중 하나가 아니면 404", () => {
  test("🔴 page 가 isProductModelKind 로 좁히고 notFound() 로 보낸다", () => {
    assert.ok(kindPage.includes('from "@/lib/domain/product-model-kind"'));
    assert.match(flat(code(kindPage)), /if \(!isProductModelKind\(kind\)\) \{ notFound\(\); \}/);
    assert.ok(kindPage.includes('import { notFound'), "notFound 를 가져오지 않는다");
  });

  test("🔴 종류 판정이 권한 확인보다 **뒤**다 — 404 와 「권한 없음」을 갈라 주면 목록이 샌다", () => {
    const permission = code(kindPage).indexOf('"productModels.view"');
    const kindCheck = code(kindPage).indexOf("isProductModelKind(kind)");
    assert.ok(permission > 0 && kindCheck > 0);
    assert.ok(permission < kindCheck, "권한보다 먼저 종류를 가린다");
  });

  test("🔴 조회도 스스로 좁힌다 — 셋 중 하나가 아니면 빈 목록이다", () => {
    const flatQueries = flat(code(queries));
    assert.ok(flatQueries.includes("if (!isProductModelKind(kind)) return [];"));
  });
});

describe("② 권한은 모델 상세와 같다 — 새로 만들지도 넓히지도 않았다", () => {
  test("🔴 네 줄이 모델 상세 page 와 같은 글자다", () => {
    for (const fragment of [
      'requireAreaAccessForCurrentUser("productModels")',
      'getAuthSource() !== "database"',
      'hasPermission(actingUser, "productModels.view", "READ")',
      'hasPermission(actingUser, "productModels.files", "WRITE")',
    ]) {
      assert.ok(kindPage.includes(fragment), `서류함 page 에 없다: ${fragment}`);
    }
    // 대조 기준이 흔들리지 않았는지 — 모델 상세 쪽도 같은 두 권한을 묻는다.
    assert.ok(modelDetailPage.includes('hasPermission(actingUser, "productModels.view", "READ")'));
    assert.ok(modelDetailPage.includes('hasPermission(actingUser, "productModels.files", "WRITE")'));
  });

  test("🔴 새 권한 영역을 지어내지 않았다", () => {
    assert.ok(!/"productModelKinds?\./.test(code(kindPage)));
    assert.ok(!/"productModelKinds?\./.test(code(screen)));
  });

  test("🔴 화면은 역할을 스스로 보지 않는다 — boolean 하나만 받는다", () => {
    assert.ok(screen.includes("canManageFiles: boolean"));
    for (const role of ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER", "SALES"]) {
      assert.ok(!code(screen).includes(role), `화면이 역할을 직접 본다: ${role}`);
    }
    // 권한이 없으면 올리기 칸도 지우기 단추도 아예 그리지 않는다.
    assert.ok(screen.includes("{canManageFiles && ("));
  });
});

describe("③ 입구의 서류 수는 서버가 센다", () => {
  test("🔴 목록 page 가 세어 넘긴다", () => {
    assert.ok(listPage.includes("countAttachmentsByProductModelKind()"));
    assert.ok(flat(listPage).includes("kindAttachmentCounts={kindAttachmentCounts}"));
  });

  test("🔴 한 질의로 센다 — 종류마다 따로 쏘지 않는다", () => {
    const counter = queries.slice(queries.indexOf("export async function countAttachmentsByProductModelKind"));
    assert.equal((counter.match(/await db/g) ?? []).length, 1, "조회를 여러 번 쏜다");
    assert.ok(counter.includes("groupBy(attachments.productModelKind)"));
    // 휴지통에 있는 서류는 세지 않는다 — 입구의 숫자와 서류함의 줄 수가 같아야 한다.
    assert.ok(counter.includes("eq(attachments.isDeleted, false)"));
  });

  test("🔴 화면이 목록을 받아 다시 세지 않는다", () => {
    const entry = code(listScreen).slice(
      code(listScreen).indexOf("function KindDocumentsEntry"),
      code(listScreen).indexOf("export default function ProductModelListScreen")
    );
    assert.ok(entry.includes("counts[code]"), "받은 숫자를 적지 않는다");
    assert.ok(!entry.includes(".length"), "화면에서 다시 센다");
    assert.ok(!entry.includes("filter("), "화면에서 걸러 센다");
  });

  test("🔴 한 건도 없는 종류도 0 으로 나온다 — 키가 늘 셋이다", () => {
    const counter = queries.slice(queries.indexOf("export async function countAttachmentsByProductModelKind"));
    assert.ok(flat(counter).includes("PRODUCT_MODEL_KIND_CODES.map((code) => [code, 0])"));
  });
});

describe("④ 기존 모델 목록을 건드리지 않았다", () => {
  test("🔴 입구는 목록 **위**에 얹혀 있다", () => {
    const flatList = flat(listScreen);
    const heading = flatList.indexOf("제품 모델 관리</h1>");
    const entry = flatList.indexOf("{kindAttachmentCounts && <KindDocumentsEntry");
    const tabs = flatList.indexOf("사용중 ({rows.length})");
    assert.ok(heading > 0 && entry > 0 && tabs > 0);
    assert.ok(heading < entry, "머리글보다 위에 있다");
    assert.ok(entry < tabs, "목록 탭보다 아래에 있다");
  });

  test("🔴 목록의 기존 장치가 그대로 있다 — 검색 · 삭제 모드 · 휴지통", () => {
    for (const fragment of [
      "row.modelName.includes(query)",
      "setIsDeleteMode(true)",
      "삭제 모드",
      "useMasterDataTrash",
      "deleteProductModelsAction",
      "restoreProductModelsAction",
      "permanentlyDeleteProductModelsAction",
    ]) {
      assert.ok(listScreen.includes(fragment), `목록에서 사라졌다: ${fragment}`);
    }
  });

  test("🔴 숫자가 안 넘어오면 입구를 아예 안 그린다 — 숫자 없는 단추가 먼저 뜨지 않는다", () => {
    assert.ok(listScreen.includes("kindAttachmentCounts?: ProductModelKindAttachmentCounts"));
    assert.ok(flat(listScreen).includes("{kindAttachmentCounts && <KindDocumentsEntry counts={kindAttachmentCounts} />}"));
  });
});

describe("⑤ 베껴 적은 것이 없다", () => {
  test("🔴 분류 선택지를 손으로 적지 않는다 — domain 의 한 함수를 부른다", () => {
    assert.ok(screen.includes("attachmentCategoriesForProductModelKind()"));
    for (const literal of ['"PARAMETER"', '"POWER_TEST"', '"CIRCUIT_DIAGRAM"', '"OTHER"']) {
      assert.ok(!code(screen).includes(literal), `분류를 직접 적었다: ${literal}`);
    }
  });

  test("🔴 종류 이름표를 손으로 적지 않는다", () => {
    for (const [name, source] of [
      ["서류함 화면", screen],
      ["목록 화면", listScreen],
    ] as const) {
      assert.ok(source.includes('from "@/lib/domain/product-model-kind"'), `${name} 이 공용 이름표를 안 쓴다`);
      assert.ok(!code(source).includes('"Total Controller (T/C)"'), `${name} 에 이름표가 직접 적혀 있다`);
    }
  });

  test("🔴 원본 수정일을 거르는 판정을 화면이 따로 적지 않는다 — 서버와 같은 함수 하나를 지난다", () => {
    assert.ok(screen.includes("originalModifiedAtParamValue(file.lastModified)"));
    assert.ok(screen.includes("ORIGINAL_MODIFIED_AT_PARAM"));
    // 화면이 스스로 경계를 정하지 않는다.
    assert.ok(!code(screen).includes("1990"));
    assert.ok(!code(screen).includes("Date.UTC"));
  });

  test("🔴 모르는 원본 수정일을 올린 날짜로 메우지 않는다", () => {
    const flatScreen = flat(code(screen));
    assert.ok(!flatScreen.includes("originalModifiedAt ?? item.uploadedAt"));
    assert.ok(!flatScreen.includes("originalModifiedAt || item.uploadedAt"));
    // 표에서는 줄표, 미리보기에서는 줄 자체를 안 그린다.
    assert.ok(screen.includes("UNKNOWN_ORIGINAL_MODIFIED_AT"));
    assert.ok(flatScreen.includes("{item.originalModifiedAt && ("));
  });
});

describe("⑥·⑦ 올리기와 지우기가 기존 길을 쓴다", () => {
  test("🔴 올리기 본문은 파일 바이트 그 자체이고, 주소의 종류는 enum 코드다", () => {
    const flatScreen = flat(screen);
    assert.ok(
      flatScreen.includes("`/api/product-model-kinds/${encodeURIComponent(kind)}/attachments?${query.toString()}`")
    );
    assert.ok(flatScreen.includes('{ method: "POST", body: file }'));
    assert.ok(!code(screen).includes("FormData"), "multipart 로 보내면 서버가 파일을 통째로 메모리에 올린다");
    // 한글 이름을 주소에 싣지 않는다 — kind 는 enum 코드 그대로다.
    assert.ok(!flatScreen.includes("productModelKindLabel(kind)}/attachments"));
  });

  test("🔴 지우기 · 되살리기는 기존 서버 액션을 그대로 쓴다 — 새 통로를 만들지 않았다", () => {
    assert.ok(screen.includes("softDeleteAttachmentAction"));
    assert.ok(screen.includes("restoreAttachmentAction"));
    assert.ok(screen.includes('from "@/lib/server/actions/attachments"'));
    // 넘기는 종류 코드는 **화면 갱신 경로일 뿐**이다. 권한은 서버가 주인을 다시 읽어 정한다.
    assert.ok(flat(screen).includes("productModelKind: kind,"));
  });

  test("🔴 내려받기도 기존 통로 하나다", () => {
    assert.ok(flat(screen).includes("`/api/attachments/${encodeURIComponent(id)}/download`"));
  });

  test("🔴 「제품 모델 관리」로 돌아가는 링크가 있다", () => {
    assert.ok(flat(screen).includes('href="/product-models"'));
    assert.ok(screen.includes("← 제품 모델 관리"));
  });

  test("🔴 썸네일을 만들어 보내지 않는다 — 둘 자리가 주인의 ID 로 정해지는데 이 주인은 ID 가 없다", () => {
    assert.ok(!code(screen).includes("uploadPreview"));
  });
});
