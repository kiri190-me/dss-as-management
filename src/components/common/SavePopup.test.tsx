import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SavePopupView,
  cancelSavePopupProgress,
  finishSavePopupProgress,
  showSavePopup,
  showSavePopupProgress,
} from "./SavePopup";
import { SAVE_POPUP_EVENT, SAVE_POPUP_PROGRESS_EVENT } from "@/lib/domain/save-popup";

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

/**
 * ============================================================================
 * 🔴 진행 중 팝업 (2026-10-12)
 * ============================================================================
 * 판단(띄움 · 끝남 · 그만둠 · 0.5초를 세는가)은 값으로 lib/domain/save-popup.test.ts 가 본다.
 * 여기서 보는 것은 **그 판단이 화면에 이어져 있는가**다 — 부르는 쪽이 창에 보내는 신호,
 * 그려지는 꼴, 그리고 호스트가 그 규칙을 **제 손으로 다시 적지 않았는가**.
 * ============================================================================
 */

function captured(event: string, run: () => void): unknown[] {
  const target = new EventTarget();
  const received: unknown[] = [];
  target.addEventListener(event, (e) => received.push((e as CustomEvent).detail));
  const globals = globalThis as { window?: unknown };
  const previous = globals.window;
  globals.window = target;
  try {
    run();
  } finally {
    globals.window = previous;
  }
  return received;
}

test("🔴 진행 중 팝업은 **다른 신호**로 간다 — 저장 팝업 쪽에는 아무것도 가지 않는다", () => {
  assert.deepEqual(
    captured(SAVE_POPUP_PROGRESS_EVENT, () =>
      showSavePopupProgress({ message: "저장된 엑셀을 PDF 로 바꾸는 중입니다…", redirectTo: "/quotes" })
    ),
    // 🔵 `historyMode` 는 2026-11-01 에 생긴 칸이고, 적지 않은 호출은 **지금까지대로**
    //    `"push"` 다(domain/save-popup.ts 의 SavePopupHistoryMode). 기대값에 박아 두는
    //    것이 그 기본값을 지킨다 — 이 자리가 `"replace"` 로 읽히기 시작하면 터진다.
    [{ phase: "start", message: "저장된 엑셀을 PDF 로 바꾸는 중입니다…", redirectTo: "/quotes", historyMode: "push" }]
  );
  assert.deepEqual(
    captured(SAVE_POPUP_EVENT, () =>
      showSavePopupProgress({ message: "저장된 엑셀을 PDF 로 바꾸는 중입니다…", redirectTo: "/quotes" })
    ),
    []
  );
});

test("끝남 · 그만둠도 신호 하나씩이다 — 끝남은 글자만 들고 간다", () => {
  assert.deepEqual(
    captured(SAVE_POPUP_PROGRESS_EVENT, () => finishSavePopupProgress("완료되었습니다")),
    [{ phase: "finish", message: "완료되었습니다" }]
  );
  assert.deepEqual(
    captured(SAVE_POPUP_PROGRESS_EVENT, () => cancelSavePopupProgress()),
    [{ phase: "cancel" }]
  );
});

test("진행 중 신호도 서버에서 불려 터지지 않는다", () => {
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  assert.doesNotThrow(() => showSavePopupProgress({ message: "바꾸는 중…", redirectTo: null }));
  assert.doesNotThrow(() => finishSavePopupProgress("완료되었습니다"));
  assert.doesNotThrow(() => cancelSavePopupProgress());
});

test("🔴 도는 중에는 ✓ 가 없다 — 끝나면 같은 대화상자에서 표와 글자가 바뀐다", () => {
  const busy = renderToStaticMarkup(<SavePopupView message="저장된 엑셀을 PDF 로 바꾸는 중입니다…" busy />);
  assert.match(busy, /^<dialog/);
  assert.match(busy, />저장된 엑셀을 PDF 로 바꾸는 중입니다…<\/p>/);
  assert.equal(busy.includes("✓"), false, busy);
  assert.match(busy, /animate-spin/);
  // 끝난 꼴은 지금까지 그대로다.
  const done = renderToStaticMarkup(<SavePopupView message="완료되었습니다" />);
  assert.ok(done.includes("✓"), done);
  assert.equal(done.includes("animate-spin"), false, done);
});

test("🔴 호스트는 셈을 다시 적지 않는다 — 0.5초 시계를 그 판단에 건다", () => {
  const host = readFileSync("src/components/common/SavePopup.tsx", "utf8");
  // 🔴 「진행 중이면 세지 않는다」가 여기 또 적히면 한쪽만 고쳐져 팝업이 뜨자마자 사라진다.
  assert.match(host, /if \(!active \|\| !savePopupCountsDownToLeave\(active\)\) return;/);
  assert.match(host, /const next = nextSavePopupOnProgress\(state, signal\);/);
  // 🔴 끝났을 때 id 를 지켜야 **같은 팝업**의 글자만 바뀐다(새 id 면 한 번 닫혔다 다시 뜬다).
  assert.match(host, /id: startId \?\? current\?\.id \?\? 0,/);
  assert.match(host, /<SavePopupView key=\{active\.id\} message=\{active\.request\.message\} busy=\{active\.awaitingFinish\} \/>/);
  // 🔴 시계는 `active` 가 바뀌면 다시 걸린다 — 그래서 **끝났다고 알린 그때부터** 0.5초다.
  assert.match(host, /\}, \[active, pathname, router\]\);/);
});

test("A/S 접수는 등록 팝업을 띄우고 목록으로 넘어간다 — 상세로 가지 않는다", () => {
  const source = readFileSync("src/components/repair-cases/new/IntakeFormInner.tsx", "utf8");
  assert.match(source, /showSavePopup\(\{/);
  // 2026-10-04 에 「고객이 보낸 수리 의뢰에서 옮겨 오기」가 걷히면서 갈래가
  // 없어졌다 — 어디서 들어왔든 접수 목록 한 곳으로 간다.
  assert.match(source, /redirectTo: "\/repair-cases",/);
  assert.doesNotMatch(source, /customer-portal\/requests/);
  // 아무도 읽지 않던 표시였다(2026-09-15 조사) — 팝업이 그 자리를 대신한다.
  assert.doesNotMatch(source, /registered=1/);
});
