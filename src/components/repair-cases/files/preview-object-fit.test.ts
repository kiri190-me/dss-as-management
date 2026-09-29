import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 미리보기 사진은 **전체 모습이 보여야 한다**(2026-09-29)
 * ============================================================================
 * 미리보기가 `object-cover` 면 가운데만 남기고 잘린다. 파형 사진은 눈금이, 외관
 * 사진은 흠집이 양 끝에서 사라져서 무엇을 찍은 것인지 목록에서 알아볼 수 없다.
 * 그래서 네 자리를 `object-contain`(맞춰 넣기)으로 못박는다.
 *
 * 🔴 **함께 못박는 반대쪽**: InAppCamera 의 video 는 여전히 `object-cover` 여야
 * 한다. 거기 video 는 「카메라에 지금 찍히는 범위」를 그리는 것이라 잘라 채우는
 * 것이 맞고, 그 파일 주석(177·183·677·705행)이 `contain` 이 만드는 검은 여백
 * 때문에 배율 계산이 어떻게 어긋나는지를 길게 설명하고 있다. 「미리보기를 contain
 * 으로」 하는 다음 사람이 한 번에 싹 바꿔 버리는 것을 이 시험이 막는다.
 *
 * 🔴 **그 파일 안에서 딱 한 자리만 예외다**: 카메라 화면 아래 왼쪽의 「방금 찍은
 * 사진」 썸네일은 `object-contain` 이다(2026-09-29). 지금 찍히는 범위가 아니라
 * 이미 찍힌 결과물이고 배율 계산과도 무관해서, 위의 「전체 모습이 보여야 한다」가
 * 그대로 걸린다. 그래서 이 시험은 **cover 와 contain 을 자리별로 둘 다** 못박는다
 * — 한쪽만 보면 파일을 통째로 뒤집어도 통과해 버린다.
 *
 * 🔴 **빈 자리에는 바탕색이 있어야 한다.** contain 은 칸 안에 남는 자리를 만든다.
 * 그 자리가 비면 「그림이 덜 그려졌다」로 읽히므로 네 자리 모두 바탕을 깐다.
 * 셋은 밝은 화면 위라 zinc-100/800 이고, 뷰어 아래 썸네일만 검은 바탕(bg-black)
 * 위라 그 화면의 단추들이 쓰는 bg-white/15 를 쓴다.
 *
 * 🔴 **칸 크기는 그대로다.** 목록의 칸이 흔들리는 것이 잘리는 것보다 큰 문제라,
 * aspect-square · h-full w-full 이 그 자리에 남아 있는지도 함께 본다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 넷 다 서버 액션·카메라·objectURL 에 묶인 클라이언트 컴포넌트라 인자만으로
 * 「사진이 실린 화면」을 만들 수 없고, jsdom 없이는 만든다 해도 Tailwind 클래스가
 * 실제 잘림으로 나타나지도 않는다. 보려는 것이 클래스 한 낱말이므로 이웃
 * (product-model-customer-source.test.ts)과 같은 방법으로 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/**
 * 주석을 지운다. 이 파일들은 주석에 object-cover · object-contain 을 **까닭과
 * 함께** 적어 두므로, 글자를 그냥 세면 주석 한 줄에 시험이 거짓으로 통과한다.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const viewer = read("src/components/repair-cases/files/AttachmentViewer.tsx");
const filesScreen = read("src/components/repair-cases/files/FilesScreen.tsx");
const storedList = read("src/components/repair-cases/files/StoredAttachmentList.tsx");
const productModelFiles = read("src/components/product-models/ProductModelFilesSection.tsx");
const camera = read("src/components/repair-cases/files/InAppCamera.tsx");

/** 미리보기 네 자리 — 각각 「그 자리의 className 통째」로 못박는다. */
const PREVIEWS = [
  {
    name: "뷰어 아래 썸네일 줄",
    file: "AttachmentViewer.tsx",
    source: viewer,
    className: `className="h-full w-full bg-white/15 object-contain"`,
    /** 검은 바탕 위라 zinc 가 아니다. */
    background: "bg-white/15",
    /** 칸 크기를 정하는 부분. */
    box: "h-full w-full",
  },
  {
    name: "수리 건 찍은 사진 카드",
    file: "FilesScreen.tsx",
    source: filesScreen,
    className: `className="aspect-square w-full bg-zinc-100 object-contain dark:bg-zinc-800"`,
    background: "bg-zinc-100",
    box: "aspect-square w-full",
  },
  {
    name: "수리 건 파일 목록",
    file: "StoredAttachmentList.tsx",
    source: storedList,
    className: "className={`${box} bg-zinc-100 object-contain dark:bg-zinc-800`}",
    background: "bg-zinc-100",
    /** 이쪽만 칸 크기가 변수(box)다 — 작은 줄과 큰 칸 두 가지를 쓴다. */
    box: "${box}",
  },
  {
    name: "제품 모델 파일",
    file: "ProductModelFilesSection.tsx",
    source: productModelFiles,
    className: `className="aspect-square w-full bg-zinc-100 object-contain dark:bg-zinc-800"`,
    background: "bg-zinc-100",
    box: "aspect-square w-full",
  },
] as const;

describe("🔴 미리보기 넷은 잘리지 않는다 — object-contain", () => {
  for (const preview of PREVIEWS) {
    test(`${preview.name}(${preview.file})은 object-contain 이다`, () => {
      assert.ok(
        flat(preview.source).includes(flat(preview.className)),
        `${preview.file}: 이 자리의 className 이 달라졌다 — 기대한 것: ${preview.className}`
      );
    });

    test(`${preview.name}(${preview.file})에 object-cover 가 남아 있지 않다`, () => {
      assert.ok(
        !code(preview.source).includes("object-cover"),
        `${preview.file}: 잘라 채우면 파형 눈금과 외관 흠집이 양 끝에서 사라진다`
      );
    });

    test(`${preview.name}(${preview.file})은 남는 자리를 채울 바탕색이 있다`, () => {
      assert.ok(
        flat(preview.className).includes(preview.background),
        `${preview.file}: contain 은 칸에 빈 자리를 만든다 — 비면 「덜 그려졌다」로 읽힌다`
      );
    });

    test(`${preview.name}(${preview.file})의 칸 크기가 그대로다`, () => {
      assert.ok(
        flat(preview.className).includes(preview.box),
        `${preview.file}: 목록의 칸이 흔들리는 것이 사진이 잘리는 것보다 큰 문제다`
      );
    });
  }

  test("뷰어 바탕이 여전히 검은색이다 — 썸네일 바탕으로 white/15 를 고른 까닭", () => {
    assert.ok(
      flat(viewer).includes("fixed inset-0 z-50 flex flex-col bg-black"),
      "뷰어가 밝은 바탕으로 바뀌었다면 썸네일 바탕색도 다시 골라야 한다"
    );
    assert.ok(
      flat(code(viewer)).includes("rounded-md bg-white/15 px-3 py-2 text-sm font-medium text-white"),
      "white/15 는 이 화면의 단추들이 이미 쓰는 색이라 골랐다 — 그 이웃이 사라지면 근거가 사라진다"
    );
  });

  test("크게 보는 사진 자신은 원래대로 object-contain 이다", () => {
    assert.ok(
      flat(viewer).includes(`className="max-h-full max-w-full object-contain select-none"`),
      "이 자리는 처음부터 contain 이었다 — 함께 건드리지 않았는지 본다"
    );
  });
});

describe("🔴 반대쪽 — 카메라 영상은 잘라 채우는 것이 맞다", () => {
  test("InAppCamera 는 여전히 object-cover 를 쓴다", () => {
    assert.ok(
      code(camera).includes("object-cover"),
      "카메라는 「지금 찍히는 범위」를 그린다 — contain 으로 바꾸면 보이는 것과 찍히는 것이 달라진다"
    );
  });

  test("영상 요소가 상자를 잡은 동안 object-cover 다", () => {
    assert.ok(
      flat(camera).includes(
        `className={previewBox ? "h-full w-full object-cover" : "h-full w-full object-contain"}`
      ),
      "🔴 contain 이 만드는 검은 여백이 상자 안에 들어가면 배율(scale) 계산이 어긋난다 — InAppCamera 177·183행"
    );
  });

  test("object-cover 를 쓰는 자리는 그 영상 하나뿐이다", () => {
    assert.equal(
      code(camera).match(/object-cover/g)?.length ?? 0,
      1,
      "🔴 잘라 채워도 되는 것은 카메라 영상뿐이다 — 자리가 늘었다면 그것도 「지금 찍히는 범위」인지 따져야 한다"
    );
  });
});

describe("🔴 카메라 안에서도 방금 찍은 사진은 잘리지 않는다 — object-contain", () => {
  test("방금 찍은 것 썸네일이 object-contain 이다", () => {
    assert.ok(
      flat(camera).includes(
        `<img src={lastShotUrl} alt="방금 찍은 사진" className="h-full w-full object-contain" />`
      ),
      "🔴 이미 찍힌 결과물이라 전체가 보여야 한다 — 잘린 가운데만 보고는 다시 찍을지를 못 고른다"
    );
  });

  test("방금 찍은 것 썸네일에 object-cover 가 남아 있지 않다", () => {
    assert.ok(
      !flat(code(camera)).includes(`alt="방금 찍은 사진" className="h-full w-full object-cover"`),
      "이 자리는 카메라 영상이 아니다 — 파일을 통째로 cover 로 되돌리지 않았는지 본다"
    );
  });

  test("방금 찍은 것 썸네일은 바탕색과 칸 크기가 그대로다", () => {
    assert.ok(
      flat(camera).includes(
        `className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/40 bg-white/10"`
      ),
      "🔴 contain 이 만드는 빈 자리는 바깥 상자의 bg-white/10 이 받는다 — 칸 크기(h-14 w-14)도 흔들리면 안 된다"
    );
  });
});
