import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「기본 정보」 제품 정보 — 모델명을 누르면 그 제품 모델의 상세로 간다
 * (2026-09-30 요구)
 * ============================================================================
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ──────────────────────────────────
 * 여기서 봐야 하는 것 절반이 **서버 컴포넌트**([id]/page.tsx)의 판정이라 렌더할
 * 대상이 아니고, ProductInfoSection 쪽도 ProductInfoEditForm →
 * useSectionEditSubmit → 서버 액션으로 이어지는 사슬을 물고 있어 react-server
 * 조건 없이 도는 test:components 에서는 **import 자체가 던진다.** 이웃
 * (product-info-history-disclosure.test.ts · domestic-order-dates-section.test.ts)
 * 이 같은 자리에서 쓰는 방법을 그대로 쓴다.
 *
 * ── 여기서 못 박는 것 ──────────────────────────────────────────────────────
 *  1. 🔴 **모델 id 가 있을 때만 링크가 된다.** 없으면 예전 그대로 글자다 —
 *     누를 수 없는 링크도, 막다른 주소도 만들지 않는다.
 *  2. 주소는 /product-models/{id} 다(모델명 문자열이 아니라 마스터 id).
 *  3. 🔴 **제품 모델을 볼 수 없는 세션에는 링크가 없다.** 수리 건 상세는 역할로
 *     막혀 있지 않아 INVENTORY_MANAGER 도 들어오는데 그 역할은 제품 모델을 아예
 *     못 본다 — 묻지 않으면 그 사람에게만 막힌 화면으로 가는 링크가 생긴다.
 *     판정은 설정 축(hasPermission) 하나이고, 역할 이름을 비교하지 않는다.
 *  4. 판정도 조회도 페이지가 하고 화면은 있고 없고만 본다 — 구역이 제 손으로
 *     권한을 셈하지 않는다.
 *  5. 🔴 **다른 칸들은 한 글자도 달라지지 않았다.** 이 화면은 Field 를 일곱 곳에서
 *     쓰는데 href 를 받는 것은 Model 한 칸뿐이다.
 *  6. 🔴 **과거 A/S 이력 줄의 동작은 그대로다.** 새 링크는 가로채지 않는다 —
 *     preventDefault 도 showSavePopup 도 늘어나지 않았다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);

/** 주석을 뺀 원본. 주석이 규칙을 **글자로** 적어 두고 있어 그냥 찾으면 거기 걸린다. */
function sourceOf(path: string): string {
  return readFileSync(new URL(path, repoUrl), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
function flatten(code: string): string {
  return code.replace(/\s+/g, " ");
}

const pageCode = sourceOf("src/app/(app)/repair-cases/[id]/page.tsx");
const pageFlat = flatten(pageCode);
const viewFlat = flatten(sourceOf("src/components/repair-cases/detail/RepairCaseDetailView.tsx"));
const sectionCode = sourceOf("src/components/repair-cases/detail/ProductInfoSection.tsx");
const sectionFlat = flatten(sectionCode);
const queryFlat = flatten(sourceOf("src/lib/db/queries/repair-cases.ts"));

// ── ① 🔴 id 가 있으면 링크, 없으면 글자 ─────────────────────────────────

describe("🔴 모델 id 가 있을 때만 링크가 된다", () => {
  test("href 가 있고 값이 있을 때만 <Link> 로 감싼다", () => {
    assert.match(sectionFlat, /\{href && value \? \( <Link href=\{href\}/);
  });

  test("id 가 없으면 예전 그대로 글자다 — 빈 값은 여전히 '-' 다", () => {
    assert.ok(
      sectionFlat.includes(') : ( (value ?? "-") )}'),
      "링크가 아닐 때의 갈래가 예전 그대로가 아니다"
    );
  });

  test("Model 칸은 id 가 있을 때만 href 를 받는다", () => {
    assert.match(
      sectionFlat,
      /<Field label="Model" value=\{resolved\.modelName\} href=\{productModelLinkId \? `\/product-models\/\$\{productModelLinkId\}` : null\}/
    );
  });

  test("링크가 붙는 칸은 하나뿐이다 — 나머지 여섯 칸은 글자 그대로다", () => {
    assert.equal(sectionFlat.match(/<Field /g)?.length, 7, "제품 정보의 칸 수가 달라졌다");
    assert.equal(sectionFlat.match(/href=\{productModelLinkId/g)?.length, 1);
    assert.match(sectionFlat, /<Field label="L\/N" value=\{resolved\.lotNumber\} \/>/);
    assert.match(sectionFlat, /<Field label="S\/N" value=\{resolved\.serialNumber\} \/>/);
    assert.match(sectionFlat, /<Field label="탈거 사유" value=\{resolved\.reasonForRemoval\} \/>/);
  });

  test("href 는 선택 인자다 — 주지 않은 칸의 뜻이 달라지지 않는다", () => {
    assert.match(sectionFlat, /href = null,/);
    assert.match(sectionFlat, /href\?: string \| null;/);
  });
});

// ── ② 주소와 읽히는 이름 ────────────────────────────────────────────────

describe("링크가 가리키는 곳과 화면 낭독기가 읽을 이름", () => {
  test("주소는 모델명이 아니라 마스터 id 로 만든다", () => {
    assert.match(sectionFlat, /`\/product-models\/\$\{productModelLinkId\}`/);
    // 모델명 문자열로 주소를 만들면 모델명을 고치는 날 링크가 조용히 끊긴다.
    assert.ok(!/product-models\/\$\{resolved\.modelName\}/.test(sectionCode));
  });

  test("무엇으로 가는 링크인지 읽힌다 — 값 글자만으로는 알 수 없다", () => {
    assert.match(sectionFlat, /aria-label=\{linkLabel\}/);
    assert.match(sectionFlat, /linkLabel=\{`제품 모델 상세로 이동: \$\{resolved\.modelName\}`\}/);
  });

  test("누를 수 있다는 것이 보인다 — 밑줄이 늘 있다", () => {
    assert.match(sectionFlat, /className="font-medium underline underline-offset-2/);
  });
});

// ── ③ 🔴 볼 수 없는 사람에게는 링크가 없다 ──────────────────────────────

describe("🔴 제품 모델을 볼 수 없는 세션에는 링크를 만들지 않는다", () => {
  test("열쇠는 제품 모델 화면이 스스로를 지키는 것과 같다 — productModels.view READ", () => {
    assert.match(pageFlat, /await hasPermission\(actingUser, "productModels\.view", "READ"\)/);
  });

  test("🔴 역할 이름을 비교하지 않는다 — 판정은 설정 축 하나다", () => {
    assert.ok(
      !/from "@\/lib\/auth\/product-model-authorization"/.test(pageCode),
      "역할 기반 판정을 상세 페이지에 새로 끌어왔다"
    );
    assert.ok(!/actingUser\.role ===/.test(pageCode), "역할 이름 비교를 새로 적었다");
  });

  test("권한·소스·제품이 다 맞을 때만 조회가 돈다 — 아니면 null 이다", () => {
    assert.match(
      pageFlat,
      /const productModelLinkId = canOpenProductModelDetail && resolved\.source === "DATABASE" && resolved\.productId !== null \? await getProductModelIdForProduct\(resolved\.productId\) : null;/
    );
  });

  test("그 판정이 화면까지 그대로 간다 — 구역이 제 손으로 권한을 셈하지 않는다", () => {
    assert.match(pageFlat, /productModelLinkId=\{productModelLinkId\}/);
    assert.match(viewFlat, /productModelLinkId: string \| null;/);
    assert.match(viewFlat, /productModelLinkId=\{productModelLinkId\}/);
    assert.match(sectionFlat, /productModelLinkId: string \| null;/);
    assert.ok(
      !/hasPermission|hasAreaAccess/.test(sectionCode),
      "제품 정보 구역이 제 손으로 권한을 판정하고 있다"
    );
  });
});

// ── ④ 조회가 막다른 주소를 내놓지 않는다 ────────────────────────────────

describe("조회는 살아 있는 모델 마스터만 돌려준다", () => {
  test("이름이 아니라 FK 로 찾는다", () => {
    assert.match(
      queryFlat,
      /export async function getProductModelIdForProduct\(productId: string\): Promise<string \| null>/
    );
    assert.match(queryFlat, /innerJoin\(productModels, eq\(products\.productModelId, productModels\.id\)\)/);
  });

  test("🔴 휴지통에 든 모델은 걸러진다 — 그 주소로 보내면 막다른 길이다", () => {
    assert.match(
      queryFlat,
      /where\(and\(eq\(products\.id, productId\), eq\(productModels\.isDeleted, false\)\)\)/
    );
  });

  test("읽기 전용이다 — 이 조회는 아무것도 바꾸지 않는다", () => {
    assert.match(queryFlat, /db \.select\(\{ productModelId: productModels\.id \}\)/);
  });
});

// ── ⑤ 🔴 과거 A/S 이력 줄은 그대로다 ────────────────────────────────────

describe("🔴 이미 있던 이력 링크의 동작을 바꾸지 않았다", () => {
  test("이력 줄은 여전히 팝업을 띄우고 그 건으로 넘어간다", () => {
    assert.match(sectionFlat, /<Link href=\{`\/repair-cases\/\$\{item\.id\}`\}/);
    assert.equal(sectionCode.match(/showSavePopup\(/g)?.length, 1);
  });

  test("새 링크는 가로채지 않는다 — preventDefault 는 여전히 한 곳뿐이다", () => {
    assert.equal(sectionCode.match(/preventDefault\(\)/g)?.length, 1);
    assert.match(
      sectionFlat,
      /<Link href=\{href\} aria-label=\{linkLabel\} className="[^"]*" > \{value\} <\/Link>/,
      "모델 링크에 onClick 이 붙었다 — 새 탭·새 창으로 열기를 뺏으면 안 된다"
    );
  });
});
