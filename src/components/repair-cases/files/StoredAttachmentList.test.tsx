import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import StoredAttachmentList, { previewAffordanceOf } from "./StoredAttachmentList";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";

/**
 * ============================================================================
 * 「미리보기」를 누를 곳이 눈에 보이는가 — 그리고 그것이 어느 길로 여는가
 * ============================================================================
 * 예전에는 조작 칸의 「미리보기」가 PDF 에만 있었다. 사진은 왼쪽 40px 썸네일을
 * 누르면 뷰어가 열렸는데, 그 그림이 눌린다는 사실이 눈에 띄지 않았다
 * (2026-09-04 요구로 사진에도 같은 자리·같은 모양의 단추를 붙였다).
 *
 * 여기서 못박는 것은 넷이다.
 *
 *  1. **사진은 참, PDF 도 참(단, 다른 길), 그 밖의 파일은 거짓.** 사진은 이
 *     화면 위의 뷰어, PDF 는 새 탭이다. 뷰어는 `<img>` 로 그려서 PDF 를 받지
 *     못하므로 이 둘을 한 값으로 뭉치면 좌우로 넘기다 빈 화면을 만난다.
 *  2. **썸네일이 없는 옛 사진도 참.** 두 길 다 원본(`?view=full`)을 여는 것이라
 *     previewPath 와 아무 상관이 없다. 그 사진들이야말로 크게 봐야 확인이 된다.
 *  3. **썸네일 누르기가 그대로 살아 있다.** 단추는 길을 하나 더 낸 것이지
 *     썸네일을 대신하는 것이 아니다 — 두 길이 같은 뷰어를 연다.
 *  4. **세 목록 모두에 붙어 있다.** 표·카드·격자 중 하나라도 빠지면 화면 크기에
 *     따라 단추가 있다 없다 한다(ResponsiveList 가 표와 카드를 재서 고른다).
 *     카드와 격자는 정적 렌더로 그려지지 않으므로(표가 먼저 나오고, 격자는
 *     사람이 눌러야 나온다) 그 둘은 원본을 읽어 확인한다.
 * ============================================================================
 */

const noopRouter = {
  refresh: () => {},
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
} as unknown as AppRouterInstance;

function attachment(overrides: Partial<RepairCaseAttachmentListItem> = {}): RepairCaseAttachmentListItem {
  return {
    id: "att-1",
    category: "INTAKE_PHOTO",
    originalFileName: "외관.jpg",
    storedPath: "2026/09/att-1.jpg",
    previewPath: "2026/09/att-1.thumb.jpg",
    mimeType: "image/jpeg",
    fileSize: 1024,
    checksumSha256: "0".repeat(64),
    malwareScanStatus: "CLEAN",
    description: null,
    uploadedById: "user-1",
    uploadedByName: "홍길동",
    uploadedAt: "2026-09-04T01:02:03.000Z",
    ...overrides,
  };
}

function render(attachments: RepairCaseAttachmentListItem[]): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={noopRouter}>
      <StoredAttachmentList
        attachments={attachments}
        canManage
        onDeleteMany={() => {}}
        isBusy={false}
      />
    </AppRouterContext.Provider>
  );
}

// ───────────────────────────── 판정: 누구에게 무슨 길을 내미는가

test("사진은 이 화면 위의 뷰어로 연다", () => {
  assert.equal(previewAffordanceOf(attachment({ mimeType: "image/jpeg" })), "viewer");
  assert.equal(previewAffordanceOf(attachment({ mimeType: "image/png" })), "viewer");
});

test("🔴 썸네일이 없는 옛 사진도 미리보기를 내민다 — 뷰어는 원본을 그린다", () => {
  assert.equal(previewAffordanceOf(attachment({ previewPath: null })), "viewer");
});

test("🔴 PDF 도 미리보기를 내밀지만 길이 다르다 — 새 탭이지 뷰어가 아니다", () => {
  const pdf = attachment({ mimeType: "application/pdf", originalFileName: "성적서.pdf" });
  assert.equal(previewAffordanceOf(pdf), "new-tab");
  // 뷰어는 <img> 로 그린다. PDF 가 사진 목록에 끼면 좌우로 넘기다 빈 화면이다.
  assert.notEqual(previewAffordanceOf(pdf), "viewer");
});

test("그 밖의 파일에는 미리보기가 없다 — 열어 봐야 보여 줄 것이 없다", () => {
  for (const mimeType of [
    "application/zip",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/gif",
  ]) {
    assert.equal(previewAffordanceOf(attachment({ mimeType })), "none", mimeType);
  }
});

// ───────────────────────────── 그려진 화면: 표 보기

test("사진 줄에 「미리보기」 단추가 나온다 — PDF 것과 같은 글자·같은 이름표", () => {
  const html = render([attachment({ originalFileName: "외관.jpg" })]);
  assert.ok(
    html.includes('aria-label="외관.jpg 미리보기"'),
    "사진에도 미리보기 단추가 있어야 한다"
  );
  // 새 탭이 아니라 이 화면에서 여는 것이므로 <button> 이다. 사진 줄에
  // `?view=full` 로 가는 링크가 생기면 넘기기가 없는 다른 길이 생긴 것이다.
  assert.ok(
    !html.includes('href="/api/attachments/att-1/download?view=full"'),
    "사진의 미리보기는 새 탭 링크가 아니어야 한다"
  );
});

test("🔴 썸네일 누르기가 그대로 살아 있다 — 단추는 길을 하나 더 낸 것이다", () => {
  const html = render([attachment({ originalFileName: "외관.jpg" })]);
  assert.ok(html.includes('aria-label="외관.jpg 크게 보기"'), "썸네일 단추가 사라졌다");
  assert.ok(html.includes('aria-label="외관.jpg 미리보기"'), "미리보기 단추가 없다");
});

test("🔴 썸네일이 없는 옛 사진 줄에도 단추가 그려진다", () => {
  const html = render([attachment({ originalFileName: "옛사진.jpg", previewPath: null })]);
  assert.ok(html.includes('aria-label="옛사진.jpg 미리보기"'), "previewPath 로 단추를 가리면 안 된다");
});

test("🔴 PDF 의 미리보기는 그대로 새 탭이다", () => {
  const html = render([
    attachment({ id: "pdf-1", originalFileName: "성적서.pdf", mimeType: "application/pdf", previewPath: null }),
  ]);
  assert.ok(
    html.includes('href="/api/attachments/pdf-1/download?view=full"'),
    "PDF 는 원본을 새 탭에서 연다"
  );
  assert.ok(html.includes('target="_blank"'), "PDF 는 새 탭에서 열려야 한다");
  // PDF 는 사진이 아니다 — 썸네일도 뷰어도 PDF 를 그리지 않는다.
  assert.ok(!html.includes("성적서.pdf 크게 보기"), "PDF 에 사진 뷰어를 붙이면 안 된다");
});

test("사진도 PDF 도 아닌 파일에는 미리보기가 없다", () => {
  const html = render([
    attachment({ id: "zip-1", originalFileName: "로그.zip", mimeType: "application/zip", previewPath: null }),
  ]);
  assert.ok(!html.includes("로그.zip 미리보기"), "열어 봐야 보여 줄 것이 없는 파일이다");
  assert.ok(!html.includes("로그.zip 크게 보기"), "사진이 아니므로 썸네일도 눌리지 않는다");
  assert.ok(html.includes("내려받기"), "내려받기는 그대로여야 한다");
});

// ───────────────────────────── 세 목록 모두

/** 주석은 걷어내고 읽는다 — 우리가 보려는 것은 실제로 그리는 코드뿐이다. */
function readSource(url: URL): string {
  return readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

test("🔴 표·카드·격자 세 목록 모두에 붙어 있다", () => {
  const source = readSource(new URL("./StoredAttachmentList.tsx", import.meta.url));
  const uses = source.match(/<ImagePreviewButton/g) ?? [];
  assert.equal(
    uses.length,
    3,
    "하나라도 빠지면 화면 크기에 따라 단추가 있다 없다 한다(표·카드·격자)"
  );
  // 세 자리 모두 썸네일이 부르는 그 함수를 그대로 부른다 — 새 길을 만들지 않는다.
  const opens = source.match(/onOpen=\{openViewer\}/g) ?? [];
  assert.equal(opens.length, 6, "썸네일 셋과 미리보기 단추 셋이 같은 openViewer 를 부른다");
});
