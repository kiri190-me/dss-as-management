import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ATTACHMENT_EXTENSION_RULES,
  isExtensionAllowedForCategory,
} from "@/lib/domain/attachment-allowlist";
import {
  HEIC_CONVERT_FAILED_REASON,
  HEIC_PICKER_EXTENSIONS,
  allowedExtensionsFor,
  categoryTakesPhotos,
  convertPickedHeic,
  heicConversionNotice,
  isHeicPick,
  jpegNameForHeic,
  pickerAcceptAttribute,
  type HeicToJpeg,
} from "./heic-upload";

/**
 * ============================================================================
 * 아이폰 사진(heic) — 고를 수 있는가 · 올리기 전에 jpg 가 되는가 (2026-11-18)
 * ============================================================================
 * 사용자 요청: 「사진 넣을 때 heic 확장자도 포함해줘」(수리 건 상세 [파일 관리]).
 * 고른 길은 **「올릴 때 jpg 로 바꿔 저장」**이고, 🔴 원본 heic 는 남지 않는다.
 *
 * 🔴 **실제 heic 를 푸는 일은 여기서 못 잰다** — libheif 는 wasm 이라 node 시험에서
 * 돌지 않는다. 그래서 바꾸는 함수를 밖에서 받게 만들어 두고(heic-upload.ts 머리말)
 * 가짜 변환기로 **규칙**을 잰다: 무엇을 변환기에 보내고, 무엇을 손대지 않고, 못
 * 바꿨을 때 무엇을 말하는가. 진짜 사진으로 열어 보는 것은 사람의 몫이다.
 *
 * 이 파일이 가장 세게 지키는 둘:
 *
 *  · 🔴 **허용목록이 안 바뀌었다** — `ATTACHMENT_EXTENSION_RULES` 는 지금도 14종이고
 *    heic 가 없다. 거기 한 줄을 더하면 제한 목록이 없는 분류 **전부**가 함께 열려
 *    브라우저가 못 그리는 파일이 통로로 들어온다. 이 조각은 고르는 창의 힌트와
 *    보내기 전 한 번 굽는 일만 더했다.
 *  · 🔴 **라이브러리를 늦게 받는다** — `heic2any` 는 1.4MB 다. 정적으로 import 하면
 *    heic 를 쓰지 않는 모든 사람의 첫 화면에 따라붙는다. 「본문 안의 await import」
 *    말고는 저장소 어디에도 그 이름이 없어야 한다(원본 글자로 센다).
 * ============================================================================
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function read(...pieces: string[]): string {
  return readFileSync(path.join(here, ...pieces), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 셈이 걸리지 않게. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0];
const HEIC_BYTES = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70];

function fileOf(name: string, type: string, bytes: readonly number[] = HEIC_BYTES): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

async function bytesOf(file: File | Blob): Promise<number[]> {
  return [...new Uint8Array(await file.arrayBuffer())];
}

/**
 * 부른 자리를 적어 두는 가짜 변환기. 🔴 **몇 번 불렸는지**가 이 파일의 여러 단언에서
 * 곧 답이다(heic 가 아니면 0, 안 고르면 0).
 */
function countingConverter(
  answer: (file: File) => Promise<Blob> = async () =>
    new Blob([new Uint8Array(JPEG_BYTES)], { type: "image/jpeg" })
): { convert: HeicToJpeg; calls: string[] } {
  const calls: string[] = [];
  const convert: HeicToJpeg = async (file) => {
    calls.push(file.name);
    return answer(file);
  };
  return { convert, calls };
}

describe("heic 고르기 — accept 에만 더하고 허용목록은 그대로다", () => {
  test("🔴 표본 점검 — 허용목록은 14종이고 heic·heif 가 **없다**", () => {
    const extensions = ATTACHMENT_EXTENSION_RULES.map((rule) => rule.extension);
    assert.equal(extensions.length, 14, "허용목록의 종 수가 달라졌다 — 울타리를 다시 볼 것");
    for (const extension of HEIC_PICKER_EXTENSIONS) {
      assert.ok(!extensions.includes(extension), `.${extension} 이 허용목록에 들어갔다`);
    }
  });

  test("🔴 서버는 heic 를 어느 분류에서도 받지 않는다 — 바꿔서 보내기 때문이다", () => {
    for (const category of ["INTAKE_PHOTO", "CIRCUIT_DIAGRAM", "SCREENSHOT", "OTHER"] as const) {
      for (const extension of HEIC_PICKER_EXTENSIONS) {
        assert.equal(
          isExtensionAllowedForCategory(extension, category),
          false,
          `${category} 가 .${extension} 을 받게 됐다`
        );
      }
    }
  });

  test("🔴 표본 점검 — 분류마다 받는 형식이 실제로 다르다(비교가 공짜로 통과하지 않게)", () => {
    assert.deepEqual(allowedExtensionsFor("OSCILLOSCOPE_DATA"), ["csv", "txt"]);
    assert.deepEqual(allowedExtensionsFor("CIRCUIT_DIAGRAM"), ["jpg", "jpeg", "png", "pdf"]);
    // 제한 목록이 없는 분류는 허용목록 14종 전부다.
    assert.equal(allowedExtensionsFor("INTAKE_PHOTO")?.length, 14);
    // 형식을 가리지 않는 분류(점검표)는 목록으로 적을 수 없어 null 이다.
    assert.equal(allowedExtensionsFor("CHECKLIST"), null);
  });

  test("사진을 받는 분류에만 .heic·.heif 가 붙는다", () => {
    const photoAccept = pickerAcceptAttribute(allowedExtensionsFor("INTAKE_PHOTO"));
    assert.ok(photoAccept?.includes(".heic"), "접수 사진에서 heic 를 못 고른다");
    assert.ok(photoAccept?.includes(".heif"), "접수 사진에서 heif 를 못 고른다");
    // 🔴 앞의 목록은 한 글자도 안 바뀌었다 — 허용목록에서 뽑은 그대로에 둘이 붙었을 뿐.
    assert.equal(
      photoAccept,
      [...(allowedExtensionsFor("INTAKE_PHOTO") ?? []), "heic", "heif"]
        .map((extension) => `.${extension}`)
        .join(",")
    );

    const diagramAccept = pickerAcceptAttribute(allowedExtensionsFor("CIRCUIT_DIAGRAM"));
    assert.ok(diagramAccept?.includes(".heic"), "회로도는 사진을 받는데 heic 를 못 고른다");
  });

  test("🔴 사진을 안 받는 분류에는 안 붙는다 — 바꿔 봐야 그 분류가 jpg 를 거절한다", () => {
    for (const category of ["OSCILLOSCOPE_DATA", "LOG_FILE", "FIRMWARE", "SIGNED_QUOTE_PDF", "QUOTE_EXCEL"] as const) {
      const accept = pickerAcceptAttribute(allowedExtensionsFor(category));
      assert.ok(accept !== undefined, `${category} 의 accept 가 통째로 사라졌다`);
      assert.ok(!accept.includes(".heic"), `${category} 에 heic 가 열렸다`);
      assert.ok(!accept.includes(".heif"), `${category} 에 heif 가 열렸다`);
    }
  });

  test("🔴 형식을 가리지 않는 분류는 undefined 그대로다 — 빈 글자를 넣지 않는다", () => {
    // 빈 글자를 넣으면 브라우저가 「받는 형식이 없다」로 읽어 고르는 창이 아무것도
    // 내놓지 않는 날이 있다. 그 분류는 속성이 없어서 heic 도 이미 보인다.
    assert.equal(pickerAcceptAttribute(null), undefined);
    assert.equal(pickerAcceptAttribute(allowedExtensionsFor("CHECKLIST")), undefined);
  });

  test("「사진을 받는가」는 촬영 단추를 내밀던 그 판정 그대로다", () => {
    assert.equal(categoryTakesPhotos(null), true, "형식을 안 가리는 분류는 사진도 받는다");
    assert.equal(categoryTakesPhotos(["jpg", "jpeg", "png", "pdf"]), true);
    assert.equal(categoryTakesPhotos(["jpeg"]), true, "jpeg 만 받는 분류도 사진 분류다");
    assert.equal(categoryTakesPhotos(["csv", "txt"]), false);
    assert.equal(categoryTakesPhotos([]), false);
  });
});

describe("heic 가려내기 — 확장자와 MIME 을 둘 다 본다", () => {
  test("MIME 이 image/heic 면 잡힌다", () => {
    assert.equal(isHeicPick({ name: "IMG_1234.heic", type: "image/heic" }), true);
  });

  test("🔴 대문자 .HEIC 도 잡힌다 — 아이폰이 그렇게 붙인다", () => {
    assert.equal(isHeicPick({ name: "IMG_1234.HEIC", type: "image/heic" }), true);
    assert.equal(isHeicPick({ name: "IMG_1234.HEIF", type: "" }), true);
  });

  test("🔴 MIME 이 비어 있어도 확장자로 잡힌다 — 윈도우에서 흔하다", () => {
    assert.equal(isHeicPick({ name: "IMG_1234.heic", type: "" }), true);
    assert.equal(isHeicPick({ name: "IMG_1234.heif", type: "" }), true);
  });

  test("🔴 MIME 이 image/heif 여도, 이름이 엉뚱해도 MIME 으로 잡힌다", () => {
    assert.equal(isHeicPick({ name: "IMG_1234.heic", type: "image/heif" }), true);
    assert.equal(isHeicPick({ name: "이름없음", type: "image/heif" }), true);
    // 연사·라이브 포토가 이 이름으로 오는 기기가 있다.
    assert.equal(isHeicPick({ name: "IMG_1234.heic", type: "image/heic-sequence" }), true);
  });

  test("사진이 아닌 것·보통 사진은 안 잡힌다", () => {
    assert.equal(isHeicPick({ name: "IMG_1234.jpg", type: "image/jpeg" }), false);
    assert.equal(isHeicPick({ name: "보고서.pdf", type: "application/pdf" }), false);
    assert.equal(isHeicPick({ name: "펌웨어.bin", type: "application/octet-stream" }), false);
    // 🔴 이름 안에 heic 가 들어 있을 뿐인 파일을 바꾸지 않는다.
    assert.equal(isHeicPick({ name: "heic 변환 안내.txt", type: "text/plain" }), false);
  });

  test("이름의 확장자를 jpg 로 바꾼다 — 대문자·점 없음·점만 끝", () => {
    assert.equal(jpegNameForHeic("IMG_1234.HEIC"), "IMG_1234.jpg");
    assert.equal(jpegNameForHeic("IMG_1234.heif"), "IMG_1234.jpg");
    assert.equal(jpegNameForHeic("현장 사진 3.HEIC"), "현장 사진 3.jpg");
    assert.equal(jpegNameForHeic("IMG_1234"), "IMG_1234.jpg");
    assert.equal(jpegNameForHeic("IMG_1234."), "IMG_1234.jpg");
    // 점이 여럿이면 마지막 것만 바꾼다.
    assert.equal(jpegNameForHeic("2026.11.18 반입.heic"), "2026.11.18 반입.jpg");
  });
});

describe("고른 뒤 바꾸기 — 바뀐 것만 바뀐다", () => {
  test("heic 를 고르면 변환기를 거쳐 jpg 가 된다", async () => {
    const converter = countingConverter();
    const outcome = await convertPickedHeic([fileOf("IMG_1234.heic", "image/heic")], converter);

    assert.deepEqual(converter.calls, ["IMG_1234.heic"], "변환기를 한 번 불러야 한다");
    assert.equal(outcome.files.length, 1);
    assert.equal(outcome.files[0].name, "IMG_1234.jpg");
    assert.equal(outcome.files[0].type, "image/jpeg");
    assert.deepEqual(await bytesOf(outcome.files[0]), JPEG_BYTES, "바뀐 바이트가 실려야 한다");
    assert.deepEqual(outcome.renamed, [{ from: "IMG_1234.heic", to: "IMG_1234.jpg" }]);
    assert.deepEqual(outcome.failures, []);
  });

  test("🔴 대문자 .HEIC · MIME 이 빈 것 · image/heif 도 똑같이 바뀐다", async () => {
    const converter = countingConverter();
    const outcome = await convertPickedHeic(
      [
        fileOf("IMG_1.HEIC", "image/heic"),
        fileOf("IMG_2.heic", ""),
        fileOf("IMG_3.heif", "image/heif"),
      ],
      converter
    );

    assert.equal(converter.calls.length, 3, "셋 다 변환기를 거쳐야 한다");
    assert.deepEqual(
      outcome.files.map((file) => file.name),
      ["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"]
    );
    for (const file of outcome.files) assert.equal(file.type, "image/jpeg");
  });

  test("🔴 heic 가 아니면 변환기를 **한 번도** 안 부른다 — 바이트도 객체도 그대로다", async () => {
    const picked = [
      fileOf("IMG_1234.jpg", "image/jpeg", JPEG_BYTES),
      fileOf("보고서.pdf", "application/pdf", [0x25, 0x50, 0x44, 0x46]),
    ];
    const converter = countingConverter();
    const outcome = await convertPickedHeic(picked, converter);

    assert.deepEqual(converter.calls, [], "heic 가 없는데 변환기가 불렸다");
    assert.deepEqual(outcome.renamed, []);
    assert.deepEqual(outcome.failures, []);
    // 🔴 **같은 객체**가 그대로 나와야 한다 — 다시 만들면 바이트가 같아도 다른 파일이다.
    assert.equal(outcome.files[0], picked[0]);
    assert.equal(outcome.files[1], picked[1]);
    assert.deepEqual(await bytesOf(outcome.files[0]), JPEG_BYTES);
    assert.deepEqual(await bytesOf(outcome.files[1]), [0x25, 0x50, 0x44, 0x46]);
    assert.equal(outcome.files[1].name, "보고서.pdf", "이름이 바뀌었다");
  });

  test("🔴 아이폰이 이미 jpg 로 바꿔 준 사진은 그대로 지나간다 — 라이브러리도 안 받는다", async () => {
    /*
      iOS 는 고르는 창에서 heic 사진을 집으면 **OS 가 JPEG 로 바꿔** 건네주는 길이
      있다(이름도 `IMG_1234.jpg` 가 된다). 그 파일이 들어오면 우리가 폰에서 다시 구울
      까닭이 없다 — 확장자도 MIME 도 jpeg 라 변환기를 **한 번도** 부르지 않아야 한다.
      ⚠️ iOS 가 어느 경우에 이름까지 바꿔 주는지는 **실기기 확인이 필요한 자리**다.
      여기서 못 박는 것은 「그렇게 들어오면 손대지 않는다」 하나다.
    */
    const fromPhone = fileOf("IMG_1234.jpg", "image/jpeg", JPEG_BYTES);
    const converter = countingConverter();
    const outcome = await convertPickedHeic([fromPhone], converter);

    assert.deepEqual(converter.calls, [], "이미 jpg 인데 폰에서 또 구웠다");
    assert.equal(outcome.files[0], fromPhone, "같은 객체가 그대로 나와야 한다");
    assert.deepEqual(outcome.renamed, []);
  });

  test("🔴 섞어 고르면 heic 만 바뀌고 나머지는 그대로다 — 차례도 그대로", async () => {
    const jpg = fileOf("A.jpg", "image/jpeg", JPEG_BYTES);
    const pdf = fileOf("B.pdf", "application/pdf", [0x25, 0x50, 0x44, 0x46]);
    const converter = countingConverter();
    const outcome = await convertPickedHeic(
      [jpg, fileOf("C.HEIC", "image/heic"), pdf, fileOf("D.heic", "")],
      converter
    );

    assert.deepEqual(converter.calls, ["C.HEIC", "D.heic"], "heic 둘만 거쳐야 한다");
    assert.deepEqual(
      outcome.files.map((file) => file.name),
      ["A.jpg", "C.jpg", "B.pdf", "D.jpg"],
      "고른 차례가 그대로 남아야 한다"
    );
    assert.equal(outcome.files[0], jpg);
    assert.equal(outcome.files[2], pdf);
    assert.deepEqual(outcome.renamed, [
      { from: "C.HEIC", to: "C.jpg" },
      { from: "D.heic", to: "D.jpg" },
    ]);
  });

  test("🔴 못 바꾼 장만 빠지고 나머지는 올라간다 — 까닭을 달고", async () => {
    const jpg = fileOf("A.jpg", "image/jpeg", JPEG_BYTES);
    const converter = countingConverter(async (file) => {
      if (file.name === "깨진.heic") throw new Error("디코딩 실패");
      return new Blob([new Uint8Array(JPEG_BYTES)], { type: "image/jpeg" });
    });
    const outcome = await convertPickedHeic(
      [jpg, fileOf("깨진.heic", "image/heic"), fileOf("멀쩡.heic", "image/heic")],
      converter
    );

    assert.deepEqual(
      outcome.files.map((file) => file.name),
      ["A.jpg", "멀쩡.jpg"],
      "못 바꾼 장만 빠져야 한다"
    );
    // 🔴 조용히 삼키지 않는다 — 올리기 실패 목록과 **같은 모양**이라 그대로 합쳐진다.
    assert.deepEqual(outcome.failures, [
      { name: "깨진.heic", reason: HEIC_CONVERT_FAILED_REASON },
    ]);
    assert.deepEqual(outcome.renamed, [{ from: "멀쩡.heic", to: "멀쩡.jpg" }]);
  });

  test("🔴 빈 결과(0바이트)를 던지는 변환기도 그 장만 뺀다", async () => {
    const converter = countingConverter(async () => {
      throw new Error("heic 변환 결과가 비어 있다");
    });
    const outcome = await convertPickedHeic([fileOf("IMG.heic", "image/heic")], converter);
    assert.deepEqual(outcome.files, []);
    assert.equal(outcome.failures.length, 1);
  });

  test("바꿀 것이 있을 때만 진행 표시가 울린다 — 몇 장 중 몇 장째", async () => {
    const seen: string[] = [];
    const onProgress = (current: number, total: number) => seen.push(`${current}/${total}`);

    const quiet = countingConverter();
    await convertPickedHeic([fileOf("A.jpg", "image/jpeg", JPEG_BYTES)], {
      convert: quiet.convert,
      onProgress,
    });
    assert.deepEqual(seen, [], "바꿀 것이 없는데 진행 표시가 울렸다");

    const converter = countingConverter();
    await convertPickedHeic(
      [fileOf("A.jpg", "image/jpeg", JPEG_BYTES), fileOf("B.heic", "image/heic"), fileOf("C.heic", "")],
      { convert: converter.convert, onProgress }
    );
    // 🔴 분모는 **바꿀 장 수**다(고른 장 수가 아니다) — 3장 중 1장째가 뜨면 사람은
    //    한 장이 사라진 줄 안다.
    assert.deepEqual(seen, ["1/2", "2/2"]);
  });

  test("아무것도 안 골랐으면 조용하다", async () => {
    const converter = countingConverter();
    const outcome = await convertPickedHeic([], converter);
    assert.deepEqual(outcome.files, []);
    assert.deepEqual(converter.calls, []);
    assert.equal(heicConversionNotice(outcome.renamed), null);
  });
});

describe("사람에게 말하기 — 이름이 바뀐 사실을 숨기지 않는다", () => {
  test("바뀐 것이 없으면 아무 말도 안 한다", () => {
    assert.equal(heicConversionNotice([]), null);
  });

  test("한 장이면 무엇이 무엇이 됐는지 그대로 적는다", () => {
    const notice = heicConversionNotice([{ from: "IMG_1234.HEIC", to: "IMG_1234.jpg" }]);
    assert.ok(notice !== null);
    assert.ok(notice.includes("IMG_1234.HEIC → IMG_1234.jpg"), notice);
    assert.ok(notice.includes("1장"), notice);
    // 🔴 원본이 안 남는다는 사실을 함께 말한다 — 고를 때 들은 말을 한 번 더 확인해 준다.
    assert.ok(notice.includes("원본 heic 는 저장되지 않습니다"), notice);
  });

  test("여럿이면 셋까지 이름을 적고 나머지는 수로 줄인다", () => {
    const notice = heicConversionNotice(
      ["A", "B", "C", "D", "E"].map((name) => ({ from: `${name}.heic`, to: `${name}.jpg` }))
    );
    assert.ok(notice !== null);
    assert.ok(notice.includes("5장"), notice);
    assert.ok(notice.includes("A.heic → A.jpg"), notice);
    assert.ok(notice.includes("C.heic → C.jpg"), notice);
    assert.ok(!notice.includes("D.heic → D.jpg"), "이름이 다섯 쌍이나 적혔다");
    assert.ok(notice.includes("외 2장"), notice);
  });

  /**
   * 🔴 **고르기 전에 미리 말하던 한 줄은 2026-11-18 에 없앴다**(사용자 요청 「설명은
   * 없어도 될 것 같아」). 그 전까지 여기에는 `HEIC_PICKER_HINT` 가 「.heic 를 .jpg 로
   * 바꿔 저장한다」고 적고 있는지 재는 시험이 있었다 — 상수가 사라졌으니 시험도 같은
   * 강도로 **반대쪽**을 못박는다: 안 쓰는 글이 되살아나지 않는가, 그리고 **바꾼 뒤에
   * 말하는 쪽은 그대로인가**(바로 위 세 시험이 그것을 잰다).
   */
  test("🔴 미리 말하던 상수가 되살아나지 않았다 — 안 쓰는 글이 남으면 다음 사람이 찾아 헤맨다", () => {
    const source = read("heic-upload.ts");
    assert.ok(!/export const HEIC_PICKER_HINT\b/.test(source), "HEIC_PICKER_HINT 가 다시 생겼다");
    const screen = withoutComments(read("FilesScreen.tsx"));
    assert.ok(!screen.includes("HEIC_PICKER_HINT"), "화면이 다시 그 줄을 그린다");
    // 🔴 글귀를 화면에 손으로 옮겨 적어 되살리는 길도 함께 막는다.
    assert.ok(
      !screen.includes("원본 heic 는 남지 않습니다"),
      "없앤 안내 글귀가 화면에 손으로 적혀 있다"
    );
  });
});

describe("🔴 라이브러리는 늦게 받는다 — 정적 import 가 저장소 어디에도 없다", () => {
  const converterCode = withoutComments(read("heic-to-jpeg.ts"));

  test("본문 안에서 await import 한다", () => {
    assert.ok(
      /await import\(\s*["']heic2any["']\s*\)/.test(converterCode),
      "heic-to-jpeg.ts 가 heic2any 를 늦게 받지 않는다"
    );
  });

  test("🔴 그 파일 맨 위 import 줄에 heic2any 가 없다", () => {
    assert.ok(
      !/^\s*import\b[^\n]*from\s*["']heic2any["']/m.test(converterCode),
      "정적 import 가 생겼다 — 1.4MB 가 첫 화면에 따라붙는다"
    );
  });

  test("🔴 src 아래 어느 파일도 heic2any 를 정적으로 들여오지 않는다", () => {
    const srcRoot = path.join(here, "..", "..", "..");
    const offenders: string[] = [];
    let scanned = 0;

    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        scanned += 1;
        const code = withoutComments(readFileSync(full, "utf8"));
        if (/^\s*import\b[^\n]*from\s*["']heic2any["']/m.test(code)) {
          offenders.push(path.relative(srcRoot, full).split(path.sep).join("/"));
        }
        if (/\brequire\(\s*["']heic2any["']\s*\)/.test(code)) {
          offenders.push(path.relative(srcRoot, full).split(path.sep).join("/"));
        }
      }
    }
    walk(srcRoot);

    // 걷기가 조용히 망가져 0개를 보고 통과하는 일이 없게 한다.
    assert.ok(scanned > 500, `src 를 제대로 못 걸었다 — 읽은 파일 ${scanned}개`);
    assert.deepEqual(offenders, [], "heic2any 를 정적으로 들여온 파일이 있다");
  });

  test("라이브러리가 package.json 에 적혀 있다 — 늦게 받는 것과 별개다", () => {
    const pkg = JSON.parse(read("..", "..", "..", "..", "package.json")) as {
      dependencies: Record<string, string>;
    };
    assert.ok(pkg.dependencies.heic2any, "heic2any 가 dependencies 에 없다");
  });
});

describe("🔴 화면이 이 규칙대로 배선돼 있다", () => {
  const screen = read("FilesScreen.tsx");
  const screenCode = withoutComments(screen);

  test("고르는 칸이 계산된 accept 를 그대로 쓴다 — 손으로 적은 목록이 아니다", () => {
    assert.ok(screenCode.includes("accept={acceptAttribute}"), "accept 배선이 바뀌었다");
    assert.ok(
      screenCode.includes("pickerAcceptAttribute(allowedExtensions)"),
      "accept 를 다른 식으로 짓고 있다"
    );
  });

  test("보내기 전에 바꾼다 — 진짜 변환기를 넘기고, 실패는 올리기 실패와 한 목록이다", () => {
    assert.ok(screenCode.includes("convert: convertHeicToJpeg"), "진짜 변환기를 안 넘긴다");
    assert.ok(screenCode.includes("failures.push(...outcome.failures)"), "변환 실패가 샌다");
    // 🔴 2026-11-18 저녁에 **한 겹이 끼어들었다가 2026-11-26 에 빠졌다.** 그날 저녁 같은
    //    패널에 [파일 이름 (선택)] 이 생기면서, 이름을 적어 두면 목록에 뜨는 것이
    //    `IMG_1234.jpg` 가 아니라 그 이름이 되어 바뀐 이름 줄의 「→ 뒤」를 최종 이름으로
    //    갈아 끼워야 했다(heicRenamesWithUploadNames). 🔴 2026-11-26 에 그 칸이 **폴더
    //    이름**이 되면서 파일 이름을 정하는 기능이 없어졌고(사용자 결정), 올라가는 이름이
    //    다시 구운 이름 그대로라 **갈아 끼울 것이 없다.** 그래서 바꾼 쌍을 그대로 넘긴다.
    // 🔴 **알리는 일 자체는 한 글자도 안 바뀌었다 — 빠지면 여기서 걸린다.**
    assert.ok(screenCode.includes("heicRenamed = outcome.renamed"), "바뀐 이름을 안 모은다");
    assert.ok(
      screenCode.includes("heicNotice = heicConversionNotice(heicRenamed);"),
      "바뀐 이름을 사람에게 안 알린다"
    );
    // 🔴 없어진 한 겹이 되살아나면 여기서 걸린다(그 한 벌은 저장소에 없다).
    assert.equal(
      screenCode.includes("heicRenamesWithUploadNames"),
      false,
      "없어진 이름 갈아 끼우기가 되살아났다"
    );
    assert.ok(
      /import \{ convertHeicToJpeg \} from "\.\/heic-to-jpeg";/.test(screenCode),
      "진짜 변환기를 어디서 가져오는지가 바뀌었다"
    );
  });

  test("🔴 찍어 둔 사진과 사진을 안 받는 분류는 이 길을 안 지난다", () => {
    assert.ok(
      screenCode.includes("if (!fromCamera && takesPhotos) {"),
      "변환을 거는 조건이 바뀌었다 — 촬영 사진까지 지나면 올린 사진의 차례가 어긋난다"
    );
  });

  test("🔴 바꾸는 동안 단추가 잠겨 있다 — 느린 폰에서 두 번 누르는 일이 실제로 난다", () => {
    const upload = screenCode.slice(screenCode.indexOf("async function handleUpload("));
    const lock = upload.indexOf("setIsUploading(true)");
    const convert = upload.indexOf("convertPickedHeic(files");
    assert.ok(lock >= 0, "올리는 중 잠금이 사라졌다");
    assert.ok(convert > lock, "잠그기 전에 사진을 바꾼다 — 그 사이에 두 번 누를 수 있다");
    // 잠금은 보내는 단추와 고르는 칸 둘 다에 걸린다.
    assert.ok(
      /<button\s+type="submit"\s+disabled=\{isUploading\}/.test(screenCode),
      "보내는 단추가 안 잠긴다"
    );
    const inputStart = screenCode.indexOf("ref={fileInputRef}");
    assert.ok(inputStart >= 0, "고르는 칸을 못 찾았다");
    // 그 `<input>` 하나만 잘라 본다(다음 `/>` 까지) — 화면의 다른 칸에 걸리지 않게.
    const fileInput = screenCode.slice(inputStart, screenCode.indexOf("/>", inputStart));
    assert.ok(fileInput.includes("disabled={isUploading}"), "고르는 칸이 안 잠긴다");
    assert.ok(fileInput.includes("accept={acceptAttribute}"), "자른 칸이 고르는 칸이 아니다");
  });

  test("🔴 한 장씩 차례로 바꾼다 — 폰에서 나란히 디코딩하면 탭이 죽는다", () => {
    const convertCode = withoutComments(read("heic-upload.ts"));
    assert.ok(
      /for \(const file of files\) \{/.test(convertCode),
      "한 장씩 도는 고리가 사라졌다"
    );
    assert.ok(!convertCode.includes("Promise.all"), "변환을 나란히 세웠다 — 폰 메모리가 터진다");
  });

  test("🔴 바꾸는 동안의 표시가 올리는 중과 **다른 칸**이다", () => {
    assert.ok(screenCode.includes("conversionProgress"), "변환 진행 표시가 사라졌다");
    assert.ok(screenCode.includes("사진 바꾸는 중…"), "바꾸는 중이라고 말하지 않는다");
    assert.ok(screenCode.includes("올리는 중… "), "올리기 진행 표시가 사라졌다");
  });

  test("🔴 허용목록 모듈에서 가져오는 것이 늘지 않았다 — 목록을 건드리지 않았다", () => {
    const importBlock = screenCode.match(
      /import \{[^}]*\} from "@\/lib\/domain\/attachment-allowlist";/
    );
    assert.ok(importBlock, "허용목록 import 를 못 찾았다");
    assert.ok(!importBlock[0].includes("heic"), "허용목록에서 heic 를 가져오고 있다");
  });
});
