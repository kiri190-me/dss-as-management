import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ImprovementRequestScreenshotStrip,
  ScreenshotDeleteDialog,
  ScreenshotTrashNote,
  StagedScreenshotList,
} from "./ImprovementRequestScreenshots";
import type { ImprovementRequestScreenshot } from "@/lib/db/queries/improvement-requests";

/**
 * ============================================================================
 * 개선 요청 스크린샷 — 누구에게 무엇이 그려지는가
 * ============================================================================
 * ImprovementRequestsScreen 은 서버 액션 모듈을 부르고, 그 사슬 끝에 `server-only`
 * 가 있어 이 시험 환경에서 통째로 그려 볼 수 없다. 그래서 조각
 * (ImprovementRequestScreenshots.tsx)을 따로 그려 보고, 화면이 조각에 무엇을
 * 넘기는지는 원본을 읽어 확인한다(DatabaseWorkHistoryScreen.test.tsx 와 같은 방식).
 * ============================================================================
 */

function shots(count: number): ImprovementRequestScreenshot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `shot-${index + 1}`,
    originalFileName: `화면-${index + 1}.png`,
    hasPreview: index % 2 === 0,
    uploadedAt: "2026-09-13T01:02:03.000Z",
  }));
}

function renderStrip(screenshots: ImprovementRequestScreenshot[], canChange: boolean): string {
  return renderToStaticMarkup(
    <ImprovementRequestScreenshotStrip
      screenshots={screenshots}
      canChange={canChange}
      disabled={false}
      progressText={null}
      onAddFiles={() => {}}
      onRequestDelete={() => {}}
    />
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

// ───────────────────────────── 썸네일 줄

test("스크린샷이 있는 줄에 view=thumb 썸네일이 그려진다 — lazy, alt 는 원래 이름", () => {
  const html = renderStrip(shots(2), false);
  assert.ok(html.includes('src="/api/attachments/shot-1/download?view=thumb"'), html);
  assert.ok(html.includes('src="/api/attachments/shot-2/download?view=thumb"'), html);
  assert.ok(html.includes('alt="화면-1.png"'), html);
  assert.equal(count(html, 'loading="lazy"'), 2);
  // 썸네일을 누르면 크게 보기가 열린다 — 누를 수 있는 단추다.
  assert.ok(html.includes('aria-label="화면-1.png 크게 보기"'), html);
  // 폭이 좁으면 줄바꿈한다(가로 스크롤을 만들지 않는다).
  assert.ok(html.includes("flex-wrap"), "썸네일 줄은 줄바꿈해야 한다");
});

test("🔴 권한 있는 줄에만 [지우기]와 [스크린샷 추가]가 보인다", () => {
  const html = renderStrip(shots(2), true);
  assert.equal(count(html, ">지우기<"), 2, "썸네일마다 [지우기]");
  assert.ok(html.includes(">스크린샷 추가<"), "5장 미만이면 [스크린샷 추가]");
  assert.ok(html.includes('type="file"'), "파일 고르기 칸이 있어야 한다");
  assert.ok(html.includes('accept="image/png,image/jpeg"'), html);
  assert.ok(html.includes("스크린샷 2/5"), html);
});

test("🔴 5장이면 [스크린샷 추가]가 없다 — [지우기]는 남는다", () => {
  const html = renderStrip(shots(5), true);
  assert.ok(!html.includes("스크린샷 추가"), "5장이 찼는데 추가 단추가 있다");
  assert.ok(!html.includes('type="file"'), "5장이 찼는데 파일 칸이 있다");
  assert.equal(count(html, ">지우기<"), 5);
});

test("🔴 권한이 없으면 썸네일만 보인다 — [지우기] · [스크린샷 추가] 없음", () => {
  const html = renderStrip(shots(3), false);
  assert.equal(count(html, "?view=thumb"), 3);
  assert.ok(!html.includes("지우기"), "권한 없는 사람에게 [지우기]가 보인다");
  assert.ok(!html.includes("스크린샷 추가"), "권한 없는 사람에게 [스크린샷 추가]가 보인다");
  assert.ok(!html.includes('type="file"'));
});

test("스크린샷이 없으면 — 권한이 없으면 아무것도, 있으면 [스크린샷 추가]만", () => {
  assert.equal(renderStrip([], false), "");
  const html = renderStrip([], true);
  assert.ok(html.includes(">스크린샷 추가<"), html);
  assert.ok(!html.includes("<img"), html);
});

test("줄에 올리는 중이면 진행 문구가 보인다", () => {
  const html = renderToStaticMarkup(
    <ImprovementRequestScreenshotStrip
      screenshots={shots(1)}
      canChange
      disabled
      progressText="스크린샷 올리는 중 1/2…"
      onAddFiles={() => {}}
      onRequestDelete={() => {}}
    />
  );
  assert.ok(html.includes("스크린샷 올리는 중 1/2…"), html);
});

// ───────────────────────────── 확인창 · 미리보기

test("스크린샷 지우기 확인창은 「첨부 휴지통으로 옮깁니다」를 보인다", () => {
  const html = renderToStaticMarkup(
    <ScreenshotDeleteDialog screenshot={shots(1)[0]} isSubmitting={false} onConfirm={() => {}} onCancel={() => {}} />
  );
  assert.ok(html.includes("<dialog"), "native <dialog> 여야 한다");
  assert.ok(html.includes("첨부 휴지통으로 옮깁니다"), html);
  assert.ok(html.includes("화면-1.png"), "무엇을 지우는지 보여야 한다");
});

test("🔴 글 삭제 확인창에 스크린샷 장 수가 나온다 — 없으면 그 줄이 없다", () => {
  assert.ok(
    renderToStaticMarkup(<ScreenshotTrashNote count={3} />).includes("붙은 스크린샷 3장은 첨부 휴지통으로 옮겨집니다")
  );
  assert.equal(renderToStaticMarkup(<ScreenshotTrashNote count={0} />), "");
});

test("등록 전 미리보기 — 모아 둔 장마다 그림과 [빼기]", () => {
  const file = new File([new Uint8Array(4)], "스크린샷-20260914-000405-1.png", { type: "image/png" });
  const html = renderToStaticMarkup(
    <StagedScreenshotList
      staged={[{ key: "staged-1", file, previewUrl: "blob:http://localhost/abc" }]}
      disabled={false}
      onRemove={() => {}}
    />
  );
  assert.ok(html.includes('src="blob:http://localhost/abc"'), html);
  assert.ok(html.includes(">빼기<"), html);
  assert.equal(
    renderToStaticMarkup(<StagedScreenshotList staged={[]} disabled={false} onRemove={() => {}} />),
    ""
  );
});

// ───────────────────────────── 화면이 조각에 넘기는 것 (원본 읽기)

/** 주석은 걷어내고 읽는다 — 보려는 것은 실제로 그리는 코드뿐이다. */
function readSource(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const screenSource = readSource("./ImprovementRequestsScreen.tsx");

test("🔴 화면은 줄마다 도메인 판정으로 권한을 정해 조각에 넘긴다", () => {
  assert.match(
    screenSource,
    /const mayChangeScreenshots =\s*canWrite &&\s*canChangeImprovementRequestScreenshots\(/,
    "canWrite && canChangeImprovementRequestScreenshots(...) 여야 한다"
  );
  assert.ok(screenSource.includes("canChange={mayChangeScreenshots}"), "판정을 조각에 그대로 넘겨야 한다");
});

test("🔴 글 삭제 확인창이 그 글의 스크린샷 수를 넘긴다", () => {
  assert.ok(
    screenSource.includes("<ScreenshotTrashNote count={target.screenshots.length} />"),
    "DeleteImprovementRequestDialog 에 스크린샷 줄이 없다"
  );
});

test("새 글 · 고치기 두 입력칸이 붙여넣기를 받는다", () => {
  assert.equal(count(screenSource, "onPaste={"), 2);
});

test("🔴 파일 이름과 이미지를 console 에 싣지 않는다", () => {
  for (const relative of [
    "./ImprovementRequestsScreen.tsx",
    "./ImprovementRequestScreenshots.tsx",
    "./improvement-request-screenshot-files.ts",
  ]) {
    assert.ok(!/console\./.test(readSource(relative)), `${relative} 에 console 호출이 있다`);
  }
});
