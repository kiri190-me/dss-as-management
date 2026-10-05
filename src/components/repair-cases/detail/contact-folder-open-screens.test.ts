import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { isWindowsDesktopClient, readQuoteFolderClientPlatform } from "@/components/quotes/quote-folder-open";
import ContactFolderOpenButton, {
  ContactFolderOpenControl,
  ContactFolderOpenNotice,
} from "./ContactFolderOpenButton";
import type { ContactFolderOpenOutcome } from "./contact-folder-open";

/**
 * ============================================================================
 * 연락서 [폴더 열기] — 자리 · 인쇄 · 결과 줄 (연락서 조각 2)
 * ============================================================================
 * RepairCaseDetailView 는 서버 액션 사슬을 물고 있어 이 시험 환경에서 통째로 그려 볼 수 없다.
 * 그래서 **자리**는 이웃 시험들과 같은 방법으로 원본을 글자로 읽고, **그려지는 것**은 단추 ·
 * 결과 조각을 직접 렌더해 본다. 누른 뒤의 값은 contact-folder-open.test.ts 가 본다.
 *
 *  · 자리 = 머리 카드의 보고서번호 묶음이 닫힌 뒤, 배지 줄 앞. **정확히 하나.**
 *  · 🔴 인쇄에 안 찍힌다(print:hidden)
 *  · 🔴 Windows 가 아니면 아무것도 그리지 않는다 — 서버 · 첫 렌더도 감춘다
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};

const headerSource = read("src/components/repair-cases/detail/DetailHeader.tsx");
const header = flat(headerSource);
const buttonSource = read("src/components/repair-cases/detail/ContactFolderOpenButton.tsx");
const button = flat(buttonSource);
const moduleSource = read("src/components/repair-cases/detail/contact-folder-open.ts");

describe("자리 — 머리 카드의 보고서번호 묶음 뒤, 배지 줄 앞", () => {
  test("🔴 정확히 하나다", () => {
    assert.equal(header.split("<ContactFolderOpenButton").length - 1, 1, "머리 카드에 단추가 둘 이상이다");
  });

  test("🔴 보고서번호 묶음이 닫힌 뒤, 배지 줄(StatusBadge) 앞", () => {
    const reportNumber = indexOrFail(header, "<ReportNumberEditCell");
    const folder = indexOrFail(header, "<ContactFolderOpenButton");
    const badges = indexOrFail(header, "<StatusBadge");
    assert.ok(reportNumber < folder, "단추가 보고서번호 묶음보다 앞에 있다");
    assert.ok(folder < badges, "단추가 배지 줄보다 뒤에 있다");
    // 보고서번호 묶음(그 줄의 바깥 div)이 **닫힌 뒤**다 — 단추가 그 묶음 안에 들어가 있지 않다.
    assert.ok(
      header.slice(reportNumber, folder).includes("</div> </div>"),
      "보고서번호 묶음이 닫히기 전에 단추가 있다"
    );
  });

  test("수리 건 id 하나만 건넨다 — 상태를 끌어올리지 않는다", () => {
    assert.ok(header.includes("<ContactFolderOpenButton repairCaseId={resolved.id} />"), header);
  });
});

describe("🔴 인쇄에 찍히지 않는다", () => {
  test("단추에 print:hidden 이 있다", () => {
    assert.ok(button.includes("print:hidden"), "print:hidden 이 없다");
    const html = renderToStaticMarkup(createElement(ContactFolderOpenControl, { repairCaseId: "case-1" }));
    assert.ok(html.includes("print:hidden"), html);
    assert.ok(html.includes("data-contact-folder-open"), html);
    assert.ok(html.includes(">폴더 열기</button>"), html);
  });
});

describe("🔴 Windows 가 아니면 단추를 안 그린다", () => {
  test("서버 렌더 · 첫 렌더는 감춘다 — 판단은 마운트 뒤", () => {
    assert.ok(button.includes("const hiddenOnServer = () => false;"));
    assert.ok(button.includes("useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer)"));
    assert.ok(button.includes("if (!isWindows) return null;"));
    assert.equal(renderToStaticMarkup(createElement(ContactFolderOpenButton, { repairCaseId: "case-1" })), "");
  });

  test("판단은 견적서 쪽과 같은 함수 하나로 — 휴대폰 · Mac 은 거짓", () => {
    assert.ok(
      button.includes('typeof navigator !== "undefined" && isWindowsDesktopClient(readQuoteFolderClientPlatform(navigator))')
    );
    const platformOf = (userAgent: string, platform: string) =>
      isWindowsDesktopClient(readQuoteFolderClientPlatform({ userAgent, platform }));
    assert.equal(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32"), true);
    assert.equal(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel"), false);
    assert.equal(platformOf("Mozilla/5.0 (Linux; Android 13)", "Linux armv8l"), false);
  });
});

describe("🔴 페이지를 떠나지 않는다", () => {
  test("도우미 주소는 숨은 iframe 으로 — 페이지를 옮기거나 새 창을 열지 않는다", () => {
    assert.ok(moduleSource.includes('document.createElement("iframe")'));
    for (const leave of ["location.assign(", "location.href =", "location.replace(", "window.open("]) {
      assert.equal(moduleSource.includes(leave), false, `'${leave}' 로 주소를 연다`);
    }
  });

  test("시험할 수 있는 조각은 서버 사슬을 부르지 않는다", () => {
    for (const source of [buttonSource, moduleSource]) {
      assert.equal(source.includes("@/lib/server/"), false, "서버 모듈을 부른다");
      assert.equal(source.includes('"server-only"'), false, "server-only 를 부른다");
      assert.equal(/import \{[^}]*\} from "@\/lib\/db\//.test(source), false, "DB 조회를 값으로 부른다");
    }
  });

  test("🔴 복사 구현을 새로 만들지 않는다 — 견적서 쪽 두 길을 그대로 가져다 쓴다", () => {
    for (const source of [buttonSource, moduleSource]) {
      assert.equal(source.includes("execCommand"), false, "복사 구현이 또 있다");
      assert.equal(/navigator\.clipboard\.writeText/.test(source), false, "복사 구현이 또 있다");
      assert.equal(source.includes("console."), false, "콘솔에 찍는 곳이 있다");
    }
    assert.ok(buttonSource.includes("runQuoteFolderUncPathCopy"));
    assert.ok(buttonSource.includes("runQuoteFolderHelperInstallCommandCopy"));
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 결과 줄 — 다섯 갈래에서 무엇이 나오는가
 * ────────────────────────────────────────────────────────────────────────────
 */
const BACKSLASH = String.fromCharCode(92);
const UNC_PATH = `${BACKSLASH}${BACKSLASH}NAS01${BACKSLASH}연락서`;

function noticeMarkup(outcome: ContactFolderOpenOutcome): string {
  return renderToStaticMarkup(createElement(ContactFolderOpenNotice, { outcome }));
}

/** 만들 길이 있는 자리(수리 건 상세) — 부르는 쪽이 onCreate 를 준 경우. */
function creatableMarkup(outcome: ContactFolderOpenOutcome, creating = false): string {
  return renderToStaticMarkup(
    createElement(ContactFolderOpenNotice, { outcome, creating, onCreate: () => undefined })
  );
}

const openedOutcome = (extra: Partial<ContactFolderOpenOutcome> = {}): ContactFolderOpenOutcome => ({
  kind: "OPENED",
  lines: [{ text: "탐색기로 폴더를 엽니다: D260908 INVENIA", tone: "normal" }],
  offerHelperInstall: true,
  ...extra,
});

describe("결과 줄 — 다섯 갈래", () => {
  test("found(열었다) — 줄 하나와 단추 둘", () => {
    const html = noticeMarkup(openedOutcome({ uncPath: UNC_PATH }));
    assert.ok(html.includes("탐색기로 폴더를 엽니다: D260908 INVENIA"), html);
    assert.ok(html.includes("탐색기가 열리지 않았다면"), html);
    assert.ok(html.includes(">위치 복사</button>"), html);
    assert.ok(html.includes(">설치 명령 복사</button>"), html);
    assert.ok(html.indexOf("위치 복사") < html.indexOf("설치 명령 복사"), "차례가 뒤바뀌었다");
    assert.equal(html.includes("NAS01"), false, "누르기 전에 전체 주소가 화면에 있다");
    // 🔴 링크가 아니다 — 서버가 오류를 주면 그 JSON 페이지로 넘어가 버린다.
    assert.equal(html.includes("href="), false, html);
  });

  test("🔴 uncPath 가 없으면 [위치 복사]는 없다 — 서버에 주소 설정이 없는 경우", () => {
    const html = noticeMarkup(openedOutcome());
    assert.equal(html.includes("위치 복사"), false, html);
    assert.equal(html.includes("data-contact-folder-unc-path"), false, html);
    assert.ok(html.includes(">설치 명령 복사</button>"), html);
  });

  test("도우미가 없어 보이는 결과 — 설치로 이끄는 줄과 단추 둘", () => {
    const html = noticeMarkup({
      kind: "NO_RESPONSE",
      lines: [
        { text: "이 PC 에 폴더 열기 도우미가 없는 것 같습니다 — …", tone: "warning" },
        { text: "열려던 폴더: D260908 INVENIA", tone: "muted" },
      ],
      offerHelperInstall: true,
      uncPath: UNC_PATH,
    });
    assert.ok(html.includes("도우미가 없는 것 같습니다"), html);
    assert.ok(html.includes("data-contact-folder-unc-path"), html);
    assert.ok(html.includes("data-contact-folder-helper-install-command"), html);
  });

  test("🔴 결과를 보여 주기만 하는 자리에는 아무 단추도 없다 — 만들 길(onCreate)이 없으면 그린다고 만들 수 없다", () => {
    const withoutButtons: ContactFolderOpenOutcome[] = [
      // 🔴 만들 수 있다는 표시(offerCreate)가 붙어 있어도, 만들 길이 없으면 단추를 그리지 않는다.
      {
        kind: "NOT_FOUND",
        lines: [{ text: "아직 이 수리 건의 연락서 폴더가 없습니다", tone: "warning" }],
        offerHelperInstall: false,
        offerCreate: true,
      },
      { kind: "DISABLED", lines: [{ text: "연락서 공유폴더 위치가 설정되지 않았습니다", tone: "muted" }], offerHelperInstall: false },
      {
        kind: "MULTIPLE",
        lines: [
          { text: "인수번호가 같은 폴더가 여럿이라 열지 않았습니다", tone: "warning" },
          { text: "D260908 INVENIA(옛것)", tone: "muted" },
        ],
        offerHelperInstall: false,
      },
      { kind: "FAILED", lines: [{ text: "폴더를 열지 못했습니다 — 까닭", tone: "warning" }], offerHelperInstall: false },
    ];
    for (const outcome of withoutButtons) {
      const html = noticeMarkup(outcome);
      assert.equal(html.includes("<button"), false, `${outcome.kind}: ${html}`);
      assert.ok(html.includes(outcome.lines[0].text), html);
    }
  });

  test("여럿일 때 폴더 이름이 그대로 줄로 나온다 — 사람이 정리할 수 있게", () => {
    const html = noticeMarkup({
      kind: "MULTIPLE",
      lines: [
        { text: "인수번호가 같은 폴더가 여럿이라 열지 않았습니다", tone: "warning" },
        { text: "D260908 INVENIA(옛것)", tone: "muted" },
        { text: "D260908 INVENIA 점검요청", tone: "muted" },
      ],
      offerHelperInstall: false,
    });
    assert.ok(html.includes("D260908 INVENIA(옛것)"), html);
    assert.ok(html.includes("D260908 INVENIA 점검요청"), html);
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 [폴더 만들고 열기] — not-found 에만 선다 (조각 5)
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("만들기 단추", () => {
  const notFound: ContactFolderOpenOutcome = {
    kind: "NOT_FOUND",
    lines: [{ text: "아직 이 수리 건의 연락서 폴더가 없습니다", tone: "warning" }],
    offerHelperInstall: false,
    offerCreate: true,
  };

  test("not-found 에서는 단추가 선다 — 인쇄에는 안 찍힌다", () => {
    const html = creatableMarkup(notFound);
    assert.ok(html.includes(">폴더 만들고 열기</button>"), html);
    assert.ok(html.includes("data-contact-folder-create"), html);
    assert.ok(html.includes("print:hidden"), html);
    // 🔴 링크가 아니다 — 눌러도 페이지를 떠나지 않는다.
    assert.equal(html.includes("href="), false, html);
  });

  test("🔴 걷어낸 「비슷한 폴더」 자취가 화면 쪽에 한 글자도 없다 (조각 8)", () => {
    // 2026-10-05 사용자 결정으로 S/N 훑기를 걷어냈다 — 같은 S/N · 모델 · L/N 의 폴더가
    // 있어도 **새 인수번호면 만든다.** 까닭은 lib/domain/contact-folder-naming.ts 머리말.
    for (const gone of ["CANDIDATES", "candidates", "contactFolderCandidatesText"]) {
      assert.equal(moduleSource.includes(gone), false, `흐름에 남아 있다: ${gone}`);
      assert.equal(buttonSource.includes(gone), false, `단추에 남아 있다: ${gone}`);
    }
    // 🔴 안내 문구도 함께 걷어냈다.
    for (const source of [moduleSource, buttonSource]) {
      assert.equal(/붙여\s*주세요/.test(source), false, "걷어낸 안내 문구가 남아 있다");
      assert.equal(source.includes("비슷한 폴더"), false, "걷어낸 말이 남아 있다");
    }
  });

  test("🔴 열린 뒤 · 여럿 · 실패에도 단추가 없다", () => {
    for (const outcome of [
      openedOutcome(),
      {
        kind: "MULTIPLE" as const,
        lines: [{ text: "인수번호가 같은 폴더가 여럿입니다", tone: "warning" as const }],
        offerHelperInstall: false,
      },
      {
        kind: "FAILED" as const,
        lines: [{ text: "폴더를 만들지 못했습니다 — 까닭", tone: "warning" as const }],
        offerHelperInstall: false,
      },
    ]) {
      assert.equal(creatableMarkup(outcome).includes("data-contact-folder-create"), false, outcome.kind);
    }
  });

  test("🔴 만드는 동안에는 잠긴다 — 두 번 눌려 폴더가 둘이 되지 않게", () => {
    const html = creatableMarkup(notFound, true);
    assert.ok(html.includes(">만드는 중…</button>"), html);
    assert.ok(html.includes("disabled"), html);
    assert.ok(html.includes('aria-busy="true"'), html);
  });

  test("🔴 단추를 누르는 자리는 화면에 하나뿐이고, 그 자리에서만 만들기를 부른다", () => {
    // 만들기 흐름을 **부르는** 곳은 이 단추의 onCreate 한 곳이다(가져오기 · 머리말은 뺀다).
    assert.equal(buttonSource.match(/runContactFolderCreateAndOpen\(\{/g)?.length, 1, "부르는 자리가 하나가 아니다");
    assert.ok(button.includes('onCreate={() => void run("create", () => runContactFolderCreateAndOpen({ repairCaseId }))}'));
    // 🔴 화면 쪽에는 지우기 · 이름 바꾸기 길이 없다.
    for (const forbidden of ["method: \"DELETE\"", "method: \"PUT\"", "method: \"PATCH\""]) {
      assert.equal(buttonSource.includes(forbidden), false, forbidden);
      assert.equal(moduleSource.includes(forbidden), false, forbidden);
    }
    // 만들기 요청은 POST 하나뿐이다.
    assert.equal(moduleSource.match(/method: "POST"/g)?.length, 1);
  });
});
