import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 화면마다 저장 뒤 어떤 팝업을 띄우고 어디로 넘기는지 붙잡는다(2026-09-15 사용자 요청).
 *
 * 규칙: 목록에 올라가는 건 자체를 등록·수정하면 팝업 뒤 **그 목록으로** 넘긴다.
 * 이미 목록 위이거나(창) 한 건 안에 딸린 것을 붙이는 곳은 **팝업만** 띄우고 머문다 —
 * 담당자를 셋 붙이려고 매번 목록에서 다시 찾아 들어가게 하지 않으려는 것이다.
 *
 * 브라우저 없이 볼 수 있는 것은 소스뿐이라 부르는 모양을 읽는다. 각 항목은
 * [문구 식, 넘어갈 곳 식] 이고 파일 안에 적힌 순서다.
 */
function popupCalls(path: string): [string, string][] {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(/showSavePopup\(\{\s*message:\s*([^,]+?),\s*redirectTo:\s*([^}]+?)\s*\}\)/g)].map(
    (match) => [match[1], match[2]]
  );
}

test("고객사 — 정보 수정은 목록으로 넘기고, 추가 창은 목록 위라 머문다", () => {
  assert.deepEqual(popupCalls("src/components/customers/CustomerEditForm.tsx"), [
    ['"고객사 정보를 저장했습니다."', '"/customers"'],
  ]);
  const create = readFileSync("src/components/customers/CustomerCreateForm.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/customers/CustomerCreateForm.tsx"), [
    ["`고객사를 등록했습니다 (${name.trim()})`", "null"],
  ]);
  // 그 전에는 새 고객사의 상세 화면으로 갔다.
  assert.doesNotMatch(create, /router\.push\(/);
  assert.match(create, /onClose\(\);\s*router\.refresh\(\);\s*showSavePopup\(/);
});

test("고객사 안의 End-User·담당자는 팝업만 띄우고 머문다", () => {
  assert.deepEqual(popupCalls("src/components/customers/EndUserManagementSection.tsx"), [
    ['"End-User를 추가했습니다."', "null"],
    ['"End-User 이름을 바꿨습니다."', "null"],
  ]);
  for (const path of [
    "src/components/customers/CustomerContactList.tsx",
    "src/components/customers/EndUserContactList.tsx",
  ]) {
    assert.deepEqual(
      popupCalls(path),
      [
        ['"담당자 정보를 저장했습니다."', "null"],
        ['"담당자를 추가했습니다."', "null"],
      ],
      path
    );
  }
});

test("제품 모델 — 정보 수정은 목록으로, 파일 올리기는 머문다", () => {
  assert.deepEqual(popupCalls("src/components/product-models/ProductModelEditForm.tsx"), [
    ['"제품 모델 정보를 저장했습니다."', '"/product-models"'],
  ]);
  const files = readFileSync("src/components/product-models/ProductModelFilesSection.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/product-models/ProductModelFilesSection.tsx"), [
    ["`${uploaded}건을 올렸습니다.`", "null"],
  ]);
  // 몇 건이 빠진 경우는 무엇이 빠졌는지 읽어야 하므로 화면에 남는다.
  assert.match(files, /건은 빠졌습니다 — /);
});

test("견적서 — 만들기도 고치기도 왔던 목록으로 넘어간다", () => {
  const form = readFileSync("src/components/quotes/QuoteEditForm.tsx", "utf8");
  assert.deepEqual(popupCalls("src/components/quotes/QuoteEditForm.tsx"), [
    ['"견적서를 저장했습니다."', 'returnHref ?? "/quotes"'],
    ['"견적서를 등록했습니다."', 'returnHref ?? "/quotes"'],
  ]);
  // 그 전에는 새 장의 수정 화면으로 갔다.
  assert.doesNotMatch(form, /router\.push\(returnHref \?\? `\/quotes\/\$\{result\.id\}`\)/);
  // 🔴 넘기기 전에 단추를 되살리면 두 번 눌러 견적서가 두 장 생긴다.
  assert.equal(form.match(/leaving = true;\s*showSavePopup\(/g)?.length, 2);
});
