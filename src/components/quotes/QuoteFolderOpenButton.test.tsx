import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import QuoteFolderOpenButton, {
  QUOTE_FOLDER_OPEN_BUTTON_TITLE,
  QuoteFolderOpenControl,
  QuoteFolderOpenNotice,
} from "./QuoteFolderOpenButton";
import { QUOTE_FOLDER_NOT_FOUND_TEXT, type QuoteFolderOpenOutcome } from "./quote-folder-open";

/**
 * ============================================================================
 * 편집 화면 머리의 [폴더 열기] 단추 · 결과 자리 (견적서 ④b·④c)
 * ============================================================================
 * 누른 뒤의 흐름은 quote-folder-open.test.ts 가 값으로 본다. 여기서는 무엇을 그리는지만 —
 * 🔴 서버 렌더 · 첫 렌더는 감춘 채(Windows 판단은 마운트 뒤), 단추는 링크가 아니다.
 * 편집 화면의 어느 자리에 두는지는 quote-folder-open-screens.test.ts.
 *
 * 🔴 화면은 설치 파일을 주지 않는다(사용자 결정 2026-09-16) — 결과 자리의 선택지는
 * [위치 복사] · [설치 명령 복사] 둘뿐이다.
 * ============================================================================
 */

const noop = () => {};

describe("단추", () => {
  test("🔴 서버 렌더 · 첫 렌더는 감춘다 — 이 시험을 도는 Node 의 navigator 가 Windows 처럼 보여도", () => {
    const html = renderToStaticMarkup(<QuoteFolderOpenButton quoteId="q-1" className="btn" onOutcome={noop} />);
    assert.equal(html, "");
  });

  test("단추 자체 — 링크가 아니고 설명을 달았다 · 도우미 주소나 통로가 화면에 없다", () => {
    const html = renderToStaticMarkup(<QuoteFolderOpenControl quoteId="q-1" className="btn" onOutcome={noop} />);
    assert.ok(html.startsWith('<button type="button"'), html);
    assert.ok(html.includes(">폴더 열기</button>"), html);
    assert.ok(html.includes("data-quote-folder-open"), html);
    assert.ok(html.includes(`title="${QUOTE_FOLDER_OPEN_BUTTON_TITLE}"`), html);
    for (const absent of ["href=", "/api/", "dss-folder:"]) {
      assert.ok(!html.includes(absent), `단추에 '${absent}' 가 있다`);
    }
    assert.ok(!html.includes('disabled=""'), html);
  });

  test("잠그라면 잠긴다(저장 중 · 충돌)", () => {
    const html = renderToStaticMarkup(<QuoteFolderOpenControl quoteId="q-1" className="btn" disabled onOutcome={noop} />);
    assert.ok(html.includes('disabled=""'), html);
  });
});

describe("결과 자리", () => {
  const UNC_PATH = `${String.fromCharCode(92, 92)}NAS01${String.fromCharCode(92)}견적서보관`;
  const opened: QuoteFolderOpenOutcome = {
    kind: "OPENED",
    lines: [{ text: "탐색기로 폴더를 엽니다: 2026년 견적서/DSS 2026-077", tone: "normal" }],
    offerHelperInstall: true,
    uncPath: UNC_PATH,
  };

  test("폴더를 찾았을 때 — 줄과 「탐색기가 열리지 않았다면 [위치 복사] 또는 [설치 명령 복사]」(단추, 링크 아님)", () => {
    const html = renderToStaticMarkup(<QuoteFolderOpenNotice outcome={opened} />);
    assert.ok(html.includes('role="status"'), html);
    assert.ok(html.includes("탐색기로 폴더를 엽니다: 2026년 견적서/DSS 2026-077"), html);
    assert.ok(html.includes("탐색기가 열리지 않았다면"), html);
    assert.ok(html.includes(">위치 복사</button>"), html);
    assert.ok(html.includes(">설치 명령 복사</button>"), html);
    assert.ok(html.includes("data-quote-folder-unc-path"), html);
    assert.ok(html.includes("data-quote-folder-helper-install-command"), html);
    assert.ok(!html.includes("href="), "단추가 링크다 — 409 면 편집 화면을 떠난다");
    assert.ok(!html.includes("NAS01"), "누르기 전에 전체 주소가 화면에 있다");
  });

  test("🔴 설치 파일을 주는 길이 화면에 없다", () => {
    const html = renderToStaticMarkup(<QuoteFolderOpenNotice outcome={opened} />);
    for (const gone of ["설치 파일", "다시 받기", "차단 해제", "data-quote-folder-helper-installer"]) {
      assert.ok(!html.includes(gone), `'${gone}' 가 남아 있다: ${html}`);
    }
  });

  test("내밀지 않는 결과에는 단추가 없다 · 주의 줄은 주의 색", () => {
    const html = renderToStaticMarkup(
      <QuoteFolderOpenNotice
        outcome={{ kind: "NOT_FOUND", lines: [{ text: QUOTE_FOLDER_NOT_FOUND_TEXT, tone: "warning" }], offerHelperInstall: false }}
      />
    );
    assert.ok(html.includes(QUOTE_FOLDER_NOT_FOUND_TEXT), html);
    assert.ok(html.includes("text-amber-700"), html);
    assert.ok(!html.includes("<button"), html);
  });
});
