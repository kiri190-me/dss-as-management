import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuoteFolderOpenNotice } from "./QuoteFolderOpenButton";
import type { QuoteFolderOpenOutcome } from "./quote-folder-open";

/**
 * ============================================================================
 * 견적서 ④b — [폴더 열기]가 편집 화면 머리 한 곳에만 있는가
 * ============================================================================
 * QuoteEditForm 은 서버 액션을 부르는 클라이언트 컴포넌트라 이 시험 환경에서 그려 볼 수 없다
 * (`server-only`). 그래서 이웃 시험(quote-issue-screens.test.ts)과 같은 방법으로 원본을 글자로
 * 읽는다. 단추가 무엇을 그리는지는 QuoteFolderOpenButton.test.tsx, 누른 뒤의 흐름은
 * quote-folder-open.test.ts 가 값으로 본다.
 *
 *  · 자리 = 편집 화면 머리의 [견적서 받기] 곁, 저장된 장에서만(사용자 결정 2026-09-16)
 *  · 결과 줄 = 받기 결과와 같은 자리(머리 아래)
 *  · 🔴 처음 렌더는 감춘다 — Windows 판단은 마운트 뒤
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};

const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));
const button = flat(read("src/components/quotes/QuoteFolderOpenButton.tsx"));
const buttonSource = read("src/components/quotes/QuoteFolderOpenButton.tsx");
const moduleSource = read("src/components/quotes/quote-folder-open.ts");

const srcDir = fileURLToPath(new URL("src/", repoUrl));
const walkSources = (dir: string, found: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
};
const relativeToSrc = (file: string) => path.relative(srcDir, file).split(path.sep).join("/");
/**
 * 주석을 뺀 원본 — 「무엇을 부르는가」를 볼 때 쓴다. 머리말은 없앤 길을 **일부러** 설명하므로
 * (「설치 파일 통로는 살아 있지만 화면이 부르지 않는다」) 글자만 찾으면 헛걸린다.
 */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("편집 화면 머리 — [견적서 받기] 곁", () => {
  const BUTTON = "{savedQuote && ( <QuoteFolderOpenButton quoteId={savedQuote.id}";

  test("🔴 저장된 장에서만 — savedQuote 가 있을 때 그 id 로", () => {
    assert.ok(form.includes(BUTTON), "저장된 장 갈래 안에 없다");
    assert.equal(form.split("<QuoteFolderOpenButton").length - 1, 1, "편집 화면에 단추가 둘 이상이다");
  });

  test("머리 단추 줄 안 — [견적서 받기] 바로 다음, [취소] 앞", () => {
    const header = sliceBetween(form, "<h1", "{/* [견적서 받기] 결과");
    const issue = indexOrFail(header, "<QuoteIssueButton");
    const folder = indexOrFail(header, "<QuoteFolderOpenButton");
    const cancel = indexOrFail(header, "router.push(returnHref ?? \"/quotes\")");
    assert.ok(issue < folder && folder < cancel, "자리가 [견적서 받기] 곁이 아니다");
  });

  test("🔴 저장 중 · 충돌이면 잠그고, 저장하지 않은 변경은 막지 않는다", () => {
    const props = sliceBetween(form, "<QuoteFolderOpenButton", "/>");
    assert.ok(props.includes("disabled={disabled}"), props);
    assert.ok(!props.includes("hasUnsavedChanges"), "폴더 열기가 저장하지 않은 변경에 막힌다");
    assert.ok(props.includes("onOutcome={setFolderOpenOutcome}"), props);
    assert.ok(form.includes("const disabled = isSubmitting || isConflict;"));
  });

  test("결과 줄은 받기 결과와 같은 자리 — 머리 아래, 받기 결과 다음, 저장 오류 앞", () => {
    assert.ok(form.includes("useState<QuoteFolderOpenOutcome | null>(null)"));
    const issueNotice = indexOrFail(form, "<QuoteIssueNoticeLines lines={issueNotice}");
    const notice = indexOrFail(form, "{folderOpenOutcome && ( <div className=\"flex justify-end\"> <QuoteFolderOpenNotice outcome={folderOpenOutcome}");
    const submitError = indexOrFail(form, "{submitError && (");
    assert.ok(issueNotice < notice && notice < submitError, "결과 자리가 머리 아래가 아니다");
  });
});

describe("🔴 한 곳에만 — 목록 · 인쇄 미리보기 · 받기 결과 알림에는 없다", () => {
  test("단추 · 흐름을 부르는 원본은 편집 화면과 제 파일뿐", () => {
    const users = walkSources(srcDir)
      .filter((file) => /QuoteFolderOpenButton|QuoteFolderOpenControl|runQuoteFolderOpen\b/.test(readFileSync(file, "utf8")))
      .map(relativeToSrc)
      .sort();
    assert.deepEqual(users, [
      "components/quotes/QuoteEditForm.tsx",
      "components/quotes/QuoteFolderOpenButton.tsx",
      "components/quotes/quote-folder-open.ts",
    ]);
  });
});

describe("🔴 처음 렌더는 감춘다 · 페이지를 떠나지 않는다", () => {
  test("Windows 판단은 useSyncExternalStore — 서버 스냅샷은 「아니다」, 아니면 아무것도 그리지 않는다", () => {
    assert.ok(button.includes("const hiddenOnServer = () => false;"));
    assert.ok(button.includes("useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer)"));
    assert.ok(button.includes("if (!isWindows) return null;"));
    assert.ok(
      button.includes(
        'typeof navigator !== "undefined" && isWindowsDesktopClient(readQuoteFolderClientPlatform(navigator))'
      )
    );
  });

  test("도우미 주소는 숨은 iframe 으로 — 페이지 자체를 옮기거나 새 창을 열지 않는다", () => {
    assert.ok(moduleSource.includes('document.createElement("iframe")'));
    for (const leave of ["location.assign(", "location.href =", "location.replace(", "window.open("]) {
      assert.ok(!moduleSource.includes(leave), `'${leave}' 로 주소를 연다`);
    }
  });

  test("시험할 수 있는 조각은 서버 사슬을 부르지 않는다", () => {
    for (const file of ["src/components/quotes/QuoteFolderOpenButton.tsx", "src/components/quotes/quote-folder-open.ts"]) {
      const source = read(file);
      assert.ok(!source.includes("@/lib/server/"), `${file} 가 서버 모듈을 부른다`);
      assert.ok(!source.includes('"server-only"'), `${file} 가 server-only 를 부른다`);
      assert.ok(!/import \{[^}]*\} from "@\/lib\/db\//.test(source), `${file} 가 DB 조회를 값으로 부른다`);
    }
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ④c — 결과 줄에 붙는 복사 단추 둘 · 🔴 설치 파일을 주지 않는다
 * ────────────────────────────────────────────────────────────────────────────
 * 설치 파일(.cmd)은 Windows 스마트 앱 컨트롤이 막는다. 그 파일을 주는 길을 화면에서 통째로
 * 떼고(사용자 결정 2026-09-16), [위치 복사](도우미를 건너뛴다)와 [설치 명령 복사](파일 없이
 * 설치한다) 둘만 낸다. 누른 뒤의 값은 quote-folder-open.test.ts 가 본다 — 여기서는 **어디에
 * 나오는지**와 **설치 파일이 정말로 사라졌는지**만.
 */
const UNC_PATH = `${String.fromCharCode(92, 92)}NAS01${String.fromCharCode(92)}견적서보관`;

function noticeMarkup(outcome: QuoteFolderOpenOutcome): string {
  return renderToStaticMarkup(createElement(QuoteFolderOpenNotice, { outcome }));
}

const openedOutcome = (extra: Partial<QuoteFolderOpenOutcome> = {}): QuoteFolderOpenOutcome => ({
  kind: "OPENED",
  lines: [{ text: "탐색기로 폴더를 엽니다: 2026년 견적서/DSS 2026-077", tone: "normal" }],
  offerHelperInstall: true,
  ...extra,
});

describe("④c 폴더를 찾았을 때 — 단추 둘", () => {
  test("uncPath 가 있으면 둘이 나란히 — 곁말 · 단추, 링크가 아니다", () => {
    const html = noticeMarkup(openedOutcome({ uncPath: UNC_PATH }));
    assert.ok(html.includes("탐색기가 열리지 않았다면"), html);
    assert.ok(html.includes(">위치 복사</button>"), html);
    assert.ok(html.includes(">설치 명령 복사</button>"), html);
    assert.ok(html.includes("data-quote-folder-unc-path"), html);
    assert.ok(html.includes("data-quote-folder-helper-install-command"), html);
    assert.ok(html.indexOf("위치 복사") < html.indexOf("설치 명령 복사"), "차례가 뒤바뀌었다");
    assert.ok(!html.includes("NAS01"), "누르기 전에 전체 주소가 화면에 있다");
    assert.ok(!html.includes("href="), "링크다 — 편집 화면을 떠난다");
  });

  test("🔴 uncPath 가 없으면 [위치 복사]는 없다 — 서버에 공유폴더 주소 설정이 없는 경우", () => {
    const html = noticeMarkup(openedOutcome());
    assert.ok(!html.includes("위치 복사"), html);
    assert.ok(!html.includes("data-quote-folder-unc-path"), html);
    assert.ok(html.includes(">설치 명령 복사</button>"), html);
  });

  test("도우미가 없어 보이는 결과에서도 단추가 난다", () => {
    const html = noticeMarkup({
      kind: "NO_RESPONSE",
      lines: [{ text: "이 PC 에 폴더 열기 도우미가 없는 것 같습니다 — …", tone: "warning" }],
      offerHelperInstall: true,
      uncPath: UNC_PATH,
    });
    assert.ok(html.includes(">위치 복사</button>"), html);
    assert.ok(html.includes(">설치 명령 복사</button>"), html);
  });

  test("폴더를 찾지 못한 결과에는 아무 단추도 없다", () => {
    const html = noticeMarkup({
      kind: "NOT_FOUND",
      lines: [{ text: "아직 공유폴더에 이 견적서의 폴더가 없습니다", tone: "warning" }],
      offerHelperInstall: false,
    });
    assert.ok(!html.includes("<button"), html);
  });
});

describe("🔴 ④c — 화면은 설치 파일을 주지 않는다", () => {
  test("결과 자리 어디에도 [설치 파일 다시 받기]가 없다", () => {
    const rendered = [
      noticeMarkup(openedOutcome({ uncPath: UNC_PATH })),
      noticeMarkup(openedOutcome()),
      noticeMarkup({ kind: "NO_RESPONSE", lines: [{ text: "…", tone: "warning" }], offerHelperInstall: true }),
      noticeMarkup({ kind: "NOT_FOUND", lines: [{ text: "…", tone: "warning" }], offerHelperInstall: false }),
    ];
    for (const html of rendered) {
      for (const gone of ["설치 파일", "다시 받기", "차단 해제", "data-quote-folder-helper-installer"]) {
        assert.ok(!html.includes(gone), `화면에 '${gone}' 가 남아 있다: ${html}`);
      }
    }
  });

  test("🔴 화면 쪽 원본 어디에도 설치 파일 통로를 부르는 곳 · 파일을 저장하는 곳이 없다", () => {
    const callers = walkSources(srcDir)
      .filter((file) => relativeToSrc(file).startsWith("components/"))
      .filter((file) => /quote-folder-helper\/installer/.test(withoutComments(readFileSync(file, "utf8"))))
      .map(relativeToSrc)
      .sort();
    assert.deepEqual(callers, [], "화면 코드가 설치 파일 통로를 부른다");

    for (const source of [withoutComments(moduleSource), withoutComments(buttonSource)]) {
      for (const gone of ["quote-folder-helper/installer", "saveBlobAsDownload", ".blob(", "Content-Disposition"]) {
        assert.ok(!source.includes(gone), `설치 파일을 받던 자취가 남았다: ${gone}`);
      }
    }
  });

  test("🔴 서버 통로는 그대로 살아 있다 — 화면에서만 뗐다", () => {
    const route = read("src/app/api/quote-folder-helper/installer/route.ts");
    assert.ok(route.includes("export async function GET"), "설치 파일 통로가 사라졌다");
    assert.ok(route.includes("buildQuoteFolderHelperInstaller"), route.slice(0, 200));
  });
});

describe("🔴 ④c — 복사는 공용 모듈 하나로", () => {
  test("새 코드는 components/common/copy-text 를 부르고, 제 복사 구현을 두지 않는다", () => {
    assert.ok(moduleSource.includes('import { copyText } from "@/components/common/copy-text";'), "공용 모듈을 부르지 않는다");
    for (const source of [moduleSource, buttonSource]) {
      assert.ok(!source.includes("execCommand"), "새 코드에 복사 구현이 또 있다");
      assert.ok(!/navigator\.clipboard\.writeText/.test(source), "새 코드에 복사 구현이 또 있다");
    }
  });

  test("네 번째 복사 구현을 만들지 않았다 — 공용 모듈과 먼저 있던 화면 셋뿐", () => {
    const copiers = walkSources(srcDir)
      .filter((file) => /navigator\.clipboard\.writeText\(/.test(readFileSync(file, "utf8")))
      .map(relativeToSrc)
      .sort();
    // 🔴 아래 셋을 공용 모듈로 모으는 일은 회귀 위험이 있어 별도 조각으로 남겼다(2026-09-16).
    assert.deepEqual(copiers, [
      "components/common/copy-text.ts",
      "components/customer-portal/CustomerLinkAddress.tsx",
      "components/repair-cases/detail/edit/EditSectionActions.tsx",
      "components/settings/ImprovementRequestsScreen.tsx",
    ]);
  });

  test("🔴 설치 명령 본문을 콘솔에 찍지 않는다 — 사내 공유폴더 주소가 들어 있다", () => {
    for (const source of [moduleSource, buttonSource, read("src/components/common/copy-text.ts")]) {
      assert.ok(!source.includes("console."), "콘솔에 찍는 곳이 있다");
    }
  });
});
