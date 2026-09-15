import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SavePopupView, showSavePopup } from "./SavePopup";
import { SAVE_POPUP_EVENT } from "@/lib/domain/save-popup";

test("팝업은 문구를 담은 대화상자로 그려진다", () => {
  const html = renderToStaticMarkup(<SavePopupView message="고객사를 등록했습니다." />);
  assert.match(html, /^<dialog/);
  assert.match(html, /aria-label="고객사를 등록했습니다\."/);
  assert.match(html, /role="status"/);
  assert.match(html, />고객사를 등록했습니다\.<\/p>/);
});

test("showSavePopup 은 창에 신호 하나만 보낸다 — 넘기는 것은 팝업이 한다", () => {
  const target = new EventTarget();
  const received: unknown[] = [];
  target.addEventListener(SAVE_POPUP_EVENT, (event) => received.push((event as CustomEvent).detail));

  const globals = globalThis as { window?: unknown };
  const previous = globals.window;
  globals.window = target;
  try {
    showSavePopup({ message: "저장했습니다.", redirectTo: "/customers" });
  } finally {
    globals.window = previous;
  }

  assert.deepEqual(received, [{ message: "저장했습니다.", redirectTo: "/customers" }]);
});

test("서버에서 불려도 터지지 않는다", () => {
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  assert.doesNotThrow(() => showSavePopup({ message: "저장했습니다.", redirectTo: null }));
});

test("팝업은 앱 틀에 한 번 붙는다", () => {
  const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
  assert.match(layout, /import SavePopupHost from "@\/components\/common\/SavePopup";/);
  assert.equal(layout.match(/<SavePopupHost \/>/g)?.length, 1);
});

test("A/S 접수는 등록 팝업을 띄우고 목록으로 넘어간다 — 상세로 가지 않는다", () => {
  const source = readFileSync("src/components/repair-cases/new/IntakeFormInner.tsx", "utf8");
  assert.match(source, /showSavePopup\(\{/);
  assert.match(source, /redirectTo: fromRequestId \? "\/customer-portal\/requests" : "\/repair-cases"/);
  // 아무도 읽지 않던 표시였다(2026-09-15 조사) — 팝업이 그 자리를 대신한다.
  assert.doesNotMatch(source, /registered=1/);
});
