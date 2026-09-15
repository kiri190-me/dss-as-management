import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const moduleSource = read("src/components/quotes/quote-folder-open.ts");

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
  const srcDir = fileURLToPath(new URL("src/", repoUrl));
  const walk = (dir: string, found: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, found);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
    }
    return found;
  };

  test("단추 · 흐름을 부르는 원본은 편집 화면과 제 파일뿐", () => {
    const users = walk(srcDir)
      .filter((file) => /QuoteFolderOpenButton|QuoteFolderOpenControl|runQuoteFolderOpen\b/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(srcDir, file).split(path.sep).join("/"))
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
