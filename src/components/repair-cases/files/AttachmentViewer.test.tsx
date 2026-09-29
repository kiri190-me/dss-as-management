import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import AttachmentViewer, {
  IDENTITY_TRANSFORM,
  SWIPE_THRESHOLD_PX,
  VIEWER_DOUBLE_TAP_SCALE,
  VIEWER_MAX_SCALE,
  VIEWER_MIN_SCALE,
  canSwipeNavigate,
  clampViewerPan,
  clampViewerScale,
  flipViewerAcrossScreenX,
  flipViewerAcrossScreenY,
  goToViewerIndex,
  isViewerTransformIdentity,
  isViewerZoomed,
  panViewerBy,
  rotateViewer,
  stepViewerIndex,
  swipeViewerIndex,
  toggleViewerZoom,
  attachmentFingerprintSuffix,
  viewerDownloadUrl,
  viewerFullUrl,
  viewerThumbUrl,
  viewerTransformCss,
  zoomViewerBy,
  zoomViewerTo,
} from "./AttachmentViewer";
import type { ViewerState, ViewerTransform } from "./AttachmentViewer";
import type { RepairCaseAttachmentListItem } from "@/lib/db/queries/attachments";

/**
 * ============================================================================
 * 크게 보기 — 확대·회전·아래 썸네일 줄
 * ============================================================================
 * 여기서 못박는 것은 다섯이다. 전부 실제로 어긋나기 쉬운 자리다.
 *
 *  1. **확대 중에는 스와이프가 먹지 않는다.** 키운 사진의 오른쪽을 보려고 왼쪽
 *     으로 끄는 것과, 다음 장으로 넘기려고 미는 것은 손가락만 보면 같다. 둘 다
 *     받으면 사진 속을 돌아다닐 수가 없다.
 *  2. **넘기면 회전·배율이 초기화된다.** 돌려서 본 것은 그 사진의 사정이다.
 *  3. **아래 썸네일 줄은 `?view=thumb`이다.** 여기에 `full` 을 쓰면 한 건의 사진
 *     전부가 원본으로 한꺼번에 내려온다 — 크게 보기가 480px 썸네일이 되었던
 *     사고(파일 머리말)의 정반대 방향으로 같은 실수를 하는 것이다.
 *  4. **한 장이면 썸네일 줄을 그리지 않는다.** 자기 사진 한 장을 밑에 또 깔면
 *     사진 볼 자리만 좁아진다.
 *  5. **두 주소에 파일의 지문(체크섬 앞 12자)이 `v` 로 붙는다**(2026-09-29).
 *     이것이 없어서 「돌린 대로 저장」 뒤에도 이 화면의 그림이 옛 방향으로 남아
 *     있었다 — 응답이 `no-store` 라도 이미 그려 놓은 `<img>` 는 주소가 같으면
 *     다시 받지 않는다. 지문을 붙이는 규칙은 목록의 작은 그림과 **같은 함수**
 *     (attachmentFingerprintSuffix)여야 하고, 그것도 여기서 못박는다.
 *
 * 🔴 **5번이 3번을 무르지 않는다.** 지문이 붙어도 아래 줄은 `thumb`, 크게 보는
 *    자리는 `full` 이다 — 그 둘이 갈려 있는지를 아래에서 여전히 글자로 본다.
 *
 * 손가락도 브라우저도 없이 이것을 못박을 수 있는 까닭은, 화면에서 벌어지는 일을
 * 전부 "지금 상태 → 다음 상태" 순수 함수로 갈라 두었기 때문이다. 그려진 화면
 * 쪽은 renderToStaticMarkup 으로 주소와 이름표만 확인한다.
 * ============================================================================
 */

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

function render(
  attachments: RepairCaseAttachmentListItem[],
  initialIndex = 0,
  onShrinkDownload?: (item: RepairCaseAttachmentListItem) => void
): string {
  return renderToStaticMarkup(
    <AttachmentViewer
      items={attachments}
      initialIndex={initialIndex}
      onClose={() => {}}
      onShrinkDownload={onShrinkDownload}
    />
  );
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * 🔴 `renderToStaticMarkup` 은 속성값의 `&` 를 `&amp;` 로 적는다(HTML 규칙대로다).
 * 주소에 지문이 `…?view=thumb&v=…` 로 붙으면서 그린 글자와 주소 문자열이 더는
 * 같지 않게 되었다 — 주소로 견주는 자리에서만 되돌려 놓는다. 그린 화면이 아니라
 * **주소가 맞는가**를 보려는 것이므로 이쪽이 뜻에 맞다.
 */
function withRawAmpersands(html: string): string {
  return html.replace(/&amp;/g, "&");
}

/** 돌리고 키우고 옮겨 둔 상태 — "건드려 놓은 것"의 대표. */
function dirtyTransform(): ViewerTransform {
  return {
    orientation: { rotate: 90, flipX: true, flipY: false },
    scale: 3,
    offsetX: 120,
    offsetY: -40,
  };
}

function stateOf(index: number, transform: ViewerTransform): ViewerState {
  return { index, transform };
}

// ───────────────────────────── 1. 확대와 스와이프가 부딪히지 않는다

test("🔴 확대 중에는 아무리 밀어도 넘어가지 않는다", () => {
  const zoomed = stateOf(1, { ...IDENTITY_TRANSFORM, scale: 2.5 });
  assert.equal(canSwipeNavigate(zoomed.transform), false);
  // 문턱을 한참 넘겨도, 양쪽 어느 방향이어도 자리가 그대로다.
  assert.equal(swipeViewerIndex(zoomed, -400, 3).index, 1);
  assert.equal(swipeViewerIndex(zoomed, 400, 3).index, 1);
  // 상태 객체 자체가 그대로여야 한다 — 다시 그리면 끌던 손이 끊긴다.
  assert.equal(swipeViewerIndex(zoomed, -400, 3), zoomed);
});

test("1배일 때는 스와이프가 그대로 산다 — 없앤 기능이 아니다", () => {
  const plain = stateOf(1, IDENTITY_TRANSFORM);
  assert.equal(canSwipeNavigate(plain.transform), true);
  assert.equal(swipeViewerIndex(plain, -SWIPE_THRESHOLD_PX, 3).index, 2, "왼쪽으로 밀면 다음 장");
  assert.equal(swipeViewerIndex(plain, SWIPE_THRESHOLD_PX, 3).index, 0, "오른쪽으로 밀면 앞 장");
});

test("문턱보다 적게 움직인 것은 넘김이 아니다 — 누르다 손이 흔들린 것이다", () => {
  const plain = stateOf(1, IDENTITY_TRANSFORM);
  assert.equal(swipeViewerIndex(plain, SWIPE_THRESHOLD_PX - 1, 3).index, 1);
  assert.equal(swipeViewerIndex(plain, -(SWIPE_THRESHOLD_PX - 1), 3).index, 1);
});

test("확대 판정에 소수 오차가 끼어들지 않는다", () => {
  assert.equal(isViewerZoomed(IDENTITY_TRANSFORM), false);
  assert.equal(isViewerZoomed({ ...IDENTITY_TRANSFORM, scale: 1 + 1e-9 }), false, "반올림 찌꺼기");
  assert.equal(isViewerZoomed({ ...IDENTITY_TRANSFORM, scale: 1.05 }), true);
});

// ───────────────────────────── 2. 넘기면 초기화된다

test("🔴 사진을 넘기면 회전도 배율도 초기화된다", () => {
  const before = stateOf(0, dirtyTransform());
  const after = stepViewerIndex(before, 1, 3);
  assert.equal(after.index, 1);
  assert.deepEqual(after.transform, IDENTITY_TRANSFORM);
  assert.equal(isViewerTransformIdentity(after.transform), true);
});

test("🔴 썸네일을 눌러 건너뛸 때도 초기화된다", () => {
  const after = goToViewerIndex(stateOf(0, dirtyTransform()), 2, 3);
  assert.equal(after.index, 2);
  assert.deepEqual(after.transform, IDENTITY_TRANSFORM);
});

test("끝에서는 더 가지 않고, 그대로일 때는 돌려 놓은 것을 건드리지 않는다", () => {
  const first = stateOf(0, dirtyTransform());
  assert.equal(stepViewerIndex(first, -1, 3), first, "첫 장에서 앞으로 가려 해도 그대로");
  const last = stateOf(2, dirtyTransform());
  assert.equal(stepViewerIndex(last, 1, 3), last, "끝 장에서 다음으로 가려 해도 그대로");
  // 자리가 그대로면 변환도 살아 있어야 한다 — 화살표를 헛눌렀다고 돌린 것이
  // 풀리면 다시 돌려야 한다.
  assert.deepEqual(last.transform, dirtyTransform());
});

// ───────────────────────────── 3·4. 아래 썸네일 줄

test("🔴 썸네일 줄은 ?view=thumb 을 쓴다 — 원본은 크게 보는 자리 하나뿐이다", () => {
  // 지문이 붙고 나서도 이 판정이 살아 있어야 하므로, 사진마다 체크섬을 다르게
  // 두어 「주소가 섞였다」와 「지문만 같다」가 구별되게 한다.
  const items = [
    attachment({ id: "a1", originalFileName: "앞.jpg", checksumSha256: "1".repeat(64) }),
    attachment({ id: "a2", originalFileName: "뒤.jpg", checksumSha256: "2".repeat(64) }),
    attachment({ id: "a3", originalFileName: "옆.jpg", checksumSha256: "3".repeat(64) }),
  ];
  const html = withRawAmpersands(render(items));

  assert.equal(occurrences(html, "download?view=thumb"), 3, "사진마다 썸네일이 하나씩");
  assert.ok(html.includes(viewerThumbUrl(items[1])), "썸네일 주소가 thumb 이어야 한다");

  // 🔴 원본은 딱 한 장 — 지금 보는 것뿐이다. 썸네일 줄이 full 로 새면 원본
  // 수십 장이 한꺼번에 내려온다.
  //
  // 세는 자리를 `src="…"` 로 못박는 까닭: React 19 는 서버 렌더에서 지금 보는
  // 사진에 <link rel="preload" as="image"> 를 하나 얹는다. 그래서 주소만 세면
  // a1 이 두 번 나온다(미리 받기 + <img>). 썸네일들은 loading="lazy" 라 그
  // 목록에 얹히지 않는다 — 원본을 미리 받는 것은 크게 보는 한 장뿐이다.
  assert.equal(occurrences(html, `src="${viewerFullUrl(items[0])}"`), 1, "크게 보는 자리는 원본");
  for (const item of [items[1], items[2]]) {
    assert.ok(
      !html.includes(viewerFullUrl(item)),
      `지금 보지 않는 ${item.id} 가 원본으로 샜다 — 썸네일 줄은 thumb 이어야 한다`
    );
  }
  // 🔴 지문이 붙었다고 `view` 가 흐려지면 안 된다 — 아래 줄에 full 이 하나라도
  //    섞이면 원본 수십 장이 한꺼번에 내려온다.
  assert.equal(occurrences(html, "view=full"), 2, "크게 보는 한 장(미리 받기 + <img>)뿐이다");
});

test("🔴 사진이 한 장이면 썸네일 줄을 아예 안 그린다", () => {
  const only = attachment({ id: "only", originalFileName: "한장.jpg" });
  const html = withRawAmpersands(render([only]));
  assert.ok(!html.includes("view=thumb"), "한 장짜리에 썸네일 줄이 생겼다");
  assert.ok(!html.includes("이 건의 사진 목록"), "빈 줄이 자리만 차지한다");
  assert.ok(html.includes(viewerFullUrl(only)), "사진 자체는 그대로 크게 보인다");
});

test("지금 보는 것이 썸네일 줄에 표시된다 — 누를 곳도 하나씩 있다", () => {
  const html = render(
    [
      attachment({ id: "a1", originalFileName: "앞.jpg" }),
      attachment({ id: "a2", originalFileName: "뒤.jpg" }),
    ],
    1
  );
  assert.equal(occurrences(html, 'aria-current="true"'), 1, "표시는 지금 것 하나뿐");
  assert.ok(html.includes('aria-label="앞.jpg 보기"'), "썸네일마다 눌러 갈 수 있어야 한다");
  assert.ok(html.includes('aria-label="뒤.jpg 보기"'));
});

// ───────────────────────── 5. 주소의 지문 — 돌려 저장한 뒤 새 그림을 받는다
//
// 🔴 실제로 겪은 결함이다(2026-09-29): 사진을 세로로 돌려 저장했는데 **뷰어 아래
// 썸네일 줄은 처음 올린 가로 모양 그대로** 남아 있었다. 목록의 작은 그림만
// 지문을 달고 있었고 뷰어의 두 주소에는 없었던 탓이다 — 응답이 `no-store` 라도
// 이미 그려 놓은 `<img>` 는 주소가 같으면 다시 받지 않는다.

test("🔴 두 주소에 파일의 지문이 붙는다 — 체크섬 앞 12자, 인자 이름은 v", () => {
  const item = attachment({ id: "a1", checksumSha256: `abcdef012345${"0".repeat(52)}` });
  assert.equal(viewerThumbUrl(item), "/api/attachments/a1/download?view=thumb&v=abcdef012345");
  assert.equal(viewerFullUrl(item), "/api/attachments/a1/download?view=full&v=abcdef012345");
});

test("🔴 지문이 붙어도 thumb 과 full 은 여전히 갈려 있다", () => {
  const item = attachment({ id: "a1", checksumSha256: "f".repeat(64) });
  assert.ok(viewerThumbUrl(item).includes("?view=thumb"), "아래 줄이 thumb 을 잃었다");
  assert.ok(
    !viewerThumbUrl(item).includes("view=full"),
    "🔴 썸네일 줄이 원본을 부른다 — 한 건의 사진 수십 장이 한꺼번에 내려온다"
  );
  assert.ok(viewerFullUrl(item).includes("?view=full"), "크게 보는 자리가 full 을 잃었다");
  assert.ok(
    !viewerFullUrl(item).includes("view=thumb"),
    "🔴 크게 보기가 480px 썸네일이 된다 — 파형 눈금을 확인할 수 없다(파일 머리말의 사고)"
  );
});

test("🔴 체크섬이 다르면 주소가 다르다 — 돌려 저장하면 새 그림을 받는다", () => {
  const before = attachment({ id: "a1", checksumSha256: "1".repeat(64) });
  const after = attachment({ id: "a1", checksumSha256: "2".repeat(64) });
  assert.notEqual(viewerThumbUrl(before), viewerThumbUrl(after), "썸네일이 옛 그림에 묶인다");
  assert.notEqual(viewerFullUrl(before), viewerFullUrl(after), "크게 보기가 옛 그림에 묶인다");
  // 같은 파일이면 주소도 같아야 한다 — 그리기만 해도 매번 다시 받는 주소가 되면
  // 스무 장짜리 건을 열 때마다 원본을 통째로 다시 내려받는다.
  assert.equal(viewerThumbUrl(before), viewerThumbUrl(attachment({ id: "a1", checksumSha256: "1".repeat(64) })));
});

test("지문을 알 수 없으면 지문 없이 — 예전과 한 글자도 같은 주소다", () => {
  const unknown = attachment({ id: "a1", checksumSha256: "" });
  assert.equal(viewerThumbUrl(unknown), "/api/attachments/a1/download?view=thumb");
  assert.equal(viewerFullUrl(unknown), "/api/attachments/a1/download?view=full");
  assert.equal(attachmentFingerprintSuffix(null), "");
  assert.equal(attachmentFingerprintSuffix(undefined), "");
  assert.equal(attachmentFingerprintSuffix("0123456789abcdef"), "&v=0123456789ab");
});

test("🔴 그려진 화면에도 지문이 실린다 — 크게 보는 한 장과 아래 썸네일 전부", () => {
  const items = [
    attachment({ id: "a1", checksumSha256: "1".repeat(64) }),
    attachment({ id: "a2", checksumSha256: "2".repeat(64) }),
  ];
  const html = withRawAmpersands(render(items));

  assert.ok(html.includes(`src="${viewerFullUrl(items[0])}"`), "크게 보는 사진에 지문이 없다");
  for (const item of items) {
    assert.ok(html.includes(`src="${viewerThumbUrl(item)}"`), `${item.id} 썸네일에 지문이 없다`);
  }
  assert.equal(occurrences(html, "&v=222222222222"), 1, "a2 는 아래 썸네일 한 자리뿐이다");
});

test("🔴 지문 붙이는 규칙이 한 군데다 — 목록의 작은 그림도 같은 함수를 쓴다", () => {
  const listSource = readFileSync(new URL("./StoredAttachmentList.tsx", import.meta.url), "utf8");
  assert.ok(
    listSource.includes("attachmentFingerprintSuffix(item.checksumSha256)"),
    "목록이 지문을 따로 짓고 있다 — 한쪽만 고쳐지는 날 목록과 크게 보기가 갈린다"
  );
  assert.ok(
    !listSource.includes("checksumSha256.slice("),
    "목록이 체크섬을 직접 잘라 쓴다 — 자르는 길이가 두 군데에 적히면 갈라진다"
  );
});

// ───────────────────────────── 기존에 있던 것들이 그대로 있는가

test("🔴 닫기·좌우 넘김·내려받기·줄여받기가 그대로 있다", () => {
  const html = render(
    [
      attachment({ id: "a1", originalFileName: "앞.jpg" }),
      attachment({ id: "a2", originalFileName: "뒤.jpg" }),
      attachment({ id: "a3", originalFileName: "옆.jpg" }),
    ],
    1,
    () => {}
  );
  assert.ok(html.includes('aria-label="닫기"'), "닫기가 사라졌다");
  assert.ok(html.includes('aria-label="이전 사진"'), "왼쪽 화살표가 사라졌다");
  assert.ok(html.includes('aria-label="다음 사진"'), "오른쪽 화살표가 사라졌다");
  assert.ok(html.includes("줄여서 받기"), "줄여받기가 사라졌다");
  // 🔴 내려받기는 `view` 도 지문도 없는 **맨 주소**다 — 이 경로만 감사 로그를
  //    남긴다. 지문을 붙이면 같은 행위가 다른 주소로 두 가지가 된다.
  assert.ok(html.includes(`href="${viewerDownloadUrl("a2")}"`), "내려받기 링크");
  assert.ok(html.includes('aria-label="뒤.jpg 크게 보기"'), "창 이름표가 사라졌다");
  assert.ok(html.includes("2 / 3"), "몇 번째인지 그대로 보여야 한다");
});

test("새로 붙은 단추에도 이름표가 있다", () => {
  const html = render([attachment()]);
  for (const label of [
    "왼쪽으로 90도 회전",
    "오른쪽으로 90도 회전",
    "좌우 뒤집기",
    "상하 뒤집기",
    "확대",
    "축소",
    "원래대로",
  ]) {
    assert.ok(html.includes(`aria-label="${label}"`), `${label} 단추에 이름표가 없다`);
  }
});

test("첫 장·끝 장에서는 그쪽 화살표를 그리지 않는다", () => {
  const two = [attachment({ id: "a1" }), attachment({ id: "a2" })];
  const first = render(two, 0);
  assert.ok(!first.includes('aria-label="이전 사진"'), "첫 장에 앞 화살표가 있다");
  assert.ok(first.includes('aria-label="다음 사진"'));
  const last = render(two, 1);
  assert.ok(last.includes('aria-label="이전 사진"'));
  assert.ok(!last.includes('aria-label="다음 사진"'), "끝 장에 뒤 화살표가 있다");
});

// ───────────────────────────── 확대 — 기준점과 한계

test("배율은 1배 아래로도 8배 위로도 가지 않는다", () => {
  assert.equal(clampViewerScale(0.2), VIEWER_MIN_SCALE);
  assert.equal(clampViewerScale(99), VIEWER_MAX_SCALE);
  assert.equal(clampViewerScale(Number.NaN), VIEWER_MIN_SCALE);
  assert.equal(clampViewerScale(2.5), 2.5);
});

test("🔴 확대의 기준점 아래에 있던 곳이 제자리에 남는다", () => {
  // 한가운데에서 오른쪽으로 100px 떨어진 곳을 잡고 2배로 키운다.
  const zoomed = zoomViewerTo(IDENTITY_TRANSFORM, 2, 100, 0);
  assert.equal(zoomed.scale, 2);
  // 화면점 = offset + scale × 그림점. 기준점이 고정이라면 그 자리의 그림점은
  // 그대로다 — 100 = offsetX + 2 × 그림점(=50)  →  offsetX = -100.
  assert.equal(zoomed.offsetX, -100);
  assert.equal(zoomed.offsetY, 0);
});

test("1배로 돌아오면 옮겨 둔 것도 함께 지워진다", () => {
  const moved = panViewerBy({ ...IDENTITY_TRANSFORM, scale: 4 }, 200, -80);
  const back = zoomViewerTo(moved, 1, 0, 0);
  assert.equal(back.scale, VIEWER_MIN_SCALE);
  assert.equal(back.offsetX, 0);
  assert.equal(back.offsetY, 0);
});

test("두 번 누르면 확대와 원래 크기를 오간다 — 돌려 놓은 것은 살려 둔다", () => {
  const rotated = rotateViewer(IDENTITY_TRANSFORM, 1);
  const bigger = toggleViewerZoom(rotated, 0, 0);
  assert.equal(bigger.scale, VIEWER_DOUBLE_TAP_SCALE);
  assert.equal(bigger.orientation.rotate, 90, "두 번 눌렀다고 돌린 것까지 풀리면 다시 돌려야 한다");

  const back = toggleViewerZoom(bigger, 0, 0);
  assert.equal(back.scale, VIEWER_MIN_SCALE);
  assert.equal(back.orientation.rotate, 90);
});

test("🔴 확대를 풀면 스와이프가 되살아난다", () => {
  const zoomed = zoomViewerBy(IDENTITY_TRANSFORM, 3, 0, 0);
  assert.equal(canSwipeNavigate(zoomed), false);
  assert.equal(canSwipeNavigate(toggleViewerZoom(zoomed, 0, 0)), true);
});

test("그림을 화면 밖으로 완전히 내보내지 못한다", () => {
  const far = panViewerBy({ ...IDENTITY_TRANSFORM, scale: 2 }, 5000, 5000);
  const kept = clampViewerPan(far, 800, 600);
  // 2배에서 늘어난 여백의 절반까지만 — 가로 400, 세로 300.
  assert.equal(kept.offsetX, 400);
  assert.equal(kept.offsetY, 300);
});

test("1배에서는 옮길 여지가 없다", () => {
  const kept = clampViewerPan(panViewerBy(IDENTITY_TRANSFORM, 300, 300), 800, 600);
  assert.equal(kept.offsetX, 0);
  assert.equal(kept.offsetY, 0);
});

test("무대 크기를 모르면(서버 렌더) 아무것도 자르지 않는다", () => {
  const moved = panViewerBy({ ...IDENTITY_TRANSFORM, scale: 2 }, 50, 50);
  assert.equal(clampViewerPan(moved, 0, 0), moved);
});

// ───────────────────────────── 회전·뒤집기 — 보기만 바뀐다

test("90°씩 돌고 한 바퀴에서 0으로 돌아온다", () => {
  let t = IDENTITY_TRANSFORM;
  for (const expected of [90, 180, 270, 0]) {
    t = rotateViewer(t, 1);
    assert.equal(t.orientation.rotate, expected);
  }
  assert.equal(rotateViewer(IDENTITY_TRANSFORM, -1).orientation.rotate, 270, "왼쪽으로 한 번");
});

test("🔴 90° 돌아간 상태의 「좌우 뒤집기」는 화면에서 좌우로 뒤집힌다", () => {
  // 그림 자신의 축으로는 flipY 다(그 축이 화면에서는 가로다). 저장해 둘 값은
  // 그림 기준이어야 나중에 파일에 그대로 적을 수 있다.
  const turned = rotateViewer(IDENTITY_TRANSFORM, 1);
  const flipped = flipViewerAcrossScreenX(turned);
  assert.equal(flipped.orientation.flipY, true);
  assert.equal(flipped.orientation.flipX, false);

  // 돌아가 있지 않으면 그대로 flipX 다.
  assert.equal(flipViewerAcrossScreenX(IDENTITY_TRANSFORM).orientation.flipX, true);
  // 상하도 같은 규칙으로 뒤바뀐다.
  assert.equal(flipViewerAcrossScreenY(turned).orientation.flipX, true);
  assert.equal(flipViewerAcrossScreenY(IDENTITY_TRANSFORM).orientation.flipY, true);
});

test("회전·뒤집기 상태가 한 곳(orientation)에 모여 있다 — 나중에 파일에 적을 값이다", () => {
  const t = flipViewerAcrossScreenY(rotateViewer(IDENTITY_TRANSFORM, 2));
  assert.deepEqual(t.orientation, { rotate: 180, flipX: false, flipY: true });
  // 배율·이동은 보는 사람의 화면 사정일 뿐이라 그 안에 섞이지 않는다.
  assert.equal("scale" in t.orientation, false);
});

test("🔴 CSS 변환 차례 — translate 가 맨 앞이라 끌기가 화면 좌표 그대로다", () => {
  const css = viewerTransformCss({
    orientation: { rotate: 90, flipX: true, flipY: true },
    scale: 2,
    offsetX: 10,
    offsetY: -20,
  });
  assert.equal(css, "translate(10px, -20px) scale(2) rotate(90deg) scaleX(-1) scaleY(-1)");
  // 차례가 뒤집히면(rotate 가 translate 앞) 90° 돌린 상태에서 위로 끌 때
  // 그림이 옆으로 움직인다. 그 어긋남을 여기서 막는다.
  assert.ok(css.indexOf("translate(") < css.indexOf("rotate("), "translate 가 rotate 보다 앞");
  assert.ok(css.indexOf("rotate(") < css.indexOf("scaleX("), "뒤집기는 그림 자신의 축에 먼저");
});

test("아무것도 안 건드린 상태의 변환값은 짧고 평범하다", () => {
  assert.equal(viewerTransformCss(IDENTITY_TRANSFORM), "translate(0px, 0px) scale(1)");
  assert.equal(isViewerTransformIdentity(IDENTITY_TRANSFORM), true);
  assert.equal(isViewerTransformIdentity(dirtyTransform()), false);
});

test("끌어 옮긴 값은 화면에서 움직인 px 그대로 쌓인다", () => {
  const moved = panViewerBy(panViewerBy({ ...IDENTITY_TRANSFORM, scale: 3 }, 10, 5), -4, 15);
  assert.equal(moved.offsetX, 6);
  assert.equal(moved.offsetY, 20);
  // 돌려 놓아도 뜻이 달라지지 않는다 — 회전은 translate 안쪽에서만 돈다.
  const turned = rotateViewer(moved, 1);
  assert.equal(panViewerBy(turned, 10, 0).offsetX, 16);
});
